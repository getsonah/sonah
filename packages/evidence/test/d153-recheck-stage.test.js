// D153: the after-point re-check of the accusing asks, wired behind an option that is off by default. A later window of
// the ask's own session is asked once, with its kept request and only its closing replaced; code checks the new status
// (the row's identity, `checkedRequirement`, the new receipt an event of that window recorded after the row, and a move
// to done only on code, an action or a result); the window's three-pass check must uphold it; the latest window that
// settles a row wins. Synthetic sessions and judges in code only: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReview, planWindowRequests, recheckedRows } from '../src/run-review.js';
import { RECHECK_NOW_ANSWER } from '../src/prompt.js';
import { RECHECK_OUTCOMES, RECHECK_WITHHELD, RECHECK_MOVE_ROLES, RECHECK_ITEM_TYPE, RECHECK_VERSION,
  RESOLUTION_CHALLENGE_OUTCOMES } from '../src/ledger.js';
import { RECHECK_NOTE, RECHECK_PROPOSITIONS, checklistProposition, checklistSystem, SESSION_CHALLENGE_CORE }
  from '../src/challenge.js';
import { windowOfLabel } from '../../cli/src/session-review.js';
import { build, launchSession, receipt } from './d153-recheck-fixture.js';

/** Three windows of the main agent, one human message each: a fix and a missing test (w1), the changelog (w2), and the
 *  test run with its result and the agent's last words (w3). */
const stageSession = () => build([
  ['I1', 'ask', 'ask1'], ['ED1', 'edit', 'edit1'], ['C1', 'said', 'said1'], ['F1', 'filler'],
  ['I2', 'ask', 'ask2', { turn: 'T2' }], ['C2', 'said', 'said2', { turn: 'T2' }], ['F2', 'filler', 'cat', { turn: 'T2' }],
  ['I3', 'ask', 'ask3', { turn: 'T3' }], ['A3', 'cmd', 'run3', { turn: 'T3' }],
  ['A3-r', 'out', 'out3', { of: 'A3', turn: 'T3' }], ['C3', 'said', 'helperSaid2', { turn: 'T3' }],
  ['F3', 'filler', 'cat', { turn: 'T3' }],
]);

const ASK1 = receipt('I1', 'instruction', 'fix greet.js so empty names give the guest greeting, and add a test for it');
const ASK2 = receipt('I2', 'instruction', 'ask a helper to check the docs, then update the changelog');
const ASK3 = receipt('I3', 'instruction', 'now add the missing test');
const FIXED = receipt('ED1', 'code', 'return name || "guest"');
const NO_TEST = receipt('C1', 'commentary', 'I did not add a test yet.');
const NO_LOG = receipt('C2', 'commentary', 'The changelog is not updated.');
const TEST_RAN = receipt('A3', 'action', 'node --test test/greet.test.js');
const TEST_OK = receipt('A3-r', 'observation', 'ok 1 - empty name gives the guest greeting');
const SAID_DONE = receipt('C3', 'commentary', 'Done checking.');
const narrative = (requirements) => ({ decisions: [], pivots: [], claims: [], requirements });
/** The first answers: w1 finds ask 1 partly done; w2 finds ask 2 not done; w3 finds ask 3 done. */
const FIRST = {
  'narrative:w1': narrative([{ text: 'fix and test', instruction: ASK1, status: 'partly-done', deliverable: FIXED,
    shortfall: NO_TEST }]),
  'narrative:w2': narrative([{ text: 'the changelog', instruction: ASK2, status: 'not-done', shortfall: NO_LOG }]),
  'narrative:w3': narrative([{ text: 'the test', instruction: ASK3, status: 'done', deliverable: TEST_OK }]),
};
const row = (instruction, status, fields) => narrative([{ text: 'any words', instruction, status, ...fields }]);

/**
 * A judge in code: each narrative label's answer from `answers` (FIRST for the windows; a function is called, a throw is
 * a failed call), and every challenge vote `verdict(item, request)` citing the item's own receipt. Every request is kept
 * in `seen`.
 */
