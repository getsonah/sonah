// M33 (C-06 "M33 session verdict"), amended by D71 (a) (owner decision 2026-10-08: no verdict anywhere the human
// sees): a GitHub check is always neutral — never success or failure — and its body and title say only whether
// Sonah's own review ran; a partial coverage is shown with every declared cause and its count. No status is published.
// Synthetic report and PR only; no network. D82 step 10: the plan is built from the report against a metadata-only PR
// read, with no diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicationPlan, publicCommentText } from '../index.js';

const BASE = 'b'.repeat(40), HEAD = 'a'.repeat(40);
const pr = () => ({ repo: { host: 'github.com', id: '42' }, number: 7, baseOid: BASE, headOid: HEAD,
  github: { owner: 'example', name: 'demo', private: true } });
const FACTS = { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1, reviewableEvents: 3,
  instructions: 1, instructionsElided: 1, instructionsWithheld: 0, delegationsUnlinked: 2, adapterGaps: 0, pairGaps: 0,
  declared: null };
const report = (over = {}) => ({ pr: null, codeStatus: 'CLEAN', sessionStatus: 'NO_FINDINGS',
  reviewStatus: 'NO_FINDINGS', coverage: 'partial', sessionReview: 'complete', codeCoverage: 'complete',
  coverageFacts: FACTS, gaps: [], findings: [], ...over });
const plan = (r) => createPublicationPlan({ report: r, pr: pr() });

const STATUS_WORDS = /DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED|needs your decision|worth a look/i;

test('D71 a completed review over partial coverage publishes a neutral check with its causes and no status', () => {
  const published = plan(report());
  assert.equal(published.check.conclusion, 'neutral');
  assert.equal(published.check.output.title, 'Advisory review ran to completion');
  const body = published.review.body;
  assert.ok(body.includes("Sonah's review ran to completion. It lists what to check; it never says the work is right."));
  // Every fact-derived sentence is escaped for the public surface (parentheses included).
  assert.ok(body.includes('1 instruction\\(s\\) were elided by the recorder'), body);
  assert.ok(body.includes('2 delegation\\(s\\) have no verified child evidence'), body);
  assert.doesNotMatch(body, STATUS_WORDS);
  assert.doesNotMatch(body, /approved for merge|ready to merge/i);
  assert.ok(published.check.output.summary.includes('Not covered:'), 'the check carries the causes too');
  assert.doesNotMatch(published.check.output.summary, STATUS_WORDS);
});

test('D71 a session-only review beside a code review that did not run is neutral and incomplete', () => {
  const published = plan(report({ codeStatus: 'UNCHECKED', reviewStatus: 'UNCHECKED', codeCoverage: 'missing' }));
  assert.equal(published.check.conclusion, 'neutral');
  assert.equal(published.check.output.title, 'Advisory review did not complete');
  assert.match(published.review.body, /Not covered: /);
  assert.doesNotMatch(published.review.body, STATUS_WORDS);
});

test('D71 a partial coverage no declared cause explains is published as an incomplete review, never as complete', () => {
  // The coverage is recomputed before planning: with no declared recorder limit the partial coverage is not shown to
  // be the recording's, so the session review is not shown to have completed.
  const bare = plan(report({ coverageFacts: { ...FACTS, instructionsElided: 0, delegationsUnlinked: 0 } }));
  assert.ok(bare.review.body.includes("Sonah's review did not complete"), bare.review.body);
  assert.ok(bare.review.body.includes('names no cause'), bare.review.body);
  assert.doesNotMatch(bare.review.body, STATUS_WORDS);
  assert.equal(bare.check.conclusion, 'neutral');
});

test('D71 the run state is recomputed before planning: a stated status the facts do not support changes nothing', () => {
  // A failed window: the session review did not complete, whatever the report says.
  const failed = plan(report({ coverageFacts: { ...FACTS, windowsFailed: 1 } }));
  assert.ok(failed.review.body.includes("Sonah's review did not complete"));
  assert.doesNotMatch(failed.review.body, STATUS_WORDS);
  // A report that says CLEAN over the same limits is published as what its facts are: a completed review with causes.
  const claimedClean = plan(report({ sessionStatus: 'CLEAN', reviewStatus: 'CLEAN' }));
  assert.ok(claimedClean.review.body.includes("Sonah's review ran to completion"));
  assert.match(claimedClean.review.body, /Not covered: /);
  assert.doesNotMatch(claimedClean.review.body, STATUS_WORDS);
});

test('M33 G2 a partial coverage whose causes are not all counted is refused', () => {
  // A cause whose count is not a positive safe integer cannot stand beside the coverage it qualifies.
  const uncounted = report({ coverageFacts: { ...FACTS, instructionsElided: 1.5 } });
  assert.throws(() => plan(uncounted), { code: 'invalid_input' });
  const huge = report({ coverageFacts: { ...FACTS, instructionsElided: Number.MAX_SAFE_INTEGER + 2 } });
  assert.throws(() => plan(huge), { code: 'invalid_input' });
});

