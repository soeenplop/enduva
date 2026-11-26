import * as z from 'zod';

export const Sport = z.enum(['run', 'ride', 'hike', 'swim']).meta({ id: 'Sport' });

export const ActivityParams = z.object({
  activityId: z.uuid().meta({ description: 'Activity ID', example: '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a' }),
});

export const ActivityQuery = z.object({
  units: z.enum(['metric', 'imperial']).default('metric').meta({ description: 'Unit system for distances' }),
});

export const Activity = z
  .object({
    id: z.uuid(),
    sport: Sport,
    distance: z.number().nonnegative(),
    distanceUnit: z.enum(['km', 'mi']),
    startedAt: z.iso.datetime(),
  })
  .meta({ id: 'Activity' });

export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int(),
    code: z.string(),
  })
  .meta({ id: 'Problem' });

export type Activity = z.infer<typeof Activity>;
export type ActivityParams = z.infer<typeof ActivityParams>;
export type ActivityQuery = z.infer<typeof ActivityQuery>;
export type Problem = z.infer<typeof Problem>;
