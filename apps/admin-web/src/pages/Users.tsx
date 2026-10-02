import { useRef, useState } from "react";
import { api, Badge, Button, Card, ErrorBanner, Field, Input, ResourceFeedback, Select, useResource } from "@predioon/ui";
import type { Paged } from "@predioon/ui";

type Building = { id: string; name: string };
type UserRow = { id: string; name: string; email: string; isPlatformAdmin: boolean; active: boolean };

export function Users() {
  const users = useResource<Paged<UserRow>>("/users");
  const buildings = useResource<Paged<Building>>("/buildings");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", buildingId: "", role: "RESIDENT", unit: "" });
  const [membership, setMembership] = useState({ userId: "", buildingId: "", role: "RESIDENT", unit: "" });

  async function create() {
    if (busy.current) return;
    busy.current = true;
    setPending(true); setError(null); setSuccess("");
    let accountCreated = false;
    try {
      const created = await api.post<{ id: string }>("/users", {
        name: form.name,
        email: form.email,
        password: form.password,
        isPlatformAdmin: false,
      });
      accountCreated = true;
      setMembership({ userId: created.id, buildingId: form.buildingId, role: form.role, unit: form.unit });
      setForm({ ...form, name: "", email: "", password: "", unit: "" });
      users.reload();
      if (form.buildingId) {
        await api.post("/users/memberships", {
          userId: created.id,
          buildingId: form.buildingId,
          role: form.role,
          unit: form.unit || undefined,
        });
      }
      setSuccess(form.buildingId ? "Conta criada e vinculada ao condomínio." : "Conta criada. Use Vincular conta existente para adicionar um condomínio.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Falha ao criar usuário";
      setError(accountCreated ? `A conta foi criada, mas o vínculo falhou: ${message}. Tente novamente em Vincular conta existente, sem recriar a conta.` : message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function linkMembership() {
    if (busy.current) return;
    busy.current = true;
    setPending(true); setError(null); setSuccess("");
    try {
      await api.post("/users/memberships", { ...membership, unit: membership.unit || undefined });
      setSuccess("Vínculo salvo. A pessoa pode entrar novamente para atualizar seus acessos.");
      users.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao vincular conta"); }
    finally { busy.current = false; setPending(false); }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Usuários</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {success && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Novo usuário" subtitle="Cria a conta e o vínculo com o prédio">
          <form onSubmit={event => { event.preventDefault(); void create(); }}><fieldset disabled={pending} className="space-y-3">
            <Field label="Nome">
              <Input required minLength={2} maxLength={120} value={form.name} onChange={(name) => setForm({ ...form, name })} />
            </Field>
            <Field label="E-mail">
              <Input type="email" required maxLength={160} value={form.email} onChange={(email) => setForm({ ...form, email })} />
            </Field>
            <Field label="Senha provisória" hint="mínimo 8 caracteres">
              <Input type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
            </Field>
            <Field label="Prédio">
              <Select
                value={form.buildingId}
                onChange={(buildingId) => setForm({ ...form, buildingId })}
                options={[
                  { value: "", label: "Sem vínculo" },
                  ...(buildings.data?.items ?? []).map((building) => ({ value: building.id, label: building.name })),
                ]}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Papel">
                <Select
                  value={form.role}
                  onChange={(role) => setForm({ ...form, role })}
                  options={[
                    { value: "RESIDENT", label: "Morador" },
                    { value: "BUILDING_ADMIN", label: "Administrador do condomínio" },
                  ]}
                />
              </Field>
              <Field label="Unidade">
                <Input maxLength={40} value={form.unit} onChange={(unit) => setForm({ ...form, unit })} placeholder="101" />
              </Field>
            </div>
            <Button full type="submit" disabled={pending || !form.name || !form.email || form.password.length < 8}>
              {pending ? "Salvando…" : "Criar usuário"}
            </Button>
          </fieldset></form>
        </Card>

        <Card title="Contas da plataforma" className="xl:col-span-2">
          {users.data?.items.length ? (
            <ul className="space-y-2">
              {users.data.items.map((user) => (
                <li key={user.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="font-medium text-slate-800">{user.name}</p>
                    <p className="text-xs text-slate-400">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.isPlatformAdmin && <Badge tone="info">plataforma</Badge>}
                    <Badge tone={user.active ? "success" : "neutral"}>{user.active ? "ATIVO" : "INATIVO"}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ResourceFeedback resource={users} emptyText="Nenhum usuário encontrado." />
          )}
        </Card>
      </div>
      <Card title="Vincular conta existente" subtitle="Adiciona ou atualiza o vínculo de uma pessoa que já tem conta.">
        {buildings.error && <ErrorBanner message={buildings.error} />}
        <form onSubmit={event => { event.preventDefault(); void linkMembership(); }}><fieldset disabled={pending} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Pessoa"><Select required value={membership.userId} onChange={userId => setMembership({ ...membership, userId })} options={[{ value: "", label: "Selecione uma pessoa" }, ...(users.data?.items ?? []).filter(user => user.active).map(user => ({ value: user.id, label: `${user.name} · ${user.email}` }))]} /></Field>
          <Field label="Condomínio"><Select required value={membership.buildingId} onChange={buildingId => setMembership({ ...membership, buildingId })} options={[{ value: "", label: "Selecione um condomínio" }, ...(buildings.data?.items ?? []).map(building => ({ value: building.id, label: building.name }))]} /></Field>
          <Field label="Papel"><Select value={membership.role} onChange={role => setMembership({ ...membership, role })} options={[{ value: "RESIDENT", label: "Morador" }, { value: "BUILDING_ADMIN", label: "Administrador do condomínio" }]} /></Field>
          <Field label="Unidade"><Input maxLength={40} value={membership.unit} onChange={unit => setMembership({ ...membership, unit })} placeholder="101" /></Field>
          <div><Button type="submit" disabled={pending || !membership.userId || !membership.buildingId}>{pending ? "Salvando…" : "Salvar vínculo"}</Button></div>
        </fieldset></form>
      </Card>
    </>
  );
}
