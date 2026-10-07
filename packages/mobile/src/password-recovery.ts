export type PasswordRecoveryRequest = (email: string, signal?: AbortSignal) => Promise<void>;
export type PasswordRecoveryState = {
  email: string;
  pending: boolean;
  error: string | null;
  requested: boolean;
};

function blank(): PasswordRecoveryState {
  return { email: "", pending: false, error: null, requested: false };
}

function failure(cause: unknown) {
  const status = typeof cause === "object" && cause !== null && "status" in cause ? cause.status : undefined;
  if (status === 400) return "Informe um e-mail válido.";
  if (status === 429) return "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
  return "Não foi possível solicitar a recuperação. Tente novamente mais tarde.";
}

/** A public, single submission draft; cleanup cancels and can be reactivated. */
export function createPasswordRecoveryController(request: PasswordRecoveryRequest) {
  let state = blank();
  let active = true;
  let generation = 0;
  let running: AbortController | null = null;
  const listeners = new Set<() => void>();
  function publish(next: PasswordRecoveryState) {
    state = next;
    for (const listener of listeners) listener();
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setEmail(email: string) {
      if (!active || running || state.requested) return;
      publish({ ...state, email, error: null });
    },
    setActive(next: boolean) {
      if (next === active) return;
      active = next;
      generation++;
      const previous = running;
      running = null;
      previous?.abort();
      publish(blank());
    },
    async submit() {
      if (!active || running || state.requested) return;
      const email = state.email.trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        publish({ ...state, error: "Informe um e-mail válido." });
        return;
      }
      const started = generation;
      const controller = new AbortController();
      running = controller;
      const current = () => active && started === generation && running === controller;
      publish({ ...state, pending: true, error: null });
      try {
        await request(email, controller.signal);
        if (current()) {
          running = null;
          publish({ ...blank(), requested: true });
        }
      } catch (cause) {
        if (current()) {
          running = null;
          publish({ ...state, pending: false, error: failure(cause) });
        }
      }
    },
  };
}
