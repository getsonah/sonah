// D117 (0.3.0-beta.5; the owner, 2026-10-18: "the changes that happened outside the worktree but is relevant to this
// session should also be reviewed, make this default and fix this as well please, this is a major fix and need to go
// with beta 5"): the change under review is the session's own in every repository and folder it wrote to, not only in
// the working folder's repository. The general problem: a recorded write outside the working directory — a sibling git
// worktree, another repository, a notes or scratch folder in none — was only counted (D109), so a session whose work
// lay elsewhere had "no change to review" (the dogfood case: 46 paths, 23 readable in folders of no repository, 2 in
// other git repositories, 0 reviewed). The invariants: every recorded write is placed by its real place and the git
// repository that holds it (git's own top folder, never a path's spelling); in a readable repository it is in the change
// or has no difference from that repository's base (its HEAD when the session began, by the reflog), and the paths
// there that no recorded write touched are named apart; in a folder of no repository its change is the recorded edits;
// only a write in a harness home or under a home-spelled name stays out, counted. The counts add up per place; the
// working folder's repository comes first; the agents read each place's folder (`--add-dir`), and nothing else widens.
//
// Throwaway repositories in temporary folders, synthetic sessions, a deterministic fake reviewer: no recording of a real
// session, no model, no network. Every commit date is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, lutimes, mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { agentFolders, changeState, createRepositoryReader, literalSpellings, readCodeSnapshot, repositoryState,
  snapshotTexts } from '../src/code-snapshot.js';
import { codeSnapshotLine, codeStepLine, CODE_SNAPSHOT_WORDS, CODE_STEP_WORDS, runSessionReviewCommand }
  from '../src/session-review-command.js';
import { reviewCodePass } from '../src/session-review.js';
import { CODE_REPORT_WORDS, codeBaseLine, codeCoverageLines, codeFooterLines, codeNoChangeOf, codePlaceLines,
  codeWritesLines } from '../../evidence/src/code-report.js';
import { agentsRead, changeBlock, codeChangeTally, placeRanks, placesHolding, runCodePass }
  from '../../evidence/src/code-pass.js';
import { REPORT_HEADER_WORDS } from '../../render/report-words.js';
import { reportModel } from '../../render/report-model.js';
import { storyFacts } from '../../render/session-story.js';
import { CODE_FILES, CODE_TEXT, SYNTHETIC_RUN, buildCodeSession, codeJudge, holds, sha256, withRun }
  from './code-pass-fixture.js';

const W = CODE_REPORT_WORDS;
const START = '2030-01-01T00:00:00.000Z';
const END = '2030-01-02T00:00:00.000Z';
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const T1 = { turn: 'T1' };
const GIT_ENV = (date) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
  GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' });
const git = (cwd, args, date = '2029-01-01T00:00:00Z') => execFileSync('git', args, { cwd, stdio: 'pipe',
  env: GIT_ENV(date) }).toString();

