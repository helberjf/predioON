import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("contrato do suporte remoto", () => {
  async function contract() {
    const modulePath = "../../../packages/shared/src/support.js";
    const loaded = await import(modulePath).catch(() => null);
    assert.ok(loaded, "O contrato de suporte remoto deve estar implementado");
    return loaded;
  }
  it("normaliza apenas IDs numéricos e gera o link oficial sem parâmetros", async () => {
    const { SupportConfigSchema, anydeskUri } = await contract();
    const parsed = SupportConfigSchema.parse({ displayName: "  Portaria  ", anydeskId: "123 456 789", enabled: true });
    assert.equal(parsed.anydeskId, "123456789");
    assert.equal(parsed.displayName, "Portaria");
    assert.equal(anydeskUri(parsed.anydeskId), "anydesk:123456789");
    assert.equal(anydeskUri("1234567890"), "anydesk:1234567890");
    assert.equal(SupportConfigSchema.parse({ displayName: "Portaria", anydeskId: "123456789" }).enabled, false);
  });
  it("recusa URLs, senhas, comandos e IDs incompletos", async () => {
    const { SupportConfigSchema, anydeskUri } = await contract();
    for (const anydeskId of ["anydesk:123456789", "javascript:alert(1)", "123456789?password=secret", "12345678", "12345678901", "nome@empresa", "12345678\n9"]) {
      assert.equal(SupportConfigSchema.safeParse({ displayName: "Portaria", anydeskId }).success, false, anydeskId);
      assert.throws(() => anydeskUri(anydeskId));
    }
    assert.equal(SupportConfigSchema.safeParse({ displayName: "Portaria", anydeskId: "123456789", password: "secret" }).success, false);
  });
  it("exige motivo, idempotência e resultado explícito sem aceitar confirmação automática", async () => {
    const { SupportRequestSchema, SupportOutcomeSchema } = await contract();
    const requestId = "d70f424f-fad3-4b75-9e06-73bf7e1c416f";
    assert.equal(SupportRequestSchema.safeParse({ requestId, reason: "Verificar gateway" }).success, true);
    assert.equal(SupportRequestSchema.safeParse({ requestId, reason: "  " }).success, false);
    assert.equal(SupportRequestSchema.safeParse({ reason: "Verificar gateway" }).success, false);
    assert.equal(SupportRequestSchema.safeParse({ requestId, reason: "Verificar", anydeskId: "999999999" }).success, false);
    for (const outcome of ["RESOLVED", "UNRESOLVED", "NOT_CONNECTED"]) assert.equal(SupportOutcomeSchema.safeParse({ outcome, notes: "Resultado informado pelo técnico" }).success, true);
    assert.equal(SupportOutcomeSchema.safeParse({ outcome: "CONNECTED", notes: "Abriu o programa" }).success, false);
    assert.equal(SupportOutcomeSchema.safeParse({ outcome: "RESOLVED", notes: " " }).success, false);
  });
});
