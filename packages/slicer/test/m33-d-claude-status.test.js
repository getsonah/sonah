// M33 D (C-02/C-03, Claude Code status drift): the typed completion evidence Claude Code writes
// today, read native-first, and nothing else.
//
//   - A parent Bash result with an explicit `is_error: false` and the exact success sidecar is the
//     harness's typed completion verdict. It proves termination with `exitCode` kept null. It never
//     types an exit code, so a shell-write sibling (which needs a typed exit 0) stays unknown, and a
//     test command's semantic label still comes from its output.
//   - A parent Edit result whose sidecar repeats the call exactly is a native success, the same
//     evidence class as Write's `type: create|update`.
//   - A background Bash launch or a Workflow launch is closed only by its own later typed task
//     notification: `origin.kind === 'task-notification'`, one header task id equal to the launch's
//     native id, one header tool-use id equal to the launch call, one closed header status.
//   - A Workflow launch declares its agents, whose recordings are not linked, on the children channel.
//
// Every row is synthetic and mirrors only the recorder's known key sets. No real recording is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { buildEvents, COMMAND_STATUS_SOURCES } from '../src/events.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const SESSION = 'c0ffee00-0000-4000-8000-000000000001';
const row = (extra) => ({ sessionId: SESSION, cwd: '/repo', isSidechain: false, version: '2.1.260', ...extra });
// M34 labels: a human's prompt row carries the host's typed origin, as Claude Code 2.1.219 and later records it.
const ask = (text) => row({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const use = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const answer = (id, content, { isError, sidecar } = {}) => row({ type: 'user', message: { role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] },
  ...(sidecar === undefined ? {} : { toolUseResult: sidecar }) });
const SUCCESS = Object.freeze({ stdout: 'built', stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
const notice = (taskId, callId, status, { origin = { kind: 'task-notification' }, summary = 'Background command "build" finished' } = {}) =>
  row({ type: 'user', isMeta: false, ...(origin ? { origin } : {}), message: { role: 'user', content:
    `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${callId}</tool-use-id>\n`
    + `<output-file>/private/tmp/tasks/${taskId}.output</output-file>\n<status>${status}</status>\n`
    + `<summary>${summary}</summary>\n</task-notification>` } });

// The same notification text, queued as a `queued_command` attachment instead of a user row.
const queued = (taskId, callId, status, { commandMode = 'task-notification', origin } = {}) => row({
  type: 'attachment', entrypoint: 'claude-desktop', gitBranch: 'main', parentUuid: null, timestamp: '2026-09-24T00:00:00Z',
  userType: 'external', uuid: `q-${taskId}`, attachment: { type: 'queued_command', commandMode,
    ...(origin ? { origin } : {}), timestamp: '2026-09-24T00:00:00Z',
    prompt: notice(taskId, callId, status).message.content } });

async function review(t, rows, { outcomes = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-d-status-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, [ask('Build and fix it.'), ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const raw = await sliceLineage([file], { cwd: '/repo', outcomes });
  const session = sessionFromLedger(redact(raw).ledger, { sessionKey: 'm33-d-status' });
  const gap = (code, channel = 'observations') => session.adapterGaps
    .filter((g) => g.code === code && g.channel === channel);
  const count = (code, channel) => gap(code, channel).reduce((n, g) => n + (g.count ?? 0), 0);
  const terminal = (id) => session.events.filter((e) => e.kind === 'observation' && e.invocation === id);
  return { raw, session, gap, count, terminal };
}
const act = (raw, cmd) => raw.ledger.find((e) => e.cmd === cmd);
// C-01 event identity: a ledger action's canonical event, found by what it recorded (its command), never by an id built
// from its turn and sequence.
const invocationFor = (r, a) => r.session.events.find((e) => e.kind === 'invocation' && e.operation === 'command'
  && r.session.textOf(e, 'command') === a.cmd)?.id;

test('M33 D F1: an explicit is_error:false with the exact Bash success sidecar is a typed completion verdict', async (t) => {
  const variants = [
    {},
    { bashEditDiff: { file: 'x' } },
    { gitOperation: { kind: 'commit' } },
    { dangerouslyDisableSandbox: true },
    { persistedOutputPath: '/private/tmp/out.txt', persistedOutputSize: 12 },
    { staleReadFileStateHint: 'x' },
    { bashEditDiff: {}, gitOperation: {}, dangerouslyDisableSandbox: false },
  ];
  const rows = variants.flatMap((extra, i) => [use(`b${i}`, 'Bash', { command: `make target-${i}`, description: 'build' }),
    answer(`b${i}`, 'built', { isError: false, sidecar: { ...SUCCESS, ...extra } })]);
  const r = await review(t, rows);
  for (const [i] of variants.entries()) {
    const a = act(r.raw, `make target-${i}`);
    assert.equal(a.outcome, 'passed', `variant ${i}`);
    assert.equal(a.outcomeSource, 'native', `variant ${i}`);
    assert.equal(a.statusSource, COMMAND_STATUS_SOURCES.claudeNativeVerdict, `variant ${i}`);
    assert.equal(a.exitCode, undefined, 'a verdict never becomes an exit code');
    const [obs] = r.terminal(invocationFor(r, a));
    assert.deepEqual([obs.result, obs.terminalStatusProven, obs.exitCode, obs.sourceOfResult],
      ['succeeded', true, null, 'native'], `variant ${i}`);
  }
  assert.equal(r.count('command_outcome_unknown'), 0);
});

test('M33 D F1: anything short of the exact verdict leaves the command outcome unknown', async (t) => {
  const cases = [
    ['benign nonzero', { isError: false, sidecar: { ...SUCCESS, returnCodeInterpretation: 'No matches found' } }],
    ['background launch', { isError: false, sidecar: { ...SUCCESS, backgroundTaskId: 'bg77', backgroundCwdHint: '/repo' } }],
    ['interrupted', { isError: false, sidecar: { ...SUCCESS, interrupted: true } }],
    ['no explicit flag', { sidecar: SUCCESS }],
    ['no sidecar', { isError: false }],
    ['unknown sidecar key', { isError: false, sidecar: { ...SUCCESS, futureStatus: 'ok' } }],
    ['half a persisted pair', { isError: false, sidecar: { ...SUCCESS, persistedOutputPath: '/tmp/o' } }],
    ['stdout not text', { isError: false, sidecar: { ...SUCCESS, stdout: ['x'] } }],
    ['missing required key', { isError: false, sidecar: { stdout: '', stderr: '', interrupted: false } }],
    ['string sidecar', { isError: false, sidecar: 'built' }],
  ];
  const rows = cases.flatMap(([name, shape], i) => [use(`n${i}`, 'Bash', { command: `make case-${i}` }),
    answer(`n${i}`, 'output', shape)]);
  const r = await review(t, rows);
  for (const [i, [name]] of cases.entries()) {
    const a = act(r.raw, `make case-${i}`);
    assert.equal(a.statusSource, undefined, name);
    assert.notEqual(a.outcomeSource, 'native', name);
    const [obs] = r.terminal(invocationFor(r, a));
    assert.equal(obs.terminalStatusProven, false, name);
  }
  assert.equal(r.count('command_outcome_unknown'), cases.length);
  assert.equal(act(r.raw, 'make case-1').background, true, 'a sidecar background id marks the launch');
});

test('M33 D F1: a verdict beside several result blocks cannot be attributed to any one of them', async (t) => {
  const rows = [row({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'p1', name: 'Bash', input: { command: 'make one' } },
    { type: 'tool_use', id: 'p2', name: 'Bash', input: { command: 'make two' } }] } }),
  row({ type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'p1', content: 'ok', is_error: false },
    { type: 'tool_result', tool_use_id: 'p2', content: 'ok', is_error: false }] }, toolUseResult: SUCCESS })];
  const r = await review(t, rows);
  assert.equal(r.count('command_outcome_unknown'), 2);
});

