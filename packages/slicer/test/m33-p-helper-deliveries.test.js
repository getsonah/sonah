// M33 P (C-03 "M33 child placement", amended: helper placement by recorded delivery and receipt), the slicer half. What
// places a helper's work where the parent RECEIVED it rides in a side channel only the loader asks for — never in the
// ledger: a Claude action's row (`claudeLocator`, recorded as `sourceLocator` only by a loader that links a helper),
// each Claude background Agent launch and its settled notification row, each Codex send's encrypted token (in memory,
// joined by exact string equality only), each encrypted arrival a helper's rollout received addressed to itself, and
// each FINAL_ANSWER row. The join itself is pure (`planHelperSegments`). Synthetic recordings only; no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { redact } from '../../redact/index.js';
import { HELPER_DELIVERY_REASONS, HELPER_RECEIPT_STATUSES, CODEX_SEND_NAMES, ARRIVAL_MESSAGE_TYPES, planHelperSegments,
  helperRow } from '../src/helper-deliveries.js';
import { WORKFLOW_RECEIPT_STATUSES } from '../src/workflow-runs.js';
import { agentMessageArrival, readAgentMessage } from '../src/inter-agent.js';
import { HELPER_DELIVERY_GAP_NOTES } from '../../evidence/adapters/sonah-ledger.js';
import { TOKENS, arrival, codexConcurrentHelperRows, codexConcurrentRows, claudeParentRows, compacted, followupHelperRows, followupRows,
  jsonl, agentNotification, AGENT } from '../../cli/test/m33-p-placement-fixture.js';
import { row, launchRows, askRow, claimRow } from '../../cli/test/m33-w2-placement-fixture.js';
import { TASK } from '../../cli/test/m33-w-workflow-fixture.js';

async function file(t, rows, name = 'rollout-2026-10-01T12-00-00-root.jsonl') {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-p-slicer-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, name);
  await writeFile(path, jsonl(rows), { mode: 0o600 });
  return path;
}
const withoutLocators = (ledger) => ({ ...ledger, ledger: ledger.ledger.map(({ claudeLocator, ...act }) => act) });
/** How the loader reads a linked no-fork helper's rollout (child-links.js `proveNoForkChildHistory`). */
const HELPER = Object.freeze({ includeSources: true, childRecording: true, sidechainAsMain: true, helperDeliveries: true,
  noForkChildProof: Object.freeze({ contract: 'codex-v2-no-fork/1', sessionId: 'helper-fix', parentThreadId: 'root',
    taskPath: '/root/fix_parser' }) });

test('M33 P the closed vocabulary: reasons, receipt statuses, send names and arrival types, frozen', () => {
  assert.deepEqual({ ...HELPER_DELIVERY_REASONS }, { unmatched: 'helper_delivery_unmatched',
    ambiguous: 'helper_delivery_ambiguous', conflict: 'helper_delivery_conflict', order: 'helper_delivery_order',
    unsplit: 'helper_followup_unproven', stray: 'helper_arrival_unmatched',
    // M33 P second repair: a Claude helper whose own recording received a later request no receipt places.
    continued: 'helper_continued_unproven',
    // L2: a Claude helper whose hand-off result recorded no typed launch status.
    launchUnknown: 'helper_launch_mode_unknown' });
  // The adapter re-declares them as fixed notes (it never imports the slicer), plus one for a loss it cannot read.
  assert.deepEqual(Object.keys(HELPER_DELIVERY_GAP_NOTES), [...Object.values(HELPER_DELIVERY_REASONS), 'unreadable']);
  assert.equal(HELPER_RECEIPT_STATUSES, WORKFLOW_RECEIPT_STATUSES, 'a final state only: stopped proves nothing');
  assert.deepEqual(CODEX_SEND_NAMES, ['send_message', 'collaboration.send_message']);
  assert.deepEqual(ARRIVAL_MESSAGE_TYPES, ['NEW_TASK', 'MESSAGE']);
  for (const list of [HELPER_DELIVERY_REASONS, CODEX_SEND_NAMES, ARRIVAL_MESSAGE_TYPES, HELPER_DELIVERY_GAP_NOTES])
    assert.ok(Object.isFrozen(list));
});

