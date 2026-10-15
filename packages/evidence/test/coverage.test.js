// A3 — a capability that did not run never reports a verdict.
//
// Every test here is a false-verdict regression: a path on which the pipeline printed CLEAN
// while nothing had been reviewed. Coverage is derived from what the CODE observed; absence is
// never completeness, and no model field may feed a coverage value.
//
// The judge throws if it is called. A CLEAN that costs zero model calls is the defect.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { planWindows } from '../src/windows.js';
import { runReview } from '../src/run-review.js';
import { buildLedger, sessionCoverageFacts, coverageFrom, honestStatuses } from '../src/ledger.js';
import { renderReview, COVERAGE_CAUSES, COVERAGE_SENTENCE, coverageCauses } from '../src/review.js';

const repo = { host: 'github.com', id: '1' };
const pr = { repo, number: 1, files: [] };
const neverJudge = async () => { throw new Error('the judge must not be called'); };

const blob = (text) => [{ sourceKey: 'k', fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];

// ---- B12/B13: zero windows ------------------------------------------------------------

test('B12 a session whose only event is a compaction boundary is UNCHECKED, not CLEAN', async () => {
  const session = new Session({ sessionKey: 's', blobs: {},
    events: [{ id: 'B1', kind: 'boundary', sequence: 0, boundary: 'compaction', relatedSession: null }] });
  assert.equal(planWindows(session).length, 0, 'the fixture really does produce zero windows');
  const report = await runReview({ session, pr, judge: neverJudge });
  assert.equal(report.coverage, 'missing');
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.equal(report.reviewStatus, 'UNCHECKED');
  assert.ok(!renderReview(report).includes('CLEAN'), 'nothing was reviewed, so nothing may read CLEAN');
});

test('B13 the same session through the production adapter is UNCHECKED', async () => {
  const session = sessionFromLedger({ marks: [{ turn: 0, kind: 'compaction' }] }, { sessionKey: 's' });
  assert.equal(planWindows(session).length, 0);
  const report = await runReview({ session, pr, judge: neverJudge });
  assert.equal(report.instrument.windows, 0);
  assert.equal(report.coverage, 'missing');
  assert.equal(report.sessionStatus, 'UNCHECKED');
});

// ---- B4/M29: a usable review can cover a non-action session ---------------------------

test('M29 a judged instruction-only session can be complete without inventing an action', async () => {
  const text = 'Please review the exported value.';
  const session = new Session({ sessionKey: 's', blobs: { k: text },
    events: [{ id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: blob(text) }] });
  let calls = 0;
  const report = await runReview({ session, pr,
    judge: async () => { calls++; return { decisions: [], pivots: [], claims: [], requirements: [] }; } });
  assert.equal(report.coverage, 'complete');
  assert.equal(report.coverageFacts.actions, 0);
  assert.equal(report.coverageFacts.reviewableEvents, 1);
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.reviewStatus, 'UNCHECKED', 'combined review still has no code verdict');
  assert.ok(calls > 0);
});

test('the nullish case: buildLedger with no declared session coverage is UNCHECKED', () => {
  const text = 'do the thing';
  const session = new Session({ sessionKey: 's', blobs: { k: text },
    events: [{ id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: blob(text) }] });
  const undeclared = buildLedger({ repo, session, pr, sessionCoverage: undefined });
  assert.equal(undeclared.coverage, 'missing', 'nobody declared that this session was reviewed');
  assert.equal(undeclared.sessionStatus, 'UNCHECKED');
  // A caller that DID run the review declares it, and only then may an empty list read clean.
  const declared = buildLedger({ repo, session, pr, sessionCoverage: 'complete' });
  assert.equal(declared.sessionStatus, 'CLEAN');
});

// ---- B1/G6: delegated work is declared, not relabelled ---------------------------------

