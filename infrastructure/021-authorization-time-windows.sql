-- Authorization windows use one database instant per statement.
-- Apply atomically with the controlled runner; existing migrations stay immutable.
-- Controlled routines explicitly evaluate a fresh wall-clock instant after locks.

CREATE OR REPLACE FUNCTION app_rbac_window(active boolean, starts_at timestamptz, ends_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(active, false)
    AND (starts_at IS NULL OR (isfinite(starts_at) AND starts_at <= statement_timestamp()))
    AND (ends_at IS NULL OR (isfinite(ends_at) AND ends_at > statement_timestamp()))
    AND (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);
$$;

CREATE OR REPLACE FUNCTION app_rbac_window_at(active boolean, starts_at timestamptz, ends_at timestamptz, evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT evaluated_at IS NOT NULL AND isfinite(evaluated_at) AND coalesce(active, false)
    AND (starts_at IS NULL OR (isfinite(starts_at) AND starts_at <= evaluated_at))
    AND (ends_at IS NULL OR (isfinite(ends_at) AND ends_at > evaluated_at))
    AND (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);
$$;

CREATE OR REPLACE FUNCTION app_rbac_platform_role_at(target_user_id text, target_role text, evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT evaluated_at IS NOT NULL AND isfinite(evaluated_at) AND EXISTS (
    SELECT 1 FROM users u JOIN roles r ON r.key=target_role AND r.scope='PLATFORM' AND r.active
    WHERE u.id=target_user_id AND u.active AND (
      (target_role='PLATFORM_ADMIN' AND u.is_platform_admin)
      OR EXISTS (SELECT 1 FROM role_bindings rb WHERE rb.user_id=u.id AND rb.role_key=r.key
        AND rb.building_id IS NULL AND rb.team_id IS NULL AND rb.resource_type IS NULL
        AND app_rbac_window_at(rb.active,rb.starts_at,rb.ends_at,evaluated_at))
    )
  );
$$;

CREATE OR REPLACE FUNCTION app_rbac_team_member_at(target_building_id text, target_team_id uuid, evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT evaluated_at IS NOT NULL AND isfinite(evaluated_at) AND app_rbac_tenant_active(target_building_id) AND EXISTS (
    SELECT 1 FROM teams t JOIN team_members tm ON tm.team_id=t.id AND tm.building_id=t.building_id
    WHERE t.id=target_team_id AND t.building_id=target_building_id AND t.active
      AND tm.user_id=app_current_user_id() AND app_rbac_window_at(tm.active,tm.starts_at,tm.ends_at,evaluated_at)
  );
$$;

CREATE OR REPLACE FUNCTION app_has_capability_at(
  target_building_id text, target_capability text,
  target_resource_type text, target_resource_id text, evaluated_at timestamptz
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT evaluated_at IS NOT NULL AND isfinite(evaluated_at) AND app_rbac_tenant_active(target_building_id)
    AND app_rbac_scope_valid(target_resource_type,target_resource_id)
    AND EXISTS (SELECT 1 FROM permissions p WHERE p.key=target_capability AND p.active)
    AND (
      EXISTS (
        SELECT 1 FROM role_bindings rb
        JOIN roles r ON r.key=rb.role_key AND r.active AND r.scope IN ('BUILDING','RESOURCE')
        JOIN role_permissions rp ON rp.role_key=r.key AND rp.permission_key=target_capability
        WHERE rb.building_id=target_building_id AND app_rbac_window_at(rb.active,rb.starts_at,rb.ends_at,evaluated_at)
          AND (rb.user_id=app_current_user_id() OR app_rbac_team_member_at(rb.building_id,rb.team_id,evaluated_at))
          AND (rb.resource_type IS NULL OR (rb.resource_type=target_resource_type AND rb.resource_id=target_resource_id))
      )
      OR EXISTS (
        SELECT 1 FROM memberships m
        JOIN roles r ON r.key=m.role::text AND r.active AND r.scope='BUILDING'
        JOIN role_permissions rp ON rp.role_key=r.key AND rp.permission_key=target_capability
        WHERE m.user_id=app_current_user_id() AND m.building_id=target_building_id
          AND app_rbac_window_at(m.active,m.starts_at,m.ends_at,evaluated_at)
      )
      OR (
        app_rbac_platform_role_at(app_current_user_id(),'PLATFORM_SUPPORT',evaluated_at)
        AND target_capability IN ('telemetry:read','alerts:read','devices:read','work-orders:read-assigned','support:read')
        AND EXISTS (
          SELECT 1 FROM support_grants sg WHERE sg.support_user_id=app_current_user_id()
            AND sg.building_id=target_building_id AND sg.capability=target_capability
            AND sg.revoked_at IS NULL AND sg.created_at <= evaluated_at AND sg.expires_at > evaluated_at AND isfinite(sg.expires_at)
            AND btrim(sg.reason) <> '' AND sg.support_user_id <> sg.granted_by
            AND (sg.resource_type IS NULL OR (sg.resource_type=target_resource_type AND sg.resource_id=target_resource_id))
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION app_has_global_capability_at(target_capability text, evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT evaluated_at IS NOT NULL AND isfinite(evaluated_at) AND target_capability IN ('plans:read','plans:manage','rbac:manage','support:grant',
   'buildings:read','buildings:manage','buildings:provision','features:manage')
   AND app_rbac_platform_role_at(app_current_user_id(),'PLATFORM_ADMIN',evaluated_at)
   AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.key=rp.permission_key AND p.active
     WHERE rp.role_key='PLATFORM_ADMIN' AND p.key=target_capability);
$$;

CREATE OR REPLACE FUNCTION app_rbac_platform_role(target_user_id text, target_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_rbac_platform_role_at(target_user_id,target_role,statement_timestamp());
$$;

CREATE OR REPLACE FUNCTION app_rbac_team_member(target_building_id text, target_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_rbac_team_member_at(target_building_id,target_team_id,statement_timestamp());
$$;

CREATE OR REPLACE FUNCTION app_has_capability(target_building_id text, target_capability text, target_resource_type text DEFAULT NULL, target_resource_id text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_has_capability_at(target_building_id,target_capability,target_resource_type,target_resource_id,statement_timestamp());
$$;

CREATE OR REPLACE FUNCTION app_has_global_capability(target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_has_global_capability_at(target_capability,statement_timestamp());
$$;

CREATE OR REPLACE FUNCTION app_alert_has_capability_at(target_building_id text,target_alert_id text,target_capability text, evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT evaluated_at IS NOT NULL AND isfinite(evaluated_at) AND target_capability IN ('alerts:read','alerts:acknowledge','alerts:resolve') AND EXISTS (
   SELECT 1 FROM alerts a
   WHERE a.id=CASE WHEN target_alert_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_alert_id::uuid END
     AND a.building_id=target_building_id
     AND (a.device_id IS NULL OR EXISTS(SELECT 1 FROM devices d WHERE d.id=a.device_id AND d.building_id=a.building_id))
     AND (a.gateway_id IS NULL OR EXISTS(SELECT 1 FROM gateways g WHERE g.id=a.gateway_id AND g.building_id=a.building_id))
     AND (a.rule_id IS NULL OR EXISTS(SELECT 1 FROM alert_rules r WHERE r.id=a.rule_id AND r.building_id=a.building_id
       AND (r.device_id IS NULL OR (r.device_id=a.device_id AND EXISTS(SELECT 1 FROM devices rd WHERE rd.id=r.device_id AND rd.building_id=a.building_id)))))
     AND (app_has_capability_at(a.building_id,target_capability,'alert',a.id::text,evaluated_at)
       OR (a.device_id IS NOT NULL AND app_has_capability_at(a.building_id,target_capability,'device',a.device_id,evaluated_at))
       OR (a.gateway_id IS NOT NULL AND app_has_capability_at(a.building_id,target_capability,'gateway',a.gateway_id,evaluated_at)))
 );
$$;

CREATE OR REPLACE FUNCTION app_alert_has_capability(target_building_id text,target_alert_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_alert_has_capability_at(target_building_id,target_alert_id,target_capability,statement_timestamp());
$$;

CREATE OR REPLACE FUNCTION app_telemetry_authorized_devices(
 target_building_id text DEFAULT NULL, target_capability text DEFAULT 'telemetry:read'
) RETURNS TABLE(building_id text,device_id text,device_name text,device_type text,gate_kind text,parking_vehicle_type text)
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
     AND sg.capability=target_capability AND sg.revoked_at IS NULL
     AND sg.created_at<=statement_timestamp() AND sg.expires_at>statement_timestamp()
 )
 SELECT d.building_id,d.id,d.name,d.type::text,
   (SELECT g.kind::text FROM gates g WHERE g.building_id=d.building_id AND g.device_id=d.id ORDER BY g.id LIMIT 1),
   (SELECT p.vehicle_type::text FROM parking_lots p WHERE p.building_id=d.building_id AND p.sensor_id=d.id ORDER BY p.id LIMIT 1)
 FROM candidate_buildings cb JOIN devices d ON d.building_id=cb.building_id
 WHERE target_capability IN ('telemetry:read','telemetry:read-published')
   AND app_has_capability(d.building_id,target_capability,'device',d.id);
$$;

-- A scalar InitPlan computes the device scope once for the whole statement,
-- even when Timescale rescans a shared subplan across multiple weekly chunks.
-- Ordered JSON tuple keys preserve exact tenant/device pairs without delimiter
-- collisions; JSONB object membership avoids a linear scope scan per sample.
DROP POLICY IF EXISTS telemetry_scope_policy ON telemetry;
CREATE POLICY telemetry_scope_policy ON telemetry FOR SELECT TO predioon_app
 USING (
   (SELECT coalesce(jsonb_object_agg(jsonb_build_array(scope.building_id,scope.device_id)::text,true),'{}'::jsonb)
    FROM app_telemetry_authorized_devices(NULL) scope)
   ? jsonb_build_array(building_id,device_id)::text
 );

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
     AND sg.capability='alerts:read' AND sg.revoked_at IS NULL AND sg.created_at<=statement_timestamp() AND sg.expires_at>statement_timestamp()
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
       AND sg.revoked_at IS NULL AND sg.created_at<=statement_timestamp() AND sg.expires_at>statement_timestamp()
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

CREATE OR REPLACE FUNCTION app_equipment_can_read_scope(target_building_id text,target_resource_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_resource_type IN ('device','gateway') AND (
   app_has_capability(target_building_id,'devices:read') OR EXISTS (
     WITH candidate_scopes AS MATERIALIZED (
       SELECT rb.resource_id FROM role_bindings rb
       WHERE rb.building_id=target_building_id AND rb.resource_type=target_resource_type
         AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
         AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
       UNION
       SELECT sg.resource_id FROM support_grants sg
       WHERE sg.building_id=target_building_id AND sg.support_user_id=app_current_user_id()
         AND sg.capability='devices:read' AND sg.resource_type=target_resource_type
         AND sg.revoked_at IS NULL AND sg.created_at<=statement_timestamp() AND sg.expires_at>statement_timestamp()
     )
     SELECT 1 FROM candidate_scopes scope WHERE CASE target_resource_type
       WHEN 'device' THEN app_device_has_capability(target_building_id,scope.resource_id,'devices:read')
       WHEN 'gateway' THEN app_gateway_has_capability(target_building_id,scope.resource_id,'devices:read')
       ELSE false END
   )
 );
$$;

DROP POLICY IF EXISTS support_grants_read ON support_grants;
CREATE POLICY support_grants_read ON support_grants FOR SELECT USING (
  app_rbac_tenant_active(building_id) AND (
    app_has_global_capability('support:grant') OR app_has_capability(building_id,'support:read')
    OR (support_user_id=app_current_user_id() AND revoked_at IS NULL AND expires_at>statement_timestamp() AND app_rbac_platform_role(support_user_id,'PLATFORM_SUPPORT'))
  )
);

DROP POLICY IF EXISTS support_grants_write ON support_grants;
CREATE POLICY support_grants_write ON support_grants FOR ALL
USING (app_rbac_tenant_active(building_id) AND app_has_global_capability('support:grant') AND support_user_id<>app_current_user_id())
WITH CHECK (
  app_rbac_tenant_active(building_id) AND app_has_global_capability('support:grant')
  AND granted_by=app_current_user_id() AND support_user_id<>app_current_user_id()
  AND app_rbac_platform_role(support_user_id,'PLATFORM_SUPPORT') AND expires_at>statement_timestamp() AND created_at<=statement_timestamp()
);

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
 changed_at:=clock_timestamp();
 IF NOT FOUND OR NOT app_alert_has_capability_at(current_alert.building_id,current_alert.id::text,'alerts:read',changed_at) THEN
   RAISE EXCEPTION 'Alert not found' USING ERRCODE='P0002';
 END IF;
 IF NOT app_alert_has_capability_at(current_alert.building_id,current_alert.id::text,required_capability,changed_at) THEN
   RAISE EXCEPTION 'Alert transition capability required' USING ERRCODE='42501';
 END IF;
 IF current_alert.status::text=target_status THEN RETURN current_alert.id; END IF;
 IF current_alert.status='RESOLVED' THEN
   RAISE EXCEPTION 'Resolved alert cannot regress' USING ERRCODE='P0409';
 END IF;
 actor:=app_current_user_id();
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

CREATE OR REPLACE FUNCTION app_apply_feature_transition(target text, feature text, enabled_now boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changed timestamptz; paused timestamptz; zone text; usage_kind text; gate_kind text; vehicle text;
BEGIN
 IF NOT app_has_global_capability('features:manage') THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE = '42501'; END IF;
 PERFORM pg_advisory_xact_lock(814772, 1);
 changed:=clock_timestamp();
 IF NOT app_has_global_capability_at('features:manage',changed) THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE = '42501'; END IF;
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

-- Private historical helpers cannot be used as a runtime permission oracle.
-- Remove every non-owner ACL, including grants inherited from default privileges.
DO $$ DECLARE helper_owner text; signature text; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
 FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOR signature IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('app_rbac_window_at','app_rbac_platform_role_at','app_rbac_team_member_at','app_has_capability_at','app_has_global_capability_at','app_alert_has_capability_at')
 LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,predioon_app,predioon_identity,predioon_broker_auth',signature);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee
     WHERE p.oid=signature::regprocedure AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,grantee_name); END LOOP;
 END LOOP;
END $$;
