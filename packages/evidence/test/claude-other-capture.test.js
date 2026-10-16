import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, verifyReceipt } from '../src/session.js';
import { planWindows } from '../src/windows.js';
import { buildNarrativePrompt } from '../src/prompt.js';
import { runReview } from '../src/run-review.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { redact } from '../../redact/index.js';
import { ARG_SEP, buildEvents } from '../../slicer/src/events.js';

const empty = async () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
const pr = { repo: { host: 'local', id: 'synthetic' }, files: [] };
// M33 (C-06 "M33 session verdict"): the reviews below COMPLETE — every window answered, challenged
// and grounded — and their coverage is partial only by a recorder limit the adapter declared (a
// capture, redaction, outcome, child or pair gap). That reads NO_FINDINGS: never CLEAN, always
// shown with the partial coverage and its causes. Before M33 it read UNCHECKED, which now means
// the review itself did not complete.
const RECORDER_LIMITED = 'NO_FINDINGS';

test('a Claude other tool keeps typed A/O and separate quotable input fields', async () => {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Locate the tool and inspect its result.' }],
    ledger: [{ turn: 1, seq: 0, kind: 'other', tool: 'ToolSearch',
      argsExcerpt: 'first-query\n⟪→⟫\nsecond-query', inputRecorded: true,
      result: { seen: true, outcome: 'unknown', provenance: 'native' },
      tailLines: ['Tool reference returned'], }],
  }, { sessionKey: 'claude-other-synthetic' });
  const action = session.event('A1-0');
  const observation = session.observationFor(action.id);
  assert.equal(action.operation, 'other');
  assert.equal(action.tool, 'ToolSearch');
  assert.deepEqual(session.textSpansOf(action, 'input'), ['first-query', 'second-query']);
  assert.equal(observation.invocation, action.id);
  assert.equal(observation.result, 'unknown');
  assert.equal(verifyReceipt(session,
    { eventId: action.id, role: 'action', quote: 'first-query' }).ok, true);
  assert.equal(verifyReceipt(session,
    { eventId: action.id, role: 'action', quote: 'querysecond' }).ok, false);
  const evidence = buildNarrativePrompt({ session, window: planWindows(session)[0] }).evidencePrompt;
  assert.match(evidence, /tool=ToolSearch/);
  assert.match(evidence, /tool input \(role=action\)/);
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, 'CLEAN');
});

test('ToolSearch references remain separate quotable observations after redaction', async () => {
  const built = buildEvents([{ kind: 'assistant', adapter: 'claude', raw: { type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'q1', name: 'ToolSearch',
      input: { query: 'Find file tools.' } }] } } },
  { kind: 'user', adapter: 'claude', raw: { type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'q1', content: [
      { type: 'tool_reference', tool_name: 'mcp__repo__read' },
      { type: 'tool_reference', tool_name: 'mcp__repo__write' },
    ] },
  ] } } }]);
  const cleaned = redact({ ask: [{ turn: 1, text: 'Find file tools.' }],
    ledger: built.events, claim: {} }).ledger;
  const session = sessionFromLedger(cleaned, { sessionKey: 'tool-reference-boundaries-synthetic' });
  const observation = session.events.find((event) => event.kind === 'observation');
  assert.deepEqual(session.textSpansOf(observation, 'output'),
    ['mcp__repo__read', 'mcp__repo__write']);
  for (const quote of ['mcp__repo__read', 'mcp__repo__write'])
    assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation', quote }).ok, true);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'mcp__repo__read\nmcp__repo__write' }).ok, false);
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, 'CLEAN');
});

