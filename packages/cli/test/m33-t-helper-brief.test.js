// M33 T (helper briefs), end to end through the production read path: a synthetic Codex parent rollout whose
// `fix_parser` helper was handed an encrypted brief, and that helper's own linked rollout, whose brief arrives
// as an inter-agent message with an encrypted payload and whose first user message is harness context. The
// report .md (D97) states the encrypted briefs and message once, and no token reaches anything.
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
import { TOKENS, TEXT, rootRows, childRows, jsonl } from '../../evidence/test/m33-t-helper-brief-fixture.js';

async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah m33-t helper ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'rollout-2026-10-01T12-00-00-root.jsonl');
  const child = join(dir, 'rollout-2026-10-01T12-00-01-child.jsonl');
  await writeFile(root, jsonl(rootRows()), { mode: 0o600 });
  await writeFile(child, jsonl(childRows()), { mode: 0o600 });
  return { root, options: { recordingRoots: { codex: dir }, reviewLinkedChildren: true } };
}
const noToken = (text, label) => {
  for (const token of Object.values(TOKENS)) assert.equal(text.includes(token.slice(0, 32)), false, label);
};

test('M33 T a linked Codex helper with an encrypted brief is named by its task, and no token travels', async (t) => {
  const f = await fixture(t);
  const ledger = await loadSessionEvidence([f.root], f.options);
  const [fix, notes, follow] = ledger.delegations;
  assert.equal(fix.status, 'linked');
  assert.deepEqual(fix.parentInstruction, { tool: 'spawn_agent', field: 'message', encrypted: true });
  assert.equal(fix.taskName, '/root/fix_parser');
  assert.deepEqual(notes.parentInstruction, { tool: 'spawn_agent', field: 'message', text: TEXT.notesBrief });
  assert.deepEqual(follow.parentInstruction, { tool: 'followup_task', field: 'message', encrypted: true });
  noToken(JSON.stringify(ledger), 'ledger');
  assert.equal(JSON.stringify(ledger).includes('‹dropped'), false);

  const session = sessionFromLedger(ledger, { sessionKey: 'm33-t-e2e' });
  const spawned = session.delegations().find((event) => event.taskName === '/root/fix_parser');
  assert.equal(spawned.briefEncrypted, true);
  assert.equal(session.childFor(spawned.id)?.state, 'verified');
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
    judge: async (request) => (request.challenge ? { votes: [] } : windowNarrative(session, request.window)) });
  // D97: the report .md names no helper (the story's step blocks and charts are gone): the harness context is no part
  // of it, and what the recorder encrypted is said once each, among what Sonah could not check.
  const story = renderReportMarkdown(session, report);
  assert.doesNotMatch(story, /recommended_plugins/);
  assert.equal(story.split(`- ${REPORT_NOT_CHECKED_WORDS.encryptedBriefs(2)}`).length - 1, 1, story);
  // M33 F: the helper's own recording holds its brief as an encrypted NEW_TASK message, stated once beside it.
  assert.equal(story.split(`- ${REPORT_NOT_CHECKED_WORDS.encryptedMessages(1, false)}`).length - 1, 1, story);
  noToken(story, 'story');
  noToken(JSON.stringify({ events: session.events, blobs: session.blobs, gaps: session.adapterGaps }), 'session');
});
