// M33 P repair (C-03 "M33 P helper placement", amended), end to end through the loader a session-only review uses. The
// recheck of de0d508 refuted three placements and found three minor gaps, each reproduced here on synthetic Claude Code
// and Codex shapes, in both review profiles, with the deterministic probe judge (its challenger refutes when shown a
// later supersession):
//   1. a synchronous Agent called in PARALLEL with a sibling call recorded on a later row stood at its call row, ahead of
//      the sibling's result the parent received first (a new false DECIDE, and a new false NONE): it is placed where the
//      parent received its result, its own tool_result row, and the concurrency is stated;
//   2. a background Agent whose completion the parent received through a typed TaskOutput completion ignored that
//      receipt (a new false NONE): the earliest recorded completed receipt wins, as for a Workflow (W2 minor P4);
//   3. a QUEUED Codex assignment (sent before the helper's first report, received after it) shared that report as its
//      receipt, so its later work stood before a parent claim made in between (the concurrent-helper class of false
//      DECIDE): one report receives at most one assignment; a later one is placed at the helper's next report, else
//      after the receiving request's own work — never at or before the shared report — and declared;
//   minor: work with no receipt never stands ahead of parent work recorded after its delivery (it is placed after its
//      delivery request's own work, declared); a delivery conflict places neither helper by path.
// No recording of anyone's, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { redact } from '../../redact/index.js';
import { HELPER_RECEIPT_BOUNDARY, HELPER_PLACEMENT_NOTES, HELPER_DELIVERY_GAP_NOTES, WORKFLOW_GAP_NOTES }
  from '../../evidence/adapters/sonah-ledger.js';
// C-01 event identity: sessions are registered, and their events named by positional labels (stable-ids-fixture.js).
import { adapt, named, labelOf } from '../../evidence/test/stable-ids-fixture.js';
import { runReview, planWindowRequests } from '../../evidence/src/run-review.js';
import { partAttribution } from '../../evidence/src/ledger.js';
import { AGENTS, RUN, SID as W_SID, SLUG, linkedRun, mkdir, rm as wrm, scratch, writeTree } from './m33-w-workflow-fixture.js';
import { W2_TEXT, verifierBeforeFixRows } from './m33-w2-placement-fixture.js';
import { TEXT, CLAUDE_TEXT, CLAUDE_RUNS, AGENT, TOKENS, codexConcurrentHelperRows, codexConcurrentRows, claudeAgentTestRows, claudeParallelRows,
  claudePolledRows, claudeTree, claudeUnreceivedRows, codexTree, crossedHelperRows, crossedRows, decided, probeJudge,
  queuedHelperRows, queuedRows, rm } from './m33-p-placement-fixture.js';

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
  && (childOnly ? event.childId : !event.childId) && session.textSpansOf(event, 'output').join('').includes(words))?.id;
// (Each receipt boundary with the events it names shown by their positional labels; its own id is its id.)
const receipts = (session) => session.events.filter((event) => event.boundary === HELPER_RECEIPT_BOUNDARY)
  .map((event) => ({ ...event, delivery: labelOf(session, event.delivery),
    assignments: event.assignments.map((id) => labelOf(session, id)),
    ...(Array.isArray(event.held) ? { held: event.held.map((id) => labelOf(session, id)) } : {}) }));
const review = (session, judge, speedProfile) => runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
  ...(speedProfile ? { speedProfile } : {}), judge });
const gapsOf = (session, note) => session.adapterGaps.filter((gap) => gap.note === note)
  .map((gap) => [gap.count, gap.eventIds?.map((id) => labelOf(session, id))]);
/** d7226ec's ledger shape: no helper record, and no Claude action recording a row. */
const d7226ec = ({ helperSegments, helperDeliveryLosses, ...ledger }) => ({ ...ledger,
  ledger: ledger.ledger.map(({ sourceLocator, ...act }) => act) });

