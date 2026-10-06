import { useRef, useState } from "react";
import type { CreateInvitationRequest, CreateInvitationResponse, InvitationView } from "@predioon/contracts/tenancy";
import { api } from "../api.js";
import { useTenancyCollection } from "../use-tenancy-collection.js";
import { formatDateTime } from "../format.js";
import { Badge, Button, Card, ErrorBanner, ResourceFeedback, type Tone } from "./primitives.js";
import { Field, Input, Select } from "./fields.js";

const KINDS = [{ value: "OCCUPANT", label: "Ocupante" }, { value: "OWNER", label: "Proprietário" }, { value: "DEPENDENT", label: "Dependente" }];
const STATUS: Record<InvitationView["status"], { label: string; tone: Tone }> = {
  PENDING: { label: "Aguardando", tone: "info" }, ACCEPTED: { label: "Aceito", tone: "success" },
  REVOKED: { label: "Revogado", tone: "neutral" }, EXPIRED: { label: "Expirado", tone: "warning" },
};
const RESIDENT_URL = (import.meta.env?.VITE_RESIDENT_URL as string | undefined)?.replace(/\/+$/, "");

/** Managers invite residents; the code is shown once and is never retrievable afterwards. */
export function InvitationsCard({ buildingId, units }: { buildingId: string; units: Array<{ value: string; label: string }> }) {
  const invitations = useTenancyCollection<InvitationView>(`/v1/tenancy/invitations?buildingId=${encodeURIComponent(buildingId)}`);
  const [form, setForm] = useState({ name: "", email: "", unitId: "", kind: "OCCUPANT" });
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function mutate(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try { await action(); invitations.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a alteração."); }
    finally { busy.current = false; setPending(false); }
  }
  const create = () => mutate(async () => {
    const person = { buildingId, name: form.name.trim(), email: form.email.trim() };
    const payload: CreateInvitationRequest = form.unitId ? { ...person, unitId: form.unitId, kind: form.kind as "OWNER" | "OCCUPANT" | "DEPENDENT" } : person;
    const result = await api.post<CreateInvitationResponse>("/v1/tenancy/invitations", payload);
    setIssued({ name: result.invitation.name, token: result.token }); setCopied(false);
    setForm({ ...form, name: "", email: "" });
  });
  const shared = issued ? (RESIDENT_URL ? `${RESIDENT_URL}/convite#${issued.token}` : issued.token) : "";
  const sorted = [...invitations.data].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return <Card title="Convites para moradores" subtitle="A pessoa convidada cria a própria senha e recebe somente o acesso de morador.">
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    <form aria-label="Convidar morador" className="mb-5" onSubmit={event => { event.preventDefault(); void create(); }}><fieldset disabled={pending} className="grid gap-3 md:grid-cols-2">
      <Field label="Nome da pessoa"><Input required maxLength={120} value={form.name} onChange={name => setForm({ ...form, name })} /></Field>
      <Field label="E-mail da pessoa"><Input type="email" required maxLength={254} value={form.email} onChange={email => setForm({ ...form, email })} /></Field>
      <Field label="Unidade (opcional)"><Select value={form.unitId} onChange={unitId => setForm({ ...form, unitId })} options={[{ value: "", label: "Sem unidade" }, ...units]} /></Field>
      {form.unitId && <Field label="Vínculo com a unidade"><Select value={form.kind} onChange={kind => setForm({ ...form, kind })} options={KINDS} /></Field>}
      <div className="md:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Gerando…" : "Gerar convite"}</Button></div>
    </fieldset></form>
    {issued && <div role="status" className="mb-5 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p>Convite de <strong>{issued.name}</strong> gerado. Entregue {RESIDENT_URL ? "este link" : "este código"} somente a essa pessoa: ele vale por 7 dias, funciona uma vez e <strong>não será exibido novamente</strong>.</p>
      <Field label={RESIDENT_URL ? "Link do convite" : "Código do convite"}><Input readOnly value={shared} onChange={() => {}} onFocus={event => event.currentTarget.select()} /></Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(shared).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copiado" : "Copiar"}</Button>
        <Button variant="ghost" onClick={() => setIssued(null)}>Já entreguei, ocultar</Button>
      </div>
    </div>}
    {invitations.loading || invitations.error || !sorted.length ? <ResourceFeedback resource={invitations} emptyText="Nenhum convite emitido." /> : <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-auto">{sorted.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-slate-700">
      <div><strong>{row.name}</strong><p>{row.email}{row.unitId ? ` · ${units.find(unit => unit.value === row.unitId)?.label ?? "Unidade"}` : ""}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge><span className="text-xs text-slate-500">{row.status === "PENDING" ? `Válido até ${formatDateTime(row.expiresAt)}` : `Emitido em ${formatDateTime(row.createdAt)}`}</span></div></div>
      {(row.status === "PENDING" || row.status === "EXPIRED") && <Button variant="ghost" disabled={pending} onClick={() => void mutate(async () => { await api.delete(`/v1/tenancy/invitations/${row.id}`); })}>Revogar convite</Button>}
    </li>)}</ul>}
  </Card>;
}
