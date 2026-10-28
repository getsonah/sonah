// D157: the code map's git part. Each identifier token of the change's hunks is searched with git grep (a whole word,
// fixed, text files only, the whole repository) as it is now (tracked and untracked files git does not ignore; since
// map /2, never at the start commit); each occurrence outside the change is an edge only when the token stands as a
// whole word at that line of the file as Sonah reads it. Bounds by counts, each cut counted under a closed reason; a runaway guard drops the
// whole map. Reads only. Behind an option that is off: off, nothing is read and no request or record byte moves; on, no
// request byte moves either and no reader shows it.
//
// Temporary repositories, synthetic sessions, fake agents: no recording of anyone's, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodeSnapshot, runGit } from '../src/code-snapshot.js';
import { readCodeMap, grepArgs, grepPathsArgs, IGNORED_TRACKED_ARGS } from '../src/code-map.js';
import { reviewCodePass } from '../src/session-review.js';
import { hunkLedger } from '../../evidence/src/code-pass.js';
import { CODE_MAP_LIMITS, CODE_MAP_VERSION, codeMapReferences } from '../../evidence/src/code-map.js';
import { CODE_MAP_CUTS } from '../../evidence/src/ledger.js';
import { renderSessionPage } from '../../render/session-page.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import * as fixture from './code-pass-fixture.js';

const START = '2030-01-01T00:00:00.000Z';
const PARSE_BEFORE = ['export function parse(input) {', '  const parts = input.split(",");',
  '  return parts.map((part) => part.trim());', '}', 'export const widgetCount = 3;', ''].join('\n');
const PARSE_AFTER = ['export function parse(input, sep = ",") {', '  if (!input) return [];',
  '  const parts = input.split(sep);', '  return parts.map((part) => part.trim());', '}',
  'export const widgetTotal = 3;', ''].join('\n');
const BASE = {
  '.gitignore': 'sub/ignored/\n',
  'sub/src/parse.js': PARSE_BEFORE,
  'sub/src/app.js': 'import { parse, widgetCount } from "./parse.js";\nconsole.log(parse("a,b"), widgetCount);\n',
  'sub/test/parse.test.js': 'import { parse } from "../src/parse.js";\nparse("");\n',
  'docs/guide.md': 'Call parse with a string.\nThe widgetCount is three.\n',
  'config/settings.json': '{ "widgetCount": 3 }\n',
  'sub/bin.dat': 'binary\0parse widgetCount\n',
};
const AFTER = {
  'sub/src/parse.js': PARSE_AFTER,
  'sub/src/new-use.js': 'parse("x");\n',
  'sub/ignored/x.js': 'parse("ignored");\n',
};

