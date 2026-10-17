-- The migration runner supplies the transaction and ledger. No credentials or
-- ownership transfers belong here. Existing human functions and extension ACLs
-- are deliberately left intact.
DO $hardening$
DECLARE role_name text; role_oid oid; item record; helper_owner name;
BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc
 WHERE oid='public.app_has_capability(text,text,text,text)'::regprocedure;

 -- PUBLIC is inherited by every login; a per-role REVOKE cannot deny it.
 -- Refuse contamination instead of changing rights of unknown consumers.
 IF EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
   WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type IN ('CREATE','TEMPORARY'))
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
   WHERE a.grantee=0 AND a.privilege_type='CREATE')
 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='public' AND a.grantee=0
   AND c.relkind IN ('r','p','v','m','f','S')
   AND NOT EXISTS(SELECT 1 FROM pg_depend e WHERE e.classid='pg_class'::regclass AND e.objid=c.oid AND e.deptype='e'))
 OR EXISTS(SELECT 1 FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   CROSS JOIN LATERAL aclexplode(t.attacl) a WHERE n.nspname='public' AND a.grantee=0
   AND NOT EXISTS(SELECT 1 FROM pg_depend e WHERE e.classid='pg_class'::regclass AND e.objid=c.oid AND e.deptype='e'))
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='EXECUTE'
     AND (p.prosecdef OR p.proname LIKE 'app\_%' ESCAPE '\' OR p.proname LIKE 'identity\_%' ESCAPE '\'
       OR p.proname LIKE 'notification\_%' ESCAPE '\' OR p.proname LIKE 'broker\_%' ESCAPE '\')
     -- 045 deliberately exposes one pure matcher of values supplied by its
     -- caller. Recognize only its complete canonical definition and effective
     -- ACL, never an app_* name or IMMUTABLE label alone.
     AND NOT coalesce((p.oid='public.app_automation_matches(public.automation_versions,text,public.alert_severity,text)'::regprocedure
       AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=helper_owner)
       AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')
       AND p.prokind='f' AND p.provolatile='i' AND NOT p.prosecdef AND NOT p.proleakproof AND NOT p.proisstrict
       AND NOT p.proretset AND p.prorettype='boolean'::regtype AND p.proparallel='u'
       AND p.proconfig IS NULL AND p.prosqlbody IS NULL AND p.probin IS NULL AND p.prosupport=0
       AND p.pronargdefaults=0 AND p.proargdefaults IS NULL AND p.proargmodes IS NULL
       AND p.proargnames=ARRAY['target','alert_type','alert_level','alert_device']::text[]
       AND coalesce(p.proacl,acldefault('f',p.proowner))=acldefault('f',p.proowner)
       AND replace(p.prosrc,E'\r\n',E'\n')=$matcher$
  -- Never NULL: an alert without a device does not satisfy a device-scoped version.
  SELECT COALESCE((cardinality(target.alert_types)=0 OR alert_type=ANY(target.alert_types))
    AND alert_level>=target.min_severity
    AND (target.device_id IS NULL OR target.device_id IS NOT DISTINCT FROM alert_device), false);
$matcher$),false)
     AND NOT EXISTS(SELECT 1 FROM pg_depend e WHERE e.classid='pg_proc'::regclass AND e.objid=p.oid AND e.deptype='e'))
 THEN RAISE EXCEPTION 'PUBLIC privileges prevent restricted service installation' USING ERRCODE='42501'; END IF;

 FOREACH role_name IN ARRAY ARRAY['predioon_ingest','predioon_access_service'] LOOP
   SELECT oid INTO role_oid FROM pg_roles WHERE rolname=role_name;
   IF FOUND AND EXISTS(SELECT 1 FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass
     AND d.refobjid=role_oid AND d.deptype='o') THEN
     RAISE EXCEPTION 'Service role owns objects; manual remediation required' USING ERRCODE='42501';
   END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['predioon_ingest','predioon_access_service'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('CREATE ROLE %I',role_name); END IF;
   EXECUTE format('ALTER ROLE %I NOLOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',role_name);
   SELECT oid INTO STRICT role_oid FROM pg_roles WHERE rolname=role_name;
   FOR item IN SELECT parent.rolname AS parent,child.rolname AS child FROM pg_auth_members m
     JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member
     WHERE m.roleid=role_oid OR m.member=role_oid LOOP
     EXECUTE format('REVOKE %I FROM %I',item.parent,item.child);
   END LOOP;
   -- Enumerate direct grants rather than relying on a schema-local blanket.
   FOR item IN SELECT DISTINCT c.oid,c.relkind,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee=role_oid AND c.relkind IN ('r','p','v','m','f','S') LOOP
     EXECUTE format('REVOKE ALL ON %s %I.%I FROM %I',CASE WHEN item.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,item.nspname,item.relname,role_name);
   END LOOP;
   FOR item IN SELECT DISTINCT n.nspname,c.relname,t.attname FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(t.attacl) a
     WHERE a.grantee=role_oid AND t.attnum>0 AND NOT t.attisdropped LOOP
     EXECUTE format('REVOKE ALL (%I) ON TABLE %I.%I FROM %I',item.attname,item.nspname,item.relname,role_name);
   END LOOP;
   FOR item IN SELECT DISTINCT p.oid::regprocedure AS signature FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=role_oid LOOP
     EXECUTE format('REVOKE ALL ON ROUTINE %s FROM %I',item.signature,role_name);
   END LOOP;
   FOR item IN SELECT DISTINCT n.nspname FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee=role_oid LOOP
     EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I',item.nspname,role_name);
   END LOOP;
   FOR item IN SELECT DISTINCT d.datname FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE a.grantee=role_oid LOOP
     EXECUTE format('REVOKE ALL ON DATABASE %I FROM %I',item.datname,role_name);
   END LOOP;
   FOR item IN SELECT DISTINCT pg_get_userbyid(d.defaclrole) AS owner,n.nspname,d.defaclobjtype
     FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
     CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee=role_oid LOOP
     EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I %s REVOKE ALL ON %s FROM %I',item.owner,
       CASE WHEN item.nspname IS NULL THEN '' ELSE format('IN SCHEMA %I',item.nspname) END,
       CASE item.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS' END,role_name);
   END LOOP;
   EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I',current_database(),role_name);
   EXECUTE format('GRANT USAGE ON SCHEMA public TO %I',role_name);
 END LOOP;
 -- Global default: IN SCHEMA would not remove the implicit global PUBLIC grant.
 EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',helper_owner);
END $hardening$;

CREATE FUNCTION public.service_runtime_guard(expected_role name) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authenticated oid;
BEGIN
 IF expected_role IS NULL OR expected_role NOT IN ('predioon_ingest','predioon_access_service') THEN
   RAISE EXCEPTION 'Invalid service identity' USING ERRCODE='42501'; END IF;
 SELECT a.usesysid INTO authenticated FROM pg_catalog.pg_stat_activity a WHERE a.pid=pg_catalog.pg_backend_pid();
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=authenticated AND r.rolname=expected_role
   AND session_user=expected_role AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolbypassrls
   AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid=r.oid OR m.member=r.oid)
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend d WHERE d.refclassid='pg_catalog.pg_authid'::regclass AND d.refobjid=r.oid AND d.deptype='o'))
 THEN RAISE EXCEPTION 'Authenticated restricted service required' USING ERRCODE='42501'; END IF;
