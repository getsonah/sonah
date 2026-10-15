// W3c-2 / F88 at the evidence boundary: what a session-only request is made of. D60 (W3f-1): and
// how a stored answer to a window's request is used — only for the byte-identical request, and
// always grounded again. (Before D60 this file pinned the window capsule `runReview` accepted
// through `reuseWindow`; that path is gone.) Synthetic input only: no model, no provider, no
// recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReview } from '../src/run-review.js';
import { snapshotDiff } from '../src/code-review.js';
import { buildCodeReviewPrompt, windowDiff } from '../src/code-review-prompt.js';
import { buildNarrativePrompt } from '../src/prompt.js';
import { planWindows } from '../src/windows.js';
import { Session } from '../src/session.js';
import { renderReview } from '../src/review.js';
import { createAnswerCache, memoizeJudge } from '../../cli/src/answer-cache.js';

const ASK = 'SYNTHETIC_SWE_ASK: add a cache to the lookup path.';
const SAID = 'SYNTHETIC_SWE_SAID: adding the cache module now.';
function oneWindow() {
  const blobs = { ask: ASK, said: SAID, ok: 'SYNTHETIC_SWE_OK: written' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  return new Session({ sessionKey: 'sess-swe', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', sequence: 0, text: whole('ask'), supersedes: [] },
    { id: 'C1', kind: 'commentary', phase: 'working', sequence: 1, text: whole('said') },
    { id: 'A1', kind: 'invocation', operation: 'write', tool: 'Write', sequence: 2, paths: [{ path: 'src/cache.js' }] },
    { id: 'O1', kind: 'observation', phase: 'terminal', invocation: 'A1', result: 'succeeded', sequence: 3, output: whole('ok') },
  ] });
}
const PR = { repo: { host: 'github.com', id: '5' }, number: 3, baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40),
  enumeration: 'complete', files: [{ path: 'src/other.js', change: 'modified', contentState: 'complete' }] };
