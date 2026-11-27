import handler from '@tanstack/react-start/server-entry';
import { paraglideMiddleware } from './paraglide/server.js';

// Resolves the locale for this request (cookie, then `Accept-Language`, then `en`) and keeps it in
// request-scoped storage, so concurrent requests never see each other's locale.
export default {
  fetch(req: Request): Promise<Response> {
    return paraglideMiddleware(req, () => handler.fetch(req));
  },
};
