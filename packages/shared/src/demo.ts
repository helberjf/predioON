// Demonstration field simulator: scenarios a platform administrator can trigger
// during a presentation. They change only what a simulated gateway publishes.
export const DEMO_SCENARIOS = ["normal", "low-water", "power-loss", "leak", "stuck-sensor", "gateway-drop",
  "high-energy", "high-water-consumption", "pump-overrun", "gas", "smoke", "sewage-leak"] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];
export const DEMO_SCENARIO_LABELS: Record<DemoScenario, string> = {
  normal: "Tudo normal",
  "low-water": "Caixa d'água baixando",
  "power-loss": "Queda de energia",
  leak: "Vazamento de água",
  "stuck-sensor": "Sensor travado",
  "gateway-drop": "Gateway fora do ar",
  "high-energy": "Consumo de energia alto",
  "high-water-consumption": "Consumo de água alto",
  "pump-overrun": "Bomba ligada demais",
  gas: "Vazamento de gás",
  smoke: "Fumaça detectada",
  "sewage-leak": "Vazamento de esgoto",
};
export type DemoScenarioState = { buildingId: string; scenario: DemoScenario; updatedAt: string | null };
