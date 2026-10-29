// D179: one code step over a synthetic change that two places hold (the working folder's repository and a sibling
// worktree), with deterministic fake agents. Every byte is invented: no recording, no model, no network. The code step's
// modules and the fixture's helpers are passed in (`mods`), so the same scenario can run against another tree of the
// code (the requests and answer keys of each tree compared byte for byte).
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const enc = (text) => new TextEncoder().encode(text);
/** The working directory, and the folder of another place of the change (a sibling worktree of one project). */
export const ROOT = '/work/repo';
export const SIBLING = '/work/sibling';
const R = (eventId, role, quote) => ({ eventId, role, quote });

/** A report over the fixture's session with one ask (S1), and nothing else in the accounting's scope. */
export const ONE_ASK = Object.freeze({ repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [],
  pivots: [], failures: [], promises: [], writtenClaims: [], decisions: [],
  requirements: [{ text: 'SYNTHETIC ask 1', status: 'done',
    instruction: R('I1', 'instruction', 'add a parse function that returns [] for empty input') }] });

/** The parse.js of another place with other bytes: one line more at its end, so line 2 is the same line. */
export const otherBytes = (text) => `${text}// SYNTHETIC: one line more\n`;
/** The working folder's file as a request of a change that two places hold names it: by its absolute path. */
export const HERE = `${ROOT}/src/parse.js`;
/** The sibling's copy of it, by its absolute path (the change's own name for it). */
export const THERE = `${SIBLING}/src/parse.js`;
/** The working folder's second copy of parse.js (`places: 'twoPaths'`), under another name. */
export const COPY = 'src/copy.js';

/** A finding of the review agent on line 2 of parse.js at `path` (as a request names it), its trace one step there. */
export const findingOn = (fixture, path, over = {}) => fixture.reviewFinding({ trace: [{ step: 'An empty string '
  + 'splits into one empty part.', path, side: 'new', startLine: 2, endLine: 2, quote: fixture.PARSE_QUOTE }],
anchor: { path, side: 'new', startLine: 2, endLine: 2 }, ...over });
/** A triage entry for `key`, in the review agent's contract. */
export const triageEntry = (key, over = {}) => ({ key, level: 'low', impact: 'An empty input gives you one empty part.',
  action: 'Return an empty list for empty input.', label: 'fix empty input', where: null, ...over });

/**
 * The scenario. `places`: `'same'` (the sibling holds parse.js byte for byte), `'other'` (the sibling's parse.js has
 * other bytes, line 2 the same), `'twoPaths'` (no sibling: the working folder holds parse.js and a byte-for-byte copy,
 * `COPY`). `copy`: with `'same'` or `'other'`, the working folder holds `COPY` too. `findings`: the review agent's
 * findings; `triage`: its triage list (none when absent). `verify(shown, key)`: a finding's check, by its key (`F1`,
 * `F2`, …), or null for the fixture's `holds`. `seen` receives every request.
 */
export async function runScenario(mods, { places = 'same', copy = false, findings = [], triage, verify = null,
  seen = [] } = {}) {
  const { runCodePass, codeSnapshotPlan, freezeCodeSnapshot, fixture } = mods;
  const { CODE_FILES, codeSession, verifiedFinding, batchItems, accountsHoldWith, withRun, holds, allSound } = fixture;
  const session = codeSession();
  const plan = codeSnapshotPlan(session);
  const parseText = CODE_FILES['src/parse.js'];
  const frozenWith = (text) => freezeCodeSnapshot(plan, plan.map((entry) => (entry.path === 'src/parse.js'
    ? { path: entry.path, bytes: enc(text) } : Object.hasOwn(CODE_FILES, entry.path)
      ? { path: entry.path, bytes: enc(CODE_FILES[entry.path]) } : { path: entry.path, state: 'deleted' })),
  { base: { kind: 'recorded_edits' } });
  const own = frozenWith(parseText);
  const parse = own.find((f) => f.path === 'src/parse.js');
  const texts = { ...CODE_FILES };
  let snapshot = own;
  let base = { kind: 'recorded_edits' };
  if (places === 'same' || places === 'other') {
    const text = places === 'same' ? parseText : otherBytes(parseText);
    texts[THERE] = text;
    const theirs = frozenWith(text).find((f) => f.path === 'src/parse.js');
    snapshot = [...own, { ...theirs, path: THERE, place: SIBLING }];
    base = { kind: 'recorded_edits', places: [{ kind: 'recorded_edits', at: SIBLING, written: 1 }] };
  }
  if (places === 'twoPaths' || copy) {
    texts[COPY] = parseText;
    snapshot = [...snapshot, { ...parse, path: COPY }];
  }
  // The repository reader: the working folder's files by their relative name, the sibling's by its absolute one; a
  // relative path that both places hold names none (cli code-snapshot.js `createRepositoryReader`'s `name`).
  const named = (path) => (String(path).startsWith(`${ROOT}/`) ? String(path).slice(ROOT.length + 1) : String(path));
  const holders = (path) => [path, `${SIBLING}/${path}`].filter((p) => Object.hasOwn(texts, p)).length;
  const repo = { root: ROOT, top: ROOT, base: () => null,
    read: (path) => (Object.hasOwn(texts, named(path)) ? { path: named(path), text: texts[named(path)],
      sha256: sha(texts[named(path)]) } : null),
    name: (path) => (typeof path === 'string' && !isAbsolute(path) && holders(path) > 1 ? { ambiguous: true }
      : { path }) };
  const judge = async (request) => {
    seen.push(request);
    if (request.label === 'code-review:agent' || request.label === 'code-review:repair')
      return withRun({ findings, questions: [], ...(triage ? { triage } : {}) });
    const check = /^code-verify:(F\d+)(:reask)?$/.exec(request.label);
    if (check) {
      const shown = verifiedFinding(request.prompt);
      return (verify ? verify(shown, check[1]) : null) ?? holds(shown);
    }
    if (/^code-verify:batch(:reask)?$/.test(request.label)) return allSound(batchItems(request.prompt));
    if (/^code-account:\d+(:reask)?$/.test(request.label)) return accountsHoldWith(null)(request.prompt);
    throw new Error(`unexpected ${request.label}`);
  };
  return runCodePass({ report: ONE_ASK, session, snapshot, repo, judge, root: ROOT, base });
}