test('M33 D F1, H1: a test command under a verdict is a zero status like any command; its output is never read', async (t) => {
  const r = await review(t, [use('t1', 'Bash', { command: 'npm test' }),
    answer('t1', 'suite finished', { isError: false, sidecar: { ...SUCCESS, stdout: 'suite finished' } }),
    use('t2', 'Bash', { command: 'npm test -- --grep parser' }),
    answer('t2', '1 failed', { isError: false, sidecar: { ...SUCCESS, stdout: '1 failed' } })]);
  const quiet = act(r.raw, 'npm test');
  assert.equal(quiet.kind, 'bash', 'M1: a runner command is a command');
  assert.equal(quiet.statusSource, COMMAND_STATUS_SOURCES.claudeNativeVerdict);
  const [obs] = r.terminal(invocationFor(r, quiet));
  assert.deepEqual([obs.result, obs.terminalStatusProven, obs.exitCode, obs.sourceOfResult], ['succeeded', true, null, 'native']);
  const red = act(r.raw, 'npm test -- --grep parser');
  const [label] = r.terminal(invocationFor(r, red));
  assert.deepEqual([label.result, label.sourceOfResult], ['succeeded', 'native'],
    'the verdict decides; output that reads red is the reviewer\'s to quote, never code\'s to read');
  assert.equal(r.count('command_outcome_unknown'), 0);
});

