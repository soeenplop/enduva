// @expect TS2551 at 9:37
import { createMiddleware, createServerFn } from '@tanstack/react-start';

const requestUser = createMiddleware({ type: 'function' }).server(({ next }) => next({ context: { userId: 'user-1' } }));

// The middleware context has `userId`, not `userID`.
export const fn = createServerFn({ method: 'GET' })
  .middleware([requestUser])
  .handler(({ context }) => context.userID);
