import { useLocation } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';
import { getLocale, localizeHref, locales } from '../paraglide/runtime.js';

/** Links to the current page in every locale. A plain `<a>`: switching the locale is a full page load. */
export function LanguageSwitch() {
  // The router's location is already de-localized (`/imprint/`, not `/de/imprint/`).
  const { pathname } = useLocation();
  const current = getLocale();
  return (
    <nav className="language-switch" aria-label={m.language_switch_label()}>
      <ul>
        {locales.map((locale) => (
          <li key={locale}>
            <a
              href={localizeHref(pathname, { locale })}
              hrefLang={locale}
              lang={locale}
              aria-current={locale === current ? 'page' : undefined}
            >
              {m.language_name({}, { locale })}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
