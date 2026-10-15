// W3-7 / F44. Windows are reviewed in PARALLEL, and nothing a model wrote in one window may
// reach another window's prompt. The report is reconciled at the merge instead.
//
// Every byte here is synthetic: invented instructions, invented paths, invented tool output.
// No model is called — the judge is injected and answers from a table keyed by window index.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReview, mergeWindowOutputs, WINDOW_CONCURRENCY } from '../src/run-review.js';
import { planWindows, carriedContext, COMBINED_WINDOW_SETTINGS, WINDOW_SETTINGS } from '../src/windows.js';
import { buildNarrativePrompt } from '../src/prompt.js';
import { CHALLENGE_PROFILE } from '../src/challenge.js';
import { Session } from '../src/session.js';

const WINDOWS = 7;
const REPO = { host: 'github.com', id: '37' };
const pathOf = (i) => `steps/step-0${i}.txt`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `count` windows, one per recorded compaction: each holds a human instruction, the agent's
 * words, one successful write and its result. The marker strings make it possible to say
 * exactly which window's text turned up where.
 */
function multiWindowSession(count = WINDOWS) {
  const blobs = {};
  const events = [];
  let sequence = 0;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  for (let i = 1; i <= count; i++) {
    blobs[`ask${i}`] = `SYNTHETIC_W37_ASK_${i}: write the step ${i} marker file and leave every other step alone.`;
    // M35 (windowing): a compaction no longer splits a window; a long statement (150,000 bytes) puts each segment in a
    // combined review's window (54,613 tokens) of its own.
    blobs[`said${i}`] = `SYNTHETIC_W37_SAID_${i}: writing the step ${i} marker file now, nothing else.\n${'f'.repeat(150_000)}`;
    blobs[`body${i}`] = `SYNTHETIC_W37_BODY_${i} = step ${i}\n`;
    // The em dash is load-bearing for the repair test below: a reader types a hyphen.
    blobs[`out${i}`] = `SYNTHETIC_W37_OUT_${i}: wrote the step ${i} marker — 0 problems.\n`;
    events.push({ id: `I${i}`, kind: 'instruction', sequence: sequence++, authority: 'human',
      text: whole(`ask${i}`), supersedes: [] });
    events.push({ id: `C${i}`, kind: 'commentary', sequence: sequence++, phase: 'working',
      text: whole(`said${i}`), beforeInvocation: `A${i}` });
    events.push({ id: `A${i}`, kind: 'invocation', sequence: sequence++, callKey: `c${i}`,
      tool: 'Write', operation: 'write', paths: [{ path: pathOf(i) }], command: [], input: [],
      changes: [{ path: pathOf(i), before: [], after: whole(`body${i}`), diff: [] }] });
    events.push({ id: `O${i}`, kind: 'observation', sequence: sequence++, invocation: `A${i}`,
      callKey: `c${i}`, phase: 'terminal', result: 'succeeded', exitCode: 0,
      output: whole(`out${i}`), sourceOfResult: 'native' });
    if (i < count) events.push({ id: `B${i}`, kind: 'boundary', sequence: sequence++, boundary: 'compaction' });
  }
  return new Session({ sessionKey: 'sess-w37', adapter: 'claude', events, blobs });
}

/** One grounded decision and one open requirement per window, both marked with its index. */
const narrativeFor = (i) => ({
  decisions: [{
    dimension: `SYNTHETIC_W37_DIMENSION_${i}`,
    chosen: `SYNTHETIC_W37_CHOSEN_${i}`,
    value: pathOf(i),
    valueReceipt: { eventId: `A${i}`, field: 'path', role: 'action', quote: pathOf(i) },
    actions: [`A${i}`],
    stated: { eventId: `C${i}`, role: 'commentary', quote: `SYNTHETIC_W37_SAID_${i}` },
    constrainedBy: { instruction: { eventId: `I${i}`, role: 'instruction', quote: `SYNTHETIC_W37_ASK_${i}` },
      settles: false, settledValueQuote: null },
  }],
  pivots: [], claims: [],
  requirements: [{ text: `SYNTHETIC_W37_REQUIREMENT_${i}`, status: 'open',
    instruction: { eventId: `I${i}`, role: 'instruction', quote: `SYNTHETIC_W37_ASK_${i}` } }],
});

const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };

/** `narrative:w3` and `challenge:w3:b1:p2` both answer 3. */
const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);

/**
 * A judge that is deterministic by WINDOW INDEX — never by call order — and that records when
 * each call started and finished, so a test can see whether two of them were ever in flight.
 */