test('M33 D F1: a shell write under a verdict command keeps its outcome unknown (no typed exit 0)', async (t) => {
  const r = await review(t, [use('w1', 'Bash', { command: 'printf x > out.txt' }),
    answer('w1', '', { isError: false, sidecar: { ...SUCCESS, stdout: '' } })]);
  assert.equal(r.count('command_outcome_unknown'), 0);
  assert.equal(r.count('write_outcome_unknown'), 1);
});

test('M33 D F1: a typed hook exit code outranks the verdict', async (t) => {
  const r = await review(t, [use('h1', 'Bash', { command: 'make hooked' }),
    answer('h1', 'x', { isError: false, sidecar: SUCCESS })], { outcomes: new Map([['h1', { exitCode: 2 }]]) });
  const a = act(r.raw, 'make hooked');
  assert.deepEqual([a.outcome, a.exitCode, a.exitCodeSource, a.statusSource], ['failed', 2, 'hook', undefined]);
});

// ------------------------------------------------------------------------------------------------
const EDIT_INPUT = Object.freeze({ file_path: '/repo/src/a.js', old_string: 'const a = 1;', new_string: 'const a = 2;' });
const EDIT_SIDECAR = Object.freeze({ filePath: '/repo/src/a.js', oldString: 'const a = 1;', newString: 'const a = 2;',
  originalFile: 'const a = 1;\n', replaceAll: false, structuredPatch: [], userModified: false });
const UPDATED = 'The file /repo/src/a.js has been updated successfully.';

test('M33 D F2: a parent Edit sidecar that repeats its call exactly is a native success', async (t) => {
  const variants = [
    [EDIT_INPUT, EDIT_SIDECAR],
    [EDIT_INPUT, { ...EDIT_SIDECAR, originalFile: null }],
    [EDIT_INPUT, { ...EDIT_SIDECAR, memdirStamped: true, contentNotInModelContext: false, staleRecovered: true }],
    [{ ...EDIT_INPUT, replace_all: true }, { ...EDIT_SIDECAR, replaceAll: true }],
  ];
  const rows = variants.flatMap(([input, sidecar], i) => [use(`e${i}`, 'Edit', input),
    answer(`e${i}`, UPDATED, { sidecar })]);
  const r = await review(t, rows);
  const edits = r.raw.ledger.filter((e) => e.kind === 'edit');
  assert.equal(edits.length, variants.length);
  for (const e of edits) assert.deepEqual(e.result, { seen: true, outcome: 'succeeded', provenance: 'native' });
  assert.equal(r.count('write_outcome_unknown'), 0);
});

