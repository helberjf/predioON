// Component/browser regression. All API responses are local fixtures; no external writes.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const app = resolve(root, "apps/building-web");
const output = resolve(root, ".local/alert-panel-qa");
const harness = resolve(app, ".local/alert-panel-qa.html");
await mkdir(output, { recursive: true });
await mkdir(resolve(app, ".local"), { recursive: true });
await writeFile(harness, `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Alertas — teste local</title><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Alerts} from '/src/pages/Alerts.tsx';
import '/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement('main',{className:'mx-auto max-w-6xl space-y-5 p-4 sm:p-6'},React.createElement(Alerts,{buildingId:'qa-building'})));
</script></html>`);
const { createServer } = await import(pathToFileURL(resolve(app, "node_modules/vite/dist/node/index.js")).href);
// Tailwind's existing config resolves content globs relative to the app directory.
process.chdir(app);
const server = await createServer({ root: app, configFile: resolve(app, "vite.config.ts"),
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
  server: { host: "127.0.0.1", port: 0, open: false } });
let browser;
const failures = [];
const writes = [];
const requests = [];
const timestamp = "2026-10-23T23:36:00-03:00";
const item = (id, type, status, severity, message) => ({ id, buildingId: "qa-building", type, status, severity, message,
  deviceId: `${id}_01`, gatewayId: `gateway_${"x".repeat(100)}`, triggeredAt: timestamp, createdAt: timestamp });
