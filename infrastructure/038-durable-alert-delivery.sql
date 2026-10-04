-- Durable webhook delivery. No historic alerts are backfilled here. Producers
-- must enqueue in their source transaction; rollout must drain direct senders.
DO $$ DECLARE parent_role text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='predioon_notifications') THEN
  CREATE ROLE predioon_notifications NOLOGIN;
 END IF;
 ALTER ROLE predioon_notifications NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
 FOR parent_role IN SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
   WHERE m.member='predioon_notifications'::regrole LOOP
  EXECUTE format('REVOKE %I FROM predioon_notifications',parent_role);
 END LOOP;
 -- NOINHERIT does not prevent a member from SET ROLE. Existing memberships
 -- INTO the runtime would let API/identity/broker logins bypass helper ACLs.
 FOR parent_role IN SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
   WHERE m.roleid='predioon_notifications'::regrole LOOP
  EXECUTE format('REVOKE predioon_notifications FROM %I',parent_role);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass
   AND refobjid='predioon_notifications'::regrole AND deptype='o') THEN
  RAISE EXCEPTION 'Notification runtime must not own database objects';
 END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO predioon_notifications',current_database());
 EXECUTE format('REVOKE CREATE,TEMP ON DATABASE %I FROM predioon_notifications',current_database());
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,predioon_notifications;
GRANT USAGE ON SCHEMA public TO predioon_notifications;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM predioon_notifications;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM predioon_notifications;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM predioon_notifications;

-- References deliberately do not cascade from alerts/buildings: source deletion
-- must preserve the delivery's terminal tombstone and idempotency identity.
CREATE TABLE outbox_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text NOT NULL CHECK(event_type='alert.raised'),
 event_version integer NOT NULL CHECK(event_version=1), building_id text NOT NULL, alert_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(event_type,alert_id)
);
CREATE TABLE event_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES outbox_events(id),
 consumer text NOT NULL CHECK(consumer='webhook'), action text NOT NULL CHECK(action='alert.raised.v1'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','retry','inflight','delivered','cancelled','failed','no_destination')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(), lease_until timestamptz,
 claim_token uuid, claim_backend_pid integer, claim_backend_start timestamptz,
 failure_category text CHECK(failure_category IN ('SOURCE_GONE','FEATURE_INELIGIBLE','NETWORK','TIMEOUT','HTTP_RETRY','HTTP_PERMANENT','ATTEMPTS_EXHAUSTED','NO_DESTINATION')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,consumer,action),
 CHECK((status='inflight')=(lease_until IS NOT NULL AND claim_token IS NOT NULL AND claim_backend_pid IS NOT NULL AND claim_backend_start IS NOT NULL)),
 CHECK(status='inflight' OR (lease_until IS NULL AND claim_token IS NULL AND claim_backend_pid IS NULL AND claim_backend_start IS NULL))
);
CREATE INDEX event_deliveries_ready_idx ON event_deliveries(available_at,id) WHERE status IN ('pending','retry');
CREATE INDEX event_deliveries_expired_idx ON event_deliveries(lease_until,id) WHERE status='inflight';
CREATE INDEX outbox_events_building_idx ON outbox_events(building_id,id);
CREATE TABLE delivery_witnesses (
 delivery_id uuid NOT NULL REFERENCES event_deliveries(id), clause_id integer NOT NULL CHECK(clause_id BETWEEN 1 AND 32),
 PRIMARY KEY(delivery_id,clause_id)
);
CREATE TABLE delivery_witness_features (
 delivery_id uuid NOT NULL, clause_id integer NOT NULL, feature_key text NOT NULL,
 generation integer NOT NULL CHECK(generation>=0), PRIMARY KEY(delivery_id,clause_id,feature_key),
 FOREIGN KEY(delivery_id,clause_id) REFERENCES delivery_witnesses(delivery_id,clause_id),
 CHECK(feature_key IN ('WATER_TANK','WATER_CONSUMPTION','ENERGY_CONSUMPTION','ELECTRICAL','PUMP','WATER_LEAK','SEWAGE_LEAK','SMOKE','TEMPERATURE','GAS','AI_ANALYSIS','GARAGE_ACCESS','PEDESTRIAN_ACCESS','CAR_PARKING','MOTORCYCLE_PARKING'))
);
-- A session registration is private, never a capability granted to other roles.
-- begin/end must be standalone commands on a dedicated connection. A rollback
-- cannot undo a session advisory lock; any protocol/IO failure closes that client.
CREATE TABLE notification_attempts (
 backend_pid integer NOT NULL, backend_start timestamptz NOT NULL, opened_at timestamptz NOT NULL,
 claim_called boolean NOT NULL DEFAULT false, delivery_id uuid, PRIMARY KEY(backend_pid,backend_start)
);

CREATE FUNCTION notification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable notification origin' USING ERRCODE='42501'; END $$;
CREATE TRIGGER outbox_events_immutable BEFORE UPDATE OR DELETE ON outbox_events FOR EACH ROW EXECUTE FUNCTION notification_immutable();
CREATE TRIGGER delivery_witnesses_immutable BEFORE UPDATE OR DELETE ON delivery_witnesses FOR EACH ROW EXECUTE FUNCTION notification_immutable();
CREATE TRIGGER delivery_witness_features_immutable BEFORE UPDATE OR DELETE ON delivery_witness_features FOR EACH ROW EXECUTE FUNCTION notification_immutable();
CREATE FUNCTION notification_delivery_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.event_id,NEW.consumer,NEW.action,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.event_id,OLD.consumer,OLD.action,OLD.created_at) THEN
  RAISE EXCEPTION 'Immutable notification delivery identity' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_deliveries_identity BEFORE UPDATE ON event_deliveries FOR EACH ROW EXECUTE FUNCTION notification_delivery_identity();

