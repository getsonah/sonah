// The adapter and the run path. No model is called: the judge is injected, and the fake throws
// if the pipeline ever reaches for one it should not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { runReview, toCandidates } from '../src/run-review.js';
import { Session } from '../src/session.js';
import { redisPivotSession, redisPivotPr } from '../fixtures/redis-pivot.js';

// A small synthetic ledger in the inherited slicer's shape.
const LEDGER = {
  ask: [{ turn: 1, text: 'Add caching. Do not add new infrastructure.' }],
  commentary: [
    { turn: 1, beforeEvent: 0, text: 'Starting on the cache layer.' },
    { turn: 1, beforeEvent: 1, text: 'Going with Redis instead.' },
    // beforeEvent past the end of the turn's actions — the case that used to be dropped.
    { turn: 1, beforeEvent: 99, text: 'Wrapping up now.' },
  ],
  ledger: [
    { turn: 1, seq: 0, kind: 'edit', path: 'config/redis.yml', via: 'Write' },
    { turn: 1, seq: 1, kind: 'test', cmd: 'npm test', outcome: 'failed', tailLines: ['1 failed'] },
  ],
  sayings: [{ turn: 1, text: 'Done — tests pass.' }],
};

test('the adapter loses no instruction, action or commentary block', () => {
  const s = sessionFromLedger(LEDGER, { sessionKey: 's' });
  const count = (kind) => s.events.filter((e) => e.kind === kind).length;
  assert.equal(count('instruction'), 1);
  assert.equal(count('invocation'), 2);
  // 3 commentary blocks + 1 final saying. The out-of-range block must survive.
  assert.equal(count('commentary'), 4);
  assert.ok(s.events.some((e) => e.kind === 'commentary' && s.textOf(e, 'text') === 'Wrapping up now.'));
});

test('adapted text is quotable verbatim', () => {
  const s = sessionFromLedger(LEDGER, { sessionKey: 's' });
  const instruction = s.events.find((e) => e.kind === 'instruction');
  assert.ok(s.sourcesFor(instruction)[0].text.includes('Do not add new infrastructure'));
});

test('a legacy command outcome has unknown provenance; an unobserved write yields no observation', () => {
  const s = sessionFromLedger(LEDGER, { sessionKey: 's' });
  const results = s.events.filter((e) => e.kind === 'observation');
  const forTest = results.find((e) => e.invocation.endsWith('-1'));
  const forEdit = results.find((e) => e.invocation.endsWith('-0'));
  // H1: a legacy ledger's `failed` with no recorded source is no recorded failure: it concludes nothing.
  assert.equal(forTest.result, 'unknown');
  assert.equal(forTest.sourceOfResult, 'unknown');
  // CRD-A1/G2 strengthened this. The adapter used to INFER success for a write with no recorded
  // outcome and label the inference 'parsed-output'. It no longer infers at all: with no result
  // evidence there is no terminal observation, so an attempted write cannot ground adoption.
  assert.equal(forEdit, undefined, 'an unobserved write emits no terminal observation');
});

// B1: an ordinary write is complete evidence and declares nothing, so the clipped case has to
// be built on purpose — a body the RECORDER head-truncated, carrying its own declared marker.
const CLIPPED_LEDGER = { ...LEDGER, ledger: [
  { ...LEDGER.ledger[0],
    after: { text: 'a: 1\n[… truncated at 12000 chars …]', truncated: true, lines: 2 } },
  LEDGER.ledger[1],
] };

test('the adapter declares a body the recorder truncated, and nothing for one it did not', () => {
  assert.ok(sessionFromLedger(CLIPPED_LEDGER, { sessionKey: 's' })
    .adapterGaps.some((g) => g.code === 'source_clipped' && g.channel === 'code'));
  assert.equal(sessionFromLedger(LEDGER, { sessionKey: 's' })
    .adapterGaps.some((g) => g.code === 'source_clipped' && g.channel === 'code'), false);
});

// ---- the run ------------------------------------------------------------------------
const session = redisPivotSession();
const pr = redisPivotPr();

const GOOD = {
  decisions: [{
    dimension: 'cache backend', chosen: 'Redis', actions: ['E3'],
    value: 'config/redis.yml',
    valueReceipt: { eventId: 'E3', field: 'path', role: 'action', quote: 'config/redis.yml' },
    stated: { eventId: 'E2', role: 'commentary', quote: 'add a small Redis layer' },
    constrainedBy: { instruction: { eventId: 'E1', role: 'instruction', quote: 'Add response caching to the products API' },
      settles: false, settledValueQuote: null },
  }],
  pivots: [], requirements: [],
  claims: [{ text: 'the tests pass',
    stated: { eventId: 'E9', role: 'commentary', quote: 'verified it works — the tests pass' },
    contradictedBy: { eventId: 'E6', role: 'observation', quote: 'Tests: 1 failed, 11 passed, 12 total' } }],
};

