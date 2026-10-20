// D123 (2026-10-19, the beta.5 end-to-end smoke, E2E-B5-FINAL): the release fixes, each read from the code pass record's
// structure, never from words.
//
// (1) A session that started in a folder of no git repository and changed a sibling repository only through a script
// that a shell command ran (a Python heredoc writing absolute paths: the smoke's S1, the shape of the laksh session) has
// no recorded write, so the code step had no change to review. Every first screen then said "the recording shows no
// write of the session that could have changed a file" (`no_write`), and What the agent did said "0 files" and "Sonah
// found no file in the repository that the agent changed": a reader concluded that the session changed nothing, and no
// repository holds the start folder. The record says more: `base.written` 0, but `unseenEdits` (a shell command ran,
// code-pass.js `mayMissEdits`). Such a record now gives its own closed reason, `no_seen_write`, on every reader (the
// page, the .md, the terminal's run-state line, the PR comment, the GitHub check's title, through `reportNotReviewedOf`),
// and the Files section reads the same gate. `no_write` stays for a record with no shell command.
// (2) The troubleshooting guide's rows of these reasons never advise running the review from another folder: the code
// step reads the folder that the recording names, whatever folder the review runs in (shown here end to end).
// (3) The coverage line of a session review names the pull request's code review ("code missing") only where the run
// state line names it: a review whose effective scope is not session-only.
//
// Throwaway folders and repositories, synthetic sessions, a deterministic fake reviewer: no recording, no model, no
// network. Every commit date is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runSessionReviewCommand, RUN_STATE_WORDS, coverageSummaryLine, runStateLine }
  from '../src/session-review-command.js';
import { CODE_REPORT_WORDS, codeNotReviewedOf, codeCoverageLines, reportNotReviewedOf }
  from '../../evidence/src/code-report.js';
import { CODE_NOT_REVIEWED_REASONS } from '../../evidence/src/ledger.js';
import { REPORT_DID_WORDS, REPORT_SECTION_WORDS } from '../../render/report-words.js';
import { reportModel, REPORT_NO_FILES_KINDS } from '../../render/report-model.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { renderSessionPage } from '../../render/session-page.js';
import { publicCommentText, createPublicationPlan, escapePublicText, CHECK_TITLES } from '../../github/publication.js';
import { CODE_TEXT, buildCodeSession, codeJudge, sha256 } from './code-pass-fixture.js';

const W = CODE_REPORT_WORDS;
const START = '2030-01-01T00:00:00.000Z';
const END = '2030-01-02T00:00:00.000Z';
const T1 = { turn: 'T1' };
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
  GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' };
const PR = { baseOid: 'c'.repeat(40), headOid: 'd'.repeat(40), number: 7, repo: { host: 'github.com', id: '42' },
  github: { owner: 'synthetic-owner', name: 'synthetic-repo', private: true } };
const NO_ROWS = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
// D124: the reason names `<the repository's folder>`, which the .md and the page escape.
const plainText = (md) => md.replace(/\\(.)/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function folder(t, name) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `sonah-d123-${name}-`)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}
/** The smoke's S1 shape: a scratch folder in no repository (where the session started) beside a git repository `app`,
 *  whose files a script of the session changed (here: changed on the disk, as the script left them, uncommitted). */
