-- Apply atomically after 029. Amounts, revisions and published contents remain intact.
INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('finance:read-published','finance','read-published','Consultar contas publicadas'),
 ('finance:manage','finance','manage','Gerenciar prestação de contas')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
 SELECT role_key,'finance:read-published' FROM unnest(ARRAY['BUILDING_ADMIN','MAINTENANCE_MANAGER','MAINTENANCE','RESIDENT']) role_key
ON CONFLICT(role_key,permission_key) DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES('BUILDING_ADMIN','finance:manage') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app_finance_has_capability(target_building_id text,target_report_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT target_capability IN ('finance:read','finance:read-published','finance:manage') AND EXISTS (
   SELECT 1 FROM financial_reports r
   WHERE r.id=CASE WHEN target_report_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_report_id::uuid END
     AND r.building_id=target_building_id
     AND app_has_capability(r.building_id,target_capability,'finance',r.id::text)
     AND (target_capability<>'finance:read-published' OR r.published_at<=statement_timestamp())
 );
$$;
CREATE OR REPLACE FUNCTION app_finance_can_read(target_building_id text,target_report_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_finance_has_capability(target_building_id,target_report_id,'finance:read')
   OR app_finance_has_capability(target_building_id,target_report_id,'finance:read-published');
$$;
CREATE OR REPLACE FUNCTION app_finance_can_read_scope(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_has_capability(target_building_id,'finance:read') OR app_has_capability(target_building_id,'finance:read-published')
   OR EXISTS (WITH candidates AS MATERIALIZED (
     SELECT rb.resource_id FROM role_bindings rb WHERE rb.building_id=target_building_id AND rb.resource_type='finance'
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at))
     SELECT 1 FROM candidates c WHERE app_finance_can_read(target_building_id,c.resource_id));
$$;
CREATE OR REPLACE FUNCTION app_finance_can_read_feature_state(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_finance_can_read_scope(target_building_id);
$$;
-- The target must be genuinely manageable before this owner projection says
-- whether an invisible later publication exists. It returns no financial data.
CREATE OR REPLACE FUNCTION app_finance_can_publish_revision(target_building_id text,target_report_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM financial_reports r
   WHERE r.id=CASE WHEN target_report_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_report_id::uuid END
     AND r.building_id=target_building_id
     AND app_has_capability(r.building_id,'finance:read','finance',r.id::text)
     AND app_has_capability(r.building_id,'finance:manage','finance',r.id::text)
     AND NOT EXISTS (SELECT 1 FROM financial_reports newer WHERE newer.building_id=r.building_id
       AND newer.month=r.month AND newer.revision>r.revision AND newer.published_at IS NOT NULL));
$$;

DROP POLICY IF EXISTS financial_reports_read ON financial_reports;
DROP POLICY IF EXISTS financial_reports_insert ON financial_reports;
DROP POLICY IF EXISTS financial_reports_update ON financial_reports;
CREATE POLICY financial_reports_read ON financial_reports FOR SELECT TO predioon_app
 USING(app_finance_can_read(building_id,id::text));
CREATE POLICY financial_reports_insert ON financial_reports FOR INSERT TO predioon_app WITH CHECK (
 app_has_capability(building_id,'finance:read') AND app_has_capability(building_id,'finance:manage')
 AND created_by=app_current_user_id() AND published_at IS NULL AND published_by IS NULL);
CREATE POLICY financial_reports_update ON financial_reports FOR UPDATE TO predioon_app
 USING(published_at IS NULL AND app_finance_has_capability(building_id,id::text,'finance:read')
   AND app_finance_has_capability(building_id,id::text,'finance:manage'))
 WITH CHECK(app_finance_has_capability(building_id,id::text,'finance:read') AND app_finance_has_capability(building_id,id::text,'finance:manage')
   AND ((published_at IS NULL AND published_by IS NULL) OR (published_at<=clock_timestamp() AND published_by=app_current_user_id()
     AND app_finance_can_publish_revision(building_id,id::text))));
REVOKE UPDATE,DELETE ON financial_reports FROM predioon_app;
GRANT UPDATE(title,summary,opening_balance_cents,entries,version,published_by,published_at,updated_at) ON financial_reports TO predioon_app;

DROP POLICY IF EXISTS building_features_finance_read ON building_feature_settings;
CREATE POLICY building_features_finance_read ON building_feature_settings FOR SELECT TO predioon_app
 USING(app_finance_can_read_feature_state(building_id));
DROP POLICY IF EXISTS feature_runtime_finance_read ON feature_runtime;
CREATE POLICY feature_runtime_finance_read ON feature_runtime FOR SELECT TO predioon_app
 USING(app_finance_can_read_feature_state(building_id));
DO $$ DECLARE definition text; anchor text; BEGIN
 SELECT pg_get_functiondef('app_can_read_feature_event(text)'::regprocedure) INTO STRICT definition;
 anchor:='OR app_equipment_can_read_scope(b.id,''gateway'')';
 IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'Unexpected feature event function shape'; END IF;
 definition:=replace(definition,'OR app_finance_can_read_feature_state(b.id)','');
 EXECUTE replace(definition,anchor,anchor || E'\n     OR app_finance_can_read_feature_state(b.id)');
END $$;
DO $$ DECLARE expression text; branches text; action_name text; BEGIN
 SELECT pg_get_expr(polwithcheck,polrelid) INTO STRICT expression FROM pg_policy
 WHERE polrelid='audit_logs'::regclass AND polname='audit_logs_insert_policy';
 IF expression NOT LIKE '%CASE action%' OR expression NOT LIKE '%ELSE%' THEN RAISE EXCEPTION 'Unexpected audit policy shape'; END IF;
 branches:=$branches$
 WHEN 'FINANCIAL_DRAFT_CREATED'::text THEN resource_type='financial_report' AND building_id IS NOT NULL
   AND app_finance_has_capability(building_id,resource_id,'finance:read') AND app_finance_has_capability(building_id,resource_id,'finance:manage')
 WHEN 'FINANCIAL_DRAFT_UPDATED'::text THEN resource_type='financial_report' AND building_id IS NOT NULL
   AND app_finance_has_capability(building_id,resource_id,'finance:read') AND app_finance_has_capability(building_id,resource_id,'finance:manage')
 WHEN 'FINANCIAL_REPORT_PUBLISHED'::text THEN resource_type='financial_report' AND building_id IS NOT NULL
   AND app_finance_has_capability(building_id,resource_id,'finance:read') AND app_finance_has_capability(building_id,resource_id,'finance:manage')
 $branches$;
 FOREACH action_name IN ARRAY ARRAY['FINANCIAL_DRAFT_CREATED','FINANCIAL_DRAFT_UPDATED','FINANCIAL_REPORT_PUBLISHED'] LOOP
   expression:=regexp_replace(expression,'WHEN ''' || action_name || '''::text THEN .*?(?=WHEN |ELSE)','','ns');
 END LOOP;
 EXECUTE 'ALTER POLICY audit_logs_insert_policy ON audit_logs WITH CHECK (' || regexp_replace(expression,'ELSE',branches || ' ELSE') || ')';
END $$;
DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_finance_has_capability(text,text,text)'::regprocedure,'app_finance_can_read(text,text)'::regprocedure,
   'app_finance_can_read_scope(text)'::regprocedure,'app_finance_can_read_feature_state(text)'::regprocedure,
   'app_finance_can_publish_revision(text,text)'::regprocedure,'app_can_read_feature_event(text)'::regprocedure
 ] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
     JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper);
 END LOOP;
END $$;
