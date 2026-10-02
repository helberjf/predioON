CREATE TYPE "public"."actor_type" AS ENUM('USER', 'SYSTEM', 'GATEWAY');--> statement-breakpoint
CREATE TYPE "public"."alert_operator" AS ENUM('LT', 'LTE', 'GT', 'GTE', 'EQ', 'NEQ');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('PROVISIONING', 'ONLINE', 'OFFLINE', 'DISABLED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."gateway_status" AS ENUM('PROVISIONING', 'ONLINE', 'OFFLINE', 'DISABLED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('BUILDING_ADMIN', 'RESIDENT');--> statement-breakpoint
CREATE TYPE "public"."notice_category" AS ENUM('COMMUNICATION', 'MAINTENANCE', 'EVENT', 'WASTE_COLLECTION', 'GESTAO');--> statement-breakpoint
CREATE TYPE "public"."occurrence_priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('OPEN', 'IN_ANALYSIS', 'IN_PROGRESS', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."telemetry_quality" AS ENUM('GOOD', 'UNCERTAIN', 'BAD');--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"device_id" text,
	"name" text NOT NULL,
	"metric" text NOT NULL,
	"operator" "alert_operator" NOT NULL,
	"threshold" double precision NOT NULL,
	"severity" "alert_severity" DEFAULT 'MEDIUM' NOT NULL,
	"alert_type" text NOT NULL,
	"message_template" text NOT NULL,
	"cooldown_seconds" integer DEFAULT 300 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"device_id" text,
	"gateway_id" text,
	"rule_id" uuid,
	"severity" "alert_severity" NOT NULL,
	"type" text NOT NULL,
	"status" "alert_status" DEFAULT 'OPEN' NOT NULL,
	"message" text NOT NULL,
	"triggered_value" jsonb,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text,
	"user_id" text,
	"actor_type" "actor_type" DEFAULT 'USER' NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"property_type" text DEFAULT 'CONDOMINIUM' NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "common_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"capacity" integer,
	"rules" text,
	"opens_at" text DEFAULT '08:00' NOT NULL,
	"closes_at" text DEFAULT '22:00' NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"max_hours_per_booking" integer DEFAULT 6 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"device_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"unit" text,
	"data_type" text DEFAULT 'number' NOT NULL,
	"min_expected" double precision,
	"max_expected" double precision,
	"decimals" integer DEFAULT 2 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"building_id" text NOT NULL,
	"gateway_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"hardware_address" text,
	"status" "device_status" DEFAULT 'PROVISIONING' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateways" (
	"id" text PRIMARY KEY NOT NULL,
	"building_id" text NOT NULL,
	"name" text NOT NULL,
	"serial_number" text NOT NULL,
	"model" text,
	"firmware_version" text,
	"protocol_version" text DEFAULT '1' NOT NULL,
	"status" "gateway_status" DEFAULT 'PROVISIONING' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"building_id" text NOT NULL,
	"device_id" text NOT NULL,
	"source" text DEFAULT 'MQTT' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"building_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"unit" text,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"category" "notice_category" DEFAULT 'COMMUNICATION' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occurrence_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"building_id" text NOT NULL,
	"author_id" text,
	"kind" text NOT NULL,
	"message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"protocol" text NOT NULL,
	"group_id" uuid,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"unit" text,
	"priority" "occurrence_priority" DEFAULT 'NORMAL' NOT NULL,
	"status" "occurrence_status" DEFAULT 'OPEN' NOT NULL,
	"opened_by" text,
	"assigned_to" text,
	"alert_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_hash" text,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"area_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"unit" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "reservation_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"building_id" text NOT NULL,
	"device_id" text NOT NULL,
	"metric" text NOT NULL,
	"value" jsonb NOT NULL,
	"numeric_value" double precision,
	"unit" text,
	"quality" "telemetry_quality" DEFAULT 'GOOD' NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telemetry_pk" PRIMARY KEY("id","time")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"phone" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_usage" (
	"profile_id" uuid NOT NULL,
	"building_id" text NOT NULL,
	"day" text NOT NULL,
	"quantity" double precision DEFAULT 0 NOT NULL,
	"estimated_cost" double precision,
	"covered_seconds" double precision DEFAULT 0 NOT NULL,
	"resets" integer DEFAULT 0 NOT NULL,
	"samples" integer DEFAULT 0 NOT NULL,
	"incomplete" boolean DEFAULT false NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "daily_usage_profile_id_day_pk" PRIMARY KEY("profile_id","day")
);
--> statement-breakpoint
CREATE TABLE "monitoring_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"device_id" text NOT NULL,
	"kind" text NOT NULL,
	"tariff" double precision,
	"daily_limit" double precision,
	"daily_cost_limit" double precision,
	"continuous_limit_minutes" double precision,
	"max_gap_seconds" integer DEFAULT 300 NOT NULL,
	"adaptive_enabled" boolean DEFAULT true NOT NULL,
	"minimum_history_days" integer DEFAULT 7 NOT NULL,
	"deviation_percent" double precision DEFAULT 50 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_cursors" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"building_id" text NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"last_value" double precision NOT NULL,
	"good" boolean NOT NULL,
	"continuous_seconds" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"gate_id" uuid NOT NULL,
	"building_id" text NOT NULL,
	"gateway_id" text NOT NULL,
	"device_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"gateway_id" text NOT NULL,
	"device_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allow_residents" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parking_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"capacity" integer NOT NULL,
	"occupied" integer,
	"source" text DEFAULT 'UNKNOWN' NOT NULL,
	"sensor_id" text,
	"observed_at" timestamp with time zone,
	"stale_after_seconds" integer DEFAULT 300 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_vehicle_type_ck" CHECK ("parking_lots"."vehicle_type" in ('CAR', 'MOTORCYCLE')),
	CONSTRAINT "parking_capacity_ck" CHECK ("parking_lots"."capacity" between 0 and 100000),
	CONSTRAINT "parking_occupied_ck" CHECK ("parking_lots"."occupied" is null or ("parking_lots"."occupied" >= 0 and "parking_lots"."occupied" <= "parking_lots"."capacity")),
	CONSTRAINT "parking_source_ck" CHECK ("parking_lots"."source" in ('UNKNOWN', 'MANUAL', 'SENSOR')),
	CONSTRAINT "parking_observation_ck" CHECK (("parking_lots"."occupied" is null and "parking_lots"."observed_at" is null and "parking_lots"."source" = 'UNKNOWN') or ("parking_lots"."occupied" is not null and "parking_lots"."observed_at" is not null and "parking_lots"."source" <> 'UNKNOWN')),
	CONSTRAINT "parking_freshness_ck" CHECK ("parking_lots"."stale_after_seconds" between 30 and 86400),
	CONSTRAINT "parking_version_ck" CHECK ("parking_lots"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "notice_schedules" (
	"notice_id" uuid PRIMARY KEY NOT NULL,
	"building_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"recurrence" text DEFAULT 'NONE' NOT NULL,
	"time_zone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	CONSTRAINT "notice_recurrence_ck" CHECK ("notice_schedules"."recurrence" in ('NONE', 'WEEKLY'))
);
--> statement-breakpoint
CREATE TABLE "support_hosts" (
	"building_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"anydesk_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"building_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"display_name" text NOT NULL,
	"anydesk_id" text NOT NULL,
	"config_revision" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"notes" text,
	"closed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "financial_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"month" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"opening_balance_cents" bigint NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "building_feature_settings" (
	"building_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "building_feature_settings_building_id_feature_key_pk" PRIMARY KEY("building_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "feature_runtime" (
	"building_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"resumed_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"generation" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "feature_runtime_building_id_feature_key_pk" PRIMARY KEY("building_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "global_feature_settings" (
	"feature_key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "common_areas" ADD CONSTRAINT "common_areas_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_metrics" ADD CONSTRAINT "device_metrics_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_metrics" ADD CONSTRAINT "device_metrics_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_events" ADD CONSTRAINT "occurrence_events_occurrence_id_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_events" ADD CONSTRAINT "occurrence_events_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_events" ADD CONSTRAINT "occurrence_events_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_area_id_common_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."common_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry" ADD CONSTRAINT "telemetry_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry" ADD CONSTRAINT "telemetry_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_usage" ADD CONSTRAINT "daily_usage_profile_id_monitoring_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."monitoring_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_usage" ADD CONSTRAINT "daily_usage_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_profiles" ADD CONSTRAINT "monitoring_profiles_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_profiles" ADD CONSTRAINT "monitoring_profiles_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_cursors" ADD CONSTRAINT "usage_cursors_profile_id_monitoring_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."monitoring_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_cursors" ADD CONSTRAINT "usage_cursors_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_commands" ADD CONSTRAINT "gate_commands_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_commands" ADD CONSTRAINT "gate_commands_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_commands" ADD CONSTRAINT "gate_commands_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_commands" ADD CONSTRAINT "gate_commands_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_commands" ADD CONSTRAINT "gate_commands_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_lots" ADD CONSTRAINT "parking_lots_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_lots" ADD CONSTRAINT "parking_lots_sensor_id_devices_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_schedules" ADD CONSTRAINT "notice_schedules_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_schedules" ADD CONSTRAINT "notice_schedules_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_hosts" ADD CONSTRAINT "support_hosts_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_feature_settings" ADD CONSTRAINT "building_feature_settings_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_runtime" ADD CONSTRAINT "feature_runtime_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_building_device_name_uq" ON "alert_rules" USING btree ("building_id","device_id","name");--> statement-breakpoint
CREATE INDEX "alert_rules_building_metric_idx" ON "alert_rules" USING btree ("building_id","metric");--> statement-breakpoint
CREATE INDEX "alert_rules_device_idx" ON "alert_rules" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "alerts_building_status_created_idx" ON "alerts" USING btree ("building_id","status","created_at");--> statement-breakpoint
CREATE INDEX "alerts_device_created_idx" ON "alerts" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "alerts_rule_created_idx" ON "alerts" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_building_created_idx" ON "audit_logs" USING btree ("building_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_user_created_idx" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buildings_org_code_uq" ON "buildings" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "buildings_org_idx" ON "buildings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "common_areas_building_idx" ON "common_areas" USING btree ("building_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_metrics_device_key_uq" ON "device_metrics" USING btree ("device_id","key");--> statement-breakpoint
CREATE INDEX "device_metrics_building_idx" ON "device_metrics" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "devices_building_idx" ON "devices" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "devices_gateway_idx" ON "devices" USING btree ("gateway_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_building_hardware_uq" ON "devices" USING btree ("building_id","hardware_address");--> statement-breakpoint
CREATE UNIQUE INDEX "gateways_serial_number_uq" ON "gateways" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "gateways_building_idx" ON "gateways" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "gateways_last_seen_idx" ON "gateways" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "ingest_events_building_received_idx" ON "ingest_events" USING btree ("building_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_building_uq" ON "memberships" USING btree ("user_id","building_id");--> statement-breakpoint
CREATE INDEX "memberships_building_idx" ON "memberships" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "notices_building_published_idx" ON "notices" USING btree ("building_id","published_at");--> statement-breakpoint
CREATE INDEX "occurrence_events_occurrence_idx" ON "occurrence_events" USING btree ("occurrence_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_protocol_uq" ON "occurrences" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "occurrences_building_status_idx" ON "occurrences" USING btree ("building_id","status","created_at");--> statement-breakpoint
CREATE INDEX "occurrences_opened_by_idx" ON "occurrences" USING btree ("opened_by");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reservations_area_start_idx" ON "reservations" USING btree ("area_id","starts_at");--> statement-breakpoint
CREATE INDEX "reservations_user_idx" ON "reservations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reservations_building_start_idx" ON "reservations" USING btree ("building_id","starts_at");--> statement-breakpoint
CREATE INDEX "telemetry_device_metric_time_idx" ON "telemetry" USING btree ("device_id","metric","time");--> statement-breakpoint
CREATE INDEX "telemetry_building_time_idx" ON "telemetry" USING btree ("building_id","time");--> statement-breakpoint
CREATE INDEX "telemetry_event_idx" ON "telemetry" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "daily_usage_building_day_idx" ON "daily_usage" USING btree ("building_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_device_kind_uq" ON "monitoring_profiles" USING btree ("device_id","kind");--> statement-breakpoint
CREATE INDEX "monitoring_building_idx" ON "monitoring_profiles" USING btree ("building_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_commands_request_uq" ON "gate_commands" USING btree ("requested_by","request_id");--> statement-breakpoint
CREATE INDEX "gate_commands_dispatch_idx" ON "gate_commands" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "gate_commands_building_gate_idx" ON "gate_commands" USING btree ("building_id","gate_id","created_at");--> statement-breakpoint
CREATE INDEX "gates_building_idx" ON "gates" USING btree ("building_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gates_device_uq" ON "gates" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parking_lots_building_type_uq" ON "parking_lots" USING btree ("building_id","vehicle_type");--> statement-breakpoint
CREATE UNIQUE INDEX "parking_lots_sensor_uq" ON "parking_lots" USING btree ("sensor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_requests_request_uq" ON "support_requests" USING btree ("requested_by","request_id");--> statement-breakpoint
CREATE INDEX "support_requests_building_created_idx" ON "support_requests" USING btree ("building_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_reports_revision_uq" ON "financial_reports" USING btree ("building_id","month","revision");