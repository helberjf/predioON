// Runs explicitly through the API's tsx toolchain against an isolated PostgreSQL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createApiClient, type SessionTokens } from "@predioon/api-client";
import { sqlClient } from "../../db/src/index.ts";
import { closeAppDb } from "../../db/src/runtime.ts";
import { hashPassword } from "../../../apps/api/src/auth/passwords.ts";
import { startTestServer } from "../../../apps/api/test/helpers.ts";
import {
  alertActionScope,
  alertTargets,
  readOperationsAccess,
  readResourceAuthorization,
} from "../src/authorization.ts";
import { screensFor } from "../src/scope.ts";

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

test("mobile discovery and selected-resource controls follow the real API after mutation and revocation", async () => {
  const suffix = randomUUID(),
    org = `mobile-scope-${suffix}`,
    buildingId = `${org}-a`,
    otherBuilding = `${org}-b`,
    user = `${org}-user`;
  const device = `${org}-device`,
    otherDevice = `${org}-other-device`,
    alertId = randomUUID(),
    otherAlert = randomUUID();
  const occurrenceId = randomUUID(),
    otherOccurrence = randomUUID(),
    deviceBinding = randomUUID(),
    occurrenceBinding = randomUUID();
  const alertRole = `MOBILE_ALERT_${suffix}`,
    ticketRole = `MOBILE_TICKET_${suffix}`;
  const server = await startTestServer();
  try {
    const passwordHash = await hashPassword("predioon123");
    await sqlClient.begin(async (tx) => {
      await tx`insert into organizations(id,name,slug) values(${org},'Mobile scope',${org})`;
      await tx`insert into buildings(id,organization_id,name,code) values(${buildingId},${org},'A','A'),(${otherBuilding},${org},'B','B')`;
      await tx`insert into users(id,name,email,password_hash) values(${user},'Scoped operator',${user + "@mobile.invalid"},${passwordHash})`;
      for (const role of [alertRole, ticketRole])
        await tx`insert into roles(key,scope,label) values(${role},'BUILDING',${role})`;
      await tx`insert into role_permissions(role_key,permission_key) values(${alertRole},'alerts:read'),(${alertRole},'alerts:acknowledge'),(${ticketRole},'occurrences:manage')`;
      for (const id of [device, otherDevice])
        await tx`insert into devices(id,building_id,name,type) values(${id},${buildingId},'Sensor','WATER_LEVEL_SENSOR')`;
      await tx`insert into alerts(id,building_id,device_id,type,severity,message) values(${alertId},${buildingId},${device},'WATER_LOW','HIGH','Visible alert'),(${otherAlert},${buildingId},${otherDevice},'WATER_LOW','HIGH','Private neighbor alert')`;
      for (const id of [occurrenceId, otherOccurrence])
        await tx`insert into occurrences(id,building_id,protocol,title,description,category,opened_by) values(${id},${buildingId},${"MOBILE-" + id},'Scoped ticket','Private content','GENERAL',${user})`;
      await tx`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${deviceBinding},${user},${buildingId},${alertRole},'device',${device}),(${occurrenceBinding},${user},${buildingId},${ticketRole},'occurrence',${occurrenceId})`;
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
    const features = [{ key: "TICKETS", enabled: true }];
    const access = await readOperationsAccess(api, buildingId);
    assert.deepEqual(access.capabilities, []);
    assert.equal(access.overview?.occurrenceVisibility, "scoped");
    assert.equal(access.overview?.counts.open_occurrences, 1);
    assert.deepEqual(screensFor("operations", { ...access, features }), [
      "overview",
      "alerts",
      "tickets",
    ]);
    const subject = {
      id: alertId,
      buildingId,
      deviceId: device,
      gatewayId: null,
    };
    const scopes = await Promise.all(
      alertTargets(subject).map((target) =>
        readResourceAuthorization(api, target),
      ),
    );
    assert.deepEqual(alertActionScope(buildingId, subject, scopes), {
      acknowledge: true,
      resolve: false,
    });
    assert.deepEqual(
      alertActionScope(
        buildingId,
        { ...subject, id: otherAlert, deviceId: otherDevice },
        scopes,
      ),
      { acknowledge: false, resolve: false },
    );
    await assert.rejects(
      api.post(`/alerts/${otherAlert}/acknowledge`),
      (error) => (error as { status: number }).status === 404,
    );
    await api.post(`/alerts/${alertId}/acknowledge`);
    assert.equal(
      (await sqlClient`select status from alerts where id=${alertId}`)[0]!
        .status,
      "ACKNOWLEDGED",
    );
    const target = {
      buildingId,
      resourceType: "occurrence" as const,
      resourceId: occurrenceId,
    };
    assert.deepEqual(
      (await readResourceAuthorization(api, target)).capabilities,
      ["occurrences:manage"],
    );
    await assert.rejects(
      api.patch(`/occurrences/${otherOccurrence}`, { status: "IN_PROGRESS" }),
      (error) => (error as { status: number }).status === 404,
    );
    await api.patch(`/occurrences/${occurrenceId}`, { status: "IN_PROGRESS" });
    assert.equal(
      (
        await sqlClient`select status from occurrences where id=${occurrenceId}`
      )[0]!.status,
      "IN_PROGRESS",
    );
    await sqlClient`update role_bindings set active=false where id=${deviceBinding}`;
    assert.deepEqual(
      alertActionScope(
        buildingId,
        subject,
        await Promise.all(
          alertTargets(subject).map((target) =>
            readResourceAuthorization(api, target),
          ),
        ),
      ),
      { acknowledge: false, resolve: false },
    );
    assert.deepEqual(
      screensFor("operations", {
        ...(await readOperationsAccess(api, buildingId)),
        features,
      }),
      ["overview", "tickets"],
    );
    await sqlClient`update role_bindings set active=false where id=${occurrenceBinding}`;
    assert.deepEqual(
      (await readResourceAuthorization(api, target)).capabilities,
      [],
    );
    for (const tenant of [buildingId, otherBuilding])
      assert.deepEqual(
        screensFor("operations", {
          ...(await readOperationsAccess(api, tenant)),
          features,
        }),
        [],
      );
    await assert.rejects(
      api.patch(`/occurrences/${occurrenceId}`, { status: "DONE" }),
      (error) => (error as { status: number }).status === 404,
    );
    assert.equal(
      (
        await sqlClient`select status from occurrences where id=${occurrenceId}`
      )[0]!.status,
      "IN_PROGRESS",
    );
    await api.logout();
  } finally {
    await server.close();
    await sqlClient`delete from audit_logs where user_id=${user}`;
    await sqlClient`delete from buildings where organization_id=${org}`;
    await sqlClient`delete from organizations where id=${org}`;
    await sqlClient`delete from users where id=${user}`;
    await sqlClient`delete from roles where key in ${sqlClient([alertRole, ticketRole])}`;
  }
});
