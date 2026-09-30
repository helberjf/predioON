import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { CAPABILITIES, ROLE_CAPABILITIES, SUPPORT_CAPABILITIES } from "@predioon/shared";
import { hashPassword } from "../src/auth/passwords.js";
import { startTestServer, login, call } from "./helpers.js";

describe("telemetry capabilities and published water", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);
  async function fixture(run: (f: Awaited<ReturnType<typeof create>>) => Promise<void>) {
    const f = await create();
    try { await run(f); }
    finally {
      await sqlClient`delete from telemetry where building_id in ${sqlClient([f.a,f.b])}`;
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(f.ids)}`;
      await sqlClient`delete from gates where building_id in ${sqlClient([f.a,f.b])}`;
      await sqlClient`delete from buildings where organization_id=${f.org}`;
      await sqlClient`delete from organizations where id=${f.org}`;
      await sqlClient`delete from users where id in ${sqlClient(f.ids)}`;
    }
  }
  async function create() {
    const suffix = randomUUID(), org = `tel-org-${suffix}`, a = `tel-a-${suffix}`, b = `tel-b-${suffix}`;
    const d1 = `tel-d1-${suffix}`, d2 = `tel-d2-${suffix}`, db = `tel-db-${suffix}`;
    const worker = `tel-worker-${suffix}`, scoped = `tel-scoped-${suffix}`, direct = `tel-direct-${suffix}`;
    const resident = `tel-resident-${suffix}`, support = `tel-support-${suffix}`, platform = `tel-platform-${suffix}`, outsider = `tel-outsider-${suffix}`;
    const ids = [worker,scoped,direct,resident,support,platform,outsider];
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Telemetry test',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'A','A'),(${b},${org},'B','B')`;
    for (const id of ids) await sqlClient`insert into users(id,email,name,password_hash) values(${id},${id+'@telemetry.test'},${id},${passwordHash})`;
    await sqlClient`insert into devices(id,building_id,name,type,metadata) values(${d1},${a},'Mixed A','ENERGY_METER','{"secret":"private"}'),(${d2},${a},'Neighbor A','WATER_LEVEL_SENSOR','{}'),(${db},${b},'Foreign B','WATER_LEVEL_SENSOR','{}')`;
    const team = randomUUID(), teamBinding = randomUUID(), scopedBinding = randomUUID(), directBinding = randomUUID(), residentBinding = randomUUID(), supportBinding = randomUUID();
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Technical team')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${worker})`;
    await sqlClient`insert into role_bindings(id,team_id,building_id,role_key) values(${teamBinding},${team},${a},'MAINTENANCE')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${scopedBinding},${scoped},${a},'MAINTENANCE','device',${d1})`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${directBinding},${direct},${a},'BUILDING_ADMIN'),(${residentBinding},${resident},${a},'RESIDENT')`;
    await sqlClient`insert into role_bindings(id,user_id,role_key) values(${supportBinding},${support},'PLATFORM_SUPPORT'),(${randomUUID()},${platform},'PLATFORM_ADMIN')`;
    // No legacy memberships: the API and projections must use live capability facts.
    await sqlClient`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value,unit,quality) values
      (now()-interval '2 seconds',${randomUUID()},${a},${d1},'water_level_percent','{"secret":"never publish"}',42,'private','UNCERTAIN'),
      (now()-interval '2 seconds',${randomUUID()},${a},${d1},'energy_total_kwh','999',999,'kWh','GOOD'),
      (now()-interval '2 seconds',${randomUUID()},${a},${d2},'water_level_percent','75',75,'%','GOOD'),
      (now()-interval '2 seconds',${randomUUID()},${b},${db},'water_level_percent','80',80,'%','GOOD')`;
    const tokens = new Map<string,string>();
    for (const id of ids) tokens.set(id,(await login(server.url,id+'@telemetry.test')).accessToken);
    const request = (user: string, path: string) => call(server.url,path,{token:tokens.get(user)});
    const latest = (user: string, building = a) => request(user,`/telemetry/latest?buildingId=${building}`);
    const series = (user: string, device = d1, metric = 'water_level_percent') => request(user,`/telemetry/series?deviceId=${device}&metric=${metric}`);
    return {org,a,b,d1,d2,db,worker,scoped,direct,resident,support,platform,outsider,ids,team,teamBinding,scopedBinding,directBinding,residentBinding,supportBinding,request,latest,series};
  }
  async function items(response: Response) { assert.equal(response.status,200,await response.clone().text()); return (await response.json()).items as any[]; }
  async function raw(user: string) { return [...await as(user,tx => tx.execute(sql`select building_id,device_id,metric from telemetry`))]; }

  it("allows direct and team technical bindings without legacy memberships", async () => fixture(async f => {
    for (const user of [f.direct,f.worker]) {
      assert.equal((await items(await f.latest(user))).length,3);
      assert.equal((await f.series(user)).status,200);
      const rows = await raw(user);
      assert.equal(rows.length,3); assert.ok(rows.every(r => r.building_id===f.a));
      assert.equal((await f.latest(user,f.b)).status,403);
    }
  }));
  it("authorizes exact devices and never promotes a building resource binding", async () => fixture(async f => {
    assert.equal((await items(await f.latest(f.scoped))).length,2);
    assert.ok((await raw(f.scoped)).every(r => r.device_id===f.d1));
    assert.equal((await f.series(f.scoped)).status,200);
    for (const device of [f.d2,f.db,'missing-device']) assert.equal((await f.series(f.scoped,device)).status,404);
    const [tenant] = await as(f.scoped,tx => tx.execute(sql`select app_has_capability(${f.a},'telemetry:read') as allowed`));
    assert.equal(tenant.allowed,false);
    await sqlClient`update role_bindings set resource_type='building',resource_id=${f.a} where id=${f.scopedBinding}`;
    assert.equal((await f.latest(f.scoped)).status,403); assert.deepEqual(await raw(f.scoped),[]);
  }));
  it("denies global private reads and forged app.role while the owner sees stored samples", async () => fixture(async f => {
    for (const user of [f.platform,f.outsider]) {
      assert.equal((await f.latest(user)).status,403); assert.equal((await f.series(user)).status,404);
      assert.deepEqual(await raw(user),[]);
    }
    assert.equal((await sqlClient`select device_id from telemetry where building_id=${f.a}`).length,3);
  }));
  it("publishes only the eight safe water DTO fields and denies resident raw/history", async () => fixture(async f => {
    const rows = await items(await f.latest(f.resident));
    assert.equal(rows.length,2);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(),['device_id','device_name','metric','value','numeric_value','unit','quality','time'].sort());
      assert.equal(row.metric,'water_level_percent'); assert.equal(row.unit,'%');
    }
    const mixed = rows.find(r => r.device_id===f.d1);
    assert.equal(mixed.value,42); assert.equal(mixed.numeric_value,42); assert.equal(mixed.quality,'UNCERTAIN');
    assert.deepEqual(await raw(f.resident),[]);
    assert.equal((await f.series(f.resident)).status,404);
    assert.equal((await f.latest(f.resident,f.b)).status,403);
  }));
  it("keeps raw precedence without duplicates when published and raw scopes overlap", async () => fixture(async f => {
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${f.scoped},${f.a},'RESIDENT')`;
    const rows = await items(await f.latest(f.scoped));
    assert.equal(rows.length,3); assert.equal(new Set(rows.map(r=>r.device_id+':'+r.metric)).size,3);
    assert.deepEqual(rows.find(r=>r.device_id===f.d1&&r.metric==='water_level_percent').value,{secret:'never publish'});
    assert.equal(rows.find(r=>r.device_id===f.d2).value,75);
    assert.equal((await raw(f.scoped)).length,2);
  }));
  it("limits published resource scopes to their exact device and revokes them on the same JWT", async () => fixture(async f => {
    await sqlClient`update role_bindings set resource_type='device',resource_id=${f.d1} where id=${f.residentBinding}`;
    assert.deepEqual((await items(await f.latest(f.resident))).map(r=>r.device_id),[f.d1]);
    assert.equal((await f.series(f.resident)).status,404);
    await sqlClient`update role_bindings set ends_at=now()-interval '1 second' where id=${f.residentBinding}`;
    assert.equal((await f.latest(f.resident)).status,403);
    assert.equal((await as(f.resident,tx=>tx.execute(sql`select * from app_published_water_levels(${f.a})`))).length,0);
  }));
  it("retains live legacy membership compatibility without granting residents raw reads", async () => fixture(async f => {
    await sqlClient`delete from role_bindings where id=${f.directBinding} or id=${f.residentBinding}`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${f.direct},${f.a},'BUILDING_ADMIN'),(${f.resident},${f.a},'RESIDENT')`;
    assert.equal((await items(await f.latest(f.direct))).length,3); assert.equal((await raw(f.direct)).length,3);
    assert.equal((await items(await f.latest(f.resident))).length,2); assert.deepEqual(await raw(f.resident),[]);
    for (const change of ['inactive','expired','future']) {
      if(change==='inactive') await sqlClient`update memberships set active=false where user_id=${f.direct}`;
      if(change==='expired') await sqlClient`update memberships set ends_at=now()-interval '1 second' where user_id=${f.direct}`;
      if(change==='future') await sqlClient`update memberships set starts_at=now()+interval '1 hour' where user_id=${f.direct}`;
      assert.equal((await f.latest(f.direct)).status,403,change); assert.deepEqual(await raw(f.direct),[]);
      await sqlClient`update memberships set active=true,starts_at=null,ends_at=null where user_id=${f.direct}`;
    }
  }));
  it("uses valid telemetry-only support grants without devices:read", async () => fixture(async f => {
    const grant = randomUUID();
    assert.equal((await f.latest(f.support)).status,403);
    await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${grant},${f.a},${f.support},'telemetry:read','device',${f.d1},'Authorized diagnosis',now()+interval '1 hour',${f.platform})`;
    assert.equal((await items(await f.latest(f.support))).length,2);
    assert.equal((await f.series(f.support)).status,200);
    const [row] = await as(f.support,tx=>tx.execute(sql`select app_has_capability(${f.a},'devices:read','device',${f.d1}) as allowed`)); assert.equal(row.allowed,false);
    for (const kind of ['revoked','expired','role']) {
      if(kind==='revoked') await sqlClient`update support_grants set revoked_at=now() where id=${grant}`;
      if(kind==='expired') await sqlClient`update support_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${grant}`;
      if(kind==='role') await sqlClient`update role_bindings set active=false where id=${f.supportBinding}`;
      assert.equal((await f.latest(f.support)).status,403,kind); assert.deepEqual(await raw(f.support),[],kind);
      await sqlClient`update support_grants set revoked_at=null,created_at=now(),expires_at=now()+interval '1 hour' where id=${grant}`;
    }
  }));
  it("rechecks account, organization, building, team, binding, membership windows and roles on the same JWT", async () => fixture(async f => {
    const mutations = [
      () => sqlClient`update role_bindings set active=false where id=${f.teamBinding}`,
      () => sqlClient`update role_bindings set ends_at=now()-interval '1 second' where id=${f.teamBinding}`,
      () => sqlClient`update role_bindings set starts_at=now()+interval '1 hour' where id=${f.teamBinding}`,
      () => sqlClient`update teams set active=false where id=${f.team}`,
      () => sqlClient`update team_members set active=false where team_id=${f.team}`,
      () => sqlClient`update team_members set ends_at=now()-interval '1 second' where team_id=${f.team}`,
      () => sqlClient`update team_members set starts_at=now()+interval '1 hour' where team_id=${f.team}`,
      () => sqlClient`update buildings set active=false where id=${f.a}`,
      () => sqlClient`update organizations set active=false where id=${f.org}`,
    ];
    for (const change of mutations) {
      await change(); assert.equal((await f.latest(f.worker)).status,403); assert.deepEqual(await raw(f.worker),[]);
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.teamBinding}`;
      await sqlClient`update teams set active=true where id=${f.team}`;
      await sqlClient`update team_members set active=true,starts_at=null,ends_at=null where team_id=${f.team}`;
      await sqlClient`update buildings set active=true where id=${f.a}`; await sqlClient`update organizations set active=true where id=${f.org}`;
    }
    await sqlClient`update users set active=false where id=${f.worker}`;
    assert.equal((await f.latest(f.worker)).status,401); assert.deepEqual(await raw(f.worker),[]);
    const [role] = await sqlClient`select active from roles where key='MAINTENANCE'`;
    try { await sqlClient`update roles set active=false where key='MAINTENANCE'`; assert.deepEqual(await raw(f.scoped),[]); assert.equal((await f.latest(f.scoped)).status,403); }
    finally { await sqlClient`update roles set active=${role.active} where key='MAINTENANCE'`; }
  }));
  it("returns empty for authorized scopes without samples and denies discovery-only scopes", async () => fixture(async f => {
    await sqlClient`delete from telemetry where building_id=${f.a}`;
    for(const user of [f.direct,f.worker,f.scoped,f.resident]) assert.deepEqual(await items(await f.latest(user)),[]);
    await sqlClient`update role_bindings set resource_type='building',resource_id=${f.a} where id=${f.scopedBinding}`;
    assert.equal((await f.request(f.scoped,`/buildings/${f.a}`)).status,200);
    assert.equal((await f.latest(f.scoped)).status,403);
    await sqlClient`delete from devices where building_id=${f.a}`;
    assert.deepEqual(await items(await f.latest(f.direct)),[]); assert.deepEqual(await items(await f.latest(f.resident)),[]);
  }));
  it("discovery through devices:read alone grants neither telemetry capability", async () => fixture(async f => {
    await sqlClient`insert into support_grants(building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${f.a},${f.support},'devices:read','device',${f.d1},'Inventory only',now()+interval '1 hour',${f.platform})`;
    assert.equal((await f.request(f.support,`/buildings/${f.a}`)).status,200);
    assert.equal((await f.latest(f.support)).status,403); assert.equal((await f.series(f.support)).status,404);
    assert.deepEqual(await raw(f.support),[]);
    await assert.rejects(sqlClient`insert into support_grants(building_id,support_user_id,capability,reason,expires_at,granted_by) values(${f.a},${f.support},'telemetry:read-published','Invalid capability',now()+interval '1 hour',${f.platform})`);
  }));
  it("inactive telemetry permissions remove technical access without removing published water", async () => fixture(async f => {
    const [permission] = await sqlClient`select active from permissions where key='telemetry:read'`;
    try {
      await sqlClient`update permissions set active=false where key='telemetry:read'`;
      assert.deepEqual(await raw(f.worker),[]); assert.equal((await f.series(f.worker)).status,404);
      const rows = await items(await f.latest(f.worker)); assert.equal(rows.length,2); assert.ok(rows.every(r=>r.metric==='water_level_percent'));
    } finally { await sqlClient`update permissions set active=${permission.active} where key='telemetry:read'`; }
  }));
  it("sanitizes nonfinite, out-of-range and adversarial JSON publication from numeric_value", async () => fixture(async f => {
    for (const value of ['NaN','Infinity','-Infinity','-1','101','0','100']) {
      await sqlClient`update telemetry set numeric_value=${value}::double precision,value='{"credentials":"private","value":88}'::jsonb,quality='BAD' where building_id=${f.a} and device_id=${f.d1} and metric='water_level_percent'`;
      const [row] = await as(f.resident,tx=>tx.execute(sql`select * from app_published_water_levels(${f.a}) where device_id=${f.d1}`));
      const expected = value==='0'?0:value==='100'?100:null;
      assert.equal(row.value,expected,value); assert.equal(row.numeric_value,expected,value); assert.equal(row.quality,'BAD'); assert.equal(row.unit,'%');
    }
    await sqlClient`update telemetry set numeric_value=null,value='100'::jsonb where device_id=${f.d1}`;
    const rows = await items(await f.latest(f.resident)); assert.equal(rows.find(r=>r.device_id===f.d1).value,null);
  }));
  it("filters current feature states on mixed devices while retaining authorized raw history", async () => fixture(async f => {
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
    assert.deepEqual(await items(await f.latest(f.resident)),[]);
    const rawRows = await items(await f.latest(f.worker)); assert.deepEqual(rawRows.map(r=>r.metric),['energy_total_kwh']);
    assert.equal((await f.series(f.worker)).status,403); assert.equal((await raw(f.worker)).length,3);
    assert.equal((await as(f.resident,tx=>tx.execute(sql`select * from app_published_water_levels(${f.a})`))).length,0);
    await sqlClient`update building_feature_settings set enabled=true where building_id=${f.a} and feature_key='WATER_TANK'`;
    await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'WATER_TANK',now())`;
    assert.deepEqual(await items(await f.latest(f.resident)),[]);
    await sqlClient`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value) values(now()+interval '1 second',${randomUUID()},${f.a},${f.d1},'water_level_percent','33',33)`;
    assert.equal((await items(await f.latest(f.resident))).length,1);
    assert.equal((await items(await f.latest(f.worker))).length,2);
    // Timescale cannot move a row between time chunks through UPDATE.
    await sqlClient`delete from telemetry where device_id=${f.d1} and numeric_value=33`;
    await sqlClient`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value) values(now()-interval '8 days',${randomUUID()},${f.a},${f.d1},'water_level_percent','33',33)`;
    assert.deepEqual(await items(await f.latest(f.resident)),[]);
  }));
  it("enforces local pause and resume when only buildings:read is independently revoked", async () => fixture(async f => {
    const [permission] = await sqlClient`select active from permissions where key='buildings:read'`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
    try {
      await sqlClient`update permissions set active=false where key='buildings:read'`;
      const [scope] = await as(f.scoped,tx=>tx.execute(sql`select app_can_discover_building(${f.a}) as discovery,app_has_capability(${f.a},'telemetry:read','device',${f.d1}) as technical`));
      assert.equal(scope.discovery,false); assert.equal(scope.technical,true);
      assert.deepEqual((await items(await f.latest(f.scoped))).map(r=>r.metric),['energy_total_kwh']);
      assert.equal((await f.series(f.scoped)).status,403);
      assert.deepEqual(await items(await f.latest(f.resident)),[]);
      await sqlClient`update building_feature_settings set enabled=true where building_id=${f.a} and feature_key='WATER_TANK'`;
      await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'WATER_TANK',now())`;
      assert.deepEqual((await items(await f.latest(f.scoped))).map(r=>r.metric),['energy_total_kwh']);
      assert.deepEqual(await items(await f.latest(f.resident)),[]);
      await sqlClient`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value) values(now()+interval '1 second',${randomUUID()},${f.a},${f.d1},'water_level_percent','60',60)`;
      assert.equal((await items(await f.latest(f.scoped))).length,2); assert.equal((await items(await f.latest(f.resident))).length,1);
    } finally { await sqlClient`update permissions set active=${permission.active} where key='buildings:read'`; }
  }));
  it("checks both tenant and device in unfiltered RLS even for inconsistent owner fixtures", async () => fixture(async f => {
    await sqlClient`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value) values(now(),${randomUUID()},${f.b},${f.d1},'temperature_c','5',5),(now(),${randomUUID()},${f.a},${f.db},'temperature_c','6',6)`;
    const rows = await raw(f.worker); assert.equal(rows.length,3); assert.ok(rows.every(r=>r.building_id===f.a&&r.device_id!==f.db));
    assert.equal((await raw(f.scoped)).length,2);
  }));
  it("retains series aggregate, date and bucket contracts after device authorization", async () => fixture(async f => {
    const response = await f.request(f.scoped,`/telemetry/series?deviceId=${f.d1}&metric=water_level_percent&bucket=1d&from=2020-01-01&to=2030-01-01`);
    assert.equal(response.status,200); const body = await response.json();
    assert.equal(body.bucket,'1d'); assert.equal(body.deviceId,f.d1); assert.equal(body.metric,'water_level_percent');
    assert.equal(body.from,'2020-01-01T00:00:00.000Z'); assert.equal(body.to,'2030-01-01T00:00:00.000Z');
    assert.equal(body.items.length,1); assert.equal(body.items[0].avg_value,42); assert.equal(body.items[0].min_value,42); assert.equal(body.items[0].max_value,42); assert.equal(Number(body.items[0].samples),1);
    for (const invalid of ['bucket=1s','from=invalid']) assert.equal((await f.request(f.scoped,`/telemetry/series?deviceId=${f.d1}&metric=water_level_percent&${invalid}`)).status,400);
  }));
  it("uses safe gate and parking classifications without SELECT access to device configuration", async () => fixture(async f => {
    const gateway = `tel-gateway-${randomUUID()}`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number) values(${gateway},${f.a},'Gateway',${gateway})`;
    await sqlClient`update devices set type='GATE_CONTROLLER',gateway_id=${gateway} where id=${f.d1}`;
    await sqlClient`update devices set type='PARKING_SENSOR' where id=${f.d2}`;
    await sqlClient`insert into gates(building_id,name,kind,gateway_id,device_id) values(${f.a},'Garage','GARAGE',${gateway},${f.d1})`;
    await sqlClient`insert into parking_lots(building_id,vehicle_type,capacity,sensor_id) values(${f.a},'MOTORCYCLE',10,${f.d2})`;
    await sqlClient`delete from telemetry where building_id=${f.a}`;
    await sqlClient`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value) values(now(),${randomUUID()},${f.a},${f.d1},'state','true',null),(now(),${randomUUID()},${f.a},${f.d2},'parking_occupied','2',2)`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'PEDESTRIAN_ACCESS',false),(${f.a},'CAR_PARKING',false)`;
    // New local roles resolve to the legacy RESIDENT context; configuration's
    // legacy app.role policy remains outside this telemetry migration.
    assert.equal((await withUserContext({userId:f.worker,role:'RESIDENT'},tx=>tx.execute(sql`select id from devices`))).length,0);
    assert.equal((await items(await f.latest(f.worker))).length,2);
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'GARAGE_ACCESS',false)`;
    assert.deepEqual((await items(await f.latest(f.worker))).map(r=>r.device_id),[f.d2]);
    assert.equal((await f.series(f.worker,f.d1,'state')).status,403);
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'MOTORCYCLE_PARKING',false)`;
    assert.deepEqual(await items(await f.latest(f.worker)),[]);
    assert.equal((await f.series(f.worker,f.d2,'parking_occupied')).status,403);
  }));
  it("exposes only minimal device projection and restricts helpers and app writes", async () => fixture(async f => {
    const rows = await as(f.scoped,tx=>tx.execute(sql`select * from app_telemetry_authorized_devices(null)`));
    assert.equal(rows.length,1); assert.deepEqual(Object.keys(rows[0]).sort(),['building_id','device_id','device_name','device_type','gate_kind','parking_vehicle_type'].sort());
    assert.equal((await as(f.scoped,tx=>tx.execute(sql`select * from app_telemetry_authorized_devices(${f.b})`))).length,0);
    assert.equal((await as(f.scoped,tx=>tx.execute(sql`select * from app_telemetry_authorized_devices(null,'devices:read')`))).length,0);
    const [state] = await as(f.scoped,tx=>tx.execute(sql`select app_telemetry_can_read_feature_state(${f.a}) as own,app_telemetry_can_read_feature_state(${f.b}) as foreign`));
    assert.equal(state.own,true); assert.equal(state.foreign,false);
    await assert.rejects(as(f.scoped,tx=>tx.execute(sql`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'SMOKE',false)`)));
    for (const signature of ['app_telemetry_authorized_devices(text,text)','app_published_water_levels(text)','app_telemetry_can_read_feature_state(text)']) {
      const [row] = await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner) as owner,pg_get_userbyid(c.proowner) as capability_owner,
        has_function_privilege('predioon_app',p.oid,'EXECUTE') as app_execute,has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity_execute,
        has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker_execute,
        exists(select 1 from aclexplode(p.proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute
        from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      assert.equal(row.prosecdef,true); assert.equal(row.provolatile,'s'); assert.equal(row.owner,row.capability_owner);
      assert.equal(row.app_execute,true); assert.equal(row.identity_execute,false); assert.equal(row.broker_execute,false); assert.equal(row.public_execute,false);
      assert.ok(row.proconfig.includes('search_path=public, pg_temp'));
    }
    const [privileges] = await sqlClient`select has_table_privilege('predioon_app','telemetry','INSERT') as insert,has_table_privilege('predioon_app','telemetry','UPDATE') as update,has_table_privilege('predioon_app','telemetry','DELETE') as delete`;
    assert.deepEqual({...privileges},{insert:false,update:false,delete:false});
    await assert.rejects(as(f.direct,tx=>tx.execute(sql`insert into telemetry(time,event_id,building_id,device_id,metric,value) values(now(),${randomUUID()},${f.a},${f.d1},'water_level_percent','99')`)));
  }));
  it("evaluates authorized device scope once per query across about a thousand samples", async () => fixture(async f => {
    await sqlClient`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value) select now()-n*interval '1 second',gen_random_uuid()::text,${f.a},${f.d1},'temperature_c','20'::jsonb,20 from generate_series(1,1000) n`;
    const result = await as(f.scoped,tx=>tx.execute(sql`explain (analyze,format json) select device_id from telemetry`));
    const plan = (result[0]['QUERY PLAN'] as any)[0].Plan;
    const helpers: any[] = [];
    function visit(node: any) { if(node['Function Name']==='app_telemetry_authorized_devices') helpers.push(node); for(const child of node.Plans??[]) visit(child); }
    visit(plan); assert.equal(helpers.length,1); assert.equal(helpers[0]['Actual Loops'],1);
    assert.equal(plan['Actual Rows'],1002);
  }));
  it("keeps SQL and shared published catalogue additive for exactly the four local roles", async () => {
    assert.ok(CAPABILITIES.includes('telemetry:read-published' as any));
    assert.ok(!SUPPORT_CAPABILITIES.includes('telemetry:read-published' as any));
    for(const [role,caps] of Object.entries(ROLE_CAPABILITIES)) {
      const rows = await sqlClient`select permission_key from role_permissions where role_key=${role} order by permission_key`;
      assert.deepEqual(rows.map(r=>r.permission_key),[...caps].sort(),role);
      assert.equal(caps.includes('telemetry:read-published' as any),!role.startsWith('PLATFORM_'));
    }
  });
});
