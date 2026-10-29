// D175 (beta.9 known issue 3), the slicer half. A Claude SendMessage that RESUMED a launched helper is typed by the
// recorder at both ends: its one result's sidecar records `success: true` and the helper's `resumedAgentId` (and
// `revivedAgentId` only as the same id), and a later task notification names that call's id and that agentId. The
// slicer keeps each such resume in its delivery side channel (`resumes`), with the row of the one final notification
// joined to it as its receipt; `planClaudeResumes` (pure) proves which of the helper's own later requests each resume
// delivered, by its message found verbatim in exactly one of them, in order. Synthetic rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { laterRequestTurn, laterTurnsOf, planClaudeResumes } from '../src/helper-deliveries.js';
import { AGENT, AGENT_CALL, CONTINUE_TEXT, SEND_MESSAGE_CALL, agentCallRow, agentNotification, agentStubRow, claudeRow,
  jsonl } from '../../cli/test/m33-p-placement-fixture.js';

async function file(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d175-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'session.jsonl');
  await writeFile(path, jsonl(rows), { mode: 0o600 });
  return path;
}
const sliced = async (t, rows) => sliceLineage([await file(t, rows)], { helperDeliveries: true });
const resumesOf = async (t, rows) => (await sliced(t, rows)).helperDeliveries.resumes;
const HUMAN_PROMPT = { origin: { kind: 'human' }, promptSource: 'sdk' };
const sidecarOf = (extra = {}) => ({ success: true, message: 'Message sent.', resumedAgentId: AGENT, revivedAgentId: AGENT,
  ...extra });
const notice = (id, status = 'completed', task = AGENT, seed = '') => claudeRow('user', `<task-notification>\n<task-id>${task}`
  + `</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<summary>Agent finished</summary>\n`
  + '</task-notification>', { origin: { kind: 'task-notification' } }, `d175:n:${id}:${status}:${task}${seed}`);
/**
 * Rows: 1 ask, 2 the Agent call, 3 its launch stub, 4 its notification, 5 the SendMessage, 6 its result (`sidecar`, or
 * none), then `after` (the resume's notifications by default).
 */
function rows({ sidecar = sidecarOf(), input = { to: AGENT, message: CONTINUE_TEXT, summary: 'run the suite' },
  error = false, after = [notice(SEND_MESSAGE_CALL)] } = {}) {
  return [claudeRow('user', 'SYNTHETIC_D175_ASK: fix it with a helper.', HUMAN_PROMPT, 'd175:ask'), agentCallRow({ flag: true }),
    agentStubRow(), agentNotification(AGENT_CALL),
    claudeRow('assistant', [{ type: 'tool_use', id: SEND_MESSAGE_CALL, name: 'SendMessage', input }], {}, 'd175:send'),
    claudeRow('user', [{ type: 'tool_result', tool_use_id: SEND_MESSAGE_CALL, content: 'Message sent.',
      ...(error ? { is_error: true } : {}) }], sidecar ? { toolUseResult: sidecar } : {}, 'd175:send:r'), ...after,
    claudeRow('assistant', [{ type: 'text', text: 'Done.' }], {}, 'd175:done')];
}
const at = (record, beforeEvent = 1) => ({ turn: 1, beforeEvent, source: 0, record });
const resume = (receipt) => ({ callId: SEND_MESSAGE_CALL, agentId: AGENT, turn: 1, seq: 0, source: 0, record: 5,
  message: CONTINUE_TEXT, ...(receipt ? { receipt } : {}) });

