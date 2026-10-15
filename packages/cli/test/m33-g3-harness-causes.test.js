// M33 G3. The session-review harness summary records each declared cause of a partial coverage as
// `{ n, atLeast }`: a count, and whether it is exact or only a lower bound. C-06 counts a cause whose
// declarations stated no count by its declarations — at least one each — so a bare integer recorded
// "at least 1" exactly like a counted, exact "1". A fact with no count (no windows, no actions) is
// `{ n: null, atLeast: false }`. The summary also carries the published claims as a count.
// Synthetic sessions and a fake transport only: no recording, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Session } from '../../evidence/src/session.js';

const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS);
const SENTINEL = 'SYNTHETIC_G3_HARNESS';
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };

/** One ask, one command with a proven result, one hand-off with no linked child, one final word. */
function sessionWith(adapterGaps = []) {
  const blobs = { ask: `${SENTINEL}_ASK: run the checks and hand the docs to a helper.`, cmd: 'npm test',
    out: `${SENTINEL}_OUT: 3 passed`, brief: `${SENTINEL}_BRIEF: write the docs page.`,
    said: `${SENTINEL}_SAID: the checks pass and the docs are handed off.` };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const session = new Session({ sessionKey: 'session', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask') },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Bash', operation: 'command',
      paths: [], command: whole('cmd'), input: [], changes: [] },
    { id: 'A1-r', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native' },
    { id: 'D1', kind: 'invocation', sequence: 3, callKey: 'd1', tool: 'Task', operation: 'delegate',
      paths: [], command: [], input: whole('brief'), changes: [] },
    { id: 'C1', kind: 'commentary', sequence: 4, phase: 'final', beforeInvocation: null, text: whole('said') }] });
  session.adapterGaps = adapterGaps;
  return session;
}

async function run(t, session, answer = () => ({ ...EMPTY })) {
  const base = await mkdtemp(join(tmpdir(), 'sonah-m33-g3-harness-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const createJudge = ({ onResult }) => async (request) => {
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1 });
    return answer(request);
  };
  let stdout = '';
  const { summary } = await harness.runSessionReviewHarness({ parent: join(base, 'SYNTHETIC.jsonl'),
    codexHome: base, out: join(base, 'out'), backend: 'claude-cli', model: 'claude-synthetic-1', maxCalls: 50,
    maxSeconds: 60, timeoutMs: 1000, sessionKey: 'session', concurrency: 1 },
  { loadSession: async () => session, createJudge, write: (text) => { stdout += text; },
    progress: () => {}, installSignals: false });
  assert.doesNotMatch(stdout, new RegExp(SENTINEL), 'no session text leaves the harness');
  assert.deepEqual(JSON.parse(stdout.trim()), summary, 'stdout is the summary');
  return summary;
}

test('M33 G3 an exact cause is recorded as { n, atLeast: false }', async (t) => {
  const summary = await run(t, sessionWith());
  // D71 (a): the summary carries no status; the review completed over the recorder's declared limits.
  assert.equal(summary.sessionReview, 'complete');
  assert.ok(!Object.hasOwn(summary, 'sessionStatus'));
  assert.deepEqual(summary.coverageCauses, { delegations_unlinked: { n: 1, atLeast: false } });
});

test('M33 G3 a cause counted by its declarations is recorded as a lower bound, apart from an exact one', async (t) => {
  const summary = await run(t, sessionWith([
    { code: 'incomplete_inventory', channel: 'actions', scope: 'session', count: null, sessionKey: 'session', lossOrdinal: 0 },
    { code: 'source_clipped', channel: 'commentary', scope: 'session', count: 4, sessionKey: 'session' },
  ]));
  // D71 (a): the summary carries no status; the review completed over the recorder's declared limits.
  assert.equal(summary.sessionReview, 'complete');
  assert.ok(!Object.hasOwn(summary, 'sessionStatus'));
  assert.deepEqual(summary.coverageCauses, {
    delegations_unlinked: { n: 1, atLeast: false },
    incomplete_inventory: { n: 1, atLeast: true },
    source_clipped: { n: 4, atLeast: false },
  });
  for (const counts of Object.values(summary.coverageCauses)) {
    assert.deepEqual(Object.keys(counts).sort(), ['atLeast', 'n'], 'a closed shape');
    assert.ok(Number.isSafeInteger(counts.n) && counts.n > 0);
    assert.equal(typeof counts.atLeast, 'boolean');
  }
});

test('M33 G3 the summary counts published claims, and a claim that is a finding is not also one', async (t) => {
  const stated = { eventId: 'C1', role: 'commentary', quote: 'the checks pass and the docs are handed off.' };
  const summary = await run(t, sessionWith(), (request) => (request.challenge
    ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'The agent said so in its final message.', receipts: [stated] })) }
    : { ...EMPTY, claims: [{ text: `${SENTINEL}_CLAIM`, stated, contradictedBy: null },
      { text: `${SENTINEL}_CLAIM`, stated,
        contradictedBy: { eventId: 'A1-r', role: 'observation', quote: `${SENTINEL}_OUT: 3 passed` } }] }));
  assert.equal(summary.findings, 1, 'premise: the contradicted claim is a finding');
  assert.equal(summary.promises, 0, 'and it is not also an open promise');
});
