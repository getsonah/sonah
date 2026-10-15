// Synthetic sessions and injected judges only; no recordings or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { planWindowRequests, runReview, runProfile } from '../src/run-review.js';
import { reviewInputBytes, MAX_REVIEW_INPUT_BYTES } from '../src/challenge.js';
import { CODEX_REQUEST_MAX_BYTES, REVIEW_SPEED_PROFILE_NAMES } from '../src/review-profiles.js';
import { carriedContext, CODEX_WINDOW_SETTINGS, WINDOW_REQUEST_MAX_BYTES } from '../src/windows.js';
import { redisPivotSession } from '../fixtures/redis-pivot.js';

const empty = (extra = {}) => ({ decisions: [], pivots: [], claims: [], requirements: [], failures: [], ...extra });
function session({ thoughts = [], projectBytes = 0, output = null } = {}) {
  const blobs = { ask: 'SYNTHETIC_ASK: review the complete recorded work.', rule: `SYNTHETIC_RULE: ${'p'.repeat(projectBytes)}` };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key]) }];
  const events = [{ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask'), sequence: 0 }];
  for (const [at, size] of thoughts.entries()) {
    const key = `thought${at + 1}`;
    blobs[key] = `SYNTHETIC_THOUGHT_${at + 1}: ${'x'.repeat(size)}`;
    events.push({ id: `C${at + 1}`, kind: 'commentary', phase: 'working', text: ref(key), sequence: events.length });
  }
  if (output !== null) {
    blobs.command = 'node synthetic-tests.js';
    blobs.output = output;
    events.push({ id: 'A1', kind: 'invocation', operation: 'command', tool: 'Bash', command: ref('command'),
      paths: [], input: [], changes: [], sequence: events.length });
    events.push({ id: 'O1', kind: 'observation', invocation: 'A1', phase: 'terminal', result: 'succeeded',
      exitCode: 0, terminalStatusProven: true, output: ref('output'), sequence: events.length });
  }
  return new Session({ sessionKey: 'synthetic-codex-request-fit', adapter: 'codex', blobs, events,
    projectInstructions: [{ id: 'P1', kind: 'project-instructions', path: '/srv/synthetic/AGENTS.md',
      afterSequence: -1, text: ref('rule') }] });
}

test('complete request bound is Codex-only for every speed, including challenge and checkpoint profiles', () => {
  for (const speed of REVIEW_SPEED_PROFILE_NAMES) {
    const base = runProfile('session-only', speed);
    assert.equal(base.maxInputBytes, WINDOW_REQUEST_MAX_BYTES);
    for (const backend of ['claude-cli', 'anthropic-api']) assert.deepEqual(runProfile('session-only', speed, backend), base);
    const codex = runProfile('session-only', speed, 'codex-cli');
    assert.equal(codex.maxInputBytes, CODEX_REQUEST_MAX_BYTES);
    assert.equal(codex.challenge.maxInputBytes, CODEX_REQUEST_MAX_BYTES);
    assert.equal(codex.windowing.workTokens, 100_000);
    assert.equal(codex.windowing.carriedTokens, 100_000);
  }
  assert.deepEqual(runProfile('combined', undefined, 'codex-cli'), runProfile('combined'));
  assert.equal(runProfile('combined').maxInputBytes, MAX_REVIEW_INPUT_BYTES);
});

test('Codex fits the complete request by dropping the oldest carried thought, preserving current work and instructions', async () => {
  const s = session({ thoughts: [175_000, 175_000, 175_000], projectBytes: 120_000 });
  for (const speedProfile of REVIEW_SPEED_PROFILE_NAMES) {
    const args = { session: s, reviewScope: 'session-only', backend: 'codex-cli', speedProfile };
    const plan = planWindowRequests(args);
    assert.equal(plan.requests.length, 2);
    const last = plan.requests[1], full = carriedContext(s, last.window, CODEX_WINDOW_SETTINGS);
    assert.deepEqual(full.thoughts.map((e) => e.id), ['C1', 'C2']);
    assert.deepEqual(last.context.thoughts.map((e) => e.id), ['C2']);
    assert.equal(last.context.fitted, true);
    assert.equal(last.context.thoughtsLeftOut, 1);
    assert.ok(reviewInputBytes(last.request) <= CODEX_REQUEST_MAX_BYTES);
    assert.ok(reviewInputBytes(last.request) + full.thoughtBytes - last.context.thoughtBytes > CODEX_REQUEST_MAX_BYTES);
    for (const key of ['thought2', 'thought3', 'rule', 'ask']) assert.ok(last.request.prompt.includes(s.blobs[key]), key);
    assert.ok(!Object.hasOwn(last.sourceMap, 'C1'));
    assert.equal(planWindowRequests(args).requests[1].request.prompt, last.request.prompt);
    const report = await runReview({ ...args, plan, pr: null, judge: async (request) => {
      assert.ok(reviewInputBytes(request) <= CODEX_REQUEST_MAX_BYTES);
      return empty();
    } });
    assert.deepEqual(report.windowFailures, []);
    assert.equal(report.counts.carried.fittedWindows, 1);
    assert.equal(report.instrument.maxInputBytes, CODEX_REQUEST_MAX_BYTES);
    assert.equal(report.challenge.profile.maxInputBytes, CODEX_REQUEST_MAX_BYTES);
  }
});

test('current work exceeding the complete Codex bound is unreviewed_scope without clipping or a judge call', async () => {
  const s = session({ thoughts: [660_000] });
  const args = { session: s, reviewScope: 'session-only', backend: 'codex-cli' };
  const plan = planWindowRequests(args);
  assert.equal(plan.requests.length, 1);
  assert.ok(plan.requests[0].request.prompt.includes(s.blobs.thought1));
  assert.ok(reviewInputBytes(plan.requests[0].request) > CODEX_REQUEST_MAX_BYTES);
  const report = await runReview({ ...args, plan, pr: null, judge: async () => assert.fail('oversized work reached judge') });
  assert.equal(report.windowResults[0].failure, 'unreviewed_scope');
  const claude = await runReview({ session: s, reviewScope: 'session-only', backend: 'claude-cli', pr: null,
    judge: async () => empty() });
  assert.deepEqual(claude.windowFailures, []);
});

test('evidence re-asks use the Codex complete bound and retain the first answer when served text does not fit', async () => {
  const output = Array.from({ length: 500 }, (_, at) => `synthetic line ${at + 1}: ${'o'.repeat(100)}`).join('\n');
  const initial = session({ output });
  const overhead = reviewInputBytes(planWindowRequests({ session: initial, reviewScope: 'session-only', backend: 'codex-cli' }).requests[0].request);
  const s = session({ output, projectBytes: CODEX_REQUEST_MAX_BYTES - 10_000 - overhead });
  for (const backend of ['codex-cli', 'claude-cli']) {
    const seen = [];
    const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', backend,
      judge: async (request) => {
        seen.push(request);
        return empty(request.label.endsWith(':evidence') ? {} : {
          evidenceRequests: [{ eventId: 'O1', fromLine: 100, throughLine: 300 }] });
      } });
    assert.ok(reviewInputBytes(seen[0]) < CODEX_REQUEST_MAX_BYTES);
    if (backend === 'codex-cli') {
      assert.equal(seen.length, 1);
      assert.equal(report.windowResults[0].evidence.refused.request_bound, 1);
      assert.equal(report.windowResults[0].evidence.reasks, 0);
    } else {
      assert.equal(seen.length, 2);
      assert.ok(reviewInputBytes(seen[1]) > CODEX_REQUEST_MAX_BYTES);
      assert.equal(report.windowResults[0].evidence.reasks, 1);
    }
  }
});

