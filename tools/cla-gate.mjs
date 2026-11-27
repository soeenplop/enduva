// Interim CLA gate (roadmap 0.5, T24, owner ruling 2026-11-27), run by .github/workflows/cla.yml.
// While CLA.md is a draft, only the owner and the listed bots may contribute. A PR passes only if:
// - its opener, and the opener of every other open PR with the same head SHA, is allowlisted and
//   the PR comes from this repository (the `cla` result belongs to the SHA, not to one PR);
// - every commit has a GitHub-verified signature and a GitHub-linked author and committer that are
//   allowlisted (committer `web-flow` also allowed), matched by numeric account ID only;
// - its commit set, read from the immutable base...head comparison, is provably complete and the PR's
//   base and head didn't change during evaluation. Anything else, including API errors, fails.
// Roadmap task CLA.1 replaces this with the full signature check.
//
// Usage: node tools/cla-gate.mjs              (in the workflow: GITHUB_TOKEN, GITHUB_EVENT_PATH, …)
//        node tools/cla-gate.mjs --self-test
import { appendFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Account IDs that may open PRs and author or commit their commits. */
export const ALLOWED = new Map([
  [82885605, 'soeenplop (owner)'],
  [29139614, 'renovate[bot]'],
  [41898282, 'github-actions[bot]'],
]);
/** GitHub's committer of web UI and API commits: accepted as committer only. */
export const WEB_FLOW = 19864447;
const MAX_COMMITS = 250;
const PAGE = 100;
const MAX_PR_PAGES = 10;

/**
 * `pr` and `prAfter` are the PR read before and after reading the comparison of its base and head
 * SHAs (`total` = its total_commits, `commits` = every page), `eventHead` the head SHA the run
 * reports on, `openPrs` every open PR of the repository.
 */
export function judge({ eventHead, pr, total, commits, prAfter, openPrs }) {
  const problems = [];
  const who = (u) => (u ? `${u.login} (ID ${u.id})` : 'not linked to a GitHub account');
  const head = pr.head.sha;
  if (head !== eventHead) problems.push('the PR head is not the head this run reports on');
  if (prAfter.head.sha !== head || prAfter.base.sha !== pr.base.sha || prAfter.commits !== pr.commits) {
    problems.push('the PR changed during evaluation');
  }
  if (!(pr.commits <= MAX_COMMITS)) problems.push(`${pr.commits} commits: more than ${MAX_COMMITS}`);
  const shas = new Set(commits.map((c) => c.sha));
  if (total !== pr.commits || commits.length !== total || shas.size !== total) {
    problems.push(
      `commit set incomplete: PR ${pr.commits}, compare ${total}, read ${commits.length} (${shas.size} distinct)`,
    );
  }
  if (!shas.has(head)) problems.push('the commit set does not contain the head');
  for (const c of commits) {
    if (!ALLOWED.has(c.author?.id)) problems.push(`${c.sha}: author ${who(c.author)}`);
    if (!ALLOWED.has(c.committer?.id) && c.committer?.id !== WEB_FLOW) {
      problems.push(`${c.sha}: committer ${who(c.committer)}`);
    }
    if (c.commit?.verification?.verified !== true) problems.push(`${c.sha}: signature not verified by GitHub`);
  }
  for (const p of [pr, ...openPrs.filter((o) => o.head?.sha === head && o.number !== pr.number)]) {
    if (!ALLOWED.has(p.user?.id)) problems.push(`PR #${p.number} on this head: opener ${who(p.user)}`);
    if (p.head?.repo?.id !== pr.base.repo.id) problems.push(`PR #${p.number} on this head: from another repository`);
  }
  return problems;
}

function selfTest() {
  const [owner, renovate, actions, stranger] = [82885605, 29139614, 41898282, 4242].map((id) => ({ login: 'x', id }));
  const webFlow = { login: 'web-flow', id: WEB_FLOW };
  const repo = { id: 7 };
  const fork = { id: 8 };
  const commit = (sha, author, committer = author, verified = true) => ({
    sha,
    author,
    committer,
    commit: { verification: { verified } },
  });
  const mkPr = (number, user, over = {}) => ({
    number,
    user,
    commits: 2,
    head: { sha: 'h1', repo },
    base: { sha: 'b1', repo },
    ...over,
  });
  const input = (over = {}) => {
    const commits = over.commits ?? [commit('a1', owner), commit('h1', owner, webFlow)];
    const pr = mkPr(1, owner, { commits: commits.length, ...over.pr });
    return { eventHead: 'h1', total: commits.length, commits, prAfter: pr, openPrs: [pr], ...over, pr };
  };
  const other = (user, headRepo = repo, sha = 'h1') => mkPr(2, user, { head: { sha, repo: headRepo } });
  const cases = [
    ['passes an owner PR (committer web-flow allowed)', input(), false],
    ['passes a Renovate PR', input({ pr: { user: renovate }, commits: [commit('h1', renovate, webFlow)] }), false],
    ['passes a github-actions PR', input({ pr: { user: actions }, commits: [commit('h1', actions)] }), false],
    ['passes with an owner PR on the same head', input({ openPrs: [other(owner)] }), false],
    ['passes with a stranger PR on another head', input({ openPrs: [other(stranger, fork, 'h9')] }), false],
    ['fails a stranger opener with owner commits', input({ pr: { user: stranger } }), true],
    ['fails an owner login with another ID', input({ pr: { user: { login: 'soeenplop', id: 1 } } }), true],
    ['fails a PR from a fork', input({ pr: { head: { sha: 'h1', repo: fork } } }), true],
    ['fails (owner re-run) while a stranger PR shares the head', input({ openPrs: [other(stranger)] }), true],
    ['fails while a fork PR of the owner shares the head', input({ openPrs: [other(owner, fork)] }), true],
    ['fails while a PR without head repo shares the head', input({ openPrs: [other(owner, null)] }), true],
    ['fails a stranger author', input({ commits: [commit('a1', owner), commit('h1', stranger, owner)] }), true],
    ['fails an unlinked author', input({ commits: [commit('a1', null, owner), commit('h1', owner)] }), true],
    ['fails a stranger committer', input({ commits: [commit('a1', owner, stranger), commit('h1', owner)] }), true],
    ['fails an unlinked committer', input({ commits: [commit('a1', owner, null), commit('h1', owner)] }), true],
    ['fails web-flow as author', input({ commits: [commit('h1', webFlow)] }), true],
    [
      'fails an unsigned owner commit',
      input({ commits: [commit('a1', owner, owner, false), commit('h1', owner)] }),
      true,
    ],
    [
      'fails an unsigned web-flow commit',
      input({ commits: [commit('a1', owner), commit('h1', owner, webFlow, false)] }),
      true,
    ],
    ['fails a commit without verification', input({ commits: [{ sha: 'h1', author: owner, committer: owner }] }), true],
    ['fails when compare reports more commits', input({ total: 3 }), true],
    ['fails when the PR reports more commits', input({ pr: { commits: 3 } }), true],
    ['fails a duplicated page read', input({ commits: [commit('h1', owner), commit('h1', owner)] }), true],
    ['fails more than 250 commits', input({ pr: { commits: 251 } }), true],
    ['fails a missing commit count', input({ pr: { commits: undefined } }), true],
    ['fails a set without the head', input({ commits: [commit('a1', owner), commit('a2', owner)] }), true],
    ['fails an empty set', input({ commits: [], pr: { commits: 0 } }), true],
    ['fails when the event head differs', input({ eventHead: 'h0' }), true],
    ['fails when the head moved', input({ prAfter: mkPr(1, owner, { head: { sha: 'h2', repo } }) }), true],
    ['fails a same-head base change', input({ prAfter: mkPr(1, owner, { base: { sha: 'b2', repo } }) }), true],
    ['fails a changed commit count', input({ prAfter: mkPr(1, owner, { commits: 3 }) }), true],
  ];
  let failed = 0;
  for (const [name, args, expectFail] of cases) {
    const ok = judge(args).length > 0 === expectFail;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed > 0) process.exit(1);
}

async function api(path) {
  const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_TOKEN } = process.env;
  const res = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}${path}`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${GITHUB_TOKEN}` },
  });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

