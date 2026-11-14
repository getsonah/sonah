// D225 (item 10, C3): the push hook's queue, from the private laptop client's queue.mjs (sonah-hosted client/queue.mjs).
// One folder per repository in team/queue/ (team-home.js), named by the first 16 hex characters of the SHA-256 of the
// real path of its git common dir, and in it one ticket per pushed branch:
//   q-<branch key>.json  `{"v":1,"id","branch","sha","remote","dir","common","at","server","login"}`: a pushed branch
//                        that waits for its review. The branch key is the first 12 hex characters of the SHA-256 of the
//                        branch's name. A newer push of the branch replaces the ticket whole.
// A ticket carries the server and login of the connection it was left under (the plan's A5): `forgetTickets` drops the
// tickets of any other connection (`sonah connect` to another server or login), all of them (`sonah disconnect`), or a
// repository's (`sonah hook remove --push`). Files are 0600 in 0700 folders, written whole (a new file, then a rename).
// D227 (item 10, C4): the push run (push-run.js) takes them, and the folder holds two more files:
//   run-<id>.json        a ticket the runner took (`take`, a rename of its q- file), while it reviews it; a newer push
//                        of the branch then leaves a new q- file beside it. One left by a runner that ended is an
//                        orphan, whose run the next runner marks `stopped`.
//   runner.lock          the repository's one runner (visual-lock.js, `{"v":1,"pid","start"}`): the push hook starts a
//                        runner only when none holds it, and a runner whose process ended holds nothing.
// and `team/locks/job.lock` (the same kind of lock) is the laptop's one job slot: one push's review draws at a time,
// whatever its repository (the plan's risk 6). Node's own modules and the light team modules only, so the hook stays
// light: team-home.js, visual-lock.js, settings.js, and the two checks of a ticket's server and login (visual-server.js
// `visualServer`, fix-prompt.mjs `isLogin`). D225 review (second look 1): `visualServer` came from visual-command.js,
// which took the code snapshot and the code pass into every push; d225-push-hook.test.js names the push path's whole
// import closure, so an import added here fails that test.
//
// No work at import.
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isLogin } from '../../visual/src/fix-prompt.mjs';
import { locksPath, queuePath, teamHome, updateRuns } from './team-home.js';
import { sonahHome } from './settings.js';
import { visualServer } from './visual-server.js';
import { lockHolder, takeVisualLock } from './visual-lock.js';

/** The most branches of one push that the hook leaves for review, the newest tips first (the plan's A7, owner decision
 *  18). */
export const PUSH_BRANCHES_MAX = 3;
const TICKET_VERSION = 1;
const TICKET_NAME = /^q-[0-9a-f]{12}\.json$/;
const TAKEN_NAME = /^run-[0-9a-f]{12}\.json$/;
/** D227: the runner's lock in a repository's queue folder, and the laptop's one job slot in team/locks/. */
export const RUNNER_LOCK_FILE = 'runner.lock';
export const JOB_LOCK_FILE = 'job.lock';
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** A ticket holds a few short keys; anything larger is not a ticket. */
const MAX_TICKET_BYTES = 64 * 1024;

const hash = (text) => createHash('sha256').update(String(text)).digest('hex');
/** The queue folder's name of the repository whose git common dir is `common`. */
export const repoKey = (common) => hash(common).slice(0, 16);
const branchKey = (branch) => hash(branch).slice(0, 12);
/** The queue folder of the repository whose git common dir is `common`. */
export const queueFolderOf = (where, common) => join(queuePath(where), repoKey(common));

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Whether `t` is a ticket of this version, every key of its shape. */
export function isTicket(t) {
  if (!plainObject(t)) return false;
  const { v, id, branch, sha, remote, dir, common, at, server, login, ...rest } = t;
  return v === TICKET_VERSION && Object.keys(rest).length === 0 && typeof id === 'string' && /^[0-9a-f]{12}$/.test(id)
    && typeof branch === 'string' && branch.length > 0 && branch.length <= 1024 && !/[\0\n]/.test(branch)
    && typeof sha === 'string' && SHA.test(sha)
    && (remote === null || (typeof remote === 'string' && remote.length <= 4096))
    && typeof dir === 'string' && isAbsolute(dir) && typeof common === 'string' && isAbsolute(common)
    && Number.isSafeInteger(at) && typeof server === 'string' && visualServer(server) === server && isLogin(login);
}

/** Leaves the ticket of one pushed branch: `{ common, dir, branch, sha, remote, server, login, at }`. A ticket of the
 *  same branch that waits is replaced whole. Returns `{ ticket, replaced }`, the replaced ticket or null. */
