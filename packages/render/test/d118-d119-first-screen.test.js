// D118 and D119 (the owner's go of 2026-10-18, "cool go for it"; the dogfood's DF2, DF1 rules 1 and 2, and DF11's
// "492" sentence). (a) When the code step reviewed no code — no code pass, none that ran, no change to review, no request
// sent, no answer, or no file of the change seen — every first screen (the page's header, the report .md's first lines,
// the PR comment, the terminal) carries the owner's sentence "No code was reviewed." with exactly one closed reason, and
// "complete" is never said without naming what is missing. (b) A path a shell write spells with an expansion the
// recording does not resolve is never a file of the change: counted apart, in its own unit. (c) The header's file count
// and the Files section count one list. D119: the evidence Sonah holds only in part is said one kind at a time, each
// count in one unit, and "read" only of what Sonah read.
//
// Every session, report and path here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown, storyFacts } from '../session-story.js';
import { reportModel, noCodeText, folderNameOf, HOME_FOLDER_NAME } from '../report-model.js';
import { CODE_REPORT_WORDS as W, codeNotReviewedOf, reportNotReviewedOf } from '../../evidence/src/code-report.js';
import { CODE_NOT_REVIEWED_REASONS } from '../../evidence/src/ledger.js';
import { codeSnapshotPlan } from '../../evidence/src/code-pass.js';
import { unresolvedShellPaths } from '../../evidence/src/code-context.js';
import { coverageCauses, COVERAGE_SENTENCE } from '../../evidence/src/review.js';
import { WORKFLOW_RUN_GAP_NOTES, WORKFLOW_GAP_NOTES, CALL_INPUT_GAP_NOTES }
  from '../../evidence/adapters/sonah-ledger.js';
import { publicCommentText, createPublicationPlan, CHECK_TITLES } from '../../github/publication.js';
import { runStateLine } from '../../cli/src/session-review-command.js';
import { readCodeSnapshot } from '../../cli/src/code-snapshot.js';
import { codeSession } from '../../cli/test/code-pass-fixture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionBuilder } from './session-story-fixture.js';
import { REPORT_DID_WORDS } from '../report-words.js';

const SHA = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);
const FOLDER = '/work/project';
const UNIT = (path, state, more = {}) => ({ path, state, side: 'new', shown: [], beforeUnshown: 0, lines: 10,
  recorded: true, ...more });
const FILES = [{ path: 'src/a.js', type: 'added', state: 'shown', sha256: SHA, hunks: 1 },
  { path: 'src/d.js', type: 'modified', state: 'left_out', sha256: SHA, hunks: 2 }];
const MANIFEST = (sent = true, files = [UNIT('src/a.js', 'whole', { shown: [[1, 10]] }),
  UNIT('src/d.js', 'left_out', { reason: 'request_bound', change: [[3, 4]] })]) => ({ review: { sent, bound: 1_620_000,
  files, rules: [], commands: { count: 0, from: 1, inPart: [] }, texts: [] } });
const READ_D = [{ label: 'code-review:agent', run: { turns: 3, tools: { Read: 1, Grep: 0, Glob: 0 }, unranged: 0,
  unrangedPaths: [], failed: [], reads: [{ path: 'src/d.js', ranges: [[1, 10]], lines: 10 }] } }];
const NO_ACT = [{ label: 'code-review:agent', run: { turns: 0, tools: { Read: 0, Grep: 0, Glob: 0 }, unranged: 0,
  unrangedPaths: [], failed: [], reads: [] } }];
const pass = (over = {}) => ({ version: 'SYNTHETIC', ran: true, coverage: 'complete', gaps: [], files: FILES,
  base: { kind: 'git', commit: COMMIT, written: 2, changedOutside: [] },
  agent: { turns: 3, tools: { Read: 1, Grep: 0, Glob: 0 }, reads: 1, terminal: 'answered' },
  calls: { review: 1, repair: 0, verify: 0, verifyRepeat: 0, batch: 0, batchRepeat: 0 }, findings: [], questions: [],
  withheld: [], footer: [], triage: [], triageDropped: [], filesDropped: [], manifest: MANIFEST(), agents: READ_D,
  required: false, ...over });
