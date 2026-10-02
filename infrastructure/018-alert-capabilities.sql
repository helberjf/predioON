-- Private alert history and controlled, atomic, audited state transitions.
-- The migration runner applies this entire file in one transaction.
INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('alerts:resolve','alert','resolve','Resolver alerta')
ON CONFLICT(key) DO UPDATE SET label=EXCLUDED.label;
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('BUILDING_ADMIN','alerts:resolve'),('MAINTENANCE_MANAGER','alerts:resolve')
ON CONFLICT(role_key,permission_key) DO NOTHING;

-- Text IDs allow audit policies to reject malformed UUIDs safely. The CASE
-- keeps conversion safe and the comparison uses the alert primary key.
CREATE OR REPLACE FUNCTION app_alert_has_capability(target_building_id text,target_alert_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_capability IN ('alerts:read','alerts:acknowledge','alerts:resolve') AND EXISTS (
   SELECT 1 FROM alerts a
   WHERE a.id=CASE WHEN target_alert_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_alert_id::uuid END
     AND a.building_id=target_building_id
     AND (a.device_id IS NULL OR EXISTS(SELECT 1 FROM devices d WHERE d.id=a.device_id AND d.building_id=a.building_id))
     AND (a.gateway_id IS NULL OR EXISTS(SELECT 1 FROM gateways g WHERE g.id=a.gateway_id AND g.building_id=a.building_id))
     AND (a.rule_id IS NULL OR EXISTS(SELECT 1 FROM alert_rules r WHERE r.id=a.rule_id AND r.building_id=a.building_id
       AND (r.device_id IS NULL OR (r.device_id=a.device_id AND EXISTS(SELECT 1 FROM devices rd WHERE rd.id=r.device_id AND rd.building_id=a.building_id)))))
     AND (app_has_capability(a.building_id,target_capability,'alert',a.id::text)
       OR (a.device_id IS NOT NULL AND app_has_capability(a.building_id,target_capability,'device',a.device_id))
       OR (a.gateway_id IS NOT NULL AND app_has_capability(a.building_id,target_capability,'gateway',a.gateway_id)))
 );
$$;

-- Candidate tenants derive only from subject facts, never a global scan.
-- The optional primary key constrains point lookups before classification.
CREATE OR REPLACE FUNCTION app_alert_authorized_contexts(target_building_id text DEFAULT NULL,target_alert_id uuid DEFAULT NULL)
RETURNS TABLE(building_id text,alert_id uuid,device_id text,gateway_id text,rule_id uuid,rule_metric text,device_type text,gate_kind text,parking_vehicle_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 WITH candidate_buildings AS MATERIALIZED (
   SELECT rb.building_id FROM role_bindings rb
   WHERE rb.building_id IS NOT NULL AND (target_building_id IS NULL OR rb.building_id=target_building_id)
     AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
     AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
   UNION
   SELECT m.building_id FROM memberships m WHERE m.user_id=app_current_user_id()
     AND (target_building_id IS NULL OR m.building_id=target_building_id)
     AND app_rbac_window(m.active,m.starts_at,m.ends_at)
   UNION
   SELECT sg.building_id FROM support_grants sg WHERE sg.support_user_id=app_current_user_id()
     AND (target_building_id IS NULL OR sg.building_id=target_building_id)
     AND sg.capability='alerts:read' AND sg.revoked_at IS NULL AND sg.created_at<=now() AND sg.expires_at>now()
 ), candidate_alerts AS MATERIALIZED (
   -- Separate one-time gates keep generic plans from scanning history for
   -- an exact ID, even after PostgreSQL begins caching function query plans.
   SELECT a.* FROM candidate_buildings cb JOIN alerts a ON a.building_id=cb.building_id
   WHERE target_alert_id IS NULL
   UNION ALL
   SELECT a.* FROM alerts a JOIN candidate_buildings cb ON cb.building_id=a.building_id
   WHERE target_alert_id IS NOT NULL AND a.id=target_alert_id
 )
 SELECT a.building_id,a.id,a.device_id,a.gateway_id,a.rule_id,r.metric,d.type::text,
   (SELECT g.kind::text FROM gates g WHERE g.building_id=a.building_id AND g.device_id=a.device_id ORDER BY g.id LIMIT 1),
   (SELECT p.vehicle_type::text FROM parking_lots p WHERE p.building_id=a.building_id AND p.sensor_id=a.device_id ORDER BY p.id LIMIT 1)
 FROM candidate_alerts a
 LEFT JOIN devices d ON d.id=a.device_id AND d.building_id=a.building_id
 LEFT JOIN alert_rules r ON r.id=a.rule_id AND r.building_id=a.building_id
 WHERE app_alert_has_capability(a.building_id,a.id::text,'alerts:read');
$$;

DROP POLICY IF EXISTS alerts_scope_policy ON alerts;
CREATE POLICY alerts_scope_policy ON alerts FOR SELECT TO predioon_app
 USING (app_alert_has_capability(building_id,id::text,'alerts:read'));
REVOKE INSERT,UPDATE,DELETE ON alerts FROM predioon_app;

CREATE OR REPLACE FUNCTION app_alert_can_read_feature_state(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_has_capability(target_building_id,'alerts:read') OR EXISTS (
   -- Feature-state authorization must not search historical alerts. Inspect
   -- only the subject's current relevant grants and their exact resources.
   WITH candidate_scopes AS MATERIALIZED (
     SELECT rb.resource_type,rb.resource_id FROM role_bindings rb
     WHERE rb.building_id=target_building_id AND rb.resource_type IN ('alert','device','gateway')
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
     UNION
     SELECT sg.resource_type,sg.resource_id FROM support_grants sg
     WHERE sg.building_id=target_building_id AND sg.support_user_id=app_current_user_id()
       AND sg.capability='alerts:read' AND sg.resource_type IN ('alert','device','gateway')
       AND sg.revoked_at IS NULL AND sg.created_at<=now() AND sg.expires_at>now()
   )
   SELECT 1 FROM candidate_scopes scope
   WHERE app_has_capability(target_building_id,'alerts:read',scope.resource_type,scope.resource_id)
     AND CASE scope.resource_type
       WHEN 'alert' THEN app_alert_has_capability(target_building_id,scope.resource_id,'alerts:read')
       WHEN 'device' THEN EXISTS(SELECT 1 FROM devices d WHERE d.id=scope.resource_id AND d.building_id=target_building_id)
       WHEN 'gateway' THEN EXISTS(SELECT 1 FROM gateways g WHERE g.id=scope.resource_id AND g.building_id=target_building_id)
       ELSE false END
 );
$$;
DROP POLICY IF EXISTS feature_building_alert_read ON building_feature_settings;
CREATE POLICY feature_building_alert_read ON building_feature_settings FOR SELECT TO predioon_app
 USING (app_alert_can_read_feature_state(building_id));
DROP POLICY IF EXISTS feature_runtime_alert_read ON feature_runtime;
CREATE POLICY feature_runtime_alert_read ON feature_runtime FOR SELECT TO predioon_app
 USING (app_alert_can_read_feature_state(building_id));

-- No caller-provided actor, clock or arbitrary alert fields. Owner privileges
-- serve only this checked transition; ingestion retains its normal privileges.
CREATE OR REPLACE FUNCTION app_transition_alert(target_alert_id uuid,target_status text,request_ip text DEFAULT NULL,request_user_agent text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE current_alert alerts%ROWTYPE; required_capability text; changed_at timestamptz; actor text;
BEGIN
 IF target_status IS NULL OR target_status NOT IN ('ACKNOWLEDGED','RESOLVED') THEN
   RAISE EXCEPTION 'Invalid alert target status' USING ERRCODE='22023';
 END IF;
 SELECT * INTO current_alert FROM alerts WHERE id=target_alert_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Alert not found' USING ERRCODE='P0002'; END IF;
 IF NOT app_alert_has_capability(current_alert.building_id,current_alert.id::text,'alerts:read') THEN
   RAISE EXCEPTION 'Alert not found' USING ERRCODE='P0002';
 END IF;
 required_capability:=CASE target_status WHEN 'ACKNOWLEDGED' THEN 'alerts:acknowledge' ELSE 'alerts:resolve' END;
 IF NOT app_alert_has_capability(current_alert.building_id,current_alert.id::text,required_capability) THEN
   RAISE EXCEPTION 'Alert transition capability required' USING ERRCODE='42501';
 END IF;
 -- An unauthorized caller cannot acquire a private row lock. After any wait,
 -- acquire fresh capability snapshots before stamping the current row.
 SELECT * INTO current_alert FROM alerts WHERE id=target_alert_id FOR UPDATE;
 IF NOT FOUND OR NOT app_alert_has_capability(current_alert.building_id,current_alert.id::text,'alerts:read') THEN
   RAISE EXCEPTION 'Alert not found' USING ERRCODE='P0002';
 END IF;
 IF NOT app_alert_has_capability(current_alert.building_id,current_alert.id::text,required_capability) THEN
   RAISE EXCEPTION 'Alert transition capability required' USING ERRCODE='42501';
 END IF;
 IF current_alert.status::text=target_status THEN RETURN current_alert.id; END IF;
 IF current_alert.status='RESOLVED' THEN
   RAISE EXCEPTION 'Resolved alert cannot regress' USING ERRCODE='P0409';
 END IF;
 actor:=app_current_user_id(); changed_at:=clock_timestamp();
 IF target_status='ACKNOWLEDGED' THEN
   UPDATE alerts SET status='ACKNOWLEDGED',acknowledged_by=actor,acknowledged_at=changed_at WHERE id=current_alert.id;
 ELSE
   UPDATE alerts SET status='RESOLVED',resolved_by=actor,resolved_at=changed_at WHERE id=current_alert.id;
 END IF;
 INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,ip_address,user_agent)
 VALUES(current_alert.building_id,actor,'USER',CASE target_status WHEN 'ACKNOWLEDGED' THEN 'ALERT_ACKNOWLEDGED' ELSE 'ALERT_RESOLVED' END,'alert',current_alert.id::text,request_ip,request_user_agent);
 RETURN current_alert.id;
END;
$$;

-- Preserve 016's migrated and legacy branches. Alert actions never fall back
-- to legacy app.role authority, including malformed textual resource IDs.
DROP POLICY IF EXISTS audit_logs_insert_policy ON audit_logs;
CREATE POLICY audit_logs_insert_policy ON audit_logs FOR INSERT TO predioon_app WITH CHECK (
 user_id=app_current_user_id() AND actor_type='USER' AND CASE action
   WHEN 'BUILDING_CREATED' THEN resource_type='building' AND resource_id=building_id
     AND building_id IS NOT NULL AND app_has_global_capability('buildings:provision')
   WHEN 'BUILDING_UPDATED' THEN resource_type='building' AND resource_id=building_id
     AND building_id IS NOT NULL AND (app_has_global_capability('buildings:manage')
       OR app_has_capability(building_id,'buildings:manage','building',building_id))
   WHEN 'FEATURE_CONFIGURATION_CHANGED' THEN resource_type='feature'
     AND resource_id IS NOT NULL AND app_has_global_capability('features:manage')
   WHEN 'ALERT_ACKNOWLEDGED' THEN resource_type='alert' AND building_id IS NOT NULL
     AND app_alert_has_capability(building_id,resource_id,'alerts:read')
     AND app_alert_has_capability(building_id,resource_id,'alerts:acknowledge')
   WHEN 'ALERT_RESOLVED' THEN resource_type='alert' AND building_id IS NOT NULL
     AND app_alert_has_capability(building_id,resource_id,'alerts:read')
     AND app_alert_has_capability(building_id,resource_id,'alerts:resolve')
   ELSE app_is_platform_admin() OR (building_id IS NOT NULL AND (
     app_can_access_building(building_id) OR app_has_capability(building_id,'units:manage')
     OR app_has_capability(building_id,'teams:manage') OR app_has_capability(building_id,'memberships:manage')
   )) END
);

DO $$ DECLARE helper_owner text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER FUNCTION app_alert_has_capability(text,text,text) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_alert_authorized_contexts(text,uuid) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_alert_can_read_feature_state(text) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_transition_alert(uuid,text,text,text) OWNER TO %I',helper_owner);
END $$;
REVOKE ALL ON FUNCTION app_alert_has_capability(text,text,text),app_alert_authorized_contexts(text,uuid),app_alert_can_read_feature_state(text),app_transition_alert(uuid,text,text,text) FROM PUBLIC,predioon_identity,predioon_broker_auth;
GRANT EXECUTE ON FUNCTION app_alert_has_capability(text,text,text),app_alert_authorized_contexts(text,uuid),app_alert_can_read_feature_state(text),app_transition_alert(uuid,text,text,text) TO predioon_app;