test('M33 P the side channel rides apart: asking for it moves no ledger byte, and no token ever reaches the ledger', async (t) => {
  for (const rows of [codexConcurrentRows(), followupRows(), followupRows({ via: 'send' })]) {
    const path = await file(t, rows);
    const plain = await sliceLineage([path]);
    const { helperDeliveries, ...asked } = await sliceLineage([path], { helperDeliveries: true, claudeLocators: true });
    assert.deepEqual(asked, plain);
    assert.ok(helperDeliveries.sends.length > 0);
    // A send_message's recorded input is the action's own (redaction judges it, as before); a hand-off keeps only
    // that its brief was encrypted. What reaches a review is redacted: no token survives it.
    for (const secret of Object.values(TOKENS)) assert.equal(JSON.stringify(redact(plain).ledger).includes(secret), false);
  }
  // A Claude recording: asked, each action carries its row under its own key only (the loader records it or drops it).
  const claude = await file(t, claudeParentRows(), 'session.jsonl');
  const plain = await sliceLineage([claude]);
  const asked = await sliceLineage([claude], { claudeLocators: true, helperDeliveries: true });
  assert.equal(JSON.stringify(plain).includes('Locator'), false);
  assert.deepEqual(withoutLocators({ ...asked, helperDeliveries: undefined }), { ...plain, helperDeliveries: undefined });
  // Rows: 1 ask, 2 the Agent call, 3 its result, 4 the Bash call, 5 its result, 6 the claim.
  assert.deepEqual(asked.ledger.map((act) => act.claudeLocator), [{ stream: 0, record: 4, part: 0, resultRecord: 5 }]);
});

test('M33 P Codex sends: a hand-off\'s and a send_message\'s encrypted payload, where each was recorded', async (t) => {
  const { helperDeliveries: spawned } = await sliceLineage([await file(t, codexConcurrentRows())], { helperDeliveries: true });
  // Rows: 1 meta, 2 ask, 3 plan, 4-5 the run, 6 the spawn, 7 its result, 8 the claim, 9 the report.
  assert.deepEqual(spawned.sends, [{ kind: 'delegation', callId: 'spawn-fix', source: 0, record: 6, turn: 1,
    token: TOKENS.spawn }]);
  const { helperDeliveries: sent } = await sliceLineage([await file(t, followupRows({ via: 'send' }))], { helperDeliveries: true });
  assert.deepEqual(sent.sends.map(({ token, ...send }) => [send, token === TOKENS.spawn ? 'spawn' : token === TOKENS.message
    ? 'message' : '?']), [[{ kind: 'delegation', callId: 'spawn-fix', source: 0, record: 4, turn: 1 }, 'spawn'],
    [{ kind: 'action', turn: 2, seq: 0, source: 0, record: 11 }, 'message']]);
  // A readable message is no token: nothing to join.
  const readable = codexConcurrentRows().map((r) => (r.payload?.name === 'spawn_agent'
    ? { ...r, payload: { ...r.payload, arguments: JSON.stringify({ message: 'Write the nested test.', task_name: 'fix_parser' }) } } : r));
  assert.deepEqual((await sliceLineage([await file(t, readable)], { helperDeliveries: true })).helperDeliveries.sends, []);
});

