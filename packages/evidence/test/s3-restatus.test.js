// S3 (the asks fixes, 2026-10-13; a root-cause analysis: the checking step lowered right statuses to "not
// checked"). A session-only requirement whose status the challenge refuted is put to the reviewer once more, with what
// the check said; a new status is published only when it holds under code's checks and its own check upholds it.
// Every recording here is synthetic; no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { runReview, windowIncompleteReasons } from '../src/run-review.js';
import { NOW_ANSWER, PROMPT_VERSION, RESTATUS_HEADING, RESTATUS_WORDS, RESTATUS_ROW, RESTATUS_CHECK,
  RESTATUS_NOW_ANSWER, restatusRequest } from '../src/prompt.js';
import { REQUIREMENT_RESTATUS_WITHHELD, RESOLUTION_CHALLENGE_OUTCOMES } from '../src/ledger.js';
import { SESSION_DOSSIER_NOTE } from '../src/challenge.js';
import { windowOfLabel } from '../../cli/src/session-review.js';

const ASK = 'Fix greet.js so empty names give the guest greeting. Also add a test for it.';
const SIDECAR = (extra = {}) => ({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false,
  ...extra });

function rows() {
  return [
    humanAsk(ASK),
    call('t1', 'Edit', { file_path: '/repo/greet.js', old_string: 'return name',
      new_string: 'return name || "guest"' }),
    result('t1', 'The file /repo/greet.js has been updated.', { filePath: '/repo/greet.js', oldString: 'return name',
      newString: 'return name || "guest"', originalFile: 'return name\n', structuredPatch: [], userModified: false,
      replaceAll: false }),
    call('t2', 'Bash', { command: 'npm test' }),
    result('t2', 'PASS test/greet.test.js\n3 passed', SIDECAR({ stdout: 'PASS' })),
    said('Fixed greet.js; I did not add a test.'),
  ];
}
const events = (session, kind) => session.events.filter((event) => event.kind === kind);
const quote = (eventId, role, text) => ({ eventId, role, quote: text });

/** The window's ids, the fix row as the first answer proposes it, and the asks. */
function fixture(session) {
  const [ask] = events(session, 'instruction');
  const [edit] = events(session, 'invocation');
  const [closing] = events(session, 'commentary');
  const fixAsk = quote(ask.id, 'instruction', 'Fix greet.js so empty names give the guest greeting');
  const testAsk = quote(ask.id, 'instruction', 'Also add a test for it');
  const deliverable = quote(edit.id, 'code', 'return name || "guest"');
  const shortfall = quote(closing.id, 'commentary', 'I did not add a test.');
  return { ask, edit, closing, fixAsk, testAsk, deliverable, shortfall };
}
const narrative = (requirements) => ({ decisions: [], pivots: [], claims: [], requirements });

/**
 * A judge in code. The narrative request is answered with `first`; a re-ask (`narrative:w1:restatus:K`) with
 * `restatus(request)` (a throw is a failed call); a challenge vote is `verdict(item, request)` on the item's own
 * deliverable, shortfall or instruction. Every request is kept in `seen`.
 */
function judgeOf({ first, restatus = () => null, verdict = () => 'not-refuted', seen = [] }) {
  const own = (candidate) => candidate?.deliverable ?? candidate?.shortfall ?? candidate?.instruction ?? null;
  return async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map((item) => {
      const receipt = own(item.candidate);
      return { key: item.key, verdict: verdict(item, request), explanation: `Synthetic check of ${item.key}.`,
        receipts: receipt ? [{ eventId: receipt.eventId, role: receipt.role, quote: receipt.quote }] : [] };
    }) };
    if (/:restatus:/.test(request.label)) return restatus(request);
    return first();
  };
}
/** The first answer's fix row is "partly-done" (a shortfall that belongs to another ask); its test row "not-done". */
const partlyFix = (n) => ({ text: 'fix empty names', instruction: n.fixAsk, status: 'partly-done',
  deliverable: n.deliverable, shortfall: n.shortfall });
