import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import type { Env } from '../config/env.js';
import { AuthGuard } from './auth.guard.js';
import { remoteKeys, TokenVerifier } from './token-verifier.js';

/** Access-token verification against the Supabase JWKS and the global guard (02-architecture → Authentication). */
@Module({})
export class AuthModule {
  static register(env: Env): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        {
          provide: TokenVerifier,
          useFactory: () =>
            new TokenVerifier({
              issuer: env.AUTH_ISSUER,
              algorithm: env.AUTH_JWT_ALGORITHM,
              keys: remoteKeys(env.AUTH_ISSUER),
            }),
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