test('D175: a typed resume is kept with its message, received at the one final notification naming its call and agentId', async (t) => {
  assert.deepEqual(await resumesOf(t, rows()), [resume(at(7))]);
  // `revivedAgentId` absent: the same; a `failed` final status is a receipt too (C-02 M33 D).
  assert.deepEqual(await resumesOf(t, rows({ sidecar: sidecarOf({ revivedAgentId: undefined }) })), [resume(at(7))]);
  assert.deepEqual(await resumesOf(t, rows({ after: [notice(SEND_MESSAGE_CALL, 'failed')] })), [resume(at(7))]);
  // The earliest row of an agreeing join, as for a launch.
  assert.deepEqual(await resumesOf(t, rows({ after: [notice(SEND_MESSAGE_CALL), notice(SEND_MESSAGE_CALL, 'completed', AGENT, ':2')] })),
    [resume(at(7))]);
  // Claude Code's later input shape (`recipient_kind` beside the typed fields) is a generic action: still a resume.
  assert.deepEqual(await resumesOf(t, rows({ input: { to: AGENT, message: CONTINUE_TEXT, summary: 's', recipient: AGENT,
    recipient_kind: 'agent', type: 'message', content: CONTINUE_TEXT } })), [resume(at(7))]);
  // A message that is no string is kept as null (it delivers nothing later).
  assert.deepEqual(await resumesOf(t, rows({ input: { to: AGENT, message: { text: CONTINUE_TEXT } } })),
    [{ ...resume(at(7)), message: null }]);
  // No ledger byte moves: the side channel only.
  const plain = await sliceLineage([await file(t, rows())]);
  const asked = await sliced(t, rows());
  assert.equal(plain.helperDeliveries, undefined);
  assert.deepEqual(asked.ledger, plain.ledger);
});

test('D175 fix round: each user row labelled a task notification is kept by its row (`wakes`)', async (t) => {
  // Rows 4 (the launch's) and 7 (the resume's); the SendMessage's result and the ask are no notification.
  assert.deepEqual((await sliced(t, rows())).helperDeliveries.wakes,
    [{ turn: 1, source: 0, record: 4 }, { turn: 1, source: 0, record: 7 }]);
  // A queued notification (the `queued_command` attachment, which joins a request in progress) is a notification
  // (it still joins its launch), but no wake.
  const queued = claudeRow('attachment', undefined, { attachment: { type: 'queued_command', commandMode: 'task-notification',
    prompt: `<task-notification>\n<task-id>${AGENT}</task-id>\n<tool-use-id>${SEND_MESSAGE_CALL}</tool-use-id>\n`
      + '<status>completed</status>\n</task-notification>' }, message: undefined }, 'd175:queued');
  const asQueued = await sliced(t, rows({ after: [queued] }));
  assert.deepEqual(asQueued.helperDeliveries.wakes.map((n) => n.record), [4]);
  assert.deepEqual(asQueued.helperDeliveries.resumes, [resume(at(7))]);
  assert.deepEqual((await sliced(t, rows({ after: [] }))).helperDeliveries.wakes.map((n) => n.record), [4]);
});

test('D175 fix round: an interrupted or outcome-unknown result, or a different repeat of it, resumes nothing', async (t) => {
  assert.deepEqual(await resumesOf(t, rows({ sidecar: sidecarOf({ interrupted: true }) })), [], 'the sidecar says interrupted');
  const hooked = await sliceLineage([await file(t, rows())], { helperDeliveries: true,
    outcomes: new Map([[SEND_MESSAGE_CALL, { interrupted: true }]]) });
  assert.deepEqual(hooked.helperDeliveries.resumes, [], 'the PostToolUse hook recorded it interrupted');
  const unknown = rows();
  unknown[5] = { ...unknown[5], outcomeUnknown: true };
  assert.deepEqual(await resumesOf(t, unknown), [], 'its outcome is unknown');
  // Judgment call 4: an identical repeat of its result keeps the resume (received at the notification after it); a
  // different one retracts the result, and the resume with it.
  const result = (content, seed) => claudeRow('user', [{ type: 'tool_result', tool_use_id: SEND_MESSAGE_CALL, content }],
    { toolUseResult: sidecarOf() }, seed);
  assert.deepEqual(await resumesOf(t, rows({ after: [result('Message sent.', 'd175:again'), notice(SEND_MESSAGE_CALL)] })),
    [resume(at(8))]);
  assert.deepEqual(await resumesOf(t, rows({ after: [result('Message sent twice.', 'd175:other'), notice(SEND_MESSAGE_CALL)] })),
    []);
});

