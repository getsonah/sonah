// D157: the code map, its pure part. For each hunk of the change (the hunk ledger, code-pass.js `hunkLedger`: the one
// hunk identity), the identifier tokens its changed rows hold; and, from what git grep found for each token (cli
// code-map.js `readCodeMap`), the token's occurrences outside the change in the repository as it is now, each an edge
// kept only when the token is found as a whole word at that line of the file as Sonah reads it. An index for the
// review agents to read: it gates nothing, no reader shows it, and it holds no score, rank or tier, only counts. Every
// bound is a count (CODE_MAP_LIMITS), every cut a closed reason with a count (ledger.js CODE_MAP_CUTS). No clock, no
// network, no model: the same change and the same occurrences give the same map, byte for byte.
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { hunkLedger } from './code-pass.js';
import { changedSpans } from './code-context.js';
import { CODE_MAP_CUTS } from './ledger.js';
import { MATERIALITY_RULES } from './materiality.js';

/** D157: the map's format. /2 (the owner's call, 2026-10-27): the repository as it is now alone, no start-commit side;
 *  so a token's entry holds its edges with no side, and the hash is over (place, name, line, token). */
export const CODE_MAP_VERSION = 'sonah.code-map/2';
/** D157: the path classes an occurrence's file may carry: materiality.js's own rules of those names, in that order of
 *  precedence, over the file's path from its repository's top folder. A file neither names is unclassed. Closed. */
export const CODE_MAP_CLASSES = Object.freeze(['config', 'copy']);
/**
 * D157: the code map's frozen literals. Counts, never a clock, but the runaway guard.
 *   tokensPerHunk  the most distinct tokens one hunk is searched for (the rest: `token_cap`)
 *   grepCalls      the most git grep calls one review makes, one a token (the tokens past them: `grep_cap`)
 *   occurrences    the most occurrences outside the change a token may have (over it: `common_name`)
 *   files          the most files outside the change a token may occur in (over it: `common_name`)
 *   lineChars      the longest line an occurrence may lie on: a file with one longer gives no edge (`long_lines`)
 *   callBytes      the most bytes one git grep call may print (over it: `common_name`, since that many bytes hold more
 *                  occurrences than `occurrences` allows)
 *   fileBytes      the largest file read to ground an edge (a larger one grounds none: `edge_ungrounded`)
 *   inFlight       the most git grep calls at once
 *   timeoutMs      the runaway guard: past it, the whole map is dropped (`map_timeout`), never a part of it kept
 */
export const CODE_MAP_LIMITS = Object.freeze({ tokensPerHunk: 48, grepCalls: 1_000, occurrences: 100, files: 25,
  lineChars: 2_000, callBytes: 4 * 1024 * 1024, fileBytes: 2 * 1024 * 1024, inFlight: 4, timeoutMs: 300_000 });

const [COMMON_NAME, TOKEN_CAP, GREP_CAP, GREP_FAILED, LONG_LINES, LINES_UNKNOWN, EDGE_UNGROUNDED, MAP_TIMEOUT]
  = CODE_MAP_CUTS;
const list = (v) => (Array.isArray(v) ? v : []);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** git grep's word characters (`-w`, under LC_ALL=C): ASCII letters, digits and the underscore. */
const WORD_CHAR = /[A-Za-z0-9_]/;
const WORD_RUN = /[A-Za-z0-9_]+/g;
const isWordChar = (c) => typeof c === 'string' && WORD_CHAR.test(c);

/**
 * D157: the identifier tokens of a text: each maximal run of git grep's word characters that does not open with a
 * digit, once, in the order of its first occurrence. Comments and strings are not told apart: a token is a token
 * wherever it stands. Pure.
 */
export function identifierTokens(text) {
  const tokens = [];
  const seen = new Set();
  for (const [run] of String(text ?? '').matchAll(WORD_RUN)) {
    if (/^[0-9]/.test(run) || seen.has(run)) continue;
    seen.add(run);
    tokens.push(run);
  }
  return tokens;
}

