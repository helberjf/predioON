-- 057: scheduled automations (preventive maintenance).
--
-- A version reacts either to an alert (045) or to the calendar: "every N days
-- from this date, open this work order". Execution stays in the database, as
-- in 045: TimescaleDB's job scheduler, which already runs inside PostgreSQL,
-- calls app_automation_run_schedules() every five minutes. Each occurrence
-- opens at most one order (unique per rule and date); when the scheduler was
-- stopped for several periods, only the most recent due date opens an order,
-- never a backlog. The only action is still opening a work order.

ALTER TABLE automation_versions ADD COLUMN IF NOT EXISTS trigger_kind text NOT NULL DEFAULT 'ALERT';
ALTER TABLE automation_versions ADD COLUMN IF NOT EXISTS schedule_every_days integer;
ALTER TABLE automation_versions ADD COLUMN IF NOT EXISTS schedule_starts_at timestamptz;
ALTER TABLE automation_versions DROP CONSTRAINT IF EXISTS automation_versions_trigger_ck;
ALTER TABLE automation_versions ADD CONSTRAINT automation_versions_trigger_ck CHECK (
  (trigger_kind='ALERT' AND schedule_every_days IS NULL AND schedule_starts_at IS NULL)
  OR (trigger_kind='SCHEDULE' AND schedule_every_days BETWEEN 1 AND 366 AND schedule_starts_at IS NOT NULL
      AND cardinality(alert_types)=0 AND device_id IS NULL));

ALTER TABLE automation_runs ALTER COLUMN alert_id DROP NOT NULL;
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE automation_runs DROP CONSTRAINT IF EXISTS automation_runs_source_ck;
ALTER TABLE automation_runs ADD CONSTRAINT automation_runs_source_ck CHECK ((alert_id IS NULL)<>(scheduled_for IS NULL));
ALTER TABLE automation_runs DROP CONSTRAINT IF EXISTS automation_runs_schedule_once_uq;
ALTER TABLE automation_runs ADD CONSTRAINT automation_runs_schedule_once_uq UNIQUE (automation_id, scheduled_for);

-- Alert matching never selects a scheduled version.
CREATE OR REPLACE FUNCTION app_automation_matches(target automation_versions, alert_type text, alert_level alert_severity, alert_device text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  -- Never NULL: an alert without a device does not satisfy a device-scoped version.
  SELECT COALESCE(target.trigger_kind='ALERT'
    AND (cardinality(target.alert_types)=0 OR alert_type=ANY(target.alert_types))
    AND alert_level>=target.min_severity
    AND (target.device_id IS NULL OR target.device_id IS NOT DISTINCT FROM alert_device), false);
$$;

-- Same guard as 045, with the schedule fields in the immutable row.
CREATE OR REPLACE FUNCTION app_automation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='automation_versions' THEN
    -- The only change ever allowed is a referenced device, team or asset being
    -- removed, which clears that reference. Deleting a version happens only by
    -- cascade from its rule or condominium; the API role has no DELETE grant.
    IF TG_OP='UPDATE' THEN
      IF ROW(NEW.id,NEW.automation_id,NEW.building_id,NEW.number,NEW.alert_types,NEW.min_severity,NEW.order_title,NEW.order_priority,NEW.cooldown_minutes,NEW.created_by,NEW.created_at,
             NEW.trigger_kind,NEW.schedule_every_days,NEW.schedule_starts_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.automation_id,OLD.building_id,OLD.number,OLD.alert_types,OLD.min_severity,OLD.order_title,OLD.order_priority,OLD.cooldown_minutes,OLD.created_by,OLD.created_at,
             OLD.trigger_kind,OLD.schedule_every_days,OLD.schedule_starts_at)
        OR (NEW.device_id IS NOT NULL AND NEW.device_id IS DISTINCT FROM OLD.device_id)
        OR (NEW.assigned_team_id IS NOT NULL AND NEW.assigned_team_id IS DISTINCT FROM OLD.assigned_team_id)
        OR (NEW.asset_id IS NOT NULL AND NEW.asset_id IS DISTINCT FROM OLD.asset_id) THEN
        RAISE EXCEPTION 'Automation versions are immutable' USING ERRCODE='42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.number<>COALESCE((SELECT max(number) FROM automation_versions WHERE automation_id=NEW.automation_id),0)+1 THEN
      RAISE EXCEPTION 'Automation version out of sequence' USING ERRCODE='P0409';
    END IF;
    IF (NEW.device_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM devices d WHERE d.id=NEW.device_id AND d.building_id=NEW.building_id))
      OR (NEW.assigned_team_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM teams t WHERE t.id=NEW.assigned_team_id AND t.building_id=NEW.building_id AND t.active))
      OR (NEW.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assets s WHERE s.id=NEW.asset_id AND s.building_id=NEW.building_id AND s.active)) THEN
      RAISE EXCEPTION 'Automation target does not belong to this condominium' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF app_current_user_id() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM app_current_user_id() OR NEW.enabled OR NEW.published_version IS NOT NULL OR NEW.version<>1 THEN
      RAISE EXCEPTION 'Automation creation denied' USING ERRCODE='42501';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.building_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.building_id,OLD.created_by,OLD.created_at) THEN
      RAISE EXCEPTION 'Immutable automation fields' USING ERRCODE='42501';
    END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Automation changed concurrently' USING ERRCODE='P0409'; END IF;
    IF NEW.published_version IS NOT NULL AND NOT EXISTS(SELECT 1 FROM automation_versions v WHERE v.automation_id=NEW.id AND v.number=NEW.published_version) THEN
      RAISE EXCEPTION 'Unknown automation version' USING ERRCODE='23514';
    END IF;
  END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_automation_guard() FROM PUBLIC;

