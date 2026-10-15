// Synthetic Codex rollouts only. No private recordings or model calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodexSession } from '../src/codex.js';
import { readExecCalls, execResults } from '../src/codex-exec.js';
import { recordingIdentity } from '../src/recording-identity.js';
import { sliceLineage } from '../index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const item = (payload) => ({ type: 'response_item', payload });
const meta = { type: 'session_meta', payload: { id: 'synthetic', cwd: '/repo' } };

async function fixture(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-codex-live-shape-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-09-23T10-00-00-synthetic.jsonl');
  await writeFile(file, rows.map((row) => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n');
  return file;
}

test('a new response item shape is a declared capture gap beside known actions', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'message', role: 'user', content: 'Run the checks.' }),
    item({ type: 'future_action', call_id: 'new-action', arguments: { cmd: 'make check' } }),
    item({ type: 'function_call', name: 'exec_command', call_id: 'known', arguments: '{"cmd":"make build"}' }),
    item({ type: 'function_call_output', call_id: 'known', output: 'Process exited with code 0' }),
  ]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger.length, 1, 'the known action remains available');
  assert.equal(ledger.capture.incomplete, true);
  assert.ok(ledger.capture.reasons.includes('capture_incomplete'));
});

test('a rollout containing only a new source shape is not a complete empty session', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'future_action', call_id: 'new-action', arguments: { cmd: 'make check' } }),
  ]);
  const source = await readCodexSession(file);
  assert.equal(source.unknownSchema, true);
  assert.equal(source.meta.capture.incomplete, true);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.dropped.find((d) => d.reason === 'unknown_schema_files'),
    { turn: null, reason: 'unknown_schema_files', count: 1 });
});

test('an event-only recording cannot read as a complete empty Codex session', async (t) => {
  const file = await fixture(t, [meta,
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Child continuation.' } },
  ]);
  const source = await readCodexSession(file);
  assert.equal(source.unknownSchema, true);
  assert.equal(source.meta.capture.incomplete, true);
  assert.equal(source.records.length, 0);
});

test('known top-level Codex metadata does not become an action or capture gap', async (t) => {
  const file = await fixture(t, [meta,
    { type: 'world_state', payload: { cwd: '/repo' } },
    { type: 'token_usage_record', payload: { input_tokens: 3 } },
    { type: 'inter_agent_communication_metadata', payload: { trigger_turn: 1 } },
    { type: 'turn_context', payload: { cwd: '/repo' } },
    { type: 'event_msg', payload: { type: 'token_count', input_tokens: 3 } },
    item({ type: 'message', role: 'user', content: 'Run the build.' }),
    item({ type: 'function_call', name: 'exec_command', call_id: 'build', arguments: '{"cmd":"make build"}' }),
    item({ type: 'function_call_output', call_id: 'build', output: 'Process exited with code 0' }),
  ]);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.ask.map((ask) => ask.text), ['Run the build.']);
  assert.deepEqual(ledger.ledger.map((event) => event.cmd), ['make build']);
  assert.equal(ledger.capture.unsupported, 0);
  assert.equal(ledger.capture.unmapped, 0);
  assert.equal(ledger.capture.incomplete, false);
  assert.deepEqual(ledger.capture.reasons, []);
});

test('an inter-agent response item is neither a root ask nor a silently complete capture', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'message', role: 'user', content: 'Review the parser.' }),
    item({ type: 'agent_message', id: 'internal-1', author: 'child', recipient: 'parent',
      content: [{ type: 'input_text', text: 'Change the parser.' },
        { type: 'encrypted_content', data: 'opaque' }],
      internal_chat_message_metadata_passthrough: {} }),
    { type: 'inter_agent_communication_metadata', payload: { trigger_turn: 1 } },
  ]);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.ask.map((ask) => ask.text), ['Review the parser.']);
  assert.equal(ledger.commentary.length, 0);
  assert.equal(ledger.ledger.length, 0);
  assert.equal(ledger.capture.unsupported, 0);
  assert.equal(ledger.capture.interAgentMessagesUnparsed, 1);
  assert.equal(ledger.capture.interAgentMessagesSoleIncomplete, true);
  assert.equal(ledger.capture.genericIncomplete, false);
  assert.equal(ledger.capture.incomplete, true);
  assert.deepEqual(ledger.capture.reasons, []);
});

