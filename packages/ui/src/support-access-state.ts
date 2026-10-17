/** Temporary platform support access (API /v1/support-access). */
export type SupportGrantStatus = "ACTIVE" | "EXPIRED" | "REVOKED";
export type SupportGrantView = {
  id: string; buildingId: string; supportUserId: string; supportUserName: string | null; capability: string;
  resourceType: string | null; resourceId: string | null; reason: string; createdAt: string; expiresAt: string;
  revokedAt: string | null; grantedByName: string | null; status: SupportGrantStatus;
};
export type SupportStaffView = { id: string; userId: string; name: string; email: string; reason: string; createdAt: string };
export type SupportGrantForm = { supportUserId: string; capabilities: string[]; reason: string; hours: number };

/** The only capabilities the database lets a support grant carry. */
export const SUPPORT_CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  "telemetry:read": "Leituras dos sensores",
  "alerts:read": "Alertas",
  "devices:read": "Equipamentos",
  "work-orders:read-assigned": "Ordens de serviço atribuídas",
  "support:read": "Concessões de suporte",
};
export const SUPPORT_GRANT_HOURS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 1, label: "1 hora" }, { hours: 4, label: "4 horas" }, { hours: 8, label: "8 horas" },
  { hours: 24, label: "1 dia" }, { hours: 72, label: "3 dias" }, { hours: 168, label: "7 dias" },
];
const STATUS_LABELS: Record<SupportGrantStatus, string> = { ACTIVE: "Ativa", EXPIRED: "Expirada", REVOKED: "Revogada" };

export function supportCapabilityLabel(capability: string): string {
  return SUPPORT_CAPABILITY_LABELS[capability] ?? capability;
}
export function supportGrantStatusLabel(status: SupportGrantStatus): string {
  return STATUS_LABELS[status] ?? status;
}
/** A manager cannot see platform staff accounts; the grant still says who is behind it. */
export function supportPersonLabel(grant: Pick<SupportGrantView, "supportUserName">): string {
  return grant.supportUserName?.trim() || "Equipe de suporte da plataforma";
}
/** Active grants first, then the most recent; never reorders the server's list in place. */
export function sortSupportGrants(grants: readonly SupportGrantView[]): SupportGrantView[] {
  const rank = (grant: SupportGrantView) => grant.status === "ACTIVE" ? 0 : 1;
  return [...grants].sort((a, b) => rank(a) - rank(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}
/** Mirrors the API limits so the form explains a refusal before sending it. */
export function supportGrantFormError(form: SupportGrantForm): string | null {
  if (!form.supportUserId) return "Escolha quem da equipe de suporte vai receber o acesso.";
  if (!form.capabilities.length) return "Marque ao menos uma informação liberada.";
  if (form.capabilities.some(capability => !(capability in SUPPORT_CAPABILITY_LABELS))) return "Há uma informação que o suporte não pode receber.";
  if (new Set(form.capabilities).size !== form.capabilities.length) return "Há informações repetidas.";
  if (form.reason.trim().length < 3) return "Explique o motivo do acesso (o síndico verá este texto).";
  if (form.reason.trim().length > 500) return "O motivo pode ter até 500 caracteres.";
  if (!SUPPORT_GRANT_HOURS.some(option => option.hours === form.hours)) return "Escolha um prazo da lista.";
  return null;
}
