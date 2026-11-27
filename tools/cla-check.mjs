// CLA check (roadmap task 0.5, decision T24): a small first-party workflow script instead of a
// third-party CLA action. .github/workflows/cla.yml runs it from the base branch. It never checks out
// or runs PR code: it reads PRs through the GitHub API and sets the commit status `cla` on head SHAs.
//
// Two steps per workflow run:
// - `plan` maps the event to the head SHAs it affects. Before anything is evaluated it replaces the
//   status of a head that a PR joins (opened, reopened, pushed to, retargeted to main) with `pending`,
//   so a PR never keeps a success it inherited from another PR with the same head. On a CLA policy
//   change, on a schedule and on demand it reconciles every open head: a success made with another
//   policy, or one that doesn't name every open PR on its head, is set to `pending` first.
// - `settle` (one job per head, serialized per head SHA by the workflow) evaluates every open PR to
//   `main` with that head against the policy on `main`, and posts one verdict for all of them. It
//   re-reads the PRs and the policy before posting and posts only if nothing changed; after posting a
//   success it checks again and replaces the success if something did.
//
// Shared heads: a commit status belongs to a SHA, not to a PR, and GitHub offers no per-PR check a
// ruleset can require on a personal-account repo. Every open PR to `main` with that head shares the
// one `cla` status, so it is success only if each of them passes; its description names those PRs
// and the policy it was made with ("[<tag>]"), which makes stale or inherited successes detectable.
//
// Policy: CLA.md, .github/cla.json and .github/cla-approvers, read from `main` through the API at
// evaluation time. While `status` is "draft", no signatures are collected, and a PR passes only if
// every commit author and the PR opener are exempt accounts. "final" (an owner-only change, see
// CONTRIBUTING.md) pins the CLA version and the SHA-256 of CLA.md. A PR that changes the policy or
// this check (PROTECTED) passes only if its head commit carries the owner's approval signature, made
// with a key listed in .github/cla-approvers.
//
// Rules (roadmap row 0.5):
// - One complete commit set for the evaluated revisions: the comparison of the PR's base and head
//   SHAs (immutable), every page read, its count equal to the PR's commit count, the head included.
// - A commit counts for account X only if GitHub links its author to X and verifies its signature
//   with X as committer, or with GitHub's own web-flow as committer when X opened the PR. A git name
//   or email alone is never trusted.
// - Every commit's attribution is checked first. Only then are exemptions (account IDs, per commit)
//   and signatures applied. The PR opener must be exempt or have signed too.
// - A signature is an unedited PR comment by that same account whose whole body is the phrase for
//   this version and hash. Records on the `cla-signatures` branch point to such a comment and count
//   only if that comment still is one, so the store can't create assent on its own.
// - Anything incomplete or inconsistent (pagination, counts, moved revisions, unreadable store or
//   policy) fails closed.
//
// Usage: node tools/cla-check.mjs plan                       (workflow: GITHUB_* env, writes heads=)
//        node tools/cla-check.mjs settle                     (workflow: CLA_HEAD)
//        node tools/cla-check.mjs --dry-run <owner/repo> <pr> (GITHUB_TOKEN; local policy, no writes)
//        node tools/cla-check.mjs --hash                     (SHA-256 of CLA.md for .github/cla.json)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONTEXT = 'cla';
export const STORE = { branch: 'cla-signatures', path: 'signatures.json' };
export const IDS = { actionsBot: 41898282, webFlow: 19864447 };
export const POLICY_FILES = { cla: 'CLA.md', config: '.github/cla.json', approvers: '.github/cla-approvers' };
/** Files that define the gate. A PR changing one needs the owner's approval signature on its head. */
export const PROTECTED = [
  /^CLA\.md$/,
  /^\.github\/cla\.json$/,
  /^\.github\/cla-approvers$/,
  /^\.github\/CODEOWNERS$/,
  /^\.github\/workflows\/cla\.yml$/,
  /^\.github\/rulesets\//,
  /^tools\/cla-check(\.test)?\.mjs$/,
];
/** Every signing phrase starts with this; the workflow starts no run for other comments. */
export const SIGNING_PREFIX = 'I have read and agree to the Enduva CLA';
export const CAPPED = 'Too many cla status updates for this head: push a new commit to re-run';
const MARKER = '<!-- enduva-cla-check -->';
const NOT_IN_FORCE = 'CLA not yet in force: external contributions are not accepted';
// More commits than this can't be listed completely by GitHub's PR endpoints; such a PR fails closed.
const MAX_PR_COMMITS = 250;
// The comparison lists at most 300 changed files, so a longer list may be truncated.
const MAX_FILES = 300;
const MAX_PAGES = 50;
// Rounds per head before giving up on a group of PRs (or a policy) that keeps changing.
const MAX_ROUNDS = 3;
// GitHub keeps at most 1000 statuses per SHA and context; stop well before that.
export const MAX_STATUSES = 900;
// A workflow matrix has at most 256 jobs.
const MAX_HEADS = 256;
const BASE = 'main';
const SHA = /^[0-9a-f]{40}$/;
const LOGIN = /^[A-Za-z0-9-]{1,39}(\[bot\])?$/;

