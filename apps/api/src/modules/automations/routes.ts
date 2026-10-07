import { Router, type Request } from "express";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppTransaction } from "@predioon/db/runtime";
import { assertCapability, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { isoTime } from "../../http/sql-time.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const automationsRouter = Router();
automationsRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const id = z.string().uuid();
const buildingId = z.string().trim().min(1).max(128);
const version = z.number().int().positive();
const name = z.string().trim().min(1).max(120);
// The only action is opening a work order. No definition can request a physical command.
const Definition = z.object({
  alertTypes: z.array(z.string().trim().min(1).max(80)).max(20).default([]).refine(types => new Set(types).size === types.length, "Tipos de alerta repetidos"),
  minSeverity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("INFO"),
  deviceId: z.string().min(1).max(128).nullable().default(null),
  orderTitle: z.string().trim().min(1).max(160),
  orderPriority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  assignedTeamId: id.nullable().default(null),
  assetId: id.nullable().default(null),
  cooldownMinutes: z.number().int().min(0).max(10080).default(60),
}).strict();
const List = z.object({ buildingId });
const Create = z.object({ buildingId, name, definition: Definition }).strict();
const AddVersion = z.object({ version, definition: Definition }).strict();
const Publish = z.object({ version, number: z.number().int().positive() }).strict();
const State = z.object({ version, enabled: z.boolean() }).strict();
const Simulate = z.object({ number: z.number().int().positive() }).strict();

type Rule = { id: string; buildingId: string; name: string; enabled: boolean; publishedVersion: number | null; version: number };
const ruleView = sql`r.id, r.building_id as "buildingId", r.name, r.enabled, r.published_version as "publishedVersion", r.version,
  ${isoTime(sql`r.created_at`)} as "createdAt", ${isoTime(sql`r.updated_at`)} as "updatedAt",
  (select max(v.number) from automation_versions v where v.automation_id=r.id) as "latestVersion",
  (select count(*)::int from automation_runs n where n.automation_id=r.id and n.outcome='CREATED') as "ordersCreated"`;
const versionView = sql`v.number, v.alert_types as "alertTypes", v.min_severity as "minSeverity", v.device_id as "deviceId", v.order_title as "orderTitle",
  v.order_priority as "orderPriority", v.assigned_team_id as "assignedTeamId", v.asset_id as "assetId", v.cooldown_minutes as "cooldownMinutes",
  ${isoTime(sql`v.created_at`)} as "createdAt"`;

async function inAutomations<T>(req: Request, run: (tx: AppTransaction) => Promise<T>): Promise<T> {
  try { return await inTenantContext(req, run); }
  catch (error) {
    const code = pgErrorCode(error);
    if (code === "42501") throw forbidden("Sem a permissão necessária para esta automação");
    if (code === "23503" || code === "23514") throw badRequest("Equipamento, equipe, ativo ou versão inválidos para este condomínio");
    if (code === "P0409" || code === "40001" || code === "23505") throw conflict("A automação foi alterada. Recarregue antes de tentar novamente.");
    throw error;
  }
}
const rows = async <T>(tx: AppTransaction, statement: SQL) => await tx.execute(statement) as unknown as T[];
function ruleId(req: Request): string {
  const parsed = id.safeParse(param(req, "id"));
  if (!parsed.success) throw notFound();
  return parsed.data;
}
async function visible(tx: AppTransaction, target: string): Promise<Rule> {
  const [rule] = await rows<Rule>(tx, sql`select ${ruleView} from automation_rules r where r.id=${target}`);
  if (!rule) throw notFound("Automação não encontrada");
  return rule;
}
const addVersion = (tx: AppTransaction, rule: { id: string; buildingId: string }, number: number, d: z.infer<typeof Definition>, actor: string) =>
  tx.execute(sql`insert into automation_versions(automation_id,building_id,number,alert_types,min_severity,device_id,order_title,order_priority,assigned_team_id,asset_id,cooldown_minutes,created_by)
    values(${rule.id},${rule.buildingId},${number},${sql`array[${sql.join(d.alertTypes.map(type => sql`${type}`), sql`,`)}]::text[]`},${d.minSeverity}::alert_severity,${d.deviceId},
      ${d.orderTitle},${d.orderPriority},${d.assignedTeamId}::uuid,${d.assetId}::uuid,${d.cooldownMinutes},${actor})`);
/** Every state change is versioned: a stale client is told to reload instead of overwriting. */
async function bump(tx: AppTransaction, target: string, expected: number, changes: SQL): Promise<Rule> {
  const [updated] = await rows<Rule>(tx, sql`update automation_rules as r set version=r.version+1, ${changes} where r.id=${target} and r.version=${expected} returning ${ruleView}`);
  if (!updated) throw conflict("A automação foi alterada. Recarregue antes de tentar novamente.");
  return updated;
}

automationsRouter.get("/", validateQuery(List), async (req, res) => {
  const q = query<z.infer<typeof List>>(req);
  res.json(await inAutomations(req, async tx => {
    await assertCapability(tx, "automations:read", q.buildingId);
    const [scope] = await rows<{ manage: boolean }>(tx, sql`select app_has_capability(${q.buildingId},'automations:manage') and app_has_capability(${q.buildingId},'work-orders:assign') as manage`);
    return { items: await rows<Rule>(tx, sql`select ${ruleView} from automation_rules r where r.building_id=${q.buildingId} order by r.name, r.id limit 200`), canManage: scope?.manage === true };
  }));
});

automationsRouter.post("/", validateBody(Create), async (req, res) => {
  const input = req.body as z.infer<typeof Create>;
  const actor = currentAuth(req).userId;
  const created = await inAutomations(req, async tx => {
    await assertCapability(tx, "automations:manage", input.buildingId);
    const [rule] = await rows<{ id: string; buildingId: string }>(tx, sql`insert into automation_rules(building_id,name,created_by) values(${input.buildingId},${input.name},${actor})
      returning id, building_id as "buildingId"`);
    await addVersion(tx, rule!, 1, input.definition, actor);
    await recordAudit(tx, req, { userId: actor, buildingId: input.buildingId, action: "AUTOMATION_CREATED", resourceType: "automation", resourceId: rule!.id });
    return visible(tx, rule!.id);
  });
  res.status(201).json(created);
});

automationsRouter.get("/:id", async (req, res) => {
  const target = ruleId(req);
  res.json(await inAutomations(req, async tx => {
    const rule = await visible(tx, target);
    const versions = await rows(tx, sql`select ${versionView} from automation_versions v where v.automation_id=${target} order by v.number desc`);
    const runs = await rows(tx, sql`select n.id, n.version_number as "versionNumber", n.alert_id as "alertId", n.outcome, n.work_order_id as "workOrderId", ${isoTime(sql`n.created_at`)} as "createdAt"
      from automation_runs n where n.automation_id=${target} order by n.created_at desc, n.id desc limit 20`);
    return { ...rule, versions, runs };
  }));
});

automationsRouter.post("/:id/versions", validateBody(AddVersion), async (req, res) => {
  const target = ruleId(req);
  const input = req.body as z.infer<typeof AddVersion>;
  const actor = currentAuth(req).userId;
  res.status(201).json(await inAutomations(req, async tx => {
    const rule = await visible(tx, target);
    await assertCapability(tx, "automations:manage", rule.buildingId);
    // Bumping the rule first serialises concurrent editors on its row.
    await bump(tx, target, input.version, sql`name=r.name`);
    const [latest] = await rows<{ number: number }>(tx, sql`select coalesce(max(number),0)::int as number from automation_versions where automation_id=${target}`);
    await addVersion(tx, rule, latest!.number + 1, input.definition, actor);
    await recordAudit(tx, req, { userId: actor, buildingId: rule.buildingId, action: "AUTOMATION_VERSION_ADDED", resourceType: "automation", resourceId: target, metadata: { number: latest!.number + 1 } });
    return visible(tx, target);
  }));
});

automationsRouter.post("/:id/publish", validateBody(Publish), async (req, res) => {
  const target = ruleId(req);
  const input = req.body as z.infer<typeof Publish>;
  const actor = currentAuth(req).userId;
  res.json(await inAutomations(req, async tx => {
    const rule = await visible(tx, target);
    await assertCapability(tx, "automations:manage", rule.buildingId);
    const updated = await bump(tx, target, input.version, sql`published_version=${input.number}`);
    await recordAudit(tx, req, { userId: actor, buildingId: rule.buildingId, action: "AUTOMATION_PUBLISHED", resourceType: "automation", resourceId: target, metadata: { number: input.number } });
    return updated;
  }));
});

automationsRouter.post("/:id/state", validateBody(State), async (req, res) => {
  const target = ruleId(req);
  const input = req.body as z.infer<typeof State>;
  const actor = currentAuth(req).userId;
  res.json(await inAutomations(req, async tx => {
    const rule = await visible(tx, target);
    await assertCapability(tx, "automations:manage", rule.buildingId);
    if (input.enabled && rule.publishedVersion === null) throw conflict("Publique uma versão antes de ativar a automação.");
    const updated = await bump(tx, target, input.version, sql`enabled=${input.enabled}`);
    await recordAudit(tx, req, { userId: actor, buildingId: rule.buildingId, action: input.enabled ? "AUTOMATION_ENABLED" : "AUTOMATION_DISABLED", resourceType: "automation", resourceId: target });
    return updated;
  }));
});

/** Dry run against the last 30 days of alerts. Nothing is created or recorded. */
automationsRouter.post("/:id/simulate", validateBody(Simulate), async (req, res) => {
  const target = ruleId(req);
  const { number } = req.body as z.infer<typeof Simulate>;
  res.json(await inAutomations(req, async tx => {
    const rule = await visible(tx, target);
    await assertCapability(tx, "alerts:read", rule.buildingId);
    const [known] = await rows(tx, sql`select 1 from automation_versions where automation_id=${target} and number=${number}`);
    if (!known) throw notFound("Versão não encontrada");
    const matches = await rows(tx, sql`select alert_id as "alertId", alert_type as "type", severity, message, ${isoTime(sql`triggered_at`)} as "triggeredAt"
      from app_automation_simulate(${target}::uuid, ${number})`);
    return { number, matches };
  }));
});
