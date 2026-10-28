// D158: the claims-against-runs join (claims.js `editsAfterSupport`, `claimsAgainstRuns`) — each verified claim beside
// the edits recorded after the run that supports it — and the review's switch for the session's edge maps
// (run-review.js `runReview`, `sessionEdgeMaps`): off by default, and off no request or report byte moves. Synthetic
// sessions only: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { editsAfterSupport, claimsAgainstRuns } from '../src/claims.js';
import { struggleMap } from '../src/struggle.js';
import { runReview } from '../src/run-review.js';
import { SESSION_EDGE_VERSION } from '../src/ledger.js';
import { edgeSession, ROWS, build, VERIFIED, WORKING, NO_EDIT_AFTER, receipt } from './d158-session-edge-fixture.js';

const AFTER = [{ eventId: 'ED3', path: 'README.md', effect: 'landed' },
  { eventId: 'WE1', path: 'lib/x.js', effect: 'unknown' }, { eventId: 'ED4', path: 'CHANGELOG.md', effect: 'landed' }];

test('D158: the edits recorded after a verified claim\'s supporting run, golden', () => {
  assert.deepEqual(editsAfterSupport(edgeSession(), VERIFIED),
    { run: 'A3', result: 'A3-r', closing: true, edits: AFTER });
  const gone = { ...VERIFIED, id: 'p:gone', receipts: [VERIFIED.receipts[0], receipt('X9', 'observation', 'gone')] };
  // Every count told apart: a closing claim edited after, one not closing edited after, one closing with no edit after
  // its support, one unread, one open, one not a claim.
  assert.deepEqual(claimsAgainstRuns(edgeSession(), [VERIFIED, WORKING, NO_EDIT_AFTER,
    { ...VERIFIED, id: 'p:open', status: 'open' }, gone, null]), {
    claims: [{ promise: 'p:verified', run: 'A3', result: 'A3-r', closing: true, edits: AFTER },
      { promise: 'p:working', run: 'A3', result: 'A3-r', closing: false, edits: AFTER },
      { promise: 'p:last', run: 'A5', result: 'A5-r', closing: true, edits: [] }],
    counts: { verified: 4, unread: 1, editedAfter: 2, landedAfter: 2, closing: 2, closingEditedAfter: 1 } });
});

test('D158: only a verified claim whose support is a recorded RESULT is read; its status is never touched', () => {
  const session = edgeSession();
  for (const promise of [{ ...VERIFIED, status: 'open' }, { ...VERIFIED, status: 'incomplete' }, null, 'p',
    { ...VERIFIED, receipts: [VERIFIED.receipts[0]] },
    { ...VERIFIED, receipts: [VERIFIED.receipts[0], receipt('A3', 'action', 'npm test')] },
    { ...VERIFIED, receipts: [VERIFIED.receipts[0], receipt('C1', 'observation', 'All tests')] }])
    assert.equal(editsAfterSupport(session, promise), null, JSON.stringify(promise));
  const promise = structuredClone(VERIFIED);
  claimsAgainstRuns(session, [promise]);
  assert.deepEqual(promise, VERIFIED);
});

test('D158: the supporting command\'s own write is not an edit after it', () => {
  // A2 passes; A3 tees the tests' output into out.txt; A4 writes src/util.js and runs the tests, which pass.
  const session = build([['I1', 'ask', 'ask'], ['A2', 'cmd', 'status'], ['A2-r', 'ok', 'pass', { of: 'A2' }],
    ['A3', 'cmd', 'teeRun'], ['A3-r', 'uncovered', 'pass', { of: 'A3' }], ['A3-w', 'parsed', 'pass', { of: 'A3', path: 'out.txt' }],
    ['A4', 'cmd', 'sedUtil'], ['A4-r', 'ok', 'pass', { of: 'A4' }], ['A4-w', 'parsed', 'greet', { of: 'A4', path: 'src/util.js' }],
    ['C1', 'said', 'said', { phase: 'final' }]]);
  const claim = (support) => ({ ...VERIFIED, receipts: [VERIFIED.receipts[0], receipt(support, 'observation', 'ok 1')] });
  assert.deepEqual(editsAfterSupport(session, claim('A4-r')).edits, []);
  assert.deepEqual(editsAfterSupport(session, claim('A3-r')).edits, [{ eventId: 'A4-w', path: 'src/util.js', effect: 'landed' }]);
  assert.deepEqual(editsAfterSupport(session, claim('A2-r')).edits, [{ eventId: 'A3-w', path: 'out.txt', effect: 'unknown' },
    { eventId: 'A4-w', path: 'src/util.js', effect: 'landed' }]);
});

