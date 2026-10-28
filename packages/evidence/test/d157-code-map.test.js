// D157: the code map's pure part. The identifier tokens of each hunk's changed rows, by the hunk ledger's identity; the
// asks spread over the hunks; git grep's records read; the occurrences outside the change (its changed lines, files
// whose changed lines are not known, the places the review writes); the count bounds and every cut counted under its
// closed reason; grounding by string search; the names and classes of the files; the hash, the same for the same
// occurrences in any order; the reference list of a hunk; a dropped map holds nothing. Since map /2, the repository as
// it is now alone. No score, rank or tier anywhere; nothing of the session.
//
// Every byte is invented: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHunks } from '../src/code-context.js';
import { hunkLedger } from '../src/code-pass.js';
import { CODE_MAP_CUTS } from '../src/ledger.js';
import { CODE_MAP_CLASSES, CODE_MAP_LIMITS, CODE_MAP_VERSION, codeMapCandidates, codeMapOf, codeMapPlan,
  codeMapReferences, droppedCodeMap, grepOccurrences, holdsWord, identifierTokens } from '../src/code-map.js';

const ROOT = '/work/repo/sub';
const TOP = '/work/repo';
const patchOf = (lines) => ['diff --git a/x b/x', '--- a/x', '+++ b/x', ...lines, ''].join('\n');
/** A frozen file of a git change: its patch's hunks parsed, readable now. */
const fileOf = (path, type, patchLines, { text = 'SYNTHETIC\n', place = null, diff = 'recorded' } = {}) => ({
  path, changed: true, recorded: true, ...(place ? { place } : {}), state: type === 'deleted' ? 'deleted' : 'readable',
  ...(type === 'deleted' ? {} : { text, sha256: 'f'.repeat(64), bytes: text.length, lines: text.split('\n').length }),
  type, diff, base: null, hunks: parseHunks(patchOf(patchLines)).hunks });
const FILES = [
  // Two hunks: a renamed function and a new call; a context row (`keep`) is no changed row.
  fileOf('src/lib.js', 'modified', ['@@ -1,3 +1,3 @@', ' keep(1);', '-export function oldName(a) {', '+export function newName(a, b) {',
    ' }', '@@ -20,2 +20,3 @@', ' tail();', '+newName(9_lives, 0x1F, naïve);', ' end();']),
  fileOf('src/added.js', 'added', ['@@ -0,0 +1,2 @@', '+import { newName } from "./lib.js";', '+newName(1, 2);']),
  fileOf('src/gone.js', 'deleted', ['@@ -1,2 +0,0 @@', '-oldName(3);', '-export const gone = 1;']),
  // A file whose diff cannot be shown: its ledger entry, closed, no token.
  { path: 'assets/logo.png', changed: true, recorded: true, state: 'binary', type: 'added', diff: 'withheld', base: null,
    hunks: [] },
];

test('D157: identifier tokens are runs of git grep\'s word characters, never opening with a digit, once each, in order', () => {
  assert.deepEqual(identifierTokens('const fooBar = 0x1F + naïve_x($a, _b, 9lives, fooBar);'),
    ['const', 'fooBar', 'na', 've_x', 'a', '_b']);
  assert.deepEqual(identifierTokens(''), []);
  assert.deepEqual(identifierTokens(null), []);
  assert.deepEqual(identifierTokens('// a comment names parse; "a string names split"'),
    ['a', 'comment', 'names', 'parse', 'string', 'split']);
});

test('D157: a whole word by string search: no word character either side', () => {
  assert.equal(holdsWord('fooBar(fooBar_x, fooBar);', 'fooBar'), true);
  assert.equal(holdsWord('fooBar_x + xfooBar', 'fooBar'), false);
  assert.equal(holdsWord('$fooBar.x', 'fooBar'), true);
  assert.equal(holdsWord('fooBar', 'fooBar'), true);
  assert.equal(holdsWord('naïve', 've'), true);
  assert.equal(holdsWord(null, 'fooBar'), false);
  assert.equal(holdsWord('fooBar', ''), false);
});