function judgeOf({ answers = {}, verdict = () => 'not-refuted', seen = [] } = {}) {
  const own = (c) => (c?.status === 'done' ? c.deliverable : c?.shortfall ?? c?.deliverable) ?? c?.instruction ?? null;
  return async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map((item) => {
      const cited = own(item.candidate);
      return { key: item.key, verdict: verdict(item, request), explanation: `Synthetic check of ${item.key}.`,
        receipts: cited ? [{ eventId: cited.eventId, role: cited.role, quote: cited.quote }] : [] };
    }) };
    const answer = Object.hasOwn(answers, request.label) ? answers[request.label] : FIRST[request.label];
    return typeof answer === 'function' ? answer(request) : structuredClone(answer ?? narrative([]));
  };
}
const review = (judge, on = true) => runReview({ session: stageSession(), pr: null, reviewScope: 'session-only', judge,
  ...(on ? { afterPointRecheck: true } : {}) });
/** A published row's receipts carry the recording's session key (`verifyReceipt`); compared without it. */
const bare = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'sessionKey' ? undefined : v)));
const ask1 = (report) => bare(report.requirements.find((r) => r.instruction?.eventId === 'I1' && r.codeMade !== true));
const ask2 = (report) => bare(report.requirements.find((r) => r.instruction?.eventId === 'I2' && r.codeMade !== true));
const zeros = (list, set = {}) => Object.fromEntries(list.map((k) => [k, set[k] ?? 0]));

test('D153: the vocabularies, the item\'s propositions and note, and the labels', () => {
  assert.deepEqual(RECHECK_WITHHELD, ['not_asked', 'bound', 'no_answer', 'no_row', 'ungrounded', 'not_after_anchor',
    'commentary_only', 'failed_result', 'not_rewritten', 'challenge_refuted', 'challenge_unsettled']);
  assert.deepEqual(RECHECK_MOVE_ROLES, ['code', 'action', 'observation']);
  assert.equal(RECHECK_ITEM_TYPE, 'recheck');
  assert.equal(RECHECK_VERSION, 'sonah.recheck/3');
  for (const list of [RECHECK_WITHHELD, RECHECK_MOVE_ROLES, RECHECK_PROPOSITIONS]) assert.ok(Object.isFrozen(list));
  const item = (status, earlier) => ({ type: 'recheck', candidate: { status, earlier: { status: earlier } } });
  assert.equal(checklistProposition(item('done', 'partly-done')), RECHECK_PROPOSITIONS.donePartly);
  assert.equal(checklistProposition(item('done', 'not-done')), RECHECK_PROPOSITIONS.doneNot);
  assert.equal(checklistProposition(item('not-done', 'partly-done')), RECHECK_PROPOSITIONS.notDone);
  assert.equal(checklistProposition(item('partly-done', 'not-done')), RECHECK_PROPOSITIONS.partly);
  assert.equal(checklistProposition(item('partly-done', 'partly-done')), null, 'never given to a row found partly-done');
  assert.equal(checklistSystem(['recheck']), `${SESSION_CHALLENGE_CORE}\n${RECHECK_NOTE}`);
  assert.ok(!checklistSystem(['requirement']).includes(RECHECK_NOTE), 'no other batch is sent its note');
  assert.equal(windowOfLabel('narrative:w3:recheck'), 3);
  assert.equal(windowOfLabel('challenge:w3:recheck:b1:p2'), 3);
});

test('D153: off by default — the same requests, answers and report as a review that never heard of it', async () => {
  const seenOff = [], seenDefault = [];
  const off = await review(judgeOf({ seen: seenOff }), false);
  const plain = await runReview({ session: stageSession(), pr: null, reviewScope: 'session-only',
    judge: judgeOf({ seen: seenDefault }), afterPointRecheck: false });
  assert.deepEqual(plain, off);
  assert.deepEqual(seenDefault, seenOff);
  assert.ok(!seenOff.some((request) => /:recheck/.test(request.label)), 'no re-check request');
  assert.equal(Object.hasOwn(off, 'recheck'), false);
  assert.ok(off.requirements.every((r) => !Object.hasOwn(r, 'recheck')));
  assert.equal(ask1(off).status, 'partly-done');
});