// This fake genuinely answers the newly mandatory challenge calls as well as extraction.
// Its votes test orchestration/grounding, not semantic review quality. M33 C (vote binding): a support vote
// cites the item's own statement when it has one — a contradicted claim's support must cite its own events.
const reviewer = (narrative) => async (request) => request.challenge ? {
  votes: request.challenge.items.map(({ key, candidate }) => ({ key,
  verdict: 'not-refuted', explanation: 'Synthetic support vote for orchestration testing.',
  receipts: [candidate?.stated ?? { eventId: 'E1', role: 'instruction', quote: 'Add response caching' }],
  })),
} : narrative;

test('a grounded narrative becomes a grounded report', async () => {
  const report = await runReview({ session, pr, judge: reviewer(GOOD) });
  assert.equal(report.decisions.length, 1);
  assert.equal(report.decisions[0].column, 'asked-chose');
  assert.equal(report.decisions[0].materialityRule, 'config');
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].kind, 'claim_contradicted');
  assert.equal(report.reviewStatus, 'DECIDE');
});

test('session-only execution separates resolved votes and grounding from missing PR relevance', async () => {
  const report = await runReview({ session, pr: null, judge: reviewer(GOOD) });
  const window = report.windowResults[0];
  assert.equal(window.challenge.complete, true);
  assert.equal(window.sessionGroundingComplete, true);
  assert.equal(window.relevanceComplete, false);
  assert.equal(window.groundingComplete, false);
  assert.equal(window.grounding.uncheckedRelevance, 1);
  assert.equal(window.grounding.rejectedDecisions, 0);
  assert.equal(report.coverage, 'partial');
  assert.notEqual(report.sessionStatus, 'CLEAN');
});

test('explicit session-only review checks the session without requiring a PR or code review', async () => {
  const prompts = [];
  const systems = [];
  const judge = async (request) => {
    if (!request.challenge) { prompts.push(request.prompt); systems.push(request.system); }
    return reviewer(GOOD)(request);
  };
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge });
  assert.equal(report.reviewScope, 'session-only');
  assert.equal(report.windowResults[0].relevanceApplicable, false);
  assert.equal(report.windowResults[0].relevanceComplete, true);
  assert.equal(report.windowResults[0].shortfall.grounding.relevanceUnchecked, 0);
  assert.equal(report.codeCoverage, 'missing');
  assert.equal(report.codeStatus, 'UNCHECKED');
  assert.equal(report.reviewStatus, report.sessionStatus);
  // D71 (S2): the session-only request carries only the window, in the checklist's order; the brief is the system prompt.
  assert.ok(prompts.every((prompt) => prompt.startsWith('# Checklist for window ') && prompt.includes('## What the human asked')));
  assert.ok(prompts.every((prompt) => !prompt.includes('SCOPE: Review the recorded session only.')));
  assert.ok(systems.every((system) => system.includes("Sonah's session reviewer")));
  assert.ok(systems.every((system) => system.includes('WHAT YOUR ANSWER IS FOR')));
  assert.ok(systems.every((system) => !system.includes('## Reviewing the code well')));
  // The column fix moved it once more (sonah.session-review-agent/8): who decided a decision (FIX_COLUMN_VERSIONS).
  // P1 (the asks fixes) moved it once more (sonah.session-review-agent/9): a run refused at every attempt.
  // W1 B moved it once more (sonah.session-review-agent/10): an edit may go against a project instruction file.
  // W2 moved it once more (sonah.session-review-agent/11): a claim is compared with the evidence; the agent's own text.
  assert.equal(report.instrument.reviewAgent, 'sonah.session-review-agent/11');
});

test('session-only review rejects supplied PR or diff before invoking the judge', async () => {
  let invoked = false;
  const judge = async () => { invoked = true; return GOOD; };
  await assert.rejects(runReview({ session, pr, reviewScope: 'session-only', judge }), RangeError);
  await assert.rejects(runReview({ session, pr: null, diff: 'not a PR', reviewScope: 'session-only', judge }), RangeError);
  assert.equal(invoked, false);
});

test('failed extraction cannot report vacuous grounding completion or reuse a capsule', async () => {
  const report = await runReview({ session, pr, judge: async () => null });
  assert.equal(report.windowResults[0].sessionGroundingComplete, false);
  assert.equal(report.windowResults[0].groundingComplete, false);
  assert.equal(report.challenge.complete, false);
  assert.equal(report.coverage, 'missing');
});

test('a claim with no cited contradiction never becomes an accusation', async () => {
  const noContradiction = { ...GOOD, claims: [{ text: 'the tests pass',
    stated: { eventId: 'E9', role: 'commentary', quote: 'verified it works — the tests pass' }, contradictedBy: null }] };
  const report = await runReview({ session, pr, judge: reviewer(noContradiction) });
  assert.equal(report.findings.length, 0);
});

