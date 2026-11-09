// extract.mjs: layer 1, the code layer. The facts of one PR (base..head): files, functions, each function's own diff,
// mentions, callers, tests, folding and the read route. Any repository, any language.
// git (rev-parse, merge-base, log, diff, cat-file, ls-tree, grep), and for JavaScript, TypeScript, Python and Go the
// vendored tree-sitter parser (parse-pr.mjs): exact spans and owners, calls in place of word mentions, resolved callers,
// tests, existing tests and impact. No network, no model, no installed package.
// Deterministic: the same repository objects and range give the same bytes (no clock or random value reaches the output).
//
// Every rule is structural and the same for any language (where a grammar covers a file, parse-pr.mjs gives its spans,
// calls, callers and tests instead):
//  - A "function line" is a line git's own userdiff driver for the file's extension takes as a hunk header (for
//    JavaScript and TypeScript, which git has no driver for, the patterns in JS_FUNCNAME; git's default rule for any
//    other language git has no driver for). Its span starts at the comment or decorator lines just
//    above it (lines that start with / * # or @) and runs to the line before the next span; blank lines at its end
//    are no one's. A nested (indented) definition ends where code comes back to its own indentation.
//  - A changed line belongs to the span that holds it: added lines by head's file, removed lines by the base's.
//  - A name is read from the function line by punctuation only (see nameOf).
//  - mentions: a changed function's name as a whole word inside another changed function's span at head.
//  - callers and tests: git grep at head; the enclosing function line is the one git prints with "=".
//  - roles by path structure only; the route by role.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { familiesOf, grammarOf, headGraph, parseText, unitSpans, nestedNames, graphFacts, innermostAt, unitIndex } from './parse-pr.mjs';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const LIST_CAP = 10; // callers listed per function (the count is whole)
const VIEW_CONTEXT = 3; // context lines kept around a change in a function's own diff
const GROUP_SPLIT = 8; // a file group with more files than this splits by its next directory
const TINY_LINES = 2; // a function with this many changed lines or fewer folds as "tiny"

// git's built-in userdiff drivers (gitattributes(5)), by file extension. Languages git has no driver for use its default rule.
const DRIVER_BY_EXT = Object.freeze({
  ada: 'ada', adb: 'ada', ads: 'ada', sh: 'bash', bash: 'bash', bib: 'bibtex', c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp',
  cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', cs: 'csharp', css: 'css', dts: 'dts', dtsi: 'dts', ex: 'elixir',
  exs: 'elixir', f: 'fortran', f90: 'fortran', f95: 'fortran', f03: 'fortran', fountain: 'fountain', go: 'golang',
  html: 'html', htm: 'html', java: 'java', kt: 'kotlin', kts: 'kotlin', md: 'markdown', markdown: 'markdown',
  m: 'objc', mm: 'objc', pas: 'pascal', pp: 'pascal', pl: 'perl', pm: 'perl', php: 'php', py: 'python', pyi: 'python',
  rb: 'ruby', rs: 'rust', scm: 'scheme', ss: 'scheme', rkt: 'scheme', tex: 'tex',
});

// Function lines for languages git has no driver for, as git userdiff patterns (gitattributes(5): one pattern per line,
// tried in order; a line matching a "!" pattern is not a function line). JavaScript and TypeScript keep git's default
// rule (a line that starts with a letter, "_" or "$") and add indented definitions: methods (with or without modifiers,
// on one line or with their parameters on the next lines), nested functions, and class fields set to an arrow function.
// A line that starts with a statement keyword, or a call that is handed a function, is never one. These are the languages' grammar, not words about meaning.
const JS_FUNCNAME = [
  '!^[ \t]*(if|else|for|while|do|switch|case|catch|try|finally|return|throw|await|new|yield|delete|typeof|void|break|continue|super|with)([^A-Za-z0-9_$]|$)',
  '!^[ \t]+[A-Za-z_$#][A-Za-z0-9_$.]*[ \t]*[(].*[^A-Za-z0-9_$]function[ \t]*[(]', // a call that is given a function
  '^[A-Za-z_$].*$',
  '^[ \t]+((public|private|protected|static|async|readonly|override|abstract|declare|get|set)[ \t]+)*(function[ \t]*[*]?[ \t]*)?[*]?[#A-Za-z_$][A-Za-z0-9_$]*[ \t]*(<.*>)?[ \t]*[(][^;]*[)][^;=]*[{].*$',
  '^[ \t]+((public|private|protected|static|async|readonly|override|abstract|declare|get|set)[ \t]+)+[*]?[#A-Za-z_$][A-Za-z0-9_$]*[ \t]*(<.*>)?[ \t]*[(][ \t]*$',
  '^[ \t]+(async[ \t]+)?function[ \t]*[*]?[ \t]*[A-Za-z_$][A-Za-z0-9_$]*[ \t]*[(][ \t]*$',
  '^[ \t]+((public|private|protected|static|readonly|override)[ \t]+)*[#A-Za-z_$][A-Za-z0-9_$]*[ \t]*[?!]?[ \t]*(:[^=]*)?=[ \t]*(async[ \t]+)?([(][^)]*[)]|[A-Za-z_$][A-Za-z0-9_$]*)[ \t]*(:[^=]*)?=>.*$',
].join('\n');
const OWN_DRIVERS = Object.freeze({ 'sonah-js': JS_FUNCNAME });
const OWN_DRIVER_BY_EXT = Object.freeze({ js: 'sonah-js', mjs: 'sonah-js', cjs: 'sonah-js', jsx: 'sonah-js', ts: 'sonah-js',
  mts: 'sonah-js', cts: 'sonah-js', tsx: 'sonah-js' });

