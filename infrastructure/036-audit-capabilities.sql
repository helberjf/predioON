-- Separate platform history from explicitly authorized local audit history.
-- Seed defaults only while introducing this schema, and only for newly created
-- permission definitions. Reapplication must not undo catalog/grant revocations.
WITH initial_install AS (
 SELECT NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='audit_logs'::regclass
   AND attname='scope_kind' AND NOT attisdropped) AS first_install
), created_permissions AS (
 INSERT INTO permissions(key,resource_type,action,label)
 SELECT desired.* FROM (VALUES
  ('audit:read','audit','read','Consultar auditoria do escopo concedido'),
  ('audit:read-platform','audit','read-platform','Consultar auditoria da plataforma')
 ) AS desired(key,resource_type,action,label) CROSS JOIN initial_install i WHERE i.first_install
 ON CONFLICT(key) DO NOTHING RETURNING key
)
INSERT INTO role_permissions(role_key,permission_key)
 SELECT desired.role_key,desired.permission_key FROM (VALUES
  ('BUILDING_ADMIN','audit:read'),('PLATFORM_ADMIN','audit:read-platform')
 ) AS desired(role_key,permission_key) JOIN created_permissions p ON p.key=desired.permission_key
 ON CONFLICT DO NOTHING;

DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('app_has_global_capability_at(text,timestamptz)'::regprocedure) INTO STRICT definition;
 IF position('''audit:read-platform''' IN definition)=0 THEN
  IF position('''platform:read-health''' IN definition)=0 THEN RAISE EXCEPTION 'Missing global health capability'; END IF;
  EXECUTE replace(definition,'''platform:read-health''','''platform:read-health'',''audit:read-platform''');
 END IF;
END $$;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS scope_kind text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS scope_building_id text;
-- Legacy NULL is not evidence of a platform feature change: a tenant FK may have vanished.
UPDATE audit_logs SET scope_building_id=building_id, scope_kind=CASE
 WHEN building_id IS NULL AND ((action IN ('ORGANIZATION_CREATED','ORGANIZATION_UPDATED') AND resource_type='organization')
   OR (action='USER_CREATED' AND resource_type='user')) AND resource_id IS NOT NULL THEN 'PLATFORM'
 WHEN action='BUILDING_CREATED' AND resource_type='building' AND building_id IS NOT NULL AND resource_id=building_id THEN 'PLATFORM'
 WHEN building_id IS NOT NULL THEN 'BUILDING'
 ELSE 'LEGACY_UNKNOWN' END
WHERE scope_kind IS NULL;
ALTER TABLE audit_logs ALTER COLUMN scope_kind SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN scope_kind SET DEFAULT 'LEGACY_UNKNOWN';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='audit_logs'::regclass AND conname='audit_logs_scope_kind_ck') THEN
  ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_scope_kind_ck CHECK(scope_kind IN ('PLATFORM','BUILDING','LEGACY_UNKNOWN') AND (scope_kind<>'BUILDING' OR scope_building_id IS NOT NULL));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION app_audit_capture_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.scope_kind IS DISTINCT FROM OLD.scope_kind OR NEW.scope_building_id IS DISTINCT FROM OLD.scope_building_id THEN
   RAISE EXCEPTION 'Audit scope is immutable' USING ERRCODE='42501';
  END IF;
  -- The FK can clear building_id; it must never reclassify the retained snapshot.
  RETURN NEW;
 END IF;
 NEW.scope_building_id:=NEW.building_id;
 NEW.scope_kind:=CASE
  WHEN NEW.building_id IS NULL AND ((NEW.action IN ('ORGANIZATION_CREATED','ORGANIZATION_UPDATED') AND NEW.resource_type='organization')
    OR (NEW.action='USER_CREATED' AND NEW.resource_type='user')
    OR (NEW.action='FEATURE_CONFIGURATION_CHANGED' AND NEW.resource_type='feature')) AND NEW.resource_id IS NOT NULL THEN 'PLATFORM'
  WHEN NEW.action='BUILDING_CREATED' AND NEW.resource_type='building' AND NEW.building_id IS NOT NULL AND NEW.resource_id=NEW.building_id THEN 'PLATFORM'
  WHEN NEW.building_id IS NOT NULL THEN 'BUILDING'
  ELSE 'LEGACY_UNKNOWN' END;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_logs_capture_scope ON audit_logs;
