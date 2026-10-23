// D143: from commits to the sessions that made them. `sonah sessions --commits A..B` lists the sessions that the range's
// `Agent-Session` lines name, `sonah review --commits A..B` reviews one of them, and `sonah sessions --github OWNER/REPO
// --pr N` lists those of a pull request's commits. Structure only:
//   - a range's lines are read with git alone, by allowlisted argv (COMMIT_SESSION_GIT_ARGS): git's own trailer reader,
//     and a scan for whole `Agent-Session:` lines, since a squash of several commits keeps the earlier lines as body
//     text, which git's reader does not read. Every id listed is a session id (D142's SESSION_ID_SHAPE, listed in lower
//     case) that appears in a message read; a value of the line that is none is counted, never listed;
//   - each id goes through D142's resolver (session-id.js `recordingsNamed`): the recordings whose file names carry it,
//     in one of COMMIT_RECORDING_STATES (one, several, one compressed, none);
//   - a commit is `shown` in that recording only when both facts hold: one tool call of the one plain recording (or of a
//     helper's recording under it) spans the commit's committer time, by the recording's own timestamps, and that call
//     ran in a folder of the same repository (the same git common dir); else `named` (the line names the session, and
//     Sonah could not show the commit in a recording here); else `not_here` (COMMIT_SESSION_LINKS). A line is a claim
//     anyone can type: these words say how far Sonah could check it, never that the session made the commit.
// A range's read makes no network call. A pull request's (`sessionsOfPullRequest`) reads that pull request and its
// commit list from GitHub, GET only, through github/reader.js and the client it is given; the rest of it reads git and
// the recordings only. No model; nothing is written.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { gitEnvironment, runGit } from './code-snapshot.js';
import { readPullRequestCommits } from '../../github/reader.js';
import { SESSION_ID_SHAPE, recordingsNamed } from './session-id.js';
import { COMMIT_RECORDING_STATES, COMMIT_SESSION_LINKS, COMMITS_PROBLEMS, SESSION_ID_PROBLEMS }
  from '../../evidence/src/ledger.js';

const [SHOWN, NAMED, NOT_HERE] = COMMIT_SESSION_LINKS;
const [ONE, SEVERAL, COMPRESSED, NONE] = COMMIT_RECORDING_STATES;
const [RANGE_UNREADABLE, NO_SESSION, CHOOSE_ONE, NOT_ON_THIS_COMPUTER] = COMMITS_PROBLEMS;
const [, ID_AMBIGUOUS, ID_COMPRESSED] = SESSION_ID_PROBLEMS;
const failure = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

/** A whole `Agent-Session:` line, with the key as the hook writes it, anywhere in a message (the scan for squashed
 *  messages): its value. */
const AGENT_SESSION_LINE = /^Agent-Session:[ \t]*(\S(?:.*\S)?)[ \t]*$/gm;
/** Each commit of the range: its id, its committer time, the values git's own trailer reader finds for the key (one a
 *  line, folded values unfolded), and its whole message. */
export const COMMIT_RANGE_FORMAT = '--format=%H%x00%ct%x00%(trailers:key=Agent-Session,valueonly,unfold,separator=%x0A)'
  + '%x00%B';
/** Settings of the person's git config that would change what git's trailer reader reads, set to git's defaults for
 *  Sonah's reads: the separators of a trailer and the comment character. A key alias the person sets
 *  (`trailer.<token>.key`) still applies; every id must still appear in the message. */
const TRAILER_RULES = Object.freeze(['-c', 'trailer.separators=:', '-c', 'core.commentChar=#']);
/** Every git argv this file may run, as a shape (`<range>` one value, never starting with `-`; `<commit>` a full commit
 *  id with `^{commit}`): the range's commits, with signatures not shown (`log.showSignature` would print their checks
 *  ahead of each commit's id) and messages in UTF-8 (whatever `i18n.logOutputEncoding` says); the git common dir of a
 *  folder; whether this repository holds a commit; and the trailers of one message read on standard input. Local reads
 *  only. */
