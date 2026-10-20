// M33 (C-07 "Window checkpoints and resumable session review"). `runReview` plans every request
// before any judge call, refuses an ambiguous plan, stops admitting windows after an abort, and
// awaits a per-window hook that receives closed codes and counts only. Nothing here touches a
// filesystem, a clock or a model: the judge is injected and answers from a table keyed by window.
//
// Every byte here is synthetic: invented instructions, paths and tool output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as runReviewModule from '../src/run-review.js';
import * as ledger from '../src/ledger.js';
import { Session } from '../src/session.js';
import { MAX_REVIEW_INPUT_BYTES } from '../src/challenge.js';
import { WINDOW_REQUEST_MAX_BYTES } from '../src/windows.js';
import { canonicalJson } from '../contracts/canonical.js';

const { runReview, WINDOW_INCOMPLETE_REASONS, TRANSPORT_SHORTFALL, windowIncompleteReasons } = runReviewModule;
const { JUDGE_FAILURE_CODES } = ledger;
const SENTINEL = 'SYNTHETIC_M33_SENTINEL_QUOTE';
const STATES = ['complete', 'incomplete', 'failed'];
const HOOK_KEYS = ['failure', 'finished', 'of', 'reasons', 'request', 'state', 'transport', 'window'];
const pathOf = (i) => `notes/step-${i}.txt`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
async function until(predicate, what, ms = 2000) {
  const end = performance.now() + ms;
  while (!predicate()) {
    if (performance.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(2);
  }
}

/** `count` windows split at compactions; each has an instruction carrying the sentinel, the
 *  agent's words, one write and its result. `huge` appends one commentary too large to send. */
function sessionOf(count = 4, { huge = false } = {}) {
  const blobs = {};
  const events = [];
  let sequence = 0;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  for (let i = 1; i <= count; i++) {
    blobs[`ask${i}`] = `${SENTINEL}_${i}: write the step ${i} marker file and nothing else.`;
    blobs[`said${i}`] = `SYNTHETIC_M33_SAID_${i}: writing the step ${i} marker file now.`;
    blobs[`body${i}`] = `SYNTHETIC_M33_BODY_${i} = ${i}\n`;
    blobs[`out${i}`] = `SYNTHETIC_M33_OUT_${i}: wrote the step ${i} marker.\n`;
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
    // M35 (windowing): a compaction no longer splits a window. A log read in 55 parts, each trimmed to 2k tokens in its
    // window (396,000 bytes of current work, never carried), puts each segment in a window of its own.
    blobs.log = 'y'.repeat(8_000);
    events.push({ id: `L${i}`, kind: 'invocation', sequence: sequence++, callKey: `l${i}`, tool: 'Bash',
      operation: 'command', paths: [], command: [], input: [], changes: [] });
    for (let k = 0; k < 55; k++) events.push({ id: `L${i}-r${k}`, kind: 'observation', sequence: sequence++,
      invocation: `L${i}`, callKey: `l${i}`, phase: 'progress', result: 'succeeded', exitCode: null, output: whole('log'),
      sourceOfResult: 'native' });
    if (i < count || huge) events.push({ id: `B${i}`, kind: 'boundary', sequence: sequence++, boundary: 'compaction' });
  }
  if (huge) {
    // M35: too large to send under a session-only review's bound (WINDOW_REQUEST_MAX_BYTES) too.
    blobs.huge = `SYNTHETIC_M33_HUGE ${'z'.repeat(WINDOW_REQUEST_MAX_BYTES + 1024)}`;
    events.push({ id: 'CH', kind: 'commentary', sequence: sequence++, phase: 'working', text: whole('huge') });
  }
  return new Session({ sessionKey: 'sess-m33', adapter: 'claude', events, blobs });
}

const narrativeFor = (i, checklist = false) => ({
  decisions: [{
    dimension: `SYNTHETIC_M33_DIMENSION_${i}`, chosen: `SYNTHETIC_M33_CHOSEN_${i}`, value: pathOf(i),
    valueReceipt: { eventId: `A${i}`, field: 'path', role: 'action', quote: pathOf(i) },
    actions: [`A${i}`],
    stated: { eventId: `C${i}`, role: 'commentary', quote: `SYNTHETIC_M33_SAID_${i}` },
    constrainedBy: { instruction: { eventId: `I${i}`, role: 'instruction', quote: `${SENTINEL}_${i}` },
      settles: false, settledValueQuote: null },
  }],
  pivots: [], claims: [],
  // D71 (S2): a session-only answer's checklist status (ledger.js REQUIREMENT_STATUSES); a combined answer's legacy one.
  requirements: [{ text: `SYNTHETIC_M33_REQUIREMENT_${i}`, status: checklist ? 'not-checked' : 'open',
    instruction: { eventId: `I${i}`, role: 'instruction', quote: `${SENTINEL}_${i}` } }],
});

const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);

