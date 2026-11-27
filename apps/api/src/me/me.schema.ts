import * as z from 'zod';

/**
 * An IANA time zone name the runtime knows (ICU), stored as the runtime spells it (`europe/berlin` → `Europe/Berlin`).
 * The pattern keeps out offsets such as `+01:00`, which Intl also accepts but which aren't zones.
 */
const timeZone = z
  .string()
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+\-/]*$/)
  .transform((name, context) => {
    try {
      return new Intl.DateTimeFormat('en', { timeZone: name }).resolvedOptions().timeZone;
    } catch {
      context.addIssue({ code: 'custom', message: 'unknown time zone' });
      return z.NEVER;
    }
  });

/** A real calendar date `YYYY-MM-DD` from 1900-01-01 up to today (UTC). */
function isBirthDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return value >= '1900-01-01' && date.getTime() <= Date.now();
}

/**
 * Body of `PATCH /v1/me`: a partial update of the user-editable profile fields (JSON merge semantics: a missing field
 * stays, `null` clears it). Unknown fields, including `role`, `id` and `version`, are refused. Request schemas move
 * to `@enduva/contracts` with the OpenAPI generation (0.8c).
 */
export const meUpdateSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100).nullable(),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isBirthDate)
      .nullable(),
    sex: z.enum(['female', 'male']).nullable(),
    heightCm: z.number().min(50).max(300).nullable(),
    locale: z.enum(['de', 'en']),
    timeZone,
    /** Marks onboarding as done; the server stamps the time once and never clears it. */
    onboardingCompleted: z.literal(true),
  })
  .partial()
  .refine((update) => Object.keys(update).length > 0);

export type MeUpdate = z.output<typeof meUpdateSchema>;
