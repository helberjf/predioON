-- 056: catalog of telemetry series for the "latest readings" query.
--
-- The dashboard asked PostgreSQL for the newest reading of every device and
-- metric with DISTINCT ON over seven days of raw telemetry. Measured on a
-- disposable cluster with 50 devices at one reading per minute, that sorted
-- ~504k rows and took ~2 s, growing linearly with devices and frequency.
-- With the list of series known, each one is a single backward probe of
-- telemetry_device_metric_time_idx.
--
-- telemetry_series holds only (building, device, metric): no value, time or
-- payload. Values keep coming from telemetry, through its own RLS. A row
-- trigger records each new series; it writes once per series, not per reading.
-- TimescaleDB 2.17 refuses compression and continuous aggregates on tables
-- with row-level security, so neither is used here.

CREATE TABLE IF NOT EXISTS telemetry_series (
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  metric text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (building_id, device_id, metric)
);
ALTER TABLE telemetry_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON telemetry_series FROM PUBLIC;

-- Same visibility as the raw samples (021): the authorized device pairs.
DROP POLICY IF EXISTS telemetry_series_scope ON telemetry_series;
CREATE POLICY telemetry_series_scope ON telemetry_series FOR SELECT TO predioon_app
 USING (
   (SELECT coalesce(jsonb_object_agg(jsonb_build_array(scope.building_id,scope.device_id)::text,true),'{}'::jsonb)
    FROM app_telemetry_authorized_devices(NULL) scope)
   ? jsonb_build_array(building_id,device_id)::text
 );
GRANT SELECT ON telemetry_series TO predioon_app;

CREATE OR REPLACE FUNCTION app_private_record_telemetry_series()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.telemetry_series s
      WHERE s.building_id=NEW.building_id AND s.device_id=NEW.device_id AND s.metric=NEW.metric) THEN
    INSERT INTO public.telemetry_series(building_id,device_id,metric) VALUES (NEW.building_id,NEW.device_id,NEW.metric)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

DO $$ DECLARE helper_owner text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
 FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER FUNCTION app_private_record_telemetry_series() OWNER TO %I',helper_owner);
 EXECUTE format('ALTER TABLE telemetry_series OWNER TO %I',helper_owner);
END $$;
REVOKE ALL ON FUNCTION app_private_record_telemetry_series() FROM PUBLIC;

DROP TRIGGER IF EXISTS telemetry_series_record ON telemetry;
CREATE TRIGGER telemetry_series_record AFTER INSERT ON telemetry
  FOR EACH ROW EXECUTE FUNCTION app_private_record_telemetry_series();

-- Only the last seven days can appear as "latest"; older series are recorded
-- again by the trigger when they report.
INSERT INTO telemetry_series(building_id,device_id,metric)
SELECT DISTINCT building_id,device_id,metric FROM telemetry WHERE time > now()-interval '7 days'
ON CONFLICT DO NOTHING;
