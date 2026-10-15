// M33 P second repair, the slicer half. Whether a Claude Agent/Task hand-off ran in the background is read from what its
// own single result RECORDS, not from its input: Claude Code writes the asynchronous launch stub for calls whose input
// records no `run_in_background` (the repo's own B2 and M33 D fixtures). L2: by its typed
// status only. A single-block sidecar recording `status: "async_launched"` or `isAsync: true` is a LAUNCH: received only by
// its later notification or typed TaskOutput completion, never by the stub row itself. A sidecar recording another status
// — the agent's report, even for a call whose input asked for the background — is where the parent received it. A result
// with no typed status is neither: its launch mode is unknown and declared, whatever its words say. Synthetic rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { laterRequestTurn, planHelperSegments } from '../src/helper-deliveries.js';
import { AGENT, AGENT_CALL, agentCallRow, agentNotification, agentReportRow, agentStubRow, claudeFlaggedReportRows,
  claudeRow, claudeStubRows, jsonl } from '../../cli/test/m33-p-placement-fixture.js';

async function file(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-p-repair2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'session.jsonl');
  await writeFile(path, jsonl(rows), { mode: 0o600 });
  return path;
}
const deliveriesOf = async (t, rows) => (await sliceLineage([await file(t, rows)], { helperDeliveries: true })).helperDeliveries;
const row = (record, turn = 1, beforeEvent = 0) => ({ turn, beforeEvent, source: 0, record });
const launchOf = (receipt) => ({ callId: AGENT_CALL, agentId: AGENT, source: 0, record: 2, turn: 1,
  ...(receipt ? { receipt } : {}) });

test('M33 P second repair: a launch stub answering a call with no background input is a launch, never a receipt', async (t) => {
  for (const stub of ['b2-sidecar', 'm33d', 'typed'])
    for (const name of ['Agent', 'Task']) {
      // Rows: 1 ask, 2 the call, 3 the stub, 4 the mid-turn claim, 5-6 the commit; no completion recorded.
      const unreceived = await deliveriesOf(t, claudeStubRows({ stub, name }));
      assert.deepEqual(unreceived.agents, [launchOf()], `${stub}/${name}: a launch with no receipt`);
      assert.deepEqual(unreceived.calls, [], `${stub}/${name}: the stub row is no synchronous receipt`);
      assert.deepEqual(unreceived.unknown, [], `${stub}/${name}: its mode is typed`);
      // 7 the completion notification: the launch's receipt.
      assert.deepEqual((await deliveriesOf(t, claudeStubRows({ stub, name, after: 'notified' }))).agents,
        [launchOf(row(7, 1, 1))], `${stub}/${name}: received at its notification`);
      // 5-6 a typed TaskOutput completion of its agentId: received at its result row.
      assert.deepEqual((await deliveriesOf(t, claudeStubRows({ stub, name, after: 'polled' }))).agents,
        [launchOf(row(6, 1, 1))], `${stub}/${name}: received by TaskOutput`);
    }
  // With the background input too, as before.
  assert.deepEqual((await deliveriesOf(t, claudeStubRows({ flag: true, after: 'notified' }))).agents, [launchOf(row(7, 1, 1))]);
});

test('M33 P second repair: a call whose input asked for the background but whose result is the report: received there', async (t) => {
  // Rows: 1 ask, 2 the call (run_in_background: true), 3 the agent's completed report, 4 the claim.
  const deliveries = await deliveriesOf(t, claudeFlaggedReportRows());
  assert.deepEqual(deliveries.agents, [], 'no launch');
  assert.deepEqual(deliveries.calls, [{ callId: AGENT_CALL, source: 0, record: 2, turn: 1, receipt: row(3) }]);
  // Without the input flag: the same.
  const [ask, , report, claim] = claudeFlaggedReportRows();
  assert.deepEqual((await deliveriesOf(t, [ask, agentCallRow(), report, claim])).calls.map((c) => c.receipt), [row(3)]);
});

