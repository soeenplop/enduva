import { getMe, type Me, type MeUpdate as MeUpdateBody, updateMe } from '@enduva/api-client';
import { MeUpdate } from '@enduva/contracts';
import { createServerFn } from '@tanstack/react-start';
import * as z from 'zod';
import { readClaims } from '../auth/claims';
import { sessionMiddleware } from '../auth/middleware';
import { dropSession } from '../auth/session.server';
import { apiBaseUrl } from '../config.server';

/**
 * The profile with the `ETag` that a `PATCH` must send back in `If-Match` (apps/api README, `/v1/me`), and the email
 * of the session it was read with, so the page shows the identity of the account it edits.
 */
export interface Profile {
  readonly me: Me;
  readonly etag: string;
  readonly email: string;
}

export type ProfileSave =
  | { ok: true; profile: Profile }
  | { ok: false; error: 'conflict' | 'invalid' | 'unavailable'; profile?: Profile }
  | { ok: false; error: 'signed_out' }
  | { ok: false; error: 'account_changed' };

const API_TIMEOUT_MS = 5_000;
const api = (accessToken: string) =>
  ({ baseUrl: apiBaseUrl(), accessToken, cache: 'no-store', signal: AbortSignal.timeout(API_TIMEOUT_MS) }) as const;

const emailOf = (accessToken: string) => readClaims(accessToken)?.email ?? '';

async function fetchProfile(accessToken: string): Promise<Profile | null> {
  const res = await getMe({}, api(accessToken));
  if (res.status === 200) return { me: res.data, etag: res.headers.get('etag') ?? '', email: emailOf(accessToken) };
  // The API refused the session (signed out elsewhere, revoked, deleted): drop the cookie.
  if (res.status === 401) {
    await dropSession();
    return null;
  }
  console.error('GET /v1/me failed', res.status);
  throw new Error('Profile unavailable');
}

/** The signed-in user's profile, or null when signed out. */
export const getProfile = createServerFn({ method: 'GET' })
  .middleware([sessionMiddleware])
  .handler(({ context }) => (context.session === null ? null : fetchProfile(context.session.accessToken)));

const ProfileUpdate = z.object({ userId: z.uuid(), etag: z.string().min(1).max(256), patch: MeUpdate });

/**
 * Saves the changed fields if the profile is still at `etag`; on a conflict it returns the current profile. The input
 * is typed here and validated in the handler, so invalid input is an `invalid` answer instead of a thrown error.
 * `userId` is the account the form was rendered for: if this browser has signed in as someone else since (another
 * tab), nothing is written and the answer is `account_changed`.
 */
export const updateProfile = createServerFn({ method: 'POST' })
  .middleware([sessionMiddleware])
  .validator((input: z.input<typeof ProfileUpdate>) => input)
  .handler(async ({ context, data }): Promise<ProfileSave> => {
    if (context.session === null) return { ok: false, error: 'signed_out' };
    const input = ProfileUpdate.safeParse(data);
    if (!input.success) return { ok: false, error: 'invalid' };
    const { accessToken } = context.session;
    if (readClaims(accessToken)?.sub !== input.data.userId) return { ok: false, error: 'account_changed' };
    try {
      // The parsed patch has no `undefined` values, which is what the body type means.
      const patch = input.data.patch as MeUpdateBody;
      const res = await updateMe(patch, { 'If-Match': input.data.etag }, api(accessToken));
      if (res.status === 200)
        return {
          ok: true,
          profile: { me: res.data, etag: res.headers.get('etag') ?? '', email: emailOf(accessToken) },
        };
      if (res.status === 401) {
        await dropSession();
        return { ok: false, error: 'signed_out' };
      }
      if (res.status === 412) {
        const profile = await fetchProfile(accessToken);
        return profile === null ? { ok: false, error: 'signed_out' } : { ok: false, error: 'conflict', profile };
      }
      if (res.status === 400) return { ok: false, error: 'invalid' };
      console.error('PATCH /v1/me failed', res.status, res.data.code);
    } catch (error) {
      console.error('PATCH /v1/me failed', error);
    }
    return { ok: false, error: 'unavailable' };
  });
