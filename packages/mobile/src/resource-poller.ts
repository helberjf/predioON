type ResourcePollerOptions<T> = {
  active: boolean;
  read(): Promise<T>;
  loading(): void;
  loaded(value: T): void;
  failed(error: unknown): void;
  inactive(): void;
};

/** Poll only in the foreground, with at most one request in flight. */
export function createResourcePoller<T>(options: ResourcePollerOptions<T>) {
  let live = true;
  let active = options.active;
  let pending = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load() {
    if (!live || !active || pending) return;
    pending = true;
    const startedGeneration = generation;
    const current = () => live && active && startedGeneration === generation;
    options.loading();
    try {
      const data = await options.read();
      if (current()) options.loaded(data);
    } catch (error) {
      if (current()) options.failed(error);
    } finally {
      pending = false;
      if (live && active) {
        // Returning to the foreground invalidates the outstanding response.
        // Wait for it to settle to preserve backpressure, then fetch fresh data.
        if (startedGeneration !== generation) void load();
        else timer = setTimeout(() => void load(), 15_000);
      }
    }
  }

  return {
    start() { void load(); },
    setActive(next: boolean) {
      if (!live) return;
      if (active !== next) generation++;
      active = next;
      clearTimeout(timer);
      if (!active) options.inactive();
      else void load();
    },
    dispose() {
      live = false;
      clearTimeout(timer);
    },
  };
}
