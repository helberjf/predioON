import { useEffect, useState, type FormEvent } from "react";
import type { InvitationPreview } from "@predioon/contracts/auth";
import { openInvitation } from "../api.js";
import { formatDateTime } from "../format.js";
import { Button, ErrorBanner } from "./primitives.js";
import { Field, Input } from "./fields.js";
import { AuthLayout, AuthLink } from "./auth-layout.js";

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
    <AuthLayout title="Convite Prédio ON" subtitle={invitation ? invitation.buildingName : "Portal do morador"} label="Aceitar convite" onSubmit={submit}>
        {error && <ErrorBanner message={error} />}

        {accepted ? <>
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Convite aceito. Entre com o e-mail {invitation?.email} e a sua senha.</p>
          <a href={entryHref} className="block rounded-xl bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white">Ir para a entrada</a>
        </> : !invitation ? <>
          <Field label="Código do convite" hint="Recebido da administração do condomínio"><Input value={code} onChange={setCode} required maxLength={64} autoComplete="off" /></Field>
          <Button type="submit" full disabled={busy}>{busy ? "Verificando..." : "Continuar"}</Button>
          <AuthLink href={entryHref}>Já tenho conta</AuthLink>
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
    </AuthLayout>
  );
}
