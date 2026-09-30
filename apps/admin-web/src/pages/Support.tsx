import { useEffect, useRef, useState } from "react";
import { anydeskUri, SupportConfigSchema, SupportOutcomeSchema, SupportRequestSchema } from "@predioon/shared";
import type { SupportConfigInput, SupportConfigView, SupportLaunch, SupportList, SupportOutcome, SupportRequestView } from "@predioon/shared";
import {
  FeatureProvider, FeatureContent, api, Badge, Button, Card, EmptyState, ErrorBanner, Field, formatDateTime, Input, PageHeading,
  ResourceFeedback, Select, TextArea, supportLaunchIsCurrent, supportRequestForRetry, useAuth, useResource,
} from "@predioon/ui";
import type { Paged, SupportPendingRequest } from "@predioon/ui";

const EXTERNAL_LINK = "font-medium text-emerald-700 underline underline-offset-2";
const OUTCOMES: Array<{ value: SupportOutcome; label: string }> = [
  { value: "RESOLVED", label: "Resolvido" },
  { value: "UNRESOLVED", label: "Pendente de solução" },
  { value: "NOT_CONNECTED", label: "Não foi possível conectar" },
];
const STATUS: Record<SupportRequestView["status"], string> = {
  OPEN: "Solicitação registrada", RESOLVED: "Resolvido", UNRESOLVED: "Pendente de solução", NOT_CONNECTED: "Não foi possível conectar",
};

export function Support() {
  const buildings = useResource<Paged<{ id: string; name: string; active: boolean }>>("/buildings");
  const [selected, setSelected] = useState("");
  const available = (buildings.data?.items ?? []).filter(building => building.active);
  const buildingId = available.some(building => building.id === selected) ? selected : available[0]?.id ?? "";
  return <>
    <PageHeading title="Suporte remoto" description="Acesse o computador do condomínio pelo AnyDesk e registre o atendimento." />
    <Card>
      <Field label="Condomínio">
        <Select value={buildingId} onChange={setSelected} options={available.length ? available.map(building => ({ value: building.id, label: building.name })) : [{ value: "", label: "Nenhum condomínio disponível" }]} />
      </Field>
    </Card>
    {buildingId ? <FeatureProvider key={buildingId} buildingId={buildingId}><FeatureContent feature="REMOTE_SUPPORT"><SupportBuilding buildingId={buildingId} /></FeatureContent></FeatureProvider> : <ResourceFeedback resource={buildings} emptyText="Cadastre um condomínio ativo para configurar o suporte remoto." />}
  </>;
}

function SupportBuilding({ buildingId }: { buildingId: string }) {
  const resource = useResource<SupportList>(`/support?buildingId=${encodeURIComponent(buildingId)}`);
  if (resource.loading || resource.error || !resource.data) return <ResourceFeedback resource={resource} emptyText="Não foi possível carregar o suporte deste condomínio." />;
  return <SupportWorkspace buildingId={buildingId} initial={resource.data} />;
}

