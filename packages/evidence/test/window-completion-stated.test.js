// W3d-5 / F177. Every incomplete window says why, in a closed token, and the report counts them.
//
// A report could count more incomplete windows than it gave a reason for: either the count was
// wrong or windows were incomplete with no stated reason, and the product gave no way to tell. Now it does: a window is
// complete (`failure === null && groundingComplete && challenge.complete`) if and only if
// `windowIncompleteReasons` returns nothing, and `report.instrument.windowCompletion.unexplained`
// counts the windows for which that fails. It must be 0.
//
// Every byte is synthetic: invented instructions, paths, outputs and model replies. No model is
// called. The last test re-runs this package's own tests with a loader hook that checks every
// report they build; it reads only this repository's test files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as reviewRun from '../src/run-review.js';
import { JUDGE_FAILURE_CODES } from '../src/ledger.js';
import { CHALLENGE_PROFILE } from '../src/challenge.js';
import { Session } from '../src/session.js';

const { NARRATIVE_SHORTFALL, CHALLENGE_SHORTFALL, runReview } = reviewRun;
const HERE = dirname(fileURLToPath(import.meta.url));
const complete = (w) => w.failure === null && w.groundingComplete === true && w.challenge?.complete === true;

// ---- the vocabulary ---------------------------------------------------------------------------

test('F177 WINDOW_INCOMPLETE_REASONS is one frozen list: every narrative shortfall, both grounding halves, every challenge shortfall', () => {
  const { WINDOW_INCOMPLETE_REASONS } = reviewRun;
  assert.ok(Object.isFrozen(WINDOW_INCOMPLETE_REASONS));
  assert.deepEqual([...WINDOW_INCOMPLETE_REASONS].sort(), [
    ...NARRATIVE_SHORTFALL.filter((code) => code !== 'ok').map((code) => `narrative:${code}`),
    'grounding:session', 'grounding:relevance',
    ...CHALLENGE_SHORTFALL.map((reason) => `challenge:${reason}`),
  ].sort());
  assert.equal(new Set(WINDOW_INCOMPLETE_REASONS).size, WINDOW_INCOMPLETE_REASONS.length);
  for (const token of WINDOW_INCOMPLETE_REASONS) assert.match(token, /^(narrative|grounding|challenge):[a-z_]+$/);
});

// ---- the matrix -------------------------------------------------------------------------------

const CHALLENGE_STATES = {
  complete: () => ({ complete: true, executionComplete: true, attemptedCalls: 3, rejected: [], results: [], profile: CHALLENGE_PROFILE }),
  budget_exhausted: () => ({ complete: false, budgetExhausted: true, attemptedCalls: 0, rejected: [], results: [], profile: CHALLENGE_PROFILE }),
  votes_invalid: () => ({ complete: false, attemptedCalls: 3, rejected: [], profile: CHALLENGE_PROFILE,
    results: [{ key: 'decisions:0', votes: [{ valid: true }, { valid: false }] }] }),
  items_unresolved: () => ({ complete: false, attemptedCalls: 3, rejected: [], profile: CHALLENGE_PROFILE,
    results: [{ key: 'decisions:0', votes: [{ valid: true }] }] }),
};
const FAILURES = [null, 'unreviewed_scope', ...JUDGE_FAILURE_CODES];
// What `shortfall.narrative` says. The reasons are derived from `failure`, which completeness reads;
// the shortfall only says which kind of unusable answer it was — so a shortfall that is absent or
// even wrong ('ok' beside a failure) must not lose the reason.
const SHORTFALL_NARRATIVE = [undefined, 'ok', 'schema', 'no_json'];

/** A window result exactly as `reviewWindow` derives one from these four inputs. */
function windowResult({ failure, said, sessionGrounded, relevance, challenge }) {
  const sessionGroundingComplete = sessionGrounded && failure === null;
  const relevanceComplete = relevance && failure === null;
  return { failure, challenge: CHALLENGE_STATES[challenge](), narrative: failure === null ? { decisions: [] } : null,
    groundingComplete: sessionGroundingComplete && relevanceComplete, sessionGroundingComplete, relevanceComplete,
    shortfall: said === undefined ? undefined : { narrative: said, challenge: { reason: null } } };
}

