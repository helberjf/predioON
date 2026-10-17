import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api } from "../api.js";
import { setVerificationPrompt } from "../verification-state.js";
import { Button, ErrorBanner } from "./primitives.js";
import { Field, Input } from "./fields.js";

/**
 * Asks for the password (and the authenticator code, when the account uses
 * one) before a privileged action. Mounted once per portal by DashboardFrame.
 */
export function VerificationDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((verified: boolean) => void) | null>(null);
  const titleId = useId();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVerificationPrompt(() => new Promise<boolean>(resolve => {
      resolver.current = resolve;
      setPassword(""); setCode(""); setError(null);
      ref.current?.showModal();
    }));
    return () => { setVerificationPrompt(null); finish(false); };
  }, []);

  function finish(verified: boolean) {
    const resolve = resolver.current;
    resolver.current = null;
    if (ref.current?.open) ref.current.close();
    setPassword(""); setCode("");
    resolve?.(verified);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.post("/auth/verify", { currentPassword: password, ...(code.trim() ? { code: code.trim() } : {}) });
      finish(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar.");
    } finally { setBusy(false); }
  }

  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); finish(false); }}
      className="w-[min(92vw,420px)] rounded-2xl border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40">
      <form onSubmit={submit} className="space-y-4 p-5">
        <div>
          <h2 id={titleId} className="text-base font-bold text-slate-900">Confirme que é você</h2>
          <p className="mt-1 text-sm text-slate-600">Esta ação é sensível. Digite sua senha para continuar; se sua conta usa verificação em duas etapas, informe também o código.</p>
        </div>
        {error && <ErrorBanner message={error} />}
        <Field label="Senha atual"><Input type="password" value={password} onChange={setPassword} required autoComplete="current-password" /></Field>
        <Field label="Código de verificação (se houver)"><Input value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => finish(false)}>Cancelar</Button>
          <Button type="submit" disabled={busy || !password}>Confirmar</Button>
        </div>
      </form>
    </dialog>
  );
}
