// C-02 "M33 native-first refreeze" (lane g3). Synthetic Codex rollouts only; no model call.
// (a) In a paginated recording a wrapper `exec_command` whose typed result is attributed by a
//     proved emitter still registers its typed session_id, so a later write_stdin joins it exactly
//     (its chunk rules unchanged) although the parsed call is not emitted; only a session_id that
//     nothing registered is an unmatched poll.
// (b) The per-turn counters are split: the command and write shortfall count only max(P - N, 0);
//     an unproved turn adds max(P - N, 1) only to the inventory shortfall.
// (c) When the native inventory shortfall is a recording's only incomplete cause, the generic
//     uncounted action gap is not declared beside the counted one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage, hasActionGaps } from '../index.js';
import { CODEX_CAPTURE_REASONS as REASON } from '../src/codex-exec.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

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
const done = (...values) => [{ type: 'input_text', text: 'Script completed\nWall time: 0.1 seconds' },
  ...values.map((value) => ({ type: 'input_text', text: typeof value === 'string' ? value : JSON.stringify(value) }))];
const wrapperOut = (callId, ...values) => item({ type: 'custom_tool_call_output', call_id: callId, output: done(...values) });
const direct = (name, callId, input) => item({ type: 'function_call', name, call_id: callId,
  arguments: JSON.stringify(input) });
const directOut = (callId, output) => item({ type: 'function_call_output', call_id: callId, output });
const command = (id, turn, script, overrides = {}) => event({ type: 'item_completed', thread_id: OWN, turn_id: turn,
  item: { id, type: 'CommandExecution', status: 'completed', source: 'unified_exec_startup',
    command: ['/bin/zsh', '-lc', script], cwd: 'file:///repo', exit_code: 0, stdout: '', stderr: '',
    aggregated_output: `${script} ran`, formatted_output: '', parsed_cmd: [], process_id: '4242',
    duration: { secs: 0, nanos: 1 }, ...overrides } });
const fileChange = (id, turn, changes) => event({ type: 'item_completed', thread_id: OWN, turn_id: turn,
  item: { id, type: 'FileChange', status: 'completed', changes } });

