// D178 (0.3.0-beta.10): the size line counted a change twice when two worktrees of one repository held the same
// files, since each worktree is a place of the change and each file a unit in each. The rule (code-pass.js
// `changeRepeatsOf`) is structure only, from what the record already holds: a unit repeats another place's when both
// have the same start commit, the same path in their repository, the same change type and the same head (sha256, or
// deleted). Equal commits and paths give equal start bytes, equal heads equal bytes now. Anything not proved is never a
// repeat (a false NONE, the safe direction). The working folder's units take part only with the working directory's
// offset in its repository (`base.within`, `withinOf`), which no record made before D178 holds. D178's review: a unit
// that could repeat (its start commit is another place's too) but cannot be keyed is `unproved`, and then `distinct` is
// null, so no reader says "each repeat counted once" past what the rule proved. Synthetic records only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { changeRepeatsOf, withinOf } from '../src/code-pass.js';

const C1 = '1'.repeat(40), C2 = '2'.repeat(40);
const SHA = (c) => c.repeat(64);
const A = '/work/wt-a', B = '/work/wt-b', D = '/work/wt-d';
const gitPlace = (at, commit = C1) => ({ kind: 'git', at, written: 1, commit, how: 'reflog', changedOutside: [] });
/** A record and its tally, from `[path, place, type, sha256]` units (a null place: the working folder's). */
function shaped(units, base) {
  const files = units.map(([path, place, type, sha256]) => ({ path, ...(place ? { place } : {}), type, state: 'shown',
    ...(sha256 ? { sha256 } : {}), hunks: 1 }));
  return { codePass: { base, files }, tally: { units: units.map(([path, place]) => ({ path, ...(place ? { place } : {}) })) } };
}
const repeatsOf = (units, base) => { const { codePass, tally } = shaped(units, base); return changeRepeatsOf(codePass, tally); };
const TWO = { kind: 'git', commit: C1, places: [gitPlace(A), gitPlace(B)] };

test('D178: two places with the same start commit, path, type and head hold one change; it is counted once', () => {
  assert.deepEqual(repeatsOf([[`${A}/src/a.js`, A, 'modified', SHA('a')], [`${B}/src/a.js`, B, 'modified', SHA('a')]],
    TWO), { repeats: 1, unproved: 0, distinct: 1 });
  // A deleted pair: both deleted the same start file.
  assert.deepEqual(repeatsOf([[`${A}/old.js`, A, 'deleted'], [`${B}/old.js`, B, 'deleted']], TWO),
    { repeats: 1, unproved: 0, distinct: 1 });
  // A triple: two repeats.
  assert.deepEqual(repeatsOf([[`${A}/x.js`, A, 'added', SHA('c')], [`${B}/x.js`, B, 'added', SHA('c')],
    [`${D}/x.js`, D, 'added', SHA('c')]], { ...TWO, places: [...TWO.places, gitPlace(D)] }),
  { repeats: 2, unproved: 0, distinct: 1 });
  // The count does not depend on the order of the units.
  assert.deepEqual(repeatsOf([[`${B}/src/a.js`, B, 'modified', SHA('a')], [`${A}/src/a.js`, A, 'modified', SHA('a')],
    [`${A}/b.js`, A, 'modified', SHA('b')]], TWO), { repeats: 1, unproved: 0, distinct: 2 });
});

