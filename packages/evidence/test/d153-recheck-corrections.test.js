// D153: the after-point re-check of the contradicted claims and of the contradicted statements written into
// files, behind the same option as the asks' (off by default). A later window of the row's session is asked once, with
// every row it re-checks; a claim moves to corrected only on a later RESULT of that window (with the agent's later
// words beside it: the resolution's shape), a statement only on a later landed write of the same file that replaced it;
// each through the quote gate, to that window's own events after the row, and an upheld three-pass check. Nothing
// reaffirms a claim or a statement, and silence leaves it as it was. Synthetic sessions and judges in code only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runReview, planWindowRequests, recheckedRows } from '../src/run-review.js';
import { recheckRequest, RECHECK_NOW_ANSWER, RECHECK_NOW_ANSWER_ROWS, RECHECK_CLAIM_HEADING, RECHECK_CLAIM_WORDS,
  RECHECK_CLAIM_ROWS, RECHECK_WRITTEN_HEADING, RECHECK_WRITTEN_WORDS, RECHECK_WRITTEN_ROWS } from '../src/prompt.js';
import { RECHECK_OUTCOMES, RECHECK_WITHHELD, RECHECK_KINDS, RECHECK_CLAIM_ITEM_TYPE, RECHECK_WRITTEN_ITEM_TYPE,
  DISCLOSURE_REASONS, RESOLUTION_CHALLENGE_OUTCOMES } from '../src/ledger.js';
import { RECHECK_CORRECTION_PROPOSITIONS, RECHECK_CLAIM_NOTE, RECHECK_WRITTEN_NOTE, checklistProposition,
  checklistSystem, SESSION_CHALLENGE_CORE } from '../src/challenge.js';
import { writtenCorrection } from '../src/written.js';
import { itemKindOf } from '../src/triage.js';
import { build, correctionSession, laterCorrectionSession, recontradictionSession, receipt, README }
  from './d153-recheck-fixture.js';

const STATED = receipt('C1', 'commentary', 'All tests pass.');
const FAIL = receipt('A1-r', 'observation', 'not ok 1 - empty name gives the guest greeting');
const W_STATED = receipt('WR1', 'code', 'Empty names get the guest greeting.');
const PASS = receipt('A2-r', 'observation', 'ok 1 - empty name gives the guest greeting');
const SAID = receipt('C2', 'commentary', 'all tests pass now.');
const REPLACED = receipt('ED2', 'code', 'Empty names are refused with an error.');
const CLAIM_TEXT = 'all tests pass';
const W_TEXT = 'empty names get the guest greeting';
const narrative = (x = {}) => ({ decisions: [], pivots: [], claims: [], requirements: [], ...x });
const claimRow = (resolvedBy, stated = STATED) => ({ text: CLAIM_TEXT, stated, contradictedBy: null, resolvedBy });
const writtenRow = (stated = REPLACED, text = W_TEXT) => ({ text, stated, contradictedBy: null });
/** w1 finds the claim and the statement contradicted by the failing run. */
const FIRST = { 'narrative:w1': narrative({ claims: [{ text: CLAIM_TEXT, stated: STATED, contradictedBy: FAIL }],
  writtenClaims: [{ text: W_TEXT, stated: W_STATED, contradictedBy: FAIL }] }) };
const CORRECTED = narrative({ claims: [claimRow({ observation: PASS, statement: SAID })], writtenClaims: [writtenRow()] });

/** A judge in code: each narrative label's answer from `answers` (FIRST for the windows), and every challenge vote
 *  `verdict(item)` citing `cite(item)`: by default a correction's RESULT or write, else the item's contradiction. */
function judgeOf({ answers = {}, verdict = () => 'not-refuted', cite = null, seen = [] } = {}) {
  const own = (c) => c?.correctedBy?.observation ?? c?.correctedBy ?? c?.contradictedBy ?? c?.stated ?? null;
  return async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map((item) => {
      const cited = (cite ?? ((x) => own(x.candidate)))(item);
      return { key: item.key, verdict: verdict(item), explanation: `Synthetic check of ${item.key}.`,
        receipts: cited ? [{ eventId: cited.eventId, role: cited.role, quote: cited.quote }] : [] };
    }) };
    const answer = Object.hasOwn(answers, request.label) ? answers[request.label] : FIRST[request.label];
    return structuredClone(answer ?? narrative());
  };
}
const review = (judge, { on = true, session = correctionSession() } = {}) => runReview({ session, pr: null,
  reviewScope: 'session-only', judge, ...(on ? { afterPointRecheck: true } : {}) });