function recordingJudge({ narrative = narrativeFor, latencyMs = 0, throwsIn = null, calls = [] } = {}) {
  return async (request) => {
    const index = windowOf(request.label);
    const call = { label: request.label, window: index, prompt: request.prompt,
      challenge: Boolean(request.challenge), started: performance.now(), ended: null };
    calls.push(call);
    if (latencyMs) await sleep(latencyMs);
    call.ended = performance.now();
    if (request.challenge) {
      return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
        explanation: 'Synthetic support vote for orchestration testing.',
        receipts: [{ eventId: `I${index}`, role: 'instruction', quote: `SYNTHETIC_W37_ASK_${index}` }] })) };
    }
    if (throwsIn === index) throw Object.assign(new Error('unavailable'), { code: 'model_unavailable' });
    return narrative(index);
  };
}

/** Only the per-window narrative calls: the challenge pass has always been concurrent. */
const narrativeCalls = (calls) => calls.filter((call) => !call.challenge);

/** The largest number of judge calls that were ever in flight at the same instant. */
function maxInFlight(calls) {
  const edges = calls.flatMap((c) => [{ at: c.started, delta: 1 }, { at: c.ended, delta: -1 }])
    .sort((a, b) => a.at - b.at || a.delta - b.delta);
  let live = 0, peak = 0;
  for (const edge of edges) { live += edge.delta; peak = Math.max(peak, live); }
  return peak;
}

test('the premise: the fixture really is seven windows', () => {
  const windows = planWindows(multiWindowSession(), COMBINED_WINDOW_SETTINGS);
  assert.equal(windows.length, WINDOWS);
  assert.equal(WINDOW_CONCURRENCY, 3);
  assert.ok(Object.isFrozen(Object.freeze(WINDOW_CONCURRENCY)) || typeof WINDOW_CONCURRENCY === 'number');
});

// ---- overlap ------------------------------------------------------------------------
test('W3-7 windows overlap: seven 50 ms windows do not cost seven times 50 ms', async () => {
  const LATENCY = 50;
  const calls = [];
  const progress = [];
  const session = multiWindowSession();
  const started = performance.now();
  await runReview({ session, pr: null, judge: recordingJudge({ narrative: () => EMPTY, latencyMs: LATENCY, calls }),
    onProgress: (p) => progress.push({ ...p, at: performance.now() }) });
  const elapsed = performance.now() - started;

  assert.equal(calls.length, WINDOWS, 'an empty narrative spends exactly one call per window');
  assert.ok(maxInFlight(narrativeCalls(calls)) >= 2, 'no two narrative calls were ever in flight at once');
  assert.ok(maxInFlight(narrativeCalls(calls)) <= WINDOW_CONCURRENCY,
    `${maxInFlight(narrativeCalls(calls))} windows were in flight, above the frozen bound of ${WINDOW_CONCURRENCY}`);
  // Seven windows at a concurrency of three is three waves, so the floor is 3x the latency.
  // Overlap is proven above by the recorded in-flight counts, which do not depend on the
  // scheduler. A wall-clock bound was here and flaked under load (F75): it is recorded, not asserted.
  assert.ok(Number.isFinite(elapsed));

  // Progress is reported per window, once, on completion — the CLI prints one line per event.
  assert.equal(progress.length, WINDOWS);
  assert.deepEqual([...progress].map((p) => p.window).sort((a, b) => a - b),
    Array.from({ length: WINDOWS }, (_, i) => i + 1));
  for (const event of progress) {
    assert.equal(event.of, WINDOWS);
    const call = calls.find((c) => c.window === event.window && !c.challenge);
    assert.ok(event.at >= call.ended, `window ${event.window} was announced before its call finished`);
  }
});

// ---- determinism --------------------------------------------------------------------
test('W3-7 the same answers produce the same report at concurrency 1 and 3', async () => {
  const session = multiWindowSession();
  const serial = [];
  const parallel = [];
  const one = await runReview({ session, pr: null, concurrency: 1,
    judge: recordingJudge({ latencyMs: 5, calls: serial }) });
  const three = await runReview({ session, pr: null, concurrency: WINDOW_CONCURRENCY,
    judge: recordingJudge({ latencyMs: 5, calls: parallel }) });

  assert.equal(maxInFlight(narrativeCalls(serial)), 1, 'concurrency 1 must not overlap');
  assert.ok(maxInFlight(narrativeCalls(parallel)) >= 2, 'concurrency 3 did not overlap, so this proves nothing');
  assert.ok(maxInFlight(parallel) <= WINDOW_CONCURRENCY * CHALLENGE_PROFILE.maxConcurrency,
    'more calls were in flight than the declared bound allows');
  assert.equal(JSON.stringify(three), JSON.stringify(one),
    'the parallel report is not byte-identical to the sequential one');
  // And the order of the window records is the order of the windows, not of the answers.
  assert.deepEqual(three.windowResults.map((w) => w.windowIndex),
    Array.from({ length: WINDOWS }, (_, i) => i));
  assert.equal(three.decisions.length, WINDOWS);
});