/** Deterministic by window index, never by call order. `before` may act on a call first. */
function honestJudge({ calls = [], latency = () => 0, before = null, votes = null, narrative = narrativeFor } = {}) {
  return async (request) => {
    const call = { label: request.label, request, window: windowOf(request.label) };
    calls.push(call);
    if (before) await before(request, call);
    const ms = latency(request);
    if (ms) await sleep(ms);
    const index = call.window;
    if (request.challenge) {
      if (votes) return votes(index, request);
      return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
        explanation: 'Synthetic support vote for checkpoint testing.',
        receipts: [{ eventId: `I${index}`, role: 'instruction', quote: `${SENTINEL}_${index}` }] })) };
    }
    return narrative(index, request.prompt.startsWith('# Checklist for window '));
  };
}

const run = (options) => runReview({ pr: null, reviewScope: 'session-only', ...options });

// ---- the hook is awaited per lane ------------------------------------------------------------
test('M33 the finishing lane awaits onWindowFinished before admitting another window (concurrency 1)', async () => {
  const calls = [];
  const gate = deferred(), hooked = deferred();
  const hooks = [];
  const review = run({ session: sessionOf(3), concurrency: 1, judge: honestJudge({ calls }),
    onWindowFinished: async (event) => {
      hooks.push(event.window);
      if (event.window === 1) { hooked.resolve(); await gate.promise; }
    } });
  await Promise.race([hooked.promise, review.then(() => assert.fail('the run ended without calling the hook'))]);
  await sleep(30);
  assert.equal(calls.filter((c) => c.window === 2).length, 0, 'window 2 was admitted while window 1\'s hook was pending');
  gate.resolve();
  await review;
  assert.deepEqual(hooks, [1, 2, 3]);
  assert.ok(calls.some((c) => c.window === 2));
});

test('M33 a pending hook holds only its own lane: the other lanes keep admitting (concurrency 3)', async () => {
  const calls = [];
  const gate = deferred();
  const hooks = [];
  const review = run({ session: sessionOf(5), concurrency: 3, judge: honestJudge({ calls }),
    onWindowFinished: async (event) => {
      hooks.push(event.window);
      if (event.window === 1) await gate.promise;
    } });
  let ended = false;
  review.then(() => { ended = true; }, () => { ended = true; });
  await until(() => hooks.length >= 5 || ended, 'the other lanes to finish windows 2-5');
  assert.equal(ended, false, 'the run ended while window 1\'s hook was still pending');
  assert.deepEqual([...hooks].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.ok(calls.some((c) => c.window === 5), 'another lane admitted window 5 while window 1\'s hook was pending');
  gate.resolve();
  await review;
});

// ---- the hook payload is closed ----------------------------------------------------------------
test('M33 the hook receives closed codes, counts and the in-process request only', async () => {
  const calls = [];
  const events = [];
  const session = sessionOf(4);
  await run({ session, judge: honestJudge({ calls }), onWindowFinished: (event) => { events.push(event); } });
  assert.equal(events.length, 4);
  assert.deepEqual(events.map((e) => e.finished), [1, 2, 3, 4], 'finished counts windows finished so far');
  assert.deepEqual([...events.map((e) => e.window)].sort(), [1, 2, 3, 4]);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), HOOK_KEYS, 'the hook payload has exactly the contract\'s keys');
    assert.equal(event.of, 4);
    assert.ok(Number.isSafeInteger(event.window) && event.window >= 1 && event.window <= event.of);
    assert.ok(STATES.includes(event.state));
    assert.ok(Array.isArray(event.reasons) && event.reasons.every((r) => WINDOW_INCOMPLETE_REASONS.includes(r)));
    assert.deepEqual(event.reasons, WINDOW_INCOMPLETE_REASONS.filter((r) => event.reasons.includes(r)), 'vocabulary order');
    assert.ok(event.failure === null || JUDGE_FAILURE_CODES.includes(event.failure) || event.failure === 'unreviewed_scope');
    assert.ok(event.transport === null || TRANSPORT_SHORTFALL.includes(event.transport));
    const sent = calls.find((c) => c.label === `narrative:w${event.window}`);
    assert.equal(event.request, sent.request, 'the request is the object that was sent');
    assert.ok(event.request.prompt.includes(SENTINEL), 'premise: the request carries the sentinel');
    const { request, ...closed } = event;
    const bytes = JSON.stringify(closed);
    for (const text of [SENTINEL, 'SYNTHETIC_M33', 'narrative:w', pathOf(event.window)])
      assert.ok(!bytes.includes(text), `the hook payload carries ${text}`);
  }
  assert.ok(events.every((e) => e.state === 'complete' && e.failure === null && e.reasons.length === 0),
    'premise: the honest answers complete every window');
});

