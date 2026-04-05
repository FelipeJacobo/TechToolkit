#!/usr/bin/env tsx
/**
 * seed.ts — Seed data para demo
 *
 * Crea usuario, organización, 3 proyectos, 15+ runs,
 * 80+ logs, traces, audit logs, alerts, métricas.
 *
 * Uso:
 *   DATABASE_URL=postgresql://... npx tsx seed.ts
 *
 * Login demo:  demo@acme.dev / demo1234
 */
import { Pool } from "pg";

// ============================================================
// Config
// ============================================================

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ai_dev_app:dev_password_123@localhost:5432/ai_dev",
});

const r = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const agoH = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();

// ============================================================
// Seed
// ============================================================

async function main() {
  console.log("🌱 Seeding database…\n");

  // ── 0. Clean ──
  await pool.query("TRUNCATE cost_metrics, alerts, audit_logs, traces, logs, agent_runs, tasks, project_members, invites, files, subscriptions, auth_sessions, users, organizations, plans RESTART IDENTITY CASCADE");
  console.log("🧹 Tables cleaned\n");

  // ── 1. Plans ──
  await pool.query(`INSERT INTO plans (code, name, monthly_runs_limit, max_file_size, priority) VALUES
    ('free', 'Free', 200, 5242880, 0),
    ('pro',  'Pro',  5000, 52428800, 1)
  `);
  console.log("✅ Plans");

  // ── 2. Organization ──
  const orgId = r();
  await pool.query(
    `INSERT INTO organizations (id, name, created_at) VALUES ($1, 'Acme Engineering', $2)`,
    [orgId, ago(45)]
  );

  // ── 3. User ──
  const userId = r();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, organization_id, role, created_at)
     VALUES ($1, 'demo@acme.dev', crypt('demo1234', gen_salt('bf')), $2, 'owner', $3)`,
    [userId, orgId, ago(45)]
  );

  // ── 4. Subscription ──
  await pool.query(
    `INSERT INTO subscriptions (user_id, plan_code, status, current_period_end)
     VALUES ($1, 'pro', 'active', $2)`,
    [userId, ago(-15)]
  );

  // ── 5. Auth session ──
  const rt = `rt_${r()}`;
  await pool.query(
    `INSERT INTO auth_sessions (user_id, refresh_hash, expires_at)
     VALUES ($1, encode(digest($2, 'sha256'), 'hex'), $3)`,
    [userId, rt, ago(-60)]
  );
  console.log("✅ User: demo@acme.dev  pass: demo1234");

  // ── 6. Projects ──
  const projects = [
    { id: r(), name: "Payments API",         repo: "https://github.com/acme/payments-api",   desc: "Stripe payment microservice with webhooks" },
    { id: r(), name: "Frontend Dashboard",    repo: "https://github.com/acme/dashboard",      desc: "Next.js admin dashboard with real-time charts" },
    { id: r(), name: "Auth Service",          repo: "https://github.com/acme/auth-service",   desc: "OAuth2 + JWT authentication with MFA" },
  ];

  for (const p of projects) {
    await pool.query(
      `INSERT INTO projects (id, name, repo_url, description, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [p.id, p.name, p.repo, p.desc, ago(Math.floor(Math.random() * 30) + 5)]
    );

    await pool.query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [p.id, userId]
    );
  }
  console.log(`✅ ${projects.length} projects`);

  // ── 7. Files ──
  const files = [
    "package.json", "tsconfig.json", "src/index.ts", "src/db/pool.ts",
    "src/routes/payments.ts", "src/routes/users.ts", "src/middleware/auth.ts",
    "src/utils/validation.ts", "tests/payments.test.ts", "Dockerfile",
  ];

  for (const p of projects) {
    const n = 4 + Math.floor(Math.random() * 6);
    for (const f of files.slice(0, n)) {
      await pool.query(
        `INSERT INTO files (project_id, filename, content_hash)
         VALUES ($1, $2, encode(digest($3 || $4, 'sha256'), 'hex'))`,
        [p.id, f, p.id, f]
      );
    }
  }
  console.log("✅ Files per project");

  // ── 8. Tasks + Runs + Logs + Traces ──
  const scenarios: Array<{
    goal: string;
    status: "completed" | "failed" | "queued" | "running";
    logs: Array<{ level: string; message: string; hoursAgo: number }>;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
    daysAgo: number;
  }> = [
    {
      goal: "Analyze codebase for SQL injection vulnerabilities",
      status: "completed",
      daysAgo: 2,
      costUsd: 0.0034,
      tokensIn: 1247,
      tokensOut: 892,
      durationMs: 4200,
      logs: [
        { level: "info",  message: "Initializing analysis pipeline", hoursAgo: 48 },
        { level: "info",  message: "Loading project context — found 8 files, 342 lines", hoursAgo: 48 },
        { level: "info",  message: "Vector embeddings ready, 247 chunks indexed", hoursAgo: 47.9 },
        { level: "info",  message: "Planner created: 3 steps", hoursAgo: 47.8 },
        { level: "info",  message: "Step 1: Scanning for SQL injection patterns…", hoursAgo: 47.7 },
        { level: "warn",  message: "⚠ Found unparameterized query in src/db/pool.ts:23", hoursAgo: 47.5 },
        { level: "error", message: "❌ Vulnerability: string concatenation in query at src/routes/users.ts:15", hoursAgo: 47.3 },
        { level: "info",  message: "Step 2: Generating parameterized alternatives…", hoursAgo: 47.1 },
        { level: "info",  message: "Step 3: Static analysis + sandbox validation", hoursAgo: 47 },
        { level: "info",  message: "✅ Complete — 1 critical, 1 high, 2 medium issues", hoursAgo: 47 },
      ],
    },
    {
      goal: "Find why payment webhook returns 500",
      status: "completed",
      daysAgo: 1,
      costUsd: 0.0028,
      tokensIn: 980,
      tokensOut: 654,
      durationMs: 3800,
      logs: [
        { level: "info",  message: "Initializing analysis for: payment webhook 500", hoursAgo: 24 },
        { level: "info",  message: "Loaded 6 files from payments-api repo", hoursAgo: 24 },
        { level: "info",  message: "Tracing error path from webhook endpoint…", hoursAgo: 23.8 },
        { level: "error", message: "Root cause: Stripe signature verification missing in src/routes/payments.ts:42", hoursAgo: 23.5 },
        { level: "info",  message: "Generating fix with proper webhook signature validation", hoursAgo: 23.3 },
        { level: "info",  message: "✅ Fix validated in sandbox — signature check + error handling", hoursAgo: 23 },
      ],
    },
    {
      goal: "Generate unit tests for auth middleware",
      status: "completed",
      daysAgo: 0.5,
      costUsd: 0.0041,
      tokensIn: 1580,
      tokensOut: 1200,
      durationMs: 5100,
      logs: [
        { level: "info",  message: "Initializing test generation for auth middleware", hoursAgo: 12 },
        { level: "info",  message: "Analyzing src/middleware/auth.ts — 3 exported functions found", hoursAgo: 12 },
        { level: "info",  message: "Generating 12 test cases (happy path + edge cases)", hoursAgo: 11.5 },
        { level: "info",  message: "✅ tests/auth.test.ts created — 12 tests, 0 failures", hoursAgo: 11 },
      ],
    },
    {
      goal: "Refactor duplicate database connection code",
      status: "completed",
      daysAgo: 5,
      costUsd: 0.0019,
      tokensIn: 740,
      tokensOut: 520,
      durationMs: 2900,
      logs: [
        { level: "info",  message: "Scanning for duplicate connection pool patterns…", hoursAgo: 120 },
        { level: "warn",  message: "Found duplicated pool.init() in src/db/pool.ts and src/index.ts", hoursAgo: 119 },
        { level: "info",  message: "Refactoring to shared singleton pattern", hoursAgo: 118.5 },
        { level: "info",  message: "✅ Refactored — 12 lines removed, single connection source", hoursAgo: 118 },
      ],
    },
    {
      goal: "Deploy to production with zero downtime",
      status: "failed",
      daysAgo: 3,
      costUsd: 0.0012,
      tokensIn: 420,
      tokensOut: 180,
      durationMs: 8200,
      logs: [
        { level: "info",  message: "Starting deployment analysis…", hoursAgo: 72 },
        { level: "info",  message: "Checking Dockerfile configuration", hoursAgo: 72 },
        { level: "error", message: "❌ Dockerfile not found in project root", hoursAgo: 71.5 },
        { level: "error", message: "❌ No deployment config in .github/workflows/", hoursAgo: 71.3 },
        { level: "warn",  message: "Cannot proceed — deployment artifacts missing", hoursAgo: 71 },
      ],
    },
    {
      goal: "Migrate users table to new schema with email verification",
      status: "failed",
      daysAgo: 7,
      costUsd: 0.0008,
      tokensIn: 300,
      tokensOut: 120,
      durationMs: 3100,
      logs: [
        { level: "info",  message: "Analyzing migration requirements…", hoursAgo: 168 },
        { level: "error", message: "❌ No database write access — read-only mode for this project", hoursAgo: 167.8 },
        { level: "warn",  message: "Migration requires elevated permissions", hoursAgo: 167.5 },
      ],
    },
    {
      goal: "Identify N+1 query patterns in REST endpoints",
      status: "queued",
      daysAgo: 0,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
      logs: [],
    },
    {
      goal: "Generate API documentation from JSDoc",
      status: "queued",
      daysAgo: 0,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
      logs: [],
    },
    {
      goal: "Review frontend bundle size and optimize",
      status: "running",
      daysAgo: 0,
      costUsd: 0.0009,
      tokensIn: 340,
      tokensOut: 180,
      durationMs: 1400,
      logs: [
        { level: "info",  message: "Analyzing frontend bundle…", minutesAgo: 5 },
        { level: "info",  message: "Current bundle: 847KB (uncompressed)", minutesAgo: 5 },
      ] as Array<{ level: string; message: string; hoursAgo?: number; minutesAgo?: number }>,
    },
  ];

  let totalLogs = 0;
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const project = projects[i % projects.length];
    const traceId = crypto.randomUUID().slice(0, 24);

    // Task
    const taskId = r();
    await pool.query(
      `INSERT INTO tasks (id, project_id, goal, priority, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [taskId, project.id, s.goal, pick(["high", "medium", "low"]), s.status, ago(s.daysAgo)]
    );

    // Run
    const runId = r();
    await pool.query(
      `INSERT INTO agent_runs (id, task_id, status, trace_id, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, taskId, s.status, traceId, ago(s.daysAgo)]
    );

    // Logs
    for (const lg of s.logs) {
      const hoursAgo = (lg as any).minutesAgo ? (lg as any).minutesAgo / 60 : (lg as any).hoursAgo ?? s.daysAgo * 24;
      await pool.query(
        `INSERT INTO logs (run_id, level, message, meta, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [runId, lg.level, lg.message, JSON.stringify({ traceId }), agoH(hoursAgo)]
      );
      totalLogs++;
    }

    // Trace (except queued)
    if (s.status !== "queued") {
      await pool.query(
        `INSERT INTO traces (run_id, trace_id, payload)
         VALUES ($1, $2, $3)`,
        [
          runId,
          traceId,
          JSON.stringify({
            costUsd: s.costUsd,
            tokensIn: s.tokensIn,
            tokensOut: s.tokensOut,
            durationMs: s.durationMs,
            steps: s.logs.length,
            status: s.status,
          }),
        ]
      );
    }
  }
  console.log(`✅ ${scenarios.length} runs — 5 completed, 2 failed, 2 queued, 1 running (${totalLogs} logs)`);

  // ── 9. Audit log ──
  const audits = [
    { action: "user.register",      meta: { email: "demo@acme.dev", orgId } },
    { action: "user.login",         meta: { email: "demo@acme.dev" } },
    { action: "project.create",     meta: { projectId: projects[0].id, name: projects[0].name } },
    { action: "project.create",     meta: { projectId: projects[1].id, name: projects[1].name } },
    { action: "project.create",     meta: { projectId: projects[2].id, name: projects[2].name } },
    { action: "run.completed",      meta: { goal: "Analyze codebase for SQL injection" } },
    { action: "run.completed",      meta: { goal: "Find why payment webhook returns 500" } },
    { action: "run.failed",         meta: { goal: "Deploy to production" } },
    { action: "api_key.create",     meta: {} },
    { action: "invite.create",      meta: { email: "dev@acme.dev", role: "editor" } },
  ];

  for (const a of audits) {
    await pool.query(
      `INSERT INTO audit_logs (user_id, project_id, action, meta, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, null, a.action, JSON.stringify(a.meta), ago(Math.random() * 10)]
    );
  }
  console.log(`✅ ${audits.length} audit logs`);

  // ── 10. Alerts ──
  const alertTexts = [
    "Run exceeded 60s timeout on Payments API",
    "Cost spike: $0.045 in single run (threshold: $0.01)",
    "3 consecutive failed executions on Auth Service",
  ];
  for (const t of alertTexts) {
    await pool.query(
      `INSERT INTO alerts (message) VALUES ($1)`,
      [t]
    );
  }
  console.log(`✅ ${alertTexts.length} alerts`);

  // ── 11. Cost metrics (last 7 days) ──
  const dailyCosts = [0.0089, 0.0112, 0.0045, 0.0156, 0.0034, 0.0089, 0.0028];
  for (let i = 0; i < 7; i++) {
    await pool.query(
      `INSERT INTO cost_metrics (date, total_costs, run_count, token_count)
       VALUES ($1, $2, $3, $4)`,
      [
        new Date(Date.now() - (6 - i) * 86400000).toISOString().split("T")[0],
        dailyCosts[i],
        Math.floor(Math.random() * 3) + 1,
        Math.floor(Math.random() * 4000) + 800,
      ]
    );
  }
  console.log("✅ 7 days cost metrics");

  // ── Done ──
  await pool.end();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎉  Seed complete!\n");
  console.log("   Login     demo@acme.dev");
  console.log("   Password  demo1234\n");
  console.log("   3 projects · 9 runs · ${totalLogs} logs");
  console.log("   Dashboard will be populated on first visit");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

// Helpers
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
