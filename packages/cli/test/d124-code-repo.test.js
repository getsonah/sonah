// D124 (2026-10-20; the owner: "you can do this now, on my laptop to test it"): the --code-repo option. A session can change a git repository with no write that the recording shows (a script that writes
// the paths it builds, a write after a `cd`) and start in a folder that no git repository holds (the smoke's S1, the
// laksh session): the code step then had no change to review, and nothing pointed it at the repository. `sonah review
// --code-repo DIR` (more than once allowed) makes the git working tree that holds DIR a place of the change by D117's
// rules, as if the session had written there: its base the session's start commit there (`startCommit`, the same code
// path), its change the files its recorded writes there could have changed and those whose last change came while the
// session ran (D113's window, unrecorded), the other files that differ there outside the evaluated session; the code
// review and its checks read it (`--add-dir`), and the readers name it with its count of files. A folder that is not
// there, or in no git working tree, is a closed error before anything is read or sent. Without the flag, every request
// byte and every report byte are as before. D124's review (its medium): a review that still had no change to review
// after a repository was given (one that holds no file of the change, or the working folder's own repository, read by
// its own rule) never tells the person to give one again: its reason is `no_seen_write_given`, and the page and the .md
// say how the working folder's own repository is read.
//
// Throwaway folders and repositories, synthetic sessions, a deterministic fake reviewer: no recording, no model, no
// network. Every commit date and every file time that a rule reads is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runSessionReviewCommand, parseSessionReviewArgs, REVIEW_FIX_WORDS, sessionReviewUsage }
  from '../src/session-review-command.js';
import { codeRepoTop, readCodeSnapshot } from '../src/code-snapshot.js';
import { CODE_REPORT_WORDS, codePlaceLines, reportNotReviewedOf } from '../../evidence/src/code-report.js';
import { publicCommentText } from '../../github/publication.js';
import { REPORT_DID_WORDS } from '../../render/report-words.js';
import { placesOf } from '../../evidence/src/code-pass.js';
import { CLI_SAFE_ERROR_CODES, CODE_REPO_PROBLEMS } from '../../evidence/src/ledger.js';
import { renderSessionPage } from '../../render/session-page.js';
import { CODE_TEXT, buildCodeSession, codeJudge, sha256 } from './code-pass-fixture.js';

const W = CODE_REPORT_WORDS;
const START = '2030-01-01T00:00:00.000Z';
const END = '2030-01-02T00:00:00.000Z';
/** Inside the session's recorded window, and after it. */
const DURING = new Date('2030-01-01T12:00:00.000Z');
const LATER = new Date('2030-01-03T00:00:00.000Z');
const T1 = { turn: 'T1' };
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
  GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' };
const NO_ROWS = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
const plainText = (md) => md.replace(/\\(.)/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'pipe' }).toString().trim();

async function folder(t, name) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `sonah-d124-${name}-`)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function put(root, files, time = null) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
    if (time) await utimes(join(root, path), time, time);
  }
}
/**
 * The smoke's S1 shape: a scratch folder in no repository (`sandbox`, where the session started) beside a git repository
 * `app` (one commit, dated before the session). A script of the session changed `src/money.js` and added `src/rate.js`
 * there while the session ran (their times inside the window); `docs/later.md` changed after the session ended (outside
 * the evaluated session); `README.md` did not change.
 */
