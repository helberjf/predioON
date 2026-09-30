import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as shared from "@predioon/shared";
import type { z } from "zod";

const input = { organizationId: "org-test", name: "Imóvel de teste", code: "TESTE" };
function contract(name: string): z.ZodObject {
  const schema = Reflect.get(shared, name) as z.ZodObject | undefined;
  assert.ok(schema, `contrato ${name} precisa existir`);
  return schema;
}

describe("configuração de imóveis", () => {
  it("preserva o padrão de condomínio e São Paulo no cadastro sem os novos campos", () => {
    const created = contract("CreatePropertySchema").parse(input);
    assert.equal(created.propertyType, "CONDOMINIUM");
    assert.equal(created.timezone, "America/Sao_Paulo");
  });

  it("aceita condomínio, casa e comercial com fusos válidos", () => {
    for (const propertyType of ["CONDOMINIUM", "HOUSE", "COMMERCIAL"]) {
      for (const timezone of ["America/Sao_Paulo", "America/Manaus", "America/New_York", "UTC", "Etc/GMT+3"]) {
        const result = contract("CreatePropertySchema").parse({ ...input, propertyType, timezone });
        assert.equal(result.propertyType, propertyType);
        assert.equal(result.timezone, timezone);
      }
    }
  });

  it("recusa tipo desconhecido e fuso inválido antes de persistir", () => {
    const schema = contract("CreatePropertySchema");
    for (const propertyType of ["", "APARTMENT", "house", 1, null]) assert.equal(schema.safeParse({ ...input, propertyType }).success, false);
    for (const timezone of ["", " ", "Brazil/Unknown", "+03:00", "-0300", 3, null]) assert.equal(schema.safeParse({ ...input, timezone }).success, false);
  });

  it("não sobrescreve tipo nem fuso quando um PATCH altera somente o nome", () => {
    const schema = contract("UpdatePropertySchema");
    assert.deepEqual(schema.parse({ name: "Novo nome" }), { name: "Novo nome" });
    assert.deepEqual(schema.parse({}), {});
    assert.deepEqual(schema.parse({ propertyType: "HOUSE", timezone: "UTC", active: false }), { propertyType: "HOUSE", timezone: "UTC", active: false });
  });

  it("valida também o PATCH e mantém organização fora dos campos alteráveis", () => {
    const schema = contract("UpdatePropertySchema");
    assert.equal(schema.safeParse({ timezone: "No/Such_Zone" }).success, false);
    assert.equal(schema.safeParse({ propertyType: "invalid" }).success, false);
    assert.deepEqual(schema.parse({ organizationId: "other", name: "Mesmo imóvel" }), { name: "Mesmo imóvel" });
  });
});
