// D157: the code map's git part. Each identifier token of the change's hunks (evidence code-map.js `codeMapPlan`) is
// searched with git grep, a whole word, as a fixed string, in text files only, over the whole repository as it is now,
// every file the repository's state counts: the untracked files git does not ignore and the tracked files (`grepArgs`,
// whose `--untracked` walk skips a tracked file that matches an ignore pattern), and those tracked files that match an
// ignore pattern, listed once a place and searched by name (`grepPathsArgs`); never at the start commit (map /2). Each
// occurrence is then grounded in the file as Sonah reads it now. Reads only: git with optional locks off and no network
// (code-snapshot.js `runGit`), the files read and closed. Zero model calls. Bounds by counts (CODE_MAP_LIMITS); the one
// clock read is the runaway guard, which drops the whole map, never a part of it.
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { runGit } from './code-snapshot.js';
import { CODE_MAP_LIMITS, codeMapCandidates, codeMapOf, codeMapPlan, droppedCodeMap, grepOccurrences }
  from '../../evidence/src/code-map.js';

const list = (v) => (Array.isArray(v) ? v : []);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A repository's own settings that would change what git grep prints, set back for every call. */
const GREP_SETTINGS = Object.freeze(['-c', 'grep.column=false', '-c', 'grep.fullName=false', '-c',
  'grep.fallbackToNoIndex=false', '-c', 'grep.patternType=fixed']);
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** D157: git grep's arguments for one token: `-n -o -z` (each occurrence as `<name>\0<line>\0<token>`), a whole word
 *  (`-w`), a fixed string (`-F`), text files only (`-I`), the untracked files git does not ignore too, over the whole
 *  repository (`:/`). */
export const grepArgs = (token) => [...GREP_SETTINGS, 'grep', '--no-color', '-n', '-o', '-z', '-w', '-I', '-F',
  '--untracked', '-e', token, '--', ':/'];

/** D157: the tracked files of a place that match an ignore pattern, over the whole repository, by their paths from the
 *  place's folder, NUL-ended: what `git grep --untracked` never reads. */
export const IGNORED_TRACKED_ARGS = Object.freeze(['ls-files', '-z', '--cached', '--ignored', '--exclude-standard', '--',
  ':/']);
/** D157: git grep's arguments for one token over named tracked files (`paths`, from the place's folder), each read
 *  literally (`:(literal)`, no glob); the rest as `grepArgs`, tracked files only. */
export const grepPathsArgs = (token, paths) => [...GREP_SETTINGS, 'grep', '--no-color', '-n', '-o', '-z', '-w', '-I', '-F',
  '-e', token, '--', ...paths.map((path) => `:(literal)${path}`)];
/** D157: the most bytes of path names one `grepPathsArgs` call names (a frozen literal, within any system's argument
 *  bound): the tracked ignored files go in runs of whole names up to it, one call a run. */
const IGNORED_PATHSPEC_BYTES = 65_536;
/** The runs of `paths`, in order, each a run of whole names of at most IGNORED_PATHSPEC_BYTES (a longer name alone). */
function pathRuns(paths) {
  const runs = [];
  let run = [], bytes = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(path, 'utf8') + 11;
    if (run.length && bytes + size > IGNORED_PATHSPEC_BYTES) { runs.push(run); run = []; bytes = 0; }
    run.push(path);
    bytes += size;
  }
  if (run.length) runs.push(run);
  return runs;
}

/** The places the map searches, each `{ place, cwd, searched }`: the working folder's repository (`place` null) and each
 *  other place of the change (D117: one map per place, no edge across places), each searched when it is a git
 *  repository. */
function placesOf(snapshot, root) {
  const base = plain(snapshot.base) ? snapshot.base : {};
  const places = [{ place: null, cwd: root, searched: snapshot.repository === true }];
  for (const p of list(base.places)) {
    if (!plain(p) || typeof p.at !== 'string' || !isAbsolute(p.at)) continue;
    places.push({ place: p.at, cwd: p.at, searched: p.kind === 'git' || p.repository === true });
  }
  return places;
}