test('D175: a resume with no exact receipt is kept without one; a poll, a stop or two statuses receive nothing', async (t) => {
  for (const [why, after] of [
    ['no notification', []],
    ['a notification of another task', [notice(SEND_MESSAGE_CALL, 'completed', 'a0000000000000000')]],
    ['a notification of the launch only', [notice(AGENT_CALL, 'completed', AGENT, ':again')]],
    ['a stopped run', [notice(SEND_MESSAGE_CALL, 'stopped')]],
    ['two statuses', [notice(SEND_MESSAGE_CALL), notice(SEND_MESSAGE_CALL, 'failed')]],
    ['a TaskOutput poll of the agentId', [claudeRow('assistant', [{ type: 'tool_use', id: 'toolu_d175_poll', name: 'TaskOutput',
      input: { task_id: AGENT } }], {}, 'd175:poll'), claudeRow('user', [{ type: 'tool_result', tool_use_id: 'toolu_d175_poll',
      content: `<task_id>${AGENT}</task_id> done` }], { toolUseResult: { retrieval_status: 'success', task: { task_id: AGENT,
      status: 'completed' } } }, 'd175:poll:r')]],
  ]) assert.deepEqual(await resumesOf(t, rows({ after })), [resume()], why);
});

test('D175: no resume without the typed sidecar of one successful result naming one agentId', async (t) => {
  for (const [why, options] of [
    ['no sidecar (an older recorder)', { sidecar: null }],
    ['a message to a running agent (no resumedAgentId)', { sidecar: { success: true, message: 'Message sent.' } }],
    ['an error result', { error: true }],
    ['success not true', { sidecar: sidecarOf({ success: false }) }],
    ['revivedAgentId another id', { sidecar: sidecarOf({ revivedAgentId: 'a0000000000000000' }) }],
    ['resumedAgentId no id', { sidecar: sidecarOf({ resumedAgentId: 'not an id' }) }],
  ]) assert.deepEqual(await resumesOf(t, rows(options)), [], why);
  // A result row of two blocks carries no sidecar for either.
  const twoBlocks = rows();
  twoBlocks[5] = claudeRow('user', [{ type: 'tool_result', tool_use_id: SEND_MESSAGE_CALL, content: 'Message sent.' },
    { type: 'tool_result', tool_use_id: 'toolu_other', content: 'x' }], { toolUseResult: sidecarOf() }, 'd175:send:r2');
  assert.deepEqual(await resumesOf(t, twoBlocks), []);
});

// ---- planClaudeResumes (pure) ------------------------------------------------------------------------------------------

const row = (record, turn = 1, beforeEvent = 1) => ({ turn, beforeEvent, source: 0, record });
const R = (record, message, receipt) => ({ turn: 1, seq: record, source: 0, record, message, ...(receipt ? { receipt } : {}) });
const turns = (...texts) => texts.map((text, k) => ({ turn: k + 2, texts: text === null ? [] : [text] }));

test('D175: each later request a resume delivered, in order, at a receipt after the one before, is proven', () => {
  const first = row(4);
  assert.deepEqual(planClaudeResumes({ turns: turns('wrapped: M1 :end', 'M2'), first,
    resumes: [R(5, 'M1', row(7)), R(9, 'M2', row(11))] }), { proven: [
    { turn: 2, action: { turn: 1, seq: 5 }, receipt: row(7) }, { turn: 3, action: { turn: 1, seq: 9 }, receipt: row(11) }],
  unproven: null });
  // Recorded order decides, not the order given.
  assert.deepEqual(planClaudeResumes({ turns: turns('M1', 'M2'), first, resumes: [R(9, 'M2', row(11)), R(5, 'M1', row(7))] })
    .proven.length, 2);
  // Across the files of a lineage: a later file's rows after every row of an earlier one, whatever their numbers.
  const inStream = (source, record, message, receipt) => ({ turn: 1 + source, seq: 0, source, record, message,
    receipt: { turn: 1 + source, beforeEvent: 1, source, record: receipt } });
  assert.deepEqual(planClaudeResumes({ turns: turns('M1', 'M2'), first,
    resumes: [inStream(1, 2, 'M2', 5), inStream(0, 9, 'M1', 11)] }).proven.map((p) => p.action),
  [{ turn: 1, seq: 0 }, { turn: 2, seq: 0 }]);
  // The helper's first turn woken (its hand-off's segment, under the M33 P rule) does not touch the later ones.
  assert.equal(planClaudeResumes({ turns: turns('M1', 'M2'), first, woken: [1],
    resumes: [R(5, 'M1', row(7)), R(9, 'M2', row(11))] }).proven.length, 2);
});

