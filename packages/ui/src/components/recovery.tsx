import { useEffect, useState, type FormEvent } from "react";
import { recoverPassword } from "../api.js";
import { Button, ErrorBanner } from "./primitives.js";
import { Field, Input } from "./fields.js";
import { AuthLayout, AuthLink } from "./auth-layout.js";

/** The secret travels in the URL fragment, which browsers do not send to servers or proxies. */
function fragmentToken(): string {
  const token = window.location.hash.slice(1);
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

/**
 * Public password recovery. Without a link it asks for the e-mail and always
 * answers the same way; opened from the e-mailed link it asks for the new password.
 */
export function PasswordRecoveryScreen({ entryHref = "/" }: { entryHref?: string }) {
  const [token, setToken] = useState(fragmentToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"requested" | "changed" | null>(null);
  // A link opened while this screen is already showing changes only the fragment.
  useEffect(() => {
    const read = () => { const next = fragmentToken(); if (next) { setToken(next); setDone(null); setError(null); } };
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
    if (!token) { void run(async () => { await recoverPassword("forgot", { email: email.trim() }); setDone("requested"); }); return; }
    if (password !== confirmation) { setError("As senhas informadas são diferentes."); return; }
    void run(async () => { await recoverPassword("reset", { token, newPassword: password }); setDone("changed"); setPassword(""); setConfirmation(""); });
  }
  const entry = <AuthLink href={entryHref}>Voltar para a entrada</AuthLink>;

  return (
    <AuthLayout title="Prédio ON" subtitle={token ? "Criar nova senha" : "Recuperar senha"} label="Recuperar senha" onSubmit={submit}>
        {error && <ErrorBanner message={error} />}

        {done === "changed" ? <>
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Senha alterada. Todas as sessões abertas foram encerradas; entre com a nova senha.</p>
          <a href={entryHref} className="block rounded-xl bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white">Ir para a entrada</a>
        </> : done === "requested" ? <>
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Se este e-mail tiver uma conta, enviamos um link para criar uma nova senha. Ele vale por 60 minutos. Confira também a caixa de spam.</p>
          {entry}
        </> : token ? <>
          <Field label="Nova senha" hint="Pelo menos 15 caracteres"><Input type="password" value={password} onChange={setPassword} required minLength={15} autoComplete="new-password" /></Field>
          <Field label="Repita a nova senha"><Input type="password" value={confirmation} onChange={setConfirmation} required minLength={15} autoComplete="new-password" /></Field>
          <Button type="submit" full disabled={busy}>{busy ? "Salvando..." : "Salvar nova senha"}</Button>
          <button type="button" className="block w-full rounded-lg py-1 text-center text-sm font-medium text-emerald-700 hover:underline" onClick={() => { setToken(""); setError(null); }}>Pedir um novo link</button>
        </> : <>
          <Field label="E-mail da conta"><Input type="email" value={email} onChange={setEmail} placeholder="voce@condominio.com" required maxLength={254} /></Field>
          <Button type="submit" full disabled={busy}>{busy ? "Enviando..." : "Enviar link"}</Button>
          {entry}
        </>}
    </AuthLayout>
  );
}
