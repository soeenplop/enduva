// CLA check (roadmap task 0.5, decision T24): a small first-party workflow script instead of a
// third-party CLA action. .github/workflows/cla.yml runs it from the base branch on
// `pull_request_target`, on PR comments and when the CLA changes on main. It never checks out or
// runs PR code: it reads the PR through the GitHub API and sets the commit status `cla` on the exact
// head SHA it evaluated.
//
// Activation: `status` in .github/cla.json. While it is "draft", no signatures are collected, and a
// PR passes only if every commit author and the PR opener are exempt accounts. "final" (an owner-only
// change, see CONTRIBUTING.md) pins the CLA version and the SHA-256 of CLA.md.
//
// Rules (roadmap row 0.5):
// - One complete commit set for the evaluated head: every page is read, the count must equal the
//   PR's commit count and contain the head, and the head must not move during the check.
// - A commit counts for account X only if GitHub links its author to X and verifies its signature
//   with X (or GitHub's own web-flow) as committer. A git name or email alone is never trusted.
// - Every commit's attribution is checked first. Only then are exemptions (account IDs, per commit)
//   and signatures applied. The PR opener must be exempt or have signed too.
// - A signature is a PR comment by that same account whose whole body is the phrase for this
//   version and hash, or a stored record for that account, version and hash on the append-only
//   `cla-signatures` branch, which only this check writes.
// - Anything incomplete or inconsistent (pagination, counts, moved head, unreadable store) fails closed.
//
// Usage: node tools/cla-check.mjs                            (in the workflow, from GITHUB_* env)
//        node tools/cla-check.mjs --dry-run <owner/repo> <pr> (GITHUB_TOKEN; reads only, prints)
//        node tools/cla-check.mjs --hash                     (SHA-256 of CLA.md for .github/cla.json)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CONTEXT = 'cla';
export const STORE = { branch: 'cla-signatures', path: 'signatures.json' };
export const IDS = { actionsBot: 41898282, webFlow: 19864447 };
const MARKER = '<!-- enduva-cla-check -->';
const NOT_IN_FORCE = 'CLA not yet in force: external contributions are not accepted';
// GET /pulls/{n}/commits never lists more than 250 commits, so a larger set can't be complete.
const MAX_PR_COMMITS = 250;
const MAX_PAGES = 50;
const LOGIN = /^[A-Za-z0-9-]{1,39}(\[bot\])?$/;

/** Completeness or consistency couldn't be established. The check fails closed. */
export class Incomplete extends Error {}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const phrase = (cla) => `I have read and agree to the Enduva CLA version ${cla.version}, sha256 ${cla.sha256}.`;

/** The whole comment must be the phrase: no substring match, only line endings and outer whitespace normalised. */
export const isSignature = (body, cla) =>
  typeof body === 'string' && body.replace(/\r\n?/g, '\n').trim() === phrase(cla);

/** Validates .github/cla.json against the CLA.md bytes of the same commit. */
export function parseConfig(config, claBytes) {
  const fail = (message) => {
    throw new Error(`.github/cla.json: ${message}`);
  };
  if (config.status !== 'draft' && config.status !== 'final') fail('status must be "draft" or "final"');
  if (!Array.isArray(config.exempt)) fail('exempt must be a list');
  const exempt = new Map();
  for (const entry of config.exempt) {
    if (!Number.isSafeInteger(entry?.id) || entry.id <= 0 || typeof entry.login !== 'string') {
      fail('every exempt entry needs a numeric GitHub account id and a login');
    }
    exempt.set(entry.id, entry.login);
  }
  if (config.status === 'draft') return { status: 'draft', exempt };
  if (typeof config.version !== 'string' || !/^\d+(\.\d+)*$/.test(config.version)) {
    fail('a final version must look like "1.0"');
  }
  if (typeof config.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(config.sha256)) {
    fail('sha256 must be 64 lowercase hex digits');
  }
  if (sha256(claBytes) !== config.sha256) {
    fail('sha256 does not match CLA.md: a changed CLA needs a new version and hash');
  }
  if (/not yet in force/i.test(claBytes.toString('utf8'))) fail('CLA.md is still marked as a draft');
  return { status: 'final', version: config.version, sha256: config.sha256, exempt };
}

/** The account a commit is attributed to, or why it can't be attributed. */
export function attribute(commit) {
  const { author, committer } = commit;
  if (!Number.isSafeInteger(author?.id)) return { problem: 'its author is not linked to a GitHub account' };
  if (commit.commit?.verification?.verified !== true) {
    return { problem: 'its signature is not verified by GitHub' };
  }
  if (committer?.id !== author.id && committer?.id !== IDS.webFlow) {
    return { problem: 'it was committed by another account than its author' };
  }
  return { account: { id: author.id, login: author.login } };
}

