-- Gate opening by the hourly QR shown on a totem tablet (add-on GATE_QR_ACCESS).
--
-- The QR is not a credential: opening still goes through the same admission as
-- the list button, with the same session, permissions, hardware checks, 5 s
-- throttle and pending-confirmation rule. The QR only proves that the reader saw
-- the totem during the current hour. Its HMAC is computed and verified by the
-- API, which holds GATE_QR_SECRET (the database has no pgcrypto); the database
-- keeps the per-gate generation that renewing bumps, and checks it under the
-- gate lock so a renewal cannot race an opening.
--
-- The add-on is released per condominium by a platform administrator: a
-- condominium without its own setting does not have it (resolveFeatures optIn).

DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['global_feature_settings','building_feature_settings','feature_runtime'] LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', target, target || '_key_check');
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (feature_key IN (
   ''WATER_TANK'',''WATER_CONSUMPTION'',''ENERGY_CONSUMPTION'',''ELECTRICAL'',''PUMP'',''WATER_LEAK'',''SEWAGE_LEAK'',
   ''SMOKE'',''TEMPERATURE'',''GAS'',''AI_ANALYSIS'',''GARAGE_ACCESS'',''PEDESTRIAN_ACCESS'',''GATE_QR_ACCESS'',''CAR_PARKING'',
   ''MOTORCYCLE_PARKING'',''NOTICES'',''RESERVATIONS'',''TICKETS'',''TICKET_GROUPING'',''TICKET_PRIORITY'',
   ''TRANSPARENCY'',''FINANCE'',''REMOTE_SUPPORT''))', target, target || '_key_check');
 END LOOP;
END $$;

-- The manager decides per gate whether residents must read the QR. Only the
-- renewal function changes the generation, so the runtime role cannot write it.
ALTER TABLE gates ADD COLUMN IF NOT EXISTS require_qr boolean NOT NULL DEFAULT false;
ALTER TABLE gates ADD COLUMN IF NOT EXISTS qr_generation integer NOT NULL DEFAULT 1 CONSTRAINT gates_qr_generation_ck CHECK (qr_generation > 0);
GRANT INSERT(require_qr) ON gates TO predioon_app;
GRANT UPDATE(require_qr) ON gates TO predioon_app;

-- A short code a manager issues and types on the tablet once. Only its SHA-256 is stored.
CREATE TABLE IF NOT EXISTS gate_totem_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id uuid NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  created_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT gate_totem_pairings_code_uq UNIQUE (code_hash),
  CONSTRAINT gate_totem_pairings_code_ck CHECK (octet_length(code_hash)=32),
  CONSTRAINT gate_totem_pairings_window_ck CHECK (expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
  CONSTRAINT gate_totem_pairings_used_ck CHECK (used_at IS NULL OR used_at>=created_at)
);
CREATE INDEX IF NOT EXISTS gate_totem_pairings_gate_idx ON gate_totem_pairings(gate_id, created_at DESC);

-- A paired tablet. Its bearer token only shows the current QR of one gate.
CREATE TABLE IF NOT EXISTS gate_totems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id uuid NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  label text NOT NULL,
  token_hash bytea NOT NULL,
  pairing_id uuid REFERENCES gate_totem_pairings(id) ON DELETE SET NULL,
  paired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by text REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT gate_totems_token_uq UNIQUE (token_hash),
  CONSTRAINT gate_totems_token_ck CHECK (octet_length(token_hash)=32),
  CONSTRAINT gate_totems_label_ck CHECK (label=btrim(label) AND char_length(label) BETWEEN 2 AND 60),
  CONSTRAINT gate_totems_revoked_ck CHECK (revoked_at IS NULL OR revoked_at>=paired_at)
);
CREATE INDEX IF NOT EXISTS gate_totems_gate_idx ON gate_totems(gate_id) WHERE revoked_at IS NULL;

ALTER TABLE gate_totem_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_totems ENABLE ROW LEVEL SECURITY;
-- Default privileges (002) would give the runtime role every column, hashes included.
REVOKE ALL ON TABLE gate_totem_pairings, gate_totems FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth,
  predioon_notifications, predioon_ingest, predioon_access_service;
GRANT SELECT (id, gate_id, building_id, label, paired_at, last_seen_at, revoked_at) ON TABLE gate_totems TO predioon_app;
DROP POLICY IF EXISTS gate_totems_manage_read ON gate_totems;
CREATE POLICY gate_totems_manage_read ON gate_totems FOR SELECT TO predioon_app USING (
  app_access_has_capability(building_id,gate_id::text,'gates:read')
  AND app_access_has_capability(building_id,gate_id::text,'gates:manage'));