const bare = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'sessionKey' ? undefined : v)));
const claimOf = (report) => bare(report.findings.find((f) => f.kind === 'claim_contradicted'));
const writtenOf = (report) => bare(report.writtenClaims[0]);
/** The item kind of a row as the session review recorded it, before the re-check's outcome. */
const recordedKind = (source, row) => { const { recheck: _outcome, ...rest } = row; return itemKindOf(source, rest); };
const zeros = (list, set = {}) => Object.fromEntries(list.map((k) => [k, set[k] ?? 0]));

test('D153: the vocabularies, the items\' propositions and notes', () => {
  assert.deepEqual(DISCLOSURE_REASONS, ['self_corrected', 'helper_internal', 'disclosed', 'corrected_later']);
  assert.equal(RECHECK_CLAIM_ITEM_TYPE, 'recheck-claim');
  assert.equal(RECHECK_WRITTEN_ITEM_TYPE, 'recheck-written');
  assert.ok(Object.isFrozen(RECHECK_CORRECTION_PROPOSITIONS));
  assert.equal(checklistProposition({ type: RECHECK_CLAIM_ITEM_TYPE, candidate: {} }),
    RECHECK_CORRECTION_PROPOSITIONS.claim);
  assert.equal(checklistProposition({ type: RECHECK_WRITTEN_ITEM_TYPE, candidate: {} }),
    RECHECK_CORRECTION_PROPOSITIONS.written);
  assert.equal(checklistSystem([RECHECK_CLAIM_ITEM_TYPE, RECHECK_WRITTEN_ITEM_TYPE]),
    `${SESSION_CHALLENGE_CORE}\n${RECHECK_CLAIM_NOTE}\n${RECHECK_WRITTEN_NOTE}`);
  assert.ok(!checklistSystem(['recheck']).includes(RECHECK_CLAIM_NOTE), 'a batch of asks alone keeps its bytes');
  // The kinds the readers read from the re-check's closed tokens.
  const ask = { status: 'partly-done', instruction: STATED };
  assert.equal(itemKindOf('requirements', { ...ask, recheck: { outcome: 'not_checked_after_later_work' } }),
    'ask_not_checked_after_later_work');
  assert.equal(itemKindOf('requirements', { ...ask, status: 'not-done', recheck: { outcome: 'not_checked_after_later_work' } }),
    'ask_not_checked_after_later_work');
  // The owner, 2026-10-26: a reaffirmed ask is shown no stronger than one no later window settled; one with no later
  // work, or not placed, keeps its kind.
  assert.equal(itemKindOf('requirements', { ...ask, recheck: { outcome: 'reaffirmed' } }),
    'ask_not_checked_after_later_work');
  for (const outcome of ['no_later_work', 'not_placed'])
    assert.equal(itemKindOf('requirements', { ...ask, recheck: { outcome } }), 'ask_partly_done', outcome);
  assert.equal(itemKindOf('requirements', { status: 'done', recheck: { outcome: 'moved' } }), null);
  assert.equal(itemKindOf('writtenClaims', { label: 'contradicted', disclosureReason: 'corrected_later' }),
    'written_corrected');
  assert.equal(itemKindOf('writtenClaims', { label: 'contradicted', disclosureReason: 'other' }), 'written_contradicted');
});

test('D153: off by default — the claim and the statement as a review that never heard of it', async () => {
  const seen = [];
  const off = await review(judgeOf({ seen }), { on: false });
  assert.ok(!seen.some((request) => /:recheck/.test(request.label)));
  assert.equal(itemKindOf('findings', off.findings[0]), 'claim_contradicted');
  assert.equal(itemKindOf('writtenClaims', off.writtenClaims[0]), 'written_contradicted');
  assert.ok(off.findings.every((f) => !Object.hasOwn(f, 'recheck') && !Object.hasOwn(f, 'correctedBy')));
  assert.ok(off.writtenClaims.every((w) => !Object.hasOwn(w, 'recheck') && !Object.hasOwn(w, 'disclosureReason')));
});

