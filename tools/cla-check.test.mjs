// Unit tests for tools/cla-check.mjs against an in-memory GitHub API. The acceptance cases of roadmap
// row 0.5 are marked "acceptance:". Run: node --test cla-check.test.mjs (from tools/).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  CAPPED,
  CONTEXT,
  IDS,
  MAX_STATUSES,
  PROTECTED,
  SIGNING_PREFIX,
  clientFrom,
  createApi,
  isSignature,
  mainPolicy,
  parseConfig,
  phrase,
  plan,
  promptBody,
  readStore,
  settle,
  sha256,
  signedByApprover,
} from './cla-check.mjs';

const REPO = 'acme/enduva';
const N = 7;
const HEAD = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const OTHER = 'd'.repeat(40);
const NEW = 'e'.repeat(40);
const OWNER = { id: 82885605, login: 'soeenplop' };
const RENOVATE = { id: 29139614, login: 'renovate[bot]' };
const WEB_FLOW = { id: IDS.webFlow, login: 'web-flow' };
const ALICE = { id: 1001, login: 'alice' };
const BOB = { id: 1002, login: 'bob' };
const EXEMPT = [OWNER, RENOVATE];

const TEXT_V1 = '# Enduva CLA\n\nVersion 1.0\n';
const TEXT_V2 = '# Enduva CLA\n\nVersion 2.0\n';
const V1 = { version: '1.0', sha256: sha256(TEXT_V1) };
const V2 = { version: '2.0', sha256: sha256(TEXT_V2) };
/** The policy files of one commit on main. */
const files = (config, text, approvers = null) => ({
  'CLA.md': Buffer.from(text),
  '.github/cla.json': Buffer.from(typeof config === 'string' ? config : JSON.stringify(config)),
  '.github/cla-approvers': approvers === null ? null : Buffer.from(approvers),
});
const finalFiles = (cla, text, approvers) =>
  files({ status: 'final', version: cla.version, sha256: cla.sha256, exempt: EXEMPT }, text, approvers);
const V1_FILES = finalFiles(V1, TEXT_V1);
const V2_FILES = finalFiles(V2, TEXT_V2);
const DRAFT_FILES = files({ status: 'draft', version: null, sha256: null, exempt: EXEMPT }, 'DRAFT, not yet in force');

const commit = (n, author, { committer = author, verified = true, sha, signature, payload } = {}) => ({
  sha: sha ?? (n === 0 ? HEAD : String(n).padStart(40, 'c')),
  author,
  committer,
  commit: { verification: { verified, signature, payload } },
});
let nextId = 100;
const comment = (user, body, { edited = false } = {}) => {
  const id = ++nextId;
  return {
    id,
    user,
    body,
    html_url: `https://github.com/${REPO}/pull/${N}#c${id}`,
    created_at: '2026-11-27T10:00:00Z',
    updated_at: edited ? '2026-11-27T11:00:00Z' : '2026-11-27T10:00:00Z',
  };
};
const sign = (user, cla) => comment(user, phrase(cla));
const record = (user, cla, c) => ({
  github_id: user.id,
  login: user.login,
  version: cla.version,
  sha256: cla.sha256,
  comment_id: c.id,
});
let refs = 0;

/**
 * In-memory GitHub: PRs (by default one PR #N), their commits and comments, the policy files of main,
 * the signature store and the commit statuses; records every read and write. Comparisons are recorded
 * per base...head pair when a PR is read, so they are immutable like the real ones. `onRead`/`onWrite`
 * hooks interleave other events; `race` makes the next store writes lose against another writer.
 */
