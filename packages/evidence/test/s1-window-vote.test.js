// S1 (the asks fixes, 2026-10-13; a root-cause analysis: in m33-lean a right "done" was lowered to "not
// checked" when the single checking pass, shown only the dossier its own receipts cite, could not settle it). Such a
// requirement gets one vote on the whole window before it is lowered. Synthetic recordings; the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { runReview, windowIncompleteReasons } from '../src/run-review.js';
import { RESOLUTION_CHALLENGE_OUTCOMES } from '../src/ledger.js';
import { SESSION_DOSSIER_NOTE } from '../src/challenge.js';

const SIDECAR = (extra = {}) => ({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false,
  ...extra });
const rows = () => [
  humanAsk('Fix greet.js so empty names give the guest greeting.'),
  call('t1', 'Edit', { file_path: '/repo/greet.js', old_string: 'return name',
    new_string: 'return name || "guest"' }),
  result('t1', 'The file /repo/greet.js has been updated.', { filePath: '/repo/greet.js', oldString: 'return name',
    newString: 'return name || "guest"', originalFile: 'return name\n', structuredPatch: [], userModified: false,
    replaceAll: false }),
  call('t2', 'Bash', { command: 'npm test' }),
  result('t2', 'PASS test/greet.test.js\n3 passed', SIDECAR({ stdout: 'PASS' })),
  said('Fixed greet.js.'),
];
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const counts = (set = {}) => Object.fromEntries(RESOLUTION_CHALLENGE_OUTCOMES.map((token) => [token, set[token] ?? 0]));

/** The window answers one "done" fix row; a challenge vote is `verdict(item, request)` on the row's own deliverable. */
async function review(t, { verdict, speedProfile = 'm33-lean', seen = [] }) {
  const { session } = await load(t, rows());
  const [ask] = session.events.filter((event) => event.kind === 'instruction');
  const [edit] = session.events.filter((event) => event.kind === 'invocation');
  const fix = { text: 'fix empty names', status: 'done',
    instruction: quote(ask.id, 'instruction', 'Fix greet.js so empty names give the guest greeting'),
    deliverable: quote(edit.id, 'code', 'return name || "guest"') };
  const judge = async (request) => {
    seen.push(request);
    if (!request.challenge) return { decisions: [], pivots: [], claims: [], requirements: [structuredClone(fix)] };
    return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: verdict(item, request),
      explanation: 'Synthetic.', receipts: [{ eventId: edit.id, role: 'code', quote: 'return name || "guest"' }] })) };
  };
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', speedProfile, judge });
  const row = report.requirements.find((r) => r.text === 'fix empty names');
  return { report, row, window: report.windowResults[0] };
}
const onWindow = (request) => request.label.startsWith('challenge:w1:window:');

test('S1: a requirement its dossier check left unsettled is published as proposed when a whole-window vote upholds it',
  async (t) => {
  const seen = [];
  const { row, window } = await review(t, { seen,
    verdict: (item, request) => (onWindow(request) ? 'not-refuted' : 'uncertain') });
  assert.deepEqual([row.status, row.reason ?? null], ['done', null]);
  assert.deepEqual(window.windowVote, { asked: 1, challenged: counts({ upheld: 1 }) });
  assert.deepEqual(windowIncompleteReasons(window), []);
  // One call, on the window's whole evidence: never the dossier note, and the evidence a narrative-free check is shown.
  const votes = seen.filter(onWindow);
  assert.deepEqual(votes.map((request) => request.label), ['challenge:w1:window:b1:p1']);
  assert.ok(!votes[0].system.includes(SESSION_DOSSIER_NOTE));
  const dossierRun = seen.find((request) => request.label === 'challenge:w1:t1:b1:p1');
  assert.ok(dossierRun.system.includes(SESSION_DOSSIER_NOTE), 'the first check was on the dossier');
  assert.ok(votes[0].prompt.length > dossierRun.prompt.length, 'the whole window holds more than the dossier');
});

test('S1: a whole-window vote that does not uphold it leaves the row exactly as before', async (t) => {
  for (const [ended, verdict] of [['refuted', 'refuted'], ['unsettled', 'uncertain']]) {
    const { row, window } = await review(t, {
      verdict: (item, request) => (onWindow(request) ? verdict : 'uncertain') });
    assert.deepEqual([row.status, row.reason], ['not-checked', 'challenge_unsettled'], ended);
    assert.deepEqual(window.windowVote, { asked: 1, challenged: counts({ [ended]: 1 }) }, ended);
    assert.deepEqual(windowIncompleteReasons(window), [], ended);
  }
});

test('S1: only an unsettled requirement of a dossier profile is voted on again', async (t) => {
  // Upheld or refuted on the dossier: no whole-window vote.
  for (const verdict of ['not-refuted', 'refuted']) {
    const seen = [];
    const { window } = await review(t, { seen, verdict: () => verdict });
    assert.ok(!seen.some(onWindow), verdict);
    assert.equal(Object.hasOwn(window, 'windowVote'), false, verdict);
  }
  // m33-fast's single pass is already shown the whole window, and standard asks three passes: no extra vote.
  for (const speedProfile of ['m33-fast', 'standard']) {
    const seen = [];
    const { row, window } = await review(t, { seen, speedProfile, verdict: () => 'uncertain' });
    assert.ok(!seen.some(onWindow), speedProfile);
    assert.equal(row.reason, 'challenge_unsettled', speedProfile);
    assert.equal(Object.hasOwn(window, 'windowVote'), false, speedProfile);
  }
});
