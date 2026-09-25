import { boolean, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { FeatureKey } from "@predioon/shared";
import { buildings } from "./schema.js";

export const globalFeatureSettings = pgTable("global_feature_settings", {
  key: text("feature_key").$type<FeatureKey>().primaryKey(), enabled: boolean("enabled").notNull().default(true),
  version: integer("version").notNull().default(1), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const buildingFeatureSettings = pgTable("building_feature_settings", {
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  key: text("feature_key").$type<FeatureKey>().notNull(), enabled: boolean("enabled"),
  version: integer("version").notNull().default(1), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.buildingId, table.key] })]);
export const featureRuntime = pgTable("feature_runtime", {
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  key: text("feature_key").$type<FeatureKey>().notNull(),
  resumedAt: timestamp("resumed_at", { withTimezone: true }), pausedAt: timestamp("paused_at", { withTimezone: true }),
  generation: integer("generation").notNull().default(1),
}, table => [primaryKey({ columns: [table.buildingId, table.key] })]);
