import { useState } from "react";
import { TicketCreateSchema, TICKET_PRIORITIES, TICKET_STATUSES } from "@predioon/shared";
import { useFeatures } from "../features.js";
import { ticketFeatureInput } from "../feature-state.js";
import { api } from "../api.js";
import { useResource } from "../use-resource.js";
import type { Occurrence, Paged } from "../types.js";
import { formatDateTime } from "../format.js";
import { Badge, Button, Card, ErrorBanner, ResourceFeedback } from "./primitives.js";
import { Field, Input, Select, TextArea } from "./fields.js";

const CATEGORIES = [{ value: "HIDRAULICA", label: "Hidráulica / vazamento" }, { value: "ELETRICA", label: "Elétrica" }, { value: "ILUMINACAO", label: "Iluminação" }, { value: "ELEVADOR", label: "Elevador" }, { value: "PORTAO", label: "Portão" }, { value: "LIMPEZA", label: "Limpeza" }, { value: "OUTROS", label: "Outros" }];
const active = (row: Occurrence) => !["DONE", "CANCELLED"].includes(row.status);
const priorityLabel = (value: string) => TICKET_PRIORITIES.find(p => p.value === value)?.label ?? (value === "URGENT" ? "Alta" : value);
const statusLabel = (value: string) => TICKET_STATUSES.find(p => p.value === value)?.label ?? value;
const empty = () => ({ category: "HIDRAULICA", title: "", description: "", location: "", unit: "", priority: "NORMAL" });

