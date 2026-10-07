-- Second factor (TOTP, RFC 6238) with single-use recovery codes. Only the
-- identity runtime touches these tables; the business API role has no access.
-- The shared secret must be recoverable to verify a code, so it is stored
-- encrypted by the API with a key that never reaches the database.
CREATE TABLE IF NOT EXISTS mfa_factors (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext bytea NOT NULL,
  -- NULL while the person has not yet proved the authenticator works.
  confirmed_at timestamptz,
  -- Last accepted 30-second step: a code can never be accepted twice.
  last_used_step bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mfa_factors_secret_ck CHECK (octet_length(secret_ciphertext) BETWEEN 29 AND 256),
  CONSTRAINT mfa_factors_step_ck CHECK (last_used_step>=0)
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES mfa_factors(user_id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mfa_recovery_codes_hash_ck CHECK (octet_length(code_hash)=32),
  CONSTRAINT mfa_recovery_codes_uq UNIQUE (user_id, code_hash)
);

ALTER TABLE mfa_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE mfa_factors, mfa_recovery_codes FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth, predioon_notifications;
GRANT SELECT, INSERT, DELETE ON TABLE mfa_factors, mfa_recovery_codes TO predioon_identity;
GRANT UPDATE (confirmed_at, last_used_step) ON TABLE mfa_factors TO predioon_identity;
GRANT UPDATE (used_at) ON TABLE mfa_recovery_codes TO predioon_identity;

DROP POLICY IF EXISTS identity_mfa_factors ON mfa_factors;
CREATE POLICY identity_mfa_factors ON mfa_factors FOR ALL TO predioon_identity USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS identity_mfa_recovery_codes ON mfa_recovery_codes;
CREATE POLICY identity_mfa_recovery_codes ON mfa_recovery_codes FOR ALL TO predioon_identity USING (true) WITH CHECK (true);
