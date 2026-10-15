// F100 — a report that declares a gap can never read CLEAN, whichever layer declared it.
//
// W3c-3 found a report that LISTED `missing_child` and CERTIFIED the session in the same object:
// the ledger derived the gap from `session.children`, the coverage facts counted only the gaps
// the adapter had declared, and the facts had the last word. That was one route. This file is
// the whole class: every way a gap can enter a report, through `runReview` and through
// `buildLedger` directly, each checked against one invariant —
//
//   if the report declares anything it did not check, neither sessionStatus nor reviewStatus
//   is CLEAN — as produced, as joined to a complete and clean code review, and as rendered.
//
// Every fixture must actually declare something (asserted), or the invariant holds vacuously
// and the case proves nothing. No model is called: the judge is a stub that returns an empty
// narrative, which is exactly the input on which a false CLEAN is cheapest.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { runReview } from '../src/run-review.js';
import { buildLedger, honestStatuses, sessionCoverageFacts, coverageFrom } from '../src/ledger.js';
import { renderReview } from '../src/review.js';
import { redisPivotSession } from '../fixtures/redis-pivot.js';

const repo = { host: 'github.com', id: '1' };
const completePr = { repo, number: 1, enumeration: 'complete',
  files: [{ path: 'src/app.js', change: 'modified', contentState: 'complete' }] };

// An empty narrative, and a challenge vote for anything that is somehow proposed. A window that
// answers like this read the session and found nothing: the input a CLEAN is supposed to need.
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const quiet = (narrative = EMPTY) => async (request) => request.challenge ? {
  votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'Synthetic support vote for orchestration testing.',
    receipts: [{ eventId: 'E1', role: 'instruction', quote: 'Add response caching' }] })),
} : narrative;

