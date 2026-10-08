-- Migration 049 switched gate opening and parking counting off only where no
-- condominium existed yet. This one does the same for installations already in
-- use, so that the default no longer depends on a manual step.
--
-- A feature whose platform setting someone has already recorded, on or off, is
-- left exactly as it is: an explicit choice wins over the default. For the
-- others, every condominium that had the feature effectively on goes through
-- the same effects as the audited transition of the API (SQL038): the runtime
-- generation advances, parking occupancy is cleared, pending gate commands are
-- cancelled and audited, and alert deliveries that are no longer eligible are
-- cancelled. Nothing is deleted: turning a feature back on in the
-- administration restores the screens with their configuration intact.
DO $$ DECLARE feature text; target text; changed timestamptz; candidate uuid; affected integer;
BEGIN
 -- Same barrier as every feature transition: no reading or command crosses the change.
 PERFORM pg_advisory_xact_lock(814772,1);
 FOREACH feature IN ARRAY ARRAY['GARAGE_ACCESS','PEDESTRIAN_ACCESS','CAR_PARKING','MOTORCYCLE_PARKING'] LOOP
  CONTINUE WHEN EXISTS(SELECT 1 FROM global_feature_settings WHERE feature_key=feature);
  INSERT INTO global_feature_settings(feature_key,enabled) VALUES(feature,false);
  affected:=0;
  FOR target IN SELECT b.id FROM buildings b WHERE NOT EXISTS(
    SELECT 1 FROM building_feature_settings s WHERE s.building_id=b.id AND s.feature_key=feature AND s.enabled IS FALSE) ORDER BY b.id LOOP
   changed:=clock_timestamp();
   INSERT INTO feature_runtime(building_id,feature_key,paused_at) VALUES(target,feature,changed)
   ON CONFLICT(building_id,feature_key) DO UPDATE SET paused_at=changed,generation=feature_runtime.generation+1;
   IF feature IN ('CAR_PARKING','MOTORCYCLE_PARKING') THEN
    UPDATE parking_lots SET occupied=NULL,observed_at=NULL,source='UNKNOWN',version=version+1,updated_at=changed
    WHERE building_id=target AND vehicle_type=CASE feature WHEN 'CAR_PARKING' THEN 'CAR' ELSE 'MOTORCYCLE' END;
   ELSE
    WITH cancelled AS (UPDATE gate_commands c SET status='FAILED',failure_reason='Funcionalidade desativada'
     FROM gates g WHERE c.gate_id=g.id AND c.building_id=target AND c.status='PENDING'
      AND g.kind=CASE feature WHEN 'GARAGE_ACCESS' THEN 'GARAGE' ELSE 'PEDESTRIAN' END RETURNING c.id)
    INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
    SELECT target,NULL,'SYSTEM','ACCESS_COMMAND_CANCELLED_BY_FEATURE','gate_command',id::text,
     jsonb_build_object('feature',feature,'reason','Funcionalidade desativada') FROM cancelled;
   END IF;
   FOR candidate IN SELECT d.id FROM event_deliveries d JOIN outbox_events e ON e.id=d.event_id
    WHERE e.building_id=target AND d.status IN ('pending','retry','inflight') AND NOT notification_delivery_eligible(d.id)
    ORDER BY d.id FOR UPDATE OF d LOOP
    PERFORM notification_cancel_delivery(candidate,CASE WHEN EXISTS(SELECT 1 FROM event_deliveries d JOIN outbox_events e ON e.id=d.event_id
     JOIN alerts a ON a.id=e.alert_id AND a.building_id=e.building_id WHERE d.id=candidate) THEN 'FEATURE_INELIGIBLE' ELSE 'SOURCE_GONE' END);
   END LOOP;
   affected:=affected+1;
  END LOOP;
  INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
  VALUES(NULL,NULL,'SYSTEM','FEATURE_CONFIGURATION_CHANGED','feature',feature,jsonb_build_object('scope','GLOBAL','before',true,'after',false,
   'version',1,'reason','Migration 050: portões e vagas desligados por padrão','affectedBuildings',affected));
 END LOOP;
END $$;
