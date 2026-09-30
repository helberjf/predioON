import { useEffect, useRef, useState } from "react";
import { DoorOpen, LockKeyhole, Settings2 } from "lucide-react";
import type { AccessCommandView, AccessGateView, AccessList } from "@predioon/shared";
import { useFeatures } from "../features.js";
import { ACCESS_FEATURES } from "../feature-state.js";
import { api } from "../api.js";
import { isAccessRequestSettled, reconcileAccessCommand } from "../access-state.js";
import { useResource } from "../use-resource.js";
import { Badge, Button, Card, EmptyState, ErrorBanner, LoadingState, PageHeading } from "./primitives.js";
import { Field, Input, Select } from "./fields.js";

const labels: Record<AccessCommandView["status"], string> = {
  PENDING: "Aguardando envio", SENT: "Enviado · aguardando confirmação",
  ACKNOWLEDGED: "Abertura confirmada pelo controlador", FAILED: "Abertura não confirmada", EXPIRED: "Prazo encerrado · sem confirmação",
};
const waiting = (command: AccessCommandView | null | undefined) => command && ["PENDING", "SENT"].includes(command.status);

export function AccessPanel({ buildingId, canManage = false }: { buildingId: string; canManage?: boolean }) {
  const flags = useFeatures();
  const resource = useResource<AccessList>(buildingId ? `/access?buildingId=${encodeURIComponent(buildingId)}` : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [commands, setCommands] = useState<Record<string, AccessCommandView>>({});
  const [editing, setEditing] = useState<AccessGateView | "new" | null>(null);
  const requests = useRef<Record<string, string>>({});
  const currentBuilding = useRef(buildingId);
  currentBuilding.current = buildingId;
  useEffect(() => { setError(null); setBusy(null); setCommands({}); setEditing(null); requests.current = {}; }, [buildingId]);
  useEffect(() => {
    const timer = setInterval(resource.reload, 3000);
    return () => clearInterval(timer);
  }, [resource.reload]);
  useEffect(() => {
    if (!resource.data) return;
    for (const gate of resource.data.items) {
      if (isAccessRequestSettled(requests.current[gate.id], gate.latestCommand)) delete requests.current[gate.id];
    }
    setCommands(previous => {
      const next = { ...previous };
      for (const gate of resource.data!.items) {
        const command = reconcileAccessCommand(previous[gate.id], gate.latestCommand);
        if (command) next[gate.id] = command;
      }
      return next;
    });
  }, [resource.data]);
  useEffect(() => {
    const pending = Object.values(commands).filter(waiting);
    if (!pending.length) return;
    let active = true;
    const timer = setTimeout(() => {
      void Promise.all(pending.map(async command => {
        try {
          const next = await api.get<AccessCommandView>(`/access/commands/${command.id}`);
          if (active) {
            setCommands(previous => ({ ...previous, [next.gateId]: reconcileAccessCommand(previous[next.gateId], next)! }));
            if (isAccessRequestSettled(requests.current[next.gateId], next)) delete requests.current[next.gateId];
          }
        } catch (cause) {
          if (active) {
            setError(cause instanceof Error ? cause.message : "Falha ao consultar a confirmação");
            // A network error cannot tell us whether the controller already acknowledged.
            // Keep consulting the authoritative result, including after the local deadline.
            setCommands(previous => ({ ...previous }));
          }
        }
      }));
    }, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [commands]);

  async function open(gate: AccessGateView) {
    setError(null); setBusy(gate.id);
    const requestId = requests.current[gate.id] ?? crypto.randomUUID();
    requests.current[gate.id] = requestId;
    try {
      const command = await api.post<AccessCommandView>(`/access/${gate.id}/open`, { requestId });
      if (currentBuilding.current !== gate.buildingId) return;
      setCommands(previous => ({ ...previous, [gate.id]: reconcileAccessCommand(previous[gate.id], command)! }));
      if (isAccessRequestSettled(requests.current[gate.id], command)) delete requests.current[gate.id];
      resource.reload();
    } catch (cause) {
      if (currentBuilding.current === gate.buildingId) setError(cause instanceof Error ? cause.message : "Não foi possível solicitar a abertura");
    } finally { if (currentBuilding.current === gate.buildingId) setBusy(null); }
  }

  const manage = canManage && resource.data?.canManage;
  return <div className="space-y-5">
    <PageHeading title="Acessos" description="Solicite a abertura da garagem ou da entrada de pedestres e acompanhe a confirmação."
      action={manage ? <Button onClick={() => setEditing("new")}>Cadastrar acesso</Button> : undefined} />
    {(error || resource.error) && <ErrorBanner message={error ?? resource.error!} onDismiss={() => setError(null)} />}
    {resource.loading && !resource.data && <LoadingState />}
    {!buildingId && <EmptyState text="Selecione um prédio para consultar seus acessos." />}
    {resource.data?.items.length === 0 && <EmptyState text={manage ? "Nenhum acesso cadastrado. Associe um controlador e habilite o acesso quando estiver configurado." : "Nenhum acesso disponível neste prédio."} />}
    <div className="grid gap-4 lg:grid-cols-2">{resource.data?.items.filter(gate => flags.enabled(ACCESS_FEATURES[gate.kind]!)).map(gate => {
      const command = reconcileAccessCommand(commands[gate.id], gate.latestCommand);
      const isWaiting = waiting(command);
      return <Card key={gate.id} title={gate.name} subtitle={gate.kind === "GARAGE" ? "Garagem" : "Entrada de pedestres"}
        action={<Badge tone={gate.available ? "success" : "neutral"}>{gate.available ? "Disponível" : "Indisponível"}</Badge>}>
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm text-slate-600"><LockKeyhole size={24} className="shrink-0 text-emerald-600" />
            <p>{gate.unavailableReason ?? "A abertura será confirmada após a resposta do controlador."}</p>
          </div>
          {command && <div role="status" className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className={command.status === "ACKNOWLEDGED" ? "font-semibold text-emerald-700" : "font-medium text-slate-700"}>{labels[command.status]}</p>
            <p className="mt-1 text-xs text-slate-500">Solicitação de {new Date(command.createdAt).toLocaleString("pt-BR")}</p>
            {command.failureReason && <p className="mt-1 text-xs text-rose-700">{command.failureReason}</p>}
          </div>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void open(gate)} disabled={!gate.available || busy !== null || Boolean(isWaiting)}><DoorOpen size={16} />{busy === gate.id || isWaiting ? "Aguardando confirmação…" : gate.kind === "GARAGE" ? "Abrir garagem" : "Abrir entrada"}</Button>
            {manage && <Button variant="secondary" onClick={() => setEditing(gate)}><Settings2 size={16} />Configurar</Button>}
          </div>
        </div>
      </Card>;
    })}</div>
    {manage && editing && resource.data && <GateEditor key={editing === "new" ? `new-${buildingId}` : editing.id} buildingId={buildingId} gate={editing === "new" ? null : editing} data={resource.data} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); resource.reload(); }} />}
  </div>;
}

