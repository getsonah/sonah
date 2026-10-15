// Synthetic Codex recordings only. C-02 strict JSON: a payload that parses but repeats an
// object key is not a faithful serializer product, so none of its fields is typed evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { duplicateJsonKeys, strictJson } from '../src/strict-json.js';
import { readExecCalls, execResults, duplicateJsonKeys as reexported } from '../src/codex-exec.js';
import { detectDelegation, DELEGATION_REASONS } from '../src/delegation.js';
import { sliceLineage } from '../index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { scratchDir } from './scratch-dir.js';

const rec = (payload) => JSON.stringify({ type: 'response_item', payload });
const completeRaw = (...texts) => [{ type: 'input_text', text: 'Script completed\nWall time: 0.1 seconds' },
  ...texts.map((text) => ({ type: 'input_text', text }))];
const call = (input, call_id = 'wrapper') => rec({ type: 'custom_tool_call', name: 'exec', call_id, input });
const result = (output, call_id = 'wrapper') => rec({ type: 'custom_tool_call_output', call_id, output });
const direct = (cmd, call_id = 'c1', name = 'exec_command') =>
  rec({ type: 'function_call', name, call_id, arguments: JSON.stringify({ cmd }) });
const directResult = (output, call_id = 'c1') => rec({ type: 'function_call_output', call_id, output });
async function fixture(lines) {
  const dir = await scratchDir('strict-json-');
  const file = join(dir, 'rollout-2026-09-10T12-00-00-test.jsonl');
  await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'test', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: 'Run the tests.' }), ...lines].join('\n'));
  return file;
}

test('strictJson accepts only one JSON value with no repeated key at any depth', () => {
  assert.equal(reexported, duplicateJsonKeys, 'the wrapper reader uses the one shared scanner');
  for (const text of ['{"a":1,"b":{"a":2}}', '[{"a":1},{"a":2}]', '{"a":"{\\"b\\":1,\\"b\\":2}"}', ' {"a" : [ ] } ',
    '"plain"', '0', 'null', '{}', '[]']) {
    const decoded = strictJson(text);
    assert.equal(decoded.json, true, text);
    assert.equal(decoded.strict, true, text);
    assert.deepEqual(decoded.value, JSON.parse(text));
  }
  for (const text of ['{"a":1,"a":1}', '{"a":1,"\\u0061":2}', '{"x":{"exit_code":1,"exit_code":0}}',
    '[{"status":"fulfilled"},{"status":"rejected","status":"fulfilled"}]']) {
    const decoded = strictJson(text);
    assert.equal(decoded.json, true, text);
    assert.equal(decoded.strict, false, `${text} repeats a key`);
    assert.equal(decoded.value, text, 'an untyped payload stays its original text');
  }
  for (const text of ['not json', '{broken', '{"a":1} trailing', undefined, 12]) {
    const decoded = strictJson(text);
    assert.equal(decoded.json, false);
    assert.equal(decoded.strict, false);
  }
});

