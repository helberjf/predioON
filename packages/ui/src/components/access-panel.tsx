import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { DoorOpen, LockKeyhole, Settings2 } from "lucide-react";
import type {
  AccessCommandView,
  AccessGateView,
  AccessList,
} from "@predioon/shared";
import { useFeatures } from "../features.js";
import { ACCESS_FEATURES } from "../feature-state.js";
import { api, ApiError } from "../api.js";
import { useAuth } from "../auth.js";
import {
  commandMessage,
  commandSettled,
  createAccessInteractionGuard,
} from "../access-intents.js";
import { useResource } from "../use-resource.js";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeading,
} from "./primitives.js";
import { Field, Input, Select } from "./fields.js";

const labels: Record<AccessCommandView["status"], string> = {
  PENDING: "Aguardando envio",
  SENT: "Enviado · aguardando confirmação",
  ACKNOWLEDGED: "Execução reconhecida pelo controlador",
  FAILED: "Abertura não confirmada",
  EXPIRED: "Prazo encerrado · sem confirmação",
};
const pathFor = (buildingId: string) =>
  `/access?buildingId=${encodeURIComponent(buildingId)}`;
const controllerTypes = ["GARAGE_GATE", "PEDESTRIAN_GATE", "GATE_CONTROLLER"];
const waiting = (command: AccessCommandView | null | undefined) =>
  Boolean(command && !commandSettled(command));
const canCreate = (data: AccessList | null) =>
  Boolean(
    data?.canManage &&
      data.devices.some(
        (device) =>
          controllerTypes.includes(device.type) &&
          data.gateways.some((gateway) => gateway.id === device.gatewayId),
      ),
  );

export function AccessPanel({ buildingId }: { buildingId: string }) {
  const { accessIntents } = useAuth();
  // Tenant navigation resets the view, while the provider retains uncertain IDs.
  return (
    <AccessWorkspace
      key={buildingId}
      buildingId={buildingId}
      store={accessIntents}
    />
  );
}

