// Two synthetic sessions for the story's charts (M33 S5), each with its finished review report. They have the
// shapes whose "What happened" chart was unreadable on GitHub at page width: a 37-step session with ONE human
// request and eight helper agents spawned at eight different steps, and a 113-step session with ten requests.
// Every string, path and command is invented for this fixture.

import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
/** A delegate's recorded result, successful, pushed where the builder stands (a later step). */
const returned = (b, id) => b.events.push({ id: `${id}-r`, sequence: b.events.length, kind: 'observation', invocation: id,
  callKey: id, phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: [],
  sourceOfResult: 'native' });
const body = (step, version) => Array.from({ length: 8 }, (_, i) => (i === 2
  ? `  const bound${step} = ${version === 'after' ? 40 : 80}; // the arc bound of step ${step}`
  : `  // line ${i} of the arc slicer`)).join('\n');

// ---- 37 steps, one request, eight helpers ----------------------------------------------------------------

export const HELPERS_STEPS = 37;
export const HELPERS_ASK = 'Rework the arc slicer so every arc keeps its own instruction history. Keep redaction before '
  + 'hashing, keep the gate constants frozen, and make the whole suite pass before you commit.';
/** The eight helpers, by the step that spawns them: their brief, whether their child session changes a file in the
 *  repository, and the step whose events hold their recorded result (null: none recorded). */
export const HELPERS = Object.freeze({
  4: { brief: 'Map every caller of sliceSession in packages/cli', writes: null, result: 12 },
  6: { brief: 'Write golden tests for the arc slicer', writes: 'packages/slicer/test/arcs-golden.test.js', result: null },
  11: { brief: 'Port the cursor adapter to the new arc API', writes: 'packages/slicer/src/cursor.js', result: null },
  15: { brief: 'Review the redaction order in packages/redact', writes: null, result: 16 },
  20: { brief: 'Benchmark the slicer on the synthetic corpus sample', writes: null, result: null },
  25: { brief: 'Update the slicer section of the architecture notes', writes: 'docs/ARCHITECTURE.md', result: null },
  28: { brief: 'Add fixtures for sessions that hold no events', writes: 'packages/slicer/test/fixtures/empty.json', result: 30 },
  33: { brief: 'Check the gate constants are still frozen literals', writes: null, result: null },
});
const EXPLORE_37 = Object.freeze([1, 2, 3, 5, 14, 21]);
const EDIT_37 = Object.freeze([7, 8, 9, 10, 11, 16, 17, 18, 19, 22, 23, 24, 29, 30, 31, 34, 35]);
const FAILING_37 = Object.freeze([8, 23]);
const COMMIT_37 = Object.freeze([13, 27, 36]);
const TEST_ONLY_37 = Object.freeze([12, 26]);
export const HELPERS_PIVOT_STEPS = Object.freeze([10, 25]);
export const HELPERS_FINDINGS = Object.freeze({ 19: 'FYI', 37: 'DECIDE' });
export const HELPERS_CONTRADICTED = 32;

const READS = (s) => [`sed -n '1,120p' packages/slicer/src/part-${s % 6}.js`, 'rg -n "sliceSession" packages',
  `nl -ba packages/slicer/test/part-${s % 4}.test.js`, 'git log --oneline -5', 'cat packages/gate/constants.js'];
const slicerPath = (s) => ['packages/slicer/src/arcs.js', 'packages/slicer/src/records.js', 'packages/slicer/src/events.js'][s % 3];

