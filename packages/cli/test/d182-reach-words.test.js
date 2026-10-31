// D182 (0.3.0-beta.11; the owner, 2026-10-29: "queue the code-step wording cleanup for beta.11"; 2026-10-30: "Ready
// items first"): the public text says in general words what the code step reads and sends, and points to one
// definition in docs/PRIVACY.md, in place of lists of folders and of what is never read, which the code had outgrown.
// Each general word rests on a code fact that this file checks: a working directory that no git repository holds is
// still reviewed, and its agents run there; a repository given with --code-repo that holds no file of the change is no
// folder of the agents', yet its other differing files are given to the code review apart, and the agents open it
// when it lies inside the working directory; a working directory that is a folder of a larger repository gives the
// agents that whole repository; git is asked about a repository the session wrote to before Sonah finds that it holds
// no file of the change; Sonah's start-commit copy is a folder the agents read; and the two terminal lines that said
// Sonah read nothing print after the recording is read, so they no longer say it. The page's paragraph on how the code
// review works names no folder (D199: and neither the page nor the .md prints it any more).
//
// Throwaway repositories in temporary folders, synthetic sessions, a deterministic fake reviewer: no recording of a real
// session, no model, no network. Every commit date is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { agentFolders, readCodeSnapshot, runGit } from '../src/code-snapshot.js';
import { CODE_STEP_BACKEND_LINE, REVIEW_FIX_WORDS, runSessionReviewCommand } from '../src/session-review-command.js';
import { agentsRead, placesHolding, runCodePass } from '../../evidence/src/code-pass.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { renderSessionPage } from '../../render/session-page.js';
import { REPORT_NOT_CHECKED_WORDS } from '../../render/report-words.js';
import { CODE_FILES, CODE_TEXT, buildCodeSession, codeJudge, codeSession, sha256 } from './code-pass-fixture.js';

const START = '2030-01-01T00:00:00.000Z';
const END = '2030-01-02T00:00:00.000Z';
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const T1 = { turn: 'T1' };
const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
  GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' } })
  .toString();
