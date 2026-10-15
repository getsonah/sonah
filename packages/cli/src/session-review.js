// M33 (C-07 "Window checkpoints and resumable session review"). A session-only review that can be
// stopped and continued without losing answered work. It adds no second reuse rule: every model
// answer is a D60 answer (answer-cache.js), stored per call the moment it returns and reused only
// for the exact request bytes, backend, model and transport arguments that produced it, by
// occurrence. What this adds is count-only bookkeeping around that:
//
//   windows/<windowKey>.json   one `sonah.window-checkpoint/1` record per FINISHED window: its state,
//                              closed reasons and the { key, occurrence } references of its stored
//                              answers, in dispatch order. No text, no time, no attempt, no pid, so a
//                              replayed window rewrites the same bytes. A record supplies nothing to
//                              any report: every stored answer is grounded again.
//   progress.json              `sonah.session-review-progress/1`: integers and closed codes only. M33 K: a
//                              runner that reports rate limits (`rateLimitTally`) adds `rateLimit`, the
//                              latest one seen — closed codes and numbers only, or null. M44: with
//                              `windows`; a progress written before it has none and still reads.
//   report.private.json        the finished review's report (private: it quotes the recording).
//
// Every file is owner-only (0600 in 0700 directories), written to a private temp file, synced, and
// renamed into place. A continuation is simply the same review run again on the same store and
// answer cache: every stored answer is replayed — including those of windows that finished
// incomplete, so stopping and restarting can never resample a window — and F226 applies only when a
// review completes. This runner has no `fresh` option (documented limitation).
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../../evidence/contracts/canonical.js';
import { CLI_SAFE_ERROR_CODES, RUN_FAILURE_CODES } from '../../evidence/src/ledger.js';
import { NARRATIVE_SHORTFALL, TRANSPORT_SHORTFALL, WINDOW_FAILURE_CODES,
  WINDOW_INCOMPLETE_REASONS, WINDOW_STATES, planWindowRequests, runProfile, runReview,
  windowIncompleteReasons } from '../../evidence/src/run-review.js';
import { REVIEW_SPEED_PROFILES, isStandardProfile, requestBoundOf, reviewSpeedProfile } from '../../evidence/src/review-profiles.js';
import { strictJson } from '../../slicer/src/strict-json.js';
import { runCodePass, withCodePass } from '../../evidence/src/code-pass.js';
import { memoizeJudge } from './answer-cache.js';
import { RATE_LIMIT_STATUSES, RATE_LIMIT_TYPES, RATE_LIMIT_WINDOWS, REVIEW_CANCELLED,
  withTransportRetry } from './review-judge.js';

export const WINDOW_CHECKPOINT_SCHEMA = 'sonah.window-checkpoint/1';
export const SESSION_REVIEW_PROGRESS_SCHEMA = 'sonah.session-review-progress/1';
const SESSION_ONLY = runProfile('session-only').reviewScope;
/** Where a non-regular entry found at a record's name is moved, inside the records' directory. */
const DISCARDED = '.discarded';

/** Why a window record was not trusted. A discard is counted, never an error, never a skipped window. */
export const CHECKPOINT_DISCARD_REASONS = Object.freeze(['unreadable', 'not_regular_file', 'owner_unsafe',
  'schema_invalid', 'identity_mismatch', 'state_inconsistent']);
const [UNREADABLE, NOT_REGULAR_FILE, OWNER_UNSAFE, SCHEMA_INVALID, IDENTITY_MISMATCH, STATE_INCONSISTENT] =
  CHECKPOINT_DISCARD_REASONS;

/** Where one session review stands. `running` without a live lock holder reads as `interrupted`. */
export const SESSION_REVIEW_STATES = Object.freeze(['running', 'finished', 'interrupted', 'failed']);
const [RUNNING, FINISHED, INTERRUPTED, FAILED] = SESSION_REVIEW_STATES;

/** Whether this attempt's live answers came from the requested model, from closed attempt metadata. */
export const SERVED_MODEL_STATES = Object.freeze(['attested', 'unattested', 'mixed', 'unknown']);
const [ATTESTED, UNATTESTED, MIXED, UNKNOWN] = SERVED_MODEL_STATES;

/** A progress file's failure: a run code, or `review_failed` for anything the run did not classify. */
export const SESSION_REVIEW_FAILURES = Object.freeze([...RUN_FAILURE_CODES, 'review_failed']);
const [, REVIEW_INTERRUPTED, , REVIEW_FAILED] = SESSION_REVIEW_FAILURES;

const failure = (code) => Object.assign(new Error(code), { code });
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const HEX64 = /^[a-f0-9]{64}$/;
const isHex64 = (value) => typeof value === 'string' && HEX64.test(value);
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) => plainObject(value) && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
/** A tally as `{ token: n }` for its nonzero members, in the vocabulary's order. */
const ordered = (vocabulary, tally) => Object.fromEntries(vocabulary.filter((token) => (tally.get(token) ?? 0) > 0)
  .map((token) => [token, tally.get(token)]));
const bump = (tally, token) => tally.set(token, (tally.get(token) ?? 0) + 1);

/** The SHA-256 (hex) of the canonical JSON of the frozen session-only run profile. M33 J: under the
 *  named speed profile — nothing, or `standard`, is the digest it always was; any other profile's
 *  differs, so the two never share a window checkpoint key. The codex-cli backend also binds its smaller windows;
 *  default and Claude profile digests remain unchanged. */
export function sessionProfileDigest(speedProfile = undefined, backend = undefined) {
  return sha256(canonicalJson(runProfile(SESSION_ONLY, speedProfile, backend)));
}

/** C-07: SHA-256 (hex) of the canonical JSON of the narrative request's D60 answer key, the run
 *  profile's digest and the 1-based window number. */
