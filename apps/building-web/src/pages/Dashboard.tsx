import { useState } from "react";
import { AlertTriangle, Cpu, Droplets, RadioTower, Wrench } from "lucide-react";
import { Badge, Card, EmptyState, formatNumber, formatRelative, StatTile, useRealtime, useResource } from "@predioon/ui";
import type { BuildingOverview, LatestReading, Paged } from "@predioon/ui";

export function Dashboard({ buildingId }: { buildingId: string }) {
  const overview = useResource<BuildingOverview>(`/overview/building?buildingId=${buildingId}`);
  const latest = useResource<Paged<LatestReading>>(`/telemetry/latest?buildingId=${buildingId}`);
  const [liveReadings, setLiveReadings] = useState<Record<string, LatestReading>>({});

  // Live frames overwrite the snapshot in place, so the panel never waits for a poll.
  const connected = useRealtime((event) => {
    if (event.kind === "telemetry") {
      setLiveReadings((current) => ({
        ...current,
        [`${event.deviceId}:${event.metric}`]: {
          device_id: event.deviceId,
          device_name: current[`${event.deviceId}:${event.metric}`]?.device_name ?? event.deviceId,
          metric: event.metric,
          value: event.value,
          numeric_value: typeof event.value === "number" ? event.value : null,
          unit: event.unit ?? null,
          quality: "GOOD",
          time: event.time,
        },
      }));
    }
    if (event.kind === "alert") overview.reload();
  });

  const readings = { ...Object.fromEntries((latest.data?.items ?? []).map((r) => [`${r.device_id}:${r.metric}`, r])), ...liveReadings };
  const waterLevel = readings["water_01:water_level_percent"];
  const counts = overview.data?.counts ?? {};

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Painel do condomínio</h1>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-300"}`} />
          {connected ? "Tempo real conectado" : "Sem tempo real"}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Caixa d'água"
          value={waterLevel ? `${formatNumber(waterLevel.numeric_value, 0)}%` : "—"}
          detail={waterLevel ? `atualizado ${formatRelative(waterLevel.time)}` : "sem leitura"}
          icon={Droplets}
          tone={waterLevel && Number(waterLevel.numeric_value) < 20 ? "danger" : "info"}
        />
        <StatTile label="Alertas abertos" value={String(counts.open_alerts ?? 0)} icon={AlertTriangle} tone={Number(counts.open_alerts ?? 0) > 0 ? "warning" : "success"} />
        <StatTile label="Dispositivos" value={`${counts.devices_online ?? 0}/${counts.devices ?? 0}`} detail="online" icon={Cpu} />
        <StatTile label="Gateways" value={`${counts.gateways_online ?? 0}/${counts.gateways ?? 0}`} detail="online" icon={RadioTower} />
        <StatTile label="Chamados abertos" value={String(counts.open_occurrences ?? 0)} icon={Wrench} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Alertas recentes" subtitle="Gerados pelas regras de monitoramento">
          {overview.data?.latestAlerts.length ? (
            <ul className="space-y-3">
              {overview.data.latestAlerts.map((alert) => (
                <li key={alert.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-800">{alert.message}</p>
                    <Badge>{alert.severity}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {alert.device_id ?? "gateway"} · {formatRelative(alert.triggered_at)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState text="Nenhum alerta aberto." />
          )}
        </Card>

        <Card title="Leituras em tempo real" subtitle="Última amostra de cada sensor">
          {Object.keys(readings).length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.values(readings).map((reading) => (
                <div key={`${reading.device_id}:${reading.metric}`} className="rounded-xl border border-slate-100 p-3">
                  <p className="text-xs text-slate-500">{reading.metric}</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">
                    {typeof reading.value === "boolean"
                      ? reading.value
                        ? "SIM"
                        : "NÃO"
                      : typeof reading.value === "number"
                        ? formatNumber(reading.value, Number.isInteger(reading.value) ? 0 : 1)
                        : String(reading.value)}
                    <span className="ml-1 text-sm font-normal text-slate-400">{reading.unit ?? ""}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">{formatRelative(reading.time)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="Sem telemetria. Rode o simulador ou conecte o gateway." />
          )}
        </Card>
      </div>
    </>
  );
}
