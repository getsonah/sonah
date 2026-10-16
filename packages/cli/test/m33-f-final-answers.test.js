// M33 F (helper final answers), end to end through the production read path: a synthetic Codex parent rollout whose
// two helpers report back in plaintext FINAL_ANSWER rows (one with a secret-shaped token in it), beside an encrypted
// NEW_TASK row. Each report reaches the review as its hand-off's quotable result, as recorded (D90, owner decision
// 2026-10-15: nothing is masked, the secret-shaped token included); the report .md (D97) states the encrypted message
// once, where Sonah says what it could not check; the encrypted payload and the inter-agent header reach nothing.
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
import { renderReportMarkdown } from '../../render/session-story.js';
import { REPORT_NOT_CHECKED_WORDS } from '../../render/report-words.js';
import { windowNarrative } from './m33-fast-profile-fixture.js';
import { TOKENS, TEXT, SECRET, rootRows, newTask, finalAnswer, jsonl }
  from '../../evidence/test/m33-f-final-answer-fixture.js';

test('M33 F, D90 helper reports reach the review as recorded results; the encrypted message is stated once', async (t) => {
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
  assert.ok(prompts.includes(`The release key is ${SECRET}.`), 'D90: the report as recorded, its token included');
  // D97: the report .md shows no helper by itself (the story's step blocks are gone); what the recorder encrypted is
  // said once, among what Sonah could not check.
  const story = renderReportMarkdown(session, report);
  assert.equal(story.split(`- ${REPORT_NOT_CHECKED_WORDS.encryptedMessages(1, false)}`).length - 1, 1, story);
  assert.match(story, /^Codex recording · /m);
  for (const [label, text] of [['ledger', JSON.stringify(ledger)], ['requests', prompts], ['story', story],
    ['session', JSON.stringify({ events: session.events, blobs: session.blobs, gaps: session.adapterGaps })]]) {
    assert.equal(text.includes(TOKENS.task.slice(0, 32)), false, `${label}: no encrypted payload`);
    assert.equal(text.includes('Message Type:'), false, `${label}: no header`);
  }
});
