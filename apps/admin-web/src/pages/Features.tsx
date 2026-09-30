import { useEffect, useRef, useState } from "react";
import { FEATURE_CATALOG, type FeatureKey, type FeatureState } from "@predioon/shared";
import { api, ApiError, Badge, Button, Card, ErrorBanner, Field, PageHeading, ResourceFeedback, Select, TextArea, useResource, type Paged } from "@predioon/ui";

const SENSOR_FEATURES = new Set<FeatureKey>(["WATER_TANK", "WATER_CONSUMPTION", "ENERGY_CONSUMPTION", "ELECTRICAL", "PUMP", "WATER_LEAK", "SEWAGE_LEAK", "SMOKE", "TEMPERATURE", "GAS", "CAR_PARKING", "MOTORCYCLE_PARKING"]);
type Change = { state: FeatureState; enabled: boolean | null; reason: string };
const label = (key: string) => key === "GLOBAL" ? "configuração global" : key === "BUILDING" ? "configuração deste condomínio" : FEATURE_CATALOG.find(item => item.key === key)?.label ?? key;

export function Features() {
  const buildings = useResource<Paged<{ id: string; name: string }>>("/buildings");
  const [scope, setScope] = useState("");
  const name = buildings.data?.items.find(building => building.id === scope)?.name ?? "Todos os condomínios";
  return <>
    <PageHeading title="Funcionalidades" description="Defina o que está disponível na plataforma e as exceções de cada condomínio." />
    <Card><Field label="Onde aplicar"><Select value={scope} onChange={setScope} options={[{ value: "", label: "Global · todos os condomínios" }, ...(buildings.data?.items ?? []).map(building => ({ value: building.id, label: building.name }))]} /></Field>
      <p className="mt-3 text-sm text-slate-500">Uma desativação global bloqueia o módulo em todos os condomínios. No condomínio, “Herdar” acompanha o estado global. A configuração continua acessível para reativar os módulos.</p>
      {buildings.error && <ErrorBanner message={buildings.error} />}
    </Card>
    <FeatureSettings key={scope} buildingId={scope} scopeName={name} />
  </>;
}

