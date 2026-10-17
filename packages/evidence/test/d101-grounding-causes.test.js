// D101 (owner decision 2026-10-17): the checklist's quote gate names the grounding test that refused a quote. One closed,
// ordered list of tests (ledger.js GROUNDING_CAUSES), one cause token each; the gate returns `{ ok }` or `{ ok: false,
// cause }`; the row keeps its closed reason and gains the cause; the reader's words come from the cause and name only
// the failed test and code's numbers. Every recording here is synthetic; no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { planWindowRequests, runReview } from '../src/run-review.js';
import { SKIM_SIDE_BYTES } from '../src/windows.js';
import { Session, verifyReceipt } from '../src/session.js';
import { checkedRequirement, failuresCheck, publishedResponse, DELIVERABLE_ROLES, FAILURE_RESPONSE_ROLES }
  from '../src/checklist.js';
import { GROUNDING_CAUSES, GROUNDING_LENGTH_CAUSES, GROUNDING_ANCHOR_CAUSES, GROUNDING_GATE_REASONS, QUOTE_PLACES,
  QUOTE_LIMITS, REQUIREMENT_UNCHECKED_REASONS, FAILURE_UNCHECKED_REASONS, EVIDENCE_QUOTE_MAX, groundingCheck,
  groundingTestHolds, quotePlace, oneSession } from '../src/ledger.js';
import { CHECKLIST_GROUNDING_CAUSE_WORDS, CHECKLIST_QUOTE_ANCHOR_WORDS, CHECKLIST_REQUIREMENT_REASON_WORDS,
  CHECKLIST_FAILURE_REASON_WORDS, checklistReasonWords } from '../src/review.js';
import { reportModel } from '../../render/report-model.js';
import { renderSessionPage } from '../../render/session-page.js';
import { renderReportMarkdown } from '../../render/session-story.js';

// ---- a synthetic session: a remark before the ask, the ask, a long remark after it, one more the window never showed, a
// helper's remark after the ask (the window shows it beside the ask), a remark with no recorded order, one that holds a
// mark like Sonah's as its own text, and one of emoji ----------------------------------------------------------------

const EARLY = 'SYNTHETIC_EARLY: I renamed the parser module before you asked.';
const ASKED = 'SYNTHETIC_ASK: rename the parser module and update its imports.';
const LONG = `SYNTHETIC_DONE ${'renamed the parser module and every import of it, '.repeat(4)}`;
const HIDDEN = 'SYNTHETIC_HIDDEN: the imports now point at the renamed module.';
const HELPER = 'SYNTHETIC_HELPER: the helper renamed the parser module for you.';
const UNORDERED = 'SYNTHETIC_UNORDERED: the parser module has its new name now.';
const MARKED = 'SYNTHETIC_MARKED: keep the [Continue reading…] link in the parser docs.';
const EMOJI = `SYNTHETIC_EMOJI ${'😀'.repeat(70)}`;
const span = (key, text) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
const remark = (id, key, text, extra) => ({ id, kind: 'commentary', phase: 'final', beforeInvocation: null,
  text: span(key, text), ...extra });
const sessionOf = () => new Session({ sessionKey: 'sess-d101', adapter: 'claude',
  blobs: { early: EARLY, ask: ASKED, long: LONG, hidden: HIDDEN, helper: HELPER, unordered: UNORDERED, marked: MARKED,
    emoji: EMOJI },
  events: [
    { id: 'C0', kind: 'commentary', phase: 'commentary', beforeInvocation: null, text: span('early', EARLY), sequence: 0 },
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: span('ask', ASKED), sequence: 1 },
    remark('C1', 'long', LONG, { sequence: 2 }),
    remark('C2', 'hidden', HIDDEN, { sequence: 3 }),
    remark('H1', 'helper', HELPER, { sequence: 4, childId: 'agent-helper' }),
    remark('C3', 'unordered', UNORDERED, {}),
    remark('C4', 'marked', MARKED, { sequence: 6 }),
    remark('C5', 'emoji', EMOJI, { sequence: 7 }),
  ], children: [] });
/** What the window showed: every event but C2. */
const SOURCE_MAP = Object.freeze(Object.fromEntries([['I1', 'instruction'], ...['C0', 'C1', 'H1', 'C3', 'C4', 'C5']
  .map((id) => [id, 'commentary'])].map(([id, role]) => [id, [{ role }]])));
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const ask = quote('I1', 'instruction', 'rename the parser module');
const done = (deliverable) => ({ text: 'rename the module', instruction: ask, status: 'done',
  ...(deliverable === undefined ? {} : { deliverable }) });
const notDone = (shortfall) => ({ text: 'rename the module', instruction: ask, status: 'not-done', shortfall });
/** The deliverable's gate, as checklist.js `checkedRequirement` runs it: after the ask, in the ask's session. */
const optionsOf = (session) => ({ field: 'deliverable', roles: DELIVERABLE_ROLES, sourceMap: SOURCE_MAP,
  anchor: { event: session.event('I1'), sameSession: true } });

/** Each case: a deliverable that the gate refuses at one test, in GROUNDING_CAUSES order (session_mismatch apart: the
 *  checklist's receipt shape admits no session key, so only `groundingCheck` with a wider shape reaches it). */