test('multiple native inter-agent rows are counted without promoting visible or encrypted blocks', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'agent_message', content: [{ type: 'input_text', text: 'Private child report.' }] }),
    item({ type: 'agent_message', content: [{ type: 'encrypted_content', data: 'opaque' }] }),
  ]);
  const source = await readCodexSession(file);
  const ledger = await sliceLineage([file]);
  assert.equal(source.meta.capture.interAgentMessagesUnparsed, 2);
  assert.equal(source.meta.capture.interAgentMessagesSoleIncomplete, true);
  assert.equal(source.records.length, 0);
  assert.equal(ledger.capture.interAgentMessagesUnparsed, 2);
  assert.equal(ledger.capture.interAgentMessagesSoleIncomplete, true);
  assert.deepEqual(ledger.ask, []);
  assert.deepEqual(ledger.commentary, []);
  assert.deepEqual(ledger.ledger, []);
});

test('native communication with an unsupported action keeps the separate generic capture gap', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'agent_message', content: [{ type: 'input_text', text: 'Private child report.' }] }),
    item({ type: 'future_action', call_id: 'future' }),
  ]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.capture.interAgentMessagesUnparsed, 1);
  assert.equal(ledger.capture.interAgentMessagesSoleIncomplete, false);
  assert.equal(ledger.capture.unsupported, 1);
  assert.equal(ledger.capture.genericIncomplete, true);
});

test('duplicate native type keys cannot establish typed inter-agent communication', async (t) => {
  const file = await fixture(t, [meta,
    '{"type":"response_item","payload":{"type":"future_action","type":"agent_message","content":[]}}',
  ]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.capture.interAgentMessagesUnparsed, 0);
  assert.equal(ledger.capture.interAgentMessagesSoleIncomplete, false);
  assert.equal(ledger.capture.unsupported, 1);
  assert.equal(ledger.capture.incomplete, true);
});

test('native communication cannot be the sole cause beside a missing tool result', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'agent_message', content: [] }),
    item({ type: 'function_call', name: 'exec_command', call_id: 'missing', arguments: '{"cmd":"make check"}' }),
  ]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.capture.interAgentMessagesUnparsed, 1);
  assert.equal(ledger.capture.interAgentMessagesSoleIncomplete, false);
  assert.equal(ledger.capture.unmapped, 1);
  assert.equal(ledger.capture.genericIncomplete, true);
});

test('typed communication sole cause survives complete source joins but not corrupt rows', async (t) => {
  const first = await fixture(t, [meta, item({ type: 'agent_message', content: [] })]);
  const second = await fixture(t, [meta, item({ type: 'message', role: 'user', content: 'Review.' })]);
  const joined = await sliceLineage([first, second]);
  assert.equal(joined.capture.interAgentMessagesUnparsed, 1);
  assert.equal(joined.capture.interAgentMessagesSoleIncomplete, true);
  const corrupt = await fixture(t, [meta, item({ type: 'agent_message', content: [] }), '{invalid-json']);
  const damaged = await sliceLineage([corrupt]);
  assert.equal(damaged.capture.interAgentMessagesUnparsed, 1);
  assert.equal(damaged.capture.interAgentMessagesSoleIncomplete, false);
  assert.deepEqual(damaged.dropped.find((d) => d.reason === 'unparseable_lines'),
    { turn: null, reason: 'unparseable_lines', count: 1 });
});

