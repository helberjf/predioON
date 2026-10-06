import { useEffect, useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import type { InvitationPreview } from "@predioon/contracts/auth";
import { openInvitation } from "../api.js";
import { formatDateTime } from "../format.js";
import { Button, ErrorBanner } from "./primitives.js";
import { Field, Input } from "./fields.js";

/** The secret travels in the URL fragment, which browsers do not send to servers or proxies. */
function fragmentCode(): string {
  const code = window.location.hash.slice(1);
  if (code) window.history.replaceState(null, "", window.location.pathname);
  return code;
}

/** Public acceptance of a resident invitation. Signing in afterwards uses the ordinary screen. */
export function InvitationScreen({ entryHref = "/" }: { entryHref?: string }) {
  const [code, setCode] = useState(fragmentCode);
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  // A link opened while this screen is already showing changes only the fragment.
  useEffect(() => {
    const read = () => { const next = fragmentCode(); if (next) { setCode(next); setInvitation(null); setAccepted(false); setError(null); } };
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir. Tente novamente."); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!invitation) { void run(async () => setInvitation(await openInvitation<InvitationPreview>("preview", { token: code.trim() }))); return; }
    if (!invitation.accountExists && password !== confirmation) { setError("As senhas informadas são diferentes."); return; }
    void run(async () => { await openInvitation("accept", { token: code.trim(), password }); setAccepted(true); setPassword(""); setConfirmation(""); });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#111c2e] p-4">
      <form onSubmit={submit} aria-label="Aceitar convite" className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white"><Building2 size={24} /></div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Convite Prédio ON</h1>
          <p className="mt-1 text-sm text-slate-500">{invitation ? invitation.buildingName : "Portal do morador"}</p>
        </div>
        {error && <ErrorBanner message={error} />}

        {accepted ? <>
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Convite aceito. Entre com o e-mail {invitation?.email} e a sua senha.</p>
          <a href={entryHref} className="block rounded-xl bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white">Ir para a entrada</a>
        </> : !invitation ? <>
          <Field label="Código do convite" hint="Recebido da administração do condomínio"><Input value={code} onChange={setCode} required maxLength={64} autoComplete="off" /></Field>
          <Button type="submit" full disabled={busy}>{busy ? "Verificando..." : "Continuar"}</Button>
          <a href={entryHref} className="block text-center text-sm text-slate-500 underline">Já tenho conta</a>
        </> : <>
          <p className="text-sm text-slate-700">Olá, <strong>{invitation.name}</strong>. Você foi convidado para o condomínio <strong>{invitation.buildingName}</strong> com o e-mail <strong>{invitation.email}</strong>.</p>
          <p className="text-xs text-slate-500">Convite válido até {formatDateTime(invitation.expiresAt)}.</p>
          {invitation.accountExists
            ? <Field label="Senha da sua conta" hint="Este e-mail já tem conta no Prédio ON; a senha não será alterada"><Input type="password" value={password} onChange={setPassword} required autoComplete="current-password" /></Field>
            : <>
              <Field label="Crie uma senha" hint="Pelo menos 15 caracteres"><Input type="password" value={password} onChange={setPassword} required minLength={15} autoComplete="new-password" /></Field>
              <Field label="Repita a senha"><Input type="password" value={confirmation} onChange={setConfirmation} required minLength={15} autoComplete="new-password" /></Field>
            </>}
          <Button type="submit" full disabled={busy}>{busy ? "Enviando..." : "Aceitar convite"}</Button>
        </>}
      </form>
    </main>
  );
}