/** Minimal REST client: errors throw, pagination follows `Link: rel="next"` on the API origin only. */
export function createApi({
  token,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.github.com',
  dryRun = false,
  log = console.log,
}) {
  const origin = new URL(baseUrl).origin;
  async function request(method, path, body, allow = []) {
    const url = new URL(path, baseUrl);
    if (url.origin !== origin) throw new Incomplete(`refusing to call ${url.origin}`);
    if (dryRun && method !== 'GET') {
      log(`dry run, not sent: ${method} ${url.pathname} ${JSON.stringify(body)}`);
      return { status: 200, data: { sha: 'dry-run', object: { sha: 'dry-run' } } };
    }
    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const ok = (response.status >= 200 && response.status < 300) || allow.includes(response.status);
    if (!ok) throw new Error(`GitHub API ${method} ${url.pathname}: HTTP ${response.status}`);
    return { status: response.status, data: text ? JSON.parse(text) : null, link: response.headers.get('link') };
  }
  return {
    request,
    get: async (path) => (await request('GET', path)).data,
    async paginate(path) {
      const items = [];
      let next = `${path}${path.includes('?') ? '&' : '?'}per_page=100`;
      for (let page = 1; next; page++) {
        if (page > MAX_PAGES) throw new Incomplete(`${path}: more than ${MAX_PAGES} pages`);
        const { data, link } = await request('GET', next);
        if (!Array.isArray(data)) throw new Incomplete(`${path}: page ${page} is not a list`);
        items.push(...data);
        next = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      }
      return items;
    },
  };
}

async function retry(fn, sleep, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof Incomplete) || attempt >= attempts) throw error;
      await sleep(2000 * attempt);
    }
  }
}

async function readCommitSet(api, repo, number, ctx) {
  const pr = await api.get(`/repos/${repo}/pulls/${number}`);
  ctx.head = pr.head.sha;
  if (pr.commits > MAX_PR_COMMITS) {
    throw new Incomplete(`the PR has more than ${MAX_PR_COMMITS} commits, which the API can't list completely`);
  }
  const commits = await api.paginate(`/repos/${repo}/pulls/${number}/commits`);
  const shas = new Set(commits.map((commit) => commit.sha));
  if (commits.length !== pr.commits || shas.size !== commits.length) {
    throw new Incomplete(`read ${shas.size} distinct of ${pr.commits} commits`);
  }
  if (!shas.has(pr.head.sha)) throw new Incomplete('the commit set does not contain the head commit');
  return { pr, commits };
}

async function readComments(api, repo, number) {
  const comments = await api.paginate(`/repos/${repo}/issues/${number}/comments`);
  const issue = await api.get(`/repos/${repo}/issues/${number}`);
  if (issue.comments !== comments.length)
    throw new Incomplete(`read ${comments.length} of ${issue.comments} PR comments`);
  return comments;
}

const validRecord = (r) =>
  Number.isSafeInteger(r?.github_id) && typeof r.version === 'string' && typeof r.sha256 === 'string';

/** The signature store; `sha: null` when the branch doesn't exist yet. Anything unreadable fails closed. */
export async function readStore(api, repo) {
  const ref = await api.request('GET', `/repos/${repo}/git/ref/heads/${STORE.branch}`, undefined, [404]);
  if (ref.status === 404) return { records: [], sha: null };
  const file = await api.get(`/repos/${repo}/contents/${STORE.path}?ref=${ref.data.object.sha}`);
  const bytes = file?.encoding === 'base64' ? Buffer.from(file.content, 'base64') : null;
  if (!bytes || bytes.length !== file.size) throw new Incomplete('the signature store could not be read completely');
  let records;
  try {
    ({ records } = JSON.parse(bytes.toString('utf8')));
  } catch {
    throw new Incomplete('the signature store is not valid JSON');
  }
  if (!Array.isArray(records) || !records.every(validRecord)) throw new Incomplete('the signature store is malformed');
  return { records, sha: file.sha };
}

const sameSignature = (a, b) => a.github_id === b.github_id && a.version === b.version && a.sha256 === b.sha256;

