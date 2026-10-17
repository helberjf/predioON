import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { appSqlClient, closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

type Asset = { id: string; version: number; active: boolean; [key: string]: unknown };

describe("assets are managed with the equipment permissions and collect maintenance history", () => {
  const suffix = randomUUID(), org = `asset-org-${suffix}`, building = `asset-a-${suffix}`, other = `asset-b-${suffix}`;
  const people = Object.fromEntries(["manager", "technician", "resident", "stranger"].map(kind => [kind, `asset-${kind}-${suffix}`])) as
    Record<"manager" | "technician" | "resident" | "stranger", string>;
  const tokens = {} as Record<keyof typeof people, string>;
  const devices = { pump: `asset-dev-pump-${suffix}`, level: `asset-dev-level-${suffix}`, foreign: `asset-dev-foreign-${suffix}` };
  let server: TestServer, foreignAssetId: string;

  const api = (path: string, who: keyof typeof people, method = "GET", body?: unknown) => call(server.url, path, { method, body, token: tokens[who] });
  async function ok<T = Asset>(path: string, who: keyof typeof people, method = "GET", body?: unknown, status = 200): Promise<T> {
    const response = await api(path, who, method, body);
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data as T;
  }
  const create = (extra: object = {}) => ok("/v1/assets", "manager", "POST", { buildingId: building, name: "Bomba de recalque 1", ...extra }, 201);
  const audits = async (id: string) => (await sqlClient`select action,user_id,metadata from audit_logs where resource_id=${id} and resource_type='asset' order by created_at`)
    .map(row => `${row.action}:${row.user_id}:${JSON.stringify(row.metadata)}`);

  before(async () => {
    const password = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Asset fixture',${org})`;
    for (const id of [building, other]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${id},${org},${id},${id})`;
    for (const id of Object.values(people)) await sqlClient`insert into users(id,name,email,password_hash) values(${id},${id},${`${id}@test.local`},${password})`;
    await sqlClient`insert into memberships(user_id,building_id,role) values (${people.manager},${building},'BUILDING_ADMIN'),(${people.resident},${building},'RESIDENT'),(${people.stranger},${other},'BUILDING_ADMIN')`;
    await sqlClient`insert into role_bindings(building_id,user_id,role_key,granted_by,reason) values(${building},${people.technician},'MAINTENANCE',${people.manager},'Equipe contratada')`;
    await sqlClient`insert into devices(id,building_id,name,type) values(${devices.pump},${building},'Bomba 1','PUMP'),(${devices.level},${building},'Nível do reservatório','WATER_LEVEL'),(${devices.foreign},${other},'Foreign','PUMP')`;
    foreignAssetId = (await sqlClient`insert into assets(building_id,name,created_by) values(${other},'Foreign asset',${people.stranger}) returning id`)[0]!.id;
    server = await startTestServer();
    for (const [kind, id] of Object.entries(people)) tokens[kind as keyof typeof people] = (await login(server.url, `${id}@test.local`)).accessToken;
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from audit_logs where building_id in (${building},${other})`;
    await sqlClient`delete from buildings where id in (${building},${other})`;
    await sqlClient`delete from users where id in ${sqlClient(Object.values(people))}`;
    await sqlClient`delete from organizations where id=${org}`;
    await closeAppDb(); await sqlClient.end();
  });

  it("creates, edits and deactivates with audit and optimistic concurrency", async () => {
    const asset = await create({ category: "PUMP", location: "Casa de bombas", manufacturer: "Fabricante", model: "X-200", serialNumber: "SN-1", installedOn: "2024-03-15", notes: "Revisão anual" });
    assert.deepEqual({ name: asset.name, category: asset.category, installedOn: asset.installedOn, active: asset.active, version: asset.version },
      { name: "Bomba de recalque 1", category: "PUMP", installedOn: "2024-03-15", active: true, version: 1 });
    for (const key of ["createdAt", "updatedAt"]) assert.equal(new Date(String(asset[key])).toISOString(), asset[key], `${key} is strict ISO-8601`);
    const plain = await create({ name: "Portão da garagem" });
    assert.deepEqual({ category: plain.category, installedOn: plain.installedOn, location: plain.location }, { category: "OTHER", installedOn: null, location: "" });
    const edited = await ok(`/v1/assets/${asset.id}`, "manager", "PATCH", { version: 1, name: "Bomba de recalque principal", installedOn: null });
    assert.deepEqual({ name: edited.name, installedOn: edited.installedOn, version: edited.version, model: edited.model }, { name: "Bomba de recalque principal", installedOn: null, version: 2, model: "X-200" });
    assert.equal((await api(`/v1/assets/${asset.id}`, "manager", "PATCH", { version: 1, name: "Stale" })).status, 409);
    const off = await ok(`/v1/assets/${asset.id}`, "manager", "PATCH", { version: 2, active: false });
    assert.equal(off.active, false);
    const listed = await ok<{ items: Asset[]; canManage: boolean }>(`/v1/assets?buildingId=${building}`, "manager");
    assert.ok(listed.canManage && !listed.items.some(item => item.id === asset.id));
    const all = await ok<{ items: Asset[] }>(`/v1/assets?buildingId=${building}&includeInactive=true`, "manager");
    assert.ok(all.items.some(item => item.id === asset.id && item.active === false));
    assert.deepEqual(await audits(asset.id), [`ASSET_CREATED:${people.manager}:{}`, `ASSET_UPDATED:${people.manager}:{"fields":["installedOn","name"]}`, `ASSET_UPDATED:${people.manager}:{"fields":["active"]}`]);
  });

  it("lets equipment readers consult active assets only and refuses everyone else", async () => {
    const asset = await create();
    const hidden = await create({ name: "Gerador antigo" });
    await ok(`/v1/assets/${hidden.id}`, "manager", "PATCH", { version: 1, active: false });
    const seen = await ok<{ items: Asset[]; canManage: boolean }>(`/v1/assets?buildingId=${building}&limit=100`, "technician");
    assert.equal(seen.canManage, false);
    assert.ok(seen.items.some(item => item.id === asset.id) && !seen.items.some(item => item.id === hidden.id) && !seen.items.some(item => item.id === foreignAssetId));
    assert.equal((await api(`/v1/assets/${asset.id}`, "technician")).status, 200);
    assert.equal((await api(`/v1/assets/${hidden.id}`, "technician")).status, 404);
    assert.equal((await api(`/v1/assets?buildingId=${building}&includeInactive=true`, "technician")).status, 403);
    assert.equal((await api("/v1/assets", "technician", "POST", { buildingId: building, name: "Criado pelo técnico" })).status, 403);
    assert.equal((await api(`/v1/assets/${asset.id}`, "technician", "PATCH", { version: 1, name: "Alterado" })).status, 403);
    assert.equal((await api(`/v1/assets/${asset.id}/devices`, "technician", "PUT", { deviceIds: [] })).status, 403);
    for (const who of ["resident", "stranger"] as const) {
      assert.equal((await api(`/v1/assets?buildingId=${building}`, who)).status, 403, who);
      assert.equal((await api(`/v1/assets/${asset.id}`, who)).status, 404, who);
    }
    assert.equal((await api(`/v1/assets/${foreignAssetId}`, "manager")).status, 404);
    assert.equal((await api(`/v1/assets?buildingId=${other}`, "manager")).status, 403);
    assert.equal((await api("/v1/assets/not-a-uuid", "manager")).status, 404);
    for (const invalid of [{ name: " " }, { category: "ROCKET" }, { installedOn: "15/03/2024" }, { installedOn: "2024-13-40" }, { active: false }, { createdBy: people.technician }]) {
      assert.equal((await api("/v1/assets", "manager", "POST", { buildingId: building, name: "Válido", ...invalid })).status, 400, JSON.stringify(invalid));
    }
    for (const invalid of [{}, { version: 1 }, { version: 1, buildingId: other }, { version: 0, name: "x" }]) {
      assert.equal((await api(`/v1/assets/${asset.id}`, "manager", "PATCH", invalid)).status, 400, JSON.stringify(invalid));
    }
  });

  it("replaces monitored devices and refuses devices of another condominium", async () => {
    const asset = await create();
    const linked = await ok<{ devices: Array<{ id: string; name: string; type: string }> }>(`/v1/assets/${asset.id}/devices`, "manager", "PUT", { deviceIds: [devices.pump, devices.level] });
    assert.deepEqual(linked.devices.map(device => device.id).sort(), [devices.level, devices.pump].sort());
    assert.equal((await api(`/v1/assets/${asset.id}/devices`, "manager", "PUT", { deviceIds: [devices.pump, devices.foreign] })).status, 400);
    assert.equal((await api(`/v1/assets/${asset.id}/devices`, "manager", "PUT", { deviceIds: ["missing-device"] })).status, 400);
    assert.equal((await api(`/v1/assets/${asset.id}/devices`, "manager", "PUT", { deviceIds: [devices.pump, devices.pump] })).status, 400);
    const detail = await ok<Asset & { devices: Array<{ id: string }> }>(`/v1/assets/${asset.id}`, "technician");
    assert.deepEqual(detail.devices.map(device => device.id).sort(), [devices.level, devices.pump].sort(), "a refused replacement changes nothing");
    await ok(`/v1/assets/${asset.id}/devices`, "manager", "PUT", { deviceIds: [devices.level] });
    assert.deepEqual((await ok<Asset & { devices: Array<{ id: string }> }>(`/v1/assets/${asset.id}`, "manager")).devices.map(device => device.id), [devices.level]);
    assert.deepEqual((await audits(asset.id)).slice(1), Array(2).fill(`ASSET_UPDATED:${people.manager}:{"fields":["devices"]}`));
  });

  it("links work orders to an asset and shows each reader only the history they may see", async () => {
    const asset = await create();
    const order = (extra: object) => ok<{ id: string; version: number; assetId: string | null }>("/v1/work-orders", "manager", "POST", { buildingId: building, title: "Trocar selo mecânico", assetId: asset.id, ...extra }, 201);
    const mine = await order({ assignedUserId: people.technician });
    const unassigned = await order({ title: "Lubrificar mancais" });
    assert.equal(mine.assetId, asset.id);
    const named = async (who: keyof typeof people) => (await ok<{ assetId: string | null; assetName: string | null }>(`/v1/work-orders/${mine.id}`, who)).assetName;
    assert.equal(await named("manager"), "Bomba de recalque 1");
    assert.equal(await named("technician"), "Bomba de recalque 1");
    // Without the equipment permission the order stays visible but the asset is not named.
    const [originalPermission] = await sqlClient`select role_key,permission_key,created_at::text as created_at
      from role_permissions where role_key='MAINTENANCE' and permission_key='devices:read'`;
    assert.ok(originalPermission, "the equipment permission must exist before temporarily removing it");
    try {
      await sqlClient`delete from role_permissions where role_key='MAINTENANCE' and permission_key='devices:read'`;
      assert.equal(await named("technician"), null);
    } finally {
      // Preserve PostgreSQL's timestamp precision instead of recreating catalog metadata.
      const [restoredPermission] = await sqlClient`insert into role_permissions(role_key,permission_key,created_at)
        values(${originalPermission.role_key},${originalPermission.permission_key},${originalPermission.created_at}::timestamptz)
        on conflict (role_key,permission_key) do update set created_at=excluded.created_at
        returning role_key,permission_key,created_at::text as created_at`;
      assert.deepEqual(restoredPermission, originalPermission, "temporary permission removal preserves the complete catalog row");
    }
    const history = async (who: keyof typeof people) => (await ok<Asset & { workOrders: Array<{ id: string; status: string }> }>(`/v1/assets/${asset.id}`, who)).workOrders.map(item => item.id);
    assert.deepEqual((await history("manager")).sort(), [mine.id, unassigned.id].sort());
    assert.deepEqual(await history("technician"), [mine.id]);
    assert.equal((await api(`/v1/work-orders/${mine.id}`, "technician", "PATCH", { version: 1, assetId: null })).status, 403, "an executor cannot detach the asset");
    const moved = await ok<{ assetId: string | null }>(`/v1/work-orders/${unassigned.id}`, "manager", "PATCH", { version: 1, assetId: null });
    assert.equal(moved.assetId, null);
    assert.equal((await api("/v1/work-orders", "manager", "POST", { buildingId: building, title: "Ativo de fora", assetId: foreignAssetId })).status, 400);
    assert.equal((await api("/v1/work-orders", "manager", "POST", { buildingId: building, title: "Ativo inexistente", assetId: randomUUID() })).status, 400);
    await ok(`/v1/assets/${asset.id}`, "manager", "PATCH", { version: 1, active: false });
    assert.equal((await api("/v1/work-orders", "manager", "POST", { buildingId: building, title: "Ativo inativo", assetId: asset.id })).status, 400);
    assert.equal((await ok<{ assetId: string | null }>(`/v1/work-orders/${mine.id}`, "manager")).assetId, asset.id, "existing history keeps pointing to the inactive asset");
  });

  it("enforces tenant, fields and audit proof at the SQL boundary", async () => {
    const asset = await create();
    const as = <T>(who: keyof typeof people, role: "BUILDING_ADMIN" | "RESIDENT", run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId: people[who], role }, run);
    const refused = (promise: Promise<unknown>, code = "42501") => assert.rejects(promise, error => pgErrorCode(error) === code);
    assert.equal((await as("resident", "RESIDENT", tx => tx.execute(sql`select id from assets`))).length, 0);
    assert.equal((await as("stranger", "BUILDING_ADMIN", tx => tx.execute(sql`select id from assets where building_id=${building}`))).length, 0);
    assert.equal((await appSqlClient`select id from assets`).length, 0, "pool outside an actor context sees nothing");
    await refused(as("technician", "RESIDENT", tx => tx.execute(sql`insert into assets(building_id,name,created_by) values(${building},'Forged',${people.technician})`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`insert into assets(building_id,name,created_by) values(${building},'Forged',${people.technician})`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`insert into assets(building_id,name,created_by) values(${other},'Forged',${people.manager})`)));
    // A reader's UPDATE is not an error: the policy leaves it no row to change.
    assert.equal((await as("technician", "RESIDENT", tx => tx.execute(sql`update assets set version=version+1, name='Hijacked' where id=${asset.id} returning id`))).length, 0);
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`update assets set building_id=${other} where id=${asset.id}`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`update assets set created_by=${people.technician} where id=${asset.id}`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`delete from assets where id=${asset.id}`)));
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`update assets set name='No version' where id=${asset.id}`)), "P0409");
    await refused(as("manager", "BUILDING_ADMIN", tx => tx.execute(sql`insert into asset_device_links(asset_id,building_id,device_id,created_by) values(${asset.id},${building},${devices.foreign},${people.manager})`)), "23514");
    await refused(as("technician", "RESIDENT", tx => tx.execute(sql`insert into asset_device_links(asset_id,building_id,device_id,created_by) values(${asset.id},${building},${devices.pump},${people.technician})`)));
    const audit = (who: keyof typeof people, action: string, target: string) => as(who, "RESIDENT", tx => tx.execute(
      sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${building},${people[who]},${action},'asset',${target})`));
    await refused(audit("technician", "ASSET_UPDATED", asset.id));
    await refused(audit("manager", "ASSET_UPDATED", foreignAssetId));
    await refused(audit("manager", "ASSET_DELETED", asset.id));
    const [row] = await sqlClient`select name,version,active,building_id from assets where id=${asset.id}`;
    assert.deepEqual({ ...row }, { name: "Bomba de recalque 1", version: 1, active: true, building_id: building });
  });

  it("reapplies 044 without changing functions, policies or grants", async () => {
    const migration = await readFile(new URL("../../../infrastructure/044-assets.sql", import.meta.url), "utf8");
    const rollback = new Error("044 reapplication rollback");
    await assert.rejects(sqlClient.begin(async owner => {
      const invariant = async () => ({
        functions: await owner`select p.oid::regprocedure::text as signature,p.prosrc,p.proacl::text,p.proowner,p.proconfig,p.prosecdef
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by signature`,
        policies: await owner`select * from pg_policies where schemaname='public' order by tablename,policyname`,
        tables: await owner`select c.relname,c.relrowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname`,
        columns: await owner`select a.attrelid::regclass::text as relation,a.attname,a.attacl::text from pg_attribute a join pg_class c on c.oid=a.attrelid
          join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null order by 1,2`,
      });
      const before = await invariant();
      await owner.unsafe(migration);
      assert.deepEqual(await invariant(), before);
      throw rollback;
    }), error => error === rollback);
  });
});
