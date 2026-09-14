-- NET2APP security migration
-- Idempotent: refresh sessions are stored as hashes so refresh cookies can be rotated/revoked.

CREATE TABLE IF NOT EXISTS auth_refresh_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    replaced_by_hash CHAR(64),
    ip_address VARCHAR(255),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_sessions_user ON auth_refresh_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_sessions_expiry ON auth_refresh_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_sessions_active ON auth_refresh_sessions(token_hash) WHERE revoked_at IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;
UPDATE users SET password_changed_at = COALESCE(password_changed_at, updated_at, created_at, NOW())
WHERE password_changed_at IS NULL;

-- Do not retain refresh sessions indefinitely.
DELETE FROM auth_refresh_sessions WHERE expires_at < NOW() OR revoked_at < NOW() - INTERVAL '30 days';
