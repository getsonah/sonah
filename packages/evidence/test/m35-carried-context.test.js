// M35 windowing (C-07 "M35 windowing"): what crosses a window boundary is the carried context — the active task, every
// earlier human message and every earlier agent thought of the window's own session, never an earlier action or
// result. It replaces M33 X's carry (`sonah.carry`), whose cross-window tests these take over:
//   - a claim made in an earlier window is a carried thought, so a result of a later window contradicts it (DECIDE) or
//     confirms it (one verified promise), and a carried statement proposed again with nothing of its window bearing on it
//     is not published twice (`carriedRepeats`);
//   - an earlier result is never carried, so a claim in a later window is never compared with it (by the spec's design) —
//     M36 phase 3 (owner decision D68 F): but for a PROVEN failure (a typed failed status), carried with its action;
//   - G01: a contradiction or support cited by its command's action id is moved to the action's one result (kept).
//
// Synthetic sessions and judges only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import * as reviewRun from '../src/run-review.js';
import { bytesOfTokens } from '../src/windows.js';

const KEY = 'sess-m35-carried';
const PROFILES = [undefined, 'm33-lean'];
const profileName = (p) => p ?? 'standard';

const TEXT = {
  ask: 'SYNTHETIC_X_ASK: make the parser suite pass and report back.',
  ask2: 'SYNTHETIC_X_ASK2: continue where you left off.',
  run: 'node --test /srv/x/parser.test.js',
  failOut: 'SYNTHETIC_X_FAIL: ℹ fail 2\nnot ok 3 - parser handles nested input',
  claim: 'SYNTHETIC_X_CLAIM: All parser tests pass and the change is complete.',
  early: 'SYNTHETIC_X_EARLY: The parser suite passes now; moving on to the docs.',
  rerun: 'node --test /srv/x/parser.test.js --test-reporter=spec',
  rerunOut: 'SYNTHETIC_X_RERUN: ✖ parser handles nested input (3.1ms)',
  rerunOut2: 'SYNTHETIC_X_RERUN2: ✖ parser handles nested input (2.9ms)',
  lint: 'node /srv/x/lint.js',
  lintOut: 'SYNTHETIC_X_LINT: 0 warnings, 0 errors',
  lintSaid: 'SYNTHETIC_X_LINT_SAID: The lint is clean.',
  cat: 'cat /srv/x/big.log',
  big: 'y'.repeat(bytesOfTokens(3_000)),
  bigThought: `SYNTHETIC_X_THINKING: ${'z'.repeat(bytesOfTokens(100_000))}`,
};
const CLAIM_QUOTE = 'All parser tests pass and the change is complete.';
const EARLY_QUOTE = 'The parser suite passes now';

/**
 * A session from `rows`: [id, kind, blobKey, extra]. Kinds: ask, cmd (a Bash command), out (its result; extra.of names
 * the command, extra.failed makes it fail), said (the agent's words; extra.phase), filler (60 results of a `cat`, each
 * trimmed to 2k tokens in its window: 120k tokens of current work that no window carries). `extra.child` places the
 * event in helper `w`'s session, launched by `D1`.
 */
function build(rows) {
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
  const events = [];
  for (const [id, kind, key, extra = {}] of rows) {
    const where = extra.child ? { childId: 'w', turn: 'child:w:T1' } : { turn: extra.turn ?? 'T1' };
    if (kind === 'filler') {
      events.push({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [], command: ref('cat'),
        input: [], changes: [], ...where });
      for (let k = 0; k < 60; k++) events.push({ id: `${id}-r${k}`, kind: 'observation', invocation: id, callKey: id,
        phase: 'progress', result: 'succeeded', exitCode: null, output: ref('big'), sourceOfResult: 'native', ...where });
    } else if (kind === 'ask') events.push({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(key), ...where });
    else if (kind === 'brief') events.push({ id, kind: 'instruction', authority: 'agent', supersedes: [], text: ref(key), ...where });
    else if (kind === 'delegate') events.push({ id, kind: 'invocation', callKey: id, tool: 'Task', operation: 'delegate',
      paths: [], command: [], input: ref(key), changes: [], ...where });
    else if (kind === 'cmd') events.push({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
      command: ref(key), input: [], changes: [], ...where });
    else if (kind === 'out') events.push({ id, kind: 'observation', invocation: extra.of, callKey: extra.of, phase: 'terminal',
      result: extra.failed ? 'failed' : 'succeeded', exitCode: extra.failed ? 1 : 0, terminalStatusProven: true,
      output: ref(key), sourceOfResult: 'native', ...where });
    else events.push({ id, kind: 'commentary', phase: extra.phase ?? 'working', beforeInvocation: null, text: ref(key), ...where });
  }
  const children = rows.some(([, kind]) => kind === 'delegate') ? [{ assignmentEvent: 'D1', childId: 'w',
    childSession: `${KEY}/child:w`, sessionKey: `${KEY}/child:w`, relation: 'spawn', state: 'verified', historyStart: null }] : [];
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...TEXT },
    events: events.map((event, sequence) => ({ ...event, sequence })), children });
}
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const narrativeOf = (claims = [], extra = {}) => ({ decisions: [], pivots: [], requirements: [],
  claims: structuredClone(claims), ...structuredClone(extra) });
