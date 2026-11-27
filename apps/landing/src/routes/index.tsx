import { createFileRoute } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [{ title: m.meta_home_title() }, { name: 'description', content: m.meta_home_description() }],
  }),
  component: Home,
});

function Home() {
  return (
    <section className="container">
      <h1>{m.hero_title()}</h1>
    </section>
  );
}
