// D229 (item 10, C6): the launch records of the fix loop (sonah-hosted FIXLOOP.md "Shapes"), from the private laptop
// client's launches.mjs (sonah-hosted client/launches.mjs): one file a comment, team/fixes/<comment id>.json
// (team-home.js), mode 0600, written whole under its own lock, holding the review, the change, and each launch of
// Claude Code for that comment, newest last, with the exact prompt sent and the session it went to.
//   `sonah fix` appends one launch to it (fix-command.js), and reads its newest session again on a second fix of the
//   same comment, so a second fix forks that session instead of the one that wrote the change: still one fix.
//   The push run and `sonah share` read this computer's records of a repository for the upload's `answers`, which
//   comments a session was opened to answer (`answersBySession`, upload-sessions.js), so the server can mark a fix
//   `pushed`; the newest LAUNCH_RECORDS_MAX files of the folder are read, so the fix just made is always among them.
// A record holds a teammate's words, in the prompt as it was sent, and it belongs to no one connection: the upload's
// answers are read from it long after the push it answers, so a new connection leaves it as it is (PRIVACY lists it
// under what stays). A file that is there and is not a launch record is never written over: `readLaunch` throws, and
// the person moves it away.
//
// No work at import.
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { strictJson } from '../../slicer/src/strict-json.js';
import { isBranch, isCommentId, isFullSha, isSessionId, isTime } from '../../visual/src/fix-prompt.mjs';
import { FIXES_FOLDER, fixesPath, readOwnText, withFileLock, writeWhole } from './team-home.js';

/** The largest launch record Sonah reads as one: a record holds the exact prompt of every launch of its comment, and
 *  a prompt carries a teammate's words (at most 2,000 characters each, up to THREAD_MAX of them) with the item, so one
 *  runs to tens of kilobytes. 8 MB holds over a hundred launches of one comment; a file larger than this is not a
 *  record Sonah wrote. */
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const RECORD_VERSION = 1;
const RECORD_NAME = /^(c_[0-9a-f]{16})\.json$/;
/** The most files of the folder that `answersBySession` reads, so a folder of years of fixes is still read at every
 *  push. They are the newest of it, by the time each was last written: the fix just made is always among them, and one
 *  that falls out of them is a record this many later fixes were made after, whose comments the uploads of those
 *  pushes have long since answered. The order of the names is no order of age (a comment's id is a hash), so it is not
 *  the bound; the folder holds every repository's records, so the bound is the folder's, not one repository's. */
export const LAUNCH_RECORDS_MAX = 1000;

const plainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.length > 0 && !x.includes('\0');

/** The path of a comment's launch record. */
export const launchPath = (where, id) => join(fixesPath(where), `${id}.json`);
const launchName = (id) => join(FIXES_FOLDER, `${id}.json`);

const isLaunch = (l) => plainObject(l) && isSessionId(l.session) && (l.forkOf === null || isSessionId(l.forkOf))
  && (l.configDir === null || isText(l.configDir)) && isText(l.cwd) && isText(l.prompt) && isTime(l.at);

/** Whether `value` is a launch record, of the comment `id` when one is given. */
export const isLaunchRecord = (value, id = null) => plainObject(value) && value.v === RECORD_VERSION
  && isCommentId(value.comment) && (id === null || value.comment === id) && typeof value.review === 'string'
  && typeof value.repo === 'string' && isBranch(value.branch) && isFullSha(value.base) && isFullSha(value.head)
  && Array.isArray(value.launches) && value.launches.every(isLaunch);

/** The record a file's text holds, or null when it is not one. */
function recordOf(text, id) {
  const parsed = strictJson(text);
  return parsed.json && parsed.strict && isLaunchRecord(parsed.value, id) ? parsed.value : null;
}

/**
 * The launch record of the comment `id`, or null when there is none. One that is there and is not a launch record (it
 * cannot be read as the person's own file of this shape either) throws an error whose code is `fix_record_unreadable`
 * and whose `file` is it: it is never written over.
 */
export async function readLaunch(where, id) {
  const path = launchPath(where, id);
  const read = await readOwnText(path, MAX_RECORD_BYTES);
  if (read.state === 'absent') return null;
  const record = read.state === 'ok' ? recordOf(read.text, id) : null;
  if (record === null)
    throw Object.assign(new Error('fix_record_unreadable'), { code: 'fix_record_unreadable', file: path });
  return record;
}

/**
 * Adds one launch to the record of `comment` (made when there is none, with the review and the change as given) under
 * the record's own lock: the record written. `launch` is `{ session, forkOf, configDir, cwd, prompt, at }`.
 */
export async function appendLaunch(where, { comment, review, repo, branch, base, head }, launch) {
  return withFileLock(where, launchPath(where, comment), async () => {
    const current = await readLaunch(where, comment);
    const next = { v: RECORD_VERSION, comment, review, repo, branch, base, head,
      launches: [...(current?.launches ?? []), launch] };
    if (!isLaunchRecord(next, comment)) throw new Error('the launch is not of its shape');
    await writeWhole(where, launchName(comment), `${JSON.stringify(next)}\n`);
    return next;
  });
}

/** Every launch record of one repository on this computer (`repoKey` as fix-waiting.js `repoKeyOf` writes it), from the
 *  newest LAUNCH_RECORDS_MAX files of the folder; one that is not a launch record is left out, so one file Sonah
 *  cannot read never stops a push's upload. */
export async function launchRecords(where, repoKey) {
  const folder = fixesPath(where);
  let names;
  try { names = await readdir(folder); } catch { return []; }
  const files = [];
  for (const name of names) {
    const id = RECORD_NAME.exec(name)?.[1];
    if (!id) continue;
    let own;
    try { own = await lstat(join(folder, name)); } catch { continue; }
    if (own.isFile()) files.push({ id, name, at: own.mtimeMs });
  }
  // newest first, the name breaking a tie, so a folder that no one writes to is read the same way every time
  files.sort((a, b) => b.at - a.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const out = [];
  for (const { id, name } of files.slice(0, LAUNCH_RECORDS_MAX)) {
    const read = await readOwnText(join(folder, name), MAX_RECORD_BYTES);
    const record = read.state === 'ok' ? recordOf(read.text, id) : null;
    if (record !== null && record.repo.toLowerCase() === repoKey) out.push(record);
  }
  return out;
}

/** Which comments each session was opened to answer, from this computer's launch records of the repository: Map session
 *  id -> Set of comment ids, for the upload's `sessions` (upload-sessions.js `answers`). */
export async function answersBySession(where, repoKey) {
  const by = new Map();
  for (const record of await launchRecords(where, repoKey)) {
    for (const launch of record.launches) {
      if (!by.has(launch.session)) by.set(launch.session, new Set());
      by.get(launch.session).add(record.comment);
    }
  }
  return by;
}
