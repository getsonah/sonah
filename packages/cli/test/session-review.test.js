// M33 (C-07 "Window checkpoints and resumable session review"). A session-only review that can be
// stopped and continued: answers are D60 answers, stored per call; each finished window leaves a
// count-only record; progress is integers and closed codes; a continuation replays every stored
// answer and reports what an uninterrupted review reports.
//
// Every byte here is synthetic: invented instructions, paths and tool output. No model, no real
// recording, no real ~/.sonah — each test gets its own temporary directory, and the judge is fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, lstat, symlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Session } from '../../evidence/src/session.js';
import { WINDOW_INCOMPLETE_REASONS, planWindowRequests, runReview } from '../../evidence/src/run-review.js';
import { RETRYABLE_JUDGE_CODES } from '../../evidence/src/ledger.js';
import { ATTESTATION_STATES, NON_RETRYABLE_PROVIDER_CLASSES, PROVIDER_CLASSES, REVIEW_CANCELLED, attestableModel,
  createReviewJudge, reviewTransportArguments } from '../src/review-judge.js';
import { answerKey, createAnswerCache } from '../src/answer-cache.js';
import { boundedJudge, MAX_CALLS_IN_FLIGHT, windowOfLabel } from '../src/session-review.js';

// Loaded so that each test, not the whole file, fails when the module is missing.
const sr = await import('../src/session-review.js').catch(() => ({}));
const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS).catch(() => ({}));

const IDENTITY = { backend: 'claude-cli', model: 'sonnet' };
/** The harness's one attestation beyond the transport's own: nothing, or no member, was reported. */
const ATTESTATIONS_EXTRA = ['unknown'];
const SENTINEL = 'SYNTHETIC_M33_CLI_SENTINEL';
const pathOf = (i) => `m33cli/step-${i}.txt`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HEX64 = /^[a-f0-9]{64}$/;
const RECORD_KEYS = ['answers', 'failure', 'reasons', 'schema', 'state', 'transport', 'window', 'windowKey'];
const PROGRESS_KEYS = ['attempt', 'byReason', 'calls', 'checkpoint', 'failure', 'schema', 'servedModel', 'state', 'windows'];
const WINDOW_COUNT_KEYS = ['complete', 'failed', 'finished', 'incomplete', 'pending', 'replayed', 'total'];

async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-m33-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// M35 windowing: a compaction no longer splits a window, so each step's write body is long (370k bytes, shown in full
// and never carried): no two steps fit one 200k-token window, and each step is a window of its own, as before.
const BODY_FILL = `// ${'b'.repeat(370_000)}\n`;
function sessionOf(count = 4, { out1 = null } = {}) {
  const blobs = {};
  const events = [];
  let sequence = 0;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  for (let i = 1; i <= count; i++) {
    blobs[`ask${i}`] = `${SENTINEL}_${i}: write the step ${i} marker file and nothing else.`;
    blobs[`said${i}`] = `SYNTHETIC_M33_CLI_SAID_${i}: writing the step ${i} marker file now.`;
    blobs[`body${i}`] = `SYNTHETIC_M33_CLI_BODY_${i} = ${i}\n${BODY_FILL}`;
    blobs[`out${i}`] = i === 1 && out1 ? out1 : `SYNTHETIC_M33_CLI_OUT_${i}: wrote the step ${i} marker.\n`;
    events.push({ id: `I${i}`, kind: 'instruction', sequence: sequence++, authority: 'human', text: whole(`ask${i}`), supersedes: [] });
    events.push({ id: `C${i}`, kind: 'commentary', sequence: sequence++, phase: 'working', text: whole(`said${i}`), beforeInvocation: `A${i}` });
    events.push({ id: `A${i}`, kind: 'invocation', sequence: sequence++, callKey: `c${i}`, tool: 'Write', operation: 'write',
      paths: [{ path: pathOf(i) }], command: [], input: [], changes: [{ path: pathOf(i), before: [], after: whole(`body${i}`), diff: [] }] });
    events.push({ id: `O${i}`, kind: 'observation', sequence: sequence++, invocation: `A${i}`, callKey: `c${i}`, phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: whole(`out${i}`), sourceOfResult: 'native' });
    if (i < count) events.push({ id: `B${i}`, kind: 'boundary', sequence: sequence++, boundary: 'compaction' });
  }
  return new Session({ sessionKey: 'sess-m33-cli', adapter: 'claude', events, blobs });
}
const narrativeFor = (i) => ({
  decisions: [{ dimension: `SYNTHETIC_M33_CLI_DIMENSION_${i}`, chosen: `Write ${pathOf(i)}`, value: pathOf(i),
    valueReceipt: { eventId: `A${i}`, field: 'path', role: 'action', quote: pathOf(i) }, actions: [`A${i}`],
    stated: { eventId: `C${i}`, role: 'commentary', quote: `SYNTHETIC_M33_CLI_SAID_${i}` },
    constrainedBy: { instruction: { eventId: `I${i}`, role: 'instruction', quote: `${SENTINEL}_${i}` }, settles: false, settledValueQuote: null } }],
  pivots: [], claims: [], requirements: [] });
const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);

/** Deterministic by window index; records every call it actually receives (a live call). */
function honestJudge({ calls = [], before = null, latency = () => 0, votes = null } = {}) {
  return async (request) => {
    calls.push({ label: request.label, window: windowOf(request.label) });
    if (before) await before(request);
    const ms = latency(request);
    if (ms) await sleep(ms);
    const index = windowOf(request.label);
    if (request.challenge) {
      if (votes) return votes(index, request);
      return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
        explanation: `Synthetic support vote ${SENTINEL}.`,
        receipts: [{ eventId: `I${index}`, role: 'instruction', quote: `${SENTINEL}_${index}` }] })) };
    }
    return narrativeFor(index);
  };
}

const cacheIn = (dir, identity = IDENTITY) => createAnswerCache(join(dir, 'answers'), identity);
const storeIn = (dir) => sr.createSessionReviewStore(join(dir, 'review'));
const review = (dir, options = {}) => sr.reviewSession({ session: sessionOf(4), judge: honestJudge(),
  answerCache: cacheIn(dir, options.identity ?? IDENTITY), store: storeIn(dir), ...(options.identity ?? IDENTITY), ...options });
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const progressOf = (dir) => readJson(join(dir, 'review', 'progress.json'));
async function recordsOf(dir) {
  const windows = join(dir, 'review', 'windows');
  const out = {};
  // `.discarded` holds the entries a run moved aside; it is not a record.
  for (const name of (await readdir(windows)).sort().filter((n) => !n.startsWith('.')))
    out[name] = await readFile(join(windows, name), 'utf8');
  return out;
}
async function recordByWindow(dir) {
  const out = new Map();
  for (const [name, bytes] of Object.entries(await recordsOf(dir))) {
    const record = JSON.parse(bytes);
    out.set(record.window, { name, bytes, record, path: join(dir, 'review', 'windows', name) });
  }
  return out;
}
/** The report less what reuse legitimately changes: the instrument's answer and resume counts. */
function projection(report) {
  const { answers, resume, ...instrument } = report.instrument;
  return JSON.stringify({ ...report, instrument });
}
const code = (value) => (error) => { assert.equal(error.code, value); assert.equal(error.message, value); return true; };