CREATE TRIGGER audit_logs_capture_scope BEFORE INSERT OR UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION app_audit_capture_scope();

CREATE OR REPLACE FUNCTION app_audit_resource_type(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE value WHEN 'financial_report' THEN 'finance' WHEN 'unit_membership' THEN 'membership' WHEN 'unit-memberships' THEN 'membership' ELSE value END;
$$;

CREATE OR REPLACE FUNCTION app_audit_local_read(target_building text,target_type text,target_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_building IS NOT NULL AND app_rbac_tenant_active(target_building) AND (
  app_has_capability(target_building,'audit:read') OR
  (target_type IS NOT NULL AND target_id IS NOT NULL
   AND app_discovery_resource_belongs(target_building,app_audit_resource_type(target_type),target_id)
   AND app_has_capability(target_building,'audit:read',app_audit_resource_type(target_type),target_id)));
$$;
CREATE OR REPLACE FUNCTION app_audit_row_visible(category text,target_building text,target_type text,target_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT category IN ('PLATFORM','BUILDING') AND (
  (category='PLATFORM' AND app_has_global_capability('audit:read-platform'))
  OR app_audit_local_read(target_building,target_type,target_id));
$$;
CREATE OR REPLACE FUNCTION app_audit_can_query(target_building text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_has_global_capability('audit:read-platform') OR EXISTS(
  SELECT 1 FROM memberships m WHERE m.user_id=app_current_user_id()
   AND (target_building IS NULL OR m.building_id=target_building)
   AND app_has_capability(m.building_id,'audit:read')
 ) OR EXISTS(
  SELECT 1 FROM role_bindings rb WHERE rb.building_id IS NOT NULL
   AND (target_building IS NULL OR rb.building_id=target_building)
   AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
   AND (app_has_capability(rb.building_id,'audit:read') OR
    (rb.resource_type IS NOT NULL AND rb.resource_id IS NOT NULL
     AND app_discovery_resource_belongs(rb.building_id,rb.resource_type,rb.resource_id)
     AND app_has_capability(rb.building_id,'audit:read',rb.resource_type,rb.resource_id)))
 );
$$;

-- Candidate tenants are derived from current grants, not from audit history.
-- They only narrow the indexed HTTP query; RLS still validates every exact row.
CREATE OR REPLACE FUNCTION app_audit_query_scope(target_building text DEFAULT NULL)
RETURNS TABLE(platform boolean,buildings text[]) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_has_global_capability('audit:read-platform'), ARRAY(
  SELECT DISTINCT candidate.building_id FROM (
   SELECT m.building_id FROM memberships m WHERE m.user_id=app_current_user_id()
    AND (target_building IS NULL OR m.building_id=target_building) AND app_has_capability(m.building_id,'audit:read')
   UNION
   SELECT rb.building_id FROM role_bindings rb WHERE rb.building_id IS NOT NULL
    AND (target_building IS NULL OR rb.building_id=target_building)
    AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
    AND (app_has_capability(rb.building_id,'audit:read') OR
      (rb.resource_type IS NOT NULL AND rb.resource_id IS NOT NULL
       AND app_discovery_resource_belongs(rb.building_id,rb.resource_type,rb.resource_id)
       AND app_has_capability(rb.building_id,'audit:read',rb.resource_type,rb.resource_id)))
  ) candidate ORDER BY candidate.building_id
 );
$$;

-- These producers still use the real legacy platform flag. Do not silently
-- broaden them to RBAC-only platform roles or grant them local audit reading.
CREATE OR REPLACE FUNCTION app_audit_legacy_platform_actor() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM users WHERE id=app_current_user_id() AND active AND is_platform_admin);
$$;

-- Only the final legacy fallback delegates here. Already migrated domain
-- branches, and the narrowly scoped access rejection policy, remain intact.
CREATE OR REPLACE FUNCTION app_audit_legacy_insert(target_building text,action_name text,target_type text,target_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE
  WHEN action_name IN ('ORGANIZATION_CREATED','ORGANIZATION_UPDATED') AND target_type='organization' THEN
   target_building IS NULL AND app_audit_legacy_platform_actor() AND EXISTS(SELECT 1 FROM organizations WHERE id=target_id)
  WHEN action_name='USER_CREATED' AND target_type='user' THEN
   target_building IS NULL AND app_audit_legacy_platform_actor() AND EXISTS(SELECT 1 FROM users WHERE id=target_id)
  WHEN action_name IN ('MEMBERSHIP_UPSERTED','MEMBERSHIP_REVOKED') AND target_type='membership' THEN
   (app_audit_legacy_platform_actor() OR app_has_capability(target_building,'memberships:manage'))
   AND EXISTS(SELECT 1 FROM memberships WHERE id::text=target_id AND building_id=target_building)
  WHEN action_name='BLOCK_CREATED' AND target_type='block' THEN
   app_has_capability(target_building,'units:manage') AND EXISTS(SELECT 1 FROM blocks WHERE id::text=target_id AND building_id=target_building)
  WHEN action_name='UNIT_CREATED' AND target_type='unit' THEN
   app_has_capability(target_building,'units:manage') AND EXISTS(SELECT 1 FROM units WHERE id::text=target_id AND building_id=target_building)
  WHEN action_name='TEAM_CREATED' AND target_type='team' THEN
   app_has_capability(target_building,'teams:manage') AND EXISTS(SELECT 1 FROM teams WHERE id::text=target_id AND building_id=target_building)
  WHEN (action_name='UNIT_MEMBERSHIP_CREATED' AND target_type='unit_membership')
    OR (action_name='UNIT_MEMBERSHIP_REVOKED' AND target_type='unit-memberships') THEN
   app_has_capability(target_building,'memberships:manage') AND EXISTS(SELECT 1 FROM unit_memberships WHERE id::text=target_id AND building_id=target_building)
  WHEN (action_name='TEAM_MEMBER_ADDED' AND target_type='team_member')
    OR (action_name='TEAM_MEMBER_REVOKED' AND target_type='team-members') THEN
   app_has_capability(target_building,'teams:manage') AND EXISTS(SELECT 1 FROM team_members WHERE id::text=target_id AND building_id=target_building)
  WHEN (action_name='ROLE_BINDING_CREATED' AND target_type='role_binding')
    OR (action_name='ROLE_BINDING_REVOKED' AND target_type='role-bindings') THEN
   app_has_capability(target_building,'memberships:manage') AND EXISTS(SELECT 1 FROM role_bindings WHERE id::text=target_id AND building_id=target_building
     AND (action_name<>'ROLE_BINDING_CREATED' OR granted_by=app_current_user_id()))
  WHEN action_name='SUPPORT_CONFIG_SAVED' AND target_type='remote_support' THEN
   app_support_admin() AND target_id=target_building AND EXISTS(SELECT 1 FROM support_hosts h JOIN buildings b ON b.id=h.building_id
     WHERE h.building_id=target_building AND b.active)
  WHEN action_name='SUPPORT_REQUESTED' AND target_type='remote_support' THEN
   app_support_admin() AND EXISTS(SELECT 1 FROM support_requests r JOIN buildings b ON b.id=r.building_id
     WHERE r.id::text=target_id AND r.building_id=target_building AND b.active AND r.requested_by=app_current_user_id())
  WHEN action_name='SUPPORT_RESULT_RECORDED' AND target_type='remote_support' THEN
   app_support_admin() AND EXISTS(SELECT 1 FROM support_requests r JOIN buildings b ON b.id=r.building_id
     WHERE r.id::text=target_id AND r.building_id=target_building AND b.active AND r.closed_by=app_current_user_id())
  ELSE false END;
$$;

DO $$ DECLARE policy_expression text; updated_expression text; BEGIN
 SELECT pg_get_expr(polwithcheck,polrelid) INTO STRICT policy_expression FROM pg_policy
 WHERE polrelid='audit_logs'::regclass AND polname='audit_logs_insert_policy';
 -- Fail closed for an unexpected/nested CASE rather than overwriting another
 -- domain's expression. The current 034 branches contain no nested CASE.
 IF regexp_count(policy_expression,'\mCASE\M')<>1 OR regexp_count(policy_expression,'\mELSE\M')<>1
    OR regexp_count(policy_expression,'\mEND\M')<>1 OR position('CASE action' IN policy_expression)=0 THEN
  RAISE EXCEPTION 'Unexpected audit INSERT policy shape';
 END IF;
 updated_expression:=regexp_replace(policy_expression,'ELSE[[:space:]]+.*[[:space:]]+END',
   'ELSE app_audit_legacy_insert(building_id,action,resource_type,resource_id) END','s');
 IF updated_expression=policy_expression AND position('app_audit_legacy_insert' IN policy_expression)=0 THEN
  RAISE EXCEPTION 'Audit INSERT fallback was not replaced';
 END IF;
 EXECUTE 'ALTER POLICY audit_logs_insert_policy ON audit_logs WITH CHECK (' || updated_expression || ')';
END $$;

-- Reading an audit never grants creation. Add restrictive proof for the finite
-- set of platform action producers, independent from mutable payload metadata.
CREATE OR REPLACE FUNCTION app_audit_platform_insert(category text,target_building text,action_name text,target_type text,target_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN category<>'PLATFORM' THEN true ELSE CASE
  WHEN action_name='BUILDING_CREATED' AND target_type='building' THEN
   target_building IS NOT NULL AND target_id=target_building AND app_has_global_capability('buildings:provision')
   AND EXISTS(SELECT 1 FROM buildings WHERE id=target_building)
  WHEN action_name='FEATURE_CONFIGURATION_CHANGED' AND target_type='feature' THEN
   target_building IS NULL AND app_has_global_capability('features:manage')
   AND EXISTS(SELECT 1 FROM global_feature_settings WHERE feature_key=target_id)
  WHEN action_name IN ('ORGANIZATION_CREATED','ORGANIZATION_UPDATED') AND target_type='organization' THEN
   target_building IS NULL AND app_audit_legacy_platform_actor()
   AND EXISTS(SELECT 1 FROM organizations WHERE id=target_id)
  WHEN action_name='USER_CREATED' AND target_type='user' THEN
   target_building IS NULL AND app_audit_legacy_platform_actor()
   AND EXISTS(SELECT 1 FROM users WHERE id=target_id)
  ELSE false END END;
$$;

DROP POLICY IF EXISTS audit_logs_scope_policy ON audit_logs;
CREATE POLICY audit_logs_scope_policy ON audit_logs FOR SELECT TO predioon_app
 USING(app_audit_row_visible(scope_kind,scope_building_id,resource_type,resource_id));
DROP POLICY IF EXISTS audit_logs_platform_insert_proof ON audit_logs;
CREATE POLICY audit_logs_platform_insert_proof ON audit_logs AS RESTRICTIVE FOR INSERT TO predioon_app
 WITH CHECK(app_audit_platform_insert(scope_kind,scope_building_id,action,resource_type,resource_id));
REVOKE SELECT,UPDATE,DELETE ON audit_logs FROM predioon_app;
REVOKE SELECT(metadata,ip_address,user_agent) ON audit_logs FROM predioon_app;
GRANT SELECT(id,building_id,scope_kind,scope_building_id,user_id,actor_type,action,resource_type,resource_id,created_at) ON audit_logs TO predioon_app;
CREATE INDEX IF NOT EXISTS audit_logs_scope_building_created_idx ON audit_logs(scope_building_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS audit_logs_platform_created_idx ON audit_logs(created_at DESC,id DESC) WHERE scope_kind='PLATFORM';

DO $$ DECLARE owner_name text; signature text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT owner_name FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH signature IN ARRAY ARRAY[
  'app_audit_capture_scope()','app_audit_resource_type(text)','app_audit_local_read(text,text,text)',
  'app_audit_row_visible(text,text,text,text)','app_audit_can_query(text)','app_audit_query_scope(text)','app_audit_platform_insert(text,text,text,text,text)',
  'app_audit_legacy_platform_actor()','app_audit_legacy_insert(text,text,text,text)'
 ] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,predioon_app,predioon_identity,predioon_broker_auth',signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app_audit_row_visible(text,text,text,text),app_audit_can_query(text),app_audit_query_scope(text),app_audit_platform_insert(text,text,text,text,text),app_audit_legacy_insert(text,text,text,text) TO predioon_app;