test('D175: the first later request not proven, and every one after it, stays unproven', () => {
  const first = row(4);
  const cases = [
    ['no first receipt', { turns: turns('M1'), first: null, resumes: [R(5, 'M1', row(7))] }, 0],
    ['no resume', { turns: turns('M1'), first, resumes: [] }, 0],
    ['the message in no request', { turns: turns('other'), first, resumes: [R(5, 'M1', row(7))] }, 0],
    ['the message in two requests', { turns: turns('M1', 'M1 again'), first, resumes: [R(5, 'M1', row(7)), R(9, 'M2', row(11))] }, 0],
    ['an empty message', { turns: turns('M1'), first, resumes: [R(5, '', row(7))] }, 0],
    ['a message sent twice', { turns: turns('M1', 'other'), first, resumes: [R(5, 'M1', row(7)), R(9, 'M1', row(11))] }, 0],
    ['a request with no text', { turns: turns(null), first, resumes: [R(5, 'M1', row(7))] }, 0],
    ['no receipt', { turns: turns('M1'), first, resumes: [R(5, 'M1')] }, 0],
    ['a receipt before its own row', { turns: turns('M1'), first, resumes: [R(5, 'M1', row(3))] }, 0],
    // After the first receipt (row 2), before its own row (5): only the own-row rule rejects it.
    ['a receipt after the one before but before its own row', { turns: turns('M1'), first: row(2),
      resumes: [R(5, 'M1', row(3))] }, 0],
    // D175 fix round: a turn a task of the helper's own woke is not proven, whatever the receipt.
    ['a woken turn', { turns: turns('M1'), first, resumes: [R(5, 'M1', row(7))], woken: [2] }, 0],
    ['a proven turn, then a woken one', { turns: turns('M1', 'M2'), first, resumes: [R(5, 'M1', row(7)), R(9, 'M2', row(11))],
      woken: [3] }, 1],
    ['a receipt not after the one before', { turns: turns('M1'), first: row(8), resumes: [R(5, 'M1', row(7))] }, 0],
    ['swapped: resume 1 delivered request 2', { turns: turns('M2', 'M1'), first, resumes: [R(5, 'M1', row(7)), R(9, 'M2', row(11))] }, 0],
    ['receipts not increasing', { turns: turns('M1', 'M2'), first, resumes: [R(5, 'M1', row(12)), R(9, 'M2', row(11))] }, 1],
    ['a proven prefix, then a request no resume delivered', { turns: turns('M1', 'M3'), first,
      resumes: [R(5, 'M1', row(7)), R(9, 'M2', row(11))] }, 1],
  ];
  for (const [why, input, proven] of cases) {
    const plan = planClaudeResumes(input);
    assert.equal(plan.proven.length, proven, why);
    assert.equal(plan.unproven, input.turns[proven].turn, why);
  }
});

test('D175: laterTurnsOf reads every later turn, with its requests\' texts; laterRequestTurn is its first', () => {
  const ledger = { instructions: [{ turn: 1, text: 'brief' }, { turn: 3, text: 'b' }, { turn: 2, text: 'a' }, { turn: 3, text: 'c' }],
    ledger: [{ turn: 4 }, { turn: 1 }], sayings: [{ turn: 'x' }] };
  assert.deepEqual(laterTurnsOf(ledger), [{ turn: 2, texts: ['a'] }, { turn: 3, texts: ['b', 'c'] }, { turn: 4, texts: [] }]);
  assert.equal(laterRequestTurn(ledger), 2);
  assert.deepEqual(laterTurnsOf({ instructions: [{ turn: 1, text: 'only' }] }), []);
  assert.equal(laterRequestTurn({ instructions: [{ turn: 1, text: 'only' }] }), null);
  assert.deepEqual(laterTurnsOf(null), []);
});
