// D178 (0.3.0-beta.10): a session that writes the same file into two worktrees of one repository. The snapshot
// records the working directory's offset in its repository on its git base (`base.within`), the code step's record
// keeps it, and the size line counts the repeat once (evidence code-pass.js `changeRepeatsOf`). The hard rule: no
// request byte, no answer key and no byte of the code step's profile moves with the new fact, since no request reads
// the base whole (pinned here: the same snapshot with and without `within` sends the same requests under the same keys,
// at the repository's top folder and in a folder of it, where `within` is not empty). D178's review: a file the rule
// cannot compare (a binary pair, a file outside the working directory) leaves the size line as before.
//
// Throwaway repositories in temporary folders, synthetic sessions, a deterministic fake reviewer: no recording of a real
// session, no model, no network. Every commit date is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readCodeSnapshot } from '../src/code-snapshot.js';
import { answerKey } from '../src/answer-cache.js';
import { changeRepeatsOf, codeChangeTally, runCodePass, CODE_PASS_PROFILE } from '../../evidence/src/code-pass.js';
import { reportModel } from '../../render/report-model.js';
import { REPORT_HEADER_WORDS } from '../../render/report-words.js';
import { CODE_FILES, CODE_TEXT, buildCodeSession, codeJudge } from './code-pass-fixture.js';

const START = '2030-01-01T00:00:00.000Z';
const END = '2030-01-02T00:00:00.000Z';
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const T1 = { turn: 'T1' };
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
  GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' };
const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: GIT_ENV }).toString();

