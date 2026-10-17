import assert from "node:assert/strict";
import { test } from "node:test";
import { MINIMUM_RETENTION_MONTHS, parseRetentionArguments } from "../src/telemetry-retention-policy.js";

test("without options the retention CLI only reports", () => {
  assert.deepEqual(parseRetentionArguments([]), { kind: "status" });
  assert.deepEqual(parseRetentionArguments(["--off"]), { kind: "off" });
});

test("removing old readings needs an explicit, long enough window and --confirm", () => {
  assert.deepEqual(parseRetentionArguments(["--months", "24", "--confirm"]), { kind: "set", months: 24 });
  assert.deepEqual(parseRetentionArguments(["--confirm", "--months", String(MINIMUM_RETENTION_MONTHS)]), { kind: "set", months: MINIMUM_RETENTION_MONTHS });
  assert.throws(() => parseRetentionArguments(["--months", "24"]), /irreversível/);
  assert.throws(() => parseRetentionArguments(["--months", "12", "--confirm"]), /mínimo é 13/);
  for (const value of ["", "1.5", "-24", "24m", "--confirm", "1000"]) {
    assert.throws(() => parseRetentionArguments(["--months", value, "--confirm"]), /número inteiro/, value);
  }
});

test("rejects mixed or unknown options instead of guessing", () => {
  assert.throws(() => parseRetentionArguments(["--off", "--months", "24", "--confirm"]), /não os dois/);
  assert.throws(() => parseRetentionArguments(["--confirm"]), /só acompanha/);
  assert.throws(() => parseRetentionArguments(["--days", "30"]), /desconhecida/);
});