test('D157: the plan: one entry per hunk ledger entry, by its id and in its order; tokens of the changed rows alone; the asks spread over the hunks, once a place', () => {
  const plan = codeMapPlan(FILES, { root: ROOT, top: TOP });
  assert.deepEqual(plan.hunks.map((h) => h.id), hunkLedger(FILES).map((e) => e.id));
  assert.deepEqual(plan.hunks.map((h) => [h.path, h.tokens]), [
    ['assets/logo.png', []],
    ['src/added.js', ['import', 'newName', 'from', 'lib', 'js']],
    ['src/gone.js', ['oldName', 'export', 'const', 'gone']],
    ['src/lib.js', ['export', 'function', 'oldName', 'a', 'newName', 'b']],
    ['src/lib.js', ['newName', 'na', 've']]]);
  assert.equal(plan.hunks[0].closed, 'binary');
  // The first token of each hunk, then the second of each, …; a token asked once.
  assert.deepEqual(plan.asks.map((a) => a.token), ['import', 'oldName', 'export', 'newName', 'function', 'na', 'from',
    'const', 've', 'lib', 'gone', 'a', 'js', 'b']);
  // Each file's changed lines now, by its absolute name, and the change's own name for it.
  assert.deepEqual(plan.changed['/work/repo/sub/src/lib.js'], [[2, 2], [21, 21]]);
  assert.deepEqual(plan.changed['/work/repo/sub/src/gone.js'], []);
  assert.equal(plan.names['/work/repo/sub/src/added.js'], 'src/added.js');
  // Tokens a hunk: the rest counted.
  const capped = codeMapPlan(FILES, { root: ROOT, top: TOP, limits: { ...CODE_MAP_LIMITS, tokensPerHunk: 2 } });
  assert.deepEqual(capped.hunks.map((h) => [h.tokens.length, h.cut]), [[0, undefined], [2, 3], [2, 2], [2, 4], [2, 1]]);
  // The same files in another order give the same plan.
  assert.deepEqual(codeMapPlan([...FILES].reverse(), { root: ROOT, top: TOP }), plan);
});

test('D157: a recorded write of the whole file: its tokens are the lines it wrote', () => {
  const whole = { path: 'src/w.js', changed: true, recorded: true, state: 'readable', text: 'alpha();\nbeta();\ngamma();\n',
    type: 'modified', diff: 'base_unknown', base: null,
    hunks: [{ oldStart: null, oldCount: 0, newStart: 2, newCount: 2, header: 'recorded edit 1', rows: [], whole: true }] };
  assert.deepEqual(codeMapPlan([whole], { root: ROOT }).hunks[0].tokens, ['beta', 'gamma']);
});

test('D157: git grep\'s records read; a record out of shape counted, never read', () => {
  // `bad record` runs into the next record (a name ends only at its NUL), whose line is no number: one record out of
  // shape; then a match that is not the token.
  const text = 'src/a.js\x0012\x00fooBar\n../docs/x.md\x003\x00fooBar\nbad record\nsrc/b.js\x00x\x00fooBar\nsrc/c.js\x004\x00other\n';
  assert.deepEqual(grepOccurrences(text, 'fooBar'), { occurrences: [{ name: 'src/a.js', line: 12, token: 'fooBar' },
    { name: '../docs/x.md', line: 3, token: 'fooBar' }], malformed: 2 });
  assert.equal(grepOccurrences('src/a.js\x0012\x00fooBar', 'fooBar').malformed, 1, 'a record with no end');
  assert.equal(grepOccurrences('\x001\x00fooBar\n', 'fooBar').malformed, 1, 'a record with no name');
  // A name holding a line break is read whole (the name ends at its NUL).
  assert.deepEqual(grepOccurrences('a\nb.js\x002\x00fooBar\n', 'fooBar').occurrences, [{ name: 'a\nb.js', line: 2,
    token: 'fooBar' }]);
  assert.deepEqual(grepOccurrences('', 'fooBar'), { occurrences: [], malformed: 0 });
});

