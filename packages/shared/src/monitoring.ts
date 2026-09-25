import { z } from "zod";
export const MonitoringKindSchema = z.enum(["ENERGY", "WATER", "PUMP"]);
const optionalLimit = z.number().finite().positive().max(1e12).nullable().default(null);
export const MonitoringConfigSchema = z.object({
  tariff: z.number().finite().min(0).max(1e6).nullable().default(null),
  dailyLimit: optionalLimit,
  dailyCostLimit: optionalLimit,
  continuousLimitMinutes: z.number().finite().positive().max(10080).nullable().default(null),
  maxGapSeconds: z.number().int().min(10).max(3600).default(300),
  adaptiveEnabled: z.boolean().default(true),
  minimumHistoryDays: z.number().int().min(7).max(28).default(7),
  deviationPercent: z.number().finite().min(10).max(1000).default(50),
  enabled: z.boolean().default(true),
});
export const CreateMonitoringSchema = MonitoringConfigSchema.extend({
  buildingId: z.string().min(1).max(64), deviceId: z.string().min(1).max(64), kind: MonitoringKindSchema,
});
/** PATCH must not materialize defaults for fields omitted by the caller (including paused AI). */
export const MonitoringPatchSchema = z.object({
  tariff: MonitoringConfigSchema.shape.tariff.removeDefault().optional(),
  dailyLimit: MonitoringConfigSchema.shape.dailyLimit.removeDefault().optional(),
  dailyCostLimit: MonitoringConfigSchema.shape.dailyCostLimit.removeDefault().optional(),
  continuousLimitMinutes: MonitoringConfigSchema.shape.continuousLimitMinutes.removeDefault().optional(),
  maxGapSeconds: MonitoringConfigSchema.shape.maxGapSeconds.removeDefault().optional(),
  adaptiveEnabled: MonitoringConfigSchema.shape.adaptiveEnabled.removeDefault().optional(),
  minimumHistoryDays: MonitoringConfigSchema.shape.minimumHistoryDays.removeDefault().optional(),
  deviationPercent: MonitoringConfigSchema.shape.deviationPercent.removeDefault().optional(),
  enabled: MonitoringConfigSchema.shape.enabled.removeDefault().optional(),
}).strict();
export const USAGE_METRICS = { ENERGY: "energy_total_kwh", WATER: "water_total_m3", PUMP: "pump_running" } as const;
export const USAGE_UNITS = { ENERGY: "kWh", WATER: "m³", PUMP: "min" } as const;