const flat = (text) => text.replace(/\s+/g, ' ');
const doc = async (path) => flat(await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8'));

async function folder(t, name) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `sonah-d182-${name}-`)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}
async function committed(root, files) {
  await mkdir(root, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  await put(root, files);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  return root;
}
async function recordingAt(t) {
  const file = join(await folder(t, 'rec'), 'recording.jsonl');
  await writeFile(file, `${JSON.stringify({ timestamp: START })}\n${JSON.stringify({ timestamp: END })}\n`);
  return file;
}
function sessionWriting(key, writes) {
  const blobs = { ...CODE_TEXT, ...Object.fromEntries(writes.map(([, text], at) => [`w${at}`, text])) };
  return buildCodeSession(key, blobs, [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    ...writes.flatMap(([path], at) => [{ id: `W${at + 1}`, kind: 'invocation', write: path, blob: `w${at}`, ...T1 },
      { id: `W${at + 1}-r`, kind: 'observation', invocation: `W${at + 1}`, blob: 'wrote', ...T1 }]),
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
}
const noFindings = () => ({ findings: [], questions: [] });
/** The code step over `snapshot`, as the CLI runs it (session-review.js), with a fake reviewer: its record and every
 *  request it sent. */
async function passOf(snapshot, session) {
  const seen = [];
  const { codePass } = await runCodePass({ report: {}, session, snapshot: snapshot.files, base: snapshot.base,
    root: snapshot.dir, top: snapshot.top !== snapshot.realRoot ? snapshot.top : null, folders: snapshot.folders ?? null,
    realRoot: snapshot.realRoot, judge: codeJudge({ review: noFindings, seen }) });
  return { codePass, seen };
}

/** The paragraph on how the code review works (`how`, or `howTied` under the tie rule) named no folder; D199 (the owner,
 *  2026-10-30, "All of them"): neither the page nor the .md prints it any more, and no other line of either says which
 *  folder the code review could open. D199: the words were removed; as literals (the paragraph's first sentence, the
 *  same in both forms). */
const OLD_HOW_LEAD = 'Sonah asked for a review of the change as a code reviewer reviews a pull request';
function assertHowNamesNoFolder(session, codePass) {
  const report = { windowResults: [], codePass };
  const page = renderSessionPage(session, report).replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const text of [renderReportMarkdown(session, report), page]) {
    assert.ok(text.includes(REPORT_NOT_CHECKED_WORDS.codeReview), 'its part on the code review');
    assert.ok(!text.includes(OLD_HOW_LEAD), text);
    assert.ok(!/any file of the (?:repository|working directory)/.test(text), text);
  }
}

// ---- the documents ----------------------------------------------------------------------------------------------

test('D182: PRIVACY holds the one definition of what the code step reads and what its agents open; the other documents '
  + 'say it in general words and point there; no list of folders that are never read is left', async () => {
  const privacy = await doc('docs/PRIVACY.md');
  // The opening, C1 and C2 in the code step's row (with the git question of a repository the session wrote to), the
  // restricted mode's pointer to that row, C4 in what is never sent, and the stored-answers row's start-commit copy.
  for (const words of [
    'your working directory, its repository and the other git repositories that the session wrote to or that you give '
      + 'with `--code-repo`, as they are now, with git and through agents that open, search and list files with '
      + 'read-only tools.',
    'The code step reads the git repository that holds your working directory (or that folder alone, when no '
      + 'repository holds it), each other git repository that holds a file of the change, and each one you give with '
      + '`--code-repo`.',
    'Its agents can open any file of the first two of these. A repository you give that holds no file of the change is '
      + 'not one of their folders, so they open its files only when it lies inside one of those. When the change is '
      + 'reviewed in parts, they can also open Sonah\'s copy of the changed files as they were at the start commit.',
    'For each other git repository the session wrote to, git is also asked whether the files it wrote there differ '
      + 'from the commit where that repository stood when the recording began.',
    'outside the evaluated session, sent and marked as in your repository; and any file of it that the agents open '
      + '(above).',
    'Claude Code\'s restricted mode confines them to the folders that the last row of the table above says they can '
      + 'open. `--backend codex-cli --model',
    '- With the code step, any file outside the working directory and the repositories that the code step reads (above), '
      + 'other than Sonah\'s copy of their files.',
    'its agents\' answers are kept apart in `code-pass/answers/` there (and, while a change reviewed in parts is '
      + 'checked, Sonah\'s copy of its changed files, in `code-pass/start-commit/`), and the report also holds each '
      + 'changed file\'s path, state and SHA-256, the lines of any file its findings,',
  ]) assert.ok(privacy.includes(words), words);
  // C3, the short form, in README and INSTALL, each with its pointer; INSTALL's agents, as PRIVACY's C2 names them.
  assert.ok((await doc('README.md')).includes('files of your working directory and of the git repositories that the '
    + 'code review reads ([Privacy](docs/PRIVACY.md) says which): the session\'s change, the other files that differ '
    + 'from where the session started, the lines the session read of other files and the skill files it used, as they '
    + 'are now, and what the code review\'s read-only agents open.'));
  const install = await doc('docs/INSTALL.md');
  for (const words of [
    'then reads files of your working directory and of the git repositories that it reads ([PRIVACY.md](PRIVACY.md) '
      + 'says which): the session\'s changes since its start commit, read with git, which writes nothing, the '
      + 'other files that differ from where the session started, the lines the session read of other files and the '
      + 'skill files it used, as they are now.',
    'It gives them to a review agent, Claude Code with read-only tools (Read, Grep and Glob), and to checking agents '
      + 'with the same tools. They read what they need over your working directory, its repository, the other git '
      + 'repositories that hold a file of the change and, when the change is reviewed in parts, Sonah\'s copy of the '
      + 'changed files as they were at the start commit, and send it to the model as they work.',
    'confined to the working directory, its repository, the other git repositories that hold a file of the change and, '
      + 'when the change is reviewed in parts, Sonah\'s copy of the changed files as they were at the start commit '
      + '([PRIVACY.md](PRIVACY.md) says more)',
    'your working directory and the git repositories it reads, as they are now, with read-only tools',
  ]) assert.ok(install.includes(words), words);
  // TROUBLESHOOTING's place-line row: a repository given with --code-repo counts, and what of it is read.
  assert.ok((await doc('docs/TROUBLESHOOTING.md')).includes('A repository counts only when a file the session wrote '
    + 'there is there now and differs from that commit, or when you give it with `--code-repo`. The code review\'s '
    + 'agents also read each one that holds a file of the change, and in one that you give Sonah reads with git the '
    + 'files that differ there, whatever the session wrote ([PRIVACY.md](PRIVACY.md) says what is sent).'));
  // The sentences that the code outgrew, whole: none of those named here is left in a shipped document. Beta.10's
  // (32; the review's mutants found 4 rows whose old words were not named, now named) and the build's first words
  // that its review found short (8).
  const removed = {
    'docs/PRIVACY.md': ['A folder that no git repository holds, such as a notes folder, is never read',
      'Since 0.3.0-beta.5 the code step also reads the files that the session wrote in other git repositories',
      'a repository where every file the session wrote is not there, or has no difference, is counted, and nothing in it '
        + 'is read or sent',
      'A file the session wrote in a folder that no git repository holds (a notes folder, a temporary folder) is never '
        + 'read or sent',
      'or named from your home folder (`~/…`), is counted, never read or sent',
      'its `--add-dir` folders; never a folder of no repository',
      'A folder that no git repository holds is never one of them',
      'never makes its folder one of them',
      'held back because of what it holds or where it lies',
      'any file of your repository, or of another repository or folder the session wrote to',
      'read-only access to your repository and to each other repository or folder the session wrote to',
      'any file of your repository, or of another git repository that holds a file of the change, that its agents open',
      'the lines of any file of the repository its findings',
      'and, when it holds a file of the change, any file of it that the agents open',
      // The build's first words, which its review found short of the code (a given repository nested in a folder the
      // agents read; the repositories that git is asked about or that you give).
      'except in a repository you give that holds no file of the change',
      'other git repositories that hold the session\'s change, as they are now',
      'confines them to what they can open'],
    'README.md': ['They read your repository, any other git repository where the session changed a file',
      'the session\'s change, the files it changed,',
      // The build's first words (a working directory that no git repository holds is read too).
      'in your repository and the other git repositories that the code review reads'],
    'SECURITY.md': ['such as a code-step agent reading outside your repository'],
    'docs/ARCHITECTURE.md': ['any file of the repository, now or at the start commit'],
    'docs/INSTALL.md': ['is read the same way, whatever the session wrote there',
      'working directory (and the other git repositories that the session wrote to)',
      'your working directory\'s, another one that the session wrote to, or one that you give',
      'confined to your repository, the other git repositories that hold a file of the change',
      'the second run reads them as part of the change',
      'a file git tracks or the session wrote always is',
      'over your repository as it is now',
      'your repository as it is now, with read-only tools',
      'A file the session wrote in a coding agent\'s home folder or Sonah\'s, or under a name from your home folder, '
        + 'is counted, not reviewed.',
      // The build's first words (a working directory that no git repository holds; the start-commit copy).
      'over your repository and the other git repositories the code step reads',
      'your repository and the other git repositories it reads',
      'confined to the working directory and the repositories of the change',
      // The merge's close check: the short form named only the change, before "Nothing else ... leaves your computer"
      // (a repository you give that holds no file of the change has its differing files sent too).
      'then reads the session\'s changes since its start commit, read with git, which Sonah never writes to, and gives',
      'which it never writes to'],
    'docs/TROUBLESHOOTING.md': ['Nothing was read or sent. Choose a `--state-dir`',
      'working directory (and the other git repositories that the session wrote to)',
      'a report file in the repository is part of the change',
      'Not a gap: the session also wrote files in another git repository',
      // The build's first words (a given repository's differing files are read too).
      'The code review reads each one that holds a file of the change too.',
      'its writes lie in a coding agent\'s home folder, in Sonah\'s own folders or under a name from your home folder'],
  };
  for (const [path, sentences] of Object.entries(removed)) {
    const text = await doc(path);
    for (const sentence of sentences) assert.ok(!text.includes(sentence), `${path}: ${sentence}`);
  }
  // A folder of no repository outside the working directory is still listed, not reviewed, where a person needs it.
  assert.ok(install.includes('A file the session wrote outside the working directory, in a folder that no git '
    + 'repository holds (a notes or temporary folder), is not reviewed'));
});

// ---- the code facts the words rest on ---------------------------------------------------------------------------

test('D182 (F1): a working directory that no git repository holds is still reviewed: the code step runs, its agents '
  + 'run there, and the page\'s paragraph on how the code review works names no folder (D199: and no page or .md '
  + 'prints it)', async (t) => {
  const R = join(await folder(t, 'norepo'), 'R');
  await put(R, { 'src/parse.js': CODE_FILES['src/parse.js'], 'src/util.js': CODE_FILES['src/util.js'] });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-d182-norepo', [['src/parse.js', CODE_FILES['src/parse.js']]]);
  const snapshot = await readCodeSnapshot(session, { root: R, maxBytes: 1_000_000, recording });
  assert.deepEqual([snapshot.root, snapshot.repository], [true, false]);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.place ?? null]), [['src/parse.js', null]]);
  const { codePass, seen } = await passOf(snapshot, session);
  const agent = seen.find((r) => r.label === 'code-review:agent');
  assert.ok(agent, 'the review agent was asked');
  assert.deepEqual([agent.agent.root, agent.agent.addDirs], [R, []], 'the agents run in that folder, and only there');
  assert.equal(codePass.ran, true);
  assertHowNamesNoFolder(session, codePass);
});

