-- 004_github_token.sql — GitHub OAuth integration
--
-- Store GitHub access token for repo integration (scan, analyze, PR creation).
-- Token is encrypted via pgcrypto (same as password_hash for simplicity)

-- Add column to store GitHub access token
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS github_token TEXT,
  ADD COLUMN IF NOT EXISTS github_token_expires_at TIMESTAMPTZ;

-- Store token hash instead of plaintext (security)
COMMENT ON COLUMN users.github_token IS 'Hashed GitHub personal access token for repo integration';

-- Index for finding users with connected GitHub accounts
CREATE INDEX IF NOT EXISTS idx_users_github_connected
  ON users (github_token) WHERE github_token IS NOT NULL;