export function helpersSession() {
  const b = sessionBuilder();
  const windows = [];
  const results = new Map(Object.entries(HELPERS).filter(([, h]) => h.result !== null).map(([s, h]) => [h.result, Number(s)]));
  for (let s = 1; s <= HELPERS_STEPS; s++) {
    const before = b.events.length;
    if (s === 1) b.ask('Q1', HELPERS_ASK);
    if (EXPLORE_37.includes(s) || s === HELPERS_CONTRADICTED) READS(s).slice(0, 3 + (s % 3)).forEach((c, i) => b.run(`R${s}-${i}`, c, 'succeeded', 'ok'));
    if (HELPERS[s]) {
      const { brief, writes } = HELPERS[s];
      const child = `h${s}`;
      b.run(`R${s}-0`, 'git status --short', 'succeeded', '');
      b.delegate(`D${s}`, brief, child);
      b.ask(`child:${child}:I0`, brief, 'agent', child);
      b.run(`child:${child}:C0`, `rg -n "arc" packages/slicer/src/part-${s % 6}.js`, 'succeeded', 'ok', child);
      if (writes) b.change(`child:${child}:W`, writes, { after: `// written by helper ${s}\nexport const part${s} = ${s};\n`, childId: child });
    }
    if (HELPERS_PIVOT_STEPS.includes(s)) b.say(`P${s}`, `Switching from the shared arc table to per-arc histories at step ${s}: the table broke the split.`);
    if (EDIT_37.includes(s)) {
      b.change(`E${s}`, slicerPath(s), { operation: 'edit', before: body(s, 'before'), after: body(s, 'after'), priorState: 'edit-text' });
      b.run(`T${s}`, `node --test packages/slicer/test/part-${s % 4}.test.js`, FAILING_37.includes(s) ? 'failed' : 'succeeded',
        FAILING_37.includes(s) ? 'fail 1' : 'fail 0');
    }
    if (TEST_ONLY_37.includes(s)) b.run(`T${s}`, 'npm test', 'succeeded', 'fail 0');
    if (COMMIT_37.includes(s)) b.run(`G${s}`, `git add -A && git commit -m "Arc histories, part ${s}"`, 'succeeded', '');
    if (s === 27) b.run('M27', 'git merge --no-ff topic/arc-histories', 'succeeded', '');
    if (results.has(s)) returned(b, `D${results.get(s)}`);
    if (s === 19) b.say('F19', 'I skipped the redaction check for empty spans to keep the arcs stable.');
    if (s === HELPERS_CONTRADICTED) b.change('O32', '/tmp/pr-body.md', { after: 'All slicer tests pass.\nRedaction runs first.\n', outside: true });
    if (s === HELPERS_STEPS) {
      b.run('T37', 'npm test', 'failed', 'tests 52\npass 51\nfail 1');
      b.say('F37', 'All tests pass and the arc slicer is done.', 'final');
    }
    windows.push(b.events.slice(before).map((event) => event.id));
  }
  const session = b.session('codex');
  const report = {
    repo: { host: 'github.com', id: '0' }, pr: null, reviewScope: 'session-only',
    decisions: [
      { dimension: 'arc bound', chosen: 'forty events per arc', actions: ['E8'], column: 'unasked', columnState: 'grounded', materiality: 'material' },
      { dimension: 'history store', chosen: 'one list per arc', actions: ['E10'], column: 'asked-settled', columnState: 'grounded', materiality: 'structural' },
      { dimension: 'arc ids', chosen: 'content hashes', actions: ['E22'], column: 'unasked', columnState: 'grounded', materiality: 'structural' },
    ],
    findings: [
      { origin: 'session-review', kind: 'code_issue', status: 'FYI', title: 'The redaction check was skipped for empty spans',
        explanation: 'Synthetic.', scope: 'session-effect', anchor: null, id: 'sha256:s5-f19',
        receipts: [receipt('commentary', 'F19', 'I skipped the redaction check for empty spans')] },
      { origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
        title: 'The final message says all tests pass; the last test run failed', explanation: 'Synthetic.',
        scope: 'session-effect', anchor: null, id: 'sha256:s5-f37',
        receipts: [receipt('commentary', 'F37', 'All tests pass'), receipt('observation', 'T37-r', 'fail 1')] },
    ],
    pivots: HELPERS_PIVOT_STEPS.map((s) => ({ abandoned: 'a shared arc table', adopted: 'per-arc histories',
      receipts: [receipt('commentary', `P${s}`, `Switching from the shared arc table to per-arc histories at step ${s}`)] })),
    requirements: [
      { instruction: receipt('instruction', 'Q1', 'every arc keeps its own instruction history'), text: 'Arcs keep their own history', status: 'addressed' },
      { instruction: receipt('instruction', 'Q1', 'Keep redaction before hashing'), text: 'Redaction stays before hashing', status: 'addressed' },
      { instruction: receipt('instruction', 'Q1', 'make the whole suite pass before you commit'), text: 'The suite passes before the commit', status: 'open' },
    ],
    promises: [],
    writtenClaims: [{ id: 'sha256:s5-w32', text: 'All slicer tests pass', label: 'contradicted',
      stated: receipt('code', 'O32', 'All slicer tests pass'), receipts: [receipt('code', 'O32', 'All slicer tests pass')] }],
    windowResults: windows.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null })),
    sessionStatus: 'DECIDE', reviewStatus: 'DECIDE', coverage: 'partial',
  };
  return { session, report };
}

// ---- 113 steps, ten requests ----------------------------------------------------------------------------------

export const MANY_STEPS = 113;
/** The step each request starts in. */
export const MANY_ASK_STEPS = Object.freeze([1, 12, 24, 35, 47, 58, 70, 81, 93, 104]);
/** Helpers spawned, by step. */
export const MANY_HELPERS = Object.freeze({ 8: 1, 31: 2, 42: 1, 65: 2, 77: 1, 100: 1, 111: 1 });
export const MANY_PIVOT_STEPS = Object.freeze([15, 40, 52, 75, 88, 108]);
export const MANY_FINDINGS = Object.freeze({ 30: 'FYI', 69: 'FYI', 113: 'DECIDE' });
export const MANY_CONTRADICTED = 97;

