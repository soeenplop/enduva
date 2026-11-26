// Bundled-TypeScript audit (T1 clarification, owner ruling on PR #97).
//
// The lockfile audit only sees package names and versions. This audit looks at the *installed
// files*: it finds TypeScript compiler code that another package ships inside its own files
// (a bundled or renamed copy of the TypeScript < 7 compiler, e.g. Prettier's TypeScript parser).
//
// Method
//   1. Walk every given `node_modules` tree without following symlinks, so each installed file is
//      read once (pnpm's `.pnpm` store holds the real directories; everything else is a symlink).
//      This includes nested `node_modules` (bundledDependencies) and packages from any source
//      (registry, tarball, git): the scan looks at contents, not at names.
//   2. Read every JavaScript file (`.js`, `.mjs`, `.cjs`, and extensionless files with a `node`
//      shebang). TypeScript < 7 was only ever shipped as JavaScript, so this covers every form in
//      which a pre-7 compiler can run.
//   3. A file is TypeScript compiler code if it contains a key from the compiler's generated
//      diagnostic table (`"Unterminated_string_literal_1002"`, `"Identifier_expected_1003"`). These
//      string literals are part of the scanner/parser, exist in every TypeScript 2.x–6.x build and
//      survive minification and re-bundling.
//   4. The bundled version is read, where possible, from
//      - `versionMajorMinor = "X.Y"` (unminified compiler builds),
//      - a minified `<id>="X.Y"` whose identifier is later used as `<id>.split(".")` or `${<id>}`
//        (how the compiler and typescript-estree use `versionMajorMinor`),
//      - `typescript@vX.Y.Z` / `typescript@X.Y.Z` in the package's notice files (THIRD-PARTY-NOTICES,
//        NOTICE, LICENSE). If no version is found, it is "unknown" and treated like < 7.
//   5. Every file is attributed to the nearest enclosing package.json with a `name` and `version`.
//
// Verdict
//   - The `typescript` package itself at >= 7 is the compiler we use and is not a bundled copy.
//     `typescript` < 7 always fails (it is never allowlistable; the lockfile audit catches it too).
//   - Any other package that contains compiler code must be in the allowlist with exactly this
//     package name and version, the detected bundled TypeScript version and the exact file list.
//   - Allowlist entries that match no installed package fail as stale. So any version change of an
//     allowlisted package (or of its bundled TypeScript, or of the files that carry it) fails until
//     the allowlist is updated on purpose.
//
// Limits (see ADR-0001)
//   - Only installed files are scanned: optional packages for other platforms are not present on
//     the runner. Run it after `pnpm install --frozen-lockfile` on the CI platform.
//   - Compiler code that is compressed, encoded (base64, wasm, zip) or downloaded at run time is
//     not visible, nor is a copy whose diagnostic keys were deliberately stripped or rewritten.
//     The signatures detect the TypeScript scanner/parser; a tool that ships only small helpers
//     copied from TypeScript (no diagnostic table) is not detected.
//   - Minified version detection is heuristic; a copy whose version cannot be read fails unless an
//     allowlist entry says `"bundledTypeScript": "unknown"`.
//
// Usage: node scripts/audit-bundled-typescript.mjs --allowlist <file.json> <node_modules>...
//        node scripts/audit-bundled-typescript.mjs --self-test
import {
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIGNATURES = ['"Unterminated_string_literal_1002"', '"Identifier_expected_1003"'];
const JS_EXT = /\.(?:js|mjs|cjs)$/;
const NOTICE = /^(?:THIRD[-_]PARTY[-_]NOTICES|NOTICES?|LICEN[CS]E)(?:\.\w+)?$/i;

function isJavaScript(path, name) {
  if (JS_EXT.test(name)) return true;
  if (name.includes('.')) return false;
  const head = Buffer.alloc(64);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, head, 0, 64, 0);
  } finally {
    closeSync(fd);
  }
  return /^#!.*\bnode\b/.test(head.toString('latin1'));
}

