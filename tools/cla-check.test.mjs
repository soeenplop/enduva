// Unit tests for tools/cla-check.mjs against an in-memory GitHub API. The acceptance cases of roadmap
// row 0.5 are marked "acceptance:". Run: node --test cla-check.test.mjs (from tools/).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CONTEXT,
  IDS,
  createApi,
  isSignature,
  parseConfig,
  phrase,
  promptBody,
  readStore,
  run,
  sha256,
} from './cla-check.mjs';

const REPO = 'acme/enduva';
const N = 7;
const HEAD = 'a'.repeat(40);
const OWNER = { id: 82885605, login: 'soeenplop' };
const RENOVATE = { id: 29139614, login: 'renovate[bot]' };
const WEB_FLOW = { id: IDS.webFlow, login: 'web-flow' };
const ALICE = { id: 1001, login: 'alice' };
const BOB = { id: 1002, login: 'bob' };
const LINKS = {
  cla: `https://github.com/${REPO}/blob/${'b'.repeat(40)}/CLA.md`,
  contributing: 'https://example.invalid/contributing',
};
const EXEMPT = [OWNER, RENOVATE];
const TEXT_V1 = Buffer.from('# Enduva CLA\n\nVersion 1.0\n');
const TEXT_V2 = Buffer.from('# Enduva CLA\n\nVersion 2.0\n');
const V1 = parseConfig({ status: 'final', version: '1.0', sha256: sha256(TEXT_V1), exempt: EXEMPT }, TEXT_V1);
const V2 = parseConfig({ status: 'final', version: '2.0', sha256: sha256(TEXT_V2), exempt: EXEMPT }, TEXT_V2);
const DRAFT = parseConfig(
  { status: 'draft', version: null, sha256: null, exempt: EXEMPT },
  Buffer.from('DRAFT, not yet in force'),
);

const commit = (n, author, { committer = author, verified = true, sha } = {}) => ({
  sha: sha ?? (n === 0 ? HEAD : String(n).padStart(40, 'c')),
  author,
  committer,
  commit: { verification: { verified } },
});
let commentId = 100;
const comment = (user, body) => ({
  id: ++commentId,
  user,
  body,
  html_url: `https://github.com/${REPO}/pull/${N}#c${commentId}`,
  created_at: '2026-11-27T10:00:00Z',
});
const sign = (user, cla) => comment(user, phrase(cla));

/**
 * In-memory GitHub: open or closed PRs (by default one PR #N), their commits and comments, the
 * signature store; records every read and write. A PR's `heads` list replaces its head on each read.
 */