CREATE FUNCTION notification_device_features(device_type text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE device_type
 WHEN 'WATER_LEVEL_SENSOR' THEN ARRAY['WATER_TANK'] WHEN 'WATER_METER' THEN ARRAY['WATER_CONSUMPTION']
 WHEN 'ENERGY_METER' THEN ARRAY['ENERGY_CONSUMPTION','ELECTRICAL'] WHEN 'PUMP_MONITOR' THEN ARRAY['PUMP']
 WHEN 'PHASE_MONITOR' THEN ARRAY['ELECTRICAL'] WHEN 'LEAK_SENSOR' THEN ARRAY['WATER_LEAK']
 WHEN 'SEWAGE_LEAK_SENSOR' THEN ARRAY['SEWAGE_LEAK'] WHEN 'GAS_SENSOR' THEN ARRAY['GAS']
 WHEN 'TEMPERATURE_SENSOR' THEN ARRAY['TEMPERATURE'] WHEN 'SMOKE_PANEL_RELAY' THEN ARRAY['SMOKE']
 WHEN 'GARAGE_GATE' THEN ARRAY['GARAGE_ACCESS'] WHEN 'PEDESTRIAN_GATE' THEN ARRAY['PEDESTRIAN_ACCESS']
 WHEN 'GATE_CONTROLLER' THEN ARRAY['GARAGE_ACCESS','PEDESTRIAN_ACCESS'] WHEN 'PARKING_SENSOR' THEN ARRAY['CAR_PARKING','MOTORCYCLE_PARKING'] ELSE ARRAY[]::text[] END
$$;
CREATE FUNCTION notification_metric_feature(metric text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE
 WHEN metric IN ('water_level_percent','volume_liters','distance_mm') THEN 'WATER_TANK'
 WHEN metric='water_total_m3' THEN 'WATER_CONSUMPTION' WHEN metric='energy_total_kwh' THEN 'ENERGY_CONSUMPTION'
 WHEN metric='pump_running' THEN 'PUMP'
 WHEN metric IN ('voltage_l1','voltage_l2','voltage_l3','current_l1','current_l2','current_l3','frequency_hz') THEN 'ELECTRICAL'
 WHEN metric='temperature_c' THEN 'TEMPERATURE' WHEN metric IN ('gas_detected','gas_ppm') THEN 'GAS'
 WHEN metric='smoke_detected' THEN 'SMOKE' WHEN metric IN ('water_leak_detected','leak_detected') THEN 'WATER_LEAK'
 WHEN metric='sewage_leak_detected' THEN 'SEWAGE_LEAK' END
$$;
CREATE FUNCTION notification_feature_allowed(target text, feature text, triggered timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT enabled FROM public.global_feature_settings WHERE feature_key=feature),true)
 AND coalesce((SELECT enabled FROM public.building_feature_settings WHERE building_id=target AND feature_key=feature),true)
 AND coalesce((SELECT resumed_at IS NULL OR triggered>resumed_at FROM public.feature_runtime WHERE building_id=target AND feature_key=feature),true)
$$;
-- DNF clauses reproduce services/ingest/features.ts permitsAlert. Each returned
-- clause is valid NOW. ALL is one array; ANY returns one singleton per valid
-- alternative. Empty requirements are core. Severity/status/enabled are not
-- accidentally added to the feature policy.
CREATE FUNCTION notification_alert_clauses(source_id uuid) RETURNS TABLE(required text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source public.alerts%ROWTYPE; device public.devices%ROWTYPE; requirements text[]; prefix text[]:=ARRAY[]::text[];
 metric text; feature text; usage_kind text; all_required boolean:=false; vehicle text;
BEGIN
 SELECT * INTO source FROM public.alerts WHERE id=source_id;
 IF NOT FOUND THEN RETURN; END IF;
 IF source.device_id IS NULL THEN
  IF source.gateway_id IS NOT NULL THEN required:=ARRAY[]::text[]; RETURN NEXT; END IF;
  RETURN;
 END IF;
 SELECT * INTO device FROM public.devices WHERE id=source.device_id AND building_id=source.building_id;
 IF NOT FOUND THEN RETURN; END IF;
 IF left(source.type,9)='ADAPTIVE_' THEN prefix:=ARRAY['AI_ANALYSIS']; END IF;
 usage_kind:=substring(source.type FROM '^(?:DAILY_|ADAPTIVE_)(ENERGY|WATER|PUMP)_');
 IF usage_kind IS NOT NULL THEN
  requirements:=ARRAY[CASE usage_kind WHEN 'ENERGY' THEN 'ENERGY_CONSUMPTION' WHEN 'WATER' THEN 'WATER_CONSUMPTION' ELSE 'PUMP' END]; all_required:=true;
 ELSIF source.type='PUMP_CONTINUOUS_LIMIT' THEN requirements:=ARRAY['PUMP']; all_required:=true;
 ELSE
  IF source.rule_id IS NOT NULL THEN SELECT r.metric INTO metric FROM public.alert_rules r WHERE r.id=source.rule_id; END IF;
  IF metric IS NOT NULL THEN
   all_required:=true;
   IF metric='parking_occupied' THEN
    SELECT vehicle_type INTO vehicle FROM public.parking_lots WHERE building_id=source.building_id AND sensor_id=device.id LIMIT 1;
    requirements:=CASE WHEN vehicle IS NULL THEN ARRAY['CAR_PARKING','MOTORCYCLE_PARKING'] WHEN vehicle='CAR' THEN ARRAY['CAR_PARKING'] ELSE ARRAY['MOTORCYCLE_PARKING'] END;
   ELSE
    feature:=public.notification_metric_feature(metric);
    requirements:=CASE WHEN feature IS NULL THEN public.notification_device_features(device.type) ELSE ARRAY[feature] END;
   END IF;
  ELSE
   requirements:=public.notification_device_features(device.type);
   IF device.type='PARKING_SENSOR' THEN
    SELECT vehicle_type INTO vehicle FROM public.parking_lots WHERE building_id=source.building_id AND sensor_id=device.id LIMIT 1;
    requirements:=CASE WHEN vehicle IS NULL THEN ARRAY['CAR_PARKING','MOTORCYCLE_PARKING'] WHEN vehicle='CAR' THEN ARRAY['CAR_PARKING'] ELSE ARRAY['MOTORCYCLE_PARKING'] END;
   ELSIF device.type='GATE_CONTROLLER' THEN
    SELECT array_agg(DISTINCT CASE kind WHEN 'GARAGE' THEN 'GARAGE_ACCESS' ELSE 'PEDESTRIAN_ACCESS' END ORDER BY CASE kind WHEN 'GARAGE' THEN 'GARAGE_ACCESS' ELSE 'PEDESTRIAN_ACCESS' END)
     INTO requirements FROM public.gates WHERE building_id=source.building_id AND device_id=device.id;
    requirements:=coalesce(requirements,ARRAY['GARAGE_ACCESS','PEDESTRIAN_ACCESS']);
   END IF;
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(prefix) f WHERE NOT public.notification_feature_allowed(source.building_id,f,source.triggered_at)) THEN RETURN; END IF;
 IF all_required OR cardinality(requirements)=0 THEN
  IF NOT EXISTS(SELECT 1 FROM unnest(requirements) f WHERE NOT public.notification_feature_allowed(source.building_id,f,source.triggered_at)) THEN
   required:=prefix||requirements; RETURN NEXT;
  END IF;
 ELSE
  FOREACH feature IN ARRAY requirements LOOP
   IF public.notification_feature_allowed(source.building_id,feature,source.triggered_at) THEN required:=prefix||ARRAY[feature]; RETURN NEXT; END IF;
  END LOOP;
 END IF;
END $$;

CREATE FUNCTION notification_delivery_eligible(target uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.event_deliveries d JOIN public.outbox_events e ON e.id=d.event_id
 JOIN public.alerts a ON a.id=e.alert_id AND a.building_id=e.building_id
 WHERE d.id=target AND EXISTS(SELECT 1 FROM public.notification_alert_clauses(a.id))
 AND EXISTS(SELECT 1 FROM public.delivery_witnesses w WHERE w.delivery_id=d.id AND NOT EXISTS(
  SELECT 1 FROM public.delivery_witness_features f WHERE f.delivery_id=w.delivery_id AND f.clause_id=w.clause_id
  AND (NOT public.notification_feature_allowed(e.building_id,f.feature_key,a.triggered_at)
   OR f.generation<>coalesce((SELECT generation FROM public.feature_runtime r WHERE r.building_id=e.building_id AND r.feature_key=f.feature_key),0)))))
$$;

-- One write path confirms row count, intended RETURNING values, and a separate
-- fresh read after immediate AFTER triggers. No successful no-op mutations.
CREATE FUNCTION notification_write_delivery(desired public.event_deliveries) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actual public.event_deliveries%ROWTYPE; persisted jsonb; BEGIN
 UPDATE public.event_deliveries SET status=desired.status,attempts=desired.attempts,available_at=desired.available_at,
 lease_until=desired.lease_until,claim_token=desired.claim_token,claim_backend_pid=desired.claim_backend_pid,
 claim_backend_start=desired.claim_backend_start,failure_category=desired.failure_category,updated_at=desired.updated_at
 WHERE id=desired.id RETURNING * INTO actual;
 IF NOT FOUND OR to_jsonb(actual) IS DISTINCT FROM to_jsonb(desired) THEN
  RAISE EXCEPTION 'Notification delivery write was not persisted' USING ERRCODE='40001';
 END IF;
 SELECT to_jsonb(d) INTO persisted FROM public.event_deliveries d WHERE id=desired.id;
 IF persisted IS DISTINCT FROM to_jsonb(desired) THEN RAISE EXCEPTION 'Notification delivery write was not persisted' USING ERRCODE='40001'; END IF;
END $$;
CREATE FUNCTION notification_cancel_delivery(target uuid, reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE desired public.event_deliveries%ROWTYPE; BEGIN
 SELECT * INTO STRICT desired FROM public.event_deliveries WHERE id=target FOR UPDATE;
 desired.status:='cancelled'; desired.failure_category:=reason; desired.updated_at:=clock_timestamp();
 desired.lease_until:=NULL; desired.claim_token:=NULL; desired.claim_backend_pid:=NULL; desired.claim_backend_start:=NULL;
 PERFORM public.notification_write_delivery(desired);
END $$;

CREATE FUNCTION notification_enqueue_alert(source_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source public.alerts%ROWTYPE; event public.outbox_events%ROWTYPE; delivery public.event_deliveries%ROWTYPE;
 actual_event public.outbox_events%ROWTYPE; actual_delivery public.event_deliveries%ROWTYPE; inserted boolean; evaluated timestamptz;
 clause record; feature text; clause_id integer:=0; generation integer; written integer; expected jsonb:='[]'; actual jsonb; features jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(814772,1);
 SELECT * INTO source FROM public.alerts WHERE id=source_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Notification source does not exist' USING ERRCODE='22023'; END IF;
 SELECT * INTO event FROM public.outbox_events WHERE event_type='alert.raised' AND alert_id=source_id;
 IF FOUND THEN
  IF event.building_id<>source.building_id THEN RAISE EXCEPTION 'Notification source identity changed' USING ERRCODE='40001'; END IF;
  RETURN event.id;
 END IF;
 evaluated:=clock_timestamp();
 event.id:=gen_random_uuid(); event.event_type:='alert.raised'; event.event_version:=1;
 event.building_id:=source.building_id; event.alert_id:=source_id; event.created_at:=evaluated;
 INSERT INTO public.outbox_events SELECT (event).* ON CONFLICT(event_type,alert_id) DO NOTHING RETURNING * INTO actual_event;
 inserted:=FOUND;
 IF NOT inserted THEN
  SELECT * INTO STRICT event FROM public.outbox_events WHERE event_type='alert.raised' AND alert_id=source_id;
  IF event.building_id<>source.building_id THEN RAISE EXCEPTION 'Notification source identity changed' USING ERRCODE='40001'; END IF;
  RETURN event.id;
 END IF;
 IF to_jsonb(actual_event) IS DISTINCT FROM to_jsonb(event)
  OR NOT EXISTS(SELECT 1 FROM public.outbox_events e WHERE to_jsonb(e)=to_jsonb(event)) THEN
  RAISE EXCEPTION 'Notification event write was not persisted' USING ERRCODE='40001';
 END IF;
 IF source.severity NOT IN ('HIGH','CRITICAL') THEN RETURN event.id; END IF;
 delivery.id:=gen_random_uuid(); delivery.event_id:=event.id; delivery.consumer:='webhook'; delivery.action:='alert.raised.v1';
 delivery.status:='pending'; delivery.attempts:=0; delivery.available_at:=evaluated; delivery.created_at:=evaluated; delivery.updated_at:=evaluated;
 INSERT INTO public.event_deliveries SELECT (delivery).* RETURNING * INTO actual_delivery;
 inserted:=FOUND;
 IF NOT inserted OR to_jsonb(actual_delivery) IS DISTINCT FROM to_jsonb(delivery)
  OR NOT EXISTS(SELECT 1 FROM public.event_deliveries d WHERE to_jsonb(d)=to_jsonb(delivery)) THEN
  RAISE EXCEPTION 'Notification enqueue write was not persisted' USING ERRCODE='40001';
 END IF;
 FOR clause IN SELECT required FROM public.notification_alert_clauses(source_id) LOOP
  clause_id:=clause_id+1; features:='[]';
  INSERT INTO public.delivery_witnesses VALUES(delivery.id,clause_id);
  GET DIAGNOSTICS written=ROW_COUNT;
  IF written<>1 THEN RAISE EXCEPTION 'Notification witness write was not persisted' USING ERRCODE='40001'; END IF;
  FOR feature IN SELECT DISTINCT f FROM unnest(clause.required) f ORDER BY f LOOP
   SELECT coalesce((SELECT r.generation FROM public.feature_runtime r WHERE r.building_id=source.building_id AND r.feature_key=feature),0) INTO generation;
   INSERT INTO public.delivery_witness_features VALUES(delivery.id,clause_id,feature,generation);
   GET DIAGNOSTICS written=ROW_COUNT;
   IF written<>1 THEN RAISE EXCEPTION 'Notification witness write was not persisted' USING ERRCODE='40001'; END IF;
   features:=features||jsonb_build_array(jsonb_build_object('feature',feature,'generation',generation));
  END LOOP;
  expected:=expected||jsonb_build_array(jsonb_build_object('clause',clause_id,'features',features));
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('clause',w.clause_id,'features',coalesce((
  SELECT jsonb_agg(jsonb_build_object('feature',f.feature_key,'generation',f.generation) ORDER BY f.feature_key)
  FROM public.delivery_witness_features f WHERE f.delivery_id=w.delivery_id AND f.clause_id=w.clause_id),'[]'::jsonb)) ORDER BY w.clause_id),'[]'::jsonb)
 INTO actual FROM public.delivery_witnesses w WHERE w.delivery_id=delivery.id;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Notification witness write was not persisted' USING ERRCODE='40001'; END IF;
 IF clause_id=0 THEN PERFORM public.notification_cancel_delivery(delivery.id,'FEATURE_INELIGIBLE'); END IF;
 -- A later witness trigger must not invalidate a previously confirmed event or
 -- delivery. Reconfirm after all origin writes, not only after the first INSERT.
 IF NOT EXISTS(SELECT 1 FROM public.outbox_events e WHERE to_jsonb(e)=to_jsonb(event))
 OR (clause_id>0 AND NOT EXISTS(SELECT 1 FROM public.event_deliveries d WHERE to_jsonb(d)=to_jsonb(delivery))) THEN
  RAISE EXCEPTION 'Notification enqueue write was not persisted' USING ERRCODE='40001';
 END IF;
 PERFORM pg_notify('notification_wakeup','');
 RETURN event.id;
END $$;

CREATE FUNCTION notification_backend_start() RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid()
$$;
CREATE FUNCTION notification_has_barrier() RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.notification_attempts WHERE backend_pid=pg_backend_pid() AND backend_start=public.notification_backend_start())
 AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=814772 AND objid=1 AND objsubid=2 AND mode='ShareLock' AND granted)
