import { sql } from "drizzle-orm";
import type { AppTransaction } from "@predioon/db/runtime";
import type { RealtimeEvent } from "@predioon/shared";

type FeatureEvent = Extract<RealtimeEvent, { kind: "features-changed" }>;

/** Global invalidation requires the route's current central identity/session. */
export async function projectFeatureEvent(tx: AppTransaction, event: FeatureEvent): Promise<FeatureEvent | null> {
  if (event.buildingId === "*") return { kind: "features-changed", buildingId: "*" };
  const [authority] = await tx.execute<{ allowed: boolean }>(sql`select app_can_read_feature_event(${event.buildingId}) as allowed`);
  return authority?.allowed ? { kind: "features-changed", buildingId: event.buildingId } : null;
}
