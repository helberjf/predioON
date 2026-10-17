-- 054: accounts and legacy building memberships decided by capabilities.
--
-- The 001 policies on users and memberships trusted the legacy role (app.role
-- and BUILDING_ADMIN memberships). They now use the same live capability facts
-- as the rest of the platform: a manager known only by a role binding can see
-- and manage the building's people, and no one grants a membership role whose
-- capabilities they do not hold. Identity and broker policies are untouched.

-- Who the application may show as a full account row: the person, the
-- platform RBAC administrator, or whoever reads memberships in a building
-- where the person holds a legacy membership. This is 001's rule with the
-- legacy BUILDING_ADMIN check replaced by the capability. Links that exist only
-- through RBAC (role binding, unit, team) still reveal just the minimal
-- directory fields of app_tenancy_people, never the users row.
CREATE OR REPLACE FUNCTION public.app_user_visible(target_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_user_id IS NOT NULL AND (
  target_user_id=app_current_user_id()
  OR app_has_global_capability('rbac:manage')
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=target_user_id AND app_has_capability(m.building_id,'memberships:read')));
$$;

DO $$ DECLARE owner_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT owner_name FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER FUNCTION public.app_user_visible(text) OWNER TO %I', owner_name);
END $$;
REVOKE ALL ON FUNCTION public.app_user_visible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_user_visible(text) TO predioon_app;

-- users: public columns for visible accounts; new accounts only by the platform
-- RBAC administrator. 040 already removed UPDATE/DELETE from the application.
DROP POLICY IF EXISTS users_scope_policy ON users;
DROP POLICY IF EXISTS users_app_read ON users;
CREATE POLICY users_app_read ON users FOR SELECT TO predioon_app USING (app_user_visible(id));
DROP POLICY IF EXISTS users_app_insert ON users;
CREATE POLICY users_app_insert ON users FOR INSERT TO predioon_app WITH CHECK (app_has_global_capability('rbac:manage'));

-- memberships: reading follows memberships:read; writing follows the role
-- delegation rule already used for role bindings. Revocation is an UPDATE;
-- the application never deletes a membership.
DROP POLICY IF EXISTS memberships_scope_policy ON memberships;
DROP POLICY IF EXISTS memberships_app_read ON memberships;
CREATE POLICY memberships_app_read ON memberships FOR SELECT TO predioon_app USING (
  user_id=app_current_user_id() OR app_has_global_capability('rbac:manage') OR app_has_capability(building_id,'memberships:read'));
DROP POLICY IF EXISTS memberships_app_insert ON memberships;
CREATE POLICY memberships_app_insert ON memberships FOR INSERT TO predioon_app WITH CHECK (
  app_has_global_capability('rbac:manage') OR app_rbac_can_delegate(building_id,role::text,NULL,NULL));
DROP POLICY IF EXISTS memberships_app_update ON memberships;
CREATE POLICY memberships_app_update ON memberships FOR UPDATE TO predioon_app
  USING (app_has_global_capability('rbac:manage') OR app_rbac_can_delegate(building_id,role::text,NULL,NULL))
  WITH CHECK (app_has_global_capability('rbac:manage') OR app_rbac_can_delegate(building_id,role::text,NULL,NULL));
REVOKE DELETE ON memberships FROM predioon_app;

-- Audit proofs: account creation and membership changes accept the capability
-- instead of the legacy platform flag. As in 039, each branch is located by its
-- header and only its own legacy check is replaced; other branches stay intact.
DO $$
DECLARE definition text; target regprocedure; i integer; start_pos integer; rest text; end_rel integer; branch text;
 legacy_actor constant text := 'app_audit_legacy_platform_actor()';
 authority constant text := 'app_has_global_capability(''rbac:manage'')';
 markers constant text[] := ARRAY['WHEN action_name=''USER_CREATED'' AND target_type=''user'' THEN',
   'WHEN action_name IN (''MEMBERSHIP_UPSERTED'',''MEMBERSHIP_REVOKED'') AND target_type=''membership'' THEN'];
BEGIN
 FOREACH target IN ARRAY ARRAY['app_audit_legacy_insert(text,text,text,text)'::regprocedure,
   'app_audit_platform_insert(text,text,text,text,text)'::regprocedure] LOOP
  SELECT pg_get_functiondef(target) INTO STRICT definition;
  FOR i IN 1..array_length(markers,1) LOOP
   start_pos := position(markers[i] IN definition);
   IF start_pos=0 THEN
    -- Account creation is proven by both functions; memberships only by the permissive one.
    IF i=1 OR target='app_audit_legacy_insert(text,text,text,text)'::regprocedure THEN
     RAISE EXCEPTION 'Missing audit branch % in %', i, target;
    END IF;
    CONTINUE;
   END IF;
   start_pos := start_pos + length(markers[i]);
   rest := substring(definition FROM start_pos);
   end_rel := least(nullif(position('WHEN action_name' IN rest),0), nullif(position('ELSE false END' IN rest),0));
   IF end_rel IS NULL THEN RAISE EXCEPTION 'Unexpected audit branch boundary in %', target; END IF;
   branch := substring(rest FOR end_rel-1);
   IF position(legacy_actor IN branch)>0 THEN
    IF (length(branch)-length(replace(branch,legacy_actor,'')))/length(legacy_actor)<>1 THEN
     RAISE EXCEPTION 'Unexpected legacy authority in audit branch % of %', i, target;
    END IF;
    definition := overlay(definition PLACING replace(branch,legacy_actor,authority) FROM start_pos FOR length(branch));
   ELSIF position(authority IN branch)=0 THEN
    RAISE EXCEPTION 'Unexpected audit branch authority % in %', i, target;
   END IF;
  END LOOP;
  EXECUTE definition;
 END LOOP;
END $$;
