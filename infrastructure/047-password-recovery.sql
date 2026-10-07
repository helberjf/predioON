-- Password recovery by e-mailed link. Only the SHA-256 of the single-use secret
-- is stored, and only the identity runtime reaches the table. Consuming the
-- link replaces the credential and revokes every session in one transaction.
CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT password_resets_token_uq UNIQUE (token_hash),
  CONSTRAINT password_resets_token_ck CHECK (octet_length(token_hash)=32),
  CONSTRAINT password_resets_window_ck CHECK (expires_at>created_at AND expires_at<=created_at+interval '24 hours')
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id) WHERE used_at IS NULL;

ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE password_resets FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth, predioon_notifications;
-- No runtime role has any privilege on the table: links are issued and consumed
-- only through the two helpers below.

-- Issues a link for an active account and retires its earlier unused links,
-- so only the most recent e-mail works. Returns false for an unknown or
-- inactive account, and while a link issued in the last two minutes is still
-- pending, so nobody can flood an inbox; the API answers alike in every case.
CREATE OR REPLACE FUNCTION public.identity_issue_password_reset(target_user_id text, candidate bytea, lifetime interval)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE issued_at timestamptz;
BEGIN
  IF target_user_id IS NULL OR candidate IS NULL OR octet_length(candidate)<>32
    OR lifetime IS NULL OR lifetime<=interval '0' OR lifetime>interval '24 hours' THEN
    RAISE EXCEPTION 'Invalid password reset request' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.users WHERE id=target_user_id AND active FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  issued_at:=clock_timestamp();
  IF EXISTS(SELECT 1 FROM public.password_resets WHERE user_id=target_user_id AND used_at IS NULL
    AND created_at>issued_at-interval '2 minutes') THEN RETURN false; END IF;
  UPDATE public.password_resets SET used_at=issued_at WHERE user_id=target_user_id AND used_at IS NULL;
  INSERT INTO public.password_resets(user_id,token_hash,created_at,expires_at) VALUES(target_user_id,candidate,issued_at,issued_at+lifetime);
  RETURN true;
END $$;

-- Consumes the link: account, then its session families, in the same order as
-- login, refresh and password change. Nothing is disclosed about why a link
-- is not acceptable. A second factor, if any, is left in place.
CREATE OR REPLACE FUNCTION public.identity_reset_password(candidate bytea, replacement_hash text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reset public.password_resets%ROWTYPE; evaluated_at timestamptz; persisted_hash text; changed_rows integer;
BEGIN
  IF candidate IS NULL OR octet_length(candidate)<>32 OR replacement_hash IS NULL
    OR octet_length(replacement_hash)>1024 OR replacement_hash NOT LIKE '$argon2id$%' THEN
    RAISE EXCEPTION 'Invalid password reset' USING ERRCODE='22023';
  END IF;
  SELECT * INTO reset FROM public.password_resets WHERE token_hash=candidate;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.users WHERE id=reset.user_id AND active FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO reset FROM public.password_resets WHERE id=reset.id FOR UPDATE;
  evaluated_at:=clock_timestamp();
  IF reset.used_at IS NOT NULL OR reset.expires_at<=evaluated_at THEN RETURN false; END IF;
  PERFORM id FROM public.sessions WHERE user_id=reset.user_id AND revoked_at IS NULL ORDER BY id FOR UPDATE;

  UPDATE public.users SET password_hash=replacement_hash WHERE id=reset.user_id AND active RETURNING password_hash INTO persisted_hash;
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  IF changed_rows<>1 OR persisted_hash IS DISTINCT FROM replacement_hash THEN
    RAISE EXCEPTION 'Password reset was not persisted' USING ERRCODE='40001';
  END IF;
  UPDATE public.password_resets SET used_at=evaluated_at WHERE user_id=reset.user_id AND used_at IS NULL;
  UPDATE public.sessions SET revoked_at=evaluated_at, revoked_reason='PASSWORD_RESET' WHERE user_id=reset.user_id AND revoked_at IS NULL;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=reset.user_id AND active AND password_hash=replacement_hash)
    OR EXISTS(SELECT 1 FROM public.sessions WHERE user_id=reset.user_id AND revoked_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.password_resets WHERE user_id=reset.user_id AND used_at IS NULL) THEN
    RAISE EXCEPTION 'Password reset was not persisted' USING ERRCODE='40001';
  END IF;
  RETURN true;
END $$;

DO $$ DECLARE helper_owner text; grantee_name text; helper regprocedure; BEGIN
  SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc
    WHERE oid='public.identity_lock_account_active(text)'::regprocedure;
  FOREACH helper IN ARRAY ARRAY[
    'public.identity_issue_password_reset(text,bytea,interval)'::regprocedure,
    'public.identity_reset_password(bytea,text)'::regprocedure
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
    FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
      JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
    LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_identity',helper);
  END LOOP;
END $$;