const notDoneTest = (n) => ({ text: 'add a test', instruction: n.testAsk, status: 'not-done', shortfall: n.shortfall });
/** The challenge refutes the first answer's fix row only (its key is the first requirement's). */
const refuteFirstFix = (item, request) => (item.type === 'requirement' && item.key === 'requirements:0'
  && !/:restatus/.test(request.label) ? 'refuted' : 'not-refuted');
const rowOf = (report, text) => report.requirements.find((row) => row.text === text);
const restatusRecord = (report) => report.windowResults[0].restatus;
const counts = (vocabulary, set = {}) => Object.fromEntries(vocabulary.map((token) => [token, set[token] ?? 0]));

test('S3: the vocabularies and the version', () => {
  assert.deepEqual(REQUIREMENT_RESTATUS_WITHHELD, ['request_bound', 'no_answer', 'no_row', 'ungrounded', 'not_checked',
    'same_status']);
  assert.ok(Object.isFrozen(REQUIREMENT_RESTATUS_WITHHELD));
  // One bump for the new request (the re-ask's fixed words); /32 was D81's, reverted and never reused.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  assert.equal(PROMPT_VERSION, 'sonah.narrative/37');
  assert.equal(windowOfLabel('narrative:w2:restatus:3'), 2, 'a re-ask belongs to its window (F226)');
});

test('S3: a refuted requirement is asked once more; a new status its own check upholds is published', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  const seen = [];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf({ seen,
    first: () => narrative([partlyFix(n), notDoneTest(n)]), verdict: refuteFirstFix,
    restatus: () => narrative([{ text: 'any words', instruction: n.fixAsk, status: 'done', deliverable: n.deliverable,
      shortfall: null }]) }) });
  const fix = rowOf(report, 'fix empty names');
  assert.deepEqual({ status: fix.status, reason: fix.reason ?? null, deliverable: fix.deliverable.quote },
    { status: 'done', reason: null, deliverable: 'return name || "guest"' }, 'published with the upheld new status');
  assert.equal(fix.text, 'fix empty names', 'the ask stays the row\'s own');
  assert.equal(rowOf(report, 'add a test').status, 'not-done', 'an upheld row is untouched');
  assert.deepEqual(restatusRecord(report), { refuted: 1, asked: 1, withheld: counts(REQUIREMENT_RESTATUS_WITHHELD),
    challenged: counts(RESOLUTION_CHALLENGE_OUTCOMES, { upheld: 1 }) });
  assert.equal(report.windowResults[0].restatusChallenge.results.length, 1);
  assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [], 'the window is complete');
  // The re-ask: the window's own request, its "Now answer" replaced, one call, named after the refuted row.
  const narrativeRequest = seen.find((request) => request.label === 'narrative:w1');
  const reasks = seen.filter((request) => /:restatus:/.test(request.label) && !request.challenge);
  assert.deepEqual(reasks.map((request) => request.label), ['narrative:w1:restatus:0']);
  const [reask] = reasks;
  assert.equal(reask.system, narrativeRequest.system);
  assert.deepEqual(reask.schema, narrativeRequest.schema);
  const head = narrativeRequest.prompt.slice(0, narrativeRequest.prompt.length - `\n${NOW_ANSWER.join('\n')}`.length);
  assert.ok(reask.prompt.startsWith(
    `${head}\n\n${RESTATUS_HEADING}\n\n${RESTATUS_WORDS.join('\n')}\n\n${RESTATUS_ROW}\n`));
  assert.ok(reask.prompt.endsWith(`\n\n${RESTATUS_NOW_ANSWER.join('\n')}`));
  assert.ok(!reask.prompt.includes(NOW_ANSWER[1]), 'the first "Now answer" is gone');
  assert.ok(reask.prompt.includes(
    `${RESTATUS_CHECK}\n{"explanation":"Synthetic check of requirements:0.","receipts":[`));
  assert.ok(!reask.prompt.includes(n.edit.id), 'events are named by the window\'s aliases, as its request names them');
  // The new status was checked on its own, after the re-ask, as a requirement is.
  const recheck = seen.filter((request) => request.challenge && request.label.startsWith('challenge:w1:restatus:'));
  assert.deepEqual(recheck.map((request) => request.label), ['challenge:w1:restatus:b1:p1',
    'challenge:w1:restatus:b1:p2', 'challenge:w1:restatus:b1:p3']);
  assert.deepEqual(recheck[0].challenge.items.map((item) => [item.key, item.candidate.status]),
    [['requirements:0:restatus', 'done']]);
});

