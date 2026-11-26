import { createFileRoute } from '@tanstack/react-router';
import { Hero } from '../components/Hero';
import { m } from '../paraglide/messages.js';
import { getLocale, localizeHref } from '../paraglide/runtime.js';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  const other = getLocale() === 'de' ? 'en' : 'de';
  return <Hero title={m.hero_title()} switchLabel={m.switch_language()} switchHref={localizeHref('/', { locale: other })} />;
}
