// M33 P (C-03 "M33 child placement", amended), end to end through the loader a session-only review uses. Helpers that ran
// CONCURRENTLY with their parent in a Codex session gave two false DECIDEs:
// the helper's whole history sat right after its spawn, so a helper edit and a failing helper test made after the
// parent's claim read as recorded before it. And on a Claude Code session a Workflow verifier's stale failure read as
// recorded after the parent's post-fix rerun. Each helper's work is now placed where the parent RECEIVED its result, by
// exact recorded identity only (an encrypted payload's arrival, byte for byte; a FINAL_ANSWER's sender; a notification's
// call id and agentId) — never by timestamp — and the concurrency is stated in the evidence. Synthetic Codex rollouts and
// Claude Code projects trees; a deterministic probe judge whose challenger refutes when shown a later supersession; both
// review profiles. No recording of anyone's, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { redact } from '../../redact/index.js';
import { sliceLineage } from '../../slicer/index.js';
import { HELPER_RECEIPT_BOUNDARY, HELPER_PLACEMENT_NOTES, HELPER_DELIVERY_GAP_NOTES, WORKFLOW_GAP_NOTES }
  from '../../evidence/adapters/sonah-ledger.js';
// C-01 event identity: sessions are registered, and their events named by positional labels (stable-ids-fixture.js).
import { adapt, named, labelOf } from '../../evidence/test/stable-ids-fixture.js';
import { runReview } from '../../evidence/src/run-review.js';
import { partAttribution } from '../../evidence/src/ledger.js';
import { windowNarrative, fixtureJudge } from './m33-fast-profile-fixture.js';
import { AGENTS, RUN, SID as W_SID, SLUG, linkedRun, mkdir, rm as wrm, scratch, writeTree } from './m33-w-workflow-fixture.js';
import { W2_TEXT, receivedLaterRows, verifierBeforeFixRows } from './m33-w2-placement-fixture.js';
import { TEXT, CLAUDE_TEXT, TOKENS, arrival, codexConcurrentHelperRows, codexConcurrentRows, claudeParentRows, claudeTree, codexTree, decided,
  followupHelperRows, followupRows, probeJudge, rm, sendMessage } from './m33-p-placement-fixture.js';

const PROFILES = [undefined, 'm33-lean'];
// C-01 event identity: an event is shown by its positional label (`labelOf`); `at` finds one by its label or its id.
const ids = (session) => session.events.map((event) => labelOf(session, event.id));
const at = (session, id) => {
  const index = session.events.findIndex((event) => event.id === id || labelOf(session, event.id) === id);
  assert.ok(index >= 0, id);
  return index;
};
const commentaryId = (session, words) => session.events.find((event) => event.kind === 'commentary'
  && session.textOf(event, 'text').includes(words)).id;
const resultId = (session, words, childOnly = false) => session.events.find((event) => event.kind === 'observation'
  && (!childOnly || event.childId) && session.textSpansOf(event, 'output').join('').includes(words)).id;
const receipts = (session) => session.events.filter((event) => event.boundary === HELPER_RECEIPT_BOUNDARY);
const review = (session, judge, speedProfile) => runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
  ...(speedProfile ? { speedProfile } : {}), judge });

async function codexLedger(t, rows, helpers = [codexConcurrentHelperRows()]) {
  const tree = await codexTree(rows, helpers);
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  return redact(await loadSessionEvidence([tree.root], { recordingRoots: { codex: tree.dir }, reviewLinkedChildren: true })).ledger;
}
async function claudeLedger(t, rows) {
  const tree = await claudeTree(rows);
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  await mkdir(join(tree.dir, 'codex'), { recursive: true });
  return redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(tree.dir, 'codex') } })).ledger;
}
/** The placement before this rule, for the premises: the same ledger with no delivery record. */
const unplaced = ({ helperSegments, helperDeliveryLosses, ...ledger }) => ledger;

// ---- the concurrent Codex helper shape ------------------------------------------------------------------------------

