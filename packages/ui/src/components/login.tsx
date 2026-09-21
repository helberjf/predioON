import { useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { useAuth } from "../auth.js";
import { Button, ErrorBanner } from "./primitives.js";
import { Field, Input } from "./fields.js";

/** Same sign-in screen for the three panels; only the subtitle changes. */
export function LoginScreen({ subtitle }: { subtitle: string }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#111c2e] p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <Building2 size={24} />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Prédio ON</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>

        {error && <ErrorBanner message={error} />}

        <Field label="E-mail">
          <Input type="email" value={email} onChange={setEmail} placeholder="voce@condominio.com" required />
        </Field>
        <Field label="Senha">
          <Input type="password" value={password} onChange={setPassword} required />
        </Field>

        <Button type="submit" full disabled={busy}>
          {busy ? "Entrando..." : "Entrar"}
        </Button>
      </form>
    </main>
  );
}
