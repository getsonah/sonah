// D229 (item 10, C6): `sonah fixes` and `sonah fix`, the laptop half of the fix loop (sonah-hosted FIXLOOP.md
// "How the author is told", "Opening it in Claude Code", steps 1 to 6). Ported from the private laptop client's
// fix.mjs and its `fixes` and `fix` commands (sonah-hosted client/fix.mjs, client/sonah-pr.mjs), with getsonah's exit
// codes, its argument style (`--opt value` only) and its own modules in place of the client's vendored copies.
//
//   `sonah fixes [--repo DIR] [--json]`  lists the comments that wait for you: one GET /api/fixes a repository
//        (team-api.js), every entry checked by shape and a bad one dropped and counted (fix-waiting.js `checkList`),
//        the list kept in the waiting cache under this connection, and each line naming `sonah fix <id>`. The
//        repository is this clone's, as its push remote names it; in a folder that is no clone of one (and with no
//        --repo), every clone whose push hook is for this connection's server (team/hooks.json). Exit 0; exit 2 when
//        no repository is named, or on any refusal of the server.
//   `sonah fix <comment id> [--repo DIR] [--config-dir DIR] [--new]`  starts Claude Code on one comment, in a
//        terminal of its own: GET /api/fixes/<id>, every field checked by shape (`checkFix`); the worktree of this
//        clone that has the review's branch checked out, and never a branch switched; the session that wrote the
//        change, resumed as a copy (fork) only when D142 finds one plain recording of it and D143 shows that commit
//        in it, else a new session (`planFix`); the whole prompt shown and the question asked, with nothing sent
//        without a yes; the launch record kept (fix-launches.js); the comment marked launched in the cache; the
//        server told `launched` (best effort, 5 s); then `claude` run by spawn, never through a shell, in that folder
//        and on this terminal. Exit 0 once Claude Code ran and ended, and 0 for a fix in a final state (nothing to
//        do); 1 when you said no; 2 for each refusal (ledger.js FIX_PROBLEMS).
//
// Nothing of the server's answer becomes a command, a path, a flag or an environment value: its text goes only into
// the prompt, as one argument of `claude`, with no permission flag or mode, tool list, settings, MCP configuration,
// model or -p. The prompt starts with the frame's first word, so Claude Code never reads it as an option (`sendable`).
// Decision 9: Claude Code's own exit code is not passed through, since it could collide with getsonah's 2 and 3.
// The plan's A9: the commit link of the worktree is read (D143, agent-session-hook.js `commitLinkFacts`), as the
// person's own git reads it (`hookGitEnv`), and `sonah fix` says that without it the server cannot mark this fix
// pushed, since the mark is the commit's Agent-Session line; where Sonah's line sits in a hook file another tool owns,
// Sonah cannot tell whether git runs it, and says that instead (review 2). Each of those lines names the worktree the
// link was read in, and gives it to `sonah hook add` as `--repo`, which is the folder of the fix and not the folder
// you ran the command in (review 3).
//
// No work at import.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants as osConstants, homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { COMMIT_LINK_STATES, COMMIT_RECORDING_STATES, COMMIT_SESSION_LINKS,
  FIX_PROBLEMS } from '../../evidence/src/ledger.js';
import { CUT, FIX_ACTS, FIX_FINAL_STATES, FIX_STATES, FixShapeError, FRAME, fixPrompt, isBranch, isCommentId, isCount,
  isFullSha, isItemKey, isLogin, isName, isOwner, isPath, isPrNumber, isSessionId, isTime, isWords, shown,
  THREAD_MAX } from '../../visual/src/fix-prompt.mjs';
import { commitLinkFacts } from './agent-session-hook.js';
import { claudeConfigDirForCalls } from './claude-home.js';
import { commitsOf, sessionsOfCommits } from './commit-sessions.js';
import { runGit } from './code-snapshot.js';
import { jsonText, TEAM_FIX_WORDS, TEAM_PROBLEM_WORDS } from './connect-command.js';
import { checkList, markLaunched, repoKeyOf, saveWaiting } from './fix-waiting.js';
import { appendLaunch, readLaunch } from './fix-launches.js';
import { claudeOnPath } from './push-hook.js';
import { localGitEnv, PUSH_RUN_WORDS, whyWords } from './push-run.js';
import { recordingsNamed } from './session-id.js';
import { TEAM_API_TIMEOUT_MS, TeamApiError, teamApi, teamProblemOf } from './team-api.js';
import { changedPaths, commonDirOf, gitOut, pushUrlOf, remoteRepository, remotesOf, topOf,
  worktreesOf } from './team-git.js';
import { isRefused, markRefused, readConnection, readHooks } from './team-home.js';
import { shareTarget } from './visual-command.js';

/** The commands' usage, each within 80 columns after `usage: `. */
export const FIXES_USAGE = 'sonah fixes [--repo DIR] [--json]';
export const FIX_USAGE = 'sonah fix <comment id> [--repo DIR] [--config-dir DIR] [--new]';
/** How long `sonah fix` waits for POST /api/fixes/<id>/launched, which it sends best effort. */
export const FIX_LAUNCHED_TIMEOUT_MS = 5000;
/** The most files of an item that the answer may name (the paths of its functions). */
const FILES_MAX = 3000;
/** What a listing shows of an item's title. */
const TITLE_SHOWN_MAX = 90;
const [ONE, SEVERAL, COMPRESSED, NONE] = COMMIT_RECORDING_STATES;
const [SHOWN] = COMMIT_SESSION_LINKS;
/** The two states of the commit link that A9 reads: on, and the one where Sonah cannot tell (D143). */
const LINK_ON = COMMIT_LINK_STATES[1], LINK_NOT_CHECKED = COMMIT_LINK_STATES[4];

/** The frame's first word: every prompt sent starts with it, so Claude Code never reads it as an option. */
export const FIRST_WORD = FRAME.opening.split(' ')[0];
const plainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const short = (text) => String(text ?? '').slice(0, 8);

/** Whether a prompt may be sent: it starts with the frame's first word, and holds no NUL (argv carries none). */
export const sendable = (prompt) => typeof prompt === 'string' && prompt.startsWith(`${FIRST_WORD} `)
  && !prompt.includes('\0');

/** Claude Code's argv for a fix: a copy (fork) of a session under a new id, or a new session; the prompt last, as one
 *  argument. No permission flag or mode, tool list, settings, MCP configuration, model or -p. */
export function claudeArgv({ prompt, session, forkOf = null }) {
  if (!isSessionId(session)) throw new Error('claudeArgv: not a session id');
  if (forkOf !== null && !isSessionId(forkOf)) throw new Error('claudeArgv: not a session id to fork');
  if (!sendable(prompt)) throw new Error(`claudeArgv: the prompt must start with "${FIRST_WORD} "`);
  return forkOf ? ['--resume', forkOf, '--fork-session', '--session-id', session, prompt]
    : ['--session-id', session, prompt];
}

/** What the commands print, in fixed words: the problems (ledger.js FIX_PROBLEMS), each with its fix, and the lines of
 *  a listing and of one fix. Text from the server goes through fix-prompt.mjs `shown`. */
