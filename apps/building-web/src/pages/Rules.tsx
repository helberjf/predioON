import { useState } from "react";
import { api, Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Select, useResource } from "@predioon/ui";
import type { AlertRule, Device, Paged } from "@predioon/ui";

const OPERATORS = [
  { value: "LT" as const, label: "menor que" },
  { value: "LTE" as const, label: "menor ou igual" },
  { value: "GT" as const, label: "maior que" },
  { value: "GTE" as const, label: "maior ou igual" },
  { value: "EQ" as const, label: "igual a" },
];

const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export function Rules({ buildingId }: { buildingId: string }) {
  const rules = useResource<Paged<AlertRule>>(`/alert-rules?buildingId=${buildingId}`);
  const devices = useResource<Paged<Device>>(`/devices?buildingId=${buildingId}`);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    deviceId: "",
    metric: "",
    operator: "LT" as (typeof OPERATORS)[number]["value"],
    threshold: "20",
    severity: "HIGH" as (typeof SEVERITIES)[number],
    cooldownSeconds: "900",
  });

  async function create() {
    try {
      await api.post("/alert-rules", {
        buildingId,
        deviceId: form.deviceId || null,
        name: form.name,
        metric: form.metric,
        operator: form.operator,
        threshold: Number(form.threshold),
        severity: form.severity,
        alertType: form.metric.toUpperCase(),
        messageTemplate: `${form.name}: {value}`,
        cooldownSeconds: Number(form.cooldownSeconds),
      });
      setForm({ ...form, name: "", metric: "" });
      rules.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar regra");
    }
  }

  async function toggle(rule: AlertRule) {
    await api.patch(`/alert-rules/${rule.id}`, { enabled: !rule.enabled });
    rules.reload();
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Regras de alerta</h1>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Nova regra" className="xl:col-span-1">
          <div className="space-y-3">
            <Field label="Nome">
              <Input value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="Nível baixo da caixa" />
            </Field>
            <Field label="Dispositivo">
              <Select
                value={form.deviceId}
                onChange={(deviceId) => setForm({ ...form, deviceId })}
                options={[{ value: "", label: "Todos do prédio" }, ...(devices.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))]}
              />
            </Field>
            <Field label="Métrica" hint="mesma chave publicada pelo gateway">
              <Input value={form.metric} onChange={(metric) => setForm({ ...form, metric })} placeholder="water_level_percent" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Condição">
                <Select value={form.operator} onChange={(operator) => setForm({ ...form, operator })} options={OPERATORS} />
              </Field>
              <Field label="Limite">
                <Input type="number" value={form.threshold} onChange={(threshold) => setForm({ ...form, threshold })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Severidade">
                <Select
                  value={form.severity}
                  onChange={(severity) => setForm({ ...form, severity })}
                  options={SEVERITIES.map((value) => ({ value, label: value }))}
                />
              </Field>
              <Field label="Cooldown (s)" hint="evita repetir alerta">
                <Input type="number" value={form.cooldownSeconds} onChange={(cooldownSeconds) => setForm({ ...form, cooldownSeconds })} />
              </Field>
            </div>
            <Button full onClick={() => void create()} disabled={!form.name || !form.metric}>
              Criar regra
            </Button>
          </div>
        </Card>

        <Card title="Regras ativas" className="xl:col-span-2">
          {rules.data?.items.length ? (
            <ul className="space-y-3">
              {rules.data.items.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{rule.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {rule.metric} {OPERATORS.find((o) => o.value === rule.operator)?.label ?? rule.operator} {rule.threshold}
                      {" · "}cooldown {rule.cooldownSeconds}s{rule.deviceId ? ` · ${rule.deviceId}` : " · todos"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>{rule.severity}</Badge>
                    <Button variant="secondary" onClick={() => void toggle(rule)}>
                      {rule.enabled ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState text="Nenhuma regra cadastrada." />
          )}
        </Card>
      </div>
    </>
  );
}
