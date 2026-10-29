// D171 (the owner, 2026-10-28: "Add the update notice (one line when a newer Sonah is out, checked at most once a day,
// never auto-installing)", on by default, with a line in the page's footer for /sonah users): the one network request
// that Sonah makes unasked. At most once a day, a GET of getsonah's dist-tags from npm's public registry (UPDATE_CHECK_URL),
// with node:https, a 2-second limit and no retry. The request carries no session text, path, setting or id: only
// what a GET of that address carries (the host name and fixed headers; no user agent, cookie or token). Its answer
// and time are kept in `update-check.json` in Sonah's folder (`{ checkedAt, latest }`); a file that cannot be read is
// ignored and written again. Of the commands that find that file a day old, one makes the check, by an exclusive
// claim beside it (`claimUpdateCheck`, the D171 day claim). Only a `latest` strictly newer than this Sonah, in semver
// order, gives the notice. It never installs anything.
//
// Off: SONAH_NO_UPDATE_CHECK, CI, or `sonah config update-check off` (settings.js `resolveUpdateCheck`). Only the CLI's
// entry (bin/sonah.js) makes the real check, with the real clock and the real request, and hands it to `review` and
// `doctor` as an input (`updateNotice`), which start it only where the owner placed it (D171, option A, 2026-10-29):
// the review with its first call to the reviewer, doctor once its options are read. A library call or a test makes no
// request unless it passes one in. Silent on every failure: an answer that is late, malformed, or not 200 gives no
// notice, and no command fails for it.
import { randomUUID } from 'node:crypto';
import dns from 'node:dns';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { strictJson } from '../../slicer/src/strict-json.js';
import { resolveUpdateCheck, sonahHome } from './settings.js';

/** npm's public registry: the dist-tags of getsonah (`{ "latest": "…", … }`). */
export const UPDATE_CHECK_URL = 'https://registry.npmjs.org/-/package/getsonah/dist-tags';
/** The cache file's name in Sonah's folder. */
export const UPDATE_CHECK_FILE = 'update-check.json';
/** At most one check a day. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** A check gives up after 2 seconds. */
export const UPDATE_CHECK_TIMEOUT_MS = 2_000;
/** The registry's answer is a few hundred bytes; a longer one is not read. */
const MAX_ANSWER_BYTES = 64 * 1024;
/** The cache holds two short fields; a longer file is not this file. */
const MAX_CACHE_BYTES = 1024;
/** The command the notice gives. */
export const UPDATE_COMMAND = 'npm install -g getsonah@latest';
/** The commands that can check, closed (D171, option A; the owner, 2026-10-29: "a review that reviews, and doctor").
 *  `review` starts the check with its first call to the reviewer: a call of its transport, whether or not that call
 *  then leaves this computer (no API key, no `claude`), never an answer stored on this computer and never a call the
 *  review's own limits refuse. So a dry run, a review that stops before its first call, a run on stored answers alone
 *  and `review --background`'s starter never check. `doctor` starts it once its options are read, so a usage error
 *  never checks. No other command checks, whatever it sends (`sessions --github` asks GitHub and does not check):
 *  `sessions`, `decision`, `slice`, `hook`, `skill`, `feedback`, and `config`, which sets the check's own switch. The
 *  entry also gives none to a command given --help or -h, nor to `review --background`. */
export const UPDATE_NOTICE_COMMANDS = Object.freeze(['review', 'doctor']);

/** D171: the notice's words. The page's footer has its own (render report-words.js REPORT_FOOTER_WORDS.newer). */
export const UPDATE_NOTICE_WORDS = Object.freeze({
  /** On stderr, once, after the command's own output. */
  line: (latest, installed) => `Sonah ${latest} is out, and you have ${installed}. Update with ${UPDATE_COMMAND}.`,
  /** In `sonah doctor`, before its last line; never a reason it needs attention. */
  doctor: (latest, installed) => `Sonah: ${installed}, and ${latest} is out. Update with ${UPDATE_COMMAND}.`,
});
/** The kind of each word table here, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ UPDATE_NOTICE_WORDS: 'notice' });
export const STYLE_FIXTURES = Object.freeze({
  'UPDATE_NOTICE_WORDS.line': [['0.3.0-beta.10', '0.3.0-beta.9']],
  'UPDATE_NOTICE_WORDS.doctor': [['0.3.0-beta.10', '0.3.0-beta.9']],
});

// ---- versions -------------------------------------------------------------------------------------------------------

const NUMERIC = /^(?:0|[1-9]\d*)$/;
const IDENTIFIER = /^(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)$/;
/** A version's parts (semver 2.0.0): `{ core: [major, minor, patch], pre: [identifiers] }` as strings, or null. Build
 *  metadata (`+…`) is read and set aside, as semver orders it. At most 40 characters, the footer's bound. */