test('D153: a later window\'s upheld done on a result moves the ask; the merge replaces the row, the earlier kept', async () => {
  const seen = [];
  const report = await review(judgeOf({ seen, answers: {
    'narrative:w2:recheck': row(ASK1, 'not-checked', {}),
    'narrative:w3:recheck': row(ASK1, 'done', { deliverable: TEST_OK }),
  } }));
  assert.deepEqual(ask1(report), { text: 'fix and test', instruction: ASK1, status: 'done', deliverable: TEST_OK,
    recheck: { outcome: 'moved', window: 3, earlier: { status: 'partly-done', deliverable: FIXED, shortfall: NO_TEST } } });
  const published = report.requirements.find((r) => r.instruction?.eventId === 'I1');
  assert.equal(published.deliverable.sessionKey, published.recheck.earlier.shortfall.sessionKey,
    'the new receipt is published as the window published the earlier one');
  // Two calls: each later window once, with every row it re-checks; the row of w2 is re-checked by w3 too.
  const sent = seen.filter((request) => /:recheck$/.test(request.label));
  assert.deepEqual(sent.map((request) => request.label), ['narrative:w2:recheck', 'narrative:w3:recheck']);
  const window3 = seen.find((request) => request.label === 'narrative:w3');
  const [, w3] = sent;
  assert.equal(w3.system, window3.system);
  assert.deepEqual(w3.schema, window3.schema);
  assert.ok(w3.prompt.endsWith(RECHECK_NOW_ANSWER.join('\n')));
  assert.equal((w3.prompt.match(/"status":"(partly|not)-done"/g) ?? []).length, 2, 'both earlier asks, in merged order');
  // Its own three-pass check: the decide bounds, one item, labelled as window 3's.
  const votes = seen.filter((request) => request.challenge && /^challenge:w3:recheck:/.test(request.label));
  assert.deepEqual([...new Set(votes.map((request) => request.challenge.pass))], [1, 2, 3]);
  assert.ok(votes.every((request) => request.challenge.items.every((item) => item.type === 'recheck')));
  assert.deepEqual(report.recheck, { version: RECHECK_VERSION, rows: 2, outcomes: zeros(RECHECK_OUTCOMES,
    { moved: 1, not_checked_after_later_work: 1 }), kinds: {
    ask_partly_done: { rows: 1, outcomes: zeros(RECHECK_OUTCOMES, { moved: 1 }) },
    ask_not_done: { rows: 1, outcomes: zeros(RECHECK_OUTCOMES, { not_checked_after_later_work: 1 }) },
    claim_contradicted: { rows: 0, outcomes: zeros(RECHECK_OUTCOMES) },
    written_contradicted: { rows: 0, outcomes: zeros(RECHECK_OUTCOMES) } },
  launched: 0, calls: 2, pairs: 3, notChecked: 1, upheld: 1, recontradicted: 0,
  settled: { done: 1, partlyDone: 0, notDone: 0, claimCorrected: 0, writtenCorrected: 0 }, voided: 0,
  withheld: zeros(RECHECK_WITHHELD, { no_row: 1 }),
  challenged: zeros(RESOLUTION_CHALLENGE_OUTCOMES, { upheld: 1 }),
  challengeCalls: report.recheck.challengeCalls });
  assert.ok(report.recheck.challengeCalls.attemptedCalls >= 3);
  // The ask w2 found not done, which no later answer named, stays as it was, its outcome beside it.
  assert.deepEqual(ask2(report).recheck, { outcome: 'not_checked_after_later_work' });
  assert.equal(ask2(report).status, 'not-done');
});

test('D153: a tiered profile asks the new status in three passes too, over the window\'s whole evidence', async () => {
  const seen = [];
  const report = await runReview({ session: stageSession(), pr: null, reviewScope: 'session-only',
    speedProfile: 'm33-lean', afterPointRecheck: true, judge: judgeOf({ seen, answers: {
      'narrative:w3:recheck': row(ASK1, 'done', { deliverable: TEST_OK }) } }) });
  assert.equal(ask1(report).recheck.outcome, 'moved');
  const votes = seen.filter((request) => request.challenge && /^challenge:w3:recheck:/.test(request.label));
  assert.deepEqual([...new Set(votes.map((request) => request.challenge.pass))], [1, 2, 3]);
  const window3 = seen.find((request) => request.label === 'narrative:w3');
  assert.ok(votes.every((request) => request.prompt.includes(window3.evidencePrompt)), 'the whole window, not a dossier');
});