test('an unknown top-level row is declared without promoting agent_message to a human ask', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'message', role: 'user', content: 'Review the parser.' }),
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Child says all tests pass.' } },
    { type: 'future_rollout_event', payload: { type: 'tool_output', output: 'unmapped' } },
  ]);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.ask.map((ask) => ask.text), ['Review the parser.']);
  assert.equal(ledger.capture.incomplete, true);
  assert.ok(ledger.capture.reasons.includes('capture_incomplete'));
});

test('one unreadable block in a mixed user turn declares lost instruction content', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'message', role: 'user', content: [
      { type: 'input_text', text: 'Keep the tests green.' },
      { type: 'future_instruction_block', value: 'not captured' },
    ] }),
  ]);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.ask.map((ask) => ask.text), ['Keep the tests green.']);
  assert.equal(ledger.capture.incomplete, true);
  assert.ok(ledger.capture.reasons.includes('codex_message_content_unsupported'));
});

test('a completed wrapper with no provable observation declares an unmapped result', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'custom_tool_call', name: 'functions.exec', call_id: 'wrapped',
      input: 'const result = await tools.exec_command({cmd:"make build"}); text({changed:result});' }),
    item({ type: 'custom_tool_call_output', call_id: 'wrapped', output: [
      { type: 'input_text', text: 'Script completed' },
      { type: 'input_text', text: '{"changed":{"exit_code":0}}' },
    ] }),
  ]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger.length, 1);
  assert.equal(ledger.ledger[0].exitCode, undefined);
  assert.equal(ledger.capture.unmapped, 1);
  assert.ok(ledger.capture.reasons.includes('codex_wrapper_output_unmapped'));
});

test('a direct action with an absent result value and an orphan output declare observation gaps', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'function_call', name: 'exec_command', call_id: 'known', arguments: '{"cmd":"make build"}' }),
    item({ type: 'function_call_output', call_id: 'known', output: null }),
    item({ type: 'function_call_output', call_id: 'orphan', output: { exit_code: 0 } }),
  ]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger.length, 1);
  assert.equal(ledger.ledger[0].exitCode, undefined);
  assert.equal(ledger.capture.unmapped, 2);
  assert.ok(ledger.capture.reasons.includes('codex_wrapper_output_unmapped'));
});

test('an unrelated non-code tool output is not miscounted as a code observation gap', async (t) => {
  const file = await fixture(t, [meta,
    item({ type: 'function_call', name: 'web__run', call_id: 'search', arguments: '{}' }),
    item({ type: 'function_call_output', call_id: 'search', output: { content: [] } }),
  ]);
  const source = await readCodexSession(file);
  assert.equal(source.meta.capture.unmapped, 0);
});

test('an exact indexed allSettled JSON emitter maps every outcome in source order', async (t) => {
  const source = 'const outcomes = await Promise.allSettled(['
    + 'tools.exec_command({cmd:"make first"}),'
    + 'tools.exec_command({cmd:"make second"}),'
    + 'tools.exec_command({cmd:"make third"})]); '
    + 'outcomes.forEach((entry, index) => text(JSON.stringify({index, ...entry})));';
  const parsed = readExecCalls(source);
  assert.equal(parsed.unsupported, 0);
  assert.equal(parsed.emissionsExact, true);
  assert.equal(parsed.emissions.length, 3);
  const values = [
    { index: 0, status: 'fulfilled', value: { output: 'first', exit_code: 0 } },
    { index: 1, status: 'rejected', reason: 'tool failed' },
    { index: 2, status: 'fulfilled', value: { output: 'third', exit_code: 3 } },
  ];
  const file = await fixture(t, [meta,
    item({ type: 'custom_tool_call', name: 'functions.exec', call_id: 'multi', input: source }),
    item({ type: 'custom_tool_call_output', call_id: 'multi', output: [
      { type: 'input_text', text: 'Script completed' },
      ...values.map((value) => ({ type: 'input_text', text: JSON.stringify(value) })),
    ] }),
  ]);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.ledger.map((event) => [event.cmd, event.exitCode, event.outcome]), [
    ['make first', 0, 'passed'], ['make second', undefined, 'failed'], ['make third', 3, 'failed'],
  ]);
  assert.equal(ledger.capture.unmapped, 0);
});

