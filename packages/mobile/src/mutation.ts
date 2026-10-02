import { useRef, useState } from "react";

/** No transport retries: a lost response may already have committed the action. */
export function useMutation() {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  async function run(action: () => Promise<void>, message: string) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir. Atualize antes de tentar novamente.",
      );
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  return { pending, error, success, run };
}
