// D207's second reviews, what a reader sees: each sentence true of the rule as it now stands. 1. A file placed by time alone
// was "not committed when it ended" (the recording): the end test reads the agent's stop. 2. The way to a branch's changes
// was offered with --code-repo, which the command does not take with --code-base, and not offered where a git repository
// holds the folder but no start commit was found there (a recording with no times). 3. "No commit of the session holds
// them" was false of a file a merge the session made brought in: a merge counts only for what it changed itself.
//
// Throwaway repositories, synthetic recordings, a fake reviewer: no model, no network. Every date a rule reads is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readCodeSnapshot } from '../src/code-snapshot.js';
import { BRANCH_WORDS, CODE_REPORT_WORDS as W, branchWayOutOf, codeBaseLine, codeNotReviewedOf, notReviewedWordsOf }
  from '../../evidence/src/code-report.js';
import { at, claude, ms, recording, repository, reviewOf, sessionOf } from './d207-fixture.js';

const IN_WINDOW = ms('10:30:00');
const hour = (t, commands = []) => recording(t, [claude.human(at('10:00:00')),
  ...commands.map(([when, command], n) => claude.action(when, command, `c${n}`)), claude.action(at('10:59:00'), 'true', 'last'),
  claude.result(at('11:00:00'), '', 'last')]);
const unescaped = (md) => md.replace(/\\(.)/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const placesOf = (snap) => Object.fromEntries(snap.plan.map((e) => [e.path, e.recorded ? 'write' : e.placedBy]));

test('D207\'s second review: a file placed by time alone was not committed when the agent stopped, and the line says so',
  async (t) => {
    const repo = await repository(t, { 'a.txt': 'one\n', 'b.txt': 'one\n', 'w.txt': 'one\n' });
    await repo.put('b.txt', 'made by the session\'s command\n', IN_WINDOW);
    const file = await hour(t, [[at('10:29:00'), 'make']]);
    const run = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-time', [['w.txt', 'written']],
      { written: 'written\n' }) });
    assert.equal(run.code, 0, run.err);
    const line = codeBaseLine(run.report.codePass);
    assert.ok(line.endsWith('Sonah places 1 by time alone: changed during the recording and not committed when the agent '
      + 'stopped. It may not be the session\'s.'), line);
    assert.equal(line.includes('when it ended'), false, line);
    for (const doc of ['docs/INSTALL.md', 'docs/PRIVACY.md', 'docs/TROUBLESHOOTING.md']) {
      const text = (await readFile(new URL(`../../../${doc}`, import.meta.url), 'utf8')).replace(/\s+/g, ' ');
      assert.equal(/not committed when (?:the recording|it) ended/.test(text), false, doc);
    }
  });

test('D207\'s second review: with --code-repo the way to a branch is not offered, as the command does not take both', async (t) => {
  const repo = await repository(t, { 'a.txt': 'one\n', 'w.txt': 'one\n' });
  await repo.put('a.txt', 'already changed\n', ms('09:00:00'));
  const file = await hour(t);
  const session = sessionOf('s-repo', [['w.txt', 'written']], { written: 'written\n' });
  const run = await reviewOf(t, { root: repo.top, file, session, extra: ['--code-repo', repo.top] });
  assert.equal(run.code, 0, run.err);
  assert.equal(run.report.codePass.base.given, true);
  assert.deepEqual(run.report.codePass.base.changedOutside, ['a.txt']);
  assert.equal(branchWayOutOf(run.report.codePass), false);
  assert.equal(unescaped(run.written).includes('--code-base'), false, run.written);
  const dry = await reviewOf(t, { root: repo.top, file, session, extra: ['--dry-run', '--code-repo', repo.top] });
  assert.equal(dry.out.includes('--code-base'), false, dry.out);
  // Without --code-repo, the same review names it.
  const plain = await reviewOf(t, { root: repo.top, file, session });
  assert.ok(unescaped(plain.written).includes(BRANCH_WORDS), plain.written);
  // A session with no write: the first screen's reason does not name it with --code-repo either.
  const none = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-none'), extra: ['--code-repo', repo.top] });
  assert.equal(codeNotReviewedOf(none.report.codePass), 'no_write');
  assert.equal(notReviewedWordsOf(none.report.codePass, 'no_write').includes('--code-base'), false);
});

