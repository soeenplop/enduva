import { Link } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';
import { LanguageSwitch } from './LanguageSwitch';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link to="/" className="brand" aria-label={m.home_link_label()}>
          <span className="brand-name" aria-hidden="true">
            Enduva
          </span>
        </Link>
        <LanguageSwitch />
      </div>
    </header>
  );
}