function fakeGitHub({ prs, records, policy = DRAFT_FILES, ...single } = {}) {
  const all = new Map(Object.entries(prs ?? { [N]: single }).map(([n, pr]) => [Number(n), pr]));
  for (const [n, pr] of all) {
    pr.number = n;
    pr.opener ??= OWNER;
    pr.comments ??= [];
    pr.head ??= HEAD;
    pr.state ??= 'open';
    pr.base ??= 'main';
    pr.baseSha ??= BASE_SHA;
    pr.files ??= [{ filename: 'src/app.ts' }];
  }
  const state = {
    all,
    store: records ? { records, sha: 'blob0' } : null,
    writes: [],
    reads: [],
    statuses: new Map(),
    policies: new Map(),
    ref: null,
    compare: new Map(),
    others: [],
    pageSize: 100,
    race: { refs: 0, put: 0, record: null },
    onRead: null,
    onWrite: null,
    fail: null,
  };
  const view = (pr) => {
    state.compare.set(`${pr.baseSha}...${pr.head}`, {
      commits: pr.commits,
      files: pr.files,
      total: pr.commits.length,
      totals: pr.compareTotals,
    });
    return {
      number: pr.number,
      state: pr.state,
      user: pr.opener,
      head: { sha: pr.head },
      base: { ref: pr.base, sha: pr.baseSha },
      commits: pr.prCommits ?? pr.commits.length,
    };
  };
  const base = `/repos/${REPO}`;
  const file = (bytes, sha) => ({ encoding: 'base64', content: bytes.toString('base64'), size: bytes.length, sha });
  const allComments = () => [...[...all.values()].flatMap((pr) => pr.comments), ...state.others];

  async function request(method, raw, body, allow = []) {
    const url = new URL(raw, 'https://api.github.com');
    const page = Number(url.searchParams.get('page') ?? 1);
    url.searchParams.delete('per_page');
    url.searchParams.delete('page');
    const path = `${url.pathname}${url.search}`;
    const reply = (status, data, link = null) => {
      if (status >= 400 && !allow.includes(status))
        throw new Error(`GitHub API ${method} ${url.pathname}: HTTP ${status}`);
      return { status, data, link };
    };
    let m;
    if (method === 'GET') {
      state.reads.push(path);
      await state.onRead?.(path);
      if (path === `${base}/git/ref/heads/main`) return reply(200, { object: { sha: state.ref } });
      if (path === `${base}/git/ref/heads/cla-signatures`) {
        return state.store ? reply(200, { object: { sha: 'storecommit' } }) : reply(404, null);
      }
      if (path === `${base}/contents/signatures.json?ref=storecommit`) {
        return reply(200, file(Buffer.from(JSON.stringify({ records: state.store.records })), state.store.sha));
      }
      if ((m = path.match(/\/contents\/(.+)\?ref=(\w+)$/))) {
        const bytes = state.policies.get(m[2])?.[m[1]];
        return bytes ? reply(200, file(bytes, 'x')) : reply(404, null);
      }
      if (path === `${base}/pulls?state=open&base=main`) {
        return reply(
          200,
          [...all.values()].filter((pr) => pr.state === 'open' && pr.base === 'main' && pr.listed !== false).map(view),
        );
      }
      if ((m = path.match(/\/pulls\/(\d+)$/))) {
        const pr = all.get(Number(m[1]));
        if (!pr) return reply(404, null);
        if (pr.heads?.length) pr.head = pr.heads.shift();
        return reply(200, view(pr));
      }
      if ((m = path.match(/\/compare\/(\w+)\.\.\.(\w+)$/))) {
        const entry = state.compare.get(`${m[1]}...${m[2]}`);
        if (!entry) return reply(404, null);
        const size = state.pageSize;
        const last = Math.max(1, Math.ceil(entry.commits.length / size));
        const link =
          page < last ? `<https://api.github.com${url.pathname}?per_page=${size}&page=${page + 1}>; rel="next"` : null;
        const totals = entry.totals ?? [];
        return reply(
          200,
          {
            total_commits: totals[page - 1] ?? entry.total,
            commits: entry.commits.slice((page - 1) * size, page * size),
            files: page === 1 ? entry.files : [],
          },
          link,
        );
      }
      if ((m = path.match(/\/issues\/(\d+)$/))) {
        const pr = all.get(Number(m[1]));
        return reply(200, { comments: pr.issueComments ?? pr.comments.length });
      }
      if ((m = path.match(/\/issues\/(\d+)\/comments$/))) return reply(200, all.get(Number(m[1])).comments);
      if ((m = path.match(/\/issues\/comments\/(\d+)$/))) {
        const found = allComments().find((c) => c.id === Number(m[1]));
        return found ? reply(200, found) : reply(404, null);
      }
      if ((m = path.match(/\/commits\/(\w+)\/statuses$/))) return reply(200, state.statuses.get(m[1]) ?? []);
      return assert.fail(`unexpected GET ${path}`);
    }
    state.writes.push({ method, path, body });
    const failure = state.fail?.({ method, path, body });
    if (failure) throw failure;
    const hook = state.onWrite;
    await hook?.({ method, path, body });
    if ((m = path.match(/\/statuses\/(\w+)$/))) {
      const list = state.statuses.get(m[1]) ?? [];
      list.unshift({ ...body, target_url: body.target_url ?? null, creator: { id: IDS.actionsBot } });
      state.statuses.set(m[1], list);
      return reply(201, {});
    }
    if (path === `${base}/git/trees`) {
      state.tree = body.tree[0].content;
      return reply(201, { sha: 'tree1' });
    }
    if (path === `${base}/git/commits`) return reply(201, { sha: 'commit1' });
    if (path === `${base}/git/refs`) {
      if (state.race.refs > 0) {
        state.race.refs--;
        state.store = { records: [state.race.record], sha: 'blobR' };
        return reply(422, {}); // the other run created the branch first
      }
      if (state.store) return reply(422, {});
      state.store = { records: JSON.parse(state.tree).records, sha: 'blob1' };
      return reply(201, {});
    }
    if (path === `${base}/contents/signatures.json`) {
      if (state.race.put > 0) {
        state.race.put--;
        state.store = { records: [...state.store.records, state.race.record], sha: `${state.store.sha}*` };
      }
      if (body.sha !== state.store.sha) return reply(409, {});
      state.store = {
        records: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')).records,
        sha: `${state.store.sha}+`,
      };
      return reply(200, {});
    }
    if ((m = path.match(/\/issues\/(\d+)\/comments$/))) {
      all.get(Number(m[1])).comments.push({
        id: ++nextId,
        user: { id: IDS.actionsBot, login: 'github-actions[bot]' },
        body: body.body,
      });
      return reply(201, {});
    }
    if ((m = path.match(/\/issues\/comments\/(\d+)$/))) {
      allComments().find((c) => c.id === Number(m[1])).body = body.body;
      return reply(200, {});
    }
    return assert.fail(`unexpected ${method} ${path}`);
  }
  const gh = {
    state,
    api: clientFrom(request),
    /** A new commit on main with these policy files. */
    setPolicy(policyFiles) {
      const ref = (++refs).toString(16).padStart(40, '0');
      state.policies.set(ref, policyFiles);
      state.ref = ref;
    },
    pr: (n = N) => all.get(n),
    statuses: (sha = HEAD) => [...(state.statuses.get(sha) ?? [])].reverse(),
    latest: (sha = HEAD) => state.statuses.get(sha)?.[0],
  };
  gh.setPolicy(policy);
  return gh;
}

/** Settles one head with the policy on main; returns the latest status on it and the verdict. */
async function settleHead(gh, sha = HEAD, n = N) {
  const verdicts = [];
  await settle({
    api: gh.api,
    repo: REPO,
    sha,
    source: mainPolicy(gh.api, REPO),
    sleep: async () => {},
    report: (v) => verdicts.push(v),
  });
  const verdict = verdicts.at(-1);
  return { ...gh.latest(sha), verdict, result: verdict?.results.find((r) => r.number === n) };
}

const planFor = (gh, eventName, event) =>
  plan({ api: gh.api, repo: REPO, eventName, event, source: mainPolicy(gh.api, REPO) });

/** One workflow run: plan, then settle every head it returns (the matrix). */
async function fire(gh, eventName, event = {}) {
  const planned = await planFor(gh, eventName, event);
  for (const sha of planned.heads) await settleHead(gh, sha);
  return planned;
}
const prEvent = (gh, n, action, extra = {}) => ({
  action,
  pull_request: { number: n, state: gh.pr(n).state, head: { sha: gh.pr(n).head }, base: { ref: gh.pr(n).base } },
  ...extra,
});
const commentEvent = (n, c) => ({ action: 'created', issue: { number: n, pull_request: {} }, comment: c });

const prompt = (gh, n = N) => gh.pr(n).comments.find((c) => c.user.id === IDS.actionsBot)?.body;
const storeWrites = (gh) =>
  gh.state.writes.filter((w) => !w.path.includes('/statuses/') && !w.path.includes('/comments'));