function TicketForm({ buildingId, onSaved }: { buildingId: string; onSaved: () => void }) {
  const flags = useFeatures();
  const [form, setForm] = useState(empty), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      const parsed = TicketCreateSchema.safeParse(ticketFeatureInput({ ...form, buildingId }, flags.items, true));
      if (!parsed.success) throw new Error("Preencha resumo e descrição com pelo menos 3 caracteres e confira os campos.");
      await api.post("/occurrences", parsed.data); setForm(empty()); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao abrir chamado"); } finally { setBusy(false); }
  }
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit(); }}>
    {error && <ErrorBanner message={error} />}
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Categoria"><Select value={form.category} onChange={category => setForm({ ...form, category })} options={CATEGORIES} /></Field>{flags.enabled("TICKET_PRIORITY") && <Field label="Gravidade"><Select value={form.priority} onChange={priority => setForm({ ...form, priority })} options={TICKET_PRIORITIES} /></Field>}</div>
    {flags.enabled("TICKET_PRIORITY") && <p className="text-xs text-slate-500">Baixa: melhoria sem urgência. Média: problema que afeta a rotina. Alta: risco ou serviço essencial interrompido.</p>}
    <Field label="Resumo"><Input value={form.title} onChange={title => setForm({ ...form, title })} placeholder="Lâmpada do jardim com defeito" required /></Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Local"><Input value={form.location} onChange={location => setForm({ ...form, location })} placeholder="Jardim" /></Field><Field label="Unidade (opcional)"><Input value={form.unit} onChange={unit => setForm({ ...form, unit })} /></Field></div>
    <Field label="Descrição"><TextArea value={form.description} onChange={description => setForm({ ...form, description })} /></Field>
    <Button type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar chamado"}</Button>
  </form>;
}
type Detail = Occurrence & { timeline: { id: string; kind: string; message: string | null; metadata: Record<string, string>; createdAt: string }[] };
function TicketDetail({ row, canManage, reload }: { row: Occurrence; canManage: boolean; reload: () => void }) {
  const flags = useFeatures();
  const detail = useResource<Detail>(`/occurrences/${row.id}`);
  const [status, setStatus] = useState(row.status), [priority, setPriority] = useState(row.priority === "URGENT" ? "HIGH" : row.priority);
  const [reason, setReason] = useState(""), [message, setMessage] = useState(""), [group, setGroup] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function act(kind: "save" | "comment" | "cancel") {
    setBusy(true); setError("");
    try {
      if (kind === "comment") { await api.post(`/occurrences/${row.id}/comments`, ticketFeatureInput({ message, applyToGroup: canManage && group }, flags.items)); setMessage(""); }
      else await api.patch(`/occurrences/${row.id}`, kind === "cancel" ? { status: "CANCELLED" } : ticketFeatureInput({ status, ...(priority !== row.priority ? { priority, priorityReason: reason } : {}), applyToGroup: group }, flags.items));
      detail.reload(); reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar chamado"); } finally { setBusy(false); }
  }
  return <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
    {error && <ErrorBanner message={error} />}
    {canManage && flags.enabled("TICKET_GROUPING") && row.groupId && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={group} onChange={e => setGroup(e.target.checked)} />Aplicar status e gravidade aos chamados ainda abertos do grupo; enviar respostas a todos os solicitantes.</label>}
    {canManage && <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="Situação do chamado"><Select value={status} onChange={setStatus} options={TICKET_STATUSES} /></Field>{flags.enabled("TICKET_PRIORITY") && <Field label="Alterar gravidade"><Select value={priority} onChange={setPriority} options={TICKET_PRIORITIES} /></Field>}</div>
      {flags.enabled("TICKET_PRIORITY") && priority !== row.priority && <Field label="Motivo da classificação de gravidade"><Input value={reason} onChange={setReason} placeholder="Explique a avaliação feita" /></Field>}
      <Button disabled={busy || (flags.enabled("TICKET_PRIORITY") && priority !== row.priority && reason.trim().length < 3)} onClick={() => void act("save")}>Salvar andamento{group ? " do grupo" : ""}</Button></div>}
    <div><h3 className="text-sm font-semibold text-slate-800">Histórico e respostas</h3>
      {detail.data ? <ol className="mt-3 space-y-3">{detail.data.timeline.filter(event => (event.kind !== "PRIORITY_CHANGED" || flags.enabled("TICKET_PRIORITY")) && (event.kind !== "GROUPED" || flags.enabled("TICKET_GROUPING"))).map(event => <li key={event.id} className="rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-500">{formatDateTime(event.createdAt)} · {({ CREATED: "Abertura", COMMENT: "Resposta", STATUS_CHANGED: "Andamento", PRIORITY_CHANGED: "Gravidade", GROUPED: "Atendimento conjunto" } as Record<string, string>)[event.kind] ?? event.kind}</p>
        {event.kind === "PRIORITY_CHANGED" && <p className="mt-1 font-medium">{priorityLabel(event.metadata.from ?? "")} → {priorityLabel(event.metadata.to ?? "")}</p>}
        <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{event.kind === "STATUS_CHANGED" ? event.message?.split(" → ").map(statusLabel).join(" → ") : event.message}</p></li>)}</ol> : <ResourceFeedback resource={detail} emptyText="Sem histórico disponível." />}
    </div>
    <Field label={group ? "Resposta comum ao grupo" : "Mensagem para este chamado"}><TextArea value={message} onChange={setMessage} rows={3} /></Field>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !message.trim()} onClick={() => void act("comment")}>Enviar resposta</Button>{!canManage && active(row) && <Button variant="secondary" disabled={busy} onClick={() => void act("cancel")}>Cancelar meu chamado</Button>}</div>
  </div>;
}
type Duplicate = { title: string; location: string | null; count: number; occurrenceIds: string[] };
function Workspace({ buildingId, canManage }: { buildingId: string; canManage: boolean }) {
  const flags = useFeatures();
  const [onlyOpen, setOnlyOpen] = useState("true"), [offset, setOffset] = useState(0), [formOpen, setFormOpen] = useState(false), [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const list = useResource<Paged<Occurrence>>(`/occurrences?buildingId=${encodeURIComponent(buildingId)}&onlyOpen=${onlyOpen}&limit=50&offset=${offset}`);
  const duplicates = useResource<Paged<Duplicate>>(canManage && flags.enabled("TICKET_GROUPING") ? `/occurrences/duplicates?buildingId=${encodeURIComponent(buildingId)}` : null);
  const reload = () => { list.reload(); duplicates.reload(); };
  async function group(ids: string[]) {
    setBusy(true); setError("");
    try { await api.post("/occurrences/group", { buildingId, occurrenceIds: ids }); setSelected([]); setMessage("Chamados agrupados. Abra o histórico de um deles para atualizar o atendimento conjunto."); reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao agrupar"); } finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Chamados</h1><p className="mt-1 text-sm text-slate-500">{canManage ? "Organize prioridades, responda e acompanhe a solução." : "Acompanhe seus pedidos, respostas e mudanças de gravidade."}</p></div><Button onClick={() => setFormOpen(!formOpen)}>{formOpen ? "Fechar formulário" : "Abrir novo chamado"}</Button></div>
    {error && <ErrorBanner message={error} />}{message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {formOpen && <Card title="Abrir chamado"><TicketForm buildingId={buildingId} onSaved={() => { setFormOpen(false); setOffset(0); setMessage("Chamado enviado. Acompanhe as respostas no histórico."); reload(); }} /></Card>}
    {canManage && flags.enabled("TICKET_GROUPING") && <Card title="Chamados sobre o mesmo problema" subtitle="Sugestões com 3 ou mais assuntos e locais iguais. Confirme o problema antes de agrupar.">
      {duplicates.error && <ErrorBanner message={duplicates.error} />}
      {duplicates.data?.items.map((item, index) => <div key={index} className="mb-3 rounded-lg bg-amber-50 p-3"><p className="mb-2 text-sm font-medium">{item.title} · {item.location || "sem local"} · {item.count} chamados</p><Button variant="secondary" disabled={busy} onClick={() => void group(item.occurrenceIds)}>Confirmar mesmo problema e agrupar {item.occurrenceIds.length}</Button></div>)}
      <p className="mb-3 text-xs text-slate-500">Você também pode selecionar relatos com redação diferente na lista. Cada morador continua vendo apenas seu chamado e as respostas destinadas a ele.</p>
      <Button disabled={busy || selected.length < 2} onClick={() => void group(selected)}>Agrupar selecionados ({selected.length})</Button>
    </Card>}
    <Card title={canManage ? "Fila de atendimento" : "Meus chamados"} action={<Button variant="secondary" onClick={reload}>Atualizar</Button>}>
      <div className="mb-4 max-w-xs"><Field label="Exibir chamados"><Select value={onlyOpen} onChange={value => { setOnlyOpen(value); setOffset(0); setSelected([]); }} options={[{ value: "true", label: "Somente abertos" }, { value: "false", label: "Todos, incluindo encerrados" }]} /></Field></div>
      {list.error && <ErrorBanner message={list.error} />}
      {list.data?.items.length ? <ul className="space-y-4">{list.data.items.map(row => <li key={row.id} className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-slate-500">#{row.protocol}</span><Badge>{statusLabel(row.status)}</Badge>{flags.enabled("TICKET_PRIORITY") && <Badge tone={row.priority === "HIGH" || row.priority === "URGENT" ? "danger" : "neutral"}>Gravidade {priorityLabel(row.priority).toLowerCase()}</Badge>}{flags.enabled("TICKET_GROUPING") && row.groupId && <Badge>Atendimento conjunto</Badge>}</div>
        <h2 className="mt-3 font-semibold text-slate-900">{row.title}</h2><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{row.description}</p><p className="mt-2 text-xs text-slate-500">{row.location || "Sem local"} · {formatDateTime(row.createdAt)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">{canManage && flags.enabled("TICKET_GROUPING") && !row.groupId && active(row) && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.includes(row.id)} disabled={!selected.includes(row.id) && selected.length >= 50} onChange={e => setSelected(e.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} />Selecionar #{row.protocol} para agrupar</label>}<Button variant="secondary" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? "Fechar histórico" : "Ver histórico e responder"}</Button></div>
        {expanded === row.id && <TicketDetail key={`${row.id}:${row.updatedAt}`} row={row} canManage={canManage} reload={reload} />}
      </li>)}</ul> : <ResourceFeedback resource={list} emptyText="Nenhum chamado nesta visão." />}
      <div className="mt-4 flex items-center gap-3"><Button variant="secondary" disabled={offset === 0 || list.loading} onClick={() => { setOffset(offset - 50); setSelected([]); }}>Anterior</Button><span className="text-xs text-slate-500">Página {offset / 50 + 1}</span><Button variant="secondary" disabled={list.loading || (list.data?.items.length ?? 0) < 50} onClick={() => { setOffset(offset + 50); setSelected([]); }}>Próxima</Button></div>
    </Card>
  </div>;
}
export function OccurrencesPanel({ buildingId, canManage = false }: { buildingId: string; canManage?: boolean }) {
  return <Workspace key={buildingId} buildingId={buildingId} canManage={canManage} />;
}