const report = (codePass) => ({ pr: null, reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete',
  codeCoverage: 'missing', codeStatus: 'UNCHECKED', sessionStatus: 'NO_FINDINGS', reviewStatus: 'NO_FINDINGS',
  findings: [], requirements: [], ...(codePass === undefined ? {} : { codePass }) });
const EMPTY = { files: [], manifest: undefined, agents: [], withheld: [],
  agent: { turns: null, tools: { Read: null, Grep: null, Glob: null }, reads: null, terminal: 'not_sent' },
  calls: { review: 0, repair: 0, verify: 0, verifyRepeat: 0, batch: 0, batchRepeat: 0 } };
const withoutManifest = (p) => { const { manifest: _m, ...rest } = p; return rest; };

/** One code pass record for each closed reason, and one that reviewed code (null). */
const CASES = Object.freeze([
  ['step_off', undefined],
  ['backend', { ran: false, gaps: [{ code: 'code_step_backend' }] }],
  ['no_folder', { ran: false, gaps: [] }],
  ['no_write', withoutManifest(pass({ ...EMPTY, base: { kind: 'git', commit: COMMIT, written: 0, changedOutside: [] } }))],
  // D123 (the beta.5 end-to-end smoke): no recorded write, a start folder in no repository, and a shell command ran.
  ['no_seen_write', withoutManifest(pass({ ...EMPTY, base: { kind: 'recorded_edits', written: 0 }, unseenEdits: true }))],
  // D124's review (its medium): the same, with the working folder's own repository given with --code-repo.
  ['no_seen_write_given', withoutManifest(pass({ ...EMPTY, base: { kind: 'git', commit: COMMIT, written: 0,
    changedOutside: [], given: true }, unseenEdits: true }))],
  ['no_written_change', withoutManifest(pass({ ...EMPTY, base: { kind: 'git', commit: COMMIT, written: 3,
    changedOutside: ['docs/other.md'] } }))],
  ['no_file', withoutManifest(pass({ ...EMPTY, base: { kind: 'git', commit: COMMIT, written: 46, changedOutside: [] } }))],
  ['none_shown', withoutManifest(pass({ ...EMPTY, files: [{ path: 'src/gone.bin', type: 'deleted', state: 'binary',
    hunks: 0 }] }))],
  ['too_large', pass({ coverage: 'missing', manifest: MANIFEST(false), agents: [],
    agent: { turns: null, tools: {}, reads: null, terminal: 'not_sent' } })],
  ['no_answer', pass({ coverage: 'missing', agents: NO_ACT, agent: { turns: 0, tools: {}, reads: 0, terminal: 'failed' } })],
  ['none_seen', pass({ files: [FILES[1]], manifest: MANIFEST(true, [UNIT('src/d.js', 'left_out',
    { reason: 'request_bound', change: [[3, 4]] })]), agents: NO_ACT })],
  // D122 (a review low of D118): no request, in a record of a code step from before the request's manifest
  // (code-pass/12), which does not say why (that step could also drop a request too large to send).
  ['unknown', withoutManifest(pass({ ...EMPTY, version: { pass: 'sonah.code-pass/8' }, files: [FILES[0]] }))],
  [null, pass()],
]);

// D124: the reason `no_seen_write` names `<the repository's folder>`, which the page and the .md escape.
const textOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'')
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const unangled = (md) => md.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const count = (text, part) => text.split(part).length - 1;