const ownReceipt = ({ candidate }) => candidate.contradictedBy ?? candidate.supportedBy ?? candidate.stated
  ?? candidate.instruction ?? candidate.receipts?.[0];
const decided = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status);

/**
 * A judge that READS its window: the narrative for window `index` (0-based) is `answers[index](request)`, proposing a
 * cross-window claim only when the window was supplied the evidence for it (its source map, by stable id). Every
 * challenge vote is an honest not-refuted vote citing the item's own receipt. Answers name stable ids: an id no alias
 * names passes through unchanged.
 */
function readingJudge(answers, seen = []) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return narrativeOf(...(answers[request.window.index]?.(request) ?? [[]]));
    return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.',
      receipts: [ownReceipt(item)] })) };
  };
}
const run = async (session, answers, speedProfile, seen = []) => {
  const plan = reviewRun.planWindowRequests({ session, reviewScope: 'session-only', ...(speedProfile ? { speedProfile } : {}) });
  const supplied = new Map(plan.requests.map(({ window, sourceMap }) => [window.index, sourceMap]));
  const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', plan,
    ...(speedProfile ? { speedProfile } : {}), judge: readingJudge(answers.map((answer) => answer
      && ((request) => answer({ ...request, supplied: supplied.get(request.window.index) }))), seen) });
  return report;
};
const has = (request, id) => Object.hasOwn(request.supplied, id);

/** (b) The claim in window 1, a contradicting result in window 2: the claim is carried, the result is the window's. */
const claimThenFail = () => build([['I1', 'ask', 'ask'], ['C1', 'said', 'early', { phase: 'final' }], ['F1', 'filler'],
  ['I2', 'ask', 'ask2', { turn: 'T2' }], ['F2', 'filler', 'cat', { turn: 'T2' }], ['A2', 'cmd', 'rerun', { turn: 'T2' }],
  ['A2-r', 'out', 'rerunOut', { of: 'A2', failed: true, turn: 'T2' }]]);
const claimThenFailAnswers = [() => [[]], (request) => [has(request, 'C1') && has(request, 'A2-r')
  ? [{ text: 'The agent said the parser suite passes.', stated: receipt('C1', 'commentary', EARLY_QUOTE),
    contradictedBy: receipt('A2-r', 'observation', '✖ parser handles nested input') }] : []]];

test('M35 premise: two windows, split by size alone (a compaction splits nothing)', () => {
  const plan = reviewRun.planWindowRequests({ session: claimThenFail(), reviewScope: 'session-only' });
  assert.deepEqual(plan.windows.map((w) => w.segments.map((s) => s.start)), [['I1'], ['I2']]);
  assert.deepEqual(plan.requests[1].context.thoughts.map((e) => e.id), ['C1'], 'the claim is carried');
  assert.ok(!Object.hasOwn(plan.requests[1].sourceMap, 'F1-r0') && !Object.hasOwn(plan.requests[1].sourceMap, 'F1'),
    'an earlier action and its results are never carried');
});

for (const speedProfile of PROFILES) {
  test(`M35 ${profileName(speedProfile)}: a claim in window 1 and a contradicting result in window 2 publish DECIDE`, async () => {
    const seen = [];
    const report = await run(claimThenFail(), claimThenFailAnswers, speedProfile, seen);
    assert.deepEqual(decided(report), ['DECIDE']);
    assert.equal(report.sessionStatus, 'DECIDE');
    const finding = report.findings.find((f) => f.kind === 'claim_contradicted');
    assert.deepEqual(finding.receipts.map((r) => r.eventId), ['C1', 'A2-r']);
    const narrative2 = seen.find((request) => request.label === 'narrative:w2');
    assert.ok(narrative2.prompt.includes('## Carried context: earlier in this session'));
  });
}

