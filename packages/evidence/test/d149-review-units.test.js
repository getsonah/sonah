// D149: the review units of a change (`planReviewUnits`, `unitsOf`). Zero calls, structure only: the file is the atom,
// a file over a unit's room is split into runs of whole hunks, and files group by rank (the dossier's items, switchable;
// the directory; the parent directory; a given coupling; the table of contents' order) while a unit stays within the
// room, the same room with one unit or many. A change that fits one unit is planned as today's (`today`): the files
// today's change block shows at its cap, before the request's bound, so its request is today's, byte for byte. Every
// file today's change block shows is in a unit.
//
// Synthetic files and sessions, deterministic fake agents: no recording, no model, no network. Each rule is a test that
// fails on a mutant of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, planReviewUnits, unitsOf, changeBlock,
  CODE_CHANGE_BLOCK_MAX_BYTES, CODE_UNIT_LIMITS, CODE_UNIT_EDGES } from '../src/code-pass.js';
import { addedHunk, sectionBytes } from '../src/code-context.js';
import * as fixture from '../../cli/test/code-pass-fixture.js';
import { scenario, runScenario, digestOf, linesOf, GOLDEN_REQUESTS } from './d149-hunk-ledger-fixture.js';

const mods = { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, fixture };

/** An added file of `n` lines (one hunk), as the snapshot holds it. */
const added = (path, n, tag = path) => {
  const lines = linesOf(tag.replace(/\W/g, ''), n).split('\n').slice(0, -1);
  return { path, changed: true, recorded: true, state: 'readable', text: `${lines.join('\n')}\n`, type: 'added',
    diff: 'recorded', base: null, hunks: [addedHunk(lines)] };
};
/** A modified file with one hunk of `n` added lines at each of `starts` (line numbers now). */
const modified = (path, starts, n) => ({ path, changed: true, recorded: true, state: 'readable', text: '', type: 'modified',
  diff: 'recorded', base: null, hunks: starts.map((at, k) => ({ oldStart: at - 1, oldCount: 0, newStart: at, newCount: n,
    header: '', rows: Array.from({ length: n }, (_, i) => ({ type: '+', text: `h${k}-line ${i}`.padEnd(40, '.'), old: null,
      new: at + i })) })) });
