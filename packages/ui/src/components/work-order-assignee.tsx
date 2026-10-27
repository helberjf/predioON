import { useId, useState } from "react";
import { Check, Search, UserRound, Users } from "lucide-react";
import type { UpdateWorkOrderRequest, WorkOrderView } from "@predioon/contracts/work-orders";
import { Field, Input, Select } from "./fields.js";
import { Button } from "./primitives.js";

export type AssignmentDraft = { kind: "name" | "registered" | "none"; name: string; selected: string };
export type AssignmentOption = { value: string; label: string };
export type Assignment = Pick<UpdateWorkOrderRequest, "assignedName" | "assignedUserId" | "assignedTeamId">;

export function assignmentDraft(order?: WorkOrderView): AssignmentDraft {
  return { kind: order?.assignedName ? "name" : order?.assignedUserId || order?.assignedTeamId ? "registered" : "none",
    name: order?.assignedName ?? "", selected: order?.assignedTeamId ? `team:${order.assignedTeamId}` : order?.assignedUserId ? `user:${order.assignedUserId}` : "" };
}

export function assignmentPayload(draft: AssignmentDraft): Assignment {
  return { assignedName: draft.kind === "name" ? draft.name.trim() || null : null,
    assignedUserId: draft.kind === "registered" && draft.selected.startsWith("user:") ? draft.selected.slice(5) : null,
    assignedTeamId: draft.kind === "registered" && draft.selected.startsWith("team:") ? draft.selected.slice(5) : null };
}

const MODES = [{ value: "name", label: "Digitar nome", icon: UserRound },
  { value: "registered", label: "Selecionar cadastrado", icon: Users }, { value: "none", label: "Definir depois", icon: Check }] as const;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export function WorkOrderAssignee({ draft, onChange, options, loading = false, unavailable = false, optional = false }: {
  draft: AssignmentDraft; onChange: (draft: AssignmentDraft) => void; options: AssignmentOption[];
  loading?: boolean; unavailable?: boolean; optional?: boolean;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const selected = options.find(option => option.value === draft.selected);
  const matches = options.filter(option => normalize(option.label).includes(normalize(search.trim())));
  const filtered = selected && !matches.includes(selected) ? [selected, ...matches] : matches;
  return <fieldset className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
    <legend className="px-1 text-sm font-semibold text-slate-800">Quem fará o serviço?{optional && <span className="ml-1 font-normal text-slate-500">(opcional)</span>}</legend>
    <div className="mb-4 grid gap-2 sm:grid-cols-3">{MODES.map(({ value, label, icon: Icon }) => <label key={value}
      className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition focus-within:ring-2 focus-within:ring-emerald-500 ${draft.kind === value ? "border-emerald-600 bg-emerald-50 font-semibold text-emerald-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
      <input className="h-4 w-4 shrink-0 accent-emerald-600" type="radio" name={`${id}-mode`} value={value} checked={draft.kind === value} onChange={() => onChange({ ...draft, kind: value })} />
      <Icon size={16} aria-hidden="true" className="shrink-0" />{label}
    </label>)}</div>
    {draft.kind === "name" && <Field label="Nome da pessoa ou empresa" hint="Pode ser um prestador externo, sem cadastro no condomínio.">
      <Input value={draft.name} onChange={name => onChange({ ...draft, name })} maxLength={160} required={!optional} placeholder="Ex.: João da Silva ou Limpa Água Serviços" autoComplete="off" />
    </Field>}
    {draft.kind === "registered" && <div className="space-y-3">
      <Field label="Buscar pessoa ou equipe"><div className="relative"><Search size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-3 text-slate-400" />
        <Input type="text" value={search} onChange={setSearch} placeholder="Digite para filtrar os cadastrados" autoComplete="off" />
      </div></Field>
      <Field label="Responsável"><Select value={draft.selected} onChange={selected => onChange({ ...draft, selected })} required
        options={[{ value: "", label: loading ? "Carregando cadastros…" : "Selecione uma pessoa ou equipe" }, ...filtered,
          ...(draft.selected && !selected ? [{ value: draft.selected, label: "Responsável atual · cadastro indisponível" }] : [])]} /></Field>
      {!loading && !matches.length && <p role="status" className="text-xs text-slate-600">Nenhum cadastro encontrado. Você pode usar “Digitar nome”.</p>}
      {unavailable && <p role="status" className="text-xs text-amber-800">Alguns cadastros não puderam ser carregados. Tente atualizar a página ou digite o nome.</p>}
    </div>}
    {draft.kind === "none" && <p className="text-sm leading-6 text-slate-600">Você pode definir o responsável quando o serviço estiver combinado.</p>}
  </fieldset>;
}

export function AssignmentEditor({ order, options, pending, loading, unavailable, onSave, onCancel }: {
  order: WorkOrderView; options: AssignmentOption[]; pending: boolean; loading: boolean; unavailable: boolean;
  onSave: (assignment: Assignment) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => assignmentDraft(order));
  const payload = assignmentPayload(draft);
  const changed = payload.assignedName !== (order.assignedName ?? null) || payload.assignedUserId !== order.assignedUserId || payload.assignedTeamId !== order.assignedTeamId;
  const valid = draft.kind === "none" || (draft.kind === "name" ? !!draft.name.trim() : !!draft.selected);
  return <form aria-label={`Responsável por ${order.title}`} className="mt-4" onSubmit={event => { event.preventDefault(); if (valid && changed) onSave(payload); }}>
    <fieldset disabled={pending} className="min-w-0 space-y-3">
      <WorkOrderAssignee draft={draft} onChange={setDraft} options={options} loading={loading} unavailable={unavailable} />
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={pending || !valid || !changed}>{pending ? "Salvando…" : "Salvar responsável"}</Button>
        <Button variant="ghost" disabled={pending} onClick={onCancel}>Descartar</Button>
        <span className="text-xs text-slate-500">Salve ou descarte antes de alterar o andamento.</span></div>
    </fieldset>
  </form>;
}
