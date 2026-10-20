// D113 (0.3.0-beta.5; the owner, 2026-10-18: "for the hn5, start work now"): the change under review is the session's
// own. The general problem: with git, the change ran from the session's start commit to the files as they are now, so a
// repository that moved after the session (a later commit, a person's edit, a tree already dirty at the start) gave the
// code review later work as the session's change (the truth check of paid reports: deviation, 248 files, none written by
// the session). The invariant: a path git shows differing from the start commit is part of the change exactly when a
// recorded write of the session (or its helpers) could have changed it — by its name or its real place — and every other
// such path is named apart as changed outside this session's recorded writes, never read and never reviewed; the readers
// say so in fixed words, and a session with no such write says plainly that it had none.
//
// D113's review: every reader of a change with no file to review — the page's lines and the terminal's run-state line —
// decides it by one test and says one why (evidence code-report.js `codeNoChangeOf`); the files named apart are named
// up to a frozen bound and counted whole.
//
// Throwaway repositories in temporary folders, synthetic sessions, a deterministic fake reviewer: no recording, no
// model, no network. Every commit date is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodeSnapshot, sessionsOwnChange, snapshotTexts } from '../src/code-snapshot.js';
import { runSessionReviewCommand, RUN_STATE_WORDS, runStateLine } from '../src/session-review-command.js';
import { CODE_REPORT_WORDS, CODE_REPORT_LIMITS, codeBaseLine, codeChangedOutsideLine, codeCoverageLines }
  from '../../evidence/src/code-report.js';
import { sessionChangeOf } from '../../evidence/src/code-pass.js';
import { CODE_FILES, CODE_TEXT, buildCodeSession, codeJudge, sha256 } from './code-pass-fixture.js';

const W = CODE_REPORT_WORDS;
const START = '2030-01-01T00:00:00.000Z';
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const T1 = { turn: 'T1' };

/** A git repository made of `base` (committed before the session), then `session` (the files as the session left them,
 *  uncommitted), then `later` (committed after the session: the repository moved). */
