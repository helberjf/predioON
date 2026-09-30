-- Additive session families. Existing refresh tokens have no session_id and fail closed.
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  user_agent text,
  ip_address text
);
CREATE INDEX IF NOT EXISTS sessions_user_created_idx ON sessions(user_id, created_at);
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES sessions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS refresh_tokens_session_idx ON refresh_tokens(session_id);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_self ON sessions;
CREATE POLICY sessions_self ON sessions FOR ALL
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO predioon_app;
