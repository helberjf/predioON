-- Apply this additive correction with the controlled runner in one transaction.
-- Resource existence permits only basic building/feature discovery; authorization
-- and operational capabilities continue to use the existing live RBAC helpers.
CREATE OR REPLACE FUNCTION app_discovery_resource_belongs(
  target_building_id text, target_resource_type text, target_resource_id text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE resource_uuid uuid;
BEGIN
  IF target_resource_type IS NULL AND target_resource_id IS NULL THEN RETURN true; END IF;
  IF target_resource_type IS NULL OR target_resource_id IS NULL OR btrim(target_resource_id) = '' THEN RETURN false; END IF;

  -- Text primary keys remain text: no normalization or cross-tenant fallback.
  CASE target_resource_type
    WHEN 'building' THEN
      RETURN EXISTS (SELECT 1 FROM buildings b WHERE b.id=target_resource_id AND b.id=target_building_id);
    WHEN 'device' THEN
      RETURN EXISTS (SELECT 1 FROM devices d WHERE d.id=target_resource_id AND d.building_id=target_building_id);
    WHEN 'gateway' THEN
      RETURN EXISTS (SELECT 1 FROM gateways g WHERE g.id=target_resource_id AND g.building_id=target_building_id);
    ELSE
      -- work_order/automation have no concrete entity, and telemetry has no
      -- globally unique id. Fail closed without reading time-series history.
      IF target_resource_type NOT IN ('block','unit','team','membership','alert','finance','notice','occurrence','support_grant') THEN RETURN false; END IF;
  END CASE;

  -- Invalid UUID input is a denied scope, never a runtime 22P02 exception.
  BEGIN
    resource_uuid := target_resource_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false;
  END;
  CASE target_resource_type
    WHEN 'block' THEN
      RETURN EXISTS (SELECT 1 FROM blocks b WHERE b.id=resource_uuid AND b.building_id=target_building_id);
    WHEN 'unit' THEN
      RETURN EXISTS (SELECT 1 FROM units u WHERE u.id=resource_uuid AND u.building_id=target_building_id);
    WHEN 'team' THEN
      RETURN EXISTS (SELECT 1 FROM teams t WHERE t.id=resource_uuid AND t.building_id=target_building_id);
    WHEN 'membership' THEN
      RETURN EXISTS (SELECT 1 FROM memberships m WHERE m.id=resource_uuid AND m.building_id=target_building_id)
        OR EXISTS (SELECT 1 FROM unit_memberships m WHERE m.id=resource_uuid AND m.building_id=target_building_id);
    WHEN 'alert' THEN
      RETURN EXISTS (SELECT 1 FROM alerts a WHERE a.id=resource_uuid AND a.building_id=target_building_id);
    WHEN 'finance' THEN
      RETURN EXISTS (SELECT 1 FROM financial_reports f WHERE f.id=resource_uuid AND f.building_id=target_building_id);
    WHEN 'notice' THEN
      RETURN EXISTS (SELECT 1 FROM notices n WHERE n.id=resource_uuid AND n.building_id=target_building_id);
    WHEN 'occurrence' THEN
      RETURN EXISTS (SELECT 1 FROM occurrences o WHERE o.id=resource_uuid AND o.building_id=target_building_id);
    WHEN 'support_grant' THEN
      RETURN EXISTS (SELECT 1 FROM support_grants s WHERE s.id=resource_uuid AND s.building_id=target_building_id);
    ELSE RETURN false;
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION app_can_discover_building(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_has_global_capability('buildings:read') OR (
    app_rbac_tenant_active(target_building_id) AND (
      app_has_capability(target_building_id,'buildings:read')
      OR EXISTS (SELECT 1 FROM role_bindings rb
        WHERE rb.building_id=target_building_id AND rb.resource_type IS NOT NULL
          AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
          AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
          AND app_discovery_resource_belongs(target_building_id,rb.resource_type,rb.resource_id)
          AND app_has_capability(target_building_id,'buildings:read',rb.resource_type,rb.resource_id))
      OR EXISTS (SELECT 1 FROM support_grants sg
        WHERE sg.building_id=target_building_id AND sg.support_user_id=app_current_user_id()
          AND app_discovery_resource_belongs(target_building_id,sg.resource_type,sg.resource_id)
          AND app_has_capability(target_building_id,sg.capability,sg.resource_type,sg.resource_id))
    )
  );
$$;

DO $$ DECLARE helper_owner text; BEGIN
  SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
  FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
  EXECUTE format('ALTER FUNCTION app_discovery_resource_belongs(text,text,text) OWNER TO %I',helper_owner);
  EXECUTE format('ALTER FUNCTION app_can_discover_building(text) OWNER TO %I',helper_owner);
END $$;

-- This helper must never expose a resource-existence oracle to runtime roles.
-- Explicitly revoke service grants and any grants inherited from default ACLs.
REVOKE ALL ON FUNCTION app_discovery_resource_belongs(text,text,text)
  FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth;
DO $$ DECLARE grantee_name text; BEGIN
  FOR grantee_name IN
    SELECT DISTINCT r.rolname FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee
    WHERE p.oid='app_discovery_resource_belongs(text,text,text)'::regprocedure AND acl.grantee<>p.proowner
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION app_discovery_resource_belongs(text,text,text) FROM %I',grantee_name);
  END LOOP;
END $$;
