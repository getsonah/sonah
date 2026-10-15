// C-02 "M33 native-first Codex code-mode evidence". Synthetic Codex rollouts only: no private
// recording, no model call. A recording whose own thread persists paginated `item_completed` rows
// (thread_id + turn_id) carries each eligible CommandExecution / FileChange / McpToolCall item as a
// recorded action; the enclosing `exec` wrapper is one generic code-cell action; the wrapper's
// statically parsed inner calls of those families are not emitted; and every turn is checked
// against the per-turn completeness bound (P parsed-and-dispatched inner calls, N native items).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { readExecCalls, CODEX_CAPTURE_REASONS as REASON } from '../src/codex-exec.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const OWN = 'thread-own';
const NATIVE = 'codex_native_item';
const CELL = 'codex_code_cell';
const INVENTORY = 'codex_native_inventory_incomplete';

const meta = { type: 'session_meta', payload: { id: OWN, cwd: '/repo' } };
const item = (payload) => ({ type: 'response_item', payload });
const event = (payload) => ({ type: 'event_msg', payload });
const started = (turn) => event({ type: 'task_started', turn_id: turn, model_context_window: 1 });
const complete = (turn) => event({ type: 'task_complete', turn_id: turn, last_agent_message: null });
const ask = (text) => item({ type: 'message', role: 'user', content: text });
// M5: a rollout whose own thread persists the item stream types each human message as a
// UserMessage item recorded beside it; only the message such an item names is a human ask (records.js `humanTurnBasis`).
const said = (text, turn, id = `u-${turn}`) => event({ type: 'item_completed', thread_id: OWN, turn_id: turn,
  item: { id, type: 'UserMessage', content: [{ type: 'text', text, text_elements: [] }] } });
const agentMessage = (id, turn) => event({ type: 'item_completed', thread_id: OWN, turn_id: turn,
  item: { id, type: 'AgentMessage' } });
const wrapper = (callId, source) => item({ type: 'custom_tool_call', name: 'exec', call_id: callId, input: source });
const wrapperOut = (callId, ...texts) => item({ type: 'custom_tool_call_output', call_id: callId,
  output: ['Script completed', ...texts].map((text) => ({ type: 'input_text', text })) });
const direct = (name, callId, input) => item({ type: 'function_call', name, call_id: callId,
  arguments: JSON.stringify(input) });
const directOut = (callId, output) => item({ type: 'function_call_output', call_id: callId, output });
const row = (turn, value, thread = OWN) => event({ type: 'item_completed', thread_id: thread, turn_id: turn,
  item: value });
const command = (id, turn, script, overrides = {}, thread = OWN) => row(turn, {
  id, type: 'CommandExecution', status: 'completed', source: 'unified_exec_startup',
  command: ['/bin/zsh', '-lc', script], cwd: 'file:///repo', exit_code: 0,
  stdout: 'SIDECAR_STDOUT', stderr: '', aggregated_output: `${script} ran`,
  formatted_output: 'SIDECAR_FORMATTED', parsed_cmd: [], process_id: '4242', duration: { secs: 0, nanos: 1 },
  ...overrides,
}, thread);
const fileChange = (id, turn, changes, overrides = {}) => row(turn, {
  id, type: 'FileChange', status: 'completed', changes, stdout: 'SIDECAR_STDOUT', stderr: '', ...overrides,
});
const mcp = (id, turn, overrides = {}) => row(turn, {
  id, type: 'McpToolCall', server: 'catalog', tool: 'inspect', arguments: { query: 'q' },
  result: { content: [{ type: 'text', text: 'CATALOG RESULT' }], isError: false },
  status: 'completed', duration: { secs: 0, nanos: 1 }, pluginId: 'catalog',
  ...overrides,
});

const TWO = 'text(await tools.exec_command({cmd:"node build.js"})); '
  + 'text(await tools.exec_command({cmd:"node lint.js"}));';

