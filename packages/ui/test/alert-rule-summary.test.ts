import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alertRuleSummary, formatRuleInterval } from "../src/alert-rule-summary.ts";

const base = { metric: "x", operator: "EQ", threshold: 1, severity: "CRITICAL", cooldownSeconds: 300, enabled: true };

describe("resumo discreto da regra de alerta", () => {
  it("descreve uma detecção em linguagem simples", () => {
    assert.equal(alertRuleSummary(base, { label: "Gás detectado", dataType: "boolean" }),
      "Alerta crítico quando detectado · avisa de novo só após 5 min");
  });

  it("descreve um limite numérico com a unidade e o nome da medida", () => {
    assert.equal(alertRuleSummary({ ...base, operator: "GT", threshold: 45, severity: "MEDIUM", cooldownSeconds: 1800 },
      { label: "Temperatura", dataType: "number", unit: "°C" }),
      "Alerta médio temperatura acima de 45 °C · avisa de novo só após 30 min");
    assert.equal(alertRuleSummary({ ...base, operator: "LT", threshold: 10.5, severity: "HIGH", cooldownSeconds: 0 },
      { label: "Nível do reservatório", dataType: "number", unit: "%" }), "Alerta alto nível do reservatório abaixo de 10,5 %");
  });

  it("avisa quando a regra está desativada e não inventa nome para métrica desconhecida", () => {
    assert.match(alertRuleSummary({ ...base, enabled: false }, { label: "Fumaça", dataType: "boolean" }), /\(regra desativada\)$/);
    assert.equal(alertRuleSummary({ ...base, metric: "custom_metric", operator: "GTE", threshold: 3, severity: "LOW", cooldownSeconds: 60 }),
      "Alerta baixo custom_metric a partir de 3 · avisa de novo só após 1 min");
  });

  it("escreve intervalos em segundos, minutos e horas", () => {
    assert.deepEqual([30, 60, 90, 900, 3600, 5400, 7200].map(formatRuleInterval), ["30 s", "1 min", "1,5 min", "15 min", "1 h", "1,5 h", "2 h"]);
  });
});
