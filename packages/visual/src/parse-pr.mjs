// parse-pr.mjs: what a parser adds to the code layer for JavaScript, TypeScript, Python and Go. Git still gives the
// files, roles, groups, diff rows, the route and the numbers (extract.mjs); this module gives, where a grammar exists:
//  - spans: each definition's exact lines (its doc comment and decorators included) and its owner, as extract's spans;
//    a function holding a nested one is one unit (the nested one is listed as "changed inside"); a class or an object
//    value is a container whose methods are units of their own;
//  - calls among the changed functions (in place of word mentions), resolved by parse-calls.mjs and never guessed;
//  - callers (resolved, outside the function), the PR's tests within TEST_HOPS calls, and existing test files that call
//    a changed function directly;
//  - impact: unchanged source definitions that call a changed function (1 hop, resolved), those that may run an
//    override, a 2-hop count, and calls by a name several definitions share (counted, never drawn).
// git objects only (ls-tree, cat-file); never checks out. Deterministic: same objects, same facts.
import { familyOf, grammarOf, GRAMMAR_BY_EXT, loadFamilies, parseFile } from './parse-tree.mjs';
import { buildGraph } from './parse-calls.mjs';

export const STRICT = Object.freeze(new Set(['scope', 'import', 'class', 'unique', 'typed'])); // resolved by binding, a declared type, or a name defined once
const MAY_RUN = 'dispatch'; // an override in a subclass of the class a call resolved to
const MAX_BYTES = 1_000_000; // a source blob bigger than this (a bundle, generated code) is not parsed
// A repository with more grammar-covered files or source bytes than these is parsed in part: the changed files, and
// the files that name a definition the diff touches as a whole word (one git grep), within the same caps. Its counts
// beyond the diff are then lower bounds ("at least"), and no function is said to have no test. The caps keep the code
// layer bounded on a laptop whatever the repository's size; repositories under them (Sonah's own, 685 files and 16 MB,
// among them) are parsed whole, as before.
export const WHOLE_FILES = 3000;
export const WHOLE_BYTES = 20_000_000;
const TEST_HOPS = 4; // how far back a test may reach a changed function through calls
const LIST_CAP = 10; // callers listed per function (the count is whole)
const TESTS_LISTED = 5; // existing test files listed per function (the count is whole)
const IMPACT_LISTED = 300; // unchanged callers listed in facts.impact (every count is whole)
const ABSORB = new Set(['function', 'method', 'callback']); // a definition nested in one of these is part of it
const KIND = Object.freeze({ function: 'callable', method: 'callable', callback: 'callable', class: 'definition',
  type: 'definition', value: 'value' }); // extract's kinds

/** The families (js, py, go) a grammar covers among these paths. */
export function familiesOf(paths) {
  return [...new Set(paths.map(familyOf).filter(Boolean))].sort();
}
export { grammarOf };

function lsTree(git, rev) {
  const rows = [];
  for (const rec of git(['ls-tree', '-r', '-z', '-l', rev]).split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [, type, sha, size] = rec.slice(0, tab).split(/\s+/);
    if (type === 'blob') rows.push({ path: rec.slice(tab + 1), sha, size: Number(size) });
  }
  return rows;
}

function blobsBySha(git, shas) {
  const out = new Map();
  const want = [...new Set(shas)];
  if (!want.length) return out;
  const buf = git(['cat-file', '--batch'], { input: Buffer.from(want.join('\n') + '\n') });
  let at = 0;
  while (at < buf.length) {
    const nl = buf.indexOf(10, at);
    if (nl < 0) break;
    const [sha, type, size] = buf.subarray(at, nl).toString('utf8').split(' ');
    if (type === 'missing') { at = nl + 1; continue; }
    const n = Number(size);
    out.set(sha, buf.subarray(nl + 1, nl + 1 + n).toString('utf8'));
    at = nl + 1 + n + 1;
  }
  return out;
}