const statusWrites = (gh, sha = HEAD) => gh.state.writes.filter((w) => w.path.endsWith(`/statuses/${sha}`));
const states = (gh, sha = HEAD) => gh.statuses(sha).map((s) => s.state);

describe('draft CLA (inert)', () => {
  test('owner-only PR passes as exempt, and the status names the PR and the policy', async () => {
    const gh = fakeGitHub({ commits: [commit(0, OWNER), commit(1, OWNER)] });
    const status = await settleHead(gh);
    assert.equal(status.state, 'success');
    assert.equal(status.context, CONTEXT);
    assert.match(status.description, /^Only exempt accounts \(CLA not yet in force\): #7 \[[0-9a-f]{10}\]$/);
  });

  test('an external commit fails without collecting signatures or commenting', async () => {
    const gh = fakeGitHub({ opener: ALICE, commits: [commit(0, ALICE)], comments: [comment(ALICE, 'I agree')] });
    const status = await settleHead(gh);
    assert.equal(status.state, 'failure');
    assert.match(status.description, /not yet in force/);
    assert.match(status.target_url, /CONTRIBUTING\.md/);
    assert.equal(gh.state.writes.length, 1, 'only the status is written');
    assert.ok(!gh.state.reads.some((p) => p.includes('signatures') || p.includes('/comments')));
    assert.equal(prompt(gh), undefined);
  });
});

describe('final CLA', () => {
  test('acceptance: unsigned fork author is blocked, then turns green on the same head after signing', async () => {
    const gh = fakeGitHub({ policy: V1_FILES, opener: ALICE, commits: [commit(0, ALICE), commit(1, ALICE)] });
    assert.equal((await settleHead(gh)).state, 'failure');
    assert.match(prompt(gh), /@alice/);
    assert.ok(prompt(gh).includes(phrase(V1)));

    const signature = sign(ALICE, V1);
    gh.pr().comments.push(signature);
    const run = await fire(gh, 'issue_comment', commentEvent(N, signature));
    assert.deepEqual(run.heads, [HEAD]);
    assert.equal(gh.latest().state, 'success');
    const [stored] = gh.state.store.records;
    assert.deepEqual(
      [stored.github_id, stored.version, stored.sha256, stored.pull_request, stored.comment_id],
      [ALICE.id, '1.0', V1.sha256, N, signature.id],
    );
    assert.match(stored.cla_url, new RegExp(`/blob/${gh.state.ref}/CLA\\.md$`));
    assert.match(prompt(gh), /have signed/);
  });

  test('a stored signature is reused while its comment is still an unedited signing comment by that account', async () => {
    const elsewhere = sign(ALICE, V1);
    const gh = fakeGitHub({
      policy: V1_FILES,
      opener: ALICE,
      commits: [commit(0, ALICE)],
      records: [record(ALICE, V1, elsewhere)],
    });
    gh.state.others.push(elsewhere);
    assert.equal((await settleHead(gh)).state, 'success');
    assert.equal(storeWrites(gh).length, 0, 'nothing new to record');
  });

  test('acceptance: a CLA version change fails again until the new version is signed', async () => {
    const gh = fakeGitHub({
      policy: V1_FILES,
      opener: ALICE,
      commits: [commit(0, ALICE)],
      comments: [sign(ALICE, V1)],
    });
    assert.equal((await settleHead(gh)).state, 'success');
    gh.setPolicy(V2_FILES);
    await fire(gh, 'push');
    assert.equal(gh.latest().state, 'failure', 'the old record and the old phrase do not count for 2.0');
    const signature = sign(ALICE, V2);
    gh.pr().comments.push(signature);
    await fire(gh, 'issue_comment', commentEvent(N, signature));
    assert.equal(gh.latest().state, 'success');
    assert.deepEqual(
      gh.state.store.records.map((r) => r.version),
      ['1.0', '2.0'],
      'append-only',
    );
  });

  test('a record with the right version but another hash does not count', async () => {
    const c = sign(ALICE, V1);
    const gh = fakeGitHub({
      policy: V1_FILES,
      opener: ALICE,
      commits: [commit(0, ALICE)],
      records: [{ ...record(ALICE, V1, c), sha256: 'f'.repeat(64) }],
    });
    gh.state.others.push(c);
    assert.equal((await settleHead(gh)).state, 'failure');
  });

  test('acceptance: an unlinked author fails, before stored signatures or exemptions are looked at', async () => {
    const gh = fakeGitHub({
      policy: V1_FILES,
      opener: OWNER,
      commits: [commit(0, OWNER), commit(1, null)],
      records: [],
    });
    const status = await settleHead(gh);
    assert.equal(status.state, 'failure');
    assert.match(status.result.problems[0], /not linked/);
    assert.ok(!gh.state.reads.some((p) => p.includes('signatures')), 'store not read');
    assert.match(prompt(gh), /must be signed by their author/);
  });

  test('unverified or foreign-committed commits are not attributed (git identity is not trusted)', async () => {
    for (const bad of [commit(0, ALICE, { verified: false }), commit(0, ALICE, { committer: BOB })]) {
      const gh = fakeGitHub({
        policy: V1_FILES,
        opener: ALICE,
        commits: [bad],
        records: [],
        comments: [sign(ALICE, V1)],
      });
      assert.equal((await settleHead(gh)).state, 'failure');
      assert.equal(gh.state.store.records.length, 0, 'the signing comment is not recorded either');
    }
  });

  test('a spoofed owner commit (unverified) is not exempt', async () => {
    const gh = fakeGitHub({ policy: V1_FILES, commits: [commit(0, OWNER, { verified: false })] });
    assert.equal((await settleHead(gh)).state, 'failure');
  });

  test('acceptance: an unsigned fork opener fails even if every commit author has signed', async () => {
    const gh = fakeGitHub({ policy: V1_FILES, opener: BOB, commits: [commit(0, ALICE)], comments: [sign(ALICE, V1)] });
    const status = await settleHead(gh);
    assert.equal(status.state, 'failure');
    assert.deepEqual(
      status.result.missing.map((a) => a.id),
      [BOB.id],
    );
  });

  test('an exempt opener does not exempt external commits', async () => {
    const gh = fakeGitHub({ policy: V1_FILES, opener: OWNER, commits: [commit(0, ALICE), commit(1, OWNER)] });
    const status = await settleHead(gh);
    assert.equal(status.state, 'failure');
    assert.deepEqual(
      status.result.missing.map((a) => a.id),
      [ALICE.id],
    );
  });

  test('assent counts only from the signing account itself', async () => {
    const gh = fakeGitHub({
      policy: V1_FILES,
      opener: ALICE,
      commits: [commit(0, ALICE), commit(1, BOB)],
      comments: [sign(ALICE, V1), comment(ALICE, phrase(V1))],
    });
    const status = await settleHead(gh);
    assert.equal(status.state, 'failure', 'Alice cannot sign for Bob');
    assert.deepEqual(
      status.result.missing.map((a) => a.id),
      [BOB.id],
    );
  });

  test('exempt bots match by account id per commit, not by login', async () => {
    const real = fakeGitHub({
      policy: V1_FILES,
      opener: RENOVATE,
      commits: [commit(0, RENOVATE, { committer: WEB_FLOW })],
    });
    assert.equal((await settleHead(real)).state, 'success');
    const fake = { id: 4242, login: 'renovate[bot]' };
    const spoof = fakeGitHub({ policy: V1_FILES, opener: fake, commits: [commit(0, fake)] });
    assert.equal((await settleHead(spoof)).state, 'failure');
  });

  test('acceptance: an incomplete commit set fails closed', async () => {
    const cases = [
      { commits: [commit(0, OWNER)], prCommits: 2 }, // count mismatch (truncated)
      { commits: [commit(1, OWNER)] }, // head not in the set
      { commits: [commit(0, OWNER), commit(0, OWNER)] }, // duplicate pages
      { commits: [commit(0, OWNER)], prCommits: 251 }, // beyond the API's listing limit
      { commits: [commit(0, OWNER)], files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}` })) },
    ];
    for (const pr of cases) {
      const gh = fakeGitHub({ policy: V1_FILES, ...pr });
      const status = await settleHead(gh);
      assert.equal(status.state, 'failure');
      assert.match(status.description, /^Failed closed/);
    }
  });

  test('acceptance: a head that moves during the check gets no verdict from the stale evaluation', async () => {
    const gh = fakeGitHub({ policy: V1_FILES, opener: ALICE, commits: [commit(0, ALICE)], heads: [HEAD, OTHER] });
    const status = await settleHead(gh);
    assert.equal(statusWrites(gh).length, 0, 'nothing is posted for the old head');
    assert.equal(status.verdict.state, 'none');
    // The push's own `synchronize` run settles the new head (and the old one again, via `before`).
  });

  test('an incomplete comment read fails closed', async () => {
    const gh = fakeGitHub({
      policy: V1_FILES,
      opener: ALICE,
      commits: [commit(0, ALICE)],
      comments: [sign(ALICE, V1)],
      issueComments: 2,
    });
    const status = await settleHead(gh);
    assert.equal(status.state, 'failure');
    assert.match(status.description, /PR comments/);
    assert.equal(gh.state.store, null, 'nothing recorded');
  });

  test('a missing store branch is created as an orphan with the first record', async () => {
    const gh = fakeGitHub({
      policy: V1_FILES,
      opener: ALICE,
      commits: [commit(0, ALICE)],
      comments: [sign(ALICE, V1)],
    });
    assert.equal((await settleHead(gh)).state, 'success');
    const commitWrite = gh.state.writes.find((w) => w.path.endsWith('/git/commits'));
    assert.deepEqual(commitWrite.body.parents, []);
    assert.equal(gh.state.store.records[0].github_id, ALICE.id);
  });

  test('acceptance: the prompt links the immutable CLA text whose version and hash are recorded', async () => {
    const gh = fakeGitHub({ policy: V1_FILES, opener: ALICE, commits: [commit(0, ALICE)] });
    const status = await settleHead(gh);
    const url = `https://github.com/${REPO}/blob/${gh.state.ref}/CLA.md`;
    assert.equal(status.target_url, url);
    assert.ok(prompt(gh).includes(`(${url}) (sha256 \`${V1.sha256}\`)`));
    const policy = { ...V1, links: { cla: url } };
    assert.ok(promptBody({ state: 'success' }, policy).includes(V1.sha256));
  });
});

describe('PRs sharing a head SHA (one shared `cla` status)', () => {
  // #7 by the exempt owner and #8 opened by Alice from a fork, both with the owner's commit as head.
  const sharedHead = (extra = {}, policy = V1_FILES) =>
    fakeGitHub({
      policy,
      prs: {
        7: { opener: OWNER, commits: [commit(0, OWNER)] },
        8: { opener: ALICE, commits: [commit(0, OWNER)], ...extra },
      },
    });

  test('acceptance: an exempt PR and an unsigned external PR with the same head fail, then signing turns both green', async () => {
    const gh = sharedHead();
    const status = await settleHead(gh);
    assert.equal(status.state, 'failure', "the exempt PR's own pass must not count for #8");
    assert.match(status.description, /^#8: 1 account\(s\) must sign/);
    assert.deepEqual(
      status.verdict.results.map((r) => [r.number, r.state]),
      [
        [7, 'success'],
        [8, 'failure'],
      ],
    );
    assert.match(prompt(gh, 7), /shared by every open pull request with the same head commit.*#8/);
    assert.match(prompt(gh, 8), /@alice must sign/);

    const signature = sign(ALICE, V1);
    gh.pr(8).comments.push(signature);
    await fire(gh, 'issue_comment', commentEvent(8, signature));
    assert.equal(gh.latest().state, 'success');
    assert.match(gh.latest().description, /: #7, #8 \[[0-9a-f]{10}\]$/, 'the success names every PR it covers');
    assert.match(prompt(gh, 7), /have signed/, "#7's prompt no longer points at #8");
  });

  test('acceptance: closing the unsigned external PR re-evaluates the PR left behind', async () => {
    const gh = sharedHead();
    assert.equal((await settleHead(gh)).state, 'failure');
    gh.pr(8).state = 'closed';
    await fire(gh, 'pull_request_target', prEvent(gh, 8, 'closed'));
    assert.equal(gh.latest().state, 'success');
    assert.match(gh.latest().description, /: #7 \[/);
  });

  test('the same holds while the CLA is a draft: an external duplicate blocks until it is closed', async () => {
    const gh = sharedHead({}, DRAFT_FILES);
    const status = await settleHead(gh);
    assert.equal(status.state, 'failure');
    assert.match(status.description, /^#8: CLA not yet in force/);
    assert.equal(prompt(gh, 7), undefined, 'still no comments while draft');
    gh.pr(8).state = 'closed';
    await fire(gh, 'pull_request_target', prEvent(gh, 8, 'closed'));
    assert.equal(gh.latest().state, 'success');
  });

  test('retargeting a PR to or from main re-evaluates its head', async () => {
    const gh = sharedHead({ base: 'release' });
    assert.equal((await settleHead(gh)).state, 'success', 'only PRs to main share the check');
    gh.pr(8).base = 'main';
    await fire(gh, 'pull_request_target', prEvent(gh, 8, 'edited', { changes: { base: {} } }));
    assert.equal(gh.latest().state, 'failure');
    gh.pr(8).base = 'release';
    await fire(gh, 'pull_request_target', prEvent(gh, 8, 'edited', { changes: { base: {} } }));
    assert.equal(gh.latest().state, 'success');
  });

  test('a push settles the new head and the previous head for the PRs still on it', async () => {
    const gh = sharedHead();
    assert.equal((await settleHead(gh)).state, 'failure');
    Object.assign(gh.pr(8), { head: NEW, commits: [commit(0, OWNER), commit(9, ALICE, { sha: NEW })] });
    const run = await fire(gh, 'pull_request_target', prEvent(gh, 8, 'synchronize', { before: HEAD }));
    assert.deepEqual(run.heads, [NEW, HEAD]);
    assert.equal(gh.latest(HEAD).state, 'success', '#7 alone on the old head');
    assert.equal(gh.latest(NEW).state, 'failure');
  });
});

describe('blocker 1: no inherited or stale success for a shared head', () => {
  const greenOwnerHead = async () => {
    const gh = fakeGitHub({
      policy: V1_FILES,
      prs: {
        7: { opener: OWNER, commits: [commit(0, OWNER)] },
        8: { opener: ALICE, commits: [commit(0, OWNER)], state: 'closed' },
      },
    });
    assert.equal((await settleHead(gh)).state, 'success');
    return gh;
  };

  test('a PR opened on an already green head gets pending before anything is evaluated', async () => {
    const gh = await greenOwnerHead();
    gh.pr(8).state = 'open';
    const reads = gh.state.reads.length;
    const planned = await planFor(gh, 'pull_request_target', prEvent(gh, 8, 'opened'));
    assert.equal(gh.latest().state, 'pending', 'the inherited success is gone before the settle job starts');
    assert.match(gh.latest().description, /#8 opened/);
    assert.ok(!gh.state.reads.slice(reads).some((p) => p.includes('/compare/')), 'plan evaluates nothing');
    await settleHead(gh, planned.heads[0]);
    assert.equal(gh.latest().state, 'failure');
    assert.match(gh.latest().description, /^#8:/);
  });

  test('reopening and retargeting to main invalidate the same way', async () => {
    for (const [action, extra] of [
      ['reopened', {}],
      ['edited', { changes: { base: {} } }],
    ]) {
      const gh = await greenOwnerHead();
      gh.pr(8).state = 'open';
      await planFor(gh, 'pull_request_target', prEvent(gh, 8, action, extra));
      assert.equal(gh.latest().state, 'pending', action);
    }
  });

  test('a PR that joins during the evaluation means no success is posted at all', async () => {
    const gh = await greenOwnerHead();
    const before = statusWrites(gh).length;
    gh.state.onRead = async (path) => {
      if (!path.includes('/compare/')) return;
      gh.state.onRead = null;
      gh.pr(8).state = 'open';
      await planFor(gh, 'pull_request_target', prEvent(gh, 8, 'opened'));
    };
    await settleHead(gh);
    const later = statusWrites(gh)
      .slice(before)
      .map((w) => w.body.state);
    assert.ok(!later.includes('success'), `no success after #8 joined: ${later}`);
    assert.equal(gh.latest().state, 'failure');
  });

  test('a PR that joins between the last check and the write gets the success replaced at once', async () => {
    const gh = await greenOwnerHead();
    gh.pr(8).state = 'closed';
    gh.state.statuses.delete(HEAD);
    gh.state.onWrite = async ({ path, body }) => {
      if (!path.includes('/statuses/') || body.state !== 'success') return;
      gh.state.onWrite = null;
      gh.pr(8).state = 'open';
      await planFor(gh, 'pull_request_target', prEvent(gh, 8, 'opened'));
    };
    await settleHead(gh);
    // pending (#8's plan), success (this run, already decided), pending (its re-check), failure.
    assert.deepEqual(states(gh), ['pending', 'success', 'pending', 'failure']);
  });

  test('a PR the open list does not show yet is found through the pending status its plan wrote', async () => {
    const gh = await greenOwnerHead();
    Object.assign(gh.pr(8), { state: 'open', listed: false });
    await fire(gh, 'pull_request_target', prEvent(gh, 8, 'opened'));
    assert.equal(gh.latest().state, 'failure');
    assert.match(gh.latest().description, /^#8:/);
  });

  test('reconciling replaces a success that does not name every open PR on its head', async () => {
    const gh = await greenOwnerHead();
    gh.pr(8).state = 'open'; // e.g. its plan job never ran
    const run = await fire(gh, 'schedule');
    assert.deepEqual(run.heads, [HEAD]);
    assert.deepEqual(states(gh).slice(-2), ['pending', 'failure']);
  });

  test('the workflow serializes settle jobs per head SHA', () => {
    const workflow = readFileSync(new URL('../.github/workflows/cla.yml', import.meta.url), 'utf8');
    assert.match(workflow, /concurrency:\n\s+group: cla-head-\$\{\{ matrix\.head \}\}\n\s+cancel-in-progress: false/);
  });
});

describe('blocker 2: a CLA policy change invalidates every head first', () => {
  const twoGreenHeads = async () => {
    const records = [];
    const gh = fakeGitHub({
      policy: V1_FILES,
      records,
      prs: {
        7: { opener: ALICE, commits: [commit(0, ALICE)], comments: [sign(ALICE, V1)] },
        8: { opener: BOB, head: OTHER, commits: [commit(0, BOB, { sha: OTHER })], comments: [sign(BOB, V1)] },
      },
    });
    assert.equal((await settleHead(gh, HEAD)).state, 'success');
    assert.equal((await settleHead(gh, OTHER, 8)).state, 'success');
    return gh;
  };

  test('acceptance: a green V1 head turns pending for V2 before any head is re-evaluated, then fails', async () => {
    const gh = await twoGreenHeads();
    gh.setPolicy(V2_FILES);
    const planned = await planFor(gh, 'push', {});
    assert.deepEqual(planned.heads.sort(), [HEAD, OTHER].sort());
    assert.equal(gh.latest(HEAD).state, 'pending');
    assert.equal(gh.latest(OTHER).state, 'pending');
    for (const sha of planned.heads) await settleHead(gh, sha);
    assert.equal(gh.latest(HEAD).state, 'failure');
    assert.equal(gh.latest(OTHER).state, 'failure');
  });

  test('an interrupted sweep is finished by the next run, and re-running it is idempotent', async () => {
    const gh = await twoGreenHeads();
    gh.setPolicy(V2_FILES);
    gh.state.fail = ({ path }) => (path.endsWith(`/statuses/${OTHER}`) ? new Error('HTTP 502') : null);
    const interrupted = await planFor(gh, 'push', {});
    assert.match(interrupted.errors.join(), /502/);
    assert.equal(gh.latest(HEAD).state, 'pending', 'the other heads are still invalidated');
    assert.equal(gh.latest(OTHER).state, 'success', 'the failed head keeps its stale V1 success for now');

    gh.state.fail = null;
    const writes = statusWrites(gh, HEAD).length;
    const resumed = await fire(gh, 'schedule');
    assert.deepEqual(resumed.heads.sort(), [HEAD, OTHER].sort());
    assert.deepEqual(states(gh, OTHER).slice(-2), ['pending', 'failure']);
    assert.equal(statusWrites(gh, HEAD).length, writes + 1, 'the already pending head only gets its verdict');

    const again = await fire(gh, 'push');
    assert.deepEqual(again.heads, [], 'every head already has a verdict for V2');
  });

  test('a policy change during the evaluation is not posted as a success with the old policy', async () => {
    const gh = await twoGreenHeads();
    gh.state.onRead = (path) => {
      if (path.includes('/compare/')) {
        gh.state.onRead = null;
        gh.setPolicy(V2_FILES);
      }
    };
    await settleHead(gh);
    assert.deepEqual(states(gh).slice(-2), ['pending', 'failure'], 'the V1 success is replaced, then V2 fails');
  });

  test('a malformed policy on main fails every green head closed', async () => {
    const gh = await twoGreenHeads();
    gh.setPolicy(files('{ not json', TEXT_V2));
    const run = await fire(gh, 'push');
    assert.match(run.errors.join(), /policy on main can't be used/);
    assert.equal(gh.latest(HEAD).state, 'failure');
    assert.equal(gh.latest(OTHER).state, 'failure');
  });
});

describe('the commit set is bound to immutable revisions', () => {
  test('commits come from the base...head comparison of the snapshot, page by page', async () => {
    const gh = fakeGitHub({ policy: V1_FILES, opener: OWNER, commits: [commit(1, OWNER), commit(0, OWNER)] });
    gh.state.pageSize = 1;
    // The PR is force-pushed to another commit set of the same size and back while page 1 is read.
    gh.state.onRead = (path) => {
      if (!path.includes('/compare/')) return;
      gh.state.onRead = null;
      const pr = gh.pr();
      Object.assign(pr, {
        head: NEW,
        commits: [commit(2, ALICE, { verified: false }), commit(3, ALICE, { sha: NEW })],
      });
      gh.api.get(`/repos/${REPO}/pulls/${N}`);
      Object.assign(pr, { head: HEAD, commits: [commit(1, OWNER), commit(0, OWNER)] });
    };
    assert.equal((await settleHead(gh)).state, 'success');
    assert.ok(
      gh.state.reads.every((p) => !p.includes('/pulls/7/commits')),
      'never read by PR number',
    );
    assert.ok(gh.state.reads.some((p) => p === `/repos/${REPO}/compare/${BASE_SHA}...${HEAD}`));
  });

  test('a base revision that changes during the check is evaluated again', async () => {
    const gh = fakeGitHub({ policy: V1_FILES, opener: OWNER, commits: [commit(0, OWNER)] });
    gh.state.onRead = (path) => {
      if (!path.includes('/compare/')) return;
      gh.state.onRead = null;
      gh.pr().baseSha = OTHER; // retargeted and back, or rebased onto a newer base
    };
    assert.equal((await settleHead(gh)).state, 'success');
    const compares = gh.state.reads.filter((p) => p.includes('/compare/'));
    assert.deepEqual(compares, [
      `/repos/${REPO}/compare/${BASE_SHA}...${HEAD}`,
      `/repos/${REPO}/compare/${OTHER}...${HEAD}`,
    ]);
  });

  test('a comparison whose total changes between pages fails closed', async () => {
    const gh = fakeGitHub({ policy: V1_FILES, commits: [commit(1, OWNER), commit(0, OWNER)], compareTotals: [2, 3] });
    gh.state.pageSize = 1;
    const status = await settleHead(gh);
    assert.equal(status.state, 'failure');
    assert.match(status.description, /changed between pages/);
  });
});

describe('commit attribution through GitHub (web-flow)', () => {
  test("a commit GitHub signed counts only for the PR's opener", async () => {
    const own = fakeGitHub({
      opener: ALICE,
      policy: V1_FILES,
      commits: [commit(0, ALICE, { committer: WEB_FLOW })],
      comments: [sign(ALICE, V1)],
    });
    assert.equal((await settleHead(own)).state, 'success');
    const foreign = fakeGitHub({
      opener: BOB,
      policy: V1_FILES,
      commits: [commit(0, ALICE, { committer: WEB_FLOW })],
      comments: [sign(ALICE, V1), sign(BOB, V1)],
    });
    const status = await settleHead(foreign);
    assert.equal(status.state, 'failure');
    assert.match(status.result.problems[0], /web-flow/);
    const owner = fakeGitHub({
      opener: ALICE,
      policy: V1_FILES,
      commits: [commit(0, OWNER, { committer: WEB_FLOW })],
      comments: [sign(ALICE, V1)],
    });
    assert.equal(
      (await settleHead(owner)).state,
      'failure',
      'a GitHub-signed commit claiming the exempt owner is not exempt',
    );
  });
});

describe('edited comments are no assent', () => {
  test('an edited signing comment does not count, a new one does', async () => {
    const gh = fakeGitHub({
      policy: V1_FILES,
      opener: ALICE,
      commits: [commit(0, ALICE)],
      comments: [comment(ALICE, phrase(V1), { edited: true })],
    });
    assert.equal((await settleHead(gh)).state, 'failure', 'e.g. a moderator edited the phrase into it');
    assert.match(prompt(gh), /Edited comments do not count/);
    gh.pr().comments.push(sign(ALICE, V1));
    assert.equal((await settleHead(gh)).state, 'success');
  });

  test('a stored record stops counting once its comment is edited or deleted', async () => {
    for (const change of ['edit', 'delete']) {
      const evidence = sign(ALICE, V1);
      const gh = fakeGitHub({
        policy: V1_FILES,
        opener: ALICE,
        commits: [commit(0, ALICE)],
        records: [record(ALICE, V1, evidence)],
      });
      if (change === 'edit') gh.state.others.push({ ...evidence, updated_at: '2026-11-28T00:00:00Z' });
      assert.equal((await settleHead(gh)).state, 'failure', change);
    }
  });

  test('the workflow does not run for edited comments', () => {
    const workflow = readFileSync(new URL('../.github/workflows/cla.yml', import.meta.url), 'utf8');
    assert.match(workflow, /issue_comment:\n\s+types: \[created\]\n/);
  });
});

describe('comment-triggered runs and the status quota', () => {
  test('the workflow starts no runner for comments that are no signing phrase or are from bots', () => {
    const workflow = readFileSync(new URL('../.github/workflows/cla.yml', import.meta.url), 'utf8');
    assert.ok(workflow.includes(`contains(github.event.comment.body, '${SIGNING_PREFIX}')`));
    assert.ok(workflow.includes("github.event.comment.user.type != 'Bot'"));
    assert.ok(phrase(V1).startsWith(SIGNING_PREFIX));
  });

  test('plan drops comments that cannot change a verdict', async () => {
    const gh = fakeGitHub({ policy: V1_FILES, opener: ALICE, commits: [commit(0, ALICE)] });
    const drops = [
      commentEvent(N, comment(BOB, phrase(V1))), // neither opener nor author
      commentEvent(N, comment(ALICE, phrase(V2))), // another version
      commentEvent(N, comment(ALICE, `${phrase(V1)} thanks`)), // not the exact phrase
      { action: 'created', issue: { number: N }, comment: comment(ALICE, phrase(V1)) }, // an issue, not a PR
    ];
    for (const event of drops) assert.deepEqual((await planFor(gh, 'issue_comment', event)).heads, []);
    const draft = fakeGitHub({ opener: ALICE, commits: [commit(0, ALICE)] });
    assert.deepEqual((await planFor(draft, 'issue_comment', commentEvent(N, comment(ALICE, phrase(V1))))).heads, []);
    assert.equal(gh.state.writes.length + draft.state.writes.length, 0);
  });

  test('a re-evaluation that changes nothing writes nothing, also for repeated signing comments', async () => {
    const signature = sign(ALICE, V1);
    const gh = fakeGitHub({ policy: V1_FILES, opener: ALICE, commits: [commit(0, ALICE)], comments: [signature] });
    await settleHead(gh);
    const writes = gh.state.writes.length;
    for (let i = 0; i < 3; i++) {
      const spam = sign(ALICE, V1);
      gh.pr().comments.push(spam);
      await fire(gh, 'issue_comment', commentEvent(N, spam));
    }
    const statusOrPrompt = gh.state.writes
      .slice(writes)
      .filter((w) => !w.path.includes('signatures') && !w.path.includes('/git/'));
    assert.deepEqual(statusOrPrompt, [], 'no status or prompt writes');
  });

  test('near the per-SHA status limit only one final failure is posted', async () => {
    const gh = fakeGitHub({ commits: [commit(0, OWNER)] });
    gh.state.statuses.set(
      HEAD,
      Array.from({ length: MAX_STATUSES }, () => ({
        context: CONTEXT,
        state: 'failure',
        description: 'x',
        creator: { id: IDS.actionsBot },
      })),
    );
    await settleHead(gh);
    await settleHead(gh);
    assert.deepEqual(
      statusWrites(gh).map((w) => [w.body.state, w.body.description]),
      [['failure', CAPPED]],
    );
  });
});

describe('the signature store is evidence only', () => {
  test('forged records (another account, no signing phrase, missing comment) do not count', async () => {
    const bobs = sign(BOB, V1);
    const chat = comment(ALICE, 'thanks!');
    const forged = [{ ...record(ALICE, V1, bobs) }, record(ALICE, V1, chat), { ...record(ALICE, V1, { id: 999999 }) }];
    const gh = fakeGitHub({ policy: V1_FILES, opener: ALICE, commits: [commit(0, ALICE)], records: forged });
    gh.state.others.push(bobs, chat);
    assert.equal((await settleHead(gh)).state, 'failure');
  });

  test('a record without a comment reference makes the store malformed (fails closed)', async () => {
    const gh = fakeGitHub({
      policy: V1_FILES,
      opener: ALICE,
      commits: [commit(0, ALICE)],
      records: [{ github_id: ALICE.id, version: '1.0', sha256: V1.sha256 }],
    });
    const status = await settleHead(gh);
    assert.equal(status.state, 'failure');
    assert.match(status.description, /malformed/);
  });

  test('two simultaneous first writes and concurrent appends keep every record', async () => {
    const other = sign(BOB, V1);
    const gh = fakeGitHub({
      policy: V1_FILES,
      opener: ALICE,
      commits: [commit(0, ALICE)],
      comments: [sign(ALICE, V1)],
    });
    gh.state.race = { refs: 1, put: 1, record: record(BOB, V1, other) };
    assert.equal((await settleHead(gh)).state, 'success');
    assert.deepEqual(
      gh.state.store.records.map((r) => r.github_id),
      [BOB.id, BOB.id, ALICE.id],
      "the other run's records stay, this run's record is appended after them",
    );
    const responses = storeWrites(gh).map((w) => `${w.method} ${w.path.split('/').slice(-2).join('/')}`);
    assert.deepEqual(responses, [
      'POST git/trees',
      'POST git/commits',
      'POST git/refs', // 422: the other run created the branch
      'PUT contents/signatures.json', // 409: the other run appended first
      'PUT contents/signatures.json',
    ]);
  });
});

describe('changes to the CLA check or policy need the owner approval signature', () => {
  const PAYLOAD = `tree ${'1'.repeat(40)}\nparent ${BASE_SHA}\nauthor soeenplop <x@example.com> 1764230400 +0100\n\nchore: approve\n`;
  const keys = (() => {
    const dir = mkdtempSync(join(tmpdir(), 'cla-test-'));
    const make = (name) => {
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', join(dir, name)]);
      return {
        signers: `owner ${readFileSync(join(dir, `${name}.pub`), 'utf8').trim()}\n`,
        sign(payload) {
          writeFileSync(join(dir, 'payload'), payload);
          rmSync(join(dir, 'payload.sig'), { force: true });
          execFileSync('ssh-keygen', ['-Y', 'sign', '-f', join(dir, name), '-n', 'git', join(dir, 'payload')], {
            stdio: 'ignore',
          });
          return readFileSync(join(dir, 'payload.sig'), 'utf8');
        },
      };
    };
    return { owner: make('owner'), agent: make('agent') };
  })();
  const guarded = (approvers, head = commit(0, OWNER), policy = DRAFT_FILES) => {
    const withKeys = { ...policy, '.github/cla-approvers': approvers === null ? null : Buffer.from(approvers) };
    return fakeGitHub({
      policy: withKeys,
      commits: [head],
      files: [{ filename: 'src/x.ts' }, { filename: '.github/cla.json' }],
    });
  };
  const approved = (key) => commit(0, OWNER, { signature: key.sign(PAYLOAD), payload: PAYLOAD });

  test('an owner PR that changes the policy fails without an approval signature on its head', async () => {
    for (const gh of [guarded(null), guarded('# no keys yet\n'), guarded(keys.owner.signers)]) {
      const status = await settleHead(gh);
      assert.equal(status.state, 'failure');
      assert.match(status.description, /owner's approval signature/);
      assert.deepEqual(status.result.guarded, ['.github/cla.json']);
    }
  });

  test('it passes when the head commit is signed with an approver key, not with another key', async () => {
    assert.equal((await settleHead(guarded(keys.owner.signers, approved(keys.owner)))).state, 'success');
    assert.equal((await settleHead(guarded(keys.owner.signers, approved(keys.agent)))).state, 'failure');
    const tampered = approved(keys.owner);
    tampered.commit.verification.payload = PAYLOAD.replace('approve', 'approve!');
    assert.equal((await settleHead(guarded(keys.owner.signers, tampered))).state, 'failure');
  });

  test('the approval must be on the head commit, and the policy keys come from main', async () => {
    const gh = guarded(keys.owner.signers);
    gh.pr().commits = [approved(keys.owner), commit(9, OWNER, { sha: HEAD })];
    gh.pr().commits[0].sha = '9'.repeat(40);
    assert.equal((await settleHead(gh)).state, 'failure', 'an approved commit below the head does not count');
    assert.ok(signedByApprover(approved(keys.owner), keys.owner.signers));
    assert.ok(!signedByApprover(approved(keys.owner), ''));
  });

  test('renames and every protected path are covered, and CODEOWNERS lists them', () => {
    const paths = [
      'CLA.md',
      '.github/cla.json',
      '.github/cla-approvers',
      '.github/CODEOWNERS',
      '.github/workflows/cla.yml',
      '.github/rulesets/main.json',
      'tools/cla-check.mjs',
      'tools/cla-check.test.mjs',
    ];
    for (const path of paths)
      assert.ok(
        PROTECTED.some((p) => p.test(path)),
        path,
      );
    assert.ok(!PROTECTED.some((p) => p.test('CONTRIBUTING.md')));
    const owners = readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8');
    for (const path of paths) {
      const entry = path.startsWith('.github/rulesets/') ? '/.github/rulesets/' : `/${path}`;
      assert.match(owners, new RegExp(`^${entry.replaceAll('.', '\\.')} @soeenplop$`, 'm'), path);
    }
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
  test('final requires a numeric version, the exact hash and a matching version marker in a non-draft CLA.md', () => {
    const text = Buffer.from(TEXT_V1);
    const good = { status: 'final', version: '1.0', sha256: sha256(text), exempt: [] };
    assert.equal(parseConfig(good, text).status, 'final');
    assert.throws(() => parseConfig(good, Buffer.from(TEXT_V2)), /does not match/);
    assert.throws(() => parseConfig({ ...good, version: '1.0-draft' }, text), /version/);
    const draftText = Buffer.from('DRAFT — not yet in force.\n\nVersion 1.0\n');
    assert.throws(() => parseConfig({ ...good, sha256: sha256(draftText) }, draftText), /draft/);
    assert.throws(() => parseConfig({ ...good, status: 'active' }, text), /status/);
    assert.throws(() => parseConfig({ ...good, exempt: [{ login: 'soeenplop' }] }, text), /account id/);
  });

  test('the version marker in CLA.md must exist once and equal the configured version, without a draft suffix', () => {
    const config = (text) => ({ status: 'final', version: '1.0', sha256: sha256(Buffer.from(text)), exempt: [] });
    for (const text of ['# CLA\n\nVersion 2.0\n', '# CLA\n\nno marker\n', '# CLA\n\nVersion 1.0\n\nVersion 1.0\n']) {
      assert.throws(() => parseConfig(config(text), Buffer.from(text)), /exactly one "Version 1\.0" line/, text);
    }
    const suffixed = '# CLA\n\nVersion 1.0-draft\n';
    assert.throws(() => parseConfig(config(suffixed), Buffer.from(suffixed)), /draft/);
  });

  test('the repository config is a valid draft that exempts the owner by id and has no approver key yet', async () => {
    const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
    const approvers = read('.github/cla-approvers').toString('utf8');
    const config = parseConfig(JSON.parse(read('.github/cla.json').toString('utf8')), read('CLA.md'), approvers);
    assert.equal(config.status, 'draft');
    assert.equal(config.exempt.get(OWNER.id), 'soeenplop');
    assert.ok(approvers.split('\n').every((line) => !line.trim() || line.startsWith('#')));
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
