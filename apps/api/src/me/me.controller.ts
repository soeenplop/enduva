import { createHash } from 'node:crypto';

import { Body, Controller, Get, Header, Headers, Patch, Req, Res } from '@nestjs/common';
import { profiles, type Transaction } from '@enduva/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Response } from 'express';

import { type IdentifiedRequest, RequestTx } from '../db/request-transaction.js';
import { ProblemException } from '../problem/problem.js';
import { meUpdateSchema } from './me.schema.js';

/** The signed-in user's profile. `role` is read-only for clients: it is changed only by an operator (ADR-0002). */
export interface Me {
  readonly id: string;
  readonly displayName: string | null;
  readonly birthDate: string | null;
  readonly sex: 'female' | 'male' | null;
  readonly heightCm: number | null;
  readonly locale: 'de' | 'en';
  readonly timeZone: string;
  readonly role: 'user' | 'admin';
  readonly onboardingCompletedAt: Date | null;
  readonly version: number;
}

const meColumns = {
  id: profiles.userId,
  displayName: profiles.displayName,
  birthDate: profiles.birthDate,
  sex: profiles.sex,
  heightCm: profiles.heightCm,
  locale: profiles.locale,
  timeZone: profiles.timeZone,
  role: profiles.role,
  onboardingCompletedAt: profiles.onboardingCompletedAt,
  version: profiles.version,
};

const ownProfile = eq(profiles.userId, sql`app.current_user_id()`);

/**
 * A strong ETag for one user's profile at one version: `"<version>-<digest>"`, the digest an opaque hash of user and
 * version. Two accounts at the same version get different tags, so a tag left over from an account switch can't
 * match: not in a conditional GET (Express answers 304 only for this exact tag) and not in `If-Match`.
 */
function etag(userId: string, version: number): string {
  const digest = createHash('sha256').update(`enduva.me:${userId}:${version}`).digest('base64url').slice(0, 22);
  return `"${version}-${digest}"`;
}

/**
 * The version a single strong `If-Match` names, if it is this user's tag. Anything else names none: another user's
 * tag, a weak tag, `*` or a list, although HTTP allows the last two (the endpoint takes exactly one current tag).
 */
function ifMatchVersion(header: string, userId: string): number | undefined {
  const value = header.trim();
  const match = /^"([1-9]\d{0,15})-[\w-]{22}"$/.exec(value);
  if (match?.[1] === undefined) return undefined;
  const version = Number(match[1]);
  return value === etag(userId, version) ? version : undefined;
}

@Controller('me')
export class MeController {
  /** The profile of the token's user. The request transaction has already checked the session and created it. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@RequestTx() tx: Transaction, @Res({ passthrough: true }) response: Response): Promise<Me> {
    const [me] = await tx.select(meColumns).from(profiles).where(ownProfile);
    // RLS shows only the user's own row, which the account check created: missing means it was deleted meanwhile.
    if (me === undefined) throw new ProblemException('unauthorized');
    response.setHeader('ETag', etag(me.id, me.version));
    return me;
  }

  /**
   * Partial update of the user-editable fields. `If-Match` with the ETag from `GET` is required, so a stale client
   * can't overwrite a change made on another device: missing `428 precondition_required`; outdated, another user's,
   * weak, `*` or a list `412 precondition_failed`. An invalid body is a bare `400 bad_request` that echoes no input.
   */
  @Patch()
  @Header('Cache-Control', 'no-store')
  async update(
    @RequestTx() tx: Transaction,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: IdentifiedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Me> {
    if (ifMatch === undefined) throw new ProblemException('precondition_required');
    const parsed = meUpdateSchema.safeParse(body);
    if (!parsed.success) throw new ProblemException('bad_request');
    const userId = request.claims?.sub;
    const version = userId === undefined ? undefined : ifMatchVersion(ifMatch, userId);
    if (version === undefined) throw new ProblemException('precondition_failed');
    const { onboardingCompleted, ...fields } = parsed.data;
    const [me] = await tx
      .update(profiles)
      .set({
        ...fields,
        ...(onboardingCompleted === true
          ? { onboardingCompletedAt: sql`coalesce(${profiles.onboardingCompletedAt}, now())` }
          : {}),
      })
      .where(and(ownProfile, eq(profiles.version, version)))
      .returning(meColumns);
    if (me === undefined) throw new ProblemException('precondition_failed');
    response.setHeader('ETag', etag(me.id, me.version));
    return me;
  }
}
