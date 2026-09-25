import { eq, sql } from "drizzle-orm";
import { resolveFeatures, type FeatureStates } from "@predioon/shared";
import type { AppTransaction } from "./context.js";
import { buildingFeatureSettings, featureRuntime, globalFeatureSettings } from "./schema-features.js";

/** Readers hold this through their side effects. Administrative changes take the exclusive lock. */
export async function lockFeatures(tx: AppTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(814772, 1)`);
}
export async function lockFeatureChanges(tx: AppTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(814772, 1)`);
}
export async function readFeatures(tx: AppTransaction, buildingId: string): Promise<FeatureStates> {
  const global = await tx.select().from(globalFeatureSettings);
  const local = await tx.select().from(buildingFeatureSettings).where(eq(buildingFeatureSettings.buildingId, buildingId));
  const runtime = await tx.select().from(featureRuntime).where(eq(featureRuntime.buildingId, buildingId));
  const states = resolveFeatures(global, local);
  for (const row of runtime) if (states[row.key]) states[row.key].resumedAt = row.resumedAt?.toISOString() ?? null;
  return states;
}