-- The most recent due date of a schedule at a given instant, or NULL before the start.
CREATE OR REPLACE FUNCTION app_automation_due_occurrence(starts_at timestamptz, every_days integer, at_time timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN at_time<starts_at THEN NULL
    ELSE starts_at+make_interval(days => every_days*floor(extract(epoch FROM at_time-starts_at)/(every_days*86400.0))::integer) END;
$$;

-- Executor. Each rule is isolated, as in 045: a failing one is recorded as
-- FAILED and the others still run. Returns how many orders it opened.
CREATE OR REPLACE FUNCTION app_automation_run_schedules(at_time timestamptz DEFAULT clock_timestamp())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rule record; occurrence timestamptz; actor text; created_order uuid; run_id uuid; opened integer:=0;
BEGIN
  -- Automations act as the system.
  actor:=current_setting('app.user_id', true);
  PERFORM set_config('app.user_id', '', true);
  FOR rule IN SELECT r.id, r.name, r.building_id, v.number, v.order_title, v.order_priority, v.assigned_team_id, v.asset_id, v.created_by,
      v.schedule_every_days, v.schedule_starts_at
    FROM automation_rules r JOIN automation_versions v ON v.automation_id=r.id AND v.number=r.published_version
    JOIN buildings b ON b.id=r.building_id AND b.active
    WHERE r.enabled AND v.trigger_kind='SCHEDULE' AND v.schedule_starts_at<=at_time ORDER BY r.id
  LOOP
    BEGIN
      occurrence:=app_automation_due_occurrence(rule.schedule_starts_at, rule.schedule_every_days, at_time);
      run_id:=NULL;
      INSERT INTO automation_runs(automation_id,building_id,version_number,scheduled_for,outcome)
        VALUES(rule.id, rule.building_id, rule.number, occurrence, 'CREATED')
        ON CONFLICT (automation_id, scheduled_for) DO NOTHING RETURNING id INTO run_id;
      CONTINUE WHEN run_id IS NULL;
      BEGIN
        INSERT INTO work_orders(building_id,title,description,priority,assigned_team_id,asset_id,created_by)
          VALUES(rule.building_id, rule.order_title,
            format('Manutenção programada a cada %s dia(s), referente a %s.', rule.schedule_every_days,
              to_char(occurrence AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')),
            rule.order_priority,
            (SELECT t.id FROM teams t WHERE t.id=rule.assigned_team_id AND t.building_id=rule.building_id AND t.active),
            (SELECT s.id FROM assets s WHERE s.id=rule.asset_id AND s.building_id=rule.building_id AND s.active), rule.created_by)
          RETURNING id INTO created_order;
        INSERT INTO work_order_events(work_order_id,building_id,actor_id,kind,note)
          VALUES(created_order, rule.building_id, NULL, 'CREATED', left('Aberta pela automação programada ' || rule.name, 2000));
        UPDATE automation_runs SET work_order_id=created_order WHERE id=run_id;
        opened:=opened+1;
      EXCEPTION WHEN OTHERS THEN
        UPDATE automation_runs SET outcome='FAILED' WHERE id=run_id;
      END;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  PERFORM set_config('app.user_id', COALESCE(actor, ''), true);
  RETURN opened;
END $$;
REVOKE ALL ON FUNCTION app_automation_run_schedules(timestamptz) FROM PUBLIC;

CREATE OR REPLACE PROCEDURE app_automation_schedule_job(job_id integer, config jsonb)
LANGUAGE plpgsql AS $$ BEGIN PERFORM app_automation_run_schedules(); END $$;
REVOKE ALL ON PROCEDURE app_automation_schedule_job(integer, jsonb) FROM PUBLIC;

DO $$ DECLARE helper_owner text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
 FROM pg_proc WHERE oid='app_automation_guard()'::regprocedure;
 EXECUTE format('ALTER FUNCTION app_automation_run_schedules(timestamptz) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER PROCEDURE app_automation_schedule_job(integer, jsonb) OWNER TO %I',helper_owner);
 IF NOT EXISTS(SELECT 1 FROM timescaledb_information.jobs WHERE proc_schema='public' AND proc_name='app_automation_schedule_job') THEN
  PERFORM add_job('public.app_automation_schedule_job', interval '5 minutes');
 END IF;
END $$;

GRANT INSERT (trigger_kind, schedule_every_days, schedule_starts_at) ON TABLE automation_versions TO predioon_app;