function AccessWorkspace({
  buildingId,
  store,
}: {
  buildingId: string;
  store: ReturnType<typeof useAuth>["accessIntents"];
}) {
  const flags = useFeatures();
  const resource = useResource<AccessList>(
    buildingId ? pathFor(buildingId) : null,
  );
  const intents = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const guard = useMemo(createAccessInteractionGuard, [store]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [confirmation, setConfirmation] = useState<{
    gate: AccessGateView;
    generation: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const invalidate = () => {
      guard.invalidate();
      setConfirmation(null);
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") invalidate();
      else resource.reload();
    };
    const refresh = () => resource.reload();
    const timer = setInterval(refresh, 3000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", invalidate);
    window.addEventListener("focus", refresh);
    return () => {
      guard.invalidate();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", invalidate);
      window.removeEventListener("focus", refresh);
    };
  }, [guard, resource.reload]);

  useEffect(() => {
    for (const gate of resource.data?.items ?? []) {
      if (gate.buildingId === buildingId && gate.latestCommand)
        store.observe(buildingId, gate.id, gate.latestCommand);
    }
  }, [resource.data, store, buildingId]);

  const gates =
    resource.data?.items.filter(
      (gate) =>
        gate.buildingId === buildingId &&
        flags.enabled(ACCESS_FEATURES[gate.kind]!),
    ) ?? [];
  const selected = gates.find((gate) => gate.id === editing);
  const creating = canCreate(resource.data);
  // A successful poll that removes permission also removes the draft. A draft
  // is not silently resurrected if the permission is granted again later.
  useEffect(() => {
    if (resource.loading || !editing) return;
    if (editing === "new" ? !creating : !selected?.canManage) setEditing(null);
  }, [resource.loading, editing, creating, selected?.canManage]);
  useEffect(() => {
    if (resource.loading || !confirmation) return;
    if (
      !gates.some((gate) => gate.id === confirmation.gate.id && gate.available)
    )
      setConfirmation(null);
  }, [resource.loading, resource.data, confirmation]);

  async function confirmOpen() {
    const captured = confirmation;
    if (!captured) return;
    setConfirmation(null);
    setError(null);
    const current = () =>
      store.isValid() &&
      guard.isCurrent(captured.generation) &&
      document.visibilityState === "visible";
    if (!current()) return;
    await store.submit(buildingId, captured.gate.id, async (requestId) => {
      const fresh = await api.get<AccessList>(pathFor(buildingId));
      const gate = fresh.items.find(
        (item) =>
          item.buildingId === buildingId && item.id === captured.gate.id,
      );
      if (!current())
        throw new Error(
          "A confirmação foi cancelada ao sair da tela ou da sessão. Nenhum pedido foi enviado nesta tentativa.",
        );
      if (!gate?.available)
        throw new Error(
          gate?.unavailableReason ??
            "Este acesso não está mais disponível para sua sessão.",
        );
      return api.post<AccessCommandView>(`/access/${gate.id}/open`, {
        requestId,
      });
    });
    if (current()) resource.reload();
  }

  return (
    <div className="space-y-5">
      <PageHeading
        title="Acessos"
        description="Solicite a abertura da garagem ou da entrada de pedestres e acompanhe a resposta do controlador."
        action={
          creating ? (
            <Button
              onClick={() => setEditing("new")}
              disabled={resource.loading}
            >
              Cadastrar acesso
            </Button>
          ) : undefined
        }
      />
      {(error || resource.error) && (
        <div className="space-y-2">
          <ErrorBanner
            message={error ?? resource.error!}
            onDismiss={() => setError(null)}
          />
          <Button variant="secondary" onClick={resource.reload}>
            Atualizar acessos
          </Button>
        </div>
      )}
      {resource.loading && !resource.data && <LoadingState />}
      {!buildingId && (
        <EmptyState text="Selecione um prédio para consultar seus acessos." />
      )}
      {resource.data && !gates.length && (
        <EmptyState text="Nenhum acesso disponível neste prédio." />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {gates.map((gate) => {
          const intent = intents[store.key(buildingId, gate.id)];
          // Other history can be shown only when there is no local intent. It can
          // never settle an uncertain POST or replace its request identity.
          const command = intent ? intent.command : gate.latestCommand;
          const uncertain = Boolean(
            intent && !intent.pending && !intent.command,
          );
          const busy = Boolean(intent?.pending || waiting(command));
          return (
            <Card
              key={gate.id}
              title={gate.name}
              subtitle={
                gate.kind === "GARAGE" ? "Garagem" : "Entrada de pedestres"
              }
              action={
                <Badge tone={gate.available ? "success" : "neutral"}>
                  {gate.available ? "Disponível" : "Indisponível"}
                </Badge>
              }
            >
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm text-slate-600">
                  <LockKeyhole
                    size={24}
                    className="shrink-0 text-emerald-600"
                  />
                  <p>
                    {gate.unavailableReason ??
                      "Confira o local antes de confirmar uma abertura."}
                  </p>
                </div>
                {command && (
                  <div
                    role="status"
                    className="rounded-lg bg-slate-50 p-3 text-sm"
                  >
                    <p className="font-medium text-slate-700">
                      {labels[command.status]}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {commandMessage(command)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Solicitação de{" "}
                      {new Date(command.createdAt).toLocaleString("pt-BR")}
                    </p>
                    {command.failureReason && (
                      <p className="mt-1 text-xs text-rose-700">
                        {command.failureReason}
                      </p>
                    )}
                  </div>
                )}
                {intent?.error && <ErrorBanner message={intent.error} />}
                {uncertain && (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                    Não há uma resposta confirmada para esta tentativa. Se você
                    reenviar, usaremos a mesma identificação, sem criar outra
                    intenção. A consulta de uma solicitação anterior exige
                    permissão atual de histórico.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      setConfirmation({ gate, generation: guard.capture() })
                    }
                    disabled={!gate.available || resource.loading || busy}
                  >
                    <DoorOpen size={16} />
                    {busy
                      ? "Aguardando confirmação…"
                      : uncertain
                        ? "Reenviar mesma solicitação"
                        : gate.kind === "GARAGE"
                          ? "Abrir garagem"
                          : "Abrir entrada"}
                  </Button>
                  {gate.canManage && (
                    <Button
                      variant="secondary"
                      onClick={() => setEditing(gate.id)}
                      disabled={resource.loading}
                    >
                      <Settings2 size={16} />
                      Configurar
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {editing &&
        resource.data &&
        ((editing === "new" && creating) || selected?.canManage) && (
          <GateEditor
            key={`${buildingId}:${editing}`}
            buildingId={buildingId}
            gate={editing === "new" ? null : selected!}
            data={resource.data}
            refreshing={resource.loading}
            onRefresh={resource.reload}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              resource.reload();
            }}
          />
        )}
      {confirmation && (
        <OpenConfirmation
          gate={confirmation.gate}
          repeat={Boolean(
            intents[store.key(buildingId, confirmation.gate.id)] &&
              !intents[store.key(buildingId, confirmation.gate.id)]!.command,
          )}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => void confirmOpen()}
        />
      )}
    </div>
  );
}

function OpenConfirmation({
  gate,
  repeat,
  onCancel,
  onConfirm,
}: {
  gate: AccessGateView;
  repeat: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={`Solicitar abertura de ${gate.name}?`}
      className="w-full max-w-md rounded-xl border border-slate-200 p-6 shadow-xl backdrop:bg-slate-900/40"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 className="text-lg font-semibold">
        Solicitar abertura de {gate.name}?
      </h2>
      <p className="my-4 text-sm text-slate-600">
        {repeat
          ? "A resposta anterior é incerta. Confirmar reenvia a mesma solicitação; nenhuma nova identificação será criada."
          : "Confirme que deseja abrir este acesso agora. Vamos verificar novamente a disponibilidade antes de enviar o pedido."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={onConfirm}>
          {repeat ? "Confirmar reenvio" : "Confirmar abertura"}
        </Button>
      </div>
    </dialog>
  );
}

function GateEditor({
  buildingId,
  gate,
  data,
  refreshing,
  onRefresh,
  onCancel,
  onSaved,
}: {
  buildingId: string;
  gate: AccessGateView | null;
  data: AccessList;
  refreshing: boolean;
  onRefresh: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const flags = useFeatures();
  const { accessIntents: store } = useAuth();
  const guard = useMemo(createAccessInteractionGuard, [store]);
  const inFlight = useRef(false);
  const mutationStarted = useRef(false);
  const [name, setName] = useState(gate?.name ?? "");
  const [kind, setKind] = useState<"GARAGE" | "PEDESTRIAN">(
    gate?.kind ?? (flags.enabled("GARAGE_ACCESS") ? "GARAGE" : "PEDESTRIAN"),
  );
  const [gatewayId, setGatewayId] = useState(gate?.gatewayId ?? "");
  const [deviceId, setDeviceId] = useState(gate?.deviceId ?? "");
  const [enabled, setEnabled] = useState(gate?.enabled ?? false);
  const [allowResidents, setAllowResidents] = useState(
    gate?.allowResidents ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const invalidate = () => {
      guard.invalidate();
      if (inFlight.current) {
        setSaving(false);
        setError(mutationStarted.current
          ? "A resposta do salvamento ficou pendente ao sair da tela. Atualize os acessos para conferir o resultado."
          : "A configuração foi cancelada ao sair da tela. Confirme novamente para salvar.");
      }
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") invalidate();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", invalidate);
    return () => {
      guard.invalidate();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", invalidate);
    };
  }, [guard]);
  async function save() {
    if (inFlight.current || refreshing) return;
    inFlight.current = true;
    mutationStarted.current = false;
    setSaving(true);
    setError(null);
    const generation = guard.capture();
    const current = () =>
      store.isValid() &&
      guard.isCurrent(generation) &&
      document.visibilityState === "visible";
    try {
      const fresh = await api.get<AccessList>(pathFor(buildingId));
      if (!current()) return;
      const authorized = gate
        ? fresh.items.some(
            (item) =>
              item.buildingId === buildingId &&
              item.id === gate.id &&
              item.canManage,
          )
        : canCreate(fresh);
      if (!authorized)
        throw new Error(
          "Sua permissão para configurar este acesso mudou. Atualize a lista.",
        );
      const input = {
        name,
        kind,
        gatewayId,
        deviceId,
        enabled,
        allowResidents,
      };
      mutationStarted.current = true;
      if (gate) await api.patch(`/access/${gate.id}`, input);
      else await api.post("/access", { ...input, buildingId });
      if (current()) onSaved();
    } catch (cause) {
      if (current()) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível salvar o acesso",
        );
        if (cause instanceof ApiError && [403, 404].includes(cause.status))
          onRefresh();
      }
    } finally {
      inFlight.current = false;
      if (current()) setSaving(false);
    }
  }
  const gateways = [...data.gateways];
  if (gate && !gateways.some((item) => item.id === gate.gatewayId))
    gateways.push({ id: gate.gatewayId, name: "Gateway atualmente vinculado" });
  const controllers = data.devices
    .filter(
      (device) =>
        device.gatewayId === gatewayId && controllerTypes.includes(device.type),
    )
    .map((device) => ({ id: device.id, name: device.name }));
  if (
    gate &&
    gatewayId === gate.gatewayId &&
    !controllers.some((item) => item.id === gate.deviceId)
  )
    controllers.push({
      id: gate.deviceId,
      name: "Controlador atualmente vinculado",
    });
  return (
    <Card
      title={gate ? `Configurar ${gate.name}` : "Novo acesso"}
      subtitle="Mantenha o controlador vinculado ou selecione um destino disponível para sua sessão."
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome">
            <Input
              value={name}
              onChange={setName}
              required
              minLength={2}
              maxLength={120}
            />
          </Field>
          <Field label="Tipo de acesso">
            <Select
              value={kind}
              onChange={setKind}
              options={(
                [
                  { value: "GARAGE", label: "Garagem" },
                  { value: "PEDESTRIAN", label: "Entrada de pedestres" },
                ] as const
              ).filter((option) =>
                flags.enabled(ACCESS_FEATURES[option.value]!),
              )}
            />
          </Field>
          <Field label="Gateway">
            <Select
              value={gatewayId}
              onChange={(value) => {
                setGatewayId(value);
                setDeviceId("");
              }}
              options={[
                { value: "", label: "Selecione um gateway" },
                ...gateways.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
            />
          </Field>
          <Field
            label="Controlador de portão"
            hint={
              !controllers.length
                ? "Nenhum controlador disponível para seleção neste gateway."
                : undefined
            }
          >
            <Select
              value={deviceId}
              onChange={setDeviceId}
              options={[
                { value: "", label: "Selecione um controlador" },
                ...controllers.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Habilitar abertura remota
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowResidents}
            onChange={(event) => setAllowResidents(event.target.checked)}
          />
          Permitir abertura por pessoas com autorização de uso deste acesso
        </label>
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={
              saving ||
              refreshing ||
              name.trim().length < 2 ||
              !gatewayId ||
              !deviceId
            }
          >
            {saving ? "Salvando…" : "Salvar acesso"}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
