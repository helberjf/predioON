-- Apply this additive migration atomically with the controlled runner.
-- Inventory/configuration is independent of feature pause and app.role.

-- Temporary compatibility projection for existing physical-access rules.
-- Its only key is a real gate in the declared tenant, never arbitrary hardware.
-- Configuration remains private under the independent equipment capabilities.
CREATE OR REPLACE FUNCTION app_access_hardware_state(target_building_id text,target_gate_id uuid)
RETURNS TABLE(gateway_enabled boolean,gateway_status text,gateway_last_seen_at timestamptz,
 device_enabled boolean,device_status text,device_last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT gw.enabled,gw.status::text,gw.last_seen_at,d.enabled,d.status::text,d.last_seen_at
 FROM gates g
 JOIN gateways gw ON gw.id=g.gateway_id AND gw.building_id=g.building_id
 JOIN devices d ON d.id=g.device_id AND d.building_id=g.building_id AND d.gateway_id=gw.id
 JOIN users u ON u.id=app_current_user_id() AND u.active
 WHERE g.id=target_gate_id AND g.building_id=target_building_id
   AND d.type IN ('GARAGE_GATE','PEDESTRIAN_GATE','GATE_CONTROLLER')
   AND app_rbac_tenant_active(g.building_id)
   AND (u.is_platform_admin OR EXISTS (
     SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.building_id=g.building_id
       AND m.role::text IN ('BUILDING_ADMIN','RESIDENT')
       AND app_rbac_window(m.active,m.starts_at,m.ends_at)
   ));
$$;
CREATE OR REPLACE FUNCTION app_equipment_gateway_belongs(target_building_id text,target_gateway_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_gateway_id IS NULL OR EXISTS (
   SELECT 1 FROM gateways g WHERE g.id=target_gateway_id AND g.building_id=target_building_id
 );
$$;

CREATE OR REPLACE FUNCTION app_device_has_capability(target_building_id text,target_device_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_capability IN ('devices:read','devices:configure') AND EXISTS (
   SELECT 1 FROM devices d WHERE d.id=target_device_id AND d.building_id=target_building_id
     AND app_equipment_gateway_belongs(d.building_id,d.gateway_id)
     AND app_has_capability(d.building_id,target_capability,'device',d.id)
 );
$$;
CREATE OR REPLACE FUNCTION app_gateway_has_capability(target_building_id text,target_gateway_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_capability IN ('devices:read','devices:configure') AND EXISTS (
   SELECT 1 FROM gateways g WHERE g.id=target_gateway_id AND g.building_id=target_building_id
     AND app_has_capability(g.building_id,target_capability,'gateway',g.id)
 );
$$;
CREATE OR REPLACE FUNCTION app_device_metric_has_capability(target_building_id text,target_metric_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_capability IN ('devices:read','devices:configure') AND EXISTS (
   SELECT 1 FROM device_metrics m
   WHERE m.id=CASE WHEN target_metric_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_metric_id::uuid END
     AND m.building_id=target_building_id
     AND app_device_has_capability(m.building_id,m.device_id,target_capability)
 );
$$;

-- Expose relationship validation only together with the current authority to
-- assign it. The pure belonging helper remains inaccessible to runtime roles.
CREATE OR REPLACE FUNCTION app_device_can_assign_gateway(target_building_id text,target_device_id text,target_gateway_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT CASE WHEN target_device_id IS NULL
   THEN app_has_capability(target_building_id,'devices:read') AND app_has_capability(target_building_id,'devices:configure')
   ELSE app_device_has_capability(target_building_id,target_device_id,'devices:read')
     AND app_device_has_capability(target_building_id,target_device_id,'devices:configure') END
   AND app_equipment_gateway_belongs(target_building_id,target_gateway_id);
$$;

-- Only the subject's direct/team/support scope candidates are inspected.
-- Resource grants never become whole-building authority, and empty inventory
-- remains readable for a valid whole-tenant grant.
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
         AND sg.revoked_at IS NULL AND sg.created_at<=now() AND sg.expires_at>now()
     )
     SELECT 1 FROM candidate_scopes scope WHERE CASE target_resource_type
       WHEN 'device' THEN app_device_has_capability(target_building_id,scope.resource_id,'devices:read')
       WHEN 'gateway' THEN app_gateway_has_capability(target_building_id,scope.resource_id,'devices:read')
       ELSE false END
   )
 );
$$;

-- Drop only the legacy ALL policies; broker SELECT policies remain intact.
DROP POLICY IF EXISTS devices_scope_policy ON devices;
DROP POLICY IF EXISTS devices_equipment_read ON devices;
CREATE POLICY devices_equipment_read ON devices FOR SELECT TO predioon_app
 USING (app_device_has_capability(building_id,id,'devices:read'));
DROP POLICY IF EXISTS devices_equipment_insert ON devices;
CREATE POLICY devices_equipment_insert ON devices FOR INSERT TO predioon_app WITH CHECK (
 app_has_capability(building_id,'devices:read') AND app_has_capability(building_id,'devices:configure')
 AND app_device_can_assign_gateway(building_id,NULL,gateway_id)
);
DROP POLICY IF EXISTS devices_equipment_update ON devices;
CREATE POLICY devices_equipment_update ON devices FOR UPDATE TO predioon_app
 USING (app_device_has_capability(building_id,id,'devices:read') AND app_device_has_capability(building_id,id,'devices:configure'))
 WITH CHECK (app_device_has_capability(building_id,id,'devices:read') AND app_device_has_capability(building_id,id,'devices:configure')
   AND app_device_can_assign_gateway(building_id,id,gateway_id));

DROP POLICY IF EXISTS gateways_scope_policy ON gateways;
DROP POLICY IF EXISTS gateways_equipment_read ON gateways;
CREATE POLICY gateways_equipment_read ON gateways FOR SELECT TO predioon_app
 USING (app_gateway_has_capability(building_id,id,'devices:read'));
DROP POLICY IF EXISTS gateways_equipment_insert ON gateways;
CREATE POLICY gateways_equipment_insert ON gateways FOR INSERT TO predioon_app WITH CHECK (
 app_has_capability(building_id,'devices:read') AND app_has_capability(building_id,'devices:configure')
);
DROP POLICY IF EXISTS gateways_equipment_update ON gateways;
CREATE POLICY gateways_equipment_update ON gateways FOR UPDATE TO predioon_app
 USING (app_gateway_has_capability(building_id,id,'devices:read') AND app_gateway_has_capability(building_id,id,'devices:configure'))
 WITH CHECK (app_gateway_has_capability(building_id,id,'devices:read') AND app_gateway_has_capability(building_id,id,'devices:configure'));

DROP POLICY IF EXISTS device_metrics_scope_policy ON device_metrics;
DROP POLICY IF EXISTS device_metrics_equipment_read ON device_metrics;
CREATE POLICY device_metrics_equipment_read ON device_metrics FOR SELECT TO predioon_app
 USING (app_device_has_capability(building_id,device_id,'devices:read'));
DROP POLICY IF EXISTS device_metrics_equipment_insert ON device_metrics;
CREATE POLICY device_metrics_equipment_insert ON device_metrics FOR INSERT TO predioon_app WITH CHECK (
 app_device_has_capability(building_id,device_id,'devices:read') AND app_device_has_capability(building_id,device_id,'devices:configure')
);

-- Immutable tenant/id and operational ingest columns cannot be changed by app.
REVOKE UPDATE,DELETE ON devices,gateways FROM predioon_app;
GRANT UPDATE(name,type,gateway_id,hardware_address,metadata,enabled,updated_at) ON devices TO predioon_app;
GRANT UPDATE(name,serial_number,model,firmware_version,metadata,enabled,updated_at) ON gateways TO predioon_app;
REVOKE UPDATE,DELETE ON device_metrics FROM predioon_app;

-- Resident command insertion must not depend on private inventory SELECT.
-- Preserve all existing command/actor/gate/liveness checks from 008; the owner
-- projection additionally verifies actual tenant and hardware relationships.
DROP POLICY IF EXISTS gate_commands_request ON gate_commands;
CREATE POLICY gate_commands_request ON gate_commands FOR INSERT TO predioon_app WITH CHECK (
 requested_by=app_current_user_id() AND status='PENDING'
 AND created_at BETWEEN now()-interval '5 seconds' AND now()+interval '1 second'
 AND sent_at IS NULL AND acknowledged_at IS NULL AND failure_reason IS NULL
 AND app_access_role(building_id) IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM gates g CROSS JOIN LATERAL app_access_hardware_state(g.building_id,g.id) h
   WHERE g.id=gate_id AND g.building_id=gate_commands.building_id AND g.gateway_id=gate_commands.gateway_id
     AND g.device_id=gate_commands.device_id AND g.enabled
     AND (g.allow_residents OR app_access_role(g.building_id) IN ('PLATFORM_ADMIN','BUILDING_ADMIN'))
     AND h.gateway_enabled AND h.gateway_status='ONLINE' AND h.gateway_last_seen_at>now()-interval '60 seconds'
     AND h.device_enabled AND h.device_status='ONLINE' AND h.device_last_seen_at>now()-interval '60 seconds'
 )
);

-- Preserve 016/018 and legacy branches. Migrated equipment actions never
-- fall back to app.role, and each audit refers to the actual current resource.
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
   WHEN 'DEVICE_CREATED' THEN resource_type='device' AND building_id IS NOT NULL
     AND app_has_capability(building_id,'devices:read') AND app_has_capability(building_id,'devices:configure')
     AND app_device_has_capability(building_id,resource_id,'devices:read')
   WHEN 'GATEWAY_CREATED' THEN resource_type='gateway' AND building_id IS NOT NULL
     AND app_has_capability(building_id,'devices:read') AND app_has_capability(building_id,'devices:configure')
     AND app_gateway_has_capability(building_id,resource_id,'devices:read')
   WHEN 'DEVICE_UPDATED' THEN resource_type='device' AND building_id IS NOT NULL
     AND app_device_has_capability(building_id,resource_id,'devices:read')
     AND app_device_has_capability(building_id,resource_id,'devices:configure')
   WHEN 'GATEWAY_UPDATED' THEN resource_type='gateway' AND building_id IS NOT NULL
     AND app_gateway_has_capability(building_id,resource_id,'devices:read')
     AND app_gateway_has_capability(building_id,resource_id,'devices:configure')
   WHEN 'GATEWAY_CREDENTIALS_ISSUED' THEN resource_type='gateway' AND building_id IS NOT NULL
     AND app_gateway_has_capability(building_id,resource_id,'devices:read')
     AND app_gateway_has_capability(building_id,resource_id,'devices:configure')
   WHEN 'DEVICE_METRIC_CREATED' THEN resource_type='device_metric' AND building_id IS NOT NULL
     AND app_device_metric_has_capability(building_id,resource_id,'devices:read')
     AND app_device_metric_has_capability(building_id,resource_id,'devices:configure')
   ELSE app_is_platform_admin() OR (building_id IS NOT NULL AND (
     app_can_access_building(building_id) OR app_has_capability(building_id,'units:manage')
     OR app_has_capability(building_id,'teams:manage') OR app_has_capability(building_id,'memberships:manage')
   )) END
);

DO $$ DECLARE helper_owner text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER FUNCTION app_access_hardware_state(text,uuid) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_equipment_gateway_belongs(text,text) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_device_has_capability(text,text,text) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_gateway_has_capability(text,text,text) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_device_metric_has_capability(text,text,text) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_equipment_can_read_scope(text,text) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_device_can_assign_gateway(text,text,text) OWNER TO %I',helper_owner);
END $$;
REVOKE ALL ON FUNCTION app_equipment_gateway_belongs(text,text) FROM PUBLIC,predioon_app,predioon_identity,predioon_broker_auth;
-- Remove any non-owner default ACL grants from the pure relationship helper.
DO $$ DECLARE grantee_name text; BEGIN
 FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p
   CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee
   WHERE p.oid='app_equipment_gateway_belongs(text,text)'::regprocedure AND acl.grantee<>p.proowner
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION app_equipment_gateway_belongs(text,text) FROM %I',grantee_name); END LOOP;
END $$;
REVOKE ALL ON FUNCTION app_device_has_capability(text,text,text),app_gateway_has_capability(text,text,text),app_device_metric_has_capability(text,text,text),app_equipment_can_read_scope(text,text),app_device_can_assign_gateway(text,text,text) FROM PUBLIC,predioon_identity,predioon_broker_auth;
GRANT EXECUTE ON FUNCTION app_device_has_capability(text,text,text),app_gateway_has_capability(text,text,text),app_device_metric_has_capability(text,text,text),app_equipment_can_read_scope(text,text),app_device_can_assign_gateway(text,text,text) TO predioon_app;
REVOKE ALL ON FUNCTION app_access_hardware_state(text,uuid) FROM PUBLIC,predioon_identity,predioon_broker_auth;
GRANT EXECUTE ON FUNCTION app_access_hardware_state(text,uuid) TO predioon_app;
