// What the review prints after it writes the report (D97): the count line (with D93's split), the
// Must act labels or the fixed pair, the Markdown report's line with its byte count, the one `gh pr comment` line with
// the path quoted for the shell, and what stands between the report and its code links. Pure; synthetic inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_OUTPUT_WORDS, byteCount, countLines, mdPathFor, reportOutputLines, shellQuote }
  from '../src/report-output.js';
import { reportModel } from '../../render/report-model.js';
import { REPORT_COUNT_WORDS } from '../../render/report-words.js';
import { REPORT_MD_LIMITS } from '../../render/session-story.js';
import { reportSession, triagedReport, untriagedReport, sessionOnlyReport, repoFacts, HEAD, START }
  from '../../render/test/report-fixture.js';

test('D97: the .md beside the page, and a path quoted for the shell only when it must be', () => {
  assert.equal(mdPathFor('review.html'), 'review.md');
  assert.equal(mdPathFor('out/Review.HTM'), 'out/Review.md');
  assert.equal(mdPathFor('review'), 'review.md');
  assert.equal(mdPathFor('review.txt'), 'review.txt.md');
  assert.equal(shellQuote('review.md'), 'review.md');
  assert.equal(shellQuote('/abs/out-1/r_2.md'), '/abs/out-1/r_2.md');
  assert.equal(shellQuote('Kapi Labs/review.md'), "'Kapi Labs/review.md'");
  assert.equal(shellQuote("it's.md"), "'it'\\''s.md'");
  assert.equal(shellQuote('a;rm -rf x.md'), "'a;rm -rf x.md'");
  assert.equal(shellQuote('$(x).md'), "'$(x).md'");
  assert.equal(byteCount(5812), '5,812');
  assert.equal(byteCount(999), '999');
  assert.equal(byteCount(60000), '60,000');
});

test('D97 (8): the terminal\'s count line has the D93 split and no "(folded)"; then the Must act labels', () => {
  const session = reportSession();
  const model = reportModel(session, triagedReport(session), repoFacts());
  const [count, labels] = countLines(model);
  assert.equal(count, `Must act ${model.tiers.must_act.length} · Must know ${model.tiers.must_know.length} · Good to know `
    + `${model.tiers.good_to_know.length} · Your prompt: 1 done, 1 done with a code finding, 1 partly done, 2 not done, `
    + '1 not checked');
  assert.equal(count.includes('(folded)'), false);
  // D112: the Must act items the code review rated high come first, so their labels lead.
  assert.match(labels, /^Must act: fix the refill order · check the forced push · ask 6 and \d+ more$/);
  // Two findings with no label of the code review's on one line: each label names its item, so they differ.
  const base = untriagedReport(session);
  const [first] = base.codePass.findings;
  const twice = { ...base, requirements: [], findings: [], promises: [], writtenClaims: [], decisions: [], failures: [],
    pivots: [], codePass: { ...base.codePass, questions: [], findings: [{ ...first, leadsFrom: [] },
      { ...first, id: `sha256:${'9'.repeat(64)}`, title: 'Another bug on the same line', leadsFrom: [] }] } };
  assert.equal(countLines(reportModel(session, twice, repoFacts()))[1],
    'Must act: src/limiter.js:2 (item 1) · src/limiter.js:2 (item 2)');
  // With nothing for Must act or Must know: the fixed pair, never an all-clear.
  const empty = reportModel(session, { windowResults: [] }, {});
  assert.deepEqual(countLines(empty), [`Must act 0 · Must know 0 · Good to know 0 · ${REPORT_COUNT_WORDS.noAsk}`,
    REPORT_COUNT_WORDS.emptyTiers]);
  // The code review's label, when the item has one, is printed as it wrote it.
  const plain = reportModel(session, sessionOnlyReport(session), {});
  assert.ok(countLines(plain)[1].startsWith('Must act: '));
});

test('D97 (8): the .md line with its bytes and the gh line exactly; a path with a space quoted; never --edit-last', () => {
  const lines = reportOutputLines({ md: { path: 'Kapi Labs/review.md', bytes: 5812 } });
  assert.deepEqual(lines, ['Sonah wrote the report for your pull request: Kapi Labs/review.md (5,812 bytes).',
    "To post it on the pull request of your current branch, run: gh pr comment --body-file 'Kapi Labs/review.md'"]);
  // No placeholder to edit: with no number, gh posts on the pull request of the current branch (`gh pr comment --help`).
  assert.equal(lines.join('\n').includes('<number>'), false);
  assert.equal(lines.join('\n').includes('--edit-last'), false);
  assert.equal(Object.values(REPORT_OUTPUT_WORDS).map((w) => (typeof w === 'function' ? w('x', 1) : w)).join(' ')
    .includes('--edit-last'), false);
});