test('an ordered visible-output loop links each observation without inventing an exit status', async (t) => {
  const source = 'const outcomes = await Promise.allSettled(['
    + 'tools.exec_command({cmd:"node --test"}),tools.exec_command({cmd:"git status --short"})]); '
    + 'for (const entry of outcomes) text(entry.status === "fulfilled" ? entry.value.output : String(entry.reason));';
  const file = await fixture(t, [meta,
    item({ type: 'message', role: 'user', content: 'Run the checks.' }),
    item({ type: 'custom_tool_call', name: 'functions.exec', call_id: 'multi', input: source }),
    item({ type: 'custom_tool_call_output', call_id: 'multi', output: [
      { type: 'input_text', text: 'Script completed' },
      { type: 'input_text', text: '1 failed; 0 passed' },
      { type: 'input_text', text: '' },
    ] }),
  ]);
  const raw = await sliceLineage([file]);
  assert.equal(raw.capture.captured, 2);
  assert.equal(raw.capture.unmapped, 0);
  assert.deepEqual(raw.ledger.map((event) => [event.outcome, event.exitCode, event.outcomeSource]), [
    ['unknown', undefined, 'unknown'], ['unknown', undefined, 'unknown'],
  ]);
  const session = sessionFromLedger(redact(raw).ledger, { sessionKey: 'synthetic' });
  const actions = session.events.filter((event) => event.kind === 'invocation');
  const observations = session.events.filter((event) => event.kind === 'observation');
  assert.equal(actions.length, 2);
  assert.deepEqual(observations.map((event) => [event.invocation, event.result, event.exitCode, event.sourceOfResult]), [
    [actions[0].id, 'unknown', null, 'unknown'], [actions[1].id, 'unknown', null, 'unknown'],
  ]);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.code === 'command_outcome_unknown')
    .map((gap) => gap.count), [2]);
});

test('ordered output proof still refuses missing blocks, extra blocks, and status-shaped text', async (t) => {
  const source = 'const r = await Promise.allSettled(['
    + 'tools.exec_command({cmd:"make first"}),tools.exec_command({cmd:"make second"})]); '
    + 'for (const x of r) text(x.status === "fulfilled" ? x.value.output : String(x.reason));';
  const parsed = readExecCalls(source);
  assert.equal(parsed.emissionsExact, true);
  for (const payloads of [['first'], ['first', 'second', 'extra']]) {
    const output = [{ type: 'input_text', text: 'Script completed' },
      ...payloads.map((text) => ({ type: 'input_text', text }))];
    assert.equal(execResults(output, parsed).results.size, 0);
  }
  const file = await fixture(t, [meta,
    item({ type: 'custom_tool_call', name: 'functions.exec', call_id: 'multi', input: source }),
    item({ type: 'custom_tool_call_output', call_id: 'multi', output: [
      { type: 'input_text', text: 'Script completed' },
      { type: 'input_text', text: '{"exit_code":0,"output":"tests passed"}' },
      { type: 'input_text', text: 'tests passed' },
    ] }),
  ]);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.ledger.map((event) => [event.exitCode, event.outcome]), [
    [undefined, 'unknown'], [undefined, 'unknown'],
  ]);
  assert.equal(ledger.capture.unmapped, 0);
});