test('D182 (F4, F3): a repository given with --code-repo that holds no file of the change is no folder of the agents\', '
  + 'yet its other differing file is given apart; another repository that holds a file of the change is one; Sonah\'s '
  + 'start-commit copy is one too (D199: no page or .md prints the paragraph on how the code review works)',
  async (t) => {
  const base = await folder(t, 'given');
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'] });
  const B = await committed(join(base, 'B'), { 'lib/b.js': 'export const b = 1;\n' });
  const G = await committed(join(base, 'G'), { 'docs/later.md': '# Later\n' });
  await put(A, { 'src/parse.js': CODE_FILES['src/parse.js'] });
  await put(B, { 'lib/b.js': 'export const b = 2;\n' });
  // G's one differing file last changed after the session ended: outside the evaluated session, no file of the change.
  await put(G, { 'docs/later.md': '# Later\n\nWritten after the session.\n' });
  const later = new Date('2030-01-05T00:00:00Z');
  await utimes(join(G, 'docs', 'later.md'), later, later);
  const recording = await recordingAt(t);
  const session = sessionWriting('s-d182-given', [['src/parse.js', CODE_FILES['src/parse.js']],
    [join(B, 'lib', 'b.js'), 'export const b = 2;\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording, codeRepos: [G] });
  assert.deepEqual(snapshot.base.places.map((p) => [p.at, p.given ?? false]).sort(), [[B, false], [G, true]]);
  assert.deepEqual(placesHolding(snapshot.base, snapshot.files).map((p) => p.at), [B]);
  // The agents read B (a file of the change), never G (none), whatever was given.
  assert.deepEqual(snapshot.folders, [B]);
  assert.deepEqual(await agentFolders(snapshot), [B]);
  // G's differing file is still read and given to the code review apart from the change (outside the evaluated session).
  assert.ok(snapshot.outsideFiles.some((f) => f.path === join(G, 'docs', 'later.md') && f.place === G),
    snapshot.outsideFiles.map((f) => f.path).join(', '));
  assert.ok(!snapshot.files.some((f) => f.path === join(G, 'docs', 'later.md') && f.diff !== undefined));
  // Sonah's start-commit copy (a review in parts), under the state folder, in no repository: a folder the agents read.
  const copy = join(base, 'state', 'code-pass', 'start-commit');
  const where = { root: A, realRoot: A, folders: [B], startFolder: { at: copy, commit: 'c'.repeat(40) } };
  assert.equal(agentsRead(where, copy), true);
  assert.equal(agentsRead(where, G), false);
  // The page's paragraph, over this change, names no folder either.
  assertHowNamesNoFolder(session, (await passOf(snapshot, session)).codePass);
});

test('D182, its review (C2): a repository given with --code-repo that holds no file of the change and lies inside the '
  + 'working directory is no folder of the agents\', yet they can open it through that folder', async (t) => {
  const base = await folder(t, 'nested');
  const N = await committed(join(base, 'A', 'vendor', 'N'), { 'n.js': 'export const n = 1;\n' });
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE, '.gitignore': 'vendor/\n' });
  await put(A, { 'src/parse.js': CODE_FILES['src/parse.js'] });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-d182-nested', [['src/parse.js', CODE_FILES['src/parse.js']]]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording, codeRepos: [N] });
  assert.deepEqual(snapshot.base.places.map((p) => [p.at, p.given ?? false]), [[N, true]]);
  assert.deepEqual(placesHolding(snapshot.base, snapshot.files), []);
  assert.deepEqual(await agentFolders(snapshot), []);
  const { seen } = await passOf(snapshot, session);
  const agent = seen.find((r) => r.label === 'code-review:agent');
  assert.deepEqual([agent.agent.root, agent.agent.addDirs], [A, []]);
  const where = { root: agent.agent.root, realRoot: snapshot.realRoot, folders: snapshot.folders ?? null };
  assert.equal(agentsRead(where, N), true, 'the agents open the given repository through the working directory');
});

test('D182, its review (C2, INSTALL): when the working directory is a folder of a larger repository, the agents read '
  + 'that whole repository too, even when the change lies only in another repository', async (t) => {
  const base = await folder(t, 'sub');
  const A = await committed(join(base, 'A'), { 'sub/keep.js': 'export const k = 1;\n',
    'top.js': 'export const t = 1;\n' });
  const B = await committed(join(base, 'B'), { 'lib/b.js': 'export const b = 1;\n' });
  await put(B, { 'lib/b.js': 'export const b = 2;\n' });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-d182-sub', [[join(B, 'lib', 'b.js'), 'export const b = 2;\n']]);
  const snapshot = await readCodeSnapshot(session, { root: join(A, 'sub'), maxBytes: 1_000_000, recording });
  assert.equal(snapshot.files.filter((f) => f.diff !== undefined && typeof f.place !== 'string').length, 0,
    'no file of the change in the working directory\'s repository');
  assert.deepEqual(snapshot.files.filter((f) => f.diff !== undefined).map((f) => f.place), [B]);
  const { seen } = await passOf(snapshot, session);
  const agent = seen.find((r) => r.label === 'code-review:agent');
  assert.deepEqual([agent.agent.root, agent.agent.addDirs], [join(A, 'sub'), [A, B]]);
});

test('D182, its review (C1, F5): git is asked about another repository the session wrote to before Sonah finds that it '
  + 'holds no file of the change; it is then no place and no folder of the agents\'', async (t) => {
  const base = await folder(t, 'asked');
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE });
  const C = await committed(join(base, 'C'), { 'c.js': 'export const c = 1;\n' });
  await put(A, { 'src/parse.js': CODE_FILES['src/parse.js'] });
  const recording = await recordingAt(t);
  // The session wrote C's file with the text it already holds: no difference from where C stood.
  const session = sessionWriting('s-d182-asked', [['src/parse.js', CODE_FILES['src/parse.js']],
    [join(C, 'c.js'), 'export const c = 1;\n']]);
  const asked = [];
  const git = (args, options) => { asked.push([options?.cwd ?? null, args]); return runGit(args, options); };
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording, git });
  assert.ok(asked.some(([cwd, args]) => cwd === C && args[0] === 'diff' && args.some((a) => a.endsWith('c.js'))),
    'git was asked whether the file the session wrote there differs');
  assert.deepEqual(snapshot.base.places ?? [], []);
  assert.deepEqual(await agentFolders(snapshot), []);
});