// ---- the invariant -------------------------------------------------------------------------
//
// W3c-8 (F116): a declared gap caps the coverage of its OWN channel. The rule is written out here
// by hand, independently of ledger.js, so the implementation cannot pass by agreeing with itself.
// The code review reads the PR's diff from git and never the recording, so only a PR-scoped loss
// on the `code` channel is a loss of the code review. Every other gap — including a recorder's
// cut in a session write body (`source_clipped`, channel `code`, scope `session`) — is a loss of
// the session record. Whichever side a gap lands on, the overall reviewStatus is never CLEAN.
const isCodeGap = (gap) => gap?.channel === 'code' && gap?.scope === 'pr';
const OVERALL_CLEAN = '**Nothing found, and the evidence was complete enough to say so.**';
// D71 (a), owner decision 2026-10-08: the rendered review shows no status at all, so none can certify a gap.
const ANY_STATUS = /\*\*(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\*\*|Needs a decision|Worth a look|nothing is blocking/;
const SESSION_NOT_COMPLETE = 'Session review: **did not complete**';
const RUN_NOT_COMPLETE = "Sonah's review did not complete";

// M29, also by hand: an `unrecorded_body` is a shortfall for every repository write unless
// exact historical-body/head equivalence is proved. The current record has no such proof. A
// matching path in a reviewed PR cannot substitute for missing historical bytes. Outside-repo
// writes do not cap this code review. Unlisted writes still cap.
function uncoveredWrites(gap, report) {
  void report;
  const writes = Array.isArray(gap.writes) ? gap.writes : [];
  const covered = writes.filter((w) => w.outsideRepository === true).length;
  const count = Number.isSafeInteger(gap.count) ? Math.max(gap.count, writes.length) : writes.length + 1;
  return count - covered;
}
const shortfall = (gap, report) => gap.code !== 'unrecorded_body' || uncoveredWrites(gap, report) > 0;

/** Everything a report says, anywhere on it, that it did not check. Code's facts, never a model's.
 *  A code-review loss is prefixed `code-gap:`; everything else is a loss of the session review. */
function declaredShortfalls(report) {
  const out = [];
  for (const gap of (report.gaps ?? []).filter((g) => shortfall(g, report)))
    out.push(`${isCodeGap(gap) ? 'code-gap' : 'gap'}:${gap.code}`);
  for (const gap of (report.session?.adapterGaps ?? []).filter((g) => shortfall(g, report)))
    out.push(`${isCodeGap(gap) ? 'code-gap' : 'adapter'}:${gap.code}`);
  const facts = report.coverageFacts;
  if (facts) {
    if (facts.windows === 0) out.push('facts:no_windows');
    if (facts.reviewableEvents === 0 || facts.reviewableEvents == null && facts.actions === 0)
      out.push('facts:no_reviewable_events');
    if (facts.windowsFailed > 0) out.push('facts:windows_failed');
    if (facts.instructionsElided > 0) out.push('facts:instructions_elided');
    if (facts.delegationsUnlinked > 0) out.push('facts:delegations_unlinked');
    if (facts.adapterGaps > 0) out.push('facts:adapter_gaps');
  }
  for (const failure of report.windowFailures ?? []) out.push(`window:${failure.reason}`);
  if (report.rejectedDecisions?.length) out.push('rejected_decisions');
  if (report.rejectedFindings?.length) out.push('rejected_findings');
  for (const d of report.decisions ?? [])
    if (d.relevance === 'unchecked' || d.columnState === 'unchecked' || d.valueState === 'unchecked')
      out.push('decision_unchecked');
  return out;
}

// M33 (C-06 "M33 session verdict"): a completed review over declared recorder limits may now read
// NO_FINDINGS, never CLEAN. The causes that mean the REVIEW did not complete — no window, no
// reviewable event, a window short under `windowIncompleteReasons`, a rejection that is not a withheld
// one (`readingCaps`), an unknown PR relevance in a combined review, missing coverage — must keep
// the session UNCHECKED. Written out by hand, independently of ledger.js, like the rule above.
//
// A withheld rejection is one whose check RAN and was inconclusive, from the contract's own words:
// a quote that did not match the record (`receipt_rejected`, D58), and — C-06, M33 G4 — a DECISION
// rejected `ambiguous_authority` because its cited actions resolve to more than one actor, or to
// none (the cause `actor_ambiguous`): "it does not by itself make the session review incomplete".
// Nothing else is: the same reason with no cause or another cause, the cause on another reason, and
// the cause on a rejected finding (the contract withholds only a decision) all remain not-run.
const withheldByContract = (rejection, list) => rejection?.reason === 'receipt_rejected'
  || (list === 'decisions' && rejection?.reason === 'ambiguous_authority' && rejection?.cause === 'actor_ambiguous');
function notRunCauses(report) {
  const out = [];
  const facts = report.coverageFacts;
  if (facts) {
    const reviewable = facts.reviewableEvents ?? facts.actions;
    if (facts.windows === 0) out.push('facts:no_windows');
    if (reviewable === 0) out.push('facts:no_reviewable_events');
    if (facts.windowsFailed > 0) out.push('facts:windows_incomplete');
    if (facts.windowsWithNarrative < facts.windows) out.push('facts:windows_unanswered');
  }
  for (const w of report.windowResults ?? [])
    if (!(w.failure === null && w.groundingComplete === true && w.challenge?.complete === true)) out.push('window:incomplete');
  for (const [list, rejections] of [['decisions', report.rejectedDecisions], ['findings', report.rejectedFindings]])
    for (const r of rejections ?? []) if (!withheldByContract(r, list)) out.push(`rejected:${r.reason}`);
  if (report.reviewScope !== 'session-only')
    for (const d of report.decisions ?? []) if (d.relevance === 'unchecked') out.push('relevance_unchecked');
  if (report.coverage === 'missing' || report.hasSessionEvidence === false) out.push('coverage_missing');
  return out;
}
let notRunChecked = 0, partsChecked = 0;

// M33 (C-06 "M33 per-part verdicts"), by hand, independently of ledger.js. A part is a root event's
// recorded human turn ('T<n>'); a transferred child's event is in the part its verified spawn
// assignment is in. A part with any event in a window that did not complete (as `notRunCauses` reads
// a window) did not complete its review. Returns turn -> { complete }, or an empty Map for a session
// that records no turn (it keeps the whole-session reduction).
function partsByHand(report) {
  const events = Array.isArray(report.session?.events) ? report.session.events : [];
  const turnOf = new Map();
  for (const e of events) if (e.childId == null && /^T\d+$/.test(e.turn ?? '')) turnOf.set(e.id, e.turn);
  for (const e of events) {
    if (e.childId == null) continue;
    const spawn = (report.session.children ?? []).filter((link) => link.state === 'verified' && link.childId === e.childId
      && link.relation !== 'followup');
    const turns = new Set(spawn.map((link) => turnOf.get(link.assignmentEvent)));
    if (turns.size === 1 && [...turns][0]) turnOf.set(e.id, [...turns][0]);
  }
  const parts = new Map([...new Set(turnOf.values())].map((turn) => [turn, { complete: true }]));
  for (const w of report.windowResults ?? []) {
    if (w.failure === null && w.groundingComplete === true && w.challenge?.complete === true) continue;
    for (const id of w.eventIds ?? []) if (turnOf.has(id)) parts.get(turnOf.get(id)).complete = false;
  }
  return parts;
}
// Every window failing leaves the coverage missing too: no window's answer was usable.
const WINDOW_NOT_RUN = /^(window:incomplete|facts:windows_incomplete|facts:windows_unanswered|coverage_missing)$/;

function assertNotRunUnchecked(report, joined, md, label) {
  const notRun = notRunCauses(report);
  if (!notRun.length || (report.findings ?? []).some((f) => f.origin !== 'code-review' && f.status === 'DECIDE')) return;
  notRunChecked++;
  // M33 (C-06 "M33 per-part verdicts"): a failed window leaves only its parts unchecked. With more than
  // one part, and every not-run cause a window, the parts decide: each part with a failed window reads
  // UNCHECKED; the session reads UNCHECKED when no part completed, and NO_FINDINGS — never CLEAN — when
  // one did (with no finding at all).
  const parts = partsByHand(report);
  if (parts.size > 1 && notRun.every((cause) => WINDOW_NOT_RUN.test(cause))) {
    partsChecked++;
    const why = `${label}: ${notRun.join(', ')} — by part`;
    const recomputed = honestStatuses(joined);
    for (const [turn, { complete }] of parts) {
      if (complete) continue;
      for (const [where, list] of [['as produced', report.parts], ['recomputed', recomputed.parts]])
        assert.equal(list.find((p) => p.part === turn)?.status, 'UNCHECKED', `${why}: ${turn} did not complete (${where})`);
    }
    const anyComplete = [...parts.values()].some((part) => part.complete);
    const expected = !anyComplete ? 'UNCHECKED' : (report.findings ?? []).length ? null : 'NO_FINDINGS';
    for (const [where, status] of [['as produced', report.sessionStatus], ['recomputed', recomputed.sessionStatus]]) {
      assert.notEqual(status, 'CLEAN', `${why} (${where})`);
      if (expected) assert.equal(status, expected, `${why} (${where})`);
    }
    // D71 (a): rendered, the session review is said to have not completed — never by a status.
    assert.ok(md.includes(SESSION_NOT_COMPLETE) && md.includes(RUN_NOT_COMPLETE), `${why} (rendered)`);
    assert.doesNotMatch(md, ANY_STATUS, `${why} (rendered)`);
    return;
  }
  const why = `${label}: ${notRun.join(', ')} — the session review did not complete`;
  assert.equal(report.sessionStatus, 'UNCHECKED', why);
  assert.equal(honestStatuses(joined).sessionStatus, 'UNCHECKED', `${why} (recomputed)`);
  assert.ok(md.includes(SESSION_NOT_COMPLETE) && md.includes(RUN_NOT_COMPLETE), `${why} (rendered)`);
  assert.doesNotMatch(md, ANY_STATUS, `${why} (rendered)`);
}

function assertNeverClean(report, label) {
  const declared = declaredShortfalls(report);
  assert.ok(declared.length > 0, `${label}: the fixture declares nothing, so the invariant would hold vacuously`);
  const why = `${label} declares ${declared.join(', ')}`;
  const sessionSide = declared.some((s) => !s.startsWith('code-gap:'));
  const codeSide = declared.some((s) => s.startsWith('code-gap:'));
  // As produced.
  if (sessionSide) assert.notEqual(report.sessionStatus, 'CLEAN', `${why} — yet sessionStatus is CLEAN`);
  if (codeSide) assert.notEqual(report.codeStatus, 'CLEAN', `${why} — yet codeStatus is CLEAN`);
  assert.notEqual(report.reviewStatus, 'CLEAN', `${why} — yet reviewStatus is CLEAN`);
  // As joined to a code review that ran completely and found nothing — code-review.js's last
  // step — so reviewStatus can reach CLEAN at all and the assertion above is not vacuous for it.
  // For a code-side gap this is also the case that matters: the code review DECLARED itself
  // complete, and the gap alone must stop it certifying.
  const joined = { ...report, codeCoverage: 'complete' };
  const honest = honestStatuses(joined);
  if (sessionSide) assert.notEqual(honest.sessionStatus, 'CLEAN', `${why} — yet the recomputed sessionStatus is CLEAN`);
  if (codeSide) assert.notEqual(honest.codeStatus, 'CLEAN', `${why} — yet the recomputed codeStatus is CLEAN`);
  assert.notEqual(honest.reviewStatus, 'CLEAN', `${why} — yet the recomputed reviewStatus is CLEAN`);
  // As rendered: the reader never sees a CLEAN beside the gap — D71 (a): nor any other status.
  const md = renderReview(joined);
  assert.doesNotMatch(md, ANY_STATUS, `${why} — yet the render shows a status`);
  assert.ok(!md.includes(OVERALL_CLEAN), `${why} — yet the render's headline certifies the review`);
  assertNotRunUnchecked(report, joined, md, label);
}

// ---- fixtures --------------------------------------------------------------------------------

const TEXT = {
  ask: 'Split the migration out and keep the users schema unchanged.',
  brief: 'Write db/migrate.sql for the users table, nothing else.',
  cmd: 'npm test',
  out: 'Tests: 3 passed, 3 total',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];

/** A raw canonical session: one human instruction, one command that ran, optionally one hand-off. */
function rawSession({ children = [], delegate = true, actions = true, omitted = false } = {}) {
  return new Session({ sessionKey: 's', blobs: { ...TEXT }, children, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask'),
      ...(omitted ? { omitted: true } : {}) },
    ...(actions ? [
      { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Bash', operation: 'command',
        paths: [], command: whole('cmd'), input: [], changes: [] },
      { id: 'A1-r', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal',
        result: 'succeeded', exitCode: 0, output: whole('out'), sourceOfResult: 'native' },
    ] : []),
    ...(delegate ? [{ id: 'D1', kind: 'invocation', sequence: 3, callKey: 'd1', tool: 'Task',
      operation: 'delegate', paths: [], command: [], input: whole('brief'), changes: [] }] : []),
  ] });
}