export const COMMIT_SESSION_GIT_ARGS = Object.freeze([
  Object.freeze(['-c', 'log.showSignature=false', ...TRAILER_RULES, 'log', '-z', '--encoding=UTF-8', COMMIT_RANGE_FORMAT,
    '<range>', '--']),
  Object.freeze(['rev-parse', '--git-common-dir']),
  Object.freeze(['cat-file', '-e', '<commit>']),
  Object.freeze([...TRAILER_RULES, 'interpret-trailers', '--parse', '--no-divider']),
]);
const [RANGE_ARGS, COMMON_ARGS, , TRAILER_ARGS] = COMMIT_SESSION_GIT_ARGS;
const COMMIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})\^\{commit\}$/;
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** A range as `--commits` takes it: `A..B` (either side may be empty, as git reads it), one word, no `...`. */
export const commitRangeShape = (range) => typeof range === 'string' && range.length > 2 && !range.startsWith('-')
  && !/[\s\0]/.test(range) && range.split('..').length === 2 && !range.includes('...');
/** Whether an argv is one of COMMIT_SESSION_GIT_ARGS. */
export const commitGitAllowed = (args) => Array.isArray(args) && COMMIT_SESSION_GIT_ARGS.some((shape) =>
  shape.length === args.length && shape.every((word, i) => (word === '<range>' ? commitRangeShape(args[i])
    : word === '<commit>' ? typeof args[i] === 'string' && COMMIT_OBJECT.test(args[i]) : args[i] === word)));
/** Run an allowlisted git argv with `input` on its standard input: `{ ok, stdout }` (a string), never a throw. */
export function gitWithInput(args, input, { cwd }) {
  if (!commitGitAllowed(args)) return Promise.resolve({ ok: false, stdout: null });
  return new Promise((done) => {
    let child;
    try { child = spawn('git', args, { cwd, env: gitEnvironment(), windowsHide: true }); }
    catch { done({ ok: false, stdout: null }); return; }
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => done({ ok: false, stdout: null }));
    child.on('close', (code) => done(code === 0 ? { ok: true, stdout: Buffer.concat(chunks).toString('utf8') }
      : { ok: false, stdout: null }));
    child.stdin.end(input);
  });
}
const git = async (args, cwd, run) => (commitGitAllowed(args) ? run(args, { cwd }) : { ok: false, stdout: null });

/** The git common dir of the repository that holds `folder`, as a real path, or null. */
async function commonDirOf(folder, run) {
  if (typeof folder !== 'string' || !isAbsolute(folder)) return null;
  const r = await git([...COMMON_ARGS], folder, run).catch(() => null);
  if (!r?.ok) return null;
  const text = r.stdout.toString('utf8');
  const common = text.endsWith('\n') ? text.slice(0, -1) : text;
  try { return await realpath(resolve(folder, common)); } catch { return null; }
}

/**
 * The values that one message's Agent-Session lines carry, `fromGit` (git's own trailer reader's) and the scan's, each
 * once: `{ ids, values, unusable }`, `ids` the session ids among them (D142's SESSION_ID_SHAPE, in lower case), each
 * found in the message; `values` how many there are; `unusable` how many of them are no such id. Pure.
 */
export function idsOf(fromGit, message) {
  const values = [...new Set([...fromGit, ...[...message.matchAll(AGENT_SESSION_LINE)].map((m) => m[1])]
    .map((value) => value.trim()).filter(Boolean))];
  const text = message.toLowerCase();
  const usable = values.filter((value) => SESSION_ID_SHAPE.test(value) && text.includes(value.toLowerCase()));
  return { ids: [...new Set(usable.map((value) => value.toLowerCase()))], values: values.length,
    unusable: values.length - usable.length };
}

/**
 * The commits of `range` in the repository that holds `cwd`, newest first: `{ common, commits }`, each commit
 * `{ hash, time, ids, values, unusable }` with `time` its committer time in whole seconds (as git keeps it) and the rest
 * as `idsOf` reads its message. Throws `commits_range_unreadable` when git cannot list it, or lists it in another shape.
 */
