// M33 (C-06 "M33 session verdict", owner decision 2026-09-29). The session status separates a
// review that did not COMPLETE (UNCHECKED) from a completed review of a recording that has declared
// limits (NO_FINDINGS). NO_FINDINGS is never complete evidence. D71 (a) (owner decision 2026-10-08:
// no verdict anywhere the human sees): the statuses stay internal to the report; the rendered review
// shows none — it says whether the session review completed, and names every declared cause of the
// partial coverage with its count.
//
// Every session here is synthetic, and no model is called: the judge is a stub that answers every
// window with an empty narrative — the best case a real session can reach.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { runReview } from '../src/run-review.js';
import * as ledger from '../src/ledger.js';
import { coverageCauses, COVERAGE_SENTENCE } from '../src/review.js';
import { PUBLIC_RUN_WORDS } from '../../github/publication.js';
import { redisPivotSession } from '../fixtures/redis-pivot.js';

const { buildLedger, honestStatuses, sessionCoverageFacts, coverageFrom, reduceStatus } = ledger;

const repo = { host: 'github.com', id: '1' };
const completePr = { repo, number: 1, enumeration: 'complete',
  files: [{ path: 'src/app.js', change: 'modified', contentState: 'complete' }] };
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const quiet = async () => ({ ...EMPTY });
const FYI = Object.freeze({ id: 'f-fyi', origin: 'session-review', kind: 'shortcut', status: 'FYI',
  title: 'Synthetic disclosed shortcut', explanation: 'Synthetic.', receipts: [], scope: 'session-effect', anchor: null });
const DECIDE = Object.freeze({ ...FYI, id: 'f-decide', status: 'DECIDE' });
const CODE_FYI = Object.freeze({ ...FYI, id: 'c-fyi', origin: 'code-review', kind: 'code_issue', scope: 'current-code' });

const TEXT = {
  ask: 'SYNTHETIC_M33_VERDICT_ASK: run the synthetic checks and hand the docs to a helper.',
  cmd: 'npm test',
  out: 'SYNTHETIC_M33_VERDICT_OUT: 3 passed',
  brief: 'SYNTHETIC_M33_VERDICT_BRIEF: write the synthetic docs page.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];

/** One human instruction, one command with its proven result, optionally a hand-off. */
function session({ delegate = false, children = [], omitted = false, redacted = false } = {}) {
  return new Session({ sessionKey: 's', blobs: { ...TEXT }, children, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask'),
      ...(omitted ? { omitted: true } : {}), ...(redacted ? { redacted: true } : {}) },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Bash', operation: 'command',
      paths: [], command: whole('cmd'), input: [], changes: [] },
    { id: 'A1-r', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native' },
    ...(delegate ? [{ id: 'D1', kind: 'invocation', sequence: 3, callKey: 'd1', tool: 'Task',
      operation: 'delegate', paths: [], command: [], input: whole('brief'), changes: [] }] : []),
  ] });
}

/** A recording in the slicer's ledger shape whose recorder cut a write body (adapter gap). */
const clippedBody = () => sessionFromLedger({ ask: [{ turn: 1, text: TEXT.ask }], ledger: [
  { turn: 1, seq: 0, kind: 'test', cmd: 'npm test', outcome: 'passed', exitCode: 0, exitCodeSource: 'native', tailLines: ['ok'] },
  { turn: 1, seq: 1, kind: 'edit', path: 'docs/synthetic.md', via: 'Write',
    after: { text: 'a: 1\n[… truncated at 12000 chars …]', truncated: true, lines: 2 } }] }, { sessionKey: 's' });