/** Completeness or consistency couldn't be established. The check fails closed. */
export class Incomplete extends Error {}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const phrase = (cla) => `${SIGNING_PREFIX} version ${cla.version}, sha256 ${cla.sha256}.`;

/** The whole comment must be the phrase: no substring match, only line endings and outer whitespace normalised. */
export const isSignature = (body, cla) =>
  typeof body === 'string' && body.replace(/\r\n?/g, '\n').trim() === phrase(cla);

/** A comment nobody (the author or a moderator) has edited since it was posted. */
const unedited = (comment) => typeof comment?.created_at === 'string' && comment.updated_at === comment.created_at;

/** Validates .github/cla.json against the CLA.md bytes and the approver keys of the same commit. */
export function parseConfig(config, claBytes, approvers = '') {
  const fail = (message) => {
    throw new Error(`.github/cla.json: ${message}`);
  };
  if (config?.status !== 'draft' && config?.status !== 'final') fail('status must be "draft" or "final"');
  if (!Array.isArray(config.exempt)) fail('exempt must be a list');
  const exempt = new Map();
  for (const entry of config.exempt) {
    if (!Number.isSafeInteger(entry?.id) || entry.id <= 0 || typeof entry.login !== 'string') {
      fail('every exempt entry needs a numeric GitHub account id and a login');
    }
    exempt.set(entry.id, entry.login);
  }
  const base = { exempt, approvers };
  if (config.status === 'draft') return { status: 'draft', ...base };
  if (typeof config.version !== 'string' || !/^\d+(\.\d+)*$/.test(config.version)) {
    fail('a final version must look like "1.0"');
  }
  if (typeof config.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(config.sha256)) {
    fail('sha256 must be 64 lowercase hex digits');
  }
  if (sha256(claBytes) !== config.sha256) {
    fail('sha256 does not match CLA.md: a changed CLA needs a new version and hash');
  }
  const text = claBytes.toString('utf8');
  if (/not yet in force|\bDRAFT\b|-draft\b/i.test(text)) fail('CLA.md is still marked as a draft');
  const markers = [...text.matchAll(/^Version (\S+)[ \t]*\r?$/gm)].map((m) => m[1]);
  if (markers.length !== 1 || markers[0] !== config.version) {
    fail(`CLA.md must contain exactly one "Version ${config.version}" line, found: ${markers.join(', ') || 'none'}`);
  }
  return { status: 'final', version: config.version, sha256: config.sha256, ...base };
}

/** The policy's fingerprint, part of every verdict so that a verdict made with another policy is detectable. */
export const policyTag = (files) =>
  sha256(Buffer.concat([files.cla, Buffer.from('\0'), files.config, Buffer.from('\0'), files.approvers])).slice(0, 10);

/** The policy of one commit: its CLA files, the parsed config and immutable links to that commit. */
export function makePolicy(files, repo, ref) {
  const config = parseConfig(JSON.parse(files.config.toString('utf8')), files.cla, files.approvers.toString('utf8'));
  return {
    ...config,
    ref,
    tag: policyTag(files),
    links: {
      cla: `https://github.com/${repo}/blob/${ref}/CLA.md`,
      contributing: `https://github.com/${repo}/blob/${ref}/CONTRIBUTING.md#licence-and-cla`,
    },
  };
}

async function mainRef(api, repo) {
  const ref = await api.get(`/repos/${repo}/git/ref/heads/${BASE}`);
  if (!SHA.test(ref?.object?.sha ?? '')) throw new Incomplete(`could not read the ${BASE} branch`);
  return ref.object.sha;
}

function decode(file, path) {
  const bytes = file?.encoding === 'base64' ? Buffer.from(file.content, 'base64') : null;
  if (!bytes || bytes.length !== file.size) throw new Incomplete(`${path} could not be read completely`);
  return bytes;
}

async function readPolicyFiles(api, repo, ref) {
  const files = {};
  for (const [key, path] of Object.entries(POLICY_FILES)) {
    const allow = key === 'approvers' ? [404] : [];
    const response = await api.request('GET', `/repos/${repo}/contents/${path}?ref=${ref}`, undefined, allow);
    files[key] = response.status === 404 ? Buffer.alloc(0) : decode(response.data, path);
  }
  return files;
}