function SupportWorkspace({ buildingId, initial }: { buildingId: string; initial: SupportList }) {
  const { user } = useAuth();
  const [data, setData] = useState(initial);
  const [form, setForm] = useState<SupportConfigInput>({ displayName: initial.config?.displayName ?? "", anydeskId: initial.config?.anydeskId ?? "", enabled: initial.config?.enabled ?? false });
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<SupportPendingRequest | null>(null);
  const [launch, setLaunch] = useState<SupportLaunch | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const parsedConfig = SupportConfigSchema.safeParse(form);
  const dirty = !parsedConfig.success || !data.config || parsedConfig.data.displayName !== data.config.displayName
    || parsedConfig.data.anydeskId !== data.config.anydeskId || parsedConfig.data.enabled !== data.config.enabled;
  const canRequest = !!data.config?.enabled && !dirty && verified;
  const currentRequest = data.requests.find(request => request.id === launch?.request.id);
  let launchHref: string | null = null;
  if (!dirty && !busy && verified && supportLaunchIsCurrent(launch, data.config, buildingId, currentRequest)) {
    try {
      const expected = anydeskUri(launch!.request.anydeskId);
      if (launch!.launchUri === expected) launchHref = expected;
    } catch { /* An invalid external destination must never become a clickable link. */ }
  }

  function editConfig(next: SupportConfigInput) {
    setForm(next);
    setLaunch(null);
    setPending(null);
    setNotice(null);
  }

  function start(action: string): boolean {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(action);
    setError(null);
    setNotice(null);
    return true;
  }

  function finish() {
    submitting.current = false;
    if (mounted.current) setBusy(null);
  }

  async function refreshData() {
    if (!start("refresh")) return;
    setLaunch(null);
    try {
      const latest = await api.get<SupportList>(`/support?buildingId=${encodeURIComponent(buildingId)}`);
      if (!mounted.current) return;
      setData(latest);
      setVerified(true);
      if (!dirty) setForm({ displayName: latest.config?.displayName ?? "", anydeskId: latest.config?.anydeskId ?? "", enabled: latest.config?.enabled ?? false });
      const pendingRequest = latest.requests.find(request => request.requestId === pending?.requestId && request.requestedBy === user?.id);
      if (latest.config?.revision !== data.config?.revision || (pendingRequest && pendingRequest.status !== "OPEN")) setPending(null);
      setNotice(dirty ? "Dados atualizados. As alterações que você digitou no cadastro foram preservadas." : "Dados de suporte atualizados.");
    } catch (cause) {
      if (mounted.current) {
        setVerified(false);
        setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o suporte. Tente novamente.");
      }
    } finally { finish(); }
  }

  async function saveConfig() {
    const parsed = SupportConfigSchema.safeParse(form);
    if (!parsed.success) { setError("Informe um nome com 2 a 120 caracteres e um ID AnyDesk com 9 ou 10 números. Não informe a senha."); return; }
    if (!start("config")) return;
    setLaunch(null);
    setPending(null);
    try {
      const config = await api.put<SupportConfigView>(`/support/${encodeURIComponent(buildingId)}`, parsed.data);
      if (!mounted.current) return;
      setData(previous => ({ ...previous, config }));
      setForm({ displayName: config.displayName, anydeskId: config.anydeskId, enabled: config.enabled });
      setVerified(true);
      setNotice(verified ? "Configuração de suporte salva." : "Configuração de suporte salva. Você já pode preparar o acesso; atualize os dados para conferir o histórico mais recente.");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Não foi possível salvar o computador.");
    } finally { finish(); }
  }

  async function register(existing?: SupportRequestView) {
    if (!canRequest) return;
    let payload: SupportPendingRequest;
    try {
      payload = existing ? { requestId: existing.requestId, reason: existing.reason }
        : supportRequestForRetry(pending, reason, () => crypto.randomUUID());
    } catch {
      setError("Abra o painel por HTTPS ou no computador local para registrar o atendimento com segurança.");
      return;
    }
    if (!SupportRequestSchema.safeParse(payload).success) { setError("Descreva o motivo do atendimento com 3 a 1.000 caracteres."); return; }
    if (!start("request")) return;
    setLaunch(null);
    setReason(payload.reason);
    setPending(payload);
    try {
      const result = await api.post<SupportLaunch>(`/support/${encodeURIComponent(buildingId)}/requests`, payload);
      if (!mounted.current) return;
      if (!supportLaunchIsCurrent(result, data.config, buildingId, result.request) || result.launchUri !== anydeskUri(result.request.anydeskId)) {
        throw new Error("O destino mudou ou não pôde ser validado. Atualize os dados antes de tentar novamente.");
      }
      setData(previous => ({ ...previous, requests: [result.request, ...previous.requests.filter(request => request.id !== result.request.id)].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 50) }));
      setLaunch(result);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Não foi possível registrar o atendimento. Tente novamente.");
    } finally { finish(); }
  }

  async function close(request: SupportRequestView, outcome: SupportOutcome, notes: string) {
    const parsed = SupportOutcomeSchema.safeParse({ outcome, notes });
    if (!parsed.success) { setError("Descreva o resultado com 3 a 2.000 caracteres."); return; }
    if (!start(request.id)) return;
    setLaunch(null);
    try {
      const updated = await api.patch<SupportRequestView>(`/support/${encodeURIComponent(buildingId)}/requests/${encodeURIComponent(request.id)}`, parsed.data);
      if (!mounted.current) return;
      setData(previous => ({ ...previous, requests: previous.requests.map(item => item.id === updated.id ? updated : item) }));
      if (pending?.requestId === updated.requestId) { setPending(null); setReason(""); }
      setNotice("Resultado do atendimento registrado.");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Não foi possível registrar o resultado. Tente novamente.");
    } finally { finish(); }
  }

  async function copyId() {
    if (!data.config) return;
    try {
      await navigator.clipboard.writeText(data.config.anydeskId);
      if (mounted.current) setNotice("ID copiado. Cole no campo de endereço do AnyDesk.");
    } catch {
      if (mounted.current) setNotice(`A cópia automática não está disponível. Selecione e copie o ID exibido: ${data.config.anydeskId}.`);
    }
  }

  return <>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {notice && <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">{notice}</p>}
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Computador do condomínio" subtitle="Cadastre o ID do AnyDesk instalado no computador que acessa os equipamentos locais.">
        <form onSubmit={event => { event.preventDefault(); void saveConfig(); }}>
          <fieldset disabled={!!busy} className="space-y-4 disabled:opacity-70">
            <Field label="Nome do computador"><Input value={form.displayName} onChange={displayName => editConfig({ ...form, displayName })} placeholder="Computador da portaria" required /></Field>
            <Field label="ID AnyDesk" hint="9 ou 10 números. A senha permanece somente no AnyDesk."><Input value={form.anydeskId} onChange={anydeskId => editConfig({ ...form, anydeskId })} placeholder="123 456 789" required /></Field>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.enabled} onChange={event => editConfig({ ...form, enabled: event.target.checked })} className="h-4 w-4 accent-emerald-600" />Permitir solicitações de suporte neste condomínio</label>
            <p className="text-xs leading-5 text-slate-500">Desabilitar aqui impede novas solicitações pelo Prédio ON. Para revogar o acesso ao computador, ajuste também as permissões no AnyDesk.</p>
            <Button type="submit" disabled={!!busy || !dirty}>{busy === "config" ? "Salvando…" : "Salvar configuração"}</Button>
          </fieldset>
        </form>
      </Card>

      <Card title="Iniciar atendimento" subtitle="O registro acontece aqui; o acesso e a autenticação acontecem no AnyDesk.">
        {data.config ? <div className="mb-4 space-y-2 text-sm">
          <p className="font-medium text-slate-800">{data.config.displayName}</p>
          <p className="text-slate-600">ID: <span className="select-all font-mono text-base">{data.config.anydeskId}</span></p>
          <Badge tone={data.config.enabled ? "info" : "neutral"}>{data.config.enabled ? "Suporte habilitado" : "Suporte desabilitado"}</Badge>
          <p className="text-xs text-slate-500">A disponibilidade do computador será verificada pelo AnyDesk ao conectar.</p>
        </div> : <p className="mb-4 text-sm text-slate-500">Cadastre e habilite o computador para iniciar um atendimento.</p>}
        <form onSubmit={event => { event.preventDefault(); void register(); }}>
          <fieldset disabled={!!busy || !canRequest} className="space-y-4 disabled:opacity-70">
            <Field label="Motivo do atendimento" hint="Descreva o problema. Não inclua senhas."><TextArea value={reason} onChange={value => { setReason(value); setLaunch(null); }} rows={3} placeholder="Verificar a configuração do gateway da casa de máquinas" /></Field>
            <Button type="submit" disabled={!!busy || !canRequest || reason.trim().length < 3 || reason.trim().length > 1000}>{busy === "request" ? "Registrando…" : pending ? "Validar solicitação e preparar acesso" : "Registrar solicitação e preparar acesso"}</Button>
          </fieldset>
        </form>
        {dirty && data.config && <p className="mt-3 text-sm text-amber-700">Salve as alterações no computador antes de iniciar o atendimento.</p>}
        {launchHref && launch && <div className="mt-4 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p role="status" className="text-sm font-medium text-emerald-900">Solicitação registrada para {launch.request.displayName}.</p>
          <a href={launchHref} className="inline-flex rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">Abrir AnyDesk</a>
          <p className="text-xs leading-5 text-emerald-900">Confirme a abertura do aplicativo no navegador e autentique-se no AnyDesk. Abrir o aplicativo não confirma que a conexão foi realizada. Ao terminar, registre o resultado abaixo.</p>
        </div>}
      </Card>
    </div>

    <Card title="Preparação e ajuda">
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
        <li>Instale o AnyDesk no computador do condomínio e no computador do técnico.</li>
        <li>Configure o acesso autorizado no AnyDesk e mantenha o computador do condomínio ligado, conectado e sem suspensão.</li>
        <li>Registre o atendimento neste painel, abra o AnyDesk e informe o resultado ao concluir.</li>
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        {data.config && <Button variant="secondary" onClick={() => void copyId()} disabled={!!busy}>Copiar ID cadastrado</Button>}
        <a className={EXTERNAL_LINK} href="https://anydesk.com/pt/downloads" target="_blank" rel="noopener noreferrer">Baixar AnyDesk</a>
        <a className={EXTERNAL_LINK} href="https://support.anydesk.com/docs/unattended-access" target="_blank" rel="noopener noreferrer">Configurar acesso não supervisionado</a>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">Se o botão não abrir o aplicativo, abra o AnyDesk instalado e cole o ID cadastrado. Consulte o AnyDesk sobre a licença para uso profissional.</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">Use “Atualizar dados” para consultar alterações feitas por outros técnicos. Preparar o acesso verifica novamente a configuração no servidor. Um link já preparado não é revogado automaticamente por mudanças em outro computador; para retirar o acesso real, ajuste as permissões no AnyDesk.</p>
    </Card>

    <Card title="Histórico de atendimentos" subtitle="Últimas 50 solicitações. Os resultados são informados pela equipe; não confirmam automaticamente sessões do AnyDesk." action={<Button variant="secondary" onClick={() => void refreshData()} disabled={!!busy}>{busy === "refresh" ? "Atualizando…" : "Atualizar dados"}</Button>}>
      {data.requests.length ? <ul className="space-y-4">{data.requests.map(request => <SupportRequestCard key={request.id} request={request} busy={busy} canResume={canRequest && request.requestedBy === user?.id && request.configRevision === data.config?.revision && request.anydeskId === data.config?.anydeskId} onResume={() => void register(request)} onClose={(outcome, notes) => void close(request, outcome, notes)} />)}</ul> : <EmptyState text="Nenhuma solicitação de suporte registrada para este condomínio." />}
    </Card>
  </>;
}

