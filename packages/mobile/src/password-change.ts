export type PasswordChangeFields = {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
};
export type PasswordChangeInput = Pick<
  PasswordChangeFields,
  "currentPassword" | "newPassword"
>;
export type PasswordChangeState = PasswordChangeFields & {
  pending: boolean;
  error: string | null;
};

// Hermes does not require TextEncoder or String.isWellFormed. New credentials
// reject isolated surrogates; old credentials retain their legacy UTF-8 bytes.
function passwordSize(value: string) {
  let characters = 0;
  let bytes = 0;
  let wellFormed = true;
  for (const character of value) {
    characters++;
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff)
      wellFormed = false;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return { characters, bytes, wellFormed };
}

function utf8Equivalent(value: string) {
  let result = "";
  for (const character of value) {
    const point = character.codePointAt(0)!;
    result += point >= 0xd800 && point <= 0xdfff ? "\ufffd" : character;
  }
  return result;
}

export function passwordChangeValidation(fields: PasswordChangeFields) {
  if (!fields.currentPassword)
    return "Informe sua senha atual.";
  const currentSize = passwordSize(fields.currentPassword);
  if (currentSize.bytes > 1024)
    return "A senha atual excede o limite de 1024 bytes.";
  const size = passwordSize(fields.newPassword);
  if (!size.wellFormed)
    return "A nova senha contém caracteres Unicode inválidos.";
  if (size.characters < 15)
    return "A nova senha precisa ter pelo menos 15 caracteres.";
  if (size.bytes > 1024)
    return "A nova senha excede o limite de 1024 bytes.";
  // Only comparison uses replacement bytes. Submit the original old string.
  if (utf8Equivalent(fields.currentPassword) === fields.newPassword)
    return "Escolha uma senha diferente da atual.";
  if (!passwordSize(fields.confirmation).wellFormed)
    return "A confirmação contém caracteres Unicode inválidos.";
  if (fields.confirmation !== fields.newPassword)
    return "A confirmação precisa ser igual à nova senha.";
  return null;
}

function failedPasswordChange(cause: unknown) {
  const status =
    typeof cause === "object" && cause !== null && "status" in cause
      ? cause.status
      : undefined;
  if (status === 400)
    return "Não foi possível trocar a senha. Confira a senha atual e use uma nova senha diferente.";
  if (status === 429)
    return "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
  if (status === 401 || status === 403)
    return "Sua sessão não está disponível. Entre novamente para trocar a senha.";
  return "Não foi possível confirmar a troca. Entre novamente antes de tentar outra vez; a senha pode ter sido alterada.";
}

function blank(pending = false): PasswordChangeState {
  return {
    currentPassword: "",
    newPassword: "",
    confirmation: "",
    pending,
    error: null,
  };
}

/** Single submission with lifecycle isolation. Transport work is never retried. */
export function createPasswordChangeController(
  changePassword: (input: PasswordChangeInput) => Promise<void>,
) {
  let state = blank();
  let active = true;
  let disposed = false;
  let running = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  function publish(next: PasswordChangeState) {
    state = next;
    for (const listener of listeners) listener();
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setField(field: keyof PasswordChangeFields, value: string) {
      if (!active || disposed || running) return;
      publish({ ...state, [field]: value, error: null });
    },
    setActive(next: boolean) {
      if (disposed || next === active) return;
      active = next;
      generation++;
      // Moving into background discards secrets even during an in-flight request.
      publish(blank(next && running));
    },
    dispose() {
      active = false;
      disposed = true;
      generation++;
      state = blank();
      listeners.clear();
    },
    async submit() {
      if (!active || disposed || running) return;
      const error = passwordChangeValidation(state);
      if (error) {
        publish({ ...state, error });
        return;
      }
      const started = generation;
      const input = {
        currentPassword: state.currentPassword,
        newPassword: state.newPassword,
      };
      const current = () => active && !disposed && started === generation;
      running = true;
      publish({ ...state, pending: true, error: null });
      try {
        await changePassword(input);
        if (current()) publish(blank());
      } catch (cause) {
        if (current())
          publish({ ...state, pending: false, error: failedPasswordChange(cause) });
      } finally {
        running = false;
        if (!disposed && active && state.pending)
          publish({ ...state, pending: false });
      }
    },
  };
}
