import * as z from 'zod';
// The OpenAPI fields of `.meta()` (`override`), declared by zod-openapi.
import type {} from 'zod-openapi';

/** IANA tzdb names: an area and a location, or `UTC`. Keeps out ICU-only IDs (`SystemV/EST5`, `PST`) and offsets. */
const ianaZone =
  /^(?:UTC|(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*)$/;

/** The zones ICU lists as canonical (CLDR IDs, all of them tzdb names), with the `Etc/` zones ICU doesn't list. */
const canonicalZones = new Set(Intl.supportedValuesOf('timeZone'));
const isCanonical = (name: string) => canonicalZones.has(name) || name === 'UTC' || name.startsWith('Etc/');

/**
 * A time zone, stored as **ICU's canonical ID** for it, so the stored spelling is always one ICU produced:
 *
 * - The input must have the IANA area form (`Area/Location`) or be `UTC`, in any letter case. tzdb links outside the
 *   areas (`US/Eastern`, `EST5EDT`) and ICU-only IDs (`SystemV/EST5`, `PST`) are refused.
 * - ICU must resolve it to a canonical zone that has the area form too. Case is normalised (`Europe/berlin` →
 *   `Europe/Berlin`) and aliases map to their canonical zone (`Europe/Kyiv` → `Europe/Kiev`, `Asia/Kolkata` →
 *   `Asia/Calcutta`, `Etc/UTC` → `UTC`). CLDR keeps some older names as canonical; they are tzdb links as well.
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
    if (resolved !== undefined && ianaZone.test(resolved) && isCanonical(resolved)) return resolved;
    context.addIssue({ code: 'custom', message: 'unknown time zone' });
    return z.NEVER;
  })
  .meta({
    description: "IANA time zone (`Area/Location` in any letter case, or `UTC`); stored as ICU's canonical ID",
    example: 'Europe/Berlin',
    // JSON Schema patterns have no flags: the case-sensitive one Zod would emit refuses valid input.
    override: ({ jsonSchema }) => {
      delete jsonSchema.pattern;
    },
  });

/** No control characters (PostgreSQL can't store NUL in text) and no unpaired surrogates. */
const isPrintable = (value: string) => value.isWellFormed() && !/\p{Cc}/u.test(value);

/** A real calendar date `YYYY-MM-DD` from 1900-01-01 up to today (UTC). */
function isBirthDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return value >= '1900-01-01' && date.getTime() <= Date.now();
}

const displayName = z.string().trim().min(1).max(100);
const birthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sex = z.enum(['female', 'male']);
const heightCm = z.number().min(50).max(300);
const locale = z.enum(['de', 'en']);

/** The signed-in user's profile (`GET`/`PATCH /v1/me`). `role` is read-only for clients (ADR-0002). */
export const Me = z
  .object({
    id: z.uuid(),
    displayName: displayName.nullable(),
    birthDate: birthDate.nullable().meta({ format: 'date' }),
    sex: sex.nullable(),
    heightCm: heightCm.nullable(),
    locale,
    timeZone: z.string().meta({ description: "IANA time zone, as ICU's canonical ID" }),
    role: z.enum(['user', 'admin']),
    onboardingCompletedAt: z.iso.datetime().nullable(),
    /** Bumped on every write; the `ETag` is derived from it. */
    version: z.int().positive(),
  })
  .meta({ id: 'Me' });

export type Me = z.output<typeof Me>;

/**
 * Body of `PATCH /v1/me`: a partial update of the user-editable profile fields (JSON merge semantics: a missing field
 * stays, `null` clears it). Unknown fields, including `role`, `id` and `version`, are refused.
 */
export const MeUpdate = z
  .strictObject({
    displayName: displayName
      .refine(isPrintable)
      .meta({
        description:
          'Trimmed first (leading and trailing white space); then 1 to 100 characters, no control characters',
        // Zod's length keywords would apply to the untrimmed JSON string: drop them, and require one non-white-space
        // character instead (ECMAScript `\s` is exactly what `trim()` removes), so a blank name fails here too.
        override: ({ jsonSchema }) => {
          delete jsonSchema.minLength;
          delete jsonSchema.maxLength;
          jsonSchema.pattern = '\\S';
        },
      })
      .nullable(),
    birthDate: birthDate.refine(isBirthDate).nullable().meta({ format: 'date' }),
    sex: sex.nullable(),
    heightCm: heightCm.nullable(),
    locale,
    timeZone,
    /** Marks onboarding as done; the server stamps the time once and never clears it. */
    onboardingCompleted: z.literal(true),
  })
  .partial()
  .refine((update) => Object.keys(update).length > 0)
  .meta({ id: 'MeUpdate', override: { minProperties: 1 } });

export type MeUpdate = z.output<typeof MeUpdate>;