test('a ToolSearch reference an earlier Sonah masked leaves the next one separate and declares the cut', () => {
  const built = buildEvents([{ kind: 'assistant', adapter: 'claude', raw: { type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'q1', name: 'ToolSearch',
      input: { query: 'Find file tools.' } }] } } },
  { kind: 'user', adapter: 'claude', raw: { type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'q1', content: [
      { type: 'tool_reference', tool_name: 'API_KEY=abcdefghijklmnopqrstuv' },
      { type: 'tool_reference', tool_name: 'mcp__safe__read' },
    ] },
  ] } } }]);
  // D90 (owner decision 2026-10-15): today's redaction keeps each reference as recorded; the ledger an earlier one wrote,
  // its first reference masked and the mask in its own list of what it dropped (`dropped`), is read below.
  assert.deepEqual(redact({ ask: [{ turn: 1, text: 'Find file tools.' }], ledger: structuredClone(built.events), claim: {} })
    .ledger.ledger[0].tailLines, ['API_KEY=abcdefghijklmnopqrstuv', 'mcp__safe__read']);
  const persisted = structuredClone(built.events);
  persisted[0].tailLines = ['API_KEY=‹redacted›', 'mcp__safe__read'];
  const cleaned = redact({ ask: [{ turn: 1, text: 'Find file tools.' }], ledger: persisted, claim: {},
    dropped: [{ turn: 0, reason: 'redacted:assigned-secret', where: 'tailLines' }] }).ledger;
  const session = sessionFromLedger(cleaned, { sessionKey: 'tool-reference-redaction-synthetic' });
  const observation = session.events.find((event) => event.kind === 'observation');
  assert.deepEqual(session.textSpansOf(observation, 'output'), ['API_KEY=', 'mcp__safe__read']);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'));
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'API_KEY=\nmcp__safe__read' }).ok, false);
});

