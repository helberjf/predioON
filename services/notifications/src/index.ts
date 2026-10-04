import { createNotificationSqlClient, verifyRestrictedDatabaseRole } from "@predioon/db/notifications";
import { notificationConfiguration } from "./configuration.js";
import { notificationAttemptFactory } from "./database.js";
import { heartbeatPath, removeHeartbeat, writeHeartbeat } from "./heartbeat.js";
import { notificationLoop, NotificationWakeup } from "./loop.js";
import { runNotificationAttempt, type AttemptResult } from "./protocol.js";

const shutdown = new AbortController();
let listener: ReturnType<typeof createNotificationSqlClient> | undefined;
let listenerEnding: Promise<void> | undefined;
const endListener = () => listener ? listenerEnding ??= listener.end({ timeout: 0 }) : Promise.resolve();
const stop = () => {
  shutdown.abort();
  // Startup verification/LISTEN can be waiting on a physical connection before
  // the attempt loop exists. Abort that client as well as any active attempt.
  void endListener().catch(() => {});
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
const path = heartbeatPath();
const wakeup = new NotificationWakeup();
// A separate client is essential: LISTEN must never use the physical backend
// reserved for a delivery or keep its feature barrier alive.
try {
  // The container filesystem and PID1 can survive/recur across a restart. No
  // earlier process heartbeat proves that this process completed a loop.
  await removeHeartbeat(path);
  shutdown.signal.throwIfAborted();
  const configuration = notificationConfiguration(process.env);
  listener = createNotificationSqlClient(() => wakeup.notify());
  await verifyRestrictedDatabaseRole(listener, "predioon_notifications");
  const subscribed = await listener.listen("notification_wakeup", () => wakeup.notify());
  const open = notificationAttemptFactory();
  let lastResult: AttemptResult | undefined;
  try {
    await notificationLoop(shutdown.signal, wakeup,
      () => runNotificationAttempt(open, shutdown.signal, configuration.destination),
      async result => {
        await writeHeartbeat(path, result);
        if (result !== lastResult && result !== "empty") console.log(`[notifications] ${result}`);
        lastResult = result;
      });
  } finally { if (!shutdown.signal.aborted) await subscribed.unlisten(); }
} catch {
  if (!shutdown.signal.aborted) {
    console.error("Serviço de notificações indisponível; confira configuração, credencial restrita e migration038");
    process.exitCode = 1;
  }
} finally {
  await endListener();
  await removeHeartbeat(path);
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
}
