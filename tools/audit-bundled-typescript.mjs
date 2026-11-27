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
//        NOTICE, LICENSE).
//      The most precise of these is the detected version (`6.0.3` if a notice names it, else `6.0`).
//      No version, or two conflicting ones, fails: T1 requires the bundled version to be explicit.
//   5. Every file is attributed to the nearest enclosing package.json with a `name` and `version`,
//      and its SHA-256 digest is recorded per installed copy: pnpm can install one name and version
//      more than once (peer variants, bundled dependencies), and every copy is judged on its own.
//      Every installed directory of an allowlisted name and version is a copy too, even if no file
//      in it matches a signature (#100): a listed file that was deleted, or changed until it lost
//      its signature, must fail rather than drop the copy from the audit.
//   6. The consumers of each such package (the packages and workspace importers that depend on it
//      directly) are read from the installed dependency graph with `pnpm why <name> -r --json`, run
//      in the workspace that owns each scanned `node_modules`.
//
// Verdict
//   - The `typescript` package itself at >= 7 is the compiler we use and is not a bundled copy.
//     `typescript` < 7 always fails (it is never allowlistable; the lockfile audit catches it too).
//   - Every allowlist entry is validated first: all fields present and non-empty, no unknown fields,
//     an exact package version, a `X.Y` or `X.Y.Z` bundled version, a `sha256:<hex>` digest per
//     file, and a non-empty list of distinct consumers.
//   - Any other package that contains compiler code must have an entry with exactly this package
//     name and version, the detected bundled TypeScript version (string equality, so `6.0` and
//     `6.0.3` are different), and exactly the consumers found in the graph (`<name>@<version>`, or
//     `workspace:<name>` for an importer). In every installed copy each listed file must exist with
//     its listed digest (read directly, not via the signature scan), and no unlisted file may carry
//     compiler code.
//   - Allowlist entries that match no installed package fail as stale. So any change of an
//     allowlisted package's version, of the bytes of a file that carries the compiler, of the set of
//     such files, or of a consumer's name or version fails until the allowlist is updated on purpose.
//   - The audit cannot judge `usage` and `reason`; it only requires them. Whether a use still
//     qualifies as parsing/formatting is decided by the reviewer of the allowlist change.
//
// Limits (see ADR-0001)
//   - Only installed files are scanned: optional packages for other platforms are not present on
//     the runner. Run it after `pnpm install --frozen-lockfile` on the CI platform.
//   - Compiler code that is compressed, encoded (base64, wasm, zip) or downloaded at run time is
//     not visible, nor is a copy whose diagnostic keys were deliberately stripped or rewritten.
//     The signatures detect the TypeScript scanner/parser; a tool that ships only small helpers
//     copied from TypeScript (no diagnostic table) is not detected.
//   - Minified version detection is heuristic. Where only `X.Y` can be read, the entry records
//     `X.Y`, and the file digests pin the reviewed bytes.
//   - Consumers are the direct dependents in pnpm's graph. A package that is only reached through a
//     bundled `node_modules` (not in the lockfile) has no consumers there and therefore fails.
//
// Usage: node tools/audit-bundled-typescript.mjs --allowlist <file.json> <node_modules>...
//        node tools/audit-bundled-typescript.mjs --self-test
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
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function readManifest(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof pkg.name === 'string' && typeof pkg.version === 'string' ? pkg : null;
  } catch {
    return null;
  }
}

/**
 * Finds every installed package that contains TypeScript compiler code. `tracked` holds
 * `<name>@<version>` ids (the allowlisted ones) whose every installed directory becomes a copy,
 * with or without compiler code.
 */
