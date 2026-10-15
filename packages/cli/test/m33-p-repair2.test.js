// M33 P second repair (C-03 "M33 P helper placement", amended again), end to end through the loader a session-only
// review uses, in both review profiles, with the deterministic probe judge (its challenger refutes when shown a later
// supersession). A recheck of ef64357 refuted two placements and found minor gaps, each reproduced here:
//   1. an Agent/Task hand-off whose input records no `run_in_background` but whose own result is the asynchronous launch
//      stub (the shape the repo's own B2 and M33 D fixtures model as what Claude Code writes) was read as synchronous: its
//      stub row became its "proven" receipt, so the agent's whole history stood right after the launch, ahead of every
//      claim the parent made while it ran (a new false DECIDE, nothing declared). Background is now read from what the
//      result records: a launch is received only by its notification or a typed TaskOutput completion, and with neither
//      it takes the declared no-receipt placement. Conversely a call whose input asked for the background but whose own
//      result is the agent's report was declared "no receipt" (a false NONE): that row is its receipt;
//   2. an agent the parent CONTINUED (SendMessage) after its first receipt had its later work placed at that first
//      receipt, ahead of the parent's claim (a new false DECIDE): an agent whose own recording records a later request
//      records no segment — it keeps the placement before M33 P — and that is declared under a closed reason;
//   minor: a Codex session that links no helper keeps its bytes, an encrypted send_message notwithstanding.
// No recording of anyone's, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { redact, sliceHash } from '../../redact/index.js';
import { HELPER_RECEIPT_BOUNDARY, HELPER_PLACEMENT_NOTES, HELPER_DELIVERY_GAP_NOTES, WORKFLOW_GAP_NOTES }
  from '../../evidence/adapters/sonah-ledger.js';
// C-01 event identity: sessions are registered, and their events named by positional labels (stable-ids-fixture.js).
import { adapt, named, labelOf } from '../../evidence/test/stable-ids-fixture.js';
import { runReview, planWindowRequests } from '../../evidence/src/run-review.js';
import { HELPER_DELIVERY_REASONS } from '../../slicer/src/helper-deliveries.js';
import { AGENTS, RUN, SID as W_SID, SLUG, linkedRun, scratch, writeTree, rm as wrm } from './m33-w-workflow-fixture.js';
import { W2_TEXT, askRow, claimRow, launchRows } from './m33-w2-placement-fixture.js';
import { CLAUDE_RUNS, TEXT, TOKENS, claudeAgentTestRows, claudeContinuedAgentRows, claudeContinuedRows,
  claudeFlaggedReportRows, claudeParallelRows, claudeStubRows, claudeTree, codexTree, decided, extraReportShape,
  mergedMessageShape, probeJudge, queuedClaimLaterRows, queuedHelperRows, rm, rootMeta, said, sendMessage,
  userAsk } from './m33-p-placement-fixture.js';

/** M34 labels: a human's prompt row carries the host's typed origin, as Claude Code 2.1.219 and later records it. */
const HUMAN_PROMPT = Object.freeze({ origin: Object.freeze({ kind: 'human' }), promptSource: 'sdk' });
const PROFILES = [undefined, 'm33-lean'];
// C-01 event identity: an event is shown by its positional label (`labelOf`); `at` finds one by its label or its id.
const ids = (session) => session.events.map((event) => labelOf(session, event.id));
const at = (session, id) => {
  const index = session.events.findIndex((event) => event.id === id || labelOf(session, event.id) === id);
  assert.ok(index >= 0, id);
  return index;
};
const commentaryId = (session, words) => session.events.find((event) => event.kind === 'commentary'
  && session.textOf(event, 'text').includes(words))?.id;
const resultId = (session, words, childOnly = false) => session.events.find((event) => event.kind === 'observation'
  && (childOnly ? event.childId : !event.childId) && session.textSpansOf(event, 'output').join('').includes(words))?.id;