test('M33 P concurrent Codex helper: a Codex helper\'s edit and failing test made after the parent\'s claim are shown after it, stated', async (t) => {
  const ledger = await codexLedger(t, codexConcurrentRows());
  // Rows: 1 meta, 2 ask, 3 plan, 4-5 the parent's passing run, 6 the spawn, 7 its result, 8 the claim, 9 the report.
  assert.deepEqual(ledger.helperSegments, [{ child: 0, segments: [{ delivery: { delegation: 0 },
    arrival: { turn: 0, beforeEvent: 0, source: 0, record: 2 }, receipt: { turn: 1, beforeEvent: 1, source: 0, record: 9 } }] }]);
  for (const secret of Object.values(TOKENS)) assert.equal(JSON.stringify(ledger).includes(secret), false, 'no token is stored');
  const session = adapt(ledger, { sessionKey: 'm33-p-codex-concurrent' });
  const claim = commentaryId(session, TEXT.claimQuote);
  const failure = resultId(session, TEXT.failQuote, true);
  const [delegate] = session.delegations();
  assert.ok(at(session, delegate.id) < at(session, claim), 'the spawn stays where it was recorded');
  assert.ok(at(session, claim) < at(session, failure), 'the helper\'s failing run is shown after the claim');
  const [boundary] = receipts(session);
  assert.deepEqual([boundary.delivery, boundary.assignments], [delegate.id, [delegate.id]]);
  assert.ok(at(session, claim) < at(session, boundary.id) && at(session, boundary.id) < at(session, failure)
    && at(session, failure) < at(session, session.observationFor(delegate.id).id),
  'claim, receipt, the helper\'s work, then its report');
  // Before: the same ledger with the history behind its spawn showed the failure before the claim.
  const before = adapt(unplaced(ledger), { sessionKey: 'm33-p-codex-concurrent' });
  assert.ok(at(before, resultId(before, TEXT.failQuote, true)) < at(before, claim));
});

test('M33 P concurrent Codex helper: no DECIDE in either profile, whatever the placement', async (t) => {
  // M35 windowing: the helper is a session of its own, so no window ever sets its failing run against the parent's
  // claim — with the placement (as before) and now without it too (the old placement's false DECIDE was the premise).
  const ledger = await codexLedger(t, codexConcurrentRows());
  for (const speedProfile of PROFILES) {
    for (const [layout, built, expected] of [['placed', ledger, false], ['before', unplaced(ledger), false]]) {
      const session = adapt(built, { sessionKey: 'm33-p-codex-concurrent' });
      const spec = { claims: [{ id: commentaryId(session, TEXT.claimQuote), quote: TEXT.claimQuote }],
        failures: [{ id: resultId(session, TEXT.failQuote, true), quote: TEXT.failQuote }],
        passes: [{ id: resultId(session, TEXT.passQuote), quote: TEXT.passQuote }] };
      const statuses = decided(await review(session, probeJudge(spec), speedProfile));
      assert.equal(statuses.includes('DECIDE'), expected, `${layout}, ${speedProfile ?? 'standard'}: ${statuses}`);
    }
  }
});

test('M35 P concurrent Codex helper: a parent\'s relay of a helper result it received is not set against the helper\'s own run', async (t) => {
  // M33 P: a claim after the receipt of a contradicting helper result was DECIDE. M35 windowing: the helper's failing
  // run is in the helper's own window, never the parent's, so the parent's relay claim cites a result its window was
  // not shown and is not published. This is a known loss of the M33 H relay route (D67): the parent's window
  // shows only what the parent received back (the hand-off's result).

  const ledger = await codexLedger(t, codexConcurrentRows({ relay: true }));
  const session = adapt(ledger, { sessionKey: 'm33-p-relay' });
  const failure = resultId(session, TEXT.failQuote, true);
  assert.ok(at(session, failure) < at(session, commentaryId(session, TEXT.relayQuote)), 'received before the relay claim');
  for (const speedProfile of PROFILES) {
    const spec = { claims: [{ id: commentaryId(session, TEXT.claimQuote), quote: TEXT.claimQuote },
      { id: commentaryId(session, TEXT.relayQuote), quote: TEXT.relayQuote }],
    failures: [{ id: failure, quote: TEXT.failQuote }], passes: [{ id: resultId(session, TEXT.passQuote), quote: TEXT.passQuote }] };
    const report = await review(session, probeJudge(spec), speedProfile);
    const findings = report.findings.filter((f) => f.kind === 'claim_contradicted');
    assert.deepEqual(findings.map((f) => f.status), [], speedProfile ?? 'standard');
  }
});

// ---- the Claude Code verifier-before-fix shape ------------------------------------------------------------------------

