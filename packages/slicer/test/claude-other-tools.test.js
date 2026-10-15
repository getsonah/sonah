import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, ARG_SEP } from '../src/events.js';
import { redact } from '../../redact/index.js';

const call = (name, input, id = 'call-1') => ({ kind: 'assistant', adapter: 'claude', raw: {
  type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id, name, input },
  ] },
} });
const result = (id = 'call-1', content = 'Recorded result.', sidecar = undefined, error = undefined) => ({
  kind: 'user', adapter: 'claude', raw: { type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: id, content, ...(error === undefined ? {} : { is_error: error }) },
  ] }, ...(sidecar === undefined ? {} : { toolUseResult: sidecar }) },
});

test('typed Claude non-file tools retain correlated A/O instead of a session-wide unsupported action', () => {
  const cases = [
    ['Workflow', { description: 'Build fixture', script: 'Read one file and report.' }],
    ['TaskOutput', { task_id: 'task-1', block: true, timeout: 30 }],
    ['SendUserFile', { files: ['report.md'], caption: 'Report', display: 'inline', status: 'final' }],
    ['TaskStop', { task_id: 'task-1' }],
    ['Artifact', { action: 'create', intent: 'report', design_systems: false }],
    ['Artifact', { file_path: 'report.md', label: 'Report' }],
    ['SendMessage', { to: 'child', recipient: 'child', type: 'agent', message: 'Finish the test.',
      content: 'Finish the test.', summary: 'One test' }],
    ['AskUserQuestion', { questions: [{ header: 'Choice', question: 'Choose one.', multiSelect: false,
      options: [{ label: 'A', description: 'First option' }] }] }],
    ['mcp__ccd_session__mark_chapter', { title: 'Implementation', summary: 'One chapter.' }],
  ];
  for (const [name, input] of cases) {
    const built = buildEvents([call(name, input), result()], { cwd: '/repo' });
    assert.equal(built.actionCapture.unsupported, 0, name);
    assert.equal(built.actionCapture.orphanResults, 0, name);
    assert.equal(built.observationCapture.missing, 0, name);
    assert.equal(built.events.length, 1, name);
    const ev = built.events[0];
    assert.equal(ev.kind, 'other', name);
    assert.equal(ev.tool, name);
    assert.equal(ev.inputRecorded, true, name);
    assert.equal(ev.result.seen, true, name);
    assert.equal(ev.result.outcome, 'unknown', name);
    assert.deepEqual(ev.tailLines, ['Recorded result.'], name);
  }
});

test('Workflow keeps the full script and does not infer shell writes from opaque execution', () => {
  const script = `${'read the source and check the output\n'.repeat(1100)}printf x > src/generated.js`;
  const built = buildEvents([call('Workflow', { script }), result('call-1', 'Launched.', {
    status: 'async_launched', taskId: 'task-1', transcriptDir: '/private/tmp/task',
  }, false)], { cwd: '/repo' });
  assert.equal(built.events.length, 1);
  const ev = built.events[0];
  assert.equal(ev.kind, 'other');
  assert.equal(ev.argsExcerpt, `script: ${script}`);
  assert.equal(ev.workflowAsyncUnresolved, true);
  assert.equal(ev.cmd, undefined);
  assert.equal(ev.result.outcome, 'unknown');
  const resumed = buildEvents([call('Workflow', { resumeFromRunId: 'run-1', scriptPath: '/tmp/script' }),
    result()], { cwd: '/repo' });
  assert.equal(resumed.events[0].inputUnresolved, true);
});

test('an async Workflow sidecar shared by several results leaves its visible result and a declared gap', () => {
  const records = [{ kind: 'assistant', adapter: 'claude', raw: { type: 'assistant',
    message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'w1', name: 'Workflow', input: { script: 'printf done' } },
      { type: 'tool_use', id: 's1', name: 'ToolSearch', input: { query: 'file tool' } },
    ] } } }, { kind: 'user', adapter: 'claude', raw: { type: 'user',
    message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'w1', content: 'Launched.', is_error: false },
      { type: 'tool_result', tool_use_id: 's1', content: 'No matches.', is_error: false },
    ] }, toolUseResult: { status: 'async_launched', taskId: 'task-1' } } }];
  const built = buildEvents(records);
  assert.equal(built.events.length, 2);
  assert.deepEqual(built.events.map((event) => event.tailLines), [['Launched.'], ['No matches.']]);
  assert.equal(built.events[0].workflowAsyncUnresolved, true);
  assert.equal(built.events[1].workflowAsyncUnresolved, undefined);
  assert.equal(built.observationCapture.missing, 0);
});

test('a literal field separator inside a Workflow script is declared as an ambiguous input boundary', () => {
  const script = `before${ARG_SEP}after`;
  const built = buildEvents([call('Workflow', { script }), result()]);
  assert.equal(built.events[0].argsExcerpt, `script: ${script}`);
  assert.equal(built.events[0].inputBoundaryAmbiguous, true);
});

