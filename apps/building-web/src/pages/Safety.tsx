import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Droplets, Flame, RefreshCw, Settings2, Thermometer, Waves, Wind, type LucideIcon } from "lucide-react";
import { sensorReadingState } from "@predioon/shared";
import { Feature, Badge, Button, Card, ErrorBanner, findReading, formatNumber, formatRelative, numericReading, PageHeading, sensorChoices, useResource } from "@predioon/ui";
import type { Device, LatestReading, Paged } from "@predioon/ui";
import { HistoryCard } from "../components/HistoryCard.js";
import { SensorPicker } from "../components/SensorPicker.js";

type DetectionProps = {
  title: string; description: string; metrics: string[]; types: string[]; icon: LucideIcon;
  readings: LatestReading[]; devices: Device[]; loading: boolean;
};

function DetectionCard({ title, description, metrics, types, icon: Icon, readings, devices, loading }: DetectionProps) {
  const [selected, setSelected] = useState("");
  const options = sensorChoices(readings, metrics, devices, types);
  const deviceId = options.some((option) => option.value === selected) ? selected : options[0]?.value ?? "";
  // Canonical metric takes precedence over its legacy equivalent for the same sensor.
  const reading = metrics.map((metric) => findReading(readings, deviceId, metric)).find(Boolean);
  const enabled = devices.find((device) => device.id === deviceId)?.enabled !== false;
  const state = sensorReadingState(reading, Date.now(), enabled);
  const gas = findReading(readings, deviceId, "gas_ppm");
  const gasState = sensorReadingState(gas, Date.now(), enabled);
  return <Card title={title} subtitle={description} action={<Icon size={20} className={state.status === "detected" ? "text-rose-600" : "text-slate-400"} />}>
    <SensorPicker label={`Sensor · ${title}`} options={options} value={deviceId} onChange={setSelected} />
    <div className="mt-5 space-y-3" aria-live="polite">
      <Badge tone={state.status === "detected" ? "danger" : state.status === "clear" ? "info" : "neutral"}>{loading && !reading ? "Carregando…" : state.label}</Badge>
      {state.status === "detected" && <p className="text-sm font-medium text-rose-700">Verifique o local e siga o procedimento do condomínio.</p>}
      <p className="text-xs text-slate-500">{reading ? `Última leitura ${formatRelative(reading.time)}` : "Aguardando dados deste sensor"}</p>
      {types.includes("GAS_SENSOR") && <div className="border-t border-slate-100 pt-3"><p className="text-xs text-slate-500">Concentração informada</p><p className="mt-1 text-xl font-semibold text-slate-900">{gasState.status === "reading" && numericReading(gas) !== null ? `${formatNumber(numericReading(gas), 0)} ppm` : "—"}</p><p className="mt-1 text-xs text-slate-500">{gasState.label}. O estado de detecção é enviado pelo detector.</p></div>}
    </div>
  </Card>;
}

export function Safety({ buildingId }: { buildingId: string }) {
  const latest = useResource<Paged<LatestReading>>(`/telemetry/latest?buildingId=${encodeURIComponent(buildingId)}`);
  const sensors = useResource<Paged<Device>>(`/devices?buildingId=${encodeURIComponent(buildingId)}`);
  const [selectedTemperature, setSelectedTemperature] = useState("");
  useEffect(() => { const timer = setInterval(latest.reload, 10_000); return () => clearInterval(timer); }, [latest.reload]);
  const readings = latest.data?.items ?? [];
  const devices = sensors.data?.items ?? [];
  const temperatures = sensorChoices(readings, ["temperature_c"], devices, ["TEMPERATURE_SENSOR"]);
  const temperatureId = temperatures.some((sensor) => sensor.value === selectedTemperature) ? selectedTemperature : temperatures[0]?.value ?? "";
  const temperature = findReading(readings, temperatureId, "temperature_c");
  const temperatureState = sensorReadingState(temperature, Date.now(), devices.find((device) => device.id === temperatureId)?.enabled !== false);
  const shared = { readings, devices, loading: latest.loading };

  return <>
    <PageHeading title="Sensores e segurança" description="Gás, central de incêndio, vazamentos e temperatura por sensor." action={<Button variant="secondary" disabled={latest.loading} onClick={() => { latest.reload(); sensors.reload(); }}><RefreshCw size={16} />Atualizar leituras</Button>} />
    {latest.error && <ErrorBanner message={latest.error} />}{sensors.error && <ErrorBanner message={sensors.error} />}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><p>Sem dados recentes, o estado atual permanece desconhecido. Alertas abertos devem ser acompanhados separadamente.</p><div className="flex shrink-0 gap-4"><Link to="/alertas" className="font-semibold text-emerald-700">Ver alertas</Link><Link to="/regras" className="inline-flex items-center gap-1 font-semibold text-emerald-700"><Settings2 size={15} />Regras de alerta</Link></div></div>
    <div className="grid gap-5 lg:grid-cols-2">
      <Feature name="GAS"><DetectionCard {...shared} title="Gás" description="Detecção e concentração quando disponíveis" metrics={["gas_detected"]} types={["GAS_SENSOR"]} icon={Wind} /></Feature>
      <Feature name="SMOKE"><DetectionCard {...shared} title="Central de incêndio" description="Sinal do relé de alarme da central" metrics={["smoke_detected"]} types={["SMOKE_PANEL_RELAY"]} icon={Flame} /></Feature>
      <Feature name="WATER_LEAK"><DetectionCard {...shared} title="Vazamento de água" description="Pontos monitorados de água" metrics={["water_leak_detected", "leak_detected"]} types={["LEAK_SENSOR"]} icon={Droplets} /></Feature>
      <Feature name="SEWAGE_LEAK"><DetectionCard {...shared} title="Vazamento de esgoto" description="Pontos monitorados de esgoto" metrics={["sewage_leak_detected"]} types={["SEWAGE_LEAK_SENSOR"]} icon={Waves} /></Feature>
    </div>
    <Feature name="TEMPERATURE"><Card title="Temperatura" subtitle="Leitura da sala técnica ou ambiente selecionado" action={<Thermometer size={20} className="text-slate-400" />}>
      <div className="grid gap-5 sm:grid-cols-2"><SensorPicker label="Sensor de temperatura" options={temperatures} value={temperatureId} onChange={setSelectedTemperature} /><div><p className="text-3xl font-bold text-slate-900">{temperatureState.status === "reading" && numericReading(temperature) !== null ? `${formatNumber(numericReading(temperature), 1)} °C` : "—"}</p><p className="mt-2 text-xs text-slate-500">{temperatureState.label}{temperature ? ` · ${formatRelative(temperature.time)}` : ""}</p></div></div>
    </Card>
    <HistoryCard deviceId={temperatureId} metric="temperature_c" title="Histórico de temperatura" unit="°C" color="#f59e0b" /></Feature>
    <p className="text-xs leading-5 text-slate-500">As detecções exibem o sinal recebido do equipamento. Leituras com mais de 15 minutos ou qualidade não validada não descrevem o estado atual. Limites e procedimentos dependem do projeto e da configuração dos sensores.</p>
  </>;
}
