// M33 G4. Two statements the session review makes about itself, held to the code:
//   - README.md and docs/INSTALL.md said a session review that did not complete "reads UNCHECKED".
//     C-06 reads DECIDE whenever a supported DECIDE finding exists, whatever the completion; only
//     without one does an incomplete review read UNCHECKED (its FYI items retained). D71 (a) (owner
//     decision 2026-10-08): the docs tell no status at all now; they say the review did not complete.
//   - The session-review harness summary: its schema is `/2` now that each coverage cause is the
//     `{ n, atLeast }` shape, and it counts what the review withheld (by closed cause) and how many
//     agent claims were shown as their contradicted findings (`promisesAsFindings`). Counts only.
// Synthetic sessions and a fake transport only: no recording, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Session } from '../../evidence/src/session.js';
import { reduceSessionStatus, WITHHELD_REJECTION_CAUSES, WRITTEN_WITHHELD_CAUSES,
  PROMISE_STATUSES } from '../../evidence/src/ledger.js';

const README = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
const INSTALL = await readFile(new URL('../../../docs/INSTALL.md', import.meta.url), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');
const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS);
const SENTINEL = 'SYNTHETIC_G4_HARNESS';
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };

// ---- the docs ---------------------------------------------------------------------------------

test('M33 G4 premise: an incomplete session review with a supported DECIDE reads DECIDE; without one, UNCHECKED', () => {
  assert.equal(reduceSessionStatus([{ origin: 'session-review', status: 'DECIDE' }], 'partial', 'incomplete'), 'DECIDE');
  assert.equal(reduceSessionStatus([{ origin: 'session-review', status: 'FYI' }], 'partial', 'incomplete'), 'UNCHECKED');
  assert.equal(reduceSessionStatus([], 'complete', 'incomplete'), 'UNCHECKED');
});

for (const [name, text] of [['README.md', README], ['docs/INSTALL.md', INSTALL]]) {
  test(`M33 G4, D71 ${name}: an incomplete session review is said to have not completed, never by a status`, () => {
    const words = flat(text);
    // assert.ok, not assert.match: a failure names the sentence, never prints the whole document.
    assert.ok(!/reads UNCHECKED/.test(words), 'no status is told for an incomplete review');
    assert.ok(/did not complete/.test(words), 'it says the review did not complete');
  });
}

// ---- the harness summary ----------------------------------------------------------------------

/** A parent's write, its verified child's write, their results and the parent's final claim (`said`). */
function familySession(said = `${SENTINEL}_SAID: the worker is split out and every test passes.`) {
  const blobs = { ask: `${SENTINEL}_ASK: split the worker out and run the tests.`,
    brief: `${SENTINEL}_BRIEF: implement the worker module.`,
    root: `export const ${SENTINEL}_ROOT = 1;\n`, child: `export const ${SENTINEL}_CHILD = 2;\n`,
    rootOut: `${SENTINEL}_ROOT_OUT: File created successfully`, childOut: `${SENTINEL}_CHILD_OUT: File created successfully`,
    cmd: 'npm test', failed: `${SENTINEL}_FAILED: 2 tests failed`,
    said };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const write = (id, path, body, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Write', operation: 'write',
    paths: [{ path }], command: [], input: [], changes: [{ path, before: [], after: ref(body), diff: [] }], ...over });
  const result = (id, invocation, out, over = {}) => ({ id, kind: 'observation', phase: 'terminal', invocation,
    callKey: invocation, result: 'succeeded', exitCode: null, terminalStatusProven: true, sourceOfResult: 'native',
    output: ref(out), ...over });
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask') },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Task', operation: 'delegate', paths: [], command: [],
      input: ref('brief'), changes: [] },
    write('child:worker:A1', 'src/worker.js', 'child', { childId: 'worker' }),
    result('child:worker:O1', 'child:worker:A1', 'childOut', { childId: 'worker' }),
    write('A1', 'src/index.js', 'root'),
    result('O1', 'A1', 'rootOut'),
    { id: 'X1', kind: 'invocation', callKey: 'X1', tool: 'Bash', operation: 'command', paths: [], command: ref('cmd'),
      input: [], changes: [] },
    result('X1-r', 'X1', 'failed', { result: 'failed', exitCode: 1 }),
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref('said') },
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: 'session', adapter: 'claude', blobs, events, children: [{ assignmentEvent: 'D1',
    childId: 'worker', childSession: 'session/child:worker', sessionKey: 'session/child:worker', relation: 'spawn',
    state: 'verified', historyStart: null }] });
}

/** M35 windowing: the helper is a session of its own, reviewed in its own window (`w2`, right after the parent's
 *  window that launched it). The table answers the parent's window (`w1`); the helper's window proposes nothing. */
const parentWindow = (label) => /^(?:narrative|challenge):w1(?::|$)/.test(label ?? '');

async function run(t, session, answer) {
  const base = await mkdtemp(join(tmpdir(), 'sonah-m33-g4-harness-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const createJudge = ({ onResult }) => async (request) => {
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1 });
    return parentWindow(request.label) || request.challenge ? answer(request) : { ...EMPTY };
  };
  let stdout = '';
  const { summary } = await harness.runSessionReviewHarness({ parent: join(base, 'SYNTHETIC.jsonl'),
    codexHome: base, out: join(base, 'out'), backend: 'claude-cli', model: 'claude-synthetic-1', maxCalls: 50,
    maxSeconds: 60, timeoutMs: 1000, sessionKey: 'session', concurrency: 1 },
  { loadSession: async () => session, createJudge, write: (text) => { stdout += text; },
    progress: () => {}, installSignals: false });
  assert.doesNotMatch(stdout, new RegExp(SENTINEL), 'no session text leaves the harness');
  assert.deepEqual(JSON.parse(stdout.trim()), summary, 'stdout is the summary');
  return summary;
}

