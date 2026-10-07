import { useRef, useState } from "react";
import type { TeamView } from "@predioon/contracts/tenancy";
import type { AssetListResponse } from "@predioon/contracts/assets";
import type { CreateWorkOrderRequest, UpdateWorkOrderRequest, WorkOrderDetail, WorkOrderListResponse, WorkOrderPriority, WorkOrderStatus, WorkOrderTransitionRequest, WorkOrderView } from "@predioon/contracts/work-orders";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { useResource } from "../use-resource.js";
import { useTenancyCollection } from "../use-tenancy-collection.js";
import { formatDateTime } from "../format.js";
import { Badge, Button, Card, EmptyState, ErrorBanner, ResourceFeedback, type Tone } from "./primitives.js";
import { Field, Input, Select } from "./fields.js";

type Person = { id: string; name: string; email: string };
const STATUS: Record<WorkOrderStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "Aberta", tone: "info" }, IN_PROGRESS: { label: "Em execução", tone: "warning" },
  DONE: { label: "Concluída", tone: "success" }, CANCELLED: { label: "Cancelada", tone: "neutral" },
};
const PRIORITY: Record<WorkOrderPriority, { label: string; tone: Tone }> = {
  LOW: { label: "Baixa", tone: "neutral" }, NORMAL: { label: "Normal", tone: "info" },
  HIGH: { label: "Alta", tone: "warning" }, URGENT: { label: "Urgente", tone: "danger" },
};
const PRIORITIES = (Object.keys(PRIORITY) as WorkOrderPriority[]).map(value => ({ value, label: PRIORITY[value].label }));
const EVENT = { CREATED: "Ordem aberta", UPDATED: "Dados alterados", ASSIGNED: "Responsável alterado", NOTE: "Anotação", STATUS_CHANGED: "Estado alterado" };
const EMPTY_FORM = { title: "", description: "", priority: "NORMAL", dueAt: "", assignee: "", assetId: "" };