-- Same rule as resolveFeatures: the gate's own kind is enabled, the add-on is not
-- switched off globally and this condominium has it released explicitly.
CREATE OR REPLACE FUNCTION app_gate_qr_enabled(target_building_id text,target_kind text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_access_feature_enabled(target_building_id,target_kind)
   AND NOT EXISTS (SELECT 1 FROM global_feature_settings s WHERE s.feature_key='GATE_QR_ACCESS' AND NOT s.enabled)
   AND EXISTS (SELECT 1 FROM building_feature_settings s
     WHERE s.building_id=target_building_id AND s.feature_key='GATE_QR_ACCESS' AND s.enabled);
$$;

-- The admission of 034, unchanged except for the channel. A gate that requires
-- the QR refuses list requests from non-managers while the add-on is on; the
-- requirement lives only here, so the dispatcher's later permission re-check
-- (app_mark_access_sent) is the same for both channels.
CREATE OR REPLACE FUNCTION app_request_access_admit(target_gate_id uuid,target_request_id uuid,request_ip text,request_user_agent text,
 via text,expected_qr_generation integer)
RETURNS TABLE(command jsonb,repeated boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor text; current_gate gates%ROWTYPE; next_gate gates%ROWTYPE;
 current_command gate_commands%ROWTYPE; evaluated_at timestamptz; reason text;
BEGIN
 actor:=app_current_user_id();
 IF actor IS NULL OR target_gate_id IS NULL OR target_request_id IS NULL OR via IS NULL OR via NOT IN ('LIST','QR')
   OR (via='QR')<>(expected_qr_generation IS NOT NULL) THEN
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
     jsonb_build_object('commandId',current_command.id,'requestId',target_request_id,'via',via),left(request_ip,128),left(request_user_agent,512),clock_timestamp());
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
 -- The gate row is held FOR SHARE from here on: a renewal (which updates it)
 -- waits for this admission, and the configuration read below is final.
 IF via='QR' THEN
   IF NOT app_gate_qr_enabled(current_gate.building_id,current_gate.kind) THEN
     RAISE EXCEPTION 'Abertura por QR indisponível neste condomínio' USING ERRCODE='PF001';
   END IF;
   IF current_gate.qr_generation<>expected_qr_generation THEN
     RAISE EXCEPTION 'QR expirado ou inválido. Leia o QR do totem novamente' USING ERRCODE='PQ404';
   END IF;
 ELSIF current_gate.require_qr AND app_gate_qr_enabled(current_gate.building_id,current_gate.kind)
   AND NOT app_access_has_capability_at(current_gate.building_id,target_gate_id::text,'gates:manage',evaluated_at) THEN
   RAISE EXCEPTION 'Este portão abre pelo QR do totem, no app do morador' USING ERRCODE='PQ403';
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
   jsonb_build_object('commandId',current_command.id,'requestId',target_request_id,'via',via),left(request_ip,128),left(request_user_agent,512),evaluated_at);
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

