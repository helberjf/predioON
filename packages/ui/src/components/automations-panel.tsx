import { useRef, useState } from "react";
import type { TeamView } from "@predioon/contracts/tenancy";
import type { AssetListResponse } from "@predioon/contracts/assets";
import type { AddAutomationVersionRequest, AlertSeverity, AutomationDefinition, AutomationDetail, AutomationListResponse, AutomationSimulation, AutomationStateRequest, AutomationVersionView, AutomationView, CreateAutomationRequest, PublishAutomationRequest } from "@predioon/contracts/automations";
import { api } from "../api.js";
import { useResource } from "../use-resource.js";
import { useTenancyCollection } from "../use-tenancy-collection.js";
import { formatDateTime } from "../format.js";
import { Badge, Button, Card, EmptyState, ErrorBanner, ResourceFeedback, type Tone } from "./primitives.js";
import { Field, Input, Select } from "./fields.js";

type Device = { id: string; name: string; type: string };
type Options = Array<{ value: string; label: string }>;
const SEVERITY: Record<AlertSeverity, string> = { INFO: "Informativo", LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta", CRITICAL: "Crítica" };
const SEVERITIES = (Object.keys(SEVERITY) as AlertSeverity[]).map(value => ({ value, label: `${SEVERITY[value]} ou mais grave` }));
const PRIORITIES = [{ value: "LOW", label: "Baixa" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "Alta" }, { value: "URGENT", label: "Urgente" }];
const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  CREATED: { label: "Ordem aberta", tone: "success" }, SKIPPED_COOLDOWN: { label: "Em pausa", tone: "neutral" }, FAILED: { label: "Falhou", tone: "danger" },
};
const EMPTY = { name: "", alertTypes: "", minSeverity: "HIGH", deviceId: "", orderTitle: "", orderPriority: "NORMAL", assignedTeamId: "", assetId: "", cooldownMinutes: "60" };
type Draft = typeof EMPTY;
const definitionOf = (draft: Draft): AutomationDefinition => ({
  alertTypes: [...new Set(draft.alertTypes.split(",").map(type => type.trim()).filter(Boolean))], minSeverity: draft.minSeverity as AlertSeverity,
  deviceId: draft.deviceId || null, orderTitle: draft.orderTitle.trim(), orderPriority: draft.orderPriority as AutomationDefinition["orderPriority"],
  assignedTeamId: draft.assignedTeamId || null, assetId: draft.assetId || null, cooldownMinutes: Number(draft.cooldownMinutes || 0),
});
const draftOf = (name: string, version: AutomationVersionView): Draft => ({ name, alertTypes: version.alertTypes.join(", "), minSeverity: version.minSeverity, deviceId: version.deviceId ?? "",
  orderTitle: version.orderTitle, orderPriority: version.orderPriority, assignedTeamId: version.assignedTeamId ?? "", assetId: version.assetId ?? "", cooldownMinutes: String(version.cooldownMinutes) });
const statusOf = (rule: AutomationView): { label: string; tone: Tone } => rule.enabled ? { label: "Ativa", tone: "success" }
  : rule.publishedVersion === null ? { label: "Rascunho", tone: "warning" } : { label: "Desativada", tone: "neutral" };

