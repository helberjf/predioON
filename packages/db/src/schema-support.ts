import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { buildings, users } from "./schema.js";

export const supportHosts = pgTable("support_hosts", {
  buildingId: text("building_id").primaryKey().references(() => buildings.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  anydeskId: text("anydesk_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A launch request and a manually reported outcome, never evidence of a remote session. */
export const supportRequests = pgTable("support_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  requestedBy: text("requested_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  displayName: text("display_name").notNull(),
  anydeskId: text("anydesk_id").notNull(),
  configRevision: integer("config_revision").notNull(),
  reason: text("reason").notNull(),
  status: text("status").$type<"OPEN" | "RESOLVED" | "UNRESOLVED" | "NOT_CONNECTED">().notNull().default("OPEN"),
  notes: text("notes"),
  closedBy: text("closed_by").references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, table => [
  uniqueIndex("support_requests_request_uq").on(table.requestedBy, table.requestId),
  index("support_requests_building_created_idx").on(table.buildingId, table.createdAt),
]);
