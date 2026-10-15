// M33 W2 (C-03 "M33 W Workflow agents linked", placement at receipt), the slicer half. A Workflow call's launch side
// channel names WHERE the parent received the run's completion: the row of its earliest typed task notification that
// the M33 D join attaches to that very launch (the call's recorded id and the launch's own taskId) and that settles its
// final state (`completed` or `failed`). Its turn, the parent actions recorded before it (`beforeEvent`, as a
// commentary block or a typed interrupt mark is placed) and its row (stream, record). Never a timestamp; nothing joins
// by order. Synthetic recordings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { WORKFLOW_RECEIPT_STATUSES } from '../src/workflow-runs.js';
import { TASK_NOTIFICATION_STATUSES } from '../src/events.js';
import { CALL, RUN, SID, TASK, jsonl, workflowRows } from '../../cli/test/m33-w-workflow-fixture.js';
import { CALL_RESUME, TASK_RESUME, askRow, claimRow, launchRows, notificationRow, parentEditRows, parentTestRows,
  verifierBeforeFixRows } from '../../cli/test/m33-w2-placement-fixture.js';

async function launches(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-w2-slicer-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SID}.jsonl`);
  await writeFile(file, jsonl(rows), { mode: 0o600 });
  const plain = await sliceLineage([file]);
  const asked = await sliceLineage([file], { workflowLaunches: true });
  const { workflowLaunches, ...rest } = asked;
  assert.deepEqual(rest, plain, 'the receipt rides in the side channel only: no ledger byte moves');
  assert.equal(JSON.stringify(plain).includes('receipt'), false);
  return { calls: workflowLaunches.calls, ledger: plain };
}
const dir = '/srv/x/subagents/workflows/' + RUN;

test('M33 W2 the receipt statuses are M33 D\'s final states, a frozen subset of the notification statuses', () => {
  assert.deepEqual(WORKFLOW_RECEIPT_STATUSES, ['completed', 'failed']);
  assert.ok(Object.isFrozen(WORKFLOW_RECEIPT_STATUSES));
  for (const status of WORKFLOW_RECEIPT_STATUSES) assert.ok(TASK_NOTIFICATION_STATUSES.includes(status));
});

test('M33 W2 the side channel names the row where the parent received the run\'s completion', async (t) => {
  // Rows: 1 ask, 2 the call, 3 its launch result, 4 the notification, 5-6 the parent's Edit, 7-8 its rerun, 9 the claim.
  const { calls } = await launches(t, verifierBeforeFixRows({ transcriptDir: dir }));
  assert.deepEqual(calls[0].receipt, { turn: 1, beforeEvent: 1, source: 0, record: 4 },
    'one action recorded before it (the call), on the parent\'s stream, at row 4');
  for (const status of ['completed', 'failed']) {
    const [call] = (await launches(t, verifierBeforeFixRows({ transcriptDir: dir, status }))).calls;
    assert.deepEqual(call.receipt, { turn: 1, beforeEvent: 1, source: 0, record: 4 }, status);
  }
  const [queued] = (await launches(t, verifierBeforeFixRows({ transcriptDir: dir, carrier: 'queued' }))).calls;
  assert.deepEqual(queued.receipt, { turn: 1, beforeEvent: 1, source: 0, record: 4 }, 'the queued-command carrier too');
});

test('M33 W2 the earliest agreeing notification is the receipt; a later identical repeat moves nothing', async (t) => {
  const rows = [askRow(), ...launchRows({ transcriptDir: dir }), ...parentEditRows(), notificationRow(),
    ...parentTestRows(), notificationRow({ seed: 'again' }), claimRow()];
  const [call] = (await launches(t, rows)).calls;
  assert.deepEqual(call.receipt, { turn: 1, beforeEvent: 2, source: 0, record: 6 });
});

test('M33 W2 no receipt unless the M33 D join settles a final state for that very launch', async (t) => {
  const base = (notifications) => [askRow(), ...launchRows({ transcriptDir: dir }), ...notifications, ...parentTestRows(),
    claimRow()];
  for (const [why, notifications] of [
    ['none recorded (the session ended first)', []],
    ['stopped proves nothing', [notificationRow({ status: 'stopped' })]],
    ['two statuses disagree', [notificationRow(), notificationRow({ status: 'failed', seed: 'other' })]],
    ['the call named with another task id', [notificationRow({ task: 'wtask_synthetic_999' })]],
    ['an agreeing one beside one naming another task id', [notificationRow(),
      notificationRow({ task: 'wtask_synthetic_999', seed: 'foreign' })]],
    ['another call\'s notification', [notificationRow({ call: CALL_RESUME, task: TASK_RESUME })]],
  ]) {
    const [call] = (await launches(t, base(notifications))).calls;
    assert.equal(Object.hasOwn(call, 'receipt'), false, why);
  }
  // A notification recorded BEFORE the launch's own result joins nothing (M33 D: always a later row).
  const early = workflowRows({ transcriptDir: dir, notification: false });
  const [before] = (await launches(t, [askRow(), early[0], notificationRow(), early[1], claimRow()])).calls;
  assert.equal(Object.hasOwn(before, 'receipt'), false);
  // A launch with no taskId, or whose repeated result rows disagree, has nothing a notification can join.
  const [noTask] = (await launches(t, [askRow(), ...workflowRows({ transcriptDir: dir, task: '', notification: false }),
    notificationRow(), claimRow()])).calls;
  assert.equal(Object.hasOwn(noTask, 'receipt'), false);
});

test('M33 W2 each call of a resumed run carries its own receipt, joined by its own call id and taskId', async (t) => {
  const rows = [askRow(), ...launchRows({ transcriptDir: dir }), notificationRow({ status: 'failed' }), ...parentEditRows(),
    ...launchRows({ call: CALL_RESUME, task: TASK_RESUME, transcriptDir: dir, resumeFromRunId: RUN }),
    ...parentTestRows(), notificationRow({ call: CALL_RESUME, task: TASK_RESUME, seed: 'resume-n' }), claimRow()];
  const [origin, resume] = (await launches(t, rows)).calls;
  assert.deepEqual([origin.callId, resume.callId], [CALL, CALL_RESUME]);
  assert.deepEqual(origin.receipt, { turn: 1, beforeEvent: 1, source: 0, record: 4 });
  // Rows 5-6 the Edit, 7-8 the resume call and its result, 9-10 the rerun, 11 the resume's notification.
  assert.deepEqual(resume.receipt, { turn: 1, beforeEvent: 4, source: 0, record: 11 });
});

test('M33 W2 a receipt in a later human turn names that turn and the global count of actions before it', async (t) => {
  const rows = [askRow(), ...launchRows({ transcriptDir: dir }), askRow('Also update the README.', 'second'),
    ...parentEditRows(), notificationRow(), claimRow()];
  const [call] = (await launches(t, rows)).calls;
  assert.deepEqual(call.receipt, { turn: 2, beforeEvent: 2, source: 0, record: 7 });
  assert.equal(TASK, 'wtask_synthetic_001');
});