function fakeGitHub({ prs, records, ...single }) {
  const all = new Map(Object.entries(prs ?? { [N]: single }).map(([n, pr]) => [Number(n), pr]));
  const state = { all, store: records ? { records, sha: 'blob0' } : null, writes: [], reads: [], onWrite: null };
  for (const [n, pr] of all) {
    pr.number = n;
    pr.opener ??= OWNER;
    pr.comments ??= [];
    pr.head ??= HEAD;
    pr.state ??= 'open';
    pr.base ??= 'main';
  }
  state.comments = all.get(N)?.comments;
  state.commits = all.get(N)?.commits;
  const view = (pr) => ({
    number: pr.number,
    state: pr.state,
    user: pr.opener,
    head: { sha: pr.head },
    base: { ref: pr.base },
    commits: pr.prCommits ?? pr.commits.length,
  });
  const base = `/repos/${REPO}`;
  const api = {
    async request(method, path, body, allow = []) {
      if (method === 'GET') {
        state.reads.push(path);
        if (path === `${base}/git/ref/heads/cla-signatures`) {
          if (!state.store) return allow.includes(404) ? { status: 404, data: null } : assert.fail('404 not allowed');
          return { status: 200, data: { object: { sha: 'storecommit' } } };
        }
        if (path.startsWith(`${base}/contents/signatures.json?ref=`)) {
          const bytes = Buffer.from(JSON.stringify({ records: state.store.records }));
          return {
            status: 200,
            data: { encoding: 'base64', content: bytes.toString('base64'), size: bytes.length, sha: state.store.sha },
          };
        }
        const pull = path.match(/\/pulls\/(\d+)$/);
        if (pull) {
          const pr = all.get(Number(pull[1]));
          if (pr.heads?.length) pr.head = pr.heads.shift();
          return { status: 200, data: view(pr) };
        }
        const issue = path.match(/\/issues\/(\d+)$/);
        if (issue) {
          const pr = all.get(Number(issue[1]));
          return { status: 200, data: { comments: pr.issueComments ?? pr.comments.length } };
        }
        return assert.fail(`unexpected GET ${path}`);
      }
      state.writes.push({ method, path, body });
      state.onWrite?.({ method, path, body });
      if (path === `${base}/git/trees`) {
        state.tree = body.tree[0].content;
        return { status: 201, data: { sha: 'tree1' } };
      }
      if (path === `${base}/git/commits`) return { status: 201, data: { sha: 'commit1' } };
      if (path === `${base}/git/refs`) {
        state.store = { records: JSON.parse(state.tree).records, sha: 'blob1' };
        return { status: 201, data: {} };
      }
      if (path === `${base}/contents/signatures.json`) {
        assert.equal(body.sha, state.store.sha);
        state.store = {
          records: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')).records,
          sha: `${state.store.sha}+`,
        };
        return { status: 200, data: {} };
      }
      const post = path.match(/\/issues\/(\d+)\/comments$/);
      if (post) {
        all.get(Number(post[1])).comments.push({
          id: ++commentId,
          user: { id: IDS.actionsBot, login: 'github-actions[bot]' },
          body: body.body,
        });
        return { status: 201, data: {} };
      }
      if (path.startsWith(`${base}/issues/comments/`)) {
        const target = [...all.values()].flatMap((pr) => pr.comments).find((c) => path.endsWith(`/${c.id}`));
        target.body = body.body;
        return { status: 200, data: {} };
      }
      if (path.startsWith(`${base}/statuses/`)) return { status: 201, data: {} };
      return assert.fail(`unexpected ${method} ${path}`);
    },
    get: async (path) => (await api.request('GET', path)).data,
    async paginate(path) {
      state.reads.push(path);
      if (path === `${base}/pulls?state=open&base=main`)
        return [...all.values()]
          .filter((pr) => pr.state === 'open' && pr.base === 'main' && pr.listed !== false)
          .map(view);
      const list = path.match(/\/(pulls|issues)\/(\d+)\/(commits|comments)$/);
      if (list) return all.get(Number(list[2]))[list[3]];
      return assert.fail(`unexpected paginate ${path}`);
    },
  };
  return { api, state };
}

/** Runs the check for `numbers` and returns the last `cla` status posted to `sha` plus the verdicts. */
async function check(gh, cla, { numbers = [N], shas = [], sha = HEAD, current } = {}) {
  const verdicts = [];
  await run({
    api: gh.api,
    repo: REPO,
    numbers,
    shas,
    cla,
    links: LINKS,
    sleep: async () => {},
    report: (v) => verdicts.push(v),
    current,
  });
  const status = gh.state.writes.filter((w) => w.path === `/repos/${REPO}/statuses/${sha}`).at(-1);
  const verdict = verdicts.findLast((v) => v.head === sha);
  const result = verdict?.results.find((r) => r.number === numbers[0]) ?? verdict;
  return { ...status?.body, sha: status && sha, posted: Boolean(status), verdict, result };
}

const prompt = (gh, n = N) => gh.state.all.get(n).comments.find((c) => c.user.id === IDS.actionsBot)?.body;
const storeWrites = (gh) =>
  gh.state.writes.filter((w) => !w.path.includes('/statuses/') && !w.path.includes('/comments'));

describe('draft CLA (inert)', () => {
  test('owner-only PR passes as exempt', async () => {
    const gh = fakeGitHub({ commits: [commit(0, OWNER), commit(1, OWNER)] });
    const status = await check(gh, DRAFT);
    assert.equal(status.state, 'success');
    assert.equal(status.context, CONTEXT);
    assert.equal(status.sha, HEAD);
  });

  test('an external commit fails without collecting signatures or commenting', async () => {
    const gh = fakeGitHub({ opener: ALICE, commits: [commit(0, ALICE)], comments: [comment(ALICE, 'I agree')] });
    const status = await check(gh, DRAFT);
    assert.equal(status.state, 'failure');
    assert.match(status.description, /not yet in force/);
    assert.equal(status.target_url, LINKS.contributing);
    assert.deepEqual(gh.state.writes.length, 1, 'only the status is written');
    assert.ok(!gh.state.reads.some((p) => p.includes('signatures') || p.includes('comments')));
    assert.equal(prompt(gh), undefined);
  });
});

