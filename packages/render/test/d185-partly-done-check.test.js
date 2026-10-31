// D185 (0.3.0-beta.11; the owner, 2026-10-30, "Ready items first"): the shortfall quote of an ask done only in part is
// recorded text that shows a part not met, never the missing part itself, so it is labelled by its receipt's role, as an
// ask not done labels it ("What is missing:" is gone); and the reason the session review's check gave for "partly done"
// is shown in the session review's words, from the one upheld check whose candidate is the row, byte for byte (D189:
// under "Its check, in the session review's words:"). Structure and provenance only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, agentPromptText, REPORT_LIMITS } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_ITEM_WORDS } from '../report-words.js';
import { escapeHtml as esc } from '../session-page.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const WHY = 'The retries are in the client, but the timeout the ask names is not set anywhere in the change.';
function build() {
  const b = sessionBuilder();
  b.ask('I1', 'Add retries and a timeout to the client.');
  b.change('W1', 'src/client.js', { after: 'retry(3);\nconst timeout = null;\n' });
  b.run('R1', 'npm test', 'failed', 'timeout test failed');
  b.say('H1', 'The timeout is still open.', 'final', 'helper-1');
  b.say('F1', 'I added the retries. I did not add the timeout.', 'final');
  return b.session();
}
const SHORTFALLS = Object.freeze({
  commentary: [r('commentary', 'F1', 'I did not add the timeout.'), REPORT_ITEM_WORDS.agentSaid],
  helper: [r('commentary', 'H1', 'The timeout is still open.'), REPORT_ITEM_WORDS.helperSaid],
  observation: [r('observation', 'R1-r', 'timeout test failed'), REPORT_ITEM_WORDS.recordedResult],
  code: [r('code', 'W1', 'const timeout = null;'), REPORT_ITEM_WORDS.changeShows],
  action: [r('action', 'R1', 'npm test'), REPORT_ITEM_WORDS.changeShows],
});
const ask = (shortfall, status = 'partly-done') => ({ text: 'retries and a timeout', status,
  instruction: r('instruction', 'I1', 'Add retries and a timeout to the client.'),
  deliverable: r('code', 'W1', 'retry(3);'), shortfall });
/** A check result as challenge.js writes it on a window record. */
const result = (row, { survived = true, votes = [{ pass: 1, valid: true, verdict: 'not-refuted', explanation: WHY }],
  candidate = {} } = {}) => ({ type: 'requirement', survived, candidate: { text: row.text, status: row.status,
  instruction: row.instruction, deliverable: row.deliverable, shortfall: row.shortfall, ...candidate }, votes });
const review = (session, row, records = { challenge: [result(row)] }) => ({ sessionReview: 'complete', coverage: 'complete',
  windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null, groundingComplete: true,
    ...Object.fromEntries(Object.entries(records).map(([field, results]) => [field, { complete: true, results }])) }],
  requirements: [row] });
const itemOf = (session, report) => Object.values(reportModel(session, report, {}).tiers).flat()
  .find((item) => item.kind === 'ask_partly_done' || item.kind === 'ask_not_done');
// D189: the line's label names the session review as its source (`checkReview`).
const checkOf = (item) => item.evidence.filter((e) => e.label === REPORT_ITEM_WORDS.checkReview);

test('D185: an ask done only in part labels its shortfall\'s quote by its role, on the page and in the .md', () => {
  const session = build();
  for (const [role, [shortfall, label]] of Object.entries(SHORTFALLS)) {
    const report = review(session, ask(shortfall));
    const item = itemOf(session, report);
    assert.equal(item.kind, 'ask_partly_done', role);
    const line = item.evidence.find((e) => e.parts[0]?.quote && e.parts[0].text === shortfall.quote);
    assert.equal(line?.label, label, role);
    assert.ok(!Object.hasOwn(line, 'roleLabel'), role);
    for (const text of [renderSessionPage(session, report, {}), renderReportMarkdown(session, report, {})]) {
      assert.ok(!text.includes('What is missing:'), role);
      assert.ok(text.includes(label), role);
    }
    // An ask not done labels it the same way, as before.
    const notDone = itemOf(session, review(session, ask(shortfall, 'not-done'), {}));
    assert.equal(notDone.evidence.find((e) => e.parts[0]?.text === shortfall.quote)?.label, label, role);
  }
});