// ---- hygiene -----------------------------------------------------------------------------------
test('M33 a finished session review writes owner-only, count-only window records and progress', async (t) => {
  const dir = await directory(t, 'hygiene');
  const calls = [];
  const { report, progress } = await review(dir, { judge: honestJudge({ calls }) });
  const root = join(dir, 'review');
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, 'windows'))).mode & 0o777, 0o700);
  const names = (await readdir(root)).sort();
  assert.deepEqual(names, ['progress.json', 'report.private.json', 'windows'], 'no temp file or lock is left behind');
  for (const name of ['progress.json', 'report.private.json']) assert.equal((await stat(join(root, name))).mode & 0o777, 0o600);
  const records = await recordsOf(dir);
  assert.equal(Object.keys(records).length, 4);
  for (const [name, bytes] of Object.entries(records)) {
    assert.equal((await stat(join(root, 'windows', name))).mode & 0o777, 0o600);
    const record = JSON.parse(bytes);
    assert.deepEqual(Object.keys(record).sort(), RECORD_KEYS);
    assert.equal(record.schema, 'sonah.window-checkpoint/1');
    assert.equal(`${record.windowKey}.json`, name);
    assert.match(record.windowKey, HEX64);
    assert.equal(record.state, 'complete');
    assert.deepEqual([record.reasons, record.failure, record.transport], [[], null, null]);
    assert.equal(record.answers.length, 4, 'the narrative and three challenge passes');
    for (const ref of record.answers) {
      assert.deepEqual(Object.keys(ref).sort(), ['key', 'occurrence']);
      assert.match(ref.key, HEX64);
      assert.ok(Number.isSafeInteger(ref.occurrence) && ref.occurrence >= 0);
    }
    assert.deepEqual(record.answers.slice(1).map((ref) => ref.occurrence), [0, 1, 2], 'three passes, three occurrences');
  }
  const progressBytes = await readFile(join(root, 'progress.json'), 'utf8');
  for (const bytes of [...Object.values(records), progressBytes])
    for (const text of [SENTINEL, 'SYNTHETIC', 'narrative:', 'challenge:', 'm33cli/', 'Session review', dir])
      assert.ok(!bytes.includes(text), `a record or the progress carries ${text}`);
  const onDisk = JSON.parse(progressBytes);
  assert.deepEqual(onDisk, progress);
  assert.deepEqual(Object.keys(onDisk).sort(), PROGRESS_KEYS);
  assert.equal(onDisk.schema, 'sonah.session-review-progress/1');
  assert.deepEqual([onDisk.state, onDisk.failure, onDisk.attempt, onDisk.servedModel], ['finished', null, 1, 'unknown']);
  assert.deepEqual(onDisk.windows, { total: 4, finished: 4, complete: 4, incomplete: 0, failed: 0, replayed: 0, pending: 0 });
  assert.deepEqual(onDisk.byReason, {});
  assert.deepEqual(onDisk.calls, { live: calls.length, reused: 0 });
  assert.deepEqual(onDisk.checkpoint, { recordsRead: 0, discarded: {}, stateChanged: 0 });
  assert.deepEqual(report.instrument.answers, { calls: calls.length, reused: 0 });
  assert.deepEqual(report.instrument.resume, { attempt: 1, windowsReplayed: 0, windowsLive: 4, windowsMixed: 0,
    recordsDiscarded: {}, stateChanged: 0 });
  const saved = await readJson(join(root, 'report.private.json'));
  assert.equal(saved.instrument.windows, 4);
  assert.equal(Object.hasOwn(saved, 'session'), false, 'the recording is rebuilt, never stored beside the report');
});

// F228, re-pointed from the removed PR route (D82 step 10): the session review prunes its recording's store too.
test('F228 a session review leaves its recording\'s store within the bound', async (t) => {
  const sizesIn = async (dir) => Promise.all((await readdir(dir)).filter((f) => f.endsWith('.json'))
    .map(async (f) => (await stat(join(dir, f))).size));
  const dir = await directory(t, 'store-bound');
  const calls = [];
  await review(dir, { judge: honestJudge({ calls }) });
  const sizes = await sizesIn(join(dir, 'answers'));
  assert.equal(sizes.length, calls.length, 'premise: every answer was stored');
  // The same review against a store bounded at half of what it writes.
  const bounded = await directory(t, 'store-bound-half');
  const bound = Math.floor(sizes.reduce((a, b) => a + b, 0) / 2);
  await review(bounded, { answerCache: createAnswerCache(join(bounded, 'answers'), { ...IDENTITY, maxBytes: bound }) });
  const kept = await sizesIn(join(bounded, 'answers'));
  assert.ok(kept.length > 0 && kept.length < sizes.length, `kept ${kept.length} of ${sizes.length}`);
  assert.ok(kept.reduce((a, b) => a + b, 0) <= bound);
});

test('M33 each window record is written only after every stored answer of its window', async (t) => {
  const dir = await directory(t, 'ordering');
  const log = [];
  const cache = cacheIn(dir);
  const spy = { ...cache, put: async (request, response, occurrence) => {
    const stored = await cache.put(request, response, occurrence);
    log.push({ put: windowOf(request.label), stored });
    return stored;
  } };
  const records = [];
  await review(dir, { answerCache: spy, onWindowRecord: (event) => { log.push({ record: event.window }); records.push(event); } });
  for (let n = 1; n <= 4; n++) {
    const recordAt = log.findIndex((entry) => entry.record === n);
    const puts = log.map((entry, at) => ({ ...entry, at })).filter((entry) => entry.put === n);
    assert.ok(recordAt >= 0, `window ${n} was recorded`);
    assert.equal(puts.length, 4);
    assert.ok(puts.every((entry) => entry.stored && entry.at < recordAt), `window ${n}'s record preceded one of its answers`);
  }
  for (const event of records) {
    const bytes = JSON.stringify(event);
    assert.ok(!bytes.includes('SYNTHETIC') && !bytes.includes('narrative:'), 'the record callback carries text');
    for (const value of Object.values(event))
      assert.ok(value === null || Number.isSafeInteger(value) || typeof value === 'string' || Array.isArray(value)
        || (typeof value === 'object' && Object.values(value).every(Number.isSafeInteger)), 'counts and codes only');
  }
});

// ---- interruption and continuation -------------------------------------------------------------------
test('M33 calls are not windows: an interrupted attempt counts only durably recorded windows', async (t) => {
  const dir = await directory(t, 'interrupted');
  const controller = new AbortController();
  const calls = [];
  const judge = honestJudge({ calls, before: (request) => { if (request.label === 'narrative:w2') controller.abort(); } });
  await assert.rejects(review(dir, { judge, signal: controller.signal, concurrency: 1 }), code('review_interrupted'));
  const progress = await progressOf(dir);
  assert.deepEqual([progress.state, progress.failure, progress.attempt], ['interrupted', 'review_interrupted', 1]);
  assert.deepEqual(progress.windows, { total: 4, finished: 1, complete: 1, incomplete: 0, failed: 0, replayed: 0, pending: 3 });
  assert.deepEqual(progress.calls, { live: 5, reused: 0 }, 'window 2\'s narrative was a live call, not a window');
  assert.deepEqual(calls.map((c) => c.label).slice(-1), ['narrative:w2'], 'no call after the abort');
  assert.equal(Object.keys(await recordsOf(dir)).length, 1);
  await assert.rejects(stat(join(dir, 'review', 'report.private.json')), { code: 'ENOENT' }, 'an interrupted attempt is never a report');
});

test('M33 a continuation replays finished windows with 0 live calls and reports what an uninterrupted review reports', async (t) => {
  const dir = await directory(t, 'continued');
  const controller = new AbortController();
  await assert.rejects(review(dir, { concurrency: 1, signal: controller.signal,
    judge: honestJudge({ before: (request) => { if (request.label === 'narrative:w2') controller.abort(); } }) }),
  code('review_interrupted'));
  const calls = [];
  const continued = await review(dir, { judge: honestJudge({ calls }) });
  assert.equal(calls.filter((c) => c.window === 1).length, 0, 'a finished window made a live call');
  assert.deepEqual(calls.filter((c) => c.window === 2).map((c) => c.label).sort(),
    ['challenge:w2:b1:p1', 'challenge:w2:b1:p2', 'challenge:w2:b1:p3'], 'window 2\'s stored narrative was replayed');
  assert.deepEqual(continued.report.instrument.resume, { attempt: 2, windowsReplayed: 1, windowsLive: 2, windowsMixed: 1,
    recordsDiscarded: {}, stateChanged: 0 });
  assert.deepEqual(continued.report.instrument.answers, { calls: calls.length, reused: 5 });
  assert.deepEqual([continued.progress.state, continued.progress.attempt, continued.progress.windows.replayed,
    continued.progress.checkpoint.recordsRead], ['finished', 2, 1, 1]);
  const other = await directory(t, 'uninterrupted');
  const whole = await review(other);
  assert.equal(projection(continued.report), projection(whole.report));
  const third = [];
  const again = await review(dir, { judge: honestJudge({ calls: third }) });
  assert.equal(third.length, 0);
  assert.equal(again.progress.attempt, 3);
  assert.equal(again.progress.windows.replayed, 4);
  assert.equal(again.progress.checkpoint.recordsRead, 4);
  assert.equal(projection(again.report), projection(whole.report));
});

test('M33 an interruption inside a challenge replays the stored passes as their own occurrences', async (t) => {
  const dir = await directory(t, 'mid-challenge');
  const controller = new AbortController();
  const first = [];
  await assert.rejects(review(dir, { concurrency: 1, signal: controller.signal, judge: honestJudge({ calls: first,
    before: (request) => {
      if (request.label === 'challenge:w1:b1:p3') {
        controller.abort();
        throw Object.assign(new Error('synthetic'), { code: 'model_unavailable' });
      }
    } }) }), code('review_interrupted'));
  assert.equal(first.filter((c) => c.label === 'challenge:w1:b1:p3').length, 1, 'the transport retry started no second attempt');
  const cache = cacheIn(dir);
  const files = (await readdir(cache.directory)).sort();
  assert.equal(files.length, 3, 'premise: the narrative and passes 1-2 were stored');
  const before = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await readFile(join(cache.directory, f), 'utf8')])));
  const calls = [];
  const continued = await review(dir, { judge: honestJudge({ calls }) });
  assert.deepEqual(calls.filter((c) => c.window === 1).map((c) => c.label), ['challenge:w1:b1:p3']);
  for (const [file, bytes] of Object.entries(before))
    assert.equal(await readFile(join(cache.directory, file), 'utf8'), bytes, 'a replayed pass was rewritten');
  const record = (await recordByWindow(dir)).get(1).record;
  const challengeKey = record.answers[1].key;
  assert.deepEqual(record.answers.slice(1), [0, 1, 2].map((occurrence) => ({ key: challengeKey, occurrence })));
  assert.equal(continued.report.instrument.resume.windowsMixed, 1);
});