export async function commitsOf(range, { cwd, run = runGit }) {
  if (!commitRangeShape(range)) throw failure(RANGE_UNREADABLE);
  const common = await commonDirOf(cwd, run);
  const r = common ? await git(RANGE_ARGS.map((word) => (word === '<range>' ? range : word)), cwd, run) : null;
  if (!r?.ok) throw failure(RANGE_UNREADABLE);
  const fields = r.stdout.toString('utf8').split('\0');
  const commits = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [field, time, trailers, message] = fields.slice(i, i + 4);
    const hash = field.replace(/^\n/, '');
    if (!COMMIT_ID.test(hash) || !/^\d+$/.test(time)) throw failure(RANGE_UNREADABLE);
    commits.push({ hash, time: Number(time), ...idsOf(trailers.split('\n'), message) });
  }
  return { common, commits };
}

/** The recordings of one session: its own file, and for Claude Code the helpers' files under `<id>/subagents/`. */
async function sessionFiles(file, adapter) {
  const files = [file];
  if (adapter !== 'claude') return files;
  const walk = async (folder, depth) => {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory() && depth < 3) await walk(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
    }
  };
  await walk(join(dirname(file), basename(file, '.jsonl'), 'subagents'), 0);
  return files;
}

/**
 * The tool calls a recording shows, each `{ start, end, cwd }`: the times (ms) of the call's own row and of its result's
 * row, as the recording writes them, and the folder the call ran in (Claude Code: the call row's `cwd`; Codex: the
 * turn's `cwd`, or the call's `workdir`). A call with no result, or no time, is none. Rows that cannot be read are
 * skipped; nothing of a message's words is kept.
 */
export async function toolCallsOf(file, adapter) {
  const pending = new Map(), calls = [];
  let cwd = null;
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const at = (row) => { const t = Date.parse(row?.timestamp); return Number.isFinite(t) ? t : null; };
  try {
    for await (const line of lines) {
      // Only rows that can open or close a call are parsed.
      if (adapter === 'claude' ? !line.includes('"tool_use') && !line.includes('"tool_result"')
        : !/"(?:session_meta|turn_context|function_call|function_call_output|custom_tool_call|custom_tool_call_output)"/
          .test(line)) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const t = at(row);
      if (adapter === 'claude') {
        const content = row?.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block?.type === 'tool_use' && typeof block.id === 'string' && t !== null)
            pending.set(block.id, { start: t, cwd: typeof row.cwd === 'string' ? row.cwd : null });
          else if (block?.type === 'tool_result' && pending.has(block.tool_use_id) && t !== null) {
            const call = pending.get(block.tool_use_id);
            pending.delete(block.tool_use_id);
            calls.push({ start: call.start, end: t, cwd: call.cwd });
          }
        }
      } else {
        const p = row?.payload;
        if ((row?.type === 'session_meta' || row?.type === 'turn_context') && typeof p?.cwd === 'string') cwd = p.cwd;
        else if (row?.type === 'response_item' && (p?.type === 'function_call' || p?.type === 'custom_tool_call')
          && typeof p.call_id === 'string' && t !== null) {
          let workdir = null;
          try { const args = JSON.parse(p.arguments); if (typeof args?.workdir === 'string') workdir = args.workdir; }
          catch { /* not JSON */ }
          pending.set(p.call_id, { start: t, cwd: workdir && cwd ? resolve(cwd, workdir) : workdir ?? cwd });
        } else if (row?.type === 'response_item' && (p?.type === 'function_call_output'
          || p?.type === 'custom_tool_call_output') && pending.has(p.call_id) && t !== null) {
          const call = pending.get(p.call_id);
          pending.delete(p.call_id);
          calls.push({ start: call.start, end: t, cwd: call.cwd });
        }
      }
    }
  } catch { /* an unreadable recording shows no call */ }
  finally { lines.close(); input.destroy(); }
  return calls;
}

/** Whether a call spans a commit made at `time` (whole seconds: git keeps a commit's committer time truncated to its
 *  second): the second of the call's row (its time truncated) through the second of its result's row (its time
 *  truncated). A commit that the call made is written before its result's row, on the same clock, so its second is never
 *  later than that row's. */
export const spans = (call, time) => Math.floor(call.start / 1000) <= time && time <= Math.floor(call.end / 1000);

/**
 * The link of each commit to the one recording its id names: `shown` when one call spans the commit's time in a folder
 * of the same repository (`common`, never null), else `named`. `calls` are the session's (toolCallsOf over
 * sessionFiles).
 */