function FeatureSettings({ buildingId, scopeName }: { buildingId: string; scopeName: string }) {
  const path = buildingId ? `/features/buildings/${encodeURIComponent(buildingId)}` : "/features/global";
  const resource = useResource<{ items: FeatureState[] }>(path);
  const [change, setChange] = useState<Change | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const pending = useRef(false);
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => { if (change) confirmation.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [change?.state.key, change?.enabled]);
  async function save() {
    if (!change || change.reason.trim().length < 3 || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api.put(`${path}/${change.state.key}`, { enabled: change.enabled, version: change.state.version, reason: change.reason.trim() });
      setChange(null); setNotice("Configuração salva. Os portais estão atualizando a disponibilidade."); resource.reload();
      window.dispatchEvent(new Event("predioon:features-changed"));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setChange(null); resource.reload();
        setError("Outra pessoa alterou esta configuração. Sua mudança não foi aplicada. Confira o estado atualizado e prepare uma nova alteração.");
      } else setError(cause instanceof Error ? cause.message : "Não foi possível salvar a configuração.");
    } finally { pending.current = false; setBusy(false); }
  }
  if (!resource.data) return <Card><ResourceFeedback resource={resource} emptyText="Nenhuma configuração disponível." /></Card>;
  const affected = change ? FEATURE_CATALOG.filter(item => item.dependencies.includes(change.state.key)).map(item => item.label) : [];
  return <>
    {error && <ErrorBanner message={error} />}{resource.error && <ErrorBanner message={resource.error} />}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
    {change && <div ref={confirmation} className="scroll-mt-24"><Card title={`Confirmar alteração · ${label(change.state.key)}`} subtitle={scopeName}>
      <div role="alert" className="mb-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p>Aplicar: <strong>{change.enabled === null ? "Herdar o estado global" : change.enabled ? "Ativar" : "Desativar"}</strong>. {buildingId ? "Esta alteração vale para o condomínio selecionado." : "Esta alteração afeta todos os condomínios."}</p>
        {change.enabled === false && <><p>Menus, cartões, ações e consultas deste módulo ficarão indisponíveis. O histórico existente será preservado.</p>
          <p>Análises e novos alertas correspondentes ficarão suspensos enquanto o recurso estiver desativado.</p>
          {SENSOR_FEATURES.has(change.state.key) && <p className="font-semibold">Novas leituras recebidas durante a desativação serão descartadas, sem armazenamento nem recomposição posterior. A retomada aguardará novas leituras válidas.</p>}
          {affected.length > 0 && <p>Também ficam indisponíveis as funcionalidades dependentes: {affected.join(", ")}.</p>}
          {change.state.key === "TICKET_PRIORITY" && <p>Novos chamados usarão gravidade Média e os controles de prioridade ficarão ocultos.</p>}
          {change.state.key === "TICKET_GROUPING" && <p>O agrupamento e as ações em grupo ficarão indisponíveis.</p>}
          {["GARAGE_ACCESS", "PEDESTRIAN_ACCESS"].includes(change.state.key) && <p>Pedidos ainda pendentes serão cancelados. Comandos já enviados podem concluir a abertura e continuarão recebendo confirmação.</p>}
          {change.state.key === "REMOTE_SUPPORT" && <p>Novas solicitações de acesso remoto serão bloqueadas. Sessões externas do AnyDesk já iniciadas não serão encerradas.</p>}
        </>}
        {change.enabled !== false && <p>A disponibilidade final respeita o bloqueio global e as dependências. O histórico preservado reaparece; leituras descartadas durante a pausa não são recuperadas.</p>}
        <p>Esta configuração não desliga fisicamente sensores, bombas, portões ou computadores.</p>
      </div>
      <Field label="Justificativa obrigatória" hint="Descreva o motivo da alteração para o histórico de auditoria."><TextArea value={change.reason} onChange={reason => setChange({ ...change, reason })} rows={3} /></Field>
      <div className="mt-4 flex gap-2"><Button variant={change.enabled === false ? "danger" : "primary"} disabled={busy || change.reason.trim().length < 3 || change.reason.length > 1000} onClick={() => void save()}>{busy ? "Salvando…" : "Confirmar alteração"}</Button><Button variant="secondary" disabled={busy} onClick={() => setChange(null)}>Cancelar</Button></div>
    </Card></div>}
    {[...new Set(FEATURE_CATALOG.map(item => item.group))].map(group => <Card key={group} title={group}>
      <ul className="divide-y divide-slate-100">{FEATURE_CATALOG.filter(item => item.group === group).map(item => {
        const state = resource.data!.items.find(value => value.key === item.key);
        if (!state) return <li key={item.key} className="py-3 text-sm text-slate-500">{item.label}: estado indisponível</li>;
        const configured = buildingId ? state.localEnabled : state.globalEnabled;
        return <li key={item.key} className="flex flex-wrap items-start justify-between gap-4 py-4">
          <div className="min-w-0 flex-1"><h2 className="font-semibold text-slate-900">{item.label}</h2><div className="mt-2 flex flex-wrap gap-2"><Badge tone={state.enabled ? "success" : "neutral"}>{state.enabled ? "Disponível" : "Desativada"}</Badge><Badge>Global: {state.globalEnabled ? "ativo" : "desativado"}</Badge>{buildingId && <Badge>{state.localEnabled === null ? "Herdando global" : state.localEnabled ? "Ativada no condomínio" : "Desativada no condomínio"}</Badge>}</div>
            {!state.enabled && <p className="mt-2 text-xs text-slate-500">{!state.globalEnabled ? "Bloqueada pela configuração global." : state.blockedBy ? `Bloqueio: ${label(state.blockedBy)}.` : "Desativada neste escopo."}</p>}
            {item.dependencies.length > 0 && <p className="mt-2 text-xs text-slate-500">Depende de: {item.dependencies.map(label).join(", ")}.</p>}
          </div>
          <div className="w-44"><Field label={`Configurar ${item.label}`}><Select value={configured === null ? "inherit" : configured ? "on" : "off"} onChange={value => { setNotice(""); setChange({ state, enabled: value === "inherit" ? null : value === "on", reason: "" }); }} options={[...(buildingId ? [{ value: "inherit", label: "Herdar global" }] : []), { value: "on", label: "Ativar" }, { value: "off", label: "Desativar" }]} /></Field></div>
        </li>;
      })}</ul>
    </Card>)}
  </>;
}
