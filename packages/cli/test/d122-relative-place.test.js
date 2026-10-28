// D122 (d) (0.3.0-beta.5; the owner, 2026-10-19: "fix 5 in beta 5 only"): a path that the code review or a check names
// relative to the top folder of ANOTHER repository of the change (a D117 place) names that repository's file. The
// dogfood rerun of beta.5 (private, fixes/global/dogfood/RERUN-B5RC.md): the review agent named a file of the sibling
// worktree that held the whole change by its path from that worktree's top; Sonah read the working folder's file of that
// name, did not find the quote and withheld a real finding, and dropped all 14 of its file notes as no file of the
// change. The general rule, by structure only: a relative path is resolved against the places of the change (the working
// folder's repository when it holds a file of the change, and each other place that holds one), literally and never from
// a home-spelled name; exactly one file it names is the one it means, and one that names an existing file in more than
// one place names none (`path_ambiguous`, D107's "ambiguous matches match none"). A quote is checked word for word in
// the file it resolves to. With no other place, every path reads as before.
//
// Throwaway repositories in temporary folders, synthetic sessions, a deterministic fake reviewer: no recording of a real
// session, no model, no network. Every commit date is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRepositoryReader, readCodeSnapshot } from '../src/code-snapshot.js';
import { reviewCodePass } from '../src/session-review.js';
import { CODE_ITEM_ERROR_WORDS, CODE_BRIEFS_ABSOLUTE, fileNoteShape, manyPlacesHold, placesHolding }
  from '../../evidence/src/code-pass.js';
import { CODE_REPORT_WORDS } from '../../evidence/src/code-report.js';
import { CODE_TEXT, buildCodeSession, codeJudge, holds } from './code-pass-fixture.js';

const START = '2030-01-01T00:00:00.000Z';
const END = '2030-01-02T00:00:00.000Z';
const T1 = { turn: 'T1' };
const GIT_ENV = (date) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
  GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' });
const git = (cwd, args, date = '2029-01-01T00:00:00Z') => execFileSync('git', args, { cwd, stdio: 'pipe',
  env: GIT_ENV(date) }).toString();

