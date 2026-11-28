import { createServerFn } from '@tanstack/react-start';
import { readClaims } from './claims';
import { sessionMiddleware } from './middleware';
import { dropSession } from './session.server';

/**
 * Auth as server functions: the browser calls them, the web server talks to Auth and keeps the session in its
 * HttpOnly cookie. Start's default CSRF middleware refuses cross-site calls (README, Sign-in).
 */

/** The signed-in user (account ID and email), for the page chrome, or null. A cookie that isn't a JWT is dropped. */
export const getViewer = createServerFn({ method: 'GET' })
  .middleware([sessionMiddleware])
  .handler(async ({ context }) => {
    if (context.session === null) return null;
    const claims = readClaims(context.session.accessToken);
    if (claims === null) await dropSession();
    return claims === null ? null : { id: claims.sub, email: claims.email };
  });