test('L2: the typed status decides a hand-off\'s mode, never its words; with none recorded the mode is unknown', async (t) => {
  const [ask, call] = claudeStubRows();
  const unknown = [{ callId: AGENT_CALL, source: 0, record: 2, turn: 1 }];
  // The launch line beside a sidecar recording a completed run: the typed status says the parent received it there.
  const contradicted = await deliveriesOf(t, [ask, call, agentStubRow({ stub: 'contradicted' }), agentNotification(AGENT_CALL)]);
  assert.deepEqual([contradicted.agents, contradicted.calls, contradicted.unknown],
    [[], [{ ...unknown[0], receipt: row(3) }], []]);
  // The launch line with no sidecar (the B2 text alone): no typed status, so neither a launch nor a receipt — unknown.
  for (const rows of [claudeStubRows({ stub: 'b2' }), claudeStubRows({ stub: 'b2', after: 'notified' })]) {
    const untyped = await deliveriesOf(t, rows);
    assert.deepEqual([untyped.agents, untyped.calls, untyped.unknown], [[], [], unknown]);
  }
  // A report with no sidecar is unknown too: its words are not read.
  const report = claudeRow('user', [{ type: 'tool_result', tool_use_id: AGENT_CALL, content: 'The helper ran the suite.' }],
    {}, 'untyped-report');
  assert.deepEqual((await deliveriesOf(t, [ask, call, report])).unknown, unknown);
  // A typed launch naming no agentId launches nothing and receives nothing.
  const anonymous = claudeRow('user', [{ type: 'tool_result', tool_use_id: AGENT_CALL, content: 'Started.' }],
    { toolUseResult: { status: 'async_launched' } }, 'anon');
  const none = await deliveriesOf(t, [ask, call, anonymous, agentNotification(AGENT_CALL)]);
  assert.deepEqual([none.agents, none.calls, none.unknown], [[], [], []]);
  // A stub and then a report for the same call: two results, no one launch and no one receipt.
  const twice = await deliveriesOf(t, [ask, call, agentStubRow(), agentReportRow(), agentNotification(AGENT_CALL)]);
  assert.deepEqual([twice.agents, twice.calls, twice.unknown], [[], [], []]);
});

const spawnD = (record, extra = {}) => ({ adapter: 'codex', kind: 'spawn', callId: `spawn-${record}`, source: 0, record,
  turn: 1, status: 'linked', taskName: '/root/fix_parser', link: { source: 0 }, ...extra });
const followD = (record) => ({ adapter: 'codex', kind: 'followup', callId: `follow-${record}`, source: 0, record, turn: 1,
  status: 'linked', target: 'fix_parser', link: { source: 0 } });
const send = (d, token) => ({ kind: 'delegation', callId: d.callId, source: 0, record: d.record, turn: 1, token });
const report = (record) => ({ ...row(record), sender: '/root/fix_parser', toParent: true });
const arrivalAt = (record, beforeEvent, token) => ({ turn: 0, beforeEvent, source: 0, record, token });

test('M33 P second repair the join: more reports than segments, or a stray after an action, ties no report', () => {
  const delegations = [spawnD(4), followD(9)];
  const plan = (arrivals, reports) => planHelperSegments({ delegations, sends: [send(delegations[0], 'S'), send(delegations[1], 'F')],
    helpers: [{ child: 0, spawn: 0, path: '/root/fix_parser', arrivals }], reports }).segments[0].segments
    .map(({ delivery, arrival, ...placed }) => placed);
  const spawned = arrivalAt(2, 0, 'S');
  const followed = arrivalAt(8, 2, 'F');
  // One report per assignment, no stray: each its own receipt, as before.
  assert.deepEqual(plan([spawned, followed], [report(8), report(12)]), [{ receipt: row(8) }, { receipt: row(12) }]);
  // A third report: none of the helper's reports is tied to a segment.
  assert.deepEqual(plan([spawned, followed], [report(8), report(10), report(12)]), [{ ambiguous: true }, { ambiguous: true }]);
  // A stray arrival after the helper acted in its second segment: from that segment on.
  assert.deepEqual(plan([spawned, followed, arrivalAt(11, 3, 'X')], [report(8), report(12)]), [{ receipt: row(8) }, { ambiguous: true }]);
  // ... in its first segment: from the first.
  assert.deepEqual(plan([spawned, arrivalAt(5, 1, 'X'), followed], [report(8), report(12)]), [{ ambiguous: true }, { ambiguous: true }]);
  // A stray recorded before any action of its segment (the same turn's input) changes no receipt.
  assert.deepEqual(plan([spawned, arrivalAt(3, 0, 'X'), followed], [report(8), report(12)]), [{ receipt: row(8) }, { receipt: row(12) }]);
});

test('M33 P second repair laterRequestTurn: the first recorded turn after the helper\'s own first request, or null', () => {
  assert.equal(laterRequestTurn({ instructions: [{ turn: 1 }], ledger: [{ turn: 1 }], sayings: [{ turn: 1 }] }), null);
  assert.equal(laterRequestTurn({ instructions: [{ turn: 1 }, { turn: 2 }], ledger: [{ turn: 1 }, { turn: 2 }] }), 2);
  // A later turn recorded only by an action (its request withheld) still counts.
  assert.equal(laterRequestTurn({ instructions: [{ turn: 1 }], ledger: [{ turn: 1 }, { turn: 3 }] }), 3);
  assert.equal(laterRequestTurn({ ledger: [{ turn: 1 }, { turn: 2 }] }), 2);
  for (const unreadable of [null, undefined, {}, { instructions: 'x' }, { ledger: [{ turn: 'T2' }, { turn: -1 }] }])
    assert.equal(laterRequestTurn(unreadable), null);
});