/** A fresh folder, removed after the test. */
async function folder(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-d117-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
/** Write `files` (path -> text) under `root`. */
async function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}
/** A git repository at `root` holding `files`, committed before the session (2029). */
async function committed(root, files) {
  await mkdir(root, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  await put(root, files);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  return root;
}
/** A recording whose first and last rows carry the session's window. */
async function recordingAt(t) {
  const dir = await folder(t, 'rec');
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, `${JSON.stringify({ timestamp: START })}\n${JSON.stringify({ timestamp: END })}\n`);
  return file;
}
/** A session that writes each of `writes` (`[path, text]`, in order), then claims and ends. */
function sessionWriting(key, writes) {
  const blobs = { ...CODE_TEXT, ...Object.fromEntries(writes.map(([, text], at) => [`w${at}`, text])) };
  return buildCodeSession(key, blobs, [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    ...writes.flatMap(([path], at) => [{ id: `W${at + 1}`, kind: 'invocation', write: path, blob: `w${at}`, ...T1 },
      { id: `W${at + 1}-r`, kind: 'observation', invocation: `W${at + 1}`, blob: 'wrote', ...T1 }]),
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
}
/** One `sonah review --code-pass` run in `root`, with HOME `home`: every request kept, the story (.md) and the record. */
async function reviewIn(t, { root, recording, session, home, judge }) {
  const dir = await folder(t, 'run');
  const calls = [];
  let out = '';
  const output = join(dir, 'story.md');
  const state = join(dir, 'state');
  const code = await runSessionReviewCommand([recording, '--concurrency', '1', '--state-dir', state, '--format', 'md',
    '--output', output, '--no-open', '--code-pass'], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: root,
    env: { HOME: home, SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
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
const plainText = (md) => md.replace(/\\(.)/g, '$1');
/** The table of contents of a review request: each row's path, in order. */
const tocPaths = (prompt) => prompt.split('\n## Files (')[1].split('\n---\n')[0].split('\n').slice(1)
  .filter((line) => line.startsWith('- ') && !line.startsWith('- and ')).map((line) => line.slice(2).split(' → ')[0]
    .split(' · ')[0]);

// ---- the multi-repository case, through the CLI --------------------------------------------------------------------

/** The working repository A, a sibling repository B (a file the session changed, one it added, one someone else
 *  changed), a folder C in no repository, and a harness home: the shape of a session that worked in sibling worktrees
 *  and a notes folder. */
async function workspace(t) {
  const base = await realpath(await folder(t, 'ws'));
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE, 'src/util.js': CODE_FILES['src/util.js'] });
  const B = await committed(join(base, 'B'), { 'lib/b.js': 'export const b = 1;\n', 'docs/other.md': 'OTHER_ONE\n' });
  const C = join(base, 'C');
  const home = join(base, 'home');
  await put(A, { 'src/parse.js': CODE_FILES['src/parse.js'] });
  await put(B, { 'lib/b.js': 'export const b = 2;\n', 'lib/new.js': 'export const fresh = true;\n',
    'docs/other.md': 'SOMEONE_ELSES_CHANGE\n' });
  // Two untracked files of someone else's in B: one last changed after the session ended (named apart), one before it
  // began (an old file, no part of anything). The tracked one someone else changed was last changed before it began.
  await put(B, { 'docs/draft.md': 'SOMEONE_ELSES_DRAFT\n', 'docs/stale.md': 'stale\n' });
  const [after, before] = [new Date('2030-01-03T00:00:00Z'), new Date('2029-06-01T00:00:00Z')];
  await utimes(join(B, 'docs', 'draft.md'), after, after);
  await utimes(join(B, 'docs', 'stale.md'), before, before);
  await utimes(join(B, 'docs', 'other.md'), before, before);
  await put(C, { 'notes.md': '# Notes\nThe plan holds.\n' });
  await put(home, { '.claude/memory.md': 'remember\n' });
  return { A, B, C, home };
}
const workspaceSession = ({ B, C, home }) => sessionWriting('s-d117', [['src/parse.js', CODE_FILES['src/parse.js']],
  [join(B, 'lib', 'b.js'), 'export const b = 2;\n'], [join(B, 'lib', 'new.js'), 'export const fresh = true;\n'],
  [join(C, 'notes.md'), '# Notes\nThe plan holds.\n'], [join(home, '.claude', 'memory.md'), 'remember\n']]);
/** The review agent's answer: a bug on the sibling repository's file, by its absolute path. */
const siblingFinding = (B) => () => ({ findings: [{ kind: 'bug', lens: 'behaviour',
  title: 'b is 2 where its caller still expects 1', claims: [], input: 'import { b }',
  trace: [{ step: 'The constant changed.', path: join(B, 'lib', 'b.js'), side: 'new', startLine: 1, endLine: 1,
    quote: 'export const b = 2;' }],
  anchor: { path: join(B, 'lib', 'b.js'), side: 'new', startLine: 1, endLine: 1 }, leadsFrom: [] }], questions: [] });
/** The run record of an agent that read every file of the change whole, by the paths the change names them. */
const readsChange = (A, B, C) => (request) => {
  const files = [[join(A, 'src', 'parse.js'), 5], [join(A, 'src', 'util.js'), 4], [join(B, 'lib', 'b.js'), 1],
    [join(B, 'lib', 'new.js'), 1], [join(C, 'notes.md'), 2]];
  const ranges = request.label === 'code-review:agent' ? files.map(([path, lines]) => ({ path, startLine: 1,
    numLines: lines, totalLines: lines })) : [];
  return { ...SYNTHETIC_RUN, toolCalls: { ...SYNTHETIC_RUN.toolCalls, Read: ranges.length },
    reads: ranges.map((r) => r.path), readRanges: ranges };
};

test('D117: the session\'s change in a sibling repository is reviewed after the working repository\'s, the sibling read by '
  + 'the agents; D117 amended: a folder of no repository is listed by its folder, never reviewed', async (t) => {
  const { A, B, C, home } = await workspace(t);
  const recording = await recordingAt(t);
  const session = workspaceSession({ B, C, home });
  const run = await reviewIn(t, { root: A, recording, session, home,
    judge: codeJudge({ review: siblingFinding(B), run: readsChange(A, B, C) }) });
  const { codePass } = run.report;
  // The change: the working repository's file first, then the sibling repository's two. The folder's file is no file of
  // the change (D117 amended: "files outside any repository are listed, not reviewed").
  const review = run.calls.find((r) => r.label === 'code-review:agent');
  assert.deepEqual(tocPaths(review.prompt), ['src/parse.js', join(B, 'lib', 'b.js'), join(B, 'lib', 'new.js')]);
  // The sibling's change is git's diff from its base (its HEAD when the session began).
  assert.match(review.prompt, /^\| {4}1 \| {6}\| - \| export const b = 1;$/m);
  assert.match(review.prompt, /^\| {6}\| {4}1 \| \+ \| export const b = 2;$/m);
  const bBase = git(B, ['rev-parse', 'HEAD']).trim();
  assert.ok(review.prompt.includes('The working directory (every relative path above is relative to it): '));
  assert.ok(review.prompt.includes('The change also holds files of these repositories and folders, and you can read each '
    + `of them:\n- ${B}: a git repository; its change runs from ${bBase}, the commit where it stood when the session `
    + 'started, to the files now\n'));
  // No request of the step names the folder of no repository or sends its words.
  const asked = run.calls.filter((r) => /^code-/.test(r.label));
  assert.ok(asked.length >= 3, asked.map((r) => r.label).join(', '));
  for (const request of asked) assert.ok(!JSON.stringify(request).includes(C), request.label);
  // Every agent of the step reads the sibling's folder, and nothing else (no --add-dir of the folder); the working
  // directory is its root.
  for (const request of asked) assert.deepEqual([request.agent.root, request.agent.addDirs], [A, [B]], request.label);
  // D117's review: the line printed before any request names the one folder the agents read beside the repository.
  assert.ok(run.out.includes(CODE_STEP_WORDS.on('--code-pass', 1)), run.out);
  // What changed in the sibling repository outside the session's recorded writes is named apart and (the merge with D113
  // amended) given to the code review alone, in the block of the files outside the evaluated session after the change:
  // every file of the change, in any place, comes before it; no other agent of the step is sent it.
  for (const request of asked) for (const text of ['SOMEONE_ELSES_CHANGE', 'SOMEONE_ELSES_DRAFT'])
    assert.equal(JSON.stringify(request).includes(text), request === review, `${request.label} ${text}`);
  const away = review.prompt.indexOf('# The files outside the evaluated session');
  assert.ok(away > review.prompt.indexOf(join(B, 'lib', 'new.js')), review.prompt);
  assert.ok(review.prompt.indexOf('SOMEONE_ELSES_CHANGE') > away, review.prompt);
  assert.deepEqual(codePass.outsideFiles.map((f) => [f.path, f.place]), [[join(B, 'docs', 'draft.md'), B],
    [join(B, 'docs', 'other.md'), B]]);
  assert.deepEqual(codePass.manifest.review.outsideFiles.map((f) => [f.path, f.place]), [[join(B, 'docs', 'draft.md'), B],
    [join(B, 'docs', 'other.md'), B]]);
  assert.deepEqual(codePass.base.places, [
    { kind: 'git', at: B, written: 2, commit: bBase, how: 'reflog', changedOutside: [join(B, 'docs', 'draft.md'),
      join(B, 'docs', 'other.md')] }]);
  // D117 amended: the folder of no repository, listed with its count.
  assert.deepEqual(codePass.base.folders, [{ at: C, written: 1 }]);
  // The record: each file of another place names it; the folder's file is counted (`outside_root`), with no place; the
  // one tally counts each place, summing to the whole.
  assert.deepEqual(codePass.files.map((f) => [f.path, f.place ?? null, f.state]), [
    ['src/parse.js', null, 'shown'], [join(B, 'lib', 'b.js'), B, 'shown'], [join(B, 'lib', 'new.js'), B, 'shown'],
    [join(C, 'notes.md'), null, 'outside_root'], [join(home, '.claude', 'memory.md'), null, 'outside_root']]);
  assert.deepEqual(codePass.manifest.review.files.map((f) => f.place ?? null), [null, B, B]);
  const tally = codeChangeTally(codePass);
  assert.deepEqual(tally.places, [{ place: null, total: 1, notSeen: 0 }, { place: B, total: 2, notSeen: 0 }]);
  assert.equal(tally.places.reduce((n, p) => n + p.total, 0), tally.total);
  assert.equal(codePass.base.written, 5);
  // The finding on the sibling's file grounds there (the reader reads that place) and is published by its name.
  assert.deepEqual(codePass.findings.map((f) => [f.anchor.path, f.title]), [[join(B, 'lib', 'b.js'),
    'b is 2 where its caller still expects 1']]);
  // The folder's file is no part of the coverage: complete; it is counted with the harness home's.
  assert.equal(codePass.coverage, 'complete');
  assert.deepEqual(codePass.footer, [{ kind: 'outside_root', count: 2, home: 1 }]);
  assert.equal(run.code, 0);
  // The page says where each place's change runs from, what changed there outside the session, where the files lie, and
  // the folder of no repository with its count.
  const text = plainText(run.written);
  const aBase = git(A, ['rev-parse', 'HEAD']).trim();
  assert.ok(text.includes(W.ownBase(aBase, 0, 1, true)), text);
  assert.ok(W.ownBase(aBase, 0, 1, true).startsWith('In the working directory\'s repository, the change runs from'));
  for (const line of [W.placeBase(B, bBase, 2),
    `${W.placeOutsideFiles(B, [join(B, 'docs', 'draft.md'), join(B, 'docs', 'other.md')])}.`, W.filesWhere(1, null),
    W.filesWhere(2, B), `${W.folders(1, [[C, 1]])}.`, REPORT_HEADER_WORDS.change(3, null, 2)])
    assert.ok(text.includes(line), `${line}\n${text}`);
  assert.ok(text.includes('a change of 3 files in 2 repositories or folders'), text);
  assert.ok(!text.includes(W.placeEdits(C, 1)), text);
  // The files list names where each file of another place lies; the folder's file is no file of the change there.
  assert.ok(text.split('\n').some((line) => line.includes(join(B, 'lib', 'b.js')) && line.includes(W.placeOfFile(B, true))),
    text);
  assert.ok(!text.split('\n').some((line) => line.includes(join(C, 'notes.md')) && line.includes(W.placeOfFile(C, false))),
    text);
  assert.ok(!text.split('\n').some((line) => line.includes('src/parse.js') && line.includes(' git repository ')), text);
  // The files list's group of the files outside the evaluated session holds the sibling's, each tagged.
  for (const path of [join(B, 'docs', 'draft.md'), join(B, 'docs', 'other.md')]) assert.ok(text.split('\n')
    .some((line) => line.startsWith('- ') && line.includes(path) && line.endsWith(W.outsideTag)), `${path}\n${text}`);
  // The commit of the working repository speaks for none of the other places' files.
  assert.ok(!/differs? from the last commit/.test(text), text);
  // The session wrote with file tools alone: no sentence that edits can be missing.
  assert.equal(codePass.unseenEdits, undefined);
  assert.ok(!text.includes(W.unseenEdits), text);
});

test('D117: the dry run names each place of the change and where its change runs from, and (D117 amended) lists each '
  + 'folder of no repository; with none, its words are as before', async (t) => {
    const { A, B, C, home } = await workspace(t);
    const recording = await recordingAt(t);
    const snapshot = await readCodeSnapshot(workspaceSession({ B, C, home }), { root: A, maxBytes: 1_000_000, recording,
      harnessHomes: [join(home, '.claude')] });
    const bBase = git(B, ['rev-parse', 'HEAD']).trim().slice(0, 12);
    const line = codeSnapshotLine(snapshot);
    assert.ok(line.includes(`${CODE_SNAPSHOT_WORDS.place(2, B, 2, bBase)}${CODE_SNAPSHOT_WORDS.placeChangedOutside(2,
      true)}`), line);
    assert.ok(line.includes(CODE_SNAPSHOT_WORDS.folders(1, [[C, 1]])), line);
    assert.ok(!line.includes(` in ${C},`), line);
    assert.ok(line.includes(CODE_SNAPSHOT_WORDS.gitBase(git(A, ['rev-parse', 'HEAD']).trim().slice(0, 12), 'reflog', 1, 0,
      0, true)), line);
    // D122 (a review low of D117): the tail follows the places it counts ("those folders"); the folders that no
    // repository holds, which the code review does not read, come after it.
    assert.ok(line.endsWith(`${CODE_SNAPSHOT_WORDS.placeChangedOutside(2, true)}${CODE_SNAPSHOT_WORDS.tailPlaces(1, 1)}${
      CODE_SNAPSHOT_WORDS.folders(1, [[C, 1]])}`), line);
    const alone = await readCodeSnapshot(sessionWriting('s-alone', [['src/parse.js', CODE_FILES['src/parse.js']]]),
      { root: A, maxBytes: 1_000_000, recording });
    assert.equal(alone.base.places, undefined);
    assert.equal(alone.base.folders, undefined);
    assert.equal(alone.folders, undefined);
    assert.ok(codeSnapshotLine(alone).endsWith(CODE_SNAPSHOT_WORDS.tail));
    assert.ok(!codeSnapshotLine(alone).includes(' of the paths lie'));
  });

// ---- the invariant, over generated workspaces ------------------------------------------------------------------------

/** A deterministic generator (a linear congruential one): the same seed, the same cases. */
const lcg = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

test('D117 invariant (amended): every recorded write is in the change of its place, or has no difference from that '
  + 'place\'s base, or is counted (a folder of no repository, listed; a repository where none of its writes differs; a '
  + 'harness home); a repository is a place exactly when one of its writes differs; in every place a path no recorded '
  + 'write touched is in the change, unrecorded, exactly when its last change lies in the session\'s window, else named '
  + 'apart; the counts add up per place; the working repository comes first', async (t) => {
  const random = lcg(117);
  const [during, before] = [new Date('2030-01-01T12:00:00Z'), new Date('2029-06-01T00:00:00Z')];
  for (let round = 0; round < 12; round++) {
    const base = await realpath(await folder(t, `inv${round}`));
    const names = ['a.js', 'b.js', 'c.md', 'd/e.js'];
    const A = await committed(join(base, 'A'), Object.fromEntries(names.map((n) => [n, `A ${n} 1\n`])));
    const B = await committed(join(base, 'B'), Object.fromEntries(names.map((n) => [n, `B ${n} 1\n`])));
    const N = await committed(join(A, 'nested'), Object.fromEntries(names.map((n) => [n, `N ${n} 1\n`])));
    // D117's review: a repository nested in the sibling one, its own place, read through B's folder.
    const M = await committed(join(B, 'm'), Object.fromEntries(names.map((n) => [n, `M ${n} 1\n`])));
    const C = join(base, 'C');
    const home = join(base, 'home');
    await put(home, { '.claude/x.md': 'x\n' });
    // `others`: each path someone else changed (no recorded write), its place, and whether its last change lies inside
    // the session's window (a command of the session, or anyone while it ran) or before it began. `differs`: the
    // repositories where a recorded write left a difference.
    const writes = [], others = new Map(), differs = new Set();
    for (const [root, label] of [[A, 'A'], [B, 'B'], [N, 'N'], [M, 'M'], [C, 'C']]) {
      for (const n of [...names, 'new.js']) {
        const roll = random();
        const path = join(root, n);
        if (roll < 0.35) {
          // The session wrote it: new text, or the text it had (no difference from the base).
          const text = random() < 0.8 ? `${label} ${n} session\n` : `${label} ${n} 1\n`;
          await put(root, { [n]: text });
          writes.push([root === A ? n : path, text]);
          if (text !== `${label} ${n} 1\n` || n === 'new.js') differs.add(root);
        } else if (roll < 0.6 && label !== 'C') {
          // Someone else changed or added it, outside the session's recorded writes, during the window or before it.
          await put(root, { [n]: `${label} ${n} someone else\n` });
          const inWindow = random() < 0.5;
          await utimes(path, inWindow ? during : before, inWindow ? during : before);
          // An untracked file last changed before the session began is no part of anything (git's list of tracked
          // paths does not name it, and it is older than the session).
          if (n !== 'new.js' || inWindow) others.set(path, { root, inWindow });
        }
      }
    }
    if (random() < 0.5) writes.push([join(home, '.claude', 'x.md'), 'x\n']);
    const recording = await recordingAt(t);
    const session = sessionWriting(`s-inv-${round}`, writes);
    const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
      harnessHomes: [join(home, '.claude')] });
    const label = JSON.stringify({ round, writes: writes.map(([p]) => p), others: [...others.keys()] });
    const placeOf = (path) => (path.startsWith(`${N}/`) || path.startsWith('nested/') ? N : path.startsWith(`${M}/`) ? M
      : path.startsWith(`${B}/`) ? B : path.startsWith(`${C}/`) ? C : path.startsWith(`${home}/`) ? 'home' : null);
    const absolute = (path) => (path.startsWith('/') ? path : join(A, path));
    // D117 amended (its second review's medium): a repository is a place exactly when a recorded write there left a
    // difference; one the session wrote nothing to, or only writes with no difference, is no place: what changed there
    // is no part of anything, and D113's window never runs there.
    const places = snapshot.base.places ?? [];
    assert.deepEqual(places.map((p) => p.at).sort(), [B, N, M].filter((r) => differs.has(r)).sort(), label);
    const placed = new Set([A, ...places.map((p) => p.at)]);
    const kept = [...others].filter(([, o]) => o.inWindow && placed.has(o.root)).map(([path]) => path).sort();
    // Every write is a file of the snapshot; so is every path the window kept in a place, with no recorded write.
    assert.equal(snapshot.files.filter((f) => f.recorded).length, writes.length, label);
    assert.deepEqual(snapshot.files.filter((f) => !f.recorded).map((f) => absolute(f.path)).sort(), kept, label);
    for (const f of snapshot.files) {
      const at = placeOf(f.path);
      if (at === 'home') { assert.deepEqual([f.state, f.home], ['outside_root', true], label); continue; }
      // A folder of no repository, or a repository that is no place: counted, never a file of the change, no place.
      if (at === C || (at !== null && !placed.has(at))) {
        assert.deepEqual([f.state, f.place ?? null, f.diff ?? null], ['outside_root', null, null], `${label} ${f.path}`);
        continue;
      }
      assert.equal(f.place ?? null, at, `${label} ${f.path}`);
      if (!f.recorded) { assert.equal(f.diff, 'unrecorded_change', `${label} ${f.path}`); continue; }
      // In a place: in the change exactly when git shows it differing from that repository's base.
      const top = at ?? A;
      const commit = at === null ? snapshot.base.commit : snapshot.base.places.find((p) => p.at === at).commit;
      const gitPath = relative(top, absolute(f.path));
      const tracked = git(top, ['ls-files', '--', gitPath]).trim() !== '';
      const changed = tracked ? git(top, ['diff', '--name-only', commit, '--', gitPath]).trim() !== ''
        : git(top, ['ls-files', '--others', '--exclude-standard', '--', gitPath]).trim() !== '';
      assert.equal(f.diff !== undefined, changed, `${label} ${f.path}`);
    }
    // The counts add up: each place's recorded writes are its recorded files; the folders listed count the folder's
    // writes; with the working repository's, the counted ones and the harness home's, every write.
    for (const p of places) assert.equal(p.written, snapshot.files.filter((f) => f.place === p.at && f.recorded).length,
      label);
    const inC = writes.filter(([path]) => path.startsWith(`${C}/`)).length;
    assert.deepEqual(snapshot.base.folders ?? [], inC ? [{ at: C, written: inC }] : [], label);
    assert.equal(snapshot.files.filter((f) => f.recorded).length, snapshot.base.written, label);
    // Each place names apart exactly what changed there that no recorded write touched and the window did not keep: the
    // working repository by the names the code step gives, every other one by absolute paths.
    const apart = (root) => [...others].filter(([, o]) => o.root === root && !o.inWindow).map(([path]) => path).sort();
    assert.deepEqual(snapshot.base.changedOutside.map(absolute).sort(), apart(A), label);
    for (const p of places.filter((x) => x.kind === 'git')) assert.deepEqual(p.changedOutside, apart(p.at), label);
    // The order every reader shows: the working repository first, then the places with more files of the change first.
    const ranks = placeRanks(snapshot.files);
    const ordered = [...places].map((p) => p.at);
    assert.deepEqual(ordered, [...ordered].sort((a, b) => ranks.get(a) - ranks.get(b)), label);
    // The agents read each place's folder that is there, none in the working directory or in another of them, and never
    // the folder of no repository.
    const folders = snapshot.folders ?? [];
    for (const at of folders) assert.ok(!at.startsWith(`${A}/`) && at !== A && at !== C, `${label} ${at}`);
    for (const at of folders) for (const other of folders)
      assert.ok(at === other || !at.startsWith(`${other}/`), `${label} ${at} in ${other}`);
    if (places.some((p) => p.at === B)) assert.ok(folders.includes(B), label);
    // D117's review: the agents read exactly the places that hold a file of the change — every place holds one now
    // (D117 amended) — each lies in the working directory or in a folder they read, and each folder they read holds one.
    const held = placesHolding(snapshot.base, snapshot.files);
    assert.deepEqual(held.map((p) => p.at), places.map((p) => p.at), label);
    const where = { root: A, realRoot: snapshot.realRoot, top: null, folders: snapshot.folders ?? null };
    for (const p of held) assert.ok(agentsRead(where, p.at), `${label} ${p.at}`);
    for (const at of folders) assert.ok(held.some((p) => p.at === at || p.at.startsWith(`${at}/`)), `${label} ${at}`);
    // A written repository that is no place, and the folder of no repository: a new file there changes no state.
    for (const at of [B, N, M, C].filter((r) => !placed.has(r) && (r !== M || !placed.has(B)) && writes.some(([path]) =>
      absolute(path).startsWith(`${r}/`)))) {
      const before = await changeState(snapshot);
      await put(at, { 'zz-later.md': 'later\n' });
      assert.equal(await changeState(snapshot), before, `${label} ${at}`);
      await rm(join(at, 'zz-later.md'));
    }
  }
});

// ---- the reader, the state, and the readers of an earlier record ---------------------------------------------------

test('D117: the repository reader reads a file of another place now and at that place\'s base, names it as the change '
  + 'does, and reads nothing outside every place', async (t) => {
  const { A, B, C, home } = await workspace(t);
  const outside = await folder(t, 'nowhere');
  await put(outside, { 'x.js': 'never\n' });
  const recording = await recordingAt(t);
  const snapshot = await readCodeSnapshot(workspaceSession({ B, C, home }), { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  const repo = createRepositoryReader({ root: A, top: snapshot.top, commit: snapshot.base.commit, maxBytes: 1_000_000,
    places: snapshot.base.places, files: snapshot.files });
  assert.deepEqual([repo.read(join(B, 'lib', 'b.js'))?.text, repo.base(join(B, 'lib', 'b.js'))?.text],
    ['export const b = 2;\n', 'export const b = 1;\n']);
  assert.equal(repo.read(join(B, 'lib', 'b.js')).path, join(B, 'lib', 'b.js'));
  // By a spelling relative to the working directory: the same file, named as the change names it.
  assert.equal(repo.read(relative(A, join(B, 'lib', 'b.js')))?.path, join(B, 'lib', 'b.js'));
  // A file of the place the change does not hold is read too (the agents may quote a caller there), by its place.
  assert.equal(repo.read(join(B, 'docs', 'other.md'))?.path, join(B, 'docs', 'other.md'));
  // D117 amended: a folder of no repository is no place, so the reader reads nothing there.
  for (const path of [join(outside, 'x.js'), join(home, '.claude', 'memory.md'), join(C, 'notes.md')])
    assert.equal(repo.read(path), null, path);
  assert.deepEqual(await agentFolders(snapshot), [B]);
});

test('D117: the state the stored answers are keyed by covers every place, so a change in a sibling repository while the '
  + 'code review runs is said; with one place it is the repository\'s state, as before; D117 amended: a folder of no '
  + 'repository is in no state', async (t) => {
  const { A, B, C, home } = await workspace(t);
  const recording = await recordingAt(t);
  const snapshot = await readCodeSnapshot(workspaceSession({ B, C, home }), { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.equal(await changeState(snapshot), snapshot.repoState);
  await put(B, { 'docs/later.md': 'later\n' });
  assert.notEqual(await changeState(snapshot), snapshot.repoState, 'a new file in the sibling repository');
  await rm(join(B, 'docs', 'later.md'));
  await put(C, { 'notes.md': '# Notes\nThe plan moved.\n' });
  assert.equal(await changeState(snapshot), snapshot.repoState, 'the folder\'s file the session wrote: never read');
  await put(C, { 'notes.md': '# Notes\nThe plan holds.\n' });
  assert.equal(await changeState(snapshot), snapshot.repoState);
  // Through the step: a change in the sibling repository while it runs is said in the record.
  const memory = { lock: async () => async () => {}, saveReport: async () => {} };
  let touched = false;
  const judge = async (request) => {
    if (!touched) { touched = true; await put(B, { 'docs/during.md': 'during\n' }); }
    return codeJudge({ review: siblingFinding(B), verify: holds })(request);
  };
  const { report } = await reviewCodePass({ session: workspaceSession({ B, C, home }), report: {}, snapshot, judge,
    answerCache: null, store: memory, backend: 'claude-cli' });
  assert.ok(report.codePass.footer.some((e) => e.kind === 'source_changed'), JSON.stringify(report.codePass.footer));
  // One place: the repository's state alone.
  await rm(join(B, 'docs', 'during.md'));
  const alone = await readCodeSnapshot(sessionWriting('s-alone', [['src/parse.js', CODE_FILES['src/parse.js']]]),
    { root: A, maxBytes: 1_000_000, recording });
  const { repositoryState } = await import('../src/code-snapshot.js');
  assert.equal(alone.repoState, await repositoryState({ top: alone.top, commit: alone.base.commit, root: alone.realRoot,
    omit: alone.stateOmits }));
});

test('D117: a repository nested in the working directory is its own place: its file of the change gives no link, and no '
  + 'word about the working repository\'s last commit', async (t) => {
  const base = await realpath(await folder(t, 'nested'));
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE });
  git(A, ['remote', 'add', 'origin', 'https://github.com/synthetic-owner/synthetic-repo.git']);
  const N = await committed(join(A, 'vendor', 'n'), { 'n.js': 'export const n = 1;\n' });
  await put(N, { 'n.js': 'export const n = 2;\n' });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-nested', [['vendor/n/n.js', 'export const n = 2;\n']]);
  const review = () => ({ findings: [{ kind: 'bug', lens: 'behaviour', title: 'n is 2 where its caller expects 1',
    claims: [], input: 'import { n }', trace: [{ step: 'The constant changed.', path: 'vendor/n/n.js', side: 'new',
      startLine: 1, endLine: 1, quote: 'export const n = 2;' }],
    anchor: { path: 'vendor/n/n.js', side: 'new', startLine: 1, endLine: 1 }, leadsFrom: [] }], questions: [] });
  const run = await reviewIn(t, { root: A, recording, session, home: join(base, 'home'), judge: codeJudge({ review }) });
  assert.deepEqual(run.report.codePass.files.map((f) => [f.path, f.place, f.state]), [['vendor/n/n.js', N, 'shown']]);
  assert.deepEqual(run.report.codePass.findings.map((f) => f.anchor.path), ['vendor/n/n.js']);
  const text = plainText(run.written);
  assert.ok(text.includes('n is 2 where its caller expects 1'), text);
  assert.ok(!text.includes('This file differs from the last commit, so Sonah gives no link.'), text);
});

test('D122 (a review low of D117): a repository nested in the working directory whose writes have nothing to review is '
  + 'no place, and none of its writes is counted as lying outside the folders the code review could read; a recorded '
  + 'delete of a tracked file there makes it a place', async (t) => {
  const base = await realpath(await folder(t, 'nested-none'));
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE });
  await put(A, { 'src/parse.js': CODE_FILES['src/parse.js'] });
  const N = await committed(join(A, 'vendor', 'n'), { 'n.js': 'export const n = 1;\n', 'old.js': 'export const o = 1;\n' });
  const recording = await recordingAt(t);
  // The session wrote n.js back to the text it has at N's base: no difference there.
  const same = sessionWriting('s-nested-same', [['src/parse.js', CODE_FILES['src/parse.js']],
    ['vendor/n/n.js', 'export const n = 1;\n']]);
  const snapshot = await readCodeSnapshot(same, { root: A, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state]), [['src/parse.js', 'readable']]);
  assert.equal(snapshot.base.places, undefined);
  assert.equal(snapshot.base.written, 2, 'counted among the session\'s writes');
  const { codePass } = await passOf(snapshot, same);
  assert.ok(!codePass.files.some((f) => f.state === 'outside_root'), JSON.stringify(codePass.files));
  const footer = codeFooterLines({ codePass });
  assert.ok(!footer.some((line) => line.includes('outside the folders that the code review could read')), footer.join('\n'));
  // A recorded delete of a file N tracks: git shows the difference, so N is a place, its file deleted, as a delete is in
  // the working directory's own repository.
  await rm(join(N, 'old.js'));
  const deleting = buildCodeSession('s-nested-delete', { ...CODE_TEXT, gone: '' }, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'X1', kind: 'invocation', callKey: 'X1', tool: 'Bash', operation: 'delete', paths: [{ path: 'vendor/n/old.js' }],
      command: [], input: [], changes: [{ path: 'vendor/n/old.js', before: [], after: [], diff: [] }], ...T1 },
    { id: 'X1-r', kind: 'observation', invocation: 'X1', blob: 'wrote', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
  const gone = await readCodeSnapshot(deleting, { root: A, maxBytes: 1_000_000, recording });
  assert.deepEqual(gone.base.places.map((p) => p.at), [N]);
  assert.deepEqual(gone.files.map((f) => [f.path, f.place, f.state, f.type]), [['vendor/n/old.js', N, 'deleted',
    'deleted']]);
});

test('D117 readers: a record with no other place keeps its words; the place lines and the files\' places follow the record',
  () => {
    const commit = 'a'.repeat(40);
    const pass = (base, files) => ({ ran: true, base, files, withheld: [], footer: [], coverage: 'complete' });
    const one = [{ path: 'src/a.js', state: 'shown', type: 'modified' }];
    const earlier = pass({ kind: 'git', commit, how: 'reflog', changedOutside: [], written: 1 }, one);
    assert.deepEqual(codePlaceLines(earlier), []);
    const B = '/work/other-repo', C = '/work/notes';
    const many = pass({ kind: 'git', commit, how: 'reflog', changedOutside: [], written: 4, places: [
      { kind: 'git', at: B, commit, how: 'reflog', written: 2, changedOutside: ['/work/other-repo/z.md'] },
      { kind: 'recorded_edits', at: C, written: 1 }] }, [...one,
      { path: `${B}/x.js`, place: B, state: 'shown', type: 'modified' },
      { path: `${B}/y.js`, place: B, state: 'shown', type: 'added' },
      { path: `${C}/n.md`, place: C, state: 'shown', type: 'modified' }]);
    assert.deepEqual(codePlaceLines(many), [W.placeBase(B, commit, 2),
      W.placeChangedOutside(B, ['/work/other-repo/z.md']), W.placeEdits(C, 1)]);
    // A place none of whose writes is in the change says no base line; it still names what changed there apart.
    const empty = pass({ ...many.base, places: [{ ...many.base.places[0] }, { kind: 'recorded_edits', at: C, written: 1 }] },
      many.files.filter((f) => f.place !== B));
    assert.deepEqual(codePlaceLines(empty), [W.placeChangedOutside(B, ['/work/other-repo/z.md']), W.placeEdits(C, 1)]);
    // With no manifest, the coverage line is an earlier one's: no place counts are said.
    assert.ok(!codeCoverageLines(many).some((line) => line.includes(' of them lie')));
    // The working directory's repository's base line speaks of it alone when another place holds files of the change,
    // and is not said when it holds none; with no other place it is as before.
    assert.equal(codeBaseLine(earlier), W.ownBase(commit, 0, 1));
    assert.equal(codeBaseLine(many), W.ownBase(commit, 0, 1, true));
    assert.equal(codeBaseLine(pass(many.base, many.files.filter((f) => f.place))), null);
    assert.equal(codeBaseLine(pass({ kind: 'recorded_edits', written: 2, places: [many.base.places[1]] },
      [{ ...one[0], diff: 'base_unknown' }, many.files[3]])), W.base(null, 0, 0, true));
    // A change with no file to review says no base line of any place, and still names what changed elsewhere apart.
    const none = pass({ ...many.base, places: [many.base.places[0]] }, []);
    assert.equal(codeNoChangeOf(none), 'noFile');
    assert.deepEqual(codePlaceLines(none), [W.placeChangedOutside(B, ['/work/other-repo/z.md'])]);
  });

test('D117 readers: a place\'s base line counts the files of the change there that no recorded write changed, from the '
  + 'one tally', () => {
    const commit = 'b'.repeat(40);
    const B = '/work/other-repo';
    const unit = (path, recorded) => ({ path, place: B, state: 'whole', side: 'new', shown: [[1, 1]], lines: 1,
      beforeUnshown: 0, recorded });
    const codePass = { ran: true, agent: { terminal: 'answered' }, agents: [], withheld: [], footer: [],
      coverage: 'complete', files: [], base: { kind: 'git', commit, how: 'reflog', changedOutside: [], written: 1,
        places: [{ kind: 'git', at: B, commit, how: 'reflog', written: 1, changedOutside: [] }] },
      manifest: { review: { sent: true, files: [unit(`${B}/a.js`, true), unit(`${B}/b.js`, false),
        unit(`${B}/c.js`, false)], rules: [] } } };
    assert.deepEqual(codePlaceLines(codePass), [W.placeBase(B, commit, 3, 2)]);
    assert.ok(W.placeBase(B, commit, 3, 2).endsWith('No recorded write of the session changed 2 of them. Each of them '
      + 'last changed while the session ran.'));
    // The working directory's repository holds none of them: no base line of it.
    assert.equal(codeBaseLine(codePass), null);
  });

test('D117: the tally of a review request counts each place, the working repository first, then by the order of places',
  () => {
    const unit = (path, place, state = 'whole') => ({ path, ...(place ? { place } : {}), state, side: 'new',
      shown: [[1, 2]], lines: 2, beforeUnshown: 0, recorded: true });
    const codePass = { ran: true, agent: { terminal: 'answered' }, agents: [], manifest: { review: { sent: true, files: [
      unit('/z/one.js', '/z'), unit('src/a.js', null), unit('/b/one.js', '/b'), unit('/b/two.js', '/b'),
      { ...unit('/z/two.js', '/z'), state: 'not_shown', reason: 'deleted', shown: [], lines: null }], rules: [] } } };
    const tally = codeChangeTally(codePass);
    assert.deepEqual(tally.places, [{ place: null, total: 1, notSeen: 0 }, { place: '/b', total: 2, notSeen: 0 },
      { place: '/z', total: 2, notSeen: 1 }]);
    assert.ok(codeCoverageLines({ ...codePass, base: { kind: 'git', commit: 'a'.repeat(40) }, files: [], withheld: [],
      footer: [], coverage: 'complete' }).includes(W.filesWhere(2, '/z', 1)));
  });

test('D117: placeRanks puts the working repository\'s files first, then places with more files of the change, ties by '
  + 'place', () => {
  const files = [{ path: 'a', diff: 'recorded' }, { path: '/q/1', place: '/q', diff: 'recorded' },
    { path: '/p/1', place: '/p', diff: 'recorded' }, { path: '/r/1', place: '/r', diff: 'recorded' },
    { path: '/r/2', place: '/r', diff: 'recorded' }, { path: '/s/1', place: '/s' }];
  assert.deepEqual([...placeRanks(files)], [['/r', 1], ['/p', 2], ['/q', 3], ['/s', 4]]);
  assert.deepEqual(withRun({ findings: [] }).findings, []);
});

test('D117: a write the record spelled from the working directory with `..` is named by its absolute place, as the agents\' '
  + 'tools name it; one spelled through a link under the working directory keeps its spelling', async (t) => {
  const { A, B, C, home } = await workspace(t);
  const recording = await recordingAt(t);
  const session = sessionWriting('s-dotdot', [[join('..', 'B', 'lib', 'b.js'), 'export const b = 2;\n'],
    [join(B, 'lib', 'new.js'), 'export const fresh = true;\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.place, f.diff]), [[join(B, 'lib', 'b.js'), B, 'recorded'],
    [join(B, 'lib', 'new.js'), B, 'recorded']]);
  assert.deepEqual(snapshot.base.places.map((p) => [p.at, p.written]), [[B, 2]]);
  assert.ok(C);
});

test('D117 amended: a folder of no repository written first deep inside, then at its top, is one folder listed with its '
  + 'count; the change block keeps the working repository\'s hunks first when its bound bites', async (t) => {
  const { A, B, C, home } = await workspace(t);
  await put(C, { 'deep/er/x.md': 'deep\n' });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-nest', [[join(C, 'deep', 'er', 'x.md'), 'deep\n'],
    [join(C, 'notes.md'), '# Notes\nThe plan holds.\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.equal(snapshot.base.places, undefined);
  assert.deepEqual(snapshot.base.folders, [{ at: C, written: 2 }]);
  assert.deepEqual(snapshot.files.map((f) => [f.place ?? null, f.state]), [[null, 'outside_root'], [null, 'outside_root']]);
  // Two folders apart, the one with more files first, whatever their names' order.
  const two = await readCodeSnapshot(sessionWriting('s-nest-2', [[join(C, 'deep', 'er', 'x.md'), 'deep\n'],
    [join(home, 'n.md'), 'n\n'], [join(home, 'm.md'), 'm\n']]), { root: A, maxBytes: 1_000_000, recording });
  assert.deepEqual(two.base.folders, [{ at: home, written: 2 }, { at: join(C, 'deep', 'er'), written: 1 }]);
  assert.ok(B);
  // The fill: within the cap, the working repository's file first (larger), then another place's (smaller): only the
  // first fits.
  const rows = (n, tag) => [{ oldStart: 1, oldCount: n, newStart: 1, newCount: n, header: '',
    rows: Array.from({ length: n }, (_, i) => ({ type: '+', old: null, new: i + 1, text: `${tag} line ${i}` })) }];
  const files = [{ path: 'src/big.js', type: 'added', diff: 'recorded', hunks: rows(12, 'big') },
    { path: '/elsewhere/small.js', place: '/elsewhere', type: 'added', diff: 'recorded', hunks: rows(6, 'small') }];
  const reserve = changeBlock(files, { maxBytes: 0 }).change.length;
  const block = changeBlock(files, { maxBytes: reserve + 600 });
  assert.deepEqual([...block.shown], ['src/big.js']);
  assert.deepEqual(block.clipped, ['/elsewhere/small.js']);
});

test('D117: in another repository, as in the working directory, a path no recorded write touched whose last change lies in '
  + 'the session\'s window is a part of the change with no recorded write; one after it is named apart; a coding agent\'s '
  + 'home and Sonah\'s own places there are neither', async (t) => {
  const base = await realpath(await folder(t, 'window'));
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE });
  const B = await committed(join(base, 'B'), { 'lib/b.js': 'export const b = 1;\n', 'lib/run.js': 'run 1\n',
    'lib/later.js': 'later 1\n', 'agent/settings.json': '{}\n' });
  await put(B, { 'lib/b.js': 'export const b = 2;\n', 'lib/run.js': 'run 2\n', 'lib/later.js': 'later 2\n',
    'out/made.js': 'made\n', 'agent/settings.json': '{"x":1}\n', 'agent/new.md': 'new\n', 'sonah/review/x.json': '{}\n' });
  const [during, after] = [new Date('2030-01-01T12:00:00Z'), new Date('2030-01-05T00:00:00Z')];
  for (const path of ['lib/run.js', 'out/made.js', 'agent/settings.json', 'agent/new.md', 'sonah/review/x.json'])
    await utimes(join(B, path), during, during);
  await utimes(join(B, 'lib', 'later.js'), after, after);
  const recording = await recordingAt(t);
  const session = sessionWriting('s-window', [[join(B, 'lib', 'b.js'), 'export const b = 2;\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(B, 'agent')], own: [join(B, 'sonah', 'review')] });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.place, f.recorded, f.diff]), [
    [join(B, 'lib', 'b.js'), B, true, 'recorded'],
    [join(B, 'lib', 'run.js'), B, false, 'unrecorded_change'],
    [join(B, 'out', 'made.js'), B, false, 'unrecorded_change']]);
  assert.deepEqual(snapshot.base.places, [{ kind: 'git', at: B, written: 1, commit: git(B, ['rev-parse', 'HEAD']).trim(),
    how: 'reflog', changedOutside: [join(B, 'lib', 'later.js')] }]);
  assert.deepEqual(snapshot.folders, [B]);
});

test('D117: a recorded write in a place Sonah writes, outside the working directory, stays out as one in a coding agent\'s '
  + 'home does; one inside the working directory is reviewed, as before', async (t) => {
  const base = await realpath(await folder(t, 'own'));
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE });
  const sonahHome = join(base, '.sonah');
  await put(sonahHome, { 'config.json': '{"a":1}\n' });
  await put(A, { 'state/review/note.md': 'note\n' });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-own', [[join(sonahHome, 'config.json'), '{"a":1}\n'],
    ['state/review/note.md', 'note\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    own: [sonahHome, join(A, 'state', 'review')] });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state, f.home ?? null, f.diff ?? null]), [
    [join(sonahHome, 'config.json'), 'outside_root', true, null], ['state/review/note.md', 'readable', null, 'recorded']]);
  assert.equal(snapshot.base.places, undefined);
  assert.equal(snapshot.folders, undefined);
});