test('M33 F226 applies when the continuation completes: an incomplete window is replayed, then forgotten', async (t) => {
  const dir = await directory(t, 'f226');
  const unvoted = (index, request) => (index === 2 ? { votes: [] } : { votes: request.challenge.items.map(({ key }) => ({ key,
    verdict: 'not-refuted', explanation: 'Synthetic support vote.',
    receipts: [{ eventId: `I${index}`, role: 'instruction', quote: `${SENTINEL}_${index}` }] })) });
  const controller = new AbortController();
  await assert.rejects(review(dir, { concurrency: 1, signal: controller.signal, judge: honestJudge({ votes: unvoted,
    before: (request) => { if (request.label === 'narrative:w3') controller.abort(); } }) }), code('review_interrupted'));
  const interrupted = await progressOf(dir);
  assert.deepEqual([interrupted.windows.finished, interrupted.windows.incomplete], [2, 1]);
  assert.ok(Object.keys(interrupted.byReason).every((r) => WINDOW_INCOMPLETE_REASONS.includes(r)));
  const storedAfterInterruption = (await readdir(cacheIn(dir).directory)).length;
  assert.ok(storedAfterInterruption >= 9, 'an interrupted attempt forgets nothing');
  const calls = [];
  const continued = await review(dir, { judge: honestJudge({ calls, votes: unvoted }) });
  assert.equal(calls.filter((c) => c.window === 2).length, 0, 'the incomplete window was resampled on continuation');
  assert.equal(continued.progress.windows.incomplete, 1);
  assert.equal((await recordByWindow(dir)).get(2).record.state, 'incomplete');
  const third = [];
  await review(dir, { judge: honestJudge({ calls: third }) });
  assert.ok(third.filter((c) => c.window === 2).length > 0, 'F226 forgot the incomplete window when the review completed');
  assert.equal(third.filter((c) => c.window !== 2).length, 0);
});

// ---- identity ----------------------------------------------------------------------------------------
test('M33 near-miss identities are live calls, never replays', async (t) => {
  const dir = await directory(t, 'near-miss');
  const first = [];
  await review(dir, { judge: honestJudge({ calls: first }) });
  const oneByte = [];
  await review(dir, { session: sessionOf(4, { out1: 'SYNTHETIC_M33_CLI_OUT_1: wrote the step 1 marker!\n' }),
    judge: honestJudge({ calls: oneByte }) });
  assert.deepEqual([...new Set(oneByte.map((c) => c.window))], [1], 'one byte of window 1\'s prompt: only window 1 is live');
  assert.equal(oneByte.length, 4);
  assert.equal(Object.keys(await recordsOf(dir)).length, 5, 'the changed window is recorded under its own key');
  for (const identity of [{ ...IDENTITY, model: 'opus' }, { backend: 'codex-cli', model: 'sonnet' }]) {
    const calls = [];
    const result = await review(dir, { identity, judge: honestJudge({ calls }) });
    assert.equal(calls.length, first.length, `${identity.backend}/${identity.model} replayed an answer`);
    assert.equal(result.progress.checkpoint.recordsRead, 0);
  }
  const argsCalls = [];
  await review(dir, { judge: honestJudge({ calls: argsCalls }), answerCache: createAnswerCache(join(dir, 'answers'),
    { ...IDENTITY, transportArguments: (input) => ({ ...reviewTransportArguments(input), extra: 'SYNTHETIC_FLAG' }) }) });
  assert.equal(argsCalls.length, first.length, 'another transport argument replayed an answer');
  // The window key binds the narrative request's answer key, the run profile and the window.
  const request = { system: 'SYNTHETIC_SYSTEM', prompt: 'SYNTHETIC_PROMPT' };
  const profile = sr.sessionProfileDigest();
  assert.match(profile, HEX64);
  const base = sr.windowKeyOf({ answerKey: answerKey(request, IDENTITY), profile, window: 1 });
  assert.match(base, HEX64);
  for (const other of [
    { answerKey: answerKey({ ...request, system: 'SYNTHETIC_SYSTEm' }, IDENTITY), profile, window: 1 },
    { answerKey: answerKey({ ...request, prompt: 'SYNTHETIC_PROMPt' }, IDENTITY), profile, window: 1 },
    { answerKey: answerKey(request, IDENTITY), profile: 'f'.repeat(64), window: 1 },
    { answerKey: answerKey(request, IDENTITY), profile, window: 2 },
  ]) assert.notEqual(sr.windowKeyOf(other), base);
});

test('M33 a record under another key or window is identity_mismatch; swapped occurrence files are misses', async (t) => {
  const dir = await directory(t, 'mismatch');
  await review(dir);
  const records = await recordByWindow(dir);
  const original = await recordsOf(dir);
  await writeFile(records.get(2).path, records.get(1).bytes);
  await writeFile(records.get(3).path, JSON.stringify({ ...records.get(3).record, window: 4 }));
  const calls = [];
  const replay = await review(dir, { judge: honestJudge({ calls }) });
  assert.equal(calls.length, 0, 'a discarded record costs no call and skips no window');
  assert.deepEqual(replay.progress.checkpoint, { recordsRead: 4, discarded: { identity_mismatch: 2 }, stateChanged: 0 });
  assert.deepEqual(replay.report.instrument.resume.recordsDiscarded, { identity_mismatch: 2 });
  assert.deepEqual(await recordsOf(dir), original, 'the recomputed records replaced the mismatched ones');
  // Swap the first two stored occurrences of window 1's challenge request.
  const { key } = records.get(1).record.answers[1];
  const answers = cacheIn(dir).directory;
  await rename(join(answers, `${key}.0.json`), join(answers, 'swap.tmp'));
  await rename(join(answers, `${key}.1.json`), join(answers, `${key}.0.json`));
  await rename(join(answers, 'swap.tmp'), join(answers, `${key}.1.json`));
  const swapped = [];
  await review(dir, { judge: honestJudge({ calls: swapped }) });
  assert.deepEqual(swapped.map((c) => c.label).sort(), ['challenge:w1:b1:p1', 'challenge:w1:b1:p2']);
});

test('M33 malformed records are each discarded with their one reason, never an error', async (t) => {
  const dir = await directory(t, 'malformed');
  await review(dir);
  const target = (await recordByWindow(dir)).get(1);
  const good = target.record;
  const cases = [
    ['truncated', 'unreadable', (path) => writeFile(path, target.bytes.slice(0, 20))],
    ['empty', 'unreadable', (path) => writeFile(path, '')],
    ['extra key', 'schema_invalid', (path) => writeFile(path, JSON.stringify({ ...good, note: 'x' }))],
    ['missing key', 'schema_invalid', (path) => { const { transport, ...rest } = good; return writeFile(path, JSON.stringify(rest)); }],
    ['schema string', 'schema_invalid', (path) => writeFile(path, JSON.stringify({ ...good, schema: 'sonah.window-checkpoint/2' }))],
    ['reason outside the vocabulary', 'schema_invalid', (path) => writeFile(path,
      JSON.stringify({ ...good, state: 'incomplete', reasons: ['challenge:SYNTHETIC'] }))],
    ['reasons out of order', 'schema_invalid', (path) => writeFile(path,
      JSON.stringify({ ...good, state: 'incomplete', reasons: ['challenge:votes_invalid', 'grounding:session'] }))],
    ['negative occurrence', 'schema_invalid', (path) => writeFile(path,
      JSON.stringify({ ...good, answers: [{ ...good.answers[0], occurrence: -1 }] }))],
    ['duplicate reference', 'schema_invalid', (path) => writeFile(path,
      JSON.stringify({ ...good, answers: [good.answers[0], good.answers[0]] }))],
    ['key not hex', 'schema_invalid', (path) => writeFile(path,
      JSON.stringify({ ...good, answers: [{ key: 'SYNTHETIC', occurrence: 0 }] }))],
    ['window not an integer', 'schema_invalid', (path) => writeFile(path, JSON.stringify({ ...good, window: 1.5 }))],
    ['repeated JSON key', 'schema_invalid', (path) => writeFile(path,
      target.bytes.replace('{', '{"state":"failed",'))],
    ['complete with a failure', 'state_inconsistent', (path) => writeFile(path, JSON.stringify({ ...good, failure: 'model_timeout' }))],
    ['failed without a failure', 'state_inconsistent', (path) => writeFile(path, JSON.stringify({ ...good, state: 'failed' }))],
    ['incomplete without a reason', 'state_inconsistent', (path) => writeFile(path, JSON.stringify({ ...good, state: 'incomplete' }))],
    ['failed with a transport and no reason', 'state_inconsistent', (path) => writeFile(path,
      JSON.stringify({ ...good, state: 'failed', failure: 'model_timeout', transport: 'timeout' }))],
    ['symlink', 'not_regular_file', async (path) => {
      const elsewhere = join(dir, 'elsewhere.json');
      await writeFile(elsewhere, target.bytes, { mode: 0o600 });
      await rm(path); await symlink(elsewhere, path);
    }],
    ['directory', 'not_regular_file', async (path) => { await rm(path); await mkdir(path, { mode: 0o700 }); }],
    ['0644', 'owner_unsafe', (path) => chmod(path, 0o644)],
  ];
  for (const [name, reason, corrupt] of cases) {
    await corrupt(target.path);
    const calls = [];
    const replay = await review(dir, { judge: honestJudge({ calls }) });
    assert.deepEqual(replay.progress.checkpoint.discarded, { [reason]: 1 }, name);
    assert.equal(calls.length, 0, `${name}: a discard cost a call`);
    assert.equal(replay.progress.windows.finished, 4, `${name}: a discard skipped a window`);
    const info = await lstat(target.path);
    assert.ok(info.isFile() && (info.mode & 0o777) === 0o600, `${name}: the record was rewritten owner-only`);
    assert.equal(await readFile(target.path, 'utf8'), target.bytes, `${name}: the recomputed record is the same bytes`);
  }
});

