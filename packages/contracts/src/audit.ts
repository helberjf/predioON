/** Deliberately excludes raw payloads, IP addresses and user agents. */
export type AuditEntry = {
  id: string;
  buildingId: string | null;
  scopeKind: "PLATFORM" | "BUILDING";
  userId: string | null;
  actorType: "USER" | "SYSTEM" | "GATEWAY";
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
};

export type AuditPage = { items: AuditEntry[]; limit: number; offset: number };