// An action and its result too large to share one window under the byte-budget splitter: a declared pair gap
// (`input_limit`) before M35. M35 windowing trims each to 2k tokens and keeps them in one piece, so it is no longer one.
function splitPair() {
  const blobs = { ask: 'SYNTHETIC_M33_VERDICT_PAIR: run the command and check its result.',
    command: 'x'.repeat(300_000), output: 'y'.repeat(300_000) };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  return new Session({ sessionKey: 's', blobs, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', text: ref('ask'), supersedes: [] },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'c1', tool: 'Bash', operation: 'command',
      paths: [], command: ref('command'), input: [], changes: [] },
    { id: 'O1', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'c1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: ref('output'), sourceOfResult: 'native' }] });
}

// Every recorder limit C-06 names: adapter gaps, elided or withheld instructions and unlinked
// delegations. Each alone leaves a completed review at partial coverage. (A declared pair gap was one until M35
// windowing, which never cuts an action from its result: `splitPair` below.)
const RECORDER_LIMITS = {
  'an unlinked delegation': () => session({ delegate: true }),
  'a delegation whose child link is missing': () => session({ delegate: true, children: [{ assignmentEvent: 'D1', state: 'missing' }] }),
  'an instruction the recorder elided': () => session({ omitted: true }),
  'an instruction redaction withheld': () => session({ omitted: true, redacted: true }),
  'an adapter gap (a clipped write body)': clippedBody,
};

const reviewSessionOnly = (s, judge = quiet) => runReview({ session: s, pr: null, reviewScope: 'session-only', judge });

// ---- the closed vocabulary -------------------------------------------------------------------

test('M33 PublicStatus is a frozen closed list that includes NO_FINDINGS', () => {
  assert.deepEqual([...ledger.PUBLIC_STATUSES], ['DECIDE', 'FYI', 'CLEAN', 'NO_FINDINGS', 'UNCHECKED']);
  assert.ok(Object.isFrozen(ledger.PUBLIC_STATUSES));
  assert.deepEqual([...ledger.STATUS_PRECEDENCE], ['DECIDE', 'UNCHECKED', 'FYI', 'NO_FINDINGS', 'CLEAN']);
  assert.ok(Object.isFrozen(ledger.STATUS_PRECEDENCE));
  assert.deepEqual([...ledger.SESSION_REVIEW_COMPLETION], ['complete', 'incomplete']);
  assert.ok(Object.isFrozen(ledger.SESSION_REVIEW_COMPLETION));
  // D71 (a): no headline per status any more — only whether Sonah's own review ran, and neither reads as a pass.
  assert.deepEqual([...ledger.REVIEW_RUN_STATES], ['complete', 'incomplete', 'failed']);
  assert.ok(Object.isFrozen(ledger.REVIEW_RUN_STATES));
  // The words a reader says it in (the PR comment's and its check's, PUBLIC_RUN_WORDS).
  assert.deepEqual(Object.keys(PUBLIC_RUN_WORDS).sort(), ['complete', 'incomplete']);
  for (const sentence of Object.values(PUBLIC_RUN_WORDS))
    assert.doesNotMatch(sentence, /clean|approv|ready|complete enough|DECIDE|FYI|NO_FINDINGS|UNCHECKED/i);
});

// ---- the table itself ------------------------------------------------------------------------

test('M33 reduceSessionStatus is the C-06 session table, row by row', () => {
  const reduce = ledger.reduceSessionStatus;
  for (const review of ['complete', 'incomplete'])
    for (const coverage of ['complete', 'partial', 'missing'])
      assert.equal(reduce([FYI, DECIDE], coverage, review), 'DECIDE', `DECIDE, ${review}, ${coverage}`);
  assert.equal(reduce([FYI], 'complete', 'complete'), 'FYI');
  assert.equal(reduce([FYI], 'partial', 'complete'), 'FYI', 'a completed review keeps its FYI over partial coverage');
  assert.equal(reduce([], 'complete', 'complete'), 'CLEAN');
  assert.equal(reduce([], 'partial', 'complete'), 'NO_FINDINGS');
  for (const coverage of ['complete', 'partial', 'missing']) {
    assert.equal(reduce([], coverage, 'incomplete'), 'UNCHECKED', `none, incomplete, ${coverage}`);
    assert.equal(reduce([FYI], coverage, 'incomplete'), 'UNCHECKED', `FYI, incomplete, ${coverage}`);
  }
  assert.equal(reduce([], 'missing', 'complete'), 'UNCHECKED', 'missing coverage never reads complete');
  assert.equal(reduce([FYI], 'missing', 'complete'), 'UNCHECKED');
  // Fails closed on anything outside the closed vocabularies.
  assert.equal(reduce([], 'partial', 'done'), 'UNCHECKED');
  assert.equal(reduce([], 'partial'), 'UNCHECKED');
  assert.equal(reduce([], 'mostly', 'complete'), 'UNCHECKED');
});

test('M33 codeStatus keeps the original C-06 table and never reads NO_FINDINGS', () => {
  assert.equal(reduceStatus([DECIDE], 'partial'), 'DECIDE');
  assert.equal(reduceStatus([FYI], 'complete'), 'FYI');
  assert.equal(reduceStatus([FYI], 'partial'), 'UNCHECKED');
  assert.equal(reduceStatus([], 'complete'), 'CLEAN');
  assert.equal(reduceStatus([], 'partial'), 'UNCHECKED');
  assert.equal(reduceStatus([], 'missing'), 'UNCHECKED');
  // Joined to a completed session review over partial evidence, the code side is unchanged.
  const facts = { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1, reviewableEvents: 3,
    instructions: 1, instructionsElided: 1, instructionsWithheld: 0, delegationsUnlinked: 0, adapterGaps: 0, declared: null };
  for (const [codeCoverage, codeFindings, codeStatus] of [['complete', [], 'CLEAN'], ['partial', [], 'UNCHECKED'],
    ['missing', [], 'UNCHECKED'], ['complete', [CODE_FYI], 'FYI'], ['partial', [CODE_FYI], 'UNCHECKED']]) {
    const honest = honestStatuses({ findings: codeFindings, coverageFacts: facts, codeCoverage });
    assert.equal(honest.sessionStatus, 'NO_FINDINGS');
    assert.equal(honest.codeStatus, codeStatus, `code ${codeCoverage} with ${codeFindings.length} finding(s)`);
  }
});

test('M33 a combined review reduces DECIDE > UNCHECKED > FYI > NO_FINDINGS > CLEAN, for every pair', () => {
  const S = ledger.PUBLIC_STATUSES;
  for (const a of S) for (const b of S) {
    const expected = ledger.STATUS_PRECEDENCE.find((s) => s === a || s === b);
    assert.equal(ledger.aggregateStatus([a, b]), expected, `${a} + ${b}`);
  }
  assert.equal(ledger.aggregateStatus(['CLEAN', 'SOMETHING_ELSE']), 'UNCHECKED', 'an unknown status fails closed');
  assert.equal(ledger.aggregateStatus([]), 'UNCHECKED', 'nothing reduced is not clean');
});

// ---- through runReview: a completed review over declared recorder limits ----------------------

for (const [name, make] of Object.entries(RECORDER_LIMITS)) {
  test(`M33 runReview: ${name} with a completed review reads NO_FINDINGS, never CLEAN or UNCHECKED`, async () => {
    const report = await reviewSessionOnly(make());
    assert.ok(report.windowResults.every((w) => w.failure === null && w.groundingComplete && w.challenge.complete),
      'the fixture is a completed review');
    assert.equal(report.sessionReview, 'complete');
    assert.equal(report.coverage, 'partial');
    assert.equal(report.sessionStatus, 'NO_FINDINGS');
    assert.equal(report.reviewStatus, 'NO_FINDINGS', 'session-only: the aggregate is the session status');
    assert.equal(report.codeStatus, 'UNCHECKED', 'code was not reviewed');
    assert.ok(coverageCauses(report).length > 0, 'the partial coverage names at least one declared cause');
    // A completed review keeps an FYI or a DECIDE over the same partial evidence.
    assert.equal(honestStatuses({ ...report, findings: [FYI] }).sessionStatus, 'FYI');
    assert.equal(honestStatuses({ ...report, findings: [FYI] }).reviewStatus, 'FYI');
    assert.equal(honestStatuses({ ...report, findings: [FYI, DECIDE] }).reviewStatus, 'DECIDE');
    // The combined review of the same session: the session verdict stands, the code side was not run.
    const combined = await runReview({ session: make(), pr: completePr, judge: quiet });
    assert.equal(combined.sessionStatus, 'NO_FINDINGS');
    assert.equal(combined.codeStatus, 'UNCHECKED');
    assert.equal(combined.reviewStatus, 'UNCHECKED', 'UNCHECKED outranks NO_FINDINGS');
    // Joined to a code review that completed and found nothing, the aggregate is NO_FINDINGS, and
    // joined to one that found an FYI, FYI.
    const joined = honestStatuses({ ...combined, codeCoverage: 'complete' });
    assert.equal(joined.codeStatus, 'CLEAN');
    assert.equal(joined.reviewStatus, 'NO_FINDINGS');
    assert.equal(honestStatuses({ ...combined, codeCoverage: 'complete', findings: [CODE_FYI] }).reviewStatus, 'FYI');
  });
}

test('M33 a completed review with complete coverage reads CLEAN', async () => {
  const report = await reviewSessionOnly(session({ delegate: true,
    children: [{ assignmentEvent: 'D1', childSession: 'kid', state: 'verified' }] }));
  assert.equal(report.coverage, 'complete');
  assert.equal(report.sessionReview, 'complete');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.reviewStatus, 'CLEAN');
});

// ---- a review that did not complete stays UNCHECKED, even with an FYI -------------------------

const reviewedFacts = (s, perWindow) => sessionCoverageFacts({ session: s, windows: perWindow.map(() => ({})), perWindow });
const done = () => ({ narrative: EMPTY, failure: null, challenge: { complete: true }, groundingComplete: true });

test('M33 every cause of an incomplete review is UNCHECKED, with or without an FYI, beside a recorder limit', () => {
  const s = session({ delegate: true }); // an unlinked delegation: a recorder limit on its own
  const ok = reviewedFacts(s, [done()]);
  assert.equal(honestStatuses({ findings: [], coverageFacts: ok, codeCoverage: 'missing', session: s }).sessionStatus,
    'NO_FINDINGS', 'the control: a completed review over the recorder limit');
  const cases = {
    'a failed window': reviewedFacts(s, [done(), { narrative: null, failure: 'model_unavailable',
      challenge: { complete: false }, groundingComplete: false }]),
    'an incomplete challenge': reviewedFacts(s, [{ ...done(), challenge: { complete: false } }]),
    'grounding incomplete': reviewedFacts(s, [{ ...done(), groundingComplete: false }]),
    'a window never answered': { ...ok, windows: 2 },
    'zero reviewable events': { ...ok, reviewableEvents: 0, actions: 0 },
    'zero windows': { ...ok, windows: 0, windowsWithNarrative: 0 },
    'no coverage facts at all and a partial declaration': null,
  };
  for (const [name, facts] of Object.entries(cases)) {
    for (const findings of [[], [FYI]]) {
      const report = { findings, coverageFacts: facts, codeCoverage: 'missing', session: s,
        ...(facts === null ? { coverage: 'partial' } : {}) };
      const honest = honestStatuses(report);
      assert.equal(honest.sessionReview, 'incomplete', name);
      assert.equal(honest.sessionStatus, 'UNCHECKED', `${name} with ${findings.length} FYI`);
      assert.equal(honestStatuses({ ...report, reviewScope: 'session-only' }).reviewStatus, 'UNCHECKED', name);
      assert.equal(honestStatuses({ ...report, findings: [...findings, DECIDE] }).sessionStatus, 'DECIDE',
        `${name}: a supported DECIDE still stands`);
    }
  }
});

test('M33 a capping reading rejection (readingCaps) is an incomplete review, even with an FYI', () => {
  const s = session({ delegate: true });
  const coverageFacts = reviewedFacts(s, [done()]);
  // A model-rated confidence rejects the whole candidate: a rejection that is not withheld.
  const forged = { actorSession: 's', dimension: 'test runner', chosen: 'npm test', actions: ['A1'],
    value: null, valueReceipt: null, stated: null, constrainedBy: null, confidence: 0.9 };
  const report = buildLedger({ repo, session: s, pr: null, reviewScope: 'session-only', candidates: [forged],
    sessionCoverage: coverageFrom(coverageFacts), coverageFacts });
  assert.equal(report.rejectedDecisions.length, 1);
  assert.equal(report.sessionReview, 'incomplete');
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.equal(honestStatuses(report).sessionStatus, 'UNCHECKED');
  assert.equal(honestStatuses({ ...report, findings: [FYI] }).sessionStatus, 'UNCHECKED');
  // The same ledger without the rejected candidate is a completed review.
  const control = buildLedger({ repo, session: s, pr: null, reviewScope: 'session-only',
    sessionCoverage: coverageFrom(coverageFacts), coverageFacts });
  assert.equal(control.sessionStatus, 'NO_FINDINGS');
});

test('M33 a narrative proposal the code review join could not evaluate leaves the session review incomplete', async () => {
  const report = await runReview({ session: session({ delegate: true }), pr: completePr, judge: quiet });
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  const joined = honestStatuses({ ...report, codeCoverage: 'complete', rejectedNarrative: 1 });
  assert.equal(joined.sessionReview, 'incomplete');
  assert.equal(joined.sessionStatus, 'UNCHECKED');
  assert.equal(joined.reviewStatus, 'UNCHECKED');
});

test('M33 runReview: a failed window, an incomplete challenge and a relevance shortfall stay UNCHECKED', async () => {
  // Every window failing.
  const failed = await reviewSessionOnly(session({ delegate: true }), async () => null);
  assert.ok(failed.windowFailures.length > 0);
  assert.equal(failed.sessionStatus, 'UNCHECKED');
  assert.equal(honestStatuses({ ...failed, findings: [FYI] }).sessionStatus, 'UNCHECKED');
  // A proposal outside the response contract: its challenge could not run.
  const malformed = await reviewSessionOnly(session({ delegate: true }),
    async (request) => (request.challenge ? { votes: [] } : { ...EMPTY, decisions: [{ synthetic: true }] }));
  assert.ok(malformed.windowResults.some((w) => w.challenge.complete !== true), 'the fixture leaves a challenge incomplete');
  assert.equal(malformed.sessionReview, 'incomplete');
  assert.equal(malformed.sessionStatus, 'UNCHECKED');
  assert.equal(honestStatuses({ ...malformed, findings: [FYI] }).sessionStatus, 'UNCHECKED');
  // A decision whose place in a partly listed PR is unknown: grounding incomplete (relevance).
  const decisionOnly = { ...EMPTY, decisions: [{
    dimension: 'cache backend', chosen: 'Redis', actions: ['E3'], value: 'config/redis.yml',
    valueReceipt: { eventId: 'E3', field: 'path', role: 'action', quote: 'config/redis.yml' },
    stated: { eventId: 'E2', role: 'commentary', quote: 'add a small Redis layer' },
    constrainedBy: { instruction: { eventId: 'E1', role: 'instruction', quote: 'Add response caching to the products API' },
      settles: false, settledValueQuote: null } }] };
  const vote = async (request) => (request.challenge ? {
    votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted', explanation: 'Synthetic support vote.',
      receipts: [{ eventId: 'E1', role: 'instruction', quote: 'Add response caching' }] })) } : decisionOnly);
  const original = redisPivotSession();
  const pivot = new Session({ sessionKey: original.sessionKey, adapter: original.adapter,
    events: structuredClone(original.events), blobs: structuredClone(original.blobs) });
  pivot.event('E4').terminalStatusProven = true;
  const partialPr = { repo, number: 1, enumeration: 'partial',
    files: [{ path: 'src/products.js', change: 'modified', contentState: 'complete' }] };
  const relevance = await runReview({ session: pivot, pr: partialPr, judge: vote });
  assert.ok(relevance.windowResults.some((w) => w.relevanceComplete !== true), 'the fixture leaves relevance unchecked');
  assert.equal(relevance.sessionReview, 'incomplete');
  assert.equal(relevance.sessionStatus, 'UNCHECKED');
  assert.equal(honestStatuses({ ...relevance, codeCoverage: 'complete', findings: [FYI] }).sessionStatus, 'UNCHECKED');
});