test('D118 (a): every closed reason is reached from the code pass record alone, and only those', () => {
  assert.deepEqual(CASES.map(([reason, p]) => codeNotReviewedOf(p)), CASES.map(([reason]) => reason));
  assert.deepEqual(CASES.filter(([r]) => r).map(([r]) => r), [...CODE_NOT_REVIEWED_REASONS]);
  for (const reason of CODE_NOT_REVIEWED_REASONS) assert.match(W.notReviewedReasons[reason], /\S/);
  // A record written before the tally (no manifest) whose change holds files: its record cannot say what was read.
  assert.equal(codeNotReviewedOf(withoutManifest(pass())), null);
  // D122: no request is `none_shown` only from a code step that keeps the manifest (code-pass/12 on); an earlier
  // record says it does not know why, and a record that names no version reads as a current one.
  for (const [version, reason] of [['sonah.code-pass/7', 'unknown'], ['sonah.code-pass/11', 'unknown'],
    ['sonah.code-pass/12', 'none_shown'], ['sonah.code-pass/13', 'none_shown']])
    assert.equal(codeNotReviewedOf(withoutManifest(pass({ ...EMPTY, version: { pass: version }, files: [FILES[0]] }))),
      reason, version);
  assert.equal(codeNotReviewedOf(CASES.find(([r]) => r === 'none_shown')[1]), 'none_shown');
  // D124's review: another repository given with --code-repo (a place marked `given`) reaches it too, a place the session
  // wrote to alone does not, and with no shell command the reason stays `no_write`.
  const place = (given) => ({ kind: 'git', at: '/work/app', written: 0, commit: COMMIT, changedOutside: [],
    ...(given ? { given: true } : {}) });
  const seen = (base, unseenEdits = true) => codeNotReviewedOf(withoutManifest(pass({ ...EMPTY, base,
    ...(unseenEdits ? { unseenEdits } : {}) })));
  assert.equal(seen({ kind: 'recorded_edits', written: 0, places: [place(true)] }), 'no_seen_write_given');
  assert.equal(seen({ kind: 'recorded_edits', written: 0, places: [place(false)] }), 'no_seen_write');
  assert.equal(seen({ kind: 'git', commit: COMMIT, written: 0, changedOutside: [], given: true }, false), 'no_write');
  // Its words never tell the person to give a repository again.
  assert.ok(!W.notReviewedReasons.no_seen_write_given.includes('run sonah review again'));
});