test('M33 completion order changes no byte of any record', async (t) => {
  const scrambled = (flip) => (request) => {
    const n = [...String(request.label)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return ((flip ? 7 - (n % 7) : n % 7) + 1) * 3;
  };
  const one = await directory(t, 'order-a'), two = await directory(t, 'order-b');
  const a = await review(one, { judge: honestJudge({ latency: scrambled(false) }) });
  const b = await review(two, { judge: honestJudge({ latency: scrambled(true) }) });
  assert.deepEqual(await recordsOf(two), await recordsOf(one));
  assert.equal(projection(b.report), projection(a.report));
  assert.deepEqual(b.progress, a.progress);
});

test('M33 a second run on the same store is refused with review_in_progress', async (t) => {
  const dir = await directory(t, 'lock');
  const store = storeIn(dir);
  const release = await store.lock();
  await assert.rejects(review(dir), code('review_in_progress'));
  await assert.rejects(stat(join(dir, 'review', 'progress.json')), { code: 'ENOENT' }, 'a refused run wrote progress');
  await release();
  const results = await Promise.allSettled([review(dir, { judge: honestJudge({ latency: () => 5 }) }),
    review(dir, { judge: honestJudge({ latency: () => 5 }) })]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'review_in_progress');
});

test('M33 a store whose directory is not owner-only is refused with owner_unsafe', async (t) => {
  const dir = await directory(t, 'owner');
  const original = process.getuid;
  process.getuid = () => original.call(process) + 1;
  try { await assert.rejects(review(dir), code('owner_unsafe')); }
  finally { process.getuid = original; }
});

// ---- cancellation in the transport wrapper ------------------------------------------------------------
test('M33 boundedJudge starts no physical call after an abort: before a slot, while waiting for one, or before a retry', async () => {
  assert.ok(!RETRYABLE_JUDGE_CODES.includes('review_cancelled'), 'a cancellation is never retried');
  const request = { system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P', label: 'narrative:w1' };
  // Aborted before the call: nothing starts.
  let started = 0;
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(boundedJudge(async () => { started++; return {}; }, () => {}, { signal: aborted.signal })(request),
    code('review_cancelled'));
  assert.equal(started, 0);
  // Waiting for a slot: every slot is held, the waiter is aborted, the slot it is handed starts nothing.
  const gate = [];
  const held = boundedJudge(() => new Promise((resolve) => gate.push(resolve)));
  const holding = Array.from({ length: MAX_CALLS_IN_FLIGHT }, () => held(request));
  const waiting = new AbortController();
  let waiter = 0;
  const queued = boundedJudge(async () => { waiter++; return {}; }, () => {}, { signal: waiting.signal })(request);
  await sleep(5);
  waiting.abort();
  while (gate.length) gate.shift()({});
  await Promise.all(holding);
  await assert.rejects(queued, code('review_cancelled'));
  assert.equal(waiter, 0, 'a waiter handed a slot after the abort started a call');
  // Before the transport retry: the first attempt fails retryably and the abort lands meanwhile.
  const retry = new AbortController();
  let attempts = 0;
  await assert.rejects(boundedJudge(async () => {
    attempts++;
    retry.abort();
    throw Object.assign(new Error('synthetic'), { code: 'model_unavailable' });
  }, () => {}, { signal: retry.signal })(request), code('review_cancelled'));
  assert.equal(attempts, 1, 'the transport retry started a second attempt after the abort');
  // Existing callers are unchanged.
  assert.deepEqual(await boundedJudge(async () => ({ ok: 1 }))(request), { ok: 1 });
});

// ---- progress -------------------------------------------------------------------------------------------
test('M33 a running progress without a live lock holder reads as interrupted', async (t) => {
  const dir = await directory(t, 'progress');
  const root = join(dir, 'review');
  const seen = [];
  await review(dir, { concurrency: 1, judge: honestJudge({ before: async (request) => {
    if (request.label === 'narrative:w3') seen.push(await sr.readSessionReviewProgress(root));
  } }) });
  assert.equal(seen[0].state, 'running', 'a live holder\'s run reads as running');
  assert.ok(seen[0].windows.finished >= 1 && seen[0].windows.finished < 4);
  assert.equal((await sr.readSessionReviewProgress(root)).state, 'finished');
  const finished = await progressOf(dir);
  await writeFile(join(root, 'progress.json'), JSON.stringify({ ...finished, state: 'running' }), { mode: 0o600 });
  assert.deepEqual([(await sr.readSessionReviewProgress(root)).state, (await sr.readSessionReviewProgress(root)).failure],
    ['interrupted', 'review_interrupted'], 'no lock: the holder is gone');
  const dead = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', () => resolve(child.pid));
  });
  await writeFile(join(root, 'active.lock'), JSON.stringify({ pid: dead, startedAt: 'x', nonce: 'y' }), { mode: 0o600 });
  assert.equal((await sr.readSessionReviewProgress(root)).state, 'interrupted', 'a dead holder reads as interrupted');
  await rm(join(root, 'active.lock'));
  const release = await storeIn(dir).lock();
  assert.equal((await sr.readSessionReviewProgress(root)).state, 'running', 'a live holder reads as running');
  await release();
  await chmod(join(root, 'progress.json'), 0o644);
  assert.equal(await sr.readSessionReviewProgress(root), null, 'a progress file that is not owner-only is not read');
});

