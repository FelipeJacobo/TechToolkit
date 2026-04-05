import { randomUUID } from "crypto";
import { EventEnvelope, EventEnvelopeSchema, Priority } from "../core/types.js";
import { MessageBus, MessageHandler, BusSubscription, PublishOptions, RequestOptions } from "./messageBus.js";
import { busPublishHistogram, eventCounter, busRetryCounter, busDlqCounter } from "../observability/metrics.js";
import { runWithSpan } from "../core/trace.js";
import { EventPayloadSchemas } from "../validation/eventSchemas.js";
import { RetryPolicy } from "../core/retryPolicy.js";

const PRIORITY_ORDER: Record<Priority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3
};

type QueueItem = {
  topic: string;
  event: EventEnvelope<unknown>;
  deadLetterTopic?: string;
};

export type InMemoryBusConfig = {
  maxQueueSize?: number;
  maxRetries?: number;
  backoffMs?: number;
  retryJitterFactor?: number;
  dlqTopic?: string;
  idempotencyTtlSeconds?: number;
};

export class InMemoryBus implements MessageBus {
  private subscriptions = new Map<string, BusSubscription>();
  private topicHandlers = new Map<string, Set<string>>();
  private queue: QueueItem[] = [];
  private draining = false;
  private maxQueueSize: number;
  private maxRetries: number;
  private backoffMs: number;
  private retryJitterFactor: number;
  private dlqTopic: string;
  private idempotencyTtlSeconds: number;
  private retryPolicy: RetryPolicy;
  private _idempotency: import("../core/idempotency.js").IdempotencyStore | null = null;
  private get idempotency(): import("../core/idempotency.js").IdempotencyStore {
    if (!this._idempotency) throw new Error("InMemoryBus: idempotency not initialized");
    return this._idempotency;
  }

  async init(): Promise<void> {
    const { MemoryIdempotencyStore } = await import("../core/idempotency.js");
    this._idempotency = new MemoryIdempotencyStore();
  }

  setIdempotency(store: import("../core/idempotency.js").IdempotencyStore, ttlSeconds?: number): void {
    this._idempotency = store;
    if (ttlSeconds) {
      this.idempotencyTtlSeconds = ttlSeconds;
    }
  }

  constructor(config: InMemoryBusConfig = {}) {
    this.maxQueueSize = config.maxQueueSize ?? 1000;
    this.maxRetries = config.maxRetries ?? 3;
    this.backoffMs = config.backoffMs ?? 250;
    this.retryJitterFactor = config.retryJitterFactor ?? 0;
    this.dlqTopic = config.dlqTopic ?? "bus.dlq";
    this.idempotencyTtlSeconds = config.idempotencyTtlSeconds ?? 3600;
    this.retryPolicy = new RetryPolicy(this.maxRetries, this.backoffMs, this.retryJitterFactor);
  }

  async publish<TPayload>(topic: string, payload: TPayload, options?: PublishOptions): Promise<void> {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error("Backpressure: queue full");
    }

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
    if (!parsed.success) {
      throw new Error("Invalid envelope");
    }

    const endTimer = busPublishHistogram.startTimer({ topic });
    this.queue.push({
      topic,
      event: event as EventEnvelope<unknown>,
      deadLetterTopic: options?.deadLetterTopic
    });
    endTimer();

