// D183 (0.3.0-beta.11; the owner, 2026-10-30, "Ready items first"): a review whose session review's calls did not
// answer. (a) When every window failed, nothing is said as found over the session review's scope: the count line, an
// empty prompt and the empty lists of What the agent did say what Sonah cannot tell, the header says why, and a message
// with no ask that only failed windows hold is said apart. (b) The footer says how many of this run's calls it asked
// again. (c) Over several runs, one run with no token report or no limit reading no longer takes the others' sums away.
// Structure only: the windows' closed failure codes, which windows hold which event, the run records' counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel } from '../report-model.js';
import { renderSessionPage, sessionPage, PAGE_LIMITS } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { countLines } from '../../cli/src/report-output.js';
import { REPORT_COUNT_WORDS, REPORT_DID_WORDS, REPORT_HEADER_WORDS, REPORT_SECTION_WORDS, REPORT_FOOTER_WORDS,
  REPORT_NOT_CHECKED_WORDS, REPORT_TRIM_WORDS, API_KEY_VARIABLE } from '../report-words.js';
import { sessionCallsFact, windowFailureClass, WINDOW_FAILURE_CLASS, WINDOW_FAILURE_CODES, WINDOW_FAILURE_CLASSES }
  from '../../evidence/src/run-review.js';
import { sessionBuilder } from './session-story-fixture.js';

/** Three messages of yours, each with the agent's reply: no ask is found in any of them by structure. */
function threeMessages() {
  const b = sessionBuilder();
  b.ask('I1', 'Tidy the notes.');
  b.say('F1', 'Done with the notes.', 'final');
  b.ask('I2', 'Now the readme.');
  b.say('F2', 'Done with the readme.', 'final');
  b.ask('I3', 'And the changelog.');
  b.say('F3', 'Done with the changelog.', 'final');
  return b.session();
}
const W = (eventIds, failure = null, extra = {}) => ({ windowIndex: 0, eventIds, failure,
  groundingComplete: failure === null, challenge: failure === null ? { complete: true } : null, ...extra });
const review = (windowResults, extra = {}) => ({ reviewScope: 'session-only', coverage: 'partial', sessionReview: 'incomplete',
  windowResults: windowResults.map((w, windowIndex) => ({ ...w, windowIndex })), requirements: [], promises: [],
  decisions: [], ...extra });
const ALL = ['I1', 'F1', 'I2', 'F2', 'I3', 'F3'];
const both = (session, report, options = {}) => ({ page: renderSessionPage(session, report, options),
  md: renderReportMarkdown(session, report, options) });
const FOUND = [REPORT_COUNT_WORDS.emptyTiers, REPORT_COUNT_WORDS.noAsk, REPORT_DID_WORDS.noClaims,
  REPORT_DID_WORDS.noLeftOut, REPORT_DID_WORDS.noSettled];
