// Synthetic carriers pin the provenance of a numeric command exit code separately
// from the interpretation of visible output and from conflict/interruption flags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../src/events.js';

const call = (id, command) => ({ kind: 'assistant', raw: { type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash',
    input: { command } }] } } });
const result = (id, { exitCode, isError = false } = {}) => ({ kind: 'user', raw: {
  type: 'user', ...(exitCode === undefined ? {} : { exitCode }),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id,
    content: 'synthetic output', is_error: isError }] },
} });

test('numeric command status records its native or hook carrier without clearing conflicts', () => {
  const rows = [
    call('native', 'node scripts/native.js'), result('native', { exitCode: 2 }),
    call('conflict', 'node scripts/conflict.js'), result('conflict', { isError: true }),
    call('interrupted', 'node scripts/interrupted.js'), result('interrupted'),
    call('unknown', 'node scripts/unknown.js'), result('unknown'),
  ];
  const events = buildEvents(rows, { cwd: '/repo', outcomes: new Map([
    ['native', { exitCode: 0 }],
    ['conflict', { exitCode: 0 }],
    ['interrupted', { exitCode: 0, interrupted: true }],
  ]) }).events;
  const byCommand = (command) => events.find((event) => event.cmd === command);
  const native = byCommand('node scripts/native.js');
  assert.deepEqual([native.exitCode, native.exitCodeSource, native.outcome], [2, 'native', 'failed']);
  const conflict = byCommand('node scripts/conflict.js');
  assert.deepEqual([conflict.exitCode, conflict.exitCodeSource, conflict.outcome, conflict.conflict],
    [0, 'hook', 'unknown', true]);
  const interrupted = byCommand('node scripts/interrupted.js');
  assert.deepEqual([interrupted.exitCode, interrupted.exitCodeSource,
    interrupted.outcome, interrupted.interrupted], [0, 'hook', 'unknown', true]);
  const unknown = byCommand('node scripts/unknown.js');
  assert.equal(unknown.exitCode, undefined);
  assert.equal(unknown.exitCodeSource, undefined);
});
