import { Link } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';
import { BrandMark } from './BrandMark';
import { LanguageSwitch } from './LanguageSwitch';

const navLink = 'rounded-md px-3 py-2 font-semibold text-muted hover:text-text';

export function AppHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex min-h-16 w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4">
        <Link to="/" className="flex items-center gap-2 text-lg font-extrabold" aria-label={m.home_link_label()}>
          <BrandMark />
          <span aria-hidden="true">Enduva</span>
        </Link>
        <nav aria-label={m.nav_label()} className="flex-1">
          <ul className="flex gap-1">
            <li>
              <Link
                to="/"
                activeOptions={{ exact: true }}
                className={navLink}
                activeProps={{ className: 'text-text', 'aria-current': 'page' }}
              >
                {m.nav_home()}
              </Link>
            </li>
          </ul>
        </nav>
        <LanguageSwitch />
      </div>
    </header>
  );
}
