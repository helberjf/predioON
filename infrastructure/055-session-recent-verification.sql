-- 055: recent verification for privileged actions.
--
-- A session records when its owner last proved the password (and the second
-- factor, when enabled). Signing in counts; refreshing the access token does
-- not. Privileged API actions require this to be recent. Only the identity
-- runtime, which already maintains sessions, writes the column.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS verified_at timestamptz;
UPDATE sessions SET verified_at=created_at WHERE verified_at IS NULL;
ALTER TABLE sessions ALTER COLUMN verified_at SET DEFAULT now();
ALTER TABLE sessions ALTER COLUMN verified_at SET NOT NULL;

-- The general API role kept write grants on sessions from 013 although only the
-- identity runtime maintains them (015); with them it could mark its own
-- session as verified. Reading stays.
REVOKE INSERT, UPDATE, DELETE ON sessions FROM predioon_app;