/** D157: whether `line` holds `token` as a whole word (no word character either side of it), by string search. Pure. */
export function holdsWord(line, token) {
  if (typeof line !== 'string' || typeof token !== 'string' || !token) return false;
  for (let at = line.indexOf(token); at >= 0; at = line.indexOf(token, at + 1)) {
    if (!isWordChar(line[at - 1]) && !isWordChar(line[at + token.length])) return true;
  }
  return false;
}

/** The texts of a hunk's changed rows (added and removed, in their order); a recorded write of the whole file, the
 *  lines it wrote. */
function changedTexts(file, hunk) {
  if (hunk?.whole === true) {
    if (typeof file?.text !== 'string' || !Number.isSafeInteger(hunk.newStart) || !Number.isSafeInteger(hunk.newCount))
      return [];
    return file.text.split('\n').slice(hunk.newStart - 1, hunk.newStart - 1 + hunk.newCount);
  }
  return list(hunk?.rows).filter((r) => plain(r) && (r.type === '+' || r.type === '-') && typeof r.text === 'string')
    .map((r) => r.text);
}

/**
 * D157: what the code map searches for, from a frozen snapshot's files (`freezeCodeSnapshot`): `{ hunks, asks, changed,
 * names, root, top, places }`.
 *   hunks    one entry per entry of the hunk ledger, in its order: `{ id, path, place?, tokens }`, `tokens` the
 *            identifier tokens of the hunk's changed rows (`identifierTokens`), at most `tokensPerHunk`, `cut` how many
 *            more it held; a file whose hunks cannot be shown keeps its ledger entry, `closed`, with no token
 *   asks     every distinct token of a place, once: the first token of each hunk in the ledger's order, then the second
 *            of each, and so on, so a review's call bound spreads over its hunks; `{ place, token }` (`place` null for
 *            the working folder's repository)
 *   changed  each file of the change by its real absolute name (`real`, the caller's: the names git's occurrences
 *            resolve to): the lines its hunks changed on the new side, as code-context.js `changedSpans` gives them:
 *            an occurrence on one is inside the change
 *   unknown  each file of the change, by the same name, whose changed lines are not known (true): a file whose hunks
 *            cannot be shown (a closed ledger entry); a recorded edit Sonah could not place in the file now (a whole
 *            write with no start line, or an added row with no line). An occurrence there may be inside the change: it
 *            gives no edge (`lines_unknown`)
 *   names    each file of the change by the same name: the name the change gives it
 * `root` is the working directory (its real path; a relative name with no `real` entry is read from it), `top` the
 * repository's top folder, `places` the other places' top folders. Pure.
 */
export function codeMapPlan(files, { root = null, top = null, places = [], real = {}, limits = CODE_MAP_LIMITS } = {}) {
  const all = list(files).filter(plain);
  const byPath = new Map(all.map((f) => [f.path, f]));
  const absOf = (path) => (plain(real) && typeof real[path] === 'string' ? real[path]
    : isAbsolute(path) || typeof root !== 'string' ? path : resolve(root, path));
  const hunks = hunkLedger(all).map((entry) => {
    const named = { id: entry.id, path: entry.path, ...(typeof entry.place === 'string' ? { place: entry.place } : {}) };
    if (typeof entry.closed === 'string') return { ...named, closed: entry.closed, tokens: [] };
    const file = byPath.get(entry.path);
    const found = identifierTokens(changedTexts(file, list(file?.hunks)[entry.at]).join('\n'));
    const tokens = found.slice(0, limits.tokensPerHunk);
    return { ...named, tokens, ...(found.length > tokens.length ? { cut: found.length - tokens.length } : {}) };
  });
  const asks = [];
  const asked = new Set();
  const most = hunks.reduce((n, h) => Math.max(n, h.tokens.length), 0);
  for (let rank = 0; rank < most; rank++) {
    for (const h of hunks) {
      const token = h.tokens[rank];
      if (token === undefined) continue;
      const key = `${h.place ?? ''}\0${token}`;
      if (asked.has(key)) continue;
      asked.add(key);
      asks.push({ place: h.place ?? null, token });
    }
  }
  const changed = {}, names = {}, unknown = {};
  const closed = new Set(hunks.filter((h) => typeof h.closed === 'string').map((h) => h.path));
  const unplaced = (h) => (h?.whole === true ? !Number.isSafeInteger(h.newStart)
    : list(h?.rows).some((r) => plain(r) && r.type === '+' && !Number.isSafeInteger(r.new)));
  for (const f of all) {
    if (typeof f.path !== 'string') continue;
    changed[absOf(f.path)] = changedSpans(list(f.hunks)).new;
    names[absOf(f.path)] = f.path;
    if (closed.has(f.path) || list(f.hunks).some(unplaced)) unknown[absOf(f.path)] = true;
  }
  return { hunks, asks, changed, unknown, names, root, top,
    places: list(places).filter((p) => typeof p === 'string' && isAbsolute(p)) };
}

