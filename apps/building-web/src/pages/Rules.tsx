import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  ResourceFeedback,
  Select,
  useResource,
  useFeatures,
} from "@predioon/ui";
import { SEVERITY_LABELS } from "@predioon/ui";
import { deviceFeatures, metricFeature } from "@predioon/shared";
import type { AlertRule, Device, Paged } from "@predioon/ui";

const OPERATORS = [
  { value: "LT" as const, label: "menor que" },
  { value: "LTE" as const, label: "menor ou igual" },
  { value: "GT" as const, label: "maior que" },
  { value: "GTE" as const, label: "maior ou igual" },
  { value: "EQ" as const, label: "igual a" },
  { value: "NEQ" as const, label: "diferente de" },
];
const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
type Authorization = { capabilities: string[] };
type DeviceChoice = { id: string; label: string };
type Rights = {
  data: Authorization | null;
  loading: boolean;
  error: string | null;
};
const capabilities = (rights: Rights) =>
  !rights.loading && !rights.error ? (rights.data?.capabilities ?? []) : [];
const manages = (rights: string[]) =>
  rights.includes("alert-rules:read") && rights.includes("alert-rules:manage");
function scopePath(
  buildingId: string,
  type?: "alert_rule" | "device",
  id?: string,
) {
  const query = new URLSearchParams({ buildingId });
  if (type && id) {
    query.set("resourceType", type);
    query.set("resourceId", id);
  }
  return `/v1/authorization?${query}`;
}
async function currentCapabilities(
  buildingId: string,
  type?: "alert_rule" | "device",
  id?: string,
) {
  try {
    return (await api.get<Authorization>(scopePath(buildingId, type, id)))
      .capabilities;
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status))
      return [];
    throw error;
  }
}

