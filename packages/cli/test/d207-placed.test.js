// D207: a path that differs from the base and that no recorded write could have changed is placed by evidence: a commit
// the session made; or its last change in the window, outside a wait, and not committed when the recording ended; else it
// is outside, whatever its time. A pull the agent ran re-times files, so a time alone never says a file is the session's.
// When git or a recording cannot say, D113's window and D206's waits decide, marked `time`. Every place agrees.
//
// Synthetic recordings and throwaway repositories: no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { NAMED_BASE_EVIDENCE, placedByOf, readCodeSnapshot, runGit } from '../src/code-snapshot.js';
import { CODE_SNAPSHOT_WORDS, codeSnapshotLine } from '../src/session-review-command.js';
import { changeBlock, codeChangeTally, CODE_INDEX_MAX_BYTES, CODE_UNIT_LIMITS, freezeCodeSnapshot, outsideBlock,
  planReviewUnits } from '../../evidence/src/code-pass.js';
import { CODE_REPORT_WORDS, codeBaseLine } from '../../evidence/src/code-report.js';
import { buildCodeSession, CODE_TEXT } from './code-pass-fixture.js';
import { at, claude, codex, ms, recording, repository, reviewOf, ROLLOUT, sessionOf } from './d207-fixture.js';

const session = () => buildCodeSession('s', CODE_TEXT, [{ id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
  { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', turn: 'T1' }]);
const IN_WINDOW = ms('10:30:00');
/** A session of one hour on Claude Code's rows: `commands`, each `[when, command]`. */
const hour = (t, commands = []) => recording(t, [claude.human(at('10:00:00')),
  ...commands.map(([when, command], n) => claude.action(when, command, `c${n}`)), claude.action(at('10:59:00'), 'true', 'last'),
  claude.result(at('11:00:00'), '', 'last')]);
const snapshotOf = (root, file, extra = {}) => readCodeSnapshot(session(), { root, maxBytes: 1_620_000, recording: file,
  activity: [{ file }], ...extra });
/** Each file of the change's way in, by path; and the paths outside it. */
const placesOf = (snap, top = '') => Object.fromEntries(snap.plan.map((e) => [e.path.replace(top, ''), e.recorded ? 'write' : e.placedBy]));

test('D207: placedByOf, its table', () => {
  const window = { start: ms('10:00:00'), end: ms('11:00:00'), waits: [{ start: ms('10:40:00'), end: ms('10:50:00') }] };
  const evidence = { authored: new Set(['mine.txt']), atEnd: new Set(['dirty.txt']) };
  const placed = (gitPath, mtimeMs, more = {}, ev = evidence, win = window) => placedByOf({ gitPath, mtimeMs, ...more }, ev, win);
  assert.equal(placed('mine.txt', ms('09:00:00')), 'commit'); // whatever its time
  assert.equal(placed('mine.txt', null), 'commit'); // a file not there now
  assert.equal(placed('dirty.txt', IN_WINDOW), 'time');
  assert.equal(placed('new.txt', IN_WINDOW, { untracked: true }), 'time');
  assert.equal(placed('other.txt', IN_WINDOW), null); // committed by the end, by other hands
  assert.equal(placed('dirty.txt', ms('10:45:00')), null); // in a wait
  assert.equal(placed('new.txt', ms('10:45:00'), { untracked: true }), null);
  assert.equal(placed('dirty.txt', ms('09:00:00')), null); // before the window
  assert.equal(placed('dirty.txt', ms('12:00:00')), null); // after it
  // No evidence: the window and the waits, marked time.
  assert.equal(placed('other.txt', IN_WINDOW, {}, null), 'time');
  assert.equal(placed('other.txt', ms('10:45:00'), {}, null), null);
  assert.equal(placed('other.txt', IN_WINDOW, {}, null, null), null);
  // A base the person named: a tracked path, whatever its time; an untracked file keeps the window and the waits.
  assert.equal(placed('other.txt', ms('09:00:00'), {}, NAMED_BASE_EVIDENCE), 'base');
  assert.equal(placed('other.txt', null, {}, NAMED_BASE_EVIDENCE, null), 'base');
  assert.equal(placed('new.txt', IN_WINDOW, { untracked: true }, NAMED_BASE_EVIDENCE), 'time');
  assert.equal(placed('new.txt', ms('10:45:00'), { untracked: true }, NAMED_BASE_EVIDENCE), null);
});

test('D207: a pull the agent ran mid-session is outside, though it re-timed the files', async (t) => {
  const repo = await repository(t);
  const upstream = repo.git(['rev-parse', 'HEAD']).trim();
  repo.git(['checkout', '-q', '-b', 'side']);
  await repo.put('b.txt', 'pulled\n');
  repo.git(['commit', '-qam', 'Work of other hands'], '2030-01-01T09:00:00Z');
  repo.git(['checkout', '-q', 'main']);
  assert.equal(repo.git(['rev-parse', 'HEAD']).trim(), upstream);
  repo.git(['merge', '-q', '--ff-only', 'side'], '2030-01-01T10:20:00Z');
  await repo.put('b.txt', 'pulled\n', IN_WINDOW);
  const file = await hour(t, [[at('10:20:00'), 'git pull -q']]);
  const snap = await snapshotOf(repo.top, file);
  assert.deepEqual(placesOf(snap), {});
  assert.deepEqual(snap.base.changedOutside, ['b.txt']);
  assert.deepEqual(snap.outsideFiles.filter((f) => f.diff !== undefined).map((f) => f.path), ['b.txt']);
});

test('D207: a commit of other hands in the window, on a command-written file: outside', async (t) => {
  const repo = await repository(t);
  await repo.put('b.txt', 'theirs\n', IN_WINDOW);
  repo.git(['commit', '-qam', 'A person commits while the agent works'], '2030-01-01T10:31:00Z');
  const snap = await snapshotOf(repo.top, await hour(t));
  assert.deepEqual(placesOf(snap), {});
  assert.deepEqual(snap.base.changedOutside, ['b.txt']);
});

test('D207: a commit the session made is `commit`, though its file\'s time left the window or the file is gone', async (t) => {
  const repo = await repository(t, { 'a.txt': 'one\n', 'b.txt': 'one\n', 'c.txt': 'one\n' });
  await repo.put('b.txt', 'two\n', ms('08:00:00', 3));
  repo.git(['rm', '-q', 'c.txt']);
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '-m', 'Make the parser strict'], '2030-01-01T10:31:00Z');
  await repo.put('b.txt', 'two\n', ms('08:00:00', 3));
  const snap = await snapshotOf(repo.top, await hour(t, [[at('10:30:00'), 'git commit -qm "Make the parser strict"']]));
  assert.deepEqual(placesOf(snap), { 'b.txt': 'commit', 'c.txt': 'commit' });
  assert.deepEqual(snap.base.changedOutside, []);
});

test('D207: from a working folder below the top folder, a commit\'s paths and git\'s list agree', async (t) => {
  const repo = await repository(t, { 'app/a.txt': 'one\n', 'app/b.txt': 'one\n', 'app/c.txt': 'one\n', 'other/d.txt': 'one\n' });
  await repo.put('app/a.txt', 'mine\n');
  await repo.put('other/d.txt', 'mine\n');
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '-m', 'Make the parser strict'], '2030-01-01T10:20:00Z');
  await repo.put('app/b.txt', 'theirs\n', IN_WINDOW);
  repo.git(['commit', '-qam', 'A commit of other hands'], '2030-01-01T10:31:00Z');
  await repo.put('app/c.txt', 'dirty\n', IN_WINDOW);
  const snap = await snapshotOf(join(repo.top, 'app'), await hour(t, [[at('10:19:00'), 'git commit -qm "Make the parser strict"']]));
  assert.deepEqual(placesOf(snap), { 'a.txt': 'commit', 'c.txt': 'time' });
  assert.deepEqual(snap.base.changedOutside, ['b.txt']);
});

