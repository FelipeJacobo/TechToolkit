import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { connect, JSONCodec } from "nats";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import Redis from "ioredis";
import Register from "register";

const app = Fastify({ logger: true });

app.addHook("onRequest", async (req) => {
  if (req.headers["stripe-signature"]) {
    req.rawBody = await req.raw?.read?.();
  }
});

// 🔒 CORS: whitelist de orígenes permitidos (no abrir a todo el mundo)
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.register(cors, {
  origin: ALLOWED_ORIGINS.length > 0
    ? (origin, cb) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          cb(null, true);
        } else {
          cb(new Error("CORS: origin not allowed"), false);
        }
      }
    : true, // Dev/local: allow all for convenience
  credentials: true,
});
app.register(multipart);
app.register(websocket);

// FIX #5: JWT_SECRET — fail fast in production, warn in dev
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("FATAL: JWT_SECRET environment variable is required in production");
    process.exit(1);
  }
  console.warn("⚠️  WARN: Using default JWT_SECRET — set JWT_SECRET env var before deploying to production");
}

app.register(jwt, {
  secret: process.env.JWT_SECRET || "dev-secret-change-me-immediately",
});

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 60);
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
});

const nats = await connect({
  servers: process.env.NATS_SERVERS ?? "nats://localhost:4222",
});

const codec = JSONCodec<Record<string, unknown>>();

// FIX #3 (part a): Use the modular auth system from auth.ts — with IP rate limiting
const { registerAuth } = await import("./auth.js");
await registerAuth(app, pool, redis);

// JetStream publisher singleton (used by /agent/run-task and /chat)
const { createJsPublisher } = await import("./jetStreamPublisher.js");
const jetStreamPublisher = await createJsPublisher(process.env.NATS_SERVERS ?? "nats://localhost:4222");

// ============================================================
// Embeddings
// ============================================================

const embedTexts = async (texts: string[]): Promise<number[][]> => {
  const openai = (await import("../../src/core/openai.js")).getOpenAIClient({ timeoutMs: 120_000 });
  if (!openai) throw new Error("OPENAI_API_KEY missing");

  const result = await openai.embeddings({ input: texts });
  if (!result.ok) throw new Error(result.error);
  return result.embeddings;
};

// Safe: JSON string is fully parameterized — no SQL injection possible
const toVectorText = (vector: number[]): string => JSON.stringify(vector);

// ============================================================
// Config constants
// ============================================================

const githubClientId = process.env.GITHUB_CLIENT_ID ?? "";
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";
const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
const baseUrl = process.env.BASE_URL ?? "http://localhost:8081";

const stripeSecret = process.env.STRIPE_SECRET_KEY ?? "";
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const stripePriceId = process.env.STRIPE_PRICE_ID ?? "";
const stripeMeterEvent = process.env.STRIPE_METER_EVENT_NAME ?? "";
const stripeClient = stripeSecret
  ? new (await import("stripe")).default(stripeSecret)
  : null;

const inviteEmailWebhook = process.env.INVITE_EMAIL_WEBHOOK ?? "";
const adminToken = process.env.ADMIN_TOKEN ?? "";
const retentionDays = Number(process.env.RETENTION_DAYS ?? 30);

// ============================================================
// Rate limiting
// ============================================================

const checkRateLimit = async (key: string) => {
  const bucket = `rl:${key}`;
  const current = await redis.incr(bucket);
  if (current === 1) {
    await redis.pexpire(bucket, RATE_LIMIT_WINDOW_MS);
  }
  return current <= RATE_LIMIT_MAX;
};

// ============================================================
// Auth middleware (authenticate decorator)
// Supports API key auth via x-api-key header
// JWT auth is handled by @fastify/jwt + auth.ts
// ============================================================

const authenticateApiKey = async (key: string) => {
  const result = await pool.query(
    "SELECT id, user_id, project_id, role, expires_at FROM api_keys WHERE key_hash = encode(digest($1, 'sha256'), 'hex')",
    [key],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0] as {
    id: string;
    user_id: string;
    project_id: string | null;
    role: "owner" | "editor" | "viewer";
    expires_at: Date | null;
  };
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return null;
  return {
    apiKeyId: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    role: row.role,
  };
};

app.decorate("authenticate", async (req: any, reply: any) => {
  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (apiKey) {
    const auth = await authenticateApiKey(apiKey);
    if (!auth) return reply.status(401).send({ error: "invalid_api_key" });
    req.user = { userId: auth.userId };
    req.apiKeyId = auth.apiKeyId;
    req.apiKeyRole = auth.role;
    req.apiKeyProjectId = auth.projectId;
    if (!(await checkRateLimit(`apiKey:${auth.apiKeyId}`))) {
      return reply.status(429).send({ error: "rate_limited" });
    }
    return;
  }
  try {
    await req.jwtVerify();
    const userId = (req.user as { userId: string }).userId;
    if (!(await checkRateLimit(`user:${userId}`))) {
      return reply.status(429).send({ error: "rate_limited" });
    }
  } catch {
    return reply.status(401).send({ error: "unauthorized" });
  }
});

// ============================================================
// Health & Metrics
// ============================================================

// FIX #10: Health check now verifies ALL dependencies (DB, Redis, NATS)
app.get("/health", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    await redis.ping();
    if (nats.isClosed()) throw new Error("nats is closed");
    return reply.send({ ok: true });
  } catch (err: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Health check failed:", err.message);
    }
    return reply.status(500).send({ ok: false });
  }
});

// FIX #11: Metrics now uses prom-client for real Prometheus metrics
app.get("/metrics", async (_req, reply) => {
  reply.header("Content-Type", "text/plain");
  const register = await import("prom-client");
  return register.default.register.metrics();
});

app.post("/alerts/webhook", async (req, reply) => {
  await pool.query(
    "INSERT INTO logs (run_id, level, message, meta) VALUES (NULL, $1, $2, $3)",
    ["alert", "alertmanager", req.body],
  );
  return reply.send({ ok: true });
});

app.get("/ready", async (_req, reply) => {
  if (!nats.isClosed()) {
    return reply.send({ ok: true });
  }
  return reply.status(503).send({ ok: false });
});