test('output-only settled wrappers cannot turn a rejected write reason into success', async (t) => {
  const source = 'const results = await Promise.allSettled(['
    + 'tools.write_file({file_path:"a.txt",content:"hello"}),'
    + 'tools.read_file({file_path:"a.txt"})]); '
    + 'for (const entry of results) text(entry.status === "fulfilled" ? entry.value.output : String(entry.reason));';
  const file = await fixture(t, [meta,
    item({ type: 'custom_tool_call', name: 'functions.exec', call_id: 'multi', input: source }),
    item({ type: 'custom_tool_call_output', call_id: 'multi', output: [
      { type: 'input_text', text: 'Script completed' },
      { type: 'input_text', text: 'File created successfully at: a.txt' },
      { type: 'input_text', text: 'File opened successfully at: a.txt' },
    ] }),
  ]);
  const raw = await sliceLineage([file]);
  assert.equal(raw.capture.incomplete, false);
  const write = raw.ledger.find((event) => event.kind === 'create');
  const read = raw.ledger.find((event) => event.kind === 'read');
  assert.deepEqual(write.result, { seen: true, outcome: 'unknown' });
  assert.equal(read.before, undefined, 'a rejected reason cannot become recorded file content');
  const session = sessionFromLedger(redact(raw).ledger, { sessionKey: 'synthetic' });
  // C-01 event identity: the write's event is found by what it is (its operation), never by an id built from a turn.
  const writeCall = session.events.find((event) => event.kind === 'invocation' && event.operation === 'write');
  const writeObservation = session.observationFor(writeCall.id);
  assert.equal(writeObservation.result, 'unknown');
  assert.equal(writeObservation.sourceOfResult, 'unknown');
});

test('indexed JSON emissions reject rearranged, missing and transformed outcomes', () => {
  const prefix = 'const outcomes = await Promise.allSettled(['
    + 'tools.exec_command({cmd:"make first"}),tools.exec_command({cmd:"make second"})]); ';
  const emitter = 'outcomes.forEach((entry, position) => text(JSON.stringify({position, ...entry})));';
  const parsed = readExecCalls(prefix + emitter);
  const complete = (...values) => [{ type: 'input_text', text: 'Script completed' },
    ...values.map((value) => ({ type: 'input_text', text: JSON.stringify(value) }))];
  const first = { position: 0, status: 'fulfilled', value: { exit_code: 0 } };
  const second = { position: 1, status: 'fulfilled', value: { exit_code: 2 } };
  for (const values of [[second, first], [first], [{ ...first, position: 1 }, second],
    [{ ...first, extra: true }, second]]) {
    assert.equal(execResults(complete(...values), parsed).results.size, 0);
  }
  for (const changed of [
    'outcomes.forEach((entry, position) => text(JSON.stringify({position: 0, ...entry})));',
    'outcomes.forEach((entry, position) => text(JSON.stringify({...entry, position})));',
    'outcomes.forEach((entry, position) => text(JSON.stringify({position, ...entry, extra: true})));',
    'outcomes.forEach((entry, position) => { text(JSON.stringify({position, ...entry})); });',
    'outcomes.forEach((entry, position) => text(JSON.stringify(entry)));',
  ]) {
    const unsafe = readExecCalls(prefix + changed);
    assert.equal(unsafe.emissionsExact, false, changed);
    assert.equal(execResults(complete(first, second), unsafe).results.size, 0, changed);
  }
});