test('D118 (a): the first screen of the report .md, the page, the terminal and the PR comment says it once, with its '
  + 'one reason; never where code was reviewed', () => {
  const session = codeSession();
  for (const [reason, codePass] of CASES) {
    const r = report(codePass);
    const words = reason ? W.notReviewed(W.notReviewedReasons[reason]) : null;
    // The report .md: within its first 8 lines (the first screen), exactly once, with exactly one reason.
    const md = renderReportMarkdown(session, r, { folder: FOLDER });
    const head = unangled(md.split('\n').slice(0, 8).join('\n'));
    const body = md.split('\n').slice(8).join('\n');
    // The page: in its header, before the count line.
    const html = renderSessionPage(session, r, { folder: FOLDER });
    const header = textOf(html.slice(html.indexOf('<div class="content">'), html.indexOf('<p class="count">')));
    // The terminal: the run state, then the no-code line (as the CLI prints them).
    const model = reportModel(session, r, { folder: FOLDER });
    const terminal = [runStateLine(r), ...(model.header.noCode ? [noCodeText(model.header.noCode)] : [])].join('\n');
    // The PR comment: right after whether Sonah's review ran.
    const comment = publicCommentText(r).summary.split('\n\n').slice(0, 3).join('\n\n');
    if (!reason) {
      for (const text of [md, html, terminal, publicCommentText(r).summary])
        assert.doesNotMatch(text, /No code was reviewed/, 'code was reviewed');
      assert.doesNotMatch(runStateLine(r), /but no code/);
      continue;
    }
    assert.equal(count(head, 'No code was reviewed.'), 1, `${reason}: md first screen`);
    assert.ok(head.includes(words), `${reason}: md reason`);
    assert.equal(count(body, 'No code was reviewed.'), 0, `${reason}: said once`);
    assert.equal(count(header, 'No code was reviewed.'), 1, `${reason}: page header`);
    assert.ok(header.includes(words), `${reason}: page reason`);
    assert.equal(count(terminal, 'No code was reviewed.'), 1, `${reason}: terminal`);
    assert.ok(terminal.includes(words), `${reason}: terminal reason`);
    assert.equal(count(comment, 'No code was reviewed\\.'), 1, `${reason}: PR comment`);
    assert.ok(comment.includes(`Reason: ${W.notReviewedReasons[reason].replace(/[.'<>-]/g, (c) => (c === "'" ? c
      : c === '<' ? '&lt;' : c === '>' ? '&gt;' : `\\${c}`))}\\.`), `${reason}: PR comment reason`);
    // Exactly one closed reason on each first screen.
    for (const text of [head, header, terminal]) assert.equal(CODE_NOT_REVIEWED_REASONS
      .filter((other) => text.includes(`Reason: ${W.notReviewedReasons[other]}.`)).length, 1, `${reason}: one reason`);
    // The folder, where the code step looked in one: its path on the page and on the terminal; in the .md, its name
    // alone (the owner, 2026-10-19: "yes, folder name only"); never in the PR comment.
    const looked = !['step_off', 'backend'].includes(reason);
    assert.equal(head.includes('`project`'), looked, `${reason}: md folder name`);
    assert.ok(!md.includes(FOLDER), `${reason}: the md never holds the path`);
    assert.equal(header.includes(FOLDER), looked, `${reason}: page folder`);
    assert.equal(terminal.includes(FOLDER), looked, `${reason}: terminal folder`);
    assert.doesNotMatch(publicCommentText(r).summary, /work\/project|`project`/);
    // "complete" names what is missing.
    if (/^Sonah's review: complete/.test(runStateLine(r)))
      assert.match(runStateLine(r), /^Sonah's review: complete, but no code was reviewed \(/, reason);
  }
});

test('D118 (a), amended (the owner, 2026-10-19: "yes, folder name only"): `folderNameOf` gives the last segment of the '
  + 'path, the home folder itself as `~`, and nothing for the root', () => {
  // A synthetic home folder, by two spellings (as the environment gives it, and as the disk resolves it).
  const HOMES = ['/people/jdoe-synthetic', '/private/var/people/jdoe-synthetic/'];
  for (const [path, homes, name] of [
    ['/work/project', [], 'project'],
    ['/people/jdoe-synthetic/code/my-app', HOMES, 'my-app'],
    ['/people/jdoe-synthetic/code/my-app/', HOMES, 'my-app'],
    ['C:\\Users\\jdoe-synthetic\\code\\my-app', ['C:\\Users\\jdoe-synthetic'], 'my-app'],
    ['C:\\Users\\jdoe-synthetic', ['C:\\Users\\jdoe-synthetic'], HOME_FOLDER_NAME],
    // The home folder itself, by any of its spellings.
    ['/people/jdoe-synthetic', HOMES, HOME_FOLDER_NAME],
    ['/people/jdoe-synthetic/', HOMES, HOME_FOLDER_NAME],
    ['/private/var/people/jdoe-synthetic', HOMES, HOME_FOLDER_NAME],
    // With no home given, a folder is its name: the CLI always gives it.
    ['/people/jdoe-synthetic', [], 'jdoe-synthetic'],
    // A folder above the home is its name; so is a folder whose own name holds the user name (it is the folder's name).
    ['/people', HOMES, 'people'],
    ['/srv/jdoe-synthetic-site', HOMES, 'jdoe-synthetic-site'],
    ['/', HOMES, null], ['', HOMES, null], [null, HOMES, null], [42, HOMES, null],
    ['/work/project', 'not a list', 'project'], ['/', ['/'], null]])
    assert.equal(folderNameOf(path, homes), name, JSON.stringify([path, homes]));
  assert.equal(HOME_FOLDER_NAME, '~');
});

test('D118 (a), amended (the owner, 2026-10-19: "yes, folder name only"): the report .md names the folder by its name '
  + 'alone and never holds the home folder\'s path or the user name in it; the page and the terminal name the path; the '
  + 'PR comment names none', () => {
  const session = codeSession();
  const r = report(CASES.find(([reason]) => reason === 'no_file')[1]);
  const USER = 'jdoe-synthetic', HOME = `/people/${USER}`;
  for (const [folder, name] of [[`${HOME}/code/my-app`, 'my-app'], [HOME, HOME_FOLDER_NAME], ['/', null]]) {
    const md = renderReportMarkdown(session, r, { folder, homes: [HOME] });
    const head = md.split('\n').slice(0, 8).join('\n');
    const html = renderSessionPage(session, r, { folder, homes: [HOME] });
    const header = textOf(html.slice(html.indexOf('<div class="content">'), html.indexOf('<p class="count">')));
    const terminal = noCodeText(reportModel(session, r, { folder }).header.noCode);
    // The .md: the folder's name, last, as a code span; never the path, the home folder's path or the user name.
    if (name === null) assert.ok(!head.includes(W.notReviewedFolder('')), `${folder}: the root names no folder`);
    else assert.ok(head.includes(W.notReviewedFolder(`\`${name}\``)), `${folder}: md`);
    for (const part of [HOME, USER, `${HOME}/code`]) assert.ok(!md.includes(part), `${folder}: md holds ${part}`);
    // The page and the terminal stay on your computer: the path.
    assert.ok(header.includes(W.notReviewedFolder(folder)), `${folder}: page`);
    assert.ok(terminal.endsWith(W.notReviewedFolder(folder)), `${folder}: terminal`);
    const comment = publicCommentText(r).summary;
    for (const part of [folder === '/' ? 'Folder' : folder, USER, 'my-app']) assert.ok(!comment.includes(part), part);
  }
});

test('D122 (review lows of D118): one definition of "no code was reviewed", read by the report model, the terminal, the '
  + 'PR comment and the GitHub check\'s title, which never says finished without naming it', () => {
  const session = codeSession();
  const PR = { baseOid: 'c'.repeat(40), headOid: 'd'.repeat(40), number: 7, repo: { host: 'github.com', id: '42' },
    github: { owner: 'synthetic-owner', name: 'synthetic-repo', private: true } };
  // A combined pull request review (an earlier route) holds no code pass record: its own code review is its run words'.
  const combined = { ...report(undefined), reviewScope: 'combined', codeCoverage: 'complete' };
  const reports = [...CASES.map(([, codePass]) => report(codePass)), combined];
  for (const r of reports) {
    const reason = reportNotReviewedOf(r);
    const model = reportModel(session, r, { folder: FOLDER });
    assert.equal(model.header.noCode?.reason ?? null, reason, JSON.stringify(r.codePass ?? r.reviewScope));
    const run = publicCommentText(r).run;
    // "complete" names what is missing; an incomplete run says incomplete, and its code part says why.
    assert.equal(/but no code was reviewed/.test(runStateLine(r)), reason !== null && run === 'complete', runStateLine(r));
    assert.equal(/No code was reviewed/.test(publicCommentText(r).summary), reason !== null);
    const { check } = createPublicationPlan({ report: r, pr: PR });
    assert.equal(check.output.title, run === 'complete' ? (reason !== null ? CHECK_TITLES.completeNoCode
      : CHECK_TITLES.complete) : CHECK_TITLES.incomplete, String(reason));
  }
  assert.equal(reportNotReviewedOf(combined), null);
  assert.equal(reportModel(session, combined, {}).header.noCode, null);
  assert.equal(createPublicationPlan({ report: report(undefined), pr: PR }).check.output.title,
    'Sonah finished its advisory review, but no code was reviewed');
  assert.equal(createPublicationPlan({ report: report(CASES.at(-1)[1]), pr: PR }).check.output.title,
    'Sonah finished its advisory review');
});

// D133's review: the terminal's coverage line (D118 (a)'s "code pass reviewed no code" there) is gone; the run state
// line says it (the D118 (a) tests above).

/** A heredoc write the slicer parsed from a command (`shellWriteOf` names it), as d80-failed-writes.test.js builds one. */
function shellWrite(b, id, of, path, body) {
  b.blobs[`${id}-after`] = body;
  b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'heredoc', operation: 'write',
    paths: [{ path }], command: [], input: [], shellWriteOf: of, shellWriteStatusEligible: true,
    changes: [{ path, before: [], after: [{ sourceKey: `${id}-after`, fromByte: 0, untilByte: Buffer.byteLength(body) }],
      diff: [], extent: { chars: body.length, lines: 1, truncated: false, cap: null, recorded: false, redactedLines: 0,
        priorState: 'none' } }] });
}
/** One command that wrote four paths with a shell, three of them spelled with an expansion, and a structured write
 *  (a tool's own path) whose name holds a `$`. */