export async function leaveTicket(where, { common, dir, branch, sha, remote = null, server, login, at = Date.now() }) {
  const ticket = { v: TICKET_VERSION, id: randomBytes(6).toString('hex'), branch, sha, remote, dir, common, at, server,
    login };
  if (!isTicket(ticket)) throw new Error('not a ticket');
  const folder = queueFolderOf(where, common);
  await mkdir(sonahHome(where), { recursive: true, mode: 0o700 });
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, `q-${branchKey(branch)}.json`);
  const replaced = await readTicket(file);
  const temporary = join(folder, `.${ticket.id}.${process.pid}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(`${JSON.stringify(ticket)}\n`, 'utf8');
    await handle.close(); handle = null;
    await rename(temporary, file);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return { ticket, replaced };
}

/** A ticket file's ticket, or null (not there, not a regular file, too large, not a ticket). */
async function readTicket(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > MAX_TICKET_BYTES) return null;
    const ticket = JSON.parse(await readFile(file, 'utf8'));
    return isTicket(ticket) ? ticket : null;
  } catch { return null; }
}

/** The tickets that wait in one repository's queue, the oldest push first. */
export async function waitingTickets(where, common) {
  const folder = queueFolderOf(where, common);
  let names = [];
  try { names = await readdir(folder); } catch { return []; }
  const tickets = [];
  for (const name of names.filter((n) => TICKET_NAME.test(n))) {
    const ticket = await readTicket(join(folder, name));
    if (ticket && ticket.common === common) tickets.push(ticket);
  }
  return tickets.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Drops the tickets that wait in one repository's queue (`common`), or in every repository's; with `keep` (`{ server,
 *  login }`), only those that another connection left (A5). A file that is not a ticket is dropped with them, and a
 *  folder left empty is removed (the queue's own folder too, for every repository's). D227: a runner's lock and the
 *  tickets it took stay with it. D227 review: the run of each ticket dropped that still waits for its review
 *  (`waiting`, or `queued` with no runner's pid) ends as `end` says (`{ state, why }`), so `sonah status` does not show
 *  it waiting for good; a ticket a runner took first is its own. A failure to write the runs is dropped. */
export async function forgetTickets(where, { common = null, keep = null, end = null } = {}) {
  const root = queuePath(where);
  let folders = [];
  try { folders = common === null ? await readdir(root) : [repoKey(common)]; } catch { return; }
  const dropped = new Set();
  for (const name of folders.filter((n) => /^[0-9a-f]{16}$/.test(n))) {
    const folder = join(root, name);
    let files = [];
    try { files = await readdir(folder); } catch { continue; }
    for (const file of files.filter((n) => TICKET_NAME.test(n))) {
      const ticket = await readTicket(join(folder, file));
      if (keep && ticket && ticket.server === keep.server && ticket.login === keep.login) continue;
      try {
        await unlink(join(folder, file));
        if (ticket) dropped.add(ticket.id);
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    await rmdir(folder).catch(() => {});
  }
  if (common === null) await rmdir(root).catch(() => {});
  if (end === null || !dropped.size) return;
  const waits = (r) => dropped.has(r.id) && (r.state === 'waiting' || (r.state === 'queued' && r.pid === null));
  await updateRuns(where, (runs) => runs.map((r) => (waits(r)
    ? { ...r, state: end.state, why: end.why, updatedAt: new Date().toISOString() } : r))).catch(() => {});
}

/** D227: takes a waiting ticket for review: its file moved aside whole, to `run-<id>.json` (a push that replaces it at
 *  the same moment wins: the ticket taken is the one the file holds then). Returns the ticket taken, with its `file`,
 *  or null when it is gone. */
export async function takeTicket(where, ticket) {
  const folder = queueFolderOf(where, ticket.common);
  const from = join(folder, `q-${branchKey(ticket.branch)}.json`);
  const to = join(folder, `run-${ticket.id}.json`);
  try { await rename(from, to); } catch { return null; }
  const taken = await readTicket(to);
  if (!taken || taken.common !== ticket.common) { await rm(to, { force: true }); return null; }
  if (taken.id === ticket.id) return { ...taken, file: to };
  const mine = join(folder, `run-${taken.id}.json`);
  try { await rename(to, mine); } catch { return null; }
  return { ...taken, file: mine };
}

/** D227: puts a taken ticket back to wait, unless a newer push of its branch waits now (then it was replaced: false). */
export async function giveBack(where, taken) {
  const file = join(queueFolderOf(where, taken.common), `q-${branchKey(taken.branch)}.json`);
  if (await lstat(file).then(() => true, () => false)) { await rm(taken.file, { force: true }); return false; }
  try { await rename(taken.file, file); return true; } catch { return false; }
}

/** D227: a taken ticket is done with: its file goes. */
export async function doneWith(taken) { await rm(taken.file, { force: true }); }

/** D227: the tickets an earlier runner took and left (a new runner calls this before it takes any), their files
 *  removed. */
export async function orphans(where, common) {
  const folder = queueFolderOf(where, common);
  let names = [];
  try { names = await readdir(folder); } catch { return []; }
  const out = [];
  for (const name of names.filter((n) => TAKEN_NAME.test(n))) {
    const ticket = await readTicket(join(folder, name));
    await rm(join(folder, name), { force: true });
    if (ticket) out.push(ticket);
  }
  return out;
}

/** D227: becomes the runner of the repository whose git common dir is `common`: `{ release }`, or null when another
 *  runner holds it (or it cannot be taken). */
export async function takeRunner(where, common) {
  const folder = queueFolderOf(where, common);
  try {
    await mkdir(sonahHome(where), { recursive: true, mode: 0o700 });
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const lock = await takeVisualLock(folder, { file: RUNNER_LOCK_FILE });
    return lock.release ? lock : null;
  } catch { return null; }
}

/** D227: whether a runner of that repository runs now (reads only: the push hook asks before it starts one). */
export async function runnerGoing(where, common) {
  return (await lockHolder(join(queueFolderOf(where, common), RUNNER_LOCK_FILE))) !== null;
}

/** D227: takes the laptop's one job slot: `{ release }`, or null while another push's review holds it. */
export async function takeJobSlot(where) {
  try {
    await mkdir(sonahHome(where), { recursive: true, mode: 0o700 });
    await mkdir(teamHome(where), { recursive: true, mode: 0o700 });
    await mkdir(locksPath(where), { recursive: true, mode: 0o700 });
    const lock = await takeVisualLock(locksPath(where), { file: JOB_LOCK_FILE });
    return lock.release ? lock : null;
  } catch { return null; }
}