const costOf = (f) => sectionBytes({ path: f.path, type: f.type, hunks: f.hunks });
const pathsOf = (plan) => plan.units.map((u) => u.paths);
const shuffled = (xs) => xs.map((x, i) => [((i * 7919) % 13), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
/** The room beside the table of contents of `files`: a one-unit plan of the same table of contents (one tiny hunk each). */
const roomOf = (files, maxBytes) => planReviewUnits(files.map((f) => ({ ...f, hunks: [addedHunk(['x'])] })), { maxBytes })
  .capacity;

test('D149: a change that fits one unit is today\'s: the files today\'s change block shows at its cap, and every request is today\'s', async () => {
  const { snapshot } = scenario(mods);
  const plan = planReviewUnits(snapshot);
  assert.equal(plan.today, true);
  // huge.js's one hunk is over the room alone: no request can show it, as today's change block names it.
  assert.deepEqual(pathsOf(plan), [['src/a.js', 'src/b.js', 'src/m.js']]);
  assert.deepEqual(plan.units[0].label, 'U1');
  assert.deepEqual(plan.unplaced, [{ path: 'src/huge.js', at: 0 }]);
  const block = changeBlock(snapshot);
  assert.deepEqual([...block.shown], plan.units[0].paths);
  assert.deepEqual(block.clipped, ['src/huge.js']);
  assert.equal(plan.units[0].bytes, plan.units[0].paths.reduce((n, p) => n + costOf(snapshot.find((f) => f.path === p)),
    0));
  // Golden digests: the requests of every one-unit run are byte for byte those before D149.
  for (const [options, digest] of GOLDEN_REQUESTS) {
    const seen = [];
    await runScenario(mods, { ...options, seen });
    assert.equal(digestOf(seen), digest, JSON.stringify(options));
  }
  // At a bound that leaves m.js out for room, the plan is still today's one unit, m.js in it: the unit is what the change
  // block shows at its cap, and the request's bound leaves m.js out, as today.
  const { codePass } = await runScenario(mods, { wholeFiles: false, bound: 34_056 });
  assert.deepEqual(codePass.manifest.review.files.filter((e) => e.path === 'src/m.js').map((e) => [e.state, e.reason]),
    [['left_out', 'request_bound']]);
  assert.ok(plan.units[0].paths.includes('src/m.js'));
});

test('D149: today\'s one unit exactly when today\'s change block shows every file it can, and every file it shows is in a unit, on a sweep of caps', () => {
  // The second set: every showable file over the room, one of them with exactly one run that fits (a lone unit that is
  // not today's request).
  const sets = [[added('a/x.js', 30), added('a/y.js', 55), added('b/z.js', 80), modified('c/w.js', [10, 200, 400], 25),
    added('d/v.js', 140)], [added('big/one.js', 400), modified('big/two.js', [1, 900], 120)]];
  sets[1][1].hunks[1].rows = sets[1][1].hunks[1].rows.concat(Array.from({ length: 600 }, (_, i) => ({ type: '+',
    text: `tail ${i}`.padEnd(40, '.'), old: null, new: 1020 + i })));
  let today = 0, several = 0, lone = 0;
  for (const files of sets) for (let maxBytes = 2_000; maxBytes <= 40_000; maxBytes += 250) {
    const plan = planReviewUnits(files, { maxBytes });
    const block = changeBlock(files, { maxBytes });
    const unplacedFiles = new Set(plan.unplaced.map((u) => u.path));
    const all = block.clipped.every((p) => unplacedFiles.has(p) && plan.unplaced.filter((u) => u.path === p).length
      === files.find((f) => f.path === p).hunks.length);
    assert.equal(plan.today === true, all, String(maxBytes));
    // Never less than today: every file today's change block shows is in a unit, whole.
    const inUnits = new Set(plan.units.filter((u) => !u.split).flatMap((u) => u.paths));
    for (const path of block.shown) assert.ok(inUnits.has(path), `${maxBytes} ${path}`);
    if (plan.today === true) {
      today += 1;
      assert.deepEqual([...(plan.units[0]?.paths ?? [])].sort(), [...block.shown].sort(), String(maxBytes));
    } else if (plan.units.length === 1) { lone += 1; assert.equal(plan.units[0].split, true); }
    else several += 1;
  }
  assert.ok(today > 10 && several > 10 && lone > 0, `${today} ${several} ${lone}`);
});

test('D149: the dossier edge groups the files one item names first, and switched off the directory does', () => {
  const files = [added('a/x.js', 40), added('a/z.js', 40), added('b/w.js', 40), added('b/y.js', 40)];
  const maxBytes = roomOfBytes(files, 2);
  const dossier = [{ key: 'A1', paths: ['b/y.js', 'a/x.js', 'outside/not-in-change.js'] }];
  assert.deepEqual(pathsOf(planReviewUnits(files, { maxBytes, dossier })), [['a/x.js', 'b/y.js'], ['a/z.js', 'b/w.js']]);
  assert.deepEqual(pathsOf(planReviewUnits(files, { maxBytes, dossier, dossierEdge: false })),
    [['a/x.js', 'a/z.js'], ['b/w.js', 'b/y.js']]);
  assert.deepEqual(pathsOf(planReviewUnits(files, { maxBytes })), [['a/x.js', 'a/z.js'], ['b/w.js', 'b/y.js']]);
  assert.deepEqual(CODE_UNIT_EDGES, ['dossier', 'directory', 'parent', 'coupled', 'toc']);
});

/** A cap at which any `k` of `files`' sections fit one unit of more than one, and no `k + 1` of them do. */
function roomOfBytes(files, k) {
  const costs = files.map(costOf);
  const most = Math.max(...costs), least = Math.min(...costs);
  for (let maxBytes = 1_000; maxBytes < 200_000; maxBytes += 10) {
    const plan = planReviewUnits(files, { maxBytes });
    if (plan.units.length > 1 && plan.capacity >= k * most && plan.capacity < (k + 1) * least) return maxBytes;
  }
  throw new Error('no cap');
}

test('D149: after the directory, directories with one parent; never the top of the working directory as that parent', () => {
  const files = [added('lib/a.js', 40), added('src/p/b.js', 40), added('src/q/c.js', 40), added('zz/d.js', 40)];
  const maxBytes = roomOfBytes(files, 2);
  // b and c share `src`; lib/a.js and zz/d.js share only the top, so the table of contents' order alone may join them,
  // and each neighbour there is full.
  assert.deepEqual(pathsOf(planReviewUnits(files, { maxBytes })), [['lib/a.js'], ['src/p/b.js', 'src/q/c.js'],
    ['zz/d.js']]);
  // A coupling given ranks before the table of contents' order.
  assert.deepEqual(pathsOf(planReviewUnits(files, { maxBytes, coupled: [['zz/d.js', 'lib/a.js']] })),
    [['lib/a.js', 'zz/d.js'], ['src/p/b.js', 'src/q/c.js']]);
  // Within a rank, by path: of three files of one directory with room for two, the first two by path.
  const three = [added('d/c.js', 40), added('d/a.js', 40), added('d/b.js', 40)];
  assert.deepEqual(pathsOf(planReviewUnits(three, { maxBytes: roomOfBytes(three, 2) })), [['d/a.js', 'd/b.js'],
    ['d/c.js']]);
});

test('D149: no unit is over its room; every hunk is in exactly one unit or none can show it; a file over the room is split into runs of whole hunks', () => {
  const files = [added('a.js', 20), modified('big.js', [1, 100, 200, 300, 400, 500], 30), added('c.js', 10),
    modified('odd.js', [1, 50, 90], 30)];
  // odd.js's middle hunk alone is over every room below.
  files[3].hunks[1].rows = Array.from({ length: 400 }, (_, i) => ({ type: '+', text: `long ${i}`.padEnd(40, '.'), old: null,
    new: 50 + i }));
  files[3].hunks[1].newCount = 400;
  let splits = 0;
  for (const maxBytes of [6_000, 9_000, 15_000]) {
    const plan = planReviewUnits(files, { maxBytes });
    assert.ok(plan.units.length > 1, String(maxBytes));
    for (const u of plan.units) assert.ok(u.bytes <= plan.capacity, `${maxBytes} ${u.label}`);
    // Every hunk once: in a unit (a whole file, or a run of a split one) or unplaced.
    const seen = new Map();
    const mark = (path, at) => seen.set(`${path}#${at}`, (seen.get(`${path}#${at}`) ?? 0) + 1);
    for (const u of plan.units) for (const path of u.paths) {
      const f = files.find((x) => x.path === path);
      const [from, through] = u.split ? u.hunks : [0, f.hunks.length - 1];
      for (let at = from; at <= through; at++) mark(path, at);
    }
    for (const { path, at } of plan.unplaced) mark(path, at);
    assert.deepEqual([...seen.values()].every((n) => n === 1), true);
    assert.equal(seen.size, files.reduce((n, f) => n + f.hunks.length, 0));
    // A file over the room: its own units, runs of its hunks, consecutive, in hunk order, from its first to its last.
    // One within it: one unit holds it whole.
    const big = plan.units.filter((u) => u.paths.includes('big.js'));
    if (costOf(files[1]) > plan.capacity) {
      splits += 1;
      assert.ok(big.length > 1 && big.every((u) => u.split === true && u.paths.length === 1), String(maxBytes));
      assert.equal(big[0].hunks[0], 0);
      assert.equal(big.at(-1).hunks[1], files[1].hunks.length - 1);
      for (let k = 1; k < big.length; k++) assert.equal(big[k].hunks[0], big[k - 1].hunks[1] + 1);
    } else assert.deepEqual(big.map((u) => u.split ?? false), [false], String(maxBytes));
    assert.deepEqual(plan.unplaced.filter((u) => u.path === 'odd.js'), [{ path: 'odd.js', at: 1 }]);
    // Labels in order; units in the table of contents' order of their first file, a split file's runs in hunk order.
    assert.deepEqual(plan.units.map((u) => u.label), plan.units.map((_, k) => `U${k + 1}`));
    for (const u of plan.units) assert.equal(u.bytes, u.split
      ? sectionBytes({ path: u.paths[0], type: 'modified', hunks: files.find((f) => f.path === u.paths[0]).hunks
        .slice(u.hunks[0], u.hunks[1] + 1) }) : u.paths.reduce((n, p) => n + costOf(files.find((f) => f.path === p)), 0));
  }
  assert.ok(splits >= 1);
});

test('D149: the room is today\'s change block\'s with one unit or many', () => {
  const files = [added('a/x.js', 40), added('a/z.js', 40), added('b/w.js', 40)];
  const maxBytes = roomOfBytes(files, 2);
  const plan = planReviewUnits(files, { maxBytes });
  assert.ok(plan.units.length > 1 && plan.today === undefined);
  assert.equal(plan.capacity, roomOf(files, maxBytes));
  assert.equal(planReviewUnits(files, { maxBytes: CODE_CHANGE_BLOCK_MAX_BYTES }).capacity,
    roomOf(files, CODE_CHANGE_BLOCK_MAX_BYTES));
});

test('D149: past the guard of 50 units, the units are returned apart, unlabelled', () => {
  const files = Array.from({ length: 60 }, (_, i) => added(`f${String(i).padStart(2, '0')}/x.js`, 40));
  const plan = planReviewUnits(files, { maxBytes: roomOfBytes(files, 1) });
  assert.equal(CODE_UNIT_LIMITS.units, 50);
  assert.equal(plan.units.length, 50);
  assert.equal(plan.units.at(-1).label, 'U50');
  assert.deepEqual(plan.beyondGuard.map((u) => [u.paths, u.label]), files.slice(50).map((f) => [[f.path], undefined]));
});

test('D149: the same change gives the same plan, whatever the order of its files or of the dossier\'s items', () => {
  const files = [added('a/x.js', 40), added('a/z.js', 35), added('b/w.js', 45), added('b/y.js', 40), added('c/v.js', 30),
    modified('c/u.js', [5, 300, 600], 40)];
  const maxBytes = 6_000;
  const dossier = [{ key: 'A1', paths: ['b/y.js', 'a/x.js'] }, { key: 'C1', paths: ['c/v.js', 'a/z.js', 'b/w.js'] }];
  const plan = planReviewUnits(files, { maxBytes, dossier });
  assert.ok(plan.units.length > 1);
  assert.deepEqual(planReviewUnits(files, { maxBytes, dossier }), plan);
  assert.deepEqual(planReviewUnits(shuffled(files), { maxBytes, dossier }), plan);
  assert.deepEqual(planReviewUnits(files, { maxBytes, dossier: [...dossier].reverse() }), plan);
  assert.deepEqual(unitsOf(files, { maxBytes, dossier }), plan.units);
  // Units in the table of contents' order of their first file, each unit's files in that order.
  const toc = [...files].map((f) => f.path).sort();
  const firsts = plan.units.map((u) => toc.indexOf(u.paths[0]));
  assert.deepEqual(firsts, [...firsts].sort((a, b) => a - b));
  for (const u of plan.units) assert.deepEqual(u.paths, [...u.paths].sort());
  // No file whose hunks cannot be shown, and no recorded write outside the change block, is in a unit.
  const closed = [...files, { path: 'z.bin', changed: true, recorded: true, state: 'binary', type: 'added', diff: 'withheld',
    base: null, hunks: [] }, { path: '/elsewhere/q.js', changed: true, recorded: true, state: 'other_repository' }];
  assert.ok(planReviewUnits(closed, { maxBytes, dossier }).units.every((u) => !u.paths.some((p) => ['z.bin',
    '/elsewhere/q.js'].includes(p))));
});

test('D149: a change planned as several units is sent as one request a unit, never as today\'s one (d149-unit-requests.test.js)', async () => {
  const files = { 'src/one/a.js': linesOf('aa', 4_000), 'src/one/b.js': linesOf('bb', 3_000),
    'src/two/c.js': linesOf('cc', 3_500), 'docs/d.md': linesOf('dd', 200) };
  const { snapshot } = scenario(mods, { files });
  assert.deepEqual(pathsOf(planReviewUnits(snapshot)), [['docs/d.md', 'src/one/a.js'], ['src/one/b.js', 'src/two/c.js']]);
  // Today's one request (its digest computed with the code before D149, a03192ac) is no longer sent.
  for (const [options, before] of [
    [{ wholeFiles: false }, 'ad0c602c90b4dad55a141ac37453ee4e95ddf0ef2917c0445a98ff5e67d0178c'],
    [{ wholeFiles: true }, 'f7d8886f763b42cfcf6a8b9f6838c639efdf10dfdcd0b8ddcb7df0b9454ebdae']]) {
    const seen = [];
    await runScenario(mods, { ...options, files, seen });
    assert.notEqual(digestOf(seen), before, JSON.stringify(options));
    assert.deepEqual(seen.map((r) => r.label).filter((l) => l.startsWith('code-review:')),
      ['code-review:review:U1:R1', 'code-review:review:U2:R1']);
  }
});
