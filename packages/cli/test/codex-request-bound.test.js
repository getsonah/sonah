import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REVIEW_INPUT_BYTES } from '../../evidence/src/challenge.js';
import { boundedJudge } from '../src/session-review.js';
import { CODEX_REQUEST_MAX_BYTES, REVIEW_SPEED_PROFILE_NAMES } from '../../evidence/src/review-profiles.js';
import { WINDOW_REQUEST_MAX_BYTES } from '../../evidence/src/windows.js';

test('CLI guard admits the exact Codex byte bound and refuses one more byte before any physical call or retry', async () => {
  for (const speedProfile of REVIEW_SPEED_PROFILE_NAMES) {
    let calls = 0;
    const measured = [];
    const judge = boundedJudge(async () => { calls++; return {}; }, (record) => measured.push(record),
      { speedProfile, reviewScope: 'session-only', backend: 'codex-cli' });
    // Multibyte text verifies UTF-8 bytes, rather than JavaScript character counts.
    const exact = { system: 'é', prompt: 'x'.repeat(CODEX_REQUEST_MAX_BYTES - 2), label: 'synthetic:exact' };
    await judge(exact);
    await assert.rejects(judge({ ...exact, prompt: `${exact.prompt}x`, label: 'synthetic:over' }),
      (error) => error.code === 'budget_exhausted');
    assert.equal(calls, 1);
    assert.deepEqual(measured, [{ label: 'synthetic:exact', bytes: CODEX_REQUEST_MAX_BYTES, allowed: true },
      { label: 'synthetic:over', bytes: CODEX_REQUEST_MAX_BYTES + 1, allowed: false }]);
  }
});

test('default/Claude/API CLI guards keep their session limit and the combined scope keeps its own', async () => {
  for (const backend of [undefined, 'claude-cli', 'anthropic-api']) {
    for (const speedProfile of REVIEW_SPEED_PROFILE_NAMES) {
      const judge = boundedJudge(async () => ({}), () => {}, { backend, speedProfile, reviewScope: 'session-only' });
      await judge({ system: '', prompt: 'x'.repeat(WINDOW_REQUEST_MAX_BYTES) });
      await assert.rejects(judge({ system: 'x', prompt: 'x'.repeat(WINDOW_REQUEST_MAX_BYTES) }),
        (error) => error.code === 'budget_exhausted');
    }
  }
  const combined = boundedJudge(async () => ({}), () => {}, { backend: 'codex-cli' });
  await combined({ system: '', prompt: 'x'.repeat(MAX_REVIEW_INPUT_BYTES) });
  await assert.rejects(combined({ system: 'x', prompt: 'x'.repeat(MAX_REVIEW_INPUT_BYTES) }),
    (error) => error.code === 'budget_exhausted');
});
