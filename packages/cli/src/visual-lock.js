// D226: the lock of a graphs page's folder. `sonah visual`, plain `sonah` (D218), the graphs page of `sonah review
// --format html` (D219) and the push run all draw through visual-command.js `drawVisualPage`, which takes this lock
// once the folder is made and before the job writes into it, and releases it on every way out, so two of them never
// draw the same folder at once.
//
// The lock is one file in the folder, `draw.lock`, one line of JSON: `{"v":1,"pid":<process id>,"start":<when that
// process started, as the system records it (processStart), or null where Sonah cannot read it>}`. It is published
// complete in one step: written to a temporary file beside it, then hard-linked to its name, which fails when anything
// is there (on a file system with no hard links, it is created with O_EXCL and written at once). It is removed by the
// drawer that holds it: after the job, whatever the job's end, and, when the process exits while it holds it, by an
// 'exit' listener. A process that is killed leaves it; the next drawer takes it back.
//
// A lock is held while its process runs: its id names a running process (EPERM: another user's) whose start, read the
// same way, is the one the lock records. A process whose id is free (it ended), or names a process that started at
// another time (the id came back to another process), holds nothing, and the lock is taken back: under a claim file
// beside it named by the lock's bytes and published as the lock is, so that of several drawers only one removes it,
// and only while it still holds those bytes. Nobody removes another drawer's claim but the same way, one level down.
// Where Sonah cannot read a start (Windows, no `ps`), a running process holds the lock. A second drawer never waits: it
// gets the holder and stops with `folder_in_use` (VISUAL_LOCK_WORDS).
// D227: the push run takes two more locks of this kind, by another file name in another folder (`file`): the runner of
// one repository's queue (`runner.lock` in its queue folder) and the laptop's one job slot (`team/locks/job.lock`),
// push-queue.js.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { link, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** The lock's file name, in the folder it locks. */
export const VISUAL_LOCK_FILE = 'draw.lock';
/** The problem a drawer stops with when another one holds the folder, and its fix (a problem named with its fix: exit 2
 *  for `sonah visual` and plain `sonah`). */
export const VISUAL_LOCK_WORDS = Object.freeze({
  folder_in_use: 'Another Sonah is drawing this page into the same folder now. Wait until it ends, then run the same '
    + 'command again. Sonah reuses the answers that it stored.',
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A lock's record, from its bytes, or null for bytes of any other shape. A later version (`v` above 1) keeps `pid` and
 *  `start`, so that a Sonah of this version never takes a lock from a later one that runs. */
function lockOf(bytes) {
  try {
    const lock = JSON.parse(bytes);
    return isObj(lock) && Number.isSafeInteger(lock.v) && lock.v >= 1 && Number.isSafeInteger(lock.pid) && lock.pid > 0
      && (lock.start === null || (typeof lock.start === 'string' && lock.start !== ''))
      ? { pid: lock.pid, start: lock.start } : null;
  } catch { return null; }
}
/** What stands at `path`: null when nothing does, else its bytes and its record (null for another shape). */
async function readLock(path) {
  let bytes;
  try { bytes = await readFile(path, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  return { bytes, lock: lockOf(bytes) };
}

/** The start field (the 22nd) of the text of /proc/<pid>/stat, or null for text of another shape. It is read after the
 *  second field, the command's name in parentheses, which can hold spaces and parentheses itself. */
export function statStart(stat) {
  const text = String(stat);
  const end = text.lastIndexOf(')');
  const start = end === -1 ? undefined : text.slice(end + 1).trim().split(/\s+/)[19];
  return /^\d+$/.test(start ?? '') ? start : null;
}

/**
 * When a running process started, as the system records it, read the same way for any process, this one included, so
 * that the start a drawer records in its lock and the start another drawer reads later are the same text: on Linux
 * the clock ticks from the system's boot to the process's start (/proc/<pid>/stat), elsewhere `ps -o lstart=` in UTC,
 * to the second. On Linux and macOS neither moves when the wall clock is set (a clock set by hand or stepped by its
 * time service, a virtual machine's set after its host slept), and both count from the process's own start, not from
 * when node began in it. (On Linux `ps` reckons a start from the wall clock, so it is not asked there.) Null when
 * Sonah cannot read it: on Windows, with no `ps`, for a process that is not there, or any other answer.
 */
export async function processStart(pid) {
  if (process.platform === 'win32' || !Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform === 'linux') {
    try { return statStart(await readFile(`/proc/${pid}/stat`, 'utf8')); } catch { return null; }
  }
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'lstart=', '-p', String(pid)], { timeout: 5_000, maxBuffer: 4096,
      env: { PATH: `/bin:/usr/bin${process.env.PATH ? `:${process.env.PATH}` : ''}`, LC_ALL: 'C', TZ: 'UTC0' } },
    (error, stdout) => {
      const said = error ? '' : String(stdout).trim();
      resolve(said === '' || said.includes('\n') ? null : said);
    });
  });
}
// This process's start, read once, as each lock it takes records it.
let ownStart = null;
const ownStartOf = () => (ownStart ??= processStart(process.pid));