export function windowKeyOf({ answerKey, profile, window }) {
  if (!isHex64(answerKey) || !isHex64(profile) || !Number.isSafeInteger(window) || window < 1)
    throw new TypeError('A window key binds an answer key, a profile digest and a window number');
  return sha256(canonicalJson({ answerKey, profile, window }));
}

/**
 * Whether this attempt's live answers are attested as the requested model's, from a tally of the
 * attestation of every call that returned an answer: all attested, all unattested, both (`mixed`),
 * or `unknown` — no answered call, or any whose attestation is not known.
 */
export function servedModelState(tally) {
  const n = (token) => (isCount(tally?.[token]) ? tally[token] : 0);
  const attested = n(ATTESTED), unattested = n(UNATTESTED), unknown = n(UNKNOWN);
  if (unknown > 0 || attested + unattested === 0) return UNKNOWN;
  if (unattested === 0) return ATTESTED;
  return attested === 0 ? UNATTESTED : MIXED;
}

// ---- owner-only files ------------------------------------------------------------------------------
const currentUid = () => (typeof process.getuid === 'function' ? process.getuid() : null);
const ownedPrivately = (info, uid) => Number.isSafeInteger(uid) && info.uid === uid && (info.mode & 0o077) === 0;

/** Create or tighten an owner-only (0700) directory this user owns; otherwise refuse with `owner_unsafe`.
 *  Only a directory is tightened: a link at the name is refused without changing what it names. */
async function privateDirectory(path) {
  let info;
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
    info = await lstat(path);
    if (info.isDirectory()) { await chmod(path, 0o700); info = await lstat(path); }
  } catch { throw failure(OWNER_UNSAFE); }
  if (!info.isDirectory() || !ownedPrivately(info, currentUid())) throw failure(OWNER_UNSAFE);
}

/** Temp file (`wx`, 0600), write, file sync, rename, then a best-effort directory sync. */
async function writePrivate(directory, name, text) {
  const temp = join(directory, `.${randomUUID()}.tmp`);
  let handle = null;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(text);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, join(directory, name));
  } finally {
    await handle?.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
  }
  let folder = null;
  try { folder = await open(directory, 'r'); await folder.sync(); } catch { /* not every platform syncs a directory */ }
  finally { await folder?.close().catch(() => {}); }
}

/**
 * The text of a regular file this user owns with no group or other permission bit, read through a
 * handle that cannot follow a link and that is the file `lstat` saw — or `{ absent }`, or the one
 * closed reason it was not read.
 */
async function readPrivate(path) {
  let seen;
  try { seen = await lstat(path); }
  catch (error) { return error?.code === 'ENOENT' ? { absent: true } : { discard: UNREADABLE }; }
  if (!seen.isFile()) return { discard: NOT_REGULAR_FILE };
  const uid = currentUid();
  if (!ownedPrivately(seen, uid)) return { discard: OWNER_UNSAFE };
  let handle = null;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== seen.ino || info.dev !== seen.dev) return { discard: NOT_REGULAR_FILE };
    if (!ownedPrivately(info, uid)) return { discard: OWNER_UNSAFE };
    return { text: await handle.readFile('utf8') };
  } catch (error) {
    return { discard: error?.code === 'ELOOP' ? NOT_REGULAR_FILE : UNREADABLE };
  } finally { await handle?.close().catch(() => {}); }
}

/**
 * C-07: a non-regular entry at a record's name (a directory, a link, anything but a regular file) is
 * moved aside inside the store — never deleted, recursively or otherwise — so the window's new record
 * can be written: to `<area>/<name>.<n>` beside the records, `n` the first free number, in an
 * owner-only (0700) directory. The store is locked, so no other run races for the name. An entry
 * that is already gone needs no move.
 */
