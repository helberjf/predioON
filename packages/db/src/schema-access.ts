import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { buildings, devices, gateways, users } from "./schema.js";

/** Explicitly enabled after the administrator binds a dedicated gate controller. */
export const gates = pgTable("gates", {
  id: uuid("id").defaultRandom().primaryKey(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").$type<"GARAGE" | "PEDESTRIAN">().notNull(),
  gatewayId: text("gateway_id").notNull().references(() => gateways.id, { onDelete: "restrict" }),
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "restrict" }),
  enabled: boolean("enabled").notNull().default(false),
  allowResidents: boolean("allow_residents").notNull().default(false),
  /** Residents open only by the totem QR while the add-on is on; managers still use the list (059). */
  requireQr: boolean("require_qr").notNull().default(false),
  /** Bumped by app_gate_qr_renew; part of the QR key, so renewing invalidates every printed or photographed QR. */
  qrGeneration: integer("qr_generation").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("gates_building_idx").on(table.buildingId), uniqueIndex("gates_device_uq").on(table.deviceId)]);

/** Immutable user requests; only the service connection may change delivery/results. */
export const gateCommands = pgTable("gate_commands", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull(),
  gateId: uuid("gate_id").notNull().references(() => gates.id, { onDelete: "restrict" }),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  gatewayId: text("gateway_id").notNull().references(() => gateways.id, { onDelete: "restrict" }),
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "restrict" }),
  requestedBy: text("requested_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: text("status").$type<"PENDING" | "SENT" | "ACKNOWLEDGED" | "FAILED" | "EXPIRED">().notNull().default("PENDING"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("gate_commands_request_uq").on(table.requestedBy, table.requestId),
  index("gate_commands_dispatch_idx").on(table.status, table.createdAt),
  index("gate_commands_building_gate_idx").on(table.buildingId, table.gateId, table.createdAt),
]);
