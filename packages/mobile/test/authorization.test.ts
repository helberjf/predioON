import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiClient } from "@predioon/api-client";
import type { BuildingOverview } from "@predioon/contracts";
import {
  alertActionScope,
  occurrenceSummary,
  readOperationsAccess,
  readResourceAuthorization,
} from "../src/authorization.ts";

const overview: BuildingOverview = {
  buildingId: "one",
  coverage: {
    devices: "none",
    gateways: "none",
    alerts: "partial",
    telemetry: "none",
    occurrences: "partial",
  },
  occurrenceVisibility: "scoped",
  counts: {
    devices: null,
    devices_online: null,
    gateways: null,
    gateways_online: null,
    open_alerts: 0,
    open_occurrences: 0,
  },
  latestAlerts: [],
  gateways: [],
};
function api(read: (path: string) => unknown): Pick<ApiClient, "get"> {
  return {
    async get<T>(path: string) {
      return (await read(path)) as T;
    },
  };
}
test("operation discovery tolerates only denied broad scope and keeps current domain coverage separate", async () => {
  const reader = api((path) => {
    if (path.startsWith("/v1/authorization")) throw new ApiError(403, "Denied");
    assert.equal(path, "/overview/building?buildingId=one");
    return overview;
  });
  assert.deepEqual(await readOperationsAccess(reader, "one"), {
    buildingId: "one",
    capabilities: [],
    overview,
  });
  for (const status of [401, 500, 0]) {
    await assert.rejects(
      readOperationsAccess(
        api(() => {
          throw new ApiError(status, "failure");
        }),
        "one",
      ),
    );
  }
  await assert.rejects(
    readOperationsAccess(
      api((path) =>
        path.startsWith("/v1")
          ? { buildingId: "one", capabilities: [] }
          : { ...overview, buildingId: "other" },
      ),
      "one",
    ),
    /escopo/,
  );
});
test("resource authorization checks the entire response scope and never accepts neighbor grants", async () => {
  const request = {
    buildingId: "one",
    resourceType: "occurrence" as const,
    resourceId: "own/id",
  };
  const result = await readResourceAuthorization(
    api((path) => {
      assert.equal(
        path,
        "/v1/authorization?buildingId=one&resourceType=occurrence&resourceId=own%2Fid",
      );
      return { ...request, capabilities: ["occurrences:manage"] };
    }),
    request,
  );
  assert.deepEqual(result.capabilities, ["occurrences:manage"]);
  for (const change of [
    { buildingId: "other" },
    { resourceId: "neighbor" },
    { resourceType: "device" },
    { resourceType: undefined, resourceId: undefined },
  ]) {
    await assert.rejects(
      readResourceAuthorization(
        api(() => ({
          ...request,
          ...change,
          capabilities: ["occurrences:manage"],
        })),
        request,
      ),
      /escopo/,
    );
  }
  assert.deepEqual(
    (
      await readResourceAuthorization(
        api(() => {
          throw new ApiError(403, "revoked");
        }),
        request,
      )
    ).capabilities,
    [],
  );
});
test("alert action evidence is restricted to the alert and its actual device and gateway", () => {
  const alert = {
    id: "alert-one",
    buildingId: "one",
    deviceId: "device-one",
    gatewayId: "gateway-one",
  };
  const authorization = (
    resourceType: "alert" | "device" | "gateway",
    resourceId: string,
    capabilities: ("alerts:read" | "alerts:acknowledge" | "alerts:resolve")[],
  ) => ({ buildingId: "one", resourceType, resourceId, capabilities });
  const own = [
    authorization("alert", alert.id, ["alerts:read"]),
    authorization("device", alert.deviceId, ["alerts:acknowledge"]),
    authorization("gateway", alert.gatewayId, ["alerts:resolve"]),
  ];
  assert.deepEqual(alertActionScope("one", alert, own), {
    acknowledge: true,
    resolve: true,
  });
  assert.deepEqual(
    alertActionScope("one", alert, [
      own[0]!,
      authorization("device", "neighbor", [
        "alerts:acknowledge",
        "alerts:resolve",
      ]),
    ]),
    { acknowledge: false, resolve: false },
  );
  assert.deepEqual(alertActionScope("other", alert, own), {
    acknowledge: false,
    resolve: false,
  });
  assert.deepEqual(alertActionScope("one", alert, own.slice(1)), {
    acknowledge: false,
    resolve: false,
  });
  assert.deepEqual(
    alertActionScope("one", { ...alert, deviceId: null, gatewayId: null }, own),
    { acknowledge: false, resolve: false },
  );
});
test("occurrence summary distinguishes own scoped all zero and unavailable", () => {
  assert.deepEqual(occurrenceSummary(overview), {
    value: "0",
    detail: "Somente chamados concedidos ao seu perfil.",
  });
  assert.equal(
    occurrenceSummary({ ...overview, occurrenceVisibility: "own" }).detail,
    "Somente os chamados abertos por você.",
  );
  assert.equal(
    occurrenceSummary({ ...overview, occurrenceVisibility: "all" }).detail,
    "Todos os chamados autorizados deste condomínio.",
  );
  for (const state of [
    { ...overview, occurrenceVisibility: "none" as const },
    {
      ...overview,
      coverage: { ...overview.coverage, occurrences: "none" as const },
    },
    { ...overview, counts: { ...overview.counts, open_occurrences: null } },
  ]) {
    assert.deepEqual(occurrenceSummary(state), {
      value: "Indisponível",
      detail: "Contagem fora do escopo atual ou módulo indisponível.",
    });
  }
});