// A file's language, by its extension (a file-format convention). Unlisted extensions are given as they are.
const LANG_BY_EXT = Object.freeze({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', mts: 'typescript',
  cts: 'typescript', tsx: 'typescript', py: 'python', pyi: 'python', go: 'go', rs: 'rust', rb: 'ruby', java: 'java',
  kt: 'kotlin', kts: 'kotlin', swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  hxx: 'cpp', cs: 'csharp', php: 'php', sh: 'shell', bash: 'shell', zsh: 'shell', md: 'markdown', markdown: 'markdown',
  mdx: 'markdown', json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', html: 'html', htm: 'html',
  css: 'css', scss: 'css', sql: 'sql', ex: 'elixir', exs: 'elixir', scala: 'scala', lua: 'lua', dart: 'dart',
});

// Path-structure roles. These are file-format and layout conventions, not words about meaning.
const PROSE_EXT = new Set(['md', 'markdown', 'mdx', 'rst', 'txt', 'adoc', 'asciidoc', 'org', 'rdoc', 'textile']);
const DATA_EXT = new Set(['json', 'jsonc', 'json5', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'lock', 'xml',
  'properties', 'env', 'plist', 'csv', 'tsv', 'sum', 'mod']);
const TEST_TOKENS = new Set(['test', 'tests', 'spec', 'specs', '__tests__']);
const FIXTURE_TOKENS = new Set(['fixture', 'fixtures', '__fixtures__', 'testdata', 'golden', 'goldens', 'snapshot',
  'snapshots', '__snapshots__']);
const COMMENT_LEAD = /^\s*[/*#]/; // comment leaders of the C, shell and Python families
const DOC_LEAD = /[/*#@]/; // a line just above a definition that starts so (a comment, or a decorator) is the definition's
const ROUTE_BY_ROLE = Object.freeze({ source: 'read', test: 'skim', docs: 'skip', record: 'skip', fixture: 'skip',
  config: 'skip' });
// A file's status in git's own words (a copy is an added file).
const FILE_STATUS = Object.freeze({ A: 'added', C: 'added', M: 'modified', T: 'modified', R: 'renamed', D: 'deleted' });

// Pin every config that would change git's output, so the same range gives the same bytes on any machine.
function pinned(attrs) {
  const own = Object.entries(OWN_DRIVERS).flatMap(([d, re]) => ['-c', `diff.${d}.xfuncname=${re}`]);
  return ['-c', `core.attributesFile=${attrs}`, ...own, '-c', 'core.quotepath=off', '-c', 'color.ui=never',
    '-c', 'grep.column=false', '-c', 'grep.fullName=false', '-c', 'grep.lineNumber=false', '-c', 'grep.patternType=basic',
    '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.external=', '-c', 'diff.algorithm=myers',
    '-c', 'diff.relative=false', '-c', 'diff.interHunkContext=0'];
}

// What git runs with from the parent's environment: where programs are, the user, home, language, temp folder,
// certificates and proxies, and GIT_NO_LAZY_FETCH when the parent sets it (the free CLI does: a partial clone's missing
// object is then never fetched). Nothing else, so no secret of the process running the job (a server's keys) reaches
// git.
const ENV_KEPT = Object.freeze(['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'LC_MESSAGES', 'SystemRoot', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy',
  'http_proxy', 'no_proxy', 'GIT_NO_LAZY_FETCH']);
/** The environment of a git child: the kept names of `env`, then `extra`. */
export function gitEnv(extra = {}, env = process.env) {
  const out = {};
  for (const k of ENV_KEPT) if (typeof env[k] === 'string') out[k] = env[k];
  return { ...out, ...extra };
}

/** The name extract gives a repository (facts.repo.name): its origin URL's last path part, else its folder's name. */
export function repoNameOf(repoDir) {
  const git = (args, { ok = [0] } = {}) => {
    try {
      return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() });
    } catch (error) {
      if (ok.includes(error.status)) return error.stdout ?? '';
      throw new Error(`git ${args[0]} failed`, { cause: error });
    }
  };
  return repoName(git, repoDir);
}