test('a model that fabricates a quote gets it rejected, not published', async () => {
  const lying = { ...GOOD, decisions: [{ ...GOOD.decisions[0],
    constrainedBy: { instruction: { eventId: 'E1', role: 'instruction', quote: 'use Redis for caching' }, // never said
      settles: true, settledValueQuote: 'Redis' } }] };
  const report = await runReview({ session, pr, judge: reviewer(lying) });
  assert.equal(report.decisions[0].column, null, 'a fabricated instruction cannot set a column');
  // D58: the column check ran and was inconclusive. The row shows its own UNCHECKED cell and the
  // fabricated quote is never published; it does not cap coverage.
  assert.equal(report.decisions[0].constrainedBy, null);
  assert.equal(report.coverage, 'complete');
  assert.ok(report.decisions[0].reasons.includes('receipt_rejected'), 'the row says why it is not checked');
  assert.ok(!JSON.stringify(report.decisions).includes('use Redis for caching'));
});

test('a failed window is counted, never silently skipped', async () => {
  const dead = async () => { const e = new Error('x'); e.code = 'model_unavailable'; throw e; };
  const report = await runReview({ session, pr, judge: dead });
  assert.equal(report.coverage, 'missing');
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.deepEqual(report.windowFailures, [{ window: 1, reason: 'model_unavailable' }]);
});

test('a judge returning nothing usable is a failure, not an empty clean review', async () => {
  const report = await runReview({ session, pr, judge: async () => null });
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.equal(report.windowFailures[0].reason, 'model_response_invalid');
});

test('the report records which instrument produced it', async () => {
  const report = await runReview({ session, pr, judge: reviewer(GOOD) });
  assert.match(report.instrument.reviewAgent, /^sonah\.review-agent\//);
  assert.equal(report.instrument.windows, 1);
});

test('toCandidates never invents an instruction relationship', () => {
  const { decisions } = toCandidates({ decisions: [{ dimension: 'd', chosen: 'c', actions: ['E3'] }] }, 's');
  assert.equal(decisions[0].constrainedBy, null);
});

test('M29 candidate actors come from all cited actions, never from model identity', () => {
  const session = new Session({ sessionKey: 'root-session', events: [
    { id: 'A1', kind: 'invocation', operation: 'command', sequence: 0 },
    { id: 'A2', kind: 'invocation', operation: 'write', childId: 'child-1', sequence: 1 },
    { id: 'A3', kind: 'invocation', operation: 'write', childId: 'unlinked', sequence: 2 },
  ], children: [{ assignmentEvent: 'D1', state: 'verified', childId: 'child-1',
    sessionKey: 'child-session', childSession: 'child-session' }] });
  const decision = (actions) => ({ dimension: 'storage', chosen: 'a file', actions,
    actorSession: 'model-spoofed-session' });
  const converted = toCandidates({ decisions: [decision(['A1']), decision(['A2']),
    decision(['A1', 'A2']), decision(['A3'])] }, session).decisions;
  assert.deepEqual(converted.map((row) => row.actorSession),
    ['root-session', 'child-session', null, null]);
});

test('adapter gaps reach the published report', async () => {
  const withGaps = sessionFromLedger(CLIPPED_LEDGER, { sessionKey: 's' });
  const report = await runReview({ session: withGaps, pr, judge: async () => ({ decisions: [], pivots: [], requirements: [], claims: [] }) });
  assert.ok(report.gaps.some((g) => g.code === 'source_clipped'));
});

// ---- pivots and requirements are grounded like everything else -----------------------
test('a pivot whose receipts do not check out is withheld, not printed as a story', async () => {
  const narrative = { decisions: [], claims: [], requirements: [], pivots: [
    { abandoned: 'approach A', adopted: 'approach B', whyAbandoned: 'it failed',
      receipts: [{ eventId: 'E6', role: 'observation', quote: 'Tests: 1 failed, 11 passed, 12 total' }] },
    { abandoned: 'invented', adopted: 'also invented', whyAbandoned: 'plausible prose',
      receipts: [{ eventId: 'E6', role: 'observation', quote: 'this text was never printed' }] },
  ] };
  const report = await runReview({ session, pr, judge: reviewer(narrative) });
  assert.equal(report.pivots.length, 1);
  assert.equal(report.pivots[0].abandoned, 'approach A');
  assert.equal(report.pivotsRejected, 1);
  assert.ok(!JSON.stringify(report.pivots).includes('also invented'));
  // D58: counted among the checks that ran and were inconclusive.
  assert.equal(report.withheld.proposals, 1);
});

test('a requirement whose instruction quote is fabricated is withheld', async () => {
  const narrative = { decisions: [], claims: [], pivots: [], requirements: [
    { text: 'add caching', status: 'addressed',
      instruction: { eventId: 'E1', role: 'instruction', quote: 'Add response caching' } },
    { text: 'never asked', status: 'open',
      instruction: { eventId: 'E1', role: 'instruction', quote: 'rewrite it in Rust' } },
  ] };
  const report = await runReview({ session, pr, judge: reviewer(narrative) });
  assert.equal(report.requirements.length, 1);
  assert.equal(report.requirementsRejected, 1);
  assert.ok(!JSON.stringify(report.requirements).includes('never asked'));
});