const CASES = [
  ['receipt_malformed', undefined],
  ['receipt_malformed', { ...quote('C1', 'commentary', 'renamed the parser module'), childId: 'x' }],
  ['role_not_allowed', quote('I1', 'instruction', 'rename the parser module')],
  ['quote_too_short', quote('C1', 'commentary', ' re ')],
  ['quote_over_limit', quote('C1', 'commentary', LONG.slice(0, EVIDENCE_QUOTE_MAX + 1))],
  ['event_missing', quote('C9', 'commentary', 'renamed the parser module')],
  ['role_not_event_kind', quote('C1', 'code', 'renamed the parser module')],
  ['event_not_shown', quote('C2', 'commentary', 'the imports now point at')],
  ['synthetic_marker', quote('C1', 'commentary', 'renamed the parser […] module')],
  ['synthetic_marker', quote('C4', 'commentary', 'keep the [Continue reading…] link')],
  ['not_found', quote('C1', 'commentary', 'words that are nowhere at all')],
  ['not_found', quote('C1', 'commentary', 'I renamed the parser module before')],
  ['not_anchor_session', quote('H1', 'commentary', 'the helper renamed the parser module')],
  ['not_after', quote('C0', 'commentary', 'I renamed the parser module before')],
  ['not_after', quote('C3', 'commentary', 'the parser module has its new name')],
];

/** The gate as it was before D101 (checklist.js `groundedIn`, `receiptShape` and `checkedRequirement`'s `after` at
 *  0.3.0-beta.2): its verdict alone. */
function gateBefore(session, sourceMap, value, roles, instruction) {
  const plain = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!plain || !Object.keys(value).every((key) => ['eventId', 'role', 'quote'].includes(key))
      || typeof value.eventId !== 'string' || !value.eventId || !roles.includes(value.role)
      || typeof value.quote !== 'string') return false;
  if (value.quote.length > EVIDENCE_QUOTE_MAX || !(Object.hasOwn(sourceMap, value.eventId)
    && sourceMap[value.eventId].some((source) => source?.role === value.role))) return false;
  const event = session.event(value.eventId);
  const sequenceOf = (e) => (Number.isSafeInteger(e?.sequence) ? e.sequence : null);
  return verifyReceipt(session, value).ok && instruction !== null && sequenceOf(event) !== null
    && sequenceOf(instruction) !== null && sequenceOf(event) > sequenceOf(instruction)
    && oneSession(session, [instruction, event]);
}

test('D101: the closed lists, each in one constants place, and the gate reasons named from theirs', () => {
  assert.deepEqual(GROUNDING_CAUSES, ['receipt_malformed', 'role_not_allowed', 'quote_too_short', 'quote_over_limit',
    'event_missing', 'role_not_event_kind', 'session_mismatch', 'event_not_shown', 'synthetic_marker', 'not_found',
    'not_anchor_session', 'not_after']);
  assert.deepEqual(GROUNDING_LENGTH_CAUSES, ['quote_too_short', 'quote_over_limit']);
  assert.deepEqual(GROUNDING_ANCHOR_CAUSES, ['not_anchor_session', 'not_after']);
  assert.deepEqual(QUOTE_PLACES, ['cited', 'shown', 'nowhere']);
  for (const field of ['deliverable', 'shortfall', 'response'])
    assert.deepEqual(QUOTE_LIMITS[field], { min: 4, max: EVIDENCE_QUOTE_MAX }, field);
  assert.deepEqual(GROUNDING_GATE_REASONS, { requirement: ['deliverable_ungrounded', 'deliverable_not_after',
    'shortfall_ungrounded'], failure: ['response_ungrounded', 'response_not_after'] });
  for (const reason of GROUNDING_GATE_REASONS.requirement) assert.ok(REQUIREMENT_UNCHECKED_REASONS.includes(reason));
  for (const reason of GROUNDING_GATE_REASONS.failure) assert.ok(FAILURE_UNCHECKED_REASONS.includes(reason));
  for (const list of [GROUNDING_CAUSES, GROUNDING_LENGTH_CAUSES, GROUNDING_ANCHOR_CAUSES, QUOTE_PLACES, QUOTE_LIMITS])
    assert.ok(Object.isFrozen(list));
  assert.throws(() => groundingCheck(sessionOf(), quote('C1', 'commentary', 'abcd'), { field: 'no_such_field' }), RangeError);
});

test('D101: each refusal names the first test that failed; that test alone fails and every test before it holds', () => {
  const session = sessionOf();
  const options = optionsOf(session);
  for (const [cause, value] of CASES) {
    const check = groundingCheck(session, value, options);
    assert.equal(check.ok, false, cause);
    assert.equal(check.cause, cause, JSON.stringify(value));
    assert.ok(QUOTE_PLACES.includes(check.place), cause);
    assert.equal(groundingTestHolds(session, value, cause, options), false, `${cause} fails when run alone`);
    for (const earlier of GROUNDING_CAUSES.slice(0, GROUNDING_CAUSES.indexOf(cause)))
      assert.equal(groundingTestHolds(session, value, earlier, options), true, `${earlier} holds before ${cause}`);
  }
  // Every cause but the session's one is reached through the checklist's shape.
  assert.deepEqual([...new Set(CASES.map(([cause]) => cause))], GROUNDING_CAUSES.filter((c) => c !== 'session_mismatch'));
  // A wider shape reaches the session test: the same receipt, naming another recording's session.
  const other = { ...quote('C1', 'commentary', 'renamed the parser module'), sessionKey: 'another' };
  assert.equal(groundingTestHolds(session, other, 'session_mismatch', options), false);
  assert.equal(groundingTestHolds(session, { ...other, sessionKey: 'sess-d101' }, 'session_mismatch', options), true);
  assert.equal(groundingTestHolds(session, other, 'no_such_test', options), false);
  const held = groundingCheck(session, quote('C1', 'commentary', 'renamed the parser module'), options);
  assert.deepEqual(held, { ok: true, receipt: quote('C1', 'commentary', 'renamed the parser module') });
});

