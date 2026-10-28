// D149: one code step over a synthetic change with a git base whose files take every path through the change block:
// a small added file, a file modified in two places (two hunks), a medium added file the bound can leave out, an added
// file whose hunks alone are over the change block's cap, a binary file and a file whose diff does not match its texts.
// Every byte is invented: no recording, no model, no network. The code step's modules and the fixture's helpers are
// passed in (`mods`), so the same scenario can run against another tree of the code.
import { createHash } from 'node:crypto';

const enc = (text) => new TextEncoder().encode(text);
const sha = (text) => createHash('sha256').update(text).digest('hex');
export const ROOT = '/work/repo';
export const GIT = Object.freeze({ kind: 'git', commit: 'b'.repeat(40), how: 'reflog' });
const ASK = 'SYNTHETIC_ASK: add the modules, change the two lines of b.js and keep the logo.';

/** `n` lines of `width` bytes each (a file's text, ending in a line end). */
export const linesOf = (tag, n, width = 40) => Array.from({ length: n }, (_, i) => `${tag} ${String(i + 1)
  .padStart(5, '0')}`.padEnd(width, '.')).join('\n') + '\n';
const addedPatch = (path, text) => {
  const rows = text.split('\n').slice(0, -1);
  return [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`,
    `@@ -0,0 +1,${rows.length} @@`, ...rows.map((r) => `+${r}`), ''].join('\n');
};
/** git's patch of a file whose lines `at` (1-based, each far from the others) changed, three lines of context each. */
const modifiedPatch = (path, before, after, at) => {
  const a = before.split('\n').slice(0, -1), b = after.split('\n').slice(0, -1);
  const hunks = at.map((line) => {
    const from = Math.max(1, line - 3), to = Math.min(a.length, line + 3);
    const rows = [];
    for (let l = from; l <= to; l++) {
      if (l === line) rows.push(`-${a[l - 1]}`, `+${b[l - 1]}`); else rows.push(` ${a[l - 1]}`);
    }
    return [`@@ -${from},${to - from + 1} +${from},${to - from + 1} @@`, ...rows];
  });
  return [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`,
    ...hunks.flat(), ''].join('\n');
};

