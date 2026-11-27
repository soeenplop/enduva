import { m } from '../paraglide/messages.js';
import { getLocale, locales, setLocale } from '../paraglide/runtime.js';

/**
 * Stores the chosen locale in the locale cookie and reloads the page, which the server then renders
 * in that language. The cookie stands in for the profile setting until 0.9b.
 */
export function LanguageSwitch() {
  const current = getLocale();
  return (
    <ul className="flex gap-1" aria-label={m.language_switch_label()}>
      {locales.map((locale) => (
        <li key={locale}>
          <button
            type="button"
            lang={locale}
            aria-pressed={locale === current}
            className="rounded-pill px-3 py-1 text-small font-semibold text-muted hover:text-text aria-pressed:bg-primary aria-pressed:text-on-primary"
            onClick={() => void setLocale(locale)}
          >
            {m.language_name({}, { locale })}
          </button>
        </li>
      ))}
    </ul>
  );
}
