# Deployment Guide

## Environments
- **API**: Fastify (JWT + NATS)
- **Web**: Next.js
- **Agent Core**: ai-dev-agent-v4
- **Infra**: Postgres, NATS JetStream, Redis

## Production Steps
1. Build images:
```bash
cd apps/api && docker build -t ai-dev-assistant-api:latest .
cd apps/web && docker build -t ai-dev-assistant-web:latest .
cd /root/.openclaw/workspace/ai-dev-agent-v4 && docker build -t ai-dev-agent-core:latest .
```

2. Set environment variables (example):
```bash
export DATABASE_URL=postgres://ai:ai@db:5432/ai
export NATS_SERVERS=nats://nats:4222
export JWT_SECRET=change-me
export NEXT_PUBLIC_API_URL=https://api.example.com
export NEXT_PUBLIC_WS_URL=wss://api.example.com
export OPENAI_API_KEY=...
```

3. Run production compose:
```bash
docker compose -f docker-compose.prod.yml up -d
```

## Scaling Strategy
- **API/Web**: horizontal autoscaling behind load balancer.
- **Agent Core**: scale by queue workers (NATS subjects per tenant).
- **DB**: managed Postgres with read replicas.
- **Observability**: OpenTelemetry collector + Prometheus.

## Autoscaling (Kubernetes)
- HPA for api/web/agent-core based on CPU + queue depth
- NATS JetStream with persistence

## Security Checklist
- JWT secret rotation
- API key scopes
- Redis-backed rate limiting
- TLS termination