// (Each receipt boundary with the events it names shown by their positional labels; its own id is its id.)
const receipts = (session) => session.events.filter((event) => event.boundary === HELPER_RECEIPT_BOUNDARY)
  .map((event) => ({ ...event, delivery: labelOf(session, event.delivery),
    assignments: event.assignments.map((id) => labelOf(session, id)),
    ...(Array.isArray(event.held) ? { held: event.held.map((id) => labelOf(session, id)) } : {}) }));
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
/** Does any claim read as contradicted (DECIDE), in each profile? */
async function decides(session) {
  const quotes = (pairs) => pairs.map(([words, childOnly]) => ({ id: resultId(session, words, childOnly), quote: words }))
    .filter(({ id }) => id);
  const spec = { claims: [CLAUDE_RUNS.claimQuote, CLAUDE_RUNS.midClaimQuote]
    .map((quote) => ({ id: commentaryId(session, quote), quote })).filter(({ id }) => id),
  // M35 windowing: the parent's window shows what the parent received back — the agent's failure as its report.
  failures: quotes([[CLAUDE_RUNS.agentFailQuote, true], [CLAUDE_RUNS.parentFailQuote, false], [CLAUDE_RUNS.agentFailQuote, false]]),
  passes: quotes([[CLAUDE_RUNS.agentPassQuote, true], [CLAUDE_RUNS.parentPassQuote, false]]) };
  assert.ok(spec.claims.length && spec.failures.length, 'the probe sees a claim and a failure');
  const out = [];
  for (const speedProfile of PROFILES) out.push(decided(await runReview({ session, pr: null, reviewScope: 'session-only',
    concurrency: 1, ...(speedProfile ? { speedProfile } : {}), judge: probeJudge(spec) })).includes('DECIDE'));
  return out;
}
const failing = () => claudeAgentTestRows({ passing: false });
async function codexLedger(t, rows, helpers) {
  const tree = await codexTree(rows, helpers);
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  return redact(await loadSessionEvidence([tree.root], { recordingRoots: { codex: tree.dir }, reviewLinkedChildren: true })).ledger;
}
/** A Codex probe in each profile: the claims named, the helper's failure, the parent's pass. */
async function codexDecides(session, claims) {
  const spec = { claims: claims.map((quote) => ({ id: commentaryId(session, quote), quote })),
    failures: [{ id: resultId(session, TEXT.failQuote, true), quote: TEXT.failQuote },
      // M35 windowing: the parent's window shows what the parent received back — the helper's failure as its report.
      ...[{ id: resultId(session, TEXT.failQuote), quote: TEXT.failQuote }].filter(({ id }) => id)],
    passes: [{ id: resultId(session, TEXT.passQuote), quote: TEXT.passQuote }].filter(({ id }) => id) };
  assert.ok(spec.claims.every(({ id }) => id) && spec.failures[0].id, 'the probe sees the claim and the failure');
  const out = [];
  for (const speedProfile of PROFILES) out.push(decided(await runReview({ session, pr: null, reviewScope: 'session-only',
    concurrency: 1, ...(speedProfile ? { speedProfile } : {}), judge: probeJudge(spec) })).includes('DECIDE'));
  return out;
}
async function workflowLedger(t, rowsOf) {
  const dir = await scratch('sonah-m33-p2-wf-');
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

// ---- 1. the launch stub answering a call with no background input (N01/N02/N05/N06/N67/N77) ---------------------------

test('M33 P second repair N01/N02/N77: a launch stub never received: no DECIDE, after the request, stated and declared', async (t) => {
  for (const stub of ['b2', 'b2-sidecar', 'm33d'])
    for (const name of ['Agent', 'Task']) {
      const why = `${stub}/${name}`;
      const ledger = await claudeLedger(t, claudeStubRows({ stub, name }), failing());
      assert.deepEqual(ledger.helperSegments, [{ child: 0, segments: [{ delivery: { delegation: 0 } }] }],
        `${why}: the stub row is no receipt`);
      const session = adapt(ledger, { sessionKey: 'm33-p2-stub' });
      const failure = resultId(session, CLAUDE_RUNS.agentFailQuote, true);
      assert.ok(at(session, commentaryId(session, CLAUDE_RUNS.midClaimQuote)) < at(session, failure), `${why}: after the claim`);
      const last = session.events.filter((event) => !event.childId && event.kind !== 'boundary').at(-1);
      assert.ok(at(session, last.id) < at(session, failure), `${why}: after every parent event of its request`);
      assert.deepEqual(receipts(session).map((b) => [b.delivery, b.unproven]), [['D1-0', true]], why);
      assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), [[1, ['D1-0']]], why);
      // L2: the B2 text with no typed sidecar records no launch mode: the same placement, and the unknown mode declared.
      assert.deepEqual(gapsOf(session, HELPER_DELIVERY_GAP_NOTES.helper_launch_mode_unknown),
        stub === 'b2' ? [[1, ['D1-0']]] : [], why);
      assert.deepEqual(await decides(session), [false, false], why);
    }
});

