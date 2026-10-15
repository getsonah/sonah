// M33 P repair, the slicer half. (1) A synchronous Claude Agent/Task hand-off's receipt is its own single result row
// (the parent waited for it there; a sibling call recorded between its call and its result ran concurrently with it).
// (2) A background Agent's receipt is the EARLIEST recorded completed receipt: its settled notification or a typed
// TaskOutput completion of its own agentId recorded after its launch (as a Workflow's, W2 minor P4). (3) One report
// receives at most one assignment: a later assignment whose first report after its delivery already received an earlier
// one is `shared` — placed at the helper's `next` report when one is recorded — never given that report as its receipt.
// (4) A payload proven delivered to another linked helper places neither helper at a receipt. Synthetic rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { planHelperSegments, HELPER_DELIVERY_REASONS } from '../src/helper-deliveries.js';
import { AGENT, AGENT_CALL, agentNotification, claudeParallelRows, claudeParentRows, claudePolledRows, claudeRow, jsonl,
  pollRows } from '../../cli/test/m33-p-placement-fixture.js';

async function file(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-p-repair-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'session.jsonl');
  await writeFile(path, jsonl(rows), { mode: 0o600 });
  return path;
}
const deliveriesOf = async (t, rows) => (await sliceLineage([await file(t, rows)], { helperDeliveries: true })).helperDeliveries;
const row = (record, turn = 1, beforeEvent = 0) => ({ turn, beforeEvent, source: 0, record });

test('M33 P repair a synchronous Agent\'s receipt is its own single result row', async (t) => {
  // Rows: 1 ask, 2 the call, 3 its result, 4-5 the parent's command, 6 the claim.
  assert.deepEqual((await deliveriesOf(t, claudeParentRows())).calls, [{ callId: AGENT_CALL, source: 0, record: 2, turn: 1,
    receipt: row(3) }]);
  // In parallel with a sibling call on a later row: the agent's result (row 5) after the sibling's result (row 4).
  assert.deepEqual((await deliveriesOf(t, claudeParallelRows())).calls.map((c) => c.receipt), [row(5, 1, 1)]);
  assert.deepEqual((await deliveriesOf(t, claudeParallelRows({ shape: 'same-row' }))).calls.map((c) => [c.record, c.receipt]),
    [[2, row(4, 1, 1)]]);
  // No result: no receipt; two results: no one call. A background launch is no synchronous call.
  const rows = claudeParentRows();
  assert.deepEqual((await deliveriesOf(t, [rows[0], rows[1], ...rows.slice(3)])).calls.map((c) => c.receipt), [undefined]);
  const again = claudeRow('user', [{ type: 'tool_result', tool_use_id: AGENT_CALL, content: `Again.\nagentId: ${AGENT}` }], {}, 'again');
  assert.deepEqual((await deliveriesOf(t, [...rows.slice(0, 3), again, ...rows.slice(3)])).calls, []);
  assert.deepEqual((await deliveriesOf(t, claudeParentRows({ background: true }))).calls, []);
  // Its call id reused by an action: no receipt either.
  const reused = [...rows.slice(0, 3), claudeRow('assistant', [{ type: 'tool_use', id: AGENT_CALL, name: 'Bash',
    input: { command: 'ls' } }], {}, 'reuse'), ...rows.slice(3)];
  assert.deepEqual((await deliveriesOf(t, reused)).calls, []);
});

test('M33 P repair a background Agent\'s earliest recorded completed receipt wins: a TaskOutput completion or its notification', async (t) => {
  // Rows: 1 ask, 2 the call, 3 its launch, 4-5 the TaskOutput poll, 6 the claim, 7 the notification.
  const receiptOf = async (rows) => (await deliveriesOf(t, rows)).agents.map((agent) => agent.receipt);
  assert.deepEqual(await receiptOf(claudePolledRows()), [row(5, 1, 1)], 'the TaskOutput result row, recorded first');
  assert.deepEqual(await receiptOf(claudePolledRows({ notification: false })), [row(5, 1, 1)], 'a TaskOutput completion alone');
  const [ask, call, launch, ...rest] = claudePolledRows({ notification: false });
  assert.deepEqual(await receiptOf([ask, call, launch, agentNotification(AGENT_CALL), ...rest]), [row(4)],
    'the notification, recorded first');
  // A TaskOutput naming another task, or recorded before the launch's own result, receives nothing.
  assert.deepEqual(await receiptOf(claudePolledRows({ task: 'a8888888888888888' })), [row(7, 1, 1)]);
  assert.deepEqual(await receiptOf([ask, call, ...pollRows(), launch, ...rest.slice(2)]), [undefined]);
  // A stopped notification settles nothing, so a TaskOutput beside it does not either (as for a Workflow).
  assert.deepEqual(await receiptOf([ask, call, launch, agentNotification(AGENT_CALL, 'stopped'), ...rest]), [undefined]);
  assert.equal(AGENT.startsWith('a'), true);
});