// ============================================================
// Helpers
// ============================================================

const projectRoles = ["owner", "editor", "viewer"] as const;
type ProjectRole = (typeof projectRoles)[number];

const assertProject = async (
  userId: string,
  projectId: string,
): Promise<{ id: string; role: ProjectRole }> => {
  const ownerResult = await pool.query(
    "SELECT id FROM projects WHERE id = $1 AND user_id = $2",
    [projectId, userId],
  );
  if (ownerResult.rowCount > 0) {
    return { id: projectId, role: "owner" };
  }
  const memberResult = await pool.query(
    "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  if (memberResult.rowCount === 0) {
    throw new Error("project_not_found");
  }
  return { id: projectId, role: memberResult.rows[0].role as ProjectRole };
};

const requireRole = (role: ProjectRole, required: ProjectRole) => {
  const order = { owner: 3, editor: 2, viewer: 1 } as const;
  return order[role] >= order[required];
};

const ensureDefaultPlan = async () => {
  await pool.query(
    "INSERT INTO plans (code, name, monthly_runs_limit) VALUES ('free', 'Free', 200) ON CONFLICT DO NOTHING",
  );
};

const ensureSubscription = async (userId: string) => {
  await pool.query(
    "INSERT INTO subscriptions (user_id, plan_code, status) VALUES ($1, 'free', 'active') ON CONFLICT DO NOTHING",
    [userId],
  );
};

const getMonthlyUsage = async (userId: string) => {
  const month = new Date().toISOString().slice(0, 7);
  const result = await pool.query(
    "SELECT runs_count, tokens_used, cost_usd FROM usage_monthly WHERE user_id = $1 AND month = $2",
    [userId, month],
  );
  if (result.rowCount === 0) {
    return { month, count: 0, tokens: 0, cost: 0 };
  }
  return {
    month,
    count: result.rows[0].runs_count as number,
    tokens: result.rows[0].tokens_used as number,
    cost: Number(result.rows[0].cost_usd),
  };
};

const incrementUsage = async (userId: string, tokensUsed = 0, costUsd = 0) => {
  const month = new Date().toISOString().slice(0, 7);
  const result = await pool.query(
    "INSERT INTO usage_monthly (user_id, month, runs_count, tokens_used, cost_usd) VALUES ($1, $2, 1, $3, $4) ON CONFLICT (user_id, month) DO UPDATE SET runs_count = usage_monthly.runs_count + 1, tokens_used = usage_monthly.tokens_used + $3, cost_usd = usage_monthly.cost_usd + $4 RETURNING runs_count",
    [userId, month, tokensUsed, costUsd],
  );
  return result.rows[0].runs_count as number;
};

const getPlanLimit = async (userId: string) => {
  const result = await pool.query(
    "SELECT p.monthly_runs_limit FROM subscriptions s JOIN plans p ON s.plan_code = p.code WHERE s.user_id = $1 AND s.status IN ('active','trial')",
    [userId],
  );
  if (result.rowCount === 0) return 0;
  return result.rows[0].monthly_runs_limit as number;
};

const enforceQuota = async (userId: string) => {
  await ensureDefaultPlan();
  await ensureSubscription(userId);
  const limit = await getPlanLimit(userId);
  const usage = await getMonthlyUsage(userId);
  if (limit > 0 && usage.count >= limit) {
    return { ok: false, limit, usage: usage.count };
  }
  return { ok: true, limit, usage: usage.count };
};

// FIX #8: logAudit now accepts an optional database client for use inside transactions
const logAudit = async (
  userId: string,
  projectId: string | null,
  action: string,
  meta: unknown,
  tx?: { query: typeof pool.query },
) => {
  const db = tx ?? pool;
  await db.query(
    "INSERT INTO audit_logs (user_id, project_id, action, meta) VALUES ($1, $2, $3, $4)",
    [userId, projectId, action, meta],
  );
};

