-- Run atomically after 027. Only the common-area domain is added here.
INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('common-areas:read','common_area','read','Consultar áreas comuns'),
 ('common-areas:manage','common_area','manage','Gerenciar áreas comuns')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('BUILDING_ADMIN','common-areas:read'),('BUILDING_ADMIN','common-areas:manage'),
 ('MAINTENANCE_MANAGER','common-areas:read'),('MAINTENANCE','common-areas:read'),('RESIDENT','common-areas:read')
ON CONFLICT(role_key,permission_key) DO NOTHING;

-- Extend only the resource whitelist; the time window helper remains from 021.
CREATE OR REPLACE FUNCTION app_rbac_scope_valid(resource_type text, resource_id text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT (resource_type IS NULL AND resource_id IS NULL) OR
   (resource_type IS NOT NULL AND resource_id IS NOT NULL AND btrim(resource_id) <> '' AND
     resource_type IN ('building','block','unit','team','membership','device','gateway','alert','work_order','automation','finance','support_grant','notice','occurrence','telemetry','common_area'));
$$;
ALTER TABLE role_bindings DROP CONSTRAINT IF EXISTS role_bindings_scope_ck;
ALTER TABLE role_bindings ADD CONSTRAINT role_bindings_scope_ck CHECK (
 ((resource_type IS NULL AND resource_id IS NULL) OR
   (resource_type IS NOT NULL AND resource_id IS NOT NULL AND btrim(resource_id) <> '' AND
     resource_type IN ('building','block','unit','team','membership','device','gateway','alert','work_order','automation','finance','support_grant','notice','occurrence','telemetry','common_area')))
 AND ((role_key IN ('PLATFORM_ADMIN','PLATFORM_SUPPORT') AND building_id IS NULL AND team_id IS NULL AND resource_type IS NULL)
   OR (role_key NOT IN ('PLATFORM_ADMIN','PLATFORM_SUPPORT') AND building_id IS NOT NULL))
);
ALTER TABLE support_grants DROP CONSTRAINT IF EXISTS support_grants_valid_ck;
ALTER TABLE support_grants ADD CONSTRAINT support_grants_valid_ck CHECK (
 ((resource_type IS NULL AND resource_id IS NULL) OR
   (resource_type IS NOT NULL AND resource_id IS NOT NULL AND btrim(resource_id) <> '' AND
     resource_type IN ('building','block','unit','team','membership','device','gateway','alert','work_order','automation','finance','support_grant','notice','occurrence','telemetry','common_area')))
 AND btrim(reason) <> ''
 AND isfinite(expires_at) AND expires_at > created_at AND support_user_id <> granted_by
 AND capability IN ('telemetry:read','alerts:read','devices:read','work-orders:read-assigned','support:read')
);

-- CREATE OR REPLACE preserves the owner-only ACL and original helper owner.
CREATE OR REPLACE FUNCTION app_discovery_resource_belongs(
  target_building_id text, target_resource_type text, target_resource_id text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE resource_uuid uuid;
BEGIN
  IF target_resource_type IS NULL AND target_resource_id IS NULL THEN RETURN true; END IF;
  IF target_resource_type IS NULL OR target_resource_id IS NULL OR btrim(target_resource_id) = '' THEN RETURN false; END IF;

  -- Text primary keys remain text: no normalization or cross-tenant fallback.
  CASE target_resource_type
    WHEN 'building' THEN
      RETURN EXISTS (SELECT 1 FROM buildings b WHERE b.id=target_resource_id AND b.id=target_building_id);
    WHEN 'device' THEN
      RETURN EXISTS (SELECT 1 FROM devices d WHERE d.id=target_resource_id AND d.building_id=target_building_id);
    WHEN 'gateway' THEN
      RETURN EXISTS (SELECT 1 FROM gateways g WHERE g.id=target_resource_id AND g.building_id=target_building_id);
    ELSE
      -- work_order/automation have no concrete entity, and telemetry has no
      -- globally unique id. Fail closed without reading time-series history.
      IF target_resource_type NOT IN ('block','unit','team','membership','alert','finance','notice','occurrence','support_grant','common_area') THEN RETURN false; END IF;
  END CASE;

  -- Invalid UUID input is a denied scope, never a runtime 22P02 exception.
  BEGIN
    resource_uuid := target_resource_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false;
  END;
  CASE target_resource_type
    WHEN 'block' THEN
      RETURN EXISTS (SELECT 1 FROM blocks b WHERE b.id=resource_uuid AND b.building_id=target_building_id);
    WHEN 'unit' THEN
      RETURN EXISTS (SELECT 1 FROM units u WHERE u.id=resource_uuid AND u.building_id=target_building_id);
    WHEN 'team' THEN
      RETURN EXISTS (SELECT 1 FROM teams t WHERE t.id=resource_uuid AND t.building_id=target_building_id);
    WHEN 'membership' THEN
      RETURN EXISTS (SELECT 1 FROM memberships m WHERE m.id=resource_uuid AND m.building_id=target_building_id)
        OR EXISTS (SELECT 1 FROM unit_memberships m WHERE m.id=resource_uuid AND m.building_id=target_building_id);
    WHEN 'alert' THEN
      RETURN EXISTS (SELECT 1 FROM alerts a WHERE a.id=resource_uuid AND a.building_id=target_building_id);
    WHEN 'finance' THEN
      RETURN EXISTS (SELECT 1 FROM financial_reports f WHERE f.id=resource_uuid AND f.building_id=target_building_id);
    WHEN 'notice' THEN
      RETURN EXISTS (SELECT 1 FROM notices n WHERE n.id=resource_uuid AND n.building_id=target_building_id);
    WHEN 'occurrence' THEN
      RETURN EXISTS (SELECT 1 FROM occurrences o WHERE o.id=resource_uuid AND o.building_id=target_building_id);
    WHEN 'common_area' THEN
      RETURN EXISTS (SELECT 1 FROM common_areas a WHERE a.id=resource_uuid AND a.building_id=target_building_id);
    WHEN 'support_grant' THEN
      RETURN EXISTS (SELECT 1 FROM support_grants s WHERE s.id=resource_uuid AND s.building_id=target_building_id);
    ELSE RETURN false;
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION app_common_area_has_capability(target_building_id text, target_area_id text, target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_capability IN ('common-areas:read','common-areas:manage') AND EXISTS (
   SELECT 1 FROM common_areas a
   WHERE a.id=CASE WHEN target_area_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_area_id::uuid END
     AND a.building_id=target_building_id
     AND app_has_capability(a.building_id,target_capability,'common_area',a.id::text)
 );
$$;

CREATE OR REPLACE FUNCTION app_common_area_can_read_scope(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_has_capability(target_building_id,'common-areas:read') OR EXISTS (
   WITH candidates AS MATERIALIZED (
     SELECT rb.resource_id FROM role_bindings rb
     WHERE rb.building_id=target_building_id AND rb.resource_type='common_area'
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
   )
   SELECT 1 FROM candidates candidate
   WHERE app_common_area_has_capability(target_building_id,candidate.resource_id,'common-areas:read')
 );
$$;

DROP POLICY IF EXISTS common_areas_read_policy ON common_areas;
DROP POLICY IF EXISTS common_areas_write_policy ON common_areas;
DROP POLICY IF EXISTS common_areas_insert_policy ON common_areas;
DROP POLICY IF EXISTS common_areas_update_policy ON common_areas;
CREATE POLICY common_areas_read_policy ON common_areas FOR SELECT TO predioon_app
 USING (app_common_area_has_capability(building_id,id::text,'common-areas:read'));
CREATE POLICY common_areas_insert_policy ON common_areas FOR INSERT TO predioon_app
 WITH CHECK (app_has_capability(building_id,'common-areas:read') AND app_has_capability(building_id,'common-areas:manage'));
CREATE POLICY common_areas_update_policy ON common_areas FOR UPDATE TO predioon_app
 USING (app_common_area_has_capability(building_id,id::text,'common-areas:read') AND app_common_area_has_capability(building_id,id::text,'common-areas:manage'))
 WITH CHECK (app_common_area_has_capability(building_id,id::text,'common-areas:read') AND app_common_area_has_capability(building_id,id::text,'common-areas:manage'));
REVOKE UPDATE, DELETE ON common_areas FROM predioon_app;
GRANT UPDATE(name,description,capacity,rules,opens_at,closes_at,requires_approval,max_hours_per_booking,active,updated_at) ON common_areas TO predioon_app;

DROP POLICY IF EXISTS building_features_common_areas_read ON building_feature_settings;
CREATE POLICY building_features_common_areas_read ON building_feature_settings FOR SELECT TO predioon_app
 USING (app_common_area_can_read_scope(building_id));
DROP POLICY IF EXISTS feature_runtime_common_areas_read ON feature_runtime;
CREATE POLICY feature_runtime_common_areas_read ON feature_runtime FOR SELECT TO predioon_app
 USING (app_common_area_can_read_scope(building_id));

-- Add this domain to the current definition, preserving earlier and later
-- independent domains (including occurrences from 027) when reapplied.
DO $$ DECLARE function_definition text; equipment_clause text; BEGIN
 SELECT pg_get_functiondef('app_can_read_feature_event(text)'::regprocedure) INTO STRICT function_definition;
 equipment_clause := 'OR app_equipment_can_read_scope(b.id,''gateway'')';
 IF position(equipment_clause in function_definition)=0 THEN
   RAISE EXCEPTION 'Unexpected feature event function shape';
 END IF;
 function_definition := replace(function_definition,'OR app_common_area_can_read_scope(b.id)','');
 function_definition := replace(function_definition,equipment_clause,equipment_clause || E'\n     OR app_common_area_can_read_scope(b.id)');
 EXECUTE function_definition;
END $$;

-- Replace only this domain's two actions in the current audit expression.
-- Creation needs a whole-building grant; updating accepts the real area scope.
DO $$ DECLARE policy_expression text; area_branches text; action_name text; BEGIN
 SELECT pg_get_expr(polwithcheck,polrelid) INTO STRICT policy_expression
 FROM pg_policy WHERE polrelid='audit_logs'::regclass AND polname='audit_logs_insert_policy';
 IF policy_expression NOT LIKE '%CASE action%' OR policy_expression NOT LIKE '%ELSE%' THEN
   RAISE EXCEPTION 'Unexpected audit policy shape';
 END IF;
 area_branches := $branches$
   WHEN 'COMMON_AREA_CREATED'::text THEN resource_type='common_area' AND building_id IS NOT NULL
     AND app_has_capability(building_id,'common-areas:read') AND app_has_capability(building_id,'common-areas:manage')
     AND app_common_area_has_capability(building_id,resource_id,'common-areas:read')
     AND app_common_area_has_capability(building_id,resource_id,'common-areas:manage')
   WHEN 'COMMON_AREA_UPDATED'::text THEN resource_type='common_area' AND building_id IS NOT NULL
     AND app_common_area_has_capability(building_id,resource_id,'common-areas:read')
     AND app_common_area_has_capability(building_id,resource_id,'common-areas:manage')
 $branches$;
 FOREACH action_name IN ARRAY ARRAY['COMMON_AREA_CREATED','COMMON_AREA_UPDATED'] LOOP
   policy_expression := regexp_replace(policy_expression,
     'WHEN ''' || action_name || '''::text THEN .*?(?=WHEN |ELSE)', '', 'ns');
 END LOOP;
 policy_expression := regexp_replace(policy_expression,'ELSE',area_branches || ' ELSE');
 EXECUTE 'ALTER POLICY audit_logs_insert_policy ON audit_logs WITH CHECK (' || policy_expression || ')';
END $$;

DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
 FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_common_area_has_capability(text,text,text)'::regprocedure,
   'app_common_area_can_read_scope(text)'::regprocedure
 ] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee
     WHERE p.oid=helper AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper);
 END LOOP;
END $$;
