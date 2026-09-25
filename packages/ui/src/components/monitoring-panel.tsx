import { useEffect, useState } from "react";
import type { UsageKind } from "@predioon/shared";
import { useFeatures } from "../features.js";
import { monitoringFeatureInput, USAGE_FEATURES } from "../feature-state.js";
import { api } from "../api.js";
import { useResource } from "../use-resource.js";
import type { Device, Paged } from "../types.js";
import { formatDateTime, formatNumber } from "../format.js";
import { Badge, Button, Card, ErrorBanner, ResourceFeedback } from "./primitives.js";
import { Field, Input, Select } from "./fields.js";

type Config = { tariff: number | null; dailyLimit: number | null; dailyCostLimit: number | null; continuousLimitMinutes: number | null;
  maxGapSeconds: number; adaptiveEnabled: boolean; minimumHistoryDays: number; deviationPercent: number; enabled: boolean };
type Day = { day: string; quantity: number | null; estimatedCost: number | null; coveredSeconds: number; coveragePercent?: number; resets: number; samples: number; lastAt: string; incomplete?: boolean };
type Profile = Config & { id: string; deviceId: string; kind: UsageKind; deviceName: string; unit: string; fresh: boolean; today: Day | null;
  lastReadingAt: string | null; continuousMinutes: number | null; reference: { expected: number; samples: number } | null;
  deviation: { anomalous: boolean; changePercent: number | null } | null; learningDays: number; history: Day[]; analysisStatus: string };
type Summary = { buildingId: string; timezone: string; day: string; items: Profile[] };
const names: Record<UsageKind, string> = { ENERGY: "Energia", WATER: "Água", PUMP: "Bomba" };
const units: Record<UsageKind, string> = { ENERGY: "kWh", WATER: "m³", PUMP: "minutos" };
const defaults: Config = { tariff: null, dailyLimit: null, dailyCostLimit: null, continuousLimitMinutes: null, maxGapSeconds: 300,
  adaptiveEnabled: true, minimumHistoryDays: 7, deviationPercent: 50, enabled: true };