/** A repository whose working directory is `sub/` below its top: BASE committed, AFTER written (and `more`). */
async function repository(t, { more = {}, base = BASE } = {}) {
  const holder = await mkdtemp(join(tmpdir(), 'sonah-d157-map-'));
  t.after(() => rm(holder, { recursive: true, force: true }));
  const top = join(holder, 'repo');
  await mkdir(top, { recursive: true });
  const git = (args) => execFileSync('git', args, { cwd: top, stdio: 'pipe',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
      GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
      GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).toString();
  const write = async (files) => {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(top, path, '..'), { recursive: true });
      await writeFile(join(top, path), text);
    }
  };
  git(['init', '-q', '-b', 'main']);
  await write(base);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  await write({ ...AFTER, ...more });
  const recording = join(holder, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n`);
  return { root: join(top, 'sub'), top, recording, git, holder };
}
const session = () => fixture.codeSession();
const snapshotOf = (repo) => readCodeSnapshot(session(), { root: repo.root, maxBytes: 4_000_000,
  recording: repo.recording });
/** Each reference of the map's hunks as `token path:line class`, sorted. */
const refsOf = (map) => map.hunks.flatMap((h) => codeMapReferences(map, h.id)
  .map((r) => `${r.token} ${r.path}:${r.line}${r.class ? ` ${r.class}` : ''}`)).sort();

test('D157: the map of a real change: each hunk its ledger id and tokens; each token\'s occurrences outside the change in the repository as it is now, named as the change names files', async (t) => {
  const repo = await repository(t);
  const snapshot = await snapshotOf(repo);
  const status = repo.git(['status', '--porcelain']);
  const index = await stat(join(repo.top, '.git', 'index'));
  const map = await readCodeMap(snapshot);
  assert.equal(map.version, CODE_MAP_VERSION);
  assert.deepEqual(map.limits, CODE_MAP_LIMITS);
  // One entry per ledger entry, by its id, in its order.
  assert.deepEqual(map.hunks.map((h) => h.id), hunkLedger(snapshot.files).map((e) => e.id));
  const parseHunk = map.hunks.find((h) => h.path === 'src/parse.js');
  // In the order of their first changed row: git's diff gives the removed rows before the added ones.
  assert.deepEqual(parseHunk.tokens, ['export', 'function', 'parse', 'input', 'const', 'parts', 'split', 'sep', 'if',
    'return', 'widgetCount', 'widgetTotal']);
  const refs = refsOf(map);
  // `parse`: every other file that names it now; never its own changed line, the binary file, the ignored file; the
  // untracked file; a doc outside the working directory by `../`.
  assert.deepEqual(refs.filter((r) => r.startsWith('parse ')), ['parse ../docs/guide.md:1 copy', 'parse src/app.js:1',
    'parse src/app.js:2', 'parse src/new-use.js:1', 'parse test/parse.test.js:1', 'parse test/parse.test.js:2']);
  // The removed name still held elsewhere (a stale reference).
  assert.deepEqual(refs.filter((r) => r.startsWith('widgetCount ')), ['widgetCount ../config/settings.json:1 config',
    'widgetCount ../docs/guide.md:2 copy', 'widgetCount src/app.js:1', 'widgetCount src/app.js:2']);
  // The new name: no other occurrence, said by an empty list.
  assert.deepEqual(map.tokens.find((x) => x.token === 'widgetTotal'), { token: 'widgetTotal', edges: [] });
  // An unchanged line of a changed file is outside the change.
  assert.ok(refs.includes('parts src/parse.js:4'));
  assert.ok(!refs.includes('parts src/parse.js:3'), 'its own changed line');
  assert.deepEqual(map.places, [{ place: null, searched: true }]);
  assert.deepEqual(Object.keys(map.cuts), CODE_MAP_CUTS);
  assert.equal(Object.values(map.cuts).reduce((a, b) => a + b, 0), 0);
  assert.equal(map.calls.grep, map.tokens.length);
  assert.match(map.hash, /^[0-9a-f]{64}$/);
  // Reads only: git's index and status as they were.
  assert.equal((await stat(join(repo.top, '.git', 'index'))).mtimeMs, index.mtimeMs);
  assert.equal(repo.git(['status', '--porcelain']), status);
  // The same repository state gives the same map, byte for byte.
  assert.equal(JSON.stringify(await readCodeMap(await snapshotOf(repo))), JSON.stringify(map));
});

test('D157: the calls are git grep\'s own: a whole word, fixed, text only, the untracked files too, the whole repository, never a commit; a repository\'s grep settings set back', async (t) => {
  assert.deepEqual(grepArgs('fooBar'), ['-c', 'grep.column=false', '-c', 'grep.fullName=false', '-c',
    'grep.fallbackToNoIndex=false', '-c', 'grep.patternType=fixed', 'grep', '--no-color', '-n', '-o', '-z', '-w', '-I',
    '-F', '--untracked', '-e', 'fooBar', '--', ':/']);
  const repo = await repository(t);
  const snapshot = await snapshotOf(repo);
  const seen = [];
  const plainMap = await readCodeMap(snapshot, { git: async (args, options) => { seen.push(args); return runGit(args, options); } });
  // The place's tracked files that match an ignore pattern listed once (none here: no call more), then one call a
  // token, none naming the start commit.
  assert.deepEqual(seen[0], IGNORED_TRACKED_ARGS);
  assert.equal(seen.length, 1 + plainMap.tokens.length);
  assert.deepEqual(seen.slice(1).map((args) => args.slice(-3)), plainMap.tokens.map((x) => [x.token, '--', ':/']));
  assert.ok(seen.every((args) => !args.includes(snapshot.base.commit)));
  // A repository whose settings would print columns and full names: the map is the same.
  repo.git(['config', 'grep.column', 'true']);
  repo.git(['config', 'grep.fullName', 'true']);
  repo.git(['config', 'grep.patternType', 'perl']);
  assert.equal(JSON.stringify(await readCodeMap(await snapshotOf(repo))), JSON.stringify(plainMap));
});

test('D157: every bound is a count and every cut is counted: common names, files, tokens a hunk, calls a review, long lines', async (t) => {
  const repo = await repository(t, { more: { 'sub/min.js': `${'x'.repeat(300)} widgetTotal\n` } });
  const snapshot = await snapshotOf(repo);
  const full = await readCodeMap(snapshot);
  const tokenCount = full.tokens.length;
  // Outside the change, `parse` occurs 6 times; `widgetCount` 4 times in 3 files.
  const small = { ...CODE_MAP_LIMITS, occurrences: 4, files: 3, lineChars: 200 };
  const map = await readCodeMap(snapshot, { limits: small });
  const entry = (m, token) => m.tokens.find((x) => x.token === token);
  assert.deepEqual(entry(map, 'parse'), { token: 'parse', cut: 'common_name' });
  assert.equal(entry(map, 'widgetCount').edges.length, 4);
  assert.equal(map.cuts.common_name, 1);
  // By files alone: `widgetCount` in 3 files is over 2.
  const byFiles = await readCodeMap(snapshot, { limits: { ...CODE_MAP_LIMITS, files: 2 } });
  assert.equal(entry(byFiles, 'widgetCount').cut, 'common_name');
  // min.js holds `widgetTotal` on a 300-character line: no edge in it, counted once.
  assert.deepEqual(entry(map, 'widgetTotal').edges, []);
  assert.equal(map.cuts.long_lines, 1);
  assert.ok(!refsOf(map).some((r) => r.includes('min.js')));
  assert.ok(refsOf(full).some((r) => r.includes('min.js')));
  // Tokens a hunk: the first ones kept, the rest counted.
  const fewTokens = await readCodeMap(snapshot, { limits: { ...CODE_MAP_LIMITS, tokensPerHunk: 3 } });
  const parseHunk = fewTokens.hunks.find((h) => h.path === 'src/parse.js');
  assert.deepEqual([parseHunk.tokens, parseHunk.cuts], [['export', 'function', 'parse'], { token_cap: 9 }]);
  assert.equal(fewTokens.cuts.token_cap, 9);
  // Calls a review: the first asks fit, the rest not searched, counted once a token.
  const fewCalls = await readCodeMap(snapshot, { limits: { ...CODE_MAP_LIMITS, grepCalls: 5 } });
  assert.equal(fewCalls.calls.grep, 5);
  assert.equal(fewCalls.cuts.grep_cap, tokenCount - 5);
  assert.ok(fewCalls.tokens.slice(5).every((x) => x.cut === 'grep_cap'));
  assert.ok(fewCalls.tokens.slice(0, 5).every((x) => Array.isArray(x.edges)));
});

test('D157: a failed call, an output over a call\'s bound, an occurrence the file does not hold, a place the review writes', async (t) => {
  const repo = await repository(t, { more: { 'sub/.sonah-state/report.json': '{"parse": 1}\n' } });
  const snapshot = await snapshotOf(repo);
  const asked = [];
  const git = async (args, options) => {
    if (!args.includes('grep')) return runGit(args, options);
    const token = args[args.indexOf('-e') + 1];
    asked.push(token);
    if (token === 'sep') return { ok: false, stdout: null };
    if (token === 'split') return { ok: false, stdout: null, overflow: true };
    // `widgetCount`: git names a line that does not hold it.
    if (token === 'widgetCount') return { ok: true, stdout: Buffer.from('src/app.js\x003\x00widgetCount\n') };
    return runGit(args, options);
  };
  const map = await readCodeMap({ ...snapshot, stateOmits: [join(repo.root, '.sonah-state')] }, { git });
  const entry = (token) => map.tokens.find((x) => x.token === token);
  assert.deepEqual([entry('sep').cut, map.cuts.grep_failed, map.calls.failed], ['grep_failed', 1, 1]);
  assert.equal(entry('split').cut, 'common_name');
  assert.deepEqual([entry('widgetCount').edges, map.cuts.edge_ungrounded], [[], 1]);
  // The state folder's file is no part of the repository: no edge, no cut.
  assert.ok(!refsOf(map).some((r) => r.includes('.sonah-state')));
  const unomitted = await readCodeMap(snapshot);
  assert.ok(refsOf(unomitted).some((r) => r.includes('.sonah-state')));
  // Each token asked once, in the plan's order.
  assert.deepEqual(asked, map.tokens.map((x) => x.token));
});

test('D157: the runaway guard drops the whole map, never a part of it', async (t) => {
  const repo = await repository(t);
  const snapshot = await snapshotOf(repo);
  let clock = 0;
  const now = () => clock;
  const git = async (args, options) => { clock += 40_000; return runGit(args, options); };
  const map = await readCodeMap(snapshot, { git, now, limits: { ...CODE_MAP_LIMITS, timeoutMs: 100_000 } });
  assert.deepEqual(map, { version: CODE_MAP_VERSION, limits: { ...CODE_MAP_LIMITS, timeoutMs: 100_000 },
    dropped: 'map_timeout', cuts: Object.fromEntries(CODE_MAP_CUTS.map((c) => [c, c === 'map_timeout' ? 1 : 0])) });
  // Each call is told the time left: the clock moves 1,000 ms a call, and each call's bound is the deadline less now.
  const timeouts = [];
  clock = 0;
  const timed = await readCodeMap(snapshot, { git: async (args, options) => { timeouts.push(options.timeout);
    clock += 1_000; return runGit(args, options); }, now });
  assert.equal(timed.dropped, undefined);
  assert.deepEqual(timeouts.sort((a, b) => b - a), timeouts.map((_, k) => CODE_MAP_LIMITS.timeoutMs - 1_000 * k));
  // A clock that steps back after the guard was seen past (a wall clock set back) still drops the whole map.
  let made = 0, jump = false;
  const stepping = await readCodeMap(snapshot, { git: async (args, options) => { made += 1; if (made === 3) jump = true;
    return runGit(args, options); }, now: () => { if (jump) { jump = false; return 400_000; } return 0; } });
  assert.equal(stepping.dropped, 'map_timeout');
});

test('D157: a snapshot with no repository is not searched; a recorded-edits base is searched as any; no root, no map', async (t) => {
  const repo = await repository(t);
  const snapshot = await snapshotOf(repo);
  assert.equal(await readCodeMap({ root: false, files: [] }), null);
  const noRepo = await readCodeMap({ ...snapshot, repository: false });
  assert.deepEqual([noRepo.places, noRepo.calls.grep], [[{ place: null, searched: false }], 0]);
  assert.ok(noRepo.hunks.find((h) => h.path === 'src/parse.js').tokens.length > 0, 'the tokens, with no search');
  assert.ok(noRepo.tokens.every((x) => x.edges === undefined && x.cut === undefined));
  const recorded = await readCodeMap({ ...snapshot, base: { ...snapshot.base, kind: 'recorded_edits', commit: undefined } });
  assert.equal(JSON.stringify(recorded), JSON.stringify(await readCodeMap(snapshot)));
});

test('D157: a file the change names through a link is the file git names: its own changed lines are inside the change, its other lines go by the change\'s name', async (t) => {
  const repo = await repository(t, { base: { ...BASE, 'tools/lib.js': 'keep = 1;\nexport const oldThing = 2;\n' },
    more: { 'tools/lib.js': 'keep = 1;\nexport const newThing = 2;\nnewThing + keep;\n' } });
  await symlink(repo.top, join(repo.holder, 'lnk'));
  const spelled = join(repo.holder, 'lnk', 'tools', 'lib.js');
  const linked = fixture.codeSession({ writes: [{ path: spelled, text: 'SYNTHETIC\n' }] });
  const snapshot = await readCodeSnapshot(linked, { root: repo.root, maxBytes: 4_000_000, recording: repo.recording });
  assert.ok(snapshot.files.some((f) => f.path === spelled), 'the change keeps the spelling through the link');
  const map = await readCodeMap(snapshot);
  const refs = refsOf(map);
  assert.deepEqual(refs.filter((r) => /^(newThing|oldThing) /.test(r)), []);
  assert.deepEqual(refs.filter((r) => r.startsWith('keep ')), [`keep ${spelled}:1`]);
});

test('D157: a working repository nested in another place of the change: each place its own search, names and classes', async (t) => {
  const holder = await mkdtemp(join(tmpdir(), 'sonah-d157-nest-'));
  t.after(() => rm(holder, { recursive: true, force: true }));
  const outer = join(holder, 'outer');
  const inner = join(outer, 'repo');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
    GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
    GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'pipe', env });
  const write = async (top, files) => { for (const [p, text] of Object.entries(files)) {
    await mkdir(join(top, p, '..'), { recursive: true }); await writeFile(join(top, p), text); } };
  await write(outer, { '.gitignore': 'repo/\n', 'README.md': 'outerThing is here\n', 'notes.md': 'see outerThing\n' });
  git(outer, ['init', '-q', '-b', 'main']); git(outer, ['add', '-A']); git(outer, ['commit', '-q', '-m', 'outer']);
  await write(inner, BASE);
  git(inner, ['init', '-q', '-b', 'main']); git(inner, ['add', '-A']); git(inner, ['commit', '-q', '-m', 'inner']);
  await write(inner, AFTER);
  await write(outer, { 'README.md': 'outerThing was here\n' });
  const recording = join(holder, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n`);
  const nested = fixture.codeSession({ writes: [{ path: join(outer, 'README.md'), text: 'SYNTHETIC\n' }] });
  const snapshot = await readCodeSnapshot(nested, { root: join(inner, 'sub'), maxBytes: 4_000_000, recording });
  const realOuter = await realpath(outer);
  assert.deepEqual(snapshot.base.places.map((p) => [p.at, p.kind]), [[realOuter, 'git']]);
  const map = await readCodeMap(snapshot);
  assert.deepEqual(map.places, [{ place: null, searched: true }, { place: realOuter, searched: true }]);
  const refs = refsOf(map);
  // The working repository's own occurrences, by its names.
  assert.deepEqual(refs.filter((r) => r.startsWith('parse ')), ['parse ../docs/guide.md:1 copy', 'parse src/app.js:1',
    'parse src/app.js:2', 'parse src/new-use.js:1', 'parse test/parse.test.js:1', 'parse test/parse.test.js:2']);
  // The outer place's own, by absolute names and its own classes; its changed line inside the change.
  assert.deepEqual(refs.filter((r) => r.startsWith('outerThing ')), [`outerThing ${realOuter}/notes.md:1 copy`]);
  assert.equal(map.cuts.edge_ungrounded, 0);
  // A place of recorded edits that is a repository is searched as any.
  const recorded = await readCodeMap({ ...snapshot, base: { ...snapshot.base, places: snapshot.base.places
    .map((p) => ({ at: p.at, kind: 'recorded_edits', repository: true, written: p.written })) } });
  assert.equal(JSON.stringify(recorded), JSON.stringify(map));
  // A place that is no repository is not searched, and its asks cost nothing: a bound of exactly the searched asks
  // leaves none of them out.
  const folder = { ...snapshot, base: { ...snapshot.base, places: snapshot.base.places
    .map((p) => ({ at: p.at, kind: 'recorded_edits', written: p.written })) } };
  const searchedAsks = map.tokens.filter((x) => x.place === undefined).length;
  const bounded = await readCodeMap(folder, { limits: { ...CODE_MAP_LIMITS, grepCalls: searchedAsks } });
  assert.deepEqual(bounded.places, [{ place: null, searched: true }, { place: realOuter, searched: false }]);
  assert.deepEqual([bounded.calls.grep, bounded.cuts.grep_cap], [searchedAsks, 0]);
  assert.ok(bounded.tokens.filter((x) => x.place === realOuter).every((x) => x.edges === undefined && x.cut === undefined));
});