/**
 * D157: the occurrences `git grep -n -o -z` printed (`text`): each record `<name>\0<line>\0<match>\n`.
 * `{ occurrences: [{ name, line, token }], malformed }`: a record not in that shape, or whose match is not `token`, is
 * counted (`malformed`), never read. Pure.
 */
export function grepOccurrences(text, token) {
  const occurrences = [];
  let malformed = 0;
  const source = typeof text === 'string' ? text : '';
  let at = 0;
  while (at < source.length) {
    const nameEnd = source.indexOf('\0', at);
    const lineEnd = nameEnd < 0 ? -1 : source.indexOf('\0', nameEnd + 1);
    const end = lineEnd < 0 ? -1 : source.indexOf('\n', lineEnd + 1);
    if (end < 0) { malformed += 1; break; }
    const name = source.slice(at, nameEnd);
    const line = Number(source.slice(nameEnd + 1, lineEnd));
    const match = source.slice(lineEnd + 1, end);
    at = end + 1;
    if (!name || !Number.isSafeInteger(line) || line < 1 || match !== token) { malformed += 1; continue; }
    occurrences.push({ name, line, token });
  }
  return { occurrences, malformed };
}

const inSpans = (spans, line) => list(spans).some(([from, to]) => line >= from && line <= to);
const insidePlace = (path, place) => path === place || path.startsWith(place.endsWith('/') ? place : `${place}/`);
const zeroCuts = () => Object.fromEntries(CODE_MAP_CUTS.map((cut) => [cut, 0]));

/**
 * D157: the occurrences that can become edges, from what each ask's search found (`found[i]`, for `plan.asks[i]`:
 * `{ state: 'ok', occurrences: [{ path, line }] }` with each `path` absolute, or `{ state: 'overflow' }` (more than a
 * call may print), `{ state: 'failed' }`, `{ state: 'unasked' }` (the call bound ran out); absent for a place not
 * searched). An occurrence in a place the review itself writes (`omit`, absolute) is no part of the repository; one in a
 * file of the change whose changed lines are not known (`plan.unknown`) is dropped, counted by place and file
 * (`lines_unknown`); one on a line the change changed is inside it. A token whose occurrences outside the change (each
 * match, two on one line two) are more than `occurrences`, or lie in more than `files` files, gives none
 * (`common_name`). `{ tokens: [{ place, token, found? }], reads: { '<place>\0<path>': [lines] }, cuts }` (`place` ''
 * for the working folder's repository: the place whose search found it), `found` `{ occurrences: [[path, line]] }` or
 * `{ cut }`. Pure.
 */
