// C-02 "M33 native-first refreeze", lane g4. Synthetic Codex rollouts only; no model call.
//   (7) In a paginated recording a DIRECT write_stdin is a recorded agent action (its typed chars):
//       when it joins a wrapper command's registered session, it is emitted with its own
//       observation under the unchanged chunk rules; only wrapper-internal polls are covered by
//       native items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
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

async function slice(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-g4-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-09-29T10-00-00-synthetic.jsonl');
  await writeFile(file, rows.map((value) => JSON.stringify(value)).join('\n') + '\n');
  return sliceLineage([file]);
}
const session = (ledger) => sessionFromLedger(redact(ledger).ledger, { sessionKey: 'g4' });

// ---------------------------------------------------------------------------------------------
// (7) A direct write_stdin joined to a wrapper command's registered session.
// ---------------------------------------------------------------------------------------------
const SHELL = 'const r = await tools.exec_command({cmd: "bash -i", yield_time_ms: 10});\ntext(r);';
const shell = [meta, started('t1'), ask('Do it.'), wrapper('w1', SHELL), command('i1', 't1', 'bash -i'),
  wrapperOut('w1', { wall_time_seconds: 1, session_id: 7, output: '$ ' })];
const TYPED = 'git push --force origin main\n';
const typedPolls = (ledger) => ledger.ledger.filter((e) => e.tool === 'write_stdin');

test('(7) paginated: a direct write_stdin into a wrapper command\'s session is its own action and observation', async (t) => {
  const ledger = await slice(t, [...shell, direct('write_stdin', 'p1', { session_id: 7, chars: TYPED }),
    directOut('p1', 'Wall time: 1.0 seconds\nProcess exited with code 0\nOutput:\npushed\n'), complete('t1')]);
  assert.deepEqual(ledger.capture.reasons, []);
  assert.equal(ledger.capture.incomplete, false);
  const polls = typedPolls(ledger);
  assert.equal(polls.length, 1, 'the typed input is a recorded action');
  const [poll] = polls;
  assert.equal(poll.genericTool, true);
  assert.equal(poll.inputRecorded, true);
  assert.deepEqual(JSON.parse(poll.argsExcerpt), { session_id: 7, chars: TYPED });
  assert.ok(poll.tailLines.includes('pushed'), 'its own output is its observation');
  // Its output proves no outcome: the command's status is the native item's.
  assert.equal(poll.exitCode, undefined);
  assert.equal(poll.result.outcome, 'unknown');
  assert.equal(poll.provenance, undefined, 'a direct call, not a native item or a code cell');
  // Order: the code cell, the native item, then the typed input at its own row.
  assert.deepEqual(ledger.ledger.map((e) => e.provenance ?? e.tool), ['codex_code_cell', 'codex_native_item', 'write_stdin']);
  // The typed command reaches the canonical session as the invocation's input, with its observation.
  const s = session(ledger);
  const invocation = s.events.find((e) => e.kind === 'invocation' && e.tool === 'write_stdin');
  assert.ok(invocation);
  assert.ok(invocation.input.map((ref) => s.blobs[ref.sourceKey]).join('').includes('git push --force'));
  const observation = s.events.find((e) => e.kind === 'observation' && e.invocation === invocation.id);
  assert.equal(observation.result, 'unknown');
  assert.ok(observation.output.map((ref) => s.blobs[ref.sourceKey]).join('').includes('pushed'));
});

test('(7) the joined poll keeps its chunk rules: an unknown chunk, a missing or repeated result', async (t) => {
  // An earlier wrapper poll whose result no emitter attributes makes the command's outcome unknown;
  // the direct poll's own observation is then outcome-unknown too.
  const unknown = await slice(t, [...shell,
    wrapper('w2', 'const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p.output.trim());'),
    wrapperOut('w2', 'partial'),
    direct('write_stdin', 'p1', { session_id: 7, chars: TYPED }),
    directOut('p1', 'Wall time: 1.0 seconds\nProcess exited with code 0\nOutput:\npushed\n'), complete('t1')]);
  const [poll] = typedPolls(unknown);
  assert.equal(poll.outcomeUnknown, true);
  assert.equal(poll.result.outcome, 'unknown');
  assert.equal(unknown.capture.unmapped, 1, 'only the wrapper poll is unmapped');
  // No result row: the action stays, with no observation and its unmapped gap.
  const missing = await slice(t, [...shell, direct('write_stdin', 'p1', { session_id: 7, chars: TYPED }), complete('t1')]);
  assert.equal(typedPolls(missing).length, 1);
  assert.equal(typedPolls(missing)[0].tailLines, undefined);
  assert.ok(missing.capture.reasons.includes(REASON.missing));
  assert.equal(missing.capture.incomplete, true);
  // A null result: the action stays, unmapped, with no observation.
  const empty = await slice(t, [...shell, direct('write_stdin', 'p1', { session_id: 7, chars: TYPED }),
    item({ type: 'function_call_output', call_id: 'p1', output: null }), complete('t1')]);
  assert.equal(typedPolls(empty).length, 1);
  assert.equal(typedPolls(empty)[0].tailLines, undefined);
  assert.equal(empty.capture.unmapped, 1);
});

