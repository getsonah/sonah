// Synthetic recordings only. C-02 row-level strictness: a recorded JSONL row that
// repeats a key is not a serializer product. Its typed fields (result, status, exit, error flag,
// call ID, identity) are never evidence; the action stays visible with a declared gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { readCodexSession } from '../src/codex.js';
import { recordingIdentity } from '../src/recording-identity.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { scratchDir } from './scratch-dir.js';

const rec = (payload) => JSON.stringify({ type: 'response_item', payload });
// Inserts a second copy of `key` (with `value`) right after the first occurrence of `after`.
const repeat = (row, after, extra) => {
  assert.ok(row.includes(after), `fixture: ${after}`);
  return row.replace(after, `${after},${extra}`);
};
const exited = (code) => `Wall time: 1 seconds\nProcess exited with code ${code}\nOutput:\nok`;
async function codexFixture(lines, meta = JSON.stringify({ type: 'session_meta', payload: { id: 'test', cwd: '/repo' } })) {
  const dir = await scratchDir('strict-rows-');
  const file = join(dir, 'rollout-2026-09-10T12-00-00-test.jsonl');
  await writeFile(file, [meta, rec({ type: 'message', role: 'user', content: 'Run it.' }), ...lines].join('\n'));
  return file;
}
const observations = (sliced) => sessionFromLedger(redact(sliced).ledger).events
  .filter((event) => event.kind === 'observation').map((event) => [event.result, event.terminalStatusProven === true]);

test('a Codex result row that repeats a key yields no typed result, only a declared gap', async () => {
  const call = rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make build"}' });
  const result = rec({ type: 'function_call_output', call_id: 'c1', output: exited(1) });
  const clean = await sliceLineage([await codexFixture([call, result])]);
  assert.deepEqual(observations(clean), [['failed', true]], 'positive control');
  for (const row of [repeat(result, `"output":${JSON.stringify(exited(1))}`, `"output":${JSON.stringify(exited(0))}`),
    repeat(result, '"call_id":"c1"', '"call_id":"c1"'),
    repeat(result, '"type":"function_call_output"', '"type":"function_call_output"')]) {
    const sliced = await sliceLineage([await codexFixture([call, row])]);
    assert.equal(sliced.ledger.length, 1, 'the action stays visible');
    assert.equal(sliced.ledger[0].exitCode, undefined);
    assert.ok(observations(sliced).every(([, proven]) => !proven));
    assert.equal(sliced.capture.incomplete, true);
  }
});

test('a Codex call row that repeats a key cannot own a typed result', async () => {
  const result = rec({ type: 'function_call_output', call_id: 'c1', output: exited(0) });
  const call = rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make build"}' });
  const clean = await sliceLineage([await codexFixture([call, result])]);
  assert.deepEqual(observations(clean), [['succeeded', true]], 'positive control');
  for (const row of [repeat(call, '"call_id":"c1"', '"call_id":"c1"'),
    repeat(call, '"name":"exec_command"', '"name":"exec_command"')]) {
    const sliced = await sliceLineage([await codexFixture([row, result])]);
    assert.ok(sliced.ledger.every((event) => event.exitCode === undefined));
    assert.ok(observations(sliced).every(([, proven]) => !proven));
    assert.equal(sliced.capture.incomplete, true);
  }
});

test('a repeated-key Codex call row keeps one untyped carrier, never last-wins action details', async () => {
  const clean = rec({ type: 'custom_tool_call', name: 'exec_command', call_id: 'c1',
    input: { cmd: 'second-command' } });
  const cleanLedger = await sliceLineage([await codexFixture([clean])]);
  assert.equal(cleanLedger.ledger[0].cmd, 'second-command', 'clean control retains the typed action');
  const conflictingInput = repeat(rec({ type: 'custom_tool_call', name: 'exec_command',
    call_id: 'c1', input: { cmd: 'first-command' } }), '"cmd":"first-command"',
  '"cmd":"second-command"');
  const conflictingName = repeat(rec({ type: 'custom_tool_call', name: 'exec_command',
    call_id: 'c1', input: { cmd: 'first-command' } }), '"name":"exec_command"',
  '"name":"collaboration.spawn_agent"');
  const first = 'text(await tools.exec_command({cmd:"first-command"}));';
  const second = 'text(await tools.exec_command({cmd:"second-command"}));';
  const conflictingWrapper = repeat(rec({ type: 'custom_tool_call', name: 'functions.exec',
    call_id: 'c1', input: first }), `"input":${JSON.stringify(first)}`,
  `"input":${JSON.stringify(second)}`);
  for (const row of [conflictingInput, conflictingName, conflictingWrapper]) {
    const sliced = await sliceLineage([await codexFixture([row])]);
    assert.equal(sliced.ledger.length, 1, 'the row remains one attempted carrier');
    assert.equal(sliced.ledger[0].kind, 'other');
    assert.equal(sliced.ledger[0].genericTool, true);
    assert.equal(sliced.ledger[0].tool, 'codex_unverified_call');
    assert.equal(sliced.ledger[0].cmd, undefined);
    assert.equal(sliced.ledger[0].path, undefined);
    assert.equal(sliced.ledger[0].exitCode, undefined);
    assert.equal(sliced.delegations?.length ?? 0, 0);
    assert.equal(sliced.capture.incomplete, true);
    assert.ok(sessionFromLedger(redact(sliced).ledger).adapterGaps.some((gap) =>
      gap.code === 'incomplete_inventory' && gap.channel === 'actions'));
  }
});