END $$;

-- Private closed transition for expiration/refusal/publish failure. Callers
-- already hold the command row; copying it preserves all admission identities
-- and timestamps, including the originally admitted deadline.
CREATE FUNCTION public.service_runtime_finish_command(original public.gate_commands,target_status text,public_reason text,audit_action text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE desired public.gate_commands%ROWTYPE; actual public.gate_commands%ROWTYPE; audit public.audit_logs%ROWTYPE;
BEGIN
 IF NOT ((target_status='EXPIRED' AND audit_action='ACCESS_COMMAND_EXPIRED' AND original.status IN ('PENDING','SENT'))
   OR (target_status='FAILED' AND audit_action='ACCESS_COMMAND_FAILED' AND original.status IN ('PENDING','SENT')))
   OR public_reason IS NULL THEN RAISE EXCEPTION 'Invalid private command transition' USING ERRCODE='22023'; END IF;
 desired:=original; desired.status:=target_status; desired.failure_reason:=public_reason;
 audit:=public.service_runtime_write_audit(original.building_id,original.requested_by,audit_action,'gate',original.gate_id::text,
   CASE WHEN target_status='EXPIRED' THEN jsonb_build_object('commandId',original.id)
   ELSE jsonb_build_object('commandId',original.id,'reason',public_reason) END);
 UPDATE public.gate_commands c SET status=desired.status,failure_reason=desired.failure_reason
 WHERE c.id=original.id AND to_jsonb(c)=to_jsonb(original) RETURNING c.* INTO actual;
 IF NOT FOUND OR to_jsonb(actual) IS DISTINCT FROM to_jsonb(desired)
 OR NOT EXISTS(SELECT 1 FROM public.gate_commands c WHERE c.id=desired.id AND to_jsonb(c)=to_jsonb(desired)) THEN
   RAISE EXCEPTION 'Command transition write was not persisted' USING ERRCODE='40001'; END IF;
 PERFORM public.service_runtime_assert_audit(audit);
END $$;

CREATE FUNCTION public.access_service_next_pending() RETURNS TABLE(id uuid,building_id text,gateway_id text,gate_id uuid,device_id text,
 created_at timestamptz,expires_at timestamptz,gate_kind text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.service_runtime_guard('predioon_access_service');
 RETURN QUERY SELECT c.id,c.building_id,c.gateway_id,c.gate_id,c.device_id,c.created_at,c.expires_at,g.kind
 FROM public.gate_commands c LEFT JOIN public.gates g ON g.id=c.gate_id
 WHERE c.status='PENDING' ORDER BY c.created_at,c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED;
END $$;

CREATE FUNCTION public.access_service_expire_commands() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE command public.gate_commands%ROWTYPE; expired integer:=0;
BEGIN
 PERFORM public.service_runtime_guard('predioon_access_service');
 FOR command IN SELECT c.* FROM public.gate_commands c WHERE c.status IN ('PENDING','SENT')
   AND c.expires_at<=clock_timestamp() ORDER BY c.created_at,c.id FOR UPDATE LOOP
   IF command.status IN ('PENDING','SENT') AND command.expires_at<=clock_timestamp() THEN
     PERFORM public.service_runtime_finish_command(command,'EXPIRED','Prazo de confirmação encerrado','ACCESS_COMMAND_EXPIRED');
     expired:=expired+1;
   END IF;
 END LOOP;
 RETURN expired;
END $$;

CREATE FUNCTION public.access_service_fail_pending(target_command_id uuid,reason_code text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE command public.gate_commands%ROWTYPE; reason text;
BEGIN
 PERFORM public.service_runtime_guard('predioon_access_service');
 reason:=CASE reason_code
   WHEN 'NO_LIVE_CONNECTION' THEN 'Conexão indisponível no momento do pedido; reenvio bloqueado'
   WHEN 'BEFORE_CONNECTION' THEN 'Conexão indisponível no momento do pedido; reenvio bloqueado'
   WHEN 'FEATURE_PAUSED' THEN 'Funcionalidade de acesso pausada; solicite novamente após a retomada' END;
 IF reason IS NULL THEN RAISE EXCEPTION 'Invalid pending failure code' USING ERRCODE='22023'; END IF;
 SELECT c.* INTO command FROM public.gate_commands c WHERE c.id=target_command_id FOR UPDATE;
 IF NOT FOUND OR command.status<>'PENDING' THEN RETURN false; END IF;
 PERFORM public.service_runtime_finish_command(command,'FAILED',reason,'ACCESS_COMMAND_FAILED');
 RETURN true;
END $$;

CREATE FUNCTION public.access_service_mark_sent(target_command_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE original public.gate_commands%ROWTYPE; actual public.gate_commands%ROWTYPE; desired public.gate_commands%ROWTYPE;
 reason text; prior_audits uuid[]; audit public.audit_logs%ROWTYPE; audit_count integer; started timestamptz;
BEGIN
 PERFORM public.service_runtime_guard('predioon_access_service');
 SELECT c.* INTO original FROM public.gate_commands c WHERE c.id=target_command_id FOR UPDATE;
 IF NOT FOUND OR original.status<>'PENDING' THEN RETURN 'Solicitação não está pendente'; END IF;
 SELECT coalesce(array_agg(a.id),'{}'::uuid[]) INTO prior_audits FROM public.audit_logs a
 WHERE a.action='ACCESS_COMMAND_SENT' AND a.resource_id=original.gate_id::text;
 started:=clock_timestamp();
 -- The original owner function alone derives the actor, locks physical parents
 -- and rechecks capabilities/features/deadline after its audit waits.
 reason:=public.app_mark_access_sent(target_command_id);
 SELECT c.* INTO actual FROM public.gate_commands c WHERE c.id=target_command_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Command disappeared during send decision' USING ERRCODE='40001'; END IF;
 IF reason IS NOT NULL THEN
   IF reason NOT IN ('Solicitação não está pendente','Configuração de acesso alterada ou indisponível',
     'Sem permissão atual para este acesso','Funcionalidade de acesso pausada; solicite novamente após a retomada',
     'Prazo de envio encerrado','Prazo de envio inválido','Acesso desativado pela administração',
     'Equipamento sem conexão recente. Tente novamente quando estiver online','Permissão, conexão ou prazo alterado antes do envio')
   OR to_jsonb(actual) IS DISTINCT FROM to_jsonb(original) THEN
     RAISE EXCEPTION 'Invalid canonical send refusal' USING ERRCODE='40001'; END IF;
   PERFORM public.service_runtime_finish_command(original,'FAILED',reason,'ACCESS_COMMAND_FAILED');
   RETURN reason;
 END IF;
 desired:=original; desired.status:='SENT'; desired.sent_at:=actual.sent_at;
 IF actual.sent_at IS NULL OR actual.sent_at<started OR actual.sent_at>clock_timestamp() OR actual.sent_at>=original.expires_at
   OR to_jsonb(actual) IS DISTINCT FROM to_jsonb(desired) THEN
   RAISE EXCEPTION 'Command SENT write was not persisted' USING ERRCODE='40001'; END IF;
 SELECT count(*) INTO audit_count FROM public.audit_logs a WHERE a.action='ACCESS_COMMAND_SENT'
   AND a.resource_id=original.gate_id::text AND NOT (a.id=ANY(prior_audits));
 SELECT a.* INTO audit FROM public.audit_logs a WHERE a.action='ACCESS_COMMAND_SENT'
   AND a.resource_id=original.gate_id::text AND NOT (a.id=ANY(prior_audits));
 IF audit_count<>1 OR audit.building_id IS DISTINCT FROM original.building_id OR audit.user_id IS DISTINCT FROM original.requested_by
   OR audit.actor_type::text<>'SYSTEM' OR audit.scope_kind<>'BUILDING' OR audit.scope_building_id IS DISTINCT FROM original.building_id
   OR audit.resource_type<>'gate' OR audit.metadata IS DISTINCT FROM jsonb_build_object('commandId',original.id)
   OR audit.ip_address IS NOT NULL OR audit.user_agent IS NOT NULL THEN
   RAISE EXCEPTION 'Command SENT audit was not persisted' USING ERRCODE='40001'; END IF;
 PERFORM public.service_runtime_assert_audit(audit);
 RETURN NULL;
END $$;

CREATE FUNCTION public.access_service_fail_publish(target_command_id uuid,reason_code text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE command public.gate_commands%ROWTYPE; reason text;
BEGIN
 PERFORM public.service_runtime_guard('predioon_access_service');
 reason:=CASE reason_code WHEN 'DISCONNECTED' THEN 'Conexão MQTT indisponível'
   WHEN 'OFFLINE_QUEUE' THEN 'Fila MQTT precisa estar desabilitada' WHEN 'DEADLINE' THEN 'Comando expirado'
   WHEN 'BEFORE_CONNECTION' THEN 'Comando anterior à conexão; reenvio bloqueado' WHEN 'SEND_TIMEOUT' THEN 'Tempo de envio esgotado'
   WHEN 'PUBLISH_FAILURE' THEN 'Falha de envio' END;
 IF reason IS NULL THEN RAISE EXCEPTION 'Invalid publish failure code' USING ERRCODE='22023'; END IF;
 SELECT c.* INTO command FROM public.gate_commands c WHERE c.id=target_command_id FOR UPDATE;
 IF NOT FOUND OR command.status<>'SENT' THEN RETURN false; END IF;
 PERFORM public.service_runtime_finish_command(command,'FAILED',reason,'ACCESS_COMMAND_FAILED');
 RETURN true;
END $$;

CREATE FUNCTION public.access_service_apply_ack(target_command_id uuid,target_building_id text,target_gateway_id text,
 target_gate_id text,target_device_id text,ack_result text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE original public.gate_commands%ROWTYPE; desired public.gate_commands%ROWTYPE; audit public.audit_logs%ROWTYPE;
 actual jsonb; decided timestamptz; changed boolean; removed integer;
BEGIN
 PERFORM public.service_runtime_guard('predioon_access_service');
 IF ack_result IS NULL OR ack_result NOT IN ('EXECUTED','REJECTED') THEN
   RAISE EXCEPTION 'Invalid physical ACK result' USING ERRCODE='22023'; END IF;
 IF target_gate_id IS NULL OR target_gate_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
 SELECT c.* INTO original FROM public.gate_commands c WHERE c.id=target_command_id FOR UPDATE;
 IF NOT FOUND OR original.status<>'SENT' OR original.building_id IS DISTINCT FROM target_building_id
   OR original.gateway_id IS DISTINCT FROM target_gateway_id OR original.device_id IS DISTINCT FROM target_device_id
   OR original.gate_id IS DISTINCT FROM target_gate_id::uuid OR original.expires_at<=clock_timestamp() THEN RETURN false; END IF;
 PERFORM d.id FROM public.devices d WHERE d.id=original.device_id AND d.building_id=original.building_id
   AND d.gateway_id=original.gateway_id FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM g.id FROM public.gateways g WHERE g.id=original.gateway_id AND g.building_id=original.building_id AND g.enabled FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM g.id FROM public.gates g WHERE g.id=original.gate_id AND g.building_id=original.building_id
   AND g.gateway_id=original.gateway_id AND g.device_id=original.device_id FOR SHARE;
 IF NOT FOUND OR original.expires_at<=clock_timestamp() THEN RETURN false; END IF;
 desired:=original;
 desired.status:=CASE ack_result WHEN 'EXECUTED' THEN 'ACKNOWLEDGED' ELSE 'FAILED' END;
 desired.failure_reason:=CASE ack_result WHEN 'REJECTED' THEN 'Abertura recusada pelo controlador' ELSE NULL END;
 audit:=public.service_runtime_write_audit(original.building_id,original.requested_by,
   CASE ack_result WHEN 'EXECUTED' THEN 'ACCESS_COMMAND_ACKNOWLEDGED' ELSE 'ACCESS_COMMAND_REJECTED' END,
   'gate',original.gate_id::text,jsonb_build_object('commandId',original.id));
 -- A trigger/FK may have waited while inserting the audit. The decisive clock
 -- belongs to the UPDATE statement after all those waits, never its caller.
 WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at), written AS (
   UPDATE public.gate_commands c SET status=desired.status,acknowledged_at=decision.at,failure_reason=desired.failure_reason FROM decision
   WHERE c.id=original.id AND c.status='SENT' AND c.expires_at>decision.at AND c.building_id=target_building_id
     AND c.gateway_id=target_gateway_id AND c.gate_id=target_gate_id::uuid AND c.device_id=target_device_id
   RETURNING to_jsonb(c) AS persisted)
 SELECT written.persisted,decision.at INTO actual,decided FROM decision LEFT JOIN written ON true;
 changed:=actual IS NOT NULL;
 IF NOT changed THEN
   -- Only a genuine unchanged command whose deadline elapsed is a benign miss.
   -- A skipped UPDATE before expiry or an audit writer rewriting the command is
   -- an integrity failure, not an ACK success or an ordinary late response.
   IF original.expires_at>decided OR NOT EXISTS(SELECT 1 FROM public.gate_commands c
     WHERE c.id=original.id AND to_jsonb(c)=to_jsonb(original)) THEN
     RAISE EXCEPTION 'Physical ACK update was not persisted' USING ERRCODE='40001'; END IF;
   PERFORM public.service_runtime_assert_audit(audit);
   DELETE FROM public.audit_logs a WHERE a.id=audit.id AND to_jsonb(a)=to_jsonb(audit);
   GET DIAGNOSTICS removed=ROW_COUNT;
   IF removed<>1 OR EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.id=audit.id) THEN
     RAISE EXCEPTION 'Late ACK audit cleanup was not persisted' USING ERRCODE='40001'; END IF;
   RETURN false;
 END IF;
 desired.acknowledged_at:=decided;
 IF actual IS DISTINCT FROM to_jsonb(desired) OR NOT EXISTS(SELECT 1 FROM public.gate_commands c
   WHERE c.id=desired.id AND to_jsonb(c)=to_jsonb(desired)) THEN
   RAISE EXCEPTION 'Physical ACK write was not persisted' USING ERRCODE='40001'; END IF;
 PERFORM public.service_runtime_assert_audit(audit);
 RETURN true;
END $$;

-- Retain OIDs, predicates and explicit existing consumers. Only legacy PUBLIC
-- operational policies are retargeted; machine policies never consult app GUCs.
DO $$ DECLARE policy_row record; BEGIN
 FOR policy_row IN SELECT n.nspname,c.relname,policy.polname FROM pg_policy policy JOIN pg_class c ON c.oid=policy.polrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND policy.polroles=ARRAY[0::oid]
   AND c.relname IN ('buildings','devices','gateways','alert_rules','alerts','gates','monitoring_profiles','parking_lots',
     'ingest_events','telemetry','usage_cursors','daily_usage','global_feature_settings','building_feature_settings','feature_runtime') LOOP
   EXECUTE format('ALTER POLICY %I ON %I.%I TO predioon_app',policy_row.polname,policy_row.nspname,policy_row.relname);
 END LOOP;
END $$;

GRANT SELECT(id,active,timezone) ON public.buildings TO predioon_ingest;
GRANT SELECT(id,building_id,gateway_id,name,type,status,enabled,last_seen_at,created_at,updated_at),
 UPDATE(status,last_seen_at,updated_at) ON public.devices TO predioon_ingest;
GRANT SELECT(id,building_id,name,serial_number,model,firmware_version,protocol_version,status,enabled,last_seen_at,created_at,updated_at),
 UPDATE(status,last_seen_at,firmware_version,updated_at) ON public.gateways TO predioon_ingest;
GRANT SELECT(id,building_id,device_id,metric,operator,threshold,severity,alert_type,message_template,cooldown_seconds,enabled) ON public.alert_rules TO predioon_ingest;
GRANT SELECT(id,building_id,device_id,gateway_id,rule_id,severity,type,status,message,triggered_value,triggered_at,created_at) ON public.alerts TO predioon_ingest;
GRANT SELECT(id,building_id,device_id,kind) ON public.gates TO predioon_ingest;
GRANT SELECT ON public.monitoring_profiles,public.parking_lots TO predioon_ingest;
GRANT SELECT,INSERT ON public.ingest_events,public.telemetry,public.usage_cursors,public.daily_usage TO predioon_ingest;
GRANT UPDATE(last_at,last_value,good,continuous_seconds) ON public.usage_cursors TO predioon_ingest;
GRANT UPDATE(quantity,estimated_cost,covered_seconds,resets,samples,incomplete,first_at,last_at) ON public.daily_usage TO predioon_ingest;
GRANT SELECT ON public.global_feature_settings,public.building_feature_settings,public.feature_runtime TO predioon_ingest,predioon_access_service;

DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['buildings','devices','gateways','alert_rules','alerts','gates','monitoring_profiles','parking_lots',
   'telemetry','usage_cursors','daily_usage'] LOOP
   EXECUTE format('CREATE POLICY ingest_operational_read ON public.%I FOR SELECT TO predioon_ingest USING(true)',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['global_feature_settings','building_feature_settings','feature_runtime'] LOOP
   EXECUTE format('CREATE POLICY service_operational_read ON public.%I FOR SELECT TO predioon_ingest,predioon_access_service USING(true)',table_name);
 END LOOP;
END $$;
CREATE POLICY ingest_receipt_read ON public.ingest_events FOR SELECT TO predioon_ingest USING(source='MQTT');
CREATE POLICY ingest_device_heartbeat ON public.devices FOR UPDATE TO predioon_ingest USING(enabled)
 WITH CHECK(enabled AND (gateway_id IS NULL OR EXISTS(SELECT 1 FROM public.gateways g
   WHERE g.id=devices.gateway_id AND g.building_id=devices.building_id)));
CREATE POLICY ingest_gateway_heartbeat ON public.gateways FOR UPDATE TO predioon_ingest USING(enabled) WITH CHECK(enabled);
CREATE POLICY ingest_receipt_append ON public.ingest_events FOR INSERT TO predioon_ingest WITH CHECK(source='MQTT' AND EXISTS(
 SELECT 1 FROM public.devices d JOIN public.buildings b ON b.id=d.building_id
 WHERE d.id=ingest_events.device_id AND d.building_id=ingest_events.building_id AND d.enabled AND b.active
 AND (d.gateway_id IS NULL OR EXISTS(SELECT 1 FROM public.gateways g WHERE g.id=d.gateway_id AND g.building_id=d.building_id AND g.enabled))));
CREATE POLICY ingest_raw_append ON public.telemetry FOR INSERT TO predioon_ingest WITH CHECK(EXISTS(
 SELECT 1 FROM public.devices d JOIN public.buildings b ON b.id=d.building_id
 WHERE d.id=telemetry.device_id AND d.building_id=telemetry.building_id AND d.enabled AND b.active
 AND (d.gateway_id IS NULL OR EXISTS(SELECT 1 FROM public.gateways g WHERE g.id=d.gateway_id AND g.building_id=d.building_id AND g.enabled))));
DO $$ DECLARE table_name text; association text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['usage_cursors','daily_usage'] LOOP
   association:=format('EXISTS(SELECT 1 FROM public.monitoring_profiles p JOIN public.devices d ON d.id=p.device_id AND d.building_id=p.building_id
     JOIN public.buildings b ON b.id=p.building_id WHERE p.id=%I.profile_id AND p.building_id=%I.building_id AND p.enabled AND d.enabled AND b.active
     AND (d.gateway_id IS NULL OR EXISTS(SELECT 1 FROM public.gateways g WHERE g.id=d.gateway_id AND g.building_id=d.building_id AND g.enabled)))',table_name,table_name);
   EXECUTE format('CREATE POLICY ingest_usage_append ON public.%I FOR INSERT TO predioon_ingest WITH CHECK(%s)',table_name,association);
   EXECUTE format('CREATE POLICY ingest_usage_update ON public.%I FOR UPDATE TO predioon_ingest USING(%s) WITH CHECK(%s)',table_name,association,association);
 END LOOP;
END $$;

CREATE FUNCTION public.ingest_count_rejection(category text,target_building_id text DEFAULT '') RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE observed timestamptz;
BEGIN
 PERFORM public.service_runtime_guard('predioon_ingest');
 IF category IS NULL OR target_building_id IS NULL OR
   (CASE WHEN category IN ('INVALID_ENVELOPE','FUTURE_TIMESTAMP','UNKNOWN_SOURCE') THEN target_building_id<>''
        WHEN category IN ('CONTENT_CONFLICT','RETAINED_REPLAY') THEN NOT EXISTS(SELECT 1 FROM public.buildings b WHERE b.id=target_building_id AND b.id<>'')
        ELSE true END)
 THEN RAISE EXCEPTION 'Invalid rejection counter category or scope' USING ERRCODE='22023'; END IF;
 observed:=clock_timestamp();
 INSERT INTO public.ingest_rejections AS r(day,building_id,category,total,last_at)
 VALUES((observed AT TIME ZONE 'UTC')::date,target_building_id,category,1,observed)
 ON CONFLICT ON CONSTRAINT ingest_rejections_pkey DO UPDATE SET total=r.total+1,last_at=excluded.last_at;
END $$;

CREATE FUNCTION public.ingest_lock_monitoring_profiles(target_building_id text,target_device_id text) RETURNS TABLE(profile_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.service_runtime_guard('predioon_ingest');
 RETURN QUERY SELECT p.id FROM public.monitoring_profiles p JOIN public.devices d ON d.id=p.device_id AND d.building_id=p.building_id
 JOIN public.buildings b ON b.id=p.building_id
 WHERE p.building_id=target_building_id AND p.device_id=target_device_id AND p.enabled AND d.enabled AND b.active
   AND (d.gateway_id IS NULL OR EXISTS(SELECT 1 FROM public.gateways g WHERE g.id=d.gateway_id AND g.building_id=d.building_id AND g.enabled))
 ORDER BY p.id FOR UPDATE OF p;
END $$;

CREATE FUNCTION public.ingest_lock_parking_lot(target_building_id text,target_device_id text) RETURNS TABLE(lot_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.service_runtime_guard('predioon_ingest');
 RETURN QUERY SELECT lot.id FROM public.parking_lots lot JOIN public.devices d ON d.id=lot.sensor_id AND d.building_id=lot.building_id
 WHERE lot.building_id=target_building_id AND d.id=target_device_id AND target_building_id<>'' AND target_device_id<>''
 ORDER BY lot.id FOR UPDATE OF lot;
END $$;

CREATE FUNCTION public.ingest_alert_outbox_signature(source_id uuid,target_event_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
 PERFORM public.service_runtime_guard('predioon_ingest');
 SELECT jsonb_build_object('event',to_jsonb(e),
   'deliveries',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.event_deliveries d WHERE d.event_id=e.id),'[]'::jsonb),
   'witnesses',coalesce((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.delivery_id,w.clause_id) FROM public.delivery_witnesses w
     JOIN public.event_deliveries d ON d.id=w.delivery_id WHERE d.event_id=e.id),'[]'::jsonb),
   'features',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.delivery_id,f.clause_id,f.feature_key) FROM public.delivery_witness_features f
     JOIN public.event_deliveries d ON d.id=f.delivery_id WHERE d.event_id=e.id),'[]'::jsonb)) INTO snapshot
 FROM public.outbox_events e JOIN public.alerts a ON a.id=e.alert_id AND a.building_id=e.building_id
 JOIN public.buildings b ON b.id=a.building_id
 WHERE e.id=target_event_id AND a.id=source_id AND e.event_type='alert.raised';
 IF NOT FOUND THEN RAISE EXCEPTION 'Alert outbox identity was not persisted' USING ERRCODE='40001'; END IF;
 RETURN encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
END $$;

CREATE FUNCTION public.ingest_persist_alert(source_id uuid,target_building_id text,target_device_id text,target_gateway_id text,
 target_rule_id uuid,severity public.alert_severity,alert_type text,alert_message text,triggered_value jsonb,
 triggered_at timestamptz,source_created_at timestamptz) RETURNS TABLE(event_id uuid,signature text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE desired public.alerts%ROWTYPE; actual public.alerts%ROWTYPE; produced uuid;
BEGIN
 PERFORM public.service_runtime_guard('predioon_ingest');
 IF source_id IS NULL OR target_building_id IS NULL OR target_building_id='' OR severity IS NULL OR alert_type IS NULL OR alert_message IS NULL
 OR triggered_at IS NULL OR source_created_at IS NULL OR NOT isfinite(triggered_at) OR NOT isfinite(source_created_at)
 OR NOT EXISTS(SELECT 1 FROM public.buildings b WHERE b.id=target_building_id)
 OR (target_device_id IS NULL)=(target_gateway_id IS NULL)
 OR (target_device_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.devices d WHERE d.id=target_device_id AND d.building_id=target_building_id AND d.enabled))
 OR (target_gateway_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.gateways g WHERE g.id=target_gateway_id AND g.building_id=target_building_id AND g.enabled))
 OR (target_rule_id IS NOT NULL AND (target_gateway_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.alert_rules r
   WHERE r.id=target_rule_id AND r.building_id=target_building_id AND (r.device_id IS NULL OR r.device_id=target_device_id))))
 THEN RAISE EXCEPTION 'Invalid alert origin' USING ERRCODE='22023'; END IF;
 desired.id:=source_id; desired.building_id:=target_building_id; desired.device_id:=target_device_id; desired.gateway_id:=target_gateway_id;
 desired.rule_id:=target_rule_id; desired.severity:=severity; desired.type:=alert_type; desired.status:='OPEN'; desired.message:=alert_message;
 desired.triggered_value:=triggered_value; desired.triggered_at:=triggered_at; desired.created_at:=source_created_at;
 INSERT INTO public.alerts SELECT (desired).* RETURNING * INTO actual;
 IF NOT FOUND OR to_jsonb(actual) IS DISTINCT FROM to_jsonb(desired)
 OR NOT EXISTS(SELECT 1 FROM public.alerts a WHERE a.id=source_id AND to_jsonb(a)=to_jsonb(desired)) THEN
   RAISE EXCEPTION 'Alert source write was not persisted' USING ERRCODE='40001'; END IF;
 produced:=public.notification_enqueue_alert(source_id);
 IF NOT EXISTS(SELECT 1 FROM public.alerts a WHERE a.id=source_id AND to_jsonb(a)=to_jsonb(desired)) THEN
   RAISE EXCEPTION 'Alert source changed during enqueue' USING ERRCODE='40001'; END IF;
 RETURN QUERY SELECT produced,public.ingest_alert_outbox_signature(source_id,produced);
