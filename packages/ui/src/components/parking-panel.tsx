import { useCallback, useEffect, useRef, useState } from "react";
import { Car, Bike } from "lucide-react";
import type { AuthorizationResponse } from "@predioon/contracts/tenancy";
import {
  parkingAvailability,
  type ParkingLotView,
  type ParkingVehicleType,
} from "@predioon/shared";
import { useFeatures } from "../features.js";
import { PARKING_FEATURES } from "../feature-state.js";
import { api, ApiError } from "../api.js";
import { useResource } from "../use-resource.js";
import { formatDateTime } from "../format.js";
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  LoadingState,
} from "./primitives.js";
import { Field, Input, Select } from "./fields.js";

type Sensor = { id: string; name: string; type: string; enabled: boolean };
const LABELS = { CAR: "Carros", MOTORCYCLE: "Motos" };
const SOURCE = {
  UNKNOWN: "Sem medição",
  MANUAL: "Atualização manual",
  SENSOR: "Sensor automático",
};

type Rights = {
  data: AuthorizationResponse | null;
  error: string | null;
  errorStatus?: number | null;
  loading: boolean;
  reload: () => void;
};
function authorizationError(rights: Pick<Rights, "error" | "errorStatus">) {
  return rights.error && ![403, 404].includes(rights.errorStatus ?? 0)
    ? rights.error
    : null;
}
function authorizationPath(
  buildingId: string,
  resourceType?: "parking" | "device",
  resourceId?: string,
) {
  const query = new URLSearchParams({ buildingId });
  if (resourceType && resourceId) {
    query.set("resourceType", resourceType);
    query.set("resourceId", resourceId);
  }
  return `/v1/authorization?${query}`;
}
function matchingCapabilities(
  buildingId: string,
  response: AuthorizationResponse | null,
  resourceType?: "parking" | "device",
  resourceId?: string,
) {
  return response?.buildingId === buildingId &&
    response.resourceType === resourceType &&
    response.resourceId === resourceId
    ? response.capabilities
    : [];
}
const manages = (capabilities: readonly string[]) =>
  capabilities.includes("parking:read") &&
  capabilities.includes("parking:manage");

function useParkingRights(
  buildingId: string,
  lot: ParkingLotView | undefined,
  whole: Rights,
) {
  // These are two fixed vehicle cards, so the point queries stay bounded. The
  // actual sensor comes from the authorized parking projection, not inventory.
  const wholeCapabilities = matchingCapabilities(buildingId, whole.data);
  const needsPoint = !!lot && !manages(wholeCapabilities);
  const exact = useResource<AuthorizationResponse>(
    needsPoint ? authorizationPath(buildingId, "parking", lot.id) : null,
  );
  const sensor = useResource<AuthorizationResponse>(
    needsPoint && lot.sensorId
      ? authorizationPath(buildingId, "device", lot.sensorId)
      : null,
  );
  const capabilities = [
    ...wholeCapabilities,
    ...matchingCapabilities(buildingId, exact.data, "parking", lot?.id),
    ...matchingCapabilities(
      buildingId,
      sensor.data,
      "device",
      lot?.sensorId ?? undefined,
    ),
  ];
  const reload = useCallback(() => {
    exact.reload();
    sensor.reload();
  }, [exact.reload, sensor.reload]);
  return {
    read: capabilities.includes("parking:read"),
    manage: manages(capabilities),
    checking: whole.loading || exact.loading || sensor.loading,
    error: authorizationError(exact) ?? authorizationError(sensor),
    reload,
  };
}

async function currentManagement(buildingId: string, lot?: ParkingLotView) {
  const read = async (type?: "parking" | "device", id?: string) => {
    try {
      return matchingCapabilities(
        buildingId,
        await api.get<AuthorizationResponse>(
          authorizationPath(buildingId, type, id),
        ),
        type,
        id,
      );
    } catch (error) {
      if (error instanceof ApiError && [403, 404].includes(error.status))
        return [];
      throw error;
    }
  };
  const capabilities = lot
    ? (
        await Promise.all([
          read("parking", lot.id),
          lot.sensorId ? read("device", lot.sensorId) : Promise.resolve([]),
        ])
      ).flat()
    : await read();
  return manages(capabilities);
}

export function ParkingPanel({ buildingId }: { buildingId: string }) {
  const flags = useFeatures();
  if (!flags.enabled("CAR_PARKING") && !flags.enabled("MOTORCYCLE_PARKING"))
    return null;
  return <ParkingWorkspace key={buildingId} buildingId={buildingId} />;
}