test('every call ID on a malformed Codex row taints a later same-ID result', async () => {
  const row = repeat(rec({ type: 'function_call', name: 'exec_command', call_id: 'first-id',
    arguments: '{"cmd":"first-command"}' }), '"call_id":"first-id"',
  '"call\\u005fid":"second-id"');
  const later = rec({ type: 'function_call', name: 'exec_command', call_id: 'first-id',
    arguments: '{"cmd":"later-command"}' });
  const result = rec({ type: 'function_call_output', call_id: 'first-id', output: exited(0) });
  const sliced = await sliceLineage([await codexFixture([row, later, result])]);
  assert.equal(sliced.ledger.length, 2);
  assert.equal(sliced.ledger[0].kind, 'other');
  assert.equal(sliced.ledger[1].cmd, 'later-command');
  assert.equal(sliced.ledger[1].exitCode, undefined, 'the result could have belonged to the malformed row');
  assert.ok(observations(sliced).every(([, proven]) => !proven));
  assert.equal(sliced.capture.incomplete, true);
});

test('a repeated-key Codex message row supplies no last-wins instruction or commentary', async () => {
  const clean = rec({ type: 'message', role: 'user', content: 'clean instruction' });
  const cleanRead = await readCodexSession(await codexFixture([clean]));
  assert.ok(cleanRead.records.some((record) => JSON.stringify(record).includes('clean instruction')),
    'clean control retains a user message');
  const message = rec({ type: 'message', role: 'user', content: 'first text' });
  const altered = [
    repeat(message, '"content":"first text"', '"content":"last text"'),
    repeat(message, '"role":"user"', '"role":"assistant"'),
    repeat(message, '"type":"message"', '"type":"message"'),
  ];
  for (const row of altered) {
    const file = await codexFixture([row]);
    const read = await readCodexSession(file);
    assert.equal(read.records.some((record) => record.line === 3), false,
      'the malformed message has no trusted role, channel or content');
    const sliced = await sliceLineage([file]);
    assert.equal(sliced.capture.incomplete, true);
  }
});

test('a repeated key inside JSON-encoded Codex message blocks is unsupported content', async () => {
  const cleanBlocks = '[{"type":"text","text":"clean text"}]';
  const clean = await readCodexSession(await codexFixture([
    rec({ type: 'message', role: 'user', content: cleanBlocks }),
  ]));
  assert.equal(clean.records.find((record) => record.line === 3)?.raw?.message?.content?.[0]?.text,
    'clean text', 'strict block list remains readable');
  const repeatedBlocks = '[{"type":"text","text":"first text","text":"last text"}]';
  const file = await codexFixture([rec({ type: 'message', role: 'user', content: repeatedBlocks })]);
  const read = await readCodexSession(file);
  assert.equal(read.records.find((record) => record.line === 3)?.raw?.message?.content?.[0]?.type,
    'unsupported_content');
  const sliced = await sliceLineage([file]);
  assert.equal(sliced.capture.incomplete, true);
});

test('a spawn result row that repeats a key links no child and settles no failure', async () => {
  const spawn = rec({ type: 'function_call', name: 'spawn_agent', call_id: 's1',
    arguments: JSON.stringify({ message: 'Synthetic delegated brief.' }) });
  const result = rec({ type: 'function_call_output', call_id: 's1', output: JSON.stringify({ agent_id: 'child-1' }) });
  const clean = await sliceLineage([await codexFixture([spawn, result])]);
  assert.equal(clean.delegations[0].childId, 'child-1', 'positive control');
  const repeated = repeat(result, `"output":${JSON.stringify(JSON.stringify({ agent_id: 'child-1' }))}`,
    `"output":${JSON.stringify(JSON.stringify({ agent_id: 'child-2' }))}`);
  const sliced = await sliceLineage([await codexFixture([spawn, repeated])]);
  assert.equal(sliced.delegations.length, 1);
  assert.equal(sliced.delegations[0].childId, null);
  assert.notEqual(sliced.delegations[0].status, 'failed');
  assert.equal(sliced.delegations[0].reason, 'delegation_result_malformed');
});