async function workflowLedger(t, rowsOf) {
  const dir = await scratch('sonah-m33-p-wf-');
  t.after(() => wrm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const transcriptDir = join(dir, 'projects', SLUG, W_SID, 'subagents', 'workflows', RUN);
  const tree = await writeTree(dir, { parent: rowsOf({ transcriptDir }), run: linkedRun() });
  await mkdir(join(dir, 'codex'), { recursive: true });
  return redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(dir, 'codex') } })).ledger;
}
const STALE = `child:${AGENTS.fixer}:A1-1-r`;
/** d7226ec's placement: no receipt recorded, and no Claude action recording a row. */
const d7226ec = (ledger) => ({ ...ledger, workflowRuns: ledger.workflowRuns.map(({ receipt, ...run }) => run),
  ledger: ledger.ledger.map(({ sourceLocator, ...act }) => act) });

test('M33 P cc verifier-before-fix: no DECIDE in either profile; d7226ec\'s placement was the false DECIDE', async (t) => {
  const ledger = await workflowLedger(t, verifierBeforeFixRows);
  // The premise (d7226ec's placement — the agents after the turn's last action, before the claim — was the false
  // DECIDE) was established against d7226ec itself. M33 P repair: the current adapter can no longer reproduce that
  // layout from a stripped ledger — a run with no receipt now stands after its launch request's own work (the claim
  // included), so the stripped ledger reads no DECIDE either.
  for (const speedProfile of PROFILES)
    for (const [layout, built, expected] of [['placed', ledger, false], ['no receipt', d7226ec(ledger), false]]) {
      const session = adapt(built, { sessionKey: 'm33-p-cc' });
      const spec = { claims: [{ id: commentaryId(session, W2_TEXT.claim), quote: W2_TEXT.claim }],
        failures: [{ id: STALE, quote: 'nested input > keeps nested arrays' }],
        passes: [{ id: 'A1-2-r', quote: 'Tests: 12 passed, 12 total' }] };
      const statuses = decided(await review(session, probeJudge(spec), speedProfile));
      assert.equal(statuses.includes('DECIDE'), expected, `${layout}, ${speedProfile ?? 'standard'}: ${statuses}`);
    }
  // With no receipt recorded, the agents are never moved back past parent work recorded after the launch (M33 P repair,
  // recheck minor: at the launch they read ahead of the parent's later claim, a new false DECIDE path): they stand
  // after the launch request's own work, and that is declared.
  const none = adapt(await workflowLedger(t, (o) => verifierBeforeFixRows({ ...o, notification: false })),
    { sessionKey: 'm33-p-cc' });
  assert.ok(at(none, commentaryId(none, W2_TEXT.claim)) < at(none, 'D1-0'));
  assert.ok(at(none, 'A1-2-r') < at(none, STALE));
  assert.equal(none.adapterGaps.filter((gap) => gap.note === WORKFLOW_GAP_NOTES.unreceived).length, 1);
});

test('M33 P a Workflow received in a later turn keeps its launch request\'s part, and is stated', async (t) => {
  const ledger = await workflowLedger(t, receivedLaterRows);
  const session = adapt(ledger, { sessionKey: 'm33-p-later' });
  // Placed in turn 2 (where received), but its C-02 turn and C-06 part are the launch's: the request that ran it.
  assert.equal(session.event(named(session, 'D1-0')).turn, 'T1');
  assert.equal(session.event(named(session, 'D1-0-r')).turn, 'T1');
  const parts = partAttribution(session);
  for (const id of ['D1-0', 'D1-1', STALE]) assert.equal(parts.get(named(session, id)), 'T1', id);
  const [boundary] = receipts(session);
  assert.deepEqual([labelOf(session, boundary.delivery), boundary.assignments.map((id) => labelOf(session, id)), boundary.turn],
    ['A1-0', ['D1-0', 'D1-1'], 'T1']);
  assert.ok(at(session, 'I2') < at(session, boundary.id) && at(session, boundary.id) < at(session, 'D1-0'));
  // Commentary ids are the launch layout's: the receipt moved no id.
  const launch = adapt(d7226ec(ledger), { sessionKey: 'm33-p-later' });
  const commentary = (s) => s.events.filter((event) => event.kind === 'commentary' && !event.childId).map((event) => event.id);
  assert.deepEqual(commentary(session), commentary(launch));
  // (D97: the story's step blocks, which listed the helpers in the step that received them, are gone with the story.)
});