/** A recording in the slicer's ledger shape, through the production adapter. */
const ACT = { turn: 1, seq: 0, kind: 'test', cmd: 'npm test', outcome: 'passed',
  exitCode: 0, exitCodeSource: 'native', tailLines: ['ok'] };
const BRIEF = { text: 'Write db/migrate.sql for the users table', tool: 'Task', field: 'prompt' };
const adapted = (ledger) => sessionFromLedger({ ask: [{ turn: 1, text: TEXT.ask }], ledger: [ACT], ...ledger },
  { sessionKey: 's' });

const ADAPTER = {
  'an unresolved delegation (adapter missing_child)': () => adapted({ delegations: [{ adapter: 'claude',
    callId: 'd1', turn: 1, childId: null, status: 'unresolved', reason: 'delegation_child_unchecked',
    source: 0, parentInstruction: BRIEF }] }),
  'an ambiguous delegation (adapter ambiguous_child)': () => adapted({ delegations: [{ adapter: 'claude',
    callId: 'd1', turn: 1, childId: null, status: 'unresolved', reason: 'delegation_child_ambiguous',
    source: 0, parentInstruction: BRIEF }] }),
  // The production route to F100: the slicer LINKED the child, but the ledger carries no child
  // evidence, so the adapter writes a `missing` ChildLink and declares no gap of its own.
  'a linked delegation whose child evidence never arrived (children state missing)': () => adapted({
    delegations: [{ adapter: 'claude', callId: 'd1', turn: 1, childId: 'kid', status: 'linked',
      reason: 'child_recording_linked', source: 0, link: { source: 0 }, parentInstruction: BRIEF }] }),
  'a recorder that only reports delegated_capture_unchecked': () => adapted({
    capture: { incomplete: true, reasons: ['delegated_capture_unchecked'] } }),
  'an instruction the recorder elided (adapter incomplete_inventory)': () => sessionFromLedger({
    ask: [{ turn: 1, text: 'Refactor the parser. [code block, 40 lines, 1300 chars] Keep the API.',
      elided: [{ kind: 'code block', lines: 40, chars: 1300 }] }], ledger: [ACT] }, { sessionKey: 's' }),
  'a file body the recorder truncated (adapter source_clipped)': () => adapted({ ledger: [ACT,
    { turn: 1, seq: 1, kind: 'edit', path: 'config/app.yml', via: 'Write',
      after: { text: 'a: 1\n[… truncated at 12000 chars …]', truncated: true, lines: 2 } }] }),
  // W3c-10: no code review is joined on these routes, so nothing is placed and nothing is covered
  // by a diff — a shell write to a PR file caps exactly like one to a file the PR does not have.
  'a shell write to a PR file no code review placed (adapter unrecorded_body)': () => adapted({ ledger: [ACT,
    { turn: 1, seq: 1, kind: 'bash', cmd: "sed -i 's/1/2/' src/app.js", outcome: 'passed', tailLines: [] },
    { turn: 1, seq: 2, kind: 'edit', path: 'src/app.js', via: 'sed -i' }] }),
  'a write with no recorded text to a file the PR does not have (adapter unrecorded_body)': () => adapted({
    ledger: [ACT, { turn: 1, seq: 1, kind: 'create', path: 'src/elsewhere.js' }] }),
};

const RAW = {
  'a delegation whose child link is missing': () => rawSession({ children: [{ assignmentEvent: 'D1', state: 'missing' }] }),
  'a delegation whose child link is ambiguous': () => rawSession({ children: [{ assignmentEvent: 'D1', state: 'ambiguous' }] }),
  'a delegation whose child link is conflicting': () => rawSession({ children: [{ assignmentEvent: 'D1', state: 'conflicting' }] }),
  'a delegation with no child link at all': () => rawSession({ children: [] }),
  // Not a C-03 ChildLink state. The ledger resolves only `verified`, so this is a declared gap.
  'a child link in a state C-03 does not define': () => rawSession({ children: [{ assignmentEvent: 'D1', state: 'linked' }] }),
  'an instruction the recorder elided (omitted: true)': () => rawSession({ delegate: false, omitted: true }),
};