function shellSession() {
  const b = sessionBuilder();
  b.ask('I1', 'Write the scripts and the route.');
  b.run('C1', "cat > src/a.js <<'EOF' ...", 'succeeded');
  shellWrite(b, 'C1-w0', 'C1', 'src/a.js', 'export const a = 1;\n');
  shellWrite(b, 'C1-w1', 'C1', '$P/run.sh', 'echo run\n');
  shellWrite(b, 'C1-w2', 'C1', '/tmp/pub/${S}/notes.md', 'notes\n');
  shellWrite(b, 'C1-w3', 'C1', '$(pwd)/out.md', 'out\n');
  b.change('W1', 'app/routes/$id.tsx', { after: 'export default 1;\n' });
  return b.session();
}

test('D118 (b): a shell write spelled with an expansion is never a file of the change; a tool\'s own path is', () => {
  // The rule reads structure: the parent link and the shell's grammar, never a variable's name (the one rule D117
  // amended shares, code-context.js `unresolvedShellPaths`).
  const spelled = (paths, { tool = false } = {}) => {
    const b = sessionBuilder();
    b.ask('I1', 'Write the files.');
    b.run('C1', "cat > x <<'EOF' ...", 'succeeded');
    paths.forEach((path, at) => (tool ? b.change(`W${at}`, path, { after: 'x\n' })
      : shellWrite(b, `C1-w${at}`, 'C1', path, 'x\n')));
    return unresolvedShellPaths(b.session());
  };
  assert.deepEqual(spelled(['$ANY_NAME_AT_ALL/x.js', '`git rev-parse --show-toplevel`/x.js', 'a/$1/x.js', 'price$.txt']),
    ['$ANY_NAME_AT_ALL/x.js', '`git rev-parse --show-toplevel`/x.js', 'a/$1/x.js'], 'a lone $ expands to nothing else');
  assert.deepEqual(spelled(['$P/x.js'], { tool: true }), [], 'a structured write names its own path');
  const session = shellSession();
  const facts = storyFacts(session, {});
  assert.deepEqual(facts.whole.files.map((f) => f.path).sort(), ['app/routes/$id.tsx', 'src/a.js']);
  assert.deepEqual([...facts.whole.unresolvedPaths], ['$P/run.sh', '/tmp/pub/${S}/notes.md', '$(pwd)/out.md']);
  assert.deepEqual([...facts.whole.outsidePaths], []);
  // The code step's change list holds no such path; it counts them among the session's writes.
  assert.deepEqual(codeSnapshotPlan(session, { root: FOLDER }).map((e) => e.path).sort(), ['app/routes/$id.tsx',
    'src/a.js']);
  assert.deepEqual(unresolvedShellPaths(session), ['$P/run.sh', '/tmp/pub/${S}/notes.md', '$(pwd)/out.md']);
  // The report: two files, the header and the Files section alike; the three apart, in their own unit, as code spans.
  const model = reportModel(session, {}, {});
  assert.equal(model.header.changeFiles, 2);
  assert.equal(model.did.files.total, 2);
  assert.deepEqual(model.did.files.unresolved, { n: 3, paths: ['$P/run.sh', '/tmp/pub/${S}/notes.md', '$(pwd)/out.md'],
    more: 0 });
  const md = renderReportMarkdown(session, {}, {});
  assert.ok(md.includes('Sonah could not place 3 paths that the agent wrote, so it does not count them as files. As '
    + 'recorded, each holds a shell variable or the output of a command: `$P/run.sh`, `/tmp/pub/${S}/notes.md`, '
    + '`$(pwd)/out.md`.'), md);
  assert.match(md.split('\n').slice(0, 4).join('\n'), /2 files changed/);
  const html = textOf(renderSessionPage(session, {}, {}));
  assert.ok(html.includes('Sonah could not place 3 paths that the agent wrote'));
});

