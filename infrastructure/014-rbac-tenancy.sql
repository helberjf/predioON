-- Additive RBAC/tenancy foundation.
--
-- The existing membership_role and HTTP routes remain valid. New authorization
-- uses explicit role -> permission rows and tenant/resource scoped bindings.
-- No role ordinal is consulted by these policies.

CREATE TABLE IF NOT EXISTS blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blocks_building_code_uq UNIQUE (building_id, code),
  CONSTRAINT blocks_id_building_uq UNIQUE (id, building_id)
);
CREATE INDEX IF NOT EXISTS blocks_building_idx ON blocks(building_id);

CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  block_id uuid,
  code text NOT NULL,
  floor integer,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT units_building_code_uq UNIQUE (building_id, code),
  CONSTRAINT units_id_building_uq UNIQUE (id, building_id),
  CONSTRAINT units_floor_ck CHECK (floor IS NULL OR floor BETWEEN -10 AND 300),
  CONSTRAINT units_block_building_fk FOREIGN KEY (block_id, building_id) REFERENCES blocks(id, building_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS units_building_idx ON units(building_id);

CREATE TABLE IF NOT EXISTS unit_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'OCCUPANT' CHECK (kind IN ('OWNER', 'OCCUPANT', 'DEPENDENT')),
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_memberships_id_building_uq UNIQUE (id, building_id),
  CONSTRAINT unit_memberships_unit_building_fk FOREIGN KEY (unit_id, building_id) REFERENCES units(id, building_id) ON DELETE CASCADE,
  CONSTRAINT unit_memberships_dates_ck CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS unit_memberships_building_idx ON unit_memberships(building_id);
CREATE INDEX IF NOT EXISTS unit_memberships_user_idx ON unit_memberships(user_id);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'MAINTENANCE',
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_id_building_uq UNIQUE (id, building_id)
);
CREATE INDEX IF NOT EXISTS teams_building_idx ON teams(building_id);

CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_members_id_building_uq UNIQUE (id, building_id),
  CONSTRAINT team_members_team_building_fk FOREIGN KEY (team_id, building_id) REFERENCES teams(id, building_id) ON DELETE CASCADE,
  CONSTRAINT team_members_team_user_uq UNIQUE (team_id, user_id),
  CONSTRAINT team_members_dates_ck CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS team_members_building_idx ON team_members(building_id);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members(user_id);