function ParkingWorkspace({ buildingId }: { buildingId: string }) {
  const flags = useFeatures();
  const parking = useResource<{ items: ParkingLotView[] }>(
    `/parking?buildingId=${encodeURIComponent(buildingId)}`,
  );
  const whole = useResource<AuthorizationResponse>(
    authorizationPath(buildingId),
  );
  const capabilities = matchingCapabilities(buildingId, whole.data);
  const wholeManagement = manages(capabilities);
  const inventoryAllowed =
    wholeManagement && capabilities.includes("devices:read");
  const sensors = useResource<{ items: Sensor[] }>(
    inventoryAllowed
      ? `/devices?buildingId=${encodeURIComponent(buildingId)}`
      : null,
  );
  const car = parking.data?.items.find(
    (item) => item.buildingId === buildingId && item.vehicleType === "CAR",
  );
  const motorcycle = parking.data?.items.find(
    (item) =>
      item.buildingId === buildingId && item.vehicleType === "MOTORCYCLE",
  );
  const carRights = useParkingRights(buildingId, car, whole);
  const motorcycleRights = useParkingRights(buildingId, motorcycle, whole);
  const authorizationErrors = [
    ...new Set(
      [
        authorizationError(whole),
        carRights.error,
        motorcycleRights.error,
      ].filter((message): message is string => Boolean(message)),
    ),
  ];
  const [, setClockTick] = useState(0);
  const now = new Date();
  const refresh = useCallback(() => {
    setClockTick((value) => value + 1);
    parking.reload();
    whole.reload();
    sensors.reload();
    carRights.reload();
    motorcycleRights.reload();
  }, [
    parking.reload,
    whole.reload,
    sensors.reload,
    carRights.reload,
    motorcycleRights.reload,
  ]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 15_000);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [refresh]);
  return (
    <Card
      title="Vagas disponíveis"
      subtitle="Carros e motos, com a origem e o horário da última contagem"
      action={
        <Button variant="ghost" onClick={refresh}>
          Atualizar
        </Button>
      }
    >
      {parking.error && <ErrorBanner message={parking.error} />}
      {authorizationErrors.map((message) => (
        <ErrorBanner
          key={message}
          message={`Não foi possível verificar as permissões de vagas: ${message}. Use Atualizar para tentar novamente.`}
        />
      ))}
      {parking.loading && !parking.data ? (
        <LoadingState />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(["CAR", "MOTORCYCLE"] as const)
            .filter((kind) => flags.enabled(PARKING_FEATURES[kind]!))
            .map((vehicleType) => {
              const lot = vehicleType === "CAR" ? car : motorcycle;
              const rights =
                vehicleType === "CAR" ? carRights : motorcycleRights;
              return (
                <ParkingCard
                  key={`${buildingId}-${vehicleType}-${lot?.id ?? "new"}`}
                  buildingId={buildingId}
                  vehicleType={vehicleType}
                  lot={rights.read || rights.checking ? lot : undefined}
                  canManage={
                    (lot ? rights.manage : wholeManagement) &&
                    !!parking.data &&
                    !parking.error
                  }
                  checking={parking.loading || rights.checking}
                  canRetarget={wholeManagement}
                  wholeRead={capabilities.includes("parking:read")}
                  sensors={
                    sensors.data?.items.filter(
                      (item) =>
                        item.type === "PARKING_SENSOR" &&
                        item.enabled &&
                        !parking.data?.items.some(
                          (other) =>
                            other.id !== lot?.id && other.sensorId === item.id,
                        ),
                    ) ?? []
                  }
                  now={now}
                  failed={!!parking.error}
                  reload={refresh}
                />
              );
            })}
        </div>
      )}
      {inventoryAllowed && sensors.error && (
        <p className="mt-3 text-xs text-rose-700">
          Não foi possível carregar os sensores: {sensors.error}
        </p>
      )}
    </Card>
  );
}

