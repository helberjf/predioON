-- Apply atomically after 032. Parking permissions do not grant inventory or physical commands.
INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('parking:read','parking','read','Consultar vagas de estacionamento'),
 ('parking:manage','parking','manage','Gerenciar vagas de estacionamento')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('BUILDING_ADMIN','parking:read'),('BUILDING_ADMIN','parking:manage'),
 ('MAINTENANCE_MANAGER','parking:read'),('MAINTENANCE','parking:read'),('RESIDENT','parking:read') ON CONFLICT DO NOTHING;

-- Extend the current resource validators without copying earlier generations.
DO $$ DECLARE definition text; constraint_row record; BEGIN
 SELECT pg_get_functiondef('app_rbac_scope_valid(text,text)'::regprocedure) INTO STRICT definition;
 IF position('''parking''' in definition)=0 THEN
   IF position('''alert_rule''' in definition)=0 THEN RAISE EXCEPTION 'Missing alert rule scope'; END IF;
   EXECUTE replace(definition,'''alert_rule''','''alert_rule'',''parking''');
 END IF;
 FOR constraint_row IN SELECT conname,conrelid::regclass AS target,pg_get_constraintdef(oid) AS definition FROM pg_constraint
   WHERE (conrelid='role_bindings'::regclass AND conname='role_bindings_scope_ck')
     OR (conrelid='support_grants'::regclass AND conname='support_grants_valid_ck') LOOP
   IF position('''parking''::text' in constraint_row.definition)=0 THEN
     IF position('''alert_rule''::text' in constraint_row.definition)=0 THEN RAISE EXCEPTION 'Missing alert rule constraint'; END IF;
     definition:=replace(constraint_row.definition,'''alert_rule''::text','''alert_rule''::text, ''parking''::text');
     EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',constraint_row.target,constraint_row.conname);
     EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',constraint_row.target,constraint_row.conname,definition);
   END IF;
 END LOOP;
 SELECT pg_get_functiondef('app_discovery_resource_belongs(text,text,text)'::regprocedure) INTO STRICT definition;
 IF position('WHEN ''parking'' THEN' in definition)=0 THEN
   IF position('WHEN ''support_grant'' THEN' in definition)=0 THEN RAISE EXCEPTION 'Unexpected discovery function shape'; END IF;
   definition:=regexp_replace(definition,'(IF target_resource_type NOT IN \()([^)]*)(\))','\1\2,''parking''\3');
   definition:=replace(definition,'WHEN ''support_grant'' THEN',
     'WHEN ''parking'' THEN RETURN EXISTS (SELECT 1 FROM parking_lots r WHERE r.id=resource_uuid AND r.building_id=target_building_id AND (r.sensor_id IS NULL OR EXISTS (SELECT 1 FROM devices d WHERE d.id=r.sensor_id AND d.building_id=r.building_id AND d.type=''PARKING_SENSOR'' AND (d.gateway_id IS NULL OR EXISTS (SELECT 1 FROM gateways g WHERE g.id=d.gateway_id AND g.building_id=d.building_id))))); WHEN ''support_grant'' THEN');
   EXECUTE definition;
 END IF;
END $$;

-- Private relationship predicate. Disabled hardware stays readable and allows manual counts.
CREATE OR REPLACE FUNCTION app_parking_parent_valid(target_building_id text,target_sensor_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_sensor_id IS NULL OR EXISTS (SELECT 1 FROM devices d
   WHERE d.id=target_sensor_id AND d.building_id=target_building_id AND d.type='PARKING_SENSOR'
     AND (d.gateway_id IS NULL OR EXISTS (SELECT 1 FROM gateways g WHERE g.id=d.gateway_id AND g.building_id=d.building_id)));
$$;
CREATE OR REPLACE FUNCTION app_parking_target_has_capability(target_building_id text,target_sensor_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_capability IN ('parking:read','parking:manage')
   AND app_parking_parent_valid(target_building_id,target_sensor_id)
   AND (app_has_capability(target_building_id,target_capability)
     OR (target_sensor_id IS NOT NULL AND app_has_capability(target_building_id,target_capability,'device',target_sensor_id)));
$$;
CREATE OR REPLACE FUNCTION app_parking_has_capability(target_building_id text,target_parking_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_capability IN ('parking:read','parking:manage') AND EXISTS (
   SELECT 1 FROM parking_lots r
   WHERE r.id=CASE WHEN target_parking_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_parking_id::uuid END
     AND r.building_id=target_building_id AND app_parking_parent_valid(r.building_id,r.sensor_id)
     AND (app_has_capability(r.building_id,target_capability,'parking',r.id::text)
       OR (r.sensor_id IS NOT NULL AND app_has_capability(r.building_id,target_capability,'device',r.sensor_id))));
$$;
-- Acquire a proposed sensor before parking, matching ingestion's lock order.
-- sensor_id participates in a UNIQUE key; UPDATE may upgrade a weaker initial row lock.
CREATE OR REPLACE FUNCTION app_parking_lock_target(target_building_id text,target_parking_id text,target_sensor_id text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF target_sensor_id IS NULL OR NOT (
   app_parking_has_capability(target_building_id,target_parking_id,'parking:read')
   AND app_parking_has_capability(target_building_id,target_parking_id,'parking:manage')) THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM parking_lots r WHERE r.id=target_parking_id::uuid AND r.building_id=target_building_id AND r.sensor_id=target_sensor_id)
   AND NOT (app_parking_target_has_capability(target_building_id,target_sensor_id,'parking:read')
     AND app_parking_target_has_capability(target_building_id,target_sensor_id,'parking:manage')) THEN RETURN false; END IF;
 PERFORM d.id FROM devices d WHERE d.id=target_sensor_id AND d.building_id=target_building_id AND d.type='PARKING_SENSOR' FOR KEY SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 -- VOLATILE statements refresh authority after the sensor lock wait. An exact
 -- parking grant may lock its unchanged parent, but cannot select another device.
 RETURN app_parking_has_capability(target_building_id,target_parking_id,'parking:read')
   AND app_parking_has_capability(target_building_id,target_parking_id,'parking:manage')
   AND (EXISTS (SELECT 1 FROM parking_lots r WHERE r.id=target_parking_id::uuid AND r.building_id=target_building_id AND r.sensor_id=target_sensor_id)
     OR (app_parking_target_has_capability(target_building_id,target_sensor_id,'parking:read')
       AND app_parking_target_has_capability(target_building_id,target_sensor_id,'parking:manage')));
END $$;
CREATE OR REPLACE FUNCTION app_parking_can_read_scope(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_has_capability(target_building_id,'parking:read') OR EXISTS (
   WITH candidates AS MATERIALIZED (SELECT rb.resource_type,rb.resource_id FROM role_bindings rb
     WHERE rb.building_id=target_building_id AND rb.resource_type IN ('device','parking')
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at))
   SELECT 1 FROM candidates c WHERE CASE WHEN c.resource_type='device'
     THEN app_parking_target_has_capability(target_building_id,c.resource_id,'parking:read')
     ELSE app_parking_has_capability(target_building_id,c.resource_id,'parking:read') END);
$$;
-- Boolean projection validates only a caller-authorized target, without inventory SELECT.
CREATE OR REPLACE FUNCTION app_parking_sensor_configurable(target_building_id text,target_parking_id text,target_sensor_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT ((app_parking_target_has_capability(target_building_id,target_sensor_id,'parking:read')
     AND app_parking_target_has_capability(target_building_id,target_sensor_id,'parking:manage'))
   OR (app_parking_has_capability(target_building_id,target_parking_id,'parking:read')
     AND app_parking_has_capability(target_building_id,target_parking_id,'parking:manage')
     AND EXISTS (SELECT 1 FROM parking_lots p WHERE p.id=CASE WHEN target_parking_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_parking_id::uuid END
       AND p.building_id=target_building_id AND p.sensor_id IS NOT DISTINCT FROM target_sensor_id)))
   AND (target_sensor_id IS NULL OR EXISTS (SELECT 1 FROM devices d WHERE d.id=target_sensor_id
     AND d.building_id=target_building_id AND d.type='PARKING_SENSOR' AND d.enabled
     AND (d.gateway_id IS NULL OR EXISTS (SELECT 1 FROM gateways g WHERE g.id=d.gateway_id AND g.building_id=d.building_id AND g.enabled))));
$$;

DROP POLICY IF EXISTS parking_write_policy ON parking_lots;
DROP POLICY IF EXISTS parking_read_policy ON parking_lots;
DROP POLICY IF EXISTS parking_insert_policy ON parking_lots;
DROP POLICY IF EXISTS parking_update_policy ON parking_lots;
CREATE POLICY parking_read_policy ON parking_lots FOR SELECT TO predioon_app
 USING(app_parking_has_capability(building_id,id::text,'parking:read'));
CREATE POLICY parking_insert_policy ON parking_lots FOR INSERT TO predioon_app WITH CHECK (
 app_parking_sensor_configurable(building_id,NULL,sensor_id));
CREATE POLICY parking_update_policy ON parking_lots FOR UPDATE TO predioon_app
 USING(app_parking_has_capability(building_id,id::text,'parking:read') AND app_parking_has_capability(building_id,id::text,'parking:manage'))
 WITH CHECK(app_parking_has_capability(building_id,id::text,'parking:read') AND app_parking_has_capability(building_id,id::text,'parking:manage'));
REVOKE INSERT,UPDATE,DELETE ON parking_lots FROM predioon_app;
GRANT INSERT(id,building_id,vehicle_type,capacity,sensor_id,stale_after_seconds) ON parking_lots TO predioon_app;
GRANT UPDATE(capacity,sensor_id,stale_after_seconds,occupied,observed_at,source,version,updated_at) ON parking_lots TO predioon_app;

-- This integrity trigger sees real parents even for callers without inventory access.
CREATE OR REPLACE FUNCTION validate_parking_sensor_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT app_parking_parent_valid(NEW.building_id,NEW.sensor_id) THEN
   RAISE EXCEPTION 'Parking sensor must belong to this building with valid parents' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app_parking_target_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.sensor_id IS DISTINCT FROM NEW.sensor_id THEN
   IF app_current_user_id() IS NOT NULL AND NOT (
     app_parking_target_has_capability(NEW.building_id,NEW.sensor_id,'parking:read')
     AND app_parking_target_has_capability(NEW.building_id,NEW.sensor_id,'parking:manage'))
   THEN RAISE EXCEPTION 'Parking destination is outside the current grant' USING ERRCODE='42501'; END IF;
   NEW.occupied:=NULL; NEW.observed_at:=NULL; NEW.source:='UNKNOWN';
 END IF;
 IF app_current_user_id() IS NOT NULL AND
   (OLD.sensor_id IS DISTINCT FROM NEW.sensor_id OR OLD.capacity IS DISTINCT FROM NEW.capacity
     OR OLD.stale_after_seconds IS DISTINCT FROM NEW.stale_after_seconds)
   AND NOT app_parking_sensor_configurable(NEW.building_id,OLD.id::text,NEW.sensor_id)
 THEN RAISE EXCEPTION 'Parking sensor must be active for configuration' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS parking_target_guard ON parking_lots;
CREATE TRIGGER parking_target_guard BEFORE UPDATE ON parking_lots FOR EACH ROW EXECUTE FUNCTION app_parking_target_guard();

DROP POLICY IF EXISTS building_features_parking_read ON building_feature_settings;
CREATE POLICY building_features_parking_read ON building_feature_settings FOR SELECT TO predioon_app USING(app_parking_can_read_scope(building_id));
DROP POLICY IF EXISTS feature_runtime_parking_read ON feature_runtime;
CREATE POLICY feature_runtime_parking_read ON feature_runtime FOR SELECT TO predioon_app USING(app_parking_can_read_scope(building_id));
DO $$ DECLARE definition text; anchor text; BEGIN
 SELECT pg_get_functiondef('app_can_read_feature_event(text)'::regprocedure) INTO STRICT definition;
 anchor:='OR app_equipment_can_read_scope(b.id,''gateway'')';
 IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'Unexpected feature event function shape'; END IF;
 definition:=replace(definition,'OR app_parking_can_read_scope(b.id)','');
 EXECUTE replace(definition,anchor,anchor || E'\n     OR app_parking_can_read_scope(b.id)');
END $$;
DO $$ DECLARE expression text; branches text; action_name text; BEGIN
 SELECT pg_get_expr(polwithcheck,polrelid) INTO STRICT expression FROM pg_policy WHERE polrelid='audit_logs'::regclass AND polname='audit_logs_insert_policy';
 IF expression NOT LIKE '%CASE action%' OR expression NOT LIKE '%ELSE%' THEN RAISE EXCEPTION 'Unexpected audit policy shape'; END IF;
 branches:=$branches$
 WHEN 'PARKING_CONFIGURED'::text THEN resource_type='parking' AND building_id IS NOT NULL
   AND app_parking_has_capability(building_id,resource_id,'parking:read') AND app_parking_has_capability(building_id,resource_id,'parking:manage')
 WHEN 'PARKING_OCCUPANCY_UPDATED'::text THEN resource_type='parking' AND building_id IS NOT NULL
   AND app_parking_has_capability(building_id,resource_id,'parking:read') AND app_parking_has_capability(building_id,resource_id,'parking:manage')
 $branches$;
 FOREACH action_name IN ARRAY ARRAY['PARKING_CONFIGURED','PARKING_OCCUPANCY_UPDATED'] LOOP
   expression:=regexp_replace(expression,'WHEN ''' || action_name || '''::text THEN .*?(?=WHEN |ELSE)','','ns');
 END LOOP;
 EXECUTE 'ALTER POLICY audit_logs_insert_policy ON audit_logs WITH CHECK (' || regexp_replace(expression,'ELSE',branches || ' ELSE') || ')';
END $$;
DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_parking_parent_valid(text,text)'::regprocedure,'app_parking_target_has_capability(text,text,text)'::regprocedure,
   'app_parking_has_capability(text,text,text)'::regprocedure,'app_parking_can_read_scope(text)'::regprocedure,
   'app_parking_lock_target(text,text,text)'::regprocedure,
   'app_parking_sensor_configurable(text,text,text)'::regprocedure,'validate_parking_sensor_scope()'::regprocedure,
   'app_parking_target_guard()'::regprocedure,'app_can_read_feature_event(text)'::regprocedure
 ] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
     JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
   IF helper NOT IN ('app_parking_parent_valid(text,text)'::regprocedure,'app_parking_target_guard()'::regprocedure,'validate_parking_sensor_scope()'::regprocedure)
     THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper); END IF;
 END LOOP;
END $$;
