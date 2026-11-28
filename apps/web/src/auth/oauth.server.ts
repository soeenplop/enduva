import { createHash, randomBytes } from 'node:crypto';
import { deleteCookie, getCookie, getRequest, setCookie } from '@tanstack/react-start/server';
import { webOrigin } from '../config.server';
import { authorizeUrl, exchangeCode } from './gotrue.server';
import { safeRedirect } from './redirect';
import { authCookie, startLogin } from './session.server';

/**
 * OAuth sign-in with PKCE. The verifier and the page to return to stay in an HttpOnly cookie of this browser for ten
 * minutes, so a code from another browser (or an attacker's) can't be redeemed here.
 */

const STATE_MAX_AGE_S = 600;

export function beginOAuth(provider: 'google', redirect: string): string {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const { name, options } = authCookie('enduva-oauth');
  const state = Buffer.from(JSON.stringify([verifier, safeRedirect(redirect)])).toString('base64url');
  setCookie(name, state, { ...options, maxAge: STATE_MAX_AGE_S });
  return authorizeUrl(provider, new URL('/auth/callback', webOrigin(getRequest().url)).href, challenge);
}

function readState(value: string | undefined): { verifier: string; redirect: string } | undefined {
  try {
    const [verifier, redirect] = JSON.parse(Buffer.from(value ?? '', 'base64url').toString('utf8')) as unknown[];
    return typeof verifier === 'string' ? { verifier, redirect: safeRedirect(redirect) } : undefined;
  } catch {
    return undefined;
  }
}

/** `GET /auth/callback?code=…`: redeems the code and redirects to the saved page, or back to sign-in. */
export async function finishOAuth(request: Request): Promise<Response> {
  const origin = webOrigin(request.url);
  const { name, options } = authCookie('enduva-oauth');
  const state = readState(getCookie(name));
  deleteCookie(name, options);
  const code = new URL(request.url).searchParams.get('code');
  let target = '/sign-in?error=oauth';
  if (state !== undefined && code !== null && code.length <= 512) {
    try {
      const result = await exchangeCode(code, state.verifier);
      if (result.ok) {
        await startLogin(result.value);
        target = state.redirect;
      }
    } catch (error) {
      console.error('OAuth code exchange failed', error);
    }
  }
  return new Response(null, { status: 303, headers: { location: new URL(target, origin).href } });
}