function ParkingCard({
  buildingId,
  vehicleType,
  lot,
  sensors,
  canManage,
  checking,
  canRetarget,
  wholeRead,
  now,
  failed,
  reload,
}: {
  buildingId: string;
  vehicleType: ParkingVehicleType;
  lot?: ParkingLotView;
  sensors: Sensor[];
  canManage: boolean;
  checking: boolean;
  canRetarget: boolean;
  wholeRead: boolean;
  now: Date;
  failed: boolean;
  reload: () => void;
}) {
  const [editing, setEditing] = useState<"config" | "count" | null>(null);
  const [capacity, setCapacity] = useState("");
  const [occupied, setOccupied] = useState("");
  const [sensorId, setSensorId] = useState("");
  const [freshness, setFreshness] = useState("300");
  const [version, setVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (!canManage && !checking) {
      setEditing(null);
      setCapacity("");
      setOccupied("");
      setSensorId("");
      setSaved(false);
    }
  }, [canManage, checking]);
  const status =
    lot && !failed
      ? parkingAvailability(lot, now)
      : { available: null, status: "UNKNOWN" as const };
  const Icon = vehicleType === "CAR" ? Car : Bike;
  function edit(kind: "config" | "count") {
    setCapacity(lot ? String(lot.capacity) : "");
    setOccupied(lot?.occupied === null || !lot ? "" : String(lot.occupied));
    setSensorId(lot?.sensorId ?? "");
    setFreshness(String(lot?.staleAfterSeconds ?? 300));
    setVersion(lot?.version ?? null);
    setError(null);
    setSaved(false);
    setEditing(kind);
  }
  async function save() {
    if (pending.current || checking || !canManage) return;
    const current = generation.current;
    pending.current = true;
    setError(null);
    setBusy(true);
    try {
      if (!(await currentManagement(buildingId, lot))) {
        reload();
        throw new Error(
          "Sua permissão para alterar estas vagas não está mais disponível.",
        );
      }
      if (generation.current !== current) return;
      if (editing === "count" && lot) {
        if (!occupied.trim()) throw new Error("Informe a quantidade ocupada");
        await api.patch(`/parking/${lot.id}/occupancy`, {
          occupied: Number(occupied),
          version,
        });
      } else {
        if (!capacity.trim()) throw new Error("Informe a capacidade total");
        const body = {
          capacity: Number(capacity),
          sensorId: sensorId || null,
          staleAfterSeconds: Number(freshness),
        };
        if (lot) await api.patch(`/parking/${lot.id}`, { ...body, version });
        else await api.post("/parking", { ...body, buildingId, vehicleType });
      }
      if (generation.current === current) {
        setEditing(null);
        setSaved(true);
        reload();
      }
    } catch (cause) {
      if (generation.current !== current) return;
      setError(
        cause instanceof Error ? cause.message : "Falha ao atualizar vagas",
      );
      if (cause instanceof ApiError && [403, 404, 409].includes(cause.status)) {
        setEditing(null);
        reload();
      }
    } finally {
      if (generation.current === current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold text-slate-800">
          <Icon size={19} />
          {LABELS[vehicleType]}
        </h3>
        <Badge tone={status.status === "CURRENT" ? "success" : "warning"}>
          {status.status === "CURRENT"
            ? "Atualizado"
            : status.status === "STALE"
              ? "Desatualizado"
              : "Sem informação"}
        </Badge>
      </div>
      <p className="mt-3 text-3xl font-bold text-slate-900">
        {status.available ?? "—"}
        <span className="ml-2 text-sm font-normal text-slate-500">livres</span>
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {lot
          ? `Capacidade: ${lot.capacity} • ${status.status === "CURRENT" ? `${lot.occupied} ocupadas` : "ocupação atual indisponível"}`
          : failed
            ? "Não foi possível consultar as vagas"
            : wholeRead
              ? "Capacidade ainda não cadastrada"
              : "Informação indisponível para este acesso"}
      </p>
      {lot && (
        <div className="mt-3 text-xs leading-5 text-slate-500">
          <p>{SOURCE[lot.source]}</p>
          <p>
            {lot.observedAt
              ? `Última contagem: ${formatDateTime(String(lot.observedAt))}`
              : "Aguardando primeira contagem"}
          </p>
          {status.status === "STALE" && (
            <p>
              Último registro: {lot.occupied} ocupadas. Faça uma nova contagem.
            </p>
          )}
        </div>
      )}
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {saved && (
        <p role="status" className="mt-2 text-sm text-emerald-700">
          Vagas atualizadas.
        </p>
      )}
      {canManage && !editing && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={checking}
            variant="secondary"
            onClick={() => edit("config")}
          >
            {lot ? "Configurar" : "Cadastrar capacidade"}
          </Button>
          {lot && (
            <Button disabled={checking} onClick={() => edit("count")}>
              Informar ocupação
            </Button>
          )}
        </div>
      )}
      {canManage && editing && (
        <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
          {editing === "count" ? (
            <>
              <Field
                label="Vagas ocupadas"
                hint={`De 0 a ${lot?.capacity ?? 0}`}
              >
                <Input type="number" value={occupied} onChange={setOccupied} />
              </Field>
              {lot?.sensorId && (
                <p className="text-xs text-slate-500">
                  Uma leitura mais recente do sensor substituirá esta contagem
                  manual.
                </p>
              )}
            </>
          ) : (
            <>
              <Field label="Capacidade total">
                <Input type="number" value={capacity} onChange={setCapacity} />
              </Field>
              <Field
                label="Contagem automática"
                hint="Ao trocar o sensor, a contagem fica indisponível até uma nova leitura."
              >
                <Select
                  value={sensorId}
                  onChange={setSensorId}
                  options={[
                    ...(canRetarget || !lot?.sensorId
                      ? [
                          {
                            value: "",
                            label: "Sem sensor — informar manualmente",
                          },
                        ]
                      : []),
                    ...(canRetarget
                      ? sensors.map((sensor) => ({
                          value: sensor.id,
                          label: sensor.name,
                        }))
                      : []),
                    ...(sensorId &&
                    (!canRetarget ||
                      !sensors.some((sensor) => sensor.id === sensorId))
                      ? [{ value: sensorId, label: "Sensor vinculado" }]
                      : []),
                  ]}
                />
              </Field>
              <Field
                label="Validade da contagem (segundos)"
                hint="De 30 a 86400 segundos. Após esse período, a disponibilidade fica desatualizada."
              >
                <Input
                  type="number"
                  value={freshness}
                  onChange={setFreshness}
                />
              </Field>
            </>
          )}
          <div className="flex gap-2">
            <Button disabled={busy || checking} onClick={() => void save()}>
              {busy ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
