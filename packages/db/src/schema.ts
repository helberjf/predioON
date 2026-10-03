import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const membershipRoleEnum = pgEnum("membership_role", ["BUILDING_ADMIN", "RESIDENT"]);
export const gatewayStatusEnum = pgEnum("gateway_status", ["PROVISIONING", "ONLINE", "OFFLINE", "DISABLED", "ERROR"]);
export const deviceStatusEnum = pgEnum("device_status", ["PROVISIONING", "ONLINE", "OFFLINE", "DISABLED", "ERROR"]);
export const telemetryQualityEnum = pgEnum("telemetry_quality", ["GOOD", "UNCERTAIN", "BAD"]);
export const alertSeverityEnum = pgEnum("alert_severity", ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const alertStatusEnum = pgEnum("alert_status", ["OPEN", "ACKNOWLEDGED", "RESOLVED"]);
export const alertOperatorEnum = pgEnum("alert_operator", ["LT", "LTE", "GT", "GTE", "EQ", "NEQ"]);
export const actorTypeEnum = pgEnum("actor_type", ["USER", "SYSTEM", "GATEWAY"]);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    phone: text("phone"),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_uq").on(table.email)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    active: boolean("active").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("organizations_slug_uq").on(table.slug)],
);

export const buildings = pgTable(
  "buildings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    propertyType: text("property_type").notNull().default("CONDOMINIUM"),
    address: jsonb("address").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("buildings_org_code_uq").on(table.organizationId, table.code),
    index("buildings_org_idx").on(table.organizationId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    unit: text("unit"),
    active: boolean("active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_user_building_uq").on(table.userId, table.buildingId),
    index("memberships_building_idx").on(table.buildingId),
  ],
);

export const gateways = pgTable(
  "gateways",
  {
    id: text("id").primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    serialNumber: text("serial_number").notNull(),
    model: text("model"),
    firmwareVersion: text("firmware_version"),
    protocolVersion: text("protocol_version").notNull().default("1"),
    status: gatewayStatusEnum("status").notNull().default("PROVISIONING"),
    enabled: boolean("enabled").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("gateways_serial_number_uq").on(table.serialNumber),
    index("gateways_building_idx").on(table.buildingId),
    index("gateways_last_seen_idx").on(table.lastSeenAt),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: text("id").primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    gatewayId: text("gateway_id").references(() => gateways.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    hardwareAddress: text("hardware_address"),
    status: deviceStatusEnum("status").notNull().default("PROVISIONING"),
    enabled: boolean("enabled").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("devices_building_idx").on(table.buildingId),
    index("devices_gateway_idx").on(table.gatewayId),
    uniqueIndex("devices_building_hardware_uq").on(table.buildingId, table.hardwareAddress),
  ],
);

export const deviceMetrics = pgTable(
  "device_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    unit: text("unit"),
    dataType: text("data_type").notNull().default("number"),
    minExpected: doublePrecision("min_expected"),
    maxExpected: doublePrecision("max_expected"),
    decimals: integer("decimals").notNull().default(2),
    enabled: boolean("enabled").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("device_metrics_device_key_uq").on(table.deviceId, table.key),
    index("device_metrics_building_idx").on(table.buildingId),
  ],
);

/**
 * Normal table used as the idempotency gate before writing to the Timescale hypertable.
 * MQTT QoS 1 may deliver the same event more than once, so event_id must be claimed once.
 */
