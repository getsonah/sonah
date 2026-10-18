// D109's review (2026-10-18): with the code step's one tally (code-pass.js `codeChangeTally`), the header's size line,
// its count of files the code review did not see, the files that the agent changed and the coverage line all count the
// same files of the change, so no reader can take a part for the whole: a recorded write that lies in a folder the code
// review could read is one of them, and a write the code step only counts is said apart, with no place claimed. The
// size line says the change's files as the change ("a change of N files"), never as what the recording changed: with
// git the change runs from the start commit to the files as they are now. With no code step it is the recording's own.
//
// Pure renders of synthetic sessions and reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { reportModel } from '../report-model.js';
import { REPORT_HEADER_WORDS, REPORT_NOT_CHECKED_PARTS, REPORT_DID_WORDS } from '../report-words.js';
import { CODE_REPORT_WORDS as W, codeCoverageLines, codeUnseenFiles } from '../../evidence/src/code-report.js';
import { codeChangeTally } from '../../evidence/src/code-pass.js';
import { codeSession } from '../../cli/test/code-pass-fixture.js';
import { repoFacts } from './report-fixture.js';

const SHA = 'a'.repeat(64);
const FILES = [{ path: 'src/a.js', type: 'added', state: 'shown', sha256: SHA, hunks: 1 },
  { path: 'src/b.js', type: 'modified', state: 'shown', sha256: SHA, hunks: 1 },
  { path: 'src/c.js', type: 'modified', state: 'shown', sha256: SHA, hunks: 1 },
  { path: 'src/d.js', type: 'modified', state: 'left_out', sha256: SHA, hunks: 2 }];
const UNIT = (path, state, more = {}) => ({ path, state, side: 'new', shown: [], beforeUnshown: 0, lines: 10,
  recorded: true, ...more });
/** The manifest: a.js whole, b.js and c.js by their hunks, d.js left out for room (the review read it whole). */
const MANIFEST = () => ({ review: { sent: true, bound: 1_620_000, files: [
  UNIT('src/a.js', 'whole', { shown: [[1, 10]] }), UNIT('src/b.js', 'hunks_only', { shown: [[1, 4]] }),
  UNIT('src/c.js', 'hunks_only', { shown: [[2, 5]] }),
  UNIT('src/d.js', 'left_out', { reason: 'request_bound', change: [[3, 4]] })],
rules: [], commands: { count: 0, from: 1, inPart: [] }, texts: [] } });
const AGENTS = () => [{ label: 'code-review:agent', run: { turns: 3, tools: { Read: 1, Grep: 0, Glob: 0 }, unranged: 0,
  unrangedPaths: [], failed: [], reads: [{ path: 'src/d.js', ranges: [[1, 10]], lines: 10 }] } }];
function report({ base = { kind: 'git', commit: 'b'.repeat(40) }, files = FILES, manifest = MANIFEST() } = {}) {
  return { coverage: 'complete', sessionReview: 'complete', findings: [], requirements: [],
    codePass: { version: 'SYNTHETIC', ran: true, coverage: 'partial', gaps: [], files, base,
      agent: { turns: 3, tools: { Read: 1, Grep: 0, Glob: 0 }, reads: 1, terminal: 'answered' },
      calls: { review: 1, repair: 0, verify: 0, verifyRepeat: 0, batch: 0, batchRepeat: 0 }, findings: [], questions: [],
      withheld: [], footer: [], triage: [], triageDropped: [], filesDropped: [], ...(manifest ? { manifest } : {}),
      agents: AGENTS() } };
}
/** The report with a write in another repository and one written by an agent from another working directory, both in
 *  the manifest (not read), and a scratch write the code step only counts (not in the manifest). */
function withWrites(r = report()) {
  r.codePass.files = [...r.codePass.files, { path: 'inner/x.py', state: 'other_repository' },
    { path: 'plain/y.ts', state: 'outside_writer_root' }, { path: '/tmp/scratch.txt', state: 'outside_root' }];
  r.codePass.manifest.review.files.push(UNIT('inner/x.py', 'not_shown', { reason: 'other_repository', lines: null,
    beforeUnshown: null }), UNIT('plain/y.ts', 'not_shown', { reason: 'outside_writer_root', lines: null,
    beforeUnshown: null }));
  r.codePass.footer = [{ kind: 'outside_root', count: 1 }];
  return r;
}
const textOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'')
  .replace(/\s+/g, ' ');
/** The number of files the header's size line counts. */
const sizeFiles = (size) => Number(/(?:^a change of |^)(\d+) files?\b/.exec(size.find((p) => /\bfiles?\b/.test(p)))?.[1]);
const coverageTotal = (line) => Number(/^The change covers (\d+) files?\./.exec(line)?.[1]);