test('D101: the gate refuses exactly what it refused before — no status moves, only the cause is new', () => {
  const session = sessionOf();
  const options = optionsOf(session);
  const values = [...CASES.map(([, value]) => value), quote('C1', 'commentary', 'renamed the parser module'),
    ...Array.from({ length: LONG.length + 1 }, (_, n) => quote('C1', 'commentary', LONG.slice(0, n))),
    ...Array.from({ length: LONG.length + 1 }, (_, n) => quote('C0', 'commentary', EARLY.slice(0, n))),
    ...[['H1', HELPER], ['C3', UNORDERED], ['C4', MARKED], ['C5', EMOJI]].flatMap(([id, text]) =>
      Array.from({ length: text.length + 1 }, (_, n) => quote(id, 'commentary', text.slice(0, n))))];
  for (const value of values) {
    const now = groundingCheck(session, value, options).ok;
    assert.equal(now, gateBefore(session, SOURCE_MAP, value, DELIVERABLE_ROLES, session.event('I1')),
      JSON.stringify(value));
  }
});

test('D101: a quote within its field\'s bounds never carries a length cause; one outside always carries one, or an earlier '
  + 'cause', () => {
  const session = sessionOf();
  const options = optionsOf(session);
  const prefixes = (text) => Array.from({ length: text.length + 1 }, (_, n) => text.slice(0, n));
  for (const value of [...prefixes(LONG).flatMap((text) => [quote('C1', 'commentary', text),
    quote('C1', 'commentary', ` ${text}`), quote('C1', 'observation', text)]),
  ...prefixes(EMOJI).map((text) => quote('C5', 'commentary', text))]) {
    const check = groundingCheck(session, value, options);
    const within = value.quote.trim().length >= QUOTE_LIMITS.deliverable.min
      && value.quote.length <= QUOTE_LIMITS.deliverable.max;
    const length = !check.ok && GROUNDING_LENGTH_CAUSES.includes(check.cause);
    if (within) assert.equal(length, false, `${JSON.stringify(value.quote)}: ${check.cause}`);
    else assert.ok(!check.ok && GROUNDING_CAUSES.indexOf(check.cause) <= GROUNDING_CAUSES.indexOf('quote_over_limit'),
      `${JSON.stringify(value.quote)}: ${check.cause}`);
    if (length) {
      // The bound's own count, and the quote's characters as given (code points), apart.
      const counted = check.cause === 'quote_too_short' ? value.quote.trim().length : value.quote.length;
      assert.deepEqual(check.quoteLength, { chars: [...value.quote].length, counted, limit: check.cause === 'quote_too_short'
        ? QUOTE_LIMITS.deliverable.min : QUOTE_LIMITS.deliverable.max });
    } else assert.equal(Object.hasOwn(check, 'quoteLength'), false);
  }
});

test('D101: the quote\'s place, by the literal search alone; a quote the search did not find is never placed in the cited '
  + 'event', () => {
  const session = sessionOf();
  const placeOf = (value) => groundingCheck(session, value, optionsOf(session)).place;
  assert.equal(placeOf(quote('C1', 'commentary', LONG.slice(0, 130))), 'cited', 'over the limit, in the cited event');
  assert.equal(placeOf(quote('C1', 'commentary', 'I renamed the parser module before')), 'shown', 'in another shown event');
  assert.equal(placeOf(quote('C1', 'commentary', 'words that are nowhere at all')), 'nowhere');
  assert.equal(placeOf(quote('C2', 'commentary', 'the imports now point at')), 'nowhere', 'only in an event not shown');
  assert.equal(placeOf(quote('C0', 'commentary', 'I renamed the parser module before')), 'cited', 'before the ask');
  assert.equal(placeOf(undefined), 'nowhere');
  for (const [cause, value] of CASES) if (cause === 'not_found') assert.notEqual(placeOf(value), 'cited');
  // A gate with no window test places the quote by the session alone.
  assert.equal(quotePlace(session, quote('C2', 'commentary', 'the imports now point at'), null, { shown: false }), 'cited');
});

test('D101: a requirement row keeps its closed reason and gains the cause of the test that refused its evidence', () => {
  const session = sessionOf();
  const check = (row) => checkedRequirement(session, row, { sourceMap: SOURCE_MAP });
  const over = check(done(quote('C1', 'commentary', LONG.slice(0, 134))));
  assert.deepEqual([over.candidate.status, over.reason, over.cause, over.quoteLength, over.quotePlace],
    ['not-checked', 'deliverable_ungrounded', 'quote_over_limit', { chars: 134, counted: 134, limit: 120 }, 'cited']);
  assert.equal(Object.hasOwn(over.candidate, 'deliverable'), false, 'a not-checked row carries no quote');
  const before = check(done(quote('C0', 'commentary', 'I renamed the parser module before')));
  assert.deepEqual([before.reason, before.cause, before.quotePlace], ['deliverable_not_after', 'not_after', 'cited']);
  const missing = check(done());
  assert.deepEqual([missing.reason, missing.cause, missing.quotePlace],
    ['deliverable_ungrounded', 'receipt_malformed', 'nowhere']);
  const short = check(notDone(quote('C1', 'commentary', LONG.slice(0, 125))));
  assert.deepEqual([short.reason, short.cause, short.quoteLength], ['shortfall_ungrounded', 'quote_over_limit',
    { chars: 125, counted: 125, limit: 120 }]);
  const early = check(notDone(quote('C0', 'commentary', 'I renamed the parser module before')));
  assert.deepEqual([early.reason, early.cause], ['shortfall_ungrounded', 'not_after']);
  for (const [cause, value] of CASES) {
    const row = check(done(value));
    assert.equal(row.cause, cause);
    // The anchor's two tests were one test before D101 (`after`): both keep its reason.
    assert.equal(row.reason, GROUNDING_ANCHOR_CAUSES.includes(cause) ? 'deliverable_not_after' : 'deliverable_ungrounded');
  }
  const held = check(done(quote('C1', 'commentary', 'renamed the parser module')));
  assert.deepEqual([held.candidate.status, held.reason, Object.hasOwn(held, 'cause')], ['done', null, false]);
});

// ---- a failure row's response, and the whole review ---------------------------------------------------------------------