async function claudeLedger(t, rows, agentRows) {
  const tree = await claudeTree(rows, agentRows);
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  await mkdir(join(tree.dir, 'codex'), { recursive: true });
  return redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(tree.dir, 'codex') } })).ledger;
}
async function codexLedger(t, rows, helpers) {
  const tree = await codexTree(rows, helpers);
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  return redact(await loadSessionEvidence([tree.root], { recordingRoots: { codex: tree.dir }, reviewLinkedChildren: true })).ledger;
}
/** The probe's outcome in both profiles: does any claim read as contradicted (DECIDE)? */
async function decides(session, spec) {
  const out = [];
  for (const speedProfile of PROFILES) out.push(decided(await review(session, probeJudge(spec), speedProfile)).includes('DECIDE'));
  return out;
}
const claudeSpec = (session) => ({ claims: [{ id: commentaryId(session, CLAUDE_RUNS.claimQuote), quote: CLAUDE_RUNS.claimQuote }],
  failures: [[resultId(session, CLAUDE_RUNS.parentFailQuote), CLAUDE_RUNS.parentFailQuote],
    [resultId(session, CLAUDE_RUNS.agentFailQuote, true), CLAUDE_RUNS.agentFailQuote],
    // M35 windowing: the parent's window shows what the parent received back — the agent's failure as its report.
    [resultId(session, CLAUDE_RUNS.agentFailQuote), CLAUDE_RUNS.agentFailQuote]].filter(([id]) => id)
    .map(([id, quote]) => ({ id, quote })),
  passes: [[resultId(session, CLAUDE_RUNS.parentPassQuote), CLAUDE_RUNS.parentPassQuote],
    [resultId(session, CLAUDE_RUNS.agentPassQuote, true), CLAUDE_RUNS.agentPassQuote]].filter(([id]) => id)
    .map(([id, quote]) => ({ id, quote })) });

// ---- 1. a synchronous Agent in parallel with a sibling call (P15) ----------------------------------------------------

test('M33 P repair P15a: a synchronous Agent whose result the parent received after a sibling\'s failing run: no DECIDE', async (t) => {
  // Rows: 1 ask, 2 the Agent call, 3 the Bash call, 4 its FAILING result, 5 the agent's result (its own run PASSED), 6 the
  // claim. The parent received the agent's passing run after its own failure: the claim is superseded, as d7226ec read.
  const ledger = await claudeLedger(t, claudeParallelRows(), claudeAgentTestRows({ passing: true }));
  assert.deepEqual(ledger.helperSegments, [{ child: 0, segments: [{ delivery: { delegation: 0 },
    receipt: { turn: 1, beforeEvent: 1, source: 0, record: 5 } }] }], 'its receipt is its own result row');
  const session = adapt(ledger, { sessionKey: 'm33-p-p15a' });
  const pass = resultId(session, CLAUDE_RUNS.agentPassQuote, true);
  const [boundary] = receipts(session);
  assert.equal(boundary.delivery, 'D1-0');
  assert.ok(at(session, 'D1-0') < at(session, 'A1-0'), 'the hand-off stays at its call row');
  assert.ok(at(session, 'A1-0-r') < at(session, boundary.id) && at(session, boundary.id) < at(session, pass)
    && at(session, pass) < at(session, commentaryId(session, CLAUDE_RUNS.claimQuote)),
  'the sibling\'s result, the receipt and its statement, the agent\'s work, then the claim');
  assert.deepEqual(await decides(session, claudeSpec(session)), [false, false]);
  // d7226ec read the same: the agent's block after the turn's last action.
  const before = adapt(d7226ec(ledger), { sessionKey: 'm33-p-p15a' });
  assert.deepEqual(await decides(before, claudeSpec(before)), [false, false]);
});

test('M33 P repair P15c: the reverse — the parent passes, the agent\'s failure is received before the claim: DECIDE', async (t) => {
  // M35 windowing: the agent is a session of its own; its failing run is in its own window, never the parent's, and
  // the parent's window shows only what the parent received back (here not the failing line). So the parent's claim is
  // never set against it: NONE where M33 P read DECIDE — a known loss of the helper-result route
  // (D67).
  const ledger = await claudeLedger(t, claudeParallelRows({ parentPassing: true }), claudeAgentTestRows({ passing: false }));
  const session = adapt(ledger, { sessionKey: 'm33-p-p15c' });
  const failure = resultId(session, CLAUDE_RUNS.agentFailQuote, true);
  assert.ok(at(session, 'A1-0-r') < at(session, failure), 'received after the parent\'s pass');
  assert.deepEqual(await decides(session, claudeSpec(session)), [false, false]);
  const before = adapt(d7226ec(ledger), { sessionKey: 'm33-p-p15c' });
  assert.deepEqual(await decides(before, claudeSpec(before)), [false, false], 'as d7226ec read it');
});