describe('final CLA', () => {
  test('acceptance: unsigned fork author is blocked, then turns green on the same head after signing', async () => {
    const gh = fakeGitHub({ opener: ALICE, commits: [commit(0, ALICE), commit(1, ALICE)] });
    const before = await check(gh, V1);
    assert.equal(before.state, 'failure');
    assert.match(prompt(gh), /@alice/);
    assert.ok(prompt(gh).includes(phrase(V1)));

    gh.state.comments.push(sign(ALICE, V1));
    const after = await check(gh, V1);
    assert.equal(after.state, 'success');
    assert.equal(after.sha, before.sha);
    assert.equal(after.sha, HEAD);
    const [record] = gh.state.store.records;
    assert.deepEqual(
      {
        id: record.github_id,
        version: record.version,
        sha256: record.sha256,
        url: record.cla_url,
        pr: record.pull_request,
      },
      { id: ALICE.id, version: '1.0', sha256: sha256(TEXT_V1), url: LINKS.cla, pr: N },
    );
    assert.match(prompt(gh), /have signed/);
  });

  test('a stored signature for the same version and hash is reused', async () => {
    const records = [{ github_id: ALICE.id, login: 'alice', version: '1.0', sha256: V1.sha256 }];
    const gh = fakeGitHub({ opener: ALICE, commits: [commit(0, ALICE)], records });
    assert.equal((await check(gh, V1)).state, 'success');
    assert.equal(storeWrites(gh).length, 0, 'nothing new to record');
  });

  test('acceptance: a CLA version change fails again until the new version is signed', async () => {
    const records = [{ github_id: ALICE.id, login: 'alice', version: '1.0', sha256: V1.sha256 }];
    const gh = fakeGitHub({ opener: ALICE, commits: [commit(0, ALICE)], records, comments: [sign(ALICE, V1)] });
    assert.equal((await check(gh, V2)).state, 'failure', 'old record and old phrase do not count for 2.0');
    gh.state.comments.push(sign(ALICE, V2));
    assert.equal((await check(gh, V2)).state, 'success');
    assert.deepEqual(
      gh.state.store.records.map((r) => r.version),
      ['1.0', '2.0'],
      'append-only',
    );
  });

  test('a record with the right version but another hash does not count', async () => {
    const records = [{ github_id: ALICE.id, login: 'alice', version: '1.0', sha256: 'f'.repeat(64) }];
    const gh = fakeGitHub({ opener: ALICE, commits: [commit(0, ALICE)], records });
    assert.equal((await check(gh, V1)).state, 'failure');
  });

  test('acceptance: an unlinked author fails, before stored signatures or exemptions are looked at', async () => {
    const gh = fakeGitHub({ opener: OWNER, commits: [commit(0, OWNER), commit(1, null)], records: [] });
    const status = await check(gh, V1);
    assert.equal(status.state, 'failure');
    assert.match(status.result.problems[0], /not linked/);
    assert.ok(!gh.state.reads.some((p) => p.includes('signatures')), 'store not read');
    assert.match(prompt(gh), /must be signed by their author/);
  });

  test('unverified or foreign-committed commits are not attributed (git identity is not trusted)', async () => {
    for (const bad of [commit(0, ALICE, { verified: false }), commit(0, ALICE, { committer: BOB })]) {
      const gh = fakeGitHub({ opener: ALICE, commits: [bad], records: [], comments: [sign(ALICE, V1)] });
      const status = await check(gh, V1);
      assert.equal(status.state, 'failure');
      assert.equal(gh.state.store.records.length, 0, 'the signing comment is not recorded either');
    }
  });

  test('a spoofed owner commit (unverified) is not exempt', async () => {
    const gh = fakeGitHub({ opener: OWNER, commits: [commit(0, OWNER, { verified: false })] });
    assert.equal((await check(gh, V1)).state, 'failure');
  });

  test('acceptance: an unsigned fork opener fails even if every commit author has signed', async () => {
    const gh = fakeGitHub({ opener: BOB, commits: [commit(0, ALICE)], comments: [sign(ALICE, V1)] });
    const status = await check(gh, V1);
    assert.equal(status.state, 'failure');
    assert.deepEqual(
      status.result.missing.map((a) => a.id),
      [BOB.id],
    );
  });

  test('an exempt opener does not exempt external commits', async () => {
    const gh = fakeGitHub({ opener: OWNER, commits: [commit(0, ALICE), commit(1, OWNER)] });
    const status = await check(gh, V1);
    assert.equal(status.state, 'failure');
    assert.deepEqual(
      status.result.missing.map((a) => a.id),
      [ALICE.id],
    );
  });

  test('assent counts only from the signing account itself', async () => {
    const gh = fakeGitHub({
      opener: ALICE,
      commits: [commit(0, ALICE), commit(1, BOB)],
      comments: [sign(ALICE, V1), comment(ALICE, phrase(V1))],
    });
    const status = await check(gh, V1);
    assert.equal(status.state, 'failure', 'Alice cannot sign for Bob');
    assert.deepEqual(
      status.result.missing.map((a) => a.id),
      [BOB.id],
    );
  });

  test('exempt bots match by account id per commit, not by login', async () => {
    const real = fakeGitHub({ opener: RENOVATE, commits: [commit(0, RENOVATE, { committer: WEB_FLOW })] });
    assert.equal((await check(real, V1)).state, 'success');
    const fake = { id: 4242, login: 'renovate[bot]' };
    const spoof = fakeGitHub({ opener: fake, commits: [commit(0, fake)] });
    assert.equal((await check(spoof, V1)).state, 'failure');
  });

  test('acceptance: an incomplete commit set fails closed', async () => {
    const cases = [
      fakeGitHub({ commits: [commit(0, OWNER)], prCommits: 2 }), // count mismatch (truncated)
      fakeGitHub({ commits: [commit(1, OWNER)] }), // head not in the set
      fakeGitHub({ commits: [commit(0, OWNER), commit(0, OWNER)] }), // duplicate pages
      fakeGitHub({ commits: [commit(0, OWNER)], prCommits: 251 }), // beyond the API's listing limit
    ];
    for (const gh of cases) {
      const status = await check(gh, V1);
      assert.equal(status.state, 'failure');
      assert.match(status.description, /^Failed closed/);
      assert.equal(status.sha, HEAD, 'the status goes to the evaluated head');
    }
  });

  test('acceptance: a head that moves during the check gets no verdict from the stale evaluation', async () => {
    const gh = fakeGitHub({ opener: ALICE, commits: [commit(0, ALICE)], heads: [HEAD, HEAD, 'd'.repeat(40)] });
    const status = await check(gh, DRAFT);
    assert.equal(status.posted, false, 'nothing is posted for the old head');
    assert.equal(status.verdict.state, 'none');
    // The push's own `synchronize` run evaluates the new head (and the old one again, via `before`).
  });

  test('an incomplete comment read fails closed', async () => {
    const gh = fakeGitHub({
      opener: ALICE,
      commits: [commit(0, ALICE)],
      comments: [sign(ALICE, V1)],
      issueComments: 2,
    });
    const status = await check(gh, V1);
    assert.equal(status.state, 'failure');
    assert.match(status.description, /PR comments/);
    assert.equal(gh.state.store, null, 'nothing recorded');
  });

  test('a missing store branch is created as an orphan with the first record', async () => {
    const gh = fakeGitHub({ opener: ALICE, commits: [commit(0, ALICE)], comments: [sign(ALICE, V1)] });
    assert.equal((await check(gh, V1)).state, 'success');
    const commitWrite = gh.state.writes.find((w) => w.path.endsWith('/git/commits'));
    assert.deepEqual(commitWrite.body.parents, []);
    assert.equal(gh.state.store.records[0].github_id, ALICE.id);
  });

  test('acceptance: the prompt links the immutable CLA text whose version and hash are recorded', async () => {
    const gh = fakeGitHub({ opener: ALICE, commits: [commit(0, ALICE)] });
    const status = await check(gh, V1);
    assert.equal(status.target_url, LINKS.cla);
    assert.match(LINKS.cla, /\/blob\/[0-9a-f]{40}\/CLA\.md$/);
    assert.ok(prompt(gh).includes(`(${LINKS.cla}) (sha256 \`${V1.sha256}\`)`));
    assert.ok(promptBody({ state: 'success' }, V1, LINKS.cla).includes(V1.sha256));
  });
});

