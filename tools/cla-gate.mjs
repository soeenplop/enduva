// Interim CLA gate (roadmap 0.5, T24, owner ruling 2026-11-27), run by .github/workflows/cla.yml.
// While CLA.md is a draft, only the owner and the listed bots may contribute: the PR opener and the
// GitHub-linked author and committer of every commit must be allowlisted accounts, matched by numeric
// account ID only (never login, name or email). Unlinked authors fail, and so does a commit list
// that can't be shown to be complete. Roadmap task CLA.1 replaces this with the full signature check.
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
/** The PR commits API lists at most 250 commits. */
const MAX_COMMITS = 250;

/**
 * `pr` is the PR as read before listing its commits, `commits` every page of its commits API,
 * `eventHead` the head SHA the run reports on and `headAfter` the PR head read after listing.
 */
export function judge({ pr, commits, eventHead, headAfter }) {
  const problems = [];
  const who = (u) => (u ? `${u.login} (ID ${u.id})` : 'not linked to a GitHub account');
  if (!ALLOWED.has(pr.user?.id)) problems.push(`PR opener is ${who(pr.user)}`);
  if (pr.head.sha !== eventHead || headAfter !== eventHead) problems.push('the head moved during evaluation');
  if (!(pr.commits <= MAX_COMMITS)) problems.push(`${pr.commits} commits: more than the API can list`);
  if (commits.length !== pr.commits) problems.push(`commit list incomplete: read ${commits.length} of ${pr.commits}`);
  if (!commits.some((c) => c.sha === pr.head.sha)) problems.push('the commit list does not contain the head');
  for (const c of commits) {
    if (!ALLOWED.has(c.author?.id)) problems.push(`${c.sha}: author ${who(c.author)}`);
    if (!ALLOWED.has(c.committer?.id) && c.committer?.id !== WEB_FLOW) {
      problems.push(`${c.sha}: committer ${who(c.committer)}`);
    }
  }
  return problems;
}

function selfTest() {
  const [owner, renovate, actions, stranger] = [82885605, 29139614, 41898282, 4242].map((id) => ({ login: 'x', id }));
  const webFlow = { login: 'web-flow', id: WEB_FLOW };
  const commit = (sha, author, committer = author) => ({ sha, author, committer });
  const input = (over = {}) => {
    const commits = over.commits ?? [commit('a1', owner), commit('h1', owner, webFlow)];
    const pr = { user: owner, head: { sha: 'h1' }, commits: commits.length, ...over.pr };
    return { commits, eventHead: 'h1', headAfter: 'h1', ...over, pr };
  };
  const cases = [
    ['passes an owner PR (committer web-flow allowed)', input(), false],
    ['passes a Renovate PR', input({ pr: { user: renovate }, commits: [commit('h1', renovate, webFlow)] }), false],
    ['passes a github-actions PR', input({ pr: { user: actions }, commits: [commit('h1', actions)] }), false],
    ['fails a stranger opener with owner commits', input({ pr: { user: stranger } }), true],
    ['fails an owner login with another ID', input({ pr: { user: { login: 'soeenplop', id: 1 } } }), true],
    ['fails a stranger author', input({ commits: [commit('a1', owner), commit('h1', stranger, owner)] }), true],
    ['fails an unlinked author', input({ commits: [commit('a1', null, owner), commit('h1', owner)] }), true],
    ['fails a stranger committer', input({ commits: [commit('a1', owner, stranger), commit('h1', owner)] }), true],
    ['fails an unlinked committer', input({ commits: [commit('a1', owner, null), commit('h1', owner)] }), true],
    ['fails web-flow as author', input({ commits: [commit('h1', webFlow)] }), true],
    ['fails an incomplete commit list', input({ pr: { commits: 3 } }), true],
    ['fails more than 250 commits', input({ pr: { commits: 251 } }), true],
    ['fails a missing commit count', input({ pr: { commits: undefined } }), true],
    ['fails a list without the head', input({ commits: [commit('a1', owner), commit('a2', owner)] }), true],
    ['fails an empty list', input({ commits: [], pr: { commits: 0 } }), true],
    ['fails when the event head differs', input({ eventHead: 'h0' }), true],
    ['fails when the head moved while listing', input({ headAfter: 'h2' }), true],
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
  const commits = [];
  for (let page = 1; page <= Math.ceil(MAX_COMMITS / 100); page++) {
    const batch = await api(`/pulls/${n}/commits?per_page=100&page=${page}`);
    commits.push(...batch);
    if (batch.length < 100) break;
  }
  const headAfter = (await api(`/pulls/${n}`)).head.sha;
  const problems = judge({ pr, commits, eventHead: event.pull_request.head.sha, headAfter });
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
