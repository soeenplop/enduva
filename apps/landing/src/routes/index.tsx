import { createFileRoute } from '@tanstack/react-router';
import { repositoryUrl } from '../../site.mjs';
import { m } from '../paraglide/messages.js';
import { pageHead } from '../seo';

export const Route = createFileRoute('/')({
  head: () => pageHead({ path: '/', title: m.meta_home_title(), description: m.meta_home_description() }),
  component: Home,
});

const pillars = [
  { id: 'endurance', title: m.pillar_endurance_title, body: m.pillar_endurance_body },
  { id: 'strength', title: m.pillar_strength_title, body: m.pillar_strength_body },
  { id: 'nutrition', title: m.pillar_nutrition_title, body: m.pillar_nutrition_body },
] as const;

function Home() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="container">
          <p className="status">{m.hero_status()}</p>
          <h1 id="hero-title">{m.hero_title()}</h1>
          <p className="lead">{m.hero_lead()}</p>
          <a className="button" href="#pillars">
            {m.hero_cta()}
          </a>
        </div>
      </section>

      <section id="pillars" className="section" aria-labelledby="pillars-title">
        <div className="container">
          <h2 id="pillars-title">{m.pillars_title()}</h2>
          <ul className="pillars">
            {pillars.map((pillar) => (
              <li key={pillar.id} className={`pillar pillar-${pillar.id}`}>
                <h3>{pillar.title()}</h3>
                <p>{pillar.body()}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section section-ai" aria-labelledby="ai-title">
        <div className="container narrow">
          <h2 id="ai-title">{m.ai_title()}</h2>
          <p>{m.ai_body()}</p>
        </div>
      </section>

      <section className="section" aria-labelledby="cta-title">
        <div className="container narrow cta">
          <h2 id="cta-title">{m.cta_title()}</h2>
          <p>{m.cta_body()}</p>
          <a className="button" href={repositoryUrl}>
            {m.cta_link()}
          </a>
        </div>
      </section>
    </>
  );
}
