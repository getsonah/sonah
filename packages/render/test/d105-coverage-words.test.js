// D105 (F2 part A4, A1): the readers say what the code review saw, from the review request's manifest and the review's
// reading record alone — a file seen in part (its lines named), one seen only where the change touched it, a rule or
// skill file seen in part or not at all — and only when short of whole; a request too large to send is said so, never
// with "saw" and never as a call that did not answer; the commands left out of it for room are counted. A report
// written before (no manifest) reads byte for byte as before. Pure renders of a synthetic session and report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { reportModel } from '../report-model.js';
import { REPORT_NOT_CHECKED_PARTS, REPORT_HEADER_WORDS } from '../report-words.js';
import { CODE_REPORT_WORDS, codeFooterLines, codeCoverageLines, codeSeenLines, codeUnseenFiles }
  from '../../evidence/src/code-report.js';
import { codeSeenOf } from '../../evidence/src/code-pass.js';
import { codeSession } from '../../cli/test/code-pass-fixture.js';

const W = CODE_REPORT_WORDS;
const SHA = 'a'.repeat(64);
const R = (eventId, role, quote) => ({ eventId, role, quote });
const FILES = [{ path: 'src/a.js', type: 'added', state: 'shown', sha256: SHA, hunks: 1 },
  { path: 'src/b.js', type: 'modified', state: 'shown', sha256: SHA, hunks: 1 },
  { path: 'src/c.js', type: 'modified', state: 'shown', sha256: SHA, hunks: 1 },
  { path: 'src/d.js', type: 'modified', state: 'oversize', sha256: SHA, hunks: 2 }];
/** The review request's manifest as the code step records it: a.js shown whole, b.js and c.js by their hunks, d.js left
 *  out for room (modified: its hunks hold 6 rows on the earlier side, which the request did not show); two rule files,
 *  one shown whole and one left out. */
const MANIFEST = (sent = true) => ({ review: { sent, bound: 1_620_000, bytes: { brief: 9_000, words: 100, rules: 500,
  change: 3_000, dossier: 400, commands: 200, where: 100, total: 13_305 },
files: [{ path: 'src/a.js', state: 'whole', side: 'new', shown: [[1, 12]], beforeUnshown: 0, lines: 12 },
  { path: 'src/b.js', state: 'hunks_only', side: 'new', shown: [[4, 14]], beforeUnshown: 0, lines: 200 },
  { path: 'src/c.js', state: 'hunks_only', side: 'new', shown: [[20, 30]], beforeUnshown: 0, lines: 90 },
  { path: 'src/d.js', state: 'left_out', reason: 'request_bound', side: 'new', shown: [], change: [[2_000, 2_005]],
    beforeUnshown: 6, lines: 5_000 }],
rules: [{ path: 'AGENTS.md', kind: 'project', state: 'whole', shown: [[1, 30]], lines: 30 },
  { path: 'docs/RULES.md', kind: 'project', state: 'left_out', reason: 'request_bound', shown: [], lines: 900 }],
commands: { count: 40, from: sent ? 13 : 41, inPart: [] }, texts: [] } });
/** The review agent's reading record: b.js read lines 1 to 100 (in part, with its hunks), d.js read whole, RULES.md
 *  lines 1 to 40; a checker's read of c.js, which is the checker's own. */
const AGENTS = [{ label: 'code-review:agent', run: { turns: 9, tools: { Read: 3, Grep: 1, Glob: 0 }, unranged: 0,
  reads: [{ path: 'src/b.js', ranges: [[1, 100]], lines: 200 }, { path: 'src/d.js', ranges: [[1, 5_000]], lines: 5_000 },
    { path: 'docs/RULES.md', ranges: [[1, 40]], lines: 900 }] } },
{ label: 'code-verify:F1', run: { turns: 2, tools: { Read: 1, Grep: 0, Glob: 0 }, unranged: 0,
  reads: [{ path: 'src/c.js', ranges: [[1, 90]], lines: 90 }] } }];