// ---- a hook rejection -----------------------------------------------------------------------------
test('M33 a hook rejection stops admission and rejects with checkpoint_failed and no report', async () => {
  const calls = [];
  const progress = [];
  const review = run({ session: sessionOf(4), concurrency: 1, judge: honestJudge({ calls }),
    onProgress: (p) => progress.push(p.window),
    onWindowFinished: async (event) => {
      if (event.window === 2) throw Object.assign(new Error(`${SENTINEL} private text`), { code: 'SYNTHETIC_OTHER' });
    } });
  await assert.rejects(review, (error) => {
    assert.equal(error.code, 'checkpoint_failed');
    assert.equal(error.message, 'checkpoint_failed', 'a run error carries its code and no other text');
    return true;
  });
  assert.equal(calls.filter((c) => c.window >= 3).length, 0, 'a window was admitted after the hook rejected');
  assert.deepEqual(progress, [1], 'a window whose record failed is not announced');
});

test('M33 after a hook rejection the windows already in flight finish, and no new one starts', async () => {
  const calls = [];
  const review = run({ session: sessionOf(5), concurrency: 3,
    judge: honestJudge({ calls, latency: (request) => (windowOf(request.label) === 1 ? 0 : 25) }),
    onWindowFinished: async (event) => { if (event.window === 1) throw new Error('synthetic'); } });
  await assert.rejects(review, { code: 'checkpoint_failed' });
  for (const n of [2, 3]) {
    assert.ok(calls.some((c) => c.label === `narrative:w${n}`), `window ${n} was in flight`);
    assert.equal(calls.filter((c) => c.window === n && c.request.challenge).length, 3,
      `window ${n} did not finish its challenge passes`);
  }
  assert.equal(calls.filter((c) => c.window >= 4).length, 0, 'a new window started after the hook rejected');
});

