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
  // Bumped by "Try again" when the script itself failed, which loads it once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    report.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    const fail = () => {
      report.current(null);
      setFailed(true);
    };
    loadTurnstile().then((api) => {
      if (cancelled || container.current === null) return;
      try {
        widget.current = api.render(container.current, {
          sitekey: siteKey,
          language: getLocale(),
          callback: (token: string) => {
            setFailed(false);
            report.current(token);
          },
          'expired-callback': () => report.current(null),
          // The challenge failed after the script loaded (network, a blocked frame): say so, and offer a retry.
          'error-callback': fail,
        });
      } catch {
        fail();
      }
    }, fail);
    return () => {
      cancelled = true;
      if (widget.current !== undefined) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [siteKey, attempt]);

  function retry() {
    setFailed(false);
    if (widget.current !== undefined) window.turnstile?.reset(widget.current);
    else setAttempt((n) => n + 1);
  }

  useEffect(() => {
    if (resetKey === 0 || widget.current === undefined) return;
    report.current(null);
    window.turnstile?.reset(widget.current);
  }, [resetKey]);

  return (
    <div role="group" aria-label={m.captcha_label()}>
      <div ref={container} className="min-h-16" />
      {failed && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-small text-danger">
          <p>{m.captcha_unavailable()}</p>
          <button type="button" className="font-semibold underline" onClick={retry}>
            {m.error_retry()}
          </button>
        </div>
      )}
    </div>
  );
}