END $$;

-- Shared persistence checks are private to the fixed owner. Every caller supplies
-- a closed domain shape; neither service receives EXECUTE on these primitives.
CREATE FUNCTION public.service_runtime_assert_audit(desired public.audit_logs) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF desired.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.id=desired.id AND to_jsonb(a)=to_jsonb(desired)) THEN
   RAISE EXCEPTION 'Service audit write was not persisted' USING ERRCODE='40001'; END IF;
END $$;
CREATE FUNCTION public.service_runtime_write_audit(target_building_id text,target_user_id text,audit_action text,target_type text,target_id text,audit_metadata jsonb)
RETURNS public.audit_logs LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE desired public.audit_logs%ROWTYPE; actual public.audit_logs%ROWTYPE;
BEGIN
 desired.id:=gen_random_uuid(); desired.building_id:=target_building_id; desired.user_id:=target_user_id; desired.actor_type:='SYSTEM';
 desired.scope_kind:='BUILDING'; desired.scope_building_id:=target_building_id; desired.action:=audit_action;
 desired.resource_type:=target_type; desired.resource_id:=target_id; desired.metadata:=audit_metadata; desired.created_at:=clock_timestamp();
 INSERT INTO public.audit_logs SELECT (desired).* RETURNING * INTO actual;
 IF NOT FOUND OR to_jsonb(actual) IS DISTINCT FROM to_jsonb(desired) THEN
   RAISE EXCEPTION 'Service audit write was not persisted' USING ERRCODE='40001'; END IF;
 PERFORM public.service_runtime_assert_audit(desired);
 RETURN desired;
