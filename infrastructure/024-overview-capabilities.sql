-- Additive health projection. Apply/reapply atomically with ON_ERROR_STOP.
INSERT INTO permissions(key,resource_type,action,label)
VALUES ('platform:read-health','platform','read-health','Consultar saúde agregada da plataforma')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
VALUES ('PLATFORM_ADMIN','platform:read-health') ON CONFLICT DO NOTHING;

-- Only the whitelist changes; the statement clock and live role/catalog checks
-- from 021 remain intact. CREATE OR REPLACE preserves existing owner and ACL.
CREATE OR REPLACE FUNCTION app_has_global_capability_at(target_capability text, evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT evaluated_at IS NOT NULL AND isfinite(evaluated_at) AND target_capability IN ('plans:read','plans:manage','rbac:manage','support:grant',
   'buildings:read','buildings:manage','buildings:provision','features:manage','platform:read-health')
   AND app_rbac_platform_role_at(app_current_user_id(),'PLATFORM_ADMIN',evaluated_at)
   AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.key=rp.permission_key AND p.active
     WHERE rp.role_key='PLATFORM_ADMIN' AND p.key=target_capability);
$$;

-- The app receives counts only. Each domain is aggregated independently;
-- historical readings, private configuration and alert messages are never read.
CREATE OR REPLACE FUNCTION app_overview_platform_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb; directory_allowed boolean;
BEGIN
 IF NOT app_has_global_capability('platform:read-health') THEN
   RAISE EXCEPTION 'Health capability required' USING ERRCODE='42501';
 END IF;
 directory_allowed := app_has_global_capability('buildings:read');
 WITH active_buildings AS MATERIALIZED (
   SELECT b.id,b.name,b.code,o.name organization_name FROM buildings b
   JOIN organizations o ON o.id=b.organization_id AND o.active WHERE b.active
 ), valid_gateways AS MATERIALIZED (
   SELECT g.id,g.building_id,g.status FROM gateways g JOIN active_buildings b ON b.id=g.building_id
 ), valid_devices AS MATERIALIZED (
   SELECT d.id,d.building_id,d.type,d.status FROM devices d JOIN active_buildings b ON b.id=d.building_id
   WHERE app_equipment_gateway_belongs(d.building_id,d.gateway_id)
 ), valid_alerts AS MATERIALIZED (
   SELECT a.building_id,a.severity FROM alerts a JOIN active_buildings b ON b.id=a.building_id
   WHERE a.status<>'RESOLVED'
     AND (a.device_id IS NULL OR EXISTS(SELECT 1 FROM devices d WHERE d.id=a.device_id AND d.building_id=a.building_id))
     AND (a.gateway_id IS NULL OR EXISTS(SELECT 1 FROM gateways g WHERE g.id=a.gateway_id AND g.building_id=a.building_id))
     AND (a.rule_id IS NULL OR EXISTS(SELECT 1 FROM alert_rules r WHERE r.id=a.rule_id AND r.building_id=a.building_id
       AND (r.device_id IS NULL OR (r.device_id=a.device_id AND EXISTS(SELECT 1 FROM devices d WHERE d.id=r.device_id AND d.building_id=a.building_id)))))
 ), device_totals AS (
   SELECT building_id,count(*) devices,count(*) FILTER(WHERE status='ONLINE') devices_online FROM valid_devices GROUP BY building_id
 ), gateway_totals AS (
   SELECT building_id,count(*) gateways,count(*) FILTER(WHERE status='ONLINE') gateways_online FROM valid_gateways GROUP BY building_id
 ), alert_totals AS (
   SELECT building_id,count(*) open_alerts,count(*) FILTER(WHERE severity IN ('HIGH','CRITICAL')) critical_alerts FROM valid_alerts GROUP BY building_id
 ), category_totals AS (
   SELECT type::text type,count(*) devices,count(*) FILTER(WHERE status='ONLINE') devices_online FROM valid_devices GROUP BY type
 ), building_category_totals AS (
   SELECT building_id,type::text type,count(*) devices,count(*) FILTER(WHERE status='ONLINE') devices_online FROM valid_devices GROUP BY building_id,type
 )
 SELECT jsonb_build_object(
   'counts',jsonb_build_object('organizations',(SELECT count(*) FROM organizations WHERE active),'buildings',(SELECT count(*) FROM active_buildings),
     'users',(SELECT count(*) FROM users WHERE active),'devices',(SELECT count(*) FROM valid_devices),'devices_online',(SELECT count(*) FROM valid_devices WHERE status='ONLINE'),
     'gateways',(SELECT count(*) FROM valid_gateways),'gateways_online',(SELECT count(*) FROM valid_gateways WHERE status='ONLINE'),
     'open_alerts',(SELECT count(*) FROM valid_alerts),'critical_alerts',(SELECT count(*) FROM valid_alerts WHERE severity IN ('HIGH','CRITICAL'))),
   'categories',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.type) FROM category_totals c),'[]'::jsonb),
   'directoryAvailability',CASE WHEN directory_allowed THEN 'available' ELSE 'unavailable' END,
   'buildings',CASE WHEN directory_allowed THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
     'id',b.id,'name',b.name,'code',b.code,'organization_name',b.organization_name,
     'devices',coalesce(d.devices,0),'devices_online',coalesce(d.devices_online,0),
     'gateways',coalesce(g.gateways,0),'gateways_online',coalesce(g.gateways_online,0),
     'open_alerts',coalesce(a.open_alerts,0),'critical_alerts',coalesce(a.critical_alerts,0),
     'categories',coalesce((SELECT jsonb_agg(jsonb_build_object('type',c.type,'devices',c.devices,'devices_online',c.devices_online) ORDER BY c.type)
       FROM building_category_totals c WHERE c.building_id=b.id),'[]'::jsonb)) ORDER BY coalesce(a.open_alerts,0) DESC,b.name,b.id)
     FROM active_buildings b LEFT JOIN device_totals d ON d.building_id=b.id
     LEFT JOIN gateway_totals g ON g.building_id=b.id LEFT JOIN alert_totals a ON a.building_id=b.id),'[]'::jsonb) ELSE NULL END
 ) INTO result;
 RETURN result;