test('D153: a later result corrects the claim; a later edit that replaced it corrects the statement', async () => {
  const seen = [];
  const off = await review(judgeOf(), { on: false });
  const report = await review(judgeOf({ seen, answers: { 'narrative:w2:recheck': CORRECTED } }));
  // The claim: FYI, the reason, both later receipts (published as the window publishes them), the accusation kept.
  const claim = claimOf(report);
  assert.equal(claim.status, 'FYI');
  assert.equal(claim.disclosureReason, 'corrected_later');
  assert.deepEqual(claim.correctedBy, { observation: PASS, statement: SAID });
  assert.deepEqual(claim.recheck, { outcome: 'moved', window: 2 });
  assert.deepEqual(claim.receipts, claimOf(off).receipts, 'its receipts and identity are the accusation\'s');
  assert.equal(claim.id, claimOf(off).id);
  assert.equal(itemKindOf('findings', report.findings[0]), 'claim_corrected');
  assert.equal(report.findings[0].correctedBy.observation.sessionKey, 'sess-d153-recheck');
  // The statement: its label and receipts stay; the reason and the later write beside them.
  const written = writtenOf(report);
  assert.deepEqual(written, { ...writtenOf(off), disclosureReason: 'corrected_later', correctedBy: REPLACED,
    recheck: { outcome: 'moved', window: 2 } });
  assert.equal(itemKindOf('writtenClaims', report.writtenClaims[0]), 'written_corrected');
  // No accusing finding is left: the session's status is the FYI's.
  assert.equal(off.sessionStatus, 'DECIDE');
  assert.equal(report.sessionStatus, 'FYI');
  // One call for window 2, with both rows; the claim named by the window's alias, every earlier receipt by quote alone.
  const sent = seen.filter((request) => /:recheck$/.test(request.label));
  assert.deepEqual(sent.map((request) => request.label), ['narrative:w2:recheck']);
  const plan = planWindowRequests({ session: correctionSession(), reviewScope: 'session-only' });
  const alias = plan.requests[1].aliases.of('C1');
  assert.ok(sent[0].prompt.includes(`{"text":"${CLAIM_TEXT}","stated":{"eventId":"${alias}","role":"commentary",`
    + `"quote":"All tests pass."},"contradictedBy":{"role":"observation","quote":"${FAIL.quote}"}}`));
  assert.ok(sent[0].prompt.includes(`{"text":"${W_TEXT}","stated":{"role":"code","quote":"${W_STATED.quote}"},`
    + `"contradictedBy":{"role":"observation","quote":"${FAIL.quote}"}}`));
  assert.ok(sent[0].prompt.endsWith([...RECHECK_NOW_ANSWER_ROWS.head, RECHECK_NOW_ANSWER_ROWS.claims,
    RECHECK_NOW_ANSWER_ROWS.written, RECHECK_NOW_ANSWER_ROWS.tail].join('\n')));
  // Its three-pass check: both items, each on its own proposition, bound through its RESULT or write alone.
  const votes = seen.filter((request) => request.challenge && /^challenge:w2:recheck:/.test(request.label));
  assert.deepEqual([...new Set(votes.map((request) => request.challenge.pass))], [1, 2, 3]);
  assert.deepEqual(votes[0].challenge.items.map((item) => item.type), [RECHECK_CLAIM_ITEM_TYPE, RECHECK_WRITTEN_ITEM_TYPE]);
  assert.ok(votes[0].prompt.includes(RECHECK_CORRECTION_PROPOSITIONS.claim));
  assert.ok(votes[0].prompt.includes(RECHECK_CORRECTION_PROPOSITIONS.written));
  for (const { candidate } of votes[0].challenge.items) {
    assert.ok(!JSON.stringify(candidate).includes('sessionKey'));
    assert.ok(!Object.hasOwn(candidate.earlier.contradictedBy, 'eventId'), 'the earlier contradiction by quote alone');
  }
  assert.deepEqual(report.recheck.kinds, { ask_partly_done: { rows: 0, outcomes: zeros(RECHECK_OUTCOMES) },
    ask_not_done: { rows: 0, outcomes: zeros(RECHECK_OUTCOMES) },
    claim_contradicted: { rows: 1, outcomes: zeros(RECHECK_OUTCOMES, { moved: 1 }) },
    written_contradicted: { rows: 1, outcomes: zeros(RECHECK_OUTCOMES, { moved: 1 }) } });
  assert.deepEqual(Object.keys(report.recheck.kinds), [...RECHECK_KINDS]);
  assert.deepEqual(report.recheck.settled, { done: 0, partlyDone: 0, notDone: 0, claimCorrected: 1, writtenCorrected: 1 });
  assert.equal(report.recheck.upheld, 2);
  assert.deepEqual(report.recheck.withheld, zeros(RECHECK_WITHHELD));
});

test('D153: silence leaves a claim and a statement as they were in the record; the readers show them not checked after later work', async () => {
  const report = await review(judgeOf({ answers: { 'narrative:w2:recheck': narrative({ claims: [claimRow(null)] }) } }));
  assert.equal(report.recheck.notChecked, 2, 'no correction for the claim, no row for the statement');
  assert.equal(claimOf(report).status, 'DECIDE');
  assert.equal(recordedKind('findings', report.findings[0]), 'claim_contradicted');
  assert.deepEqual(claimOf(report).recheck, { outcome: 'not_checked_after_later_work' });
  assert.equal(recordedKind('writtenClaims', report.writtenClaims[0]), 'written_contradicted');
  assert.deepEqual(writtenOf(report).recheck, { outcome: 'not_checked_after_later_work' });
  assert.equal(report.sessionStatus, 'DECIDE');
  // D153, the owner's call of 2026-10-26: every reader shows them not checked after later work.
  assert.equal(itemKindOf('findings', report.findings[0]), 'claim_not_checked_after_later_work');
  assert.equal(itemKindOf('writtenClaims', report.writtenClaims[0]), 'written_not_checked_after_later_work');
});