/** The policy on `main`: `load()` reads it at the current tip, `current(policy)` says whether main still has it. */
export function mainPolicy(api, repo) {
  return {
    async load() {
      const ref = await mainRef(api, repo);
      return makePolicy(await readPolicyFiles(api, repo, ref), repo, ref);
    },
    async current(policy) {
      try {
        const ref = await mainRef(api, repo);
        return ref === policy.ref || policyTag(await readPolicyFiles(api, repo, ref)) === policy.tag;
      } catch {
        return false;
      }
    },
  };
}

/** Whether `commit`'s signature was made with a key in `approvers` (ssh-keygen allowed_signers format). */
export function signedByApprover(commit, approvers) {
  const { signature, payload } = commit?.commit?.verification ?? {};
  const keys = approvers.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
  if (keys.length === 0 || typeof payload !== 'string') return false;
  if (typeof signature !== 'string' || !signature.startsWith('-----BEGIN SSH SIGNATURE-----')) return false;
  const dir = mkdtempSync(join(tmpdir(), 'cla-approval-'));
  try {
    const signers = join(dir, 'allowed_signers');
    const sig = join(dir, 'commit.sig');
    writeFileSync(signers, `${keys.join('\n')}\n`);
    writeFileSync(sig, signature);
    const quiet = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] };
    let principals;
    try {
      principals = execFileSync('ssh-keygen', ['-Y', 'find-principals', '-f', signers, '-s', sig], quiet);
    } catch {
      return false;
    }
    return principals
      .split('\n')
      .filter(Boolean)
      .some((principal) => {
        try {
          execFileSync('ssh-keygen', ['-Y', 'verify', '-f', signers, '-I', principal, '-n', 'git', '-s', sig], {
            ...quiet,
            input: payload,
          });
          return true;
        } catch {
          return false;
        }
      });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The account a commit is attributed to, or why it can't be attributed. */
export function attribute(commit, opener) {
  const { author, committer } = commit;
  if (!Number.isSafeInteger(author?.id)) return { problem: 'its author is not linked to a GitHub account' };
  if (commit.commit?.verification?.verified !== true) {
    return { problem: 'its signature is not verified by GitHub' };
  }
  const account = { account: { id: author.id, login: author.login } };
  if (committer?.id === author.id) return account;
  if (committer?.id === IDS.webFlow) {
    // GitHub signs web and API commits itself; that only shows who was signed in for the PR opener.
    if (author.id === opener.id) return account;
    return { problem: 'GitHub signed it (web-flow) for another account than the one that opened the PR' };
  }
  return { problem: 'it was committed by another account than its author' };
}

/**
 * Pagination on top of a `request(method, path, body, allow)` that returns `{ status, data, link }`:
 * `pages` follows `Link: rel="next"` (the client refuses other origins), `paginate` joins list pages.
 */
export function clientFrom(request) {
  async function* pages(path) {
    let next = `${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    for (let page = 1; next; page++) {
      if (page > MAX_PAGES) throw new Incomplete(`${path}: more than ${MAX_PAGES} pages`);
      const { data, link } = await request('GET', next);
      yield data;
      next = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
  }
  return {
    request,
    pages,
    get: async (path) => (await request('GET', path)).data,
    async paginate(path) {
      const items = [];
      for await (const data of pages(path)) {
        if (!Array.isArray(data)) throw new Incomplete(`${path}: a page is not a list`);
        items.push(...data);
      }
      return items;
    },
  };
}

/** Minimal REST client: errors throw, requests stay on the API origin, a dry run sends no writes. */
export function createApi({
  token,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.github.com',
  dryRun = false,
  log = console.log,
}) {
  const origin = new URL(baseUrl).origin;
  return clientFrom(async (method, path, body, allow = []) => {
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
  });
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

const clip = (text) => text.slice(0, 140);

/** The revisions and facts of a PR one evaluation is bound to. */
const snapshot = (pr) => ({
  number: pr.number,
  state: pr.state,
  baseRef: pr.base?.ref,
  base: pr.base?.sha,
  head: pr.head?.sha,
  commits: pr.commits,
  user: { id: pr.user?.id, login: pr.user?.login },
});
const key = (pr) => JSON.stringify([pr.number, pr.state, pr.baseRef, pr.base, pr.head, pr.commits, pr.user.id]);
const inGroup = (pr, sha) => pr.state === 'open' && pr.baseRef === BASE && pr.head === sha && SHA.test(pr.base ?? '');

/** The complete commit set and changed files between the PR's base and head SHAs (immutable revisions). */
async function readCommitSet(api, repo, pr) {
  if (pr.commits > MAX_PR_COMMITS) {
    throw new Incomplete(`the PR has more than ${MAX_PR_COMMITS} commits, which the API can't list completely`);
  }
  let total = null;
  let files = null;
  const commits = [];
  for await (const page of api.pages(`/repos/${repo}/compare/${pr.base}...${pr.head}`)) {
    if (!Array.isArray(page?.commits) || !Number.isSafeInteger(page.total_commits)) {
      throw new Incomplete('the comparison of base and head is malformed');
    }
    if (total === null) [total, files] = [page.total_commits, page.files];
    else if (page.total_commits !== total) throw new Incomplete('the comparison changed between pages');
    commits.push(...page.commits);
  }
  const shas = new Set(commits.map((commit) => commit.sha));
  if (commits.length !== total || shas.size !== total)
    throw new Incomplete(`read ${shas.size} distinct of ${total} commits`);
  if (total !== pr.commits)
    throw new Incomplete(`the PR reports ${pr.commits} commits, its base and head differ by ${total}`);
  if (!shas.has(pr.head)) throw new Incomplete('the commit set does not contain the head commit');
  if (!Array.isArray(files) || files.length >= MAX_FILES)
    throw new Incomplete('the changed files could not be listed completely');
  return { commits, files };
}