/** Rules that open a work order when an alert arrives. Nothing here can act on equipment. */
export function AutomationsPanel({ buildingId }: { buildingId: string }) {
  const scope = `buildingId=${encodeURIComponent(buildingId)}`;
  const rules = useResource<AutomationListResponse>(`/v1/automations?${scope}`);
  const canManage = rules.data?.canManage === true;
  const teams = useTenancyCollection<TeamView>(canManage ? `/v1/tenancy/teams?${scope}` : null);
  const assets = useResource<AssetListResponse>(canManage ? `/v1/assets?${scope}&limit=100` : null);
  const devices = useResource<{ items: Device[] }>(canManage ? `/devices?${scope}` : null);
  const [form, setForm] = useState<Draft>(EMPTY);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Runs change without touching the rule, so open details reload with every refresh.
  const [refreshed, setRefreshed] = useState(0);
  const refresh = () => { setRefreshed(value => value + 1); rules.reload(); };
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const options = {
    teams: [{ value: "", label: "Sem equipe" }, ...teams.data.map(team => ({ value: team.id, label: team.name }))],
    assets: [{ value: "", label: "Sem ativo" }, ...(assets.data?.items ?? []).map(asset => ({ value: asset.id, label: asset.name }))],
    devices: [{ value: "", label: "Qualquer equipamento" }, ...(devices.data?.items ?? []).map(device => ({ value: device.id, label: `${device.name} · ${device.type}` }))],
  };

  async function mutate(action: () => Promise<unknown>, message: string, after?: () => void) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null); setSuccess("");
    try { await action(); after?.(); setSuccess(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a alteração."); }
    finally { busy.current = false; setPending(false); refresh(); }
  }

  if (!rules.data) return <Card title="Automações"><ResourceFeedback resource={rules} emptyText="Sua conta não tem permissão para consultar as automações deste condomínio." /></Card>;
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Automações</h1><p className="mt-1 text-sm text-slate-500">Abra ordens de serviço automaticamente quando um alerta chegar. Automações não acionam portões nem equipamentos.</p></div>
      <Button variant="secondary" disabled={pending} onClick={refresh}>Atualizar</Button></div>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {success && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}

    {canManage && <Card title="Nova automação" subtitle="Ela nasce como rascunho: só passa a agir depois de publicada e ativada."><form aria-label="Nova automação" onSubmit={event => { event.preventDefault();
      void mutate(() => api.post("/v1/automations", { buildingId, name: form.name.trim(), definition: definitionOf(form) } satisfies CreateAutomationRequest), "Automação criada como rascunho.", () => setForm(EMPTY)); }}>
      <fieldset disabled={pending} className="grid gap-3 md:grid-cols-2"><Field label="Nome da automação"><Input required maxLength={120} value={form.name} onChange={name => setForm({ ...form, name })} placeholder="Bomba em funcionamento contínuo" /></Field>
        <DefinitionFields draft={form} change={setForm} options={options} />
        <div className="md:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Criar automação"}</Button></div></fieldset></form></Card>}

    <Card title="Automações do condomínio">
      {!rules.data.items.length ? <EmptyState text="Nenhuma automação cadastrada." /> : <ul className="divide-y divide-slate-100">{rules.data.items.map(rule => <li key={rule.id} className="py-4 text-sm text-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><strong className="text-slate-900">{rule.name}</strong>
            <div className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={statusOf(rule).tone}>{statusOf(rule).label}</Badge>
              <span className="text-xs text-slate-500">{rule.publishedVersion === null ? "Nenhuma versão publicada" : `Versão ${rule.publishedVersion} publicada`} · {rule.ordersCreated} ordem(ns) aberta(s)</span></div></div>
          <div className="flex flex-wrap items-center gap-1">
            {canManage && rule.publishedVersion !== null && <Button variant={rule.enabled ? "ghost" : "secondary"} disabled={pending} onClick={() => void mutate(() => api.post(`/v1/automations/${rule.id}/state`, { version: rule.version, enabled: !rule.enabled } satisfies AutomationStateRequest), rule.enabled ? "Automação desativada." : "Automação ativada.")}>{rule.enabled ? "Desativar" : "Ativar"}</Button>}
            <Button variant="ghost" onClick={() => setExpanded(expanded === rule.id ? null : rule.id)}>{expanded === rule.id ? "Ocultar detalhes" : "Detalhes"}</Button>
          </div>
        </div>
        {expanded === rule.id && <Details key={`${rule.id}:${rule.version}:${refreshed}`} rule={rule} canManage={canManage} options={options} pending={pending} mutate={mutate} />}
      </li>)}</ul>}
    </Card>
  </>;
}

function DefinitionFields({ draft, change, options }: { draft: Draft; change: (next: Draft) => void; options: { teams: Options; assets: Options; devices: Options } }) {
  return <>
    <Field label="Tipos de alerta" hint="Separe por vírgula; vazio aceita qualquer tipo"><Input maxLength={600} value={draft.alertTypes} onChange={alertTypes => change({ ...draft, alertTypes })} placeholder="PUMP_CONTINUOUS_LIMIT" /></Field>
    <Field label="Gravidade mínima"><Select value={draft.minSeverity} onChange={minSeverity => change({ ...draft, minSeverity })} options={SEVERITIES} /></Field>
    <Field label="Equipamento"><Select value={draft.deviceId} onChange={deviceId => change({ ...draft, deviceId })} options={options.devices} /></Field>
    <Field label="Título da ordem de serviço"><Input required maxLength={160} value={draft.orderTitle} onChange={orderTitle => change({ ...draft, orderTitle })} placeholder="Verificar bomba" /></Field>
    <Field label="Prioridade da ordem"><Select value={draft.orderPriority} onChange={orderPriority => change({ ...draft, orderPriority })} options={PRIORITIES} /></Field>
    <Field label="Equipe responsável"><Select value={draft.assignedTeamId} onChange={assignedTeamId => change({ ...draft, assignedTeamId })} options={options.teams} /></Field>
    <Field label="Ativo"><Select value={draft.assetId} onChange={assetId => change({ ...draft, assetId })} options={options.assets} /></Field>
    <Field label="Pausa entre ordens (minutos)" hint="Depois de abrir uma ordem, novos alertas são ignorados por este tempo"><Input type="number" min={0} max={10080} step={1} required value={draft.cooldownMinutes} onChange={cooldownMinutes => change({ ...draft, cooldownMinutes })} /></Field>
  </>;
}

