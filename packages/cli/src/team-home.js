// D224 (item 10, C2): where the team commands keep their files: `team/` in Sonah's folder (SONAH_HOME, else ~/.sonah;
// settings.js `sonahHome`), never the private laptop client's `~/.sonah/hosted.json` or `~/.sonah/hosted/`, which follow
// HOME alone (sonah-hosted client/home.mjs, ported here).
//   team/connection.json  `{"v":1,"server":...,"token":...,"login":...}`: the Sonah Team server this computer is
//                         connected to, its upload token and the login the server named for it. Mode 0600 in a 0700
//                         folder, written whole (a new file beside it, then a rename); the only file that holds the token.
// D225 (item 10, C3) adds the push hook's files:
//   team/hooks.json       `{"v":1,"repos":[{"common":...,"server":...}]}`: the repositories whose pushes Sonah reviews
//                         (`sonah hook add --push`), by the real path of their git common dir, each with the server its
//                         hook was turned on for (a push starts nothing while the connection is to another one). Mode
//                         0600, written whole under a lock file (`hooks.json.lock`, made with O_EXCL).
//   team/refused.json     `{"v":1,"server":...,"login":...}`: the mark that the connection's server no longer takes its
//                         token (a 401), so a push starts nothing until this computer connects again. A new connection
//                         removes it. D227 review: written only while the connection file holds the token refused.
//   team/queue/           the push hook's tickets (push-queue.js), one folder per repository.
// D227 (item 10, C4) adds the push run's files:
//   team/runs.json        `{"v":1,"runs":[...]}`: each pushed branch's run, its state and why (ledger.js
//                         PUSH_RUN_STATES, PUSH_RUN_REASONS), its page link, log and folder; the newest RUNS_KEPT. Mode
//                         0600, written whole under `runs.json.lock`. A run that waits to be uploaded (`pending_upload`)
//                         carries the server and login of the connection it was drawn under.
//   team/waiting.json     the comments that wait for you, as the server last listed them (fix-waiting.js), with the
//                         server and login of the connection that read them. Mode 0600. D227 review 1: written and
//                         removed only under `waiting.json.lock`, and written only while that connection is on file.
//   team/logs/            one log a pushed commit (push-run.js), 0600 in a 0700 folder, never the token; 30 days.
//   team/locks/           the laptop's one job slot (`job.lock`, push-queue.js): one push's review at a time.
// D229 (item 10, C6) adds the fix loop's launch records:
//   team/fixes/<id>.json  one file a comment (fix-launches.js): the review, the change, and each launch of Claude Code
//                         for it, with the exact prompt sent and the session it went to. Mode 0600 in a 0700 folder,
//                         written whole under `<id>.json.lock`. It belongs to no one connection: the upload's `answers`
//                         are read from it long after a push, so a new connection leaves it as it is.
// D230 (item 10, C7) adds the start reminder's one file:
//   team/locks/remind.json  `{"v":1,"server","login","repos":{"<owner>/<name>":time}}`: when the reminder's refresh last
//                         asked for each repository's list, under that connection (remind-hook.js), so it asks once a
//                         minute at most. Mode 0600, written whole under `remind.json.lock`, with a claim older than a
//                         minute dropped at each write. D230 review 1: it belongs to its connection, so
//                         `forgetConnection` and `forgetOtherConnection` remove it under its lock.
// The token never goes into config.json, whose exact shape would then stop every review (settings.js `parseSettings`).
// What belongs to one connection goes with it (the plan's A5): `forgetConnection` removes it all, and
// `forgetOtherConnection` what another connection left; push-queue.js `forgetTickets` drops the tickets (D227 review:
// for both, so a runner's lock in the queue stays with the runner that holds it). D227 review 1: a review that waits to
// be sent is also one whose send a process that ended cut off (`waitsToSend`), and `sonah hook remove --push` ends a
// repository's (`endPendingUploads`).
//
// No work at import.
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { strictJson } from '../../slicer/src/strict-json.js';
import { PUSH_RUN_REASONS, PUSH_RUN_STATES } from '../../evidence/src/push-run-states.js';
import { isLogin } from '../../visual/src/fix-prompt.mjs';
import { sonahHome } from './settings.js';
import { isRemoteName } from './team-git.js';
import { visualServer } from './visual-server.js';
import { lockHeld } from './visual-lock.js';