test('D109 review: the header, the files that the agent changed and the coverage line count the same files of the change '
  + '— a write that lies in a folder the review could read among them — and the files not seen are a part of them', () => {
  const r = withWrites();
  const session = codeSession();
  const model = reportModel(session, r, {});
  const tally = codeChangeTally(r.codePass);
  assert.equal(tally.total, 6);
  // The size line: the change's six files (not every one has the code step's lines, so none are given).
  assert.ok(model.header.size.includes(REPORT_HEADER_WORDS.change(6)), JSON.stringify(model.header.size));
  assert.equal(REPORT_HEADER_WORDS.change(6), 'a change of 6 files');
  // The header's files not seen: the two writes the review did not read, a part of the six.
  assert.ok(model.header.didNotCheck.phrases.includes(REPORT_NOT_CHECKED_PARTS.unseenFiles(2)),
    JSON.stringify(model.header.didNotCheck));
  assert.equal(REPORT_NOT_CHECKED_PARTS.unseenFiles(2), '2 files of the change that the code review did not see');
  const coverage = codeCoverageLines(r.codePass)[0];
  assert.equal(coverage, W.files(6, [['whole', 2], ['hunks_only', 2]], 2));
  // One count: the size line's files are the coverage line's, and the files not seen are a part of them.
  assert.equal(sizeFiles(model.header.size), coverageTotal(coverage));
  assert.ok(codeUnseenFiles(r.codePass) <= sizeFiles(model.header.size));
  // What the agent changed: the same six files, the two writes with their states and no link; the scratch write the code
  // step only counts is said apart, with no place claimed.
  assert.equal(model.did.files.total, 6);
  const listed = Object.fromEntries(model.did.files.groups.flatMap((g) => g.files).map((f) => [f.path, f]));
  assert.deepEqual(Object.keys(listed).sort(), ['inner/x.py', 'plain/y.ts', 'src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']);
  assert.deepEqual([listed['inner/x.py'].state, listed['inner/x.py'].link], [W.states.other_repository, null]);
  assert.deepEqual([listed['plain/y.ts'].state, listed['plain/y.ts'].link], [W.states.outside_writer_root, null]);
  assert.deepEqual(model.did.files.outside, { n: 1, paths: ['/tmp/scratch.txt'], more: 0, notInChange: true });
  // A write the change block does not hold gets no code link, even where a path of that name is at HEAD (one in another
  // repository is no file of this one); a file of the change block keeps its link.
  const linked = reportModel(session, r, repoFacts({ repo: { atHead: ['src/a.js', 'inner/x.py', 'plain/y.ts'] } }));
  const links = Object.fromEntries(linked.did.files.groups.flatMap((g) => g.files).map((f) => [f.path, f.link]));
  assert.deepEqual([links['inner/x.py'], links['plain/y.ts']], [null, null]);
  assert.match(links['src/a.js'], /^https:\/\/github\.com\/example-org\/example-api\/blob\/[0-9a-f]{40}\/src\/a\.js$/);
  const page = textOf(renderSessionPage(session, r));
  const md = renderReportMarkdown(session, r);
  assert.ok(page.includes(REPORT_DID_WORDS.notInChange(1, '/tmp/scratch.txt')), 'the page says the counted write apart');
  assert.match(md, /The agent also changed 1 file that Sonah counts but did not review: `\/tmp\/scratch\.txt`\./);
  for (const text of [page, md]) {
    assert.ok(text.includes('a change of 6 files'));
    assert.ok(text.includes('2 files of the change that the code review did not see'));
    assert.ok(text.includes('The change covers 6 files.'));
    assert.doesNotMatch(text, /outside the repository|files changed/);
  }
});

test('D109 review: the size line gives the change\'s lines only when Sonah holds every file\'s — the code step\'s, or with '
  + 'no git base the recording\'s — and never says that the recording changed the change\'s files', () => {
  // Git, every file with the code step's lines: the change's lines.
  const exact = report({ files: FILES.map((f) => ({ ...f, added: 2, removed: 1 })) });
  assert.ok(reportModel(codeSession(), exact, {}).header.size.includes(REPORT_HEADER_WORDS.change(4, '+8 −4')));
  // With a write the change block does not hold, Sonah does not hold its lines: none are given.
  const partial = withWrites(report({ files: FILES.map((f) => ({ ...f, added: 2, removed: 1 })) }));
  assert.ok(reportModel(codeSession(), partial, {}).header.size.includes(REPORT_HEADER_WORDS.change(6)));
  // No git base: the change is the recorded edits, and the recording holds the lines of src/parse.js.
  const session = codeSession();
  const recordingSays = reportModel(session, {}, {}).header.size[1];
  assert.equal(recordingSays, REPORT_HEADER_WORDS.filesChanged(1, '+4 −0'));
  const parse = { path: 'src/parse.js', type: 'modified', state: 'shown', sha256: SHA, hunks: 1 };
  const noGit = (more = []) => report({ base: { kind: 'recorded_edits' }, files: [parse, ...more.map(([path, state]) =>
    ({ path, state }))], manifest: { review: { ...MANIFEST().review, files: [UNIT('src/parse.js', 'whole',
    { shown: [[1, 4]], lines: 4 }), ...more.map(([path, state]) => UNIT(path, 'not_shown', { reason: state, lines: null,
    beforeUnshown: null }))] } } });
  assert.ok(reportModel(session, noGit(), {}).header.size.includes(REPORT_HEADER_WORDS.change(1, '+4 −0')));
  // A write the recording counts outside its write scope has no lines there: none are given.
  assert.ok(reportModel(session, noGit([['plain/y.ts', 'outside_writer_root']]), {}).header.size
    .includes(REPORT_HEADER_WORDS.change(2)));
  // With git, the recording's lines are not the change's (it runs from the start commit): none are given.
  const git = noGit();
  git.codePass.base = { kind: 'git', commit: 'b'.repeat(40) };
  assert.ok(reportModel(session, git, {}).header.size.includes(REPORT_HEADER_WORDS.change(1)));
  // With no code step, the recording's own files and lines, as before.
  assert.ok(reportModel(session, {}, {}).header.size.includes('1 file changed, +4 −0'));
  // An earlier report (no manifest) whose files are not all counted: the recording's own, as before.
  const earlier = report({ manifest: null });
  assert.ok(reportModel(session, earlier, {}).header.size.includes('1 file changed, +4 −0'));
});