function report({ sent = true, footer = sent ? [{ kind: 'commands_left_out', count: 12 }]
  : [{ kind: 'too_large', part: 'review', count: 1 }], manifest = MANIFEST(sent), agents = sent ? structuredClone(AGENTS)
  : [] } = {}) {
  return {
    repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null, codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', findings: [], failures: [], writtenClaims: [], pivots: [],
    promises: [], decisions: [],
    requirements: [{ text: 'Return [] for empty input.', instruction: R('I1', 'instruction',
      'SYNTHETIC_CODE_ASK: add a parse function that returns [] for empty input, and do not touch the README.'),
    status: 'done', deliverable: R('W1', 'code', 'export function parse(input) {') }],
    codePass: { version: 'SYNTHETIC', ran: true, coverage: sent ? 'partial' : 'missing', required: false, gaps: [],
      files: FILES, base: { kind: 'git', commit: 'b'.repeat(40), how: 'reflog' },
      agent: { turns: sent ? 9 : null, tools: { Read: null, Grep: null, Glob: null }, reads: null,
        terminal: sent ? 'answered' : 'not_sent' },
      calls: { review: sent ? 1 : 0, repair: 0, verify: 0, verifyRepeat: 0, batch: 0, batchRepeat: 0 },
      findings: [], questions: [], withheld: [], footer, triage: [], triageDropped: [], filesDropped: [],
      ...(manifest ? { manifest } : {}), agents },
  };
}
const textOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'')
  .replace(/\s+/g, ' ');

test('D105: what the code review saw short of whole, from the manifest and the review\'s reading record, on every reader',
  () => {
    const r = report();
    const lines = codeFooterLines(r);
    const inPart = W.seenInPart(['src/b.js (lines 1 to 100 of 200)']);
    const hunks = W.hunksOnly(['src/c.js']);
    const rules = W.rulesInPart(['docs/RULES.md (lines 1 to 40 of 900)']);
    // d.js, left out of the request and read over every line, was seen whole as it is now, but not as it was before.
    const wholeOnly = W.wholeNotBefore(['src/d.js']);
    assert.deepEqual(codeSeenLines(r.codePass), [inPart, hunks, wholeOnly, rules]);
    assert.ok([inPart, hunks, wholeOnly, rules].every((line) => lines.includes(line)), lines.join('\n'));
    assert.ok(lines.includes(W.footerKinds.commands_left_out({ count: 12 })));
    // A file whose change the review saw whole (a.js, shown whole) is named nowhere, and d.js only by its own line; the
    // checker's read of c.js is not the review's.
    for (const line of lines) assert.ok(!/src\/a\.js|AGENTS\.md/.test(line), line);
    assert.deepEqual(lines.filter((line) => line.includes('src/d.js')), [wholeOnly]);
    const page = textOf(renderSessionPage(codeSession(), r));
    const md = renderReportMarkdown(codeSession(), r);
    for (const line of [inPart, hunks, wholeOnly, rules]) {
      assert.ok(page.includes(line), line);
      assert.ok(md.includes(line), line);
    }
    // The same manifest and records, the same lines; nothing else of the report moves them.
    const other = report();
    other.codePass.findings = [];
    other.codePass.coverage = 'complete';
    assert.deepEqual(codeSeenLines(other.codePass), codeSeenLines(r.codePass));
    assert.deepEqual(codeSeenLines({ manifest: structuredClone(MANIFEST()), agents: structuredClone(AGENTS) }),
      codeSeenLines(r.codePass));
  });

test('D105: a request too large to send is said so — never "saw", never a call that did not answer — and the header '
  + 'counts every file of it as one the code review did not see', () => {
  const r = report({ sent: false });
  const coverage = codeCoverageLines(r.codePass);
  assert.deepEqual(coverage, [W.tooLarge(4)]);
  assert.match(coverage[0], /too large to send/);
  const footer = codeFooterLines(r);
  assert.deepEqual(footer, [W.footerKinds.too_large({ count: 1, parts: [W.parts.review] })]);
  assert.equal(codeSeenLines(r.codePass).length, 0, 'no seen line for a request not sent');
  assert.deepEqual(codeSeenOf(r.codePass).files.map((f) => f.state), ['not_seen', 'not_seen', 'not_seen', 'not_seen']);
  for (const text of [textOf(renderSessionPage(codeSession(), r)), renderReportMarkdown(codeSession(), r)]) {
    assert.ok(text.includes('The code review did not run, because its input was too large to send.'));
    assert.doesNotMatch(text, /saw the change|did not answer/);
  }
  assert.equal(codeUnseenFiles(r.codePass), 4);
  const model = reportModel(codeSession(), r, {});
  assert.ok(model.header.didNotCheck.phrases.includes(REPORT_NOT_CHECKED_PARTS.unseenFiles(4)),
    JSON.stringify(model.header.didNotCheck));
});

