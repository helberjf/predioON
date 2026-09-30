import { Router } from "express";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { alerts } from "@predioon/db/runtime";
import { z } from "zod";
import { assertBuildingAccess, currentAuth, inTenantContext, requireRole } from "../../auth/middleware.js";
import { query, validateQuery } from "../../http/validate.js";
import { buildingFeatures, filterSensorRows } from "../../auth/features.js";
import { forbidden } from "../../http/errors.js";

export const overviewRouter = Router();

const BuildingQuerySchema = z.object({ buildingId: z.string().min(1) });

/** Platform-wide counters. RLS keeps the numbers honest even if the role check ever changes. */
overviewRouter.get("/platform", requireRole("PLATFORM_ADMIN"), async (req, res) => {
  const payload = await inTenantContext(req, async (tx) => {
    const [admin] = await tx.execute(sql`select app_support_admin() as allowed`);
    if (!admin?.allowed) throw forbidden();
    const [counts] = (await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM organizations WHERE active)                    AS organizations,
        (SELECT count(*) FROM buildings WHERE active)                        AS buildings,
        (SELECT count(*) FROM gateways)                                      AS gateways,
        (SELECT count(*) FROM gateways WHERE status = 'ONLINE')              AS gateways_online,
        (SELECT count(*) FROM devices)                                       AS devices,
        (SELECT count(*) FROM devices WHERE status = 'ONLINE')               AS devices_online,
        (SELECT count(*) FROM alerts WHERE status <> 'RESOLVED')             AS open_alerts,
        (SELECT count(*) FROM alerts WHERE status <> 'RESOLVED'
           AND severity IN ('HIGH','CRITICAL'))                              AS critical_alerts,
        (SELECT count(*) FROM users WHERE active)                            AS users
    `)) as unknown as Array<Record<string, number>>;

    const buildings = await tx.execute(sql`
      SELECT b.id, b.name, b.code, o.name AS organization_name,
             count(DISTINCT g.id)                                              AS gateways,
             count(DISTINCT g.id) FILTER (WHERE g.status = 'ONLINE')           AS gateways_online,
             count(DISTINCT d.id)                                              AS devices,
             count(DISTINCT a.id) FILTER (WHERE a.status <> 'RESOLVED')        AS open_alerts
      FROM buildings b
      JOIN organizations o ON o.id = b.organization_id
      LEFT JOIN gateways g ON g.building_id = b.id
      LEFT JOIN devices  d ON d.building_id = b.id
      LEFT JOIN alerts   a ON a.building_id = b.id
      GROUP BY b.id, b.name, b.code, o.name
      ORDER BY open_alerts DESC, b.name
    `);

    const visibleAlerts = await filterSensorRows(tx, await tx.select().from(alerts).where(ne(alerts.status, "RESOLVED")));
    return { counts: { ...counts, open_alerts: visibleAlerts.length, critical_alerts: visibleAlerts.filter(alert => ["HIGH", "CRITICAL"].includes(alert.severity)).length },
      buildings: buildings.map(building => ({ ...building, open_alerts: visibleAlerts.filter(alert => alert.buildingId === building.id).length })) };
  });

  res.json(payload);
});

/** Everything the síndico's home screen needs, in one round trip. */
overviewRouter.get("/building", validateQuery(BuildingQuerySchema), async (req, res) => {
  const { buildingId } = query<z.infer<typeof BuildingQuerySchema>>(req);
  assertBuildingAccess(currentAuth(req), buildingId);

  const payload = await inTenantContext(req, async (tx) => {
    const features = await buildingFeatures(tx, buildingId);
    const [counts] = (await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM devices  WHERE building_id = ${buildingId})                      AS devices,
        (SELECT count(*) FROM devices  WHERE building_id = ${buildingId}
           AND status = 'ONLINE')                                                              AS devices_online,
        (SELECT count(*) FROM gateways WHERE building_id = ${buildingId})                      AS gateways,
        (SELECT count(*) FROM gateways WHERE building_id = ${buildingId}
           AND status = 'ONLINE')                                                              AS gateways_online,
        (SELECT count(*) FROM alerts   WHERE building_id = ${buildingId}
           AND status <> 'RESOLVED')                                                           AS open_alerts,
        (SELECT count(*) FROM occurrences WHERE building_id = ${buildingId}
           AND status NOT IN ('DONE','CANCELLED'))                                             AS open_occurrences
    `)) as unknown as Array<Record<string, number>>;

    const visibleAlerts = await filterSensorRows(tx, await tx.select().from(alerts).where(and(eq(alerts.buildingId, buildingId), ne(alerts.status, "RESOLVED"))).orderBy(desc(alerts.triggeredAt)));
    const latestAlerts = visibleAlerts.slice(0, 10).map(alert => ({ id: alert.id, device_id: alert.deviceId, severity: alert.severity, type: alert.type, status: alert.status, message: alert.message, triggered_at: alert.triggeredAt }));

    const gateways = await tx.execute(sql`
      SELECT id, name, status, last_seen_at
      FROM gateways
      WHERE building_id = ${buildingId}
      ORDER BY name
    `);

    return { buildingId, counts: { ...counts, open_alerts: visibleAlerts.length, open_occurrences: features.TICKETS.enabled ? counts?.open_occurrences ?? 0 : 0 }, latestAlerts, gateways };
  });

  res.json(payload);
});