/** What a step of a request does, by its place in the request: reads first, then edits with tests, a commit, a
 *  helper or more reading, edits again, and reading to the end. */
function manyRole(s) {
  const start = MANY_ASK_STEPS.filter((a) => a <= s).pop();
  const k = s - start;
  if (MANY_HELPERS[s]) return 'helpers';
  if (k <= 1 || k >= 10) return 'explore';
  if (k === 6) return 'commit';
  if (k === 7) return 'explore';
  return 'edit';
}

/** The steps whose test run failed: every seventeenth step that edits, and the last. */
export const MANY_FAILING = Object.freeze([...Array.from({ length: MANY_STEPS - 1 }, (_, i) => i + 1)
  .filter((s) => manyRole(s) === 'edit' && s % 17 === 0), MANY_STEPS]);

export function manyRequestSession() {
  const b = sessionBuilder();
  const windows = [];
  for (let s = 1; s <= MANY_STEPS; s++) {
    const before = b.events.length;
    const ask = MANY_ASK_STEPS.indexOf(s);
    if (ask !== -1) b.ask(`Q${ask + 1}`, `Request ${ask + 1}: carry the instruction history into window part ${ask + 1}, keep every `
      + 'receipt grounded, and commit when the suite passes.');
    const role = manyRole(s);
    if (role === 'explore') READS(s).slice(0, 2 + (s % 4)).forEach((c, i) => b.run(`R${s}-${i}`, c, 'succeeded', 'ok'));
    if (role === 'edit') {
      b.change(`E${s}`, `packages/evidence/src/window-${s % 5}.js`, { operation: 'edit', before: body(s, 'before'), after: body(s, 'after'),
        priorState: 'edit-text' });
      b.run(`T${s}`, `node --test packages/evidence/test/window-${s % 5}.test.js`, s % 17 === 0 ? 'failed' : 'succeeded', 'ok');
    }
    if (role === 'commit') b.run(`G${s}`, `git add -A && git commit -m "Window part ${s}"`, 'succeeded', '');
    for (let h = 1; h <= (MANY_HELPERS[s] ?? 0); h++) {
      const child = `m${s}x${h}`;
      b.delegate(`D${s}-${h}`, `Check window part ${s}.${h} for dropped instructions`, child);
      b.ask(`child:${child}:I0`, `Check window part ${s}.${h} for dropped instructions`, 'agent', child);
      b.change(`child:${child}:W`, `packages/evidence/test/part-${s}-${h}.test.js`, { after: `test ${s}.${h}\n`, childId: child });
    }
    if (MANY_PIVOT_STEPS.includes(s)) b.say(`P${s}`, `Switching from approach ${s} to a carried list: the first one dropped instructions.`);
    if (MANY_FINDINGS[s] === 'FYI') b.say(`F${s}`, `I widened the window at step ${s} so the split fits.`);
    if (s === MANY_CONTRADICTED) b.change(`O${s}`, '/tmp/pr-body.md', { after: 'Every window keeps its history.\n', outside: true });
    if (s === MANY_STEPS) {
      b.run('T-last', 'npm test', 'failed', 'fail 2');
      b.say('F-last', 'All checks pass.', 'final');
    }
    windows.push(b.events.slice(before).map((event) => event.id));
  }
  const session = b.session('codex');
  const report = {
    repo: { host: 'github.com', id: '0' }, pr: null, reviewScope: 'session-only',
    decisions: [2, 26, 49, 72, 95].map((s, i) => ({ dimension: `window rule ${i}`, chosen: `option ${i}`, actions: [`E${s + 2}`],
      column: 'unasked', columnState: 'grounded', materiality: 'material' })),
    findings: [
      ...[30, 69].map((s) => ({ origin: 'session-review', kind: 'code_issue', status: 'FYI', title: `The window was widened at step ${s} without a test`,
        explanation: 'Synthetic.', scope: 'session-effect', anchor: null, id: `sha256:s5-many-${s}`,
        receipts: [receipt('commentary', `F${s}`, 'I widened the window')] })),
      { origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE', title: 'The final message says all checks pass; the last run failed',
        explanation: 'Synthetic.', scope: 'session-effect', anchor: null, id: 'sha256:s5-many-last',
        receipts: [receipt('commentary', 'F-last', 'All checks pass'), receipt('observation', 'T-last-r', 'fail 2')] },
    ],
    pivots: MANY_PIVOT_STEPS.map((s) => ({ abandoned: `approach ${s}`, adopted: 'a carried list',
      receipts: [receipt('commentary', `P${s}`, `Switching from approach ${s}`)] })),
    requirements: MANY_ASK_STEPS.map((_, i) => ({ instruction: receipt('instruction', `Q${i + 1}`, 'keep every receipt grounded'),
      text: 'Receipts stay grounded', status: i % 3 ? 'addressed' : 'open' })),
    promises: [],
    writtenClaims: [{ id: 'sha256:s5-many-w', text: 'Every window keeps its history', label: 'contradicted',
      stated: receipt('code', `O${MANY_CONTRADICTED}`, 'Every window keeps its history'),
      receipts: [receipt('code', `O${MANY_CONTRADICTED}`, 'Every window keeps its history')] }],
    windowResults: windows.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null })),
    sessionStatus: 'DECIDE', reviewStatus: 'DECIDE', coverage: 'partial',
  };
  return { session, report };
}

