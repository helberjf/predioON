-- Gate opening and parking counting are opt-in. A new installation starts with
-- the four features switched off for the whole platform; the platform
-- administrator turns them on in "Funcionalidades" when a condominium really
-- has the equipment. Every other feature keeps the rule of migration 012:
-- no setting means enabled.
--
-- Only an installation without condominiums is changed here. Where condominiums
-- already exist, switching a feature off has effects (pending gate commands are
-- cancelled, parking occupancy is cleared) that belong to the audited transition
-- run by the API, so that is done from the administration screen, not by this file.
INSERT INTO global_feature_settings(feature_key, enabled)
SELECT feature_key, false
FROM unnest(ARRAY['GARAGE_ACCESS','PEDESTRIAN_ACCESS','CAR_PARKING','MOTORCYCLE_PARKING']) AS feature_key
WHERE NOT EXISTS (SELECT 1 FROM buildings)
ON CONFLICT (feature_key) DO NOTHING;
