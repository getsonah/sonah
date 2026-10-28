// D149: the start-commit folder of a review of several units. The files of the change that have an earlier side are
// read as git stores them at the start commit (`git cat-file --batch`, literal paths, 200 a call: no filter, no
// conversion) and written under Sonah's state folder, at their paths from the repository's top folder; every agent may
// read it (`--add-dir`) and the where block names it; it is removed once the step's last call is done, and the record
// says so. Its own name is never followed, a folder there that is not Sonah's is left alone, it is never made where the
// agents read the repository, and the dry run names it without writing it. Reads only, but for that folder.
//
// Temporary repositories and state folders, synthetic sessions, fake agents: no recording of anyone's, no model, no
// network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodeSnapshot, makeStartFolder, removeStartFolder, batchBlobs, START_FOLDER_MARK } from '../src/code-snapshot.js';
import { reviewCodePass, dryRunReplay } from '../src/session-review.js';
import { isCodeReviewLabel } from '../../evidence/src/code-pass.js';
import { createAnswerCache } from '../src/answer-cache.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import * as fixture from './code-pass-fixture.js';

const START = '2030-01-01T00:00:00.000Z';
const linesOf = (tag, n) => Array.from({ length: n }, (_, i) => `${tag} ${String(i + 1).padStart(5, '0')}`.padEnd(40, '.'))
  .join('\n') + '\n';
const BEFORE_A = linesOf('aa', 4_000), BEFORE_C = linesOf('cc', 3_500);

/** A repository in `sub/` of a fresh folder (so the working directory is below its top): `base` committed before the
 *  session, `after` written, `gone` deleted. Returns the working directory, the repository's top and a state folder. */