test('D153: every withheld reason of a correction, and how its check ended', async () => {
  const shown = (quote) => receipt('A2-r', 'observation', quote);
  const cases = [
    ['no row of the claim', { claims: [] }, { no_row: 1 }, 1],
    ['two rows of the claim', { claims: [claimRow(null), claimRow({ observation: PASS, statement: SAID })] },
      { no_row: 1 }, 1],
    ['other words of the claim', { claims: [claimRow({ observation: PASS, statement: SAID },
      receipt('C1', 'commentary', 'All tests'))] }, { no_row: 1 }, 1],
    ['a resolution of other roles', { claims: [claimRow({ observation: SAID, statement: PASS })] }, { ungrounded: 1 }, 1],
    ['a quote no window shows', { claims: [claimRow({ observation: shown('words no window shows'), statement: SAID })] },
      { ungrounded: 1 }, 1],
    ['the earlier contradiction itself', { claims: [claimRow({ observation: FAIL, statement: SAID })] },
      { not_after_anchor: 1 }, 1],
    ['an earlier thought', { claims: [claimRow({ observation: PASS, statement: STATED })] }, { not_after_anchor: 1 }, 1],
    ['two rows of the statement', { claims: [claimRow(null)], writtenClaims: [writtenRow(), writtenRow()] },
      { no_row: 1 }, 1],
    ['a row of other words than the statement\'s', { claims: [claimRow(null)],
      writtenClaims: [writtenRow(REPLACED, 'other words')] }, {}, 2],
    // An earlier window's write: no later window shows it (an action is never carried), so the quote gate refuses it.
    ['the earlier write', { claims: [claimRow(null)], writtenClaims: [writtenRow(W_STATED)] }, { ungrounded: 1 }, 1],
    ['the test run, not a write', { claims: [claimRow(null)], writtenClaims: [writtenRow(receipt('A2', 'code',
      'npm test'))] }, { ungrounded: 1 }, 1],
  ];
  for (const [name, answer, withheld, notChecked] of cases) {
    const report = await review(judgeOf({ answers: { 'narrative:w2:recheck': narrative(answer) } }));
    assert.deepEqual(report.recheck.withheld, zeros(RECHECK_WITHHELD, withheld), name);
    assert.equal(report.recheck.notChecked, notChecked, name);
    assert.equal(report.recheck.outcomes.moved, 0, name);
    assert.equal(claimOf(report).status, 'DECIDE', name);
    assert.equal(recordedKind('writtenClaims', report.writtenClaims[0]), 'written_contradicted', name);
  }
  // A later run that failed shows no claimed state, whatever it prints.
  const failed = await review(judgeOf({ answers: { 'narrative:w2:recheck': narrative({ claims: [claimRow({
    observation: receipt('A2-r', 'observation', FAIL.quote), statement: SAID })] }) } }), {
    session: correctionSession({ pass: 'fail' }) });
  assert.equal(failed.recheck.withheld.failed_result, 1);
  // A later edit of the file that keeps the statement, and one with no recorded result, replace nothing.
  for (const edit2 of [[['ED2', 'edit', 'readme3', { path: README, replaced: 'readme1', turn: 'T2' }],
    ['ED2-r', 'out', 'updated', { of: 'ED2', turn: 'T2' }]],
  [['ED2', 'edit', 'readme2', { path: README, replaced: 'readme1', turn: 'T2' }], ['ED2-x', 'said', 'updated',
    { turn: 'T2' }]]]) {
    const kept = await review(judgeOf({ answers: { 'narrative:w2:recheck': narrative({ claims: [claimRow(null)],
      writtenClaims: [writtenRow(edit2[0][2] === 'readme3' ? receipt('ED2', 'code', 'See greet.js.') : REPLACED)] }) } }),
    { session: correctionSession({ edit2 }) });
    assert.equal(kept.recheck.withheld.not_rewritten, 1, edit2[0][2]);
    assert.equal(recordedKind('writtenClaims', kept.writtenClaims[0]), 'written_contradicted');
  }
  // Refuted, unsettled, and a vote that cites only the agent's later words: none moves anything.
  const answers = { 'narrative:w2:recheck': CORRECTED };
  const only = (verdict) => (item) => (item.type.startsWith('recheck') ? verdict : 'not-refuted');
  const refuted = await review(judgeOf({ answers, verdict: only('refuted') }));
  assert.equal(refuted.recheck.withheld.challenge_refuted, 2);
  assert.deepEqual(refuted.recheck.challenged, zeros(RESOLUTION_CHALLENGE_OUTCOMES, { refuted: 2 }));
  const unsettled = await review(judgeOf({ answers, verdict: only('uncertain') }));
  assert.equal(unsettled.recheck.withheld.challenge_unsettled, 2);
  const wordsOnly = await review(judgeOf({ answers, cite: (item) => (item.type === RECHECK_CLAIM_ITEM_TYPE
    ? item.candidate.correctedBy.statement : item.candidate.correctedBy ?? item.candidate.contradictedBy) }));
  assert.equal(claimOf(wordsOnly).status, 'DECIDE', 'the agent\'s words alone never uphold a correction');
  assert.equal(wordsOnly.recheck.withheld.challenge_unsettled, 1);
  assert.equal(wordsOnly.recheck.settled.writtenCorrected, 1);
  for (const report of [refuted, unsettled]) {
    assert.equal(claimOf(report).status, 'DECIDE');
    assert.equal(recordedKind('writtenClaims', report.writtenClaims[0]), 'written_contradicted');
    const sum = Object.values(report.recheck.withheld).reduce((n, k) => n + k, 0);
    assert.equal(sum + report.recheck.notChecked + report.recheck.upheld, report.recheck.pairs);
  }
});

