import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { sliceLineage } from '../index.js';
import { redact, sliceHash } from '../../redact/index.js';
import { scratchDir } from './scratch-dir.js';
import { assertLinearAsync } from '../../redact/test/linear-clock.js';

async function file(content, name = 's.jsonl') {
  const d = await scratchDir('hard-');
  const f = join(d, name);
  await writeFile(f, content, 'utf8');
  return f;
}

test('INVARIANT: same input, same bytes out — actually tested, not just stated', async () => {
  // CLAUDE.md declares determinism as a rule. Until now nothing verified it.
  const f = await file([
    JSON.stringify({ type: 'user', sessionId: 's', cwd: '/repo', message: { role: 'user', content: 'fix the build' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'make' } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] } }),
  ].join('\n'));
  const a = JSON.stringify(await sliceLineage([f]));
  const b = JSON.stringify(await sliceLineage([f]));
  assert.equal(a, b);
  assert.equal(sliceHash(redact(await sliceLineage([f])).ledger), sliceHash(redact(await sliceLineage([f])).ledger));
});

test('FUZZ: adversarial input never crashes and never hangs', async () => {
  const nasty = [
    '{"type":"user"',                                       // truncated JSON
    'null', '42', '"string"', '[]',                          // valid JSON, wrong shape
    JSON.stringify({ type: 'user', message: { content: null } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }),  // no name
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),     // no id
    ' binary garbage here',
    JSON.stringify({ type: 'user', message: { content: 'x'.repeat(2_000_000) } }),         // 2MB turn
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Edit', input: { file_path: 42, old_string: null } }] } }),
  ].join('\n');
  const path = await file(nasty);
  let l;
  // 5 s of CPU, scaled by the slowdown measured under load (linear-clock.js), never a wall-clock limit.
  await assertLinearAsync(async () => { l = await sliceLineage([path]); }, 5000, 'bounded time on pathological input');
  assert.ok(l.dropped.some((d) => String(d.reason).includes('unparseable')), 'corruption is counted, not hidden');
});