test('known ToolSearch references preserve recorded names, while extra nontext fields keep a gap', () => {
  const input = { query: 'read tool', max_results: 1 };
  const ref = { type: 'tool_reference', tool_name: 'mcp__repo__read' };
  const known = buildEvents([call('ToolSearch', input), result('call-1', [ref], {
    matches: ['mcp__repo__read'], query: 'read tool', total_deferred_tools: 3,
  })]);
  assert.equal(known.actionCapture.unsupported, 0);
  assert.equal(known.observationCapture.missing, 0);
  assert.deepEqual(known.events[0].tailLines, ['mcp__repo__read']);
  assert.equal(known.events[0].observationNonText, undefined);
  const two = buildEvents([call('ToolSearch', input), result('call-1', [ref,
    { type: 'tool_reference', tool_name: 'mcp__repo__write' }])]);
  assert.equal(two.events[0].toolReferenceSpans, true);
  assert.deepEqual(two.events[0].tailLines, ['mcp__repo__read', 'mcp__repo__write']);
  const unknown = buildEvents([call('ToolSearch', input), result('call-1', [{ ...ref, schema: {} }])]);
  assert.equal(unknown.events[0].observationNonText, true);
  assert.equal(unknown.events[0].tailLines, undefined);
  const mismatched = buildEvents([call('ToolSearch', input), result('call-1', [ref], {
    matches: ['a different tool'],
  })]);
  assert.equal(mismatched.events[0].observationNonText, true);
  const multilineName = buildEvents([call('ToolSearch', input), result('call-1', [
    { type: 'tool_reference', tool_name: 'first\nsecond' }])]);
  assert.equal(multilineName.events[0].observationNonText, true);
  const replay = buildEvents([call('ToolSearch', input), result('call-1', [ref]), result('call-1', [ref])]);
  assert.equal(replay.observationCapture.missing, 0);
  assert.deepEqual(replay.events[0].tailLines, ['mcp__repo__read']);
});

test('a typed human answer is a human instruction; an untyped one and an agent follow-up stay explicitly unresolved', () => {
  // OWNER DECISION B (2026-10-01) amends this test: the answer the AskUserQuestion's typed sidecar records — exactly
  // `{questions, answers}`, the call's own questions, one answer each, shown in the result the agent read — is the
  // human's own words, read as an in-turn human instruction (`interjections`) at the result's row, never as an ask.
  const question = { questions: [{ question: 'Use option A?', options: [{ label: 'A' }] }] };
  const answered = buildEvents([call('AskUserQuestion', question), result('call-1', 'A', {
    answers: { 'Use option A?': 'A' }, questions: question.questions,
  })]);
  assert.deepEqual(answered.ask, []);
  assert.equal(answered.events[0].humanAnswerUnresolved, undefined);
  // C-01 event identity: the first answer of its result block (these rows record no uuid: counted, by row position).
  assert.deepEqual(answered.interjections, [{ turn: 0, kind: 'answer', beforeEvent: 1, source: 0, record: 2, text: 'A',
    call: { turn: 0, seq: 0 }, identity: { stream: 0, record: 2, block: 0, unidentified: true, sub: 'a0' } }]);
  // With no typed sidecar, the answer is only text inside a tool result: it gains no human authority.
  const untyped = buildEvents([call('AskUserQuestion', question), result('call-1', 'A')]);
  assert.deepEqual(untyped.interjections, []);
  assert.equal(untyped.events[0].humanAnswerUnresolved, true);
  const sent = buildEvents([call('SendMessage', { to: 'agent', message: 'Continue.' }), result()]);
  assert.equal(sent.events[0].childFollowupUnresolved, true);
});

test('changed known-tool schemas retain opaque A/O without inferring typed effects', () => {
  const malformed = [
    ['Workflow', { script: 'safe', future_dispatch: 'hidden' }],
    ['SendUserFile', { __unparsedToolInput: { raw: '{}', len: 3 } }],
    ['TaskOutput', { task_id: 'task-1', block: 'yes' }],
    ['ToolSearch', { query: 'read', max_results: -1 }],
    ['AskUserQuestion', { questions: [{ question: 'Choose?', options: [{ label: 'A', hidden: 'B' }] }] }],
  ];
  for (const [name, input] of malformed) {
    const built = buildEvents([call(name, input), result()]);
    assert.equal(built.events.length, 1, name);
    assert.equal(built.events[0].kind, 'other', name);
    assert.equal(built.events[0].genericTool, true, name);
    assert.equal(built.events[0].result?.outcome, 'unknown', name);
    assert.equal(built.actionCapture.unsupported, 0, name);
    assert.equal(built.actionCapture.orphanResults, 0, name);
  }
});

test('an exact SendUserFile unparsed wrapper retains opaque A/O with an explicit input gap', () => {
  const raw = '{"files":';
  const built = buildEvents([call('SendUserFile',
    { __unparsedToolInput: { raw, len: raw.length } }), result()]);
  assert.equal(built.actionCapture.unsupported, 0);
  assert.equal(built.observationCapture.missing, 0);
  assert.equal(built.events[0].tool, 'SendUserFile');
  assert.equal(built.events[0].argsExcerpt, `unparsed input: ${raw}`);
  assert.equal(built.events[0].inputUnparsed, true);
  assert.equal(built.events[0].result.seen, true);
});

