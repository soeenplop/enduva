import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';

/** The signing keys couldn't be fetched, so the token can't be verified either way (503, fail closed). */
export class AuthUnavailableError extends Error {
  override readonly name = 'AuthUnavailableError';
  constructor() {
    super('Signing keys unavailable');
  }
}

export interface RemoteKeysOptions {
  /** How long a fetched key set is used before it is fetched again. */
  readonly cacheMaxAgeMs?: number;
  /** Minimum time between two fetch attempts, successful or not, once the cache is cold, stale or misses a key. */
  readonly cooldownMs?: number;
  readonly timeoutMs?: number;
  /** Current time in milliseconds (tests). */
  readonly now?: () => number;
}

/**
 * Supabase's JWKS (`<issuer>/.well-known/jwks.json`) with a cache that also limits failed fetches, which jose's
 * remote key set doesn't: its cooldown only counts successful fetches, so during an outage every verification would
 * fetch again.
 *
 * - A fetched key set is used for 10 minutes. Within that time a token naming an unknown key ID (rotation) refetches
 *   the set, at most once per cooldown (30 s).
 * - **Every** attempt starts the cooldown, a failed one too. A token that needs a fetch inside the cooldown fails
 *   with `AuthUnavailableError` without one (fail closed); fresh keys keep verifying tokens they match.
 * - Concurrent verifications share one in-flight fetch, which times out after 5 s.
 */
export function remoteKeys(issuer: string, options: RemoteKeysOptions = {}): JWTVerifyGetKey {
  const url = `${issuer}/.well-known/jwks.json`;
  const { cacheMaxAgeMs = 600_000, cooldownMs = 30_000, timeoutMs = 5_000, now = Date.now } = options;
  let keys: JWTVerifyGetKey | undefined;
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let attemptedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<JWTVerifyGetKey> | undefined;

  async function fetchKeys(): Promise<JWTVerifyGetKey> {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) throw new AuthUnavailableError();
      const loaded = createLocalJWKSet((await response.json()) as JSONWebKeySet);
      keys = loaded;
      fetchedAt = now();
      return loaded;
    } catch {
      throw new AuthUnavailableError();
    }
  }

  /** The in-flight fetch, a new one if the cooldown allows it, or `AuthUnavailableError`. */
  function refresh(): Promise<JWTVerifyGetKey> {
    if (inFlight !== undefined) return inFlight;
    if (now() - attemptedAt < cooldownMs) return Promise.reject(new AuthUnavailableError());
    attemptedAt = now();
    inFlight = fetchKeys().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  return async (header, token) => {
    const fresh = keys !== undefined && now() - fetchedAt < cacheMaxAgeMs;
    const current = fresh && keys !== undefined ? keys : await refresh();
    try {
      return await current(header, token);
    } catch (error) {
      // An unknown key ID: the set may have rotated. Refetch once if the cooldown allows it, otherwise it stays a bad
      // token rather than an outage.
      if (!(error instanceof errors.JWKSNoMatchingKey) || now() - attemptedAt < cooldownMs) throw error;
      return (await refresh())(header, token);
    }
  };
}