// ---- through runReview ---------------------------------------------------------------------

for (const [name, make] of Object.entries({ ...RAW, ...ADAPTER })) {
  test(`F100 runReview: ${name} never reads CLEAN`, async () => {
    const report = await runReview({ session: make(), pr: completePr, judge: quiet() });
    assertNeverClean(report, name);
  });
}

test('F100 runReview: every window failing never reads CLEAN', async () => {
  const report = await runReview({ session: rawSession({ delegate: false }), pr: completePr, judge: async () => null });
  assert.ok(report.windowFailures.length > 0);
  assertNeverClean(report, 'windows failed');
});

test('M29 runReview: a judged zero-action session can be clean only for session coverage', async () => {
  const report = await runReview({ session: rawSession({ delegate: false, actions: false }), pr: completePr, judge: quiet() });
  assert.equal(report.coverageFacts.actions, 0);
  assert.ok(report.coverageFacts.reviewableEvents > 0);
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.reviewStatus, 'UNCHECKED', 'the combined request had no code review');
});

test('F100 runReview: a partial PR file list that leaves a decision unchecked never reads CLEAN', async () => {
  const decisionOnly = { ...EMPTY, decisions: [{
    dimension: 'cache backend', chosen: 'Redis', actions: ['E3'], value: 'config/redis.yml',
    valueReceipt: { eventId: 'E3', field: 'path', role: 'action', quote: 'config/redis.yml' },
    stated: { eventId: 'E2', role: 'commentary', quote: 'add a small Redis layer' },
    constrainedBy: { instruction: { eventId: 'E1', role: 'instruction', quote: 'Add response caching to the products API' },
      settles: false, settledValueQuote: null } }] };
  const partial = { repo, number: 1, enumeration: 'partial',
    files: [{ path: 'src/products.js', change: 'modified', contentState: 'complete' }] };
  const original = redisPivotSession();
  const session = new Session({ sessionKey: original.sessionKey, adapter: original.adapter,
    events: structuredClone(original.events), blobs: structuredClone(original.blobs) });
  session.event('E4').terminalStatusProven = true;
  const report = await runReview({ session, pr: partial, judge: quiet(decisionOnly) });
  assert.equal(report.decisions.length, 1, 'the decision grounded, so only its relevance is unchecked');
  assertNeverClean(report, 'partial PR file list');
});

// ---- through buildLedger directly ------------------------------------------------------------
// A caller that DECLARES both reviews complete. The ledger only ever downgrades a declaration;
// these are the downgrades a declared gap must force. A bare `omitted: true` declares no gap on
// its own — it reaches a verdict through the facts — so it is in the facts list below instead.

const DECLARING = Object.fromEntries(Object.entries({ ...RAW, ...ADAPTER })
  .filter(([name]) => name !== 'an instruction the recorder elided (omitted: true)'));

for (const [name, make] of Object.entries(DECLARING)) {
  test(`F100 buildLedger: ${name} never reads CLEAN`, () => {
    const report = buildLedger({ repo, session: make(), pr: completePr,
      sessionCoverage: 'complete', codeCoverage: 'complete' });
    assertNeverClean(report, name);
  });
}

// A producer derives its declaration from the facts, exactly as runReview does.
for (const [name, facts] of [
  ['windows failed', { windowsFailed: 1 }],
  ['zero reviewable events', { actions: 0, reviewableEvents: 0 }],
  ['zero windows', { windows: 0 }],
  ['an elided instruction', { instructionsElided: 1 }],
]) {
  test(`F100 buildLedger: ${name}, declared from the facts, never reads CLEAN`, () => {
    const session = rawSession({ delegate: false });
    const coverageFacts = { ...sessionCoverageFacts({ session, windows: [{}],
      perWindow: [{ narrative: EMPTY, challenge: { complete: true }, groundingComplete: true }] }), ...facts };
    const report = buildLedger({ repo, session, pr: completePr, codeCoverage: 'complete',
      sessionCoverage: coverageFrom(coverageFacts), coverageFacts });
    assertNeverClean(report, name);
  });
}

test('F100 buildLedger: a partial PR file list that leaves a decision unchecked never reads CLEAN', () => {
  const s = new Session({ sessionKey: 's', blobs: {}, events: [
    { id: 'W1', kind: 'invocation', sequence: 0, callKey: 'w1', tool: 'Write', operation: 'write',
      paths: [{ path: 'src/a.js' }], command: [], input: [], changes: [] },
    { id: 'W1-r', kind: 'observation', sequence: 1, invocation: 'W1', callKey: 'w1', phase: 'terminal',
      result: 'succeeded', terminalStatusProven: true, exitCode: 0, output: [], sourceOfResult: 'native' }] });
  const candidate = { actorSession: 's', dimension: 'retry strategy', chosen: 'exponential backoff',
    actions: ['W1'], value: null, valueReceipt: null, stated: null, constrainedBy: null };
  const report = buildLedger({ repo, session: s, candidates: [candidate],
    pr: { repo, number: 1, enumeration: 'partial', files: [{ path: 'src/b.js', change: 'modified', contentState: 'complete' }] },
    sessionCoverage: 'complete', codeCoverage: 'complete' });
  assertNeverClean(report, 'partial PR file list');
});

// ---- the last guard, on its own -------------------------------------------------------------

test('F100 honestStatuses: a declared gap caps coverage that the facts alone call complete', () => {
  const facts = { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1, instructions: 1,
    instructionsElided: 0, delegationsUnlinked: 0, adapterGaps: 0, declared: null };
  assert.equal(coverageFrom(facts), 'complete', 'the facts really do say complete');
  const gap = { code: 'missing_child', channel: 'children', scope: 'session', eventIds: ['D1'], count: 1 };
  const onReport = honestStatuses({ findings: [], coverageFacts: facts, codeCoverage: 'complete', gaps: [gap] });
  assert.equal(onReport.coverage, 'partial');
  // M33 (C-06): these facts are a completed review, and each gap is a declared recorder limit, so
  // the verdict is NO_FINDINGS — capped, named, never CLEAN. Before M33 it was UNCHECKED, which now
  // means the review itself did not complete (see the not-run causes in `assertNeverClean`).
  assert.equal(onReport.sessionStatus, 'NO_FINDINGS');
  assert.equal(onReport.reviewStatus, 'NO_FINDINGS', 'a clean code review beside it: NO_FINDINGS outranks CLEAN');
  const onSession = honestStatuses({ findings: [], coverageFacts: facts, codeCoverage: 'complete', gaps: [],
    session: { adapterGaps: [{ code: 'source_clipped', channel: 'code', scope: 'session', count: 1 }] } });
  assert.equal(onSession.coverage, 'partial');
  assert.equal(onSession.sessionStatus, 'NO_FINDINGS');
  // The cap is a ceiling, not a floor: it never raises a missing review to partial.
  const missing = honestStatuses({ findings: [], coverageFacts: { ...facts, actions: 0 }, codeCoverage: 'complete', gaps: [gap] });
  assert.equal(missing.coverage, 'missing');
  // And with nothing declared, a complete reading still reads CLEAN — the guard is not a blanket.
  const clean = honestStatuses({ findings: [], coverageFacts: facts, codeCoverage: 'complete', gaps: [] });
  assert.equal(clean.sessionStatus, 'CLEAN');
  assert.equal(clean.reviewStatus, 'CLEAN');
});

