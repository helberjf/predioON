import { randomBytes } from "node:crypto";

/** Readable, sortable-enough identifiers: org_k3f9x2mq. Collisions are not a concern at this scale. */
export function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}