// The paths at `sha` that a grammar covers and that hold a whole-word, fixed-string match of any of these names.
function namingFiles(git, sha, names) {
  if (!names.length) return new Set();
  const specs = Object.keys(GRAMMAR_BY_EXT).map((e) => `*.${e}`);
  const out = git(['grep', '-l', '-z', '-w', '-F', '-I', ...names.flatMap((n) => ['-e', n]), sha, '--', ...specs], { ok: [0, 1] });
  return new Set(String(out).split('\0').filter(Boolean).map((x) => x.slice(x.indexOf(':') + 1)));
}

// The names of the definitions (and the ones around them) that hold any of these lines: what the grep looks for.
function namesAt(f, lines) {
  const names = new Set();
  const list = [...lines];
  f.defs.forEach((d, i) => {
    if (!list.some((n) => n >= d.docStart && n <= d.end)) return;
    for (let q = i; q >= 0; q = f.defs[q].parent) if (f.defs[q].name && /^[\w$]+$/.test(f.defs[q].name)) names.add(f.defs[q].name);
  });
  return names;
}

// The first rows that fit the caps, in the given order.
function capped(rows, caps) {
  const out = [];
  let bytes = 0;
  for (const r of rows) {
    if (out.length >= caps.files || bytes + r.size > caps.bytes) break;
    out.push(r); bytes += r.size;
  }
  return out;
}

/**
 * The head commit's call graph for these families: every file a grammar covers is parsed (up to MAX_BYTES each), or,
 * past WHOLE_FILES or WHOLE_BYTES, the changed files and those naming a definition the diff touches (changed: path ->
 * Set of changed head lines; the names of the definitions holding them, and of their enclosing ones, as whole words).
 * caps: { files, bytes } (tests pass smaller ones). Returns { graph, parsed: Map(path -> parsed file), lines, partial }.
 */
export async function headGraph(git, sha, families, { changed = new Map(), caps = { files: WHOLE_FILES, bytes: WHOLE_BYTES } } = {}) {
  await loadFamilies(families);
  const fams = new Set(families);
  const tree = lsTree(git, sha);
  const src = tree.filter((r) => fams.has(familyOf(r.path)) && r.size <= MAX_BYTES);
  const aux = tree.filter((r) => /(^|\/)package\.json$/.test(r.path) || /(^|\/)tsconfig[^/]*\.json$/.test(r.path)
    || /(^|\/)go\.mod$/.test(r.path));
  const partial = src.length > caps.files || src.reduce((s, r) => s + r.size, 0) > caps.bytes;
  const files = new Map();
  let parse = src;
  let first = new Map();
  if (partial) {
    const mine = src.filter((r) => changed.has(r.path));
    first = blobsBySha(git, mine.map((r) => r.sha));
    const names = new Set();
    for (const r of mine) {
      const p = parseFile(r.path, first.get(r.sha) ?? '');
      if (!p) continue;
      files.set(r.path, p);
      for (const n of namesAt(p, changed.get(r.path))) names.add(n);
    }
    const named = namingFiles(git, sha, [...names].sort());
    parse = capped([...mine, ...src.filter((r) => !changed.has(r.path) && named.has(r.path))], caps);
  }
  const texts = blobsBySha(git, [...parse.filter((r) => !files.has(r.path)), ...aux].map((r) => r.sha));
  for (const [k, v] of first) texts.set(k, v);
  // parsed in path order whichever way they were picked, so the graph is built the same way each time
  const parsed = new Map();
  for (const r of [...parse].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const p = files.get(r.path) ?? parseFile(r.path, texts.get(r.sha) ?? '');
    if (p) parsed.set(r.path, p);
  }
  const pick = (re) => new Map(aux.filter((r) => re.test(r.path)).map((r) => [r.path, texts.get(r.sha) ?? '']));
  const graph = buildGraph(parsed, { packageJson: pick(/package\.json$/), tsconfig: pick(/tsconfig[^/]*\.json$/), gomod: pick(/go\.mod$/) });
  const shaOf = new Map(parse.map((r) => [r.path, r.sha]));
  const lineCache = new Map();
  const lines = (path) => {
    if (!lineCache.has(path)) lineCache.set(path, (texts.get(shaOf.get(path)) ?? '').split('\n'));
    return lineCache.get(path);
  };
  return { graph, parsed, lines, partial };
}

/** One file's text parsed (a base side, or a file outside the graph). */
export function parseText(path, text) { return parseFile(path, text ?? ''); }

