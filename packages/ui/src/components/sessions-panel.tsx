import { useEffect, useRef, useState } from "react";
import type { SessionView } from "@predioon/contracts/auth";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { formatDateTime } from "../format.js";
import { useResource } from "../use-resource.js";
import { Badge, Button, Card, ErrorBanner, ResourceFeedback } from "./primitives.js";
import { PasswordChangePanel } from "./password-change-panel.js";

const active = (session: SessionView) => !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now();

/** The server always selects and revokes sessions belonging to the current user. */
export function SessionsPanel() {
  const { user } = useAuth();
  return user ? <div key={user.id} className="space-y-6"><PasswordChangePanel /><SessionsWorkspace /></div> : null;
}

function SessionsWorkspace() {
  const { signOutAfter } = useAuth();
  const sessions = useResource<{ items: SessionView[] }>("/auth/sessions");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sending = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    window.addEventListener("focus", sessions.reload);
    const timer = setInterval(sessions.reload, 30_000);
    return () => { live.current = false; window.removeEventListener("focus", sessions.reload); clearInterval(timer); };
  }, [sessions.reload]);
  useEffect(() => {
    if (confirmation && confirmation !== "all" && !sessions.loading && !sessions.data?.items.some(row => row.id === confirmation && active(row))) {
      setConfirmation(null);
    }
  }, [confirmation, sessions.data, sessions.loading]);

  async function revoke() {
    const id = confirmation;
    if (!id || sending.current || !sessions.data || sessions.error) return;
    const current = id === "all" ? null : sessions.data.items.find(row => row.id === id && active(row));
    if (id !== "all" && !current) { setConfirmation(null); return; }
    sending.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      const request = async () => {
        if (id === "all") await api.post("/auth/sessions/revoke-all", {});
        else await api.delete(`/auth/sessions/${encodeURIComponent(id)}`);
      };
      if (id === "all" || current?.current) await signOutAfter(request);
      else await request();
      if (!live.current) return;
      setConfirmation(null);
      if (id !== "all" && !current?.current) { setMessage("Sessão encerrada. Esse dispositivo precisará entrar novamente."); sessions.reload(); }
    } catch (cause) {
      if (live.current) { setError(cause instanceof Error ? cause.message : "Não foi possível encerrar a sessão."); sessions.reload(); }
    } finally {
      sending.current = false;
      if (live.current) setBusy(false);
    }
  }

  const rows = [...(sessions.data?.items ?? [])]
    .filter(row => includeClosed || active(row))
    .sort((a, b) => Number(b.current) - Number(a.current));
  return <Card title="Minhas sessões" subtitle="Consulte suas conexões e encerre o acesso de um dispositivo"
    action={<Button variant="secondary" disabled={busy} onClick={sessions.reload}>Atualizar sessões</Button>}>
    <p className="text-sm text-slate-600">A lista contém as 100 conexões mais recentes da sua conta, em todos os portais e aplicativos. Encerrar todas também inclui conexões antigas que não aparecem aqui.</p>
    <p className="mt-2 text-xs text-slate-500">O nome do navegador ou aplicativo é informado pelo próprio dispositivo. O endereço de rede pode ser compartilhado por vários aparelhos.</p>
    <label className="my-4 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={includeClosed} onChange={event => setIncludeClosed(event.target.checked)} />Mostrar sessões encerradas ou expiradas</label>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {message && <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {sessions.error && <ResourceFeedback resource={sessions} emptyText="" />}
    {rows.length ? <div className="space-y-3">{rows.map(row => <article key={row.id} aria-label={row.current ? "Sessão deste navegador" : `Sessão iniciada em ${formatDateTime(row.createdAt)}`} className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {row.current && <Badge tone="success">Este navegador</Badge>}
        <Badge>{row.revokedAt ? "Encerrada" : active(row) ? "Ativa" : "Expirada"}</Badge>
      </div>
      <p className="mt-3 break-words text-sm font-medium text-slate-800">{row.userAgent || "Dispositivo não identificado"}</p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        <div><dt className="text-slate-500">Iniciada em</dt><dd>{formatDateTime(row.createdAt)}</dd></div>
        <div><dt className="text-slate-500">Última utilização registrada</dt><dd>{formatDateTime(row.lastUsedAt)}</dd></div>
        <div><dt className="text-slate-500">Expira em</dt><dd>{formatDateTime(row.expiresAt)}</dd></div>
        <div><dt className="text-slate-500">Endereço de rede</dt><dd className="break-all">{row.ipAddress || "Não informado"}</dd></div>
        {row.revokedAt && <div><dt className="text-slate-500">Encerrada em</dt><dd>{formatDateTime(row.revokedAt)}</dd></div>}
      </dl>
      {active(row) && <div className="mt-4">
        {confirmation === row.id ? <div className="space-y-3 rounded-lg bg-amber-50 p-3">
          <p className="text-sm text-amber-900">{row.current ? "Você sairá deste navegador e das outras abas desta sessão." : "Esse dispositivo perderá o acesso e precisará entrar novamente."}</p>
          <div className="flex flex-wrap gap-2"><Button variant="danger" disabled={busy || Boolean(sessions.error)} onClick={() => void revoke()}>Confirmar encerramento</Button><Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Manter sessão</Button></div>
        </div> : <Button variant="secondary" disabled={busy || Boolean(sessions.error)} onClick={() => { setConfirmation(row.id); setError(null); }}>{row.current ? "Encerrar esta sessão" : "Encerrar sessão"}</Button>}
      </div>}
    </article>)}</div> : !sessions.error && <ResourceFeedback resource={sessions} emptyText="Nenhuma sessão nesta visão." />}
    {sessions.data && !sessions.error && <div className="mt-6 border-t border-slate-200 pt-4">
      {confirmation === "all" ? <div className="space-y-3 rounded-lg bg-amber-50 p-4">
        <p className="text-sm text-amber-900">Todos os portais e aplicativos precisarão entrar novamente, incluindo este navegador. As permissões da sua conta serão mantidas.</p>
        <div className="flex flex-wrap gap-2"><Button variant="danger" disabled={busy} onClick={() => void revoke()}>Confirmar e sair de todos os dispositivos</Button><Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Manter sessões</Button></div>
      </div> : <Button variant="danger" disabled={busy} onClick={() => { setConfirmation("all"); setError(null); }}>Encerrar todas as sessões</Button>}
    </div>}
  </Card>;
}
