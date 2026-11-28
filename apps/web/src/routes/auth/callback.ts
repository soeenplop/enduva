import { createFileRoute } from '@tanstack/react-router';
import { finishOAuth } from '../../auth/oauth.server';

// Auth redirects here after an OAuth sign-in (supabase/config.toml, additional_redirect_urls).
export const Route = createFileRoute('/auth/callback')({
  server: { handlers: { GET: ({ request }) => finishOAuth(request) } },
});
