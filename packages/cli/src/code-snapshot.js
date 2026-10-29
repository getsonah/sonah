// D87 (owner decisions 2026-10-13/14), the code step (owner decision 2026-10-14), made agentic under D90 (owner decision
// 2026-10-15: privacy is not a design constraint; the code step may see everything): what `sonah review` reads from
// disk for the code step, by structure, before its first call.
//
// The snapshot (`sonah.code-snapshot/13`): the change under review, the review agent's starting map — the paths the
// recorded session changed (evidence/src/code-pass.js `codeSnapshotPlan`), each one's file now and, for each that differs
// from the session's start commit (git's own list, and the untracked files a recorded edit wrote or that changed after
// the session began), its file at that commit and git's own patch of it. D113 (code-snapshot/13): a path that differs
// from the start commit, that no recorded write of the session touched and whose last change lies outside the session's
// recorded window is no part of the change: it changed outside this session's recorded writes, and the snapshot names it
// apart (`base.changedOutside`; `sessionsOwnChange`). D113 amended (the owner, 2026-10-18: "for code review, you can even
// review code that is outside the session, but tag it by outside the evaluated session"): such a path is read as the
// change's are and frozen apart (`outsideFiles`): outside the evaluated session, never part of the change, given to the
// code review apart from it (evidence code-pass.js `runCodePass`'s `outsideSnapshot`). D117 (inside code-snapshot/13,
// unreleased; the owner, 2026-10-18: "the changes that happened outside the worktree but is relevant to this session
// should also be reviewed, make this default"): the change is the session's own in every place it wrote to. Each
// recorded write is placed by its real place and the git repository that holds it (`placeEntry`): the working folder's
// repository (in the working directory, or elsewhere in that repository: git's diff of those paths from the same start
// commit), another git repository (a sibling worktree, a repository nested in the working directory: `readPlaceBase`,
// its commit when the session began by the same rule, and D113's window there as here: a path no recorded write touched
// is kept when it last changed while the session ran, else named apart and, as D113 amended says, read apart: outside
// the evaluated session). Only a write in a harness home or a place Sonah writes (outside the working directory), named
// from the home folder or that resolves nowhere stays out, counted (`outside_root`). The base names each other place
// (`base.places`, in the readers' order: `orderPlaces`), each file of one names it (`place`), and the agents read each
// place's folder that holds a file of the change (`agentFolders`). D117 amended (the owner, 2026-10-18: "review the
// session's writes in any git repository; files outside any repository are listed, not reviewed; paths that hold an
// unexpanded $VARIABLE are never counted"): a place is a git repository only, and only one where a recorded write
// resolves to a file that is there now and differs from its base (`isPlaceOfChange`); a write in a folder of no
// repository is counted (`outside_root`) and its folder listed with a count (`base.folders`), never read; a write the
// shell spelled with an unexpanded variable or command substitution is not resolved: no place, no file of the change,
// counted apart (`base.unresolved`); and one real path outside the working directory is one file. D124 (the owner,
// 2026-10-20; the --code-repo option): each git repository the person gives (`codeRepos`, `codeRepoTop`) is a place by
// the same rules, as if the session had written there, whatever its writes there (`given` on its record); the working
// folder's own repository stays read by its own rule, its base marked `given` (D124's review); without one, nothing here
// moves.
// The start commit is the one the recording
// names, else the HEAD reflog entry in effect at the recording's first timestamp, else the newest first-parent commit of
// HEAD made by then; with none (no repository, no start commit), the diff is the recorded edits (code-pass.js). Git's
// lists stop at the working directory (a literal pathspec of it), but for the paths the session's recorded writes name
// elsewhere in the repository (D117); how many other paths differ outside it is counted (`outside`). Before D117, a
// recorded write outside the working directory was never part of the change reviewed: D109 (code-snapshot/12) classed it
// by where it really lies (`other_repository`, `outside_writer_root`, `outside_root`); a record of that snapshot keeps
// those states, and its readers read them as before. Only a regular file is read, never through a
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
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync, readSync,
  realpathSync, statSync } from 'node:fs';