export function codeMapCandidates(plan, found, { limits = CODE_MAP_LIMITS, omit = [] } = {}) {
  const cuts = zeroCuts();
  cuts[TOKEN_CAP] = list(plan?.hunks).reduce((n, h) => n + (Number.isSafeInteger(h.cut) ? h.cut : 0), 0);
  const omitted = list(omit).filter((p) => typeof p === 'string' && isAbsolute(p));
  const reads = new Map();
  const unknownFiles = new Set();
  const tokens = list(plan?.asks).map((ask, at) => {
    const named = { place: ask.place, token: ask.token };
    const r = found?.[at];
    if (!plain(r)) return named;
    if (r.state === 'unasked') { cuts[GREP_CAP] += 1; return { ...named, found: { cut: GREP_CAP } }; }
    if (r.state === 'failed') { cuts[GREP_FAILED] += 1; return { ...named, found: { cut: GREP_FAILED } }; }
    if (r.state !== 'ok') { cuts[COMMON_NAME] += 1; return { ...named, found: { cut: COMMON_NAME } }; }
    const inRepository = list(r.occurrences).filter((o) => plain(o) && typeof o.path === 'string'
      && !omitted.some((p) => insidePlace(o.path, p)));
    // A file of the change whose changed lines are not known: no occurrence there is outside it.
    const unknown = (o) => plan.unknown?.[o.path] === true;
    for (const o of inRepository.filter(unknown)) unknownFiles.add(`${ask.place ?? ''}\0${o.path}`);
    const outside = inRepository.filter((o) => !unknown(o) && !inSpans(plan.changed?.[o.path], o.line));
    const fileCount = new Set(outside.map((o) => o.path)).size;
    if (outside.length > limits.occurrences || fileCount > limits.files) {
      cuts[COMMON_NAME] += 1; return { ...named, found: { cut: COMMON_NAME } };
    }
    const occurrences = [...new Map(outside.map((o) => [`${o.path}\0${o.line}`, [o.path, o.line]])).values()]
      .sort((a, b) => byText(a[0], b[0]) || a[1] - b[1]);
    for (const [path, line] of occurrences) {
      const key = `${ask.place ?? ''}\0${path}`;
      if (!reads.has(key)) reads.set(key, new Set());
      reads.get(key).add(line);
    }
    return { ...named, found: { occurrences } };
  });
  cuts[LINES_UNKNOWN] = unknownFiles.size;
  return { tokens, cuts, reads: Object.fromEntries([...reads].sort(([a], [b]) => byText(a, b))
    .map(([key, lines]) => [key, [...lines].sort((a, b) => a - b)])) };
}

/** The name an edge's file goes by: the change's own name for a file of the change, else its path from the working
 *  directory in the working folder's repository, else (another place) its absolute path. */
function nameOf(plan, path, place) {
  if (typeof plan.names?.[path] === 'string') return plan.names[path];
  return place === null && typeof plan.root === 'string' ? relative(plan.root, path) : path;
}
/** A file's class (CODE_MAP_CLASSES), by materiality.js's rule of that name over its path from its place's top folder;
 *  null when neither names it. */
function classOf(plan, path, place) {
  const from = place === null ? plan.top : place;
  const named = typeof from === 'string' && isAbsolute(path) ? relative(from, path) : path;
  return CODE_MAP_CLASSES.find((cls) => MATERIALITY_RULES[cls].test(named.replace(/\\/g, '/'))) ?? null;
}

/**
 * D157: the code map, from the plan, the candidates and the lines read to ground them (`lines['<place>\0<path>']`,
 * keyed as the candidates' reads: each candidate line's text, by its number, or null for a file Sonah could not read). A
 * file holding a candidate on a line longer than `lineChars` gives no edge, for any token (`long_lines`, counted by
 * file); every other candidate is an edge when its token stands as a whole word at that line (`holdsWord`), else it is
 * dropped (`edge_ungrounded`). The record:
 *   { version, limits, places, hunks, tokens, classes, cuts, calls, hash }
 * `hunks` the plan's (`id`, `path`, `place`, `tokens`, and `cuts.token_cap` when it held more); `tokens` one entry for
 * each ask, `{ token, place?, edges?, cut? }`: `edges` `[[name, line], …]` (by name, then line) when its place was
 * searched, or its `cut`; `classes` each named file's class; `cuts` every CODE_MAP_CUTS member's count; `calls` git
 * grep's calls made and failed; `hash` SHA-256 over the sorted edges (place, name, line, token), so the same repository
 * state gives the same hash. Pure.
 */
