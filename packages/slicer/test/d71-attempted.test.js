import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../src/events.js';

// D71 (S2): a failed command keeps what it attempted. Synthetic fixture: one Bash call and its
// result, the result flagged as an error by the recorder.
function one(command, text, { isError } = {}) {
  const block = { type: 'tool_result', tool_use_id: 'b1', content: text, ...(isError === undefined ? {} : { is_error: isError }) };
  const recs = [
    { kind: 'user', raw: { type: 'user', message: { role: 'user', content: 'run it' } } },
    { kind: 'assistant', raw: { type: 'assistant', version: '2.1.205', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'b1', name: 'Bash', input: { command } }] } } },
    { kind: 'user', raw: { type: 'user', version: '2.1.205', message: { role: 'user', content: [block] } } },
  ];
  return buildEvents(recs, { cwd: '/repo' }).events.find((e) => e.cmd === command);
}

test('D71 S2: a failed command keeps the kind it attempted beside the legacy error kind', () => {
  const failed = one('npm run build', 'exit status 2', { isError: true });
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.kind, 'error', 'the legacy flip stays for existing consumers');
  assert.equal(failed.attempted, 'bash', 'what the call attempted is kept');
  const passed = one('npm run build', 'built', { isError: false });
  assert.equal(passed.attempted, undefined, 'a call that did not fail is not marked');
  assert.equal(passed.kind, 'bash');
});