// Each existing wrapper result grammar with a clean payload (positive control) and the same
// payload with a repeated exit_code or settled status (near miss).
const GRAMMARS = [
  ['text(result)', 'const r = await tools.exec_command({cmd:"make test"}); text(r);',
    '{"output":"FAIL","exit_code":1}', '{"output":"FAIL","exit_code":1,"exit_code":0}'],
  ['text(allSettled)', 'const results = await Promise.allSettled([tools.exec_command({cmd:"make test"})]); text(results);',
    '[{"status":"fulfilled","value":{"output":"FAIL","exit_code":1}}]',
    '[{"status":"fulfilled","value":{"output":"FAIL","exit_code":1,"exit_code":0}}]'],
  ['text(all)', 'const results = await Promise.all([tools.exec_command({cmd:"make test"})]); text(results);',
    '[{"output":"FAIL","exit_code":1}]', '[{"output":"FAIL","exit_code":1,"exit_code":0}]'],
  ['forEach spread', 'const results = await Promise.allSettled([tools.exec_command({cmd:"make test"})]); results.forEach((r, i) => text(JSON.stringify({i, ...r})));',
    '{"i":0,"status":"fulfilled","value":{"output":"FAIL","exit_code":1}}',
    '{"i":0,"status":"fulfilled","value":{"output":"FAIL","exit_code":1,"exit_code":0}}'],
  ['envelope loop', 'const results = await Promise.allSettled([tools.exec_command({cmd:"make test"})]); for (const r of results) text(r);',
    '{"status":"fulfilled","value":{"output":"FAIL","exit_code":1}}',
    '{"status":"fulfilled","value":{"output":"FAIL","exit_code":1,"exit_code":0}}'],
  ['nested', 'const results = await Promise.allSettled([tools.exec_command({cmd:"make test"})]); results.forEach((r, i) => text(JSON.stringify({i, result: r})));',
    '{"i":0,"result":{"status":"fulfilled","value":{"output":"FAIL","exit_code":1}}}',
    '{"i":0,"result":{"status":"fulfilled","value":{"output":"FAIL","exit_code":1,"exit_code":0}}}'],
];

test('every wrapper result grammar keeps typed status for strict JSON and drops it for a repeated key', async () => {
  for (const [name, source, clean, repeated] of GRAMMARS) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 1, name);
    assert.equal(parsed.unsupported, 0, name);
    const good = execResults(completeRaw(clean), parsed);
    assert.equal(good.results.size, 1, `${name}: clean control maps`);
    const goodLedger = (await sliceLineage([await fixture([call(source), result(completeRaw(clean))])])).ledger;
    assert.equal(goodLedger[0].exitCode, 1, `${name}: clean control keeps its typed exit`);
    assert.equal(goodLedger[0].outcome, 'failed', name);

    const bad = execResults(completeRaw(repeated), parsed);
    for (const value of bad.results.values()) {
      assert.equal(value.rawOutput, true, `${name}: a repeated key is never decoded as a typed value`);
      assert.equal(value.outcomeUnknown, true, name);
    }
    const badSlice = await sliceLineage([await fixture([call(source), result(completeRaw(repeated))])]);
    const event = badSlice.ledger[0];
    assert.equal(event.cmd, 'make test', `${name}: the attempted action is still captured`);
    assert.equal(event.exitCode, undefined, `${name}: no typed exit from a repeated key`);
    assert.notEqual(event.outcome, 'succeeded', name);
    assert.notEqual(event.outcome, 'failed', name);
  }
});

test('a repeated settled status cannot turn a rejection into success', async () => {
  const source = 'const results = await Promise.allSettled([tools.exec_command({cmd:"make test"})]); text(results);';
  const parsed = readExecCalls(source);
  assert.equal(execResults(completeRaw('[{"status":"rejected","reason":"boom"}]'), parsed).results.get(0).value.is_error, true);
  const payload = '[{"status":"rejected","status":"fulfilled","value":{"output":"ok","exit_code":0}}]';
  assert.equal(execResults(completeRaw(payload), parsed).results.size, 0);
  const sliced = await sliceLineage([await fixture([call(source), result(completeRaw(payload))])]);
  assert.equal(sliced.capture.unmapped, 1, 'an unreadable aggregate keeps its unmapped-result gap');
  assert.equal(sliced.ledger[0].exitCode, undefined);
  assert.equal(sliced.ledger[0].outcome, undefined);
});