async function fixture(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-native-first-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-09-29T10-00-00-synthetic.jsonl');
  await writeFile(file, rows.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  return file;
}
const slice = async (t, rows) => sliceLineage([await fixture(t, rows)]);
const session = (ledger) => sessionFromLedger(redact(ledger).ledger, { sessionKey: 'native-first' });
const natives = (ledger) => ledger.ledger.filter((e) => e.provenance === NATIVE);
const cells = (ledger) => ledger.ledger.filter((e) => e.provenance === CELL);
const lineOf = (rows, predicate) => rows.findIndex(predicate) + 1;
const gapsOf = (s, channel, code) => (s.adapterGaps ?? []).filter((g) => g.channel === channel && g.code === code);

test('the closed provenance and reason vocabularies are frozen members', async () => {
  const { ACTION_PROVENANCE } = await import('../src/events.js');
  assert.ok(Object.isFrozen(ACTION_PROVENANCE));
  assert.equal(ACTION_PROVENANCE.codexNativeItem, NATIVE);
  assert.equal(ACTION_PROVENANCE.codexCodeCell, CELL);
  assert.equal(REASON.nativeInventory, INVENTORY);
});

test('a wrapper with two exec_command calls and two native items: both proven, one cell, no gap', async (t) => {
  const parsed = readExecCalls(TWO);
  assert.equal(parsed.calls.length, 2);
  assert.equal(parsed.unsupported, 0);
  const rows = [meta, started('t1'), ask('Build and lint.'), wrapper('w1', TWO),
    command('i1', 't1', 'node build.js'), command('i2', 't1', 'node lint.js', { exit_code: 3, status: 'failed' }),
    wrapperOut('w1', 'built', 'lint failed'), complete('t1')];
  const ledger = await slice(t, rows);

  const cell = cells(ledger);
  assert.equal(cell.length, 1, 'the wrapper is one generic code-cell action');
  assert.equal(cell[0].tool, 'exec');
  assert.equal(cell[0].genericTool, true);
  assert.equal(cell[0].argsExcerpt, JSON.stringify(TWO), 'its input is its script');
  assert.deepEqual(cell[0].tailLines, ['Script completed', 'built', 'lint failed'], 'its observation is its own output');

  const native = natives(ledger);
  assert.deepEqual(native.map((e) => e.cmd), ['node build.js', 'node lint.js']);
  assert.deepEqual(native.map((e) => e.exitCode), [0, 3]);
  assert.deepEqual(native.map((e) => e.exitCodeSource), ['native', 'native']);
  assert.deepEqual(native.map((e) => e.outcome), ['passed', 'failed']);
  const first = lineOf(rows, (r) => r.payload?.item?.id === 'i1');
  assert.deepEqual(native[0].sourceLocator, { stream: 0, record: first, part: 0, resultRecord: first,
    commandExecutionRecord: first });
  // The parsed inner calls are not emitted: the native items are the recorded executions.
  assert.equal(ledger.ledger.filter((e) => typeof e.cmd === 'string').length, 2);
  assert.equal(JSON.stringify(ledger).includes('SIDECAR_'), false, 'no UI stdout or formatted text');

  assert.equal(ledger.capture.nativeItems, 2);
  assert.equal(ledger.capture.nativeInventoryShortfall, 0);
  assert.equal(ledger.capture.incomplete, false);
  assert.equal(ledger.capture.unsupported, 0);
  assert.equal(ledger.capture.unmapped, 0);
  assert.deepEqual(ledger.capture.reasons, []);

  const s = session(ledger);
  const proven = s.events.filter((e) => e.kind === 'observation' && e.terminalStatusProven === true);
  assert.deepEqual(proven.map((e) => [e.result, e.exitCode, e.sourceOfResult]),
    [['succeeded', 0, 'native'], ['failed', 3, 'native']]);
  assert.deepEqual(gapsOf(s, 'actions', 'incomplete_inventory'), []);
  assert.deepEqual(gapsOf(s, 'observations', 'command_outcome_unknown'), []);
});

test('N < P declares an inventory gap counting max(P - N, 1)', async (t) => {
  const three = 'text(await tools.exec_command({cmd:"node a.js"})); text(await tools.exec_command({cmd:"node b.js"})); '
    + 'text(await tools.exec_command({cmd:"node c.js"}));';
  assert.equal(readExecCalls(three).unsupported, 0);
  const one = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', three),
    command('i1', 't1', 'node a.js'), wrapperOut('w1', 'a', 'b', 'c')]);
  assert.equal(natives(one).length, 1);
  assert.equal(one.capture.nativeInventoryShortfall, 2);
  assert.equal(one.capture.nativeCommandShortfall, 2);
  assert.equal(one.capture.nativeInventoryGaps, 1);
  assert.ok(one.capture.reasons.includes(INVENTORY));
  assert.equal(one.capture.incomplete, true);
  const s = session(one);
  assert.equal(gapsOf(s, 'actions', 'incomplete_inventory').length > 0, true);

  const none = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', TWO), agentMessage('m1', 't1'),
    wrapperOut('w1', 'a', 'b')]);
  assert.equal(natives(none).length, 0);
  assert.equal(none.capture.nativeInventoryShortfall, 2);
  assert.ok(none.capture.reasons.includes(INVENTORY));
});

