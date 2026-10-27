-- A provider can be recorded by name without creating an identity or access grant.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assigned_name text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='work_orders'::regclass AND conname='work_orders_named_assignee_ck') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_named_assignee_ck CHECK (
      assigned_name IS NULL OR (assigned_name=btrim(assigned_name) AND char_length(assigned_name) BETWEEN 1 AND 160
        AND assigned_user_id IS NULL AND assigned_team_id IS NULL));
  END IF;
END $$;

-- Keep the existing version, transition, tenant and closed-order guards. This
-- additional guard protects the new field even for direct restricted SQL callers.
CREATE OR REPLACE FUNCTION app_work_order_named_assignee_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF app_current_user_id() IS NOT NULL AND NOT app_has_capability(NEW.building_id,'work-orders:assign') THEN
    IF TG_OP='INSERT' THEN
      IF NEW.assigned_name IS NOT NULL THEN RAISE EXCEPTION 'Work order assignment denied' USING ERRCODE='42501'; END IF;
    ELSIF NEW.assigned_name IS DISTINCT FROM OLD.assigned_name THEN
      RAISE EXCEPTION 'Work order assignment denied' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_work_order_named_assignee_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS work_orders_named_assignee_guard ON work_orders;
CREATE TRIGGER work_orders_named_assignee_guard BEFORE INSERT OR UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION app_work_order_named_assignee_guard();
GRANT INSERT (assigned_name), UPDATE (assigned_name) ON TABLE work_orders TO predioon_app;