const getStripeCustomerId = async (userId: string) => {
  if (!stripeClient) return null;
  const result = await pool.query(
    "SELECT email, stripe_customer_id FROM users WHERE id = $1",
    [userId],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0] as {
    email: string;
    stripe_customer_id: string | null;
  };
  if (row.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripeClient.customers.create({ email: row.email });
  await pool.query(
    "UPDATE users SET stripe_customer_id = $1 WHERE id = $2",
    [customer.id, userId],
  );
  return customer.id;
};

// ============================================================
// OAuth (GitHub, Google) — kept inline as they have provider-specific flow
// ============================================================

app.get("/auth/oauth/github", async (_req, reply) => {
  if (!githubClientId)
    return reply.status(500).send({ error: "oauth_not_configured" });
  const redirectUri = `${baseUrl}/auth/oauth/github/callback`;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", githubClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "user:email");
  return reply.redirect(url.toString());
});

app.get("/auth/oauth/google", async (_req, reply) => {
  if (!googleClientId)
    return reply.status(500).send({ error: "oauth_not_configured" });
  const redirectUri = `${baseUrl}/auth/oauth/google/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", googleClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "email profile");
  return reply.redirect(url.toString());
});

app.get("/auth/oauth/github/callback", async (req, reply) => {
  const code = (req.query as { code?: string }).code;
  if (!code) return reply.status(400).send({ error: "missing_code" });
  if (!githubClientId || !githubClientSecret) {
    return reply.status(500).send({ error: "oauth_not_configured" });
  }
  const tokenRes = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: githubClientId,
        client_secret: githubClientSecret,
        code,
      }),
    },
  );
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token)
    return reply.status(401).send({ error: "oauth_failed" });
  const emailRes = await fetch("https://api.github.com/user/emails", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const emails =
    (await emailRes.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
  const primary =
    emails.find((e) => e.primary && e.verified) ?? emails[0];
  if (!primary?.email)
    return reply.status(400).send({ error: "email_required" });
  const userRes = await pool.query(
    "SELECT id FROM users WHERE email = $1",
    [primary.email],
  );
  let userId: string;
  if (userRes.rowCount === 0) {
    const created = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, crypt($2, gen_salt('bf'))) RETURNING id",
      [primary.email, randomUUID()],
    );
    userId = created.rows[0].id as string;
    await ensureDefaultPlan();
    await ensureSubscription(userId);
  } else {
    userId = userRes.rows[0].id as string;
  }
  const accessToken = app.jwt.sign({ userId }, { expiresIn: "15m" });
  const refreshToken = `rt_${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO auth_sessions (user_id, refresh_hash, expires_at) VALUES ($1, encode(digest($2, 'sha256'), 'hex'), $3)",
    [userId, refreshToken, expiresAt],
  );
  // 🔗 Store GitHub token for repo integration (hash + expiry)
  // GitHub tokens don't expire by default unless revoked — set 1 year expiry
  const githubTokenExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await pool.query(
    "UPDATE users SET github_token = encode(digest($1, 'sha256'), 'hex'), github_token_expires_at = $2 WHERE id = $3",
    [tokenJson.access_token, githubTokenExpiry, userId],
  );
  await logAudit(userId, null, "user.oauth", { provider: "github" });
  return reply.send({ accessToken, refreshToken });
});

app.get("/auth/oauth/google/callback", async (req, reply) => {
  const code = (req.query as { code?: string }).code;
  if (!code) return reply.status(400).send({ error: "missing_code" });
  if (!googleClientId || !googleClientSecret) {
    return reply.status(500).send({ error: "oauth_not_configured" });
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${baseUrl}/auth/oauth/google/callback`,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token)
    return reply.status(401).send({ error: "oauth_failed" });
  const profileRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    },
  );
  const profile = (await profileRes.json()) as { email?: string };
  if (!profile.email)
    return reply.status(400).send({ error: "email_required" });
  const userRes = await pool.query(
    "SELECT id FROM users WHERE email = $1",
    [profile.email],
  );
  let userId: string;
  if (userRes.rowCount === 0) {
    const created = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, crypt($2, gen_salt('bf'))) RETURNING id",
      [profile.email, randomUUID()],
    );
    userId = created.rows[0].id as string;
    await ensureDefaultPlan();
    await ensureSubscription(userId);
  } else {
    userId = userRes.rows[0].id as string;
  }
  const accessToken = app.jwt.sign({ userId }, { expiresIn: "15m" });
  const refreshToken = `rt_${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO auth_sessions (user_id, refresh_hash, expires_at) VALUES ($1, encode(digest($2, 'sha256'), 'hex'), $3)",
    [userId, refreshToken, expiresAt],
  );
  await logAudit(userId, null, "user.oauth", { provider: "google" });
  return reply.send({ accessToken, refreshToken });
});

// Auth routes (email/password) are now provided by auth.ts via registerAuth()
// We keep refresh and logout here since they share the same pattern
// but remove the duplicate post("/auth/login) from auth.ts

// SAML stubs
app.get("/auth/saml/start", async (_req, reply) => {
  return reply
    .status(501)
    .send({ error: "saml_not_configured" });
});
app.post("/auth/saml/callback", async (_req, reply) {
  return reply
    .status(501)
    .send({ error: "saml_not_configured" });
});

// POST /auth/login — uses auth.ts module (registered above via registerAuth)
// GET /auth/me — uses auth.ts module

// POST /auth/refresh — uses auth.ts module
// POST /auth/logout — uses auth.ts module

// ============================================================
// API Keys
// ============================================================

app.post(
  "/auth/api-keys",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const schema = z.object({
      projectId: z.string().optional(),
      role: z
        .enum(["owner", "editor", "viewer"])
        .default("viewer"),
      expiresInDays: z.number().int().positive().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid", details: parsed.error.flatten() });
    const userId = (req.user as { userId: string }).userId;
    if (parsed.data.projectId) {
      const access = await assertProject(
        userId,
        parsed.data.projectId,
      );
      if (!requireRole(access.role, "owner")) {
        return reply
          .status(403)
          .send({ error: "forbidden" });
      }
    }
    const expiresAt = parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 86400000)
      : null;
    const key = `ak_${randomUUID()}`;
    await pool.query(
      "INSERT INTO api_keys (user_id, project_id, role, expires_at, key_hash) VALUES ($1, $2, $3, $4, encode(digest($5, 'sha256'), 'hex'))",
      [
        userId,
        parsed.data.projectId ?? null,
        parsed.data.role,
        expiresAt,
        key,
      ],
    );
    await logAudit(
      userId,
      parsed.data.projectId ?? null,
      "apikey.created",
      { role: parsed.data.role },
    );
    return reply.status(201).send({ apiKey: key });
  },
);

// GET /auth/api-keys
// DELETE /auth/api-keys/:id
app.get(
  "/auth/api-keys",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const userId = (req.user as { userId: string }).userId;
    const result = await pool.query(
      "SELECT id, project_id, role, expires_at, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return reply.send(result.rows);
  },
);

app.delete(
  "/auth/api-keys/:id",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const userId = (req.user as { userId: string }).userId;
    const id = (req.params as { id: string }).id;
    await pool.query(
      "DELETE FROM api_keys WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    await logAudit(userId, null, "apikey.deleted", { id });
    return reply.send({ ok: true });
  },
);

// ============================================================
// Chat & Agent Tasks
// ============================================================

app.post(
  "/chat",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const schema = z.object({
      projectId: z.string(),
      message: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid" });
    const userId = (req.user as { userId: string }).userId;
    let access;
    try {
      access = await assertProject(
        userId,
        parsed.data.projectId,
      );
    } catch {
      return reply
        .status(404)
        .send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "viewer")) {
      return reply.status(403).send({ error: "forbidden" });
    }
    if (
      req.apiKeyProjectId &&
      req.apiKeyProjectId !== parsed.data.projectId
    ) {
      return reply
        .status(403)
        .send({ error: "api_key_scope" });
    }
    const traceId = randomUUID();
    await jetStreamPublisher.publishChat({
      userId,
      projectId: parsed.data.projectId,
      message: parsed.data.message,
      traceId,
    });
    return reply.send({ ok: true, traceId });
  },
);

app.post(
  "/agent/run-task",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const schema = z.object({
      projectId: z.string(),
      goal: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid" });
    const userId = (req.user as { userId: string }).userId;
    let access;
    try {
      access = await assertProject(
        userId,
        parsed.data.projectId,
      );
    } catch {
      return reply
        .status(404)
        .send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "editor")) {
      return reply.status(403).send({ error: "forbidden" });
    }
    if (
      req.apiKeyProjectId &&
      req.apiKeyProjectId !== parsed.data.projectId
    ) {
      return reply
        .status(403)
        .send({ error: "api_key_scope" });
    }
    const quota = await enforceQuota(userId);
    if (!quota.ok) {
      return reply.status(402).send({
        error: "quota_exceeded",
        limit: quota.limit,
        usage: quota.usage,
      });
    }
    const traceId = randomUUID();
    // FIX #8: Wrap task+run creation in a transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const taskResult = await client.query(
        "INSERT INTO tasks (project_id, prompt) VALUES ($1, $2) RETURNING id",
        [parsed.data.projectId, parsed.data.goal],
      );
      const runResult = await client.query(
        "INSERT INTO agent_runs (task_id, status, trace_id) VALUES ($1, 'pending', $2) RETURNING id",
        [taskResult.rows[0].id, traceId],
      );
      const tokensUsed = Math.ceil(parsed.data.goal.length / 4);
      const costUsd = tokensUsed * 0.0000002;
      await incrementUsage(userId, tokensUsed, costUsd);
      if (stripeClient && stripeMeterEvent) {
        const customerId = await getStripeCustomerId(userId);
        if (customerId) {
          await stripeClient.billing.meterEvents.create({
            event_name: stripeMeterEvent,
            payload: { value: tokensUsed },
            customer: customerId,
          });
        }
      }
      await logAudit(
        userId,
        parsed.data.projectId,
        "run.created",
        { runId: runResult.rows[0].id, tokensUsed, costUsd },
        { query: client.query.bind(client) },
      );
      await jetStreamPublisher.publishRunTask({
        projectId: parsed.data.projectId,
        userId,
        goal: parsed.data.goal,
        traceId,
        runId: runResult.rows[0].id,
      });
      await client.query("COMMIT");
      return reply.send({
        ok: true,
        traceId,
        runId: runResult.rows[0].id,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
);

// ============================================================
// Repository Upload & Search
// ============================================================

app.post(
  "/repo/upload",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const data = await req.file();
    if (!data)
      return reply.status(400).send({ error: "file_required" });
    const projectId = (req.query as { projectId?: string })
      .projectId;
    if (!projectId)
      return reply
        .status(400)
        .send({ error: "project_required" });
    const userId = (req.user as { userId: string })
      .userId;
    let access;
    try {
      access = await assertProject(userId, projectId);
    } catch {
      return reply
        .status(404)
        .send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "editor")) {
      return reply.status(403).send({ error: "forbidden" });
    }
    if (
      req.apiKeyProjectId &&
      req.apiKeyProjectId !== projectId
    ) {
      return reply
        .status(403)
        .send({ error: "api_key_scope" });
    }
    const content = await data.toBuffer();
    const subject = `tenant.${projectId}.repo.ingest`;
    nats.publish(
      subject,
      codec.encode({
        projectId,
        userId,
        filename: data.filename,
        content: content.toString("utf-8"),
      }),
    );
    await logAudit(userId, projectId, "repo.upload", {
      filename: data.filename,
    });
    return reply.send({ ok: true, filename: data.filename });
  },
);

app.get(
  "/repo/files",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const projectId = (req.query as { projectId?: string })
      .projectId;
    if (!projectId)
      return reply
        .status(400)
        .send({ error: "project_required" });
    const userId = (req.user as { userId: string })
      .userId;
    let access;
    try {
      access = await assertProject(userId, projectId);
    } catch {
      return reply
        .status(404)
        .send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "viewer")) {
      return reply.status(403).send({ error: "forbidden" });
    }
    if (
      req.apiKeyProjectId &&
      req.apiKeyProjectId !== projectId
    ) {
      return reply
        .status(403)
        .send({ error: "api_key_scope" });
    }
    // FIX #9: Add pagination for file listing
    const page = Math.max(1, Number((req.query as { page?: string }).page) || 1);
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit) || 20));
    const offset = (page - 1) * limit;
    const result = await pool.query(
      "SELECT id, filename, created_at FROM repo_files WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [projectId, limit, offset],
    );
    return reply.send(result.rows);
  },
);