test('M33 P repair P15b/P15d: both calls on one row, or the sibling called first: placed at the receipt, as d7226ec read', async (t) => {
  // M35 windowing: the agent is a session of its own; its failing run is in its own window, never the parent's, and
  // the parent's window shows only what the parent received back (here not the failing line). So the parent's claim is
  // never set against it: NONE where M33 P read DECIDE — a known loss of the helper-result route
  // (D67).
  for (const shape of ['same-row', 'bash-first'])
    for (const [parentPassing, agentPassing, expected] of [[false, true, false], [true, false, false]]) {
      const ledger = await claudeLedger(t, claudeParallelRows({ shape, parentPassing }), claudeAgentTestRows({ passing: agentPassing }));
      const session = adapt(ledger, { sessionKey: 'm33-p-p15' });
      const agentRun = resultId(session, agentPassing ? CLAUDE_RUNS.agentPassQuote : CLAUDE_RUNS.agentFailQuote, true);
      assert.ok(at(session, 'A1-0-r') < at(session, agentRun), `${shape}: after the sibling's result`);
      // The sibling's result was recorded between the agent's call and its result: the concurrency is stated.
      assert.equal(receipts(session).length, 1, shape);
      assert.deepEqual(await decides(session, claudeSpec(session)), [expected, expected], shape);
      const before = adapt(d7226ec(ledger), { sessionKey: 'm33-p-p15' });
      assert.deepEqual(await decides(before, claudeSpec(before)), [expected, expected], `${shape}: d7226ec`);
    }
});

test('M33 P repair: a synchronous Agent with nothing recorded between its call and its result stands there, unstated', async (t) => {
  // Rows: 1 ask, 2 the call, 3 its result, 4-5 the parent's own command, 6 the claim. Unchanged in effect.
  const rows = claudeParallelRows().filter((row, k) => k !== 2 && k !== 3);
  const { parentTestRows } = await import('./m33-p-placement-fixture.js');
  const ledger = await claudeLedger(t, [...rows.slice(0, 3), ...parentTestRows(true), rows[3]], claudeAgentTestRows());
  assert.deepEqual(ledger.helperSegments[0].segments, [{ delivery: { delegation: 0 },
    receipt: { turn: 1, beforeEvent: 0, source: 0, record: 3 } }]);
  const session = adapt(ledger, { sessionKey: 'm33-p-sync' });
  const pass = resultId(session, CLAUDE_RUNS.agentPassQuote, true);
  assert.ok(at(session, 'D1-0') < at(session, pass) && at(session, pass) < at(session, 'A1-0'));
  assert.deepEqual(receipts(session), []);
});

// ---- 2. a background Agent received through TaskOutput (P21b) -------------------------------------------------------

test('M33 P repair P21b: a background Agent received by a TaskOutput completion before the claim: DECIDE', async (t) => {
  // M35 windowing: the agent is a session of its own; its failing run is in its own window, never the parent's, and
  // the parent's window shows only what the parent received back (here not the failing line). So the parent's claim is
  // never set against it: NONE where M33 P read DECIDE — a known loss of the helper-result route
  // (D67).
  for (const [why, rows] of [['notification after the claim', claudePolledRows()],
    ['TaskOutput only', claudePolledRows({ notification: false })],
    ['the parent passed first', claudePolledRows({ ownPassFirst: true })]]) {
    const ledger = await claudeLedger(t, rows, claudeAgentTestRows({ passing: false }));
    const poll = ledger.ledger.find((act) => act.tool === 'TaskOutput');
    const receipt = ledger.helperSegments[0].segments[0].receipt;
    assert.equal(receipt.record, poll.sourceLocator.resultRecord, `${why}: received at the TaskOutput result row`);
    const session = adapt(ledger, { sessionKey: 'm33-p-p21b' });
    const failure = resultId(session, CLAUDE_RUNS.agentFailQuote, true);
    assert.ok(at(session, failure) < at(session, commentaryId(session, CLAUDE_RUNS.claimQuote)), why);
    assert.deepEqual(await decides(session, claudeSpec(session)), [false, false], why);
    assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), [], why);
  }
  // A TaskOutput of another task receives nothing: the notification after the claim does.
  const other = await claudeLedger(t, claudePolledRows({ task: 'a8888888888888888' }), claudeAgentTestRows({ passing: false }));
  const session = adapt(other, { sessionKey: 'm33-p-p21b' });
  assert.ok(at(session, commentaryId(session, CLAUDE_RUNS.claimQuote)) < at(session, resultId(session, CLAUDE_RUNS.agentFailQuote, true)));
});

// ---- minor: no receipt (P31) -----------------------------------------------------------------------------------------

