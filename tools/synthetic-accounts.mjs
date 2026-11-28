// Pre-provisioned synthetic accounts on the hosted project (roadmap 0.12b, docs/runbooks/supabase-bootstrap.md).
// Sign-up is off (G1.0), so test accounts are created through the Auth admin API. Run by the owner only.
// Every account is `synthetic-<label>@example.com`, confirmed, and marked `app_metadata.synthetic = true`. Cleanup
// deletes only the labels it is given, and only accounts that carry the marker. Synthetic data only.
// Without --apply, create and delete only print what they would do.
//
// Env:   SUPABASE_PROJECT_REF, SUPABASE_SECRET_KEY (the project's secret key, admin API)
//        SYNTHETIC_PASSWORD_<LABEL> optional (automation); otherwise create asks on the TTY with hidden input
// Usage: node tools/synthetic-accounts.mjs create <label>… [--apply]   creates missing accounts, asks for passwords
//        node tools/synthetic-accounts.mjs list
//        node tools/synthetic-accounts.mjs delete <label>… [--apply]   deletes exactly these accounts
//        node tools/synthetic-accounts.mjs --self-test
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

const email = (label) => `synthetic-${label}@example.com`;
const PATTERN = /^synthetic-[a-z0-9-]+@example\.com$/;

/** True only for accounts this script created. */
export const isSynthetic = (user) => user.app_metadata?.synthetic === true && PATTERN.test(user.email ?? '');

/** The synthetic accounts among `users` with exactly these labels. */
export const selectForDeletion = (users, labels) =>
  users.filter((u) => isSynthetic(u) && labels.map(email).includes(u.email));

function checkLabels(labels) {
  if (labels.length === 0 || labels.some((l) => !PATTERN.test(email(l)))) {
    throw new Error('Give one or more labels (a-z, 0-9 and -)');
  }
}

async function admin(method, path, body) {
  for (const n of ['SUPABASE_PROJECT_REF', 'SUPABASE_SECRET_KEY'])
    if (!process.env[n]) throw new Error(`Missing env: ${n}`);
  const res = await fetch(`https://${process.env.SUPABASE_PROJECT_REF}.supabase.co/auth/v1/admin${path}`, {
    method,
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function syntheticUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { users } = await admin('GET', `/users?page=${page}&per_page=100`);
    found.push(...users.filter(isSynthetic));
    if (users.length < 100) return found;
  }
}

/** `SYNTHETIC_PASSWORD_<LABEL>`, label upper-cased, other characters as `_`. */
export const passwordVar = (label) => `SYNTHETIC_PASSWORD_${label.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')}`;

/** The password from the environment, else typed on the TTY. Never logged, never taken from argv. */
export async function passwordFor(label, env = process.env, prompt = promptHidden) {
  const password = env[passwordVar(label)] ?? (await prompt(`Password for ${label}: `));
  if (password.length < 16) throw new Error(`The password for ${label} must have at least 16 characters`);
  return password;
}

async function promptHidden(question) {
  if (!process.stdin.isTTY) throw new Error('No TTY to ask for the password: set it in the environment instead');
  process.stdout.write(question);
  // Typed characters echo into a muted stream, so the password never appears on screen.
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  const answer = await rl.question('');
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function create(labels, apply) {
  checkLabels(labels);
  const existing = new Set((await syntheticUsers()).map((u) => u.email));
  for (const label of labels) {
    if (existing.has(email(label))) {
      console.log(`${email(label)}: exists, unchanged`);
      continue;
    }
    if (!apply) {
      console.log(`${email(label)}: would be created (run again with --apply)`);
      continue;
    }
    const password = await passwordFor(label);
    await admin('POST', '/users', {
      email: email(label),
      password,
      email_confirm: true,
      app_metadata: { synthetic: true },
    });
    console.log(`${email(label)}: created`);
  }
}

async function remove(labels, apply) {
  checkLabels(labels);
  const users = selectForDeletion(await syntheticUsers(), labels);
  for (const u of users) {
    if (apply) await admin('DELETE', `/users/${u.id}`);
    console.log(`${u.email}: ${apply ? 'deleted' : 'would be deleted (run again with --apply)'}`);
  }
  if (users.length === 0) console.log('No synthetic accounts with these labels.');
}

async function selfTest() {
  const noPrompt = () => {
    throw new Error('prompted');
  };
  const refuses = (promise) =>
    promise.then(
      () => false,
      (e) => e.message.includes('16 characters'),
    );
  const checks = [
    ['marked synthetic account', isSynthetic({ email: email('ios-review'), app_metadata: { synthetic: true } })],
    ['unmarked account with the pattern', !isSynthetic({ email: email('a'), app_metadata: {} })],
    [
      'marked account with another address',
      !isSynthetic({ email: 'owner@enduva.de', app_metadata: { synthetic: true } }),
    ],
    ['marker must be exactly true', !isSynthetic({ email: email('a'), app_metadata: { synthetic: 'true' } })],
    [
      'cleanup keeps the standing accounts',
      JSON.stringify(
        selectForDeletion(
          ['testflight', 'smoke', 'xt-a', 'xt-b'].map((l) => ({ email: email(l), app_metadata: { synthetic: true } })),
          ['xt-a', 'xt-b'],
        ).map((u) => u.email),
      ) === JSON.stringify([email('xt-a'), email('xt-b')]),
    ],
    ['password variable name', passwordVar('xt-a') === 'SYNTHETIC_PASSWORD_XT_A'],
    [
      'password from the environment, no prompt',
      (await passwordFor('smoke', { SYNTHETIC_PASSWORD_SMOKE: 'p'.repeat(16) }, noPrompt)) === 'p'.repeat(16),
    ],
    [
      'short password from the environment refused',
      await refuses(passwordFor('a', { SYNTHETIC_PASSWORD_A: 'short' }, noPrompt)),
    ],
    ['short typed password refused', await refuses(passwordFor('a', {}, async () => 'short'))],
    [
      'cleanup skips unmarked accounts',
      selectForDeletion([{ email: email('xt-a'), app_metadata: {} }], ['xt-a']).length === 0,
    ],
  ];
  for (const [name, pass] of checks) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`);
  if (checks.some(([, pass]) => !pass)) process.exit(1);
  console.log('synthetic-accounts self-test passed.');
}

const [command, ...rest] = process.argv.slice(2);
const labels = rest.filter((a) => a !== '--apply');
const apply = rest.includes('--apply');
if (command === '--self-test') await selfTest();
else if (command === 'create') await create(labels, apply);
else if (command === 'list') for (const u of await syntheticUsers()) console.log(`${u.email} ${u.id}`);
else if (command === 'delete') await remove(labels, apply);
else throw new Error('Usage: create <label>… [--apply] | list | delete <label>… [--apply] | --self-test');