test('M33 P arrivals: an encrypted NEW_TASK or MESSAGE addressed to the helper itself, never a compacted copy', async (t) => {
  const helper = await file(t, codexConcurrentHelperRows(), 'rollout-2026-10-01T12-00-01-helper.jsonl');
  const { helperDeliveries } = await sliceLineage([helper], HELPER);
  assert.deepEqual(helperDeliveries.arrivals, [{ turn: 0, beforeEvent: 0, source: 0, record: 2, token: TOKENS.spawn }]);
  // Read by its exact header only: addressed elsewhere, two encrypted blocks, a payload, a FINAL_ANSWER — no arrival.
  const own = arrival('/root/fix_parser', TOKENS.follow).payload;
  assert.deepEqual(agentMessageArrival(own), { recipient: '/root/fix_parser', token: TOKENS.follow });
  assert.equal(agentMessageArrival({ ...own, recipient: '/root/other' }), null);
  assert.equal(agentMessageArrival({ ...own, content: [...own.content, own.content[1]] }), null);
  assert.equal(agentMessageArrival({ ...own, content: [{ ...own.content[0], text: `${own.content[0].text}x` }, own.content[1]] }), null);
  assert.deepEqual(readAgentMessage(own), { type: 'encrypted', messageType: 'NEW_TASK' }, 'M33 F reads it as before');
  // A copy of the arrival in a compaction row, and an arrival addressed to another helper, are no arrivals.
  const rows = codexConcurrentHelperRows({ arrivals: [arrival('/root/fix_parser', TOKENS.spawn), compacted(arrival('/root/fix_parser', TOKENS.follow)),
    arrival('/root/someone_else', TOKENS.stranger)] });
  const { helperDeliveries: copied } = await sliceLineage([await file(t, rows, 'rollout-2026-10-01T12-00-02-helper.jsonl')],
    HELPER);
  assert.deepEqual(copied.arrivals.map((a) => a.token), [TOKENS.spawn]);
  // Its own path is what it is addressed by: a recording whose own path is not recorded receives nothing.
  const pathless = codexConcurrentHelperRows().map((r) => (r.type === 'session_meta'
    ? { ...r, payload: { ...r.payload, source: { subagent: { thread_spawn: { parent_thread_id: 'root' } } } } } : r));
  const { helperDeliveries: none } = await sliceLineage([await file(t, pathless, 'rollout-2026-10-01T12-00-03-helper.jsonl')],
    HELPER);
  assert.deepEqual(none.arrivals, []);
});

test('M33 P a follow-up\'s payload arrives later in the same helper rollout, after the work of the first', async (t) => {
  const helper = await file(t, followupHelperRows(), 'rollout-2026-10-01T12-00-01-helper.jsonl');
  const { helperDeliveries } = await sliceLineage([helper], HELPER);
  // Rows: 1 meta, 2 the spawn's payload, 3 a statement, 4-5 a run, 6 the follow-up's payload.
  assert.deepEqual(helperDeliveries.arrivals.map(({ token, ...at }) => [at, token === TOKENS.spawn ? 'spawn' : 'follow']),
    [[{ turn: 0, beforeEvent: 0, source: 0, record: 2 }, 'spawn'], [{ turn: 0, beforeEvent: 1, source: 0, record: 6 }, 'follow']]);
});

test('M33 P reports: each FINAL_ANSWER row, marked received only when addressed to this recording itself', async (t) => {
  const { helperDeliveries } = await sliceLineage([await file(t, followupRows())], { includeSources: true, helperDeliveries: true });
  assert.deepEqual(helperDeliveries.reports, [
    { turn: 1, beforeEvent: 1, source: 0, record: 8, sender: '/root/fix_parser', toParent: true },
    { turn: 2, beforeEvent: 2, source: 0, record: 15, sender: '/root/fix_parser', toParent: true }]);
});

test('M33 P a Claude background Agent\'s receipt: its earliest notification joined by call id and agentId, settled final', async (t) => {
  const agentsOf = async (rows) => (await sliceLineage([await file(t, rows, 'session.jsonl')], { helperDeliveries: true }))
    .helperDeliveries.agents;
  // Rows: 1 ask, 2 the Agent call, 3 its launch, 4-5 the parent's own command, 6 the notification, 7 the claim.
  for (const status of ['completed', 'failed'])
    assert.deepEqual(await agentsOf(claudeParentRows({ background: true, status })), [{ callId: 'toolu_01SyntheticAgentP0001',
      agentId: AGENT, source: 0, record: 2, turn: 1, receipt: { turn: 1, beforeEvent: 1, source: 0, record: 6 } }], status);
  // Launched, but no final state was received: stopped, none, or a notification naming another task id.
  for (const rows of [claudeParentRows({ background: true, status: 'stopped' }), claudeParentRows({ background: true, notification: false }),
    claudeParentRows({ background: true, task: 'a8888888888888888' })])
    assert.deepEqual((await agentsOf(rows)).map((agent) => agent.receipt), [undefined]);
  // A notification recorded before the launch's own result settles nothing; two statuses settle nothing.
  const [ask, use, result, ...rest] = claudeParentRows({ background: true, notification: false });
  assert.deepEqual((await agentsOf([ask, use, agentNotification('toolu_01SyntheticAgentP0001'), result, ...rest]))[0].receipt, undefined);
  assert.deepEqual((await agentsOf([...claudeParentRows({ background: true }),
    agentNotification('toolu_01SyntheticAgentP0001', 'failed')]))[0].receipt, undefined);
  // A synchronous Agent is no asynchronous launch: the parent waited for its result.
  assert.deepEqual(await agentsOf(claudeParentRows()), []);
});

