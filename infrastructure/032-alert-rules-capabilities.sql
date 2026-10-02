-- Apply atomically after 031. This changes rule configuration authorization only.
INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('alert-rules:read','alert_rule','read','Consultar regras de alerta'),
 ('alert-rules:manage','alert_rule','manage','Gerenciar regras de alerta')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('BUILDING_ADMIN','alert-rules:read'),('BUILDING_ADMIN','alert-rules:manage') ON CONFLICT DO NOTHING;

-- Extend the current resource validators without copying earlier generations.
DO $$ DECLARE definition text; constraint_row record; BEGIN
 SELECT pg_get_functiondef('app_rbac_scope_valid(text,text)'::regprocedure) INTO STRICT definition;
 IF position('''alert_rule''' in definition)=0 THEN
   IF position('''reservation''' in definition)=0 THEN RAISE EXCEPTION 'Missing reservation scope'; END IF;
   EXECUTE replace(definition,'''reservation''','''reservation'',''alert_rule''');
 END IF;
 FOR constraint_row IN SELECT conname,conrelid::regclass AS target,pg_get_constraintdef(oid) AS definition FROM pg_constraint
   WHERE (conrelid='role_bindings'::regclass AND conname='role_bindings_scope_ck')
     OR (conrelid='support_grants'::regclass AND conname='support_grants_valid_ck') LOOP
   IF position('''alert_rule''::text' in constraint_row.definition)=0 THEN
     IF position('''reservation''::text' in constraint_row.definition)=0 THEN RAISE EXCEPTION 'Missing reservation constraint'; END IF;
     definition:=replace(constraint_row.definition,'''reservation''::text','''reservation''::text, ''alert_rule''::text');
     EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',constraint_row.target,constraint_row.conname);
     EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',constraint_row.target,constraint_row.conname,definition);
   END IF;
 END LOOP;
 SELECT pg_get_functiondef('app_discovery_resource_belongs(text,text,text)'::regprocedure) INTO STRICT definition;
 IF position('WHEN ''alert_rule'' THEN' in definition)=0 THEN
   IF position('WHEN ''support_grant'' THEN' in definition)=0 THEN RAISE EXCEPTION 'Unexpected discovery function shape'; END IF;
   definition:=regexp_replace(definition,'(IF target_resource_type NOT IN \()([^)]*)(\))','\1\2,''alert_rule''\3');
   definition:=replace(definition,'WHEN ''support_grant'' THEN',
     'WHEN ''alert_rule'' THEN RETURN EXISTS (SELECT 1 FROM alert_rules r WHERE r.id=resource_uuid AND r.building_id=target_building_id AND (r.device_id IS NULL OR EXISTS (SELECT 1 FROM devices d WHERE d.id=r.device_id AND d.building_id=r.building_id AND (d.gateway_id IS NULL OR EXISTS (SELECT 1 FROM gateways g WHERE g.id=d.gateway_id AND g.building_id=d.building_id))))); WHEN ''support_grant'' THEN');
   EXECUTE definition;
 END IF;
END $$;

-- Private relationship predicate; disabled hardware remains configurable.
CREATE OR REPLACE FUNCTION app_alert_rule_parent_valid(target_building_id text,target_device_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_device_id IS NULL OR EXISTS (SELECT 1 FROM devices d
   WHERE d.id=target_device_id AND d.building_id=target_building_id
     AND (d.gateway_id IS NULL OR EXISTS (SELECT 1 FROM gateways g WHERE g.id=d.gateway_id AND g.building_id=d.building_id)));
$$;
CREATE OR REPLACE FUNCTION app_alert_rule_target_has_capability(target_building_id text,target_device_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_capability IN ('alert-rules:read','alert-rules:manage')
   AND app_alert_rule_parent_valid(target_building_id,target_device_id)
   AND (app_has_capability(target_building_id,target_capability)
     OR (target_device_id IS NOT NULL AND app_has_capability(target_building_id,target_capability,'device',target_device_id)));
$$;
CREATE OR REPLACE FUNCTION app_alert_rule_has_capability(target_building_id text,target_rule_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_capability IN ('alert-rules:read','alert-rules:manage') AND EXISTS (
   SELECT 1 FROM alert_rules r
   WHERE r.id=CASE WHEN target_rule_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_rule_id::uuid END
     AND r.building_id=target_building_id AND app_alert_rule_parent_valid(r.building_id,r.device_id)
     AND (app_has_capability(r.building_id,target_capability,'alert_rule',r.id::text)
       OR (r.device_id IS NOT NULL AND app_has_capability(r.building_id,target_capability,'device',r.device_id))));
$$;
-- Acquire a proposed device before the rule, matching ingestion's lock order.
-- Updating device_id also changes a UNIQUE key on the rule: a weaker initial
-- rule lock alone cannot prevent PostgreSQL upgrading it during UPDATE.
CREATE OR REPLACE FUNCTION app_alert_rule_lock_target(target_building_id text,target_rule_id text,target_device_id text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF target_device_id IS NULL OR NOT (
   app_alert_rule_has_capability(target_building_id,target_rule_id,'alert-rules:read')
   AND app_alert_rule_has_capability(target_building_id,target_rule_id,'alert-rules:manage')) THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM alert_rules r WHERE r.id=target_rule_id::uuid AND r.building_id=target_building_id AND r.device_id=target_device_id)
   AND NOT (app_alert_rule_target_has_capability(target_building_id,target_device_id,'alert-rules:read')
     AND app_alert_rule_target_has_capability(target_building_id,target_device_id,'alert-rules:manage')) THEN RETURN false; END IF;
 PERFORM d.id FROM devices d WHERE d.id=target_device_id AND d.building_id=target_building_id FOR KEY SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 -- VOLATILE statements refresh authority after the device lock wait. An exact
 -- rule grant may lock its unchanged parent, but cannot select another device.
 RETURN app_alert_rule_has_capability(target_building_id,target_rule_id,'alert-rules:read')
   AND app_alert_rule_has_capability(target_building_id,target_rule_id,'alert-rules:manage')
   AND (EXISTS (SELECT 1 FROM alert_rules r WHERE r.id=target_rule_id::uuid AND r.building_id=target_building_id AND r.device_id=target_device_id)
     OR (app_alert_rule_target_has_capability(target_building_id,target_device_id,'alert-rules:read')
       AND app_alert_rule_target_has_capability(target_building_id,target_device_id,'alert-rules:manage')));
END $$;
CREATE OR REPLACE FUNCTION app_alert_rule_can_read_scope(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_has_capability(target_building_id,'alert-rules:read') OR EXISTS (
   WITH candidates AS MATERIALIZED (SELECT rb.resource_type,rb.resource_id FROM role_bindings rb
     WHERE rb.building_id=target_building_id AND rb.resource_type IN ('device','alert_rule')
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at))
   SELECT 1 FROM candidates c WHERE CASE WHEN c.resource_type='device'
     THEN app_alert_rule_target_has_capability(target_building_id,c.resource_id,'alert-rules:read')
     ELSE app_alert_rule_has_capability(target_building_id,c.resource_id,'alert-rules:read') END);
$$;
CREATE OR REPLACE FUNCTION app_alert_rule_context(target_building_id text,target_rule_id text)
RETURNS TABLE(device_type text,gate_kind text,parking_vehicle_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT d.type::text,g.kind::text,p.vehicle_type::text FROM alert_rules r
 LEFT JOIN devices d ON d.id=r.device_id AND d.building_id=r.building_id
 LEFT JOIN gates g ON g.device_id=d.id AND g.building_id=d.building_id AND g.gateway_id=d.gateway_id
 LEFT JOIN parking_lots p ON p.sensor_id=d.id AND p.building_id=d.building_id
 WHERE r.id=CASE WHEN target_rule_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_rule_id::uuid END
   AND r.building_id=target_building_id AND app_alert_rule_has_capability(r.building_id,r.id::text,'alert-rules:read');
$$;
CREATE OR REPLACE FUNCTION app_alert_rule_target_context(target_building_id text,target_device_id text)
RETURNS TABLE(device_type text,gate_kind text,parking_vehicle_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT d.type::text,g.kind::text,p.vehicle_type::text FROM (SELECT 1) anchor
 LEFT JOIN devices d ON d.id=target_device_id AND d.building_id=target_building_id
 LEFT JOIN gates g ON g.device_id=d.id AND g.building_id=d.building_id AND g.gateway_id=d.gateway_id
 LEFT JOIN parking_lots p ON p.sensor_id=d.id AND p.building_id=d.building_id
 WHERE app_alert_rule_target_has_capability(target_building_id,target_device_id,'alert-rules:read')
   AND app_alert_rule_target_has_capability(target_building_id,target_device_id,'alert-rules:manage');
$$;

DROP POLICY IF EXISTS alert_rules_scope_policy ON alert_rules;
DROP POLICY IF EXISTS alert_rules_read_policy ON alert_rules;
DROP POLICY IF EXISTS alert_rules_insert_policy ON alert_rules;
DROP POLICY IF EXISTS alert_rules_update_policy ON alert_rules;
DROP POLICY IF EXISTS alert_rules_delete_policy ON alert_rules;
CREATE POLICY alert_rules_read_policy ON alert_rules FOR SELECT TO predioon_app
 USING(app_alert_rule_has_capability(building_id,id::text,'alert-rules:read'));
CREATE POLICY alert_rules_insert_policy ON alert_rules FOR INSERT TO predioon_app WITH CHECK (
 created_by=app_current_user_id() AND app_alert_rule_target_has_capability(building_id,device_id,'alert-rules:read')
   AND app_alert_rule_target_has_capability(building_id,device_id,'alert-rules:manage'));
CREATE POLICY alert_rules_update_policy ON alert_rules FOR UPDATE TO predioon_app
 USING(app_alert_rule_has_capability(building_id,id::text,'alert-rules:read') AND app_alert_rule_has_capability(building_id,id::text,'alert-rules:manage'))
 WITH CHECK(app_alert_rule_has_capability(building_id,id::text,'alert-rules:read') AND app_alert_rule_has_capability(building_id,id::text,'alert-rules:manage'));
CREATE POLICY alert_rules_delete_policy ON alert_rules FOR DELETE TO predioon_app
 USING(app_alert_rule_has_capability(building_id,id::text,'alert-rules:read') AND app_alert_rule_has_capability(building_id,id::text,'alert-rules:manage'));
REVOKE INSERT,UPDATE ON alert_rules FROM predioon_app;
GRANT INSERT(id,building_id,device_id,name,metric,operator,threshold,severity,alert_type,message_template,cooldown_seconds,enabled,created_by) ON alert_rules TO predioon_app;
GRANT UPDATE(device_id,name,metric,operator,threshold,severity,alert_type,message_template,cooldown_seconds,enabled,updated_at) ON alert_rules TO predioon_app;
GRANT DELETE ON alert_rules TO predioon_app;

-- Evaluate the proposed target from NEW; the point helper sees the stored OLD
-- resource inside UPDATE and cannot alone detect broadening to another device.
CREATE OR REPLACE FUNCTION app_alert_rule_target_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF app_current_user_id() IS NULL THEN RETURN NEW; END IF;
 IF OLD.device_id IS DISTINCT FROM NEW.device_id AND NOT (
   app_alert_rule_target_has_capability(NEW.building_id,NEW.device_id,'alert-rules:read')
   AND app_alert_rule_target_has_capability(NEW.building_id,NEW.device_id,'alert-rules:manage'))
 THEN RAISE EXCEPTION 'Rule destination is outside the current grant' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS alert_rule_target_guard ON alert_rules;
CREATE TRIGGER alert_rule_target_guard BEFORE UPDATE ON alert_rules FOR EACH ROW EXECUTE FUNCTION app_alert_rule_target_guard();

DROP POLICY IF EXISTS building_features_alert_rules_read ON building_feature_settings;
CREATE POLICY building_features_alert_rules_read ON building_feature_settings FOR SELECT TO predioon_app USING(app_alert_rule_can_read_scope(building_id));
DROP POLICY IF EXISTS feature_runtime_alert_rules_read ON feature_runtime;
CREATE POLICY feature_runtime_alert_rules_read ON feature_runtime FOR SELECT TO predioon_app USING(app_alert_rule_can_read_scope(building_id));
DO $$ DECLARE definition text; anchor text; BEGIN
 SELECT pg_get_functiondef('app_can_read_feature_event(text)'::regprocedure) INTO STRICT definition;
 anchor:='OR app_equipment_can_read_scope(b.id,''gateway'')';
 IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'Unexpected feature event function shape'; END IF;
 definition:=replace(definition,'OR app_alert_rule_can_read_scope(b.id)','');
 EXECUTE replace(definition,anchor,anchor || E'\n     OR app_alert_rule_can_read_scope(b.id)');
END $$;
DO $$ DECLARE expression text; branches text; action_name text; BEGIN
 SELECT pg_get_expr(polwithcheck,polrelid) INTO STRICT expression FROM pg_policy WHERE polrelid='audit_logs'::regclass AND polname='audit_logs_insert_policy';
 IF expression NOT LIKE '%CASE action%' OR expression NOT LIKE '%ELSE%' THEN RAISE EXCEPTION 'Unexpected audit policy shape'; END IF;
 branches:=$branches$
 WHEN 'ALERT_RULE_CREATED'::text THEN resource_type='alert_rule' AND building_id IS NOT NULL
   AND app_alert_rule_has_capability(building_id,resource_id,'alert-rules:read') AND app_alert_rule_has_capability(building_id,resource_id,'alert-rules:manage')
 WHEN 'ALERT_RULE_UPDATED'::text THEN resource_type='alert_rule' AND building_id IS NOT NULL
   AND app_alert_rule_has_capability(building_id,resource_id,'alert-rules:read') AND app_alert_rule_has_capability(building_id,resource_id,'alert-rules:manage')
 WHEN 'ALERT_RULE_DELETED'::text THEN resource_type='alert_rule' AND building_id IS NOT NULL
   AND app_alert_rule_has_capability(building_id,resource_id,'alert-rules:read') AND app_alert_rule_has_capability(building_id,resource_id,'alert-rules:manage')
 $branches$;
 FOREACH action_name IN ARRAY ARRAY['ALERT_RULE_CREATED','ALERT_RULE_UPDATED','ALERT_RULE_DELETED'] LOOP
   expression:=regexp_replace(expression,'WHEN ''' || action_name || '''::text THEN .*?(?=WHEN |ELSE)','','ns');
 END LOOP;
 EXECUTE 'ALTER POLICY audit_logs_insert_policy ON audit_logs WITH CHECK (' || regexp_replace(expression,'ELSE',branches || ' ELSE') || ')';
END $$;
DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_alert_rule_parent_valid(text,text)'::regprocedure,'app_alert_rule_target_has_capability(text,text,text)'::regprocedure,
   'app_alert_rule_has_capability(text,text,text)'::regprocedure,'app_alert_rule_can_read_scope(text)'::regprocedure,
   'app_alert_rule_lock_target(text,text,text)'::regprocedure,
   'app_alert_rule_context(text,text)'::regprocedure,'app_alert_rule_target_context(text,text)'::regprocedure,
   'app_alert_rule_target_guard()'::regprocedure,'app_can_read_feature_event(text)'::regprocedure
 ] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
     JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
   IF helper NOT IN ('app_alert_rule_parent_valid(text,text)'::regprocedure,'app_alert_rule_target_guard()'::regprocedure)
     THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper); END IF;
 END LOOP;
END $$;