/** What each ask's search found, by token: an occurrence list `[path, line]` (absolute), or a state; a token not named
 *  found nothing. */
const foundOf = (plan, by) => plan.asks.map((a) => {
  const v = by[a.token];
  return v === undefined ? { state: 'ok', occurrences: [] } : typeof v === 'string' ? { state: v }
    : { state: 'ok', occurrences: v.map(([path, line]) => ({ path, line })) };
});
const A = (p) => `/work/repo/${p}`;
/** A read's key: the place whose search found it ('' for the working folder's repository) and its path. */
const K = (path, place = '') => `${place}\0${path}`;
const foundFor = (c, token) => c.tokens.find((t) => t.token === token).found;

test('D157: the candidates: occurrences on the change\'s own changed lines are inside it; a place the review writes is no part of the repository; common names by count and by files; the call states', () => {
  const plan = codeMapPlan(FILES, { root: ROOT, top: TOP });
  const found = foundOf(plan, {
    newName: [[A('sub/src/lib.js'), 2], [A('sub/src/lib.js'), 21], [A('sub/src/app.js'), 4], [A('sub/.state/r.json'), 1],
      [A('sub/src/app.js'), 4]],
    oldName: [[A('sub/src/app.js'), 7], [A('sub/src/lib.js'), 3]],
    export: Array.from({ length: 101 }, (_, i) => [A('sub/src/x.js'), i + 1]),
    const: Array.from({ length: 26 }, (_, i) => [A(`sub/src/f${i}.js`), 1]),
    import: 'failed',
    function: 'overflow',
    gone: 'unasked',
  });
  const c = codeMapCandidates(plan, found, { omit: [A('sub/.state')] });
  // lib.js:2 and :21 are changed lines; the state folder no part; a duplicate once; lib.js:3 an unchanged line.
  assert.deepEqual(foundFor(c, 'newName'), { occurrences: [[A('sub/src/app.js'), 4]] });
  assert.deepEqual(foundFor(c, 'oldName'), { occurrences: [[A('sub/src/app.js'), 7], [A('sub/src/lib.js'), 3]] });
  assert.deepEqual([foundFor(c, 'export'), foundFor(c, 'const'), foundFor(c, 'function')],
    [{ cut: 'common_name' }, { cut: 'common_name' }, { cut: 'common_name' }]);
  assert.deepEqual([foundFor(c, 'import'), foundFor(c, 'gone')], [{ cut: 'grep_failed' }, { cut: 'grep_cap' }]);
  assert.deepEqual(c.cuts, { common_name: 3, token_cap: 0, grep_cap: 1, grep_failed: 1, long_lines: 0, lines_unknown: 0,
    edge_ungrounded: 0, map_timeout: 0 });
  // What grounding reads: each file once, its lines sorted.
  assert.deepEqual(c.reads, { [K(A('sub/src/app.js'))]: [4, 7], [K(A('sub/src/lib.js'))]: [3] });
  // A place not searched: no entry found.
  assert.deepEqual(codeMapCandidates(plan, plan.asks.map(() => null)).tokens[0], { place: null, token: 'import' });
  // Exactly at the bounds is within them.
  const at = codeMapCandidates(plan, foundOf(plan, { export: Array.from({ length: 100 }, (_, i) => [A('sub/src/x.js'), i + 1]),
    const: Array.from({ length: 25 }, (_, i) => [A(`sub/src/f${i}.js`), 1]) }));
  assert.equal(at.cuts.common_name, 0);
});