const touchedPolicy = (files) =>
  [...new Set(files.flatMap((f) => [f.filename, f.previous_filename]).filter((path) => typeof path === 'string'))]
    .filter((path) => PROTECTED.some((pattern) => pattern.test(path)))
    .sort();

async function readComments(api, repo, number) {
  const comments = await api.paginate(`/repos/${repo}/issues/${number}/comments`);
  const issue = await api.get(`/repos/${repo}/issues/${number}`);
  if (issue.comments !== comments.length)
    throw new Incomplete(`read ${comments.length} of ${issue.comments} PR comments`);
  return comments;
}

const validRecord = (r) =>
  Number.isSafeInteger(r?.github_id) &&
  Number.isSafeInteger(r.comment_id) &&
  typeof r.version === 'string' &&
  typeof r.sha256 === 'string';

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

/** A stored record counts only while the comment it points to is still an unedited signing comment by that account. */
async function hasEvidence(api, repo, record, cla) {
  const response = await api.request('GET', `/repos/${repo}/issues/comments/${record.comment_id}`, undefined, [404]);
  const comment = response.status === 404 ? null : response.data;
  return comment?.user?.id === record.github_id && unedited(comment) && isSignature(comment.body, cla);
}

/** Appends records (optimistic concurrency on the file's blob SHA); never rewrites existing ones. */
export async function appendRecords(api, repo, records, number) {
  for (let attempt = 1; ; attempt++) {
    const store = await readStore(api, repo);
    const fresh = records.filter((r) => !store.records.some((s) => s.comment_id === r.comment_id));
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
      // 422: another run created the branch first; the next attempt appends to it.
      response = await api.request(
        'POST',
        `/repos/${repo}/git/refs`,
        { ref: `refs/heads/${STORE.branch}`, sha: commit.data.sha },
        [422],
      );
    } else {
      const body = { message, content: Buffer.from(content).toString('base64'), sha: store.sha, branch: STORE.branch };
      // 409/422: the file changed since it was read; the next attempt re-reads it.
      response = await api.request('PUT', `/repos/${repo}/contents/${STORE.path}`, body, [409, 422]);
    }
    if (response.status < 300) return;
    if (attempt >= 3) throw new Incomplete('the signature store kept changing; re-run the check');
  }
}

const findPrompt = (comments) => comments.find((c) => c.user?.id === IDS.actionsBot && c.body?.startsWith(MARKER));

const mention = (account) => (LOGIN.test(account.login ?? '') ? `@${account.login}` : `account ${account.id}`);