test('D153: the provenance rule — the agent\'s own words never move a row, though they may reaffirm it', async () => {
  const moved = await review(judgeOf({ answers: {
    'narrative:w2:recheck': row(ASK1, 'not-checked', {}),
    'narrative:w3:recheck': row(ASK1, 'done', { deliverable: SAID_DONE }),
  } }));
  assert.equal(ask1(moved).status, 'partly-done');
  assert.deepEqual(ask1(moved).shortfall, NO_TEST);
  assert.equal(moved.recheck.withheld.commentary_only, 1);
  assert.equal(moved.recheck.outcomes.moved, 0);
  for (const deliverable of [TEST_RAN, TEST_OK]) {
    const report = await review(judgeOf({ answers: { 'narrative:w3:recheck': row(ASK1, 'done', { deliverable }) } }));
    assert.equal(ask1(report).status, 'done', `a deliverable of role ${deliverable.role} moves it`);
  }
  // A reaffirmation on the agent's words: the row keeps its own status, its shortfall the later one.
  const later = receipt('C3', 'commentary', 'Done checking.');
  const kept = await review(judgeOf({ answers: { 'narrative:w3:recheck': row(ASK1, 'partly-done',
    { deliverable: FIXED, shortfall: later }) } }));
  assert.deepEqual(ask1(kept), { text: 'fix and test', instruction: ASK1, status: 'partly-done', deliverable: FIXED,
    shortfall: later, recheck: { outcome: 'reaffirmed', window: 3, earlier: { shortfall: NO_TEST } } });
});

test('D153: a receipt the window was shown but that is not its own work after the row is not_after_anchor', async () => {
  // C1 is carried into w2 (an earlier thought): grounded in what w2 showed, but it is the row's own after point.
  const report = await review(judgeOf({ answers: {
    'narrative:w2:recheck': row(ASK1, 'not-done', { shortfall: NO_TEST }),
    'narrative:w3:recheck': row(ASK1, 'not-done', { shortfall: receipt('C2', 'commentary', 'The changelog') }),
  } }));
  assert.equal(report.recheck.withheld.not_after_anchor, 2, 'the carried after point, and a carried later thought');
  assert.equal(ask1(report).recheck.outcome, 'not_checked_after_later_work');
  assert.deepEqual(ask1(report).shortfall, NO_TEST, 'the row as it was');
});

test('D153: every withheld reason of an answer, and how the challenge ended', async () => {
  // Window 3 re-checks both earlier asks; its answer here names ask 1 only, so ask 2 is `no_row` in each but the first.
  const cases = [
    ['a failed call', { 'narrative:w3:recheck': () => { throw new Error('down'); } }, { no_answer: 2 }],
    ['no narrative', { 'narrative:w3:recheck': { not: 'a narrative' } }, { no_answer: 2 }],
    ['other words of the ask', { 'narrative:w3:recheck': row({ ...ASK1, quote: 'fix greet.js' }, 'done',
      { deliverable: TEST_OK }) }, { no_row: 2 }],
    ['two rows of the ask', { 'narrative:w3:recheck': narrative([{ text: 'a', instruction: ASK1, status: 'done',
      deliverable: TEST_OK }, { text: 'b', instruction: ASK1, status: 'not-checked' }]) }, { no_row: 2 }],
    ['a quote no window shows', { 'narrative:w3:recheck': row(ASK1, 'done', { deliverable: receipt('A3-r',
      'observation', 'words no window shows') }) }, { no_row: 1, ungrounded: 1 }],
    ['an earlier window\'s event', { 'narrative:w3:recheck': row(ASK1, 'done', { deliverable: FIXED }) },
      { no_row: 1, ungrounded: 1 }],
  ];
  for (const [name, answers, withheld] of cases) {
    const report = await review(judgeOf({ answers: { 'narrative:w2:recheck': row(ASK1, 'not-checked', {}),
      ...answers } }));
    assert.deepEqual(report.recheck.withheld, zeros(RECHECK_WITHHELD, withheld), name);
    assert.equal(ask1(report).recheck.outcome, 'not_checked_after_later_work', name);
    assert.equal(ask1(report).status, 'partly-done', name);
  }
  const refuted = await review(judgeOf({ verdict: (item) => (item.type === 'recheck' ? 'refuted' : 'not-refuted'),
    answers: { 'narrative:w3:recheck': row(ASK1, 'done', { deliverable: TEST_OK }) } }));
  assert.equal(refuted.recheck.withheld.challenge_refuted, 1);
  assert.deepEqual(refuted.recheck.challenged, zeros(RESOLUTION_CHALLENGE_OUTCOMES, { refuted: 1 }));
  assert.equal(ask1(refuted).status, 'partly-done', 'no accusing row moves without an upheld check');
  const unsettled = await review(judgeOf({ verdict: (item) => (item.type === 'recheck' ? 'uncertain' : 'not-refuted'),
    answers: { 'narrative:w3:recheck': row(ASK1, 'done', { deliverable: TEST_OK }) } }));
  assert.equal(unsettled.recheck.withheld.challenge_unsettled, 1);
  assert.equal(ask1(unsettled).recheck.outcome, 'not_checked_after_later_work');
  // A vote that cites only the ask binds nothing: a move rests on its later deliverable.
  const base = judgeOf({ answers: { 'narrative:w3:recheck': row(ASK1, 'done', { deliverable: TEST_OK }) } });
  const instructionOnly = await review(async (request) => {
    const answer = await base(request);
    if (!request.challenge || !/:recheck:/.test(request.label)) return answer;
    return { votes: answer.votes.map((vote) => ({ ...vote, receipts: [{ ...ASK1 }] })) };
  });
  assert.equal(ask1(instructionOnly).status, 'partly-done');
  assert.equal(instructionOnly.recheck.withheld.challenge_unsettled, 1);
});

