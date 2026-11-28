import { createMiddleware } from '@tanstack/react-start';
import { getSession } from './session.server';

/**
 * Start serializes a thrown error, message included, into the page or the server function's response. This logs
 * anything unexpected (a missing setting, Auth or the API unreachable) on the server and sends a generic error.
 */
export const serverErrors = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    console.error('Server function failed', error);
    throw new Error('Request failed');
  }
});

/** Gives a server function this request's session (null when signed out) as `context.session`. */
export const sessionMiddleware = createMiddleware({ type: 'function' })
  .middleware([serverErrors])
  .server(async ({ next }) => next({ context: { session: await getSession() } }));