function* matrix() {
  for (const failure of FAILURES) for (const said of SHORTFALL_NARRATIVE)
    for (const sessionGrounded of [true, false]) for (const relevance of [true, false])
      for (const challenge of Object.keys(CHALLENGE_STATES))
        yield { inputs: { failure, said, sessionGrounded, relevance, challenge },
          window: windowResult({ failure, said, sessionGrounded, relevance, challenge }) };
}

test('F177 over every combination of failure, session grounding, relevance and challenge state: complete iff no reason', () => {
  const { windowIncompleteReasons, WINDOW_INCOMPLETE_REASONS } = reviewRun;
  let combinations = 0, incomplete = 0;
  for (const { inputs, window } of matrix()) {
    combinations++;
    const reasons = windowIncompleteReasons(window);
    const label = JSON.stringify(inputs);
    assert.ok(Array.isArray(reasons), label);
    assert.equal(new Set(reasons).size, reasons.length, `${label}: a reason repeated`);
    for (const reason of reasons) assert.ok(WINDOW_INCOMPLETE_REASONS.includes(reason), `${label}: ${reason}`);
    assert.equal(reasons.length === 0, complete(window), `${label}: complete=${complete(window)} reasons=${reasons}`);
    if (!complete(window)) incomplete++;
    if (inputs.failure !== null) {
      // The call failed: that is the one cause. Its grounding and challenge never had an answer to fall short on.
      assert.equal(reasons.length, 1, label);
      assert.match(reasons[0], /^narrative:/, label);
      if (inputs.failure === 'unreviewed_scope' || inputs.failure === 'budget_exhausted') assert.equal(reasons[0], 'narrative:budget', label);
      if (inputs.failure === 'model_tool_use') assert.equal(reasons[0], 'narrative:tool_use', label);
      if (inputs.failure === 'model_response_invalid')
        assert.equal(reasons[0], inputs.said === 'schema' ? 'narrative:schema' : 'narrative:no_json', label);
    } else {
      assert.equal(reasons.includes('grounding:session'), !inputs.sessionGrounded, label);
      assert.equal(reasons.includes('grounding:relevance'), !inputs.relevance, label);
      assert.deepEqual(reasons.filter((r) => r.startsWith('challenge:')),
        inputs.challenge === 'complete' ? [] : [`challenge:${inputs.challenge}`], label);
    }
  }
  assert.equal(combinations, FAILURES.length * SHORTFALL_NARRATIVE.length * 2 * 2 * 4);
  assert.ok(incomplete > 0 && incomplete < combinations, 'premise: the matrix holds both kinds of window');
});

test('F177 windowCompletion counts the matrix: every incomplete window explained, each reason counted in vocabulary order', () => {
  const { windowCompletion, WINDOW_INCOMPLETE_REASONS } = reviewRun;
  const windows = [...matrix()].map(({ window }) => window);
  const counted = windowCompletion(windows);
  assert.equal(counted.windows, windows.length);
  assert.equal(counted.complete, windows.filter(complete).length);
  assert.equal(counted.unexplained, 0);
  assert.deepEqual(Object.keys(counted.byReason), WINDOW_INCOMPLETE_REASONS.filter((r) => counted.byReason[r] > 0));
  assert.deepEqual(Object.keys(counted.byReason), [...WINDOW_INCOMPLETE_REASONS], 'every token occurs somewhere in the matrix');
  for (const reason of WINDOW_INCOMPLETE_REASONS)
    assert.equal(counted.byReason[reason], windows.filter((w) => reviewRun.windowIncompleteReasons(w).includes(reason)).length, reason);
});

test('F177 a window record that is incomplete with no derivable reason is counted, never hidden', () => {
  const { windowCompletion, windowIncompleteReasons } = reviewRun;
  const whole = windowResult({ failure: null, said: 'ok', sessionGrounded: true, relevance: true, challenge: 'complete' });
  const corrupt = [
    { ...whole, groundingComplete: false },       // both halves say complete; the whole says not
    { ...whole, failure: undefined },              // no failure recorded at all — not the same as none
    { ...whole, challenge: { ...whole.challenge, complete: 'yes' } },
  ];
  // The last is explained: a challenge that is not `complete: true` is incomplete for a stated reason.
  assert.deepEqual(corrupt.map((w) => windowIncompleteReasons(w)), [[], [], ['challenge:items_unresolved']]);
  assert.deepEqual(windowCompletion([whole, ...corrupt]),
    { windows: 4, complete: 1, byReason: { 'challenge:items_unresolved': 1 }, unexplained: 2 });
  assert.deepEqual(windowCompletion([]), { windows: 0, complete: 0, byReason: {}, unexplained: 0 });
  assert.deepEqual(windowCompletion(null), { windows: 0, complete: 0, byReason: {}, unexplained: 0 });
});

