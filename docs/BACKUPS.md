# Backups

## Postgres
- Daily snapshot + point-in-time recovery (PITR).
- Store in S3 with 30-day retention.

## Redis
- Enable AOF + nightly RDB snapshot.

## NATS JetStream
- Enable persistence and replicate volumes.

## Verification
- Restore drill monthly.