// The unit a definition belongs to: its outermost enclosing function, method or callback, else itself.
export function unitIndex(f, i) { return unitIndexOf(f, i); }
function unitIndexOf(f, i) {
  let unit = i;
  for (let p = i; p >= 0; p = f.defs[p].parent) if (ABSORB.has(f.defs[p].kind)) unit = p;
  return unit;
}

/**
 * A parsed file's units as extract's spans: { line, text, name, kind, owner, start, end, ranges, side, pair, def,
 * quiet }. ranges: the unit's lines minus its member units (a class's methods), trimmed of blank lines at their ends.
 * def: the unit's definition index. quiet: the file's comment and blank lines (a change only there is comment-only).
 */
export function unitSpans(f, lines) {
  if (!f) return [];
  const units = f.defs.map((d, i) => i).filter((i) => unitIndexOf(f, i) === i && f.defs[i].name);
  const isUnit = new Set(units);
  const quiet = new Set([...f.commentRows, ...f.blankRows]);
  const blank = (n) => !String(lines[n - 1] ?? '').trim();
  const spans = units.map((i) => {
    const d = f.defs[i];
    // member units: the nearest units below this one (a class's methods, an object value's functions)
    const members = units.filter((j) => j !== i && nearestUnitAbove(f, j, isUnit) === i).map((j) => f.defs[j]);
    let ranges = [[d.docStart, d.end]];
    for (const m of members.sort((a, b) => a.docStart - b.docStart)) {
      ranges = ranges.flatMap(([a, b]) => (m.end < a || m.docStart > b ? [[a, b]]
        : [[a, m.docStart - 1], [m.end + 1, b]]).filter(([x, y]) => x <= y));
    }
    ranges = ranges.map(([a, b]) => { while (a <= b && blank(a)) a++; while (b >= a && blank(b)) b--; return [a, b]; })
      .filter(([a, b]) => a <= b);
    if (!ranges.length) ranges = [[d.line, d.line]];
    return { line: d.line, text: lines[d.line - 1] ?? '', name: d.name, kind: KIND[d.kind] ?? 'callable', owner: d.owner ?? null,
      start: ranges[0][0], end: ranges.at(-1)[1], ranges, side: null, pair: null, def: i, quiet };
  });
  return spans.sort((a, b) => a.start - b.start || a.line - b.line);
}

function nearestUnitAbove(f, j, isUnit) {
  for (let p = f.defs[j].parent; p >= 0; p = f.defs[p].parent) if (isUnit.has(p)) return p;
  return -1;
}

/** line -> the innermost definition whose lines (doc comment included) hold it, or -1. */
export function innermostAt(f) {
  const own = new Int32Array(f.lines + 2).fill(-1);
  const order = f.defs.map((d, i) => i).sort((a, b) => (f.defs[b].end - f.defs[b].docStart) - (f.defs[a].end - f.defs[a].docStart) || a - b);
  for (const i of order) { const d = f.defs[i]; for (let l = d.docStart; l <= d.end && l < own.length; l++) own[l] = i; }
  return own;
}

/** Names of the nested definitions inside unit `unit` that hold one of these lines (the "changed inside" list). */
export function nestedNames(f, unit, lineNos) {
  if (!f) return [];
  const own = innermostAt(f);
  const hit = new Map();
  for (const n of lineNos) {
    const i = own[n] ?? -1;
    if (i < 0 || i === unit || unitIndexOf(f, i) !== unit) continue;
    for (let p = i; p >= 0 && p !== unit; p = f.defs[p].parent) {
      const d = f.defs[p];
      if (ABSORB.has(d.kind) && d.kind !== 'callback' && d.name && !hit.has(p)) hit.set(p, d);
    }
  }
  return [...hit.values()].sort((a, b) => a.line - b.line).map((d) => d.name);
}

/**
 * The graph facts of the changed functions that came from parsed spans.
 * fns: facts functions with `unit` (the head graph id of their unit) set for live parsed ones.
 * changedPaths: every path changed in the range. roleOf: extract's path role. alsoChanged: unit ids the diff touches in
 * files that kept git's spans (never drawn as unchanged callers).
 * Returns { mentions, byFn: Map(fn -> { callers, tests, existingTests, impact }), impact }.
 */