async function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const n = Number(event.pull_request.number);
  const pr = await api(`/pulls/${n}`);
  const base = encodeURIComponent(pr.base.sha);
  const head = encodeURIComponent(pr.head.sha);
  const commits = [];
  let total;
  for (let page = 1; page <= Math.ceil(MAX_COMMITS / PAGE); page++) {
    const cmp = await api(`/compare/${base}...${head}?per_page=${PAGE}&page=${page}`);
    total = cmp.total_commits;
    commits.push(...cmp.commits);
    if (cmp.commits.length < PAGE || commits.length >= total) break;
  }
  const openPrs = [];
  for (let page = 1; ; page++) {
    if (page > MAX_PR_PAGES) throw new Error(`more than ${MAX_PR_PAGES * PAGE} open PRs`);
    const batch = await api(`/pulls?state=open&per_page=${PAGE}&page=${page}`);
    openPrs.push(...batch);
    if (batch.length < PAGE) break;
  }
  const prAfter = await api(`/pulls/${n}`);
  const problems = judge({ eventHead: event.pull_request.head.sha, pr, total, commits, prAfter, openPrs });
  if (problems.length === 0) {
    console.log(`ok   cla gate: PR #${n} @ ${pr.head.sha}, opener and ${commits.length} commits allowlisted`);
    return;
  }
  const contributing = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/blob/main/CONTRIBUTING.md`;
  const message =
    "External contributions can't be accepted until the Contributor License Agreement (CLA.md, still a draft) " +
    'is final. Until then this check passes only pull requests opened, authored and committed by the maintainer ' +
    `or the listed bots. See ${contributing}#licence-and-cla`;
  console.log(`::error title=CLA gate::${message}`);
  console.error(`FAIL cla gate: PR #${n} @ ${pr.head.sha}:\n  ${problems.join('\n  ')}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## CLA gate failed\n\n${message}\n\n- ${problems.join('\n- ')}\n`);
  }
  process.exit(1);
}

const args = process.argv.slice(2);
if (args[0] === '--self-test') {
  selfTest();
} else if (args.length === 0) {
  await run();
} else {
  throw new Error(`usage: ${basename(process.argv[1])} [--self-test]`);
}