// ---- follow-ups and messages (Codex) ----------------------------------------------------------------------------------

test('M33 P follow-up segments: each placed at its own receipt, the follow-up\'s in the request that sent it', async (t) => {
  for (const via of ['followup', 'send']) {
    const ledger = await codexLedger(t, followupRows({ via }), [followupHelperRows({ via })]);
    const [record] = ledger.helperSegments;
    assert.equal(record.segments.length, 2, via);
    assert.deepEqual(record.segments.map((s) => s.receipt.record), [8, 15], via);
    const session = adapt(ledger, { sessionKey: `m33-p-${via}` });
    const failure = resultId(session, TEXT.failQuote, true);
    const more = session.events.find((event) => event.childId && event.kind === 'commentary'
      && session.textOf(event, 'text').includes('SYNTHETIC_P_HELPER_MORE')).id;
    // The first assignment's failing run: in turn 1, before the parent's claim; the second's work: in turn 2.
    assert.ok(at(session, failure) < at(session, commentaryId(session, TEXT.claimQuote)), via);
    assert.ok(at(session, 'I2') < at(session, more), via);
    const delivery = via === 'send' ? 'A2-0' : 'D2-1';
    assert.equal(labelOf(session, session.event(more).deliveredBy), delivery);
    const parts = partAttribution(session);
    assert.deepEqual([parts.get(failure), parts.get(more)], ['T1', 'T2'], via);
    assert.deepEqual(receipts(session).map((b) => labelOf(session, b.delivery)), ['D1-0', delivery], via);
    if (via === 'followup')
      assert.equal(session.children.find((link) => link.assignmentEvent === named(session, 'D2-1')).assignmentEffectProven, true);
  }
});

test('M33 P a payload found zero times or twice links nothing and is declared; the helper keeps its spawn placement', async (t) => {
  // A message whose payload arrives nowhere; the spawn's payload recorded twice by the helper.
  const rows = [...codexConcurrentRows().slice(0, -1), ...sendMessage('send-x', 'fix_parser', TOKENS.stranger), ...codexConcurrentRows().slice(-1)];
  const helper = codexConcurrentHelperRows({ arrivals: [arrival('/root/fix_parser', TOKENS.spawn), arrival('/root/fix_parser', TOKENS.spawn, 'NEW_TASK', 'again')] });
  const ledger = await codexLedger(t, rows, [helper]);
  const reasons = ledger.helperDeliveryLosses.map((loss) => loss.reason);
  assert.deepEqual(reasons, ['helper_delivery_ambiguous', 'helper_delivery_unmatched', 'helper_arrival_unmatched',
    'helper_arrival_unmatched']);
  const session = adapt(ledger, { sessionKey: 'm33-p-tokens' });
  const declared = session.adapterGaps.filter((gap) => Object.values(HELPER_DELIVERY_GAP_NOTES).includes(gap.note))
    .map((gap) => [gap.note, gap.count, gap.eventIds?.map((id) => labelOf(session, id))]);
  assert.deepEqual(declared, [[HELPER_DELIVERY_GAP_NOTES.helper_delivery_unmatched, 1, ['A1-1']],
    [HELPER_DELIVERY_GAP_NOTES.helper_delivery_ambiguous, 1, ['D1-0']],
    [HELPER_DELIVERY_GAP_NOTES.helper_arrival_unmatched, 2, ['D1-0']]]);
  // Nothing cut it: one segment, still received at the report (no arrival named, none was proven). M33 P second repair:
  // both stray rows were recorded before the helper acted (the same turn's input), so its receipt is still its report.
  assert.deepEqual(ledger.helperSegments[0].segments.map((s) => Object.keys(s)), [['delivery', 'receipt']]);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.note === HELPER_PLACEMENT_NOTES.ambiguous), []);
});

// ---- Claude Code Agent hand-offs --------------------------------------------------------------------------------------

