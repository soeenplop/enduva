import { Link } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';
import { pageHead } from '../seo';

export interface PlaceholderPageProps {
  title: string;
  /** The roadmap task that delivers the final text, e.g. `G1.1`. */
  task: string;
}

/** A page whose final text is owned by a later task. The notice says so in both locales. */
export function PlaceholderPage({ title, task }: PlaceholderPageProps) {
  return (
    <article className="container narrow page">
      <h1>{title}</h1>
      <p className="notice" role="note">
        {m.placeholder_notice({ task })}
      </p>
      <p>{m.placeholder_body()}</p>
      <p>
        <Link to="/">{m.back_home()}</Link>
      </p>
    </article>
  );
}

/** Route options of a placeholder page at `path` (as in `site.mjs`): its head tags and component. */
export function placeholderRoute(path: string, title: () => string, task: string) {
  return {
    head: () =>
      pageHead({
        path,
        title: `${title()} | Enduva`,
        description: m.placeholder_description({ page: title(), task }),
      }),
    component: () => <PlaceholderPage title={title()} task={task} />,
  };
}