test('D97 (8): a report over the 60,000-byte bound gets no gh line, and a line that says why', () => {
  // Only when the parts the report never shortens are longer than the bound on their own (session-story.js).
  const over = reportOutputLines({ md: { path: 'review.md', bytes: REPORT_MD_LIMITS.maxBytes + 1 } });
  assert.deepEqual(over, ['Sonah wrote the report for your pull request: review.md (60,001 bytes).',
    'The report is more than 60,000 bytes, the limit that Sonah sets for a GitHub comment. Sonah prints no gh command '
      + 'for it.']);
  assert.equal(over.join('\n').includes('gh pr comment'), false);
  // At the bound: the gh line.
  assert.deepEqual(reportOutputLines({ md: { path: 'review.md', bytes: REPORT_MD_LIMITS.maxBytes } })[1],
    REPORT_OUTPUT_WORDS.ghLine('review.md'));
});

test('D97 (8): a commit not on GitHub, a file not committed, and report files in the repository each get their line', () => {
  const repo = { head: HEAD, start: START, prefix: '', atHead: ['src/a.js'], goneAtHead: ['src/old.js'] };
  const github = { owner: 'o', repo: 'r', remote: 'origin', pushed: true, startPushed: true };
  const md = { path: 'review.md', bytes: 10 };
  // Everything committed and pushed: no more lines.
  assert.equal(reportOutputLines({ md, repo, github, files: ['src/a.js', 'src/old.js'] }).length, 2);
  // A changed file that differs from HEAD: the re-run line.
  assert.deepEqual(reportOutputLines({ md, repo, github, files: ['src/a.js', 'src/b.js'] }).slice(2),
    [REPORT_OUTPUT_WORDS.rerun]);
  // HEAD not pushed: the push line (its short id, the remote), naming only the links it leaves out (an old-side place
  // keeps its link), then the re-run line. It never says to push and then post this report: pushing adds no link to
  // it. The re-run line says how.
  assert.deepEqual(reportOutputLines({ md, repo, github: { ...github, pushed: false }, files: ['src/a.js'] }).slice(2),
    [`Git does not show commit ${HEAD.slice(0, 7)} on origin. This report has no links to the code as the agent left it.`,
      REPORT_OUTPUT_WORDS.rerun]);
  // Only the start commit missing: its short id, and the links to the code before the session.
  assert.deepEqual(reportOutputLines({ md, repo, github: { ...github, startPushed: false }, files: [] }).slice(2),
    [`Git does not show commit ${START.slice(0, 7)} on origin. This report has no links to the code as it was before the `
      + 'session.', REPORT_OUTPUT_WORDS.rerun]);
  // Both missing: each side's line, by its own commit; one commit that both sides need: no code links, said once.
  assert.deepEqual(reportOutputLines({ md, repo, github: { ...github, pushed: false, startPushed: false }, files: [] })
    .slice(2), [REPORT_OUTPUT_WORDS.notPushed.new(HEAD.slice(0, 7), 'origin'),
    REPORT_OUTPUT_WORDS.notPushed.old(START.slice(0, 7), 'origin'), REPORT_OUTPUT_WORDS.rerun]);
  assert.deepEqual(reportOutputLines({ md, repo: { ...repo, start: HEAD }, github: { ...github, pushed: false,
    startPushed: false }, files: [] }).slice(2), [`Git does not show commit ${HEAD.slice(0, 7)} on origin, so this report has no `
    + 'code links.', REPORT_OUTPUT_WORDS.rerun]);
  // Pushed state unknown (git could not say): no line claims it is not pushed.
  assert.equal(reportOutputLines({ md, repo, github: { ...github, pushed: null }, files: ['src/a.js'] }).length, 2);
  // Report files inside the repository, not ignored: said before the re-run line.
  assert.deepEqual(reportOutputLines({ md, repo, github, files: ['src/b.js'], inRepository: true }).slice(2),
    [REPORT_OUTPUT_WORDS.outputInRepository, REPORT_OUTPUT_WORDS.rerun]);
  // No GitHub remote: no code links can come, so no re-run line.
  assert.equal(reportOutputLines({ md, repo, github: null, files: ['src/b.js'] }).length, 2);
  // No .md written (it went to stdout): nothing about it.
  assert.deepEqual(reportOutputLines({ md: null }), []);
});