export async function linkOf(commit, calls, { common, run = runGit, commons = new Map() }) {
  if (typeof common !== 'string') return NAMED;
  for (const call of calls) {
    if (!spans(call, commit.time)) continue;
    if (!commons.has(call.cwd)) commons.set(call.cwd, commonDirOf(call.cwd, run));
    if (await commons.get(call.cwd) === common) return SHOWN;
  }
  return NAMED;
}

/**
 * The sessions that the commits of `range` name, in the order of their newest commit: `{ range, total, naming,
 * unusable, sessions }`, `naming` the commits that name a session, `unusable` the values of their lines that are no
 * session id, each session `{ id, state, recording: { file, adapter } | null, files, commits: [{ hash, link }] }` with
 * `state` one of COMMIT_RECORDING_STATES, `files` the recordings here whose names carry the id, and `recording` the one
 * Sonah reads.
 */
export async function sessionsOfCommits(range, { cwd, roots, run = runGit, named = recordingsNamed }) {
  const { common, commits } = await commitsOf(range, { cwd, run });
  const sessions = await sessionsOf(commits.map((commit) => ({ ...commit, local: true })), { common, roots, run, named });
  return { range, ...countsOf(commits), sessions };
}

const countsOf = (commits) => ({ total: commits.length, naming: commits.filter((c) => c.ids.length).length,
  unusable: commits.reduce((n, c) => n + c.unusable, 0) });

/** The sessions that `commits` name, each `{ hash, time, ids, local }`, newest first. Calls are read only from one plain
 *  recording, each session's own; a commit that this repository does not hold (`local` false) cannot be checked against
 *  a recording: named, or not here. */
async function sessionsOf(commits, { common, roots, run, named }) {
  const byId = new Map();
  for (const commit of commits) for (const id of commit.ids) {
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(commit);
  }
  const commons = new Map();
  const sessions = [];
  for (const [id, its] of byId) {
    const found = await named(id, { claudeProjects: roots.claude, codexHome: roots.codex });
    const files = found.map((match) => match.file);
    const state = !found.length ? NONE : found.length > 1 ? SEVERAL : files[0].endsWith('.zst') ? COMPRESSED : ONE;
    const recording = state === ONE ? found[0] : null;
    let calls = [];
    if (recording) for (const file of await sessionFiles(recording.file, recording.adapter))
      calls = calls.concat(await toolCallsOf(file, recording.adapter));
    const links = [];
    for (const commit of its)
      links.push({ hash: commit.hash, link: state === NONE ? NOT_HERE
        : recording && commit.local ? await linkOf(commit, calls, { common, run, commons }) : NAMED });
    sessions.push({ id, state, recording, files, commits: links });
  }
  return sessions;
}

/** The session ids one message names (`idsOf`), as git reads its trailers (`git interpret-trailers --parse`, on standard
 *  input, with TRAILER_RULES: the person's separators and comment character do not change it, a key alias they set
 *  does) and by the scan for whole lines. */
export async function messageIds(message, { cwd, input = gitWithInput }) {
  const parsed = await input([...TRAILER_ARGS], message, { cwd });
  const fromGit = parsed.ok ? parsed.stdout.split('\n').map((line) => /^agent-session:(.*)$/i.exec(line)?.[1])
    .filter((value) => value !== undefined) : [];
  return idsOf(fromGit, message);
}

/**
 * D143: the sessions that the commits of the pull request `owner/repo#number` name, read from GitHub (its reader
 * `readPullRequestCommits`, GET only, with the client given), newest first, linked as a range's are in the repository
 * that holds `cwd`: a commit this repository does not hold, or every commit when `cwd` is in no repository, can only be
 * named, or not here. `{ range, total, naming, unusable, sessions, whole, count, baseOid, owner, repo, number,
 * inRepository, folder }`; `whole` false when GitHub listed fewer commits than the pull request holds.
 */
