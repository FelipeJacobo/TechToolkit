# Arquitectura — AI Dev Agent V4

## Principios
- Event-Driven First (bus desacoplado)
- Plugin First (tools/providers/memory/agents)
- Fail-Safe Design
- Typed Everything (TS strict + Zod)
- Observability by Default (traceId obligatorio)
- Security by Default (sandbox)
- Cost Awareness

## Capas

```
CLI/API/Dashboard
   ↓
Orchestrator (State Machine)
   ↓
Message Bus (pub/sub, req/reply)
   ↓
Agents (planner/executor/critic/...) [stateless]
   ↓
Core Services (AI Router, Replanner, Cost, Sandbox)
   ↓
Memory Layer (ephemeral + vector (pgvector) + persistent)
```

## Orchestrator
- Solo estado + routing
- State machine explícita con transiciones válidas
- Historial completo
- Replanner integrado para errores clasificados

## Message Bus
- Pub/Sub
- Request/Reply
- Prioridades
- Backpressure
- Dead-letter
- JetStream (ack/nak, retries, DLQ)
- Adaptadores: InMemory, NATS

## Tool Registry V3
- Namespace `domain:action`
- Versionado semántico
- Permisos obligatorios
- Lazy load + hot reload

## Observabilidad
- traceId en cada evento
- Logs estructurados
- Spans por handler/agente
- OpenTelemetry listo
- Dashboard SSE (runs + eventos + métricas)

## Validación
- Zod en API y payloads por evento

## Error Handling
- Errores tipados (Validation/Retryable/Fatal)
- Logging centralizado con contexto

## Idempotencia
- Store in-memory/Redis con TTL (SETNX)

## Logging
- Logs estructurados con traceId/spanId/agent/step

## Cost Control
- Tracking por run/step
- Estimación por tokens
- Límite configurable

## Seguridad
- Sandbox con políticas explícitas
- Control de FS/Network/Shell
- Ejecución aislada con isolated-vm
- Tool permissions (allow/deny)
- Tool registry con namespace/version

## SaaS Layer
- API Gateway (Fastify) con autenticación y multi-tenant
- Web UI (Next.js) con chat, proyectos y runs
- Streaming en tiempo real vía WebSocket

## Roadmap inmediato
1. Adaptadores reales para NATS/Kafka
2. Vector store (pgvector)
3. Sandbox real (isolated-vm)
4. Replanner inteligente con clasificación de errores
5. Dashboard en tiempo real
6. Tests unitarios e integración
