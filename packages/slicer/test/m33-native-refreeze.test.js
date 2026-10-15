// C-02 "M33 native-first refreeze". A wrapper "parsed exactly" only when it is not syntax-invalid,
// has no unsupported statement, and names no dynamic dispatch route and no `tools` reference other
// than a direct `tools.<name>(` call; otherwise its turn's inventory is unproved. A `write_stdin`
// whose session_id joins no registered command keeps its unmatched-poll gap in every mode. A
// `failed` item with exit 0 leaves the outcome unknown. Synthetic rollouts only; no model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { readExecCalls, CODEX_CAPTURE_REASONS as REASON } from '../src/codex-exec.js';

const OWN = 'thread-own';
const meta = { type: 'session_meta', payload: { id: OWN, cwd: '/repo' } };
const item = (payload) => ({ type: 'response_item', payload });
const event = (payload) => ({ type: 'event_msg', payload });
const started = (turn) => event({ type: 'task_started', turn_id: turn, model_context_window: 1 });
const complete = (turn) => event({ type: 'task_complete', turn_id: turn, last_agent_message: null });
const ask = (text) => item({ type: 'message', role: 'user', content: text });
const agentMessage = (id, turn) => event({ type: 'item_completed', thread_id: OWN, turn_id: turn,
  item: { id, type: 'AgentMessage' } });
const wrapper = (callId, source) => item({ type: 'custom_tool_call', name: 'exec', call_id: callId, input: source });
const wrapperOut = (callId, ...texts) => item({ type: 'custom_tool_call_output', call_id: callId,
  output: ['Script completed', ...texts].map((text) => ({ type: 'input_text', text })) });
const direct = (name, callId, input) => item({ type: 'function_call', name, call_id: callId,
  arguments: JSON.stringify(input) });
const directOut = (callId, output) => item({ type: 'function_call_output', call_id: callId, output });
const command = (id, turn, script, overrides = {}) => event({ type: 'item_completed', thread_id: OWN, turn_id: turn,
  item: { id, type: 'CommandExecution', status: 'completed', source: 'unified_exec_startup',
    command: ['/bin/zsh', '-lc', script], cwd: 'file:///repo', exit_code: 0, stdout: '', stderr: '',
    aggregated_output: `${script} ran`, formatted_output: '', parsed_cmd: [], process_id: '4242',
    duration: { secs: 0, nanos: 1 }, ...overrides } });

