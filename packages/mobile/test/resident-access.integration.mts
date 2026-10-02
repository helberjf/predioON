import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  ApiError,
  createApiClient,
  type SessionTokens,
} from "@predioon/api-client";
import type { AccessList } from "@predioon/contracts";
import { sqlClient } from "../../db/src/index.ts";
import { closeAppDb } from "../../db/src/runtime.ts";
import { hashPassword } from "../../../apps/api/src/auth/passwords.ts";
import { startTestServer } from "../../../apps/api/test/helpers.ts";
import { readResidentAccess } from "../src/authorization.ts";
import { screensFor, type Feature } from "../src/scope.ts";

const url = new URL(process.env.DATABASE_URL ?? "https://missing.invalid");
if (
  process.env.RUN_MOBILE_DB_TESTS !== "1" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
)
  throw new Error(
    "Use an explicitly enabled isolated loopback database for mobile integration tests",
  );
after(async () => {
  await closeAppDb();
  await sqlClient.end();
});

test("native gate navigation follows exact gate/device/gateway grants without command authority or neighbor data", async () => {
  const suffix = randomUUID(),
    org = `mobile-access-${suffix}`,
    buildingId = `${org}-own`,
    foreign = `${org}-foreign`,
    user = `${org}-user`;
  const role = `MOBILE_ACCESS_${suffix}`,
    binding = randomUUID();
  const targets = [buildingId, buildingId, foreign].map((building, index) => ({
    building,
    gateway: `${org}-gw-${index}`,
    device: `${org}-dev-${index}`,
    gate: randomUUID(),
  }));
  const own = targets[0]!;
  const server = await startTestServer();
  try {
    const hash = await hashPassword("predioon123");
    await sqlClient.begin(async (tx) => {
      await tx`insert into organizations(id,name,slug) values(${org},'Native gate navigation',${org})`;
      for (const id of [buildingId, foreign])
        await tx`insert into buildings(id,organization_id,name,code) values(${id},${org},${id},${id})`;
      await tx`insert into users(id,name,email,password_hash) values(${user},'Gate reader',${user + "@mobile.invalid"},${hash})`;
      await tx`insert into roles(key,scope,label) values(${role},'BUILDING',${role})`;
      await tx`insert into role_permissions(role_key,permission_key) values(${role},'gates:read')`;
      for (const target of targets) {
        await tx`insert into gateways(id,building_id,name,serial_number,status,last_seen_at) values(${target.gateway},${target.building},'Gateway',${target.gateway},'ONLINE',clock_timestamp())`;
        await tx`insert into devices(id,building_id,gateway_id,name,type,status,last_seen_at) values(${target.device},${target.building},${target.gateway},'Controller','GATE_CONTROLLER','ONLINE',clock_timestamp())`;
        await tx`insert into gates(id,building_id,name,kind,gateway_id,device_id,enabled,allow_residents) values(${target.gate},${target.building},'Gate','GARAGE',${target.gateway},${target.device},true,true)`;
      }
      await tx`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${binding},${user},${buildingId},${role},'gate',${own.gate})`;
    });
    let tokens: SessionTokens | null = null;
    const api = createApiClient({
      baseUrl: server.url,
      fetch,
      storage: {
        async getTokens() {
          return tokens;
        },
        async setTokens(value) {
          tokens = value;
        },
        async clearTokens() {
          tokens = null;
        },
      },
    });
    await api.login(user + "@mobile.invalid", "predioon123");
    await assert.rejects(
      api.get(`/v1/authorization?buildingId=${buildingId}`),
      (error) => error instanceof ApiError && error.status === 403,
    );
    // Domain reading does not implicitly grant basic tenant discovery. Keep
    // that separate permission on the very same exact resource, never broad.
    assert.equal(
      (await readResidentAccess(api, buildingId)).access.readable,
      true,
    );
    await assert.rejects(
      api.get(`/features/buildings/${buildingId}`),
      (error) => error instanceof ApiError && error.status === 403,
    );
    assert.deepEqual(
      (await api.get<{ items: unknown[] }>("/buildings")).items,
      [],
    );
    await sqlClient`insert into role_permissions(role_key,permission_key) values(${role},'buildings:read')`;
    assert.deepEqual(
      (await api.get<{ items: { id: string }[] }>("/buildings")).items.map(
        (item) => item.id,
      ),
      [buildingId],
    );
    const features = (
      await api.get<{ items: Feature[] }>(`/features/buildings/${buildingId}`)
    ).items;
    for (const [type, id] of [
      ["gate", own.gate],
      ["device", own.device],
      ["gateway", own.gateway],
    ]) {
      await sqlClient`update role_bindings set resource_type=${type!},resource_id=${id!} where id=${binding}`;
      const access = await readResidentAccess(api, buildingId);
      assert.deepEqual(access.capabilities, []);
      assert.deepEqual(screensFor("resident", { ...access, features }), [
        "access",
      ]);
      const list = await api.get<AccessList>(
        `/access?buildingId=${buildingId}`,
      );
      assert.deepEqual(
        list.items.map((item) => item.id),
        [own.gate],
      );
      assert.equal(list.items[0]!.available, false);
      assert.equal(list.canManage, false);
      assert.deepEqual(list.devices, []);
      assert.deepEqual(list.gateways, []);
      assert.equal(list.items[0]!.latestCommand, null);
    }
    assert.deepEqual(
      screensFor("resident", {
        ...(await readResidentAccess(api, foreign)),
        features,
      }),
      [],
    );
    await sqlClient`update role_bindings set resource_type='gate',resource_id=${randomUUID()} where id=${binding}`;
    assert.equal(
      (await readResidentAccess(api, buildingId)).access.readable,
      false,
    );
    await sqlClient`update role_bindings set resource_id=${own.gate},active=false where id=${binding}`;
    const revoked = await readResidentAccess(api, buildingId);
    assert.deepEqual(screensFor("resident", { ...revoked, features }), []);
    await assert.rejects(
      api.get(`/access?buildingId=${buildingId}`),
      (error) => error instanceof ApiError && error.status === 403,
    );
    assert.equal(
      (
        await sqlClient`select count(*)::int as total from gate_commands where building_id in ${sqlClient([buildingId, foreign])}`
      )[0]!.total,
      0,
    );
    await api.logout();
  } finally {
    await server.close();
    await sqlClient.begin(async (tx) => {
      await tx`delete from audit_logs where user_id=${user}`;
      await tx`delete from gate_commands where building_id in ${tx([buildingId, foreign])}`;
      await tx`delete from buildings where organization_id=${org}`;
      await tx`delete from organizations where id=${org}`;
      await tx`delete from users where id=${user}`;
      await tx`delete from roles where key=${role}`;
    });
  }
});