test('M33 P second repair N05/N06/N67: a launch stub received by its notification or a TaskOutput after the claim: no DECIDE', async (t) => {
  // L2: an untyped stub ('b2') is never received by a notification: its launch mode is unknown, so it stays unreceived.
  const untyped = adapt(await claudeLedger(t, claudeStubRows({ stub: 'b2', after: 'notified' }), failing()),
    { sessionKey: 'm33-p2-untyped' });
  assert.deepEqual(receipts(untyped).map((b) => [b.delivery, b.unproven]), [['D1-0', true]]);
  assert.deepEqual(gapsOf(untyped, HELPER_DELIVERY_GAP_NOTES.helper_launch_mode_unknown), [[1, ['D1-0']]]);
  for (const after of ['notified', 'end-notified', 'polled'])
    for (const stub of ['b2-sidecar', 'm33d']) {
      const why = `${after}/${stub}`;
      const ledger = await claudeLedger(t, claudeStubRows({ stub, after }), failing());
      const [{ segments: [segment] }] = ledger.helperSegments;
      assert.ok(segment.receipt && segment.receipt.record > 3, `${why}: received after its launch row`);
      const session = adapt(ledger, { sessionKey: 'm33-p2-received' });
      const claim = commentaryId(session, after === 'end-notified' ? CLAUDE_RUNS.claimQuote : CLAUDE_RUNS.midClaimQuote);
      assert.ok(at(session, claim) < at(session, resultId(session, CLAUDE_RUNS.agentFailQuote, true)), why);
      assert.deepEqual(receipts(session).map((b) => [b.delivery, b.unproven ?? false]), [['D1-0', false]], why);
      assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), [], why);
      assert.deepEqual(await decides(session), [false, false], why);
    }
});

test('M33 P second repair N66: a call asking for the background answered by the agent\'s report is received there: DECIDE', async (t) => {
  // M35 windowing: the agent is a session of its own; its failing run is in its own window, never the parent's, and
  // the parent's window shows only what the parent received back (here not the failing line). So the parent's claim is
  // never set against it: NONE where M33 P read DECIDE — a known loss of the helper-result route
  // (D67).
  // Rows: 1 ask, 2 the call (run_in_background: true), 3 the agent's report (its own run FAILED), 4 the claim.
  const ledger = await claudeLedger(t, claudeFlaggedReportRows(), failing());
  assert.deepEqual(ledger.helperSegments, [{ child: 0, segments: [{ delivery: { delegation: 0 },
    receipt: { turn: 1, beforeEvent: 0, source: 0, record: 3 } }] }]);
  const session = adapt(ledger, { sessionKey: 'm33-p2-n66' });
  assert.ok(at(session, resultId(session, CLAUDE_RUNS.agentFailQuote, true)) < at(session, commentaryId(session, CLAUDE_RUNS.claimQuote)));
  assert.deepEqual(receipts(session), [], 'nothing of the parent\'s between its call and its result');
  assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), []);
  assert.deepEqual(await decides(session), [false, false]);
  // d7226ec read the same.
  const before = adapt(d7226ec(ledger), { sessionKey: 'm33-p2-n66' });
  assert.deepEqual(await decides(before), [false, false]);
});

// ---- 2. an agent continued after its first receipt (N71/N72/N73) ------------------------------------------------------

