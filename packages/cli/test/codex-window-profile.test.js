// C3.1a: exercise the CLI's automatic profile and real temporary checkpoint/cache stores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../../evidence/src/session.js';
import { createAnswerCache } from '../src/answer-cache.js';
import { reviewSession, createSessionReviewStore, sessionProfileDigest, windowKeyOf } from '../src/session-review.js';
import { planWindowRequests } from '../../evidence/src/run-review.js';
import { windowingProfileOf } from '../../evidence/src/windows.js';

function session() {
  const blobs = { ask: 'Review these synthetic steps.' };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key]) }];
  const events = [{ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask'), sequence: 0 }];
  for (let k = 1; k <= 3; k++) {
    blobs[`thought${k}`] = `SYNTHETIC_CLI_THOUGHT_${k}: ${'x'.repeat(175_000)}`;
    events.push({ id: `C${k}`, kind: 'commentary', phase: 'working', beforeInvocation: null,
      text: ref(`thought${k}`), sequence: k });
  }
  return new Session({ sessionKey: 'synthetic-cli-codex-window-profile', adapter: 'codex', blobs, events });
}

test('session checkpoint profile identity preserves default/Claude and separates Codex for every speed', () => {
  for (const speed of ['standard', 'm33-fast', 'm33-lean']) {
    const base = sessionProfileDigest(speed);
    assert.equal(sessionProfileDigest(speed, 'claude-cli'), base);
    assert.equal(sessionProfileDigest(speed, 'anthropic-api'), base);
    assert.notEqual(sessionProfileDigest(speed, 'codex-cli'), base);
    const answerKey = 'a'.repeat(64);
    assert.notEqual(windowKeyOf({ answerKey, profile: base, window: 1 }),
      windowKeyOf({ answerKey, profile: sessionProfileDigest(speed, 'codex-cli'), window: 1 }));
  }
});

test('CLI Codex backend automatically uses smaller windows and restarts from its own checkpoint/cache', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-codex-profile-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const identity = { backend: 'codex-cli', model: 'synthetic-model' };
  const answerCache = createAnswerCache(join(dir, 'answers'), identity);
  const store = createSessionReviewStore(join(dir, 'review'));
  const s = session(), records = [];
  const judge = async () => ({ decisions: [], pivots: [], claims: [], requirements: [], failures: [] });
  const first = await reviewSession({ session: s, judge, answerCache, store, ...identity });
  assert.equal(first.progress.windows.total, 2, 'backend reaches planning without a manually selected profile');
  assert.deepEqual(first.report.instrument.windowing, windowingProfileOf('session-only', 'codex-cli'));
  const planned = planWindowRequests({ session: s, reviewScope: 'session-only', backend: 'codex-cli' });
  for (const [index, built] of planned.requests.entries()) {
    const key = windowKeyOf({ answerKey: answerCache.keyOf(built.request),
      profile: sessionProfileDigest(undefined, 'codex-cli'), window: index + 1 });
    records.push(await store.readWindow({ windowKey: key, window: index + 1 }));
  }
  assert.ok(records.every((r) => r.record), 'checkpoint identity uses the resolved Codex profile');
  const again = await reviewSession({ session: s, answerCache, store, ...identity,
    judge: async () => assert.fail('restart should reuse every stored answer') });
  assert.equal(again.progress.windows.replayed, 2);
  assert.equal(again.progress.calls.live, 0);
  assert.equal(again.progress.checkpoint.recordsRead, 2);
});
