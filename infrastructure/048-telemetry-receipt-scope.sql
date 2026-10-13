-- Telemetry receipt hardening. The event identity becomes the triple the
-- firmware can actually guarantee, (building, device, eventId): two condominiums
-- may reuse an eventId without one silently discarding the other's reading.
-- A fingerprint of the accepted content tells a retransmission apart from a
-- different body sent under the same identity. Rows written before this
-- migration keep a NULL fingerprint and still suppress their own identity.
ALTER TABLE ingest_events ADD COLUMN IF NOT EXISTS fingerprint text;

DO $$ DECLARE key_columns text[]; BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ingest_events'::regclass AND conname='ingest_events_fingerprint_ck') THEN
    ALTER TABLE ingest_events ADD CONSTRAINT ingest_events_fingerprint_ck CHECK (fingerprint IS NULL OR fingerprint ~ '^[0-9a-f]{64}$');
  END IF;
  SELECT array_agg(a.attname::text ORDER BY k.ordinality) INTO key_columns
    FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
    WHERE c.conrelid='public.ingest_events'::regclass AND c.contype='p';
  IF key_columns IS DISTINCT FROM ARRAY['building_id','device_id','event_id'] THEN
    -- The old key was event_id alone, so every existing row is already unique under the wider key.
    ALTER TABLE ingest_events DROP CONSTRAINT IF EXISTS ingest_events_pkey;
    ALTER TABLE ingest_events ADD CONSTRAINT ingest_events_pkey PRIMARY KEY (building_id, device_id, event_id);
  END IF;
END $$;

-- What the receiver refused or set aside, as bounded counters: one row per day,
-- category and, only when the source was validated, condominium. No payload,
-- topic, event or device identifier is kept.
CREATE TABLE IF NOT EXISTS ingest_rejections (
  day date NOT NULL,
  building_id text NOT NULL DEFAULT '',
  category text NOT NULL,
  total bigint NOT NULL DEFAULT 1,
  last_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ingest_rejections_pkey PRIMARY KEY (day, building_id, category),
  CONSTRAINT ingest_rejections_category_ck CHECK (category IN ('INVALID_ENVELOPE','FUTURE_TIMESTAMP','UNKNOWN_SOURCE','CONTENT_CONFLICT','RETAINED_REPLAY')),
  CONSTRAINT ingest_rejections_total_ck CHECK (total > 0)
);

ALTER TABLE ingest_rejections ENABLE ROW LEVEL SECURITY;
-- Written by the ingestion service and read by the operator; no API runtime role reaches it.
REVOKE ALL ON TABLE ingest_rejections FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth, predioon_notifications;