export async function extract({ repoDir, base, head }) {
  if (!repoDir || !base || !head) throw new Error('extract needs repoDir, base and head');
  const work = mkdtempSync(join(tmpdir(), 'sonah-extract-'));
  try {
    const attrs = join(work, 'attributes');
    writeFileSync(attrs, Object.entries({ ...DRIVER_BY_EXT, ...OWN_DRIVER_BY_EXT }).map(([ext, d]) => `*.${ext} diff=${d}`)
      .join('\n') + '\n');
    const noConfig = join(work, 'empty-config');
    writeFileSync(noConfig, '');
    const PIN = pinned(attrs);
    const git = (args, { cwd = repoDir, ok = [0], isolated = false, input = null } = {}) => {
      try {
        return execFileSync('git', [...PIN, ...args], { cwd, encoding: input === null ? 'utf8' : 'buffer',
          maxBuffer: 1 << 30, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(input === null ? {} : { input }),
          // outside any repository (the copies in the work dir), no user or system config may change git's drivers
          env: gitEnv(isolated ? { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: noConfig } : {}) });
      } catch (error) {
        if (ok.includes(error.status)) return error.stdout ?? '';
        const said = String(error.stderr ?? '').trim().split('\n')[0];
        throw new Error(`git ${args[0]} failed: ${said || error.message}`, { cause: error });
      }
    };
    if (!existsSync(repoDir)) throw new Error(`no repository at ${repoDir}`);
    return await extractWith({ git, work, repoDir, base, head });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function extractWith({ git, work, repoDir, base, head }) {
  const sha = git(['rev-parse', '--verify', `${head}^{commit}`]).trim();
  const baseSha = base === EMPTY_TREE ? EMPTY_TREE : git(['rev-parse', '--verify', `${base}^{commit}`]).trim();
  // A PR's diff is taken from where head left base (the merge base), as a PR page shows it.
  const from = baseSha === EMPTY_TREE ? EMPTY_TREE
    : (git(['merge-base', baseSha, sha], { ok: [0, 1] }).trim() || baseSha);
  const commits = commitsOf(git, baseSha === EMPTY_TREE ? sha : `${baseSha}..${sha}`);

  const files = changedFiles(git, from, sha);
  // The default-context diff: its pairing of lines is the one git's numstat counts (-U0 can pair them otherwise).
  const patch = parsePatch(git(['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv',
    '--src-prefix=a/', '--dst-prefix=b/', from, sha]));
  for (const f of files) f.hunks = patch.get(f.path) ?? [];

  const blobs = new Map();
  const blob = (rev, path) => {
    const key = `${rev}:${path}`;
    if (!blobs.has(key)) blobs.set(key, git(['cat-file', 'blob', key]));
    return blobs.get(key);
  };

  for (const f of files) {
    f.role = roleOf(f.path, f);
    if (f.role === 'docs' && f.status !== 'A' && f.removed === 0 && f.hunks.length) {
      const oldLines = linesOf(blob(from, f.oldPath)).length;
      if (f.hunks.every((h) => h.plusAt.every((n) => n > oldLines))) f.role = 'record'; // appended after its last line
    }
  }

  // Function lines of every changed source file, at head and at the base, as git's drivers see them.
  const source = files.filter((f) => f.role === 'source' && f.hunks.length);
  const newText = new Map(); const oldText = new Map();
  for (const f of source) {
    if (f.status !== 'D') newText.set(f.path, blob(sha, f.path));
    if (f.status !== 'A' && f.status !== 'C') oldText.set(f.oldPath, blob(from, f.oldPath));
  }
  // The parser's spans for files a grammar covers, when both sides parse with no error; git's function lines otherwise.
  const families = familiesOf(source.map((f) => f.path));
  // the lines each changed file has at head (added ones, and where lines were taken out): a big repository is parsed in
  // part, from the files that name a definition holding them (parse-pr.mjs headGraph)
  const changedLines = new Map(source.filter((f) => f.status !== 'D').map((f) => [f.path,
    new Set(f.hunks.flatMap((h) => [...h.plusAt, ...(h.newCount ? [] : [h.newStart, h.newStart + 1])]))]));
  const code = families.length ? await headGraph(git, sha, families, { changed: changedLines }) : null;
  const parsedOf = new Map(); // path -> { head, base } parsed files
  for (const f of source) {
    if (!code || !grammarOf(f.path) || (f.status !== 'A' && f.status !== 'C' && !grammarOf(f.oldPath))) continue;
    const h = f.status === 'D' ? null : code.parsed.get(f.path) ?? null;
    const b = oldText.has(f.oldPath) ? parseText(f.oldPath, oldText.get(f.oldPath)) : null;
    if ((f.status !== 'D' && (!h || h.hasError)) || (oldText.has(f.oldPath) && (!b || b.hasError))) continue;
    parsedOf.set(f.path, { head: h, base: b });
  }
  const parsedOld = new Set(source.filter((f) => parsedOf.has(f.path)).map((f) => f.oldPath));
  const newHeads = functionLines(git, work, new Map([...newText].filter(([p]) => !parsedOf.has(p))), 'new');
  const oldHeads = functionLines(git, work, new Map([...oldText].filter(([p]) => !parsedOld.has(p))), 'old');
  const newLinesOf = new Map([...newText].map(([p, t]) => [p, linesOf(t)]));

  const functions = [];
  const topTouched = new Set(); // files whose top-level code (outside every function) the diff changes
  for (const f of source) {
    const nLines = newLinesOf.get(f.path) ?? [];
    const oLines = oldText.has(f.oldPath) ? linesOf(oldText.get(f.oldPath)) : [];
    const parsed = parsedOf.get(f.path) ?? null;
    const nSpans = parsed ? unitSpans(parsed.head, nLines) : spansOf(newHeads.get(f.path) ?? [], nLines);
    const oSpans = parsed ? unitSpans(parsed.base, oLines) : spansOf(oldHeads.get(f.oldPath) ?? [], oLines);
    pairByName(oSpans, nSpans);
    const oldOf = newToOld(f.hunks);
    const touched = new Map(); // span -> { added: Set(newLine), removed: Map(oldLine -> { at, text }) }
    const touch = (span) => {
      if (!touched.has(span)) touched.set(span, { added: new Set(), removed: new Map() });
      return touched.get(span);
    };
    for (const h of f.hunks) {
      let o = h.oldCount ? h.oldStart : h.oldStart + 1; let n = h.newCount ? h.newStart : h.newStart + 1;
      for (const line of h.lines) {
        if (line[0] === '-') {
          const os = spanAt(oSpans, o);
          const target = os ? (os.pair ?? os) : null;
          if (target) touch(target).removed.set(o, { at: n, text: line.slice(1) }); // it stood before new line n
          else if (line.slice(1).trim()) topTouched.add(f.path);
          o++;
        } else if (line[0] === '+') {
          const ns = spanAt(nSpans, n);
          if (ns) touch(ns).added.add(n);
          else if (line.slice(1).trim()) topTouched.add(f.path);
          n++;
        } else { o++; n++; }
      }
    }
    for (const [span, t] of touched) {
      if (span.kind === 'statement') continue; // imports, lists and other top-level lines are no function
      const isOld = span.side === 'old';
      // comment-only: git's rule is every changed line above the definition line; the parser knows each comment line
      const commentOnly = !isOld && t.added.size + t.removed.size > 0 && (parsed
        ? [...t.added].every((n) => span.quiet.has(n)) && [...t.removed.keys()].every((o) => span.pair?.quiet.has(o))
        : [...t.added].every((n) => n < span.line) && [...t.removed.keys()].every((o) => span.pair && o < span.pair.line));
      const blankOnly = [...t.added].every((n) => !String(nLines[n - 1] ?? '').trim())
        && [...t.removed.values()].every((r) => !String(r.text).trim());
      const added = t.added.size; const removed = t.removed.size;
      const nested = parsed ? [...new Set([...(isOld ? [] : nestedNames(parsed.head, span.def, [...t.added])),
        ...(span.pair || isOld ? nestedNames(parsed.base, (isOld ? span : span.pair).def, [...t.removed.keys()]) : [])])] : [];
      functions.push({
        id: null,
        path: f.path,
        name: span.name,
        owner: span.owner ?? null,
        kind: span.kind,
        status: isOld ? 'removed' : (span.pair ? 'changed' : 'new'),
        line: isOld ? null : span.line,
        span: isOld ? null : [span.ranges[0][0], span.ranges.at(-1)[1]],
        oldLine: isOld ? span.line : (span.pair?.line ?? null),
        added,
        removed,
        definition: span.text,
        commentOnly,
        ...(isOld ? { diff: removedRows(t) } : ownRows(span, t, nLines, oldOf)),
        callers: { count: 0, list: [] },
        tests: [],
        fold: commentOnly ? 'comment-only' : span.kind === 'value' ? 'value' : added + removed <= TINY_LINES ? 'tiny' : null,
        ...(nested.length ? { nested } : {}),
        ranges: span.ranges, // internal: dropped before the facts are returned
        blankOnly, // internal
        unit: parsed && !isOld ? code.parsed.get(f.path).ids[span.def] : null, // internal: the parser graph's id
      });
    }
  }
  const fileIndex = new Map(files.map((f, i) => [f.path, i]));
  functions.sort((a, b) => fileIndex.get(a.path) - fileIndex.get(b.path) || (a.line ?? a.oldLine) - (b.line ?? b.oldLine));
  // Stable ids: path#name, and path#name~2, ~3 for a name repeated in one file (in line order).
  const seenIds = new Map();
  for (const fn of functions) {
    const key = `${fn.path}#${fn.name}`;
    const k = (seenIds.get(key) ?? 0) + 1;
    seenIds.set(key, k);
    fn.id = k === 1 ? key : `${key}~${k}`;
  }

  // mentions: a changed function's name as a whole word inside another changed function's span at head. Between two
  // functions the parser covers, its resolved calls and uses take their place; the parser does not follow the use of a
  // value or a type, so such a name found as a word stays a mention there, never call-shaped.
  const live = functions.filter((fn) => fn.status !== 'removed');
  const named = live.filter((fn) => fn.name.length > 1).map((fn) => ({ fn, word: wordRe(fn.name), call: callRe(fn.name) }));
  const changedPaths = new Set(files.map((f) => f.path));
  // a file the parser read with an error keeps git's spans; its definitions that the diff touches are changed all the same,
  // and so is a file's top-level code when the diff touches it
  const alsoChanged = new Set([...topTouched].map((p) => `${p}#<top>`));
  for (const f of source) {
    const h = code?.parsed.get(f.path);
    if (!h || parsedOf.has(f.path)) continue;
    const own = innermostAt(h);
    for (const hk of f.hunks) for (const n of hk.plusAt) if (own[n] >= 0) alsoChanged.add(h.ids[unitIndex(h, own[n])]);
  }
  const graph = code ? graphFacts({ head: code, fns: functions, changedPaths, roleOf: (p) => roleOf(p), alsoChanged }) : null;
  const order = new Map(functions.map((fn, i) => [fn.id, i]));
  const mentions = [...(graph?.mentions ?? [])];
  const resolved = new Set(mentions.map((m) => `${m.from}\0${m.to}`));
  for (const a of live) {
    const all = newLinesOf.get(a.path);
    const lines = a.ranges.flatMap(([x, y]) => all.slice(x - 1, y));
    for (const { fn: b, word, call } of named) {
      if (b === a || b.name === a.name) continue;
      const parsedPair = a.unit && b.unit;
      if (parsedPair && (b.kind === 'callable' || resolved.has(`${a.id}\0${b.id}`))) continue;
      if (!lines.some((l) => word.test(l))) continue;
      mentions.push({ from: a.id, to: b.id,
        // on a line that does not start with a comment leader (/ * #): code, not prose about it
        onCodeLine: lines.some((l) => word.test(l) && !COMMENT_LEAD.test(l)),
        callShaped: !parsedPair && lines.some((l) => call.test(l)) });
    }
  }
  mentions.sort((x, y) => order.get(x.from) - order.get(y.from) || order.get(x.to) - order.get(y.to));

  // callers and test files at head: one git grep for every changed name the parser does not cover.
  const tree = new Set(git(['ls-tree', '-r', '-z', '--name-only', sha]).split('\0').filter(Boolean));
  const grepped = live.filter((fn) => !fn.unit);
  const names = [...new Set([...grepped.filter((fn) => fn.name.length > 1).map((fn) => fn.name),
    ...grepped.map((fn) => fn.owner).filter((o) => o && o.length > 1)])];
  const hits = names.length ? grepWords(git, names, sha, tree) : new Map();
  // Each hit's enclosing function: the span that holds it, by the same span rule as changed lines, from git's own
  // function lines of the files hit. (git grep -p cannot give it: a function line that itself holds a changed name is
  // printed as a match, not as the enclosing line.) A hit on a top-level line (an import, a list) is in no function.
  const hitPaths = [...new Set([...hits.values()].flat().map((h) => h.path))].sort();
  const hitTexts = readBlobs(git, sha, hitPaths);
  const hitHeads = functionLines(git, work, hitTexts, 'callers');
  const hitSpans = new Map();
  const spansFor = (path) => {
    if (!hitSpans.has(path)) hitSpans.set(path, spansOf(hitHeads.get(path) ?? [], linesOf(hitTexts.get(path) ?? '')));
    return hitSpans.get(path);
  };
  for (const list of hits.values()) {
    for (const h of list) {
      const sp = spanAt(spansFor(h.path), h.line);
      h.in = sp && sp.kind !== 'statement' ? { line: sp.line, text: sp.text } : null;
    }
  }
  const testsNaming = new Map(); // fn -> test files changed in this range that name it
  for (const fn of grepped) {
    if (fn.name.length < 2) continue;
    const all = (hits.get(fn.name) ?? [])
      .filter((h) => !(h.path === fn.path && fn.ranges.some(([x, y]) => h.line >= x && h.line <= y)));
    const outside = all.filter((h) => roleOf(h.path) !== 'test');
    fn.callers = { count: outside.length, list: outside.slice(0, LIST_CAP).map((h) => ({ path: h.path, line: h.line, in: h.in })) };
    const viaOwner = fn.owner && fn.owner.length > 1 ? hits.get(fn.owner) ?? [] : [];
    testsNaming.set(fn, [...new Set([...all, ...viaOwner].filter((h) => roleOf(h.path) === 'test' && changedPaths.has(h.path))
      .map((h) => h.path))].sort());
  }

  // tests: test files changed in this range that reach the function: they name it or its owner (the class a method is
  // in), or name a changed function that reaches it through call-shaped mentions between changed functions. (Measured
  // once only, on one commit, against facts written by hand for it. Not a measured rate for other PRs.)
  const calls = new Map();
  for (const m of mentions) if (m.callShaped) (calls.get(m.from) ?? calls.set(m.from, new Set()).get(m.from)).add(m.to);
  const reach = new Map(functions.map((fn) => [fn.id, new Set()]));
  for (const y of live) {
    const tests = testsNaming.get(y) ?? [];
    if (!tests.length) continue;
    const seen = new Set([y.id]); const todo = [y.id];
    while (todo.length) for (const n of calls.get(todo.pop()) ?? []) if (!seen.has(n)) { seen.add(n); todo.push(n); }
    for (const x of seen) for (const t of tests) reach.get(x).add(t);
  }
  for (const fn of functions) fn.tests = [...reach.get(fn.id)].sort();
  // the parser's own: resolved callers, the PR's tests within a few calls, existing tests and impact
  for (const [fn, g] of graph?.byFn ?? []) {
    fn.callers = g.callers;
    fn.tests = g.tests;
    fn.existingTests = g.existingTests;
    if (g.impact) fn.impact = g.impact;
  }

  // The read route: by role, with changed lines. Comment-only source is skipped; values-and-comments source is skimmed.
  const route = { read: [], skim: [], skip: [] };
  for (const f of files) {
    const fns = functions.filter((fn) => fn.path === f.path);
    let where = ROUTE_BY_ROLE[f.role];
    if (f.binary) where = 'skip';
    else if (f.role === 'source' && fns.length && fns.every((fn) => fn.commentOnly)) where = 'skip';
    // values and comments only: skim. A class, interface or struct definition is read like a function.
    else if (f.role === 'source' && fns.length && fns.every((fn) => fn.fold === 'value' || fn.fold === 'comment-only')) where = 'skim';
    route[where].push({ path: f.path, lines: f.added + f.removed });
  }
  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  route.lines = { read: sum(route.read.map((x) => x.lines)), skim: sum(route.skim.map((x) => x.lines)),
    skip: sum(route.skip.map((x) => x.lines)) };

  for (const fn of functions) { delete fn.ranges; delete fn.blankOnly; delete fn.unit; }
  return {
    v: 1,
    repo: { name: repoName(git, repoDir) },
    range: { base: from, head: sha, commits },
    stats: { files: files.length, added: sum(files.map((f) => f.added)), removed: sum(files.map((f) => f.removed)),
      functions: functions.length,
      newFunctions: functions.filter((f) => f.status === 'new').length,
      changedFunctions: functions.filter((f) => f.status === 'changed').length,
      removedFunctions: functions.filter((f) => f.status === 'removed').length },
    groups: groupsOf(files),
    files: files.map((f) => ({ path: f.path, ...(f.oldPath !== f.path ? { oldPath: f.oldPath } : {}),
      status: FILE_STATUS[f.status] ?? 'modified', role: f.role, lang: langOf(f.path), added: f.added, removed: f.removed,
      functions: functions.filter((fn) => fn.path === f.path).map((fn) => fn.id) })),
    functions,
    mentions,
    route,
    // the parser's impact beyond the diff (null when no changed file is one a grammar covers)
    impact: graph ? graph.impact : null,
  };
}

// ---------- git facts ----------

function repoName(git, repoDir) {
  // The name of the repository the PR belongs to: its origin's last path part, else its folder's name.
  const url = git(['config', '--get', 'remote.origin.url'], { ok: [0, 1] }).trim();
  const fromUrl = url.replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '');
  if (fromUrl) return fromUrl;
  const top = git(['rev-parse', '--show-toplevel'], { ok: [0, 128] }).trim();
  return basename(top || repoDir);
}

function commitsOf(git, range) {
  const out = git(['log', '-z', '--reverse', '--topo-order', '--no-color', '--format=%H%x00%s%x00%b', range]);
  const parts = out.split('\0');
  const commits = [];
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const shaPart = parts[i].replace(/^\n+/, '');
    if (!shaPart) break;
    commits.push({ sha: shaPart, subject: parts[i + 1], body: parts[i + 2].replace(/\s+$/, '') });
  }
  return commits;
}

