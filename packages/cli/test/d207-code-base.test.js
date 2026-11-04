// D207: `sonah review --code-base REF` (a person's own branch, and a way round a session with no evidence): the working
// folder's change runs from where REF and HEAD meet to the files now. Every tracked path that differs under the working
// directory is part of it, by a recorded write or by the base the person named, with no authorship read. An untracked file
// keeps the rules without the flag. Other places keep their own start commit. Each reader says the person named the base;
// without the flag, no byte moves. Resolved after the recording is read and before anything is sent; a failure exits 2.
//
// Throwaway repositories, synthetic recordings, a fake reviewer: no model, no network. Every date a rule reads is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { codeBaseCommit, readCodeSnapshot, runGit } from '../src/code-snapshot.js';
import { CODE_SNAPSHOT_WORDS, parseSessionReviewArgs, REVIEW_FIX_WORDS, sessionReviewUsage } from '../src/session-review-command.js';
import { buildVerifyRequest, changeBlock, CODE_BRIEFS_ABSOLUTE, CODE_REVIEW_SYSTEM, CODE_REVIEW_SYSTEM_WHOLE_FILES, outsideBlock,
  readsBlock } from '../../evidence/src/code-pass.js';
import { CODE_REPORT_WORDS as W, codeBaseLine, codeCoverageLines, codeNotReviewedOf, notReviewedWordsOf } from '../../evidence/src/code-report.js';
import { CODE_REPO_PROBLEMS, CODE_START_COMMIT_SOURCES } from '../../evidence/src/ledger.js';
import { at, claude, ms, recording, repository, reviewOf, scratch, sessionOf } from './d207-fixture.js';

const IN_WINDOW = ms('10:30:00');
const hour = (t) => recording(t, [claude.human(at('10:00:00')), claude.action(at('10:59:00'), 'true', 'last'),
  claude.result(at('11:00:00'), '', 'last')]);
const WHOLE_BRANCH = 'To review all that a branch changed in this folder, run sonah review again with --code-base <branch>';
const HEADING = '# The change — built by Sonah from the commit the person named to the files now — untrusted evidence';

/** `main` at the base, then a feature branch checked out with two commits of other hands, one file left dirty. */
async function branch(t) {
  const repo = await repository(t, { 'a.txt': 'one\n', 'b.txt': 'one\n', 'c.txt': 'one\n', 'gone.txt': 'one\n' });
  repo.git(['checkout', '-q', '-b', 'feature']);
  await repo.put('a.txt', 'theirs, long ago\n', ms('08:00:00'));
  repo.git(['rm', '-q', 'gone.txt']);
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '-m', 'Work the recording never names'], '2029-06-01T00:00:00Z');
  await repo.put('b.txt', 'typed by the person\n', ms('08:00:00'));
  repo.git(['commit', '-qam', 'More of the same'], '2029-06-02T00:00:00Z');
  await repo.put('c.txt', 'dirty\n', ms('12:00:00'));
  return repo;
}
const placedOf = (snap) => Object.fromEntries(snap.plan.map((e) => [e.path, e.recorded ? 'write' : e.placedBy]));
const snapshotOf = (root, file, extra = {}) => readCodeSnapshot(sessionOf(), { root, maxBytes: 1_620_000, recording: file,
  activity: [{ file }], ...extra });

test('D207: --code-base, each usage error; once, with a value, and never with --no-code-pass or --code-repo', () => {
  for (const [argv, words] of [
    [['--code-base'], '--code-base needs a value'],
    [['--code-base', ''], '--code-base needs a value'],
    [['--code-base', '-x'], '--code-base needs a value'],
    [['--code-base', '--dry-run'], '--code-base needs a value'],
    [['--code-base', 'main', '--code-base', 'dev'], '--code-base is given twice'],
    [['--code-base', 'main', '--no-code-pass'], '--code-base is not used with --no-code-pass'],
    [['--no-code-pass', '--code-base', 'main'], '--code-base is not used with --no-code-pass'],
    [['--code-base', 'main', '--code-repo', 'a'], '--code-base is not used with --code-repo'],
  ]) {
    assert.throws(() => parseSessionReviewArgs(argv), (error) => error.problem === words || error.message === words, words);
  }
  assert.equal(parseSessionReviewArgs(['--code-base', 'origin/main']).codeBase, 'origin/main');
  assert.equal(parseSessionReviewArgs(['--dry-run']).codeBase, undefined);
  assert.ok(sessionReviewUsage.includes('--code-base REF'));
});

