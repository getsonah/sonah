import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sliceLineage, hasCaptureGaps } from '../index.js';
import { readCodexSession } from '../src/codex.js';
import { buildEvents } from '../src/events.js';
import { scratchDir } from './scratch-dir.js';

const wrapper = (id, source) => [
  { type: 'session_meta', payload: { id: 'synthetic', cwd: '/repo' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: 'Build the implementation.' } },
  { type: 'response_item', payload: { type: 'custom_tool_call', call_id: id, name: 'functions.exec', input: source } },
  { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: [
    { type: 'input_text', text: 'Script completed\nWall time: 0.1' },
    { type: 'input_text', text: JSON.stringify({ output: '', exit_code: 0 }) },
  ] } },
];

test('capture counts and gap reasons survive a multi-file lineage without replacing action evidence', async () => {
  const dir = await scratchDir('sonah-capture-lineage-');
  const files = [join(dir, 'rollout-2026-09-10T01-00-00-a.jsonl'), join(dir, 'rollout-2026-09-10T01-01-00-b.jsonl')];
  const inputs = [wrapper('first', "text(await tools.exec_command({cmd:'make build'}));"),
    wrapper('second', 'const command = userSupplied(); text(await tools.exec_command({cmd: command}));')];
  for (let i = 0; i < files.length; i++) await writeFile(files[i], inputs[i].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const captures = [];
  for (const file of files) captures.push((await readCodexSession(file)).meta.capture);
  assert.equal(captures[0].incomplete, false);
  assert.equal(captures[1].incomplete, true);
  const ledger = await sliceLineage(files);
  for (const key of ['calls', 'wrappers', 'captured', 'unsupported', 'missing', 'unmapped']) {
    assert.equal(ledger.capture[key], captures.reduce((n, c) => n + c[key], 0), key);
  }
  assert.deepEqual(ledger.capture.reasons, [...new Set(captures.flatMap((c) => c.reasons))]);
  assert.ok(ledger.capture.reasons.every((reason) => ledger.dropped.some((d) => d.reason === reason)));
  assert.equal(hasCaptureGaps(ledger), true);
  assert.equal(ledger.ledger.filter((e) => e.cmd === 'make build').length, 1);
});

test('known delegation calls and their results do not become unsupported actions or orphan observations', () => {
  for (const [adapter, name] of [['claude', 'Agent'], ['codex', 'collaboration.spawn_agent'],
    ['codex', 'collaboration.followup_task']]) {
    const records = [
      { kind: 'assistant', adapter, raw: { message: { content: [
        { type: 'tool_use', id: 'delegate-1', name, input: { message: 'Do the task.' } },
      ] } } },
      { kind: 'user', adapter, raw: { message: { content: [
        { type: 'tool_result', tool_use_id: 'delegate-1', content: 'delegated' },
      ] } } },
    ];
    const built = buildEvents(records);
    assert.equal(built.actionCapture.unsupported, 0, name);
    assert.equal(built.actionCapture.orphanResults, 0, name);
    assert.equal(built.observationCapture.missing, 0, name);
  }
});
