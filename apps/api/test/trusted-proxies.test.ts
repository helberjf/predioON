import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { parseTrustedProxyCidrs } from "../src/http/trusted-proxies.js";

test("trusted proxies default to no forwarding and accept only explicit IPs or CIDRs", () => {
  assert.deepEqual(parseTrustedProxyCidrs(undefined), []);
  assert.deepEqual(parseTrustedProxyCidrs("   "), []);
  assert.deepEqual(parseTrustedProxyCidrs("127.0.0.1/32, ::1/128, 172.29.0.2,2001:db8::/48"),
    ["127.0.0.1/32", "::1/128", "172.29.0.2", "2001:db8::/48"]);
  assert.deepEqual(parseTrustedProxyCidrs("127.0.0.1, 127.0.0.1"), ["127.0.0.1"]);
  const compatible = parseTrustedProxyCidrs("::192.0.2.1/128");
  assert.deepEqual(compatible, ["::c000:201/128"]);
  assert.doesNotThrow(() => express().set("trust proxy", compatible));
});

test("proxy configuration rejects universal trust, hop counts, aliases and invalid addresses", () => {
  for (const input of [
    "true", "false", "1", "*", "loopback", "uniquelocal", "linklocal", "localhost",
    "0.0.0.0/0", "::/0", "::/1", "192.0.2.1/00", "::ffff:0.0.0.0/96", "::ffff:192.0.2.1/64",
    "127.0.0.1/33", "::1/129", "127.0.0.1/-1", "127.0.0.1/1.5", "127.0.0.1/",
    "127.0.0.1,", ",127.0.0.1", "127.0.0.1,,::1", "http://127.0.0.1", "127.0.0.999",
    "127.0.0.01", "[::1]", "::1%local", "172.29.0.2/32/8",
  ]) assert.throws(() => parseTrustedProxyCidrs(input), /TRUST_PROXY_CIDRS/, input);
  assert.throws(() => parseTrustedProxyCidrs(Array.from({ length: 33 }, (_, i) => `192.0.2.${i}`).join(",")), /TRUST_PROXY_CIDRS/);
});

async function inspectForwarding(trusted: string | undefined, forwarded: string) {
  const app = express();
  const networks = parseTrustedProxyCidrs(trusted);
  app.set("trust proxy", networks.length ? networks : false);
  app.get("/peer", (req, res) => res.json({ ip: req.ip, ips: req.ips, peer: req.socket.remoteAddress }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/peer`, {
      headers: { "X-Forwarded-For": forwarded, "Forwarded": "for=198.51.100.99", "X-Real-IP": "198.51.100.98" },
    });
    assert.equal(response.status, 200);
    return await response.json() as { ip: string; ips: string[]; peer: string };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("an untrusted direct peer cannot replace its network identity with headers", async () => {
  for (const configured of [undefined, "192.0.2.0/24"]) {
    const result = await inspectForwarding(configured, "203.0.113.10, 198.51.100.20");
    assert.equal(result.ip, result.peer);
    assert.deepEqual(result.ips, []);
  }
});

test("a trusted proxy selects the nearest untrusted peer and ignores a forged prefix", async () => {
  const result = await inspectForwarding("127.0.0.1/32", "203.0.113.10, 198.51.100.20");
  assert.equal(result.ip, "198.51.100.20");
  assert.deepEqual(result.ips, ["198.51.100.20"]);
});

test("each hop must be explicitly trusted before using its predecessor", async () => {
  const result = await inspectForwarding("127.0.0.1/32,198.51.100.20/32", "203.0.113.10, 198.51.100.20");
  assert.equal(result.ip, "203.0.113.10");
  assert.deepEqual(result.ips, ["203.0.113.10", "198.51.100.20"]);
  const mapped = await inspectForwarding("::ffff:127.0.0.1/128", "203.0.113.10");
  assert.equal(mapped.ip, "203.0.113.10");
});