/** Distribution and execution of maintenance work; the server decides which of the two applies. */
export function WorkOrdersPanel({ buildingId }: { buildingId: string }) {
  const { user } = useAuth();
  const scope = `buildingId=${encodeURIComponent(buildingId)}`;
  const orders = useResource<WorkOrderListResponse>(`/v1/work-orders?${scope}&limit=100`);
  const canDistribute = orders.data?.canDistribute === true;
  // The directories need their own permissions; without them the picker simply has fewer options.
  const teams = useTenancyCollection<TeamView>(canDistribute ? `/v1/tenancy/teams?${scope}` : null);
  const people = useTenancyCollection<Person>(canDistribute ? `/v1/tenancy/people?${scope}` : null);
  // Offered when opening an order; listing needs the equipment permission.
  const assets = useResource<AssetListResponse>(`/v1/assets?${scope}&limit=100`);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<WorkOrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function mutate(action: () => Promise<unknown>, message: string, after?: () => void) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null); setSuccess("");
    try { await action(); after?.(); setSuccess(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a alteração."); }
    finally { busy.current = false; setPending(false); orders.reload(); }
  }
  const assigneeOptions = [
    { value: "", label: "Sem responsável" },
    ...teams.data.map(team => ({ value: `team:${team.id}`, label: `Equipe · ${team.name}` })),
    ...(user && !people.data.some(person => person.id === user.id) ? [{ value: `user:${user.id}`, label: `Eu · ${user.name}` }] : []),
    ...people.data.map(person => ({ value: `user:${person.id}`, label: person.id === user?.id ? `Eu · ${person.name}` : person.name })),
  ];
  const assignment = (value: string) => value.startsWith("team:") ? { assignedTeamId: value.slice(5) } : value.startsWith("user:") ? { assignedUserId: value.slice(5) } : { assignedUserId: null, assignedTeamId: null };
  const assigneeLabel = (order: WorkOrderView) => {
    if (order.assignedTeamId) return `Equipe ${teams.data.find(team => team.id === order.assignedTeamId)?.name ?? ""}`.trim();
    if (order.assignedUserId) return order.assignedUserId === user?.id ? "Você" : people.data.find(person => person.id === order.assignedUserId)?.name ?? "Pessoa atribuída";
    return "Sem responsável";
  };
  const transition = (order: WorkOrderView, status: WorkOrderStatus, message: string, after?: () => void) =>
    mutate(() => api.post(`/v1/work-orders/${order.id}/status`, { version: order.version, status } satisfies WorkOrderTransitionRequest), message, after);
  function create() {
    const payload: CreateWorkOrderRequest = { buildingId, title: form.title.trim(), description: form.description.trim(), priority: form.priority as WorkOrderPriority,
      dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null, ...(form.assetId ? { assetId: form.assetId } : {}), ...(form.assignee ? assignment(form.assignee) : {}) };
    void mutate(() => api.post("/v1/work-orders", payload), "Ordem de serviço aberta.", () => setForm(EMPTY_FORM));
  }

  if (!orders.data) return <Card title="Ordens de serviço"><ResourceFeedback resource={orders} emptyText="Sua conta não tem permissão para ordens de serviço neste condomínio." /></Card>;
  const visible = orders.data.items.filter(order => !onlyOpen || order.status === "OPEN" || order.status === "IN_PROGRESS");

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Ordens de serviço</h1><p className="mt-1 text-sm text-slate-500">{canDistribute ? "Distribua o trabalho de manutenção e acompanhe a execução." : "Trabalhos atribuídos a você ou à sua equipe."}</p></div>
      <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!onlyOpen} onChange={event => setOnlyOpen(!event.target.checked)} />Mostrar encerradas</label><Button variant="secondary" disabled={pending} onClick={orders.reload}>Atualizar</Button></div></div>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {success && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
    {cancelling && <Card title="Cancelar ordem de serviço"><p className="mb-4 text-sm text-slate-600">Confirme o cancelamento de “{cancelling.title}”. A ordem fica encerrada, com o histórico preservado, e não pode ser reaberta.</p><div className="flex flex-wrap gap-2"><Button variant="danger" disabled={pending} onClick={() => void transition(cancelling, "CANCELLED", "Ordem de serviço cancelada.", () => setCancelling(null))}>{pending ? "Cancelando…" : "Confirmar cancelamento"}</Button><Button variant="secondary" disabled={pending} onClick={() => setCancelling(null)}>Manter ordem</Button></div></Card>}

    {canDistribute && <Card title="Nova ordem de serviço"><form aria-label="Nova ordem de serviço" onSubmit={event => { event.preventDefault(); create(); }}><fieldset disabled={pending} className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2"><Field label="O que precisa ser feito"><Input required maxLength={160} value={form.title} onChange={title => setForm({ ...form, title })} placeholder="Trocar lâmpadas da garagem" /></Field></div>
      <div className="md:col-span-2"><Field label="Detalhes (opcional)"><Input maxLength={4000} value={form.description} onChange={description => setForm({ ...form, description })} /></Field></div>
      <Field label="Prioridade"><Select value={form.priority} onChange={priority => setForm({ ...form, priority })} options={PRIORITIES} /></Field>
      <Field label="Prazo (opcional)"><Input type="datetime-local" value={form.dueAt} onChange={dueAt => setForm({ ...form, dueAt })} /></Field>
      <Field label="Responsável"><Select value={form.assignee} onChange={assignee => setForm({ ...form, assignee })} options={assigneeOptions} /></Field>
      {Boolean(assets.data?.items.length) && <Field label="Ativo (opcional)"><Select value={form.assetId} onChange={assetId => setForm({ ...form, assetId })} options={[{ value: "", label: "Sem ativo" }, ...assets.data!.items.map(asset => ({ value: asset.id, label: asset.name }))]} /></Field>}
      <div className="md:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Abrindo…" : "Abrir ordem de serviço"}</Button></div>
    </fieldset></form></Card>}

    <Card title={onlyOpen ? "Em aberto" : "Todas as ordens"}>
      {!visible.length ? <EmptyState text={onlyOpen ? "Nenhuma ordem de serviço em aberto." : "Nenhuma ordem de serviço registrada."} /> : <ul className="divide-y divide-slate-100">{visible.map(order => {
        const live = order.status === "OPEN" || order.status === "IN_PROGRESS";
        const executes = live && (order.assignedToMe || canDistribute);
        return <li key={order.id} className="py-4 text-sm text-slate-700">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><strong className="text-slate-900">{order.title}</strong>{order.description && <p className="mt-1 text-slate-600">{order.description}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={STATUS[order.status].tone}>{STATUS[order.status].label}</Badge><Badge tone={PRIORITY[order.priority].tone}>{`Prioridade ${PRIORITY[order.priority].label.toLowerCase()}`}</Badge>
                <span className="text-xs text-slate-500">{assigneeLabel(order)}{order.assetId ? ` · ${order.assetName ?? "Ativo"}` : ""}{order.dueAt ? ` · Prazo ${formatDateTime(order.dueAt)}` : ""}</span></div></div>
            <div className="flex flex-wrap items-center gap-1">
              {executes && order.status === "OPEN" && <Button variant="secondary" disabled={pending} onClick={() => void transition(order, "IN_PROGRESS", "Execução iniciada.")}>Iniciar</Button>}
              {executes && order.status === "IN_PROGRESS" && <><Button disabled={pending} onClick={() => void transition(order, "DONE", "Ordem de serviço concluída.")}>Concluir</Button><Button variant="ghost" disabled={pending} onClick={() => void transition(order, "OPEN", "Execução pausada.")}>Pausar</Button></>}
              {canDistribute && live && <Button variant="ghost" disabled={pending} onClick={() => { setCancelling(order); setError(null); setSuccess(""); }}>Cancelar</Button>}
              <Button variant="ghost" onClick={() => setExpanded(expanded === order.id ? null : order.id)}>{expanded === order.id ? "Ocultar histórico" : "Histórico"}</Button>
            </div>
          </div>
          {canDistribute && live && <div className="mt-3 max-w-sm"><Field label="Atribuir a"><Select disabled={pending} value={order.assignedTeamId ? `team:${order.assignedTeamId}` : order.assignedUserId ? `user:${order.assignedUserId}` : ""}
            onChange={value => void mutate(() => api.patch(`/v1/work-orders/${order.id}`, { version: order.version, ...assignment(value) } satisfies UpdateWorkOrderRequest), "Responsável atualizado.")} options={assigneeOptions} /></Field></div>}
          {expanded === order.id && <History key={`${order.id}:${order.version}`} order={order} personName={id => id === user?.id ? "Você" : people.data.find(person => person.id === id)?.name ?? "Outra pessoa"} />}
        </li>;
      })}</ul>}
    </Card>
  </>;
}