test('B1/G6 an unverified delegation becomes a delegate invocation and a named inventory gap', () => {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Delegate the migration to a sub-agent.' }],
    delegations: [{ adapter: 'claude', callId: 'd1', turn: 1, childId: null, status: 'unresolved',
      reason: 'delegation_child_unchecked', source: 0, record: 2,
      parentInstruction: { text: 'Write the migration in db/migrate.sql', tool: 'Task', field: 'prompt' } }],
  }, { sessionKey: 's' });

  const delegate = session.events.filter((e) => e.kind === 'invocation' && e.operation === 'delegate');
  assert.equal(delegate.length, 1, 'the hand-off is visible to the ledger as an action');
  assert.equal(delegate[0].tool, 'Task');
  // The brief is visible as an agent assignment, never as a human instruction.
  assert.ok(session.sourcesFor(delegate[0]).some((s) => s.role === 'action' && s.text.includes('db/migrate.sql')));
  assert.ok(!session.sourcesFor(delegate[0]).some((s) => s.role === 'instruction'));

  const gaps = session.adapterGaps.filter((g) => g.code === 'incomplete_inventory' && g.channel === 'children');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].channel, 'children');
  assert.deepEqual(gaps[0].eventIds, [delegate[0].id]);

  const report = buildLedger({ repo, session, pr, sessionCoverage: 'complete' });
  assert.equal(report.coverage, 'partial');
  // M33 (C-06): the review was declared complete; the unverified child is a recorder limit. That
  // reads NO_FINDINGS — never CLEAN, and rendered with the gap below. Before M33, UNCHECKED.
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.equal(report.gaps.filter((g) => g.code === 'incomplete_inventory' && g.channel === 'children').length, 1,
    'one delegation, one declared gap — the adapter and the child-link path must not double it');
  assert.match(renderReview(report), /hand-off could not be verified against a child recording/);
});

test('B1/G6 a delegation the slicer called ambiguous is declared as ambiguous, not as absent', () => {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Delegate it.' }],
    delegations: [{ adapter: 'claude', callId: 'd1', turn: 1, childId: null, status: 'unresolved',
      reason: 'delegation_child_ambiguous', source: 0,
      parentInstruction: { text: 'do the thing', tool: 'Task', field: 'prompt' } }],
  }, { sessionKey: 's' });
  assert.deepEqual(session.adapterGaps.filter((g) => g.channel === 'children').map((g) => g.code),
    ['ambiguous_child']);
  const report = buildLedger({ repo, session, pr, sessionCoverage: 'complete' });
  // M33 (C-06): a completed review over an ambiguous child (a recorder limit) reads NO_FINDINGS.
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.match(renderReview(report), /could not be matched to exactly one sub-agent session/);
});

test('B1/G6 a recorder that only reports delegated_capture_unchecked still declares a child gap', () => {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Delegate it.' }],
    capture: { incomplete: true, reasons: ['delegated_capture_unchecked'] },
  }, { sessionKey: 's' });
  assert.deepEqual(session.adapterGaps.filter((g) => g.channel === 'children').map((g) => g.code),
    ['incomplete_inventory']);
});

// ---- F100: a gap the ledger derives from `children` reaches the verdict ------------------

// W3c-3's reproduction, by hand: one hand-off whose ChildLink is `missing`, and a window that
// read the session and proposed nothing. The report listed `missing_child` and said CLEAN.
const DELEGATED = { ask: 'Split the migration out into a helper.', brief: 'Write db/migrate.sql for users.' };
const delegated = (children, extra = {}) => new Session({ sessionKey: 's', blobs: DELEGATED, children, ...extra,
  events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [],
      text: [{ sourceKey: 'ask', fromByte: 0, untilByte: Buffer.byteLength(DELEGATED.ask) }] },
    { id: 'D1', kind: 'invocation', sequence: 1, callKey: 'd1', tool: 'Task', operation: 'delegate',
      paths: [], command: [], changes: [],
      input: [{ sourceKey: 'brief', fromByte: 0, untilByte: Buffer.byteLength(DELEGATED.brief) }] }] });
const emptyNarrative = async () => ({ decisions: [], pivots: [], claims: [], requirements: [] });

// M33 (C-06): the window read the session and completed, so the verdict is NO_FINDINGS — the
// missing child is a recorder limit, declared and named. Before M33 this read UNCHECKED.
test('F100 a missing child link and an empty narrative is partial and NO_FINDINGS, never CLEAN', async () => {
  const report = await runReview({ session: delegated([{ assignmentEvent: 'D1', state: 'missing' }]), pr,
    judge: emptyNarrative });
  assert.deepEqual(report.gaps.map((g) => g.code), ['missing_child']);
  assert.equal(report.coverageFacts.delegationsUnlinked, 1, 'the facts count the gap the ledger declared');
  assert.equal(report.coverage, 'partial');
  assert.equal(report.sessionReview, 'complete');
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.notEqual(report.reviewStatus, 'CLEAN');
  assert.match(renderReview(report), /1 delegation\(s\) have no verified child evidence/,
    'the reader is told which fact made it partial');
});