// ---- cancellation -------------------------------------------------------------------------------------
test('M33 a review aborted before it starts makes no call and rejects with review_interrupted', async () => {
  const calls = [];
  const hooks = [];
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(run({ session: sessionOf(3), judge: honestJudge({ calls }), signal: controller.signal,
    onWindowFinished: (e) => { hooks.push(e.window); } }), (error) => {
    assert.equal(error.code, 'review_interrupted');
    assert.equal(error.message, 'review_interrupted');
    return true;
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(hooks, []);
});

for (const concurrency of [1, 3]) {
  test(`M33 an abort mid-review: no judge call after it, late windows are never announced (concurrency ${concurrency})`, async () => {
    const calls = [];
    const hooks = [];
    const progress = [];
    const controller = new AbortController();
    let callsAtAbort = null;
    const judge = honestJudge({ calls, latency: () => 2, before: (request) => {
      if (request.label === 'narrative:w2') { controller.abort(); callsAtAbort = calls.length; }
    } });
    await assert.rejects(run({ session: sessionOf(5), concurrency, judge, signal: controller.signal,
      onProgress: (p) => progress.push({ window: p.window, aborted: controller.signal.aborted }),
      onWindowFinished: (e) => { hooks.push({ window: e.window, aborted: controller.signal.aborted }); } }),
    { code: 'review_interrupted' });
    assert.ok(callsAtAbort !== null, 'premise: the abort happened');
    assert.equal(calls.length, callsAtAbort, 'a judge call was made after the abort');
    assert.ok(hooks.every((h) => h.aborted === false), 'a window that resolved after the abort was announced');
    assert.ok(progress.every((p) => p.aborted === false), 'progress was reported for a window resolved after the abort');
    if (concurrency === 1) assert.deepEqual(hooks.map((h) => h.window), [1]);
  });
}

// ---- state mapping ---------------------------------------------------------------------------------------
test('M33 the hook state is derived exactly as windowCompletion derives it, including unreviewed_scope', async () => {
  const calls = [];
  const events = [];
  const judge = honestJudge({ calls,
    before: (request) => {
      if (request.label === 'narrative:w2')
        throw Object.assign(new Error('synthetic'), { code: 'model_timeout', transportClass: 'timeout' });
    },
    // Window 3's challengers vote on nothing, so its items stay unresolved after the re-ask.
    votes: (index, request) => (index === 3 ? { votes: [] }
      : { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
        explanation: 'Synthetic support vote.', receipts: [{ eventId: `I${index}`, role: 'instruction', quote: `${SENTINEL}_${index}` }] })) }) });
  const report = await run({ session: sessionOf(3, { huge: true }), judge, onWindowFinished: (e) => { events.push(e); } });
  assert.equal(report.windowResults.length, 4, 'premise: three windows and one too large to send');
  const byWindow = new Map(events.map((e) => [e.window, e]));
  assert.deepEqual([...byWindow.keys()].sort(), [1, 2, 3, 4]);
  assert.deepEqual({ ...byWindow.get(1), request: null }, { ...byWindow.get(1), request: null,
    state: 'complete', reasons: [], failure: null, transport: null });
  assert.equal(byWindow.get(2).state, 'failed');
  assert.equal(byWindow.get(2).failure, 'model_timeout');
  assert.equal(byWindow.get(2).transport, 'timeout');
  assert.equal(byWindow.get(3).state, 'incomplete');
  assert.equal(byWindow.get(3).failure, null);
  assert.ok(byWindow.get(3).reasons.length > 0 && byWindow.get(3).reasons.every((r) => r.startsWith('challenge:')),
    'an unvoted challenge leaves the window incomplete for a challenge reason');
  assert.equal(byWindow.get(4).state, 'failed');
  assert.equal(byWindow.get(4).failure, 'unreviewed_scope');
  assert.deepEqual(byWindow.get(4).reasons, ['narrative:budget']);
  assert.equal(calls.filter((c) => c.window === 4).length, 0, 'a request too large to send made a call');
  for (const [n, event] of byWindow) {
    const result = report.windowResults[n - 1];
    assert.deepEqual(event.reasons, windowIncompleteReasons(result), `window ${n} reasons`);
    assert.equal(event.failure, result.failure);
    assert.equal(event.transport, result.shortfall.transport);
  }
  const completion = report.instrument.windowCompletion;
  assert.equal(events.filter((e) => e.state === 'complete').length, completion.complete);
  assert.equal(events.filter((e) => e.state === 'failed').length, report.windowFailures.length);
});

// ---- the plan ----------------------------------------------------------------------------------------------
test('M33 planWindowRequests builds exactly the bytes runReview sends, and builds them the same way twice', async () => {
  assert.equal(typeof runReviewModule.planWindowRequests, 'function', 'planWindowRequests is exported');
  for (const reviewScope of ['session-only', 'combined']) {
    const session = sessionOf(4);
    const plan = runReviewModule.planWindowRequests({ session, reviewScope });
    const again = runReviewModule.planWindowRequests({ session, reviewScope });
    const calls = [];
    await runReview({ session, pr: null, reviewScope, judge: honestJudge({ calls }) });
    const sent = calls.filter((c) => !c.request.challenge).sort((a, b) => a.window - b.window)
      .map((c) => [c.label, c.request.system, c.request.prompt]);
    const planned = (p) => p.requests.map(({ request }) => [request.label, request.system, request.prompt]);
    assert.equal(sent.length, 4);
    assert.deepEqual(planned(plan), sent, `${reviewScope}: the plan is what was sent`);
    assert.deepEqual(planned(again), sent, `${reviewScope}: planning is deterministic`);
    assert.equal(plan.windows.length, 4);
  }
});

