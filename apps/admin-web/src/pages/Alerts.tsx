import { Badge, Card, EmptyState, formatDateTime, useRealtime, useResource } from "@predioon/ui";
import type { Alert, Paged } from "@predioon/ui";

export function Alerts() {
  const alerts = useResource<Paged<Alert>>("/alerts?limit=100");

  useRealtime((event) => {
    if (event.kind === "alert") alerts.reload();
  });

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Alertas da plataforma</h1>
      <Card title="Todos os prédios" subtitle="Somente leitura — quem trata é a administração de cada prédio">
        {alerts.data?.items.length ? (
          <ul className="space-y-2">
            {alerts.data.items.map((alert) => (
              <li key={alert.id} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{alert.severity}</Badge>
                      <Badge>{alert.status}</Badge>
                      <span className="text-xs text-slate-400">{alert.type}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-800">{alert.message}</p>
                  </div>
                  <p className="shrink-0 text-xs text-slate-400">{formatDateTime(alert.triggeredAt)}</p>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {alert.buildingId} · {alert.deviceId ?? alert.gatewayId ?? "—"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState text={alerts.error ?? "Nenhum alerta registrado."} />
        )}
      </Card>
    </>
  );
}