/** The team commands' folder in Sonah's folder. */
export const TEAM_FOLDER = 'team';
/** The connection's file in that folder, and the version its `v` key holds. */
export const CONNECTION_FILE = 'connection.json';
export const CONNECTION_VERSION = 1;
/** D225: the hooked repositories' list, the refused mark, and the push hook's queue folder. */
export const HOOKS_FILE = 'hooks.json';
export const HOOKS_VERSION = 1;
export const REFUSED_FILE = 'refused.json';
export const QUEUE_FOLDER = 'queue';
/** D227: the runs, the waiting comments' cache, the logs and the locks. */
export const RUNS_FILE = 'runs.json';
export const RUNS_VERSION = 1;
/** The most runs runs.json keeps, the newest. */
export const RUNS_KEPT = 200;
export const WAITING_FILE = 'waiting.json';
export const LOGS_FOLDER = 'logs';
export const LOCKS_FOLDER = 'locks';
/** D230: the start reminder's claims, in the locks folder (remind-hook.js). */
export const REMIND_FILE = 'remind.json';
/** D229: the launch records' folder, one file a comment (fix-launches.js). */
export const FIXES_FOLDER = 'fixes';
/** RUNS_KEPT runs of a few short keys each. */
const MAX_RUNS_BYTES = 4 * 1024 * 1024;
/** A connection file holds four short keys; anything larger is not this file. */
const MAX_CONNECTION_BYTES = 4096;
/** D227: the waiting comments' cache: at most 100 comments a repository (fix-waiting.js). */
export const MAX_WAITING_BYTES = 16 * 1024 * 1024;
/** The list holds one short entry a repository; 1 MB is far more than any person's repositories. */
const MAX_HOOKS_BYTES = 1024 * 1024;
/** How long a lock file of the list may stand before Sonah takes it as left by a crash, and how long Sonah waits. */
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 10_000;

/** The team commands' folder: `<Sonah's folder>/team`. */
export const teamHome = (where = {}) => join(sonahHome(where), TEAM_FOLDER);
/** The connection file's path. */
export const connectionPath = (where = {}) => join(teamHome(where), CONNECTION_FILE);
/** The hooked repositories' list's path. */
export const hooksPath = (where = {}) => join(teamHome(where), HOOKS_FILE);
/** The push hook's queue folder. */
export const queuePath = (where = {}) => join(teamHome(where), QUEUE_FOLDER);
const refusedPath = (where = {}) => join(teamHome(where), REFUSED_FILE);
/** D227: the runs' file, the waiting comments' cache, the logs' folder and the locks' folder. */
export const runsPath = (where = {}) => join(teamHome(where), RUNS_FILE);
export const waitingPath = (where = {}) => join(teamHome(where), WAITING_FILE);
export const logsPath = (where = {}) => join(teamHome(where), LOGS_FOLDER);
export const locksPath = (where = {}) => join(teamHome(where), LOCKS_FOLDER);
/** D230: the start reminder's claims (remind-hook.js). */
export const remindPath = (where = {}) => join(locksPath(where), REMIND_FILE);
/** D229: the launch records' folder. */
export const fixesPath = (where = {}) => join(teamHome(where), FIXES_FOLDER);

/** An upload token's shape, as the laptop checks it: 16 to 512 printable characters with no space (the server's own
 *  are `sonah_` and 43 more). Its value is never shown. */
export const isToken = (x) => typeof x === 'string' && /^[\x21-\x7e]{16,512}$/.test(x);

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** A file's text when it is the person's own regular file that no one else can write, of at most `max` bytes, read
 *  with no link followed: `{ state: 'ok', text }`, `{ state: 'absent' }` or `{ state: 'invalid' }`. A file that others
 *  can read is closed to them first (0600). */