test('D153: a correction is a later landed write of the same file that no longer holds the statement', () => {
  const session = (rows) => build([['WR1', 'write', 'readme1', { path: README }], ['WR1-r', 'out', 'updated',
    { of: 'WR1' }], ...rows]);
  const landed = (id, kind, key, extra) => [[id, kind, key, extra], [`${id}-r`, 'out', 'updated', { of: id }]];
  const of = (id, quote) => receipt(id, 'code', quote);
  const check = (rows, later) => writtenCorrection(session(rows), W_STATED, later);
  const NOT = 'not_rewritten';
  assert.equal(check(landed('W2', 'write', 'readme2', { path: README }), of('W2', 'refused with an error')), null,
    'a whole new body without it');
  assert.equal(check(landed('W2', 'write', 'readme3', { path: README }), of('W2', 'See greet.js.')), NOT,
    'a whole new body that keeps it');
  assert.equal(check(landed('E2', 'edit', 'readme2', { path: README, replaced: 'readme1' }), of('E2', 'an error')), null,
    'an edit that replaced it');
  assert.equal(check(landed('E2', 'edit', 'readme2', { path: README }), of('E2', 'an error')), NOT,
    'an edit whose replaced text is not recorded');
  assert.equal(check(landed('E2', 'edit', 'readme2', { path: '/srv/r/OTHER.md', replaced: 'readme1' }),
    of('E2', 'an error')), NOT, 'another file');
  assert.equal(check([['W2', 'write', 'readme2', { path: README }]], of('W2', 'an error')), NOT, 'no recorded result');
  assert.equal(check([...landed('W2', 'write', 'readme2', { path: README }), ...landed('W3', 'write', 'readme1',
    { path: README })], of('W2', 'an error')), NOT, 'a later write puts it back');
  assert.equal(check(landed('W2', 'write', 'readme2', { path: README }), W_STATED), NOT, 'the statement\'s own write');
  assert.equal(check([], of('C1', 'x')), NOT);
  assert.equal(writtenCorrection(null, null, null), NOT, 'never throws');
});

test('D153: the request — asks alone byte for byte as before; claims and statements under their own words', () => {
  const plan = planWindowRequests({ session: correctionSession(), reviewScope: 'session-only' });
  const { request, aliases } = plan.requests[1];
  const ask = { text: 'fix', instruction: receipt('I1', 'instruction', 'fix greet.js'), status: 'not-done',
    shortfall: receipt('C1', 'commentary', 'All tests') };
  const claim = { text: CLAIM_TEXT, stated: STATED, contradictedBy: FAIL };
  const written = { text: W_TEXT, stated: W_STATED, contradictedBy: FAIL };
  const asks = recheckRequest({ request, rows: [ask], aliases, label: 'x' });
  assert.deepEqual(recheckRequest({ request, rows: [ask], claims: [], written: [], aliases, label: 'x' }), asks);
  assert.ok(asks.prompt.endsWith(RECHECK_NOW_ANSWER.join('\n')));
  const mixed = recheckRequest({ request, rows: [ask], claims: [claim], written: [written], aliases, label: 'x' });
  const lines = mixed.prompt.split('\n');
  for (const part of [RECHECK_CLAIM_HEADING, ...RECHECK_CLAIM_WORDS, RECHECK_CLAIM_ROWS, RECHECK_WRITTEN_HEADING,
    ...RECHECK_WRITTEN_WORDS, RECHECK_WRITTEN_ROWS, RECHECK_NOW_ANSWER_ROWS.asks]) assert.ok(lines.includes(part), part);
  assert.ok(mixed.prompt.startsWith(asks.prompt.slice(0, asks.prompt.lastIndexOf(RECHECK_NOW_ANSWER[0]))),
    'the asks first, as alone');
  assert.equal(createHash('sha256').update(JSON.stringify([RECHECK_CLAIM_HEADING, RECHECK_CLAIM_WORDS,
    RECHECK_CLAIM_ROWS, RECHECK_WRITTEN_HEADING, RECHECK_WRITTEN_WORDS, RECHECK_WRITTEN_ROWS,
    RECHECK_NOW_ANSWER_ROWS])).digest('hex').slice(0, 16), 'bf08f8f2dea94b86', 'the fixed words, pinned');
  // Claims alone; a claim whose words the window does not name, or a row it cannot show, makes no request.
  assert.ok(recheckRequest({ request, claims: [claim], aliases, label: 'x' }).prompt.includes(RECHECK_CLAIM_HEADING));
  assert.equal(recheckRequest({ request, claims: [{ ...claim, stated: receipt('ZZ', 'commentary', 'q') }], aliases,
    label: 'x' }), null);
  assert.equal(recheckRequest({ request, written: [{ ...written, contradictedBy: null }], aliases, label: 'x' }), null);
  assert.equal(recheckRequest({ request, aliases, label: 'x' }), null);
});

