/**
 * natsBus.ts — NATS JetStream message bus para Agent Core
 * 
 * - Publish + Subscribe con JetStream persistence
 * - Retries con backoff exponencial + jitter
 * - Dead Letter Queue (DLQ) automatic routing
 * - Idempotencia via msgID
 */
import {
  connect, consumerOpts, createInbox,
  JetStreamClient, JetStreamManager, JsMsg,
  JSONCodec, NatsConnection, RetentionPolicy, StorageType
} from "nats";
import { randomUUID } from "crypto";
import { EventEnvelope, EventEnvelopeSchema } from "../core/types.js";
import { MessageBus, MessageHandler, BusSubscription, PublishOptions, RequestOptions } from "./messageBus.js";
import { busPublishHistogram, eventCounter, busRetryCounter, busDlqCounter } from "../observability/metrics.js";
import { runWithSpan } from "../core/trace.js";
import { EventPayloadSchemas } from "../validation/eventSchemas.js";
import { RetryPolicy } from "../core/retryPolicy.js";

export type NatsBusConfig = {
  servers: string[];
  requestTimeoutMs: number;
  jetstreamEnabled: boolean;
  jetstreamStream: string;
  maxRetries: number;
  backoffMs: number;
  retryJitterFactor: number;
  dlqTopic: string;
  idempotencyTtlSeconds: number;
};

export class NatsBus implements MessageBus {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private codec = JSONCodec<EventEnvelope<unknown>>();
  private subscriptions = new Map<string, { sub: Subscription; handlerId: string; topic: string }>();
  private _idempotency: import("../core/idempotency.js").IdempotencyStore | null = null;
  private get idempotency(): import("../core/idempotency.js").IdempotencyStore {
    if (!this._idempotency) throw new Error("NatsBus: idempotency not initialized");
    return this._idempotency;
  }
  private retryPolicy: RetryPolicy;

  private async initIdempotency(): Promise<void> {
    const { MemoryIdempotencyStore } = await import("../core/idempotency.js");
    this._idempotency = new MemoryIdempotencyStore();
  }

  constructor(private config: NatsBusConfig) {
    this.retryPolicy = new RetryPolicy(
      config.maxRetries,
      config.backoffMs,
      config.retryJitterFactor
    );
  }

  setIdempotency(store: import("../core/idempotency.js").IdempotencyStore, ttlSeconds?: number): void {
    this.idempotency = store;
    if (ttlSeconds) this.config.idempotencyTtlSeconds = ttlSeconds;
  }

  async connect(): Promise<void> {
    await this.initIdempotency();
    this.nc = await connect({ servers: this.config.servers });
    if (this.config.jetstreamEnabled) {
      this.jsm = await this.nc.jetstreamManager();
      this.js = this.nc.jetstream();
      await this.ensureStream();
    }
  }

  private async ensureStream(): Promise<void> {
    if (!this.jsm) return;
    try {
      await this.jsm.streams.info(this.config.jetstreamStream);
    } catch {
      await this.jsm.streams.add({
        name: this.config.jetstreamStream,
        subjects: [">"],
        retention: "limits",
        storage: "file",
      });
    }
  }

  async close(): Promise<void> {
    await this.nc?.drain();
    this.nc = null;
    this.js = null;
    this.jsm = null;
  }

  // ---- Publish ----
  async publish<TPayload>(topic: string, payload: TPayload, options?: PublishOptions): Promise<void> {
    if (!this.nc) throw new Error("NATS not connected");

    const event: EventEnvelope<TPayload> = {
      id: options?.eventId ?? randomUUID(),
      type: topic,
      createdAt: new Date().toISOString(),
      trace: { traceId: options?.traceId ?? randomUUID().slice(0, 16) },
      priority: options?.priority ?? "normal",
      retryCount: options?.retryCount ?? 0,
      maxRetries: options?.retries,
      deadLetterTopic: options?.deadLetterTopic,
      payload
    };

    const parsed = EventEnvelopeSchema.safeParse(event);
    if (!parsed.success) throw new Error("Invalid envelope");

    const data = this.codec.encode(event as EventEnvelope<unknown>);
    const endTimer = busPublishHistogram.startTimer({ topic });

    if (this.config.jetstreamEnabled && this.js) {
      // msgID = event.id → JetStream deduplicates on retry
      await this.js.publish(topic, data, {
        msgID: event.id,
        timeout: 10_000,
      });
    } else {
      this.nc.publish(topic, data);
    }
    endTimer();
  }

  // ---- Request/Reply ----
  async request<TPayload, TResponse>(
    topic: string,
    payload: TPayload,
    options: RequestOptions
  ): Promise<TResponse> {
    if (!this.nc) throw new Error("NATS not connected");

    const replyTopic = `${topic}.reply.${randomUUID()}`;
    let resolveFn: ((value: TResponse) => void) | undefined;
    let rejectFn: ((err: Error) => void) | undefined;

    const responsePromise = new Promise<TResponse>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const sub = await this.subscribe<TResponse>(replyTopic, async (event) => {
      resolveFn?.(event.payload as any);
    });

    const timeout = setTimeout(() => {
      rejectFn?.(new Error("Request timeout"));
    }, options.timeoutMs);

    await this.publish(topic, payload, options);

    try {
      return await responsePromise;
    } finally {
      clearTimeout(timeout);
      await this.unsubscribe(sub.handlerId);
    }
  }

