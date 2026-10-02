import { sql } from "drizzle-orm";
import type { AppTransaction } from "@predioon/db/runtime";
import { forbidden } from "../http/errors.js";

/** Consults current membership and account status rather than trusting a stale token. */
export async function assertGovernanceAccess(tx: AppTransaction, buildingId: string, manage = false) {
  const rows = await tx.execute(sql`select app_governance_access(${buildingId}, ${manage}) as allowed`);
  if (!rows[0]?.allowed) throw forbidden("Sem acesso atual para esta operação no condomínio");
}
