import { useState } from "react";
import { api, Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, useResource } from "@predioon/ui";
import type { Paged } from "@predioon/ui";

type Organization = { id: string; name: string; slug: string; active: boolean };

export function Clients() {
  const clients = useResource<Paged<Organization>>("/organizations");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", slug: "" });

  async function create() {
    try {
      await api.post("/organizations", form);
      setForm({ name: "", slug: "" });
      clients.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar cliente");
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Novo cliente">
          <div className="space-y-3">
            <Field label="Nome">
              <Input value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="Administradora Alfa" />
            </Field>
            <Field label="Slug" hint="minúsculas, números e hífen">
              <Input value={form.slug} onChange={(slug) => setForm({ ...form, slug })} placeholder="administradora-alfa" />
            </Field>
            <Button full onClick={() => void create()} disabled={!form.name || !form.slug}>
              Cadastrar
            </Button>
          </div>
        </Card>

        <Card title="Clientes cadastrados" className="xl:col-span-2">
          {clients.data?.items.length ? (
            <ul className="space-y-2">
              {clients.data.items.map((client) => (
                <li key={client.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="font-medium text-slate-800">{client.name}</p>
                    <p className="text-xs text-slate-400">
                      {client.id} · {client.slug}
                    </p>
                  </div>
                  <Badge tone={client.active ? "success" : "neutral"}>{client.active ? "ATIVO" : "INATIVO"}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState text={clients.error ?? "Nenhum cliente cadastrado."} />
          )}
        </Card>
      </div>
    </>
  );
}
