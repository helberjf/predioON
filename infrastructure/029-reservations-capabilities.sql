-- Apply atomically after 028. Existing exclusion/period constraints are untouched.
INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('reservations:create-own','reservation','create-own','Solicitar reserva própria'),
 ('reservations:read-own','reservation','read-own','Consultar reservas próprias'),
 ('reservations:cancel-own','reservation','cancel-own','Cancelar reservas próprias'),
 ('reservations:read-calendar','reservation','read-calendar','Consultar ocupação de áreas'),
 ('reservations:manage','reservation','manage','Gerenciar reservas')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
 SELECT role_key,permission_key FROM unnest(ARRAY['BUILDING_ADMIN','MAINTENANCE_MANAGER','MAINTENANCE','RESIDENT']) role_key
 CROSS JOIN unnest(ARRAY['reservations:create-own','reservations:read-own','reservations:cancel-own','reservations:read-calendar']) permission_key
ON CONFLICT(role_key,permission_key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES('BUILDING_ADMIN','reservations:manage') ON CONFLICT DO NOTHING;

-- Preserve current/future resource validators, support allowlist, owners and ACLs.
DO $$ DECLARE definition text; constraint_row record; BEGIN
 SELECT pg_get_functiondef('app_rbac_scope_valid(text,text)'::regprocedure) INTO STRICT definition;
 IF position('''reservation''' in definition)=0 THEN
   IF position('''common_area''' in definition)=0 THEN RAISE EXCEPTION 'Missing common area scope'; END IF;
   EXECUTE replace(definition,'''common_area''','''common_area'',''reservation''');
 END IF;
 FOR constraint_row IN SELECT conname,conrelid::regclass AS target,pg_get_constraintdef(oid) AS definition FROM pg_constraint
   WHERE (conrelid='role_bindings'::regclass AND conname='role_bindings_scope_ck')
     OR (conrelid='support_grants'::regclass AND conname='support_grants_valid_ck') LOOP
   IF position('''reservation''::text' in constraint_row.definition)=0 THEN
     IF position('''common_area''::text' in constraint_row.definition)=0 THEN RAISE EXCEPTION 'Missing common area constraint'; END IF;
     definition:=replace(constraint_row.definition,'''common_area''::text','''common_area''::text, ''reservation''::text');
     EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',constraint_row.target,constraint_row.conname);
     EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',constraint_row.target,constraint_row.conname,definition);
   END IF;
 END LOOP;
 SELECT pg_get_functiondef('app_discovery_resource_belongs(text,text,text)'::regprocedure) INTO STRICT definition;
 IF position('WHEN ''reservation'' THEN' in definition)=0 THEN
   IF position('WHEN ''support_grant'' THEN' in definition)=0 THEN RAISE EXCEPTION 'Unexpected discovery function shape'; END IF;
   definition:=regexp_replace(definition,'(IF target_resource_type NOT IN \()([^)]*)(\))','\1\2,''reservation''\3');
   definition:=replace(definition,'WHEN ''support_grant'' THEN',
     'WHEN ''reservation'' THEN RETURN EXISTS (SELECT 1 FROM reservations r JOIN common_areas a ON a.id=r.area_id AND a.building_id=r.building_id WHERE r.id=resource_uuid AND r.building_id=target_building_id); WHEN ''support_grant'' THEN');
   EXECUTE definition;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION app_reservation_area_capability(target_building_id text,target_area_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_capability IN ('reservations:create-own','reservations:read-own','reservations:cancel-own','reservations:read-calendar','reservations:manage') AND EXISTS (
   SELECT 1 FROM common_areas a
   WHERE a.id=CASE WHEN target_area_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_area_id::uuid END
     AND a.building_id=target_building_id AND app_has_capability(a.building_id,target_capability,'common_area',a.id::text)
 );
$$;
CREATE OR REPLACE FUNCTION app_reservation_has_capability_at(target_building_id text,target_reservation_id text,target_capability text,evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_capability IN ('reservations:read-own','reservations:cancel-own','reservations:manage') AND EXISTS (
   SELECT 1 FROM reservations r JOIN common_areas a ON a.id=r.area_id AND a.building_id=r.building_id
   WHERE r.id=CASE WHEN target_reservation_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_reservation_id::uuid END
     AND r.building_id=target_building_id
     AND (app_has_capability_at(r.building_id,target_capability,'reservation',r.id::text,evaluated_at)
       OR app_has_capability_at(r.building_id,target_capability,'common_area',a.id::text,evaluated_at))
     AND CASE WHEN target_capability='reservations:manage' THEN
       app_has_capability_at(r.building_id,'common-areas:read','common_area',a.id::text,evaluated_at)
       OR app_has_capability_at(r.building_id,'common-areas:read','reservation',r.id::text,evaluated_at)
       ELSE r.user_id=app_current_user_id() END
 );
$$;
CREATE OR REPLACE FUNCTION app_reservation_has_capability(target_building_id text,target_reservation_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_reservation_has_capability_at(target_building_id,target_reservation_id,target_capability,statement_timestamp());
$$;
CREATE OR REPLACE FUNCTION app_reservation_can_read(target_building_id text,target_reservation_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_reservation_has_capability(target_building_id,target_reservation_id,'reservations:read-own')
   OR app_reservation_has_capability(target_building_id,target_reservation_id,'reservations:manage');
$$;
CREATE OR REPLACE FUNCTION app_reservation_can_create(target_building_id text,target_area_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM common_areas a
   WHERE a.id=CASE WHEN target_area_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_area_id::uuid END
     AND a.building_id=target_building_id AND a.active
     AND app_has_capability(a.building_id,'common-areas:read','common_area',a.id::text)
     AND app_reservation_area_capability(a.building_id,a.id::text,'reservations:read-own')
     AND app_reservation_area_capability(a.building_id,a.id::text,'reservations:create-own'));
$$;
CREATE OR REPLACE FUNCTION app_reservation_can_read_calendar(target_building_id text,target_area_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_common_area_has_capability(target_building_id,target_area_id,'common-areas:read')
   AND app_reservation_area_capability(target_building_id,target_area_id,'reservations:read-calendar');
$$;
CREATE OR REPLACE FUNCTION app_reservation_can_read_scope(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_has_capability(target_building_id,'reservations:read-own')
   OR (app_has_capability(target_building_id,'reservations:manage') AND app_has_capability(target_building_id,'common-areas:read'))
   OR EXISTS (
     WITH candidates AS MATERIALIZED (SELECT rb.resource_type,rb.resource_id FROM role_bindings rb
       WHERE rb.building_id=target_building_id AND rb.resource_type IN ('common_area','reservation')
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at))
     SELECT 1 FROM candidates c WHERE CASE WHEN c.resource_type='reservation' THEN app_reservation_can_read(target_building_id,c.resource_id)
       ELSE app_reservation_area_capability(target_building_id,c.resource_id,'reservations:read-own')
         OR (app_reservation_area_capability(target_building_id,c.resource_id,'reservations:manage')
           AND app_common_area_has_capability(target_building_id,c.resource_id,'common-areas:read')) END);
$$;
CREATE OR REPLACE FUNCTION app_reservation_can_read_feature_state(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_reservation_can_read_scope(target_building_id)
   OR (app_has_capability(target_building_id,'reservations:read-calendar') AND app_has_capability(target_building_id,'common-areas:read'))
   OR EXISTS (WITH candidates AS MATERIALIZED (SELECT rb.resource_id FROM role_bindings rb
     WHERE rb.building_id=target_building_id AND rb.resource_type='common_area'
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at))
     SELECT 1 FROM candidates c WHERE app_reservation_can_read_calendar(target_building_id,c.resource_id));
$$;

DROP POLICY IF EXISTS reservations_scope_policy ON reservations;
DROP POLICY IF EXISTS reservations_read_policy ON reservations;
DROP POLICY IF EXISTS reservations_write_policy ON reservations;
DROP POLICY IF EXISTS reservations_insert_policy ON reservations;
DROP POLICY IF EXISTS reservations_update_policy ON reservations;
CREATE POLICY reservations_read_policy ON reservations FOR SELECT TO predioon_app
 USING(app_reservation_can_read(building_id,id::text));
CREATE POLICY reservations_insert_policy ON reservations FOR INSERT TO predioon_app WITH CHECK (
 user_id=app_current_user_id() AND app_reservation_can_create(building_id,area_id::text)
 AND decided_by IS NULL AND decided_at IS NULL AND starts_at>=clock_timestamp() AND ends_at>starts_at
 AND EXISTS (SELECT 1 FROM common_areas a WHERE a.id=area_id AND a.building_id=reservations.building_id AND a.active
   AND ends_at-starts_at<=a.max_hours_per_booking*interval '1 hour'
   AND status=CASE WHEN a.requires_approval THEN 'PENDING'::reservation_status ELSE 'CONFIRMED'::reservation_status END));
CREATE POLICY reservations_update_policy ON reservations FOR UPDATE TO predioon_app
 USING(app_reservation_has_capability(building_id,id::text,'reservations:manage'))
 WITH CHECK(app_reservation_has_capability(building_id,id::text,'reservations:manage'));
REVOKE INSERT,UPDATE,DELETE ON reservations FROM predioon_app;
GRANT INSERT(id,building_id,area_id,user_id,unit,starts_at,ends_at,status,notes) ON reservations TO predioon_app;
GRANT UPDATE(status,decided_by,decided_at,updated_at) ON reservations TO predioon_app;

-- Applies to runtime transitions, including the narrow definer cancellation.
-- Fixture/maintenance owner sessions without an authenticated actor keep owner access.
CREATE OR REPLACE FUNCTION app_reservation_transition_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF app_current_user_id() IS NULL THEN RETURN NEW; END IF;
 IF ROW(NEW.id,NEW.building_id,NEW.area_id,NEW.user_id,NEW.unit,NEW.starts_at,NEW.ends_at,NEW.notes,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.building_id,OLD.area_id,OLD.user_id,OLD.unit,OLD.starts_at,OLD.ends_at,OLD.notes,OLD.created_at)
   THEN RAISE EXCEPTION 'Immutable reservation fields' USING ERRCODE='42501'; END IF;
 IF NEW.status=OLD.status THEN
   IF ROW(NEW.decided_by,NEW.decided_at) IS DISTINCT FROM ROW(OLD.decided_by,OLD.decided_at)
     THEN RAISE EXCEPTION 'Immutable reservation decision' USING ERRCODE='42501'; END IF;
 ELSIF OLD.status='PENDING' AND NEW.status IN ('CONFIRMED','REJECTED') THEN
   IF NOT app_reservation_has_capability(OLD.building_id,OLD.id::text,'reservations:manage')
     THEN RAISE EXCEPTION 'Reservation management denied' USING ERRCODE='42501'; END IF;
   NEW.decided_by:=app_current_user_id(); NEW.decided_at:=clock_timestamp();
 ELSIF OLD.status IN ('PENDING','CONFIRMED') AND NEW.status='CANCELLED' THEN
   IF NOT (app_reservation_has_capability(OLD.building_id,OLD.id::text,'reservations:manage')
     OR (app_reservation_has_capability(OLD.building_id,OLD.id::text,'reservations:read-own')
       AND app_reservation_has_capability(OLD.building_id,OLD.id::text,'reservations:cancel-own')))
     THEN RAISE EXCEPTION 'Reservation cancellation denied' USING ERRCODE='42501'; END IF;
   NEW.decided_by:=OLD.decided_by; NEW.decided_at:=OLD.decided_at;
 ELSE RAISE EXCEPTION 'Reservation already closed' USING ERRCODE='55000'; END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reservations_transition_guard ON reservations;
CREATE TRIGGER reservations_transition_guard BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION app_reservation_transition_guard();
REVOKE ALL ON FUNCTION app_reservation_transition_guard() FROM PUBLIC;

-- Only a booking id is accepted: no actor, desired state, decision or dates.
CREATE OR REPLACE FUNCTION app_cancel_own_reservation(target_reservation_id text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reservation_uuid uuid; current_row reservations%ROWTYPE;
BEGIN
 IF target_reservation_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR target_reservation_id IS NULL
   THEN RAISE EXCEPTION 'Reservation cancellation denied' USING ERRCODE='42501'; END IF;
 reservation_uuid:=target_reservation_id::uuid;
 SELECT * INTO current_row FROM reservations WHERE id=reservation_uuid;
 IF NOT FOUND OR NOT app_reservation_has_capability_at(current_row.building_id,target_reservation_id,'reservations:read-own',clock_timestamp())
   OR NOT app_reservation_has_capability_at(current_row.building_id,target_reservation_id,'reservations:cancel-own',clock_timestamp())
   THEN RAISE EXCEPTION 'Reservation cancellation denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM reservations WHERE id=reservation_uuid FOR UPDATE;
 -- Separate statements get fresh READ COMMITTED snapshots after any lock wait.
 SELECT * INTO current_row FROM reservations WHERE id=reservation_uuid;
 IF NOT FOUND OR NOT app_reservation_has_capability_at(current_row.building_id,target_reservation_id,'reservations:read-own',clock_timestamp())
   OR NOT app_reservation_has_capability_at(current_row.building_id,target_reservation_id,'reservations:cancel-own',clock_timestamp())
   THEN RAISE EXCEPTION 'Reservation cancellation denied' USING ERRCODE='42501'; END IF;
 IF current_row.status='CANCELLED' THEN RETURN false; END IF;
 IF current_row.status NOT IN ('PENDING','CONFIRMED') THEN RAISE EXCEPTION 'Reservation already closed' USING ERRCODE='55000'; END IF;
 UPDATE reservations SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=reservation_uuid;
 RETURN true;
END $$;

-- This projection never reads or returns identifiers, people, notes or decisions.
CREATE OR REPLACE FUNCTION app_reservation_availability(target_building_id text,target_area_id text,target_from timestamptz,target_to timestamptz)
RETURNS TABLE(starts_at timestamptz,ends_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT r.starts_at,r.ends_at FROM reservations r
 WHERE isfinite(target_from) AND isfinite(target_to) AND target_to>target_from AND target_to-target_from<=interval '31 days'
   AND app_reservation_can_read_calendar(target_building_id,target_area_id)
   AND r.area_id=CASE WHEN target_area_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_area_id::uuid END
   AND r.building_id=target_building_id AND r.status IN ('PENDING','CONFIRMED')
   AND r.starts_at<target_to AND r.ends_at>target_from
 ORDER BY r.starts_at;
$$;

DROP POLICY IF EXISTS building_features_reservations_read ON building_feature_settings;
CREATE POLICY building_features_reservations_read ON building_feature_settings FOR SELECT TO predioon_app USING(app_reservation_can_read_feature_state(building_id));
DROP POLICY IF EXISTS feature_runtime_reservations_read ON feature_runtime;
CREATE POLICY feature_runtime_reservations_read ON feature_runtime FOR SELECT TO predioon_app USING(app_reservation_can_read_feature_state(building_id));
DO $$ DECLARE definition text; anchor text:='OR app_equipment_can_read_scope(b.id,''gateway'')'; BEGIN
 SELECT pg_get_functiondef('app_can_read_feature_event(text)'::regprocedure) INTO STRICT definition;
 IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'Unexpected feature event function shape'; END IF;
 definition:=replace(definition,'OR app_reservation_can_read_feature_state(b.id)','');
 EXECUTE replace(definition,anchor,anchor || E'\n     OR app_reservation_can_read_feature_state(b.id)');
END $$;
DO $$ DECLARE policy_expression text; branches text; action_name text; BEGIN
 SELECT pg_get_expr(polwithcheck,polrelid) INTO STRICT policy_expression FROM pg_policy WHERE polrelid='audit_logs'::regclass AND polname='audit_logs_insert_policy';
 IF policy_expression NOT LIKE '%CASE action%' OR policy_expression NOT LIKE '%ELSE%' THEN RAISE EXCEPTION 'Unexpected audit policy shape'; END IF;
 branches:=$branches$
 WHEN 'RESERVATION_CREATED'::text THEN resource_type='reservation' AND building_id IS NOT NULL
   AND app_reservation_has_capability(building_id,resource_id,'reservations:read-own')
   AND EXISTS(SELECT 1 FROM reservations r WHERE r.id::text=resource_id AND r.building_id=audit_logs.building_id AND r.user_id=app_current_user_id() AND app_reservation_can_create(r.building_id,r.area_id::text))
 WHEN 'RESERVATION_CANCELLED'::text THEN resource_type='reservation' AND building_id IS NOT NULL
   AND (app_reservation_has_capability(building_id,resource_id,'reservations:manage')
     OR (app_reservation_has_capability(building_id,resource_id,'reservations:read-own') AND app_reservation_has_capability(building_id,resource_id,'reservations:cancel-own')))
   AND EXISTS(SELECT 1 FROM reservations r WHERE r.id::text=resource_id AND r.building_id=audit_logs.building_id AND r.status='CANCELLED')
 WHEN 'RESERVATION_CONFIRMED'::text THEN resource_type='reservation' AND building_id IS NOT NULL
   AND app_reservation_has_capability(building_id,resource_id,'reservations:manage')
   AND EXISTS(SELECT 1 FROM reservations r WHERE r.id::text=resource_id AND r.building_id=audit_logs.building_id AND r.status='CONFIRMED' AND r.decided_by=app_current_user_id())
 WHEN 'RESERVATION_REJECTED'::text THEN resource_type='reservation' AND building_id IS NOT NULL
   AND app_reservation_has_capability(building_id,resource_id,'reservations:manage')
   AND EXISTS(SELECT 1 FROM reservations r WHERE r.id::text=resource_id AND r.building_id=audit_logs.building_id AND r.status='REJECTED' AND r.decided_by=app_current_user_id())
 $branches$;
 FOREACH action_name IN ARRAY ARRAY['RESERVATION_CREATED','RESERVATION_CANCELLED','RESERVATION_CONFIRMED','RESERVATION_REJECTED'] LOOP
   policy_expression:=regexp_replace(policy_expression,'WHEN ''' || action_name || '''::text THEN .*?(?=WHEN |ELSE)','','ns');
 END LOOP;
 policy_expression:=regexp_replace(policy_expression,'ELSE',branches || ' ELSE');
 EXECUTE 'ALTER POLICY audit_logs_insert_policy ON audit_logs WITH CHECK (' || policy_expression || ')';
END $$;

DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_reservation_has_capability_at(text,text,text,timestamptz)'::regprocedure,
   'app_reservation_area_capability(text,text,text)'::regprocedure,'app_reservation_has_capability(text,text,text)'::regprocedure,
   'app_reservation_can_read(text,text)'::regprocedure,'app_reservation_can_create(text,text)'::regprocedure,
   'app_reservation_can_read_calendar(text,text)'::regprocedure,'app_reservation_can_read_scope(text)'::regprocedure,
   'app_reservation_can_read_feature_state(text)'::regprocedure,'app_cancel_own_reservation(text)'::regprocedure,
   'app_reservation_availability(text,text,timestamptz,timestamptz)'::regprocedure
 ] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee
     WHERE p.oid=helper AND acl.grantee<>p.proowner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
   IF helper<>'app_reservation_has_capability_at(text,text,text,timestamptz)'::regprocedure THEN
     EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper);
   END IF;
 END LOOP;
END $$;
