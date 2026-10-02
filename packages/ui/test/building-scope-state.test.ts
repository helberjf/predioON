import assert from "node:assert/strict";
import { it } from "node:test";
import { resolveBuildingSelection } from "../src/building-scope-state.ts";

const buildings = [{ id: "b", name: "B" }, { id: "a", name: "A" }];
it("seleciona apenas condomínios retornados pelo servidor", () => {
  assert.equal(resolveBuildingSelection(buildings, "a"), "a");
  assert.equal(resolveBuildingSelection(buildings, "outro-usuario"), "b");
  assert.equal(resolveBuildingSelection([], "a"), null);
});
it("descarta seleção revogada ou desativada sem manter o escopo anterior", () => {
  assert.equal(resolveBuildingSelection([{ id: "a", name: "A", active: false }, buildings[0]!], "a"), "b");
  assert.equal(resolveBuildingSelection([{ id: "a", name: "A", active: false }], "a"), null);
});
