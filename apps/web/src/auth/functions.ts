import { createServerFn } from '@tanstack/react-start';
import * as z from 'zod';
import { turnstileSiteKey } from '../config.server';
import { getLocale } from '../paraglide/runtime.js';
import * as gotrue from './gotrue.server';
import { serverErrors, sessionMiddleware } from './middleware';
import { beginOAuth } from './oauth.server';
import { dropSession, endSession, startLogin } from './session.server';

/**
 * Sign-in, sign-up and sign-out as server functions: the browser posts the form here, the web server talks to Auth
 * and keeps the session in its HttpOnly cookie. Start's default CSRF middleware refuses cross-site calls (README,
 * Sign-in). Errors never tell whether an account exists: an unknown email and a wrong password are the same
 * `invalid_credentials`, and sign-up and magic links answer `ok` either way.
 */

export type AuthError =
  | 'invalid_credentials'
  | 'captcha'
  | 'weak_password'
  | 'rate_limited'
  | 'link_invalid'
  | 'unavailable';
export type AuthOutcome = { ok: true } | { ok: false; error: AuthError };

const ok = { ok: true } as const;
const fail = (error: AuthError) => ({ ok: false, error }) as const;

/** Errors that can't depend on the account: anything else is the caller's generic error. */
function commonError({ status, code }: { status: number; code: string }): AuthError | undefined {
  if (code === 'captcha_failed') return 'captcha';
  if (status === 429 || code.startsWith('over_')) return 'rate_limited';
  if (status >= 500 || code === 'unexpected_response') return 'unavailable';
  return undefined;
}

/** Auth unreachable or misconfigured: logged here, generic for the browser. */
async function guarded(name: string, run: () => Promise<AuthOutcome>): Promise<AuthOutcome> {
  try {
    return await run();
  } catch (error) {
    console.error(`${name} failed`, error);
    return fail('unavailable');
  }
}

const credentials = z.object({
  email: z.email().max(254),
  // bcrypt reads at most 72 bytes; Auth refuses longer passwords.
  password: z.string().min(1).max(72),
  captchaToken: z.string().min(1).max(4096),
});

/** The signed-in user, for the page chrome (email only), or null. */
export const getViewer = createServerFn({ method: 'GET' })
  .middleware([sessionMiddleware])
  .handler(async ({ context }) => {
    if (context.session === null) return null;
    // Display only: the API verifies the token itself on every call. A cookie that isn't a JWT is dropped.
    try {
      const payload = context.session.accessToken.split('.')[1] ?? '';
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown } | null;
      return { email: typeof claims?.email === 'string' ? claims.email : '' };
    } catch {
      await dropSession();
      return null;
    }
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
    guarded('signUp', async () => {
      const result = await gotrue.signUp(data.email, data.password, data.captchaToken, getLocale());
      // An existing account gets the same answer as a new one.
      if (result.ok || result.code === 'user_already_exists') return ok;
      return fail(commonError(result) ?? (result.code === 'weak_password' ? 'weak_password' : 'unavailable'));
    }),
  );

export const signIn = createServerFn({ method: 'POST' })
  .validator(credentials)
  .handler(({ data }) =>
    guarded('signIn', async () => {
      const result = await gotrue.signInWithPassword(data.email, data.password, data.captchaToken);
      if (result.ok) {
        await startLogin(result.value);
        return ok;
      }
      // Unknown email, wrong password and unconfirmed email look the same.
      return fail(commonError(result) ?? 'invalid_credentials');
    }),
  );

export const sendMagicLink = createServerFn({ method: 'POST' })
  .validator(credentials.pick({ email: true, captchaToken: true }))
  .handler(({ data }) =>
    guarded('sendMagicLink', async () => {
      const result = await gotrue.sendMagicLink(data.email, data.captchaToken);
      // `otp_disabled`: no account with this email (magic links never sign anyone up). Same answer as a sent link.
      if (result.ok || result.code === 'otp_disabled') return ok;
      return fail(commonError(result) ?? 'unavailable');
    }),
  );

/** Redeems a confirmation or magic-link mail. A POST from the confirm page, so link scanners can't spend it. */
export const confirmEmail = createServerFn({ method: 'POST' })
  .validator(z.object({ tokenHash: z.string().min(1).max(256) }))
  .handler(({ data }) =>
    guarded('confirmEmail', async () => {
      const result = await gotrue.verifyEmailLink(data.tokenHash);
      if (result.ok) {
        await startLogin(result.value);
        return ok;
      }
      return fail(commonError(result) ?? 'link_invalid');
    }),
  );

/** Starts Google sign-in; the browser goes to the returned Auth URL, and `/auth/callback` finishes it. */
export const startGoogleSignIn = createServerFn({ method: 'POST' })
  .middleware([serverErrors])
  .validator(z.object({ redirect: z.string().max(2048) }))
  .handler(({ data }) => ({ url: beginOAuth('google', data.redirect) }));

export const signOut = createServerFn({ method: 'POST' })
  .middleware([sessionMiddleware])
  .handler(async ({ context }) => {
    if (context.session !== null) {
      // Best effort: the cookie goes either way.
      await gotrue
        .signOut(context.session.accessToken)
        .catch((error: unknown) => console.error('signOut failed', error));
    }
    await endSession();
    return ok;
  });