function SupportRequestCard({ request, busy, canResume, onResume, onClose }: {
  request: SupportRequestView; busy: string | null; canResume: boolean; onResume: () => void; onClose: (outcome: SupportOutcome, notes: string) => void;
}) {
  const [outcome, setOutcome] = useState<SupportOutcome>("RESOLVED");
  const [notes, setNotes] = useState("");
  return <li className="space-y-3 rounded-xl border border-slate-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-medium text-slate-900">{request.displayName}</h3><p className="text-xs text-slate-500">{formatDateTime(request.createdAt)} · Solicitado por {request.requestedByName}</p></div>
      <Badge tone={request.status === "RESOLVED" ? "success" : request.status === "OPEN" ? "info" : "warning"}>{STATUS[request.status]}</Badge>
    </div>
    <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{request.reason}</p>
    <p className="text-xs text-slate-500">ID AnyDesk utilizado: <span className="font-mono">{request.anydeskId}</span></p>
    {request.status === "OPEN" ? <>
      {canResume ? <Button variant="secondary" onClick={onResume} disabled={!!busy}>Preparar acesso desta solicitação</Button> : <p className="text-xs text-amber-700">Para acessar o computador, salve e habilite a configuração atual e registre uma nova solicitação. Você ainda pode informar o resultado deste atendimento.</p>}
      <details className="rounded-lg bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Registrar resultado do atendimento</summary>
        <form className="mt-4" onSubmit={event => { event.preventDefault(); onClose(outcome, notes); }}>
          <fieldset disabled={!!busy} className="space-y-3">
            <Field label="Resultado"><Select value={outcome} onChange={setOutcome} options={OUTCOMES} /></Field>
            <Field label="Relato do atendimento" hint="Informe o que foi verificado e as próximas ações. Não inclua senhas."><TextArea value={notes} onChange={setNotes} rows={3} /></Field>
            <Button type="submit" disabled={!!busy || notes.trim().length < 3 || notes.trim().length > 2000}>{busy === request.id ? "Registrando…" : "Salvar resultado e encerrar solicitação"}</Button>
          </fieldset>
        </form>
      </details>
    </> : <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
      <p className="mb-1 text-xs text-slate-500">Resultado informado em {formatDateTime(request.closedAt)}</p>
      <p className="whitespace-pre-wrap break-words">{request.notes}</p>
    </div>}
  </li>;
}