export const ingestEvents = pgTable(
  "ingest_events",
  {
    eventId: text("event_id").primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("MQTT"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ingest_events_building_received_idx").on(table.buildingId, table.receivedAt)],
);

/**
 * TimescaleDB hypertable after infrastructure/001-timescale-rls.sql is applied.
 * `value` keeps the original value; `numeric_value` accelerates threshold/time-series queries.
 */
export const telemetry = pgTable(
  "telemetry",
  {
    id: uuid("id").defaultRandom().notNull(),
    eventId: text("event_id").notNull(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    value: jsonb("value").$type<number | boolean | string>().notNull(),
    numericValue: doublePrecision("numeric_value"),
    unit: text("unit"),
    quality: telemetryQualityEnum("quality").notNull().default("GOOD"),
    time: timestamp("time", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.time], name: "telemetry_pk" }),
    index("telemetry_device_metric_time_idx").on(table.deviceId, table.metric, table.time),
    index("telemetry_building_time_idx").on(table.buildingId, table.time),
    index("telemetry_event_idx").on(table.eventId),
  ],
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    deviceId: text("device_id").references(() => devices.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    metric: text("metric").notNull(),
    operator: alertOperatorEnum("operator").notNull(),
    threshold: doublePrecision("threshold").notNull(),
    severity: alertSeverityEnum("severity").notNull().default("MEDIUM"),
    alertType: text("alert_type").notNull(),
    messageTemplate: text("message_template").notNull(),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(300),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_rules_building_device_name_uq").on(table.buildingId, table.deviceId, table.name),
    index("alert_rules_building_metric_idx").on(table.buildingId, table.metric),
    index("alert_rules_device_idx").on(table.deviceId),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    // Nullable: a "gateway offline" alert belongs to the gateway, not to a sensor.
    deviceId: text("device_id").references(() => devices.id, { onDelete: "cascade" }),
    gatewayId: text("gateway_id").references(() => gateways.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => alertRules.id, { onDelete: "set null" }),
    severity: alertSeverityEnum("severity").notNull(),
    type: text("type").notNull(),
    status: alertStatusEnum("status").notNull().default("OPEN"),
    message: text("message").notNull(),
    triggeredValue: jsonb("triggered_value").$type<number | boolean | string | null>(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedBy: text("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("alerts_building_status_created_idx").on(table.buildingId, table.status, table.createdAt),
    index("alerts_device_created_idx").on(table.deviceId, table.createdAt),
    index("alerts_rule_created_idx").on(table.ruleId, table.createdAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildingId: text("building_id").references(() => buildings.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: actorTypeEnum("actor_type").notNull().default("USER"),
    // Captured by the database trigger; deliberately no FK on the tenant snapshot.
    scopeKind: text("scope_kind").$type<"PLATFORM" | "BUILDING" | "LEGACY_UNKNOWN">().notNull().default("LEGACY_UNKNOWN"),
    scopeBuildingId: text("scope_building_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_building_created_idx").on(table.buildingId, table.createdAt),
    index("audit_logs_user_created_idx").on(table.userId, table.createdAt),
  ],
);

/** One login/device is one refresh family and one independently revocable access session. */
export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
}, (table) => [index("sessions_user_created_idx").on(table.userId, table.createdAt)]);

/** Hashed opaque tokens; legacy rows have no sessionId and are rejected. */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedByHash: text("replaced_by_hash"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("refresh_tokens_hash_uq").on(table.tokenHash),
    index("refresh_tokens_user_idx").on(table.userId),
    index("refresh_tokens_session_idx").on(table.sessionId),
  ],
);

export const noticeCategoryEnum = pgEnum("notice_category", [
  "COMMUNICATION",
  "MAINTENANCE",
  "EVENT",
  "WASTE_COLLECTION",
  "GESTAO",
]);

/** Building announcements shown to residents (Módulo 04 do portfólio). */
export const notices = pgTable(
  "notices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    category: noticeCategoryEnum("category").notNull().default("COMMUNICATION"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notices_building_published_idx").on(table.buildingId, table.publishedAt)],
);

export const occurrenceStatusEnum = pgEnum("occurrence_status", [
  "OPEN",
  "IN_ANALYSIS",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
]);
export const occurrencePriorityEnum = pgEnum("occurrence_priority", ["LOW", "NORMAL", "HIGH", "URGENT"]);

/** Maintenance tickets opened by residents or by an alert (Módulo 03 do portfólio). */
export const occurrences = pgTable(
  "occurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    protocol: text("protocol").notNull(),
    groupId: uuid("group_id"),
    category: text("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    location: text("location"),
    unit: text("unit"),
    priority: occurrencePriorityEnum("priority").notNull().default("NORMAL"),
    status: occurrenceStatusEnum("status").notNull().default("OPEN"),
    openedBy: text("opened_by").references(() => users.id, { onDelete: "set null" }),
    assignedTo: text("assigned_to").references(() => users.id, { onDelete: "set null" }),
    alertId: uuid("alert_id").references(() => alerts.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("occurrences_protocol_uq").on(table.protocol),
    index("occurrences_building_status_idx").on(table.buildingId, table.status, table.createdAt),
    index("occurrences_opened_by_idx").on(table.openedBy),
  ],
);

/** Append-only timeline of an occurrence: comments and status transitions. */
export const occurrenceEvents = pgTable(
  "occurrence_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => occurrences.id, { onDelete: "cascade" }),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    message: text("message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("occurrence_events_occurrence_idx").on(table.occurrenceId, table.createdAt)],
);

/** Bookable common areas: party room, barbecue, gourmet space, sports court. */
export const commonAreas = pgTable(
  "common_areas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    capacity: integer("capacity"),
    rules: text("rules"),
    opensAt: text("opens_at").notNull().default("08:00"),
    closesAt: text("closes_at").notNull().default("22:00"),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    maxHoursPerBooking: integer("max_hours_per_booking").notNull().default(6),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("common_areas_building_idx").on(table.buildingId)],
);

export const reservationStatusEnum = pgEnum("reservation_status", [
  "PENDING",
  "CONFIRMED",
  "REJECTED",
  "CANCELLED",
]);

/**
 * Double booking is prevented by an exclusion constraint created in
 * infrastructure/003-reservations.sql — application-level checks lose the race.
 */
export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    areaId: uuid("area_id")
      .notNull()
      .references(() => commonAreas.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    unit: text("unit"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: reservationStatusEnum("status").notNull().default("PENDING"),
    notes: text("notes"),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reservations_area_start_idx").on(table.areaId, table.startsAt),
    index("reservations_user_idx").on(table.userId),
    index("reservations_building_start_idx").on(table.buildingId, table.startsAt),
  ],
);

export * from './schema-monitoring.js';
export * from './schema-access.js';
export * from './schema-parking.js';
export * from './schema-notice-schedules.js';
export * from './schema-support.js';
export * from './schema-finance.js';
export * from './schema-features.js';
export * from './schema-rbac.js';