test('D207: a commit made just after the recording ended (a proof commit): its command-written files stay, by time', async (t) => {
  const repo = await repository(t);
  await repo.put('b.txt', 'made by a command\n', IN_WINDOW);
  repo.git(['commit', '-qam', 'agent work'], '2030-01-01T11:00:04Z');
  await repo.put('b.txt', 'made by a command\n', IN_WINDOW);
  const snap = await snapshotOf(repo.top, await hour(t));
  assert.deepEqual(placesOf(snap), { 'b.txt': 'time' });
});

test('D207: an uncommitted file over a commit of other hands, last changed in the window: `time`', async (t) => {
  const repo = await repository(t);
  await repo.put('b.txt', 'theirs\n');
  repo.git(['commit', '-qam', 'A commit of other hands'], '2030-01-01T10:10:00Z');
  await repo.put('b.txt', 'mine, uncommitted\n', IN_WINDOW);
  await repo.put('new.txt', 'made by a command\n', IN_WINDOW);
  const snap = await snapshotOf(repo.top, await hour(t));
  assert.deepEqual(placesOf(snap), { 'b.txt': 'time', 'new.txt': 'time' });
});

test('D207: a dirty or untracked file last changed in a wait is outside', async (t) => {
  const repo = await repository(t);
  const inWait = ms('22:00:00');
  await repo.put('b.txt', 'two\n', inWait);
  await repo.put('new.txt', 'two\n', inWait);
  const file = await recording(t, [codex.meta(at('10:00:00')), codex.human(at('10:00:01')), codex.shell(at('10:00:05'), 'make', 's1'),
    codex.output(at('10:00:06'), 's1'), codex.ended(at('10:00:07')), codex.human(at('10:00:00', 2)),
    codex.shell(at('10:00:05', 2), 'make', 's2'), codex.output(at('10:00:06', 2), 's2'), codex.ended(at('10:00:07', 2))], ROLLOUT);
  const snap = await snapshotOf(repo.top, file);
  assert.deepEqual(placesOf(snap), {});
  assert.deepEqual(snap.base.changedOutside, ['b.txt', 'new.txt']);
});