test('nested native TaskOutput completion carries typed task IDs for a later redacted join', () => {
  const built = buildEvents([
    call('Workflow', { script: 'Run a synthetic check.' }, 'w1'),
    result('w1', 'Launched.', { status: 'async_launched', taskId: 'task-1' }),
    call('TaskOutput', { task_id: 'task-1', block: true }, 't1'),
    result('t1', 'Completed.', { retrieval_status: 'success',
      task: { status: 'completed', task_id: 'task-1', output: 'internal synthetic output' } }),
  ]);
  assert.equal(built.events[0].workflowAsyncUnresolved, true);
  assert.equal(built.events[0].workflowTaskId, 'task-1');
  assert.equal(built.events[1].taskOutputTaskId, 'task-1');
  assert.equal(built.events[1].taskOutputResultTaskId, 'task-1');
  assert.equal(built.events[1].taskOutputCompleted, true);
  const running = buildEvents([call('TaskOutput', { task_id: 'task-1', block: true }),
    result('call-1', 'Still running.', { retrieval_status: 'timeout',
      task: { status: 'running', task_id: 'task-1' } })]);
  assert.equal(running.events[0].taskOutputCompleted, undefined);
  const interrupted = buildEvents([call('TaskOutput', { task_id: 'task-1', block: true }),
    result('call-1', 'Interrupted.', { retrieval_status: 'success', interrupted: true,
      task: { status: 'completed', task_id: 'task-1' } })]);
  assert.equal(interrupted.events[0].taskOutputCompleted, undefined);
  assert.equal(interrupted.events[0].interrupted, true);
  const unknown = result('call-1', 'Unknown.', { retrieval_status: 'success',
    task: { status: 'completed', task_id: 'task-1' } });
  unknown.raw.outcomeUnknown = true;
  const unresolved = buildEvents([call('TaskOutput', { task_id: 'task-1', block: true }), unknown]);
  assert.equal(unresolved.events[0].taskOutputCompleted, undefined);
  assert.equal(unresolved.events[0].outcomeUnknown, true);
  const failed = buildEvents([call('TaskOutput', { task_id: 'task-1', block: true }),
    result('call-1', 'Failed.', { retrieval_status: 'success', exit_code: 1,
      task: { status: 'completed', task_id: 'task-1' } })]);
  assert.equal(failed.events[0].taskOutputCompleted, undefined);
});

test('a repeated Workflow result cannot provide unique task identity for completion', () => {
  const visible = 'Launched ' + 'x'.repeat(500);
  const built = buildEvents([
    call('Workflow', { script: 'Run a synthetic check.' }, 'w1'),
    result('w1', visible, { status: 'async_launched', taskId: 'task-1' }),
    result('w1', visible, { status: 'async_launched', taskId: 'task-2' }),
  ]);
  assert.equal(built.events[0].workflowAsyncUnresolved, true);
  assert.equal(built.events[0].workflowResultRepeated, true);
});

test('visible task identity must agree with native launch and completion identities', () => {
  const wrongLaunch = buildEvents([
    call('Workflow', { script: 'Run a synthetic check.' }, 'w1'),
    result('w1', 'Task ID: task-2', { status: 'async_launched', taskId: 'task-1' }),
  ]);
  assert.equal(wrongLaunch.events[0].workflowTaskId, undefined);
  assert.equal(wrongLaunch.events[0].workflowIdentityConflict, true);

  const completed = (visible) => buildEvents([
    call('TaskOutput', { task_id: 'task-1', block: true }, 't1'),
    result('t1', visible, { retrieval_status: 'success',
      task: { status: 'completed', task_id: 'task-1' } }),
  ]).events[0];
  assert.equal(completed('<task_id>task-1</task_id>').taskOutputCompleted, true);
  assert.equal(completed('{"task_id":"task-1"}').taskOutputCompleted, true);
  assert.equal(completed('Task ID: task-2').taskOutputCompleted, undefined);
  assert.equal(completed('<task_id>task-2</task_id>').taskOutputCompleted, undefined);
  assert.equal(completed('{"task_id":"task-2"}').taskOutputCompleted, undefined);
  assert.equal(completed('{"task_id":"task-\\u0032"}').taskOutputCompleted, undefined);
  assert.equal(completed('<task_id>task-1').taskOutputCompleted, undefined);
  assert.equal(completed('<task_id>task-1</task_id><task_id>task-2</task_id>')
    .taskOutputCompleted, undefined);
});

test('other-tool input travels through the existing redacted argsExcerpt channel', () => {
  const built = buildEvents([call('Workflow', { script: 'echo API_KEY=abcdefghijklmnopqrstuv' }),
    result()]);
  const ev = redact({ ask: [], ledger: built.events, claim: {} }).ledger.ledger[0];
  assert.equal(ev.inputRecorded, true);
  assert.doesNotMatch(ev.argsExcerpt ?? '', /abcdefghijklmnopqrstuv/);
});