test('D157: a place the review writes that holds the working directory is never left out; the call bound at an exact fit', async (t) => {
  const repo = await repository(t);
  const snapshot = await snapshotOf(repo);
  const plainMap = await readCodeMap(snapshot);
  for (const holds of [repo.top, repo.root]) {
    assert.equal(JSON.stringify(await readCodeMap({ ...snapshot, stateOmits: [holds] })), JSON.stringify(plainMap), holds);
  }
  const cost = plainMap.tokens.length;
  const exact = await readCodeMap(snapshot, { limits: { ...CODE_MAP_LIMITS, grepCalls: cost } });
  assert.deepEqual([exact.calls.grep, exact.cuts.grep_cap], [cost, 0]);
  const short = await readCodeMap(snapshot, { limits: { ...CODE_MAP_LIMITS, grepCalls: cost - 1 } });
  assert.deepEqual([short.calls.grep, short.cuts.grep_cap], [cost - 1, 1]);
});

test('D157: a tracked file that matches an ignore pattern is searched by name: under an ignored folder, by an ignored glob, a name read literally; one call more a token, counted in the bound', async (t) => {
  const base = { ...BASE, '.gitignore': 'sub/ignored/\ndist/\n.env*\n' };
  const repo = await repository(t, { base });
  // Tracked although ignored: added by force before the session.
  await mkdir(join(repo.top, 'dist'), { recursive: true });
  await writeFile(join(repo.top, 'dist', 'bundle.js'), 'parse("bundled");\nreparse();\n');
  await writeFile(join(repo.top, 'dist', '[id].js'), 'parse("bracketed");\n');
  await writeFile(join(repo.top, 'dist', 'i.js'), 'parse("untracked and ignored");\n');
  await writeFile(join(repo.top, '.env.example'), 'PARSE=parse\n');
  // Each name literal (`:(literal)`): git 2.50 and later read `[id]` in a pathspec as a glob, which would add dist/i.js.
  repo.git(['add', '-f', '--', ':(literal)dist/bundle.js', ':(literal)dist/[id].js', ':(literal).env.example']);
  repo.git(['commit', '-q', '-m', 'tracked though ignored']);
  const snapshot = await snapshotOf(repo);
  const seen = [];
  const map = await readCodeMap(snapshot, { git: async (args, options) => { seen.push(args); return runGit(args, options); } });
  assert.deepEqual(map.places, [{ place: null, searched: true, ignored: 3 }]);
  assert.deepEqual(refsOf(map).filter((r) => r.startsWith('parse ')), ['parse ../.env.example:1', 'parse ../dist/[id].js:1',
    'parse ../dist/bundle.js:1', 'parse ../docs/guide.md:1 copy', 'parse src/app.js:1', 'parse src/app.js:2',
    'parse src/new-use.js:1', 'parse test/parse.test.js:1', 'parse test/parse.test.js:2']);
  // A whole word there too: `reparse` is no occurrence.
  assert.equal(map.cuts.edge_ungrounded, 0);
  // Two calls a token: the walk, and the named files (a run), each name literal.
  assert.equal(map.calls.grep, 2 * map.tokens.length);
  assert.deepEqual(seen.find((args) => args.includes('parse') && !args.includes(':/')),
    grepPathsArgs('parse', ['../.env.example', '../dist/[id].js', '../dist/bundle.js']));
  assert.ok(grepPathsArgs('x', ['a b/[c].js']).includes(':(literal)a b/[c].js'));
  // Counted in the call bound: two a token.
  const tight = await readCodeMap(snapshot, { limits: { ...CODE_MAP_LIMITS, grepCalls: 5 } });
  assert.deepEqual([tight.calls.grep, tight.cuts.grep_cap], [4, map.tokens.length - 2]);
});

