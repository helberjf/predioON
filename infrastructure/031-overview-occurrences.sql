-- Narrow summary only: no additional table grants, policies or RBAC catalog.
CREATE OR REPLACE FUNCTION app_overview_occurrences(target_building_id text)
RETURNS TABLE(open_count bigint,coverage text,visibility text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE whole_management boolean; scoped_management boolean;
BEGIN
 IF NOT app_occurrence_can_read_scope(target_building_id,false) THEN
   RETURN QUERY SELECT NULL::bigint,'none'::text,'none'::text; RETURN;
 END IF;
 whole_management:=app_has_capability(target_building_id,'occurrences:manage');
 scoped_management:=NOT whole_management AND app_occurrence_can_read_scope(target_building_id,true);
 IF whole_management THEN
   RETURN QUERY SELECT count(*),'whole'::text,'all'::text FROM occurrences o
     WHERE o.building_id=target_building_id AND o.status IN ('OPEN','IN_ANALYSIS','IN_PROGRESS');
 ELSIF scoped_management THEN
   RETURN QUERY SELECT count(*),'partial'::text,'scoped'::text FROM occurrences o
     WHERE o.building_id=target_building_id AND o.status IN ('OPEN','IN_ANALYSIS','IN_PROGRESS')
       AND (app_occurrence_has_capability(o.building_id,o.id::text,'occurrences:manage')
         OR (o.opened_by=app_current_user_id() AND app_occurrence_has_capability(o.building_id,o.id::text,'occurrences:read-own')));
 ELSE
   -- Author predicate uses the existing index without scanning neighbors' history.
   RETURN QUERY SELECT count(*),'partial'::text,'own'::text FROM occurrences o
     WHERE o.building_id=target_building_id AND o.opened_by=app_current_user_id()
       AND o.status IN ('OPEN','IN_ANALYSIS','IN_PROGRESS')
       AND app_occurrence_has_capability(o.building_id,o.id::text,'occurrences:read-own');
 END IF;
END $$;
DO $$ DECLARE owner_name text; grantee_name text; helper regprocedure:='app_overview_occurrences(text)'::regprocedure; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT owner_name FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,owner_name);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
 FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee
   WHERE p.oid=helper AND acl.grantee<>p.proowner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper);
END $$;