// /3 (M33 written statements): the summary also counts written statements by label, and the closed
// withheld causes include the written statements' own. /4 (M33 per-part verdicts): and the parts. /5 (M33
// review-WP2): and the session-wide entry's unchecked cause apart from the parts'. (m33-parts-harness.test.js)
// /8 (M33 C): and the promises by closed status. (M33 C recheck 2: code withholds no chat claim as not a claim, so
// the withheld causes are /7's.)
const CAUSES = [...WITHHELD_REJECTION_CAUSES, ...WRITTEN_WITHHELD_CAUSES];

test('M33 G4 the harness summary schema is /11 (the { n, atLeast } cause shape, written statements, parts; /6 M33 J; /7 M33 K; /8 M33 C; /9 M36 evidence requests; /10 D70 context window; /11 D71 no status)', () => {
  assert.equal(harness.HARNESS_SUMMARY_SCHEMA, 'sonah.session-review-harness/17');
});

test('M33 G4 the harness summary counts withheld proposals by closed cause and claims shown as findings', async (t) => {
  const stated = { eventId: 'C1', role: 'commentary', quote: 'the worker is split out and every test passes.' };
  const against = { eventId: 'X1-r', role: 'observation', quote: `${SENTINEL}_FAILED: 2 tests failed` };
  const decision = (actions, dimension) => ({ dimension, chosen: `${SENTINEL} the worker has its own module`,
    value: null, valueReceipt: null, actions, stated: null, constrainedBy: null });
  const summary = await run(t, familySession(), (request) => (request.challenge
    ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'Recorded.', receipts: [against] })) }
    : { ...EMPTY,
      decisions: [decision(['A1', 'child:worker:A1'], `${SENTINEL}_MIXED`), decision(['A1'], `${SENTINEL}_PARENT`)],
      claims: [{ text: `${SENTINEL}_CLAIM`, stated, contradictedBy: null },
        { text: `${SENTINEL}_CLAIM`, stated, contradictedBy: against }] }));
  assert.equal(summary.schema, 'sonah.session-review-harness/17');
  assert.equal(summary.state, 'finished');
  assert.equal(summary.decisions, 1, 'the single-actor decision is published');
  assert.equal(summary.findings, 1, 'premise: the contradicted claim is a finding');
  assert.equal(summary.promises, 0);
  assert.equal(summary.promisesAsFindings, 1, 'the claim shown as its finding is counted');
  assert.equal(summary.sessionReview, 'complete', 'the decision citing the helper\'s action leaves the review complete');
  assert.deepEqual(Object.keys(summary.withheld).sort(), ['causes', 'proposals', 'unsettled'], 'a closed shape');
  assert.deepEqual(Object.keys(summary.withheld.causes).sort(), [...CAUSES].sort(),
    'every closed cause, always');
  // M35 windowing: the parent's window never showed the helper's action. M36 phase 3 (D68 K): the small helper shares
  // the parent's window, under its own heading, so the decision citing both is asked and withheld by the ledger's actor
  // check — an ambiguous actor (`actor_ambiguous`), counted, never published.
  assert.equal(summary.withheld.proposals, 1);
  assert.equal(summary.withheld.unsettled, 0);
  assert.equal(summary.withheld.causes.actor_ambiguous, 1);
  for (const [cause, n] of Object.entries(summary.withheld.causes))
    assert.ok(Number.isSafeInteger(n) && n >= 0, cause);
  // M33 C: the promises by closed status, every status always present.
  assert.deepEqual(summary.promisesByStatus, Object.fromEntries(PROMISE_STATUSES.map((status) => [status, 0])));
});

test('M33 C the harness summary counts promises by status — counts only; a plan is refuted, never withheld by cause', async (t) => {
  // A plan the agent stated ("I will ...") is put to the challengers, who refute it (M33 C recheck 2: code withholds
  // no claim); a claim of done work is a promise, not checked.
  const session = familySession(`${SENTINEL}_SAID: the worker is split out. I will run the tests next.`);
  const done = { eventId: 'C1', role: 'commentary', quote: 'the worker is split out.' };
  const plan = { eventId: 'C1', role: 'commentary', quote: 'I will run the tests next.' };
  const summary = await run(t, session, (request) => (request.challenge
    ? { votes: request.challenge.items.map(({ key, candidate }) => ({ key,
      verdict: candidate.stated?.quote === plan.quote ? 'refuted' : 'not-refuted',
      explanation: 'Recorded.', receipts: [candidate.stated] })) }
    : { ...EMPTY, claims: [{ text: `${SENTINEL}_DONE`, stated: done, contradictedBy: null },
      { text: `${SENTINEL}_PLAN`, stated: plan, contradictedBy: null }] }));
  // D71 (S2): /12 — `incomplete` is counted too, and the checklist's counts ride beside them.
  assert.equal(summary.schema, 'sonah.session-review-harness/17');
  assert.deepEqual(summary.promisesByStatus, { open: 1, verified: 0, incomplete: 0 });
  assert.deepEqual(Object.keys(summary.withheld.causes).sort(), [...CAUSES].sort(), 'no claim cause');
  assert.equal(summary.withheld.proposals, 0);
  assert.equal(summary.sessionReview, 'complete');
});

test('M33 G4 a summary with nothing withheld still carries the closed zero counts', async (t) => {
  const summary = await run(t, familySession(), () => ({ ...EMPTY }));
  assert.equal(summary.promisesAsFindings, 0);
  assert.deepEqual(summary.withheld, { proposals: 0, unsettled: 0,
    causes: Object.fromEntries(CAUSES.map((cause) => [cause, 0])) });
});