export const FIX_WORDS = Object.freeze({
  problem: Object.freeze({
    fix_no_repository: (server) => 'No remote of this clone names an owner and a repository. No clone whose push hook '
      + `is for ${server} names one either.`,
    fix_bad_list: (server) => `${server} gave a list of comments that Sonah cannot read.`,
    fix_bad_id: 'That is not a comment id: an id starts with c_ and has 16 more characters.',
    fix_inside_claude: 'This terminal runs inside Claude Code: it has CLAUDECODE in its environment. Claude Code '
      + 'does not start inside another session.',
    fix_no_terminal: 'sonah fix shows you the prompt and asks before it sends it, and this is not a terminal.',
    fix_no_claude: 'Sonah found no claude on PATH.',
    fix_bad_answer: (server, where) => `${server} gave an answer that Sonah cannot read (${where}), so it did `
      + 'nothing.',
    fix_not_waiting: (id, server) => `No comment ${id} waits for you on ${server}.`,
    fix_not_fixable: (id) => `Comment ${id} is not one that a fix can answer.`,
    fix_not_git: (dir) => `${dir} is in no git repository.`,
    fix_not_this_repo: (repo) => `This clone is not of ${repo}.`,
    fix_no_worktree: (branch) => `No worktree of this clone has ${branch} checked out, and Sonah never switches a `
      + 'branch of yours.',
    fix_several_worktrees: (branch, dirs) => `More than one worktree has ${branch} checked out: ${dirs}.`,
    fix_several_recordings: (session, files) => `More than one recording carries session ${session}: ${files}.`,
    fix_record_unreadable: (file) => `${file} is there, and Sonah cannot read it as a launch record.`,
    fix_claude_failed: (code) => `Claude Code did not start (${code}).`,
  }),
  fix: Object.freeze({
    fix_no_repository: 'Run sonah fixes in your clone, or pass --repo DIR.',
    fix_bad_list: 'Run sonah fixes again after you update Sonah.',
    fix_bad_id: 'Copy the id of a comment from its page on Sonah Team.',
    fix_inside_claude: 'Run sonah fix in a terminal of its own.',
    fix_no_terminal: 'Run sonah fix in a terminal.',
    fix_no_claude: 'Install Claude Code.',
    fix_bad_answer: 'Run sonah fix again after you update Sonah.',
    fix_not_waiting: 'Copy the id of a comment that waits for you on Sonah Team.',
    fix_not_fixable: 'Open its page on Sonah Team to read the comment.',
    fix_not_git: 'Run sonah fix in your clone of the repository, or pass --repo DIR.',
    fix_not_this_repo: 'Run sonah fix in your clone of it, or pass --repo DIR.',
    fix_no_worktree: (branch) => `Run git switch ${branch} in that clone, or add a worktree for the branch.`,
    fix_several_worktrees: 'Remove one of those worktrees.',
    fix_several_recordings: (folders) => (folders.length > 1
      ? `Name one folder with --config-dir ${folders.join(' or --config-dir ')}, or start a new session with --new.`
      : 'Start a new session with --new.'),
    fix_record_unreadable: 'Move that file away to start this fix again.',
    fix_claude_failed: 'Check that claude runs in this terminal.',
  }),
  // `sonah fixes`: the heading of a repository's comments, each comment's own lines, and what is left out.
  none: (repo) => `No comment waits for you on ${repo}.`,
  heading: (count, repo) => `${count === 1 ? '1 comment waits' : `${count} comments wait`} for you on ${repo}:`,
  entry: (login, verb, where, what) => `@${login} ${verb} on ${where} · ${what}`,
  onIt: 'Claude Code is on it',
  more: (count) => `and ${count} more`,
  dropped: (count) => `${count} of the entries of the server are not of their shape, so Sonah leaves them out.`,
  // `sonah fix`: the prompt, where it goes, the question, and what Sonah says after it.
  prompt: 'The prompt, as Sonah sends it:',
  toFork: (session, dir, folder) => `It goes to a copy of session ${session}, which wrote this change, in ${dir} `
    + `(Claude Code folder ${folder}).`,
  toLast: (session, dir, folder) => `It goes to a copy of session ${session}, your last fix of this comment, in `
    + `${dir} (Claude Code folder ${folder}).`,
  toNew: (dir, why) => `It goes to a new session in ${dir}: ${why}`,
  // Why a new session, by the reason `planFix` gives.
  why: Object.freeze({
    asked: 'you asked for one (--new).',
    no_agent_commit: 'no commit of this change names an agent session that touched these files.',
    range_unreadable: 'this clone cannot read the reviewed commits.',
    several_sessions: 'the commit that touched these files names more than one session.',
    not_here: (session) => `session ${session}, which wrote this change, is not on this computer.`,
    not_readable: (session) => `Sonah cannot read the recording of session ${session} here.`,
    not_shown: (session) => `the recording of session ${session} here does not show it made this change here.`,
  }),
  headNotHere: (head) => `The reviewed head ${head} is not in this clone.`,
  headNotHeld: (head) => `The HEAD of this folder does not hold the reviewed head ${head}.`,
  // A9: without D143's commit link, a commit of the fix carries no Agent-Session line, which is what marks it pushed.
  // D229 review 3: the folder is the worktree the link was read in, which is not the folder you run `sonah fix` in —
  // with no --repo in a folder that is no clone, and with --repo of another clone, it is another repository or none at
  // all — so the line names that folder, and names it to `sonah hook add` as well, which reads your folder otherwise.
  noLink: (dir) => `The commits of ${dir} carry no Agent-Session line, so Sonah Team cannot mark this fix pushed. Run `
    + `sonah hook add --repo ${dir} to turn that line on.`,
  // D229 review 2: in D143's `not_checked`, Sonah's line is in a hook file that another tool or you own, and `sonah
  // hook add` has nothing more to do there: it prints the same line for you to add. So this says what Sonah cannot
  // tell, as `sonah doctor` says it of that state, and asks for nothing.
  linkNotChecked: (dir) => `Sonah cannot tell whether the commits of ${dir} carry an Agent-Session line. That line is `
    + 'what lets Sonah Team mark this fix pushed. Look for it in git log after this fix.',
  // D229 review 3: the other half of `not_checked`, where `lineIn` is null: the hook git runs is another tool's and no
  // line of Sonah's is in it, so Sonah cannot tell either, and `sonah hook add` has its line to print — which is what
  // `sonah doctor` asks for in that state (agent-session-hook.js HOOK_WORDS.status.notChecked with its fix).
  linkAddLine: (dir) => `Sonah cannot tell whether the commits of ${dir} carry an Agent-Session line. That line is `
    + `what lets Sonah Team mark this fix pushed. Run sonah hook add --repo ${dir}, and add the line it prints.`,
  // D229 review 2: the fix of a refusal. `sonah connect`'s own fix for a refusal, a redirect and an answer it cannot
  // read names --server, which neither of these commands takes: the server of their calls is the connection's.
  refusedFix: 'Run sonah status to see the server of this connection.',
  // The route's own refusal for someone in no team (403 not_member), as D227 says it of a push's upload.
  notMemberFix: (server) => `Open ${server} and join a team there.`,
  question: 'Send it? (y)es, (e)dit, (n)o: ',
  noEditor: 'Set $VISUAL or $EDITOR to edit the prompt.',
  editorFailed: 'The editor did not finish, so the prompt stays as it was.',
  editorFirstWord: (word) => `A prompt must start with "${word} ", as the prompt of Sonah does, so Claude Code reads `
    + 'it as the prompt. It stays as it was.',
  nothingSent: 'Sonah sent nothing.',
  notTold: (message) => `Sonah could not tell the server that this fix started (${message}). The fix goes on.`,
  finalState: (state) => `This fix ended as ${state}: nothing to do.`,
});

