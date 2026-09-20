/**
 * Pure model of a building's field equipment. No MQTT, no database: it can be unit tested
 * and it is what makes it possible to validate alarms and offline detection with no hardware.
 */
export type Scenario = "normal" | "low-water" | "power-loss" | "leak" | "stuck-sensor" | "gateway-drop";

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
};

const TANK_CAPACITY_LITERS = 10_000;
const CONSUMPTION_PER_TICK = 1.4;
const PUMP_REFILL_PER_TICK = 4;
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
  };
}

function phaseVoltage(base: number, tick: number, offset: number): number {
  return Math.round((base + Math.sin((tick + offset) / 3) * 3) * 10) / 10;
}

/** Advances the simulation one tick. `scenario` injects the failure being exercised. */
export function nextState(state: FieldState, tick: number, scenario: Scenario): FieldState {
  const next: FieldState = { ...state };

  // A stuck sensor keeps reporting the exact same number: the panel must tell this apart
  // from a healthy tank, which is why the platform also tracks communication quality.
  if (scenario !== "stuck-sensor") {
    if (next.pumpRunning) {
      next.waterLevelPercent = Math.min(100, next.waterLevelPercent + PUMP_REFILL_PER_TICK);
    } else {
      next.waterLevelPercent = Math.max(0, next.waterLevelPercent - CONSUMPTION_PER_TICK);
    }
  }

  if (scenario === "low-water") next.waterLevelPercent = Math.min(next.waterLevelPercent, 18);

  // The pump follows the tank, unless the scenario is a power loss.
  if (scenario === "power-loss") next.pumpRunning = false;
  else if (next.waterLevelPercent <= PUMP_ON_BELOW) next.pumpRunning = true;
  else if (next.waterLevelPercent >= PUMP_OFF_ABOVE) next.pumpRunning = false;

  next.waterVolumeLiters = Math.round((next.waterLevelPercent / 100) * TANK_CAPACITY_LITERS);

  const base = scenario === "power-loss" ? 172 : 220;
  next.voltageL1 = phaseVoltage(base, tick, 0);
  next.voltageL2 = phaseVoltage(base, tick, 2);
  next.voltageL3 = scenario === "power-loss" ? 0 : phaseVoltage(base, tick, 4);

  next.leakDetected = scenario === "leak";
  next.temperatureC = Math.round((28 + Math.sin(tick / 4) * 2.5) * 10) / 10;
  next.gatewayOnline = scenario !== "gateway-drop";

  return next;
}
