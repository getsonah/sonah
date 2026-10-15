// F73: two windows that both saw the whole instruction inventory can legitimately publish the
// SAME pivot — windows no longer read each other's answers (W3-7), so `mergeWindowOutputs` is
// where that reconciliation now happens, exactly as it already does for requirements and
// promises. A flat concatenation published the same pivot twice.
//
// Synthetic only: no model, no network, no real session or recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReview, mergeWindowOutputs } from '../src/run-review.js';
import { Session } from '../src/session.js';

const REPO = { host: 'github.com', id: 'f73' };

function pivot(over = {}) {
  return { abandoned: 'an in-process cache', adopted: 'Redis',
    receipts: [{ eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_F73_SAID_1' }], ...over };
}

// F148: identity is the receipts alone — (eventId, quote), sorted. A pivot with different
// evidence is a different pivot; one with the same evidence is the same pivot however it is worded
// (packages/evidence/test/shortfalls-reach-reader.test.js, where pivots merge on their receipts).
test('F73 the merge reconciles pivots by sorted receipt identity, keeping the later window', () => {
  const first = pivot({ whyAbandoned: 'seen first' });
  const same = pivot({ whyAbandoned: 'seen second, same pivot' });
  const different = pivot({ adopted: 'Memcached', whyAbandoned: 'a different pivot entirely',
    receipts: [{ eventId: 'C2', role: 'commentary', quote: 'SYNTHETIC_F73_SAID_2' }] });
  const merged = mergeWindowOutputs({ repo: REPO, perWindow: [
    { decisions: [], findings: [], requirements: [], promises: [], pivots: [first] },
    { decisions: [], findings: [], requirements: [], promises: [], pivots: [same, different] },
  ] });

  assert.equal(merged.pivots.length, 2, 'the identical pivot was not reconciled into one row');
  assert.equal(merged.pivotsMerged, 1);
  // The later window's row is the one published — same rule as the shared-requirement case: a
  // later window's grounded answer replaces an earlier one, not the reverse.
  assert.equal(merged.pivots[0], same, 'the later window\'s pivot must be the one kept');
  assert.equal(merged.pivots[1], different);
});

test('F73 receipt order does not defeat identity: the same evidence cited in a different order is the same pivot', () => {
  const orderA = pivot({ receipts: [
    { eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_F73_SAID_1' },
    { eventId: 'O1', role: 'observation', quote: 'SYNTHETIC_F73_OUT_1' },
  ] });
  const orderB = pivot({ receipts: [
    { eventId: 'O1', role: 'observation', quote: 'SYNTHETIC_F73_OUT_1' },
    { eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_F73_SAID_1' },
  ] });
  const merged = mergeWindowOutputs({ repo: REPO, perWindow: [
    { decisions: [], findings: [], requirements: [], promises: [], pivots: [orderA] },
    { decisions: [], findings: [], requirements: [], promises: [], pivots: [orderB] },
  ] });
  assert.equal(merged.pivots.length, 1);
  assert.equal(merged.pivotsMerged, 1);
});

test('F73 mergeWindowOutputs tolerates windows with no pivots field at all', () => {
  const merged = mergeWindowOutputs({ repo: REPO, perWindow: [
    { decisions: [], findings: [], requirements: [], promises: [] },
  ] });
  assert.deepEqual(merged.pivots, []);
  assert.equal(merged.pivotsMerged, 0);
});

// ---- end-to-end: the same reconciliation through a real (synthetic) review -------------------
function twoWindowSession() {
  const blobs = {
    ask1: 'SYNTHETIC_F73_ASK_1: pick a cache backend and say what you tried first.',
    // M35 (windowing): a long statement (150,000 bytes) puts each segment in a window of its own (a compaction no longer
    // splits one).
    said1: `SYNTHETIC_F73_SAID_1: starting with an in-process map.\n${'f'.repeat(150_000)}`,
    ask2: 'SYNTHETIC_F73_ASK_2: keep going on the second half of the task.',
    said2: `SYNTHETIC_F73_SAID_2: continuing.\n${'f'.repeat(150_000)}`,
  };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', text: whole('ask1'), supersedes: [] },
    { id: 'C1', kind: 'commentary', sequence: 1, phase: 'working', text: whole('said1') },
    { id: 'B1', kind: 'boundary', sequence: 2, boundary: 'compaction' },
    { id: 'I2', kind: 'instruction', sequence: 3, authority: 'human', text: whole('ask2'), supersedes: [] },
    { id: 'C2', kind: 'commentary', sequence: 4, phase: 'working', text: whole('said2') },
  ];
  return new Session({ sessionKey: 'sess-f73', adapter: 'claude', events, blobs });
}

/** Both windows independently propose the identical, validly-grounded pivot: it cites the
 * instruction I1, which every later window's human instruction inventory makes visible (as an instruction-role receipt),
 * not only the one it was recorded in — exactly the mechanism the shared-requirement case already relies on. */
function judgeWithSharedPivot(request) {
  if (request.challenge)
    return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'The recorded instruction supports this reading.',
      receipts: [{ eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_F73_ASK_1' }] })) };
  return { decisions: [], claims: [], requirements: [], pivots: [{
    abandoned: 'an in-process map', adopted: 'Redis',
    receipts: [{ eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_F73_ASK_1' }] }] };
}

test('F73 two windows proposing the same pivot publish one row in the final report', async () => {
  const session = twoWindowSession();
  const report = await runReview({ session, pr: null, judge: judgeWithSharedPivot });
  assert.equal(report.pivots.length, 1, 'the same pivot was published once per window');
  assert.equal(report.pivotsRejected, 0);
  assert.equal(report.counts.pivotsMerged, 1);
});