async function slice(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-refreeze-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-09-29T10-00-00-synthetic.jsonl');
  await writeFile(file, rows.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  return sliceLineage([file]);
}
const natives = (ledger) => ledger.ledger.filter((e) => e.provenance === 'codex_native_item');
const B = 'text(await tools.exec_command({cmd:"node b.js"}));';

test('readExecCalls reports inventory exactness: a direct awaited tools.<name>( grammar only', () => {
  for (const source of [
    B,
    'text(await tools.exec_command({cmd:"node b.js"})); text(await tools.apply_patch("*** Begin Patch\\n*** End Patch"));',
    // A route name inside a string literal or a comment names nothing the script runs.
    'text(await tools.exec_command({cmd:"node -e \'require(1); eval(2); globalThis.x\'"}));',
    '// globalThis, eval, Reflect and self are only mentioned here\ntext(await tools.exec_command({cmd:"node b.js"}));',
    'const results = await Promise.allSettled([tools.exec_command({cmd:"a"}), tools.exec_command({cmd:"b"})]); text(results);',
  ]) assert.equal(readExecCalls(source).inventoryExact, true, source);
  for (const source of [
    'text(await globalThis.tools.exec_command({cmd:"node x.js"}));',
    'text(await self.tools.exec_command({cmd:"node x.js"}));',
    'text(await window.tools.exec_command({cmd:"node x.js"}));',
    'text(await global.tools.exec_command({cmd:"node x.js"}));',
    'await eval(\'tools.exec_command({cmd:"node x.js"})\'); text("ok");',
    'await (new Function("t", "return t.exec_command({cmd:\\"node x.js\\"})"))(tools); text("ok");',
    'text(await Reflect.apply(Reflect.get(globalThis, "tools").exec_command, null, [{cmd:"x"}]));',
    'const p = new Proxy({}, {}); text(await tools.exec_command({cmd:"a"}));',
    'const m = await import("data:text/javascript,export default 1"); text("ok");',
    'const cp = require("child_process"); text("ok");',
    'text(await globalThis["tools"].exec_command({cmd:"node x.js"}));',
    'text(await tools?.exec_command({cmd:"node x.js"}));',
    'const t = tools; text(await t.exec_command({cmd:"x"}));',
    'text(await tools["exec_command"]({cmd:"x"}));',
    'text(`${await tools.exec_command({cmd:"x"})}`);',
    'text(`${globalThis.x}`); text(await tools.exec_command({cmd:"a"}));',
    // A statement the reader rejects without naming `tools` (an unbound call) is unsupported.
    'foo(); text(await tools.exec_command({cmd:"a"}));',
    'text(await tools.exec_command({cmd:"a"})); if (true) { text("x"); }',
    // Unawaited: dispatched, but not proved reached in order.
    'tools.exec_command({cmd:"a"}); text("x");',
    // Syntax-invalid by the conservative screen (valid JS: `return` as a property key) and truly invalid.
    'const r = await tools.exec_command({cmd:"node a.js"}); text(JSON.stringify({return: r.exit_code}));',
    'tools.exec_command({cmd:"x"}',
  ]) assert.equal(readExecCalls(source).inventoryExact, false, source);
});

test('a dynamic dispatch wrapper cannot balance another wrapper\'s missing native item', async (t) => {
  for (const w1 of [
    'text(await globalThis.tools.exec_command({cmd:"node x.js"}));',
    'text(await self.tools.exec_command({cmd:"node x.js"}));',
    'await eval(\'tools.exec_command({cmd:"node x.js"})\'); text("x ran");',
    'text(await Reflect.apply(Reflect.get(globalThis, "tools").exec_command, null, [{cmd:"node x.js"}]));',
  ]) {
    const ledger = await slice(t, [meta, started('t1'), ask('Go.'),
      wrapper('w1', w1), command('i1', 't1', 'node x.js'), wrapperOut('w1', 'x ran'),
      wrapper('w2', B), /* node b.js dispatched; no execution item recorded */ wrapperOut('w2', 'b ran'),
      complete('t1')]);
    assert.ok(ledger.capture.nativeInventoryShortfall > 0, w1);
    // Lane g3 split: P = N here, so no command is unaccounted for; the unproved turn's loss is
    // the inventory gap alone (max(P - N, 1) per family), never an outcome gap it cannot name.
    assert.equal(ledger.capture.nativeCommandShortfall, 0, w1);
    assert.ok(ledger.capture.reasons.includes(REASON.nativeInventory), w1);
    assert.equal(ledger.capture.incomplete, true, w1);
  }
});

test('a rejected statement that never names tools still leaves its turn unproved', async (t) => {
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'),
    wrapper('w1', 'foo(); text("ok");'), command('i1', 't1', 'node x.js'), wrapperOut('w1', 'ok'),
    wrapper('w2', B), wrapperOut('w2', 'b ran'), complete('t1')]);
  assert.ok(ledger.capture.nativeInventoryShortfall > 0);
  assert.equal(ledger.capture.nativeCommandShortfall, 0, 'lane g3 split: P = N counts no command');
  assert.equal(ledger.capture.incomplete, true);
});

test('a syntax-invalid wrapper leaves its turn unproved, whatever its output says', async (t) => {
  const misjudged = 'const r = await tools.exec_command({cmd:"node a.js"}); text(JSON.stringify({return: r.exit_code}));';
  assert.equal(readExecCalls(misjudged).syntaxInvalid, true);
  const completed = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', misjudged),
    command('i1', 't1', 'node a.js'), wrapperOut('w1', '{"return":0}'),
    wrapper('w2', 'text(await tools.exec_command({cmd:"node b.js"}));'), wrapperOut('w2', 'b'), complete('t1')]);
  assert.ok(completed.capture.nativeInventoryShortfall > 0, 'the misjudged script ran: N === P proves nothing');
  assert.equal(completed.capture.nativeCommandShortfall, 0, 'lane g3 split: P = N counts no command');
  assert.ok(completed.capture.reasons.includes(REASON.syntaxInvalid));
  assert.ok(completed.capture.reasons.includes(REASON.nativeInventory));
  const failed = await slice(t, [meta, started('t1'), ask('Go.'), agentMessage('m1', 't1'),
    wrapper('w1', 'tools.exec_command({cmd:"x"}'),
    item({ type: 'custom_tool_call_output', call_id: 'w1', output: [{ type: 'input_text', text: 'Script failed' }] })]);
  assert.ok(failed.capture.reasons.includes(REASON.syntaxInvalid));
  assert.ok(failed.capture.nativeInventoryShortfall > 0);
  assert.equal(failed.capture.incomplete, true);
});

