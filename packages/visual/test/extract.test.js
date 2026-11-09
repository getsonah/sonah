// Layer 1: the extract, on a small repository built here (every rule, any machine) and on real commits when present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extract, gitEnv } from '../src/extract.mjs';
import { wasmBytes } from '../src/parse-tree.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The real commits are this repository's own (the package is two folders down), unless another checkout is named;
// without their history (a shallow clone, an export without history) those tests skip. The Python commit is in a
// repository of its own (graphiti), run only when SONAH_TEST_REPO_PY names a checkout of it.
const SONAH = process.env.SONAH_TEST_REPO ?? join(ROOT, '..', '..');
const PYREPO = process.env.SONAH_TEST_REPO_PY ?? null;

const hasCommit = (repo, sha) => {
  if (!repo || !existsSync(repo)) return false;
  try { execFileSync('git', ['-C', repo, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; }
};

// Every row of every function's own diff is the line git has at that number, and its counts are its rows.
function assertRowsTrue(repo, facts) {
  const cache = new Map();
  const lines = (rev, path) => {
    const k = `${rev}:${path}`;
    if (!cache.has(k)) cache.set(k, execFileSync('git', ['-C', repo, 'cat-file', 'blob', k], { encoding: 'utf8', maxBuffer: 1 << 30 }).split('\n'));
    return cache.get(k);
  };
  const oldPath = new Map(facts.files.map((f) => [f.path, f.oldPath ?? f.path]));
  let checked = 0;
  for (const fn of facts.functions) {
    // the whole body, when given, holds every row of the cut diff, in order, and the same changed lines
    if (fn.body) {
      const key = (r) => JSON.stringify(r);
      const all = fn.body.map(key);
      let at = 0;
      for (const r of fn.diff.filter((x) => x[0] !== '~')) { at = all.indexOf(key(r), at); assert.ok(at >= 0, `${fn.id}: diff row in body`); }
      assert.equal(fn.body.filter((r) => r[0] === '+').length, fn.added, `${fn.id}: body added`);
      assert.equal(fn.body.filter((r) => r[0] === '-').length, fn.removed, `${fn.id}: body removed`);
    }
    let plus = 0; let minus = 0;
    for (const [op, o, n, text] of fn.diff) {
      assert.ok(['+', '-', ' ', '~'].includes(op), `${fn.id}: op ${op}`);
      if (op === '~') { assert.equal(o, null); assert.equal(n, null); continue; }
      if (op !== '-') { assert.equal(lines(facts.range.head, fn.path)[n - 1], text, `${fn.id}: head line ${n}`); checked++; }
      if (op !== '+') { assert.equal(lines(facts.range.base, oldPath.get(fn.path))[o - 1], text, `${fn.id}: base line ${o}`); checked++; }
      if (op === '+') { plus++; assert.equal(o, null); }
      if (op === '-') { minus++; assert.equal(n, null); }
    }
    assert.equal(plus, fn.added, `${fn.id}: added`);
    assert.equal(minus, fn.removed, `${fn.id}: removed`);
    if (fn.status !== 'removed') assert.equal(lines(facts.range.head, fn.path)[fn.line - 1], fn.definition, `${fn.id}: definition`);
  }
  return checked;
}

// Every listed caller's line names the function, and its enclosing function line is git's line at that number.
function assertCallersTrue(repo, facts) {
  const cache = new Map();
  const lines = (path) => {
    if (!cache.has(path)) cache.set(path, execFileSync('git', ['-C', repo, 'cat-file', 'blob', `${facts.range.head}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 30 }).split('\n'));
    return cache.get(path);
  };
  // (a constructor is called by its class's name, or a subclass's: its caller's line holds a call)
  const CTOR = new Set(['__init__', 'constructor', '__new__']);
  for (const fn of facts.functions) {
    const word = new RegExp(`(?<![A-Za-z0-9_])${fn.name.replace(/\$/g, '\\$')}(?![A-Za-z0-9_])`);
    for (const c of fn.callers.list) {
      const line = lines(c.path)[c.line - 1];
      assert.ok(word.test(line) || (CTOR.has(fn.name) && /[A-Za-z0-9_$]\s*\(/.test(line)), `${fn.id}: caller ${c.path}:${c.line}`);
      if (c.in) {
        assert.equal(lines(c.path)[c.in.line - 1], c.in.text, `${fn.id}: enclosing line of ${c.path}:${c.line}`);
        // at or below its function line, or in the comment or decorator lines just above it (they are the function's)
        if (c.in.line > c.line) {
          for (let k = c.line; k < c.in.line; k++) assert.match(lines(c.path)[k - 1], /^\s*[/*#@]/, `${fn.id}: ${c.path}:${c.line} above its function`);
        }
      }
    }
  }
}

// The contract's shape, and the invariants that hold for any PR.
function assertShape(facts) {
  assert.equal(facts.v, 1);
  assert.equal(typeof facts.repo.name, 'string');
  assert.match(facts.range.base, /^[0-9a-f]{40}$/);
  assert.match(facts.range.head, /^[0-9a-f]{40}$/);
  for (const c of facts.range.commits) assert.deepEqual(Object.keys(c), ['sha', 'subject', 'body']);
  const ids = facts.functions.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const fn of facts.functions) {
    // the parser adds, where a grammar covers the file: the changed nested names, existing tests and impact
    assert.deepEqual(Object.keys(fn), ['id', 'path', 'name', 'owner', 'kind', 'status', 'line', 'span', 'oldLine', 'added',
      'removed', 'definition', 'commentOnly', 'diff', ...(fn.body ? ['body'] : []), 'callers', 'tests', 'fold',
      ...(fn.nested ? ['nested'] : []), ...(fn.existingTests ? ['existingTests'] : []), ...(fn.impact ? ['impact'] : [])]);
    if (fn.nested) assert.ok(fn.nested.length > 0 && fn.nested.every((x) => typeof x === 'string' && x));
    if (fn.existingTests) {
      assert.deepEqual(Object.keys(fn.existingTests), ['count', 'list']);
      assert.ok(fn.existingTests.list.length <= fn.existingTests.count);
      for (const p of fn.existingTests.list) assert.ok(!fn.tests.includes(p), `${fn.id}: an existing test is not one this PR changed`);
    }
    if (fn.impact) assert.deepEqual(Object.keys(fn.impact), ['callers', 'mayRun', 'hop2', 'byName']);
    assert.ok(fn.owner === null || (typeof fn.owner === 'string' && fn.owner.length > 0));
    assert.ok(fn.id === `${fn.path}#${fn.name}` || fn.id.startsWith(`${fn.path}#${fn.name}~`), fn.id);
    assert.ok(['new', 'changed', 'removed'].includes(fn.status));
    assert.ok([null, 'value', 'comment-only', 'tiny'].includes(fn.fold));
    assert.equal(fn.fold === 'comment-only', fn.commentOnly);
    if (fn.fold === null) assert.ok(fn.kind !== 'value' && fn.added + fn.removed > 2);
    assert.deepEqual(Object.keys(fn.callers), ['count', 'list']);
    assert.ok(fn.callers.list.length <= fn.callers.count);
  }
  for (const f of facts.files) {
    assert.ok(['source', 'test', 'fixture', 'docs', 'record', 'config'].includes(f.role), `${f.path}: ${f.role}`);
    assert.ok(['added', 'modified', 'renamed', 'deleted'].includes(f.status));
    for (const id of f.functions) assert.ok(ids.includes(id));
  }
  const byId = new Set(ids);
  for (const m of facts.mentions) { assert.ok(byId.has(m.from)); assert.ok(byId.has(m.to)); }
  const routed = [...facts.route.read, ...facts.route.skim, ...facts.route.skip].map((r) => r.path).sort();
  assert.deepEqual(routed, facts.files.map((f) => f.path).sort(), 'every file is on the route once');
  assert.deepEqual(facts.groups.flatMap((g) => g.files).sort(), facts.files.map((f) => f.path).sort(), 'every file in one group');
  assert.equal(facts.stats.functions, facts.functions.length);
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(JSON.stringify(facts)), 'no clock reading in the facts');
}

// ---------- a small repository, built here ----------

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'sonah-extract-test-'));
  const empty = join(dir, '.gitconfig-empty');
  writeFileSync(empty, '');
  let tick = 0;
  const git = (...args) => execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], {
    cwd: join(dir, 'r'), encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: empty, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_AUTHOR_DATE: `2026-01-01T00:00:0${tick}Z`, GIT_COMMITTER_DATE: `2026-01-01T00:00:0${tick}Z` },
  });
  const put = (path, text) => { const p = join(dir, 'r', path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
  const commit = (subject, body = '') => { tick++; git('add', '-A'); git('commit', '-q', '-m', subject, ...(body ? ['-m', body] : [])); return git('rev-parse', 'HEAD').trim(); };
  mkdirSync(join(dir, 'r'));
  git('init', '-q');
  return { dir, repo: join(dir, 'r'), git, put, commit };
}

const A_JS_1 = `// Adds one.
export function foo(x) {
  const a = x + 1;
  return a;
}

export const LIMIT = 3;

function bar(y) {
  return y * 2;
}

function qux() {
  const unused = 0;
  return unused;
}

/** Old comment. */
function keep(z) {
  return z;
}
`;
const A_JS_2 = `// Adds one.
export function foo(x) {
  const a = x + 1;
  const b = a * 3;
  log(b);
  return a + b;
}

export const LIMIT = 4;

function bar(y) {
  return y * 3;
}

/** New comment. */
function keep(z) {
  return z;
}

export function baz(n) {
  if (n > LIMIT) return foo(n);
  const m = n - 1;
  return bar(m);
}
`;
const B_PY_1 = `class Box:
    def outer(self, x):
        y = x + 1

        def inner(z):
            return z * 2

        total = inner(y)
        return total


class First:
    def __init__(self):
        self.a = 1


class Second:
    def __init__(self):
        self.b = 2
`;
const B_PY_2 = B_PY_1.replace('        total = inner(y)\n', '        total = inner(y) + 1\n');
const B_PY_3 = B_PY_2.replace('        self.a = 1\n', '        self.a = 10\n        self.c = 3\n')
  .replace('        self.b = 2\n', '        self.b = 20\n        self.d = 4\n');
const MOVED = `export function moved(v) {\n  const w = v;\n  return w;\n}\n`;
const C_TS_1 = `import type {
  Thing,
} from './types';

export class Store {
  private items: Thing[] = [];

  add(item: Thing): void {
    this.items.push(item);
  }

  async flush(
    limit: number,
  ): Promise<number> {
    const n = this.items.length;
    return n;
  }
}
`;
const C_TS_2 = C_TS_1.replace('  Thing,\n', '  Thing,\n  Other,\n')
  .replace('    this.items.push(item);\n', '    if (!item) return;\n    this.items.push(item);\n    this.items.sort();\n')
  .replace('    const n = this.items.length;\n', '    const n = Math.min(this.items.length, limit);\n    this.items = [];\n');
const TYPES_1 = 'export interface Thing {\n  id: string;\n}\n';
const TYPES_2 = 'export interface Thing {\n  id: string;\n  name: string;\n  size: number;\n  tags: string[];\n}\n';

function buildRepo() {
  const r = makeRepo();
  r.put('src/a.js', A_JS_1);
  r.put('src/b.py', B_PY_1);
  r.put('src/consts.js', 'export const ONE = 1;\nexport const TWO = 2;\n');
  r.put('src/old-name.js', MOVED);
  r.put('docs/notes.md', '# Notes\n\nFirst entry.\n');
  r.put('README.md', '# Title\n\nLine one.\nLine two.\n');
  r.put('test/a.test.js', "import { foo } from '../src/a.js';\ntest('foo', () => foo(1));\n");
  r.put('src/c.ts', C_TS_1);
  r.put('src/types.ts', TYPES_1);
  const c1 = r.commit('first');
  r.put('src/c.ts', C_TS_2);
  r.put('src/types.ts', TYPES_2);
  r.put('test/c.test.ts', "import { Store } from '../src/c';\ntest('store', () => new Store());\n");
  r.put('src/a.js', A_JS_2);
  r.put('src/b.py', B_PY_2);
  r.put('src/consts.js', 'export const ONE = 1;\nexport const TWO = 22;\n');
  rmSync(join(r.repo, 'src/old-name.js'));
  r.put('src/new-name.js', MOVED.replace('return w;', 'return w + 1;'));
  r.put('docs/notes.md', '# Notes\n\nFirst entry.\n\nSecond entry.\n');
  r.put('README.md', '# Title\n\nLine one, changed.\nLine two.\n');
  r.put('test/a.test.js', "import { foo, baz } from '../src/a.js';\ntest('foo', () => foo(1));\ntest('baz', () => baz(2));\n");
  const c2 = r.commit('second: the change', 'Why it is made.\n\nA second paragraph.');
  r.put('src/b.py', B_PY_3);
  const c3 = r.commit('third');
  return { ...r, c1, c2, c3 };
}

test('extract: every rule on a small repository built here', async () => {
  const r = buildRepo();
  try {
    const facts = await extract({ repoDir: r.repo, base: r.c1, head: r.c3 });
    assertShape(facts);
    assertRowsTrue(r.repo, facts);
    assertCallersTrue(r.repo, facts);
    const fn = (id) => facts.functions.find((f) => f.id === id);
    const file = (path) => facts.files.find((f) => f.path === path);

    // the range: base..head, its commits oldest first with subject and body
    assert.equal(facts.range.base, r.c1);
    assert.equal(facts.range.head, r.c3);
    assert.deepEqual(facts.range.commits.map((c) => [c.sha, c.subject, c.body]),
      [[r.c2, 'second: the change', 'Why it is made.\n\nA second paragraph.'], [r.c3, 'third', '']]);

    // functions: status, kind and fold, by structure alone
    assert.equal(fn('src/a.js#foo').status, 'changed');
    assert.equal(fn('src/a.js#foo').fold, null);
    assert.equal(fn('src/a.js#foo').span[0], 1, 'the comment just above belongs to the function');
    assert.equal(fn('src/a.js#LIMIT').kind, 'value');
    assert.equal(fn('src/a.js#LIMIT').fold, 'value');
    assert.equal(fn('src/a.js#bar').fold, 'tiny');
    assert.equal(fn('src/a.js#keep').fold, 'comment-only');
    assert.equal(fn('src/a.js#keep').commentOnly, true);
    assert.equal(fn('src/a.js#baz').status, 'new');
    assert.equal(fn('src/a.js#baz').oldLine, null);
    assert.equal(fn('src/a.js#qux').status, 'removed');
    assert.equal(fn('src/a.js#qux').line, null);
    assert.equal(fn('src/a.js#qux').span, null);
    assert.ok(fn('src/a.js#qux').diff.every((row) => row[0] === '-'));

    // Python: a nested def ends where code comes back to its indentation; the rest is the enclosing function's
    assert.equal(fn('src/b.py#outer').status, 'changed');
    assert.equal(fn('src/b.py#outer').added, 1);
    assert.equal(fn('src/b.py#inner'), undefined, 'the unchanged nested def is not given the outer change');
    // a name repeated in one file: path#name, then path#name~2
    assert.equal(fn('src/b.py#__init__').status, 'changed');
    assert.equal(fn('src/b.py#__init__~2').status, 'changed');
    assert.ok(fn('src/b.py#__init__').line < fn('src/b.py#__init__~2').line);

    // JavaScript and TypeScript (git has no driver): methods are functions of their own, with their class as owner,
    // also when the parameters run onto the next lines; "import type {" opens a list and is no function
    assert.equal(fn('src/c.ts#add').owner, 'Store');
    assert.equal(fn('src/c.ts#add').added, 2);
    assert.equal(fn('src/c.ts#flush').owner, 'Store');
    assert.deepEqual([fn('src/c.ts#flush').added, fn('src/c.ts#flush').removed], [2, 1]);
    assert.equal(fn('src/c.ts#Store'), undefined, 'the class itself did not change');
    assert.equal(fn('src/c.ts#type'), undefined);
    // the parser: a test that only builds the class reaches its constructor, not its other methods
    assert.deepEqual(fn('src/c.ts#add').tests, [], 'a test that only builds the class does not call add');
    assert.equal(fn('src/b.py#__init__').owner, 'First');
    assert.equal(fn('src/b.py#outer').owner, 'Box');
    assert.equal(fn('src/a.js#foo').owner, null);
    // a file whose only change is an interface is read, not skimmed
    assert.equal(fn('src/types.ts#Thing').kind, 'definition');

    // each function's own diff: context rows carry both numbers, gaps are "~"
    const foo = fn('src/a.js#foo');
    assert.ok(foo.diff.some((row) => row[0] === ' ' && row[1] !== null && row[2] !== null));
    assert.deepEqual(foo.diff.filter((row) => row[0] === '+').map((row) => row[3]), ['  const b = a * 3;', '  log(b);', '  return a + b;']);

    // mentions: call-shaped and on a code line
    const m = facts.mentions.find((x) => x.from === 'src/a.js#baz' && x.to === 'src/a.js#foo');
    assert.deepEqual(m, { from: 'src/a.js#baz', to: 'src/a.js#foo', onCodeLine: true, callShaped: true });
    const v = facts.mentions.find((x) => x.from === 'src/a.js#baz' && x.to === 'src/a.js#LIMIT');
    assert.equal(v.callShaped, false);

    // callers outside the function and outside tests; tests changed in the range that reach it
    assert.equal(fn('src/a.js#foo').callers.count, 1);
    assert.deepEqual(fn('src/a.js#foo').callers.list.map((c) => [c.path, c.in?.text]), [['src/a.js', 'export function baz(n) {']]);
    assert.deepEqual(fn('src/a.js#baz').tests, ['test/a.test.js']);
    assert.deepEqual(fn('src/a.js#bar').tests, ['test/a.test.js'], 'reached through baz, which the test names');
    assert.deepEqual(fn('src/a.js#keep').tests, []);
    assert.deepEqual(fn('src/a.js#LIMIT').tests, [], 'a value is mentioned, not called');

    // files: status, roles by path, language, the route
    assert.equal(file('src/new-name.js').status, 'renamed');
    assert.equal(file('src/a.js').status, 'modified');
    assert.equal(file('src/new-name.js').oldPath, 'src/old-name.js');
    assert.equal(file('docs/notes.md').role, 'record', 'a prose file only appended to');
    assert.equal(file('README.md').role, 'docs');
    assert.equal(file('test/a.test.js').role, 'test');
    assert.equal(file('src/a.js').lang, 'javascript');
    assert.equal(file('src/b.py').lang, 'python');
    const where = (path) => ['read', 'skim', 'skip'].find((k) => facts.route[k].some((x) => x.path === path));
    assert.equal(where('src/a.js'), 'read');
    assert.equal(where('src/consts.js'), 'skim', 'values only');
    assert.equal(where('src/types.ts'), 'read', 'a definition is read');
    assert.equal(where('test/a.test.js'), 'skim');
    assert.equal(where('docs/notes.md'), 'skip');
    assert.equal(facts.route.lines.read + facts.route.lines.skim + facts.route.lines.skip, facts.stats.added + facts.stats.removed);
    assert.deepEqual(facts.groups.map((g) => g.group), ['root', 'docs', 'src', 'test']);
    assert.equal(file('src/c.ts').lang, 'typescript');

    // the same objects and range give the same bytes
    assert.equal(JSON.stringify(await extract({ repoDir: r.repo, base: r.c1, head: r.c3 })), JSON.stringify(facts));
    // one commit as base^..head
    const one = await extract({ repoDir: r.repo, base: `${r.c3}^`, head: r.c3 });
    assert.deepEqual(one.range.commits.map((c) => c.subject), ['third']);
    assert.deepEqual(one.functions.map((f) => f.id), ['src/b.py#__init__', 'src/b.py#__init__~2']);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('extract: a PR range is diffed from where head left base', async () => {
  const r = buildRepo();
  try {
    // base moves on after the branch point: its own later change is not the PR's
    r.git('checkout', '-q', '-b', 'pr', r.c2);
    r.put('src/consts.js', 'export const ONE = 11;\nexport const TWO = 22;\n');
    const prHead = r.commit('pr change');
    const facts = await extract({ repoDir: r.repo, base: r.c3, head: prHead });
    assert.equal(facts.range.base, r.c2, 'the merge base');
    assert.deepEqual(facts.range.commits.map((c) => c.subject), ['pr change']);
    assert.deepEqual(facts.files.map((f) => f.path), ['src/consts.js']);
    assert.deepEqual(facts.functions.map((f) => f.id), ['src/consts.js#ONE']);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

// ---------- real commits ----------

test('extract: Sonah commit 5bcdc782 keeps the measured 37 of 37 functions', { skip: !hasCommit(SONAH, '5bcdc782') && 'commit not here' }, async () => {
  const t0 = process.hrtime.bigint();
  const facts = await extract({ repoDir: SONAH, base: '5bcdc782^', head: '5bcdc782' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assertShape(facts);
  const rows = assertRowsTrue(SONAH, facts);
  assertCallersTrue(SONAH, facts);
  // fixtures/ref/facts.json was written by hand for this commit; every function in it is found whole, with the same
  // line, status and counts. The parser keeps a returned object's methods and an inner function inside the function
  // that holds them, as the hand facts do (the inner ones are named as changed inside it).
  const ref = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'ref', 'facts.json'), 'utf8'));
  const byId = new Map(facts.functions.map((f) => [f.id, f]));
  const same = ref.functions.filter((f) => {
    const g = byId.get(`${f.file}#${f.name}`);
    return g && g.line === f.line && g.status === f.status && g.added === f.added && g.removed === f.removed;
  });
  assert.equal(same.length, ref.functions.length);
  assert.equal(ref.functions.length, 37);
  assert.deepEqual(facts.functions.filter((f) => f.owner).map((f) => `${f.owner}.${f.name}`), []);
  assert.deepEqual(byId.get('packages/cli/src/review-judge.js#callLocal').nested, ['scanReplyBegun', 'settle']);
  // folding leaves 35 of 47 boxes (the 10 others are values and comment-only changes, and 2 tiny ones)
  assert.equal(facts.functions.length, 47);
  assert.equal(facts.functions.filter((f) => f.fold === null).length, 35);
  assert.equal(facts.range.commits.length, 1);
  assert.equal(facts.stats.added, 1346);
  assert.equal(facts.stats.removed, 73);
  // the call edges the reference names between its functions, seen as code-line mentions: 46 of 48 (the 2 others go
  // through a function or an object passed in as a parameter), and no call the reference does not name
  const key = new Map(ref.functions.map((f) => [f.id, `${f.file}#${f.name}`]));
  const edges = new Set();
  for (const f of ref.functions) {
    for (const c of f.calls) if (key.has(c)) edges.add(`${key.get(f.id)}>${key.get(c)}`);
    for (const c of f.calledBy) if (key.has(c)) edges.add(`${key.get(c)}>${key.get(f.id)}`);
  }
  const seen = new Set(facts.mentions.filter((m) => m.onCodeLine).map((m) => `${m.from}>${m.to}`));
  assert.equal([...edges].filter((e) => seen.has(e)).length, 46);
  assert.equal(edges.size, 48);
  const refIds = new Set(key.values());
  const calls = facts.mentions.filter((m) => m.callShaped && refIds.has(m.from) && refIds.has(m.to)).map((m) => `${m.from}>${m.to}`);
  assert.deepEqual(calls.filter((e) => !edges.has(e)), [], 'no call the reference does not name');
  // impact: the 12 unchanged functions that call a changed one, exactly the ones the hand-built page drew
  assert.deepEqual(facts.impact.callers.filter((c) => !c.may).map((c) => c.id.split('/').pop()).sort(), ['code-review.js#runCodeReview',
    'doctor.js#doctor', 'prompt.js#reanchorRequest', 'prompt.js#recolumnRequest', 'prompt.js#restatusRequest',
    'review-judge.js#reviewApiBody', 'run-review.js#reviewWindow', 'session-review-command.js#runSessionReviewCommand',
    'session-review.js#boundedJudge', 'session-review.js#dryRunReplay', 'session-review.js#reviewCodePass',
    'session-review.js#reviewSession']);
  // existing tests: 29 test files the commit did not touch call runCodePass directly
  assert.equal(byId.get('packages/evidence/src/code-pass.js#runCodePass').existingTests.count, 29);
  assert.ok(rows > 1000);
  // a guard against a pathological slowdown, not a benchmark: the public suite runs its test files at once, and a busy
  // machine took 20 s here where an idle one takes about 2
  assert.ok(ms < 120_000, `took ${ms} ms`);
});

test('extract: a second Sonah commit and a three-commit range', { skip: !hasCommit(SONAH, '1e7d7da4') && 'commit not here' }, async () => {
  const one = await extract({ repoDir: SONAH, base: '1e7d7da4^', head: '1e7d7da4' });
  assertShape(one);
  assertRowsTrue(SONAH, one);
  assert.ok(one.functions.some((f) => f.status === 'removed'));
  assert.ok(one.functions.filter((f) => f.status === 'removed').every((f) => f.diff.every((row) => row[0] === '-')));
  const range = await extract({ repoDir: SONAH, base: '20be6999^', head: '1e7d7da4' });
  assertShape(range);
  assertRowsTrue(SONAH, range);
  assert.equal(range.range.commits.length, 3);
  assert.deepEqual(range.range.commits.map((c) => c.sha.slice(0, 8)), ['20be6999', '5bcdc782', '1e7d7da4']);
  const numstat = execFileSync('git', ['-C', SONAH, 'diff', '--numstat', '-M', '20be6999^', '1e7d7da4'], { encoding: 'utf8' })
    .trim().split('\n').map((l) => l.split('\t')).filter((p) => p[0] !== '-');
  assert.equal(range.stats.added, numstat.reduce((s, p) => s + Number(p[0]), 0));
  assert.equal(range.stats.removed, numstat.reduce((s, p) => s + Number(p[1]), 0));
});

test('extract: a Python commit (graphiti a200ff2)', { skip: !hasCommit(PYREPO, 'a200ff2')
  && 'no checkout of graphiti with a200ff2 named in SONAH_TEST_REPO_PY' }, async () => {
  const facts = await extract({ repoDir: PYREPO, base: 'a200ff2^', head: 'a200ff2' });
  assertShape(facts);
  assertRowsTrue(PYREPO, facts);
  assertCallersTrue(PYREPO, facts);
  assert.equal(facts.functions.length, 48);
  assert.ok(facts.functions.every((f) => !f.path.endsWith('.py') || facts.files.find((x) => x.path === f.path).lang === 'python'));
  // a call through a typed client may run each client's override: those callers are kept apart, as "may run"
  assert.ok(facts.impact.callers.some((c) => c.may) && facts.impact.callers.some((c) => !c.may));
  assert.equal(JSON.stringify(await extract({ repoDir: PYREPO, base: 'a200ff2^', head: 'a200ff2' })), JSON.stringify(facts));
});


// ---------- the parser's complement (JavaScript, TypeScript, Python, Go) ----------

function buildParsedRepo() {
  const r = makeRepo();
  r.put('src/core.js', "export function load(path) {\n  const parse = (t) => t.trim();\n  return parse(path);\n}\n\nexport function save(v) {\n  return v;\n}\n");
  r.put('src/app.js', "import { load, save } from './core.js';\n\nexport function main(p) {\n  // load( in a comment is no call\n  return save(load(p));\n}\n\nexport function other() {\n  return main('x');\n}\n");
  r.put('test/core.test.js', "import { load } from '../src/core.js';\ntest('load', () => load('a'));\n");
  r.put('src/broken.js', 'export function ok() {\n  return 1;\n}\nfunction (\n');
  r.put('src/kinds.ts', 'export interface Shape {\n  w: number;\n}\n\nexport function area(s: Shape) {\n  return s.w;\n}\n');
  r.put('src/m.go', 'package m\n\nfunc Add(a int, b int) int {\n\treturn a + b\n}\n\nfunc Use() int {\n\treturn Add(1, 2)\n}\n');
  r.put('src/p.py', 'class A:\n    def run(self):\n        return 1\n\n\nclass B(A):\n    def run(self):\n        return 2\n\n\ndef go(a: A):\n    return a.run()\n');
  const c1 = r.commit('first');
  r.put('src/core.js', "export function load(path) {\n  const parse = (t) => t.trim().toLowerCase();\n  return parse(path);\n}\n\nexport function save(v) {\n  log('load(x) failed');\n  return v;\n}\n");
  r.put('src/broken.js', 'export function ok() {\n  return 2;\n}\nfunction (\n');
  r.put('src/kinds.ts', 'export interface Shape {\n  w: number;\n  h: number;\n}\n\nexport function area(s: Shape) {\n  return s.w;\n}\n');
  r.put('src/m.go', 'package m\n\nfunc Add(a int, b int) int {\n\treturn a + b + 0\n}\n\nfunc Use() int {\n\treturn Add(1, 2)\n}\n');
  r.put('src/p.py', 'class A:\n    def run(self):\n        return 1\n\n\nclass B(A):\n    def run(self):\n        return 3\n\n\ndef go(a: A):\n    return a.run()\n');
  const c2 = r.commit('second');
  return { ...r, c1, c2 };
}

test('extract: the parser gives spans, calls, callers, tests and impact where a grammar exists', async () => {
  const r = buildParsedRepo();
  try {
    const facts = await extract({ repoDir: r.repo, base: r.c1, head: r.c2 });
    assertShape(facts);
    assertRowsTrue(r.repo, facts);
    assertCallersTrue(r.repo, facts);
    const fn = (id) => facts.functions.find((f) => f.id === id);
    // a nested function is part of the one that holds it, named as changed inside it
    assert.equal(fn('src/core.js#parse'), undefined);
    assert.deepEqual(fn('src/core.js#load').nested, ['parse']);
    // resolved callers outside the function: main calls it; a comment that names it is no call; the test is apart
    assert.deepEqual(fn('src/core.js#load').callers, { count: 1, list: [{ path: 'src/app.js', line: 5, in: { line: 3, text: 'export function main(p) {' } }] });
    assert.deepEqual(fn('src/core.js#load').tests, [], 'the PR changed no test that reaches it');
    assert.deepEqual(fn('src/core.js#load').existingTests, { count: 1, list: ['test/core.test.js'] });
    // impact: main calls it unchanged (1 hop), other calls main (2 hops)
    assert.deepEqual(fn('src/core.js#load').impact, { callers: 1, mayRun: 0, hop2: 1, byName: 0 });
    // a call's name inside a string is no call: the parser gives no mention where a word search would see one
    assert.equal(facts.mentions.some((m) => m.from === 'src/core.js#save' && m.to === 'src/core.js#load'), false);
    // a TypeScript interface is a definition to read; Go and Python have their own callers
    assert.equal(fn('src/kinds.ts#Shape').kind, 'definition');
    assert.deepEqual(fn('src/m.go#Add').impact, { callers: 1, mayRun: 0, hop2: 0, byName: 0 });
    // a call through a declared base type may run the changed override: kept apart, as "may run"
    assert.equal(fn('src/p.py#run').owner, 'B');
    assert.deepEqual(fn('src/p.py#run').impact, { callers: 0, mayRun: 1, hop2: 0, byName: 0 });
    const ghost = (id) => facts.impact.callers.find((c) => c.id === id);
    assert.deepEqual(ghost('src/app.js#main'), { id: 'src/app.js#main', path: 'src/app.js', name: 'main', owner: null, line: 3,
      kind: 'callable', calls: ['src/core.js#load', 'src/core.js#save'], may: false });
    assert.deepEqual(ghost('src/m.go#Use').calls, ['src/m.go#Add']);
    assert.deepEqual([ghost('src/p.py#go').calls, ghost('src/p.py#go').may], [['src/p.py#run'], true]);
    assert.equal(facts.impact.hop2, 1);
    assert.equal(facts.impact.existingTestFiles, 1);
    // a file that does not parse keeps git's spans, with no parser facts
    assert.equal(fn('src/broken.js#ok').status, 'changed');
    assert.equal(fn('src/broken.js#ok').impact, undefined);
    assert.equal(fn('src/broken.js#ok').existingTests, undefined);
    // the same objects and range give the same bytes
    assert.equal(JSON.stringify(await extract({ repoDir: r.repo, base: r.c1, head: r.c2 })), JSON.stringify(facts));
    // a change in a language no grammar covers has no impact facts at all
    r.put('lib/x.rb', 'def x\n  1\nend\n');
    const c3 = r.commit('ruby');
    r.put('lib/x.rb', 'def x\n  2\nend\n');
    const c4 = r.commit('ruby again');
    assert.equal((await extract({ repoDir: r.repo, base: c3, head: c4 })).impact, null);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('extract: a repository past the caps is parsed in part: the changed files and those naming what changed', async () => {
  const { headGraph, graphFacts, WHOLE_FILES, WHOLE_BYTES } = await import('../src/parse-pr.mjs');
  assert.ok(WHOLE_FILES >= 1000 && WHOLE_BYTES >= 1_000_000, 'frozen caps');
  const r = buildParsedRepo();
  try {
    const git = (args, { ok = [0], input = null } = {}) => {
      try {
        return execFileSync('git', ['-C', r.repo, ...args], { encoding: input === null ? 'utf8' : 'buffer', maxBuffer: 1 << 28,
          stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(input === null ? {} : { input }) });
      } catch (e) { if (ok.includes(e.status)) return e.stdout ?? ''; throw e; }
    };
    const sha = git(['rev-parse', r.c2]).trim();
    const lineOf = (path, text) => git(['show', `${sha}:${path}`]).split('\n').findIndex((l) => l.includes(text)) + 1;
    const changed = new Map([['src/core.js', new Set([lineOf('src/core.js', 'function load')])]]);
    const whole = await headGraph(git, sha, ['go', 'js', 'py'], { changed });
    assert.equal(whole.partial, false);
    const part = await headGraph(git, sha, ['go', 'js', 'py'], { changed, caps: { files: 3, bytes: 1_000_000 } });
    assert.equal(part.partial, true);
    // the changed file first, then those that name "load" as a word (its caller, its existing test), within 3 files
    const kept = [...part.parsed.keys()];
    assert.ok(kept.includes('src/core.js') && kept.includes('src/app.js'), kept.join(' '));
    assert.ok(kept.length <= 3 && kept.length < whole.parsed.size, `${kept.length} of ${whole.parsed.size}`);
    assert.deepEqual(kept, [...kept].sort(), 'in path order');
    // its counts beyond the diff say they are lower bounds; the same input gives the same graph
    const fns = [{ id: 'src/core.js#load', path: 'src/core.js', status: 'changed', kind: 'callable', unit: 'src/core.js#load' }];
    const g = graphFacts({ head: part, fns, changedPaths: new Set(['src/core.js']), roleOf: (p) => (p.startsWith('test/') ? 'test' : 'source') });
    assert.equal(g.impact.partial, true);
    assert.equal(graphFacts({ head: whole, fns, changedPaths: new Set(['src/core.js']), roleOf: (p) => (p.startsWith('test/') ? 'test' : 'source') }).impact.partial, undefined);
    const again = await headGraph(git, sha, ['go', 'js', 'py'], { changed, caps: { files: 3, bytes: 1_000_000 } });
    assert.deepEqual([...again.parsed.keys()], kept);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('extract: the vendored files are the pinned ones, unmodified, and every file in src is text', () => {
  const vendor = join(ROOT, 'src', 'vendor');
  const table = readFileSync(join(vendor, 'THIRD_PARTY.md'), 'utf8');
  const rows = [...table.matchAll(/^\| ([\w./-]+) \| [^|]+ \| ([0-9a-f]{64}) \|$/gm)].map((m) => [m[1], m[2]]);
  // every vendored file is listed with its sha256, and every listed file is there: no file is unlisted or left over
  const files = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
  const onDisk = files(vendor).map((p) => relative(vendor, p).split(sep).join('/'))
    .filter((p) => p !== 'THIRD_PARTY.md');
  assert.deepEqual(rows.map(([f]) => f).sort(), onDisk.sort());
  assert.equal(rows.length, 14);
  // a WebAssembly file is kept as gzip-compressed lowercase hex, 120 characters a line; its decoded bytes are the
  // upstream file, so its sha256 is checked on them (wasmBytes, as the parser loads it); every other file as it is
  const wasm = rows.filter(([f]) => f.endsWith('.wasm.gz.hex'));
  assert.equal(wasm.length, 6);
  for (const [file, sha] of rows) {
    const path = join(vendor, file);
    if (file.endsWith('.wasm.gz.hex')) {
      const lines = readFileSync(path, 'latin1').split('\n');
      assert.equal(lines.pop(), '', `${file} ends with a line break`);
      const last = lines.length - 1;
      assert.ok(lines.every((l, i) => /^[0-9a-f]+$/.test(l) && (i === last ? l.length <= 120 : l.length === 120)),
        `${file}: lowercase hex, 120 characters a line`);
      const bytes = wasmBytes(pathToFileURL(path));
      assert.deepEqual([...bytes.subarray(0, 4)], [0, 0x61, 0x73, 0x6d], `${file} decodes to WebAssembly`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, file);
    } else {
      assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), sha, file);
    }
  }
  for (const pkg of ['elkjs', 'web-tree-sitter', 'tree-sitter-javascript', 'tree-sitter-typescript', 'tree-sitter-python', 'tree-sitter-go']) {
    assert.ok(rows.some(([f]) => f.startsWith(`${pkg}/LICENSE`)), `${pkg} keeps its licence`);
  }
  // no file of the package's source holds a NUL byte or anything but UTF-8: the release audit admits text files only
  const src = files(join(ROOT, 'src'));
  assert.ok(src.length > 30);
  for (const p of src) {
    const bytes = readFileSync(p);
    assert.equal(bytes.includes(0), false, `${relative(ROOT, p)} holds a NUL byte`);
    assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes), relative(ROOT, p));
  }
});

test('extract: the parser runs with every network call made to throw', () => {
  const r = buildParsedRepo();
  try {
    const nonet = join(r.dir, 'nonet.cjs');
    writeFileSync(nonet, "const boom = (w) => () => { throw new Error('network used: ' + w); };\nglobalThis.fetch = boom('fetch');\n"
      + "for (const m of ['http', 'https']) { const x = require(m); x.request = boom(m); x.get = boom(m); }\n"
      + "const net = require('net'); net.connect = boom('net'); net.createConnection = boom('net');\nrequire('dns').lookup = boom('dns');\n");
    const script = `const { extract } = await import(${JSON.stringify(join(ROOT, 'src', 'extract.mjs'))});
const f = await extract({ repoDir: ${JSON.stringify(r.repo)}, base: ${JSON.stringify(r.c1)}, head: ${JSON.stringify(r.c2)} });
console.log(JSON.stringify({ n: f.functions.length, impact: f.impact.total }));`;
    const out = execFileSync(process.execPath, ['--require', nonet, '--input-type=module', '-e', script], { encoding: 'utf8' });
    const got = JSON.parse(out.trim().split('\n').pop());
    assert.ok(got.n > 0 && got.impact > 0, out);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('extract: calls made at once in a fresh process (two jobs) load the parser once and give the same facts', () => {
  const r = buildParsedRepo();
  try {
    // a fresh process, so the parser is not loaded yet when the calls start together
    const script = `const { extract } = await import(${JSON.stringify(join(ROOT, 'src', 'extract.mjs'))});
const range = { repoDir: ${JSON.stringify(r.repo)}, base: ${JSON.stringify(r.c1)}, head: ${JSON.stringify(r.c2)} };
const got = await Promise.allSettled([extract(range), extract(range), extract(range)]);
const one = await extract(range);
console.log(JSON.stringify(got.map((g) => (g.status === 'fulfilled' ? JSON.stringify(g.value) === JSON.stringify(one) : String(g.reason?.message)))));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), [true, true, true]);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('extract: git children get only the kept names of the parent, GIT_NO_LAZY_FETCH among them when it is set', () => {
  const parent = { PATH: '/usr/bin', HOME: '/h', GIT_NO_LAZY_FETCH: '1', GIT_DIR: '/elsewhere', SECRET_KEY: 'x' };
  assert.deepEqual(gitEnv({}, parent), { PATH: '/usr/bin', HOME: '/h', GIT_NO_LAZY_FETCH: '1' });
  assert.deepEqual(gitEnv({ LC_ALL: 'C' }, { PATH: '/usr/bin' }), { PATH: '/usr/bin', LC_ALL: 'C' });
});
