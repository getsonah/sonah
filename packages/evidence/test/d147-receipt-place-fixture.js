// D147: one code step over a synthetic change that one place or more holds a file of, with deterministic fake agents.
// Every byte is invented: no recording, no model, no network. The code step's modules and the fixture's helpers are
// passed in (`mods`), so the same scenario can run against another tree of the code.
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const enc = (text) => new TextEncoder().encode(text);
/** The working directory, and the folder of another place of the change (a sibling worktree of one project). */
export const ROOT = '/work/repo';
export const SIBLING = '/work/sibling';
const R = (eventId, role, quote) => ({ eventId, role, quote });

/** A report over the fixture's session with one ask, and nothing else in the accounting's scope. */
export const ONE_ASK = Object.freeze({ repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [],
  pivots: [], failures: [], promises: [], writtenClaims: [], decisions: [],
  requirements: [{ text: 'SYNTHETIC ask 1', status: 'done',
    instruction: R('I1', 'instruction', 'add a parse function that returns [] for empty input') }] });

/** A path as an answer names it: relative to the working directory, or absolute (under the working directory). */
export const spelled = (path, absolute) => (absolute && !isAbsolute(path) ? `${ROOT}/${path}` : path);

/**
 * The scenario. `places`: `'one'` (the working folder's repository alone holds the change), `'listed'` (as `'one'`, but
 * the base also lists another place, which holds no file of the change), `'sibling'` (another place alone holds a file
 * of the change, the working folder's repository none) or `'both'` (each holds `src/parse.js`, so the relative path
 * names a file in two places). `first` and `again`: whether each check's first answer and its re-ask name
 * the file by its absolute path. `seen` receives every request.
 */
export async function runScenario(mods, { places = 'both', first = false, again = true, seen = [] } = {}) {
  const { runCodePass, codeSnapshotPlan, freezeCodeSnapshot, fixture } = mods;
  const { CODE_FILES, codeSession, reviewFinding, verifiedFinding, batchItems, accountItemsShown, withRun,
    readsEveryFile, holds, PARSE_QUOTE } = fixture;
  const session = codeSession();
  const plan = codeSnapshotPlan(session);
  const own = freezeCodeSnapshot(plan, plan.map((entry) => (Object.hasOwn(CODE_FILES, entry.path)
    ? { path: entry.path, bytes: enc(CODE_FILES[entry.path]) } : { path: entry.path, state: 'deleted' })),
  { base: { kind: 'recorded_edits' } });
  const parse = own.find((f) => f.path === 'src/parse.js');
  const there = { ...parse, path: `${SIBLING}/src/parse.js`, place: SIBLING };
  const snapshot = ['one', 'listed'].includes(places) ? own : places === 'sibling' ? [there] : [...own, there];
  const base = { kind: 'recorded_edits', ...(places === 'one' ? {} : { places: [{ kind: 'recorded_edits', at: SIBLING,
    written: 1 }] }) };
  // The repository reader: the working folder's files by their relative name, the sibling's by its absolute one; a
  // relative path that both places hold names none (cli code-snapshot.js `createRepositoryReader`'s `name`).
  const texts = { ...CODE_FILES, [`${SIBLING}/src/parse.js`]: CODE_FILES['src/parse.js'] };
  const named = (path) => (String(path).startsWith(`${ROOT}/`) ? String(path).slice(ROOT.length + 1) : String(path));
  const repo = { root: ROOT, top: ROOT, base: () => null,
    read: (path) => (Object.hasOwn(texts, named(path)) ? { path: named(path), text: texts[named(path)],
      sha256: sha(texts[named(path)]) } : null),
    name: (path) => (places === 'both' && path === 'src/parse.js' ? { ambiguous: true }
      : places === 'sibling' && path === 'src/parse.js' ? { path: `${SIBLING}/src/parse.js` } : { path }) };
  const where = places === 'sibling' ? `${SIBLING}/src/parse.js` : 'src/parse.js';
  const at = (absolute) => ({ path: spelled(where, absolute), side: 'new', startLine: 2, endLine: 2, quote: PARSE_QUOTE });
  const reasked = (request) => /:reask$/.test(request.label);
  const absoluteFor = (request) => (reasked(request) ? again : first);
  // Each check quotes line 2 of parse.js, by the spelling its turn asks for.
  const respell = (r, absolute) => ({ ...r, path: places === 'sibling' ? r.path : spelled(named(r.path), absolute) });
  // The review agent names the file so that it grounds: by its absolute path when two places hold its relative one.
  const { quote: _quote, ...anchor } = at(places === 'both');
  const finding = reviewFinding({ trace: [{ step: 'An empty string splits into one empty part.', ...at(places === 'both') }],
    anchor });
  const judge = async (request) => {
    seen.push(request);
    if (request.label === 'code-review:agent' || request.label === 'code-review:repair')
      return withRun({ findings: [finding], questions: [{ question: 'SYNTHETIC: should parse("") return [] or throw?',
        key: 'S1', quote: 'add a parse function' }] }, readsEveryFile(request));
    if (/^code-verify:F\d+(:reask)?$/.test(request.label)) {
      const verdict = holds(verifiedFinding(request.prompt));
      const a = absoluteFor(request);
      return { ...verdict, receipts: verdict.receipts.map((r) => respell(r, a)),
        premises: verdict.premises.map((p) => ({ ...p, receipts: p.receipts.map((r) => respell(r, a)) })) };
    }
    if (/^code-verify:batch(:reask)?$/.test(request.label))
      return { questions: batchItems(request.prompt).map(({ key }) => ({ key, verdict: 'sound',
        receipts: [at(absoluteFor(request))], explanation: 'SYNTHETIC: traced.' })) };
    if (/^code-account:\d+(:reask)?$/.test(request.label))
      return { entries: accountItemsShown(request.prompt).map(({ key }) => ({ key, outcome: 'holds',
        receipts: [at(absoluteFor(request))], by: null, finding: null })), findings: [] };
    throw new Error(`unexpected ${request.label}`);
  };
  return runCodePass({ report: ONE_ASK, session, snapshot, repo, judge, root: ROOT, base });
}