const spawnD = (record, child, extra = {}) => ({ adapter: 'codex', kind: 'spawn', callId: `spawn-${record}`, source: 0, record,
  turn: 1, status: 'linked', taskName: '/root/fix_parser', link: { source: child }, ...extra });
const followD = (record, child) => ({ adapter: 'codex', kind: 'followup', callId: `follow-${record}`, source: 0,
  record, turn: 1, status: 'linked', target: 'fix_parser', link: { source: child } });
const send = (d, token) => ({ kind: 'delegation', callId: d.callId, source: 0, record: d.record, turn: 1, token });
const report = (record, turn = 1) => ({ ...row(record, turn), sender: '/root/fix_parser', toParent: true });

test('M33 P repair the join: one report receives at most one assignment; a queued one is shared, at the next report', () => {
  // The follow-up (row 6) was sent BEFORE the first report (row 8): the helper received it after finishing (row 9).
  const delegations = [spawnD(4, 0), followD(6, 0)];
  const plan = (reports) => planHelperSegments({ delegations, sends: [send(delegations[0], 'S'), send(delegations[1], 'F')],
    helpers: [{ child: 0, spawn: 0, path: '/root/fix_parser', arrivals: [{ ...row(2, 0, 0), token: 'S' }, { ...row(9, 0, 3), token: 'F' }] }],
    reports });
  assert.deepEqual(plan([report(8), report(12)]).segments, [{ child: 0, segments: [
    { delivery: { delegation: 0 }, arrival: row(2, 0, 0), receipt: row(8) },
    { delivery: { delegation: 1 }, arrival: row(9, 0, 3), shared: row(8), next: row(12) }] }]);
  assert.deepEqual(plan([report(8)]).segments[0].segments[1], { delivery: { delegation: 1 }, arrival: row(9, 0, 3), shared: row(8) });
  // Sent after the first report: its own receipt, proven.
  const later = [spawnD(4, 0), followD(10, 0)];
  assert.deepEqual(planHelperSegments({ delegations: later, sends: [send(later[0], 'S'), send(later[1], 'F')],
    helpers: [{ child: 0, spawn: 0, path: '/root/fix_parser', arrivals: [{ ...row(2, 0, 0), token: 'S' }, { ...row(9, 0, 3), token: 'F' }] }],
    reports: [report(8), report(12)] }).segments[0].segments[1].receipt, row(12));
  // Three assignments before any report: the second takes the next report, the third finds none after it.
  const three = [spawnD(4, 0), followD(5, 0), followD(6, 0)];
  three[2].callId = 'follow-6b';
  const queued = planHelperSegments({ delegations: three, sends: [send(three[0], 'S'), send(three[1], 'F'), send(three[2], 'G')],
    helpers: [{ child: 0, spawn: 0, path: '/root/fix_parser', arrivals: [{ ...row(2, 0, 0), token: 'S' },
      { ...row(5, 0, 1), token: 'F' }, { ...row(8, 0, 2), token: 'G' }] }], reports: [report(9), report(11)] });
  assert.deepEqual(queued.segments[0].segments.map(({ delivery, arrival, ...placed }) => placed),
    [{ receipt: row(9) }, { shared: row(9), next: row(11) }, { shared: row(11) }]);
});

test('M33 P repair the join: a payload received by another linked helper places neither helper', () => {
  const [a, b] = [spawnD(4, 0), spawnD(6, 1, { taskName: '/root/write_notes', callId: 'spawn-b' })];
  const plan = planHelperSegments({ delegations: [a, b], sends: [send(a, 'A'), send(b, 'B')],
    helpers: [{ child: 0, spawn: 0, path: '/root/fix_parser', arrivals: [{ ...row(2, 0), token: 'B' }] },
      { child: 1, spawn: 1, path: '/root/write_notes', arrivals: [{ ...row(2, 0), token: 'A' }] }],
    reports: [report(8), { ...report(9), sender: '/root/write_notes' }] });
  assert.deepEqual(plan.segments, []);
  assert.deepEqual(plan.losses.filter((loss) => loss.reason === HELPER_DELIVERY_REASONS.conflict).map((loss) => loss.delivery),
    [{ delegation: 0 }, { delegation: 1 }]);
  // Only the conflicting pair: a third helper with its own delivery is still placed.
  const c = spawnD(7, 2, { taskName: '/root/third', callId: 'spawn-c' });
  const kept = planHelperSegments({ delegations: [a, b, c], sends: [send(a, 'A'), send(b, 'B'), send(c, 'C')],
    helpers: [{ child: 0, spawn: 0, path: '/root/fix_parser', arrivals: [{ ...row(2, 0), token: 'B' }] },
      { child: 1, spawn: 1, path: '/root/write_notes', arrivals: [{ ...row(2, 0), token: 'A' }] },
      { child: 2, spawn: 2, path: '/root/third', arrivals: [{ ...row(2, 0), token: 'C' }] }],
    reports: [{ ...report(9), sender: '/root/third' }] });
  assert.deepEqual(kept.segments.map((segment) => segment.child), [2]);
});
