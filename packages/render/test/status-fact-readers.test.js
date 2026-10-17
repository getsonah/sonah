// Status fact (owner decision 2026-10-06: "unproven" is not a terminal state). The report .md and the page read a command's
// status from the record alone: a command whose zero exit status does not cover every command of its line is never
// listed as failed or as passed by that status; every failed command they list is a proven failure (a recorded failure
// or a nonzero exit); and a claim confirmed by a recorded result shows the result's own words it was confirmed through —
// its support receipt, which the review grounded in that result's output and its challenge upheld.
//
// Synthetic sessions and reports only: no recording, no model. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReportMarkdown, STORY_VERSION } from '../session-story.js';
import { renderSessionPage, PAGE_VERSION } from '../session-page.js';
import { REPORT_DID_WORDS } from '../report-words.js';
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
  // The agentic code step's release item moved it once more (sonah.session-story/30): an ask's status beside what the
  // code step tied to it, the session shown as loaded (the footer saying the story is generated from the recorded
  // session), and the code step's new report.
  // The cleanup moved it once more (sonah.session-story/31): no statement found to hold, no row shown in the code, no
  // claim found false and no all-clear footer.
  // D98 moved it once more (sonah.session-story/33): its rows, runs and gaps read one effect rule.
  // D97 moved it once more (sonah.session-story/32): the story is the report .md, the report model rendered for a pull
  // request comment.
  // D99 moved it once more (sonah.session-story/34): a background run's end, and a stopped run, in the page's words.
  // D100 moved it once more (sonah.session-story/35): an absence only where code proves it.
  // D101 moved it once more (sonah.session-story/36): an ask says which test refused its quote.
  // D104 moved it once more (sonah.session-story/37): the shown-in-part mark.
  assert.equal(STORY_VERSION, 'sonah.session-story/37');
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
  // The agentic code step's release item moved it once more (sonah.session-page/35): an ask's status beside what the
  // code step tied to it, the session shown as loaded (the footer saying the page is generated from the recorded
  // session), and the code step's new report.
  // The cleanup moved it once more (sonah.session-page/36): no statement found to hold, no row shown in the code, no
  // claim found false and no all-clear footer.
  // The report model moved it once more (sonah.session-page/37, D97): the page renders the report's tiers.
  // D98 moved it once more (sonah.session-page/38): what the agent did and what Sonah could not check read one effect rule.
  // D99 moved it once more (sonah.session-page/39): a background run's end is said absent only where it is proved.
  // D100 moved it once more (sonah.session-page/40): an absence only where code proves it.
  // D101 moved it once more (sonah.session-page/41): an ask says which test refused its quote.
  // D104 moved it once more (sonah.session-page/42): the shown-in-part mark.
  assert.equal(PAGE_VERSION, 'sonah.session-page/42');
});

test('status fact readers: an uncovered command is never listed as failed or passed; the failure listed is a proven one', () => {
  const { session, report } = fixture();
  // D97: the report .md lists the runs as the page does: the one proven failure as failed, the uncovered zero status as
  // covering only the last command of its line.
  const story = renderReportMarkdown(session, report);
  assert.equal((story.match(/failed, exit code/g) ?? []).length, 1);
  assert.ok(story.includes(`SYNTHETIC_SFR_UNCOVERED\` · ${REPORT_DID_WORDS.uncoveredExit}`), story);
  assert.ok(!/\bpassed\b/i.test(story.split(QUOTE).join('')), 'no status word "passed" outside the quoted result');
  // D97: the page's runs list the one proven failure as failed, and the uncovered zero status as covering only the
  // last command of its line — never as failed, never as a plain pass.
  const page = renderSessionPage(session, report);
  assert.equal((page.match(/failed, exit code/g) ?? []).length, 1);
  assert.match(page, /SYNTHETIC_SFR_FAILING<\/code> · failed, exit code 1/);
  assert.ok(page.includes(`SYNTHETIC_SFR_UNCOVERED</code> · ${REPORT_DID_WORDS.uncoveredExit}`));
  assert.doesNotMatch(page, /SYNTHETIC_SFR_UNCOVERED<\/code> · (?:failed|exit code 0<)/);
});

test('status fact readers: a claim confirmed through a quoted result shows that quote; any other claim shows none', () => {
  const { session, report } = fixture();
  // G3 (owner decision 2026-10-05, merged): the claim reads checked (after the claim, or before it in its own turn
  // with no change to the code between), with the result's own words it was checked through; D97: in the report .md as
  // on the page.
  const story = renderReportMarkdown(session, report);
  assert.ok(story.includes(`- checked “the parser suite is green.” · ${REPORT_DID_WORDS.claimStatus.checked === 'checked'
    ? 'A recorded result shows:' : ''} “${QUOTE}”`), story);
  assert.equal(story.split('A recorded result shows:').length - 1, 1, 'only the confirmed claim carries one');
  // The page's claims list: the confirmed claim, then the result's own words it was confirmed through.
  const page = renderSessionPage(session, report);
  assert.ok(page.includes(`<span class="tag">checked</span> <q class="said">the parser suite is green.</q> · `
    + `<span class="label">A recorded result shows:</span> <q class="said">${QUOTE}</q>`), page.slice(page.indexOf('id="claim-1"')));
  assert.equal(page.split('A recorded result shows:</span>').length - 1, 1);
});

test('status fact readers: a confirming quote that does not ground in this session, or an open claim, shows nothing', () => {
  for (const options of [{ supportQuote: 'SYNTHETIC_SFR_NOT_IN_THE_OUTPUT' }, { confirmed: false }]) {
    const { session, report } = fixture(options);
    assert.ok(!renderReportMarkdown(session, report).includes('A recorded result shows:'), JSON.stringify(options));
    assert.ok(!renderSessionPage(session, report).includes('A recorded result shows:</span>'), JSON.stringify(options));
  }
});
