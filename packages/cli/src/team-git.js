// D225 (item 10, C3): the git calls of the team commands, from the private laptop client's git.mjs (sonah-hosted
// client/git.mjs). Each runs git with argv only (no shell), in the person's own environment, as D143's hook does: where
// git runs a hook (core.hooksPath) can come from any of the person's git config files (XDG_CONFIG_HOME,
// GIT_CONFIG_GLOBAL, a hook's GIT_DIR), so Sonah reads it as the person's git does. An answer git does not give (a
// failure, the time ran out, no git) is null, never an error with git's words.
// D227 (item 10, C4): the push run's calls, each with the environment its caller gives (push-run.js: extract.mjs
// `gitEnv`'s kept names, and for a call that reaches the remote also the SSH agent, with no prompt). A remote URL is
// read here and never logged or shown: only the owner and name taken from it (`remoteRepository`).
// D229 (item 10, C6): `remoteRepository` is this module's, and visual-command.js re-exports it, so the hidden `sonah
// pre-push` reads the repository of the URL git gave it — for the line of the comments that wait (push-hook-run.js,
// fix-waiting.js) — without loading visual-command.js and the code snapshot and code pass behind it (D225 review,
// second look 1, which moved `visualServer` out for the same reason).
//
// No work at import.
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isName, isOwner } from '../../visual/src/fix-prompt.mjs';

/** A full commit id: SHA-1 or SHA-256. */
export const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** How long a local git call may take, in ms. */
export const GIT_TIMEOUT_MS = 30_000;

/** `git -C dir ...args`: its standard output, or null when git fails, runs out of time or is not there. */
export function gitOut(dir, args, { env = process.env, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  return new Promise((done) => {
    execFile('git', ['-C', dir, ...args], { env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8',
      killSignal: 'SIGKILL' }, (error, stdout) => done(error ? null : stdout));
  });
}

/** The real path of the git common dir of the repository that holds `dir` (the same for all its worktrees), or null
 *  when `dir` is in none. `git` is a call of `gitOut`'s shape. */
export async function commonDirOf(dir, { git = gitOut } = {}) {
  const out = (await git(dir, ['rev-parse', '--git-common-dir']))?.replace(/\n$/, '');
  if (!out) return null;
  try { return await realpath(resolve(dir, out)); } catch { return null; }
}

/** The worktrees of the repository whose git common dir is `common`, as git lists them:
 *  `[{ path, bare, head, branch, prunable }]`, the main one first; empty when git cannot list them. `-z` keeps a path
 *  with a newline whole, but git has it only since 2.36 (Ubuntu 22.04 has 2.34, Debian 11 2.30): an older git refuses
 *  it, and the list is read again without it, one field to a line. D229: `head` is the commit it has checked out and
 *  `branch` the ref (null when it is detached), which `sonah fix` reads to find the worktree of a branch, and
 *  `prunable` whether git says its folder is gone. */
export async function worktreesOf(common, { git = gitOut, env } = {}) {
  const run = (args) => git(common, args, env === undefined ? {} : { env });
  const nul = await run(['worktree', 'list', '--porcelain', '-z']);
  const fields = typeof nul === 'string' ? nul.split('\0')
    : ((await run(['worktree', 'list', '--porcelain'])) ?? '').split('\n');
  const list = [];
  let current = null;
  for (const field of fields) {
    if (field === '') { current = null; continue; }
    const space = field.indexOf(' ');
    const key = space < 0 ? field : field.slice(0, space), value = space < 0 ? '' : field.slice(space + 1);
    if (key === 'worktree') {
      current = { path: value, bare: false, head: null, branch: null, prunable: false };
      list.push(current);
    } else if (current && key === 'bare') current.bare = true;
    else if (current && key === 'HEAD') current.head = SHA.test(value) ? value : null;
    else if (current && key === 'branch') current.branch = value;
    else if (current && key === 'prunable') current.prunable = true;
  }
  return list;
}

/** The committer time (seconds) of each commit of `shas` that git knows here, in one call: Map sha -> time. Empty when
 *  git cannot say (a sha that is not a commit here). */
export async function commitTimes(dir, shas, { git = gitOut, timeoutMs } = {}) {
  const wanted = [...new Set(shas)].filter((sha) => SHA.test(sha));
  const times = new Map();
  if (!wanted.length) return times;
  const out = await git(dir, ['log', '--no-walk=unsorted', '--format=%H %ct', ...wanted],
    timeoutMs === undefined ? {} : { timeoutMs });
  for (const line of (out ?? '').split('\n')) {
    const [sha, time] = line.split(' ');
    if (SHA.test(sha ?? '') && /^\d+$/.test(time ?? '')) times.set(sha, Number(time));
  }
  return times;
}

// D227 review (second look 1): a target whose first colon comes before any slash is git's scp-style URL,
// `[user@]host:path`, whether or not it names a user (git's own rule: the colon with no slash before it), and a
// remote's name holds no colon at all, since `refs/remotes/<name>/<branch>` would then be no ref. Read with the user
// required (`user@host:path`), `git push git.example.com:acme/widgets.git HEAD` and an ssh-config alias's
// `gh:acme/widgets.git` were taken for remote names: `pushUrlOf` then asked git for the push URL of a remote of that
// name and got none, so the push's review ended `no_repository`, and the run kept a `remote` that runs.json's own
// shape refused, which dropped the whole row at every write of it (team-home.js `RUN_KEYS`).
const isUrl = (text) => /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[^/\s]*:/.test(text) || text.startsWith('/')
  || text.startsWith('.');
/** D227: whether `remote` is a remote's name as git gave the hook, not a URL or a path. runs.json keeps a run's remote
 *  by this same check (team-home.js `RUN_KEYS.remote`), so what the hook and the run call a name is one thing. */
export const isRemoteName = (remote) => typeof remote === 'string' && remote !== '' && remote.length <= 200
  && !remote.startsWith('-') && !isUrl(remote) && !/[\s\0]/.test(remote);
const isRemote = isRemoteName;
const firstLine = (out) => out?.replace(/\n[\s\S]*$/, '') ?? '';

// D221: the remotes whose URL names a repository on a server: git's network transports. A local path or a file: URL
// names a folder on this computer, never a repository the server knows, so its folders never go into the page.
const NETWORK_SCHEMES = Object.freeze(['https', 'http', 'ssh', 'git', 'git+ssh', 'ssh+git']);

/**
 * D221: the repository a remote URL names on its server, as `{ owner, name }`: the last two parts of its path, from a
 * network URL (`https://host/o/r.git`, `ssh://git@host/o/r`, ...) or git's short ssh form (`git@host:o/r.git`), on any
 * host; `.git` and trailing slashes are dropped. Null for a local path, a `file:` URL, any other form, or names the
 * server would refuse (D223: fix-prompt.mjs `isOwner` and `isName`, the checks the server itself uses, so the page
 * never carries an upload the server refuses for its name). Structure only: the URL is never shown or sent.
 */
export function remoteRepository(url) {
  if (typeof url !== 'string' || /[\s\0]/.test(url.trim())) return null;
  const text = url.trim();
  let path;
  const full = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(text);
  if (full) {
    if (!NETWORK_SCHEMES.includes(full[1].toLowerCase()) || full[2] === '') return null;
    path = full[3] ?? '';
  } else {
    // [user@]host:path, git's ssh form; a colon after a slash is a local path's (git reads it so too).
    const short = /^(?:[^@/:]+@)?([^/:]+):(.*)$/.exec(text);
    if (!short || short[2].startsWith('//')) return null;
    path = short[2];
  }
  const parts = path.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, name] = parts.slice(-2);
  return isOwner(owner) && isName(name) ? { owner, name } : null;
}

