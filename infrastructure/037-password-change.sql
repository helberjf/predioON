-- Own credential replacement. Account -> families is also the API login/refresh
-- order; no runtime receives direct UPDATE access to users.
CREATE OR REPLACE FUNCTION public.identity_replace_password(
  target_user_id text, current_session_id uuid, observed_hash text, replacement_hash text
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE account public.users%ROWTYPE; current_family public.sessions%ROWTYPE;
  expected_families integer; changed_rows integer; evaluated_at timestamptz;
  live_families uuid[]; persisted_hash text;
BEGIN
  IF target_user_id IS NULL OR current_session_id IS NULL OR observed_hash IS NULL
    OR replacement_hash IS NULL OR octet_length(replacement_hash)>1024
    OR replacement_hash NOT LIKE '$argon2id$%' OR observed_hash=replacement_hash THEN
    RAISE EXCEPTION 'Invalid credential replacement' USING ERRCODE='22023';
  END IF;
  SELECT * INTO account FROM public.users WHERE id=target_user_id FOR UPDATE;
  IF NOT FOUND OR NOT account.active OR account.password_hash IS DISTINCT FROM observed_hash THEN RETURN false; END IF;

  -- The caller's family is included in this stable order. Already revoked
  -- families stay revoked, retaining their original explanation.
  PERFORM id FROM public.sessions WHERE user_id=target_user_id AND revoked_at IS NULL ORDER BY id FOR UPDATE;
  evaluated_at:=clock_timestamp();
  SELECT * INTO current_family FROM public.sessions WHERE id=current_session_id AND user_id=target_user_id;
  IF NOT FOUND OR current_family.revoked_at IS NOT NULL OR current_family.expires_at<=evaluated_at THEN RETURN false; END IF;
  SELECT array_agg(id ORDER BY id),count(*) INTO live_families,expected_families
    FROM public.sessions WHERE user_id=target_user_id AND revoked_at IS NULL;

  UPDATE public.users SET password_hash=replacement_hash WHERE id=target_user_id AND active AND password_hash=observed_hash
    RETURNING password_hash INTO persisted_hash;
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  IF changed_rows<>1 OR persisted_hash IS DISTINCT FROM replacement_hash THEN
    RAISE EXCEPTION 'Credential replacement was not persisted' USING ERRCODE='40001';
  END IF;
  UPDATE public.sessions SET revoked_at=evaluated_at,revoked_reason='PASSWORD_CHANGED'
    WHERE user_id=target_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  IF changed_rows<>expected_families THEN RAISE EXCEPTION 'Credential revocation was not persisted' USING ERRCODE='40001'; END IF;
  -- Row count alone accepts a BEFORE trigger that rewrites NEW. Confirm exact
  -- persisted values, including changes made by AFTER triggers, before success.
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=target_user_id AND active AND password_hash=replacement_hash)
    OR EXISTS(SELECT 1 FROM public.sessions WHERE user_id=target_user_id AND revoked_at IS NULL)
    OR (SELECT count(*) FROM public.sessions WHERE user_id=target_user_id AND id=ANY(live_families)
      AND revoked_at=evaluated_at AND revoked_reason='PASSWORD_CHANGED')<>expected_families THEN
    RAISE EXCEPTION 'Credential replacement was not persisted' USING ERRCODE='40001';
  END IF;
  RETURN true;
END $$;

-- Keep the existing identity helper owner even when another administrative
-- login applies the release. Reapplication removes accidental helper ACLs.
DO $$ DECLARE helper_owner text; grantee_name text; helper regprocedure:='public.identity_replace_password(text,uuid,text,text)'::regprocedure; BEGIN
  SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc
    WHERE oid='public.identity_lock_account_active(text)'::regprocedure;
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
  FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
    JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
  GRANT EXECUTE ON FUNCTION public.identity_replace_password(text,uuid,text,text) TO predioon_identity;
END $$;
