import { Body, Controller, Get, Header, Headers, Patch, Req, Res } from '@nestjs/common';
import { type Me, MeUpdate } from '@enduva/contracts';
import { profiles, type Transaction } from '@enduva/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Response } from 'express';

import { type IdentifiedRequest, RequestTx } from '../db/request-transaction.js';
import { ProblemException } from '../problem/problem.js';
import { etag, ifMatchVersion } from './etag.js';

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

/** The response body, as the contract's `Me` schema describes it. `role` is changed only by an operator (ADR-0002). */
function toMe(row: Omit<Me, 'onboardingCompletedAt'> & { onboardingCompletedAt: Date | null }): Me {
  return { ...row, onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null };
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
    return toMe(me);
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
    const parsed = MeUpdate.safeParse(body);
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
    return toMe(me);
  }
}