// ---- identity guard --------------------------------------------------------------------------------------------
test('M33 an evidence prompt that is a prefix of another, or a repeated request, is ambiguous', () => {
  const ambiguous = runReviewModule.ambiguousRequestIdentity;
  assert.equal(typeof ambiguous, 'function', 'the identity guard is exported');
  const request = (prompt, evidencePrompt, system = 'SYNTHETIC_SYSTEM') => ({ system, prompt, evidencePrompt });
  assert.equal(ambiguous([request('p1', 'ab'), request('p2', 'abc')]), true, '"ab" is a prefix of "abc"');
  assert.equal(ambiguous([request('p1', 'abc'), request('p2', 'ab')]), true, 'in either order');
  assert.equal(ambiguous([request('p1', 'ab'), request('p2', 'zz'), request('p3', 'abc')]), true, 'with a string between');
  assert.equal(ambiguous([request('p1', 'ab]'), request('p2', 'ab}')]), false, '"ab]" and "ab}" are distinct and prefix-free');
  assert.equal(ambiguous([request('p1', 'x'), request('p2', 'x')]), true, 'an identical evidence prompt');
  assert.equal(ambiguous([request('p', 'x'), request('p', 'y')]), true, 'an identical narrative request');
  assert.equal(ambiguous([request('p', 'x', 'S1'), request('p', 'y', 'S2')]), false, 'another system is another request');
  assert.equal(ambiguous([]), false);
});

test('M33, M35 an ambiguous plan is refused; the windowing makes none: two helpers saying the same words differ by name', async () => {
  // The guard: two requests with the same bytes, or an evidence prompt that is a prefix of another, are ambiguous.
  const request = { system: 's', prompt: 'p', evidencePrompt: 'e' };
  assert.equal(runReviewModule.ambiguousRequestIdentity([request, { ...request }]), true);
  assert.equal(runReviewModule.ambiguousRequestIdentity([request, { ...request, prompt: 'q', evidencePrompt: 'e and more' }]), true);
  assert.equal(runReviewModule.ambiguousRequestIdentity([request, { ...request, prompt: 'q', evidencePrompt: 'f' }]), false);
  // M35: a window names events by its own aliases, so two helpers that said exactly the same words would render the same
  // evidence but for the line that names each helper (prompt.js `helperSessionLine`). M36 phase 3 (D68 K): small sessions
  // share a window, so these say enough (120k tokens each) to need a window apiece.
  const blobs = { said: `SYNTHETIC_M33_DUP: the same recorded words twice.\n${'d'.repeat(432_000)}` };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const session = new Session({ sessionKey: 'sess-m33-dup', adapter: 'claude', blobs, events: [
    { id: 'C0', kind: 'commentary', phase: 'working', sequence: 0, text: whole('said') },
    { id: 'child:a:C1', childId: 'a', kind: 'commentary', phase: 'working', sequence: 1, text: whole('said') },
    { id: 'child:b:C1', childId: 'b', kind: 'commentary', phase: 'working', sequence: 2, text: whole('said') },
  ] });
  const plan = runReviewModule.planWindowRequests({ session, reviewScope: 'session-only' });
  assert.equal(plan.requests.length, 3);
  assert.equal(runReviewModule.ambiguousRequestIdentity(plan.requests.map((built) => built.request)), false);
  const calls = [];
  await run({ session, judge: honestJudge({ calls }), plan });
  assert.ok(calls.length >= 3, 'reviewed, never refused');
});