/** git's patch of a file every line of which changed: one hunk, every earlier line removed and every line now added. */
export const replacedPatch = (path, before, after) => {
  const a = before.split('\n').slice(0, -1), b = after.split('\n').slice(0, -1);
  return [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`,
    `@@ -1,${a.length} +1,${b.length} @@`, ...a.map((r) => `-${r}`), ...b.map((r) => `+${r}`), ''].join('\n');
};

/** The change's files now (path -> text), and the two modified files' texts at the start commit. */
const B_BEFORE = linesOf('beta', 60);
const B_NOW = B_BEFORE.replace('beta 00005', 'BETA 00005').replace('beta 00040', 'BETA 00040');
const BAD_BEFORE = linesOf('delta', 12);
export const FILES = Object.freeze({
  'src/a.js': linesOf('alpha', 3),
  'src/b.js': B_NOW,
  'src/m.js': linesOf('mid', 400),
  'src/huge.js': linesOf('huge', 11_000),
  'assets/logo.png': 'SYNTHETIC_PNG',
  'src/bad.js': BAD_BEFORE.replace('delta 00006', 'DELTA 00006'),
});

/** The session (an ask, a write of each file, no command) and the frozen snapshot of its change with a git base.
 *  `files`: the files the session writes (path -> text; FILES by default), each added but those FILES names and those
 *  `modified` names (path -> `{ before, patch }`: its text at the start commit and git's patch). */
export function scenario(mods, { files = FILES, modified = {}, commandsAfter = {}, commandsFirst = [],
  attributes = {} } = {}) {
  const { codeSnapshotPlan, freezeCodeSnapshot, fixture } = mods;
  const blobs = { ask: ASK, ok: 'ok', ...Object.fromEntries(Object.entries(files).map(([, text], at) => [`file-${at}`,
    text])) };
  const T1 = { turn: 'T1' };
  // `commandsAfter`: path -> the commands the session ran right after it wrote that file, in order; `commandsFirst`: the
  // commands it ran before its first write.
  const command = (id, text) => {
    blobs[`cmd-${id}`] = text;
    return [{ id, kind: 'invocation', tool: 'Bash', operation: 'command', paths: [], input: [], changes: [], callKey: id,
      command: [{ sourceKey: `cmd-${id}`, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }], ...T1 },
    { id: `${id}-r`, kind: 'observation', invocation: id, blob: 'ok', ...T1 }];
  };
  let n = 0;
  const specs = [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    ...commandsFirst.flatMap((text) => command(`B${++n}`, text)),
    ...Object.keys(files).flatMap((path, at) => [{ id: `W${at + 1}`, kind: 'invocation', write: path, blob: `file-${at}`,
      ...T1 }, ...(commandsAfter[path] ?? []).flatMap((text) => command(`B${++n}`, text))])];
  const session = fixture.buildCodeSession('sess-d149', blobs, specs);
  const plan = codeSnapshotPlan(session, { root: ROOT });
  const reads = plan.map((entry) => {
    const path = entry.path, text = files[path];
    if (Object.hasOwn(modified, path)) return { path, bytes: enc(text), type: 'modified',
      base: { bytes: enc(modified[path].before) }, patch: modified[path].patch };
    if (path === 'assets/logo.png') return { path, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
      type: 'added', patch: `diff --git a/${path} b/${path}\nnew file mode 100644\nBinary files /dev/null and b/${path} differ\n` };
    if (path === 'src/b.js') return { path, bytes: enc(text), type: 'modified', base: { bytes: enc(B_BEFORE) },
      patch: modifiedPatch(path, B_BEFORE, text, [5, 40]) };
    // A patch of other texts: its rows are not the file's lines, so the diff is unreadable.
    if (path === 'src/bad.js') return { path, bytes: enc(text), type: 'modified', base: { bytes: enc(BAD_BEFORE) },
      patch: modifiedPatch(path, linesOf('omega', 12), linesOf('OMEGA', 12), [6]) };
    return { path, bytes: enc(text), type: 'added', patch: addedPatch(path, text) };
  });
  // `attributes`: path -> the git attribute that makes it generated or vendored, as the snapshot reads it (D149).
  const snapshot = freezeCodeSnapshot(plan, reads.map((r) => (Object.hasOwn(attributes, r.path)
    ? { ...r, gitAttribute: attributes[r.path] } : r)), { base: GIT });
  const before = { 'src/b.js': B_BEFORE, 'src/bad.js': BAD_BEFORE,
    ...Object.fromEntries(Object.entries(modified).map(([path, m]) => [path, m.before])) };
  const fileOf = (set, path) => {
    const named = String(path).replace(`${ROOT}/`, '');
    return Object.hasOwn(set, named) && named !== 'assets/logo.png'
      ? { path: named, text: set[named], sha256: sha(set[named]) } : null;
  };
  const repo = { root: ROOT, top: ROOT, read: (path) => fileOf(files, path), base: (path) => fileOf(before, path) };
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], promises: [],
    requirements: [{ text: 'Add the modules.', instruction: { eventId: 'I1', role: 'instruction', quote: ASK },
      status: 'done' }], decisions: [], failures: [], writtenClaims: [], pivots: [] };
  return { session, snapshot, repo, report };
}

/**
 * One run of the code step over the scenario: `wholeFiles` (D106's part B) on or off, at `bound`, the review agent first
 * answering `first` (an answer the step cannot use asks its one repair) and then nothing. `seen` receives every request;
 * `files` and `modified` as `scenario`'s.
 * The accounting holds every item. Resolves the code step's result.
 */
export async function runScenario(mods, { wholeFiles = true, bound = Infinity, first = null, seen = [], files = FILES,
  modified = {}, commandsAfter = {} } = {}) {
  const { runCodePass, fixture } = mods;
  const f = scenario(mods, { files, modified, commandsAfter });
  let asked = 0;
  const judge = async (request) => {
    seen.push(request);
    if (/^code-account:\d+(:reask)?$/.test(request.label ?? '')) return fixture.accountsHold(request.prompt);
    // D149: today's request and its repair, or a unit's (`code-review:review:U<k>:R1` and its repair).
    if (/^code-review:(agent|repair|review:U\d+:R1(:repair)?)$/.test(request.label)) {
      asked += 1;
      return asked === 1 && first !== null ? first : { findings: [], questions: [] };
    }
    throw new Error(`unexpected request ${request.label}`);
  };
  return runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot, repo: f.repo, judge, bound,
    base: GIT, root: ROOT, wholeFiles });
}

/** A digest of requests: each one's label, system prompt and prompt. */
export const digestOf = (requests) => sha(enc(JSON.stringify(requests.map((r) => [r.label, r.system ?? null,
  r.prompt ?? null]))));

/** The digest (`digestOf`) of every request a run of the scenario sends, by the run's options, computed with the code
 *  before D149 (a03192ac): the ledger and the review units' plan move none of them. */
export const GOLDEN_REQUESTS = Object.freeze([
  [{ wholeFiles: false }, 'bcb863bfb1daefe339bed1413f5fce6e8deabaea48f5cd73475ae81739b1318c'],
  [{ wholeFiles: true }, '336688a32ecb15b253c8c1c13cd16c28528840fa5d4782ea4717adc9ea4ad85a'],
  [{ wholeFiles: false, bound: 34_056 }, 'a8f5150887c3476b167ef16c66a3bb22cb0fef498b0d78865557a1f21e97a13d'],
  [{ wholeFiles: false, bound: 39_056, first: {} }, '22eebcf3f712624128c0a4edf737545585148b3c5d120adc47319c437960b89f'],
  [{ wholeFiles: true, bound: 43_048, first: {} }, '92a5415625134a05e78c34d41e6c4d28d92caeb5c32e1ed10a521a341293be31'],
  [{ wholeFiles: true, bound: 39_056 }, 'bcb863bfb1daefe339bed1413f5fce6e8deabaea48f5cd73475ae81739b1318c'],
]);