test('D105: a report written before (no manifest) reads as before — no seen line, its footer as it was', () => {
  const r = report({ manifest: null, agents: [] });
  r.codePass.footer = [{ kind: 'clipped', path: 'src/d.js' }];
  assert.equal(codeSeenOf(r.codePass), null);
  assert.deepEqual(codeSeenLines(r.codePass), []);
  assert.deepEqual(codeFooterLines(r), [W.footerKinds.clipped({ paths: ['src/d.js'] })]);
  assert.deepEqual(codeCoverageLines(r.codePass), [W.shownFiles(3, 4, `1 ${W.states.oversize}`), W.coverage.partial]);
  assert.equal(codeUnseenFiles(r.codePass), 1);
});

/** D109: the groups of the synthetic report as the one tally gives them: a.js whole, d.js whole but not as it was
 *  before (left out, read whole as it is now), b.js in part (read beyond its hunks), c.js only where the change touched
 *  it. */
const GROUPS = [['whole', 1], ['whole_not_before', 1], ['in_part', 1], ['hunks_only', 1]];

test('D109: with a manifest, the coverage line, the footer and the header read the one tally — a record footer that '
  + 'names a file the manifest shows whole counts it nowhere as unseen', () => {
  const r = report();
  r.codePass.footer = [{ kind: 'withheld', path: 'src/a.js' }];
  assert.equal(codeCoverageLines(r.codePass)[0], W.files(4, GROUPS, 0));
  assert.ok(!codeFooterLines(r).some((line) => line.includes('src/a.js')), codeFooterLines(r).join('\n'));
  assert.equal(codeUnseenFiles(r.codePass), 0);
});

test('D105: the coverage line counts from the manifest and the review\'s reading record — a file left out is one whose '
  + 'change the review saw only when it saw both sides of its hunks: read whole or over its change, one with no row on '
  + 'the earlier side is; a modified one is not, since no Read shows its earlier side; one read elsewhere is not', () => {
  const r = report();
  // d.js (modified) was left out of the request and read over every line: seen whole as it is now, not as it was, so its
  // change is not seen; its own line says so, and no state of it ("too large for one call") is said beside that. D109:
  // each file in one group of the one tally, the groups summing to the whole.
  assert.equal(codeCoverageLines(r.codePass)[0], W.files(4, GROUPS, 0));
  assert.ok(codeFooterLines(r).includes(W.wholeNotBefore(['src/d.js'])));
  const readD = (ranges, change, beforeUnshown = 6) => {
    const x = report();
    Object.assign(x.codePass.manifest.review.files[3], { change, beforeUnshown });
    x.codePass.agents[0].run.reads[1] = { path: 'src/d.js', ranges, lines: 5_000 };
    return x;
  };
  // Read over its change as it is now: its earlier side still not seen; read in part, it is one of the files seen in
  // part (its change seen or not, the coverage says whether the review finished).
  const inPart = [['whole', 1], ['in_part', 2], ['hunks_only', 1]];
  const changeOf = (x) => codeSeenOf(x.codePass).files.find((f) => f.path === 'src/d.js').changeSeen;
  const over = readD([[1, 100]], [[10, 20]]);
  assert.deepEqual([codeCoverageLines(over.codePass)[0], changeOf(over)], [W.files(4, inPart, 0), false]);
  // A file whose hunks hold no row on the earlier side (an added file's): read whole or over its change, its change
  // is seen; read elsewhere, it is not.
  const whole = readD([[1, 5_000]], [[1, 5_000]], 0);
  assert.deepEqual([codeCoverageLines(whole.codePass)[0], changeOf(whole)],
    [W.files(4, [['whole', 2], ['in_part', 1], ['hunks_only', 1]], 0), true]);
  const overAdded = readD([[1, 100]], [[10, 20]], 0);
  assert.deepEqual([codeCoverageLines(overAdded.codePass)[0], changeOf(overAdded)], [W.files(4, inPart, 0), true]);
  for (const elsewhere of [readD([[1, 100]], [[200, 300]], 0), readD([[1, 100]], [[200, 300]])])
    assert.deepEqual([codeCoverageLines(elsewhere.codePass)[0], changeOf(elsewhere)], [W.files(4, inPart, 0), false]);
  // Read in part, it is named by the seen lines with its lines, never as a file the code review did not see.
  const part = readD([[1, 100]], [[200, 300]]);
  assert.ok(codeFooterLines(part).includes(W.seenInPart(['src/b.js (lines 1 to 100 of 200)',
    'src/d.js (lines 1 to 100 of 5000)'])), codeFooterLines(part).join('\n'));
  assert.equal(codeUnseenFiles(part.codePass), 0);
});

