import { Link } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';
import { repositoryUrl } from '../../site.mjs';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <nav aria-label={m.footer_legal_label()}>
          <ul className="footer-links">
            <li>
              <Link to="/imprint/">{m.page_imprint()}</Link>
            </li>
            <li>
              <Link to="/privacy/">{m.page_privacy()}</Link>
            </li>
            <li>
              <Link to="/terms/">{m.page_terms()}</Link>
            </li>
            <li>
              <Link to="/disclaimer/">{m.page_disclaimer()}</Link>
            </li>
            <li>
              <Link to="/data-sources/">{m.page_data_sources()}</Link>
            </li>
          </ul>
        </nav>
        <p className="licence">
          {m.footer_licence()} <a href={repositoryUrl}>{m.footer_source_link()}</a>
        </p>
      </div>
    </footer>
  );
}
