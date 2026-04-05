# Scaling Playbook

## Workers
- Scale agent-core horizontally.
- Use NATS subjects per tenant for isolation.

## Queue Depth
- Track JetStream consumer lag.
- Increase worker replicas when lag grows.

## DB
- Use read replicas for analytics.

## Cache
- Redis for rate limit + idempotency.