/** Whether the process a lock names still holds it (the module's comment). `startOf` reads a process's start. */
export async function lockHeld({ pid, start }, { startOf = processStart } = {}) {
  if (pid === process.pid) return start === await ownStartOf();
  try { process.kill(pid, 0); } catch (error) { if (error?.code !== 'EPERM') return false; }
  // A process that could not read its own start: a running one holds the lock.
  if (start === null) return true;
  const seen = await startOf(pid);
  return seen === null || seen === start;
}

/** Publish `bytes` at `path` complete in one step: 'linked', or 'written' on a file system with no hard links (created
 *  with O_EXCL, then written at once), or false when anything stands there. `linkFile` is node's `link`. */
async function publish(folder, path, bytes, n, linkFile) {
  const temp = join(folder, `.${basename(path)}.${process.pid}.${n}.tmp`);
  await rm(temp, { force: true });
  try {
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await linkFile(temp, path);
      return 'linked';
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
    }
    // A file system with no hard links: created, then written at once.
    try {
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      return 'written';
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      throw error;
    }
  } finally { await rm(temp, { force: true }); }
}

/** The claim of the file at `path` whose bytes are `bytes`: beside it, named by them. */
const claimOf = (path, bytes) => `${path}.claim-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
/**
 * Take back what stands at `path`, whose bytes `seen` are and which holds nothing: under its claim, published as the
 * lock is, and only while `path` still holds those bytes. A claim already there is another drawer's, and it is removed
 * only when its record names a process that no longer holds it (a drawer killed while it took a lock back), the same
 * way, one level down (`level` 1); a claim found at that level, or one whose bytes are not a record's (where the file
 * system has no hard links, one still being written), is left, and the round ends. So is a lock with no bytes where
 * the folder has no hard links: a drawer may be about to write it.
 */
async function takeBack(folder, path, seen, mine, n, { startOf, linkFile }, level = 0) {
  const claim = claimOf(path, seen);
  const made = await publish(folder, claim, mine, n, linkFile);
  if (!made) {
    const other = level === 0 ? await readLock(claim) : null;
    if (other?.lock && !(await lockHeld(other.lock, { startOf }))) {
      await takeBack(folder, claim, other.bytes, mine, n, { startOf, linkFile }, 1);
    }
    return;
  }
  try {
    if (seen === '' && made === 'written') return;
    const now = await readLock(path);
    if (now?.bytes === seen) await rm(path, { force: true });
  } finally { await rm(claim, { force: true }); }
}

// The locks this process holds, removed by the 'exit' listener (added with the first) if it exits while it holds them.
const held = new Set();
let releaseOnExit = false;
function hold(path, mine) {
  const entry = { path, mine };
  held.add(entry);
  if (!releaseOnExit) {
    releaseOnExit = true;
    process.on('exit', () => {
      for (const { path: at, mine: bytes } of held) {
        try { if (readFileSync(at, 'utf8') === bytes) rmSync(at, { force: true }); } catch { /* gone already */ }
      }
    });
  }
  let released = false;
  // Removes the lock while it is still this drawer's; once only, and never rejects.
  return async () => {
    if (released) return;
    released = true;
    held.delete(entry);
    try { if ((await readFile(path, 'utf8')) === mine) await rm(path, { force: true }); } catch { /* gone already */ }
  };
}

let taken = 0;
/**
 * Take the lock of `folder` (made already): `{ release }`, an async function that removes it, or `{ holder }` when
 * another drawer holds it (its `{ pid, start }`, or null when the lock changed hands each time Sonah looked). Never
 * waits. Rejects only when the folder cannot be written. `startOf` reads a process's start, and `link` hard-links a
 * file (tests pass their own). D227: `file` names the lock's file in the folder (VISUAL_LOCK_FILE by default).
 */
export async function takeVisualLock(folder, { startOf = processStart, link: linkFile = link,
  file = VISUAL_LOCK_FILE } = {}) {
  const path = join(folder, file);
  const n = ++taken;
  const mine = `${JSON.stringify({ v: 1, pid: process.pid, start: await ownStartOf() })}\n`;
  // A few rounds: between a refused link and the look, the lock can be released or taken back.
  for (let round = 0; round < 4; round++) {
    if (await publish(folder, path, mine, n, linkFile)) return { release: hold(path, mine) };
    const seen = await readLock(path);
    if (!seen) continue;
    if (seen.lock && await lockHeld(seen.lock, { startOf })) return { holder: seen.lock };
    await takeBack(folder, path, seen.bytes, mine, n, { startOf, linkFile });
  }
  return { holder: null };
}

/** D227: whether a lock of this kind at `path` is held now (its record names a process that holds it): the push hook
 *  asks it of a repository's runner before it starts one. Reads only. */
export async function lockHolder(path, { startOf = processStart } = {}) {
  let seen;
  try { seen = await readLock(path); } catch { return null; }
  return seen?.lock && await lockHeld(seen.lock, { startOf }) ? seen.lock : null;
}

/** The kind of this file's word table, for the style linter (packages/render/test/style-lint.js; D227 review 1). */
export const STYLE_KINDS = Object.freeze({ VISUAL_LOCK_WORDS: 'notice' });
export const STYLE_FIXTURES = Object.freeze({});