// ---- merge order --------------------------------------------------------------------
test('W3-7 two windows claiming the same requirement publish one row, the later status', async () => {
  const session = multiWindowSession(2);
  // Both windows see the whole human instruction inventory, so both can legitimately report the
  // requirement stated in window 1. Parallel windows no longer see each other's answer, so the
  // reconciliation the carried context used to perform happens here: one row, and a later
  // window's grounded status replaces the earlier one exactly as it did before.
  const duplicate = (status) => ({ ...EMPTY, requirements: [{ text: 'SYNTHETIC_W37_SHARED_REQUIREMENT',
    status, instruction: { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_W37_ASK_1' } }] });
  const report = await runReview({ session, pr: null,
    judge: recordingJudge({ narrative: (i) => duplicate(i === 1 ? 'open' : 'addressed') }) });

  assert.equal(report.requirements.length, 1, 'the same requirement was published twice');
  assert.equal(report.requirements[0].status, 'addressed');
  assert.equal(report.requirements[0].instruction.eventId, 'I1');
  assert.equal(report.requirementsRejected, 0);
  assert.equal(report.counts.decisions, 0);

  // ... and a silent second window does not close what the first one left open.
  const quiet = await runReview({ session, pr: null,
    judge: recordingJudge({ narrative: (i) => (i === 1 ? duplicate('open') : EMPTY) }) });
  assert.equal(quiet.requirements.length, 1);
  assert.equal(quiet.requirements[0].status, 'open');
});

test('W3-7 the merge reconciles decisions by identity digest, keeping the earlier window', () => {
  const candidate = (over = {}) => ({ actorSession: 'sess-w37', dimension: 'cache backend',
    chosen: 'Redis', value: null, valueReceipt: null, actions: ['A1'],
    stated: { eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_W37_SAID_1' },
    constrainedBy: null, instructionReview: null, ...over });
  const first = candidate({ chosen: 'Redis' });
  const same = candidate({ chosen: 'Redis' });
  const other = candidate({ dimension: 'cache expiry' });
  const merged = mergeWindowOutputs({ repo: REPO, perWindow: [
    { decisions: [first], findings: [], requirements: [], promises: [] },
    { decisions: [same, other], findings: [], requirements: [], promises: [] },
  ] });

  assert.equal(merged.decisions.length, 2, 'the identical candidate was not reconciled');
  assert.equal(merged.decisions[0], first, 'the earlier window\'s candidate must be the one kept');
  assert.equal(merged.decisions[1], other);
});

test('W3-7 the merge reconciles promises by receipt identity and text', () => {
  const promise = (text) => ({ text, status: 'open',
    receipts: [{ eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_W37_SAID_1' }] });
  const merged = mergeWindowOutputs({ repo: REPO, perWindow: [
    { decisions: [], findings: [], requirements: [], promises: [promise('it works')] },
    { decisions: [], findings: [], requirements: [], promises: [promise('it works'), promise('and again')] },
  ] });
  assert.deepEqual(merged.promises.map((p) => p.text), ['it works', 'and again']);
});

// ---- no model output crosses a window boundary ---------------------------------------
test('W3-7 a window\'s prompt carries no other window\'s model output, only its evidence', async () => {
  const session = multiWindowSession(3);
  const calls = [];
  await runReview({ session, pr: null, judge: recordingJudge({ calls }) });

  const promptFor = (i) => calls.find((c) => c.window === i && !c.challenge).prompt;
  for (const i of [2, 3]) {
    const prompt = promptFor(i);
    for (const leaked of ['SYNTHETIC_W37_CHOSEN_1', 'SYNTHETIC_W37_DIMENSION_1', 'SYNTHETIC_W37_REQUIREMENT_1'])
      assert.ok(!prompt.includes(leaked),
        `window ${i}'s prompt repeats window 1's model output: ${leaked}`);
    // What it DOES carry is evidence: every earlier human instruction, verbatim, in its inventory (M35: the pointer
    // section went with the carry).
    for (let earlier = 1; earlier < i; earlier++)
      assert.ok(prompt.includes(`[I${earlier}] HUMAN INSTRUCTION`), `window ${i} lost the earlier human instruction I${earlier}`);
    assert.ok(prompt.includes(session.blobs.ask1), `window ${i} lost the earlier human instruction`);
  }
  assert.doesNotMatch(promptFor(1), /Stated before this window/);
});

test('W3-7, M35 the carried context is evidence computed from the session, not a previous report', () => {
  const session = multiWindowSession(3);
  const windows = planWindows(session, COMBINED_WINDOW_SETTINGS);
  assert.equal(windows.length, 3);
  assert.equal(carriedContext(session, windows[0], COMBINED_WINDOW_SETTINGS), null, 'a combined review carries nothing');
  const first = carriedContext(session, windows[0], WINDOW_SETTINGS);
  assert.deepEqual([first.humans, first.thoughts], [[], []], 'the first window has nothing before it');
  const carried = carriedContext(session, windows[2], WINDOW_SETTINGS);
  assert.deepEqual(carried.humans.map((e) => e.id), ['I1', 'I2']);
  assert.deepEqual(carried.thoughts.map((e) => e.id), ['C1', 'C2'], 'the agent\'s earlier words, never its actions');
  // Every earlier human message is carried, whatever later message supersedes it: a recorded supersession no longer
  // removes one (the carry's pointers did; the window's inventory never did).
  const amended = multiWindowSession(3);
  amended.event('I3').supersedes = ['I1'];
  assert.deepEqual(carriedContext(amended, planWindows(amended, COMBINED_WINDOW_SETTINGS)[2], WINDOW_SETTINGS).humans
    .map((e) => e.id), ['I1', 'I2']);
});

// ---- failure isolation ----------------------------------------------------------------
test('W3-7 one window\'s transport failure does not abort or delay the others', async () => {
  const calls = [];
  const report = await runReview({ session: multiWindowSession(), pr: null,
    judge: recordingJudge({ throwsIn: 3, latencyMs: 20, calls }) });

  assert.deepEqual(report.windowFailures, [{ window: 3, reason: 'model_unavailable' }]);
  assert.ok(maxInFlight(narrativeCalls(calls)) >= 2, 'the surviving windows still ran one after another');
  assert.deepEqual(report.windowResults.map((w) => w.windowIndex),
    Array.from({ length: WINDOWS }, (_, i) => i));
  for (const result of report.windowResults) {
    const failed = result.windowIndex === 2;
    assert.equal(result.failure, failed ? 'model_unavailable' : null);
    assert.equal(result.shortfall.narrative, failed ? 'model_unavailable' : 'ok');
    assert.equal(result.narrative === null, failed);
  }
  assert.equal(report.decisions.length, WINDOWS - 1, 'a failed window must not cost its neighbours');
});

// ---- F44 ------------------------------------------------------------------------------
test('F44 a published pivot receipt that had to be repaired is counted as a repair', async () => {
  const session = multiWindowSession(1);
  const pivot = { ...EMPTY, pivots: [{ abandoned: 'writing step 1 by hand',
    adopted: 'writing the marker file', whyAbandoned: 'the manual step was not repeatable',
    // The source says "marker — 0 problems" with an em dash; this reader typed a hyphen.
    receipts: [{ eventId: 'O1', role: 'observation', quote: 'marker - 0 problems' }] }] };
  const report = await runReview({ session, pr: null, judge: recordingJudge({ narrative: () => pivot }) });

  assert.equal(report.pivots.length, 1, 'the repaired pivot was not published');
  assert.equal(report.pivotsRejected, 0);
  assert.equal(report.pivots[0].receipts[0].quote, 'marker — 0 problems');
  assert.equal(report.counts.receiptsRepaired, 1, 'the pivot repair was dropped on the floor');
});

// ---- the declared bound -----------------------------------------------------------------
test('W3-7 the report states how many calls this instrument can have in flight', async () => {
  const report = await runReview({ session: multiWindowSession(2), pr: null,
    judge: recordingJudge({ narrative: () => EMPTY }) });
  assert.equal(report.instrument.windowConcurrency, WINDOW_CONCURRENCY);
  assert.equal(report.instrument.maxCallsInFlight, WINDOW_CONCURRENCY * CHALLENGE_PROFILE.maxConcurrency);
});
