-- Prédio ON: human-readable ticket protocol.
-- A sequence keeps protocols short and unique without a race between concurrent inserts.

CREATE SEQUENCE IF NOT EXISTS occurrence_protocol_seq START 1000;

CREATE OR REPLACE FUNCTION next_occurrence_protocol()
RETURNS text
LANGUAGE sql
AS $$
  SELECT nextval('occurrence_protocol_seq')::text;
$$;

GRANT USAGE, SELECT ON SEQUENCE occurrence_protocol_seq TO predioon_app;
