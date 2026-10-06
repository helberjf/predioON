-- Editing, deactivating or reactivating a block, unit or team is audited with
-- the same proof as its creation:
-- the actor manages that condominium now and the record belongs to it.
-- Alter exactly these three branches; owner, ACL, other branches and the audit
-- policies are retained. Table privileges and RLS already cover the UPDATE.
DO $$
DECLARE definition text; pair text[]; changed boolean := false;
BEGIN
 SELECT pg_get_functiondef('app_audit_legacy_insert(text,text,text,text)'::regprocedure) INTO STRICT definition;
 FOREACH pair SLICE 1 IN ARRAY ARRAY[
  ['BLOCK','block'], ['UNIT','unit'], ['TEAM','team']
 ] LOOP
  DECLARE
   old_marker constant text := format('WHEN action_name=%L AND target_type=%L THEN', pair[1] || '_CREATED', pair[2]);
   new_marker constant text := format('WHEN action_name IN (%L,%L,%L,%L) AND target_type=%L THEN', pair[1] || '_CREATED', pair[1] || '_UPDATED',
     pair[1] || '_DEACTIVATED', pair[1] || '_REACTIVATED', pair[2]);
  BEGIN
   IF position(old_marker IN definition)>0 AND position(new_marker IN definition)=0
      AND position(old_marker IN substring(definition FROM position(old_marker IN definition)+1))=0 THEN
    definition := replace(definition, old_marker, new_marker);
    changed := true;
   ELSIF position(old_marker IN definition)>0 OR position(new_marker IN definition)=0 THEN
    -- Fail closed for a missing, duplicated or half-migrated branch.
    RAISE EXCEPTION 'Unexpected % audit branch', pair[2];
   END IF;
  END;
 END LOOP;
 IF changed THEN EXECUTE definition; END IF;
END $$;