// ---- vocabulary ---------------------------------------------------------------------------------------------
test('M33 every new state, discard reason and code is a member of a frozen vocabulary, never an inline literal', async () => {
  const lists = {
    CHECKPOINT_DISCARD_REASONS: ['unreadable', 'not_regular_file', 'owner_unsafe', 'schema_invalid', 'identity_mismatch', 'state_inconsistent'],
    SESSION_REVIEW_STATES: ['running', 'finished', 'interrupted', 'failed'],
    SERVED_MODEL_STATES: ['attested', 'unattested', 'mixed', 'unknown'],
  };
  for (const [name, members] of Object.entries(lists)) {
    assert.deepEqual(sr[name], members, name);
    assert.ok(Object.isFrozen(sr[name]), `${name} is frozen`);
  }
  // Outside the frozen declarations, no token is spelled out: every use reads the table.
  const source = await readFile(new URL('../src/session-review.js', import.meta.url), 'utf8');
  const outside = source.replace(/Object\.freeze\(\[[\s\S]*?\]\)/g, '');
  for (const token of [...lists.CHECKPOINT_DISCARD_REASONS, ...lists.SESSION_REVIEW_STATES, ...lists.SERVED_MODEL_STATES,
    'review_interrupted', 'checkpoint_failed', 'review_identity_ambiguous', 'review_failed', 'complete', 'incomplete'])
    assert.ok(!outside.includes(`'${token}'`), `session-review.js spells ${token} out at a call site`);
  for (const token of lists.CHECKPOINT_DISCARD_REASONS)
    assert.equal(source.split(`'${token}'`).length - 1, 1, `${token} is declared once`);
  // F1: one table each. session-review.js (`boundedJudge`, which every review passes through) reads the
  // cancellation code from review-judge.js, and the harness reads the provider classes, the non-retryable ones and
  // the attestation states there.
  const command = await readFile(new URL('../src/session-review-command.js', import.meta.url), 'utf8');
  for (const [file, text] of [['session-review.js', source], ['session-review-command.js', command]])
    assert.equal(text.split(`'${REVIEW_CANCELLED}'`).length - 1, 0, `${file} spells review_cancelled out`);
  assert.match(source, /import \{[^}]*\bREVIEW_CANCELLED\b[^}]*\} from '\.\/review-judge\.js'/);
  const script = await readFile(new URL('../../../scripts/session-review.mjs', import.meta.url), 'utf8');
  for (const token of [...PROVIDER_CLASSES.filter((c) => !ATTESTATIONS_EXTRA.includes(c)), ...ATTESTATION_STATES, REVIEW_CANCELLED])
    assert.ok(!script.includes(`'${token}'`), `session-review.mjs spells ${token} out`);
  assert.equal(harness.PROVIDER_CLASSES, undefined, 'the harness keeps no copy of the provider classes');
  assert.equal(harness.STOP_PROVIDER_CLASSES, undefined, 'the harness keeps no copy of the non-retryable classes');
  // The harness reads these tables by position: pin the positions it reads.
  assert.deepEqual([...ATTESTATION_STATES], ['attested', 'mismatch', 'unattested']);
  assert.equal(PROVIDER_CLASSES.at(-1), 'unknown');
  assert.deepEqual(harness.ATTESTATIONS, [...ATTESTATION_STATES, ...ATTESTATIONS_EXTRA]);
  // D70 review (S0): a context window other than the one asked, and the request-byte budget.
  assert.deepEqual(harness.BREAKER_REASONS, ['attestation_mismatch', 'context_window', ...NON_RETRYABLE_PROVIDER_CLASSES,
    'utilization', 'max_calls', 'max_input_bytes', 'deadline', 'signal']);
  for (const list of [harness.ATTESTATIONS, harness.BREAKER_REASONS]) assert.ok(Object.isFrozen(list));
  assert.equal(sr.servedModelState({}), 'unknown');
  assert.equal(sr.servedModelState({ attested: 2 }), 'attested');
  assert.equal(sr.servedModelState({ unattested: 1 }), 'unattested');
  assert.equal(sr.servedModelState({ attested: 1, unattested: 1 }), 'mixed');
  assert.equal(sr.servedModelState({ attested: 1, unknown: 1 }), 'unknown');
  assert.equal(windowOfLabel('narrative:w12'), 12, 'F226 reads session narrative labels');
  assert.equal(windowOfLabel('challenge:w12:b1:p3'), 12, 'F226 reads session challenge labels');
  assert.equal(windowOfLabel('challenge:w12:reask:p2'), 12, 'F226 reads session re-ask labels');
});

// ---- the harness --------------------------------------------------------------------------------------------
/** A fake transport factory: answers honestly, and reports closed attempt metadata per call.
 *  `delay.before` / `delay.after` (ms, per request) wait before and after the report. */
function fakeTransport({ metadata = () => ({ attestation: 'attested', providerClass: null }), calls = [], delay = {} } = {}) {
  let entered = 0;
  return ({ config, onResult }) => {
    assert.deepEqual(Object.keys(config).sort(), ['backend', 'model']);
    const honest = honestJudge({ calls });
    return async (request) => {
      const n = ++entered;
      const extra = metadata(n, request);
      const ok = extra.ok !== false;
      if (delay.before?.(request)) await sleep(delay.before(request));
      await onResult({ ok, ...(ok ? {} : { code: extra.code ?? 'model_unavailable' }), usage: { input_tokens: 3 },
        reportedModels: ['SYNTHETIC_MODEL_NAME'], elapsedMs: 4, inputBytes: 10, backend: config.backend,
        requestedModel: config.model, ...extra });
      if (delay.after?.(request)) await sleep(delay.after(request));
      if (!ok) { calls.push({ label: request.label }); throw Object.assign(new Error(`${SENTINEL}`), { code: extra.code ?? 'model_unavailable' }); }
      return honest(request);
    };
  };
}

test('M33 the session-review harness prints counts only and stops admitting calls at the breaker', async (t) => {
  assert.equal(typeof harness.runSessionReviewHarness, 'function', 'the harness exports its runner');
  const base = await directory(t, 'harness');
  const options = (out, extra = {}) => ({ parent: join(base, 'SYNTHETIC.jsonl'), codexHome: base, out,
    backend: 'claude-cli', model: 'claude-synthetic-1', maxCalls: 1000, maxSeconds: 600, timeoutMs: 1000,
    sessionKey: 'session', concurrency: 1, ...extra });
  const loadSession = async () => sessionOf(4);
  let stdout = '', stderr = '';
  const write = (text) => { stdout += text; };
  const progress = (text) => { stderr += text; };
  // A budget of 6 physical calls: window 1 takes 4, window 2's narrative and one pass take 2.
  const capped = join(base, 'capped');
  const first = await harness.runSessionReviewHarness(options(capped, { maxCalls: 6 }),
    { loadSession, createJudge: fakeTransport(), write, progress, installSignals: false });
  assert.equal(first.exitCode, 3);
  assert.equal(first.summary.breaker, 'max_calls');
  assert.equal(first.summary.physicalCalls.attempted, 6, 'a physical call was admitted past the budget');
  assert.equal(first.summary.windows.finished, 1);
  assert.equal(Object.hasOwn(first.summary, 'coverage'), false, 'an unfinished run reports no verdict');
  assert.equal((await stat(capped)).mode & 0o777, 0o700);
  // The continuation finishes the review with the calls the first attempt did not make.
  const continued = await harness.runSessionReviewHarness(options(capped),
    { loadSession, createJudge: fakeTransport(), write, progress, installSignals: false });
  assert.equal(continued.exitCode, 0);
  // Six calls were admitted and answered, so six answers were stored: 16 - 6 are left to ask.
  assert.equal(continued.summary.physicalCalls.attempted, 10, 'the continuation re-asked only what was not stored');
  assert.deepEqual(continued.summary.windows, { total: 4, finished: 4, complete: 4, incomplete: 0, failed: 0, replayed: 1 });
  for (const field of ['coverage', 'sessionReview', 'decisions', 'findings', 'rejected', 'windowCompletion'])
    assert.ok(Object.hasOwn(continued.summary, field), `a finished run reports ${field}`);
  for (const field of ['sessionStatus', 'reviewStatus'])
    assert.ok(!Object.hasOwn(continued.summary, field), `D71 (a): a finished run reports no ${field}`);
  assert.deepEqual(continued.summary.attestation, { attested: 10, mismatch: 0, unattested: 0, unknown: 0 });
  assert.equal(continued.summary.servedModel, 'attested');
  const attempts = await readJson(join(capped, 'attempts.json'));
  assert.equal(attempts.length, 10);
  // M33 J: and each attempt's token counts, durations and rate limit — numbers and closed codes only. D70 (a): and the
  // context window the CLI reported, a count or null; D70 review (S0): and the CLI version, a SemVer normal version or null.
  // M44: and an accepted reply's closed shape, null when the transport reported none.
  assert.ok(attempts.every((a) => Object.keys(a).sort().join()
    === 'attestation,cliVersion,code,contextWindow,durationApiMs,durationMs,elapsedMs,inputBytes,ok,providerClass,rateLimit,'
      + 'replyShape,usage'), 'the private attempt log keeps closed fields only');
  assert.ok(attempts.every((a) => a.replyShape === null), 'this fake transport reports no reply shape');
  assert.equal((await stat(join(capped, 'attempts.json'))).mode & 0o777, 0o600);
  // A served-model mismatch: no further physical call is admitted — not even the transport retry
  // of the failed call, and not the window's challenge.
  const mismatch = await harness.runSessionReviewHarness(options(join(base, 'mismatch')), { loadSession, write, progress, installSignals: false,
    createJudge: fakeTransport({ metadata: (n) => (n === 1
      ? { ok: false, code: 'model_unavailable', attestation: 'mismatch', providerClass: 'identity_mismatch' }
      : { attestation: 'attested', providerClass: null }) }) });
  assert.equal(mismatch.summary.breaker, 'attestation_mismatch');
  assert.equal(mismatch.summary.physicalCalls.attempted, 1);
  assert.equal(mismatch.exitCode, 3);
  const billing = await harness.runSessionReviewHarness(options(join(base, 'billing')), { loadSession, write, progress, installSignals: false,
    createJudge: fakeTransport({ metadata: () => ({ ok: false, code: 'model_unavailable', providerClass: 'billing' }) }) });
  assert.equal(billing.summary.breaker, 'billing');
  assert.equal(billing.summary.physicalCalls.attempted, 1);
  assert.equal(billing.summary.attestation.unknown, 1, 'an absent attestation is unknown');
  // A recording that cannot be loaded is a failure of this attempt, never an earlier attempt's finish.
  const unloadable = await harness.runSessionReviewHarness(options(capped), { write, progress, installSignals: false,
    loadSession: async () => { throw new Error(`${SENTINEL} unreadable`); }, createJudge: fakeTransport() });
  assert.deepEqual([unloadable.exitCode, unloadable.summary.failure, unloadable.summary.state], [1, 'session_load_failed', null]);
  assert.equal(unloadable.summary.physicalCalls.attempted, 0);
  for (const text of [SENTINEL, 'SYNTHETIC', base]) {
    assert.ok(!stdout.includes(text), `stdout carries ${text}`);
    assert.ok(!stderr.includes(text), `stderr carries ${text}`);
  }
  for (const line of [...stdout.trim().split('\n'), ...stderr.trim().split('\n')]) JSON.parse(line);
  assert.equal((await stat(join(capped, 'summary.json'))).mode & 0o777, 0o600);
});

