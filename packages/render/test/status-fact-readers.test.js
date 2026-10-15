// Status fact (owner decision 2026-10-06: "unproven" is not a terminal state). The story and the page read a command's
// status from the record alone: a command whose zero exit status does not cover every command of its line is never
// listed as failed or as passed by that status; every failed command they list is a proven failure (a recorded failure
// or a nonzero exit); and a claim confirmed by a recorded result shows the result's own words it was confirmed through —
// its support receipt, which the review grounded in that result's output and its challenge upheld.
//
// Synthetic sessions and reports only: no recording, no model. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionStory, STORY_VERSION, confirmingQuote } from '../session-story.js';
import { renderSessionPage, PAGE_VERSION } from '../session-page.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const TEXT = {
  ask: 'SYNTHETIC_SFR_ASK: make the parser suite pass.',
  uncovered: 'npm test 2>&1 | tail -5 # SYNTHETIC_SFR_UNCOVERED',
  uncoveredOut: 'SYNTHETIC_SFR_RUN\nTests: 42 passed, 42 total',
  failing: 'node check.js SYNTHETIC_SFR_FAILING',
  failingOut: 'SYNTHETIC_SFR_CHECK: 1 failing',
  claim: 'SYNTHETIC_SFR_CLAIM: the parser suite is green.',
  open: 'SYNTHETIC_SFR_OPEN: the docs are current.',
};
const QUOTE = 'Tests: 42 passed, 42 total';
const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });

function fixture({ confirmed = true, supportQuote = QUOTE } = {}) {
  const b = sessionBuilder();
  b.ask('I1', TEXT.ask);
  b.say('C1', TEXT.claim);
  // An uncovered zero status: exit 0 on a pipeline — result unknown, the fact stated beside it.
  b.run('A1', TEXT.uncovered, 'unknown', TEXT.uncoveredOut);
  Object.assign(b.events.at(-1), { exitCode: 0, lastStatus: { exitCode: 0, verdict: null }, coversAll: false, statusGap: 'pipeline' });
  // A proven failure: exit 1.
  b.run('A2', TEXT.failing, 'failed', TEXT.failingOut);
  b.say('C2', TEXT.open, 'final');
  const session = b.session();
  const stated = receipt('commentary', 'C1', 'the parser suite is green.');
  const promises = [
    { id: 'p1', stated, text: 'The agent said the parser suite is green.', status: confirmed ? 'verified' : 'open',
      receipts: confirmed ? [stated, receipt('observation', 'A1-r', supportQuote)] : [stated] },
    { id: 'p2', stated: receipt('commentary', 'C2', 'the docs are current.'), text: 'The agent said the docs are current.',
      status: 'open', receipts: [receipt('commentary', 'C2', 'the docs are current.')] },
  ];
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    sessionStatus: 'NO_FINDINGS', promises };
  return { session, report };
}