const usageError = (problem) => Object.assign(new Error('usage'), { code: 'usage', problem });
/** An option the person typed, as a usage error names it: its name before any `=`, at most 40 characters. */
const named = (arg) => {
  const name = arg.split('=')[0], cut = name.slice(0, 40);
  if (cut.length === arg.length) return arg;
  return cut.length < name.length ? `${cut}...` : `${cut}=...`;
};

/** `sonah fixes`'s options, or a thrown usage error: `{ repo, json }`. */
export function parseFixesArgs(argv) {
  const options = { repo: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      if (options.json) throw usageError('--json is given twice');
      options.json = true;
    } else if (arg === '--repo') {
      if (options.repo !== null) throw usageError('--repo is given twice');
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) throw usageError('--repo needs a value');
      options.repo = value;
      i += 1;
    } else throw usageError(arg.startsWith('-') ? `unknown option ${named(arg)}` : 'it takes no argument');
  }
  return options;
}

/** `sonah fix`'s options, or a thrown usage error: `{ id, repo, configDir, fresh }`; `id` is checked by shape. */
export function parseFixArgs(argv) {
  const options = { id: null, repo: null, configDir: null, fresh: false };
  const values = new Map([['--repo', 'repo'], ['--config-dir', 'configDir']]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = values.get(arg);
    if (key) {
      if (options[key] !== null) throw usageError(`${arg} is given twice`);
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) throw usageError(`${arg} needs a value`);
      options[key] = value;
      i += 1;
    } else if (arg === '--new') {
      if (options.fresh) throw usageError('--new is given twice');
      options.fresh = true;
    } else if (arg.startsWith('-')) throw usageError(`unknown option ${named(arg)}`);
    else if (options.id !== null) throw usageError('it takes one comment id');
    else options.id = arg;
  }
  if (options.id === null) throw usageError('give the comment id that the review page shows');
  return options;
}

// ---------- the server's answer, by shape ----------

const bad = (where) => { throw new FixShapeError(where); };

/** The review's link: an http(s) URL on the origin of the connected server, shown and never opened. */
export function isReviewUrl(value, origin) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
    && url.origin === origin;
}

const pathsOf = (files, where) => {
  if (!Array.isArray(files) || files.length > FILES_MAX || !files.every(isPath)) bad(where);
  return [...files];
};

// A reply's thread, oldest first (absent from an older server: none), each entry checked by shape.
function threadOf(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > THREAD_MAX) bad('thread');
  return list.map((t, i) => {
    if (!plainObject(t) || !isLogin(t.by)) bad(`thread[${i}].by`);
    if (!FIX_ACTS.includes(t.act)) bad(`thread[${i}].act`);
    if (!isTime(t.at)) bad(`thread[${i}].at`);
    const words = t.words ?? null;
    if (words === null ? t.act !== 'override' : !isWords(words)) bad(`thread[${i}].words`);
    return { by: t.by, act: t.act, at: t.at, words };
  });
}

/**
 * GET /api/fixes/<id>'s answer (sonah-hosted FIXLOOP.md "Shapes"), checked field by field ->
 * `{ comment, thread, item, review, fix }` with the known fields only. It throws a FixShapeError naming the first
 * field that is not of its shape; `fixPrompt` checks the item's texts again as it builds the prompt.
 */
export function checkFix(json, { id, origin }) {
  if (!plainObject(json)) bad('answer');
  const c = json.comment;
  if (!plainObject(c) || c.id !== id || !isCommentId(c.id)) bad('comment.id');
  if (!isLogin(c.by)) bad('comment.by');
  if (!FIX_ACTS.includes(c.act)) bad('comment.act');
  if (!isTime(c.at)) bad('comment.at');
  const words = c.words ?? null;
  if (words === null ? c.act !== 'override' : !isWords(words)) bad('comment.words');
  const it = json.item;
  if (!plainObject(it) || !isItemKey(it.key)) bad('item.key');
  let item;
  if (it.kind === 'finding') {
    item = { kind: 'finding', key: it.key, tier: it.tier, title: it.title, oneLine: it.oneLine ?? '',
      fns: Array.isArray(it.fns) ? [...it.fns] : it.fns, quote: it.quote,
      files: pathsOf(it.files, 'item.files') };
  } else if (it.kind === 'function') {
    const added = it.added ?? null, removed = it.removed ?? null;
    if (added !== null && !isCount(added)) bad('item.added');
    if (removed !== null && !isCount(removed)) bad('item.removed');
    item = { kind: 'function', key: it.key, added, removed, files: pathsOf(it.files, 'item.files') };
  } else bad('item.kind');
  const r = json.review;
  if (!plainObject(r) || !isReviewUrl(r.url, origin)) bad('review.url');
  if (!isOwner(r.owner)) bad('review.owner');
  if (!isName(r.name)) bad('review.name');
  const pr = r.pr ?? null;
  if (pr !== null && !isPrNumber(pr)) bad('review.pr');
  if (!isBranch(r.branch)) bad('review.branch');
  if (!isFullSha(r.base)) bad('review.base');
  if (!isFullSha(r.head)) bad('review.head');
  const f = json.fix;
  const state = plainObject(f) ? (f.state ?? null) : undefined;
  const at = plainObject(f) ? (f.at ?? null) : undefined;
  if (!(state === null || FIX_STATES.includes(state))) bad('fix.state');
  if (!(at === null || isTime(at))) bad('fix.at');
  return { comment: { id: c.id, by: c.by, act: c.act, at: c.at, words }, thread: threadOf(json.thread), item,
    review: { url: r.url, owner: r.owner, name: r.name, pr, branch: r.branch, base: r.base, head: r.head },
    fix: { state, at } };
}

// ---------- the repository and the folder ----------

const isDir = async (path) => { try { return (await stat(path)).isDirectory(); } catch { return false; } };
/** The injected git (team-git.js `gitOut`'s shape) as `runGit`'s, so visual-command.js's `shareTarget` and
 *  commit-sessions.js run this command's git, in its environment, as every other git call here does. */
const asRunGit = (git, env) => async (args, { cwd }) => {
  const out = await git(cwd, args, { env });
  return out === null ? { ok: false, stdout: null } : { ok: true, stdout: Buffer.from(out, 'utf8') };
};