export function Rules({ buildingId }: { buildingId: string }) {
  const [revision, setRevision] = useState(0);
  const [selectedDevice, setSelectedDevice] = useState<DeviceChoice | null>(
    null,
  );
  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "saved">("active");
  const pendingChanges = useRef(new Set<string>());
  const [pendingRuleIds, setPendingRuleIds] = useState<string[]>([]);
  const [ruleErrors, setRuleErrors] = useState<Record<string, string | null>>({});
  const rules = useResource<Paged<AlertRule>>(
    `/alert-rules?buildingId=${encodeURIComponent(buildingId)}`,
    [revision],
  );
  const authorization = useResource<Authorization>(scopePath(buildingId), [
    revision,
  ]);
  const whole = capabilities(authorization);
  // A refresh disables actions without destroying the user's draft. A denied
  // response clears data in useResource and unmounts the now-unauthorized form.
  const knownWhole = !authorization.error
    ? (authorization.data?.capabilities ?? [])
    : [];
  const canCreate = manages(knownWhole);
  const devices = useResource<Paged<Device>>(
    canCreate && knownWhole.includes("devices:read")
      ? `/devices?buildingId=${encodeURIComponent(buildingId)}`
      : null,
    [revision],
  );
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [refresh]);
  const flags = useFeatures();
  const options = new Map<string, DeviceChoice>();
  for (const rule of rules.data?.items ?? [])
    if (rule.deviceId && !options.has(rule.deviceId))
      options.set(rule.deviceId, {
        id: rule.deviceId,
        label: `Equipamento de ${rule.name}`,
      });
  for (const device of devices.data?.items ?? []) {
    const keys = deviceFeatures(device.type);
    if (!keys.length || keys.some(flags.enabled))
      options.set(device.id, { id: device.id, label: device.name });
  }
  const activeRules = (rules.data?.items ?? []).filter(rule => rule.enabled);
  const savedRules = (rules.data?.items ?? []).filter(rule => !rule.enabled);
  const visibleRules = tab === "active" ? activeRules : savedRules;
  async function toggleRule(rule: AlertRule) {
    if (pendingChanges.current.has(rule.id)) return;
    pendingChanges.current.add(rule.id);
    setPendingRuleIds([...pendingChanges.current]);
    setRuleErrors(current => ({ ...current, [rule.id]: null }));
    try {
      // Keep both current permission checks when a row moves between tabs.
      const [exactRights, deviceRights] = await Promise.all([
        currentCapabilities(buildingId, "alert_rule", rule.id),
        rule.deviceId ? currentCapabilities(buildingId, "device", rule.deviceId) : Promise.resolve([]),
      ]);
      if (!manages([...exactRights, ...deviceRights]))
        throw new Error("Sua permissão para alterar esta regra não está mais disponível.");
      await api.patch(`/alert-rules/${rule.id}`, { enabled: !rule.enabled });
      refresh();
    } catch (cause) {
      setRuleErrors(current => ({ ...current, [rule.id]: cause instanceof Error ? cause.message : "Falha ao atualizar regra" }));
      refresh();
    } finally {
      pendingChanges.current.delete(rule.id);
      setPendingRuleIds([...pendingChanges.current]);
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Regras de alerta</h1>
        <Button
          variant="secondary"
          onClick={refresh}
          disabled={rules.loading || authorization.loading}
        >
          Atualizar regras
        </Button>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        {canCreate ? (
          <CreateRule
            key="whole"
            buildingId={buildingId}
            choices={[...options.values()]}
            checking={authorization.loading}
            onCreated={refresh}
          />
        ) : (
          selectedDevice && (
            <ScopedCreation
              key={selectedDevice.id}
              buildingId={buildingId}
              device={selectedDevice}
              revision={revision}
              onCreated={refresh}
            />
          )
        )}
        <Card
          title="Regras cadastradas"
          className={
            canCreate || selectedDevice ? "xl:col-span-2" : "xl:col-span-3"
          }
        >
          <div role="tablist" aria-label="Regras de alerta" className="mb-4 flex gap-1 border-b border-slate-200">
            {([
              { key: "active", label: "Regras ativas", count: activeRules.length },
              { key: "saved", label: "Regras salvas", count: savedRules.length },
            ] as const).map(item => (
              <button
                key={item.key}
                id={`rules-${item.key}-tab`}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                aria-controls="rules-panel"
                tabIndex={tab === item.key ? 0 : -1}
                onClick={() => setTab(item.key)}
                onKeyDown={event => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === "Home" ? "active" : event.key === "End" ? "saved" : tab === "active" ? "saved" : "active";
                  setTab(next);
                  document.getElementById(`rules-${next}-tab`)?.focus();
                }}
                className={`flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 ${tab === item.key ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}
              >
                {item.label}
                <span aria-hidden="true" className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{rules.data ? item.count : "—"}</span>
              </button>
            ))}
          </div>
          <div id="rules-panel" role="tabpanel" aria-labelledby={`rules-${tab}-tab`} aria-busy={rules.loading} tabIndex={0}>
          {tab === "saved" && <p className="mb-4 text-sm leading-6 text-slate-600">As regras salvas estão desativadas e não geram alertas. Os padrões são disponibilizados para todos os condomínios. Revise os limites antes de ativar.</p>}
          {visibleRules.length ? (
            <ul className="space-y-3">
              {visibleRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  buildingId={buildingId}
                  whole={whole}
                  revision={revision}
                  pending={pendingRuleIds.includes(rule.id)}
                  error={ruleErrors[rule.id] ?? null}
                  onToggle={() => void toggleRule(rule)}
                  onDismissError={() => setRuleErrors(current => ({ ...current, [rule.id]: null }))}
                  onCreate={setSelectedDevice}
                  selected={selectedRule === rule.id}
                  onSelect={() =>
                    setSelectedRule((current) =>
                      current === rule.id ? null : rule.id,
                    )
                  }
                />
              ))}
            </ul>
          ) : (
            <ResourceFeedback
              resource={rules}
              emptyText={tab === "active" ? "Nenhuma regra ativa. Ative uma regra na aba Regras salvas ou crie uma nova." : "Nenhuma regra salva. As regras desativadas aparecem aqui."}
            />
          )}
          </div>
        </Card>
      </div>
    </>
  );
}

function RuleRow({
  rule,
  buildingId,
  whole,
  revision,
  pending,
  error,
  onToggle,
  onDismissError,
  onCreate,
  selected,
  onSelect,
}: {
  rule: AlertRule;
  buildingId: string;
  whole: string[];
  revision: number;
  pending: boolean;
  error: string | null;
  onToggle: () => void;
  onDismissError: () => void;
  onCreate: (device: DeviceChoice) => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const wholeManagement = manages(whole);
  const exact = useResource<Authorization>(
    !wholeManagement && selected
      ? scopePath(buildingId, "alert_rule", rule.id)
      : null,
    [revision],
  );
  const device = useResource<Authorization>(
    !wholeManagement && selected && rule.deviceId
      ? scopePath(buildingId, "device", rule.deviceId)
      : null,
    [revision],
  );
  const canManage = manages([
    ...whole,
    ...capabilities(exact),
    ...capabilities(device),
  ]);
  const canCreate =
    rule.deviceId && manages([...whole, ...capabilities(device)]);
  return (
    <li className="space-y-3 rounded-xl border border-slate-100 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{rule.name}</p>
          <p className="mt-0.5 break-words text-xs leading-5 text-slate-500">
            {rule.metric}{" "}
            {OPERATORS.find((item) => item.value === rule.operator)?.label ??
              rule.operator}{" "}
            {rule.threshold}
            {" · "}intervalo {rule.cooldownSeconds}s
            {rule.deviceId ? " · equipamento específico" : " · todos do prédio"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rule.templateKey && <Badge tone="info">Padrão</Badge>}
          <Badge>{rule.severity}</Badge>
          <Badge>{rule.enabled ? "Ativa" : "Desativada"}</Badge>
          {canManage && (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={onToggle}
            >
              {pending ? "Salvando…" : rule.enabled ? "Desativar" : "Ativar"}
            </Button>
          )}
        </div>
      </div>
      {!wholeManagement && (
        <Button variant="secondary" onClick={onSelect}>
          {selected ? "Ocultar ações" : "Ver ações desta regra"}
        </Button>
      )}
      {selected && !canManage && !exact.loading && !device.loading && (
        <p className="text-xs text-slate-500">
          Esta regra está disponível para consulta.
        </p>
      )}
      {!wholeManagement && canCreate && (
        <Button
          variant="secondary"
          onClick={() =>
            onCreate({
              id: rule.deviceId!,
              label: `Equipamento de ${rule.name}`,
            })
          }
        >
          Nova regra neste equipamento
        </Button>
      )}
      {error && (
        <ErrorBanner message={error} onDismiss={onDismissError} />
      )}
    </li>
  );
}

function ScopedCreation({
  buildingId,
  device,
  revision,
  onCreated,
}: {
  buildingId: string;
  device: DeviceChoice;
  revision: number;
  onCreated: () => void;
}) {
  const authorization = useResource<Authorization>(
    scopePath(buildingId, "device", device.id),
    [revision],
  );
  if (authorization.error || !manages(authorization.data?.capabilities ?? []))
    return null;
  return (
    <CreateRule
      buildingId={buildingId}
      choices={[device]}
      fixedDevice={device}
      checking={authorization.loading}
      onCreated={onCreated}
    />
  );
}

function CreateRule({
  buildingId,
  choices,
  fixedDevice,
  checking,
  onCreated,
}: {
  buildingId: string;
  choices: DeviceChoice[];
  fixedDevice?: DeviceChoice;
  checking: boolean;
  onCreated: () => void;
}) {
  const flags = useFeatures();
  const initial = () => ({
    name: "",
    deviceId: fixedDevice?.id ?? "",
    metric: "",
    operator: "LT" as (typeof OPERATORS)[number]["value"],
    threshold: "20",
    severity: "HIGH" as (typeof SEVERITIES)[number],
    cooldownSeconds: "900",
  });
  const [form, setForm] = useState(initial),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const feature = metricFeature(form.metric),
    metricAvailable = !feature || flags.enabled(feature);
  const valid =
    Boolean(form.name.trim() && form.metric.trim()) &&
    Number.isFinite(Number(form.threshold)) &&
    form.threshold.trim() !== "" &&
    Number.isInteger(Number(form.cooldownSeconds)) &&
    Number(form.cooldownSeconds) >= 0 &&
    Number(form.cooldownSeconds) <= 86400;
  async function create() {
    if (pending || checking || !valid) return;
    setPending(true);
    setError(null);
    try {
      const rights = await currentCapabilities(
        buildingId,
        form.deviceId ? "device" : undefined,
        form.deviceId || undefined,
      );
      if (!manages(rights))
        throw new Error(
          "Sua permissão para criar regras neste destino não está mais disponível.",
        );
      await api.post("/alert-rules", {
        buildingId,
        deviceId: form.deviceId || null,
        name: form.name.trim(),
        metric: form.metric.trim(),
        operator: form.operator,
        threshold: Number(form.threshold),
        severity: form.severity,
        alertType: form.metric.toUpperCase(),
        messageTemplate: `${form.name}: {value}`,
        cooldownSeconds: Number(form.cooldownSeconds),
      });
      setForm(initial());
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar regra");
      onCreated();
    } finally {
      setPending(false);
    }
  }
  return (
    <Card
      title={fixedDevice ? "Nova regra neste equipamento" : "Nova regra"}
      className="xl:col-span-1"
    >
      <div className="space-y-3 [&_.text-slate-400]:text-slate-500">
        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}
        <Field label="Nome">
          <Input
            value={form.name}
            onChange={(name) => setForm({ ...form, name })}
            placeholder="Nível baixo da caixa"
          />
        </Field>
        <Field label="Dispositivo">
          <Select
            value={form.deviceId}
            onChange={(deviceId) => setForm({ ...form, deviceId })}
            disabled={Boolean(fixedDevice)}
            options={[
              ...(!fixedDevice
                ? [{ value: "", label: "Todos do prédio" }]
                : []),
              ...choices.map((device) => ({
                value: device.id,
                label: device.label,
              })),
            ]}
          />
        </Field>
        <Field label="Métrica" hint="mesma chave publicada pelo gateway">
          <Input
            value={form.metric}
            onChange={(metric) => setForm({ ...form, metric })}
            placeholder="water_level_percent"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Condição">
            <Select
              value={form.operator}
              onChange={(operator) => setForm({ ...form, operator })}
              options={OPERATORS}
            />
          </Field>
          <Field label="Limite">
            <Input
              type="number"
              value={form.threshold}
              onChange={(threshold) => setForm({ ...form, threshold })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Severidade">
            <Select
              value={form.severity}
              onChange={(severity) => setForm({ ...form, severity })}
              options={SEVERITIES.map((value) => ({ value, label: SEVERITY_LABELS[value] ?? value }))}
            />
          </Field>
          <Field label="Intervalo (s)" hint="evita repetir alerta">
            <Input
              type="number"
              value={form.cooldownSeconds}
              onChange={(cooldownSeconds) =>
                setForm({ ...form, cooldownSeconds })
              }
            />
          </Field>
        </div>
        {!metricAvailable && (
          <p role="status" className="text-sm text-slate-500">
            O monitoramento desta métrica está desativado para este condomínio.
          </p>
        )}
        <Button
          full
          onClick={() => void create()}
          disabled={
            pending || checking || !valid || !metricAvailable || flags.loading
          }
        >
          Criar regra
        </Button>
      </div>
    </Card>
  );
}