test('D207: an untracked file older than the session is no part of the change, whatever else moves', async (t) => {
  const repo = await repository(t);
  await repo.put('old.txt', 'left here before\n', ms('08:00:00'));
  const snap = await snapshotOf(repo.top, await hour(t));
  assert.deepEqual(placesOf(snap), {});
  assert.equal(snap.plan.some((e) => e.path === 'old.txt'), false);
  assert.equal(placedByOf({ gitPath: 'old.txt', mtimeMs: ms('08:00:00'), untracked: true },
    { authored: new Set(), atEnd: new Set() }, { start: ms('10:00:00'), end: ms('11:00:00'), waits: [] }), null);
});

test('D207: when git or a recording cannot say, D113\'s window and D206\'s waits decide, marked `time`', async (t) => {
  const repo = await repository(t);
  await repo.put('b.txt', 'theirs\n', IN_WINDOW);
  repo.git(['commit', '-qam', 'A commit of other hands'], '2030-01-01T10:31:00Z');
  await repo.put('b.txt', 'theirs\n', IN_WINDOW);
  const file = await hour(t);
  assert.deepEqual(placesOf(await snapshotOf(repo.top, file)), {});
  // Git fails the one call that lists the commits.
  const failingLog = (args, options) => (args[0] === 'log' && args[1] === '-z' ? { ok: false, stdout: null } : runGit(args, options));
  assert.deepEqual(placesOf(await snapshotOf(repo.top, file, { git: failingLog })), { 'b.txt': 'time' });
  // Git fails the one call that lists what differs from the commit at the end: a diff naming no path, and the end commit's hash.
  let diffs = 0;
  const failingEnd = (args, options) => (args[0] === 'diff' && args[1] === '--name-only' && args.length === 5 && ++diffs
    ? { ok: false, stdout: null } : runGit(args, options));
  assert.deepEqual(placesOf(await snapshotOf(repo.top, file, { git: failingEnd })), { 'b.txt': 'time' });
  assert.ok(diffs > 0);
  // A recording that cannot be read.
  assert.deepEqual(placesOf(await snapshotOf(repo.top, file, { activity: [{ file }, { file: join(repo.top, 'gone.jsonl') }] })),
    { 'b.txt': 'time' });
  // No activity at all.
  assert.deepEqual(placesOf(await snapshotOf(repo.top, file, { activity: [] })), { 'b.txt': 'time' });
  // A recording with no timestamps says no window: outside, as D113's.
  const timeless = await recording(t, [claude.action(null, 'true', 'c1')]);
  assert.deepEqual(placesOf(await snapshotOf(repo.top, timeless)), {});
});

