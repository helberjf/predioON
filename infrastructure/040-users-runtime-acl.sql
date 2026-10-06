-- The API reads public account fields and still supports legacy account INSERT.
-- Credential reads and replacement belong to the separate identity runtime.
-- Keep RLS, SECURITY DEFINER helpers and every other principal unchanged.
REVOKE SELECT, UPDATE, DELETE ON TABLE public.users FROM predioon_app;

-- Table REVOKE does not remove previously granted column privileges. Clear
-- both classes explicitly, including any residual grant on a non-public field.
DO $$
DECLARE column_name text;
BEGIN
  FOR column_name IN
    SELECT attname FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.users'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%I), UPDATE (%I) ON TABLE public.users FROM predioon_app', column_name, column_name);
  END LOOP;
END $$;

GRANT SELECT (id, name, email, phone, is_platform_admin, active, created_at)
  ON TABLE public.users TO predioon_app;

-- Do not narrow INSERT to columns here: the existing Drizzle INSERT includes
-- DEFAULTs for the remaining columns. Its authorization still comes from RLS.