test('N > P is also incomplete: an unpredicted native item is a gap of one', async (t) => {
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'),
    wrapper('w1', 'text(await tools.exec_command({cmd:"node a.js"}));'),
    command('i1', 't1', 'node a.js'), command('i2', 't1', 'node b.js'), wrapperOut('w1', 'a')]);
  assert.equal(natives(ledger).length, 2, 'both recorded executions remain actions');
  assert.equal(ledger.capture.nativeInventoryShortfall, 1);
  assert.ok(ledger.capture.reasons.includes(INVENTORY));
});

test('an unsupported wrapper statement makes its turn incomplete even when N equals P', async (t) => {
  const source = 'text(await tools.exec_command({cmd:"node a.js"})); if (true) { text("x"); }';
  const parsed = readExecCalls(source);
  assert.equal(parsed.calls.length, 1);
  assert.ok(parsed.unsupported > 0);
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', source),
    command('i1', 't1', 'node a.js'), wrapperOut('w1', 'a', 'x')]);
  assert.equal(natives(ledger).length, 1);
  assert.equal(natives(ledger)[0].exitCode, 0);
  assert.ok(ledger.capture.reasons.includes(INVENTORY));
  assert.ok(ledger.capture.nativeInventoryShortfall >= 1);
  assert.equal(ledger.capture.nativeCommandShortfall, 0, 'lane g3 split: P = N counts no command');
  assert.ok(ledger.capture.reasons.includes(REASON.unsupported), 'the statement keeps its own gap');
});

test('a foreign-thread item is not emitted and keeps its gap', async (t) => {
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', TWO),
    command('i1', 't1', 'node build.js'), command('i2', 't1', 'node lint.js', {}, 'thread-foreign'),
    wrapperOut('w1', 'a', 'b')]);
  assert.deepEqual(natives(ledger).map((e) => e.cmd), ['node build.js']);
  assert.ok(ledger.capture.reasons.includes(REASON.nativeUnmatched));
  assert.equal(ledger.capture.nativeInventoryShortfall, 1);
});

test('a duplicated item id is not emitted and keeps its gap', async (t) => {
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', TWO),
    command('i1', 't1', 'node build.js'), command('i1', 't1', 'node lint.js'), wrapperOut('w1', 'a', 'b')]);
  assert.equal(natives(ledger).length, 0);
  assert.ok(ledger.capture.reasons.includes(REASON.nativeUnmatched));
  assert.equal(ledger.capture.nativeInventoryShortfall, 2);
});

test('a user_shell item is not an agent command; interaction and unknown sources keep their gap', async (t) => {
  const human = await slice(t, [meta, started('t1'), ask('Go.'),
    command('u1', 't1', 'git status', { source: 'user_shell' })]);
  assert.equal(natives(human).length, 0);
  assert.equal(human.ledger.length, 0);
  assert.equal(human.capture.incomplete, false);
  for (const source of ['unified_exec_interaction', undefined, 'future_source']) {
    const ledger = await slice(t, [meta, started('t1'), ask('Go.'),
      command('x1', 't1', 'node a.js', { source })]);
    assert.equal(natives(ledger).length, 0, String(source));
    assert.ok(ledger.capture.reasons.includes(REASON.nativeUnmatched), String(source));
    assert.equal(ledger.capture.incomplete, true);
  }
});

