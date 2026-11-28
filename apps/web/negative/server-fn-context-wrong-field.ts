// @expect TS2551 at 8:37
import { createServerFn } from '@tanstack/react-start';
import { sessionMiddleware } from '../src/auth/middleware';

// The session middleware's context has `session`, not `sesion`.
export const fn = createServerFn({ method: 'GET' })
  .middleware([sessionMiddleware])
  .handler(({ context }) => context.sesion);
