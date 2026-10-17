import type { InvitationPreview } from "@predioon/contracts/auth";

export type InvitationRequests = {
  preview(code: string, signal?: AbortSignal): Promise<InvitationPreview>;
  accept(code: string, password: string, signal?: AbortSignal): Promise<void>;
};
export type InvitationState = {
  code: string;
  preview: InvitationPreview | null;
  password: string;
  confirmation: string;
  pending: boolean;
  error: string | null;
  accepted: boolean;
};
/** Same rule as the portal and the API for a new account. */
export const NEW_PASSWORD_MINIMUM = 15;

function blank(): InvitationState {
  return { code: "", preview: null, password: "", confirmation: "", pending: false, error: null, accepted: false };
}
const message = (cause: unknown) => cause instanceof Error && cause.message ? cause.message : "Não foi possível concluir. Tente novamente.";

/**
 * Public acceptance of a resident invitation: code → preview → password.
 * Passwords never outlive the screen: leaving the app or finishing clears them.
 */
export function createInvitationController(requests: InvitationRequests) {
  let state = blank();
  let active = true;
  let generation = 0;
  let running: AbortController | null = null;
  const listeners = new Set<() => void>();
  function publish(next: InvitationState) {
    state = next;
    for (const listener of listeners) listener();
  }
  async function run(work: (signal: AbortSignal) => Promise<(current: InvitationState) => InvitationState>) {
    const started = generation;
    const controller = new AbortController();
    running = controller;
    const current = () => active && started === generation && running === controller;
    publish({ ...state, pending: true, error: null });
    try {
      const apply = await work(controller.signal);
      if (current()) { running = null; publish(apply(state)); }
    } catch (cause) {
      if (current()) { running = null; publish({ ...state, pending: false, error: message(cause) }); }
    }
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setCode(code: string) {
      if (!active || running || state.preview || state.accepted) return;
      publish({ ...state, code, error: null });
    },
    setPassword(password: string) {
      if (!active || running || !state.preview || state.accepted) return;
      publish({ ...state, password, error: null });
    },
    setConfirmation(confirmation: string) {
      if (!active || running || !state.preview || state.accepted) return;
      publish({ ...state, confirmation, error: null });
    },
    /** Back to the code step, e.g. after typing the wrong code. */
    restart() {
      if (running) return;
      publish(blank());
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
      if (!active || running || state.accepted) return;
      const code = state.code.trim();
      if (!state.preview) {
        if (!code || code.length > 64) { publish({ ...state, error: "Informe o código do convite." }); return; }
        await run(async signal => {
          const preview = await requests.preview(code, signal);
          return current => ({ ...current, preview, pending: false });
        });
        return;
      }
      const { preview, password, confirmation } = state;
      if (!preview.accountExists) {
        if (password.length < NEW_PASSWORD_MINIMUM) { publish({ ...state, error: `A senha precisa ter pelo menos ${NEW_PASSWORD_MINIMUM} caracteres.` }); return; }
        if (password !== confirmation) { publish({ ...state, error: "As senhas informadas são diferentes." }); return; }
      } else if (!password) { publish({ ...state, error: "Informe a senha da sua conta." }); return; }
      await run(async signal => {
        await requests.accept(code, password, signal);
        return current => ({ ...current, password: "", confirmation: "", pending: false, accepted: true });
      });
    },
  };
}