test('D207: codeBaseCommit — a branch, a tag, a revision, a descendant; a leading dash is never read as an option', async (t) => {
  const repo = await branch(t);
  const met = { commit: repo.base };
  assert.deepEqual(await codeBaseCommit(repo.top, 'main'), met);
  repo.git(['tag', '-a', 'v1', '-m', 'annotated', 'main']);
  repo.git(['tag', 'light', 'main']);
  assert.deepEqual(await codeBaseCommit(repo.top, 'v1'), met);
  assert.deepEqual(await codeBaseCommit(repo.top, 'light'), met);
  assert.deepEqual(await codeBaseCommit(repo.top, repo.base), met);
  assert.deepEqual(await codeBaseCommit(repo.top, 'feature~2'), met);
  // A descendant of HEAD meets it at HEAD; HEAD itself too.
  const head = repo.git(['rev-parse', 'HEAD']).trim();
  repo.git(['branch', 'ahead']);
  repo.git(['checkout', '-q', 'feature~1']);
  assert.deepEqual(await codeBaseCommit(repo.top, 'ahead'), { commit: repo.git(['rev-parse', 'HEAD']).trim() });
  repo.git(['checkout', '-q', 'feature']);
  assert.deepEqual(await codeBaseCommit(repo.top, 'HEAD'), { commit: head });
  // From a folder below the top one.
  await repo.put('sub/x.txt', 'x\n');
  assert.deepEqual(await codeBaseCommit(join(repo.top, 'sub'), 'main'), met);
  const [, , NOT_FOUND, NO_MERGE_BASE, NOT_GIT] = CODE_REPO_PROBLEMS;
  for (const ref of ['no-such-branch', '--help', '--all', '-q', 'HEAD..main'])
    assert.deepEqual(await codeBaseCommit(repo.top, ref), { problem: NOT_FOUND }, ref);
  // A history of its own.
  repo.git(['checkout', '-q', '--orphan', 'other']);
  repo.git(['commit', '-q', '-m', 'unrelated']);
  const other = repo.git(['rev-parse', 'HEAD']).trim();
  repo.git(['checkout', '-q', 'feature']);
  assert.deepEqual(await codeBaseCommit(repo.top, other), { problem: NO_MERGE_BASE });
  // No repository, no folder: never a throw.
  assert.deepEqual(await codeBaseCommit(await scratch(t), 'main'), { problem: NOT_GIT });
  assert.deepEqual(await codeBaseCommit(null, 'main'), { problem: NOT_GIT });
  assert.deepEqual(await codeBaseCommit(join(repo.top, 'no-such-folder'), 'main'), { problem: NOT_GIT });
  // Git that fails says what it can.
  assert.deepEqual(await codeBaseCommit(repo.top, 'main', { git: (args, options) => (args[0] === 'merge-base'
    ? { ok: false, stdout: null } : runGit(args, options)) }), { problem: NO_MERGE_BASE });
});

