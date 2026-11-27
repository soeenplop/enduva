// Negative tests (ADR-0001, ported from spikes/ts7-toolchain in 0.5): deliberately broken fixtures
// must FAIL with exactly the diagnostic they name. Apps and packages only add fixtures; the runner
// finds every workspace package with a `negative/` directory.
//
// - `<pkg>/negative/*.ts(x)`: each file starts with `// @expect TS<code> at <line>:<col>`. The runner
//   type-checks the package's normal sources plus that one fixture with the package's TS 7 `tsc` and
//   requires a non-zero exit and exactly one diagnostic: that code at that location.
// - `<pkg>/negative/lint/*.ts(x)`: each file starts with `// @expect-lint <rule> at <line>:<col>`.
//   The runner lints it with oxlint's type-aware mode (tsgolint) and the shared config
//   (`@enduva/config/oxlint.json`, its ignores removed) and requires exactly one diagnostic: that
//   rule in that file at that location. `negative/lint/tsconfig.json` makes the fixtures visible to
//   tsgolint.
// - No fixture at all fails too, so the check can't pass by finding nothing.
//
// Usage: node tools/negative-tests.mjs              (from the repo root)
//        node tools/negative-tests.mjs --self-test  (checks the runner's own verdict logic)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE = /\.tsx?$/;

function expectation(file, tag) {
  const match = readFileSync(file, 'utf8').match(new RegExp(`^// @${tag} (\\S+) at (\\d+):(\\d+)\\n`));
  if (!match) throw new Error(`${file}: missing "// @${tag} <code> at <line>:<col>" header`);
  return { code: match[1], line: Number(match[2]), column: Number(match[3]) };
}

const describe = ({ file, code, line, column }) => `${code} at ${file}:${line}:${column}`;

/** Exactly one diagnostic, the expected one, and a failing exit status. Returns a problem or null. */
export function verdict(label, status, actual, expected) {
  const want = describe(expected);
  if (status === 0) return `${label}: passed, expected ${want}`;
  if (actual.length === 1 && actual[0].raw === undefined && describe(actual[0]) === want) return null;
  const got = actual.map((d) => d.raw ?? describe(d));
  return `${label}: expected only ${want}, got:\n  ${got.join('\n  ') || '(no diagnostics)'}`;
}

/** `file(line,col): error TSxxxx: …`; any other `error TS` line (global errors) stays unparsed. */
export function tscDiagnostics(output) {
  return output
    .split('\n')
    .filter((l) => /error TS\d+/.test(l))
    .map((raw) => {
      const m = raw.match(/^(.+)\((\d+),(\d+)\): error (TS\d+):/);
      return m ? { file: m[1], line: Number(m[2]), column: Number(m[3]), code: m[4] } : { raw };
    });
}

function typeFixtures(pkg, rel, dir, results) {
  const bin = join(pkg, 'node_modules', '.bin', 'tsc');
  const base = JSON.parse(readFileSync(join(pkg, 'tsconfig.json'), 'utf8'));
  for (const name of readdirSync(dir).filter((f) => SOURCE.test(f))) {
    const label = `${rel}/negative/${name}`;
    if (!existsSync(bin)) throw new Error(`${label}: ${rel} has no TypeScript 7 tsc (devDependency missing)`);
    if (!Array.isArray(base.include)) throw new Error(`${rel}/tsconfig.json: needs an "include" list`);
    const expected = { file: `negative/${name}`, ...expectation(join(dir, name), 'expect') };
    const configPath = join(pkg, 'tsconfig.negative.json');
    writeFileSync(
      configPath,
      JSON.stringify({ extends: './tsconfig.json', include: [...base.include, expected.file] }),
    );
    try {
      const r = spawnSync(bin, ['-p', 'tsconfig.negative.json', '--pretty', 'false'], { cwd: pkg, encoding: 'utf8' });
      results.push([label, verdict(label, r.status, tscDiagnostics(`${r.stdout}${r.stderr}`), expected)]);
    } finally {
      rmSync(configPath);
    }
  }
}

