// The ignore rules are a safety control, not housekeeping: transcripts carry live credentials, and the synthetic
// recordings the tests read must stay committed. So they are asserted rather than trusted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { needsCheckout } from './git-checkout.js';

// fileURLToPath, never URL.pathname: a checkout may live under "Acme Labs", and .pathname
// percent-encodes the space.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Without a checkout, git has no ignore rules to report: these tests are skipped, never passed on a git error.
const NO_CHECKOUT = needsCheckout(ROOT);

/** Whether git ignores `path`: its exit status 0 is yes, 1 is no; anything else is git failing, never a no. */
function ignored(path) {
  const run = spawnSync('git', ['check-ignore', '-q', path], { cwd: ROOT, stdio: 'ignore' });
  if (run.status === 0 || run.status === 1) return run.status === 0;
  throw new Error(`git check-ignore failed on ${path}: ${run.error?.code ?? `exit status ${run.status}`}`);
}

test('session data is ignored under any filename', { skip: NO_CHECKOUT }, () => {
  // The original rule was corpus/sessions/*.jsonl, which admitted a session saved as .json.
  for (const p of [
    'corpus/sessions/real.jsonl',
    'corpus/sessions/leak.json',
    'corpus/sessions/nested/deep.jsonl',
  ]) assert.equal(ignored(p), true, p);
});

test('golden fixtures stay committed — they are the test suite', { skip: NO_CHECKOUT }, () => {
  assert.equal(ignored('corpus/golden/d04-clean.jsonl'), false);
});

test('generated review output is ignored — it quotes real session text', { skip: NO_CHECKOUT }, () => {
  assert.equal(ignored('SONAH-REVIEW-OF-THIS-SESSION.md'), true);
});