END $$;

CREATE FUNCTION public.ingest_write_parking_observation(target_lot_id uuid,target_building_id text,target_device_id text,target_event_id text,
 occupancy integer,observation_at timestamptz,written_at timestamptz,expected_version integer) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE desired public.parking_lots%ROWTYPE; actual public.parking_lots%ROWTYPE; audit public.audit_logs%ROWTYPE; previous_occupied integer; previous_actor text;
BEGIN
 PERFORM public.service_runtime_guard('predioon_ingest');
 previous_actor:=current_setting('app.user_id',true);
 SELECT lot.* INTO desired FROM public.parking_lots lot JOIN public.devices d ON d.id=lot.sensor_id AND d.building_id=lot.building_id
 WHERE lot.id=target_lot_id AND lot.building_id=target_building_id AND d.id=target_device_id FOR UPDATE OF lot;
 IF NOT FOUND OR desired.version IS DISTINCT FROM expected_version OR occupancy IS NULL OR observation_at IS NULL OR written_at IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.ingest_events e JOIN public.telemetry t
   ON t.event_id=e.event_id AND t.building_id=e.building_id AND t.device_id=e.device_id
   WHERE e.event_id=target_event_id AND e.building_id=target_building_id AND e.device_id=target_device_id AND e.source='MQTT'
     AND t.metric='parking_occupied' AND t.quality='GOOD' AND t.numeric_value=occupancy AND t.value=to_jsonb(occupancy) AND t.time=observation_at)
 THEN RETURN false; END IF;
 previous_occupied:=desired.occupied;
 desired.occupied:=occupancy; desired.source:='SENSOR'; desired.observed_at:=observation_at; desired.updated_at:=written_at; desired.version:=desired.version+1;
 -- The existing invoker trigger has human branches. Clear only its actor input,
 -- then restore it on both paths; never grant its private helpers to ingest.
 PERFORM set_config('app.user_id','',true);
 UPDATE public.parking_lots lot SET occupied=desired.occupied,source=desired.source,observed_at=desired.observed_at,
   updated_at=desired.updated_at,version=desired.version WHERE lot.id=desired.id RETURNING lot.* INTO actual;
 IF NOT FOUND OR to_jsonb(actual) IS DISTINCT FROM to_jsonb(desired) THEN
   RAISE EXCEPTION 'Parking observation write was not persisted' USING ERRCODE='40001'; END IF;
 audit:=public.service_runtime_write_audit(target_building_id,NULL,'PARKING_SENSOR_UPDATED','parking',desired.id::text,
   jsonb_build_object('eventId',target_event_id,'deviceId',target_device_id,'occupied',occupancy,'previousOccupied',previous_occupied));
 IF NOT EXISTS(SELECT 1 FROM public.parking_lots lot WHERE lot.id=desired.id AND to_jsonb(lot)=to_jsonb(desired)) THEN
   RAISE EXCEPTION 'Parking observation changed during audit' USING ERRCODE='40001'; END IF;
 PERFORM public.service_runtime_assert_audit(audit);
 PERFORM set_config('app.user_id',coalesce(previous_actor,''),true);
 RETURN true;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.user_id',coalesce(previous_actor,''),true);
 RAISE;