const DIFF = 'diff --git a/src/other.js b/src/other.js\n--- a/src/other.js\n+++ b/src/other.js\n@@ -1 +1 @@\n-old\n+SYNTHETIC_SWE_CODE();\n';
const narrative = { pivots: [], claims: [], requirements: [], decisions: [{
  dimension: 'SYNTHETIC_SWE_DIMENSION', chosen: 'Add src/cache.js', actions: ['A1'], value: 'src/cache.js',
  valueReceipt: { eventId: 'A1', role: 'action', field: 'path', quote: 'src/cache.js' },
  stated: { eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_SWE_SAID' },
  constrainedBy: { instruction: { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_SWE_ASK' },
    settles: false, settledValueQuote: null } }] };
const judgeOf = (calls) => async (request) => {
  calls.push(request.label);
  if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'The recorded instruction supports it.', receipts: [{ eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_SWE_ASK' }] })) };
  return structuredClone(narrative);
};
// What the windowed code review hands `runReview` for a window that placed nothing.
const sessionOnlySlice = () => ({ hunks: '', manifest: null, placed: [], omitted: [] });

test('W3c-2 windowDiff withholds the manifest from a window that places nothing; a touching window keeps it', () => {
  const session = oneWindow();
  const [window] = planWindows(session);
  const snapshot = snapshotDiff({ pr: PR, diff: DIFF });
  const none = windowDiff(window, session, snapshot);
  assert.deepEqual(none.placed, []);
  assert.equal(none.manifest, null);
  const touching = { ...PR, files: [{ path: 'src/cache.js', change: 'modified', contentState: 'complete' }] };
  const shown = windowDiff(window, session, snapshotDiff({ pr: touching,
    diff: DIFF.replaceAll('src/other.js', 'src/cache.js') }));
  assert.deepEqual(shown.placed, ['src/cache.js']);
  assert.match(shown.manifest, /## Changed files \(manifest\)/);
});

test('W3c-2 a session-only joint request carries no manifest, no revision and no source', () => {
  const session = oneWindow();
  const [window] = planWindows(session);
  const narrativePrompt = buildNarrativePrompt({ session, window, diff: null, hunks: '', manifest: null });
  const request = buildCodeReviewPrompt({ narrativePrompt, snapshot: snapshotDiff({ pr: PR, diff: DIFF }), placed: [] });
  for (const forbidden of ['## Frozen PR manifest', '## Changed files (manifest)', 'src/other.js', 'a'.repeat(40),
    'b'.repeat(40), 'SOURCE {', 'SYNTHETIC_SWE_CODE'])
    assert.ok(!request.prompt.includes(forbidden), `session-only request carries ${forbidden}`);
  assert.match(request.prompt, /## Pull-request code — none in this request/);
  // A caller that renders a manifest (the byte-budget probe) keeps the old shape — and says so
  // with the flag (F153); the heading in its text decides nothing.
  const probe = buildNarrativePrompt({ session, window, diff: null, hunks: '', manifest: '## Changed files (manifest) — untrusted evidence' });
  assert.match(buildCodeReviewPrompt({ narrativePrompt: probe, snapshot: snapshotDiff({ pr: PR, diff: DIFF }), placed: [],
    manifestRendered: true }).prompt, /## Frozen code sources/);
});

// ---- D60: a stored answer is used only for its own bytes, and always grounded again -------------
async function answerStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-swe-answers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createAnswerCache(directory, { backend: 'synthetic', model: 'synthetic' });
  return { cache, review: (judge) => memoizeJudge(judge, cache) };
}
const recording = (asked, judge) => async (request) => { asked.push(request); return judge(request); };

test('D60 a stored answer whose quote no longer verifies is grounded again and withheld; nothing blames the model', async (t) => {
  const { cache, review } = await answerStore(t);
  const asked = [];
  const first = await runReview({ session: oneWindow(), pr: PR, judge: review(recording(asked, judgeOf([]))) });
  assert.equal(first.decisions.length, 1, 'premise');
  const forged = structuredClone(narrative);
  forged.decisions[0].stated.quote = 'SYNTHETIC_SWE_NEVER_SAID_ANYTHING_LIKE_THIS';
  assert.equal(await cache.put(asked.find((r) => r.label === 'narrative:w1'), forged), true);
  const calls = [];
  const again = await runReview({ session: oneWindow(), pr: PR, judge: review(judgeOf(calls)) });
  assert.ok(!calls.includes('narrative:w1'), 'the stored answer was used');
  const [w] = again.windowResults;
  assert.equal(w.failure, null);
  assert.equal(w.shortfall.narrative, 'ok', 'a stored answer is not a model failure');
  assert.equal(Object.hasOwn(w.shortfall, 'reuse'), false, 'there is no cache verdict to report');
  assert.equal(again.decisions.length, 0, 'the unverifiable proposal is not published');
  assert.ok(!JSON.stringify([again.decisions, again.findings]).includes('NEVER_SAID'));
  assert.equal(again.withheld.proposals, 1, 'it is withheld and counted, as a live one would be');
});

test('D60 a corrupt stored answer is a miss: the window is asked live, and the report says nothing about a cache', async (t) => {
  const { cache, review } = await answerStore(t);
  const first = await runReview({ session: oneWindow(), pr: PR, judge: review(judgeOf([])) });
  for (const file of await readdir(cache.directory)) await writeFile(join(cache.directory, file), '{ not json');
  const calls = [];
  const again = await runReview({ session: oneWindow(), pr: PR, judge: review(judgeOf(calls)) });
  assert.ok(calls.includes('narrative:w1'), 'asked live');
  assert.equal(again.windowResults[0].failure, null);
  assert.equal(again.windowResults[0].shortfall.narrative, 'ok');
  assert.equal(again.coverage, 'complete');
  assert.equal(renderReview(again), renderReview(first), 'the reader sees the same report');
  assert.doesNotMatch(renderReview(again), /cached answer|cache_revalidation_failed/);
});

test('D60 a session-only window is answered from the cache only for its byte-identical request', async (t) => {
  const { review } = await answerStore(t);
  await runReview({ session: oneWindow(), pr: PR, judge: review(judgeOf([])), windowDiffFor: sessionOnlySlice });
  const hit = [];
  const replayed = await runReview({ session: oneWindow(), pr: PR, judge: review(judgeOf(hit)), windowDiffFor: sessionOnlySlice });
  assert.deepEqual(hit, [], 'the same session-only request, the same answer, no call');
  assert.equal(replayed.decisions.length, 1);
  const touching = [];
  await runReview({ session: oneWindow(), pr: PR, judge: review(judgeOf(touching)),
    windowDiffFor: () => ({ hunks: 'x', manifest: '## Changed files (manifest)', placed: ['src/cache.js'], omitted: [] }) });
  assert.ok(touching.includes('narrative:w1'), 'a window that now carries the PR asks a different question');
});