// ---- W3c-8: a gap caps its own channel (F116), and nothing upgrades a derived partial (F117) ----

const COMPLETE_FACTS = () => ({ windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1,
  instructions: 1, instructionsElided: 0, delegationsUnlinked: 0, adapterGaps: 0, declared: null });
// A loss of the CODE review: a changed file of the PR it could not read.
const PR_CODE_GAP = () => ({ code: 'source_clipped', channel: 'code', scope: 'pr', count: 1 });

test('W3c-8 honestStatuses: a code-channel gap alone caps the code review and the overall verdict, not the session', () => {
  assert.equal(coverageFrom(COMPLETE_FACTS()), 'complete', 'the session facts really do say complete');
  const honest = honestStatuses({ findings: [], coverageFacts: COMPLETE_FACTS(), codeCoverage: 'complete',
    gaps: [PR_CODE_GAP()] });
  assert.equal(honest.coverage, 'complete', 'a file the code review could not read is not a loss of the session');
  assert.equal(honest.sessionStatus, 'CLEAN', 'the session was read in full, so it may say so');
  assert.equal(honest.codeCoverage, 'partial', 'the code review declared complete, but the gap caps it');
  assert.equal(honest.codeStatus, 'UNCHECKED');
  assert.equal(honest.reviewStatus, 'UNCHECKED', 'any gap still stops an overall CLEAN');
  // A ceiling, never a floor: a code review that did not run stays not run.
  const notRun = honestStatuses({ findings: [], coverageFacts: COMPLETE_FACTS(), codeCoverage: 'missing',
    gaps: [PR_CODE_GAP()] });
  assert.equal(notRun.codeCoverage, 'missing');
});

test('W3c-8 honestStatuses: a recorder cut in a session write body caps the session, never the code review', () => {
  // The adapter's own declaration (sonah-ledger.js adapterGaps). Channel `code` names WHICH text
  // was cut; scope `session` names whose: the recording's, which the code review never reads.
  const honest = honestStatuses({ findings: [], coverageFacts: COMPLETE_FACTS(), codeCoverage: 'complete', gaps: [],
    session: { adapterGaps: [{ code: 'source_clipped', channel: 'code', scope: 'session', count: 1 }] } });
  assert.equal(honest.coverage, 'partial');
  // M33 (C-06): a completed review over a recorder's cut reads NO_FINDINGS, never CLEAN.
  assert.equal(honest.sessionStatus, 'NO_FINDINGS');
  assert.equal(honest.codeCoverage, 'complete', 'the diff the code review read was not cut');
  assert.equal(honest.reviewStatus, 'NO_FINDINGS');
});

test('W3c-8 honestStatuses: a gap on no channel this code recognises caps BOTH reviews', () => {
  // An unplaceable loss cannot be assigned to one review, so it must stop a CLEAN on either.
  for (const gap of [{ code: 'incomplete_inventory', count: 1 },
    { code: 'incomplete_inventory', channel: 'somewhere-new', scope: 'session', count: 1 },
    { code: 'source_clipped', channel: 'code', count: 1 }]) {
    const honest = honestStatuses({ findings: [], coverageFacts: COMPLETE_FACTS(), codeCoverage: 'complete', gaps: [gap] });
    const label = JSON.stringify(gap);
    // M33 (C-06): the session review completed, and the unplaceable gap is a declared limit on it:
    // NO_FINDINGS, never CLEAN. The code review it also caps stays UNCHECKED, and so does the whole.
    assert.equal(honest.sessionStatus, 'NO_FINDINGS', `${label} left the session CLEAN`);
    assert.equal(honest.codeStatus, 'UNCHECKED', `${label} left the code review CLEAN`);
    assert.equal(honest.reviewStatus, 'UNCHECKED', `${label} left the review CLEAN`);
  }
});

test('W3c-8 buildLedger joined to a code review that could not read a file: never CLEAN overall, session may be', () => {
  // code-review.js's last step, by hand: a fully-read session, a code review that declares
  // itself complete, one PR-scoped code gap appended, statuses recomputed from the assembled report.
  const session = rawSession({ delegate: false });
  const coverageFacts = sessionCoverageFacts({ session, windows: [{}],
    perWindow: [{ narrative: EMPTY, challenge: { complete: true }, groundingComplete: true }] });
  const report = buildLedger({ repo, session, pr: completePr, codeCoverage: 'complete',
    sessionCoverage: coverageFrom(coverageFacts), coverageFacts });
  assert.equal(report.sessionStatus, 'CLEAN', 'the fixture is a clean session before the code gap');
  const joined = { ...report, gaps: [...report.gaps, PR_CODE_GAP()] };
  Object.assign(joined, honestStatuses(joined));
  assertNeverClean(joined, 'a PR-scoped code gap');
  assert.equal(joined.sessionStatus, 'CLEAN', 'the code gap does not touch a fully-read session');
  assert.equal(joined.codeStatus, 'UNCHECKED');
  // D71 (a): rendered, the fully-read session is said to have completed and the code review not to have read every
  // file — never by a status.
  const md = renderReview(joined);
  assert.ok(md.includes('Session review: **complete**') && md.includes('Code review: **did not read every file**'), md);
});