test('D153: the latest window that settles a row wins', async () => {
  const doneThenNot = await review(judgeOf({ answers: {
    'narrative:w2:recheck': row(ASK1, 'done', { deliverable: receipt('C2', 'commentary', 'x') }),
    'narrative:w3:recheck': row(ASK1, 'not-done', { shortfall: SAID_DONE }),
  } }));
  assert.equal(ask1(doneThenNot).recheck.outcome, 'reaffirmed');
  // w2 holds no work of ask 1 that code can move it on; w3 moves it, and w3 is the later.
  const notThenDone = await review(judgeOf({ answers: {
    'narrative:w2:recheck': row(ASK1, 'not-done', { shortfall: NO_LOG }),
    'narrative:w3:recheck': row(ASK1, 'done', { deliverable: TEST_OK }),
  } }));
  assert.deepEqual(ask1(notThenDone).recheck, { outcome: 'moved', window: 3, earlier: { status: 'partly-done',
    deliverable: FIXED, shortfall: NO_TEST } });
  assert.equal(notThenDone.recheck.upheld, 2, 'both windows settled it; the later stands');
  const doneThenNotDone = await review(judgeOf({ answers: {
    'narrative:w2:recheck': row(ASK1, 'not-done', { shortfall: NO_LOG }),
    'narrative:w3:recheck': row(ASK1, 'not-checked', {}),
  } }));
  assert.deepEqual(ask1(doneThenNotDone), { text: 'fix and test', instruction: ASK1, status: 'partly-done',
    deliverable: FIXED, shortfall: NO_LOG, recheck: { outcome: 'reaffirmed', window: 2, earlier: { shortfall: NO_TEST } } },
  'a not-checked answer never replaces a settled one');
});

test('D153: the phase alone — a window not read, a request over the bound, and the counts sum', async () => {
  const session = stageSession();
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  const rows = [{ text: 'fix and test', instruction: ASK1, status: 'partly-done', deliverable: FIXED, shortfall: NO_TEST },
    { text: 'the changelog', instruction: ASK2, status: 'not-done', shortfall: NO_LOG }];
  const perWindow = [{ requirements: [rows[0]] }, { requirements: [rows[1]] }, { requirements: [] }];
  const runner = (k) => ({ request: plan.requests[k].request, aliases: plan.requests[k].aliases,
    sourceMap: plan.requests[k].sourceMap, shown: session, end: null, ask: async () => ({ results: [] }) });
  const called = [];
  const judgeOfK = () => async (request) => { called.push(request.label); return narrative([]); };
  const unread = await recheckedRows({ session, windows: plan.windows, perWindow, requirements: rows,
    runners: [runner(0), null, runner(2)], judgeOf: judgeOfK, requestBound: 10_000_000 });
  assert.deepEqual(called, ['narrative:w3:recheck']);
  assert.equal(unread.record.withheld.not_asked, 1, 'window 2\'s answer was not read: nothing sent for its row');
  assert.equal(unread.record.withheld.no_row, 2);
  called.length = 0;
  const bound = await recheckedRows({ session, windows: plan.windows, perWindow, requirements: rows,
    runners: [runner(0), runner(1), runner(2)], judgeOf: judgeOfK, requestBound: 1000 });
  assert.deepEqual(called, [], 'nothing over the bound is sent');
  assert.equal(bound.record.withheld.bound, 3);
  for (const { record } of [unread, bound]) {
    const withheld = Object.values(record.withheld).reduce((n, k) => n + k, 0);
    assert.equal(withheld + record.notChecked + record.upheld, record.pairs, 'every row and window is counted once');
    assert.equal(Object.values(record.outcomes).reduce((n, k) => n + k, 0), record.rows, 'every accusing ask once');
  }
  assert.deepEqual(bound.requirements.map((r) => r.recheck), [{ outcome: 'not_checked_after_later_work' },
    { outcome: 'not_checked_after_later_work' }]);
});

