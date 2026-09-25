import { useEffect, useState } from "react";
import { Activity, Droplets, RefreshCw, Ruler } from "lucide-react";
import { Badge, booleanReading, Button, Card, ErrorBanner, findReading, formatNumber, formatRelative, numericReading, PageHeading, readingStatus, sensorChoices, StatTile, useResource, WaterTank } from "@predioon/ui";
import type { Device, LatestReading, Paged } from "@predioon/ui";
import { HistoryCard } from "../components/HistoryCard.js";
import { SensorPicker } from "../components/SensorPicker.js";
import { Feature, MonitoringPanel } from "@predioon/ui";

export function Water({ buildingId }: { buildingId: string }) {
  const latest = useResource<Paged<LatestReading>>(`/telemetry/latest?buildingId=${encodeURIComponent(buildingId)}`);
  const devices = useResource<Paged<Device>>(`/devices?buildingId=${encodeURIComponent(buildingId)}`);
  useEffect(() => {
    const timer = setInterval(latest.reload, 10_000);
    return () => clearInterval(timer);
  }, [latest.reload]);
  const [selected, setSelected] = useState("");
  const [selectedPump, setSelectedPump] = useState("");
  const readings = latest.data?.items ?? [];
  const sensors = sensorChoices(readings, ["water_level_percent", "distance_mm", "volume_liters"], devices.data?.items, ["WATER_LEVEL_SENSOR"]);
  const pumps = sensorChoices(readings, ["pump_running"], devices.data?.items, ["PUMP_MONITOR"]);
  const deviceId = sensors.some((sensor) => sensor.value === selected) ? selected : sensors[0]?.value ?? "";
  const pumpId = pumps.some((pump) => pump.value === selectedPump) ? selectedPump : pumps[0]?.value ?? "";
  const level = findReading(readings, deviceId, "water_level_percent");
  const volume = findReading(readings, deviceId, "volume_liters");
  const distance = findReading(readings, deviceId, "distance_mm");
  const pump = findReading(readings, pumpId, "pump_running");
  const percent = numericReading(level);
  const running = booleanReading(pump);
  const fresh = readingStatus(level) === "Leitura recente";
  const detail = (reading?: LatestReading) => reading ? `${readingStatus(reading)} · ${formatRelative(reading.time)}` : latest.loading ? "Carregando…" : "Sem leitura recebida";

  return <>
    <PageHeading title="Água e reservatórios" description="Acompanhe nível, volume e funcionamento da bomba." action={<Button variant="secondary" onClick={() => { latest.reload(); devices.reload(); }} disabled={latest.loading}><RefreshCw size={16} />Atualizar leituras</Button>} />
    {latest.error && <ErrorBanner message={latest.error} />}{devices.error && <ErrorBanner message={devices.error} />}
    <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
      <Feature name="WATER_TANK"><Card title="Reservatório" subtitle="Dados do sensor selecionado" action={<Badge tone={fresh ? "info" : "neutral"}>{latest.loading && !level ? "Carregando" : readingStatus(level)}</Badge>}>
        <SensorPicker label="Sensor de nível" value={deviceId} options={sensors} onChange={setSelected} />
        <WaterTank level={percent} />
        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500"><span>{level ? `Última leitura ${formatRelative(level.time)}` : "Aguardando leitura do sensor"}</span><span>{percent !== null && fresh && percent < 20 ? "Nível abaixo de 20%" : "Nível informado pelo sensor"}</span></div>
      </Card></Feature>
      <div className="grid gap-5 sm:grid-cols-2">
        <Feature name="WATER_TANK"><StatTile label="Volume informado" value={volume && numericReading(volume) !== null ? `${formatNumber(numericReading(volume))} L` : "—"} detail={detail(volume)} icon={Droplets} tone="info" /></Feature>
        <Feature name="WATER_TANK"><StatTile label="Distância medida" value={distance && numericReading(distance) !== null ? `${formatNumber(numericReading(distance))} mm` : "—"} detail={detail(distance)} icon={Ruler} /></Feature>
        <Feature name="PUMP"><Card title="Bomba de recalque" className="sm:col-span-2" action={<Activity size={18} className="text-emerald-600" />}>
          <SensorPicker label="Monitor da bomba" value={pumpId} options={pumps} onChange={setSelectedPump} />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-2xl font-bold text-slate-900">{running === null ? "Sem informação" : running ? "Ligada" : "Desligada"}</p><Badge tone="neutral">{readingStatus(pump)}</Badge></div><p className="mt-2 text-xs text-slate-500">{detail(pump)}</p>
        </Card></Feature>
      </div>
    </div>
    <Feature name="WATER_TANK"><HistoryCard deviceId={deviceId} metric="water_level_percent" title="Histórico do nível de água" unit="%" color="#0ea5e9" /></Feature>
    <MonitoringPanel buildingId={buildingId} canManage kinds={["WATER", "PUMP"]} />
    <p className="text-xs leading-5 text-slate-400">Leituras com mais de 15 minutos são identificadas como antigas. Volume e distância aparecem apenas quando enviados pelo sensor.</p>
  </>;
}
