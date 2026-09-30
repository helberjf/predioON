import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, bigint } from "drizzle-orm/pg-core";
import type { FinancialEntry } from "@predioon/shared";
import { buildings, users } from "./schema.js";

export const financialReports = pgTable("financial_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  month: text("month").notNull(), title: text("title").notNull(), summary: text("summary").notNull(),
  openingBalanceCents: bigint("opening_balance_cents", { mode: "number" }).notNull(),
  entries: jsonb("entries").$type<FinancialEntry[]>().notNull().default([]),
  revision: integer("revision").notNull().default(1), version: integer("version").notNull().default(1),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  publishedBy: text("published_by").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("financial_reports_revision_uq").on(table.buildingId, table.month, table.revision)]);
