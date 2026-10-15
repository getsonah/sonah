// C3.1a: synthetic bytes and fake judges only. No recording or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { planWindowRequests, runReview, runProfile } from '../src/run-review.js';
import { windowSettingsOf, windowingProfileOf } from '../src/windows.js';

function session() {
  const blobs = { ask: 'Review all three synthetic steps.' };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key]) }];
  const events = [{ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask'), sequence: 0 }];
  for (let k = 1; k <= 3; k++) {
    blobs[`thought${k}`] = `SYNTHETIC_THOUGHT_${k}: ${'x'.repeat(175_000)}`;
    events.push({ id: `C${k}`, kind: 'commentary', phase: 'working', beforeInvocation: null,
      text: ref(`thought${k}`), sequence: k });
  }
  const projectInstructions = Array.from({ length: 3 }, (_, at) => {
    const key = `rule${at + 1}`;
    blobs[key] = `SYNTHETIC_PROJECT_RULE_${at + 1}: keep the recorded step whole.`;
    return { id: `P${at + 1}`, kind: 'project-instructions', path: `/srv/synthetic/rule-${at + 1}/AGENTS.md`,
      afterSequence: -1, text: ref(key) };
  });
  return new Session({ sessionKey: 'synthetic-codex-window-profile', adapter: 'codex', blobs, events, projectInstructions });
}
const empty = () => ({ decisions: [], pivots: [], claims: [], requirements: [], failures: [] });
const bytes = (plan) => plan.requests.map(({ request }) => [request.system, request.prompt, request.evidencePrompt, request.label]);

test('Codex session windows split whole thoughts, while explicit Claude and default plans retain identical bytes', () => {
  const s = session();
  for (const speedProfile of ['standard', 'm33-fast', 'm33-lean']) {
    const args = { session: s, reviewScope: 'session-only', speedProfile };
    const base = planWindowRequests(args);
    const codex = planWindowRequests({ ...args, backend: 'codex-cli' });
    assert.equal(base.windows.length, 1);
    assert.equal(codex.windows.length, 2);
    assert.deepEqual([...new Set(codex.windows.flatMap((w) => w.events).map((e) => e.id))], s.events.map((e) => e.id));
    for (const built of codex.requests) for (let k = 1; k <= 3; k++)
      assert.ok(built.request.prompt.includes(s.blobs[`rule${k}`]), 'project instructions remain visible');
    assert.deepEqual(codex.windows.flatMap((w) => w.events).filter((e) => e.kind === 'commentary').map((e) => e.id), ['C1', 'C2', 'C3']);
    for (const built of codex.requests) for (const event of built.window.events.filter((e) => e.kind === 'commentary'))
      assert.ok(built.request.prompt.includes(s.blobs[`thought${event.sequence}`]), 'a whole thought reaches its request');
    for (const backend of ['claude-cli', 'anthropic-api']) {
      assert.deepEqual(bytes(planWindowRequests({ ...args, backend })), bytes(base));
      assert.deepEqual(runProfile('session-only', speedProfile, backend), runProfile('session-only', speedProfile));
    }
    assert.notDeepEqual(runProfile('session-only', speedProfile, 'codex-cli'), runProfile('session-only', speedProfile));
  }
  assert.deepEqual(windowSettingsOf('combined', 'codex-cli'), windowSettingsOf('combined'));
  assert.deepEqual(windowingProfileOf('combined', 'codex-cli'), windowingProfileOf('combined'));
});

test('runReview selects Codex windowing for its requests and report', async () => {
  const s = session(), calls = [];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', backend: 'codex-cli',
    judge: async (request) => { calls.push(request.label); return empty(); } });
  assert.equal(report.windowResults.length, 2);
  assert.ok(calls.includes('narrative:w1') && calls.includes('narrative:w2'));
  assert.deepEqual(report.instrument.windowing, windowingProfileOf('session-only', 'codex-cli'));
});

test('a precomputed plan from different window settings is rejected before the judge', async () => {
  const s = session();
  for (const [planned, running] of [[undefined, 'codex-cli'], ['codex-cli', 'claude-cli']]) {
    const plan = planWindowRequests({ session: s, reviewScope: 'session-only', backend: planned });
    await assert.rejects(runReview({ session: s, pr: null, reviewScope: 'session-only', backend: running, plan,
      judge: async () => assert.fail('cross-profile plan reached the judge') }), /precomputed plan/);
  }
});
