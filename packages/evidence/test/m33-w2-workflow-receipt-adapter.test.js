// M33 W2 (C-03 "M33 W Workflow agents linked", placement at receipt), the ledger adapter. A valid run record may name
// where the parent received the run's completion (`receipt: {turn, beforeEvent, source, record}`); the run's agents
// are then placed there, as a block of their own in that turn: after every parent action recorded before the receipt
// (`beforeEvent`, the slicer's count, as commentary is placed among Claude actions that record no row) and after the
// commentary recorded before its row, never by timestamp. A receipt that is not exactly valid makes the record invalid
// (fail closed): the call keeps its M33 D loss and its agents keep the launch placement, which is declared. Synthetic
// ledgers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { WORKFLOW_GAP_NOTES } from '../adapters/sonah-ledger.js';
import { adapt, labelOf } from './stable-ids-fixture.js';
import { GAP_CODES } from '../src/ledger.js';
import { GAP_SENTENCE_CHILDREN } from '../src/review.js';
import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { redact } from '../../redact/index.js';
import { AGENTS, RUN, SID, SLUG, linkedRun, mkdir, rm, scratch, writeTree } from '../../cli/test/m33-w-workflow-fixture.js';
import { resumedRows, verifierBeforeFixRows } from '../../cli/test/m33-w2-placement-fixture.js';

async function ledgerOf(t, rowsOf = verifierBeforeFixRows) {
  const dir = await scratch('sonah-m33-w2-adapter-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const transcriptDir = join(dir, 'projects', SLUG, SID, 'subagents', 'workflows', RUN);
  const tree = await writeTree(dir, { parent: rowsOf({ transcriptDir }), run: linkedRun() });
  await mkdir(join(dir, 'codex'), { recursive: true });
  return redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(dir, 'codex') } })).ledger;
}
const STALE = `child:${AGENTS.fixer}:A1-1-r`;
// C-01 event identity: sessions are registered, and their events named by their positional labels (stable-ids-fixture.js).
const sessionFromLedger = (ledger) => adapt(ledger, { sessionKey: 'session' });
const order = (session) => session.events.map((event) => labelOf(session, event.id));
const relabelled = (session, gaps) => gaps.map((gap) => ({ ...gap,
  ...(gap.eventIds ? { eventIds: gap.eventIds.map((id) => labelOf(session, id)) } : {}) }));
const placedAtReceipt = (session) => order(session).indexOf(STALE) < order(session).indexOf('A1-1');
/** M33 P: Claude actions now record their rows in a ledger that links a helper; this is d7226ec's ledger shape. */
const rowless = (ledger) => ({ ...ledger, ledger: ledger.ledger.map(({ sourceLocator, ...act }) => act) });
const unreceived = (session) => relabelled(session, session.adapterGaps.filter((gap) => gap.note === WORKFLOW_GAP_NOTES.unreceived));
const agentsLoss = (session) => relabelled(session, session.adapterGaps.filter((gap) => gap.note === WORKFLOW_GAP_NOTES.agents));

test('M33 W2 the launch-placement note is one fixed note of the closed Workflow table, on a known gap code', () => {
  // M33 P repair (recheck minor): a run with no receipt is never moved back past parent work recorded after its launch
  // (it may have finished after any of it): its agents stand after the launch request's own work, and the note says so.
  // M33 P second repair: after the SESSION's last request's own work (a later request's claim included).
  assert.equal(WORKFLOW_GAP_NOTES.unreceived,
    'a workflow\'s agents are placed after the session\'s last request because the parent recorded no receipt of its '
    + 'completion');
  assert.ok(Object.isFrozen(WORKFLOW_GAP_NOTES));
  const notes = Object.values(WORKFLOW_GAP_NOTES);
  assert.equal(new Set(notes).size, notes.length);
  assert.ok(GAP_CODES.includes('incomplete_inventory') && GAP_SENTENCE_CHILDREN.incomplete_inventory);
});

