// M33 R repair 2, the adapter and the review. A Codex patch used to be split into an Edit by its changed lines only,
// before redaction: a secret block whose key was a context line (or whose PEM BEGIN line was removed, or kept as
// context) reached the session and the review requests with its body lines verbatim. Now each side of the change is
// the patch's whole text for that side, so redaction judges every block with its key, and nothing of it reaches a
// reader.
//
// Synthetic recordings only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { planWindowRequests } from '../src/run-review.js';
import { codexSliced, shapes, leaks, CASES } from '../../slicer/test/m33-r-codex-patch-fixture.js';

const promptsOf = (session) => planWindowRequests({ session, reviewScope: 'session-only' }).requests
  .map(({ request }) => `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}`).join('\n');

for (const [name, { path, secrets, hunk }] of Object.entries(CASES)) {
  test(`M33 R repair 2: ${name}: no line of it in the session or a review request`, async () => {
    for (const [shape, rows] of shapes(path, hunk)) {
      const { clean } = await codexSliced(rows);
      const session = sessionFromLedger(clean, { sessionKey: `m33-r-patch-${shape}` });
      assert.deepEqual(leaks(JSON.stringify(session.blobs), secrets), [], `${shape}: session`);
      assert.deepEqual(leaks(JSON.stringify(session.events), secrets), [], `${shape}: session events`);
      const prompts = promptsOf(session);
      assert.ok(prompts.includes(path), `${shape}: premise: the review requests show the change`);
      assert.deepEqual(leaks(prompts, secrets), [], `${shape}: review requests`);
    }
  });
}