test('a failed item with a negative exit is a failed command with no exit code', async (t) => {
  const source = 'text(await tools.exec_command({cmd:"npm test"}));';
  const ledger = await slice(t, [meta, started('t1'), ask('Test.'), said('Test.', 't1'), wrapper('w1', source),
    command('i1', 't1', 'npm test', { status: 'failed', exit_code: -1, aggregated_output: '12 passed, 0 failed' }),
    wrapperOut('w1', 'x')]);
  const [native] = natives(ledger);
  assert.equal(native.exitCode, undefined, 'a sentinel is not an exit code');
  assert.equal(native.outcome, 'failed', 'readable output never overrides the typed status');
  assert.equal(native.outcomeSource, 'native');
  assert.equal(ledger.capture.incomplete, false);
  // C-01 event identity: the native command's result, found by its call (the session's command), never by turn and seq.
  const adapted = session(ledger);
  const call = adapted.events.find((e) => e.kind === 'invocation' && adapted.textOf(e, 'command') === 'npm test');
  const obs = adapted.observationFor(call.id);
  assert.deepEqual([obs.result, obs.exitCode, obs.sourceOfResult, obs.terminalStatusProven],
    ['failed', null, 'native', true]);
});

test('a completed nonzero exit fails; an untyped status or missing exit stays unknown', async (t) => {
  const source = 'text(await tools.exec_command({cmd:"node a.js"}));';
  const nonzero = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', source),
    command('i1', 't1', 'node a.js', { exit_code: 2 }), wrapperOut('w1', 'x')]);
  assert.deepEqual([natives(nonzero)[0].exitCode, natives(nonzero)[0].outcome], [2, 'failed']);
  for (const overrides of [{ status: 'declined' }, { exit_code: null }, { status: 'failed', exit_code: 0 }]) {
    const ledger = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', source),
      command('i1', 't1', 'node a.js', overrides), wrapperOut('w1', 'x')]);
    const [native] = natives(ledger);
    assert.equal(native.outcome, 'unknown', JSON.stringify(overrides));
    assert.equal(native.exitCode, undefined, JSON.stringify(overrides));
    assert.equal(native.sourceLocator.commandExecutionRecord, undefined);
    const s = session(ledger);
    assert.equal(gapsOf(s, 'observations', 'command_outcome_unknown')[0]?.count, 1, JSON.stringify(overrides));
  }
});

test('FileChange: one write or edit per change; multi-file success is proven per file', async (t) => {
  const patch = '*** Begin Patch\n*** Add File: src/a.js\n+A\n*** Update File: src/b.js\n@@\n-old\n+new\n*** End Patch';
  const source = `text(await tools.apply_patch(${JSON.stringify(patch)}));`;
  const parsed = readExecCalls(source);
  assert.deepEqual([parsed.calls.length, parsed.unsupported], [1, 0]);
  const changes = { '/repo/src/a.js': { type: 'add', content: 'A\n' },
    '/repo/src/b.js': { type: 'update', unified_diff: '@@ -1 +1 @@\n-old\n+new\n', move_path: null } };
  const rows = [meta, started('t1'), ask('Patch.'), wrapper('w1', source),
    fileChange('f1', 't1', changes), wrapperOut('w1', 'Success.')];
  const ledger = await slice(t, rows);
  const native = natives(ledger);
  const line = lineOf(rows, (r) => r.payload?.item?.id === 'f1');
  assert.deepEqual(native.map((e) => [e.kind, e.path]), [['create', 'src/a.js'], ['edit', 'src/b.js']]);
  assert.deepEqual(native.map((e) => e.result?.outcome), ['succeeded', 'succeeded']);
  assert.deepEqual(native.map((e) => e.sourceLocator.fileChangeRecord), [line, line]);
  assert.deepEqual(native.map((e) => e.sourceLocator.part), [0, 1]);
  assert.match(native[1].diff, /new/);
  assert.equal(ledger.ledger.filter((e) => ['create', 'edit', 'delete'].includes(e.kind)).length, 2,
    'the parsed apply_patch is not emitted beside the native item');
  assert.equal(ledger.capture.nativeInventoryShortfall, 0);
  assert.equal(ledger.capture.incomplete, false);
  const s = session(ledger);
  const proven = s.events.filter((e) => e.kind === 'observation' && e.terminalStatusProven === true);
  assert.equal(proven.length, 2);
  assert.deepEqual(gapsOf(s, 'observations', 'write_outcome_unknown'), []);

  const failedMulti = await slice(t, [meta, started('t1'), ask('Patch.'), wrapper('w1', source),
    fileChange('f1', 't1', changes, { status: 'failed' }), wrapperOut('w1', 'x')]);
  assert.deepEqual(natives(failedMulti).map((e) => e.result?.outcome), ['unknown', 'unknown']);
  assert.equal(gapsOf(session(failedMulti), 'observations', 'write_outcome_unknown')[0]?.count, 2);

  const one = { '/repo/src/b.js': changes['/repo/src/b.js'] };
  const failedSingle = await slice(t, [meta, started('t1'), ask('Patch.'),
    wrapper('w1', `text(await tools.apply_patch(${JSON.stringify('*** Begin Patch\n*** Update File: src/b.js\n@@\n-old\n+new\n*** End Patch')}));`),
    fileChange('f1', 't1', one, { status: 'failed' }), wrapperOut('w1', 'x')]);
  const [failed] = natives(failedSingle);
  assert.equal(failed.result?.outcome, 'failed');
  assert.equal(failed.attempted, 'edit');
  const obs = session(failedSingle).events.filter((e) => e.kind === 'observation' && e.terminalStatusProven === true
    && e.result === 'failed');
  assert.equal(obs.length, 1);
});