test('M33 P second repair N71/N72: an agent continued after its receipt: its later work after the session\'s last request', async (t) => {
  assert.equal(HELPER_DELIVERY_REASONS.continued, 'helper_continued_unproven');
  for (const background of [false, true]) {
    const why = background ? 'N71 background' : 'N72 synchronous';
    const ledger = await claudeLedger(t, claudeContinuedRows({ background }), claudeContinuedAgentRows());
    assert.equal(ledger.delegations[0].status, 'linked', why);
    // Its first receipt (row 3: its result, or its first notification at row 4) receives the work before its own later
    // request; the work after that request (its own turn 2) has no recorded receipt.
    const [{ segments: [first, later] }] = ledger.helperSegments;
    assert.equal(first.receipt.record, background ? 4 : 3, why);
    assert.deepEqual(later, { delivery: { request: 2 } }, why);
    assert.deepEqual(ledger.helperDeliveryLosses, [{ delivery: { delegation: 0 }, reason: HELPER_DELIVERY_REASONS.continued }], why);
    const session = adapt(ledger, { sessionKey: 'm33-p2-continued' });
    const claim = commentaryId(session, CLAUDE_RUNS.claimQuote);
    const lint = resultId(session, 'lint ok', true);
    const failure = resultId(session, CLAUDE_RUNS.agentFailQuote, true);
    assert.ok(at(session, lint) < at(session, claim), `${why}: the work before its later request, at its receipt`);
    assert.ok(at(session, claim) < at(session, failure), `${why}: the work after it, after the claim`);
    const last = session.events.filter((event) => !event.childId && event.kind !== 'boundary').at(-1);
    assert.ok(at(session, last.id) < at(session, failure), `${why}: after every parent event`);
    assert.deepEqual(receipts(session).filter((b) => b.unproven).map((b) => b.delivery), ['D1-0'], why);
    assert.deepEqual(gapsOf(session, HELPER_DELIVERY_GAP_NOTES.helper_continued_unproven), [[1, ['D1-0']]], why);
    assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), [], `${why}: declared once, under its own reason`);
    assert.deepEqual(await decides(session), [false, false], why);
  }
});

test('M33 P second repair N73: the continuing work never stands before a later request\'s claim', async (t) => {
  const rows = claudeContinuedRows();
  // The claim moves to a SECOND request, after the SendMessage request.
  const claimAt = rows.findIndex((row) => JSON.stringify(row.message?.content ?? '').includes(CLAUDE_RUNS.claimQuote));
  const [claimRow] = rows.splice(claimAt, 1);
  const { claudeRow } = await import('./m33-p-placement-fixture.js');
  const ledger = await claudeLedger(t, [...rows, claudeRow('user', 'SYNTHETIC_P_CC_ASK2: anything else?', HUMAN_PROMPT, 'ask2'), claimRow],
    claudeContinuedAgentRows());
  const session = adapt(ledger, { sessionKey: 'm33-p2-n73' });
  assert.ok(at(session, 'I2') < at(session, commentaryId(session, CLAUDE_RUNS.claimQuote)));
  assert.ok(at(session, commentaryId(session, CLAUDE_RUNS.claimQuote)) < at(session, resultId(session, CLAUDE_RUNS.agentFailQuote, true)));
  assert.deepEqual(await decides(session), [false, false]);
});

test('M33 P second repair: a continued agent\'s failure received BEFORE the claim still contradicts it', async (t) => {
  // M35 windowing: the agent is a session of its own; its failing run is in its own window, never the parent's, and
  // the parent's window shows only what the parent received back (here not the failing line). So the parent's claim is
  // never set against it: NONE where M33 P read DECIDE — a known loss of the helper-result route
  // (D67).
  // Its own first run FAILED (received at its result row, before the claim); its later work is a lint run only.
  const agentRows = claudeContinuedAgentRows();
  const swap = (row, content) => ({ ...row, message: { ...row.message, content } });
  const [brief, lint, lintResult, said1, more, test, testResult, said2] = agentRows;
  const failingFirst = [brief, swap(lint, test.message.content), swap(lintResult, testResult.message.content), said1, more,
    swap(test, lint.message.content), swap(testResult, lintResult.message.content), said2];
  const ledger = await claudeLedger(t, claudeContinuedRows(), failingFirst);
  const session = adapt(ledger, { sessionKey: 'm33-p2-continued-first' });
  assert.ok(at(session, resultId(session, CLAUDE_RUNS.agentFailQuote, true)) < at(session, commentaryId(session, CLAUDE_RUNS.claimQuote)));
  assert.deepEqual(await decides(session), [false, false]);
});