const esc = (text) => text.replace(/'/g, '&#39;');
/** Whether a page (its text escaped) or a .md (as written) says `words`. D190 (its close check): the variable that holds
 *  the API key is `<code>` on the page and a code span in the .md, never with its underscores escaped. */
const has = (text, words) => [words, esc(words)].some((w) => text.includes(w)
  || text.includes(w.replaceAll(API_KEY_VARIABLE, `<code>${API_KEY_VARIABLE}</code>`))
  || text.includes(w.replaceAll(API_KEY_VARIABLE, `\`${API_KEY_VARIABLE}\``)));

test('D183: the window failure classes are closed, by the failure code, and a window failed only by membership', () => {
  // Its fix round: one class for every closed failure code, by the code itself (not by its narrative shortfall).
  assert.deepEqual(Object.keys(WINDOW_FAILURE_CLASS).sort(), [...WINDOW_FAILURE_CODES].sort());
  for (const cls of Object.values(WINDOW_FAILURE_CLASS)) assert.ok(WINDOW_FAILURE_CLASSES.includes(cls));
  const of = (cls) => Object.entries(WINDOW_FAILURE_CLASS).filter(([, c]) => c === cls).map(([code]) => code).sort();
  // Never tried: no model call is counted for it.
  assert.deepEqual(of('not_sent'), ['budget_exhausted', 'unreviewed_scope']);
  // Refused on this computer after the budget counted its try: never sent, and the footer counts it.
  assert.deepEqual(of('refused'), ['anthropic_key_missing', 'explicit_api_model_required', 'invalid_model',
    'invalid_model_input', 'unsupported_backend']);
  for (const code of WINDOW_FAILURE_CODES) assert.ok(WINDOW_FAILURE_CLASSES.includes(windowFailureClass({ failure: code })));
  assert.equal(windowFailureClass({ failure: 'budget_exhausted' }), 'not_sent');
  assert.equal(windowFailureClass({ failure: 'unreviewed_scope' }), 'not_sent');
  assert.equal(windowFailureClass({ failure: 'invalid_model_input' }), 'refused');
  assert.equal(windowFailureClass({ failure: 'anthropic_key_missing' }), 'refused');
  assert.equal(windowFailureClass({ failure: 'model_unavailable' }), 'no_answer');
  // An older record with no field, or a value outside the closed list, is no failed window.
  for (const w of [{}, { failure: undefined }, { failure: null }, { failure: 'not_a_code' }, null, 'x'])
    assert.equal(windowFailureClass(w), null, JSON.stringify(w));
  assert.deepEqual(sessionCallsFact([]), { windows: 0, failed: 0, failedAt: [], all: false, cls: null, cause: null });
});

test('D183: every window failed with no answer — the cause, and what Sonah cannot tell, on every reader', () => {
  const session = threeMessages();
  const report = review([W(ALL.slice(0, 2), 'model_unavailable'), W(ALL.slice(2), 'model_timeout')]);
  const model = reportModel(session, report, {});
  assert.deepEqual(model.header.reviewIncomplete, [REPORT_HEADER_WORDS.reviewIncomplete, REPORT_HEADER_WORDS.calls.no_answer]);
  assert.equal(model.countLine.prompt, REPORT_COUNT_WORDS.promptCannotTell);
  assert.equal(model.countLine.empty, REPORT_COUNT_WORDS.cannotTellTiers);
  // Judgment call 4: "This does not mean that the work is correct." stays beside it, in the fold.
  assert.ok(model.notChecked.quiet.includes(REPORT_COUNT_WORDS.notCorrect));
  assert.deepEqual(model.did.empty, { claims: REPORT_DID_WORDS.cannotTell, leftOut: REPORT_DID_WORDS.cannotTell,
    settled: REPORT_DID_WORDS.cannotTell });
  // Every message with no ask lies in a failed window only: listed apart, none said as one Sonah found no ask in.
  assert.deepEqual(model.prompt.emptyMessages, []);
  assert.deepEqual(model.prompt.unreachedMessages.map((m) => m.k), [1, 2, 3]);
  // Judgment call 3: the counts stay what Sonah holds.
  assert.deepEqual(model.countLine.tiers.map((t) => t.n), [0, 0, 0]);
  const { page, md } = both(session, report);
  for (const text of [page, md]) {
    for (const said of FOUND) assert.ok(!has(text, said), said);
    assert.ok(!has(text, REPORT_SECTION_WORDS.noAskMessages(3)));
    for (const said of [REPORT_SECTION_WORDS.unreachedMessages(3), REPORT_COUNT_WORDS.cannotTellTiers,
      REPORT_COUNT_WORDS.promptCannotTell, REPORT_HEADER_WORDS.calls.no_answer]) assert.ok(has(text, said), said);
    assert.equal(text.split(REPORT_DID_WORDS.cannotTell).length - 1, 3, 'one under each empty list');
  }
  assert.deepEqual(countLines(model), ['Must act 0 · Must know 0 · Good to know 0 · '
    + REPORT_COUNT_WORDS.promptCannotTell, REPORT_COUNT_WORDS.cannotTellTiers]);
});

test('D183 (fix round): whatever the code review did, the count line says no sentence of what it found', () => {
  const session = threeMessages();
  const answered = { ran: true, coverage: 'complete', manifest: { review: { sent: true } }, agent: { terminal: 'answered' },
    files: [], findings: [], questions: [], withheld: [], footer: [] };
  const report = review([W(ALL, 'model_unavailable')], { codeCoverage: 'complete', codePass: answered });
  // The review's terminal states (answered, unusable, failed after turns), a finding withheld for a check that did not
  // run, a request never sent, a code step that did not run: the session review's cannot-tell line alone, on every
  // reader. A code review that gave no usable answer is no review that found nothing.
  const turned = { 'code-review:review:U1:R1': { turns: 3, toolCalls: 2, reads: 1 } };
  const shapes = [answered, { ...answered, agent: { terminal: 'unusable' }, coverage: 'missing' },
    { ...answered, agent: { terminal: 'failed' }, coverage: 'missing', agentRuns: turned },
    { ...answered, withheld: [{ index: 0, reason: 'request_failed' }] },
    { ...answered, manifest: { review: { sent: false } } }, { ...answered, ran: false }];
  for (const codePass of shapes) {
    const shaped = { ...report, codePass };
    assert.equal(reportModel(session, shaped, {}).countLine.empty, REPORT_COUNT_WORDS.cannotTellTiers, JSON.stringify(codePass));
    const { page, md } = both(session, shaped);
    for (const text of [page, md]) assert.ok(!text.includes('The code review found nothing'), JSON.stringify(codePass));
  }
});

test('D183: every window failed unsent says so; mixed classes say no cause; the cannot-tell lines stay in both', () => {
  const session = threeMessages();
  const unsent = reportModel(session, review([W(ALL.slice(0, 2), 'budget_exhausted'), W(ALL.slice(2), 'unreviewed_scope')]), {});
  assert.deepEqual(unsent.header.reviewIncomplete, [REPORT_HEADER_WORDS.reviewIncomplete, REPORT_HEADER_WORDS.calls.not_sent]);
  const mixed = reportModel(session, review([W(ALL.slice(0, 2), 'budget_exhausted'), W(ALL.slice(2), 'model_unavailable')]), {});
  assert.deepEqual(mixed.header.reviewIncomplete, [REPORT_HEADER_WORDS.reviewIncomplete]);
  for (const model of [unsent, mixed]) {
    assert.equal(model.countLine.empty, REPORT_COUNT_WORDS.cannotTellTiers);
    assert.equal(model.countLine.prompt, REPORT_COUNT_WORDS.promptCannotTell);
    assert.equal(model.did.empty.claims, REPORT_DID_WORDS.cannotTell);
  }
  // Some windows failed unsent: no cause sentence (no measured case), and what was found is said as found.
  const someUnsent = reportModel(session, review([W(ALL.slice(0, 2), 'budget_exhausted'), W(ALL.slice(2))]), {});
  assert.deepEqual(someUnsent.header.reviewIncomplete, [REPORT_HEADER_WORDS.reviewIncomplete]);
  assert.equal(someUnsent.countLine.empty, REPORT_COUNT_WORDS.emptyTiers);
});

test('D183 (fix round): calls refused on this computer (bytes the transport cannot carry) say no cause; D190: a missing key', () => {
  const session = threeMessages();
  // The budget counted each try before the judge refused it, so the footer counts 2 model calls that were never sent:
  // neither "did not answer" nor "did not send" is said beside it. What Sonah cannot tell is said as for any failed call.
  // D190: a missing API key is said as calls that failed, and why (every window, or some), never as unanswered or unsent.
  const instrument = { usage: { version: 'sonah.review-usage/1', calls: 2, inputBytes: 600, inputTokens: null,
    inputReportedCalls: 0, inputSplit: null, outputTokens: null, outputReportedCalls: 0, costUsd: null,
    costReportedCalls: 0, reportedCalls: 0, agentCalls: 0, turns: 0, wallMs: 1_000, windows: null, code: null },
  answers: { calls: 2, reused: 0 } };
  for (const [codes, cause] of [[['anthropic_key_missing', 'anthropic_key_missing'], 'key_missing'],
    [['invalid_model_input', 'invalid_model_input'], null], [['anthropic_key_missing', 'model_unavailable'], 'some_key_missing'],
    [['budget_exhausted', 'invalid_model_input'], null]]) {
    const report = review([W(ALL.slice(0, 2), codes[0]), W(ALL.slice(2), codes[1])], { instrument });
    const model = reportModel(session, report, {});
    assert.deepEqual(model.header.reviewIncomplete, [REPORT_HEADER_WORDS.reviewIncomplete,
      ...(cause ? [REPORT_HEADER_WORDS.calls[cause]] : [])], codes.join());
    assert.equal(model.countLine.empty, REPORT_COUNT_WORDS.cannotTellTiers);
    assert.equal(model.countLine.prompt, REPORT_COUNT_WORDS.promptCannotTell);
    assert.match(model.footer.usage, /^In this run, Sonah made 2 model calls\./);
    const { page, md } = both(session, report);
    for (const text of [page, md]) for (const [key, said] of Object.entries(REPORT_HEADER_WORDS.calls))
      assert.equal(has(text, said), key === cause, `${codes.join()}: ${said}`);
  }
});

test('D183: some windows failed — the cause, and the messages with no ask split by the windows that hold their own event', () => {
  const session = threeMessages();
  // The failed window holds message 1 and the agent's reply to message 2; the answering one holds message 2's own
  // event and message 3. Message 2's own event is in an answering window, so it is one Sonah found no ask in.
  const report = review([W(['I1', 'F1', 'F2'], 'model_unavailable'), W(['I2', 'I3', 'F3'])]);
  const model = reportModel(session, report, {});
  assert.deepEqual(model.header.reviewIncomplete, [REPORT_HEADER_WORDS.reviewIncomplete,
    REPORT_HEADER_WORDS.calls.some_no_answer]);
  assert.deepEqual(model.prompt.unreachedMessages.map((m) => m.k), [1]);
  assert.deepEqual(model.prompt.emptyMessages.map((m) => m.k), [2, 3]);
  // Judgment call 2: a partial review keeps what it found as found.
  assert.equal(model.countLine.prompt, REPORT_COUNT_WORDS.noAsk);
  assert.equal(model.countLine.empty, REPORT_COUNT_WORDS.emptyTiers);
  assert.equal(model.did.empty.claims, REPORT_DID_WORDS.noClaims);
  const { page, md } = both(session, report);
  for (const text of [page, md]) {
    assert.ok(has(text, REPORT_SECTION_WORDS.noAskMessages(2)));
    assert.ok(has(text, REPORT_SECTION_WORDS.unreachedMessages(1)));
    assert.ok(text.indexOf(REPORT_SECTION_WORDS.noAskMessages(2)) < text.indexOf(REPORT_SECTION_WORDS.unreachedMessages(1)));
  }
  // A message that no window holds, in a review where a window answered, is as in a review with no failed window: the
  // review did not read it, and no failed call left it unread.
  const unheld = reportModel(session, review([W(['F1', 'F2'], 'model_unavailable'), W(['I2', 'I3', 'F3'])]), {});
  assert.equal(Object.hasOwn(unheld.prompt, 'unreachedMessages'), false);
  assert.deepEqual(unheld.prompt.emptyMessages.map((m) => m.k), [1, 2, 3]);
  // Every window failed: every message, held or not (failed windows' records may name events of other sessions).
  const allFailed = reportModel(session, review([W(['I1', 'F1'], 'model_unavailable'), W(['X9'], 'model_unavailable')]), {});
  assert.deepEqual(allFailed.prompt.unreachedMessages.map((m) => m.k), [1, 2, 3]);
  // With no failed window, a message no window holds keeps "found no ask", as before.
  const none = reportModel(session, review([W(['I2', 'I3', 'F3'])]), {});
  assert.equal(Object.hasOwn(none.prompt, 'unreachedMessages'), false);
  assert.deepEqual(none.prompt.emptyMessages.map((m) => m.k), [1, 2, 3]);
});

test('D183: a window that answered but is incomplete, an older record and a review with no failed window are as before', () => {
  const session = threeMessages();
  const shapes = [
    review([W(ALL, null, { groundingComplete: false, challenge: { complete: false } })]),
    // An older record with no `failure` field at all.
    review([(({ failure, ...w }) => w)(W(ALL))]),
    review([W(ALL)], { sessionReview: 'complete', coverage: 'complete' })];
  for (const report of shapes) {
    const model = reportModel(session, report, {});
    assert.ok(model.header.reviewIncomplete.every((s) => s === REPORT_HEADER_WORDS.reviewIncomplete));
    assert.equal(model.countLine.prompt, REPORT_COUNT_WORDS.noAsk);
    assert.equal(model.countLine.empty, REPORT_COUNT_WORDS.emptyTiers);
    assert.deepEqual(model.did.empty, { claims: REPORT_DID_WORDS.noClaims, leftOut: REPORT_DID_WORDS.noLeftOut,
      settled: REPORT_DID_WORDS.noSettled });
    assert.equal(Object.hasOwn(model.prompt, 'unreachedMessages'), false);
    assert.deepEqual(model.prompt.emptyMessages.map((m) => m.k), [1, 2, 3]);
    const { page, md } = both(session, report);
    for (const text of [page, md]) for (const said of [REPORT_COUNT_WORDS.noAsk, REPORT_DID_WORDS.noClaims,
      REPORT_DID_WORDS.noLeftOut, REPORT_SECTION_WORDS.noAskMessages(3)]) assert.ok(has(text, said), said);
  }
});

// ---- (b) and (c): the footer ------------------------------------------------------------------------------------------

/** A usage record as cli review-budget.js `usageRecord` writes it (the fields the footer reads). */
const usage = ({ calls, code = null, tokens = true, five = [0.1, 0.2], wallMs = 60_000 }) => ({ version: 'sonah.review-usage/1',
  calls, inputBytes: calls * 300, inputTokens: tokens ? calls * 100 : null, inputReportedCalls: tokens ? calls : 0,
  inputSplit: null, outputTokens: tokens ? calls * 10 : null, outputReportedCalls: tokens ? calls : 0, costUsd: null,
  costReportedCalls: 0, reportedCalls: calls, agentCalls: 0, turns: 0, wallMs,
  windows: five === null ? null : { five_hour: { first: five[0], last: five[1] } }, code: code === null ? null : { calls: code } });
const footer = (report, earlierRuns) => reportModel(threeMessages(), { ...review([W(ALL)]), ...report },
  earlierRuns ? { earlierRuns } : {}).footer.usage;

test('D183 (c): over several runs, the tokens and each limit are summed over the runs that reported them', () => {
  // The first run's calls all failed: no token report and no limit reading; the next two reported both.
  const failedRun = usage({ calls: 2, tokens: false, five: null });
  const runs = [failedRun, usage({ calls: 3, five: [0.1, 0.25] })];
  assert.equal(footer({ instrument: { usage: usage({ calls: 4, five: [0.3, 0.32] }) } }, runs), 'Over its 3 runs, this '
    + 'review made 9 model calls. The calls took 3 minutes. The calls of 2 of these 3 runs used 700 input tokens and 70 '
    + 'output tokens. Your five-hour usage rose by 17% of its limit over the 2 runs that read it.');
  // Every run reported: the words of D132, byte for byte.
  assert.equal(footer({ instrument: { usage: usage({ calls: 4 }) } }, [usage({ calls: 3 })]), 'Over its 2 runs, this review '
    + 'made 7 model calls. The calls used 700 input tokens and 70 output tokens in 2 minutes. Your five-hour usage rose by '
    + '20% of its limit over these runs.');
  // One run of three read a limit: in the one run that read it. No run reported tokens: the time alone.
  assert.match(footer({ instrument: { usage: usage({ calls: 1, tokens: false, five: [0, 0.05] }) } },
    [usage({ calls: 2, tokens: false, five: null }), usage({ calls: 2, tokens: false, five: null })]),
  /made 5 model calls\. The calls took 3 minutes\. Your five-hour usage rose by 5% of its limit in the one run that read it\.$/);
  // A reset in any run that read the limit leaves it out.
  assert.doesNotMatch(footer({ instrument: { usage: usage({ calls: 1, five: [0.9, 0.1] }) } }, [failedRun]), /five-hour/);
  // The single run's sentence is D129's.
  assert.equal(footer({ instrument: { usage: usage({ calls: 2 }) } }), 'In this run, Sonah made 2 model calls. The calls used '
    + '200 input tokens and 20 output tokens in 1 minute. Your five-hour usage went from 10% to 20% of its limit.');
  // Its fix round: a run counts as reporting tokens only when it reported both counts for every call. One that reported
  // the input tokens of every call but the output tokens of some (or the other way round) adds neither.
  const inputOnly = { ...usage({ calls: 3 }), outputTokens: 20, outputReportedCalls: 2 };
  const outputOnly = { ...usage({ calls: 3 }), inputTokens: 200, inputReportedCalls: 2 };
  for (const half of [inputOnly, outputOnly]) assert.equal(footer({ instrument: { usage: usage({ calls: 4 }) } }, [half]),
    'Over its 2 runs, this review made 7 model calls. The calls took 2 minutes. The calls of 1 of these 2 runs used 400 '
    + 'input tokens and 40 output tokens. Your five-hour usage rose by 20% of its limit over these runs.');
});

test('D183 (b): the footer says how many of this run\'s calls it asked again, from its tries and its requests', () => {
  const answers = (calls) => ({ calls, reused: 0 });
  // 5 tries of which the code step made 2; 2 session requests and 1 code request: 2 asked again.
  const retried = { instrument: { usage: usage({ calls: 5, code: 2, tokens: false }), answers: answers(2) },
    codePass: { ran: false, answers: answers(1) } };
  assert.equal(footer(retried), 'In this run, Sonah made 5 model calls, and the code review made 2 of them. Sonah asked 2 '
    + 'of these calls again after they failed. The calls took 1 minute. Your five-hour usage went from 10% to 20% of its limit.');
  // Over several runs, said as this run's.
  assert.match(footer(retried, [usage({ calls: 3 })]), /^Over its 2 runs, this review made 8 model calls, and the code review made 2 of them\. In this run, Sonah asked 2 of these calls again after they failed\./);
  // Reused answers are no requests sent: they move nothing.
  assert.match(footer({ ...retried, instrument: { ...retried.instrument, answers: { calls: 2, reused: 7 } } }),
    /Sonah asked 2 of these calls again/);
  const none = (report) => assert.doesNotMatch(footer(report), /asked .* again/, JSON.stringify(report));
  // Nothing asked again; no answers record; a code step's tries with no code answers record; fewer tries than requests.
  none({ instrument: { usage: usage({ calls: 3 }), answers: answers(3) } });
  none({ instrument: { usage: usage({ calls: 3 }) } });
  none({ instrument: { usage: usage({ calls: 5, code: 2 }), answers: answers(2) } });
  none({ instrument: { usage: usage({ calls: 2 }), answers: answers(3) } });
  none({ instrument: { usage: usage({ calls: 5, code: 1 }), answers: answers(2) }, codePass: { answers: answers(2) } });
  // The merge's close check: a window too large to send, or an oversize batch of a challenge run, made no request and no
  // try (each caller checks the request bound before the answer store), so the count stands beside them.
  for (const windowResults of [[W(ALL, 'unreviewed_scope', { challenge: { complete: false, budgetExhausted: true } })],
    [W(ALL, null, { reanchorChallenge: { attemptedCalls: 1, budgetExhausted: true } })]])
    assert.match(footer({ ...retried, windowResults }), /Sonah asked 2 of these calls again/);
  // The words alone: one call.
  assert.match(REPORT_FOOTER_WORDS.usage({ calls: 2, wallMs: 1_000, retried: 1 }), /Sonah asked 1 of these calls again after it failed\./);
});

test('D183 (fix round): the page cuts the fold of messages only failed calls held by its size trim, and says so', () => {
  const b = sessionBuilder();
  // Each message keeps its start (300 characters) under the trim's first step; 2,400 of them still pass the bound.
  for (let k = 0; k < 2_400; k++) b.ask(`I${k}`, `Message number ${k}. ${'Some long context words here. '.repeat(11)}`);
  const session = b.session();
  const report = review([W(session.events.map((e) => e.id), 'model_unavailable')]);
  const { html, whole } = sessionPage(session, report, {});
  assert.equal(whole, false, 'premise: the page is cut to its bound');
  assert.ok(Buffer.byteLength(html, 'utf8') <= PAGE_LIMITS.maxBytes);
  const model = reportModel(session, report, {});
  assert.equal(model.prompt.unreachedMessages.length, 2_400);
  assert.deepEqual(model.prompt.emptyMessages, []);
  const fold = html.slice(html.indexOf(REPORT_SECTION_WORDS.unreachedMessages(2_400)));
  const shown = (fold.slice(0, fold.indexOf('</details>')).match(/<p class="message">/g) ?? []).length;
  assert.ok(shown > 0 && shown < 2_400, `premise: the fold keeps fewer (${shown})`);
  assert.ok(fold.includes(REPORT_NOT_CHECKED_WORDS.rowsNotShown(2_400 - shown)));
  assert.ok(html.includes(REPORT_TRIM_WORDS.listsTrimmed));
});