/** D229 review 2: the environment of A9's read of the commit link, which is a read of where git runs a hook: this
 *  command's git environment (`localGitEnv`) and the names that name the person's own git config files, where
 *  `core.hooksPath` can come from (team-git.js, as D143's own readers run git), so the line before the question says
 *  what `sonah doctor` and `sonah hook add` say of the same folder. Never a `GIT_DIR` or `GIT_WORK_TREE` of their
 *  shell, which would read another repository than the worktree. */
const CONFIG_KEPT = Object.freeze(['XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']);
function hookGitEnv(env) {
  const out = localGitEnv(env);
  for (const key of CONFIG_KEPT) if (typeof env[key] === 'string') out[key] = env[key];
  return out;
}

/** The repositories a clone's remotes name on a server (`remoteRepository` of each push URL), each once: what
 *  `findWorktree` asks whether a clone is of, where a fork's `upstream` names the review's repository as well. */
async function repositoriesOf(dir, { env, git }) {
  const found = new Map();
  for (const remote of await remotesOf(dir, { env, git })) {
    const named = remoteRepository(await pushUrlOf(dir, remote, { env, git }));
    if (named && !found.has(repoKeyOf(named.owner, named.name))) found.set(repoKeyOf(named.owner, named.name), named);
  }
  return [...found.values()];
}

/** D229: the repository of this clone, as its push remote names it (visual-command.js `shareTarget`, which reads the
 *  remote that git would push the checked-out branch to), or null when the folder is in no working tree, or its push
 *  remote names no owner and repository. */
export async function repositoryOf(dir, { env, git = gitOut } = {}) {
  const top = await topOf(dir, { env, git });
  if (top === null) return null;
  const head = (await git(top, ['rev-parse', '--verify', '--quiet', 'HEAD'], { env }))?.trim() ?? '';
  const { named } = await shareTarget({ top, head, git: asRunGit(git, env) });
  return named ?? null;
}

/** The one repository a clone is of, for a read that names a repository rather than asking whether a clone is of one:
 *  its `origin`, else its first remote in git's order, as that remote's push URL names it (the private client's own
 *  read, sonah-hosted client/sonah-pr.mjs `connectedRepositories`); null when that remote names none. */
async function repositoryNamed(dir, { env, git }) {
  const names = await remotesOf(dir, { env, git });
  const remote = names.includes('origin') ? 'origin' : names[0];
  if (remote === undefined) return null;
  return remoteRepository(await pushUrlOf(dir, remote, { env, git }));
}

/** D229: the repositories of the clones whose pushes Sonah reviews on this computer (team/hooks.json, by git common
 *  dir), one a clone and each once: what `sonah fixes` lists in a folder that is no clone of one. One clone is one
 *  call, so a clone whose other remote is the repository it was forked from asks about its own repository only.
 *  D229 review 2: `server` is the connection's, and a clone whose push hook is for another server is left out, as a
 *  push of it is (push-hook-run.js: two servers on one computer, the plan's risk 4). The name of a repository that
 *  another server reviews is then never sent to this one, and its refusal never ends this listing. */
export async function connectedRepositories(where, { env, git = gitOut, server } = {}) {
  const listed = await readHooks(where);
  const found = new Map();
  for (const repo of listed.state === 'ok' ? listed.repos : []) {
    if (repo.server !== server) continue;
    if (!isAbsolute(repo.common) || !(await isDir(repo.common))) continue;
    const named = await repositoryNamed(repo.common, { env, git });
    if (named && !found.has(repoKeyOf(named.owner, named.name)))
      found.set(repoKeyOf(named.owner, named.name), named);
  }
  return [...found.values()];
}

/** The worktrees of the repository whose git common dir is `common` that have `branch` checked out, each as git lists
 *  it, by their real path. */
async function treesWith(common, branch, { env, git }) {
  const found = new Map();
  for (const tree of await worktreesOf(common, { env, git })) {
    if (tree.branch !== `refs/heads/${branch}` || tree.bare || tree.prunable || !(await isDir(tree.path))) continue;
    const real = await topOf(tree.path, { env, git }) ?? tree.path;
    found.set(real, tree);
  }
  return found;
}

/** Whether the commit `sha` is in the history of HEAD at `dir`: true, false, or null when this clone does not hold
 *  that commit at all. */