async function repository(t, { base, after, gone = [] }) {
  const holder = await mkdtemp(join(tmpdir(), 'sonah-d149-start-'));
  t.after(() => rm(holder, { recursive: true, force: true }));
  const top = join(holder, 'repo');
  await mkdir(top, { recursive: true });
  const git = (args) => execFileSync('git', args, { cwd: top, stdio: 'pipe',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
      GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
      GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).toString();
  const write = async (files) => {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(top, path, '..'), { recursive: true });
      await writeFile(join(top, path), text);
    }
  };
  git(['init', '-q', '-b', 'main']);
  await write(base);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  await write(after);
  for (const path of gone) await rm(join(top, path));
  const recording = join(holder, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n`);
  return { root: join(top, 'sub'), top, state: join(holder, 'state'), recording, git, holder };
}

/** Every 8th line of a text changed: hunks git keeps apart. */
const every8 = (text) => text.split('\n').map((l, i) => ((i + 1) % 8 === 0 ? l.toUpperCase() : l)).join('\n');
/** Two units under sub/: a.js and c.js, every 8th line changed (hunks too large together); b.js added; d.js
 *  deleted. */
const BASE = { 'sub/a.js': BEFORE_A, 'sub/c.js': BEFORE_C, 'sub/d.js': 'export const d = 1;\n',
  'sub/src/parse.js': fixture.CODE_FILES['src/parse.js'] };
const AFTER = { 'sub/a.js': every8(BEFORE_A), 'sub/c.js': every8(BEFORE_C), 'sub/b.js': 'export const b = 1;\n' };
const sessionOf = () => fixture.codeSession({ writes: [{ path: 'a.js', text: 'SYNTHETIC\n' }, { path: 'c.js',
  text: 'SYNTHETIC\n' }, { path: 'b.js', text: 'SYNTHETIC\n' }, { path: 'd.js', text: 'SYNTHETIC\n' }] });

test('D149: the start-commit folder holds the files with an earlier side as they were, at their paths from the repository\'s top; never where the agents read', async (t) => {
  const { root, top, state, recording, git } = await repository(t, { base: BASE, after: AFTER, gone: ['sub/d.js'] });
  const snapshot = await readCodeSnapshot(sessionOf(), { root, maxBytes: 4_000_000, recording });
  const index = await stat(join(top, '.git', 'index'));
  const into = join(state, 'code-pass', 'start-commit');
  const made = await makeStartFolder({ snapshot, commit: snapshot.base.commit, paths: ['a.js', 'c.js', 'd.js'], into });
  assert.deepEqual(made.files.map((f) => [f.path, f.copy.slice(made.at.length)]), [['a.js', '/sub/a.js'],
    ['c.js', '/sub/c.js'], ['d.js', '/sub/d.js']]);
  assert.deepEqual([made.chunks, made.failedChunks], [1, 0]);
  assert.equal(await readFile(join(made.at, 'sub', 'a.js'), 'utf8'), BEFORE_A);
  assert.equal(await readFile(join(made.at, 'sub', 'd.js'), 'utf8'), 'export const d = 1;\n');
  assert.equal(existsSync(join(made.at, 'sub', 'src')), false, 'only the paths asked');
  // Reads only: git's index and status are as they were.
  assert.equal((await stat(join(top, '.git', 'index'))).mtimeMs, index.mtimeMs);
  assert.ok(!git(['status', '--porcelain']).includes('start-commit'));
  // Removed, and said so.
  assert.equal(await removeStartFolder(made.at), true);
  assert.equal(existsSync(made.at), false);
  // Never inside a folder the agents read: the working directory, or the repository.
  for (const inside of [join(root, '.sonah', 'start-commit'), join(top, 'state', 'start-commit')])
    assert.equal(await makeStartFolder({ snapshot, commit: snapshot.base.commit, paths: ['a.js'], into: inside }), null);
  assert.equal(existsSync(join(root, '.sonah')) || existsSync(join(top, 'state')), false);
  // The dry run: the same answer, nothing written.
  const dry = await makeStartFolder({ snapshot, commit: snapshot.base.commit, paths: ['a.js', 'c.js', 'd.js'], into,
    dryRun: true });
  assert.deepEqual(dry.files, made.files);
  assert.equal(existsSync(into), false);
});

test('D149: the folder is asked 200 paths a call; a call that fails gives none of its files, an unknown path none of its own', async (t) => {
  const { root, recording, state, git: repoGit } = await repository(t, { base: BASE, after: AFTER });
  const snapshot = await readCodeSnapshot(sessionOf(), { root, maxBytes: 4_000_000, recording });
  const calls = [];
  const gitInput = async (args, input) => { calls.push([args, input]); return { ok: false, stdout: null }; };
  const paths = Array.from({ length: 401 }, (_, i) => `f${i}.js`);
  const made = await makeStartFolder({ snapshot, commit: snapshot.base.commit, paths, into: join(state, 'sc'), gitInput });
  assert.deepEqual(calls.map(([, input]) => input.split('\n').filter(Boolean).length), [200, 200, 1]);
  assert.deepEqual(calls[0][0], ['cat-file', '--batch']);
  assert.equal(calls[0][1].split('\n')[0], `${snapshot.base.commit}:sub/f0.js`);
  assert.deepEqual([made.files, made.chunks, made.failedChunks], [[], 3, 3]);
  // With git: a path the start commit does not hold gives none, and the others of its call are read.
  const fine = await makeStartFolder({ snapshot, commit: snapshot.base.commit, paths: ['nowhere.js', 'a.js'],
    into: join(state, 'sc2') });
  assert.deepEqual([fine.files.map((f) => f.path), fine.failedChunks], [['a.js'], 0]);
  assert.ok(repoGit(['cat-file', '-t', `${snapshot.base.commit}:sub/a.js`]).startsWith('blob'));
});

test('D149: each file is the start commit\'s blob byte for byte: no filter program runs, no conversion, no export rule, a path read literally', async (t) => {
  const marker = join(tmpdir(), `sonah-d149-smudge-${process.pid}-${Date.now()}`);
  t.after(() => rm(marker, { force: true }));
  const crlf = 'one\r\ntwo\n';
  const { root, recording, state, git } = await repository(t, { base: { ...BASE,
    '.gitattributes': '*.js filter=probe\n*.txt eol=crlf text\nsub/hidden.js export-ignore\nsub/id.js ident\n',
    'sub/app/[slug]/page.tsx': 'the slug page\n', 'sub/app/s/page.tsx': 'the s page\n', 'sub/notes.txt': 'one\ntwo\n',
    'sub/hidden.js': 'export const hidden = 1;\n', 'sub/id.js': '// $Id$\n' }, after: { ...AFTER,
    'sub/app/[slug]/page.tsx': 'changed\n', 'sub/notes.txt': crlf, 'sub/hidden.js': 'export const hidden = 2;\n',
    'sub/id.js': '// $Id$ two\n' } });
  git(['config', 'filter.probe.smudge', `sh -c 'touch ${marker}; cat'`]);
  git(['config', 'filter.probe.clean', 'cat']);
  const snapshot = await readCodeSnapshot(sessionOf(), { root, maxBytes: 4_000_000, recording });
  const paths = ['a.js', 'app/[slug]/page.tsx', 'notes.txt', 'hidden.js', 'id.js'];
  const made = await makeStartFolder({ snapshot, commit: snapshot.base.commit, paths,
    into: join(state, 'code-pass', 'start-commit') });
  assert.equal(existsSync(marker), false, 'the smudge filter never ran');
  assert.deepEqual(made.files.map((f) => f.path), paths);
  for (const path of paths) {
    const blob = execFileSync('git', ['cat-file', 'blob', `${snapshot.base.commit}:sub/${path}`], { cwd: join(root, '..') });
    assert.ok((await readFile(join(made.at, 'sub', ...path.split('/')))).equals(blob), path);
  }
  assert.equal(existsSync(join(made.at, 'sub', 'app', 's')), false, 'the brackets are no glob');
  assert.equal(await readFile(join(made.at, 'sub', 'id.js'), 'utf8'), '// $Id$\n');
});

test('D149: the folder\'s own name is never followed; a folder there that is not Sonah\'s, or one that holds the repository, is left as it is', async (t) => {
  const { root, recording, state, holder, top } = await repository(t, { base: BASE, after: AFTER });
  const snapshot = await readCodeSnapshot(sessionOf(), { root, maxBytes: 4_000_000, recording });
  const commit = snapshot.base.commit;
  // A link there to a folder elsewhere: unlinked, never followed; the folder it pointed to keeps its file.
  const victim = join(holder, 'victim');
  await mkdir(victim, { recursive: true });
  await writeFile(join(victim, 'keep.txt'), 'keep\n');
  const into = join(state, 'code-pass', 'start-commit');
  await mkdir(join(state, 'code-pass'), { recursive: true });
  await symlink(victim, into);
  const made = await makeStartFolder({ snapshot, commit, paths: ['a.js'], into });
  assert.equal(await readFile(join(victim, 'keep.txt'), 'utf8'), 'keep\n');
  assert.equal(existsSync(join(victim, 'sub')), false);
  assert.equal((await stat(made.at)).isDirectory(), true);
  assert.ok(existsSync(join(made.at, START_FOLDER_MARK)));
  // A stale file of an earlier one is gone after a fresh one.
  await writeFile(join(made.at, 'stale.txt'), 'stale\n');
  const again = await makeStartFolder({ snapshot, commit, paths: ['a.js'], into });
  assert.equal(existsSync(join(again.at, 'stale.txt')), false);
  // Removed (and a link there removed alone): the folder it pointed to is untouched.
  assert.equal(await removeStartFolder(into), true);
  await symlink(victim, into);
  assert.equal(await removeStartFolder(into), true);
  assert.equal(await readFile(join(victim, 'keep.txt'), 'utf8'), 'keep\n');
  // A folder there with no mark is not Sonah's: nothing made, nothing removed.
  await mkdir(into);
  await writeFile(join(into, 'theirs.txt'), 'theirs\n');
  assert.equal(await makeStartFolder({ snapshot, commit, paths: ['a.js'], into }), null);
  assert.equal(await removeStartFolder(into), false);
  assert.equal(await readFile(join(into, 'theirs.txt'), 'utf8'), 'theirs\n');
  // A folder that holds the repository, even one that holds Sonah's mark: nothing made, nothing removed.
  await writeFile(join(holder, START_FOLDER_MARK), '');
  assert.equal(await makeStartFolder({ snapshot, commit, paths: ['a.js'], into: holder }), null);
  assert.ok(existsSync(join(top, '.git')) && existsSync(join(root, 'a.js')));
  // A path that would leave the repository is never asked.
  const out = await makeStartFolder({ snapshot, commit, paths: ['../../escape.js', 'a.js'], into: join(state, 'other') });
  assert.deepEqual(out.files.map((f) => f.path), ['a.js']);
});

test('D149: a folder that fails while it is made is removed whole and is none', async (t) => {
  const { root, recording, state } = await repository(t, { base: BASE, after: AFTER });
  const snapshot = await readCodeSnapshot(sessionOf(), { root, maxBytes: 4_000_000, recording });
  const commit = snapshot.base.commit;
  const oid = 'b'.repeat(40);
  // git answers a file at `sub/x` and one below it, `sub/x/y`: the second cannot be written once the first is.
  const gitInput = async () => ({ ok: true, stdout: Buffer.from(`${oid} blob 1\nA\n${oid} blob 1\nB\n`) });
  const into = join(state, 'code-pass', 'start-commit');
  assert.equal(await makeStartFolder({ snapshot, commit, paths: ['x', 'x/y'], into, gitInput }), null);
  assert.equal(existsSync(into), false);
});

test('D149: git\'s batch output gives each blob\'s bytes, and none for a name it does not hold', () => {
  const oid = 'a'.repeat(40);
  const buffer = Buffer.concat([Buffer.from(`${oid} blob 3\n`), Buffer.from('a\nb'), Buffer.from('\n'),
    Buffer.from('c:nowhere missing\n'), Buffer.from(`${oid} tree 5\n`), Buffer.from('xxxxx\n'),
    Buffer.from(`${oid} blob 0\n\n`)]);
  assert.deepEqual(batchBlobs(buffer, ['c:a', 'c:nowhere', 'c:dir', 'c:empty']).map((b) => [b.asked, b.bytes.toString()]),
    [['c:a', 'a\nb'], ['c:empty', '']]);
});

const memoryStore = () => ({ lock: async () => async () => {}, saveReport: async () => {} });

test('D149: a review of several units gives every agent the folder and names it; it is removed after the last call, and the record says so; one unit makes none', async (t) => {
  const { root, recording, state } = await repository(t, { base: BASE, after: AFTER, gone: ['sub/d.js'] });
  const snapshot = await readCodeSnapshot(sessionOf(), { root, maxBytes: 4_000_000, recording });
  const startFolderAt = join(state, 'code-pass', 'start-commit');
  const seen = [];
  let during = null;
  const judge = async (request) => {
    if (isCodeReviewLabel(request.label)) {
      if (during === null) during = existsSync(join(startFolderAt, 'sub', 'a.js'));
      return { findings: [], questions: [] };
    }
    if (/^code-account:\d+(:reask)?$/.test(request.label)) return fixture.accountsHold(request.prompt);
    throw new Error(`unexpected ${request.label}`);
  };
  const { report } = await reviewCodePass({ session: sessionOf(), report: {}, snapshot, answerCache: null,
    store: memoryStore(), backend: 'claude-cli', startFolderAt, judge: async (request) => { seen.push(request);
      return judge(request); } });
  const reviews = seen.filter((r) => isCodeReviewLabel(r.label));
  assert.ok(reviews.length >= 2);
  const line = `The changed files as they were at the start commit ${snapshot.base.commit}, each by its path from the `
    + 'repository\'s top folder: ';
  for (const r of reviews) {
    assert.ok(r.prompt.includes(line), r.label);
    assert.ok(r.agent.addDirs.some((dir) => dir.endsWith(join('code-pass', 'start-commit'))), r.label);
  }
  assert.equal(during, true);
  assert.equal(existsSync(startFolderAt), false);
  const folder = report.codePass.startFolder;
  assert.deepEqual([folder.removed, folder.commit, folder.chunks, folder.failedChunks], [true, snapshot.base.commit, 1, 0]);
  // The lines the hunks hold on the earlier side (the snapshot widens them, so here they run together).
  assert.deepEqual(folder.files.map((f) => [f.path, f.before]), [['a.js', [[4, 4000]]], ['c.js', [[4, 3500]]],
    ['d.js', [[1, 1]]]]);
  // A change of one unit: no folder, no line.
  const small = await repository(t, { base: { 'sub/src/parse.js': fixture.CODE_FILES['src/parse.js'],
    'sub/a.js': 'one\n' }, after: { 'sub/a.js': 'two\n' } });
  const one = await readCodeSnapshot(fixture.codeSession({ writes: [{ path: 'a.js', text: 'SYNTHETIC\n' }] }),
    { root: small.root, maxBytes: 4_000_000, recording: small.recording });
  // A folder an earlier review left behind (it holds Sonah's mark) is removed first, whatever this review makes.
  const left = join(small.state, 'code-pass', 'start-commit');
  await mkdir(join(left, 'sub'), { recursive: true });
  await writeFile(join(left, START_FOLDER_MARK), '');
  await writeFile(join(left, 'sub', 'a.js'), 'left behind\n');
  const oneSeen = [];
  const { report: oneReport } = await reviewCodePass({ session: fixture.codeSession({ writes: [{ path: 'a.js',
    text: 'SYNTHETIC\n' }] }), report: {}, snapshot: one, answerCache: null, store: memoryStore(), backend: 'claude-cli',
  startFolderAt: join(small.state, 'code-pass', 'start-commit'), judge: async (request) => { oneSeen.push(request);
    return fixture.codeJudge({ review: () => ({ findings: [], questions: [] }) })(request); } });
  assert.ok(oneSeen.every((r) => !r.prompt.includes('as they were at the start commit')));
  assert.equal(oneReport.codePass.startFolder, undefined);
  assert.equal(existsSync(left), false);
  // The dry run names the folder in its first requests and writes nothing.
  const model = SESSION_REVIEW_CLAUDE_CLI_MODEL;
  const replay = await dryRunReplay({ session: sessionOf(), snapshot, backend: 'claude-cli', model, startFolderAt,
    answerCache: createAnswerCache(join(small.holder, 'answers'), { backend: 'claude-cli', model, readOnly: true }) });
  // Byte for byte the requests the review sent, the folder's line among them.
  const bytesOf = (r) => Buffer.byteLength(r.system ?? '', 'utf8') + Buffer.byteLength(r.prompt ?? '', 'utf8');
  assert.deepEqual(replay.codeRequests.filter((r) => isCodeReviewLabel(r.label)).map((r) => [r.label, r.bytes]).sort(),
    reviews.map((r) => [r.label, bytesOf(r)]).sort());
  assert.equal(existsSync(startFolderAt), false);
});

test('D149: a review stopped after the folder was made still removes it', async (t) => {
  const { root, recording, state } = await repository(t, { base: BASE, after: AFTER, gone: ['sub/d.js'] });
  const snapshot = await readCodeSnapshot(sessionOf(), { root, maxBytes: 4_000_000, recording });
  const startFolderAt = join(state, 'code-pass', 'start-commit');
  const stop = new AbortController();
  let made = false;
  const judge = async (request) => {
    if (isCodeReviewLabel(request.label)) { made = made || existsSync(startFolderAt); stop.abort(); }
    return { findings: [], questions: [] };
  };
  await assert.rejects(reviewCodePass({ session: sessionOf(), report: {}, snapshot, answerCache: null,
    store: memoryStore(), backend: 'claude-cli', startFolderAt, judge, signal: stop.signal }),
  (error) => error?.code === 'review_interrupted');
  assert.equal(made, true);
  assert.equal(existsSync(startFolderAt), false);
});