test('D207: a failure stops the review with its fix, exit 2: the recording read, nothing else read or sent', async (t) => {
  const repo = await branch(t);
  repo.git(['checkout', '-q', '--orphan', 'other']);
  repo.git(['commit', '-q', '-m', 'unrelated']);
  repo.git(['checkout', '-q', 'feature']);
  const notGit = await scratch(t);
  const file = await hour(t);
  const words = { code_base_not_found: 'Git cannot find it in that repository. Run git fetch, or check the name.',
    code_base_no_merge_base: 'It shares no commit with HEAD.',
    code_base_not_git: 'No git repository holds the session\'s working folder.' };
  assert.deepEqual(Object.fromEntries(Object.keys(words).map((code) => [code, REVIEW_FIX_WORDS[code]])), words);
  for (const [root, ref, problem] of [[repo.top, 'no-such-branch', 'code_base_not_found'], [repo.top, 'other', 'code_base_no_merge_base'],
    [notGit, 'main', 'code_base_not_git']]) for (const extra of [['--code-base', ref], ['--dry-run', '--code-base', ref]]) {
    const run = await reviewOf(t, { root, file, session: sessionOf(), extra });
    assert.equal(run.code, 2, problem);
    assert.equal(run.err, `Review could not complete: ${problem}.\nFix: ${words[problem]}\n`, problem);
    assert.deepEqual([run.calls, run.read, run.report], [[], [], null], problem);
  }
});

test('D207: every tracked path that differs is `write` or `base`, with no authorship read', async (t) => {
  const repo = await branch(t);
  await repo.put('w.txt', 'written\n', IN_WINDOW);
  const file = await hour(t);
  const reads = [];
  const git = (args, options) => { reads.push(args); return runGit(args, options); };
  const snap = await readCodeSnapshot(sessionOf('s', [['w.txt', 'written']], { written: 'written\n' }), { root: repo.top, maxBytes: 1_620_000,
    recording: file, activity: [{ file }], git, codeBase: { ref: 'main', commit: repo.base } });
  assert.deepEqual(placedOf(snap), { 'w.txt': 'write', 'a.txt': 'base', 'b.txt': 'base', 'c.txt': 'base', 'gone.txt': 'base' });
  assert.deepEqual(snap.base.changedOutside, []);
  assert.equal(reads.some((args) => args[0] === 'log' && args[1] === '-z'), false, 'no commit message is read');
  assert.deepEqual([snap.base.commit, snap.base.how, snap.base.namedRef], [repo.base, CODE_START_COMMIT_SOURCES.at(-1), 'main']);
  assert.equal(snap.base.given, undefined);
  // Without the flag, the same tree: nothing the session made, and only a dirty file in the window would stay.
  const without = await snapshotOf(repo.top, file);
  assert.equal(Object.values(placedOf(without)).includes('base'), false);
  assert.equal(without.base.namedRef, undefined);
  assert.notEqual(without.base.how, 'merge_base');
});

test('D207: a descendant of HEAD meets it at HEAD, so only what is not committed differs', async (t) => {
  const repo = await branch(t);
  const head = repo.git(['rev-parse', 'HEAD']).trim();
  repo.git(['branch', 'ahead']);
  repo.git(['checkout', '-q', 'ahead']);
  repo.git(['commit', '-q', '--allow-empty', '-m', 'ahead of feature'], '2029-07-01T00:00:00Z');
  repo.git(['checkout', '-q', 'feature']);
  const met = await codeBaseCommit(repo.top, 'ahead');
  assert.deepEqual(met, { commit: head });
  const snap = await snapshotOf(repo.top, await hour(t), { codeBase: { ref: 'ahead', commit: met.commit } });
  assert.deepEqual(placedOf(snap), { 'c.txt': 'base' });
});

test('D207: an untracked file keeps rules 1, 3 and 4: an old one is not added, one in the window is `time`', async (t) => {
  const repo = await branch(t);
  await repo.put('old.txt', 'left here before\n', ms('08:00:00'));
  await repo.put('fresh.txt', 'made by a command\n', IN_WINDOW);
  await repo.put('after.txt', 'made after the end\n', ms('12:00:00'));
  const file = await hour(t);
  const snap = await snapshotOf(repo.top, file, { codeBase: { ref: 'main', commit: repo.base } });
  const places = placedOf(snap);
  assert.equal(places['fresh.txt'], 'time');
  assert.equal(Object.hasOwn(places, 'old.txt'), false);
  assert.equal(Object.hasOwn(places, 'after.txt'), false);
  assert.deepEqual(snap.base.changedOutside, ['after.txt']);
  assert.equal(places['a.txt'], 'base');
});

