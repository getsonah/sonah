// D207's two reviews: what they found that held. A recording with no action holds no commit of the session, so the end test
// still runs. A first line with shell quoting is searched as the shell spells it. A place keeps the waits when the working
// folder is in no git repository. The base line, the terminal, the first screen and the PR comment say what the record
// holds: a commit-placed file with no request, a commit of another place under a named base, a window-only run, a named base,
// a repository larger than the working folder, and a way out only where it can work.
//
// Throwaway repositories, synthetic recordings, a fake reviewer: no model, no network. Every date a rule reads is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { actionsOf, authoredCommits, readCodeSnapshot, runGit } from '../src/code-snapshot.js';
import { codeSnapshotLine, REVIEW_FIX_WORDS } from '../src/session-review-command.js';
import { CODE_REVIEW_SYSTEM, outsideBlock, windowOnlyOf } from '../../evidence/src/code-pass.js';
import { BRANCH_WORDS, CODE_REPORT_WORDS as W, branchWayOutOf, codeBaseLine, codeCoverageLines, codeNotReviewedOf,
  notReviewedWordsOf } from '../../evidence/src/code-report.js';
import { publicCommentText } from '../../github/index.js';
import { REPORT_HEADER_WORDS, REPORT_ITEM_WORDS } from '../../render/report-words.js';
import { at, claude, codex, ms, recording, repository, reviewOf, ROLLOUT, scratch, sessionOf } from './d207-fixture.js';

const IN_WINDOW = ms('10:30:00');
const hour = (t, commands = []) => recording(t, [claude.human(at('10:00:00')),
  ...commands.map(([when, command], n) => claude.action(when, command, `c${n}`)), claude.action(at('10:59:00'), 'true', 'last'),
  claude.result(at('11:00:00'), '', 'last')]);
const snapshotOf = (root, file, extra = {}) => readCodeSnapshot(sessionOf(), { root, maxBytes: 1_620_000, recording: file,
  activity: [{ file }], ...extra });