test('a child keeps its own identity across explicit pre-boundary inherited metadata', async (t) => {
  const own = { type: 'session_meta', ordinal: 0, payload: {
    id: 'child-id', cwd: '/repo', subagent_history_start_ordinal: 3,
    source: { subagent: { thread_spawn: {
      parent_thread_id: 'parent-id', agent_path: '/root/parser',
    } } },
  } };
  const inherited = { type: 'session_meta', ordinal: 1, payload: { id: 'parent-id', cwd: '/repo' } };
  const rows = [own, inherited,
    { ...item({ type: 'message', role: 'user', content: 'Inherited root ask.' }), ordinal: 2 },
    { ...item({ type: 'message', role: 'assistant', channel: 'commentary', content: 'Child working.' }), ordinal: 3 },
  ];
  const file = await fixture(t, rows);
  const child = await readCodexSession(file, { childRecording: true });
  assert.equal(child.meta.sourceIdentity.sessionId, 'child-id');
  assert.equal(child.meta.sourceIdentity.parentThreadId, 'parent-id');
  assert.equal(child.meta.sourceIdentity.taskPath, '/root/parser');
  assert.equal(child.meta.sourceIdentity.historyStart, 3);
  assert.equal(child.meta.sourceIdentity.identityConflict, false);
  assert.equal(child.records.length, 1);
  assert.equal(child.records[0].raw.message.content[0].text, 'Child working.');

  const identity = recordingIdentity('codex');
  rows.forEach((row) => identity.observe(row));
  assert.equal(identity.value().identityConflict, false, 'the inventory reader uses the same identity policy');
  identity.observe({ type: 'session_meta', ordinal: 4, payload: { id: 'other-child-id' } });
  assert.equal(identity.value().identityConflict, true, 'a genuine post-boundary conflict fails closed');
});

// M33 nested-fork ancestor metadata (C-03): a fork of a subagent replays that subagent's own
// opening session_meta below its boundary. The exact recorded IDs omit that one row from the
// child's identity; the boundary still decides which actions are the child's own work.
test('M33 B3 the child reader keeps ancestor rows below the boundary out of child actions', async (t) => {
  const spawn = { thread_spawn: { parent_thread_id: 'middle', agent_path: '/root/middle/leaf' } };
  const patch = (path) => item({ type: 'custom_tool_call', name: 'apply_patch', call_id: path,
    input: '*** Begin Patch\n*** Add File: ' + path + '\n+const x = 1;\n*** End Patch' });
  const patchOut = (path) => item({ type: 'custom_tool_call_output', call_id: path, output: 'Done.' });
  const rows = [
    { type: 'session_meta', ordinal: 0, payload: { id: 'leaf', cwd: '/repo', forked_from_id: 'middle',
      subagent_history_start_ordinal: 5, multi_agent_version: 'v2', source: { subagent: spawn } } },
    { type: 'session_meta', ordinal: 1, payload: { id: 'middle', cwd: '/repo', forked_from_id: 'root',
      subagent_history_start_ordinal: 1, multi_agent_version: 'v2',
      source: { subagent: { thread_spawn: { parent_thread_id: 'root', agent_path: '/root/middle' } } } } },
    { ordinal: 2, ...item({ type: 'message', role: 'user', content: 'Inherited brief.' }) },
    { ordinal: 3, ...patch('inherited.js') }, { ordinal: 4, ...patchOut('inherited.js') },
    { ordinal: 5, ...item({ type: 'message', role: 'user', content: 'Leaf brief.' }) },
    { ordinal: 6, ...patch('leaf.js') }, { ordinal: 7, ...patchOut('leaf.js') },
  ];
  const file = await fixture(t, rows);
  const child = await readCodexSession(file, { childRecording: true });
  const identity = child.meta.sourceIdentity;
  assert.deepEqual([identity.sessionId, identity.parentThreadId, identity.taskPath, identity.historyStart,
    identity.identityConflict], ['leaf', 'middle', '/root/middle/leaf', 5, false]);
  const text = JSON.stringify(child.records.map((r) => r.raw));
  assert.equal(text.includes('leaf.js'), true, 'own work after the boundary is released');
  assert.equal(text.includes('inherited.js'), false, 'ancestor work below the boundary is not');
  assert.equal(child.meta.capture.reasons.includes('child_history_unchecked'), false);
  // Near miss: the same row one ordinal past the boundary is the child's own contradictory identity.
  const late = await fixture(t, [rows[0], { ...rows[1], ordinal: 5 }, ...rows.slice(2)]);
  const conflicted = await readCodexSession(late, { childRecording: true });
  assert.equal(conflicted.meta.sourceIdentity.identityConflict, true);
  assert.equal(conflicted.meta.sourceIdentity.sessionId, null);
});