test('S3: a new status its own check does not uphold is not published; the row stays as before', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  for (const [ended, verdict] of [['refuted', 'refuted'], ['unsettled', 'uncertain']]) {
    const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf({
      first: () => narrative([partlyFix(n), notDoneTest(n)]),
      verdict: (item, request) => (/:restatus/.test(request.label) ? verdict : refuteFirstFix(item, request)),
      restatus: () => narrative([{ text: 'x', instruction: n.fixAsk, status: 'done',
        deliverable: n.deliverable }]) }) });
    const fix = rowOf(report, 'fix empty names');
    assert.deepEqual([fix.status, fix.reason, fix.deliverable], ['not-checked', 'challenge_refuted', undefined], ended);
    assert.deepEqual(restatusRecord(report).challenged, counts(RESOLUTION_CHALLENGE_OUTCOMES, { [ended]: 1 }), ended);
    assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [],
      `${ended}: the second chance never makes a window incomplete`);
  }
});

test('S3: precision — the refuted status is never published again, and a re-ask that fails changes nothing',
  async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  const otherShortfall = quote(n.closing.id, 'commentary', 'Fixed greet.js');
  const cases = [
    // The very status the check refuted, on other evidence: not asked again, not published.
    ['same_status', () => narrative([{ text: 'x', instruction: n.fixAsk, status: 'partly-done',
      deliverable: n.deliverable, shortfall: otherShortfall }])],
    ['not_checked', () => narrative([{ text: 'x', instruction: n.fixAsk, status: 'not-checked' }])],
    ['ungrounded', () => narrative([{ text: 'x', instruction: n.fixAsk, status: 'done',
      deliverable: quote(n.edit.id, 'code', 'words the edit never wrote') }])],
    ['no_row', () => narrative([])],
    ['no_row', () => narrative([{ text: 'x', instruction: n.testAsk, status: 'done', deliverable: n.deliverable }])],
    ['no_answer', () => ({ requirements: 'not a list' })],
    ['no_answer', () => { throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' }); }],
  ];
  for (const [withheld, restatus] of cases) {
    const seen = [];
    const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf({ seen,
      first: () => narrative([partlyFix(n), notDoneTest(n)]), verdict: refuteFirstFix, restatus }) });
    const fix = rowOf(report, 'fix empty names');
    assert.deepEqual([fix.status, fix.reason], ['not-checked', 'challenge_refuted'], withheld);
    assert.deepEqual(restatusRecord(report), { refuted: 1, asked: 1,
      withheld: counts(REQUIREMENT_RESTATUS_WITHHELD, { [withheld]: 1 }),
      challenged: counts(RESOLUTION_CHALLENGE_OUTCOMES) }, withheld);
    assert.equal(report.windowResults[0].restatusChallenge, undefined, `${withheld}: nothing was checked again`);
    assert.ok(!seen.some((request) => request.challenge && request.label.includes(':restatus')), withheld);
    assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [], withheld);
  }
});

test('S3: a refuted "done" never comes back "done" (the false-reassurance guard)', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  const doneFix = { text: 'fix empty names', instruction: n.fixAsk, status: 'done', deliverable: n.deliverable };
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf({
    first: () => narrative([doneFix, notDoneTest(n)]), verdict: refuteFirstFix,
    restatus: () => narrative([{ ...doneFix, text: 'the same status, asked again' }]) }) });
  assert.deepEqual([rowOf(report, 'fix empty names').status, rowOf(report, 'fix empty names').reason],
    ['not-checked', 'challenge_refuted']);
  assert.equal(restatusRecord(report).withheld.same_status, 1);
});