test('M33 the harness refuses a malformed command line with usage', () => {
  assert.equal(typeof harness.parseHarnessArgs, 'function');
  const good = ['--parent', 'p.jsonl', '--codex-home', 'h', '--out', 'o', '--backend', 'codex-cli', '--model', 'm',
    '--max-calls', '5', '--max-seconds', '60'];
  const parsed = harness.parseHarnessArgs(good);
  assert.deepEqual([parsed.maxCalls, parsed.maxSeconds, parsed.sessionKey, parsed.concurrency], [5, 60, 'session', 3]);
  for (const bad of [good.slice(2), [...good, '--concurrency', '4'], [...good, '--max-calls', '6'],
    good.map((v) => (v === '5' ? '-5' : v)), [...good, '--backend', 'anthropic-api'], [...good, 'extra']])
    assert.throws(() => harness.parseHarnessArgs(bad), (error) => error.code === 'usage');
});

// ---- M33 fix lane F1 (after the adversarial review of L1) -------------------------------------------------
const harnessOptions = (base, out, extra = {}) => ({ parent: join(base, 'SYNTHETIC.jsonl'), codexHome: base, out,
  backend: 'claude-cli', model: 'claude-synthetic-1', maxCalls: 1000, maxSeconds: 600, timeoutMs: 1000,
  sessionKey: 'session', concurrency: 1, ...extra });
const quiet = { write: () => {}, progress: () => {}, installSignals: false };
const ZERO_WINDOWS = { total: 0, finished: 0, complete: 0, incomplete: 0, failed: 0, replayed: 0 };
/** How many answers the harness's D60 store holds under `out`. */
async function storedAnswers(out) {
  try { return (await readdir(join(out, 'answers'))).filter((name) => /^[a-f0-9]{64}\.\d+\.json$/.test(name)).length; }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}
/** A createJudge that counts how often it was asked to build a transport. */
function countingFactory(factory = fakeTransport()) {
  const built = { count: 0 };
  return { built, createJudge: (args) => { built.count++; return factory(args); } };
}

test('M33 F1 the harness refuses a claude-cli model that cannot be attested; codex-cli stays allowed', async (t) => {
  const args = (backend, model) => ['--parent', 'p.jsonl', '--codex-home', 'h', '--out', 'o', '--backend', backend,
    '--model', model, '--max-calls', '5', '--max-seconds', '60'];
  for (const model of ['sonnet', 'opus', 'haiku', 'best', 'claude-sonnet', 'claude-sonnet-latest', 'Claude-sonnet-5']) {
    assert.equal(attestableModel(model), false, `premise: ${model} cannot be attested`);
    assert.throws(() => harness.parseHarnessArgs(args('claude-cli', model)), (error) => error.code === 'usage', model);
  }
  for (const model of ['claude-sonnet-5', 'claude-synthetic-1'])
    assert.equal(harness.parseHarnessArgs(args('claude-cli', model)).model, model);
  // codex-cli reports no served model at all: allowed, and its answers are recorded unattested.
  assert.equal(harness.parseHarnessArgs(args('codex-cli', 'sonnet')).model, 'sonnet');
  // A programmatic caller is held to the same rule: no directory, no transport, no call.
  const base = await directory(t, 'f1-alias');
  const out = join(base, 'out');
  const { built, createJudge } = countingFactory();
  let stdout = '';
  const refused = await harness.runSessionReviewHarness(harnessOptions(base, out, { model: 'sonnet' }),
    { ...quiet, write: (text) => { stdout += text; }, loadSession: async () => sessionOf(4), createJudge });
  assert.deepEqual([refused.summary.failure, refused.exitCode, built.count, refused.summary.physicalCalls.attempted],
    ['usage', 2, 0, 0]);
  assert.deepEqual([refused.summary.state, refused.summary.attempt, refused.summary.windows], [null, 0, ZERO_WINDOWS]);
  await assert.rejects(stat(out), { code: 'ENOENT' }, 'a refused command line touched the filesystem');
  assert.deepEqual(JSON.parse(stdout), refused.summary, 'one count-only summary line');
});

test('M33 F1 a claude-cli answer is admitted only when attested: a mismatch is never stored (p3)', async (t) => {
  const base = await directory(t, 'f1-mismatch');
  const loadSession = async () => sessionOf(4);
  const out = join(base, 'out');
  // p3: the transport RETURNS an answer (ok) whose served model is a mismatch. Run the documented
  // continuation again and again: it never finishes and nothing is ever stored.
  for (let run = 0; run < 3; run++) {
    const mismatch = await harness.runSessionReviewHarness(harnessOptions(base, out), { ...quiet, loadSession,
      createJudge: fakeTransport({ metadata: () => ({ ok: true, attestation: 'mismatch', providerClass: null }) }) });
    assert.equal(await storedAnswers(out), 0, `run ${run}: D60 stored a mismatched answer`);
    assert.equal(mismatch.summary.breaker, 'attestation_mismatch');
    assert.equal(mismatch.exitCode, 3);
    assert.equal(Object.hasOwn(mismatch.summary, 'coverage'), false, 'an unfinished run reports no verdict');
    assert.equal(mismatch.summary.servedModel, 'unknown', 'a refused answer is not a live answer');
    assert.equal(mismatch.summary.windows.finished, 0);
    assert.deepEqual(mismatch.summary.physicalCalls, { attempted: 1, returned: 1, ok: 1, refused: 1 },
      'the mismatched answer was admitted, or a further call was');
  }
  // With an attested transport every call is live: nothing from the mismatch attempts replays.
  const clean = await harness.runSessionReviewHarness(harnessOptions(base, out), { ...quiet, loadSession,
    createJudge: fakeTransport() });
  assert.deepEqual([clean.exitCode, clean.summary.state, clean.summary.windows.replayed, clean.summary.calls.reused],
    [0, 'finished', 0, 0]);
  assert.deepEqual(clean.summary.physicalCalls, { attempted: 16, returned: 16, ok: 16, refused: 0 });
  assert.equal(clean.summary.servedModel, 'attested');
  assert.equal(await storedAnswers(out), 16);
  // Unattested or unreported on claude-cli: refused as model_unavailable, never stored, and the
  // breaker does not trip — only `mismatch` trips attestation_mismatch.
  for (const [name, report] of [['unattested', { attestation: 'unattested' }], ['unreported', {}],
    ['outside the vocabulary', { attestation: 'SYNTHETIC_ATTESTATION' }]]) {
    const where = join(base, `refused-${name.replace(/ /g, '-')}`);
    const refused = await harness.runSessionReviewHarness(harnessOptions(base, where), { ...quiet, loadSession,
      createJudge: fakeTransport({ metadata: () => ({ ok: true, providerClass: null, ...report }) }) });
    assert.equal(refused.summary.breaker, null, `${name}: the breaker tripped`);
    assert.deepEqual(refused.summary.physicalCalls, { attempted: 8, returned: 8, ok: 8, refused: 8 },
      `${name}: each narrative and its one transport retry, each refused`);
    assert.deepEqual(refused.summary.windows, { total: 4, finished: 4, complete: 0, incomplete: 0, failed: 4, replayed: 0 });
    assert.equal(await storedAnswers(where), 0, `${name}: D60 stored a refused answer`);
    assert.equal(refused.summary.servedModel, 'unknown');
  }
});