test('D158: the edits are ordered, in the repository, and bounded by `until`', () => {
  // A claim whose words are not the last message of their turn is not a closing claim.
  const working = build(ROWS.map((row) => (row[0] === 'C1' ? ['C1', 'said', 'said'] : row)));
  assert.equal(editsAfterSupport(working, VERIFIED).closing, false);
  // An edit outside the repository is not read; one that failed changed nothing.
  const outside = build(ROWS.map((row) => (row[0] === 'ED3' ? ['ED3', 'edit', 'readme', { path: 'README.md',
    outside: true }] : row[0] === 'ED4-r' ? ['ED4-r', 'fail', 'updated', { of: 'ED4' }] : row)));
  assert.deepEqual(editsAfterSupport(outside, VERIFIED).edits, [AFTER[1]]);
  assert.deepEqual(claimsAgainstRuns(outside, [VERIFIED]).counts,
    { verified: 1, unread: 0, editedAfter: 1, landedAfter: 0, closing: 1, closingEditedAfter: 1 });
  // An edit recorded before the supporting result is not after it.
  assert.ok(!editsAfterSupport(edgeSession(), VERIFIED).edits.some((edit) => ['ED1', 'ED2'].includes(edit.eventId)));
  // Bounded: up to the helper's edit; and none when the result is after the bound.
  const session = edgeSession();
  assert.deepEqual(editsAfterSupport(session, VERIFIED, { until: session.event('WE1-r').sequence }).edits,
    AFTER.slice(0, 2));
  assert.equal(editsAfterSupport(session, VERIFIED, { until: session.event('A3').sequence }), null);
});

// The review's switch. The judge answers window 1 with a claim on C1's words supported by the passing run's result, and
// upholds every challenge item.
const narrative = (x = {}) => ({ decisions: [], pivots: [], claims: [], requirements: [], ...x });
const CLAIM = { text: 'all tests pass', stated: receipt('C1', 'commentary', 'All tests pass.'),
  supportedBy: receipt('A3-r', 'observation', 'ok 1 - empty name') };
const judgeOf = (seen) => async (request) => {
  seen.push(JSON.stringify([request.label, request.system, request.prompt, request.schema ?? null]));
  if (request.challenge) return { votes: request.challenge.items.map((item) => {
    const cited = item.candidate?.supportedBy ?? item.candidate?.stated ?? null;
    return { key: item.key, verdict: 'not-refuted', explanation: `Synthetic check of ${item.key}.`,
      receipts: cited ? [{ eventId: cited.eventId, role: cited.role, quote: cited.quote }] : [] };
  }) };
  return narrative({ claims: [structuredClone(CLAIM)] });
};
const review = (seen, option = {}) => runReview({ session: edgeSession(), pr: null, reviewScope: 'session-only',
  judge: judgeOf(seen), ...option });

test('D158: off by default — no request or report byte moves; on, the report gains the maps and nothing else', async () => {
  const [a, b, c] = [[], [], []];
  const absent = await review(a);
  const off = await review(b, { sessionEdgeMaps: false });
  const on = await review(c, { sessionEdgeMaps: true });
  assert.ok(!Object.hasOwn(absent, 'sessionEdge'));
  assert.equal(JSON.stringify(off), JSON.stringify(absent));
  assert.deepEqual(b, a);
  // On: the same requests, and the same report but for `sessionEdge`.
  assert.deepEqual(c, a);
  const { sessionEdge, ...rest } = on;
  assert.equal(JSON.stringify(rest), JSON.stringify(absent));
  assert.equal(absent.promises.filter((p) => p.status === 'verified').length, 1);
  assert.deepEqual(sessionEdge, { version: SESSION_EDGE_VERSION, struggle: struggleMap(edgeSession()),
    claims: claimsAgainstRuns(edgeSession(), absent.promises) });
  assert.deepEqual(sessionEdge.claims.claims.map((claim) => claim.edits), [AFTER]);
  // Only `true` turns it on.
  assert.ok(!Object.hasOwn(await review([], { sessionEdgeMaps: 'yes' }), 'sessionEdge'));
});