export async function readOwnText(path, max) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!stat.isFile() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || (stat.mode & 0o022) !== 0 || stat.size > max) return { state: 'invalid' };
    if ((stat.mode & 0o077) !== 0) await file.chmod(0o600).catch(() => {});
    return { state: 'ok', text: await file.readFile('utf8') };
  } catch (error) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? { state: 'absent' } : { state: 'invalid' };
  } finally { await file?.close().catch(() => {}); }
}

/** Writes `text` to `name` in the team folder, owner-only (0600, in 0700 folders), replacing the whole file at once: a
 *  new file beside it, made with no link followed, then renamed over it, so a reader never sees half of one. D229: a
 *  `name` in a folder of the team folder (`fixes/<id>.json`) is written the same way, with its new file in that folder. */
export async function writeWhole(where, name, text) {
  const target = join(teamHome(where), name);
  const dir = dirname(target);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `.${basename(name)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  let file;
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    await file.writeFile(text, 'utf8');
    await file.close(); file = null;
    await rename(temporary, target);
  } catch (error) {
    await file?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return target;
}

/** The connection a file's text holds, as `{ server, token, login }`, or null when it is not exactly
 *  `{ "v": 1, "server", "token", "login" }`: a server as `visualServer` writes it, a token of a token's shape and a login
 *  the server's own check takes (fix-prompt.mjs `isLogin`). */
export function parseConnection(text) {
  const parsed = strictJson(text);
  if (!parsed.json || !parsed.strict || !plainObject(parsed.value)) return null;
  const { v, server, token, login, ...rest } = parsed.value;
  if (v !== CONNECTION_VERSION || Object.keys(rest).length) return null;
  if (typeof server !== 'string' || visualServer(server) !== server || !isToken(token) || !isLogin(login)) return null;
  return { server, token, login };
}

/** Reads the connection: `{ state: 'absent' }` when there is none, `{ state: 'ok', connection }`, or
 *  `{ state: 'invalid' }` (not a regular file of the person's, writable by others, too large, unreadable or not this
 *  shape). A link is never followed. A file that others can read is closed to them first (the token is in it). */
export async function readConnection(where = {}) {
  const read = await readOwnText(connectionPath(where), MAX_CONNECTION_BYTES);
  if (read.state !== 'ok') return read;
  const connection = parseConnection(read.text);
  return connection === null ? { state: 'invalid' } : { state: 'ok', connection };
}

/** Writes the connection, owner-only (0600, in 0700 folders), replacing the whole file at once: a new file beside it,
 *  then renamed over it, so a reader never sees half of one. D225: a refused mark of the connection before goes. Returns
 *  its path. */
export async function writeConnection({ server, token, login }, where = {}) {
  if (visualServer(server) !== server || !isToken(token) || !isLogin(login)) throw new Error('not a connection');
  const target = await writeWhole(where, CONNECTION_FILE,
    `${JSON.stringify({ v: CONNECTION_VERSION, server, token, login })}\n`);
  await rm(refusedPath(where), { force: true });
  return target;
}

/** A run ended because the connection it belongs to ended or changed (A5). */
const CONNECTION_CHANGED = Object.freeze({ state: 'failed', why: 'connection_changed' });

/** Removes the connection and what belongs to it (A5): the connection file and D225's refused mark; D227: the waiting
 *  comments' cache, and each upload that waits to be sent ends `failed`, `connection_changed`. The push hook's tickets
 *  are push-queue.js `forgetTickets`'s (D227 review: the queue folder is no longer removed whole, which took a running
 *  runner's lock with it). A link is removed, never followed. D227 review 1: the cache goes under its lock, after the
 *  connection, so a list the server sends after this (a call made before it) is not kept (fix-waiting.js
 *  `saveWaiting`). D230 review 1: and the start reminder's claims, under their lock, after the connection, so a refresh
 *  that read the connection before this claims nothing (remind-hook.js `runRemindRefresh` reads it again there). */
export async function forgetConnection(where = {}) {
  await rm(connectionPath(where), { force: true });
  await rm(refusedPath(where), { force: true });
  await withFileLock(where, waitingPath(where), () => rm(waitingPath(where), { force: true }));
  await withFileLock(where, remindPath(where), () => rm(remindPath(where), { force: true }));
  await endPendingUploads(where, { end: CONNECTION_CHANGED });
}

/** D227: what a connection other than `keep` (`{ server, login }`) left, when a new connection replaces it (A5): the
 *  waiting comments' cache when it is another's, and each upload of another's that waits to be sent (it ends
 *  `failed`, `connection_changed`). The tickets are push-queue.js `forgetTickets`'s. D230 review 1: and the start
 *  reminder's claims, whoever made them (they only hold back an ask for a minute). */
export async function forgetOtherConnection(where, keep) {
  await withFileLock(where, waitingPath(where), async () => {
    const read = await readOwnText(waitingPath(where), MAX_WAITING_BYTES);
    if (read.state === 'absent') return;
    const parsed = read.state === 'ok' ? strictJson(read.text) : null;
    const mine = parsed?.strict && plainObject(parsed.value) && parsed.value.server === keep.server
      && parsed.value.login === keep.login;
    if (!mine) await rm(waitingPath(where), { force: true });
  });
  await withFileLock(where, remindPath(where), () => rm(remindPath(where), { force: true }));
  await endPendingUploads(where, { keep, end: CONNECTION_CHANGED });
}

/** D227 review 1: whether a run waits to be sent: `pending_upload`, or `uploading` while no process sends it (no pid,
 *  or one whose process ended: the computer shut down or the process was killed while it sent the review). */
export async function waitsToSend(run) {
  return run.state === 'pending_upload' || (run.state === 'uploading'
    && (run.pid === null || !(await lockHeld({ pid: run.pid, start: run.start }))));
}

/** The uploads that wait to be sent (`waitsToSend`) end as `end` says (`{ state, why }`): those of any connection but
 *  `keep` (`{ server, login }`; all of them with none), and with `common`, only those of that repository (D227 review
 *  1: `sonah hook remove --push`). A run that a process took up meanwhile (another state or pid) is left. */
export async function endPendingUploads(where, { keep = null, common = null, end }) {
  const read = await readRuns(where);
  if (read.state !== 'ok') return;
  const seen = new Map();
  for (const r of read.runs) {
    const theirs = keep === null || r.server !== keep.server || r.login !== keep.login;
    if (theirs && (common === null || r.common === common) && (await waitsToSend(r))) seen.set(r.id, r);
  }
  if (!seen.size) return;
  const still = (r) => seen.has(r.id) && seen.get(r.id).state === r.state && seen.get(r.id).pid === r.pid;
  await updateRuns(where, (runs) => runs.map((r) => (still(r)
    ? { ...r, state: end.state, why: end.why, updatedAt: new Date().toISOString() } : r)));
}

/** D225: marks the connection as one its server no longer takes (a 401 to its token), so the push hook starts nothing
 *  until this computer connects again. D227 review: only while the connection file holds that token, so a 401 to a
 *  token that a new connection replaced (one of the same server and login too) never marks the new one. A connection
 *  written while the mark is made takes it back: `writeConnection` removes the mark after it writes, and this removes
 *  it when it reads another token after it wrote. Whether the mark stands. */
export async function markRefused({ server, login, token }, where = {}) {
  const holds = async () => {
    const now = await readConnection(where);
    return now.state === 'ok' && now.connection.server === server && now.connection.login === login
      && now.connection.token === token;
  };
  if (!(await holds())) return false;
  await writeWhole(where, REFUSED_FILE, `${JSON.stringify({ v: 1, server, login })}\n`);
  if (await holds()) return true;
  await rm(refusedPath(where), { force: true });
  return false;
}

/** D225: whether the connection carries the refused mark: the mark names its server and login. */
export async function isRefused({ server, login }, where = {}) {
  const read = await readOwnText(refusedPath(where), MAX_CONNECTION_BYTES);
  if (read.state !== 'ok') return false;
  const parsed = strictJson(read.text);
  return parsed.strict && plainObject(parsed.value) && parsed.value.v === 1 && parsed.value.server === server
    && parsed.value.login === login;
}

/** D225: the list's repositories, `[{ common, server }]`, from its text, or null when it is not exactly
 *  `{ "v": 1, "repos": [...] }`, each entry exactly `{ common, server }`: an absolute path and a server as
 *  `visualServer` writes it, no path twice. */
export function parseHooks(text) {
  const parsed = strictJson(text);
  if (!parsed.json || !parsed.strict || !plainObject(parsed.value)) return null;
  const { v, repos, ...rest } = parsed.value;
  if (v !== HOOKS_VERSION || Object.keys(rest).length || !Array.isArray(repos)) return null;
  const seen = new Set();
  for (const entry of repos) {
    if (!plainObject(entry) || Object.keys(entry).length !== 2) return null;
    const { common, server } = entry;
    if (typeof common !== 'string' || !isAbsolute(common) || common.includes('\0') || seen.has(common)) return null;
    if (typeof server !== 'string' || visualServer(server) !== server) return null;
    seen.add(common);
  }
  return repos.map(({ common, server }) => ({ common, server }));
}

/** D225: reads the list: `{ state: 'absent' }`, `{ state: 'ok', repos }` or `{ state: 'invalid' }`, by the
 *  connection file's rules. */
export async function readHooks(where = {}) {
  const read = await readOwnText(hooksPath(where), MAX_HOOKS_BYTES);
  if (read.state !== 'ok') return read;
  const repos = parseHooks(read.text);
  return repos === null ? { state: 'invalid' } : { state: 'ok', repos };
}

/** Runs `fn` while this process holds the lock file of the team folder's file at `path` (`<path>.lock`, made with
 *  O_EXCL; one older than LOCK_STALE_MS is taken as left by a crash). */
export async function withFileLock(where, path, fn) {
  const lock = `${path}.lock`;
  // D229: the folder of the file, which is the team folder itself for every file but a launch record.
  await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const file = await open(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0), 0o600);
      await file.close();
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try { if (Date.now() - (await stat(lock)).mtimeMs > LOCK_STALE_MS) await unlink(lock); } catch { /* gone */ }
      if (Date.now() > until) throw new Error(`${lock} stays taken`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try { return await fn(); } finally { await unlink(lock).catch(() => {}); }
}

/** D225: changes the list under its lock: `change(repos)` gives the new list, which is written whole, sorted by path.
 *  A list that cannot be read is never written over: this throws an error whose code is `push_hook_list_unreadable`
 *  and whose `file` is the list. Returns the new list. */
export async function updateHooks(where, change) {
  return withFileLock(where, hooksPath(where), async () => {
    const read = await readHooks(where);
    if (read.state === 'invalid')
      throw Object.assign(new Error('push_hook_list_unreadable'), { code: 'push_hook_list_unreadable',
        file: hooksPath(where) });
    const repos = [...change(read.state === 'ok' ? read.repos : [])]
      .sort((a, b) => (a.common < b.common ? -1 : a.common > b.common ? 1 : 0));
    await writeWhole(where, HOOKS_FILE, `${JSON.stringify({ v: HOOKS_VERSION, repos })}\n`);
    return repos;
  });
}

/** D227: a run's keys as runs.json holds them, each with its check; a run is read with these keys only. */
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const nullOr = (check) => (x) => x === null || check(x);
const text = (max) => (x) => typeof x === 'string' && x.length > 0 && x.length <= max && !x.includes('\0');
const absolute = (x) => text(4096)(x) && isAbsolute(x);
const count = (x) => Number.isSafeInteger(x) && x >= 0;
const RUN_KEYS = Object.freeze({
  id: (x) => typeof x === 'string' && /^[0-9a-f]{12}$/.test(x),
  state: (x) => PUSH_RUN_STATES.includes(x),
  why: nullOr((x) => PUSH_RUN_REASONS.includes(x)),
  code: nullOr((x) => typeof x === 'string' && /^[a-z_]{1,40}$/.test(x)),
  status: nullOr((x) => Number.isSafeInteger(x) && x >= 100 && x <= 599),
  ms: nullOr(count),
  common: nullOr(absolute), dir: nullOr(absolute), repo: nullOr(text(201)), branch: nullOr(text(1024)),
  sha: nullOr((x) => typeof x === 'string' && SHA.test(x)), base: nullOr((x) => typeof x === 'string' && SHA.test(x)),
  server: nullOr((x) => typeof x === 'string' && visualServer(x) === x), login: nullOr(isLogin),
  at: nullOr(text(40)), updatedAt: nullOr(text(40)),
  pid: nullOr((x) => Number.isSafeInteger(x) && x > 0), start: nullOr(text(200)),
  log: nullOr(absolute), out: nullOr(absolute), url: nullOr((x) => text(2048)(x) && /^https?:\/\//.test(x)),
  // D227 review (second look 1): a remote's name by team-git.js's own check, the one the hook and the run write the
  // field with (`isRemoteName`), so a name they keep is never a shape this file refuses. A second check of its own
  // refused an `@` or a `:` that `isRemoteName` takes, and `runOf` then returned null for the whole record: every
  // write of that run dropped its row, so the push left no record at all, `sonah status` showed nothing for it, and a
  // pending upload of it could never be found to be sent.
  remote: nullOr(isRemoteName),
});
/** The run that a record of runs.json holds, with RUN_KEYS only (a key missing is null), or null when its id or state
 *  is not one, or a key holds a value of another shape. */
export function runOf(record) {
  if (!plainObject(record)) return null;
  const run = {};
  for (const [key, check] of Object.entries(RUN_KEYS)) {
    const value = Object.hasOwn(record, key) ? record[key] : null;
    if (!check(value)) return null;
    run[key] = value;
  }
  return run;
}

/** D227: the runs, oldest first: `{ state: 'absent', runs: [] }`, `{ state: 'ok', runs }`, or `{ state: 'invalid', runs:
 *  [] }` (read as the connection file is; not `{ "v": 1, "runs": [...] }`). A record that is not a run is left out. */
export async function readRuns(where = {}) {
  const read = await readOwnText(runsPath(where), MAX_RUNS_BYTES);
  if (read.state !== 'ok') return { state: read.state, runs: [] };
  const parsed = strictJson(read.text);
  if (!parsed.json || !parsed.strict || !plainObject(parsed.value) || parsed.value.v !== RUNS_VERSION
    || !Array.isArray(parsed.value.runs))
    return { state: 'invalid', runs: [] };
  return { state: 'ok', runs: parsed.value.runs.map(runOf).filter(Boolean) };
}

/** D227: changes the runs under their lock: `change(runs)` gives the new list (oldest first), of which the newest
 *  RUNS_KEPT are written whole, 0600. A file Sonah cannot read as runs is written over: it holds only what status shows.
 *  Returns the list written. */
export async function updateRuns(where, change) {
  return withFileLock(where, runsPath(where), async () => {
    const runs = (await change((await readRuns(where)).runs)).map(runOf).filter(Boolean).slice(-RUNS_KEPT);
    await writeWhole(where, RUNS_FILE, `${JSON.stringify({ v: RUNS_VERSION, runs })}\n`);
    return runs;
  });
}

/** D227: merges `patch` into the run `id` (a new run when there is none; `updatedAt` set). Returns the run. */
export async function updateRun(where, id, patch) {
  let next = null;
  await updateRuns(where, (runs) => {
    const at = runs.findIndex((r) => r.id === id);
    next = { ...(at >= 0 ? runs[at] : { id }), ...patch, updatedAt: new Date().toISOString() };
    return at >= 0 ? runs.map((r, i) => (i === at ? next : r)) : [...runs, next];
  });
  return next;
}