test('D117: with no start commit, a write elsewhere in the working directory\'s repository is a place of its own, read by '
  + 'its recorded edits, so no line says it lies in the working directory', async (t) => {
  const base = await realpath(await folder(t, 'unborn'));
  const top = join(base, 'repo');
  await mkdir(top, { recursive: true });
  git(top, ['init', '-q', '-b', 'main']);
  await put(top, { 'app/src/parse.js': BASE_PARSE, 'lib/x.js': 'x 1\n' });
  git(top, ['add', '-A']);
  // Its first commit comes after the session began: there is no start commit.
  git(top, ['commit', '-q', '-m', 'later'], '2031-01-01T00:00:00Z');
  await put(top, { 'app/src/parse.js': CODE_FILES['src/parse.js'], 'lib/x.js': 'x 2\n' });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-unborn', [['src/parse.js', CODE_FILES['src/parse.js']], [join(top, 'lib', 'x.js'),
    'x 2\n']]);
  const snapshot = await readCodeSnapshot(session, { root: join(top, 'app'), maxBytes: 1_000_000, recording });
  assert.equal(snapshot.base.kind, 'recorded_edits');
  assert.deepEqual(snapshot.base.places, [{ kind: 'recorded_edits', at: top, repository: true, written: 1 }]);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.place ?? null, f.diff]), [['src/parse.js', null, 'base_unknown'],
    [join(top, 'lib', 'x.js'), top, 'base_unknown']]);
  assert.deepEqual(snapshot.folders, [top]);
});