END $$;

-- Close every newly introduced function, including ACLs inherited from an
-- installation's owner defaults. Only the twelve exact public entry points get
-- a service grant. Existing functions, including extension functions, are not
-- changed. Extension PUBLIC schema/catalogue access is not a private app grant.
DO $$
DECLARE helper_owner name; helper record; grantee_name name;
 ingest_functions text[]:=ARRAY['ingest_count_rejection','ingest_lock_monitoring_profiles','ingest_lock_parking_lot',
   'ingest_persist_alert','ingest_alert_outbox_signature','ingest_write_parking_observation'];
 access_functions text[]:=ARRAY['access_service_next_pending','access_service_expire_commands','access_service_fail_pending',
   'access_service_mark_sent','access_service_fail_publish','access_service_apply_ack'];
BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='public.app_has_capability(text,text,text,text)'::regprocedure;
 FOR helper IN SELECT p.oid,p.oid::regprocedure AS signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname=ANY(ingest_functions) OR p.proname=ANY(access_functions)
   OR p.proname IN ('service_runtime_guard','service_runtime_assert_audit','service_runtime_write_audit','service_runtime_finish_command')) LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper.signature,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper.signature);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
     JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=helper.oid AND a.grantee<>p.proowner LOOP
     EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper.signature,grantee_name);
   END LOOP;
   IF helper.proname=ANY(ingest_functions) THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_ingest',helper.signature);
   ELSIF helper.proname=ANY(access_functions) THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_access_service',helper.signature); END IF;
 END LOOP;
END $$;
