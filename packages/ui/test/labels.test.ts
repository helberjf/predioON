import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditActionLabel, describeUserAgent, resourceTypeLabel, SEVERITY_LABELS } from "../src/labels.ts";

describe("labels for stored codes", () => {
  it("names browsers and systems without confusing the ones that imitate each other", () => {
    const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";
    assert.equal(describeUserAgent(`${windows} Chrome/141.0.0.0 Safari/537.36`), "Chrome no Windows");
    assert.equal(describeUserAgent(`${windows} HeadlessChrome/153.0.8010.12 Safari/537.36`), "Chrome no Windows");
    assert.equal(describeUserAgent(`${windows} Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0`), "Edge no Windows");
    assert.equal(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0"), "Firefox no Windows");
    assert.equal(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"), "Safari no macOS");
    assert.equal(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari no iOS");
    assert.equal(describeUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36"), "Chrome no Android");
    assert.equal(describeUserAgent("okhttp/4.12.0"), "Aplicativo Prédio ON no Android");
  });

  it("returns what it does not recognise unchanged instead of inventing a name", () => {
    assert.equal(describeUserAgent("curl/8.9.1"), "curl/8.9.1");
    assert.equal(auditActionLabel("AUDIT_PAGE_bld_1_7"), "AUDIT PAGE bld 1 7");
    assert.equal(resourceTypeLabel("something_new"), "something_new");
  });

  it("translates the codes the screens used to show raw", () => {
    assert.equal(auditActionLabel("RESERVATION_CANCELLED"), "Reserva cancelada");
    assert.equal(resourceTypeLabel("reservation"), "Reserva");
    assert.deepEqual(Object.keys(SEVERITY_LABELS), ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });
});