END $$;

-- This local entrypoint deliberately excludes global directory authority.
-- Basic local discovery and each operational scope are evaluated independently.
CREATE OR REPLACE FUNCTION app_overview_building_scope(target_building_id text)
RETURNS TABLE(basic boolean,devices text,gateways text,alerts text,telemetry text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_rbac_tenant_active(target_building_id) AND (
   app_has_capability(target_building_id,'buildings:read') OR EXISTS (
     SELECT 1 FROM role_bindings rb WHERE rb.building_id=target_building_id AND rb.resource_type IS NOT NULL
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
       AND app_discovery_resource_belongs(target_building_id,rb.resource_type,rb.resource_id)
       AND app_has_capability(target_building_id,'buildings:read',rb.resource_type,rb.resource_id)
   )),
   CASE WHEN app_has_capability(target_building_id,'devices:read') THEN 'whole'
     WHEN app_equipment_can_read_scope(target_building_id,'device') THEN 'partial' ELSE 'none' END,
   CASE WHEN app_has_capability(target_building_id,'devices:read') THEN 'whole'
     WHEN app_equipment_can_read_scope(target_building_id,'gateway') THEN 'partial' ELSE 'none' END,
   CASE WHEN app_has_capability(target_building_id,'alerts:read') THEN 'whole'
     WHEN app_alert_can_read_feature_state(target_building_id) THEN 'partial' ELSE 'none' END,
   CASE WHEN app_has_capability(target_building_id,'telemetry:read') THEN 'whole'
     WHEN app_has_capability(target_building_id,'telemetry:read-published')
       OR EXISTS(SELECT 1 FROM app_telemetry_authorized_devices(target_building_id,'telemetry:read') scope
         JOIN devices d ON d.id=scope.device_id AND d.building_id=scope.building_id WHERE app_equipment_gateway_belongs(d.building_id,d.gateway_id))
       OR EXISTS(SELECT 1 FROM app_telemetry_authorized_devices(target_building_id,'telemetry:read-published') scope
         JOIN devices d ON d.id=scope.device_id AND d.building_id=scope.building_id WHERE app_equipment_gateway_belongs(d.building_id,d.gateway_id)) THEN 'partial' ELSE 'none' END;
$$;

DO $$ DECLARE helper_owner text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER FUNCTION app_overview_platform_health() OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_overview_building_scope(text) OWNER TO %I',helper_owner);
END $$;
REVOKE ALL ON FUNCTION app_overview_platform_health(),app_overview_building_scope(text)
 FROM PUBLIC,predioon_app,predioon_identity,predioon_broker_auth;
GRANT EXECUTE ON FUNCTION app_overview_platform_health(),app_overview_building_scope(text) TO predioon_app;
