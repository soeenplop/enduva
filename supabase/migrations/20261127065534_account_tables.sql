CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"consent_version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_purpose_check" CHECK ("app"."consents"."purpose" in ('health_data', 'ai_nutrition', 'ai_coach')),
	CONSTRAINT "consents_revoked_after_granted_check" CHECK ("app"."consents"."revoked_at" is null or "app"."consents"."revoked_at" >= "app"."consents"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "app"."devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"auth_session_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_kind_check" CHECK ("app"."devices"."kind" in ('iphone', 'watch', 'web'))
);
--> statement-breakpoint
CREATE TABLE "app"."entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_tier_check" CHECK ("app"."entitlements"."tier" in ('free', 'premium')),
	CONSTRAINT "entitlements_source_check" CHECK ("app"."entitlements"."source" in ('manual', 'app_store', 'web')),
	CONSTRAINT "entitlements_validity_check" CHECK ("app"."entitlements"."valid_until" is null or "app"."entitlements"."valid_until" > "app"."entitlements"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "app"."profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"avatar_path" text,
	"birth_date" date,
	"sex" text,
	"height_cm" real,
	"locale" text DEFAULT 'de' NOT NULL,
	"time_zone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_sex_check" CHECK ("app"."profiles"."sex" in ('female', 'male')),
	CONSTRAINT "profiles_height_cm_check" CHECK ("app"."profiles"."height_cm" between 50 and 300),
	CONSTRAINT "profiles_locale_check" CHECK ("app"."profiles"."locale" in ('de', 'en')),
	CONSTRAINT "profiles_role_check" CHECK ("app"."profiles"."role" in ('user', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "app"."user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"week_start" smallint DEFAULT 1 NOT NULL,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health_sync" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_theme_check" CHECK ("app"."user_settings"."theme" in ('system', 'light', 'dark')),
	CONSTRAINT "user_settings_week_start_check" CHECK ("app"."user_settings"."week_start" between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE "app"."consents" ADD CONSTRAINT "consents_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."devices" ADD CONSTRAINT "devices_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entitlements" ADD CONSTRAINT "entitlements_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_settings" ADD CONSTRAINT "user_settings_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consents_active_purpose_key" ON "app"."consents" USING btree ("user_id","purpose") WHERE "app"."consents"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "app"."devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_auth_session_id_key" ON "app"."devices" USING btree ("auth_session_id");--> statement-breakpoint
CREATE INDEX "entitlements_user_id_idx" ON "app"."entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_source_external_id_key" ON "app"."entitlements" USING btree ("source","external_id");