test('D207: a place given with --code-repo places a path as the working folder does', async (t) => {
  const fill = async () => {
    const repo = await repository(t, { 'a.txt': 'one\n', 'b.txt': 'one\n', 'c.txt': 'one\n', 'd.txt': 'one\n' });
    await repo.put('a.txt', 'mine\n');
    repo.git(['commit', '-qam', 'Make the parser strict'], '2030-01-01T10:20:00Z');
    await repo.put('b.txt', 'theirs\n', IN_WINDOW);
    repo.git(['commit', '-qam', 'A commit of other hands'], '2030-01-01T10:31:00Z');
    await repo.put('c.txt', 'dirty\n', IN_WINDOW);
    await repo.put('new.txt', 'made\n', IN_WINDOW);
    await repo.put('old.txt', 'made\n', ms('08:00:00'));
    await repo.put('d.txt', 'dirty, after the end\n', ms('12:00:00'));
    await repo.put('a.txt', 'mine\n', ms('12:00:00'));
    return repo;
  };
  const [here, there] = [await fill(), await fill()];
  const file = await hour(t, [[at('10:19:00'), 'git commit -qm "Make the parser strict"']]);
  const own = await snapshotOf(here.top, file);
  const expected = { 'a.txt': 'commit', 'c.txt': 'time', 'new.txt': 'time' };
  assert.deepEqual(placesOf(own), expected);
  const empty = await repository(t);
  const given = await snapshotOf(empty.top, file, { codeRepos: [there.top] });
  assert.deepEqual(placesOf(given, `${there.top}/`), expected);
  assert.deepEqual(given.base.places[0].changedOutside.map((p) => p.replace(`${there.top}/`, '')), ['b.txt', 'd.txt']);
  assert.deepEqual(own.base.changedOutside, ['b.txt', 'd.txt']);
});

// ---- what carries `placedBy`, and what it moves ---------------------------------------------------------------------

const hunkOf = (n, tag) => ({ oldStart: 0, oldCount: 0, newStart: 1, newCount: n, header: '',
  rows: Array.from({ length: n }, (_, i) => ({ type: '+', text: `${tag} ${i}`.padEnd(40, '.'), old: null, new: i + 1 })) });
const fileOf = (path, placedBy = null, n = 22) => ({ path, type: 'added', state: 'readable', changed: true, base: null,
  text: '', hunks: [hunkOf(n, path)], recorded: placedBy === 'write', diff: placedBy === 'write' ? 'recorded' : 'unrecorded_change',
  ...(placedBy && placedBy !== 'write' ? { placedBy } : {}) });
const NOTE = 'not written by a recorded edit';

