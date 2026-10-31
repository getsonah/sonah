// D190 (0.3.0-beta.11; the owner, 2026-10-30: "Name the missing key"): a review whose session review's calls failed
// because no API key was set says so after "did not finish", in the report's header and the terminal's run-state line,
// by the closed failure code `anthropic_key_missing` (never by text): every window failed so, or some did. The words say
// the calls failed and why, never that they did not answer or were not sent, so they hold beside a footer that counts
// each try; they name the variable Sonah reads, since sonah doctor does not check the key. Synthetic records only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_HEADER_WORDS, API_KEY_VARIABLE } from '../report-words.js';
import { sessionCallsFact, SESSION_CALLS_CAUSES } from '../../evidence/src/run-review.js';
import { runStateLine, RUN_STATE_WORDS } from '../../cli/src/session-review-command.js';
import { parseDoctorArgs } from '../../cli/src/doctor.js';
import { sessionBuilder } from './session-story-fixture.js';

const KEY = 'anthropic_key_missing';
function twoMessages() {
  const b = sessionBuilder();
  b.ask('I1', 'Tidy the notes.');
  b.say('F1', 'Done with the notes.', 'final');
  b.ask('I2', 'Now the readme.');
  b.say('F2', 'Done with the readme.', 'final');
  return b.session();
}
const W = (eventIds, failure = null) => ({ eventIds, failure, groundingComplete: failure === null,
  challenge: failure === null ? { complete: true } : null });
// The budget counts each try before the judge refuses it (cli review-budget.js `wrap`): 2 tries, 2 requests.
const instrument = { usage: { version: 'sonah.review-usage/1', calls: 2, inputBytes: 600, inputTokens: null,
  inputReportedCalls: 0, inputSplit: null, outputTokens: null, outputReportedCalls: 0, costUsd: null, costReportedCalls: 0,
  reportedCalls: 2, agentCalls: 0, turns: 0, wallMs: 1_000, windows: null, code: null }, answers: { calls: 2, reused: 0 } };
const review = (windows) => ({ reviewScope: 'session-only', coverage: 'partial', sessionReview: 'incomplete',
  windowResults: windows.map((w, windowIndex) => ({ ...w, windowIndex })), requirements: [], promises: [], decisions: [],
  instrument });
const sessionPart = (line) => /session review (.+?)\)/.exec(line)?.[1];
/** Whether a page (its text escaped, the variable `<code>`) or a .md (the variable a code span) says `words`. */
const has = (text, words) => text.includes(words.replace(/'/g, '&#39;')
  .replaceAll(API_KEY_VARIABLE, `<code>${API_KEY_VARIABLE}</code>`))
  || text.includes(words.replaceAll(API_KEY_VARIABLE, `\`${API_KEY_VARIABLE}\``));

test('D190: the cause by the closed code: every window failed for the key, or some did, whatever else failed', () => {
  const A = ['I1', 'F1'], B = ['I2', 'F2'];
  const cause = (windows) => sessionCallsFact(windows).cause;
  assert.equal(cause([W(A, KEY), W(B, KEY)]), 'key_missing');
  assert.equal(cause([W([...A, ...B], KEY)]), 'key_missing');
  // Some: beside a window that answered (a resumed review), or one that failed otherwise (every class).
  for (const other of [null, 'model_unavailable', 'model_timeout', 'budget_exhausted', 'unreviewed_scope',
    'invalid_model_input']) assert.equal(cause([W(A, KEY), W(B, other)]), 'some_key_missing', String(other));
  // No key window: as D183 says it (another refused code alone gives no cause).
  assert.equal(cause([W(A, 'invalid_model_input'), W(B, 'invalid_model_input')]), null);
  assert.equal(cause([W(A, 'model_unavailable'), W(B, 'model_timeout')]), 'no_answer');
  // By membership of the code, never by text: a value outside the closed list, or no field, is no failed window.
  assert.equal(cause([W(A, `${KEY} `), W(B)]), null);
  assert.equal(cause([W(A, KEY.toUpperCase()), W(B)]), null);
  assert.equal(cause([(({ failure, ...w }) => w)(W(A)), W(B)]), null);
  assert.ok(SESSION_CALLS_CAUSES.includes('key_missing') && SESSION_CALLS_CAUSES.includes('some_key_missing'));
  for (const c of SESSION_CALLS_CAUSES) {
    assert.ok(Object.hasOwn(REPORT_HEADER_WORDS.calls, c), c);
    assert.ok(Object.hasOwn(RUN_STATE_WORDS.session, c), c);
  }
});

test('D190: the header, the page, the .md and the run-state line name the key; the footer counts the tries as before', () => {
  const session = twoMessages();
  for (const [windows, c] of [[[W(['I1', 'F1'], KEY), W(['I2', 'F2'], KEY)], 'key_missing'],
    [[W(['I1', 'F1'], KEY), W(['I2', 'F2'])], 'some_key_missing'],
    [[W(['I1', 'F1'], KEY), W(['I2', 'F2'], 'unreviewed_scope')], 'some_key_missing']]) {
    const report = review(windows);
    const model = reportModel(session, report, {});
    assert.deepEqual(model.header.reviewIncomplete, [REPORT_HEADER_WORDS.reviewIncomplete, REPORT_HEADER_WORDS.calls[c]]);
    // The footer's count is the budget's tries, as before: the words say the calls failed, never that none was made.
    assert.match(model.footer.usage, /^In this run, Sonah made 2 model calls\./);
    const page = renderSessionPage(session, report, {}), md = renderReportMarkdown(session, report, {});
    for (const text of [page, md]) {
      for (const [key, said] of Object.entries(REPORT_HEADER_WORDS.calls)) assert.equal(has(text, said), key === c, `${c} ${key}`);
      assert.ok(!text.includes('sonah doctor'), c);
    }
    // Its close check: the variable's name reads as you type it. The .md, which the terminal prints by default, holds
    // it as a code span, never with its underscores escaped; the page as `<code>`.
    assert.ok(md.includes('`ANTHROPIC_API_KEY`') && !md.includes('ANTHROPIC\\_API'), c);
    assert.ok(page.includes('<code>ANTHROPIC_API_KEY</code>'), c);
    assert.equal(sessionPart(runStateLine(report)), RUN_STATE_WORDS.session[c]);
  }
  // The words name the variable that Sonah reads, and say the calls failed, never that they did not answer or were sent.
  for (const said of [REPORT_HEADER_WORDS.calls.key_missing, REPORT_HEADER_WORDS.calls.some_key_missing,
    RUN_STATE_WORDS.session.key_missing, RUN_STATE_WORDS.session.some_key_missing]) {
    assert.ok(said.includes('ANTHROPIC_API_KEY') && said.includes('failed'), said);
    assert.ok(!/did not answer|did not send|not sent/.test(said), said);
  }
});

test('D190: the words point to no doctor check, because sonah doctor does not take the API backend', () => {
  // If doctor ever checks the API backend (and so the key), these words may point to it: this test then fails.
  assert.throws(() => parseDoctorArgs(['--backend', 'anthropic-api', '--no-probe'], {}), (e) => e.code === 'usage');
  assert.throws(() => parseDoctorArgs(['--no-probe'], { SONAH_REVIEW_BACKEND: 'anthropic-api' }), (e) => e.code === 'usage');
  assert.equal(parseDoctorArgs(['--no-probe'], {}).backend, 'claude-cli');
});