test('a dropped token in ask or commentary creates gaps and cannot ground a receipt', async () => {
  const marker = '‹dropped:high-entropy›';
  // A ledger an earlier Sonah's redactor wrote: its marks, and its own list of what it dropped (D90: the declaration
  // that makes them its marks; d90-recorded-marks.test.js reads the same text with none).
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: `Before ${marker} after.` }],
    commentary: [{ turn: 1, beforeEvent: 0, text: `Working ${marker} now.` }],
    ledger: [],
    dropped: [{ turn: 1, reason: 'dropped:unclassified-high-entropy-token', where: 'ask' },
      { turn: 1, reason: 'dropped:unclassified-high-entropy-token', where: 'commentary' }],
  }, { sessionKey: 'claude-dropped-synthetic' });
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'instructions'));
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'commentary'));
  const instruction = session.events.find((event) => event.kind === 'instruction');
  const commentary = session.events.find((event) => event.kind === 'commentary');
  assert.equal(instruction.omitted, true);
  for (const event of [instruction, commentary]) {
    assert.equal(verifyReceipt(session,
      { eventId: event.id, role: event.kind, quote: 'high-entropy' }).ok, false);
  }
  // D90: a Session reads a ref as the adapter cut it and never splits one again by what its text says; the adapter keeps
  // a declared mark out of every ref (above), and anywhere else the same characters are recorded text.
  const direct = new Session({ sessionKey: 'persisted-older-route', blobs: { text: `Before ${marker} after.` },
    events: [{ id: 'I1', kind: 'instruction', authority: 'human', sequence: 0,
      supersedes: [], text: [{ sourceKey: 'text', fromByte: 0,
        untilByte: Buffer.byteLength(`Before ${marker} after.`) }] }] });
  assert.deepEqual(direct.textSpanInfoOf(direct.event('I1')), { spans: [`Before ${marker} after.`], complete: true });
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('unresolved native tool handoffs stay channel-specific gaps even when the call and result are captured', async () => {
  const ledger = { ask: [{ turn: 1, text: 'Inspect the session.' }], ledger: [
    { turn: 1, seq: 0, kind: 'other', tool: 'Workflow', inputRecorded: true,
      argsExcerpt: 'resumeFromRunId: run-1', inputUnresolved: true,
      result: { seen: true, outcome: 'unknown' }, workflowAsyncUnresolved: true,
      tailLines: ['Launched.'] },
    { turn: 1, seq: 1, kind: 'other', tool: 'AskUserQuestion', inputRecorded: true,
      argsExcerpt: 'question: Continue?', humanAnswerUnresolved: true,
      result: { seen: true, outcome: 'unknown' }, tailLines: ['Yes'] },
    { turn: 1, seq: 2, kind: 'other', tool: 'SendMessage', inputRecorded: true,
      argsExcerpt: 'message: Continue.', childFollowupUnresolved: true,
      result: { seen: true, outcome: 'unknown' }, tailLines: ['Delivered.'] },
  ] };
  const session = sessionFromLedger(ledger, { sessionKey: 'claude-handoffs-synthetic' });
  for (const channel of ['actions', 'observations', 'instructions', 'children'])
    assert.ok(session.adapterGaps.some((gap) => gap.channel === channel), channel);
  assert.equal(session.events.filter((event) => event.kind === 'invocation').length, 3);
  assert.equal(session.events.filter((event) => event.kind === 'observation').length, 3);
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('unattributed async sidecar and a literal input separator cannot produce CLEAN', async () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Run the workflow.' }], ledger: [
    { turn: 1, seq: 0, kind: 'other', tool: 'Workflow', inputRecorded: true,
      argsExcerpt: 'script: printf done', result: { seen: true, outcome: 'unknown' },
      tailLines: ['Launched.'], workflowAsyncUnresolved: true },
    { turn: 1, seq: 1, kind: 'other', tool: 'Workflow', inputRecorded: true,
      argsExcerpt: `script: before${ARG_SEP}after`, inputBoundaryAmbiguous: true,
      result: { seen: true, outcome: 'unknown' }, tailLines: ['Done.'] },
  ] }, { sessionKey: 'claude-input-boundary-synthetic' });
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'
    && gap.eventIds.includes('A1-0')));
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'actions'
    && gap.eventIds.includes('A1-1')));
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('opaque SendUserFile input stays useful A/O but cannot certify a fully checked action', async () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Send the report.' }], ledger: [
    { turn: 1, seq: 0, kind: 'other', tool: 'SendUserFile', inputRecorded: true,
      argsExcerpt: 'unparsed input: {"files":', inputUnparsed: true,
      result: { seen: true, outcome: 'unknown' }, tailLines: ['Unable to parse.'] },
  ] }, { sessionKey: 'opaque-file-input-synthetic' });
  assert.equal(session.events.filter((event) => event.kind === 'invocation').length, 1);
  assert.equal(session.events.filter((event) => event.kind === 'observation').length, 1);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'actions'
    && gap.eventIds.includes('A1-0')));
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('one later redacted, native completed TaskOutput closes only its Workflow completion gap', async () => {
  const raw = { ask: [{ turn: 1, text: 'Run a synthetic workflow.' }], ledger: [
    { turn: 1, seq: 0, kind: 'other', tool: 'Workflow', inputRecorded: true,
      argsExcerpt: 'script: check the synthetic file', workflowAsyncUnresolved: true,
      workflowTaskId: 'task-1', result: { seen: true, outcome: 'unknown' }, tailLines: ['Launched.'] },
    { turn: 1, seq: 1, kind: 'other', tool: 'TaskOutput', inputRecorded: true,
      argsExcerpt: 'task_id: task-1', taskOutputTaskId: 'task-1',
      taskOutputResultTaskId: 'task-1', taskOutputCompleted: true,
      result: { seen: true, outcome: 'unknown' }, tailLines: ['Completed.'] },
  ] };
  const direct = sessionFromLedger(raw, { sessionKey: 'raw-id-join-synthetic' });
  assert.ok(direct.adapterGaps.some((gap) => gap.channel === 'observations'
    && gap.eventIds.includes('A1-0')), 'unredacted identities cannot join');
  const clean = redact(raw).ledger;
  assert.ok(clean.ledger.every((act) => act.taskIdentityChecked === true));
  const session = sessionFromLedger(clean, { sessionKey: 'redacted-id-join-synthetic' });
  assert.ok(!session.adapterGaps.some((gap) => gap.channel === 'observations'
    && gap.eventIds.includes('A1-0')));
  // C-03 M33 D: the completion closes only the completion gap. The Workflow's own agents wrote
  // recordings nobody linked or reviewed, which stays a declared children loss, so a complete
  // review of this session reads NO_FINDINGS (recorder limited), never CLEAN.
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'children')
    .map((gap) => [gap.code, gap.eventIds]), [['incomplete_inventory', ['A1-0']]]);
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('a native completion can be established while result text an earlier Sonah masked remains unchecked', async () => {
  const session = sessionFromLedger(redact({ ask: [{ turn: 1, text: 'Run it.' }], ledger: [
    { turn: 1, seq: 0, kind: 'other', tool: 'Workflow', argsExcerpt: 'script: check',
      inputRecorded: true, workflowAsyncUnresolved: true, workflowTaskId: 'task-1',
      result: { seen: true, outcome: 'unknown' }, tailLines: ['Launched.'] },
    { turn: 1, seq: 1, kind: 'other', tool: 'TaskOutput', argsExcerpt: 'task_id: task-1',
      inputRecorded: true, taskOutputTaskId: 'task-1', taskOutputResultTaskId: 'task-1',
      taskOutputCompleted: true, result: { seen: true, outcome: 'unknown' },
      tailLines: ['API_KEY=‹redacted:github-token›'] },
  ], dropped: [{ turn: 1, reason: 'redacted:github-token', where: 'tailLines' }] }).ledger,
  { sessionKey: 'redacted-completion-synthetic' });
  assert.ok(!session.adapterGaps.some((gap) => gap.channel === 'observations'
    && String(gap.note ?? '').includes('launched asynchronously')));
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'
    && String(gap.note ?? '').includes('redaction')));
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('different native IDs in repeated Workflow result rows cannot yield CLEAN', async () => {
  const visible = 'Launched ' + 'x'.repeat(500);
  const tool = (id, name, input) => ({ kind: 'assistant', adapter: 'claude', raw: { type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } } });
  const answer = (id, sidecar, content) => ({ kind: 'user', adapter: 'claude', raw: { type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
    toolUseResult: sidecar } });
  const built = buildEvents([
    tool('w1', 'Workflow', { script: 'Run a synthetic check.' }),
    answer('w1', { status: 'async_launched', taskId: 'task-1' }, visible),
    answer('w1', { status: 'async_launched', taskId: 'task-2' }, visible),
    tool('t1', 'TaskOutput', { task_id: 'task-1', block: true }),
    answer('t1', { retrieval_status: 'success',
      task: { status: 'completed', task_id: 'task-1', output: 'synthetic internal output' } },
    'Completed.'),
  ]);
  const session = sessionFromLedger(redact({ ask: [{ turn: 1, text: 'Run it.' }],
    ledger: built.events }).ledger, { sessionKey: 'repeated-workflow-id-synthetic' });
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'
    && String(gap.note ?? '').includes('launched asynchronously')));
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('visible task IDs contradicting native IDs cannot close an async Workflow gap', async () => {
  const tool = (id, name, input) => ({ kind: 'assistant', adapter: 'claude', raw: { type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } } });
  const answer = (id, sidecar, content) => ({ kind: 'user', adapter: 'claude', raw: { type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
    toolUseResult: sidecar } });
  const launch = (visible) => [
    tool('w1', 'Workflow', { script: 'Run a synthetic check.' }),
    answer('w1', { status: 'async_launched', taskId: 'task-1' }, visible),
  ];
  const completion = (visible) => [
    tool('t1', 'TaskOutput', { task_id: 'task-1', block: true }),
    answer('t1', { retrieval_status: 'success',
      task: { status: 'completed', task_id: 'task-1' } }, visible),
  ];
  for (const [name, records] of [
    ['wrong-launch', [...launch('Task ID: task-2'), ...completion('<task_id>task-1</task_id>')]],
    ['wrong-completion', [...launch('Task ID: task-1'), ...completion('<task_id>task-2</task_id>')]],
    ['wrong-json-completion', [...launch('Task ID: task-1'), ...completion('{"task_id":"task-2"}')]],
    ['malformed-completion', [...launch('Task ID: task-1'), ...completion('<task_id>task-1')]],
  ]) {
    const built = buildEvents(records);
    const session = sessionFromLedger(redact({ ask: [{ turn: 1, text: 'Run it.' }],
      ledger: built.events }).ledger, { sessionKey: name });
    assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'
      && String(gap.note ?? '').includes('launched asynchronously')), name);
    const report = await runReview({ session, pr, judge: empty });
    assert.equal(report.sessionStatus, RECORDER_LIMITED, name);
  }
});