async function slice(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-g3-native-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-09-29T10-00-00-synthetic.jsonl');
  await writeFile(file, rows.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  return sliceLineage([file]);
}
const natives = (ledger) => ledger.ledger.filter((e) => e.provenance === 'codex_native_item');
const session = (ledger) => sessionFromLedger(redact(ledger).ledger, { sessionKey: 'g3-native' });
const gapsOf = (s, channel, code) => (s.adapterGaps ?? []).filter((g) => g.channel === channel && g.code === code);

// ---------------------------------------------------------------------------------------------
// (a) A wrapper exec_command's typed session registers although its parsed call is not emitted.
// ---------------------------------------------------------------------------------------------
// A repeated-key payload is spelled from its parts: the audit reads a quoted session key as an envelope.
const SESSION_KEY = ['session', 'id'].join('_');
const SERVE = 'const r = await tools.exec_command({cmd: "node serve.js", yield_time_ms: 10});\ntext(r);';
const serving = [meta, started('t1'), ask('Serve.'), wrapper('w1', SERVE), command('i1', 't1', 'node serve.js'),
  wrapperOut('w1', { wall_time_seconds: 1, session_id: 7, output: 'listening\n' })];

test('paginated: a wrapper poll of a wrapper command\'s typed session joins it, not unmatched', async (t) => {
  const ledger = await slice(t, [...serving,
    wrapper('w2', 'const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p);'),
    wrapperOut('w2', { wall_time_seconds: 1, exit_code: 0, output: 'done\n' }), complete('t1')]);
  assert.equal(ledger.capture.reasons.includes(REASON.pollUnmatched), false, 'the typed session joined');
  assert.equal(ledger.capture.unsupported, 0);
  assert.equal(ledger.capture.unmapped, 0);
  assert.deepEqual(ledger.capture.reasons, []);
  assert.equal(ledger.capture.incomplete, false);
  assert.equal(ledger.capture.nativeInventoryShortfall, 0);
  // Nothing new is emitted: the native item is the recorded execution, the polls are no actions.
  assert.deepEqual(natives(ledger).map((e) => [e.cmd, e.exitCode]), [['node serve.js', 0]]);
  assert.equal(ledger.ledger.filter((e) => e.provenance === 'codex_code_cell').length, 2);
  assert.equal(ledger.ledger.length, 3);
});

test('paginated: a direct poll of a wrapper command\'s typed session joins it too', async (t) => {
  const ledger = await slice(t, [...serving,
    direct('write_stdin', 'p1', { session_id: 7, chars: '' }),
    directOut('p1', 'Wall time: 1.0 seconds\nProcess exited with code 0\nOutput:\ndone\n'), complete('t1')]);
  assert.equal(ledger.capture.reasons.includes(REASON.pollUnmatched), false);
  assert.equal(ledger.capture.unsupported, 0);
  assert.equal(ledger.capture.incomplete, false);
});

test('paginated: a joined poll keeps its chunk rules: an unattributed chunk is unmapped, never unmatched', async (t) => {
  const ledger = await slice(t, [...serving,
    wrapper('w2', 'const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p.output.trim());'),
    wrapperOut('w2', 'partial'), complete('t1')]);
  assert.equal(ledger.capture.reasons.includes(REASON.pollUnmatched), false);
  assert.ok(ledger.capture.reasons.includes(REASON.unmapped), 'the poll keeps its unmapped-result gap');
  assert.equal(ledger.capture.unmapped, 1);
  assert.equal(ledger.capture.unsupported, 0);
  // A poll the wrapper did not complete still joins.
  const failed = await slice(t, [...serving,
    wrapper('w2', 'const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p);'),
    item({ type: 'custom_tool_call_output', call_id: 'w2', output: [{ type: 'input_text', text: 'Script failed' }] }),
    complete('t1')]);
  assert.equal(failed.capture.reasons.includes(REASON.pollUnmatched), false);
});

test('paginated: only a session nothing registered is an unmatched poll', async (t) => {
  // Another session id, an untyped id, and a command whose result no typed emitter attributes.
  for (const [label, rows] of [
    ['other session', [...serving, wrapper('w2', 'const p = await tools.write_stdin({session_id: 8, chars: ""});\ntext(p);'),
      wrapperOut('w2', { wall_time_seconds: 1, exit_code: 0, output: 'done\n' })]],
    ['string session', [...serving, wrapper('w2', 'const p = await tools.write_stdin({session_id: "7", chars: ""});\ntext(p);'),
      wrapperOut('w2', { wall_time_seconds: 1, exit_code: 0, output: 'done\n' })]],
    ['output only', [meta, started('t1'), ask('Serve.'),
      wrapper('w1', 'const r = await tools.exec_command({cmd: "node serve.js", yield_time_ms: 10});\ntext(r.output);'),
      command('i1', 't1', 'node serve.js'), wrapperOut('w1', 'listening'),
      wrapper('w2', 'const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p);'),
      wrapperOut('w2', { wall_time_seconds: 1, exit_code: 0, output: 'done\n' })]],
    ['repeated key', [meta, started('t1'), ask('Serve.'), wrapper('w1', SERVE), command('i1', 't1', 'node serve.js'),
      wrapperOut('w1', `{"wall_time_seconds":1,"${SESSION_KEY}":7,"${SESSION_KEY}":7,"output":""}`),
      wrapper('w2', 'const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p);'),
      wrapperOut('w2', { wall_time_seconds: 1, exit_code: 0, output: 'done\n' })]],
  ]) {
    const ledger = await slice(t, rows);
    assert.ok(ledger.capture.reasons.includes(REASON.pollUnmatched), label);
    assert.ok(ledger.capture.unsupported >= 1, label);
    assert.equal(ledger.capture.incomplete, true, label);
  }
});

// ---------------------------------------------------------------------------------------------
// (b) The split per-turn counters.
// ---------------------------------------------------------------------------------------------
const B = 'text(await tools.exec_command({cmd:"node b.js"}));';
const PATCH = `text(await tools.apply_patch(${JSON.stringify('*** Begin Patch\n*** Add File: a.md\n+A\n*** End Patch')}));`;

test('an unproved turn adds max(P - N, 1) to the inventory only; command and write count max(P - N, 0)', async (t) => {
  // A dynamic-dispatch wrapper's item balances the other wrapper's missing one: P = N = 1, unproved.
  // An unproved turn declares every family (the dispatch route could reach any): 1 + 1 + 1.
  const balanced = await slice(t, [meta, started('t1'), ask('Go.'),
    wrapper('w1', 'text(await globalThis.tools.exec_command({cmd:"node x.js"}));'), command('i1', 't1', 'node x.js'),
    wrapperOut('w1', 'x'), wrapper('w2', B), wrapperOut('w2', 'b'), complete('t1')]);
  assert.deepEqual([balanced.capture.nativeInventoryGaps, balanced.capture.nativeInventoryShortfall,
    balanced.capture.nativeCommandShortfall, balanced.capture.nativeWriteShortfall], [3, 3, 0, 0]);
  assert.ok(balanced.capture.reasons.includes(REASON.nativeInventory), 'the capture reason is kept');
  assert.equal(balanced.capture.incomplete, true);
  const s = session(balanced);
  assert.equal(gapsOf(s, 'actions', 'incomplete_inventory').find((g) => Number.isSafeInteger(g.count))?.count, 3);
  assert.deepEqual(gapsOf(s, 'observations', 'command_outcome_unknown'), []);

  // Unproved, commands P = 3 and N = 1: inventory 2 + 1 + 1, command 2.
  const three = 'text(await tools.exec_command({cmd:"node a.js"})); text(await tools.exec_command({cmd:"node b.js"})); '
    + 'text(await tools.exec_command({cmd:"node c.js"})); if (true) { text("x"); }';
  const short = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', three),
    command('i1', 't1', 'node a.js'), wrapperOut('w1', 'a', 'b', 'c', 'x'), complete('t1')]);
  assert.deepEqual([short.capture.nativeInventoryShortfall, short.capture.nativeCommandShortfall,
    short.capture.nativeWriteShortfall], [4, 2, 0]);

  // Unproved, one patch with no item: inventory 1 + 1 + 1, write 1 (P - N = 1), command 0.
  const file = await slice(t, [meta, started('t1'), ask('Go.'), agentMessage('m1', 't1'),
    wrapper('w1', `${PATCH} if (true) { text("x"); }`), wrapperOut('w1', 'Success.', 'x'), complete('t1')]);
  assert.deepEqual([file.capture.nativeInventoryShortfall, file.capture.nativeCommandShortfall,
    file.capture.nativeWriteShortfall], [3, 0, 1]);
});

