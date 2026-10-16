// M33 R repair 2, the adapter and the review. A Codex patch used to be split into an Edit by its changed lines only.
// Now each side of the change is the patch's whole text for that side, so every block travels with the line that opens
// it. D90 (owner decision 2026-10-15, privacy is not a design constraint): and it reaches the session and the review
// requests as recorded.
//
// Synthetic recordings only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { planWindowRequests } from '../src/run-review.js';
import { codexSliced, shapes, CASES } from '../../slicer/test/m33-r-codex-patch-fixture.js';

const promptsOf = (session) => planWindowRequests({ session, reviewScope: 'session-only' }).requests
  .map(({ request }) => `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}`).join('\n');

for (const [name, { path, secrets, hunk }] of Object.entries(CASES)) {
  test(`M33 R repair 2, D90: ${name}: every line of it in the session and a review request, as recorded`, async () => {
    for (const [shape, rows] of shapes(path, hunk)) {
      const { clean } = await codexSliced(rows);
      const session = sessionFromLedger(clean, { sessionKey: `m33-r-patch-${shape}` });
      const prompts = promptsOf(session);
      assert.ok(prompts.includes(path), `${shape}: premise: the review requests show the change`);
      for (const secret of secrets) {
        assert.ok(JSON.stringify(session.blobs).includes(secret), `${shape}: session`);
        assert.ok(prompts.includes(secret), `${shape}: review requests`);
      }
    }
  });
}
