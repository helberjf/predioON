-- Apply atomically after 033. Physical admission and dispatch use current scoped
-- capabilities; configuration, request and command history remain independent.
INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('gates:read','gate','read','Consultar acessos físicos'),
 ('gates:manage','gate','manage','Configurar acessos físicos'),
 ('commands:read-own','command','read-own','Consultar próprias solicitações de abertura'),
 ('commands:read','command','read','Consultar histórico autorizado de aberturas')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('BUILDING_ADMIN','gates:read'),('BUILDING_ADMIN','gates:manage'),
 ('BUILDING_ADMIN','commands:request'),('BUILDING_ADMIN','commands:read-own'),('BUILDING_ADMIN','commands:read'),
 ('RESIDENT','gates:read'),('RESIDENT','commands:request'),('RESIDENT','commands:read-own')
ON CONFLICT DO NOTHING;

DO $$ DECLARE definition text; constraint_row record; BEGIN
 SELECT pg_get_functiondef('app_rbac_scope_valid(text,text)'::regprocedure) INTO STRICT definition;
 IF position('''gate''' in definition)=0 THEN
   IF position('''parking''' in definition)=0 THEN RAISE EXCEPTION 'Missing parking scope'; END IF;
   EXECUTE replace(definition,'''parking''','''parking'',''gate''');
 END IF;
 FOR constraint_row IN SELECT conname,conrelid::regclass AS target,pg_get_constraintdef(oid) AS definition FROM pg_constraint
   WHERE (conrelid='role_bindings'::regclass AND conname='role_bindings_scope_ck')
     OR (conrelid='support_grants'::regclass AND conname='support_grants_valid_ck') LOOP
   IF position('''gate''::text' in constraint_row.definition)=0 THEN
     IF position('''parking''::text' in constraint_row.definition)=0 THEN RAISE EXCEPTION 'Missing parking constraint'; END IF;
     definition:=replace(constraint_row.definition,'''parking''::text','''parking''::text, ''gate''::text');
     EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',constraint_row.target,constraint_row.conname);
     EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',constraint_row.target,constraint_row.conname,definition);
   END IF;
 END LOOP;
 SELECT pg_get_functiondef('app_discovery_resource_belongs(text,text,text)'::regprocedure) INTO STRICT definition;
 IF position('WHEN ''gate'' THEN' in definition)=0 THEN
   IF position('WHEN ''support_grant'' THEN' in definition)=0 THEN RAISE EXCEPTION 'Unexpected discovery function shape'; END IF;
   definition:=regexp_replace(definition,'(IF target_resource_type NOT IN \()([^)]*)(\))','\1\2,''gate''\3');
   definition:=replace(definition,'WHEN ''support_grant'' THEN',
     'WHEN ''gate'' THEN RETURN EXISTS (SELECT 1 FROM gates r JOIN devices d ON d.id=r.device_id AND d.building_id=r.building_id AND d.gateway_id=r.gateway_id JOIN gateways g ON g.id=r.gateway_id AND g.building_id=r.building_id WHERE r.id=resource_uuid AND r.building_id=target_building_id AND d.type IN (''GARAGE_GATE'',''PEDESTRIAN_GATE'',''GATE_CONTROLLER'')); WHEN ''support_grant'' THEN');
   EXECUTE definition;
 END IF;
END $$;

-- Relationship integrity is independent of enabled/online state. Disabled
-- hardware remains diagnosable and configurable; command admission is stricter.
CREATE OR REPLACE FUNCTION app_access_parent_valid(target_building_id text,target_gateway_id text,target_device_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM devices d JOIN gateways g ON g.id=d.gateway_id AND g.building_id=d.building_id
   WHERE d.id=target_device_id AND d.building_id=target_building_id AND g.id=target_gateway_id
     AND d.type IN ('GARAGE_GATE','PEDESTRIAN_GATE','GATE_CONTROLLER'));
$$;

CREATE OR REPLACE FUNCTION app_access_target_has_capability_at(target_building_id text,target_gateway_id text,target_device_id text,target_capability text,evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT evaluated_at IS NOT NULL AND isfinite(evaluated_at)
   AND target_capability IN ('gates:read','gates:manage','commands:request','commands:read-own','commands:read')
   AND app_access_parent_valid(target_building_id,target_gateway_id,target_device_id)
   AND (app_has_capability_at(target_building_id,target_capability,NULL,NULL,evaluated_at)
     OR app_has_capability_at(target_building_id,target_capability,'device',target_device_id,evaluated_at)
     OR app_has_capability_at(target_building_id,target_capability,'gateway',target_gateway_id,evaluated_at));
$$;
CREATE OR REPLACE FUNCTION app_access_target_has_capability(target_building_id text,target_gateway_id text,target_device_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_access_target_has_capability_at(target_building_id,target_gateway_id,target_device_id,target_capability,statement_timestamp());
$$;

CREATE OR REPLACE FUNCTION app_access_has_capability_at(target_building_id text,target_gate_id text,target_capability text,evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT evaluated_at IS NOT NULL AND isfinite(evaluated_at)
   AND target_capability IN ('gates:read','gates:manage','commands:request','commands:read-own','commands:read')
   AND EXISTS (SELECT 1 FROM gates r
     WHERE r.id=CASE WHEN target_gate_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_gate_id::uuid END
       AND r.building_id=target_building_id AND app_access_parent_valid(r.building_id,r.gateway_id,r.device_id)
       AND (app_has_capability_at(r.building_id,target_capability,'gate',r.id::text,evaluated_at)
         OR app_has_capability_at(r.building_id,target_capability,'device',r.device_id,evaluated_at)
         OR app_has_capability_at(r.building_id,target_capability,'gateway',r.gateway_id,evaluated_at)));
$$;
CREATE OR REPLACE FUNCTION app_access_has_capability(target_building_id text,target_gate_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_access_has_capability_at(target_building_id,target_gate_id,target_capability,statement_timestamp());
$$;

CREATE OR REPLACE FUNCTION app_access_can_read_scope(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_has_capability(target_building_id,'gates:read') OR EXISTS (
   WITH candidates AS MATERIALIZED (SELECT rb.resource_type,rb.resource_id FROM role_bindings rb
     WHERE rb.building_id=target_building_id AND rb.resource_type IN ('gate','device','gateway')
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at))
   SELECT 1 FROM candidates c WHERE CASE c.resource_type
     WHEN 'gate' THEN app_access_has_capability(target_building_id,c.resource_id,'gates:read')
     WHEN 'device' THEN EXISTS (SELECT 1 FROM devices d WHERE d.id=c.resource_id AND d.building_id=target_building_id
       AND app_access_parent_valid(d.building_id,d.gateway_id,d.id) AND app_has_capability(d.building_id,'gates:read','device',d.id))
     WHEN 'gateway' THEN EXISTS (SELECT 1 FROM gateways g WHERE g.id=c.resource_id AND g.building_id=target_building_id
       AND app_has_capability(g.building_id,'gates:read','gateway',g.id))
     ELSE false END);
$$;

CREATE OR REPLACE FUNCTION app_access_request_permitted_at(target_building_id text,target_gate_id text,evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_access_has_capability_at(target_building_id,target_gate_id,'gates:read',evaluated_at)
   AND app_access_has_capability_at(target_building_id,target_gate_id,'commands:request',evaluated_at)
   AND EXISTS (SELECT 1 FROM gates g
     WHERE g.id=CASE WHEN target_gate_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_gate_id::uuid END
       AND g.building_id=target_building_id AND (g.allow_residents
         OR app_access_has_capability_at(g.building_id,g.id::text,'gates:manage',evaluated_at)));
$$;
CREATE OR REPLACE FUNCTION app_access_request_permitted(target_building_id text,target_gate_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_access_request_permitted_at(target_building_id,target_gate_id,statement_timestamp());
$$;

CREATE OR REPLACE FUNCTION app_access_command_can_read_at(target_building_id text,target_command_id text,evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM gate_commands c
   WHERE c.id=CASE WHEN target_command_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_command_id::uuid END
     AND c.building_id=target_building_id AND app_access_parent_valid(c.building_id,c.gateway_id,c.device_id)
     AND app_access_has_capability_at(c.building_id,c.gate_id::text,'gates:read',evaluated_at)
     AND (app_access_has_capability_at(c.building_id,c.gate_id::text,'commands:read',evaluated_at)
       OR (c.requested_by=app_current_user_id()
         AND app_access_has_capability_at(c.building_id,c.gate_id::text,'commands:read-own',evaluated_at))));
$$;
CREATE OR REPLACE FUNCTION app_access_command_can_read(target_building_id text,target_command_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_access_command_can_read_at(target_building_id,target_command_id,statement_timestamp());
$$;

-- These access features have no dependencies; global disable remains a ceiling.
-- Called only after authorization; this private predicate exposes no settings.
CREATE OR REPLACE FUNCTION app_access_feature_enabled(target_building_id text,target_kind text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_kind IN ('GARAGE','PEDESTRIAN')
   AND NOT EXISTS (SELECT 1 FROM global_feature_settings s
     WHERE s.feature_key=CASE target_kind WHEN 'GARAGE' THEN 'GARAGE_ACCESS' ELSE 'PEDESTRIAN_ACCESS' END AND NOT s.enabled)
   AND NOT EXISTS (SELECT 1 FROM building_feature_settings s WHERE s.building_id=target_building_id
     AND s.feature_key=CASE target_kind WHEN 'GARAGE' THEN 'GARAGE_ACCESS' ELSE 'PEDESTRIAN_ACCESS' END AND s.enabled=false);
$$;

CREATE OR REPLACE FUNCTION app_access_operational_reason(target_gate_id uuid,evaluated_at timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT NULLIF(COALESCE((SELECT CASE
   WHEN evaluated_at IS NULL OR NOT isfinite(evaluated_at) THEN 'Prazo de envio inválido'
   WHEN NOT g.enabled THEN 'Acesso desativado pela administração'
   WHEN NOT d.enabled OR NOT gw.enabled OR d.status<>'ONLINE' OR gw.status<>'ONLINE'
     OR d.last_seen_at IS NULL OR gw.last_seen_at IS NULL
     OR d.last_seen_at<evaluated_at-interval '60 seconds' OR gw.last_seen_at<evaluated_at-interval '60 seconds'
     OR d.last_seen_at>evaluated_at+interval '5 seconds' OR gw.last_seen_at>evaluated_at+interval '5 seconds'
     THEN 'Equipamento sem conexão recente. Tente novamente quando estiver online'
   ELSE '' END
 FROM gates g JOIN devices d ON d.id=g.device_id AND d.building_id=g.building_id AND d.gateway_id=g.gateway_id
 JOIN gateways gw ON gw.id=g.gateway_id AND gw.building_id=g.building_id
 WHERE g.id=target_gate_id AND app_access_parent_valid(g.building_id,g.gateway_id,g.device_id)),
 'Configuração de acesso alterada ou indisponível'),'');
$$;

-- Parent locks precede the gate lock, including unchanged parents. A grant on
-- one gate permits its current parents, never arbitrary inventory discovery.
CREATE OR REPLACE FUNCTION app_access_config_target(target_building_id text,target_gate_id text,target_gateway_id text,target_device_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_access_parent_valid(target_building_id,target_gateway_id,target_device_id) AND (
   (app_access_target_has_capability(target_building_id,target_gateway_id,target_device_id,'gates:read')
     AND app_access_target_has_capability(target_building_id,target_gateway_id,target_device_id,'gates:manage'))
   OR (app_access_has_capability(target_building_id,target_gate_id,'gates:read')
     AND app_access_has_capability(target_building_id,target_gate_id,'gates:manage')
     AND EXISTS (SELECT 1 FROM gates g WHERE g.id=CASE WHEN target_gate_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_gate_id::uuid END
       AND g.building_id=target_building_id AND g.gateway_id=target_gateway_id AND g.device_id=target_device_id)));
$$;
CREATE OR REPLACE FUNCTION app_access_lock_target(target_building_id text,target_gate_id text,target_gateway_id text,target_device_id text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF target_gate_id IS NOT NULL AND NOT (app_access_has_capability(target_building_id,target_gate_id,'gates:read')
   AND app_access_has_capability(target_building_id,target_gate_id,'gates:manage')) THEN RETURN false; END IF;
 IF NOT app_access_config_target(target_building_id,target_gate_id,target_gateway_id,target_device_id) THEN RETURN false; END IF;
 PERFORM id FROM devices WHERE id=target_device_id AND building_id=target_building_id FOR KEY SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM id FROM gateways WHERE id=target_gateway_id AND building_id=target_building_id FOR KEY SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Refresh the snapshot and validity windows after either parent lock waited.
 RETURN (target_gate_id IS NULL OR (
   app_access_has_capability_at(target_building_id,target_gate_id,'gates:read',clock_timestamp())
   AND app_access_has_capability_at(target_building_id,target_gate_id,'gates:manage',clock_timestamp())))
   AND (app_access_target_has_capability_at(target_building_id,target_gateway_id,target_device_id,'gates:read',clock_timestamp())
     AND app_access_target_has_capability_at(target_building_id,target_gateway_id,target_device_id,'gates:manage',clock_timestamp())
     OR (target_gate_id IS NOT NULL AND EXISTS (SELECT 1 FROM gates g WHERE g.id=target_gate_id::uuid AND g.building_id=target_building_id
       AND g.gateway_id=target_gateway_id AND g.device_id=target_device_id)));
END $$;

CREATE OR REPLACE FUNCTION app_access_hardware_state(target_building_id text,target_gate_id uuid)
RETURNS TABLE(gateway_enabled boolean,gateway_status text,gateway_last_seen_at timestamptz,
 device_enabled boolean,device_status text,device_last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT gw.enabled,gw.status::text,gw.last_seen_at,d.enabled,d.status::text,d.last_seen_at
 FROM gates g JOIN gateways gw ON gw.id=g.gateway_id AND gw.building_id=g.building_id
 JOIN devices d ON d.id=g.device_id AND d.building_id=g.building_id AND d.gateway_id=gw.id
 WHERE g.id=target_gate_id AND g.building_id=target_building_id
   AND app_access_has_capability(g.building_id,g.id::text,'gates:read');
$$;

DROP POLICY IF EXISTS gates_read ON gates;
DROP POLICY IF EXISTS gates_manage ON gates;
DROP POLICY IF EXISTS gates_insert ON gates;
DROP POLICY IF EXISTS gates_update ON gates;
-- The row-based target branch also authorizes INSERT RETURNING before the new
-- gate is visible to a STABLE lookup helper. It grants no different stored rows.
CREATE POLICY gates_read ON gates FOR SELECT TO predioon_app USING(
 app_access_target_has_capability(building_id,gateway_id,device_id,'gates:read')
 OR app_access_has_capability(building_id,id::text,'gates:read'));
CREATE POLICY gates_insert ON gates FOR INSERT TO predioon_app WITH CHECK(
 app_access_target_has_capability(building_id,gateway_id,device_id,'gates:read')
 AND app_access_target_has_capability(building_id,gateway_id,device_id,'gates:manage'));
CREATE POLICY gates_update ON gates FOR UPDATE TO predioon_app
 USING(app_access_has_capability(building_id,id::text,'gates:read') AND app_access_has_capability(building_id,id::text,'gates:manage'))
 WITH CHECK(app_access_has_capability(building_id,id::text,'gates:read') AND app_access_has_capability(building_id,id::text,'gates:manage'));
REVOKE INSERT,UPDATE,DELETE ON gates FROM predioon_app;
GRANT INSERT(building_id,name,kind,gateway_id,device_id,enabled,allow_residents) ON gates TO predioon_app;
GRANT UPDATE(name,kind,gateway_id,device_id,enabled,allow_residents,updated_at) ON gates TO predioon_app;
DROP POLICY IF EXISTS gate_commands_read ON gate_commands;
DROP POLICY IF EXISTS gate_commands_request ON gate_commands;
CREATE POLICY gate_commands_read ON gate_commands FOR SELECT TO predioon_app USING(app_access_command_can_read(building_id,id::text));
REVOKE INSERT,UPDATE,DELETE ON gate_commands FROM predioon_app;

CREATE OR REPLACE FUNCTION check_access_hardware()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT app_access_parent_valid(NEW.building_id,NEW.gateway_id,NEW.device_id) THEN
   RAISE EXCEPTION 'Controlador e gateway fora do escopo do acesso' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app_access_target_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (OLD.device_id IS DISTINCT FROM NEW.device_id OR OLD.gateway_id IS DISTINCT FROM NEW.gateway_id)
   AND app_current_user_id() IS NOT NULL AND NOT (
     app_access_target_has_capability(NEW.building_id,NEW.gateway_id,NEW.device_id,'gates:read')
     AND app_access_target_has_capability(NEW.building_id,NEW.gateway_id,NEW.device_id,'gates:manage'))
 THEN RAISE EXCEPTION 'Access destination is outside the current grant' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS access_target_guard ON gates;
CREATE TRIGGER access_target_guard BEFORE UPDATE ON gates FOR EACH ROW EXECUTE FUNCTION app_access_target_guard();

DROP POLICY IF EXISTS building_features_access_read ON building_feature_settings;
CREATE POLICY building_features_access_read ON building_feature_settings FOR SELECT TO predioon_app USING(app_access_can_read_scope(building_id));
DROP POLICY IF EXISTS feature_runtime_access_read ON feature_runtime;
CREATE POLICY feature_runtime_access_read ON feature_runtime FOR SELECT TO predioon_app USING(app_access_can_read_scope(building_id));
DO $$ DECLARE definition text; anchor text; BEGIN
 SELECT pg_get_functiondef('app_can_read_feature_event(text)'::regprocedure) INTO STRICT definition;
 anchor:='OR app_equipment_can_read_scope(b.id,''gateway'')';
 IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'Unexpected feature event function shape'; END IF;
 definition:=replace(definition,'OR app_access_can_read_scope(b.id)','');
 EXECUTE replace(definition,anchor,anchor || E'\n     OR app_access_can_read_scope(b.id)');
END $$;
DO $$ DECLARE expression text; branches text; action_name text; BEGIN
 SELECT pg_get_expr(polwithcheck,polrelid) INTO STRICT expression FROM pg_policy WHERE polrelid='audit_logs'::regclass AND polname='audit_logs_insert_policy';
 IF expression NOT LIKE '%CASE action%' OR expression NOT LIKE '%ELSE%' THEN RAISE EXCEPTION 'Unexpected audit policy shape'; END IF;
 branches:=$branches$
 WHEN 'ACCESS_CONFIG_CREATED'::text THEN resource_type='gate' AND building_id IS NOT NULL
   AND app_access_has_capability(building_id,resource_id,'gates:read') AND app_access_has_capability(building_id,resource_id,'gates:manage')
 WHEN 'ACCESS_CONFIG_UPDATED'::text THEN resource_type='gate' AND building_id IS NOT NULL
   AND app_access_has_capability(building_id,resource_id,'gates:read') AND app_access_has_capability(building_id,resource_id,'gates:manage')
 WHEN 'ACCESS_OPEN_REQUESTED'::text THEN false
 WHEN 'ACCESS_REQUEST_REPEATED'::text THEN false
 $branches$;
 FOREACH action_name IN ARRAY ARRAY['ACCESS_CONFIG_CREATED','ACCESS_CONFIG_UPDATED','ACCESS_OPEN_REQUESTED','ACCESS_REQUEST_REPEATED'] LOOP
   expression:=regexp_replace(expression,'WHEN ''' || action_name || '''::text THEN .*?(?=WHEN |ELSE)','','ns');
 END LOOP;
 EXECUTE 'ALTER POLICY audit_logs_insert_policy ON audit_logs WITH CHECK (' || regexp_replace(expression,'ELSE',branches || ' ELSE') || ')';
END $$;

-- Controlled command admission derives every physical target from the gate.
CREATE OR REPLACE FUNCTION app_request_access(target_gate_id uuid,target_request_id uuid,request_ip text DEFAULT NULL,request_user_agent text DEFAULT NULL)
RETURNS TABLE(command jsonb,repeated boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor text; current_gate gates%ROWTYPE; next_gate gates%ROWTYPE;
 current_command gate_commands%ROWTYPE; evaluated_at timestamptz; reason text;
BEGIN
 actor:=app_current_user_id();
 IF actor IS NULL OR target_gate_id IS NULL OR target_request_id IS NULL THEN
   RAISE EXCEPTION 'Sem permissão atual para este acesso' USING ERRCODE='42501';
 END IF;
 -- Feature transitions hold this lock exclusively and cancel pending commands.
 PERFORM pg_advisory_xact_lock_shared(814772,1);
 PERFORM pg_advisory_xact_lock(hashtextextended('access:user:' || actor,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('access:gate:' || target_gate_id::text,0));
 evaluated_at:=clock_timestamp();
 SELECT * INTO current_gate FROM gates WHERE id=target_gate_id;
 IF NOT FOUND OR NOT app_access_request_permitted_at(current_gate.building_id,target_gate_id::text,evaluated_at) THEN
   RAISE EXCEPTION 'Sem permissão atual para este acesso' USING ERRCODE='42501';
 END IF;
 IF NOT app_access_feature_enabled(current_gate.building_id,current_gate.kind) THEN
   RAISE EXCEPTION 'Funcionalidade de acesso pausada' USING ERRCODE='PF001';
 END IF;
 SELECT * INTO current_command FROM gate_commands WHERE requested_by=actor AND request_id=target_request_id;
 IF FOUND THEN
   IF current_command.gate_id<>target_gate_id THEN
     RAISE EXCEPTION 'Identificador de solicitação já utilizado em outro acesso' USING ERRCODE='P0001';
   END IF;
   -- Request authority does not provide an alternate route to revoked history.
   IF NOT app_access_command_can_read_at(current_command.building_id,current_command.id::text,clock_timestamp()) THEN
     RAISE EXCEPTION 'Sem permissão atual para consultar esta solicitação' USING ERRCODE='42501';
   END IF;
   INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata,ip_address,user_agent,created_at)
   VALUES(current_gate.building_id,actor,'USER','ACCESS_REQUEST_REPEATED','gate',target_gate_id::text,
     jsonb_build_object('commandId',current_command.id,'requestId',target_request_id),left(request_ip,128),left(request_user_agent,512),clock_timestamp());
   SELECT * INTO current_gate FROM gates WHERE id=target_gate_id;
   evaluated_at:=clock_timestamp();
   IF NOT app_access_request_permitted_at(current_gate.building_id,target_gate_id::text,evaluated_at)
     OR NOT app_access_command_can_read_at(current_command.building_id,current_command.id::text,evaluated_at) THEN
     RAISE EXCEPTION 'Sem permissão atual para consultar esta solicitação' USING ERRCODE='42501'; END IF;
   IF NOT app_access_feature_enabled(current_gate.building_id,current_gate.kind) THEN
     RAISE EXCEPTION 'Funcionalidade de acesso pausada' USING ERRCODE='PF001'; END IF;
   RETURN QUERY SELECT to_jsonb(current_command),true;
   RETURN;
 END IF;

 -- SHARE blocks non-key enabled/status updates too. Device precedes gateway,
 -- matching telemetry; gate configuration acquires proposed parents first.
 PERFORM id FROM devices WHERE id=current_gate.device_id AND building_id=current_gate.building_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Configuração de acesso alterada ou indisponível' USING ERRCODE='P0001'; END IF;
 PERFORM id FROM gateways WHERE id=current_gate.gateway_id AND building_id=current_gate.building_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Configuração de acesso alterada ou indisponível' USING ERRCODE='P0001'; END IF;
 PERFORM id FROM gates WHERE id=target_gate_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sem permissão atual para este acesso' USING ERRCODE='42501'; END IF;
 -- A fresh statement after waits sees revocation/expiry and the current parents.
 SELECT * INTO next_gate FROM gates WHERE id=target_gate_id;
 IF next_gate.building_id IS DISTINCT FROM current_gate.building_id
   OR next_gate.gateway_id IS DISTINCT FROM current_gate.gateway_id
   OR next_gate.device_id IS DISTINCT FROM current_gate.device_id THEN
   RAISE EXCEPTION 'Configuração de acesso alterada ou indisponível' USING ERRCODE='P0001';
 END IF;
 current_gate:=next_gate;
 evaluated_at:=clock_timestamp();
 IF NOT app_access_request_permitted_at(current_gate.building_id,target_gate_id::text,evaluated_at) THEN
   RAISE EXCEPTION 'Sem permissão atual para este acesso' USING ERRCODE='42501';
 END IF;
 IF NOT app_access_feature_enabled(current_gate.building_id,current_gate.kind) THEN
   RAISE EXCEPTION 'Funcionalidade de acesso pausada' USING ERRCODE='PF001';
 END IF;
 reason:=app_access_operational_reason(target_gate_id,evaluated_at);
 IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='P0001'; END IF;
 IF EXISTS (SELECT 1 FROM gate_commands c WHERE c.gate_id=target_gate_id
   AND (c.created_at>evaluated_at-interval '5 seconds'
     OR (c.status IN ('PENDING','SENT') AND c.expires_at>evaluated_at))) THEN
   RAISE EXCEPTION 'Aguarde a confirmação e alguns segundos antes de solicitar outra abertura' USING ERRCODE='P0429';
 END IF;
 INSERT INTO gate_commands(request_id,gate_id,building_id,gateway_id,device_id,requested_by,status,created_at,expires_at)
 VALUES(target_request_id,target_gate_id,current_gate.building_id,current_gate.gateway_id,current_gate.device_id,actor,'PENDING',evaluated_at,evaluated_at+interval '15 seconds')
 RETURNING * INTO current_command;
 -- User/building FK checks may also wait. Start the visible TTL after all such
 -- waits and deny a revocation before the admission decision. No row is visible
 -- to the dispatcher until this transaction (including audit) commits.
 evaluated_at:=clock_timestamp();
 IF NOT app_access_request_permitted_at(current_gate.building_id,target_gate_id::text,evaluated_at) THEN
   RAISE EXCEPTION 'Sem permissão atual para este acesso' USING ERRCODE='42501';
 END IF;
 reason:=app_access_operational_reason(target_gate_id,evaluated_at);
 IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='P0001'; END IF;
 UPDATE gate_commands SET created_at=evaluated_at,expires_at=evaluated_at+interval '15 seconds'
 WHERE id=current_command.id RETURNING * INTO current_command;
 INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata,ip_address,user_agent,created_at)
 VALUES(current_gate.building_id,actor,'USER','ACCESS_OPEN_REQUESTED','gate',target_gate_id::text,
   jsonb_build_object('commandId',current_command.id,'requestId',target_request_id),left(request_ip,128),left(request_user_agent,512),evaluated_at);
 evaluated_at:=clock_timestamp();
 IF NOT app_access_request_permitted_at(current_gate.building_id,target_gate_id::text,evaluated_at) THEN
   RAISE EXCEPTION 'Sem permissão atual para este acesso' USING ERRCODE='42501'; END IF;
 IF NOT app_access_feature_enabled(current_gate.building_id,current_gate.kind) THEN
   RAISE EXCEPTION 'Funcionalidade de acesso pausada' USING ERRCODE='PF001'; END IF;
 reason:=app_access_operational_reason(target_gate_id,evaluated_at);
 IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='P0001'; END IF;
 IF current_command.expires_at<=evaluated_at THEN
   RAISE EXCEPTION 'Prazo de envio encerrado' USING ERRCODE='P0001'; END IF;
 RETURN QUERY SELECT to_jsonb(current_command),false;
END $$;

-- Owner/service only. The actor comes exclusively from the persisted command.
-- Caller holds the command row and the outer shared feature lock. This function
-- locks physical parents through SENT commit and restores the caller context.
CREATE OR REPLACE FUNCTION app_mark_access_sent(target_command_id uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_command gate_commands%ROWTYPE; current_gate gates%ROWTYPE;
 previous_actor text; evaluated_at timestamptz; reason text; sent_audit_id uuid; changed integer;
BEGIN
 previous_actor:=current_setting('app.user_id',true);
 SELECT * INTO current_command FROM gate_commands WHERE id=target_command_id FOR UPDATE;
 IF NOT FOUND OR current_command.status<>'PENDING' THEN RETURN 'Solicitação não está pendente'; END IF;
 PERFORM id FROM devices WHERE id=current_command.device_id AND building_id=current_command.building_id FOR SHARE;
 PERFORM id FROM gateways WHERE id=current_command.gateway_id AND building_id=current_command.building_id FOR SHARE;
 PERFORM id FROM gates WHERE id=current_command.gate_id FOR SHARE;
 SELECT * INTO current_gate FROM gates WHERE id=current_command.gate_id;
 IF NOT FOUND OR current_gate.building_id<>current_command.building_id
   OR current_gate.gateway_id<>current_command.gateway_id OR current_gate.device_id<>current_command.device_id
   OR NOT app_access_parent_valid(current_command.building_id,current_command.gateway_id,current_command.device_id)
 THEN RETURN 'Configuração de acesso alterada ou indisponível'; END IF;
 PERFORM set_config('app.user_id',current_command.requested_by,true);
 evaluated_at:=clock_timestamp();
 IF NOT app_access_request_permitted_at(current_command.building_id,current_command.gate_id::text,evaluated_at)
 THEN reason:='Sem permissão atual para este acesso';
 ELSIF NOT app_access_feature_enabled(current_command.building_id,current_gate.kind)
 THEN reason:='Funcionalidade de acesso pausada; solicite novamente após a retomada';
 ELSIF current_command.expires_at<=evaluated_at THEN reason:='Prazo de envio encerrado';
 ELSE reason:=app_access_operational_reason(current_command.gate_id,evaluated_at); END IF;
 IF reason IS NULL THEN
   -- Audit FK/trigger waits happen before the final permission/clock decision.
   INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
   VALUES(current_command.building_id,current_command.requested_by,'SYSTEM','ACCESS_COMMAND_SENT','gate',current_command.gate_id::text,
     jsonb_build_object('commandId',current_command.id)) RETURNING id INTO sent_audit_id;
   WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
   UPDATE gate_commands c SET status='SENT',sent_at=decision.at FROM decision
   WHERE c.id=current_command.id AND c.status='PENDING' AND c.expires_at>decision.at
     AND app_access_request_permitted_at(c.building_id,c.gate_id::text,decision.at)
     AND app_access_feature_enabled(c.building_id,current_gate.kind)
     AND app_access_operational_reason(c.gate_id,decision.at) IS NULL;
   GET DIAGNOSTICS changed=ROW_COUNT;
   IF changed<>1 THEN
     DELETE FROM audit_logs WHERE id=sent_audit_id;
     reason:='Permissão, conexão ou prazo alterado antes do envio';
   END IF;
 END IF;
 PERFORM set_config('app.user_id',coalesce(previous_actor,''),true);
 RETURN reason;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.user_id',coalesce(previous_actor,''),true);
 RAISE;
END $$;

-- Remove obsolete legacy probes and ensure private clock/actor helpers cannot
-- be invoked by runtime, identity or broker roles, including on reapplication.
DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; helper_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOR helper,helper_name IN SELECT p.oid::regprocedure,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname LIKE 'app_access_%' OR p.proname IN ('app_request_access','app_mark_access_sent','check_access_hardware','app_can_read_feature_event')) LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
     JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
   IF helper_name IN ('app_access_target_has_capability','app_access_has_capability','app_access_can_read_scope',
     'app_access_request_permitted','app_access_command_can_read','app_access_config_target','app_access_lock_target',
     'app_access_hardware_state','app_request_access','app_can_read_feature_event')
   THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper); END IF;
 END LOOP;
END $$;
