import { useEffect, useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { recoverPassword } from "../api.js";
import { Button, ErrorBanner } from "./primitives.js";
import { Field, Input } from "./fields.js";

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
  const entry = <a href={entryHref} className="block text-center text-sm text-slate-500 underline">Voltar para a entrada</a>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#111c2e] p-4">
      <form onSubmit={submit} aria-label="Recuperar senha" className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white"><Building2 size={24} /></div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Prédio ON</h1>
          <p className="mt-1 text-sm text-slate-500">{token ? "Criar nova senha" : "Recuperar senha"}</p>
        </div>
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
          <button type="button" className="block w-full text-center text-sm text-slate-500 underline" onClick={() => { setToken(""); setError(null); }}>Pedir um novo link</button>
        </> : <>
          <Field label="E-mail da conta"><Input type="email" value={email} onChange={setEmail} placeholder="voce@condominio.com" required maxLength={254} /></Field>
          <Button type="submit" full disabled={busy}>{busy ? "Enviando..." : "Enviar link"}</Button>
          {entry}
        </>}
      </form>
    </main>
  );
}
