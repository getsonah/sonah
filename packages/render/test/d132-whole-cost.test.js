// D132 (R3 b): a review stopped and resumed (or replayed) gives in its footer what the whole review cost, over every run
// its state folder keeps (the CLI's `earlierRuns`, then this run's record): the runs, the calls and the code review's
// part, the tokens and the time summed, and each usage limit by the sum of each run's rise. The list cost stays off the
// footer unless FOOTER_LIST_COST says otherwise (D129's judgment call 1; an open call for the owner). Synthetic records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, FOOTER_LIST_COST } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_FOOTER_WORDS } from '../report-words.js';
import { reportSession, sessionOnlyReport } from './report-fixture.js';

/** A usage record as cli review-budget.js `usageRecord` writes it (the fields the footer reads). */
const record = ({ calls, input = calls * 100, output = calls * 10, wallMs = 60_000, cost = calls * 1.5, five = [0.1, 0.2],
  seven = [0.5, 0.6], code = null }) => ({ version: 'sonah.review-usage/1', calls, inputBytes: input * 3,
  inputTokens: input, inputReportedCalls: calls, inputSplit: null, outputTokens: output, outputReportedCalls: calls,
  costUsd: cost, costReportedCalls: calls, reportedCalls: calls, agentCalls: 0, turns: 0, wallMs,
  windows: { five_hour: { first: five[0], last: five[1] }, seven_day: { first: seven[0], last: seven[1] } },
  code: code === null ? null : { calls: code } });
// A long review's two runs, as usage.private.json keeps them (counts only): a run stopped at a limit, then its resume.
// Synthetic figures.
const LONG = [record({ calls: 120, input: 40_000_000, output: 800_000, wallMs: 1_500_000, cost: 150.254321,
  five: [0.02, 0.9], seven: [0.6, 0.75] }), record({ calls: 2, input: 300_000, output: 3_000, wallMs: 60_000,
  cost: 1.5, five: [0, 0.01], seven: [0.76, 0.76] })];
const footerOf = (usage, earlierRuns) => {
  const session = reportSession();
  const report = { ...sessionOnlyReport(session), instrument: { usage } };
  return reportModel(session, report, earlierRuns ? { earlierRuns } : {}).footer.usage;
};

test('D132: a resumed review\'s footer gives the whole review\'s calls, tokens, time and limits over all its runs', () => {
  assert.equal(FOOTER_LIST_COST, false);
  // The stopped run and its resume (120 + 2 calls).
  assert.equal(footerOf(LONG[1], [LONG[0]]), 'Over its 2 runs, this review made 122 model calls. The calls used 40300000 '
    + 'input tokens and 803000 output tokens in 26 minutes. Your five-hour usage rose by 89% of its limit over these '
    + 'runs. Your seven-day usage rose by 15% of its limit over these runs.');
  // A replay after it: 0 calls of its own, the same 122 in all; D132's review (finding 4): over the 2 runs that made
  // calls, the replay not counted.
  const replay = record({ calls: 0, input: 0, output: 0, wallMs: 5_000, cost: 0, five: [0, 0], seven: [0.76, 0.76] });
  assert.match(footerOf(replay, LONG), /^Over its 2 runs, this review made 122 model calls\. The calls used 40300000 input /);
  // A replay after one run that made calls: that earlier run's, said so.
  assert.equal(footerOf(replay, [LONG[0]]), 'This review made 120 model calls in an earlier run. The calls used 40000000 '
    + 'input tokens and 800000 output tokens in 25 minutes. Your five-hour usage rose by 88% of its limit in that run. '
    + 'Your seven-day usage rose by 15% of its limit in that run.');
  // Earlier runs that made no call: the run's own sentence.
  assert.match(footerOf(LONG[0], [replay, replay]), /^In this run, Sonah made 120 model calls\./);
  // A replay reads no limit (it made no call): the limits of the runs that made calls still show.
  const silent = { ...replay, windows: null };
  assert.match(footerOf(silent, LONG), /Your five-hour usage rose by 89% of its limit over these runs\. Your seven-day usage /);
  // One run: its own sentence, as D129 said it.
  assert.match(footerOf(LONG[0]), /^In this run, Sonah made 120 model calls\./);
  assert.equal(footerOf(LONG[0], []), footerOf(LONG[0]));
});

test('D132: what cannot be summed is not said — a reset limit, unreported tokens, an unreadable earlier record', () => {
  // A limit that reset during a run (its last reading below its first) is left out; the other stays.
  const reset = record({ calls: 2, five: [0.9, 0.1] });
  assert.equal(footerOf(record({ calls: 3 }), [reset]), 'Over its 2 runs, this review made 5 model calls. The calls '
    + 'used 500 input tokens and 50 output tokens in 2 minutes. Your seven-day usage rose by 20% of its limit over these '
    + 'runs.');
  // The same when the reset is in this run, the current one: its limit is left out, the other summed.
  assert.equal(footerOf(record({ calls: 3, five: [0.8, 0.05] }), [record({ calls: 2 })]), 'Over its 2 runs, this review '
    + 'made 5 model calls. The calls used 500 input tokens and 50 output tokens in 2 minutes. Your seven-day usage rose by '
    + '20% of its limit over these runs.');
  // A run whose calls did not all report tokens: the time alone.
  const partial = { ...record({ calls: 2 }), inputReportedCalls: 1 };
  assert.match(footerOf(record({ calls: 1 }), [partial]), /made 3 model calls\. The calls took 2 minutes\./);
  // The code review's part, summed over the runs that had one.
  assert.match(footerOf(record({ calls: 4, code: 1 }), [record({ calls: 2, code: 2 })]),
    /made 6 model calls, and the code review made 3 of them\./);
  // An earlier record that cannot be read: this run's own words, never a partial sum.
  assert.match(footerOf(record({ calls: 4 }), [{ version: 'other', calls: 9 }]), /^In this run, Sonah made 4 model calls\./);
  assert.match(footerOf(record({ calls: 4 }), [{ ...record({ calls: 9 }), calls: -1 }]), /^In this run/);
  assert.match(footerOf(record({ calls: 4 }), [record({ calls: 2 }), { version: 'other', calls: 9 }]),
    /^In this run, Sonah made 4 model calls\./, 'one unreadable run: no sum of the others');
});

test('D132: the page and the .md say the whole cost, with no list price unless FOOTER_LIST_COST', () => {
  const session = reportSession();
  const report = { ...sessionOnlyReport(session), instrument: { usage: LONG[1] } };
  const words = footerOf(LONG[1], [LONG[0]]);
  assert.ok(renderSessionPage(session, report, { earlierRuns: [LONG[0]] }).includes(`<p>${words}</p>`));
  const md = renderReportMarkdown(session, report, { earlierRuns: [LONG[0]] });
  assert.ok(md.includes(words), md.slice(-600));
  assert.doesNotMatch(md, /\$\d/);
  // The words, when the price is given: $150.25 + $1.50, rounded once to $151.75.
  assert.match(REPORT_FOOTER_WORDS.usageRuns({ runs: 2, calls: 122, inputTokens: null, outputTokens: null,
    wallMs: 1_560_000, costUsd: Math.round((150.254321 + 1.5) * 100) / 100 }), /At list prices, they cost \$151\.75\./);
});