const ASK = 'SYNTHETIC_FAILURE_ASK: run the tests and fix what fails.';
const TOLD = `SYNTHETIC_TOLD: the test run failed ${'because the parser fixture is missing from the tree, '.repeat(3)}`;
const SIDECAR = { stdout: 'FAIL', stderr: '', interrupted: false, isImage: false, noOutputExpected: false };
const failureRows = () => [humanAsk(ASK), said('SYNTHETIC_BEFORE: I will run the tests now.'),
  call('t1', 'Bash', { command: 'npm test' }), result('t1', 'FAIL test/parser.test.js\n1 failed', SIDECAR, true),
  said(TOLD)];

test('D101: a failure row\'s response goes through the same gate, and a lowered row carries its cause', async (t) => {
  const { session } = await load(t, failureRows());
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  const { sourceMap } = plan.requests[0];
  const [window] = plan.windows;
  const failing = session.events.find((event) => event.kind === 'observation');
  const [beforeSaid, told] = session.events.filter((event) => event.kind === 'commentary');
  const rows = failuresCheck(session, window, [
    { eventId: failing.id, handling: 'told-human', response: quote(told.id, 'commentary', TOLD.slice(0, 140)) },
  ], { sourceMap }).rows;
  assert.deepEqual([rows[0].candidate.handling, rows[0].reason, rows[0].cause, rows[0].quoteLength, rows[0].quotePlace],
    ['not-checked', 'response_ungrounded', 'quote_over_limit', { chars: 140, counted: 140, limit: 120 }, 'cited']);
  const early = failuresCheck(session, window, [{ eventId: failing.id, handling: 'told-human',
    response: quote(beforeSaid.id, 'commentary', 'I will run the tests now.') }], { sourceMap }).rows;
  assert.deepEqual([early[0].reason, early[0].cause], ['response_not_after', 'not_after']);
  const held = failuresCheck(session, window, [{ eventId: failing.id, handling: 'told-human',
    response: quote(told.id, 'commentary', 'the test run failed because the parser fixture') }], { sourceMap }).rows;
  assert.deepEqual([held[0].candidate.handling, held[0].reason, Object.hasOwn(held[0], 'cause')], ['told-human', null, false]);
  assert.deepEqual(FAILURE_RESPONSE_ROLES['told-human'], ['commentary']);
});

test('D101: through the whole review, the report\'s rows carry the cause; the readers say it and never the quote\'s place',
  async (t) => {
    const { session } = await load(t, failureRows());
    const asked = session.events.find((event) => event.kind === 'instruction');
    const told = session.events.filter((event) => event.kind === 'commentary').at(-1);
    const failing = session.events.find((event) => event.kind === 'observation');
    const answer = () => ({ decisions: [], pivots: [], claims: [], requirements: [
      { text: 'run the tests', instruction: quote(asked.id, 'instruction', 'run the tests and fix what fails'),
        status: 'done', deliverable: quote(told.id, 'commentary', TOLD.slice(0, 133)) }],
    failures: [{ eventId: failing.id, handling: 'told-human', response: quote(told.id, 'commentary', TOLD.slice(0, 131)) }] });
    const judge = async (request) => (request.challenge ? { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [] })) } : answer(request));
    const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge });
    const [row] = report.requirements.filter((r) => r.codeMade !== true);
    assert.deepEqual([row.status, row.reason, row.cause, row.quoteLength, row.quotePlace],
      ['not-checked', 'deliverable_ungrounded', 'quote_over_limit', { chars: 133, counted: 133, limit: 120 }, 'cited']);
    const failure = report.failures.find((r) => r.eventId === failing.id);
    assert.deepEqual([failure.handling, failure.reason, failure.cause, failure.quoteLength, failure.quotePlace],
      ['not-checked', 'response_ungrounded', 'quote_over_limit', { chars: 131, counted: 131, limit: 120 }, 'cited']);
    // The readers: the ask's line names the failed test and code's numbers.
    const words = 'The session review quoted 133 characters, more than the 120 that Sonah checks, so Sonah did not check it.';
    const model = reportModel(session, report, {});
    const askLines = model.prompt.asks.flatMap((a) => a.lines.map((line) => line.map((part) => part.text).join('')));
    assert.ok(askLines.includes(words), JSON.stringify(askLines));
    const page = renderSessionPage(session, report, { sessionHash: 'a'.repeat(64) });
    const md = renderReportMarkdown(session, report, {});
    for (const text of [page, md]) {
      assert.ok(text.includes(words.slice(0, -1)));
      assert.equal(text.includes('did not find, word for word'), false, 'the search never ran on this quote');
    }
    // The quote's place is the report's only: whatever it says, the readers render the same bytes.
    for (const place of ['shown', 'nowhere', undefined]) {
      const moved = { ...report, requirements: report.requirements.map((r) => (r === row ? { ...r, quotePlace: place } : r)),
        failures: report.failures.map((r) => (r === failure ? { ...r, quotePlace: place } : r)) };
      assert.equal(renderSessionPage(session, moved, { sessionHash: 'a'.repeat(64) }), page, String(place));
      assert.equal(renderReportMarkdown(session, moved, {}), md, String(place));
    }
  });