export function parseVersion(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 40) return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(text);
  if (!match) return null;
  const core = match.slice(1, 4);
  if (!core.every((part) => NUMERIC.test(part))) return null;
  const pre = match[4] === undefined ? [] : match[4].split('.');
  if (!pre.every((id) => IDENTIFIER.test(id))) return null;
  if (match[5] !== undefined && !match[5].split('.').every((id) => /^[0-9A-Za-z-]+$/.test(id))) return null;
  return { core, pre };
}
/** Two numeric identifiers, by their value, whatever their length. */
const compareNumbers = (a, b) => (a.length !== b.length ? Math.sign(a.length - b.length) : a < b ? -1 : a > b ? 1 : 0);
/** Semver order: -1, 0 or 1, or null when either is not a version. The core numbers as numbers; a version with
 *  prerelease identifiers before the same core without; the identifiers field by field, a numeric one as a number and
 *  before any other, the others in ASCII order; a shorter list first when the longer one starts with it. So
 *  0.3.0-beta.9 < 0.3.0-beta.10 < 0.3.0. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (x === null || y === null) return null;
  for (let i = 0; i < 3; i++) { const c = compareNumbers(x.core[i], y.core[i]); if (c) return c; }
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    const pn = NUMERIC.test(p), qn = NUMERIC.test(q);
    const c = pn && qn ? compareNumbers(p, q) : pn ? -1 : qn ? 1 : p < q ? -1 : p > q ? 1 : 0;
    if (c) return c;
  }
  return Math.sign(x.pre.length - y.pre.length);
}
/** Whether `latest` is strictly newer than `installed`; false when either is not a version. */
export const isNewer = (latest, installed) => compareVersions(latest, installed) === 1;

// ---- the registry's answer ------------------------------------------------------------------------------------------

/** The `latest` dist-tag an answer's text gives, or null: strict JSON, an object, `latest` a version. */
export function latestOf(text) {
  const parsed = strictJson(String(text));
  if (!parsed.json || !parsed.strict || parsed.value === null || typeof parsed.value !== 'object'
    || Array.isArray(parsed.value)) return null;
  return parseVersion(parsed.value.latest) === null ? null : parsed.value.latest;
}

/** How many host lookups of the check's own request have not answered yet (`heldLookup`). */
let lookupsPending = 0;
/** D171 fix round: whether a host lookup of the check's request has still not answered. Aborting the request cannot
 *  stop one: the system's resolver runs it on a thread of its own, and until it answers it keeps the process alive, so
 *  a resolver that hangs would hold a command past the 2-second limit until the resolver itself gives up. The entry
 *  reads this once the command and the line are done, and then ends the process itself (bin/sonah.js). */
export const lookupPending = () => lookupsPending > 0;
/** The system's lookup (node:dns `lookup`, read when called), counted in `lookupsPending` until it answers. */
function heldLookup(hostname, options, callback) {
  lookupsPending += 1;
  let answered = false;
  const done = (...answer) => {
    if (!answered) { answered = true; lookupsPending -= 1; }
    callback(...answer);
  };
  try { dns.lookup(hostname, options, done); } catch (error) { done(error); }
}

/** The real request: a GET of `url` with node:https, its body as text when the answer is 200 and at most `maxBytes`;
 *  rejects otherwise, or when `signal` aborts. No agent is kept (`agent: false`), so no socket outlives it. `get` and
 *  `lookup` are node:https's and `heldLookup` unless a test gives its own (node:http's, against a local server). */