test('running, mismatched, repeated and later polls cannot close a Workflow gap', () => {
  const launch = () => ({ turn: 1, seq: 0, kind: 'other', tool: 'Workflow',
    argsExcerpt: 'script: check', inputRecorded: true, workflowAsyncUnresolved: true,
    workflowTaskId: 'task-1', result: { seen: true, outcome: 'unknown' }, tailLines: ['Launched.'] });
  const output = (seq, id = 'task-1', completed = true) => ({ turn: 1, seq, kind: 'other',
    tool: 'TaskOutput', argsExcerpt: `task_id: ${id}`, inputRecorded: true,
    taskOutputTaskId: id, ...(completed ? { taskOutputResultTaskId: id, taskOutputCompleted: true } : {}),
    result: { seen: true, outcome: 'unknown' }, tailLines: [completed ? 'Completed.' : 'Running.'] });
  const cases = [
    [launch(), output(1, 'task-1', false)],
    [launch(), output(1, 'task-2')],
    [launch(), output(1), output(2)],
    [launch(), output(1), output(2, 'task-1', false)],
    [launch(), { ...output(1), taskOutputResultRepeated: true }],
    [{ ...launch(), workflowResultRepeated: true }, output(1)],
    [launch(), { ...output(1), interrupted: true }],
    [launch(), { ...output(1), outcomeUnknown: true }],
    [launch(), { ...output(1), exitCode: 1, result: { seen: true, outcome: 'failed' } }],
    [{ ...launch(), interrupted: true }, output(1)],
  ];
  for (const ledger of cases) {
    const session = sessionFromLedger(redact({ ask: [{ turn: 1, text: 'Run it.' }], ledger }).ledger,
      { sessionKey: 'unresolved-poll-synthetic' });
    assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'
      && gap.eventIds.includes('A1-0')));
  }
});