test('a UI McpToolCall row that repeats a key is never a mirrored native call', async () => {
  const args = { query: 'visible' };
  const call = rec({ type: 'function_call', name: 'mcp__future_catalog__inspect', call_id: 'm1', arguments: JSON.stringify(args) });
  const mirror = JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', thread_id: 'test', item: {
    id: 'm1', type: 'McpToolCall', server: 'future_catalog', tool: 'inspect', arguments: args,
    result: { content: [{ type: 'text', text: 'VISIBLE' }], isError: false } } } });
  const output = rec({ type: 'function_call_output', call_id: 'm1', output: 'VISIBLE' });
  const clean = await sliceLineage([await codexFixture([call, mirror, output])]);
  assert.equal(clean.capture.incomplete, false, 'positive control: the exact ID is suppressed');
  const repeated = repeat(mirror, '"query":"visible"', '"query":"other"');
  const sliced = await sliceLineage([await codexFixture([call, repeated, output])]);
  assert.ok(sliced.capture.reasons.includes('codex_ui_tool_unmatched'));
  assert.equal(sliced.capture.incomplete, true);
});

test('a repeated session_meta identity key makes the recording identity conflicting', async () => {
  const meta = JSON.stringify({ type: 'session_meta', payload: { id: 'child-A', cwd: '/repo' } });
  const clean = recordingIdentity('codex');
  clean.observe(JSON.parse(meta));
  assert.equal(clean.value().identityConflict, false, 'positive control');
  for (const repeated of [repeat(meta, '"id":"child-A"', '"id":"child-Z"'), repeat(meta, '"cwd":"/repo"', '"forked_from_id":"p","forked_from_id":null')]) {
    const identity = recordingIdentity('codex');
    identity.observe(JSON.parse(repeated), { repeatedKeys: true });
    assert.equal(identity.value().identityConflict, true, repeated);
    const normalized = await readCodexSession(await codexFixture([], repeated));
    assert.equal(normalized.meta.sourceIdentity.identityConflict, true, 'the reader reports the conflict too');
  }
  const later = recordingIdentity('codex');
  later.observe({ type: 'response_item', payload: {} }, { repeatedKeys: true });
  assert.equal(later.value().identityConflict, false, 'a non-identity Codex row does not touch identity');
});

test('Claude Code rows that repeat a key are unparseable lines, never typed status or identity', async () => {
  const base = { sessionId: 'sess-1', cwd: '/repo', version: '2.1.0' };
  const rows = (last) => [
    JSON.stringify({ ...base, uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'Run the tests.' } }),
    JSON.stringify({ ...base, uuid: 'a1', parentUuid: 'u1', type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'make test' } }] } }),
    last,
  ];
  const result = JSON.stringify({ ...base, uuid: 'r1', parentUuid: 'a1', type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'FAIL', is_error: true }] },
    toolUseResult: { stdout: 'FAIL', stderr: '', interrupted: false } });
  const slice = async (last) => {
    const dir = await scratchDir('strict-claude-');
    const file = join(dir, 'sess-1.jsonl');
    await writeFile(file, rows(last).join('\n'));
    return sliceLineage([file]);
  };
  const clean = await slice(result);
  assert.deepEqual(clean.ledger.map((event) => [event.cmd, event.outcome]), [['make test', 'failed']], 'positive control');
  for (const repeated of [repeat(result, '"is_error":true', '"is_error":false'),
    repeat(result, '"interrupted":false', '"interrupted":true'),
    repeat(result, `${JSON.stringify('sessionId')}:"sess-1"`, `${JSON.stringify('sessionId')}:"sess-2"`)]) {
    const sliced = await slice(repeated);
    assert.equal(sliced.ledger.length, 1, 'the action stays visible');
    assert.notEqual(sliced.ledger[0].outcome, 'passed');
    assert.notEqual(sliced.ledger[0].outcome, 'failed', 'no status from a repeated-key row');
    assert.ok(sliced.dropped.some((row) => row.reason === 'unparseable_lines'));
    assert.ok(observations(sliced).every(([, proven]) => !proven));
  }
});

test('a non-command tool whose direct text is {output, exit_code} JSON gets no typed status', async () => {
  const body = JSON.stringify({ output: 'x', exit_code: 1 });
  const command = await sliceLineage([await codexFixture([
    rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make test"}' }),
    rec({ type: 'function_call_output', call_id: 'c1', output: body })])]);
  assert.equal(command.ledger[0].exitCode, 1, 'control: a direct command envelope is still typed (TS-12 open)');
  for (const [name, args] of [['read_file', { path: 'fixtures/result.json' }], ['mcp__files__read_file', { path: 'a.json' }]]) {
    const sliced = await sliceLineage([await codexFixture([
      rec({ type: 'function_call', name, call_id: 'r1', arguments: JSON.stringify(args) }),
      rec({ type: 'function_call_output', call_id: 'r1', output: body })])]);
    assert.equal(sliced.ledger.length, 1, name);
    assert.equal(sliced.ledger[0].exitCode, undefined, name);
    assert.notEqual(sliced.ledger[0].isError, true, `${name}: the file's JSON is not a tool failure`);
  }
});
