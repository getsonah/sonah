// D206: a long list of paths never takes the room of the hunks. A customer's multi-day Codex recording in a monorepo gave
// the code step thousands of paths: the table of contents alone took the change block's whole 400,000 bytes, so even a
// 22-line script was "too large on its own" and the review agent's request showed no hunk. The table of contents now has
// its own bound (`CODE_INDEX_MAX_BYTES`): past it, the rows least needed are said by folder. And past the guard of 50
// units, the units that hold a file a recorded write changed come first, so a file the session wrote is never closed
// `unit_cap` while one it did not write is reviewed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { changeBlock, planReviewUnits, unitChangeBlock, CODE_CHANGE_BLOCK_MAX_BYTES, CODE_INDEX_MAX_BYTES,
  CODE_UNIT_LIMITS, CODE_PASS_PROFILE } from '../src/code-pass.js';
import { FOLDED_ROW_WORDS } from '../src/code-context.js';

const hunkOf = (n, tag = 'line') => ({ oldStart: 0, oldCount: 0, newStart: 1, newCount: n, header: '',
  rows: Array.from({ length: n }, (_, i) => ({ type: '+', text: `${tag} ${i}`.padEnd(40, '.'), old: null, new: i + 1 })) });
const script = (path, n = 22, more = {}) => ({ path, type: 'added', state: 'readable', diff: 'recorded', changed: true,
  recorded: true, base: null, text: '', hunks: [hunkOf(n, path)], ...more });
const artifact = (i, more = {}) => ({ path: `apps/video/out/run-${String(i).padStart(5, '0')}/frame.mp4`, type: 'added',
  state: 'binary', diff: 'withheld', changed: true, recorded: false, base: null, hunks: [], ...more });
const unrecorded = (path, n = 22) => ({ ...script(path, n), diff: 'unrecorded_change', recorded: false });
const tocOfBlock = (change) => change.slice(0, change.indexOf('\n---\n'));

test('D206: the customer\'s shape — a 22-line script beside thousands of artifacts is shown, never "too large on its own"', () => {
  for (const n of [2_500, 8_000, 40_000]) {
    const files = [script('tools/render.py'), ...Array.from({ length: n }, (_, i) => artifact(i))];
    const plan = planReviewUnits(files);
    assert.deepEqual([plan.today, plan.units.flatMap((u) => u.paths), plan.unplaced], [true, ['tools/render.py'], []], String(n));
    const block = changeBlock(files);
    assert.ok(block.shown.has('tools/render.py'), String(n));
    assert.deepEqual([block.alone, block.clipped], [[], []], String(n));
    assert.ok(block.change.includes('diff --git a/tools/render.py b/tools/render.py'));
    assert.ok(Buffer.byteLength(tocOfBlock(block.change)) <= CODE_INDEX_MAX_BYTES, String(n));
    assert.ok(Buffer.byteLength(block.change) <= CODE_CHANGE_BLOCK_MAX_BYTES, String(n));
    // Every path is still counted; the script keeps its own row, and the artifacts are said by folder.
    assert.ok(block.change.startsWith(`## Files (${n + 1})\n`));
    assert.match(block.change, /^- tools\/render\.py → lines \d+-\d+ · added$/m);
    assert.ok(block.change.includes(`${n} files not listed one by one, none written by a recorded edit`));
    assert.equal(block.change.includes('frame.mp4'), false);
  }
});

test('D206: the line range a row names still points at its file\'s section when rows are folded', () => {
  const files = [script('tools/render.py'), ...Array.from({ length: 3_000 }, (_, i) => artifact(i))];
  const { change } = changeBlock(files);
  const [, from, through] = /render\.py → lines (\d+)-(\d+)/.exec(change);
  const lines = change.split('\n');
  assert.equal(lines[Number(from) - 1], 'diff --git a/tools/render.py b/tools/render.py');
  assert.equal(lines[Number(through) - 1], '');
});

test('D206: within the bound, no row is folded', () => {
  const small = [script('a.py'), ...Array.from({ length: 200 }, (_, i) => artifact(i))];
  const { change } = changeBlock(small);
  assert.equal(change.includes('not listed one by one'), false);
  assert.equal(change.match(/frame\.mp4/g).length, 200);
});

test('D206: the rows fold in order — unrecorded first; a file a dossier item names keeps its row while another can fold', () => {
  const noted = artifact(7);
  const files = [script('a.py'), ...Array.from({ length: 3_000 }, (_, i) => artifact(i))];
  const notes = new Map([[noted.path, ['S3']]]);
  const { change } = changeBlock(files, { notes });
  assert.ok(change.includes(`- ${noted.path} · added · binary: no hunk shown · S3`));
  assert.ok(change.includes('2999 files not listed one by one'));
});

