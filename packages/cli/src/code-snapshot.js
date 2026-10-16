// D87 (owner decisions 2026-10-13/14), the code step (owner decision 2026-10-14), made agentic under D90 (owner decision
// 2026-10-15: privacy is not a design constraint; the code step may see everything): what `sonah review` reads from
// disk for the code step, by structure, before its first call.
//
// The snapshot (`sonah.code-snapshot/10`): the change under review, the review agent's starting map — the paths the
// recorded session changed (evidence/src/code-pass.js `codeSnapshotPlan`), then every path that differs from the session's
// start commit (git's own list, and the untracked files a recorded edit wrote or that changed after the session began),
// each one's file now, its file at that commit and git's own patch of it. The start commit is the one the recording
// names, else the HEAD reflog entry in effect at the recording's first timestamp, else the newest first-parent commit of
// HEAD made by then; with none (no repository, no start commit), the diff is the recorded edits (code-pass.js). Git's
// lists stop at the working directory (a literal pathspec of it); how many paths differ outside it is counted
// (`outside`). A recorded write outside the working directory — by its name, the slicer's write scope, or where a link
// leads — is counted (`outside_root`), never part of the change reviewed. Only a regular file is read, never through a
// link at the last part of its real path, at most `maxBytes` (a larger one is `oversize`, never clipped). Every state is
// a closed one (evidence/src/ledger.js CODE_FILE_STATES); nothing here reads a file's words to decide anything. Nothing
// is withheld for privacy's sake: a harness home, a credential-shaped path and the home folder as the repository are no
// states any more (D90).
//
// The repository reader (`createRepositoryReader`): what the code step's grounding reads, injected into evidence like
// the judge — any file of the repository as it is now (`read`) or at the start commit (`base`), synchronous, each read
// once. A path outside the repository's top folder (after its links are resolved), a missing, non-regular, binary or
// over-bound file is none.
//
// The repository's state (`repositoryState`): a content hash of every file git lists as tracked or untracked and not
// ignored, as it is now, and the start commit — computed before the code step's first request and again after its last
// (cli/src/session-review.js `reviewCodePass`): when they differ the review records that the repository changed during
// it; and it keys the code step's stored answers (D60), so a review of an unchanged repository asks nothing twice. The
// places a review writes as it runs — what it writes in its state folder (by name, never the folder whole), Sonah's
// home, and the coding agents' homes, where the review's own agents and any other session write — are no part of it
// when they lie in the repository (a home folder kept in git). What Sonah writes is no part of the session's change
// either: of a place Sonah writes, only the files git does not track and no recorded edit wrote are left out of the
// change, since Sonah never writes one the session wrote and never adds one to git, so a project's own files there
// (a folder of it named like a state folder's entry) are reviewed. A place that holds the working directory is never
// left out of either; the CLI refuses a state folder that is the working directory or holds it.
//
// Git runs with optional locks off, no external diff or text conversion, no lazy fetch from a partial clone's promisor
// remote, and no GIT_* variable of the caller's, so it reads the repository as it is, writes nothing and reaches no
// network.
//
// Known limits. A file changed between its read and git's diff of it fails the diff's row-by-row check against the file
// and is listed by name only (`unreadable`). Ignored files are no part of the repository's state (Grep skips them too;
// Read opens them). A submodule's state is the commit git's index records for it. The state hashes every file git lists,
// twice a review: on a repository of very many untracked, unignored files (a home folder kept in git with no ignore
// file) that costs time in proportion, and a list larger than git's output bound leaves the state unknown (null).
import { closeSync, constants, createReadStream, fstatSync, lstatSync, openSync, readFileSync, readlinkSync, readSync,
  realpathSync } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { strictJson } from '../../slicer/src/strict-json.js';
import { codeSnapshotPlan, freezeCodeSnapshot } from '../../evidence/src/code-pass.js';
import { displayPath, HOME_SPELLED } from '../../evidence/src/code-context.js';
import { CODE_FILE_STATES, CODE_DIFF_BASES, CODE_START_COMMIT_SOURCES, CODE_CHANGE_TYPES } from '../../evidence/src/ledger.js';

