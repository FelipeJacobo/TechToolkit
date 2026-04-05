import { EventEnvelope, Priority } from "../core/types.js";

export type MessageHandler<TPayload> = (event: EventEnvelope<TPayload>) => Promise<void>;

export type BusSubscription = {
  topic: string;
  handlerId: string;
  handler: MessageHandler<unknown>;
};

export type PublishOptions = {
  priority?: Priority;
  retries?: number;
  deadLetterTopic?: string;
  traceId?: string;
  persist?: boolean;
  eventId?: string;
  retryCount?: number;
};

export type RequestOptions = PublishOptions & {
  timeoutMs: number;
};

export interface MessageBus {
  publish<TPayload>(topic: string, payload: TPayload, options?: PublishOptions): Promise<void>;
  request<TPayload, TResponse>(
    topic: string,
    payload: TPayload,
    options: RequestOptions
  ): Promise<TResponse>;
  subscribe<TPayload>(topic: string, handler: MessageHandler<TPayload>): Promise<BusSubscription>;
  unsubscribe(handlerId: string): Promise<void>;
}