test('M35, M36 F: an earlier result is carried only when it is a proven failure: a failing run in window 1 contradicts a claim in window 2', async () => {
  // M35: no earlier action or result was carried. Owner decision D68 (F), M36 phase 3: every earlier PROVEN failure of
  // the session (a result the recorder typed as failed) is carried, its action beside it, so a claim in window 2 that it
  // contradicts is DECIDE. A passing earlier result is still never carried.
  const session = build([['I1', 'ask', 'ask'], ['A1', 'cmd', 'run'], ['A1-r', 'out', 'failOut', { of: 'A1', failed: true }],
    ['A0', 'cmd', 'lint'], ['A0-r', 'out', 'lintOut', { of: 'A0' }],
    ['F1', 'filler'], ['I2', 'ask', 'ask2', { turn: 'T2' }], ['F2', 'filler', 'cat', { turn: 'T2' }],
    ['C2', 'said', 'claim', { phase: 'final', turn: 'T2' }]]);
  const plan = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' });
  assert.ok(Object.hasOwn(plan.requests[1].sourceMap, 'A1-r') && Object.hasOwn(plan.requests[1].sourceMap, 'A1'));
  assert.ok(!Object.hasOwn(plan.requests[1].sourceMap, 'A0-r'), 'a passing earlier result is never carried');
  const report = await run(session, [() => [[]], (request) => [has(request, 'A1-r')
    ? [{ text: 'All pass.', stated: receipt('C2', 'commentary', CLAIM_QUOTE),
      contradictedBy: receipt('A1-r', 'observation', 'not ok 3 - parser handles nested input') }] : []]]);
  assert.deepEqual(decided(report), ['DECIDE'], 'window 2 was carried the earlier failure, so it contradicts the claim');
  assert.equal(report.counts.carried.failures, 1);
});

for (const speedProfile of PROFILES) {
  test(`M35 ${profileName(speedProfile)}: a claim in piece 1 of a segment confirmed by a result in piece 2 is one verified promise`, async () => {
    // One segment (one turn) over the budget, cut before its second thought: the claim is carried into piece 2.
    const session = build([['I1', 'ask', 'ask'], ['C1', 'said', 'lintSaid', { phase: 'working' }], ['F1', 'filler'],
      ['C1b', 'said', 'bigThought'], ['A5', 'cmd', 'lint'], ['A5-r', 'out', 'lintOut', { of: 'A5' }]]);
    const LINT = { text: 'The agent said the lint is clean.', stated: receipt('C1', 'commentary', 'The lint is clean.') };
    const report = await run(session, [
      (request) => [has(request, 'C1') ? [{ ...LINT, contradictedBy: null }] : []],
      (request) => [has(request, 'A5-r') && has(request, 'C1')
        ? [{ ...LINT, contradictedBy: null, supportedBy: receipt('A5-r', 'observation', '0 warnings, 0 errors') }] : []],
    ], speedProfile);
    assert.equal(report.windowResults.length, 2);
    assert.equal(report.promises.length, 1, 'one promise for one statement');
    assert.deepEqual(report.promises[0].receipts.map((r) => r.eventId), ['C1', 'A5-r']);
    assert.deepEqual(decided(report), []);
  });
}

test('M35 a carried statement re-proposed with nothing of its window bearing on it is not published twice', async () => {
  const session = claimThenFail();
  const claim = { text: 'The agent said the parser suite passes.', stated: receipt('C1', 'commentary', EARLY_QUOTE), contradictedBy: null };
  const report = await run(session, [() => [[claim]], () => [[{ ...claim, text: 'The agent claimed the parser passes.' }]]]);
  assert.equal(report.promises.length, 1, 'the earlier window publishes it; the later one does not repeat it');
  assert.equal(report.promises[0].text, 'The agent said the parser suite passes.');
  assert.equal(report.counts.carriedRepeats, 1);
  assert.deepEqual(report.windowResults.map((w) => w.carried?.thoughts ?? null), [0, 1]);
});

