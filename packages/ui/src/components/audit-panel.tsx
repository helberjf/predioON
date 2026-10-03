import { useEffect, useState } from "react";
import type { AuditPage } from "@predioon/contracts";
import { useAuth } from "../auth.js";
import { formatDateTime } from "../format.js";
import { useResource } from "../use-resource.js";
import { Badge, Button, Card, PageHeading, ResourceFeedback } from "./primitives.js";

const PAGE_SIZE = 25;

/** The API and RLS decide which platform, tenant and exact-resource rows exist
 * in this view. Never infer audit access from an operational role or inventory. */
export function AuditPanel({ buildingId }: { buildingId?: string }) {
  const { user } = useAuth();
  return user ? <AuditWorkspace key={JSON.stringify([user.id, buildingId ?? null])} buildingId={buildingId} /> : null;
}

function AuditWorkspace({ buildingId }: { buildingId?: string }) {
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (buildingId) params.set("buildingId", buildingId);
  const logs = useResource<AuditPage>(`/audit?${params}`);

  useEffect(() => {
    window.addEventListener("focus", logs.reload);
    const timer = setInterval(logs.reload, 30_000);
    return () => { window.removeEventListener("focus", logs.reload); clearInterval(timer); };
  }, [logs.reload]);

  const refresh = () => {
    if (offset) setOffset(0);
    else logs.reload();
  };
  const ready = !logs.loading && !logs.error && logs.data;
  return <div className="space-y-5">
    <PageHeading title="Histórico de atividades"
      description={buildingId ? "Registros autorizados do condomínio em uso." : "Registros disponíveis nas suas concessões atuais."}
      action={<Button variant="secondary" disabled={logs.loading} onClick={refresh}>Atualizar histórico</Button>} />
    <Card title="Ações registradas" subtitle="Mais recentes primeiro; cada página contém até 25 registros">
      <p className="mb-4 text-sm text-slate-600">A lista mostra somente os escopos autorizados para sua conta. Uma página vazia não representa o histórico de toda a plataforma.</p>
      {!ready ? <ResourceFeedback resource={logs} emptyText="Nenhum registro disponível." />
        : logs.data!.items.length ? <ul className="divide-y divide-slate-100">{logs.data!.items.map(log => <li key={log.id}>
          <article aria-label="Registro de auditoria" className="flex flex-wrap items-start justify-between gap-3 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="break-words text-sm font-medium text-slate-800">{log.action.replaceAll("_", " ")}</p>
              <Badge tone={log.scopeKind === "PLATFORM" ? "info" : "neutral"}>{log.scopeKind === "PLATFORM" ? "Plataforma" : "Condomínio"}</Badge>
              <dl className="space-y-1 break-words text-xs text-slate-500">
                <div><dt className="inline">Responsável: </dt><dd className="inline">{log.userId ?? (log.actorType === "GATEWAY" ? "Controlador" : "Sistema")}</dd></div>
                <div><dt className="inline">Recurso: </dt><dd className="inline">{log.resourceType}{log.resourceId ? ` · ${log.resourceId}` : ""}</dd></div>
                {log.buildingId && <div><dt className="inline">Condomínio: </dt><dd className="inline">{log.buildingId}</dd></div>}
              </dl>
            </div>
            <time dateTime={log.createdAt} className="text-xs text-slate-500">{formatDateTime(log.createdAt)}</time>
          </article>
        </li>)}</ul> : <p role="status" className="py-8 text-center text-sm text-slate-500">{offset ? "Não há registros nesta página." : "Nenhum registro disponível neste escopo."}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4" aria-label="Paginação do histórico">
        <Button variant="secondary" disabled={logs.loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}>Página anterior</Button>
        <p role="status" className="text-sm text-slate-500">Página {Math.floor(offset / PAGE_SIZE) + 1}</p>
        <Button variant="secondary" disabled={!ready || logs.data!.items.length < PAGE_SIZE} onClick={() => setOffset(value => value + PAGE_SIZE)}>Próxima página</Button>
      </div>
    </Card>
  </div>;
}