test('D122 (a), judgment call (4), its review: a write named from the home folder keeps D109\'s class in the story too — '
  + 'with no code step record it is counted among the writes outside the repository, never a file of the change, never a '
  + 'path not resolved', () => {
  // The slicer's write scope marks only the harness's home folders (~/.claude); a home spelling of any other file is the
  // shell's own grammar (code-context.js `HOME_SPELLED`), which the code step's snapshot places outside the repository.
  const b = sessionBuilder();
  b.ask('I1', 'Write the module and the notes.');
  b.run('C1', "cat > src/a.js <<'EOF' ...", 'succeeded');
  shellWrite(b, 'C1-w0', 'C1', 'src/a.js', 'export const a = 1;\n');
  shellWrite(b, 'C1-w1', 'C1', '$HOME/notes.md', 'notes\n');
  shellWrite(b, 'C1-w2', 'C1', '~/todo.md', 'todo\n');
  shellWrite(b, 'C1-w3', 'C1', '${HOME}/plan.md', 'plan\n');
  const session = b.session();
  assert.ok(session.events.every((e) => !(e.changes ?? []).some((c) => c.outsideRepository === true)),
    'premise: the recording marks none of them outside the repository');
  const facts = storyFacts(session, {});
  assert.deepEqual(facts.whole.files.map((f) => f.path), ['src/a.js']);
  assert.deepEqual([...facts.whole.outsidePaths], ['$HOME/notes.md', '~/todo.md', '${HOME}/plan.md']);
  assert.deepEqual([...facts.whole.unresolvedPaths], []);
  const model = reportModel(session, {}, {});
  assert.equal(model.header.changeFiles, 1);
  assert.equal(model.did.files.total, 1);
  assert.deepEqual(model.did.files.outside, { n: 3, paths: ['$HOME/notes.md', '~/todo.md', '${HOME}/plan.md'], more: 0,
    notInChange: false });
  assert.equal(model.did.files.unresolved, null);
  const md = renderReportMarkdown(session, {}, {});
  assert.match(md.split('\n').slice(0, 4).join('\n'), /1 file changed/);
  assert.ok(md.includes('The agent also changed 3 files outside the repository: `$HOME/notes.md`, `~/todo.md`, '
    + '`${HOME}/plan.md`.'), md);
});