export async function registryFetch(url, { signal, maxBytes = MAX_ANSWER_BYTES, get, lookup = heldLookup } = {}) {
  const send = get ?? (await import('node:https')).get;
  return new Promise((resolve, reject) => {
    const request = send(url, { agent: false, signal, lookup, headers: { accept: 'application/json' } }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('status')); return; }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(); reject(new Error('too_large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

// ---- the cache ------------------------------------------------------------------------------------------------------

/** The cache file's path. */
export const updateCachePath = (where = {}) => join(sonahHome(where), UPDATE_CHECK_FILE);
/** The claim on the check that follows `cache` (null: none, or one that cannot be read), beside the cache and
 *  named after that cache's time: `.update-check.json.<checkedAt in milliseconds, or none>.claim`. Every command that
 *  read the same cache claims the same name, and the next day's check, which follows another cache, claims another. */
export const updateClaimPath = (cache, where = {}) => join(sonahHome(where),
  `.${UPDATE_CHECK_FILE}.${cache === null ? 'none' : cache.checkedAt}.claim`);
/** A cache checked less than a day before `at` by the clock, and not after it. Every `at` it is judged by is read after
 *  the file was read, so a check kept before that read is never after `at` on this computer's clock. */
const isFresh = (cache, at) => cache !== null && at - cache.checkedAt >= 0
  && at - cache.checkedAt < UPDATE_CHECK_INTERVAL_MS;
/** A time as `toISOString` writes it, or null. */
const isoTime = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value ? Date.parse(value) : null);

/** The cache: `{ checkedAt, latest }` (`checkedAt` in milliseconds, `latest` a version or null), or null when there is
 *  none or it is not exactly this shape: a regular file (a link is never followed), at most 1 KB, strict JSON. */
export async function readUpdateCache(where = {}) {
  return (await readCacheFile(updateCachePath(where))) ?? null;
}
/** The cache file at `path` (the cache or a claim), as readUpdateCache reads it, or undefined when nothing is there. */
async function readCacheFile(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_CACHE_BYTES) return null;
    const parsed = strictJson(await file.readFile('utf8'));
    if (!parsed.json || !parsed.strict || parsed.value === null || typeof parsed.value !== 'object'
      || Array.isArray(parsed.value)) return null;
    const { checkedAt, latest, ...rest } = parsed.value;
    const at = isoTime(checkedAt);
    if (at === null || Object.keys(rest).length || (latest !== null && parseVersion(latest) === null)) return null;
    return { checkedAt: at, latest };
  } catch (error) { return error?.code === 'ENOENT' ? undefined : null; }
  finally { await file?.close().catch(() => {}); }
}
/** A temporary file's path in `dir`, unique, named after the time `at` of the check that makes it:
 *  `.update-check.json.<at in milliseconds>.<random id>.tmp`. */
const temporaryPath = (dir, at) => join(dir, `.${UPDATE_CHECK_FILE}.${at}.${randomUUID()}.tmp`);
/** A new file at `path` (never one that is there, never through a link), 0600, holding the cache's exact bytes. */
async function writeNewCacheFile(path, { checkedAt, latest }) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600);
  try { await file.writeFile(`${JSON.stringify({ checkedAt: new Date(checkedAt).toISOString(), latest })}\n`, 'utf8'); }
  finally { await file.close(); }
}

/** Writes the cache, owner-only (0600 in a 0700 folder), the whole file at once (a new file beside it, renamed over
 *  it). Whether it was written: a folder that cannot be written keeps no cache, and then no request is made
 *  (`checkForUpdate`). */
export async function writeUpdateCache({ checkedAt, latest }, where = {}) {
  const dir = sonahHome(where);
  const temporary = temporaryPath(dir, checkedAt);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeNewCacheFile(temporary, { checkedAt, latest });
    await rename(temporary, join(dir, UPDATE_CHECK_FILE));
    return true;
  } catch {
    await rm(temporary, { force: true }).catch(() => {});
    return false;
  }
}

/**
 * The claim on the check that follows `cache` (what this command read, null for none), made at `at` (the clock read
 * after `cache` was). Of any number of commands that read the same cache, one makes that check. The claim is the
 * day's cache itself (`at`, and the answer `cache` held), written whole to a new file and hard-linked to
 * `updateClaimPath(cache)`: `link` fails when anything is there, so one command at a time lands it, and what it lands
 * is complete. That command reads the cache again and stops if it changed (it read the cache before another command's
 * check was kept, and landed once that check's claim had gone), then renames its claim over the cache, so the day's
 * check is kept before its request. Gives `'won'`; `'unkept'` when Sonah's folder cannot keep the claim, a folder that
 * cannot hard-link among them (FAT, exFAT, many SMB shares: `link` is refused, and no request is made there, ever);
 * `{ standing }`, the cache or claim that holds the day's check instead (another command's; its answer is used when it
 * is fresh); or `{ moved: true }`. A claim found is judged by `now()` read after it was read, so on one clock it is
 * never from the future, and the claim of a command that has not stopped for a day is fresh. One that is not fresh (a
 * day old, or from the future: the clock set back, or another computer's) or cannot be read was left by a command that
 * stopped after landing it, for a day or more: it holds the check that command made, so it is renamed over the cache,
 * and the check after it is claimed by its own name. Only a regular file is renamed; anything else at the name (a
 * folder, a link) stays, and no request is made while it is there. The rename takes whatever is at the name when it
 * runs: when another command that read the same cache has landed a claim there since the one read, that claim is
 * renamed instead. That can lose that day's answer (the winner's last write is then skipped) or leave that day with no
 * request. The stopped command, when it resumes, finds its claim gone and makes no request, unless another claim is at
 * that name again: then it renames that one and makes a second request, the late request of a command stopped for a
 * day. No claim is waited on. A claim or temporary file that a stopped command leaves after the cache it follows was
 * replaced is removed by the next command that makes a check (`removeLeftFiles`).
 */