test('F100 sessionCoverageFacts counts every route a delegation gap takes, once per hand-off', () => {
  const count = (session) => sessionCoverageFacts({ session }).delegationsUnlinked;
  // Every ChildLink state short of verified, and a hand-off with no link at all.
  for (const state of ['missing', 'ambiguous', 'conflicting'])
    assert.equal(count(delegated([{ assignmentEvent: 'D1', state }])), 1, state);
  assert.equal(count(delegated([])), 1, 'a delegate event with no ChildLink is unlinked');
  assert.equal(count(delegated([{ assignmentEvent: 'D1', state: 'verified' }])), 0, 'verified resolves it');
  // One hand-off declared by the adapter AND by its ChildLink is one loss, not two.
  const both = delegated([{ assignmentEvent: 'D1', state: 'missing' }]);
  both.adapterGaps = [{ code: 'missing_child', channel: 'children', scope: 'session', eventIds: ['D1'], count: 1 }];
  assert.equal(count(both), 1);
  // A declaration that names no event is still a lost hand-off, beside one that does.
  const anonymous = delegated([{ assignmentEvent: 'D1', state: 'missing' }]);
  anonymous.adapterGaps = [{ code: 'missing_child', channel: 'children', scope: 'session', count: 1 }];
  assert.equal(count(anonymous), 2);
  // A different gap on the children channel is not an unlinked delegation.
  const partialChild = delegated([{ assignmentEvent: 'D1', state: 'verified' }]);
  partialChild.adapterGaps = [{ code: 'incomplete_inventory', channel: 'children', scope: 'session',
    eventIds: ['D1'], count: null }];
  assert.equal(count(partialChild), 0);
});

// ---- the facts themselves --------------------------------------------------------------

test('sessionCoverageFacts counts what the code observed, and null is never complete', () => {
  const text = 'do the thing';
  const session = new Session({ sessionKey: 's', blobs: { k: text }, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: blob(text) },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Bash', operation: 'command',
      paths: [], command: [], input: [], changes: [] }] });
  const facts = sessionCoverageFacts({ session, windows: [{}], perWindow: [{ narrative: {}, challenge: { complete: true }, groundingComplete: true }] });
  assert.equal(facts.actions, 1);
  assert.equal(facts.instructions, 1);
  assert.equal(facts.windows, 1);
  assert.equal(facts.windowsWithNarrative, 1);
  assert.equal(facts.declared, null);
  assert.equal(coverageFrom(facts), 'complete');
  assert.equal(coverageFrom({ ...facts, windows: 0 }), 'missing');
  assert.equal(coverageFrom({ ...facts, actions: 0 }), 'complete',
    'a zero-action scope still contains reviewable instruction evidence');
  assert.equal(coverageFrom({ ...facts, actions: 0, reviewableEvents: 0 }), 'missing');
  assert.equal(coverageFrom({ ...facts, windowsWithNarrative: 0 }), 'missing');
  assert.equal(coverageFrom({ ...facts, windowsFailed: 1 }), 'partial');
  assert.equal(coverageFrom({ ...facts, adapterGaps: 1 }), 'partial');
  assert.equal(coverageFrom({ ...facts, instructionsElided: 1 }), 'partial');
  assert.equal(coverageFrom({ ...facts, delegationsUnlinked: 1 }), 'partial');
  assert.equal(coverageFrom({ ...facts, declared: 'partial' }), 'partial');
});

// ---- Change 6: the recomputation is the last word --------------------------------------

test('honestStatuses overrides a CLEAN written by an intermediate step', () => {
  const out = honestStatuses({ sessionStatus: 'CLEAN', codeStatus: 'CLEAN', reviewStatus: 'CLEAN',
    coverage: 'complete', codeCoverage: 'complete', findings: [],
    coverageFacts: { windows: 0, windowsWithNarrative: 0, windowsFailed: 0, actions: 0, instructions: 0,
      instructionsElided: 0, delegationsUnlinked: 0, adapterGaps: 0, declared: 'complete' } });
  assert.equal(out.coverage, 'missing');
  assert.equal(out.sessionStatus, 'UNCHECKED');
  assert.equal(out.reviewStatus, 'UNCHECKED');
});

