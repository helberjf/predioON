import { useState, type FormEvent } from "react";
import { MFA_REQUIRED_MESSAGE } from "@predioon/contracts/auth";
import { useAuth } from "../auth.js";
import { Button, ErrorBanner } from "./primitives.js";
import { Field, Input } from "./fields.js";
import { AuthLayout, AuthLink } from "./auth-layout.js";

/** Same sign-in screen for the three panels; only the subtitle changes. */
export function LoginScreen({ subtitle, invitationHref }: { subtitle: string; invitationHref?: string }) {
  const { signIn, error: sessionError, retryRestore } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Asked for only after the server says this account uses two-step verification.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password, needsCode ? code.trim() : undefined);
    } catch (cause) {
      if (cause instanceof Error && cause.message === MFA_REQUIRED_MESSAGE && !needsCode) { setNeedsCode(true); return; }
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Prédio ON" subtitle={subtitle} onSubmit={submit}>

        {error && <ErrorBanner message={error} />}
        {sessionError && <div className="space-y-2"><ErrorBanner message={sessionError} />
          <Button type="button" variant="secondary" onClick={() => void retryRestore()}>Tentar recuperar sessão</Button>
        </div>}

        <Field label="E-mail">
          <Input type="email" value={email} onChange={setEmail} placeholder="voce@condominio.com" required />
        </Field>
        <Field label="Senha">
          <Input type="password" value={password} onChange={setPassword} required />
        </Field>
        {needsCode && <Field label="Código de verificação" hint="Do aplicativo autenticador ou um código de recuperação">
          <Input value={code} onChange={setCode} required maxLength={16} autoComplete="one-time-code" autoFocus />
        </Field>}

        <Button type="submit" full disabled={busy}>
          {busy ? "Entrando..." : "Entrar"}
        </Button>
        <div className="space-y-1">
          <AuthLink href="/redefinir-senha">Esqueci minha senha</AuthLink>
          {invitationHref && <AuthLink href={invitationHref}>Tenho um convite</AuthLink>}
        </div>
    </AuthLayout>
  );
}