$$;
CREATE FUNCTION notification_begin_attempt() RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE acquired boolean:=false; started timestamptz; opened timestamptz; written integer; BEGIN
 started:=public.notification_backend_start();
 IF EXISTS(SELECT 1 FROM public.notification_attempts WHERE backend_pid=pg_backend_pid() AND backend_start=started)
 OR EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=814772 AND objid=1 AND objsubid=2 AND granted) THEN
  RAISE EXCEPTION 'Notification attempt already open; reentrant acquisition refused' USING ERRCODE='55000';
 END IF;
 PERFORM pg_advisory_lock_shared(814772,1); acquired:=true; opened:=clock_timestamp();
 DELETE FROM public.notification_attempts a WHERE NOT EXISTS(SELECT 1 FROM pg_stat_activity s WHERE s.pid=a.backend_pid AND s.backend_start=a.backend_start);
 INSERT INTO public.notification_attempts(backend_pid,backend_start,opened_at) VALUES(pg_backend_pid(),started,opened);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>1 OR NOT EXISTS(SELECT 1 FROM public.notification_attempts WHERE backend_pid=pg_backend_pid() AND backend_start=started AND opened_at=opened AND NOT claim_called AND delivery_id IS NULL) THEN
  RAISE EXCEPTION 'Notification attempt write was not persisted' USING ERRCODE='40001';
 END IF;