async function moveAside(directory, name) {
  const aside = await discardArea(directory);
  for (let n = 0; ; n++) {
    const target = join(aside, `${name}.${n}`);
    try { await lstat(target); continue; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    try { await rename(join(directory, name), target); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    return;
  }
}

/**
 * M33 G1: the discard area is `.discarded`, or — when that name holds anything but a directory this
 * user owns (a file, a link, another user's directory) — the first of `.discarded-1`, `.discarded-2`, …
 * that does not, made (or tightened to) 0700. Whatever is already at a skipped name is never followed,
 * changed or deleted, so an entry planted there cannot fail every later run; a directory holds finitely
 * many names, so a free one is always reached. The choice depends only on what is on disk.
 */
async function discardArea(directory) {
  for (let n = 0; ; n++) {
    const area = join(directory, n === 0 ? DISCARDED : `${DISCARDED}-${n}`);
    let info = null;
    try { info = await lstat(area); }
    catch (error) { if (error?.code !== 'ENOENT') throw failure(OWNER_UNSAFE); }
    if (info && !(info.isDirectory() && info.uid === currentUid())) continue;
    await privateDirectory(area);
    return area;
  }
}

// ---- the window record ------------------------------------------------------------------------------
const RECORD_FIELDS = Object.freeze(['schema', 'windowKey', 'window', 'state', 'reasons', 'failure', 'transport', 'answers']);
const REFERENCE_FIELDS = Object.freeze(['key', 'occurrence']);
const [WINDOW_COMPLETE, , WINDOW_FAILED] = WINDOW_STATES;
// The reasons only a failed call can give, and the ones each failure can give — derived from
// `windowIncompleteReasons` itself, so a record is checked by the rule that produced it.
const failureReasons = (code) => [undefined, ...NARRATIVE_SHORTFALL]
  .map((shape) => windowIncompleteReasons({ failure: code, shortfall: { narrative: shape } }));
const NARRATIVE_REASONS = new Set(WINDOW_FAILURE_CODES.flatMap((code) => failureReasons(code).flat()));

function recordShapeValid(record) {
  if (!exactKeys(record, RECORD_FIELDS) || record.schema !== WINDOW_CHECKPOINT_SCHEMA || !isHex64(record.windowKey)
      || !Number.isSafeInteger(record.window) || record.window < 1 || !WINDOW_STATES.includes(record.state)
      || !(record.failure === null || WINDOW_FAILURE_CODES.includes(record.failure))
      || !(record.transport === null || TRANSPORT_SHORTFALL.includes(record.transport))
      || !Array.isArray(record.reasons) || !Array.isArray(record.answers)) return false;
  const reasons = WINDOW_INCOMPLETE_REASONS.filter((reason) => record.reasons.includes(reason));
  if (record.reasons.length !== reasons.length || reasons.some((reason, at) => record.reasons[at] !== reason)) return false;
  const seen = new Set();
  for (const ref of record.answers) {
    if (!exactKeys(ref, REFERENCE_FIELDS) || !isHex64(ref.key) || !isCount(ref.occurrence)) return false;
    const id = `${ref.key}.${ref.occurrence}`;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** `failed` has a failure and exactly the reason that failure gives; the others have neither a
 *  failure nor a transport class; `complete` has no reason; `incomplete` has one, never a call's. */
function recordStateConsistent(record) {
  if (record.state === WINDOW_FAILED)
    return record.failure !== null && failureReasons(record.failure)
      .some((reasons) => reasons.length === record.reasons.length && reasons.every((r, at) => record.reasons[at] === r));
  if (record.failure !== null || record.transport !== null) return false;
  if (record.state === WINDOW_COMPLETE) return record.reasons.length === 0;
  return record.reasons.length > 0 && record.reasons.every((reason) => !NARRATIVE_REASONS.has(reason));
}

// ---- progress -----------------------------------------------------------------------------------------
const PROGRESS_FIELDS = Object.freeze(['schema', 'state', 'failure', 'attempt', 'windows', 'byReason', 'calls',
  'checkpoint', 'servedModel']);
const WINDOW_COUNT_FIELDS = Object.freeze(['total', 'finished', 'complete', 'incomplete', 'failed', 'replayed', 'pending']);
const CALL_FIELDS = Object.freeze(['live', 'reused']);
const CHECKPOINT_FIELDS = Object.freeze(['recordsRead', 'discarded', 'stateChanged']);
const countsOf = (value, vocabulary) => plainObject(value)
  && Object.entries(value).every(([token, n]) => vocabulary.includes(token) && isCount(n) && n > 0);

/** M33 K: the rate-limit fields a progress may carry — each a closed code, a number, or null. M44: and
 *  `windows`, null or each RATE_LIMIT_WINDOWS window's utilization; a progress written before it lacks the field. */
const RATE_LIMIT_FIELDS = Object.freeze(['status', 'rateLimitType', 'utilization', 'resetsAt', 'windows']);
const PRE_WINDOWS_FIELDS = Object.freeze(RATE_LIMIT_FIELDS.filter((field) => field !== 'windows'));
const utilizationValid = (n) => Number.isFinite(n) && n >= 0;
const windowsValid = (value) => value == null || (plainObject(value) && Object.keys(value).length > 0
  && Object.entries(value).every(([window, n]) => RATE_LIMIT_WINDOWS.includes(window) && utilizationValid(n)));
const rateLimitValid = (value) => value === null
  || ((exactKeys(value, RATE_LIMIT_FIELDS) || exactKeys(value, PRE_WINDOWS_FIELDS))
  && (value.status === null || RATE_LIMIT_STATUSES.includes(value.status))
  && (value.rateLimitType === null || RATE_LIMIT_TYPES.includes(value.rateLimitType))
  && (value.utilization === null || utilizationValid(value.utilization))
  && (value.resetsAt === null || isCount(value.resetsAt))
  && windowsValid(value.windows));

function progressValid(progress) {
  // M33 K: with or without the optional `rateLimit`, and never anything else.
  const fields = plainObject(progress) && Object.hasOwn(progress, 'rateLimit') ? [...PROGRESS_FIELDS, 'rateLimit'] : PROGRESS_FIELDS;
  return exactKeys(progress, fields) && (fields === PROGRESS_FIELDS || rateLimitValid(progress.rateLimit))
    && progress.schema === SESSION_REVIEW_PROGRESS_SCHEMA
    && SESSION_REVIEW_STATES.includes(progress.state)
    && (progress.failure === null || SESSION_REVIEW_FAILURES.includes(progress.failure))
    && Number.isSafeInteger(progress.attempt) && progress.attempt >= 1
    && exactKeys(progress.windows, WINDOW_COUNT_FIELDS) && Object.values(progress.windows).every(isCount)
    && countsOf(progress.byReason, WINDOW_INCOMPLETE_REASONS)
    && exactKeys(progress.calls, CALL_FIELDS) && Object.values(progress.calls).every(isCount)
    && exactKeys(progress.checkpoint, CHECKPOINT_FIELDS) && isCount(progress.checkpoint.recordsRead)
    && isCount(progress.checkpoint.stateChanged) && countsOf(progress.checkpoint.discarded, CHECKPOINT_DISCARD_REASONS)
    && SERVED_MODEL_STATES.includes(progress.servedModel);
}

async function readProgressFile(directory) {
  const read = await readPrivate(join(directory, 'progress.json'));
  if (typeof read.text !== 'string') return null;
  const parsed = strictJson(read.text);
  return parsed.strict && progressValid(parsed.value) ? parsed.value : null;
}

/** Is the lock's holder a running process? EPERM means it exists and is someone else's. */
async function lockHolderAlive(directory) {
  let pid;
  try { pid = JSON.parse(await readFile(join(directory, 'active.lock'), 'utf8'))?.pid; } catch { return false; }
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

const rateLimitOrNull = (value) => (value != null && rateLimitValid(value)
  ? Object.fromEntries(RATE_LIMIT_FIELDS.map((field) => [field, value[field] ?? null])) : null);

/**
 * A store's progress, validated, or null. A `running` file whose lock has no live holder — the
 * process was killed, and SIGKILL writes nothing — reads as `interrupted`.
 */
export async function readSessionReviewProgress(directory) {
  const progress = await readProgressFile(directory);
  if (progress?.state !== RUNNING || await lockHolderAlive(directory)) return progress;
  return { ...progress, state: INTERRUPTED, failure: REVIEW_INTERRUPTED };
}

// ---- the store ------------------------------------------------------------------------------------------
/**
 * One session review's private directory. `lock()` takes the same single-file exclusive lock a PR
 * review's store takes (createReviewStore, at the end of this file): a second run on the same store is refused
 * with `review_in_progress`; a dead holder's lock is reclaimed.
 */
export function createSessionReviewStore(directory) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('A session review store needs a directory');
  const windows = join(directory, 'windows');
  const locks = createReviewStore(directory);
  const prepare = async () => { await privateDirectory(directory); await privateDirectory(windows); };
  return {
    directory,
    prepare,
    async lock() {
      await prepare();
      try { return await locks.lock(); }
      catch (error) {
        // The refusal's code only: never the lock's path.
        if (CLI_SAFE_ERROR_CODES.includes(error?.code)) throw failure(error.code);
        throw error;
      }
    },
    readProgress: () => readProgressFile(directory),
    writeProgress: (progress) => writePrivate(directory, 'progress.json', JSON.stringify(progress)),
    /** `{ present, record }` for a trusted record, `{ present, discard }` for one that is not, `{ present: false }`. */
    async readWindow({ windowKey, window }) {
      const name = `${windowKey}.json`;
      const read = await readPrivate(join(windows, name));
      if (read.absent) return { present: false };
      if (read.discard) {
        // A non-regular entry would stop the new record's rename: it is moved aside, never deleted.
        if (read.discard === NOT_REGULAR_FILE) await moveAside(windows, name);
        return { present: true, discard: read.discard };
      }
      const parsed = strictJson(read.text);
      if (!parsed.json) return { present: true, discard: UNREADABLE };
      if (!parsed.strict || !recordShapeValid(parsed.value)) return { present: true, discard: SCHEMA_INVALID };
      if (parsed.value.windowKey !== windowKey || parsed.value.window !== window)
        return { present: true, discard: IDENTITY_MISMATCH };
      if (!recordStateConsistent(parsed.value)) return { present: true, discard: STATE_INCONSISTENT };
      return { present: true, record: parsed.value };
    },
    writeWindow: (record) => writePrivate(windows, `${record.windowKey}.json`, JSON.stringify(record)),
    saveReport: (report) => writePrivate(directory, 'report.private.json', JSON.stringify(report)),
  };
}

// ---- the runner ------------------------------------------------------------------------------------------
/**
 * Review one session, session-only, resumably. `judge` is the transport; the answer cache is
 * OUTSIDE `boundedJudge`, so a stored answer takes no limiter slot and starts nothing, and after
 * `signal` aborts no physical attempt starts.
 *
 * `backend` and `model` name who answers; the answers, and so the window keys, are bound to them
 * (and to the transport's arguments) through `answerCache.keyOf`. `servedModelTally` returns the
 * caller's closed count of answered calls by attestation. Resolves `{ report, progress }`; rejects
 * with the run's closed code (`review_interrupted`, `checkpoint_failed`,
 * `review_identity_ambiguous`), with no report, no F226 forget and no prune.
 *
 * `speedProfile` (M33 J): the review's speed profile by name; nothing is standard, exactly as before.
 * It is planned and run under that profile, its window keys bind that profile's digest, and its calls
 * pass a limiter of that profile's `maxCallsInFlight` at its own byte ceiling (`boundedJudge`).
 * `concurrency` defaults to the profile's `windowConcurrency`.
 * The existing `backend` selects the window settings in planning, execution, reports and checkpoint identity.
 *
 * `rateLimitTally` (M33 K, optional): returns the latest rate-limit fields the caller's transport reported
 * (`{ status, rateLimitType, utilization, resetsAt, windows }`, closed codes and numbers only: review-judge.js
 * rateLimitRecordOf) or null; each progress then carries it as `rateLimit`. Without it, progress is exactly as before.
 */
export async function reviewSession({ session, judge, answerCache, store, backend, model, signal = null,
  onProgress = () => {}, onWindowRecord = () => {}, servedModelTally = () => null, concurrency = undefined,
  speedProfile = undefined, rateLimitTally = null }) {
  if (typeof backend !== 'string' || !backend || typeof model !== 'string' || !model)
    throw new TypeError('A session review is keyed by the backend and model that answer');
  const { name: speed, windowConcurrency } = reviewSpeedProfile(speedProfile);
  const lanes = concurrency === undefined ? windowConcurrency : concurrency;
  if (typeof answerCache?.keyOf !== 'function' || typeof answerCache.get !== 'function')
    throw new TypeError('A session review stores its answers in an answer cache');
  const release = await store.lock();
  let writes = Promise.resolve();
  try {
    const prior = await store.readProgress();
    const attempt = (prior?.attempt ?? 0) + 1;
    const profile = sessionProfileDigest(speed, backend);
    // Planned once: runReview takes this very plan rather than building it again.
    const plan = planWindowRequests({ session, reviewScope: SESSION_ONLY, speedProfile: speed, backend });
    const total = plan.requests.length;
    const memo = memoizeJudge(boundedJudge(judge, () => {}, { signal, speedProfile: speed, reviewScope: SESSION_ONLY, backend }), answerCache);
    const windowCalls = (n) => memo.answersFor((label) => windowOfLabel(label) === n);
    const byState = new Map(), byReason = new Map(), discarded = new Map();
    let finished = 0, replayed = 0, recordsRead = 0, stateChanged = 0;
    const snapshot = (state, failureCode) => ({
      schema: SESSION_REVIEW_PROGRESS_SCHEMA, state, failure: failureCode, attempt,
      windows: { total, finished, ...Object.fromEntries(WINDOW_STATES.map((s) => [s, byState.get(s) ?? 0])),
        replayed, pending: total - finished },
      byReason: ordered(WINDOW_INCOMPLETE_REASONS, byReason),
      calls: { live: memo.answers.calls, reused: memo.answers.reused },
      checkpoint: { recordsRead, discarded: ordered(CHECKPOINT_DISCARD_REASONS, discarded), stateChanged },
      servedModel: servedModelState(servedModelTally()),
      // M33 K: only when the caller reports rate limits; a value outside the closed shape is none.
      ...(typeof rateLimitTally === 'function' ? { rateLimit: rateLimitOrNull(rateLimitTally()) } : {}),
    });
    // Progress writes are serialized and each writes the counts as they are when it runs, so the
    // file never goes back to an older count.
    const writeProgress = (state, failureCode = null) => {
      const task = writes.then(async () => {
        const progress = snapshot(state, failureCode);
        await store.writeProgress(progress);
        return progress;
      });
      writes = task.catch(() => {});
      return task;
    };
    await writeProgress(RUNNING);

    const onWindowFinished = async (event) => {
      const windowKey = windowKeyOf({ answerKey: answerCache.keyOf(event.request), profile, window: event.window });
      const previous = await store.readWindow({ windowKey, window: event.window });
      if (previous.present) recordsRead++;
      if (previous.discard) bump(discarded, previous.discard);
      else if (previous.record && previous.record.state !== event.state) stateChanged++;
      // Every answer of this window is stored before the window finishes: memoizeJudge awaits the
      // put before it returns, and a window finishes only when all of its calls have returned.
      await store.writeWindow({ schema: WINDOW_CHECKPOINT_SCHEMA, windowKey, window: event.window,
        state: event.state, reasons: [...event.reasons], failure: event.failure, transport: event.transport,
        answers: memo.touchedFor((label) => windowOfLabel(label) === event.window)
          .map(({ key, occurrence }) => ({ key, occurrence })) });
      const calls = windowCalls(event.window);
      finished++;
      bump(byState, event.state);
      for (const reason of event.reasons) bump(byReason, reason);
      if (calls.calls === 0 && calls.reused > 0) replayed++;
      await writeProgress(RUNNING);
      onWindowRecord({ window: event.window, of: event.of, finished, state: event.state, reasons: [...event.reasons],
        failure: event.failure, transport: event.transport, calls: { live: calls.calls, reused: calls.reused } });
    };

    let report;
    try {
      report = await runReview({ session, pr: null, diff: null, reviewScope: SESSION_ONLY, judge: memo, signal,
        onWindowFinished, onProgress, concurrency: lanes, plan, speedProfile: speed, backend });
    } catch (error) {
      const code = RUN_FAILURE_CODES.includes(error?.code) ? error.code : REVIEW_FAILED;
      await writeProgress(code === REVIEW_INTERRUPTED ? INTERRUPTED : FAILED, code).catch(() => {});
      throw error;
    }
    try {
      // W3f-2 / F226, when the review completes: a window an answer left incomplete is asked again
      // next review. F228: the answer store stays bounded.
      const reask = windowsToReask(report.windowResults);
      if (reask.size) await memo.forget((label) => reask.has(windowOfLabel(label)));
      if (typeof answerCache.prune === 'function') await answerCache.prune();
      const perWindow = report.windowResults.map((w) => windowCalls(w.windowIndex + 1));
      report.instrument = { ...report.instrument, answers: memo.answers, resume: { attempt,
        windowsReplayed: perWindow.filter((c) => c.calls === 0 && c.reused > 0).length,
        windowsLive: perWindow.filter((c) => c.calls > 0 && c.reused === 0).length,
        windowsMixed: perWindow.filter((c) => c.calls > 0 && c.reused > 0).length,
        recordsDiscarded: ordered(CHECKPOINT_DISCARD_REASONS, discarded), stateChanged } };
      // The recording is rebuilt from the recording; it is never stored beside the report.
      const { session: omitted, ...saved } = report;
      await store.saveReport(saved);
      return { report, progress: await writeProgress(FINISHED) };
    } catch (error) {
      await writeProgress(FAILED, REVIEW_FAILED).catch(() => {});
      throw error;
    }
  } finally {
    await writes;
    await release();
  }
}

/**
 * D87 (owner decisions 2026-10-13/14): the code pass over a finished session review (`sonah review --code-pass`),
 * after `reviewSession` returned its report. `snapshot` is the frozen file snapshot (code-snapshot.js
 * `readCodeSnapshot`: `{ root, files }`); with no root the pass does not run (`ran: false`) and every checked row reads
 * not checked in the code. Its calls go through the same bounded, retrying transport as the session's (`boundedJudge`,
 * at the session request bound of `speedProfile` and `backend`) and through its own D60 answer store (`answerCache`,
 * kept apart from the session's so neither prunes the other), so the same files and the same session ask nothing twice.
 * The session part is never asked again here: the report is the one `reviewSession` returned (built, on a rerun, from
 * the session's stored answers). Saves the joined report (`saveReport`) under the store's lock and resolves
 * `{ report }`; rejects `review_interrupted` when `signal` aborted (nothing is saved).
 *
 * `model` (`--code-model`): the model the code step's calls are on, when it is not the session's — `judge` then sends
 * to it and `answerCache` is keyed by it — recorded as `codePass.model`. With none, the report is as before.
 * `required` (the release review): whether the person asked for the code step on the command line (`--code-pass`),
 * recorded as `codePass.required`; only then does its coverage decide whether the review is complete (ledger.js
 * `reviewRunState`). A step that ran by default or by the setting is `required: false`.
 */
export async function reviewCodePass({ session, report, snapshot, judge, answerCache, store, backend,
  speedProfile = undefined, signal = null, model = null, required = true }) {
  const { name: speed } = reviewSpeedProfile(speedProfile);
  const bound = requestBoundOf(reviewSpeedProfile(speed), SESSION_ONLY, backend);
  const memo = memoizeJudge(boundedJudge(judge, () => {}, { signal, speedProfile: speed, reviewScope: SESSION_ONLY,
    backend }), answerCache);
  const release = await store.lock();
  try {
    const result = await runCodePass({ report, session, snapshot: Array.isArray(snapshot?.files) ? snapshot.files : [],
      bound, judge: memo, ran: snapshot?.root === true, root: typeof snapshot?.dir === 'string' ? snapshot.dir : null,
      base: snapshot?.base ?? null });
    if (signal?.aborted === true) throw failure(REVIEW_INTERRUPTED);
    const joined = withCodePass(report, result);
    joined.codePass = { ...joined.codePass, ...(typeof model === 'string' && model ? { model } : {}),
      required: required !== false, answers: memo.answers };
    if (typeof answerCache?.prune === 'function') await answerCache.prune();
    const { session: omitted, ...saved } = joined;
    await store.saveReport(saved);
    return { report: joined };
  } finally { await release(); }
}

/**
 * The code step's reuse dry run: what `sonah review --code-pass
 * --state-dir <state>` would reuse and send, with no call and nothing written. The session review is replayed from the
 * answers stored under the state folder (`answerCache`, which the caller opens read-only) through a store kept in memory
 * and a judge that sends nothing: a request with no stored answer fails there, as a call that did not run, and is
 * counted (a lower bound: what such a failure would have led to is not asked either). Then the code step runs on that
 * report the same way, every request it would send first — step 1, then each lens — counted by its label and size and
 * none sent. Resolves `{ answers: { calls, reused }, codeRequests: [{ label, bytes }] }`.
 */
export async function dryRunReplay({ session, answerCache, snapshot, backend, model, speedProfile = undefined,
  concurrency = undefined }) {
  const unsent = async () => { throw error('invalid_model_input'); };
  const memory = { lock: async () => async () => {}, readProgress: async () => null, writeProgress: async () => {},
    readWindow: async () => ({ present: false }), writeWindow: async () => {}, saveReport: async () => {} };
  const { report } = await reviewSession({ session, judge: unsent, answerCache, store: memory, backend, model,
    speedProfile, concurrency });
  const codeRequests = [];
  if (snapshot) {
    const { name: speed } = reviewSpeedProfile(speedProfile);
    await runCodePass({ report, session, snapshot: Array.isArray(snapshot.files) ? snapshot.files : [],
      bound: requestBoundOf(reviewSpeedProfile(speed), SESSION_ONLY, backend), ran: snapshot.root === true,
      root: typeof snapshot.dir === 'string' ? snapshot.dir : null, base: snapshot.base ?? null,
      judge: async (request) => {
        codeRequests.push({ label: request.label, bytes: Buffer.byteLength(request.system ?? '', 'utf8')
          + Buffer.byteLength(request.prompt ?? '', 'utf8') });
        throw error('invalid_model_input');
      } });
  }
  return { answers: report.instrument?.answers ?? { calls: 0, reused: 0 }, codeRequests };
}

const hash = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const error = (code) => Object.assign(new Error(code), { code });

/** F72: one shared bound on judge calls actually RUNNING at once — narrative, challenge, repair
 *  and chunk calls alike, whichever window issued them — because `boundedJudge` is the one
 *  wrapper every one of them passes through. A frozen literal, like every other concurrency
 *  constant in this codebase: no per-repo tuning, no CLI flag. W3-7 put three windows' own
 *  CHALLENGE_PROFILE.maxConcurrency-wide challenge pools in flight together, which a
 *  subscription backend was never asked to hold before (18 `claude --print` subprocesses where
 *  it had only ever been proven to take 6); this is the floor under the TOTAL, not a second cap
 *  on any one window or pool — `WINDOW_CONCURRENCY` and `CHALLENGE_PROFILE.maxConcurrency` are
 *  untouched. */
export const MAX_CALLS_IN_FLIGHT = REVIEW_SPEED_PROFILES.standard.maxCallsInFlight;

/** A FIFO slot limiter: a caller past `max` waits for a release, in arrival order, and is handed
 *  the slot directly rather than the count dropping to zero and being re-raced. Nobody who calls
 *  `acquire` is ever refused — only made to wait, forever if need be. Exported so its queueing
 *  behaviour is directly testable at any size, independent of `MAX_CALLS_IN_FLIGHT`: nothing
 *  here reads a CLI flag, an environment variable or argv, so this is not a route to making the
 *  real limit configurable — it stays the one frozen number above. */
export function createCallLimiter(max) {
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('createCallLimiter requires a positive integer');
  let active = 0, peak = 0;
  const queue = [];
  const raise = () => { peak = Math.max(peak, active); };
  return {
    acquire() {
      return new Promise((resolve) => {
        if (active < max) { active++; raise(); resolve(); }
        else queue.push(resolve);
      });
    },
    release() {
      const next = queue.shift();
      if (next) next(); // the slot passes straight to the next waiter; `active` never drops.
      else active--;
    },
    /** The high-water mark over the limiter's whole life. */
    get peak() { return peak; },
  };
}

// One limiter, shared by every review this process runs, because the thing being protected —
// the backend's own concurrent-call ceiling — is a property of the process talking to it, not
// of any one review.
const callLimiter = createCallLimiter(MAX_CALLS_IN_FLIGHT);

// M33 J: a session review run under a speed profile other than standard is held to that profile's
// `maxCallsInFlight` by a limiter of its own — one per profile, shared by every review this process
// runs under it, for the same reason the standard one is shared. The standard profile keeps the one
// limiter above. Made on first use: a process that never names another profile
// never holds one.
const profileLimiters = new Map();
function limiterFor(profile) {
  if (isStandardProfile(profile)) return callLimiter;
  if (!profileLimiters.has(profile.name)) profileLimiters.set(profile.name, createCallLimiter(profile.maxCallsInFlight));
  return profileLimiters.get(profile.name);
}

// M33 (C-07): a call refused because its review was cancelled is `REVIEW_CANCELLED`, the one
// declaration in review-judge.js — a transport-only code, never a window failure and never retried
// (it is not in RETRYABLE_JUDGE_CODES).

/** The one wrapper every judge reaches the review through, whichever backend is behind it: the
 *  byte ceiling, the shared in-flight limit (F72), and one retry on a transport failure (W3-6).
 *  `budget_exhausted` is raised before the limiter and the retry wrapper, so it cannot be
 *  retried, and never occupies a slot, by construction rather than by list membership.
 *  M33: with a `signal`, no physical attempt starts once it is aborted — checked before the
 *  limiter, when a slot is handed over, and before each transport attempt (so before the retry).
 *  M33 J: `speedProfile` (a session review's; nothing is standard) sets the limiter to one of its
 *  `maxCallsInFlight`; the standard profile — and a caller that names none — keeps the shared limiter.
 *  M35 windowing: `reviewScope` and `backend` select the complete byte ceiling (`requestBoundOf`).
 *  Codex session requests use its smaller context bound; the default scope (`combined`, the removed PR route's,
 *  B5 P14) keeps CHALLENGE_PROFILE.maxInputBytes. */
export function boundedJudge(judge, onCall = () => {}, { signal = null, speedProfile = undefined, reviewScope = 'combined', backend = undefined } = {}) {
  const profile = reviewSpeedProfile(speedProfile);
  const budget = requestBoundOf(profile, reviewScope, backend);
  const limiter = limiterFor(profile);
  const cancelled = () => signal?.aborted === true;
  const transport = withTransportRetry(signal == null ? judge : (request) => {
    if (cancelled()) throw error(REVIEW_CANCELLED);
    return judge(request);
  });
  const bounded = async (request) => {
    const bytes = Buffer.byteLength(request.system ?? '', 'utf8') + Buffer.byteLength(request.prompt ?? '', 'utf8');
    onCall({ label: request.label, bytes, allowed: bytes <= budget });
    if (bytes > budget) throw error('budget_exhausted');
    if (cancelled()) throw error(REVIEW_CANCELLED);
    await limiter.acquire();
    try { return await transport(request); }
    finally { limiter.release(); }
  };
  return bounded;
}

// Only the review lock hard-links (F84).
import { link } from 'node:fs/promises';

/** Is this pid a running process? EPERM means it exists and is someone else's, which is alive. */
function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

export function createReviewStore(directory) {
  async function prepare() { await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700); }
  return {
    // The lock is ONE FILE, published complete by one atomic operation and removed by one (F32,
    // F84). It used to be a directory, and a directory cannot be removed atomically: every release
    // and every reclaim went through `rm -r`, which passes through an EMPTY directory, and
    // `rename()` onto an empty directory replaces it. Contenders renamed their locks into
    // directories a releaser had just emptied; an `rm -r` still in flight then unlinked the new
    // holder's owner file by path, and a third contender renamed into the directory that was empty
    // again. And an owner file missing mid-release read as a stale lock whose generation was
    // always the empty string, so a reclaimer that saw it once and again later "confirmed" it and
    // deleted whatever live lock stood there by then. Under load: two holders, and `ENOTEMPTY` or
    // `EINVAL` thrown out of lock() and release() in every run.
    async lock() {
      await prepare();
      const lockPath = join(directory, 'active.lock');
      const refuse = () => { const err = error('review_in_progress'); err.lockPath = lockPath; throw err; };
      // This acquisition's generation. The nonce means no two acquisitions ever write the same
      // bytes, so "the bytes are still ours" is proof the lock is still ours.
      const mine = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce: randomUUID() });
      // What stands at the lock path: nothing (null), a lock file and its bytes, or a directory —
      // the pre-F84 format — with the bytes of its owner file, if it has one.
      const inspect = async () => {
        try { return { kind: 'file', bytes: await readFile(lockPath, 'utf8') }; }
        catch (e) {
          if (e.code === 'ENOENT') return null;
          if (e.code !== 'EISDIR') throw e;
        }
        try { return { kind: 'directory', bytes: await readFile(join(lockPath, 'owner.json'), 'utf8') }; }
        catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { kind: 'directory', bytes: '' }; throw e; }
      };
      const ownerPid = (bytes) => { try { return JSON.parse(bytes).pid ?? null; } catch { return null; } };
      // Write the whole record to a private temp file, then hard-link it to the lock path. `link`
      // fails with EEXIST when anything at all is there, file or directory, so of any number of
      // contenders exactly one lands — and what it lands was complete before it was visible.
      const acquire = async () => {
        const temp = join(directory, `.lock-${process.pid}-${randomUUID()}.tmp`);
        try {
          await writeFile(temp, mine, { mode: 0o600, flag: 'wx' });
          await link(temp, lockPath);
          return true;
        } catch (e) {
          if (e.code === 'EEXIST') return false;
          throw e;
        } finally { await rm(temp, { force: true }); }
      };
      // Release only what is still ours. Nobody else removes a live owner's lock, so bytes that
      // match now still match at the unlink; bytes that do not match are someone else's lock, and
      // a stale release — a signal handler racing the normal `finally` — removes nothing.
      const release = async () => {
        let current;
        try { current = await readFile(lockPath, 'utf8'); }
        catch (e) { if (e.code === 'ENOENT' || e.code === 'EISDIR') return; throw e; }
        if (current === mine) await rm(lockPath, { force: true });
      };
      // A lock whose process is gone is a crash, not a review in progress (audit H23), but only a
      // process that can prove the lock it removes is still the dead one it read may remove it.
      // So the reclaim is a compare-and-swap: an exclusive claim on that generation, created
      // BESIDE the lock (a claim inside a directory died with the directory, and the next reader
      // could claim the same generation again), then a re-read, then removal only if unchanged.
      // A dead owner never releases and every other reclaimer of this generation is shut out by
      // the claim, so an unchanged re-read cannot go stale before the unlink. The claim is
      // dropped afterwards: a laggard that claims the same generation later re-reads, sees other
      // bytes or none, and backs off.
      //
      // A legacy directory is moved aside in one rename, so the lock path goes straight from
      // "directory" to "absent", never through an empty directory. Its generation is weaker — a
      // directory that vanishes mid-look reads as ownerless, the same as one that never had an
      // owner file — so the move itself is made directory-only: renaming onto an EMPTY directory
      // moves a directory and refuses a file (EISDIR). A lock file linked in meanwhile stays put.
      const reclaim = async (seen) => {
        const claim = `${lockPath}.claim-${hash([seen.kind, seen.bytes])}`;
        try { await writeFile(claim, mine, { mode: 0o600, flag: 'wx' }); }
        catch (e) { if (e.code === 'EEXIST') return; throw e; }
        try {
          const now = await inspect();
          if (now?.kind !== seen.kind || now.bytes !== seen.bytes) return;
          if (seen.kind === 'file') { await rm(lockPath, { force: true }); return; }
          const aside = join(directory, `.lock-legacy-${randomUUID()}`);
          await mkdir(aside, { mode: 0o700 });
          try { await rename(lockPath, aside); }
          catch (e) { if (!['ENOENT', 'EISDIR', 'ENOTDIR'].includes(e.code)) throw e; }
          finally { await rm(aside, { recursive: true, force: true }); }
        } finally { await rm(claim, { force: true }); }
      };
      // A few rounds, because the lock can change hands between our link and our look: freed
      // (link again) or reclaimed, by us or by someone else (link again). A lock that keeps
      // changing hands is a lock in use — `review_in_progress`, never a thrown filesystem code.
      for (let attempt = 0; attempt < 4; attempt++) {
        if (await acquire()) return release;
        const seen = await inspect();
        if (!seen) continue;
        const pid = ownerPid(seen.bytes);
        if (pid && isAlive(pid)) refuse();
        await reclaim(seen);
      }
      refuse();
    },
    async load() {
      try { return JSON.parse(await readFile(join(directory, 'current.json'), 'utf8')); }
      catch (e) { if (e.code === 'ENOENT') return null; throw error('review_state_invalid'); }
    },
    async save(record) {
      await prepare();
      await mkdir(join(directory, 'history'), { recursive: true, mode: 0o700 });
      const bytes = JSON.stringify(record);
      await writeFile(join(directory, 'history', `${record.inputDigest}-${randomUUID()}.json`), bytes, { mode: 0o600, flag: 'wx' });
      const temp = join(directory, `${randomUUID()}.tmp`);
      try { await writeFile(temp, bytes, { mode: 0o600, flag: 'wx' }); await rename(temp, join(directory, 'current.json')); }
      finally { await rm(temp, { force: true }); }
    },
  };
}