async function holds(dir, sha, { env, git }) {
  const here = (await git(dir, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${sha}^{commit}`],
    { env }))?.trim();
  if (!isFullSha(here ?? '')) return null;
  return (await git(dir, ['merge-base', '--is-ancestor', '--end-of-options', sha, 'HEAD'], { env })) !== null;
}

/**
 * The worktree of this clone (a remote of it names owner/name) that has `branch` checked out: `{ dir, head, contains }`
 * (`contains`: whether its HEAD holds the reviewed head, null when this clone does not hold that commit), or
 * `{ error, dirs? }`: `not_a_repo`, `not_this_repo`, `no_worktree` (it never checks out a branch) or
 * `several_worktrees`.
 */
export async function findWorktree({ repo, owner, name, branch, head, env, git = gitOut }) {
  const common = await commonDirOf(repo, { git: (d, a) => git(d, a, { env }) });
  if (common === null) return { error: 'not_a_repo' };
  const key = repoKeyOf(owner, name);
  const ours = (await repositoriesOf(common, { env, git })).some((r) => repoKeyOf(r.owner, r.name) === key);
  if (!ours) return { error: 'not_this_repo' };
  const found = await treesWith(common, branch, { env, git });
  if (!found.size) return { error: 'no_worktree' };
  if (found.size > 1) return { error: 'several_worktrees', dirs: [...found.keys()] };
  const [[dir, tree]] = [...found];
  return { dir, head: tree.head, contains: await holds(dir, head, { env, git }) };
}

/**
 * The worktree with `branch` checked out among the clones whose pushes Sonah reviews on this computer (team/hooks.json)
 * that are of owner/name, for a terminal that is in no clone of it: `{ dir, head, contains }` when there is exactly
 * one, else `{ error: 'no_clone' | 'no_worktree' | 'several_worktrees', dirs? }`. D229 review 2: of the clones whose
 * push hook is for `server`, the connection's, as `connectedRepositories` reads them, so a clone of the same
 * repository that another server reviews is neither picked nor counted here.
 */
export async function findConnectedWorktree({ where, owner, name, branch, head, env, git = gitOut, server }) {
  const listed = await readHooks(where);
  const key = repoKeyOf(owner, name);
  let clones = 0;
  const found = new Map();
  for (const repo of listed.state === 'ok' ? listed.repos : []) {
    if (repo.server !== server) continue;
    if (!isAbsolute(repo.common) || !(await isDir(repo.common))) continue;
    const ours = (await repositoriesOf(repo.common, { env, git })).some((r) => repoKeyOf(r.owner, r.name) === key);
    if (!ours) continue;
    clones += 1;
    for (const [dir, tree] of await treesWith(repo.common, branch, { env, git })) found.set(dir, tree);
  }
  if (!clones) return { error: 'no_clone' };
  if (!found.size) return { error: 'no_worktree' };
  if (found.size > 1) return { error: 'several_worktrees', dirs: [...found.keys()] };
  const [[dir, tree]] = [...found];
  return { dir, head: tree.head, contains: await holds(dir, head, { env, git }) };
}

// ---------- the session ----------

/**
 * The Claude Code folders a recording is looked for in, each `{ dir, spell }`: the one --config-dir names alone, else
 * CLAUDE_CONFIG_DIR when it is set, ~/.claude, and any extra (a launch record's), each folder once. `spell` is how
 * CLAUDE_CONFIG_DIR names that folder for Claude Code (null: unset, its own default), so a login keyed to the string
 * of the variable stays the one the person uses (D151): the spelling of the environment for its folder, and none for
 * ~/.claude.
 */
export function claudeFolders({ env = process.env, configDir = null, extra = [] } = {}) {
  const home = env.HOME || homedir();
  const byDefault = join(home, '.claude');
  const fromEnv = claudeConfigDirForCalls(env);
  // Which folder a path names, so two spellings of one folder are one folder; a path that is not there is itself.
  const real = (path) => { try { return realpathSync(path); } catch { return resolve(path); } };
  const spellOf = (dir) => (fromEnv && real(fromEnv) === real(dir) ? fromEnv
    : real(byDefault) === real(dir) ? null : dir);
  const wanted = configDir ? [isAbsolute(configDir) ? configDir : resolve(configDir)]
    : [...(fromEnv ? [fromEnv] : []), byDefault, ...extra.filter((x) => typeof x === 'string' && isAbsolute(x))];
  const seen = new Set(), out = [];
  for (const dir of wanted) {
    const named = real(dir);
    if (seen.has(named)) continue;
    seen.add(named);
    out.push({ dir, spell: spellOf(dir) });
  }
  return out;
}

/** The recordings whose file names carry the id (D142's resolver, file names only) in the projects of each folder,
 *  each with its folder, in path order. */
export async function findRecordings(id, folders) {
  const out = [];
  for (const folder of folders)
    for (const match of await recordingsNamed(id, { claudeProjects: join(folder.dir, 'projects'), codexHome: null }))
      out.push({ ...match, folder });
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * The session that wrote the item, by structure (sonah-hosted FIXLOOP.md): of the sessions that the Agent-Session lines
 * of the range name, the one whose newest commit touched a file of the item's functions. It is resumed (forked) only
 * when exactly one plain recording carries its id and D143 shows that commit in it (a tool call of it spans the time of
 * the commit, in a folder of this repository) -> `{ kind: 'fork', session, recording, commit }`,
 * `{ kind: 'new', why, session? }` or `{ kind: 'stop', why: 'several_recordings', session, found }`. `env` is the
 * environment its git calls run in (`localGitEnv`'s, as every other git call of this command), not the person's own.
 */
export async function pickSession({ dir, base, head, files, folders, env, git = gitOut, find = findRecordings }) {
  const range = `${base}..${head}`;
  const run = asRunGit(git, env);
  let listed;
  try { listed = await commitsOf(range, { cwd: dir, run }); } catch { return { kind: 'new', why: 'range_unreadable' }; }
  const naming = listed.commits.filter((c) => c.ids.length);
  if (!naming.length) return { kind: 'new', why: 'no_agent_commit' };
  const changed = await changedPaths(dir, range, { env, git });
  if (changed === null) return { kind: 'new', why: 'range_unreadable' };
  const want = new Set(files);
  const pick = naming.find((c) => (changed.get(c.hash) ?? []).some((p) => want.has(p)));
  if (!pick) return { kind: 'new', why: 'no_agent_commit' };
  if (pick.ids.length !== 1) return { kind: 'new', why: 'several_sessions' };
  const [id] = pick.ids;
  // Only the recordings of this session are looked for, so no recording of another session is read.
  let mine = [];
  const named = async (sid) => { if (sid !== id) return []; mine = await find(sid, folders); return mine; };
  let found;
  try { found = await sessionsOfCommits(range, { cwd: dir, roots: { claude: null, codex: null }, run, named }); }
  catch { return { kind: 'new', why: 'range_unreadable' }; }
  const session = found.sessions.find((s) => s.id === id);
  if (!session || session.state === NONE) return { kind: 'new', why: 'not_here', session: id };
  if (session.state === SEVERAL) return { kind: 'stop', why: 'several_recordings', session: id, found: mine };
  if (session.state === COMPRESSED || session.state !== ONE) return { kind: 'new', why: 'not_readable', session: id };
  if (session.commits.find((c) => c.hash === pick.hash)?.link !== SHOWN)
    return { kind: 'new', why: 'not_shown', session: id };
  return { kind: 'fork', session: id, recording: session.recording, commit: pick.hash };
}

/** The plan of this fix: --new; else the newest session of the launch record of this comment, when its recording is
 *  found again; else `pickSession`. `env` is the person's own, which names the Claude Code folders (HOME,
 *  CLAUDE_CONFIG_DIR); the git calls of the range run in `localGitEnv`'s, as every other git call of this command. */
export async function planFix({ dir, review, item, record, env, configDir, fresh, git = gitOut,
  find = findRecordings }) {
  if (fresh) return { kind: 'new', why: 'asked' };
  const last = record?.launches?.at(-1) ?? null;
  if (last) {
    const folders = claudeFolders({ env, configDir, extra: last.configDir ? [last.configDir] : [] });
    const found = await find(last.session, folders);
    if (found.length > 1) return { kind: 'stop', why: 'several_recordings', session: last.session, found };
    if (found.length === 1 && found[0].file.endsWith('.jsonl'))
      return { kind: 'fork', session: last.session, recording: found[0], last: true };
  }
  return pickSession({ dir, base: review.base, head: review.head, files: item.files,
    folders: claudeFolders({ env, configDir }), env: localGitEnv(env), git, find });
}

// ---------- the terminal ----------

/** The terminal of this process: whether its standard input and output are both one, a writer, and one question. */
export function processTerminal() {
  return {
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    out: (text) => process.stdout.write(text),
    ask: (question) => new Promise((done) => {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      let answer = '';
      terminal.on('SIGINT', () => { process.stdout.write('\n'); terminal.close(); });
      terminal.on('close', () => { process.stdin.pause(); done(answer); });
      terminal.question(question, (said) => { answer = said; terminal.close(); });
    }),
  };
}

// A child on this terminal, waited for, with Ctrl-C and Ctrl-\ left to the child (as git does with an editor).
function runOnTerminal(command, args, options) {
  const ignore = () => {};
  process.on('SIGINT', ignore);
  process.on('SIGQUIT', ignore);
  return new Promise((done) => {
    let child;
    const end = (result) => {
      process.removeListener('SIGINT', ignore);
      process.removeListener('SIGQUIT', ignore);
      done(result);
    };
    try { child = spawn(command, args, { ...options, stdio: 'inherit' }); }
    catch (error) { end({ error }); return; }
    child.once('error', (error) => end({ error }));
    child.once('exit', (code, signal) => end({ code: code ?? 128 + (osConstants.signals[signal] ?? 0) }));
  });
}

/** The prompt edited in $VISUAL or $EDITOR, on a 0600 file in a private folder removed after: `{ text }`, or
 *  `{ text: null, why }` when no editor is set or it did not finish. */
export async function editPrompt(text, env, { run = runOnTerminal } = {}) {
  const editor = env.VISUAL || env.EDITOR;
  if (!editor) return { text: null, why: FIX_WORDS.noEditor };
  const dir = await mkdtemp(join(env.TMPDIR || tmpdir(), 'sonah-fix-'));
  try {
    const file = join(dir, 'prompt.txt');
    await writeFile(file, text, { mode: 0o600, flag: 'wx' });
    // as git runs an editor: the person's own command, with the file as its argument
    const r = await run('/bin/sh', ['-c', `${editor} "$@"`, editor, file], { env });
    if (r.error || r.code !== 0) return { text: null, why: FIX_WORDS.editorFailed };
    let next = await readFile(file, 'utf8');
    if (!text.endsWith('\n')) next = next.replace(/\r?\n$/, ''); // the line end that an editor adds
    return { text: next };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// ---------- the lines of a listing ----------

const clip = (text, max) => {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}${CUT}`;
};

/** How one waiting comment reads in a listing: who wrote, how, on what; and the first line of their words. Text of the
 *  server is shown with nothing hidden (fix-prompt.mjs `shown`). */
export function entryLines(entry) {
  const what = entry.item.kind === 'finding' ? `${FRAME.tiers[entry.item.tier]}: ${entry.item.title}`
    : entry.item.title;
  const where = entry.pr.number === null ? entry.pr.branch : `PR #${entry.pr.number}`;
  const head = FIX_WORDS.entry(entry.comment.by, FRAME.verbs[entry.comment.act], where,
    shown(clip(what, TITLE_SHOWN_MAX)));
  return entry.comment.first === null ? [head] : [head, shown(entry.comment.first)];
}

// ---------- the problems ----------

const problemText = (code, args = [], fixArgs = args) => {
  if (!FIX_PROBLEMS.includes(code)) throw new Error('not a fix problem');
  const says = FIX_WORDS.problem[code], fix = FIX_WORDS.fix[code];
  const line = typeof says === 'function' ? says(...args) : says;
  return `${line}\nFix: ${typeof fix === 'function' ? fix(...fixArgs) : fix}\n`;
};

/** The line of a connection that no command can use: none, one Sonah cannot read, or one its server refuses (D227's
 *  words, as `sonah share` says them), or null when the connection is there and still taken. */
async function connectionProblem(where) {
  const saved = await readConnection(where);
  if (saved.state !== 'ok')
    return { line: `${PUSH_RUN_WORDS.why[saved.state === 'absent' ? 'not_connected' : 'connection_unreadable']}\n` };
  if (await isRefused(saved.connection, where))
    return { line: `${whyWords({ why: 'refused', server: saved.connection.server })}\n` };
  return { connection: saved.connection };
}

/** D229 review 2: the problems whose fix `sonah connect` says by its own `--server`, which neither of these commands
 *  takes. */
const OWN_FIX = Object.freeze(['team_refused', 'team_redirect', 'team_answer']);
/** The fix of a refused call, in these commands' own words where `sonah connect`'s name an option they do not take, or
 *  null when the problem has no fix: the 403 of someone in no team names what to do on the server, and any other such
 *  refusal names the connection, which is where the server of the call comes from. */
function refusalFix(code, error, server) {
  if (error.kind === 'refused' && error.status === 403 && error.code === 'not_member')
    return FIX_WORDS.notMemberFix(server);
  if (OWN_FIX.includes(code)) return FIX_WORDS.refusedFix;
  const fix = TEAM_FIX_WORDS[code];
  if (fix === undefined) return null;
  return typeof fix === 'function' ? fix(server) : fix;
}

/** What a failed call says, with the token marked refused on a 401 (as a push run and a share do), and the exit code
 *  2: an error that is not the server's is thrown on (Sonah failed). */
async function callFailed(error, { where, connection, stderr }) {
  const code = teamProblemOf(error);
  if (code === null) throw error;
  if (error.kind === 'refused' && error.status === 401) {
    await markRefused(connection, where).catch(() => {});
    stderr.write(`${whyWords({ why: 'refused', server: connection.server })}\n`);
    return 2;
  }
  const says = TEAM_PROBLEM_WORDS[code];
  const args = code === 'team_refused' ? [connection.server, error.status, error.code] : [connection.server];
  stderr.write(`${typeof says === 'function' ? says(...args) : says}\n`);
  const fix = refusalFix(code, error, connection.server);
  if (fix !== null) stderr.write(`Fix: ${fix}\n`);
  return 2;
}

// ---------- sonah fixes ----------

/**
 * `sonah fixes [--repo DIR] [--json]`: the exit code. One GET /api/fixes a repository, the answer checked by shape and
 * kept in the waiting cache of this connection. `git` runs git (team-git.js `gitOut`'s shape) and `fetch` makes the
 * calls, each injectable, so a test reaches only its own server.
 */
export async function runFixesCommand(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env,
  cwd = undefined, fetch = globalThis.fetch, git = gitOut } = {}) {
  let options;
  try { options = parseFixesArgs(argv); }
  catch (error) {
    if (error?.code !== 'usage') throw error;
    stderr.write(`sonah fixes: ${error.problem}.\nusage: ${FIXES_USAGE}\n`);
    return 2;
  }
  const where = { env };
  const local = localGitEnv(env);
  const found = await connectionProblem(where);
  if (found.line) { stderr.write(found.line); return 2; }
  const { connection } = found;
  const root = resolve(cwd ?? process.cwd(), options.repo ?? '.');
  const mine = await repositoryOf(root, { env: local, git });
  const repos = mine ? [mine]
    : options.repo === null ? await connectedRepositories(where, { env: local, git, server: connection.server }) : [];
  if (!repos.length) { stderr.write(problemText('fix_no_repository', [connection.server])); return 2; }
  const api = teamApi({ server: connection.server, token: connection.token, fetch });
  const lists = [];
  for (const repo of repos) {
    let answer;
    try { answer = await api.fixes({ owner: repo.owner, name: repo.name }); }
    catch (error) {
      if (!(error instanceof TeamApiError)) throw error;
      return callFailed(error, { where, connection, stderr });
    }
    const list = checkList(answer, { owner: repo.owner, name: repo.name });
    if (list === null) { stderr.write(problemText('fix_bad_list', [connection.server])); return 2; }
    await saveWaiting(where, connection, list);
    lists.push(list);
  }
  const dropped = lists.reduce((n, list) => n + list.dropped, 0);
  if (dropped) stderr.write(`${FIX_WORDS.dropped(dropped)}\n`);
  if (options.json) {
    const one = (list) => ({ repo: list.repo, total: list.total, fixes: list.fixes });
    stdout.write(`${jsonText(lists.length === 1 ? one(lists[0]) : lists.map(one))}\n`);
    return 0;
  }
  lists.forEach((list, i) => {
    const repo = `${list.repo.owner}/${list.repo.name}`;
    if (i) stdout.write('\n');
    if (!list.total) { stdout.write(`${FIX_WORDS.none(shown(repo))}\n`); return; }
    stdout.write(`${FIX_WORDS.heading(list.total, shown(repo))}\n`);
    for (const entry of list.fixes) {
      const [what, first] = entryLines(entry);
      stdout.write('\n');
      stdout.write(`  ${what}${entry.state === 'launched' ? ` (${FIX_WORDS.onIt})` : ''}\n`);
      if (first) stdout.write(`  ${first}\n`);
      stdout.write(`  sonah fix ${entry.comment.id}\n`);
    }
    if (list.total > list.fixes.length) stdout.write(`\n  ${FIX_WORDS.more(list.total - list.fixes.length)}\n`);
  });
  return 0;
}

// ---------- sonah fix ----------

const indent = (text) => text.split('\n').map((line) => (line ? `  ${shown(line)}` : '')).join('\n');

/** Where the prompt goes, in words: a copy of a session, or a new session with the reason for it. */
function whereItGoes(plan, dir) {
  if (plan.kind === 'fork') {
    const says = plan.last ? FIX_WORDS.toLast : FIX_WORDS.toFork;
    return says(short(plan.session), shown(dir), shown(plan.recording.folder.dir));
  }
  const why = FIX_WORDS.why[plan.why];
  return FIX_WORDS.toNew(shown(dir), typeof why === 'function' ? why(short(plan.session)) : why);
}

/**
 * `sonah fix <comment id> [--repo DIR] [--config-dir DIR] [--new]`: the exit code. `terminal` is `processTerminal()`
 * from the entry; a test passes its own. Every message goes to the terminal, and nothing reaches the model without a
 * yes. `git` runs git, `fetch` makes the calls and `run` runs a child on the terminal, each injectable.
 */
export async function runFixCommand(argv, { stderr = process.stderr, env = process.env, cwd = undefined,
  fetch = globalThis.fetch, git = gitOut, terminal = processTerminal(), run = runOnTerminal } = {}) {
  let options;
  try { options = parseFixArgs(argv); }
  catch (error) {
    if (error?.code !== 'usage') throw error;
    stderr.write(`sonah fix: ${error.problem}.\nusage: ${FIX_USAGE}\n`);
    return 2;
  }
  const say = (text) => terminal.out(`${text}\n`);
  const stop = (code, args = [], fixArgs = args) => { stderr.write(problemText(code, args, fixArgs)); return 2; };
  const { id } = options;
  if (!isCommentId(id)) return stop('fix_bad_id');
  if (typeof env.CLAUDECODE === 'string' && env.CLAUDECODE !== '') return stop('fix_inside_claude');
  if (!terminal.isTTY) return stop('fix_no_terminal');
  const claude = await claudeOnPath(env);
  if (claude === null) return stop('fix_no_claude');
  const where = { env };
  const local = localGitEnv(env);
  const found = await connectionProblem(where);
  if (found.line) { stderr.write(found.line); return 2; }
  const { connection } = found;
  const origin = new URL(connection.server).origin;

  let got;
  try {
    got = checkFix(await teamApi({ server: connection.server, token: connection.token, fetch })
      .one(id, { timeoutMs: TEAM_API_TIMEOUT_MS.fixes }), { id, origin });
  } catch (error) {
    if (error instanceof FixShapeError) return stop('fix_bad_answer', [connection.server, error.where]);
    if (!(error instanceof TeamApiError)) throw error;
    if (error.kind === 'refused' && error.status === 404) return stop('fix_not_waiting', [id, connection.server]);
    if (error.kind === 'refused' && error.status === 409) return stop('fix_not_fixable', [id]);
    return callFailed(error, { where, connection, stderr });
  }
  if (FIX_FINAL_STATES.includes(got.fix.state)) { say(FIX_WORDS.finalState(got.fix.state)); return 0; }
  const { review } = got;
  let prompt;
  try {
    prompt = fixPrompt({ review, item: got.item, comment: got.comment, thread: got.thread, publicUrl: origin });
  } catch (error) {
    if (error instanceof FixShapeError) return stop('fix_bad_answer', [connection.server, error.where]);
    throw error;
  }

  const repo = resolve(cwd ?? process.cwd(), options.repo ?? '.');
  let tree = await findWorktree({ repo, owner: review.owner, name: review.name, branch: review.branch,
    head: review.head, env: local, git });
  // A terminal in no clone of it (and no --repo): the one worktree with the branch among the connected clones.
  if (options.repo === null && (tree.error === 'not_a_repo' || tree.error === 'not_this_repo')) {
    const other = await findConnectedWorktree({ where, owner: review.owner, name: review.name,
      branch: review.branch, head: review.head, env: local, git, server: connection.server });
    if (other.error !== 'no_clone') tree = other;
  }
  const named = `${review.owner}/${review.name}`;
  if (tree.error === 'not_a_repo') return stop('fix_not_git', [shown(repo)]);
  if (tree.error === 'not_this_repo') return stop('fix_not_this_repo', [shown(named)]);
  if (tree.error === 'no_worktree') return stop('fix_no_worktree', [shown(review.branch)], [shown(review.branch)]);
  if (tree.error === 'several_worktrees')
    return stop('fix_several_worktrees', [shown(review.branch), tree.dirs.map(shown).join(', ')]);

  let record;
  try { record = await readLaunch(where, id); }
  catch (error) {
    if (error?.code !== 'fix_record_unreadable') throw error;
    return stop('fix_record_unreadable', [error.file]);
  }
  const plan = await planFix({ dir: tree.dir, review, item: got.item, record, env, configDir: options.configDir,
    fresh: options.fresh, git });
  if (plan.kind === 'stop') {
    const folders = [...new Set(plan.found.map((m) => m.folder.dir))];
    return stop('fix_several_recordings', [short(plan.session), plan.found.map((m) => shown(m.file)).join(', ')],
      [folders.map(shown)]);
  }

  say(`${FIX_WORDS.prompt}\n\n${indent(prompt)}\n`);
  if (tree.contains === null) say(FIX_WORDS.headNotHere(review.head.slice(0, 12)));
  else if (!tree.contains) say(FIX_WORDS.headNotHeld(review.head.slice(0, 12)));
  say(whereItGoes(plan, tree.dir));
  // A9: the Agent-Session line of D143 is what marks a fix pushed, so a folder without it is told before the question.
  // Review 2: read in `hookGitEnv`, so a core.hooksPath of the person's own config files is the one git uses here too;
  // and where that read is `not_checked`, Sonah says it cannot tell instead of saying the line is off.
  // Review 3: D143 reads `not_checked` in two cases, and only one of them asks nothing of the person: `lineIn` names
  // the file that holds Sonah's own line. Where it is null, the hook git runs is another tool's and no line of Sonah's
  // is there, which is what `sonah hook add` prints.
  const link = await commitLinkFacts(tree.dir, { git: (d, a) => git(d, a, { env: hookGitEnv(env) }) })
    .catch(() => null);
  if (link !== null && link.state !== LINK_ON) {
    const folder = shown(tree.dir);
    if (link.state !== LINK_NOT_CHECKED) say(FIX_WORDS.noLink(folder));
    else say(link.lineIn ? FIX_WORDS.linkNotChecked(folder) : FIX_WORDS.linkAddLine(folder));
  }
  for (;;) {
    const said = (await terminal.ask(FIX_WORDS.question)).trim().toLowerCase();
    if (said === 'y' || said === 'yes') break;
    if (said !== 'e' && said !== 'edit') { say(FIX_WORDS.nothingSent); return 1; }
    const edited = await editPrompt(prompt, env, { run });
    if (edited.text === null) { say(edited.why); continue; }
    if (!sendable(edited.text)) { say(FIX_WORDS.editorFirstWord(FIRST_WORD)); continue; }
    prompt = edited.text;
    say(`${FIX_WORDS.prompt}\n\n${indent(prompt)}\n`);
  }

  const session = randomUUID();
  const forkOf = plan.kind === 'fork' ? plan.session : null;
  const childEnv = { ...env };
  // CLAUDE_CONFIG_DIR only ever names the folder the recording was found in; for a new session, the folder Sonah
  // looked in, as D151 names it (`claudeConfigDirForCalls`). Review 2: a new session had the person's own value, and
  // a relative one names another folder from each working folder — Claude Code runs in the worktree, so it would make
  // its home inside the repository under review, and the launch record of such a folder is one `claudeFolders` leaves
  // out, so a second fix of the comment would find no session of it.
  const spell = plan.kind === 'fork' ? plan.recording.folder.spell : claudeConfigDirForCalls(env);
  if (spell === null) delete childEnv.CLAUDE_CONFIG_DIR;
  else childEnv.CLAUDE_CONFIG_DIR = spell;
  const argvOf = claudeArgv({ prompt, session, forkOf });
  await appendLaunch(where, { comment: id, review: review.url, repo: named, branch: review.branch, base: review.base,
    head: review.head }, { session, forkOf,
    configDir: typeof childEnv.CLAUDE_CONFIG_DIR === 'string' && childEnv.CLAUDE_CONFIG_DIR !== ''
      ? childEnv.CLAUDE_CONFIG_DIR : null,
    cwd: tree.dir, prompt, at: new Date().toISOString() });
  // the lines stop counting this comment (the push hook's, sonah status's) until the next refresh
  await markLaunched(where, connection, repoKeyOf(review.owner, review.name), id).catch(() => {});
  try {
    await teamApi({ server: connection.server, token: connection.token, fetch })
      .launched(id, { session, forkOf }, { timeoutMs: FIX_LAUNCHED_TIMEOUT_MS });
  } catch (error) {
    if (!(error instanceof TeamApiError)) throw error;
    say(FIX_WORDS.notTold(error.kind));
  }
  const ran = await run(claude, argvOf, { cwd: tree.dir, env: childEnv });
  // Decision 9: Claude Code's own exit code is not passed through; it ran and ended, so this ends 0.
  if (ran.error) return stop('fix_claude_failed', [ran.error.code ?? ran.error.message]);
  return 0;
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ FIX_WORDS: 'notice', 'FIX_WORDS.fix': 'action',
  'FIX_WORDS.heading': 'heading', 'FIX_WORDS.prompt': 'heading', 'FIX_WORDS.entry': 'label',
  'FIX_WORDS.onIt': 'status', 'FIX_WORDS.more': 'label', 'FIX_WORDS.question': 'label',
  'FIX_WORDS.refusedFix': 'action', 'FIX_WORDS.notMemberFix': 'action',
  'FIX_WORDS.why': 'fragment' });
