import { featureDisabled, observationIsCurrent } from "../../auth/features.js";
import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { readFeatures } from "@predioon/db/runtime";
import { inTenantContext } from "../../auth/middleware.js";
import { forbidden, notFound } from "../../http/errors.js";
import { query, validateQuery } from "../../http/validate.js";
import { authorizedTelemetryDevices, telemetryFeatureKeys } from "./authorization.js";

export const telemetryRouter = Router();

/** Whitelisted buckets: the value is interpolated into an interval, so it can never come raw from the client. */
const BUCKETS = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "1h": "1 hour",
  "1d": "1 day",
} as const;

const LatestQuerySchema = z.object({ buildingId: z.string().min(1) });

const SeriesQuerySchema = z.object({
  deviceId: z.string().min(1),
  metric: z.string().min(1),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  bucket: z.enum(Object.keys(BUCKETS) as [keyof typeof BUCKETS]).default("1h"),
});

type LatestRow = {
  device_id: string;
  device_name: string;
  metric: string;
  value: unknown;
  numeric_value: number | null;
  unit: string | null;
  quality: string;
  time: string;
};

/** One row per device+metric with the most recent reading. DISTINCT ON is the cheapest way on Timescale. */
telemetryRouter.get("/latest", validateQuery(LatestQuerySchema), async (req, res) => {
  const { buildingId } = query<z.infer<typeof LatestQuerySchema>>(req);
  const rows = await inTenantContext(req, async (tx) => {
    const rawDevices = await authorizedTelemetryDevices(tx, buildingId);
    const publishedDevices = await authorizedTelemetryDevices(tx, buildingId, "telemetry:read-published");
    if (!rawDevices.length && !publishedDevices.length) {
      const [scope] = await tx.execute(sql`select
        app_has_capability(${buildingId},'telemetry:read') OR
        app_has_capability(${buildingId},'telemetry:read-published') as allowed`);
      if (!scope?.allowed) throw forbidden("Sem a capacidade necessária para telemetria");
    }
    // Capability authorization precedes feature reads, all under the transaction's shared lock.
    const features = await readFeatures(tx, buildingId);
    const result = await tx.execute(sql`
      SELECT DISTINCT ON (t.device_id, t.metric)
             t.device_id, d.device_name, t.metric, t.value,
             t.numeric_value, t.unit, t.quality, t.time
      FROM telemetry t
      JOIN app_telemetry_authorized_devices(${buildingId}) d
        ON d.device_id = t.device_id AND d.building_id = t.building_id
      WHERE t.building_id = ${buildingId}
        AND t.time > now() - interval '7 days'
      ORDER BY t.device_id, t.metric, t.time DESC, t.id DESC
    `);
    const rawById = new Map(rawDevices.map(device => [device.device_id, device]));
    const visible = new Map<string, LatestRow>();
    for (const row of result as unknown as LatestRow[]) {
      const device = rawById.get(row.device_id);
      if (device && observationIsCurrent(features, telemetryFeatureKeys(device, row.metric), row.time)) visible.set(`${row.device_id}:${row.metric}`, row);
    }
    const published = await tx.execute(sql`select * from app_published_water_levels(${buildingId})`);
    for (const row of published as unknown as LatestRow[]) {
      const key = `${row.device_id}:${row.metric}`;
      if (!visible.has(key) && observationIsCurrent(features, ["WATER_TANK"], row.time)) visible.set(key, row);
    }
    return [...visible.values()];
  });

  res.json({ items: rows });
});

telemetryRouter.get("/series", validateQuery(SeriesQuerySchema), async (req, res) => {
  const { deviceId, metric, from, to, bucket } = query<z.infer<typeof SeriesQuerySchema>>(req);
  const interval = BUCKETS[bucket];
  const start = from ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const end = to ?? new Date();

  const rows = await inTenantContext(req, async (tx) => {
    const [device] = await tx.execute(sql`select * from app_telemetry_authorized_devices(null) where device_id=${deviceId}`) as unknown as Awaited<ReturnType<typeof authorizedTelemetryDevices>>;
    if (!device) throw notFound("Dispositivo não encontrado");
    const features = await readFeatures(tx, device.building_id);
    for (const key of telemetryFeatureKeys(device, metric)) if (!features[key].enabled) throw featureDisabled(key);

    const result = await tx.execute(sql`
      SELECT time_bucket(${interval}::interval, time) AS bucket,
             avg(numeric_value) AS avg_value,
             min(numeric_value) AS min_value,
             max(numeric_value) AS max_value,
             count(*)           AS samples
      FROM telemetry
      WHERE device_id = ${deviceId}
        AND building_id = ${device.building_id}
        AND metric = ${metric}
        AND time >= ${start.toISOString()}
        AND time <= ${end.toISOString()}
      GROUP BY bucket
      ORDER BY bucket
    `);
    return result;
  });

  res.json({ deviceId, metric, bucket, from: start.toISOString(), to: end.toISOString(), items: rows });
});