// ---- minor: work with no receipt stands after the session's last request (N39/N41/N75) -------------------------------

test('M33 P second repair N39/N75: a background Agent never received, the claim in a later request: no DECIDE', async (t) => {
  const { claudeRow, agentCallRow, agentStubRow, CLAUDE_TEXT } = await import('./m33-p-placement-fixture.js');
  const head = [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'ask'), agentCallRow({ flag: true }), agentStubRow(),
    claudeRow('assistant', [{ type: 'text', text: 'SYNTHETIC_P_CC_WAIT: launched; waiting.' }], {}, 'wait')];
  const interrupt = claudeRow('user', [{ type: 'text', text: '[Request interrupted by user]' }], {}, 'interrupt');
  const tail = [claudeRow('user', 'SYNTHETIC_P_CC_ASK2: anything else?', HUMAN_PROMPT, 'ask2'),
    claudeRow('assistant', [{ type: 'text', text: CLAUDE_TEXT.claim }], {}, 'claim')];
  for (const [why, rows] of [['N39', [...head, ...tail]], ['N75', [...head, interrupt, ...tail]]]) {
    const ledger = await claudeLedger(t, rows, failing());
    const session = adapt(ledger, { sessionKey: 'm33-p2-n39' });
    const failure = resultId(session, CLAUDE_RUNS.agentFailQuote, true);
    assert.ok(at(session, commentaryId(session, CLAUDE_RUNS.claimQuote)) < at(session, failure), `${why}: after the later claim`);
    assert.deepEqual(receipts(session).map((b) => [b.delivery, b.unproven]), [['D1-0', true]], why);
    assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), [[1, ['D1-0']]], why);
    assert.deepEqual(await decides(session), [false, false], why);
  }
});

test('M33 P second repair N41: a queued assignment with no next report, the claim in a later request: no DECIDE', async (t) => {
  const ledger = await codexLedger(t, queuedClaimLaterRows(), [queuedHelperRows()]);
  assert.deepEqual(Object.keys(ledger.helperSegments[0].segments[1]), ['delivery', 'arrival', 'shared']);
  const session = adapt(ledger, { sessionKey: 'm33-p2-n41' });
  const claim = commentaryId(session, TEXT.claimQuote);
  const failure = resultId(session, TEXT.failQuote, true);
  assert.ok(at(session, 'I2') < at(session, claim) && at(session, claim) < at(session, failure));
  assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.shared), [[1, ['D1-1', 'D1-0']]]);
  assert.deepEqual(await codexDecides(session, [TEXT.claimQuote]), [false, false]);
});

test('M33 P second repair: a Workflow run never received, the claim in a later request: no DECIDE, stated', async (t) => {
  const STALE = `child:${AGENTS.fixer}:A1-1-r`;
  const rowsOf = ({ transcriptDir }) => [askRow(), ...launchRows({ transcriptDir }), askRow(W2_TEXT.readmeAsk, 'readme-ask'), claimRow()];
  const session = adapt(await workflowLedger(t, rowsOf), { sessionKey: 'm33-p2-wf' });
  const claim = commentaryId(session, W2_TEXT.claim);
  assert.ok(at(session, 'I2') < at(session, claim) && at(session, claim) < at(session, 'D1-0') && at(session, claim) < at(session, STALE));
  assert.equal(session.events[at(session, 'D1-0')].turn, 'T1', 'its delegate event keeps its call\'s turn');
  assert.deepEqual(receipts(session).filter((b) => b.unproven).map((b) => b.delivery), ['A1-0']);
  assert.deepEqual(gapsOf(session, WORKFLOW_GAP_NOTES.unreceived), [[2, ['A1-0', 'D1-0', 'D1-1']]]);
  const spec = { claims: [{ id: claim, quote: W2_TEXT.claim }], failures: [{ id: STALE, quote: 'nested input > keeps nested arrays' }],
    passes: [] };
  for (const speedProfile of PROFILES) assert.deepEqual(decided(await runReview({ session, pr: null, reviewScope: 'session-only',
    concurrency: 1, ...(speedProfile ? { speedProfile } : {}), judge: probeJudge(spec) })).includes('DECIDE'), false);
});

