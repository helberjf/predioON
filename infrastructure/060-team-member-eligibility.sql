-- Team candidates must not have a current resident link in this condominium.
-- Keep classification behind the same narrow management scope as the directory:
-- teams:manage alone must work without exposing raw membership/account rows.
CREATE OR REPLACE FUNCTION app_tenancy_is_resident(target_building_id text, target_user_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT coalesce(app_has_capability(target_building_id, 'memberships:manage') OR
    app_has_capability(target_building_id, 'teams:manage'), false) THEN
    RAISE EXCEPTION 'Tenant directory outside the current scope' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM memberships m JOIN roles r ON r.key = m.role::text AND r.active
    WHERE m.building_id = target_building_id AND m.user_id = target_user_id AND m.role = 'RESIDENT'
      AND app_rbac_window(m.active, m.starts_at, m.ends_at)
  ) OR EXISTS (
    SELECT 1 FROM unit_memberships um
    JOIN units un ON un.id = um.unit_id AND un.building_id = um.building_id AND un.active
    LEFT JOIN blocks bl ON bl.id = un.block_id AND bl.building_id = un.building_id
    WHERE um.building_id = target_building_id AND um.user_id = target_user_id
      AND app_rbac_window(um.active, um.starts_at, um.ends_at) AND (un.block_id IS NULL OR bl.active)
  ) OR EXISTS (
    SELECT 1 FROM role_bindings rb JOIN roles r ON r.key = rb.role_key AND r.active
    WHERE rb.building_id = target_building_id AND rb.role_key = 'RESIDENT'
      AND app_rbac_window(rb.active, rb.starts_at, rb.ends_at)
      AND app_discovery_resource_belongs(rb.building_id, rb.resource_type, rb.resource_id)
      AND (rb.user_id = target_user_id OR EXISTS (
        SELECT 1 FROM team_members tm
        JOIN teams t ON t.id = tm.team_id AND t.building_id = tm.building_id AND t.active
        WHERE tm.building_id = target_building_id AND tm.team_id = rb.team_id AND tm.user_id = target_user_id
          AND app_rbac_window(tm.active, tm.starts_at, tm.ends_at)
      ))
  );
END $$;

-- Explicit fourth argument avoids ambiguity with the existing three-argument
-- function. Apply the filter before LIMIT so residents never consume a page.
CREATE OR REPLACE FUNCTION app_tenancy_people(
  target_building_id text, after_user_id text, requested_limit integer, exclude_residents boolean
)
RETURNS TABLE(id text, name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT coalesce(app_has_capability(target_building_id, 'memberships:manage') OR
    app_has_capability(target_building_id, 'teams:manage'), false) THEN
    RAISE EXCEPTION 'Tenant directory outside the current scope' USING ERRCODE = '42501';
  END IF;
  IF requested_limit IS NULL OR requested_limit < 1 OR requested_limit > 100 OR exclude_residents IS NULL
    OR (after_user_id IS NOT NULL AND (length(after_user_id) = 0 OR length(after_user_id) > 128)) THEN
    RAISE EXCEPTION 'Invalid directory pagination' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH linked_users AS (
    SELECT m.user_id FROM memberships m
    JOIN roles r ON r.key = m.role::text AND r.active AND r.scope = 'BUILDING'
    WHERE m.building_id = target_building_id AND app_rbac_window(m.active, m.starts_at, m.ends_at)
    UNION
    SELECT rb.user_id FROM role_bindings rb
    JOIN roles r ON r.key = rb.role_key AND r.active AND r.scope IN ('BUILDING', 'RESOURCE')
    WHERE rb.building_id = target_building_id AND rb.user_id IS NOT NULL
      AND app_rbac_window(rb.active, rb.starts_at, rb.ends_at)
      AND app_discovery_resource_belongs(rb.building_id, rb.resource_type, rb.resource_id)
    UNION
    SELECT tm.user_id FROM team_members tm
    JOIN teams t ON t.id = tm.team_id AND t.building_id = tm.building_id AND t.active
    WHERE tm.building_id = target_building_id AND app_rbac_window(tm.active, tm.starts_at, tm.ends_at)
    UNION
    SELECT um.user_id FROM unit_memberships um
    JOIN units un ON un.id = um.unit_id AND un.building_id = um.building_id AND un.active
    LEFT JOIN blocks bl ON bl.id = un.block_id AND bl.building_id = un.building_id
    WHERE um.building_id = target_building_id AND app_rbac_window(um.active, um.starts_at, um.ends_at)
      AND (un.block_id IS NULL OR bl.active)
  )
  SELECT u.id, u.name, u.email FROM users u JOIN linked_users linked ON linked.user_id = u.id
  WHERE u.active AND (after_user_id IS NULL OR u.id > after_user_id)
    AND (NOT exclude_residents OR NOT app_tenancy_is_resident(target_building_id, u.id))
  ORDER BY u.id LIMIT requested_limit + 1;
END $$;

-- Preserve the existing directory contract for residents and role management.
CREATE OR REPLACE FUNCTION app_tenancy_people(
  target_building_id text, after_user_id text DEFAULT NULL, requested_limit integer DEFAULT 50
)
RETURNS TABLE(id text, name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM app_tenancy_people(target_building_id, after_user_id, requested_limit, false);
$$;

DO $$ DECLARE helper_owner text; target regprocedure; BEGIN
  SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
    FROM pg_proc WHERE oid = 'app_has_capability(text,text,text,text)'::regprocedure;
  FOREACH target IN ARRAY ARRAY[
    'app_tenancy_is_resident(text,text)'::regprocedure,
    'app_tenancy_people(text,text,integer,boolean)'::regprocedure,
    'app_tenancy_people(text,text,integer)'::regprocedure
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', target, helper_owner);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth', target);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app', target);
  END LOOP;
END $$;
