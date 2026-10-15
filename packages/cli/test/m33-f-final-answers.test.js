// M33 F (helper final answers), end to end through the production read path: a synthetic Codex parent rollout whose
// two helpers report back in plaintext FINAL_ANSWER rows (one with a secret-shaped token in it), beside an encrypted
// NEW_TASK row. Each report reaches the review as its hand-off's quotable result, scrubbed; the story says what each
// helper reported and states the encrypted message once; no token and no secret reaches anything.
//
// Synthetic rollouts in a temp directory, a deterministic fake judge. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { runReview } from '../../evidence/src/run-review.js';
import { renderSessionStory } from '../../render/session-story.js';
import { windowNarrative } from './m33-fast-profile-fixture.js';
import { TOKENS, TEXT, SECRET, rootRows, newTask, finalAnswer, jsonl }
  from '../../evidence/test/m33-f-final-answer-fixture.js';

test('M33 F helper reports reach the review as scrubbed results and the story as what each helper reported', async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah m33-f reports ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'rollout-2026-10-01T12-00-00-root.jsonl');
  await writeFile(root, jsonl(rootRows([newTask('/root/fix_parser'),
    finalAnswer('/root/fix_parser', TEXT.fixReport),
    finalAnswer('/root/write_changelog', `${TEXT.notesReport}\nThe release key is ${SECRET}.`)])), { mode: 0o600 });
  const ledger = await loadSessionEvidence([root], { recordingRoots: { codex: dir }, reviewLinkedChildren: true });
  assert.equal(ledger.capture.interAgentFinalAnswersAttributed, 2);
  assert.equal(ledger.capture.interAgentMessagesEncrypted, 1);
  const session = sessionFromLedger(ledger, { sessionKey: 'm33-f-e2e' });
  const results = session.events.filter((event) => event.helperReported === true);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((event) => session.sourcesFor(event)[0].role), ['observation', 'observation']);
  const seen = [];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
    judge: async (request) => { seen.push(request); return request.challenge ? { votes: [] } : windowNarrative(session, request.window); } });
  const prompts = seen.map((request) => JSON.stringify(request)).join('\n');
  assert.ok(prompts.includes('Fixed the nested-input parser in src/parser.js.'), 'the report is evidence the judge reads');
  const story = renderSessionStory(session, report);
  assert.match(story, /reported: Fixed the nested-input parser in src\/parser\.js\./);
  assert.match(story, /reported: Wrote the changelog entry under Unreleased\./);
  assert.match(story, /^Codex recording · .* · 1 inter-agent message was encrypted by Codex and cannot be shown$/m);
  for (const [label, text] of [['ledger', JSON.stringify(ledger)], ['requests', prompts], ['story', story],
    ['session', JSON.stringify({ events: session.events, blobs: session.blobs, gaps: session.adapterGaps })]]) {
    assert.equal(text.includes(SECRET), false, `${label}: no secret`);
    assert.equal(text.includes(TOKENS.task.slice(0, 32)), false, `${label}: no encrypted payload`);
    assert.equal(text.includes('Message Type:'), false, `${label}: no header`);
  }
});
