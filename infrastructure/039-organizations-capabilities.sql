-- Global commercial authorization. Apply atomically; the legacy flag remains
-- one platform-role source from 021, never a bypass of current permissions.
WITH initial_install AS (
 SELECT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='organizations'::regclass
   AND polname='organizations_scope_policy') AS first_install
), created_permissions AS (
 INSERT INTO permissions(key,resource_type,action,label)
 SELECT desired.* FROM (VALUES
  ('organizations:read','organization','read','Consultar organizações comerciais'),
  ('organizations:manage','organization','manage','Gerenciar organizações comerciais')
 ) desired(key,resource_type,action,label) CROSS JOIN initial_install i WHERE i.first_install
 ON CONFLICT(key) DO NOTHING RETURNING key
)
INSERT INTO role_permissions(role_key,permission_key)
 SELECT 'PLATFORM_ADMIN',key FROM created_permissions ON CONFLICT DO NOTHING;

-- Preserve the final 036 whitelist and the statement-clock/live catalog checks.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('app_has_global_capability_at(text,timestamptz)'::regprocedure) INTO STRICT definition;
 IF position('''organizations:read''' IN definition)=0 AND position('''organizations:manage''' IN definition)=0 THEN
  IF regexp_count(definition,'''audit:read-platform''')<>1 THEN RAISE EXCEPTION 'Unexpected global capability whitelist'; END IF;
  EXECUTE replace(definition,'''audit:read-platform''','''audit:read-platform'',''organizations:read'',''organizations:manage''');
 ELSIF position('''organizations:read''' IN definition)=0 OR position('''organizations:manage''' IN definition)=0 THEN
  RAISE EXCEPTION 'Incomplete organization capability whitelist';
 END IF;
END $$;

DROP POLICY IF EXISTS organizations_scope_policy ON organizations;
DROP POLICY IF EXISTS organizations_capability_read ON organizations;
CREATE POLICY organizations_capability_read ON organizations FOR SELECT TO predioon_app
 USING(app_has_global_capability('organizations:read'));
DROP POLICY IF EXISTS organizations_capability_insert ON organizations;
CREATE POLICY organizations_capability_insert ON organizations FOR INSERT TO predioon_app
 WITH CHECK(app_has_global_capability('organizations:read') AND app_has_global_capability('organizations:manage'));
DROP POLICY IF EXISTS organizations_capability_update ON organizations;
CREATE POLICY organizations_capability_update ON organizations FOR UPDATE TO predioon_app
 USING(app_has_global_capability('organizations:read') AND app_has_global_capability('organizations:manage'))
 WITH CHECK(app_has_global_capability('organizations:read') AND app_has_global_capability('organizations:manage'));

-- Explicit HTTP insert columns keep creation timestamps and active=true as defaults.
REVOKE INSERT,UPDATE,DELETE ON organizations FROM predioon_app;
REVOKE INSERT(id,name,slug,active,metadata,created_at,updated_at),
 UPDATE(id,name,slug,active,metadata,created_at,updated_at) ON organizations FROM predioon_app;
GRANT SELECT ON organizations TO predioon_app;
GRANT INSERT(id,name,slug,metadata) ON organizations TO predioon_app;
GRANT UPDATE(name,slug,active,metadata,updated_at) ON organizations TO predioon_app;
REVOKE ALL ON FUNCTION app_can_access_organization(text)
 FROM PUBLIC,predioon_app,predioon_identity,predioon_broker_auth,predioon_notifications;

-- Alter exactly the organization branch in each independent audit proof.
-- Existing owner, ACL, other branches and policy expressions are retained.
DO $$
DECLARE signature text; definition text; branch_start integer; branch_end integer;
 old_branch text; new_branch text;
 marker constant text := 'WHEN action_name IN (''ORGANIZATION_CREATED'',''ORGANIZATION_UPDATED'') AND target_type=''organization'' THEN';
 next_marker constant text := 'WHEN action_name=''USER_CREATED''';
 authority constant text := '(app_has_global_capability(''organizations:read'') AND app_has_global_capability(''organizations:manage''))';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'app_audit_legacy_insert(text,text,text,text)',
  'app_audit_platform_insert(text,text,text,text,text)'
 ] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO STRICT definition;
  branch_start := position(marker IN definition);
  IF branch_start=0 THEN RAISE EXCEPTION 'Missing organization audit branch'; END IF;
  branch_end := position(next_marker IN substring(definition FROM branch_start));
  IF branch_end=0 THEN RAISE EXCEPTION 'Unexpected organization audit branch boundary'; END IF;
  old_branch := substring(definition FROM branch_start FOR branch_end-1);
  IF regexp_count(old_branch,'app_audit_legacy_platform_actor\(\)')=1 THEN
   new_branch := replace(old_branch,'app_audit_legacy_platform_actor()',authority);
   EXECUTE overlay(definition PLACING new_branch FROM branch_start FOR length(old_branch));
  ELSIF position(authority IN old_branch)=0 OR position('app_audit_legacy_platform_actor' IN old_branch)>0 THEN
   RAISE EXCEPTION 'Unexpected organization audit authority';
  END IF;
 END LOOP;
END $$;
