-- Automations: "when an alert like this opens, open a work order like that".
-- A rule has immutable numbered versions; only a published version of an
-- enabled rule runs. New rules start disabled. The single supported action
-- opens a work order: nothing here can request a physical command.
-- The two automation permissions were seeded in 014.
CREATE TABLE IF NOT EXISTS automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  published_version integer,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT automation_rules_id_building_uq UNIQUE (id, building_id),
  CONSTRAINT automation_rules_name_ck CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT automation_rules_enabled_ck CHECK (NOT enabled OR published_version IS NOT NULL),
  CONSTRAINT automation_rules_version_ck CHECK (version>0)
);
CREATE INDEX IF NOT EXISTS automation_rules_building_idx ON automation_rules(building_id, name, id);

CREATE TABLE IF NOT EXISTS automation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL,
  building_id text NOT NULL,
  number integer NOT NULL,
  alert_types text[] NOT NULL DEFAULT '{}',
  min_severity alert_severity NOT NULL DEFAULT 'INFO',
  device_id text REFERENCES devices(id) ON DELETE SET NULL,
  order_title text NOT NULL,
  order_priority text NOT NULL DEFAULT 'NORMAL',
  assigned_team_id uuid,
  asset_id uuid,
  cooldown_minutes integer NOT NULL DEFAULT 60,
  created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT automation_versions_number_uq UNIQUE (automation_id, number),
  CONSTRAINT automation_versions_number_ck CHECK (number>0),
  CONSTRAINT automation_versions_types_ck CHECK (cardinality(alert_types)<=20 AND array_position(alert_types, NULL) IS NULL),
  CONSTRAINT automation_versions_title_ck CHECK (order_title=btrim(order_title) AND char_length(order_title) BETWEEN 1 AND 160),
  CONSTRAINT automation_versions_priority_ck CHECK (order_priority IN ('LOW','NORMAL','HIGH','URGENT')),
  CONSTRAINT automation_versions_cooldown_ck CHECK (cooldown_minutes BETWEEN 0 AND 10080),
  CONSTRAINT automation_versions_rule_fk FOREIGN KEY (automation_id, building_id) REFERENCES automation_rules(id, building_id) ON DELETE CASCADE,
  CONSTRAINT automation_versions_team_fk FOREIGN KEY (assigned_team_id, building_id) REFERENCES teams(id, building_id) ON DELETE SET NULL (assigned_team_id),
  CONSTRAINT automation_versions_asset_fk FOREIGN KEY (asset_id, building_id) REFERENCES assets(id, building_id) ON DELETE SET NULL (asset_id)
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL,
  building_id text NOT NULL,
  version_number integer NOT NULL,
  alert_id uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  outcome text NOT NULL,
  work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- One decision per rule and alert: a repeated delivery of the same alert cannot act twice.
  CONSTRAINT automation_runs_once_uq UNIQUE (automation_id, alert_id),
  CONSTRAINT automation_runs_outcome_ck CHECK (outcome IN ('CREATED','SKIPPED_COOLDOWN','FAILED')),
  CONSTRAINT automation_runs_rule_fk FOREIGN KEY (automation_id, building_id) REFERENCES automation_rules(id, building_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS automation_runs_rule_created_idx ON automation_runs(automation_id, created_at DESC, id DESC);

-- The one definition of "this version reacts to that alert", shared by the
-- real trigger and by simulation so the two can never disagree.
CREATE OR REPLACE FUNCTION app_automation_matches(target automation_versions, alert_type text, alert_level alert_severity, alert_device text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  -- Never NULL: an alert without a device does not satisfy a device-scoped version.
  SELECT COALESCE((cardinality(target.alert_types)=0 OR alert_type=ANY(target.alert_types))
    AND alert_level>=target.min_severity
    AND (target.device_id IS NULL OR target.device_id IS NOT DISTINCT FROM alert_device), false);
$$;

CREATE OR REPLACE FUNCTION app_automation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='automation_versions' THEN
    -- The only change ever allowed is a referenced device, team or asset being
    -- removed, which clears that reference. Deleting a version happens only by
    -- cascade from its rule or condominium; the API role has no DELETE grant.
    IF TG_OP='UPDATE' THEN
      IF ROW(NEW.id,NEW.automation_id,NEW.building_id,NEW.number,NEW.alert_types,NEW.min_severity,NEW.order_title,NEW.order_priority,NEW.cooldown_minutes,NEW.created_by,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.automation_id,OLD.building_id,OLD.number,OLD.alert_types,OLD.min_severity,OLD.order_title,OLD.order_priority,OLD.cooldown_minutes,OLD.created_by,OLD.created_at)
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
DROP TRIGGER IF EXISTS automation_rules_guard ON automation_rules;
CREATE TRIGGER automation_rules_guard BEFORE INSERT OR UPDATE ON automation_rules FOR EACH ROW EXECUTE FUNCTION app_automation_guard();
DROP TRIGGER IF EXISTS automation_versions_guard ON automation_versions;
CREATE TRIGGER automation_versions_guard BEFORE INSERT OR UPDATE ON automation_versions FOR EACH ROW EXECUTE FUNCTION app_automation_guard();

-- Runs in the transaction that stores the alert, so the decision and its
-- effect are atomic with it. Each rule is isolated: a failing automation is
-- recorded as FAILED and never prevents the alert from being stored.
CREATE OR REPLACE FUNCTION app_automation_on_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rule record; target automation_versions%ROWTYPE; actor text; created_order uuid; run_id uuid;
BEGIN
  IF NEW.status<>'OPEN' THEN RETURN NEW; END IF;
  -- Automations act as the system, whatever session stored the alert.
  actor:=current_setting('app.user_id', true);
  PERFORM set_config('app.user_id', '', true);
  FOR rule IN SELECT r.id, r.name, r.published_version FROM automation_rules r
    WHERE r.building_id=NEW.building_id AND r.enabled AND r.published_version IS NOT NULL ORDER BY r.id
  LOOP
    BEGIN
      SELECT * INTO target FROM automation_versions v WHERE v.automation_id=rule.id AND v.number=rule.published_version;
      CONTINUE WHEN NOT FOUND OR NOT app_automation_matches(target, NEW.type, NEW.severity, NEW.device_id);
      INSERT INTO automation_runs(automation_id,building_id,version_number,alert_id,outcome)
        VALUES(rule.id, NEW.building_id, target.number, NEW.id,
          CASE WHEN target.cooldown_minutes>0 AND EXISTS(SELECT 1 FROM automation_runs p WHERE p.automation_id=rule.id AND p.outcome='CREATED'
            AND p.created_at>clock_timestamp()-make_interval(mins => target.cooldown_minutes)) THEN 'SKIPPED_COOLDOWN' ELSE 'CREATED' END)
        ON CONFLICT (automation_id, alert_id) DO NOTHING RETURNING id INTO run_id;
      CONTINUE WHEN run_id IS NULL OR EXISTS(SELECT 1 FROM automation_runs WHERE id=run_id AND outcome='SKIPPED_COOLDOWN');
      BEGIN
        INSERT INTO work_orders(building_id,title,description,priority,assigned_team_id,asset_id,created_by)
          VALUES(NEW.building_id, target.order_title, left(NEW.message, 4000), target.order_priority,
            (SELECT t.id FROM teams t WHERE t.id=target.assigned_team_id AND t.building_id=NEW.building_id AND t.active),
            (SELECT s.id FROM assets s WHERE s.id=target.asset_id AND s.building_id=NEW.building_id AND s.active), target.created_by)
          RETURNING id INTO created_order;
        INSERT INTO work_order_events(work_order_id,building_id,actor_id,kind,note)
          VALUES(created_order, NEW.building_id, NULL, 'CREATED', left('Aberta pela automação ' || rule.name, 2000));
        UPDATE automation_runs SET work_order_id=created_order WHERE id=run_id;
      EXCEPTION WHEN OTHERS THEN
        UPDATE automation_runs SET outcome='FAILED' WHERE id=run_id;
      END;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  PERFORM set_config('app.user_id', COALESCE(actor, ''), true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_automation_on_alert() FROM PUBLIC;
DROP TRIGGER IF EXISTS alerts_automations ON alerts;
CREATE TRIGGER alerts_automations AFTER INSERT ON alerts FOR EACH ROW EXECUTE FUNCTION app_automation_on_alert();

-- Dry run for the management screen: which recent alerts a version would react to.
CREATE OR REPLACE FUNCTION app_automation_simulate(target_automation uuid, target_number integer)
RETURNS TABLE(alert_id uuid, alert_type text, severity alert_severity, message text, triggered_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT a.id, a.type, a.severity, a.message, a.triggered_at
  FROM automation_versions v JOIN automation_rules r ON r.id=v.automation_id
  JOIN alerts a ON a.building_id=v.building_id AND a.triggered_at>clock_timestamp()-interval '30 days'
  WHERE v.automation_id=target_automation AND v.number=target_number
    AND app_has_capability(r.building_id,'automations:read') AND app_has_capability(r.building_id,'alerts:read')
    AND app_automation_matches(v, a.type, a.severity, a.device_id)
  ORDER BY a.triggered_at DESC, a.id DESC LIMIT 50;
$$;
REVOKE ALL ON FUNCTION app_automation_simulate(uuid,integer) FROM PUBLIC, predioon_identity, predioon_broker_auth, predioon_notifications;
GRANT EXECUTE ON FUNCTION app_automation_simulate(uuid,integer) TO predioon_app;

ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE automation_rules, automation_versions, automation_runs FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth, predioon_notifications;
GRANT SELECT ON TABLE automation_rules, automation_versions, automation_runs TO predioon_app;
GRANT INSERT (id, building_id, name, created_by), UPDATE (name, enabled, published_version, version) ON TABLE automation_rules TO predioon_app;
GRANT INSERT (id, automation_id, building_id, number, alert_types, min_severity, device_id, order_title, order_priority, assigned_team_id, asset_id, cooldown_minutes, created_by)
  ON TABLE automation_versions TO predioon_app;

DROP POLICY IF EXISTS automation_rules_read ON automation_rules;
CREATE POLICY automation_rules_read ON automation_rules FOR SELECT TO predioon_app USING (app_has_capability(building_id,'automations:read'));
DROP POLICY IF EXISTS automation_rules_insert ON automation_rules;
CREATE POLICY automation_rules_insert ON automation_rules FOR INSERT TO predioon_app
  WITH CHECK (created_by=app_current_user_id() AND app_has_capability(building_id,'automations:manage'));
DROP POLICY IF EXISTS automation_rules_update ON automation_rules;
CREATE POLICY automation_rules_update ON automation_rules FOR UPDATE TO predioon_app
  USING (app_has_capability(building_id,'automations:manage')) WITH CHECK (app_has_capability(building_id,'automations:manage'));
DROP POLICY IF EXISTS automation_versions_read ON automation_versions;
CREATE POLICY automation_versions_read ON automation_versions FOR SELECT TO predioon_app USING (app_has_capability(building_id,'automations:read'));
-- Publishing a work-order action needs the right to distribute work orders too.
DROP POLICY IF EXISTS automation_versions_insert ON automation_versions;
CREATE POLICY automation_versions_insert ON automation_versions FOR INSERT TO predioon_app
  WITH CHECK (created_by=app_current_user_id() AND app_has_capability(building_id,'automations:manage')
    AND app_has_capability(building_id,'work-orders:assign'));
DROP POLICY IF EXISTS automation_runs_read ON automation_runs;
CREATE POLICY automation_runs_read ON automation_runs FOR SELECT TO predioon_app USING (app_has_capability(building_id,'automations:read'));

DO $$
DECLARE definition text;
 fallback constant text := 'ELSE false END';
 branch constant text := 'WHEN action_name IN (''AUTOMATION_CREATED'',''AUTOMATION_VERSION_ADDED'',''AUTOMATION_PUBLISHED'',''AUTOMATION_ENABLED'',''AUTOMATION_DISABLED'') AND target_type=''automation'' THEN
   app_has_capability(target_building,''automations:manage'') AND EXISTS(SELECT 1 FROM automation_rules r WHERE r.id::text=target_id AND r.building_id=target_building
     AND (action_name<>''AUTOMATION_CREATED'' OR r.created_by=app_current_user_id()))
  ';
BEGIN
 SELECT pg_get_functiondef('app_audit_legacy_insert(text,text,text,text)'::regprocedure) INTO STRICT definition;
 IF position('''AUTOMATION_CREATED''' IN definition)=0 THEN
  IF regexp_count(definition, fallback)<>1 THEN RAISE EXCEPTION 'Unexpected audit fallback shape'; END IF;
  EXECUTE replace(definition, fallback, branch || fallback);
 ELSIF position(branch IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected automation audit branch';
 END IF;
END $$;
