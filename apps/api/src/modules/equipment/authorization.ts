import { sql } from "drizzle-orm";
import type { AppTransaction } from "@predioon/db/runtime";
import { assertCapability } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, HttpError, pgErrorCode } from "../../http/errors.js";

type EquipmentType = "device" | "gateway";
type EquipmentCapability = "devices:read" | "devices:configure";

/** Scope checks distinguish private device inventory from gateway inventory. */
export async function assertEquipmentReadScope(tx: AppTransaction, buildingId: string, type: EquipmentType): Promise<void> {
  const [row] = await tx.execute(sql`select app_equipment_can_read_scope(${buildingId},${type}) as allowed`);
  if (!row?.allowed) throw forbidden("Sem acesso aos equipamentos deste prédio");
}

/** A new resource requires a whole-tenant grant; a scoped grant cannot create it. */
export async function assertEquipmentCreation(tx: AppTransaction, buildingId: string): Promise<void> {
  await assertCapability(tx,"devices:read",buildingId);
  await assertCapability(tx,"devices:configure",buildingId);
}

/** The owner helper validates the actual resource and its current live grants. */
export async function assertEquipmentCapability(tx: AppTransaction, buildingId: string, type: EquipmentType, id: string, capability: EquipmentCapability): Promise<void> {
  const [row] = await tx.execute(type === "device"
    ? sql`select app_device_has_capability(${buildingId},${id},${capability}) as allowed`
    : sql`select app_gateway_has_capability(${buildingId},${id},${capability}) as allowed`);
  if (!row?.allowed) throw forbidden("Sem a capacidade necessária para este recurso");
}

/** No private gateway DTO is fetched or returned to validate a relationship. */
export async function assertDeviceGateway(tx: AppTransaction, buildingId: string, deviceId: string | null, gatewayId: string | null): Promise<void> {
  const [row] = await tx.execute(sql`select app_device_can_assign_gateway(${buildingId},${deviceId},${gatewayId}) as allowed`);
  if (!row?.allowed) throw badRequest("Relação de equipamento inválida");
}

/** Drizzle errors include SQL parameters. Do not log private config or hashes. */
export async function equipmentWrite<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    const code = pgErrorCode(error);
    if (code === "42501") throw forbidden();
    if (code === "23505") throw conflict("Equipamento ou métrica já cadastrado");
    if (["23503","23514","22P02"].includes(code ?? "")) throw badRequest("Dados de equipamento inválidos");
    if (code) throw new HttpError(500,"Erro interno");
    throw error;
  }
}