test('D101: the words come from the cause alone; "did not find, word for word" only for the search that ran and failed',
  () => {
    assert.deepEqual(Object.keys(CHECKLIST_GROUNDING_CAUSE_WORDS), [...GROUNDING_CAUSES]);
    assert.deepEqual(CHECKLIST_QUOTE_ANCHOR_WORDS, { requirement: 'your ask', failure: 'the failure' });
    const filled = (cause, kind = 'requirement') => CHECKLIST_GROUNDING_CAUSE_WORDS[cause]({ chars: 147, counted: 147,
      limit: 120, anchor: CHECKLIST_QUOTE_ANCHOR_WORDS[kind] });
    for (const cause of GROUNDING_CAUSES) {
      assert.equal(typeof filled(cause), 'string');
      assert.equal(/word for word/.test(filled(cause)), cause === 'not_found', cause);
      // The words read the cause and code's numbers only: whatever the quote's place, they are the same.
      const base = { status: 'not-checked', reason: 'deliverable_ungrounded', cause,
        quoteLength: { chars: 147, counted: 147, limit: 120 } };
      for (const quotePlace of QUOTE_PLACES)
        assert.equal(checklistReasonWords({ ...base, quotePlace }, 'requirement'), checklistReasonWords(base, 'requirement'));
    }
    assert.equal(filled('quote_over_limit'),
      'the session review quoted 147 characters, more than the 120 that Sonah checks, so Sonah did not check it');
    assert.equal(filled('not_after', 'failure'), 'Sonah could not place the quote that the session review cited after the '
      + 'failure');
    // A row of each gate reason with a cause reads the cause's words; the length words carry code's numbers.
    const row = (reason, cause, extra = {}) => ({ status: 'not-checked', reason, cause, ...extra });
    for (const reason of GROUNDING_GATE_REASONS.requirement)
      assert.equal(checklistReasonWords(row(reason, 'not_found'), 'requirement'), filled('not_found'));
    for (const reason of GROUNDING_GATE_REASONS.failure)
      assert.equal(checklistReasonWords(row(reason, 'not_after'), 'failure'), filled('not_after', 'failure'));
    assert.equal(checklistReasonWords(row('deliverable_ungrounded', 'quote_too_short',
      { quoteLength: { chars: 2, counted: 2, limit: 4 } }), 'requirement'),
    'the session review quoted 2 characters, fewer than the 4 that Sonah needs, so Sonah did not check it');
    // A length cause with no valid numbers says nothing rather than the words of a search that never ran.
    for (const quoteLength of [undefined, { chars: -1, counted: -1, limit: 120 }, { chars: 147, counted: 147 },
      { chars: 1.5, counted: 2, limit: 120 }, { chars: 147, limit: 120 }, { chars: 147, counted: 147, limit: 0 }])
      assert.equal(checklistReasonWords(row('deliverable_ungrounded', 'quote_over_limit', { quoteLength }), 'requirement'),
        null);
    // A row an earlier report wrote, with no cause, keeps its reason's words; so does any reason the gate does not set.
    assert.equal(checklistReasonWords({ reason: 'deliverable_ungrounded' }, 'requirement'),
      CHECKLIST_REQUIREMENT_REASON_WORDS.deliverable_ungrounded);
    assert.equal(checklistReasonWords({ reason: 'response_ungrounded' }, 'failure'),
      CHECKLIST_FAILURE_REASON_WORDS.response_ungrounded);
    assert.equal(checklistReasonWords(row('challenge_refuted', 'not_found'), 'requirement'),
      CHECKLIST_REQUIREMENT_REASON_WORDS.challenge_refuted);
    assert.equal(checklistReasonWords(row('deliverable_ungrounded', 'no_such_cause'), 'requirement'),
      CHECKLIST_REQUIREMENT_REASON_WORDS.deliverable_ungrounded);
    assert.equal(checklistReasonWords({ reason: 'no_such_reason' }, 'requirement'), null);
    assert.equal(checklistReasonWords(row('deliverable_ungrounded', 'not_found'), 'no_such_kind'), null);
    assert.equal(checklistReasonWords(null, 'requirement'), null);
  });

// ---- the words say no more than the failed test proved ------------------------------------------------------------------

/** Why a checked row is not checked, in the words every reader shows (`checklistReasonWords`). */
const wordsOf = (checked) => checklistReasonWords({ status: checked.candidate.status, reason: checked.reason,
  ...(checked.cause ? { cause: checked.cause, quotePlace: checked.quotePlace } : {}),
  ...(checked.quoteLength ? { quoteLength: checked.quoteLength } : {}) }, 'requirement');

test('D101: a helper\'s quote recorded after the ask is refused for its session, never said to come before the ask',
  () => {
    const session = sessionOf();
    const options = optionsOf(session);
    const helper = quote('H1', 'commentary', 'the helper renamed the parser module');
    // The helper's remark is recorded after the ask, and the window showed both: only the session test fails.
    assert.ok(session.event('H1').sequence > session.event('I1').sequence);
    assert.equal(groundingTestHolds(session, helper, 'not_after', options), true, 'it is recorded after the ask');
    assert.equal(groundingTestHolds(session, helper, 'not_anchor_session', options), false);
    const sessionWords = "Sonah could not place the quote that the session review cited in the same agent's work as your ask";
    const asDeliverable = checkedRequirement(session, done(helper), { sourceMap: SOURCE_MAP });
    assert.deepEqual([asDeliverable.candidate.status, asDeliverable.reason, asDeliverable.cause],
      ['not-checked', 'deliverable_not_after', 'not_anchor_session']);
    const asShortfall = checkedRequirement(session, notDone(helper), { sourceMap: SOURCE_MAP });
    assert.deepEqual([asShortfall.candidate.status, asShortfall.reason, asShortfall.cause],
      ['not-checked', 'shortfall_ungrounded', 'not_anchor_session']);
    for (const checked of [asDeliverable, asShortfall]) assert.equal(wordsOf(checked), sessionWords);
    // A remark with no recorded order: code cannot place it after the ask, and the words claim nothing more.
    const unordered = checkedRequirement(session, done(quote('C3', 'commentary', 'the parser module has its new name')),
      { sourceMap: SOURCE_MAP });
    assert.deepEqual([unordered.reason, unordered.cause], ['deliverable_not_after', 'not_after']);
    assert.equal(wordsOf(unordered), 'Sonah could not place the quote that the session review cited after your ask');
    // A quote recorded before the ask reads the same words: the order test, and only it, failed.
    const early = checkedRequirement(session, done(quote('C0', 'commentary', 'I renamed the parser module before')),
      { sourceMap: SOURCE_MAP });
    assert.equal(wordsOf(early), wordsOf(unordered));
  });

