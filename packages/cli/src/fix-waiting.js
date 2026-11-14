// D227 (item 10, C4): the comments that wait for you (sonah-hosted FIXLOOP.md "How the author is told", on the laptop),
// from the private laptop client's waiting.mjs (sonah-hosted client/waiting.mjs): the cache that the push run keeps.
// The server's list (GET /api/fixes?owner&repo, team-api.js `fixes`) is checked by shape, entry by entry, and kept in
// team/waiting.json (team-home.js): `{"v":1,"server","login","repos":{"<owner>/<name>":{"at","total","fixes"}}}`, mode
// 0600, written whole under `waiting.json.lock`; a refresh replaces only its repository's entry. It carries the server
// and login of the connection that read it (the plan's A5): an entry is read only under that connection, a refresh
// under another one starts the file again, and team-home.js `forgetConnection` and `forgetOtherConnection` remove it.
// D227 review 1: a list is kept only while this computer's connection is still the one it was asked under, read under
// the file's lock, which those two take to remove it: an answer that comes after `sonah disconnect`, or after a
// connection as another login, is dropped.
// Only the words' first line is ever kept here. `sonah status` reads the counts with no network call.
// D229 (item 10, C6): the hidden `sonah pre-push` reads the cache too, for the line of the comments that wait on a
// pushed branch (`waitingOn`, said in push-hook-run.js's words), and `sonah fix` marks a comment it started Claude
// Code on (`markLaunched`), so that line and `sonah status`'s count leave it out until the next refresh says how it
// stands. `sonah fixes` refreshes a repository's entry with one call (fix-command.js). Node's own modules, the closed
// lists of fix-prompt.mjs (pure) and team-home.js only: this module is read at every push.
// D230 (item 10, C7): the Claude Code start reminder reads the cache too (remind-hook.js), and its review 1 removes a
// repository's entry when the server no longer lists that repository for this login (`forgetWaiting`).
//
// No work at import.
import { strictJson } from '../../slicer/src/strict-json.js';
import { FIRST_LINE_MAX, FIX_ACTS, FRAME, isBranch, isCommentId, isCount, isFullSha, isItemKey, isLogin,
  isName, isOwner, isPrNumber, isTime, isWords } from '../../visual/src/fix-prompt.mjs';
import { MAX_WAITING_BYTES, readConnection, readOwnText, WAITING_FILE, waitingPath, withFileLock,
  writeWhole } from './team-home.js';