describe('PRs sharing a head SHA (one shared `cla` status)', () => {
  const NEW = 'e'.repeat(40);
  // #7 by the exempt owner and #8 opened by Alice from a fork, both with the owner's commit as head.
  const sharedHead = (extra = {}) =>
    fakeGitHub({
      prs: {
        7: { opener: OWNER, commits: [commit(0, OWNER)] },
        8: { opener: ALICE, commits: [commit(0, OWNER)], ...extra },
      },
    });
  const statusWrites = (gh, sha = HEAD) =>
    gh.state.writes.filter((w) => w.path === `/repos/${REPO}/statuses/${sha}`).map((w) => w.body.state);

  test('acceptance: an exempt PR and an unsigned external PR with the same head fail, then signing turns both green', async () => {
    const gh = sharedHead();
    const fromExempt = await check(gh, V1, { numbers: [7] });
    assert.equal(fromExempt.state, 'failure', "the exempt PR's own pass must not count for #8");
    assert.match(fromExempt.description, /^#8: 1 account\(s\) must sign/);
    assert.deepEqual(
      fromExempt.verdict.results.map((r) => [r.number, r.state]),
      [
        [7, 'success'],
        [8, 'failure'],
      ],
    );
    assert.match(prompt(gh, 7), /shared by every open pull request with the same head commit.*#8/);
    assert.match(prompt(gh, 8), /@alice must sign/);
    assert.equal((await check(gh, V1, { numbers: [8] })).state, 'failure');

    gh.state.all.get(8).comments.push(sign(ALICE, V1));
    const signed = await check(gh, V1, { numbers: [8] });
    assert.equal(signed.state, 'success');
    assert.equal(signed.sha, HEAD);
    assert.match(signed.description, /\(all 2 PRs with this head\)$/);
    assert.match(prompt(gh, 7), /have signed/, "#7's prompt no longer points at #8");
    assert.equal((await check(gh, V1, { numbers: [7] })).state, 'success', 'and green from either PR');
  });

  test('acceptance: closing the unsigned external PR re-evaluates the PR left behind', async () => {
    const gh = sharedHead();
    assert.equal((await check(gh, V1, { numbers: [8] })).state, 'failure');
    gh.state.all.get(8).state = 'closed';
    const closed = await check(gh, V1, { numbers: [8] });
    assert.equal(closed.state, 'success');
    assert.deepEqual(
      closed.verdict.results.map((r) => r.number),
      [7],
    );
  });

  test('the same holds while the CLA is a draft: an external duplicate blocks until it is closed', async () => {
    const gh = sharedHead();
    const status = await check(gh, DRAFT, { numbers: [7] });
    assert.equal(status.state, 'failure');
    assert.match(status.description, /^#8: CLA not yet in force/);
    assert.equal(prompt(gh, 7), undefined, 'still no comments while draft');
    gh.state.all.get(8).state = 'closed';
    assert.equal((await check(gh, DRAFT, { numbers: [8] })).state, 'success');
  });

  test('retargeting a PR to or from main re-evaluates its head', async () => {
    const gh = sharedHead({ base: 'release' });
    assert.equal((await check(gh, V1, { numbers: [7] })).state, 'success', 'only PRs to main share the check');
    gh.state.all.get(8).base = 'main';
    assert.equal((await check(gh, V1, { numbers: [8] })).state, 'failure');
    gh.state.all.get(8).base = 'release';
    assert.equal((await check(gh, V1, { numbers: [8] })).state, 'success');
  });

  test('a push re-evaluates the previous head for the PRs still on it', async () => {
    const gh = sharedHead();
    assert.equal((await check(gh, V1, { numbers: [8] })).state, 'failure');
    Object.assign(gh.state.all.get(8), { head: NEW, commits: [commit(0, OWNER), commit(9, ALICE, { sha: NEW })] });
    const before = await check(gh, V1, { numbers: [8], shas: [HEAD] });
    assert.equal(before.state, 'success', '#7 alone on the old head');
    assert.equal((await check(gh, V1, { numbers: [8], shas: [HEAD], sha: NEW })).state, 'failure');
  });

  test('a PR that joins the head while the status is posted is evaluated before the check settles', async () => {
    const gh = sharedHead({ state: 'closed' });
    gh.state.onWrite = ({ path }) => {
      if (path.includes('/statuses/')) gh.state.all.get(8).state = 'open';
    };
    const status = await check(gh, V1, { numbers: [7] });
    assert.deepEqual(statusWrites(gh), ['success', 'failure'], 'the stale success is replaced');
    assert.equal(status.state, 'failure');
  });

  test('a PR the open list does not show yet fails closed instead of settling without it', async () => {
    const gh = sharedHead({ listed: false });
    const status = await check(gh, V1, { numbers: [8] });
    assert.equal(status.state, 'failure');
    assert.match(status.description, /does not show #8 yet/);
  });

  test('a verdict made with a CLA config that main no longer has is not posted, or replaced if already posted', async () => {
    const stale = fakeGitHub({ commits: [commit(0, OWNER)] });
    const skipped = await check(stale, V1, { current: async () => false });
    assert.equal(skipped.posted, false, 'the run for the CLA change on main owns the verdict');
    const late = fakeGitHub({ commits: [commit(0, OWNER)] });
    const answers = [true, false];
    const replaced = await check(late, V1, { current: async () => answers.shift() });
    assert.deepEqual(statusWrites(late), ['success', 'failure']);
    assert.match(replaced.description, /CLA changed on main/);
  });
});

describe('signature phrase', () => {
  test('only the exact, version- and hash-specific phrase counts', () => {
    const exact = phrase(V1);
    assert.ok(isSignature(exact, V1));
    assert.ok(isSignature(`  ${exact}\r\n`, V1));
    for (const body of [
      `> ${exact}`,
      `${exact} Thanks!`,
      `Sure. ${exact}`,
      exact.replace('1.0', '1.1'),
      exact.toLowerCase(),
      phrase(V2),
      null,
    ]) {
      assert.ok(!isSignature(body, V1), String(body));
    }
  });
});

describe('config', () => {
  test('final requires a numeric version and the exact hash of a non-draft CLA.md', () => {
    const good = { status: 'final', version: '1.0', sha256: sha256(TEXT_V1), exempt: [] };
    assert.equal(parseConfig(good, TEXT_V1).status, 'final');
    assert.throws(() => parseConfig(good, TEXT_V2), /does not match/);
    assert.throws(() => parseConfig({ ...good, version: '1.0-draft' }, TEXT_V1), /version/);
    const draftText = Buffer.from('DRAFT — not yet in force.');
    assert.throws(() => parseConfig({ ...good, sha256: sha256(draftText) }, draftText), /draft/);
    assert.throws(() => parseConfig({ ...good, status: 'active' }, TEXT_V1), /status/);
    assert.throws(() => parseConfig({ ...good, exempt: [{ login: 'soeenplop' }] }, TEXT_V1), /account id/);
  });

  test('the repository config is a valid draft that exempts the owner by id', async () => {
    const { readFileSync } = await import('node:fs');
    const config = parseConfig(
      JSON.parse(readFileSync(new URL('../.github/cla.json', import.meta.url), 'utf8')),
      readFileSync(new URL('../CLA.md', import.meta.url)),
    );
    assert.equal(config.status, 'draft');
    assert.equal(config.exempt.get(OWNER.id), 'soeenplop');
  });
});

describe('store and API client', () => {
  const response = (status, data, link = null) => ({
    status,
    text: async () => JSON.stringify(data),
    headers: { get: () => link },
  });

  test('pagination reads every page via Link headers', async () => {
    const pages = [
      response(
        200,
        [1, 2],
        '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=2>; rel="last"',
      ),
      response(200, [3]),
    ];
    const api = createApi({ token: 't', fetchImpl: async () => pages.shift() });
    assert.deepEqual(await api.paginate('/x'), [1, 2, 3]);
  });

  test('pagination fails closed on errors, foreign links and endless pages', async () => {
    const failing = createApi({ token: 't', fetchImpl: async () => response(502, { message: 'bad' }) });
    await assert.rejects(failing.paginate('/x'), /HTTP 502/);
    const foreign = createApi({
      token: 't',
      fetchImpl: async () => response(200, [1], '<https://evil.example/x?page=2>; rel="next"'),
    });
    await assert.rejects(foreign.paginate('/x'), /refusing/);
    const endless = createApi({
      token: 't',
      fetchImpl: async () => response(200, [1], '<https://api.github.com/x?page=n>; rel="next"'),
    });
    await assert.rejects(endless.paginate('/x'), /more than 50 pages/);
  });

  test('a truncated or malformed store fails closed', async () => {
    const storeApi = (file) => ({
      request: async (method, path) => ({
        status: 200,
        data: path.includes('/git/ref/') ? { object: { sha: 's' } } : file,
      }),
      get: async () => file,
    });
    await assert.rejects(readStore(storeApi({ encoding: 'none', content: '', size: 2_000_000 }), REPO), /completely/);
    const bad = Buffer.from('{"records":[{"login":"x"}]}');
    await assert.rejects(
      readStore(storeApi({ encoding: 'base64', content: bad.toString('base64'), size: bad.length }), REPO),
      /malformed/,
    );
  });
});