test('M33 F1 the breaker trips on a non-retryable provider class and never on a transient one', async (t) => {
  const base = await directory(t, 'f1-classes');
  const loadSession = async () => sessionOf(4);
  for (const providerClass of PROVIDER_CLASSES) {
    const stops = NON_RETRYABLE_PROVIDER_CLASSES.includes(providerClass);
    const run = await harness.runSessionReviewHarness(harnessOptions(base, join(base, providerClass)), { ...quiet, loadSession,
      createJudge: fakeTransport({ metadata: () => ({ ok: false, code: 'model_unavailable', attestation: 'unattested', providerClass }) }) });
    assert.equal(run.summary.breaker, stops ? providerClass : null, providerClass);
    assert.equal(run.summary.physicalCalls.attempted, stops ? 1 : 8, `${providerClass}: calls admitted`);
    assert.deepEqual(run.summary.providerClass, { [providerClass]: stops ? 1 : 8 });
    assert.equal(run.exitCode, stops ? 3 : 0, providerClass);
  }
  // An identity failure reported as `mismatch` trips attestation_mismatch, whatever its class.
  const identity = await harness.runSessionReviewHarness(harnessOptions(base, join(base, 'identity')), { ...quiet, loadSession,
    createJudge: fakeTransport({ metadata: () => ({ ok: false, code: 'model_unavailable', attestation: 'mismatch',
      providerClass: 'identity_mismatch' }) }) });
  assert.deepEqual([identity.summary.breaker, identity.summary.physicalCalls.attempted], ['attestation_mismatch', 1]);
  // A class outside the vocabulary is recorded `unknown` and is transient.
  const outside = await harness.runSessionReviewHarness(harnessOptions(base, join(base, 'outside')), { ...quiet, loadSession,
    createJudge: fakeTransport({ metadata: () => ({ ok: false, code: 'model_unavailable', providerClass: 'SYNTHETIC_CLASS' }) }) });
  assert.deepEqual([outside.summary.breaker, outside.summary.providerClass], [null, { unknown: 8 }]);
});

test('M33 F1 admission reads each attempt\'s own attestation while calls overlap', async (t) => {
  const base = await directory(t, 'f1-overlap');
  const out = join(base, 'out');
  // Window 2's narrative reports first and returns last: the other windows' attested reports land
  // in between, so only the attempt's own report can refuse it.
  const odd = (request) => request.label === 'narrative:w2';
  const run = await harness.runSessionReviewHarness(harnessOptions(base, out, { concurrency: 3 }), { ...quiet,
    loadSession: async () => sessionOf(4),
    createJudge: fakeTransport({
      metadata: (n, request) => (odd(request) ? { ok: true, attestation: 'unattested', providerClass: null }
        : { attestation: 'attested', providerClass: null }),
      delay: { before: (request) => (odd(request) ? 0 : 10), after: (request) => (odd(request) ? 40 : 0) } }) });
  assert.equal(await storedAnswers(out), 12, 'only the three attested windows\' answers were stored');
  assert.deepEqual(run.summary.windows, { total: 4, finished: 4, complete: 3, incomplete: 0, failed: 1, replayed: 0 });
  assert.equal(run.summary.breaker, null);
  assert.equal(run.summary.physicalCalls.refused, 2, 'window 2\'s narrative and its retry');
  assert.equal(run.summary.servedModel, 'attested');
});

test('M33 F1 a codex-cli review is admitted unattested, and its summary and progress say so', async (t) => {
  const base = await directory(t, 'f1-codex');
  const loadSession = async () => sessionOf(4);
  const codex = (out, report) => harness.runSessionReviewHarness(harnessOptions(base, out,
    { backend: 'codex-cli', model: 'gpt-synthetic' }), { ...quiet, loadSession,
    createJudge: fakeTransport({ metadata: () => ({ ok: true, providerClass: null, ...report }) }) });
  const out = join(base, 'out');
  const run = await codex(out, { attestation: 'unattested' });
  assert.deepEqual([run.exitCode, run.summary.state, run.summary.servedModel], [0, 'finished', 'unattested']);
  assert.deepEqual(run.summary.attestation, { attested: 0, mismatch: 0, unattested: 16, unknown: 0 });
  assert.equal((await readJson(join(out, 'review', 'progress.json'))).servedModel, 'unattested');
  assert.equal(await storedAnswers(out), 16);
  // A codex answer reported as a mismatch, or with no attestation at all, is refused.
  const mismatch = await codex(join(base, 'mismatch'), { attestation: 'mismatch' });
  assert.deepEqual([mismatch.summary.breaker, mismatch.summary.physicalCalls.refused], ['attestation_mismatch', 1]);
  const unreported = await codex(join(base, 'unreported'), {});
  assert.equal(await storedAnswers(join(base, 'unreported')), 0, 'an answer with no attestation was stored');
  assert.deepEqual([unreported.summary.breaker, unreported.summary.physicalCalls.refused], [null, 8]);
});

test('M33 F1 an attempt that fails before writing its progress reports its own zero counts, never an earlier attempt\'s (p1)', async (t) => {
  const base = await directory(t, 'f1-stale');
  const loadSession = async () => sessionOf(4);
  for (const [name, firstExtra, firstState] of [['finished', {}, 'finished'], ['interrupted', { maxCalls: 6 }, 'interrupted']]) {
    const out = join(base, name);
    const first = await harness.runSessionReviewHarness(harnessOptions(base, out, firstExtra),
      { ...quiet, loadSession, createJudge: fakeTransport() });
    assert.deepEqual([first.summary.state, first.summary.attempt], [firstState, 1]);
    assert.ok(first.summary.windows.finished >= 1);
    // An unusable session: reviewSession takes the lock, then fails before this attempt's progress.
    let stdout = '';
    const second = await harness.runSessionReviewHarness(harnessOptions(base, out), { ...quiet,
      write: (text) => { stdout += text; }, loadSession: async () => null, createJudge: fakeTransport() });
    assert.deepEqual([second.exitCode, second.summary.failure, second.summary.state, second.summary.attempt],
      [1, 'review_failed', null, 0], `${name}: the failed attempt reported another attempt's state`);
    assert.deepEqual(second.summary.windows, ZERO_WINDOWS, `${name}: inherited window counts`);
    assert.deepEqual(second.summary.calls, { live: 0, reused: 0 }, `${name}: inherited call counts`);
    assert.equal(Object.hasOwn(second.summary, 'coverage'), false);
    assert.deepEqual(JSON.parse(stdout), second.summary);
    assert.deepEqual(await readJson(join(out, 'summary.json')), second.summary);
    // The store still holds the first attempt's progress: the next attempt is the second.
    const third = await harness.runSessionReviewHarness(harnessOptions(base, out), { ...quiet, loadSession,
      createJudge: fakeTransport() });
    assert.deepEqual([third.exitCode, third.summary.state, third.summary.attempt], [0, 'finished', 2]);
  }
});