test('status fact readers: versions moved with the bytes', () => {
  // M33 integration moved it once more (`sonah.session-story/7`): one version above both colliding /6s.
  // The D64 wording moved it once more (`sonah.session-story/8`): an upheld disclosure's words.
  // M35 windowing moved it once more (`sonah.session-story/9`): a helper's receipt no window holds.
  // M36 phase 3 moved it once more (`sonah.session-story/10`): a step may hold several sessions (D68 K).
  // D71 (a) moved it once more (`sonah.session-story/11`): no verdict — one Findings heading, the Review cell.
  // D71 (S4) moved it once more (`sonah.session-story/12`): a checklist ask read as code published it, and what contradicts
  // a claim labelled by its source.
  // D77 C moved it once more (`sonah.session-story/14`): a step is one of your requests, no longer one review window.
  // D79 moved it once more (`sonah.session-story/15`): a file you attached belongs to its message's request.
  // D79 moved it once more (`sonah.session-story/16`): a refused command did not run; a shell write of a refused or
  // failed command is no change.
  // The D80 integration moved it once more (`sonah.session-story/17`): a failed or stopped command's write is kept
  // apart, never as done, and a stopped command has one phrase.
  // D84 moved it once more (`sonah.session-story/18`): what the story shows is masked.
  // The column fix moved it once more (`sonah.session-story/19`, renumbered later): a decision a project
  // instruction file covers says the file it was referred from.
  // W1 B moved it once more (sonah.session-story/20): a project file's rule of an edit is labelled as the file's.
  // W2 moved it once more (sonah.session-story/21): the agent's own earlier text that contradicts a claim says so.
  // The review of W4 moved it once more (sonah.session-story/22): an ask no action followed says why it reads not done.
  // D87 moved it once more (sonah.session-story/23, its /22 renumbered at the merge): a review with a code pass lists
  // what the code review found.
  // The W4 revert moved it once more (sonah.session-story/24): W4's words beside an ask are gone with W4.
  // D88 moved it once more (sonah.session-story/25): the judgment first, the rows Sonah could not check folded.
  // The code step moved it once more (sonah.session-story/26, renumbered at its merge with D88): what the code
  // review found, in the method's order. The review of the code step moved it once more (sonah.session-story/27): the
  // footer counts paths outside the working directory.
  // The judgment-first review moved it once more (sonah.session-story/28): one counting, the claims every reader lists.
  // The release review moved it once more (sonah.session-story/29): with the home folder as the repository, the footer
  // says only the session's files were read and counts the rest.
  assert.equal(STORY_VERSION, 'sonah.session-story/29');
  // M33 integration moved it once more (`sonah.session-page/4`): one version above both colliding /3s; and the
  // D64 wording once more (`sonah.session-page/5`): an upheld disclosure's words; and the judgment-first page once more
  // (`sonah.session-page/6`, D69 f); and its review once more (`sonah.session-page/7`, D69 f (g)); and D70 (b) once more
  // (`sonah.session-page/8`: the decisions of how); and D71 (a) once more (`sonah.session-page/9`: no verdict, the
  // attention list after what you asked for); and D71 (S4) once more (`sonah.session-page/10`: the page is the checklist).
  // night/steps once more (`sonah.session-page/13`): the request a decision the review could not check was made under;
  // and the answer command printed once (`sonah.session-page/14`, D77 B); and D77 C once more (`sonah.session-page/15`:
  // a step is one of your requests); and D79 once more (`sonah.session-page/16`: a file you attached belongs to its
  // message's request, shown under the message); and D79 once more (`sonah.session-page/17`: a value receipt kept
  // without its value is shown as code written, with its hunk); and D79 once more (`sonah.session-page/18`: a refused
  // command did not run); and the D80 integration once more (`sonah.session-page/19`: a failed or stopped command's
  // write is kept apart, a stopped command has one phrase, and the quoted line is shown).
  // And D84 (4) c once more (`sonah.session-page/22`: the steps not fully reviewed are named; /20 and /21 were
  // decisions step 3 and D83 (2), reverted before release and never reused); and D84 once more
  // (`sonah.session-page/23`: what the page shows is masked); and the column fix once more
  // (`sonah.session-page/24`, renumbered later: a decision a project instruction file covers shows its words
  // under "Referred from <path>"); and W1 A once more (`sonah.session-page/25`: a decision kept "could not tell" because
  // the review's check refuted who decided it says why); and W2 once more (`sonah.session-page/26`: the agent's own
  // earlier text that contradicts a claim says so).
  // W4 moved it once more (sonah.session-page/27): an ask no action followed reads not done in this session.
  // D87 moved it once more (sonah.session-page/28, its /27 renumbered at the merge): a review with a code pass lists
  // what the code review found.
  // The W4 revert moved it once more (sonah.session-page/29): W4's words beside an ask are gone with W4.
  // D88 moved it once more (sonah.session-page/30): the judgment first, the rows Sonah could not check folded.
  // The code step moved it once more (sonah.session-page/31, renumbered at its merge with D88): what the code
  // review found, in the method's order. The review of the code step moved it once more (sonah.session-page/32): the
  // footer counts paths outside the working directory.
  // The judgment-first review moved it once more (sonah.session-page/33): one counting, folded groups by their count.
  // The release review moved it once more (sonah.session-page/34): with the home folder as the repository, the footer
  // says only the session's files were read and counts the rest.
  assert.equal(PAGE_VERSION, 'sonah.session-page/34');
});