test('D117 amended: a file the session wrote in a folder of no repository, there or not there any more, is listed by '
  + 'its folder and counted, never withheld, and leaves the code review\'s coverage complete', async (t) => {
  const base = await realpath(await folder(t, 'gone'));
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE });
  await put(A, { 'src/parse.js': CODE_FILES['src/parse.js'] });
  const scratch = join(base, 'scratch');
  await put(scratch, { 'kept.py': 'print(1)\n' });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-gone', [['src/parse.js', CODE_FILES['src/parse.js']], [join(scratch, 'repro.py'),
    'print(0)\n'], [join(scratch, 'kept.py'), 'print(1)\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state, f.diff ?? null]), [['src/parse.js', 'readable', 'recorded'],
    [join(scratch, 'repro.py'), 'outside_root', null], [join(scratch, 'kept.py'), 'outside_root', null]]);
  assert.deepEqual(snapshot.base.folders, [{ at: scratch, written: 2 }]);
  assert.equal(snapshot.folders, undefined);
  const { codePass } = await runCodePass({ report: {}, session, snapshot: snapshot.files, base: snapshot.base, root: A,
    top: snapshot.top, folders: snapshot.folders, judge: codeJudge({ review: () => ({ findings: [], questions: [] }) }) });
  assert.deepEqual(codePass.footer, [{ kind: 'outside_root', count: 2 }], JSON.stringify(codePass.footer));
  assert.equal(codePass.coverage, 'complete');
  assert.deepEqual(codePass.base.folders, [{ at: scratch, written: 2 }]);
  assert.deepEqual(codeWritesLines(codePass), [W.folders(2, [[scratch, 2]])]);
});