test('an McpToolCall item is a generic tool action with its own recorded result', async (t) => {
  const source = 'text(await tools.mcp__catalog__inspect({query:"q"}));';
  const ledger = await slice(t, [meta, started('t1'), ask('Look.'), wrapper('w1', source),
    mcp('m1', 't1'), wrapperOut('w1', 'CATALOG RESULT')]);
  const [native] = natives(ledger);
  assert.equal(native.tool, 'mcp__catalog__inspect');
  assert.equal(native.genericTool, true);
  assert.equal(native.argsExcerpt, JSON.stringify({ query: 'q' }));
  assert.deepEqual(native.tailLines, ['CATALOG RESULT']);
  assert.equal(ledger.ledger.filter((e) => e.tool === 'mcp__catalog__inspect').length, 1);
  assert.equal(ledger.capture.nativeInventoryShortfall, 0);
  assert.equal(ledger.capture.incomplete, false);
});

test('a direct call joined by its exact id keeps the direct join and is not duplicated', async (t) => {
  const rows = [meta, started('t1'), ask('Build.'), direct('functions.exec_command', 'c1', { cmd: 'node build.js' }),
    command('c1', 't1', 'node build.js'), directOut('c1', 'visible output')];
  const ledger = await slice(t, rows);
  assert.equal(ledger.ledger.length, 1);
  assert.equal(natives(ledger).length, 0);
  assert.equal(ledger.ledger[0].exitCode, 0);
  assert.equal(ledger.ledger[0].sourceLocator.commandExecutionRecord, lineOf(rows, (r) => r.payload?.item?.id === 'c1'));
  assert.equal(ledger.capture.nativeItems, 0);
  assert.equal(ledger.capture.incomplete, false);
});

test('other parsed inner tools keep today\'s handling beside the cell', async (t) => {
  const source = 'text(await tools.view_image({path:"a.png"})); text(await tools.exec_command({cmd:"node a.js"}));';
  const ledger = await slice(t, [meta, started('t1'), ask('Look.'), wrapper('w1', source),
    command('i1', 't1', 'node a.js'), wrapperOut('w1', 'IMAGE TEXT', 'a')]);
  assert.deepEqual(ledger.ledger.map((e) => e.tool ?? e.cmd), ['exec', 'view_image', 'node a.js']);
  const image = ledger.ledger[1];
  assert.equal(image.sourceLocator.part, 1, 'the cell is part 0 of the wrapper row');
  assert.deepEqual(image.tailLines, ['IMAGE TEXT']);
  assert.equal(ledger.capture.nativeInventoryShortfall, 0);
});