test('F117 honestStatuses never upgrades a partial that buildLedger derived from a rejected decision', () => {
  const session = rawSession({ delegate: false });
  const coverageFacts = sessionCoverageFacts({ session, windows: [{}],
    perWindow: [{ narrative: EMPTY, challenge: { complete: true }, groundingComplete: true }] });
  assert.equal(coverageFrom(coverageFacts), 'complete', 'the facts are clean: they do not count rejections');
  // A model-rated confidence rejects the whole candidate (FORBIDDEN_MODEL_FIELDS).
  const forged = { actorSession: 's', dimension: 'test runner', chosen: 'npm test', actions: ['A1'],
    value: null, valueReceipt: null, stated: null, constrainedBy: null, confidence: 0.9 };
  const report = buildLedger({ repo, session, pr: completePr, candidates: [forged], codeCoverage: 'complete',
    sessionCoverage: coverageFrom(coverageFacts), coverageFacts });
  assert.equal(report.rejectedDecisions.length, 1);
  assert.equal(report.coverage, 'partial', 'buildLedger derived partial from the rejection');
  const honest = honestStatuses(report);
  assert.equal(honest.coverage, 'partial', 'the clean facts must not upgrade it back to complete');
  assert.equal(honest.sessionStatus, 'UNCHECKED');
  assert.equal(honest.reviewStatus, 'UNCHECKED');
  assertNeverClean(report, 'a rejected decision beside clean facts');
  // And the facts still lower it: never-upgrade is a floor on neither side.
  const lowered = honestStatuses({ ...report, coverage: 'complete', coverageFacts: { ...coverageFacts, windowsFailed: 1 } });
  assert.equal(lowered.coverage, 'partial');
});

test('F100 a verified child is not a gap: the invariant does not make every delegation UNCHECKED', async () => {
  const session = rawSession({ children: [{ assignmentEvent: 'D1', childSession: 'kid', state: 'verified' }] });
  const report = await runReview({ session, pr: completePr, judge: quiet() });
  assert.deepEqual(declaredShortfalls(report), []);
  assert.equal(report.coverage, 'complete');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(honestStatuses({ ...report, codeCoverage: 'complete' }).reviewStatus, 'CLEAN');
});

// ---- M29: path-only diff placement never covers a missing historical body -------------------------
//
// The join is code-review.js's last step, by hand: the session review's report, a code review
// that declares itself complete and records what it placed, statuses recomputed from the whole.
// Every repository write still caps; an outside-repo write is the noncapping control.

const shellWriteTo = (path) => adapted({ ledger: [ACT,
  { turn: 1, seq: 1, kind: 'bash', cmd: `sed -i 's/1/2/' ${path}`, outcome: 'passed',
    exitCode: 0, exitCodeSource: 'native', tailLines: [] },
  { turn: 1, seq: 2, kind: 'edit', path, via: 'sed -i', shellWriteStatusEligible: true }] });
const prWith = (files) => ({ repo, number: 1, enumeration: 'complete',
  files: files.map(([path, contentState = 'complete']) => ({ path, change: 'modified', contentState })) });
async function joinedTo({ session, pr, placed }) {
  const report = await runReview({ session, pr, judge: quiet() });
  const joined = { ...report, codeCoverage: 'complete', codeCoverageFacts: { placed } };
  return Object.assign(joined, honestStatuses(joined));
}

test('W3c-10 joined: a shell write to a PR file the code review placed but was supplied partial never reads CLEAN', async () => {
  const joined = await joinedTo({ session: shellWriteTo('src/app.js'),
    pr: prWith([['src/app.js', 'partial']]), placed: ['src/app.js'] });
  assert.deepEqual(declaredShortfalls(joined).filter((s) => s.endsWith('unrecorded_body')).length, 2,
    'the write is a shortfall: the diff that would cover it was not complete');
  assertNeverClean(joined, 'a shell write to a partially supplied PR file');
});

test('W3c-10 joined: a shell write to a PR file the code review did not place never reads CLEAN', async () => {
  const joined = await joinedTo({ session: shellWriteTo('src/app.js'),
    pr: prWith([['src/app.js'], ['src/other.js']]), placed: ['src/other.js'] });
  assertNeverClean(joined, 'a shell write to an unplaced PR file');
});

test('W3c-10 joined: a shell write to a repository file the PR does not have never reads CLEAN', async () => {
  const joined = await joinedTo({ session: shellWriteTo('src/not-in-pr.js'),
    pr: prWith([['src/app.js']]), placed: ['src/app.js'] });
  assertNeverClean(joined, 'a shell write outside the PR');
});

test('M29 joined: a same-path placed diff cannot make an unrecorded shell body CLEAN', async () => {
  const joined = await joinedTo({ session: shellWriteTo('src/app.js'),
    pr: prWith([['src/app.js']]), placed: ['src/app.js'] });
  assert.ok(joined.gaps.some((g) => g.code === 'unrecorded_body'), 'the write is still declared');
  assert.ok(declaredShortfalls(joined).some((s) => s.endsWith('unrecorded_body')),
    'the reviewed diff is not the missing historical body');
  assert.equal(joined.coverage, 'partial');
  // M33 (C-06): the session review completed; the missing body is a recorder limit. NO_FINDINGS,
  // beside a clean code review — never CLEAN. Before M33, UNCHECKED.
  assert.equal(joined.sessionStatus, 'NO_FINDINGS');
  assert.equal(joined.reviewStatus, 'NO_FINDINGS');
  assert.ok(renderReview(joined).includes('- `unrecorded_body`'), 'and it is still listed as not checked');
});

test('W3c-10 the lift is only ever the unrecorded-write cap: a partial with another cause is never raised', async () => {
  // A rejected candidate lowers the session by a cause the facts do not count (F117). The report
  // also carries a covered shell write — the lift must not use the covering diff to clear the
  // rejection along with the write.
  const forged = { ...EMPTY, decisions: [{ dimension: 'sed target', chosen: 'src/app.js', actions: ['A1-1'],
    value: null, valueReceipt: null, stated: null, constrainedBy: null, confidence: 0.9 }] };
  const report = await runReview({ session: shellWriteTo('src/app.js'), pr: prWith([['src/app.js']]), judge: quiet(forged) });
  const joined = { ...report, codeCoverage: 'complete', codeCoverageFacts: { placed: ['src/app.js'] } };
  Object.assign(joined, honestStatuses(joined));
  assert.ok(declaredShortfalls(joined).length > 0, 'the fixture declares a shortfall other than the covered write');
  assertNeverClean(joined, 'a rejected decision beside a covered shell write');
  // And a report somebody lowered by hand after the fact keeps its lowering.
  const lowered = honestStatuses({ ...joined, coverage: 'missing' });
  assert.equal(lowered.coverage, 'missing');
});

