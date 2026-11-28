import { createServerFn } from '@tanstack/react-start';
import * as z from 'zod';
import { turnstileSiteKey } from '../config.server';
import { getLocale } from '../paraglide/runtime.js';
import { readClaims } from './claims';
import * as gotrue from './gotrue.server';
import { serverErrors, sessionMiddleware } from './middleware';
import { beginOAuth } from './oauth.server';
import { type AuthOutcome, emailFlowOutcome, fail, linkOutcome, ok, signInOutcome } from './outcomes';
import { dropSession, endSession, hasLogin, startLogin } from './session.server';

export type { AuthError, AuthOutcome } from './outcomes';

/**
 * Sign-in, sign-up and sign-out as server functions: the browser posts the form here, the web server talks to Auth
 * and keeps the session in its HttpOnly cookies. Start's default CSRF middleware refuses cross-site calls (README,
 * Sign-in). What the browser learns from Auth's answers is decided in ./outcomes: never whether an account exists.
 */

/** Auth unreachable or misconfigured: logged here, generic for the browser. */
async function guarded<T>(name: string, run: () => Promise<T>, unavailable: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`${name} failed`, error);
    return unavailable;
  }
}

const credentials = z.object({
  email: z.email().max(254),
  // bcrypt reads at most 72 bytes; Auth refuses longer passwords.
  password: z.string().min(1).max(72),
  captchaToken: z.string().min(1).max(4096),
});

/** The signed-in user (account ID and email), for the page chrome, or null. A cookie that isn't a JWT is dropped. */
export const getViewer = createServerFn({ method: 'GET' })
  .middleware([sessionMiddleware])
  .handler(async ({ context }) => {
    if (context.session === null) return null;
    const claims = readClaims(context.session.accessToken);
    if (claims === null) await dropSession();
    return claims === null ? null : { id: claims.sub, email: claims.email };
  });

/** What the sign-in forms need: the Turnstile site key and whether Google sign-in is enabled. */
export const getAuthOptions = createServerFn({ method: 'GET' })
  .middleware([serverErrors])
  .handler(async () => ({
    turnstileSiteKey: turnstileSiteKey(),
    google: await gotrue.googleEnabled(),
  }));

export const signUp = createServerFn({ method: 'POST' })
  .validator(credentials)
  .handler(({ data }) =>
    guarded(
      'signUp',
      async () => emailFlowOutcome(await gotrue.signUp(data.email, data.password, data.captchaToken, getLocale())),
      fail('unavailable'),
    ),
  );

export const signIn = createServerFn({ method: 'POST' })
  .validator(credentials)
  .handler(({ data }) =>
    guarded(
      'signIn',
      async (): Promise<AuthOutcome> => {
        const result = await gotrue.signInWithPassword(data.email, data.password, data.captchaToken);
        if (!result.ok) return signInOutcome(result);
        await startLogin(result.value);
        return ok;
      },
      fail('unavailable'),
    ),
  );

export const sendMagicLink = createServerFn({ method: 'POST' })
  .validator(credentials.pick({ email: true, captchaToken: true }))
  .handler(({ data }) =>
    guarded(
      'sendMagicLink',
      async () => emailFlowOutcome(await gotrue.sendMagicLink(data.email, data.captchaToken)),
      fail('unavailable'),
    ),
  );

/** `email_mismatch`: the link belongs to another address than the one the user typed. */
export type ConfirmOutcome = AuthOutcome | { ok: false; error: 'email_mismatch' };

/**
 * Redeems a confirmation or magic-link mail. A POST from the confirm page, so link scanners can't spend it. The user
 * types the address the mail went to, and the session is kept only if the link belongs to it: holding someone else's
 * link (a forwarded mail, an attacker's own link) can't switch this browser to that account.
 */
export const confirmEmail = createServerFn({ method: 'POST' })
  .validator(z.object({ tokenHash: z.string().min(1).max(256), email: z.email().max(254) }))
  .handler(({ data }) =>
    guarded(
      'confirmEmail',
      async (): Promise<ConfirmOutcome> => {
        const result = await gotrue.verifyEmailLink(data.tokenHash);
        if (!result.ok) return linkOutcome(result);
        const { session, email } = result.value;
        if (email.toLowerCase() !== data.email.toLowerCase()) {
          // The link is spent either way; the session it created is ended rather than left unused. The browser keeps
          // its current login whatever Auth answers.
          await gotrue.signOut(session.accessToken).then(
            (ended) => {
              if (!ended.ok) console.error('Ending the mismatched session failed', ended.status, ended.code);
            },
            (error: unknown) => console.error('Ending the mismatched session failed', error),
          );
          return { ok: false, error: 'email_mismatch' };
        }
        await startLogin(session);
        return ok;
      },
      fail('unavailable'),
    ),
  );

/** Starts Google sign-in; the browser goes to the returned Auth URL, and `/auth/callback` finishes it. */
export const startGoogleSignIn = createServerFn({ method: 'POST' })
  .middleware([serverErrors])
  .validator(z.object({ redirect: z.string().max(2048) }))
  .handler(({ data }) => ({ url: beginOAuth('google', data.redirect) }));

/**
 * Signs out. The cookies go in every case; `revoked` says whether Auth confirmed it ended the session. If it didn't
 * (Auth down, or the session could no longer be refreshed), tokens issued to it stay valid at the API until their
 * expiry (at most an hour), and the page tells the user so.
 */
export const signOut = createServerFn({ method: 'POST' })
  .middleware([sessionMiddleware])
  .handler(async ({ context }): Promise<{ ok: true; revoked: boolean }> => {
    let revoked = !(await hasLogin());
    if (context.session !== null) {
      try {
        const result = await gotrue.signOut(context.session.accessToken);
        revoked = result.ok;
        if (!result.ok) console.error('Auth logout failed', result.status, result.code);
      } catch (error) {
        console.error('Auth logout failed', error);
      }
    } else if (!revoked) console.error('Auth logout skipped: the session could not be refreshed');
    await endSession(revoked);
    return { ok: true, revoked };
  });