test('the renderer recomputes before it prints, so a forged CLEAN never reaches a reader', () => {
  const forged = {
    repo, pr, session: null, hasSessionEvidence: true,
    decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [], gaps: [],
    counts: { decisions: 0, byColumn: {}, uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 },
    coverage: 'complete', codeCoverage: 'missing',
    sessionStatus: 'CLEAN', codeStatus: 'CLEAN', reviewStatus: 'CLEAN',
    coverageFacts: { windows: 0, windowsWithNarrative: 0, windowsFailed: 0, actions: 0, instructions: 0,
      instructionsElided: 0, delegationsUnlinked: 0, adapterGaps: 0, declared: 'complete' },
  };
  const md = renderReview(forged);
  // D71 (a): the renderer prints no status at all; what it says of the review is recomputed from the facts.
  assert.match(md, /Session review: \*\*did not complete\*\*/);
  assert.match(md, /Sonah's review did not complete/);
  assert.doesNotMatch(md, /\b(CLEAN|UNCHECKED|NO_FINDINGS|DECIDE|FYI)\b/, 'the renderer never prints a status');
});

test('a forged code CLEAN with missing code coverage renders as "not run"', () => {
  const forged = {
    repo, pr, session: null, hasSessionEvidence: false,
    decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [], gaps: [],
    counts: { decisions: 0, byColumn: {}, uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 },
    coverage: 'complete', codeCoverage: 'missing',
    sessionStatus: 'CLEAN', codeStatus: 'CLEAN', reviewStatus: 'CLEAN',
  };
  const md = renderReview(forged);
  assert.match(md, /Code review: \*\*not run\*\*/);
  assert.ok(!md.includes('Code review: **CLEAN**'));
});

// ---- Change 7: the render says what was not covered, in words --------------------------

const FACTS = (over = {}) => ({ windows: 2, windowsWithNarrative: 2, windowsFailed: 0, actions: 3,
  instructions: 1, instructionsElided: 0, delegationsUnlinked: 0, adapterGaps: 0, declared: 'complete', ...over });
const completePr = { repo, number: 1, enumeration: 'complete',
  files: [{ path: 'a.js', change: 'modified', contentState: 'complete' }] };
const shell = (over) => ({ repo, pr: completePr, session: null, hasSessionEvidence: true,
  decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [], gaps: [],
  counts: { decisions: 0, byColumn: {}, uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 },
  coverage: 'partial', codeCoverage: 'missing', ...over });

test('the coverage phrasebook is closed and complete', () => {
  assert.deepEqual(Object.keys(COVERAGE_SENTENCE).sort(), [...COVERAGE_CAUSES].sort(),
    'a cause with no sentence renders as nothing; a sentence with no cause is dead text');
  for (const cause of COVERAGE_CAUSES)
    assert.equal(typeof COVERAGE_SENTENCE[cause]({ n: 1, m: 2 }), 'string');
});

for (const [name, over, expected] of [
  ['no windows', { windows: 0 }, 'no review windows were produced'],
  ['no actions', { actions: 0 }, 'no actions were recorded in this session'],
  ['failed windows', { windowsFailed: 1 }, '1 of 2 review windows did not complete'],
  ['elided instructions', { instructionsElided: 2 }, '2 instruction(s) were elided by the recorder'],
  ['unlinked delegations', { delegationsUnlinked: 1 }, '1 delegation(s) have no verified child evidence'],
]) {
  test(`the coverage note names the fact that caused it: ${name}`, () => {
    const md = renderReview(shell({ coverageFacts: FACTS(over) }));
    assert.ok(md.includes(`Not covered: `), 'the note is present');
    assert.ok(md.includes(expected), `${name}: expected "${expected}" in the rendered note`);
  });
}

test('an incomplete PR file list is named too, and a complete one is not', () => {
  const partial = { ...completePr, enumeration: 'partial' };
  assert.ok(renderReview(shell({ pr: partial, coverageFacts: FACTS({ windowsFailed: 1 }) }))
    .includes('the PR file list was incomplete'));
  assert.ok(!renderReview(shell({ coverageFacts: FACTS({ windowsFailed: 1 }) }))
    .includes('the PR file list was incomplete'));
  assert.deepEqual(coverageCauses({ pr: completePr, coverageFacts: FACTS() }), []);
});

test('complete coverage prints no coverage note at all', () => {
  const md = renderReview(shell({ codeCoverage: 'complete', coverageFacts: FACTS() }));
  assert.ok(!md.includes('Not covered:'));
});

// ---- F19: a finding the caller has not reported before is marked ------------------------

const finding = (over) => ({ origin: 'code-review', kind: 'code_issue', title: 'Unguarded call',
  explanation: 'It can throw.', receipts: [], scope: 'current-code', anchor: null, status: 'DECIDE', ...over });

test('F19 a finding carrying isNew renders a `new` tag; an unchanged one does not', () => {
  const md = renderReview(shell({ codeCoverage: 'complete', coverageFacts: FACTS(),
    findings: [finding({ isNew: true }), finding({ title: 'Old defect', isNew: false })] }));
  // D71 (a): the header names the kind and its recorded facts, never a status.
  assert.match(md, /\*\*Unguarded call\*\* {2}`code\\_issue` · `new`/);
  assert.match(md, /\*\*Old defect\*\* {2}`code\\_issue`$/m);
});

test('F19 only a strictly true isNew is a claim; absent or truthy is not', () => {
  for (const value of [undefined, 'yes', 1, null]) {
    const md = renderReview(shell({ codeCoverage: 'complete', coverageFacts: FACTS(),
      findings: [finding(value === undefined ? {} : { isNew: value })] }));
    assert.ok(!md.includes('· `new`'), `isNew=${String(value)} must not be rendered as new`);
  }
});
