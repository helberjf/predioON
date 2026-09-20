-- Prédio ON: common areas and reservations.
-- Applied after drizzle-kit push creates the tables.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Two confirmed/pending bookings can never overlap on the same area.
-- Checking this in application code loses the race between two concurrent requests.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_no_overlap;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (
    area_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED'));

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_valid_period;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_valid_period CHECK (ends_at > starts_at);

ALTER TABLE common_areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS common_areas_read_policy ON common_areas;
CREATE POLICY common_areas_read_policy ON common_areas
FOR SELECT
USING (app_can_access_building(building_id));

DROP POLICY IF EXISTS common_areas_write_policy ON common_areas;
CREATE POLICY common_areas_write_policy ON common_areas
FOR ALL
USING (app_is_building_admin(building_id))
WITH CHECK (app_is_building_admin(building_id));

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reservations_scope_policy ON reservations;
DROP POLICY IF EXISTS reservations_read_policy ON reservations;
-- Residents see the building's calendar (to know what is taken) but may only touch their own bookings.
CREATE POLICY reservations_read_policy ON reservations
FOR SELECT
USING (app_can_access_building(building_id));

DROP POLICY IF EXISTS reservations_write_policy ON reservations;
CREATE POLICY reservations_write_policy ON reservations
FOR ALL
USING (app_is_building_admin(building_id) OR user_id = app_current_user_id())
WITH CHECK (app_is_building_admin(building_id) OR user_id = app_current_user_id());