EXCEPTION WHEN OTHERS THEN
 IF acquired AND NOT pg_advisory_unlock_shared(814772,1) THEN RAISE EXCEPTION 'Notification barrier release failed; close this connection' USING ERRCODE='55000'; END IF;
 RAISE;
END $$;
CREATE FUNCTION notification_end_attempt() RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE started timestamptz; written integer; BEGIN
 started:=public.notification_backend_start();
 IF NOT public.notification_has_barrier() THEN RAISE EXCEPTION 'Notification attempt barrier missing; close this connection' USING ERRCODE='55000'; END IF;
 IF NOT pg_advisory_unlock_shared(814772,1) OR EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=814772 AND objid=1 AND objsubid=2 AND granted) THEN
  RAISE EXCEPTION 'Notification barrier release failed; close this connection' USING ERRCODE='55000';
 END IF;
 DELETE FROM public.notification_attempts WHERE backend_pid=pg_backend_pid() AND backend_start=started;
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>1 OR EXISTS(SELECT 1 FROM public.notification_attempts WHERE backend_pid=pg_backend_pid() AND backend_start=started) THEN
  RAISE EXCEPTION 'Notification attempt cleanup failed; close this connection' USING ERRCODE='40001';
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION notification_claim(batch_limit integer DEFAULT 1)
RETURNS TABLE(delivery_id uuid,event_id uuid,claim_token uuid,lease_until timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE desired public.event_deliveries%ROWTYPE; evaluated timestamptz; started timestamptz; written integer; BEGIN
 IF batch_limit IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Notification claim limit must be one' USING ERRCODE='22023'; END IF;
 IF NOT public.notification_has_barrier() THEN RAISE EXCEPTION 'Notification attempt barrier required' USING ERRCODE='55000'; END IF;
 started:=public.notification_backend_start();
 UPDATE public.notification_attempts SET claim_called=true WHERE backend_pid=pg_backend_pid() AND backend_start=started AND NOT claim_called;
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>1 OR NOT EXISTS(SELECT 1 FROM public.notification_attempts WHERE backend_pid=pg_backend_pid() AND backend_start=started AND claim_called) THEN
  RAISE EXCEPTION 'Notification attempt already claimed or write failed' USING ERRCODE='55000';
 END IF;
 FOR desired IN SELECT d.* FROM public.event_deliveries d WHERE
  (d.status IN ('pending','retry') AND d.available_at<=clock_timestamp()) OR (d.status='inflight' AND d.lease_until<=clock_timestamp())
  ORDER BY d.available_at,d.id LIMIT 1 FOR UPDATE SKIP LOCKED LOOP
  evaluated:=clock_timestamp();
  IF NOT public.notification_delivery_eligible(desired.id) THEN
   PERFORM public.notification_cancel_delivery(desired.id,CASE WHEN EXISTS(SELECT 1 FROM public.outbox_events e JOIN public.alerts a ON a.id=e.alert_id AND a.building_id=e.building_id WHERE e.id=desired.event_id) THEN 'FEATURE_INELIGIBLE' ELSE 'SOURCE_GONE' END);
   CONTINUE;
  END IF;
  IF desired.attempts>=5 THEN
   desired.status:='failed'; desired.failure_category:='ATTEMPTS_EXHAUSTED'; desired.updated_at:=evaluated;
   desired.lease_until:=NULL; desired.claim_token:=NULL; desired.claim_backend_pid:=NULL; desired.claim_backend_start:=NULL;
   PERFORM public.notification_write_delivery(desired); CONTINUE;
  END IF;
  desired.status:='inflight'; desired.attempts:=desired.attempts+1; desired.updated_at:=evaluated;
  desired.lease_until:=evaluated+interval '20 seconds'; desired.claim_token:=gen_random_uuid();
  desired.claim_backend_pid:=pg_backend_pid(); desired.claim_backend_start:=started; desired.failure_category:=NULL;
  PERFORM public.notification_write_delivery(desired);
  UPDATE public.notification_attempts SET delivery_id=desired.id WHERE backend_pid=pg_backend_pid() AND backend_start=started AND claim_called;
  GET DIAGNOSTICS written=ROW_COUNT;
  IF written<>1 OR NOT EXISTS(SELECT 1 FROM public.notification_attempts WHERE backend_pid=pg_backend_pid() AND backend_start=started AND claim_called AND notification_attempts.delivery_id=desired.id) THEN
   RAISE EXCEPTION 'Notification attempt claim write was not persisted' USING ERRCODE='40001';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_deliveries d WHERE to_jsonb(d)=to_jsonb(desired)) THEN
   RAISE EXCEPTION 'Notification reservation write was not persisted' USING ERRCODE='40001';
  END IF;
  delivery_id:=desired.id; event_id:=desired.event_id; claim_token:=desired.claim_token; lease_until:=desired.lease_until; RETURN NEXT; RETURN;
 END LOOP;