function Details({ rule, canManage, options, pending, mutate }: { rule: AutomationView; canManage: boolean; options: { teams: Options; assets: Options; devices: Options };
  pending: boolean; mutate: (action: () => Promise<unknown>, message: string, after?: () => void) => Promise<void> }) {
  const detail = useResource<AutomationDetail>(`/v1/automations/${rule.id}`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [simulation, setSimulation] = useState<AutomationSimulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function simulate(number: number) {
    setError(null);
    try { setSimulation(await api.post<AutomationSimulation>(`/v1/automations/${rule.id}/simulate`, { number })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível simular."); }
  }
  if (!detail.data) return <div className="mt-3"><ResourceFeedback resource={detail} emptyText="Detalhes indisponíveis." /></div>;
  const label = (list: Options, value: string | null, fallback: string) => value ? list.find(option => option.value === value)?.label ?? fallback : null;
  return <div className="mt-3 space-y-4 rounded-lg bg-slate-50 p-3">
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Versões</h3>
      <ul className="mt-2 space-y-3">{detail.data.versions.map(version => <li key={version.number} className="flex flex-wrap items-start justify-between gap-3">
        <div><strong>Versão {version.number}</strong>{rule.publishedVersion === version.number && <span className="ml-2"><Badge tone="success">Publicada</Badge></span>}
          <p className="mt-1 text-slate-600">Quando chegar alerta {version.alertTypes.length ? `do tipo ${version.alertTypes.join(", ")}` : "de qualquer tipo"}, gravidade {SEVERITY[version.minSeverity].toLowerCase()} ou maior
            {version.deviceId ? `, do equipamento ${label(options.devices, version.deviceId, "selecionado")}` : ""}: abrir “{version.orderTitle}”
            {[label(options.teams, version.assignedTeamId, "equipe definida") && ` para ${label(options.teams, version.assignedTeamId, "equipe definida")}`, label(options.assets, version.assetId, "ativo definido") && ` no ativo ${label(options.assets, version.assetId, "ativo definido")}`].filter(Boolean).join("")}.
            {version.cooldownMinutes ? ` Pausa de ${version.cooldownMinutes} min.` : " Sem pausa."}</p>
          <p className="text-xs text-slate-500">Criada em {formatDateTime(version.createdAt)}</p></div>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" onClick={() => void simulate(version.number)}>Simular</Button>
          {canManage && rule.publishedVersion !== version.number && <Button variant="secondary" disabled={pending} onClick={() => void mutate(() => api.post(`/v1/automations/${rule.id}/publish`, { version: rule.version, number: version.number } satisfies PublishAutomationRequest), `Versão ${version.number} publicada.`)}>Publicar</Button>}
        </div>
      </li>)}</ul>
      {simulation && <div role="status" className="mt-3 rounded-lg border border-slate-200 bg-white p-3"><p><strong>Simulação da versão {simulation.number}:</strong> {simulation.matches.length ? `${simulation.matches.length} alerta(s) dos últimos 30 dias atenderiam a regra.` : "nenhum alerta dos últimos 30 dias atenderia a regra."} Nada foi criado.</p>
        {simulation.matches.length > 0 && <ul className="mt-2 space-y-1 text-xs text-slate-600">{simulation.matches.slice(0, 10).map(match => <li key={match.alertId}>{formatDateTime(match.triggeredAt)} · {match.type} · {SEVERITY[match.severity]} · {match.message}</li>)}</ul>}</div>}
    </div>
    {canManage && (draft ? <form aria-label="Nova versão" onSubmit={event => { event.preventDefault(); void mutate(() => api.post(`/v1/automations/${rule.id}/versions`, { version: rule.version, definition: definitionOf(draft) } satisfies AddAutomationVersionRequest), "Nova versão criada. Publique para que passe a valer.", () => setDraft(null)); }}>
      <fieldset disabled={pending} className="grid gap-3 md:grid-cols-2"><DefinitionFields draft={draft} change={setDraft} options={options} />
        <div className="flex flex-wrap gap-2 md:col-span-2"><Button type="submit" disabled={pending}>Criar versão</Button><Button variant="secondary" disabled={pending} onClick={() => setDraft(null)}>Cancelar</Button></div></fieldset></form>
      : <Button variant="secondary" disabled={pending} onClick={() => setDraft(draftOf(rule.name, detail.data!.versions[0]!))}>Nova versão a partir da mais recente</Button>)}
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Últimas execuções</h3>
      {!detail.data.runs.length ? <p className="mt-2 text-sm text-slate-500">Esta automação ainda não reagiu a nenhum alerta.</p> : <ul className="mt-2 space-y-1">{detail.data.runs.map(run => <li key={run.id} className="flex flex-wrap items-center gap-2">
        <Badge tone={OUTCOME[run.outcome]!.tone}>{OUTCOME[run.outcome]!.label}</Badge><span className="text-xs text-slate-500">Versão {run.versionNumber} · {formatDateTime(run.createdAt)}</span></li>)}</ul>}
    </div>
  </div>;
}