test('D206: recorded rows fold last, and the bound holds even when the session itself wrote thousands of files', () => {
  const files = Array.from({ length: 6_000 }, (_, i) => script(`gen/part-${String(i % 40).padStart(2, '0')}/f${i}.py`, 2));
  const plan = planReviewUnits(files);
  assert.ok(plan.capacity >= CODE_CHANGE_BLOCK_MAX_BYTES - CODE_INDEX_MAX_BYTES - 1_000);
  const block = unitChangeBlock(files, plan, 0);
  assert.ok(Buffer.byteLength(tocOfBlock(block.change)) <= CODE_INDEX_MAX_BYTES);
  assert.ok(Buffer.byteLength(block.change) <= CODE_CHANGE_BLOCK_MAX_BYTES);
  assert.match(block.change, /files not listed one by one, \d+ written by a recorded edit/);
  assert.ok(block.shown.size > 0);
});

test('D206: folders join their parents until the rows fit, and one row can always say them all', () => {
  const files = Array.from({ length: 30_000 }, (_, i) => artifact(i, { path: `a/b${i % 9000}/c${i}/x${i}.bin` }));
  const { change } = changeBlock(files);
  assert.ok(Buffer.byteLength(tocOfBlock(change)) <= CODE_INDEX_MAX_BYTES);
  const counts = [...change.matchAll(/ · (\d+) files? not listed/g)].map((m) => Number(m[1]));
  assert.equal(counts.reduce((a, b) => a + b, 0), 30_000, 'every file is counted once');
});

test('D206: folds are in code-unit order, and a change of very many distinct folders does not overflow', () => {
  const inFolders = (n) => Array.from({ length: n }, (_, i) => artifact(i, { path: `f${String(i).padStart(6, '0')}/x.bin` }));
  const counts = [...changeBlock([...inFolders(3_000)].reverse()).change.matchAll(/^- (\S+) · \d+ files? not listed/gm)].map((m) => m[1]);
  assert.deepEqual(counts, [...counts].sort());
  assert.ok(counts.length > 1 || counts[0] === '.');
  assert.ok(changeBlock(inFolders(200_000)).change.includes('200000 files not listed one by one'));
});

test('D206: past the guard, a generated file the session wrote comes before a file it did not write', () => {
  const others = Array.from({ length: CODE_UNIT_LIMITS.units + 10 }, (_, i) => unrecorded(`aaa/d${String(i).padStart(3, '0')}/f.py`, 5_000));
  const plan = planReviewUnits([...others, script('package-lock.json', 5_000)]);
  assert.ok(plan.units.flatMap((u) => u.paths).includes('package-lock.json'));
  assert.ok(plan.beyondGuard.flatMap((u) => u.paths).every((p) => p.startsWith('aaa/')));
});

test('D206: the same files give the same block, whatever their order', () => {
  const files = [script('z.py'), script('a.py'), ...Array.from({ length: 3_000 }, (_, i) => artifact(i))];
  assert.equal(changeBlock(files).change, changeBlock([...files].reverse()).change);
});

test('D206: past the guard, the units that hold a recorded write come first, so none of them is closed unit_cap', () => {
  // Each file fills a unit of its own; the recorded files sort last by path, so the old order closed them.
  const fill = 5_000;
  const others = Array.from({ length: CODE_UNIT_LIMITS.units + 10 }, (_, i) => unrecorded(`aaa/d${String(i).padStart(3, '0')}/f.py`, fill));
  const mine = [script('zzz/mine.py', fill), script('zzz/also.py', fill)];
  const plan = planReviewUnits([...others, ...mine]);
  const planned = plan.units.flatMap((u) => u.paths);
  assert.equal(plan.units.length, CODE_UNIT_LIMITS.units);
  assert.ok(planned.includes('zzz/mine.py') && planned.includes('zzz/also.py'));
  assert.deepEqual(plan.units[0].label, 'U1');
  assert.ok(plan.units[0].paths.some((p) => p.startsWith('zzz/')), 'a recorded unit is reviewed first');
  assert.ok(plan.beyondGuard.flatMap((u) => u.paths).every((p) => p.startsWith('aaa/')));
});

test('D206: within the guard the units keep their order: a recorded file is not moved ahead', () => {
  const files = [unrecorded('aaa/one.py', 5_000), unrecorded('bbb/two.py', 5_000), script('zzz/mine.py', 5_000)];
  const plan = planReviewUnits(files);
  assert.ok(plan.units.length > 1 && plan.units.length <= CODE_UNIT_LIMITS.units);
  assert.deepEqual(plan.units[0].paths[0], 'aaa/one.py');
});

test('D206: the profile names the bound; the fold words say what they fold', () => {
  assert.deepEqual(CODE_PASS_PROFILE.index, { maxBytes: 100_000, unitOrder: 'write-then-commit-and-base-then-time-past-the-guard' });
  assert.equal(CODE_INDEX_MAX_BYTES, 100_000);
  const tail = 'the hunks of those this request shows are below; read the others yourself';
  assert.equal(FOLDED_ROW_WORDS({ at: 'a/b', n: 1, written: 1 }),
    `- a/b · 1 file not listed one by one, 1 written by a recorded edit; ${tail}`);
  assert.equal(FOLDED_ROW_WORDS({ at: '.', n: 9, written: 0 }),
    `- . · 9 files not listed one by one, none written by a recorded edit; ${tail}`);
});