const numericFields = ["tariff", "dailyLimit", "dailyCostLimit", "continuousLimitMinutes", "maxGapSeconds", "minimumHistoryDays", "deviationPercent"] as const;
function ConfigEditor({ buildingId, profile, devices, onSaved, kinds }: { buildingId: string; profile?: Profile; devices: Device[]; onSaved: () => void; kinds?: UsageKind[] }) {
  const flags = useFeatures();
  const allowedKinds = (Object.keys(names) as UsageKind[]).filter(kind => (!kinds || kinds.includes(kind)) && flags.enabled(USAGE_FEATURES[kind]!));
  const [kind, setKind] = useState<UsageKind>(profile?.kind ?? allowedKinds[0] ?? "ENERGY");
  const [deviceId, setDeviceId] = useState(profile?.deviceId ?? "");
  const [form, setForm] = useState(() => Object.fromEntries(numericFields.map(key => [key, (profile ?? defaults)[key]?.toString() ?? ""])) as Record<typeof numericFields[number], string>);
  const [adaptive, setAdaptive] = useState(profile?.adaptiveEnabled ?? true), [enabled, setEnabled] = useState(profile?.enabled ?? true);
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [success, setSuccess] = useState("");
  const labels = { tariff: `Tarifa (R$/${units[kind]})`, dailyLimit: `Limite diário (${units[kind]})`, dailyCostLimit: "Limite de custo diário (R$)",
    continuousLimitMinutes: "Limite contínuo da bomba (minutos)", maxGapSeconds: "Intervalo máximo entre leituras (segundos)",
    minimumHistoryDays: "Dias válidos para aprender (7 a 28)", deviationPercent: "Desvio mínimo sobre o histórico (%)" };
  async function save() {
    setPending(true); setError(null); setSuccess("");
    try {
      const values = Object.fromEntries(numericFields.map(key => [key, form[key].trim() === "" ? null : Number(form[key])]));
      if (numericFields.some(key => values[key] !== null && !Number.isFinite(values[key]))) throw new Error("Informe valores numéricos válidos.");
      const body = monitoringFeatureInput({ ...values, adaptiveEnabled: adaptive, enabled,
        ...(kind === "PUMP" ? { tariff: null, dailyCostLimit: null } : { continuousLimitMinutes: null }) }, flags.items);
      if (profile) await api.patch(`/monitoring/${profile.id}`, body);
      else await api.post("/monitoring", { ...body, buildingId, deviceId, kind });
      setSuccess("Configuração salva. As próximas leituras usarão estes parâmetros."); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar configuração"); }
    finally { setPending(false); }
  }
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
    {error && <ErrorBanner message={error} />}{success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
    {!profile && <div className="grid gap-3 sm:grid-cols-2"><Field label="O que acompanhar"><Select value={kind} onChange={setKind} options={allowedKinds.map(value => ({ value, label: names[value] }))} /></Field><Field label="Equipamento"><Select value={deviceId} onChange={setDeviceId} options={[{ value: "", label: "Selecione um equipamento" }, ...devices.filter(d => d.enabled).map(d => ({ value: d.id, label: d.name }))]} /></Field></div>}
    <div className="grid gap-3 sm:grid-cols-2">{numericFields.filter(key => (flags.enabled("AI_ANALYSIS") || !["minimumHistoryDays", "deviationPercent"].includes(key)) && (kind === "PUMP" ? key !== "tariff" && key !== "dailyCostLimit" : key !== "continuousLimitMinutes")).map(key => <Field key={key} label={labels[key]} hint={["tariff","dailyLimit","dailyCostLimit","continuousLimitMinutes"].includes(key) ? "Opcional. Em branco, não é aplicado." : undefined}>
      <input className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" type="number" step="any" min="0" value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} />
    </Field>)}</div>
    {flags.enabled("AI_ANALYSIS") && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={adaptive} onChange={event => setAdaptive(event.target.checked)} />Analisar desvios com referência aprendida do histórico</label>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Monitoramento ativo</label>
    <p className="text-xs leading-5 text-slate-500">Energia usa o medidor acumulado em kWh; água, o hidrômetro em m³; bomba, o sinal ligada/desligada. Falhas além do intervalo configurado ficam sem estimativa. A tarifa é aplicada aos próximos intervalos e não reescreve os custos antigos.</p>
    <Button type="submit" disabled={pending || (!profile && !deviceId)}>{pending ? "Salvando…" : "Salvar configuração"}</Button>
  </form>;
}

export function MonitoringPanel({ buildingId, canManage = false, kinds }: { buildingId: string; canManage?: boolean; kinds?: UsageKind[] }) {
  const flags = useFeatures();
  const allowedKinds = (Object.keys(names) as UsageKind[]).filter(kind => (!kinds || kinds.includes(kind)) && flags.enabled(USAGE_FEATURES[kind]!));
  const [day, setDay] = useState("");
  const resource = useResource<Summary>(allowedKinds.length ? `/monitoring?buildingId=${encodeURIComponent(buildingId)}${day ? `&day=${encodeURIComponent(day)}` : ""}` : null);
  const devices = useResource<Paged<Device>>(canManage && allowedKinds.length ? `/devices?buildingId=${encodeURIComponent(buildingId)}` : null);
  useEffect(() => { const timer = setInterval(resource.reload, 10000); return () => clearInterval(timer); }, [resource.reload]);
  const items = (resource.data?.items ?? []).filter(p => allowedKinds.includes(p.kind));
  if (!allowedKinds.length) return null;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold text-[#153451]">Consumo e análise do histórico</h2><p className="mt-1 text-xs text-slate-500">{resource.data?.timezone ?? "Fuso do imóvel"} · valores calculados dos intervalos medidos</p></div><div className="flex items-end gap-2"><Field label="Dia"><Input type="date" value={day || resource.data?.day || ""} onChange={setDay} /></Field><Button variant="secondary" onClick={() => { setDay(""); resource.reload(); }}>Hoje</Button></div></div>
    {resource.error && <ErrorBanner message={resource.error} />}
    {!items.length && <Card><ResourceFeedback resource={resource} emptyText="Nenhum monitoramento configurado para esta seleção." /></Card>}
    {items.map(profile => <Card key={profile.id} title={`${names[profile.kind]} · ${profile.deviceName}`} action={<Badge tone={!profile.enabled || !profile.fresh ? "neutral" : flags.enabled("AI_ANALYSIS") && profile.deviation?.anomalous ? "danger" : "info"}>{!profile.enabled ? "Pausado" : !profile.fresh ? "Sem leitura atual" : "Recebendo leituras"}</Badge>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div><p className="text-xs text-slate-500">Acumulado no dia selecionado</p><p className="mt-2 text-2xl font-bold text-[#153451]">{profile.today?.quantity == null ? "—" : `${formatNumber(profile.today.quantity, 2)} ${profile.unit}`}</p><p className="mt-1 text-xs text-slate-500">{profile.today ? `${formatNumber(profile.today.coveragePercent ?? 0, 0)}% do período com dados` : "Aguardando intervalos válidos"}</p></div>
        <div><p className="text-xs text-slate-500">{profile.kind === "PUMP" ? "Ciclo contínuo atual" : "Custo estimado do dia"}</p><p className="mt-2 text-2xl font-bold text-[#153451]">{profile.kind === "PUMP" ? profile.continuousMinutes === null ? "—" : `${formatNumber(profile.continuousMinutes, 1)} min` : profile.today?.estimatedCost == null ? "—" : `R$ ${formatNumber(profile.today.estimatedCost, 2)}`}</p><p className="mt-1 text-xs text-slate-500">{profile.kind === "PUMP" ? "Até a última leitura válida" : profile.tariff === null ? "Tarifa não configurada" : `Tarifa atual: R$ ${formatNumber(profile.tariff, 3)}/${profile.unit}`}</p></div>
        {flags.enabled("AI_ANALYSIS") && <div><p className="text-xs text-slate-500">Referência diária aprendida</p><p className="mt-2 text-2xl font-bold text-[#153451]">{profile.reference ? `${formatNumber(profile.reference.expected, 2)} ${profile.unit}` : "—"}</p><p className="mt-1 text-xs text-slate-500">{!profile.adaptiveEnabled ? "Análise desativada" : profile.reference ? `${profile.reference.samples} dias com cobertura suficiente` : `Aprendendo: ${profile.learningDays}/${profile.minimumHistoryDays} dias válidos`}</p></div>}
      </div>
      {flags.enabled("AI_ANALYSIS") && profile.deviation?.anomalous && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Acumulado acima do histórico{profile.deviation.changePercent === null ? "." : ` em ${formatNumber(profile.deviation.changePercent, 0)}%.`} Verifique a operação e possíveis usos fora da rotina.</p>}
      {profile.today?.incomplete && <p role="status" className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Período incompleto por pausa do recurso. Os valores incluem apenas os intervalos medidos e este dia não será usado no aprendizado.</p>}
      <p className="mt-4 text-xs leading-5 text-slate-500">{profile.lastReadingAt ? `Última leitura: ${formatDateTime(profile.lastReadingAt)}.` : "Sem leituras recebidas."} {profile.today?.resets ? `${profile.today.resets} reinício(s) de medidor; o período afetado ficou sem cálculo.` : ""} {profile.today && (profile.today.coveragePercent ?? 0) < 80 ? "Cobertura parcial: o acumulado não representa todo o dia." : ""}</p>
      <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-sm font-medium text-slate-600">Histórico diário</summary>{flags.enabled("AI_ANALYSIS") && <p className="my-3 text-xs leading-5 text-slate-500">A análise estatística aprende a mediana e a variação de até 28 dias anteriores, com no mínimo 80% de cobertura. Um desvio precisa superar a variação aprendida e o percentual configurado. O dia atual é comparado com a referência diária completa; ainda não é uma previsão de fechamento. Valores entre duas leituras que cruzam a meia-noite são distribuídos proporcionalmente.</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="py-2">Dia</th><th>Acumulado</th><th>Custo estimado</th><th>Horas medidas</th></tr></thead><tbody>{profile.history.slice(-14).reverse().map(row => <tr key={row.day} className="border-b border-slate-100"><td className="py-2">{row.day.split("-").reverse().join("/")}</td><td>{row.coveredSeconds ? `${formatNumber(row.quantity, 2)} ${profile.unit}` : "Sem dados"}</td><td>{row.estimatedCost === null || !row.coveredSeconds ? "—" : `R$ ${formatNumber(row.estimatedCost, 2)}`}</td><td>{formatNumber(row.coveredSeconds / 3600, 1)}</td></tr>)}</tbody></table></div>
      </details>
      {canManage && <details className="mt-3 border-t border-slate-100 pt-3"><summary className="mb-4 cursor-pointer text-sm font-medium text-emerald-700">Configurar tarifas, limites e análise</summary><ConfigEditor buildingId={buildingId} profile={profile} devices={devices.data?.items ?? []} onSaved={resource.reload} kinds={allowedKinds} /></details>}
    </Card>)}
    {canManage && <Card title="Adicionar monitoramento"><details><summary className="cursor-pointer text-sm text-emerald-700">Selecionar equipamento e parâmetros</summary><div className="mt-4">{devices.error && <ErrorBanner message={devices.error} />}<ConfigEditor buildingId={buildingId} devices={devices.data?.items ?? []} onSaved={resource.reload} kinds={allowedKinds} /></div></details></Card>}
    <p className="text-xs leading-5 text-slate-500">Custos são estimativas do consumo medido com a tarifa informada, sem cálculo completo de tributos e cobranças da concessionária. Alertas sinalizam desvios para investigação; não identificam sozinhos a causa.</p>
  </div>;
}