// Version evidence from one compiler file.
function versionsInCode(text) {
  const found = new Set();
  for (const m of text.matchAll(/\bversionMajorMinor\s*=\s*["'](\d+\.\d+)["']/g)) found.add(m[1]);
  for (const m of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=\s*"(\d+\.\d+)"/g)) {
    const id = m[1].replace(/\$/g, '\\$');
    if (new RegExp(`(?<![\\w$.])${id}\\.split\\(["']\\.["']\\)|\\$\\{${id}\\}`).test(text)) found.add(m[2]);
  }
  return found;
}

function versionsInNotices(dir) {
  const found = new Set();
  for (const name of readdirSync(dir)) {
    if (!NOTICE.test(name)) continue;
    const path = join(dir, name);
    if (!lstatSync(path).isFile()) continue;
    for (const m of readFileSync(path, 'utf8').matchAll(/(?<![\w@/-])typescript@v?(\d+\.\d+\.\d+[\w.-]*)/g))
      found.add(m[1]);
  }
  return found;
}

function readManifest(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof pkg.name === 'string' && typeof pkg.version === 'string' ? pkg : null;
  } catch {
    return null;
  }
}

/** Finds every installed package that contains TypeScript compiler code. */
export function scan(roots) {
  const hits = new Map(); // `${name}@${version}` -> { name, version, dir, files: Set, versions: Set }

  function walk(dir, owner) {
    const manifest = readManifest(dir);
    if (manifest) owner = { name: manifest.name, version: manifest.version, dir };
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, owner);
        continue;
      }
      if (!entry.isFile() || !owner || !isJavaScript(path, entry.name)) continue;
      const text = readFileSync(path, 'latin1');
      if (!SIGNATURES.some((s) => text.includes(s))) continue;
      const key = `${owner.name}@${owner.version}`;
      let hit = hits.get(key);
      if (!hit) {
        hit = { name: owner.name, version: owner.version, dir: owner.dir, files: new Set(), versions: new Set() };
        hits.set(key, hit);
      }
      hit.files.add(relative(owner.dir, path).split('\\').join('/'));
      for (const v of versionsInCode(text)) hit.versions.add(v);
    }
  }
  for (const root of roots) {
    if (!existsSync(root)) throw new Error(`not found: ${root}`);
    walk(root, null);
  }
  for (const hit of hits.values()) for (const v of versionsInNotices(hit.dir)) hit.versions.add(v);
  return [...hits.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

const byText = (a, b) => a.localeCompare(b);
const major = (v) => Number(v.split('.')[0]);
// A detected "6.0" is consistent with an allowlisted "6.0.3"; a detected "6.0.3" must match exactly.
const compatible = (detected, listed) =>
  detected.split('.').length === 2 ? listed.startsWith(`${detected}.`) || listed === detected : listed === detected;
const REQUIRED = ['package', 'version', 'bundledTypeScript', 'files', 'usedBy', 'usage', 'reason'];

export function judge(hits, allowlist) {
  const problems = [];
  const report = [];
  const entries = allowlist.entries ?? [];
  for (const [i, e] of entries.entries()) {
    const missing = REQUIRED.filter(
      (k) => e[k] === undefined || e[k] === '' || (Array.isArray(e[k]) && e[k].length === 0),
    );
    if (missing.length > 0) problems.push(`allowlist entry ${i} (${e.package ?? '?'}) lacks: ${missing.join(', ')}`);
    if (typeof e.version === 'string' && !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(e.version)) {
      problems.push(`allowlist entry ${e.package}@${e.version}: version must be exact`);
    }
  }
  const used = new Set();
  for (const hit of hits) {
    const id = `${hit.name}@${hit.version}`;
    const versions = [...hit.versions].sort(byText);
    const shown = versions.join(', ') || 'unknown';
    if (hit.name === 'typescript') {
      if (major(hit.version) >= 7 && versions.every((v) => major(v) >= 7)) {
        report.push(`ok   ${id}: the TypeScript 7 package itself`);
      } else {
        problems.push(`${id}: TypeScript < 7 is not allowed (T1), found TypeScript ${shown}`);
      }
      continue;
    }
    const files = [...hit.files].sort(byText);
    const entry = entries.find((e) => e.package === hit.name && e.version === hit.version);
    if (!entry) {
      problems.push(
        `${id}: bundles TypeScript compiler code (TypeScript ${shown}) in ${files.join(', ')} and is not allowlisted`,
      );
      continue;
    }
    used.add(entry);
    const listed = String(entry.bundledTypeScript);
    const versionOk =
      versions.length === 0
        ? listed === 'unknown'
        : listed !== 'unknown' && versions.every((v) => compatible(v, listed));
    if (!versionOk) problems.push(`${id}: bundled TypeScript is ${shown}, allowlist says ${listed}`);
    const listedFiles = [...(entry.files ?? [])].sort(byText);
    if (JSON.stringify(listedFiles) !== JSON.stringify(files)) {
      problems.push(`${id}: compiler code found in [${files.join(', ')}], allowlist lists [${listedFiles.join(', ')}]`);
    }
    if (problems.every((p) => !p.startsWith(`${id}:`))) {
      report.push(
        `ok   ${id}: allowlisted bundled TypeScript ${listed} (${files.join(', ')}); used by ${entry.usedBy}`,
      );
    }
  }
  for (const e of entries)
    if (!used.has(e)) problems.push(`stale allowlist entry ${e.package}@${e.version}: no installed package matches`);
  return { problems, report };
}

function run(allowlistPath, roots) {
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const hits = scan(roots);
  const { problems, report } = judge(hits, allowlist);
  for (const line of report) console.log(line);
  if (problems.length > 0) {
    console.error(`FAIL bundled TypeScript audit (${roots.join(', ')}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`ok   ${roots.join(', ')}: no unlisted bundled TypeScript compiler code`);
}

// --- self-test ---------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, 'fixtures', 'bundled-typescript');

function fakePackage(root, storeKey, name, version, files, extra = {}) {
  const dir = join(root, '.pnpm', storeKey, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, ...extra }));
  for (const [path, fixture] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    if (fixture.startsWith('text:')) writeFileSync(join(dir, path), fixture.slice(5));
    else cpSync(join(FIXTURES, fixture), join(dir, path));
  }
  return dir;
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'bundled-ts-'));
  const entry = {
    package: 'fake-formatter',
    version: '1.0.0',
    bundledTypeScript: '6.0.3',
    files: ['dist/parser.js'],
    usedBy: 'self-test',
    usage: 'formatting',
    reason: 'self-test',
  };
  const cases = [];
  const check = (name, expectFail, setup, allowlist = { entries: [] }, match) =>
    cases.push({ name, expectFail, setup, allowlist, match });

  check(
    'rejects an unlisted bundled TypeScript 6 copy (unminified)',
    true,
    (r) => {
      fakePackage(r, 'fake-formatter@1.0.0', 'fake-formatter', '1.0.0', { 'dist/parser.js': 'ts6-unminified.js' });
    },
    undefined,
    /fake-formatter@1\.0\.0: bundles TypeScript compiler code \(TypeScript 6\.0\)/,
  );
  check(
    'rejects an unlisted, renamed and minified TypeScript 6 copy',
    true,
    (r) => {
      fakePackage(r, 'not-typescript@2.0.0', 'not-typescript', '2.0.0', { 'lib/tsc.mjs': 'ts6-minified.js' });
    },
    undefined,
    /not-typescript@2\.0\.0: .*TypeScript 6\.0/,
  );
  check(
    'rejects a copy hidden in a bundled dependency',
    true,
    (r) => {
      const dir = fakePackage(r, 'outer@1.0.0', 'outer', '1.0.0', {});
      mkdirSync(join(dir, 'node_modules', 'inner', 'lib'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'inner', 'package.json'), '{"name":"inner","version":"0.1.0"}');
      cpSync(join(FIXTURES, 'ts6-unminified.js'), join(dir, 'node_modules', 'inner', 'lib', 'index.js'));
    },
    undefined,
    /inner@0\.1\.0/,
  );
  check(
    'rejects a copy in an extensionless node script',
    true,
    (r) => {
      const dir = fakePackage(r, 'cli-tool@3.0.0', 'cli-tool', '3.0.0', {});
      mkdirSync(join(dir, 'bin'), { recursive: true });
      writeFileSync(
        join(dir, 'bin', 'cli-tool'),
        `#!/usr/bin/env node\n${readFileSync(join(FIXTURES, 'ts6-unminified.js'), 'utf8')}`,
      );
    },
    undefined,
    /cli-tool@3\.0\.0: .* in bin\/cli-tool/,
  );
  check(
    'rejects a package named typescript >= 7 that carries TypeScript 6 code',
    true,
    (r) => {
      fakePackage(r, 'typescript@7.0.0', 'typescript', '7.0.0', { 'lib/typescript.js': 'ts6-unminified.js' });
    },
    undefined,
    /typescript@7\.0\.0: TypeScript < 7 is not allowed/,
  );
  check(
    'rejects a copy with an unreadable version',
    true,
    (r) => {
      fakePackage(r, 'opaque@1.0.0', 'opaque', '1.0.0', {
        'index.cjs': 'text:var x={a:d(1002,1,"Unterminated_string_literal_1002","Unterminated string literal.")};',
      });
    },
    undefined,
    /opaque@1\.0\.0: .*TypeScript unknown/,
  );
  check(
    'rejects typescript < 7 itself, even if allowlisted',
    true,
    (r) => {
      fakePackage(r, 'typescript@6.0.3', 'typescript', '6.0.3', { 'lib/typescript.js': 'ts6-unminified.js' });
    },
    { entries: [{ ...entry, package: 'typescript', version: '6.0.3', files: ['lib/typescript.js'] }] },
    /typescript@6\.0\.3: TypeScript < 7/,
  );
  check(
    'accepts an allowlisted copy (exact package, version, bundled TS and files)',
    false,
    (r) => {
      fakePackage(r, 'fake-formatter@1.0.0', 'fake-formatter', '1.0.0', {
        'dist/parser.js': 'ts6-unminified.js',
        'THIRD-PARTY-NOTICES.md': 'text:## typescript@v6.0.3\n',
      });
    },
    { entries: [entry] },
  );
  check(
    'rejects an allowlisted package after a version change',
    true,
    (r) => {
      fakePackage(r, 'fake-formatter@1.0.1', 'fake-formatter', '1.0.1', { 'dist/parser.js': 'ts6-unminified.js' });
    },
    { entries: [entry] },
    /fake-formatter@1\.0\.1: .*not allowlisted[\s\S]*stale allowlist entry fake-formatter@1\.0\.0/,
  );
  check(
    'rejects an allowlisted package whose bundled TypeScript changed',
    true,
    (r) => {
      fakePackage(r, 'fake-formatter@1.0.0', 'fake-formatter', '1.0.0', {
        'dist/parser.js':
          'text:var versionMajorMinor = "5.9";\nvar E={a:d(1003,1,"Identifier_expected_1003","Identifier expected.")};',
      });
    },
    { entries: [entry] },
    /bundled TypeScript is 5\.9, allowlist says 6\.0\.3/,
  );
  check(
    'rejects an allowlisted package that carries the compiler in a new file',
    true,
    (r) => {
      fakePackage(r, 'fake-formatter@1.0.0', 'fake-formatter', '1.0.0', {
        'dist/parser.js': 'ts6-unminified.js',
        'dist/extra.mjs': 'ts6-minified.js',
      });
    },
    { entries: [entry] },
    /compiler code found in \[dist\/extra\.mjs, dist\/parser\.js\]/,
  );
  check(
    'rejects an incomplete allowlist entry',
    true,
    (r) => {
      fakePackage(r, 'fake-formatter@1.0.0', 'fake-formatter', '1.0.0', { 'dist/parser.js': 'ts6-unminified.js' });
    },
    { entries: [{ ...entry, reason: '' }] },
    /lacks: reason/,
  );
  check('accepts the typescript 7 package and packages without compiler code', false, (r) => {
    fakePackage(r, 'typescript@7.0.2', 'typescript', '7.0.2', {
      'lib/version.cjs': 'text:exports.versionMajorMinor = "7.0";\n',
    });
    fakePackage(r, 'left-pad@1.3.0', 'left-pad', '1.3.0', { 'index.js': 'text:module.exports = (s) => s;\n' });
  });

  let failed = 0;
  for (const [i, c] of cases.entries()) {
    const root = join(tmp, String(i), 'node_modules');
    mkdirSync(root, { recursive: true });
    c.setup(root);
    const { problems } = judge(scan([root]), c.allowlist);
    const text = problems.join('\n');
    const ok = c.expectFail ? problems.length > 0 && (!c.match || c.match.test(text)) : problems.length === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}`);
    if (!ok) {
      failed++;
      console.log(`     problems: ${text || '(none)'}`);
    }
  }

  // Regression on the real install: Prettier 3.10.1 bundles the TypeScript 6.0.3 parser.
  const prettier = join(here, '..', 'node_modules', '.pnpm', 'prettier@3.10.1');
  if (existsSync(prettier)) {
    const hit = scan([prettier]).find((h) => h.name === 'prettier');
    const ok =
      hit !== undefined &&
      hit.files.has('plugins/typescript.mjs') &&
      hit.versions.has('6.0') &&
      hit.versions.has('6.0.3');
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} detects TypeScript 6.0.3 in the installed prettier@3.10.1 (${hit ? [...hit.files].sort(byText).join(', ') : 'not detected'})`,
    );
    if (!ok) failed++;
  } else {
    console.log('FAIL prettier@3.10.1 regression: not installed (update this check if Prettier left the graph)');
    failed++;
  }
  rmSync(tmp, { recursive: true, force: true });
  if (failed > 0) process.exit(1);
}

const args = process.argv.slice(2);
if (args[0] === '--self-test') {
  selfTest();
} else if (args[0] === '--allowlist' && args.length >= 3) {
  run(args[1], args.slice(2));
} else {
  throw new Error(`usage: ${basename(process.argv[1])} --allowlist <file.json> <node_modules>... | --self-test`);
}
