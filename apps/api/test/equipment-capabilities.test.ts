import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";

process.env.MQTT_AUTH_SECRET = "equipment-test-broker-secret-at-least-32-chars";
const { startTestServer, login, call } = await import("./helpers.js");

describe("equipment capabilities: private inventory and configuration", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);
  async function create() {
    const s = randomUUID(), org = `eq-org-${s}`, a = `eq-a-${s}`, b = `eq-b-${s}`;
    const d1 = `eq-d1-${s}`, d2 = `eq-d2-${s}`, db = `eq-db-${s}`, ga = `eq-ga-${s}`, gb = `eq-gb-${s}`;
    const admin = `eq-admin-${s}`, worker = `eq-worker-${s}`, scoped = `eq-scoped-${s}`, gateway = `eq-gateway-${s}`;
    const resident = `eq-resident-${s}`, support = `eq-support-${s}`, platform = `eq-platform-${s}`, outsider = `eq-outsider-${s}`, manager = `eq-manager-${s}`;
    const ids = [admin,worker,scoped,gateway,resident,support,platform,outsider,manager];
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Equipment test',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'A','A'),(${b},${org},'B','B')`;
    for (const id of ids) await sqlClient`insert into users(id,email,name,password_hash) values(${id},${id+'@equipment.test'},${id},${passwordHash})`;
    await sqlClient`update users set is_platform_admin=true where id=${platform}`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number,metadata) values(${ga},${a},'Gateway A',${ga},'{"private":"A"}'),(${gb},${b},'Gateway B',${gb},'{"private":"B"}')`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type,metadata) values(${d1},${a},${ga},'Device A1','WATER_LEVEL_SENSOR','{"private":"A"}'),(${d2},${a},null,'Device A2','ENERGY_METER','{}'),(${db},${b},${gb},'Device B','WATER_LEVEL_SENSOR','{"private":"B"}')`;
    await sqlClient`insert into device_metrics(building_id,device_id,key,label) values(${a},${d1},'level','Level'),(${a},${d2},'energy','Energy'),(${b},${db},'foreign','Foreign')`;
    const team = randomUUID(), teamBinding = randomUUID(), adminBinding = randomUUID(), scopedBinding = randomUUID(), gatewayBinding = randomUUID(), supportBinding = randomUUID();
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Equipment team')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${worker})`;
    await sqlClient`insert into role_bindings(id,team_id,building_id,role_key) values(${teamBinding},${team},${a},'MAINTENANCE')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${scopedBinding},${scoped},${a},'BUILDING_ADMIN','device',${d1}),(${gatewayBinding},${gateway},${a},'BUILDING_ADMIN','gateway',${ga})`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${adminBinding},${admin},${a},'BUILDING_ADMIN'),(${randomUUID()},${manager},${a},'MAINTENANCE_MANAGER')`;
    await sqlClient`insert into role_bindings(id,user_id,role_key) values(${supportBinding},${support},'PLATFORM_SUPPORT'),(${randomUUID()},${platform},'PLATFORM_ADMIN')`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${admin},${b},'RESIDENT'),(${resident},${a},'RESIDENT')`;
    const tokens = new Map<string,string>();
    for (const id of ids) tokens.set(id,(await login(server.url,id+'@equipment.test')).accessToken);
    const request = (user: string, path: string, method = 'GET', body?: unknown) => call(server.url,path,{token:tokens.get(user),method,body});
    return {org,a,b,d1,d2,db,ga,gb,admin,worker,scoped,gateway,resident,support,platform,outsider,manager,ids,team,teamBinding,adminBinding,scopedBinding,gatewayBinding,supportBinding,request};
  }
  type Fixture = Awaited<ReturnType<typeof create>>;
  async function fixture(run: (f: Fixture) => Promise<void>) {
    const f = await create();
    try { await run(f); }
    finally {
      await sqlClient`delete from audit_logs where building_id in ${sqlClient([f.a,f.b])}`;
      await sqlClient`delete from gate_commands where building_id in ${sqlClient([f.a,f.b])}`;
      await sqlClient`delete from gates where building_id in ${sqlClient([f.a,f.b])}`;
      await sqlClient`delete from buildings where organization_id=${f.org}`;
      await sqlClient`delete from organizations where id=${f.org}`;
      await sqlClient`delete from users where id in ${sqlClient(f.ids)}`;
    }
  }
  async function items(response: Response) { assert.equal(response.status,200,await response.clone().text()); return (await response.json()).items as any[]; }
  async function status(response: Response, expected: number) { assert.equal(response.status,expected,await response.clone().text()); }
  const raw = (user: string, table: 'devices'|'gateways'|'device_metrics') => as(user,tx=>tx.execute(sql`select * from ${sql.identifier(table)}`));
  async function broker(path: string, body: unknown) {
    const response = await fetch(`${server.url}/internal/mqtt/${path}`,{method:'POST',headers:{'Content-Type':'application/json','x-mqtt-secret':process.env.MQTT_AUTH_SECRET!},body:JSON.stringify(body)});
    assert.equal(response.status,200); return (await response.json()).result;
  }

  it("allows team and direct maintenance without legacy membership, read only", async () => fixture(async f => {
    for (const u of [f.worker,f.manager,f.admin]) {
      assert.deepEqual((await items(await f.request(u,`/devices?buildingId=${f.a}`))).map(r=>r.id),[f.d1,f.d2]);
      assert.deepEqual((await items(await f.request(u,'/gateways'))).map(r=>r.id),[f.ga]);
      assert.equal((await raw(u,'devices')).length,2);
      await status(await f.request(u,`/devices?buildingId=${f.b}`),403);
    }
    for(const u of [f.worker,f.manager]) {
      await status(await f.request(u,`/devices/${f.d1}`,'PATCH',{name:'Denied'}),403);
      await status(await f.request(u,`/gateways/${f.ga}/credentials`,'POST'),403);
    }
  }));
  it("denies resident/global/forged app.role private reads and writes", async () => fixture(async f => {
    for(const u of [f.resident,f.platform,f.outsider]) {
      await status(await f.request(u,`/devices?buildingId=${f.a}`),403);
      assert.deepEqual(await items(await f.request(u,'/devices')),[]);
      assert.deepEqual(await items(await f.request(u,'/gateways')),[]);
      for(const table of ['devices','gateways','device_metrics'] as const) assert.equal((await raw(u,table)).length,0);
      await status(await f.request(u,`/devices/${f.d1}/metrics`),404);
      await status(await f.request(u,`/gateways/${f.ga}/credentials`,'POST'),404);
      await status(await f.request(u,'/devices','POST',{buildingId:f.a,name:'Denied',type:'SENSOR'}),403);
    }
  }));
  it("keeps exact device and gateway grants independent and rejects fleet promotion", async () => fixture(async f => {
    assert.deepEqual((await items(await f.request(f.scoped,'/devices'))).map(r=>r.id),[f.d1]);
    assert.deepEqual(await items(await f.request(f.scoped,'/gateways')),[]);
    assert.deepEqual((await items(await f.request(f.gateway,'/gateways'))).map(r=>r.id),[f.ga]);
    assert.deepEqual(await items(await f.request(f.gateway,'/devices')),[]);
    await status(await f.request(f.scoped,`/devices/${f.d1}/metrics`),200);
    for(const d of [f.d2,f.db,'missing']) await status(await f.request(f.scoped,`/devices/${d}/metrics`),404);
    await status(await f.request(f.gateway,`/devices/${f.d1}/metrics`),404);
    for(const u of [f.scoped,f.gateway]) await status(await f.request(u,'/devices','POST',{buildingId:f.a,name:'New',type:'SENSOR'}),403);
    await sqlClient`update role_bindings set resource_type='building',resource_id=${f.a} where id=${f.scopedBinding}`;
    await status(await f.request(f.scoped,`/devices?buildingId=${f.a}`),403);
    assert.equal((await raw(f.scoped,'devices')).length,0);
  }));
  it("supports explicit local platform grants without access to neighbors", async () => fixture(async f => {
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.platform},${f.a},'BUILDING_ADMIN','gateway',${f.ga})`;
    assert.deepEqual((await items(await f.request(f.platform,'/gateways'))).map(r=>r.id),[f.ga]);
    await status(await f.request(f.platform,`/gateways/${f.ga}`,'PATCH',{name:'Local platform'}),200);
    await status(await f.request(f.platform,`/gateways/${f.gb}`,'PATCH',{name:'Foreign'}),404);
    assert.deepEqual(await items(await f.request(f.platform,'/devices')),[]);
  }));
  it("distinguishes empty whole-tenant scope from nonexistent/foreign resource scopes", async () => fixture(async f => {
    await sqlClient`delete from devices where building_id=${f.a}`;
    assert.deepEqual(await items(await f.request(f.admin,`/devices?buildingId=${f.a}`)),[]);
    await status(await f.request(f.scoped,`/devices?buildingId=${f.a}`),403);
    await sqlClient`update role_bindings set resource_type='device',resource_id=${f.db} where id=${f.scopedBinding}`;
    await status(await f.request(f.scoped,`/devices?buildingId=${f.a}`),403);
    await sqlClient`update role_bindings set resource_type='gateway',resource_id=${f.gb} where id=${f.gatewayBinding}`;
    assert.deepEqual(await items(await f.request(f.gateway,'/gateways')),[]);
  }));
  it("hides inconsistent owner devices and metrics and rejects cross-tenant gateway relations", async () => fixture(async f => {
    const bad = `bad-${randomUUID()}`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type) values(${bad},${f.a},${f.gb},'Bad owner relation','SENSOR')`;
    await sqlClient`insert into device_metrics(building_id,device_id,key,label) values(${f.b},${f.d1},'bad','Bad owner metric')`;
    assert.deepEqual((await items(await f.request(f.admin,'/devices'))).map(r=>r.id),[f.d1,f.d2]);
    assert.equal((await raw(f.admin,'device_metrics')).length,2);
    assert.equal((await items(await f.request(f.scoped,`/devices/${f.d1}/metrics`))).length,1);
    await status(await f.request(f.admin,`/devices/${bad}`,'PATCH',{name:'Hide'}),404);
    await status(await f.request(f.admin,`/devices/${f.d1}`,'PATCH',{gatewayId:f.gb}),400);
    await status(await f.request(f.admin,'/devices','POST',{buildingId:f.a,gatewayId:f.gb,name:'Foreign relation',type:'SENSOR'}),400);
    await assert.rejects(as(f.admin,tx=>tx.execute(sql`insert into devices(id,building_id,gateway_id,name,type) values(${randomUUID()},${f.a},${f.gb},'Foreign','SENSOR')`)));
    await assert.rejects(as(f.admin,tx=>tx.execute(sql`update devices set gateway_id=${f.gb} where id=${f.d1}`)));
    await assert.rejects(as(f.admin,tx=>tx.execute(sql`insert into device_metrics(building_id,device_id,key,label) values(${f.b},${f.d1},'bad-app','Bad app metric')`)));
  }));
  it("creates and configures equipment and metrics with correct atomic USER audits", async () => fixture(async f => {
    const gatewayResponse = await f.request(f.admin,'/gateways','POST',{buildingId:f.a,name:'New gateway',serialNumber:randomUUID()});
    await status(gatewayResponse,201); const g = await gatewayResponse.json();
    const response = await f.request(f.admin,'/devices','POST',{id:'forged',buildingId:f.a,gatewayId:g.id,name:'New device',type:'SENSOR'});
    await status(response,201); const d = await response.json(); assert.notEqual(d.id,'forged');
    await status(await f.request(f.admin,`/devices/${d.id}`,'PATCH',{name:'Configured'}),200);
    await status(await f.request(f.gateway,`/gateways/${f.ga}`,'PATCH',{name:'Configured gateway'}),200);
    const metricResponse = await f.request(f.scoped,`/devices/${f.d1}/metrics`,'POST',{key:'new',label:'New metric',buildingId:f.b,deviceId:f.db});
    await status(metricResponse,201); const metric = await metricResponse.json(); assert.equal(metric.buildingId,f.a); assert.equal(metric.deviceId,f.d1);
    const audits = await sqlClient`select * from audit_logs where building_id=${f.a} order by created_at`;
    assert.deepEqual(audits.map(r=>r.action),['GATEWAY_CREATED','DEVICE_CREATED','DEVICE_UPDATED','GATEWAY_UPDATED','DEVICE_METRIC_CREATED']);
    assert.ok(audits.every(r=>r.actor_type==='USER' && [f.admin,f.gateway,f.scoped].includes(r.user_id)));
    assert.equal(audits.at(-1)!.resource_id,metric.id); assert.equal(audits.at(-1)!.resource_type,'device_metric');
  }));
  it("requires read and configure independently even after permission revocation", async () => fixture(async f => {
    const permissions = await sqlClient`select key,active from permissions where key in ('devices:read','devices:configure')`;
    try {
      await sqlClient`update permissions set active=false where key='devices:configure'`;
      await status(await f.request(f.scoped,`/devices/${f.d1}`,'PATCH',{name:'Denied'}),403);
      await status(await f.request(f.scoped,`/devices/${f.d1}/metrics`,'POST',{key:'denied',label:'Denied'}),403);
      await status(await f.request(f.gateway,`/gateways/${f.ga}/credentials`,'POST'),403);
      assert.equal((await raw(f.scoped,'devices')).length,1);
      assert.equal((await as(f.scoped,tx=>tx.execute(sql`update devices set name='Denied' where id=${f.d1} returning id`))).length,0);
      await sqlClient`update permissions set active=true where key='devices:configure'`;
      await sqlClient`update permissions set active=false where key='devices:read'`;
      await status(await f.request(f.scoped,`/devices/${f.d1}`,'PATCH',{name:'Denied'}),404);
      await status(await f.request(f.gateway,`/gateways/${f.ga}/credentials`,'POST'),404);
      await status(await f.request(f.admin,'/gateways','POST',{buildingId:f.a,name:'Denied',serialNumber:randomUUID()}),403);
      assert.equal((await raw(f.admin,'devices')).length,0);
    } finally { for(const p of permissions) await sqlClient`update permissions set active=${p.active} where key=${p.key}`; }
  }));
  it("rotates MQTT credentials without exposing hashes/usernames in inventory or audit", async () => fixture(async f => {
    let oldPassword: string | undefined;
    for(let n=0;n<2;n++) {
      const response = await f.request(f.gateway,`/gateways/${f.ga}/credentials`,'POST'); await status(response,201); const c = await response.json();
      assert.equal(c.gatewayId,f.ga); assert.equal(c.buildingId,f.a); assert.equal(c.mqttUsername,`gw_${f.ga}`);
      assert.equal(c.telemetryTopic,`predio/${f.a}/device/{deviceId}/telemetry`); assert.equal(c.mqttTls,true);
      assert.equal(await broker('authn',{username:c.mqttUsername,password:c.mqttPassword,clientid:f.ga}),'allow');
      if(oldPassword) assert.equal(await broker('authn',{username:c.mqttUsername,password:oldPassword,clientid:f.ga}),'deny');
      oldPassword=c.mqttPassword;
      const [stored] = await sqlClient`select metadata from gateways where id=${f.ga}`;
      assert.notEqual(stored.metadata.mqttPasswordHash,c.mqttPassword); assert.equal(stored.metadata.mqttPassword,undefined);
      const listed = (await items(await f.request(f.gateway,'/gateways')))[0]; assert.equal(listed.metadata.mqttPasswordHash,undefined); assert.equal(listed.metadata.mqttUsername,undefined);
      const patch = await f.request(f.gateway,`/gateways/${f.ga}`,'PATCH',{metadata:{ordinary:'value'}}); await status(patch,200);
      const result = await patch.json(); assert.equal(result.metadata.mqttPasswordHash,undefined); assert.equal(result.metadata.mqttUsername,undefined);
      const [after] = await sqlClient`select metadata from gateways where id=${f.ga}`; assert.equal(after.metadata.mqttPasswordHash,stored.metadata.mqttPasswordHash);
      for(const metadata of [{mqttPasswordHash:'forged'},{mqttUsername:'forged'}]) await status(await f.request(f.gateway,`/gateways/${f.ga}`,'PATCH',{metadata}),400);
      for(const action of ['publish','subscribe']) for(const topic of [`predio/${f.b}/device/${f.db}/telemetry`,`predio/${f.a}/portao/abrir`,'#']) assert.equal(await broker('authz',{username:c.mqttUsername,clientid:f.ga,action,topic}),'deny');
    }
    const audits = await sqlClient`select metadata from audit_logs where building_id=${f.a}`;
    assert.ok(audits.every(r=>!JSON.stringify(r.metadata).includes('mqttPassword')&&!JSON.stringify(r.metadata).includes(oldPassword!)));
  }));
  it("supports diagnostic read only and revokes support windows and global support role live", async () => fixture(async f => {
    const grant = randomUUID();
    await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${grant},${f.a},${f.support},'devices:read','gateway',${f.ga},'Equipment diagnostic',now()+interval '1 hour',${f.platform})`;
    assert.deepEqual((await items(await f.request(f.support,'/gateways'))).map(r=>r.id),[f.ga]);
    assert.deepEqual(await items(await f.request(f.support,'/devices')),[]);
    await status(await f.request(f.support,`/gateways/${f.ga}/credentials`,'POST'),403);
    await status(await f.request(f.support,`/gateways/${f.ga}`,'PATCH',{name:'Denied'}),403);
    for(const kind of ['revoked','expired','role']) {
      if(kind==='revoked') await sqlClient`update support_grants set revoked_at=now() where id=${grant}`;
      if(kind==='expired') await sqlClient`update support_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${grant}`;
      if(kind==='role') await sqlClient`update role_bindings set active=false where id=${f.supportBinding}`;
      assert.deepEqual(await items(await f.request(f.support,'/gateways')),[],kind);
      await sqlClient`update support_grants set revoked_at=null,created_at=now(),expires_at=now()+interval '1 hour' where id=${grant}`;
    }
  }));
  it("rechecks account, tenant, organization, team, binding and role windows on the same JWT", async () => fixture(async f => {
    const mutations = [
      ()=>sqlClient`update role_bindings set active=false where id=${f.teamBinding}`,
      ()=>sqlClient`update role_bindings set ends_at=now()-interval '1 second' where id=${f.teamBinding}`,
      ()=>sqlClient`update role_bindings set starts_at=now()+interval '1 hour' where id=${f.teamBinding}`,
      ()=>sqlClient`update teams set active=false where id=${f.team}`,
      ()=>sqlClient`update team_members set active=false where team_id=${f.team}`,
      ()=>sqlClient`update team_members set ends_at=now()-interval '1 second' where team_id=${f.team}`,
      ()=>sqlClient`update team_members set starts_at=now()+interval '1 hour' where team_id=${f.team}`,
      ()=>sqlClient`update buildings set active=false where id=${f.a}`,
      ()=>sqlClient`update organizations set active=false where id=${f.org}`,
    ];
    for(const mutate of mutations) {
      await mutate(); await status(await f.request(f.worker,`/devices?buildingId=${f.a}`),403); assert.equal((await raw(f.worker,'devices')).length,0);
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.teamBinding}`;
      await sqlClient`update teams set active=true where id=${f.team}`;
      await sqlClient`update team_members set active=true,starts_at=null,ends_at=null where team_id=${f.team}`;
      await sqlClient`update buildings set active=true where id=${f.a}`; await sqlClient`update organizations set active=true where id=${f.org}`;
    }
    await sqlClient`update users set active=false where id=${f.worker}`;
    await status(await f.request(f.worker,'/devices'),401); assert.equal((await raw(f.worker,'devices')).length,0);
    const [role] = await sqlClient`select active from roles where key='BUILDING_ADMIN'`;
    try { await sqlClient`update roles set active=false where key='BUILDING_ADMIN'`; assert.equal((await raw(f.scoped,'devices')).length,0); }
    finally { await sqlClient`update roles set active=${role.active} where key='BUILDING_ADMIN'`; }
  }));
  it("retains live legacy local admin compatibility without leaking resident B", async () => fixture(async f => {
    await sqlClient`delete from role_bindings where id=${f.adminBinding}`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${f.admin},${f.a},'BUILDING_ADMIN')`;
    assert.deepEqual((await items(await f.request(f.admin,'/devices'))).map(r=>r.id),[f.d1,f.d2]);
    for(const kind of ['inactive','expired','future']) {
      if(kind==='inactive') await sqlClient`update memberships set active=false where user_id=${f.admin} and building_id=${f.a}`;
      if(kind==='expired') await sqlClient`update memberships set ends_at=now()-interval '1 second' where user_id=${f.admin} and building_id=${f.a}`;
      if(kind==='future') await sqlClient`update memberships set starts_at=now()+interval '1 hour' where user_id=${f.admin} and building_id=${f.a}`;
      await status(await f.request(f.admin,`/devices?buildingId=${f.a}`),403);
      await sqlClient`update memberships set active=true,starts_at=null,ends_at=null where user_id=${f.admin} and building_id=${f.a}`;
    }
  }));
  it("allows diagnosis/reactivation of disabled resources during feature pause", async () => fixture(async f => {
    await sqlClient`update devices set enabled=false where id=${f.d1}`;
    await sqlClient`update gateways set enabled=false where id=${f.ga}`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
    assert.equal((await items(await f.request(f.scoped,'/devices'))).length,1);
    assert.equal((await items(await f.request(f.gateway,'/gateways'))).length,1);
    await status(await f.request(f.scoped,`/devices/${f.d1}`,'PATCH',{enabled:true}),200);
    await status(await f.request(f.gateway,`/gateways/${f.ga}`,'PATCH',{enabled:true}),200);
  }));
  it("restricts direct DML to configuration columns and exact current scopes", async () => fixture(async f => {
    for(const [table,id] of [['devices',f.d1],['gateways',f.ga]] as const) {
      for(const column of ['id','building_id','status','last_seen_at','created_at']) await assert.rejects(as(f.admin,tx=>tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)}=${sql.identifier(column)} where id=${id}`)));
      await assert.rejects(as(f.admin,tx=>tx.execute(sql`delete from ${sql.identifier(table)} where id=${id}`)));
      const rows = await as(f.outsider,tx=>tx.execute(sql`update ${sql.identifier(table)} set name='Forged' where id=${id} returning id`)); assert.equal(rows.length,0);
    }
    await assert.rejects(as(f.admin,tx=>tx.execute(sql`update device_metrics set label='Denied' where device_id=${f.d1}`)));
    await assert.rejects(as(f.admin,tx=>tx.execute(sql`delete from device_metrics where device_id=${f.d1}`)));
    await assert.rejects(as(f.scoped,tx=>tx.execute(sql`insert into gateways(id,building_id,name,serial_number) values(${randomUUID()},${f.a},'Denied',${randomUUID()})`)));
  }));
  it("rejects forged equipment audits including malformed metric UUIDs", async () => fixture(async f => {
    for(const action of ['DEVICE_CREATED','DEVICE_UPDATED','GATEWAY_CREATED','GATEWAY_UPDATED','GATEWAY_CREDENTIALS_ISSUED','DEVICE_METRIC_CREATED']) {
      const type = action.startsWith('GATEWAY')?'gateway':action==='DEVICE_METRIC_CREATED'?'device_metric':'device';
      for(const [user,building,id] of [[f.platform,f.a,f.d1],[f.admin,f.b,f.d1],[f.admin,f.a,'malformed']] as const) await assert.rejects(as(user,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id) values(${building},${user},'USER',${action},${type},${id})`)));
    }
    await assert.rejects(as(f.admin,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id) values(${f.a},${f.outsider},'USER','DEVICE_UPDATED','device',${f.d1})`)));
  }));
  it("rolls back configuration, metric creation and credential emission when audit is denied", async () => fixture(async f => {
    const policy = `eq_audit_${randomUUID().replaceAll('-','')}`;
    await sqlClient.unsafe(`create policy ${policy} on audit_logs as restrictive for insert to predioon_app with check (building_id <> '${f.a}')`);
    try {
      await status(await f.request(f.scoped,`/devices/${f.d1}`,'PATCH',{name:'Must roll back'}),403);
      await status(await f.request(f.gateway,`/gateways/${f.ga}/credentials`,'POST'),403);
      await status(await f.request(f.scoped,`/devices/${f.d1}/metrics`,'POST',{key:'rollback',label:'Rollback'}),403);
      const [d] = await sqlClient`select name from devices where id=${f.d1}`; assert.equal(d.name,'Device A1');
      const [g] = await sqlClient`select metadata from gateways where id=${f.ga}`; assert.equal(g.metadata.mqttPasswordHash,undefined);
      assert.equal((await sqlClient`select id from device_metrics where device_id=${f.d1} and key='rollback'`).length,0);
    } finally { await sqlClient.unsafe(`drop policy ${policy} on audit_logs`); }
    await assert.rejects(as(f.scoped,async tx=>{await tx.execute(sql`update devices set name='Explicit rollback' where id=${f.d1}`); throw new Error('explicit rollback');}));
    const [d] = await sqlClient`select name from devices where id=${f.d1}`; assert.equal(d.name,'Device A1');
  }));
  it("rechecks current grants after a row-lock wait before patch or credential rotation", async () => fixture(async f => {
    for(const kind of ['device','gateway'] as const) {
      const table=kind==='device'?'devices':'gateways', id=kind==='device'?f.d1:f.ga, user=kind==='device'?f.scoped:f.gateway, binding=kind==='device'?f.scopedBinding:f.gatewayBinding;
      let release!:()=>void, locked!:()=>void;
      const lockedPromise = new Promise<void>(resolve=>{locked=resolve;}); const releasePromise = new Promise<void>(resolve=>{release=resolve;});
      const blocker = sqlClient.begin(async owner=>{await owner`select id from ${owner(table)} where id=${id} for update`; locked(); await releasePromise;});
      await lockedPromise;
      let pending: Promise<Response> | undefined;
      try {
        pending = kind==='device'?f.request(user,`/devices/${id}`,'PATCH',{name:'Wait revoked'}):f.request(user,`/gateways/${id}/credentials`,'POST');
        let waiting = false;
        for(let i=0;i<100;i++) {
          const rows = await sqlClient`select 1 from pg_stat_activity where usename='predioon_app' and wait_event_type='Lock' and query like ${'%'+table+'%'} and query not like '%pg_stat_activity%'`;
          if(rows.length) { waiting=true; break; } await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.equal(waiting,true,'authorized route reached the row lock');
        await sqlClient`update role_bindings set active=false where id=${binding}`;
      } finally { release(); await blocker; }
      await status(await pending!,404);
      const [row] = await sqlClient`select name,metadata from ${sqlClient(table)} where id=${id}`;
      assert.notEqual(row.name,'Wait revoked'); assert.equal(row.metadata.mqttPasswordHash,undefined);
    }
  }));
  it("keeps point helpers protected, stable and owned by the capability owner", async () => {
    for(const signature of ['app_device_has_capability(text,text,text)','app_gateway_has_capability(text,text,text)','app_equipment_can_read_scope(text,text)','app_device_metric_has_capability(text,text,text)','app_access_hardware_state(text,uuid)']) {
      const [r] = await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner) as owner,pg_get_userbyid(c.proowner) as capability_owner,
        has_function_privilege('predioon_app',p.oid,'EXECUTE') as app_execute,has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity_execute,
        has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker_execute,
        exists(select 1 from aclexplode(p.proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute
        from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      assert.equal(r.prosecdef,true); assert.equal(r.provolatile,'s'); assert.equal(r.owner,r.capability_owner);
      assert.equal(r.app_execute,true); assert.equal(r.identity_execute,false); assert.equal(r.broker_execute,false); assert.equal(r.public_execute,false);
      assert.ok(r.proconfig.includes('search_path=public, pg_temp'));
    }
  });
  async function physicalGate(f: Fixture) {
    await sqlClient`update devices set type='GATE_CONTROLLER',status='ONLINE',last_seen_at=now() where id=${f.d1}`;
    await sqlClient`update gateways set status='ONLINE',last_seen_at=now() where id=${f.ga}`;
    const [gate] = await sqlClient`insert into gates(building_id,name,kind,gateway_id,device_id,enabled,allow_residents)
      values(${f.a},'Resident access','GARAGE',${f.ga},${f.d1},true,true) returning id`;
    return gate.id as string;
  }
  it("returns only six gate-bound hardware fields while residents have no private configuration", async () => fixture(async f => {
    const gate = await physicalGate(f);
    const rows = await as(f.resident,tx=>tx.execute(sql`select * from app_access_hardware_state(${f.a},${gate}::uuid)`));
    assert.equal(rows.length,1);
    assert.deepEqual(Object.keys(rows[0]).sort(),['gateway_enabled','gateway_status','gateway_last_seen_at','device_enabled','device_status','device_last_seen_at'].sort());
    assert.equal(rows[0].gateway_enabled,true); assert.equal(rows[0].gateway_status,'ONLINE'); assert.equal(rows[0].device_status,'ONLINE');
    assert.equal((await raw(f.resident,'devices')).length,0); assert.equal((await raw(f.resident,'gateways')).length,0);
    const list = await f.request(f.resident,`/access?buildingId=${f.a}`); await status(list,200);
    const inventory = await list.json(); assert.equal(inventory.items[0].available,true); assert.deepEqual(inventory.devices,[]); assert.deepEqual(inventory.gateways,[]);
    const opening = await f.request(f.resident,`/access/${gate}/open`,'POST',{requestId:randomUUID()}); await status(opening,202);
    assert.equal((await opening.json()).status,'PENDING');
  }));
  it("creates a resident opening request without any private equipment grant", async () => fixture(async f => {
    const gate = await physicalGate(f);
    assert.equal((await raw(f.resident,'devices')).length,0); assert.equal((await raw(f.resident,'gateways')).length,0);
    await status(await f.request(f.resident,`/access/${gate}/open`,'POST',{requestId:randomUUID()}),202);
  }));
  it("denies the hardware projection for forged roles, foreign gates and changed hardware relations", async () => fixture(async f => {
    const gate = await physicalGate(f);
    for(const user of [f.outsider,f.worker,f.platform]) assert.equal((await as(user,tx=>tx.execute(sql`select * from app_access_hardware_state(${f.a},${gate}::uuid)`))).length,0);
    // 034 admits gates:read on the gate's actual device/gateway, independently
    // of legacy memberships and without broadening private inventory access.
    for(const user of [f.scoped,f.gateway]) assert.equal((await as(user,tx=>tx.execute(sql`select * from app_access_hardware_state(${f.a},${gate}::uuid)`))).length,1);
    await sqlClient`update role_bindings set active=false where id=${f.scopedBinding}`;
    assert.equal((await as(f.scoped,tx=>tx.execute(sql`select * from app_access_hardware_state(${f.a},${gate}::uuid)`))).length,0);
    for(const [building,id] of [[f.b,gate],[f.a,randomUUID()]] as const) assert.equal((await as(f.resident,tx=>tx.execute(sql`select * from app_access_hardware_state(${building},${id}::uuid)`))).length,0);
    await sqlClient`update devices set gateway_id=${f.gb} where id=${f.d1}`;
    assert.equal((await as(f.resident,tx=>tx.execute(sql`select * from app_access_hardware_state(${f.a},${gate}::uuid)`))).length,0);
    await sqlClient`update devices set gateway_id=${f.ga} where id=${f.d1}`;
    await sqlClient`update gateways set building_id=${f.b} where id=${f.ga}`;
    assert.equal((await as(f.resident,tx=>tx.execute(sql`select * from app_access_hardware_state(${f.a},${gate}::uuid)`))).length,0);
  }));
  it("rechecks membership windows and tenant activity without granting global physical access", async () => fixture(async f => {
    const gate = await physicalGate(f);
    const projection = (user: string) => as(user,tx=>tx.execute(sql`select * from app_access_hardware_state(${f.a},${gate}::uuid)`));
    assert.equal((await projection(f.resident)).length,1); assert.equal((await projection(f.platform)).length,0);
    for(const mutate of [
      ()=>sqlClient`update memberships set active=false where user_id=${f.resident}`,
      ()=>sqlClient`update memberships set starts_at=now()+interval '1 hour' where user_id=${f.resident}`,
      ()=>sqlClient`update memberships set ends_at=now()-interval '1 hour' where user_id=${f.resident}`,
      ()=>sqlClient`update buildings set active=false where id=${f.a}`,
      ()=>sqlClient`update organizations set active=false where id=${f.org}`,
      ()=>sqlClient`update users set active=false where id=${f.resident}`,
    ]) {
      await mutate(); assert.equal((await projection(f.resident)).length,0);
      await sqlClient`update memberships set active=true,starts_at=null,ends_at=null where user_id=${f.resident}`;
      await sqlClient`update buildings set active=true where id=${f.a}`;
      await sqlClient`update organizations set active=true where id=${f.org}`;
      await sqlClient`update users set active=true where id=${f.resident}`;
    }
    await sqlClient`update users set is_platform_admin=false where id=${f.platform}`;
    assert.equal((await projection(f.platform)).length,0,'neither the legacy platform flag nor a global RBAC role grants physical access');
  }));
});
