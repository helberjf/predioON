import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { buildings, devices } from "./schema.js";

export const parkingLots = pgTable("parking_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  vehicleType: text("vehicle_type").$type<"CAR" | "MOTORCYCLE">().notNull(),
  capacity: integer("capacity").notNull(),
  occupied: integer("occupied"),
  source: text("source").$type<"UNKNOWN" | "MANUAL" | "SENSOR">().notNull().default("UNKNOWN"),
  sensorId: text("sensor_id").references(() => devices.id, { onDelete: "set null" }),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  staleAfterSeconds: integer("stale_after_seconds").notNull().default(300),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("parking_lots_building_type_uq").on(table.buildingId, table.vehicleType),
  uniqueIndex("parking_lots_sensor_uq").on(table.sensorId),
  check("parking_vehicle_type_ck", sql`${table.vehicleType} in ('CAR', 'MOTORCYCLE')`),
  check("parking_capacity_ck", sql`${table.capacity} between 0 and 100000`),
  check("parking_occupied_ck", sql`${table.occupied} is null or (${table.occupied} >= 0 and ${table.occupied} <= ${table.capacity})`),
  check("parking_source_ck", sql`${table.source} in ('UNKNOWN', 'MANUAL', 'SENSOR')`),
  check("parking_observation_ck", sql`(${table.occupied} is null and ${table.observedAt} is null and ${table.source} = 'UNKNOWN') or (${table.occupied} is not null and ${table.observedAt} is not null and ${table.source} <> 'UNKNOWN')`),
  check("parking_freshness_ck", sql`${table.staleAfterSeconds} between 30 and 86400`),
  check("parking_version_ck", sql`${table.version} > 0`),
]);
