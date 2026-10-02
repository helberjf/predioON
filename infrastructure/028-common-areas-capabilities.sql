-- Run atomically after 027. Only the common-area domain is added here.
INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('common-areas:read','common_area','read','Consultar áreas comuns'),
 ('common-areas:manage','common_area','manage','Gerenciar áreas comuns')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('BUILDING_ADMIN','common-areas:read'),('BUILDING_ADMIN','common-areas:manage'),
 ('MAINTENANCE_MANAGER','common-areas:read'),('MAINTENANCE','common-areas:read'),('RESIDENT','common-areas:read')
ON CONFLICT(role_key,permission_key) DO NOTHING;

-- Extend the live definitions only once, preserving later resource types/cases.
DO $$ DECLARE definition text; constraint_row record; BEGIN
 SELECT pg_get_functiondef('app_rbac_scope_valid(text,text)'::regprocedure) INTO STRICT definition;
 IF position('''common_area''' in definition)=0 THEN
   IF position('''telemetry''' in definition)=0 THEN RAISE EXCEPTION 'Unexpected scope validator shape'; END IF;
   EXECUTE replace(definition,'''telemetry''','''telemetry'',''common_area''');
 END IF;
 FOR constraint_row IN SELECT conname,conrelid::regclass AS target,pg_get_constraintdef(oid) AS definition FROM pg_constraint
   WHERE (conrelid='role_bindings'::regclass AND conname='role_bindings_scope_ck')
     OR (conrelid='support_grants'::regclass AND conname='support_grants_valid_ck') LOOP
   IF position('''common_area''::text' in constraint_row.definition)=0 THEN
     IF position('''telemetry''::text' in constraint_row.definition)=0 THEN RAISE EXCEPTION 'Unexpected resource constraint shape'; END IF;
     definition:=replace(constraint_row.definition,'''telemetry''::text','''telemetry''::text, ''common_area''::text');
     EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',constraint_row.target,constraint_row.conname);
     EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',constraint_row.target,constraint_row.conname,definition);
   END IF;
 END LOOP;
 SELECT pg_get_functiondef('app_discovery_resource_belongs(text,text,text)'::regprocedure) INTO STRICT definition;
 IF position('WHEN ''common_area'' THEN' in definition)=0 THEN
   IF position('WHEN ''support_grant'' THEN' in definition)=0 THEN RAISE EXCEPTION 'Unexpected discovery function shape'; END IF;
   definition:=regexp_replace(definition,'(IF target_resource_type NOT IN \()([^)]*)(\))','\1\2,''common_area''\3');
   definition:=replace(definition,'WHEN ''support_grant'' THEN',
     'WHEN ''common_area'' THEN RETURN EXISTS (SELECT 1 FROM common_areas a WHERE a.id=resource_uuid AND a.building_id=target_building_id); WHEN ''support_grant'' THEN');
   EXECUTE definition;
 END IF;
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
