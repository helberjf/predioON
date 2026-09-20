import { useState } from "react";
import { api, Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Select, useResource } from "@predioon/ui";
import type { Paged } from "@predioon/ui";

type Building = { id: string; name: string };
type UserRow = { id: string; name: string; email: string; isPlatformAdmin: boolean; active: boolean };

export function Users() {
  const users = useResource<Paged<UserRow>>("/users");
  const buildings = useResource<Paged<Building>>("/buildings");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", buildingId: "", role: "RESIDENT", unit: "" });

  async function create() {
    try {
      const created = await api.post<{ id: string }>("/users", {
        name: form.name,
        email: form.email,
        password: form.password,
        isPlatformAdmin: false,
      });
      if (form.buildingId) {
        await api.post("/users/memberships", {
          userId: created.id,
          buildingId: form.buildingId,
          role: form.role,
          unit: form.unit || undefined,
        });
      }
      setForm({ ...form, name: "", email: "", password: "", unit: "" });
      users.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar usuário");
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Usuários</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Novo usuário" subtitle="Cria a conta e o vínculo com o prédio">
          <div className="space-y-3">
            <Field label="Nome">
              <Input value={form.name} onChange={(name) => setForm({ ...form, name })} />
            </Field>
            <Field label="E-mail">
              <Input type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
            </Field>
            <Field label="Senha provisória" hint="mínimo 8 caracteres">
              <Input type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
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
                    { value: "BUILDING_ADMIN", label: "Síndico / zelador" },
                  ]}
                />
              </Field>
              <Field label="Unidade">
                <Input value={form.unit} onChange={(unit) => setForm({ ...form, unit })} placeholder="101" />
              </Field>
            </div>
            <Button full onClick={() => void create()} disabled={!form.name || !form.email || form.password.length < 8}>
              Criar usuário
            </Button>
          </div>
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
            <EmptyState text={users.error ?? "Nenhum usuário encontrado."} />
          )}
        </Card>
      </div>
    </>
  );
}