  // ---- Subscribe ----
  async subscribe<TPayload>(topic: string, handler: MessageHandler<TPayload>): Promise<BusSubscription> {
    if (!this.nc) throw new Error("NATS not connected");

    const handlerId = randomUUID();
    const effectiveTopic = topic === "*" ? ">" : topic;

    const sub = this.config.jetstreamEnabled && this.js
      ? await this.subscribeJetStream<TPayload>(effectiveTopic, handler, handlerId)
      : this.subscribeCore<TPayload>(effectiveTopic, handler);

    this.subscriptions.set(handlerId, { sub, handlerId, topic: effectiveTopic });
    return { topic, handlerId, handler: handler as MessageHandler<unknown> };
  }

  private subscribeCore<TPayload>(topic: string, handler: MessageHandler<TPayload>): Subscription {
    if (!this.nc) throw new Error("NATS not connected");

    const sub = this.nc.subscribe(topic);
    (async () => {
      for await (const msg of sub) {
        await this.handleMessage(topic, handler, msg.data);
      }
    })().catch(console.error);

    return sub;
  }

  private async subscribeJetStream<TPayload>(
    topic: string,
    handler: MessageHandler<TPayload>,
    handlerId: string
  ): Promise<Subscription> {
    if (!this.js) throw new Error("JetStream not available");

    const opts = consumerOpts();
    opts.durable(`durable-${handlerId}`);
    opts.manualAck();
    opts.ackExplicit();
    opts.filterSubject(topic);
    opts.deliverTo(createInbox());
    opts.maxAckPending(1024);

    const sub = await this.js.subscribe(topic, opts);

    (async () => {
      for await (const msg of sub) {
        await this.handleMessage(topic, handler, msg.data, msg);
      }
    })().catch(console.error);

    return sub;
  }

  private async handleMessage<TPayload>(
    topic: string,
    handler: MessageHandler<TPayload>,
    data: any,
    jsMsg?: JsMsg
  ): Promise<void> {
    let decoded: EventEnvelope<TPayload> | null = null;
    try {
      decoded = this.codec.decode(data) as EventEnvelope<TPayload>;
      const parsed = EventEnvelopeSchema.safeParse(decoded);
      if (!parsed.success) {
        jsMsg?.term();
        return;
      }

      // Idempotencia
      if (decoded.retryCount === 0) {
        const acquired = await this.idempotency.acquire(
          decoded.id,
          this.config.idempotencyTtlSeconds
        );
        if (!acquired) {
          jsMsg?.ack();
          return;
        }
      }

      // Validación de payload
      const schema = EventPayloadSchemas[topic];
      if (schema) {
        const result = schema.safeParse(decoded.payload);
        if (!result.success) {
          jsMsg?.term();
          return;
        }
      }

      eventCounter.inc({ topic });
      await runWithSpan("bus.handle", { topic, traceId: decoded.trace.traceId }, () => handler(decoded));
      jsMsg?.ack();
    } catch (err: any) {
      const { handleError } = await import("../core/errorHandler.js");
      handleError(err, { traceId: decoded?.trace.traceId ?? "unknown" });

      if (decoded && this.retryPolicy.shouldRetry(err, decoded.retryCount || 0)) {
        busRetryCounter.inc({ topic });
        const backoffMs = this.retryPolicy.getBackoff(decoded.retryCount || 0);
        if (jsMsg) {
          jsMsg.nak(backoffMs); // JetStream retry
        } else {
          setTimeout(() => {
            this.publish(decoded!.type, decoded!.payload, {
              traceId: decoded!.trace.traceId,
              retries: decoded!.maxRetries ?? this.config.maxRetries,
              deadLetterTopic: decoded!.deadLetterTopic,
              retryCount: decoded!.retryCount + 1,
              eventId: decoded!.id
            }).catch(() => undefined);
          }, backoffMs);
        }
      } else {
        // Max retries → DLQ
        if (decoded) {
          const dlqTopic = decoded.deadLetterTopic ?? this.config.dlqTopic;
          busDlqCounter.inc({ topic: dlqTopic });
          await this.publish(dlqTopic, decoded, {
            traceId: decoded.trace.traceId,
            retryCount: (decoded.retryCount || 0) + 1,
            priority: "low"
          });
        }
        jsMsg?.ack();
      }
    }
  }

  // ---- Unsubscribe ----
  async unsubscribe(handlerId: string): Promise<void> {
    const entry = this.subscriptions.get(handlerId);
    if (!entry) return;
    entry.sub.unsubscribe();
    this.subscriptions.delete(handlerId);
  }
}