import { lstat, mkdir, open, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { strictJson } from '../../slicer/src/strict-json.js';
import { recordingStream } from '../../slicer/src/recording-stream.js';
import { codeSnapshotPlan, freezeCodeSnapshot, mayMissEdits, placeRanks, placesHolding } from '../../evidence/src/code-pass.js';
import { displayPath, HOME_SPELLED, underRoot, unresolvedShellPaths } from '../../evidence/src/code-context.js';
import { CODE_FILE_STATES, CODE_DIFF_BASES, CODE_START_COMMIT_SOURCES, CODE_CHANGE_TYPES, CODE_REPO_PROBLEMS }
  from '../../evidence/src/ledger.js';

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
 * D109 (code-snapshot/12): the real top folder of the git repository that holds `real` (an absolute real place; a path
 * not there is asked at its nearest folder that is), as git says it (`rev-parse --show-toplevel`), or null when none does.
 * One git call per folder (`cache`). A fact code holds, never a guess from the path's spelling.
 */
async function repositoryOf(real, { git, cache }) {
  let folder = dirname(real);
  for (;;) {
    let info = null;
    try { info = await stat(folder); } catch { info = null; }
    if (info?.isDirectory()) break;
    const up = dirname(folder);
    if (up === folder) return null;
    folder = up;
  }
  if (!cache.has(folder)) cache.set(folder, (async () => {
    const said = out(await git(['rev-parse', '--show-toplevel'], { cwd: folder }));
    if (!said) return null;
    return realpath(said.endsWith('\n') ? said.slice(0, -1) : said).catch(() => null);
  })());
  return cache.get(folder);
}

/** D117: where a recorded write is reviewed (`placeEntry`). `primary`: the working folder's repository (the working
 *  directory when it is in none), under the working directory or elsewhere in that repository; `git`: another git
 *  repository, by its real top folder (D117 amended: a place only when `isPlaceOfChange`, else counted as `out`);
 *  `folder`: a folder in no git repository, by its real place (D117 amended: listed with a count, `base.folders`, and
 *  counted as `out`, never read); `out`: no place the code step reads (a harness home, a home-spelled name, nothing of it
 *  resolves), only counted. */
const [PRIMARY_PLACE, GIT_PLACE, FOLDER_PLACE, OUT_PLACE] = ['primary', 'git', 'folder', 'out'];
/** D122: a write in a repository that is no place, lying in a folder the code review reads, with nothing to review there
 *  now: no file of the change (`readCodeSnapshot`). Never a placement `placeEntry` gives. */
const NO_CHANGE_PLACE = 'none';

/**
 * D117 (amending D109; the owner, 2026-10-18: "the changes that happened outside the worktree but is relevant to this
 * session should also be reviewed, make this default"): where one recorded write lies, by facts code holds — its real
 * place and the git repository that holds it (`repositoryOf`), never its spelling. Named from the home folder, or (when
 * the slicer's write scope marks it outside the working directory of the agent that wrote it, or it lies outside this
 * working directory) in a harness home folder or a place Sonah writes (`homes`, real places: never project work, D69 b;
 * the spec: "Harness homes (~/.claude, ~/.codex) and Sonah's own state stay out"), it is `out` with `home: true` (D109's
 * review: such a place can lie in a folder the review reads, so no reader says it lies outside them); nothing of it
 * resolves, `out`. Else: in the working directory, `primary` — or `git` when a repository nested in
 * it holds it; outside it, `primary` with `outside: true` in the working folder's repository (`realTop`) when that has a
 * start commit (`based`: git's diff of it from there), else `git` at its top folder like any other repository; `git` in
 * another repository (its real top folder, `at`), `folder` in none (`at` its real folder). `real` its real place;
 * `missing`, when its real path cannot be read, the closed state that says why (`deleted`, `unreadable`). Never throws.
 */
async function placeEntry(entry, { dir, realRoot, realTop, based = false, homes, git, repositories }) {
  const recorded = typeof entry.recordedPath === 'string' ? entry.recordedPath : entry.path;
  if (HOME_SPELLED.test(recorded) || HOME_SPELLED.test(entry.path)) return { kind: OUT_PLACE, home: true };
  const absolute = resolve(dir, entry.path);
  let real = null, missing = null;
  try { real = await realpath(absolute); }
  catch (error) { missing = GONE.has(error?.code) ? DELETED : UNREADABLE; real = await realPlace(absolute); }
  // D117's review: a write named under the working directory whose place cannot be resolved (a folder on its path that
  // cannot be searched) stays the working folder's repository's, by the state that says why, as before D117.
  if (real === null) return missing !== null && (inside(absolute, dir) || inside(absolute, realRoot))
    ? { kind: PRIMARY_PLACE, real: null, missing } : { kind: OUT_PLACE };
  const inRoot = inside(real, realRoot);
  if ((entry.outside === true || !inRoot) && homes.some((home) => inside(real, home))) return { kind: OUT_PLACE, home: true };
  const own = await repositoryOf(real, { git, cache: repositories });
  const place = inRoot ? (own !== null && own !== realTop ? { kind: GIT_PLACE, at: own } : { kind: PRIMARY_PLACE })
    : own !== null && own === realTop && based ? { kind: PRIMARY_PLACE, outside: true }
      : own !== null ? { kind: GIT_PLACE, at: own } : { kind: FOLDER_PLACE, at: dirname(real) };
  return { ...place, real, missing };
}

/**
 * D117's review: where a path that git's list names under the working directory (or that D113's window kept) is read: in
 * the working folder's repository at its real place when that lies in the working directory. One whose real place lies
 * outside it (a link there to a file elsewhere: git's change is the link's, never its target's) is not read through:
 * `out`, counted as before D117 (`home: true` in a harness home or a place Sonah writes). Never throws.
 */
async function listedPlace(entry, { dir, realRoot, homes }) {
  const real = await realPlace(resolve(dir, entry.path));
  if (real === null) return { kind: PRIMARY_PLACE, real: null, missing: UNREADABLE, listed: true };
  if (inside(real, realRoot)) return { kind: PRIMARY_PLACE, real, missing: null, listed: true };
  return { kind: OUT_PLACE, ...(homes.some((home) => inside(real, home)) ? { home: true } : {}) };
}

/**
 * What one placed plan entry is at review time (`placeEntry`): a closed state, a directory, or its bytes. Never throws.
 * `out`: `outside_root` (`home: true` for a harness home or a home-spelled name), only counted. Else read at its real
 * place: a path not there is `deleted`; only a regular file of at most `maxBytes` is read, never through a link at the
 * last part of its real path.
 */
async function readEntry(entry, placed, { maxBytes }) {
  const at = { path: entry.path };
  if (placed.kind === OUT_PLACE) return { ...at, state: OUTSIDE_ROOT, ...(placed.home === true ? { home: true } : {}) };
  if (placed.missing) return { ...at, state: placed.missing };
  let handle = null;
  try {
    try { handle = await open(placed.real, READ_FLAGS); }
    catch (error) { return error?.code === 'EISDIR' ? { ...at, directory: true } : { ...at, state: GONE.has(error?.code)
      ? DELETED : UNREADABLE }; }
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
 *  `differ` reads exit status 1 as an answer (`git diff --no-index` exits 1 when the two sides differ, `git grep` when
 *  it finds nothing). D157: `timeout` (milliseconds, none by default) ends a call that runs longer, as a failure. */
export function runGit(args, { cwd, maxBuffer = 64 * 1024 * 1024, differ = false, timeout = 0 }) {
  return new Promise((done) => {
    execFile('git', [...GIT_FLAGS, ...args], { cwd, maxBuffer, encoding: 'buffer', env: gitEnvironment(),
      windowsHide: true, timeout }, (error, stdout) => {
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
export async function recordingStart(file, { maxLines = 200, byteEnd = null } = {}) {
  const found = { at: null, commit: null };
  if (typeof file !== 'string' || !file) return found;
  let input = null, lines = null;
  try {
    // D142: with `byteEnd`, the recording as it was when the review started (cli frozen-read.js).
    input = recordingStream(file, byteEnd);
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
 * D124 (the --code-repo option): the git working tree that holds the folder `dir` (absolute) — the real path of its top
 * folder, as git says it (`rev-parse --show-toplevel`; a folder inside `.git` or a bare repository is none) — so the
 * code step reads that repository as a place of the change (`readCodeSnapshot`'s `codeRepos`). `{ top }`, or `{ problem }`
 * (ledger.js CODE_REPO_PROBLEMS, failure codes of the review): `dir` is not a folder that is there; no git working tree
 * holds it. Reads only; never throws.
 */
export async function codeRepoTop(dir, { git = runGit } = {}) {
  const [NOT_FOUND, NOT_GIT] = CODE_REPO_PROBLEMS;
  if (typeof dir !== 'string' || !isAbsolute(dir)) return { problem: NOT_FOUND };
  let folder = false;
  try { folder = (await stat(dir)).isDirectory(); } catch { folder = false; }
  if (!folder) return { problem: NOT_FOUND };
  const said = out(await git(['rev-parse', '--show-toplevel'], { cwd: dir }));
  const top = said ? (said.endsWith('\n') ? said.slice(0, -1) : said) : '';
  const real = top && isAbsolute(top) ? await realpath(top).catch(() => null) : null;
  return real ? { top: real } : { problem: NOT_GIT };
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

/** D117: git's pathspec of paths as git names them (from the top folder), each read literally. */
const literalSpecs = (gitPaths) => gitPaths.map((gitPath) => `:(top,literal)${gitPath}`);
/** D117: how many paths one git call names at most (a long session's writes stay within a command line). */
const PATHSPEC_CHUNK = 200;

/**
 * D117: which of `written` (`{ gitPath, path }`: paths a recorded write of the session could have changed, as git names
 * them under the repository's top folder `top`, each with its name in the code step) differ from `commit` now: git's own
 * list of tracked paths (`diff --name-status`) and, of the untracked ones git does not ignore, those among them. Each `{
 * gitPath, type, path, untracked? }`, in `written`'s order. Null when git cannot say.
 */
async function writtenChanges({ top, commit, written, git }) {
  const byGitPath = new Map(written.map((w) => [w.gitPath, w.path]));
  const found = new Map();
  for (let at = 0; at < written.length; at += PATHSPEC_CHUNK) {
    const specs = literalSpecs(written.slice(at, at + PATHSPEC_CHUNK).map((w) => w.gitPath));
    const listed = out(await git(['diff', '--name-status', '--no-renames', '-z', commit, '--', ...specs], { cwd: top }));
    const untracked = out(await git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...specs], { cwd: top }));
    if (listed === null || untracked === null) return null;
    for (const c of nameStatus(listed)) if (byGitPath.has(c.gitPath)) found.set(c.gitPath, { ...c, path: byGitPath.get(c.gitPath) });
    for (const gitPath of names(untracked)) if (byGitPath.has(gitPath) && !found.has(gitPath))
      found.set(gitPath, { gitPath, type: ADDED, path: byGitPath.get(gitPath), untracked: true });
  }
  return written.map((w) => found.get(w.gitPath)).filter(Boolean);
}

/**
 * D117: the base of another git repository the session wrote to (`top`, its real top folder): the commit its HEAD was on
 * when the session began — the same rule as the working folder's repository (`startCommit`: the HEAD reflog entry in
 * effect at the recording's first timestamp, else the newest first-parent commit of HEAD made by then), with no commit
 * of the recording's own (a recording names the commit of its working directory alone) — and, of the paths a recorded
 * write of the session could have changed there (`written`), those git shows differing (`writtenChanges`). Git is asked
 * about those paths alone. `{ commit, how, changes }`, or null when there is no such commit (the repository's history
 * began during the session, or git cannot say): its paths are then the recorded edits, as with no repository.
 */
async function readPlaceBase({ top, start, written, git }) {
  const found = await startCommit({ top, start: { at: start?.at ?? null, commit: null }, git });
  if (!found) return null;
  const changes = await writtenChanges({ top, commit: found.commit, written, git });
  if (changes === null) return null;
  return { commit: found.commit, how: found.how, changes };
}

/**
 * D117: D113's window in another git repository that is a place of the change (`isPlaceOfChange`: D117 amended, only one
 * that holds a file of the change by a recorded write), from its base `commit`: every other path that differs — git's
 * own list of tracked paths, and the untracked ones not ignored whose last change is at or after the session's start
 * (`start.at`) — is D113's rule, as in the working directory: one whose last change lies inside the session's recorded
 * window (`window`, `sessionWindow`) stays a part of the change, with no recorded write (`kept`, each named as the code
 * step names it: `displayPath` under `realRoot`); every other one changed outside this session's recorded writes and is
 * named apart (`changedOutside`, absolute, in code-unit order; `outsideChanges`, each with git's change of it, which
 * D113 amended reads apart: outside the evaluated session). A path in a place Sonah writes or in a coding agent's home
 * (`own`, `homes`: absolute) is neither: those stay out of every place but the working folder's repository. `{ kept,
 * changedOutside, outsideChanges }`, or null when git cannot say.
 */
async function readPlaceWindow({ top, commit, start, written, window = null, realRoot = null, own = [], homes = [],
  git }) {
  const listed = out(await git(['diff', '--name-status', '--no-renames', '-z', commit, '--'], { cwd: top }));
  const untracked = out(await git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: top }));
  if (listed === null || untracked === null) return null;
  const mine = new Set(written.map((w) => w.gitPath));
  const leftOut = leftOutBy(await leftOutPaths([...own, ...homes], top, top));
  const since = typeof start?.at === 'string' ? Date.parse(start.at) : NaN;
  // Each other differing path with its own modification time (a link's, never its target's; null when not there).
  const others = [];
  for (const change of nameStatus(listed)) if (!mine.has(change.gitPath) && !leftOut(change.gitPath))
    others.push({ change, mtimeMs: await mtimeOf(join(top, change.gitPath)) });
  for (const gitPath of names(untracked)) {
    if (mine.has(gitPath) || leftOut(gitPath) || !Number.isFinite(since)) continue;
    const mtimeMs = await mtimeOf(join(top, gitPath));
    if (mtimeMs !== null && mtimeMs >= since) others.push({ change: { gitPath, type: ADDED, untracked: true }, mtimeMs });
  }
  const kept = [], away = new Map();
  for (const { change, mtimeMs } of others) {
    const during = window !== null && Number.isFinite(mtimeMs) && mtimeMs >= window.start && mtimeMs <= window.end;
    if (during) kept.push({ ...change, path: displayPath(join(top, change.gitPath), realRoot) });
    else if (!away.has(join(top, change.gitPath))) away.set(join(top, change.gitPath), { ...change,
      path: join(top, change.gitPath) });
  }
  const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // D113 amended (in every place, D117): the paths named apart, each with git's change of it, read apart by
  // `readCodeSnapshot` as outside the evaluated session.
  const outsideChanges = [...away.values()].sort((a, b) => byPath(a.path, b.path));
  return { kept: kept.sort((a, b) => byPath(a.path, b.path)), changedOutside: outsideChanges.map((c) => c.path),
    outsideChanges };
}

/**
 * D117 amended (the owner, 2026-10-18: "review the session's writes in any git repository"; its second review's medium):
 * whether another git repository is a place of the change — at least one recorded write of the session there resolves
 * to a path that is there now (`placed.missing` null: its real path was read) and, with a base, that git shows differing
 * from it (`changes`, `writtenChanges`); with no base (its history began during the session), that is there now. A
 * repository whose every write names a file not there, or one with no difference, is no place: D113's window never runs
 * over it, nothing in it is read, and its writes are counted (`outside_root`). D122 (a review low of D117): a write that
 * lies in a folder the code review reads (`readable`: the working directory, or its repository's top folder) is read as
 * the working directory's own repository reads one — a file of the change exactly when git shows it differing from the
 * base, there now or not (a recorded delete of a tracked file), so such a repository is a place by that write alone.
 * Structure only. Pure.
 */
export const isPlaceOfChange = (entries, changes = null, readable = () => false) => entries.some(({ entry, placed }) =>
  changes === null ? placed?.missing === null && typeof placed?.real === 'string'
    : changes.some((c) => c.path === entry.path) && ((placed?.missing === null && typeof placed?.real === 'string')
      || readable(placed)));

/** The file at the start commit and git's own patch of one differing path, for a path the reader showed or found
 *  deleted:`{ base: { bytes } | { state } | null, patch: string | null }`. Nothing is read of any other. */
/** D149: the most paths one `git check-attr` call is given. */
const ATTRIBUTE_CHUNK = 200;
/**
 * D149: the git attribute that makes each path generated or vendored (evidence ledger.js CODE_GENERATED_SOURCES, in
 * that order of precedence): `linguist-generated` set, `linguist-vendored` set, `diff` unset (`-diff`), as
 * `git check-attr` reads them in the repository at `top` (`paths` as git names them there), 200 paths a call. A Map of
 * the paths that have one to it; a call that fails gives none. Reads only.
 */
export async function gitAttributesOf(paths, { top, git = runGit }) {
  const found = new Map();
  const on = (value) => value === 'set' || value === 'true';
  for (let from = 0; from < paths.length; from += ATTRIBUTE_CHUNK) {
    const text = out(await git(['check-attr', '-z', 'linguist-generated', 'linguist-vendored', 'diff', '--',
      ...paths.slice(from, from + ATTRIBUTE_CHUNK)], { cwd: top }));
    if (text === null) continue;
    const parts = text.split('\0');
    const of = new Map();
    for (let at = 0; at + 2 < parts.length; at += 3) of.set(`${parts[at]}\0${parts[at + 1]}`, parts[at + 2]);
    for (const path of paths.slice(from, from + ATTRIBUTE_CHUNK)) {
      const source = on(of.get(`${path}\0linguist-generated`)) ? 'linguist-generated'
        : on(of.get(`${path}\0linguist-vendored`)) ? 'linguist-vendored'
          : of.get(`${path}\0diff`) === 'unset' ? 'diff-unset' : null;
      if (source) found.set(path, source);
    }
  }
  return found;
}

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
 * relative to the working directory (else to the repository's top folder), or absolute — `{ path, text, sha256, lines }`
 * (`path` as the code step names it: relative to the working directory, slashes forward, `../…` elsewhere in the
 * repository) or null for a missing, non-regular, binary (a NUL byte, or not UTF-8) or over-`maxBytes` file, or one whose
 * real path lies outside the top folder and outside every other place of the change (D117: `places`, `base.places`). A
 * file of another place is named by its absolute real path, and a file of the change (`files`) whose name or real place
 * lies outside the working directory by the name the change gives it, whatever spelling reached it. `base(path)`: the
 * file at the start commit (`commit`; git's blob), or, in another git repository of the change, at that repository's
 * base commit; the same shape, or null (none in a folder of no repository). `root` is the working directory and `top`
 * the repository's top folder (the working directory when there is none).
 *
 * D122 (d) (the owner, 2026-10-19: "fix 5 in beta 5 only"; the dogfood rerun, RERUN-B5RC: a finding and 14 file notes
 * on another repository's files, named relative to that repository's top folder, were grounded in the working folder and
 * dropped): `name(path)`, the file a path the code review or a check names resolves to, by structure only — where a file
 * lies, never its words: `{ path }` (the name to read it by) or `{ ambiguous: true }`. An absolute path, a home-spelled
 * one (D109: never resolved against a place) and any path when the change has no other place: itself, read as before.
 * A relative path, literally (D122 (a): its spelling is never expanded), against the places of the change: the working
 * folder's repository when it holds a file of the change (under the working directory, else its top folder, as `read`
 * looks), and each other place that holds one (`places`; under its top folder, never out of it). It names a file in a
 * place when a regular file lies there whose real path is in a place the reader reads, or when it is the name of a file
 * of the change there (one not there now). Exactly one such file: its name (another place's file by the name the change
 * gives it, else by the reader's name for it); more than one: ambiguous, so it names none (D107's principle: an ambiguous
 * match matches none); none: itself, read as before. A quote is then checked word for word in the file it resolves to.
 * D147: when more than one place holds a file of the change (the working folder's repository among them when it holds
 * one), an absolute path that names a file of the change, there now or gone, is that file's name in the change (as
 * `read` names it); any other absolute path is itself.
 */
export function createRepositoryReader({ root, top = null, commit = null, maxBytes, places = [], files = [] }) {
  let realRoot = null, realTop = null;
  try { realRoot = realpathSync(root); realTop = realpathSync(typeof top === 'string' && top ? top : root); }
  catch { realRoot = null; }
  const usable = realRoot !== null && inside(realRoot, realTop);
  // D117: every other place of the change (`base.places`, `{ kind, at, commit }`): a git repository read at its base, or
  // a folder in none; and each file of the change named as the change names it, by its place (lexical and real), so a
  // quote of it under another spelling grounds on the file the change shows.
  const others = (Array.isArray(places) ? places : []).filter((p) => p && typeof p.at === 'string' && isAbsolute(p.at));
  const named = new Map();
  if (realRoot !== null) for (const file of Array.isArray(files) ? files : []) {
    if (typeof file?.path !== 'string' || !file.path || file.path.includes('\0')) continue;
    const lexical = isAbsolute(file.path) ? resolve(file.path) : resolve(realRoot, file.path);
    let real = null;
    try { real = realpathSync(lexical); } catch { real = null; }
    // Only a file whose name or real place lies outside the working directory: one in it is named by its real place.
    if (!isAbsolute(file.path) && (real === null || inside(real, realRoot))) continue;
    for (const key of [lexical, real]) if (key !== null && !named.has(key)) named.set(key, file.path);
  }
  const readable = (real) => inside(real, realTop) || others.some((p) => inside(real, p.at));
  const decode = (bytes) => {
    if (bytes.includes(0)) return null;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  };
  // A file outside the working folder's repository is named by its absolute place, as the agents' tools name it.
  const nameOf = (real) => named.get(real) ?? (inside(real, realTop) ? repoName(real, realRoot) : real);
  const shaped = (real, bytes) => {
    const text = decode(bytes);
    return text === null ? null : { path: nameOf(real), text, lines: text.split('\n').length,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  /** The absolute places a path may name: as given when absolute (a spelling of the working directory mapped to its
   *  real path), else under the working directory, then under the top folder. */
  const candidatesOf = (path) => {
    if (typeof path !== 'string' || !path || path.includes('\0')) return [];
    if (isAbsolute(path)) {
      return [inside(resolve(path), resolve(root)) ? resolve(realRoot, relative(resolve(root), resolve(path)))
        : resolve(path)];
    }
    return [...new Set([resolve(realRoot, path), resolve(realTop, path)])];
  };
  const now = new Map(), before = new Map();
  const readNow = (path) => {
    for (const place of candidatesOf(path)) {
      let real;
      try { real = realpathSync(place); } catch { continue; }
      if (!readable(real)) return null;
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
  // D117: the repository a lexical place lies in and its base: another place's git repository (the innermost), else the
  // working folder's.
  const baseOf = (place) => {
    const other = others.filter((p) => p.kind === 'git' && typeof p.commit === 'string' && HASH.test(p.commit)
      && inside(place, p.at) && place !== p.at).sort((a, b) => b.at.length - a.at.length)[0];
    if (other) return { at: other.at, commit: other.commit };
    return inside(place, realTop) && place !== realTop && typeof commit === 'string' && HASH.test(commit)
      ? { at: realTop, commit } : null;
  };
  const readBase = (path) => {
    for (const place of candidatesOf(path)) {
      // Lexical: a file deleted since the start commit is no longer there to resolve.
      const from = baseOf(place);
      if (from === null) continue;
      const gitPath = relative(from.at, place).split(sep).join('/');
      let bytes;
      try {
        bytes = execFileSync('git', [...GIT_FLAGS, 'cat-file', 'blob', `${from.commit}:${gitPath}`], { cwd: from.at,
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
  // D122 (d): which file a relative path names among the places of the change (see above).
  const ofChange = (f) => f && typeof f === 'object' && typeof f.path === 'string' && f.path && f.diff !== undefined;
  const primaryNames = new Set((Array.isArray(files) ? files : []).filter((f) => ofChange(f) && typeof f.place !== 'string')
    .map((f) => f.path));
  const otherPlaces = others.filter((p) => (Array.isArray(files) ? files : []).some((f) => ofChange(f) && f.place === p.at));
  const fileThere = (lexical) => {
    try {
      const real = realpathSync(lexical);
      return statSync(real).isFile() && readable(real) ? real : null;
    } catch { return null; }
  };
  // D147: more than one place holds a file of the change (code-pass.js `manyPlacesHold`): then every request names a
  // file by its absolute path, and an absolute path that names a file of the change is read under the name the change
  // gives it (a file of the working folder's repository by its relative name, another place's by the change's), as
  // `read` names what it reads; any other absolute path is itself, as before.
  const manyPlaces = otherPlaces.length > 0 && (primaryNames.size > 0 || otherPlaces.length > 1);
  const changeNameOf = (path) => {
    const [place] = candidatesOf(path);
    if (place === undefined) return null;
    if (named.has(place)) return named.get(place);
    const real = fileThere(place);
    if (real !== null && named.has(real)) return named.get(real);
    const at = real ?? place;
    if (!inside(at, realTop)) return null;
    const own = repoName(at, realRoot);
    return primaryNames.has(own) ? own : null;
  };
  const resolveName = (path) => {
    const as = { path };
    if (manyPlaces && typeof path === 'string' && path && !path.includes('\0') && isAbsolute(path)) {
      const own = changeNameOf(path);
      return own === null ? as : { path: own };
    }
    if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path) || HOME_SPELLED.test(path)
      || !otherPlaces.length) return as;
    const hits = new Map();
    if (primaryNames.size) {
      const real = fileThere(resolve(realRoot, path)) ?? fileThere(resolve(realTop, path));
      if (real !== null) hits.set(real, path);
      else if (primaryNames.has(path)) hits.set(resolve(realRoot, path), path);
    }
    for (const place of otherPlaces) {
      const lexical = resolve(place.at, path);
      if (!inside(lexical, place.at) || lexical === place.at) continue;
      const real = fileThere(lexical);
      if (real !== null) hits.set(real, named.get(lexical) ?? nameOf(real));
      else if (named.has(lexical)) hits.set(lexical, named.get(lexical));
    }
    if (hits.size > 1) return { ambiguous: true };
    return hits.size === 1 ? { path: [...hits.values()][0] } : as;
  };
  const names = new Map();
  const name = (path) => {
    const key = String(path);
    if (!names.has(key)) names.set(key, usable ? resolveName(path) : { path });
    return names.get(key);
  };
  return { root, top: realTop, read: once(now, readNow), base: once(before, readBase), name };
}

/**
 * D113 (code-snapshot/13; the owner, 2026-10-18: "for the hn5, start work now"): the change under review is the
 * session's own. Of the paths git shows differing from the start commit (`changes`, each named as the code step names
 * it, `{ path, recordedPath, mtimeMs }`), one is part of it when a recorded write of the session could have changed it
 * (`recordedPlan`, code-pass.js `codeSnapshotPlan`: a write, edit or delete of the session or its helpers whose effect
 * is landed or unknown) — by its name, or, when the record spelled it another way (through a link, or by another
 * spelling of the working directory), by its real place, the write's entry then named as git names it — or when its
 * file's last change lies inside the session's recorded window (`window`, `{ start, end }` in milliseconds: the
 * recording's first and last timestamps; `mtimeMs`, the file system's modification time of the path): a command of the
 * session can change a file with no write that the recording shows, so such a path stays a part of the change, with no
 * recorded write (`recorded: false`). Every other one changed outside this session's recorded writes and outside its
 * window — a later commit, a person, a tree already dirty at the start — or cannot be placed in time (a path not there
 * any more, no window): it is no part of the change and is named apart (`changedOutside`, in code-unit order; D113
 * amended: read apart by `readCodeSnapshot`, outside the evaluated session). Structure only: names, real places and
 * times, never a file's words. `{ plan, changedOutside }`, the plan's recorded entries first, then the paths kept by the
 * window, in code-unit order.
 */
export async function sessionsOwnChange(recordedPlan, changes, { dir, window = null }) {
  const plan = [...recordedPlan];
  const changePaths = new Set(changes.map((c) => c.path));
  const named = new Set(plan.map((e) => e.path));
  const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const unmatched = changes.filter((c) => !named.has(c.path)).sort(byPath);
  // The real place of each recorded write that no git path names as written: where a spelling the record used leads.
  const byPlace = new Map();
  if (unmatched.length) for (const [at, entry] of plan.entries()) {
    if (changePaths.has(entry.path) || HOME_SPELLED.test(entry.path) || HOME_SPELLED.test(entry.recordedPath ?? '')) continue;
    const real = await realPlace(resolve(dir, entry.path));
    if (real !== null && !byPlace.has(real)) byPlace.set(real, at);
  }
  const during = (mtimeMs) => window !== null && Number.isFinite(mtimeMs) && mtimeMs >= window.start
    && mtimeMs <= window.end;
  const changedOutside = [], kept = [];
  for (const change of unmatched) {
    const real = byPlace.size ? await realPlace(resolve(dir, change.path)) : null;
    const at = real === null ? undefined : byPlace.get(real);
    if (at !== undefined) { byPlace.delete(real); plan[at] = { ...plan[at], path: change.path }; continue; }
    if (during(change.mtimeMs)) kept.push({ path: change.path, recordedPath: change.recordedPath ?? change.path,
      changed: true, recorded: false, outside: false, last: null, edits: [] });
    else changedOutside.push(change.path);
  }
  return { plan: [...plan, ...kept], changedOutside: changedOutside.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) };
}

/** D113: the session's recorded window, `{ start, end }` in milliseconds, from the recording's first and last timestamps
 *  (`recordingStart`, `recordingEnd`); null when either is missing or the end is before the start. */
export const sessionWindow = (startAt, endAt) => {
  const [start, end] = [Date.parse(startAt ?? ''), Date.parse(endAt ?? '')];
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : null;
};

/** D113: the last timestamp a row of the recording carries (Claude Code rows and Codex lines carry an ISO `timestamp`),
 *  by structure: the end of the session's recorded window. Reads every line; never a message's words. Null when none is
 *  found. D142: with `byteEnd`, only the lines the review read (the recording as it was when it started). */
export async function recordingEnd(file, { byteEnd = null } = {}) {
  if (typeof file !== 'string' || !file) return null;
  let input = null, lines = null, last = null;
  try {
    input = recordingStream(file, byteEnd);
    lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const parsed = strictJson(line);
      if (!parsed.strict || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) continue;
      const at = parsed.value.timestamp;
      if (typeof at === 'string' && Number.isFinite(Date.parse(at))) last = at;
    }
  } catch { /* an unreadable recording names no end */ }
  finally { lines?.close(); input?.destroy(); }
  return last;
}

/** D113: a path's own modification time in milliseconds (a link's, never its target's), or null when it is not there. */
async function mtimeOf(path) {
  try { return (await lstat(path)).mtimeMs; } catch { return null; }
}

/**
 * D117 amended and D118 (b), the one rule's test (3) (code-context.js `unresolvedShellPaths`): of `spellings`, those
 * whose literal spelling names a path that exists, resolved against the session's working folder `dir` (absolute as
 * recorded, else under it): the recording keeps a parsed write's spelling without the command's quoting, so a heredoc to
 * 'app/routes/users.$id.tsx' wrote that very name. `lstat`, so a link names a path whatever it points to. In their order.
 * Reads the disk; writes nothing.
 */
export async function literalSpellings(spellings, dir) {
  const named = [];
  for (const spelled of spellings) {
    if (typeof spelled !== 'string' || !spelled || typeof dir !== 'string' || !isAbsolute(dir)) continue;
    try { await lstat(isAbsolute(spelled) ? spelled : resolve(dir, spelled)); named.push(spelled); }
    catch { /* names no path: not resolved */ }
  }
  return named;
}

/**
 * D122 (a), its review (low): of `spellings`, those whose literal spelling names a path — one the disk holds now
 * (`onDisk`, `literalSpellings`) or one git lists as differing from the start commit (`changes`, readGitBase's list, each
 * named as the code step names it, under one of `roots`: the working folder and its real path). The disk is read after
 * the session ended, so a tracked file with a literal `$` that a shell command deleted is not there now; git's list names
 * it. In their order. String work only.
 */
export function namedSpellings(spellings, onDisk, changes, roots) {
  const disk = new Set(onDisk);
  const listed = new Set((Array.isArray(changes) ? changes : []).map((c) => c?.path).filter((p) => typeof p === 'string'));
  const inGit = (spelled) => roots.some((at) => typeof at === 'string' && isAbsolute(at)
    && listed.has(displayPath(resolve(at, spelled), at)));
  return spellings.filter((spelled) => disk.has(spelled) || (listed.size > 0 && inGit(spelled)));
}

/**
 * The frozen snapshot of `session`'s change under `root` (the recorded working directory, absolute), as it is now:
 * `{ root: true, dir, realRoot, top, repository, base, plan, files, outsideFiles, repoState, folders? }` (`realRoot` the
 * working directory's real path; `repository` whether a git repository holds it; D113 amended: `outsideFiles`, the paths
 * named apart — `base.changedOutside`, and D117 each place's — frozen apart, outside the evaluated session; D117:
 * `folders`, the folders the agents read beside it, only when the session wrote elsewhere: `agentFolders`), or
 * `{ root: false, plan, files: [] }` when there is no root to read under (the recording names none, or it is not a
 * directory now) — the code step then does not run. `top` is the
 * repository's real top folder (the working directory's real path when there is no repository); `maxBytes` is the most
 * one file may be (the review's request bound); `recording` the recording's path (its opening timestamp and commit
 * place the start commit; its last timestamp ends D113's window); D126 (N0): `startRecording` the first recording of a
 * session read with the recordings it continues, whose opening timestamp places the start (the recording itself when
 * omitted); D142: `recordingBytes` and `startBytes`, when the review read them only through those ends (a frozen
 * read, cli frozen-read.js), bound the reads of `recording` and `startRecording` the same way; `git` runs git (a test
 * may pass another). `base` is `{ kind: 'git', commit, how, outside,
 * changedOutside, written }` (D113: the paths that differ from the start commit that no recorded write of the session
 * touched, named apart and never part of the change; how many paths the session's recorded writes could have changed)
 * or `{ kind: 'recorded_edits', written }`; D117: with `places` when the session's writes make another git repository a
 * place (`{ kind, at, written, commit?, how?, changedOutside?, repository?, given? }` each; D124: `given` for a repository
 * the person gave with --code-repo, `codeRepos`, a place whatever the session wrote there; D124's review: `given` on the
 * base itself when they gave the working folder's own repository, which is no place); D117 amended: with `folders` when it
 * wrote in a folder of no repository (`{ at, written }` each, listed, never read) and `unresolved` when a write is not
 * resolved (a count); the snapshot's `unseenEdits` when the session ran a shell command (code-pass.js
 * `mayMissEdits`). `written` counts every recorded write. `repoState` the state of every place the
 * code step reads (`changeState`: the repository's state, `repositoryState`, alone when there is no other place), or
 * null with no repository and no other place.
 * `own`: what Sonah writes (what the review writes in its state folder, by name, and Sonah's home): no part of the state,
 * and of the change only the untracked files there that no recorded edit wrote (`readGitBase`); `harnessHomes`: the coding agents' homes (claude-home.js `harnessHomePlaces`), written by any of
 * their sessions while the review runs, never part of the state (they stay part of the change like any path). A place
 * of either that holds the working directory is never left out. `stateOmits` keeps both lists, so the state taken
 * again after the code step leaves out the same places. Reads only; writes nothing.
 */
export async function readCodeSnapshot(session, { root, maxBytes, recording = null, startRecording = recording,
  recordingBytes = null, startBytes = startRecording === recording ? recordingBytes : null, git = runGit, own = [],
  harnessHomes = [], codeRepos = [] }) {
  const none = { root: false, plan: codeSnapshotPlan(session), files: [] };
  if (typeof root !== 'string' || !isAbsolute(root)) return none;
  const dir = resolve(root);
  let realRoot = null;
  try { realRoot = await realpath(dir); } catch { return none; }
  try { if (!(await stat(realRoot)).isDirectory()) return none; }
  catch { return none; }
  // D117 amended and D118 (b), one rule (code-context.js `unresolvedShellPaths`; the owner, 2026-10-18: "paths that hold
  // an unexpanded $VARIABLE are never counted"): a written path the recording does not resolve never creates a place and
  // is never a file of the change (`codeSnapshotPlan` leaves it out); the base counts it apart (`unresolved`) and among
  // the paths the session's writes could have changed (`written`). A home-spelled one keeps D109's class. A spelling whose
  // literal name is a path that exists here (`literalSpellings`), or (D122's review) that git lists as differing from
  // the start commit (`namedSpellings`: a tracked file the session deleted), is a file, and the base keeps it
  // (`literal`), so every reader of the record decides as this snapshot did.
  const spellings = unresolvedShellPaths(session);
  const onDisk = await literalSpellings(spellings, dir);
  const diskPlan = codeSnapshotPlan(session, { root: dir, literal: onDisk });
  // D126 (N0): a session read with the recordings it continues starts where the first of them starts
  // (`startRecording`); its window ends where the reviewed recording ends.
  const start = await recordingStart(startRecording, { byteEnd: startBytes });
  // Git is read with the plan of the spellings the disk holds: its `recorded` reaches only the untracked paths git
  // lists, each of which the disk holds, so the spellings git alone names (deleted files) never change what it lists.
  const gitBase = await readGitBase({ root: dir, start, recorded: new Set(diskPlan.map((e) => e.path)), git, own });
  const literal = namedSpellings(spellings, onDisk, gitBase?.changes, [dir, realRoot]);
  const unresolved = unresolvedShellPaths(session, { literal }).length;
  const recordedPlan = literal.length === onDisk.length ? diskPlan : codeSnapshotPlan(session, { root: dir, literal });
  const recorded = new Set(recordedPlan.map((e) => e.path));
  const repository = gitBase?.top ?? await gitTop({ root: dir, git });
  // D113 (code-snapshot/13): the change is the session's own — the paths its recorded writes could have changed
  // (`codeSnapshotPlan`), and those whose last change lies inside the session's recorded window. A path git shows
  // differing from the start commit that is neither is no part of it: named apart (`changedOutside`), and (D113 amended)
  // read apart below.
  const window = gitBase ? sessionWindow(start.at, await recordingEnd(recording, { byteEnd: recordingBytes })) : null;
  const timed = gitBase ? await Promise.all(gitBase.changes.map(async (c) => ({ ...c,
    recordedPath: join(gitBase.top, c.gitPath), mtimeMs: recorded.has(c.path) ? null
      : await mtimeOf(join(gitBase.top, c.gitPath)) }))) : [];
  const { plan, changedOutside } = gitBase ? await sessionsOwnChange(recordedPlan, timed, { dir, window })
    : { plan: [...recordedPlan], changedOutside: [] };
  const types = new Map((gitBase?.changes ?? []).map((c) => [c.path, c]));
  // D109: the harness home folders by their real places (a recorded write there is never project work), and one git call
  // per folder for which repository holds a recorded write. D117: and the places Sonah writes (`own`), which stay out of
  // the change outside the working directory as the harness homes do.
  const homes = [];
  for (const place of [...harnessHomes, ...own]) {
    const real = typeof place === 'string' && isAbsolute(place) ? await realPlace(resolve(place)) : null;
    if (real !== null) homes.push(real);
  }
  const repositories = new Map();
  // D117 (amending D109): every recorded write is placed where it really lies (`placeEntry`) and reviewed there — the
  // working folder's repository, another git repository, or a folder in none; only a write in a harness home, named from
  // the home folder or that resolves nowhere is only counted. A path git's list names under the working directory is the
  // working folder's repository's, as is a path the window kept (`recorded: false`, from git's list) — read only where
  // its real place lies in the working directory (`listedPlace`).
  const placements = [];
  for (const entry of plan) {
    placements.push(types.has(entry.path) || entry.recorded !== true ? await listedPlace(entry, { dir, realRoot, homes })
      : await placeEntry(entry, { dir, realRoot, realTop: repository, based: gitBase !== null, homes, git,
        repositories }));
  }
  // A write placed outside the working directory that the record spelled from it with `..` is named by its absolute place,
  // as the agents' tools name it (a name the record spelled absolutely, or under the working directory through a link,
  // stays as spelled); the first of two spellings of one name stands for it. D117 amended (its second review): and of
  // one real path outside the working directory (on macOS, /tmp/x and /private/tmp/x), so one file is one file.
  const named = new Set(), reals = new Set();
  const kept = [];
  plan.forEach((entry, at) => {
    const placed = placements[at];
    const outsideDir = placed.kind !== OUT_PLACE && placed.real && !inside(placed.real, realRoot);
    const path = outsideDir && !isAbsolute(entry.path) && !underRoot(entry.path) ? resolve(dir, entry.path) : entry.path;
    if (named.has(path) || (outsideDir && reals.has(placed.real))) return;
    named.add(path);
    if (outsideDir) reals.add(placed.real);
    kept.push({ entry: path === entry.path ? entry : { ...entry, path }, placed });
  });
  // The working folder's repository: its writes outside the working directory, from its start commit (git's lists stop
  // at the working directory), each one counted there no more.
  const elsewhereInTop = kept.filter(({ placed }) => placed.kind === PRIMARY_PLACE && placed.outside === true
    && placed.real && repository && inside(placed.real, repository));
  let outside = gitBase?.outside ?? 0;
  if (gitBase && elsewhereInTop.length) {
    const listed = await writtenChanges({ top: gitBase.top, commit: gitBase.commit, git, written: elsewhereInTop
      .map(({ entry, placed }) => ({ gitPath: relative(gitBase.top, placed.real).split(sep).join('/'), path: entry.path })) });
    for (const change of listed ?? []) types.set(change.path, change);
    outside = Math.max(0, outside - (listed ?? []).filter((c) => !c.untracked).length);
  }
  // D117 amended (the owner, 2026-10-18: "review the session's writes in any git repository; files outside any
  // repository are listed, not reviewed"): a write in a folder of no repository is listed by its folder (one inside
  // another's folder is that folder's) and counted (`outside_root`), never reviewed: no place, no file of the change, no
  // folder of the agents'.
  const folders = new Map();
  for (const item of kept) {
    if (item.placed.kind !== FOLDER_PLACE) continue;
    const at = item.placed.at;
    const holder = [...folders.keys()].find((folder) => inside(at, folder));
    if (holder !== undefined) folders.set(holder, folders.get(holder) + 1);
    else {
      let n = 1;
      for (const [folder, m] of [...folders]) if (inside(folder, at)) { n += m; folders.delete(folder); }
      folders.set(at, n);
    }
    item.placed = { kind: OUT_PLACE };
  }
  // Every other git repository, in the order its first write was recorded.
  const places = new Map();
  for (const item of kept) {
    if (item.placed.kind !== GIT_PLACE) continue;
    if (!places.has(item.placed.at)) places.set(item.placed.at, { kind: GIT_PLACE, at: item.placed.at, entries: [] });
    places.get(item.placed.at).entries.push(item);
  }
  // D124 (the owner, 2026-10-20: "you can do this now, on my laptop to test it"; the --code-repo option): each
  // repository the person gave with --code-repo (`codeRepos`: real top folders, `codeRepoTop`) is a place of the change
  // as if the session had written there, by D117's rules below: its base the session's start commit there
  // (`readPlaceBase`), its change the files its recorded writes there could have changed and those whose last change
  // came while the session ran (D113's window, `readPlaceWindow`: unrecorded), the other files that differ outside the
  // evaluated session. A place by the person's word, never by `isPlaceOfChange`, and named in the record (`given`). The
  // working folder's repository is already read by its own rule and is not made a place again; D124's review (its
  // medium): its record says that the person gave it (`base.given`), so no reader tells them to give it again.
  let givenHere = false;
  for (const at of Array.isArray(codeRepos) ? codeRepos : []) {
    if (typeof at !== 'string' || !isAbsolute(at)) continue;
    if (at === repository) { givenHere = true; continue; }
    if (!places.has(at)) places.set(at, { kind: GIT_PLACE, at, entries: [] });
    places.get(at).given = true;
  }
  // Each git repository's base (`readPlaceBase`). D117 amended (its second review's medium): it is a place of the change
  // only when a recorded write there resolves to a file that is there now and that differs from that base
  // (`isPlaceOfChange`); else its writes are counted (`outside_root`) and nothing in it is read, D113's window above all.
  // In a place, D113's window as in the working directory (`readPlaceWindow`): a path that differs from that base, that
  // no recorded write touched and whose last change lies inside the session's recorded window is a part of the change
  // with no recorded write (`recorded: false`), after every recorded write, in code-unit order per place.
  const placeOf = new Map();
  // D122: whether a placed write lies in a folder the code review reads: the working directory, or its repository's top
  // folder (the agents' working directory and the folder `agentFolders` gives them first).
  const readableHere = (placed) => typeof placed?.real === 'string' && (inside(placed.real, realRoot)
    || (typeof repository === 'string' && inside(placed.real, repository)));
  let placeWindow;
  const byWindow = [];
  for (const place of [...places.values()]) {
    const written = place.entries.map(({ entry, placed }) => ({ gitPath: relative(place.at, placed.real).split(sep)
      .join('/'), path: entry.path }));
    // The working folder's repository is a place of its own only when it has no start commit (`placeEntry`): its writes
    // outside the working directory are then the recorded edits, as under it.
    place.base = place.at === repository ? null : await readPlaceBase({ top: place.at, start, written, git });
    if (place.given !== true && !isPlaceOfChange(place.entries, place.base ? place.base.changes : null, readableHere)) {
      // D122 (a review low of D117): in a repository that is no place, a write that lies in a folder the code review
      // reads has nothing to review there now (no difference from its base, or no base and no file): it is no file of the
      // change, as such a write is none in the working directory's own repository (D113), and is counted among the
      // session's writes alone (`written`), never as a path outside the folders the code review could read. Every other
      // write there is counted (`outside_root`).
      for (const item of place.entries) item.placed = readableHere(item.placed) ? { kind: NO_CHANGE_PLACE }
        : { kind: OUT_PLACE };
      places.delete(place.at);
      continue;
    }
    if (place.base) {
      if (placeWindow === undefined) placeWindow = gitBase ? window : sessionWindow(start.at,
        await recordingEnd(recording, { byteEnd: recordingBytes }));
      const around = await readPlaceWindow({ top: place.at, commit: place.base.commit, start, written, own,
        homes: harnessHomes, git, window: placeWindow, realRoot });
      place.base = around === null ? null : { ...place.base, ...around };
    }
    for (const { entry } of place.entries) placeOf.set(entry.path, place);
    place.changes = new Map([...(place.base?.changes ?? []), ...(place.base?.kept ?? [])].map((c) => [c.path, c]));
    for (const change of place.base?.kept ?? []) {
      if (named.has(change.path)) continue;
      named.add(change.path);
      const entry = { path: change.path, recordedPath: join(place.at, change.gitPath), changed: true, recorded: false,
        outside: false, last: null, edits: [] };
      placeOf.set(entry.path, place);
      // D117's review: read only where its real place lies in that repository (a link there to a file elsewhere is not
      // read through: git's change is the link's), else named not readable.
      const real = await realPlace(join(place.at, change.gitPath));
      byWindow.push({ entry, placed: { kind: GIT_PLACE, at: place.at, real, missing: real !== null && inside(real, place.at)
        ? null : UNREADABLE } });
    }
  }
  kept.push(...byWindow);
  // D122: the writes that have nothing to review in a folder the code review reads are no file of the change.
  for (let at = kept.length - 1; at >= 0; at--) if (kept[at].placed.kind === NO_CHANGE_PLACE) kept.splice(at, 1);
  const reads = [];
  const attributeAsks = [];
  const finalPlan = kept.map(({ entry }) => entry);
  for (const { entry, placed } of kept) {
    const head = await readEntry(entry, placed, { maxBytes });
    const place = placeOf.get(entry.path) ?? null;
    // D117: a read the snapshot placed (`placed`), and, for a file of another place, that place and how its change is
    // read (`placeKind`): git's diff from its base, or the recorded edits.
    const where = placed.kind === OUT_PLACE ? {} : { placed: true, ...(place ? { place: place.at,
      placeKind: place.base ? GIT_BASE : RECORDED_EDITS_BASE } : {}) };
    const change = place ? place.changes?.get(entry.path) : types.get(entry.path);
    if (!change) { reads.push({ ...head, ...where }); continue; }
    const from = place ? { top: place.at, commit: place.base.commit } : { top: gitBase.top, commit: gitBase.commit };
    const side = await readGitSide(change, head, { ...from, maxBytes, git });
    if (typeof change.gitPath === 'string') attributeAsks.push({ at: reads.length, top: from.top, gitPath: change.gitPath });
    reads.push({ ...head, type: change.type, ...side, ...where });
  }
  // D149: each file's git attribute that makes it generated or vendored (`gitAttributesOf`), by its repository.
  for (const top of [...new Set(attributeAsks.map((a) => a.top))]) {
    const asks = attributeAsks.filter((a) => a.top === top);
    const found = await gitAttributesOf([...new Set(asks.map((a) => a.gitPath))], { top, git });
    for (const a of asks) if (found.has(a.gitPath)) reads[a.at] = { ...reads[a.at], gitAttribute: found.get(a.gitPath) };
  }
  // D113 amended (the owner, 2026-10-18: "for code review, you can even review code that is outside the session, but
  // tag it by outside the evaluated session"): the paths named apart are read as the change's are — the file now, at the
  // start commit, and git's own patch — and frozen apart (`outsideFiles`), each with no recorded write: the code review is
  // given them after the session's own change, tagged so (evidence code-pass.js `runCodePass`'s `outsideSnapshot`). They
  // stay no part of the change. D117: in the working folder's repository (`base.changedOutside`, read only where its
  // real place lies in the working directory, as git's list is: `listedPlace`) and in each other git repository of the
  // change (its `changedOutside`, from that repository's base: read only where its real place lies in it), each such
  // file naming its place.
  const outsideKept = [];
  for (const path of changedOutside.filter((p) => types.has(p))) {
    const entry = { path, recordedPath: join(gitBase.top, types.get(path).gitPath), changed: true, recorded: false,
      outside: false, last: null, edits: [] };
    outsideKept.push({ entry, placed: await listedPlace(entry, { dir, realRoot, homes }), change: types.get(path),
      from: { top: gitBase.top, commit: gitBase.commit }, where: {} });
  }
  for (const place of places.values()) {
    for (const change of place.base?.outsideChanges ?? []) {
      const entry = { path: change.path, recordedPath: change.path, changed: true, recorded: false, outside: false,
        last: null, edits: [] };
      const real = await realPlace(change.path);
      outsideKept.push({ entry, placed: { kind: GIT_PLACE, at: place.at, real, missing: real !== null
        && inside(real, place.at) ? null : UNREADABLE }, change, from: { top: place.at, commit: place.base.commit },
      where: { placed: true, place: place.at, placeKind: GIT_BASE } });
    }
  }
  const outsideReads = [];
  for (const { entry, placed, change, from, where } of outsideKept) {
    const head = await readEntry(entry, placed, { maxBytes });
    const side = await readGitSide(change, head, { ...from, maxBytes, git });
    outsideReads.push({ ...head, type: change.type, ...side, ...where });
  }
  const outsidePlan = outsideKept.map(({ entry }) => entry);
  // D113: `written`, how many paths the session's recorded writes could have changed, wherever they lie; with git,
  // `changedOutside`, the differing paths no such write touched and whose last change lies outside the session's window.
  // D117: `places`, every other repository or folder the session wrote to, each with its base and its own counts.
  // D117 amended: `folders`, each folder in no repository the session wrote to, with how many of its files lie there
  // (those with more first, ties in code-unit order); `unresolved`, how many of its writes are not resolved. D118 (b):
  // `written` counts those too (each could have changed a file), though no part of the plan.
  const written = recordedPlan.length + unresolved;
  const placeRecords = [...places.values()].map((place) => ({ kind: place.base ? GIT_BASE : RECORDED_EDITS_BASE,
    at: place.at, ...(place.base ? { commit: place.base.commit, how: place.base.how,
      changedOutside: place.base.changedOutside } : { repository: true }), written: place.entries.length,
    ...(place.given === true ? { given: true } : {}) }));
  const folderRecords = [...folders].map(([at, written]) => ({ at, written }))
    .sort((a, b) => b.written - a.written || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  // D178: with a git base, `within`, the working directory's offset in its repository (posix, '' at its top folder;
  // `gitTop` holds the working directory's real path inside it), so a reader can tell a file of the working folder from
  // the same file of another place (evidence code-pass.js `changeRepeatsOf`). No request reads it.
  const within = gitBase ? relative(gitBase.top, realRoot).split(sep).join('/') : null;
  const base = { ...(gitBase ? { kind: GIT_BASE, commit: gitBase.commit, how: gitBase.how, outside,
    changedOutside, written, ...(within !== null && within !== '..' && !within.startsWith('../') && !isAbsolute(within)
      ? { within } : {}) } : { kind: RECORDED_EDITS_BASE, written }),
    ...(placeRecords.length ? { places: placeRecords } : {}), ...(folderRecords.length ? { folders: folderRecords } : {}),
    ...(unresolved > 0 ? { unresolved } : {}), ...(literal.length ? { literal } : {}),
    // D124's review: the person gave the working folder's own repository with --code-repo (read by its own rule).
    ...(givenHere ? { given: true } : {}) };
  const files = freezeCodeSnapshot(finalPlan, reads, { base });
  if (base.places) base.places = orderPlaces(base.places, files);
  const stateOmits = [...own, ...harnessHomes].filter((place) => typeof place === 'string' && isAbsolute(place));
  // D117 amended: whether the session ran a shell command (code-pass.js `mayMissEdits`), so edits that
  // helper agents or scripts after a `cd` made can be missing from the change: the terminal says so.
  const snapshot = { root: true, dir, realRoot, top: repository ?? realRoot, repository: repository !== null, base,
    plan: finalPlan, files, outsideFiles: freezeCodeSnapshot(outsidePlan, outsideReads, { base }), stateOmits,
    ...(mayMissEdits(session) ? { unseenEdits: true } : {}) };
  // D117: the folders the agents read beside the working directory (`agentFolders`), only when the session wrote
  // elsewhere; else the agents read the repository's top folder when it is another, as before.
  return { ...snapshot, ...(base.places ? { folders: await agentFolders(snapshot) } : {}),
    repoState: await changeState(snapshot, { git }) };
}

/**
 * D117: the other places of a change (`base.places`), in the order every reader shows them — the working folder's
 * repository comes first, then these, those with more files of the change first (`files`, the frozen snapshot's or the
 * record's files, each `place` its place), ties by place in code-unit order (code-pass.js `placeRanks`). Pure.
 */
export const orderPlaces = (places, files) => {
  const ranks = placeRanks(files, places.map((p) => p.at));
  return [...places].sort((a, b) => ranks.get(a.at) - ranks.get(b.at));
};

/** D117: the folders each agent of the code step may read beside the working directory: the repository's top folder
 *  when it is another, then the folder of each other place that holds a file of the change (code-pass.js
 *  `placesHolding`, in their order; a file with a diff) and is a directory now; none that lies in the working directory
 *  or in another of them. Absolute real paths. */
export async function agentFolders(snapshot) {
  const candidates = [];
  const files = Array.isArray(snapshot?.files) ? snapshot.files : [];
  for (const at of [snapshot?.top, ...placesHolding(snapshot?.base, files).map((p) => p.at)]) {
    if (typeof at !== 'string' || !isAbsolute(at) || candidates.includes(at)) continue;
    try { if ((await stat(at)).isDirectory()) candidates.push(at); } catch { /* not there now: nothing to read */ }
  }
  const root = typeof snapshot?.realRoot === 'string' ? snapshot.realRoot : null;
  return candidates.filter((at) => !(root !== null && inside(at, root))
    && !candidates.some((other) => other !== at && inside(at, other)));
}

/**
 * D117: the state of everything the code step reads — the working folder's repository (`repositoryState`) and each other
 * place that holds a file of the change (code-pass.js `placesHolding`: the places the agents and the reader read; its
 * review: a place that holds none is never read, so a change there is none of the step's): a git repository's state the
 * same way, from its base; a folder's, the SHA-256 of each file of it the session wrote (`hashFileSync`; none there,
 * `missing`), since a folder in no repository has no list of its own. No such place: the working folder's repository's
 * state alone, as before D117. Null when the working folder's repository's state cannot be taken, or there is none and
 * no other place. It keys the code step's stored answers and tells whether anything it read changed while it ran.
 */
export async function changeState(snapshot, { git = runGit } = {}) {
  const omit = Array.isArray(snapshot?.stateOmits) ? snapshot.stateOmits : [];
  const primary = snapshot?.repository === true ? await repositoryState({ top: snapshot.top,
    commit: snapshot.base?.commit ?? null, git, omit, root: snapshot.realRoot ?? null }) : null;
  const places = placesHolding(snapshot?.base, Array.isArray(snapshot?.files) ? snapshot.files : []);
  if (!places.length) return primary;
  const states = [primary];
  for (const place of places) {
    if (place.kind === GIT_BASE) {
      states.push(await repositoryState({ top: place.at, commit: place.commit, git, omit }));
      continue;
    }
    const written = (Array.isArray(snapshot.files) ? snapshot.files : []).filter((f) => f?.place === place.at)
      .map((f) => (isAbsolute(f.path) ? f.path : resolve(snapshot.dir, f.path))).sort();
    states.push(createHash('sha256').update(JSON.stringify(written.map((path) => {
      try { return [path, hashFileSync(path)]; } catch { return [path, 'missing']; }
    }))).digest('hex'));
  }
  return createHash('sha256').update(JSON.stringify(states)).digest('hex');
}

/** The snapshot's file texts (readable files, and the start commit's text of each differing one). D90: nothing masks or
 *  scans them now; the tests read the snapshot through it. */
export const snapshotTexts = (snapshot) => (Array.isArray(snapshot?.files) ? snapshot.files : [])
  .flatMap((file) => [file?.text, file?.base?.text]).filter((text) => typeof text === 'string');


/** D149: the most paths one read of the start-commit folder asks git for. */
const START_CHUNK = 200;
/** D149: the most bytes one such read may print. */
const START_MAX_BYTES = 256 * 1024 * 1024;
/** D149: the file that marks a start-commit folder as Sonah's own: only a folder that holds it is ever removed. */
export const START_FOLDER_MARK = '.sonah-start-commit';
/**
 * D149: the objects `git cat-file --batch` printed for `asked` (each `<commit>:<git path>`, one a line, in that order):
 * `[{ asked, bytes }]` for each one git holds as a blob, its bytes as git stores them (no filter, no conversion, no
 * glob); a name git does not hold, or not as a blob, gives none. Pure.
 */
export function batchBlobs(buffer, asked) {
  const found = [];
  let at = 0;
  for (const name of asked) {
    const end = buffer.indexOf(0x0a, at);
    if (end < 0) break;
    const head = buffer.subarray(at, end).toString('utf8');
    at = end + 1;
    const m = /^[0-9a-f]{40}(?:[0-9a-f]{24})? (\S+) (\d+)$/.exec(head);
    // `<name> missing` (or `ambiguous`): no content follows.
    if (!m) continue;
    const size = Number(m[2]);
    const bytes = buffer.subarray(at, at + size);
    at += size + 1;
    if (m[1] === 'blob' && bytes.length === size) found.push({ asked: name, bytes: Buffer.from(bytes) });
  }
  return found;
}
/** D149: where a folder lies, its last name never followed: the real path of its nearest folder that exists, then the
 *  names below it. */
async function unfollowedPlace(path) {
  const whole = resolve(path);
  const rest = [basename(whole)];
  for (let up = dirname(whole); ; rest.unshift(basename(up)), up = dirname(up)) {
    try { return join(await realpath(up), ...rest); } catch { if (dirname(up) === up) return whole; }
  }
}
/** D149: clear `at` for a fresh start-commit folder: nothing there, a link (unlinked, never followed) or a folder of
 *  Sonah's own (it holds START_FOLDER_MARK: removed). Anything else is refused: false. */
async function clearStartPlace(at) {
  let entry;
  try { entry = await lstat(at); } catch { return true; }
  if (entry.isSymbolicLink()) { await unlink(at); return true; }
  if (!entry.isDirectory()) return false;
  try { if (!(await lstat(join(at, START_FOLDER_MARK))).isFile()) return false; } catch { return false; }
  await rm(at, { recursive: true, force: true });
  return true;
}
/**
 * D149: the start-commit folder of a review of several units: the files of the change that have an earlier side
 * (`paths`, as the change names them, under the working directory), as they were at the start commit (`commit`), each
 * read as git stores it (`git cat-file --batch` on `<commit>:<git path>`, the path literal, 200 a call: no filter, no
 * conversion, no export rule) and written as those bytes at its path from the repository's top folder under `into`
 * (Sonah's state folder's `code-pass/start-commit`), made afresh and marked Sonah's (START_FOLDER_MARK). `into`'s own
 * name is never followed: a link there is unlinked, and a folder there that is not Sonah's is left as it is and no
 * folder is made. None either when the snapshot has no repository or no git base, or when `into` lies in a folder the
 * code step's agents read (the working directory, the repository, the change's other folders) or holds one: Sonah never
 * writes where the review reads the repository. A name that would leave `into` is never written. Any failure while it
 * is made removes it and gives none: the review goes on without it. With `dryRun`, the same answer and nothing written.
 * `{ at, files: [{ path, copy }], chunks, failedChunks }` (a call that failed gives none of its files), or null.
 */
export async function makeStartFolder({ snapshot, commit, paths, into, gitInput = runGitInput, dryRun = false }) {
  const top = snapshot?.top, real = snapshot?.realRoot;
  if (snapshot?.repository !== true || snapshot?.base?.kind !== GIT_BASE || typeof commit !== 'string'
      || !HASH.test(commit) || typeof top !== 'string' || typeof real !== 'string' || typeof into !== 'string'
      || !isAbsolute(into)) return null;
  const target = await unfollowedPlace(into);
  const readHere = [top, real, snapshot.dir, ...(Array.isArray(snapshot.folders) ? snapshot.folders : [])]
    .filter((folder) => typeof folder === 'string' && isAbsolute(folder));
  if (readHere.some((folder) => inside(target, folder) || inside(folder, target))) return null;
  const asked = [];
  for (const path of Array.isArray(paths) ? paths : []) {
    if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\n')) continue;
    const gitPath = relative(top, join(real, path)).split(sep).join('/');
    if (!gitPath || gitPath === '..' || gitPath.startsWith('../') || gitPath === START_FOLDER_MARK
        || asked.some((a) => a.gitPath === gitPath)) continue;
    asked.push({ path, gitPath });
  }
  if (!asked.length) return null;
  const copyOf = (a) => join(target, ...a.gitPath.split('/'));
  const chunks = Math.ceil(asked.length / START_CHUNK);
  if (dryRun) return { at: target, files: asked.map((a) => ({ path: a.path, copy: copyOf(a) })), chunks, failedChunks: 0 };
  if (!(await clearStartPlace(target).catch(() => false))) return null;
  try {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await mkdir(target, { mode: 0o700 });
    await writeFile(join(target, START_FOLDER_MARK), '', { mode: 0o600, flag: 'wx' });
    const files = [];
    let failedChunks = 0;
    for (let from = 0; from < asked.length; from += START_CHUNK) {
      const chunk = asked.slice(from, from + START_CHUNK);
      const names = chunk.map((a) => `${commit}:${a.gitPath}`);
      const result = await gitInput(['cat-file', '--batch'], `${names.join('\n')}\n`, { cwd: top,
        maxBuffer: START_MAX_BYTES });
      if (!result.ok || !Buffer.isBuffer(result.stdout)) { failedChunks += 1; continue; }
      const blobs = new Map(batchBlobs(result.stdout, names).map((b) => [b.asked, b.bytes]));
      for (const a of chunk) {
        const bytes = blobs.get(`${commit}:${a.gitPath}`);
        const copy = copyOf(a);
        if (!bytes || !inside(copy, target) || copy === target) continue;
        await mkdir(dirname(copy), { recursive: true, mode: 0o700 });
        await writeFile(copy, bytes, { mode: 0o600, flag: 'wx' });
        files.push({ path: a.path, copy });
      }
    }
    return { at: target, files, chunks, failedChunks };
  } catch {
    await removeStartFolder(target);
    return null;
  }
}
/** D149: the start-commit folder removed (a link there unlinked, a folder of Sonah's own removed, anything else left as
 *  it is): whether nothing is there now. Never throws. */
export async function removeStartFolder(at) {
  try {
    const place = await unfollowedPlace(at);
    await clearStartPlace(place);
    try { await lstat(place); return false; } catch { return true; }
  } catch { return false; }
}