    this.queue.sort((a, b) => PRIORITY_ORDER[b.event.priority] - PRIORITY_ORDER[a.event.priority]);
    if (!this.draining) {
      this.drain().catch(async (err) => {
        const { logError } = await import("../core/logging.js");
        logError({ step: "bus.drain" }, "bus drain failed", err);
      });
    }
  }

  async request<TPayload, TResponse>(
    topic: string,
    payload: TPayload,
    options: RequestOptions
  ): Promise<TResponse> {
    const replyTopic = `${topic}.reply.${randomUUID()}`;
    let resolveFn: ((value: TResponse) => void) | undefined;
    let rejectFn: ((err: Error) => void) | undefined;

    const responsePromise = new Promise<TResponse>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const subscription = await this.subscribe<TResponse>(replyTopic, async (event) => {
      resolveFn?.(event.payload);
    });

    const timeout = setTimeout(() => {
      rejectFn?.(new Error("Request timeout"));
    }, options.timeoutMs);

    await this.publish(topic, { payload, replyTopic }, options);

    try {
      return await responsePromise;
    } finally {
      clearTimeout(timeout);
      await this.unsubscribe(subscription.handlerId);
    }
  }

  async subscribe<TPayload>(topic: string, handler: MessageHandler<TPayload>): Promise<BusSubscription> {
    const handlerId = randomUUID();
    const subscription: BusSubscription = {
      topic,
      handlerId,
      handler: handler as MessageHandler<unknown>
    };
    this.subscriptions.set(handlerId, subscription);
    const set = this.topicHandlers.get(topic) ?? new Set();
    set.add(handlerId);
    this.topicHandlers.set(topic, set);
    return subscription;
  }

  async unsubscribe(handlerId: string): Promise<void> {
    const subscription = this.subscriptions.get(handlerId);
    if (!subscription) return;
    this.subscriptions.delete(handlerId);
    const set = this.topicHandlers.get(subscription.topic);
    set?.delete(handlerId);
  }

  private async drain(): Promise<void> {
    this.draining = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      const handlerIds = new Set<string>();
      const direct = this.topicHandlers.get(item.topic);
      direct?.forEach((id) => handlerIds.add(id));
      const wildcard = this.topicHandlers.get("*");
      wildcard?.forEach((id) => handlerIds.add(id));
      if (handlerIds.size === 0) {
        if (item.deadLetterTopic) {
          await this.publish(item.deadLetterTopic, item.event, { priority: "low" });
        }
        continue;
      }
      await Promise.all(
        Array.from(handlerIds).map(async (handlerId) => {
          const handler = this.subscriptions.get(handlerId)?.handler;
          if (!handler) return;
          try {
            if (item.event.retryCount === 0) {
              const acquired = await this.idempotency.acquire(
                item.event.id,
                this.idempotencyTtlSeconds
              );
              if (!acquired) {
                return;
              }
            }
            const schema = EventPayloadSchemas[item.topic];
            if (schema) {
              const parsed = schema.safeParse(item.event.payload);
              if (!parsed.success) {
                const { logWarn } = await import("../core/logging.js");
                logWarn({ step: "bus.handle" }, "invalid event payload");
                return;
              }
            }
            eventCounter.inc({ topic: item.topic });
            await runWithSpan(
              "bus.handle",
              { topic: item.topic, traceId: item.event.trace.traceId },
              () => handler(item.event)
            );
          } catch (err) {
            const { handleError } = await import("../core/errorHandler.js");
            handleError(err, { traceId: item.event.trace.traceId, step: "bus.handle" });

            const maxRetries = item.event.maxRetries ?? this.maxRetries;
            if (this.retryPolicy.shouldRetry(err, item.event.retryCount)) {
              busRetryCounter.inc({ topic: item.topic });
              const backoffMs = this.retryPolicy.getBackoff(item.event.retryCount);
              setTimeout(() => {
                this.queue.push({
                  topic: item.topic,
                  event: {
                    ...item.event,
                    retryCount: item.event.retryCount + 1,
                    maxRetries
                  }
                });
              }, backoffMs);
              return;
            }

            const dlqTopic = item.event.deadLetterTopic ?? this.dlqTopic;
            if (dlqTopic) {
              busDlqCounter.inc({ topic: dlqTopic });
              await this.publish(dlqTopic, item.event, { priority: "low" });
            }

            const { logError } = await import("../core/logging.js");
            logError({ step: "bus.handle" }, "handler error", err);
          }
        })
      );
    }
    this.draining = false;
  }
}