function lintFixtures(pkg, rel, dir, results) {
  const bin = join(pkg, 'node_modules', '.bin', 'oxlint');
  const shared = join(pkg, 'node_modules', '@enduva', 'config', 'oxlint.json');
  const names = readdirSync(dir).filter((f) => SOURCE.test(f));
  if (names.length === 0) return;
  if (!existsSync(bin) || !existsSync(shared)) throw new Error(`${rel}: lint fixtures need oxlint and @enduva/config`);
  const { ignorePatterns: _ignored, ...config } = JSON.parse(readFileSync(shared, 'utf8'));
  const configPath = join(pkg, 'negative.oxlintrc.json');
  writeFileSync(configPath, JSON.stringify(config));
  try {
    for (const name of names) {
      const file = join('negative', 'lint', name);
      const label = `${rel}/${file}`;
      const expected = { file, ...expectation(join(dir, name), 'expect-lint') };
      const r = spawnSync(bin, ['--type-aware', '-c', 'negative.oxlintrc.json', '--format', 'json', file], {
        cwd: pkg,
        encoding: 'utf8',
      });
      let diagnostics;
      try {
        diagnostics = JSON.parse(r.stdout).diagnostics.map((d) => ({
          file: d.filename,
          code: d.code,
          line: d.labels?.[0]?.span.line,
          column: d.labels?.[0]?.span.column,
        }));
      } catch {
        diagnostics = [{ raw: `unparseable oxlint output: ${r.stdout}${r.stderr}` }];
      }
      results.push([label, verdict(label, r.status, diagnostics, expected)]);
    }
  } finally {
    rmSync(configPath);
  }
}

function run() {
  const root = process.cwd();
  const packages = JSON.parse(execFileSync('pnpm', ['-r', 'ls', '--json', '--depth', '-1'], { encoding: 'utf8' }));
  const results = [];
  for (const { path } of packages) {
    const dir = join(path, 'negative');
    if (path === root || !existsSync(dir)) continue;
    const rel = relative(root, path);
    typeFixtures(path, rel, dir, results);
    if (existsSync(join(dir, 'lint'))) lintFixtures(path, rel, join(dir, 'lint'), results);
  }
  const failures = results.filter(([, problem]) => problem !== null);
  for (const [label, problem] of results) if (!problem) console.log(`ok   ${label} fails as expected`);
  if (results.length === 0) failures.push(['', 'no negative fixtures found in any workspace package']);
  if (failures.length > 0) {
    console.error(
      `\n${failures.length} negative test(s) did not fail as expected:\n${failures.map((f) => f[1]).join('\n')}`,
    );
    process.exit(1);
  }
  console.log(`\nAll ${results.length} negative fixtures fail with exactly the expected diagnostic.`);
}

function selfTest() {
  const want = { file: 'negative/a.ts', code: 'TS2345', line: 5, column: 38 };
  const hit = { ...want };
  const cases = [
    ['accepts exactly the expected diagnostic', 2, [hit], false],
    ['rejects a fixture that passes', 0, [], true],
    ['rejects a fixture that passes despite reporting the diagnostic', 0, [hit], true],
    ['rejects no diagnostics', 2, [], true],
    ['rejects another code', 2, [{ ...hit, code: 'TS2322' }], true],
    ['rejects another location', 2, [{ ...hit, column: 39 }], true],
    ['rejects another file', 2, [{ ...hit, file: 'src/index.ts' }], true],
    ['rejects an extra diagnostic', 2, [hit, { ...hit, line: 6 }], true],
    ['rejects an unparsed global error', 2, [{ raw: 'error TS5083: Cannot read file' }], true],
  ];
  let failed = 0;
  for (const [name, status, actual, expectFail] of cases) {
    const ok = (verdict('fixture', status, actual, want) !== null) === expectFail;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  const parsed = tscDiagnostics(
    "negative/a.ts(5,38): error TS2345: Argument of type 'string' is not assignable.\nerror TS5083: Cannot read file\n",
  );
  const parsedOk = parsed.length === 2 && describe(parsed[0]) === describe(want) && parsed[1].raw !== undefined;
  if (!parsedOk) failed++;
  console.log(`${parsedOk ? 'ok  ' : 'FAIL'} parses located and global tsc errors`);
  if (failed > 0) process.exit(1);
}

if (process.argv[2] === '--self-test') selfTest();
else run();