test('a wrapper poll of its own command is not emitted, and keeps its unmatched-poll gap (refreeze)', async (t) => {
  // The wrapper emits only the command's output text, so no typed session_id is attributed to it
  // and nothing registered session 7: the poll joins none (legacy parity, never a silent join).
  // A typed emission registers the session although the parsed call is not emitted (lane g3,
  // m33-native-polls-counters.test.js).
  const source = 'const s = await tools.exec_command({cmd:"node serve.js", yield_time_ms: 10}); text(s.output); '
    + 'text(await tools.write_stdin({session_id: 7, chars: ""}));';
  assert.equal(readExecCalls(source).unsupported, 0);
  const ledger = await slice(t, [meta, started('t1'), ask('Serve.'), wrapper('w1', source),
    command('i1', 't1', 'node serve.js'), wrapperOut('w1', 'listening', 'done')]);
  assert.equal(natives(ledger).length, 1);
  assert.equal(ledger.ledger.filter((e) => e.tool === 'write_stdin').length, 0, 'the poll is not an action');
  assert.equal(ledger.capture.reasons.includes(REASON.pollUnmatched), true);
  assert.equal(ledger.capture.nativeInventoryShortfall, 0, 'the command inventory itself balances');
  assert.equal(ledger.capture.incomplete, true);
});

test('a wrapper without one exact turn, or one that did not complete, cannot prove its turn', async (t) => {
  const source = 'text(await tools.exec_command({cmd:"node a.js"}));';
  // No task_started row: the wrapper has no exact turn, and the item's turn has no wrapper.
  const noTurn = await slice(t, [meta, agentMessage('m0', 't1'), ask('Go.'), wrapper('w1', source),
    command('i1', 't1', 'node a.js'), wrapperOut('w1', 'a')]);
  assert.equal(natives(noTurn).length, 1);
  assert.equal(noTurn.capture.nativeInventoryShortfall, 2, 'the unplaced call and the unpredicted item');
  // A turn context naming another turn leaves the following wrapper without an exact turn.
  const moved = await slice(t, [meta, started('t1'), { type: 'turn_context', payload: { cwd: '/repo', turn_id: 't2' } },
    ask('Go.'), wrapper('w1', source), command('i1', 't1', 'node a.js'), wrapperOut('w1', 'a')]);
  assert.ok(moved.capture.nativeInventoryShortfall > 0);
  // A failed script proves no dispatch; its turn is incomplete even with a matching item.
  const failed = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', source),
    command('i1', 't1', 'node a.js'),
    item({ type: 'custom_tool_call_output', call_id: 'w1', output: [{ type: 'input_text', text: 'Script failed' }] })]);
  assert.equal(natives(failed).length, 1);
  assert.ok(failed.capture.reasons.includes(INVENTORY));
  // A repeated-key output row supplies no cell observation and no completion proof.
  const repeated = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', source),
    command('i1', 't1', 'node a.js'),
    '{"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"w1","output":'
      + '[{"type":"input_text","text":"Script completed"}],"output":[{"type":"input_text","text":"Script completed"}]}}']);
  assert.equal(cells(repeated)[0].tailLines, undefined);
  assert.ok(repeated.capture.unmapped > 0);
  assert.ok(repeated.capture.reasons.includes(INVENTORY));
});

test('a syntax-invalid wrapper keeps its own reason and leaves its turn unproved (refreeze)', async (t) => {
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'), agentMessage('m1', 't1'),
    wrapper('w1', 'tools.exec_command({cmd:"x"}'),
    item({ type: 'custom_tool_call_output', call_id: 'w1', output: [{ type: 'input_text', text: 'Script failed' }] })]);
  assert.ok(ledger.capture.reasons.includes(REASON.syntaxInvalid));
  assert.ok(ledger.capture.reasons.includes(INVENTORY), 'not parsed exactly: the turn inventory is unproved');
  assert.ok(ledger.capture.nativeInventoryShortfall > 0);
  assert.equal(cells(ledger).length, 1, 'the call itself is still a recorded code-cell action');
  assert.equal(natives(ledger).length, 0, 'no unknown inner command is invented for it');
});