export async function claimUpdateCheck(cache, at, where = {}, now = Date.now) {
  const dir = sonahHome(where), path = updateCachePath(where), claim = updateClaimPath(cache, where);
  const temporary = temporaryPath(dir, at);
  let landed;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeNewCacheFile(temporary, { checkedAt: at, latest: cache === null ? null : cache.latest });
    landed = await link(temporary, claim).then(() => true, (error) => {
      if (error?.code === 'EEXIST') return false;
      throw error;
    });
  } catch { return 'unkept'; }
  finally { await rm(temporary, { force: true }).catch(() => {}); }
  if (!landed) {
    const standing = await readCacheFile(claim);
    if (standing === undefined) return { standing: await readUpdateCache(where) };
    if (isFresh(standing, now())) return { standing };
    try {
      if (!(await lstat(claim)).isFile()) return { standing: null };
      await rename(claim, path);
      return { moved: true };
    } catch { return { standing: null }; }
  }
  const again = await readUpdateCache(where);
  if ((again === null ? 'none' : again.checkedAt) !== (cache === null ? 'none' : cache.checkedAt)) {
    await rm(claim, { force: true }).catch(() => {});
    return { standing: again };
  }
  try { await rename(claim, path); return 'won'; }
  catch (error) {
    if (error?.code === 'ENOENT') return { standing: await readUpdateCache(where) };
    await rm(claim, { force: true }).catch(() => {});
    return 'unkept';
  }
}

/** After a check is kept: the claims and temporary files that commands which stopped left beside the cache. A claim
 *  named after any cache but the one there now follows a cache that has been replaced, so it can make no check: a
 *  command that still holds one stops when it reads the cache again or finds its claim gone. A temporary file named
 *  after a time a day or more before `at` belongs to no command still running. Nothing else is touched (a folder at
 *  such a name stays), and every failure is ignored. */
async function removeLeftFiles(at, where) {
  try {
    const kept = await readUpdateCache(where);
    if (kept === null) return;
    const dir = sonahHome(where), prefix = `.${UPDATE_CHECK_FILE}.`;
    for (const name of await readdir(dir)) {
      if (!name.startsWith(prefix)) continue;
      const claim = /^(none|-?\d+)\.claim$/.exec(name.slice(prefix.length));
      const temporary = /^(-?\d+)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/
        .exec(name.slice(prefix.length));
      if ((claim && claim[1] !== String(kept.checkedAt))
        || (temporary && at - Number(temporary[1]) >= UPDATE_CHECK_INTERVAL_MS))
        await rm(join(dir, name), { force: true }).catch(() => {});
    }
  } catch { /* never a failure */ }
}

// ---- the check ------------------------------------------------------------------------------------------------------

/**
 * One check: `{ installed, latest }` when a version strictly newer than `installed` is known, else null. Never throws.
 * Off (resolveUpdateCheck) or with an `installed` that is not a version: null, with nothing read or sent. A cache
 * checked less than a day ago (by `now()`, milliseconds, read after the cache and after each file the check judges)
 * gives its answer, with no request. Otherwise the command
 * claims the day's check (`claimUpdateCheck`): of the commands that read the same cache, one wins, keeps the day's
 * check in the cache before its request (with the answer the cache held), and makes one request, by
 * `fetch(url, { signal, maxBytes })`, which gives up after `timeoutMs` (the signal aborts it, and its answer is not
 * awaited past that); the cache is then written with what it found (null on any failure, so a failed check also waits
 * a day), unless another check has been kept since, and what stopped commands left beside it is removed. The others
 * ask nothing and use the answer that holds the day's check, when it is fresh. A folder that cannot keep the claim
 * (one that cannot be written, or cannot hard-link) makes no request at all. `checked` reports what happened (`off`,
 * `cached`, `claimed`, `unkept`, `fetched`, `failed`), for the tests.
 */
