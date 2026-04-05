/**
 * JetStream publisher for the Agent Core.
 *
 * Publishes tenant.*.events to JetStream instead of raw NATS,
 * so the SaaS API's persistence consumer can ACK + dedup + retry.
 */
import { connect, JSONCodec, AckPolicy, DeliverPolicy, RetentionPolicy, StorageType } from "nats";

const codec = JSONCodec<Record<string, unknown>>();

export type NatsJsPublisher = {
  publishEvent: (tenantId: string, payload: Record<string, unknown>) => Promise<void>;
  close: () => Promise<void>;
};

export async function createJsPublisher(servers: string): Promise<NatsJsPublisher> {
  const nc = await connect({ servers });

  const jsm = await nc.jetstreamManager();

  // Stream for agent → API events
  const streamName = "AIDEV_EVENTS";
  try {
    await jsm.streams.info(streamName);
  } catch {
    await jsm.streams.add({
      name: streamName,
      subjects: ["tenant.>"],
      retention: RetentionPolicy.WorkQueue,
      storage: StorageType.File,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  const js = nc.jetstream();

  return {
    publishEvent: async (tenantId: string, payload: Record<string, unknown>) => {
      const subject = `tenant.${tenantId}.events`;
      // msgID prevents double-publish on retry
      const msgId = (payload.traceId as string) ?? `${Date.now()}-${subject}`;
      await js.publish(subject, codec.encode(payload), { msgID: msgId, timeout: 5000 });
    },
    close: async () => {
      await nc.close();
    },
  };
}
