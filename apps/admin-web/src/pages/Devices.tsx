import { useState } from "react";
import { api, Badge, Button, Card, EmptyState, ErrorBanner, Field, formatRelative, Input, Select, useResource } from "@predioon/ui";
import type { Device, Paged } from "@predioon/ui";
import { SENSOR_DEVICE_TYPES } from "@predioon/shared";

type Building = { id: string; name: string };
type Gateway = { id: string; name: string; buildingId: string };

const TYPES = [...SENSOR_DEVICE_TYPES, { value: "GATE_CONTROLLER", label: "Controlador de portão" }];

export function Devices() {
  const [buildingId, setBuildingId] = useState("");
  const buildings = useResource<Paged<Building>>("/buildings");
  const gateways = useResource<Paged<Gateway>>("/gateways");
  const devices = useResource<Paged<Device>>(buildingId ? `/devices?buildingId=${buildingId}` : "/devices", [buildingId]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ gatewayId: "", name: "", type: "WATER_LEVEL_SENSOR", hardwareAddress: "" });

  async function create() {
    try {
      const gateway = gateways.data?.items.find((item) => item.id === form.gatewayId);
      if (!gateway) throw new Error("Escolha um gateway");
      await api.post("/devices", {
        buildingId: gateway.buildingId,
        gatewayId: gateway.id,
        name: form.name,
        type: form.type,
        hardwareAddress: form.hardwareAddress || undefined,
      });
      setForm({ ...form, name: "", hardwareAddress: "" });
      devices.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar dispositivo");
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Dispositivos</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Novo dispositivo">
          <div className="space-y-3">
            <Field label="Gateway">
              <Select
                value={form.gatewayId}
                onChange={(gatewayId) => setForm({ ...form, gatewayId })}
                options={[
                  { value: "", label: "Escolha um gateway" },
                  ...(gateways.data?.items ?? []).map((gateway) => ({ value: gateway.id, label: gateway.name })),
                ]}
              />
            </Field>
            <Field label="Nome">
              <Input value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="Caixa superior" />
            </Field>
            <Field label="Tipo">
              <Select value={form.type} onChange={(type) => setForm({ ...form, type })} options={TYPES} />
            </Field>
            <Field label="Endereço de campo" hint="ex.: modbus:1 ou di:2">
              <Input
                value={form.hardwareAddress}
                onChange={(hardwareAddress) => setForm({ ...form, hardwareAddress })}
                placeholder="modbus:1"
              />
            </Field>
            <Button full onClick={() => void create()} disabled={!form.gatewayId || !form.name}>
              Cadastrar
            </Button>
          </div>
        </Card>

        <Card
          title="Dispositivos"
          className="xl:col-span-2"
          action={
            <div className="w-52">
              <Select
                value={buildingId}
                onChange={setBuildingId}
                options={[
                  { value: "", label: "Todos os prédios" },
                  ...(buildings.data?.items ?? []).map((building) => ({ value: building.id, label: building.name })),
                ]}
              />
            </div>
          }
        >
          {devices.data?.items.length ? (
            <ul className="space-y-2">
              {devices.data.items.map((device) => (
                <li key={device.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="font-medium text-slate-800">{device.name}</p>
                    <p className="text-xs text-slate-400">
                      {device.id} · {TYPES.find((type) => type.value === device.type)?.label ?? device.type} · {device.gatewayId ?? "sem gateway"}
                    </p>
                    <p className="text-xs text-slate-400">Última leitura {formatRelative(device.lastSeenAt)}</p>
                  </div>
                  <Badge>{device.status}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState text={devices.error ?? "Nenhum dispositivo cadastrado."} />
          )}
        </Card>
      </div>
    </>
  );
}
