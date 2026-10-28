// D149: the reuse dry run of a change of two review units counts one request a unit, and asks none again: its judge
// refuses every request before sending it (`invalid_model_input`), and the code step asks no unit's call again.
//
// A synthetic session and snapshot, a temporary folder and an empty answer store: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dryRunReplay } from '../src/session-review.js';
import { createAnswerCache } from '../src/answer-cache.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, planReviewUnits, isCodeReviewLabel }
  from '../../evidence/src/code-pass.js';
import * as fixture from './code-pass-fixture.js';
import { scenario, linesOf, GIT } from '../../evidence/test/d149-hunk-ledger-fixture.js';

test('D149: the reuse dry run of a change of two units lists exactly two code review requests', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d149-dry-units-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = { 'src/one/a.js': linesOf('aa', 4_000), 'src/two/c.js': linesOf('cc', 3_500) };
  const { session, snapshot: frozen } = scenario({ codeSnapshotPlan, freezeCodeSnapshot, runCodePass, fixture }, { files });
  assert.equal(planReviewUnits(frozen).units.length, 2);
  const snapshot = { root: true, dir, top: dir, realRoot: dir, base: GIT, files: frozen, outsideFiles: [] };
  const model = SESSION_REVIEW_CLAUDE_CLI_MODEL;
  const answerCache = createAnswerCache(join(dir, 'answers'), { backend: 'claude-cli', model, readOnly: true });
  const replay = await dryRunReplay({ session, snapshot, backend: 'claude-cli', model, answerCache });
  assert.deepEqual(replay.codeRequests.map((r) => r.label).filter(isCodeReviewLabel),
    ['code-review:review:U1:R1', 'code-review:review:U2:R1']);
  assert.deepEqual(replay.codeHunks.map((e) => [e.path, e.shownIn]), [['src/one/a.js', ['code-review:review:U1:R1']],
    ['src/two/c.js', ['code-review:review:U2:R1']]]);
});