test('D185, D201: the check\'s reason, from each of the three records, in the session review\'s words, cut at '
  + 'reasonChars', () => {
  const session = build();
  const row = ask(SHORTFALLS.commentary[0]);
  for (const field of ['challenge', 'restatusChallenge', 'windowVoteChallenge']) {
    const report = review(session, row, { [field]: [result(row)] });
    const [line] = checkOf(itemOf(session, report));
    assert.deepEqual(line.parts.map((p) => [p.text, p.by, p.quote]), [[WHY, 'session-review', false]], field);
    assert.ok(renderSessionPage(session, report, {}).includes(`<span class="label">${esc(REPORT_ITEM_WORDS.checkReview)}`
      + `</span> <em class="by-session-review">${WHY}</em>`), field);
    assert.ok(renderReportMarkdown(session, report, {}).includes(`${REPORT_ITEM_WORDS.checkReview} *${WHY}*`), field);
  }
  // A long reason is cut, with "…". D201: at REPORT_LIMITS.reasonChars (1200), no longer at 300, so a reason of 484
  // characters, which 300 cut, is whole, and one past the bound is cut at it.
  const reasonOf = (explanation) => checkOf(itemOf(session, review(session, row, { challenge: [result(row, { votes: [
    { pass: 1, valid: true, verdict: 'not-refuted', explanation }] })] })))[0].parts[0].text;
  const whole = `${'The timeout is missing. '.repeat(20)}End.`;
  assert.ok(whole.length > 300 && whole.length < REPORT_LIMITS.reasonChars);
  assert.equal(reasonOf(whole), whole);
  const long = `${'The timeout is missing. '.repeat(60)}End.`;
  assert.ok(long.length > REPORT_LIMITS.reasonChars);
  assert.equal(reasonOf(long).length, REPORT_LIMITS.reasonChars);
  assert.ok(reasonOf(long).endsWith('…'));
  assert.equal(REPORT_LIMITS.reasonChars, 1200);
  // The first valid upholding vote in pass order, whatever order the record keeps.
  const ordered = review(session, row, { challenge: [result(row, { votes: [
    { pass: 2, valid: true, verdict: 'not-refuted', explanation: 'Second pass.' },
    { pass: 1, valid: false, verdict: 'not-refuted', explanation: 'Invalid first pass.' },
    { pass: 0, valid: true, verdict: 'not-refuted', explanation: 'First pass.' }] })] });
  assert.equal(checkOf(itemOf(session, ordered))[0].parts[0].text, 'First pass.');
});

test('D185: no check line when no single upheld check is the row\'s, or none of its votes upholds it with a reason', () => {
  const session = build();
  const row = ask(SHORTFALLS.observation[0]);
  const none = (records, why) => assert.deepEqual(checkOf(itemOf(session, review(session, row, records))), [], why);
  none({}, 'no record');
  none({ challenge: [] }, 'no result');
  none({ challenge: [result(row), result(row)] }, 'two upheld matches');
  none({ challenge: [result(row)], restatusChallenge: [result(row)] }, 'two upheld matches in two records');
  none({ challenge: [result(row, { survived: false })] }, 'refuted');
  none({ challenge: [{ ...result(row), type: 'claim' }] }, 'another type');
  none({ challenge: [result(row, { candidate: { status: 'not-done' } })] }, 'another status');
  for (const field of ['instruction', 'deliverable', 'shortfall'])
    for (const key of ['eventId', 'role', 'quote'])
      none({ challenge: [result(row, { candidate: { [field]: { ...row[field], [key]: `${row[field][key]}x` } } })] },
        `${field}.${key} differs`);
  none({ challenge: [result(row, { votes: [{ pass: 1, valid: false, verdict: 'not-refuted', explanation: WHY }] })] }, 'invalid');
  none({ challenge: [result(row, { votes: [{ pass: 1, valid: true, verdict: 'uncertain', explanation: WHY }] })] }, 'uncertain');
  none({ challenge: [result(row, { votes: [{ pass: 1, valid: true, verdict: 'not-refuted', explanation: '  ' }] })] },
    'no reason');
  // One refuted and one upheld match: the upheld one is the row's single upheld check.
  assert.equal(checkOf(itemOf(session, review(session, row, { challenge: [result(row, { survived: false }), result(row)] })))
    .length, 1);
  // An ask not done gets none (judgment call 4: only the partly done ask, as measured).
  const notDone = ask(SHORTFALLS.observation[0], 'not-done');
  assert.deepEqual(checkOf(itemOf(session, review(session, notDone, { challenge: [result(notDone)] }))), []);
});

test('D185: the prompt for the agent is as D144 made it: the role labels, and no check line', () => {
  const session = build();
  const row = ask(SHORTFALLS.commentary[0]);
  const item = itemOf(session, review(session, row));
  assert.equal(item.tier.final, 'must_act');
  const prompt = agentPromptText(item.agentPrompt);
  assert.deepEqual(prompt.split('\n'), ['I asked: “Add retries and a timeout to the client.”', 'You did only part of it.',
    'This does part of it: “retry(3);”', 'You said: “I did not add the timeout.”', 'Where: `src/client.js`',
    'Fix this. If you think that it is right as it is, give me your reason.']);
  assert.ok(!prompt.includes(WHY));
});