async function laksh(t) {
  const base = await folder(t, 'ws');
  const sandbox = join(base, 'sandbox');
  const app = join(base, 'app');
  await put(sandbox, { 'scratch-notes.txt': 'notes\n' });
  await put(app, { 'src/money.js': 'export const cents = (n) => `$${(n / 100).toFixed(2)}`;\n',
    'docs/later.md': '# Later\n', 'README.md': '# app\n' });
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base']]) git(app, ...args);
  await put(app, { 'src/money.js': 'export const cents = (n) => `$${(n / 100).toLocaleString("en-US")}`;\n',
    'src/rate.js': 'export const rate = 0.2;\n' }, DURING);
  await put(app, { 'docs/later.md': '# Later\n\nWritten after the session.\n' }, LATER);
  const recording = join(base, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n${JSON.stringify({ timestamp: END })}\n`);
  return { base, sandbox, app, recording };
}
/** A session that ran one shell command (a heredoc script that writes absolute paths it builds: no write the slicer
 *  can read from its text); it records no write. */
function scriptSession(key, app) {
  const cmd = `python3 - <<'EOF'\nbase='${app}/'\nopen(base+'src/money.js','w').write(src)\nEOF`;
  const blobs = { ...CODE_TEXT, cmd };
  return buildCodeSession(key, blobs, [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'B1', kind: 'invocation', callKey: 'B1', tool: 'Bash', operation: 'command', paths: [],
      command: [{ sourceKey: 'cmd', fromByte: 0, untilByte: Buffer.byteLength(cmd) }], input: [], changes: [], ...T1 },
    { id: 'B1-r', kind: 'observation', invocation: 'B1', blob: 'wrote', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
}
/** The review agent reads each file of `app`'s change whole, by its absolute path, and proposes nothing. */
const readsApp = (app, files) => () => ({ numTurns: 1, toolCalls: { Read: files.length, Grep: 0, Glob: 0,
  StructuredOutput: 1 }, reads: files.map(([path]) => join(app, path)), readRanges: files.map(([path, lines]) => ({
  path: join(app, path), startLine: 1, numLines: lines, totalLines: lines })), readsUnranged: 0, readsUnrangedPaths: [],
readsFailed: [] });
/** One `sonah review --code-pass` run in `cwd` of a recording whose working directory is `recorded`, with `extra`
 *  arguments: the exit code, the requests, the terminal, the error stream, the story (.md), the record and what
 *  `readCode` was given. */
async function reviewFrom(t, { cwd, recorded, recording, session, extra = [], judge = null }) {
  const dir = await folder(t, 'run');
  const calls = [], read = [];
  let out = '', err = '';
  const output = join(dir, 'story.md');
  const state = join(dir, 'state');
  const answer = judge ?? codeJudge({ narrative: NO_ROWS, review: () => ({ findings: [], questions: [] }) });
  const code = await runSessionReviewCommand([recording, '--concurrency', '1', '--state-dir', state, '--format', 'md',
    '--output', output, '--no-open', '--code-pass', ...extra], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: (text) => { err += text; } }, cwd,
    env: { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(dir, 'claude') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: recorded }),
    readCode: async (...args) => { read.push(args); return readCodeSnapshot(...args); },
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return answer(request);
    } });
  let report = null, written = null;
  try { report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8')); } catch { report = null; }
  try { written = await readFile(output, 'utf8'); } catch { written = null; }
  return { code, calls, out, err, written, report, read, state };
}
const codeCalls = (run) => run.calls.filter((r) => /^code-/.test(r.label ?? ''));

test('D124: a session that started in a folder of no repository and changed a repository only through a script — '
  + 'without --code-repo no code is reviewed and the reason names the way out; with it, that repository\'s change is '
  + 'reviewed as a place of the change', async (t) => {
  const { sandbox, app, recording } = await laksh(t);
  const session = scriptSession('s-d124-laksh', app);
  // Without the flag: no code-review call, and the first screen's reason names --code-repo.
  const before = await reviewFrom(t, { cwd: sandbox, recorded: sandbox, recording, session });
  assert.equal(before.code, 0, before.err);
  assert.deepEqual(codeCalls(before), [], 'no code review call');
  assert.equal(reportNotReviewedOf(before.report), 'no_seen_write');
  assert.equal(before.report.codePass.base.places, undefined, 'no place');
  const reason = W.notReviewed(W.notReviewedReasons.no_seen_write);
  assert.ok(reason.includes('run sonah review again with --code-repo <the repository\'s folder>.'), reason);
  assert.ok(plainText(before.written).split('\n').slice(0, 8).join('\n').includes(reason), before.written);
  assert.ok(before.out.includes(reason), before.out);
  assert.ok(!Object.hasOwn(before.read[0][1], 'codeRepos'), 'readCode is given no codeRepos');

  // With --code-repo app (any folder in it names the same repository).
  const commit = git(app, 'rev-parse', 'HEAD');
  for (const given of [app, join(app, 'src')]) {
    const run = await reviewFrom(t, { cwd: sandbox, recorded: sandbox, recording, session, extra: ['--code-repo', given],
      judge: codeJudge({ narrative: NO_ROWS, review: () => ({ findings: [], questions: [] }),
        run: readsApp(app, [['src/money.js', 1], ['src/rate.js', 1]]) }) });
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(run.read[0][1].codeRepos, [app], 'readCode is given the repository\'s top folder');
    const { codePass } = run.report;
    // The record: the given repository is a place, from the session's start commit there, holding the two files whose
    // last change came while the session ran, each unrecorded; the file changed after the session is outside it.
    assert.deepEqual(codePass.base.places, [{ kind: 'git', at: app, written: 0, commit, how: 'reflog',
      changedOutside: [join(app, 'docs/later.md')], given: true }]);
    assert.deepEqual(codePass.base.written, 0);
    assert.deepEqual(codePass.files.map((f) => [f.path, f.place, f.type, f.state]), [
      [join(app, 'src/money.js'), app, 'modified', 'shown'], [join(app, 'src/rate.js'), app, 'added', 'shown']]);
    assert.deepEqual(codePass.manifest.review.files.map((f) => [f.path, f.place, f.recorded]), [
      [join(app, 'src/money.js'), app, false], [join(app, 'src/rate.js'), app, false]]);
    assert.deepEqual(codePass.manifest.review.outsideFiles.map((f) => [f.path, f.place]),
      [[join(app, 'docs/later.md'), app]]);
    assert.equal(reportNotReviewedOf(run.report), null, 'code was reviewed');
    // The requests: one review agent and its checks, each reading the repository beside the working directory.
    const asked = codeCalls(run);
    assert.ok(asked.some((r) => r.label === 'code-review:agent'), asked.map((r) => r.label).join());
    for (const request of asked) assert.deepEqual([request.agent.root, request.agent.addDirs], [sandbox, [app]], request.label);
    const prompt = asked.find((r) => r.label === 'code-review:agent').prompt;
    assert.ok(prompt.includes(`- ${app}: a git repository; its change runs from ${commit}, the commit where it stood `
      + 'when the session started, to the files now'), prompt);
    assert.ok(prompt.includes(join(app, 'src/money.js')) && prompt.includes('toLocaleString'), 'the change is sent');
    assert.ok(prompt.includes('Written after the session.'), 'the file outside the evaluated session is given apart');
    assert.ok(!prompt.includes('# app'), 'an unchanged file is not sent');
    // The readers: no "No code was reviewed", the place's line with its count and the window's words, the file
    // outside the evaluated session named.
    const md = plainText(run.written);
    assert.ok(!md.includes('No code was reviewed.'), md);
    assert.ok(md.includes(W.placeBase(app, commit, 2, 2)), md);
    assert.ok(md.includes(join(app, 'docs/later.md')), md);
    assert.ok(run.out.includes('It also reads one other folder that holds files of the change.'), run.out);
    assert.ok(!run.out.includes('No code was reviewed.'), run.out);
  }
  // The dry run names the repository, its files of the change and what it gives apart; nothing is sent.
  const dry = await reviewFrom(t, { cwd: sandbox, recorded: sandbox, recording, session,
    extra: ['--dry-run', '--code-repo', app] });
  assert.deepEqual([dry.code, dry.calls], [0, []]);
  assert.ok(dry.out.includes(`2 of the paths lie in ${app}, a git repository whose change runs from its commit `
    + `${commit.slice(0, 12)}. The change holds 2 files there. 1 more path changed there outside this session's recorded `
    + 'writes'), dry.out);
});

