-- Evaluate the user's active memberships once per query, not once per sensor sample.
-- Same membership/time semantics as app_can_access_building, with an uncorrelated subplan.
DROP POLICY IF EXISTS telemetry_scope_policy ON telemetry;
CREATE POLICY telemetry_scope_policy ON telemetry
FOR SELECT
USING (
  (SELECT app_is_platform_admin())
  OR building_id IN (
    SELECT m.building_id
    FROM memberships m
    WHERE m.user_id = (SELECT app_current_user_id())
      AND m.active = TRUE
      AND (m.starts_at IS NULL OR m.starts_at <= now())
      AND (m.ends_at IS NULL OR m.ends_at > now())
  )
);
