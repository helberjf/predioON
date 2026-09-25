import { assertSensorFeatures, buildingFeatures, observationIsCurrent, sensorFeatureKeys } from "../../auth/features.js";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { devices } from "@predioon/db";
import { assertBuildingAccess, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import { query, validateQuery } from "../../http/validate.js";

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
  assertBuildingAccess(currentAuth(req), buildingId);

  const rows = await inTenantContext(req, async (tx) => {
    const features = await buildingFeatures(tx, buildingId);
    const result = await tx.execute(sql`
      SELECT DISTINCT ON (t.device_id, t.metric)
             t.device_id, d.name AS device_name, t.metric, t.value,
             t.numeric_value, t.unit, t.quality, t.time
      FROM telemetry t
      JOIN devices d ON d.id = t.device_id
      WHERE t.building_id = ${buildingId}
        AND t.time > now() - interval '7 days'
      ORDER BY t.device_id, t.metric, t.time DESC
    `);
    const visible: LatestRow[] = [];
    for (const row of result as unknown as LatestRow[]) {
      const keys = await sensorFeatureKeys(tx, { buildingId, deviceId: row.device_id, metric: row.metric });
      if (observationIsCurrent(features, keys, row.time)) visible.push(row);
    }
    return visible;
  });

  res.json({ items: rows });
});

telemetryRouter.get("/series", validateQuery(SeriesQuerySchema), async (req, res) => {
  const { deviceId, metric, from, to, bucket } = query<z.infer<typeof SeriesQuerySchema>>(req);
  const auth = currentAuth(req);
  const interval = BUCKETS[bucket];
  const start = from ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const end = to ?? new Date();

  const rows = await inTenantContext(req, async (tx) => {
    const [device] = await tx.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
    if (!device) throw notFound("Dispositivo não encontrado");
    assertBuildingAccess(auth, device.buildingId);
    await assertSensorFeatures(tx, { buildingId: device.buildingId, deviceId, metric });

    const result = await tx.execute(sql`
      SELECT time_bucket(${interval}::interval, time) AS bucket,
             avg(numeric_value) AS avg_value,
             min(numeric_value) AS min_value,
             max(numeric_value) AS max_value,
             count(*)           AS samples
      FROM telemetry
      WHERE device_id = ${deviceId}
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