/** The not_found words: only where the search ran — the place cited, in what the answer that gave the quote was shown. */
const NOT_FOUND_WORDS = 'Sonah did not find the quote, word for word, at the place that the session review cited, in '
  + 'what Sonah showed it for the answer that gave the quote';
/** The words not_found read before this fix: true only had Sonah searched every place, in all that it holds. */
const NOT_FOUND_WORDS_BEFORE = 'Sonah did not find, word for word, the quote that the session review cited';

test('D101: a quote the search did not find where it was cited is said not found there, never not found at all', () => {
  const session = sessionOf();
  // The reviewer's probe: the quote cites C1, and its words are C0's, which the window showed.
  const elsewhere = quote('C1', 'commentary', 'I renamed the parser module before');
  const check = groundingCheck(session, elsewhere, optionsOf(session));
  assert.deepEqual([check.cause, check.place], ['not_found', 'shown']);
  const checked = checkedRequirement(session, done(elsewhere), { sourceMap: SOURCE_MAP });
  assert.deepEqual([checked.reason, checked.cause, checked.quotePlace], ['deliverable_ungrounded', 'not_found', 'shown']);
  assert.equal(wordsOf(checked), NOT_FOUND_WORDS);
  // The same words wherever the quote is: they name only the search's own scope.
  const nowhere = checkedRequirement(session, done(quote('C1', 'commentary', 'words that are nowhere at all')),
    { sourceMap: SOURCE_MAP });
  assert.deepEqual([nowhere.cause, nowhere.quotePlace, wordsOf(nowhere)], ['not_found', 'nowhere', NOT_FOUND_WORDS]);
  assert.equal(checklistReasonWords({ status: 'not-checked', reason: 'response_ungrounded', cause: 'not_found' },
    'failure'), NOT_FOUND_WORDS);
});

// ---- a recording the window cuts: an edit, a command whose long output the window shows in part, a closing remark --------

const ASKS = 'SYNTHETIC_ASKS: rename the parser module, run the tests, and write the parser file.';
const CODE = 'export const parse = (s) => s.trim();\n';
const MIDDLE = 'SYNTHETIC_MIDDLE: the parser fixture moved to test/fixtures/parser.';
// Each side of the middle line holds more than twice the largest skim a side (D103: 12,000 bytes for Claude Code), in
// lines of over 40 bytes, so a window shows the output's start and end and cuts the middle line for every harness.
const SIDE_LINES = Math.ceil((2 * Math.max(...Object.values(SKIM_SIDE_BYTES))) / 40);
const OUTPUT = [...Array.from({ length: SIDE_LINES }, (_, i) => `SYNTHETIC_HEAD ${i} ${'x'.repeat(40)}`), MIDDLE,
  ...Array.from({ length: SIDE_LINES }, (_, i) => `SYNTHETIC_TAIL ${i} ${'y'.repeat(40)}`)].join('\n');
const PASSED = { stdout: 'ok', stderr: '', interrupted: false, isImage: false, noOutputExpected: false };
const cutRows = () => [humanAsk(ASKS),
  call('w1', 'Write', { file_path: '/repo/src/parser.js', content: CODE }, 'Writing the parser file.'),
  result('w1', 'File created successfully at: /repo/src/parser.js', { type: 'create', filePath: '/repo/src/parser.js',
    content: CODE, structuredPatch: [] }),
  call('b1', 'Bash', { command: 'node --test', description: 'Run the tests' }), result('b1', OUTPUT, PASSED, false),
  said('SYNTHETIC_CLOSING: all three are done.')];

/** One whole review of `cutRows` whose answer gives each ask the deliverable `deliverables(events)` names. */
async function cutReview(t, deliverables) {
  const { session } = await load(t, cutRows());
  const invocations = session.events.filter((e) => e.kind === 'invocation');
  const events = { asked: session.events.find((e) => e.kind === 'instruction'),
    write: invocations.find((e) => session.sourcesFor(e).some((s) => s.role === 'code' && s.text === CODE)),
    bash: invocations.find((e) => session.sourcesFor(e).some((s) => s.role === 'action' && s.text === 'node --test')),
    output: session.events.find((e) => e.kind === 'observation'
      && session.sourcesFor(e).some((s) => s.text.includes(MIDDLE))),
    closing: session.events.filter((e) => e.kind === 'commentary').at(-1) };
  for (const [name, event] of Object.entries(events)) assert.ok(event, name);
  const rows = Object.entries(deliverables(events)).map(([ask, deliverable]) => ({ text: ask,
    instruction: quote(events.asked.id, 'instruction', ask), status: 'done', deliverable }));
  const judge = async (request) => (request.challenge ? { votes: request.challenge.items.map((item) => ({ key: item.key,
    verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [] })) }
    : { decisions: [], pivots: [], claims: [], requirements: rows, failures: [] });
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge });
  const model = reportModel(session, report, {});
  return { session, events, report, rowOf: (ask) => report.requirements.find((r) => r.instruction?.quote === ask),
    lines: model.prompt.asks.flatMap((a) => a.lines.map((line) => line.map((part) => part.text).join(''))),
    page: renderSessionPage(session, report, { sessionHash: 'a'.repeat(64) }), md: renderReportMarkdown(session, report, {}) };
}
const asSentence = (words) => `${words[0].toUpperCase()}${words.slice(1)}.`;