// ---- continuation --------------------------------------------------------------------------------------------------
/** Answers by (exact bytes, occurrence), like the CLI's D60 store, in memory. */
function replaying(judge, store) {
  const asked = new Map();
  let live = 0;
  const memo = async (request) => {
    const bytes = JSON.stringify([request.system, request.prompt]);
    const occurrence = asked.get(bytes) ?? 0;
    asked.set(bytes, occurrence + 1);
    const key = `${bytes}#${occurrence}`;
    if (store.has(key)) return structuredClone(store.get(key));
    live++;
    const answer = await judge(request);
    store.set(key, structuredClone(answer));
    return answer;
  };
  Object.defineProperty(memo, 'live', { get: () => live });
  return memo;
}

test('M33 an interrupted review continued with its stored answers reports what an uninterrupted one reports', async () => {
  const store = new Map();
  const controller = new AbortController();
  const first = replaying(honestJudge({ latency: () => 2, before: (request) => {
    if (request.label === 'narrative:w3') controller.abort();
  } }), store);
  const hooks = [];
  await assert.rejects(run({ session: sessionOf(5), judge: first, signal: controller.signal,
    onWindowFinished: (e) => { hooks.push(e.window); } }), { code: 'review_interrupted' });
  assert.ok(store.size > 0, 'premise: the interrupted attempt stored answers');
  const continued = replaying(honestJudge(), store);
  const resumed = await run({ session: sessionOf(5), judge: continued, signal: new AbortController().signal,
    onWindowFinished: () => {} });
  const whole = await run({ session: sessionOf(5), judge: honestJudge() });
  assert.ok(continued.live > 0 && continued.live < store.size, 'premise: the continuation replayed some answers');
  assert.equal(JSON.stringify(resumed), JSON.stringify(whole));
});

test('M33 a signal that never fires and a hook that records nothing leave the report byte-identical', async () => {
  const plain = await run({ session: sessionOf(4), judge: honestJudge() });
  const hooked = await run({ session: sessionOf(4), judge: honestJudge(), signal: new AbortController().signal,
    onWindowFinished: async () => { await sleep(1); } });
  assert.equal(JSON.stringify(hooked), JSON.stringify(plain));
  assert.equal(Object.hasOwn(hooked.instrument, 'resume'), false, 'the evidence package adds no report field');
});

