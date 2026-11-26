// Negative tests for spike criteria 2, 4 and 5: deliberately broken fixtures must FAIL.
//
// - `<pkg>/negative/*.ts(x)`: each file starts with `// @expect TS<code> at <line>:<col>`. The script
//   type-checks the package's normal sources plus that one fixture with TS 7 `tsc` and asserts that
//   tsc exits non-zero and reports exactly one diagnostic: the expected code at that location.
// - `<pkg>/negative/lint/*.ts`: each file starts with `// @expect-lint <rule> at <line>:<col>`. The
//   script asserts that oxlint's type-aware run (tsgolint) reports exactly one diagnostic: that rule
//   in that file at that location.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const packages = ['api', 'contracts', 'web', 'landing'];
const bin = (name) => join(import.meta.dirname, '..', 'node_modules', '.bin', name);
const failures = [];
let checked = 0;

function expectation(file, tag) {
  const match = readFileSync(file, 'utf8').match(new RegExp(`^// @${tag} (\\S+) at (\\d+):(\\d+)\\n`));
  if (!match) throw new Error(`${file}: missing "// @${tag} <code> at <line>:<col>" header`);
  return { code: match[1], line: Number(match[2]), column: Number(match[3]) };
}

const describe = ({ file, code, line, column }) => `${code} at ${file}:${line}:${column}`;

// Exactly one diagnostic, and it is the expected one.
function check(label, status, actual, expected) {
  checked++;
  const want = describe(expected);
  const got = actual.map((d) => d.raw ?? describe(d));
  if (status === 0) failures.push(`${label}: passed, expected ${want}`);
  else if (actual.length !== 1 || describe(actual[0]) !== want) failures.push(`${label}: expected only ${want}, got:\n  ${got.join('\n  ') || '(no diagnostics)'}`);
  else console.log(`ok   ${label} fails with ${want}`);
}

for (const pkg of packages) {
  const dir = join(pkg, 'negative');
  if (!existsSync(dir)) continue;
  const base = JSON.parse(readFileSync(join(pkg, 'tsconfig.json'), 'utf8'));

  for (const name of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
    const expected = { file: `negative/${name}`, ...expectation(join(dir, name), 'expect') };
    const configPath = join(pkg, 'tsconfig.negative.json');
    const config = { extends: './tsconfig.json', include: [...base.include, `negative/${name}`] };
    writeFileSync(configPath, JSON.stringify(config));
    const result = spawnSync(bin('tsc'), ['-p', 'tsconfig.negative.json', '--pretty', 'false'], { cwd: pkg, encoding: 'utf8' });
    rmSync(configPath);

    // `file(line,col): error TSxxxx: …`; any other `error TS` line (global errors) counts as unexpected.
    const diagnostics = `${result.stdout}${result.stderr}`
      .split('\n')
      .filter((l) => /error TS\d+/.test(l))
      .map((raw) => {
        const m = raw.match(/^(.+)\((\d+),(\d+)\): error (TS\d+):/);
        return m ? { file: m[1], line: Number(m[2]), column: Number(m[3]), code: m[4], raw } : { raw };
      });
    check(`${pkg}/negative/${name}`, result.status, diagnostics, expected);
  }

  const lintDir = join(dir, 'lint');
  if (!existsSync(lintDir)) continue;
  // The repo config ignores negative/**, so lint the fixtures with the same rules minus the ignores.
  const { ignorePatterns: _ignored, ...lintConfig } = JSON.parse(readFileSync('.oxlintrc.json', 'utf8'));
  const lintConfigPath = 'negative.oxlintrc.json';
  writeFileSync(lintConfigPath, JSON.stringify(lintConfig));
  for (const name of readdirSync(lintDir).filter((f) => /\.tsx?$/.test(f))) {
    const file = join(lintDir, name);
    const expected = { file, ...expectation(file, 'expect-lint') };
    const result = spawnSync(bin('oxlint'), ['--type-aware', '-c', lintConfigPath, '--format', 'json', file], { encoding: 'utf8' });
    let diagnostics;
    try {
      diagnostics = JSON.parse(result.stdout).diagnostics.map((d) => ({
        file: d.filename,
        code: d.code,
        line: d.labels?.[0]?.span.line,
        column: d.labels?.[0]?.span.column,
      }));
    } catch {
      diagnostics = [{ raw: `unparseable oxlint output: ${result.stdout}${result.stderr}` }];
    }
    check(file, result.status, diagnostics, expected);
  }
  rmSync(lintConfigPath);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${checked} negative tests did not fail as expected:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`\nAll ${checked} negative fixtures fail with exactly the expected diagnostic.`);
