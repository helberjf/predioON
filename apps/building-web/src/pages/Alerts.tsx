import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api, alertPermissions, Badge, Button, Card, ErrorBanner, PageHeading, ResourceFeedback, formatDateTime, useCurrentAuthorization, useRealtime, useResource } from "@predioon/ui";
import type { Alert, Paged } from "@predioon/ui";
import { ALERT_GROUPS, presentAlert } from "./alert-presentation.js";

function AlertActions({ buildingId, alert, revision, reload }: { buildingId: string; alert: Alert; revision: number; reload: () => void }) {
  const own = useCurrentAuthorization({ buildingId, resourceType: "alert", resourceId: alert.id });
  const device = useCurrentAuthorization(alert.deviceId ? { buildingId, resourceType: "device", resourceId: alert.deviceId } : null);
  const gateway = useCurrentAuthorization(alert.gatewayId ? { buildingId, resourceType: "gateway", resourceId: alert.gatewayId } : null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const resources = [own, device, gateway];
  const waiting = resources.some(resource => resource.loading && !resource.data);
  const failed = resources.find(resource => resource.error && resource.errorStatus !== 403);
  const permissions = alertPermissions(buildingId, alert, resources.map(resource => resource.data));
  useEffect(() => { own.reload(); device.reload(); gateway.reload(); }, [revision, own.reload, device.reload, gateway.reload]);

  async function act(action: "acknowledge" | "resolve") {
    if (pending.current || waiting || failed || !permissions[action]) return;
    pending.current = true; setBusy(true); setError(null);
    try { await api.post(`/alerts/${alert.id}/${action}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar alerta"); }
    finally { pending.current = false; setBusy(false); reload(); }
  }

  return <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {waiting ? <p role="status" className="text-sm text-slate-500">Verificando o que você pode fazer neste alerta…</p>
      : failed ? <ResourceFeedback resource={failed} emptyText="" />
      : <><p className="text-sm text-slate-600">{alert.status === "RESOLVED" ? "Este alerta já foi marcado como resolvido. Você pode consultar as informações técnicas abaixo."
        : permissions.acknowledge || permissions.resolve ? "Registre o acompanhamento ou, depois de conferir a solução, marque o alerta como resolvido. Estes botões não acionam a manutenção."
        : "Você pode consultar este alerta, mas não alterar sua situação."}</p>
        <div className="flex flex-wrap gap-2">
          {permissions.acknowledge && alert.status === "OPEN" && <Button variant="secondary" disabled={busy} onClick={() => void act("acknowledge")}>Iniciar acompanhamento</Button>}
          {permissions.resolve && alert.status !== "RESOLVED" && <Button disabled={busy} onClick={() => void act("resolve")}>Marcar como resolvido</Button>}
        </div></>}
  </div>;
}

function TechnicalInformation({ alert }: { alert: Alert }) {
  const fields = [
    ["Código do alerta", alert.type],
    ["Identificador do registro", alert.id],
    ["Equipamento (ID)", alert.deviceId ?? "Não informado"],
    ["Central de comunicação (ID)", alert.gatewayId ?? "Não informada"],
    ["Gravidade original", alert.severity],
    ["Situação original", alert.status],
    ["Detectado em", formatDateTime(alert.triggeredAt)],
    ["Registrado no sistema em", formatDateTime(alert.createdAt)],
  ];
  return <details className="group mt-4 rounded-lg border border-slate-200 bg-slate-50">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 [&::-webkit-details-marker]:hidden">
      Informações técnicas <ChevronDown size={16} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" />
    </summary>
    <div className="space-y-4 border-t border-slate-200 p-3 text-sm">
      <div><p className="font-semibold text-slate-700">Mensagem original</p><p className="mt-1 whitespace-pre-wrap break-words text-slate-600 [overflow-wrap:anywhere]">{alert.message}</p></div>
      <dl className="grid gap-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0">
        <dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 break-words font-mono text-xs text-slate-700 [overflow-wrap:anywhere]">{value}</dd>
      </div>)}</dl>
    </div>
  </details>;
}

function Workspace({ buildingId }: { buildingId: string }) {
  const alerts = useResource<Paged<Alert>>(`/alerts?buildingId=${encodeURIComponent(buildingId)}&limit=100`);
  const [selected, setSelected] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const reload = () => { alerts.reload(); setRevision(value => value + 1); };
  useRealtime(event => { if (event.kind === "alert") reload(); });
  useEffect(() => {
    window.addEventListener("focus", alerts.reload);
    const timer = setInterval(alerts.reload, 30_000);
    return () => { window.removeEventListener("focus", alerts.reload); clearInterval(timer); };
  }, [alerts.reload]);
  // A revoked item must not reopen its previous action state when granted again.
  useEffect(() => { if (selected && !alerts.loading && !alerts.data?.items.some(alert => alert.id === selected)) setSelected(null); }, [selected, alerts.loading, alerts.data]);

  const items = (alerts.data?.items ?? []).map(alert => ({ alert, view: presentAlert(alert) }));
  return <>
    <PageHeading title="Alertas" description="Veja o que precisa de atenção e acompanhe as providências." action={<Button variant="secondary" onClick={reload}>Atualizar alertas</Button>} />
    <p className="text-sm text-slate-500">Alertas disponíveis para sua conta. Os itens com a indicação “Demonstração” são exemplos fictícios.</p>
    {alerts.error || !items.length ? <Card><ResourceFeedback resource={alerts} emptyText="Nenhum alerta registrado para sua conta." /></Card>
      : ALERT_GROUPS.map(group => {
        const records = items.filter(item => item.view.group === group.id)
          .sort((a, b) => group.id === "resolved" ? 0 : a.view.priority.rank - b.view.priority.rank);
        return <section key={group.id} aria-label={group.title}>
          <Card title={group.title} subtitle={group.description} action={<Badge tone={group.id === "resolved" ? "success" : group.id === "following" ? "info" : "warning"}>{records.length}</Badge>}>
            {records.length ? <ul className="space-y-3">{records.map(({ alert, view }) => <li key={alert.id} className={`min-w-0 rounded-xl border p-4 ${group.id === "resolved" ? "border-slate-200" : group.id === "following" ? "border-sky-200" : "border-amber-200"}`}>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={view.tone}>{view.status}</Badge>
                    {group.id !== "resolved" && <Badge tone={view.priority.tone}>{view.priority.label}</Badge>}
                    {view.demo && <Badge tone="neutral">Demonstração</Badge>}
                  </div>
                  <h3 className="mt-3 break-words text-base font-semibold text-slate-800">{view.title}</h3>
                  {view.message && <p className="mt-1 break-words text-sm text-slate-600 [overflow-wrap:anywhere]">{view.message}</p>}
                  <p className="mt-2 text-sm leading-6 text-slate-600"><span className="font-medium">{group.id === "resolved" ? "Registro:" : "Próximo passo:"}</span> {view.guidance}</p>
                  <p className="mt-2 text-xs text-slate-500">Alerta registrado em {formatDateTime(alert.triggeredAt)}</p>
                </div>
                <div className="shrink-0"><Button variant="secondary" onClick={() => setSelected(selected === alert.id ? null : alert.id)}>{selected === alert.id ? "Fechar detalhes" : "Ver detalhes"}</Button></div>
              </div>
              {selected === alert.id && <AlertActions key={`${alert.id}:${alert.deviceId}:${alert.gatewayId}`} buildingId={buildingId} alert={alert} revision={revision} reload={reload} />}
              <TechnicalInformation alert={alert} />
            </li>)}</ul> : <p className="text-sm text-slate-500">{group.empty}</p>}
          </Card>
        </section>;
      })}
  </>;
}

export function Alerts({ buildingId }: { buildingId: string }) {
  return <Workspace key={buildingId} buildingId={buildingId} />;
}