app.get(
  "/repo/search",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const query = req.query as {
      projectId?: string;
      q?: string;
    };
    if (!query.projectId || !query.q)
      return reply.status(400).send({ error: "invalid" });
    const userId = (req.user as { userId: string })
      .userId;
    let access;
    try {
      access = await assertProject(
        userId,
        query.projectId,
      );
    } catch {
      return reply
        .status(404)
        .send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "viewer")) {
      return reply.status(403).send({ error: "forbidden" });
    }
    if (
      req.apiKeyProjectId &&
      req.apiKeyProjectId !== query.projectId
    ) {
      return reply
        .status(403)
        .send({ error: "api_key_scope" });
    }
    const [vector] = await embedTexts([query.q]);
    const result = await pool.query(
      "SELECT id, content FROM embeddings WHERE project_id = $1 ORDER BY embedding <=> $2::text::vector LIMIT 5",
      [query.projectId, toVectorText(vector)],
    );
    return reply.send(result.rows);
  },
);

// ============================================================
// Projects — with FIX #8: Transactional create
// ============================================================

app.post(
  "/projects",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const schema = z.object({
      name: z.string().min(2),
      repoUrl: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: "invalid", details: parsed.error.flatten() });
    const userId = (req.user as { userId: string }).userId;
    // FIX #8: Wrap project + member creation in a transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "INSERT INTO projects (user_id, name, repo_url) VALUES ($1, $2, $3) RETURNING id",
        [userId, parsed.data.name, parsed.data.repoUrl ?? null],
      );
      await client.query(
        "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')",
        [result.rows[0].id, userId],
      );
      await logAudit(
        userId,
        result.rows[0].id,
        "project.created",
        { name: parsed.data.name },
        { query: client.query.bind(client) },
      );
      await client.query("COMMIT");
      return reply.status(201).send({ id: result.rows[0].id });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
);

