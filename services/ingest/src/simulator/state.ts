/**
 * Pure model of a building's field equipment. No MQTT, no database: it can be unit tested
 * and it is what makes it possible to validate alarms and offline detection with no hardware.
 */
export const SCENARIOS = ["normal", "low-water", "power-loss", "leak", "stuck-sensor", "gateway-drop",
  "high-energy", "high-water-consumption", "pump-overrun", "gas", "smoke", "sewage-leak"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export type FieldState = {
  waterLevelPercent: number;
  waterVolumeLiters: number;
  pumpRunning: boolean;
  voltageL1: number;
  voltageL2: number;
  voltageL3: number;
  leakDetected: boolean;
  temperatureC: number;
  gatewayOnline: boolean;
  energyTotalKwh: number;
  waterTotalM3: number;
  currentL1: number;
  currentL2: number;
  currentL3: number;
  frequencyHz: number;
  gasDetected: boolean;
  gasPpm: number;
  smokeDetected: boolean;
  sewageLeakDetected: boolean;
};

const TANK_CAPACITY_LITERS = 10_000;
const PUMP_ON_BELOW = 35;
const PUMP_OFF_ABOVE = 95;

export function initialState(): FieldState {
  return {
    waterLevelPercent: 78,
    waterVolumeLiters: Math.round(TANK_CAPACITY_LITERS * 0.78),
    pumpRunning: false,
    voltageL1: 220,
    voltageL2: 219,
    voltageL3: 221,
    leakDetected: false,
    temperatureC: 28,
    gatewayOnline: true,
    energyTotalKwh: 12450,
    waterTotalM3: 840,
    currentL1: 20,
    currentL2: 19.8,
    currentL3: 20.2,
    frequencyHz: 60,
    gasDetected: false,
    gasPpm: 0,
    smokeDetected: false,
    sewageLeakDetected: false,
  };
}

function phaseVoltage(base: number, tick: number, offset: number): number {
  return Math.round((base + Math.sin((tick + offset) / 3) * 3) * 10) / 10;
}

/** Advances the simulation one tick. `scenario` injects the failure being exercised. */
export function nextState(state: FieldState, tick: number, scenario: Scenario, elapsedSeconds = 5): FieldState {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) throw new Error("O intervalo simulado deve ser positivo e finito");
  const next: FieldState = { ...state };
  const hours = elapsedSeconds / 3600;
  const demandM3h = (1.8 + Math.sin(tick / 12) * 0.2) * (scenario === "high-water-consumption" ? 6 : 1);
  const refillM3h = state.pumpRunning && scenario !== "power-loss" ? 7.2 : 0;
  next.waterTotalM3 = state.waterTotalM3 + demandM3h * hours;
  const powerKw = scenario === "power-loss" ? 0 : (12 + Math.sin(tick / 9) * 1.5) * (scenario === "high-energy" ? 5 : 1);
  next.energyTotalKwh = state.energyTotalKwh + powerKw * hours;

  // A stuck sensor keeps reporting the exact same number: the panel must tell this apart
  // from a healthy tank, which is why the platform also tracks communication quality.
  if (scenario !== "stuck-sensor") {
    next.waterLevelPercent = Math.max(0, Math.min(100,
      state.waterLevelPercent + ((refillM3h - demandM3h) * hours * 1000 / TANK_CAPACITY_LITERS) * 100));
  }

  if (scenario === "low-water") next.waterLevelPercent = Math.min(next.waterLevelPercent, 18);

  // The pump follows the tank, unless the scenario is a power loss.
  if (scenario === "power-loss") next.pumpRunning = false;
  else if (scenario === "pump-overrun") next.pumpRunning = true;
  else if (next.waterLevelPercent <= PUMP_ON_BELOW) next.pumpRunning = true;
  else if (next.waterLevelPercent >= PUMP_OFF_ABOVE) next.pumpRunning = false;

  // Arredonda como um gateway real faria: ninguém publica 41.19999999999987%.
  next.waterLevelPercent = Math.round(next.waterLevelPercent * 1000) / 1000;
  next.waterVolumeLiters = Math.round((next.waterLevelPercent / 100) * TANK_CAPACITY_LITERS);

  const base = scenario === "power-loss" ? 172 : 220;
  next.voltageL1 = phaseVoltage(base, tick, 0);
  next.voltageL2 = phaseVoltage(base, tick, 2);
  next.voltageL3 = scenario === "power-loss" ? 0 : phaseVoltage(base, tick, 4);

  next.leakDetected = scenario === "leak";
  next.temperatureC = Math.round((28 + Math.sin(tick / 4) * 2.5) * 10) / 10;
  next.gatewayOnline = scenario !== "gateway-drop";
  next.currentL1 = Math.round(powerKw * 1000 / 3 / 220 / 0.92 * 100) / 100;
  next.currentL2 = Math.round(next.currentL1 * 0.98 * 100) / 100;
  next.currentL3 = Math.round(next.currentL1 * 1.02 * 100) / 100;
  next.frequencyHz = scenario === "power-loss" ? 0 : Math.round((60 + Math.sin(tick / 7) * 0.03) * 100) / 100;
  next.gasDetected = scenario === "gas";
  next.gasPpm = scenario === "gas" ? Math.round(1800 + Math.sin(tick / 4) * 100) : 0;
  next.smokeDetected = scenario === "smoke";
  next.sewageLeakDetected = scenario === "sewage-leak";

  return next;
}
