import { useRef, useState } from "react";
import type { AssetCategory, AssetDetail, AssetListResponse, AssetView, CreateAssetRequest, ReplaceAssetDevicesRequest, UpdateAssetRequest } from "@predioon/contracts/assets";
import { api } from "../api.js";
import { useResource } from "../use-resource.js";
import { formatDateTime } from "../format.js";
import { Badge, Button, Card, EmptyState, ErrorBanner, ResourceFeedback } from "./primitives.js";
import { Field, Input, Select } from "./fields.js";

type Device = { id: string; name: string; type: string };
export const ASSET_CATEGORIES: Record<AssetCategory, string> = {
  PUMP: "Bomba", ELEVATOR: "Elevador", GENERATOR: "Gerador", GATE: "Portão", HVAC: "Climatização",
  FIRE_SAFETY: "Combate a incêndio", ELECTRICAL: "Elétrica", PLUMBING: "Hidráulica", OTHER: "Outro",
};
const CATEGORY_OPTIONS = (Object.keys(ASSET_CATEGORIES) as AssetCategory[]).map(value => ({ value, label: ASSET_CATEGORIES[value] }));
const ORDER_STATUS = { OPEN: "Aberta", IN_PROGRESS: "Em execução", DONE: "Concluída", CANCELLED: "Cancelada" };
const EMPTY = { name: "", category: "OTHER", location: "", manufacturer: "", model: "", serialNumber: "", installedOn: "", notes: "" };
type Draft = typeof EMPTY;
const draftOf = (asset: AssetView): Draft => ({ name: asset.name, category: asset.category, location: asset.location, manufacturer: asset.manufacturer,
  model: asset.model, serialNumber: asset.serialNumber, installedOn: asset.installedOn ?? "", notes: asset.notes });
const payloadOf = (draft: Draft) => ({ name: draft.name.trim(), category: draft.category as AssetCategory, location: draft.location.trim(), manufacturer: draft.manufacturer.trim(),
  model: draft.model.trim(), serialNumber: draft.serialNumber.trim(), installedOn: draft.installedOn || null, notes: draft.notes.trim() });

/** The condominium's physical assets, the devices that watch them and their maintenance history. */
export function AssetsPanel({ buildingId }: { buildingId: string }) {
  const scope = `buildingId=${encodeURIComponent(buildingId)}`;
  const [showInactive, setShowInactive] = useState(false);
  const assets = useResource<AssetListResponse>(`/v1/assets?${scope}&limit=100${showInactive ? "&includeInactive=true" : ""}`);
  const canManage = assets.data?.canManage === true;
  const [form, setForm] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<{ asset: AssetView; draft: Draft } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function mutate(action: () => Promise<unknown>, message: string, after?: () => void) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null); setSuccess("");
    try { await action(); after?.(); setSuccess(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a alteração."); }
    finally { busy.current = false; setPending(false); assets.reload(); }
  }
  const fields = (draft: Draft, change: (next: Draft) => void) => <>
    <Field label="Nome do ativo"><Input required maxLength={160} value={draft.name} onChange={name => change({ ...draft, name })} placeholder="Bomba de recalque 1" /></Field>
    <Field label="Categoria"><Select value={draft.category} onChange={category => change({ ...draft, category })} options={CATEGORY_OPTIONS} /></Field>
    <Field label="Localização"><Input maxLength={160} value={draft.location} onChange={location => change({ ...draft, location })} placeholder="Casa de bombas" /></Field>
    <Field label="Fabricante"><Input maxLength={120} value={draft.manufacturer} onChange={manufacturer => change({ ...draft, manufacturer })} /></Field>
    <Field label="Modelo"><Input maxLength={120} value={draft.model} onChange={model => change({ ...draft, model })} /></Field>
    <Field label="Número de série"><Input maxLength={120} value={draft.serialNumber} onChange={serialNumber => change({ ...draft, serialNumber })} /></Field>
    <Field label="Instalado em"><Input type="date" value={draft.installedOn} onChange={installedOn => change({ ...draft, installedOn })} /></Field>
    <Field label="Observações"><Input maxLength={2000} value={draft.notes} onChange={notes => change({ ...draft, notes })} /></Field>
  </>;

  if (!assets.data) return <Card title="Ativos"><ResourceFeedback resource={assets} emptyText="Sua conta não tem permissão para consultar os ativos deste condomínio." /></Card>;
  const items = assets.data.items;

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Ativos</h1><p className="mt-1 text-sm text-slate-500">Equipamentos físicos do condomínio e o histórico de manutenção de cada um.</p></div>
      <div className="flex flex-wrap items-center gap-4">{canManage && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={showInactive} onChange={event => { setShowInactive(event.target.checked); setEditing(null); }} />Mostrar inativos</label>}<Button variant="secondary" disabled={pending} onClick={assets.reload}>Atualizar</Button></div></div>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {success && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}

    {canManage && !editing && <Card title="Novo ativo"><form aria-label="Novo ativo" onSubmit={event => { event.preventDefault(); void mutate(() => api.post("/v1/assets", { buildingId, ...payloadOf(form) } satisfies CreateAssetRequest), "Ativo cadastrado.", () => setForm(EMPTY)); }}>
      <fieldset disabled={pending} className="grid gap-3 md:grid-cols-2">{fields(form, setForm)}<div className="md:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Cadastrar ativo"}</Button></div></fieldset></form></Card>}
    {editing && <Card title="Editar ativo"><form aria-label="Editar ativo" onSubmit={event => { event.preventDefault(); void mutate(() => api.patch(`/v1/assets/${editing.asset.id}`, { version: editing.asset.version, ...payloadOf(editing.draft) } satisfies UpdateAssetRequest), "Ativo atualizado.", () => setEditing(null)); }}>
      <fieldset disabled={pending} className="grid gap-3 md:grid-cols-2">{fields(editing.draft, draft => setEditing({ ...editing, draft }))}<div className="flex flex-wrap gap-2 md:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar alterações"}</Button><Button variant="secondary" disabled={pending} onClick={() => setEditing(null)}>Cancelar edição</Button></div></fieldset></form></Card>}

    <Card title={showInactive ? "Todos os ativos" : "Ativos em uso"}>
      {!items.length ? <EmptyState text="Nenhum ativo cadastrado." /> : <ul className="divide-y divide-slate-100">{items.map(asset => <li key={asset.id} className="py-4 text-sm text-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><strong className="text-slate-900">{asset.name}</strong>
            <div className="mt-2 flex flex-wrap items-center gap-2"><Badge tone="info">{ASSET_CATEGORIES[asset.category]}</Badge>{!asset.active && <Badge tone="neutral">Inativo</Badge>}
              <span className="text-xs text-slate-500">{[asset.location, [asset.manufacturer, asset.model].filter(Boolean).join(" "), asset.serialNumber && `Série ${asset.serialNumber}`].filter(Boolean).join(" · ")}</span></div></div>
          <div className="flex flex-wrap items-center gap-1">
            {canManage && asset.active && <Button variant="ghost" disabled={pending} onClick={() => { setEditing({ asset, draft: draftOf(asset) }); setError(null); setSuccess(""); }}>Editar</Button>}
            {canManage && <Button variant="ghost" disabled={pending} onClick={() => void mutate(() => api.patch(`/v1/assets/${asset.id}`, { version: asset.version, active: !asset.active } satisfies UpdateAssetRequest), asset.active ? "Ativo desativado." : "Ativo reativado.", () => setEditing(null))}>{asset.active ? "Desativar" : "Reativar"}</Button>}
            <Button variant="ghost" onClick={() => setExpanded(expanded === asset.id ? null : asset.id)}>{expanded === asset.id ? "Ocultar detalhes" : "Detalhes"}</Button>
          </div>
        </div>
        {expanded === asset.id && <Details key={`${asset.id}:${asset.version}`} asset={asset} buildingId={buildingId} canManage={canManage && asset.active} />}
      </li>)}</ul>}
    </Card>
  </>;
}