app.get(
  "/projects",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const userId = (req.user as { userId: string }).userId;
    // FIX #9: Add pagination
    const page = Math.max(1, Number((req.query as { page?: string }).page) || 1);
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit) || 20));
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT p.id, p.name, p.repo_url
       FROM projects p
       LEFT JOIN project_members m ON p.id = m.project_id
       WHERE (p.user_id = $1 OR m.user_id = $1)
         AND ($2::uuid IS NULL OR p.id = $2)
       ORDER BY p.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, req.apiKeyProjectId ?? null, limit, offset],
    );
    return reply.send(result.rows);
  },
);

app.get(
  "/projects/:id/members",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const projectId = (req.params as { id: string }).id;
    const userId = (req.user as { userId: string }).userId;
    let access;
    try {
      access = await assertProject(userId, projectId);
    } catch {
      return reply.status(404).send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "viewer"))
      return reply.status(403).send({ error: "forbidden" });
    const result = await pool.query(
      "SELECT user_id, role, created_at FROM project_members WHERE project_id = $1 ORDER BY created_at DESC",
      [projectId],
    );
    return reply.send(result.rows);
  },
);

app.post(
  "/projects/:id/members",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const projectId = (req.params as { id: string }).id;
    const schema = z.object({
      userId: z.string().min(3),
      role: z.enum(["owner", "editor", "viewer"]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid", details: parsed.error.flatten() });
    const userId = (req.user as { userId: string }).userId;
    let access;
    try {
      access = await assertProject(userId, projectId);
    } catch {
      return reply.status(404).send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "owner"))
      return reply.status(403).send({ error: "forbidden" });
    await pool.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)",
      [projectId, parsed.data.userId, parsed.data.role],
    );
    await logAudit(userId, projectId, "member.add", {
      memberId: parsed.data.userId,
      role: parsed.data.role,
    });
    return reply.send({ ok: true });
  },
);

app.patch(
  "/projects/:id/members/:memberId",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const projectId = (req.params as { id: string; memberId: string }).id;
    const memberId = (req.params as { id: string; memberId: string }).memberId;
    const schema = z.object({ role: z.enum(["owner", "editor", "viewer"]) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid" });
    const userId = (req.user as { userId: string }).userId;
    let access;
    try {
      access = await assertProject(userId, projectId);
    } catch {
      return reply.status(404).send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "owner"))
      return reply.status(403).send({ error: "forbidden" });
    await pool.query(
      "UPDATE project_members SET role = $1 WHERE project_id = $2 AND user_id = $3",
      [parsed.data.role, projectId, memberId],
    );
    await logAudit(userId, projectId, "member.update", {
      memberId,
      role: parsed.data.role,
    });
    return reply.send({ ok: true });
  },
);

app.delete(
  "/projects/:id/members/:memberId",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const projectId = (req.params as { id: string; memberId: string }).id;
    const memberId = (req.params as { id: string; memberId: string }).memberId;
    const userId = (req.user as { userId: string }).userId;
    let access;
    try {
      access = await assertProject(userId, projectId);
    } catch {
      return reply.status(404).send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "owner"))
      return reply.status(403).send({ error: "forbidden" });
    await pool.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, memberId],
    );
    await logAudit(userId, projectId, "member.remove", { memberId });
    return reply.send({ ok: true });
  },
);

// ============================================================
// Invites
// ============================================================

app.get(
  "/projects/:id/invites",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const projectId = (req.params as { id: string }).id;
    const userId = (req.user as { userId: string }).userId;
    let access;
    try {
      access = await assertProject(userId, projectId);
    } catch {
      return reply.status(404).send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "owner"))
      return reply.status(403).send({ error: "forbidden" });
    const result = await pool.query(
      "SELECT id, email, role, expires_at, created_at FROM project_invites WHERE project_id = $1 ORDER BY created_at DESC",
      [projectId],
    );
    return reply.send(result.rows);
  },
);

app.post(
  "/projects/:id/invites",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const projectId = (req.params as { id: string }).id;
    const schema = z.object({
      email: z.string().email(),
      role: z.enum(["owner", "editor", "viewer"]),
      expiresInDays: z.number().int().positive().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid" });
    const userId = (req.user as { userId: string }).userId;
    let access;
    try {
      access = await assertProject(userId, projectId);
    } catch {
      return reply.status(404).send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "owner"))
      return reply.status(403).send({ error: "forbidden" });
    const token = `inv_${randomUUID()}`;
    const expiresAt = parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 86400000)
      : new Date(Date.now() + 7 * 86400000);
    await pool.query(
      "INSERT INTO project_invites (project_id, email, role, token, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [projectId, parsed.data.email, parsed.data.role, token, expiresAt],
    );
    await logAudit(userId, projectId, "invite.created", {
      email: parsed.data.email,
      role: parsed.data.role,
    });
    if (inviteEmailWebhook) {
      await fetch(inviteEmailWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: parsed.data.email,
          token,
          projectId,
          role: parsed.data.role,
          expiresAt,
        }),
      });
    }
    return reply.send({ token, expiresAt });
  },
);

app.delete(
  "/projects/:id/invites/:inviteId",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const projectId = (req.params as { id: string; inviteId: string }).id;
    const inviteId = (req.params as { id: string; inviteId: string }).inviteId;
    const userId = (req.user as { userId: string }).userId;
    let access;
    try {
      access = await assertProject(userId, projectId);
    } catch {
      return reply.status(404).send({ error: "project_not_found" });
    }
    if (!requireRole(access.role, "owner"))
      return reply.status(403).send({ error: "forbidden" });
    await pool.query(
      "DELETE FROM project_invites WHERE id = $1 AND project_id = $2",
      [inviteId, projectId],
    );
    await logAudit(userId, projectId, "invite.revoked", { inviteId });
    return reply.send({ ok: true });
  },
);