test('status fact readers: an uncovered command is never listed as failed or passed; the failure listed is a proven one', () => {
  const { session, report } = fixture();
  const story = renderSessionStory(session, report);
  assert.ok(story.includes('1 command failed') && !story.includes('2 commands failed'), 'one failed command, not two');
  assert.ok(!story.includes('SYNTHETIC_SFR_UNCOVERED'), 'the uncovered command is named nowhere as failed');
  assert.ok(!/\bpassed\b/i.test(story.replace(QUOTE, '')), 'no status word "passed" outside the quoted result');
  // D69 f: the page counts the one proven failure; a claim citing the uncovered command's result shows no failure beside
  // it, and a row citing the failing result shows that command, the one failure, beside it.
  const page = renderSessionPage(session, report);
  assert.ok(page.includes('1 of 2 commands failed; 1 is cited by no row on this page'));
  // D69 f (g): the one no row cites is listed, folded, by its words; the uncovered command nowhere.
  assert.ok(!page.includes('SYNTHETIC_SFR_UNCOVERED'));
  assert.equal((page.match(/failed, exit/g) ?? []).length, 1);
  assert.ok(page.slice(page.indexOf('<details class="failed">')).includes('failed, exit'));
  const cited = renderSessionPage(session, { ...report, pivots: [{ abandoned: 'one check', adopted: 'another',
    receipts: [receipt('observation', 'A1-r', QUOTE), receipt('observation', 'A2-r', 'SYNTHETIC_SFR_CHECK: 1 failing')] }] });
  assert.ok(cited.includes('SYNTHETIC_SFR_FAILING'));
  assert.ok(!cited.includes('SYNTHETIC_SFR_UNCOVERED'));
  assert.equal((cited.match(/failed, exit/g) ?? []).length, 1);
  assert.ok(cited.includes('1 of 2 commands failed; 1 is shown beside the row that cites it.'));
});

test('status fact readers: a claim confirmed through a quoted result shows that quote; any other claim shows none', () => {
  const { session, report } = fixture();
  assert.equal(confirmingQuote(session, report.promises[0]), QUOTE);
  assert.equal(confirmingQuote(session, report.promises[1]), null, 'an open claim has no confirming result');
  const story = renderSessionStory(session, report);
  // G3 (owner decision 2026-10-05, merged): the status reads "confirmed by a recorded result" (after the claim, or before
  // it in its own turn with no change to the code between).
  assert.ok(story.includes(`(confirmed by a recorded result; `), 'premise: the claim reads confirmed');
  assert.ok(story.includes(`— Recorded result: "${QUOTE}"`), 'the result\'s own words, labelled');
  assert.equal(story.split('Recorded result:').length - 1, story.split(`Recorded result: "${QUOTE}"`).length - 1,
    'only the confirmed claim carries one');
  const page = renderSessionPage(session, report);
  assert.ok(page.includes(`<span class="label">Recorded result</span><blockquote><q class="said">${QUOTE}</q></blockquote>`));
  assert.equal(page.split('Recorded result</span>').length - 1, 1);
});

test('status fact readers: a confirming quote that does not ground in this session, or an open claim, shows nothing', () => {
  for (const options of [{ supportQuote: 'SYNTHETIC_SFR_NOT_IN_THE_OUTPUT' }, { confirmed: false }]) {
    const { session, report } = fixture(options);
    assert.equal(confirmingQuote(session, report.promises[0]), null, JSON.stringify(options));
    assert.ok(!renderSessionStory(session, report).includes('Recorded result:'), JSON.stringify(options));
    assert.ok(!renderSessionPage(session, report).includes('Recorded result</span>'), JSON.stringify(options));
  }
});