test('M33 P a synchronous Agent\'s block stands at its call row, before the parent\'s later work', async (t) => {
  const ledger = await claudeLedger(t, claudeParentRows());
  assert.deepEqual(ledger.ledger.map((act) => act.sourceLocator), [{ stream: 0, record: 4, part: 0, resultRecord: 5 }],
    'a ledger that links a helper records its Claude actions\' rows');
  // M33 P repair: the parent waited for it; its receipt is its own result row (row 3), recorded — so a sibling call
  // recorded between its call and that row would not be jumped (m33-p-repair.test.js P15). Here none was: the same place.
  assert.deepEqual(ledger.helperSegments, [{ child: 0, segments: [{ delivery: { delegation: 0 },
    receipt: { turn: 1, beforeEvent: 0, source: 0, record: 3 } }] }]);
  const session = adapt(ledger, { sessionKey: 'm33-p-sync' });
  const write = session.events.find((event) => event.childId && event.operation === 'write').id;
  assert.ok(at(session, 'D1-0') < at(session, write) && at(session, write) < at(session, 'A1-0'));
  assert.deepEqual(receipts(session), []);
  // Before Claude actions recorded rows (and with no record), the block followed the turn's last action: d7226ec's
  // placement, which a Claude block carrying its whole history keeps (M33 P repair: never past a parent action).
  const before = adapt({ ...unplaced(ledger), ledger: ledger.ledger.map(({ sourceLocator, ...act }) => act) },
    { sessionKey: 'm33-p-sync' });
  assert.ok(at(before, 'A1-0-r') < at(before, 'D1-0'));
  assert.ok(at(adapt(unplaced(ledger), { sessionKey: 'm33-p-sync' }), 'A1-0-r')
    < at(adapt(unplaced(ledger), { sessionKey: 'm33-p-sync' }), 'D1-0'), 'rows recorded, no record: the same');
});

test('M33 P a background Agent: its work at its notification\'s row, stated; none received: after its request, declared', async (t) => {
  const ledger = await claudeLedger(t, claudeParentRows({ background: true }));
  // Rows: 1 ask, 2 the call, 3 its launch, 4-5 the parent's build, 6 the notification, 7 the claim.
  assert.deepEqual(ledger.helperSegments, [{ child: 0, segments: [{ delivery: { delegation: 0 },
    receipt: { turn: 1, beforeEvent: 1, source: 0, record: 6 } }] }]);
  const session = adapt(ledger, { sessionKey: 'm33-p-bg' });
  const write = session.events.find((event) => event.childId && event.operation === 'write').id;
  const claim = commentaryId(session, CLAUDE_TEXT.claim);
  assert.ok(at(session, 'D1-0') < at(session, 'A1-0') && at(session, 'A1-0-r') < at(session, 'R1-0')
    && at(session, 'R1-0') < at(session, write) && at(session, write) < at(session, claim));
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.note === HELPER_PLACEMENT_NOTES.unreceived), []);
  // M33 P repair (recheck minor P31): none received, the agent's work is never shown ahead of parent work recorded
  // after its launch — it stands after its request's own work (the claim included), headed by the unproven boundary.
  for (const options of [{ notification: false }, { status: 'stopped' }]) {
    const none = adapt(await claudeLedger(t, claudeParentRows({ background: true, ...options })), { sessionKey: 'm33-p-bg' });
    const at2 = (id) => at(none, id);
    const written = none.events.find((event) => event.childId && event.operation === 'write').id;
    assert.ok(at2('D1-0') < at2('A1-0') && at2(commentaryId(none, CLAUDE_TEXT.claim)) < at2(written));
    assert.deepEqual(receipts(none).map((b) => [labelOf(none, b.delivery), b.unproven]), [['D1-0', true]]);
    assert.deepEqual(none.adapterGaps.filter((gap) => gap.note === HELPER_PLACEMENT_NOTES.unreceived)
      .map((gap) => [gap.count, gap.eventIds.map((id) => labelOf(none, id))]), [[1, ['D1-0']]], JSON.stringify(options));
  }
});

// ---- bytes ------------------------------------------------------------------------------------------------------------

test('M33 P a session with no linked helper records no Claude row and keeps its slicer bytes', async (t) => {
  const tree = await claudeTree(claudeParentRows(), []);
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  // The agent recording is empty: nothing links. The loader drops every Claude row it was handed.
  const ledger = await loadSessionEvidence([tree.parent], { recordingRoots: { claude: tree.projects, codex: tree.dir },
    reviewLinkedChildren: true });
  assert.notEqual(ledger.delegations[0].status, 'linked');
  assert.equal(JSON.stringify(ledger).includes('Locator'), false);
  assert.equal(ledger.helperSegments, undefined);
  assert.equal(JSON.stringify(await sliceLineage([tree.parent])).includes('Locator'), false);
});