test('M33 zero reviewable events and missing coverage are UNCHECKED, never NO_FINDINGS', async () => {
  const boundaryOnly = new Session({ sessionKey: 's', blobs: {},
    events: [{ id: 'B1', kind: 'boundary', sequence: 0, boundary: 'compaction', relatedSession: null }] });
  const report = await reviewSessionOnly(boundaryOnly, async () => { throw new Error('no window, no call'); });
  assert.equal(report.coverage, 'missing');
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.equal(honestStatuses({ ...report, findings: [FYI] }).sessionStatus, 'UNCHECKED');
  // No session at all.
  const none = buildLedger({ repo, session: null, pr: null, reviewScope: 'session-only' });
  assert.equal(none.sessionStatus, 'UNCHECKED');
  assert.equal(none.reviewStatus, 'UNCHECKED');
});

// ---- scope ------------------------------------------------------------------------------------

test('M33 a stale or forged session-only flag falls back to combined reduction', async () => {
  const report = await reviewSessionOnly(session({ delegate: true }));
  assert.equal(report.reviewStatus, 'NO_FINDINGS');
  // Code evidence that was not reviewed is not waived: the aggregate is UNCHECKED.
  for (const [label, forged] of [
    ['a supplied PR', { ...report, pr: completePr }],
    ['a code finding', { ...report, findings: [CODE_FYI] }],
    ['a code judgment', { ...report, codeJudgment: { attemptedCalls: 0, usableResults: 0, rejectedItems: 0, reasons: [] } }],
    ['a PR-scoped code gap', { ...report, gaps: [...report.gaps, { code: 'code_unreviewable', channel: 'code', scope: 'pr', count: 1 }] }],
  ]) {
    const honest = honestStatuses(forged);
    assert.equal(honest.reviewScope, 'combined', label);
    assert.equal(honest.sessionStatus, 'NO_FINDINGS', `${label}: the session verdict itself is unchanged`);
    assert.equal(honest.reviewStatus, 'UNCHECKED', `${label}: the session-only waiver no longer applies`);
  }
  // A code review declared complete is a combined review too; its aggregate follows the precedence.
  const joined = honestStatuses({ ...report, codeCoverage: 'complete' });
  assert.equal(joined.reviewScope, 'combined');
  assert.equal(joined.reviewStatus, ledger.aggregateStatus([joined.codeStatus, joined.sessionStatus]));
});