test('D153: rows no later window re-checks carry their selection\'s outcome; a helper\'s later work is named', async () => {
  const session = launchSession();
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  const rows = [{ text: 'fix', instruction: receipt('I1', 'instruction', 'fix greet.js'), status: 'partly-done',
    deliverable: receipt('ED1', 'code', 'return name'), shortfall: receipt('C1', 'commentary', 'I did not add a test') },
  { text: 'last', instruction: receipt('I1', 'instruction', 'add a test for it'), status: 'not-done',
    shortfall: receipt('C9', 'commentary', 'The changelog') },
  { text: 'gone', instruction: receipt('X1', 'instruction', 'gone'), status: 'not-done',
    shortfall: receipt('X2', 'commentary', 'gone') },
  { text: 'done', instruction: receipt('I1', 'instruction', 'fix'), status: 'done',
    deliverable: receipt('ED1', 'code', 'return') }];
  const out = await recheckedRows({ session, windows: plan.windows, perWindow: [{ requirements: rows }], requirements: rows,
    runners: [], judgeOf: () => { throw new Error('no call'); }, requestBound: 10_000_000 });
  assert.deepEqual(out.requirements.map((r) => r.recheck ?? null), [{ outcome: 'not_checked_after_later_work' },
    { outcome: 'no_later_work' }, { outcome: 'not_placed' }, null]);
  assert.deepEqual(out.record.outcomes, zeros(RECHECK_OUTCOMES, { not_checked_after_later_work: 1, no_later_work: 1,
    not_placed: 1 }));
  assert.equal(out.record.launched, 1);
  assert.equal(out.record.calls, 0);
  assert.deepEqual(out.requirements[3], rows[3], 'a row that accuses nothing is untouched');
});

test('D153: the moved row keeps the instruction the window published, byte for byte', async () => {
  const off = await review(judgeOf(), false);
  const on = await review(judgeOf({ answers: { 'narrative:w3:recheck': row(ASK1, 'done', { deliverable: TEST_OK }) } }));
  const published = (report) => report.requirements.find((r) => r.instruction?.eventId === 'I1' && r.codeMade !== true);
  assert.equal(published(on).recheck.outcome, 'moved');
  assert.deepEqual(published(on).instruction, published(off).instruction);
  assert.equal(published(on).instruction.sessionKey, 'sess-d153-recheck', 'the published shape, session key kept');
});

test('D153: the challengers are shown each receipt in the response contract\'s shape alone (no session key)', async () => {
  const seen = [];
  await review(judgeOf({ seen, answers: { 'narrative:w3:recheck': row(ASK1, 'done', { deliverable: TEST_OK }) } }));
  const votes = seen.filter((request) => request.challenge && /^challenge:w3:recheck:/.test(request.label));
  assert.ok(votes.length > 0);
  for (const request of votes) {
    assert.ok(!request.prompt.includes('sessionKey') && !request.prompt.includes('childId'), request.label);
    for (const { candidate } of request.challenge.items) for (const field of ['instruction', 'deliverable'])
      assert.deepEqual(Object.keys(candidate[field]), ['eventId', 'role', 'quote'], field);
  }
});

