import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

describe("physical access uses current capabilities at request and dispatch", () => {
  let server: TestServer, passwordHash: string;
  const ownedPermissions: string[] = [];
  before(async () => {
    passwordHash = await hashPassword("predioon123");
    server = await startTestServer();
    // Catalogue-only fixtures reproduce legacy denial before migration034.
    for (const key of [
      "gates:read",
      "gates:manage",
      "commands:read-own",
      "commands:read",
    ]) {
      const [resource, action] = key.split(":");
      const inserted =
        await sqlClient`insert into permissions(key,resource_type,action,label) values(${key},${resource!},${action!},${key}) on conflict(key) do nothing returning key`;
      ownedPermissions.push(...inserted.map((row) => row.key));
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
    | "worker"
    | "legacy"
    | "resident"
    | "flag"
    | "reader"
    | "requester";
  type Fixture = {
    org: string;
    building: string;
    foreign: string;
    gateway: string;
    device: string;
    gate: string;
    team: string;
    ids: Record<Kind, string>;
    roles: Record<"manager" | "reader" | "requester", string>;
    request(
      user: string,
      path: string,
      method?: string,
      body?: unknown,
    ): Promise<Response>;
  };
  async function fixture(run: (value: Fixture) => Promise<void>) {
    const suffix = randomUUID(),
      org = `access-cap-org-${suffix}`;
    const building = `access-cap-a-${suffix}`,
      foreign = `access-cap-b-${suffix}`;
    const gateway = `access-cap-gw-${suffix}`,
      device = `access-cap-device-${suffix}`;
    const gate = randomUUID(),
      team = randomUUID();
    const kinds: Kind[] = [
      "manager",
      "worker",
      "legacy",
      "resident",
      "flag",
      "reader",
      "requester",
    ];
    const ids = Object.fromEntries(
      kinds.map((kind) => [kind, `access-cap-${kind}-${suffix}`]),
    ) as Fixture["ids"];
    const roles = {
      manager: `ACCESS_MANAGER_${suffix}`,
      reader: `ACCESS_READER_${suffix}`,
      requester: `ACCESS_REQUESTER_${suffix}`,
    };
    const tokens = new Map<string, string>();
    const request: Fixture["request"] = (user, path, method = "GET", body) =>
      call(server.url, path, { token: tokens.get(user), method, body });
    try {
      await sqlClient.begin(async (tx) => {
        await tx`insert into organizations(id,name,slug) values(${org},'Access capabilities',${org})`;
        for (const id of [building, foreign])
          await tx`insert into buildings(id,organization_id,name,code) values(${id},${org},${id},${id})`;
        for (const [kind, id] of Object.entries(ids))
          await tx`insert into users(id,name,email,password_hash,is_platform_admin) values(${id},${kind},${id + "@access-cap.test"},${passwordHash},${kind === "flag"})`;
        for (const role of Object.values(roles))
          await tx`insert into roles(key,scope,label) values(${role},'BUILDING',${role})`;
        for (const permission of [
          "gates:read",
          "gates:manage",
          "commands:request",
          "commands:read-own",
          "commands:read",
        ])
          await tx`insert into role_permissions(role_key,permission_key) values(${roles.manager},${permission})`;
        await tx`insert into role_permissions(role_key,permission_key) values(${roles.reader},'gates:read'),(${roles.requester},'gates:read'),(${roles.requester},'commands:request'),(${roles.requester},'commands:read-own')`;
        for (const kind of ["manager", "reader", "requester"] as const)
          await tx`insert into role_bindings(user_id,building_id,role_key) values(${ids[kind]},${building},${roles[kind]})`;
        await tx`insert into teams(id,building_id,name) values(${team},${building},'Access team')`;
        await tx`insert into team_members(team_id,building_id,user_id) values(${team},${building},${ids.worker})`;
        await tx`insert into role_bindings(team_id,building_id,role_key) values(${team},${building},${roles.manager})`;
        await tx`insert into memberships(user_id,building_id,role) values(${ids.legacy},${building},'BUILDING_ADMIN'),(${ids.resident},${building},'RESIDENT')`;
        await tx`insert into gateways(id,building_id,name,serial_number,status,last_seen_at) values(${gateway},${building},'Gate gateway',${gateway},'ONLINE',clock_timestamp())`;
        await tx`insert into devices(id,building_id,gateway_id,name,type,status,last_seen_at) values(${device},${building},${gateway},'Gate controller','GATE_CONTROLLER','ONLINE',clock_timestamp())`;
        await tx`insert into gates(id,building_id,name,kind,gateway_id,device_id,enabled,allow_residents) values(${gate},${building},'Main gate','GARAGE',${gateway},${device},true,true)`;
      });
      for (const id of Object.values(ids))
        tokens.set(
          id,
          (await login(server.url, id + "@access-cap.test")).accessToken,
        );
      await run({
        org,
        building,
        foreign,
        gateway,
        device,
        gate,
        team,
        ids,
        roles,
        request,
      });
    } finally {
      await sqlClient.begin(async (tx) => {
        await tx`delete from audit_logs where user_id in ${tx(Object.values(ids))}`;
        await tx`delete from gate_commands where building_id in ${tx([building, foreign])}`;
        await tx`delete from buildings where organization_id=${org}`;
        await tx`delete from organizations where id=${org}`;
        await tx`delete from users where id in ${tx(Object.values(ids))}`;
        await tx`delete from roles where key in ${tx(Object.values(roles))}`;
      });
    }
  }

  it("allows direct and team grants without legacy membership or inventory access", async () =>
    fixture(async (f) => {
      for (const user of [f.ids.manager, f.ids.worker]) {
        const response = await f.request(
          user,
          `/access?buildingId=${f.building}`,
        );
        const body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body));
        assert.deepEqual(
          body.items.map((row: any) => row.id),
          [f.gate],
        );
        assert.equal(body.items[0].available, true);
        assert.deepEqual(body.gateways, []);
        assert.deepEqual(body.devices, []);
      }
    }));

  it("does not infer any physical read or request authority from the platform flag", async () =>
    fixture(async (f) => {
      assert.equal(
        (await f.request(f.ids.flag, `/access?buildingId=${f.building}`))
          .status,
        403,
      );
      assert.equal(
        (
          await f.request(f.ids.flag, `/access/${f.gate}/open`, "POST", {
            requestId: randomUUID(),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await sqlClient`select count(*)::int as total from gate_commands where building_id=${f.building}`
        )[0]!.total,
        0,
      );
    }));

  it("preserves enabled and resident policy when PATCH only changes the gate name", async () =>
    fixture(async (f) => {
      const response = await f.request(
        f.ids.legacy,
        `/access/${f.gate}`,
        "PATCH",
        { name: "Renamed gate" },
      );
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.name, "Renamed gate");
      assert.equal(body.enabled, true);
      assert.equal(body.allowResidents, true);
      const [stored] =
        await sqlClient`select enabled,allow_residents from gates where id=${f.gate}`;
      assert.deepEqual(stored, { enabled: true, allow_residents: true });
    }));

  it("rejects raw runtime command INSERT so callers cannot bypass the controlled request transition", async () =>
    fixture(async (f) => {
      await assert.rejects(
        withUserContext(
          { userId: f.ids.resident, role: "PLATFORM_ADMIN" },
          (tx) =>
            tx.execute(sql`
      with clock as (select clock_timestamp() as at)
      insert into gate_commands(request_id,gate_id,building_id,gateway_id,device_id,requested_by,created_at,expires_at)
      select ${randomUUID()}::uuid,${f.gate}::uuid,${f.building},${f.gateway},${f.device},${f.ids.resident},at,at+interval '15 seconds' from clock
    `),
        ),
      );
      assert.equal(
        (
          await sqlClient`select count(*)::int as total from gate_commands where building_id=${f.building}`
        )[0]!.total,
        0,
      );
    }));

  const open = (f: Fixture, user = f.ids.requester, requestId = randomUUID()) =>
    f.request(user, `/access/${f.gate}/open`, "POST", { requestId });

  it("separates read, management, request and own-history grants", async () =>
    fixture(async (f) => {
      await sqlClient`delete from role_permissions where role_key=${f.roles.manager} and permission_key='commands:request'`;
      for (const actor of [f.ids.reader, f.ids.manager]) {
        const list = await f.request(actor, `/access?buildingId=${f.building}`);
        assert.equal(list.status, 200);
        assert.equal((await list.json()).items[0].available, false);
        assert.equal((await open(f, actor)).status, 403);
      }
      await sqlClient`delete from role_permissions where role_key=${f.roles.requester} and permission_key='gates:read'`;
      assert.equal((await open(f)).status, 403);
      await sqlClient`insert into role_permissions(role_key,permission_key) values(${f.roles.requester},'gates:read')`;
      await sqlClient`delete from role_permissions where role_key=${f.roles.requester} and permission_key='commands:read-own'`;
      const requestId = randomUUID(),
        response = await open(f, f.ids.requester, requestId);
      assert.equal(response.status, 202, await response.clone().text());
      const receipt = await response.json();
      assert.equal(
        (await f.request(f.ids.requester, `/access/commands/${receipt.id}`))
          .status,
        404,
      );
      assert.equal((await open(f, f.ids.requester, requestId)).status, 403);
      const [counts] =
        await sqlClient`select (select count(*)::int from gate_commands where building_id=${f.building}) as commands,
      (select count(*)::int from audit_logs where building_id=${f.building} and action='ACCESS_REQUEST_REPEATED') as repeats`;
      assert.deepEqual(counts, { commands: 1, repeats: 0 });
      await sqlClient`insert into role_permissions(role_key,permission_key) values(${f.roles.requester},'commands:read-own')`;
      await sqlClient`delete from role_permissions where role_key=${f.roles.requester} and permission_key='commands:request'`;
      assert.equal(
        (await f.request(f.ids.requester, `/access/commands/${receipt.id}`))
          .status,
        200,
      );
      assert.equal((await open(f, f.ids.requester, requestId)).status, 403);
    }));

  it("requires current management as well as request to waive resident policy", async () =>
    fixture(async (f) => {
      await sqlClient`update gates set allow_residents=false where id=${f.gate}`;
      assert.equal((await open(f)).status, 403);
      assert.equal((await open(f, f.ids.resident)).status, 403);
      const response = await open(f, f.ids.manager);
      assert.equal(response.status, 202, await response.clone().text());
    }));

  for (const scope of ["gate", "device", "gateway"] as const)
    it(`uses only a real ${scope} grant without requiring inventory`, async () =>
      fixture(async (f) => {
        const resource =
          scope === "gate" ? f.gate : scope === "device" ? f.device : f.gateway;
        await sqlClient`update role_bindings set resource_type=${scope},resource_id=${resource} where user_id=${f.ids.manager}`;
        const response = await f.request(
          f.ids.manager,
          `/access?buildingId=${f.building}`,
        );
        assert.equal(response.status, 200, await response.clone().text());
        const body = await response.json();
        assert.deepEqual(
          body.items.map((r: any) => r.id),
          [f.gate],
        );
        assert.deepEqual(body.devices, []);
        assert.deepEqual(body.gateways, []);
        assert.equal(
          (
            await f.request(f.ids.manager, `/access/${f.gate}`, "PATCH", {
              name: "Scoped gate",
            })
          ).status,
          200,
        );
        assert.equal((await open(f, f.ids.manager)).status, 202);
        await sqlClient`update role_bindings set resource_id=${scope === "gate" ? randomUUID() : "missing-parent"} where user_id=${f.ids.manager}`;
        assert.equal(
          (await f.request(f.ids.manager, `/access?buildingId=${f.building}`))
            .status,
          403,
        );
        assert.equal((await open(f, f.ids.manager)).status, 403);
      }));

  it("deduplicates simultaneous requests and keeps other residents' history private", async () =>
    fixture(async (f) => {
      const requestId = randomUUID();
      const responses = await Promise.all([
        open(f, f.ids.requester, requestId),
        open(f, f.ids.requester, requestId),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 202]);
      const receipts = await Promise.all(responses.map((r) => r.json()));
      assert.equal(receipts[0].id, receipts[1].id);
      assert.equal((await open(f, f.ids.resident)).status, 429);
      const list = await f.request(
        f.ids.resident,
        `/access?buildingId=${f.building}`,
      );
      assert.equal((await list.json()).items[0].latestCommand, null);
      assert.equal(
        (await f.request(f.ids.resident, `/access/commands/${receipts[0].id}`))
          .status,
        404,
      );
      const own = await f.request(
        f.ids.requester,
        `/access?buildingId=${f.building}`,
      );
      assert.equal(
        (await own.json()).items[0].latestCommand.id,
        receipts[0].id,
      );
      const [stored] =
        await sqlClient`select extract(epoch from expires_at-created_at)::float as ttl from gate_commands where id=${receipts[0].id}`;
      assert.equal(stored!.ttl, 15);
    }));

  for (const parent of ["device", "gateway"] as const)
    it(`rejects a new intent after ${parent} is disabled while waiting on its row`, async () =>
      fixture(async (f) => {
        const response = await locked(
          f,
          parent,
          () => open(f),
          async (owner) => {
            await owner.unsafe(
              `update ${parent === "device" ? "devices" : "gateways"} set enabled=false where id=$1`,
              [parent === "device" ? f.device : f.gateway],
            );
          },
        );
        assert.equal(response.status, 409, await response.clone().text());
        assert.equal(
          (
            await sqlClient`select id from gate_commands where building_id=${f.building}`
          ).length,
          0,
        );
        assert.equal(
          (
            await sqlClient`select id from audit_logs where building_id=${f.building} and action='ACCESS_OPEN_REQUESTED'`
          ).length,
          0,
        );
      }));

  it("rechecks revoked request authority after a physical parent lock wait", async () =>
    fixture(async (f) => {
      const response = await locked(
        f,
        "device",
        () => open(f),
        async (owner) => {
          await owner.unsafe(
            "update role_bindings set active=false where user_id=$1",
            [f.ids.requester],
          );
        },
      );
      assert.equal(response.status, 403, await response.clone().text());
      assert.equal(
        (
          await sqlClient`select id from gate_commands where building_id=${f.building}`
        ).length,
        0,
      );
    }));

  it("does not return a historical receipt after history is revoked during the repeat audit wait", async () =>
    fixture(async (f) => {
      const requestId = randomUUID(),
        first = await open(f, f.ids.requester, requestId);
      assert.equal(first.status, 202);
      const response = await locked(
        f,
        "user",
        () => open(f, f.ids.requester, requestId),
        async (owner) => {
          await owner.unsafe(
            "delete from role_permissions where role_key=$1 and permission_key='commands:read-own'",
            [f.roles.requester],
          );
        },
      );
      assert.equal(response.status, 403, await response.clone().text());
      assert.equal(
        (
          await sqlClient`select id from gate_commands where building_id=${f.building}`
        ).length,
        1,
      );
      assert.equal(
        (
          await sqlClient`select id from audit_logs where building_id=${f.building} and action='ACCESS_REQUEST_REPEATED'`
        ).length,
        0,
      );
    }));

  it("creates an explicitly authorized controller without inventory and can configure it while disabled", async () =>
    fixture(async (f) => {
      await sqlClient`delete from gates where id=${f.gate}`;
      await sqlClient`update role_bindings set resource_type='device',resource_id=${f.device} where user_id=${f.ids.manager}`;
      await sqlClient`update devices set enabled=false where id=${f.device}`;
      const created = await f.request(f.ids.manager, "/access", "POST", {
        buildingId: f.building,
        gatewayId: f.gateway,
        deviceId: f.device,
        kind: "GARAGE",
        name: "Exact controller",
        enabled: true,
        allowResidents: true,
      });
      assert.equal(created.status, 201, await created.clone().text());
      const gate = await created.json();
      assert.equal(
        (
          await f.request(f.ids.manager, `/access/${gate.id}`, "PATCH", {
            name: "Diagnostic name",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await f.request(f.ids.manager, `/access/${gate.id}/open`, "POST", {
            requestId: randomUUID(),
          })
        ).status,
        409,
      );
    }));

  it("does not promote an exact gate grant to another controller, SQL tenant, identity or deletion", async () =>
    fixture(async (f) => {
      const other = `other-${randomUUID()}`;
      await sqlClient`insert into devices(id,building_id,gateway_id,name,type,status,last_seen_at) values(${other},${f.building},${f.gateway},'Other controller','GATE_CONTROLLER','ONLINE',clock_timestamp())`;
      await sqlClient`update role_bindings set resource_type='gate',resource_id=${f.gate} where user_id=${f.ids.manager}`;
      assert.equal(
        (
          await f.request(f.ids.manager, `/access/${f.gate}`, "PATCH", {
            deviceId: other,
          })
        ).status,
        403,
      );
      for (const operation of [
        sql`update gates set device_id=${other} where id=${f.gate}::uuid`,
        sql`update gates set building_id=${f.foreign} where id=${f.gate}::uuid`,
        sql`update gates set id=${randomUUID()}::uuid where id=${f.gate}::uuid`,
        sql`delete from gates where id=${f.gate}::uuid`,
      ])
        await assert.rejects(
          withUserContext(
            { userId: f.ids.manager, role: "PLATFORM_ADMIN" },
            (tx) => tx.execute(operation),
          ),
        );
      assert.equal(
        (await sqlClient`select device_id from gates where id=${f.gate}`)[0]!
          .device_id,
        f.device,
      );
    }));

  it("denies historical receipts after own-history expires during audit wait", async () =>
    fixture(async (f) => {
      const requestId = randomUUID();
      assert.equal((await open(f, f.ids.requester, requestId)).status, 202);
      await sqlClient`delete from role_permissions where role_key=${f.roles.requester} and permission_key='commands:read-own'`;
      await sqlClient`insert into role_permissions(role_key,permission_key) values(${f.roles.reader},'commands:read-own')`;
      const binding = randomUUID();
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,ends_at) values(${binding},${f.ids.requester},${f.building},${f.roles.reader},clock_timestamp()+interval '30 seconds')`;
      const response = await locked(
        f,
        "user",
        () => open(f, f.ids.requester, requestId),
        async (owner) => {
          const [row] = await owner.unsafe(
            "update role_bindings set starts_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()+interval '200 milliseconds' where id=$1 returning ends_at",
            [binding],
          );
          for (let i = 0; i < 100; i++) {
            if (
              (
                await owner.unsafe(
                  "select clock_timestamp()>$1::timestamptz as expired",
                  [row!.ends_at],
                )
              )[0]!.expired
            )
              break;
            await owner.unsafe("select pg_sleep(0.02)");
          }
        },
      );
      assert.equal(response.status, 403, await response.clone().text());
      assert.equal(
        (
          await sqlClient`select id from audit_logs where building_id=${f.building} and action='ACCESS_REQUEST_REPEATED'`
        ).length,
        0,
      );
    }));

  for (const change of [
    "team",
    "organization",
    "building",
    "account",
    "permission",
  ] as const)
    it(`fails closed after current ${change} authority is removed`, async () =>
      fixture(async (f) => {
        const actor = change === "team" ? f.ids.worker : f.ids.manager;
        assert.equal(
          (await f.request(actor, `/access?buildingId=${f.building}`)).status,
          200,
        );
        if (change === "team")
          await sqlClient`update team_members set active=false where team_id=${f.team}`;
        if (change === "organization")
          await sqlClient`update organizations set active=false where id=${f.org}`;
        if (change === "building")
          await sqlClient`update buildings set active=false where id=${f.building}`;
        if (change === "account")
          await sqlClient`update users set active=false where id=${actor}`;
        if (change === "permission")
          await sqlClient`delete from role_permissions where role_key=${f.roles.manager} and permission_key='gates:read'`;
        assert.ok([401, 403].includes((await open(f, actor)).status));
        assert.equal(
          (
            await sqlClient`select id from gate_commands where building_id=${f.building}`
          ).length,
          0,
        );
      }));

  it("revokes service/private helper execution and command mutations from every runtime role", async () =>
    fixture(async (f) => {
      const privateFunctions = [
        "app_mark_access_sent(uuid)",
        "app_access_parent_valid(text,text,text)",
        "app_access_has_capability_at(text,text,text,timestamp with time zone)",
        "app_access_request_permitted_at(text,text,timestamp with time zone)",
        "app_access_operational_reason(uuid,timestamp with time zone)",
        "app_access_role(text)",
        "app_access_request_throttled(uuid)",
      ];
      for (const role of [
        "predioon_app",
        "predioon_identity",
        "predioon_broker_auth",
      ]) {
        for (const helper of privateFunctions)
          assert.equal(
            (
              await sqlClient`select has_function_privilege(${role},${helper},'EXECUTE') as allowed`
            )[0]!.allowed,
            false,
            `${role}: ${helper}`,
          );
        if (role !== "predioon_app")
          assert.equal(
            (
              await sqlClient`select has_function_privilege(${role},'app_request_access(uuid,uuid,text,text)','EXECUTE') as allowed`
            )[0]!.allowed,
            false,
          );
      }
      for (const action of ["INSERT", "UPDATE", "DELETE"])
        assert.equal(
          (
            await sqlClient`select has_table_privilege('predioon_app','gate_commands',${action}) as allowed`
          )[0]!.allowed,
          false,
        );
      await assert.rejects(
        withUserContext(
          { userId: f.ids.manager, role: "PLATFORM_ADMIN" },
          (tx) =>
            tx.execute(sql`
      insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${f.building},${f.ids.manager},'ACCESS_OPEN_REQUESTED','gate',${f.gate})`),
        ),
      );
    }));

  it("never rearms a terminal request and preserves one intent across repeated receipts", async () =>
    fixture(async (f) => {
      const requestId = randomUUID(),
        response = await open(f, f.ids.requester, requestId);
      assert.equal(response.status, 202);
      const command = await response.json();
      for (const status of ["FAILED", "EXPIRED", "ACKNOWLEDGED", "SENT"]) {
        await sqlClient`update gate_commands set status=${status} where id=${command.id}`;
        const repeat = await open(f, f.ids.requester, requestId);
        assert.equal(repeat.status, 200);
        const receipt = await repeat.json();
        assert.equal(receipt.id, command.id);
        assert.equal(receipt.status, status);
      }
      assert.equal(
        (
          await sqlClient`select id from gate_commands where building_id=${f.building}`
        ).length,
        1,
      );
      assert.equal(
        (
          await sqlClient`select id from audit_logs where building_id=${f.building} and action='ACCESS_OPEN_REQUESTED'`
        ).length,
        1,
      );
    }));

  it("rolls back the command when atomic request auditing fails", async () =>
    fixture(async (f) => {
      const name = `test_access_audit_${randomUUID().replaceAll("-", "")}`;
      await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin
      if NEW.user_id='${f.ids.requester}' and NEW.action='ACCESS_OPEN_REQUESTED' then raise exception 'fixture audit failure' using errcode='XX000'; end if;
      return NEW; end $$`);
      try {
        await sqlClient.unsafe(
          `create trigger ${name} before insert on audit_logs for each row execute function ${name}()`,
        );
        const response = await open(f);
        assert.equal(response.status, 500);
        assert.equal(
          (
            await sqlClient`select id from gate_commands where building_id=${f.building}`
          ).length,
          0,
        );
        assert.equal(
          (
            await sqlClient`select id from audit_logs where building_id=${f.building}`
          ).length,
          0,
        );
        assert.equal(
          (
            await sqlClient`select id from audit_logs where user_id=${f.ids.requester} and action='ACCESS_REQUEST_REJECTED'`
          ).length,
          1,
        );
      } finally {
        await sqlClient.unsafe(`drop trigger if exists ${name} on audit_logs`);
        await sqlClient.unsafe(`drop function ${name}()`);
      }
    }));

  it("hides paused access features and denies new physical requests", async () =>
    fixture(async (f) => {
      await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.building},'GARAGE_ACCESS',false)`;
      const list = await f.request(
        f.ids.manager,
        `/access?buildingId=${f.building}`,
      );
      assert.equal(list.status, 200);
      assert.deepEqual((await list.json()).items, []);
      const response = await open(f);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).details.code, "FEATURE_DISABLED");
      assert.equal(
        (
          await sqlClient`select id from gate_commands where building_id=${f.building}`
        ).length,
        0,
      );
    }));

  it("reapplies only access changes without restoring revoked grants or replacing earlier policies", async () =>
    fixture(async (f) => {
      const migration = await readFile(
        new URL(
          "../../../infrastructure/034-access-capabilities.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const rollback = new Error("access reapplication rollback");
      const strip = (expression: string) =>
        expression
          .replace(
            /WHEN 'ACCESS_(?:CONFIG_CREATED|CONFIG_UPDATED|OPEN_REQUESTED|REQUEST_REPEATED)'::text THEN .*?(?=WHEN |ELSE)/gs,
            "",
          )
          .replace(/\s+/g, " ")
          .trim();
      await assert.rejects(
        sqlClient.begin(async (owner) => {
          await owner`update permissions set active=false where key='gates:manage'`;
          await owner`update role_bindings set active=false where user_id=${f.ids.manager}`;
          const unrelated = () =>
            owner`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename not in ('gates','gate_commands') and policyname not in ('audit_logs_insert_policy','building_features_access_read','feature_runtime_access_read') order by tablename,policyname`;
          const baseline = await unrelated();
          const [audit] =
            await owner`select pg_get_expr(polwithcheck,polrelid) as expression from pg_policy where polrelid='audit_logs'::regclass and polname='audit_logs_insert_policy'`;
          for (let i = 0; i < 2; i++) {
            await owner.unsafe(migration);
            assert.deepEqual(await unrelated(), baseline);
            const [current] =
              await owner`select pg_get_expr(polwithcheck,polrelid) as expression from pg_policy where polrelid='audit_logs'::regclass and polname='audit_logs_insert_policy'`;
            assert.equal(strip(current!.expression), strip(audit!.expression));
            assert.equal(
              (
                await owner`select active from permissions where key='gates:manage'`
              )[0]!.active,
              false,
            );
            assert.equal(
              (
                await owner`select active from role_bindings where user_id=${f.ids.manager}`
              )[0]!.active,
              false,
            );
            for (const type of [
              "gate",
              "parking",
              "alert_rule",
              "finance",
              "reservation",
              "occurrence",
              "notice",
            ])
              assert.equal(
                (
                  await owner`select app_rbac_scope_valid(${type},'placeholder') as allowed`
                )[0]!.allowed,
                true,
              );
            for (const signature of [
              "app_request_access(uuid,uuid,text,text)",
              "app_mark_access_sent(uuid)",
              "app_access_has_capability(text,text,text)",
            ]) {
              const [helper] =
                await owner`select p.prosecdef,p.provolatile,p.proconfig,p.proowner=c.proowner as owned,
            exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
            from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
              assert.equal(helper!.prosecdef, true);
              assert.equal(helper!.owned, true);
              assert.equal(helper!.public_execute, false);
              assert.ok(
                helper!.proconfig.includes("search_path=public, pg_temp"),
              );
            }
          }
          throw rollback;
        }),
        (error) => error === rollback,
      );
    }));

  it("uses the gate primary key and current bindings without scanning command history for scope", async (t) =>
    fixture(async (f) => {
      await sqlClient`insert into devices(id,building_id,gateway_id,name,type) select ${f.org}||'-device-'||n,${f.building},${f.gateway},'Scale controller','GATE_CONTROLLER' from generate_series(1,3000)n`;
      await sqlClient`insert into gates(building_id,name,kind,gateway_id,device_id) select ${f.building},'Scale gate','GARAGE',${f.gateway},id from devices where id like ${f.org + "-device-%"}`;
      await sqlClient`analyze gates`;
      await sqlClient`analyze role_bindings`;
      const plans = await sqlClient.begin(async (owner) => {
        await owner`select set_config('app.user_id',${f.ids.manager},true)`;
        async function explain(
          signature: string,
          names: string[],
          values: string[],
        ) {
          const [source] =
            await owner`select prosrc from pg_proc where oid=${signature}::regprocedure`;
          let body = String(source!.prosrc);
          names.forEach((name, i) => {
            body = body.replaceAll(
              name,
              name === "evaluated_at"
                ? `($${i + 1}::timestamptz)`
                : "$" + (i + 1),
            );
          });
          return JSON.stringify(
            (await owner.unsafe(`explain(format json) ${body}`, values))[0]![
              "QUERY PLAN"
            ],
          );
        }
        return {
          point: await explain(
            "app_access_has_capability_at(text,text,text,timestamp with time zone)",
            [
              "target_building_id",
              "target_gate_id",
              "target_capability",
              "evaluated_at",
            ],
            [f.building, f.gate, "gates:read", new Date().toISOString()],
          ),
          scope: await explain(
            "app_access_can_read_scope(text)",
            ["target_building_id"],
            [f.building],
          ),
        };
      });
      assert.ok(plans.point.includes("gates_pkey"), plans.point);
      assert.ok(!plans.scope.includes("gate_commands"), plans.scope);
      assert.ok(plans.scope.includes("role_bindings"), plans.scope);
      t.diagnostic(
        "Point lookup uses gates_pkey; scope reads current binding candidates, not command history.",
      );
    }));

  async function locked<T>(
    f: Fixture,
    parent: "device" | "gateway" | "user",
    start: () => Promise<T>,
    during: (owner: Pick<typeof sqlClient, "unsafe">) => Promise<void>,
  ) {
    let release!: () => void,
      ready!: (pid: number) => void,
      reject!: (e: unknown) => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<number>((r, j) => {
      ready = r;
      reject = j;
    });
    let ownerConnection: Pick<typeof sqlClient, "unsafe"> | undefined;
    const blocker = Promise.allSettled([
      sqlClient.begin(async (owner) => {
        ownerConnection = owner;
        await owner`set local statement_timeout='8s'`;
        const table =
          parent === "device"
            ? "devices"
            : parent === "gateway"
              ? "gateways"
              : "users";
        await owner.unsafe(`select id from ${table} where id=$1 for update`, [
          parent === "device"
            ? f.device
            : parent === "gateway"
              ? f.gateway
              : f.ids.requester,
        ]);
        ready((await owner`select pg_backend_pid() as pid`)[0]!.pid);
        await held;
      }),
    ]);
    void blocker.then(([r]) => {
      if (r!.status === "rejected") reject(r.reason);
    });
    let request: Promise<PromiseSettledResult<T>[]> | undefined;
    try {
      const pid = await acquired;
      request = Promise.allSettled([start()]);
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
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(waiting, true, "request must block on the selected parent");
      await during(ownerConnection!);
    } finally {
      release();
      await blocker;
    }
    const [result] = await request!;
    if (result!.status === "rejected") throw result.reason;
    return result!.value;
  }
});