test('D207\'s second review: a git repository with no start commit found still names --code-base, where it works', async (t) => {
  const repo = await repository(t);
  // Rows with no time, as Cursor writes them: no start commit, so the change is the recorded edits.
  const file = await recording(t, [claude.human(null), claude.action(null, 'true', 'c1'), claude.result(null, '', 'c1')]);
  const snap = await readCodeSnapshot(sessionOf(), { root: repo.top, maxBytes: 1_620_000, recording: file,
    activity: [{ file }] });
  assert.deepEqual([snap.base.kind, snap.base.repository], ['recorded_edits', true]);
  const run = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-timeless') });
  assert.equal(run.code, 0, run.err);
  assert.equal(codeNotReviewedOf(run.report.codePass), 'no_write');
  assert.equal(run.report.codePass.base.repository, true);
  assert.equal(notReviewedWordsOf(run.report.codePass, 'no_write'),
    `No code was reviewed. Reason: ${W.notReviewedReasons.no_write}. ${BRANCH_WORDS}`);
  const dry = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-timeless'), extra: ['--dry-run'] });
  assert.ok(dry.out.includes(BRANCH_WORDS), dry.out);
  // And the way it names works there: every tracked file that differs is part of the change.
  await repo.put('a.txt', 'changed on the branch\n');
  const named = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-timeless'), extra: ['--dry-run', '--code-base', 'HEAD'] });
  assert.equal(named.code, 0, named.err);
  assert.ok(named.out.includes('by the base you named'), named.out);
});

test('D207\'s second review: a file a merge the session made brought in is outside, and the words say what Sonah found',
  async (t) => {
    const repo = await repository(t, { 'a.txt': 'one\n', 'w.txt': 'one\n' });
    repo.git(['checkout', '-q', '-b', 'side']);
    await repo.put('m.txt', 'theirs\n');
    repo.git(['add', 'm.txt']);
    repo.git(['commit', '-qm', 'Add m on side'], '2030-01-01T09:00:00Z');
    repo.git(['checkout', '-q', 'main']);
    repo.git(['merge', '-q', '--no-ff', 'side', '-m', 'Merge side into main'], '2030-01-01T10:21:00Z');
    const file = await hour(t, [[at('10:20:00'), 'git merge --no-ff side -m "Merge side into main"']]);
    const snap = await readCodeSnapshot(sessionOf('s-merge', [['w.txt', 'written']], { written: 'written\n' }),
      { root: repo.top, maxBytes: 1_620_000, recording: file, activity: [{ file }] });
    assert.deepEqual(snap.base.changedOutside, ['m.txt']);
    assert.equal(placesOf(snap)['m.txt'], undefined);
    // The merge is the session's and its tree holds m.txt, but it did not change m.txt itself.
    assert.ok(W.outsideWhy.commit(1).includes('Sonah found no commit of the session that changed it itself.'));
    assert.equal(/holds (?:it|them)\b/.test(W.outsideWhy.commit(2)), false);
  });

test('D207\'s second review: the docs say what a merge counts for, how an earlier report placed a file, and that a check '
  + 'short of a verdict can come with a short item-by-item check', async () => {
  const flat = (text) => text.replace(/\s+/g, ' ');
  const doc = async (path) => flat(await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8'));
  const [install, privacy, trouble] = await Promise.all(['docs/INSTALL.md', 'docs/PRIVACY.md', 'docs/TROUBLESHOOTING.md']
    .map(doc));
  // A merge the session made counts only for what it changed itself, so no doc says such a commit "holds" a file it places.
  assert.equal(install.includes('when a commit the session made holds the file'), false);
  assert.ok(install.includes('a merge only for the files it changed itself, not for those it brought in'));
  assert.ok(privacy.includes('that a commit the session made changed (a merge only for the files it changed itself)'));
  const merge = 'no commit the session made changed them itself (a merge counts only for the files the merge itself '
    + 'changed, not for those it brought in)';
  assert.equal(trouble.split(merge).length - 1, 2);
  // An earlier report's outside lines are explained by its own rule (a file's time alone), never by this one.
  const earlier = 'A report from before these words placed such a file by its time alone: one that no recorded write '
    + 'changed and that last changed outside the session\'s recorded time was outside, even when a commit the session made '
    + 'holds it, and one that last changed inside it was part of the change, whoever committed it.';
  assert.equal(trouble.split(earlier).length - 1, 2);
  assert.ok(trouble.includes('The same files (in a report from before these words, by its rule in the row above)'));
  // "Covered the whole change, but some of its checks gave no result": the item-by-item check may be short too.
  assert.equal(trouble.includes('only the check of a finding or of its questions gave no verdict'), false);
  assert.ok(trouble.includes('and the check of a finding or of its questions gave no verdict (its item-by-item check may '
    + 'have fallen short too)'));
});