export function scan(roots, tracked = new Set()) {
  // `${name}@${version}` -> { name, version, copies: [{ dir, files: Map<path, digest> }], versions: Set }
  const hits = new Map();
  const copies = new Map(); // package dir -> copy

  function copyOf(owner) {
    const key = `${owner.name}@${owner.version}`;
    let hit = hits.get(key);
    if (!hit) {
      hit = { name: owner.name, version: owner.version, copies: [], versions: new Set() };
      hits.set(key, hit);
    }
    let copy = copies.get(owner.dir);
    if (!copy) {
      copy = { dir: owner.dir, files: new Map() };
      copies.set(owner.dir, copy);
      hit.copies.push(copy);
    }
    return { hit, copy };
  }

  function walk(dir, owner) {
    const manifest = readManifest(dir);
    if (manifest) {
      owner = { name: manifest.name, version: manifest.version, dir };
      if (tracked.has(`${owner.name}@${owner.version}`)) copyOf(owner);
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, owner);
        continue;
      }
      if (!entry.isFile() || !owner || !isJavaScript(path, entry.name)) continue;
      const bytes = readFileSync(path);
      const text = bytes.toString('latin1');
      if (!SIGNATURES.some((s) => text.includes(s))) continue;
      const { hit, copy } = copyOf(owner);
      copy.files.set(relative(owner.dir, path).split('\\').join('/'), sha256(bytes));
      for (const v of versionsInCode(text)) hit.versions.add(v);
    }
  }
  for (const root of roots) {
    if (!existsSync(root)) throw new Error(`not found: ${root}`);
    walk(root, null);
  }
  for (const hit of hits.values())
    for (const copy of hit.copies) for (const v of versionsInNotices(copy.dir)) hit.versions.add(v);
  for (const hit of hits.values()) hit.copies.sort((a, b) => a.dir.localeCompare(b.dir));
  return [...hits.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

/** The `<name>@<version>` ids of the allowlist entries, for scan(). */
export const trackedIds = (allowlist) =>
  new Set(
    (Array.isArray(allowlist?.entries) ? allowlist.entries : [])
      .filter((e) => isObject(e) && typeof e.package === 'string' && typeof e.version === 'string')
      .map((e) => `${e.package}@${e.version}`),
  );

const byText = (a, b) => a.localeCompare(b);
const major = (v) => Number(v.split('.')[0]);
const nonBlank = (v) => typeof v === 'string' && v.trim() !== '';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const EXACT = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const BUNDLED = /^\d+\.\d+(?:\.\d+(?:-[\w.]+)?)?$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CONSUMER = /^(?:workspace:)?(?:@[^@\s/]+\/)?[^@\s/]+(?:@\d+\.\d+\.\d+(?:-[\w.]+)?)?$/;
const FIELDS = ['package', 'version', 'bundledTypeScript', 'files', 'consumers', 'usage', 'reason'];

/** The most precise detected version, if all detected versions agree (`6.0` is a prefix of `6.0.3`). */
export function detectedVersion(versions) {
  if (versions.length === 0) return { problem: 'no bundled TypeScript version could be read' };
  const best = versions.reduce((a, b) => (b.split('.').length > a.split('.').length ? b : a));
  if (versions.every((v) => v === best || best.startsWith(`${v}.`))) return { version: best };
  return { problem: `conflicting bundled TypeScript versions ${versions.join(', ')}` };
}

function validate(e, i) {
  if (!isObject(e)) return [`allowlist entry ${i}: must be an object`];
  const at = `allowlist entry ${i} (${nonBlank(e.package) ? e.package : '?'})`;
  const p = [];
  for (const k of Object.keys(e)) if (!FIELDS.includes(k)) p.push(`${at}: unknown field "${k}"`);
  for (const k of ['package', 'usage', 'reason'])
    if (!nonBlank(e[k])) p.push(`${at}: "${k}" must be a non-empty string`);
  if (typeof e.version !== 'string' || !EXACT.test(e.version)) p.push(`${at}: "version" must be an exact version`);
  if (typeof e.bundledTypeScript !== 'string' || !BUNDLED.test(e.bundledTypeScript)) {
    p.push(`${at}: "bundledTypeScript" must be the detected version, X.Y or X.Y.Z`);
  }
  if (!isObject(e.files) || Object.keys(e.files).length === 0) {
    p.push(`${at}: "files" must map each file to its sha256 digest`);
  } else {
    for (const [f, d] of Object.entries(e.files))
      if (!nonBlank(f) || typeof d !== 'string' || !DIGEST.test(d))
        p.push(`${at}: "files"."${f}" must be sha256:<64 hex>`);
      else if (f.startsWith('/') || f.split('/').includes('..'))
        p.push(`${at}: "files"."${f}" must be a path inside the package`);
  }
  const c = e.consumers;
  if (
    !Array.isArray(c) ||
    c.length === 0 ||
    !c.every((x) => nonBlank(x) && CONSUMER.test(x)) ||
    new Set(c).size !== c.length
  ) {
    p.push(`${at}: "consumers" must be a non-empty list of distinct "<name>@<version>" / "workspace:<name>"`);
  }
  return p;
}

const same = (a, b) => JSON.stringify([...a].sort(byText)) === JSON.stringify([...b].sort(byText));

/** `hits` from scan(), each with `consumers` (from consumersOf()) for packages other than `typescript`. */
export function judge(hits, allowlist) {
  const problems = [];
  const report = [];
  const entries = Array.isArray(allowlist?.entries) ? allowlist.entries : [];
  if (!Array.isArray(allowlist?.entries)) problems.push('allowlist: "entries" must be a list');
  for (const [i, e] of entries.entries()) problems.push(...validate(e, i));
  const ids = entries.map((e) => `${e?.package}@${e?.version}`);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i)))
    problems.push(`duplicate allowlist entry ${id}`);
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
    const files = [...new Set(hit.copies.flatMap((c) => [...c.files.keys()]))].sort(byText);
    const entry = entries.find((e) => isObject(e) && e.package === hit.name && e.version === hit.version);
    if (!entry) {
      problems.push(
        `${id}: bundles TypeScript compiler code (TypeScript ${shown}) in ${files.join(', ')} and is not allowlisted`,
      );
      continue;
    }
    used.add(entry);
    const before = problems.length;
    const detected = detectedVersion(versions);
    if (detected.problem) problems.push(`${id}: ${detected.problem}; T1 requires an explicit version, investigate`);
    else if (entry.bundledTypeScript !== detected.version) {
      problems.push(
        `${id}: detected bundled TypeScript ${detected.version}, allowlist says ${entry.bundledTypeScript}`,
      );
    }
    // Every installed copy must carry exactly the reviewed files and bytes (#100). The listed files
    // are read directly, so a deleted file, or one changed until it lost its signature, still fails.
    const listed = isObject(entry.files) ? entry.files : {};
    const listedFiles = Object.keys(listed).sort(byText);
    for (const copy of hit.copies) {
      const at = hit.copies.length > 1 ? `${id} (copy in ${copy.dir})` : id;
      for (const f of listedFiles) {
        if (f.startsWith('/') || f.split('/').includes('..')) continue; // reported by validate()
        const path = join(copy.dir, f);
        if (!existsSync(path) || !lstatSync(path).isFile()) {
          problems.push(`${at}: listed file ${f} is missing`);
          continue;
        }
        const digest = sha256(readFileSync(path));
        if (digest !== listed[f]) problems.push(`${at}: ${f} is ${digest}, allowlist says ${listed[f]}`);
      }
      const copyFiles = [...copy.files.keys()].sort(byText);
      if (copyFiles.some((f) => !Object.hasOwn(listed, f))) {
        problems.push(
          `${at}: compiler code found in [${copyFiles.join(', ')}], allowlist lists [${listedFiles.join(', ')}]`,
        );
      }
    }
    const consumers = [...(hit.consumers ?? [])].sort(byText);
    if (consumers.length === 0) problems.push(`${id}: no consumers found in the dependency graph`);
    else if (!Array.isArray(entry.consumers) || !same(entry.consumers, consumers)) {
      problems.push(
        `${id}: consumers are [${consumers.join(', ')}], allowlist says [${[entry.consumers].flat().join(', ')}]`,
      );
    }
    if (problems.length === before) {
      report.push(
        `ok   ${id}: TypeScript ${detected.version} in ${files.join(', ')} (digests match in ${hit.copies.length} installed ${hit.copies.length === 1 ? 'copy' : 'copies'}); consumers ${consumers.join(', ')}`,
      );
    }
  }
  for (const [i, e] of entries.entries())
    if (!used.has(e)) problems.push(`stale allowlist entry ${i} (${ids[i]}): no installed package matches`);
  return { problems, report };
}

