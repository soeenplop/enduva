import { doublePrecision, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

export const sport = pgEnum('sport', ['run', 'ride', 'hike', 'swim']);

export const activities = pgTable('activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  sport: sport('sport').notNull(),
  distanceMeters: doublePrecision('distance_meters').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
});

export type ActivityRow = typeof activities.$inferSelect;