END $$;
CREATE FUNCTION notification_revalidate(target uuid, token uuid)
RETURNS TABLE(delivery_id uuid,event_id uuid,building_id text,alert_id uuid,device_id text,severity text,alert_type text,message text,triggered_at timestamptz,idempotency_key text,lease_until timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE desired public.event_deliveries%ROWTYPE; evaluated timestamptz; BEGIN
 IF NOT public.notification_has_barrier() THEN RAISE EXCEPTION 'Notification attempt barrier required' USING ERRCODE='55000'; END IF;
 SELECT * INTO desired FROM public.event_deliveries WHERE id=target FOR UPDATE;
 evaluated:=clock_timestamp();
 IF NOT FOUND OR desired.status<>'inflight' OR desired.claim_token IS DISTINCT FROM token OR desired.claim_backend_pid<>pg_backend_pid()
  OR desired.claim_backend_start<>public.notification_backend_start() OR desired.lease_until<=evaluated+interval '6 seconds'
  OR NOT EXISTS(SELECT 1 FROM public.notification_attempts WHERE backend_pid=pg_backend_pid() AND backend_start=desired.claim_backend_start AND claim_called AND notification_attempts.delivery_id=target) THEN RETURN; END IF;
 IF NOT public.notification_delivery_eligible(target) THEN
  PERFORM public.notification_cancel_delivery(target,CASE WHEN EXISTS(SELECT 1 FROM public.outbox_events e JOIN public.alerts a ON a.id=e.alert_id AND a.building_id=e.building_id WHERE e.id=desired.event_id) THEN 'FEATURE_INELIGIBLE' ELSE 'SOURCE_GONE' END); RETURN;
 END IF;
 RETURN QUERY SELECT desired.id,e.id,e.building_id,a.id,coalesce(a.device_id,a.gateway_id,''),a.severity::text,a.type,a.message,a.triggered_at,
  e.id::text||'/webhook/alert.raised.v1',desired.lease_until
 FROM public.outbox_events e JOIN public.alerts a ON a.id=e.alert_id AND a.building_id=e.building_id WHERE e.id=desired.event_id;
END $$;
CREATE FUNCTION notification_complete(target uuid,token uuid,outcome text,http_status integer DEFAULT NULL,retry_after_seconds integer DEFAULT NULL)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE desired public.event_deliveries%ROWTYPE; evaluated timestamptz; retryable boolean; delay_seconds integer; BEGIN
 IF outcome IS NULL OR outcome NOT IN ('http','network','timeout','no_destination')
 OR (outcome='http' AND (http_status IS NULL OR http_status<100 OR http_status>599))
 OR (outcome<>'http' AND http_status IS NOT NULL) OR (retry_after_seconds IS NOT NULL AND (outcome<>'http' OR http_status NOT IN (429,503) OR retry_after_seconds<0)) THEN
  RAISE EXCEPTION 'Invalid notification completion outcome' USING ERRCODE='22023';
 END IF;
 IF NOT public.notification_has_barrier() THEN RAISE EXCEPTION 'Notification attempt barrier required' USING ERRCODE='55000'; END IF;
 SELECT * INTO desired FROM public.event_deliveries WHERE id=target FOR UPDATE;
 evaluated:=clock_timestamp();
 IF NOT FOUND OR desired.status<>'inflight' OR desired.claim_token IS DISTINCT FROM token OR desired.claim_backend_pid<>pg_backend_pid()
 OR desired.claim_backend_start<>public.notification_backend_start() OR desired.lease_until<=evaluated
 OR NOT EXISTS(SELECT 1 FROM public.notification_attempts WHERE backend_pid=pg_backend_pid() AND backend_start=desired.claim_backend_start AND claim_called AND notification_attempts.delivery_id=target) THEN RETURN 'stale'; END IF;
 IF NOT public.notification_delivery_eligible(target) THEN
  PERFORM public.notification_cancel_delivery(target,CASE WHEN EXISTS(SELECT 1 FROM public.outbox_events e JOIN public.alerts a ON a.id=e.alert_id AND a.building_id=e.building_id WHERE e.id=desired.event_id) THEN 'FEATURE_INELIGIBLE' ELSE 'SOURCE_GONE' END); RETURN 'cancelled';
 END IF;
 retryable:=outcome IN ('network','timeout') OR (outcome='http' AND (http_status=429 OR http_status>=500));
 desired.updated_at:=evaluated; desired.lease_until:=NULL; desired.claim_token:=NULL; desired.claim_backend_pid:=NULL; desired.claim_backend_start:=NULL;
 IF outcome='no_destination' THEN desired.status:='no_destination'; desired.failure_category:='NO_DESTINATION';
 ELSIF outcome='http' AND http_status BETWEEN 200 AND 299 THEN desired.status:='delivered'; desired.failure_category:=NULL;
 ELSIF retryable AND desired.attempts<5 THEN
  desired.status:='retry'; desired.failure_category:=CASE outcome WHEN 'network' THEN 'NETWORK' WHEN 'timeout' THEN 'TIMEOUT' ELSE 'HTTP_RETRY' END;
  delay_seconds:=least(300,greatest((5*power(2,desired.attempts-1))::integer,coalesce(retry_after_seconds,0)));
  desired.available_at:=evaluated+make_interval(secs=>delay_seconds);
 ELSE desired.status:='failed'; desired.failure_category:=CASE WHEN retryable THEN 'ATTEMPTS_EXHAUSTED' ELSE 'HTTP_PERMANENT' END;
 END IF;
 PERFORM public.notification_write_delivery(desired); RETURN desired.status;
END $$;

-- Complete 021 transition body, preserving authorization after the barrier wait
-- and all existing cursor/daily/parking/command effects. Generations and queue
-- cancellation are one transaction; future timestamps never bypass cancellation.
CREATE OR REPLACE FUNCTION app_apply_feature_transition(target text,feature text,enabled_now boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed timestamptz; paused timestamptz; zone text; usage_kind text; gate_kind text; vehicle text;
 prior_generation integer; prior_resumed timestamptz; expected_generation integer; desired public.feature_runtime%ROWTYPE; actual public.feature_runtime%ROWTYPE; candidate uuid;
BEGIN
 IF NOT app_has_global_capability('features:manage') THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(814772,1);
 changed:=clock_timestamp();
 IF NOT app_has_global_capability_at('features:manage',changed) THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501'; END IF;
 SELECT timezone INTO STRICT zone FROM buildings WHERE id=target;
 SELECT paused_at,resumed_at,generation INTO paused,prior_resumed,prior_generation FROM feature_runtime WHERE building_id=target AND feature_key=feature;
 expected_generation:=coalesce(prior_generation,0)+1;
 INSERT INTO feature_runtime(building_id,feature_key,resumed_at,paused_at)
 VALUES(target,feature,CASE WHEN enabled_now THEN changed END,CASE WHEN NOT enabled_now THEN changed END)
 ON CONFLICT(building_id,feature_key) DO UPDATE SET
 resumed_at=CASE WHEN enabled_now THEN changed ELSE feature_runtime.resumed_at END,
 paused_at=CASE WHEN enabled_now THEN feature_runtime.paused_at ELSE changed END,generation=feature_runtime.generation+1 RETURNING * INTO actual;
 desired.building_id:=target; desired.feature_key:=feature; desired.generation:=expected_generation;
 desired.resumed_at:=CASE WHEN enabled_now THEN changed ELSE prior_resumed END; desired.paused_at:=CASE WHEN enabled_now THEN paused ELSE changed END;
 IF NOT FOUND OR to_jsonb(actual) IS DISTINCT FROM to_jsonb(desired)
 OR NOT EXISTS(SELECT 1 FROM feature_runtime r WHERE to_jsonb(r)=to_jsonb(desired)) THEN
  RAISE EXCEPTION 'Feature runtime transition was not persisted' USING ERRCODE='40001';
 END IF;
 usage_kind:=CASE feature WHEN 'WATER_CONSUMPTION' THEN 'WATER' WHEN 'ENERGY_CONSUMPTION' THEN 'ENERGY' WHEN 'PUMP' THEN 'PUMP' END;
 IF usage_kind IS NOT NULL THEN
  DELETE FROM usage_cursors c USING monitoring_profiles p WHERE c.profile_id=p.id AND p.building_id=target AND p.kind=usage_kind;
  UPDATE daily_usage d SET incomplete=true FROM monitoring_profiles p WHERE d.profile_id=p.id AND p.building_id=target AND p.kind=usage_kind
   AND d.day>=to_char((CASE WHEN enabled_now THEN coalesce(paused,changed) ELSE changed END) AT TIME ZONE zone,'YYYY-MM-DD') AND d.day<=to_char(changed AT TIME ZONE zone,'YYYY-MM-DD');
 END IF;
 vehicle:=CASE feature WHEN 'CAR_PARKING' THEN 'CAR' WHEN 'MOTORCYCLE_PARKING' THEN 'MOTORCYCLE' END;
 IF vehicle IS NOT NULL THEN
  UPDATE parking_lots SET occupied=NULL,observed_at=NULL,source='UNKNOWN',version=version+1,updated_at=changed WHERE building_id=target AND vehicle_type=vehicle;
 END IF;
 gate_kind:=CASE feature WHEN 'GARAGE_ACCESS' THEN 'GARAGE' WHEN 'PEDESTRIAN_ACCESS' THEN 'PEDESTRIAN' END;
 IF gate_kind IS NOT NULL AND NOT enabled_now THEN
  WITH cancelled AS (UPDATE gate_commands c SET status='FAILED',failure_reason='Funcionalidade desativada'
   FROM gates g WHERE c.gate_id=g.id AND c.building_id=target AND g.kind=gate_kind AND c.status='PENDING' RETURNING c.id)
  INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
  SELECT target,app_current_user_id(),'USER','ACCESS_COMMAND_CANCELLED_BY_FEATURE','gate_command',id::text,
   jsonb_build_object('feature',feature,'reason','Funcionalidade desativada') FROM cancelled;
 END IF;
 FOR candidate IN SELECT d.id FROM public.event_deliveries d JOIN public.outbox_events e ON e.id=d.event_id
 WHERE e.building_id=target AND d.status IN ('pending','retry','inflight') AND NOT public.notification_delivery_eligible(d.id)
 ORDER BY d.id FOR UPDATE OF d LOOP
  PERFORM public.notification_cancel_delivery(candidate,CASE WHEN EXISTS(SELECT 1 FROM public.event_deliveries d JOIN public.outbox_events e ON e.id=d.event_id JOIN public.alerts a ON a.id=e.alert_id AND a.building_id=e.building_id WHERE d.id=candidate) THEN 'FEATURE_INELIGIBLE' ELSE 'SOURCE_GONE' END);
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.event_deliveries d JOIN public.outbox_events e ON e.id=d.event_id WHERE e.building_id=target
 AND d.status IN ('pending','retry','inflight') AND NOT public.notification_delivery_eligible(d.id)) THEN
  RAISE EXCEPTION 'Notification feature cancellation was not persisted' USING ERRCODE='40001';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM feature_runtime r WHERE to_jsonb(r)=to_jsonb(desired)) THEN
  RAISE EXCEPTION 'Feature runtime transition was not persisted' USING ERRCODE='40001';
 END IF;
