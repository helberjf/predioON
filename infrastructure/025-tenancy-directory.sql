-- Minimal tenant directory for the new RBAC management flows. Do not broaden
-- users RLS or borrow the identity connection to implement a UI people picker.
-- Apply this additive migration transactionally with the controlled runner.
CREATE OR REPLACE FUNCTION app_tenancy_people(
  target_building_id text,
  after_user_id text DEFAULT NULL,
  requested_limit integer DEFAULT 50
)
RETURNS TABLE(id text, name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- The empty resource scope is deliberate. Authority over one unit/team does
  -- not permit enumerating the tenant's directory. Global admin is not a grant.
  IF NOT coalesce(
    app_has_capability(target_building_id, 'memberships:manage') OR
    app_has_capability(target_building_id, 'teams:manage'), false
  ) THEN
    RAISE EXCEPTION 'Tenant directory outside the current scope' USING ERRCODE = '42501';
  END IF;
  IF requested_limit IS NULL OR requested_limit < 1 OR requested_limit > 100
    OR (after_user_id IS NOT NULL AND (length(after_user_id) = 0 OR length(after_user_id) > 128)) THEN
    RAISE EXCEPTION 'Invalid directory pagination' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH linked_users AS (
    SELECT m.user_id
    FROM public.memberships m
    JOIN public.roles r ON r.key = m.role::text AND r.active AND r.scope = 'BUILDING'
    WHERE m.building_id = target_building_id
      AND app_rbac_window(m.active, m.starts_at, m.ends_at)
    UNION
    SELECT rb.user_id
    FROM public.role_bindings rb
    JOIN public.roles r ON r.key = rb.role_key AND r.active AND r.scope IN ('BUILDING', 'RESOURCE')
    WHERE rb.building_id = target_building_id AND rb.user_id IS NOT NULL
      AND app_rbac_window(rb.active, rb.starts_at, rb.ends_at)
      AND app_discovery_resource_belongs(rb.building_id, rb.resource_type, rb.resource_id)
    UNION
    -- Current team members belong to the tenant even before a role is assigned
    -- to their team. A team binding never keeps an expired member in this list.
    SELECT tm.user_id
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id AND t.building_id = tm.building_id AND t.active
    WHERE tm.building_id = target_building_id
      AND app_rbac_window(tm.active, tm.starts_at, tm.ends_at)
    UNION
    SELECT um.user_id
    FROM public.unit_memberships um
    JOIN public.units un ON un.id = um.unit_id AND un.building_id = um.building_id AND un.active
    LEFT JOIN public.blocks bl ON bl.id = un.block_id AND bl.building_id = un.building_id
    WHERE um.building_id = target_building_id
      AND app_rbac_window(um.active, um.starts_at, um.ends_at)
      AND (un.block_id IS NULL OR bl.active)
  )
  SELECT u.id, u.name, u.email
  FROM public.users u JOIN linked_users linked ON linked.user_id = u.id
  WHERE u.active AND (after_user_id IS NULL OR u.id > after_user_id)
  ORDER BY u.id
  -- One lookahead row allows a cursor without an unbounded count query. The
  -- HTTP response removes that row and never returns more than 100 people.
  LIMIT requested_limit + 1;
END $$;

DO $$ DECLARE helper_owner text; BEGIN
  SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
    FROM pg_proc WHERE oid = 'app_has_capability(text,text,text,text)'::regprocedure;
  EXECUTE format('ALTER FUNCTION app_tenancy_people(text,text,integer) OWNER TO %I', helper_owner);
END $$;
REVOKE ALL ON FUNCTION app_tenancy_people(text,text,integer)
  FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth;
GRANT EXECUTE ON FUNCTION app_tenancy_people(text,text,integer) TO predioon_app;
