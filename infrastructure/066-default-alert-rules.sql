-- Additive and repeatable. Existing rules and activation choices are preserved.
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS template_key text;
CREATE UNIQUE INDEX IF NOT EXISTS alert_rules_building_template_uq
  ON alert_rules (building_id, template_key);

CREATE OR REPLACE FUNCTION seed_default_alert_rules(target_building_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Serializes repeated provisioning for the same tenant, including parallel seeds.
  PERFORM pg_advisory_xact_lock(hashtextextended('default-alert-rules:' || target_building_id, 0));

  WITH templates (key, name, metric, operator, threshold, severity, alert_type, message_template, cooldown_seconds) AS (
    VALUES
      ('low-water', 'Nível baixo da caixa', 'water_level_percent', 'LT', 20, 'HIGH', 'LOW_WATER_LEVEL', 'Nível baixo da caixa d''água: {value}%', 900),
      ('critical-water', 'Nível crítico da caixa', 'water_level_percent', 'LT', 10, 'CRITICAL', 'CRITICAL_WATER_LEVEL', 'Nível crítico da caixa d''água: {value}%', 600),
      ('gas', 'Gás detectado', 'gas_detected', 'EQ', 1, 'CRITICAL', 'GAS_DETECTED', 'Gás detectado. Verifique o local e siga o procedimento do condomínio.', 300),
      ('smoke', 'Alarme da central de incêndio', 'smoke_detected', 'EQ', 1, 'CRITICAL', 'SMOKE_DETECTED', 'Alarme da central de incêndio. Siga o procedimento do condomínio.', 300),
      ('water-leak', 'Vazamento de água detectado', 'water_leak_detected', 'EQ', 1, 'HIGH', 'WATER_LEAK_DETECTED', 'Vazamento de água detectado. Verifique o local.', 300),
      ('sewage-leak', 'Vazamento de esgoto detectado', 'sewage_leak_detected', 'EQ', 1, 'HIGH', 'SEWAGE_LEAK_DETECTED', 'Vazamento de esgoto detectado. Verifique o local.', 300),
      ('temperature', 'Temperatura alta na sala técnica', 'temperature_c', 'GT', 45, 'MEDIUM', 'HIGH_TEMPERATURE', 'Temperatura da sala técnica em {value} °C', 1800)
    UNION ALL
    SELECT voltage.key || '-' || phase,
      voltage.name || CASE WHEN voltage.key = 'phase-loss' THEN ' ' ELSE ' na fase ' END || upper(phase),
      'voltage_' || phase, voltage.operator, voltage.threshold, 'CRITICAL',
      voltage.alert_type || '_' || upper(phase),
      voltage.name || CASE WHEN voltage.key = 'phase-loss' THEN ' ' ELSE ' na fase ' END || upper(phase) || ': {value} V', 300
    FROM (VALUES
      ('low-voltage', 'Subtensão', 'LT', 180, 'LOW_VOLTAGE'),
      ('high-voltage', 'Sobretensão', 'GT', 260, 'HIGH_VOLTAGE'),
      ('phase-loss', 'Falta de fase', 'LT', 100, 'PHASE_LOSS')
    ) AS voltage(key, name, operator, threshold, alert_type)
    CROSS JOIN unnest(ARRAY['l1', 'l2', 'l3']) AS phases(phase)
  )
  INSERT INTO public.alert_rules
    (building_id, template_key, device_id, name, metric, operator, threshold, severity,
     alert_type, message_template, cooldown_seconds, enabled)
  SELECT target_building_id, template.key, NULL, template.name, template.metric,
    template.operator::public.alert_operator, template.threshold,
    template.severity::public.alert_severity, template.alert_type,
    template.message_template, template.cooldown_seconds, false
  FROM templates template
  WHERE NOT EXISTS (
    SELECT 1 FROM public.alert_rules saved
    WHERE saved.building_id = target_building_id
      AND (saved.template_key = template.key OR saved.name = template.name
        OR (saved.metric = template.metric AND saved.operator::text = template.operator
          AND saved.threshold = template.threshold))
  )
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION provision_building_alert_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.seed_default_alert_rules(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS buildings_default_alert_rules ON buildings;
CREATE TRIGGER buildings_default_alert_rules
  AFTER INSERT ON buildings
  FOR EACH ROW EXECUTE FUNCTION provision_building_alert_rules();

-- Only the migration/seed owner can provision arbitrary buildings. The API
-- cannot call these functions or write template_key. Its authorized building
-- INSERT fires the owner trigger for NEW.id, without weakening existing RLS.
REVOKE ALL ON FUNCTION seed_default_alert_rules(text), provision_building_alert_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION seed_default_alert_rules(text), provision_building_alert_rules() FROM predioon_app;

-- Covers all existing tenants, including buildings without any equipment.
SELECT seed_default_alert_rules(id) FROM buildings ORDER BY id;