test('D153: a later window\'s action is judged by the results recorded by that window\'s end', async () => {
  // w2 holds an action whose only result is recorded in w3: at w2's end it had not finished, so it delivers nothing there.
  const session = () => build([
    ['I1', 'ask', 'ask1'], ['ED1', 'edit', 'edit1'], ['C1', 'said', 'said1'], ['F1', 'filler'],
    ['I2', 'ask', 'ask2', { turn: 'T2' }], ['C2', 'said', 'said2', { turn: 'T2' }], ['A2', 'cmd', 'run3', { turn: 'T2' }],
    ['F2', 'filler', 'cat', { turn: 'T2' }],
    ['I3', 'ask', 'ask3', { turn: 'T3' }], ['A2-r', 'out', 'out3', { of: 'A2', turn: 'T3' }],
    ['A3', 'cmd', 'run3', { turn: 'T3' }], ['A3-r', 'out', 'out3', { of: 'A3', turn: 'T3' }],
    ['C3', 'said', 'helperSaid2', { turn: 'T3' }], ['F3', 'filler', 'cat', { turn: 'T3' }]]);
  const report = await runReview({ session: session(), pr: null, reviewScope: 'session-only', afterPointRecheck: true,
    judge: judgeOf({ answers: {
      'narrative:w2:recheck': row(ASK1, 'done', { deliverable: receipt('A2', 'action', 'node --test test/greet.test.js') }),
      'narrative:w3:recheck': row(ASK1, 'not-checked', {}) } }) });
  assert.equal(ask1(report).status, 'partly-done');
  assert.equal(report.recheck.withheld.ungrounded, 1);
  assert.deepEqual(report.recheck.ungroundedCauses, undefined, 'a check that had not finished, not a quote gate cause');
});

test('D153: a combined review never runs the re-check, even when asked', async () => {
  const seen = [];
  const report = await runReview({ session: stageSession(), pr: null, reviewScope: 'combined', afterPointRecheck: true,
    judge: judgeOf({ seen }) });
  assert.equal(Object.hasOwn(report, 'recheck'), false);
  assert.ok(!seen.some((request) => /:recheck/.test(request.label)));
});

test('D153: a row found not-done may be moved to partly-done on a later part delivered, under the same checks', async () => {
  const ask2Report = (answer) => review(judgeOf({ answers: { 'narrative:w2:recheck': row(ASK1, 'not-checked', {}),
    'narrative:w3:recheck': narrative([{ text: 'x', instruction: ASK1, status: 'not-checked' },
      { text: 'y', instruction: ASK2, ...answer }]) } }));
  const seen = [];
  const moved = await review(judgeOf({ seen, answers: { 'narrative:w2:recheck': row(ASK1, 'not-checked', {}),
    'narrative:w3:recheck': narrative([{ text: 'x', instruction: ASK1, status: 'not-checked' },
      { text: 'y', instruction: ASK2, status: 'partly-done', deliverable: TEST_RAN, shortfall: SAID_DONE }]) } }));
  assert.ok(seen.some((request) => request.challenge && /^challenge:w3:recheck:/.test(request.label)
    && request.prompt.includes(RECHECK_PROPOSITIONS.partly)), 'asked on its own proposition');
  assert.deepEqual(ask2(moved), { text: 'the changelog', instruction: ASK2, status: 'partly-done', deliverable: TEST_RAN,
    shortfall: SAID_DONE, recheck: { outcome: 'moved', window: 3, earlier: { status: 'not-done', shortfall: NO_LOG } } });
  assert.equal(moved.recheck.settled.partlyDone, 1);
  // The part delivered must be work, not the agent's words; and both receipts this window's own.
  const said = await ask2Report({ status: 'partly-done', deliverable: SAID_DONE, shortfall: SAID_DONE });
  assert.equal(said.recheck.withheld.commentary_only, 1);
  assert.equal(ask2(said).status, 'not-done');
  const carried = await ask2Report({ status: 'partly-done', deliverable: TEST_RAN, shortfall: NO_LOG });
  assert.equal(carried.recheck.withheld.not_after_anchor, 1);
  // A row found partly-done is never given partly-done again: the answer is read as not-done, a reaffirmation.
  const kept = await review(judgeOf({ answers: { 'narrative:w3:recheck': row(ASK1, 'partly-done',
    { deliverable: TEST_RAN, shortfall: SAID_DONE }) } }));
  assert.deepEqual(ask1(kept).recheck, { outcome: 'reaffirmed', window: 3, earlier: { shortfall: NO_TEST } });
  assert.deepEqual(ask1(kept).deliverable, FIXED, 'its own deliverable kept');
});