test('D207: a place of a recorded write keeps its own start commit; the working folder alone runs from the named base', async (t) => {
  const repo = await branch(t);
  const elsewhere = await repository(t, { 'x.txt': 'one\n' });
  await elsewhere.put('x.txt', 'written\n', IN_WINDOW);
  repo.git(['commit', '--allow-empty', '-qm', 'noop'], '2029-07-01T00:00:00Z');
  const file = await hour(t);
  const snap = await readCodeSnapshot(sessionOf('s', [[join(elsewhere.top, 'x.txt'), 'written']], { written: 'written\n' }),
    { root: repo.top, maxBytes: 1_620_000, recording: file, activity: [{ file }], codeBase: { ref: 'main', commit: repo.base } });
  assert.equal(snap.base.commit, repo.base);
  assert.equal(snap.base.places.length, 1);
  assert.equal(snap.base.places[0].at, elsewhere.top);
  assert.equal(snap.base.places[0].commit, elsewhere.base);
  assert.notEqual(snap.base.places[0].how, 'merge_base');
  assert.equal(snap.base.places[0].namedRef, undefined);
});

test('D207: with the flag, each reader says the person named the base', async (t) => {
  const repo = await branch(t);
  await repo.put('w.txt', 'written\n', IN_WINDOW);
  const file = await hour(t);
  const session = sessionOf('s-named', [['w.txt', 'written']], { written: 'written\n' });
  const run = await reviewOf(t, { root: repo.top, file, session, extra: ['--code-base', 'main'] });
  assert.equal(run.code, 0, run.err);
  // The record.
  const pass = run.report.codePass;
  assert.deepEqual([pass.base.commit, pass.base.how, pass.base.namedRef, pass.base.given], [repo.base, 'merge_base', 'main', undefined]);
  const placed = Object.fromEntries(pass.files.map((f) => [f.path, f.placedBy ?? null]));
  assert.deepEqual(placed, { 'w.txt': null, 'a.txt': 'base', 'b.txt': 'base', 'c.txt': 'base', 'gone.txt': 'base' });
  // Each request of the review: the heading, the brief, the row.
  assert.ok(run.codeCalls.length > 0);
  for (const request of run.codeCalls) if (request.prompt.includes('# The change —')) {
    assert.ok(request.prompt.includes(HEADING), request.label);
    assert.equal(request.prompt.includes('from the session\'s start commit'), false, request.label);
  }
  const review = run.codeCalls.find((r) => /^code-review/.test(r.label));
  assert.ok(review.prompt.includes('not written by a recorded edit; in the change by the base the person named'));
  assert.ok(review.system.includes('the change holds every tracked file that differs from the commit the person named'));
  assert.equal(review.system.includes('the change holds only the files'), false);
  // The report's line and the file list.
  const line = codeBaseLine(pass);
  assert.equal(line, W.namedBase(repo.base, 'main', 1, 5));
  assert.ok(line.includes('where main and this branch meet, to the files as they are now. You named this base with --code-base, so it can hold work that is not this session\'s. A recorded write could have changed 1 of its 5 files.'), line);
  const story = run.written.replace(/\\(.)/g, '$1');
  assert.ok(story.includes(W.placedRow.base), story.slice(0, 400));
  // The terminal, in a dry run.
  const dry = await reviewOf(t, { root: repo.top, file, session, extra: ['--dry-run', '--code-base', 'main'] });
  assert.equal(dry.code, 0, dry.err);
  assert.ok(dry.out.includes(CODE_SNAPSHOT_WORDS.headPlaced(5, { written: 1, time: 0, base: 4 }, 4, '').slice(0, 80)), dry.out);
  assert.ok(dry.out.includes(CODE_SNAPSHOT_WORDS.namedBase(repo.base.slice(0, 12), 'main', 5, 4, 0)), dry.out);
  assert.equal(dry.calls.length, 0);
  assert.equal(dry.out.includes(`start commit ${repo.base.slice(0, 12)}`), false);
});

