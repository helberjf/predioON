import { sql } from "drizzle-orm";
import type { AppTransaction } from "@predioon/db/runtime";
import { badRequest, conflict, forbidden, HttpError, pgErrorCode } from "../../http/errors.js";

export type MonitoringDevice = {
  profile_id: string; building_id: string; device_id: string;
  device_name: string; device_type: string; device_enabled: boolean; device_status: string; timezone: string;
};

export async function monitoringScope(tx: AppTransaction, buildingId: string): Promise<{ timezone: string }> {
  const [row] = await tx.execute(sql`select timezone from app_monitoring_scope_context(${buildingId})`);
  if (!row) throw forbidden("Sem acesso ao consumo deste prédio");
  return row as { timezone: string };
}

export async function authorizedMonitoringProfiles(tx: AppTransaction, buildingId: string): Promise<MonitoringDevice[]> {
  return await tx.execute(sql`select * from app_monitoring_authorized_profiles(${buildingId})`) as unknown as MonitoringDevice[];
}

/** One final statement rechecks scope and every cached profile after history. */
export async function currentMonitoringProfiles(tx: AppTransaction, buildingId: string): Promise<MonitoringDevice[]> {
  const rows = await tx.execute(sql`select allowed.allowed,scope.*
    from (select app_monitoring_can_read_scope(${buildingId}) as allowed) allowed
    left join app_monitoring_authorized_profiles(${buildingId}) scope on allowed.allowed`);
  if (!rows[0]?.allowed) throw forbidden("Sem acesso ao consumo deste prédio");
  return rows.filter(row=>row.profile_id!==null) as unknown as MonitoringDevice[];
}

export async function assertMonitoringConfiguration(tx: AppTransaction, buildingId: string, deviceId: string): Promise<void> {
  const [row] = await tx.execute(sql`select
    app_monitoring_device_has_capability(${buildingId},${deviceId},'telemetry:read')
    and app_monitoring_device_has_capability(${buildingId},${deviceId},'devices:read')
    and app_monitoring_device_has_capability(${buildingId},${deviceId},'devices:configure') as allowed`);
  if (!row?.allowed) throw forbidden("Sem a capacidade necessária para configurar este monitoramento");
}

export async function assertActiveMonitoringDevice(tx: AppTransaction, buildingId: string, deviceId: string): Promise<void> {
  const [row] = await tx.execute(sql`select app_monitoring_active_device(${buildingId},${deviceId}) as allowed`);
  if (!row?.allowed) throw badRequest("Selecione um equipamento ativo deste imóvel");
}

/** Database exceptions can contain SQL parameters and private configuration. */
export async function monitoringWrite<T>(run: ()=>Promise<T>): Promise<T> {
  try { return await run(); }
  catch(error) {
    const code=pgErrorCode(error);
    if(code==='23505') throw conflict("Este equipamento já possui monitoramento desse tipo");
    if(code==='42501') throw forbidden();
    if(['23503','23514','22P02'].includes(code??'')) throw badRequest("Dados de monitoramento inválidos");
    if(code) throw new HttpError(500,"Erro interno");
    throw error;
  }
}