test('D178: anything not proved the same is no repeat; a unit that could repeat but cannot be keyed leaves no count', () => {
  const none = { repeats: 0, unproved: 0, distinct: 2 };
  // Another start commit; another head; another type; another path in the repository.
  assert.deepEqual(repeatsOf([[`${A}/a.js`, A, 'modified', SHA('a')], [`${B}/a.js`, B, 'modified', SHA('a')]],
    { kind: 'git', commit: C1, places: [gitPlace(A), gitPlace(B, C2)] }), none);
  // Two pairs of places, each pair of one start commit: the same path and head under the two commits is two changes.
  const E = '/work/wt-e';
  assert.deepEqual(repeatsOf([[`${A}/a.js`, A, 'modified', SHA('a')], [`${D}/a.js`, D, 'modified', SHA('a')],
    [`${B}/b.js`, B, 'modified', SHA('b')], [`${E}/e.js`, E, 'modified', SHA('e')]],
  { kind: 'git', commit: C1, places: [gitPlace(A), gitPlace(B), gitPlace(D, C2), gitPlace(E, C2)] }),
  { repeats: 0, unproved: 0, distinct: 4 });
  assert.deepEqual(repeatsOf([[`${A}/a.js`, A, 'modified', SHA('a')], [`${B}/a.js`, B, 'modified', SHA('b')]], TWO), none);
  assert.deepEqual(repeatsOf([[`${A}/a.js`, A, 'added', SHA('a')], [`${B}/a.js`, B, 'modified', SHA('a')]], TWO), none);
  assert.deepEqual(repeatsOf([[`${A}/a.js`, A, 'modified', SHA('a')], [`${B}/lib/a.js`, B, 'modified', SHA('a')]], TWO),
    none);
  // No git base (a folder's recorded edits): no start commit, so it repeats nothing and leaves the count whole.
  assert.deepEqual(repeatsOf([[`${A}/a.js`, A, 'modified', SHA('a')], [`${B}/a.js`, B, 'modified', SHA('a')]],
    { kind: 'git', commit: C1, places: [gitPlace(A), { kind: 'recorded_edits', at: B, written: 1, repository: true }] }),
  none);
  // No head digest (binary, withheld, unreadable) in two places of one start commit: the rule cannot tell, so no count.
  assert.deepEqual(repeatsOf([[`${A}/a.bin`, A, 'modified'], [`${B}/a.bin`, B, 'modified']], TWO),
    { repeats: 0, unproved: 2, distinct: null });
  // A repeat found beside a binary pair: the repeat is counted, yet no count is said, since the pair may repeat too.
  assert.deepEqual(repeatsOf([[`${A}/a.js`, A, 'modified', SHA('a')], [`${B}/a.js`, B, 'modified', SHA('a')],
    [`${A}/a.bin`, A, 'modified'], [`${B}/a.bin`, B, 'modified']], TWO), { repeats: 1, unproved: 2, distinct: null });
  // The same binary pair under two start commits can repeat nothing: the count stands.
  assert.deepEqual(repeatsOf([[`${A}/a.bin`, A, 'modified'], [`${B}/a.bin`, B, 'modified']],
    { kind: 'git', commit: C1, places: [gitPlace(A), gitPlace(B, C2)] }), none);
  // No record of the unit.
  const { codePass, tally } = shaped([[`${A}/a.js`, A, 'modified', SHA('a')]], TWO);
  tally.units.push({ path: `${B}/a.js`, place: B });
  assert.deepEqual(changeRepeatsOf(codePass, tally), { repeats: 0, unproved: 1, distinct: null });
  // A path that is not inside its place.
  assert.deepEqual(repeatsOf([[`${A}/a.js`, A, 'modified', SHA('a')], [`${A}/a.js`.replace(A, '/elsewhere'), B,
    'modified', SHA('a')]], TWO), { repeats: 0, unproved: 1, distinct: null });
  // D178's review: two paths outside their places whose forms relative to them are the same ('../c/a.js'), with the
  // same commit, type and head: never one change (without the inside check both would key as '../c/a.js').
  const X = '/x/b', Y = '/y/d';
  assert.deepEqual(repeatsOf([['/x/c/a.js', X, 'modified', SHA('a')], ['/y/c/a.js', Y, 'modified', SHA('a')]],
    { kind: 'git', commit: C1, places: [gitPlace(X), gitPlace(Y)] }), { repeats: 0, unproved: 2, distinct: null });
  // No tally: no count.
  assert.equal(changeRepeatsOf({ base: TWO, files: [] }, null), null);
});

