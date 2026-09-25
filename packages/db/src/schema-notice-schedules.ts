import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { buildings, notices } from "./schema.js";

export const noticeSchedules = pgTable("notice_schedules", {
  noticeId: uuid("notice_id").primaryKey().references(() => notices.id, { onDelete: "cascade" }),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  recurrence: text("recurrence").$type<"NONE" | "WEEKLY">().notNull().default("NONE"),
  timeZone: text("time_zone").notNull().default("America/Sao_Paulo"),
}, table => [check("notice_recurrence_ck", sql`${table.recurrence} in ('NONE', 'WEEKLY')`)]);