// ---- never upgrade ------------------------------------------------------------------------------

test('M33 honestStatuses never upgrades a declared coverage or a declared incomplete review', async () => {
  const report = await reviewSessionOnly(session({ delegate: true }));
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  // A report whose declared coverage is lower stays lower.
  const missing = honestStatuses({ ...report, coverage: 'missing' });
  assert.equal(missing.coverage, 'missing');
  assert.equal(missing.sessionStatus, 'UNCHECKED');
  // A review declared incomplete stays incomplete, whatever the facts say — and so does a value
  // outside the closed vocabulary.
  for (const declared of ['incomplete', 'finished', null, 1]) {
    const honest = honestStatuses({ ...report, sessionReview: declared });
    assert.equal(honest.sessionReview, 'incomplete', String(declared));
    assert.equal(honest.sessionStatus, 'UNCHECKED', String(declared));
  }
  // A clean fact set cannot turn an unexplained partial into NO_FINDINGS: with no declared recorder
  // limit, a lowered coverage is not shown to be the recording's, so the review is not shown complete.
  const clean = await reviewSessionOnly(session({ delegate: true,
    children: [{ assignmentEvent: 'D1', childSession: 'kid', state: 'verified' }] }));
  assert.equal(clean.sessionStatus, 'CLEAN');
  const lowered = honestStatuses({ ...clean, coverage: 'partial' });
  assert.equal(lowered.coverage, 'partial');
  assert.equal(lowered.sessionStatus, 'UNCHECKED');
  // Idempotent: reducing its own output changes nothing.
  const once = { ...report, ...honestStatuses(report) };
  assert.deepEqual(honestStatuses(once), honestStatuses(report));
});