/** The server lists at most this many comments of a repository. */
export const WAITING_LIST_MAX = 100;
/** An item's title as the server keeps one. */
const TITLE_MAX = 1000;
/** A fix that still waits for the author: none yet (null), opened or launched. Each is of FIX_STATES. */
export const WAITING_STATES = Object.freeze([null, 'opened', 'launched']);
const WAITING_VERSION = 1;
const plainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** The key of a repository in the cache: "<owner>/<name>" in lower case (the server's own names are any case). */
export const repoKeyOf = (owner, name) => `${owner}/${name}`.toLowerCase();

/** One entry of the list, checked by shape, with only its known fields; null when it is not of its shape. */
export function checkEntry(f) {
  if (!plainObject(f) || !plainObject(f.comment) || !plainObject(f.item) || !plainObject(f.pr)) return null;
  const { comment: c, item: it, pr } = f;
  if (!isCommentId(c.id) || !isLogin(c.by) || !FIX_ACTS.includes(c.act) || !isTime(c.at)) return null;
  const first = c.first ?? null;
  if (first !== null && !(isWords(first) && !first.includes('\n') && first.length <= FIRST_LINE_MAX)) return null;
  if (!isItemKey(it.key) || typeof it.title !== 'string' || it.title.length < 1 || it.title.length > TITLE_MAX)
    return null;
  const tier = it.tier ?? null;
  if (it.kind === 'finding' ? !Object.hasOwn(FRAME.tiers, tier) : !(it.kind === 'function' && tier === null)) return null;
  const number = pr.number ?? null;
  if ((number !== null && !isPrNumber(number)) || !isBranch(pr.branch) || !isFullSha(f.head)) return null;
  const state = f.state ?? null;
  if (!WAITING_STATES.includes(state)) return null;
  return { comment: { id: c.id, by: c.by, act: c.act, at: c.at, first },
    item: { kind: it.kind, key: it.key, tier, title: it.title }, pr: { number, branch: pr.branch }, head: f.head, state };
}

/**
 * GET /api/fixes's answer for owner/name, checked: `{ repo, total, fixes, dropped }`, or null when the answer as a whole
 * is not of its shape or not of that repository. An entry that is not of its shape is dropped and counted.
 */
export function checkList(json, { owner, name }) {
  if (!plainObject(json) || !plainObject(json.repo) || !isOwner(json.repo.owner) || !isName(json.repo.name)
    || repoKeyOf(json.repo.owner, json.repo.name) !== repoKeyOf(owner, name)) return null;
  if (!Array.isArray(json.fixes) || json.fixes.length > WAITING_LIST_MAX) return null;
  if (!isCount(json.total) || json.total < json.fixes.length) return null;
  const fixes = json.fixes.map(checkEntry).filter(Boolean);
  return { repo: { owner: json.repo.owner, name: json.repo.name }, total: json.total, fixes,
    dropped: json.fixes.length - fixes.length };
}

const checkCached = (e) => (plainObject(e) && isTime(e.at) && isCount(e.total) && Array.isArray(e.fixes)
  && e.fixes.length <= WAITING_LIST_MAX ? { at: e.at, total: e.total, fixes: e.fixes.map(checkEntry).filter(Boolean) }
  : null);

/** The whole file as read: `{ server, login, repos }`, or null when there is none or it is not of its shape. */
async function readFile(where) {
  const read = await readOwnText(waitingPath(where), MAX_WAITING_BYTES);
  if (read.state !== 'ok') return null;
  const parsed = strictJson(read.text);
  if (!parsed.json || !parsed.strict || !plainObject(parsed.value)) return null;
  const { v, server, login, repos } = parsed.value;
  if (v !== WAITING_VERSION || typeof server !== 'string' || !isLogin(login) || !plainObject(repos)) return null;
  const kept = {};
  for (const [key, entry] of Object.entries(repos)) {
    const checked = checkCached(entry);
    if (checked) kept[key] = checked;
  }
  return { server, login, repos: kept };
}

/** The cached repositories of the connection `{ server, login }`: `{ "<owner>/<name>": { at, total, fixes } }`, each
 *  checked; empty when the cache is another connection's, or there is none. No network. */
export async function readWaiting(where, { server, login }) {
  const file = await readFile(where);
  return file && file.server === server && file.login === login ? file.repos : {};
}

/** Keeps one repository's list (from `checkList`) for the connection `{ server, login }`: the file written whole, 0600.
 *  The cache of another connection is not kept. D227 review 1: only while the connection on file is that server and
 *  login (else nothing is written): whether it was kept. */
export async function saveWaiting(where, { server, login }, list) {
  const key = repoKeyOf(list.repo.owner, list.repo.name);
  return withFileLock(where, waitingPath(where), async () => {
    const now = await readConnection(where);
    if (now.state !== 'ok' || now.connection.server !== server || now.connection.login !== login) return false;
    const file = await readFile(where);
    const repos = file && file.server === server && file.login === login ? file.repos : {};
    repos[key] = { at: new Date().toISOString(), total: list.total, fixes: list.fixes };
    await writeWhole(where, WAITING_FILE, `${JSON.stringify({ v: WAITING_VERSION, server, login, repos })}\n`);
    return true;
  });
}

/** The comments that wait in a cached entry, those Claude Code is already on (launched) left out. */
export const notLaunched = (entry) => (entry?.fixes ?? []).filter((f) => f.state !== 'launched');
/** How many comments of a cached entry wait to be taken up: the server's total, less those being fixed. */
export const waitingCount = (entry) => Math.max(0, entry.total - (entry.fixes.length - notLaunched(entry).length));

/** D229: the comments of a cached entry that wait on one branch: `{ count, number }` (`number` the pull request they
 *  are all on, else null), or null when none waits on it. What says it is the caller's words (push-hook-run.js). */
export function waitingOn(entry, branch) {
  const mine = notLaunched(entry).filter((f) => f.pr.branch === branch);
  if (!mine.length) return null;
  const numbers = [...new Set(mine.map((f) => f.pr.number))];
  return { count: mine.length, number: numbers.length === 1 ? numbers[0] : null };
}

/** D230 review 1: removes one repository's entry from the cache of the connection `{ server, login }`, when its server
 *  no longer lists that repository for this login (a 403 that says so, to the start reminder's refresh), so the reminder
 *  stops showing a list that can no longer be refreshed and stops asking for it. Under the file's lock, and only while
 *  the file is that connection's: whether it was there to remove. */
export async function forgetWaiting(where, { server, login }, key) {
  return withFileLock(where, waitingPath(where), async () => {
    const file = await readFile(where);
    if (!file || file.server !== server || file.login !== login || !Object.hasOwn(file.repos, key)) return false;
    const { [key]: gone, ...repos } = file.repos;
    await writeWhole(where, WAITING_FILE, `${JSON.stringify({ v: WAITING_VERSION, server, login, repos })}\n`);
    return true;
  });
}

/** D229: marks one cached comment as launched (`sonah fix` started Claude Code on it), so the push hook's line and
 *  `sonah status`'s count leave it out until the next refresh says how it stands: whether it was there to mark. The
 *  file is read and written under its lock, and only while the connection `{ server, login }` is the one it was read
 *  under (`saveWaiting`'s rule). */
export async function markLaunched(where, { server, login }, key, id) {
  return withFileLock(where, waitingPath(where), async () => {
    const file = await readFile(where);
    if (!file || file.server !== server || file.login !== login) return false;
    const entry = file.repos[key];
    if (!entry || !entry.fixes.some((f) => f.comment.id === id && f.state !== 'launched')) return false;
    const repos = { ...file.repos,
      [key]: { ...entry, fixes: entry.fixes.map((f) => (f.comment.id === id ? { ...f, state: 'launched' } : f)) } };
    await writeWhole(where, WAITING_FILE, `${JSON.stringify({ v: WAITING_VERSION, server, login, repos })}\n`);
    return true;
  });
}