// ---- M33 G5: a decision citing a parent's action and its verified child's --------------------------
//
// C-06 (M33 G4): the grounding check ran and could not name ONE actor, so the decision is withheld and
// counted — never published — and it does not by itself make the session review incomplete. Beside a
// declared recorder limit the verdict is therefore NO_FINDINGS (capped, named, never CLEAN), not
// UNCHECKED. The same reason without that cause is a proposal no check could evaluate as proposed,
// and still means the review did not complete.

const FAMILY = {
  ask: 'Split the worker out of the index module.',
  brief: 'Write src/worker.js with the worker loop, nothing else.',
  root: 'export const INDEX_READY = 1;\n',
  child: 'export const WORKER_READY = 2;\n',
  out: 'File created successfully',
};
const family = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(FAMILY[key], 'utf8') }];
/** A parent that delegates to a verified child; each writes one file, and each write succeeded. */
function familySession({ limit = true } = {}) {
  const write = (id, path, body, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Write', operation: 'write',
    paths: [{ path }], command: [], input: [], changes: [{ path, before: [], after: family(body), diff: [] }], ...over });
  const result = (id, invocation, over = {}) => ({ id, kind: 'observation', phase: 'terminal', invocation, callKey: invocation,
    result: 'succeeded', exitCode: null, terminalStatusProven: true, sourceOfResult: 'native', output: family('out'), ...over });
  const session = new Session({ sessionKey: 's', adapter: 'claude', blobs: { ...FAMILY }, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: family('ask') },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Task', operation: 'delegate', paths: [], command: [],
      input: family('brief'), changes: [] },
    write('child:w:A1', 'src/worker.js', 'child', { childId: 'w' }), result('child:w:O1', 'child:w:A1', { childId: 'w' }),
    write('A1', 'src/index.js', 'root'), result('O1', 'A1'),
  ].map((event, sequence) => ({ ...event, sequence })),
  children: [{ assignmentEvent: 'D1', childId: 'w', childSession: 's/child:w', sessionKey: 's/child:w',
    relation: 'spawn', state: 'verified', historyStart: null }] });
  // One declared recorder limit, so a completed review can read NO_FINDINGS and the invariant has
  // something declared to hold against.
  if (limit) session.adapterGaps = [{ code: 'incomplete_inventory', channel: 'commentary', scope: 'session', count: 1,
    note: 'synthetic declared recorder limit' }];
  return session;
}
const MIXED = { dimension: 'worker placement', chosen: 'a separate worker module', value: null, valueReceipt: null,
  actions: ['A1', 'child:w:A1'], stated: null, constrainedBy: null };
// M36 phase 3 (D68 K, c6): the parent's and the helper's results say the same words, and a packed window shows both, so a
// vote quoting them would lie in two sessions' shown text (`actor_ambiguous`); the vote quotes the parent's own path.
const familyJudge = (narrative) => async (request) => (request.challenge
  ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'Synthetic support vote for orchestration testing.',
    receipts: [{ eventId: 'A1', role: 'action', quote: 'src/index.js' }] })) }
  : narrative);

test('M33 G5 premise: the family fixture cites two actors', () => {
  const session = familySession();
  assert.equal(session.actorForActions(['A1']).state, 'root');
  assert.equal(session.actorForActions(['child:w:A1']).state, 'verified-child');
  assert.equal(session.actorForActions(MIXED.actions).state, 'ambiguous');
});

// M35 (windowing): a helper is a session of its own. M36 phase 3 (D68 K): a small one shares its parent's window, under
// its own heading, so the window shows the parent's action beside its helper's: a decision citing both is asked, and the
// ledger's own actor check withholds it (`actor_ambiguous`, D58: inconclusive, counted, never published).
for (const [route, scope] of [['session-only', { pr: null, reviewScope: 'session-only' }], ['combined', { pr: completePr }]]) {
  test(`M33 G5, M35 runReview (${route}): a parent+child decision beside a declared limit is withheld and reads NO_FINDINGS`, async () => {
    const report = await runReview({ session: familySession(), ...scope, judge: familyJudge({ ...EMPTY, decisions: [MIXED] }) });
    assert.deepEqual(report.windowResults.map((w) => (w.sessions ?? [{ session: w.session }]).map((part) => part.session.childId)),
      [[null, 'w']], 'premise: the helper shares its parent\'s window');
    assert.equal(report.withheld.proposals, 1, 'premise: withheld once, by the ledger\'s actor check');
    assert.equal(report.withheld.causes.actor_ambiguous, 1);
    assert.deepEqual(report.decisions, [], 'never published');
    assert.deepEqual(notRunCauses(report), [], 'the independent oracle: withheld, not a check that did not run');
    assert.equal(report.sessionReview, 'complete');
    assert.equal(report.coverage, 'partial', 'the declared recorder limit caps the coverage');
    assert.equal(report.sessionStatus, 'NO_FINDINGS');
    assert.equal(honestStatuses({ ...report, codeCoverage: 'complete' }).sessionStatus, 'NO_FINDINGS', 'recomputed');
    // D71 (a): rendered, a completed session review over a recorder limit, its causes named — never a status.
    const md = renderReview(report);
    assert.ok(md.includes('Session review: **complete**') && md.includes('Not covered: '), 'rendered');
    assert.doesNotMatch(md, ANY_STATUS, 'rendered');
    assertNeverClean(report, `a parent+child decision (${route})`);
  });
}

test('M33 G5 runReview: the same withheld decision with nothing declared is not a not-run cause either', async () => {
  const report = await runReview({ session: familySession({ limit: false }), pr: null, reviewScope: 'session-only',
    judge: familyJudge({ ...EMPTY, decisions: [MIXED] }) });
  assert.equal(report.withheld.proposals, 1, 'M36 phase 3: withheld by the ledger\'s actor check');
  assert.deepEqual(notRunCauses(report), []);
  assert.equal(report.sessionReview, 'complete');
  assert.notEqual(report.sessionStatus, 'UNCHECKED', 'a withheld decision does not by itself leave the review incomplete');
});