END $$;

-- Remove every non-owner table/column/function ACL, including default grants.
-- RLS without runtime policies adds protection against accidental broad grants.
DO $$ DECLARE helper_owner text; target text; signature text; grantee_name text; column_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH target IN ARRAY ARRAY['outbox_events','event_deliveries','delivery_witnesses','delivery_witness_features','notification_attempts'] LOOP
  EXECUTE format('ALTER TABLE public.%I OWNER TO %I',target,helper_owner);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,predioon_app,predioon_identity,predioon_broker_auth,predioon_notifications',target);
  FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl JOIN pg_roles r ON r.oid=acl.grantee
   WHERE c.oid=format('public.%I',target)::regclass AND acl.grantee<>c.relowner LOOP EXECUTE format('REVOKE ALL ON public.%I FROM %I',target,grantee_name); END LOOP;
  FOR column_name,grantee_name IN SELECT a.attname,r.rolname FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl JOIN pg_roles r ON r.oid=acl.grantee
   JOIN pg_class c ON c.oid=a.attrelid WHERE c.oid=format('public.%I',target)::regclass AND acl.grantee<>c.relowner LOOP
    EXECUTE format('REVOKE ALL (%I) ON public.%I FROM %I',column_name,target,grantee_name);
  END LOOP;
 END LOOP;
 FOR signature IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND left(p.proname,13)='notification_' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,helper_owner);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,predioon_app,predioon_identity,predioon_broker_auth,predioon_notifications',signature);
  FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee
   WHERE p.oid=signature::regprocedure AND acl.grantee<>p.proowner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,grantee_name); END LOOP;
 END LOOP;
 EXECUTE format('ALTER FUNCTION app_apply_feature_transition(text,text,boolean) OWNER TO %I',helper_owner);
END $$;
GRANT EXECUTE ON FUNCTION notification_begin_attempt(),notification_end_attempt(),notification_claim(integer),notification_revalidate(uuid,uuid),notification_complete(uuid,uuid,text,integer,integer) TO predioon_notifications;
REVOKE ALL ON FUNCTION app_apply_feature_transition(text,text,boolean) FROM PUBLIC,predioon_notifications,predioon_identity,predioon_broker_auth;
GRANT EXECUTE ON FUNCTION app_apply_feature_transition(text,text,boolean) TO predioon_app;
