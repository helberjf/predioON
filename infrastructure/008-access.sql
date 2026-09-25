-- Additive upgrade for installations with or without a preceding db:push.
CREATE TABLE IF NOT EXISTS gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  gateway_id text NOT NULL REFERENCES gateways(id) ON DELETE RESTRICT,
  device_id text NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  allow_residents boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gates_building_idx ON gates(building_id);
CREATE UNIQUE INDEX IF NOT EXISTS gates_device_uq ON gates(device_id);
CREATE TABLE IF NOT EXISTS gate_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  gate_id uuid NOT NULL REFERENCES gates(id) ON DELETE RESTRICT,
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  gateway_id text NOT NULL REFERENCES gateways(id) ON DELETE RESTRICT,
  device_id text NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  requested_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gate_commands_request_uq ON gate_commands(requested_by, request_id);
CREATE INDEX IF NOT EXISTS gate_commands_dispatch_idx ON gate_commands(status, created_at);
CREATE INDEX IF NOT EXISTS gate_commands_building_gate_idx ON gate_commands(building_id, gate_id, created_at);

-- Access decisions never trust the role embedded in a JWT.
CREATE OR REPLACE FUNCTION app_access_role(target_building_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN u.is_platform_admin THEN 'PLATFORM_ADMIN' ELSE m.role::text END
  FROM users u JOIN buildings b ON b.id = target_building_id AND b.active
  LEFT JOIN memberships m ON m.user_id = u.id AND m.building_id = b.id AND m.active
    AND (m.starts_at IS NULL OR m.starts_at <= now()) AND (m.ends_at IS NULL OR m.ends_at > now())
  WHERE u.id = app_current_user_id() AND u.active AND (u.is_platform_admin OR m.id IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION app_access_request_throttled(target_gate_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM gates g WHERE g.id = target_gate_id AND app_access_role(g.building_id) IS NOT NULL
    AND EXISTS (SELECT 1 FROM gate_commands c WHERE c.gate_id = g.id
      AND (c.created_at > now() - interval '5 seconds' OR (c.status IN ('PENDING', 'SENT') AND c.expires_at > now()))))
$$;

ALTER TABLE gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gates_read ON gates;
CREATE POLICY gates_read ON gates FOR SELECT USING (app_access_role(building_id) IS NOT NULL);
DROP POLICY IF EXISTS gates_manage ON gates;
CREATE POLICY gates_manage ON gates FOR ALL
USING (app_access_role(building_id) IN ('PLATFORM_ADMIN', 'BUILDING_ADMIN'))
WITH CHECK (app_access_role(building_id) IN ('PLATFORM_ADMIN', 'BUILDING_ADMIN'));
DROP POLICY IF EXISTS gate_commands_read ON gate_commands;
CREATE POLICY gate_commands_read ON gate_commands FOR SELECT USING (
  app_access_role(building_id) IS NOT NULL AND
  (requested_by = app_current_user_id() OR app_access_role(building_id) IN ('PLATFORM_ADMIN', 'BUILDING_ADMIN'))
);
DROP POLICY IF EXISTS gate_commands_request ON gate_commands;
CREATE POLICY gate_commands_request ON gate_commands FOR INSERT WITH CHECK (
  requested_by = app_current_user_id() AND status = 'PENDING'
  AND created_at BETWEEN now() - interval '5 seconds' AND now() + interval '1 second'
  AND sent_at IS NULL AND acknowledged_at IS NULL AND failure_reason IS NULL
  AND app_access_role(building_id) IS NOT NULL
  AND EXISTS (SELECT 1 FROM gates g JOIN gateways gw ON gw.id = g.gateway_id JOIN devices d ON d.id = g.device_id
    WHERE g.id = gate_id AND g.building_id = gate_commands.building_id AND g.gateway_id = gate_commands.gateway_id
    AND g.device_id = gate_commands.device_id AND g.enabled
    AND (g.allow_residents OR app_access_role(g.building_id) IN ('PLATFORM_ADMIN', 'BUILDING_ADMIN'))
    AND gw.enabled AND gw.status = 'ONLINE' AND gw.last_seen_at > now() - interval '60 seconds'
    AND d.enabled AND d.status = 'ONLINE' AND d.last_seen_at > now() - interval '60 seconds')
);
-- Only ingest (owner/service role) may acknowledge, fail or expire a command.
REVOKE UPDATE, DELETE ON gate_commands FROM predioon_app;
DROP POLICY IF EXISTS access_rejection_audit ON audit_logs;
CREATE POLICY access_rejection_audit ON audit_logs FOR INSERT WITH CHECK (
  user_id = app_current_user_id() AND actor_type = 'USER' AND building_id IS NULL
  AND action = 'ACCESS_REQUEST_REJECTED' AND resource_type = 'gate'
);

ALTER TABLE gates DROP CONSTRAINT IF EXISTS gates_kind_check;
ALTER TABLE gates ADD CONSTRAINT gates_kind_check CHECK (kind IN ('GARAGE', 'PEDESTRIAN'));
ALTER TABLE gate_commands DROP CONSTRAINT IF EXISTS gate_commands_status_check;
ALTER TABLE gate_commands ADD CONSTRAINT gate_commands_status_check CHECK (status IN ('PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED', 'EXPIRED'));
ALTER TABLE gate_commands DROP CONSTRAINT IF EXISTS gate_commands_ttl_check;
ALTER TABLE gate_commands ADD CONSTRAINT gate_commands_ttl_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 seconds');

-- Prevent tenant-mismatched foreign keys even when an application WHERE is missed.
CREATE OR REPLACE FUNCTION check_access_hardware() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gateways gw JOIN devices d ON d.gateway_id = gw.id
    WHERE gw.id = NEW.gateway_id AND d.id = NEW.device_id AND gw.building_id = NEW.building_id
    AND d.building_id = NEW.building_id AND d.type IN ('GARAGE_GATE', 'PEDESTRIAN_GATE', 'GATE_CONTROLLER')) THEN
    RAISE EXCEPTION 'Controlador e gateway fora do escopo do acesso' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gates_hardware_check ON gates;
CREATE TRIGGER gates_hardware_check BEFORE INSERT OR UPDATE ON gates FOR EACH ROW EXECUTE FUNCTION check_access_hardware();