test('a single text(result) with a repeated key stays visible with an unknown outcome and an observation gap', async () => {
  const source = 'const r = await tools.exec_command({cmd:"make test"}); text(r);';
  const payload = '{"output":"FAIL","exit_code":1,"exit_code":0}';
  const sliced = await sliceLineage([await fixture([call(source), result(completeRaw(payload))])]);
  assert.equal(sliced.capture.unmapped, 0, 'the text is still attributed to its one call');
  assert.equal(sliced.ledger[0].outcome, 'unknown');
  assert.equal(sliced.ledger[0].outcomeUnknown, true);
  const session = sessionFromLedger(redact(sliced).ledger);
  const observation = session.events.find((event) => event.kind === 'observation');
  assert.equal(observation.result, 'unknown');
  assert.equal(observation.exitCode, null);
  assert.notEqual(observation.terminalStatusProven, true);
  assert.ok(observation.output.length > 0, 'the visible observation survives');
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations' && gap.code === 'command_outcome_unknown'), 'the unknown outcome is a declared gap');
});

test('a direct native output with a repeated exit_code or output key has no typed status', async () => {
  const clean = await sliceLineage([await fixture([direct('make test'), directResult('{"output":"FAIL","exit_code":1}')])]);
  assert.equal(clean.ledger[0].exitCode, 1);
  assert.equal(clean.ledger[0].outcome, 'failed');
  for (const output of ['{"output":"FAIL","exit_code":1,"exit_code":0}', '{"output":"FAIL","output":"ok","exit_code":0}',
    JSON.stringify([{ type: 'input_text', text: '{"output":"x","exit_code":1,"exit_code":0}' }])]) {
    const payload = output.startsWith('[') ? JSON.parse(output) : output;
    const sliced = await sliceLineage([await fixture([direct('make test'), directResult(payload)])]);
    assert.equal(sliced.ledger[0].exitCode, undefined, output);
    assert.equal(sliced.ledger[0].outcome, 'unknown', output);
    const session = sessionFromLedger(redact(sliced).ledger);
    const observation = session.events.find((event) => event.kind === 'observation');
    assert.equal(observation.result, 'unknown');
    assert.notEqual(observation.terminalStatusProven, true);
    assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations' && gap.code === 'command_outcome_unknown'));
  }
});

test('a repeated session_id cannot join a later poll to a command', async () => {
  const sessionKey = JSON.stringify('session_id');
  const poll = rec({ type: 'function_call', name: 'functions.write_stdin', call_id: 'poll',
    arguments: JSON.stringify({ session_id: 42, chars: '' }) });
  const done = directResult(JSON.stringify({ output: 'finished', exit_code: 0 }), 'poll');
  const clean = await sliceLineage([await fixture([direct('make build', 'begin'),
    directResult(JSON.stringify({ output: 'started', session_id: 42 }), 'begin'), poll, done])]);
  assert.equal(clean.ledger[0].exitCode, 0, 'positive control: the exact session joins its poll');
  const repeated = await sliceLineage([await fixture([direct('make build', 'begin'),
    directResult(`{"output":"started",${sessionKey}:7,${sessionKey}:42}`, 'begin'), poll, done])]);
  assert.equal(repeated.ledger[0].exitCode, undefined, 'no session identity from a repeated key');
  assert.notEqual(repeated.ledger[0].outcome, 'succeeded');
  assert.ok(repeated.capture.unmapped >= 1 || repeated.capture.unsupported >= 1, 'the orphaned poll remains a gap');
});

test('a repeated agent_id or task_name is not a child identity', () => {
  const use = { type: 'tool_use', name: 'spawn_agent', id: 'call-1', input: { message: 'Synthetic brief.' } };
  const context = { adapter: 'codex', turn: 3 };
  const detect = (value) => detectDelegation(use, { callId: 'call-1', value, isError: false }, context);
  assert.equal(detect('{"agent_id":"child-1"}').childId, 'child-1');
  for (const value of ['{"agent_id":"child-1","agent_id":"child-2"}', '{"agent_id":"child-1","agent_id":"child-1"}',
    '{"agent_id":"child-1","meta":{"a":1,"a":2}}']) {
    const detected = detect(value);
    assert.equal(detected.childId, null, value);
    assert.equal(detected.status, 'unresolved');
    assert.equal(detected.reason, DELEGATION_REASONS.RESULT_MALFORMED);
  }
});