test('M33 sessionCoverageFacts counts declared pair gaps as a recorder limit, and coverageFrom caps on them', async () => {
  // Kept for a report written before M35 windowing, whose facts may carry a pair-gap count.
  const facts = sessionCoverageFacts({ session: session(), windows: [{}], perWindow: [done()], pairGaps: 2 });
  assert.equal(facts.pairGaps, 2);
  assert.equal(coverageFrom(facts), 'partial');
  assert.equal(coverageFrom({ ...facts, pairGaps: 0 }), 'complete');
  assert.equal(sessionCoverageFacts({ session: session(), windows: [{}], perWindow: [done()] }).pairGaps, 0);
});

test('M35 windowing: an action and its result too large for one budget window are shown trimmed together, never a pair gap', async () => {
  const report = await reviewSessionOnly(splitPair());
  assert.equal(report.windowResults.length, 1, 'one window: both are trimmed to 2k tokens');
  assert.deepEqual(report.windowResults[0].eventIds, ['I1', 'A1', 'O1']);
  assert.equal(report.coverageFacts.pairGaps, 0);
  assert.equal(report.sessionReview, 'complete');
  assert.equal(report.coverage, 'complete', 'a trimmed middle is how the window shows it, not a recorder limit');
});

// ---- what the readers read ------------------------------------------------------------------

