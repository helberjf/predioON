import type { AccessCommandView } from "@predioon/shared";

export type AccessIntent = {
  requestId: string;
  buildingId: string;
  gateId: string;
  pending: boolean;
  command: AccessCommandView | null;
  error: string | null;
};
const stages = { PENDING: 0, SENT: 1, FAILED: 2, EXPIRED: 2, ACKNOWLEDGED: 3 };
export function commandSettled(command: AccessCommandView | null): boolean {
  return Boolean(command && !["PENDING", "SENT"].includes(command.status));
}
export function reconcileCommand(
  local: AccessCommandView | null,
  remote: AccessCommandView,
): AccessCommandView {
  if (!local) return remote;
  if (
    remote.id !== local.id ||
    remote.requestId !== local.requestId ||
    remote.gateId !== local.gateId
  )
    return local;
  return stages[remote.status] > stages[local.status] ? remote : local;
}
export function commandMessage(command: AccessCommandView): string {
  switch (command.status) {
    case "PENDING":
      return "Solicitação aceita pela API. Aguardando envio ao equipamento.";
    case "SENT":
      return "Comando enviado. Aguardando resposta do controlador.";
    case "ACKNOWLEDGED":
      return "Execução reconhecida pelo controlador. A posição física do portão não foi confirmada.";
    case "FAILED":
      return "A solicitação falhou. Não há confirmação de abertura.";
    case "EXPIRED":
      return "O prazo de confirmação expirou. Não há confirmação de abertura.";
  }
}

/** Memory only, owned by the authenticated session, not by a screen or tenant selection.
 * Reading/reconciling state can never send a command. submit is an explicit user gesture.
 */
export function createAccessIntentStore(newRequestId: () => string) {
  let current: Record<string, AccessIntent> = {};
  let valid = true;
  const listeners = new Set<() => void>();
  const key = (buildingId: string, gateId: string) =>
    JSON.stringify([buildingId, gateId]);
  function replace(id: string, intent: AccessIntent) {
    if (!valid) return;
    current = { ...current, [id]: intent };
    for (const listener of listeners) listener();
  }
  return {
    key,
    isValid: () => valid,
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invalidate() {
      valid = false;
      current = {};
      for (const listener of listeners) listener();
    },
    observe(buildingId: string, gateId: string, command: AccessCommandView) {
      const id = key(buildingId, gateId);
      const intent = current[id];
      if (
        !valid ||
        !intent ||
        intent.requestId !== command.requestId ||
        gateId !== command.gateId
      )
        return;
      const next = reconcileCommand(intent.command, command);
      if (next !== intent.command)
        replace(id, { ...intent, command: next, error: null });
    },
    async submit(
      buildingId: string,
      gateId: string,
      post: (requestId: string) => Promise<AccessCommandView>,
    ) {
      if (!valid) return;
      const id = key(buildingId, gateId);
      const previous = current[id];
      if (
        previous?.pending ||
        (previous?.command && !commandSettled(previous.command))
      )
        return;
      // An uncertain HTTP response keeps the original ID; only a settled intent permits a new one.
      const requestId =
        previous && !previous.command ? previous.requestId : newRequestId();
      const intent: AccessIntent = {
        requestId,
        buildingId,
        gateId,
        pending: true,
        command: null,
        error: null,
      };
      replace(id, intent);
      try {
        const command = await post(requestId);
        if (command.requestId !== requestId || command.gateId !== gateId)
          throw new Error("A resposta não corresponde à solicitação enviada.");
        if (!valid) return;
        replace(id, {
          ...intent,
          pending: false,
          command: reconcileCommand(current[id]?.command ?? null, command),
        });
      } catch (cause) {
        if (!valid) return;
        replace(id, {
          ...(current[id] ?? intent),
          pending: false,
          error:
            cause instanceof Error
              ? cause.message
              : "Não foi possível confirmar a resposta da API.",
        });
      }
    },
  };
}
export type AccessIntentStore = ReturnType<typeof createAccessIntentStore>;

/** A previous confirmation cannot become current again when the view returns. */
export function createAccessInteractionGuard() {
  let generation = 0;
  return {
    capture: () => generation,
    isCurrent: (expected: number) => expected === generation,
    invalidate: () => {
      generation++;
    },
  };
}