/** D229: the names of the remotes of the repository at `dir`, in git's order; empty when git names none. */
export async function remotesOf(dir, { env, git = gitOut } = {}) {
  return ((await git(dir, ['remote'], { env })) ?? '').split('\n').map((line) => line.trim())
    .filter((line) => isRemoteName(line));
}

/** D227: the full id of the commit `revision` names here, or null. */
export async function revParse(dir, revision, { env, git = gitOut } = {}) {
  if (typeof revision !== 'string' || revision === '' || revision.startsWith('-')) return null;
  const out = firstLine(await git(dir, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`],
    { env }));
  return SHA.test(out) ? out : null;
}

/** D227: the merge base of two commits, or null. */
export async function mergeBase(dir, a, b, { env, git = gitOut } = {}) {
  const out = firstLine(await git(dir, ['merge-base', '--end-of-options', a, b], { env }));
  return SHA.test(out) ? out : null;
}

/** D227: the real path of the top folder of the working tree that holds `dir`, or null (none, or bare). */
export async function topOf(dir, { env, git = gitOut } = {}) {
  const out = firstLine(await git(dir, ['rev-parse', '--show-toplevel'], { env }));
  if (!out) return null;
  try { return await realpath(out); } catch { return null; }
}

/** D227: the URL git pushes to for `remote`, a remote's name (its push URL, insteadOf applied) or a URL as git gave the
 *  hook; null when git names none. Never logged. */
export async function pushUrlOf(dir, remote, { env, git = gitOut } = {}) {
  if (typeof remote !== 'string' || remote === '' || remote.startsWith('-')) return null;
  if (isUrl(remote)) return remote;
  return firstLine(await git(dir, ['remote', 'get-url', '--push', '--', remote], { env })) || null;
}

/** D227 review (second look 2): where this computer keeps what a remote holds. A ref under it is moved by a fetch or a
 *  push of a remote and by nothing else a person does to their own work, which is what a reader of "the commit the
 *  branch holds on the remote" needs (push-run.js `pushedTip`). */
const TRACKING = 'refs/remotes/';

/**
 * D227: the remote-tracking ref that a push of `branch` to the named `remote` updates here (its fetch refspec maps
 * refs/heads/<branch> to it), or null: a remote given as a URL, or one whose refspecs map no such ref. No network.
 * D227 review (second look 2): a refspec target outside `refs/remotes/` maps no such ref. A clone whose fetch
 * refspec reaches into the local branch namespace — `+refs/*:refs/*` (mirror-style, and what a backup remote is
 * often given) or `+refs/heads/*:refs/heads/*` (some sync setups) — made this read return `refs/heads/<branch>`, so
 * `pushedTip` handed back THIS computer's own branch as the commit the remote holds, and `remoteShows` took a push
 * for shown as soon as the local branch reached the commit. This computer's own branch moves with no push at all (an
 * amend, a rebase, `git reset --hard`, `git checkout -B`), which is the whole of D228 review 5: in such a repository
 * a pass elected the review of the commit the local branch was moved to, ended the review of the commit the remote
 * holds `replaced`, `newer_push` — which `waitsToSend` is false for — and left the team reading the page of a commit
 * the remote does not hold. A target elsewhere costs the remote's own answer (`remoteTip`, `ls-remote`) instead of a
 * wrong one from here, which is what a clone whose refspecs map no such ref already pays (`pushedTip`, step 1).
 */
export async function trackingRef(dir, remote, branch, { env, git = gitOut } = {}) {
  if (!isRemote(remote)) return null;
  const want = `refs/heads/${branch}`;
  const specs = ((await git(dir, ['config', '--get-all', `remote.${remote}.fetch`], { env })) ?? '').split('\n')
    .map((line) => line.trim()).filter(Boolean);
  for (const raw of specs) {
    if (raw.startsWith('^')) continue;
    const [from, to] = raw.replace(/^\+/, '').split(':');
    if (!from || !to || !to.startsWith(TRACKING)) continue;
    const star = from.indexOf('*');
    if (star < 0) { if (from === want) return to; continue; }
    const before = from.slice(0, star), after = from.slice(star + 1);
    if (want.length >= before.length + after.length && want.startsWith(before) && want.endsWith(after))
      return to.replace('*', want.slice(before.length, want.length - after.length));
  }
  return null;
}

/** D227: the remote's default branch as git last saw it here (refs/remotes/<remote>/HEAD): `{ branch, sha }`, or null.
 *  No network. */
export async function localDefaultBranch(dir, remote, { env, git = gitOut } = {}) {
  if (!isRemote(remote)) return null;
  const prefix = `refs/remotes/${remote}/`;
  const ref = firstLine(await git(dir, ['symbolic-ref', '--quiet', `${prefix}HEAD`], { env }));
  if (!ref.startsWith(prefix) || ref === `${prefix}HEAD`) return null;
  const sha = await revParse(dir, ref, { env, git });
  return sha ? { branch: ref.slice(prefix.length), sha } : null;
}

/** D227: the commit the remote's `ref` names, asked of the remote (ls-remote): the sha, or null when it has no such
 *  ref, or undefined when git gave no answer. */
export async function remoteTip(dir, remote, ref, { env, git = gitOut, timeoutMs = 30_000 } = {}) {
  const out = await git(dir, ['ls-remote', '--', remote, ref], { env, timeoutMs });
  if (out === null) return undefined;
  for (const line of out.split('\n')) {
    const [sha, name] = line.split('\t');
    if (name === ref && SHA.test(sha)) return sha;
  }
  return null;
}

/** D227: the remote's default branch, asked of the remote (ls-remote --symref): `{ branch, sha }`, or null. */
export async function defaultBranch(dir, remote, { env, git = gitOut, timeoutMs = 30_000 } = {}) {
  const out = await git(dir, ['ls-remote', '--symref', '--', remote, 'HEAD'], { env, timeoutMs });
  let branch = null, sha = null;
  for (const line of (out ?? '').split('\n')) {
    const symbolic = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(line);
    if (symbolic) branch = symbolic[1];
    const [id, name] = line.split('\t');
    if (name === 'HEAD' && SHA.test(id)) sha = id;
  }
  return branch ? { branch, sha } : null;
}

/**
 * D227: the paths each commit of `range` changed, a rename as its two paths: Map sha -> [path], from one git log. With
 * -z every path ends in a NUL and none is empty, so the empty field the format puts before each commit's id marks
 * where the next commit starts, whatever the paths hold. Null when git cannot read the range.
 */
export async function changedPaths(dir, range, { env, git = gitOut } = {}) {
  if (typeof range !== 'string' || range.startsWith('-')) return null;
  const out = await git(dir, ['-c', 'log.showSignature=false', '-c', 'core.quotePath=false', 'log', '-z', '--no-color',
    '--no-renames', '--name-only', '--format=%x00%H', range, '--'], { env });
  if (out === null) return null;
  const parts = out.split('\0');
  const map = new Map();
  let current = null;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '') {
      if (SHA.test(parts[i + 1] ?? '')) { current = []; map.set(parts[i + 1], current); i++; }
      continue;
    }
    // git puts one line feed between a commit's line and its first path
    if (current) current.push(current.length === 0 && parts[i].startsWith('\n') ? parts[i].slice(1) : parts[i]);
  }
  return map;
}
