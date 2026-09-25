import { useEffect, useState } from "react";
import { Car, Bike } from "lucide-react";
import { parkingAvailability, type ParkingLotView, type ParkingVehicleType } from "@predioon/shared";
import { useFeatures } from "../features.js";
import { PARKING_FEATURES } from "../feature-state.js";
import { api, ApiError } from "../api.js";
import { useResource } from "../use-resource.js";
import { formatDateTime } from "../format.js";
import { Badge, Button, Card, ErrorBanner, LoadingState } from "./primitives.js";
import { Field, Input, Select } from "./fields.js";

type Sensor = { id: string; name: string; type: string; enabled: boolean };
const LABELS = { CAR: "Carros", MOTORCYCLE: "Motos" };
const SOURCE = { UNKNOWN: "Sem medição", MANUAL: "Atualização manual", SENSOR: "Sensor automático" };

export function ParkingPanel({ buildingId, canManage = false }: { buildingId: string; canManage?: boolean }) {
  const flags = useFeatures();
  if (!flags.enabled("CAR_PARKING") && !flags.enabled("MOTORCYCLE_PARKING")) return null;
  return <ParkingWorkspace buildingId={buildingId} canManage={canManage} />;
}

function ParkingWorkspace({ buildingId, canManage }: { buildingId: string; canManage: boolean }) {
  const flags = useFeatures();
  const parking = useResource<{ items: ParkingLotView[] }>(`/parking?buildingId=${encodeURIComponent(buildingId)}`);
  const sensors = useResource<{ items: Sensor[] }>(canManage ? `/devices?buildingId=${encodeURIComponent(buildingId)}` : null);
  const [, setClockTick] = useState(0);
  const now = new Date();
  useEffect(() => {
    const timer = setInterval(() => { setClockTick(value => value + 1); parking.reload(); }, 15_000);
    return () => clearInterval(timer);
  }, [parking.reload]);
  return <Card title="Vagas disponíveis" subtitle="Carros e motos, com a origem e o horário da última contagem" action={<Button variant="ghost" onClick={parking.reload}>Atualizar</Button>}>
    {parking.error && <ErrorBanner message={parking.error} />}
    {parking.loading && !parking.data ? <LoadingState /> : <div className="grid gap-4 md:grid-cols-2">
      {(["CAR", "MOTORCYCLE"] as const).filter(kind => flags.enabled(PARKING_FEATURES[kind]!)).map(vehicleType => <ParkingCard key={`${buildingId}-${vehicleType}`} buildingId={buildingId} vehicleType={vehicleType}
        lot={parking.data?.items.find(item => item.vehicleType === vehicleType)} canManage={canManage && !!parking.data && !parking.error}
        sensors={sensors.data?.items.filter(item => item.type === "PARKING_SENSOR" && item.enabled) ?? []} now={now} failed={!!parking.error} reload={parking.reload} />)}
    </div>}
    {canManage && sensors.error && <p className="mt-3 text-xs text-rose-700">Não foi possível carregar os sensores: {sensors.error}</p>}
  </Card>;
}