test('D207: every request\'s "start commit" sentence branches on the named base, and only on it', () => {
  const file = { path: 'away.py', type: 'added', state: 'readable', changed: true, recorded: false, diff: 'unrecorded_change',
    base: null, text: '', hunks: [] };
  const named = changeBlock([], { outside: 2, elsewhere: 3, named: true }).change;
  assert.ok(named.includes('- and 2 more paths differ from the commit the person named outside the working directory'));
  assert.ok(named.includes('- and 3 more paths differ from the commit the person named in the working directory'));
  assert.equal(named.includes('start commit'), false);
  const plain = changeBlock([], { outside: 2, elsewhere: 3 }).change;
  assert.ok(plain.includes('- and 2 more paths differ from the start commit outside the working directory'));
  assert.ok(plain.includes('- and 3 more paths differ from the start commit in the working directory'));
  const away = outsideBlock([file], { named: true }).text;
  assert.ok(away.startsWith('# The files outside the evaluated session — built by Sonah from the commit the person named, or another repository\'s start commit, to the files now'));
  assert.ok(away.includes('(These files differ from the commit the person named, or from another repository\'s start commit, but no recorded write'));
  const home = outsideBlock([file]).text;
  assert.ok(home.startsWith('# The files outside the evaluated session — built by Sonah from the session\'s start commit to the files now'));
  assert.ok(home.includes('(These files differ from the session\'s start commit, but no recorded write'));
  assert.ok(readsBlock([], { startCommit: true, named: true }).text.includes('unchanged since the commit the person named'));
  assert.ok(readsBlock([], { startCommit: true }).text.includes('unchanged since the start commit'));
  const verify = (where) => buildVerifyRequest({ words: { asked: [], asks: [] }, change: 'x', finding: { trace: [] }, where: { root: '/r',
    top: '/r', startFolder: { at: '/s', commit: 'abc' }, ...where } }).prompt;
  assert.ok(verify({ namedBase: true }).includes(HEADING));
  assert.ok(verify({ namedBase: true }).includes('The changed files as they were at abc, the commit the person named, each by its path'));
  assert.ok(verify({}).includes('# The change — built by Sonah from the session\'s start commit (or its recorded edits)'));
  assert.ok(verify({}).includes('The changed files as they were at the start commit abc, each by its path'));
  // Each of the review's briefs holds the words a named base replaces.
  for (const brief of [CODE_REVIEW_SYSTEM, CODE_REVIEW_SYSTEM_WHOLE_FILES, CODE_BRIEFS_ABSOLUTE.review, CODE_BRIEFS_ABSOLUTE.reviewWholeFiles])
    assert.ok(brief.includes('the change holds only the files a recorded write of the session changed and the files last\nchanged while the session ran, whose rows say they were not written by a recorded edit'));
  assert.equal(W.outsideLineNamedBase(2), '2 paths outside the working directory also differ from the base that you named, which Sonah did not review or name');
});

test('D207: a named base where nothing differs: no code review, and the reason never says to give one again', async (t) => {
  const repo = await repository(t);
  const file = await hour(t);
  const run = await reviewOf(t, { root: repo.top, file, session: sessionOf(), extra: ['--code-base', 'HEAD'] });
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(run.codeCalls, []);
  const pass = run.report.codePass;
  assert.equal(pass.base.namedRef, 'HEAD');
  assert.equal(codeNotReviewedOf(pass), 'no_file');
  assert.deepEqual(codeCoverageLines(pass), [W.noFileNamedBase]);
  assert.equal(codeBaseLine(pass), null);
  assert.equal(run.written.replace(/\\(.)/g, '$1').includes('--code-base <branch>'), false);
});