/** Appends records (optimistic concurrency on the file's blob SHA); never rewrites existing ones. */
export async function appendRecords(api, repo, records, number) {
  for (let attempt = 1; ; attempt++) {
    const store = await readStore(api, repo);
    const fresh = records.filter((r) => !store.records.some((s) => sameSignature(s, r)));
    if (fresh.length === 0) return;
    const content = `${JSON.stringify({ records: [...store.records, ...fresh] }, null, 2)}\n`;
    const message = `chore: record CLA signatures from #${number}`;
    let response;
    if (store.sha === null) {
      const tree = await api.request('POST', `/repos/${repo}/git/trees`, {
        tree: [{ path: STORE.path, mode: '100644', type: 'blob', content }],
      });
      const commit = await api.request('POST', `/repos/${repo}/git/commits`, {
        message,
        tree: tree.data.sha,
        parents: [],
      });
      response = await api.request(
        'POST',
        `/repos/${repo}/git/refs`,
        { ref: `refs/heads/${STORE.branch}`, sha: commit.data.sha },
        [422],
      );
    } else {
      const body = { message, content: Buffer.from(content).toString('base64'), sha: store.sha, branch: STORE.branch };
      response = await api.request('PUT', `/repos/${repo}/contents/${STORE.path}`, body, [409, 422]);
    }
    if (response.status < 300) return;
    if (attempt >= 3) throw new Incomplete('the signature store kept changing; re-run the check');
  }
}

const findPrompt = (comments) => comments.find((c) => c.user?.id === IDS.actionsBot && c.body?.startsWith(MARKER));

const mention = (account) => (LOGIN.test(account.login ?? '') ? `@${account.login}` : `account ${account.id}`);

/** Reads everything, decides, and returns the verdict plus the signature records to append. No writes. */
export async function evaluate({ api, repo, number, cla, claUrl, sleep, ctx = {} }) {
  const { pr, commits } = await retry(() => readCommitSet(api, repo, number, ctx), sleep);
  const verdict = (state, description, extra) => ({
    head: pr.head.sha,
    state,
    description,
    problems: [],
    missing: [],
    records: [],
    ...extra,
  });

  // 1. Attribution of every commit, before any exemption or stored signature is considered.
  const problems = [];
  const accounts = new Map();
  for (const commit of commits) {
    const { account, problem } = attribute(commit);
    if (problem) problems.push(`commit ${commit.sha.slice(0, 7)}: ${problem}`);
    else accounts.set(account.id, account);
  }
  if (problems.length > 0) {
    // Comments are read only to find the prompt to update, never for assent.
    const prompt =
      cla.status === 'final' ? findPrompt(await retry(() => readComments(api, repo, number), sleep)) : undefined;
    return verdict('failure', `${problems.length} commit(s) can't be attributed to a GitHub account`, {
      problems,
      prompt,
    });
  }
  // 2. Exemptions per account ID. The opener is one more account to check, never a reason to exempt commits.
  accounts.set(pr.user.id, { id: pr.user.id, login: pr.user.login });
  const required = [...accounts.values()].filter((account) => !cla.exempt.has(account.id));
  const assertHead = async () => {
    const now = await api.get(`/repos/${repo}/pulls/${number}`);
    if (now.head.sha !== pr.head.sha || now.commits !== pr.commits)
      throw new Incomplete('the head moved during the check');
  };
  if (cla.status === 'draft') {
    await assertHead();
    if (required.length > 0) return verdict('failure', NOT_IN_FORCE, { missing: required });
    return verdict('success', 'Only exempt accounts (CLA not yet in force)');
  }

  // 3. Signatures: stored records for this exact version and hash, else a signing comment by the account itself.
  const store = await readStore(api, repo);
  const comments = await retry(() => readComments(api, repo, number), sleep);
  const signed = new Set(
    store.records.filter((r) => r.version === cla.version && r.sha256 === cla.sha256).map((r) => r.github_id),
  );
  const records = [];
  for (const account of required) {
    if (signed.has(account.id)) continue;
    const comment = comments.find((c) => c.user?.id === account.id && isSignature(c.body, cla));
    if (!comment) continue;
    signed.add(account.id);
    records.push({
      github_id: account.id,
      login: account.login,
      version: cla.version,
      sha256: cla.sha256,
      cla_url: claUrl,
      pull_request: number,
      comment_url: comment.html_url,
      signed_at: comment.created_at,
    });
  }
  const missing = required.filter((account) => !signed.has(account.id));
  await assertHead();
  const prompt = findPrompt(comments);
  if (missing.length > 0) {
    return verdict('failure', `${missing.length} account(s) must sign CLA ${cla.version}`, {
      missing,
      records,
      prompt,
    });
  }
  return verdict('success', `All required accounts signed CLA ${cla.version}`, { records, prompt });
}