test('LEAK: a planted secret never reaches the stored ledger', async () => {
  // End to end, not per-unit. The unit tests prove redact() works; this proves the ledger every review is built from
  // (and `sonah slice` prints) actually goes THROUGH it. A secret can enter via the ask, a tool result, or the final
  // message. (The m33-r-* tests check the session and the review requests built from a ledger for leaks.)
  const KEY = 'AKIAIOSFODNN7EXAMPLE';
  const f = await file([
    JSON.stringify({ type: 'user', sessionId: 's', cwd: '/repo', message: { role: 'user', content: `deploy with ${KEY} to staging` } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `AWS_KEY=${KEY} pytest tests/` } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: `auth ok for ${KEY}\n1 failed`, is_error: true }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Done. Used ${KEY}.` }] } }),
  ].join('\n'));

  const { ledger } = redact(await sliceLineage([f]));
  assert.ok(!JSON.stringify(ledger).includes(KEY), 'secret leaked into the stored ledger json');
});

test('SELF-REVIEW-FOUND: curl -o and wget -O are shell writes', async () => {
  // sonah's first review of its own build session reported the LICENSE (202 lines, fetched with
  // curl -o) as explained by nothing. Correct at the time — and a fixable gap, not a structural one.
  const { buildEvents } = await import('../src/events.js');
  const recs = [{ kind: 'assistant', raw: { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'curl -sf https://example.com/x.txt -o LICENSE.txt && wget -O notes.md https://e.com' } }] } } }];
  const { events } = buildEvents(recs, { cwd: '/repo' });
  const writes = events.filter((e) => e.kind === 'edit').map((e) => `${e.path}(${e.via})`);
  assert.deepEqual(writes.sort(), ['LICENSE.txt(curl -o)', 'notes.md(wget -O)']);
});

test('MCP writes are visible: server-prefixed write tools become real events', async () => {
  const dir = await scratchDir('sonah-mcp-');
  const lines = [
    JSON.stringify({ type: 'user', cwd: '/w', message: { role: 'user', content: [{ type: 'text', text: 'fix auth.py, never touch config.yaml' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: '1', name: 'mcp__fs__write_file', input: { path: '/w/auth.py', content: 'x=1' } }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: '2', name: 'mcp__fs__edit_file', input: { file_path: '/w/config.yaml', old_string: 'a', new_string: 'b' } }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: '3', name: 'mcp__linear__update_issue', input: { issueId: 'ABC-1' } }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }),
  ].join('\n');
  await writeFile(join(dir, 's.jsonl'), lines);
  const l = await sliceLineage([join(dir, 's.jsonl')]);
  assert.deepEqual(l.ledger.map((e) => `${e.kind} ${e.path}`),
    ['create auth.py', 'edit config.yaml', 'other undefined'],
    'vetted filesystem writes keep typed effects; an unfamiliar MCP call remains opaque');
});

test('the harness scratchpad is scaffolding: a deliverable written there is never a project finding', async () => {
  const dir = await scratchDir('sonah-scratch-');
  const lines = [
    JSON.stringify({ type: 'user', cwd: '/Users/x/proj', message: { role: 'user', content: [{ type: 'text', text: 'plan the device build' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: '1', name: 'Write', input: { file_path: '/private/tmp/claude-501/-Users-x-proj/abc123/scratchpad/build-plan.html', content: 'x' } }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: '2', name: 'Edit', input: { file_path: '/Users/x/proj/main.py', old_string: 'a', new_string: 'b' } }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }),
  ].join('\n');
  await writeFile(join(dir, 's.jsonl'), lines);
  const l = await sliceLineage([join(dir, 's.jsonl')]);
  const scratch = l.ledger.find((e) => (e.path ?? '').includes('build-plan'));
  const real = l.ledger.find((e) => (e.path ?? '').includes('main.py'));
  assert.equal(scratch.external, true, 'scratchpad write is scaffolding');
  assert.ok(!real.external, 'the real project write stays judged');
});

test('scripted writes: a python heredoc open(p, "w") with a simple variable is a real edit event', async () => {
  const dir = await scratchDir('sonah-script-');
  const cmd = "cd /w && python3 << 'PYEOF'\np='ui/two-surfaces.html'\ns=open(p).read()\nopen(p,'w').write(s.replace('a','b'))\nPYEOF\nnode -e \"require('fs').writeFileSync('ui/app.js', 'x')\"";
  const lines = [
    JSON.stringify({ type: 'user', cwd: '/w', message: { role: 'user', content: [{ type: 'text', text: 'update the ui' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: '1', name: 'Bash', input: { command: cmd } }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }),
  ].join('\n');
  await writeFile(join(dir, 's.jsonl'), lines);
  const l = await sliceLineage([join(dir, 's.jsonl')]);
  const writes = l.ledger.filter((e) => e.kind === 'edit').map((e) => `${e.path} via ${e.via}`);
  assert.deepEqual(writes.sort(), ['ui/app.js via script writeFile', 'ui/two-surfaces.html via script open(w)'].sort(),
    'the script-written files reach the ledger; "update the ui" can now be served by them');
});

test('background-task notifications are not human turns: their typed origin labels them observations (M34 labels)', async () => {
  // M34 labels (C-02 "Slice-time labels"): a notification is labelled by the origin the recorder typed on its row
  // (`task-notification` → observation), never by its words; the HARNESS_BLOCK strip and the untyped notification mark
  // that read its tags are deleted.
  const { labelClaudeRows } = await import('../src/records.js');
  const { opensTurn } = await import('../src/labels.js');
  const rec = (text, extra = {}) => ({ type: 'user', version: '2.1.284', message: { role: 'user',
    content: [{ type: 'text', text }] }, ...extra });
  const rows = labelClaudeRows([
    rec('<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n</task-notification>',
      { origin: { kind: 'task-notification' } }),
    rec('[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event.',
      { origin: { kind: 'task-notification' } }),
    rec('<system-reminder>context</system-reminder>\nplease also fix the parser', { origin: { kind: 'human' } }),
    rec('okay now ship it', { origin: { kind: 'human' } }),
  ]).map((r) => ({ ...r, kind: 'user' }));
  assert.deepEqual(rows.map((r) => [r.label, opensTurn(r)]), [['observation', false], ['observation', false],
    ['human', true], ['human', true]]);
});

test('L127: a command named after an Object.prototype member slices instead of crashing', async () => {
  // RUNNER_SUBCMD was a plain object literal, so `RUNNER_SUBCMD['constructor']` handed the
  // classifier Object itself and `subs.includes(...)` threw — one oddly named command killed the
  // whole slice. A prototype key is not a runner name; the table answers for its own keys only.
  const cmds = ['toString --help', 'constructor test', 'valueOf', 'hasOwnProperty test'];
  const lines = [
    JSON.stringify({ type: 'user', sessionId: 'proto', cwd: '/repo', message: { role: 'user', content: 'run the helpers' } }),
    ...cmds.flatMap((command, i) => [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `p${i}`, name: 'Bash', input: { command } }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `p${i}`, content: 'x' }] } }),
    ]),
  ].join('\n');
  const l = await sliceLineage([await file(lines, 'proto.jsonl')]);
  assert.deepEqual(l.ledger.map((e) => e.cmd), cmds, 'every command survives the slice');
  for (const e of l.ledger) {
    assert.equal(e.kind, 'bash', `${e.cmd} is not a test runner`);
    assert.equal(e.outcome, 'unknown', `${e.cmd} has no recorded outcome to claim`);
  }
});

test('L127: the runner table is consulted for its own keys only', async () => {
  const { isTestCommand, coverageIdentity } = await import('../src/outcome.js');
  for (const cmd of ['toString --help', 'constructor test', 'valueOf', 'hasOwnProperty test', '__proto__ test']) {
    assert.equal(isTestCommand(cmd), false, cmd);
    assert.doesNotThrow(() => coverageIdentity(cmd), cmd);
  }
  assert.equal(isTestCommand('npm test'), true, 'the real keys still work');
  assert.equal(isTestCommand('cargo nextest'), true);
  assert.deepEqual(coverageIdentity('cargo test --lib'), { runner: 'cargo', targets: [] },
    'and the table still strips a runner subcommand from the target set');
});
