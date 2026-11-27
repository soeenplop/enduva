import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

import { app } from './app.js';

// Account tables (docs/plan/03-domain-model.md → Account, Sync → devices).
// Row-level security, grants and triggers for these tables are hand-written SQL in
// supabase/migrations (ADR-0002); drizzle-kit only generates the DDL below.

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const createdAt = timestamptz('created_at').notNull().defaultNow();
const updatedAt = timestamptz('updated_at').notNull().defaultNow();
/** Optimistic-concurrency version (ETag / If-Match); bumped by a trigger on every update. */
const version = bigint('version', { mode: 'number' }).notNull().default(1);

const userIdRef = () =>
  uuid('user_id')
    .notNull()
    .references(() => profiles.userId, { onDelete: 'cascade' });

export const profiles = app.table(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    avatarPath: text('avatar_path'),
    birthDate: date('birth_date', { mode: 'string' }),
    sex: text('sex', { enum: ['female', 'male'] }),
    heightCm: real('height_cm'),
    locale: text('locale', { enum: ['de', 'en'] })
      .notNull()
      .default('de'),
    timeZone: text('time_zone').notNull().default('Europe/Berlin'),
    role: text('role', { enum: ['user', 'admin'] })
      .notNull()
      .default('user'),
    onboardingCompletedAt: timestamptz('onboarding_completed_at'),
    version,
    createdAt,
    updatedAt,
  },
  (t) => [
    check('profiles_sex_check', sql`${t.sex} in ('female', 'male')`),
    check('profiles_height_cm_check', sql`${t.heightCm} between 50 and 300`),
    check('profiles_locale_check', sql`${t.locale} in ('de', 'en')`),
    check('profiles_role_check', sql`${t.role} in ('user', 'admin')`),
  ],
);

export const userSettings = app.table(
  'user_settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => profiles.userId, { onDelete: 'cascade' }),
    theme: text('theme', { enum: ['system', 'light', 'dark'] })
      .notNull()
      .default('system'),
    /** ISO weekday the calendar week starts on: 1 = Monday … 7 = Sunday. */
    weekStart: smallint('week_start').notNull().default(1),
    notificationPrefs: jsonb('notification_prefs').$type<Record<string, boolean>>().notNull().default({}),
    healthSync: jsonb('health_sync').$type<Record<string, unknown>>().notNull().default({}),
    version,
    createdAt,
    updatedAt,
  },
  (t) => [
    check('user_settings_theme_check', sql`${t.theme} in ('system', 'light', 'dark')`),
    check('user_settings_week_start_check', sql`${t.weekStart} between 1 and 7`),
  ],
);

export const entitlements = app.table(
  'entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userIdRef(),
    tier: text('tier', { enum: ['free', 'premium'] }).notNull(),
    source: text('source', { enum: ['manual', 'app_store', 'web'] }).notNull(),
    /** Store-side identifier, e.g. the App Store original transaction ID. */
    externalId: text('external_id'),
    validFrom: timestamptz('valid_from').notNull().defaultNow(),
    validUntil: timestamptz('valid_until'),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('entitlements_user_id_idx').on(t.userId),
    uniqueIndex('entitlements_source_external_id_key').on(t.source, t.externalId),
    check('entitlements_tier_check', sql`${t.tier} in ('free', 'premium')`),
    check('entitlements_source_check', sql`${t.source} in ('manual', 'app_store', 'web')`),
    check('entitlements_validity_check', sql`${t.validUntil} is null or ${t.validUntil} > ${t.validFrom}`),
  ],
);

/** Purpose-specific, versioned consent. Revoking sets `revoked_at`; granting again inserts a new row. */
export const consents = app.table(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userIdRef(),
    purpose: text('purpose', { enum: ['health_data', 'ai_nutrition', 'ai_coach'] }).notNull(),
    /** Version of the consent text the user agreed to. */
    consentVersion: text('consent_version').notNull(),
    grantedAt: timestamptz('granted_at').notNull().defaultNow(),
    revokedAt: timestamptz('revoked_at'),
    createdAt,
  },
  (t) => [
    uniqueIndex('consents_active_purpose_key')
      .on(t.userId, t.purpose)
      .where(sql`${t.revokedAt} is null`),
    check('consents_purpose_check', sql`${t.purpose} in ('health_data', 'ai_nutrition', 'ai_coach')`),
    check('consents_revoked_after_granted_check', sql`${t.revokedAt} is null or ${t.revokedAt} >= ${t.grantedAt}`),
  ],
);

/** A signed-in client. Its auth session is checked on every request; revoked devices stay for the device list. */
export const devices = app.table(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userIdRef(),
    kind: text('kind', { enum: ['iphone', 'watch', 'web'] }).notNull(),
    name: text('name'),
    /** Supabase Auth `session_id` claim of the device's session. */
    authSessionId: uuid('auth_session_id').notNull(),
    lastSeenAt: timestamptz('last_seen_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('devices_user_id_idx').on(t.userId),
    uniqueIndex('devices_auth_session_id_key').on(t.authSessionId),
    check('devices_kind_check', sql`${t.kind} in ('iphone', 'watch', 'web')`),
  ],
);
