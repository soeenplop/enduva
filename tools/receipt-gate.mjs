// Receipt gate for production writes (06-deployment.md, "Production requires a receipt"; roadmap 0.12b/0.12c).
// deploy/scripts/db-push.sh runs it before `supabase db push`, under the production lock. It allows the write only
// if a production receipt exists for exactly this SHA, its image digests and migration set match the candidate,
// and it was verified against exactly the migration history production has applied right now.
//
// Receipt (written by the isolated candidate verifier, 0.12c):
//   { "kind": "production", "result": "passed", "sha": "<commit>",
//     "digests": { "api": "sha256:…", … },          image digests that were tested
//     "migrations": { "<file>.sql": "<sha256>", … }, migration files of the SHA (see migrationSet)
//     "baseline": ["<version>", …] }                  applied production history it was verified against
//
// Usage: node tools/receipt-gate.mjs --receipt <file> --sha <commit> --digests <json file> --applied <file>
//          (--applied: one applied version per line, empty file = nothing applied yet)
//        node tools/receipt-gate.mjs --self-test
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;

/** Migration files of a checkout and the SHA-256 of their contents, by file name. */
export function migrationSet(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  return Object.fromEntries(
    files.sort().map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(join(dir, f)))
        .digest('hex'),
    ]),
  );
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (obj) => Object.fromEntries(Object.entries(obj ?? {}).sort(([a], [b]) => a.localeCompare(b)));

/** Every reason to refuse the production write; empty means the receipt authorises it. */
export function judge({ receipt, sha, digests, migrations, applied }) {
  if (receipt === undefined) return ['no receipt for this SHA'];
  const problems = [];
  if (receipt.kind !== 'production') problems.push(`receipt kind is ${receipt.kind}, only a production receipt counts`);
  if (receipt.result !== 'passed') problems.push(`receipt result is ${receipt.result}, not passed`);
  if (receipt.sha !== sha) problems.push(`receipt is for ${receipt.sha}, not ${sha}`);
  if (!same(sorted(receipt.digests), sorted(digests))) problems.push('image digests differ from the receipt');
  if (!same(sorted(receipt.migrations), sorted(migrations))) problems.push('migration set differs from the receipt');
  if (!same(receipt.baseline, applied)) {
    problems.push('production migration history differs from the receipt baseline: re-verify this SHA in isolation');
  }
  return problems;
}

function main() {
  const { values } = parseArgs({
    options: {
      receipt: { type: 'string' },
      sha: { type: 'string' },
      digests: { type: 'string' },
      applied: { type: 'string' },
    },
  });
  for (const name of ['receipt', 'sha', 'digests', 'applied']) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const problems = judge({
    receipt: existsSync(values.receipt) ? readJson(values.receipt) : undefined,
    sha: values.sha,
    digests: readJson(values.digests),
    migrations: migrationSet(),
    applied: readFileSync(values.applied, 'utf8').split('\n').filter(Boolean),
  });
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error::receipt gate: ${p}`);
    console.error('Refusing to write to production.');
    process.exit(1);
  }
  console.log(`Receipt gate passed for ${values.sha}.`);
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'receipt-gate-'));
  writeFileSync(join(dir, '001_a.sql'), 'select 1;');
  writeFileSync(join(dir, '002_b.sql'), 'select 2;');
  const migrations = migrationSet(dir);
  const sha = 'a'.repeat(40);
  const digests = { api: 'sha256:1', web: 'sha256:2' };
  const receipt = { kind: 'production', result: 'passed', sha, digests, migrations, baseline: ['001'] };
  const ok = { receipt, sha, digests, migrations, applied: ['001'] };
  const cases = [
    ['valid receipt', ok, null],
    ['digests in another key order', { ...ok, digests: { web: 'sha256:2', api: 'sha256:1' } }, null],
    ['missing receipt', { ...ok, receipt: undefined }, 'no receipt'],
    ['staging receipt', { ...ok, receipt: { ...receipt, kind: 'staging' } }, 'only a production receipt'],
    ['failed receipt', { ...ok, receipt: { ...receipt, result: 'failed' } }, 'not passed'],
    ['other SHA', { ...ok, sha: 'b'.repeat(40) }, 'not bbbb'],
    ['other digest', { ...ok, digests: { ...digests, web: 'sha256:3' } }, 'image digests'],
    ['added migration', { ...ok, migrations: { ...migrations, '003_c.sql': 'x' } }, 'migration set'],
    ['edited migration', { ...ok, migrations: { ...migrations, '002_b.sql': 'x' } }, 'migration set'],
    // Migrations succeeded but the deploy failed: production moved on, so the old receipt is stale.
    ['stale baseline', { ...ok, applied: ['001', '002'] }, 're-verify'],
  ];
  let failed = 0;
  for (const [name, input, expected] of cases) {
    const problems = judge(input);
    const pass = expected === null ? problems.length === 0 : problems.some((p) => p.includes(expected));
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : `: ${JSON.stringify(problems)}`}`);
  }
  if (failed > 0) process.exit(1);
  console.log('receipt-gate self-test passed.');
}

if (process.argv.includes('--self-test')) selfTest();
else main();
