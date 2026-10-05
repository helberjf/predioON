import { useEffect, useState } from "react";
import type { CreateOrganizationRequest, OrganizationView, UpdateOrganizationRequest } from "@predioon/contracts";
import { api, Badge, Button, Card, ErrorBanner, Field, Input, ResourceFeedback, useResource, type Paged } from "@predioon/ui";
import { OrganizationAccessFeedback, useOrganizationAccess, useOrganizationMutation } from "../organization-access.js";

type Draft = { name: string; slug: string };
type Confirmation = { id: string; name: string; active: boolean };
const blank = (): Draft => ({ name: "", slug: "" });
function validDraft(draft: Draft): boolean {
  return draft.name.length >= 2 && draft.name.length <= 120 && draft.slug.length >= 2 && draft.slug.length <= 60 && /^[a-z0-9-]+$/.test(draft.slug);
}

export function Clients() {
  const access = useOrganizationAccess();
  const mutation = useOrganizationMutation();
  const [creation, setCreation] = useState<Draft>(blank);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Revocation destroys drafts; transient preflight failures only hide them.
  useEffect(() => {
    setCreation(blank()); setEditing(null); setConfirmation(null); setMessage(null);
    mutation.cancelPendingIntent();
  }, [access.manageEpoch]);
  return <>
    <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
    {mutation.error && <ErrorBanner message={mutation.error} onDismiss={() => mutation.setError(null)} />}
    {message && access.canRead && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {access.canRead ? <ClientsWorkspace key={access.readEpoch} creation={creation} setCreation={setCreation} editing={editing} setEditing={setEditing}
      confirmation={confirmation} setConfirmation={setConfirmation} mutation={mutation} setMessage={setMessage} /> : <OrganizationAccessFeedback />}
  </>;
}

type WorkspaceProps = {
  creation: Draft; setCreation(value: Draft): void;
  editing: { id: string; draft: Draft } | null; setEditing(value: { id: string; draft: Draft } | null): void;
  confirmation: Confirmation | null; setConfirmation(value: Confirmation | null): void;
  mutation: ReturnType<typeof useOrganizationMutation>; setMessage(value: string | null): void;
};
function ClientsWorkspace({ creation, setCreation, editing, setEditing, confirmation, setConfirmation, mutation, setMessage }: WorkspaceProps) {
  const access = useOrganizationAccess();
  const clients = useResource<Paged<OrganizationView>>("/organizations");
  useEffect(() => { if (clients.errorStatus === 403) access.invalidate(); }, [clients.errorStatus, access.invalidate]);
  const selected = clients.data?.items.find(row => row.id === editing?.id);
  useEffect(() => {
    if (!clients.loading && clients.data && editing && !selected) { mutation.cancelPendingIntent(); setEditing(null); }
  }, [clients.loading, clients.data, editing?.id, selected?.id]);
  const disabled = mutation.busy || access.checking;
  function cancel() { mutation.cancelPendingIntent(); setEditing(null); setConfirmation(null); setMessage(null); }
  function create() {
    if (!validDraft(creation)) { mutation.setError("Confira o nome e o slug do cliente."); return; }
    const payload: CreateOrganizationRequest = { ...creation };
    setMessage(null);
    void mutation.run("manage", () => api.post<OrganizationView>("/organizations", payload), () => {
      setCreation(blank()); setMessage("Cliente cadastrado."); clients.reload();
    });
  }
  function save() {
    if (!editing || !selected || !validDraft(editing.draft)) return;
    const id = editing.id;
    const payload: UpdateOrganizationRequest = {};
    if (editing.draft.name !== selected.name) payload.name = editing.draft.name;
    if (editing.draft.slug !== selected.slug) payload.slug = editing.draft.slug;
    if (!Object.keys(payload).length) return;
    setMessage(null);
    void mutation.run("manage", () => api.patch<OrganizationView>(`/organizations/${encodeURIComponent(id)}`, payload), () => {
      setEditing(null); setMessage("Cliente atualizado."); clients.reload();
    });
  }
  function changeStatus() {
    if (!confirmation) return;
    const { id, active } = confirmation;
    setMessage(null);
    void mutation.run("manage", () => api.patch<OrganizationView>(`/organizations/${encodeURIComponent(id)}`, { active } satisfies UpdateOrganizationRequest), result => {
      setConfirmation(null); setMessage(result.active ? "Cliente reativado." : "Cliente desativado."); clients.reload();
    });
  }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-600">{access.canManage ? "Cadastre clientes e mantenha seus dados comerciais." : "Você pode consultar os clientes cadastrados."}</p>
      <Button variant="secondary" disabled={mutation.busy} onClick={() => { void access.refresh(); clients.reload(); }}>Atualizar clientes</Button>
    </div>
    <div className={`grid gap-5 ${access.canManage ? "xl:grid-cols-3" : ""}`}>
      {access.canManage && <Card title={editing ? "Editar cliente" : "Novo cliente"}>
        <form aria-label={editing ? "Editar cliente" : "Cadastrar cliente"} className="space-y-3" onSubmit={event => { event.preventDefault(); if (editing) save(); else create(); }}>
          <Field label="Nome do cliente"><Input value={editing?.draft.name ?? creation.name} minLength={2} maxLength={120} required disabled={mutation.busy}
            onChange={name => editing ? setEditing({ ...editing, draft: { ...editing.draft, name } }) : setCreation({ ...creation, name })} placeholder="Administradora Alfa" /></Field>
          <Field label="Slug do cliente" hint="De 2 a 60 caracteres: minúsculas, números e hífen."><Input value={editing?.draft.slug ?? creation.slug} minLength={2} maxLength={60} pattern="[a-z0-9-]+" required disabled={mutation.busy}
            onChange={slug => editing ? setEditing({ ...editing, draft: { ...editing.draft, slug } }) : setCreation({ ...creation, slug })} placeholder="administradora-alfa" /></Field>
          <Button full type="submit" disabled={disabled || !validDraft(editing?.draft ?? creation) || Boolean(editing && (!selected || (editing.draft.name === selected.name && editing.draft.slug === selected.slug)))}>
            {mutation.busy ? "Aguardando confirmação…" : editing ? "Salvar cliente" : "Cadastrar cliente"}
          </Button>
          {editing && <Button variant="secondary" onClick={cancel}>Cancelar edição</Button>}
          {mutation.busy && <p role="status" className="text-sm text-slate-500">Verificando a permissão e aguardando a resposta da API.</p>}
        </form>
      </Card>}
      <Card title="Clientes cadastrados" className={access.canManage ? "xl:col-span-2" : undefined}>
        {clients.error ? <ResourceFeedback resource={clients} emptyText="" /> : clients.data?.items.length ? <div className="space-y-3">
          {clients.data.items.map(client => <article key={client.id} aria-label={`Cliente ${client.name}`} className="rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium text-slate-800">{client.name}</p><p className="break-all text-xs text-slate-500">{client.slug}</p></div><Badge tone={client.active ? "success" : "neutral"}>{client.active ? "ATIVO" : "INATIVO"}</Badge></div>
            {access.canManage && <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={disabled} onClick={() => { cancel(); setEditing({ id: client.id, draft: { name: client.name, slug: client.slug } }); }}>Editar cliente</Button>
              <Button variant={client.active ? "danger" : "secondary"} disabled={disabled} onClick={() => { cancel(); setConfirmation({ id: client.id, name: client.name, active: !client.active }); }}>{client.active ? "Desativar cliente" : "Reativar cliente"}</Button>
            </div>}
            {access.canManage && confirmation?.id === client.id && <div className="mt-3 space-y-3 rounded-lg bg-amber-50 p-3">
              <p className="text-sm text-amber-900">{confirmation.active ? `Reativar ${confirmation.name}?` : `Desativar ${confirmation.name}? O acesso aos imóveis vinculados ficará indisponível enquanto o cliente estiver inativo.`}</p>
              <div className="flex flex-wrap gap-2"><Button variant={confirmation.active ? "primary" : "danger"} disabled={disabled} onClick={changeStatus}>{confirmation.active ? "Confirmar reativação" : "Confirmar desativação"}</Button><Button variant="secondary" onClick={cancel}>Manter estado atual</Button></div>
            </div>}
          </article>)}
        </div> : <ResourceFeedback resource={clients} emptyText="Nenhum cliente cadastrado." />}
      </Card>
    </div>
  </>;
}