test('M33 P repair P31: a background Agent with no receipt stands after its request\'s own work, stated and declared', async (t) => {
  for (const [claim, quote] of [['mid', CLAUDE_RUNS.midClaimQuote], ['end', CLAUDE_RUNS.claimQuote]]) {
    const ledger = await claudeLedger(t, claudeUnreceivedRows({ claim }), claudeAgentTestRows({ passing: false }));
    assert.deepEqual(ledger.helperSegments, [{ child: 0, segments: [{ delivery: { delegation: 0 } }] }], claim);
    const session = adapt(ledger, { sessionKey: 'm33-p-p31' });
    const failure = resultId(session, CLAUDE_RUNS.agentFailQuote, true);
    const last = session.events.filter((event) => !event.childId && event.kind !== 'boundary').at(-1);
    assert.ok(at(session, last.id) < at(session, failure), `${claim}: after every parent event of its request`);
    assert.ok(at(session, 'D1-0') < at(session, 'A1-0'), `${claim}: the hand-off stays at its call row`);
    const [boundary] = receipts(session);
    assert.deepEqual([boundary.delivery, boundary.unproven], ['D1-0', true], claim);
    // M35 windowing: the helper is reviewed as a session of its own (M36 phase 3, D68 K: a part of its own, in a window
    // it may share), so no window holds the receipt boundary or states a placement line (prompt.js `helperUnreceivedLine`
    // is gone); the placement is still recorded and declared.
    const { windows } = planWindowRequests({ session, reviewScope: 'session-only' });
    assert.ok(windows.every((w) => !w.events.some((e) => e.id === boundary.id)), claim);
    assert.ok(windows.some((w) => w.parts.some((part) => part.session.helper && part.events.some((e) => e.id === failure))), claim);
    assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), [[1, ['D1-0']]], claim);
    const spec = { claims: [{ id: commentaryId(session, quote), quote }], failures: [{ id: failure, quote: CLAUDE_RUNS.agentFailQuote }],
      passes: [] };
    assert.deepEqual(await decides(session, spec), [false, false], claim);
  }
});

async function workflowLedger(t, rowsOf) {
  const dir = await scratch('sonah-m33-p-repair-wf-');
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

test('M33 P repair: a Workflow run with no receipt stands after its launch request\'s own work: no DECIDE', async (t) => {
  const STALE = `child:${AGENTS.fixer}:A1-1-r`;
  for (const rowsOf of [(o) => verifierBeforeFixRows({ ...o, notification: false }),
    (o) => verifierBeforeFixRows({ ...o, status: 'stopped' })]) {
    const session = adapt(await workflowLedger(t, rowsOf), { sessionKey: 'm33-p-wf' });
    const claim = commentaryId(session, W2_TEXT.claim);
    assert.ok(at(session, claim) < at(session, 'D1-0') && at(session, claim) < at(session, STALE));
    assert.deepEqual(gapsOf(session, WORKFLOW_GAP_NOTES.unreceived), [[2, ['A1-0', 'D1-0', 'D1-1']]]);
    const spec = { claims: [{ id: claim, quote: W2_TEXT.claim }], failures: [{ id: STALE, quote: 'nested input > keeps nested arrays' }],
      passes: [{ id: 'A1-2-r', quote: 'Tests: 12 passed, 12 total' }] };
    assert.deepEqual(await decides(session, spec), [false, false]);
  }
});

test('M33 P repair: a Codex helper with no report stands after its delivery request\'s own work, stated and declared', async (t) => {
  const ledger = await codexLedger(t, codexConcurrentRows({ report: false }), [codexConcurrentHelperRows()]);
  assert.deepEqual(ledger.helperSegments[0].segments.map((s) => Object.keys(s)), [['delivery', 'arrival']]);
  const session = adapt(ledger, { sessionKey: 'm33-p-noreport' });
  const claim = commentaryId(session, TEXT.claimQuote);
  const failure = resultId(session, TEXT.failQuote, true);
  assert.ok(at(session, 'D1-0') < at(session, claim) && at(session, claim) < at(session, failure));
  assert.deepEqual(receipts(session).map((b) => [b.delivery, b.unproven]), [['D1-0', true]]);
  assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), [[1, ['D1-0']]]);
  const spec = { claims: [{ id: claim, quote: TEXT.claimQuote }], failures: [{ id: failure, quote: TEXT.failQuote }],
    passes: [{ id: resultId(session, TEXT.passQuote), quote: TEXT.passQuote }] };
  assert.deepEqual(await decides(session, spec), [false, false]);
});

// ---- 3. a queued Codex assignment (P2) --------------------------------------------------------------------------------

const codexSpec = (session, claims = [[TEXT.claimQuote]]) => ({
  claims: claims.map(([quote]) => ({ id: commentaryId(session, quote), quote })),
  failures: [{ id: resultId(session, TEXT.failQuote, true), quote: TEXT.failQuote }],
  passes: [{ id: resultId(session, TEXT.passQuote), quote: TEXT.passQuote }] });

