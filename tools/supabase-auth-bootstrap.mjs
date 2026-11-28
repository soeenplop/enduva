// Initial Auth configuration of the hosted production project (roadmap 0.12b, docs/runbooks/supabase-bootstrap.md).
// Run by the owner only. Without --apply it changes nothing: it prints the difference between the project's Auth
// config and the desired one below, and whether the project signs tokens with an ES256 key. --apply sends only
// the differing fields (Management API PATCH), so a second run finds nothing to do. --verify checks from outside,
// with the publishable key, that /settings reports sign-up off and only then that a sign-up request is refused.
//
// The desired values mirror supabase/config.toml (0.9b), with the production URLs. Keep the two in step.
//
// Env:  SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF       always
//       TURNSTILE_SECRET                                   dry run and --apply (production Turnstile secret)
//       GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET             optional; without them Google stays disabled
//       SKIP_EMAIL_TEMPLATES=1                             optional; leaves the email templates out (no SMTP yet)
//       SUPABASE_PUBLISHABLE_KEY                           --verify
// Usage: node tools/supabase-auth-bootstrap.mjs [--apply | --verify]
//        node tools/supabase-auth-bootstrap.mjs --self-test
import { readFileSync } from 'node:fs';

const APP = 'https://app.enduva.soeenplop.dev';
// The API verifies ES256 by default (AUTH_JWT_ALGORITHM), so production must sign with ES256.
const SIGNING_ALGORITHM = 'ES256';
const template = (name) => readFileSync(new URL(`../supabase/templates/${name}.html`, import.meta.url), 'utf8');

/** Desired Auth config, in the Management API's field names. */
export function desiredConfig(env, readTemplate = template) {
  const google = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  return {
    site_url: APP,
    uri_allow_list: `${APP}/auth/callback,${APP}/auth/confirm`,
    // G1.0 sign-up lock: on from the start. Existing (synthetic) users can still sign in.
    disable_signup: true,
    external_anonymous_users_enabled: false,
    security_manual_linking_enabled: false,
    external_phone_enabled: false,
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    password_min_length: 8,
    jwt_exp: 3600,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    security_captcha_enabled: true,
    security_captcha_provider: 'turnstile',
    security_captcha_secret: env.TURNSTILE_SECRET,
    external_google_enabled: google,
    external_google_skip_nonce_check: false,
    // Custom templates may need custom SMTP; SKIP_EMAIL_TEMPLATES=1 leaves them out until SMTP is set up.
    ...(!env.SKIP_EMAIL_TEMPLATES && {
      mailer_subjects_confirmation: 'Enduva: confirm your email address · Bestätige deine E-Mail-Adresse',
      mailer_templates_confirmation_content: readTemplate('confirmation'),
      mailer_subjects_magic_link: 'Enduva: your sign-in link · Dein Anmeldelink',
      mailer_templates_magic_link_content: readTemplate('magic_link'),
    }),
    ...(google && {
      external_google_client_id: env.GOOGLE_CLIENT_ID,
      external_google_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  };
}

/** Fields whose current value differs from the desired one. */
export function diff(current, desired) {
  return Object.fromEntries(Object.entries(desired).filter(([key, value]) => current[key] !== value));
}

const show = (key, value) => (/secret/.test(key) ? '<redacted>' : JSON.stringify(value)?.slice(0, 80));

/** True if an ES256 key signs new tokens. */
export function signingKeysOk(keys) {
  return keys.some((k) => k.status === 'in_use' && k.algorithm === SIGNING_ALGORITHM);
}

function need(env, ...names) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length > 0) throw new Error(`Missing env: ${missing.join(', ')}`);
}