test('D101: through the whole review, not found is said only of the place cited and of what that answer was shown',
  async (t) => {
    const review = await cutReview(t, ({ write, output, closing }) => ({
      // Words the window showed in the ask, cited from the closing remark.
      'rename the parser module': quote(closing.id, 'commentary', 'rename the parser module, run the tests'),
      // A line of the command's output that the recording holds, but in the part the window cut out.
      'run the tests': quote(output.id, 'observation', MIDDLE),
      // The file's code, cited as the edit's command: the window showed it, as the edit's code.
      'write the parser file': quote(write.id, 'action', CODE.trim()) }));
    const { session, events } = review;
    // The recording holds the cut line in the cited event and role; the window showed only the output's first and last
    // lines, and the gate searched those.
    assert.ok(session.sourcesFor(events.output).some((s) => s.role === 'observation' && s.text.includes(MIDDLE)));
    for (const [ask, place] of [['rename the parser module', 'shown'], ['run the tests', 'nowhere'],
      ['write the parser file', 'shown']]) {
      const row = review.rowOf(ask);
      assert.deepEqual([row?.status, row?.reason, row?.cause, row?.quotePlace],
        ['not-checked', 'deliverable_ungrounded', 'not_found', place], ask);
    }
    const said = asSentence(NOT_FOUND_WORDS);
    assert.equal(review.lines.filter((line) => line === said).length, 3, JSON.stringify(review.lines));
    for (const text of [review.page, review.md]) {
      assert.ok(text.includes(said.slice(0, -1)));
      assert.equal(text.includes(NOT_FOUND_WORDS_BEFORE), false, 'never not found at all');
    }
  });

/** The event_not_shown words: only the place cited (its event in its role), and only for the answer that gave it. */
const NOT_SHOWN_WORDS = 'Sonah did not show the session review the place that it cited, for the answer that gave the quote';

test('D101: a place the window was not shown is said not shown for that answer, never a part of the recording not shown',
  async (t) => {
    // A remark the window never showed: the place, and its whole event, are not in its source map.
    const session = sessionOf();
    const hidden = checkedRequirement(session, done(quote('C2', 'commentary', 'the imports now point at')),
      { sourceMap: SOURCE_MAP });
    assert.deepEqual([hidden.cause, hidden.quotePlace, wordsOf(hidden)], ['event_not_shown', 'nowhere', NOT_SHOWN_WORDS]);
    // Another window that showed the remark grounds the same quote: the test is of one window's source map.
    assert.equal(groundingCheck(session, quote('C2', 'commentary', 'the imports now point at'), { ...optionsOf(session),
      sourceMap: { ...SOURCE_MAP, C2: [{ role: 'commentary' }] } }).ok, true);
    // The command cited as code: the window showed that part of the recording, as the command, and not the place cited.
    const review = await cutReview(t, ({ bash }) => ({ 'run the tests': quote(bash.id, 'code', 'node --test') }));
    const row = review.rowOf('run the tests');
    assert.deepEqual([row?.status, row?.reason, row?.cause, row?.quotePlace],
      ['not-checked', 'deliverable_ungrounded', 'event_not_shown', 'shown']);
    assert.ok(review.lines.includes(asSentence(NOT_SHOWN_WORDS)), JSON.stringify(review.lines));
    for (const text of [review.page, review.md]) {
      assert.ok(text.includes(NOT_SHOWN_WORDS));
      assert.equal(text.includes('a part of the recording that Sonah did not show it'), false, 'it showed that part');
    }
  });

test('D101: what the receipt names is said as named, never as quoted; an absence only of the recording as Sonah read it',
  () => {
    const session = sessionOf();
    const lowered = (value, sourceMap = SOURCE_MAP, at = session) => checkedRequirement(at, done(value), { sourceMap });
    // The agent's own remark, named as your message: the quoted words are of a kind a deliverable may cite.
    const named = lowered(quote('C1', 'instruction', 'renamed the parser module'));
    assert.deepEqual([named.cause, named.quotePlace], ['role_not_allowed', 'shown']);
    assert.ok(DELIVERABLE_ROLES.includes('commentary'));
    assert.equal(wordsOf(named), 'the session review named a kind of text that Sonah does not accept here');
    // A remark that holds words like code, cited as code: Sonah reads a remark only as a remark (session.js eventRoles).
    const CODED = 'SYNTHETIC_CODED: the parser is now `export const parse = (s) => s.trim();` in one line.';
    const coded = new Session({ sessionKey: 'sess-d101-coded', adapter: 'claude', blobs: { ask: ASKED, coded: CODED },
      events: [{ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: span('ask', ASKED), sequence: 1 },
        remark('K1', 'coded', CODED, { sequence: 2 })], children: [] });
    const asCode = lowered(quote('K1', 'code', 'export const parse = (s) => s.trim();'),
      { I1: [{ role: 'instruction' }], K1: [{ role: 'commentary' }] }, coded);
    assert.deepEqual([asCode.cause, asCode.quotePlace], ['role_not_event_kind', 'shown']);
    assert.equal(wordsOf(asCode), 'the session review named a kind of text that Sonah does not read from the part of the '
      + 'recording that it cited');
    // An id the recording as Sonah read it holds no event of: that is all the test reads.
    const missing = lowered(quote('C9', 'commentary', 'renamed the parser module'));
    assert.equal(session.event('C9') ?? null, null);
    assert.deepEqual([missing.cause, wordsOf(missing)], ['event_missing',
      'the session review cited a part that is not in the recording as Sonah read it']);
    // A receipt that names another recording's session: the test reads the name, never a part of that recording.
    const other = { ...quote('C1', 'commentary', 'renamed the parser module'), sessionKey: 'another' };
    assert.equal(groundingTestHolds(session, other, 'session_mismatch', optionsOf(session)), false);
    assert.equal(checklistReasonWords({ status: 'not-checked', reason: 'deliverable_ungrounded', cause: 'session_mismatch' },
      'requirement'), 'the session review named a recording other than this one');
  });