test('M33 P (W2 minor P4) a Workflow\'s earliest recorded completed receipt wins: a TaskOutput completion before the notification', async (t) => {
  const poll = [row('assistant', [{ type: 'tool_use', id: 'toolu_01SyntheticPoll0001', name: 'TaskOutput',
    input: { task_id: TASK, block: true } }], {}, 'poll'),
  row('user', [{ type: 'tool_result', tool_use_id: 'toolu_01SyntheticPoll0001', content: 'Completed.' }],
    { toolUseResult: { retrieval_status: 'success', task: { status: 'completed', task_id: TASK, output: 'done' } } }, 'poll:r')];
  const notified = [row('user', `<task-notification>\n<task-id>${TASK}</task-id>\n<tool-use-id>toolu_01SyntheticWorkflowCall0001</tool-use-id>\n`
    + '<status>completed</status>\n<summary>Workflow completed</summary>\n</task-notification>', { origin: { kind: 'task-notification' } }, 'n')];
  const receiptOf = async (rows) => (await sliceLineage([await file(t, rows, 'session.jsonl')], { workflowLaunches: true }))
    .workflowLaunches.calls[0].receipt;
  // Rows: 1 ask, 2-3 the launch, 4-5 the poll, 6 the notification, 7 the claim.
  assert.deepEqual(await receiptOf([askRow(), ...launchRows({ transcriptDir: '/x' }), ...poll, ...notified, claimRow()]),
    { turn: 1, beforeEvent: 2, source: 0, record: 5 }, 'the TaskOutput result row, recorded first');
  assert.deepEqual(await receiptOf([askRow(), ...launchRows({ transcriptDir: '/x' }), ...notified, ...poll, claimRow()]),
    { turn: 1, beforeEvent: 1, source: 0, record: 4 }, 'the notification, recorded first');
  assert.deepEqual(await receiptOf([askRow(), ...launchRows({ transcriptDir: '/x' }), ...poll, claimRow()]),
    { turn: 1, beforeEvent: 2, source: 0, record: 5 }, 'a TaskOutput completion alone');
  assert.equal(await receiptOf([askRow(), ...launchRows({ transcriptDir: '/x' }), claimRow()]), undefined);
});

// ---- the join (pure) ------------------------------------------------------------------------------------------------

const at = (record, turn = 1, beforeEvent = 0) => ({ turn, beforeEvent, source: 0, record });
const spawnD = (record, child, extra = {}) => ({ adapter: 'codex', kind: 'spawn', callId: `spawn-${record}`, source: 0, record,
  turn: 1, status: 'linked', taskName: '/root/fix_parser', link: { source: child }, ...extra });
const followD = (record, child, extra = {}) => ({ adapter: 'codex', kind: 'followup', callId: `follow-${record}`, source: 0,
  record, turn: 1, status: 'linked', target: 'fix_parser', link: { source: child }, ...extra });
const send = (d, token) => ({ kind: 'delegation', callId: d.callId, source: 0, record: d.record, turn: 1, token });
const report = (record, extra = {}) => ({ ...at(record), sender: '/root/fix_parser', toParent: true, ...extra });

test('M33 P the join: each segment from its delivered arrival, received at the first report after its delivery', () => {
  const delegations = [spawnD(4, 0), followD(10, 0)];
  const plan = planHelperSegments({ delegations,
    sends: [send(delegations[0], 'S'), send(delegations[1], 'F')],
    helpers: [{ child: 0, spawn: 0, path: '/root/fix_parser', arrivals: [{ ...at(2, 0, 0), token: 'S' }, { ...at(9, 0, 3), token: 'F' }] }],
    reports: [report(8), report(14), report(6, { sender: '/root/other' }), report(7, { toParent: false })] });
  assert.deepEqual(plan, { losses: [], segments: [{ child: 0, segments: [
    { delivery: { delegation: 0 }, arrival: at(2, 0, 0), receipt: at(8) },
    { delivery: { delegation: 1 }, arrival: at(9, 0, 3), receipt: at(14) }] }] });
  assert.equal(helperRow({ ...at(2), token: 'S' }), null, 'a row is exactly its four recorded fields');
});