// ---- profile and vocabulary --------------------------------------------------------------------------------------------
test('M33 the run profile is frozen plain data that binds the review\'s closed vocabularies', () => {
  const { runProfile } = runReviewModule;
  assert.equal(typeof runProfile, 'function', 'runProfile is exported');
  const profile = runProfile('session-only');
  // M33 (C-06 "M33 per-part verdicts"): the bounded re-ask of an unreadable proposal is part of the call graph.
  // M35 (windowing): the windowing profile replaces the segmentation profile and M33 X's carry bounds.
  // M36 phase 3 (D68 Q): a session-only window's evidence requests and their frozen bounds.
  // D70 review (S0): the model a claude-cli review asks by default is no member of the profile (run-review.js
  // SESSION_REVIEW_CLAUDE_CLI_MODEL), so the window checkpoint's digest is the review's alone.
  // D87: the code pass's member (its versions and closed vocabularies), whether or not a review runs the pass.
  // D101: the checklist's quote gate (its reasons, causes, places and quote bounds), so a change to any recomputes.
  // D102: the rule an evidence re-ask's answer is merged with the first by, by name.
  assert.deepEqual(Object.keys(profile).sort(), ['challenge', 'codePass', 'evidenceMerge', 'evidenceRequests',
    'grounding', 'judgeFailureCodes', 'maxInputBytes', 'narrativeSchema', 'promptVersion', 'proposalReasks',
    'reviewAgent', 'reviewScope', 'windowIncompleteReasons', 'windowing']);
  assert.deepEqual(profile.grounding, { reasons: { requirements: [...ledger.REQUIREMENT_UNCHECKED_REASONS],
    failures: [...ledger.FAILURE_UNCHECKED_REASONS] }, causes: [...ledger.GROUNDING_CAUSES],
  lengthCauses: [...ledger.GROUNDING_LENGTH_CAUSES], anchorCauses: [...ledger.GROUNDING_ANCHOR_CAUSES],
  places: [...ledger.QUOTE_PLACES],
  limits: JSON.parse(JSON.stringify(ledger.QUOTE_LIMITS)) });
  assert.equal(Object.hasOwn(runProfile('combined'), 'grounding'), false, 'the combined route has no checklist');
  assert.equal(profile.evidenceMerge, 'later-copy-unless-code-lowers');
  assert.equal(Object.hasOwn(runProfile('combined'), 'evidenceMerge'), false, 'a combined review asks no evidence again');
  // The code step: its versions moved, step 1's to /2. The review of the code step: to /3. Its
  // second review: to /4. Its third: to /5. The second release review: to /6. The agentic code step (D90): step 1 is
  // retired (no `check`), the review agent is code-pass/7 and its checking agents code-verify/1. A file changed since
  // the session, shown: code-pass/8. The cleanup (nothing held): code-pass/9 and code-verify/2. The triage (D96):
  // code-pass/10, the tier table bound. The owner's answers of 2026-10-17: code-pass/11, the dossier leaves out a command
  // refused before it ran. D105: code-pass/12, one request, one bound, a manifest. D110: code-verify/3, the premise
  // contract, and the tier table /2. D114 (0.3.0-beta.5): code-pass/13 and code-verify/4, the listed asks; D113: the
  // snapshot /13, the session's own change.
  assert.equal(Object.hasOwn(profile.codePass, 'check'), false);
  assert.deepEqual([profile.codePass.pass, profile.codePass.verify, profile.codePass.snapshot],
    ['sonah.code-pass/13', 'sonah.code-verify/4', 'sonah.code-snapshot/13']);
  // E1-F8 (D112): the tier table's /2 carried a refused read's default too, in D110's move. D122 (b) (0.3.0-beta.5): /3,
  // that default removed.
  assert.equal(profile.codePass.triage.table, 'sonah.tiers/3');
  assert.equal(profile.proposalReasks, 1);
  assert.deepEqual(profile.evidenceRequests, { reasks: 1, items: 8, bytes: 72_000, parsed: 256 });
  assert.equal(profile.reviewScope, 'session-only');
  assert.deepEqual(profile.windowIncompleteReasons, [...WINDOW_INCOMPLETE_REASONS]);
  assert.deepEqual(profile.judgeFailureCodes, [...JUDGE_FAILURE_CODES]);
  assert.equal(profile.maxInputBytes, WINDOW_REQUEST_MAX_BYTES, 'M35: a session-only review\'s bound');
  assert.equal(runProfile('combined').maxInputBytes, MAX_REVIEW_INPUT_BYTES);
  const frozen = (value) => value === null || typeof value !== 'object'
    || (Object.isFrozen(value) && Object.values(value).every(frozen));
  assert.ok(frozen(profile), 'the profile is deeply frozen');
  assert.equal(canonicalJson(runProfile('session-only')), canonicalJson(profile), 'the same profile every time');
  assert.notEqual(canonicalJson(runProfile('combined')), canonicalJson(profile), 'the review scope is bound');
  assert.throws(() => runProfile('SYNTHETIC_SCOPE'), RangeError);
});

test('M33 run failures are a closed vocabulary beside, never inside, the window failure codes', async () => {
  const { RUN_FAILURE_CODES } = ledger;
  assert.deepEqual(RUN_FAILURE_CODES, ['review_identity_ambiguous', 'review_interrupted', 'checkpoint_failed']);
  assert.ok(Object.isFrozen(RUN_FAILURE_CODES));
  for (const code of RUN_FAILURE_CODES) assert.ok(!JUDGE_FAILURE_CODES.includes(code), `${code} is a judge failure code`);
  // Read off the table, never re-typed at a call site.
  const source = await readFile(new URL('../src/run-review.js', import.meta.url), 'utf8');
  for (const code of RUN_FAILURE_CODES) assert.ok(!source.includes(`'${code}'`), `run-review.js spells ${code} out`);
  const table = await readFile(new URL('../src/ledger.js', import.meta.url), 'utf8');
  for (const code of RUN_FAILURE_CODES) assert.equal(table.split(`'${code}'`).length - 1, 1, `ledger.js declares ${code} once`);
  assert.deepEqual(runReviewModule.WINDOW_STATES, STATES);
  assert.ok(Object.isFrozen(runReviewModule.WINDOW_STATES));
});