async function folder(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-d178-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
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
/** A repository with its main worktree A and a second worktree B of the same commit, both before the session. */
async function worktrees(t, more = {}) {
  const base = await realpath(await folder(t, 'ws'));
  const A = join(base, 'A'), B = join(base, 'B');
  await mkdir(A, { recursive: true });
  git(A, ['init', '-q', '-b', 'main']);
  await put(A, { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'], 'sub/notes.md': 'notes\n',
    ...more });
  git(A, ['add', '-A']);
  git(A, ['commit', '-q', '-m', 'base']);
  git(A, ['worktree', 'add', '-q', '-b', 'trail', B]);
  return { A, B };
}
/** The code step as the CLI runs it on a snapshot (session-review.js `codeStepPlace`), with the fixture's finding (so
 *  the review, its check and the accounting are asked): every request kept. */
async function passOf(snapshot, session) {
  const seen = [];
  const { codePass } = await runCodePass({ report: {}, session, snapshot: snapshot.files, base: snapshot.base,
    root: snapshot.dir, top: snapshot.top !== snapshot.realRoot ? snapshot.top : null, folders: snapshot.folders ?? null,
    realRoot: snapshot.realRoot, judge: codeJudge({ seen }) });
  return { codePass, seen };
}
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const keyOf = (snapshot) => (r) => answerKey(r, { backend: 'claude-cli', model: 'claude-sonnet-5-5[1m]',
  repoState: snapshot.repoState });
const sizeOf = (session, codePass) => reportModel(session, { coverage: 'complete', sessionReview: 'complete', codePass },
  {}).header.size.find((part) => part.startsWith('a change of'));

test('D178: the same file written into two worktrees of one repository is counted once on the size line', async (t) => {
  const { A, B } = await worktrees(t);
  const recording = await recordingAt(t);
  // The same new text of src/parse.js in both worktrees, and a file of B's own.
  await put(A, { 'src/parse.js': CODE_FILES['src/parse.js'] });
  await put(B, { 'src/parse.js': CODE_FILES['src/parse.js'], 'lib/b.js': 'export const b = 2;\n' });
  const session = sessionWriting('s-d178', [['src/parse.js', CODE_FILES['src/parse.js']],
    [join(B, 'src', 'parse.js'), CODE_FILES['src/parse.js']], [join(B, 'lib', 'b.js'), 'export const b = 2;\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording });
  assert.equal(snapshot.base.kind, 'git');
  assert.equal(snapshot.base.within, '', 'the working directory is the repository\'s top folder');
  assert.deepEqual(snapshot.base.places.map((p) => [p.at, p.commit]), [[B, snapshot.base.commit]]);
  const { codePass, seen } = await passOf(snapshot, session);
  assert.equal(codePass.base.within, '', 'the record keeps it');
  const tally = codeChangeTally(codePass);
  assert.equal(tally.total, 3);
  assert.deepEqual(changeRepeatsOf(codePass, tally), { repeats: 1, unproved: 0, distinct: 2 });
  const model = reportModel(session, { coverage: 'complete', sessionReview: 'complete', codePass }, {});
  const size = model.header.size.find((part) => part.startsWith('a change of'));
  assert.ok(size.startsWith(`${REPORT_HEADER_WORDS.change(3, null, 2, 2).split(',')[0]},`), size);
  assert.equal(model.did.files.total, 3, 'the Files section counts every file');
  // Without the fact (every record made before D178) the working folder's file cannot be compared, so the line says
  // no count with each repeat counted once (D178's review): the words before D178.
  const { within, ...older } = codePass.base;
  assert.equal(within, '');
  assert.deepEqual(changeRepeatsOf({ ...codePass, base: older }), { repeats: 0, unproved: 1, distinct: null });
  assert.equal(sizeOf(session, { ...codePass, base: older }).startsWith('a change of 3 files in 2 repositories or folders'),
    true);
  // The hard rule: with and without `within` the step sends the same requests, byte for byte, under the same keys.
  const { within: dropped, ...before } = snapshot.base;
  assert.equal(dropped, '');
  const plain = await passOf({ ...snapshot, base: before }, session);
  assert.equal(plain.codePass.base.within, undefined);
  const bytes = (requests) => requests.map((r) => canon(r));
  assert.ok(seen.length >= 2, seen.map((r) => r.label).join(', '));
  assert.deepEqual(bytes(seen), bytes(plain.seen));
  assert.deepEqual(seen.map(keyOf(snapshot)), plain.seen.map(keyOf(snapshot)));
  assert.ok(seen.every((r) => !canon(r).includes('"within"')), 'no request names the fact');
  // The code step's profile is beta.10's before D178 (commit c0cc3583), byte for byte.
  assert.equal(createHash('sha256').update(canon(CODE_PASS_PROFILE)).digest('hex'),
    'a5277583946e9dec230e25c4d7e158a881128294330f4193aea113943e8a5cc6');
  assert.equal(codePass.version, plain.codePass.version);
});

test('D178: the working directory\'s offset in its repository is recorded under its top folder, never outside it',
  async (t) => {
    const { A } = await worktrees(t);
    const recording = await recordingAt(t);
    await put(A, { 'sub/notes.md': 'notes, changed\n' });
    const session = sessionWriting('s-d178-sub', [['notes.md', 'notes, changed\n']]);
    const snapshot = await readCodeSnapshot(session, { root: join(A, 'sub'), maxBytes: 1_000_000, recording });
    assert.deepEqual([snapshot.base.kind, snapshot.base.within], ['git', 'sub']);
    // A folder in no repository has no git base and no offset.
    const loose = await realpath(await folder(t, 'loose'));
    await put(loose, { 'a.txt': 'a\n' });
    const none = await readCodeSnapshot(sessionWriting('s-d178-loose', [['a.txt', 'a\n']]), { root: loose,
      maxBytes: 1_000_000, recording });
    assert.equal(none.base.within, undefined);
  });

test('D178 (its review): in a folder of the repository, the offset is not empty, the repeat is found, and the requests '
  + 'are the same with and without it', async (t) => {
  // The working directory A/svc-d178; the session writes its src/parse.js and the same bytes into B's.
  const NAME = 'svc-d178';
  const { A, B } = await worktrees(t, { [`${NAME}/src/parse.js`]: BASE_PARSE });
  const recording = await recordingAt(t);
  await put(A, { [`${NAME}/src/parse.js`]: CODE_FILES['src/parse.js'] });
  await put(B, { [`${NAME}/src/parse.js`]: CODE_FILES['src/parse.js'] });
  const session = sessionWriting('s-d178-in', [['src/parse.js', CODE_FILES['src/parse.js']],
    [join(B, NAME, 'src', 'parse.js'), CODE_FILES['src/parse.js']]]);
  const snapshot = await readCodeSnapshot(session, { root: join(A, NAME), maxBytes: 1_000_000, recording });
  assert.deepEqual([snapshot.base.kind, snapshot.base.within], ['git', NAME]);
  const { codePass, seen } = await passOf(snapshot, session);
  assert.equal(codePass.base.within, NAME);
  assert.deepEqual(changeRepeatsOf(codePass), { repeats: 1, unproved: 0, distinct: 1 });
  assert.ok(sizeOf(session, codePass).startsWith(REPORT_HEADER_WORDS.change(2, null, 2, 1)), sizeOf(session, codePass));
  // The hard rule where the fact carries something: the same requests, byte for byte, under the same keys.
  const { within: dropped, ...before } = snapshot.base;
  assert.equal(dropped, NAME);
  const plain = await passOf({ ...snapshot, base: before }, session);
  assert.equal(plain.codePass.base.within, undefined);
  assert.ok(seen.length >= 2, seen.map((r) => r.label).join(', '));
  assert.deepEqual(seen.map((r) => canon(r)), plain.seen.map((r) => canon(r)));
  assert.deepEqual(seen.map(keyOf(snapshot)), plain.seen.map(keyOf(snapshot)));
  // And no request names the offset: past the two folders' own absolute paths, the name is in none of them.
  for (const r of seen) {
    const rest = canon(r).replaceAll(join(A, NAME), '').replaceAll(join(B, NAME), '');
    assert.equal(rest.includes(NAME), false, r.label);
  }
  // A record keeps only an offset that `withinOf` reads (a relative path of whole names that stays in the repository).
  for (const bad of ['..', '../x', 'a/../b', '/abs', './a', 'a\\b']) {
    const odd = await passOf({ ...snapshot, base: { ...snapshot.base, within: bad } }, session);
    assert.equal(odd.codePass.base.within, undefined, bad);
  }
});

test('D178 (its review): a file the rule cannot compare in two worktrees of one commit leaves the size line as before',
  async (t) => {
    const BIN0 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
    const BIN1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x09, 0x09, 0x09, 0x09]);
    // A binary pair beside a text repeat: the binary files have no digest, so whether they repeat is not proved.
    {
      const { A, B } = await worktrees(t, { 'assets/logo.png': BIN0 });
      const recording = await recordingAt(t);
      await put(A, { 'src/parse.js': CODE_FILES['src/parse.js'], 'assets/logo.png': BIN1 });
      await put(B, { 'src/parse.js': CODE_FILES['src/parse.js'], 'assets/logo.png': BIN1 });
      const session = sessionWriting('s-d178-bin', [['src/parse.js', CODE_FILES['src/parse.js']],
        [join(B, 'src', 'parse.js'), CODE_FILES['src/parse.js']], ['assets/logo.png', 'PNG'],
        [join(B, 'assets', 'logo.png'), 'PNG']]);
      const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording });
      const { codePass } = await passOf(snapshot, session);
      assert.equal(codeChangeTally(codePass).total, 4);
      assert.deepEqual(changeRepeatsOf(codePass), { repeats: 1, unproved: 2, distinct: null });
      assert.ok(sizeOf(session, codePass).startsWith('a change of 4 files in 2 repositories or folders'),
        sizeOf(session, codePass));
    }
    // The working directory A/app and a file of its repository outside it (../lib/shared.js), the same in B.
    {
      const { A, B } = await worktrees(t, { 'app/main.js': 'export const m = 1;\n',
        'lib/shared.js': 'export const s = 1;\n' });
      const recording = await recordingAt(t);
      const NEW = 'export const s = 2;\n';
      await put(A, { 'app/main.js': 'export const m = 2;\n', 'lib/shared.js': NEW });
      await put(B, { 'app/main.js': 'export const m = 2;\n', 'lib/shared.js': NEW });
      const session = sessionWriting('s-d178-up', [['main.js', 'export const m = 2;\n'], ['../lib/shared.js', NEW],
        [join(B, 'app', 'main.js'), 'export const m = 2;\n'], [join(B, 'lib', 'shared.js'), NEW]]);
      const snapshot = await readCodeSnapshot(session, { root: join(A, 'app'), maxBytes: 1_000_000, recording });
      assert.equal(snapshot.base.within, 'app');
      const { codePass } = await passOf(snapshot, session);
      const found = changeRepeatsOf(codePass);
      assert.equal(found.repeats, 1, JSON.stringify(found));
      assert.ok(found.unproved >= 1 && found.distinct === null, JSON.stringify(found));
      assert.equal(sizeOf(session, codePass).includes('repeat'), false, sizeOf(session, codePass));
    }
  });