test('M33 D F2: an Edit sidecar that does not repeat the call proves nothing, and its visible text stays readable', async (t) => {
  const drift = [
    { ...EDIT_SIDECAR, filePath: '/repo/src/b.js' },
    { ...EDIT_SIDECAR, oldString: 'const a = 0;' },
    { ...EDIT_SIDECAR, newString: 'const a = 3;' },
    { ...EDIT_SIDECAR, replaceAll: true },
    { ...EDIT_SIDECAR, userModified: true },
    { ...EDIT_SIDECAR, futureField: 1 },
    (({ structuredPatch: _, ...rest }) => rest)(EDIT_SIDECAR),
    { ...EDIT_SIDECAR, originalFile: 7 },
  ];
  const rows = drift.flatMap((sidecar, i) => [use(`d${i}`, 'Edit', EDIT_INPUT), answer(`d${i}`, UPDATED, { sidecar })]);
  const r = await review(t, rows);
  const edits = r.raw.ledger.filter((e) => e.kind === 'edit');
  assert.equal(edits.length, drift.length);
  // The visible success sentence is still read (parsed output), never replaced by the sidecar's JSON.
  for (const e of edits) assert.deepEqual(e.result, { seen: true, outcome: 'succeeded', provenance: 'parsed-output' });
  assert.equal(r.count('write_outcome_unknown'), drift.length);

  const failed = await review(t, [use('f1', 'Edit', EDIT_INPUT), answer('f1', 'String not found', { isError: true, sidecar: EDIT_SIDECAR })]);
  assert.equal(failed.raw.ledger[0].result.outcome, 'failed');
  assert.equal(failed.count('write_outcome_unknown'), 0);
});

// ------------------------------------------------------------------------------------------------
const launch = (id, taskId, command = 'npm run build', { flag = true, extra = {} } = {}) => [
  use(id, 'Bash', { command, ...(flag ? { run_in_background: true } : {}) }),
  answer(id, `Command running in background with ID: ${taskId}. Output is being written to: /private/tmp/${taskId}.output`,
    { isError: false, sidecar: { ...SUCCESS, stdout: '', backgroundTaskId: taskId, ...extra } })];

test('M33 D F3: a background Bash launch is closed by its own typed task notification', async (t) => {
  const r = await review(t, [
    ...launch('bg-1', 'bgaaa1', 'npm run build'), ask('Meanwhile, read the docs.'),
    notice('bgaaa1', 'bg-1', 'completed', { summary: 'Background command "build" completed (exit code 0)' }),
    ...launch('bg-2', 'bgaaa2', 'npm run lint'), notice('bgaaa2', 'bg-2', 'failed'),
    ...launch('bg-3', 'bgaaa3', 'npm run watch'), notice('bgaaa3', 'bg-3', 'stopped'),
  ]);
  const built = act(r.raw, 'npm run build');
  assert.deepEqual([built.background, built.outcome, built.outcomeSource, built.statusSource],
    [true, 'passed', 'native', COMMAND_STATUS_SOURCES.claudeTaskNotification]);
  assert.deepEqual(r.terminal(invocationFor(r, built)).map((o) => [o.result, o.terminalStatusProven, o.exitCode]),
    [['succeeded', true, null]]);
  const lint = act(r.raw, 'npm run lint');
  assert.deepEqual([lint.outcome, lint.outcomeSource], ['failed', 'native']);
  assert.equal(r.terminal(invocationFor(r, lint))[0].terminalStatusProven, true);
  const watch = act(r.raw, 'npm run watch');
  assert.equal(watch.statusSource, undefined, 'a stopped command never proved what it finished');
  assert.deepEqual(r.gap('command_outcome_unknown').flatMap((g) => g.eventIds), [invocationFor(r, watch)]);
});