test('D207: past the guard, units hold a write first, then a commit\'s or the base\'s file, and those by time alone last', () => {
  const each = (by, dir, count) => Array.from({ length: count }, (_, i) => fileOf(`${dir}/d${String(i).padStart(3, '0')}/f.py`, by, 5_000));
  const time = each('time', 'aaa', CODE_UNIT_LIMITS.units);
  const plan = planReviewUnits([...time, ...each('commit', 'mmm', 3), ...each('base', 'nnn', 3), ...each('write', 'zzz', 2)]);
  const first = (unit) => unit.paths[0].slice(0, 3);
  assert.equal(plan.units.length, CODE_UNIT_LIMITS.units);
  assert.deepEqual(plan.units.slice(0, 8).map(first), ['zzz', 'zzz', 'mmm', 'mmm', 'mmm', 'nnn', 'nnn', 'nnn']);
  assert.ok(plan.beyondGuard.length > 0 && plan.beyondGuard.every((u) => first(u) === 'aaa'));
  // A unit that holds a file of each class goes by the best of them; within the guard, nothing moves.
  const within = planReviewUnits([fileOf('aaa.py', 'time', 5_000), fileOf('mmm.py', 'commit', 5_000), fileOf('zzz.py', 'write', 5_000)]);
  assert.deepEqual(within.units.map((u) => u.paths[0]), ['aaa.py', 'mmm.py', 'zzz.py']);
});

test('D207: over the bound, the rows placed by time alone fold first, so a commit\'s rows keep their own', () => {
  const rows = (by, dir, count) => Array.from({ length: count }, (_, i) => fileOf(`${dir}/${String(i).padStart(5, '0')}.py`, by, 1));
  const commit = rows('commit', 'made', 40);
  const toc = (block) => block.change.slice(0, block.change.indexOf('\n---\n'));
  const block = changeBlock([...commit, ...rows('time', 'timed', 2_000)]);
  assert.ok(Buffer.byteLength(toc(block)) <= CODE_INDEX_MAX_BYTES);
  assert.ok(toc(block).includes('2000 files not listed one by one'));
  for (const f of commit) assert.ok(toc(block).includes(`- ${f.path} `), f.path);
  assert.equal(toc(block).includes('timed/00000.py'), false);
  // Under the same bound, the commit's rows alone keep every row.
  const small = changeBlock(commit);
  assert.equal(small.change.includes('not listed one by one'), false);
  // A time row a dossier item names keeps its own row while another class still fits.
  const noted = changeBlock([...commit, ...rows('time', 'timed', 2_000)], { notes: new Map([['timed/00000.py', ['S1']]]) });
  assert.ok(toc(noted).includes('- timed/00000.py '));
});

test('D207: each row says how its file is part of the change, and a file read apart keeps its words', () => {
  const noteOf = (file) => changeBlock([file]).change.split('\n')[1];
  assert.ok(noteOf(fileOf('a.py', 'commit')).endsWith(`· ${NOTE}; in a commit the session made`));
  assert.ok(noteOf(fileOf('a.py', 'time')).endsWith(`· ${NOTE}; placed by time alone: it may not be the session's`));
  assert.ok(noteOf(fileOf('a.py', 'base')).endsWith(`· ${NOTE}; in the change by the base the person named`));
  assert.ok(noteOf(fileOf('a.py')).endsWith(`· ${NOTE}`));
  assert.equal(noteOf(fileOf('a.py', 'write')).includes(NOTE), false);
  const away = outsideBlock([fileOf('a.py')]).text;
  assert.ok(away.includes(`· ${NOTE}\n`) && away.includes('no commit the session made changed them itself'));
  assert.ok(away.includes('none was left uncommitted by a change while the agent was working'));
  assert.equal(away.includes('last changed while'), false);
});