test('an item carrying another recorded call ID is never a separate native action', async (t) => {
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'),
    wrapper('w1', 'text(await tools.exec_command({cmd:"node a.js"}));'),
    command('w1', 't1', 'node a.js'), wrapperOut('w1', 'a')]);
  assert.equal(natives(ledger).length, 0);
  assert.ok(ledger.capture.reasons.includes(REASON.nativeUnmatched));
  assert.ok(ledger.capture.reasons.includes(INVENTORY));
});

test('a conflicting replay of the wrapper output retracts the cell observation', async (t) => {
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', TWO),
    command('i1', 't1', 'node build.js'), command('i2', 't1', 'node lint.js'),
    wrapperOut('w1', 'a', 'b'), wrapperOut('w1', 'different')]);
  assert.equal(cells(ledger)[0].tailLines, undefined);
  assert.ok(ledger.capture.reasons.includes(REASON.identity));
  assert.ok(ledger.capture.reasons.includes(INVENTORY));
  assert.deepEqual(natives(ledger).map((e) => e.exitCode), [0, 0], 'native items do not depend on the wrapper');
});

test('a legacy recording without the paginated item stream is unchanged', async (t) => {
  const source = 'text(await tools.exec_command({cmd:"node build.js"}));';
  const legacyItem = event({ type: 'item_completed', thread_id: OWN, item: {
    id: 'inner', type: 'CommandExecution', status: 'completed', source: 'unified_exec_startup',
    command: ['/bin/zsh', '-lc', 'node build.js'], cwd: 'file:///repo', exit_code: 0 } });
  const ledger = await slice(t, [meta, ask('Build.'), wrapper('w1', source), legacyItem,
    item({ type: 'custom_tool_call_output', call_id: 'w1', output: [{ type: 'input_text', text: 'Script completed' },
      { type: 'input_text', text: 'built' }] })]);
  assert.equal(natives(ledger).length, 0);
  assert.equal(cells(ledger).length, 0);
  assert.deepEqual(ledger.ledger.map((e) => e.cmd), ['node build.js'], 'the parsed inner call is the action');
  assert.equal(ledger.ledger[0].exitCode, undefined, 'a wrapper never borrows the native status');
  assert.ok(ledger.capture.reasons.includes(REASON.nativeUnmatched));
  for (const key of ['nativeItems', 'nativeInventoryShortfall', 'nativeCommandShortfall', 'nativeWriteShortfall',
    'nativeInventoryGaps']) assert.equal(Object.hasOwn(ledger.capture, key), false, key);
});

test('native command text and output pass through redaction and fail closed', async (t) => {
  const V = ['hunt', 'er2', 'xW3e7'].join('');
  const script = `export API_TOKEN=${V} && node build.js`;
  const ledger = await slice(t, [meta, started('t1'), ask('Build.'),
    wrapper('w1', `text(await tools.exec_command({cmd:${JSON.stringify(script)}}));`),
    command('i1', 't1', script, { aggregated_output: `password=${V}\nok` }), wrapperOut('w1', 'ok')]);
  assert.equal(natives(ledger).length, 1);
  const clean = redact(ledger);
  const [native] = clean.ledger.ledger.filter((e) => e.provenance === NATIVE);
  assert.equal(JSON.stringify(native).includes(V), false);
  assert.equal(JSON.stringify(clean.ledger).includes(V), false);
  assert.ok(clean.dropped.some((d) => d.where === 'cmd'));
  assert.ok(clean.dropped.some((d) => d.where === 'tailLines'));
});

test('the same recording slices to the same bytes twice', async (t) => {
  const file = await fixture(t, [meta, started('t1'), ask('Go.'), wrapper('w1', TWO),
    command('i1', 't1', 'node build.js'), command('i2', 't1', 'node lint.js'),
    fileChange('f1', 't1', { '/repo/src/a.js': { type: 'add', content: 'A\n' } }),
    mcp('m1', 't1'), wrapperOut('w1', 'a', 'b'), complete('t1')]);
  const once = await sliceLineage([file]);
  const first = JSON.stringify(once);
  const second = JSON.stringify(await sliceLineage([file]));
  assert.equal(first, second);
  assert.equal(natives(once).length, 4, 'two commands, one file change and one MCP call');
});