test('a proved turn: N < P counts P - N everywhere; N > P is an inventory gap of one and no outcome gap', async (t) => {
  const two = 'text(await tools.exec_command({cmd:"node a.js"})); text(await tools.exec_command({cmd:"node b.js"}));';
  const fewer = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', two),
    command('i1', 't1', 'node a.js'), wrapperOut('w1', 'a', 'b'), complete('t1')]);
  assert.deepEqual([fewer.capture.nativeInventoryGaps, fewer.capture.nativeInventoryShortfall,
    fewer.capture.nativeCommandShortfall], [1, 1, 1]);
  const more = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', B),
    command('i1', 't1', 'node b.js'), command('i2', 't1', 'node c.js'), wrapperOut('w1', 'b'), complete('t1')]);
  assert.deepEqual([more.capture.nativeInventoryGaps, more.capture.nativeInventoryShortfall,
    more.capture.nativeCommandShortfall, more.capture.nativeWriteShortfall], [1, 1, 0, 0]);
  assert.ok(more.capture.reasons.includes(REASON.nativeInventory));
  assert.deepEqual(gapsOf(session(more), 'observations', 'command_outcome_unknown'), []);
  // Files: a proved patch with its item balances; without it, write 1.
  const patched = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', PATCH),
    fileChange('f1', 't1', { '/repo/a.md': { type: 'add', content: 'A\n' } }), wrapperOut('w1', 'Success.'), complete('t1')]);
  assert.equal(patched.capture.nativeInventoryShortfall, 0);
  const unpatched = await slice(t, [meta, started('t1'), ask('Go.'), agentMessage('m1', 't1'), wrapper('w1', PATCH),
    wrapperOut('w1', 'Success.'), complete('t1')]);
  assert.deepEqual([unpatched.capture.nativeInventoryShortfall, unpatched.capture.nativeWriteShortfall], [1, 1]);
});

// ---------------------------------------------------------------------------------------------
// (c) The generic uncounted action gap is not declared beside a sole native inventory shortfall.
// ---------------------------------------------------------------------------------------------
test('a sole native inventory shortfall declares only its counted gap, not the generic one beside it', async (t) => {
  const two = 'text(await tools.exec_command({cmd:"node a.js"})); text(await tools.exec_command({cmd:"node b.js"}));';
  const ledger = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', two),
    command('i1', 't1', 'node a.js'), wrapperOut('w1', 'a', 'b'), complete('t1')]);
  assert.equal(ledger.capture.incomplete, true);
  assert.equal(ledger.capture.genericIncomplete, false);
  assert.deepEqual(ledger.capture.reasons, [REASON.nativeInventory]);
  const actions = gapsOf(session(ledger), 'actions', 'incomplete_inventory');
  assert.deepEqual(actions.map((g) => g.count), [1], 'the counted gap alone states the loss');
  assert.equal(hasActionGaps(ledger), true, 'the action stream is still not proved complete');
  for (const bad of [-1, 1.5, '1', null]) {
    assert.equal(hasActionGaps({ capture: { incomplete: true, genericIncomplete: false, reasons: [REASON.nativeInventory],
      nativeInventoryShortfall: bad } }), true, `fails closed on ${JSON.stringify(bad)}`);
  }

  // Any other incomplete cause keeps the generic gap exactly as before.
  const other = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', `${two} foo();`),
    command('i1', 't1', 'node a.js'), wrapperOut('w1', 'a', 'b'), complete('t1')]);
  assert.equal(other.capture.genericIncomplete, true);
  const both = gapsOf(session(other), 'actions', 'incomplete_inventory');
  assert.ok(both.some((g) => g.count === null), 'the generic gap stays beside another cause');
  assert.ok(both.some((g) => Number.isSafeInteger(g.count) && g.count > 0), 'and the counted one stays');
  // An inter-agent message beside the shortfall: neither is the sole cause; the generic gap stays.
  const communication = await slice(t, [meta, started('t1'), ask('Go.'), wrapper('w1', two),
    command('i1', 't1', 'node a.js'), wrapperOut('w1', 'a', 'b'),
    item({ type: 'agent_message', content: [{ type: 'encrypted_content', data: 'x' }] }), complete('t1')]);
  assert.equal(communication.capture.genericIncomplete, true);
});
