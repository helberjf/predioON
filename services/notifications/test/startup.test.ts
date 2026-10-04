import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { healthyHeartbeat } from "../src/heartbeat.js";

test("startup invalidates an inherited heartbeat and SIGTERM aborts a stalled database connection", {
  skip: process.platform === "win32" ? "Windows kill does not deliver a POSIX SIGTERM handler" : false,
  timeout: 15_000,
}, async () => {
  const sockets: Socket[] = [];
  let startup!: () => void;
  const observed = new Promise<void>(resolve => { startup = resolve; });
  const server = createServer(socket => {
    sockets.push(socket);
    // Consume a real PostgreSQL startup message and deliberately send no reply.
    socket.once("data", () => startup());
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "predioon-worker-startup-"));
  const heartbeat = join(directory, "health.json");
  const secret = "startup-private-synthetic-password";
  // Simulate PID reuse deterministically: create a valid heartbeat with this
  // child's PID before loading the actual entrypoint. No startup timing race.
  const inheritedStartup = `
    const { writeHeartbeat, healthyHeartbeat } = await import('./src/heartbeat.ts');
    await writeHeartbeat(process.env.NOTIFICATION_HEALTH_FILE, 'empty');
    if (!await healthyHeartbeat(process.env.NOTIFICATION_HEALTH_FILE)) throw new Error('Fixture heartbeat was not healthy');
    console.log('inherited-heartbeat-valid');
    await import('./src/index.ts');
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", inheritedStartup], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, NODE_ENV: "test", ALERT_WEBHOOK_URL: "",
      DATABASE_URL_NOTIFICATIONS: `postgres://predioon_notifications:${secret}@127.0.0.1:${address.port}/startup_test`,
      NOTIFICATION_HEALTH_FILE: heartbeat },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = ""; child.stdout!.on("data", chunk => { output += chunk.toString(); });
  child.stderr!.on("data", chunk => { output += chunk.toString(); });
  const exited = once(child, "exit");
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([observed, exited.then(() => { throw new Error("Worker exited before its startup message"); }),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("No database startup message")), 5_000); })]);
    clearTimeout(deadline);
    assert.equal(output.includes("inherited-heartbeat-valid"), true);
    assert.equal(await healthyHeartbeat(heartbeat), false, "A stalled new process must not inherit readiness from an older loop");
    child.kill("SIGTERM");
    const result = await Promise.race([exited,
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Worker did not abort pending startup promptly")), 2_000); })]);
    assert.equal(result[0], 0); assert.equal(result[1], null);
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes("Serviço de notificações indisponível"), false);
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("predioon-worker-startup-"));
    await rm(directory, { recursive: true, force: true });
  }
});
