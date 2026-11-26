import { createMiddleware, createServerFn } from '@tanstack/react-start';
import * as z from 'zod';

// Typed server request context: the middleware adds `userId`, the handler sees it typed.
const requestUser = createMiddleware({ type: 'function' }).server(({ next }) => next({ context: { userId: 'user-1' } }));

export const getGreeting = createServerFn({ method: 'GET' })
  .middleware([requestUser])
  .validator(z.object({ name: z.string().min(1) }))
  .handler(({ data, context }) => ({ greeting: `Hello ${data.name}`, userId: context.userId }));