/** Every cause's words, pinned beside what its test proves (ledger.js GROUNDING_CAUSES): a change to any is seen here. */
const CAUSE_WORDS = [
  // No receipt, or not one of the field's shape.
  ['receipt_malformed', {}, 'the session review gave no quote in the form that Sonah checks'],
  // The role the receipt names is not one the field may cite.
  ['role_not_allowed', {}, 'the session review named a kind of text that Sonah does not accept here'],
  // The trimmed quote's length, as the bound counts it, is under the least.
  ['quote_too_short', { chars: 2, counted: 2, limit: 4 },
    'the session review quoted 2 characters, fewer than the 4 that Sonah needs, so Sonah did not check it'],
  ['quote_too_short', { chars: 6, counted: 2, limit: 4 },
    'the session review quoted 6 characters, which Sonah counts as 2, fewer than the 4 it needs'],
  // The quote's length, as the bound counts it, is over the greatest.
  ['quote_over_limit', { chars: 147, counted: 147, limit: 120 },
    'the session review quoted 147 characters, more than the 120 that Sonah checks, so Sonah did not check it'],
  ['quote_over_limit', { chars: 61, counted: 122, limit: 120 },
    'the session review quoted 61 characters, which Sonah counts as 122, more than the 120 it checks'],
  // The session holds no event of the id.
  ['event_missing', {}, 'the session review cited a part that is not in the recording as Sonah read it'],
  // The event's kind holds no source of the role (eventRoles).
  ['role_not_event_kind', {},
    'the session review named a kind of text that Sonah does not read from the part of the recording that it cited'],
  // The receipt names a session key other than the recording's.
  ['session_mismatch', {}, 'the session review named a recording other than this one'],
  // The window's source map lists no source of the event in the role.
  ['event_not_shown', {}, NOT_SHOWN_WORDS],
  // The quote holds a mark like Sonah's (yes when in doubt).
  ['synthetic_marker', {}, 'the session review quoted a mark like the ones that Sonah writes, so Sonah did not check it'],
  // No source the window showed of the event, in the role, holds the quote.
  ['not_found', {}, NOT_FOUND_WORDS],
  // Code cannot place the event in the anchor's session.
  ['not_anchor_session', { anchor: 'your ask' },
    "Sonah could not place the quote that the session review cited in the same agent's work as your ask"],
  // Code cannot place the event after the anchor.
  ['not_after', { anchor: 'the failure' }, 'Sonah could not place the quote that the session review cited after the failure'],
];

test('D101: each cause\'s words, pinned beside what its test proves', () => {
  assert.deepEqual([...new Set(CAUSE_WORDS.map(([cause]) => cause))], [...GROUNDING_CAUSES]);
  for (const [cause, filled, words] of CAUSE_WORDS)
    assert.equal(CHECKLIST_GROUNDING_CAUSE_WORDS[cause](filled), words, cause);
});

test('D101: a mark like Sonah\'s that the recording itself holds is named only as a mark', () => {
  const session = sessionOf();
  const marked = quote('C4', 'commentary', 'keep the [Continue reading…] link');
  const check = groundingCheck(session, marked, optionsOf(session));
  // The recording holds the quote word for word in the cited event: the test refused it for its form alone.
  assert.deepEqual([check.cause, check.place], ['synthetic_marker', 'cited']);
  assert.equal(wordsOf(checkedRequirement(session, done(marked), { sourceMap: SOURCE_MAP })),
    'the session review quoted a mark like the ones that Sonah writes, so Sonah did not check it');
});

test('D101: a length is the quote\'s characters as given, with the bound\'s own count beside it where the two differ', () => {
  const session = sessionOf();
  const lowered = (value) => checkedRequirement(session, done(value), { sourceMap: SOURCE_MAP });
  // 61 emoji: 61 characters, which the bound counts as 122 (each emoji two of JavaScript's string length).
  const emoji = lowered(quote('C5', 'commentary', '😀'.repeat(61)));
  assert.deepEqual([emoji.cause, emoji.quoteLength, emoji.quotePlace],
    ['quote_over_limit', { chars: 61, counted: 122, limit: 120 }, 'cited']);
  assert.equal(wordsOf(emoji), 'the session review quoted 61 characters, which Sonah counts as 122, more than the 120 '
    + 'it checks');
  // A short quote padded with blank space: 6 characters, which the bound counts as 2 (the blank space at its ends out).
  const padded = lowered(quote('C1', 'commentary', '  re  '));
  assert.deepEqual([padded.cause, padded.quoteLength], ['quote_too_short', { chars: 6, counted: 2, limit: 4 }]);
  assert.equal(wordsOf(padded), 'the session review quoted 6 characters, which Sonah counts as 2, fewer than the 4 it '
    + 'needs');
  // One character is one character.
  const one = lowered(quote('C1', 'commentary', 'r'));
  assert.deepEqual(one.quoteLength, { chars: 1, counted: 1, limit: 4 });
  assert.equal(wordsOf(one), 'the session review quoted 1 character, fewer than the 4 that Sonah needs, so Sonah did not '
    + 'check it');
});

test('D101: a failure row\'s response that does not hold again for its published shape carries the gate\'s cause', () => {
  const session = sessionOf();
  const told = (response) => ({ eventId: 'C2', handling: 'told-human', response });
  // The response the gate held: published with the session's provenance stamp, and no reason.
  assert.deepEqual(publishedResponse(session, told(quote('C1', 'commentary', 'renamed the parser module')),
    { sourceMap: SOURCE_MAP }), { response: { ...quote('C1', 'commentary', 'renamed the parser module'),
    sessionKey: 'sess-d101' } });
  // One that does not hold: lowered with the reason it always had, and the cause the same gate names.
  assert.deepEqual(publishedResponse(session, told(quote('C1', 'commentary', 'words that are nowhere at all')),
    { sourceMap: SOURCE_MAP }), { reason: 'response_ungrounded', cause: 'not_found', quotePlace: 'nowhere' });
  assert.deepEqual(publishedResponse(session, told(quote('C9', 'commentary', 'renamed the parser module')),
    { sourceMap: SOURCE_MAP }), { reason: 'response_ungrounded', cause: 'event_missing', quotePlace: 'shown' });
});
