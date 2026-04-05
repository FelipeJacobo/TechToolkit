export type AppConfig = {
  bus: {
    driver: "memory" | "nats";
    natsServers: string[];
    requestTimeoutMs: number;
    jetstreamEnabled: boolean;
    jetstreamStream: string;
    maxRetries: number;
    backoffMs: number;
    retryJitterFactor: number;
    dlqTopic: string;
  };
  memory: {
    driver: "memory" | "postgres" | "vector";
    databaseUrl: string;
    embeddingsProvider: "openai";
    openaiApiKey: string | null;
    openaiModel: string;
  };
  cost: {
    maxRunUsd: number;
    maxStepUsd: number;
    defaultModel: string;
    modelRates: Record<string, { inputPer1k: number; outputPer1k: number }>;
  };
  tools: {
    permissions: Array<{ tool: string; allow: boolean }>;
    defaultTool: { namespace: string; name: string; version: string };
  };
  idempotency: {
    driver: "memory" | "redis";
    redisUrl: string;
    ttlSeconds: number;
  };
};

export const config: AppConfig = {
  bus: {
    driver: (process.env.BUS_DRIVER as "memory" | "nats") ?? "memory",
    natsServers: (process.env.NATS_SERVERS ?? "nats://localhost:4222")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    requestTimeoutMs: Number(process.env.NATS_REQUEST_TIMEOUT_MS ?? 5000),
    jetstreamEnabled: process.env.NATS_JETSTREAM === "true",
    jetstreamStream: process.env.NATS_JETSTREAM_STREAM ?? "AIDEV",
    maxRetries: Number(process.env.NATS_MAX_RETRIES ?? 3),
    backoffMs: Number(process.env.NATS_BACKOFF_MS ?? 500),
    retryJitterFactor: Number(process.env.NATS_RETRY_JITTER_FACTOR ?? 0),
    dlqTopic: process.env.NATS_DLQ_TOPIC ?? "bus.dlq"
  },
  memory: {
    driver: (process.env.MEMORY_DRIVER as "memory" | "postgres" | "vector") ?? "memory",
    databaseUrl: process.env.DATABASE_URL ?? "",
    embeddingsProvider: "openai",
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    openaiModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"
  },
  cost: {
    maxRunUsd: Number(process.env.COST_MAX_RUN_USD ?? 5),
    maxStepUsd: Number(process.env.COST_MAX_STEP_USD ?? 1),
    defaultModel: process.env.AGENT_MODEL ?? process.env.ANALYSIS_MODEL ?? "gpt-4o",

    modelRates: {
      "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01 },
      "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
      "gpt-4.1-mini": { inputPer1k: 0.0003, outputPer1k: 0.0012 },
      "text-embedding-3-small": { inputPer1k: 0.00002, outputPer1k: 0 }
    }
  },
  tools: {
    permissions: (process.env.TOOL_PERMISSIONS ?? "tool:default:allow")
      .split(",")
      .map((rule) => {
        const parts = rule.split(":");
        const decision = parts.pop();
        return { tool: parts.join(":"), allow: decision === "allow" };
      }),
    defaultTool: {
      namespace: process.env.TOOL_DEFAULT_NAMESPACE ?? "tool",
      name: process.env.TOOL_DEFAULT_NAME ?? "default",
      version: process.env.TOOL_DEFAULT_VERSION ?? "1.0.0"
    }
  },
  idempotency: {
    driver: (process.env.IDEMPOTENCY_DRIVER as "memory" | "redis") ?? "memory",
    redisUrl: process.env.REDIS_URL ?? "",
    ttlSeconds: Number(process.env.IDEMPOTENCY_TTL_SECONDS ?? 3600)
  }
};
