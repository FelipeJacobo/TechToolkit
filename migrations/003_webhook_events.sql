-- 003_webhook_events.sql — Idempotencia para Stripe webhook
--
-- Protege contra replay attacks de Stripe (eventos duplicados por timeout/reintentos).
-- Cada evento de Stripe tiene un id único (evt_xxx). Esta tabla permite:
--   1. Detectar eventos duplicados con INSERT ... ON CONFLICT DO NOTHING
--   2. Auditar qué eventos se han procesado

CREATE TABLE IF NOT EXISTS webhook_events (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_event_id TEXT NOT NULL UNIQUE,
    event_type      TEXT NOT NULL,
    created         TIMESTAMPTZ NOT NULL,            -- cuándo Stripe generó el evento
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT now(), -- cuándo lo procesamos
    status          TEXT NOT NULL DEFAULT 'processed', -- processed, failed
    error           TEXT
);

-- Índices
CREATE INDEX idx_webhook_events_type ON webhook_events(event_type);
CREATE INDEX idx_webhook_events_created ON webhook_events(created DESC);
CREATE INDEX idx_webhook_events_status ON webhook_events(status) WHERE status = 'failed';

-- Autolimpiar eventos procesados > 90 días (evita crecimiento infinito)
-- Nota: esto es opcional si prefieres mantener historial completo
-- Para producción con alto volumen, considerar particionar por mes