function GateEditor({ buildingId, gate, data, onCancel, onSaved }: { buildingId: string; gate: AccessGateView | null; data: AccessList; onCancel: () => void; onSaved: () => void }) {
  const flags = useFeatures();
  const [name, setName] = useState(gate?.name ?? "");
  const [kind, setKind] = useState<"GARAGE" | "PEDESTRIAN">(gate?.kind ?? (flags.enabled("GARAGE_ACCESS") ? "GARAGE" : "PEDESTRIAN"));
  const [gatewayId, setGatewayId] = useState(gate?.gatewayId ?? "");
  const [deviceId, setDeviceId] = useState(gate?.deviceId ?? "");
  const [enabled, setEnabled] = useState(gate?.enabled ?? false);
  const [allowResidents, setAllowResidents] = useState(gate?.allowResidents ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setSaving(true); setError(null);
    try {
      const input = { name, kind, gatewayId, deviceId, enabled, allowResidents };
      if (gate) await api.patch(`/access/${gate.id}`, input);
      else await api.post("/access", { ...input, buildingId });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o acesso"); }
    finally { setSaving(false); }
  }
  const controllers = data.devices.filter(device => device.gatewayId === gatewayId && ["GARAGE_GATE", "PEDESTRIAN_GATE", "GATE_CONTROLLER"].includes(device.type));
  return <Card title={gate ? `Configurar ${gate.name}` : "Novo acesso"} subtitle="Associe um controlador instalado neste prédio. Novos acessos começam desativados.">
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      {error && <ErrorBanner message={error} />}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome"><Input value={name} onChange={setName} required /></Field>
        <Field label="Tipo de acesso"><Select value={kind} onChange={setKind} options={([{ value: "GARAGE", label: "Garagem" }, { value: "PEDESTRIAN", label: "Entrada de pedestres" }] as const).filter(option => flags.enabled(ACCESS_FEATURES[option.value]!))} /></Field>
        <Field label="Gateway"><Select value={gatewayId} onChange={value => { setGatewayId(value); setDeviceId(""); }} options={[{ value: "", label: "Selecione um gateway" }, ...data.gateways.map(g => ({ value: g.id, label: g.name }))]} /></Field>
        <Field label="Controlador de portão" hint={!controllers.length ? "Cadastre um dispositivo do tipo Controlador de portão vinculado ao gateway selecionado." : undefined}><Select value={deviceId} onChange={setDeviceId} options={[{ value: "", label: "Selecione um controlador" }, ...controllers.map(d => ({ value: d.id, label: d.name }))]} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Habilitar abertura remota</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowResidents} onChange={event => setAllowResidents(event.target.checked)} />Permitir abertura por moradores com vínculo ativo</label>
      <div className="flex gap-2"><Button type="submit" disabled={saving || !name.trim() || !gatewayId || !deviceId}>{saving ? "Salvando…" : "Salvar acesso"}</Button><Button variant="secondary" onClick={onCancel} disabled={saving}>Cancelar</Button></div>
    </form>
  </Card>;
}
