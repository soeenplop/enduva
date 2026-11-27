import type { Transaction, VerifiedClaims } from '@enduva/db';
import { sql } from 'drizzle-orm';

import { ProblemException } from '../problem/problem.js';

interface Status extends Record<string, unknown> {
  readonly active: boolean;
  readonly device_revoked: boolean;
  readonly has_profile: boolean;
}

/**
 * Session and account check (02-architecture → Authentication), run first in every request transaction, so once a
 * revocation has committed no later request is authorised. Synchronous and uncached, one round trip:
 *
 * - `app.auth_session_active()`: the token's session still exists and hasn't expired, and the user exists, isn't
 *   deleted and isn't banned. Otherwise `401 unauthorized`.
 * - The device registered for the session is revoked: `401 device_revoked`, so the client wipes its local data.
 *
 * On a user's first request their profile and settings are created with defaults. Account deletion (0.13b) must
 * therefore disable the auth user before it deletes the profile, so a deleted account fails the check instead of
 * getting a new profile (ADR-0002 → Session check).
 */
export async function assertActiveAccount(tx: Transaction, claims: VerifiedClaims): Promise<void> {
  const sessionId = typeof claims['session_id'] === 'string' ? claims['session_id'] : null;
  const { rows } = await tx.execute<Status>(
    sql`select app.auth_session_active() as active,
               exists (select from app.devices
                       where auth_session_id = ${sessionId}::uuid and revoked_at is not null) as device_revoked,
               exists (select from app.profiles where user_id = app.current_user_id()) as has_profile`,
  );
  const [status] = rows;
  if (status?.device_revoked === true) throw new ProblemException('device_revoked');
  if (status?.active !== true) throw new ProblemException('unauthorized');
  if (status.has_profile) return;
  // Raw SQL: Drizzle would list every column (as `default`), and the API may only insert `user_id` and the
  // user-editable columns (ADR-0002).
  await tx.execute(sql`insert into app.profiles (user_id) values (${claims.sub}) on conflict do nothing`);
  await tx.execute(sql`insert into app.user_settings (user_id) values (${claims.sub}) on conflict do nothing`);
}
