-- Additive feature controls. Missing settings mean enabled/inherit; no equipment is enabled here.
CREATE TABLE IF NOT EXISTS global_feature_settings (
 feature_key text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS building_feature_settings (
 building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE, feature_key text NOT NULL,
 enabled boolean, version integer NOT NULL DEFAULT 1 CHECK (version > 0), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(building_id, feature_key)
);
CREATE TABLE IF NOT EXISTS feature_runtime (
 building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE, feature_key text NOT NULL,
 resumed_at timestamptz, paused_at timestamptz, generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
 PRIMARY KEY(building_id, feature_key)
);
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['global_feature_settings','building_feature_settings','feature_runtime'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = target || '_key_check') THEN
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (feature_key IN (
    ''WATER_TANK'',''WATER_CONSUMPTION'',''ENERGY_CONSUMPTION'',''ELECTRICAL'',''PUMP'',''WATER_LEAK'',''SEWAGE_LEAK'',
    ''SMOKE'',''TEMPERATURE'',''GAS'',''AI_ANALYSIS'',''GARAGE_ACCESS'',''PEDESTRIAN_ACCESS'',''CAR_PARKING'',
    ''MOTORCYCLE_PARKING'',''NOTICES'',''RESERVATIONS'',''TICKETS'',''TICKET_GROUPING'',''TICKET_PRIORITY'',
    ''TRANSPARENCY'',''FINANCE'',''REMOTE_SUPPORT''))', target, target || '_key_check');
  END IF;
 END LOOP;
END $$;
ALTER TABLE daily_usage ADD COLUMN IF NOT EXISTS incomplete boolean NOT NULL DEFAULT false;

ALTER TABLE global_feature_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE building_feature_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_runtime ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feature_global_read ON global_feature_settings;
CREATE POLICY feature_global_read ON global_feature_settings FOR SELECT
 USING (EXISTS (SELECT 1 FROM users WHERE id = app_current_user_id() AND active));
DROP POLICY IF EXISTS feature_global_write ON global_feature_settings;
CREATE POLICY feature_global_write ON global_feature_settings FOR ALL USING (app_support_admin()) WITH CHECK (app_support_admin());
DROP POLICY IF EXISTS feature_building_read ON building_feature_settings;
CREATE POLICY feature_building_read ON building_feature_settings FOR SELECT USING (app_governance_access(building_id) OR app_support_admin());
DROP POLICY IF EXISTS feature_building_write ON building_feature_settings;
CREATE POLICY feature_building_write ON building_feature_settings FOR ALL USING (app_support_admin()) WITH CHECK (app_support_admin());
DROP POLICY IF EXISTS feature_runtime_read ON feature_runtime;
CREATE POLICY feature_runtime_read ON feature_runtime FOR SELECT USING (app_governance_access(building_id) OR app_support_admin());
GRANT SELECT, INSERT, UPDATE ON global_feature_settings, building_feature_settings TO predioon_app;
GRANT SELECT ON feature_runtime TO predioon_app;
REVOKE DELETE ON global_feature_settings, building_feature_settings FROM predioon_app;
REVOKE INSERT, UPDATE, DELETE ON feature_runtime FROM predioon_app;

-- Narrow privileged transition: the app cannot otherwise modify ingestion cursors or command outcomes.
CREATE OR REPLACE FUNCTION app_apply_feature_transition(target text, feature text, enabled_now boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changed timestamptz := clock_timestamp(); paused timestamptz; zone text; usage_kind text; gate_kind text; vehicle text;
BEGIN
 IF NOT app_support_admin() THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE = '42501'; END IF;
 PERFORM pg_advisory_xact_lock(814772, 1);
 SELECT timezone INTO STRICT zone FROM buildings WHERE id = target;
 SELECT paused_at INTO paused FROM feature_runtime WHERE building_id = target AND feature_key = feature;
 INSERT INTO feature_runtime(building_id, feature_key, resumed_at, paused_at)
 VALUES(target, feature, CASE WHEN enabled_now THEN changed END, CASE WHEN NOT enabled_now THEN changed END)
 ON CONFLICT(building_id, feature_key) DO UPDATE SET
   resumed_at = CASE WHEN enabled_now THEN changed ELSE feature_runtime.resumed_at END,
   paused_at = CASE WHEN enabled_now THEN feature_runtime.paused_at ELSE changed END,
   generation = feature_runtime.generation + 1;

 usage_kind := CASE feature WHEN 'WATER_CONSUMPTION' THEN 'WATER' WHEN 'ENERGY_CONSUMPTION' THEN 'ENERGY' WHEN 'PUMP' THEN 'PUMP' END;
 IF usage_kind IS NOT NULL THEN
  DELETE FROM usage_cursors c USING monitoring_profiles p WHERE c.profile_id = p.id AND p.building_id = target AND p.kind = usage_kind;
  UPDATE daily_usage d SET incomplete = true FROM monitoring_profiles p
   WHERE d.profile_id = p.id AND p.building_id = target AND p.kind = usage_kind
     AND d.day >= to_char((CASE WHEN enabled_now THEN coalesce(paused, changed) ELSE changed END) AT TIME ZONE zone, 'YYYY-MM-DD')
     AND d.day <= to_char(changed AT TIME ZONE zone, 'YYYY-MM-DD');
 END IF;
 vehicle := CASE feature WHEN 'CAR_PARKING' THEN 'CAR' WHEN 'MOTORCYCLE_PARKING' THEN 'MOTORCYCLE' END;
 IF vehicle IS NOT NULL THEN
  UPDATE parking_lots SET occupied = NULL, observed_at = NULL, source = 'UNKNOWN', version = version + 1, updated_at = changed
   WHERE building_id = target AND vehicle_type = vehicle;
 END IF;
 gate_kind := CASE feature WHEN 'GARAGE_ACCESS' THEN 'GARAGE' WHEN 'PEDESTRIAN_ACCESS' THEN 'PEDESTRIAN' END;
 IF gate_kind IS NOT NULL AND NOT enabled_now THEN
  WITH cancelled AS (
   UPDATE gate_commands c SET status = 'FAILED', failure_reason = 'Funcionalidade desativada'
    FROM gates g WHERE c.gate_id = g.id AND c.building_id = target AND g.kind = gate_kind AND c.status = 'PENDING'
    RETURNING c.id
  ) INSERT INTO audit_logs(building_id, user_id, actor_type, action, resource_type, resource_id, metadata)
    SELECT target, app_current_user_id(), 'USER', 'ACCESS_COMMAND_CANCELLED_BY_FEATURE', 'gate_command', id::text,
      jsonb_build_object('feature', feature, 'reason', 'Funcionalidade desativada') FROM cancelled;
 END IF;
END $$;
REVOKE ALL ON FUNCTION app_apply_feature_transition(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_apply_feature_transition(text,text,boolean) TO predioon_app;