const [GIT_BASE, RECORDED_EDITS_BASE] = CODE_DIFF_BASES;
const [FROM_RECORDING, FROM_REFLOG, FROM_COMMIT_DATE] = CODE_START_COMMIT_SOURCES;
const [ADDED, MODIFIED, DELETED_TYPE] = CODE_CHANGE_TYPES;
const [, , OVERSIZE, , DELETED, OUTSIDE_ROOT, UNREADABLE] = CODE_FILE_STATES;

/** How a file is opened: read only; never through a link at the last part of its real path (one there now was put
 *  there after the path was resolved); never waiting on a FIFO or a device, whose type is refused once it is open. */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** `path` lies at or under `root` (both absolute, normalized), by whole path segments. */
const inside = (path, root) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};
/** A path as the code step names it: relative to the working directory, slashes forward (`../…` for one elsewhere in the
 *  repository). */
const repoName = (real, realRoot) => relative(realRoot, real).split(sep).join('/');

/** The errors that say a path is not there (it, or a folder on it, is missing). */
const GONE = new Set(['ENOENT', 'ENOTDIR']);

/** Where an absolute path really leads: its real path, or, for a path not there, its nearest folder's real path with the
 *  rest joined on. Null when nothing of it can be resolved. */
async function realPlace(path) {
  try { return await realpath(path); }
  catch (error) {
    if (!GONE.has(error?.code)) return null;
    const parent = dirname(path);
    if (parent === path) return null;
    const above = await realPlace(parent);
    return above === null ? null : join(above, basename(path));
  }
}

/**
 * The places a review writes while it runs, or a harness does (`places`, absolute: what Sonah writes in its state
 * folder, Sonah's home, the coding agents' homes), as git names them under the repository's real top folder `realTop`:
 * the real place of each one that lies in the repository (`realPlace`, so a folder not made yet counts by where it will
 * be) — never one that holds the working directory (`realRoot`; the top folder when none is given), which would leave
 * out the change under review itself. What `leftOutBy` then tells apart.
 */
async function leftOutPaths(places, realTop, realRoot = realTop) {
  const paths = [];
  for (const place of Array.isArray(places) ? places : []) {
    if (typeof place !== 'string' || !isAbsolute(place)) continue;
    const real = await realPlace(resolve(place));
    if (real === null || !inside(real, realTop) || inside(realRoot, real)) continue;
    paths.push(relative(realTop, real).split(sep).join('/'));
  }
  return paths;
}
/** Whether a path as git names it (from the top folder, slashes forward) is one of `paths` or lies under one. */
const leftOutBy = (paths) => (gitPath) => paths.some((p) => gitPath === p || gitPath.startsWith(`${p}/`));

/** Whether the real place of `place` (absolute; a folder not made yet counts by where it will be) is the real path of
 *  `path` or holds it. False when either cannot be resolved. */
export async function placeHolds(place, path) {
  if (typeof place !== 'string' || !isAbsolute(place) || typeof path !== 'string' || !isAbsolute(path)) return false;
  const [realPlaceOf, realPath] = [await realPlace(resolve(place)), await realpath(path).catch(() => null)];
  return realPlaceOf !== null && realPath !== null && inside(realPath, realPlaceOf);
}

/**
 * What one plan entry is at review time: a closed state, a directory, or its bytes. Never throws. A recorded write
 * outside the working directory (`outside`: the slicer's write scope, a home-spelled name, a name or a real path outside
 * it) is `outside_root` — and `repository: true` when it really lies in the repository's top folder (`realTop`): a part of
 * the repository's change the review does not cover, so its coverage stays partial (a scratchpad file outside the
 * repository is only counted); a path not there is `deleted`; only a regular file of at most `maxBytes` is read, at its
 * real path, never through a link at the last part.
 */