test('M33 G5 buildLedger: a decision naming another actor than its actions resolve to still reads UNCHECKED', () => {
  const session = familySession();
  const coverageFacts = sessionCoverageFacts({ session, windows: [{}],
    perWindow: [{ narrative: EMPTY, challenge: { complete: true }, groundingComplete: true }] });
  const named = { ...MIXED, actions: ['child:w:A1'], actorSession: 's' };
  const report = buildLedger({ repo, session, pr: null, reviewScope: 'session-only', candidates: [named],
    sessionCoverage: coverageFrom(coverageFacts), coverageFacts });
  assert.deepEqual(report.rejectedDecisions.map((r) => [r.reason, r.cause]), [['ambiguous_authority', undefined]],
    'premise: the same reason, with no withheld cause');
  assert.deepEqual(notRunCauses(report), ['rejected:ambiguous_authority']);
  const before = notRunChecked;
  assertNeverClean(report, 'a decision naming another actor');
  assert.equal(notRunChecked, before + 1, 'the not-run invariant was applied to it');
});

test('M33 G5 honestStatuses: only a decision rejected ambiguous_authority for actor_ambiguous is withheld', async () => {
  const report = await runReview({ session: familySession(), pr: null, reviewScope: 'session-only',
    judge: familyJudge({ ...EMPTY, decisions: [MIXED] }) });
  assert.equal(report.sessionStatus, 'NO_FINDINGS', 'premise: the withheld decision beside a declared limit');
  // M35: no window's decision reaches the ledger citing two actors; the ledger's own rule is checked on the candidate.
  const candidate = { ...MIXED, actorSession: 's' };
  for (const rejection of [
    { reason: 'ambiguous_authority' },
    { reason: 'ambiguous_authority', cause: 'role_missing' },
    { reason: 'ambiguous_authority', cause: 'actor_ambiguous_extra' },
    { reason: 'kind_rejected', cause: 'actor_ambiguous' },
    { reason: 'no_actions', cause: 'actor_ambiguous' },
    { reason: 'unreviewed_scope', cause: 'actor_ambiguous' },
  ]) {
    const forged = { ...report, rejectedDecisions: [{ candidate, ...rejection }] };
    Object.assign(forged, honestStatuses(forged));
    const label = `a decision rejected ${JSON.stringify(rejection)}`;
    assert.ok(notRunCauses(forged).length > 0, `${label}: the oracle names a not-run cause`);
    const before = notRunChecked;
    assertNeverClean(forged, label);
    assert.equal(notRunChecked, before + 1, `${label}: the not-run invariant was applied`);
  }
});

// ---- M33 per-part verdicts: a failed window limits only its own parts ------------------------------

/** Two recorded human turns in two windows (a compaction between them): raw, or through the adapter. M35 (windowing):
 *  a compaction splits no window, so each turn opens with a long statement (400,000 bytes) that puts it in a window of
 *  its own, in either scope. */
const LONG = `Working through it.\n${'w'.repeat(400_000)}`;
function twoTurns() {
  const T1 = { turn: 'T1' }, T2 = { turn: 'T2' };
  const long = [{ sourceKey: 'long', fromByte: 0, untilByte: LONG.length }];
  return new Session({ sessionKey: 's', blobs: { ...TEXT, long: LONG }, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    { id: 'C1', kind: 'commentary', phase: 'working', beforeInvocation: null, text: long, ...T1 },
    { id: 'A1', kind: 'invocation', callKey: 'a1', tool: 'Bash', operation: 'command', paths: [], command: whole('cmd'),
      input: [], changes: [], ...T1 },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'a1', phase: 'terminal', result: 'succeeded', exitCode: 0,
      output: whole('out'), sourceOfResult: 'native', ...T1 },
    { id: 'B1', kind: 'boundary', boundary: 'compaction', relatedSession: null, ...T1 },
    { id: 'I2', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T2 },
    { id: 'C2', kind: 'commentary', phase: 'working', beforeInvocation: null, text: long, ...T2 },
    { id: 'A2', kind: 'invocation', callKey: 'a2', tool: 'Bash', operation: 'command', paths: [], command: whole('cmd'),
      input: [], changes: [], ...T2 },
    { id: 'A2-r', kind: 'observation', invocation: 'A2', callKey: 'a2', phase: 'terminal', result: 'succeeded', exitCode: 0,
      output: whole('out'), sourceOfResult: 'native', ...T2 },
  ].map((event, sequence) => ({ ...event, sequence })) });
}
const twoAdaptedTurns = () => sessionFromLedger({ ask: [{ turn: 1, text: TEXT.ask }, { turn: 2, text: TEXT.brief }],
  ledger: [ACT, { ...ACT, turn: 2 }], marks: [{ kind: 'compaction', turn: 1 }],
  commentary: [{ turn: 1, beforeEvent: 0, text: LONG }, { turn: 2, beforeEvent: 1, text: LONG }] }, { sessionKey: 's' });
/** `quiet`, except that the narrative call of each window in `failing` fails. */
const failingWindows = (failing) => async (request) => {
  if (!request.challenge && failing.includes(request.window.index))
    throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' });
  return quiet()(request);
};

for (const [name, make] of [['raw', twoTurns], ['adapted', twoAdaptedTurns]]) {
  for (const [what, failing, expected] of [['the second part\'s window failed', [1], 'NO_FINDINGS'],
    ['the first part\'s window failed', [0], 'NO_FINDINGS'], ['every window failed', [0, 1], 'UNCHECKED']]) {
    test(`M33 per-part oracle (${name}): ${what} — its part UNCHECKED, the session ${expected}, never CLEAN`, async () => {
      for (const [scope, pr] of [['session-only', null], ['combined', completePr]]) {
        const report = await runReview({ session: make(), pr, reviewScope: scope, judge: failingWindows(failing) });
        assert.equal(partsByHand(report).size, 2, 'premise: two parts');
        assert.equal(report.windowResults.length, 2, 'premise: one window per part');
        const before = partsChecked;
        assertNeverClean(report, `${name} ${scope}: ${what}`);
        assert.equal(partsChecked, before + 1, 'the per-part oracle was applied');
        assert.equal(report.sessionStatus, expected);
      }
    });
  }
}

test('M33 the not-run invariant was exercised: every not-run cause above read UNCHECKED, never NO_FINDINGS', () => {
  assert.ok(notRunChecked >= 5, `only ${notRunChecked} fixture(s) carried a not-run cause, so the invariant held vacuously`);
  assert.ok(partsChecked >= 12, `only ${partsChecked} fixture(s) exercised the per-part oracle`);
});