/** Reads everything for one PR snapshot, decides, and returns the verdict plus the records to append. No writes. */
export async function evaluate({ api, repo, pr, policy, sleep }) {
  const { number } = pr;
  const final = policy.status === 'final';
  const { commits, files } = await retry(() => readCommitSet(api, repo, pr), sleep);
  const verdict = (state, description, extra) => ({
    number,
    state,
    description,
    problems: [],
    guarded: [],
    missing: [],
    records: [],
    ...extra,
  });
  // Comments are read for the prompt only here, never for assent.
  const promptOnly = async () =>
    final ? findPrompt(await retry(() => readComments(api, repo, number), sleep)) : undefined;

  // 1. Attribution of every commit, before any exemption or stored signature is considered.
  const problems = [];
  const accounts = new Map();
  for (const commit of commits) {
    const { account, problem } = attribute(commit, pr.user);
    if (problem) problems.push(`commit ${commit.sha.slice(0, 7)}: ${problem}`);
    else accounts.set(account.id, account);
  }
  if (problems.length > 0) {
    return verdict('failure', `${problems.length} commit(s) can't be attributed to a GitHub account`, {
      problems,
      prompt: await promptOnly(),
    });
  }
  // 2. A change to the gate itself needs the owner's approval signature on the exact head.
  const guarded = touchedPolicy(files);
  if (
    guarded.length > 0 &&
    !signedByApprover(
      commits.find((c) => c.sha === pr.head),
      policy.approvers,
    )
  ) {
    return verdict('failure', "Changes the CLA check or policy without the owner's approval signature", {
      guarded,
      prompt: await promptOnly(),
    });
  }
  // 3. Exemptions per account ID. The opener is one more account to check, never a reason to exempt commits.
  accounts.set(pr.user.id, pr.user);
  const required = [...accounts.values()].filter((account) => !policy.exempt.has(account.id));
  if (!final) {
    if (required.length > 0) return verdict('failure', NOT_IN_FORCE, { missing: required });
    return verdict('success', 'Only exempt accounts (CLA not yet in force)');
  }

  // 4. Signatures: an unedited signing comment on this PR, else a stored record whose comment still is one.
  const comments = await retry(() => readComments(api, repo, number), sleep);
  const store = await readStore(api, repo);
  const signed = new Set();
  const records = [];
  for (const account of required) {
    const comment = comments.find((c) => c.user?.id === account.id && unedited(c) && isSignature(c.body, policy));
    if (comment) {
      signed.add(account.id);
      records.push({
        github_id: account.id,
        login: account.login,
        version: policy.version,
        sha256: policy.sha256,
        cla_url: policy.links.cla,
        pull_request: number,
        comment_id: comment.id,
        comment_url: comment.html_url,
        signed_at: comment.created_at,
      });
      continue;
    }
    for (const record of store.records) {
      if (record.github_id !== account.id || record.version !== policy.version || record.sha256 !== policy.sha256) {
        continue;
      }
      if (await hasEvidence(api, repo, record, policy)) {
        signed.add(account.id);
        break;
      }
    }
  }
  const missing = required.filter((account) => !signed.has(account.id));
  const prompt = findPrompt(comments);
  if (missing.length > 0) {
    return verdict('failure', `${missing.length} account(s) must sign CLA ${policy.version}`, {
      missing,
      records,
      prompt,
    });
  }
  return verdict('success', `All required accounts signed CLA ${policy.version}`, { records, prompt });
}

export function promptBody(result, policy, blockers = []) {
  const link = `[Enduva CLA version ${policy.version}](${policy.links.cla}) (sha256 \`${policy.sha256}\`)`;
  if (result.state === 'success' && blockers.length > 0) {
    return (
      `${MARKER}\nAll required accounts of this pull request have signed the ${link}. ` +
      'The `cla` status is shared by every open pull request with the same head commit, so it stays red until ' +
      `each of these passes or is closed: ${blockers.map((n) => `#${n}`).join(', ')}.\n`
    );
  }
  if (result.state === 'success') return `${MARKER}\nAll required accounts have signed the ${link}. Thank you!\n`;
  const lines = [MARKER, '### Contributor License Agreement', ''];
  if (result.problems.length > 0) {
    lines.push(
      "These commits must be signed by their author with a key on the author's GitHub account (see CONTRIBUTING.md):",
      '',
      ...result.problems.map((p) => `- ${p}`),
    );
  } else if (result.guarded.length > 0) {
    lines.push(
      `This pull request changes the CLA check or policy (${result.guarded.map((p) => `\`${p}\``).join(', ')}).`,
      'It passes only when its head commit is signed with an owner approval key from `.github/cla-approvers` (see CONTRIBUTING.md).',
    );
  } else {
    lines.push(
      `Before this pull request can be merged, ${result.missing.map(mention).join(', ')} must sign the ${link}.`,
      '',
      'Each account signs by posting this comment from its own account, exactly as written:',
      '',
      '```text',
      phrase(policy),
      '```',
      '',
      'The check runs again when a signing comment is posted. Edited comments do not count: post a new one instead.',
    );
  }
  return `${lines.join('\n')}\n`;
}

async function updatePrompt(api, repo, result, policy, blockers) {
  const body = promptBody(result, policy, blockers);
  if (result.prompt) {
    if (result.prompt.body !== body)
      await api.request('PATCH', `/repos/${repo}/issues/comments/${result.prompt.id}`, { body });
  } else if (result.state !== 'success' || blockers.length > 0) {
    await api.request('POST', `/repos/${repo}/issues/${result.number}/comments`, { body });
  }
}

/** The `cla` statuses this workflow set on `sha`, newest first. Statuses from other sources can't satisfy the ruleset. */
export async function readStatuses(api, repo, sha) {
  const all = await api.paginate(`/repos/${repo}/commits/${sha}/statuses`);
  return all.filter((s) => s.context === CONTEXT && s.creator?.id === IDS.actionsBot);
}

