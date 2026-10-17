-- 058: health of the background services, for the platform administration.
--
-- The overview (024) counts devices, gateways and alerts. Nothing showed
-- whether the services behind them work: ingestion receiving readings, the
-- notifications worker draining its queue, physical commands being answered,
-- the database scheduler running its jobs (057 automations, retention).
-- This function returns counts and instants only — no reading values, alert
-- messages, destinations or condominium names — to whoever holds
-- platform:read-health (024).

CREATE OR REPLACE FUNCTION app_platform_service_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT app_has_global_capability('platform:read-health') THEN
   RAISE EXCEPTION 'Health capability required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object(
   'checkedAt', clock_timestamp(),
   'ingest', (SELECT jsonb_build_object(
       'lastReadingAt', (SELECT t.time FROM telemetry t ORDER BY t.time DESC LIMIT 1),
       'lastReceivedAt', (SELECT t.received_at FROM telemetry t ORDER BY t.time DESC LIMIT 1),
       'readingsLastHour', (SELECT count(*) FROM telemetry t WHERE t.time > clock_timestamp()-interval '1 hour' AND t.time <= clock_timestamp()+interval '5 minutes'),
       'gatewaysOnline', (SELECT count(*) FROM gateways g JOIN buildings b ON b.id=g.building_id AND b.active WHERE g.enabled AND g.status='ONLINE'),
       'gatewaysEnabled', (SELECT count(*) FROM gateways g JOIN buildings b ON b.id=g.building_id AND b.active WHERE g.enabled))),
   'notifications', (SELECT jsonb_build_object(
       'waiting', count(*) FILTER (WHERE d.status IN ('pending','retry','inflight')),
       'oldestWaitingSince', min(d.created_at) FILTER (WHERE d.status IN ('pending','retry','inflight')),
       'deliveredLastDay', count(*) FILTER (WHERE d.status='delivered' AND d.updated_at > clock_timestamp()-interval '1 day'),
       'failedLastDay', count(*) FILTER (WHERE d.status='failed' AND d.updated_at > clock_timestamp()-interval '1 day'))
     FROM event_deliveries d),
   'physicalCommands', (SELECT jsonb_build_object(
       'waiting', count(*) FILTER (WHERE c.status IN ('PENDING','SENT') AND c.expires_at > clock_timestamp()),
       'acknowledgedLastDay', count(*) FILTER (WHERE c.status='ACKNOWLEDGED' AND c.created_at > clock_timestamp()-interval '1 day'),
       'failedLastDay', count(*) FILTER (WHERE c.status IN ('FAILED','EXPIRED') AND c.created_at > clock_timestamp()-interval '1 day'))
     FROM gate_commands c),
   'jobs', coalesce((SELECT jsonb_agg(jsonb_build_object(
       'name', CASE WHEN j.proc_name='app_automation_schedule_job' THEN 'automations' WHEN j.proc_name='policy_retention' THEN 'telemetry-retention' ELSE j.proc_name END,
       'scheduled', j.scheduled, 'intervalSeconds', extract(epoch FROM j.schedule_interval)::integer,
       'lastStatus', s.last_run_status, 'lastSuccessAt', s.last_successful_finish, 'failures', coalesce(s.total_failures, 0),
       'nextStartAt', s.next_start) ORDER BY j.job_id)
     FROM timescaledb_information.jobs j LEFT JOIN timescaledb_information.job_stats s ON s.job_id=j.job_id
     WHERE j.proc_name IN ('app_automation_schedule_job','policy_retention')), '[]'::jsonb),
   'database', jsonb_build_object('bytes', pg_database_size(current_database()), 'telemetryBytes', hypertable_size('public.telemetry')))
 INTO result;
 RETURN result;
END $$;

DO $$ DECLARE helper_owner text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
 FROM pg_proc WHERE oid='app_overview_platform_health()'::regprocedure;
 EXECUTE format('ALTER FUNCTION app_platform_service_health() OWNER TO %I',helper_owner);
END $$;
REVOKE ALL ON FUNCTION app_platform_service_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_platform_service_health() TO predioon_app;