test('D153: a later thought the window carries is not its own work — a claim\'s correction never rests on it', async () => {
  // w3 re-checks the claim; C2 (w2's words, after the claim) is carried into w3: shown there, after the row, not w3's own.
  const answers = { 'narrative:w1': FIRST['narrative:w1'], 'narrative:w3:recheck': narrative({ claims: [claimRow({
    observation: PASS, statement: receipt('C2', 'commentary', 'The changelog is not updated.') })] }) };
  const report = await review(judgeOf({ answers }), { session: laterCorrectionSession() });
  assert.equal(report.recheck.withheld.not_after_anchor, 1);
  assert.equal(claimOf(report).status, 'DECIDE');
  const moved = await review(judgeOf({ answers: { ...answers, 'narrative:w3:recheck': narrative({ claims: [claimRow({
    observation: PASS, statement: receipt('C3', 'commentary', 'all tests pass now.') })] }) } }),
  { session: laterCorrectionSession() });
  assert.deepEqual(claimOf(moved).recheck, { outcome: 'moved', window: 3 });
});

test('D153: two statements of one text in one window are not asked; a statement is named by its text alone', async () => {
  const session = correctionSession();
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  const statement = (text) => ({ id: text, text, label: 'contradicted', stated: W_STATED, receipts: [W_STATED, FAIL] });
  const runner = (k) => ({ request: plan.requests[k].request, aliases: plan.requests[k].aliases,
    sourceMap: plan.requests[k].sourceMap, shown: session, end: null, ask: async () => ({ results: [] }) });
  const sent = [];
  const out = await recheckedRows({ session, windows: plan.windows, perWindow: [], requirements: [], findings: [],
    written: [statement('one'), statement('one'), statement('two')], runners: [runner(0), runner(1)],
    judgeOf: () => async (request) => { sent.push(request); return narrative(); }, requestBound: 10_000_000 });
  assert.equal(out.record.withheld.not_asked, 2);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].prompt.includes('{"text":"two",') && !sent[0].prompt.includes('{"text":"one",'));
  assert.equal(out.record.notChecked, 1, 'no row of its text: none corrected');
});

test('D153: a write whose written side the record cut proves nothing about what it no longer holds', () => {
  const s = build([['WR1', 'write', 'readme1', { path: README }], ['WR1-r', 'out', 'updated', { of: 'WR1' }],
    ['W2', 'write', 'readme2', { path: README }], ['W2-r', 'out', 'updated', { of: 'W2' }]]);
  assert.equal(writtenCorrection(s, W_STATED, receipt('W2', 'code', 'an error')), null);
  s.events.find((e) => e.id === 'W2').changes[0].truncated = true;
  assert.equal(writtenCorrection(s, W_STATED, receipt('W2', 'code', 'an error')), 'not_rewritten');
  // A later write of the file that the record does not hold whole may write it back: nothing proves it stayed replaced.
  const later = () => build([['WR1', 'write', 'readme1', { path: README }], ['WR1-r', 'out', 'updated', { of: 'WR1' }],
    ['W2', 'write', 'readme2', { path: README }], ['W2-r', 'out', 'updated', { of: 'W2' }],
    ['W3', 'write', 'readme2', { path: README }], ['W3-r', 'out', 'updated', { of: 'W3' }]]);
  assert.equal(writtenCorrection(later(), W_STATED, receipt('W2', 'code', 'an error')), null, 'a whole later write');
  for (const [name, mark] of [['cut', (c) => { c.truncated = true; }], ['not recorded', (c) => { c.extent = {
    recorded: false }; }], ['redacted', (c) => { c.extent = { redactedLines: 2 }; }]]) {
    const t = later();
    mark(t.events.find((e) => e.id === 'W3').changes[0]);
    assert.equal(writtenCorrection(t, W_STATED, receipt('W2', 'code', 'an error')), 'not_rewritten', name);
  }
});

