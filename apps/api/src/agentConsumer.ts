/**
 * agentConsumer.ts — Persistencia de eventos del agente
 *
 * Escucha tenant.*.events (emitidos por Agent Core cuando procesa tareas).
 * Actualiza agent_runs status: pending → running → completed/failed
 * Guarda logs y traces en Postgres.
 *
 * Manejo: JetStream retries, DLQ, idempotencia.
 */
import { connect, JSONCodec, RetentionPolicy, StorageType, DeliverPolicy } from "nats";
import type { Pool } from "pg";

const codec = JSONCodec<Record<string, unknown>>();

const EVENT_STREAM = "AIDEV_EVENTS";
const DLQ_NAME = "AIDEV_EVENTS_DLO";
const MAX_RETRIES = 5;

// Idempotencia: track de event IDs procesados (1h TTL)
const processed = new Map<string, number>();
const IDEMPOTENCY_MS = 3_600_000;

type TenantEvent = {
  traceId: string;
  runId?: string;
  projectId: string;
  state: string;
  error?: string;
  payload?: Record<string, unknown>;
};

// ============================================================
// Streams
// ============================================================

async function ensureStreams(nc: import("nats").NatsConnection): Promise<void> {
  const jsm = await nc.jetstreamManager();

  try { await jsm.streams.info(EVENT_STREAM); } catch {
    await jsm.streams.add({
      name: EVENT_STREAM,
      subjects: ["tenant.*.events"],
      retention: RetentionPolicy.WorkQueue,
      storage: StorageType.File,
      maxDeliver: MAX_RETRIES,
      ackWait: 30_000,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  try { await jsm.streams.info(DLQ_NAME); } catch {
    await jsm.streams.add({
      name: DLQ_NAME,
      subjects: ["AIDEV_DLO.>"],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      maxAge: 14 * 24 * 60 * 60 * 1000,
    });
  }
}

// ============================================================
// Idempotencia
// ============================================================

function isDuplicate(id: string): boolean {
  const seen = processed.get(id);
  if (seen && Date.now() - seen < IDEMPOTENCY_MS) return true;
  processed.set(id, Date.now());
  if (processed.size > 10000) {
    const cutoff = Date.now() - IDEMPOTENCY_MS;
    for (const [k, v] of processed) {
      if (v < cutoff) processed.delete(k);
    }
  }
  return false;
}

// ============================================================
// Persistir evento en DB
// ============================================================

async function persistEvent(pool: Pool, event: TenantEvent): Promise<void> {
  const traceId = event.traceId;
  const state = event.state;

  // Nivel de log según estado
  const level = state.includes("fail") || state.includes("error")
    ? "error"
    : state.includes("complete")
    ? "info"
    : "debug";

  // 1. Insert log
  await pool.query(
    `INSERT INTO logs (run_id, level, message, meta)
     VALUES ((SELECT id FROM agent_runs WHERE trace_id = $1 LIMIT 1), $2, $3, $4)`,
    [traceId, level, state, event]
  );

  // 2. Actualizar status en states terminales
  if (state === "completed" || state === "failed" || state === "execution_failed") {
    const finalStatus = state === "completed" ? "completed" : "failed";
    await pool.query(
      "UPDATE agent_runs SET status = $1 WHERE trace_id = $2",
      [finalStatus, traceId]
    );
  }

  // 3. Persistir trace para auditoría
  await pool.query(
    `INSERT INTO traces (run_id, payload)
     VALUES ((SELECT id FROM agent_runs WHERE trace_id = $1 LIMIT 1), $2)`,
    [traceId, event]
  );

  // 4. Audit log en state terminal
  if (state === "completed" || state === "failed" || state === "execution_failed") {
    await pool.query(
      `INSERT INTO audit_logs (user_id, project_id, action, meta)
       VALUES (NULL, $1, $2, $3)`,
      [event.projectId, `run.${state}`, JSON.stringify({ traceId, state, error: event.error })]
    );
  }
}

// ============================================================
// Consumer: tenant.*.events
// ============================================================

export async function startEventPersistenceConsumer(
  natsServers?: string,
  pool?: Pool
): Promise<{ close: () => Promise<void> }> {
  const servers = natsServers ?? process.env.NATS_SERVERS ?? "nats://localhost:4222";
  if (!pool) {
    const Pg = await import("pg");
    pool = new Pg.Pool({ connectionString: process.env.DATABASE_URL });
  }

  const nc = await connect({ servers });
  await ensureStreams(nc);
  const js = nc.jetstream();

  // Durable consumer: tenant.*.events
  const sub = await js.subscribe("tenant.*.events", {
    durable: "event-persister",
    manualAck: true,
    deliverPolicy: DeliverPolicy.New,
    maxAckPending: 256,
  });

  console.log("[event-persister] Listening on tenant.*.events via JetStream");

  (async () => {
    for await (const msg of sub) {
      try {
        const data = codec.decode(msg.data) as TenantEvent;
        if (!data?.traceId) {
          msg.term();
          continue;
        }

        // Idempotencia: deduplicar por traceId+state
        const dupKey = `${data.traceId}-${data.state}`;
        if (isDuplicate(dupKey)) {
          msg.ack();
          continue;
        }

        await persistEvent(pool as Pool, data);
        msg.ack();
      } catch (err) {
        const attempt = msg.info?.deliveryCount ?? 1;
        if (attempt < MAX_RETRIES) {
          msg.nak(attempt * 2000); // backoff: 2s, 4s, 6s...
        } else {
          msg.ack(); // JetStream republish a DLQ
          console.error(`[event-persister] DLQ after ${attempt} attempts`);
        }
      }
    }
  })().catch((err) => {
    console.error("[event-persister] Consumer loop crashed:", err);
  });

  return { close: async () => { await nc.close(); await (pool as Pool).end(); } };
}

// ============================================================
// DLQ Monitor
// ============================================================

export async function startDLQMonitor(servers?: string): Promise<void> {
  const s = servers ?? process.env.NATS_SERVERS ?? "nats://localhost:4222";
  const nc = await connect({ servers: s });
  const js = nc.jetstream();

  try {
    const sub = await js.subscribe("AIDEV_DLO.>", {
      durable: "dlq-monitor",
      manualAck: true,
      deliverPolicy: "all",
    });

    console.log("[dlq-monitor] Listening on AIDEV_DLO.*");

    (async () => {
      for await (const msg of sub) {
        const data = codec.decode(msg.data);
        console.error("[DLQ]", {
          subject: msg.subject,
          seq: msg.seq,
          stream: msg.info?.stream,
          data,
        });
        msg.ack();
      }
    })();
  } catch {
    console.log("[dlq-monitor] DLQ stream not found (no dead-lettered events yet)");
  }

  await nc.close();
}
