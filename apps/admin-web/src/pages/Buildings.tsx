import { useState } from "react";
import { api, Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Select, useResource } from "@predioon/ui";
import type { Paged } from "@predioon/ui";
import { CreatePropertySchema, PROPERTY_TYPES, type PropertyType } from "@predioon/shared";

type Organization = { id: string; name: string };
type Building = { id: string; organizationId: string; name: string; code: string; propertyType: PropertyType; timezone: string; active: boolean };

export function Buildings() {
  const buildings = useResource<Paged<Building>>("/buildings");
  const clients = useResource<Paged<Organization>>("/organizations");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ organizationId: "", name: "", code: "", propertyType: "CONDOMINIUM" as PropertyType, timezone: "America/Sao_Paulo" });

  async function create() {
    try {
      setError(null);
      const result = CreatePropertySchema.safeParse(form);
      if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Confira os dados do imóvel");
      await api.post("/buildings", result.data);
      setForm({ ...form, name: "", code: "" });
      buildings.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar imóvel");
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Imóveis</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Novo imóvel">
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
            <Field label="Tipo de imóvel">
              <Select value={form.propertyType} onChange={(propertyType) => setForm({ ...form, propertyType })} options={[...PROPERTY_TYPES]} />
            </Field>
            <Field label="Fuso horário" hint="Usado para dias de consumo e estimativas. Ex.: America/Sao_Paulo ou America/Manaus.">
              <Input value={form.timezone} onChange={(timezone) => setForm({ ...form, timezone })} placeholder="America/Sao_Paulo" />
            </Field>
            <Button full onClick={() => void create()} disabled={!form.organizationId || !form.name || !form.code || !form.timezone.trim()}>
              Cadastrar
            </Button>
          </div>
        </Card>

        <Card title="Imóveis cadastrados" className="xl:col-span-2">
          {buildings.data?.items.length ? (
            <ul className="space-y-2">
              {buildings.data.items.map((building) => (
                <li key={building.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="font-medium text-slate-800">{building.name}</p>
                    <p className="mt-1 text-xs font-medium text-slate-600">{PROPERTY_TYPES.find((type) => type.value === building.propertyType)?.label ?? "Condomínio"}</p>
                    <p className="text-xs text-slate-400">
                      {building.id} · {building.code} · {building.timezone}
                    </p>
                  </div>
                  <Badge tone={building.active ? "success" : "neutral"}>{building.active ? "ATIVO" : "INATIVO"}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState text={buildings.error ?? "Nenhum imóvel cadastrado."} />
          )}
        </Card>
      </div>
    </>
  );
}