const memoryStore = () => ({ lock: async () => async () => {}, saveReport: async () => {} });
const review = async (snapshot, options = {}) => {
  const seen = [];
  const { report } = await reviewCodePass({ session: session(), report: {}, snapshot, answerCache: null,
    store: memoryStore(), backend: 'claude-cli', ...options, judge: async (request) => { seen.push(request);
      return fixture.codeJudge({ review: () => ({ findings: [], questions: [] }) })(request); } });
  const { session: omitted, ...saved } = report;
  return { report, saved, seen };
};

test('D157: off by default, nothing is read and no request or record byte moves; on, the record keeps the map and no request byte, page or report text moves', async (t) => {
  const repo = await repository(t);
  const snapshot = await snapshotOf(repo);
  let reads = 0;
  const readMap = async (s) => { reads += 1; return readCodeMap(s); };
  const absent = await review(snapshot, { readMap });
  const off = await review(snapshot, { codeMap: false, readMap });
  assert.equal(reads, 0);
  const strip = (r) => JSON.stringify(r, (k, v) => (k === 'answers' ? undefined : v));
  assert.equal(strip(off.saved), strip(absent.saved));
  assert.equal(absent.saved.codePass.map, undefined);
  const on = await review(snapshot, { codeMap: true, readMap });
  assert.equal(reads, 1);
  assert.equal(on.saved.codePass.map.version, CODE_MAP_VERSION);
  // Every request the same bytes, map on or off.
  assert.deepEqual(on.seen.map((r) => JSON.stringify(r)), absent.seen.map((r) => JSON.stringify(r)));
  // The record moves by the map alone; no reader shows it.
  const { map, ...rest } = on.saved.codePass;
  assert.equal(strip({ ...on.saved, codePass: rest }), strip(absent.saved));
  const sandbox = repo.holder;
  assert.equal(renderSessionPage(session(), on.report, { folder: sandbox }),
    renderSessionPage(session(), absent.report, { folder: sandbox }));
  assert.equal(renderReportMarkdown(session(), on.report), renderReportMarkdown(session(), absent.report));
  // A code step that does not run reads no map.
  const gated = await review({ ...snapshot, gate: 'code_step_backend' }, { codeMap: true, readMap });
  assert.equal([reads, gated.saved.codePass.map].join(), '1,');
});