/** Posts a status unless the latest one already says the same; near GitHub's per-SHA limit only a final failure. */
async function publish(api, repo, sha, { state, description, target_url = null }) {
  const statuses = await readStatuses(api, repo, sha);
  const [latest] = statuses;
  const same = (s, d) => s && s.state === state && s.description === d && (s.target_url ?? null) === target_url;
  if (same(latest, description)) return 'unchanged';
  if (statuses.length >= MAX_STATUSES) {
    if (latest?.state === 'failure' && latest.description === CAPPED) return 'capped';
    await api.request('POST', `/repos/${repo}/statuses/${sha}`, {
      context: CONTEXT,
      state: 'failure',
      description: CAPPED,
    });
    return 'capped';
  }
  const body = { context: CONTEXT, state, description: clip(description) };
  if (target_url) body.target_url = target_url;
  await api.request('POST', `/repos/${repo}/statuses/${sha}`, body);
  return 'written';
}

/** Replaces a success on `sha` by `pending` (with `always`, any status), so no stale success stays behind. */
async function invalidate(api, repo, sha, reason, { always = false } = {}) {
  if (!always) {
    const [latest] = await readStatuses(api, repo, sha);
    if (latest?.state !== 'success') return;
  }
  await publish(api, repo, sha, { state: 'pending', description: `Re-evaluating: ${reason}` });
}

