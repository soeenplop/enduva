import { useEffect, useRef, useState } from 'react';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Loads Cloudflare's script once per page, in the browser only. */
let script: Promise<TurnstileApi> | undefined;
function loadTurnstile(): Promise<TurnstileApi> {
  script ??= new Promise<TurnstileApi>((resolve, reject) => {
    const element = document.createElement('script');
    element.src = SCRIPT;
    element.async = true;
    element.onload = () =>
      window.turnstile === undefined ? reject(new Error('no turnstile')) : resolve(window.turnstile);
    element.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.append(element);
  }).catch((error: unknown) => {
    script = undefined;
    throw error;
  });
  return script;
}

/**
 * The Turnstile widget. It reports a token (or null once it expires) through `onToken`. A token is good for one Auth
 * call, so the form bumps `resetKey` after every submit to get a new one.
 */
export function Turnstile({
  siteKey,
  resetKey,
  onToken,
}: Readonly<{ siteKey: string; resetKey: number; onToken: (token: string | null) => void }>) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const report = useRef(onToken);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    report.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then(
      (api) => {
        if (cancelled || container.current === null) return;
        widget.current = api.render(container.current, {
          sitekey: siteKey,
          language: getLocale(),
          callback: (token: string) => report.current(token),
          'expired-callback': () => report.current(null),
          'error-callback': () => report.current(null),
        });
      },
      () => setFailed(true),
    );
    return () => {
      cancelled = true;
      if (widget.current !== undefined) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey === 0 || widget.current === undefined) return;
    report.current(null);
    window.turnstile?.reset(widget.current);
  }, [resetKey]);

  return (
    <div role="group" aria-label={m.captcha_label()}>
      <div ref={container} className="min-h-16" />
      {failed && <p className="text-small text-danger">{m.captcha_unavailable()}</p>}
    </div>
  );
}