// ---- minor: a helper reporting more often than it was assigned work (N59/N60/N61) -------------------------------------

test('M33 P second repair N59/N60/N61: extra reports or a sibling\'s message: no report is taken as a receipt there', async (t) => {
  // Each helper reported three times for two assignments (and, with a sibling's message, received a stray one): no
  // report is tied to either segment.
  for (const [shape, placed] of [['extra-report', ['ambiguous', 'ambiguous']], ['sibling-before', ['ambiguous', 'ambiguous']],
    ['sibling-after', ['ambiguous', 'ambiguous']]]) {
    const { rows, helper } = extraReportShape(shape);
    const ledger = await codexLedger(t, rows, [helper]);
    assert.deepEqual(ledger.helperSegments[0].segments.map((s) => (s.receipt ? 'receipt' : s.ambiguous === true ? 'ambiguous' : '?')),
      placed, shape);
    const session = adapt(ledger, { sessionKey: 'm33-p2-extra' });
    const claim = commentaryId(session, TEXT.claimQuote);
    assert.ok(at(session, claim) < at(session, resultId(session, TEXT.failQuote, true)), `${shape}: after the claim`);
    const count = placed.filter((p) => p === 'ambiguous').length;
    assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.ambiguous).map(([n]) => n), [count], shape);
    assert.deepEqual(await codexDecides(session, [TEXT.claimQuote]), [false, false], shape);
  }
});

test('M33 P second repair N34 (pinned limitation): a merged message\'s work is not placed at the shared report', async (t) => {
  // The helper's one report, received before the claim, carried both assignments' work; whether the message was queued or
  // merged is recorded by no identity, so its segment is `shared` with no next report: declared, a false NONE kept.
  const { rows, helper } = mergedMessageShape();
  const ledger = await codexLedger(t, rows, [helper]);
  assert.deepEqual(Object.keys(ledger.helperSegments[0].segments[1]), ['delivery', 'arrival', 'shared']);
  const session = adapt(ledger, { sessionKey: 'm33-p2-n34' });
  assert.ok(at(session, commentaryId(session, TEXT.claimQuote)) < at(session, resultId(session, TEXT.failQuote, true)));
  assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.shared), [[1, ['A1-0', 'D1-0']]]);
  assert.deepEqual(await codexDecides(session, [TEXT.claimQuote]), [false, false]);
});

// ---- minor: a synchronous Agent held behind a sibling call answered after it (N07/N08/N13) ----------------------------

