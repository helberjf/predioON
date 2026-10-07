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

export const assetsRouter = Router();
assetsRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const id = z.string().uuid();
const buildingId = z.string().trim().min(1).max(128);
const Category = z.enum(["PUMP", "ELEVATOR", "GENERATOR", "GATE", "HVAC", "FIRE_SAFETY", "ELECTRICAL", "PLUMBING", "OTHER"]);
const text = (max: number) => z.string().trim().max(max);
const fields = {
  name: z.string().trim().min(1).max(160), category: Category, location: text(160), manufacturer: text(120),
  model: text(120), serialNumber: text(120), notes: text(2000),
  installedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Data inválida").nullable(),
};
const List = z.object({ buildingId, includeInactive: z.enum(["true", "false"]).optional(), after: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const Create = z.object({ buildingId, name: fields.name, category: fields.category.default("OTHER"), location: fields.location.default(""),
  manufacturer: fields.manufacturer.default(""), model: fields.model.default(""), serialNumber: fields.serialNumber.default(""),
  notes: fields.notes.default(""), installedOn: fields.installedOn.optional() }).strict();
const Update = z.object({ version: z.number().int().positive(), name: fields.name.optional(), category: fields.category.optional(),
  location: fields.location.optional(), manufacturer: fields.manufacturer.optional(), model: fields.model.optional(),
  serialNumber: fields.serialNumber.optional(), notes: fields.notes.optional(), installedOn: fields.installedOn.optional(),
  active: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 1, "Informe ao menos um campo");
const Devices = z.object({ deviceIds: z.array(z.string().min(1).max(128)).max(50).refine(ids => new Set(ids).size === ids.length, "Equipamentos repetidos") }).strict();

type Asset = { id: string; buildingId: string; version: number; active: boolean };
const view = sql`s.id, s.building_id as "buildingId", s.name, s.category, s.location, s.manufacturer, s.model, s.serial_number as "serialNumber",
  to_char(s.installed_on, 'YYYY-MM-DD') as "installedOn", s.notes, s.active, s.version,
  ${isoTime(sql`s.created_at`)} as "createdAt", ${isoTime(sql`s.updated_at`)} as "updatedAt"`;

async function inAssets<T>(req: Request, run: (tx: AppTransaction) => Promise<T>): Promise<T> {
  try { return await inTenantContext(req, run); }
  catch (error) {
    const code = pgErrorCode(error);
    if (code === "42501") throw forbidden("Sem a permissão necessária para este ativo");
    if (code === "23503" || code === "23514") throw badRequest("Equipamento inválido para este condomínio");
    if (code === "P0409" || code === "40001") throw conflict("O ativo foi alterado. Recarregue antes de tentar novamente.");
    throw error;
  }
}
const rows = async <T>(tx: AppTransaction, statement: SQL) => await tx.execute(statement) as unknown as T[];
function assetId(req: Request): string {
  const parsed = id.safeParse(param(req, "id"));
  if (!parsed.success) throw notFound();
  return parsed.data;
}
async function visible(tx: AppTransaction, target: string): Promise<Asset> {
  const [asset] = await rows<Asset>(tx, sql`select ${view} from assets s where s.id=${target}`);
  if (!asset) throw notFound("Ativo não encontrado");
  return asset;
}

assetsRouter.get("/", validateQuery(List), async (req, res) => {
  const q = query<z.infer<typeof List>>(req);
  res.json(await inAssets(req, async tx => {
    await assertCapability(tx, "devices:read", q.buildingId);
    const [scope] = await rows<{ manage: boolean }>(tx, sql`select app_has_capability(${q.buildingId},'devices:configure') as manage`);
    if (q.includeInactive === "true" && !scope?.manage) throw forbidden();
    const items = await rows<Asset>(tx, sql`select ${view} from assets s where s.building_id=${q.buildingId}
      and (${q.includeInactive === "true"} or s.active)
      and (${q.after ?? null}::uuid is null or (s.name,s.id) > (select c.name,c.id from assets c where c.id=${q.after ?? null}::uuid))
      order by s.name, s.id limit ${q.limit + 1}`);
    const page = items.slice(0, q.limit);
    return { items: page, nextCursor: items.length > q.limit ? page.at(-1)!.id : null, canManage: scope?.manage === true };
  }));
});

assetsRouter.post("/", validateBody(Create), async (req, res) => {
  const input = req.body as z.infer<typeof Create>;
  const actor = currentAuth(req).userId;
  const created = await inAssets(req, async tx => {
    await assertCapability(tx, "devices:configure", input.buildingId);
    const [asset] = await rows<Asset>(tx, sql`insert into assets as s(building_id,name,category,location,manufacturer,model,serial_number,installed_on,notes,created_by)
      values(${input.buildingId},${input.name},${input.category},${input.location},${input.manufacturer},${input.model},${input.serialNumber},
        ${input.installedOn ?? null}::date,${input.notes},${actor}) returning ${view}`);
    await recordAudit(tx, req, { userId: actor, buildingId: input.buildingId, action: "ASSET_CREATED", resourceType: "asset", resourceId: asset!.id });
    return asset!;
  });
  res.status(201).json(created);
});

/** The asset with its monitored devices and the work orders the caller may see. */
assetsRouter.get("/:id", async (req, res) => {
  const target = assetId(req);
  res.json(await inAssets(req, async tx => {
    const asset = await visible(tx, target);
    const devices = await rows(tx, sql`select d.id, d.name, d.type from asset_device_links l join devices d on d.id=l.device_id
      where l.asset_id=${target} order by d.name, d.id`);
    const workOrders = await rows(tx, sql`select w.id, w.title, w.status, w.priority, ${isoTime(sql`w.created_at`)} as "createdAt", ${isoTime(sql`w.closed_at`)} as "closedAt"
      from work_orders w where w.asset_id=${target} order by w.created_at desc, w.id desc limit 50`);
    return { ...asset, devices, workOrders };
  }));
});

assetsRouter.patch("/:id", validateBody(Update), async (req, res) => {
  const target = assetId(req);
  const { version: expected, ...changes } = req.body as z.infer<typeof Update>;
  const actor = currentAuth(req).userId;
  res.json(await inAssets(req, async tx => {
    const current = await visible(tx, target);
    await assertCapability(tx, "devices:configure", current.buildingId);
    const has = (key: keyof typeof changes) => Object.hasOwn(changes, key);
    const [updated] = await rows<Asset>(tx, sql`update assets as s set version=s.version+1,
      name=case when ${has("name")} then ${changes.name ?? null} else s.name end,
      category=case when ${has("category")} then ${changes.category ?? null} else s.category end,
      location=case when ${has("location")} then ${changes.location ?? null} else s.location end,
      manufacturer=case when ${has("manufacturer")} then ${changes.manufacturer ?? null} else s.manufacturer end,
      model=case when ${has("model")} then ${changes.model ?? null} else s.model end,
      serial_number=case when ${has("serialNumber")} then ${changes.serialNumber ?? null} else s.serial_number end,
      notes=case when ${has("notes")} then ${changes.notes ?? null} else s.notes end,
      installed_on=case when ${has("installedOn")} then ${changes.installedOn ?? null}::date else s.installed_on end,
      active=case when ${has("active")} then ${changes.active ?? null}::boolean else s.active end
      where s.id=${target} and s.version=${expected} returning ${view}`);
    if (!updated) throw conflict("O ativo foi alterado. Recarregue antes de tentar novamente.");
    await recordAudit(tx, req, { userId: actor, buildingId: updated.buildingId, action: "ASSET_UPDATED", resourceType: "asset", resourceId: target,
      metadata: { fields: Object.keys(changes).sort() } });
    return updated;
  }));
});

/** Replaces the set of monitored devices. Devices of another condominium are refused by the table guard. */
assetsRouter.put("/:id/devices", validateBody(Devices), async (req, res) => {
  const target = assetId(req);
  const { deviceIds } = req.body as z.infer<typeof Devices>;
  const actor = currentAuth(req).userId;
  res.json(await inAssets(req, async tx => {
    const asset = await visible(tx, target);
    await assertCapability(tx, "devices:configure", asset.buildingId);
    await tx.execute(sql`delete from asset_device_links where asset_id=${target}`);
    for (const deviceId of deviceIds) {
      await tx.execute(sql`insert into asset_device_links(asset_id,building_id,device_id,created_by) values(${target},${asset.buildingId},${deviceId},${actor})`);
    }
    await recordAudit(tx, req, { userId: actor, buildingId: asset.buildingId, action: "ASSET_UPDATED", resourceType: "asset", resourceId: target, metadata: { fields: ["devices"] } });
    return { devices: await rows(tx, sql`select d.id, d.name, d.type from asset_device_links l join devices d on d.id=l.device_id where l.asset_id=${target} order by d.name, d.id`) };
  }));
});
