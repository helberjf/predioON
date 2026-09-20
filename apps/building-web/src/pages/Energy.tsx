import { useState } from "react";
import { Card, EmptyState, formatNumber, formatRelative, Select, StatTile, useResource } from "@predioon/ui";
import type { LatestReading, Paged, SeriesPoint } from "@predioon/ui";
import { Zap } from "lucide-react";
import { MetricChart } from "../components/MetricChart.js";

const PHASES = ["voltage_l1", "voltage_l2", "voltage_l3"] as const;
const LABELS: Record<string, string> = { voltage_l1: "Fase L1", voltage_l2: "Fase L2", voltage_l3: "Fase L3" };

/** Below this the platform treats the phase as missing, matching the seeded alert rule. */
const PHASE_LOSS_VOLTS = 100;

export function Energy({ buildingId }: { buildingId: string }) {
  const [metric, setMetric] = useState<(typeof PHASES)[number]>("voltage_l1");
  const latest = useResource<Paged<LatestReading>>(`/telemetry/latest?buildingId=${buildingId}`);
  const from = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const series = useResource<{ items: SeriesPoint[] }>(
    `/telemetry/series?deviceId=phase_01&metric=${metric}&bucket=5m&from=${from}`,
  );

  const readings = PHASES.map((phase) => latest.data?.items.find((r) => r.metric === phase));

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Energia</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        {readings.map((reading, index) => {
          const phase = PHASES[index]!;
          const volts = Number(reading?.numeric_value ?? 0);
          const missing = !reading || volts < PHASE_LOSS_VOLTS;
          return (
            <StatTile
              key={phase}
              label={LABELS[phase]!}
              value={reading ? `${formatNumber(volts, 1)} V` : "—"}
              detail={reading ? (missing ? "possível falta de fase" : `leitura ${formatRelative(reading.time)}`) : "sem leitura"}
              icon={Zap}
              tone={missing ? "danger" : volts < 190 || volts > 240 ? "warning" : "success"}
            />
          );
        })}
      </div>

      <Card
        title="Histórico de tensão"
        subtitle="Últimas 6 horas"
        action={
          <div className="w-40">
            <Select
              value={metric}
              onChange={setMetric}
              options={PHASES.map((phase) => ({ value: phase, label: LABELS[phase]! }))}
            />
          </div>
        }
      >
        {latest.error ? <EmptyState text={latest.error} /> : <MetricChart points={series.data?.items ?? []} unit="V" color="#d97706" />}
      </Card>
    </>
  );
}
