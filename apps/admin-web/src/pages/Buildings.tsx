import { useEffect, useState } from "react";
import { api, Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, ResourceFeedback, Select, useResource } from "@predioon/ui";
import type { Paged } from "@predioon/ui";
import type { OrganizationView } from "@predioon/contracts";
import { CreatePropertySchema, PROPERTY_TYPES, type PropertyType } from "@predioon/shared";
import { OrganizationAccessFeedback, useOrganizationAccess, useOrganizationMutation } from "../organization-access.js";

type Building = { id: string; organizationId: string; name: string; code: string; propertyType: PropertyType; timezone: string; active: boolean };
type PropertyDraft = { name: string; code: string; propertyType: PropertyType; timezone: string };

export function Buildings() {
  const buildings = useResource<Paged<Building>>("/buildings");
  const access = useOrganizationAccess();
  const [form, setForm] = useState<PropertyDraft>({ name: "", code: "", propertyType: "CONDOMINIUM", timezone: "America/Sao_Paulo" });

  return <>
    <h1 className="text-2xl font-bold text-slate-900">Imóveis</h1>
    <div className="grid gap-5 xl:grid-cols-3">
      {/* A confirmed revocation discards the commercial resource, selection and
          pending intent at commit, even if React batches a rapid regrant. */}
      <BuildingCreation key={access.readEpoch} form={form} setForm={setForm} onCreated={buildings.reload} />
      <Card title="Imóveis cadastrados" className="xl:col-span-2">
        {buildings.data?.items.length ? <ul className="space-y-2">
          {buildings.data.items.map(building => <li key={building.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
            <div>
              <p className="font-medium text-slate-800">{building.name}</p>
              <p className="mt-1 text-xs font-medium text-slate-600">{PROPERTY_TYPES.find(type => type.value === building.propertyType)?.label ?? "Condomínio"}</p>
              <p className="text-xs text-slate-400">{building.id} · {building.code} · {building.timezone}</p>
            </div>
            <Badge tone={building.active ? "success" : "neutral"}>{building.active ? "ATIVO" : "INATIVO"}</Badge>
          </li>)}
        </ul> : <EmptyState text={buildings.error ?? "Nenhum imóvel cadastrado."} />}
      </Card>
    </div>
  </>;
}

function BuildingCreation({ form, setForm, onCreated }: { form: PropertyDraft; setForm(value: PropertyDraft): void; onCreated(): void }) {
  const access = useOrganizationAccess();
  const mutation = useOrganizationMutation();
  const clients = useResource<Paged<OrganizationView>>(access.canRead ? "/organizations" : null);
  const [organizationId, setOrganizationId] = useState("");
  const selectedOrganization = access.canRead && clients.data?.items.some(row => row.id === organizationId) ? organizationId : "";
  useEffect(() => { if (clients.errorStatus === 403) access.invalidate(); }, [clients.errorStatus, access.invalidate]);
  useEffect(() => {
    if (!access.canRead) { mutation.cancelPendingIntent(); setOrganizationId(""); }
  }, [access.canRead]);

  function create() {
    const result = CreatePropertySchema.safeParse({ ...form, organizationId: selectedOrganization });
    if (!result.success) { mutation.setError(result.error.issues[0]?.message ?? "Confira os dados do imóvel"); return; }
    void mutation.run("read", () => api.post("/buildings", result.data), () => {
      setForm({ ...form, name: "", code: "" });
      onCreated();
    });
  }

  return (
    <Card title="Novo imóvel">
      {mutation.error && <ErrorBanner message={mutation.error} onDismiss={() => mutation.setError(null)} />}
          <div className="space-y-3">
            {!access.canRead ? <OrganizationAccessFeedback /> : clients.error ? <ResourceFeedback resource={clients} emptyText="" /> : <Field label="Cliente">
              <Select
                value={selectedOrganization}
                disabled={mutation.busy || access.checking || clients.loading}
                onChange={(value) => { mutation.cancelPendingIntent(); setOrganizationId(value); }}
                options={[
                  { value: "", label: "Escolha um cliente" },
                  ...(clients.data?.items ?? []).map((client) => ({ value: client.id, label: client.name })),
                ]}
              />
            </Field>}
            <Field label="Nome">
              <Input value={form.name} disabled={mutation.busy} onChange={(name) => setForm({ ...form, name })} placeholder="Residencial das Flores" />
            </Field>
            <Field label="Código" hint="identificador curto usado na operação">
              <Input value={form.code} disabled={mutation.busy} onChange={(code) => setForm({ ...form, code })} placeholder="FLORES" />
            </Field>
            <Field label="Tipo de imóvel">
              <Select value={form.propertyType} disabled={mutation.busy} onChange={(propertyType) => setForm({ ...form, propertyType })} options={[...PROPERTY_TYPES]} />
            </Field>
            <Field label="Fuso horário" hint="Usado para dias de consumo e estimativas. Ex.: America/Sao_Paulo ou America/Manaus.">
              <Input value={form.timezone} disabled={mutation.busy} onChange={(timezone) => setForm({ ...form, timezone })} placeholder="America/Sao_Paulo" />
            </Field>
            <Button full onClick={create} disabled={mutation.busy || access.checking || !selectedOrganization || !form.name || !form.code || !form.timezone.trim()}>
              Cadastrar
            </Button>
          </div>
    </Card>
  );
}