// ---- the terminal ------------------------------------------------------------------------------------------------

/** One `sonah review` in `root`, its stdout and stderr kept in the order they were written. */
async function review(t, { root, argv, session = codeSession() }) {
  const dir = await folder(t, 'run');
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, '{}\n');
  const env = { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(dir, 'claude') };
  let text = '';
  const calls = [];
  const judge = codeJudge();
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--format', 'md', '--output',
    join(dir, 'story.md'), '--no-open', ...argv], {
    stdout: { write: (s) => { text += s; } }, stderr: { write: (s) => { text += s; } }, cwd: root, env,
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ config, onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: config.backend, attestation: config.backend === 'claude-cli' ? 'attested'
        : 'unattested', contextWindow: config.backend === 'claude-cli' ? 1_000_000 : null });
      return judge(request);
    } });
  return { code, text, calls, file };
}

test('D182 (F8): the stop for a --state-dir that holds the working directory prints after the recording was read, and '
  + 'says that Sonah read the recording and sent nothing', async (t) => {
  const root = await committed(join(await folder(t, 'state'), 'repo'), { 'src/parse.js': BASE_PARSE });
  await put(root, { 'src/parse.js': CODE_FILES['src/parse.js'] });
  const run = await review(t, { root, argv: ['--code-pass', '--state-dir', root] });
  assert.equal(run.code, 2, run.text);
  assert.deepEqual(run.calls, [], 'nothing sent');
  const recorded = run.text.indexOf(`Recording: ${run.file}`);
  const stop = run.text.indexOf('Review could not complete: state_dir_holds_root.');
  assert.ok(recorded >= 0 && stop > recorded, run.text);
  assert.ok(run.text.includes(`Fix: ${REVIEW_FIX_WORDS.state_dir_holds_root}`), run.text);
  assert.ok(REVIEW_FIX_WORDS.state_dir_holds_root.includes('Sonah read the recording and sent nothing.'));
  assert.ok(!REVIEW_FIX_WORDS.state_dir_holds_root.includes('read and sent nothing'));
});

test('D182 (F8): on another backend the line that the code review did not run prints after the recording was read, '
  + 'in a review and in a dry run, and no longer says that Sonah read nothing', async (t) => {
  const root = await committed(join(await folder(t, 'backend'), 'repo'), { 'src/parse.js': BASE_PARSE });
  await put(root, { 'src/parse.js': CODE_FILES['src/parse.js'] });
  for (const argv of [['--code-pass', '--backend', 'codex-cli', '--model', 'gpt-5.5-codex'],
    ['--dry-run', '--backend', 'anthropic-api', '--model', 'claude-sonnet-5-5']]) {
    const run = await review(t, { root, argv });
    const recorded = run.text.indexOf(`Recording: ${run.file}`);
    const line = run.text.indexOf(`${CODE_STEP_BACKEND_LINE}\n`);
    assert.ok(recorded >= 0 && line > recorded, `${argv[1]}: ${run.text}`);
  }
  assert.ok(!/read nothing/.test(CODE_STEP_BACKEND_LINE), CODE_STEP_BACKEND_LINE);
});
