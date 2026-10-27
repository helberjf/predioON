import assert from "node:assert/strict";
import { it } from "node:test";
import { webSessionNamespace } from "../src/web-session-coordinator.ts";

it("uses the portal origin for an API behind a same-origin rewrite", () => {
  assert.equal(webSessionNamespace("https://morador.example", "/api"),
    webSessionNamespace("https://morador.example", "https://morador.example/api"));
  assert.notEqual(webSessionNamespace("https://morador.example", "/api"),
    webSessionNamespace("https://sindico.example", "/api"));
});