test('M33 P the join declares every token found zero or several times, or in another helper, and never guesses', () => {
  const [a, b] = [spawnD(4, 0), spawnD(6, 1, { taskName: '/root/other', callId: 'spawn-b' })];
  const message = (record, token) => ({ kind: 'action', turn: 1, seq: record, source: 0, record, token });
  const plan = planHelperSegments({ delegations: [a, b],
    sends: [send(a, 'A'), send(b, 'B'), message(8, 'NOWHERE'), message(9, 'TWICE'), message(11, 'SAME'), message(12, 'SAME')],
    helpers: [{ child: 0, spawn: 0, path: '/root/fix_parser', arrivals: [{ ...at(2, 0), token: 'B' }, { ...at(3, 0, 1), token: 'TWICE' },
      { ...at(4, 0, 2), token: 'TWICE' }, { ...at(5, 0, 3), token: 'SAME' }] },
    { child: 1, spawn: 1, path: '/root/other', arrivals: [] }], reports: [] });
  const reasons = plan.losses.map((loss) => [JSON.stringify(loss.delivery), loss.reason]);
  assert.deepEqual(reasons, [
    ['{"delegation":0}', HELPER_DELIVERY_REASONS.unmatched],
    ['{"delegation":1}', HELPER_DELIVERY_REASONS.conflict],
    ['{"action":{"turn":1,"seq":8}}', HELPER_DELIVERY_REASONS.unmatched],
    ['{"action":{"turn":1,"seq":9}}', HELPER_DELIVERY_REASONS.ambiguous],
    ['{"action":{"turn":1,"seq":11}}', HELPER_DELIVERY_REASONS.ambiguous],
    ['{"action":{"turn":1,"seq":12}}', HELPER_DELIVERY_REASONS.ambiguous],
    // Each arrival row of the helper that delivered nothing is counted on its spawn.
    ['{"delegation":0}', HELPER_DELIVERY_REASONS.stray], ['{"delegation":0}', HELPER_DELIVERY_REASONS.stray],
    ['{"delegation":0}', HELPER_DELIVERY_REASONS.stray], ['{"delegation":0}', HELPER_DELIVERY_REASONS.stray]]);
  // Nothing joined. M33 P repair: B's payload was received by helper 0, so the exact token evidence contradicts both
  // links — neither helper is placed (no segments: each keeps the placement before M33 P, declared by the conflict).
  assert.deepEqual(plan.segments, []);
});

test('M33 P the join cuts nothing it cannot cut exactly: out of order, or a follow-up whose payload never arrived', () => {
  const delegations = [spawnD(4, 0), followD(10, 0), followD(12, 0, { callId: 'follow-12' })];
  const helper = (arrivals) => [{ child: 0, spawn: 0, path: '/root/fix_parser', arrivals }];
  // The follow-up's payload arrived BEFORE the spawn's: no cut, the helper keeps its placement behind its spawn.
  const reversed = planHelperSegments({ delegations: delegations.slice(0, 2), sends: [send(delegations[0], 'S'), send(delegations[1], 'F')],
    helpers: helper([{ ...at(2, 0, 0), token: 'F' }, { ...at(5, 0, 1), token: 'S' }]), reports: [report(20)] });
  assert.deepEqual(reversed.segments, []);
  assert.deepEqual(reversed.losses.map((loss) => loss.reason), [HELPER_DELIVERY_REASONS.order, HELPER_DELIVERY_REASONS.order]);
  // A second follow-up whose payload is found nowhere: the first follow-up's cut would misplace its work. No cut.
  const unproven = planHelperSegments({ delegations, sends: [send(delegations[0], 'S'), send(delegations[1], 'F')],
    helpers: helper([{ ...at(2, 0, 0), token: 'S' }, { ...at(5, 0, 1), token: 'F' }]), reports: [report(20)] });
  assert.deepEqual(unproven.segments, []);
  assert.deepEqual(unproven.losses, [{ delivery: { delegation: 2 }, reason: HELPER_DELIVERY_REASONS.unsplit }]);
});
