// D127 (B10d): the recorder's typed facts of a compaction travel from its boundary row (the slicer's mark) to the
// adapter's boundary event, and no request shows them. Synthetic rows; no real recording is read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { planWindowRequests } from '../src/run-review.js';

const base = { sessionId: 'sess-b10d', cwd: '/repo', version: '2.1.295', gitBranch: 'main', isSidechain: false,
  userType: 'external', timestamp: '2026-10-20T10:00:00.000Z' };
const human = (uuid, parentUuid, text) => ({ ...base, type: 'user', uuid, parentUuid, origin: { kind: 'human' },
  promptSource: 'typed', message: { role: 'user', content: text } });
const said = (uuid, parentUuid, text) => ({ ...base, type: 'assistant', uuid, parentUuid,
  message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text }] } });

test('B10d: the boundary row\'s typed counts reach its boundary event; the summary\'s event carries none', async () => {
  const rows = [human('u1', null, 'ask one'), said('a1', 'u1', 'ok'),
    { ...base, type: 'system', subtype: 'compact_boundary', uuid: 'b1', parentUuid: null, logicalParentUuid: 'a1',
      compactMetadata: { trigger: 'auto', preTokens: 967925, postTokens: 11687, durationMs: 9 } },
    { ...base, type: 'user', uuid: 's1', parentUuid: 'b1', isCompactSummary: true, message: { role: 'user',
      content: 'Summary.' } },
    human('u2', 's1', 'ask two'), said('a2', 'u2', 'done'),
    { ...base, type: 'system', subtype: 'compact_boundary', uuid: 'b2', parentUuid: null, logicalParentUuid: 'a2',
      compactMetadata: { trigger: 'sideways', preTokens: -1, postTokens: 1.5 } }];
  const dir = await mkdtemp(join(tmpdir(), 'd127-b10d-'));
  try {
    const f = join(dir, 'r.jsonl');
    await writeFile(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const raw = await sliceLineage([f]);
    assert.deepEqual(raw.marks.filter((m) => m.kind === 'compaction').map((m) => m.compacted ?? null), [
      { trigger: 'auto', before: 967925, after: 11687 }, null, {}]);
    const session = sessionFromLedger(redact(raw).ledger);
    const boundaries = session.events.filter((e) => e.kind === 'boundary' && e.boundary === 'compaction');
    assert.deepEqual(boundaries.map((e) => e.compacted ?? null), [{ trigger: 'auto', before: 967925, after: 11687 },
      null, {}]);
    // The order: the first compaction after ask one, before ask two.
    const at = (id) => session.events.findIndex((e) => e.id === id);
    const instructions = session.events.filter((e) => e.kind === 'instruction').map((e) => at(e.id));
    assert.ok(instructions[0] < at(boundaries[0].id) && at(boundaries[0].id) < instructions[1]);
    // No request shows the facts: the review's requests are byte for byte those of the same session without them.
    const plan = (s) => planWindowRequests({ session: s, reviewScope: 'session-only', backend: 'claude-cli' })
      .requests.map((r) => [r.system, r.prompt, r.evidencePrompt ?? null]);
    const bare = sessionFromLedger(redact(raw).ledger);
    for (const event of bare.events) delete event.compacted;
    assert.deepEqual(plan(session), plan(bare));
    assert.ok(plan(session).length > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