/** The map from the plan and what each token found, every candidate line holding its token unless `lines` says. */
function mapOf(plan, by, lines = {}, options = {}) {
  const c = codeMapCandidates(plan, foundOf(plan, by), options);
  const read = {};
  for (const [key, numbers] of Object.entries(c.reads)) {
    const path = key.slice(key.indexOf('\0') + 1);
    const tokens = Object.keys(by).filter((token) => Array.isArray(by[token]) && by[token].some(([p]) => p === path));
    read[key] = key in lines ? lines[key] : Object.fromEntries(numbers.map((n) => [n, `use(${tokens.join(', ')});`]));
  }
  return codeMapOf(plan, c, read, options);
}

test('D157: the map: edges grounded by string search, long lines and ungrounded edges counted, names and classes, sorted edges, the hash over the edges alone', () => {
  const plan = codeMapPlan(FILES, { root: ROOT, top: TOP });
  const by = { newName: [[A('sub/src/app.js'), 4], [A('docs/guide.md'), 2], [A('config/app.json'), 1],
    [A('sub/src/added.js'), 9]], oldName: [[A('sub/vendor/min.js'), 1], [A('sub/src/app.js'), 7]] };
  const lines = { [K(A('sub/vendor/min.js'))]: { 1: `${'x'.repeat(CODE_MAP_LIMITS.lineChars)} oldName` },
    [K(A('sub/src/app.js'))]: { 4: 'newName();', 7: 'oldNameX();' } };
  const map = mapOf(plan, by, lines);
  assert.equal(map.version, CODE_MAP_VERSION);
  assert.equal(CODE_MAP_VERSION, 'sonah.code-map/2');
  assert.deepEqual(map.tokens.find((t) => t.token === 'newName'), { token: 'newName', edges: [
    ['../config/app.json', 1], ['../docs/guide.md', 2], ['src/added.js', 9], ['src/app.js', 4]] });
  // A file of the change by the change's own name; others from the working directory; classes by the path from the top.
  assert.deepEqual(map.classes, { '../config/app.json': 'config', '../docs/guide.md': 'copy' });
  assert.deepEqual(map.tokens.find((t) => t.token === 'oldName'), { token: 'oldName', edges: [] });
  assert.deepEqual([map.cuts.long_lines, map.cuts.edge_ungrounded], [1, 1]);
  assert.deepEqual(Object.keys(map.cuts), CODE_MAP_CUTS);
  // The same occurrences in another order: the same map, the same hash.
  const again = mapOf(plan, { newName: [...by.newName].reverse(), oldName: [...by.oldName].reverse() }, lines);
  assert.equal(JSON.stringify(again), JSON.stringify(map));
  // One edge more: another hash.
  const more = mapOf(plan, { ...by, newName: [...by.newName, [A('sub/src/b.js'), 3]] }, lines);
  assert.notEqual(more.hash, map.hash);
  // A file Sonah could not read grounds none.
  const unread = mapOf(plan, { newName: [[A('sub/src/app.js'), 4]] }, { [K(A('sub/src/app.js'))]: null });
  assert.deepEqual([unread.tokens.find((t) => t.token === 'newName').edges, unread.cuts.edge_ungrounded], [[], 1]);
});