test('challenge candidates over the Codex complete bound are unchecked while the Claude challenge still runs', async () => {
  const s = redisPivotSession();
  const candidate = { dimension: 'Synthetic dimension '.repeat(36_000), chosen: 'Redis', actions: ['E3'],
    value: 'config/redis.yml', valueReceipt: { eventId: 'E3', field: 'path', role: 'action', quote: 'config/redis.yml' },
    constrainedBy: { instruction: { eventId: 'E1', role: 'instruction', quote: 'Add response caching' }, settles: false, settledValueQuote: null } };
  for (const backend of ['codex-cli', 'claude-cli']) {
    const challenges = [];
    const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', backend,
      judge: async (request) => {
        if (!request.challenge) return empty({ decisions: [candidate] });
        challenges.push(request);
        return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted', explanation: 'Synthetic.',
          receipts: [{ eventId: 'E1', role: 'instruction', quote: 'Add response caching' }] })) };
      } });
    if (backend === 'codex-cli') {
      assert.equal(challenges.length, 0);
      assert.equal(report.challenge.budgetExhausted, true);
      assert.equal(report.challenge.executionComplete, false);
    } else {
      assert.equal(challenges.length, 3);
      assert.ok(challenges.every((request) => reviewInputBytes(request) > CODEX_REQUEST_MAX_BYTES));
    }
  }
});
