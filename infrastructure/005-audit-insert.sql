-- Audit records are append-only and must identify the authenticated actor.
DROP POLICY IF EXISTS audit_logs_insert_policy ON audit_logs;
CREATE POLICY audit_logs_insert_policy ON audit_logs
FOR INSERT
WITH CHECK (
  user_id = app_current_user_id()
  AND actor_type = 'USER'
  AND (
    app_is_platform_admin()
    OR (building_id IS NOT NULL AND app_can_access_building(building_id))
  )
);
REVOKE UPDATE, DELETE ON audit_logs FROM predioon_app;