/** Run `thunks` at most `max` at once, their results in their own order. */
async function inFlight(max, thunks) {
  const out = new Array(thunks.length);
  let next = 0;
  const worker = async () => { while (next < thunks.length) { const at = next++; out[at] = await thunks[at](); } };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, max), thunks.length) }, worker));
  return out;
}

/** A file's lines `wanted` (numbers), read now, never through a link at its last name: `{ [n]: text }`, or null when it
 *  is not a regular file, is over `maxBytes` or cannot be read. */
function headLines(path, wanted, maxBytes) {
  let fd = null;
  try {
    fd = openSync(path, READ_FLAGS);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) return null;
    const bytes = Buffer.alloc(info.size);
    let read = 0;
    while (read < info.size) {
      const n = readSync(fd, bytes, read, info.size - read, read);
      if (n <= 0) break;
      read += n;
    }
    return linesWanted(bytes.subarray(0, read).toString('utf8'), wanted);
  } catch { return null; } finally { if (fd !== null) closeSync(fd); }
}
/** D157: a path by its real folders, the last name never followed, as git names a file it finds from a real folder: the
 *  real path of its nearest folder that exists, then the names below it. A file the change names through a link is
 *  then the file git's occurrences name. */
export function realName(path) {
  const whole = resolve(path);
  const rest = [basename(whole)];
  for (let up = dirname(whole); ; rest.unshift(basename(up)), up = dirname(up)) {
    try { return join(realpathSync(up), ...rest); } catch { if (dirname(up) === up) return whole; }
  }
}
const linesWanted = (text, wanted) => {
  const lines = text.split('\n');
  return Object.fromEntries(list(wanted).filter((n) => n >= 1 && n <= lines.length).map((n) => [n, lines[n - 1]]));
};

/**
 * D157: the code map of a frozen snapshot (code-snapshot.js `readCodeSnapshot`), or null when the snapshot has no root.
 * Each searched place's tracked files that match an ignore pattern are listed once (IGNORED_TRACKED_ARGS; a listing
 * that fails is recorded, `unlisted`). The plan (evidence code-map.js `codeMapPlan`) asks each searched place's distinct
 * tokens in its order: one git grep call a token (`grepArgs`), and one more a run of those ignored files
 * (`grepPathsArgs`; none when there are none), at most `inFlight` asks at once, until the review's call bound
 * (`grepCalls`) would be passed: the asks after it are `unasked` (`grep_cap`). A call that printed more than `callBytes` is an overflow (`common_name`), one
 * git could not run `failed`. Occurrences in a place the review writes (the snapshot's `stateOmits`, unless it holds
 * the working directory) are no part of the repository. The candidates' lines are read once a file (`fileBytes` at
 * most), from the working tree. The files of the change are named by their real folders (`realName`), as git's
 * occurrences are. Past `timeoutMs` from the first call (`now`, a monotonic clock, the one clock read), the whole map is
 * dropped (`droppedCodeMap`); once seen past, it stays past. `git` and `now` are injectable for tests.
 */