const tagOf = (description) => description?.match(/ \[([0-9a-f]{10})\]$/)?.[1] ?? null;
/** The PRs a success names, or null if it names only their number. */
const coveredBy = (description) =>
  description
    ?.match(/: ((?:#\d+, )*#\d+) \[[0-9a-f]{10}\]$/)?.[1]
    .split(', ')
    .map((n) => Number(n.slice(1))) ?? null;

/**
 * Open PRs to main whose head is `sha`, each re-read on its own: those the open list shows plus those
 * a recent `pending` status names (a PR that just joined the head and that the list doesn't show yet).
 */
async function readGroup(api, repo, sha, statuses) {
  const open = await api.paginate(`/repos/${repo}/pulls?state=open&base=${BASE}`);
  const candidates = new Set(open.filter((pr) => pr.head?.sha === sha).map((pr) => pr.number));
  for (const status of statuses.slice(0, 100)) {
    if (status.state !== 'pending') continue;
    for (const [, n] of status.description.matchAll(/#(\d+)/g)) candidates.add(Number(n));
  }
  const group = [];
  for (const number of [...candidates].sort((a, b) => a - b)) {
    const response = await api.request('GET', `/repos/${repo}/pulls/${number}`, undefined, [404]);
    if (response.status === 404) continue;
    const pr = snapshot(response.data);
    if (inGroup(pr, sha)) group.push(pr);
  }
  return group;
}

/** One verdict for the shared status: success only if every PR of the group passes on its own. */
function combine(sha, results, policy) {
  const failing = results.filter((r) => r.state !== 'success');
  const suffix = ` [${policy.tag}]`;
  let text;
  if (failing.length === 0) {
    text = `${results[0].description}: ${results.map((r) => `#${r.number}`).join(', ')}`;
    if (text.length + suffix.length > 140) text = `${results[0].description}: ${results.length} PRs`;
  } else {
    const [first] = failing;
    text = results.length === 1 ? first.description : `#${first.number}: ${first.description}`;
    if (failing.length > 1) text += ` (+${failing.length - 1} more PRs)`;
  }
  return {
    head: sha,
    state: failing.length === 0 ? 'success' : 'failure',
    description: `${text.slice(0, 140 - suffix.length)}${suffix}`,
    target_url: policy.status === 'final' ? policy.links.cla : policy.links.contributing,
    results,
  };
}

const failedClosed = (number, error) => ({
  number,
  state: 'failure',
  description: `Failed closed: ${error.message}`,
  problems: [],
  guarded: [],
  missing: [],
  records: [],
  incomplete: true,
});

/** Signature records and prompts, after a consistent evaluation; a failed write fails that PR closed. */
async function applyWrites(api, repo, results, policy) {
  for (const [i, result] of results.entries()) {
    if (result.records.length === 0) continue;
    try {
      await appendRecords(api, repo, result.records, result.number);
    } catch (error) {
      results[i] = failedClosed(result.number, error);
    }
  }
  if (policy.status !== 'final') return;
  const blockers = results.filter((r) => r.state !== 'success').map((r) => r.number);
  for (const [i, result] of results.entries()) {
    // A PR that failed closed may not have read its comments; it gets no prompt update.
    if (result.incomplete) continue;
    try {
      await updatePrompt(api, repo, result, policy, result.state === 'success' ? blockers : []);
    } catch (error) {
      results[i] = failedClosed(result.number, error);
    }
  }
}

/**
 * Settles the shared `cla` status of one head. The workflow runs at most one settle per head at a time.
 * Each round evaluates every PR of the group read at its start with the policy on main, re-reads both,
 * and posts only if neither changed; after a success it checks again and replaces it if one did.
 */
export async function settle({ api, repo, sha, source, sleep, report = () => {} }) {
  let policy = null;
  const failure = (description) => ({
    head: sha,
    state: 'failure',
    description: policy ? `${description.slice(0, 127)} [${policy.tag}]` : description,
    target_url: policy?.links.contributing,
    results: [],
  });
  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      policy = await source.load();
      const group = await readGroup(api, repo, sha, await readStatuses(api, repo, sha));
      if (group.length === 0) {
        report({ head: sha, state: 'none', description: 'no open PR to main has this head', results: [] });
        return null;
      }
      const results = [];
      for (const pr of group) {
        try {
          results.push(await evaluate({ api, repo, pr, policy, sleep }));
        } catch (error) {
          results.push(failedClosed(pr.number, error));
        }
      }
      const read = policy;
      const stable = async () => {
        if (!(await source.current(read))) return false;
        const now = await readGroup(api, repo, sha, await readStatuses(api, repo, sha));
        return now.map(key).join('\n') === group.map(key).join('\n');
      };
      const reason = 'the PRs with this head or the CLA policy changed during the check';
      if (!(await stable())) {
        await invalidate(api, repo, sha, reason);
        continue;
      }
      await applyWrites(api, repo, results, policy);
      const verdict = combine(sha, results, policy);
      await publish(api, repo, sha, verdict);
      if (verdict.state === 'success' && !(await stable())) {
        await invalidate(api, repo, sha, reason);
        continue;
      }
      report(verdict);
      return verdict;
    }
    const verdict = failure('Failed closed: the PRs with this head or the CLA policy kept changing');
    await publish(api, repo, sha, verdict);
    report(verdict);
    return verdict;
  } catch (error) {
    const verdict = failure(clip(`Failed closed: ${error.message}`));
    await publish(api, repo, sha, verdict).catch(() => {});
    report(verdict);
    throw error;
  }
}

/**
 * Every open head whose status isn't a current verdict: none, pending, made with another policy, or a
 * success that doesn't name every open PR on that head. A success among them is set to pending first.
 */
async function reconcile({ api, repo, source, heads, errors }) {
  const open = await api.paginate(`/repos/${repo}/pulls?state=open&base=${BASE}`);
  const byHead = new Map();
  for (const pr of open) {
    if (!SHA.test(pr.head?.sha ?? '')) continue;
    byHead.set(pr.head.sha, [...(byHead.get(pr.head.sha) ?? []), pr.number]);
  }
  let policy = null;
  let broken = null;
  try {
    policy = await source.load();
  } catch (error) {
    broken = error;
    errors.push(`the CLA policy on main can't be used: ${error.message}`);
  }
  for (const [sha, numbers] of byHead) {
    try {
      if (broken) {
        await publish(api, repo, sha, { state: 'failure', description: clip(`Failed closed: ${broken.message}`) });
        continue;
      }
      const [latest] = await readStatuses(api, repo, sha);
      const current = latest && latest.state !== 'pending' && tagOf(latest.description) === policy.tag;
      if (current && latest.state === 'failure') continue;
      if (current) {
        const covered = coveredBy(latest.description);
        if (covered?.length && numbers.every((n) => covered.includes(n))) continue;
        // A success that only counts its PRs can't be checked here: re-evaluate it without invalidating it.
        if (covered) await invalidate(api, repo, sha, 'not every PR with this head was checked', { always: true });
      } else if (latest?.state === 'success') {
        await invalidate(api, repo, sha, 'the CLA policy changed', { always: true });
      }
      heads.add(sha);
    } catch (error) {
      errors.push(`${sha}: ${error.message}`);
    }
  }
}

/**
 * Maps an event to the heads to settle. A PR joining a head sets it to pending first (always, so that
 * the pending status names the PR); a CLA policy change, the schedule and a dispatch without a PR
 * reconcile every open head. Errors are collected so that one failed write doesn't stop the others.
 */
export async function plan({ api, repo, eventName, event, source }) {
  const heads = new Set();
  const errors = [];
  const add = (sha) => {
    if (!SHA.test(sha ?? '')) throw new Error('no valid head SHA in the event');
    heads.add(sha);
  };
  if (eventName === 'pull_request_target') {
    const pr = event.pull_request;
    add(pr?.head?.sha);
    const joins = ['opened', 'reopened', 'synchronize', 'edited'].includes(event.action);
    if (joins && pr.state === 'open' && pr.base?.ref === BASE) {
      const what = event.action === 'edited' ? 'was retargeted to main' : event.action;
      try {
        await invalidate(api, repo, pr.head.sha, `#${pr.number} ${what}`, { always: true });
      } catch (error) {
        errors.push(`${pr.head.sha}: ${error.message}`);
      }
    }
    if (event.action === 'synchronize' && SHA.test(event.before ?? '')) heads.add(event.before);
  } else if (eventName === 'issue_comment') {
    // Only a signing comment by a required account can change a verdict; drop everything else.
    const { comment, issue } = event;
    if (!issue?.pull_request || !Number.isSafeInteger(comment?.user?.id)) return { heads: [], errors };
    const policy = await source.load();
    if (policy.status !== 'final' || !isSignature(comment.body, policy)) return { heads: [], errors };
    const pr = snapshot(await api.get(`/repos/${repo}/pulls/${issue.number}`));
    if (!inGroup(pr, pr.head)) return { heads: [], errors };
    if (comment.user.id !== pr.user.id) {
      const { commits } = await readCommitSet(api, repo, pr).catch(() => ({ commits: null }));
      if (commits && !commits.some((c) => c.author?.id === comment.user.id)) return { heads: [], errors };
    }
    add(pr.head);
  } else if (eventName === 'workflow_dispatch' && event.inputs?.pr) {
    const number = Number(event.inputs.pr);
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error('invalid pull request number');
    add((await api.get(`/repos/${repo}/pulls/${number}`)).head?.sha);
  } else if (['push', 'schedule', 'workflow_dispatch'].includes(eventName)) {
    await reconcile({ api, repo, source, heads, errors });
  } else {
    throw new Error(`unsupported event ${eventName}`);
  }
  const list = [...heads];
  if (list.length > MAX_HEADS) errors.push(`${list.length} heads, more than one run can settle; the rest follow`);
  return { heads: list.slice(0, MAX_HEADS), errors };
}

function reporter() {
  return (verdict) => {
    const lines = [`${verdict.head}: ${verdict.state}: ${verdict.description}`];
    for (const result of verdict.results) {
      lines.push(`- #${result.number}: ${result.state}: ${result.description}`);
      lines.push(...result.problems.map((p) => `  - ${p}`));
      if (result.guarded.length > 0) lines.push(`  - changes: ${result.guarded.join(', ')}`);
      if (result.missing.length > 0) lines.push(`  - needs: ${result.missing.map(mention).join(', ')}`);
    }
    console.log(lines.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n\n`);
  };
}

async function main(args) {
  if (args[0] === '--hash') return console.log(sha256(readFileSync(POLICY_FILES.cla)));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const report = reporter();
  if (args[0] === '--dry-run') {
    // A dry run uses the local policy, which may differ from main on purpose, and sends no writes.
    const [, repo, number] = args;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^\d+$/.test(number ?? ''))
      throw new Error('usage: --dry-run <owner/repo> <pr>');
    const api = createApi({ token: process.env.GITHUB_TOKEN, dryRun: true });
    const read = (path) => (existsSync(path) ? readFileSync(path) : Buffer.alloc(0));
    const files = Object.fromEntries(Object.entries(POLICY_FILES).map(([k, path]) => [k, read(path)]));
    const ref = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const policy = makePolicy(files, repo, ref);
    const sha = (await api.get(`/repos/${repo}/pulls/${number}`)).head.sha;
    await settle({ api, repo, sha, source: { load: async () => policy, current: async () => true }, sleep, report });
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('GITHUB_REPOSITORY missing');
  const api = createApi({ token: process.env.GITHUB_TOKEN });
  const source = mainPolicy(api, repo);
  if (args[0] === 'plan') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const { heads, errors } = await plan({ api, repo, eventName: process.env.GITHUB_EVENT_NAME, event, source });
    appendFileSync(process.env.GITHUB_OUTPUT, `heads=${JSON.stringify(heads)}\n`);
    console.log(`heads to settle: ${heads.join(', ') || 'none'}`);
    if (errors.length > 0) throw new Error(errors.join('; '));
    return;
  }
  if (args[0] === 'settle') {
    const sha = process.env.CLA_HEAD;
    if (!SHA.test(sha ?? '')) throw new Error('CLA_HEAD is not a commit SHA');
    await settle({ api, repo, sha, source, sleep, report });
    return;
  }
  throw new Error('usage: cla-check.mjs plan | settle | --dry-run <owner/repo> <pr> | --hash');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`cla-check: ${error.message}`);
    process.exitCode = 1;
  });
}
