-- Apply atomically. Requester content remains private even when tickets share
-- an assignee or a group; those relationships never confer reading authority.
CREATE OR REPLACE FUNCTION app_occurrence_has_capability_at(target_building_id text,target_occurrence_id text,target_capability text,evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_capability IN ('occurrences:read-own','occurrences:manage') AND EXISTS (
   SELECT 1 FROM occurrences o
   WHERE o.id=CASE WHEN target_occurrence_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_occurrence_id::uuid END
     AND o.building_id=target_building_id
     AND (target_capability='occurrences:manage' OR o.opened_by=app_current_user_id())
     AND app_has_capability_at(o.building_id,target_capability,'occurrence',o.id::text,evaluated_at)
 );
$$;
CREATE OR REPLACE FUNCTION app_occurrence_has_capability(target_building_id text,target_occurrence_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_occurrence_has_capability_at(target_building_id,target_occurrence_id,target_capability,statement_timestamp());
$$;
CREATE OR REPLACE FUNCTION app_occurrence_can_read_scope(target_building_id text,require_management boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_has_capability(target_building_id,'occurrences:manage')
 OR (NOT require_management AND app_has_capability(target_building_id,'occurrences:read-own'))
 OR EXISTS (
   WITH candidates AS MATERIALIZED (
     SELECT rb.resource_id FROM role_bindings rb WHERE rb.building_id=target_building_id AND rb.resource_type='occurrence'
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
   )
   SELECT 1 FROM candidates c WHERE app_occurrence_has_capability(target_building_id,c.resource_id,'occurrences:manage')
     OR (NOT require_management AND app_occurrence_has_capability(target_building_id,c.resource_id,'occurrences:read-own'))
 );
$$;
CREATE OR REPLACE FUNCTION app_occurrence_can_read_feature_state(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_occurrence_can_read_scope(target_building_id,false);
$$;
CREATE OR REPLACE FUNCTION app_occurrence_cancelled_own(target_building_id text,target_occurrence_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM occurrences o
   WHERE o.id=CASE WHEN target_occurrence_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_occurrence_id::uuid END
   AND o.building_id=target_building_id AND o.status='CANCELLED'
   AND app_occurrence_has_capability(o.building_id,o.id::text,'occurrences:read-own'));
$$;
CREATE OR REPLACE FUNCTION app_occurrence_group_can_manage(target_building_id text,target_group_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 WITH target AS (SELECT CASE WHEN target_group_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_group_id::uuid END AS id)
 SELECT EXISTS(SELECT 1 FROM occurrences o,target g WHERE o.building_id=target_building_id AND o.group_id=g.id)
 AND NOT EXISTS(SELECT 1 FROM occurrences o,target g WHERE o.building_id=target_building_id AND o.group_id=g.id
   AND NOT app_occurrence_has_capability(o.building_id,o.id::text,'occurrences:manage'));
$$;
CREATE OR REPLACE FUNCTION app_occurrence_can_manage_group(target_building_id text,target_occurrence_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM occurrences o
   WHERE o.id=CASE WHEN target_occurrence_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_occurrence_id::uuid END
     AND o.building_id=target_building_id AND app_occurrence_has_capability(o.building_id,o.id::text,'occurrences:manage')
     AND (o.group_id IS NULL OR app_occurrence_group_can_manage(o.building_id,o.group_id::text)));
$$;
CREATE OR REPLACE FUNCTION app_occurrence_assignee_active(target_building_id text,target_occurrence_id text,target_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_occurrence_has_capability(target_building_id,target_occurrence_id,'occurrences:manage')
 AND EXISTS(SELECT 1 FROM users u WHERE u.id=target_user_id AND u.active AND (
   EXISTS(SELECT 1 FROM memberships m JOIN roles r ON r.key=m.role::text AND r.active AND r.scope='BUILDING'
     WHERE m.user_id=u.id AND m.building_id=target_building_id AND app_rbac_window(m.active,m.starts_at,m.ends_at))
   OR EXISTS(SELECT 1 FROM role_bindings rb JOIN roles r ON r.key=rb.role_key AND r.active AND r.scope IN ('BUILDING','RESOURCE')
     WHERE rb.user_id=u.id AND rb.building_id=target_building_id AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
       AND app_discovery_resource_belongs(rb.building_id,rb.resource_type,rb.resource_id))
   OR EXISTS(SELECT 1 FROM team_members tm JOIN teams t ON t.id=tm.team_id AND t.building_id=tm.building_id AND t.active
     JOIN role_bindings rb ON rb.team_id=t.id AND rb.building_id=t.building_id
     JOIN roles r ON r.key=rb.role_key AND r.active AND r.scope IN ('BUILDING','RESOURCE')
     WHERE tm.user_id=u.id AND tm.building_id=target_building_id AND app_rbac_window(tm.active,tm.starts_at,tm.ends_at)
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at) AND app_discovery_resource_belongs(rb.building_id,rb.resource_type,rb.resource_id))
 ));
$$;

DROP POLICY IF EXISTS occurrences_scope_policy ON occurrences;
DROP POLICY IF EXISTS occurrences_active_access ON occurrences;
DROP POLICY IF EXISTS occurrence_events_scope_policy ON occurrence_events;
DROP POLICY IF EXISTS occurrence_events_active_access ON occurrence_events;
DROP POLICY IF EXISTS occurrences_read_policy ON occurrences;
CREATE POLICY occurrences_read_policy ON occurrences FOR SELECT TO predioon_app USING (
 app_occurrence_has_capability(building_id,id::text,'occurrences:manage') OR app_occurrence_has_capability(building_id,id::text,'occurrences:read-own'));
DROP POLICY IF EXISTS occurrences_insert_policy ON occurrences;
CREATE POLICY occurrences_insert_policy ON occurrences FOR INSERT TO predioon_app WITH CHECK (
 opened_by=app_current_user_id() AND status='OPEN' AND group_id IS NULL AND assigned_to IS NULL AND alert_id IS NULL AND closed_at IS NULL
 AND app_has_capability(building_id,'occurrences:create-own') AND app_has_capability(building_id,'occurrences:read-own'));
DROP POLICY IF EXISTS occurrences_update_policy ON occurrences;
CREATE POLICY occurrences_update_policy ON occurrences FOR UPDATE TO predioon_app
 USING (app_occurrence_has_capability(building_id,id::text,'occurrences:manage'))
 WITH CHECK (app_occurrence_has_capability(building_id,id::text,'occurrences:manage'));
REVOKE UPDATE,DELETE ON occurrences FROM predioon_app;
GRANT UPDATE(status,priority,assigned_to,group_id,closed_at,updated_at) ON occurrences TO predioon_app;
DROP POLICY IF EXISTS occurrence_events_read_policy ON occurrence_events;
CREATE POLICY occurrence_events_read_policy ON occurrence_events FOR SELECT TO predioon_app USING (
 app_occurrence_has_capability(building_id,occurrence_id::text,'occurrences:manage') OR app_occurrence_has_capability(building_id,occurrence_id::text,'occurrences:read-own'));
DROP POLICY IF EXISTS occurrence_events_insert_policy ON occurrence_events;
CREATE POLICY occurrence_events_insert_policy ON occurrence_events FOR INSERT TO predioon_app WITH CHECK (
 author_id=app_current_user_id() AND (app_occurrence_has_capability(building_id,occurrence_id::text,'occurrences:manage')
 OR (kind IN ('COMMENT','CREATED') AND app_occurrence_has_capability(building_id,occurrence_id::text,'occurrences:read-own'))));
REVOKE UPDATE,DELETE ON occurrence_events FROM predioon_app,predioon_identity,predioon_broker_auth;

-- A requester cannot take an administrative UPDATE grant or choose a historical
-- authorization time. Both routines recheck current authority after row waits.
CREATE OR REPLACE FUNCTION app_occurrence_cancel_own(target_building_id text,target_occurrence_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE current_occurrence occurrences%ROWTYPE; changed_at timestamptz;
BEGIN
 IF NOT app_occurrence_has_capability(target_building_id,target_occurrence_id::text,'occurrences:read-own') THEN
   RAISE EXCEPTION 'Occurrence not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO current_occurrence FROM occurrences WHERE id=target_occurrence_id AND building_id=target_building_id FOR UPDATE;
 changed_at:=clock_timestamp();
 IF NOT FOUND OR NOT app_occurrence_has_capability_at(target_building_id,target_occurrence_id::text,'occurrences:read-own',changed_at) THEN
   RAISE EXCEPTION 'Occurrence not found' USING ERRCODE='P0002'; END IF;
 IF current_occurrence.status NOT IN ('OPEN','IN_ANALYSIS','IN_PROGRESS') THEN
   RAISE EXCEPTION 'Occurrence already closed' USING ERRCODE='P0409'; END IF;
 UPDATE occurrences SET status='CANCELLED',closed_at=changed_at,updated_at=changed_at WHERE id=current_occurrence.id;
 INSERT INTO occurrence_events(occurrence_id,building_id,author_id,kind,message,created_at)
 VALUES(current_occurrence.id,current_occurrence.building_id,app_current_user_id(),'STATUS_CHANGED',current_occurrence.status::text || ' → CANCELLED',changed_at);
 RETURN current_occurrence.id;
END;
$$;
CREATE OR REPLACE FUNCTION app_occurrence_touch_own(target_building_id text,target_occurrence_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE current_occurrence occurrences%ROWTYPE; changed_at timestamptz;
BEGIN
 IF NOT app_occurrence_has_capability(target_building_id,target_occurrence_id::text,'occurrences:read-own') THEN
   RAISE EXCEPTION 'Occurrence not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO current_occurrence FROM occurrences WHERE id=target_occurrence_id AND building_id=target_building_id FOR UPDATE;
 changed_at:=clock_timestamp();
 IF NOT FOUND OR NOT app_occurrence_has_capability_at(target_building_id,target_occurrence_id::text,'occurrences:read-own',changed_at) THEN
   RAISE EXCEPTION 'Occurrence not found' USING ERRCODE='P0002'; END IF;
 UPDATE occurrences SET updated_at=changed_at WHERE id=current_occurrence.id;
 RETURN current_occurrence.id;
END;
$$;

DROP POLICY IF EXISTS building_features_occurrences_read ON building_feature_settings;
CREATE POLICY building_features_occurrences_read ON building_feature_settings FOR SELECT TO predioon_app USING (app_occurrence_can_read_feature_state(building_id));
DROP POLICY IF EXISTS feature_runtime_occurrences_read ON feature_runtime;
CREATE POLICY feature_runtime_occurrences_read ON feature_runtime FOR SELECT TO predioon_app USING (app_occurrence_can_read_feature_state(building_id));
DO $$ DECLARE definition text; anchor text; BEGIN
 SELECT pg_get_functiondef('app_can_read_feature_event(text)'::regprocedure) INTO STRICT definition;
 anchor:='OR app_equipment_can_read_scope(b.id,''gateway'')';
 IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'Unexpected feature event function shape'; END IF;
 definition:=replace(definition,'OR app_occurrence_can_read_feature_state(b.id)','');
 EXECUTE replace(definition,anchor,anchor || E'\n     OR app_occurrence_can_read_feature_state(b.id)');
END $$;

-- Preserve the current policy, including 023 monitoring and 026 notices, and
-- replace only this domain. An occurrence_group is an audit type, not a grant.
DO $$ DECLARE expression text; branches text; action_name text; BEGIN
 SELECT pg_get_expr(polwithcheck,polrelid) INTO STRICT expression FROM pg_policy
 WHERE polrelid='audit_logs'::regclass AND polname='audit_logs_insert_policy';
 IF expression NOT LIKE '%CASE action%' OR expression NOT LIKE '%ELSE%' THEN RAISE EXCEPTION 'Unexpected audit policy shape'; END IF;
 branches:=$branches$
 WHEN 'OCCURRENCE_UPDATED'::text THEN resource_type='occurrence' AND building_id IS NOT NULL AND (
   (app_occurrence_has_capability(building_id,resource_id,'occurrences:manage')
     AND (coalesce(metadata->>'applyToGroup','false')='false' OR app_occurrence_can_manage_group(building_id,resource_id)))
   OR (app_occurrence_cancelled_own(building_id,resource_id)
     AND metadata->>'status'='CANCELLED' AND coalesce(metadata->>'applyToGroup','false')='false'
     AND metadata - ARRAY['status','applyToGroup']='{}'::jsonb))
 WHEN 'OCCURRENCE_COMMENTED'::text THEN resource_type='occurrence' AND building_id IS NOT NULL
   AND (app_occurrence_has_capability(building_id,resource_id,'occurrences:manage') OR app_occurrence_has_capability(building_id,resource_id,'occurrences:read-own'))
   AND (coalesce(metadata->>'applyToGroup','false')='false' OR app_occurrence_can_manage_group(building_id,resource_id))
 WHEN 'OCCURRENCES_GROUPED'::text THEN resource_type='occurrence_group' AND building_id IS NOT NULL
   AND app_occurrence_group_can_manage(building_id,resource_id)
 $branches$;
 FOREACH action_name IN ARRAY ARRAY['OCCURRENCE_UPDATED','OCCURRENCE_COMMENTED','OCCURRENCES_GROUPED'] LOOP
   expression:=regexp_replace(expression,'WHEN ''' || action_name || '''::text THEN .*?(?=WHEN |ELSE)', '', 'ns');
 END LOOP;
 EXECUTE 'ALTER POLICY audit_logs_insert_policy ON audit_logs WITH CHECK (' || regexp_replace(expression,'ELSE',branches || ' ELSE') || ')';
END $$;

DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_occurrence_has_capability_at(text,text,text,timestamptz)'::regprocedure,
   'app_occurrence_has_capability(text,text,text)'::regprocedure,
   'app_occurrence_can_read_scope(text,boolean)'::regprocedure,
   'app_occurrence_can_read_feature_state(text)'::regprocedure,
   'app_occurrence_cancelled_own(text,text)'::regprocedure,
   'app_occurrence_group_can_manage(text,text)'::regprocedure,
   'app_occurrence_can_manage_group(text,text)'::regprocedure,
   'app_occurrence_assignee_active(text,text,text)'::regprocedure,
   'app_occurrence_cancel_own(text,uuid)'::regprocedure,
   'app_occurrence_touch_own(text,uuid)'::regprocedure,
   'app_can_read_feature_event(text)'::regprocedure
 ] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
   IF helper<>'app_occurrence_has_capability_at(text,text,text,timestamptz)'::regprocedure THEN
     EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper);
   END IF;
 END LOOP;
END $$;
