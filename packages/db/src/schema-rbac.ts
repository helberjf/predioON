import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { buildings, users } from "./schema.js";

/** Physical property hierarchy. A building remains the tenant boundary. */
export const blocks = pgTable("blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("blocks_building_idx").on(table.buildingId), uniqueIndex("blocks_building_code_uq").on(table.buildingId, table.code), uniqueIndex("blocks_id_building_uq").on(table.id, table.buildingId)]);

export const units = pgTable("units", {
  id: uuid("id").defaultRandom().primaryKey(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  blockId: uuid("block_id"),
  code: text("code").notNull(),
  floor: integer("floor"),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("units_building_code_uq").on(table.buildingId, table.code),
  uniqueIndex("units_id_building_uq").on(table.id, table.buildingId),
  index("units_building_idx").on(table.buildingId),
  check("units_floor_ck", sql`${table.floor} is null or ${table.floor} between -10 and 300`),
  foreignKey({ name: "units_block_building_fk", columns: [table.blockId, table.buildingId], foreignColumns: [blocks.id, blocks.buildingId] }).onDelete("restrict"),
]);

export const unitMembershipKindEnum = ["OWNER", "OCCUPANT", "DEPENDENT"] as const;
export type UnitMembershipKind = (typeof unitMembershipKindEnum)[number];

export const unitMemberships = pgTable("unit_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  unitId: uuid("unit_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<UnitMembershipKind>().notNull().default("OCCUPANT"),
  active: boolean("active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("unit_memberships_building_idx").on(table.buildingId),
  index("unit_memberships_user_idx").on(table.userId),
  uniqueIndex("unit_memberships_id_building_uq").on(table.id, table.buildingId),
  foreignKey({ name: "unit_memberships_unit_building_fk", columns: [table.unitId, table.buildingId], foreignColumns: [units.id, units.buildingId] }).onDelete("cascade"),
  check("unit_memberships_kind_check", sql`${table.kind} in ('OWNER', 'OCCUPANT', 'DEPENDENT')`),
  check("unit_memberships_dates_ck", sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`),
]);

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("MAINTENANCE"),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("teams_building_idx").on(table.buildingId), uniqueIndex("teams_id_building_uq").on(table.id, table.buildingId)]);

export const teamMembers = pgTable("team_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("team_members_building_idx").on(table.buildingId),
  index("team_members_user_idx").on(table.userId),
  uniqueIndex("team_members_team_user_uq").on(table.teamId, table.userId),
  uniqueIndex("team_members_id_building_uq").on(table.id, table.buildingId),
  foreignKey({ name: "team_members_team_building_fk", columns: [table.teamId, table.buildingId], foreignColumns: [teams.id, teams.buildingId] }).onDelete("cascade"),
  check("team_members_dates_ck", sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`),
]);

/** Global catalogue; rows are seeded by the additive RBAC migration. */
export const rbacRoles = pgTable("roles", {
  key: text("key").primaryKey(),
  scope: text("scope").notNull().default("BUILDING"),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  system: boolean("system").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [check("roles_scope_check", sql`${table.scope} in ('PLATFORM', 'BUILDING', 'RESOURCE')`)]);

export const rbacPermissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  resourceType: text("resource_type").notNull(),
  action: text("action").notNull(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("permissions_resource_action_uq").on(table.resourceType, table.action)]);

export const rolePermissions = pgTable("role_permissions", {
  roleKey: text("role_key").notNull().references(() => rbacRoles.key, { onDelete: "cascade" }),
  permissionKey: text("permission_key").notNull().references(() => rbacPermissions.key, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.roleKey, table.permissionKey], name: "role_permissions_pkey" })]);

/** A binding can target a user or a team, and can be narrowed to one resource. */
export const roleBindings = pgTable("role_bindings", {
  id: uuid("id").defaultRandom().primaryKey(),
  buildingId: text("building_id").references(() => buildings.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  teamId: uuid("team_id"),
  roleKey: text("role_key").notNull().references(() => rbacRoles.key, { onDelete: "restrict" }),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  active: boolean("active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  grantedBy: text("granted_by").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("role_bindings_building_idx").on(table.buildingId),
  index("role_bindings_user_idx").on(table.userId),
  index("role_bindings_team_idx").on(table.teamId),
  foreignKey({ name: "role_bindings_team_building_fk", columns: [table.teamId, table.buildingId], foreignColumns: [teams.id, teams.buildingId] }).onDelete("cascade"),
  check("role_bindings_team_scope_ck", sql`${table.teamId} is null or ${table.buildingId} is not null`),
  check("role_bindings_scope_ck", sql`(
    (${table.resourceType} is null and ${table.resourceId} is null) or
    (${table.resourceType} is not null and ${table.resourceId} is not null and btrim(${table.resourceId}) <> '' and
      ${table.resourceType} in ('building','block','unit','team','membership','device','gateway','alert','work_order','automation','finance','support_grant','notice','occurrence','telemetry'))
    ) and (
    (${table.roleKey} in ('PLATFORM_ADMIN', 'PLATFORM_SUPPORT') and ${table.buildingId} is null and ${table.teamId} is null and ${table.resourceType} is null)
    or (${table.roleKey} not in ('PLATFORM_ADMIN', 'PLATFORM_SUPPORT') and ${table.buildingId} is not null))`),
  check("role_bindings_subject_ck", sql`(((${table.userId} is not null)::integer + (${table.teamId} is not null)::integer) = 1)`),
  check("role_bindings_resource_ck", sql`(${table.resourceType} is null) = (${table.resourceId} is null)`),
  check("role_bindings_dates_ck", sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`),
]);

/** Temporary, reasoned platform support access, independent from impersonation. */
export const supportGrants = pgTable("support_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  buildingId: text("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  supportUserId: text("support_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  capability: text("capability").notNull().references(() => rbacPermissions.key, { onDelete: "restrict" }),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  grantedBy: text("granted_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("support_grants_user_building_idx").on(table.supportUserId, table.buildingId),
  check("support_grants_resource_ck", sql`(${table.resourceType} is null) = (${table.resourceId} is null)`),
  check("support_grants_valid_ck", sql`(
    (${table.resourceType} is null and ${table.resourceId} is null) or
    (${table.resourceType} is not null and ${table.resourceId} is not null and btrim(${table.resourceId}) <> '' and
      ${table.resourceType} in ('building','block','unit','team','membership','device','gateway','alert','work_order','automation','finance','support_grant','notice','occurrence','telemetry'))
    ) and btrim(${table.reason}) <> ''
    and isfinite(${table.expiresAt}) and ${table.expiresAt} > ${table.createdAt} and ${table.supportUserId} <> ${table.grantedBy}
    and ${table.capability} in ('telemetry:read', 'alerts:read', 'devices:read', 'work-orders:read-assigned', 'support:read')`),
]);
