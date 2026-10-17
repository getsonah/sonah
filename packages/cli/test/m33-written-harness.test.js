// C-06 "M33 written statements". The session-review harness summary counts the written statements the
// review published by closed label (`unverified`, `contradicted`), and the ones it withheld by closed
// cause, as integers only. No statement text, quote or path leaves the harness.
// Synthetic session (/srv/x paths) and a fake transport only: no recording, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Session } from '../../evidence/src/session.js';
import { WRITTEN_LABELS, WRITTEN_WITHHELD_CAUSES } from '../../evidence/src/ledger.js';

const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS);
const SENTINEL = 'SYNTHETIC_WH';

const blobs = {
  ask: `${SENTINEL}_ASK: write the synthetic notes.`,
  notes: `# notes\n${SENTINEL}_STATUS: every synthetic check passes.\n${SENTINEL}_SCOPE: covers the empty input.\n`,
  wrote: `${SENTINEL}_WROTE: file created`,
  cmd: 'node /srv/x/check.js',
  failed: `${SENTINEL}_FAILED: 1 check failed`,
};
const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
const session = () => new Session({ sessionKey: 'session', adapter: 'claude', blobs, events: [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask') },
  { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Write', operation: 'write', paths: [{ path: '/srv/x/NOTES.md' }],
    command: [], input: [], changes: [{ path: '/srv/x/NOTES.md', before: [], after: ref('notes'), diff: [] }] },
  { id: 'A1-r', kind: 'observation', phase: 'terminal', invocation: 'A1', callKey: 'A1', result: 'succeeded',
    exitCode: null, terminalStatusProven: true, sourceOfResult: 'native', output: ref('wrote') },
  { id: 'X1', kind: 'invocation', callKey: 'X1', tool: 'Bash', operation: 'command', paths: [], command: ref('cmd'),
    input: [], changes: [] },
  { id: 'X1-r', kind: 'observation', phase: 'terminal', invocation: 'X1', callKey: 'X1', result: 'failed', exitCode: 1,
    terminalStatusProven: true, sourceOfResult: 'native', output: ref('failed') },
].map((event, sequence) => ({ ...event, sequence })) });

async function run(t, answer) {
  const base = await mkdtemp(join(tmpdir(), 'sonah-m33-written-harness-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const createJudge = ({ onResult }) => async (request) => {
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1 });
    return answer(request);
  };
  let stdout = '';
  const { summary } = await harness.runSessionReviewHarness({ parent: join(base, 'SYNTHETIC.jsonl'),
    codexHome: base, out: join(base, 'out'), backend: 'claude-cli', model: 'claude-synthetic-1', maxCalls: 50,
    maxSeconds: 60, timeoutMs: 1000, sessionKey: 'session', concurrency: 1 },
  { loadSession: async () => session(), createJudge, write: (text) => { stdout += text; },
    progress: () => {}, installSignals: false });
  assert.doesNotMatch(stdout, new RegExp(SENTINEL), 'no session text leaves the harness');
  assert.deepEqual(JSON.parse(stdout.trim()), summary, 'stdout is the summary');
  return summary;
}

test('M33 written: the harness summary counts written statements by closed label, and withheld ones by cause', async (t) => {
  const failed = { eventId: 'X1-r', role: 'observation', quote: `${SENTINEL}_FAILED: 1 check failed` };
  const stated = (quote) => ({ eventId: 'A1', role: 'code', quote });
  const summary = await run(t, (request) => (request.challenge
    ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted', explanation: 'Recorded.',
      receipts: [failed] })) }
    : { decisions: [], pivots: [], claims: [], requirements: [], writtenClaims: [
      { text: `${SENTINEL} status`, stated: stated(`${SENTINEL}_STATUS: every synthetic check passes.`), contradictedBy: failed },
      { text: `${SENTINEL} scope`, stated: stated(`${SENTINEL}_SCOPE: covers the empty input.`), contradictedBy: null },
      `${SENTINEL} not an object`] }));
  assert.equal(summary.schema, 'sonah.session-review-harness/19');
  assert.equal(summary.state, 'finished');
  assert.deepEqual(Object.keys(summary.writtenClaims).sort(), [...WRITTEN_LABELS].sort(), 'every closed label, always');
  assert.deepEqual(summary.writtenClaims, { unverified: 1, contradicted: 1 });
  assert.equal(summary.findings, 0, 'a written statement is never a finding');
  assert.equal(summary.sessionReview, 'complete');
  assert.equal(summary.withheld.proposals, 1);
  assert.equal(summary.withheld.causes.written_unreadable, 1);
  for (const cause of WRITTEN_WITHHELD_CAUSES) assert.ok(Number.isSafeInteger(summary.withheld.causes[cause]), cause);
});

test('M33 written: a summary with no written statement still carries the closed zero counts', async (t) => {
  const summary = await run(t, () => ({ decisions: [], pivots: [], claims: [], requirements: [] }));
  assert.deepEqual(summary.writtenClaims, { unverified: 0, contradicted: 0 });
});

test('M33 written: a statement whose identity cannot be computed is withheld, and its stored answer never fails a review', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'sonah-m33-written-harness-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  // What the transport's JSON parser returns for an escaped lone surrogate: text no identity digest accepts.
  const lone = JSON.parse(JSON.stringify({ decisions: [], pivots: [], claims: [], requirements: [], writtenClaims: [
    { text: `${SENTINEL} status LONE`, stated: { eventId: 'A1', role: 'code', quote: `${SENTINEL}_STATUS: every synthetic check passes.` },
      contradictedBy: null }] }).replace('LONE', '\\ud800'));
  let narrativeCalls = 0;
  const createJudge = ({ onResult }) => async (request) => {
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1 });
    if (request.challenge) return { votes: [] };
    narrativeCalls++;
    return structuredClone(lone);
  };
  // The first review asks live; the second replays the stored answer (D60) and must finish the same way.
  for (const attempt of [1, 2]) {
    let stdout = '';
    const { summary } = await harness.runSessionReviewHarness({ parent: join(base, 'SYNTHETIC.jsonl'),
      codexHome: base, out: join(base, 'out'), backend: 'claude-cli', model: 'claude-synthetic-1', maxCalls: 50,
      maxSeconds: 60, timeoutMs: 1000, sessionKey: 'session', concurrency: 1 },
    { loadSession: async () => session(), createJudge, write: (text) => { stdout += text; },
      progress: () => {}, installSignals: false });
    assert.doesNotMatch(stdout, new RegExp(SENTINEL), 'no session text leaves the harness');
    assert.equal(summary.state, 'finished', `attempt ${attempt}`);
    assert.equal(summary.withheld.causes.written_unreadable, 1, `attempt ${attempt}`);
    assert.deepEqual(summary.writtenClaims, { unverified: 0, contradicted: 0 }, `attempt ${attempt}`);
    assert.equal(summary.sessionReview, 'complete', `attempt ${attempt}`);
  }
  assert.equal(narrativeCalls, 1, 'the stored answer was replayed, and it no longer fails the review');
});