test('D153: a later RESULT showing the claim failing again voids its earlier correction; a statement written back too', async () => {
  const AGAIN = receipt('A3-r', 'observation', FAIL.quote);
  const answers = (w3) => ({ 'narrative:w1': FIRST['narrative:w1'],
    'narrative:w2:recheck': narrative({ claims: [claimRow({ observation: PASS,
      statement: receipt('C2', 'commentary', 'all tests pass now.') })], writtenClaims: [writtenRow()] }),
    'narrative:w3:recheck': narrative({ claims: [{ ...claimRow(null), ...w3 }] }) });
  // The claim corrected in w2 fails again in w3: the correction no longer stands, and no new accusation is made.
  const off = await review(judgeOf({ answers: answers({}) }), { on: false, session: recontradictionSession() });
  const voided = await review(judgeOf({ answers: answers({ contradictedBy: AGAIN }) }),
    { session: recontradictionSession() });
  // D153's fix round: the later failing RESULT is kept beside it (`later`, with its window), never challenged, so the
  // outcome stays unsettled; every reader shows it as a claim that later work followed.
  assert.deepEqual(claimOf(voided).recheck, { outcome: 'not_checked_after_later_work', window: 3,
    later: { observation: AGAIN } });
  assert.equal(itemKindOf('findings', voided.findings[0]), 'claim_not_checked_after_later_work');
  assert.equal(claimOf(voided).status, 'DECIDE');
  assert.deepEqual(claimOf(voided).receipts, claimOf(off).receipts, 'its earlier accusation, as it was');
  assert.equal(recordedKind('findings', voided.findings[0]), 'claim_contradicted');
  assert.equal(voided.recheck.voided, 1);
  assert.equal(voided.recheck.recontradicted, 1);
  assert.equal(voided.recheck.settled.claimCorrected, 0);
  // The statement replaced in w2 and written back in w3 is no correction.
  assert.equal(recordedKind('writtenClaims', voided.writtenClaims[0]), 'written_contradicted');
  assert.deepEqual(writtenOf(voided).recheck, { outcome: 'not_checked_after_later_work' });
  assert.equal(voided.recheck.withheld.not_rewritten, 1);
  const sum = (r) => Object.values(r.recheck.withheld).reduce((n, k) => n + k, 0) + r.recheck.notChecked
    + r.recheck.upheld + r.recheck.recontradicted;
  assert.equal(sum(voided), voided.recheck.pairs);
  // Without the later failure, and without the write back, both stand corrected.
  const kept = await review(judgeOf({ answers: answers({}) }), { session: recontradictionSession({ fails: false,
    putBack: false }) });
  assert.deepEqual(claimOf(kept).recheck, { outcome: 'moved', window: 2 });
  assert.equal(itemKindOf('writtenClaims', kept.writtenClaims[0]), 'written_corrected');
  // A failing RESULT recorded before the correction, or one the window does not show, voids nothing.
  const before = await review(judgeOf({ answers: { ...answers({}), 'narrative:w2:recheck': narrative({ claims: [{
    ...claimRow({ observation: PASS, statement: receipt('C2', 'commentary', 'all tests pass now.') }),
    contradictedBy: FAIL }] }) } }), { session: recontradictionSession({ fails: false, putBack: false }) });
  assert.deepEqual(claimOf(before).recheck, { outcome: 'moved', window: 2 }, 'the earlier contradiction is no later one');
  const unshown = await review(judgeOf({ answers: answers({ contradictedBy: receipt('A3-r', 'observation',
    'words no window shows') }) }), { session: recontradictionSession({ fails: false, putBack: false }) });
  assert.deepEqual(claimOf(unshown).recheck, { outcome: 'moved', window: 2 });
  assert.equal(unshown.recheck.withheld.ungrounded, 1);
  // A failure, then a later run that passes again in the same window: the latest recorded work holds, so it is corrected.
  const recovered = await review(judgeOf({ answers: answers({ contradictedBy: AGAIN, resolvedBy: {
    observation: receipt('A4-r', 'observation', PASS.quote), statement: receipt('C4', 'commentary',
      'all tests pass now.') } }) }), { session: recontradictionSession({ putBack: false, recovers: true }) });
  assert.deepEqual(claimOf(recovered).recheck, { outcome: 'moved', window: 3 });
  assert.equal(recovered.recheck.voided, 0);
});