test('D105: the header and the coverage line count the same change — a recorded write outside the working directory '
  + 'that lies in the repository is one of its files, sent or too large to send', () => {
  const outside = { path: '../lib/x.js', state: 'outside_root', sha256: SHA };
  const entry = { path: '../lib/x.js', state: 'not_shown', reason: 'outside_root', side: 'new', shown: [],
    beforeUnshown: null, lines: null };
  const withOutside = (sent) => {
    const x = report({ sent });
    x.codePass.files = [...FILES, outside];
    x.codePass.manifest.review.files.push(entry);
    if (sent) x.codePass.footer = [{ kind: 'withheld', path: '../lib/x.js' }, ...x.codePass.footer];
    return x;
  };
  const unsent = withOutside(false);
  assert.deepEqual(codeCoverageLines(unsent.codePass), [W.tooLarge(5)]);
  assert.equal(codeUnseenFiles(unsent.codePass), 5);
  // Sent: the write is one of the five files of the change, not seen, the header's count the coverage line's (D109: the
  // one tally).
  const sent = withOutside(true);
  assert.equal(codeCoverageLines(sent.codePass)[0], W.files(5, GROUPS, 1));
  assert.equal(codeUnseenFiles(sent.codePass), 1);
  assert.ok(codeFooterLines(sent).includes(W.footerKinds.withheld({ n: 1, states: [[W.states.outside_root, 1]],
    paths: ['../lib/x.js'] })), codeFooterLines(sent).join('\n'));
  // A write outside the repository is no part of the change: not in the manifest, never counted.
  const scratch = report();
  scratch.codePass.files = [...FILES, { path: '/tmp/scratch.txt', state: 'outside_root' }];
  assert.equal(codeCoverageLines(scratch.codePass)[0], W.files(4, GROUPS, 0));
});

test('D105: a file the review read with no lines Sonah could read is said so on every reader, never as unseen', () => {
  const r = report();
  r.codePass.agents[0].run.unrangedPaths = ['src/c.js', 'docs/RULES.md'];
  // D109: the file of the change and the rule file each by their own line, so the file's counts the coverage line's.
  const line = W.linesUnknown(['src/c.js']);
  const rule = W.rulesLinesUnknown(['docs/RULES.md']);
  assert.ok(codeSeenLines(r.codePass).includes(line), codeSeenLines(r.codePass).join('\n'));
  assert.ok(codeSeenLines(r.codePass).includes(rule), codeSeenLines(r.codePass).join('\n'));
  assert.equal(codeCoverageLines(r.codePass)[0], W.files(4, [['whole', 1], ['whole_not_before', 1], ['in_part', 1],
    ['lines_unknown', 1]], 0));
  assert.ok(!codeSeenLines(r.codePass).some((l) => l.startsWith(W.hunksOnly(['x']).split(':')[0])), 'c.js not hunks only');
  const page = textOf(renderSessionPage(codeSession(), r));
  const md = renderReportMarkdown(codeSession(), r);
  assert.ok(page.includes(line) && md.includes(line) && page.includes(rule) && md.includes(rule));
  for (const text of [page, md]) assert.doesNotMatch(text, /did not see: [^\n]*src\/c\.js/);
});

test('D109: the header\'s size line counts the one tally\'s files of the change, as the coverage line does — a record\'s '
  + 'write the manifest does not hold is no file of it (its review: d109-review-header.test.js)', () => {
  const r = report();
  r.codePass.files = FILES.map((f) => ({ ...f, added: 1, removed: 0 }));
  const before = reportModel(codeSession(), r, {}).header.size;
  assert.ok(before.includes(REPORT_HEADER_WORDS.change(4, '+4 −0')), JSON.stringify(before));
  r.codePass.files.push({ path: 'inner/x.py', state: 'other_repository' },
    { path: 'plain/y.ts', state: 'outside_writer_root' });
  assert.deepEqual(reportModel(codeSession(), r, {}).header.size, before);
});
