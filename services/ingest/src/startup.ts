import type { MqttClient } from "mqtt";

export type StartupDependencies = {
  verifyIngest(): Promise<void>;
  verifyAccess(): Promise<void>;
  connect(): MqttClient;
  startOffline(): NodeJS.Timeout;
  startAccess(client: MqttClient): () => void | Promise<void>;
  closeDatabases(): Promise<void>;
};

/** Validate both physical connections before creating transports or timers. */
export async function startIngestRuntime(dependencies: StartupDependencies): Promise<() => Promise<void>> {
  let client: MqttClient | undefined;
  let offline: NodeJS.Timeout | undefined;
  let stopAccess: (() => void | Promise<void>) | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      let failed = false;
      if (offline) clearInterval(offline);
      let accessStopped: void | Promise<void> = undefined;
      try { accessStopped = stopAccess?.(); } catch { failed = true; }
      try {
        if (client) await new Promise<void>((resolve, reject) => {
          client!.end(false, error => { if (error) reject(error); else resolve(); });
        });
      } catch { failed = true; }
      // An in-flight dispatch may still record a publish failure: keep the pools until it ends.
      try { await accessStopped; } catch { failed = true; }
      try { await dependencies.closeDatabases(); } catch { failed = true; }
      if (failed) throw new Error("Não foi possível encerrar o runtime de ingestão");
    })();
    return shutdownPromise;
  };

  try {
    // allSettled prevents closing a pool while its sibling verifier is still querying.
    // Scheduling each call also includes synchronous dependency failures in that barrier.
    const identities = await Promise.allSettled([
      Promise.resolve().then(() => dependencies.verifyIngest()),
      Promise.resolve().then(() => dependencies.verifyAccess()),
    ]);
    if (identities.some(result => result.status === "rejected")) throw new Error("Invalid database identity");
    client = dependencies.connect();
    offline = dependencies.startOffline();
    stopAccess = dependencies.startAccess(client);
    return shutdown;
  } catch {
    // Cleanup may fail too; the caller receives one fixed error with no driver cause.
    try { await shutdown(); } catch { /* The startup rejection covers cleanup failure. */ }
    throw new Error("Não foi possível iniciar o runtime de ingestão");
  }
}
