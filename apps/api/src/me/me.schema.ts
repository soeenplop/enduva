import * as z from 'zod';

/** IANA tzdb names: an area and a location, or `UTC`. Keeps out ICU-only IDs (`SystemV/EST5`, `PST`) and offsets. */
const ianaZone =
  /^(?:UTC|(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*)$/;

/**
 * An IANA time zone the runtime (ICU) knows, including tzdb aliases such as `Asia/Calcutta`. Stored as sent when it
 * is spelled correctly, otherwise as ICU spells it (`europe/berlin` → `Europe/Berlin`), and only if that is an IANA
 * name too.
 */
const timeZone = z
  .string()
  .max(64)
  .regex(new RegExp(ianaZone.source, 'i'))
  .transform((name, context) => {
    let resolved: string | undefined;
    try {
      resolved = new Intl.DateTimeFormat('en', { timeZone: name }).resolvedOptions().timeZone;
    } catch {
      resolved = undefined;
    }
    if (resolved !== undefined && ianaZone.test(name)) return name;
    if (resolved !== undefined && ianaZone.test(resolved)) return resolved;
    context.addIssue({ code: 'custom', message: 'unknown time zone' });
    return z.NEVER;
  });

/** No control characters (PostgreSQL can't store NUL in text) and no unpaired surrogates. */
const isPrintable = (value: string) => value.isWellFormed() && !/\p{Cc}/u.test(value);

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
    displayName: z.string().trim().min(1).max(100).refine(isPrintable).nullable(),
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
