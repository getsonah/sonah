// Synthetic recordings only. A known code-effect tool with an untyped schema is an action gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { buildEvents } from '../src/events.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const item = (payload) => ({ type: 'response_item', payload });
const call = (name, id, input) => item({ type: 'function_call', name, call_id: id,
  arguments: JSON.stringify(input) });
const result = (id) => item({ type: 'function_call_output', call_id: id,
  output: 'Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSaved.' });
async function codexFixture(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-known-effect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-09-28T00-00-00-synthetic.jsonl');
  const lines = [{ type: 'session_meta', payload: { id: 'synthetic', cwd: '/repo' } },
    item({ type: 'message', role: 'user', content: 'Change the fixture.' }), ...rows];
  await writeFile(file, lines.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return file;
}
const adapted = (ledger) => sessionFromLedger(redact(ledger).ledger);

test('known Codex command and write names with changed schemas retain A/O and declare an action gap', async (t) => {
  const cases = [
    ['exec_command', { cmd: 'printf value', unexpected: true }],
    ['exec_command', { cmd: 'printf value', workdir: 'relative/subdir' }],
    ['shell', { command: ['rm', '-rf', 'build'] }],
    ['container.exec', { command: ['rm', '-rf', 'build'] }],
    ['write_file', { path: '/repo/file.txt', content: 'value', unexpected: true }],
    ['create_file', { path: '/repo/file.txt', content: 'value', unexpected: true }],
    ['str_replace_editor', { path: '/repo/file.txt', old_string: 'a', new_string: 'b', unexpected: true }],
    ['apply_patch', { patch: '*** Begin Patch\n*** Update File: file.txt\n*** Move to: moved.txt\n@@\n-a\n+b\n*** End Patch' }],
    ['apply_patch', { patch: '*** Begin Patch\n*** Update File: file.txt\n@@\n-a\n+b' }],
  ];
  for (const [index, [name, input]] of cases.entries()) {
    const ledger = await sliceLineage([await codexFixture(t, [call(name, `c${index}`, input), result(`c${index}`)])]);
    assert.equal(ledger.ledger.length, 1, name);
    assert.equal(ledger.ledger[0].kind, 'other', name);
    assert.equal(ledger.ledger[0].genericTool, true, name);
    assert.equal(ledger.ledger[0].cmd, undefined, name);
    assert.equal(ledger.ledger[0].path, undefined, name);
    assert.equal(ledger.ledger[0].exitCode, undefined, name);
    assert.equal(ledger.capture.incomplete, true, name);
    assert.ok(ledger.capture.reasons.includes('known_code_effect_untyped'), name);
    const gaps = adapted(ledger).adapterGaps;
    assert.ok(gaps.some((gap) => gap.code === 'incomplete_inventory' && gap.channel === 'actions'), name);
  }
});

test('Codex exec_command with its own absolute workdir retains native exit without shell-write inference', async (t) => {
  const cmd = 'echo value > src/one.js';
  const native = 'Wall time: 0.1 seconds\nProcess exited with code 0\nOutput:\n';
  for (const workdir of ['/repo/subdir', '/tmp/other']) {
    const file = await codexFixture(t, [call('exec_command', 'c1', { cmd, workdir }),
      item({ type: 'function_call_output', call_id: 'c1', output: native })]);
    const ledger = await sliceLineage([file]);
    assert.equal(ledger.ledger.length, 1, workdir);
    assert.equal(ledger.ledger[0].kind, 'bash', workdir);
    assert.equal(ledger.ledger[0].cmd, cmd, workdir);
    assert.equal(ledger.ledger[0].exitCode, 0, workdir);
    assert.equal(ledger.ledger[0].inputMetadata.includes(workdir), true, workdir);
    assert.ok(!ledger.capture.reasons.includes('known_code_effect_untyped'), workdir);
    assert.equal(adapted(ledger).events.filter((event) => event.kind === 'observation'
      && event.terminalStatusProven).length, 1, workdir);
  }
  const claude = buildEvents([claudeCall('Bash', { command: cmd, workdir: '/repo/subdir' }),
    claudeResult], { cwd: '/repo' });
  assert.equal(claude.events[0].kind, 'other', 'different Claude Bash cwd is not this Codex rule');
});

test('typed known tool and verb-like unknown tool are distinct near misses', async (t) => {
  for (const [name, input, expectedKind] of [
    ['exec_command', { cmd: 'printf value' }, 'bash'],
    ['exec_command', { cmd: 'printf value', workdir: '.' }, 'bash'],
    ['vendor.exec_command', { cmd: 'printf value', unexpected: true }, 'other'],
    ['mcp__future__write_file', { path: '/repo/file.txt', content: 'value' }, 'other'],
  ]) {
    const ledger = await sliceLineage([await codexFixture(t, [call(name, 'c1', input), result('c1')])]);
    assert.equal(ledger.ledger[0].kind, expectedKind, name);
    assert.ok(!(ledger.capture?.reasons ?? []).includes('known_code_effect_untyped'), name);
    assert.ok(!adapted(ledger).adapterGaps.some((gap) => gap.code === 'incomplete_inventory'
      && gap.channel === 'actions'), name);
  }
});

const claudeCall = (name, input) => ({ kind: 'assistant', adapter: 'claude', raw: {
  type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name, input }] },
} });
const claudeResult = { kind: 'user', adapter: 'claude', raw: { type: 'user', message: {
  role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Saved.' }],
} } };

test('Claude known command/write schemas declare the same gap; unknown MCP names do not', () => {
  for (const [name, input, demoted] of [
    ['Bash', { command: 'printf value', unexpected: true }, true],
    ['Write', { file_path: '/repo/file.txt', content: 'value', unexpected: true }, true],
    ['Edit', { file_path: '/repo/file.txt', old_string: 'a', new_string: 'b', unexpected: true }, true],
    ['mcp__fs__write_file', { path: '/repo/file.txt', content: 'value', unexpected: true }, true],
    ['mcp__future__write_file', { path: '/repo/file.txt', content: 'value' }, false],
    ['Bash', { command: 'printf value' }, false],
  ]) {
    const built = buildEvents([claudeCall(name, input), claudeResult], { cwd: '/repo' });
    assert.equal(built.events.length, 1, name);
    assert.equal(built.actionCapture.knownCodeEffectDemoted ?? 0, demoted ? 1 : 0, name);
    if (demoted) {
      assert.equal(built.events[0].kind, 'other', name);
      assert.equal(built.events[0].exitCode, undefined, name);
    }
  }
});

test('a demoted Claude write reaches the session action gap', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-known-effect-claude-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'synthetic.jsonl');
  const rows = [
    { type: 'user', sessionId: 'synthetic', cwd: '/repo', message: { role: 'user', content: 'Write the fixture.' } },
    { type: 'assistant', sessionId: 'synthetic', cwd: '/repo', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'c1', name: 'Write', input: {
        file_path: '/repo/file.txt', content: 'value', unexpected: true } },
    ] } },
    { type: 'user', sessionId: 'synthetic', cwd: '/repo', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'c1', content: 'Saved.' },
    ] } },
  ];
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger[0].kind, 'other');
  assert.ok(ledger.capture.reasons.includes('known_code_effect_untyped'));
  assert.ok(adapted(ledger).adapterGaps.some((gap) => gap.code === 'incomplete_inventory'
    && gap.channel === 'actions'));
});
