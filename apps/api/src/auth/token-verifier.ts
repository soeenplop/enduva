import type { VerifiedClaims } from '@enduva/db';
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { AuthUnavailableError } from './jwks.js';

export { AuthUnavailableError, remoteKeys } from './jwks.js';

/** Clock skew tolerated between the Auth server and the API for `exp`, `nbf` and `iat`. Both are NTP-synced servers. */
export const CLOCK_SKEW_SECONDS = 10;

/** Supabase access tokens are a few hundred bytes to ~2 KiB. Anything far larger is rejected before parsing. */
const MAX_TOKEN_LENGTH = 8192;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The verified claims the API keeps: the user, the role and the session, which drives the per-request session check.
 * The rest of the token (email, metadata) is dropped.
 */
export interface AccessClaims extends VerifiedClaims {
  readonly session_id: string;
}

/** The token is not acceptable (401). Deliberately carries no reason: it never reaches the client or the logs. */
export class InvalidTokenError extends Error {
  override readonly name = 'InvalidTokenError';
  constructor() {
    super('Invalid access token');
  }
}

export interface TokenVerifierOptions {
  /** Exact expected `iss`. */
  readonly issuer: string;
  /** The single accepted asymmetric algorithm. */
  readonly algorithm: 'ES256' | 'RS256';
  /** Resolves the verification key for a token header, e.g. the remote JWKS. */
  readonly keys: JWTVerifyGetKey;
  /** Current time in seconds (tests). */
  readonly now?: () => number;
}

/** jose errors that mean the key set couldn't be loaded, as opposed to a bad token. */
const keySetFailures = new Set(['ERR_JOSE_GENERIC', 'ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JWK_INVALID']);

/**
 * Verifies Supabase access tokens (02-architecture → Authentication): signature against the JWKS with exactly one
 * asymmetric algorithm (never HS256 or `none`), the exact `iss`, `aud = authenticated`, `role = authenticated`, a
 * valid `exp` and an `iat` that isn't in the future (both with small skew), a UUID `sub` and `session_id`, and no
 * anonymous user. Only then is `sub` trusted.
 */
export class TokenVerifier {
  private readonly now: () => number;

  constructor(private readonly options: TokenVerifierOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async verify(token: string): Promise<AccessClaims> {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw new InvalidTokenError();
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, this.options.keys, {
        algorithms: [this.options.algorithm],
        issuer: this.options.issuer,
        audience: 'authenticated',
        clockTolerance: CLOCK_SKEW_SECONDS,
        currentDate: new Date(this.now() * 1000),
        requiredClaims: ['exp', 'iat', 'sub', 'role', 'session_id'],
      }));
    } catch (error) {
      // Anything but a jose verdict on the token (the key set failed to load, a bug) fails closed as unavailable.
      if (!(error instanceof errors.JOSEError) || keySetFailures.has(error.code)) throw new AuthUnavailableError();
      throw new InvalidTokenError();
    }
    const { sub, role, session_id: sessionId, iat, is_anonymous: anonymous, aud } = payload;
    const valid =
      // jose's `audience` accepts any list that contains it; Supabase issues exactly the string.
      aud === 'authenticated' &&
      typeof sub === 'string' &&
      uuidPattern.test(sub) &&
      role === 'authenticated' &&
      typeof sessionId === 'string' &&
      uuidPattern.test(sessionId) &&
      typeof iat === 'number' &&
      iat <= this.now() + CLOCK_SKEW_SECONDS &&
      (anonymous === undefined || anonymous === false);
    if (!valid) throw new InvalidTokenError();
    // Only what the API and the database need: no email, phone or metadata travels further.
    return { sub, role, session_id: sessionId };
  }
}
