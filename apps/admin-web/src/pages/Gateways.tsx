import { useState } from "react";
import { api, Badge, Button, Card, EmptyState, ErrorBanner, Field, formatRelative, Input, Select, useResource } from "@predioon/ui";
import type { Paged } from "@predioon/ui";

type Building = { id: string; name: string };
type Gateway = {
  id: string;
  buildingId: string;
  name: string;
  serialNumber: string;
  model: string | null;
  status: string;
  lastSeenAt: string | null;
};

type Credentials = {
  gatewayId: string;
  buildingId: string;
  mqttUsername: string;
  mqttPassword: string;
  mqttClientId: string;
  mqttPort: number;
  waterTelemetryTopic: string;
  telemetryTopic: string;
  statusTopic: string;
};

export function Gateways() {
  const gateways = useResource<Paged<Gateway>>("/gateways");
  const buildings = useResource<Paged<Building>>("/buildings");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Credentials | null>(null);
  const [form, setForm] = useState({ buildingId: "", name: "", serialNumber: "", model: "" });

  async function create() {
    try {
      await api.post("/gateways", { ...form, model: form.model || undefined });
      setForm({ buildingId: form.buildingId, name: "", serialNumber: "", model: "" });
      gateways.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar gateway");
    }
  }

  async function issueCredentials(gatewayId: string) {
    try {
      setIssued(await api.post<Credentials>(`/gateways/${gatewayId}/credentials`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao gerar credencial");
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Gateways</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {issued && (
        <Card title="Credencial gerada" subtitle="A senha aparece uma única vez. Configure estes dados no gateway e use o host MQTT da sua instalação.">
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-400">Usuário MQTT</dt>
              <dd className="font-mono text-slate-800">{issued.mqttUsername}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Senha MQTT</dt>
              <dd className="break-all font-mono text-slate-800">{issued.mqttPassword}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Identificador da conexão (clientId)</dt>
              <dd className="break-all font-mono text-slate-800">{issued.mqttClientId}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Conexão de produção</dt>
              <dd className="text-slate-800">TLS · porta {issued.mqttPort}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs text-slate-400">Tópico da caixa d'água — substitua o sensor pelo ID cadastrado</dt>
              <dd className="break-all font-mono text-xs text-slate-800">{issued.waterTelemetryTopic}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs text-slate-400">Tópico de telemetria</dt>
              <dd className="break-all font-mono text-xs text-slate-800">{issued.telemetryTopic}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs text-slate-400">Tópico de status</dt>
              <dd className="break-all font-mono text-xs text-slate-800">{issued.statusTopic}</dd>
            </div>
          </dl>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => setIssued(null)}>
              Já anotei
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Novo gateway">
          <div className="space-y-3">
            <Field label="Prédio">
              <Select
                value={form.buildingId}
                onChange={(buildingId) => setForm({ ...form, buildingId })}
                options={[
                  { value: "", label: "Escolha um prédio" },
                  ...(buildings.data?.items ?? []).map((building) => ({ value: building.id, label: building.name })),
                ]}
              />
            </Field>
            <Field label="Nome">
              <Input value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="Gateway casa de máquinas" />
            </Field>
            <Field label="Número de série">
              <Input value={form.serialNumber} onChange={(serialNumber) => setForm({ ...form, serialNumber })} placeholder="GW-0002" />
            </Field>
            <Field label="Modelo">
              <Input value={form.model} onChange={(model) => setForm({ ...form, model })} placeholder="Teltonika RUT956" />
            </Field>
            <Button full onClick={() => void create()} disabled={!form.buildingId || !form.name || !form.serialNumber}>
              Cadastrar
            </Button>
          </div>
        </Card>

        <Card title="Gateways instalados" className="xl:col-span-2">
          {gateways.data?.items.length ? (
            <ul className="space-y-2">
              {gateways.data.items.map((gateway) => (
                <li key={gateway.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{gateway.name}</p>
                    <p className="text-xs text-slate-400">
                      {gateway.id} · {gateway.serialNumber} · {gateway.model ?? "modelo não informado"}
                    </p>
                    <p className="text-xs text-slate-400">Último contato {formatRelative(gateway.lastSeenAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge>{gateway.status}</Badge>
                    <Button variant="secondary" onClick={() => void issueCredentials(gateway.id)}>
                      Gerar credencial
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState text={gateways.error ?? "Nenhum gateway cadastrado."} />
          )}
        </Card>
      </div>
    </>
  );
}