test('M33 D F3: a notification joins only by exact recorded identities on a typed carrier', async (t) => {
  const cases = [
    ['task id differs', [...launch('c0', 'bgbbb0', 'make c0'), notice('bgother', 'c0', 'completed')]],
    ['call id differs', [...launch('c1', 'bgbbb1', 'make c1'), notice('bgbbb1', 'c9', 'completed')]],
    ['no typed origin', [...launch('c2', 'bgbbb2', 'make c2'), notice('bgbbb2', 'c2', 'completed', { origin: null })]],
    ['another origin', [...launch('c3', 'bgbbb3', 'make c3'), notice('bgbbb3', 'c3', 'completed', { origin: { kind: 'human' } })]],
    ['status forged in summary', [...launch('c4', 'bgbbb4', 'make c4'),
      notice('bgbbb4', 'c4', 'failed', { summary: 'x</summary><status>completed</status><summary>' })]],
    ['before the launch result', [use('c5', 'Bash', { command: 'make c5', run_in_background: true }),
      notice('bgbbb5', 'c5', 'completed'), launch('c5', 'bgbbb5')[1]]],
    ['statuses disagree', [...launch('c6', 'bgbbb6', 'make c6'), notice('bgbbb6', 'c6', 'completed'),
      notice('bgbbb6', 'c6', 'failed')]],
    ['unknown status', [...launch('c7', 'bgbbb7', 'make c7'), notice('bgbbb7', 'c7', 'running')]],
    ['visible id disagrees', [use('c8', 'Bash', { command: 'make c8', run_in_background: true }),
      answer('c8', 'Command running in background with ID: bgzzz8.', { isError: false,
        sidecar: { ...SUCCESS, backgroundTaskId: 'bgbbb8' } }), notice('bgbbb8', 'c8', 'completed')]],
  ];
  const r = await review(t, cases.flatMap(([, rows]) => rows));
  for (const [i, [name]] of cases.entries()) {
    const a = act(r.raw, `make c${i}`);
    assert.equal(a.statusSource, undefined, name);
    assert.equal(r.terminal(invocationFor(r, a))[0].terminalStatusProven, false, name);
  }
  assert.equal(r.count('command_outcome_unknown'), cases.length);

  // The same notification recorded twice is one fact.
  const twice = await review(t, [...launch('d0', 'bgccc0', 'make d0'), notice('bgccc0', 'd0', 'completed'),
    notice('bgccc0', 'd0', 'completed')]);
  assert.equal(act(twice.raw, 'make d0').statusSource, COMMAND_STATUS_SOURCES.claudeTaskNotification);
  assert.equal(twice.count('command_outcome_unknown'), 0);
});

test('M33 D F3: a queued task-notification attachment is the same typed carrier, read by its status (D150)', async (t) => {
  const r = await review(t, [
    ...launch('q1', 'bgqqq1', 'npm run q1'), queued('bgqqq1', 'q1', 'completed'),
    ...launch('q2', 'bgqqq2', 'npm run q2'), queued('bgqqq2', 'q2', 'failed', { origin: { kind: 'task-notification' } }),
    ...launch('q3', 'bgqqq3', 'npm run q3'), queued('bgqqq3', 'q3', 'completed', { origin: { kind: 'human' } }),
    ...launch('q4', 'bgqqq4', 'npm run q4'), queued('bgqqq4', 'q4', 'completed', { commandMode: 'prompt' }),
    ...launch('q5', 'bgqqq5', 'npm run q5'), queued('bgqqq5', 'q5', 'completed'), notice('bgqqq5', 'q5', 'completed'),
  ]);
  assert.equal(act(r.raw, 'npm run q1').outcome, 'passed');
  assert.equal(act(r.raw, 'npm run q2').outcome, 'failed');
  assert.equal(act(r.raw, 'npm run q5').statusSource, COMMAND_STATUS_SOURCES.claudeTaskNotification, 'one fact twice');
  for (const cmd of ['npm run q3', 'npm run q4']) assert.equal(act(r.raw, cmd).statusSource, undefined, cmd);
  assert.equal(r.count('command_outcome_unknown'), 2);
  // Its text is not read. D150 amends this test: a queued task notification (the one carrier rule) is read by its typed
  // status, as one written as a user row is, and is no declared loss (q1, q2, q5); q3, whose human origin contradicts its
  // notification mode, is no notification and stays a counted loss on its channel; (release fix 3b) q4's, a prompt with
  // no origin on a typed recorder, the labeller gives to the harness: harness context.
  assert.equal(r.count('unsupported_message', 'observations'), 1);
  assert.equal(r.count('unsupported_message', 'instructions'), 0);
});