test('D157: the hash is over the edges alone, whatever the order of the tokens, and holds each edge\'s token and line; a file of the change by the change\'s own name', () => {
  const plan = codeMapPlan(FILES, { root: ROOT, top: TOP });
  const by = { newName: [[A('sub/src/app.js'), 4]], oldName: [[A('docs/guide.md'), 1]] };
  const c = codeMapCandidates(plan, foundOf(plan, by));
  const read = { [K(A('sub/src/app.js'))]: { 4: 'newName()' }, [K(A('docs/guide.md'))]: { 1: 'oldName' } };
  const map = codeMapOf(plan, c, read);
  const reversed = codeMapOf(plan, { ...c, tokens: [...c.tokens].reverse() }, read);
  assert.notDeepEqual(reversed.tokens, map.tokens);
  assert.equal(reversed.hash, map.hash);
  // Two tokens swapped between their lines; an edge on another line; an edge added.
  const hashOf = (b) => mapOf(plan, b).hash;
  const base = hashOf({ newName: [[A('sub/src/app.js'), 4]], oldName: [[A('sub/src/app.js'), 5]] });
  assert.notEqual(hashOf({ newName: [[A('sub/src/app.js'), 5]], oldName: [[A('sub/src/app.js'), 4]] }), base);
  assert.notEqual(hashOf({ newName: [[A('sub/src/app.js'), 6]], oldName: [[A('sub/src/app.js'), 5]] }), base);
  assert.notEqual(hashOf({ newName: [[A('sub/src/app.js'), 4], [A('sub/src/app.js'), 9]],
    oldName: [[A('sub/src/app.js'), 5]] }), base);
  // A file of the working folder's repository that the change names by its absolute path (it lies outside the working
  // directory): its edges go by that name; another file there, by its path from the working directory.
  const outside = fileOf(A('tools/x.js'), 'modified', ['@@ -1,1 +1,1 @@', '-gone();', '+toolCall();']);
  const withOutside = codeMapPlan([...FILES, outside], { root: ROOT, top: TOP });
  const named = codeMapOf(withOutside, codeMapCandidates(withOutside, foundOf(withOutside, { newName:
    [[A('tools/x.js'), 9], [A('tools/y.js'), 2]] })), { [K(A('tools/x.js'))]: { 9: 'newName' },
    [K(A('tools/y.js'))]: { 2: 'newName' } });
  assert.deepEqual(named.tokens.find((t) => t.token === 'newName').edges, [['../tools/y.js', 2], [A('tools/x.js'), 9]]);
});

test('D157: another place\'s files go by their absolute names and its own classes; its tokens are its own', () => {
  const other = '/elsewhere/tool';
  const files = [...FILES, fileOf(`${other}/src/t.js`, 'modified', ['@@ -1,1 +1,1 @@', '-oldName();', '+toolName();'],
    { place: other })];
  const plan = codeMapPlan(files, { root: ROOT, top: TOP, places: [other] });
  assert.deepEqual(plan.asks.filter((a) => a.place === other).map((a) => a.token), ['oldName', 'toolName']);
  const c = codeMapCandidates(plan, plan.asks.map((a) => (a.place !== other ? null : a.token === 'oldName'
    ? { state: 'ok', occurrences: [{ path: `${other}/docs/x.md`, line: 2 }] } : { state: 'ok', occurrences: [] })));
  assert.deepEqual(Object.keys(c.reads), [K(`${other}/docs/x.md`, other)]);
  const map = codeMapOf(plan, c, { [K(`${other}/docs/x.md`, other)]: { 2: 'oldName()' } });
  assert.deepEqual(map.tokens.filter((t) => t.place === other), [{ token: 'oldName', place: other,
    edges: [[`${other}/docs/x.md`, 2]] }, { token: 'toolName', place: other, edges: [] }]);
  assert.deepEqual(map.classes, { [`${other}/docs/x.md`]: 'copy' });
  const hunk = map.hunks.find((h) => h.place === other);
  assert.deepEqual(codeMapReferences(map, hunk.id), [{ token: 'oldName', path: `${other}/docs/x.md`, line: 2,
    class: 'copy' }]);
  // The working folder's `oldName` is another token, not searched here.
  assert.deepEqual(map.tokens.find((t) => t.token === 'oldName' && t.place === undefined), { token: 'oldName' });
});