function ParkingCard({ buildingId, vehicleType, lot, sensors, canManage, now, failed, reload }: {
  buildingId: string; vehicleType: ParkingVehicleType; lot?: ParkingLotView; sensors: Sensor[]; canManage: boolean; now: Date; failed: boolean; reload: () => void;
}) {
  const [editing, setEditing] = useState<"config" | "count" | null>(null);
  const [capacity, setCapacity] = useState("");
  const [occupied, setOccupied] = useState("");
  const [sensorId, setSensorId] = useState("");
  const [freshness, setFreshness] = useState("300");
  const [version, setVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const status = lot && !failed ? parkingAvailability(lot, now) : { available: null, status: "UNKNOWN" as const };
  const Icon = vehicleType === "CAR" ? Car : Bike;
  function edit(kind: "config" | "count") {
    setCapacity(lot ? String(lot.capacity) : ""); setOccupied(lot?.occupied === null || !lot ? "" : String(lot.occupied));
    setSensorId(lot?.sensorId ?? ""); setFreshness(String(lot?.staleAfterSeconds ?? 300)); setVersion(lot?.version ?? null);
    setError(null); setSaved(false); setEditing(kind);
  }
  async function save() {
    setError(null); setBusy(true);
    try {
      if (editing === "count" && lot) {
        if (!occupied.trim()) throw new Error("Informe a quantidade ocupada");
        await api.patch(`/parking/${lot.id}/occupancy`, { occupied: Number(occupied), version });
      } else {
        if (!capacity.trim()) throw new Error("Informe a capacidade total");
        const body = { capacity: Number(capacity), sensorId: sensorId || null, staleAfterSeconds: Number(freshness) };
        if (lot) await api.patch(`/parking/${lot.id}`, { ...body, version });
        else await api.post("/parking", { ...body, buildingId, vehicleType });
      }
      setEditing(null); setSaved(true); reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar vagas");
      if (cause instanceof ApiError && cause.status === 409) { setEditing(null); reload(); }
    } finally { setBusy(false); }
  }
  return <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Icon size={19} />{LABELS[vehicleType]}</h3>
      <Badge tone={status.status === "CURRENT" ? "success" : "warning"}>{status.status === "CURRENT" ? "Atualizado" : status.status === "STALE" ? "Desatualizado" : "Sem informação"}</Badge></div>
    <p className="mt-3 text-3xl font-bold text-slate-900">{status.available ?? "—"}<span className="ml-2 text-sm font-normal text-slate-500">livres</span></p>
    <p className="mt-1 text-sm text-slate-600">{lot ? `Capacidade: ${lot.capacity} • ${status.status === "CURRENT" ? `${lot.occupied} ocupadas` : "ocupação atual indisponível"}` : failed ? "Não foi possível consultar as vagas" : "Capacidade ainda não cadastrada"}</p>
    {lot && <div className="mt-3 text-xs leading-5 text-slate-500"><p>{SOURCE[lot.source]}</p><p>{lot.observedAt ? `Última contagem: ${formatDateTime(String(lot.observedAt))}` : "Aguardando primeira contagem"}</p>
      {status.status === "STALE" && <p>Último registro: {lot.occupied} ocupadas. Faça uma nova contagem.</p>}</div>}
    {error && <div className="mt-3"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>}
    {saved && <p role="status" className="mt-2 text-sm text-emerald-700">Vagas atualizadas.</p>}
    {canManage && !editing && <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => edit("config")}>{lot ? "Configurar" : "Cadastrar capacidade"}</Button>{lot && <Button onClick={() => edit("count")}>Informar ocupação</Button>}</div>}
    {canManage && editing && <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
      {editing === "count" ? <><Field label="Vagas ocupadas" hint={`De 0 a ${lot?.capacity ?? 0}`}><Input type="number" value={occupied} onChange={setOccupied} /></Field>{lot?.sensorId && <p className="text-xs text-slate-500">Uma leitura mais recente do sensor substituirá esta contagem manual.</p>}</> : <>
        <Field label="Capacidade total"><Input type="number" value={capacity} onChange={setCapacity} /></Field>
        <Field label="Contagem automática" hint="Ao trocar o sensor, a contagem fica indisponível até uma nova leitura."><Select value={sensorId} onChange={setSensorId} options={[{ value: "", label: "Sem sensor — informar manualmente" }, ...sensors.map(sensor => ({ value: sensor.id, label: sensor.name })), ...(sensorId && !sensors.some(sensor => sensor.id === sensorId) ? [{ value: sensorId, label: "Sensor vinculado indisponível" }] : [])]} /></Field>
        <Field label="Validade da contagem (segundos)" hint="De 30 a 86400 segundos. Após esse período, a disponibilidade fica desatualizada."><Input type="number" value={freshness} onChange={setFreshness} /></Field>
      </>}
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar"}</Button><Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>Cancelar</Button></div>
    </div>}
  </div>;
}
