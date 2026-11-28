import { createServerFn } from '@tanstack/react-start';
import { sessionMiddleware } from './middleware';
import { dropSession } from './session.server';

/**
 * Auth as server functions: the browser calls them, the web server talks to Auth and keeps the session in its
 * HttpOnly cookie. Start's default CSRF middleware refuses cross-site calls (README, Sign-in).
 */

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