test('D122, its review (low): the sentence of the paths not resolved is grammatical for one path as for many', () => {
  assert.equal(REPORT_DID_WORDS.unresolved(1, '`$P/run.sh`'), 'Sonah could not place 1 path that the agent wrote, so it '
    + 'does not count it as a file. As recorded, it holds a shell variable or the output of a command: `$P/run.sh`.');
  assert.equal(REPORT_DID_WORDS.unresolved(2, '`$P/a.sh`, `$P/b.sh`'), 'Sonah could not place 2 paths that the agent '
    + 'wrote, so it does not count them as files. As recorded, each holds a shell variable or the output of a command: '
    + '`$P/a.sh`, `$P/b.sh`.');
});

test('D118 (b): the code step counts such a path among the session\'s writes, so it never says the session wrote none',
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'sonah-d118-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const b = sessionBuilder();
    b.ask('I1', 'Write the script.');
    b.run('C1', "cat > $P/run.sh <<'EOF' ...", 'succeeded');
    shellWrite(b, 'C1-w0', 'C1', '$P/run.sh', 'echo run\n');
    const snapshot = await readCodeSnapshot(b.session(), { root, maxBytes: 1_000_000 });
    assert.deepEqual([snapshot.base.kind, snapshot.base.written, snapshot.plan.length], ['recorded_edits', 1, 0]);
    // So the change holds no file to review, and the reason is not that the recording shows no write.
    assert.equal(codeNotReviewedOf(pass({ ...EMPTY, manifest: undefined, base: snapshot.base })), 'no_file');
  });

test('D118 (c): the header\'s file count and the Files section count one list, on every shape of report', () => {
  const session = codeSession();
  const shapes = [
    ['no code step: the recorded writes', report(undefined)],
    ['git, a change with no file: git\'s empty list, never the recorded writes', report(CASES[5][1])],
    ['git, a change of files: the one tally', report(pass())],
    ['git, a record before the tally', report(withoutManifest(pass({ files: [...FILES, { path: 'x.md', state: 'shown' }] })))],
    ['no git, no change', report(withoutManifest(pass({ ...EMPTY, base: { kind: 'recorded_edits', written: 1 } })))],
  ];
  for (const [name, r] of shapes) {
    const model = reportModel(session, r, {});
    assert.equal(model.header.changeFiles, model.did.files.total, name);
    const part = model.header.size.find((p) => /\bfiles?\b/.test(p)) ?? null;
    const said = part === null ? 0 : Number(/(?:^a change of |^)(\d+) files?\b/.exec(part)[1]);
    assert.equal(said, model.did.files.total, `${name}: ${part}`);
  }
  // The dogfood's shape: files the recording wrote, git finds none of them changed: no "N files changed" beside 0.
  const gitEmpty = reportModel(session, report(CASES[5][1]), {});
  assert.ok(storyFacts(session, {}).whole.files.length > 0, 'premise: the recording wrote files');
  assert.equal(gitEmpty.header.size.some((p) => /\bfiles?\b/.test(p)), false);
  assert.equal(gitEmpty.did.files.total, 0);
});