test('D178: a unit of the working folder takes part only with the working directory\'s offset in its repository', () => {
  const primary = (within) => ({ kind: 'git', commit: C1, ...(within === undefined ? {} : { within }),
    places: [gitPlace(B)] });
  const pair = (path) => [['src/a.js', null, 'modified', SHA('a')], [path, B, 'modified', SHA('a')]];
  const unknown = { repeats: 0, unproved: 1, distinct: null };
  // A record made before D178 holds no offset: the working folder's unit cannot be keyed, so no count is said.
  assert.deepEqual(repeatsOf(pair(`${B}/src/a.js`), primary(undefined)), unknown);
  // At the repository's top folder, and in its folder `sub`.
  assert.deepEqual(repeatsOf(pair(`${B}/src/a.js`), primary('')), { repeats: 1, unproved: 0, distinct: 1 });
  assert.deepEqual(repeatsOf(pair(`${B}/sub/src/a.js`), primary('sub')), { repeats: 1, unproved: 0, distinct: 1 });
  assert.deepEqual(repeatsOf(pair(`${B}/src/a.js`), primary('sub')), { repeats: 0, unproved: 0, distinct: 2 });
  // The working folder's base must be git's too (else it repeats nothing); an absolute path of the working folder's (a
  // file outside the working directory) or one with `..` cannot be keyed.
  assert.deepEqual(repeatsOf(pair(`${B}/src/a.js`), { kind: 'recorded_edits', within: '', places: [gitPlace(B)] }),
    { repeats: 0, unproved: 0, distinct: 2 });
  assert.deepEqual(repeatsOf([['/work/top/src/a.js', null, 'modified', SHA('a')], [`${B}/src/a.js`, B, 'modified',
    SHA('a')]], primary('')), unknown);
  assert.deepEqual(repeatsOf([['x/../src/a.js', null, 'modified', SHA('a')], [`${B}/src/a.js`, B, 'modified', SHA('a')]],
    primary('')), unknown);
  // A record with no offset whose working folder holds no unit: the other places' repeats are all there is to find.
  assert.deepEqual(repeatsOf([[`${A}/a.js`, A, 'modified', SHA('a')], [`${B}/a.js`, B, 'modified', SHA('a')]],
    { kind: 'git', commit: C1, places: [gitPlace(A), gitPlace(B)] }), { repeats: 1, unproved: 0, distinct: 1 });
});

test('D178: the offset is read only as a relative path of whole names that stays in the repository', () => {
  for (const ok of ['', 'sub', 'a/b'])
    assert.equal(withinOf({ kind: 'git', within: ok }), ok);
  for (const bad of ['..', '../x', 'a/../b', '/abs', 'a//b', './a', 'a/', 'a\\b', 1, null, undefined])
    assert.equal(withinOf({ kind: 'git', within: bad }), null, String(bad));
  assert.equal(withinOf(null), null);
});

test('D178: two worktrees of one commit with 55 and 49 files, 46 of them the same, hold 58 changes', () => {
  // 46 of the second worktree's files have the first's path, type and head; 3 share a path but not the bytes. No file in
  // the working folder. Paths and digests synthetic.
  const head = (k, tag) => `${tag}${String(k).padStart(4, '0')}`.padEnd(64, '0');
  const units = [];
  for (let k = 0; k < 55; k++) units.push([`${A}/f${k}.js`, A, 'modified', head(k, 'a')]);
  for (let k = 0; k < 49; k++) units.push([`${B}/f${k}.js`, B, 'modified', k < 46 ? head(k, 'a') : head(k, 'b')]);
  assert.deepEqual(repeatsOf(units, { kind: 'git', commit: C1, places: [gitPlace(A), gitPlace(B)] }),
    { repeats: 46, unproved: 0, distinct: 58 });
});