test('D124: a given repository with nothing that changed while the session ran is named with its count; the files '
  + 'changed after it are outside the evaluated session; no code review runs', async (t) => {
  const { sandbox, app, recording } = await laksh(t);
  // The script's files last changed after the session: nothing of app is part of the change.
  for (const path of ['src/money.js', 'src/rate.js']) await utimes(join(app, path), LATER, LATER);
  const run = await reviewFrom(t, { cwd: sandbox, recorded: sandbox, recording,
    session: scriptSession('s-d124-none', app), extra: ['--code-repo', app] });
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(codeCalls(run), []);
  const commit = git(app, 'rev-parse', 'HEAD');
  const [place] = run.report.codePass.base.places;
  assert.deepEqual([place.at, place.given, place.changedOutside], [app, true,
    ['docs/later.md', 'src/money.js', 'src/rate.js'].map((p) => join(app, p))]);
  // D124's review (its medium): the reason says what Sonah found in the repository given, and never tells the person to
  // give it again — on the terminal, the .md, the page and the PR comment.
  assert.equal(reportNotReviewedOf(run.report), 'no_seen_write_given');
  const reason = W.notReviewed(W.notReviewedReasons.no_seen_write_given);
  assert.ok(run.out.includes(reason), run.out);
  assert.ok(plainText(run.written).split('\n').slice(0, 8).join('\n').includes(reason), run.written);
  const firstPage = renderSessionPage(scriptSession('s-d124-none', app), run.report, { folder: sandbox })
    .replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
  assert.ok(firstPage.includes(reason), 'the page');
  const comment = plainText(publicCommentText(run.report).summary);
  assert.ok(comment.includes('repositories that you gave with --code-repo'), comment);
  for (const [where, text] of [['terminal', run.out], ['md', plainText(run.written)], ['page', firstPage],
    ['comment', comment]]) assert.ok(!text.includes('--code-repo <the repository'), `${where}: no way out again`);
  // The place's line says what Sonah found there, none included, before the files named apart.
  const lines = codePlaceLines(run.report.codePass);
  assert.equal(lines[0], W.placeBase(app, commit, 0));
  assert.match(lines[0], /The change holds 0 files there\.$/);
  assert.ok(plainText(run.written).includes(W.placeBase(app, commit, 0)), run.written);
  const page = renderSessionPage(scriptSession('s-d124-none', app), run.report, { folder: sandbox })
    .replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'').replace(/\s+/g, ' ');
  assert.ok(page.includes(W.placeBase(app, commit, 0)), 'the page names it too');
  // Without the mark, a place with no file of the change has no base line (D113's review), as before.
  const unmarked = { ...run.report.codePass, base: { ...run.report.codePass.base,
    places: run.report.codePass.base.places.map(({ given, ...p }) => p) } };
  assert.ok(!codePlaceLines(unmarked).some((line) => line.startsWith(`In ${app}, the change runs`)));
});