test('D153: a helper\'s RESULT or write in a window it shares with the main agent never corrects a main row', async () => {
  // w2 packs the helper's last part (its test run and its edit of README.md) beside the main agent's later work.
  const session = () => build([
    ['I1', 'ask', 'ask1'], ['WR1', 'write', 'readme1', { path: README }], ['WR1-r', 'out', 'updated', { of: 'WR1' }],
    ['A1', 'cmd', 'testRun'], ['A1-r', 'fail', 'testFail', { of: 'A1' }], ['C1', 'said', 'claim1'], ['F1', 'filler'],
    ['I2', 'ask', 'ask2', { turn: 'T2' }], ['D1', 'delegate', 'brief', { turn: 'T2' }],
    ['B1', 'brief', 'brief', { child: true }], ['WC', 'said', 'helperSaid', { child: true }],
    ['WF1', 'filler', 'cat', { child: true }], ['WF2', 'filler', 'cat', { child: true }],
    ['WC2', 'said', 'helperSaid2', { child: true }],
    ['WA', 'cmd', 'testRun', { child: true }], ['WA-r', 'out', 'testPass', { of: 'WA', child: true }],
    ['WE', 'edit', 'readme2', { path: README, replaced: 'readme1', child: true }],
    ['WE-r', 'out', 'updated', { of: 'WE', child: true }],
    ['C2', 'said', 'said2', { turn: 'T2' }], ['F2', 'filler', 'cat', { turn: 'T2' }],
    ['I3', 'ask', 'ask3', { turn: 'T3' }], ['C3', 'said', 'claim2', { turn: 'T3' }], ['F3', 'filler', 'cat', { turn: 'T3' }]]);
  const plan = planWindowRequests({ session: session(), reviewScope: 'session-only' });
  const mixed = plan.windows.findIndex((w) => Array.isArray(w.parts) && w.parts.length > 1
    && w.parts.some((p) => (p.events ?? []).some((e) => e.id === 'WA-r'))
    && w.parts.some((p) => (p.events ?? []).some((e) => e.id === 'C3')));
  assert.ok(mixed > 0, 'the helper\'s test run is packed beside the main agent\'s later words');
  const answers = { 'narrative:w1': FIRST['narrative:w1'], [`narrative:w${mixed + 1}:recheck`]: narrative({
    claims: [claimRow({ observation: receipt('WA-r', 'observation', PASS.quote),
      statement: receipt('C3', 'commentary', 'all tests pass now.') })],
    writtenClaims: [writtenRow(receipt('WE', 'code', 'Empty names are refused with an error.'))] }) };
  const report = await review(judgeOf({ answers }), { session: session() });
  assert.equal(report.recheck.withheld.not_after_anchor, 2, 'the helper\'s events are not the main agent\'s own');
  // The main agent's own later work in the same window does move it (the window is asked, and reads it).
  const own = await review(judgeOf({ answers: { ...answers, [`narrative:w${mixed + 1}:recheck`]: narrative({
    claims: [claimRow({ observation: receipt('C3', 'commentary', 'all tests pass now.'),
      statement: receipt('C3', 'commentary', 'all tests pass now.') })] }) } }), { session: session() });
  assert.equal(own.recheck.withheld.ungrounded, 1, 'and the agent\'s words alone never correct it');
  assert.equal(claimOf(report).status, 'DECIDE');
  assert.equal(recordedKind('writtenClaims', report.writtenClaims[0]), 'written_contradicted');
});

test('D153 fix round: a claim failing again in two later windows keeps the latest RESULT beside it, and no correction', async () => {
  const twice = receipt('A2-r', 'observation', FAIL.quote);
  const again = receipt('A3-r', 'observation', FAIL.quote);
  const answers = { 'narrative:w1': FIRST['narrative:w1'],
    'narrative:w2:recheck': narrative({ claims: [{ ...claimRow(null), contradictedBy: twice }] }),
    'narrative:w3:recheck': narrative({ claims: [{ ...claimRow(null), contradictedBy: again }] }) };
  const report = await review(judgeOf({ answers }), { session: recontradictionSession({ w2Fails: true,
    putBack: false }) });
  assert.deepEqual(claimOf(report).recheck, { outcome: 'not_checked_after_later_work', window: 3,
    later: { observation: again } });
  assert.deepEqual([report.recheck.recontradicted, report.recheck.voided], [2, 0]);
  assert.equal(itemKindOf('findings', report.findings[0]), 'claim_not_checked_after_later_work');
  // A correction that stands after the failure keeps none: the claim is corrected.
  const recovered = await review(judgeOf({ answers: { ...answers, 'narrative:w3:recheck': narrative({ claims: [{
    ...claimRow({ observation: receipt('A4-r', 'observation', PASS.quote), statement: receipt('C4', 'commentary',
      'all tests pass now.') }), contradictedBy: again }] }) } }), { session: recontradictionSession({ w2Fails: true,
    putBack: false, recovers: true }) });
  assert.deepEqual(claimOf(recovered).recheck, { outcome: 'moved', window: 3 });
});
