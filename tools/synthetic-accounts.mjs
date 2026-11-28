// Pre-provisioned synthetic accounts on the hosted project (roadmap 0.12b, docs/runbooks/supabase-bootstrap.md).
// Sign-up is off (G1.0), so test accounts are created through the Auth admin API. Run by the owner only.
// Every account is `synthetic-<label>@example.com`, confirmed, and marked `app_metadata.synthetic = true`; cleanup
// deletes only accounts that carry both the marker and that address pattern. Synthetic data only.
//
// Env:   SUPABASE_PROJECT_REF, SUPABASE_SECRET_KEY (the project's secret key, admin API)
// Usage: node tools/synthetic-accounts.mjs create <label>…   creates missing accounts, prints each new password once
//        node tools/synthetic-accounts.mjs list
//        node tools/synthetic-accounts.mjs delete [--yes]     without --yes only lists what it would delete
//        node tools/synthetic-accounts.mjs --self-test
import { randomBytes } from 'node:crypto';

const email = (label) => `synthetic-${label}@example.com`;
const PATTERN = /^synthetic-[a-z0-9-]+@example\.com$/;

/** True only for accounts this script created. */
export const isSynthetic = (user) => user.app_metadata?.synthetic === true && PATTERN.test(user.email ?? '');

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

async function create(labels) {
  if (labels.length === 0 || labels.some((l) => !PATTERN.test(email(l)))) throw new Error('Labels: a-z, 0-9 and -');
  const existing = new Set((await syntheticUsers()).map((u) => u.email));
  for (const label of labels) {
    if (existing.has(email(label))) {
      console.log(`${email(label)}: exists, unchanged`);
      continue;
    }
    const password = randomBytes(18).toString('base64url');
    await admin('POST', '/users', {
      email: email(label),
      password,
      email_confirm: true,
      app_metadata: { synthetic: true },
    });
    console.log(`${email(label)}: created, password ${password} (store it in 1Password now; it is not shown again)`);
  }
}

async function remove(yes) {
  const users = await syntheticUsers();
  for (const u of users) {
    if (yes) await admin('DELETE', `/users/${u.id}`);
    console.log(`${u.email}: ${yes ? 'deleted' : 'would be deleted'}`);
  }
  if (!yes && users.length > 0) console.log('Nothing deleted. Run again with --yes to delete these accounts.');
  if (users.length === 0) console.log('No synthetic accounts.');
}

function selfTest() {
  const checks = [
    ['marked synthetic account', isSynthetic({ email: email('ios-review'), app_metadata: { synthetic: true } })],
    ['unmarked account with the pattern', !isSynthetic({ email: email('a'), app_metadata: {} })],
    [
      'marked account with another address',
      !isSynthetic({ email: 'owner@enduva.soeenplop.dev', app_metadata: { synthetic: true } }),
    ],
    ['marker must be exactly true', !isSynthetic({ email: email('a'), app_metadata: { synthetic: 'true' } })],
  ];
  for (const [name, pass] of checks) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`);
  if (checks.some(([, pass]) => !pass)) process.exit(1);
  console.log('synthetic-accounts self-test passed.');
}

const [command, ...rest] = process.argv.slice(2);
if (command === '--self-test') selfTest();
else if (command === 'create') await create(rest);
else if (command === 'list') for (const u of await syntheticUsers()) console.log(`${u.email} ${u.id}`);
else if (command === 'delete') await remove(rest.includes('--yes'));
else throw new Error('Usage: create <label>… | list | delete [--yes] | --self-test');