test('D124: a given repository that the session also wrote to is one place; the working folder\'s own repository is '
  + 'not made a place again; each repository is named once', async (t) => {
  const { base, sandbox, app, recording } = await laksh(t);
  // A second repository, with a recorded write there and a file changed by a script while the session ran.
  const lib = join(base, 'lib');
  await put(lib, { 'src/text.js': 'export const a = 1;\n', 'src/other.js': 'export const b = 1;\n' });
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base']]) git(lib, ...args);
  await put(lib, { 'src/text.js': 'export const a = 2;\n', 'src/other.js': 'export const b = 2;\n' }, DURING);
  const body = 'export const a = 2;\n';
  const session = buildCodeSession('s-d124-two', { ...CODE_TEXT, body }, [{ id: 'I1', kind: 'instruction', blob: 'ask',
    ...T1 }, { id: 'W1', kind: 'invocation', write: join(lib, 'src/text.js'), blob: 'body', ...T1 },
  { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
  { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
  const snapshot = (codeRepos) => readCodeSnapshot(session, { root: sandbox, maxBytes: 1_000_000, recording,
    ...(codeRepos ? { codeRepos } : {}) });
  // Without the flag: lib is a place by its recorded write (D117), with its other file kept by the window; app is none.
  const plain = await snapshot(null);
  assert.deepEqual(plain.base.places.map((p) => [p.at, p.given]), [[lib, undefined]]);
  // With both given: lib keeps its recorded write and is marked; app is added; the readers' order holds.
  const both = await snapshot([lib, app]);
  assert.deepEqual(both.base.places.map((p) => [p.at, p.written, p.given]), [[app, 0, true], [lib, 1, true]]);
  const byPlace = (s, at) => s.files.filter((f) => f.place === at && f.diff !== undefined)
    .map((f) => [f.path, f.recorded]);
  assert.deepEqual(byPlace(both, lib), byPlace(plain, lib), 'lib\'s change is the same, given or not');
  assert.deepEqual(byPlace(both, app), [[join(app, 'src/money.js'), false], [join(app, 'src/rate.js'), false]]);
  assert.deepEqual(both.folders, [app, lib], 'the agents read both');
  // The working folder's own repository given: nothing moves but the mark on its base (D124's review: `given`), which
  // says that the person gave it.
  const own = await readCodeSnapshot(session, { root: app, maxBytes: 1_000_000, recording, codeRepos: [app] });
  const ownPlain = await readCodeSnapshot(session, { root: app, maxBytes: 1_000_000, recording });
  assert.equal(own.base.given, true);
  assert.equal(ownPlain.base.given, undefined);
  assert.deepEqual(JSON.stringify({ ...own, base: { ...own.base, given: undefined } }), JSON.stringify(ownPlain));
  // Through the CLI, the same repository given twice (by two of its folders) is read once.
  const run = await reviewFrom(t, { cwd: sandbox, recorded: sandbox, recording, session: scriptSession('s-d124-twice', app),
    extra: ['--code-repo', app, '--code-repo', join(app, 'src')] });
  assert.deepEqual(run.read[0][1].codeRepos, [app]);
  assert.deepEqual(placesOf(run.report.codePass.base).map((p) => p.at), [app]);
});

/**
 * D124's review (its medium, shape b): a repository `mono` whose working directory is its folder `packages/a`. A script of
 * the session changed `changed` while the session ran: `packages/b/x.js` (outside the working directory) or
 * `packages/a/index.js` (inside it).
 */
async function mono(t, changed) {
  const base = await folder(t, 'mono');
  const top = join(base, 'mono');
  const cwd = join(top, 'packages/a');
  await put(top, { 'packages/a/index.js': 'export const a = 1;\n', 'packages/b/x.js': 'export const x = 1;\n' });
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base']]) git(top, ...args);
  await put(top, { [changed]: 'export const changed = 2;\n' }, DURING);
  const recording = join(base, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n${JSON.stringify({ timestamp: END })}\n`);
  return { top, cwd, recording };
}
const pageText = (session, report, folder) => renderSessionPage(session, report, { folder }).replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const WAY_OUT = '--code-repo <the repository';

test('D124\'s review: the working folder\'s own repository given — a script\'s change elsewhere in it stays unread, no '
  + 'reader tells the person to give it again, and the page, the .md and the dry run say how it is read', async (t) => {
  const { top, cwd, recording } = await mono(t, 'packages/b/x.js');
  const session = scriptSession('s-d124-mono', top);
  // Without the flag: the reason names the way out, and the base is not marked.
  const before = await reviewFrom(t, { cwd, recorded: cwd, recording, session });
  assert.equal(before.code, 0, before.err);
  assert.equal(reportNotReviewedOf(before.report), 'no_seen_write');
  assert.equal(before.report.codePass.base.given, undefined);
  assert.ok(before.out.includes(WAY_OUT), before.out);
  assert.ok(!plainText(before.written).includes(W.givenHere), 'no line of a repository given');
  // With it (by its top folder, or by the working directory itself): the base is marked, no place is made, no code is
  // reviewed, and the reason says what Sonah found in the repositories given, with no way out.
  const reason = W.notReviewed(W.notReviewedReasons.no_seen_write_given);
  for (const given of [top, cwd]) {
    const run = await reviewFrom(t, { cwd, recorded: cwd, recording, session, extra: ['--code-repo', given] });
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(codeCalls(run), [], given);
    assert.deepEqual(run.read[0][1].codeRepos, [top], given);
    const { base } = run.report.codePass;
    assert.deepEqual([base.given, base.places], [true, undefined], given);
    assert.equal(reportNotReviewedOf(run.report), 'no_seen_write_given', given);
    const md = plainText(run.written);
    const page = pageText(session, run.report, cwd);
    const comment = plainText(publicCommentText(run.report).summary);
    assert.ok(run.out.includes(reason) && md.split('\n').slice(0, 8).join('\n').includes(reason)
      && page.includes(reason), given);
    for (const [where, text] of [['terminal', run.out], ['md', md], ['page', page], ['comment', comment]])
      assert.ok(!text.includes(WAY_OUT), `${given}, ${where}: no way out again`);
    // The Files section says what Sonah does not see, as with no repository given (never "0 files").
    assert.ok(md.includes(REPORT_DID_WORDS.noSeenFiles) && page.includes(REPORT_DID_WORDS.noSeenFiles), given);
    // The page and the .md say that the person gave it and how Sonah reads it.
    assert.deepEqual(codePlaceLines(run.report.codePass), [W.givenHere]);
    assert.ok(md.includes(W.givenHere) && page.includes(W.givenHere), given);
  }
  // The dry run says it too.
  const dry = await reviewFrom(t, { cwd, recorded: cwd, recording, session, extra: ['--dry-run', '--code-repo', top] });
  assert.deepEqual([dry.code, dry.calls], [0, []]);
  assert.ok(dry.out.includes(W.givenHere), dry.out);
});

test('D124\'s review: the working folder\'s own repository given, with a change to review — every request is the one '
  + 'without it, and the report says how it is read', async (t) => {
  const { top, cwd, recording } = await mono(t, 'packages/a/index.js');
  const session = scriptSession('s-d124-mono-a', top);
  const runs = [];
  for (const extra of [[], ['--code-repo', top]]) runs.push(await reviewFrom(t, { cwd, recorded: cwd, recording, session,
    extra }));
  const [plain, given] = runs;
  for (const run of runs) assert.equal(run.code, 0, run.err);
  assert.equal(reportNotReviewedOf(given.report), null, 'code was reviewed');
  assert.ok(codeCalls(given).some((r) => r.label === 'code-review:agent'), 'a code review call');
  // Each run's own folder named by role, so the two runs' requests compare byte for byte.
  const bytes = (run) => JSON.stringify(run.calls.map((r) => [r.label ?? null, r.system ?? null, r.prompt ?? null,
    r.agent ? [r.agent.root, r.agent.addDirs] : null])).split(dirname(run.state)).join('<run>');
  assert.equal(bytes(given), bytes(plain));
  assert.ok(plainText(given.written).includes(W.givenHere), given.written);
  assert.ok(!plainText(plain.written).includes(W.givenHere), plain.written);
});

test('D124: a folder that is not there, a file, a folder in no git working tree and a folder inside .git are closed '
  + 'errors before anything is read or sent', async (t) => {
  const { base, sandbox, app, recording } = await laksh(t);
  const session = scriptSession('s-d124-errors', app);
  await put(base, { 'note.txt': 'a file\n' });
  const cases = [[join(base, 'missing'), 'code_repo_not_found'], [join(base, 'note.txt'), 'code_repo_not_found'],
    [sandbox, 'code_repo_not_git'], [join(app, '.git'), 'code_repo_not_git']];
  for (const [given, problem] of cases) {
    assert.deepEqual(await codeRepoTop(given), { problem }, given);
    for (const extra of [['--code-repo', given], ['--code-repo', app, '--code-repo', given]]) {
      const run = await reviewFrom(t, { cwd: sandbox, recorded: sandbox, recording, session, extra });
      assert.equal(run.code, 2, `${given}: exit 2`);
      assert.equal(run.err, `Review could not complete: ${problem}.\nFix: ${REVIEW_FIX_WORDS[problem]}\n`, given);
      assert.deepEqual([run.calls, run.read, run.report], [[], [], null], `${given}: nothing read or sent`);
      assert.ok(!(await readdir(run.state).catch(() => [])).length, `${given}: nothing written`);
    }
    // The dry run stops the same way.
    const dry = await reviewFrom(t, { cwd: sandbox, recorded: sandbox, recording, session,
      extra: ['--dry-run', '--code-repo', given] });
    assert.equal(dry.code, 2, `${given}: the dry run`);
  }
  // Relative to the folder the review runs in.
  assert.deepEqual(await codeRepoTop(join(app, 'src')), { top: app });
  const relative = await reviewFrom(t, { cwd: base, recorded: sandbox, recording, session,
    extra: ['--dry-run', '--code-repo', 'app/src'] });
  assert.equal(relative.code, 0, relative.err);
  assert.deepEqual(relative.read[0][1].codeRepos, [app]);
  // The codes are closed: each one the review prints by name, each with its own fix.
  assert.deepEqual(CODE_REPO_PROBLEMS, ['code_repo_not_found', 'code_repo_not_git']);
  for (const problem of CODE_REPO_PROBLEMS) {
    assert.ok(CLI_SAFE_ERROR_CODES.includes(problem), problem);
    assert.ok(Object.hasOwn(REVIEW_FIX_WORDS, problem), problem);
  }
});

test('D124: --code-repo on the command line: a value each time, more than once, never with --no-code-pass; the help '
  + 'names it', () => {
  assert.deepEqual(parseSessionReviewArgs(['r.jsonl', '--code-repo', 'a', '--code-repo', '../b']).codeRepos, ['a', '../b']);
  assert.equal(parseSessionReviewArgs(['r.jsonl']).codeRepos, undefined);
  for (const [argv, problem] of [[['--code-repo'], '--code-repo needs a value'],
    [['--code-repo', '--dry-run'], '--code-repo needs a value'],
    [['--code-repo', 'a', '--no-code-pass'], '--code-repo is not used with --no-code-pass']]) {
    assert.throws(() => parseSessionReviewArgs(argv), (error) => error.code === 'usage' && error.problem === problem,
      argv.join(' '));
  }
  assert.ok(parseSessionReviewArgs(['--code-repo', 'a', '--code-pass']).codeRepos);
  assert.ok(sessionReviewUsage.includes('--code-repo DIR'));
  assert.ok(sessionReviewUsage.split('\n').every((line) => line.length <= 80));
});

// The documents say what the option does, where the person reads it.
const docText = async (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const flatText = (text) => text.replace(/\s+/g, ' ');
const sectionOf = (text, heading) => {
  const at = text.indexOf(heading);
  assert.ok(at >= 0, heading);
  const next = text.indexOf(`\n${heading.match(/^#+/)[0]} `, at + 1);
  return text.slice(at, next < 0 ? undefined : next);
};

test('D124: TROUBLESHOOTING, INSTALL, PRIVACY and the release note name --code-repo and its errors', async () => {
  const troubleshooting = await docText('docs/TROUBLESHOOTING.md');
  const row = troubleshooting.split('\n').find((line) => line.startsWith(`  | ${W.notReviewedReasons.no_seen_write} | `));
  assert.ok(row && row.slice(4).split(' | ')[1].includes('`--code-repo`'), 'the no_seen_write row says what to run');
  for (const problem of CODE_REPO_PROBLEMS)
    assert.ok(troubleshooting.includes(`**\`Review could not complete: ${problem}.\`** (exit 2)`), problem);
  assert.ok(troubleshooting.includes('**`--code-repo DIR`**'), 'the option has its entry');
  const install = await docText('docs/INSTALL.md');
  assert.ok(flatText(sectionOf(install, '### A repository that the recording does not show the session changing'))
    .includes('sonah review --code-repo ~/code/app'), 'the usage');
  assert.ok(flatText(sectionOf(install, '## Known limits')).includes('unless you add `--code-repo`'), 'the known limit');
  assert.ok(flatText(await docText('docs/PRIVACY.md')).includes('With `--code-repo DIR`'), 'what it reads');
  const note = sectionOf(await docText('CHANGELOG.md'), '## 0.3.0-beta.5');
  assert.ok(note.includes('### Point the code review at a repository with `--code-repo`'), 'the release note');
  assert.deepEqual(note.split('\n').filter((line) => line.length > 120), []);
  // D124's review (a low): the note names the repository that holds the working directory apart (the page and the .md
  // name it by `givenHere`, with no count), and says that the reason never tells you to give a repository again.
  const option = flatText(sectionOf(note, '### Point the code review at a repository with `--code-repo`'));
  assert.ok(option.includes('When you give the repository that holds the working directory, they say so'), option);
  assert.ok(option.includes('does not tell you to give them again'), option);
  // TROUBLESHOOTING's row of the reason with a repository given never tells you to give it again.
  const given = troubleshooting.split('\n').find((line) => line.startsWith(
    `  | ${W.notReviewedReasons.no_seen_write_given} | `));
  assert.ok(given && !given.includes('run `sonah review` again with `--code-repo`'), 'the no_seen_write_given row');
  // D124's review (a low): the code quotes the owner's go for D124 (item 2), as DECISIONS does, not item 1's words.
  const itemOne = `"${['do a paid run', 'to test it'].join(' ')}"`;
  for (const path of ['packages/cli/src/code-snapshot.js', 'packages/cli/test/d124-code-repo.test.js']) {
    const text = flatText((await docText(path)).replace(/\n\s*\/\/ /g, ' '));
    assert.ok(text.includes('"you can do this now, on my laptop to test it"') && !text.includes(itemOne), path);
  }
});
