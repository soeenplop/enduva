import handler from '@tanstack/react-start/server-entry';
import { paraglideMiddleware } from './paraglide/server.js';

// Resolves the locale for this request (cookie, then `Accept-Language`, then `en`) and keeps it in
// request-scoped storage, so concurrent requests never see each other's locale.
//
// Pages and server functions can carry a user's data or a session cookie, so no shared cache may keep them.
export default {
  async fetch(req: Request): Promise<Response> {
    const res = await paraglideMiddleware(req, () => handler.fetch(req));
    if (!res.headers.has('cache-control')) res.headers.set('cache-control', 'private, no-store');
    return res;
  },
};
