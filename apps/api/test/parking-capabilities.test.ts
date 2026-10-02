import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { appDb, closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

describe("parking capabilities preserve tenant, count freshness and sensor scope", () => {
  let server: TestServer, passwordHash: string;
  const ownedPermissions: string[] = [];
  before(async () => {
    passwordHash = await hashPassword("predioon123");
    server = await startTestServer();
    // A pre-migration fixture needs catalogue rows, not permissive production policies.
    for (const action of ["read", "manage"]) {
      const key = "parking:" + action;
      const rows =
        await sqlClient`insert into permissions(key,resource_type,action,label) values(${key},'parking',${action},${key}) on conflict(key) do nothing returning key`;
      ownedPermissions.push(...rows.map((row) => row.key));
    }
  });
  after(async () => {
    await server?.close();
    if (ownedPermissions.length)
      await sqlClient`delete from permissions where key in ${sqlClient(ownedPermissions)}`;
    await closeAppDb();
    await sqlClient.end();
  });

  type Kind =
    | "manager"
    | "reader"
    | "worker"
    | "device"
    | "exact"
    | "legacy"
    | "resident"
    | "platform"
    | "flag"
    | "support"
    | "technical"
    | "action"
    | "outsider";
  type Fixture = {
    org: string;
    a: string;
    b: string;
    d1: string;
    d2: string;
    foreignDevice: string;
    gateway: string;
    foreignGateway: string;
    car: string;
    motorcycle: string;
    foreign: string;
    team: string;
    binding: string;
    deviceBinding: string;
    ids: Record<Kind, string>;
    roles: Record<"manager" | "reader" | "action" | "technical", string>;
    request: (
      user: string,
      path: string,
      method?: string,
      body?: unknown,
    ) => Promise<Response>;
    list: (user?: string, building?: string) => Promise<Response>;
  };
  async function fixture(run: (f: Fixture) => Promise<void>) {
    const suffix = randomUUID(),
      org = `parking-cap-org-${suffix}`,
      a = `parking-cap-a-${suffix}`,
      b = `parking-cap-b-${suffix}`;
    const d1 = `parking-d1-${suffix}`,
      d2 = `parking-d2-${suffix}`,
      foreignDevice = `parking-foreign-${suffix}`;
    const gateway = `parking-gw-${suffix}`,
      foreignGateway = `parking-gwb-${suffix}`;
    const kinds: Kind[] = [
      "manager",
      "reader",
      "worker",
      "device",
      "exact",
      "legacy",
      "resident",
      "platform",
      "flag",
      "support",
      "technical",
      "action",
      "outsider",
    ];
    const ids = Object.fromEntries(
      kinds.map((kind) => [kind, `parking-${kind}-${suffix}`]),
    ) as Fixture["ids"];
    const roles = {
      manager: `PARKING_MANAGER_${suffix}`,
      reader: `PARKING_READER_${suffix}`,
      action: `PARKING_ACTION_${suffix}`,
      technical: `PARKING_TECHNICAL_${suffix}`,
    };
    const team = randomUUID(),
      binding = randomUUID(),
      deviceBinding = randomUUID(),
      car = randomUUID(),
      motorcycle = randomUUID(),
      foreign = randomUUID();
    const tokens = new Map<string, string>();
    const request: Fixture["request"] = (user, path, method = "GET", body) =>
      call(server.url, path, { token: tokens.get(user), method, body });
    const list = (user = ids.manager, building = a) =>
      request(user, "/parking?buildingId=" + building);
    try {
      await sqlClient`insert into organizations(id,name,slug) values(${org},'Parking capabilities',${org})`;
      for (const building of [a, b])
        await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},${building},${building})`;
      for (const [kind, id] of Object.entries(ids))
        await sqlClient`insert into users(id,name,email,password_hash,is_platform_admin) values(${id},${kind},${id + "@parking.test"},${passwordHash},${kind === "flag"})`;
      for (const role of Object.values(roles))
        await sqlClient`insert into roles(key,scope,label) values(${role},'BUILDING',${role})`;
      await sqlClient`insert into role_permissions(role_key,permission_key) values(${roles.manager},'parking:read'),(${roles.manager},'parking:manage'),(${roles.reader},'parking:read'),(${roles.action},'parking:manage'),(${roles.technical},'devices:read'),(${roles.technical},'devices:configure'),(${roles.technical},'telemetry:read')`;
      await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Parking team')`;
      await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${ids.worker})`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${binding},${ids.manager},${a},${roles.manager})`;
      await sqlClient`insert into role_bindings(team_id,building_id,role_key) values(${team},${a},${roles.manager})`;
      for (const kind of ["reader", "action", "technical"] as const)
        await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${ids[kind]},${a},${roles[kind]})`;
      await sqlClient`insert into role_bindings(user_id,role_key) values(${ids.platform},'PLATFORM_ADMIN'),(${ids.support},'PLATFORM_SUPPORT')`;
      await sqlClient`insert into memberships(user_id,building_id,role) values(${ids.legacy},${a},'BUILDING_ADMIN'),(${ids.legacy},${b},'RESIDENT'),(${ids.resident},${a},'RESIDENT')`;
      await sqlClient`insert into gateways(id,building_id,name,serial_number) values(${gateway},${a},'Local gateway',${gateway}),(${foreignGateway},${b},'Foreign gateway',${foreignGateway})`;
      await sqlClient`insert into devices(id,building_id,gateway_id,name,type,metadata) values(${d1},${a},${gateway},'Car sensor','PARKING_SENSOR','{"private":"sensor secret"}'),(${d2},${a},null,'Free sensor','PARKING_SENSOR','{}'),(${foreignDevice},${b},${foreignGateway},'Foreign sensor','PARKING_SENSOR','{}')`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${deviceBinding},${ids.device},${a},${roles.manager},'device',${d1})`;
      await sqlClient`insert into parking_lots(id,building_id,vehicle_type,capacity,sensor_id) values(${car},${a},'CAR',20,${d1}),(${motorcycle},${a},'MOTORCYCLE',8,null),(${foreign},${b},'CAR',30,${foreignDevice})`;
      for (const id of Object.values(ids))
        tokens.set(
          id,
          (await login(server.url, id + "@parking.test")).accessToken,
        );
      await run({
        org,
        a,
        b,
        d1,
        d2,
        foreignDevice,
        gateway,
        foreignGateway,
        car,
        motorcycle,
        foreign,
        team,
        binding,
        deviceBinding,
        ids,
        roles,
        request,
        list,
      });
    } finally {
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(Object.values(ids))}`;
      await sqlClient`delete from buildings where organization_id=${org}`;
      await sqlClient`delete from organizations where id=${org}`;
      await sqlClient`delete from users where id in ${sqlClient(Object.values(ids))}`;
      await sqlClient`delete from roles where key in ${sqlClient(Object.values(roles))}`;
    }
  }
  const as = <T>(
    userId: string,
    run: Parameters<typeof withUserContext<T>>[1],
  ) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);
  const occupancy = (
    f: Fixture,
    user = f.ids.manager,
    version = 1,
    id = f.car,
  ) =>
    f.request(user, `/parking/${id}/occupancy`, "PATCH", {
      occupied: 3,
      version,
    });
  const edit = (
    f: Fixture,
    user = f.ids.manager,
    sensorId: string | null = f.d1,
    version = 1,
    id = f.car,
  ) =>
    f.request(user, `/parking/${id}`, "PATCH", {
      capacity: 25,
      sensorId,
      staleAfterSeconds: 300,
      version,
    });
  async function data(response: Response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    assert.equal(response.headers.get("cache-control"), "no-store");
    return body;
  }

  it("allows current direct and team parking grants without a legacy membership or inventory grant", async () =>
    fixture(async (f) => {
      for (const user of [f.ids.manager, f.ids.worker]) {
        assert.deepEqual(
          (await data(await f.list(user))).items.map((r: any) => r.id),
          [f.car, f.motorcycle],
        );
        assert.equal(
          (await edit(f, user, f.d1, user === f.ids.manager ? 1 : 2)).status,
          200,
        );
        assert.equal(
          (
            await as(user, (tx) =>
              tx.execute(sql`select id from devices where building_id=${f.a}`),
            )
          ).length,
          0,
        );
      }
      assert.equal((await data(await f.list(f.ids.reader))).items.length, 2);
      assert.equal((await occupancy(f, f.ids.reader)).status, 403);
      assert.equal((await f.list(f.ids.manager, f.b)).status, 403);
    }));
  it("denies global flag and unrelated grants through HTTP and unfiltered RLS", async () =>
    fixture(async (f) => {
      for (const user of [
        f.ids.flag,
        f.ids.platform,
        f.ids.support,
        f.ids.technical,
        f.ids.action,
        f.ids.outsider,
      ]) {
        assert.equal((await f.list(user)).status, 403, user);
        assert.equal(
          (await as(user, (tx) => tx.execute(sql`select id from parking_lots`)))
            .length,
          0,
        );
        assert.equal((await occupancy(f, user)).status, 404);
      }
      assert.equal(
        (await occupancy(f, f.ids.legacy, 1, f.foreign)).status,
        403,
      );
    }));
  it("denies runtime DELETE and immutable identity writes even for a legacy manager", async () =>
    fixture(async (f) => {
      await assert.rejects(
        as(f.ids.legacy, (tx) =>
          tx.execute(sql`delete from parking_lots where id=${f.car}::uuid`),
        ),
        (e) => pgErrorCode(e) === "42501",
      );
      for (const assignment of [
        sql`id=${randomUUID()}::uuid`,
        sql`building_id=${f.b}`,
        sql`vehicle_type='MOTORCYCLE'`,
        sql`created_at=clock_timestamp()`,
      ]) {
        await assert.rejects(
          as(f.ids.legacy, (tx) =>
            tx.execute(
              sql`update parking_lots set ${assignment} where id=${f.car}::uuid`,
            ),
          ),
          (e) => pgErrorCode(e) === "42501",
        );
      }
      assert.equal(
        (await sqlClient`select id from parking_lots where id=${f.car}`).length,
        1,
      );
    }));
  const exact = (f: Fixture) =>
    sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.ids.exact},${f.a},${f.roles.manager},'parking',${f.car})`;
  it("uses only the real exact parking or device and does not broaden a grant on retarget", async () =>
    fixture(async (f) => {
      await exact(f);
      for (const user of [f.ids.device, f.ids.exact]) {
        assert.deepEqual(
          (await data(await f.list(user))).items.map((row: any) => row.id),
          [f.car],
        );
        assert.equal((await edit(f, user, null)).status, 403);
        assert.equal((await edit(f, user, f.d2)).status, 403);
        assert.equal((await occupancy(f, user, 1, f.motorcycle)).status, 404);
      }
      const changed = await data(await edit(f, f.ids.exact));
      assert.equal(changed.sensorId, f.d1);
      await data(await edit(f, f.ids.manager, f.d2, changed.version));
      assert.equal((await occupancy(f, f.ids.device)).status, 404);
      assert.equal(
        (await data(await f.list(f.ids.exact))).items[0].sensorId,
        f.d2,
      );
      for (const id of ["bad-uuid", randomUUID()])
        assert.equal((await occupancy(f, f.ids.manager, 1, id)).status, 404);
    }));
  it("creates on an authorized target with defaults while keeping private columns immutable", async () =>
    fixture(async (f) => {
      await sqlClient`delete from parking_lots where building_id=${f.a}`;
      const create = (
        user: string,
        sensorId: string | null,
        extra: object = {},
      ) =>
        f.request(user, "/parking", "POST", {
          buildingId: f.a,
          vehicleType: "CAR",
          capacity: 20,
          sensorId,
          ...extra,
        });
      for (const sensor of [null, f.d2, f.foreignDevice])
        assert.equal((await create(f.ids.device, sensor)).status, 403);
      for (const extra of [
        { id: randomUUID() },
        { createdAt: new Date().toISOString() },
        { occupied: 4 },
        { version: 7 },
        { unknown: true },
      ])
        assert.equal((await create(f.ids.manager, f.d1, extra)).status, 400);
      const created = await data(await create(f.ids.device, f.d1), 201);
      assert.equal(created.source, "UNKNOWN");
      assert.equal(created.available, null);
      assert.equal(created.version, 1);
      assert.equal(created.staleAfterSeconds, 300);
      assert.equal((await create(f.ids.device, f.d1)).status, 409);
      assert.equal(
        (
          await f.request(f.ids.manager, "/parking", "POST", {
            buildingId: f.a,
            vehicleType: "MOTORCYCLE",
            capacity: 8,
          })
        ).status,
        201,
      );
    }));
  it("retains manual counts on unchanged sensors and clears observations when the sensor changes", async () =>
    fixture(async (f) => {
      const first = await data(await occupancy(f));
      assert.equal(first.available, 17);
      assert.equal(first.status, "CURRENT");
      assert.equal(first.source, "MANUAL");
      const unchanged = await data(
        await edit(f, f.ids.manager, f.d1, first.version),
      );
      assert.equal(unchanged.occupied, 3);
      assert.equal(unchanged.observedAt, first.observedAt);
      const changed = await data(
        await edit(f, f.ids.manager, f.d2, unchanged.version),
      );
      assert.equal(changed.occupied, null);
      assert.equal(changed.observedAt, null);
      assert.equal(changed.source, "UNKNOWN");
      assert.equal(changed.available, null);
      assert.equal(
        (await occupancy(f, f.ids.manager, first.version)).status,
        409,
      );
      assert.equal(
        (
          await f.request(f.ids.manager, `/parking/${f.car}`, "PATCH", {
            capacity: 2,
            sensorId: f.d2,
            version: changed.version,
            buildingId: f.b,
          })
        ).status,
        400,
      );
    }));
  it("serializes occupancy versions and respects capacity instead of retrying an old command", async () =>
    fixture(async (f) => {
      const responses = await Promise.all([occupancy(f), occupancy(f)]);
      assert.deepEqual(responses.map((row) => row.status).sort(), [200, 409]);
      assert.equal(
        (
          await sqlClient`select id from audit_logs where resource_id=${f.car} and action='PARKING_OCCUPANCY_UPDATED'`
        ).length,
        1,
      );
      for (const occupied of [-1, 1.5, 21])
        assert.equal(
          (
            await f.request(
              f.ids.manager,
              `/parking/${f.car}/occupancy`,
              "PATCH",
              { occupied, version: 2 },
            )
          ).status,
          400,
        );
      assert.equal(
        (
          await f.request(f.ids.manager, `/parking/${f.car}`, "PATCH", {
            capacity: 2,
            sensorId: f.d1,
            version: 2,
          })
        ).status,
        400,
      );
    }));
  it("keeps disabled hardware readable and manually countable but not configurable as an active sensor", async () =>
    fixture(async (f) => {
      await sqlClient`update devices set enabled=false where id=${f.d1}`;
      await sqlClient`update gateways set enabled=false where id=${f.gateway}`;
      assert.equal((await data(await f.list(f.ids.device))).items.length, 1);
      const manual = await data(await occupancy(f, f.ids.device));
      assert.equal(manual.source, "MANUAL");
      assert.equal(
        (await edit(f, f.ids.device, f.d1, manual.version)).status,
        400,
      );
      await sqlClient`update devices set gateway_id=${f.foreignGateway} where id=${f.d1}`;
      assert.equal((await f.list(f.ids.device)).status, 403);
      assert.equal(
        (
          await as(f.ids.manager, (tx) =>
            tx.execute(
              sql`select id from parking_lots where id=${f.car}::uuid`,
            ),
          )
        ).length,
        0,
      );
      assert.equal((await occupancy(f)).status, 404);
    }));
  it("enforces separate car and motorcycle feature pauses with parking-only grants and a fresh resume", async () =>
    fixture(async (f) => {
      await data(await occupancy(f));
      await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'CAR_PARKING',false)`;
      assert.deepEqual(
        (await data(await f.list())).items.map((row: any) => row.id),
        [f.motorcycle],
      );
      const denied = await occupancy(f, f.ids.manager, 2);
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).details.code, "FEATURE_DISABLED");
      await data(await occupancy(f, f.ids.manager, 1, f.motorcycle));
      await sqlClient`update building_feature_settings set enabled=true where building_id=${f.a} and feature_key='CAR_PARKING'`;
      await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'CAR_PARKING',clock_timestamp()) on conflict(building_id,feature_key) do update set resumed_at=excluded.resumed_at`;
      const car = (await data(await f.list())).items.find(
        (row: any) => row.id === f.car,
      );
      assert.equal(car.status, "UNKNOWN");
      assert.equal(car.occupied, null);
      assert.equal(
        (await data(await occupancy(f, f.ids.manager, 2))).status,
        "CURRENT",
      );
    }));
  it("revalidates person team account and tenant lifecycle with the same access token", async () =>
    fixture(async (f) => {
      for (const [disable, restore, user] of [
        [
          () =>
            sqlClient`update role_bindings set active=false where id=${f.binding}`,
          () =>
            sqlClient`update role_bindings set active=true where id=${f.binding}`,
          f.ids.manager,
        ],
        [
          () => sqlClient`update teams set active=false where id=${f.team}`,
          () => sqlClient`update teams set active=true where id=${f.team}`,
          f.ids.worker,
        ],
        [
          () =>
            sqlClient`update team_members set ends_at=clock_timestamp()-interval '1 second' where team_id=${f.team}`,
          () =>
            sqlClient`update team_members set ends_at=null where team_id=${f.team}`,
          f.ids.worker,
        ],
        [
          () =>
            sqlClient`update organizations set active=false where id=${f.org}`,
          () =>
            sqlClient`update organizations set active=true where id=${f.org}`,
          f.ids.manager,
        ],
        [
          () => sqlClient`update buildings set active=false where id=${f.a}`,
          () => sqlClient`update buildings set active=true where id=${f.a}`,
          f.ids.manager,
        ],
        [
          () =>
            sqlClient`update roles set active=false where key=${f.roles.manager}`,
          () =>
            sqlClient`update roles set active=true where key=${f.roles.manager}`,
          f.ids.manager,
        ],
        [
          () =>
            sqlClient`update permissions set active=false where key='parking:read'`,
          () =>
            sqlClient`update permissions set active=true where key='parking:read'`,
          f.ids.manager,
        ],
        [
          () =>
            sqlClient`update users set active=false where id=${f.ids.manager}`,
          () =>
            sqlClient`update users set active=true where id=${f.ids.manager}`,
          f.ids.manager,
        ],
      ] as const) {
        assert.equal((await f.list(user)).status, 200);
        try {
          await disable();
          assert.ok([401, 403].includes((await f.list(user)).status));
          assert.equal(
            (
              await as(user, (tx) =>
                tx.execute(sql`select id from parking_lots`),
              )
            ).length,
            0,
          );
        } finally {
          await restore();
        }
      }
      await sqlClient`delete from parking_lots where building_id=${f.a}`;
      assert.deepEqual((await data(await f.list())).items, []);
    }));
  it("prevents raw SQL retarget and forged audits and clears old observations at the database boundary", async () =>
    fixture(async (f) => {
      await exact(f);
      for (const user of [f.ids.exact, f.ids.device])
        for (const sensor of [null, f.d2])
          await assert.rejects(
            as(user, (tx) =>
              tx.execute(
                sql`update parking_lots set sensor_id=${sensor} where id=${f.car}::uuid`,
              ),
            ),
            (e) => pgErrorCode(e) === "42501",
          );
      await data(await occupancy(f));
      await as(f.ids.manager, (tx) =>
        tx.execute(
          sql`update parking_lots set sensor_id=${f.d2} where id=${f.car}::uuid`,
        ),
      );
      const [row] =
        await sqlClient`select occupied,observed_at,source from parking_lots where id=${f.car}`;
      assert.deepEqual(
        { ...row },
        { occupied: null, observed_at: null, source: "UNKNOWN" },
      );
      for (const action of ["PARKING_CONFIGURED", "PARKING_OCCUPANCY_UPDATED"])
        for (const [user, target] of [
          [f.ids.reader, f.car],
          [f.ids.manager, f.foreign],
          [f.ids.manager, "bad-uuid"],
        ])
          await assert.rejects(
            as(user!, (tx) =>
              tx.execute(
                sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${f.a},${user!},${action},'parking',${target!})`,
              ),
            ),
            (e) => pgErrorCode(e) === "42501",
          );
    }));
  for (const kind of [
    "person-revoke",
    "person-expire",
    "team-revoke",
    "team-expire",
    "manage-revoke",
  ] as const)
    it(`rechecks ${kind} after a real parking lock wait without mutation or audit`, async () =>
      fixture(async (f) => {
        const before =
            await sqlClient`select to_jsonb(p) as row from parking_lots p where id=${f.car}`,
          team = kind.startsWith("team");
        const response = await locked(
          f,
          () => occupancy(f, team ? f.ids.worker : f.ids.manager),
          async () => {
            if (kind === "manage-revoke")
              await sqlClient`delete from role_permissions where role_key=${f.roles.manager} and permission_key='parking:manage'`;
            else if (kind.endsWith("revoke")) {
              if (team)
                await sqlClient`update team_members set active=false where team_id=${f.team}`;
              else
                await sqlClient`update role_bindings set active=false where id=${f.binding}`;
            } else {
              const [row] = team
                ? await sqlClient`update team_members set ends_at=clock_timestamp()+interval '0.1 seconds' where team_id=${f.team} returning ends_at::text as boundary`
                : await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '0.1 seconds' where id=${f.binding} returning ends_at::text as boundary`;
              await waitPast(row!.boundary);
            }
          },
        );
        assert.equal(
          response.status,
          kind === "manage-revoke" ? 403 : 404,
          await response.clone().text(),
        );
        assert.deepEqual(
          await sqlClient`select to_jsonb(p) as row from parking_lots p where id=${f.car}`,
          before,
        );
        assert.equal(
          (await sqlClient`select id from audit_logs where building_id=${f.a}`)
            .length,
          0,
        );
      }));
  for (const kind of ["source", "target"] as const)
    it(`rechecks ${kind} authority after a real proposed sensor lock wait`, async () =>
      fixture(async (f) => {
        await exact(f);
        const binding = randomUUID();
        if (kind === "target")
          await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${binding},${f.ids.exact},${f.a},${f.roles.manager},'device',${f.d2})`;
        const before =
          await sqlClient`select to_jsonb(p) as row from parking_lots p where id=${f.car}`;
        const response = await locked(
          f,
          () =>
            edit(
              f,
              kind === "target" ? f.ids.exact : f.ids.device,
              kind === "target" ? f.d2 : f.d1,
            ),
          async () => {
            await sqlClient`update role_bindings set active=false where id=${kind === "target" ? binding : f.deviceBinding}`;
          },
          kind === "target" ? f.d2 : f.d1,
        );
        assert.equal(
          response.status,
          kind === "target" ? 403 : 404,
          await response.clone().text(),
        );
        assert.deepEqual(
          await sqlClient`select to_jsonb(p) as row from parking_lots p where id=${f.car}`,
          before,
        );
        assert.equal(
          (await sqlClient`select id from audit_logs where building_id=${f.a}`)
            .length,
          0,
        );
      }));
  it("preserves an omitted sensor and freshness instead of applying creation defaults during PATCH", async () =>
    fixture(async (f) => {
      await sqlClient`update parking_lots set stale_after_seconds=900 where id=${f.car}`;
      const updated = await data(
        await f.request(f.ids.manager, `/parking/${f.car}`, "PATCH", {
          capacity: 25,
          version: 1,
        }),
      );
      assert.equal(updated.sensorId, f.d1);
      assert.equal(updated.staleAfterSeconds, 900);
    }));
  it("rolls back configuration and occupancy when audit insertion fails without logging private SQL", async (t) =>
    fixture(async (f) => {
      const logger = t.mock.method(console, "error", () => undefined),
        name = "parking_audit_failure_" + randomUUID().replaceAll("-", "");
      await sqlClient.unsafe(
        `create function ${name}() returns trigger language plpgsql as $$ begin if NEW.user_id=TG_ARGV[0] then raise exception 'fixture audit rejection'; end if; return NEW; end $$`,
      );
      await sqlClient.unsafe(
        `create trigger ${name} before insert on audit_logs for each row execute function ${name}('${f.ids.manager}')`,
      );
      try {
        for (const send of [() => edit(f), () => occupancy(f)]) {
          const before =
            await sqlClient`select to_jsonb(p) as row from parking_lots p where building_id=${f.a} order by id`;
          const response = await send();
          assert.equal(response.status, 500);
          assert.ok(
            !(await response.text()).includes("fixture audit rejection"),
          );
          assert.deepEqual(
            await sqlClient`select to_jsonb(p) as row from parking_lots p where building_id=${f.a} order by id`,
            before,
          );
        }
        await sqlClient`delete from parking_lots where id=${f.motorcycle}`;
        assert.equal(
          (
            await f.request(f.ids.manager, "/parking", "POST", {
              buildingId: f.a,
              vehicleType: "MOTORCYCLE",
              capacity: 8,
            })
          ).status,
          500,
        );
        assert.equal(
          (
            await sqlClient`select id from parking_lots where building_id=${f.a}`
          ).length,
          1,
        );
        assert.equal(
          (await sqlClient`select id from audit_logs where building_id=${f.a}`)
            .length,
          0,
        );
        assert.equal(logger.mock.callCount(), 0);
      } finally {
        await sqlClient.unsafe(`drop trigger ${name} on audit_logs`);
        await sqlClient.unsafe(`drop function ${name}()`);
      }
    }));
  it("reapplies only parking and keeps helper ownership ACLs and every earlier resource validator", async () =>
    fixture(async (f) => {
      const migration = await readFile(
          new URL(
            "../../../infrastructure/033-parking-capabilities.sql",
            import.meta.url,
          ),
          "utf8",
        ),
        rollback = new Error("parking migration rollback");
      const strip = (value: string) =>
        value
          .replace(
            /WHEN 'PARKING_(?:CONFIGURED|OCCUPANCY_UPDATED)'::text THEN .*?(?=WHEN |ELSE)/gs,
            "",
          )
          .replace(/\s+/g, " ")
          .trim();
      await assert.rejects(
        sqlClient.begin(async (owner) => {
          await owner`update permissions set active=false where key='parking:manage'`;
          await owner`update role_bindings set active=false where id=${f.binding}`;
          const [before] =
            await owner`select pg_get_expr(polwithcheck,polrelid) as expression from pg_policy where polrelid='audit_logs'::regclass and polname='audit_logs_insert_policy'`;
          const unrelated = () =>
            owner`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename<>'parking_lots' and policyname not in ('audit_logs_insert_policy','building_features_parking_read','feature_runtime_parking_read') order by tablename,policyname`;
          const baseline = await unrelated();
          const [feature] =
            await owner`select prosrc from pg_proc where oid='app_can_read_feature_event(text)'::regprocedure`;
          const stripFeature = (source: string) =>
            source
              .replaceAll("OR app_parking_can_read_scope(b.id)", "")
              .replace(/\s+/g, " ")
              .trim();
          for (let i = 0; i < 2; i++) {
            await owner.unsafe(migration);
            assert.deepEqual(await unrelated(), baseline);
            const [audit] =
              await owner`select pg_get_expr(polwithcheck,polrelid) as expression from pg_policy where polrelid='audit_logs'::regclass and polname='audit_logs_insert_policy'`;
            assert.equal(strip(audit!.expression), strip(before!.expression));
            assert.equal(
              (
                await owner`select active from permissions where key='parking:manage'`
              )[0]!.active,
              false,
            );
            assert.equal(
              (
                await owner`select active from role_bindings where id=${f.binding}`
              )[0]!.active,
              false,
            );
            assert.equal(
              stripFeature(
                (
                  await owner`select prosrc from pg_proc where oid='app_can_read_feature_event(text)'::regprocedure`
                )[0]!.prosrc,
              ),
              stripFeature(feature!.prosrc),
            );
            for (const type of [
              "alert_rule",
              "reservation",
              "common_area",
              "finance",
              "occurrence",
              "parking",
            ])
              assert.equal(
                (
                  await owner`select app_rbac_scope_valid(${type},'placeholder') as allowed`
                )[0]!.allowed,
                true,
              );
          }
          throw rollback;
        }),
        (error) => error === rollback,
      );
      for (const signature of [
        "app_parking_target_has_capability(text,text,text)",
        "app_parking_has_capability(text,text,text)",
        "app_parking_can_read_scope(text)",
        "app_parking_sensor_configurable(text,text,text)",
        "app_parking_lock_target(text,text,text)",
      ]) {
        const [row] =
          await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,p.proowner=c.proowner as owned,has_function_privilege('predioon_app',p.oid,'EXECUTE') as app,has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity,has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker,exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
        assert.equal(row!.prosecdef, true);
        assert.equal(
          row!.provolatile,
          signature.startsWith("app_parking_lock_target(") ? "v" : "s",
        );
        assert.equal(row!.owned, true);
        assert.ok(row!.proconfig.includes("search_path=public, pg_temp"));
        assert.equal(row!.app, true);
        assert.equal(row!.identity, false);
        assert.equal(row!.broker, false);
        assert.equal(row!.public_execute, false);
      }
      for (const signature of [
        "app_parking_parent_valid(text,text)",
        "app_parking_target_guard()",
        "validate_parking_sensor_scope()",
      ])
        for (const runtime of [
          "predioon_app",
          "predioon_identity",
          "predioon_broker_auth",
        ])
          assert.equal(
            (
              await sqlClient`select has_function_privilege(${runtime},${signature},'EXECUTE') as allowed`
            )[0]!.allowed,
            false,
          );
      const [invalid] = await as(f.ids.manager, (tx) =>
        tx.execute(
          sql`select app_parking_has_capability(${f.a},'bad-id','parking:read') as malformed,app_parking_has_capability(${f.a},${f.foreign},'parking:read') as foreign_lot,app_parking_has_capability(${f.a},${f.car},'devices:read') as wrong_capability`,
        ),
      );
      assert.deepEqual(
        { ...invalid },
        { malformed: false, foreign_lot: false, wrong_capability: false },
      );
    }));
  it("uses real parking PK and current bindings without inventory scans for scope", async (t) =>
    fixture(async (f) => {
      await exact(f);
      await sqlClient`insert into buildings(id,organization_id,name,code) select ${f.org}||'-extra-'||n,${f.org},'Other building',${f.org}||'-extra-'||n from generate_series(1,3000)n`;
      await sqlClient`insert into parking_lots(building_id,vehicle_type,capacity) select id,'CAR',20 from buildings where organization_id=${f.org} and id not in (${f.a},${f.b})`;
      await sqlClient`analyze parking_lots`;
      await sqlClient`analyze role_bindings`;
      const plans = await sqlClient.begin(async (owner) => {
        await owner`select set_config('app.user_id',${f.ids.exact},true)`;
        async function explain(
          signature: string,
          values: string[],
          names: string[],
        ) {
          const [row] =
            await owner`select prosrc from pg_proc where oid=${signature}::regprocedure`;
          let body = String(row!.prosrc);
          names.forEach((name, i) => {
            body = body.replaceAll(name, "$" + (i + 1));
          });
          return JSON.stringify(
            (await owner.unsafe(`explain (format json) ${body}`, values))[0]![
              "QUERY PLAN"
            ],
          );
        }
        return {
          point: await explain(
            "app_parking_has_capability(text,text,text)",
            [f.a, f.car, "parking:read"],
            ["target_building_id", "target_parking_id", "target_capability"],
          ),
          scope: await explain(
            "app_parking_can_read_scope(text)",
            [f.a],
            ["target_building_id"],
          ),
        };
      });
      assert.ok(plans.point.includes("parking_lots_pkey"), plans.point);
      assert.ok(
        !plans.scope.includes('"Relation Name":"parking_lots"'),
        plans.scope,
      );
      t.diagnostic(
        "Point query uses parking PK; scope reads current binding candidates.",
      );
    }));
  it("distinguishes empty authorized sensor scope from deleted exact parking and a building-only resource", async () =>
    fixture(async (f) => {
      await exact(f);
      await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.ids.outsider},${f.a},${f.roles.manager},'building',${f.a})`;
      assert.equal((await f.list(f.ids.outsider)).status, 403);
      await sqlClient`delete from parking_lots where id=${f.car}`;
      assert.deepEqual((await data(await f.list(f.ids.device))).items, []);
      assert.equal((await f.list(f.ids.exact)).status, 403);
    }));
  it("does not deliver cached counts after a grant is revoked before the response", async () =>
    fixture(async (f) => {
      const original = appDb.transaction;
      let delayed = false;
      function builder(target: any): any {
        return new Proxy(target, {
          get(object, key) {
            const value = Reflect.get(object, key);
            if (key === "then")
              return (resolve: any, reject: any) =>
                object.then(async (rows: any) => {
                  if (!delayed && object.toSQL().sql.includes("parking_lots")) {
                    delayed = true;
                    await sqlClient`update role_bindings set active=false where id=${f.deviceBinding}`;
                  }
                  return resolve(rows);
                }, reject);
            if (typeof value === "function")
              return (...args: any[]) => {
                const result = value.apply(object, args);
                return result &&
                  typeof result === "object" &&
                  ("from" in result || "toSQL" in result)
                  ? builder(result)
                  : result;
              };
            return value;
          },
        });
      }
      appDb.transaction = ((callback: any, ...options: any[]) =>
        original.call(
          appDb,
          (tx: any) =>
            callback(
              new Proxy(tx, {
                get(target, key, receiver) {
                  if (key === "select")
                    return (...args: any[]) => builder(target.select(...args));
                  return Reflect.get(target, key, receiver);
                },
              }),
            ),
          ...options,
        )) as typeof appDb.transaction;
      try {
        assert.equal((await f.list(f.ids.device)).status, 403);
        assert.equal(delayed, true);
      } finally {
        appDb.transaction = original;
      }
    }));
  it(
    "waits for the sensor before parking and preserves a concurrent ingested count without replay",
    { timeout: 20000 },
    async () =>
      fixture(async (f) => {
        const require = createRequire(import.meta.url),
          postgres = createRequire(require.resolve("@predioon/db"))(
            "postgres",
          ) as (url: string, options: object) => typeof sqlClient;
        const client = postgres(process.env.DATABASE_URL!, {
          max: 1,
          connect_timeout: 2,
        });
        let advance!: () => void,
          ready!: (pid: number) => void,
          reject!: (error: unknown) => void,
          timer: ReturnType<typeof setTimeout> | undefined;
        const proceed = new Promise<void>((resolve) => {
            advance = resolve;
          }),
          acquired = new Promise<number>((resolve, fail) => {
            ready = resolve;
            reject = fail;
          });
        const ingestion = Promise.allSettled([
          client.begin(async (owner) => {
            await owner`set local statement_timeout='8s'`;
            await owner`select id from devices where id=${f.d1} for update`;
            ready((await owner`select pg_backend_pid() as pid`)[0]!.pid);
            await proceed;
            // Same parent lookup, lock order, count/version update and audit as parking ingestion.
            const [lot] =
              await owner`select id from parking_lots where sensor_id=${f.d1} and building_id=${f.a} for update`;
            assert.equal(lot!.id, f.car);
            await owner`update parking_lots set occupied=6,source='SENSOR',observed_at=clock_timestamp(),version=version+1 where id=${lot!.id}`;
            await owner`insert into audit_logs(building_id,actor_type,action,resource_type,resource_id) values(${f.a},'SYSTEM','PARKING_SENSOR_UPDATED','parking',${f.car})`;
          }),
        ]);
        void ingestion.then(([result]) => {
          if (result!.status === "rejected") reject(result.reason);
        });
        let request: Promise<PromiseSettledResult<Response>[]> | undefined;
        try {
          const pid = await Promise.race([
            acquired,
            new Promise<never>((_, fail) => {
              timer = setTimeout(
                () => fail(new Error("Sensor acquisition timeout")),
                3000,
              );
            }),
          ]);
          clearTimeout(timer);
          request = Promise.allSettled([edit(f)]);
          let waiting = false;
          for (let i = 0; i < 250; i++) {
            if (
              (
                await sqlClient`select exists(select 1 from pg_stat_activity a where a.usename='predioon_app' and a.wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))) as waiting`
              )[0]!.waiting
            ) {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          assert.equal(
            waiting,
            true,
            "configuration waits at the sensor before taking the parking lock",
          );
          advance();
          const [[write], [response]] = await Promise.all([ingestion, request]);
          assert.equal(
            write!.status,
            "fulfilled",
            write!.status === "rejected" ? String(write.reason) : undefined,
          );
          assert.equal(response!.status, "fulfilled");
          if (response!.status === "fulfilled") {
            assert.equal(response.value.status, 409);
            assert.equal(
              (await response.value.json()).error,
              "As vagas foram atualizadas. Recarregue antes de salvar.",
            );
          }
          const [current] =
            await sqlClient`select occupied,source,capacity,version from parking_lots where id=${f.car}`;
          assert.deepEqual(
            { ...current },
            { occupied: 6, source: "SENSOR", capacity: 20, version: 2 },
          );
          assert.equal(
            (
              await sqlClient`select id from audit_logs where resource_id=${f.car} and action='PARKING_CONFIGURED'`
            ).length,
            0,
          );
        } finally {
          clearTimeout(timer);
          advance();
          await Promise.all([ingestion, request ?? Promise.resolve([])]);
          await client.end({ timeout: 1 });
        }
      }),
  );
  for (const parent of ["sensor", "gateway"] as const)
    it(`revalidates an active ${parent} after CREATE waits on its foreign key`, async () =>
      fixture(async (f) => {
        await sqlClient`delete from parking_lots where id=${f.car}`;
        const response = await locked(
          f,
          () =>
            f.request(f.ids.manager, "/parking", "POST", {
              buildingId: f.a,
              vehicleType: "CAR",
              capacity: 20,
              sensorId: f.d1,
            }),
          async (owner) => {
            if (parent === "sensor")
              await owner.unsafe(
                "update devices set enabled=false where id=$1",
                [f.d1],
              );
            else
              await owner.unsafe(
                "update gateways set enabled=false where id=$1",
                [f.gateway],
              );
          },
          f.d1,
        );
        assert.equal(response.status, 400, await response.clone().text());
        assert.equal(
          (
            await sqlClient`select id from parking_lots where building_id=${f.a} and vehicle_type='CAR'`
          ).length,
          0,
        );
        assert.equal(
          (await sqlClient`select id from audit_logs where building_id=${f.a}`)
            .length,
          0,
        );
      }));
  async function waitPast(boundary: unknown) {
    for (let i = 0; i < 100; i++) {
      if (
        (
          await sqlClient`select clock_timestamp()>${boundary as string}::timestamptz as expired`
        )[0]!.expired
      )
        return;
      await sqlClient`select pg_sleep(0.02)`;
    }
    assert.fail("bounded database expiry wait failed");
  }
  async function locked<T>(
    f: Fixture,
    start: () => Promise<T>,
    during: (owner: Pick<typeof sqlClient, "unsafe">) => Promise<void>,
    deviceId?: string,
  ) {
    const require = createRequire(import.meta.url),
      postgres = createRequire(require.resolve("@predioon/db"))("postgres") as (
        url: string,
        options: object,
      ) => typeof sqlClient;
    const client = postgres(process.env.DATABASE_URL!, {
      max: 1,
      connect_timeout: 2,
    });
    let release!: () => void,
      ready!: (pid: number) => void,
      reject!: (error: unknown) => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      acquired = new Promise<number>((resolve, fail) => {
        ready = resolve;
        reject = fail;
      });
    let pending: Promise<PromiseSettledResult<T>[]> | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      started = false,
      result: T | undefined;
    let heldOwner: Pick<typeof sqlClient, "unsafe"> | undefined;
    const blocker = Promise.allSettled([
      client.begin(async (owner) => {
        heldOwner = owner;
        await owner`set local lock_timeout='2s'`;
        await owner`set local statement_timeout='3s'`;
        if (deviceId)
          await owner`select id from devices where id=${deviceId} for update`;
        else
          await owner`select id from parking_lots where id=${f.car} for update`;
        ready((await owner`select pg_backend_pid() as pid`)[0]!.pid);
        await held;
      }),
    ]);
    void blocker.then(([r]) => {
      if (r!.status === "rejected") reject(r.reason);
    });
    try {
      const pid = await Promise.race([
        acquired,
        new Promise<never>((_, fail) => {
          timer = setTimeout(
            () => fail(new Error("Parking lock timeout")),
            5000,
          );
        }),
      ]);
      clearTimeout(timer);
      started = true;
      pending = Promise.allSettled([Promise.resolve().then(start)]);
      let waiting = false;
      for (let i = 0; i < 250; i++) {
        if (
          (
            await sqlClient`select exists(select 1 from pg_stat_activity a where a.usename='predioon_app' and a.wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))) as waiting`
          )[0]!.waiting
        ) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(
        waiting,
        true,
        "request must really wait on the selected parent row",
      );
      assert.ok(heldOwner);
      await during(heldOwner);
    } finally {
      clearTimeout(timer);
      release();
      if (!started) await client.end({ timeout: 0 });
      const [locks, results] = await Promise.all([
        blocker,
        pending ?? Promise.resolve([]),
      ]);
      await client.end({ timeout: 1 });
      for (const r of [...locks, ...results])
        if (r.status === "rejected") throw r.reason;
      if (results[0]?.status === "fulfilled") result = results[0].value;
    }
    return result as T;
  }
});