async function call(method, path, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function bootstrap(apply) {
  need(process.env, 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'TURNSTILE_SECRET');
  const desired = desiredConfig(process.env);
  const changes = diff(await call('GET', '/config/auth'), desired);
  const keys = Object.keys(changes);
  console.log(keys.length === 0 ? 'Auth config: up to date.' : `Auth config: ${keys.length} field(s) differ:`);
  for (const key of keys) console.log(`  ${key} -> ${show(key, changes[key])}`);
  if (apply && keys.length > 0) {
    await call('PATCH', '/config/auth', changes);
    const left = Object.keys(diff(await call('GET', '/config/auth'), desired)).filter((k) => !/secret/.test(k));
    if (left.length > 0) throw new Error(`Still differing after the update: ${left.join(', ')}`);
    console.log('Auth config: updated.');
  } else if (!apply && keys.length > 0) {
    console.log('Dry run: nothing changed. Run again with --apply to update these fields.');
  }
  const { keys: signingKeys = [] } = await call('GET', '/config/auth/signing-keys');
  for (const k of signingKeys) console.log(`  signing key ${k.id}: ${k.algorithm}, ${k.status}`);
  if (!signingKeysOk(signingKeys)) {
    console.error('ACTION NEEDED: no ES256 key in use. Rotate to ES256 in the dashboard (see the runbook).');
    process.exitCode = 1;
  } else {
    console.log('JWT signing: ES256 key in use.');
  }
}

/** Auth error codes that prove a sign-up request was refused (captcha runs before the sign-up handler). */
export const REFUSED = new Set(['signup_disabled', 'captcha_failed']);

// Read-only until the lock is confirmed: the sign-up probe is sent only once /settings reports sign-up off, so
// Auth refuses it whatever it carries. Only the specific refusal codes count, never a 429 or 5xx.
async function verify() {
  need(process.env, 'SUPABASE_PROJECT_REF', 'SUPABASE_PUBLISHABLE_KEY');
  const auth = `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co/auth/v1`;
  const headers = { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' };
  const settingsRes = await fetch(`${auth}/settings`, { headers });
  const settings = settingsRes.ok ? await settingsRes.json() : {};
  console.log(`GET /settings -> HTTP ${settingsRes.status}, disable_signup = ${settings.disable_signup}`);
  if (settings.disable_signup !== true) {
    console.error('FAILED: sign-up is not locked on production. No sign-up probe was sent.');
    process.exit(1);
  }
  const signup = await fetch(`${auth}/signup`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: `signup-probe-${Date.now()}@example.com`, password: crypto.randomUUID() }),
  });
  const { error_code: code } = await signup.json().catch(() => ({}));
  console.log(`POST /signup -> HTTP ${signup.status}, error_code = ${code}`);
  if (!REFUSED.has(code)) {
    console.error('FAILED: the sign-up probe was not refused with signup_disabled or captcha_failed.');
    process.exit(1);
  }
  console.log('Sign-up via the Auth API is rejected.');
}

function selfTest() {
  const env = { TURNSTILE_SECRET: 't' };
  const desired = desiredConfig(env, (name) => `<p>${name}</p>`);
  const checks = [
    ['sign-up is locked', desired.disable_signup === true],
    ['templates are set', desired.mailer_templates_confirmation_content === '<p>confirmation</p>'],
    [
      'templates can be left out',
      !('mailer_templates_confirmation_content' in desiredConfig({ ...env, SKIP_EMAIL_TEMPLATES: '1' }, () => '')),
    ],
    [
      'Google stays off without a client',
      desired.external_google_enabled === false && !('external_google_secret' in desired),
    ],
    [
      'Google on with a client',
      desiredConfig({ ...env, GOOGLE_CLIENT_ID: 'i', GOOGLE_CLIENT_SECRET: 's' }, () => '').external_google_enabled,
    ],
    ['diff of an up-to-date config is empty', Object.keys(diff({ ...desired }, desired)).length === 0],
    [
      'diff lists only changed fields',
      JSON.stringify(Object.keys(diff({ ...desired, disable_signup: false }, desired))) === '["disable_signup"]',
    ],
    ['secrets are redacted', show('security_captcha_secret', 'x') === '<redacted>'],
    [
      'ES256 in use is ok',
      signingKeysOk([
        { algorithm: 'HS256', status: 'previously_used' },
        { algorithm: 'ES256', status: 'in_use' },
      ]),
    ],
    ['RS256 in use is not ok', !signingKeysOk([{ algorithm: 'RS256', status: 'in_use' }])],
    [
      'HS256 in use is not ok',
      !signingKeysOk([
        { algorithm: 'HS256', status: 'in_use' },
        { algorithm: 'ES256', status: 'standby' },
      ]),
    ],
  ];
  for (const [name, pass] of checks) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`);
  if (checks.some(([, pass]) => !pass)) process.exit(1);
  console.log('supabase-auth-bootstrap self-test passed.');
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else if (args.includes('--verify')) await verify();
else await bootstrap(args.includes('--apply'));
