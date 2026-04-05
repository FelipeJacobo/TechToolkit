# AI Dev Assistant SaaS Architecture

## Overview

```
[Next.js Web]
   ↓ WebSocket + REST
[API Gateway (Fastify)]
   ↓ NATS subjects by tenant
[Agent Core (ai-dev-agent-v4)]
   ↓ Events + traces
[Postgres + pgvector]   [Redis]   [NATS JetStream]
```

## Key Layers
- **Web UI**: ChatGPT-style chat, projects, runs, traces.
- **API Layer**: Auth, chat, task runs, repo upload, trace retrieval, rate limits.
- **Agent Core**: Planner/Executor/Critic via NATS topics.
- **Data Plane**: Postgres (users, projects, runs, traces), pgvector, Redis for idempotency, NATS JetStream.

## Multi-tenant Isolation
- Project ID in JWT + NATS subject: `tenant.{projectId}`.
- Row-level scoping by project id in SQL.

## Realtime
- WebSocket `/ws/stream` -> NATS `tenant.*.events`.