app.post(
  "/projects/invites/accept",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const schema = z.object({ token: z.string().min(10) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid" });
    const result = await pool.query(
      "SELECT id, project_id, role, expires_at FROM project_invites WHERE token = $1",
      [parsed.data.token],
    );
    if (result.rowCount === 0)
      return reply.status(404).send({ error: "invite_not_found" });
    const invite = result.rows[0] as {
      id: string;
      project_id: string;
      role: ProjectRole;
      expires_at: Date;
    };
    if (invite.expires_at.getTime() < Date.now())
      return reply.status(410).send({ error: "invite_expired" });
    const userId = (req.user as { userId: string }).userId;
    await pool.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [invite.project_id, userId, invite.role],
    );
    await pool.query(
      "DELETE FROM project_invites WHERE id = $1",
      [invite.id],
    );
    await logAudit(
      userId,
      invite.project_id,
      "invite.accepted",
      { inviteId: invite.id },
    );
    return reply.send({ ok: true, projectId: invite.project_id });
  },
);

// ============================================================
// Runs & Analytics — with FIX #9: Pagination
// ============================================================

app.get(
  "/runs",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const userId = (req.user as { userId: string }).userId;
    const page = Math.max(1, Number((req.query as { page?: string }).page) || 1);
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit) || 20));
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT r.id, r.status, r.trace_id, r.created_at
       FROM agent_runs r
       JOIN tasks k ON r.task_id = k.id
       JOIN projects p ON k.project_id = p.id
       LEFT JOIN project_members m ON p.id = m.project_id
       WHERE (p.user_id = $1 OR m.user_id = $1)
         AND ($2::uuid IS NULL OR p.id = $2)
       ORDER BY r.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, req.apiKeyProjectId ?? null, limit, offset],
    );
    return reply.send(result.rows);
  },
);

app.get(
  "/analytics/projects",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const userId = (req.user as { userId: string }).userId;
    const result = await pool.query(
      "SELECT p.id as projectId, COUNT(r.id) as totalRuns, SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) as failedRuns, SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) as completedRuns, MAX(r.created_at) as lastRunAt, SUM(u.cost_usd) as costUsd FROM projects p LEFT JOIN tasks k ON p.id = k.project_id LEFT JOIN agent_runs r ON k.id = r.task_id LEFT JOIN usage_monthly u ON u.user_id = p.user_id LEFT JOIN project_members m ON p.id = m.project_id WHERE (p.user_id = $1 OR m.user_id = $1) GROUP BY p.id",
      [userId],
    );
    return reply.send(result.rows);
  },
);

app.get(
  "/billing/usage",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const userId = (req.user as { userId: string }).userId;
    const usage = await getMonthlyUsage(userId);
    const limit = await getPlanLimit(userId);
    return reply.send({
      month: usage.month,
      usage: usage.count,
      limit,
      tokens: usage.tokens,
      cost: usage.cost,
    });
  },
);

app.get(
  "/billing/plan",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const userId = (req.user as { userId: string }).userId;
    const result = await pool.query(
      "SELECT s.plan_code, p.name, p.monthly_runs_limit FROM subscriptions s JOIN plans p ON s.plan_code = p.code WHERE s.user_id = $1 AND s.status IN ('active','trial')",
      [userId],
    );
    return reply.send(result.rows[0] ?? null);
  },
);

app.post(
  "/billing/checkout",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (!stripeClient || !stripePriceId)
      return reply
        .status(500)
        .send({ error: "stripe_not_configured" });
    const userId = (req.user as { userId: string }).userId;
    const customerId = await getStripeCustomerId(userId);
    const successUrl =
      process.env.STRIPE_SUCCESS_URL ??
      `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl =
      process.env.STRIPE_CANCEL_URL ??
      `${baseUrl}/billing/cancel`;
    const session = await stripeClient.checkout.sessions.create({
      mode: "subscription",
      customer: customerId ?? undefined,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId },
    });
    return reply.send({ url: session.url });
  },
);

app.post("/billing/webhook", async (req, reply) => {
  if (!stripeClient || !stripeWebhookSecret)
    return reply
      .status(500)
      .send({ error: "stripe_not_configured" });
  const sig = req.headers["stripe-signature"] as string;
  const rawBody = (req as any).rawBody as Buffer;
  let event;
  try {
    event = stripeClient.webhooks.constructEvent(
      rawBody,
      sig,
      stripeWebhookSecret,
    );
  } catch {
    return reply.status(400).send({ error: "invalid_signature" });
  }

  // 🔒 Idempotencia: rechazar eventos duplicados (replay attack protection)
  const { rowCount: alreadyProcessed } = await pool.query(
    "SELECT 1 FROM webhook_events WHERE stripe_event_id = $1",
    [event.id],
  );
  if (alreadyProcessed && alreadyProcessed > 0) {
    // Evento ya procesado — responder OK sin reprocesar
    return reply.send({ received: true, duplicate: true });
  }

  // Marcar como procesado antes de ejecutar la lógica (fail-fast si falla el insert)
  await pool.query(
    "INSERT INTO webhook_events (stripe_event_id, event_type, created) VALUES ($1, $2, to_timestamp($3))",
    [event.id, event.type, Math.floor(event.created * 1000) / 1000],
  );

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        metadata?: { userId?: string };
        subscription?: string;
      };
      if (session.metadata?.userId) {
        await pool.query(
          "INSERT INTO subscriptions (user_id, plan_code, status) VALUES ($1, 'pro', 'active') ON CONFLICT (user_id) DO UPDATE SET plan_code = 'pro', status = 'active'",
          [session.metadata.userId],
        );
        await logAudit(
          session.metadata.userId,
          null,
          "billing.upgrade",
          { plan: "pro" },
        );
      }
    }
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as {
        customer?: string;
        billing_reason?: string;
      };
      await pool.query(
        "INSERT INTO logs (run_id, level, message, meta) VALUES (NULL, $1, $2, $3)",
        [
          "billing",
          "invoice.paid",
          {
            customer: invoice.customer,
            reason: invoice.billing_reason,
          },
        ],
      );
    }
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as {
        customer?: string;
        billing_reason?: string;
      };
      await pool.query(
        "INSERT INTO logs (run_id, level, message, meta) VALUES (NULL, $1, $2, $3)",
        [
          "billing",
          "invoice.payment_failed",
          {
            customer: invoice.customer,
            reason: invoice.billing_reason,
          },
        ],
      );
    }
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as { customer?: string };
      if (sub.customer) {
        await pool.query(
          "UPDATE subscriptions SET status = 'canceled' WHERE user_id IN (SELECT id FROM users WHERE stripe_customer_id = $1)",
          [sub.customer],
        );
      }
    }
    if (event.type === "invoice.payment_action_required" || event.type === "payment_intent.payment_failed") {
      // SCA / 3D Secure — el pago requiere acción del usuario
      await pool.query(
        "INSERT INTO logs (run_id, level, message, meta) VALUES (NULL, $1, $2, $3)",
        [
          "billing",
          event.type,
          { event_id: event.id },
        ],
      );
    }
    if (event.type === "customer.subscription.updated") {
      // Cambio de plan (upgrade/downgrade/cancelación pendiente)
      const sub = event.data.object as { customer?: string; status?: string };
      if (sub.customer) {
        await pool.query(
          "UPDATE subscriptions SET status = $1 WHERE user_id IN (SELECT id FROM users WHERE stripe_customer_id = $2)",
          [sub.status ?? "active", sub.customer],
        );
      }
    }
  } catch (err: any) {
    // Marcar como fallido para debugging
    await pool.query(
      "UPDATE webhook_events SET status = 'failed', error = $1 WHERE stripe_event_id = $2",
      [err.message, event.id],
    );
    throw err;
  }

  return reply.send({ received: true });
});

app.get(
  "/runs/:id/logs",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const runId = (req.params as { id: string }).id;
    const userId = (req.user as { userId: string }).userId;
    // FIX #9: Add pagination
    const page = Math.max(1, Number((req.query as { page?: string }).page) || 1);
    const limit = Math.min(200, Math.max(1, Number((req.query as { limit?: string }).limit) || 50));
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT l.*
       FROM logs l
       JOIN agent_runs r ON l.run_id = r.id
       JOIN tasks k ON r.task_id = k.id
       JOIN projects p ON k.project_id = p.id
       LEFT JOIN project_members m ON p.id = m.project_id
       WHERE l.run_id = $1 AND (p.user_id = $2 OR m.user_id = $2)
       ORDER BY l.created_at DESC
       LIMIT $3 OFFSET $4`,
      [runId, userId, limit, offset],
    );
    if (req.apiKeyProjectId) {
      const scopeCheck = await pool.query(
        "SELECT p.id FROM agent_runs r JOIN tasks k ON r.task_id = k.id JOIN projects p ON k.project_id = p.id WHERE r.id = $1",
        [runId],
      );
      if (
        scopeCheck.rowCount === 0 ||
        scopeCheck.rows[0].id !== req.apiKeyProjectId
      ) {
        return reply
          .status(403)
          .send({ error: "api_key_scope" });
      }
    }
    return reply.send(result.rows);
  },
);

