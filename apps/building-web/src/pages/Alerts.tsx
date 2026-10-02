import { useState } from "react";
import { api, Badge, Button, Card, ErrorBanner, ResourceFeedback, formatDateTime, useRealtime, useResource } from "@predioon/ui";
import type { Alert, Paged } from "@predioon/ui";

export function Alerts({ buildingId, canAcknowledge = false, canResolve = false }: { buildingId: string; canAcknowledge?: boolean; canResolve?: boolean }) {
  const alerts = useResource<Paged<Alert>>(`/alerts?buildingId=${buildingId}&limit=100`);
  const [error, setError] = useState<string | null>(null);

  useRealtime((event) => {
    if (event.kind === "alert") alerts.reload();
  });

  async function act(alertId: string, action: "acknowledge" | "resolve") {
    try {
      await api.post(`/alerts/${alertId}/${action}`);
      alerts.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar alerta");
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Alertas</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <Card title="Ocorrências de monitoramento" subtitle={canAcknowledge ? "Reconheça para sinalizar que está sendo tratado" : "Alertas disponíveis conforme suas permissões"}>
        {alerts.data?.items.length ? (
          <ul className="space-y-3">
            {alerts.data.items.map((alert) => (
              <li key={alert.id} className="rounded-xl border border-slate-100 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{alert.severity}</Badge>
                      <Badge>{alert.status}</Badge>
                      <span className="text-xs text-slate-400">{alert.type}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-800">{alert.message}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {alert.deviceId ?? alert.gatewayId ?? "—"} · {formatDateTime(alert.triggeredAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {canAcknowledge && alert.status === "OPEN" && (
                      <Button variant="secondary" onClick={() => void act(alert.id, "acknowledge")}>
                        Reconhecer
                      </Button>
                    )}
                    {canResolve && alert.status !== "RESOLVED" && <Button onClick={() => void act(alert.id, "resolve")}>Resolver</Button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ResourceFeedback resource={alerts} emptyText="Nenhum alerta registrado." />
        )}
      </Card>
    </>
  );
}