function History({ order, personName }: { order: WorkOrderView; personName: (id: string) => string }) {
  const detail = useResource<WorkOrderDetail>(`/v1/work-orders/${order.id}`);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function add() {
    setPending(true); setError(null);
    try { await api.post(`/v1/work-orders/${order.id}/notes`, { note: note.trim() }); setNote(""); detail.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar a anotação."); }
    finally { setPending(false); }
  }
  if (!detail.data) return <div className="mt-3"><ResourceFeedback resource={detail} emptyText="Histórico indisponível." /></div>;
  return <div className="mt-3 rounded-lg bg-slate-50 p-3">
    <ol className="space-y-2">{detail.data.events.map(event => <li key={event.id} className="text-xs text-slate-600">
      <strong>{event.kind === "STATUS_CHANGED" && event.toStatus ? `${EVENT.STATUS_CHANGED}: ${STATUS[event.toStatus].label}` : EVENT[event.kind]}</strong>
      <span className="ml-2 text-slate-500">{event.actorId ? personName(event.actorId) : "Sistema"} · {formatDateTime(event.createdAt)}</span>
      {event.note && <p className="mt-0.5 text-sm text-slate-700">{event.note}</p>}
    </li>)}</ol>
    {error && <div className="mt-2"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>}
    <form aria-label="Anotar na ordem de serviço" className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void add(); }}>
      <div className="min-w-[14rem] flex-1"><Field label="Anotação"><Input required maxLength={2000} disabled={pending} value={note} onChange={setNote} /></Field></div>
      <Button type="submit" variant="secondary" disabled={pending || !note.trim()}>Registrar anotação</Button>
    </form>
  </div>;
}