function changedFiles(git, from, sha) {
  const files = [];
  const ns = git(['diff', '--name-status', '-z', '-M', from, sha]).split('\0');
  for (let i = 0; i < ns.length - 1;) {
    const code = ns[i++];
    if (!code) continue;
    const status = code[0];
    const oldPath = ns[i++];
    const path = status === 'R' || status === 'C' ? ns[i++] : oldPath;
    files.push({ status, path, oldPath, added: 0, removed: 0, binary: false });
  }
  const num = git(['diff', '--numstat', '-z', '-M', from, sha]).split('\0');
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (let i = 0; i < num.length - 1;) {
    const [a, r, p] = num[i++].split('\t');
    if (a === undefined || r === undefined) continue;
    const path = p ? p : (i++, num[i++]);
    const f = byPath.get(path);
    if (!f) continue;
    if (a === '-') f.binary = true; else { f.added = Number(a); f.removed = Number(r); }
  }
  return files;
}

function unquote(s) {
  if (!s.startsWith('"')) return s;
  return Buffer.from(JSON.parse(s.replace(/\\([0-7]{3})/g, (_, o) => `\\u00${parseInt(o, 8).toString(16).padStart(2, '0')}`)),
    'latin1').toString('utf8');
}

function pathOf(raw, prefix) {
  const s = unquote(raw.replace(/\t$/, ''));
  if (s === '/dev/null') return null;
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

function parsePatch(text) {
  const out = new Map();
  const L = text.split('\n');
  let cur = null; let oldP = null;
  for (let i = 0; i < L.length;) {
    const line = L[i];
    if (line.startsWith('diff --git ')) { cur = null; oldP = null; i++; continue; }
    if (line.startsWith('--- ') && !cur) { oldP = pathOf(line.slice(4), 'a/'); i++; continue; }
    if (line.startsWith('+++ ') && !cur) {
      const newP = pathOf(line.slice(4), 'b/');
      cur = []; out.set(newP ?? oldP, cur); i++; continue;
    }
    const m = cur && line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
    if (m) {
      const h = { oldStart: +m[1], oldCount: m[2] === undefined ? 1 : +m[2], newStart: +m[3],
        newCount: m[4] === undefined ? 1 : +m[4], lines: [], plusAt: [] };
      i++;
      let o = h.oldCount; let n = h.newCount; let at = h.newCount ? h.newStart : h.newStart + 1;
      while ((o > 0 || n > 0) && i < L.length) {
        const t = L[i++];
        if (t[0] === '-') o--; else if (t[0] === '+') { n--; h.plusAt.push(at++); } else if (t[0] === ' ') { o--; n--; at++; }
        else if (t[0] !== '\\') break;
        if (t[0] !== '\\') h.lines.push(t);
      }
      while (i < L.length && L[i].startsWith('\\')) i++;
      cur.push(h);
      continue;
    }
    i++;
  }
  return out;
}

// For an unchanged line at head, its line number at the base (from the file's hunks).
function newToOld(hunks) {
  const marks = []; // per hunk: first new line, the context pairs inside it, and the offset after it
  for (const h of hunks) {
    let o = h.oldCount ? h.oldStart : h.oldStart + 1; let n = h.newCount ? h.newStart : h.newStart + 1;
    const first = n; const pairs = new Map();
    for (const line of h.lines) {
      if (line[0] === '-') o++;
      else if (line[0] === '+') n++;
      else { pairs.set(n, o); o++; n++; }
    }
    marks.push({ first, pairs, after: o - n });
  }
  return (n) => {
    let delta = 0;
    for (const m of marks) {
      if (n < m.first) break;
      if (m.pairs.has(n)) return m.pairs.get(n);
      delta = m.after;
    }
    return n + delta;
  };
}

function linesOf(text) {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function extOf(path) {
  const base = path.split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function langOf(path) { const ext = extOf(path); return LANG_BY_EXT[ext] ?? ext; }

// The function lines git's driver sees in each file: each file is written with an empty line after every line, and
// `git grep -p -e '^$'` then prints every function line with "=" (line k of the file is line 2k-1 of the copy).
function functionLines(git, work, texts, side) {
  const heads = new Map();
  if (!texts.size) return heads;
  const root = join(work, side);
  for (const [path, text] of texts) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, linesOf(text).map((l) => `${l}\n\n`).join(''));
    heads.set(path, []);
  }
  const out = git(['grep', '--no-index', '--no-exclude-standard', '-n', '-p', '-I', '-e', '^$', '--', '.'],
    { cwd: root, ok: [0, 1], isolated: true });
  for (const raw of out.split('\n')) {
    const hit = splitGrepLine(raw, heads);
    if (!hit || hit.sep !== '=') continue;
    heads.get(hit.path).push({ line: (hit.line + 1) / 2, text: hit.text });
  }
  for (const list of heads.values()) list.sort((a, b) => a.line - b.line);
  return heads;
}

function splitGrepLine(raw, known) {
  for (let j = raw.search(/[:=]/); j > 0; j = nextSep(raw, j + 1)) {
    const path = raw.slice(0, j);
    if (!known.has(path)) continue;
    const m = raw.slice(j).match(/^([:=])(\d+)\1/);
    if (!m) continue;
    return { path, sep: m[1], line: Number(m[2]), text: raw.slice(j + m[0].length) };
  }
  return null;
}

function nextSep(s, from) {
  const a = s.indexOf(':', from); const b = s.indexOf('=', from);
  if (a < 0) return b; if (b < 0) return a; return Math.min(a, b);
}

function grepWords(git, names, sha, tree) {
  // One extended alternation (git runs many -e patterns one by one, far slower); the whole-word test is made here.
  // Files whose role cannot call (prose, data, fixtures) are not read.
  const args = ['grep', '-n', '-I', '--no-color', '-E', '-e', `(${names.map((n) => n.replace(/\$/g, '\\$')).join('|')})`,
    sha, '--', '.', ...[...PROSE_EXT, ...DATA_EXT].map((e) => `:(exclude,glob)**/*.${e}`),
    ...[...FIXTURE_TOKENS].map((t) => `:(exclude,glob)**/${t}/**`)];
  const out = git(args, { ok: [0, 1] });
  const hits = new Map(names.map((n) => [n, []]));
  const res = names.map((n) => [n, wordRe(n)]);
  const prefix = `${sha}:`;
  for (const raw of out.split('\n')) {
    if (!raw.startsWith(prefix)) continue;
    const hit = splitGrepLine(raw.slice(prefix.length), tree);
    if (!hit || hit.sep !== ':') continue;
    for (const [n, re] of res) {
      if (re.test(hit.text)) hits.get(n).push({ path: hit.path, line: hit.line, in: null });
    }
  }
  return hits;
}

// Many blobs of one revision in one git call (cat-file --batch). Paths that cannot be asked so are left out.
function readBlobs(git, rev, paths) {
  const texts = new Map();
  const asked = paths.filter((p) => !p.includes('\n'));
  if (!asked.length) return texts;
  const buf = git(['cat-file', '--batch'], { input: Buffer.from(asked.map((p) => `${rev}:${p}`).join('\n') + '\n') });
  let i = 0;
  for (const p of asked) {
    const nl = buf.indexOf(10, i);
    if (nl < 0) break;
    const m = buf.subarray(i, nl).toString('utf8').match(/^[0-9a-f]+ blob (\d+)$/);
    i = nl + 1;
    if (!m) continue; // missing, or not a blob
    texts.set(p, buf.subarray(i, i + Number(m[1])).toString('utf8'));
    i += Number(m[1]) + 1;
  }
  return texts;
}

function escapeName(name) { return name.replace(/[$]/g, '\\$'); }
function wordRe(name) { return new RegExp(`(?<![A-Za-z0-9_])${escapeName(name)}(?![A-Za-z0-9_])`); }
function callRe(name) { return new RegExp(`(?<![A-Za-z0-9_])${escapeName(name)}(?![A-Za-z0-9_])\\s*\\(`); }

// ---------- spans and names ----------

function spansOf(heads, lines) {
  const isHead = new Set(heads.map((h) => h.line));
  const starts = heads.map((h, k) => {
    let s = h.line;
    const floor = k ? heads[k - 1].line + 1 : 1;
    while (s > floor) {
      const first = lines[s - 2].trimStart()[0];
      if (!first || !DOC_LEAD.test(first) || isHead.has(s - 1)) break;
      s--;
    }
    return s;
  });
  const spans = heads.map((h, k) => {
    const { name, kind } = nameOf(h.text);
    let end = k + 1 < heads.length ? starts[k + 1] - 1 : lines.length;
    while (end > h.line && !lines[end - 1].trim()) end--; // blank lines after a function belong to none
    return { line: h.line, text: h.text, name, kind, owner: null, start: starts[k], end, ranges: [[starts[k], end]], side: null,
      pair: null };
  });
  // An indented (nested) definition ends where a code line comes back to its indentation or less (a closing bracket at
  // its own indentation still closes it); the lines from there to the next definition are the enclosing one's: the
  // nearest definition above indented less than that line, or none (top level).
  spans.forEach((sp, k) => {
    const ind = indentOf(sp.text);
    if (ind === 0) return;
    for (let n = sp.line + 1; n <= sp.end; n++) {
      const t = lines[n - 1];
      if (!t.trim() || COMMENT_LEAD.test(t)) continue;
      const i = indentOf(t);
      if (i > ind || (i === ind && /^[)}\]]/.test(t.trim()))) continue;
      let end = n - 1;
      while (end > sp.line && !lines[end - 1].trim()) end--;
      const rest = [n, sp.end];
      sp.end = end; sp.ranges = [[sp.start, end]];
      const owner = spans.slice(0, k).reverse().find((o) => indentOf(o.text) < i);
      if (owner) owner.ranges.push(rest);
      break;
    }
  });
  // A nested definition's owner: the nearest definition above it indented less (a class for a method, the outer
  // function for an inner one). Named statements are no owner.
  spans.forEach((sp, k) => {
    const ind = indentOf(sp.text);
    if (ind === 0 || sp.kind === 'statement') return;
    const o = spans.slice(0, k).reverse().find((x) => indentOf(x.text) < ind);
    sp.owner = o && o.kind !== 'statement' && o.name ? o.name : null;
  });
  return spans;
}

