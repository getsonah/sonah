// An assistant row the slicer labels harness (records.js `claudeLabeller`: Claude Code's own synthetic row, with the
// model `<synthetic>` or `isApiErrorMessage`, such as an API error or a usage limit) is not the agent's: none of its text
// becomes a statement of the agent (`commentary`) or its turn's closing words (`sayings`). The owner, 2026-10-31:
// "Everywhere now". The row stays counted in the label census. Structure only: the label, never the words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { labelClaudeRows } from '../src/records.js';
import { buildEvents } from '../src/events.js';
import { sliceLineage } from '../index.js';

let seq = 0;
const uid = () => `harness-${String(++seq).padStart(6, '0')}`;
const base = { sessionId: 'sess-harness', cwd: '/repo', version: '2.1.284', gitBranch: 'main', isSidechain: false,
  parentUuid: 'p' };
const ask = (text) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content: text },
  origin: { kind: 'human' }, promptSource: 'sdk' });
const said = (text) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant',
  content: [{ type: 'text', text }] } });
const synthetic = (text, extra = {}) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant',
  model: '<synthetic>', content: [{ type: 'text', text }] }, ...extra });
const apiError = (text) => ({ ...said(text), isApiErrorMessage: true });

test('a harness-labelled assistant row is no statement of the agent and no closing words of its turn', () => {
  const rows = labelClaudeRows([ask('Fix the build.'), said('I fixed the build and the tests pass.'),
    synthetic('API Error: Cannot reach the API server.'), ask('go on'), said('Working on it.'),
    apiError('You have hit your session limit.')]).map((rec) => ({ ...rec, kind: rec.raw.type }));
  assert.deepEqual(rows.map((r) => r.label), ['human', 'thought', 'harness', 'human', 'thought', 'harness']);
  const built = buildEvents(rows);
  assert.deepEqual(built.commentary.map((c) => c.text), ['I fixed the build and the tests pass.', 'Working on it.']);
  // Each turn's closing words are its last statement of the agent's, never the harness row after it.
  assert.deepEqual(built.sayings.map((s) => [s.turn, s.text]), [[1, 'I fixed the build and the tests pass.'],
    [2, 'Working on it.']]);
  assert.equal(built.commentaryCapture.blocks, 2);
});

test('through the whole slice, the harness row is counted as harness and quoted nowhere as the agent\'s', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-harness-'));
  try {
    const file = join(dir, 'session.jsonl');
    const rows = [ask('Fix the build.'), said('Done.'), synthetic('API Error: Cannot reach the API server.')];
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const out = await sliceLineage([file]);
    const text = JSON.stringify(out.commentary ?? out.ledger?.commentary ?? []);
    assert.ok(text.includes('Done.'));
    assert.equal(text.includes('API Error'), false);
    const said_ = JSON.stringify(out.sayings ?? out.ledger?.sayings ?? []);
    assert.equal(said_.includes('API Error'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
