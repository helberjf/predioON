import { useState } from "react";
import { Card, EmptyState, formatNumber, formatRelative, Select, useResource } from "@predioon/ui";
import type { LatestReading, Paged, SeriesPoint } from "@predioon/ui";
import { MetricChart } from "../components/MetricChart.js";

const BUCKETS = [
  { value: "5m" as const, label: "Últimas horas (5 min)" },
  { value: "1h" as const, label: "24 horas (1 hora)" },
  { value: "1d" as const, label: "30 dias (1 dia)" },
];

const RANGE_HOURS = { "5m": 6, "1h": 24, "1d": 720 };

export function Water({ buildingId }: { buildingId: string }) {
  const [bucket, setBucket] = useState<"5m" | "1h" | "1d">("5m");
  const latest = useResource<Paged<LatestReading>>(`/telemetry/latest?buildingId=${buildingId}`);
  const from = new Date(Date.now() - RANGE_HOURS[bucket] * 3_600_000).toISOString();
  const series = useResource<{ items: SeriesPoint[] }>(
    `/telemetry/series?deviceId=water_01&metric=water_level_percent&bucket=${bucket}&from=${from}`,
  );

  const level = latest.data?.items.find((r) => r.metric === "water_level_percent");
  const volume = latest.data?.items.find((r) => r.metric === "volume_liters");
  const pump = latest.data?.items.find((r) => r.metric === "pump_running");
  const percent = Number(level?.numeric_value ?? 0);

  // Rough drain estimate from the first and last samples of the window.
  const points = series.data?.items ?? [];
  const first = points[0]?.avg_value;
  const last = points[points.length - 1]?.avg_value;
  const hours = RANGE_HOURS[bucket];
  const dropPerHour = first !== null && first !== undefined && last !== null && last !== undefined && points.length > 1
    ? (Number(first) - Number(last)) / hours
    : 0;
  const hoursToEmpty = dropPerHour > 0.05 ? percent / dropPerHour : null;

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Caixa d&apos;água</h1>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Nível atual">
          {level ? (
            <>
              <p className="text-4xl font-bold text-slate-900">{formatNumber(percent, 0)}%</p>
              <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${percent < 20 ? "bg-rose-500" : percent < 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-slate-600">{formatNumber(volume?.numeric_value, 0)} litros</p>
              <p className="mt-1 text-xs text-slate-400">Leitura {formatRelative(level.time)}</p>
            </>
          ) : (
            <EmptyState text="Sem leitura de nível." />
          )}
        </Card>

        <Card title="Bomba de recalque">
          {pump ? (
            <>
              <p className="text-4xl font-bold text-slate-900">{pump.value ? "LIGADA" : "DESLIGADA"}</p>
              <p className="mt-3 text-xs text-slate-400">Leitura {formatRelative(pump.time)}</p>
            </>
          ) : (
            <EmptyState text="Sem leitura da bomba." />
          )}
        </Card>

        <Card title="Estimativa de esvaziamento" subtitle="Projeção pelo consumo do período">
          {hoursToEmpty ? (
            <>
              <p className="text-4xl font-bold text-slate-900">{formatNumber(hoursToEmpty, 1)} h</p>
              <p className="mt-3 text-xs text-slate-500">
                Queda média de {formatNumber(dropPerHour, 1)}% por hora no período selecionado.
              </p>
            </>
          ) : (
            <p className="py-6 text-sm text-slate-500">
              Sem queda consistente no período — a caixa está estável ou enchendo.
            </p>
          )}
        </Card>
      </div>

      <Card
        title="Histórico do nível"
        action={<div className="w-56"><Select value={bucket} onChange={setBucket} options={BUCKETS} /></div>}
      >
        <MetricChart points={points} unit="%" color="#0284c7" />
      </Card>
    </>
  );
}