test('a Codex spawn result with a repeated is_error neither fails nor links the child', async () => {
  const spawn = rec({ type: 'function_call', name: 'spawn_agent', call_id: 'spawn',
    arguments: JSON.stringify({ message: 'Synthetic delegated brief.' }) });
  const delegation = async (output) => {
    const { delegations } = await sliceLineage([await fixture([spawn, directResult(output, 'spawn')])]);
    assert.equal(delegations.length, 1);
    return delegations[0];
  };
  const clean = await delegation('{"agent_id":"child-1","is_error":false}');
  assert.equal(clean.childId, 'child-1', 'positive control: a strict spawn receipt links its child');
  assert.equal(clean.status, 'unresolved', 'a link alone still leaves child coverage unchecked');
  for (const output of ['{"agent_id":"child-1","is_error":false,"is_error":true}', '{"agent_id":"child-1","agent_id":"child-2"}']) {
    const repeated = await delegation(output);
    assert.notEqual(repeated.status, 'failed', 'a repeated error flag settles nothing');
    assert.equal(repeated.childId, null, 'and proves no identity');
    assert.equal(repeated.reason, DELEGATION_REASONS.RESULT_MALFORMED);
  }
});

test('model-written tool arguments with a repeated key name no action, fork mode or poll session', async () => {
  const header = 'Wall time: 1 seconds\nProcess exited with code 0\nOutput:\nok';
  const run = async (lines) => {
    const sliced = await sliceLineage([await fixture(lines)]);
    return { sliced, gaps: sessionFromLedger(redact(sliced).ledger).adapterGaps.map((gap) => `${gap.channel}/${gap.code}`) };
  };
  const clean = await run([rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make test"}' }),
    directResult(header)]);
  assert.deepEqual(clean.sliced.ledger.map((event) => [event.cmd, event.exitCode]), [['make test', 0]], 'positive control');
  const repeated = await run([rec({ type: 'function_call', name: 'exec_command', call_id: 'c1',
    arguments: '{"cmd":"rm -rf build","cmd":"make test"}' }), directResult(header)]);
  assert.equal(repeated.sliced.ledger.length, 1);
  assert.notEqual(repeated.sliced.ledger[0].cmd, 'make test', 'never the last repeated value');
  assert.equal(repeated.sliced.ledger[0].exitCode, undefined);
  assert.ok(repeated.gaps.includes('actions/incomplete_inventory'), 'unparsed input is a declared action gap');

  const nested = await run([rec({ type: 'function_call', name: 'exec_command', call_id: 'c1',
    arguments: '{"cmd":"make test","env":{"A":"1","A":"2"}}' }), directResult(header)]);
  assert.ok(nested.gaps.includes('actions/incomplete_inventory'), 'a nested repeat is still unparsed');

  const spawn = await sliceLineage([await fixture([rec({ type: 'function_call', name: 'spawn_agent', call_id: 's1',
    arguments: '{"message":"Synthetic brief.","fork_turns":"all","fork_turns":"none"}' }),
  directResult(JSON.stringify({ agent_id: 'child-1' }), 's1')])]);
  assert.ok(spawn.delegations.every((delegation) => delegation.forkTurns !== 'none'), 'no certified fork mode');

  const sessionKey = JSON.stringify('session_id');
  const poll = await sliceLineage([await fixture([rec({ type: 'function_call', name: 'exec_command', call_id: 'b',
    arguments: '{"cmd":"make build"}' }), directResult(JSON.stringify({ output: 'started', session_id: 42 }), 'b'),
  rec({ type: 'function_call', name: 'write_stdin', call_id: 'p', arguments: `{${sessionKey}:7,${sessionKey}:42,"chars":""}` }),
  directResult(JSON.stringify({ output: 'done', exit_code: 0 }), 'p')])]);
  assert.equal(poll.ledger[0].exitCode, undefined, 'a repeated session_id joins no poll');
  assert.ok(poll.capture.reasons.includes('codex_poll_unmatched'));
});
