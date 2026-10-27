-- Scenario chosen by a platform administrator for the demonstration field
-- simulator (services/ingest/src/demo-field.ts), per condominium. It only
-- changes what a simulated gateway publishes; it never touches real equipment.
-- The API exposes the routes only when DEMO_SCENARIOS=on, so an ordinary
-- installation keeps this table empty and unused.
CREATE TABLE IF NOT EXISTS demo_scenarios (
  building_id text PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
  scenario text NOT NULL DEFAULT 'normal',
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT demo_scenarios_scenario_ck CHECK (scenario IN ('normal','low-water','power-loss','leak','stuck-sensor','gateway-drop',
    'high-energy','high-water-consumption','pump-overrun','gas','smoke','sewage-leak'))
);
ALTER TABLE demo_scenarios ENABLE ROW LEVEL SECURITY;
-- Default privileges (002) would let the runtime role write it directly.
REVOKE ALL ON TABLE demo_scenarios FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth,
  predioon_notifications, predioon_ingest, predioon_access_service;
GRANT SELECT ON TABLE demo_scenarios TO predioon_app, predioon_ingest;
DROP POLICY IF EXISTS demo_scenarios_admin_read ON demo_scenarios;
CREATE POLICY demo_scenarios_admin_read ON demo_scenarios FOR SELECT TO predioon_app
  USING (app_has_global_capability('features:manage'));
-- The simulator reads every row: it decides which condominiums it plays from its own configuration.
DROP POLICY IF EXISTS demo_scenarios_field_read ON demo_scenarios;
CREATE POLICY demo_scenarios_field_read ON demo_scenarios FOR SELECT TO predioon_ingest USING (true);

-- The only writer: same capability as the feature switches, audited here.
CREATE OR REPLACE FUNCTION app_demo_scenario_set(target_building_id text,target_scenario text)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor text; changed timestamptz:=clock_timestamp(); previous text;
BEGIN
 actor:=app_current_user_id();
 IF actor IS NULL OR NOT app_has_global_capability('features:manage') THEN
   RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM buildings WHERE id=target_building_id) THEN
   RAISE EXCEPTION 'Condomínio não encontrado' USING ERRCODE='P0002';
 END IF;
 SELECT scenario INTO previous FROM demo_scenarios WHERE building_id=target_building_id FOR UPDATE;
 INSERT INTO demo_scenarios(building_id,scenario,updated_by,updated_at) VALUES(target_building_id,target_scenario,actor,changed)
 ON CONFLICT (building_id) DO UPDATE SET scenario=excluded.scenario,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
 VALUES(target_building_id,actor,'USER','DEMO_SCENARIO_CHANGED','demo_scenario',target_building_id,
   jsonb_build_object('before',coalesce(previous,'normal'),'after',target_scenario));
 RETURN changed;
END $$;

DO $$ DECLARE helper_owner text; helper regprocedure:='app_demo_scenario_set(text,text)'::regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
 FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
   JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper);
END $$;