test('M35 a helper is its own session: its failure is never carried into the parent\'s later window', () => {
  // M36 phase 3 (D68 K): the small helper shares its parent's first window, as its own part; (F) its proven failure is
  // its own session's — never carried into the parent's later window (it rides back only beside a report its parent
  // received, and this parent recorded none).
  const session = build([['I1', 'ask', 'ask'], ['D1', 'delegate', 'ask'], ['B1', 'brief', 'ask', { child: true }],
    ['W1', 'cmd', 'run', { child: true }], ['W1-r', 'out', 'failOut', { of: 'W1', failed: true, child: true }],
    ['WC', 'said', 'claim', { child: true }], ['F1', 'filler'], ['I2', 'ask', 'ask2', { turn: 'T2' }],
    ['F2', 'filler', 'cat', { turn: 'T2' }], ['C2', 'said', 'claim', { turn: 'T2' }]]);
  const plan = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' });
  assert.deepEqual(plan.windows.map((w) => w.parts.map((part) => [part.session.childId, part.events[0].id])),
    [[[null, 'I1'], ['w', 'B1']], [[null, 'I2']]]);
  assert.deepEqual(plan.requests[1].context.thoughts.map((e) => e.id), [], 'the helper\'s statement is the helper\'s');
  assert.deepEqual(plan.requests[1].context.failures, [], 'and so is its failure');
  assert.ok(!Object.hasOwn(plan.requests[1].sourceMap, 'WC') && !Object.hasOwn(plan.requests[1].sourceMap, 'W1-r'));
});

// ---- G01 (kept from M33 X): a contradiction or support cited by its command's action id ------------------------------

/** One window: a failing run, then the claim. */
const g01 = () => build([['I1', 'ask', 'ask'], ['A1', 'cmd', 'run'], ['A1-r', 'out', 'failOut', { of: 'A1', failed: true }],
  ['C2', 'said', 'claim', { phase: 'final' }]]);
const G01_CLAIM = { text: 'The agent said all parser tests pass.', stated: receipt('C2', 'commentary', CLAIM_QUOTE),
  contradictedBy: receipt('A1', 'observation', 'not ok 3 - parser handles nested input') };

for (const speedProfile of PROFILES) {
  test(`M33 X G01 ${profileName(speedProfile)}: contradictedBy citing the command's action id is moved to its one result — DECIDE`, async () => {
    const seen = [];
    const report = await run(g01(), [() => [[G01_CLAIM]]], speedProfile, seen);
    assert.deepEqual(decided(report), ['DECIDE']);
    assert.equal(report.sessionStatus, 'DECIDE');
    const finding = report.findings.find((f) => f.kind === 'claim_contradicted');
    assert.deepEqual(finding.receipts.map((r) => [r.eventId, r.role]), [['C2', 'commentary'], ['A1-r', 'observation']]);
    assert.equal(report.counts.eventRepairedReceipts, 1, 'counted');
    const asked = seen.find((request) => request.challenge);
    assert.equal(asked.challenge.items[0].candidate.contradictedBy.eventId, 'A1-r', 'the challengers are asked about the result');
  });
}

test('M33 X G01: no repair when the action has two results, or the quote is not in its result', async () => {
  const two = build([['I1', 'ask', 'ask'], ['A1', 'cmd', 'run'], ['A1-r', 'out', 'failOut', { of: 'A1', failed: true }],
    ['A1-r2', 'out', 'rerunOut', { of: 'A1', failed: true }], ['C2', 'said', 'claim', { phase: 'final' }]]);
  const twice = await run(two, [() => [[G01_CLAIM]]]);
  assert.deepEqual(decided(twice), []);
  assert.equal(twice.counts.eventRepairedReceipts ?? 0, 0);
  const elsewhere = await run(g01(), [() => [[{ ...G01_CLAIM, contradictedBy: receipt('A1', 'observation', TEXT.run) }]]]);
  assert.deepEqual(decided(elsewhere), [], 'a quote of the command itself is not its result');
  assert.equal(elsewhere.counts.eventRepairedReceipts ?? 0, 0);
});

test('M33 X G01: supportedBy citing the command\'s action id is moved to its one result — verified', async () => {
  const session = build([['I1', 'ask', 'ask'], ['C1', 'said', 'lintSaid', { phase: 'working' }], ['A5', 'cmd', 'lint'],
    ['A5-r', 'out', 'lintOut', { of: 'A5' }]]);
  const report = await run(session, [() => [[{ text: 'The agent said the lint is clean.',
    stated: receipt('C1', 'commentary', 'The lint is clean.'), contradictedBy: null,
    supportedBy: receipt('A5', 'observation', '0 warnings, 0 errors') }]]]);
  assert.equal(report.promises.length, 1);
  assert.equal(report.promises[0].status, 'verified');
  assert.deepEqual(report.promises[0].receipts.map((r) => r.eventId), ['C1', 'A5-r']);
  assert.equal(report.counts.eventRepairedReceipts, 1);
});
