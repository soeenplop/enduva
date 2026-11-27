import { createFileRoute } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <section aria-labelledby="home-title">
      <h1 id="home-title">{m.home_title()}</h1>
      <p>{m.home_lead()}</p>
    </section>
  );
}
