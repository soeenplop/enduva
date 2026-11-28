import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { signOut } from '../auth/functions';
import { viewerQuery } from '../auth/queries';
import { m } from '../paraglide/messages.js';
import { BrandMark } from './BrandMark';
import { LanguageSwitch } from './LanguageSwitch';

const navLink = 'rounded-md px-3 py-2 font-semibold text-muted hover:text-text';

export function AppHeader() {
  const { data: viewer } = useQuery(viewerQuery);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  /**
   * Navigates only on an answer from the server, with a full page load so nothing of the user stays in the query
   * cache: home if Auth confirmed it, the sign-in page's notice if only this device is signed out. A request that
   * never got an answer changed nothing, so the user stays here, is told, and can try again.
   */
  async function signOutAndReload() {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      const { revoked } = await signOut();
      window.location.assign(revoked ? '/' : '/sign-in?signedOut=local');
    } catch {
      setSigningOut(false);
      setSignOutFailed(true);
    }
  }

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
            <li>
              <Link to="/status" className={navLink} activeProps={{ className: 'text-text', 'aria-current': 'page' }}>
                {m.nav_status()}
              </Link>
            </li>
          </ul>
        </nav>
        <LanguageSwitch />
        <nav aria-label={m.account_label()}>
          <ul className="flex items-center gap-1">
            {viewer ? (
              <>
                <li>
                  <Link
                    to="/profile"
                    className={navLink}
                    activeProps={{ className: 'text-text', 'aria-current': 'page' }}
                  >
                    {m.nav_profile()}
                  </Link>
                </li>
                <li>
                  <button
                    type="button"
                    className={navLink}
                    disabled={signingOut}
                    onClick={() => void signOutAndReload()}
                  >
                    {m.sign_out()}
                  </button>
                </li>
              </>
            ) : (
              <li>
                <Link
                  to="/sign-in"
                  className={navLink}
                  activeProps={{ className: 'text-text', 'aria-current': 'page' }}
                >
                  {m.nav_sign_in()}
                </Link>
              </li>
            )}
          </ul>
        </nav>
      </div>
      {signOutFailed && (
        <p role="alert" className="mx-auto w-full max-w-5xl px-4 pb-3 text-small text-danger">
          {m.sign_out_failed()}
        </p>
      )}
    </header>
  );
}