export function codeMapOf(plan, candidates, lines, { limits = CODE_MAP_LIMITS, calls = { grep: 0, failed: 0 },
  places = [] } = {}) {
  const cuts = { ...zeroCuts(), ...(plain(candidates?.cuts) ? candidates.cuts : {}) };
  const keyOf = (place, path) => `${place ?? ''}\0${path}`;
  const textOf = (key, line) => {
    const file = plain(lines) ? lines[key] : null;
    return plain(file) && typeof file[line] === 'string' ? file[line] : null;
  };
  // A file with a candidate on a line over `lineChars`: no edge in it.
  const longFiles = new Set();
  for (const [key, numbers] of Object.entries(plain(candidates?.reads) ? candidates.reads : {})) {
    if (list(numbers).some((n) => (textOf(key, n) ?? '').length > limits.lineChars)) longFiles.add(key);
  }
  cuts[LONG_LINES] = longFiles.size;
  const classes = new Map();
  const edgeLines = [];
  const tokens = list(candidates?.tokens).map(({ place, token, found }) => {
    const entry = { token, ...(place !== null ? { place } : {}) };
    if (!plain(found)) return entry;
    if (typeof found.cut === 'string') return { ...entry, cut: found.cut };
    const edges = [];
    for (const [path, line] of list(found.occurrences)) {
      const key = keyOf(place, path);
      if (longFiles.has(key)) continue;
      if (!holdsWord(textOf(key, line), token)) { cuts[EDGE_UNGROUNDED] += 1; continue; }
      const name = nameOf(plan, path, place);
      edges.push([name, line]);
      const cls = classOf(plan, path, place);
      if (cls !== null) classes.set(name, cls);
      edgeLines.push(JSON.stringify([place ?? '', name, line, token]));
    }
    return { ...entry, edges: edges.sort((a, b) => byText(a[0], b[0]) || a[1] - b[1]) };
  });
  const hunks = list(plan?.hunks).map(({ cut, ...h }) => ({ ...h, ...(Number.isSafeInteger(cut)
    ? { cuts: { [TOKEN_CAP]: cut } } : {}) }));
  return { version: CODE_MAP_VERSION, limits, places: list(places), hunks, tokens,
    classes: Object.fromEntries([...classes].sort(([a], [b]) => byText(a, b))), cuts,
    calls: { grep: calls.grep, failed: calls.failed },
    hash: createHash('sha256').update(edgeLines.sort(byText).join('\n')).digest('hex') };
}

/** D157: the map dropped whole by its runaway guard (`map_timeout`): no hunk, no token, no edge, no hash. Pure. */
export function droppedCodeMap({ limits = CODE_MAP_LIMITS } = {}) {
  return { version: CODE_MAP_VERSION, limits, dropped: MAP_TIMEOUT, cuts: { ...zeroCuts(), [MAP_TIMEOUT]: 1 } };
}

/**
 * D157: the reference list of one hunk of a map (`id`, its hunk ledger id): for each of its tokens, in its order, each
 * edge, `{ token, path, line, class? }`. An index, never a verdict: none for a dropped map, an unknown hunk or a token
 * with no edge. Pure.
 */
export function codeMapReferences(map, id) {
  if (!plain(map) || typeof map.dropped === 'string') return [];
  const hunk = list(map.hunks).find((h) => h?.id === id);
  if (!hunk) return [];
  const byKey = new Map(list(map.tokens).map((t) => [`${t.place ?? ''}\0${t.token}`, t]));
  const refs = [];
  for (const token of list(hunk.tokens)) {
    const entry = byKey.get(`${hunk.place ?? ''}\0${token}`);
    for (const [path, line] of list(entry?.edges)) {
      const cls = plain(map.classes) ? map.classes[path] : undefined;
      refs.push({ token, path, line, ...(typeof cls === 'string' ? { class: cls } : {}) });
    }
  }
  return refs;
}