export function promptBody(result, cla, claUrl) {
  const link = `[Enduva CLA version ${cla.version}](${claUrl}) (sha256 \`${cla.sha256}\`)`;
  if (result.state === 'success') return `${MARKER}\nAll required accounts have signed the ${link}. Thank you!\n`;
  const lines = [MARKER, '### Contributor License Agreement', ''];
  if (result.problems.length > 0) {
    lines.push(
      "These commits must be signed by their author with a key on the author's GitHub account (see CONTRIBUTING.md):",
      '',
      ...result.problems.map((p) => `- ${p}`),
    );
  } else {
    lines.push(
      `Before this pull request can be merged, ${result.missing.map(mention).join(', ')} must sign the ${link}.`,
      '',
      'Each account signs by posting this comment from its own account, exactly as written:',
      '',
      '```text',
      phrase(cla),
      '```',
      '',
      'The check runs again on every new comment.',
    );
  }
  return `${lines.join('\n')}\n`;
}

async function updatePrompt(api, repo, number, result, cla, claUrl) {
  const body = promptBody(result, cla, claUrl);
  if (result.prompt) {
    if (result.prompt.body !== body)
      await api.request('PATCH', `/repos/${repo}/issues/comments/${result.prompt.id}`, { body });
  } else if (result.state !== 'success') {
    await api.request('POST', `/repos/${repo}/issues/${number}/comments`, { body });
  }
}

/** Evaluates each PR, applies the writes and sets the `cla` status on the evaluated head. */
export async function run({ api, repo, numbers, cla, links, sleep, report = () => {} }) {
  const errors = [];
  for (const number of numbers) {
    const ctx = {};
    let result;
    try {
      result = await evaluate({ api, repo, number, cla, claUrl: links.cla, sleep, ctx });
      if (result.records.length > 0) await appendRecords(api, repo, result.records, number);
      if (cla.status === 'final') await updatePrompt(api, repo, number, result, cla, links.cla);
    } catch (error) {
      if (!ctx.head) {
        errors.push(`#${number}: ${error.message}`);
        continue;
      }
      result = {
        head: ctx.head,
        state: 'failure',
        description: `Failed closed: ${error.message}`,
        problems: [],
        missing: [],
      };
    }
    await api.request('POST', `/repos/${repo}/statuses/${result.head}`, {
      state: result.state,
      context: CONTEXT,
      description: result.description.slice(0, 140),
      target_url: cla.status === 'final' ? links.cla : links.contributing,
    });
    report(number, result);
  }
  if (errors.length > 0) throw new Error(`no status could be set for ${errors.join('; ')}`);
}

async function prNumbers(api, repo, eventName, event) {
  if (eventName === 'pull_request_target') return [event.pull_request.number];
  if (eventName === 'issue_comment') return event.issue.pull_request ? [event.issue.number] : [];
  if (eventName === 'push')
    return (await api.paginate(`/repos/${repo}/pulls?state=open&base=main`)).map((pr) => pr.number);
  throw new Error(`unsupported event ${eventName}`);
}

async function main(args) {
  const claBytes = readFileSync('CLA.md');
  if (args[0] === '--hash') return console.log(sha256(claBytes));
  const cla = parseConfig(JSON.parse(readFileSync('.github/cla.json', 'utf8')), claBytes);
  const dryRun = args[0] === '--dry-run';
  const repo = dryRun ? args[1] : process.env.GITHUB_REPOSITORY;
  const base = dryRun
    ? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    : process.env.GITHUB_SHA;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[0-9a-f]{40}$/.test(base ?? ''))
    throw new Error('repository or base SHA missing');
  const api = createApi({ token: process.env.GITHUB_TOKEN, dryRun });
  const numbers = dryRun
    ? [Number(args[2])]
    : await prNumbers(
        api,
        repo,
        process.env.GITHUB_EVENT_NAME,
        JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
      );
  if (!numbers.every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error('invalid pull request number');
  // Immutable links: the commit whose CLA.md was hashed above.
  const links = {
    cla: `https://github.com/${repo}/blob/${base}/CLA.md`,
    contributing: `https://github.com/${repo}/blob/${base}/CONTRIBUTING.md#licence-and-cla`,
  };
  const report = (number, result) => {
    const lines = [
      `#${number} @ ${result.head}: ${result.state}: ${result.description}`,
      ...result.problems.map((p) => `- ${p}`),
    ];
    if (result.missing.length > 0) lines.push(`- needs: ${result.missing.map(mention).join(', ')}`);
    console.log(lines.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n\n`);
  };
  await run({
    api,
    repo,
    numbers,
    cla,
    links,
    report,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`cla-check: ${error.message}`);
    process.exitCode = 1;
  });
}