test('M33 P repair P2: a queued assignment never shares its earlier assignment\'s report: no DECIDE, declared', async (t) => {
  for (const via of ['followup', 'send']) {
    // Rows: 1 meta, 2 ask, 3 plan, 4-5 the parent's pass, 6-7 the spawn, 8-9 the follow-up or message, 10 the first
    // report, 11 the claim, 12 the second report.
    const ledger = await codexLedger(t, queuedRows({ via }), [queuedHelperRows({ via })]);
    const [first, second] = ledger.helperSegments[0].segments;
    const before = via === 'send' ? 2 : 1;   // a send_message is an action of its own
    assert.deepEqual(first.receipt, { turn: 1, beforeEvent: before, source: 0, record: 10 }, via);
    assert.equal(second.receipt, undefined, `${via}: the first report is no receipt of the second assignment`);
    assert.deepEqual([second.shared, second.next], [{ turn: 1, beforeEvent: before, source: 0, record: 10 },
      { turn: 1, beforeEvent: before, source: 0, record: 12 }], via);
    const session = adapt(ledger, { sessionKey: `m33-p-p2-${via}` });
    const claim = commentaryId(session, TEXT.claimQuote);
    const failure = resultId(session, TEXT.failQuote, true);
    assert.ok(at(session, claim) < at(session, failure), `${via}: the second assignment's failure after the claim`);
    const delivery = via === 'send' ? 'A1-1' : 'D1-1';
    assert.deepEqual(receipts(session).map((b) => [b.delivery, b.unproven ?? false]), [['D1-0', false], [delivery, true]], via);
    assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.shared), [[1, [delivery, 'D1-0']]], via);
    assert.deepEqual(await decides(session, codexSpec(session)), [false, false], via);
  }
});

test('M33 P repair P2: the second report in the next request, or none: never in the first request before its claim', async (t) => {
  const next = await codexLedger(t, queuedRows({ second: 'next' }), [queuedHelperRows()]);
  const session = adapt(next, { sessionKey: 'm33-p-p2-next' });
  const failure = resultId(session, TEXT.failQuote, true);
  assert.ok(at(session, 'I2') < at(session, failure), 'received in the next request');
  assert.equal(partAttribution(session).get(failure), 'T1', 'still the part of the request that delivered it');
  assert.deepEqual(await decides(session, codexSpec(session)), [false, false]);
  const none = await codexLedger(t, queuedRows({ second: false }), [queuedHelperRows()]);
  assert.deepEqual(Object.keys(none.helperSegments[0].segments[1]), ['delivery', 'arrival', 'shared']);
  const unreceived = adapt(none, { sessionKey: 'm33-p-p2-none' });
  const late = resultId(unreceived, TEXT.failQuote, true);
  assert.ok(at(unreceived, commentaryId(unreceived, TEXT.claimQuote)) < at(unreceived, late), 'after the receiving request\'s own work');
  assert.deepEqual(gapsOf(unreceived, HELPER_PLACEMENT_NOTES.shared), [[1, ['D1-1', 'D1-0']]]);
  assert.deepEqual(await decides(unreceived, codexSpec(unreceived)), [false, false]);
});

// ---- minor: a delivery conflict (P40) ---------------------------------------------------------------------------------

test('M33 P repair P40: a payload received by another linked helper places neither helper at a receipt', async (t) => {
  const ledger = await codexLedger(t, crossedRows(), crossedHelperRows());
  assert.deepEqual(ledger.delegations.map((d) => d.status), ['linked', 'linked']);
  assert.equal(ledger.helperSegments, undefined, 'no record for either helper');
  assert.deepEqual(ledger.helperDeliveryLosses.filter((loss) => loss.reason === 'helper_delivery_conflict')
    .map((loss) => loss.delivery), [{ delegation: 0 }, { delegation: 1 }]);
  const session = adapt(ledger, { sessionKey: 'm33-p-p40' });
  assert.deepEqual(receipts(session), []);
  assert.deepEqual(gapsOf(session, HELPER_DELIVERY_GAP_NOTES.helper_delivery_conflict), [[2, ['D1-0', 'D1-1']]]);
  for (const secret of Object.values(TOKENS)) assert.equal(JSON.stringify(ledger).includes(secret), false);
});

test('M33 P repair: placement is deterministic, and no token reaches the ledger', async (t) => {
  const first = await codexLedger(t, queuedRows(), [queuedHelperRows()]);
  const second = await codexLedger(t, queuedRows(), [queuedHelperRows()]);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  for (const secret of Object.values(TOKENS)) assert.equal(JSON.stringify(first).includes(secret), false);
  assert.equal(CLAUDE_TEXT.claim.endsWith(CLAUDE_RUNS.claimQuote), true);
  assert.equal(AGENT.length, 17);
});