export async function sessionsOfPullRequest({ owner, repo, number }, { cwd, roots, client, run = runGit,
  input = gitWithInput, read = readPullRequestCommits, named = recordingsNamed }) {
  const common = await commonDirOf(cwd, run);
  const pr = await read({ client, owner, repo, number });
  const commits = [];
  for (const commit of [...pr.commits].reverse()) {
    const local = common !== null && (await git(['cat-file', '-e', `${commit.sha}^{commit}`], cwd, run)).ok;
    commits.push({ hash: commit.sha, time: commit.time, ...await messageIds(commit.message, { cwd, input }), local });
  }
  const sessions = await sessionsOf(commits, { common, roots, run, named });
  return { range: `${owner}/${repo}#${number}`, ...countsOf(commits), sessions, whole: pr.whole, count: pr.count,
    baseOid: pr.baseOid, owner, repo, number, inRepository: common !== null, folder: cwd };
}

/** The commands that read every commit of a pull request when GitHub's list is not whole: its head fetched from the
 *  repository on GitHub by its address (a clone's `origin` can be a fork, which holds no `pull/N/head`), then the range
 *  from its base. */
export const pullRequestFetchSteps = ({ owner, repo, number, baseOid }) =>
  `git fetch https://github.com/${owner}/${repo}.git pull/${number}/head\n`
  + `sonah sessions --commits ${baseOid}..FETCH_HEAD`;

/** How `sonah sessions --commits` or `--github` exits: 0 when it lists a session; 1 when every commit was read and none
 *  names one; 2 when GitHub's list of a pull request was not whole and the commits it listed name none. */
export const commitSessionsExit = (found) => (found.sessions.length ? 0 : found.whole === false ? 2 : 1);

/** The session `review --commits` reviews: the only one with a recording here, or the `choose`th of the list. Throws a
 *  COMMITS_PROBLEMS code, or, for a session whose id more than one recording carries or whose one recording is
 *  compressed, SESSION_ID_PROBLEMS' code with `matches`, their paths (as `review --session` does). */
export function sessionToReview(found, choose) {
  if (!found.sessions.length) throw failure(NO_SESSION);
  let session;
  if (choose !== undefined) {
    session = found.sessions[choose - 1];
    if (!session) throw failure(CHOOSE_ONE);
  } else {
    const here = found.sessions.filter((s) => s.state !== NONE);
    if (here.length > 1) throw failure(CHOOSE_ONE);
    [session] = here;
  }
  if (!session || session.state === NONE) throw failure(NOT_ON_THIS_COMPUTER);
  if (session.state === SEVERAL) throw failure(ID_AMBIGUOUS, { matches: session.files });
  if (session.state === COMPRESSED) throw failure(ID_COMPRESSED, { matches: session.files });
  return session;
}

/** The words of `sonah sessions --commits` and `--github`, and of the list `sonah review --commits` prints. */
export const COMMIT_SESSION_WORDS = Object.freeze({
  heading: (range, naming, total) => `Sessions that the commits in ${range} name, newest first: ${naming} of ${total} `
    + 'commits name a session in an Agent-Session line.',
  none: (range, total) => `No commit in ${range} names a session in an Agent-Session line (${total} commits).`,
  noneListed: (listed) => `Sonah found no session named in an Agent-Session line of the ${listed} commits that GitHub `
    + 'listed.',
  unusable: (n) => (n === 1 ? 'One Agent-Session line carries a value that is not a session id, so Sonah lists no '
    + 'session for it.' : `${n} Agent-Session lines carry a value that is not a session id, so Sonah lists no session `
    + 'for them.'),
  link: { shown: 'shown in the recording', named: 'named by the commit only', not_here: 'not on this computer' },
  several: 'more than one recording here has this id',
  recordings: (list) => `recordings: ${list}`,
  compressed: 'Codex keeps this recording compressed (.zst), and Sonah reads only plain recordings. Run zstd -d on it, '
    + 'and review the .jsonl file that it writes.',
  session: (n, id, where) => `${n}. ${id} · ${where}`,
  commits: (list) => `commits: ${list}`,
  commit: (hash, link) => `${hash} ${link}`,
  review: (id) => `sonah review --session ${id}`,
  claim: 'A line is a claim that anyone can type. Shown in the recording: a tool call of that session spans the '
    + 'commit\'s time, in this repository.',
  notWhole: (listed, count) => `GitHub listed ${listed} of the pull request's ${count} commits, so this list is not `
    + 'whole. To read every commit, run these commands in the repository:',
  noRepository: (folder) => `${folder} is in no git repository, so Sonah cannot show a commit in a recording. Run this `
    + 'command in your clone of the repository, or give the clone with --repo DIR.',
});

