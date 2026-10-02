type MutationSink = {
  started(): void;
  succeeded(message: string): void;
  failed(message: string): void;
  settled(): void;
};

/** One active user action per screen. Lifecycle changes discard feedback, never replay work. */
export function createMutationRunner() {
  let active = true;
  let running = false;
  let generation = 0;
  return {
    running: () => running,
    generation: () => generation,
    setActive(next: boolean) {
      if (active !== next) generation++;
      active = next;
    },
    async run<T>(
      action: () => Promise<T>,
      message: string | ((result: T) => string),
      sink: MutationSink,
      expectedGeneration = generation,
    ) {
      if (!active || running || expectedGeneration !== generation) return;
      const started = generation;
      const current = () => active && generation === started;
      running = true;
      sink.started();
      try {
        const result = await action();
        if (current())
          sink.succeeded(
            typeof message === "function" ? message(result) : message,
          );
      } catch (cause) {
        if (current())
          sink.failed(
            cause instanceof Error
              ? cause.message
              : "Não foi possível concluir. Atualize antes de tentar novamente.",
          );
      } finally {
        running = false;
        if (active) sink.settled();
      }
    },
  };
}
