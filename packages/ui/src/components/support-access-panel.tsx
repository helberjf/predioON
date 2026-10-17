import type { ReactNode } from "react";
import { formatDateTime } from "../format.js";
import { useResource } from "../use-resource.js";
import { sortSupportGrants, supportCapabilityLabel, supportGrantStatusLabel, supportPersonLabel, type SupportGrantStatus, type SupportGrantView } from "../support-access-state.js";
import { Badge, Card, ResourceFeedback, type Tone } from "./primitives.js";

const STATUS_TONES: Record<SupportGrantStatus, Tone> = { ACTIVE: "success", EXPIRED: "neutral", REVOKED: "warning" };

export function SupportGrantStatusBadge({ status }: { status: SupportGrantStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{supportGrantStatusLabel(status)}</Badge>;
}

/** One grant: what the support team may read, why, and until when. */
export function SupportGrantRow({ grant, action }: { grant: SupportGrantView; action?: ReactNode }) {
  const until = grant.status === "REVOKED" ? `Revogada em ${formatDateTime(grant.revokedAt)}` : `${grant.status === "ACTIVE" ? "Vale até" : "Expirou em"} ${formatDateTime(grant.expiresAt)}`;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold text-slate-900">{supportCapabilityLabel(grant.capability)} · {supportPersonLabel(grant)}</p>
        <p className="text-sm text-slate-600">{grant.reason}</p>
        <p className="text-xs text-slate-500">{until}{grant.grantedByName ? ` · concedida por ${grant.grantedByName}` : ""} · criada em {formatDateTime(grant.createdAt)}</p>
      </div>
      <div className="flex items-center gap-2"><SupportGrantStatusBadge status={grant.status} />{action}</div>
    </li>
  );
}

/**
 * Read-only review for the building's managers: every temporary access the
 * platform support team received for this building, including closed ones.
 */
export function SupportAccessPanel({ buildingId }: { buildingId: string }) {
  const grants = useResource<{ items: SupportGrantView[] }>(buildingId ? `/v1/support-access/grants?buildingId=${encodeURIComponent(buildingId)}` : null, [buildingId]);
  const items = grants.data ? sortSupportGrants(grants.data.items) : [];
  return (
    <Card title="Acesso de suporte" subtitle="Acessos temporários da equipe de suporte da plataforma a este condomínio. Só a plataforma concede ou revoga; cada concessão tem motivo e prazo.">
      {items.length ? <ul className="divide-y divide-slate-100">{items.map(grant => <SupportGrantRow key={grant.id} grant={grant} />)}</ul>
        : <ResourceFeedback resource={grants} emptyText="Nenhum acesso de suporte foi concedido a este condomínio." />}
    </Card>
  );
}