test('D207: freezeCodeSnapshot, the manifest, the record and the tally carry `placedBy`; a recorded write carries none', async (t) => {
  assert.deepEqual(freezeCodeSnapshot([{ path: 'a', recorded: false, placedBy: 'time' }, { path: 'b', recorded: false, placedBy: 'other' },
    { path: 'c', recorded: true }], []).map((f) => f.placedBy), ['time', undefined, undefined]);
  const repo = await repository(t, { 'a.txt': 'one\n', 'b.txt': 'one\n', 'c.txt': 'one\n' });
  await repo.put('a.txt', 'mine\n');
  repo.git(['commit', '-qam', 'Make the parser strict'], '2030-01-01T10:20:00Z');
  await repo.put('a.txt', 'mine\n', ms('12:00:00'));
  await repo.put('b.txt', 'dirty\n', IN_WINDOW);
  await repo.put('w.txt', 'written\n', IN_WINDOW);
  const file = await hour(t, [[at('10:19:00'), 'git commit -qm "Make the parser strict"']]);
  const run = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-carry', [['w.txt', 'written']], { written: 'written\n' }) });
  assert.equal(run.code, 0, run.err);
  const pass = run.report.codePass;
  const placed = (rows) => Object.fromEntries(rows.map((f) => [f.path, f.placedBy ?? null]));
  const expected = { 'a.txt': 'commit', 'b.txt': 'time', 'w.txt': null };
  assert.deepEqual(placed(pass.files), expected);
  assert.deepEqual(placed(pass.manifest.review.files), expected);
  assert.deepEqual(placed(codeChangeTally(pass).units), expected);
  // Each reader says it: the head, the base line, the row of the request, the file list.
  const dry = await reviewOf(t, { root: repo.top, file, session: sessionOf('s-carry', [['w.txt', 'written']], { written: 'written\n' }),
    extra: ['--dry-run'] });
  assert.ok(dry.out.includes('the change holds 3 paths. 1 is by a recorded write, 1 is in a commit the session made, and 1 is by time alone.'), dry.out);
  const line = codeBaseLine(pass);
  assert.ok(line.endsWith(`No recorded write of the session changed 2 of its 3 files. 1 is in a commit the session made. Sonah places 1 by time alone: changed during the recording and not committed when the agent stopped. It may not be the session's.`), line);
  // A record made before D207 holds no `placedBy`, and keeps its words.
  const earlier = JSON.parse(JSON.stringify(pass, (key, value) => (key === 'placedBy' ? undefined : value)));
  assert.ok(codeBaseLine(earlier).endsWith('of its 3 files. Each of them last changed while the session ran.'), codeBaseLine(earlier));
  const review = run.codeCalls.find((r) => r.label === 'code-review' || /^code-review/.test(r.label));
  assert.ok(review.prompt.includes(`${NOTE}; in a commit the session made`) && review.prompt.includes(`${NOTE}; placed by time alone`));
  for (const words of [CODE_REPORT_WORDS.placedRow.commit, CODE_REPORT_WORDS.placedRow.time])
    assert.ok(run.written.replace(/\\(.)/g, '$1').includes(words), words);
});

test('D207: when git or a recording cannot say, the readers say only what the window placed', async (t) => {
  const repo = await repository(t);
  await repo.put('b.txt', 'dirty\n', IN_WINDOW);
  const file = await hour(t);
  const failingLog = (args, options) => (args[0] === 'log' && args[1] === '-z' ? { ok: false, stdout: null } : runGit(args, options));
  const snap = await snapshotOf(repo.top, file, { git: failingLog });
  assert.equal(snap.base.timeByWindow, true);
  assert.equal((await snapshotOf(repo.top, file)).base.timeByWindow, undefined);
  const words = CODE_REPORT_WORDS.ownBase('abc', 1, 1, false, { time: 1, windowOnly: true });
  assert.ok(words.endsWith('Sonah places 1 by time alone: changed during the recording. It may not be the session\'s.'), words);
});

test('D207: the head keeps its words with no file a recorded write did not change', () => {
  const line = (files) => codeSnapshotLine({ root: true, dir: '/r', realRoot: '/r', top: '/r', repository: true, files,
    base: { kind: 'git', commit: '0123456789abcdef', how: 'reflog', outside: 0, changedOutside: [], written: 1 } });
  const written = { path: 'a', recorded: true, diff: 'recorded', text: 'x', state: 'readable' };
  assert.ok(line([written]).startsWith(CODE_SNAPSHOT_WORDS.head(1, 1, '')));
  const timed = { path: 'b', recorded: false, placedBy: 'time', diff: 'unrecorded_change', text: 'x', state: 'readable' };
  assert.ok(line([written, timed]).startsWith(CODE_SNAPSHOT_WORDS.headPlaced(2, { written: 1, commit: 0, time: 1 }, 2, '')));
  assert.ok(line([written, timed]).includes('the start commit 0123456789ab of the session (reflog)'));
});
