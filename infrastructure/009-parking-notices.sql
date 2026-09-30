-- Drizzle creates these tables; CREATE IF NOT EXISTS also supports direct migration deployments.
CREATE TABLE IF NOT EXISTS parking_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL CONSTRAINT parking_vehicle_type_ck CHECK (vehicle_type IN ('CAR', 'MOTORCYCLE')),
  capacity integer NOT NULL CONSTRAINT parking_capacity_ck CHECK (capacity BETWEEN 0 AND 100000),
  occupied integer CONSTRAINT parking_occupied_ck CHECK (occupied IS NULL OR (occupied >= 0 AND occupied <= capacity)),
  source text NOT NULL DEFAULT 'UNKNOWN' CONSTRAINT parking_source_ck CHECK (source IN ('UNKNOWN', 'MANUAL', 'SENSOR')),
  sensor_id text REFERENCES devices(id) ON DELETE SET NULL,
  observed_at timestamptz,
  stale_after_seconds integer NOT NULL DEFAULT 300 CONSTRAINT parking_freshness_ck CHECK (stale_after_seconds BETWEEN 30 AND 86400),
  version integer NOT NULL DEFAULT 1 CONSTRAINT parking_version_ck CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parking_observation_ck CHECK ((occupied IS NULL AND observed_at IS NULL AND source = 'UNKNOWN') OR (occupied IS NOT NULL AND observed_at IS NOT NULL AND source <> 'UNKNOWN'))
);
CREATE UNIQUE INDEX IF NOT EXISTS parking_lots_building_type_uq ON parking_lots(building_id, vehicle_type);
CREATE UNIQUE INDEX IF NOT EXISTS parking_lots_sensor_uq ON parking_lots(sensor_id);
CREATE TABLE IF NOT EXISTS notice_schedules (
  notice_id uuid PRIMARY KEY REFERENCES notices(id) ON DELETE CASCADE,
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  recurrence text NOT NULL DEFAULT 'NONE' CONSTRAINT notice_recurrence_ck CHECK (recurrence IN ('NONE', 'WEEKLY')),
  time_zone text NOT NULL DEFAULT 'America/Sao_Paulo'
);

CREATE OR REPLACE FUNCTION validate_parking_sensor_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sensor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.id = NEW.sensor_id AND d.building_id = NEW.building_id AND d.type = 'PARKING_SENSOR') THEN
    RAISE EXCEPTION 'Parking sensor must belong to the same building and have PARKING_SENSOR type' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS parking_sensor_scope ON parking_lots;
CREATE TRIGGER parking_sensor_scope BEFORE INSERT OR UPDATE ON parking_lots FOR EACH ROW EXECUTE FUNCTION validate_parking_sensor_scope();

CREATE OR REPLACE FUNCTION validate_notice_schedule_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM notices n WHERE n.id = NEW.notice_id AND n.building_id = NEW.building_id) THEN
    RAISE EXCEPTION 'Notice schedule must belong to the same building' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.time_zone) THEN
    RAISE EXCEPTION 'Invalid schedule timezone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notice_schedule_scope ON notice_schedules;
CREATE TRIGGER notice_schedule_scope BEFORE INSERT OR UPDATE ON notice_schedules FOR EACH ROW EXECUTE FUNCTION validate_notice_schedule_scope();

ALTER TABLE parking_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parking_read_policy ON parking_lots;
CREATE POLICY parking_read_policy ON parking_lots FOR SELECT USING (app_can_access_building(building_id));
DROP POLICY IF EXISTS parking_write_policy ON parking_lots;
CREATE POLICY parking_write_policy ON parking_lots FOR ALL USING (app_is_building_admin(building_id)) WITH CHECK (app_is_building_admin(building_id));

ALTER TABLE notice_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notice_schedules_read_policy ON notice_schedules;
CREATE POLICY notice_schedules_read_policy ON notice_schedules FOR SELECT USING (app_can_access_building(building_id) AND EXISTS (SELECT 1 FROM notices n WHERE n.id = notice_id));
DROP POLICY IF EXISTS notice_schedules_write_policy ON notice_schedules;
CREATE POLICY notice_schedules_write_policy ON notice_schedules FOR ALL USING (app_is_building_admin(building_id)) WITH CHECK (app_is_building_admin(building_id));

-- Future and expired notices cannot leak through other queries under a resident session.
DROP POLICY IF EXISTS notices_read_policy ON notices;
CREATE POLICY notices_read_policy ON notices FOR SELECT USING (app_can_access_building(building_id) AND published_at <= now() AND (expires_at IS NULL OR expires_at > now()));
GRANT SELECT, INSERT, UPDATE, DELETE ON parking_lots, notice_schedules TO predioon_app;
