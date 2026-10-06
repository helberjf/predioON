-- Work orders: maintenance tasks distributed by whoever holds work-orders:assign
-- and executed by the assigned person or team. The three permissions were
-- seeded in 014; this migration adds the records, their history and the rules.
-- A work order is not a resident request: it may point to one, never replace it.
CREATE TABLE IF NOT EXISTS work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'NORMAL',
  status text NOT NULL DEFAULT 'OPEN',
  occurrence_id uuid REFERENCES occurrences(id) ON DELETE SET NULL,
  assigned_user_id text REFERENCES users(id) ON DELETE SET NULL,
  assigned_team_id uuid,
  due_at timestamptz,
  created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  closed_at timestamptz,
  CONSTRAINT work_orders_id_building_uq UNIQUE (id, building_id),
  CONSTRAINT work_orders_title_ck CHECK (title=btrim(title) AND char_length(title) BETWEEN 1 AND 160),
  CONSTRAINT work_orders_description_ck CHECK (char_length(description)<=4000),
  CONSTRAINT work_orders_priority_ck CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  CONSTRAINT work_orders_status_ck CHECK (status IN ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
  CONSTRAINT work_orders_assignee_ck CHECK (assigned_user_id IS NULL OR assigned_team_id IS NULL),
  CONSTRAINT work_orders_version_ck CHECK (version>0),
  CONSTRAINT work_orders_closed_ck CHECK ((status IN ('DONE','CANCELLED'))=(closed_at IS NOT NULL)),
  CONSTRAINT work_orders_team_building_fk FOREIGN KEY (assigned_team_id, building_id) REFERENCES teams(id, building_id) ON DELETE SET NULL (assigned_team_id)
);
CREATE INDEX IF NOT EXISTS work_orders_building_created_idx ON work_orders(building_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS work_orders_assigned_user_idx ON work_orders(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_orders_assigned_team_idx ON work_orders(assigned_team_id) WHERE assigned_team_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS work_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL,
  building_id text NOT NULL,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  from_status text,
  to_status text,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_order_events_kind_ck CHECK (kind IN ('CREATED','UPDATED','ASSIGNED','STATUS_CHANGED','NOTE')),
  CONSTRAINT work_order_events_note_ck CHECK (char_length(note)<=2000 AND (kind<>'NOTE' OR char_length(btrim(note))>0)),
  CONSTRAINT work_order_events_status_ck CHECK ((kind='STATUS_CHANGED')=(from_status IS NOT NULL AND to_status IS NOT NULL)),
  CONSTRAINT work_order_events_order_fk FOREIGN KEY (work_order_id, building_id) REFERENCES work_orders(id, building_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS work_order_events_order_idx ON work_order_events(work_order_id, created_at, id);

-- Assignment is to the current actor or to a team the actor belongs to now.
CREATE OR REPLACE FUNCTION app_work_order_assigned(target_building text, assignee_user text, assignee_team uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT (assignee_user IS NOT NULL AND assignee_user=app_current_user_id())
    OR (assignee_team IS NOT NULL AND app_rbac_team_member(target_building, assignee_team));
$$;

-- Distribution sees everything in the condominium; execution sees its own work.
CREATE OR REPLACE FUNCTION app_work_order_access(target_building text, assignee_user text, assignee_team uuid, executing boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT app_has_capability(target_building,'work-orders:assign')
    OR (app_has_capability(target_building,'work-orders:read-assigned')
      AND (NOT executing OR app_has_capability(target_building,'work-orders:update-assigned'))
      AND app_work_order_assigned(target_building, assignee_user, assignee_team));
$$;

-- Used by the history table and the audit proof, which only know the order id.
CREATE OR REPLACE FUNCTION app_work_order_row_access(target_building text, target_order uuid, executing boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM work_orders w WHERE w.id=target_order AND w.building_id=target_building
    AND app_work_order_access(w.building_id, w.assigned_user_id, w.assigned_team_id, executing));
$$;

-- A person can receive an order only with a current link to the condominium;
-- what they may then see is still decided by their permissions at read time.
CREATE OR REPLACE FUNCTION app_work_order_assignee_linked(target_building text, candidate text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=candidate AND u.active) AND (
    EXISTS(SELECT 1 FROM role_bindings rb WHERE rb.building_id=target_building AND rb.user_id=candidate
      AND app_rbac_window(rb.active, rb.starts_at, rb.ends_at))
    OR EXISTS(SELECT 1 FROM team_members tm JOIN teams t ON t.id=tm.team_id AND t.building_id=tm.building_id AND t.active
      WHERE tm.building_id=target_building AND tm.user_id=candidate AND app_rbac_window(tm.active, tm.starts_at, tm.ends_at))
    OR EXISTS(SELECT 1 FROM memberships m WHERE m.building_id=target_building AND m.user_id=candidate
      AND app_rbac_window(m.active, m.starts_at, m.ends_at)));
$$;

-- Field and transition rules live beside the data: RLS cannot tell which
-- columns an executor changed, and both actors update the same row.
CREATE OR REPLACE FUNCTION app_work_order_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE distributes boolean;
BEGIN
  -- Administrative maintenance outside an actor context is not constrained here.
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
        OR ROW(NEW.title,NEW.description,NEW.priority,NEW.occurrence_id,NEW.assigned_user_id,NEW.assigned_team_id,NEW.due_at)
          IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.priority,OLD.occurrence_id,OLD.assigned_user_id,OLD.assigned_team_id,OLD.due_at)
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
  -- Timestamps follow the state, whatever the statement supplied.
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
DROP TRIGGER IF EXISTS work_orders_guard ON work_orders;
CREATE TRIGGER work_orders_guard BEFORE INSERT OR UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION app_work_order_guard();

ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE work_orders, work_order_events FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth, predioon_notifications;
GRANT SELECT ON TABLE work_orders, work_order_events TO predioon_app;
GRANT INSERT (id, building_id, title, description, priority, occurrence_id, assigned_user_id, assigned_team_id, due_at, created_by)
  ON TABLE work_orders TO predioon_app;
GRANT UPDATE (title, description, priority, status, occurrence_id, assigned_user_id, assigned_team_id, due_at, version)
  ON TABLE work_orders TO predioon_app;
GRANT INSERT (id, work_order_id, building_id, actor_id, kind, from_status, to_status, note) ON TABLE work_order_events TO predioon_app;

DROP POLICY IF EXISTS work_orders_read ON work_orders;
CREATE POLICY work_orders_read ON work_orders FOR SELECT TO predioon_app
  USING (app_work_order_access(building_id, assigned_user_id, assigned_team_id, false));
DROP POLICY IF EXISTS work_orders_insert ON work_orders;
CREATE POLICY work_orders_insert ON work_orders FOR INSERT TO predioon_app
  WITH CHECK (created_by=app_current_user_id() AND app_has_capability(building_id,'work-orders:assign'));
-- The new row may leave the executor's own view (reassignment by a manager is
-- the only way that happens), so only the old row is tested for execution.
DROP POLICY IF EXISTS work_orders_update ON work_orders;
CREATE POLICY work_orders_update ON work_orders FOR UPDATE TO predioon_app
  USING (app_work_order_access(building_id, assigned_user_id, assigned_team_id, true))
  WITH CHECK (app_has_capability(building_id,'work-orders:assign')
    OR app_work_order_access(building_id, assigned_user_id, assigned_team_id, true));
DROP POLICY IF EXISTS work_order_events_read ON work_order_events;
CREATE POLICY work_order_events_read ON work_order_events FOR SELECT TO predioon_app
  USING (app_work_order_row_access(building_id, work_order_id, false));
DROP POLICY IF EXISTS work_order_events_insert ON work_order_events;
CREATE POLICY work_order_events_insert ON work_order_events FOR INSERT TO predioon_app
  WITH CHECK (actor_id=app_current_user_id() AND app_work_order_row_access(building_id, work_order_id, true));

DO $$ DECLARE helper regprocedure; BEGIN
  FOREACH helper IN ARRAY ARRAY[
    'app_work_order_assigned(text,text,uuid)'::regprocedure, 'app_work_order_access(text,text,uuid,boolean)'::regprocedure,
    'app_work_order_row_access(text,uuid,boolean)'::regprocedure, 'app_work_order_assignee_linked(text,text)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, predioon_identity, predioon_broker_auth, predioon_notifications', helper);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app', helper);
  END LOOP;
END $$;

-- Audit proof: the actor can act on that order now. Creation additionally
-- requires distribution and authorship.
DO $$
DECLARE definition text;
 fallback constant text := 'ELSE false END';
 branch constant text := 'WHEN action_name IN (''WORK_ORDER_CREATED'',''WORK_ORDER_UPDATED'',''WORK_ORDER_STATUS_CHANGED'') AND target_type=''work_order'' THEN
   EXISTS(SELECT 1 FROM work_orders w WHERE w.id::text=target_id AND w.building_id=target_building
     AND (action_name=''WORK_ORDER_STATUS_CHANGED'' OR app_has_capability(target_building,''work-orders:assign''))
     AND (action_name<>''WORK_ORDER_CREATED'' OR w.created_by=app_current_user_id())
     AND (app_has_capability(target_building,''work-orders:assign'')
       OR (app_has_capability(target_building,''work-orders:update-assigned'')
         AND app_work_order_assigned(w.building_id, w.assigned_user_id, w.assigned_team_id))))
  ';
BEGIN
 SELECT pg_get_functiondef('app_audit_legacy_insert(text,text,text,text)'::regprocedure) INTO STRICT definition;
 IF position('''WORK_ORDER_CREATED''' IN definition)=0 THEN
  IF regexp_count(definition, fallback)<>1 THEN RAISE EXCEPTION 'Unexpected audit fallback shape'; END IF;
  EXECUTE replace(definition, fallback, branch || fallback);
 ELSIF position(branch IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected work order audit branch';
 END IF;
END $$;