export async function readCodeMap(snapshot, { git = runGit, now = () => performance.now(), limits = CODE_MAP_LIMITS } = {}) {
  if (!plain(snapshot) || snapshot.root !== true || !Array.isArray(snapshot.files)) return null;
  const root = typeof snapshot.realRoot === 'string' ? snapshot.realRoot : typeof snapshot.dir === 'string'
    ? snapshot.dir : null;
  if (root === null) return null;
  const top = typeof snapshot.top === 'string' ? snapshot.top : root;
  const places = placesOf(snapshot, root);
  const where = new Map(places.map((p) => [p.place, p]));
  const real = Object.fromEntries(snapshot.files.filter((f) => typeof f?.path === 'string')
    .map((f) => [f.path, realName(isAbsolute(f.path) ? f.path : resolve(root, f.path))]));
  const plan = codeMapPlan(snapshot.files, { root, top, places: places.filter((p) => p.place !== null)
    .map((p) => p.place), real, limits });
  const deadline = now() + limits.timeoutMs;
  // The guard's latch: once the clock is seen past the deadline, the map is past it, whatever the clock reads later.
  let past = false;
  const late = () => { if (!past && now() > deadline) past = true; return past; };
  const timeLeft = () => Math.max(1, Math.ceil(deadline - now()));
  // Each searched place's tracked files that match an ignore pattern, listed once, in runs (none: no call more).
  for (const p of places) {
    p.runs = [];
    if (!p.searched || late()) continue;
    const listed = await git(IGNORED_TRACKED_ARGS, { cwd: p.cwd, timeout: timeLeft() });
    if (!listed.ok) { p.unlisted = true; continue; }
    p.ignored = listed.stdout.toString('utf8').split('\0').filter(Boolean);
    p.runs = pathRuns(p.ignored);
  }
  // The asks within the call bound: the first ones of searched places whose calls fit (one, and one a run of the
  // place's tracked ignored files), in the plan's order.
  let used = 0, open = true;
  const within = plan.asks.map((ask) => {
    const p = where.get(ask.place);
    if (p?.searched !== true) return false;
    const cost = 1 + p.runs.length;
    if (open && used + cost <= limits.grepCalls) { used += cost; return true; }
    open = false;
    return false;
  });
  const calls = { grep: 0, failed: 0 };
  // One call; the first that does not answer decides the token's state.
  const call = async (args, p) => {
    if (late()) return { state: 'failed' };
    calls.grep += 1;
    const result = await git(args, { cwd: p.cwd, maxBuffer: limits.callBytes, differ: true, timeout: timeLeft() });
    if (late()) return { state: 'failed' };
    if (!result.ok) {
      if (result.overflow === true) return { state: 'overflow' };
      calls.failed += 1;
      return { state: 'failed' };
    }
    return { state: 'ok', text: result.stdout.toString('utf8') };
  };
  // Past the guard no call more is made; the map is dropped below, once, whatever was found.
  const search = async (ask) => {
    const p = where.get(ask.place);
    const occurrences = [];
    for (const args of [grepArgs(ask.token), ...p.runs.map((run) => grepPathsArgs(ask.token, run))]) {
      const got = await call(args, p);
      if (got.state !== 'ok') return { state: got.state };
      for (const o of grepOccurrences(got.text, ask.token).occurrences)
        occurrences.push({ path: resolve(p.cwd, o.name), line: o.line });
    }
    return { state: 'ok', occurrences };
  };
  const found = await inFlight(limits.inFlight, plan.asks.map((ask, at) => async () => (
    where.get(ask.place)?.searched !== true ? null : within[at] ? search(ask) : { state: 'unasked' })));
  // The places Sonah and the coding agents write while the review runs, by their real paths, unless one holds the
  // working directory (as the repository's state leaves them out).
  const omit = list(snapshot.stateOmits).filter((p) => typeof p === 'string' && isAbsolute(p)).map((p) => {
    try { return realpathSync(p); } catch { return resolve(p); }
  }).filter((p) => !(root === p || root.startsWith(`${p}/`)));
  const candidates = codeMapCandidates(plan, found, { limits, omit });
  // Ground: each candidate file read once, now.
  const lines = {};
  for (const [key, wanted] of Object.entries(candidates.reads)) {
    if (late()) break;
    lines[key] = headLines(key.slice(key.indexOf('\0') + 1), wanted, limits.fileBytes);
  }
  // The one decision of the runaway guard: past it, the whole map is dropped, never a part of it kept.
  if (late()) return droppedCodeMap({ limits });
  return codeMapOf(plan, candidates, lines, { limits, calls,
    places: places.map((p) => ({ place: p.place, searched: p.searched,
      ...(list(p.ignored).length ? { ignored: p.ignored.length } : {}), ...(p.unlisted ? { unlisted: true } : {}) })) });
}
