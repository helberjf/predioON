-- 064: reservation limits per month, the apartment of each reservation, and
-- condominium events with attendance confirmation.
--
-- 1. Each common area may limit how many reservations one resident, and one
--    apartment, holds in a calendar month (the condominium's time zone). No
--    value means no limit. Pending and confirmed reservations count; rejected
--    and cancelled ones give the slot back.
-- 2. A reservation points to a real apartment of the requester, taken from
--    the current unit memberships, never from the free-text field. With a
--    single apartment it is filled in automatically; a typed code that matches
--    one of the requester's apartments is accepted too (older apps send it).
-- 3. The administration publishes events. An event may take a common area:
--    for its duration the area is busy for reservations and other events.
--    Residents answer "vou" or "não vou" and may bring companions up to the
--    event's limit; the administration sees every answer.
--
-- Bookings and events of one area are serialized by one advisory lock, so the
-- counts and overlap checks below always see every committed competitor.

-- ---------------------------------------------------------------- limits
ALTER TABLE common_areas ADD COLUMN IF NOT EXISTS monthly_limit_per_resident integer;
ALTER TABLE common_areas ADD COLUMN IF NOT EXISTS monthly_limit_per_unit integer;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='common_areas'::regclass AND conname='common_areas_monthly_limits_ck') THEN
    ALTER TABLE common_areas ADD CONSTRAINT common_areas_monthly_limits_ck CHECK (
      (monthly_limit_per_resident IS NULL OR monthly_limit_per_resident BETWEEN 1 AND 31)
      AND (monthly_limit_per_unit IS NULL OR monthly_limit_per_unit BETWEEN 1 AND 31));
  END IF;
END $$;
GRANT UPDATE(monthly_limit_per_resident, monthly_limit_per_unit) ON common_areas TO predioon_app;

-- ---------------------------------------------------------------- apartment
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS unit_id uuid;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='reservations'::regclass AND conname='reservations_unit_building_fk') THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_unit_building_fk
      FOREIGN KEY (unit_id, building_id) REFERENCES units(id, building_id) ON DELETE SET NULL (unit_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS reservations_area_unit_start_idx ON reservations(area_id, unit_id, starts_at) WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservations_area_user_start_idx ON reservations(area_id, user_id, starts_at);
GRANT INSERT(unit_id) ON reservations TO predioon_app;

-- ---------------------------------------------------------------- events
CREATE TABLE IF NOT EXISTS building_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  area_id uuid REFERENCES common_areas(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  rsvp_until timestamptz,
  capacity integer,
  max_guests integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'SCHEDULED',
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cancelled_at timestamptz,
  CONSTRAINT building_events_id_building_uq UNIQUE (id, building_id),
  CONSTRAINT building_events_title_ck CHECK (title=btrim(title) AND char_length(title) BETWEEN 2 AND 160),
  CONSTRAINT building_events_text_ck CHECK (char_length(description)<=4000 AND char_length(location)<=160),
  CONSTRAINT building_events_period_ck CHECK (ends_at>starts_at AND ends_at-starts_at<=interval '7 days'),
  CONSTRAINT building_events_rsvp_ck CHECK (rsvp_until IS NULL OR rsvp_until<=starts_at),
  CONSTRAINT building_events_capacity_ck CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 10000),
  CONSTRAINT building_events_guests_ck CHECK (max_guests BETWEEN 0 AND 20),
  CONSTRAINT building_events_status_ck CHECK (status IN ('SCHEDULED','CANCELLED')),
  CONSTRAINT building_events_version_ck CHECK (version>0)
);
CREATE INDEX IF NOT EXISTS building_events_building_start_idx ON building_events(building_id, starts_at);
CREATE INDEX IF NOT EXISTS building_events_area_start_idx ON building_events(area_id, starts_at) WHERE area_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS building_event_responses (
  event_id uuid NOT NULL,
  building_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attending boolean NOT NULL,
  guests integer NOT NULL DEFAULT 0,
  unit_label text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (event_id, user_id),
  CONSTRAINT building_event_responses_event_fk FOREIGN KEY (event_id, building_id) REFERENCES building_events(id, building_id) ON DELETE CASCADE,
  CONSTRAINT building_event_responses_guests_ck CHECK (guests BETWEEN 0 AND 20 AND (attending OR guests=0))
);
CREATE INDEX IF NOT EXISTS building_event_responses_building_idx ON building_event_responses(building_id);

