/**
 * jetStreamPublisher.ts — SaaS API → NATS JetStream
 *
 * Cuando el usuario llama POST /agent/run-task, publica un request de tarea
 * en el stream JetStream para que el Agent Core lo procese.
 *
 * Flujo:
 *   API → agent.run.request → Agent Core → tenant.*.events → API (persist)
 */
import { connect, JSONCodec, RetentionPolicy, StorageType } from "nats";

const codec = JSONCodec<Record<string, unknown>>();

// JetStream streams
const RUN_STREAM = "AIDEV_RUNS";
const EVENT_STREAM = "AIDEV_EVENTS";
const DLQ_STREAM = "AIDEV_EVENTS_DLO";

// ============================================================
// Payload types
// ============================================================

export type RunTaskPayload = {
  runId: string;
  projectId: string;
  userId: string;
  goal: string;
  traceId: string;
};

export type ChatPayload = {
  projectId: string;
  userId: string;
  message: string;
  traceId: string;
};

// ============================================================
// Stream setup
// ============================================================

async function ensureStreams(nc: import("nats").NatsConnection): Promise<void> {
  const jsm = await nc.jetstreamManager();

  // Stream para run requests (WorkQueue — un solo consumer: Agent Core)
  try {
    await jsm.streams.info(RUN_STREAM);
  } catch {
    await jsm.streams.add({
      name: RUN_STREAM,
      subjects: ["agent.run.request"],
      retention: RetentionPolicy.WorkQueue,
      storage: StorageType.File,
      maxDeliver: 5,
      ackWait: 30_000,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  // Stream para tenant events (WorkQueue — un consumer: API persister)
  try {
    await jsm.streams.info(EVENT_STREAM);
  } catch {
    await jsm.streams.add({
      name: EVENT_STREAM,
      subjects: ["tenant.*.events"],
      retention: RetentionPolicy.WorkQueue,
      storage: StorageType.File,
      maxDeliver: 3,
      ackWait: 30_000,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  // DLQ stream (Limits — retención para análisis manual)
  try {
    await jsm.streams.info(DLQ_STREAM);
  } catch {
    await jsm.streams.add({
      name: DLQ_STREAM,
      subjects: ["AIDEV_DLO.>"],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      maxAge: 14 * 24 * 60 * 60 * 1000,
    });
  }
}

// ============================================================
// Publisher API
// ============================================================

export type JsPublisher = {
  publishRunTask(payload: RunTaskPayload): Promise<void>;
  publishChat(payload: ChatPayload): Promise<void>;
  close(): Promise<void>;
};

export async function createJsPublisher(servers: string): Promise<JsPublisher> {
  const nc = await connect({ servers });
  await ensureStreams(nc);
  const js = nc.jetstream();

  return {
    publishRunTask: async (payload: RunTaskPayload) => {
      // msgID = runId → NATS deduplica automáticamente en caso de retry
      await js.publish("agent.run.request", codec.encode(payload), {
        msgID: payload.runId,
        timeout: 15_000,
      });
    },
    publishChat: async (payload: ChatPayload) => {
      await js.publish(`tenant.${payload.projectId}.chat`, codec.encode(payload), {
        msgID: payload.traceId,
        timeout: 10_000,
      });
    },
    close: async () => {
      await nc.close();
    },
  };
}