test('M33 F1 a non-regular entry at a record name is moved aside inside the store, never deleted (p2)', async (t) => {
  const dir = await directory(t, 'f1-moved');
  await review(dir);
  const windows = join(dir, 'review', 'windows');
  const aside = join(windows, '.discarded');
  const target = (await recordByWindow(dir)).get(1);
  // A non-empty directory at the record's name: rmdir cannot remove it, and a rename cannot replace it.
  await rm(target.path);
  await mkdir(target.path, { mode: 0o700 });
  await writeFile(join(target.path, 'SYNTHETIC_KEPT'), 'SYNTHETIC', { mode: 0o600 });
  for (let run = 0; run < 2; run++) {
    const calls = [];
    const replay = await review(dir, { judge: honestJudge({ calls }) });
    assert.equal(calls.length, 0, 'a discard cost a call');
    assert.deepEqual(replay.progress.checkpoint, { recordsRead: 4, discarded: run === 0 ? { not_regular_file: 1 } : {},
      stateChanged: 0 }, `run ${run}`);
    assert.equal(replay.progress.windows.finished, 4);
    const info = await lstat(target.path);
    assert.ok(info.isFile() && (info.mode & 0o777) === 0o600, 'the record was written owner-only');
    assert.equal(await readFile(target.path, 'utf8'), target.bytes);
  }
  assert.equal((await lstat(aside)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(aside), [`${target.name}.0`]);
  assert.equal(await readFile(join(aside, `${target.name}.0`, 'SYNTHETIC_KEPT'), 'utf8'), 'SYNTHETIC', 'moved, never deleted');
  // A link to a directory outside the store takes the next free name; its target is untouched.
  const outside = await directory(t, 'f1-outside');
  await writeFile(join(outside, 'SYNTHETIC_OUTSIDE'), 'SYNTHETIC', { mode: 0o600 });
  await rm(target.path);
  await symlink(outside, target.path);
  const linked = await review(dir);
  assert.deepEqual(linked.progress.checkpoint.discarded, { not_regular_file: 1 });
  assert.deepEqual((await readdir(aside)).sort(), [`${target.name}.0`, `${target.name}.1`]);
  assert.ok((await lstat(join(aside, `${target.name}.1`))).isSymbolicLink());
  assert.deepEqual(await readdir(outside), ['SYNTHETIC_OUTSIDE']);
  assert.equal(await readFile(target.path, 'utf8'), target.bytes);
  assert.deepEqual(Object.keys(await recordsOf(dir)).length, 4);
});

test('G1 a discard area taken by something that is not a private directory never fails the run: the next free name is used', async (t) => {
  const dir = await directory(t, 'g1-discard-taken');
  await review(dir);
  const windows = join(dir, 'review', 'windows');
  const target = (await recordByWindow(dir)).get(1);
  // The repro: a non-regular entry at a record's name while `.discarded` is a regular file (and, here,
  // `.discarded-1` a link out of the store). Every later run used to reject checkpoint_failed.
  await rm(target.path);
  await mkdir(target.path, { mode: 0o700 });
  await writeFile(join(target.path, 'SYNTHETIC_KEPT'), 'SYNTHETIC', { mode: 0o600 });
  await writeFile(join(windows, '.discarded'), 'SYNTHETIC_PLANTED', { mode: 0o600 });
  const outside = await directory(t, 'g1-discard-outside');
  await symlink(outside, join(windows, '.discarded-1'));
  for (let run = 0; run < 2; run++) {
    const calls = [];
    const replay = await review(dir, { judge: honestJudge({ calls }) });
    assert.equal(calls.length, 0, `run ${run}: a discard cost a call`);
    assert.deepEqual(replay.progress.checkpoint, { recordsRead: 4, discarded: run === 0 ? { not_regular_file: 1 } : {},
      stateChanged: 0 }, `run ${run}`);
    assert.equal((await progressOf(dir)).state, 'finished', `run ${run}`);
    assert.equal(await readFile(target.path, 'utf8'), target.bytes, `run ${run}: the record was written`);
  }
  // Nothing already there was touched, followed or deleted; the entry was moved to the next free name.
  assert.equal(await readFile(join(windows, '.discarded'), 'utf8'), 'SYNTHETIC_PLANTED');
  assert.ok((await lstat(join(windows, '.discarded-1'))).isSymbolicLink());
  assert.deepEqual(await readdir(outside), [], 'nothing was moved through the link');
  const aside = join(windows, '.discarded-2');
  assert.equal((await lstat(aside)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(aside), [`${target.name}.0`]);
  assert.equal(await readFile(join(aside, `${target.name}.0`, 'SYNTHETIC_KEPT'), 'utf8'), 'SYNTHETIC', 'moved, never deleted');
  assert.equal(Object.keys(await recordsOf(dir)).length, 4);
  // A later move reuses the chosen area deterministically.
  await rm(target.path);
  await mkdir(target.path, { mode: 0o700 });
  assert.deepEqual((await review(dir)).progress.checkpoint.discarded, { not_regular_file: 1 });
  assert.deepEqual((await readdir(aside)).sort(), [`${target.name}.0`, `${target.name}.1`]);
});

test('M33 F1 --max-seconds and --timeout-ms must fit a timer: a longer one is usage, never an instant deadline (p4)', async (t) => {
  const good = ['--parent', 'p.jsonl', '--codex-home', 'h', '--out', 'o', '--backend', 'claude-cli', '--model', 'claude-sonnet-5',
    '--max-calls', '5'];
  assert.equal(harness.parseHarnessArgs([...good, '--max-seconds', '2147483']).maxSeconds, 2147483);
  for (const bad of ['2147484', '2500000', '9007199254740991', '0', '-1', '1.5', '1e3'])
    assert.throws(() => harness.parseHarnessArgs([...good, '--max-seconds', bad]), (error) => error.code === 'usage', bad);
  assert.equal(harness.parseHarnessArgs([...good, '--max-seconds', '60', '--timeout-ms', '2147483647']).timeoutMs, 2147483647);
  for (const bad of ['2147483648', '0'])
    assert.throws(() => harness.parseHarnessArgs([...good, '--max-seconds', '60', '--timeout-ms', bad]),
      (error) => error.code === 'usage', bad);
  // A programmatic caller: an out-of-range bound is refused before any timer, directory or call.
  const base = await directory(t, 'f1-timer');
  for (const extra of [{ maxSeconds: 2_500_000 }, { maxSeconds: 0 }, { timeoutMs: 2 ** 31 }, { maxCalls: 0 }, { concurrency: 4 }]) {
    const { built, createJudge } = countingFactory();
    const run = await harness.runSessionReviewHarness(harnessOptions(base, join(base, 'out'), extra),
      { ...quiet, loadSession: async () => sessionOf(4), createJudge });
    assert.deepEqual([run.summary.failure, run.summary.breaker, run.exitCode, built.count],
      ['usage', null, 2, 0], JSON.stringify(extra));
  }
  await assert.rejects(stat(join(base, 'out')), { code: 'ENOENT' });
});

test('M33 F1 runReview takes a precomputed plan only when it is the plan it would build itself', async () => {
  const session = sessionOf(4);
  const args = { session, reviewScope: 'session-only' };
  const plan = planWindowRequests(args);
  const bytes = (planned) => JSON.stringify(planned.requests.map((built) => ({ request: built.request, window: built.window,
    sourceMap: built.sourceMap, promptVersion: built.promptVersion, slice: built.slice })));
  assert.equal(bytes(plan), bytes(planWindowRequests(args)), 'the precomputed plan is byte-identical to a fresh one');
  const planned = await runReview({ ...args, pr: null, judge: honestJudge(), plan });
  const built = await runReview({ ...args, pr: null, judge: honestJudge() });
  assert.equal(JSON.stringify(planned), JSON.stringify(built));
  // A plan built for other inputs — another session object, another scope — or not built by
  // planWindowRequests at all is refused before any call.
  const calls = [];
  for (const other of [{ session: sessionOf(4), reviewScope: 'session-only' }, { session, reviewScope: 'combined' }])
    await assert.rejects(runReview({ ...other, pr: null, judge: honestJudge({ calls }), plan }), TypeError);
  await assert.rejects(runReview({ ...args, pr: null, judge: honestJudge({ calls }), plan: { ...plan } }), TypeError);
  assert.equal(calls.length, 0);
});

test('M33 F1 a link at a store directory\'s name is refused without tightening what it names', async (t) => {
  for (const at of ['review', join('review', 'windows', '.discarded')]) {
    const dir = await directory(t, 'f1-link');
    const outside = await directory(t, 'f1-link-target');
    await chmod(outside, 0o755);
    if (at !== 'review') {
      await review(dir);
      const target = (await recordByWindow(dir)).get(1);
      await rm(target.path);
      await mkdir(target.path, { mode: 0o700 });
    }
    await symlink(outside, join(dir, at));
    if (at === 'review') await assert.rejects(review(dir), code('owner_unsafe'), at);
    else {
      // M33 G1: a link where the discard area would be is skipped, never followed, and never fails the
      // run: the entry is moved aside to the next free private name.
      assert.deepEqual((await review(dir)).progress.checkpoint.discarded, { not_regular_file: 1 }, at);
      assert.ok((await lstat(join(dir, at))).isSymbolicLink(), `${at}: the link was replaced`);
      assert.equal((await readdir(join(dir, 'review', 'windows', '.discarded-1'))).length, 1, at);
    }
    assert.equal((await stat(outside)).mode & 0o777, 0o755, `${at}: the link's target was changed`);
    assert.deepEqual(await readdir(outside), [], `${at}: something was moved through the link`);
  }
});

test('M33 F1 admission follows the real claude-cli transport\'s own report of each attempt', async (t) => {
  // A fake `claude` child whose stream attests the requested model; its answer is not a narrative,
  // so every window fails its shape — but each answer was admitted, from its own attempt's report.
  const model = 'claude-synthetic-1';
  const stream = [{ type: 'system', subtype: 'init', model },
    { type: 'assistant', parent_tool_use_id: null, message: { model, content: [{ type: 'text', text: '{"value":1}' }] } },
    { type: 'result', subtype: 'success', is_error: false, api_error_status: null, result: '{"value":1}' }]
    .map((event) => `${JSON.stringify(event)}\n`).join('');
  let spawned = 0;
  const spawnProcess = () => {
    spawned++;
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    const close = (code) => { if (!closed) { closed = true; child.emit('close', code, null); } };
    child.kill = () => { setImmediate(() => close(null)); return true; };
    child.stdin.resume();
    child.stdin.on('end', () => setImmediate(() => { child.stdout.write(stream); setImmediate(() => close(0)); }));
    return child;
  };
  const base = await directory(t, 'f1-real');
  const run = await harness.runSessionReviewHarness(harnessOptions(base, join(base, 'out'), { model, concurrency: 3 }),
    { ...quiet, loadSession: async () => sessionOf(4),
      createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess }) });
  assert.equal(spawned, 4);
  assert.deepEqual(run.summary.physicalCalls, { attempted: 4, returned: 4, ok: 4, refused: 0 });
  assert.deepEqual([run.summary.breaker, run.summary.servedModel, run.summary.attestation.attested], [null, 'attested', 4]);
  assert.equal(run.summary.windows.failed, 4, 'premise: the answer is not a narrative');
});
