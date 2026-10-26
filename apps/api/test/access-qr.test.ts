import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { parseGateQr } from "@predioon/shared";
import { hashPassword } from "../src/auth/passwords.js";
import { gateQrContent, gateQrWindow, verifyGateQr } from "../src/modules/access/qr-code.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

// The QR key comes from the same test configuration as the server in this process.
const contentNow = (gate: string, generation = 1, offset = 0) => gateQrContent(gate, generation, gateQrWindow(Date.now()) + offset);

describe("abertura pelo QR do totem", () => {
  let server: TestServer, passwordHash: string;
  before(async () => {
    passwordHash = await hashPassword("predioon123");
    server = await startTestServer();
  });
  after(async () => {
    await server?.close();
    await closeAppDb();
    await sqlClient.end();
  });

  type Kind = "manager" | "resident" | "admin";
  type Fixture = {
    building: string; gate: string; ids: Record<Kind, string>;
    request(user: Kind, path: string, method?: string, body?: unknown): Promise<Response>;
    totem(path: string, token?: string, body?: unknown): Promise<Response>;
    release(enabled?: boolean): Promise<void>;
    clearCommands(): Promise<void>;
  };
  async function fixture(run: (value: Fixture) => Promise<void>) {
    const suffix = randomUUID(), org = `access-qr-org-${suffix}`, building = `access-qr-b-${suffix}`;
    // Version nibble 0, like ids created outside gen_random_uuid() (the Neon demo data):
    // PostgreSQL stores it, and the API must accept it as well.
    const gateway = `access-qr-gw-${suffix}`, device = `access-qr-device-${suffix}`, gate = randomUUID().replace(/^(.{14})./, "$10");
    const ids = { manager: `access-qr-manager-${suffix}`, resident: `access-qr-resident-${suffix}`, admin: `access-qr-admin-${suffix}` };
    const tokens = new Map<Kind, string>();
    try {
      await sqlClient.begin(async (tx) => {
        await tx`insert into organizations(id,name,slug) values(${org},'Access QR',${org})`;
        await tx`insert into buildings(id,organization_id,name,code) values(${building},${org},'Condomínio QR',${building})`;
        for (const [kind, id] of Object.entries(ids))
          await tx`insert into users(id,name,email,password_hash,is_platform_admin) values(${id},${kind},${id + "@access-qr.test"},${passwordHash},${kind === "admin"})`;
        await tx`insert into memberships(user_id,building_id,role) values(${ids.manager},${building},'BUILDING_ADMIN'),(${ids.resident},${building},'RESIDENT')`;
        await tx`insert into gateways(id,building_id,name,serial_number,status,last_seen_at) values(${gateway},${building},'Gate gateway',${gateway},'ONLINE',clock_timestamp())`;
        await tx`insert into devices(id,building_id,gateway_id,name,type,status,last_seen_at) values(${device},${building},${gateway},'Gate controller','GATE_CONTROLLER','ONLINE',clock_timestamp())`;
        await tx`insert into gates(id,building_id,name,kind,gateway_id,device_id,enabled,allow_residents) values(${gate},${building},'Garagem QR','GARAGE',${gateway},${device},true,true)`;
      });
      for (const [kind, id] of Object.entries(ids) as [Kind, string][])
        tokens.set(kind, (await login(server.url, id + "@access-qr.test")).accessToken);
      await run({
        building, gate, ids,
        request: (user, path, method = "GET", body) => call(server.url, path, { token: tokens.get(user), method, body }),
        totem: (path, token, body) => fetch(`${server.url}${path}`, {
          method: body ? "POST" : "GET",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Totem ${token}` } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        release: async (enabled = true) => {
          await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${building},'GATE_QR_ACCESS',${enabled})
            on conflict (building_id,feature_key) do update set enabled=excluded.enabled`;
        },
        clearCommands: async () => { await sqlClient`delete from gate_commands where building_id=${building}`; },
      });
    } finally {
      await sqlClient.begin(async (tx) => {
        await tx`delete from audit_logs where user_id in ${tx(Object.values(ids))}`;
        await tx`delete from gate_commands where building_id=${building}`;
        await tx`delete from buildings where organization_id=${org}`;
        await tx`delete from organizations where id=${org}`;
        await tx`delete from users where id in ${tx(Object.values(ids))}`;
      });
    }
  }
  const body = async (response: Response) => ({ status: response.status, json: await response.json().catch(() => null) as any });
  const listed = async (f: Fixture, user: Kind) =>
    (await (await f.request(user, `/access?buildingId=${f.building}`)).json()).items.find((item: any) => item.id === f.gate);

  it("nasce desligado no condomínio e só o administrador da plataforma libera", async () =>
    fixture(async (f) => {
      const before = await listed(f, "manager");
      assert.equal(before.requireQr, false);
      assert.equal(before.qr, undefined);
      assert.equal(before.qrGeneration, undefined, "a geração faz parte da chave e não sai do banco");
      assert.equal((await f.request("resident", "/access/qr/resolve", "POST", { content: contentNow(f.gate) })).status, 404);
      const pairing = await body(await f.request("manager", `/access/${f.gate}/totems/pairing`, "POST", {}));
      assert.equal(pairing.status, 403);
      assert.equal(pairing.json.details?.code, "FEATURE_DISABLED");
      assert.equal((await f.request("manager", `/access/${f.gate}`, "PATCH", { requireQr: true })).status, 403);
      const reason = "Adicional contratado pelo condomínio";
      assert.equal((await f.request("manager", `/features/buildings/${f.building}/GATE_QR_ACCESS`, "PUT", { enabled: true, version: 0, reason })).status, 403);
      const released = await body(await f.request("admin", `/features/buildings/${f.building}/GATE_QR_ACCESS`, "PUT", { enabled: true, version: 0, reason }));
      assert.equal(released.status, 200, JSON.stringify(released.json));
      assert.equal(released.json.items.find((item: any) => item.key === "GATE_QR_ACCESS").enabled, true);
      assert.deepEqual((await listed(f, "manager")).qr, { totems: [] });
      assert.equal((await listed(f, "resident")).qr, undefined, "a lista de tablets é só de quem gerencia");
    }));

  it("pareia o tablet uma vez, mostra o QR da hora e para ao despareá-lo", async () =>
    fixture(async (f) => {
      await f.release();
      await sqlClient`update sessions set verified_at=clock_timestamp()-interval '1 hour' where user_id=${f.ids.manager}`;
      const stale = await body(await f.request("manager", `/access/${f.gate}/totems/pairing`, "POST", {}));
      assert.equal(stale.status, 403);
      assert.equal(stale.json.details?.reason, "VERIFICATION_REQUIRED");
      await sqlClient`update sessions set verified_at=clock_timestamp() where user_id=${f.ids.manager}`;
      assert.equal((await f.request("resident", `/access/${f.gate}/totems/pairing`, "POST", {})).status, 403);
      const issued = await body(await f.request("manager", `/access/${f.gate}/totems/pairing`, "POST", {}));
      assert.equal(issued.status, 201, JSON.stringify(issued.json));
      assert.match(issued.json.pairingCode, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

      assert.equal((await f.totem("/totem/pair", undefined, { pairingCode: "AAAAA-AAAAA", label: "Tablet da garagem" })).status, 400);
      const paired = await body(await f.totem("/totem/pair", undefined, { pairingCode: issued.json.pairingCode.toLowerCase(), label: "Tablet da garagem" }));
      assert.equal(paired.status, 201, JSON.stringify(paired.json));
      assert.equal((await f.totem("/totem/pair", undefined, { pairingCode: issued.json.pairingCode, label: "Outro tablet" })).status, 400, "o código vale uma vez");

      const shown = await body(await f.totem("/totem/display", paired.json.token));
      assert.equal(shown.status, 200, JSON.stringify(shown.json));
      assert.equal(shown.json.gate.name, "Garagem QR");
      assert.equal(shown.json.building.name, "Condomínio QR");
      assert.ok(verifyGateQr(parseGateQr(shown.json.current.content)!, 1, Date.now()));
      assert.ok(new Date(shown.json.next.validFrom).getTime() > Date.now());
      assert.equal((await f.totem("/totem/display")).status, 401);
      assert.equal((await f.totem("/totem/display", "token-inexistente")).status, 401);

      const totems = (await listed(f, "manager")).qr.totems;
      assert.equal(totems.length, 1);
      assert.equal(totems[0].label, "Tablet da garagem");
      assert.ok(totems[0].lastSeenAt);

      await f.release(false);
      const off = await body(await f.totem("/totem/display", paired.json.token));
      assert.equal(off.status, 403);
      assert.equal(off.json.details?.code, "TOTEM_UNAVAILABLE");
      // Withdrawing the add-on keeps the tablet paired; revoking still works.
      assert.equal((await f.request("manager", `/access/${f.gate}/totems/${totems[0].id}`, "DELETE")).status, 204);
      assert.equal((await f.request("manager", `/access/${f.gate}/totems/${totems[0].id}`, "DELETE")).status, 404);
      await f.release();
      assert.equal((await f.totem("/totem/display", paired.json.token)).status, 401);

      const audit = await sqlClient`select action,metadata from audit_logs where resource_id=${f.gate} and action like 'ACCESS_TOTEM_%' order by created_at`;
      assert.deepEqual(audit.map((row) => row.action), ["ACCESS_TOTEM_PAIRING_CREATED", "ACCESS_TOTEM_PAIRED", "ACCESS_TOTEM_REVOKED"]);
      const stored = JSON.stringify(audit);
      assert.ok(!stored.includes(paired.json.token) && !stored.includes(issued.json.pairingCode), "nem token nem código vão para a auditoria");
    }));

  it("abre pelo QR e, com Exigir QR, só o morador perde o botão da lista", async () =>
    fixture(async (f) => {
      await f.release();
      const content = contentNow(f.gate);
      const resolved = await body(await f.request("resident", "/access/qr/resolve", "POST", { content }));
      assert.equal(resolved.status, 200, JSON.stringify(resolved.json));
      assert.equal(resolved.json.id, f.gate);
      assert.equal(resolved.json.available, true);
      assert.equal((await f.request("manager", `/access/${f.gate}`, "PATCH", { requireQr: true })).status, 200);
      assert.equal((await f.request("manager", "/access/nao-e-um-id", "PATCH", { name: "Outro" })).status, 404);
      assert.equal((await listed(f, "resident")).requireQr, true);

      const listOpen = await body(await f.request("resident", `/access/${f.gate}/open`, "POST", { requestId: randomUUID() }));
      assert.equal(listOpen.status, 403);
      assert.equal(listOpen.json.details?.code, "QR_REQUIRED");
      const requestId = randomUUID();
      const opened = await body(await f.request("resident", "/access/qr/open", "POST", { content, requestId }));
      assert.equal(opened.status, 202, JSON.stringify(opened.json));
      assert.equal(opened.json.status, "PENDING");
      const repeated = await body(await f.request("resident", "/access/qr/open", "POST", { content, requestId }));
      assert.equal(repeated.status, 200);
      assert.equal(repeated.json.id, opened.json.id);
      assert.equal((await f.request("resident", "/access/qr/open", "POST", { content, requestId: randomUUID() })).status, 429, "o intervalo do portão vale para os dois caminhos");
      const [audit] = await sqlClient`select metadata from audit_logs where action='ACCESS_OPEN_REQUESTED' and resource_id=${f.gate}`;
      assert.equal(audit!.metadata.via, "QR");

      await f.clearCommands();
      assert.equal((await f.request("manager", `/access/${f.gate}/open`, "POST", { requestId: randomUUID() })).status, 202, "quem gerencia continua abrindo pela lista");

      await f.clearCommands();
      await f.release(false);
      assert.equal((await listed(f, "resident")).requireQr, false, "sem o adicional, a exigência não vale");
      assert.equal((await f.request("resident", `/access/${f.gate}/open`, "POST", { requestId: randomUUID() })).status, 202);
      await f.clearCommands();
      const withdrawn = await body(await f.request("resident", "/access/qr/open", "POST", { content, requestId: randomUUID() }));
      assert.equal(withdrawn.status, 403);
      assert.equal(withdrawn.json.details?.code, "FEATURE_DISABLED");
    }));

  it("renovar invalida o QR, e QR alheio, antigo ou sem permissão recebe a mesma resposta", async () =>
    fixture(async (f) => {
      await f.release();
      const first = contentNow(f.gate);
      assert.equal((await f.request("resident", "/access/qr/resolve", "POST", { content: first })).status, 200);
      assert.equal((await f.request("resident", `/access/${f.gate}/qr/renew`, "POST", {})).status, 403);
      assert.equal((await f.request("manager", `/access/${f.gate}/qr/renew`, "POST", {})).status, 204);
      const old = await body(await f.request("resident", "/access/qr/resolve", "POST", { content: first }));
      assert.equal(old.status, 404);
      assert.equal(old.json.error, "QR expirado ou inválido. Leia o QR do totem novamente");
      assert.equal((await f.request("resident", "/access/qr/open", "POST", { content: first, requestId: randomUUID() })).status, 404);
      assert.equal((await f.request("resident", "/access/qr/resolve", "POST", { content: contentNow(f.gate, 2) })).status, 200);

      const current = contentNow(f.gate, 2), mac = parseGateQr(current)!.mac;
      const forged = current.replace(mac, mac.startsWith("A") ? "B" + mac.slice(1) : "A" + mac.slice(1));
      for (const content of [contentNow(f.gate, 2, -2), contentNow(f.gate, 2, 1), forged, contentNow(randomUUID(), 1), "https://morador.example.com/portao"])
        assert.equal((await f.request("resident", "/access/qr/resolve", "POST", { content })).status, 404, content);
      assert.equal((await f.request("resident", "/access/qr/open", "POST", { content: "texto", requestId: randomUUID() })).status, 400);

      await sqlClient`update gates set allow_residents=false where id=${f.gate}`;
      const hidden = await body(await f.request("resident", "/access/qr/resolve", "POST", { content: contentNow(f.gate, 2) }));
      assert.equal(hidden.status, 404, "não confirma que o portão existe");
      assert.equal((await f.request("resident", "/access/qr/open", "POST", { content: contentNow(f.gate, 2), requestId: randomUUID() })).status, 403);

      const rejected = await sqlClient`select resource_id,metadata from audit_logs where user_id=${f.ids.resident} and action='ACCESS_REQUEST_REJECTED'`;
      assert.ok(rejected.length >= 2);
      assert.ok(rejected.every((row) => row.metadata.via === "QR"));
      assert.ok(!JSON.stringify(rejected).includes(parseGateQr(first)!.mac), "o conteúdo do QR não vai para a auditoria");
    }));
});
