import { Link } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';

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

/** Route options of a placeholder page: its head tags and its component. */
export function placeholderRoute(title: () => string, task: string) {
  return {
    head: () => ({
      meta: [
        { title: `${title()} | Enduva` },
        { name: 'description', content: m.placeholder_description({ page: title(), task }) },
      ],
    }),
    component: () => <PlaceholderPage title={title()} task={task} />,
  };
}