export const STYLE_ALLOW = Object.freeze({ 'FIX_WORDS.problem.fix_no_claude': ['quoted-term'],
  'FIX_WORDS.fix.fix_claude_failed': ['quoted-term'] });
const SERVER = 'https://pr.sonah.dev';
const ID = 'c_00112233445566ff';
export const STYLE_FIXTURES = Object.freeze({
  'FIX_WORDS.problem.fix_no_repository': [[SERVER]],
  'FIX_WORDS.problem.fix_bad_list': [[SERVER]],
  'FIX_WORDS.problem.fix_bad_answer': [[SERVER, 'item.tier']],
  'FIX_WORDS.problem.fix_not_waiting': [[ID, SERVER]],
  'FIX_WORDS.problem.fix_not_fixable': [[ID]],
  'FIX_WORDS.problem.fix_not_git': [['/tmp/sonah/work']],
  'FIX_WORDS.problem.fix_not_this_repo': [['acme/widgets']],
  'FIX_WORDS.problem.fix_no_worktree': [['feature-x']],
  'FIX_WORDS.problem.fix_several_worktrees': [['feature-x', '/tmp/sonah/a, /tmp/sonah/b']],
  'FIX_WORDS.problem.fix_several_recordings': [['1f0c6a52', '/tmp/sonah/cc-home/projects/w/s.jsonl']],
  'FIX_WORDS.problem.fix_record_unreadable': [['/tmp/sonah/team/fixes/c_0.json']],
  'FIX_WORDS.problem.fix_claude_failed': [['ENOENT']],
  'FIX_WORDS.fix.fix_no_worktree': [['feature-x']],
  'FIX_WORDS.fix.fix_several_recordings': [[['/tmp/sonah/cc-home']],
    [['/tmp/sonah/cc-home', '/tmp/sonah/other-cc-home']]],
  'FIX_WORDS.none': [['acme/widgets']],
  'FIX_WORDS.heading': [[1, 'acme/widgets'], [3, 'acme/widgets']],
  'FIX_WORDS.entry': [['ben', 'asked', 'PR #12', 'Must act: add throws on strings']],
  'FIX_WORDS.more': [[4]],
  'FIX_WORDS.dropped': [[2]],
  'FIX_WORDS.toFork': [['1f0c6a52', '/tmp/sonah/work', '/tmp/sonah/cc-home']],
  'FIX_WORDS.toLast': [['1f0c6a52', '/tmp/sonah/work', '/tmp/sonah/cc-home']],
  'FIX_WORDS.toNew': [['/tmp/sonah/work', FIX_WORDS.why.asked]],
  'FIX_WORDS.why.not_here': [['1f0c6a52']],
  'FIX_WORDS.why.not_readable': [['1f0c6a52']],
  'FIX_WORDS.why.not_shown': [['1f0c6a52']],
  'FIX_WORDS.headNotHere': [['0123456789ab']],
  'FIX_WORDS.headNotHeld': [['0123456789ab']],
  'FIX_WORDS.noLink': [['/tmp/sonah/work']],
  'FIX_WORDS.linkNotChecked': [['/tmp/sonah/work']],
  'FIX_WORDS.linkAddLine': [['/tmp/sonah/work']],
  'FIX_WORDS.editorFirstWord': [['A']],
  'FIX_WORDS.notMemberFix': [[SERVER]],
  'FIX_WORDS.notTold': [['unreachable']],
  'FIX_WORDS.finalState': [['resolved']],
});