test('M33 D F3: an auto-backgrounded command (no input flag) is a background launch, not a verdict', async (t) => {
  const r = await review(t, [...launch('a1', 'bgddd1', 'npm run e2e', { flag: false, extra: { timedOutAfterMs: 120000 } })]);
  const a = act(r.raw, 'npm run e2e');
  assert.deepEqual([a.background, a.statusSource], [true, undefined]);
  assert.equal(r.count('command_outcome_unknown'), 1);
});

// ------------------------------------------------------------------------------------------------
const WORKFLOW_RESULT = (taskId) => ({ runId: 'wrun0000000001', scriptPath: '/private/tmp/wf.js', status: 'async_launched',
  summary: 'launched', taskId, taskType: 'local_workflow', transcriptDir: `/private/tmp/${SESSION}/subagents/workflows/wrun0000000001`,
  workflowName: 'synthetic' });

test('M33 D F8: every Workflow launch declares its unreviewed agents on the children channel', async (t) => {
  const r = await review(t, [use('wf1', 'Workflow', { script: 'agent("check")' }),
    answer('wf1', 'Workflow launched. Task ID: wtask0001', { isError: false, sidecar: WORKFLOW_RESULT('wtask0001') })]);
  const [children] = r.gap('incomplete_inventory', 'children');
  assert.equal(children.count, 1);
  assert.deepEqual(children.eventIds, [r.session.events.find((e) => e.kind === 'invocation' && e.tool === 'Workflow').id]);
  assert.match(children.note, /workflow/);
  assert.ok(r.gap('incomplete_inventory').some((g) => /launched asynchronously/.test(g.note)));
});

test('M33 D F3: a Workflow completion notification is recorded, but its unread result keeps a declared gap', async (t) => {
  const r = await review(t, [use('wf2', 'Workflow', { script: 'agent("check")' }),
    answer('wf2', 'Workflow launched. Task ID: wtask0002', { isError: false, sidecar: WORKFLOW_RESULT('wtask0002') }),
    notice('wtask0002', 'wf2', 'completed', { summary: 'Workflow "synthetic" completed' })]);
  const launched = r.raw.ledger.find((e) => e.tool === 'Workflow');
  assert.equal(launched.workflowNotificationStatus, 'completed');
  const observations = r.gap('incomplete_inventory');
  assert.ok(!observations.some((g) => /launched asynchronously/.test(g.note)));
  assert.equal(observations.filter((g) => /notification/.test(g.note)).reduce((n, g) => n + g.count, 0), 1);
});

test('M33 D F9: a Workflow call outside the typed input schema still declares its asynchronous launch', async (t) => {
  const r = await review(t, [use('wf3', 'Workflow', { script: 'agent(args.x)', args: { x: 1 } }),
    answer('wf3', 'Workflow launched. Task ID: wtask0003', { isError: false, sidecar: WORKFLOW_RESULT('wtask0003') })]);
  const launched = r.raw.ledger.find((e) => e.tool === 'Workflow');
  assert.equal(launched.genericTool, true);
  assert.equal(launched.workflowAsyncUnresolved, true);
  assert.ok(r.gap('incomplete_inventory').some((g) => /launched asynchronously/.test(g.note)));
  assert.equal(r.count('incomplete_inventory', 'children'), 1);
});

test('M33 D: the verdict and notification are Claude facts only', () => {
  const records = [
    { kind: 'assistant', adapter: 'cursor', raw: { type: 'assistant', message: { role: 'assistant',
      content: [{ type: 'tool_use', id: 'x1', name: 'Bash', input: { command: 'make x' } }] } } },
    { kind: 'user', adapter: 'cursor', raw: { type: 'user', message: { role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'x1', content: 'ok', is_error: false }] }, toolUseResult: SUCCESS } },
  ];
  const [event] = buildEvents(records, { cwd: '/repo' }).events;
  assert.equal(event.statusSource, undefined);
});