/**
 * Adds `consumers` to every non-`typescript` hit: its direct dependents in the pnpm graph of each
 * workspace that owns one of the scanned `node_modules` (`<name>@<version>`, or `workspace:<name>`).
 */
export function consumersOf(hits, roots) {
  const names = [...new Set(hits.filter((h) => h.name !== 'typescript').map((h) => h.name))];
  const graph = new Map();
  for (const root of roots) {
    for (const name of names) {
      const out = execFileSync('pnpm', ['why', name, '-r', '--json'], { cwd: dirname(root), encoding: 'utf8' });
      for (const pkg of JSON.parse(out)) {
        const id = `${pkg.name}@${pkg.version}`;
        if (!graph.has(id)) graph.set(id, new Set());
        for (const d of pkg.dependents ?? [])
          graph.get(id).add(d.depField ? `workspace:${d.name}` : `${d.name}@${d.version}`);
      }
    }
  }
  for (const hit of hits)
    if (hit.name !== 'typescript') hit.consumers = graph.get(`${hit.name}@${hit.version}`) ?? new Set();
  return hits;
}

function run(allowlistPath, roots) {
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const { problems, report } = judge(consumersOf(scan(roots, trackedIds(allowlist)), roots), allowlist);
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
  const NOTICE_603 = 'text:## typescript@v6.0.3\n';
  const entry = {
    package: 'fake-formatter',
    version: '1.0.0',
    bundledTypeScript: '6.0.3',
    files: { 'dist/parser.js': sha256(readFileSync(join(FIXTURES, 'ts6-unminified.js'))) },
    consumers: ['some-tool@2.0.0'],
    usage: 'formatting',
    reason: 'self-test',
  };
  // The reviewed fake-formatter@1.0.0: TS 6 parser in dist/parser.js, notice names typescript@v6.0.3.
  const formatter = (r, files = {}, version = '1.0.0', storeKey = `fake-formatter@${version}`) =>
    fakePackage(r, storeKey, 'fake-formatter', version, {
      'dist/parser.js': 'ts6-unminified.js',
      'THIRD-PARTY-NOTICES.md': NOTICE_603,
      ...files,
    });
  const cases = [];
  const check = (name, expectFail, setup, allowlist = { entries: [] }, match, consumers = ['some-tool@2.0.0']) =>
    cases.push({ name, expectFail, setup, allowlist, match, consumers });

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
    'rejects typescript < 7 itself, even if allowlisted',
    true,
    (r) => {
      fakePackage(r, 'typescript@6.0.3', 'typescript', '6.0.3', { 'lib/typescript.js': 'ts6-unminified.js' });
    },
    { entries: [{ ...entry, package: 'typescript', version: '6.0.3' }] },
    /typescript@6\.0\.3: TypeScript < 7/,
  );
  check(
    'accepts an allowlisted copy (exact package, version, bundled TS, file digests, consumers)',
    false,
    (r) => formatter(r),
    { entries: [entry] },
  );
  check(
    'rejects an allowlisted package after a version change',
    true,
    (r) => formatter(r, {}, '1.0.1'),
    { entries: [entry] },
    /fake-formatter@1\.0\.1: .*not allowlisted[\s\S]*stale allowlist entry 0 \(fake-formatter@1\.0\.0\)/,
  );
  check(
    'rejects an allowlisted package whose bundled TypeScript minor changed',
    true,
    (r) =>
      formatter(r, {
        'dist/parser.js':
          'text:var versionMajorMinor = "5.9";\nvar E={a:d(1003,1,"Identifier_expected_1003","Identifier expected.")};',
        'THIRD-PARTY-NOTICES.md': 'text:none\n',
      }),
    { entries: [entry] },
    /detected bundled TypeScript 5\.9, allowlist says 6\.0\.3/,
  );
  check(
    'rejects a same-minor version mismatch (detected 6.0.3, allowlist 6.0.4)',
    true,
    (r) => formatter(r),
    { entries: [{ ...entry, bundledTypeScript: '6.0.4' }] },
    /detected bundled TypeScript 6\.0\.3, allowlist says 6\.0\.4/,
  );
  check(
    'rejects an entry that claims a patch the scan cannot read (detected 6.0, allowlist 6.0.3)',
    true,
    (r) => formatter(r, { 'THIRD-PARTY-NOTICES.md': 'text:none\n' }),
    { entries: [entry] },
    /detected bundled TypeScript 6\.0, allowlist says 6\.0\.3/,
  );
  check(
    'rejects a copy with an unreadable version, even if allowlisted',
    true,
    (r) => {
      fakePackage(r, 'opaque@1.0.0', 'opaque', '1.0.0', {
        'index.cjs': 'text:var x={a:d(1002,1,"Unterminated_string_literal_1002","Unterminated string literal.")};',
      });
    },
    {
      entries: [
        {
          ...entry,
          package: 'opaque',
          bundledTypeScript: 'unknown',
          files: { 'index.cjs': entry.files['dist/parser.js'] },
        },
      ],
    },
    /^(?=[\s\S]*opaque@1\.0\.0: no bundled TypeScript version could be read)(?=[\s\S]*"bundledTypeScript" must be)/,
  );
  check(
    'rejects conflicting bundled versions in one package',
    true,
    (r) => formatter(r, { 'THIRD-PARTY-NOTICES.md': 'text:typescript@v6.0.3 typescript@v6.0.4\n' }),
    { entries: [entry] },
    /conflicting bundled TypeScript versions 6\.0, 6\.0\.3, 6\.0\.4/,
  );
  check(
    'rejects a changed bundled file with the same package version, bundled version and name',
    true,
    (r) => {
      const dir = formatter(r);
      writeFileSync(
        join(dir, 'dist', 'parser.js'),
        `${readFileSync(join(dir, 'dist', 'parser.js'), 'utf8')}\n// patched\n`,
      );
    },
    { entries: [entry] },
    /fake-formatter@1\.0\.0: dist\/parser\.js is sha256:[0-9a-f]{64}, allowlist says sha256:/,
  );
  check(
    'rejects an allowlisted package that carries the compiler in a new file',
    true,
    (r) => formatter(r, { 'dist/extra.mjs': 'ts6-minified.js' }),
    { entries: [entry] },
    /compiler code found in \[dist\/extra\.mjs, dist\/parser\.js\]/,
  );
  // #100: two installed copies with the same name, version and file path (e.g. pnpm peer variants).
  // A patched copy must fail wherever it sits in the scan order, so both orders are tested.
  const patch = (dir) =>
    writeFileSync(
      join(dir, 'dist', 'parser.js'),
      `${readFileSync(join(dir, 'dist', 'parser.js'), 'utf8')}\n// patched\n`,
    );
  check(
    'accepts two identical installed copies of an allowlisted package',
    false,
    (r) => {
      formatter(r);
      formatter(r, {}, '1.0.0', 'fake-formatter@1.0.0_peer');
    },
    { entries: [entry] },
  );
  for (const [patched, storeKey] of [
    ['first', 'fake-formatter@1.0.0'],
    ['second', 'fake-formatter@1.0.0_peer'],
  ]) {
    check(
      `rejects a changed file in the ${patched} of two copies with the same name, version and path`,
      true,
      (r) => {
        formatter(r);
        formatter(r, {}, '1.0.0', 'fake-formatter@1.0.0_peer');
        patch(join(r, '.pnpm', storeKey, 'node_modules', 'fake-formatter'));
      },
      { entries: [entry] },
      new RegExp(
        `fake-formatter@1\\.0\\.0 \\(copy in [^)]*/\\.pnpm/${storeKey.replaceAll('.', '\\.')}/node_modules/fake-formatter\\): dist/parser\\.js is sha256:`,
      ),
    );
  }
  check(
    'rejects a second copy that carries the compiler in an extra file',
    true,
    (r) => {
      formatter(r);
      formatter(r, { 'dist/extra.mjs': 'ts6-minified.js' }, '1.0.0', 'fake-formatter@1.0.0_peer');
    },
    { entries: [entry] },
    /fake-formatter@1\.0\.0 \(copy in [^)]*_peer[^)]*\): compiler code found in \[dist\/extra\.mjs, dist\/parser\.js\]/,
  );
  // #100: a copy whose only listed file is gone, or no longer matches a signature, has no compiler
  // code left for the scan to find. It must still be judged, and fail, in either scan order.
  const strip = (dir) => writeFileSync(join(dir, 'dist', 'parser.js'), 'module.exports = {};\n');
  const remove = (dir) => rmSync(join(dir, 'dist', 'parser.js'));
  for (const [what, change, problem] of [
    ['is missing its only listed file', remove, 'listed file dist/parser\\.js is missing'],
    ['lost the signature in its only listed file', strip, 'dist/parser\\.js is sha256:[0-9a-f]{64}, allowlist says'],
  ]) {
    for (const [which, storeKey] of [
      ['first', 'fake-formatter@1.0.0'],
      ['second', 'fake-formatter@1.0.0_peer'],
    ]) {
      check(
        `rejects the ${which} of two copies if it ${what}`,
        true,
        (r) => {
          formatter(r);
          formatter(r, {}, '1.0.0', 'fake-formatter@1.0.0_peer');
          change(join(r, '.pnpm', storeKey, 'node_modules', 'fake-formatter'));
        },
        { entries: [entry] },
        new RegExp(
          `fake-formatter@1\\.0\\.0 \\(copy in [^)]*/\\.pnpm/${storeKey.replaceAll('.', '\\.')}/node_modules/fake-formatter\\): ${problem}`,
        ),
      );
    }
  }
  check(
    'rejects the only copy if it is missing its only listed file (not reported as stale)',
    true,
    (r) => remove(formatter(r)),
    { entries: [entry] },
    /^(?![\s\S]*stale)[\s\S]*fake-formatter@1\.0\.0: listed file dist\/parser\.js is missing/,
  );
  check(
    'rejects a listed path outside the package',
    true,
    (r) => formatter(r),
    { entries: [{ ...entry, files: { ...entry.files, '../other/parser.js': entry.files['dist/parser.js'] } }] },
    /"files"\."\.\.\/other\/parser\.js" must be a path inside the package/,
  );
  for (const change of [{ usage: '' }, { reason: null }, { usage: '   ' }, { consumers: [] }, { files: {} }]) {
    const field = Object.keys(change)[0];
    check(
      `rejects an entry with ${JSON.stringify(change)}`,
      true,
      (r) => formatter(r),
      { entries: [{ ...entry, ...change }] },
      new RegExp(`"${field}" must`),
    );
  }
  check(
    'rejects an entry without a "reason" field',
    true,
    (r) => formatter(r),
    { entries: [{ ...entry, reason: undefined }] },
    /"reason" must be a non-empty string/,
  );
  check(
    'rejects an entry with an unknown field',
    true,
    (r) => formatter(r),
    { entries: [{ ...entry, usedBy: 'old field' }] },
    /unknown field "usedBy"/,
  );
  check(
    'rejects a changed consumer version',
    true,
    (r) => formatter(r),
    { entries: [entry] },
    /consumers are \[some-tool@2\.1\.0\], allowlist says \[some-tool@2\.0\.0\]/,
    ['some-tool@2.1.0'],
  );
  check(
    'rejects a new consumer',
    true,
    (r) => formatter(r),
    { entries: [entry] },
    /consumers are \[other-tool@1\.0\.0, some-tool@2\.0\.0\]/,
    ['some-tool@2.0.0', 'other-tool@1.0.0'],
  );
  check(
    'rejects a package whose consumers disappeared from the graph',
    true,
    (r) => formatter(r),
    { entries: [entry] },
    /no consumers found in the dependency graph/,
    [],
  );
  check('accepts the typescript 7 package and packages without compiler code', false, (r) => {
    fakePackage(r, 'typescript@7.0.2', 'typescript', '7.0.2', {
      'lib/version.cjs': 'text:exports.versionMajorMinor = "7.0";\n',
    });
    fakePackage(r, 'left-pad@1.3.0', 'left-pad', '1.3.0', { 'index.js': 'text:module.exports = (s) => s;\n' });
  });

  let failed = 0;
  const report = (ok, name, detail) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) {
      failed++;
      if (detail) console.log(`     ${detail}`);
    }
  };
  for (const [i, c] of cases.entries()) {
    const root = join(tmp, String(i), 'node_modules');
    mkdirSync(root, { recursive: true });
    c.setup(root);
    const hits = scan([root], trackedIds(c.allowlist));
    for (const h of hits) h.consumers = new Set(c.consumers);
    const { problems } = judge(hits, c.allowlist);
    const text = problems.join('\n');
    const ok = c.expectFail ? problems.length > 0 && (!c.match || c.match.test(text)) : problems.length === 0;
    report(ok, c.name, `problems: ${text || '(none)'}`);
  }
  rmSync(tmp, { recursive: true, force: true });

  // Regressions on the real root install and the real allowlist (review findings on PR #97).
  // The root workspace has no TanStack, so oxfmt is the only allowlisted package here.
  const roots = [join(here, '..', 'node_modules')];
  const allowlist = JSON.parse(readFileSync(join(here, 'ts-bundled-allowlist.json'), 'utf8'));
  const listed = allowlist.entries.find((e) => e.package === 'oxfmt');
  if (!listed || !existsSync(join(roots[0], '.pnpm', `oxfmt@${listed.version}`))) {
    report(false, 'oxfmt regression: no allowlisted oxfmt installed (update these checks if oxfmt left the graph)');
    process.exit(1);
  }
  const hits = consumersOf(scan(roots, trackedIds(allowlist)), roots);
  const oxfmt = hits.find((h) => h.name === 'oxfmt' && h.version === listed.version);
  report(
    oxfmt !== undefined &&
      detectedVersion([...oxfmt.versions]).version === '6.0' &&
      oxfmt.consumers.has('workspace:enduva'),
    `reads only TypeScript 6.0 and the root consumer from the installed oxfmt@${listed.version} (so its entry records 6.0 plus digests)`,
  );
  const mutate = (pkg, change) => ({
    entries: allowlist.entries.map((e) => (e.package === pkg ? { ...e, ...change } : e)),
  });
  const realFails = (name, list, re) => {
    const text = judge(hits, list).problems.join('\n');
    report(re.test(text), name, `problems: ${text || '(none)'}`);
  };
  realFails(
    'real oxfmt entry with 6.0.3 fails',
    mutate('oxfmt', { bundledTypeScript: '6.0.3' }),
    /oxfmt@.*allowlist says 6\.0\.3/,
  );
  realFails(
    'real oxfmt entry with 6.0.4 fails',
    mutate('oxfmt', { bundledTypeScript: '6.0.4' }),
    /oxfmt@.*allowlist says 6\.0\.4/,
  );
  realFails(
    'real oxfmt entry with another consumer fails',
    mutate('oxfmt', { consumers: ['workspace:ts7-toolchain-spike'] }),
    /oxfmt@.*: consumers are \[workspace:enduva\]/,
  );
  realFails(
    'real oxfmt entry with null usage and reason fails',
    mutate('oxfmt', { usage: null, reason: null }),
    /"usage" must[\s\S]*"reason" must/,
  );
  realFails(
    'real allowlist with a stale entry for a package that is not installed fails',
    { entries: [...allowlist.entries, { ...listed, package: 'not-installed-formatter', version: '1.0.0' }] },
    new RegExp(`stale allowlist entry ${allowlist.entries.length} \\(not-installed-formatter@1\\.0\\.0\\)`),
  );
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
