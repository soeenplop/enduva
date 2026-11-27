import handler from '@tanstack/react-start/server-entry';
import { paraglideMiddleware } from './paraglide/server.js';

// The middleware resolves the locale from the URL for the request (also during prerendering).
// The router handles URL localization itself (rewrite in router.tsx), so pass the original request.
export default {
  fetch(req: Request): Promise<Response> {
    return paraglideMiddleware(req, () => handler.fetch(req));
  },
};