// ---- many requests, each with steps that need your decision (M33 S5 review) ------------------------------------

/** Where a request's decisions sit, by the step's place in the request (0–10), and what each place does. */
export const DECIDE_PLACES = Object.freeze([3, 8]);
const DECIDE_ROLES = Object.freeze(['explore', 'explore', 'edit', 'edit', 'edit', 'edit', 'commit', 'helpers', 'edit', 'edit', 'explore']);

/**
 * `requests` requests of eleven steps each, `perRequest` of them (at the places in `DECIDE_PLACES`) holding a finding
 * that needs your decision; each request also changes its approach once (place 5), and every other one spawns a
 * helper (place 7). The shape the review found the first overview dropping findings from.
 */
export function decideSession({ requests = 10, perRequest = 2 } = {}) {
  const b = sessionBuilder();
  const windows = [], findings = [], pivots = [];
  for (let r = 0; r < requests; r++) {
    for (let k = 0; k < DECIDE_ROLES.length; k++) {
      const before = b.events.length;
      const s = r * DECIDE_ROLES.length + k + 1;
      if (k === 0) b.ask(`Q${r + 1}`, `Request ${r + 1}: move window part ${r + 1} onto the carried list and keep its receipts.`);
      const role = DECIDE_ROLES[k] === 'helpers' && r % 2 ? 'explore' : DECIDE_ROLES[k];
      if (role === 'explore') READS(s).slice(0, 2 + (s % 3)).forEach((c, i) => b.run(`R${s}-${i}`, c, 'succeeded', 'ok'));
      if (role === 'edit') {
        b.change(`E${s}`, `packages/evidence/src/part-${r}.js`, { operation: 'edit', before: body(s, 'before'), after: body(s, 'after'),
          priorState: 'edit-text' });
        b.run(`T${s}`, `node --test packages/evidence/test/part-${r}.test.js`, 'succeeded', 'ok');
      }
      if (role === 'commit') b.run(`G${s}`, `git add -A && git commit -m "Part ${r + 1}"`, 'succeeded', '');
      if (role === 'helpers') {
        b.delegate(`D${s}`, `Check part ${r + 1} for dropped receipts`, `d${s}`);
        b.ask(`child:d${s}:I0`, `Check part ${r + 1} for dropped receipts`, 'agent', `d${s}`);
      }
      if (k === 5) {
        b.say(`P${s}`, `Switching part ${r + 1} from a copied list to the carried one.`);
        pivots.push({ abandoned: 'a copied list', adopted: 'the carried list',
          receipts: [receipt('commentary', `P${s}`, `Switching part ${r + 1} from a copied list`)] });
      }
      if (DECIDE_PLACES.slice(0, perRequest).includes(k)) {
        b.say(`F${s}`, `I dropped the receipt check in part ${r + 1} at step ${s}.`);
        findings.push({ origin: 'session-review', kind: 'code_issue', status: 'DECIDE',
          title: `Receipt check dropped at step ${s}`, explanation: 'Synthetic.', scope: 'session-effect', anchor: null,
          id: `sha256:s5-decide-${s}`, receipts: [receipt('commentary', `F${s}`, `I dropped the receipt check in part ${r + 1}`)] });
      }
      windows.push(b.events.slice(before).map((event) => event.id));
    }
  }
  const session = b.session('codex');
  const report = { repo: { host: 'github.com', id: '0' }, pr: null, reviewScope: 'session-only', decisions: [], findings, pivots,
    requirements: [], promises: [], writtenClaims: [],
    windowResults: windows.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null })),
    sessionStatus: 'DECIDE', reviewStatus: 'DECIDE', coverage: 'partial' };
  return { session, report };
}
