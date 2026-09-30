import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { buildings, buildingFeatureSettings, featureRuntime, auditLogs, closeAppDb, withUserContext } from "@predioon/db/runtime";
import { identitySqlClient } from "@predioon/db/identity";
import { brokerAuthSqlClient } from "@predioon/db/broker-auth";
import { CAPABILITIES, ROLE_CAPABILITIES } from "@predioon/shared";
import { hashPassword } from "../src/auth/passwords.js";
import { startTestServer, login, call } from "./helpers.js";

describe("capacidades de seleção de condomínios e funcionalidades", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  async function fixture(run: (f: Awaited<ReturnType<typeof create>>) => Promise<void>) {
    const f = await create();
    try { await run(f); }
    finally {
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(f.ids)}`;
      await sqlClient`delete from buildings where organization_id=${f.org}`;
      await sqlClient`delete from organizations where id=${f.org}`;
      await sqlClient`delete from users where id in ${sqlClient(f.ids)}`;
    }
  }
  async function create() {
    const suffix = randomUUID(), org = `cap-org-${suffix}`, a = `cap-a-${suffix}`, b = `cap-b-${suffix}`, deviceA = `cap-device-${suffix}`;
    const worker = `worker-${suffix}`, scoped = `scoped-${suffix}`, manager = `manager-${suffix}`;
    const support = `support-${suffix}`, platform = `platform-${suffix}`, legacy = `legacy-${suffix}`, outsider = `outsider-${suffix}`;
    const ids = [worker, scoped, manager, support, platform, legacy, outsider];
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Capability test',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'A','A'),(${b},${org},'B','B')`;
    await sqlClient`insert into devices(id,building_id,name,type) values(${deviceA},${a},'Diagnostic sensor','WATER_LEVEL_SENSOR')`;
    for (const id of ids) await sqlClient`insert into users(id,email,name,password_hash,is_platform_admin) values(${id},${id + '@caps.test'},${id},${passwordHash},${id === legacy})`;
    const team = randomUUID(), binding = randomUUID(), resourceBinding = randomUUID(), managerBinding = randomUUID(), platformBinding = randomUUID(), supportBinding = randomUUID();
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Maintenance')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${worker})`;
    await sqlClient`insert into role_bindings(id,team_id,building_id,role_key) values(${binding},${team},${a},'MAINTENANCE')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${resourceBinding},${scoped},${a},'MAINTENANCE','device',${deviceA})`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${managerBinding},${manager},${a},'BUILDING_ADMIN')`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${manager},${b},'RESIDENT')`;
    await sqlClient`insert into role_bindings(id,user_id,role_key) values(${platformBinding},${platform},'PLATFORM_ADMIN'),(${supportBinding},${support},'PLATFORM_SUPPORT')`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${a},'GAS',true),(${b},'GAS',false)`;
    await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${a},'GAS',now()),(${b},'GAS',now())`;
    const tokens = new Map<string, string>();
    for (const id of ids) tokens.set(id, (await login(server.url, id + '@caps.test')).accessToken);
    const request = (user: string, path: string, method = "GET", body?: unknown) => call(server.url, path, { token: tokens.get(user), method, body });
    return { org,a,b,deviceA,worker,scoped,manager,support,platform,legacy,outsider,ids,team,binding,resourceBinding,managerBinding,platformBinding,supportBinding,request };
  }
  const as = <T>(userId: string, fn: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, fn);
  async function writeAs<T>(userId: string, fn: Parameters<typeof withUserContext<T>>[1], role: "PLATFORM_ADMIN" | "RESIDENT" = "PLATFORM_ADMIN"): Promise<T> {
    const rollback = new Error("Rollback isolated negative write");
    let result: T;
    try { await withUserContext({userId,role}, async tx => { result = await fn(tx); throw rollback; }); }
    catch (error) { if (error !== rollback) throw error; }
    return result!;
  }
  const featureBody = { enabled: false, version: 1, reason: "Teste de autorização por capacidade" };

  it("mantém catálogo aditivo SQL e runtime iguais", async () => {
    const rows = await sqlClient`select key from permissions order by key`;
    assert.deepEqual(rows.map(r => r.key), [...CAPABILITIES].sort());
    for (const [role, capabilities] of Object.entries(ROLE_CAPABILITIES)) {
      const granted = await sqlClient`select permission_key from role_permissions where role_key=${role} order by permission_key`;
      assert.deepEqual(granted.map(r => r.permission_key), [...capabilities].sort(), role);
    }
    assert.ok(CAPABILITIES.includes("buildings:read" as any));
    assert.deepEqual(ROLE_CAPABILITIES.PLATFORM_SUPPORT, []);
  });
  it("manutenção por equipe seleciona apenas seu condomínio e lê estado, sem editar", async () => fixture(async f => {
    const response = await f.request(f.worker,"/buildings");
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).items.map((r: any) => r.id), [f.a]);
    assert.equal((await f.request(f.worker,`/buildings/${f.a}`)).status,200);
    assert.equal((await f.request(f.worker,`/features/buildings/${f.a}`)).status,200);
    assert.equal((await f.request(f.worker,`/buildings/${f.a}`,"PATCH",{name:"Forbidden"})).status,403);
    assert.equal((await f.request(f.worker,`/features/buildings/${f.a}/GAS`,"PUT",featureBody)).status,403);
    assert.equal((await f.request(f.worker,`/features/buildings/${f.b}`)).status,403);
    assert.deepEqual((await as(f.worker,tx => tx.select().from(buildings))).map(r => r.id),[f.a]);
  }));
  it("binding de recurso descobre cadastro e features sem ampliar capacidade operacional", async () => fixture(async f => {
    assert.equal((await f.request(f.scoped,`/buildings/${f.a}`)).status,200);
    assert.equal((await f.request(f.scoped,`/features/buildings/${f.a}`)).status,200);
    const [row] = await as(f.scoped,tx => tx.execute(sql`select app_has_capability(${f.a},'devices:read') as allowed`));
    assert.equal(row?.allowed,false);
    assert.equal((await as(f.scoped,tx => tx.select().from(buildingFeatureSettings))).length,1);
    assert.equal((await as(f.scoped,tx => tx.select().from(featureRuntime))).length,1);
    await sqlClient`update role_bindings set active=false where id=${f.resourceBinding}`;
    assert.equal((await f.request(f.scoped,`/features/buildings/${f.a}`)).status,403);
  }));
  it("revogação, vigência e equipe inativa retiram acesso no mesmo JWT", async () => fixture(async f => {
    for (const change of ["binding", "expiry", "future", "team", "member", "memberExpiry"]) {
      if (change === "binding") await sqlClient`update role_bindings set active=false where id=${f.binding}`;
      if (change === "expiry") await sqlClient`update role_bindings set ends_at=now()-interval '1 second' where id=${f.binding}`;
      if (change === "future") await sqlClient`update role_bindings set starts_at=now()+interval '1 hour' where id=${f.binding}`;
      if (change === "team") await sqlClient`update teams set active=false where id=${f.team}`;
      if (change === "member") await sqlClient`update team_members set active=false where team_id=${f.team}`;
      if (change === "memberExpiry") await sqlClient`update team_members set ends_at=now()-interval '1 second' where team_id=${f.team}`;
      assert.equal((await f.request(f.worker,`/features/buildings/${f.a}`)).status,403,change);
      assert.deepEqual((await (await f.request(f.worker,"/buildings")).json()).items,[],change);
      await sqlClient`update role_bindings set active=true,ends_at=null,starts_at=null where id=${f.binding}`;
      await sqlClient`update teams set active=true where id=${f.team}`;
      await sqlClient`update team_members set active=true,ends_at=null where team_id=${f.team}`;
    }
  }));
  it("suporte descobre somente condomínio concedido com grant válido e papel vigente", async () => fixture(async f => {
    assert.equal((await f.request(f.support,`/features/buildings/${f.a}`)).status,403);
    const grant = randomUUID();
    await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${grant},${f.a},${f.support},'devices:read','device',${f.deviceA},'Diagnóstico autorizado',now()+interval '1 hour',${f.legacy})`;
    assert.deepEqual((await (await f.request(f.support,"/buildings")).json()).items.map((r: any) => r.id),[f.a]);
    assert.equal((await f.request(f.support,`/features/buildings/${f.a}`)).status,200);
    assert.equal((await f.request(f.support,`/buildings/${f.a}`,"PATCH",{name:"Forbidden"})).status,403);
    for (const change of ["revoked", "expired", "role"]) {
      if (change === "revoked") await sqlClient`update support_grants set revoked_at=now() where id=${grant}`;
      if (change === "expired") await sqlClient`update support_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${grant}`;
      if (change === "role") await sqlClient`update role_bindings set active=false where id=${f.supportBinding}`;
      assert.equal((await f.request(f.support,`/features/buildings/${f.a}`)).status,403,change);
      await sqlClient`update support_grants set revoked_at=null,created_at=now(),expires_at=now()+interval '1 hour' where id=${grant}`;
    }
  }));
  it("síndico por binding edita A, morador em B não edita B e revogação é imediata", async () => fixture(async f => {
    assert.equal((await f.request(f.manager,`/buildings/${f.a}`,"PATCH",{name:"Edited A"})).status,200);
    assert.equal((await f.request(f.manager,`/buildings/${f.b}`,"PATCH",{name:"Forbidden B"})).status,403);
    const logs = await sqlClient`select action,user_id from audit_logs where building_id=${f.a}`;
    assert.ok(logs.some(r => r.action === "BUILDING_UPDATED" && r.user_id === f.manager));
    await sqlClient`update role_bindings set active=false where id=${f.managerBinding}`;
    assert.equal((await f.request(f.manager,`/buildings/${f.a}`,"PATCH",{name:"Revoked"})).status,403);
  }));
  it("desativação local audita antes da perda de acesso e global reativa", async () => fixture(async f => {
    assert.equal((await f.request(f.manager,`/buildings/${f.a}`,"PATCH",{active:false})).status,200);
    assert.equal((await f.request(f.manager,`/features/buildings/${f.a}`)).status,403);
    const logs = await sqlClient`select action,metadata from audit_logs where user_id=${f.manager}`;
    assert.ok(logs.some(r => r.action === "BUILDING_UPDATED" && r.metadata.active === false));
    assert.equal((await f.request(f.platform,`/buildings/${f.a}`)).status,200);
    assert.equal((await f.request(f.platform,`/buildings/${f.a}`,"PATCH",{active:true})).status,200);
  }));
  it("admin global explícito e compatibilidade legada provisionam e configuram com ator real", async () => fixture(async f => {
    for (const user of [f.platform,f.legacy]) {
      const response = await f.request(user,"/buildings","POST",{organizationId:f.org,name:"Created",code:user.slice(0,20)});
      assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
      assert.equal((await f.request(user,"/features/catalog")).status,200);
      assert.equal((await f.request(user,"/features/global")).status,200);
      const state = await (await f.request(user,`/features/buildings/${f.a}`)).json();
      const version = state.items.find((r: any) => r.key === "GAS").version;
      assert.equal((await f.request(user,`/features/buildings/${f.a}/GAS`,"PUT",{...featureBody,enabled:user === f.legacy,version})).status,200);
      const logs = await sqlClient`select action,user_id from audit_logs where user_id=${user}`;
      assert.ok(logs.some(r => r.action === "BUILDING_CREATED"));
      assert.ok(logs.some(r => r.action === "FEATURE_CONFIGURATION_CHANGED"));
    }
    await sqlClient`update role_bindings set active=false where id=${f.platformBinding}`;
    assert.equal((await f.request(f.platform,"/features/global")).status,403);
    assert.equal((await f.request(f.platform,"/buildings","POST",{organizationId:f.org,name:"Denied",code:"denied"})).status,403);
  }));
  it("conta e organização inativas retiram permissões e contexto forjado não concede acesso", async () => fixture(async f => {
    await sqlClient`update organizations set active=false where id=${f.org}`;
    assert.deepEqual((await (await f.request(f.worker,"/buildings")).json()).items,[]);
    assert.equal((await f.request(f.worker,`/features/buildings/${f.a}`)).status,403);
    await sqlClient`update users set active=false where id=${f.platform}`;
    assert.equal((await f.request(f.platform,"/features/global")).status,401);
    assert.deepEqual(await as(f.platform,tx => tx.select().from(buildings)),[]);
    assert.deepEqual(await as(f.outsider,tx => tx.select().from(buildings)),[]);
    await assert.rejects(writeAs(f.outsider,tx => tx.insert(buildings).values({id:randomUUID(),organizationId:f.org,name:"Forged",code:"forged"})));
    assert.deepEqual(await writeAs(f.outsider,tx => tx.update(buildings).set({name:"Forged"}).where(eq(buildings.id,f.a)).returning()),[]);
    await assert.rejects(writeAs(f.outsider,tx => tx.insert(buildingFeatureSettings).values({buildingId:f.a,key:"SMOKE",enabled:false})));
    await assert.rejects(writeAs(f.outsider,tx => tx.execute(sql`select app_apply_feature_transition(${f.a},'GAS',false)`)));
    await assert.rejects(writeAs(f.outsider,tx => tx.insert(auditLogs).values({buildingId:f.a,userId:f.outsider,actorType:"USER",action:"BUILDING_UPDATED",resourceType:"building",resourceId:f.a})));
  }));
  it("RLS de leitura não autoriza UPDATE/INSERT/DELETE de condomínio", async () => fixture(async f => {
    assert.deepEqual(await writeAs(f.worker,tx => tx.update(buildings).set({name:"Denied"}).where(eq(buildings.id,f.a)).returning()),[]);
    await assert.rejects(writeAs(f.worker,tx => tx.insert(buildings).values({id:randomUUID(),organizationId:f.org,name:"Denied",code:"denied"})));
    await assert.rejects(writeAs(f.platform,tx => tx.delete(buildings).where(eq(buildings.id,f.a))));
    await assert.rejects(writeAs(f.platform,tx => tx.insert(auditLogs).values({buildingId:f.a,userId:f.platform,actorType:"USER",action:"UNRELATED_GLOBAL_LOG",resourceType:"building",resourceId:f.a}),"RESIDENT"));
    await assert.rejects(writeAs(f.manager,tx => tx.insert(auditLogs).values({buildingId:f.a,userId:f.outsider,actorType:"USER",action:"BUILDING_UPDATED",resourceType:"building",resourceId:f.a})));
  }));
  it("helper de descoberta mantém proprietário administrativo e execução restrita", async () => {
    const [row] = await sqlClient`select p.prosecdef,pg_get_userbyid(p.proowner) as owner,
      pg_get_userbyid(c.proowner) as capability_owner,p.proconfig,
      has_function_privilege('predioon_app',p.oid,'EXECUTE') as app_execute,
      has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity_execute,
      exists(select 1 from aclexplode(p.proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute
      from pg_proc p cross join pg_proc c where p.oid='app_can_discover_building(text)'::regprocedure
        and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
    assert.equal(row.prosecdef,true);
    assert.equal(row.owner,row.capability_owner);
    assert.equal(row.app_execute,true);
    assert.equal(row.identity_execute,false);
    assert.equal(row.public_execute,false);
    assert.ok(row.proconfig.includes("search_path=public, pg_temp"));
  });
  it("admin global explícito configura o padrão global com versão e audit", async () => fixture(async f => {
    const original = await sqlClient`select * from global_feature_settings where feature_key='GAS'`;
    try {
      const global = await (await f.request(f.platform,"/features/global")).json();
      const gas = global.items.find((r: any) => r.key === "GAS");
      // Preserve the effective state of unrelated buildings during this test.
      const response = await f.request(f.platform,"/features/global/GAS","PUT",{...featureBody,enabled:gas.globalEnabled,version:gas.globalVersion});
      assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
      const logs = await sqlClient`select action,metadata from audit_logs where user_id=${f.platform} and building_id is null`;
      assert.ok(logs.some(r => r.action === "FEATURE_CONFIGURATION_CHANGED" && r.metadata.scope === "GLOBAL"));
      assert.equal((await f.request(f.platform,"/features/global/GAS","PUT",{...featureBody,enabled:gas.globalEnabled,version:gas.globalVersion})).status,409);
    } finally {
      await sqlClient`delete from global_feature_settings where feature_key='GAS'`;
      if (original.length) await sqlClient`insert into global_feature_settings ${sqlClient(original)}`;
    }
  }));
  it("políticas identity e broker continuam lendo cadastro com seus privilégios", async () => fixture(async f => {
    assert.equal((await identitySqlClient`select id from buildings where id=${f.a}`).length,1);
    assert.equal((await brokerAuthSqlClient`select id,active from buildings where id=${f.b}`).length,1);
  }));
});