test('M33 G2 no fact-derived value reaches the public text unescaped or unvalidated', () => {
  const HOSTILE = '<img src=x onerror=alert(1)>@maintainers';
  for (const hostile of [
    report({ coverageFacts: { ...FACTS, windows: HOSTILE } }),
    report({ gaps: [{ code: HOSTILE, channel: 'commentary', scope: 'session', count: HOSTILE, note: HOSTILE }] }),
    report({ gaps: [{ code: 'source_clipped', channel: HOSTILE, scope: 'session', count: 2, note: HOSTILE }] }),
  ]) {
    const published = plan(hostile);
    for (const text of [published.review.body, published.check.output.summary]) {
      assert.ok(!text.includes('<img'), text);
      assert.ok(!text.includes('@maintainers'), text);
    }
  }
  // A declared gap of an unrecognized code is shown by its count and fixed words only.
  const retired = plan(report({ gaps: [{ code: HOSTILE, channel: 'commentary', scope: 'session', count: 4 }] }));
  assert.match(retired.review.body, /\b4\b/);
});

test('M33 statuses are checked as the report\'s shape only, and none is published', () => {
  assert.throws(() => plan(report({ sessionStatus: 'SOMETHING_ELSE' })), { code: 'invalid_input' });
  // Over complete coverage nothing about coverage is added, and no status is published.
  const clean = plan(report({ sessionStatus: 'CLEAN', reviewStatus: 'CLEAN', coverage: 'complete',
    coverageFacts: { ...FACTS, instructionsElided: 0, delegationsUnlinked: 0 } }));
  assert.ok(clean.review.body.includes("Sonah's review ran to completion"));
  assert.equal(clean.check.conclusion, 'neutral');
  assert.doesNotMatch(clean.review.body, /Not covered:/);
  assert.doesNotMatch(clean.review.body, STATUS_WORDS);
});

test('D82 step 10 a session review\'s report: its checklist\'s attention lines, counts and fixed words only', () => {
  const session = report({ reviewScope: 'session-only', codeStatus: 'UNCHECKED', codeCoverage: 'missing',
    coverage: 'complete', coverageFacts: { ...FACTS, instructionsElided: 0, delegationsUnlinked: 0 },
    requirements: [{ text: 'SYNTHETIC_PRIVATE_ASK', status: 'not-done' }],
    decisions: [{ dimension: 'SYNTHETIC_PRIVATE_DECISION', column: 'unasked', columnState: 'grounded' }] });
  const published = plan(session);
  assert.ok(published.review.body.includes("Sonah's review ran to completion"), 'a session-only review needs no code');
  // D88: the agent's judgment first, then the settled problems.
  assert.match(published.review.body, /Where your attention is needed:\n- 1 decision made without asking you/);
  assert.match(published.review.body, /\n- 1 ask of yours shown not done or partly done/);
  assert.doesNotMatch(JSON.stringify(published), /SYNTHETIC_PRIVATE/);
  // Case-sensitive here: the checklist's own heading "What the agent decided" is no status.
  assert.doesNotMatch(published.review.body, /\b(?:DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b/);
  assert.doesNotMatch(published.review.body, /needs your decision|worth a look/i);
  assert.equal(published.check.conclusion, 'neutral');
});

test('D82 step 10 the comment for a synthetic session review, word for word: no finding-count line, no status', () => {
  // Pins the public wording: a sentence changed, a line added (such as the finding-count line plan /1 printed) or a
  // line lost fails here first.
  const session = report({ reviewScope: 'session-only', codeStatus: 'UNCHECKED', codeCoverage: 'missing',
    requirements: [{ text: 'SYNTHETIC_PRIVATE_ASK', status: 'not-done' }],
    decisions: [{ dimension: 'SYNTHETIC_PRIVATE_DECISION', column: 'unasked', columnState: 'grounded' }] });
  const expected = [
    'Sonah advisory review',
    '',
    "Sonah's review ran to completion. It lists what to check; it never says the work is right.",
    '',
    'Not covered: 1 instruction\\(s\\) were elided by the recorder; 2 delegation\\(s\\) have no verified child '
      + 'evidence.',
    '',
    'Where your attention is needed:',
    '- 1 decision made without asking you — under What the agent decided\\.',
    '- 1 ask of yours shown not done or partly done — under What you asked\\.',
    '- What the review could not cover — the Not covered line at the top\\.',
    '',
    'This is an advisory COMMENT review. It does not approve changes or permit merging. Read it before you share it.',
  ].join('\n');
  assert.deepEqual(publicCommentText(session), { run: 'complete', summary: expected });
  const published = plan(session);
  assert.equal(published.review.body, `${expected}\n\n${published.marker}`);
  assert.equal(published.check.output.summary, `${expected}\n\n${published.marker}`);
  // D88: the rows Sonah could not check are never counted where your attention is needed: one plain line after the
  // attention lines says how many and where.
  const folded = report({ reviewScope: 'session-only', codeStatus: 'UNCHECKED', codeCoverage: 'missing',
    requirements: [{ text: 'SYNTHETIC_PRIVATE_ASK', status: 'not-done' }, { text: 'SYNTHETIC_PRIVATE_ASK_2', status: 'not-checked' }],
    decisions: [{ dimension: 'SYNTHETIC_PRIVATE_DECISION', column: 'unasked', columnState: 'grounded' }],
    promises: [{ text: 'SYNTHETIC_PRIVATE_CLAIM', status: 'open' }] });
  assert.equal(publicCommentText(folded).summary, expected.replace(
    '\n\nThis is an advisory COMMENT review.',
    '\n\n2 rows Sonah could not check — folded under What Sonah could not check\\.\n\nThis is an advisory COMMENT review.'));
});
