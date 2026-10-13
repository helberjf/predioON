import { useState } from "react";
import { Droplets, Zap } from "lucide-react";
import { api } from "../api.js";
import { formatNumber } from "../format.js";
import { useResource } from "../use-resource.js";
import { Badge, Button, Card, ErrorBanner, ResourceFeedback } from "./primitives.js";

type Published = { buildingId: string; day: string; items: Array<{ kind: "ENERGY" | "WATER"; unit: string; today: number | null;
  history: Array<{ day: string; quantity: number; incomplete: boolean }> }> };
const LOOK = { ENERGY: { label: "Energia das áreas comuns", icon: Zap, tone: "bg-amber-50 text-amber-600", bar: "bg-amber-400" },
  WATER: { label: "Água do condomínio", icon: Droplets, tone: "bg-sky-50 text-sky-600", bar: "bg-sky-400" } } as const;
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** What the administration chose to show residents: daily quantities, and nothing about costs or equipment. */
export function PublishedConsumption({ buildingId }: { buildingId: string }) {
  const resource = useResource<Published>(`/monitoring/published?buildingId=${encodeURIComponent(buildingId)}`);
  if (!resource.data) return resource.errorStatus === 403
    ? <Card><p role="status" className="text-sm font-semibold text-[#153451]">O consumo não está disponível para moradores neste condomínio.</p><p className="mt-2 text-sm leading-6 text-slate-600">A administração do condomínio decide se o consumo é mostrado aos moradores.</p></Card>
    : <Card><ResourceFeedback resource={resource} emptyText="Sem consumo para mostrar." /></Card>;
  const items = resource.data.items;
  return <div className="space-y-4">
    <div><h2 className="text-xl font-bold text-[#153451]">Consumo do condomínio</h2><p className="mt-1 text-xs text-slate-500">Últimos 7 dias · informado pela administração</p></div>
    {!items.length && <Card><p className="text-sm text-slate-600">Ainda não há consumo medido para mostrar.</p></Card>}
    {items.map(item => {
      const look = LOOK[item.kind], Icon = look.icon, peak = Math.max(...item.history.map(row => row.quantity), 0);
      return <Card key={item.kind}>
        <div className="flex items-center gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${look.tone}`}><Icon size={22} /></span>
          <div className="min-w-0 flex-1"><p className="text-sm font-bold text-[#152d4b]">{look.label}</p><p className="text-xs text-slate-500">Hoje até agora</p></div>
          <p className="text-xl font-bold text-[#173451]">{item.today === null ? "—" : `${formatNumber(item.today, 1)} ${item.unit}`}</p>
        </div>
        {item.history.length ? <ul className="mt-4 space-y-2" aria-label={`${look.label} por dia`}>{item.history.map(row => <li key={row.day} className="flex items-center gap-3 text-xs text-slate-600">
          <span className="w-10 shrink-0 tabular-nums">{shortDay(row.day)}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${look.bar}`} style={{ width: `${peak ? Math.max(2, row.quantity / peak * 100) : 0}%` }} /></span>
          <span className="w-24 shrink-0 text-right tabular-nums">{formatNumber(row.quantity, 1)} {item.unit}</span>
          {row.incomplete && <Badge tone="neutral">parcial</Badge>}
        </li>)}</ul> : <p className="mt-3 text-xs text-slate-500">Sem medição nos últimos 7 dias.</p>}
      </Card>;
    })}
  </div>;
}

/** The administration's switch. Residents see nothing until it is turned on. */
export function ResidentConsumptionSwitch({ buildingId }: { buildingId: string }) {
  const access = useResource<{ released: boolean }>(`/monitoring/resident-access?buildingId=${encodeURIComponent(buildingId)}`);
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  if (!access.data) return access.errorStatus === 403 ? null : <Card title="Consumo para moradores"><ResourceFeedback resource={access} emptyText="" /></Card>;
  const released = access.data.released;
  async function change() {
    setPending(true); setError(null);
    try { await api.put("/monitoring/resident-access", { buildingId, released: !released }); access.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setPending(false); }
  }
  return <Card title="Consumo para moradores" subtitle="Você decide se os moradores veem o consumo do condomínio" action={<Badge tone={released ? "success" : "neutral"}>{released ? "Liberado" : "Não liberado"}</Badge>}>
    {error && <div className="mb-3"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>}
    <p className="text-sm leading-6 text-slate-600">{released
      ? "Os moradores veem a quantidade diária de energia e de água dos últimos 7 dias. Tarifas, custos, limites, bomba e equipamentos não são mostrados."
      : "Os moradores não veem nenhum dado de consumo. Ao liberar, eles passam a ver somente a quantidade diária de energia e de água, sem tarifas, custos, limites, bomba ou equipamentos."}</p>
    <div className="mt-4"><Button variant={released ? "secondary" : "primary"} disabled={pending} onClick={() => void change()}>{pending ? "Salvando…" : released ? "Deixar de mostrar aos moradores" : "Liberar para moradores"}</Button></div>
  </Card>;
}
