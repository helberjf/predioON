import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAPABILITIES, ROLE_CAPABILITIES, allowsCapability, roleGrants, type AuthorizationSubject } from "@predioon/shared";

const building = "bld-a";
function subject(bindings: AuthorizationSubject["bindings"], supportGrants: AuthorizationSubject["supportGrants"] = []): AuthorizationSubject {
  return { userId: "user-1", active: true, bindings, supportGrants };
}

describe("RBAC explícito por capacidade, condomínio e recurso", () => {
  it("não transforma manutenção em síndico por comparação de papel", () => {
    const maintenance = subject([{ role: "MAINTENANCE", buildingId: building, active: true }]);
    assert.equal(allowsCapability(maintenance, "telemetry:read", { buildingId: building }), true);
    assert.equal(allowsCapability(maintenance, "memberships:manage", { buildingId: building }), false);
    assert.equal(allowsCapability(maintenance, "finance:read", { buildingId: building }), false);
  });
  it("exige o condomínio do vínculo e não aceita apenas o id do recurso", () => {
    const manager = subject([{ role: "BUILDING_ADMIN", buildingId: building, active: true }]);
    assert.equal(allowsCapability(manager, "devices:configure", { buildingId: building, resourceType: "device", resourceId: "device-a" }), true);
    assert.equal(allowsCapability(manager, "devices:configure", { buildingId: "bld-b", resourceType: "device", resourceId: "device-a" }), false);
  });
  it("respeita escopo de recurso e expiração de concessão", () => {
    const manager = subject([{ role: "MAINTENANCE", buildingId: building, resourceType: "work_order", resourceId: "wo-1", active: true }]);
    const now = new Date("2026-09-28T12:00:00.000Z");
    assert.equal(allowsCapability(manager, "work-orders:update-assigned", { buildingId: building, resourceType: "work_order", resourceId: "wo-1" }, now), true);
    assert.equal(allowsCapability(manager, "work-orders:update-assigned", { buildingId: building, resourceType: "work_order", resourceId: "wo-2" }, now), false);
    assert.equal(allowsCapability(subject([{ role: "BUILDING_ADMIN", buildingId: building, active: true, endsAt: "2026-09-28T11:59:59.000Z" }]), "memberships:manage", { buildingId: building }, now), false);
  });
  it("concede suporte somente até o prazo e para a capacidade declarada", () => {
    const support = subject([{ role: "PLATFORM_SUPPORT", buildingId: null, active: true }], [{ buildingId: building, capability: "telemetry:read", active: true, reason: "Diagnóstico solicitado", expiresAt: "2026-09-28T13:00:00.000Z" }]);
    assert.equal(allowsCapability(support, "telemetry:read", { buildingId: building }, new Date("2026-09-28T12:00:00.000Z")), true);
    assert.equal(allowsCapability(support, "devices:configure", { buildingId: building }, new Date("2026-09-28T12:00:00.000Z")), false);
    assert.equal(allowsCapability(support, "telemetry:read", { buildingId: building }, new Date("2026-09-28T13:00:00.000Z")), false);
  });
  it("concede seleção básica e gestão de condomínio somente aos papéis previstos", () => {
    for (const role of ["BUILDING_ADMIN", "MAINTENANCE_MANAGER", "MAINTENANCE", "RESIDENT"] as const) {
      assert.equal(roleGrants(role, "buildings:read"), true);
      assert.equal(roleGrants(role, "buildings:manage"), role === "BUILDING_ADMIN");
      assert.equal(roleGrants(role, "buildings:provision"), false);
      assert.equal(roleGrants(role, "features:manage"), false);
    }
    for (const capability of ["buildings:read", "buildings:manage", "buildings:provision", "features:manage"] as const) {
      assert.equal(roleGrants("PLATFORM_ADMIN", capability), true);
      assert.equal(roleGrants("PLATFORM_SUPPORT", capability), false);
    }
  });
  it("mantém um catálogo finito e explicitamente associado aos papéis", () => {
    assert.ok(CAPABILITIES.includes("platform:read-health"));
    for (const role of ["PLATFORM_SUPPORT", "BUILDING_ADMIN", "MAINTENANCE_MANAGER", "MAINTENANCE", "RESIDENT"] as const) assert.equal(roleGrants(role, "platform:read-health"), false);
    assert.equal(roleGrants("PLATFORM_ADMIN", "platform:read-health"), true);
    assert.ok(CAPABILITIES.includes("commands:request"));
    assert.ok(ROLE_CAPABILITIES.MAINTENANCE.includes("telemetry:read"));
    assert.ok(!ROLE_CAPABILITIES.MAINTENANCE.includes("finance:read"));
  });
  it("áreas comuns exigem capacidade local e respeitam o recurso concedido", () => {
    for (const role of ["BUILDING_ADMIN", "MAINTENANCE_MANAGER", "MAINTENANCE", "RESIDENT"] as const) {
      assert.equal(roleGrants(role, "common-areas:read"), true);
      assert.equal(roleGrants(role, "common-areas:manage"), role === "BUILDING_ADMIN");
    }
    for (const role of ["PLATFORM_ADMIN", "PLATFORM_SUPPORT"] as const) {
      assert.equal(roleGrants(role, "common-areas:read"), false);
      assert.equal(roleGrants(role, "common-areas:manage"), false);
    }
    const exact = subject([{ role: "BUILDING_ADMIN", buildingId: building, resourceType: "common_area", resourceId: "area-1", active: true }]);
    assert.equal(allowsCapability(exact, "common-areas:manage", { buildingId: building, resourceType: "common_area", resourceId: "area-1" }), true);
    assert.equal(allowsCapability(exact, "common-areas:manage", { buildingId: building, resourceType: "common_area", resourceId: "area-2" }), false);
    assert.equal(allowsCapability(exact, "common-areas:manage", { buildingId: building }), false);
  });
  it("não transforma vínculo global em acesso privado ou atuação física", () => {
    for (const role of ["PLATFORM_ADMIN", "PLATFORM_SUPPORT", "BUILDING_ADMIN"] as const) {
      const global = subject([{ role, buildingId: null, active: true }]);
      assert.equal(allowsCapability(global, "telemetry:read", { buildingId: building }), false);
      assert.equal(allowsCapability(global, "commands:request", { buildingId: building }), false);
    }
    assert.equal(roleGrants("PLATFORM_ADMIN", "commands:request"), false);
    assert.equal(roleGrants("PLATFORM_ADMIN", "plans:manage"), true);
    assert.equal(roleGrants("PLATFORM_SUPPORT", "telemetry:read"), false);
  });
  it("falha fechado para datas, papéis, capacidades e escopos inválidos", () => {
    const valid = { role: "BUILDING_ADMIN", buildingId: building, active: true } as const;
    for (const malformed of [{ startsAt: "invalid" }, { endsAt: "invalid" }, { role: "UNKNOWN" }, { resourceType: "unit" }, { resourceId: "u1" }, { resourceType: "unknown", resourceId: "u1" }]) {
      assert.equal(allowsCapability(subject([{ ...valid, ...malformed } as never]), "units:read", { buildingId: building }), false);
    }
    assert.equal(allowsCapability(subject([valid]), "units:read", { buildingId: building }, new Date("invalid")), false);
    assert.equal(allowsCapability(subject([valid]), "units:read", { buildingId: building, resourceId: "u1" }), false);
    assert.equal(roleGrants("UNKNOWN" as never, "units:read"), false);
    assert.equal(allowsCapability(subject([valid]), "UNKNOWN" as never, { buildingId: building }), false);
  });
  it("rejeita suporte sem prazo válido e capacidades fora do diagnóstico", () => {
    for (const grant of [
      { capability: "telemetry:read", expiresAt: "invalid" },
      { capability: "memberships:manage", expiresAt: "2099-01-01T00:00:00Z" },
      { capability: "commands:request", expiresAt: "2099-01-01T00:00:00Z" },
    ] as const) {
      assert.equal(allowsCapability(subject([], [{ buildingId: building, active: true, reason: "Solicitado", ...grant }]), grant.capability, { buildingId: building }), false);
    }
  });
  it("concessão de suporte não sobrevive à revogação do papel de suporte", () => {
    const grant = { buildingId: building, capability: "telemetry:read", active: true, reason: "Solicitado", expiresAt: "2099-01-01T00:00:00Z" } as const;
    for (const bindings of [[], [{ role: "PLATFORM_SUPPORT", buildingId: null, active: false }], [{ role: "PLATFORM_SUPPORT", buildingId: null, active: true, endsAt: "2020-01-01" }], [{ role: "PLATFORM_SUPPORT", buildingId: building, active: true }]] as AuthorizationSubject["bindings"][]) {
      assert.equal(allowsCapability(subject(bindings, [grant]), "telemetry:read", { buildingId: building }), false);
    }
  });
});
