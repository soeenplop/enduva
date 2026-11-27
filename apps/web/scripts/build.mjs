// Production build of the web app (ADR-0001). Run `pnpm generate` first.
//
// `vite build` runs between two snapshots of the generated sources: the route tree and Paraglide
// runtime that `tsr generate` and `paraglide-js compile` wrote for `tsc` must be byte-identical to
// what Start's and Paraglide's Vite plugins use, or `tsc` checked a different app than the one we
// ship. Same check as apps/landing/scripts/build.mjs.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const app = join(import.meta.dirname, '..');
const generated = [join(app, 'src', 'routeTree.gen.ts'), join(app, 'src', 'paraglide')];

function files(path) {
  if (!existsSync(path)) throw new Error(`${relative(app, path)} is missing: run \`pnpm generate\` first`);
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** sha256 of every generated file, keyed by its path relative to the app. */
function snapshot() {
  const hashes = new Map();
  for (const file of generated.flatMap(files)) {
    hashes.set(relative(app, file), createHash('sha256').update(readFileSync(file)).digest('hex'));
  }
  return hashes;
}

/** Turbo restores `generate` outputs into whatever checkout hits its cache, so none may name this one. */
function assertCheckoutIndependent() {
  const checkout = join(app, '..', '..');
  const leaks = generated.flatMap(files).filter((file) => readFileSync(file, 'utf8').includes(checkout));
  if (leaks.length > 0) {
    console.error(
      `Generated files embed the checkout path ${checkout}:\n  ${leaks.map((f) => relative(app, f)).join('\n  ')}`,
    );
    process.exit(1);
  }
}

assertCheckoutIndependent();
const before = snapshot();
const vite = spawnSync(join(app, 'node_modules', '.bin', 'vite'), ['build'], { cwd: app, stdio: 'inherit' });
if (vite.status !== 0) process.exit(vite.status ?? 1);

const after = snapshot();
const drift = [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file));
if (drift.length > 0) {
  console.error(
    `The Vite build changed generated files that tsc checked (run \`pnpm generate\`, and keep tsr.config.json's footer and paraglide.options.mjs in sync with the Vite plugins):\n  ${drift.join('\n  ')}`,
  );
  process.exit(1);
}
assertCheckoutIndependent();
console.log(`ok   route tree and Paraglide output identical after vite build (${after.size} files)`);