const fixtures = [
  item("pump", "PUMP_CONTINUOUS", "OPEN", "MEDIUM", "[DEMO] Tempo de funcionamento acima da referência do cenário; inspeção sugerida."),
  item("leak", "WATER_LEAK_DETECTED", "RESOLVED", "HIGH", "[DEMO] Teste ilustrativo de detecção de vazamento encerrado."),
  item("water", "LOW_WATER_LEVEL", "ACKNOWLEDGED", "MEDIUM", "[DEMO] Nível de água baixo no histórico; equipe acompanhando a recuperação."),
  item("energy", "LOW_VOLTAGE_L1", "RESOLVED", "HIGH", "[DEMO] Oscilação de tensão identificada e normalizada no histórico simulado."),
  item("temperature", "HIGH_TEMPERATURE", "RESOLVED", "MEDIUM", "[DEMO] Temperatura elevada no histórico; ventilação revisada."),
  item("custom", "CUSTOM_TECHNICAL_CODE", "FUTURE_STATUS", "CRITICAL", "Verificar instalação da área comum."),
];
let items = structuredClone(fixtures);
let allowed = ["alerts:read", "alerts:acknowledge", "alerts:resolve"];
let error = false;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  page.on("pageerror", cause => failures.push(cause.message));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin);
    requests.push(url.pathname);
    if (url.pathname === "/api/alerts") return route.fulfill({ status: error ? 500 : 200,
      json: error ? { error: "Não foi possível carregar os alertas." } : { items, total: items.length } });
    if (url.pathname === "/api/v1/authorization") return route.fulfill({ json: {
      buildingId: "qa-building", resourceType: url.searchParams.get("resourceType"), resourceId: url.searchParams.get("resourceId"),
      capabilities: url.searchParams.get("resourceType") === "alert" ? allowed : [] } });
    const action = /^\/api\/alerts\/([^/]+)\/(acknowledge|resolve)$/.exec(url.pathname);
    if (action) {
      writes.push({ id: action[1], action: action[2] });
      const record = items.find(entry => entry.id === action[1]);
      assert.ok(record);
      record.status = action[2] === "resolve" ? "RESOLVED" : "ACKNOWLEDGED";
      return route.fulfill({ json: record });
    }
    throw new Error(`Requisição inesperada: ${url.pathname}`);
  });
  await page.goto(`${origin}/.local/alert-panel-qa.html`);
  const group = name => page.getByRole("region", { name, exact: true });
  const row = title => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  const pumpTitle = "Bomba ligada por mais tempo que o esperado";
  await expect(group("Precisam de atenção")).toBeVisible();
  await expect(group("Precisam de atenção").getByRole("listitem")).toHaveCount(2);
  await expect(group("Em acompanhamento").getByRole("listitem")).toHaveCount(1);
  await expect(group("Resolvidos").getByRole("listitem")).toHaveCount(3);
  await expect(group("Precisam de atenção").getByRole("listitem").first()).toContainText("Situação a confirmar");
  await expect(page.getByRole("listitem").filter({ has: page.getByText(fixtures[5].message, { exact: true }) })).toBeVisible();
  await expect(row(pumpTitle).getByText("Demonstração", { exact: true })).toBeVisible();
  await expect(row(pumpTitle).getByText("PUMP_CONTINUOUS", { exact: true })).not.toBeVisible();
  await expect(row(pumpTitle).getByText(fixtures[0].message, { exact: true })).not.toBeVisible();
  const summary = row(pumpTitle).locator("summary");
  await summary.focus(); await page.keyboard.press("Enter");
  await expect(row(pumpTitle).getByText("PUMP_CONTINUOUS", { exact: true })).toBeVisible();
  await expect(row(pumpTitle).getByText(fixtures[0].message, { exact: true })).toBeVisible();
  await expect(row(pumpTitle).getByText(fixtures[0].gatewayId, { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, "desktop-technical.png"), fullPage: true });
  await page.keyboard.press("Enter");
  await expect(row(pumpTitle).getByText("PUMP_CONTINUOUS", { exact: true })).not.toBeVisible();
  await page.screenshot({ path: resolve(output, "desktop.png"), fullPage: true });

  // Looking at technical data must not fetch the inventory or any new authorization.
  assert.deepEqual(requests.filter(path => path !== "/api/alerts"), []);
  await row(pumpTitle).getByRole("button", { name: "Ver detalhes", exact: true }).click();
  await expect(row(pumpTitle).getByRole("button", { name: "Iniciar acompanhamento", exact: true })).toBeVisible();
  allowed = ["alerts:read"];
  await page.getByRole("button", { name: "Atualizar alertas", exact: true }).click();
  await expect(row(pumpTitle).getByRole("button", { name: "Iniciar acompanhamento", exact: true })).toHaveCount(0);
  await expect(row(pumpTitle).getByRole("button", { name: "Marcar como resolvido", exact: true })).toHaveCount(0);
  await row(pumpTitle).locator("summary").click();
  await expect(row(pumpTitle).getByText(fixtures[0].message, { exact: true })).toBeVisible();
  allowed = ["alerts:read", "alerts:acknowledge", "alerts:resolve"];
  await page.getByRole("button", { name: "Atualizar alertas", exact: true }).click();
  await row(pumpTitle).getByRole("button", { name: "Iniciar acompanhamento", exact: true }).click();
  await expect(group("Em acompanhamento").getByRole("heading", { name: pumpTitle, exact: true })).toBeVisible();
  await row(pumpTitle).getByRole("button", { name: "Marcar como resolvido", exact: true }).click();
  await expect(group("Resolvidos").getByRole("heading", { name: pumpTitle, exact: true })).toBeVisible();
  assert.deepEqual(writes, [{ id: "pump", action: "acknowledge" }, { id: "pump", action: "resolve" }]);

  items = structuredClone(fixtures);
  await page.reload();
  await expect(row(pumpTitle)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(output, "mobile.png"), fullPage: true });
  await row(pumpTitle).locator("summary").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(output, "mobile-technical.png"), fullPage: true });
  items = [];
  await page.getByRole("button", { name: "Atualizar alertas", exact: true }).click();
  await expect(page.getByText("Nenhum alerta registrado para sua conta.", { exact: true })).toBeVisible();
  error = true;
  await page.getByRole("button", { name: "Atualizar alertas", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar os alertas.");
  await expect(page.getByText("Nenhum alerta registrado para sua conta.", { exact: true })).toHaveCount(0);
  assert.deepEqual(failures, []);
  assert.ok(!requests.some(path => /\/devices|\/gateways/.test(path)));
  const report = { checkedAt: new Date().toISOString(), fixtures: fixtures.length, grouping: true, technicalDisclosure: true,
    keyboard: true, originalData: true, authorizationRevocation: true, statusActions: true, mobileOverflow: false,
    emptyAndErrorStates: true, externalWrites: 0, browserErrors: failures.length };
  await writeFile(resolve(output, "verification.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.close();
}