test('D157: the plan names each file of the change by the real name its caller gives it, so git\'s occurrences meet it', () => {
  const real = { 'src/lib.js': '/real/repo/sub/src/lib.js', [A('tools/x.js')]: '/real/repo/tools/x.js' };
  const outside = fileOf(A('tools/x.js'), 'modified', ['@@ -1,1 +1,1 @@', '-gone();', '+toolCall();']);
  const plan = codeMapPlan([...FILES, outside], { root: ROOT, top: TOP, real });
  assert.deepEqual(plan.changed['/real/repo/sub/src/lib.js'], [[2, 2], [21, 21]]);
  assert.equal(plan.names['/real/repo/tools/x.js'], A('tools/x.js'));
  assert.equal(plan.changed[A('sub/src/lib.js')], undefined);
  // An occurrence on the change's own line, by the real name: inside the change; the file's other line, by its own name.
  const c = codeMapCandidates(plan, foundOf(plan, { toolCall: [['/real/repo/tools/x.js', 1], ['/real/repo/tools/x.js', 5]] }));
  const map = codeMapOf(plan, c, { [K('/real/repo/tools/x.js')]: { 5: 'toolCall()' } });
  assert.deepEqual(map.tokens.find((t) => t.token === 'toolCall').edges, [[A('tools/x.js'), 5]]);
});

test('D157: a file of the change whose changed lines are not known gives no edge, counted by place and file', () => {
  // Recorded edits: one Sonah placed, one it could not (an added row with no line), a whole write with no start line.
  const placed = { path: 'src/p.js', changed: true, recorded: true, state: 'readable', text: 'a();\nplacedName();\n',
    type: 'modified', diff: 'base_unknown', base: null, hunks: [{ oldStart: null, oldCount: 0, newStart: 2, newCount: 1,
      header: 'recorded edit 1', rows: [{ type: '+', text: 'placedName();', old: null, new: 2 }] }] };
  const lost = { ...placed, path: 'src/u.js', hunks: [{ oldStart: null, oldCount: 1, newStart: null, newCount: 0,
    header: 'recorded edit 1', rows: [{ type: '-', text: 'old();', old: null, new: null },
      { type: '+', text: 'lostName();', old: null, new: null }] }] };
  const whole = { ...placed, path: 'src/w.js', hunks: [{ oldStart: null, oldCount: 0, newStart: null, newCount: 0,
    header: 'recorded edit 1', whole: true, rows: [] }] };
  const plan = codeMapPlan([...FILES, placed, lost, whole], { root: ROOT, top: TOP });
  assert.deepEqual(plan.unknown, { [A('sub/assets/logo.png')]: true, [A('sub/src/u.js')]: true, [A('sub/src/w.js')]: true });
  const by = { lostName: [[A('sub/src/u.js'), 7], [A('sub/src/w.js'), 1], [A('sub/src/w.js'), 2],
    [A('sub/assets/logo.png'), 1], [A('sub/src/p.js'), 1], [A('sub/src/app.js'), 3]],
  placedName: [[A('sub/src/u.js'), 9], [A('sub/src/w.js'), 3]] };
  const c = codeMapCandidates(plan, foundOf(plan, by));
  // u.js, w.js and logo.png are unknown; p.js's unchanged line and app.js stand.
  assert.deepEqual(foundFor(c, 'lostName'), { occurrences: [[A('sub/src/app.js'), 3], [A('sub/src/p.js'), 1]] });
  assert.deepEqual(foundFor(c, 'placedName'), { occurrences: [] });
  // Counted once a place and file, whatever the tokens found there: u.js, w.js, logo.png.
  assert.equal(c.cuts.lines_unknown, 3);
  // Unknown files do not count toward a common name: four occurrences there, a bound of 2, two outside.
  const bounded = codeMapCandidates(plan, foundOf(plan, by), { limits: { ...CODE_MAP_LIMITS, occurrences: 2 } });
  assert.equal(foundFor(bounded, 'lostName').occurrences.length, 2);
});

test('D157: a class by the path from the top folder, never from the working directory', () => {
  for (const [root, cls] of [['/work/repo/docs/site', 'copy'], ['/work/repo/config/app', 'config']]) {
    const plan = codeMapPlan(FILES, { root, top: TOP });
    const map = codeMapOf(plan, codeMapCandidates(plan, foundOf(plan, { newName: [[`${root}/x.js`, 1]] })),
      { [K(`${root}/x.js`)]: { 1: 'newName' } });
    assert.deepEqual(map.classes, { 'x.js': cls }, root);
  }
});

