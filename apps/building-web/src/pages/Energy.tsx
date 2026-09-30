import { useEffect, useState } from "react";
import { RefreshCw, Zap } from "lucide-react";
import { Button, Card, ErrorBanner, findReading, formatNumber, formatRelative, numericReading, PageHeading, readingStatus, Select, sensorChoices, StatTile, useResource } from "@predioon/ui";
import type { Device, LatestReading, Paged } from "@predioon/ui";
import { HistoryCard } from "../components/HistoryCard.js";
import { SensorPicker } from "../components/SensorPicker.js";
import { Feature, MonitoringPanel } from "@predioon/ui";

const PHASES = ["voltage_l1", "voltage_l2", "voltage_l3"] as const;
const LABELS: Record<string, string> = { voltage_l1: "Fase L1", voltage_l2: "Fase L2", voltage_l3: "Fase L3" };

export function Energy({ buildingId }: { buildingId: string }) {
  const [metric, setMetric] = useState<(typeof PHASES)[number]>("voltage_l1");
  const [selected, setSelected] = useState("");
  const latest = useResource<Paged<LatestReading>>(`/telemetry/latest?buildingId=${encodeURIComponent(buildingId)}`);
  const devices = useResource<Paged<Device>>(`/devices?buildingId=${encodeURIComponent(buildingId)}`);
  useEffect(() => {
    const timer = setInterval(latest.reload, 10_000);
    return () => clearInterval(timer);
  }, [latest.reload]);
  const readings = latest.data?.items ?? [];
  const sensors = sensorChoices(readings, PHASES, devices.data?.items, ["PHASE_MONITOR"]);
  const deviceId = sensors.some((sensor) => sensor.value === selected) ? selected : sensors[0]?.value ?? "";

  return <>
    <PageHeading title="Monitoramento de energia" description="Tensão medida nas três fases do condomínio." action={<Button variant="secondary" onClick={() => { latest.reload(); devices.reload(); }} disabled={latest.loading}><RefreshCw size={16} />Atualizar leituras</Button>} />
    {latest.error && <ErrorBanner message={latest.error} />}{devices.error && <ErrorBanner message={devices.error} />}
    <Feature name="ELECTRICAL"><Card><div className="grid gap-4 sm:grid-cols-2"><SensorPicker label="Monitor de energia" value={deviceId} options={sensors} onChange={setSelected} /><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">Fase exibida no histórico</span><Select value={metric} onChange={setMetric} options={PHASES.map((phase) => ({ value: phase, label: LABELS[phase]! }))} /></label></div></Card>
    <div className="grid gap-4 sm:grid-cols-3">{PHASES.map((phase) => {
      const reading = findReading(readings, deviceId, phase);
      const volts = numericReading(reading);
      const fresh = readingStatus(reading) === "Leitura recente";
      return <StatTile key={phase} label={LABELS[phase]!} value={volts === null ? "—" : `${formatNumber(volts, 1)} V`} detail={reading ? `${readingStatus(reading)} · ${formatRelative(reading.time)}${fresh && volts !== null && volts < 100 ? " · possível falta de fase" : ""}` : latest.loading ? "Carregando…" : "Sem leitura recebida"} icon={Zap} tone={volts === null || !fresh ? "neutral" : volts < 100 ? "danger" : "warning"} />;
    })}</div>
    <HistoryCard deviceId={deviceId} metric={metric} title={`Histórico de tensão · ${LABELS[metric]}`} unit="V" color="#e2a325" initialBucket="5m" /></Feature>
    <MonitoringPanel buildingId={buildingId} canManage kinds={["ENERGY"]} />
    <p className="text-xs leading-5 text-slate-400">Os alertas seguem as regras configuradas para cada sensor. Leituras antigas ou ausentes não confirmam o estado atual da rede.</p>
  </>;
}