const placesOf = (snap) => Object.fromEntries(snap.plan.map((e) => [e.path, e.recorded ? 'write' : e.placedBy]));
const unescaped = (md) => md.replace(/\\(.)/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('D207\'s review: a recording with no action holds no commit of the session, so the end test still runs', async (t) => {
  const repo = await repository(t, { 'a.txt': 'one\n', 'b.txt': 'one\n', 'c.txt': 'one\n' });
  await repo.put('b.txt', 'theirs\n', IN_WINDOW);
  repo.git(['commit', '-qam', 'A commit of other hands'], '2030-01-01T10:31:00Z');
  await repo.put('b.txt', 'theirs\n', IN_WINDOW);
  await repo.put('c.txt', 'dirty\n', IN_WINDOW);
  // D207's second review: the agent's last row ends the work, so each ends with the agent's words.
  const silent = await recording(t, [claude.human(at('10:00:00')), claude.thought(at('10:30:00'), 'thinking'),
    claude.human(at('10:50:00')), claude.thought(at('11:00:00'), 'done')]);
  const snap = await snapshotOf(repo.top, silent);
  assert.deepEqual(placesOf(snap), { 'c.txt': 'time' });
  assert.deepEqual(snap.base.changedOutside, ['b.txt']);
  assert.equal(snap.base.timeByWindow, undefined);
  // The same recording with one action says the same.
  const one = await recording(t, [claude.human(at('10:00:00')), claude.action(at('10:10:00'), 'true', 'c1'),
    claude.human(at('10:50:00')), claude.thought(at('11:00:00'), 'done')]);
  assert.deepEqual(placesOf(await snapshotOf(repo.top, one)), { 'c.txt': 'time' });
  // No recording to read still says nothing: the window decides.
  assert.deepEqual(placesOf(await snapshotOf(repo.top, silent, { activity: [] })), { 'b.txt': 'time', 'c.txt': 'time' });
  // A recording with no timestamps has no end: no window, so nothing is placed by time, as D113's.
  const timeless = await recording(t, [claude.human(null)]);
  assert.deepEqual(placesOf(await snapshotOf(repo.top, timeless)), {});
});

test('D207\'s review: a first line with shell quoting is searched as the shell spells it; nothing is expanded', async (t) => {
  const cases = [['Fix "foo" bug', 'git commit -qam "Fix \\"foo\\" bug"'], ['Name `run` now', 'git commit -qam "Name \\`run\\` now"'],
    ['Pay $5 less', 'git commit -qam "Pay \\$5 less"'], ['Split a\\b', 'git commit -qam "Split a\\\\b"'],
    ['Don\'t crash', 'git commit -qam \'Don\'\\\'\'t crash\''], ['Don\'t fail', 'git commit -qam \'Don\'"\'"\'t fail\''],
    ['Don\'t stop', 'git commit -qam $\'Don\\\'t stop\'']];
  for (const [subject, command] of cases) {
    const repo = await repository(t);
    await repo.put('b.txt', 'two\n');
    repo.git(['commit', '-qam', subject], '2030-01-01T10:31:00Z');
    const file = await hour(t, [[at('10:30:00'), command]]);
    assert.equal((await authoredCommits({ top: repo.top, base: repo.base, actions: await actionsOf([{ file }]) })).length, 1, command);
    // And the whole way: its command-written file is the session's.
    assert.deepEqual(placesOf(await snapshotOf(repo.top, file)), { 'b.txt': 'commit' }, command);
  }
  // The same spelling typed only after the commit, and a first line a variable built: not authored.
  const repo = await repository(t);
  await repo.put('b.txt', 'two\n');
  repo.git(['commit', '-qam', 'Fix "foo" bug'], '2030-01-01T10:31:00Z');
  const late = await hour(t, [[at('10:32:00'), 'git log --grep="Fix \\"foo\\" bug"']]);
  assert.deepEqual(await authoredCommits({ top: repo.top, base: repo.base, actions: await actionsOf([{ file: late }]) }), []);
  const built = await hour(t, [[at('10:30:00'), 'V=1.2.3; git commit -qam "Bump to $V"']]);
  const bump = await repository(t);
  await bump.put('b.txt', 'two\n');
  bump.git(['commit', '-qam', 'Bump to 1.2.3'], '2030-01-01T10:31:00Z');
  assert.deepEqual(await authoredCommits({ top: bump.top, base: bump.base, actions: await actionsOf([{ file: built }]) }), []);
});

test('D207\'s review: a place keeps D206\'s waits when the working folder is in no git repository', async (t) => {
  const sibling = await repository(t, { 'w.txt': 'one\n', 'k.txt': 'one\n' });
  sibling.git(['commit', '-q', '--allow-empty', '-m', 'At the start'], '2030-01-01T09:00:00Z');
  await sibling.put('w.txt', 'written\n', ms('10:10:00'));
  // Changed while the agent waited: its turn ended at 10:20, the next message came at 10:50.
  await sibling.put('k.txt', 'dirty\n', IN_WINDOW);
  const rollout = await recording(t, [codex.meta(at('10:00:00')), codex.human(at('10:00:01')), codex.say(at('10:20:00')),
    codex.ended(at('10:20:00')), codex.human(at('10:50:00')), codex.say(at('11:00:00'))], ROLLOUT);
  const written = join(sibling.top, 'w.txt');
  const session = sessionOf('s-place', [[written, 'written']], { written: 'written\n' });
  const folder = await scratch(t);
  const inNoGit = await readCodeSnapshot(session, { root: folder, maxBytes: 1_620_000, recording: rollout, activity: [{ file: rollout }] });
  assert.equal(inNoGit.base.kind, 'recorded_edits');
  const place = inNoGit.base.places.find((p) => p.at === sibling.top);
  assert.deepEqual(place.changedOutside, [join(sibling.top, 'k.txt')]);
  // And as with the working folder in git.
  const inGit = await repository(t);
  const beside = await readCodeSnapshot(session, { root: inGit.top, maxBytes: 1_620_000, recording: rollout, activity: [{ file: rollout }] });
  assert.deepEqual(beside.base.places.find((p) => p.at === sibling.top).changedOutside, place.changedOutside);
});

test('D207\'s review: with no review request, the base line counts the record\'s files by how each came in', async (t) => {
  const repo = await repository(t);
  await repo.put('bin.dat', 'a\0b\n');
  repo.git(['add', '-A']);
  repo.git(['commit', '-qm', 'Add the data'], '2030-01-01T10:31:00Z');
  const file = await hour(t, [[at('10:30:00'), 'git commit -qm "Add the data"']]);
  const run = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-binary') });
  assert.deepEqual(run.codeCalls.filter((r) => /^code-review/.test(r.label)), []);
  const pass = run.report.codePass;
  assert.equal(pass.files.find((f) => f.path === 'bin.dat').placedBy, 'commit');
  const line = codeBaseLine(pass);
  assert.ok(line.endsWith('No recorded write of the session changed its one file. 1 is in a commit the session made.'), line);
  assert.equal(line.includes('could have changed'), false, line);
});

test('D207\'s review: the terminal\'s head counts every way in, and sums to the change', () => {
  const base = { kind: 'git', commit: 'a'.repeat(40), how: 'merge_base', namedRef: 'main', changedOutside: [],
    places: [{ kind: 'git', at: '/x', commit: 'b'.repeat(40), how: 'reflog', changedOutside: [], written: 1 }] };
  const files = [{ path: 'w.txt', recorded: true, diff: 'recorded' }, { path: 'a.txt', recorded: false, diff: 'unrecorded_change', placedBy: 'base' },
    { path: '/x/y.txt', recorded: false, diff: 'unrecorded_change', placedBy: 'commit', place: '/x' }];
  const named = codeSnapshotLine({ root: true, base, files, repository: true });
  assert.ok(named.includes('the change holds 3 paths. 1 is by a recorded write, and 1 is in a commit the session made. 0 are by time alone, and 1 is by the base you named.'), named);
  const noCommit = codeSnapshotLine({ root: true, base: { ...base, places: undefined }, files: files.slice(0, 2), repository: true });
  assert.equal(noCommit.includes('in a commit'), false, noCommit);
  // Git or a recording could not say: no commit was read, so none is counted.
  const windowOnly = codeSnapshotLine({ root: true, repository: true, files: [files[0], { ...files[1], placedBy: 'time' }],
    base: { kind: 'git', commit: 'a'.repeat(40), how: 'reflog', changedOutside: [], timeByWindow: true } });
  assert.equal(windowOnly.includes('in a commit'), false, windowOnly);
  assert.ok(windowOnly.includes('1 is by time alone'), windowOnly);
});

test('D207\'s review: where git or a recording could not say, no reader says what commits hold', async (t) => {
  const repo = await repository(t);
  await repo.put('b.txt', 'after the end\n', ms('12:00:00'));
  const file = await hour(t);
  const failingLog = (args, options) => (args[0] === 'log' && args[1] === '-z' ? { ok: false, stdout: null } : runGit(args, options));
  const snap = await snapshotOf(repo.top, file, { git: failingLog });
  // No file is placed by time here, and one outside was still placed by the window alone.
  assert.equal(snap.base.timeByWindow, true);
  assert.equal(windowOnlyOf(snap.base), true);
  assert.equal(windowOnlyOf({ places: [{ timeByWindow: true }] }), true);
  assert.equal(windowOnlyOf({ places: [{}] }), false);
  const sure = await snapshotOf(repo.top, file);
  assert.equal(sure.base.timeByWindow, undefined);
  const note = outsideBlock([], { windowOnly: true }).text;
  assert.equal(note.includes('commit the session made'), false, note);
  assert.ok(note.includes('none of them last changed while the agent was working'), note);
  assert.ok(outsideBlock([]).text.includes('no commit the session made changed them itself'));
});

test('D207\'s review: the dry run of a session with no change of its own names the way out and claims no time', async (t) => {
  const repo = await repository(t);
  await repo.put('a.txt', 'theirs\n', IN_WINDOW);
  await repo.put('b.txt', 'theirs\n', IN_WINDOW);
  repo.git(['commit', '-qam', 'A commit of other hands'], '2030-01-01T10:31:00Z');
  await repo.put('a.txt', 'theirs\n', IN_WINDOW);
  await repo.put('b.txt', 'theirs\n', IN_WINDOW);
  const file = await hour(t);
  const dry = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-none'), extra: ['--dry-run'] });
  assert.equal(dry.code, 0, dry.err);
  assert.ok(dry.out.includes('Code review: the change holds 0 paths.'), dry.out);
  assert.equal(dry.out.includes('changed during the session'), false, dry.out);
  assert.ok(dry.out.includes(BRANCH_WORDS), dry.out);
  // D207's review of real reports: what holds of them (a commit of other hands holds both, made while the agent worked),
  // and the way out said once.
  assert.ok(dry.out.includes(`2 more paths are outside the evaluated session. ${W.outsideWhy.commit(2)}`), dry.out);
  assert.equal(dry.out.split(BRANCH_WORDS).length, 2, dry.out);
  // A named base, or a change to review: no way out to name.
  const named = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-none'), extra: ['--dry-run', '--code-base', 'HEAD'] });
  assert.equal(named.out.includes(BRANCH_WORDS), false, named.out);
});

test('D207\'s review: a named base is said on the first screen, in the terminal and in the PR comment; a larger repository too', async (t) => {
  const repo = await repository(t, { 'app/a.txt': 'one\n', 'lib/b.txt': 'one\n', 'lib/c.txt': 'one\n' });
  repo.git(['checkout', '-q', '-b', 'feature']);
  await repo.put('app/a.txt', 'two\n', ms('08:00:00'));
  await repo.put('lib/b.txt', 'two\n', ms('08:00:00'));
  await repo.put('lib/c.txt', 'two\n', ms('08:00:00'));
  repo.git(['commit', '-qam', 'Work the recording never names'], '2029-06-01T00:00:00Z');
  const root = join(repo.top, 'app');
  const file = await hour(t);
  const run = await reviewOf(t, { root, file, session: sessionOf('s-sub'), extra: ['--code-base', 'main'] });
  const pass = run.report.codePass;
  assert.deepEqual([pass.files.map((f) => f.path), pass.base.outside], [['a.txt'], 2]);
  // The base line: what it holds, and what stays out.
  const line = codeBaseLine(pass);
  assert.ok(line.endsWith('It holds only the working directory: 2 more paths differ outside it.'), line);
  // The terminal: the same status with its base.
  assert.ok(run.out.includes('with the base you named (main) and 2 paths outside the working directory left out'), run.out);
  // The first screen, before any fold: the top line.
  const text = unescaped(run.written);
  assert.ok(text.includes('a change of 1 file since main'), text.slice(0, 500));
  assert.ok(text.includes(W.placedRow.base));
  assert.ok(W.placedRow.base.includes('it may not be the agent\'s'));
  assert.ok(REPORT_HEADER_WORDS.change(1).startsWith('a change of 1 file'));
  assert.equal(REPORT_HEADER_WORDS.change(1).includes('since'), false);
  // The PR comment names no ref, and says the person named the base.
  const comment = publicCommentText(run.report).summary.replace(/\\(.)/g, '$1');
  assert.ok(comment.includes('The person named the base of the code review with --code-base.'), comment);
  const without = await reviewOf(t, { root, file, session: sessionOf('s-sub') });
  assert.equal(publicCommentText(without.report).summary.replace(/\\(.)/g, '$1').includes('--code-base.'), false);
});

test('D207\'s review: with a named base, the review\'s brief and the reader name the base, not the session, on the old side', async (t) => {
  assert.ok(CODE_REVIEW_SYSTEM.includes('OLD the\nline\'s number before the session'));
  const repo = await repository(t);
  repo.git(['checkout', '-q', '-b', 'feature']);
  await repo.put('a.txt', 'two\n', ms('08:00:00'));
  repo.git(['commit', '-qam', 'Work the recording never names'], '2029-06-01T00:00:00Z');
  const run = await reviewOf(t, { root: repo.top, file: await hour(t), session: sessionOf('s-old'), extra: ['--code-base', 'main'] });
  assert.ok(run.codeCalls.length > 0);
  for (const request of run.codeCalls) assert.equal(/before the\s+session/.test(request.system), false, request.label);
  const review = run.codeCalls.find((r) => /^code-review/.test(r.label));
  assert.ok(review.system.includes('OLD the\nline\'s number at the base of the change'));
  assert.equal(REPORT_ITEM_WORDS.codeBeforeNamed, 'The code at the base of the change:');
});

test('D207\'s review: the way to a branch is offered only where it can work', async (t) => {
  // No git repository holds the folder: no way out to name, in any reason.
  const folder = await scratch(t);
  const file = await hour(t);
  const run = await reviewOf(t, { root: folder, file, session: sessionOf('s-no-git') });
  assert.equal(run.code, 0, run.err);
  assert.equal(codeNotReviewedOf(run.report.codePass), 'no_write');
  assert.equal(unescaped(run.written).includes('--code-base'), false);
  // A record of an earlier code step keeps its words, in the reason and in the line.
  const earlier = { ran: true, version: { pass: 'sonah.code-pass/13' }, base: { kind: 'git', commit: 'a'.repeat(40), written: 1, changedOutside: ['x'] }, files: [] };
  assert.equal(branchWayOutOf(earlier), false);
  assert.equal(notReviewedWordsOf(earlier, 'no_write'), W.notReviewed(W.notReviewedReasons.no_write));
  assert.deepEqual(codeCoverageLines(earlier), [W.noWrittenChange]);
  // This code step's, in a git repository.
  const now = { ...earlier, version: { pass: 'sonah.code-pass/14' } };
  assert.equal(notReviewedWordsOf(now, 'no_write'), `No code was reviewed. Reason: ${W.notReviewedReasons.no_write}. ${BRANCH_WORDS}`);
  assert.deepEqual(codeCoverageLines(now), [`${W.noWrittenChange} ${BRANCH_WORDS}`]);
});

test('D207\'s review: a named base where only an untracked file differs says so, beside the file it names', async (t) => {
  const repo = await repository(t);
  await repo.put('new.txt', 'after the end\n', ms('12:00:00'));
  const run = await reviewOf(t, { root: repo.top, file: await hour(t), session: sessionOf('s-untracked'), extra: ['--code-base', 'HEAD'] });
  assert.equal(run.code, 0, run.err);
  const pass = run.report.codePass;
  assert.deepEqual(pass.base.changedOutside, ['new.txt']);
  assert.equal(codeNotReviewedOf(pass), 'no_file');
  assert.equal(notReviewedWordsOf(pass, 'no_file'), `No code was reviewed. Reason: ${W.notReviewedNamedBase}.`);
  const text = unescaped(run.written);
  assert.ok(text.includes(W.notReviewedNamedBase), text.slice(0, 400));
  assert.equal(text.includes(W.notReviewedReasons.no_file), false);
  assert.deepEqual(codeCoverageLines(pass), [W.noFileNamedBase]);
});

test('D207\'s review: --code-base on a review whose code review does not run stops it, as a bad name does', async (t) => {
  const repo = await repository(t);
  const run = await reviewOf(t, { root: repo.top, file: await hour(t), session: sessionOf('s-off'),
    extra: ['--backend', 'codex-cli', '--code-base', 'no-such-ref', '--dry-run'] });
  assert.equal(run.code, 2, run.out);
  assert.ok(run.err.includes('code_base_no_code_step'), run.err);
  assert.ok(run.err.includes(REVIEW_FIX_WORDS.code_base_no_code_step), run.err);
});