async function laksh(t) {
  const base = await folder(t, 'ws');
  const sandbox = join(base, 'sandbox');
  const app = join(base, 'app');
  await put(sandbox, { 'scratch-notes.txt': 'notes\n' });
  await put(app, { 'src/money.js': 'export const cents = (n) => `$${(n / 100).toFixed(2)}`;\n' });
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base']])
    execFileSync('git', args, { cwd: app, env: GIT_ENV, stdio: 'pipe' });
  await put(app, { 'src/money.js': 'export const cents = (n) => `$${(n / 100).toLocaleString("en-US")}`;\n' });
  const recording = join(base, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n${JSON.stringify({ timestamp: END })}\n`);
  return { base, sandbox, app, recording };
}
/** A session that ran one shell command (a heredoc script that writes absolute paths it builds: no write the slicer can
 *  read from its text), or none with `command` false; it records no write. */
function scriptSession(key, app, { command = true } = {}) {
  const cmd = `python3 - <<'EOF'\nbase='${app}/'\nopen(base+'src/money.js','w').write(src)\nEOF`;
  const blobs = { ...CODE_TEXT, cmd };
  return buildCodeSession(key, blobs, [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    ...(command ? [{ id: 'B1', kind: 'invocation', callKey: 'B1', tool: 'Bash', operation: 'command', paths: [],
      command: [{ sourceKey: 'cmd', fromByte: 0, untilByte: Buffer.byteLength(cmd) }], input: [], changes: [], ...T1 },
    { id: 'B1-r', kind: 'observation', invocation: 'B1', blob: 'wrote', ...T1 }] : []),
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
}
/** One `sonah review --code-pass` run in `cwd`, of a recording whose working directory is `recorded`: the requests, the
 *  terminal, the story (.md) and the record. */
async function reviewFrom(t, { cwd, recorded, recording, session }) {
  const dir = await folder(t, 'run');
  const calls = [];
  let out = '';
  const output = join(dir, 'story.md');
  const state = join(dir, 'state');
  const code = await runSessionReviewCommand([recording, '--concurrency', '1', '--state-dir', state, '--format', 'md',
    '--output', output, '--no-open', '--code-pass'], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd,
    env: { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(dir, 'claude') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: recorded }),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return codeJudge({ narrative: NO_ROWS })(request);
    } });
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  return { code, calls, out, written: await readFile(output, 'utf8'), report };
}

test('D123 (1): a session that started in a folder of no repository and changed files only through a script never says '
  + 'that it wrote nothing: one closed reason on every reader, and the Files section by the same gate', async (t) => {
  const { sandbox, app, recording } = await laksh(t);
  const session = scriptSession('s-d123-laksh', app);
  const run = await reviewFrom(t, { cwd: sandbox, recorded: sandbox, recording, session });
  const { codePass } = run.report;
  // The record: no repository at the start folder, no recorded write, a shell command ran.
  assert.deepEqual([codePass.base.kind, codePass.base.written, codePass.unseenEdits], ['recorded_edits', 0, true]);
  assert.deepEqual(run.calls.filter((r) => /^code-/.test(r.label)), [], 'no code review call');
  assert.equal(codeNotReviewedOf(codePass), 'no_seen_write');
  assert.equal(reportNotReviewedOf(run.report), 'no_seen_write');
  const reason = W.notReviewed(W.notReviewedReasons.no_seen_write);
  const wroteNothing = W.notReviewedReasons.no_write;
  // The .md: the reason on its first screen, never the no-write one; the Files section says what Sonah does not see, and
  // its heading counts no files.
  const md = plainText(run.written);
  assert.ok(md.split('\n').slice(0, 8).join('\n').includes(reason), md);
  assert.ok(!md.includes(wroteNothing) && !md.includes(W.noWrite), md);
  assert.ok(md.includes(REPORT_DID_WORDS.noSeenFiles), md);
  assert.ok(!md.includes(REPORT_DID_WORDS.noFiles) && !md.includes(REPORT_DID_WORDS.noFilesHere), md);
  assert.ok(!md.includes('0 files'), md);
  assert.ok(md.includes(REPORT_SECTION_WORDS.didCounted(null, 1, 0, 0)), md);
  // The code review's lines: what Sonah found, after the sentence that such edits can be missing.
  assert.deepEqual(codeCoverageLines(codePass), [W.noSeenWrite]);
  assert.ok(md.includes(W.unseenEdits) && md.includes(W.noSeenWrite), md);
  // The terminal: the run-state line and the no-code line say the same reason.
  assert.ok(run.out.includes(`code review ${RUN_STATE_WORDS.codePass.noSeenWrite})`), run.out);
  assert.ok(!run.out.includes(RUN_STATE_WORDS.codePass.noWrite), run.out);
  assert.ok(run.out.includes(`${reason} Folder: ${sandbox}`), run.out);
  assert.ok(!run.out.includes(wroteNothing), run.out);
  // The page.
  const page = renderSessionPage(session, run.report, { folder: sandbox }).replace(/&#39;/g, '\'').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  assert.ok(page.includes(reason) && page.includes(REPORT_DID_WORDS.noSeenFiles), 'the page');
  assert.ok(!page.includes(wroteNothing) && !page.includes(REPORT_DID_WORDS.noFiles), 'the page');
  assert.ok(page.includes(REPORT_SECTION_WORDS.didCounted(null, 1, 0, 0)) && !page.includes('0 files'), 'the page');
  // The PR comment and the GitHub check's title.
  assert.ok(publicCommentText(run.report).summary.includes(escapePublicText(reason)));
  assert.match(runStateLine(run.report), /^Sonah's review: complete, but no code was reviewed/);
  assert.equal(createPublicationPlan({ report: run.report, pr: PR }).check.output.title, CHECK_TITLES.completeNoCode);
});

test('D123 (2): running the review from the repository the script changed changes nothing: the code step reads the '
  + 'folder the recording names', async (t) => {
  const { sandbox, app, recording } = await laksh(t);
  const run = await reviewFrom(t, { cwd: app, recorded: sandbox, recording,
    session: scriptSession('s-d123-from-app', app) });
  assert.equal(reportNotReviewedOf(run.report), 'no_seen_write');
  assert.ok(run.out.includes(`Folder: ${sandbox}`), run.out);
  assert.deepEqual(run.calls.filter((r) => /^code-/.test(r.label)), []);
});

test('D123 (1): with no shell command, `no_write` stays; the Files section names a repository only where the code '
  + 'step read a git base', async (t) => {
  const { sandbox, app, recording } = await laksh(t);
  const quiet = await reviewFrom(t, { cwd: sandbox, recorded: sandbox, recording,
    session: scriptSession('s-d123-quiet', app, { command: false }) });
  assert.equal(quiet.report.codePass.unseenEdits, undefined);
  assert.equal(reportNotReviewedOf(quiet.report), 'no_write');
  const md = plainText(quiet.written);
  assert.ok(md.includes(W.notReviewed(W.notReviewedReasons.no_write)), md);
  // A folder of no repository: the working directory, never "in the repository".
  assert.ok(md.includes(REPORT_DID_WORDS.noFilesHere) && !md.includes(REPORT_DID_WORDS.noFiles), md);
  assert.ok(md.includes(REPORT_SECTION_WORDS.didCounted(0, 0, 0, 0)), md);
  // A git base: in the repository.
  const inApp = await reviewFrom(t, { cwd: app, recorded: app, recording,
    session: scriptSession('s-d123-quiet-git', app, { command: false }) });
  assert.equal(inApp.report.codePass.base.kind, 'git');
  assert.ok(plainText(inApp.written).includes(REPORT_DID_WORDS.noFiles));
});

test('D123 (1): the Files section\'s sentence is one of its closed kinds, by the record alone', () => {
  const session = scriptSession('s-d123-model', '/work/app');
  const report = (codePass) => ({ pr: null, reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete',
    codeCoverage: 'missing', findings: [], requirements: [], ...(codePass ? { codePass } : {}) });
  const empty = (base, more = {}) => ({ ran: true, coverage: 'complete', gaps: [], files: [], base, withheld: [],
    footer: [], calls: { review: 0 }, ...more });
  const none = (codePass) => reportModel(session, report(codePass), {}).did.files.none;
  assert.deepEqual([none(empty({ kind: 'recorded_edits', written: 0 }, { unseenEdits: true })),
    none(empty({ kind: 'git', commit: 'b'.repeat(40), written: 0, changedOutside: [] }, { unseenEdits: true })),
    none(empty({ kind: 'git', commit: 'b'.repeat(40), written: 0, changedOutside: [] })),
    none(empty({ kind: 'recorded_edits', written: 0 })), none(undefined), none({ ran: false, gaps: [] })],
  ['unseen', 'unseen', 'repository', 'folder', 'repository', 'repository']);
  assert.ok(REPORT_NO_FILES_KINDS.includes(none(undefined)));
  // A file in the list: no sentence.
  assert.equal(reportModel(buildCodeSession('s-d123-w', { ...CODE_TEXT }, [
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 }]), report(undefined), {}).did.files.none,
  null);
  // The reason sits after `no_write` in the closed list, each reason once.
  assert.equal(CODE_NOT_REVIEWED_REASONS.indexOf('no_seen_write'), CODE_NOT_REVIEWED_REASONS.indexOf('no_write') + 1);
  // The .md's heading of What the agent did counts no file only for `unseen`.
  const md = renderReportMarkdown(session, report(empty({ kind: 'recorded_edits', written: 0 }, { unseenEdits: true })),
    {});
  assert.ok(md.includes(REPORT_SECTION_WORDS.didCounted(null, 1, 0, 0)), md);
});

test('D123 (2) docs/TROUBLESHOOTING.md: every reason has its row, none advises running the review from another folder, '
  + 'and the no-write rows never say that there is nothing to review', async () => {
  const doc = await readFile(new URL('../../../docs/TROUBLESHOOTING.md', import.meta.url), 'utf8');
  const rows = doc.split('\n').filter((line) => line.startsWith('  | ')).map((line) => line.slice(4).split(' | '));
  for (const reason of CODE_NOT_REVIEWED_REASONS)
    assert.equal(rows.filter(([cell]) => cell === W.notReviewedReasons[reason]).length, 1, reason);
  const rowOf = (reason) => rows.find(([cell]) => cell === W.notReviewedReasons[reason]).join(' | ');
  for (const reason of ['no_write', 'no_seen_write', 'no_written_change', 'no_file']) {
    assert.doesNotMatch(rowOf(reason), /run the review from|Nothing to review/i, reason);
  }
  assert.match(rowOf('no_seen_write'), /git status/);
  assert.doesNotMatch(doc, /run the review from (that|the) folder/i);
});

test('D123 (3): a session review\'s coverage line never names the pull request\'s code review; a combined review still '
  + 'does', () => {
  const pass = { ran: true, coverage: 'complete', gaps: [], files: [], base: { kind: 'git', commit: 'b'.repeat(40),
    written: 1, changedOutside: [] }, withheld: [], footer: [] };
  const session = { pr: null, reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete',
    codeCoverage: 'missing', findings: [], codePass: pass };
  assert.doesNotMatch(coverageSummaryLine(session), /\bcode (missing|complete|partial)\b/);
  assert.match(coverageSummaryLine(session), /code pass /);
  assert.doesNotMatch(coverageSummaryLine({ ...session, codePass: undefined }), /\bcode missing\b/);
  // The run-state line and the coverage line name the same parts.
  for (const scope of ['session-only', 'combined']) {
    const report = { ...session, reviewScope: scope };
    assert.equal(/\bcode (missing|complete|partial)\b/.test(coverageSummaryLine(report)),
      /pull request review/.test(runStateLine(report)), scope);
  }
  assert.match(coverageSummaryLine({ ...session, reviewScope: 'combined', codeCoverage: 'complete' }), /^Coverage: code complete;/);
});

// D123's review: the release note and INSTALL say what the code does. (a) Where the code review did not run (off, another
// reviewer, a working directory Sonah cannot read), the Files section has no record to read, so an empty one still says
// "in the repository" (judgment call 3 of D123): the note says so, never that it never does. (b) `--repo` chooses the
// session only; the code review reads the folder that the recording names, as test (2) above shows end to end.
const docText = async (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const sectionOf = (text, heading) => {
  const at = text.indexOf(heading);
  assert.ok(at >= 0, heading);
  return text.slice(at, text.indexOf('\n## ', at + 1));
};
const flatText = (text) => text.replace(/\s+/g, ' ');

test('D123\'s review: the release note says what an empty Files section says where the code review did not run',
  async () => {
  const session = scriptSession('s-d123-note', '/work/app');
  const none = (codePass) => reportModel(session, { pr: null, reviewScope: 'session-only', coverage: 'complete',
    sessionReview: 'complete', codeCoverage: 'missing', findings: [], requirements: [],
    ...(codePass ? { codePass } : {}) }, {}).did.files.none;
  // No code step record, or one that did not run: the repository's words, as before.
  assert.deepEqual([none(undefined), none({ ran: false, gaps: [] })], ['repository', 'repository']);
  const note = sectionOf(await docText('CHANGELOG.md'), '## 0.3.0-beta.5');
  const bullet = note.split('\n- ').map(flatText).find((part) => part.includes('"in the working directory"')) ?? '';
  assert.ok(bullet, 'the note\'s bullet on the working directory');
  assert.ok(!/never "in the repository"/.test(bullet), 'the note says that the repository is never named');
  assert.ok(bullet.includes('When the code review did not run'), 'the note names the case of no code review');
  assert.ok(bullet.includes(`"${REPORT_DID_WORDS.noFiles.replace(/\.$/, '')}"`), 'the note quotes the words it keeps');
});

test('D123\'s review: every line of the release note is wrapped as the rest of it (120 characters)', async () => {
  const note = sectionOf(await docText('CHANGELOG.md'), '## 0.3.0-beta.5');
  assert.deepEqual(note.split('\n').map((line, i) => [i, line.length]).filter(([, n]) => n > 120), []);
});

test('D123\'s review: docs/INSTALL.md says that `--repo` chooses the session only, and names the code review\'s folder '
  + 'among the known limits', async () => {
  const install = await docText('docs/INSTALL.md');
  const repoLine = flatText(install.slice(install.indexOf('- `--repo DIR`:'), install.indexOf('\n- A recording path:')));
  assert.ok(repoLine.includes('the code review still reads the folder that the recording names'), repoLine);
  const limits = flatText(sectionOf(install, '## Known limits'));
  const troubleshooting = flatText(await docText('docs/TROUBLESHOOTING.md'));
  for (const words of ['not the folder that you run `sonah review` in', '`--code-repo`']) {
    assert.ok(limits.includes(words) && troubleshooting.includes(words), words);
  }
  // D124: the option is there, so neither says that it is not.
  for (const text of [limits, troubleshooting]) assert.ok(!text.includes('no option yet'), 'no option yet');
  assert.ok(limits.includes('`git status` and `git diff`'), 'what you can do');
});