function Details({ asset, buildingId, canManage }: { asset: AssetView; buildingId: string; canManage: boolean }) {
  const detail = useResource<AssetDetail>(`/v1/assets/${asset.id}`);
  const devices = useResource<{ items: Device[] }>(canManage ? `/devices?buildingId=${encodeURIComponent(buildingId)}` : null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function replace(deviceIds: string[]) {
    setPending(true); setError(null);
    try { await api.put(`/v1/assets/${asset.id}/devices`, { deviceIds } satisfies ReplaceAssetDevicesRequest); setSelected(""); detail.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível alterar os equipamentos."); }
    finally { setPending(false); }
  }
  if (!detail.data) return <div className="mt-3"><ResourceFeedback resource={detail} emptyText="Detalhes indisponíveis." /></div>;
  const linked = detail.data.devices;
  const available = (devices.data?.items ?? []).filter(device => !linked.some(item => item.id === device.id));
  return <div className="mt-3 grid gap-4 rounded-lg bg-slate-50 p-3 md:grid-cols-2">
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Equipamentos monitorados</h3>
      {error && <div className="mt-2"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>}
      {!linked.length ? <p className="mt-2 text-sm text-slate-500">Nenhum equipamento vinculado.</p> : <ul className="mt-2 space-y-1">{linked.map(device => <li key={device.id} className="flex flex-wrap items-center justify-between gap-2"><span>{device.name} <span className="text-xs text-slate-500">{device.type}</span></span>
        {canManage && <Button variant="ghost" disabled={pending} onClick={() => void replace(linked.filter(item => item.id !== device.id).map(item => item.id))}>Desvincular</Button>}</li>)}</ul>}
      {canManage && <form aria-label="Vincular equipamento" className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (selected) void replace([...linked.map(item => item.id), selected]); }}>
        <div className="min-w-[12rem] flex-1"><Field label="Equipamento"><Select disabled={pending} value={selected} onChange={setSelected} options={[{ value: "", label: available.length ? "Selecione um equipamento" : "Nenhum equipamento disponível" }, ...available.map(device => ({ value: device.id, label: `${device.name} · ${device.type}` }))]} /></Field></div>
        <Button type="submit" variant="secondary" disabled={pending || !selected}>Vincular</Button>
      </form>}
    </div>
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Histórico de manutenção</h3>
      {!detail.data.workOrders.length ? <p className="mt-2 text-sm text-slate-500">Nenhuma ordem de serviço registrada para este ativo.</p> : <ul className="mt-2 space-y-2">{detail.data.workOrders.map(order => <li key={order.id}>
        <strong>{order.title}</strong><span className="ml-2 text-xs text-slate-500">{ORDER_STATUS[order.status]} · {formatDateTime(order.closedAt ?? order.createdAt)}</span></li>)}</ul>}
      {asset.notes && <p className="mt-3 text-sm text-slate-600">{asset.notes}</p>}
    </div>
  </div>;
}