/** A report whose only gaps are the given declarations. */
const gapsReport = (gaps) => ({ ...report(undefined), coverage: 'partial', gaps: gaps.map((g) => ({ scope: 'session',
  sessionKey: 'session', ...g })), coverageFacts: { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1,
  reviewableEvents: 3, instructions: 1, instructionsElided: 0, instructionsWithheld: 0, delegationsUnlinked: 0,
  adapterGaps: gaps.length, pairGaps: 0, declared: null } });
const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test('D119: the evidence Sonah holds in part is said one kind at a time, each in one unit, never summed', () => {
  const r = gapsReport([
    { code: 'incomplete_inventory', channel: 'children', count: 266, eventIds: ids('R', 26),
      note: WORKFLOW_RUN_GAP_NOTES.workflow_journal_unreadable },
    { code: 'incomplete_inventory', channel: 'children', count: 225, eventIds: ids('R', 25),
      note: WORKFLOW_RUN_GAP_NOTES.workflow_run_entry_unread },
    { code: 'incomplete_inventory', channel: 'children', count: 2, eventIds: ['U0', 'U1'],
      note: WORKFLOW_GAP_NOTES.agents },
    { code: 'incomplete_inventory', channel: 'children', count: 1, eventIds: ['L0'], note: WORKFLOW_GAP_NOTES.unlaunched },
    { code: 'incomplete_inventory', channel: 'actions', count: 2, eventIds: ['A0', 'A1'],
      note: CALL_INPUT_GAP_NOTES.input_unparsed },
    { code: 'incomplete_inventory', channel: 'actions', count: 2, eventIds: ['A1', 'A2'],
      note: CALL_INPUT_GAP_NOTES.workflow_script_unrecorded },
    { code: 'incomplete_inventory', channel: 'actions', count: null },
  ]);
  const causes = Object.fromEntries(coverageCauses(r));
  // Runs by their calls (the journal's count is its lines), each call once; calls by their events, each once.
  assert.deepEqual(causes.workflow_runs_unread, { n: 28 });
  assert.deepEqual(causes.workflow_entries_unread, { n: 225 });
  assert.deepEqual(causes.workflow_calls_unlaunched, { n: 1 });
  assert.deepEqual(causes.call_inputs_unread, { n: 3 });
  assert.deepEqual(causes.incomplete_inventory, { n: 1 });
  // D133's review: the causes as What Sonah could not check says them (the terminal's "Not covered" line is gone).
  const line = reportModel(codeSession(), r, {}).notChecked.facts.filter((f) => f.cause === true)
    .map((f) => f.parts.map((p) => p.text).join('')).join(' · ');
  assert.ok(line.includes('Sonah did not read 28 workflow runs or the recordings of their agents'), line);
  assert.ok(line.includes('Sonah did not read 225 other entries in the folders of workflow runs'), line);
  assert.ok(line.includes('Sonah holds 1 kind of evidence only in part'), line);
  assert.doesNotMatch(line, /\b(?:493|494|495|496|497|498|499|500)\b|parts of the evidence|evidence that Sonah read/);
  // The page names each kind once, in the same words.
  const html = textOf(renderSessionPage(codeSession(), r, {}));
  assert.ok(html.includes('Sonah did not read 28 workflow runs or the recordings of their agents'));
  assert.doesNotMatch(html, /parts of the evidence that Sonah read/);
  // "read" only of what Sonah read: no sentence of a kind Sonah did not read says that it read it.
  for (const cause of ['workflow_runs_unread', 'workflow_entries_unread', 'workflow_calls_unlaunched',
    'call_inputs_unread', 'incomplete_inventory'])
    assert.doesNotMatch(COVERAGE_SENTENCE[cause]({ n: 2 }), /Sonah read\b/, cause);
  assert.match(COVERAGE_SENTENCE.helper_captures_incomplete({ n: 2 }), /^Sonah read only part of 2 helper recordings$/);
});