/** The lines under a session's own line start here. */
const INDENT = '   ';
/** The lines that list `found` (sessionsOfCommits, sessionsOfPullRequest). A pull request read from a folder in no
 *  repository says so first, and one whose list GitHub did not give whole says so with the commands that read it all;
 *  an absence over the whole range or pull request is said only when every commit of it was read. */
export function commitSessionLines(found) {
  const W = COMMIT_SESSION_WORDS;
  const lines = [];
  if (found.inRepository === false) lines.push(W.noRepository(found.folder), '');
  if (found.whole === false) lines.push(W.notWhole(found.total, found.count), '', pullRequestFetchSteps(found), '');
  if (!found.sessions.length) {
    lines.push(found.whole === false ? W.noneListed(found.total) : W.none(found.range, found.total));
    if (found.unusable) lines.push(W.unusable(found.unusable));
    return lines;
  }
  lines.push(W.heading(found.range, found.naming, found.total));
  found.sessions.forEach((s, i) => {
    const where = s.state === NONE ? W.link[NOT_HERE] : s.state === SEVERAL ? W.several : s.files[0];
    lines.push(W.session(i + 1, s.id, where));
    if (s.state === SEVERAL) lines.push(`${INDENT}${W.recordings(s.files.join(', '))}`);
    if (s.state === COMPRESSED) lines.push(`${INDENT}${W.compressed}`);
    lines.push(`${INDENT}${W.commits(s.commits.map((c) => W.commit(c.hash.slice(0, 12), W.link[c.link])).join(', '))}`);
    if (s.state === ONE) lines.push(`${INDENT}${W.review(s.id)}`);
  });
  if (found.unusable) lines.push(W.unusable(found.unusable));
  lines.push(W.claim);
  return lines;
}

/** The fixes `sonah sessions --commits` and `--github` print (the review's are REVIEW_FIX_WORDS). */
export const COMMIT_SESSION_FIXES = Object.freeze({
  rangeUnreadable: (range) => `Git could not list the commits in ${range} in this repository. Give a range that git log `
    + 'reads here, such as main..HEAD, or give the repository with --repo DIR.',
  githubUnreadable: (target) => `Sonah could not read the commits of ${target} from GitHub. Check the name and the `
    + 'number. Check that your token can read the repository: GH_TOKEN, GITHUB_TOKEN or gh auth login.',
});

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ COMMIT_SESSION_WORDS: 'notice', COMMIT_SESSION_FIXES: 'notice' });
export const STYLE_FIXTURES = Object.freeze({
  'COMMIT_SESSION_WORDS.heading': [['main..HEAD', 2, 3]],
  'COMMIT_SESSION_WORDS.none': [['main..HEAD', 3]],
  'COMMIT_SESSION_WORDS.noneListed': [[250]],
  'COMMIT_SESSION_WORDS.unusable': [[1], [3]],
  'COMMIT_SESSION_WORDS.recordings': [['/recordings/p1/s.jsonl, /recordings/p2/s.jsonl']],
  'COMMIT_SESSION_WORDS.session': [[1, '1f0c6a52-8e4b-4c3d-9a71-2b5d0e9f4c86', '/recordings/p/s.jsonl']],
  'COMMIT_SESSION_WORDS.commits': [['1a2b3c4d5e6f shown in the recording']],
  'COMMIT_SESSION_WORDS.commit': [['1a2b3c4d5e6f', 'shown in the recording']],
  'COMMIT_SESSION_WORDS.review': [['1f0c6a52-8e4b-4c3d-9a71-2b5d0e9f4c86']],
  'COMMIT_SESSION_FIXES.rangeUnreadable': [['main..HEAD']],
  'COMMIT_SESSION_FIXES.githubUnreadable': [['getsonah/sonah#12']],
  'COMMIT_SESSION_WORDS.notWhole': [[250, 300]],
  'COMMIT_SESSION_WORDS.noRepository': [['/work/notes']],
});