CREATE TABLE IF NOT EXISTS roles (
  key text PRIMARY KEY,
  scope text NOT NULL DEFAULT 'BUILDING' CHECK (scope IN ('PLATFORM', 'BUILDING', 'RESOURCE')),
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  system boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
  key text PRIMARY KEY,
  resource_type text NOT NULL,
  action text NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_resource_action_uq UNIQUE (resource_type, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_key text NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE IF NOT EXISTS role_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text REFERENCES buildings(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid,
  role_key text NOT NULL REFERENCES roles(key) ON DELETE RESTRICT,
  resource_type text,
  resource_id text,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  granted_by text REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_bindings_subject_ck CHECK (((user_id IS NOT NULL)::integer + (team_id IS NOT NULL)::integer) = 1),
  CONSTRAINT role_bindings_team_scope_ck CHECK (team_id IS NULL OR building_id IS NOT NULL),
  CONSTRAINT role_bindings_resource_ck CHECK ((resource_type IS NULL) = (resource_id IS NULL)),
  CONSTRAINT role_bindings_dates_ck CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT role_bindings_team_building_fk FOREIGN KEY (team_id, building_id) REFERENCES teams(id, building_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS role_bindings_building_idx ON role_bindings(building_id);
CREATE INDEX IF NOT EXISTS role_bindings_user_idx ON role_bindings(user_id);
CREATE INDEX IF NOT EXISTS role_bindings_team_idx ON role_bindings(team_id);

CREATE TABLE IF NOT EXISTS support_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  support_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability text NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  resource_type text,
  resource_id text,
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  granted_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_grants_resource_ck CHECK ((resource_type IS NULL) = (resource_id IS NULL))
);
CREATE INDEX IF NOT EXISTS support_grants_user_building_idx ON support_grants(support_user_id, building_id);

INSERT INTO roles (key, scope, label, description) VALUES
  ('PLATFORM_ADMIN', 'PLATFORM', 'Administrador da plataforma', 'Administração global explicitamente concedida'),
  ('PLATFORM_SUPPORT', 'PLATFORM', 'Suporte da plataforma', 'Acesso somente durante concessão temporária'),
  ('BUILDING_ADMIN', 'BUILDING', 'Síndico', 'Gestão do condomínio concedido'),
  ('MAINTENANCE_MANAGER', 'BUILDING', 'Gestor de manutenção', 'Distribui e supervisiona ordens concedidas'),
  ('MAINTENANCE', 'BUILDING', 'Manutenção', 'Executa ordens e lê a operação necessária'),
  ('RESIDENT', 'BUILDING', 'Morador', 'Acesso às próprias solicitações e informações publicadas')
ON CONFLICT (key) DO UPDATE SET scope = EXCLUDED.scope, label = EXCLUDED.label, description = EXCLUDED.description;

INSERT INTO permissions (key, resource_type, action, label) VALUES
  ('notices:read', 'notice', 'read', 'Ler avisos'),
  ('notices:manage', 'notice', 'manage', 'Gerenciar avisos'),
  ('occurrences:create-own', 'occurrence', 'create-own', 'Abrir solicitação'),
  ('occurrences:read-own', 'occurrence', 'read-own', 'Ler solicitação própria'),
  ('occurrences:manage', 'occurrence', 'manage', 'Gerenciar solicitações'),
  ('telemetry:read', 'telemetry', 'read', 'Ler telemetria'),
  ('alerts:read', 'alert', 'read', 'Ler alertas'),
  ('alerts:acknowledge', 'alert', 'acknowledge', 'Reconhecer alertas'),
  ('work-orders:read-assigned', 'work_order', 'read-assigned', 'Ler ordens atribuídas'),
  ('work-orders:assign', 'work_order', 'assign', 'Distribuir ordens'),
  ('work-orders:update-assigned', 'work_order', 'update-assigned', 'Atualizar ordem atribuída'),
  ('devices:read', 'device', 'read', 'Ler equipamentos'),
  ('devices:configure', 'device', 'configure', 'Configurar equipamentos'),
  ('commands:request', 'command', 'request', 'Solicitar comando homologado'),
  ('automations:read', 'automation', 'read', 'Ler automações'),
  ('automations:manage', 'automation', 'manage', 'Gerenciar automações'),
  ('finance:read', 'finance', 'read', 'Ler contas publicadas'),
  ('memberships:read', 'membership', 'read', 'Ler vínculos'),
  ('memberships:manage', 'membership', 'manage', 'Gerenciar vínculos'),
  ('units:read', 'unit', 'read', 'Ler unidades'),
  ('units:manage', 'unit', 'manage', 'Gerenciar unidades'),
  ('teams:read', 'team', 'read', 'Ler equipes'),
  ('teams:manage', 'team', 'manage', 'Gerenciar equipes'),
  ('support:read', 'support_grant', 'read', 'Ler atendimentos autorizados'),
  ('support:grant', 'support_grant', 'grant', 'Conceder suporte temporário'),
  ('plans:read', 'plan', 'read', 'Ler planos'),
  ('plans:manage', 'plan', 'manage', 'Gerenciar planos'),
  ('rbac:manage', 'rbac', 'manage', 'Gerenciar autorização')
ON CONFLICT (key) DO UPDATE SET resource_type = EXCLUDED.resource_type, action = EXCLUDED.action, label = EXCLUDED.label;

INSERT INTO role_permissions (role_key, permission_key)
SELECT v.role_key, v.permission_key
FROM (VALUES
  ('PLATFORM_ADMIN','plans:read'), ('PLATFORM_ADMIN','plans:manage'), ('PLATFORM_ADMIN','rbac:manage'), ('PLATFORM_ADMIN','support:grant'),
  ('BUILDING_ADMIN','notices:read'), ('BUILDING_ADMIN','notices:manage'), ('BUILDING_ADMIN','occurrences:create-own'), ('BUILDING_ADMIN','occurrences:read-own'), ('BUILDING_ADMIN','occurrences:manage'), ('BUILDING_ADMIN','telemetry:read'), ('BUILDING_ADMIN','alerts:read'), ('BUILDING_ADMIN','alerts:acknowledge'), ('BUILDING_ADMIN','work-orders:read-assigned'), ('BUILDING_ADMIN','work-orders:assign'), ('BUILDING_ADMIN','work-orders:update-assigned'), ('BUILDING_ADMIN','devices:read'), ('BUILDING_ADMIN','devices:configure'), ('BUILDING_ADMIN','commands:request'), ('BUILDING_ADMIN','automations:read'), ('BUILDING_ADMIN','automations:manage'), ('BUILDING_ADMIN','finance:read'), ('BUILDING_ADMIN','memberships:read'), ('BUILDING_ADMIN','memberships:manage'), ('BUILDING_ADMIN','units:read'), ('BUILDING_ADMIN','units:manage'), ('BUILDING_ADMIN','teams:read'), ('BUILDING_ADMIN','teams:manage'), ('BUILDING_ADMIN','support:read'),
  ('MAINTENANCE_MANAGER','notices:read'), ('MAINTENANCE_MANAGER','occurrences:create-own'), ('MAINTENANCE_MANAGER','occurrences:read-own'), ('MAINTENANCE_MANAGER','occurrences:manage'), ('MAINTENANCE_MANAGER','telemetry:read'), ('MAINTENANCE_MANAGER','alerts:read'), ('MAINTENANCE_MANAGER','alerts:acknowledge'), ('MAINTENANCE_MANAGER','work-orders:read-assigned'), ('MAINTENANCE_MANAGER','work-orders:assign'), ('MAINTENANCE_MANAGER','work-orders:update-assigned'), ('MAINTENANCE_MANAGER','devices:read'), ('MAINTENANCE_MANAGER','automations:read'), ('MAINTENANCE_MANAGER','teams:read'), ('MAINTENANCE_MANAGER','units:read'),
  ('MAINTENANCE','notices:read'), ('MAINTENANCE','occurrences:create-own'), ('MAINTENANCE','occurrences:read-own'), ('MAINTENANCE','telemetry:read'), ('MAINTENANCE','alerts:read'), ('MAINTENANCE','alerts:acknowledge'), ('MAINTENANCE','work-orders:read-assigned'), ('MAINTENANCE','work-orders:update-assigned'), ('MAINTENANCE','devices:read'), ('MAINTENANCE','automations:read'), ('MAINTENANCE','units:read'),
  ('RESIDENT','notices:read'), ('RESIDENT','occurrences:create-own'), ('RESIDENT','occurrences:read-own'), ('RESIDENT','units:read')
) AS v(role_key, permission_key)
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- Repair only the earlier draft's generated grants. Authorization is evaluated
-- against live legacy memberships, so revocation never leaves a durable clone.
DELETE FROM role_bindings
WHERE granted_by IS NULL AND team_id IS NULL AND resource_type IS NULL
  AND ((reason = 'Backfill da associação de compatibilidade' AND role_key IN ('RESIDENT', 'BUILDING_ADMIN'))
    OR (reason = 'Backfill do administrador global legado' AND role_key = 'PLATFORM_ADMIN'));
DELETE FROM role_permissions WHERE role_key = 'PLATFORM_SUPPORT'
  OR (role_key = 'PLATFORM_ADMIN' AND permission_key NOT IN ('plans:read','plans:manage','rbac:manage','support:grant'));

ALTER TABLE units DROP CONSTRAINT IF EXISTS units_block_building_fk;
ALTER TABLE units ADD CONSTRAINT units_block_building_fk
  FOREIGN KEY (block_id, building_id) REFERENCES blocks(id, building_id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION app_rbac_scope_valid(resource_type text, resource_id text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT (resource_type IS NULL AND resource_id IS NULL) OR
    (resource_type IS NOT NULL AND resource_id IS NOT NULL AND btrim(resource_id) <> '' AND
      resource_type IN ('building','block','unit','team','membership','device','gateway','alert','work_order','automation','finance','support_grant','notice','occurrence','telemetry'));
$$;
CREATE OR REPLACE FUNCTION app_rbac_window(active boolean, starts_at timestamptz, ends_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(active, false)
    AND (starts_at IS NULL OR (isfinite(starts_at) AND starts_at <= now()))
    AND (ends_at IS NULL OR (isfinite(ends_at) AND ends_at > now()))
    AND (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);
$$;
ALTER TABLE role_bindings DROP CONSTRAINT IF EXISTS role_bindings_scope_ck;
ALTER TABLE role_bindings ADD CONSTRAINT role_bindings_scope_ck CHECK (
  ((resource_type IS NULL AND resource_id IS NULL) OR
    (resource_type IS NOT NULL AND resource_id IS NOT NULL AND btrim(resource_id) <> '' AND
      resource_type IN ('building','block','unit','team','membership','device','gateway','alert','work_order','automation','finance','support_grant','notice','occurrence','telemetry')))
  AND ((role_key IN ('PLATFORM_ADMIN','PLATFORM_SUPPORT') AND building_id IS NULL AND team_id IS NULL AND resource_type IS NULL)
    OR (role_key NOT IN ('PLATFORM_ADMIN','PLATFORM_SUPPORT') AND building_id IS NOT NULL))
);
ALTER TABLE support_grants DROP CONSTRAINT IF EXISTS support_grants_valid_ck;
ALTER TABLE support_grants ADD CONSTRAINT support_grants_valid_ck CHECK (
  ((resource_type IS NULL AND resource_id IS NULL) OR
    (resource_type IS NOT NULL AND resource_id IS NOT NULL AND btrim(resource_id) <> '' AND
      resource_type IN ('building','block','unit','team','membership','device','gateway','alert','work_order','automation','finance','support_grant','notice','occurrence','telemetry')))
  AND btrim(reason) <> ''
  AND isfinite(expires_at) AND expires_at > created_at AND support_user_id <> granted_by
  AND capability IN ('telemetry:read','alerts:read','devices:read','work-orders:read-assigned','support:read')
);

-- These helpers deliberately ignore app.role. Only trusted database facts and
-- the transaction's authenticated app.user_id establish authorization.
CREATE OR REPLACE FUNCTION app_rbac_tenant_active(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM buildings b JOIN organizations o ON o.id=b.organization_id AND o.active
    JOIN users u ON u.id=app_current_user_id() AND u.active
    WHERE b.id=target_building_id AND b.active
  );
$$;
CREATE OR REPLACE FUNCTION app_rbac_platform_role(target_user_id text, target_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u JOIN roles r ON r.key=target_role AND r.scope='PLATFORM' AND r.active
    WHERE u.id=target_user_id AND u.active AND (
      (target_role='PLATFORM_ADMIN' AND u.is_platform_admin)
      OR EXISTS (SELECT 1 FROM role_bindings rb WHERE rb.user_id=u.id AND rb.role_key=r.key
        AND rb.building_id IS NULL AND rb.team_id IS NULL AND rb.resource_type IS NULL
        AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at))
    )
  );
$$;
CREATE OR REPLACE FUNCTION app_has_global_capability(target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT target_capability IN ('plans:read','plans:manage','rbac:manage','support:grant')
    AND app_rbac_platform_role(app_current_user_id(),'PLATFORM_ADMIN')
    AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.key=rp.permission_key AND p.active
      WHERE rp.role_key='PLATFORM_ADMIN' AND p.key=target_capability);
$$;
CREATE OR REPLACE FUNCTION app_rbac_team_member(target_building_id text, target_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_rbac_tenant_active(target_building_id) AND EXISTS (
    SELECT 1 FROM teams t JOIN team_members tm ON tm.team_id=t.id AND tm.building_id=t.building_id
    WHERE t.id=target_team_id AND t.building_id=target_building_id AND t.active
      AND tm.user_id=app_current_user_id() AND app_rbac_window(tm.active,tm.starts_at,tm.ends_at)
  );
$$;
CREATE OR REPLACE FUNCTION app_has_capability(
  target_building_id text, target_capability text,
  target_resource_type text DEFAULT NULL, target_resource_id text DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_rbac_tenant_active(target_building_id)
    AND app_rbac_scope_valid(target_resource_type,target_resource_id)
    AND EXISTS (SELECT 1 FROM permissions p WHERE p.key=target_capability AND p.active)
    AND (
      EXISTS (
        SELECT 1 FROM role_bindings rb
        JOIN roles r ON r.key=rb.role_key AND r.active AND r.scope IN ('BUILDING','RESOURCE')
        JOIN role_permissions rp ON rp.role_key=r.key AND rp.permission_key=target_capability
        WHERE rb.building_id=target_building_id AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
          AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
          AND (rb.resource_type IS NULL OR (rb.resource_type=target_resource_type AND rb.resource_id=target_resource_id))
      )
      OR EXISTS (
        SELECT 1 FROM memberships m
        JOIN roles r ON r.key=m.role::text AND r.active AND r.scope='BUILDING'
        JOIN role_permissions rp ON rp.role_key=r.key AND rp.permission_key=target_capability
        WHERE m.user_id=app_current_user_id() AND m.building_id=target_building_id
          AND app_rbac_window(m.active,m.starts_at,m.ends_at)
      )
      OR (
        app_rbac_platform_role(app_current_user_id(),'PLATFORM_SUPPORT')
        AND target_capability IN ('telemetry:read','alerts:read','devices:read','work-orders:read-assigned','support:read')
        AND EXISTS (
          SELECT 1 FROM support_grants sg WHERE sg.support_user_id=app_current_user_id()
            AND sg.building_id=target_building_id AND sg.capability=target_capability
            AND sg.revoked_at IS NULL AND sg.created_at <= now() AND sg.expires_at > now() AND isfinite(sg.expires_at)
            AND btrim(sg.reason) <> '' AND sg.support_user_id <> sg.granted_by
            AND (sg.resource_type IS NULL OR (sg.resource_type=target_resource_type AND sg.resource_id=target_resource_id))
        )
      )
    );
$$;
CREATE OR REPLACE FUNCTION app_rbac_own_unit(target_building_id text, target_unit_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_rbac_tenant_active(target_building_id) AND EXISTS (
    SELECT 1 FROM unit_memberships um JOIN units un ON un.id=um.unit_id AND un.building_id=um.building_id AND un.active
    LEFT JOIN blocks bl ON bl.id=un.block_id AND bl.building_id=un.building_id
    WHERE um.building_id=target_building_id AND um.unit_id=target_unit_id AND um.user_id=app_current_user_id()
      AND app_rbac_window(um.active,um.starts_at,um.ends_at) AND (un.block_id IS NULL OR bl.active)
  );
$$;
CREATE OR REPLACE FUNCTION app_rbac_can_delegate(
  target_building_id text, target_role text, target_resource_type text, target_resource_id text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_rbac_scope_valid(target_resource_type,target_resource_id) AND EXISTS (
    SELECT 1 FROM roles r WHERE r.key=target_role AND r.active AND (
      (r.scope='PLATFORM' AND target_building_id IS NULL AND target_resource_type IS NULL AND app_has_global_capability('rbac:manage'))
      OR (r.scope='BUILDING' AND target_role IN ('BUILDING_ADMIN','MAINTENANCE_MANAGER','MAINTENANCE','RESIDENT')
        AND app_has_capability(target_building_id,'memberships:manage')
        AND NOT EXISTS (
          SELECT 1 FROM role_permissions rp WHERE rp.role_key=r.key
            AND NOT app_has_capability(target_building_id,rp.permission_key,target_resource_type,target_resource_id)
        ))
    )
  );
$$;

-- Default deny on all new tables. Own data requires current, live access.
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blocks_read ON blocks;
CREATE POLICY blocks_read ON blocks FOR SELECT USING (
  app_has_capability(building_id,'units:manage')
  OR (active AND EXISTS (SELECT 1 FROM units un WHERE un.block_id=blocks.id AND un.building_id=blocks.building_id AND app_rbac_own_unit(un.building_id,un.id)))
);
DROP POLICY IF EXISTS blocks_write ON blocks;
CREATE POLICY blocks_write ON blocks FOR ALL USING (app_has_capability(building_id,'units:manage')) WITH CHECK (app_has_capability(building_id,'units:manage'));
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS units_read ON units;
CREATE POLICY units_read ON units FOR SELECT USING (app_has_capability(building_id,'units:manage') OR app_rbac_own_unit(building_id,id));
DROP POLICY IF EXISTS units_write ON units;
CREATE POLICY units_write ON units FOR ALL USING (app_has_capability(building_id,'units:manage')) WITH CHECK (app_has_capability(building_id,'units:manage'));
ALTER TABLE unit_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unit_memberships_read ON unit_memberships;
CREATE POLICY unit_memberships_read ON unit_memberships FOR SELECT USING (
  app_has_capability(building_id,'memberships:read')
  OR (user_id=app_current_user_id() AND app_rbac_window(active,starts_at,ends_at) AND app_rbac_own_unit(building_id,unit_id))
);
DROP POLICY IF EXISTS unit_memberships_write ON unit_memberships;
CREATE POLICY unit_memberships_write ON unit_memberships FOR ALL USING (app_has_capability(building_id,'memberships:manage')) WITH CHECK (app_has_capability(building_id,'memberships:manage'));
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teams_read ON teams;
CREATE POLICY teams_read ON teams FOR SELECT USING (app_has_capability(building_id,'teams:read') OR app_rbac_team_member(building_id,id));
DROP POLICY IF EXISTS teams_write ON teams;
CREATE POLICY teams_write ON teams FOR ALL USING (app_has_capability(building_id,'teams:manage')) WITH CHECK (app_has_capability(building_id,'teams:manage'));
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_members_read ON team_members;
CREATE POLICY team_members_read ON team_members FOR SELECT USING (
  app_has_capability(building_id,'teams:read')
  OR (user_id=app_current_user_id() AND app_rbac_window(active,starts_at,ends_at) AND app_rbac_team_member(building_id,team_id))
);
DROP POLICY IF EXISTS team_members_write ON team_members;
CREATE POLICY team_members_write ON team_members FOR ALL USING (app_has_capability(building_id,'teams:manage')) WITH CHECK (app_has_capability(building_id,'teams:manage'));

-- Catalogue changes are migrations, never runtime operations.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_read ON roles;
CREATE POLICY roles_read ON roles FOR SELECT USING (true);
DROP POLICY IF EXISTS roles_write ON roles;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permissions_read ON permissions;
CREATE POLICY permissions_read ON permissions FOR SELECT USING (true);
DROP POLICY IF EXISTS permissions_write ON permissions;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_permissions_read ON role_permissions;
CREATE POLICY role_permissions_read ON role_permissions FOR SELECT USING (true);
DROP POLICY IF EXISTS role_permissions_write ON role_permissions;
REVOKE ALL ON roles, permissions, role_permissions FROM predioon_app;
GRANT SELECT ON roles, permissions, role_permissions TO predioon_app;

ALTER TABLE role_bindings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_bindings_read ON role_bindings;
CREATE POLICY role_bindings_read ON role_bindings FOR SELECT USING (
  (building_id IS NULL AND (app_has_global_capability('rbac:manage')
    OR (user_id=app_current_user_id() AND app_rbac_window(active,starts_at,ends_at) AND app_rbac_platform_role(user_id,role_key))))
  OR (app_rbac_tenant_active(building_id) AND (
    app_has_capability(building_id,'memberships:manage')
    OR (app_rbac_window(active,starts_at,ends_at) AND (user_id=app_current_user_id() OR app_rbac_team_member(building_id,team_id)))
  ))
);
DROP POLICY IF EXISTS role_bindings_write ON role_bindings;
CREATE POLICY role_bindings_write ON role_bindings FOR ALL
USING (app_rbac_can_delegate(building_id,role_key,resource_type,resource_id))
WITH CHECK (app_rbac_can_delegate(building_id,role_key,resource_type,resource_id));
ALTER TABLE support_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_grants_read ON support_grants;
CREATE POLICY support_grants_read ON support_grants FOR SELECT USING (
  app_rbac_tenant_active(building_id) AND (
    app_has_global_capability('support:grant') OR app_has_capability(building_id,'support:read')
    OR (support_user_id=app_current_user_id() AND revoked_at IS NULL AND expires_at>now() AND app_rbac_platform_role(support_user_id,'PLATFORM_SUPPORT'))
  )
);
DROP POLICY IF EXISTS support_grants_write ON support_grants;
CREATE POLICY support_grants_write ON support_grants FOR ALL
USING (app_rbac_tenant_active(building_id) AND app_has_global_capability('support:grant') AND support_user_id<>app_current_user_id())
WITH CHECK (
  app_rbac_tenant_active(building_id) AND app_has_global_capability('support:grant')
  AND granted_by=app_current_user_id() AND support_user_id<>app_current_user_id()
  AND app_rbac_platform_role(support_user_id,'PLATFORM_SUPPORT') AND expires_at>now() AND created_at<=now()
);

-- Extend audit insertion for the new capability routes; retain append-only
-- privileges and the real authenticated actor. Legacy workload policies stay.
DROP POLICY IF EXISTS audit_logs_insert_policy ON audit_logs;
CREATE POLICY audit_logs_insert_policy ON audit_logs FOR INSERT WITH CHECK (
  user_id=app_current_user_id() AND actor_type='USER' AND (
    app_is_platform_admin() OR (building_id IS NOT NULL AND (
      app_can_access_building(building_id) OR app_has_capability(building_id,'units:manage')
      OR app_has_capability(building_id,'teams:manage') OR app_has_capability(building_id,'memberships:manage')
    ))
  )
);
REVOKE UPDATE, DELETE ON audit_logs FROM predioon_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON blocks, units, unit_memberships, teams, team_members, role_bindings, support_grants TO predioon_app;

REVOKE ALL ON FUNCTION app_rbac_scope_valid(text,text), app_rbac_window(boolean,timestamptz,timestamptz),
  app_rbac_tenant_active(text), app_rbac_platform_role(text,text), app_rbac_team_member(text,uuid),
  app_rbac_own_unit(text,uuid), app_rbac_can_delegate(text,text,text,text),
  app_has_capability(text,text,text,text), app_has_global_capability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_rbac_scope_valid(text,text), app_rbac_window(boolean,timestamptz,timestamptz),
  app_rbac_tenant_active(text), app_rbac_platform_role(text,text), app_rbac_team_member(text,uuid),
  app_rbac_own_unit(text,uuid), app_rbac_can_delegate(text,text,text,text),
  app_has_capability(text,text,text,text), app_has_global_capability(text) TO predioon_app;