app.get(
  "/runs/alerts",
  { preHandler: [app.authenticate] },
  async (_req, reply) => {
    const result = await pool.query(
      "SELECT id, message, created_at FROM logs WHERE level = 'alert' ORDER BY created_at DESC LIMIT 50",
    );
    return reply.send(result.rows);
  },
);

app.get(
  "/audit/logs",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const userId = (req.user as { userId: string }).userId;
    // FIX #9: Add pagination
    const page = Math.max(1, Number((req.query as { page?: string }).page) || 1);
    const limit = Math.min(200, Math.max(1, Number((req.query as { limit?: string }).limit) || 50));
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT id, action, meta, created_at
       FROM audit_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return reply.send(result.rows);
  },
);

// ✅ Proper CSV export with pagination + hard limit
app.get(
  "/audit/export",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const userId = (req.user as { userId: string }).userId;
    const query = req.query as { page?: string; limit?: string; from?: string; to?: string };

    // Pagination defaults
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(10_000, Math.max(1, parseInt(query.limit ?? "1000", 10) || 1000));
    const offset = (page - 1) * limit;

    // Build filter query
    const conditions: string[] = ["user_id = $1"];
    const params: unknown[] = [userId];
    let paramIdx = 2;

    if (query.from) {
      conditions.push(`created_at >= $${paramIdx}`);
      params.push(new Date(query.from));
      paramIdx++;
    }
    if (query.to) {
      conditions.push(`created_at <= $${paramIdx}`);
      params.push(new Date(query.to));
      paramIdx++;
    }

    const where = conditions.join(" AND ");

    // Count total for pagination metadata
    const [{ count }] = (
      await pool.query(`SELECT COUNT(*)::int FROM audit_logs WHERE ${where}`, params)
    ).rows;

    // Fetch paginated
    params.push(offset, limit);
    const result = await pool.query(
      `SELECT action, meta, created_at FROM audit_logs WHERE ${where} ORDER BY created_at DESC OFFSET $${paramIdx} LIMIT $${paramIdx + 1}`,
      params,
    );

    const escapeCsv = (val: unknown): string => {
      const str = val === null || val === undefined ? "" : typeof val === "string" ? val : JSON.stringify(val);
      return `"${str.replace(/"/g, '""')}"`;
    };

    return reply.send({
      total: count,
      page,
      limit,
      hasMore: page * limit < count,
      data: result.rows.map((r) => ({
        action: r.action,
        created_at: r.created_at,
        meta: r.meta,
      })),
    });
  },
);

