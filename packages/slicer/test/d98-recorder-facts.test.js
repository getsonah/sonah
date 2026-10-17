// D98 (F1 core): one reading per recorder fact. Claude Code changes the shape of a record between releases; a reader
// that knows a fact by one exact shape drops the record, and a second reader of the same fact may still take it. Two
// facts are read here, each by one rule that every reader calls:
//
//   - a task notification: the recorder's own kind field (an origin's `kind`, a queued command's `commandMode`), any
//     other recorder key beside the kind being metadata (harness-context.js `claudeNotificationCarrier`). Its readers:
//     the labeller, the reader that keeps a queued notification as a record of its own, and the status join.
//   - a background launch: its typed sidecar id, named literally by its visible result (events.js
//     `resultNamesTypedId`), never a harness sentence.
//
// Every row is synthetic and mirrors only the recorder's known key sets. No real recording is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { readSession, labelClaudeRows, claudeRowClass } from '../src/records.js';
import { claudeTaskNotification, taskNotificationRead, resultNamesTypedId, COMMAND_STATUS_SOURCES }
  from '../src/events.js';
import { claudeNotificationCarrier, TASK_NOTIFICATION_KIND } from '../src/harness-context.js';
import { LABEL_BASIS } from '../src/labels.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const SESSION = 'c0ffee00-0000-4000-8000-0000000000d8';
const row = (extra) => ({ sessionId: SESSION, cwd: '/repo', isSidechain: false, version: '2.1.296', ...extra });
const ask = (text) => row({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const use = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const answer = (id, content, { isError, sidecar } = {}) => row({ type: 'user', message: { role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] },
  ...(sidecar === undefined ? {} : { toolUseResult: sidecar }) });
const SUCCESS = Object.freeze({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
const body = (taskId, callId, status) => `<task-notification>\n<task-id>${taskId}</task-id>\n`
  + `<tool-use-id>${callId}</tool-use-id>\n<output-file>/private/tmp/tasks/${taskId}.output</output-file>\n`
  + `<status>${status}</status>\n<summary>Background command finished</summary>\n</task-notification>`;
/** A notification on a user row, its origin as given (none when null). */
const notice = (taskId, callId, status, origin = { kind: TASK_NOTIFICATION_KIND }) => row({ type: 'user',
  ...(origin === null ? {} : { origin }), message: { role: 'user', content: body(taskId, callId, status) } });
/** The same text, queued as a `queued_command` attachment, its mode and origin as given. */
let queuedN = 0;
const queued = (taskId, callId, status, { commandMode = TASK_NOTIFICATION_KIND, origin } = {}) => row({
  type: 'attachment', entrypoint: 'claude-desktop', gitBranch: 'main', parentUuid: null,
  timestamp: '2026-10-17T00:00:00Z', userType: 'external', uuid: `q-${taskId}-${queuedN++}`,
  attachment: { type: 'queued_command', commandMode, ...(origin === undefined ? {} : { origin }),
    timestamp: '2026-10-17T00:00:00Z', prompt: body(taskId, callId, status) } });
/** A background Bash launch: its typed sidecar id, and the visible result text as given. */
const launch = (id, taskId, command, visible, extra = {}) => [
  use(id, 'Bash', { command, run_in_background: true }),
  answer(id, visible, { isError: false, sidecar: { ...SUCCESS, backgroundTaskId: taskId, ...extra } })];
const stub = (taskId) => `Command running in background with ID: ${taskId}. Output is being written to: `
  + `/private/tmp/${taskId}.output`;
/** The form Claude Code writes when a command outlives its timeout and moves to the background. */
const movedStub = (taskId) => `Command timed out after 2m 0s and was moved to the background (ID: ${taskId}). `
  + 'Use TaskOutput to read its output.';

async function sliced(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d98-facts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, [ask('Build it in the background.'), ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const raw = await sliceLineage([file], { cwd: '/repo' });
  return { file, raw, session: sessionFromLedger(redact(raw).ledger, { sessionKey: 'd98-facts' }) };
}
const act = (raw, cmd) => raw.ledger.find((e) => e.cmd === cmd);

// ---- a task notification: one carrier rule, every reader ---------------------------------------------------------

/** Every carrier shape the rule must settle: the kind with and without recorder keys beside it, another kind, no
 *  origin, a contradicting origin, a non-object origin, another mode. */
const ORIGINS = Object.freeze([
  ['exact kind', { kind: TASK_NOTIFICATION_KIND }],
  ['kind with producer and runId', { kind: TASK_NOTIFICATION_KIND, producer: 'session-task', runId: 'r-1' }],
  ['kind with runId only', { kind: TASK_NOTIFICATION_KIND, runId: 'r-2' }],
  ['kind with a key no recorder wrote yet', { kind: TASK_NOTIFICATION_KIND, futureKey: { a: 1 } }],
  ['a human origin', { kind: 'human' }],
  ['a peer origin', { kind: 'peer' }],
  ['an origin with no kind', { producer: 'session-task' }],
  ['a string origin', TASK_NOTIFICATION_KIND],
  ['a null origin', null],
]);
/** D98 (review of A1a): a queued command's row or attachment as a recorder release may change it, each outside the key sets and value
 *  shapes the strict attachment classifier knows (records.js `claudeAttachment`), so that classifier rejects every one.
 *  Whether such a row is a task notification is still the carrier rule's alone: the classifier counts its loss. */
const DRIFTS = Object.freeze([
  ['a row key no recorder wrote yet', (r) => ({ ...r, promptId: 'p-1' })],
  ['an attachment key no recorder wrote yet', (r) => ({ ...r, attachment: { ...r.attachment, priority: 'next' } })],
  ['a row of another user type', (r) => ({ ...r, userType: 'internal' })],
  ['a row with no sidechain flag', ({ isSidechain, ...r }) => r],
  ['a rendered role with no rendered blocks', (r) => ({ ...r, renderedRole: 'system' })],
  ['rendered blocks of a new shape', (r) => ({ ...r, rendered: [{ content: 'x', kind: 'text' }] })],
  ['a reminder id on a command not flagged meta', (r) => ({ ...r, attachment: { ...r.attachment, reminderId: 'm-1' } })],
  ['an agent id on a main-thread row', (r) => ({ ...r, agentId: 'a0123456789abcdef' })],
  ['a prompt that is not a string', (r) => ({ ...r, attachment: { ...r.attachment, prompt: [{ text: 'x' }] } })],
]);
const SHAPES = Object.freeze([
  ...ORIGINS.map(([name, origin]) => [`user row, ${name}`, notice('bg1', 'c1', 'completed', origin)]),
  ['user row, no origin', notice('bg1', 'c1', 'completed', null)],
  ...ORIGINS.map(([name, origin]) => [`queued, ${name}`, queued('bg1', 'c1', 'completed', { origin })]),
  ['queued, no origin', queued('bg1', 'c1', 'completed')],
  ...ORIGINS.map(([name, origin]) => [`queued prompt mode, ${name}`,
    queued('bg1', 'c1', 'completed', { commandMode: 'prompt', origin })]),
  ...DRIFTS.map(([name, drift]) => [`queued, ${name}`,
    drift(queued('bg1', 'c1', 'completed', { origin: { kind: TASK_NOTIFICATION_KIND, producer: 'session-task' } }))]),
  ...DRIFTS.map(([name, drift]) => [`queued prompt mode, ${name}`,
    drift(queued('bg1', 'c1', 'completed', { commandMode: 'prompt', origin: { kind: 'human' } }))]),
]);

test('D98 F1: a row is a task notification for the labeller exactly when it is one for the reader and the status join',
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'sonah-d98-agree-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    let carriers = 0;
    for (const [i, [name, shape]] of SHAPES.entries()) {
      const carrier = claudeNotificationCarrier(shape) !== null;
      carriers += carrier ? 1 : 0;
      // The labeller (records.js claudeLabeller), on the row as recorded after a human's ask.
      const [, labelled] = labelClaudeRows([ask('go'), shape]);
      const basis = labelled.basis ?? labelled.parts?.[0]?.basis ?? null;
      assert.equal(basis === LABEL_BASIS.taskNotification, carrier, `labeller: ${name}`);
      // The status join (events.js taskNotificationRead) reads a header only on a carrier; every carrier here but the
      // one whose prompt is no string holds one well-formed header, so it types exactly those carriers.
      assert.equal(taskNotificationRead(shape) !== null, carrier, `status join: ${name}`);
      const wellFormed = typeof (shape.type === 'user' ? shape.message.content : shape.attachment.prompt) === 'string';
      assert.equal(claudeTaskNotification(shape) !== null, carrier && wellFormed, `status join types: ${name}`);
      // The reader (records.js readSession) keeps a queued notification as a record of its own exactly on a carrier,
      // whatever its strict attachment classifier makes of the row.
      if (shape.type === 'attachment') {
        const file = join(dir, `${i}.jsonl`);
        await writeFile(file, `${JSON.stringify(ask('go'))}\n${JSON.stringify(shape)}\n`);
        const { records } = await readSession(file);
        assert.equal(records.some((rec) => rec.kind === 'notification'), carrier, `reader: ${name}`);
      }
    }
    // The rule takes every shape that carries the kind and contradicts nothing: 4 origins of the kind on each carrier,
    // a queued notification with no origin, and a queued notification whatever recorder drift its row carries.
    assert.equal(carriers, 9 + DRIFTS.length);
    // Every drifted row is one the strict attachment classifier rejects: the matrix holds the shapes where a reader
    // gated by it would disagree with the labeller.
    for (const [name, shape] of SHAPES.filter(([name]) => DRIFTS.some(([drift]) => name.endsWith(drift))))
      assert.equal(claudeRowClass(shape), null, `classifier: ${name}`);
    // A notification's origin beside a prompt's mode contradicts the kind field: unlabelled under its counted gap, so no
    // reader takes it as a notification or as a human's words.
    const [, contradiction] = labelClaudeRows([ask('go'),
      queued('bg1', 'c1', 'completed', { commandMode: 'prompt', origin: { kind: TASK_NOTIFICATION_KIND } })]);
    assert.deepEqual([contradiction.label, contradiction.gap], [null, 'origin_unknown']);
  });

test('D98 F1: a notice whose origin carries recorder keys beside its kind closes its launch, on both carriers',
  async (t) => {
    const extra = { kind: TASK_NOTIFICATION_KIND, producer: 'session-task', runId: 'r-9' };
    const { raw, session } = await sliced(t, [
      ...launch('u1', 'bgu1', 'npm run build', stub('bgu1')), notice('bgu1', 'u1', 'completed', extra),
      ...launch('u2', 'bgu2', 'npm run lint', stub('bgu2')), notice('bgu2', 'u2', 'failed', extra),
      ...launch('q1', 'bgq1', 'npm run e2e', stub('bgq1')), queued('bgq1', 'q1', 'completed', { origin: extra }),
      // A queued notice whose row, or whose attachment, carries a key the strict attachment classifier does not
      // know closes its launch all the same.
      ...launch('q2', 'bgq2', 'npm run bench', stub('bgq2')),
      DRIFTS[0][1](queued('bgq2', 'q2', 'completed', { origin: extra })),
      ...launch('q3', 'bgq3', 'npm run docs', stub('bgq3')),
      DRIFTS[1][1](queued('bgq3', 'q3', 'failed', { origin: extra })),
    ]);
    const built = act(raw, 'npm run build');
    assert.deepEqual([built.outcome, built.outcomeSource, built.statusSource],
      ['passed', 'native', COMMAND_STATUS_SOURCES.claudeTaskNotification]);
    assert.deepEqual([act(raw, 'npm run lint').outcome, act(raw, 'npm run lint').statusSource],
      ['failed', COMMAND_STATUS_SOURCES.claudeTaskNotification]);
    assert.equal(act(raw, 'npm run e2e').statusSource, COMMAND_STATUS_SOURCES.claudeTaskNotification);
    assert.deepEqual([act(raw, 'npm run bench').outcome, act(raw, 'npm run bench').statusSource],
      ['passed', COMMAND_STATUS_SOURCES.claudeTaskNotification]);
    assert.deepEqual([act(raw, 'npm run docs').outcome, act(raw, 'npm run docs').statusSource],
      ['failed', COMMAND_STATUS_SOURCES.claudeTaskNotification]);
    // Each launch counts the one notice linked to it, as the labeller linked it.
    for (const cmd of ['npm run build', 'npm run lint', 'npm run e2e', 'npm run bench', 'npm run docs'])
      assert.equal(act(raw, cmd).notified, 1, cmd);
    // None reads "no terminal status": every run's end is typed.
    assert.equal(session.adapterGaps.filter((g) => g.code === 'command_outcome_unknown').length, 0);
  });

test('D98 F1: everything else stays strict — both ids, a closed status, one header, the launch before the notice',
  async (t) => {
    const extra = { kind: TASK_NOTIFICATION_KIND, producer: 'session-task' };
    const { raw } = await sliced(t, [
      ...launch('s1', 'bgs1', 'make s1', stub('bgs1')), notice('bgother', 's1', 'completed', extra),
      ...launch('s2', 'bgs2', 'make s2', stub('bgs2')), notice('bgs2', 's9', 'completed', extra),
      ...launch('s3', 'bgs3', 'make s3', stub('bgs3')), notice('bgs3', 's3', 'killed', extra),
      ...launch('s4', 'bgs4', 'make s4', stub('bgs4')), notice('bgs4', 's4', 'completed', extra),
      notice('bgs4', 's4', 'failed', extra),
      ...launch('s5', 'bgs5', 'make s5', stub('bgs5')), notice('bgs5', 's5', 'completed', { kind: 'human', runId: 'r' }),
    ]);
    for (const n of [1, 2, 3, 4, 5]) assert.equal(act(raw, `make s${n}`).statusSource, undefined, `make s${n}`);
  });

// ---- a background launch: its typed sidecar id, named by its visible result -------------------------------------

test('D98 F1: a launch is identified by its typed sidecar id in its visible result, whatever sentence carries it',
  async (t) => {
    const { raw } = await sliced(t, [
      // The launch stub, and the form written when a command outlives its timeout (no input flag, a typed timeout).
      ...launch('b1', 'bgb1', 'npm run build', stub('bgb1')), notice('bgb1', 'b1', 'completed'),
      use('b2', 'Bash', { command: 'npm run e2e', timeout: 120000 }),
      answer('b2', movedStub('bgb2'), { isError: false,
        sidecar: { ...SUCCESS, backgroundTaskId: 'bgb2', timedOutAfterMs: 120000 } }),
      notice('bgb2', 'b2', 'failed'),
      // A wording no release wrote yet names the id all the same.
      ...launch('b3', 'bgb3', 'npm run bench', `Started task bgb3; read /private/tmp/bgb3.output later.`),
      notice('bgb3', 'b3', 'completed'),
    ]);
    assert.deepEqual([act(raw, 'npm run build').outcome, act(raw, 'npm run build').statusSource],
      ['passed', COMMAND_STATUS_SOURCES.claudeTaskNotification]);
    const moved = act(raw, 'npm run e2e');
    assert.deepEqual([moved.background, moved.outcome, moved.statusSource],
      [true, 'failed', COMMAND_STATUS_SOURCES.claudeTaskNotification]);
    assert.equal(act(raw, 'npm run bench').statusSource, COMMAND_STATUS_SOURCES.claudeTaskNotification);
  });

test('D98 F1: a visible result that does not name the typed id as a token of its own registers no launch', async (t) => {
  const { raw } = await sliced(t, [
    ...launch('v1', 'bgv1', 'make v1', stub('bgzz1')), notice('bgv1', 'v1', 'completed'),
    ...launch('v2', 'bgv2', 'make v2', stub('bgv20')), notice('bgv2', 'v2', 'completed'),
    ...launch('v3', 'bgv3', 'make v3', stub('x-bgv3')), notice('bgv3', 'v3', 'completed'),
    ...launch('v4', 'bgv4', 'make v4', ''), notice('bgv4', 'v4', 'completed'),
  ]);
  for (const n of [1, 2, 3, 4]) assert.equal(act(raw, `make v${n}`).statusSource, undefined, `make v${n}`);
});

test('D98 F1: the typed id is read as a token, never as a sentence', () => {
  assert.equal(resultNamesTypedId(stub('bg1'), 'bg1'), true);
  assert.equal(resultNamesTypedId(movedStub('bg1'), 'bg1'), true);
  assert.equal(resultNamesTypedId('(ID: bg1)', 'bg1'), true);
  assert.equal(resultNamesTypedId('ID: bg1.', 'bg1'), true);
  for (const text of ['ID: bg10', 'ID: abg1', 'ID: bg1_x', 'ID: bg1-x', '', 'nothing here'])
    assert.equal(resultNamesTypedId(text, 'bg1'), false, text);
  assert.equal(resultNamesTypedId(['bg1'], 'bg1'), false);
  assert.equal(resultNamesTypedId('bg1', 'not an id!'), false);
});