test('M33 W2 a valid receipt places the agents after the actions recorded before it, though no Claude action records a row', async (t) => {
  // M33 P: a ledger that links a helper records its Claude actions' rows; the receipt places the agents with or
  // without them (a ledger written before M33 P recorded none).
  const ledger = rowless(await ledgerOf(t));
  assert.equal(ledger.ledger.some((act) => act.sourceLocator), false, 'Claude actions carry no row');
  const session = sessionFromLedger(ledger);
  assert.equal(placedAtReceipt(session), true);
  assert.deepEqual(unreceived(session), []);
  assert.deepEqual(agentsLoss(session), []);
  // Moving the receipt past the parent's fix (beforeEvent 2: two actions recorded before it) moves the agents with it.
  const moved = structuredClone(ledger);
  moved.workflowRuns[0].receipt = { ...moved.workflowRuns[0].receipt, beforeEvent: 2, record: 6 };
  const ids = order(sessionFromLedger(moved));
  assert.ok(ids.indexOf('A1-1-r') < ids.indexOf('D1-0') && ids.indexOf('D1-1-r') < ids.indexOf('A1-2'));
});

test('M33 W2 a receipt that is not exactly valid makes the record invalid: launch placement, M33 D loss, declared', async (t) => {
  // d7226ec's rowless ledger, where the launch placement could not reach back past any Claude action: what tells the
  // two placements apart. (With rows, the launch placement is the delivery's, right after the launch: M33 P.)
  const ledger = rowless(await ledgerOf(t));
  const forged = (change) => { const copy = structuredClone(ledger); change(copy.workflowRuns[0]); return sessionFromLedger(copy); };
  for (const [why, change] of [
    ['an extra key', (run) => { run.receipt.status = 'completed'; }],
    ['a missing key', (run) => { delete run.receipt.record; }],
    ['not an object', (run) => { run.receipt = [1, 1, 0, 4]; }],
    ['null', (run) => { run.receipt = null; }],
    ['a count that is not an integer', (run) => { run.receipt.beforeEvent = 1.5; }],
    ['a string count', (run) => { run.receipt.record = '4'; }],
    ['row 0', (run) => { run.receipt.record = 0; }],
    ['a negative stream', (run) => { run.receipt.source = -1; }],
    ['before the call was recorded', (run) => { run.receipt.beforeEvent = 0; }],
    ['an earlier turn than the call', (run) => { run.receipt.turn = 0; run.receipt.beforeEvent = 0; }],
    ['past every action of its turn', (run) => { run.receipt.beforeEvent = 4; }],
    ['a turn with no such actions', (run) => { run.receipt.turn = 2; }],
  ]) {
    const session = forged(change);
    assert.equal(placedAtReceipt(session), false, why);
    assert.deepEqual(agentsLoss(session).map((gap) => gap.eventIds), [['A1-0']], why);
    assert.deepEqual(unreceived(session).map((gap) => gap.eventIds), [['A1-0', 'D1-0', 'D1-1']], why);
  }
  // A ledger written before this rule records no receipt: its record stays valid, its agents keep the launch placement,
  // and that placement is declared.
  const older = forged((run) => { delete run.receipt; });
  assert.deepEqual(agentsLoss(older), []);
  assert.equal(placedAtReceipt(older), false);
  assert.equal(unreceived(older).length, 1);
});

test('M33 W2 a resumed run\'s receipt must follow its LAST call, never only the origin', async (t) => {
  const ledger = await ledgerOf(t, resumedRows);
  assert.deepEqual(ledger.workflowRuns[0].receipt, { turn: 1, beforeEvent: 4, source: 0, record: 11 });
  const forged = structuredClone(ledger);
  forged.workflowRuns[0].receipt = { turn: 1, beforeEvent: 1, source: 0, record: 4 };   // the origin's own receipt
  const session = sessionFromLedger(forged);
  assert.deepEqual(agentsLoss(session).map((gap) => gap.eventIds), [['A1-0', 'A1-2']], 'invalid: both keep M33 D');
  assert.equal(unreceived(session).length, 1);
  assert.deepEqual(unreceived(sessionFromLedger(ledger)), []);
});