function indentOf(text) { return text.match(/^[ \t]*/)[0].replace(/\t/g, '        ').length; }

function spanAt(spans, line) {
  for (const s of spans) for (const [x, y] of s.ranges) if (line >= x && line <= y) return s;
  return null;
}

// Pair a base function with head's one of the same owner, name and kind in the same file (the k-th with the k-th).
function pairByName(oldSpans, newSpans) {
  for (const s of oldSpans) s.side = 'old';
  for (const s of newSpans) s.side = 'new';
  const seen = new Map();
  const key = (s) => {
    const k = `${s.owner}\0${s.name}\0${s.kind}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return `${k}\0${n}`;
  };
  const olds = new Map(oldSpans.map((s) => [key(s), s]));
  seen.clear();
  for (const s of newSpans) {
    const o = olds.get(key(s));
    if (o) { s.pair = o; o.pair = s; }
  }
}

const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g;

function bareAssign(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '=') continue;
    const before = s[i - 1] ?? ''; const after = s[i + 1] ?? '';
    if ('=!<>+-*/%&|^:?'.includes(before) || after === '=' || after === '>') continue;
    return i;
  }
  return -1;
}

function closeOf(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return s.length - 1;
}

// A name read by punctuation only: the identifier before the first "(" (a lone leading word followed by a space, such
// as a receiver or anonymous form, is stepped over), else before the first bare "=", else the first identifier after
// the leading run of all-lowercase words (see below when all are lowercase). A line with no name is a top-level
// statement, not a function.
function nameOf(text) {
  const found = nameOfRaw(text);
  return found.name ? found : { name: null, kind: 'statement' };
}

function nameOfRaw(text) {
  let s = text.trim();
  const statement = /;\s*$/.test(s);
  for (let guard = 0; guard < 4 && s; guard++) {
    const p = s.indexOf('(');
    const e = bareAssign(s);
    if (e >= 0 && (p < 0 || e < p)) {
      const lhs = s.slice(0, e).split(':')[0];
      const toks = lhs.match(IDENT) ?? [];
      const rhs = s.slice(e + 1);
      const callable = /=>/.test(rhs) || (/^\s*(?:[A-Za-z_$][\w$]*(?:\s+|\s*\*\s*))*(?:[A-Za-z_$][\w$]*)?\s*\(/.test(rhs) && /\{\s*$/.test(s));
      return { name: toks.at(-1) ?? null, kind: callable ? 'callable' : 'value' };
    }
    if (p >= 0) {
      let pre = s.slice(0, p);
      for (let k = 0; k < 3; k++) pre = pre.replace(/<[^<>]*>\s*$/, '');
      const toks = pre.match(IDENT) ?? [];
      if (!toks.length || (toks.length === 1 && /\s$/.test(pre) && pre.trim() === toks[0])) {
        s = s.slice(closeOf(s, p) + 1);
        continue;
      }
      if (/[A-Za-z0-9_$]\s*$/.test(pre)) return { name: toks.at(-1), kind: statement ? 'statement' : 'callable' };
      return { name: toks.at(-1), kind: 'statement' };
    }
    break;
  }
  const bare = text.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, ' ');
  const toks = [...bare.matchAll(IDENT)];
  if (toks.length < 2) return { name: null, kind: 'statement' };
  let k = 0;
  while (k < toks.length && /^[a-z]+$/.test(toks[k][0])) k++;
  // All words lowercase and a body opens ("{" ends the line): two words ("import type {", "export default {") open a
  // list or a value and name nothing; three or more ("type x struct {") name the second word. Else the last word.
  const opens = /\{\s*$/.test(bare);
  if (k === toks.length && opens && toks.length === 2) return { name: null, kind: 'statement' };
  const pick = k < toks.length ? toks[k] : opens ? toks[1] : toks.at(-1);
  // A name that stands inside an opening brace is a list (an import or export list), not a definition's own name.
  const list = /[{[]/.test(bare.slice(0, pick.index));
  return { name: pick[0], kind: statement || list ? 'statement' : 'definition' };
}

// ---------- each function's own diff ----------

// The function's own diff: its span's lines at head with "+" on added ones and its removed lines put back where they
// stood, cut to VIEW_CONTEXT lines around each change; the definition line is always kept; "~" marks a gap.
// `body` is the same rows uncut (the whole function, for the model to read), given only when the cut left rows out.
// Rows: [op, oldNo|null, newNo|null, text].
function ownRows(span, t, nLines, oldOf) {
  const rows = [];
  const removedAt = new Map();
  const first = span.ranges[0][0]; const last = span.ranges.at(-1)[1];
  const inRanges = (n) => span.ranges.some(([x, y]) => n >= x && n <= y + 1);
  for (const [o, r] of [...t.removed].sort((a, b) => a[0] - b[0])) {
    let at = Math.min(Math.max(r.at, first), last + 1);
    if (!inRanges(at)) at = span.ranges.find(([x]) => x > at)?.[0] ?? last + 1;
    if (!removedAt.has(at)) removedAt.set(at, []);
    removedAt.get(at).push(['-', o, null, r.text]);
  }
  span.ranges.forEach(([x, y], k) => {
    if (k) rows.push(['~', null, null, '']);
    for (let n = x; n <= y + 1; n++) {
      for (const r of removedAt.get(n) ?? []) rows.push(r);
      removedAt.delete(n);
      if (n <= y) rows.push(t.added.has(n) ? ['+', null, n, nLines[n - 1]] : [' ', oldOf(n), n, nLines[n - 1]]);
    }
  });
  const changed = (r) => r && (r[0] === '+' || r[0] === '-');
  const near = rows.map((r, i) => {
    if (changed(r) || r[2] === span.line) return true;
    for (let d = -VIEW_CONTEXT; d <= VIEW_CONTEXT; d++) if (changed(rows[i + d])) return true;
    return false;
  });
  const out = [];
  let gap = false;
  rows.forEach((r, i) => {
    if (r[0] === '~') { gap = true; return; }
    if (near[i]) { if (gap && out.length) out.push(['~', null, null, '']); out.push(r); gap = false; } else gap = true;
  });
  if (gap) out.push(['~', null, null, '']);
  const cut = out.length !== rows.length || out.some((r, i) => r !== rows[i]);
  return cut ? { diff: out, body: rows } : { diff: out };
}

function removedRows(t) {
  return [...t.removed].sort((a, b) => a[0] - b[0]).map(([o, r]) => ['-', o, null, r.text]);
}

// ---------- roles and groups ----------

function tokensOf(base) {
  return base.split(/[._-]+/).flatMap((t) => t.split(/(?<=[a-z0-9])(?=[A-Z])/)).map((t) => t.toLowerCase());
}

// A file's role from its path alone. A binary file is data, never code to read.
function roleOf(path, change = null) {
  if (change?.binary) return 'fixture';
  const segs = path.split('/');
  const base = segs.pop();
  const dirs = segs.map((s) => s.toLowerCase());
  const ext = extOf(path);
  const baseToks = tokensOf(ext ? base.slice(0, -(ext.length + 1)) : base);
  const inTestDir = dirs.some((d) => TEST_TOKENS.has(d));
  if (dirs.some((d) => FIXTURE_TOKENS.has(d)) || baseToks.some((t) => FIXTURE_TOKENS.has(t))) return 'fixture';
  if (inTestDir && (PROSE_EXT.has(ext) || DATA_EXT.has(ext))) return 'fixture';
  if (base.startsWith('.')) return 'config';
  if (inTestDir || baseToks.some((t) => TEST_TOKENS.has(t))) return 'test';
  if (PROSE_EXT.has(ext)) return 'docs';
  if (!ext) return /^[A-Z0-9_]+$/.test(base) ? 'docs' : 'config';
  if (DATA_EXT.has(ext)) return 'config';
  return 'source';
}

// Files grouped by directory: top-level directories (top-level files are "root"); a group with more than GROUP_SPLIT
// files splits by its next directory, until it fits or cannot split.
function groupsOf(files) {
  const split = (paths, depth) => {
    const by = new Map();
    for (const p of paths) {
      const segs = p.split('/');
      const key = segs.length - 1 > depth ? segs.slice(0, depth + 1).join('/') : (depth ? segs.slice(0, depth).join('/') : 'root');
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(p);
    }
    return [...by].flatMap(([key, ps]) => {
      const deeper = ps.filter((p) => p.split('/').length - 1 > depth + 1);
      if (ps.length > GROUP_SPLIT && key !== 'root' && deeper.length) {
        const sub = split(ps, depth + 1);
        if (sub.length > 1) return sub;
      }
      return [{ group: key, files: ps }];
    });
  };
  return split(files.map((f) => f.path), 0);
}
