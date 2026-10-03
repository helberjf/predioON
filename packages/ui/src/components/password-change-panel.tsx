import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api.js";
import { passwordChangeError, passwordChangeValidation } from "../password-change-state.js";
import { Field, Input } from "./fields.js";
import { Button, Card, ErrorBanner } from "./primitives.js";

/** Owned by the identity-keyed sessions workspace in every portal. */
export function PasswordChangePanel() {
  const [editing, setEditing] = useState(false);
  return <Card title="Segurança da conta" subtitle="Atualize a senha usada nos portais e aplicativos">
    {editing ? <PasswordChangeForm onCancel={() => setEditing(false)} /> : <>
      <p className="mb-4 text-sm text-slate-600">Ao alterar sua senha, todos os dispositivos precisarão entrar novamente, incluindo este navegador.</p>
      <Button variant="secondary" onClick={() => setEditing(true)}>Alterar senha</Button>
    </>}
  </Card>;
}

function PasswordChangeForm({ onCancel }: { onCancel(): void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    const validation = passwordChangeValidation(currentPassword, newPassword, confirmation);
    if (validation) { setError(validation); return; }
    sending.current = true;
    setBusy(true);
    setError(null);
    const request = { currentPassword, newPassword };
    // The pending request owns its payload; the visible form no longer retains it.
    setCurrentPassword(""); setNewPassword(""); setConfirmation("");
    try {
      // The session client completes logout only after a confirmed response,
      // even when navigation has already unmounted this form.
      await api.changePassword(request);
    } catch (cause) {
      if (live.current) setError(passwordChangeError(cause));
    } finally {
      sending.current = false;
      if (live.current) setBusy(false);
    }
  }

  return <form aria-label="Alterar minha senha" aria-busy={busy} onSubmit={event => void submit(event)} noValidate className="space-y-4">
    <p className="text-sm text-slate-600">Confirme sua senha atual e escolha uma nova com pelo menos 15 caracteres. Espaços são preservados. Após a confirmação, todas as suas sessões serão encerradas e será necessário entrar com a nova senha.</p>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    <Field label="Senha atual"><Input type="password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" required disabled={busy} /></Field>
    <Field label="Nova senha" hint="Pelo menos 15 caracteres; no máximo 1024 bytes. Você pode colar uma senha do seu gerenciador."><Input type="password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" required disabled={busy} /></Field>
    <Field label="Confirmar nova senha"><Input type="password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" required disabled={busy} /></Field>
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={busy}>{busy ? "Alterando senha..." : "Confirmar troca e sair"}</Button>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancelar alteração</Button>
    </div>
  </form>;
}