async function readEntry(entry, { root, realRoot, realTop = null, maxBytes }) {
  const at = { path: entry.path };
  const recorded = typeof entry.recordedPath === 'string' ? entry.recordedPath : entry.path;
  if (HOME_SPELLED.test(recorded) || HOME_SPELLED.test(entry.path)) return { ...at, state: OUTSIDE_ROOT };
  const absolute = resolve(root, entry.path);
  const outsideRoot = async (place) => {
    const real = typeof realTop === 'string' ? await realPlace(place) : null;
    return { ...at, state: OUTSIDE_ROOT, ...(real !== null && inside(real, realTop) ? { repository: true } : {}) };
  };
  if (entry.outside === true || !inside(absolute, root)) return outsideRoot(absolute);
  let real;
  try { real = await realpath(absolute); }
  catch (error) { return { ...at, state: GONE.has(error?.code) ? DELETED : UNREADABLE }; }
  if (!inside(real, realRoot)) return outsideRoot(real);
  let handle = null;
  try {
    try { handle = await open(real, READ_FLAGS); }
    catch (error) { return error?.code === 'EISDIR' ? { ...at, directory: true } : { ...at, state: UNREADABLE }; }
    const info = await handle.stat();
    if (info.isDirectory()) return { ...at, directory: true };
    if (!info.isFile()) return { ...at, state: UNREADABLE };
    if (info.size > maxBytes) return { ...at, state: OVERSIZE };
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) return { ...at, state: OVERSIZE };
    return { ...at, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) };
  } catch { return { ...at, state: UNREADABLE }; }
  finally { await handle?.close().catch(() => {}); }
}

// ---- git, read only ---------------------------------------------------------------------------------------------------

/** Git's own arguments for every call: optional locks off (a `git diff` never refreshes and writes the index), no
 *  file-system monitor, no colour, paths unquoted. */
const GIT_FLAGS = Object.freeze(['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false',
  '-c', 'color.ui=never']);
/** The environment git runs in: the caller's, without any GIT_* variable (which could point it at another repository,
 *  index or diff program), with optional locks off and lazy fetching off (`GIT_NO_LAZY_FETCH`: in a partial clone, a
 *  read of an object the clone does not hold fails instead of fetching it from the promisor remote, so no git call
 *  here reaches the network). */
