import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { createMutationRunner } from "./mutation-runner.ts";

/** No transport retries: a lost response may already have committed the action. */
export function useMutation() {
  const runner = useMemo(createMutationRunner, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [, setGeneration] = useState(0);
  const generation = runner.generation();
  useEffect(() => {
    const update = (state: string | null | undefined) => {
      const active = state === "active";
      runner.setActive(active);
      setGeneration(runner.generation());
      setPending(active && runner.running());
      if (!active) {
        setError(null);
        setSuccess(null);
      }
    };
    update(AppState.currentState);
    const listener = AppState.addEventListener("change", update);
    return () => {
      runner.setActive(false);
      listener.remove();
    };
  }, [runner]);
  async function run<T>(
    action: () => Promise<T>,
    message: string | ((result: T) => string),
  ) {
    if (AppState.currentState !== "active") return;
    await runner.run(
      action,
      message,
      {
        started: () => {
          setPending(true);
          setError(null);
          setSuccess(null);
        },
        succeeded: setSuccess,
        failed: setError,
        settled: () => setPending(false),
      },
      generation,
    );
  }
  return { pending, error, success, run };
}