export async function checkForUpdate({ installed, env = process.env, home, now = Date.now, fetch = registryFetch,
  timeoutMs = UPDATE_CHECK_TIMEOUT_MS, checked = () => {} } = {}) {
  try {
    const where = { env, ...(home === undefined ? {} : { home }) };
    if (parseVersion(installed) === null || !(await resolveUpdateCheck(where)).on) { checked('off'); return null; }
    // The clock after the cache: a check another command kept before this read is never from the future.
    let cache = await readUpdateCache(where);
    let at = now();
    let latest = null;
    // Two rounds at most: the second only after a claim left by a stopped command was renamed over the cache.
    for (let round = 0; round < 2; round++) {
      if (isFresh(cache, at)) { latest = cache.latest; checked('cached'); break; }
      const claim = await claimUpdateCheck(cache, at, where, now);
      if (claim === 'unkept') { checked('unkept'); return null; }
      if (claim === 'won') {
        latest = await withinLimit(fetch, timeoutMs);
        checked(latest === null ? 'failed' : 'fetched');
        if ((await readUpdateCache(where))?.checkedAt === at) await writeUpdateCache({ checkedAt: at, latest }, where);
        await removeLeftFiles(at, where);
        break;
      }
      if (claim.moved && round === 0) { cache = await readUpdateCache(where); at = now(); continue; }
      checked('claimed');
      latest = claim.standing !== undefined && isFresh(claim.standing, now()) ? claim.standing.latest : null;
      break;
    }
    return latest !== null && isNewer(latest, installed) ? { installed, latest } : null;
  } catch { return null; }
}

/** The registry's `latest`, or null when the request fails, its answer is malformed, or it takes longer than
 *  `timeoutMs`. The timer is cleared once the request ends; until then it holds the process at most `timeoutMs`, so a
 *  command that ends sooner waits for the answer that long at most. */
async function withinLimit(fetch, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
  });
  const answer = Promise.resolve().then(() => fetch(UPDATE_CHECK_URL, { signal: controller.signal,
    maxBytes: MAX_ANSWER_BYTES })).then(latestOf, () => null);
  try { return await Promise.race([answer, late]); }
  finally { clearTimeout(timer); }
}

/** Whether the entry hands the command a check for `argv` (UPDATE_NOTICE_COMMANDS; no --help or -h; not `review
 *  --background`). */
export function updateNoticeApplies(argv) {
  const [cmd, ...rest] = argv;
  if (!UPDATE_NOTICE_COMMANDS.includes(cmd) || rest.includes('--help') || rest.includes('-h')) return false;
  return !(cmd === 'review' && rest.includes('--background'));
}

/** The CLI's check, made at most once and only when asked (D171, option A): a function that starts checkForUpdate on
 *  its first call and gives the same promise of its answer each time; `asked()` says whether it was called. The entry
 *  hands it to the command, and writes the line after the command only when the command asked it. */
export function updateCheckWhenAsked(options) {
  let answer = null;
  const notice = () => (answer ??= checkForUpdate(options));
  notice.asked = () => answer !== null;
  return notice;
}

/** D171 fix round: the entry's end when `lookupPending()`. Once stdout and stderr have handed on what they hold (a pipe
 *  is written asynchronously on macOS), the process ends with the command's exit code, so a lookup that the 2-second
 *  limit gave up on does not hold it. */
export async function endOnceWritten({ streams = [process.stdout, process.stderr], exit = (code) => process.exit(code) }
  = {}) {
  await Promise.all(streams.map((stream) => new Promise((resolve) => {
    try { stream.write('', () => resolve()); } catch { resolve(); }
  })));
  exit(process.exitCode);
}

/** After the command's own output: the notice, once, on `stderr`, when a newer version is known. Never throws. */
export async function writeUpdateNotice(notice, stderr = process.stderr) {
  try {
    const newer = await notice();
    if (newer) stderr.write(`${UPDATE_NOTICE_WORDS.line(newer.latest, newer.installed)}\n`);
  } catch { /* the notice is never a failure */ }
}
