# Security Hardening

## Auth
- JWT + refresh tokens
- API keys (hashed in DB, scoped)
- OAuth (GitHub, Google)
- Rate limiting (Redis)
- Project-level authorization

## Secrets
- Store secrets in managed secret store (AWS Secrets Manager / Doppler)
- Rotate JWT secrets monthly

## RBAC
- Roles: owner, editor, viewer
- Enforcement in API routes
- Project membership table

## API Keys
- Scope keys per project
- Add expiry + rotation policy

## Audit Logs
- Store critical actions in audit_logs
- Export via /audit/export

## Retention
- Admin endpoint to purge old logs/traces/embeddings

## Secrets
- Use managed secrets for Stripe/GitHub/Google keys

## Transport
- Enforce HTTPS
- HSTS + secure cookies