-- ---------------------------------------------------------------- permissions
-- The administrator holds every capability of the resident role, so that it
-- can still invite and bind residents (a role is granted only by whoever holds
-- all of it).
INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('events:read','event','read','Ver eventos do condomínio'),
 ('events:respond-own','event','respond-own','Confirmar presença em eventos'),
 ('events:manage','event','manage','Gerenciar eventos e ver as confirmações')
ON CONFLICT(key) DO UPDATE SET label=EXCLUDED.label;
INSERT INTO role_permissions(role_key,permission_key)
 SELECT role_key,permission_key FROM unnest(ARRAY['BUILDING_ADMIN','MAINTENANCE_MANAGER','MAINTENANCE','RESIDENT']) role_key
 CROSS JOIN unnest(ARRAY['events:read','events:respond-own']) permission_key
ON CONFLICT(role_key,permission_key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES('BUILDING_ADMIN','events:manage') ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- helpers
-- Current apartments of a person in a condominium. Owned by the helper owner
-- below; never granted to the application directly.
CREATE OR REPLACE FUNCTION app_person_current_units(target_building_id text, target_user_id text)
RETURNS TABLE(id uuid, code text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT DISTINCT u.id, u.code FROM unit_memberships um
 JOIN units u ON u.id=um.unit_id AND u.building_id=um.building_id AND u.active
 WHERE um.building_id=target_building_id AND um.user_id=target_user_id
   AND app_rbac_window(um.active, um.starts_at, um.ends_at)
 ORDER BY u.code;
$$;

-- The caller's own apartments, for choosing which one a reservation is for.
CREATE OR REPLACE FUNCTION app_reservation_own_units(target_building_id text)
RETURNS TABLE(id uuid, code text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.id, p.code FROM app_person_current_units(target_building_id, app_current_user_id()) p
 WHERE app_current_user_id() IS NOT NULL
   AND (app_has_capability(target_building_id,'reservations:create-own') OR app_has_capability(target_building_id,'reservations:read-own'));
$$;

-- The name of whoever booked or answered, for the administration's calendar and
-- answer list. Only the name, never the account row or e-mail, and only of a
-- person linked to this condominium in some way (invitations create role
-- bindings and unit memberships, not legacy memberships).
CREATE OR REPLACE FUNCTION app_building_person_name(target_building_id text, target_user_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT u.name FROM users u
 WHERE u.id=target_user_id
   AND (app_has_capability(target_building_id,'reservations:manage') OR app_has_capability(target_building_id,'events:manage')
     OR app_has_capability(target_building_id,'memberships:read'))
   AND (EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.building_id=target_building_id)
     OR EXISTS(SELECT 1 FROM role_bindings rb WHERE rb.user_id=u.id AND rb.building_id=target_building_id)
     OR EXISTS(SELECT 1 FROM unit_memberships um WHERE um.user_id=u.id AND um.building_id=target_building_id));
$$;

CREATE OR REPLACE FUNCTION app_common_area_lock(target_area_id uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path=public,pg_temp AS $$
 SELECT pg_advisory_xact_lock(hashtextextended('common-area:' || target_area_id::text, 0));
$$;

-- ---------------------------------------------------------------- booking guard
CREATE OR REPLACE FUNCTION app_reservation_booking_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  area common_areas%ROWTYPE;
  own_units uuid[];
  zone text;
  local_month timestamp;
  month_start timestamptz;
  month_end timestamptz;
  used integer;
BEGIN
  IF NEW.status NOT IN ('PENDING','CONFIRMED') THEN RETURN NEW; END IF;
  PERFORM app_common_area_lock(NEW.area_id);
  SELECT * INTO area FROM common_areas a WHERE a.id=NEW.area_id AND a.building_id=NEW.building_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Common area not found' USING ERRCODE='23503'; END IF;

  SELECT coalesce(array_agg(p.id), '{}') INTO own_units FROM app_person_current_units(NEW.building_id, NEW.user_id) p;
  IF NEW.unit_id IS NULL AND NEW.unit IS NOT NULL THEN
    SELECT p.id INTO NEW.unit_id FROM app_person_current_units(NEW.building_id, NEW.user_id) p
    WHERE lower(p.code)=lower(btrim(NEW.unit));
  END IF;
  IF NEW.unit_id IS NULL AND cardinality(own_units)=1 THEN NEW.unit_id:=own_units[1]; END IF;
  IF NEW.unit_id IS NOT NULL THEN
    IF NOT NEW.unit_id=ANY(own_units) THEN
      RAISE EXCEPTION 'Apartment is not linked to the requester' USING ERRCODE='23514', CONSTRAINT='reservations_unit_requester';
    END IF;
    SELECT u.code INTO NEW.unit FROM units u WHERE u.id=NEW.unit_id;
  END IF;

  IF EXISTS(SELECT 1 FROM building_events e WHERE e.area_id=NEW.area_id AND e.building_id=NEW.building_id
    AND e.status='SCHEDULED' AND tstzrange(e.starts_at,e.ends_at) && tstzrange(NEW.starts_at,NEW.ends_at)) THEN
    RAISE EXCEPTION 'A condominium event takes this area' USING ERRCODE='23P01', CONSTRAINT='reservations_event_overlap';
  END IF;

  IF area.monthly_limit_per_resident IS NULL AND area.monthly_limit_per_unit IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce((SELECT b.timezone FROM buildings b WHERE b.id=NEW.building_id), 'America/Sao_Paulo') INTO zone;
  local_month:=date_trunc('month', NEW.starts_at AT TIME ZONE zone);
  month_start:=local_month AT TIME ZONE zone;
  month_end:=(local_month + interval '1 month') AT TIME ZONE zone;
  IF area.monthly_limit_per_resident IS NOT NULL THEN
    SELECT count(*) INTO used FROM reservations r
    WHERE r.area_id=NEW.area_id AND r.user_id=NEW.user_id AND r.status IN ('PENDING','CONFIRMED')
      AND r.starts_at>=month_start AND r.starts_at<month_end;
    IF used>=area.monthly_limit_per_resident THEN
      RAISE EXCEPTION 'Monthly limit per resident reached' USING ERRCODE='23514', CONSTRAINT='reservations_monthly_resident_limit';
    END IF;
  END IF;
  IF area.monthly_limit_per_unit IS NOT NULL THEN
    IF NEW.unit_id IS NULL THEN
      RAISE EXCEPTION 'This area limits reservations per apartment' USING ERRCODE='23514', CONSTRAINT='reservations_unit_required';
    END IF;
    SELECT count(*) INTO used FROM reservations r
    WHERE r.area_id=NEW.area_id AND r.unit_id=NEW.unit_id AND r.status IN ('PENDING','CONFIRMED')
      AND r.starts_at>=month_start AND r.starts_at<month_end;
    IF used>=area.monthly_limit_per_unit THEN
      RAISE EXCEPTION 'Monthly limit per apartment reached' USING ERRCODE='23514', CONSTRAINT='reservations_monthly_unit_limit';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reservations_booking_guard ON reservations;
CREATE TRIGGER reservations_booking_guard BEFORE INSERT ON reservations FOR EACH ROW EXECUTE FUNCTION app_reservation_booking_guard();

-- 029's transition guard, now also keeping the apartment immutable.
CREATE OR REPLACE FUNCTION app_reservation_transition_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF app_current_user_id() IS NULL THEN RETURN NEW; END IF;
 IF ROW(NEW.id,NEW.building_id,NEW.area_id,NEW.user_id,NEW.unit,NEW.unit_id,NEW.starts_at,NEW.ends_at,NEW.notes,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.building_id,OLD.area_id,OLD.user_id,OLD.unit,OLD.unit_id,OLD.starts_at,OLD.ends_at,OLD.notes,OLD.created_at)
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

-- The resident projection now also marks the hours an event takes. It still
-- never returns identifiers, people, notes, decisions or event details.
CREATE OR REPLACE FUNCTION app_reservation_availability(target_building_id text,target_area_id text,target_from timestamptz,target_to timestamptz)
RETURNS TABLE(starts_at timestamptz,ends_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT busy.starts_at, busy.ends_at FROM (
   SELECT r.starts_at,r.ends_at FROM reservations r
   WHERE r.area_id=CASE WHEN target_area_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_area_id::uuid END
     AND r.building_id=target_building_id AND r.status IN ('PENDING','CONFIRMED')
     AND r.starts_at<target_to AND r.ends_at>target_from
   UNION ALL
   SELECT e.starts_at,e.ends_at FROM building_events e
   WHERE e.area_id=CASE WHEN target_area_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_area_id::uuid END
     AND e.building_id=target_building_id AND e.status='SCHEDULED'
     AND e.starts_at<target_to AND e.ends_at>target_from
 ) busy
 WHERE isfinite(target_from) AND isfinite(target_to) AND target_to>target_from AND target_to-target_from<=interval '31 days'
   AND app_reservation_can_read_calendar(target_building_id,target_area_id)
 ORDER BY busy.starts_at;
$$;

-- ---------------------------------------------------------------- event guards
CREATE OR REPLACE FUNCTION app_building_event_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF app_current_user_id() IS NOT NULL AND (NEW.created_by IS DISTINCT FROM app_current_user_id() OR NEW.version<>1 OR NEW.status<>'SCHEDULED') THEN
      RAISE EXCEPTION 'Event creation denied' USING ERRCODE='42501';
    END IF;
    IF app_current_user_id() IS NOT NULL AND NEW.starts_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'An event starts in the future' USING ERRCODE='23514', CONSTRAINT='building_events_future_start';
    END IF;
    NEW.cancelled_at:=NULL;
  ELSE
    IF ROW(NEW.id,NEW.building_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.building_id,OLD.created_by,OLD.created_at) THEN
      RAISE EXCEPTION 'Immutable event fields' USING ERRCODE='42501';
    END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Event changed concurrently' USING ERRCODE='P0409'; END IF;
    IF OLD.status='CANCELLED' THEN RAISE EXCEPTION 'Event already cancelled' USING ERRCODE='55000'; END IF;
    NEW.cancelled_at:=CASE WHEN NEW.status='CANCELLED' THEN clock_timestamp() END;
  END IF;
  IF NEW.status='SCHEDULED' AND NEW.area_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.area_id IS DISTINCT FROM OLD.area_id
    OR NEW.starts_at<>OLD.starts_at OR NEW.ends_at<>OLD.ends_at) THEN
    PERFORM app_common_area_lock(NEW.area_id);
    IF NOT EXISTS(SELECT 1 FROM common_areas a WHERE a.id=NEW.area_id AND a.building_id=NEW.building_id AND a.active) THEN
      RAISE EXCEPTION 'Common area unavailable for this event' USING ERRCODE='23514', CONSTRAINT='building_events_area';
    END IF;
    IF EXISTS(SELECT 1 FROM reservations r WHERE r.area_id=NEW.area_id AND r.building_id=NEW.building_id
      AND r.status IN ('PENDING','CONFIRMED') AND tstzrange(r.starts_at,r.ends_at) && tstzrange(NEW.starts_at,NEW.ends_at)) THEN
      RAISE EXCEPTION 'A reservation takes this area' USING ERRCODE='23P01', CONSTRAINT='building_events_reservation_overlap';
    END IF;
    IF EXISTS(SELECT 1 FROM building_events e WHERE e.area_id=NEW.area_id AND e.building_id=NEW.building_id AND e.id<>NEW.id
      AND e.status='SCHEDULED' AND tstzrange(e.starts_at,e.ends_at) && tstzrange(NEW.starts_at,NEW.ends_at)) THEN
      RAISE EXCEPTION 'Another event takes this area' USING ERRCODE='23P01', CONSTRAINT='building_events_event_overlap';
    END IF;
  END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS building_events_guard ON building_events;
CREATE TRIGGER building_events_guard BEFORE INSERT OR UPDATE ON building_events FOR EACH ROW EXECUTE FUNCTION app_building_event_guard();

CREATE OR REPLACE FUNCTION app_building_event_response_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event_row building_events%ROWTYPE; taken integer;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.event_id,NEW.building_id,NEW.user_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.event_id,OLD.building_id,OLD.user_id,OLD.created_at) THEN
    RAISE EXCEPTION 'Immutable response fields' USING ERRCODE='42501';
  END IF;
  -- One answer at a time per event, so the capacity count sees every committed answer.
  PERFORM pg_advisory_xact_lock(hashtextextended('building-event:' || NEW.event_id::text, 0));
  SELECT * INTO event_row FROM building_events e WHERE e.id=NEW.event_id AND e.building_id=NEW.building_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found' USING ERRCODE='23503'; END IF;
  IF event_row.status<>'SCHEDULED' THEN
    RAISE EXCEPTION 'Event cancelled' USING ERRCODE='55000', CONSTRAINT='building_event_responses_cancelled';
  END IF;
  IF clock_timestamp()>=coalesce(event_row.rsvp_until, event_row.starts_at) THEN
    RAISE EXCEPTION 'Answers are closed for this event' USING ERRCODE='55000', CONSTRAINT='building_event_responses_closed';
  END IF;
  IF NOT NEW.attending THEN NEW.guests:=0; END IF;
  IF NEW.guests>event_row.max_guests THEN
    RAISE EXCEPTION 'Too many companions' USING ERRCODE='23514', CONSTRAINT='building_event_responses_max_guests';
  END IF;
  IF NEW.attending AND event_row.capacity IS NOT NULL THEN
    SELECT coalesce(sum(1+r.guests),0) INTO taken FROM building_event_responses r
    WHERE r.event_id=NEW.event_id AND r.attending AND r.user_id<>NEW.user_id;
    IF taken+1+NEW.guests>event_row.capacity THEN
      RAISE EXCEPTION 'Event is full' USING ERRCODE='23514', CONSTRAINT='building_event_responses_capacity';
    END IF;
  END IF;
  SELECT string_agg(p.code, ', ' ORDER BY p.code) INTO NEW.unit_label FROM app_person_current_units(NEW.building_id, NEW.user_id) p;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS building_event_responses_guard ON building_event_responses;
CREATE TRIGGER building_event_responses_guard BEFORE INSERT OR UPDATE ON building_event_responses FOR EACH ROW EXECUTE FUNCTION app_building_event_response_guard();

-- Totals of each event, for everyone who sees the event. Counts only.
CREATE OR REPLACE FUNCTION app_building_event_totals(target_building_id text)
RETURNS TABLE(event_id uuid, attending_responses integer, attending_people integer, declined_responses integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT r.event_id, (count(*) FILTER (WHERE r.attending))::integer,
   coalesce(sum(1+r.guests) FILTER (WHERE r.attending),0)::integer, (count(*) FILTER (WHERE NOT r.attending))::integer
 FROM building_event_responses r
 WHERE r.building_id=target_building_id
   AND (app_has_capability(target_building_id,'events:read') OR app_has_capability(target_building_id,'events:manage'))
 GROUP BY r.event_id;
$$;

-- ---------------------------------------------------------------- access
ALTER TABLE building_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE building_event_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE building_events, building_event_responses FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth, predioon_notifications;
GRANT SELECT ON TABLE building_events, building_event_responses TO predioon_app;
GRANT INSERT (id, building_id, title, description, location, area_id, starts_at, ends_at, rsvp_until, capacity, max_guests, created_by) ON TABLE building_events TO predioon_app;
GRANT UPDATE (title, description, location, area_id, starts_at, ends_at, rsvp_until, capacity, max_guests, status, version) ON TABLE building_events TO predioon_app;
GRANT INSERT (event_id, building_id, user_id, attending, guests) ON TABLE building_event_responses TO predioon_app;
GRANT UPDATE (attending, guests) ON TABLE building_event_responses TO predioon_app;

DROP POLICY IF EXISTS building_events_read ON building_events;
CREATE POLICY building_events_read ON building_events FOR SELECT TO predioon_app
  USING (app_has_capability(building_id,'events:read') OR app_has_capability(building_id,'events:manage'));
DROP POLICY IF EXISTS building_events_insert ON building_events;
CREATE POLICY building_events_insert ON building_events FOR INSERT TO predioon_app
  WITH CHECK (created_by=app_current_user_id() AND app_has_capability(building_id,'events:manage'));
DROP POLICY IF EXISTS building_events_update ON building_events;
CREATE POLICY building_events_update ON building_events FOR UPDATE TO predioon_app
  USING (app_has_capability(building_id,'events:manage')) WITH CHECK (app_has_capability(building_id,'events:manage'));

DROP POLICY IF EXISTS building_event_responses_read ON building_event_responses;
CREATE POLICY building_event_responses_read ON building_event_responses FOR SELECT TO predioon_app
  USING (app_has_capability(building_id,'events:manage')
    OR (user_id=app_current_user_id() AND app_has_capability(building_id,'events:read')));
DROP POLICY IF EXISTS building_event_responses_insert ON building_event_responses;
CREATE POLICY building_event_responses_insert ON building_event_responses FOR INSERT TO predioon_app
  WITH CHECK (user_id=app_current_user_id() AND app_has_capability(building_id,'events:read')
    AND app_has_capability(building_id,'events:respond-own'));
DROP POLICY IF EXISTS building_event_responses_update ON building_event_responses;
CREATE POLICY building_event_responses_update ON building_event_responses FOR UPDATE TO predioon_app
  USING (user_id=app_current_user_id() AND app_has_capability(building_id,'events:read') AND app_has_capability(building_id,'events:respond-own'))
  WITH CHECK (user_id=app_current_user_id() AND app_has_capability(building_id,'events:read') AND app_has_capability(building_id,'events:respond-own'));

-- Event readers see whether reservations (and so events) are switched on.
DROP POLICY IF EXISTS building_features_events_read ON building_feature_settings;
CREATE POLICY building_features_events_read ON building_feature_settings FOR SELECT TO predioon_app
  USING (app_has_capability(building_id,'events:read') OR app_has_capability(building_id,'events:manage'));
DROP POLICY IF EXISTS feature_runtime_events_read ON feature_runtime;
CREATE POLICY feature_runtime_events_read ON feature_runtime FOR SELECT TO predioon_app
  USING (app_has_capability(building_id,'events:read') OR app_has_capability(building_id,'events:manage'));

-- Audit proof for event management.
DO $$
DECLARE definition text;
 fallback constant text := 'ELSE false END';
 branch constant text := 'WHEN action_name IN (''EVENT_CREATED'',''EVENT_UPDATED'',''EVENT_CANCELLED'') AND target_type=''event'' THEN
   app_has_capability(target_building,''events:manage'') AND EXISTS(SELECT 1 FROM building_events e WHERE e.id::text=target_id AND e.building_id=target_building
     AND (action_name<>''EVENT_CREATED'' OR e.created_by=app_current_user_id()) AND (action_name<>''EVENT_CANCELLED'' OR e.status=''CANCELLED''))
  ';
BEGIN
 SELECT pg_get_functiondef('app_audit_legacy_insert(text,text,text,text)'::regprocedure) INTO STRICT definition;
 IF position('''EVENT_CREATED''' IN definition)=0 THEN
  IF regexp_count(definition, fallback)<>1 THEN RAISE EXCEPTION 'Unexpected audit fallback shape'; END IF;
  EXECUTE replace(definition, fallback, branch || fallback);
 ELSIF position(branch IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected event audit branch';
 END IF;
END $$;

-- Helpers belong to the owner of the capability helpers. Only the ones the
-- API calls are executable by it; the rest run inside triggers.
DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_person_current_units(text,text)'::regprocedure, 'app_reservation_own_units(text)'::regprocedure,
   'app_common_area_lock(uuid)'::regprocedure, 'app_reservation_booking_guard()'::regprocedure,
   'app_building_event_guard()'::regprocedure, 'app_building_event_response_guard()'::regprocedure,
   'app_building_event_totals(text)'::regprocedure, 'app_building_person_name(text,text)'::regprocedure
 ] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee
     WHERE p.oid=helper AND acl.grantee<>p.proowner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
 END LOOP;
 GRANT EXECUTE ON FUNCTION app_reservation_own_units(text) TO predioon_app;
 GRANT EXECUTE ON FUNCTION app_building_event_totals(text) TO predioon_app;
 GRANT EXECUTE ON FUNCTION app_building_person_name(text,text) TO predioon_app;
END $$;
