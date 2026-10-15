// Synthetic Codex wrappers only. No private recording or model response belongs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExecCalls, execResults } from '../src/codex-exec.js';
import { sliceLineage } from '../index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const prefix = 'const settled = await Promise.allSettled(['
  + 'tools.exec_command({cmd:"node --test"}),'
  + 'tools.mcp__future_catalog__inspect({query:"synthetic"})]); ';
const ordinary = 'settled.forEach((entry, index) => '
  + 'text(`${index}: ${entry.status === "fulfilled" ? entry.value.output : entry.reason}`));';
const nested = 'settled.forEach((entry, index) => '
  + 'text(`${index}: ${entry.status === "fulfilled" ? `exit ${entry.value.exit_code}: ${entry.value.output}` : entry.reason}`));';
const blocks = (...values) => [{ type: 'input_text', text: 'Script completed' },
  ...values.map((value) => ({ type: 'input_text', text: value }))];

async function fixture(t, source, output, extras = []) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-codex-template-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-09-26T12-00-00-synthetic.jsonl');
  const rows = [
    { type: 'session_meta', payload: { id: 'synthetic', cwd: '/repo' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: 'Review the checks.' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.exec', call_id: 'cell', input: source } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'cell', output } },
    ...extras,
  ];
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return file;
}

test('indexed template formatting retains every literal action and visible observation with unknown outcomes', async (t) => {
  const source = prefix + ordinary;
  const parsed = readExecCalls(source);
  assert.equal(parsed.calls.length, 2);
  assert.ok(parsed.calls.every((call) => call.awaited));
  assert.equal(parsed.unsupported, 0);
  assert.equal(parsed.emissionsExact, true);
  assert.equal(parsed.emissions.length, 2);
  const visible = ['0: first command output', '1: catalog lookup rejected'];
  const mapped = execResults(blocks(...visible), parsed).results;
  assert.equal(mapped.size, 2);
  assert.deepEqual([mapped.get(0)?.value, mapped.get(1)?.value], visible,
    'each indexed observation belongs to its original call');
  assert.ok([...mapped.values()].every((result) => result.outcomeUnknown && result.rawOutput));
  const raw = await sliceLineage([await fixture(t, source, blocks(...visible))]);
  assert.equal(raw.capture.captured, 2);
  assert.equal(raw.capture.unsupported, 0);
  assert.equal(raw.capture.unmapped, 0);
  assert.equal(raw.capture.incomplete, false);
  assert.deepEqual(raw.ledger.map((event) => [event.cmd ?? event.tool, event.tailLines]), [
    ['node --test', [visible[0]]],
    ['mcp__future_catalog__inspect', [visible[1]]],
  ]);
  assert.deepEqual(raw.ledger.map((event) => event.outcome ?? event.result?.outcome), ['unknown', 'unknown']);
  const session = sessionFromLedger(redact(raw).ledger, { sessionKey: 'synthetic' });
  assert.equal(session.events.filter((event) => event.kind === 'invocation').length, 2);
  assert.equal(session.events.filter((event) => event.kind === 'observation').length, 2);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.code === 'command_outcome_unknown')
    .map((gap) => gap.count), [1]);
});

test('nested success template is display only; rejected success words never prove a passed result', async (t) => {
  const source = prefix + nested;
  const parsed = readExecCalls(source);
  assert.equal(parsed.calls.length, 2);
  assert.equal(parsed.emissions.length, 2);
  assert.equal(parsed.unsupported, 0);
  const raw = await sliceLineage([await fixture(t, source,
    blocks('0: exit 0: checks complete', '1: tests passed'))]);
  assert.equal(raw.capture.unmapped, 0);
  assert.deepEqual(raw.ledger.map((event) => [event.outcome ?? event.result?.outcome, event.exitCode]),
    [['unknown', undefined], ['unknown', undefined]]);
});

test('mismatched visible block counts keep all observations unmapped', async (t) => {
  const source = prefix + ordinary;
  const parsed = readExecCalls(source);
  for (const output of [blocks('0: only one'), blocks('0: first', '1: second', '2: extra'),
    blocks('1: second', '0: first'), blocks('0: first', '0: duplicate')]) {
    assert.equal(execResults(output, parsed).results.size, 0);
  }
  const raw = await sliceLineage([await fixture(t, source, blocks('0: only one'))]);
  assert.equal(raw.capture.captured, 2);
  assert.equal(raw.capture.unmapped, 2);
  assert.ok(raw.capture.reasons.includes('codex_wrapper_output_unmapped'));
});

test('interpolated tool arguments and side-effectful templates remain declared gaps', () => {
  const changedArgument = 'const label = "synthetic"; '
    + 'const first = await tools.exec_command({cmd:`echo ${label}`}); text(first);';
  const argument = readExecCalls(changedArgument);
  assert.equal(argument.calls.length, 0);
  assert.ok(argument.unsupported > 0);
  const changedBatch = readExecCalls('const label = "synthetic"; '
    + 'const settled = await Promise.allSettled(['
    + 'tools.exec_command({cmd:`echo ${label}`}),'
    + 'tools.exec_command({cmd:"node --test"})]); ' + ordinary);
  assert.equal(changedBatch.calls.length, 0, 'a dynamic batch argument cannot license the whole batch');
  assert.ok(changedBatch.unsupported > 0);
  assert.equal(execResults(blocks('0: unknown', '1: unknown'), changedBatch).results.size, 0);
  const sideEffect = readExecCalls(prefix + 'settled.forEach((entry, index) => '
    + 'text(`${index}: ${tools.exec_command({cmd:"unexpected"})}`));');
  assert.equal(sideEffect.calls.length, 2, 'the earlier awaited literal prefix remains provable');
  assert.equal(sideEffect.emissionsExact, false);
  assert.ok(sideEffect.unsupported > 0);
  assert.equal(execResults(blocks('0: hidden', '1: hidden'), sideEffect).results.size, 0);
});

test('conditional, async, and multiple template emissions cannot claim per-call observations', () => {
  const changed = [
    'settled.forEach((entry, index) => index === 0 && text(`${index}: ${entry.reason}`));',
    'settled.forEach(async (entry, index) => text(`${index}: ${entry.reason}`));',
    ordinary.replace('));', '), text(`${index}: duplicate`));'),
  ];
  for (const callback of changed) {
    const parsed = readExecCalls(prefix + callback);
    assert.equal(parsed.calls.length, 2, 'earlier literal actions remain visible');
    assert.equal(parsed.emissionsExact, false);
    assert.ok(parsed.unsupported > 0);
    assert.equal(execResults(blocks('0: first', '1: second'), parsed).results.size, 0);
  }
});

test('a throwing template stops capture before a later command, while retaining the prior prefix', async (t) => {
  const source = 'const first = await tools.exec_command({cmd:"echo prior"}); text(first); '
    + 'const x = `${(() => { throw Error("stop") })()}`; '
    + 'const later = await tools.exec_command({cmd:"echo not-run"}); text(later);';
  const parsed = readExecCalls(source);
  assert.deepEqual(parsed.calls.map((call) => call.input.cmd), ['echo prior']);
  assert.ok(parsed.unsupported > 0);
  assert.equal(parsed.emissionsExact, false);
  const raw = await sliceLineage([await fixture(t, source, blocks('PRIOR_VISIBLE'))]);
  assert.equal(raw.capture.captured, 1);
  assert.equal(raw.capture.incomplete, true);
  assert.deepEqual(raw.ledger.map((event) => event.cmd), ['echo prior']);
  assert.equal(raw.ledger.some((event) => event.cmd === 'echo not-run'), false);
});

test('unbound names and invalid property reads stop before later commands', async (t) => {
  const unsafe = [
    'const x = unknownBinding;',
    'const x = null.missing;',
    'const x = null; const y = x.missing;',
    'const x = ({a:null}).a.foo;',
    'const x = text("visible"); x.missing;',
  ];
  for (const statement of unsafe) {
    const source = 'const first = await tools.exec_command({cmd:"echo prior"}); text(first); '
      + statement + ' const later = await tools.exec_command({cmd:"echo not-run"}); text(later);';
    const parsed = readExecCalls(source);
    assert.deepEqual(parsed.calls.map((call) => call.input.cmd), ['echo prior']);
    assert.ok(parsed.unsupported > 0);
    assert.equal(parsed.emissionsExact, false);
    const raw = await sliceLineage([await fixture(t, source, blocks('PRIOR_VISIBLE'))]);
    assert.equal(raw.capture.captured, 1);
    assert.equal(raw.capture.incomplete, true);
    assert.deepEqual(raw.ledger.map((event) => event.cmd), ['echo prior']);
  }
});

test('unsupported tool arguments stop capture before later commands', async (t) => {
  const unsafe = [
    'await tools.exec_command({cmd:"one"}, "bad");',
    'const unknownValue = text("synthetic"); '
      + 'await tools.exec_command({cmd:unknownValue});',
  ];
  for (const statement of unsafe) {
    const source = 'const prior = await tools.exec_command({cmd:"echo prior"}); text(prior); '
      + statement + ' const later = await tools.exec_command({cmd:"echo not-run"}); text(later);';
    const parsed = readExecCalls(source);
    assert.deepEqual(parsed.calls.map((call) => call.input.cmd), ['echo prior']);
    assert.ok(parsed.unsupported > 0);
    assert.equal(parsed.emissionsExact, false);
    const raw = await sliceLineage([await fixture(t, source, blocks('PRIOR_VISIBLE'))]);
    assert.equal(raw.capture.captured, 1);
    assert.equal(raw.capture.incomplete, true);
    assert.deepEqual(raw.ledger.map((event) => event.cmd), ['echo prior']);
  }
});

test('a continuation without a typed session join is an explicit gap, even when display text names a session', async (t) => {
  const source = 'const settled = await Promise.allSettled(['
    + 'tools.exec_command({cmd:"long task"})]); '
    + 'settled.forEach((entry, index) => '
    + 'text(`${index}: ${entry.status === "fulfilled" ? entry.value.output : entry.reason}`));';
  const directPoll = [
    { type: 'response_item', payload: { type: 'function_call', name: 'functions.write_stdin',
      call_id: 'poll', arguments: JSON.stringify({ session_id: 42, chars: '' }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'poll',
      output: 'Process exited with code 0' } },
  ];
  const nestedPoll = [
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.exec',
      call_id: 'poll-cell', input: 'text(await tools.write_stdin({session_id:42,chars:""}));' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'poll-cell',
      output: blocks('Process exited with code 0') } },
  ];
  for (const poll of [directPoll, nestedPoll]) {
    const raw = await sliceLineage([await fixture(t, source,
      blocks('0: Process running with session ID 42'), poll)]);
    assert.equal(raw.capture.captured, 1);
    assert.equal(raw.capture.unsupported, 1);
    assert.equal(raw.capture.unmapped, 1);
    assert.equal(raw.capture.incomplete, true);
    assert.ok(raw.capture.reasons.includes('codex_poll_unmatched'));
    assert.deepEqual(raw.ledger.map((event) => event.cmd), ['long task']);
    assert.ok(sessionFromLedger(redact(raw).ledger).adapterGaps.length > 0);
  }
});

test('a continuation without any result row is an explicit missing-result gap', async (t) => {
  const source = 'text(await tools.exec_command({cmd:"long task"}));';
  const poll = { type: 'response_item', payload: { type: 'function_call',
    name: 'functions.write_stdin', call_id: 'poll-missing',
    arguments: JSON.stringify({ session_id: 42, chars: '' }) } };
  const raw = await sliceLineage([await fixture(t, source, blocks(JSON.stringify({
    output: 'started', session_id: 42,
  })), [poll])]);
  assert.equal(raw.capture.captured, 1);
  assert.equal(raw.capture.missing, 1);
  assert.equal(raw.capture.incomplete, true);
  assert.ok(raw.capture.reasons.includes('codex_tool_result_missing'));
});