test('D207: a session with no evidence gets no code review, and its reason names --code-base; with it, the branch is reviewed', async (t) => {
  const repo = await branch(t);
  const file = await hour(t);
  const session = sessionOf('s-no-evidence');
  const before = await reviewOf(t, { root: repo.top, file, session });
  assert.equal(before.code, 0, before.err);
  assert.deepEqual(before.codeCalls, []);
  assert.equal(codeNotReviewedOf(before.report.codePass), 'no_write');
  assert.ok(before.written.replace(/\\(.)/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').includes(WHOLE_BRANCH));
  const git = { base: { kind: 'git' }, version: { pass: 'sonah.code-pass/14' } };
  for (const reason of ['no_write', 'no_seen_write', 'no_written_change'])
    assert.ok(notReviewedWordsOf(git, reason).endsWith(`${WHOLE_BRANCH}.`), reason);
  const after = await reviewOf(t, { root: repo.top, file, session, extra: ['--code-base', 'main'] });
  assert.ok(after.codeCalls.length > 0);
  assert.equal(after.report.codePass.base.namedRef, 'main');
});

test('D207: without the flag and without an unrecorded file, no byte of a request or a record moves', async (t) => {
  const repo = await repository(t, { 'w.txt': 'one\n' });
  await repo.put('w.txt', 'written\n', IN_WINDOW);
  const file = await hour(t);
  const run = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-plain', [['w.txt', 'written']], { written: 'written\n' }) });
  assert.equal(run.code, 0, run.err);
  const pass = run.report.codePass;
  assert.deepEqual(pass.files.map((f) => f.placedBy), [undefined]);
  for (const key of ['namedRef', 'timeByWindow']) assert.equal(Object.hasOwn(pass.base, key), false, key);
  assert.notEqual(pass.base.how, 'merge_base');
  const review = run.codeCalls.find((r) => /^code-review/.test(r.label));
  assert.ok(review.prompt.includes('# The change — built by Sonah from the session\'s start commit (or its recorded edits) to the files now — untrusted evidence'));
  assert.ok(review.system.includes('the change holds only the files a recorded write of the session changed and the files last\nchanged while the session ran'));
  assert.equal(review.prompt.includes('; in a commit') || review.prompt.includes('placed by time alone') || review.prompt.includes('person named'), false);
  const line = codeBaseLine(pass);
  assert.equal(line, W.ownBase(repo.base, 0, 1));
  const dry = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-plain', [['w.txt', 'written']], { written: 'written\n' }), extra: ['--dry-run'] });
  assert.ok(dry.out.includes(CODE_SNAPSHOT_WORDS.head(1, 1, '')), dry.out);
  assert.equal(dry.out.includes('--code-base'), false);
});

test('D207: a record of an earlier snapshot keeps its words', async (t) => {
  // No `placedBy`, no `namedRef`: what a record made before D207 holds.
  const repo = await branch(t);
  await repo.put('c.txt', 'dirty\n', IN_WINDOW);
  const file = await hour(t);
  const run = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-earlier', [['w.txt', 'written']], { written: 'written\n' }) });
  const earlier = JSON.parse(JSON.stringify(run.report.codePass, (key, value) => (key === 'placedBy' ? undefined : value)));
  assert.ok(codeBaseLine(earlier).endsWith('last changed while the session ran.'), codeBaseLine(earlier));
  assert.equal(codeBaseLine(earlier).includes('Sonah places'), false);
  assert.equal(codeBaseLine(earlier).includes('--code-base'), false);
  assert.equal(W.ownBase('abc', 1, 3), `The change runs from the commit where the session started (abc) to the files as they are now. No recorded write of the session changed 1 of its 3 files. That file last changed while the session ran.`);
  assert.equal(W.placeBase('/x', 'abc', 2, 1), 'In /x, the change runs from the session\'s start commit there (abc) to the files now. The change holds 2 files there. No recorded write of the session changed 1 of them. That file last changed while the session ran.');
});
