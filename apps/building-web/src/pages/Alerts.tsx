import { useEffect, useRef, useState } from "react";
import { api, alertPermissions, Badge, Button, Card, ErrorBanner, ResourceFeedback, formatDateTime, useCurrentAuthorization, useRealtime, useResource } from "@predioon/ui";
import type { Alert, Paged } from "@predioon/ui";

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
    {waiting ? <p role="status" className="text-sm text-slate-500">Consultando suas permissões para este alerta…</p>
      : failed ? <ResourceFeedback resource={failed} emptyText="" />
      : <><p className="text-xs text-slate-500">{permissions.acknowledge || permissions.resolve ? "Ações disponíveis para este alerta." : "Nenhuma ação disponível para seu perfil neste alerta."}</p>
        <div className="flex flex-wrap gap-2">
          {permissions.acknowledge && alert.status === "OPEN" && <Button variant="secondary" disabled={busy} onClick={() => void act("acknowledge")}>Reconhecer</Button>}
          {permissions.resolve && alert.status !== "RESOLVED" && <Button disabled={busy} onClick={() => void act("resolve")}>Resolver</Button>}
        </div></>}
  </div>;
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

  return <>
    <h1 className="text-2xl font-bold text-slate-900">Alertas</h1>
    <Card title="Ocorrências de monitoramento" subtitle="Alertas disponíveis conforme suas permissões" action={<Button variant="secondary" onClick={reload}>Atualizar alertas</Button>}>
      {alerts.data?.items.length ? <ul className="space-y-3">{alerts.data.items.map(alert => <li key={alert.id} className="rounded-xl border border-slate-100 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><Badge>{alert.severity}</Badge><Badge>{alert.status}</Badge><span className="text-xs text-slate-400">{alert.type}</span></div>
            <p className="mt-2 text-sm font-medium text-slate-800">{alert.message}</p>
            <p className="mt-1 text-xs text-slate-400">{alert.deviceId ?? alert.gatewayId ?? "—"} · {formatDateTime(alert.triggeredAt)}</p>
          </div>
          <Button variant="secondary" onClick={() => setSelected(selected === alert.id ? null : alert.id)}>{selected === alert.id ? "Fechar ações do alerta" : "Ver ações deste alerta"}</Button>
        </div>
        {selected === alert.id && <AlertActions key={`${alert.id}:${alert.deviceId}:${alert.gatewayId}`} buildingId={buildingId} alert={alert} revision={revision} reload={reload} />}
      </li>)}</ul> : <ResourceFeedback resource={alerts} emptyText="Nenhum alerta registrado." />}
    </Card>
  </>;
}

export function Alerts({ buildingId }: { buildingId: string }) {
  return <Workspace key={buildingId} buildingId={buildingId} />;
}
