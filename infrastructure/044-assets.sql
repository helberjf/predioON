-- Assets: the physical things maintenance works on (a pump, an elevator, a
-- generator). An asset may be watched by monitored devices and is what a work
-- order can point to, which gives each asset its maintenance history.
-- Reading follows devices:read and management follows devices:configure, the
-- existing equipment permissions; no new permission is introduced.
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'OTHER',
  location text NOT NULL DEFAULT '',
  manufacturer text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  serial_number text NOT NULL DEFAULT '',
  installed_on date,
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assets_id_building_uq UNIQUE (id, building_id),
  CONSTRAINT assets_name_ck CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 160),
  CONSTRAINT assets_category_ck CHECK (category IN ('PUMP','ELEVATOR','GENERATOR','GATE','HVAC','FIRE_SAFETY','ELECTRICAL','PLUMBING','OTHER')),
  CONSTRAINT assets_text_ck CHECK (char_length(location)<=160 AND char_length(manufacturer)<=120 AND char_length(model)<=120
    AND char_length(serial_number)<=120 AND char_length(notes)<=2000),
  CONSTRAINT assets_version_ck CHECK (version>0)
);
CREATE INDEX IF NOT EXISTS assets_building_name_idx ON assets(building_id, name, id);

CREATE TABLE IF NOT EXISTS asset_device_links (
  asset_id uuid NOT NULL,
  building_id text NOT NULL,
  device_id text NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (asset_id, device_id),
  CONSTRAINT asset_device_links_asset_fk FOREIGN KEY (asset_id, building_id) REFERENCES assets(id, building_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS asset_device_links_device_idx ON asset_device_links(device_id);

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS asset_id uuid;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='work_orders'::regclass AND conname='work_orders_asset_building_fk') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_asset_building_fk
      FOREIGN KEY (asset_id, building_id) REFERENCES assets(id, building_id) ON DELETE SET NULL (asset_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS work_orders_asset_idx ON work_orders(asset_id) WHERE asset_id IS NOT NULL;

-- Fields that never change, optimistic versioning and the tenant of a linked
-- device. Permission itself is decided by the policies below.
CREATE OR REPLACE FUNCTION app_asset_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='asset_device_links' THEN
    IF NOT EXISTS(SELECT 1 FROM devices d WHERE d.id=NEW.device_id AND d.building_id=NEW.building_id) THEN
      RAISE EXCEPTION 'Device does not belong to this condominium' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF app_current_user_id() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM app_current_user_id() OR NEW.version<>1 OR NOT NEW.active THEN
      RAISE EXCEPTION 'Asset creation denied' USING ERRCODE='42501';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.building_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.building_id,OLD.created_by,OLD.created_at) THEN
      RAISE EXCEPTION 'Immutable asset fields' USING ERRCODE='42501';
    END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Asset changed concurrently' USING ERRCODE='P0409'; END IF;
  END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_asset_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS assets_guard ON assets;
CREATE TRIGGER assets_guard BEFORE INSERT OR UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION app_asset_guard();
DROP TRIGGER IF EXISTS asset_device_links_guard ON asset_device_links;
CREATE TRIGGER asset_device_links_guard BEFORE INSERT OR UPDATE ON asset_device_links FOR EACH ROW EXECUTE FUNCTION app_asset_guard();

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_device_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE assets, asset_device_links FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth, predioon_notifications;
GRANT SELECT ON TABLE assets, asset_device_links TO predioon_app;
GRANT INSERT (id, building_id, name, category, location, manufacturer, model, serial_number, installed_on, notes, created_by) ON TABLE assets TO predioon_app;
GRANT UPDATE (name, category, location, manufacturer, model, serial_number, installed_on, notes, active, version) ON TABLE assets TO predioon_app;
GRANT INSERT (asset_id, building_id, device_id, created_by), DELETE ON TABLE asset_device_links TO predioon_app;

-- Inactive assets remain visible only to whoever can manage them.
DROP POLICY IF EXISTS assets_read ON assets;
CREATE POLICY assets_read ON assets FOR SELECT TO predioon_app USING (
  app_has_capability(building_id,'devices:configure') OR (active AND app_has_capability(building_id,'devices:read')));
DROP POLICY IF EXISTS assets_insert ON assets;
CREATE POLICY assets_insert ON assets FOR INSERT TO predioon_app
  WITH CHECK (created_by=app_current_user_id() AND app_has_capability(building_id,'devices:configure'));
DROP POLICY IF EXISTS assets_update ON assets;
CREATE POLICY assets_update ON assets FOR UPDATE TO predioon_app
  USING (app_has_capability(building_id,'devices:configure')) WITH CHECK (app_has_capability(building_id,'devices:configure'));
DROP POLICY IF EXISTS asset_device_links_read ON asset_device_links;
CREATE POLICY asset_device_links_read ON asset_device_links FOR SELECT TO predioon_app
  USING (app_has_capability(building_id,'devices:read'));
DROP POLICY IF EXISTS asset_device_links_insert ON asset_device_links;
CREATE POLICY asset_device_links_insert ON asset_device_links FOR INSERT TO predioon_app
  WITH CHECK (created_by=app_current_user_id() AND app_has_capability(building_id,'devices:configure'));
DROP POLICY IF EXISTS asset_device_links_delete ON asset_device_links;
CREATE POLICY asset_device_links_delete ON asset_device_links FOR DELETE TO predioon_app
  USING (app_has_capability(building_id,'devices:configure'));

-- The work-order guard now also covers the asset: an executor cannot change it,
-- and whoever sets it must be able to see an active asset of the same condominium.
CREATE OR REPLACE FUNCTION app_work_order_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE distributes boolean;
BEGIN
  IF app_current_user_id() IS NULL THEN RETURN NEW; END IF;
  distributes:=app_has_capability(NEW.building_id,'work-orders:assign');
  IF TG_OP='INSERT' THEN
    IF NOT distributes OR NEW.created_by IS DISTINCT FROM app_current_user_id() OR NEW.status<>'OPEN' OR NEW.version<>1
      OR NEW.started_at IS NOT NULL OR NEW.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Work order creation denied' USING ERRCODE='42501';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.building_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.building_id,OLD.created_by,OLD.created_at) THEN
      RAISE EXCEPTION 'Immutable work order fields' USING ERRCODE='42501';
    END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Work order changed concurrently' USING ERRCODE='P0409'; END IF;
    IF OLD.status IN ('DONE','CANCELLED') THEN RAISE EXCEPTION 'Work order already closed' USING ERRCODE='55000'; END IF;
    IF NOT distributes THEN
      IF NOT app_work_order_access(OLD.building_id, OLD.assigned_user_id, OLD.assigned_team_id, true)
        OR ROW(NEW.title,NEW.description,NEW.priority,NEW.occurrence_id,NEW.asset_id,NEW.assigned_user_id,NEW.assigned_team_id,NEW.due_at)
          IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.priority,OLD.occurrence_id,OLD.asset_id,OLD.assigned_user_id,OLD.assigned_team_id,OLD.due_at)
        OR NEW.status='CANCELLED' THEN
        RAISE EXCEPTION 'Work order change denied' USING ERRCODE='42501';
      END IF;
    END IF;
    IF NEW.status<>OLD.status AND NOT ((OLD.status='OPEN' AND NEW.status IN ('IN_PROGRESS','CANCELLED'))
      OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('DONE','CANCELLED','OPEN'))) THEN
      RAISE EXCEPTION 'Invalid work order transition' USING ERRCODE='55000';
    END IF;
  END IF;
  IF NEW.assigned_user_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id)
    AND NOT app_work_order_assignee_linked(NEW.building_id, NEW.assigned_user_id) THEN
    RAISE EXCEPTION 'Assignee has no current link to this condominium' USING ERRCODE='23514';
  END IF;
  IF NEW.assigned_team_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.assigned_team_id IS DISTINCT FROM OLD.assigned_team_id)
    AND NOT EXISTS(SELECT 1 FROM teams t WHERE t.id=NEW.assigned_team_id AND t.building_id=NEW.building_id AND t.active) THEN
    RAISE EXCEPTION 'Team is not active in this condominium' USING ERRCODE='23514';
  END IF;
  IF NEW.occurrence_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id)
    AND NOT (app_has_capability(NEW.building_id,'occurrences:manage')
      AND EXISTS(SELECT 1 FROM occurrences o WHERE o.id=NEW.occurrence_id AND o.building_id=NEW.building_id)) THEN
    RAISE EXCEPTION 'Request cannot be linked to this work order' USING ERRCODE='23514';
  END IF;
  IF NEW.asset_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.asset_id IS DISTINCT FROM OLD.asset_id)
    AND NOT (app_has_capability(NEW.building_id,'devices:read')
      AND EXISTS(SELECT 1 FROM assets s WHERE s.id=NEW.asset_id AND s.building_id=NEW.building_id AND s.active)) THEN
    RAISE EXCEPTION 'Asset cannot be linked to this work order' USING ERRCODE='23514';
  END IF;
  NEW.updated_at:=clock_timestamp();
  IF TG_OP='UPDATE' AND NEW.status<>OLD.status THEN
    NEW.started_at:=CASE WHEN NEW.status='IN_PROGRESS' THEN NEW.updated_at WHEN NEW.status='OPEN' THEN NULL ELSE OLD.started_at END;
    NEW.closed_at:=CASE WHEN NEW.status IN ('DONE','CANCELLED') THEN NEW.updated_at ELSE NULL END;
  ELSIF TG_OP='UPDATE' THEN
    NEW.started_at:=OLD.started_at; NEW.closed_at:=OLD.closed_at;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_work_order_guard() FROM PUBLIC;
GRANT INSERT (asset_id), UPDATE (asset_id) ON TABLE work_orders TO predioon_app;

-- Audit proof for asset management, including changes to its device links.
DO $$
DECLARE definition text;
 fallback constant text := 'ELSE false END';
 branch constant text := 'WHEN action_name IN (''ASSET_CREATED'',''ASSET_UPDATED'') AND target_type=''asset'' THEN
   app_has_capability(target_building,''devices:configure'') AND EXISTS(SELECT 1 FROM assets s WHERE s.id::text=target_id AND s.building_id=target_building
     AND (action_name<>''ASSET_CREATED'' OR s.created_by=app_current_user_id()))
  ';
BEGIN
 SELECT pg_get_functiondef('app_audit_legacy_insert(text,text,text,text)'::regprocedure) INTO STRICT definition;
 IF position('''ASSET_CREATED''' IN definition)=0 THEN
  IF regexp_count(definition, fallback)<>1 THEN RAISE EXCEPTION 'Unexpected audit fallback shape'; END IF;
  EXECUTE replace(definition, fallback, branch || fallback);
 ELSIF position(branch IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected asset audit branch';
 END IF;
END $$;