test('D117 amended: a repository whose only write names a path that is not there is no place: never read, no window '
  + 'run over it, its write counted; the dry run names no place', async (t) => {
  const { A, B, C, home } = await workspace(t);
  const recording = await recordingAt(t);
  // A file tool's write to a path not there (its name holds a `$`, as a file name may): no such file, its nearest folder
  // in B. Someone else's file in B last changed while the session ran (lib/run.js) is no part of anything.
  await put(B, { 'lib/run.js': 'run 2\n' });
  await utimes(join(B, 'lib', 'run.js'), new Date('2030-01-01T12:00:00Z'), new Date('2030-01-01T12:00:00Z'));
  const session = sessionWriting('s-none-there', [[join(B, '$R', 'prep.sh'), 'echo\n'], [join(C, 'notes.md'),
    '# Notes\nThe plan holds.\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.place ?? null, f.state, f.diff ?? null]), [
    [join(B, '$R', 'prep.sh'), null, 'outside_root', null], [join(C, 'notes.md'), null, 'outside_root', null]]);
  assert.equal(snapshot.base.places, undefined);
  assert.deepEqual(snapshot.base.folders, [{ at: C, written: 1 }]);
  assert.equal(snapshot.base.unresolved, undefined, 'a file tool\'s path is literal');
  assert.equal(snapshot.folders, undefined);
  // D113's window never ran over B: its file last changed while the session ran is neither in the change nor apart.
  assert.deepEqual(snapshot.outsideFiles.map((f) => f.path), ['src/parse.js']);
  assert.ok(!snapshot.files.some((f) => f.path.startsWith(B) && f.recorded !== true), 'no file B kept by the window');
  const line = codeSnapshotLine(snapshot);
  assert.ok(!line.includes(` in ${B},`), line);
  assert.ok(line.endsWith(`${CODE_SNAPSHOT_WORDS.tail}${CODE_SNAPSHOT_WORDS.folders(1, [[C, 1]])}`), line);
});

// ---- D117's review: what is read is what holds a file of the change, and every sentence of it is true ----------------

/** A session that writes the working repository's file, and a path in B that is not there: D117 amended, B is no place
 *  (before, a place that held no file of the change: the dogfood's shape, a write named with an unexpanded shell
 *  variable, here by a file tool so that it is not counted apart as not resolved). */
const noFileInB = (B) => sessionWriting('s-b-empty', [['src/parse.js', CODE_FILES['src/parse.js']],
  [join(B, '$R', 'prep.sh'), 'echo\n']]);
const noFindings = () => ({ findings: [], questions: [] });
const memoryStore = () => ({ lock: async () => async () => {}, saveReport: async () => {} });
/** `runCodePass` from a snapshot as the CLI calls it (session-review.js `codeStepPlace`): every request kept. */
async function passOf(snapshot, session, review = noFindings) {
  const seen = [];
  const { codePass } = await runCodePass({ report: {}, session, snapshot: snapshot.files, base: snapshot.base,
    root: snapshot.dir, top: snapshot.top !== snapshot.realRoot ? snapshot.top : null, folders: snapshot.folders ?? null,
    realRoot: snapshot.realRoot, judge: codeJudge({ review, seen }) });
  return { codePass, prompt: seen.find((r) => r.label === 'code-review:agent')?.prompt ?? '' };
}

test('D117 review, amended: a repository that holds no file of the change is no place: no part of the state, the reader or '
  + 'the agents\' folders, so a change there while the code review runs is none of the step\'s', async (t) => {
  const { A, B, home } = await workspace(t);
  const recording = await recordingAt(t);
  const snapshot = await readCodeSnapshot(noFileInB(B), { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.equal(snapshot.base.places, undefined);
  assert.deepEqual(placesHolding(snapshot.base, snapshot.files), []);
  assert.equal(snapshot.folders, undefined);
  // The state is the working repository's alone, as with one place; another agent's file in B changes nothing of it.
  assert.equal(snapshot.repoState, await repositoryState({ top: snapshot.top, commit: snapshot.base.commit,
    root: snapshot.realRoot, omit: snapshot.stateOmits }));
  await put(B, { 'docs/later.md': 'later\n' });
  assert.equal(await changeState(snapshot), snapshot.repoState, 'a new file in a repository that is no place');
  await rm(join(B, 'docs', 'later.md'));
  // Through the step: another agent adds a file in B while it runs. Nothing it read changed, so the record says nothing
  // changed and the coverage stays complete.
  let touched = false;
  const during = async (request) => {
    if (!touched) { touched = true; await put(B, { 'docs/during.md': 'during\n' }); }
    return codeJudge({ review: noFindings })(request);
  };
  const quiet = await reviewCodePass({ session: noFileInB(B), report: {}, snapshot, judge: during, answerCache: null,
    store: memoryStore(), backend: 'claude-cli' });
  assert.ok(!quiet.report.codePass.footer.some((e) => e.kind === 'source_changed'),
    JSON.stringify(quiet.report.codePass.footer));
  assert.equal(quiet.report.codePass.coverage, 'complete');
  await rm(join(B, 'docs', 'during.md'));
  // The reader reads no file of B: a finding that quotes one is not grounded (its file is not readable), so it is not
  // published.
  const quoting = await reviewCodePass({ session: noFileInB(B), report: {}, snapshot,
    judge: codeJudge({ review: siblingFinding(B) }), answerCache: null, store: memoryStore(), backend: 'claude-cli' });
  assert.deepEqual(quoting.report.codePass.findings, []);
  assert.deepEqual(quoting.report.codePass.withheld.map((w) => [w.what, w.reason, w.cause]), [['finding',
    'evidence_grounding_failed', 'file_not_readable']]);
  // The where block lists no place, so it says nothing of B; the dry run names no place.
  const { prompt } = await passOf(snapshot, noFileInB(B));
  assert.ok(prompt.includes('# Where you are'), prompt);
  assert.ok(!prompt.includes(B), prompt);
  assert.ok(codeSnapshotLine(snapshot).endsWith(CODE_SNAPSHOT_WORDS.tail), codeSnapshotLine(snapshot));
});

test('D117 review: a place in the working directory is read there — the dry run counts it read, and the where block lists '
  + 'it with the places the agents read; with no repository the line names the working directory', async (t) => {
  const base = await realpath(await folder(t, 'inroot'));
  const recording = await recordingAt(t);
  // A git working directory with a nested repository that the session wrote to.
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE });
  const N = await committed(join(A, 'vendor', 'n'), { 'n.js': 'export const n = 1;\n' });
  await put(N, { 'n.js': 'export const n = 2;\n' });
  const nestedSession = sessionWriting('s-in-1', [['vendor/n/n.js', 'export const n = 2;\n']]);
  const nested = await readCodeSnapshot(nestedSession, { root: A, maxBytes: 1_000_000, recording });
  assert.deepEqual([nested.base.places.map((p) => p.at), nested.folders], [[N], []]);
  assert.ok(codeSnapshotLine(nested).endsWith(CODE_SNAPSHOT_WORDS.tailPlaces(1, 1)), codeSnapshotLine(nested));
  // The working directory named through a link: the place lies in its real path, so it is read there too.
  const spelled = join(base, 'A-link');
  await symlink(A, spelled);
  const viaLink = await readCodeSnapshot(nestedSession, { root: spelled, maxBytes: 1_000_000, recording });
  assert.deepEqual([viaLink.dir, viaLink.realRoot, viaLink.base.places.map((p) => p.at)], [spelled, A, [N]]);
  assert.ok(codeSnapshotLine(viaLink).endsWith(CODE_SNAPSHOT_WORDS.tailPlaces(1, 1)), codeSnapshotLine(viaLink));
  assert.ok((await passOf(viaLink, nestedSession)).prompt.includes(`and you can read each of them:\n- ${N}:`));
  const { prompt } = await passOf(nested, nestedSession);
  assert.ok(prompt.includes('The change also holds files of these repositories and folders, and you can read each of '
    + `them:\n- ${N}: a git repository`), prompt);
  assert.ok(!prompt.includes('which you cannot read'), prompt);
  // A working directory in no repository that holds a repository (a worktree) that the session wrote to.
  const R = join(base, 'R');
  const W = await committed(join(R, 'wt'), { 'w.js': 'w 1\n' });
  await put(W, { 'w.js': 'w 2\n' });
  const plain = await readCodeSnapshot(sessionWriting('s-in-2', [['wt/w.js', 'w 2\n']]), { root: R, maxBytes: 1_000_000,
    recording });
  assert.equal(plain.repository, false);
  assert.deepEqual(plain.base.places.map((p) => [p.kind, p.at]), [['git', W]]);
  assert.ok(codeSnapshotLine(plain).endsWith(' The code review can read any file of the working directory and of those '
    + 'folders.'), codeSnapshotLine(plain));
});

test('D117 review: with no repository at the working directory, D113\'s window still holds in another repository that the '
  + 'session wrote to', async (t) => {
  const base = await realpath(await folder(t, 'norepo-window'));
  const R = join(base, 'R');
  await put(R, { 'notes.md': 'n\n' });
  const B = await committed(join(base, 'B'), { 'lib/b.js': 'export const b = 1;\n', 'lib/run.js': 'run 1\n',
    'lib/later.js': 'later 1\n' });
  await put(B, { 'lib/b.js': 'export const b = 2;\n', 'lib/run.js': 'run 2\n', 'lib/later.js': 'later 2\n' });
  await utimes(join(B, 'lib', 'run.js'), new Date('2030-01-01T12:00:00Z'), new Date('2030-01-01T12:00:00Z'));
  await utimes(join(B, 'lib', 'later.js'), new Date('2030-01-05T00:00:00Z'), new Date('2030-01-05T00:00:00Z'));
  const recording = await recordingAt(t);
  const snapshot = await readCodeSnapshot(sessionWriting('s-nr', [[join(B, 'lib', 'b.js'), 'export const b = 2;\n']]),
    { root: R, maxBytes: 1_000_000, recording });
  assert.equal(snapshot.repository, false);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.place, f.recorded, f.diff]), [
    [join(B, 'lib', 'b.js'), B, true, 'recorded'], [join(B, 'lib', 'run.js'), B, false, 'unrecorded_change']]);
  assert.deepEqual(snapshot.base.places.map((p) => p.changedOutside), [[join(B, 'lib', 'later.js')]]);
});