test('M33 P second repair N07/N08/N13: an agent shown after a sibling\'s result it was received before: stated', async (t) => {
  for (const [why, options] of [['N07', { shape: 'bash-first', agentAnsweredFirst: true, parentPassing: true }],
    ['N08', { shape: 'bash-first', agentAnsweredFirst: true }]]) {
    const ledger = await claudeLedger(t, claudeParallelRows(options), failing());
    const session = adapt(ledger, { sessionKey: 'm33-p2-held' });
    const [boundary, ...rest] = receipts(session);
    assert.deepEqual(rest, [], why);
    assert.deepEqual([boundary.delivery, boundary.held, boundary.unproven], ['D1-0', ['A1-0'], undefined], why);
    assert.ok(at(session, 'A1-0-r') < at(session, boundary.id), `${why}: shown after the sibling's result`);
    // M35 windowing: the helper is reviewed in its own windows, so no window holds the receipt boundary or states the
    // held line (prompt.js `helperHeldLine` is gone); the placement and what it held are still recorded.
    const { windows } = planWindowRequests({ session, reviewScope: 'session-only' });
    assert.ok(windows.every((w) => !w.events.some((e) => e.id === boundary.id)), why);
  }
  // N13, L2: both results on one row (as older Claude Code wrote parallel calls): the row's sidecar is no one block's, so
  // the agent's result records no typed launch mode — unknown, declared, and placed by no receipt (never guessed from
  // its words being no launch stub).
  const oneRow = adapt(await claudeLedger(t, claudeParallelRows({ shape: 'one-result-row', parentPassing: true }),
    failing()), { sessionKey: 'm33-p2-held' });
  assert.deepEqual(receipts(oneRow).map((b) => [b.delivery, b.held, b.unproven]), [['D1-0', undefined, true]], 'N13');
  assert.deepEqual(gapsOf(oneRow, HELPER_DELIVERY_GAP_NOTES.helper_launch_mode_unknown), [[1, ['D1-0']]], 'N13');
  // The sibling answered first (P15a): nothing is held, the proven statement only.
  const ledger = await claudeLedger(t, claudeParallelRows(), claudeAgentTestRows({ passing: true }));
  assert.deepEqual(receipts(adapt(ledger, { sessionKey: 'm33-p2-held' })).map((b) => b.held), [undefined]);
  // A TaskOutput poll answered on the receipt's own row IS the receipt: never held.
  const polled = await claudeLedger(t, claudeStubRows({ after: 'polled' }), failing());
  assert.deepEqual(receipts(adapt(polled, { sessionKey: 'm33-p2-held' })).map((b) => [b.delivery, b.held]),
    [['D1-0', undefined]]);
});

test('M33 P second repair: a continued agent\'s record that is not exactly valid is no record', async (t) => {
  const ledger = await claudeLedger(t, claudeContinuedRows(), claudeContinuedAgentRows());
  const [{ child, segments: [first, later] }] = ledger.helperSegments;
  const legacy = ids(adapt(d7226ec(ledger), { sessionKey: 'm33-p2-tamper' }));
  for (const [why, segments] of [
    ['a request its own recording does not record', [first, { delivery: { request: 9 } }]],
    ['a request at its first turn', [first, { delivery: { request: 1 } }]],
    ['a request beside a receipt', [first, { ...later, receipt: first.receipt }]],
    ['a request first', [later]],
    ['a segment after a request', [first, later, later]],
    ['ambiguous on a Claude helper', [{ ...first, receipt: undefined, ambiguous: true }]],
  ]) {
    const tampered = { ...ledger, helperSegments: [{ child, segments: segments.map((segment) =>
      Object.fromEntries(Object.entries(segment).filter(([, v]) => v !== undefined))) }] };
    // Rows recorded, no valid record: the placement before M33 P (never moved back past a parent action).
    assert.deepEqual(ids(adapt(tampered, { sessionKey: 'm33-p2-tamper' })), legacy, why);
  }
});

// ---- minor: a session that links no helper keeps its bytes (N57) -------------------------------------------------------

test('M33 P second repair N57: a Codex session linking no helper records no delivery loss for its encrypted message', async (t) => {
  const rows = [rootMeta(), userAsk(TEXT.ask), said(TEXT.plan), ...sendMessage('send-fix', 'fix_parser', TOKENS.message),
    said(TEXT.claim)];
  const tree = await codexTree(rows, []);
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  const ledger = redact(await loadSessionEvidence([tree.root], { recordingRoots: { codex: tree.dir },
    reviewLinkedChildren: true })).ledger;
  assert.equal(Object.hasOwn(ledger, 'helperDeliveryLosses'), false);
  assert.equal(Object.hasOwn(ledger, 'helperSegments'), false);
  const session = adapt(ledger, { sessionKey: 'm33-p2-n57' });
  for (const note of Object.values(HELPER_DELIVERY_GAP_NOTES))
    assert.deepEqual(gapsOf(session, note), [], note);
  assert.equal(typeof sliceHash(ledger), 'string');
  assert.equal(JSON.stringify(ledger).includes(TOKENS.message), false);
});