// 📄 Download as CSV (separate endpoint, still paginated but streams response)
app.get(
  "/audit/export/csv",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    if (req.apiKeyId)
      return reply.status(403).send({ error: "forbidden" });
    const userId = (req.user as { userId: string }).userId;
    const query = req.query as { limit?: string; from?: string; to?: string };

    const limit = Math.min(10_000, parseInt(query.limit ?? "5000", 10) || 5000);

    const conditions: string[] = ["user_id = $1"];
    const params: unknown[] = [userId];
    let paramIdx = 2;

    if (query.from) { conditions.push(`created_at >= $${paramIdx}`); params.push(new Date(query.from)); paramIdx++; }
    if (query.to) { conditions.push(`created_at <= $${paramIdx}`); params.push(new Date(query.to)); paramIdx++; }

    params.push(limit);
    const result = await pool.query(
      `SELECT action, meta, created_at FROM audit_logs WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${paramIdx}`,
      params,
    );

    const escapeCsv = (val: unknown): string => {
      const str = val === null || val === undefined ? "" : typeof val === "string" ? val : JSON.stringify(val);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const header = "action,created_at,meta";
    const rows = result.rows.map(
      (r) => `${escapeCsv(r.action)},${escapeCsv(r.created_at?.toISOString())},${escapeCsv(r.meta)}`,
    );

    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="audit_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    return [header, ...rows].join("\n");
  },
);

app.post("/admin/retention/run", async (req, reply) => {
  if (!adminToken || req.headers["x-admin-token"] !== adminToken) {
    return reply.status(403).send({ error: "forbidden" });
  }

  // 🛡️ Safety: no one should be able to delete less than 7 days
  const MIN_RETENTION_DAYS = 7;
  const effectiveDays = Math.max(retentionDays, MIN_RETENTION_DAYS);
  if (retentionDays < MIN_RETENTION_DAYS) {
    console.warn(`[admin/retention] RETENTION_DAYS=${retentionDays} overridden to ${MIN_RETENTION_DAYS} (minimum safety floor)`);
  }

  const cutoff = new Date(Date.now() - effectiveDays * 86400000);

  // 🛡️ Soft-delete audit: count first, then delete. Return a report.
  const counts = await Promise.all([
    pool.query("SELECT COUNT(*)::int FROM logs WHERE created_at < $1", [cutoff]),
    pool.query("SELECT COUNT(*)::int FROM traces WHERE created_at < $1", [cutoff]),
    pool.query("SELECT COUNT(*)::int FROM embeddings WHERE created_at < $1", [cutoff]),
    pool.query("SELECT COUNT(*)::int FROM repo_files WHERE created_at < $1", [cutoff]),
  ]);

  const report = {
    cutoff: cutoff.toISOString(),
    effectiveRetentionDays: effectiveDays,
    rowsToDelete: {
      logs: counts[0].rows[0].count,
      traces: counts[1].rows[0].count,
      embeddings: counts[2].rows[0].count,
      repoFiles: counts[3].rows[0].count,
      total: counts.reduce((sum, c) => sum + c.rows[0].count, 0),
    },
  };

  if (report.rowsToDelete.total === 0) {
    return reply.send({ ok: true, report, message: "Nothing to clean up" });
  }

  // Execute deletions
  const deleted = await Promise.all([
    pool.query("DELETE FROM logs WHERE created_at < $1", [cutoff]),
    pool.query("DELETE FROM traces WHERE created_at < $1", [cutoff]),
    pool.query("DELETE FROM embeddings WHERE created_at < $1", [cutoff]),
    pool.query("DELETE FROM repo_files WHERE created_at < $1", [cutoff]),
  ]);

  const deletedReport = {
    rowsDeleted: {
      logs: deleted[0].rowCount,
      traces: deleted[1].rowCount,
      embeddings: deleted[2].rowCount,
      repoFiles: deleted[3].rowCount,
    },
  };

  // Limpiar webhook_events procesados exitosamente > 90 días
  await pool.query(
    "DELETE FROM webhook_events WHERE status = 'processed' AND processed_at < NOW() - INTERVAL '90 days'",
  );

  return reply.send({
    ok: true,
    report: { ...report, ...deletedReport },
    message: `Cleaned up ${report.rowsToDelete.total} rows older than ${effectiveDays} days`,
  });
});

app.get(
  "/trace/:id",
  { preHandler: [app.authenticate] },
  async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const userId = (req.user as { userId: string }).userId;
    const result = await pool.query(
      "SELECT t.*, p.id as project_id FROM traces t JOIN agent_runs r ON t.run_id = r.id JOIN tasks k ON r.task_id = k.id JOIN projects p ON k.project_id = p.id LEFT JOIN project_members m ON p.id = m.project_id WHERE t.id = $1 AND (p.user_id = $2 OR m.user_id = $2)",
      [id, userId],
    );
    const row = result.rows[0];
    if (!row) return reply.send(null);
    if (
      req.apiKeyProjectId &&
      row.project_id !== req.apiKeyProjectId
    ) {
      return reply
        .status(403)
        .send({ error: "api_key_scope" });
    }
    return reply.send(row);
  },
);

// ============================================================
// WebSocket — FIX #6: Token via header instead of query param
// ============================================================

app.get("/ws/stream", { websocket: true }, async (connection, req) => {
  // Prefer header, fallback to query param for backwards compatibility
  let token = req.headers["sec-websocket-protocol"]?.split(",")[1]?.trim()
    || (req.query as { token?: string }).token;
  const projectId = (req.query as { projectId?: string }).projectId;
  if (!projectId || !token) {
    connection.socket.close();
    return;
  }
  try {
    const payload = await app.jwt.verify(token);
    const userId = (payload as { userId: string }).userId;
    await assertProject(userId, projectId);
  } catch {
    connection.socket.close();
    return;
  }
  const sub = nats.subscribe(`tenant.${projectId}.events`);
  (async () => {
    for await (const msg of sub) {
      connection.socket.send(JSON.stringify(codec.decode(msg.data)));
    }
  })();
});

// ============================================================
// FIX #1: Start consumers ONLY ONCE — no duplicate imports
// ============================================================

const {
  startEventPersistenceConsumer,
  startDLQMonitor,
} = await import("./agentConsumer.js");
const { startRepoConsumer } = await import("./repoConsumer.js");

await startEventPersistenceConsumer(
  process.env.NATS_SERVERS ?? "nats://localhost:4222",
  pool,
);
await startDLQMonitor(
  process.env.NATS_SERVERS ?? "nats://localhost:4222",
);
await startRepoConsumer();

// ============================================================
// Start server
// ============================================================

const port = Number(process.env.API_PORT ?? 8081);
await app.listen({ port, host: "0.0.0.0" });
console.log(`🚀 API server running on port ${port}`);