// D71 (a): no status token is ever put in a reader's words.
const STATUS_TOKENS = /\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b/;

for (const [name, make] of Object.entries(RECORDER_LIMITS)) {
  test(`M33 a session-only review of ${name} completes, reads partial coverage and names every declared cause with its count`, async () => {
    const report = await reviewSessionOnly(make());
    assert.equal(report.sessionStatus, 'NO_FINDINGS');
    assert.equal(report.sessionReview, 'complete');
    assert.equal(report.coverage, 'partial');
    const causes = coverageCauses(report);
    assert.ok(causes.length > 0);
    for (const [cause, counts] of causes) {
      const sentence = COVERAGE_SENTENCE[cause](counts);
      assert.equal(typeof sentence, 'string', `${cause} is named`);
      assert.doesNotMatch(sentence, STATUS_TOKENS);
    }
  });
}

test('M33 a combined review reads complete, partial session coverage, and names the session limits', async () => {
  const report = await runReview({ session: session({ delegate: true }), pr: completePr, judge: quiet });
  assert.equal(report.sessionReview, 'complete');
  assert.equal(report.coverage, 'partial');
  const causes = coverageCauses({ ...report, codeCoverage: 'complete' });
  assert.deepEqual(causes.find(([cause]) => cause === 'delegations_unlinked'), ['delegations_unlinked', { n: 1 }]);
});

test('M33 an incomplete review reads incomplete, apart from the recorder limits', async () => {
  const failed = await reviewSessionOnly(session({ delegate: true }), async () => null);
  assert.notEqual(failed.sessionReview, 'complete');
  assert.equal(ledger.reviewRunState(failed), 'incomplete');
  assert.doesNotMatch(PUBLIC_RUN_WORDS.incomplete, STATUS_TOKENS);
});