test('D117 review: a file of the working repository named by its absolute path, with no other place, makes the where '
  + 'block say that every relative path is relative to the working directory', async (t) => {
  const base = await realpath(await folder(t, 'abs'));
  const top = await committed(join(base, 'repo'), { 'app/src/parse.js': BASE_PARSE, 'lib/x.js': 'x 1\n' });
  await put(top, { 'app/src/parse.js': CODE_FILES['src/parse.js'], 'lib/x.js': 'x 2\n' });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-abs', [['src/parse.js', CODE_FILES['src/parse.js']], [join(top, 'lib', 'x.js'),
    'x 2\n']]);
  const root = join(top, 'app');
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.equal(snapshot.base.places, undefined);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.place ?? null, f.diff]), [['src/parse.js', null, 'recorded'],
    [join(top, 'lib', 'x.js'), null, 'recorded']]);
  const { prompt } = await passOf(snapshot, session);
  assert.ok(prompt.includes(`The working directory (every relative path above is relative to it): ${root}\n`), prompt);
  assert.ok(!prompt.includes('The change also holds files'), prompt);
});

test('D117 review, amended: the where block lists only the places of the change, never a folder of no repository, and '
  + 'says which of them the agents cannot read (a place no folder of theirs holds)', async (t) => {
  const { A, B, C, home } = await workspace(t);
  const recording = await recordingAt(t);
  // B is a place (its file differs); C is a folder of no repository: listed on the page, never in the where block.
  const session = sessionWriting('s-where', [[join(B, 'lib', 'b.js'), 'export const b = 2;\n'], [join(C, 'notes.md'),
    '# Notes\nThe plan holds.\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  const { prompt } = await passOf(snapshot, session);
  assert.ok(prompt.includes(`and you can read each of them:\n- ${B}: a git repository`), prompt);
  assert.ok(!prompt.includes(C), prompt);
  // A place that no folder of the agents' holds (a snapshot whose folders were found before the place's folder was there:
  // by hand here, since every place now holds a file that is there): the where block says the agents cannot read it, and
  // the dry run counts it unread.
  const unread = { ...snapshot, folders: [] };
  const goneRun = await passOf(unread, session);
  const bBase = git(B, ['rev-parse', 'HEAD']).trim();
  assert.ok(goneRun.prompt.includes('The change also holds files of these repositories and folders, which you cannot '
    + `read:\n- ${B}: a git repository; its change runs from ${bBase}`), goneRun.prompt);
  assert.ok(!goneRun.prompt.includes('you can read each of them'), goneRun.prompt);
  assert.ok(codeSnapshotLine(unread).endsWith(`${CODE_SNAPSHOT_WORDS.tailPlaces(0, 1)}${CODE_SNAPSHOT_WORDS.folders(1,
    [[C, 1]])}`), codeSnapshotLine(unread));
});

test('D117 review: a repository nested in another place is read through that place\'s folder: no folder the agents read '
  + 'lies in another', async (t) => {
  const base = await realpath(await folder(t, 'nest-places'));
  const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE });
  const B = await committed(join(base, 'B'), { 'lib/b.js': 'export const b = 1;\n' });
  const M = await committed(join(B, 'm'), { 'm.js': 'm 1\n' });
  await put(B, { 'lib/b.js': 'export const b = 2;\n' });
  await put(M, { 'm.js': 'm 2\n' });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-nest-places', [[join(B, 'lib', 'b.js'), 'export const b = 2;\n'],
    [join(M, 'm.js'), 'm 2\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.base.places.map((p) => [p.kind, p.at]).sort(), [['git', B], ['git', M]]);
  assert.deepEqual(snapshot.folders, [B]);
  assert.ok(codeSnapshotLine(snapshot).endsWith(CODE_SNAPSHOT_WORDS.tailPlaces(2, 2)), codeSnapshotLine(snapshot));
  const { prompt } = await passOf(snapshot, session);
  assert.ok(!prompt.includes('which you cannot read'), prompt);
});

test('D117 review: the files of the change by place say "the working directory" when the change has no git base there',
  () => {
    const unit = (path, place) => ({ path, ...(place ? { place } : {}), state: 'whole', side: 'new', shown: [[1, 1]],
      lines: 1, beforeUnshown: 0, recorded: true });
    const codePass = { ran: true, agent: { terminal: 'answered' }, agents: [], files: [], withheld: [], footer: [],
      coverage: 'complete', base: { kind: 'recorded_edits', written: 2, places: [{ kind: 'recorded_edits', at: '/n',
        written: 1 }] }, manifest: { review: { sent: true, files: [unit('a.js', null), unit('/n/x.md', '/n')],
        rules: [] } } };
    const lines = codeCoverageLines(codePass);
    assert.ok(lines.includes(W.filesWhere(1, null, 0, false)), lines.join('\n'));
    assert.ok(W.filesWhere(1, null, 0, false).endsWith('lies in the working directory.'));
    assert.ok(!lines.includes(W.filesWhere(1, null, 0, true)), lines.join('\n'));
  });

test('D117 review: a write under the working directory whose folder cannot be searched stays the working directory\'s: not '
  + 'readable, its change withheld, as before D117', { skip: process.getuid?.() === 0 ? 'root reads any folder' : false },
async (t) => {
  const base = await realpath(await folder(t, 'locked'));
  const R = join(base, 'R');
  await put(R, { 'src.js': 'x\n', 'locked/a.js': 'a\n' });
  const recording = await recordingAt(t);
  const session = sessionWriting('s-locked', [['locked/a.js', 'a\n']]);
  await chmod(join(R, 'locked'), 0o000);
  try {
    const snapshot = await readCodeSnapshot(session, { root: R, maxBytes: 1_000_000, recording });
    assert.deepEqual(snapshot.files.map((f) => [f.path, f.state, f.diff ?? null, f.place ?? null]), [
      ['locked/a.js', 'unreadable', 'withheld', null]]);
    assert.equal(snapshot.base.places, undefined);
    const { codePass } = await passOf(snapshot, session);
    assert.ok(!codePass.footer.some((e) => e.kind === 'outside_root'), JSON.stringify(codePass.footer));
    assert.equal(codePass.coverage, 'partial');
  } finally { await chmod(join(R, 'locked'), 0o755); }
});

test('D117 review: a link that git lists or that the window keeps is never read through to a file outside its place',
  async (t) => {
    const base = await realpath(await folder(t, 'links'));
    const far = join(base, 'far');
    await put(far, { 'target.js': 'FAR_AWAY_TEXT\n' });
    const during = new Date('2030-01-01T12:00:00Z');
    await utimes(join(far, 'target.js'), during, during);
    // In the working repository: a link made during the session, untracked, to a file outside every place.
    const A = await committed(join(base, 'A'), { 'src/parse.js': BASE_PARSE });
    await put(A, { 'src/parse.js': CODE_FILES['src/parse.js'] });
    await symlink(join(far, 'target.js'), join(A, 'link.js'));
    await lutimes(join(A, 'link.js'), during, during);
    // In another repository the session wrote to: the same.
    const B = await committed(join(base, 'B'), { 'lib/b.js': 'export const b = 1;\n' });
    await put(B, { 'lib/b.js': 'export const b = 2;\n' });
    await symlink(join(far, 'target.js'), join(B, 'lib', 'ln.js'));
    await lutimes(join(B, 'lib', 'ln.js'), during, during);
    const recording = await recordingAt(t);
    const snapshot = await readCodeSnapshot(sessionWriting('s-links', [['src/parse.js', CODE_FILES['src/parse.js']],
      [join(B, 'lib', 'b.js'), 'export const b = 2;\n']]), { root: A, maxBytes: 1_000_000, recording });
    assert.deepEqual(snapshot.files.map((f) => [f.path, f.place ?? null, f.recorded, f.state]), [
      ['src/parse.js', null, true, 'readable'], [join(B, 'lib', 'b.js'), B, true, 'readable'],
      ['link.js', null, false, 'outside_root'], [join(B, 'lib', 'ln.js'), B, false, 'unreadable']]);
    assert.ok(!snapshotTexts(snapshot).some((text) => text.includes('FAR_AWAY_TEXT')));
  });

test('D117 review: the code step\'s line names the other folders its agents read, and the working directory when no '
  + 'repository holds it', async (t) => {
  const { A, B, C, home } = await workspace(t);
  const recording = await recordingAt(t);
  const snapshot = await readCodeSnapshot(workspaceSession({ B, C, home }), { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  // D117 amended: the folder of no repository is never read by the agents.
  assert.deepEqual(snapshot.folders, [B]);
  const line = codeStepLine({ on: true, source: 'flag' }, snapshot);
  assert.ok(line.startsWith(CODE_STEP_WORDS.on('--code-pass', 1)), line);
  assert.ok(line.includes(' It also reads one other folder that holds files of the change. '), line);
  // One place: the line as before.
  const alone = await readCodeSnapshot(sessionWriting('s-line-alone', [['src/parse.js', CODE_FILES['src/parse.js']]]),
    { root: A, maxBytes: 1_000_000, recording });
  assert.ok(codeStepLine({ on: true, source: 'flag' }, alone).startsWith(CODE_STEP_WORDS.on('--code-pass')));
  assert.ok(!codeStepLine({ on: true, source: 'flag' }, alone).includes('It also reads'));
  // No repository, no change: the working directory.
  assert.match(codeStepLine({ on: true, source: 'flag' }, { root: true, repository: false, files: [] }),
    /read-only access to the whole working directory\. It found no change to review here/);
});

// ---- D117 amended (the owner, 2026-10-18, decision 1, "cool": "review the session's writes in any git repository; files
// outside any repository are listed, not reviewed; paths that hold an unexpanded $VARIABLE are never counted; the page
// says plainly that edits made by helper agents or by scripts after cd are not seen yet") and its second review ---------

/** A session that ran one shell command (`B1`) and, read from its text, wrote each of `shellWrites` (`[path, text]`, or
 *  `[path, '', 'delete']` for a file the command removed); then wrote each of `writes` with a file tool. `refused`: the
 *  command was refused before it ran. */
function shellSession(key, { shellWrites = [], writes = [], refused = false, delegate = false } = {}) {
  const all = [...shellWrites, ...writes];
  const blobs = { ...CODE_TEXT, cmd: 'cd "$R" && cat > prep.sh', ...Object.fromEntries(all.map(([, text], at) =>
    [`w${at}`, text])) };
  return buildCodeSession(key, blobs, [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'B1', kind: 'invocation', callKey: 'B1', tool: 'Bash', operation: 'command', paths: [], command: [], input: [],
      changes: [], ...(refused ? { recorded: { denial: 'user-rejected' } } : {}), ...T1 },
    { id: 'B1-r', kind: 'observation', invocation: 'B1', blob: 'wrote', ...T1 },
    ...shellWrites.map(([path, , operation], at) => ({ id: `S${at + 1}`, kind: 'invocation', write: path, blob: `w${at}`,
      shellWriteOf: 'B1', ...(operation === 'delete' ? { tool: 'rm', operation, changes: [{ path, before: [], after: [],
        diff: [] }] } : {}), ...T1 })),
    ...writes.flatMap(([path], at) => [{ id: `W${at + 1}`, kind: 'invocation', write: path,
      blob: `w${shellWrites.length + at}`, ...T1 }, { id: `W${at + 1}-r`, kind: 'observation', invocation: `W${at + 1}`,
      blob: 'wrote', ...T1 }]),
    ...(delegate ? [{ id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Task', operation: 'delegate', paths: [],
      command: [], input: [], changes: [], ...T1 }] : []),
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
}

test('D117 amended: a write the shell spelled with an unexpanded variable or command substitution is not resolved — never '
  + 'a place, never a file of the change, counted apart on the page and in the dry run; a file tool\'s `$` name is a file',
async (t) => {
  const { A, B, home } = await workspace(t);
  const recording = await recordingAt(t);
  // `$R/prep.sh` under the working directory and `$S/notes.md` spelled inside B: the shell expanded both to paths the
  // recording does not hold. `src/$id.js`, written by a file tool, is a real file named so.
  await put(A, { 'src/$id.js': 'export const id = 1;\n' });
  const session = shellSession('s-unresolved', { shellWrites: [['$R/prep.sh', 'echo\n'], [join(B, '$S', 'notes.md'),
    'n\n'], [join(B, '$(date)', 'x.md'), 'x\n']], writes: [['src/parse.js', CODE_FILES['src/parse.js']],
    ['src/$id.js', 'export const id = 1;\n']] });
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.equal(snapshot.base.unresolved, 3);
  assert.equal(snapshot.base.written, 5);
  assert.equal(snapshot.base.places, undefined, 'a path not resolved makes no repository a place');
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.diff ?? null]), [['src/parse.js', 'recorded'],
    ['src/$id.js', 'recorded']]);
  const line = codeSnapshotLine(snapshot);
  assert.ok(line.includes(CODE_SNAPSHOT_WORDS.unresolved(3)), line);
  // The record and the page count them apart, in their own sentence.
  const { codePass } = await passOf(snapshot, session);
  assert.equal(codePass.base.unresolved, 3);
  assert.ok(codeWritesLines(codePass).includes(W.unresolved(3)), codeWritesLines(codePass).join('\n'));
  assert.ok(!codePass.files.some((f) => f.path.includes('$R') || f.path.includes('$S') || f.path.includes('$(')));
  // `$HOME/…` keeps D109's class: named from the home folder, counted as such, never "not resolved".
  const homeSession = shellSession('s-home', { shellWrites: [['$HOME/notes.md', 'n\n']] });
  const homeSpelled = await readCodeSnapshot(homeSession, { root: A, maxBytes: 1_000_000, recording });
  assert.equal(homeSpelled.base.unresolved, undefined);
  assert.deepEqual(homeSpelled.files.map((f) => [f.path, f.state, f.home]), [['$HOME/notes.md', 'outside_root', true]]);
  // D122's review: the story classes it as the snapshot does, outside the repository, with the code step off too.
  const homeFacts = storyFacts(homeSession, {}).whole;
  assert.deepEqual([homeFacts.files.length, [...homeFacts.outsidePaths], [...homeFacts.unresolvedPaths]],
    [0, ['$HOME/notes.md'], []]);
});

// ---- The beta.5 integration (D122 (a)): one rule for a path the recording does not resolve, read by every reader -------

test('D122 (a): a shell write whose spelling holds the shell\'s grammar but names a path that exists is a file — in the '
  + 'snapshot, the record, the story, the header and the Files section alike; one that names no path is not resolved',
async (t) => {
  const { A, home } = await workspace(t);
  const recording = await recordingAt(t);
  // A route file named with a literal `$`, written by a shell heredoc (the recording keeps no quoting), relative and
  // absolute; and `$R/prep.sh`, which names no path here.
  const ROUTE = 'export default function User() {}\n';
  await put(A, { 'app/routes/users.$id.tsx': ROUTE, 'lib/$k.js': 'export const k = 1;\n' });
  const session = shellSession('s-literal', { shellWrites: [['app/routes/users.$id.tsx', ROUTE],
    [join(A, 'lib', '$k.js'), 'export const k = 1;\n'], ['$R/prep.sh', 'echo\n']],
  writes: [['src/parse.js', CODE_FILES['src/parse.js']]] });
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.deepEqual(snapshot.base.literal, ['app/routes/users.$id.tsx', join(A, 'lib', '$k.js')]);
  assert.equal(snapshot.base.unresolved, 1);
  assert.equal(snapshot.base.written, 4);
  assert.deepEqual(snapshot.files.map((f) => f.path).sort(), ['app/routes/users.$id.tsx', 'lib/$k.js', 'src/parse.js']);
  assert.ok(codeSnapshotLine(snapshot).includes(CODE_SNAPSHOT_WORDS.unresolved(1)), codeSnapshotLine(snapshot));
  // The record keeps what the snapshot found, so every reader of it decides the same way.
  const { codePass } = await passOf(snapshot, session);
  assert.deepEqual(codePass.base.literal, ['app/routes/users.$id.tsx', join(A, 'lib', '$k.js')]);
  assert.equal(codePass.base.unresolved, 1);
  assert.ok(codePass.files.some((f) => f.path === 'app/routes/users.$id.tsx'));
  const facts = storyFacts(session, { codePass });
  assert.deepEqual([...facts.whole.unresolvedPaths], ['$R/prep.sh']);
  assert.ok(facts.whole.files.some((f) => f.path === 'app/routes/users.$id.tsx'));
  const model = reportModel(session, { codePass }, {});
  assert.deepEqual(model.did.files.unresolved, { n: 1, paths: ['$R/prep.sh'], more: 0 });
  assert.equal(model.header.changeFiles, model.did.files.total);
  // With no record (the code step off), no spelling is known to name a path: the grammar decides, as D118 shipped.
  assert.deepEqual([...storyFacts(session, {}).whole.unresolvedPaths], ['app/routes/users.$id.tsx',
    join(A, 'lib', '$k.js'), '$R/prep.sh']);
  // The disk test alone: of the candidates, those that name a path, under the working folder or as spelled.
  assert.deepEqual(await literalSpellings(['app/routes/users.$id.tsx', '$R/prep.sh', join(A, 'lib', '$k.js')], A),
    ['app/routes/users.$id.tsx', join(A, 'lib', '$k.js')]);
  assert.deepEqual(await literalSpellings(['app/routes/users.$id.tsx'], null), []);
});

test('D122 (a): the shell-only gate — a path a file tool wrote is a file even when it names no path now, and so is one '
  + 'a shell command and a file tool both wrote', async (t) => {
  const { A, home } = await workspace(t);
  const recording = await recordingAt(t);
  const session = shellSession('s-tool-dollar', { shellWrites: [['lib/$both.js', 'b\n']],
    writes: [['src/$gone.js', 'g\n'], ['lib/$both.js', 'b\n']] });
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.equal(snapshot.base.unresolved, undefined);
  assert.equal(snapshot.base.literal, undefined);
  assert.deepEqual(snapshot.plan.map((e) => e.path).sort(), ['lib/$both.js', 'src/$gone.js']);
  assert.deepEqual([...storyFacts(session, {}).whole.unresolvedPaths], []);
});

test('D122 (a), its review (low): a tracked file named with a literal `$` that a shell command deleted names a path — git '
  + 'lists it as differing from the start commit — so it is a deleted file of the change, never a path not resolved, and '
  + 'never a file changed outside the session', async (t) => {
  const ROUTE = 'export default function User() {}\n';
  const A = await committed(join(await folder(t, 'gone'), 'A'), { 'src/parse.js': BASE_PARSE,
    'app/routes/users.$id.tsx': ROUTE });
  await put(A, { 'src/parse.js': CODE_FILES['src/parse.js'] });
  await rm(join(A, 'app', 'routes', 'users.$id.tsx'));
  const recording = await recordingAt(t);
  const session = shellSession('s-literal-gone', { shellWrites: [['app/routes/users.$id.tsx', '', 'delete'],
    ['$R/prep.sh', 'echo\n']], writes: [['src/parse.js', CODE_FILES['src/parse.js']]] });
  assert.deepEqual(await literalSpellings(['app/routes/users.$id.tsx'], A), [], 'premise: the disk no longer holds it');
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.base.literal, ['app/routes/users.$id.tsx']);
  assert.equal(snapshot.base.unresolved, 1, '$R/prep.sh names nothing git lists or the disk holds');
  assert.deepEqual(snapshot.base.changedOutside, []);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.type]).sort(), [['app/routes/users.$id.tsx', 'deleted'],
    ['src/parse.js', 'modified']]);
  assert.ok(!snapshot.outsideFiles.some((f) => f.path === 'app/routes/users.$id.tsx'));
  // The record keeps it, so the story counts the delete as a file of the change too.
  const { codePass } = await passOf(snapshot, session);
  assert.deepEqual(codePass.base.literal, ['app/routes/users.$id.tsx']);
  assert.deepEqual([...storyFacts(session, { codePass }).whole.unresolvedPaths], ['$R/prep.sh']);
});