export function graphFacts({ head, fns, changedPaths, roleOf, alsoChanged = new Set() }) {
  const G = head.graph;
  const at = new Map(); // definition id -> [parsed file, index]
  for (const f of G.files.values()) f.ids.forEach((id, i) => at.set(id, [f, i]));
  const unitCache = new Map();
  const unitOf = (id) => { // a definition id (or a file's top level) -> its unit's id
    if (unitCache.has(id)) return unitCache.get(id);
    const hit = at.get(id);
    const out = hit ? hit[0].ids[unitIndexOf(hit[0], hit[1])] : id;
    unitCache.set(id, out);
    return out;
  };
  const pathOf = (id) => id.slice(0, id.indexOf('#'));
  const fnByUnit = new Map(fns.filter((fn) => fn.unit).map((fn) => [fn.unit, fn]));
  const order = new Map(fns.map((fn, i) => [fn, i]));

  // every edge between units, by kind of resolution
  const into = new Map(); // unit -> [{ from: unit, how, kind, path, line }]
  for (const e of G.edges) {
    if (!STRICT.has(e.how) && e.how !== MAY_RUN) continue;
    const from = unitOf(e.from), to = unitOf(e.to);
    if (from === to) continue;
    (into.get(to) ?? into.set(to, []).get(to)).push({ from, how: e.how, kind: e.kind, path: e.path, line: e.line });
  }
  const strictInto = (u) => (into.get(u) ?? []).filter((e) => STRICT.has(e.how));

  // calls among the changed functions: one mention per pair, call-shaped when any of its sites is a call
  const pairs = new Map();
  for (const [to, list] of into) {
    const b = fnByUnit.get(to);
    if (!b || b.status === 'removed') continue;
    for (const e of list) {
      if (!STRICT.has(e.how)) continue;
      const a = fnByUnit.get(e.from);
      if (!a || a === b) continue;
      const k = `${a.id}\0${b.id}`;
      const m = pairs.get(k) ?? pairs.set(k, { a, b, call: false }).get(k);
      if (e.kind === 'call') m.call = true;
    }
  }
  const mentions = [...pairs.values()].sort((x, y) => order.get(x.a) - order.get(y.a) || order.get(x.b) - order.get(y.b))
    .map(({ a, b, call }) => ({ from: a.id, to: b.id, onCodeLine: true, callShaped: call }));

  const defLine = (u) => {
    const d = G.defs.get(u);
    return d ? { line: d.line, text: head.lines(d.path)[d.line - 1] ?? '' } : null;
  };
  const isChanged = (u) => fnByUnit.has(u) || alsoChanged.has(u);
  const changedFile = (p) => changedPaths.has(p);
  const byFn = new Map();
  const quietFn = (fn) => fn.commentOnly || fn.blankOnly;
  const sources = fns.filter((fn) => fn.unit && fn.status !== 'removed' && !quietFn(fn) && roleOf(fn.path) === 'source'
    && (fn.kind === 'callable' || fn.kind === 'definition'));
  const sourceSet = new Set(sources);
  const ghosts = new Map(); // caller unit -> { strict: Set(fn) it calls, may: Set(fn) whose override it may run }
  const hop1Of = new Map(); // fn -> Set(caller unit)
  const directAll = new Set(); // unchanged test files that call a changed function directly
  for (const fn of fns.filter((x) => x.unit && x.status !== 'removed')) {
    const sites = strictInto(fn.unit);
    // callers: resolved sites outside the function, in files that are not tests
    const outside = sites.filter((e) => roleOf(e.path) !== 'test');
    const bySite = new Map();
    for (const e of outside) { const k = `${e.path}\0${e.line}`; if (!bySite.has(k)) bySite.set(k, e); }
    const siteList = [...bySite.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
    const callers = { count: siteList.length, list: siteList.slice(0, LIST_CAP)
      .map((e) => ({ path: e.path, line: e.line, in: e.from.endsWith('#<top>') ? null : defLine(e.from) })) };
    // tests: test files that reach it within TEST_HOPS calls; the PR's own ones, and unchanged ones that call it directly
    const hops = new Map([[fn.unit, 0]]); const todo = [fn.unit];
    while (todo.length) {
      const x = todo.shift(); const k = hops.get(x);
      if (k >= TEST_HOPS) continue;
      for (const e of strictInto(x)) if (!hops.has(e.from)) { hops.set(e.from, k + 1); todo.push(e.from); }
    }
    const testFiles = new Set(); const direct = new Set();
    for (const [u, k] of hops) {
      if (u === fn.unit) continue;
      const p = pathOf(u);
      if (roleOf(p) !== 'test') continue;
      if (changedFile(p)) testFiles.add(p);
      else if (k === 1) direct.add(p);
    }
    for (const p of direct) directAll.add(p);
    const existing = [...direct].sort();
    const out = { callers, tests: [...testFiles].sort(), existingTests: { count: existing.length, list: existing.slice(0, TESTS_LISTED) } };
    if (sourceSet.has(fn)) {
      const hop1 = new Set();
      for (const e of sites) {
        if (isChanged(e.from) || roleOf(pathOf(e.from)) !== 'source') continue;
        hop1.add(e.from);
        (ghosts.get(e.from) ?? ghosts.set(e.from, { strict: new Set(), may: new Set() }).get(e.from)).strict.add(fn);
      }
      const may = new Set();
      for (const e of into.get(fn.unit) ?? []) {
        if (e.how !== MAY_RUN || hop1.has(e.from) || isChanged(e.from) || roleOf(pathOf(e.from)) !== 'source') continue;
        may.add(e.from);
        (ghosts.get(e.from) ?? ghosts.set(e.from, { strict: new Set(), may: new Set() }).get(e.from)).may.add(fn);
      }
      hop1Of.set(fn, hop1);
      out.impact = { callers: hop1.size, mayRun: may.size, hop2: 0, byName: 0 };
    }
    byFn.set(fn, out);
  }
  // two hops: unchanged source units that call a 1-hop caller
  const allHop1 = new Set([...hop1Of.values()].flatMap((s) => [...s]));
  const hop2All = new Set();
  for (const [fn, hop1] of hop1Of) {
    const two = new Set();
    for (const u of hop1) for (const e of strictInto(u)) {
      if (isChanged(e.from) || allHop1.has(e.from) || roleOf(pathOf(e.from)) !== 'source') continue;
      two.add(e.from); hop2All.add(e.from);
    }
    byFn.get(fn).impact.hop2 = two.size;
  }
  // calls by a name several definitions share: counted on each changed candidate, never drawn
  const unitFn = (id) => { const fn = fnByUnit.get(unitOf(id)); return fn && sourceSet.has(fn) ? fn : null; };
  let byName = 0;
  for (const a of G.ambiguous) {
    const from = unitOf(a.from);
    if (isChanged(from) || roleOf(a.path) !== 'source') continue;
    const hit = new Set(a.cands.map(unitFn).filter(Boolean));
    for (const fn of hit) byFn.get(fn).impact.byName++;
    if (hit.size) byName++;
  }
  const nameOf = (u) => {
    if (u.endsWith('#<top>')) return { name: '(top level)', owner: null, line: 0, kind: 'top' };
    const d = G.defs.get(u);
    const own = d.parentId ? G.defs.get(d.parentId)?.name ?? null : d.owner ?? null;
    return { name: d.name, owner: own, line: d.line, kind: KIND[d.kind] ?? 'callable' };
  };
  // a caller that calls a changed function is listed with those calls; one that only may run an override, with those
  const callers = [...ghosts].map(([u, g]) => ({ id: u, path: pathOf(u), ...nameOf(u), calls: [...(g.strict.size ? g.strict : g.may)]
    .sort((a, b) => order.get(a) - order.get(b)).map((fn) => fn.id), may: !g.strict.size }))
    .sort((a, b) => (a.may === b.may ? 0 : a.may ? 1 : -1) || b.calls.length - a.calls.length
      || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line) || (a.id < b.id ? -1 : 1));
  const impact = { callers: callers.slice(0, IMPACT_LISTED), total: callers.length, hop2: hop2All.size, byName,
    existingTestFiles: directAll.size, ...(head.partial ? { partial: true } : {}) };
  return { mentions, byFn, impact };
}