export const gitEnvironment = (env = process.env) => ({ ...Object.fromEntries(Object.entries(env)
  .filter(([key]) => !key.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C' });
/** Run git with `args` in `cwd`: `{ ok, stdout }` (a Buffer), never a throw. `maxBuffer` bounds what it may print;
 *  `differ` reads exit status 1 as an answer (`git diff --no-index` exits 1 when the two sides differ). */
export function runGit(args, { cwd, maxBuffer = 64 * 1024 * 1024, differ = false }) {
  return new Promise((done) => {
    execFile('git', [...GIT_FLAGS, ...args], { cwd, maxBuffer, encoding: 'buffer', env: gitEnvironment(),
      windowsHide: true }, (error, stdout) => {
      if (!error) return done({ ok: true, stdout });
      if (differ && error.code === 1 && Buffer.isBuffer(stdout)) return done({ ok: true, stdout });
      return done({ ok: false, stdout: null, overflow: error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    });
  });
}
/** Run git with `args` in `cwd`, `input` on its standard input: `{ ok, stdout }`, never a throw. */
function runGitInput(args, input, { cwd, maxBuffer = 256 * 1024 * 1024 }) {
  return new Promise((done) => {
    let child;
    try { child = spawn('git', [...GIT_FLAGS, ...args], { cwd, env: gitEnvironment(), windowsHide: true }); }
    catch { done({ ok: false, stdout: null }); return; }
    const chunks = [];
    let size = 0, over = false;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBuffer) { over = true; child.kill(); } else chunks.push(chunk);
    });
    child.stderr.on('data', () => {});
    child.on('error', () => done({ ok: false, stdout: null }));
    child.on('close', (code) => done(code === 0 && !over ? { ok: true, stdout: Buffer.concat(chunks) } : { ok: false,
      stdout: null }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const out = (result) => (result.ok ? result.stdout.toString('utf8') : null);
const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** A reflog selector as `git log -g --date=unix --format=%gd` prints it: `HEAD@{<unix seconds>}`. */
const REFLOG_SELECTOR = /^HEAD@\{(\d+)\}$/;

/**
 * The recording's opening facts, by structure: the first timestamp a row carries (Claude Code rows and Codex lines
 * carry an ISO `timestamp`) and the commit a Codex rollout's `session_meta` names (`payload.git.commit_hash`). Reads at
 * most the first `maxLines` lines; never a message's words. `{ at, commit }`, each null when not found.
 */
export async function recordingStart(file, { maxLines = 200 } = {}) {
  const found = { at: null, commit: null };
  if (typeof file !== 'string' || !file) return found;
  let input = null, lines = null;
  try {
    input = createReadStream(file, { encoding: 'utf8' });
    lines = createInterface({ input, crlfDelay: Infinity });
    let seen = 0;
    for await (const line of lines) {
      if (++seen > maxLines) break;
      if (!line.trim()) continue;
      const parsed = strictJson(line);
      if (!parsed.strict || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) continue;
      const row = parsed.value;
      if (found.at === null && typeof row.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp)))
        found.at = row.timestamp;
      const commit = row.type === 'session_meta' ? row.payload?.git?.commit_hash : null;
      if (found.commit === null && typeof commit === 'string' && HASH.test(commit)) found.commit = commit;
      if (found.at !== null && found.commit !== null) break;
    }
  } catch { /* an unreadable recording names no start */ }
  finally { lines?.close(); input?.destroy(); }
  return found;
}

/**
 * The session's start commit in the repository at `top`, by structure: the commit the recording names, when git has
 * it; else the HEAD reflog entry in effect at the recording's first timestamp (the newest one made at or before it);
 * else the newest first-parent commit of HEAD committed at or before it. `{ commit, how }` or null.
 */
export async function startCommit({ top, start, git = runGit }) {
  if (start?.commit && (await git(['cat-file', '-e', `${start.commit}^{commit}`], { cwd: top })).ok)
    return { commit: start.commit, how: FROM_RECORDING };
  const at = typeof start?.at === 'string' ? Date.parse(start.at) : NaN;
  if (!Number.isFinite(at)) return null;
  const seconds = Math.floor(at / 1000);
  const reflog = out(await git(['log', '-g', '--date=unix', '--format=%H%x09%gd', 'HEAD'], { cwd: top }));
  for (const line of (reflog ?? '').split('\n')) {
    const [hash, selector] = line.split('\t');
    const when = REFLOG_SELECTOR.exec(selector ?? '');
    if (HASH.test(hash ?? '') && when && Number(when[1]) <= seconds) return { commit: hash, how: FROM_REFLOG };
  }
  const dated = out(await git(['rev-list', '-1', '--first-parent', `--before=${seconds}`, 'HEAD'], { cwd: top }))?.trim();
  return dated && HASH.test(dated) ? { commit: dated, how: FROM_COMMIT_DATE } : null;
}

/** git's `--name-status -z` list: status letter, then path, NUL-separated (no renames are asked for). */
function nameStatus(text) {
  const parts = text.split('\0');
  const changes = [];
  for (let at = 0; at + 1 < parts.length; at += 2) {
    const status = parts[at][0];
    const type = status === 'A' ? ADDED : status === 'D' ? DELETED_TYPE : status === 'M' || status === 'T' ? MODIFIED : null;
    if (type && parts[at + 1]) changes.push({ gitPath: parts[at + 1], type });
  }
  return changes;
}

/** The paths of a `-z` list. */
const names = (text) => text.split('\0').filter(Boolean);
/** The paths of git's `--name-status -z` list (every second entry). */
const listedNames = (text) => text.split('\0').filter((part, at) => at % 2 === 1 && part);

/** The real top folder of the git repository the working directory `root` is in, when the working directory's real
 *  path lies under it; null when there is none. */
export async function gitTop({ root, git = runGit }) {
  const topText = out(await git(['rev-parse', '--show-toplevel'], { cwd: root }));
  if (!topText) return null;
  const top = topText.endsWith('\n') ? topText.slice(0, -1) : topText;
  const realTop = await realpath(top).catch(() => null);
  const realRoot = await realpath(root).catch(() => null);
  return realTop && realRoot && inside(realRoot, realTop) ? realTop : null;
}

/**
 * The git base of a review under `root`: the repository's top folder, the start commit (`startCommit`) and every path
 * under the working directory that differs from it now — git's own list of tracked paths, then the untracked ones (not
 * ignored) a recorded edit names (`recorded`, as the code step names them) or whose modification time is at or after
 * the session's start — each with its path as the code step names it (`displayPath` under `root`) and its type. Git is
 * asked for paths under the working directory alone (a literal pathspec of it, from the top folder): a path elsewhere
 * in the repository is counted (`outside`: how many tracked paths differ outside it). An untracked path in a place
 * Sonah writes (`own`, absolute: what the review writes in its state folder, and Sonah's home) that no recorded edit
 * wrote is no part of the session's change — unless the place holds the working directory. Every path git tracks (its
 * list against the start commit names tracked paths only) and every path a recorded edit wrote stays part of it
 * wherever it lies: Sonah never adds a file to git and never writes one the session wrote, so such a path is the
 * project's, never Sonah's (the review of the code step: a project folder named like a state folder's entry, left out
 * by its name, had its changes dropped unseen). Null when there is none.
 */
export async function readGitBase({ root, start, recorded = new Set(), git = runGit, own = [] }) {
  const realTop = await gitTop({ root, git });
  if (!realTop) return null;
  const realRoot = await realpath(root).catch(() => null);
  if (!realRoot) return null;
  const found = await startCommit({ top: realTop, start, git });
  if (!found) return null;
  const below = relative(realTop, realRoot).split(sep).join('/');
  // The working directory as git's pathspec, from the top folder: every path under it, read literally.
  const scope = below ? [`:(top,literal)${below}`] : [];
  const listed = out(await git(['diff', '--name-status', '--no-renames', '-z', found.commit, '--', ...scope],
    { cwd: realTop }));
  if (listed === null) return null;
  // What Sonah writes (`own`: what it writes in its state folder, and its home) is never part of the session's change:
  // of a place it writes, the untracked files no recorded edit wrote. Git's lists against the start commit name tracked
  // paths only, so they are kept whole.
  const leftOut = leftOutBy(await leftOutPaths(own, realTop, realRoot));
  let outside = 0;
  if (below) {
    const all = out(await git(['diff', '--name-only', '--no-renames', '-z', found.commit, '--'], { cwd: realTop }));
    if (all === null) return null;
    outside = Math.max(0, names(all).length - listedNames(listed).length);
  }
  const named = (gitPath) => displayPath(join(realTop, gitPath), realRoot);
  const changes = nameStatus(listed).map((c) => ({ ...c, path: named(c.gitPath) }));
  const untracked = (out(await git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...scope], { cwd: realTop }))
    ?? '').split('\0').filter(Boolean).filter((gitPath) => !leftOut(gitPath) || recorded.has(named(gitPath)));
  const since = typeof start?.at === 'string' ? Date.parse(start.at) : NaN;
  for (const gitPath of untracked) {
    const path = named(gitPath);
    let fresh = false;
    if (!recorded.has(path) && Number.isFinite(since)) {
      try { fresh = (await stat(join(realTop, gitPath))).mtimeMs >= since; } catch { fresh = false; }
    }
    if (recorded.has(path) || fresh) changes.push({ gitPath, type: ADDED, path, untracked: true });
  }
  return { top: realTop, commit: found.commit, how: found.how, changes, outside };
}

/** The file at the start commit and git's own patch of one differing path, for a path the reader showed or found
 *  deleted:`{ base: { bytes } | { state } | null, patch: string | null }`. Nothing is read of any other. */
async function readGitSide(change, head, { top, commit, maxBytes, git }) {
  const readable = head.bytes instanceof Uint8Array;
  const deleted = head.state === DELETED;
  if (!(readable && change.type !== DELETED_TYPE) && !(deleted && change.type === DELETED_TYPE)) return {};
  let base = null;
  if (change.type !== ADDED) {
    const blob = await git(['cat-file', 'blob', `${commit}:${change.gitPath}`], { cwd: top, maxBuffer: maxBytes });
    base = blob.ok ? { bytes: new Uint8Array(blob.stdout.buffer, blob.stdout.byteOffset, blob.stdout.length) }
      : { state: blob.overflow ? OVERSIZE : UNREADABLE };
  }
  // An untracked file: git's own diff of it from nothing, so its attributes (`binary`, `-diff`) hold as for a tracked one.
  const patch = change.untracked
    ? await git(['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '-U3', '--', '/dev/null',
      change.gitPath], { cwd: top, maxBuffer: maxBytes * 4 + 65536, differ: true })
    : await git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '-U3', commit, '--',
      `:(literal)${change.gitPath}`], { cwd: top, maxBuffer: maxBytes * 4 + 65536 });
  return { base, patch: patch.ok ? patch.stdout.toString('utf8') : null };
}

/** A file's SHA-256 in hex, read a megabyte at a time, never through a link at the last part of its path. Throws when it
 *  cannot be read. */
function hashFileSync(path) {
  const hash = createHash('sha256');
  const chunk = Buffer.alloc(1024 * 1024);
  const fd = openSync(path, READ_FLAGS);
  try {
    for (let read = readSync(fd, chunk); read > 0; read = readSync(fd, chunk)) hash.update(chunk.subarray(0, read));
  } finally { closeSync(fd); }
  return hash.digest('hex');
}

/**
 * The repository's state: SHA-256 over the start commit (`commit`, or none) and the sorted lines, one per path git lists
 * as tracked or untracked and not ignored (`git ls-files --cached --others --exclude-standard`) that exists now, each
 * `[mode, path, id]` as JSON: a regular file its blob id as git hashes it with no filter (`git hash-object --no-filters
 * --stdin-paths`, the bytes the agent reads) and mode 100644 or 100755, a symbolic link its target text (120000), a
 * submodule the commit git's index records (160000). The same content gives the same state, committed or not; any edit,
 * pull or checkout of other content changes it. A path in a place the review itself writes while it runs, or a harness
 * does (`omit`, absolute: what Sonah writes in its state folder, its home, the coding agents' homes, when they lie in
 * the repository), is no part of it, so the review's own writes never read as the repository changing — but for a
 * place that holds the working directory (`root`), which is never left out. A regular file git cannot read
 * (`hash-object` refuses the list) is hashed here instead, or named unreadable. Null when git cannot list the
 * repository. Reads names, modes and git's hashes only, but for such a file.
 */
export async function repositoryState({ top, commit = null, git = runGit, omit = [], root = null }) {
  if (typeof top !== 'string' || !isAbsolute(top)) return null;
  const cached = out(await git(['ls-files', '-z', '-s', '--cached'], { cwd: top, maxBuffer: 256 * 1024 * 1024 }));
  const others = out(await git(['ls-files', '-z', '--others', '--exclude-standard'], { cwd: top,
    maxBuffer: 256 * 1024 * 1024 }));
  if (cached === null || others === null) return null;
  const realTop = await realpath(top).catch(() => top);
  const realRoot = typeof root === 'string' && isAbsolute(root) ? await realpath(root).catch(() => null) : null;
  const leftOut = leftOutBy(await leftOutPaths(omit, realTop, realRoot ?? realTop));
  const gitlinks = new Map();
  const paths = new Set();
  for (const row of cached.split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t');
    if (tab < 0) continue;
    const [mode, object] = row.slice(0, tab).split(' ');
    const path = row.slice(tab + 1);
    if (leftOut(path)) continue;
    paths.add(path);
    if (mode === '160000') gitlinks.set(path, object);
  }
  for (const path of others.split('\0').filter(Boolean)) if (!leftOut(path)) paths.add(path);
  const lines = [], hashed = [];
  // One synchronous lstat per path: a promise per path cost seconds on a repository of a few thousand files.
  for (const path of [...paths].sort()) {
    let info;
    try { info = lstatSync(join(top, path)); } catch { continue; }
    if (gitlinks.has(path)) { lines.push(JSON.stringify(['160000', path, gitlinks.get(path)])); continue; }
    if (info.isSymbolicLink()) {
      let target = null;
      try { target = readlinkSync(join(top, path), 'utf8'); } catch { target = null; }
      if (target !== null) lines.push(JSON.stringify(['120000', path, target]));
      continue;
    }
    if (!info.isFile()) continue;
    hashed.push({ path, mode: (info.mode & 0o111) !== 0 ? '100755' : '100644' });
  }
  // One git process hashes every regular file, one path per line; a name holding a line break is hashed here instead,
  // and so is every file when git refuses the list (one file it cannot open stops it).
  const piped = hashed.filter((h) => !h.path.includes('\n'));
  const ids = piped.length ? out(await runGitInput(['hash-object', '--no-filters', '--stdin-paths'],
    `${piped.map((h) => h.path).join('\n')}\n`, { cwd: top })) : '';
  const idList = ids === null ? [] : ids.split('\n').filter(Boolean);
  if (idList.length === piped.length) piped.forEach((h, at) => { h.id = idList[at]; });
  for (const h of hashed) {
    if (h.id === undefined) {
      try { h.id = `sha256:${hashFileSync(join(top, h.path))}`; } catch { h.id = UNREADABLE; }
    }
    lines.push(JSON.stringify([h.mode, h.path, h.id]));
  }
  lines.sort();
  return createHash('sha256').update(`${typeof commit === 'string' ? commit : ''}\n${lines.join('\n')}`).digest('hex');
}

/**
 * The repository reader the code step's grounding reads through (evidence/src/code-pass.js `groundingContext`): `{ root,
 * top, read(path), base(path) }`, both synchronous, each path read once. `read(path)`: the file as it is now, by a path
 * relative to the working directory (else to the repository's top folder), or absolute under the top folder — `{ path,
 * text, sha256, lines }` (`path` as the code step names it: relative to the working directory, slashes forward) or null
 * for a missing, non-regular, binary (a NUL byte, or not UTF-8) or over-`maxBytes` file, or one whose real path lies
 * outside the top folder. `base(path)`: the file at the start commit (`commit`; git's blob), the same shape, or null.
 * `root` is the working directory and `top` the repository's top folder (the working directory when there is none).
 */
export function createRepositoryReader({ root, top = null, commit = null, maxBytes }) {
  let realRoot = null, realTop = null;
  try { realRoot = realpathSync(root); realTop = realpathSync(typeof top === 'string' && top ? top : root); }
  catch { realRoot = null; }
  const usable = realRoot !== null && inside(realRoot, realTop);
  const decode = (bytes) => {
    if (bytes.includes(0)) return null;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  };
  const shaped = (real, bytes) => {
    const text = decode(bytes);
    return text === null ? null : { path: repoName(real, realRoot), text, lines: text.split('\n').length,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  /** The absolute places a path may name: as given when absolute (a spelling of the working directory mapped to its
   *  real path), else under the working directory, then under the top folder. */
  const places = (path) => {
    if (typeof path !== 'string' || !path || path.includes('\0')) return [];
    if (isAbsolute(path)) {
      return [inside(resolve(path), resolve(root)) ? resolve(realRoot, relative(resolve(root), resolve(path)))
        : resolve(path)];
    }
    return [...new Set([resolve(realRoot, path), resolve(realTop, path)])];
  };
  const now = new Map(), before = new Map();
  const readNow = (path) => {
    for (const place of places(path)) {
      let real;
      try { real = realpathSync(place); } catch { continue; }
      if (!inside(real, realTop)) return null;
      let fd = null;
      try {
        fd = openSync(real, READ_FLAGS);
        const info = fstatSync(fd);
        if (!info.isFile() || info.size > maxBytes) return null;
        const bytes = readFileSync(fd);
        return bytes.length > maxBytes ? null : shaped(real, bytes);
      } catch { return null; }
      finally { if (fd !== null) try { closeSync(fd); } catch { /* closed */ } }
    }
    return null;
  };
  const readBase = (path) => {
    if (typeof commit !== 'string' || !HASH.test(commit)) return null;
    for (const place of places(path)) {
      // Lexical: a file deleted since the start commit is no longer there to resolve.
      if (!inside(place, realTop) || place === realTop) continue;
      const gitPath = relative(realTop, place).split(sep).join('/');
      let bytes;
      try {
        bytes = execFileSync('git', [...GIT_FLAGS, 'cat-file', 'blob', `${commit}:${gitPath}`], { cwd: realTop,
          maxBuffer: maxBytes, encoding: 'buffer', env: gitEnvironment(), stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true });
      } catch { continue; }
      return bytes.length > maxBytes ? null : shaped(place, bytes);
    }
    return null;
  };
  const once = (cache, reader) => (path) => {
    const key = String(path);
    if (!cache.has(key)) cache.set(key, usable ? reader(path) : null);
    return cache.get(key);
  };
  return { root, top: realTop, read: once(now, readNow), base: once(before, readBase) };
}

/**
 * The frozen snapshot of `session`'s change under `root` (the recorded working directory, absolute), as it is now:
 * `{ root: true, dir, realRoot, top, base, plan, files, repoState }` (`realRoot` the working directory's real path), or
 * `{ root: false, plan, files: [] }` when there is no root to read under (the recording names none, or it is not a
 * directory now) — the code step then does not run. `top` is the
 * repository's real top folder (the working directory's real path when there is no repository); `maxBytes` is the most
 * one file may be (the review's request bound); `recording` the recording's path (its opening timestamp and commit
 * place the start commit); `git` runs git (a test may pass another). `base` is `{ kind: 'git', commit, how, outside }`
 * or `{ kind: 'recorded_edits' }`. `repoState` the repository's state (`repositoryState`), or null with no repository.
 * `own`: what Sonah writes (what the review writes in its state folder, by name, and Sonah's home): no part of the state,
 * and of the change only the untracked files there that no recorded edit wrote (`readGitBase`); `harnessHomes`: the coding agents' homes (claude-home.js `harnessHomePlaces`), written by any of
 * their sessions while the review runs, never part of the state (they stay part of the change like any path). A place
 * of either that holds the working directory is never left out. `stateOmits` keeps both lists, so the state taken
 * again after the code step leaves out the same places. Reads only; writes nothing.
 */
export async function readCodeSnapshot(session, { root, maxBytes, recording = null, git = runGit, own = [],
  harnessHomes = [] }) {
  const none = { root: false, plan: codeSnapshotPlan(session), files: [] };
  if (typeof root !== 'string' || !isAbsolute(root)) return none;
  const dir = resolve(root);
  let realRoot = null;
  try { realRoot = await realpath(dir); } catch { return none; }
  try { if (!(await stat(realRoot)).isDirectory()) return none; }
  catch { return none; }
  const recordedPlan = codeSnapshotPlan(session, { root: dir });
  const recorded = new Set(recordedPlan.map((e) => e.path));
  const gitBase = await readGitBase({ root: dir, start: await recordingStart(recording), recorded, git, own });
  const repository = gitBase?.top ?? await gitTop({ root: dir, git });
  const types = new Map((gitBase?.changes ?? []).map((c) => [c.path, c]));
  const plan = [...recordedPlan];
  for (const change of [...types.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)))
    if (!recorded.has(change.path)) plan.push({ path: change.path, recordedPath: join(gitBase.top, change.gitPath),
      changed: true, recorded: false, outside: false, last: null, edits: [] });
  const reads = [];
  for (const entry of plan) {
    const head = await readEntry(entry, { root: dir, realRoot, realTop: repository, maxBytes });
    const change = types.get(entry.path);
    if (!change) { reads.push(head); continue; }
    const side = await readGitSide(change, head, { top: gitBase.top, commit: gitBase.commit, maxBytes, git });
    reads.push({ ...head, type: change.type, ...side });
  }
  const base = gitBase ? { kind: GIT_BASE, commit: gitBase.commit, how: gitBase.how, outside: gitBase.outside }
    : { kind: RECORDED_EDITS_BASE };
  const stateOmits = [...own, ...harnessHomes].filter((place) => typeof place === 'string' && isAbsolute(place));
  const repoState = repository ? await repositoryState({ top: repository, commit: gitBase?.commit ?? null, git,
    omit: stateOmits, root: realRoot }) : null;
  return { root: true, dir, realRoot, top: repository ?? realRoot, base, plan,
    files: freezeCodeSnapshot(plan, reads, { base }), repoState, stateOmits };
}

/** The snapshot's file texts (readable files, and the start commit's text of each differing one). D90: nothing masks or
 *  scans them now; the tests read the snapshot through it. */
export const snapshotTexts = (snapshot) => (Array.isArray(snapshot?.files) ? snapshot.files : [])
  .flatMap((file) => [file?.text, file?.base?.text]).filter((text) => typeof text === 'string');

