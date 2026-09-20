import { useState } from "react";
import { api, Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Select, useResource } from "@predioon/ui";
import type { Paged } from "@predioon/ui";

type Organization = { id: string; name: string };
type Building = { id: string; organizationId: string; name: string; code: string; timezone: string; active: boolean };

export function Buildings() {
  const buildings = useResource<Paged<Building>>("/buildings");
  const clients = useResource<Paged<Organization>>("/organizations");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ organizationId: "", name: "", code: "" });

  async function create() {
    try {
      await api.post("/buildings", form);
      setForm({ organizationId: form.organizationId, name: "", code: "" });
      buildings.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar prédio");
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Prédios</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Novo prédio">
          <div className="space-y-3">
            <Field label="Cliente">
              <Select
                value={form.organizationId}
                onChange={(organizationId) => setForm({ ...form, organizationId })}
                options={[
                  { value: "", label: "Escolha um cliente" },
                  ...(clients.data?.items ?? []).map((client) => ({ value: client.id, label: client.name })),
                ]}
              />
            </Field>
            <Field label="Nome">
              <Input value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="Residencial das Flores" />
            </Field>
            <Field label="Código" hint="identificador curto usado na operação">
              <Input value={form.code} onChange={(code) => setForm({ ...form, code })} placeholder="FLORES" />
            </Field>
            <Button full onClick={() => void create()} disabled={!form.organizationId || !form.name || !form.code}>
              Cadastrar
            </Button>
          </div>
        </Card>

        <Card title="Prédios cadastrados" className="xl:col-span-2">
          {buildings.data?.items.length ? (
            <ul className="space-y-2">
              {buildings.data.items.map((building) => (
                <li key={building.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="font-medium text-slate-800">{building.name}</p>
                    <p className="text-xs text-slate-400">
                      {building.id} · {building.code} · {building.timezone}
                    </p>
                  </div>
                  <Badge tone={building.active ? "success" : "neutral"}>{building.active ? "ATIVO" : "INATIVO"}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState text={buildings.error ?? "Nenhum prédio cadastrado."} />
          )}
        </Card>
      </div>
    </>
  );
}
