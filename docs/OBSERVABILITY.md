# Observability

## OpenTelemetry Collector
- Collects traces/logs from API + agent core.
- Exports to Prometheus + OTLP.

## Prometheus
- Scrapes /metrics from agent-core and API.

## Alerts (examples)
- High error rate
- NATS JetStream lag
- DB latency