-- The public signature tests and the API rely on stays; it is the list channel.
CREATE OR REPLACE FUNCTION app_request_access(target_gate_id uuid,target_request_id uuid,request_ip text DEFAULT NULL,request_user_agent text DEFAULT NULL)
RETURNS TABLE(command jsonb,repeated boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 RETURN QUERY SELECT * FROM app_request_access_admit(target_gate_id,target_request_id,request_ip,request_user_agent,'LIST',NULL);
END $$;

-- Called by the API only after it verified the QR's HMAC for this generation.
CREATE OR REPLACE FUNCTION app_request_access_by_qr(target_gate_id uuid,qr_generation integer,target_request_id uuid,
 request_ip text DEFAULT NULL,request_user_agent text DEFAULT NULL)
RETURNS TABLE(command jsonb,repeated boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF qr_generation IS NULL THEN RAISE EXCEPTION 'QR expirado ou inválido. Leia o QR do totem novamente' USING ERRCODE='PQ404'; END IF;
 RETURN QUERY SELECT * FROM app_request_access_admit(target_gate_id,target_request_id,request_ip,request_user_agent,'QR',qr_generation);
END $$;

-- Invalidates the QR on every totem of the gate at once (a photo of it stops working).
CREATE OR REPLACE FUNCTION app_gate_qr_renew(target_gate_id uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor text; target gates%ROWTYPE; renewed integer;
BEGIN
 actor:=app_current_user_id();
 SELECT * INTO target FROM gates WHERE id=target_gate_id;
 IF actor IS NULL OR NOT FOUND OR NOT (app_access_has_capability(target.building_id,target.id::text,'gates:read')
   AND app_access_has_capability(target.building_id,target.id::text,'gates:manage')) THEN
   RAISE EXCEPTION 'Sem permissão atual para configurar este acesso' USING ERRCODE='42501';
 END IF;
 -- Waits for admissions holding the gate FOR SHARE; they finish on the old generation.
 PERFORM id FROM gates WHERE id=target.id FOR UPDATE;
 IF NOT app_gate_qr_enabled(target.building_id,target.kind) THEN
   RAISE EXCEPTION 'Abertura por QR indisponível neste condomínio' USING ERRCODE='PF001';
 END IF;
 UPDATE gates SET qr_generation=qr_generation+1,updated_at=clock_timestamp() WHERE id=target.id RETURNING qr_generation INTO renewed;
 INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
 VALUES(target.building_id,actor,'USER','ACCESS_QR_RENEWED','gate',target.id::text,jsonb_build_object('generation',renewed));
 RETURN renewed;
END $$;

-- Issuing a code replaces the unused ones of the same gate.
CREATE OR REPLACE FUNCTION app_gate_totem_pairing_create(target_gate_id uuid,candidate bytea)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor text; target gates%ROWTYPE; pairing gate_totem_pairings%ROWTYPE;
BEGIN
 actor:=app_current_user_id();
 IF candidate IS NULL OR octet_length(candidate)<>32 THEN RAISE EXCEPTION 'Código de pareamento inválido' USING ERRCODE='22023'; END IF;
 SELECT * INTO target FROM gates WHERE id=target_gate_id;
 IF actor IS NULL OR NOT FOUND OR NOT (app_access_has_capability(target.building_id,target.id::text,'gates:read')
   AND app_access_has_capability(target.building_id,target.id::text,'gates:manage')) THEN
   RAISE EXCEPTION 'Sem permissão atual para configurar este acesso' USING ERRCODE='42501';
 END IF;
 IF NOT app_gate_qr_enabled(target.building_id,target.kind) THEN
   RAISE EXCEPTION 'Abertura por QR indisponível neste condomínio' USING ERRCODE='PF001';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('access:totem-pairing:' || target.id::text,0));
 DELETE FROM gate_totem_pairings WHERE gate_id=target.id AND used_at IS NULL;
 INSERT INTO gate_totem_pairings(gate_id,building_id,code_hash,created_by,expires_at)
 VALUES(target.id,target.building_id,candidate,actor,clock_timestamp()+interval '10 minutes') RETURNING * INTO pairing;
 INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
 VALUES(target.building_id,actor,'USER','ACCESS_TOTEM_PAIRING_CREATED','gate',target.id::text,
   jsonb_build_object('pairingId',pairing.id,'expiresAt',pairing.expires_at));
 RETURN pairing.expires_at;
END $$;

-- Revoking stays possible while the add-on is off.
CREATE OR REPLACE FUNCTION app_gate_totem_revoke(target_gate_id uuid,target_totem_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor text; target gates%ROWTYPE; changed integer;
BEGIN
 actor:=app_current_user_id();
 SELECT * INTO target FROM gates WHERE id=target_gate_id;
 IF actor IS NULL OR NOT FOUND OR NOT (app_access_has_capability(target.building_id,target.id::text,'gates:read')
   AND app_access_has_capability(target.building_id,target.id::text,'gates:manage')) THEN
   RAISE EXCEPTION 'Sem permissão atual para configurar este acesso' USING ERRCODE='42501';
 END IF;
 UPDATE gate_totems SET revoked_at=clock_timestamp(),revoked_by=actor
 WHERE id=target_totem_id AND gate_id=target.id AND revoked_at IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=1 THEN
   INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
   VALUES(target.building_id,actor,'USER','ACCESS_TOTEM_REVOKED','gate',target.id::text,jsonb_build_object('totemId',target_totem_id));
 END IF;
 RETURN changed=1;
END $$;

-- Consumes a pairing code on the tablet, which has no session. The manager who
-- issued it must still manage the gate now. Returns NULL without telling which
-- condition failed.
CREATE OR REPLACE FUNCTION public.identity_totem_pair(candidate bytea,token bytea,totem_label text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pairing public.gate_totem_pairings%ROWTYPE; target public.gates%ROWTYPE; authorized boolean; totem_id uuid;
BEGIN
 IF candidate IS NULL OR octet_length(candidate)<>32 OR token IS NULL OR octet_length(token)<>32
   OR totem_label IS NULL OR totem_label<>btrim(totem_label) OR char_length(totem_label) NOT BETWEEN 2 AND 60 THEN
   RAISE EXCEPTION 'Invalid totem pairing' USING ERRCODE='22023';
 END IF;
 SELECT * INTO pairing FROM public.gate_totem_pairings WHERE code_hash=candidate FOR UPDATE;
 IF NOT FOUND OR pairing.used_at IS NOT NULL OR pairing.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 SELECT * INTO target FROM public.gates WHERE id=pairing.gate_id FOR SHARE;
 IF NOT FOUND OR NOT public.app_gate_qr_enabled(target.building_id,target.kind) THEN RETURN NULL; END IF;
 -- The helpers read the transaction-local actor, which this identity transaction
 -- otherwise never sets; it is cleared again before any row is written.
 PERFORM set_config('app.user_id',pairing.created_by,true);
 authorized:=public.app_access_has_capability(target.building_id,target.id::text,'gates:read')
   AND public.app_access_has_capability(target.building_id,target.id::text,'gates:manage');
 PERFORM set_config('app.user_id','',true);
 IF authorized IS NOT TRUE THEN RETURN NULL; END IF;
 UPDATE public.gate_totem_pairings SET used_at=clock_timestamp() WHERE id=pairing.id;
 INSERT INTO public.gate_totems(gate_id,building_id,label,token_hash,pairing_id)
 VALUES(target.id,target.building_id,totem_label,token,pairing.id) RETURNING id INTO totem_id;
 INSERT INTO public.audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
 VALUES(target.building_id,pairing.created_by,'USER','ACCESS_TOTEM_PAIRED','gate',target.id::text,
   jsonb_build_object('totemId',totem_id,'pairingId',pairing.id,'label',totem_label));
 RETURN totem_id;
END $$;

-- What a paired tablet may know to draw the QR. Contact is recorded at most once a minute.
CREATE OR REPLACE FUNCTION public.identity_totem_display(token bytea)
RETURNS TABLE(totem_id uuid,gate_id uuid,gate_name text,gate_kind text,building_name text,qr_generation integer,available boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE totem public.gate_totems%ROWTYPE;
BEGIN
 IF token IS NULL OR octet_length(token)<>32 THEN RETURN; END IF;
 SELECT * INTO totem FROM public.gate_totems t WHERE t.token_hash=token AND t.revoked_at IS NULL;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.gate_totems t SET last_seen_at=clock_timestamp()
 WHERE t.id=totem.id AND (t.last_seen_at IS NULL OR t.last_seen_at<clock_timestamp()-interval '1 minute');
 RETURN QUERY SELECT totem.id,g.id,g.name,g.kind,b.name,g.qr_generation,
   (b.active AND o.active AND g.enabled AND public.app_gate_qr_enabled(g.building_id,g.kind))
 FROM public.gates g JOIN public.buildings b ON b.id=g.building_id JOIN public.organizations o ON o.id=b.organization_id
 WHERE g.id=totem.gate_id;
END $$;

-- Same owner and ACL discipline as 034 and 042: private helpers run only inside
-- these definers; each public entry point is granted to exactly one role.
DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_gate_qr_enabled(text,text)'::regprocedure,
   'app_request_access_admit(uuid,uuid,text,text,text,integer)'::regprocedure,
   'app_request_access(uuid,uuid,text,text)'::regprocedure,
   'app_request_access_by_qr(uuid,integer,uuid,text,text)'::regprocedure,
   'app_gate_qr_renew(uuid)'::regprocedure,
   'app_gate_totem_pairing_create(uuid,bytea)'::regprocedure,
   'app_gate_totem_revoke(uuid,uuid)'::regprocedure,
   'public.identity_totem_pair(bytea,bytea,text)'::regprocedure,
   'public.identity_totem_display(bytea)'::regprocedure
 ] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
     JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
 END LOOP;
 GRANT EXECUTE ON FUNCTION app_request_access(uuid,uuid,text,text), app_request_access_by_qr(uuid,integer,uuid,text,text),
   app_gate_qr_renew(uuid), app_gate_totem_pairing_create(uuid,bytea), app_gate_totem_revoke(uuid,uuid) TO predioon_app;
 GRANT EXECUTE ON FUNCTION public.identity_totem_pair(bytea,bytea,text), public.identity_totem_display(bytea) TO predioon_identity;
END $$;
