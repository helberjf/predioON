import { useRef, useState } from "react";
import {
  api, Button, Card, ErrorBanner, Field, Input, PageHeading, ResourceFeedback, Select, SupportGrantRow, TextArea, useResource,
  SUPPORT_CAPABILITY_LABELS, SUPPORT_GRANT_HOURS, sortSupportGrants, supportGrantFormError,
  type Paged, type SupportGrantView, type SupportStaffView,
} from "@predioon/ui";

type Building = { id: string; name: string };
type UserRow = { id: string; name: string; email: string; active: boolean };

/** One request at a time per page, so a double click never grants twice. */
function useSubmit() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  async function run(action: () => Promise<string>) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null); setSuccess("");
    try { setSuccess(await action()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação."); }
    finally { busy.current = false; setPending(false); }
  }
  return { run, pending, error, success, clearError: () => setError(null) };
}

export function SupportAccess() {
  const staff = useResource<{ items: SupportStaffView[] }>("/v1/support-access/staff");
  const users = useResource<Paged<UserRow>>("/users");
  const buildings = useResource<Paged<Building>>("/buildings");
  const [buildingId, setBuildingId] = useState("");
  const grants = useResource<{ items: SupportGrantView[] }>(buildingId ? `/v1/support-access/grants?buildingId=${encodeURIComponent(buildingId)}` : null, [buildingId]);
  const submit = useSubmit();
  const [member, setMember] = useState({ userId: "", reason: "" });
  const [form, setForm] = useState({ supportUserId: "", capabilities: ["telemetry:read"] as string[], reason: "", hours: 4 });
  const [confirm, setConfirm] = useState<string | null>(null);

  const staffIds = new Set(staff.data?.items.map(row => row.userId) ?? []);
  const candidates = (users.data?.items ?? []).filter(user => user.active && !staffIds.has(user.id));
  const formError = supportGrantFormError(form);

  const addMember = () => submit.run(async () => {
    await api.post("/v1/support-access/staff", member);
    setMember({ userId: "", reason: "" }); staff.reload();
    return "Pessoa adicionada à equipe de suporte. Ela ainda não acessa nenhum condomínio até receber uma concessão.";
  });
  const removeMember = (id: string) => submit.run(async () => {
    await api.delete(`/v1/support-access/staff/${encodeURIComponent(id)}`);
    setConfirm(null); staff.reload(); grants.reload();
    return "Pessoa removida da equipe. As concessões abertas dela foram revogadas.";
  });
  const grant = () => submit.run(async () => {
    await api.post("/v1/support-access/grants", { buildingId, ...form, reason: form.reason.trim() });
    setForm({ ...form, reason: "" }); grants.reload();
    return "Acesso concedido. O síndico vê esta concessão em Acesso de suporte.";
  });
  const revoke = (id: string) => submit.run(async () => {
    await api.delete(`/v1/support-access/grants/${encodeURIComponent(id)}`);
    setConfirm(null); grants.reload();
    return "Acesso revogado. A equipe de suporte perde o acesso imediatamente.";
  });
  const toggle = (capability: string) => setForm(current => ({ ...current,
    capabilities: current.capabilities.includes(capability) ? current.capabilities.filter(value => value !== capability) : [...current.capabilities, capability] }));

  return (
    <div className="space-y-6">
      <PageHeading title="Acesso de suporte" description="Quem da plataforma pode consultar um condomínio, o quê, por quanto tempo e por quê. Sem personificação: o suporte usa a própria conta e só lê o que foi concedido." />
      {submit.error && <ErrorBanner message={submit.error} onDismiss={submit.clearError} />}
      {submit.success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{submit.success}</p>}

      <Card title="Equipe de suporte" subtitle="Fazer parte da equipe não libera nenhum condomínio; cada acesso é uma concessão separada.">
        {staff.data?.items.length ? (
          <ul className="divide-y divide-slate-100">
            {staff.data.items.map(row => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div><p className="text-sm font-semibold text-slate-900">{row.name}</p><p className="text-xs text-slate-500">{row.email} · {row.reason}</p></div>
                {confirm === row.id
                  ? <div className="flex gap-2"><Button variant="danger" disabled={submit.pending} onClick={() => removeMember(row.id)}>Confirmar remoção</Button><Button variant="ghost" onClick={() => setConfirm(null)}>Cancelar</Button></div>
                  : <Button variant="secondary" onClick={() => setConfirm(row.id)}>Remover da equipe</Button>}
              </li>
            ))}
          </ul>
        ) : <ResourceFeedback resource={staff} emptyText="Ninguém está na equipe de suporte." />}
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Field label="Pessoa"><Select value={member.userId} onChange={userId => setMember({ ...member, userId })}
            options={[{ value: "", label: "Escolha uma conta" }, ...candidates.map(user => ({ value: user.id, label: `${user.name} (${user.email})` }))]} /></Field>
          <Field label="Motivo da inclusão"><Input value={member.reason} onChange={reason => setMember({ ...member, reason })} placeholder="Ex.: atendimento técnico de primeiro nível" /></Field>
          <Button disabled={submit.pending || !member.userId || member.reason.trim().length < 3} onClick={addMember}>Adicionar</Button>
        </div>
      </Card>

      <Card title="Concessões por condomínio" subtitle="Cada concessão vale para uma informação, em um condomínio, por até 7 dias. Conceder de novo a mesma informação substitui a anterior.">
        <Field label="Condomínio"><Select value={buildingId} onChange={setBuildingId}
          options={[{ value: "", label: "Escolha um condomínio" }, ...(buildings.data?.items ?? []).map(building => ({ value: building.id, label: building.name }))]} /></Field>
        {buildingId && (
          <div className="mt-4 space-y-5">
            {grants.data?.items.length ? (
              <ul className="divide-y divide-slate-100">
                {sortSupportGrants(grants.data.items).map(row => <SupportGrantRow key={row.id} grant={row} action={row.status !== "ACTIVE" ? undefined : confirm === row.id
                  ? <><Button variant="danger" disabled={submit.pending} onClick={() => revoke(row.id)}>Confirmar</Button><Button variant="ghost" onClick={() => setConfirm(null)}>Cancelar</Button></>
                  : <Button variant="secondary" onClick={() => setConfirm(row.id)}>Revogar</Button>} />)}
              </ul>
            ) : <ResourceFeedback resource={grants} emptyText="Nenhuma concessão para este condomínio." />}
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Nova concessão</p>
              <Field label="Quem recebe"><Select value={form.supportUserId} onChange={supportUserId => setForm({ ...form, supportUserId })}
                options={[{ value: "", label: "Escolha da equipe de suporte" }, ...(staff.data?.items ?? []).map(row => ({ value: row.userId, label: row.name }))]} /></Field>
              <fieldset className="space-y-2">
                <legend className="mb-1.5 text-sm font-medium text-slate-700">O que pode consultar</legend>
                {Object.entries(SUPPORT_CAPABILITY_LABELS).map(([capability, label]) => (
                  <label key={capability} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={form.capabilities.includes(capability)} onChange={() => toggle(capability)} />{label}
                  </label>
                ))}
              </fieldset>
              <Field label="Prazo"><Select value={String(form.hours)} onChange={hours => setForm({ ...form, hours: Number(hours) })}
                options={SUPPORT_GRANT_HOURS.map(option => ({ value: String(option.hours), label: option.label }))} /></Field>
              <Field label="Motivo do acesso" hint="O síndico do condomínio vê este texto."><TextArea value={form.reason} onChange={reason => setForm({ ...form, reason })} rows={3} /></Field>
              {formError && form.reason && <p className="text-xs text-amber-700">{formError}</p>}
              <Button disabled={submit.pending || Boolean(formError)} onClick={grant}>Conceder acesso</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
