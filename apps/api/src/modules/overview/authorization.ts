import { sql } from "drizzle-orm";
import type { AppTransaction } from "@predioon/db/runtime";
import type { OverviewCoverage } from "@predioon/contracts";
import { forbidden } from "../../http/errors.js";

export type OverviewScope = {basic:boolean;occurrences:boolean;devices:OverviewCoverage;gateways:OverviewCoverage;alerts:OverviewCoverage;telemetry:OverviewCoverage};
export async function buildingOverviewScope(tx:AppTransaction,buildingId:string):Promise<OverviewScope> {
  const [row]=await tx.execute(sql`select s.*,app_occurrence_can_read_scope(${buildingId},false) occurrences from app_overview_building_scope(${buildingId}) s`);
  const scope=row as OverviewScope;
  if(!scope.basic && !scope.occurrences && [scope.devices,scope.gateways,scope.alerts,scope.telemetry].every(value=>value==='none'))throw forbidden("Prédio fora do seu escopo");
  return scope;
}
