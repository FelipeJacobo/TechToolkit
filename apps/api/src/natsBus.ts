/**
 * natsBus.ts — JetStream + NATS bus for multi-tenant SaaS
 *
 * Publishes + Subscribes with JetStream persistence,
 * automatic retries with exponential backoff + jitter,
 * and Dead Letter Queue (DLQ) routing on max retries exceeded.
 * Idempotency via messageId deduplication.
 */

import { connect, JSONCodec, JetStreamClient, JetStreamManager, NatsConnection, consumerOpts, JsMsg, Msg, RetentionPolicy, StorageType } from "nats";

const codec = JSONCodec();

// Streams
const RUN_STREAM = "AGENT_RUNS";
const DLQ_STREAM = "AICLAW_DLQ";

export type NatsBusConfig = {
  servers: string[];
  jetstreamEnabled: boolean;
  maxRetries: number;
  backoffMs: number;
  retryJitter: number;
};

export class NatsBus {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private connected = false;
  private subscriptions: Map<string, { subject: string; handler: (data: any) => void }> = new Map();
  private processing: Set<string> = new Set(); // idempotency

  constructor(private config: NatsBusConfig) {}

  // ============================================================
  // Connection + stream setup
  // ============================================================

  async connect(): Promise<void> {
    if (this.connected) return;
    this.nc = await connect({ servers: this.config.servers });
    if (this.config.jetstreamEnabled) {
      this.jsm = await this.nc.jetstreamManager();
      this.js = this.nc.jetstream();
      await this.ensureStreams();
    }
    this.connected = true;
  }

  private async ensureStreams(): Promise<void> {
    if (!this.jsm) return;

    // Main run stream
    try {
      await this.jsm.streams.info(RUN_STREAM);
    } catch {
      await this.jsm.streams.add({
        name: RUN_STREAM,
        subjects: ["agent.run.request", "agent.run.response", "agent.run.progress"],
        retention: RetentionPolicy.WorkQueue,
        storage: StorageType.File,
        maxDeliver: 3,
        ackWait: 60_000, // 60s per attempt
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });
    }

    // DLQ stream
    try {
      await this.jsm.streams.info(DLQ_STREAM);
    } catch {
      await this.jsm.streams.add({
        name: DLQ_STREAM,
        subjects: ["agent.run.dlq"],
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
        maxAge: 14 * 24 * 60 * 60 * 1000,
      });
    }
  }

  // ============================================================
  // Publish (with idempotency via msgID)
  // ============================================================

  async publish(subject: string, payload: any, options?: { msgID?: string; persist?: boolean }): Promise<void> {
    if (!this.nc) throw new Error("NATS not connected");

    const msgID = options?.msgID ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const data = codec.encode({ ...payload, _msgID: msgID, _ts: Date.now() });

    if (this.config.jetstreamEnabled && this.js && options?.persist !== false) {
      await this.js.publish(subject, data, { msgID, timeout: 10_000 });
    } else {
      this.nc.publish(subject, data);
    }
  }

  // ============================================================
  // Subscribe (with retries + DLQ + idempotency)
  // ============================================================

  async subscribe(pattern: string, handler: (data: any) => Promise<void>): Promise<string> {
    if (!this.nc) throw new Error("NATS not connected");

    const subId = `${pattern}-${Date.now()}`;

    if (this.config.jetstreamEnabled && this.js) {
      // JetStream durable consumer per subject
      await this.subscribeJetStream(pattern, handler, subId);
    } else {
      // Plain NATS subscribe with manual retry logic
      this.subscribeCore(pattern, handler, subId);
    }

    this.subscriptions.set(subId, { subject: pattern, handler });
    return subId;
  }

  private subscribeCore(pattern: string, handler: (data: any) => Promise<void>, subId: string): void {
    if (!this.nc) return;

    const sub = this.nc.subscribe(pattern);
    (async () => {
      for await (const msg of sub) {
        let data: any;
        try {
          data = codec.decode(msg.data);
        } catch (e) {
          console.error("[NATS] Decode error:", e);
          continue;
        }

        // Idempotency: skip already processed
        const msgId = data?._msgID;
        if (msgId && this.processing.has(msgId)) continue;

        try {
          await handler(data);
          if (msgId) this.processing.add(msgId);
        } catch (err: any) {
          console.error(`[NATS] Handler error on ${pattern}:`, err.message);
          // Retry with backoff (capped at maxRetries)
          const attempt = data?._retryCount ?? 0;
          if (attempt < this.config.maxRetries) {
            const delay = this.getBackoff(attempt);
            setTimeout(() => {
              this.publish(pattern, { ...data, _retryCount: attempt + 1 }, { persist: false });
            }, delay);
          } else {
            // Send to DLQ
            console.error(`[NATS] Max retries exceeded for ${pattern}, sending to DLQ`);
            this.publish("agent.run.dlq", { ...data, _error: err.message, _dlqAt: Date.now() });
          }
        }
      }
    })();
  }

  private async subscribeJetStream(pattern: string, handler: (data: any) => Promise<void>, subId: string): Promise<void> {
    if (!this.js) return;

    const opts = consumerOpts();
    opts.durable(`durable-${subId}`);
    opts.manualAck();
    opts.ackExplicit();
    opts.maxAckPending(256);

    const sub = await this.js.subscribe(pattern, opts);

    (async () => {
      for await (const jsMsg of sub) {
        await this.handleJsMessage(jsMsg, pattern, handler);
      }
    })();
  }

  private async handleJsMessage(jsMsg: JsMsg, pattern: string, handler: (data: any) => Promise<void>): Promise<void> {
    let data: any;
    try {
      data = codec.decode(jsMsg.data);
    } catch {
      jsMsg.term();
      return;
    }

    // Idempotency
    const msgId = data?._msgID;
    if (msgId && this.processing.has(msgId)) {
      jsMsg.ack();
      return;
    }

    try {
      await handler(data);
      if (msgId) this.processing.add(msgId);
      jsMsg.ack();
    } catch (err: any) {
      console.error(`[JetStream] Handler error on ${pattern}:`, err.message);

      const attempt = jsMsg.info?.deliveryCount ?? 0;
      if (attempt < this.config.maxRetries) {
        // Nak with backoff — JetStream handles redelivery
        const delayMs = this.getBackoff(attempt);
        jsMsg.nak(delayMs);
      } else {
        // Ack + publish to DLQ
        jsMsg.ack();
        if (this.config.jetstreamEnabled && this.js) {
          await this.js.publish("agent.run.dlq", codec.encode({
            ...data,
            _error: err.message,
            _dlqAt: Date.now(),
            _originalSubject: pattern,
          }), { timeout: 5000 });
        }
        console.error(`[JetStream] Message sent to DLQ: ${pattern}`);
      }
    }
  }

  // ============================================================
  // Unsubscribe
  // ============================================================

  async unsubscribe(subId: string): Promise<void> {
    this.subscriptions.delete(subId);
    // In practice, JetStream subscription cleanup is automatic on close
    // For explicit cleanup, track Subscription refs
  }

  // ============================================================
  // Backoff calculation (exponential + jitter)
  // ============================================================

  private getBackoff(attempt: number): number {
    const base = this.config.backoffMs * Math.pow(2, attempt);
    const jitter = base * this.config.retryJitter * Math.random();
    return Math.min(base + jitter, 120_000); // cap 2 min
  }

  // ============================================================
  // Close
  // ============================================================

  async close(): Promise<void> {
    await this.nc?.close();
    this.nc = null;
    this.js = null;
    this.jsm = null;
    this.connected = false;
  }
}