async function folder(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-d122d-${name}-`));
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
  const dir = await folder(t, 'rec');
  const file = join(dir, 'recording.jsonl');
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
const memoryStore = () => ({ lock: async () => async () => {}, saveReport: async () => {} });

/**
 * Two worktree-like repositories of one project: the working repository A and a sibling B, each holding `lib/b.js` with
 * the same text at the start. The session changes B's `lib/b.js` (by its absolute path), and, with `inA`, A's `src/a.js`
 * too (so A holds a file of the change). B also holds a file whose literal name has a `$` (D122 (a)), changed by the
 * session.
 */
async function workspace(t, { inA = false } = {}) {
  const base = await realpath(await folder(t, 'ws'));
  const A = await committed(join(base, 'A'), { 'lib/b.js': 'export const b = 1;\n', 'src/a.js': 'export const a = 1;\n',
    'only-a.md': 'A alone\n' });
  const B = await committed(join(base, 'B'), { 'lib/b.js': 'export const b = 1;\n',
    'routes/users.$id.js': 'export const id = 1;\n', 'gone.js': 'export const gone = 1;\n' });
  await put(B, { 'lib/b.js': 'export const b = 2;\n', 'routes/users.$id.js': 'export const id = 2;\n' });
  if (inA) await put(A, { 'src/a.js': 'export const a = 2;\n' });
  const writes = [...(inA ? [['src/a.js', 'export const a = 2;\n']] : []),
    [join(B, 'lib', 'b.js'), 'export const b = 2;\n'], [join(B, 'routes', 'users.$id.js'), 'export const id = 2;\n']];
  const session = sessionWriting(inA ? 's-d122d-both' : 's-d122d-sibling', writes);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording: await recordingAt(t) });
  return { A, B, session, snapshot };
}
/** The reader the code step grounds through (session-review.js `codeStepReader`). */
const readerOf = (snapshot) => createRepositoryReader({ root: snapshot.dir, top: snapshot.top,
  commit: snapshot.base?.commit ?? null, maxBytes: 1_000_000, places: placesHolding(snapshot.base, snapshot.files),
  files: snapshot.files });

/** The review agent's answer: a bug, its triage place and a file note, each on `path` (as the agent spelled it). */
const answerOn = (path, { also = [] } = {}) => () => ({
  findings: [{ kind: 'bug', lens: 'behaviour', title: 'b is 2 where its caller still expects 1', claims: [],
    input: 'import { b }', trace: [{ step: 'The constant changed.', path, side: 'new', startLine: 1, endLine: 1,
      quote: 'export const b = 2;' }], anchor: { path, side: 'new', startLine: 1, endLine: 1 }, leadsFrom: [] },
  ...also],
  questions: [],
  triage: [{ key: 'F1', level: 'high', impact: 'Callers read the wrong value.', action: 'Restore b or its callers.',
    label: 'b changed', where: { path, side: 'new', startLine: 1, endLine: 1, quote: 'export const b = 2;' } }],
  files: [{ path, what: 'b moves from 1 to 2', asks: [] }] });
/** A finding on the working repository's own file, named relative to the working directory. */
const onA = { kind: 'bug', lens: 'behaviour', title: 'a is 2 where its caller still expects 1', claims: [],
  input: 'import { a }', trace: [{ step: 'The constant changed.', path: 'src/a.js', side: 'new', startLine: 1, endLine: 1,
    quote: 'export const a = 2;' }], anchor: { path: 'src/a.js', side: 'new', startLine: 1, endLine: 1 }, leadsFrom: [] };

test('D122 (d): a finding, its triage place and a file note on another repository\'s file, named relative to that '
  + 'repository, are kept on that file (the dogfood rerun\'s case: the working repository holds no file of the change)',
async (t) => {
  const { A, B, session, snapshot } = await workspace(t);
  // The shape of the case: B is the one place of the change; A holds no file of it, and holds lib/b.js too.
  assert.deepEqual(placesHolding(snapshot.base, snapshot.files).map((p) => p.at), [B]);
  assert.ok(snapshot.files.every((f) => f.place === B || f.diff === undefined));
  const { report } = await reviewCodePass({ session, report: {}, snapshot, judge: codeJudge({ review: answerOn('lib/b.js') }),
    answerCache: null, store: memoryStore(), backend: 'claude-cli' });
  const pass = report.codePass;
  // Published, by the name the change gives the file; its quote checked in B's file, word for word.
  assert.deepEqual(pass.withheld, []);
  assert.deepEqual(pass.findings.map((f) => [f.anchor.path, f.title]), [[join(B, 'lib', 'b.js'),
    'b is 2 where its caller still expects 1']]);
  assert.deepEqual(pass.findings[0].trace.map((s) => [s.path, s.quote]), [[join(B, 'lib', 'b.js'), 'export const b = 2;']]);
  // The triage place and the file note stand on the same file.
  assert.deepEqual(pass.triage.map((e) => e.where?.path), [join(B, 'lib', 'b.js')]);
  assert.deepEqual(pass.filesDropped, []);
  assert.equal(pass.files.find((f) => f.path === join(B, 'lib', 'b.js'))?.what, 'b moves from 1 to 2');
  assert.ok(!JSON.stringify(pass).includes(A), 'nothing of the working repository is cited');
});

test('D122 (d): a file the change names by another spelling (the session wrote it through a link) is named by the '
  + 'change\'s name, so a relative note on it is kept', async (t) => {
  const base = await realpath(await folder(t, 'link'));
  const A = await committed(join(base, 'A'), { 'lib/b.js': 'export const b = 1;\n' });
  const B = await committed(join(base, 'B'), { 'lib/b.js': 'export const b = 1;\n' });
  await put(B, { 'lib/b.js': 'export const b = 2;\n' });
  const link = join(base, 'B-link');
  await symlink(B, link);
  const session = sessionWriting('s-d122d-link', [[join(link, 'lib', 'b.js'), 'export const b = 2;\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording: await recordingAt(t) });
  assert.deepEqual(snapshot.files.filter((f) => f.diff !== undefined).map((f) => [f.path, f.place]),
    [[join(link, 'lib', 'b.js'), B]]);
  assert.deepEqual(readerOf(snapshot).name('lib/b.js'), { path: join(link, 'lib', 'b.js') });
  const { report } = await reviewCodePass({ session, report: {}, snapshot, judge: codeJudge({ review: answerOn('lib/b.js') }),
    answerCache: null, store: memoryStore(), backend: 'claude-cli' });
  assert.deepEqual(report.codePass.findings.map((f) => f.anchor.path), [join(link, 'lib', 'b.js')]);
  assert.deepEqual(report.codePass.filesDropped, []);
  assert.equal(report.codePass.files.find((f) => f.path === join(link, 'lib', 'b.js'))?.what, 'b moves from 1 to 2');
});

test('D122 (d): a check that names the file relative to its repository grounds there too', async (t) => {
  const { B, session, snapshot } = await workspace(t);
  // The checking agent quotes every code step of the trace, each path named from B's top folder.
  const relativeHolds = (finding) => {
    const verdict = holds(finding);
    const strip = (r) => ({ ...r, path: r.path.startsWith(`${B}/`) ? r.path.slice(B.length + 1) : r.path });
    return { ...verdict, receipts: verdict.receipts.map(strip),
      premises: verdict.premises.map((p) => ({ ...p, receipts: p.receipts.map(strip) })) };
  };
  const seen = [];
  const { report } = await reviewCodePass({ session, report: {}, snapshot, answerCache: null, store: memoryStore(),
    backend: 'claude-cli', judge: codeJudge({ review: answerOn(join(B, 'lib', 'b.js')), verify: relativeHolds, seen }) });
  const pass = report.codePass;
  assert.ok(seen.some((r) => r.label === 'code-verify:F1'));
  assert.deepEqual(pass.withheld, []);
  assert.deepEqual(pass.findings.map((f) => [f.anchor.path, f.check?.verdict]), [[join(B, 'lib', 'b.js'), 'holds']]);
});

test('D122 (d): a relative path that names an existing file in more than one place of the change names none — the '
  + 'finding is withheld with the closed cause path_ambiguous, its repair is told so, and the file note is dropped; a '
  + 'path only the working repository holds reads as before', async (t) => {
  const { A, B, session, snapshot } = await workspace(t, { inA: true });
  // Both repositories hold a file of the change, and both hold lib/b.js.
  assert.deepEqual(placesHolding(snapshot.base, snapshot.files).map((p) => p.at), [B]);
  assert.ok(snapshot.files.some((f) => f.path === 'src/a.js' && f.place === undefined && f.diff !== undefined));
  const seen = [];
  const { report } = await reviewCodePass({ session, report: {}, snapshot, answerCache: null, store: memoryStore(),
    backend: 'claude-cli', judge: codeJudge({ review: answerOn('lib/b.js', { also: [onA] }), seen }) });
  const pass = report.codePass;
  assert.deepEqual(pass.withheld.map((w) => [w.what, w.text, w.reason, w.cause]), [['finding',
    'b is 2 where its caller still expects 1', 'evidence_grounding_failed', 'path_ambiguous']]);
  // The working repository's own file, by its relative path: published as before.
  assert.deepEqual(pass.findings.map((f) => [f.anchor.path, f.title]), [['src/a.js',
    'a is 2 where its caller still expects 1']]);
  assert.deepEqual(pass.filesDropped, [{ key: 'lib/b.js', index: 0, cause: 'path_ambiguous' }]);
  // The one repair names the cause in its fixed words.
  const repair = seen.find((r) => r.label === 'code-review:repair');
  assert.ok(repair?.prompt.includes(CODE_ITEM_ERROR_WORDS.path_ambiguous), repair?.prompt);
  // The page's words for the cause.
  assert.equal(CODE_REPORT_WORDS.causes.path_ambiguous, 'it names a path that more than one repository of the change '
    + 'holds, so Sonah could not tell which file it means');
  // A repair that names the file by its absolute path is published. The failing finding's anchor names no file, so no
  // item of the repair can be matched to it by identity (D107: its lines are no lines of a readable file version): it
  // stays withheld, with why no repair item stood in its place, and the repair's finding is added.
  const fixed = await reviewCodePass({ session, report: {}, snapshot, answerCache: null, store: memoryStore(),
    backend: 'claude-cli', judge: codeJudge({ review: answerOn('lib/b.js', { also: [onA] }),
      repair: () => answerOn(join(B, 'lib', 'b.js'), { also: [onA] })() }) });
  assert.deepEqual(fixed.report.codePass.findings.map((f) => f.anchor.path).sort(), [join(B, 'lib', 'b.js'), 'src/a.js']
    .sort());
  assert.deepEqual(fixed.report.codePass.withheld.map((w) => [w.cause, w.repair]), [['path_ambiguous', 'unplaced']]);
  assert.ok(!JSON.stringify(pass.findings).includes(join(A, 'lib')), 'the working repository\'s lib/b.js is never cited');
});

test('D122 (d): the reader\'s name — with no other place every path is itself; absolute and home-spelled paths are '
  + 'never resolved against a place; a literal $ name, a file of the change no longer there, and a path that leaves its '
  + 'place', async (t) => {
  // One place: the working repository alone. Every path, whatever exists, is itself.
  const lone = await workspace(t, { inA: true });
  const single = createRepositoryReader({ root: lone.snapshot.dir, top: lone.snapshot.top, maxBytes: 1_000_000,
    files: lone.snapshot.files });
  for (const path of ['lib/b.js', 'src/a.js', 'nothing.js', '~/lib/b.js']) assert.deepEqual(single.name(path), { path });
  // The dogfood's shape: B is the one place of the change, A holds none.
  const { A, B, snapshot } = await workspace(t);
  const reader = readerOf(snapshot);
  assert.deepEqual(reader.name('lib/b.js'), { path: join(B, 'lib', 'b.js') });
  assert.equal(reader.read(reader.name('lib/b.js').path).text, 'export const b = 2;\n');
  // D122 (a): literally — a `$` in the spelling is never expanded.
  assert.deepEqual(reader.name('routes/users.$id.js'), { path: join(B, 'routes', 'users.$id.js') });
  // A file only the working repository holds, and a file nowhere: themselves, read as before.
  assert.deepEqual(reader.name('only-a.md'), { path: 'only-a.md' });
  assert.equal(reader.read('only-a.md').text, 'A alone\n');
  assert.deepEqual(reader.name('nothing.js'), { path: 'nothing.js' });
  // D109: a home-spelled path names the home folder, never a place, even where a place holds a folder of that literal
  // name; an absolute path is itself.
  await put(B, { '~/n.md': 'tilde\n', '$HOME/n.md': 'home\n' });
  for (const path of ['~/n.md', '$HOME/n.md', '~/lib/b.js', '${HOME}/lib/b.js', join(A, 'lib', 'b.js')])
    assert.deepEqual(reader.name(path), { path });
  // A path that leaves its place's top folder names nothing there; one that comes back into it names its file.
  assert.deepEqual(reader.name('../A/only-a.md'), { path: '../A/only-a.md' });
  assert.deepEqual(reader.name('../B/lib/b.js'), { path: join(B, 'lib', 'b.js') });
  // A file of the change that is not there now (deleted) is named by the change's name, so its old side reads.
  await rm(join(B, 'lib', 'b.js'));
  const gone = createRepositoryReader({ root: snapshot.dir, top: snapshot.top, commit: snapshot.base?.commit ?? null,
    maxBytes: 1_000_000, places: placesHolding(snapshot.base, snapshot.files), files: snapshot.files });
  assert.deepEqual(gone.name('lib/b.js'), { path: join(B, 'lib', 'b.js') });
  assert.equal(gone.base(gone.name('lib/b.js').path).text, 'export const b = 1;\n');
  // A file of B that is no file of the change and is not there: nothing in B, so itself.
  await rm(join(B, 'gone.js'));
  assert.deepEqual(gone.name('gone.js'), { path: 'gone.js' });
  // A file of the working repository's change that is not there now still names a file there: with one of that name in
  // B, the path names two.
  const both = await workspace(t, { inA: true });
  await rm(join(both.A, 'src', 'a.js'));
  await put(both.B, { 'src/a.js': 'export const a = 1;\n' });
  assert.deepEqual(readerOf(both.snapshot).name('src/a.js'), { ambiguous: true });
  assert.deepEqual(readerOf(both.snapshot).name('lib/b.js'), { ambiguous: true });
});

test('D122 (d): a file note is checked on the name its path resolves to (fileNoteShape `name`)', () => {
  const paths = new Set(['/w/B/lib/b.js', 'src/a.js']);
  const note = (path) => ({ path, what: 'a note', asks: [] });
  const name = (path) => (path === 'lib/b.js' ? { path: '/w/B/lib/b.js' } : path === 'lib/both.js' ? { ambiguous: true }
    : { path });
  assert.deepEqual(fileNoteShape(note('lib/b.js'), { paths, name }), { ok: true });
  assert.deepEqual(fileNoteShape(note('src/a.js'), { paths, name }), { ok: true });
  assert.deepEqual(fileNoteShape(note('lib/both.js'), { paths, name }), { ok: false, error: 'path_ambiguous',
    at: 'files.path "lib/both.js"' });
  assert.deepEqual(fileNoteShape(note('lib/x.js'), { paths, name }), { ok: false, error: 'file_not_in_change',
    at: 'files.path "lib/x.js"' });
  // With no resolver, the path is itself, as before.
  assert.deepEqual(fileNoteShape(note('lib/b.js'), { paths }), { ok: false, error: 'file_not_in_change',
    at: 'files.path "lib/b.js"' });
});

test('D147: through the repository reader, a check whose receipt names a relative path that both repositories hold is '
  + 'void with its own cause and re-asked in the repair\'s words; named by its absolute path, it grounds', async (t) => {
  const { B, session, snapshot } = await workspace(t, { inA: true });
  assert.equal(manyPlacesHold(snapshot.files, placesHolding(snapshot.base, snapshot.files)), true);
  // The checking agent quotes every code step of the trace, each path named from B's top folder: a relative path that
  // the working repository holds too. On its re-ask, by its absolute path when `again`.
  const checkOf = (again) => (finding, request) => {
    const verdict = holds(finding);
    const absolute = /:reask$/.test(request.label) && again;
    const strip = (r) => ({ ...r, path: !absolute && r.path.startsWith(`${B}/`) ? r.path.slice(B.length + 1) : r.path });
    return { ...verdict, receipts: verdict.receipts.map(strip),
      premises: verdict.premises.map((p) => ({ ...p, receipts: p.receipts.map(strip) })) };
  };
  for (const again of [true, false]) {
    const seen = [];
    const { report } = await reviewCodePass({ session, report: {}, snapshot, answerCache: null, store: memoryStore(),
      backend: 'claude-cli', judge: codeJudge({ review: answerOn(join(B, 'lib', 'b.js')), verify: checkOf(again),
        seen }) });
    const pass = report.codePass;
    // Every brief says that a path is the file's absolute path (the review's and the finding's check's: the report holds
    // no item for the accounting).
    assert.deepEqual([...new Set(seen.filter((r) => r.label.startsWith('code-')).map((r) => r.system))].sort(),
      [CODE_BRIEFS_ABSOLUTE.reviewWholeFiles, CODE_BRIEFS_ABSOLUTE.verify].sort());
    const reask = seen.find((r) => r.label === 'code-verify:F1:reask');
    assert.ok(reask?.prompt.includes(`receipt_path_ambiguous (${CODE_ITEM_ERROR_WORDS.path_ambiguous}) at lib/b.js:1`),
      reask?.prompt.slice(-400));
    if (again) {
      assert.deepEqual(pass.withheld, []);
      assert.deepEqual(pass.findings.map((f) => [f.anchor.path, f.check?.verdict]), [[join(B, 'lib', 'b.js'), 'holds']]);
    } else {
      assert.deepEqual(pass.findings, []);
      assert.deepEqual(pass.withheld.map((w) => [w.reason, w.cause]), [['verify_unexecuted', 'receipt_path_ambiguous']]);
    }
  }
});

test('D147: with more than one place, the reader reads an absolute path of a file of the change under the change\'s '
  + 'name, so a file note named by its absolute path is kept; any other absolute path, and every path with one place, '
  + 'is itself', async (t) => {
  const { A, B, session, snapshot } = await workspace(t, { inA: true });
  const reader = readerOf(snapshot);
  // A file of the working repository's change, by its absolute path: its relative name, as the change gives it.
  assert.deepEqual(reader.name(join(A, 'src', 'a.js')), { path: 'src/a.js' });
  // Another place's file of the change, by its absolute path: the change's name for it.
  assert.deepEqual(reader.name(join(B, 'lib', 'b.js')), { path: join(B, 'lib', 'b.js') });
  // An absolute path that names no file of the change (one the working repository holds, unchanged; one nowhere): itself.
  for (const path of [join(A, 'only-a.md'), join(A, 'lib', 'b.js'), join(A, 'nothing.js')])
    assert.deepEqual(reader.name(path), { path });
  // A file of the change that is gone now, by its absolute path: still the change's name.
  await rm(join(A, 'src', 'a.js'));
  assert.deepEqual(readerOf(snapshot).name(join(A, 'src', 'a.js')), { path: 'src/a.js' });
  await put(A, { 'src/a.js': 'export const a = 2;\n' });
  // One place (the working repository alone, or another place alone): an absolute path is itself, as before.
  const lone = createRepositoryReader({ root: snapshot.dir, top: snapshot.top, maxBytes: 1_000_000, files: snapshot.files });
  assert.deepEqual(lone.name(join(A, 'src', 'a.js')), { path: join(A, 'src', 'a.js') });
  const sibling = await workspace(t);
  assert.deepEqual(readerOf(sibling.snapshot).name(join(sibling.B, 'lib', 'b.js')), { path: join(sibling.B, 'lib', 'b.js') });
  assert.deepEqual(readerOf(sibling.snapshot).name(join(sibling.A, 'only-a.md')), { path: join(sibling.A, 'only-a.md') });
  // Through the code step: a file note on the working repository's file by its absolute path is kept, on that file; the
  // same note by the relative path that both repositories hold is dropped, as before.
  const noted = (path) => () => ({ findings: [onA], questions: [], triage: [],
    files: [{ path, what: 'a moves from 1 to 2', asks: [] }] });
  const absolute = await reviewCodePass({ session, report: {}, snapshot, judge: codeJudge({ review: noted(join(A, 'src',
    'a.js')) }), answerCache: null, store: memoryStore(), backend: 'claude-cli' });
  assert.deepEqual(absolute.report.codePass.filesDropped, []);
  assert.equal(absolute.report.codePass.files.find((f) => f.path === 'src/a.js')?.what, 'a moves from 1 to 2');
  const relative = await reviewCodePass({ session, report: {}, snapshot, judge: codeJudge({ review: noted('lib/b.js') }),
    answerCache: null, store: memoryStore(), backend: 'claude-cli' });
  assert.deepEqual(relative.report.codePass.filesDropped, [{ key: 'lib/b.js', index: 0, cause: 'path_ambiguous' }]);
});