test('D122, its review (low): docs/PRIVACY.md says what the code step reads as the code reads it — the session\'s writes '
  + 'in other git repositories, never a folder that no repository holds; a spelling checked where it points, or in git\'s '
  + 'list', async () => {
  const flat = (text) => text.replace(/\s+/g, ' ');
  const privacy = flat(await readFile(new URL('../../../docs/PRIVACY.md', import.meta.url), 'utf8'));
  const intro = privacy.slice(0, privacy.indexOf('## What leaves your computer'));
  // D117 amended (the owner, 2026-10-18: "files outside any repository are listed, not reviewed"): the code step reads no
  // folder of no repository (a FOLDER place is only counted), so the opening says so and never names one as read.
  assert.ok(!/repositor(?:y|ies) (?:and|or) folders?\b/.test(intro), intro);
  assert.ok(intro.includes('A folder that no git repository holds, such as a notes folder, is never read'), intro);
  // The one rule's test (3): an absolute spelling is checked where it points (`literalSpellings`), and git's list names a
  // file the session deleted (`namedSpellings`).
  assert.ok(privacy.includes('a relative spelling in the session\'s working folder, an absolute one where it points'));
  assert.ok(privacy.includes('a path that git lists as differing from the start commit in your repository (a file the '
    + 'session deleted)'));
});