test('D157: a long line takes the whole file out, for every token, counted once a file', () => {
  const plan = codeMapPlan(FILES, { root: ROOT, top: TOP });
  const min = A('sub/vendor/min.js');
  const by = { oldName: [[min, 1], [min, 3]], newName: [[min, 2], [A('sub/src/app.js'), 4]] };
  const map = mapOf(plan, by, { [K(min)]: { 1: `${'x'.repeat(CODE_MAP_LIMITS.lineChars)} oldName`, 2: 'newName',
    3: `${'y'.repeat(CODE_MAP_LIMITS.lineChars)} oldName` } });
  assert.deepEqual(map.tokens.find((t) => t.token === 'oldName').edges, []);
  assert.deepEqual(map.tokens.find((t) => t.token === 'newName').edges, [['src/app.js', 4]]);
  assert.equal(map.cuts.long_lines, 1);
});

test('D157: a common name counts each match: two on one line at the bound stand, three are over it', () => {
  const plan = codeMapPlan(FILES, { root: ROOT, top: TOP });
  const limits = { ...CODE_MAP_LIMITS, occurrences: 2 };
  const line = (n) => Array.from({ length: n }, () => [A('sub/src/app.js'), 4]);
  const two = codeMapCandidates(plan, foundOf(plan, { newName: line(2) }), { limits });
  assert.deepEqual(foundFor(two, 'newName'), { occurrences: [[A('sub/src/app.js'), 4]] });
  const three = codeMapCandidates(plan, foundOf(plan, { newName: line(3) }), { limits });
  assert.deepEqual(foundFor(three, 'newName'), { cut: 'common_name' });
});

test('D157: a hunk\'s reference list, in its tokens\' order; none for a dropped map or an unknown hunk', () => {
  const plan = codeMapPlan(FILES, { root: ROOT, top: TOP });
  const map = mapOf(plan, { newName: [[A('sub/src/app.js'), 4], [A('sub/src/app.js'), 3]],
    oldName: [[A('docs/guide.md'), 1]] });
  const lib = map.hunks.find((h) => h.path === 'src/lib.js');
  assert.deepEqual(codeMapReferences(map, lib.id), [
    { token: 'oldName', path: '../docs/guide.md', line: 1, class: 'copy' },
    { token: 'newName', path: 'src/app.js', line: 3 },
    { token: 'newName', path: 'src/app.js', line: 4 }]);
  assert.deepEqual(codeMapReferences(map, 'hunk:none'), []);
  assert.deepEqual(codeMapReferences(droppedCodeMap(), lib.id), []);
});

test('D157: a dropped map holds no hunk, token, edge or hash; its one cut is the guard', () => {
  assert.deepEqual(droppedCodeMap(), { version: CODE_MAP_VERSION, limits: CODE_MAP_LIMITS, dropped: 'map_timeout',
    cuts: { common_name: 0, token_cap: 0, grep_cap: 0, grep_failed: 0, long_lines: 0, lines_unknown: 0, edge_ungrounded: 0,
      map_timeout: 1 } });
});

test('D157: closed lists and frozen literals; no side, score, rank, risk or tier anywhere in a map', () => {
  for (const closed of [CODE_MAP_CUTS, CODE_MAP_CLASSES, CODE_MAP_LIMITS]) assert.ok(Object.isFrozen(closed));
  for (const token of [...CODE_MAP_CUTS, ...CODE_MAP_CLASSES]) assert.match(token, /^[a-z][a-z_]*$/);
  assert.ok(Object.values(CODE_MAP_LIMITS).every((n) => Number.isSafeInteger(n) && n > 0));
  const plan = codeMapPlan(FILES, { root: ROOT, top: TOP });
  const map = mapOf(plan, { newName: [[A('sub/src/app.js'), 4]] });
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
  };
  walk(map);
  for (const k of keys) assert.ok(!/score|rank|risk|tier|confidence|severity|side|head|start/i.test(k), k);
});
