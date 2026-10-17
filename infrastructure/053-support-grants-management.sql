-- 053: temporary platform support access managed through the API.
--
-- The platform admin (rbac:manage) designates support staff with a global
-- PLATFORM_SUPPORT binding, and (support:grant) grants one building's read
-- capability to a staff member for a bounded time. 014/021 already decide what
-- a grant allows; this release makes grants append-only for the application
-- (revocation instead of edits or deletes, so the building keeps its history)
-- and lets the four new management actions prove their audit rows.

-- Separate creation from revocation; the application never deletes a grant.
DROP POLICY IF EXISTS support_grants_write ON support_grants;
DROP POLICY IF EXISTS support_grants_insert ON support_grants;
CREATE POLICY support_grants_insert ON support_grants FOR INSERT TO predioon_app WITH CHECK (
  app_rbac_tenant_active(building_id) AND app_has_global_capability('support:grant')
  AND granted_by=app_current_user_id() AND support_user_id<>app_current_user_id()
  AND app_rbac_platform_role(support_user_id,'PLATFORM_SUPPORT') AND revoked_at IS NULL
  AND created_at<=statement_timestamp() AND expires_at>statement_timestamp()
  AND expires_at<=statement_timestamp()+interval '7 days'
);
DROP POLICY IF EXISTS support_grants_revoke ON support_grants;
CREATE POLICY support_grants_revoke ON support_grants FOR UPDATE TO predioon_app
  USING (revoked_at IS NULL AND app_has_global_capability('support:grant'))
  WITH CHECK (revoked_at IS NOT NULL AND app_has_global_capability('support:grant'));
-- Revocation is the only possible change, and it cannot be undone: the UPDATE
-- policy only sees unrevoked rows and the column grant covers revoked_at alone.
REVOKE UPDATE, DELETE ON support_grants FROM predioon_app;
GRANT UPDATE (revoked_at) ON support_grants TO predioon_app;

-- Staff changes are platform-wide events, not tied to a building.
DO $$
DECLARE definition text;
 marker constant text := 'WHEN NEW.building_id IS NOT NULL THEN ''BUILDING''';
 branch constant text := 'WHEN NEW.building_id IS NULL AND NEW.action IN (''SUPPORT_STAFF_ADDED'',''SUPPORT_STAFF_REMOVED'') AND NEW.resource_type=''platform_support'' AND NEW.resource_id IS NOT NULL THEN ''PLATFORM''
  ';
BEGIN
 SELECT pg_get_functiondef('app_audit_capture_scope()'::regprocedure) INTO STRICT definition;
 IF position('''SUPPORT_STAFF_ADDED''' IN definition)=0 THEN
  IF regexp_count(definition, marker)<>1 THEN RAISE EXCEPTION 'Unexpected audit scope classification shape'; END IF;
  EXECUTE replace(definition, marker, branch || marker);
 ELSIF position(branch IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected support staff audit classification';
 END IF;
END $$;

-- Audit proofs. A grant row is in the target building and was created by the
-- actor (creation) or is already revoked (revocation); a staff binding is the
-- global PLATFORM_SUPPORT one, granted by the actor (addition) or inactive (removal).
DO $$
DECLARE definition text; target regprocedure; done boolean;
 fallback constant text := 'ELSE false END';
 grant_branch constant text := 'WHEN action_name IN (''SUPPORT_GRANT_CREATED'',''SUPPORT_GRANT_REVOKED'') AND target_type=''support_grant'' THEN
   app_has_global_capability(''support:grant'') AND EXISTS(SELECT 1 FROM support_grants WHERE id::text=target_id AND building_id=target_building
     AND (action_name<>''SUPPORT_GRANT_CREATED'' OR granted_by=app_current_user_id())
     AND (action_name<>''SUPPORT_GRANT_REVOKED'' OR revoked_at IS NOT NULL))
  ';
 staff_branch constant text := 'WHEN action_name IN (''SUPPORT_STAFF_ADDED'',''SUPPORT_STAFF_REMOVED'') AND target_type=''platform_support'' THEN
   target_building IS NULL AND app_has_global_capability(''rbac:manage'') AND EXISTS(SELECT 1 FROM role_bindings WHERE id::text=target_id
     AND role_key=''PLATFORM_SUPPORT'' AND building_id IS NULL AND team_id IS NULL AND resource_type IS NULL
     AND (action_name<>''SUPPORT_STAFF_ADDED'' OR (active AND granted_by=app_current_user_id()))
     AND (action_name<>''SUPPORT_STAFF_REMOVED'' OR NOT active))
  ';
BEGIN
 -- Permissive proof for both actions; the restrictive platform proof for staff.
 FOREACH target IN ARRAY ARRAY['app_audit_legacy_insert(text,text,text,text)'::regprocedure,
   'app_audit_platform_insert(text,text,text,text,text)'::regprocedure] LOOP
  SELECT pg_get_functiondef(target) INTO STRICT definition;
  done := position('''SUPPORT_STAFF_ADDED''' IN definition)>0;
  IF NOT done THEN
   IF regexp_count(definition, fallback)<>1 THEN RAISE EXCEPTION 'Unexpected audit fallback shape in %', target; END IF;
   EXECUTE replace(definition, fallback,
     CASE WHEN target='app_audit_legacy_insert(text,text,text,text)'::regprocedure THEN grant_branch ELSE '' END || staff_branch || fallback);
  ELSIF position(staff_branch IN definition)=0 THEN
   RAISE EXCEPTION 'Unexpected support staff audit branch in %', target;
  END IF;
 END LOOP;
END $$;