test('(7) unchanged: wrapper-internal polls, unregistered sessions and direct commands', async (t) => {
  // A wrapper-internal poll is covered by the native item: no action of its own.
  const inner = await slice(t, [...shell,
    wrapper('w2', `const p = await tools.write_stdin({session_id: 7, chars: ${JSON.stringify(TYPED)}});\ntext(p);`),
    wrapperOut('w2', { wall_time_seconds: 1, exit_code: 0, output: 'pushed\n' }), complete('t1')]);
  assert.equal(typedPolls(inner).length, 0);
  assert.equal(inner.ledger.length, 3);
  // A session nothing registered keeps its unmatched-poll gap and emits nothing.
  const unmatched = await slice(t, [...shell, direct('write_stdin', 'p1', { session_id: 8, chars: TYPED }),
    directOut('p1', 'Wall time: 1.0 seconds\nOutput:\n'), complete('t1')]);
  assert.equal(typedPolls(unmatched).length, 0);
  assert.ok(unmatched.capture.reasons.includes(REASON.pollUnmatched));
  // A direct command's session: the chunk continues that command's observation, as in legacy.
  const directShell = await slice(t, [meta, started('t1'), ask('Do it.'),
    direct('exec_command', 'e1', { cmd: 'bash -i', yield_time_ms: 10 }),
    directOut('e1', 'Chunk ID: a\nWall time: 1.0 seconds\nProcess running with session ID 7\nOutput:\n$ '),
    event({ type: 'item_completed', thread_id: OWN, turn_id: 't1', item: { id: 'm1', type: 'AgentMessage' } }),
    direct('write_stdin', 'p1', { session_id: 7, chars: TYPED }),
    directOut('p1', 'Wall time: 1.0 seconds\nProcess exited with code 0\nOutput:\npushed\n'), complete('t1')]);
  assert.equal(typedPolls(directShell).length, 0);
  const bash = directShell.ledger.filter((e) => e.kind === 'bash');
  assert.equal(bash.length, 1);
  assert.ok(bash[0].tailLines.includes('pushed'));
  // A recording without the paginated item stream keeps the legacy rule for a wrapper command too.
  const legacy = await slice(t, [meta, started('t1'), ask('Do it.'), wrapper('w1', SHELL),
    wrapperOut('w1', { wall_time_seconds: 1, session_id: 7, output: '$ ' }),
    direct('write_stdin', 'p1', { session_id: 7, chars: TYPED }),
    directOut('p1', 'Wall time: 1.0 seconds\nProcess exited with code 0\nOutput:\npushed\n'), complete('t1')]);
  assert.equal(typedPolls(legacy).length, 0);
  assert.ok(legacy.ledger.find((e) => e.kind === 'bash').tailLines.includes('pushed'));
});

test('(7) a later identity conflict of the direct poll retracts its own observation', async (t) => {
  const ledger = await slice(t, [...shell, direct('write_stdin', 'p1', { session_id: 7, chars: TYPED }),
    directOut('p1', 'Wall time: 1.0 seconds\nOutput:\npushed\n'),
    directOut('p1', 'Wall time: 1.0 seconds\nOutput:\nsomething else\n'), complete('t1')]);
  const [poll] = typedPolls(ledger);
  assert.equal(poll.tailLines, undefined, 'a conflicting replay leaves no attributed observation');
  assert.ok(ledger.capture.reasons.includes(REASON.identity));
});