test('an exact turn still balances: the refreeze adds no gap to a proved inventory', async (t) => {
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', B),
    command('i1', 't1', 'node b.js'), wrapperOut('w1', 'b ran'), complete('t1')]);
  assert.equal(natives(ledger).length, 1);
  assert.equal(ledger.capture.nativeInventoryShortfall, 0);
  assert.equal(ledger.capture.incomplete, false);
  assert.deepEqual(ledger.capture.reasons, []);
});

test('legacy: a failed statement naming tools as a member still declares an unsupported action', async (t) => {
  for (const source of ['text(await globalThis.tools.exec_command({cmd:"make deploy"}));',
    'text(await self.tools.exec_command({cmd:"make deploy"}));']) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0, source);
    assert.ok(parsed.unsupported > 0, source);
    const ledger = await slice(t, [meta, ask('Deploy.'), wrapper('w1', source), wrapperOut('w1', 'done')]);
    assert.equal(ledger.capture.incomplete, true, source);
    assert.ok(ledger.capture.reasons.includes(REASON.unsupported), source);
  }
});

test('paginated: a wrapper poll whose session joins no registered command keeps its unmatched-poll gap', async (t) => {
  const poll = 'text(await tools.write_stdin({session_id: 99, chars: "y\\n"}));';
  const legacy = await slice(t, [meta, ask('Answer.'), wrapper('w1', poll), wrapperOut('w1', 'ok')]);
  const paginated = await slice(t, [meta, started('t1'), ask('Answer.'), agentMessage('m1', 't1'),
    wrapper('w1', poll), wrapperOut('w1', 'ok'), complete('t1')]);
  for (const ledger of [legacy, paginated]) {
    assert.ok(ledger.capture.reasons.includes(REASON.pollUnmatched));
    assert.ok(ledger.capture.reasons.includes(REASON.unmapped));
    assert.ok(ledger.capture.unmapped > 0);
    assert.ok(ledger.capture.unsupported > 0);
    assert.equal(ledger.capture.incomplete, true);
  }
  assert.equal(paginated.capture.unmapped, legacy.capture.unmapped, 'legacy parity');
  assert.equal(paginated.capture.unsupported, legacy.capture.unsupported, 'legacy parity');
  // A direct poll of an unregistered session is unmatched in both modes too.
  const directPoll = await slice(t, [meta, started('t1'), ask('Answer.'), agentMessage('m1', 't1'),
    direct('write_stdin', 'p1', { session_id: 99, chars: '' }), directOut('p1', 'ok')]);
  assert.ok(directPoll.capture.reasons.includes(REASON.pollUnmatched));
  // A poll whose typed session joins a registered direct command is joined, not unmatched.
  const joined = await slice(t, [meta, started('t1'), ask('Serve.'), agentMessage('m1', 't1'),
    direct('exec_command', 'c1', { cmd: 'node serve.js' }),
    directOut('c1', 'Wall time: 0.1 seconds\nProcess running with session ID 7\nOutput:\nlistening'),
    wrapper('w1', 'text(await tools.write_stdin({session_id: 7, chars: ""}));'), wrapperOut('w1', 'more'),
    complete('t1')]);
  assert.equal(joined.capture.reasons.includes(REASON.pollUnmatched), false);
});

test('a failed item with exit 0 is contradictory: its outcome stays unknown', async (t) => {
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', B),
    command('i1', 't1', 'node b.js', { status: 'failed', exit_code: 0 }), wrapperOut('w1', 'x')]);
  const [native] = natives(ledger);
  assert.equal(native.outcome, 'unknown');
  assert.equal(native.exitCode, undefined);
  assert.equal(native.sourceLocator.commandExecutionRecord, undefined);
});