// ---- a whole run -------------------------------------------------------------------------------

const ASK = 'SYNTHETIC_F177_ASK: write the three modules.';
// M35 windowing: a compaction no longer splits; each module's thought is long (150k bytes), so a combined review (a
// ~196k-byte work budget) cuts the one task at its thoughts into three windows.
function threeWindows() {
  const blobs = { ask: ASK, ok: 'SYNTHETIC_F177_OK: written.' };
  for (const n of [1, 2, 3]) blobs[`said${n}`] = `SYNTHETIC_F177_SAID_${n}: writing module ${n}.\n${'w'.repeat(150_000)}`;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = [{ id: 'I1', kind: 'instruction', authority: 'human', sequence: 0, text: whole('ask'), supersedes: [] }];
  let sequence = 1;
  for (const n of [1, 2, 3]) {
    events.push({ id: `C${n}`, kind: 'commentary', phase: 'working', sequence: sequence++, text: whole(`said${n}`) },
      { id: `A${n}`, kind: 'invocation', operation: 'write', tool: 'Write', sequence: sequence++, paths: [{ path: `src/m${n}.js` }] },
      { id: `O${n}`, kind: 'observation', phase: 'terminal', invocation: `A${n}`, result: 'succeeded', sequence: sequence++, output: whole('ok') });
    if (n < 3) events.push({ id: `B${n}`, kind: 'boundary', boundary: 'compaction', sequence: sequence++ });
  }
  return new Session({ sessionKey: 'sess-f177', adapter: 'claude', events, blobs });
}
const PR = { repo: { host: 'github.com', id: '177' }, number: 1, enumeration: 'complete',
  files: [1, 2, 3].map((n) => ({ path: `src/m${n}.js`, change: 'added', contentState: 'complete' })) };
