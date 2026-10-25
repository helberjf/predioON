import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
const execute = promisify(execFile);
const generator = fileURLToPath(new URL("../infrastructure/generate-prod-env.mjs", import.meta.url));

test("generates distinct secrets and a matching Ed25519 pair; refuses to overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "predioon-env-test-"));
  try {
    const destination = join(directory, ".env.prod");
    const result = await execute(process.execPath, [generator, destination]);
    const source = await readFile(destination, "utf8");
    const values = Object.fromEntries(source.split("\n").filter(line => /^[A-Z][A-Z0-9_]*=/.test(line)).map(line => {
      const separator = line.indexOf("=");
      let value = line.slice(separator + 1).trim();
      if (value.startsWith("'")) value = value.slice(1, -1);
      return [line.slice(0, separator), value];
    }));
    const secrets = Object.entries(values).filter(([key]) => key.endsWith("_PASSWORD") && key !== "SEED_PASSWORD").map(([, value]) => value);
    assert.equal(new Set(secrets).size, secrets.length);
    assert.ok(secrets.every(value => /^[A-Za-z0-9_-]{64}$/.test(value)));
    assert.ok(secrets.every(value => !result.stdout.includes(value)));
    const privateKey = createPrivateKey(values.JWT_PRIVATE_KEY.replaceAll("\\n", "\n"));
    assert.equal(privateKey.asymmetricKeyType, "ed25519");
    assert.ok(createPublicKey(privateKey).equals(createPublicKey(JSON.parse(values.JWT_PUBLIC_KEYS)[values.JWT_ACTIVE_KID])));
    await assert.rejects(execute(process.execPath, [generator, destination]));
    assert.equal(await readFile(destination, "utf8"), source);
    if (process.platform !== "win32") assert.equal((await stat(destination)).mode & 0o777, 0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