test('whole-redacted generic input cannot disappear into an apparently complete action', async () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Search tools.' }], ledger: [
    { turn: 1, seq: 0, kind: 'other', tool: 'ToolSearch', inputRecorded: true,
      inputRedacted: true, result: { seen: true, outcome: 'unknown' }, tailLines: ['Found tool.'] },
  ] }, { sessionKey: 'claude-redacted-tool-synthetic' });
  assert.deepEqual(session.textSpansOf(session.event('A1-0'), 'input'), []);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'actions'
    && gap.eventIds.includes('A1-0')));
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('a delegation brief an earlier Sonah masked retains a gap and its marker is never quotable', async () => {
  const raw = (text, persisted = {}) => ({ ask: [{ turn: 1, text: 'Delegate the implementation.' }], ledger: [],
    delegations: [{ turn: 1, status: 'unresolved', kind: 'spawn', parentInstruction: { tool: 'Agent', text,
      ...persisted.brief } }], ...persisted.ledger });
  // D90 (owner decision 2026-10-15): today's redaction keeps the brief as recorded.
  const today = redact(raw('Use API_KEY=abcdefghijklmnopqrstuv in the task.')).ledger.delegations[0].parentInstruction;
  assert.deepEqual(today, { tool: 'Agent', text: 'Use API_KEY=abcdefghijklmnopqrstuv in the task.' });
  // The ledger an earlier one wrote, its value masked and declared (on the brief and in its list of what it dropped),
  // is still read as masked.
  const cleaned = redact(raw('Use API_KEY=‹redacted› in the task.', { brief: { redacted: true },
    ledger: { dropped: [{ turn: 1, reason: 'redacted:assigned-secret', where: 'parent agent instruction' }] } })).ledger;
  assert.equal(cleaned.delegations[0].parentInstruction.redacted, true);
  const session = sessionFromLedger(cleaned, { sessionKey: 'masked-brief-synthetic' });
  const delegate = session.events.find((event) => event.operation === 'delegate');
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'actions'
    && gap.eventIds.includes(delegate.id)));
  assert.equal(verifyReceipt(session,
    { eventId: delegate.id, role: 'action', quote: 'redacted' }).ok, false);
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('token-level removal inside a code body declares missing code evidence', async () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Write one module.' }], ledger: [
    { turn: 1, seq: 0, kind: 'create', path: 'src/a.js',
      after: { text: 'const key = ‹dropped:high-entropy›;', truncated: false, lines: 1 },
      result: { seen: true, outcome: 'succeeded', provenance: 'native' } },
  ], dropped: [{ turn: 1, reason: 'dropped:unclassified-high-entropy-token', where: 'after' }] },
  { sessionKey: 'dropped-code-synthetic' });
  const write = session.event('A1-0');
  assert.equal(write.changes[0].redacted, true);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'code'
    && gap.eventIds.includes(write.id)));
  assert.equal(verifyReceipt(session,
    { eventId: write.id, role: 'code', quote: 'high-entropy' }).ok, false);
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});