const decision = (n) => ({ dimension: `SYNTHETIC_F177_DIMENSION_${n}`, chosen: `Write src/m${n}.js`, actions: [`A${n}`],
  value: `src/m${n}.js`, valueReceipt: { eventId: `A${n}`, role: 'action', field: 'path', quote: `src/m${n}.js` },
  stated: { eventId: `C${n}`, role: 'commentary', quote: `SYNTHETIC_F177_SAID_${n}` },
  constrainedBy: { instruction: { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_F177_ASK' }, settles: false, settledValueQuote: null } });

test('F177 a review states how many windows completed and why each other one did not', async () => {
  // Window 1 completes. Window 2's call fails. Window 3's challenge runs out of budget.
  const judge = async (request) => {
    const n = Number(/:w(\d+)/.exec(request.label ?? '')?.[1] ?? 0);
    if (request.challenge && n === 3) throw Object.assign(new Error('synthetic'), { code: 'budget_exhausted' });
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'SYNTHETIC: the instruction asks for it.',
      receipts: [{ eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_F177_ASK' }] })) };
    if (n === 2) throw Object.assign(new Error('synthetic'), { code: 'model_unavailable' });
    return { decisions: [decision(n)], pivots: [], claims: [], requirements: [] };
  };
  const report = await runReview({ session: threeWindows(), pr: PR, judge });
  const reasons = report.windowResults.map((w) => reviewRun.windowIncompleteReasons(w));
  assert.deepEqual(reasons.map((r, i) => [i + 1, r.length === 0]), [[1, true], [2, false], [3, false]]);
  assert.deepEqual(reasons[1], ['narrative:model_unavailable']);
  const { windowCompletion } = report.instrument;
  assert.equal(windowCompletion.windows, 3);
  assert.equal(windowCompletion.complete, 1);
  assert.equal(windowCompletion.unexplained, 0);
  assert.deepEqual(reasons[2], ['challenge:budget_exhausted']);
  assert.deepEqual(windowCompletion.byReason, { 'narrative:model_unavailable': 1, 'challenge:budget_exhausted': 1 });
});

// ---- every report the evidence tests build ---------------------------------------------------

// A loader hook that wraps `runReview` for one run of this package's tests. Every report any of them
// builds is checked — complete iff no reason, every reason in vocabulary, the instrument equal to a
// recount — and one line of counts (never session text) is appended per report.
const HOOKS = `
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith('/packages/evidence/src/run-review.js')) return result;
  const source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source);
  const marker = 'export async function runReview(';
  if (!source.includes(marker)) throw new Error('W3d-5 completion check: runReview was not found');
  return { ...result, shortCircuit: true, source: "import { appendFileSync as appendW3d5 } from 'node:fs';\\n"
    + source.replace(marker, 'async function runReviewUncheckedW3d5(') + CHECK };
}
const CHECK = \`
export async function runReview(...args) {
  const report = await runReviewUncheckedW3d5(...args);
  const windows = Array.isArray(report?.windowResults) ? report.windowResults : [];
  const violations = [];
  for (const [index, w] of windows.entries()) {
    const done = w.failure === null && w.groundingComplete === true && w.challenge?.complete === true;
    const reasons = windowIncompleteReasons(w);
    if (done !== (reasons.length === 0) || reasons.some((r) => !WINDOW_INCOMPLETE_REASONS.includes(r)))
      violations.push({ index, done, reasons, failure: typeof w.failure === 'string' ? w.failure : String(w.failure) });
  }
  const stated = report?.instrument?.windowCompletion;
  if (JSON.stringify(stated) !== JSON.stringify(windowCompletion(windows)) || stated?.unexplained !== 0)
    violations.push({ instrument: stated ?? null });
  appendW3d5(process.env.SONAH_W3D5_COMPLETION_OUT, JSON.stringify({ windows: windows.length,
    incomplete: windows.length - (stated?.complete ?? 0), violations }) + '\\\\n');
  return report;
}\`;
`;

test('F177 every window of every report the existing evidence tests build: complete iff it has a recorded reason', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-w3d5-completion-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = join(dir, 'reports.jsonl');
  await writeFile(join(dir, 'hooks.mjs'), HOOKS);
  await writeFile(join(dir, 'register.mjs'),
    `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(join(dir, 'hooks.mjs')).href)});\n`);
  await writeFile(out, '');
  const self = basename(fileURLToPath(import.meta.url));
  const files = (await readdir(HERE)).filter((f) => f.endsWith('.test.js') && f !== self).sort().map((f) => join(HERE, f));
  const env = { ...process.env, SONAH_W3D5_COMPLETION_OUT: out };
  delete env.NODE_TEST_CONTEXT;   // a nested runner, not a child reporting to this one
  let run;
  try {
    // Node < 23 defaults to TAP when stdout is not a TTY; pin the reporter the footer check reads.
    run = await promisify(execFile)(process.execPath, ['--test', '--test-reporter=spec', '--import', pathToFileURL(join(dir, 'register.mjs')).href, ...files],
      { env, maxBuffer: 256 * 1024 * 1024 });
  } catch (error) {
    assert.fail(`the evidence tests did not pass under the completion check:\n${String(error.stdout ?? '').split('\n')
      .filter((line) => /^\s*(✖|not ok)|W3d-5/.test(line)).slice(0, 40).join('\n')}`);
  }
  assert.match(run.stdout, /^ℹ fail 0$/m);
  const reports = (await readFile(out, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const windows = reports.reduce((n, r) => n + r.windows, 0);
  const incomplete = reports.reduce((n, r) => n + r.incomplete, 0);
  t.diagnostic(`${files.length} test files, ${reports.length} reports, ${windows} windows checked, ${incomplete} of them incomplete`);
  assert.ok(reports.length >= 50, `only ${reports.length} reports were checked — the hook did not reach runReview`);
  assert.ok(incomplete > 0 && incomplete < windows, 'premise: the existing reports hold both kinds of window');
  assert.deepEqual(reports.flatMap((r) => r.violations), []);
});
