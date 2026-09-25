import { boolean, doublePrecision, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { buildings, devices } from "./schema.js";

export const monitoringProfiles = pgTable("monitoring_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().$type<"ENERGY" | "WATER" | "PUMP">(),
  tariff: doublePrecision("tariff"), dailyLimit: doublePrecision("daily_limit"), dailyCostLimit: doublePrecision("daily_cost_limit"),
  continuousLimitMinutes: doublePrecision("continuous_limit_minutes"),
  maxGapSeconds: integer("max_gap_seconds").notNull().default(300),
  adaptiveEnabled: boolean("adaptive_enabled").notNull().default(true),
  minimumHistoryDays: integer("minimum_history_days").notNull().default(7),
  deviationPercent: doublePrecision("deviation_percent").notNull().default(50),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("monitoring_device_kind_uq").on(t.deviceId, t.kind), index("monitoring_building_idx").on(t.buildingId)]);

export const usageCursors = pgTable("usage_cursors", {
  profileId: uuid("profile_id").primaryKey().references(() => monitoringProfiles.id, { onDelete: "cascade" }),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  lastAt: timestamp("last_at", { withTimezone: true }).notNull(), lastValue: doublePrecision("last_value").notNull(),
  good: boolean("good").notNull(), continuousSeconds: doublePrecision("continuous_seconds").notNull().default(0),
});

export const dailyUsage = pgTable("daily_usage", {
  profileId: uuid("profile_id").notNull().references(() => monitoringProfiles.id, { onDelete: "cascade" }),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  day: text("day").notNull(), quantity: doublePrecision("quantity").notNull().default(0),
  estimatedCost: doublePrecision("estimated_cost"), coveredSeconds: doublePrecision("covered_seconds").notNull().default(0),
  resets: integer("resets").notNull().default(0), samples: integer("samples").notNull().default(0),
  incomplete: boolean("incomplete").notNull().default(false),
  firstAt: timestamp("first_at", { withTimezone: true }).notNull(), lastAt: timestamp("last_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.profileId, t.day] }), index("daily_usage_building_day_idx").on(t.buildingId, t.day)]);
