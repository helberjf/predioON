-- Resident invitations. A manager records who may join which condominium; the
-- invited person later proves possession of a single-use secret and chooses
-- their own credential. Only the SHA-256 of the secret is stored, the grant is
-- always RESIDENT, and the inviter's authority is evaluated again on acceptance.
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  unit_id uuid,
  unit_kind text,
  token_hash bytea NOT NULL,
  invited_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id text REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_by text REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT invitations_token_uq UNIQUE (token_hash),
  CONSTRAINT invitations_token_ck CHECK (octet_length(token_hash)=32),
  CONSTRAINT invitations_email_ck CHECK (email=lower(btrim(email)) AND email LIKE '%_@_%' AND char_length(email)<=254),
  CONSTRAINT invitations_name_ck CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT invitations_unit_ck CHECK ((unit_id IS NULL)=(unit_kind IS NULL)
    AND (unit_kind IS NULL OR unit_kind IN ('OWNER','OCCUPANT','DEPENDENT'))),
  CONSTRAINT invitations_window_ck CHECK (expires_at>created_at AND expires_at<=created_at+interval '30 days'),
  CONSTRAINT invitations_outcome_ck CHECK ((accepted_at IS NULL OR revoked_at IS NULL)
    AND (accepted_at IS NULL OR accepted_at>=created_at) AND (revoked_at IS NULL OR revoked_at>=created_at)),
  CONSTRAINT invitations_unit_building_fk FOREIGN KEY (unit_id, building_id) REFERENCES units(id, building_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS invitations_building_created_idx ON invitations(building_id, created_at DESC);
-- One open invitation per address and condominium; issuing another replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_open_uq ON invitations(building_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE invitations FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth, predioon_notifications;
-- The application never reads the stored hash and can only mark a revocation.
GRANT SELECT (id, building_id, email, name, unit_id, unit_kind, invited_by, created_at, expires_at, accepted_at, revoked_at)
  ON TABLE invitations TO predioon_app;
GRANT INSERT (id, building_id, email, name, unit_id, unit_kind, token_hash, invited_by, expires_at)
  ON TABLE invitations TO predioon_app;
GRANT UPDATE (revoked_at, revoked_by) ON TABLE invitations TO predioon_app;

DROP POLICY IF EXISTS invitations_read ON invitations;
CREATE POLICY invitations_read ON invitations FOR SELECT TO predioon_app
  USING (app_has_capability(building_id,'memberships:manage'));
DROP POLICY IF EXISTS invitations_insert ON invitations;
CREATE POLICY invitations_insert ON invitations FOR INSERT TO predioon_app WITH CHECK (
  invited_by=app_current_user_id() AND accepted_at IS NULL AND revoked_at IS NULL
  AND app_has_capability(building_id,'memberships:manage')
  AND app_rbac_can_delegate(building_id,'RESIDENT',NULL,NULL)
);
DROP POLICY IF EXISTS invitations_revoke ON invitations;
CREATE POLICY invitations_revoke ON invitations FOR UPDATE TO predioon_app
  USING (accepted_at IS NULL AND revoked_at IS NULL AND app_has_capability(building_id,'memberships:manage'))
  WITH CHECK (accepted_at IS NULL AND revoked_at IS NOT NULL AND revoked_by=app_current_user_id()
    AND app_has_capability(building_id,'memberships:manage'));

-- Audit proof for the two manager actions. Acceptance is audited by the
-- identity helper below, with the accepting account as the actor.
DO $$
DECLARE definition text;
 fallback constant text := 'ELSE false END';
 branch constant text := 'WHEN action_name IN (''INVITATION_CREATED'',''INVITATION_REVOKED'') AND target_type=''invitation'' THEN
   app_has_capability(target_building,''memberships:manage'') AND EXISTS(SELECT 1 FROM invitations WHERE id::text=target_id AND building_id=target_building
     AND (action_name<>''INVITATION_CREATED'' OR invited_by=app_current_user_id()))
  ';
BEGIN
 SELECT pg_get_functiondef('app_audit_legacy_insert(text,text,text,text)'::regprocedure) INTO STRICT definition;
 IF position('''INVITATION_CREATED''' IN definition)=0 THEN
  -- Fail closed unless the function still ends in its single deny-by-default branch.
  IF regexp_count(definition, fallback)<>1 THEN RAISE EXCEPTION 'Unexpected audit fallback shape'; END IF;
  EXECUTE replace(definition, fallback, branch || fallback);
 ELSIF position(branch IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected invitation audit branch';
 END IF;
END $$;

-- What the bearer of a valid secret may learn before choosing a credential.
CREATE OR REPLACE FUNCTION public.identity_invitation_preview(candidate bytea)
RETURNS TABLE(email text, name text, building_name text, account_exists boolean, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT i.email, i.name, b.name, EXISTS(SELECT 1 FROM public.users u WHERE u.email=i.email), i.expires_at
  FROM public.invitations i
  JOIN public.buildings b ON b.id=i.building_id AND b.active
  JOIN public.organizations o ON o.id=b.organization_id AND o.active
  WHERE candidate IS NOT NULL AND octet_length(candidate)=32 AND i.token_hash=candidate
    AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>clock_timestamp();
$$;

-- Consumes the invitation. Exactly one mode is used: a new account
-- (new_user_id + replacement_hash) when the address is unknown, or the already
-- authenticated owner of that address (existing_user_id). Returns the account,
-- or NULL when the invitation can no longer be honoured; nothing is disclosed
-- about which condition failed.
CREATE OR REPLACE FUNCTION public.identity_accept_invitation(
  candidate bytea, new_user_id text, replacement_hash text, existing_user_id text
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE invite public.invitations%ROWTYPE; account public.users%ROWTYPE;
  evaluated_at timestamptz; authorized boolean; accepted_id text; changed_rows integer;
BEGIN
  IF candidate IS NULL OR octet_length(candidate)<>32
    OR (existing_user_id IS NULL) = (new_user_id IS NULL)
    OR (new_user_id IS NULL) <> (replacement_hash IS NULL)
    OR (new_user_id IS NOT NULL AND (char_length(new_user_id) NOT BETWEEN 1 AND 128
      OR octet_length(replacement_hash)>1024 OR replacement_hash NOT LIKE '$argon2id$%')) THEN
    RAISE EXCEPTION 'Invalid invitation acceptance' USING ERRCODE='22023';
  END IF;
  SELECT * INTO invite FROM public.invitations WHERE token_hash=candidate FOR UPDATE;
  evaluated_at:=clock_timestamp();
  IF NOT FOUND OR invite.accepted_at IS NOT NULL OR invite.revoked_at IS NOT NULL OR invite.expires_at<=evaluated_at THEN RETURN NULL; END IF;
  IF invite.unit_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.units un LEFT JOIN public.blocks bl ON bl.id=un.block_id AND bl.building_id=un.building_id
    WHERE un.id=invite.unit_id AND un.building_id=invite.building_id AND un.active AND (un.block_id IS NULL OR bl.active)) THEN
    RETURN NULL;
  END IF;

  -- The inviter must still be able to grant RESIDENT here now. The helpers read
  -- the transaction-local actor, which this identity transaction otherwise
  -- never sets; it is cleared again before any row is written.
  PERFORM set_config('app.user_id', invite.invited_by, true);
  authorized:=public.app_has_capability(invite.building_id,'memberships:manage')
    AND public.app_rbac_can_delegate(invite.building_id,'RESIDENT',NULL,NULL);
  PERFORM set_config('app.user_id', '', true);
  IF authorized IS NOT TRUE THEN RETURN NULL; END IF;

  SELECT * INTO account FROM public.users WHERE email=invite.email FOR UPDATE;
  IF FOUND THEN
    IF existing_user_id IS NULL OR account.id<>existing_user_id OR NOT account.active THEN RETURN NULL; END IF;
    accepted_id:=account.id;
  ELSE
    IF new_user_id IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.users(id,name,email,password_hash) VALUES(new_user_id,invite.name,invite.email,replacement_hash);
    accepted_id:=new_user_id;
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.role_bindings WHERE building_id=invite.building_id AND user_id=accepted_id
      AND role_key='RESIDENT' AND resource_type IS NULL AND active AND starts_at IS NULL AND ends_at IS NULL) THEN
    INSERT INTO public.role_bindings(building_id,user_id,role_key,granted_by,reason)
      VALUES(invite.building_id,accepted_id,'RESIDENT',invite.invited_by,'Convite aceito');
  END IF;
  IF invite.unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.unit_memberships WHERE building_id=invite.building_id
      AND unit_id=invite.unit_id AND user_id=accepted_id AND active AND starts_at IS NULL AND ends_at IS NULL) THEN
    INSERT INTO public.unit_memberships(building_id,unit_id,user_id,kind)
      VALUES(invite.building_id,invite.unit_id,accepted_id,invite.unit_kind);
  END IF;

  UPDATE public.invitations SET accepted_at=evaluated_at, accepted_user_id=accepted_id
    WHERE id=invite.id AND accepted_at IS NULL AND revoked_at IS NULL;
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  IF changed_rows<>1 THEN RAISE EXCEPTION 'Invitation acceptance was not persisted' USING ERRCODE='40001'; END IF;
  INSERT INTO public.audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id)
    VALUES(invite.building_id,accepted_id,'USER','INVITATION_ACCEPTED','invitation',invite.id::text);
  RETURN accepted_id;
END $$;

-- Same owner and ACL discipline as the other identity helpers.
DO $$ DECLARE helper_owner text; grantee_name text; helper regprocedure; BEGIN
  SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc
    WHERE oid='public.identity_lock_account_active(text)'::regprocedure;
  FOREACH helper IN ARRAY ARRAY[
    'public.identity_invitation_preview(bytea)'::regprocedure,
    'public.identity_accept_invitation(bytea,text,text,text)'::regprocedure
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
    FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
      JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
    LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_identity',helper);
  END LOOP;
END $$;
