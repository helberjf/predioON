import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import type { MqttClient } from "mqtt";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import {
  dispatchAccessOnce,
  handleAccessAck,
} from "../src/access/dispatcher.js";
import { accessTopic } from "@predioon/shared";

describe(
  "current capabilities at the physical SENT checkpoint",
  { skip: process.env.RUN_ACCESS_DB_TESTS !== "1" },
  () => {
    after(async () => {
      await closeAppDb();
      await sqlClient.end();
    });
    type Fixture = {
      org: string;
      building: string;
      user: string;
      role: string;
      gateway: string;
      device: string;
      gate: string;
      command: any;
      sent: Array<{ topic: string; payload: string; options: unknown }>;
      client: MqttClient;
      dispatch(): Promise<void>;
    };
    async function fixture(run: (f: Fixture) => Promise<void>) {
      const suffix = randomUUID(),
        org = `dispatch-org-${suffix}`,
        building = `dispatch-building-${suffix}`;
      const user = `dispatch-user-${suffix}`,
        role = `DISPATCH_${suffix}`,
        gateway = `dispatch-gw-${suffix}`,
        device = `dispatch-device-${suffix}`,
        gate = randomUUID();
      const sent: Fixture["sent"] = [];
      const client = {
        connected: true,
        options: { queueQoSZero: false },
        publish: (
          topic: string,
          payload: string,
          options: unknown,
          done: (e?: Error) => void,
        ) => {
          sent.push({ topic, payload, options });
          done();
        },
      } as unknown as MqttClient;
      try {
        await sqlClient.begin(async (tx) => {
          await tx`insert into organizations(id,name,slug) values(${org},'Physical dispatch',${org})`;
          await tx`insert into buildings(id,organization_id,name,code) values(${building},${org},'Physical dispatch',${building})`;
          await tx`insert into users(id,name,email) values(${user},'Dispatch actor',${user + "@test.local"})`;
          await tx`insert into roles(key,scope,label) values(${role},'BUILDING',${role})`;
          for (const permission of [
            "gates:read",
            "commands:request",
            "commands:read-own",
          ])
            await tx`insert into role_permissions(role_key,permission_key) values(${role},${permission})`;
          await tx`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${user},${building},${role},'gate',${gate})`;
          await tx`insert into gateways(id,building_id,name,serial_number,status,last_seen_at) values(${gateway},${building},'Gateway',${gateway},'ONLINE',clock_timestamp())`;
          await tx`insert into devices(id,building_id,gateway_id,name,type,status,last_seen_at) values(${device},${building},${gateway},'Controller','GATE_CONTROLLER','ONLINE',clock_timestamp())`;
          await tx`insert into gates(id,building_id,name,kind,gateway_id,device_id,enabled,allow_residents) values(${gate},${building},'Scoped gate','GARAGE',${gateway},${device},true,true)`;
        });
        const [accepted] = await withUserContext(
          { userId: user, role: "PLATFORM_ADMIN" },
          (tx) =>
            tx.execute(
              sql`select * from app_request_access(${gate}::uuid,${randomUUID()}::uuid)`,
            ),
        );
        assert.ok(accepted);
        const command = accepted.command as any;
        await run({
          org,
          building,
          user,
          role,
          gateway,
          device,
          gate,
          command,
          sent,
          client,
          dispatch: () =>
            dispatchAccessOnce(
              client,
              new Date(new Date(command.created_at).getTime() - 1),
            ),
        });
      } finally {
        await sqlClient.begin(async (tx) => {
          await tx`delete from audit_logs where building_id=${building} or user_id=${user}`;
          await tx`delete from gate_commands where building_id=${building}`;
          await tx`delete from buildings where id=${building}`;
          await tx`delete from organizations where id=${org}`;
          await tx`delete from users where id=${user}`;
          await tx`delete from roles where key=${role}`;
        });
      }
    }
    const state = async (f: Fixture) =>
      (
        await sqlClient`select status,sent_at from gate_commands where id=${f.command.id}`
      )[0]!;
    async function denied(f: Fixture) {
      assert.deepEqual(await state(f), { status: "FAILED", sent_at: null });
      assert.equal(f.sent.length, 0);
      const rows =
        await sqlClient`select action from audit_logs where resource_id=${f.gate} and action like 'ACCESS_COMMAND_%' order by created_at`;
      assert.deepEqual(
        rows.map((r) => r.action),
        ["ACCESS_COMMAND_FAILED"],
      );
      await f.dispatch();
      assert.equal(
        f.sent.length,
        0,
        "a failed physical intent is never replayed",
      );
    }
    it("dispatches an exact RBAC-only request once with QoS0, confirms only a matching ACK", async () =>
      fixture(async (f) => {
        await f.dispatch();
        assert.deepEqual(await state(f), {
          status: "SENT",
          sent_at: (await state(f)).sent_at,
        });
        assert.ok((await state(f)).sent_at);
        assert.equal(f.sent.length, 1);
        assert.deepEqual(f.sent[0]!.options, { qos: 0, retain: false });
        const payload = JSON.parse(f.sent[0]!.payload);
        assert.equal(payload.commandId, f.command.id);
        assert.equal(payload.deviceId, f.device);
        await f.dispatch();
        assert.equal(f.sent.length, 1);
        const ack = {
          commandId: f.command.id,
          buildingId: f.building,
          gatewayId: f.gateway,
          gateId: f.gate,
          deviceId: f.device,
          result: "EXECUTED",
        };
        await handleAccessAck(
          accessTopic(f.building, f.gateway, f.gate, "ack"),
          Buffer.from(JSON.stringify({ ...ack, deviceId: "other" })),
        );
        assert.equal((await state(f)).status, "SENT");
        await handleAccessAck(
          accessTopic(f.building, f.gateway, f.gate, "ack"),
          Buffer.from(JSON.stringify(ack)),
        );
        assert.equal((await state(f)).status, "ACKNOWLEDGED");
        await f.dispatch();
        assert.equal(f.sent.length, 1);
      }));
    for (const authority of [
      "read",
      "request",
      "binding",
      "account",
      "organization",
      "building",
      "policy",
      "device",
      "gateway",
    ] as const)
      it(`publishes zero commands after ${authority} is revoked before SENT`, async () =>
        fixture(async (f) => {
          if (authority === "read" || authority === "request")
            await sqlClient`delete from role_permissions where role_key=${f.role} and permission_key=${authority === "read" ? "gates:read" : "commands:request"}`;
          if (authority === "binding")
            await sqlClient`update role_bindings set active=false where user_id=${f.user}`;
          if (authority === "account")
            await sqlClient`update users set active=false where id=${f.user}`;
          if (authority === "organization")
            await sqlClient`update organizations set active=false where id=${f.org}`;
          if (authority === "building")
            await sqlClient`update buildings set active=false where id=${f.building}`;
          if (authority === "policy")
            await sqlClient`update gates set allow_residents=false where id=${f.gate}`;
          if (authority === "device")
            await sqlClient`update devices set enabled=false where id=${f.device}`;
          if (authority === "gateway")
            await sqlClient`update gateways set enabled=false where id=${f.gateway}`;
          await f.dispatch();
          await denied(f);
        }));
    for (const parent of ["device", "gateway", "user"] as const)
      it(`rechecks authority after waiting on ${parent}, before SENT and publication`, async () =>
        fixture(async (f) => {
          await blocked(f, parent, async (owner) => {
            if (parent === "user")
              await owner.unsafe(
                "delete from role_permissions where role_key=$1 and permission_key='commands:request'",
                [f.role],
              );
            else
              await owner.unsafe(
                `update ${parent === "device" ? "devices" : "gateways"} set enabled=false where id=$1`,
                [parent === "device" ? f.device : f.gateway],
              );
          });
          await denied(f);
        }));
    it("uses the database clock after an audit wait when the grant expires", async () =>
      fixture(async (f) => {
        await blocked(f, "user", async (owner) => {
          const [row] = await owner.unsafe(
            "update role_bindings set starts_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()+interval '200 milliseconds' where user_id=$1 returning ends_at",
            [f.user],
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
        });
        await denied(f);
      }));
    it("keeps only the real actor local to the service transaction", async () =>
      fixture(async (f) => {
        await sqlClient.begin(async (tx) => {
          await tx`select set_config('app.user_id','prior-service-context',true)`;
          assert.equal(
            (
              await tx`select app_mark_access_sent(${f.command.id}::uuid) as reason`
            )[0]!.reason,
            null,
          );
          assert.equal(
            (await tx`select current_setting('app.user_id') as actor`)[0]!
              .actor,
            "prior-service-context",
          );
        });
        await f.dispatch();
        assert.equal(
          f.sent.length,
          0,
          "an already SENT command is never published again",
        );
      }));
    async function blocked(
      f: Fixture,
      parent: "device" | "gateway" | "user",
      during: (owner: Pick<typeof sqlClient, "unsafe">) => Promise<void>,
    ) {
      let ready!: (pid: number) => void,
        release!: () => void,
        reject!: (e: unknown) => void;
      const acquired = new Promise<number>((r, j) => {
        ready = r;
        reject = j;
      });
      const held = new Promise<void>((r) => {
        release = r;
      });
      let ownerConnection: Pick<typeof sqlClient, "unsafe"> | undefined;
      const blocker = Promise.allSettled([
        sqlClient.begin(async (owner) => {
          ownerConnection = owner;
          await owner`set local statement_timeout='8s'`;
          await owner.unsafe(
            `select id from ${parent === "device" ? "devices" : parent === "gateway" ? "gateways" : "users"} where id=$1 for update`,
            [
              parent === "device"
                ? f.device
                : parent === "gateway"
                  ? f.gateway
                  : f.user,
            ],
          );
          ready((await owner`select pg_backend_pid() as pid`)[0]!.pid);
          await held;
        }),
      ]);
      void blocker.then(([r]) => {
        if (r!.status === "rejected") reject(r.reason);
      });
      let dispatch: Promise<PromiseSettledResult<void>[]> | undefined;
      try {
        const pid = await acquired;
        dispatch = Promise.allSettled([f.dispatch()]);
        let waiting = false;
        for (let i = 0; i < 250; i++) {
          if (
            (
              await sqlClient`select exists(select 1 from pg_stat_activity a where a.usename='predioon' and a.wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid)) and a.query like '%app_mark_access_sent%') as waiting`
            )[0]!.waiting
          ) {
            waiting = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 20));
        }
        assert.equal(
          waiting,
          true,
          "dispatcher must really wait before its final SENT decision",
        );
        await during(ownerConnection!);
      } finally {
        release();
        const results = [...(await blocker), ...((await dispatch) ?? [])];
        for (const result of results)
          if (result.status === "rejected") throw result.reason;
      }
    }
  },
);