async function movedRepository(t, { base, session = {}, later = {} }) {
  const root = await mkdtemp(join(tmpdir(), 'sonah-d113-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args, date = '2029-01-01T00:00:00Z') => execFileSync('git', args, { cwd: root, stdio: 'pipe',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
      GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' } }).toString();
  const write = async (files) => {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), text);
    }
  };
  git(['init', '-q', '-b', 'main']);
  await write(base);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  await write(session);
  if (Object.keys(later).length) {
    await write(later);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'later work'], '2031-01-01T00:00:00Z');
  }
  return root;
}
async function recordingAt(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d113-rec-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, `${JSON.stringify({ timestamp: START })}\n`);
  return file;
}
/** A session that writes each of `writes` (`[path, blob]`, the blob's text in `blobs`), then claims and ends. */
const sessionWriting = (key, writes, blobs = {}) => buildCodeSession(key, { ...CODE_TEXT, ...blobs }, [
  { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
  ...writes.flatMap(([path, blob], at) => [{ id: `W${at + 1}`, kind: 'invocation', write: path, blob, ...T1 },
    { id: `W${at + 1}-r`, kind: 'observation', invocation: `W${at + 1}`, blob: 'wrote', ...T1 }]),
  { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
  { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
/** One `sonah review --code-pass` run: every request kept, the story (.md) and the record read back. */
async function reviewIn(t, { root, recording, session, judge = codeJudge() }) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d113-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  let out = '';
  const output = join(dir, 'story.md');
  const state = join(dir, 'state');
  const code = await runSessionReviewCommand([recording, '--concurrency', '1', '--state-dir', state, '--format', 'md',
    '--output', output, '--no-open', '--code-pass'], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: root,
    env: { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(dir, 'claude') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  return { code, calls, out, written: await readFile(output, 'utf8'), report };
}
/** D113's review: the terminal's words of a change with no file to review, by why (RUN_STATE_WORDS.codePass). D123: and
 *  no write that Sonah can read beside shell commands. */
const NO_CHANGE_KEYS = Object.freeze(['noWrite', 'noWrittenChange', 'noFile', 'noSeenWrite']);
/** The story's text with Markdown's escapes taken out. */
const plainText = (md) => md.replace(/\\(.)/g, '$1');

// ---- the invariant, over generated inputs ---------------------------------------------------------------------------

/** A deterministic generator (a linear congruential one): the same seed, the same cases. */
const lcg = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

test('D113 invariant: every path git shows differing is in the change exactly when a recorded write names it, by name or real place, or its last change came inside the session\'s window; every other one is named apart, once, in order', async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d113-inv-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Another spelling of the working directory: a link to it (a recorded write may name a file through either).
  const alias = join(await realpath(tmpdir()), `sonah-d113-alias-${sha256(dir).slice(0, 12)}`);
  await symlink(dir, alias);
  t.after(() => rm(alias, { force: true }));
  await mkdir(join(dir, 'src'), { recursive: true });
  const random = lcg(113);
  const paths = Array.from({ length: 16 }, (_, i) => `src/f${i}.js`);
  for (let round = 0; round < 300; round++) {
    const pick = (p) => paths.filter(() => random() < p);
    const changed = pick(0.5);
    const written = pick(0.4);
    // Each write spelled as the code step names it, or by the link's absolute path (outside the working directory by
    // its spelling); and now and then one outside every folder.
    const plan = written.map((path) => (random() < 0.3 ? { path: join(alias, path), recordedPath: join(alias, path) }
      : { path, recordedPath: path })).map((e) => ({ ...e, changed: true, recorded: true, outside: false, last: null,
      edits: [] }));
    if (random() < 0.3) plan.push({ path: '/sonah-d113-nowhere/x.js', recordedPath: '/sonah-d113-nowhere/x.js',
      changed: true, recorded: true, outside: true, last: null, edits: [] });
    // Each path's last change: before the session's window, inside it, after it, or none (not there any more).
    const window = random() < 0.9 ? { start: 1_000, end: 2_000 } : null;
    const changes = changed.map((path) => ({ gitPath: path, path, type: 'modified',
      mtimeMs: [500, 1_000, 1_500, 2_000, 2_500, null][Math.floor(random() * 6)] }));
    const during = (c) => window !== null && c.mtimeMs !== null && c.mtimeMs >= window.start && c.mtimeMs <= window.end;
    const { plan: after, changedOutside } = await sessionsOwnChange(plan, changes, { dir, window });
    const label = JSON.stringify({ changed: changes.map((c) => [c.path, c.mtimeMs]), window,
      written: plan.map((e) => e.path) });
    // No write is dropped, and each keeps the spelling the record used; a path kept by the window is added after them,
    // with no recorded write.
    assert.deepEqual(after.slice(0, plan.length).map((e) => e.recordedPath), plan.map((e) => e.recordedPath), label);
    const keptByWindow = changes.filter((c) => !written.includes(c.path) && during(c)).map((c) => c.path).sort();
    assert.deepEqual(after.slice(plan.length).map((e) => [e.path, e.recorded]), keptByWindow.map((p) => [p, false]), label);
    // The partition: each differing path is in the change (an entry names it as git does) or named apart, never both.
    const inChange = new Set(after.map((e) => e.path));
    for (const path of changed) assert.notEqual(inChange.has(path), changedOutside.includes(path), `${label} ${path}`);
    // Named apart exactly when no recorded write names it, by its name or by its real place, and its last change did not
    // come inside the window.
    assert.deepEqual(changedOutside, changes.filter((c) => !written.includes(c.path) && !during(c)).map((c) => c.path)
      .sort(), label);
    // Once each, in code-unit order.
    assert.deepEqual(changedOutside, [...new Set(changedOutside)].sort(), label);
  }
});

// ---- the change of a repository that moved after the session ------------------------------------------------------

test('D113: a repository that moved after the session — the change is the session\'s own file; the later files are named apart, never part of it (D113 amended: given to the code review apart, outside the evaluated session)', async (t) => {
  const LATER_DOC = 'SYNTHETIC_LATER_DOC: written by a later commit.\n';
  const DRIFTED = CODE_FILES['src/parse.js'].replace('part.trim()', 'part.trimEnd()');
  const root = await movedRepository(t, { base: { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'],
    'lib/old.js': 'export const old = 1;\n' }, session: { 'src/parse.js': CODE_FILES['src/parse.js'] },
  later: { 'src/parse.js': DRIFTED, 'docs/later.md': LATER_DOC, 'lib/old.js': 'export const old = 2;\n' } });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-d113-moved', [['src/parse.js', 'body']]);
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  // The change: the file the session wrote, shown from the start commit to now and marked as changed after its last
  // recorded edit (the existing drift words); the later files: named apart, not read.
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.diff, f.drifted === true]), [['src/parse.js', 'recorded', true]]);
  assert.deepEqual([snapshot.base.changedOutside, snapshot.base.written], [['docs/later.md', 'lib/old.js'], 1]);
  assert.ok(!snapshotTexts(snapshot).some((text) => text.includes('SYNTHETIC_LATER_DOC') || text.includes('old = 2')));
  // Through the CLI: the change block counts them and names none; D113 amended: the review agent's request alone shows
  // them, in their own block after the change, outside the evaluated session; the record lists them apart, and the story
  // says so.
  const run = await reviewIn(t, { root, recording, session });
  const review = run.calls.find((r) => r.label === 'code-review:agent');
  assert.match(review.prompt, /^- and 2 more paths differ from the start commit in the working directory, changed outside this session's recorded writes: outside the evaluated session, not part of this change$/m);
  const [ownPart, outsidePart] = review.prompt.split('# The files outside the evaluated session');
  assert.ok(outsidePart.includes('docs/later.md') && outsidePart.includes('SYNTHETIC_LATER_DOC'), 'given apart');
  assert.ok(!ownPart.includes('docs/later.md') && !ownPart.includes('lib/old.js'), 'never in the change');
  for (const request of run.calls.filter((r) => r.label !== 'code-review:agent')) {
    assert.ok(!request.prompt.includes('docs/later.md') && !request.prompt.includes('lib/old.js'), request.label);
    assert.ok(!request.prompt.includes('SYNTHETIC_LATER_DOC'), request.label);
  }
  assert.deepEqual(run.report.codePass.files.map((f) => [f.path, f.state]), [['src/parse.js', 'changed_since_session']]);
  assert.deepEqual(run.report.codePass.outsideFiles.map((f) => [f.path, f.state]), [['docs/later.md', 'shown'],
    ['lib/old.js', 'shown']]);
  assert.deepEqual([run.report.codePass.base.changedOutside, run.report.codePass.base.written],
    [['docs/later.md', 'lib/old.js'], 1]);
  const text = plainText(run.written);
  assert.ok(text.includes(W.ownBase(run.report.codePass.base.commit)), text);
  assert.ok(text.includes('2 files that changed outside this session\'s recorded writes are outside the evaluated '
    + 'session: docs/later.md, lib/old.js.'), text);
  assert.ok(text.includes('1 file changed after the session\'s last recorded edit, so Sonah cannot tell whether all of '
    + 'its lines are the agent\'s: src/parse.js'), text);
  assert.ok(text.includes('The change covers 1 file.'), text);
  assert.ok(!text.includes('So it can hold work done after the session'), 'no earlier record\'s caveat');
  // D113's review: the terminal's line speaks of the change reviewed, never of no change.
  assert.ok(!NO_CHANGE_KEYS.some((key) => run.out.includes(RUN_STATE_WORDS.codePass[key])), run.out);
});

test('D113: a file a command of the session changed, with no recorded write, stays in the change by the session\'s window; one changed after it is named apart', async (t) => {
  const root = await movedRepository(t, { base: { 'src/parse.js': BASE_PARSE, 'package.json': '{"v":1}\n',
    'docs/later.md': 'old\n' }, session: { 'src/parse.js': CODE_FILES['src/parse.js'], 'package.json': '{"v":2}\n',
    'docs/later.md': 'later\n' } });
  // The recording runs from START to END; package.json last changed inside that window (a command's write the recording
  // does not show), docs/later.md after it.
  const END = '2030-01-01T00:10:00.000Z';
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d113-rec-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const recording = join(dir, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n${JSON.stringify({ timestamp: END })}\n`);
  await utimes(join(root, 'package.json'), new Date('2030-01-01T00:05:00Z'), new Date('2030-01-01T00:05:00Z'));
  await utimes(join(root, 'docs', 'later.md'), new Date('2030-01-02T00:00:00Z'), new Date('2030-01-02T00:00:00Z'));
  const session = sessionWriting('s-d113-window', [['src/parse.js', 'body']]);
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.diff, f.recorded]), [['src/parse.js', 'recorded', true],
    ['package.json', 'unrecorded_change', false]]);
  assert.deepEqual([snapshot.base.changedOutside, snapshot.base.written], [['docs/later.md'], 1]);
  const run = await reviewIn(t, { root, recording, session });
  const review = run.calls.find((r) => r.label === 'code-review:agent');
  assert.match(review.prompt, /^- package\.json → lines \d+-\d+ · modified · not written by a recorded edit$/m);
  assert.match(review.prompt, /^- and 1 more path differs from the start commit in the working directory, changed outside this session's recorded writes: outside the evaluated session, not part of this change$/m);
  const text = plainText(run.written);
  assert.ok(text.includes(W.ownBase(run.report.codePass.base.commit, 1, 2)), text);
  assert.ok(text.includes('No recorded write of the session changed 1 of its 2 files. That file last changed while the '
    + 'session ran.'), text);
  assert.ok(text.includes('1 file that changed outside this session\'s recorded writes is outside the evaluated '
    + 'session: docs/later.md.'), text);
  assert.ok(text.includes('The change covers 2 files.'), text);
});

test('D113: a session with no recorded write, in a repository that moved — no code review runs on later work, and the page says so plainly', async (t) => {
  const root = await movedRepository(t, { base: { 'src/parse.js': BASE_PARSE }, later: { 'src/parse.js':
    CODE_FILES['src/parse.js'], 'docs/later.md': 'later\n' } });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-d113-none', []);
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.deepEqual([snapshot.files, snapshot.base.changedOutside, snapshot.base.written],
    [[], ['docs/later.md', 'src/parse.js'], 0]);
  const run = await reviewIn(t, { root, recording, session });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls.filter((r) => /^code-/.test(r.label)), [], 'no code review call');
  assert.match(run.out, /^Code review: on \(--code-pass\)\. It reviews the change with read-only access to the whole repository\. It found no change to review here, so it adds no call\./m);
  const text = plainText(run.written);
  assert.ok(text.includes(W.noWrite), text);
  assert.ok(text.includes('Sonah did not review 2 files that changed outside this session\'s recorded writes. They '
    + 'are outside the evaluated session: docs/later.md, src/parse.js.'), text);
  assert.ok(!text.includes(W.noFile), 'never that no file differs');
  // D113's review: the terminal's line says what the page says — no write that could have changed a file — never that
  // Sonah found no changed file here (two files differ).
  assert.ok(run.out.includes(`code review ${RUN_STATE_WORDS.codePass.noWrite})`), run.out);
  assert.ok(!run.out.includes(RUN_STATE_WORDS.codePass.noFile), run.out);
  // With no change, the code review's notes say neither where an empty change runs from nor that it proposed nothing.
  assert.ok(!text.includes(W.ownBase(run.report.codePass.base.commit)), text);
  assert.ok(!text.includes(W.proposedNone), text);
});

test('D113: writes only where the code review does not read (the deviation shape) — no change to review, the later files named apart, the writes counted', async (t) => {
  const root = await movedRepository(t, { base: { 'src/parse.js': BASE_PARSE }, later: { 'docs/later.md': 'later\n' } });
  const recording = await recordingAt(t);
  // D117: a write in a folder of no repository is now reviewed there (d117-every-place.test.js); a write named from the
  // home folder stays out, only counted.
  const session = sessionWriting('s-d113-scratch', [['~/notes/input.txt', 'scratchBody']], { scratchBody: 'scratch\n' });
  const run = await reviewIn(t, { root, recording, session });
  assert.deepEqual(run.calls.filter((r) => /^code-/.test(r.label)), []);
  assert.deepEqual([run.report.codePass.base.changedOutside, run.report.codePass.base.written], [['docs/later.md'], 1]);
  assert.deepEqual(run.report.codePass.footer, [{ kind: 'outside_root', count: 1, home: 1 }]);
  const text = plainText(run.written);
  assert.ok(text.includes(W.noWrittenChange), text);
  assert.ok(text.includes('Sonah did not review 1 file that changed outside this session\'s recorded writes. It is '
    + 'outside the evaluated session: docs/later.md.'), text);
  assert.ok(text.includes('1 path that the session wrote to in a coding agent\'s home folder, in Sonah\'s own folders or '
    + 'under a name from your '
    + 'home folder, which Sonah counts but did not review'), text);
  assert.ok(!text.includes(W.noFile) && !text.includes(W.noWrite));
  // D113's review: no code-review call ran, so the terminal never says it covered the whole change: it says what the
  // page says (the change holds only writes outside the folders the review can read: no change to review).
  assert.ok(run.out.includes(`code review ${RUN_STATE_WORDS.codePass.noWrittenChange})`), run.out);
  assert.ok(!run.out.includes(RUN_STATE_WORDS.codePass.complete), run.out);
  assert.ok(!text.includes(W.ownBase(run.report.codePass.base.commit)) && !text.includes(W.proposedNone), text);
});

test('D113: a write the record spelled by the working directory\'s real path is the session\'s, never "changed outside"', async (t) => {
  const real = await movedRepository(t, { base: { 'src/parse.js': BASE_PARSE } });
  await writeFile(join(real, 'src', 'parse.js'), CODE_FILES['src/parse.js']);
  // The working directory as the recording names it: a link to the repository's real folder.
  const root = join(await realpath(tmpdir()), `sonah-d113-link-${sha256(real).slice(0, 12)}`);
  await symlink(real, root);
  t.after(() => rm(root, { force: true }));
  const recording = await recordingAt(t);
  const session = sessionWriting('s-d113-spelled', [[join(await realpath(real), 'src', 'parse.js'), 'body']]);
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.base.changedOutside, []);
  assert.deepEqual(snapshot.files.filter((f) => f.diff !== undefined).map((f) => f.path), ['src/parse.js']);
});

// ---- the readers: an earlier record keeps its words -----------------------------------------------------------------

test('D113 readers: a record of code-snapshot/13 says the change is the session\'s own; an earlier record keeps its words', () => {
  const commit = 'a'.repeat(40);
  const pass = (base, files = []) => ({ ran: true, base, files, withheld: [], footer: [], coverage: 'complete' });
  const one = [{ path: 'src/a.js', state: 'shown', diff: 'recorded' }];
  // An earlier record (no `written`): its words, no line named apart; with no file, no base line (D113's review).
  const earlier = pass({ kind: 'git', commit, how: 'reflog' });
  assert.deepEqual(sessionChangeOf(earlier.base), {});
  assert.equal(codeBaseLine({ ...earlier, files: one }), W.base(commit, 0, 0));
  assert.equal(codeBaseLine(earlier), null);
  assert.equal(codeChangedOutsideLine(earlier), null);
  assert.deepEqual(codeCoverageLines(earlier), [W.noFile]);
  // code-snapshot/13 with git: the base line, the files named apart, and the empty change said by the session's writes;
  // an empty change has no base line (D113's review: it runs from nowhere to nothing).
  const none = pass({ kind: 'git', commit, how: 'reflog', changedOutside: ['b.md', 'a.md', 'a.md'], written: 0 });
  assert.deepEqual(sessionChangeOf(none.base), { written: 0, changedOutside: ['a.md', 'b.md'] });
  assert.equal(codeBaseLine({ ...none, files: one }), W.ownBase(commit));
  assert.equal(codeBaseLine(none), null);
  assert.equal(codeChangedOutsideLine(none), W.changedOutside(['a.md', 'b.md']));
  assert.deepEqual(codeCoverageLines(none), [W.noWrite]);
  const elsewhere = pass({ kind: 'git', commit, how: 'reflog', changedOutside: ['a.md'], written: 2 });
  assert.deepEqual(codeCoverageLines(elsewhere), [W.noWrittenChange]);
  const quiet = pass({ kind: 'git', commit, how: 'reflog', changedOutside: [], written: 2 });
  assert.deepEqual([codeCoverageLines(quiet), codeChangedOutsideLine(quiet), codeBaseLine(quiet)], [[W.noFile], null,
    null]);
  // A change that holds only writes outside the working directory (the deviation shape) is no change to review.
  const away = pass({ kind: 'git', commit, how: 'reflog', changedOutside: ['a.md'], written: 1 },
    [{ path: '/elsewhere/x.txt', state: 'outside_root' }]);
  assert.deepEqual([codeCoverageLines(away), codeBaseLine(away)], [[W.noWrittenChange], null]);
  // No git base: no file is named apart; a session with no write says so.
  const edits = pass({ kind: 'recorded_edits', written: 0, changedOutside: ['ignored.md'] });
  assert.deepEqual(sessionChangeOf(edits.base), { written: 0 });
  assert.deepEqual([codeCoverageLines(edits), codeChangedOutsideLine(edits)], [[W.noWrite], null]);
  // A step that did not run names nothing.
  assert.equal(codeChangedOutsideLine({ ...none, ran: false }), null);
  // D113's review: the line names at most CODE_REPORT_LIMITS.changedOutsideNames files, the first in code-unit order,
  // and counts the others; it always counts them all (a later merge can leave thousands).
  const bound = CODE_REPORT_LIMITS.changedOutsideNames;
  for (const n of [1, bound, bound + 1, 248]) {
    const paths = Array.from({ length: n }, (_, i) => `docs/f${String(i).padStart(3, '0')}.md`);
    const line = codeChangedOutsideLine(pass({ kind: 'git', commit, how: 'reflog', changedOutside: [...paths].reverse(),
      written: 1 }, one));
    assert.equal(line, W.changedOutside(paths.slice(0, bound), Math.max(0, n - bound)), `${n}`);
    assert.ok(line.startsWith(`Sonah did not review ${n} ${n === 1 ? 'file' : 'files'} that changed outside`), line);
    assert.equal(paths.filter((p) => line.includes(p)).length, Math.min(n, bound), `${n}`);
    assert.equal(line.endsWith(`, and ${n - bound} more`), n > bound, line);
  }
});

// ---- D113's review: the terminal and the page say the same of an empty change -----------------------------------

test('D113 review invariant: over generated records, the terminal\'s line says the code review had no change to review exactly when the page does, by the same why; then neither a base line nor "covered the whole change"', () => {
  const random = lcg(1131);
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const commit = 'b'.repeat(40);
  const STATES = ['shown', 'outside_root', 'deleted', 'binary', 'changed_since_session', 'other_repository'];
  const seen = new Set();
  for (let round = 0; round < 600; round++) {
    const files = Array.from({ length: Math.floor(random() * 3) }, (_, i) => ({ path: `src/f${i}.js`,
      state: pick(STATES) }));
    const outside = files.filter((f) => f.state === 'outside_root');
    const written = Math.floor(random() * 3);
    const base = pick([{ kind: 'git', commit, how: 'reflog' },
      { kind: 'git', commit, how: 'reflog', written, changedOutside: random() < 0.5 ? [] : ['docs/later.md'] },
      { kind: 'recorded_edits', written }]);
    const pass = { ran: true, base, files, ...(random() < 0.8 ? { withheld: [] } : {}),
      footer: outside.length && random() < 0.5 ? [{ kind: 'withheld', path: outside[0].path, state: 'outside_root' }]
        : [],
      coverage: pick(['complete', 'partial', 'missing']), required: random() < 0.5,
      // D123: a session that ran a shell command (the record's `unseenEdits`).
      ...(random() < 0.3 ? { unseenEdits: true } : {}) };
    const report = { reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete', findings: [],
      codePass: pass };
    const line = runStateLine(report, 'initial');
    const label = `${JSON.stringify(pass)} ${line}`;
    const page = codeCoverageLines(pass)[0];
    const pageKey = NO_CHANGE_KEYS.find((key) => page === W[key]) ?? null;
    const termKey = NO_CHANGE_KEYS.find((key) => line.includes(`code review ${RUN_STATE_WORDS.codePass[key]})`))
      ?? null;
    assert.equal(termKey, pageKey, label);
    seen.add(pageKey);
    if (pageKey !== null) {
      assert.equal(codeBaseLine(pass), null, label);
      assert.ok(!line.includes(RUN_STATE_WORDS.codePass.complete), label);
    }
  }
  // Every why is generated, and changes that hold a file.
  assert.deepEqual([...seen].sort(), [null, ...NO_CHANGE_KEYS].sort());
});

test('D113 review docs/TROUBLESHOOTING.md: the row of the files named apart keeps the page\'s bound and names the session\'s own moves and deletes among them; each why of the terminal\'s empty change is explained', async () => {
  const doc = await readFile(new URL('../../../docs/TROUBLESHOOTING.md', import.meta.url), 'utf8');
  const flat = (text) => text.replace(/\s+/g, ' ');
  const row = doc.split('\n').find((line) => line.startsWith('  | Sonah did not review files that changed outside'));
  assert.ok(row, 'the row of the files named apart');
  assert.ok(row.includes(`the first ${CODE_REPORT_LIMITS.changedOutsideNames}, then how many more`), row);
  assert.ok(row.includes('A file that a command of the session deleted or moved'), row);
  assert.ok(!row.includes('their last change did not come while the session ran'), 'false for a moved or deleted file');
  const at = doc.indexOf('**`Sonah\'s review: ... code review had no change to review, because ...`**');
  assert.ok(at >= 0, 'the terminal line\'s entry');
  const entry = flat(doc.slice(at, doc.indexOf('\n**', at + 1)));
  for (const key of NO_CHANGE_KEYS) {
    const [, why] = RUN_STATE_WORDS.codePass[key].split('because ');
    assert.ok(entry.includes(why), `${key}: ${why}`);
  }
});