test('S3: only a row whose instruction is the ask\'s own (message and words) is read; two such are none',
  async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  const both = (fixRow) => narrative([notDoneTest(n), fixRow]);
  const done = { text: 'x', instruction: n.fixAsk, status: 'done', deliverable: n.deliverable };
  const picked = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf({
    first: () => narrative([partlyFix(n), notDoneTest(n)]), verdict: refuteFirstFix, restatus: () => both(done) }) });
  assert.equal(rowOf(picked, 'fix empty names').status, 'done');
  const twice = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf({
    first: () => narrative([partlyFix(n), notDoneTest(n)]), verdict: refuteFirstFix,
    restatus: () => narrative([done, { ...done, text: 'y' }]) }) });
  assert.equal(rowOf(twice, 'fix empty names').status, 'not-checked');
  assert.equal(restatusRecord(twice).withheld.no_row, 1);
});

test('S3: a window whose challenge refuted no requirement sends no re-ask and keeps its record\'s bytes', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  const seen = [];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf({ seen,
    first: () => narrative([partlyFix(n), notDoneTest(n)]) }) });
  assert.ok(!seen.some((request) => request.label.includes(':restatus')));
  assert.equal(Object.hasOwn(report.windowResults[0], 'restatus'), false);
  assert.equal(Object.hasOwn(report.windowResults[0], 'restatusChallenge'), false);
  // An unsettled or unexecuted row is not refuted: no re-ask either (S3 is for a refutation only).
  const unsettled = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf({ seen,
    first: () => narrative([partlyFix(n), notDoneTest(n)]),
    verdict: (item) => (item.key === 'requirements:0' ? 'uncertain' : 'not-refuted') }) });
  assert.equal(rowOf(unsettled, 'fix empty names').reason, 'challenge_unsettled');
  assert.ok(!seen.some((request) => request.label.includes(':restatus')));
});

test('S3: in m33-lean the new status is checked as the requirement was — once, on its own dossier', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  const seen = [];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', speedProfile: 'm33-lean',
    judge: judgeOf({ seen, first: () => narrative([partlyFix(n), notDoneTest(n)]), verdict: refuteFirstFix,
      restatus: () => narrative([{ text: 'x', instruction: n.fixAsk, status: 'done',
        deliverable: n.deliverable }]) }) });
  assert.equal(rowOf(report, 'fix empty names').status, 'done');
  const recheck = seen.filter((request) => request.challenge && request.label.startsWith('challenge:w1:restatus'));
  assert.deepEqual(recheck.map((request) => request.label), ['challenge:w1:restatus:b1:p1']);
  assert.ok(recheck[0].system.includes(SESSION_DOSSIER_NOTE), 'shown a dossier, as the single-pass run is');
});

test('S3: the re-ask request is deterministic and only replaces a session-only "Now answer"', () => {
  const request = { system: 'S', prompt: `window\n${NOW_ANSWER.join('\n')}`, schema: { type: 'object' },
    label: 'narrative:w1' };
  const row = { text: 't', instruction: { eventId: 'a', role: 'instruction', quote: 'q' }, status: 'done',
    deliverable: { eventId: 'b', role: 'code', quote: 'x' } };
  const votes = [{ valid: true, verdict: 'refuted', explanation: 'no',
    receipts: [{ eventId: 'b', role: 'code', quote: 'x', repaired: true }] }];
  const one = restatusRequest({ request, row, refutations: votes, label: 'narrative:w1:restatus:0' });
  assert.deepEqual(one, restatusRequest({ request, row, refutations: votes, label: 'narrative:w1:restatus:0' }));
  assert.equal(one.prompt, ['window', '', RESTATUS_HEADING, '', ...RESTATUS_WORDS, '', RESTATUS_ROW,
    JSON.stringify(row), '', RESTATUS_CHECK,
    '{"explanation":"no","receipts":[{"eventId":"b","role":"code","quote":"x"}]}', '',
    ...RESTATUS_NOW_ANSWER].join('\n'));
  assert.equal(restatusRequest({ request: { ...request, prompt: 'no closing' }, row, refutations: votes, label: 'l' }),
    null);
});
