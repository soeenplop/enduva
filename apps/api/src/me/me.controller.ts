import { Controller, Get, Header } from '@nestjs/common';
import { profiles, type Transaction } from '@enduva/db';
import { eq, sql } from 'drizzle-orm';

import { RequestTx } from '../db/request-transaction.js';
import { ProblemException } from '../problem/problem.js';

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

@Controller('me')
export class MeController {
  /** The profile of the token's user. The request transaction has already checked the session and created it. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@RequestTx() tx: Transaction): Promise<Me> {
    const [me] = await tx
      .select({
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
      })
      .from(profiles)
      .where(eq(profiles.userId, sql`app.current_user_id()`));
    // RLS shows only the user's own row, which the account check created: missing means it was deleted meanwhile.
    if (me === undefined) throw new ProblemException('unauthorized');
    return me;
  }
}