test('D117 amended (its second review\'s medium): a repository whose only writes have no difference from its base is no '
  + 'place — D113\'s window never runs over it, and nothing in it is read', async (t) => {
  const { A, B, home } = await workspace(t);
  const recording = await recordingAt(t);
  // The session wrote lib/b.js back to the text it had at the base; someone else's file there last changed while the
  // session ran (lib/run.js), which D113's window would keep in a place.
  await put(B, { 'lib/b.js': 'export const b = 1;\n', 'lib/run.js': 'run during\n' });
  await utimes(join(B, 'lib', 'run.js'), new Date('2030-01-01T12:00:00Z'), new Date('2030-01-01T12:00:00Z'));
  const session = sessionWriting('s-same', [['src/parse.js', CODE_FILES['src/parse.js']], [join(B, 'lib', 'b.js'),
    'export const b = 1;\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.equal(snapshot.base.places, undefined);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.place ?? null, f.state, f.diff ?? null]), [
    ['src/parse.js', null, 'readable', 'recorded'], [join(B, 'lib', 'b.js'), null, 'outside_root', null]]);
  assert.ok(!snapshot.outsideFiles.some((f) => f.path.startsWith(B)));
  assert.equal(snapshot.folders, undefined);
  // The same write with a difference makes B a place, and the window keeps lib/run.js there, unrecorded.
  await put(B, { 'lib/b.js': 'export const b = 2;\n' });
  const placed = await readCodeSnapshot(sessionWriting('s-diff', [['src/parse.js', CODE_FILES['src/parse.js']],
    [join(B, 'lib', 'b.js'), 'export const b = 2;\n']]), { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.deepEqual(placed.base.places.map((p) => p.at), [B]);
  assert.ok(placed.files.some((f) => f.path === join(B, 'lib', 'run.js') && f.recorded === false), 'kept by the window');
});

test('D117 amended (its second review, low): two spellings of one file outside the working directory are one file — in a '
  + 'repository and in a folder of no repository', async (t) => {
  const { A, B, C, home } = await workspace(t);
  const recording = await recordingAt(t);
  // `L` leads to B and `K` to C, as /tmp leads to /private/tmp on macOS.
  const base = dirname(A);
  await symlink(B, join(base, 'L'));
  await symlink(C, join(base, 'K'));
  const session = sessionWriting('s-spellings', [[join(B, 'lib', 'b.js'), 'export const b = 2;\n'],
    [join(base, 'L', 'lib', 'b.js'), 'export const b = 2;\n'], [join(C, 'notes.md'), '# Notes\nThe plan holds.\n'],
    [join(base, 'K', 'notes.md'), '# Notes\nThe plan holds.\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.place ?? null, f.state]), [
    [join(B, 'lib', 'b.js'), B, 'readable'], [join(C, 'notes.md'), null, 'outside_root']]);
  assert.deepEqual(snapshot.base.places.map((p) => [p.at, p.written]), [[B, 1]]);
  assert.deepEqual(snapshot.base.folders, [{ at: C, written: 1 }]);
});

test('D117 amended, D122 (c), D133: the one fixed sentence that Sonah does not yet see every edit of helper agents or of '
  + 'scripts after a cd is said on the page and in the .md (no longer on the terminal) when the session ran a shell '
  + 'command, and only then',
async (t) => {
  const { A, B, C, home } = await workspace(t);
  const recording = await recordingAt(t);
  const writes = [['src/parse.js', CODE_FILES['src/parse.js']]];
  const ran = shellSession('s-ran', { writes });
  const run = await reviewIn(t, { root: A, recording, session: ran, home, judge: codeJudge({ review: noFindings }) });
  assert.equal(run.report.codePass.unseenEdits, true);
  const text = plainText(run.written);
  assert.ok(text.includes(W.unseenEdits), text);
  // D133 (R2; the owner, 2026-10-22: quiet, folded, never false): the terminal's "Code review: on" line no longer says
  // it; the page's and the .md's code review fold do.
  assert.ok(!run.out.includes(W.unseenEdits), run.out);
  assert.ok(run.out.includes(CODE_STEP_WORDS.turnOff), run.out);
  // D122 (c): delegated work alone, or a Workflow call alone, with no command, is no trigger: the trigger is the shell
  // command alone.
  const delegated = await readCodeSnapshot(buildCodeSession('s-del', CODE_TEXT, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Task', operation: 'delegate', paths: [], command: [], input: [],
      changes: [], ...T1 }]), { root: A, maxBytes: 1_000_000, recording });
  assert.equal(delegated.unseenEdits, undefined);
  const workflow = await readCodeSnapshot(buildCodeSession('s-wf', CODE_TEXT, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'F1', kind: 'invocation', callKey: 'F1', tool: 'Workflow', operation: 'other', paths: [], command: [], input: [],
      changes: [], ...T1 }]), { root: A, maxBytes: 1_000_000, recording });
  assert.equal(workflow.unseenEdits, undefined);
  // A delegation beside a command: said, by the command.
  const both = await readCodeSnapshot(shellSession('s-both', { writes, delegate: true }), { root: A,
    maxBytes: 1_000_000, recording });
  assert.equal(both.unseenEdits, true);
  // A command refused before it ran changed nothing: not said. File tools alone: not said.
  const refused = await readCodeSnapshot(shellSession('s-refused', { writes, refused: true }), { root: A,
    maxBytes: 1_000_000, recording });
  assert.equal(refused.unseenEdits, undefined);
  const quiet = await readCodeSnapshot(sessionWriting('s-quiet', writes), { root: A, maxBytes: 1_000_000, recording });
  assert.equal(quiet.unseenEdits, undefined);
  // D133's review: the code step line never says it (the end-to-end run above), so its negatives here are gone; the
  // snapshot's `unseenEdits` pins the trigger, and the code review's fold says it (code-report.js `codeWritesLines`,
  // also with an empty change).
  assert.ok(B && C);
});

test('D117 amended (its second review, low): the code step\'s line never counts the repository\'s top folder among the '
  + 'other folders, with the working directory below it and another place beside it', async (t) => {
  const base = await realpath(await folder(t, 'below-top'));
  const top = await committed(join(base, 'repo'), { 'app/src/parse.js': BASE_PARSE });
  await put(top, { 'app/src/parse.js': CODE_FILES['src/parse.js'] });
  const B = await committed(join(base, 'B'), { 'lib/b.js': 'export const b = 1;\n' });
  await put(B, { 'lib/b.js': 'export const b = 2;\n' });
  const recording = await recordingAt(t);
  const snapshot = await readCodeSnapshot(sessionWriting('s-below', [['src/parse.js', CODE_FILES['src/parse.js']],
    [join(B, 'lib', 'b.js'), 'export const b = 2;\n']]), { root: join(top, 'app'), maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.folders, [top, B]);
  const line = codeStepLine({ on: true, source: 'flag' }, snapshot);
  assert.ok(line.startsWith(CODE_STEP_WORDS.on('--code-pass', 1)), line);
  assert.ok(line.includes(' It also reads one other folder that holds files of the change. '), line);
});

test('D117 amended (its second review, low): a repository whose only written file is not there any more is no place, so '
  + 'no line says the agents read a folder that holds files of the change', async (t) => {
  const { A, B, home } = await workspace(t);
  const recording = await recordingAt(t);
  // The session wrote a new file in B, then it was removed: nothing of B is there to review.
  const session = sessionWriting('s-gone-b', [['src/parse.js', CODE_FILES['src/parse.js']], [join(B, 'lib', 'gone.js'),
    'gone\n']]);
  const snapshot = await readCodeSnapshot(session, { root: A, maxBytes: 1_000_000, recording,
    harnessHomes: [join(home, '.claude')] });
  assert.equal(snapshot.base.places, undefined);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.state]), [['src/parse.js', 'readable'],
    [join(B, 'lib', 'gone.js'), 'outside_root']]);
  const line = codeStepLine({ on: true, source: 'flag' }, snapshot);
  assert.ok(!line.includes('It also reads'), line);
  const { codePass } = await passOf(snapshot, session);
  assert.equal(codePass.coverage, 'complete');
  // A repository whose history began during the session (no base: its change would be the recorded edits): one whose
  // only written file is not there any more is no place either.
  const U = join(dirname(A), 'U');
  await mkdir(U, { recursive: true });
  git(U, ['init', '-q', '-b', 'main']);
  const unborn = await readCodeSnapshot(sessionWriting('s-gone-u', [['src/parse.js', CODE_FILES['src/parse.js']],
    [join(U, 'gone.js'), 'gone\n']]), { root: A, maxBytes: 1_000_000, recording });
  assert.equal(unborn.base.places, undefined);
  await put(U, { 'there.js': 'there\n' });
  const there = await readCodeSnapshot(sessionWriting('s-there-u', [['src/parse.js', CODE_FILES['src/parse.js']],
    [join(U, 'there.js'), 'there\n']]), { root: A, maxBytes: 1_000_000, recording });
  assert.deepEqual(there.base.places, [{ kind: 'recorded_edits', at: U, repository: true, written: 1 }]);
});