/**
 * W3f-2 / F226. The window-incomplete reasons (`WINDOW_INCOMPLETE_REASONS`, run-review.js) an ANSWER
 * is responsible for: a challenge reply that left a vote unanswered or unreadable, a proposal that
 * could not be challenged, a proposal grounding could not evaluate. A retry is exactly what can
 * complete such a window, and D60 would otherwise replay the same answer on every later review. Every
 * other reason keeps its answers: an absent-evidence reason (`grounding:relevance`, `narrative:budget`,
 * `narrative:input_invalid`, `challenge:budget_exhausted`) is not something asking again can supply,
 * and a failed call (`narrative:model_unavailable`, …) stored nothing. Members of the closed list,
 * never new strings.
 */
export const ANSWER_INCOMPLETE_REASONS = Object.freeze(['challenge:votes_invalid', 'challenge:items_unresolved',
  'grounding:session']);

// W3f-2 / F226. Which window a request belongs to, by the label its builder gave it: the narrative
// `narrative:wN` (joint `code+narrative:wN`, its one `…:receipt-repair`; M36 phase 3, D68 Q: a session-only window's
// evidence re-ask `narrative:wN:evidence`, a later one `…:evidenceK`; S3: the re-ask of its refuted requirement K
// `narrative:wN:restatus:K`; W1 A: the re-ask of its decision K refuted on who decided it `narrative:wN:recolumn:K`), the
// challenges `challenge:wN:…`, and the joint challenges
// `challenge:narrative:wN:joint:…`. A code-only chunk (`code+chunk:N`, `challenge:chunk:N:…`) belongs to no window:
// null.
const WINDOW_LABEL = new RegExp('^(?:code\\+)?narrative:w([1-9]\\d*)'
  + '(?::receipt-repair|:evidence(?:[2-9]|[1-9]\\d+)?|:(?:restatus|recolumn):(?:0|[1-9]\\d*))?$'
  + '|^challenge:(?:narrative:)?w([1-9]\\d*):');
export function windowOfLabel(label) {
  const match = typeof label === 'string' ? WINDOW_LABEL.exec(label) : null;
  return match ? Number(match[1] ?? match[2]) : null;
}

/** W3f-2 / F226. The windows (1-based, as labels name them) an answer left incomplete. */
export function windowsToReask(windowResults) {
  return new Set((Array.isArray(windowResults) ? windowResults : [])
    .filter((w) => Number.isSafeInteger(w?.windowIndex)
      && windowIncompleteReasons(w).some((reason) => ANSWER_INCOMPLETE_REASONS.includes(reason)))
    .map((w) => w.windowIndex + 1));
}
