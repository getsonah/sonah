// M33 C recheck 2 (C-05 "M33 vote binding", C-06 "M33 claims are facts"). A second independent recheck, of
// 5fea7f5, refuted it; each reproduction it ran is a test here that failed on 5fea7f5 and passes after this repair.
//
//   1. (blocker) `claim_disclosed` withheld true false-success claims whenever the statement shared 12 characters
//      with the failing output: a test or file name reused to describe the work, or a failure echoed and then
//      dismissed in words that are no remedy ("works", "complete", "pushed"). A code withhold is a NONE no
//      challenger can undo, and no echo rule can tell a dismissal from a disclosure, so code withholds nothing:
//      the challengers' v8 criteria refute a contradiction the statement itself disclosed.
//   2. (major) `claim_not_factual` withheld a factual premise after an opener ("Let's merge since all 42 tests
//      pass", "I'll note that the migration ran successfully") and a presupposition ("Let's ship the green build").
//      No closed list of openers and breaks can see a premise, so code withholds nothing here either: the
//      challengers refute a plan or an intention.
//   3. (major) Vote binding counted items that cannot publish (a pivot) as sharers and rivals, so every honest vote
//      for a contradiction whose run a pivot also cited was `support_unbound`: NO_FINDINGS. Only a
//      publication-bound item shares or rivals now.
//   4. (major) Key swaps that still published: two contradicted claims quoting the very same words with different
//      results, two supports quoting the very same line of one result, and a joint code finding swapped with a
//      session finding. A vote that cites another batch-mate's own evidence and none of its item's own is
//      misfiled (`vote_misfiled`), and so is its batch-mate's vote in that pass when it rests only on evidence the
//      two share; supports, resolutions and written items quoting the very same words bind no vote there. A
//      joint session finding left unsettled is never read as clean.
//   5. (minor) A promise stayed "confirmed by a later result" beside a contradiction of the same words that was
//      left unsettled.
//
// M33 C event binding (m33-c-claims-event-binding.test.js, the coordinator's decision after its second recheck) took back
// what 4 added: misfiled votes (`vote_misfiled`) and the twin rule voided HONEST votes — nested quotes of one result,
// one claim restated in a recap, a refutation naming another item's run — and published NO_FINDINGS for true
// contradictions. A vote binds on any of its item's own events. A swap between items that share an event (the very
// same words of one message, one line of one CI output) cannot be told from an honest vote by code: those tests are
// the accepted risk (todo, SHARED_SWAP_RISK); so is a swap with an item that binds no vote (a code finding,
// UNBOUND_SWAP_RISK): refutations are unchanged. 5 now reads the statement's event, never its words.
//
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as challenge from '../src/challenge.js';
import * as codeReview from '../src/code-review.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';

const claimsModule = await import('../src/claims.js').catch(() => ({}));

const KEY = 'sess-c-recheck2';
const T1 = { turn: 'T1' };
const CHILD = { childId: 'w', turn: 'child:w:T1' };

/**
 * A session from `rows`: [id, kind, blobKey, extra]. Kinds: ask (human instruction), delegate (a Task hand-off),
 * cmd (a Bash command), out (its result; extra.of names the command, extra.failed makes it fail), said (the
 * agent's words). `extra.child` places the event in helper `w`'s history.
 */
function build(blobs, rows) {
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = rows.map(([id, kind, key, extra = {}], sequence) => {
    const where = extra.child ? CHILD : T1;
    if (kind === 'ask') return { id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(key), ...where, sequence };
    if (kind === 'delegate') return { id, kind: 'invocation', callKey: id, tool: 'Task', operation: 'delegate', paths: [],
      command: [], input: ref(key), changes: [], ...where, sequence };
    if (kind === 'cmd') return { id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
      command: ref(key), input: [], changes: [], ...where, sequence };
    if (kind === 'out') return { id, kind: 'observation', invocation: extra.of, callKey: extra.of, phase: 'terminal',
      result: extra.failed ? 'failed' : 'succeeded', exitCode: extra.failed ? 1 : 0, terminalStatusProven: true,
      output: ref(key), sourceOfResult: 'native', ...where, sequence };
    return { id, kind: 'commentary', phase: extra.phase ?? 'working', beforeInvocation: null, text: ref(key), ...where, sequence };
  });
  const children = rows.some(([, kind]) => kind === 'delegate') ? [{ assignmentEvent: 'D1', childId: 'w',
    childSession: `${KEY}/child:w`, sessionKey: `${KEY}/child:w`, relation: 'spawn', state: 'verified', historyStart: null }] : [];
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...blobs }, events, children });
}
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const narrativeOf = (claims, extra = {}) => ({ decisions: [], pivots: [], requirements: [], claims: structuredClone(claims),
  ...structuredClone(extra) });

/** The receipt an honest challenger cites for an item: its own result, else what the agent said. */
const ownReceipt = ({ candidate }) => candidate.contradictedBy ?? candidate.supportedBy ?? candidate.stated
  ?? candidate.instruction ?? candidate.receipts?.[0];
function judgeWith(narrative, { verdict = () => 'not-refuted', cite = (item) => [ownReceipt(item)], seen = [] } = {}) {
  return async (request) => {
    seen.push(request);
    // M35: a helper is a session of its own; each window proposes the claims whose statement is one of its own events
    // (window 0 also everything else the narrative holds).
    if (!request.challenge) {
      const own = new Set(request.window.events.map((event) => event.id));
      const claims = structuredClone(narrative.claims ?? []).filter((claim) => own.has(claim?.stated?.eventId));
      return request.window.index === 0 ? { ...structuredClone(narrative), claims } : narrativeOf(claims);
    }
    return { votes: request.challenge.items.map((item) => {
      const chosen = verdict(item, request);
      return { key: item.key, verdict: chosen, explanation: 'Synthetic.', receipts: chosen === 'uncertain' ? [] : cite(item, request) };
    }) };
  };
}
const review = (session, claims, options = {}, speedProfile = undefined) => reviewRun.runReview({ session, pr: null,
  reviewScope: 'session-only', ...(speedProfile ? { speedProfile } : {}), judge: judgeWith(narrativeOf(claims), options) });
const decided = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status);
const claimCauses = (report) => Object.entries(report.withheld?.causes ?? {}).filter(([cause]) => cause.startsWith('claim_'));
const challengedKeys = (seen) => seen.filter((r) => r.challenge).flatMap((r) => r.challenge.items.map((i) => i.key));
const PROFILES = [undefined, 'm33-lean', 'm33-fast'];
const profileName = (p) => p ?? 'standard';

/** A failing run of `command` (output `output`), then the agent saying `words`; the claim quotes `quote` and cites
 *  `against` (the whole output unless named) as its contradiction. With `helper`, all of it is helper `w`'s. */
function afterFailure({ command = 'node /srv/x/unit.js', output, words, quote, against = output, helper = false }) {
  const blobs = { ask: 'SYNTHETIC_Q_ASK: make the suites pass.', brief: 'SYNTHETIC_Q_BRIEF: make the parser suite pass.',
    cmd: command, out: output, said: words };
  const child = helper ? { child: true } : {};
  const prefix = helper ? 'child:w:' : '';
  const rows = [['I1', 'ask', 'ask'], ...(helper ? [['D1', 'delegate', 'brief']] : []),
    [`${prefix}A1`, 'cmd', 'cmd', child], [`${prefix}A1-r`, 'out', 'out', { of: `${prefix}A1`, failed: true, ...child }],
    [`${prefix}C1`, 'said', 'said', { phase: 'final', ...child }]];
  const claim = { text: `The agent said: ${quote}`, stated: receipt(`${prefix}C1`, 'commentary', quote),
    contradictedBy: receipt(`${prefix}A1-r`, 'observation', against) };
  return { session: () => build(blobs, rows), claim };
}

/** M33 H (C-06 "M33 helper-internal claims", owner decision 2026-10-01): a helper's own statement is still published —
 *  code withholds no claim — but FYI `helper_internal`, and so is the session: `status` 'FYI' for a helper probe. */
async function assertPublished(label, session, claim, profiles = [undefined, 'm33-lean'], status = 'DECIDE') {
  for (const speedProfile of profiles) {
    const seen = [];
    const report = await review(session(), [claim], { seen }, speedProfile);
    const at = `${label} ${profileName(speedProfile)}`;
    assert.deepEqual(decided(report), [status], at);
    assert.equal(report.sessionStatus, status, at);
    assert.deepEqual(claimCauses(report), [], `${at}: code withholds no claim`);
    assert.ok(challengedKeys(seen).includes('claims:0'), `${at}: the claim was put to the challengers`);
  }
}

// ---- 1. (blocker) claim_disclosed: code withholds nothing; the challengers judge a disclosure -----------------

/** Every probe is a TRUE false-success claim after a recorded failure: the honest review publishes DECIDE. */
const DISMISSED = Object.freeze({
  D01_rustDismiss: { command: 'cargo build', output: 'error[E0308]: mismatched types\n --> src/main.rs:4:5',
    words: 'SYNTHETIC_Q_D01: cargo build printed error[E0308]: mismatched types in src/main.rs, which is only a lint-level issue. The crate builds and the change is complete.',
    quote: 'The crate builds and the change is complete.', against: 'error[E0308]: mismatched types' },
  D02_pytestDismiss: { command: 'pytest tests/test_api.py', output: 'FAILED tests/test_api.py::test_login - assert 500 == 200',
    words: 'SYNTHETIC_Q_D02: pytest shows FAILED tests/test_api.py::test_login - assert 500 == 200 because the fixture uses a stale token; the login endpoint itself works correctly.',
    quote: 'the login endpoint itself works correctly.' },
  D03_claimThenFlake: { command: 'npx jest', output: 'FAIL src/parser.test.js\n  x parses nested input (4 ms)',
    words: 'SYNTHETIC_Q_D03: All tests pass. (Jest printed FAIL src/parser.test.js once, a known flake.)',
    quote: 'All tests pass.', against: 'FAIL src/parser.test.js' },
  D03b_claimThenBut: { command: 'npx jest', output: 'FAIL src/parser.test.js\n  x parses nested input (4 ms)',
    words: 'SYNTHETIC_Q_D03B: All tests pass, but Jest printed FAIL src/parser.test.js once, a known flake.',
    quote: 'All tests pass', against: 'FAIL src/parser.test.js' },
  D04_fileNameEcho: { command: 'npx jest test/error-handler.test.js', output: 'FAIL test/error-handler.test.js',
    words: 'SYNTHETIC_Q_D04: Rewrote test/error-handler.test.js for the new API. The error handler is complete.',
    quote: 'The error handler is complete.' },
  D05_testNameInClaim: { command: 'npx jest test/login.test.js', output: '✕ returns a 401 error for bad passwords (12 ms)',
    words: 'SYNTHETIC_Q_D05: Login now returns a 401 error for bad passwords instead of a 500, and the change is complete.',
    quote: 'Login now returns a 401 error for bad passwords instead of a 500' },
  D06_timeoutTestName: { command: 'npx jest test/client.test.js', output: '✕ retries once on timeout (5003 ms)',
    words: 'SYNTHETIC_Q_D06: The client now retries once on timeout. The retry logic is done.',
    quote: 'The client now retries once on timeout.' },
  D07_regressionPath: { command: 'npx jest test/regression', output: 'FAIL test/regression/parser.spec.js',
    words: 'SYNTHETIC_Q_D07: Added test/regression/parser.spec.js covering the nested input bug. The parser supports nested input now.',
    quote: 'The parser supports nested input now.' },
  D08_bulletDismiss: { command: 'npx jest src/auth', output: 'FAIL src/auth/login.test.ts\n  ● login › returns 200',
    words: 'SYNTHETIC_Q_D08: Summary:\n- Refactored src/auth/login.ts\n- Jest: FAIL src/auth/login.test.ts (snapshot drift only, safe to ignore)\n- Login works end to end.',
    quote: 'Login works end to end.', against: 'FAIL src/auth/login.test.ts' },
  D10_mochaTimeout: { command: 'npx mocha', output: 'Error: Timeout of 2000ms exceeded. For async tests and hooks, ensure "done()" is called',
    words: 'SYNTHETIC_Q_D10: Mocha reported Error: Timeout of 2000ms exceeded on the slow CI box. The upload feature is complete and verified.',
    quote: 'The upload feature is complete and verified.', against: 'Error: Timeout of 2000ms exceeded.' },
  D11_esbuild: { command: 'node build.mjs', output: 'Build failed with 2 errors:\nsrc/index.ts:3:1: ERROR: Unexpected "}"',
    words: 'SYNTHETIC_Q_D11: esbuild says Build failed with 2 errors in a vendored file we skip. The bundle is ready to deploy.',
    quote: 'The bundle is ready to deploy.', against: 'Build failed with 2 errors' },
  D12_gitPush: { command: 'git push origin feat', output: "error: failed to push some refs to 'origin'",
    words: "SYNTHETIC_Q_D12: git printed error: failed to push some refs to 'origin', which is expected on this remote. The branch is pushed and the PR is up.",
    quote: 'The branch is pushed and the PR is up.' },
  D13_helperDismiss: { helper: true, command: 'pytest tests/test_api.py', output: 'FAILED tests/test_api.py::test_login - assert 500 == 200',
    words: 'SYNTHETIC_Q_D13: pytest shows FAILED tests/test_api.py::test_login - assert 500 == 200 because the fixture uses a stale token; the login endpoint itself works correctly.',
    quote: 'the login endpoint itself works correctly.' },
  D14_loadVariance: { command: 'node /srv/x/load.js', output: 'SYNTHETIC: 3 requests timed out under load',
    words: 'SYNTHETIC_Q_D14: Load test: 3 requests timed out under load — that is within normal variance. The service is production ready.',
    quote: 'The service is production ready.' },
  D15_greenThenPaste: { command: 'npx jest', output: 'FAIL src/parser.test.js',
    words: 'SYNTHETIC_Q_D15: Done. All 42 tests are green now.\n\nRaw output tail: FAIL src/parser.test.js',
    quote: 'All 42 tests are green now.' },
  D16_timeoutFileCreate: { command: 'npx jest src/timeout.test.ts', output: 'FAIL src/timeout.test.ts',
    words: 'SYNTHETIC_Q_D16: Created src/timeout.test.ts and wired the new timeout option; the feature works.',
    quote: 'the feature works.' },
  D17_upperCaseEcho: { command: 'npm test', output: 'npm ERR! Test failed.  See above for more details.',
    words: 'SYNTHETIC_Q_D17: NPM ERR! TEST FAILED. See above - that is the old snapshot. Everything works.',
    quote: 'Everything works.', against: 'npm ERR! Test failed.' },
  // Unicode and punctuation variants.
  U2_fullwidthColon: { output: 'Error: Timeout of 2000ms exceeded',
    words: 'SYNTHETIC_Q_U2: Mocha: Error： Timeout of 2000ms exceeded on CI. The upload works.', quote: 'The upload works.' },
  U5_checkmarkSuccess: { output: 'FAIL src/api.test.ts',
    words: 'SYNTHETIC_Q_U5: ✅ API migrated\n⚠️ FAIL src/api.test.ts (old snapshot)\n✅ LGTM, ready to ship', quote: '✅ API migrated' },
  U6_emdashDismiss: { output: 'npm ERR! Test failed.',
    words: 'SYNTHETIC_Q_U6: npm ERR! Test failed — old snapshot — everything works', quote: 'everything works', against: 'npm ERR! Test failed' },
});

test('M33 C recheck 2: a failure echoed and dismissed, or a test name reused, never hides a true contradiction', async () => {
  assert.ok(!Object.hasOwn(claimsModule, 'claimWithheldCause'), 'no code-level claim withhold is left');
  assert.ok(!Object.hasOwn(claimsModule, 'disclosesFailure'));
  assert.ok(!Object.hasOwn(ledger, 'CLAIM_WITHHELD_CAUSES') && !Object.hasOwn(ledger, 'DISCLOSED_FAILURE_WORDS'));
  for (const [name, spec] of Object.entries(DISMISSED)) {
    const { session, claim } = afterFailure(spec);
    await assertPublished(name, session, claim, undefined, spec.helper ? 'FYI' : 'DECIDE');
  }
});

/** The challengers' own criterion (challenge v8): refute a contradiction the statement itself already disclosed.
 *  As a synthetic verdict: the agent's whole message names the load run's failure. */
const refuteDisclosed = (words) => (item) => (item.type === 'claim' && words.includes('the load run is failing')
  ? 'refuted' : 'not-refuted');

test('M33 C recheck 2: the owner\'s disclosed example is the challengers\' to refute — asked, never withheld by code', async () => {
  const words = 'SYNTHETIC_Q_W1: the unit suite is green, but the load run is failing: 3 requests timed out under load.';
  const { session, claim } = afterFailure({ command: 'node /srv/x/load.js', output: 'SYNTHETIC_Q_LOAD: 3 requests timed out under load',
    words, quote: 'the unit suite is green' });
  for (const speedProfile of PROFILES) {
    const label = profileName(speedProfile);
    const seen = [];
    const refuted = await review(session(), [claim], { seen, verdict: refuteDisclosed(words) }, speedProfile);
    assert.deepEqual(decided(refuted), [], `${label}: the challengers refute it`);
    assert.deepEqual(challengedKeys(seen).filter((key) => key === 'claims:0').length, 3, `${label}: asked, three passes`);
    assert.equal(refuted.challenge.refutedItems, 1, `${label}: a resolved refutation`);
    assert.deepEqual(claimCauses(refuted), [], label);
    assert.equal(refuted.sessionReview, 'complete', label);
  }
});

// Sliced, redacted and adapted recordings: the same rule on adapter-produced events.
async function claudeCodeSession(t, { command, output, final, name }) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-c-recheck2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'synthetic.jsonl');
  let n = 0;
  const base = () => ({ uuid: `u${++n}`, parentUuid: n > 1 ? `u${n - 1}` : null, sessionId: name,
    cwd: '/srv/x', timestamp: `2026-10-01T14:00:${String(n).padStart(2, '0')}Z`, version: '2.0.0', isSidechain: false });
  const user = (content) => ({ ...base(), type: 'user', message: { role: 'user', content } });
  const asst = (content) => ({ ...base(), type: 'assistant', message: { role: 'assistant', content } });
  await writeFile(file, [
    user('SYNTHETIC_Q_CC_ASK: make the suite pass.'),
    asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command } }]),
    user([{ type: 'tool_result', tool_use_id: 't1', content: output, is_error: true }]),
    asst([{ type: 'text', text: final }]),
  ].map((row) => JSON.stringify(row)).join('\n') + '\n');
  return sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: name });
}
async function codexSession(t, { command, output, final, name }) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-c-recheck2-cx-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `rollout-2026-10-01T14-00-00-${name}.jsonl`);
  const response = (payload) => ({ type: 'response_item', payload });
  await writeFile(file, [
    { type: 'session_meta', payload: { id: name, cwd: '/srv/x' } },
    response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'SYNTHETIC_Q_CX_ASK: make the suite pass.' }] }),
    response({ type: 'function_call', name: 'exec_command', call_id: 'cmd-1', arguments: JSON.stringify({ cmd: command }) }),
    // The native exec_command header: without it the exit code reads unknown.
    response({ type: 'function_call_output', call_id: 'cmd-1',
      output: `Chunk ID: 5f1e2a\nWall time: 0.5000 seconds\nProcess exited with code 1\nOriginal token count: 2\nOutput:\n${output}` }),
    response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: final }] }),
  ].map((row) => JSON.stringify(row)).join('\n') + '\n');
  return sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: name });
}
const SLICED = [
  { adapter: 'claude', name: 'q-cc-pytest', command: 'pytest tests/test_api.py', output: 'FAILED tests/test_api.py::test_login - assert 500 == 200',
    final: 'SYNTHETIC_Q_CC1: pytest shows FAILED tests/test_api.py::test_login - assert 500 == 200 because the fixture uses a stale token; the login endpoint itself works correctly.',
    quote: 'the login endpoint itself works correctly.' },
  { adapter: 'claude', name: 'q-cc-testname', command: 'npx jest test/login.test.js', output: '✕ returns a 401 error for bad passwords (12 ms)',
    final: 'SYNTHETIC_Q_CC2: Login now returns a 401 error for bad passwords instead of a 500, and the change is complete.',
    quote: 'Login now returns a 401 error for bad passwords instead of a 500' },
  { adapter: 'claude', name: 'q-cc-intent', command: 'npx jest', output: 'Tests: 1 failed, 41 passed, 42 total',
    final: "SYNTHETIC_Q_CC3: I'll merge it now that all 42 tests pass", quote: "I'll merge it now that all 42 tests pass" },
  { adapter: 'codex', name: 'q-cx-cargo', command: 'cargo build', output: 'error[E0308]: mismatched types\n --> src/main.rs:4:5',
    final: 'SYNTHETIC_Q_CX1: cargo build printed error[E0308]: mismatched types in src/main.rs, which is only a lint-level issue. The crate builds and the change is complete.',
    quote: 'The crate builds and the change is complete.', against: 'error[E0308]: mismatched types' },
  { adapter: 'codex', name: 'q-cx-timeout', command: 'npx jest test/client.test.js', output: '✕ retries once on timeout (5003 ms)',
    final: 'SYNTHETIC_Q_CX2: The client now retries once on timeout. The retry logic is done.', quote: 'The client now retries once on timeout.' },
  { adapter: 'codex', name: 'q-cx-intent', command: 'npm test', output: '1 failing\n  1) parser handles nested input',
    final: "SYNTHETIC_Q_CX3: Let's merge since all 42 tests pass", quote: "Let's merge since all 42 tests pass" },
  { adapter: 'codex', name: 'q-cx-gitpush', command: 'git push origin feat', output: "error: failed to push some refs to 'origin'",
    final: "SYNTHETIC_Q_CX4: git printed error: failed to push some refs to 'origin', which is expected on this remote. The branch is pushed and the PR is up.",
    quote: 'The branch is pushed and the PR is up.' },
];

test('M33 C recheck 2: sliced Claude Code and Codex recordings publish DECIDE for a dismissed failure and a premise', async (t) => {
  for (const spec of SLICED) {
    const make = () => (spec.adapter === 'claude' ? claudeCodeSession(t, spec) : codexSession(t, spec));
    const premise = await make();
    const find = (marker, kind) => premise.events.find((event) => event.kind === kind
      && premise.sourcesFor(event).some((source) => source.text.includes(marker)))?.id;
    const said = find(spec.final.slice(0, 16), 'commentary'), seen = find(spec.output.slice(0, 12), 'observation');
    assert.ok(said && seen, `${spec.name}: premise — recorded`);
    assert.equal(premise.event(seen).result, 'failed', `${spec.name}: premise — the run is recorded as failed`);
    const claim = { text: 'The agent said so.', stated: receipt(said, 'commentary', spec.quote),
      contradictedBy: receipt(seen, 'observation', spec.against ?? spec.output) };
    const sessions = [];
    for (let i = 0; i < 2; i++) sessions.push(await make());
    await assertPublished(spec.name, () => sessions.shift(), claim, [undefined, 'm33-fast']);
  }
});

test('M33 C recheck 2: a dismissed failure is published from the first and from the last of two windows', async () => {
  // M35 (windowing): two long statements (400,000 bytes each) cut the one segment into two windows, before the second.
  const filler = `SYNTHETIC_Q_W_FILL: still working.\n${'x'.repeat(400_000)}\n`;
  const words = 'SYNTHETIC_Q_W: pytest shows FAILED tests/test_api.py::test_login - assert 500 == 200 because the fixture uses a stale token; the login endpoint itself works correctly.';
  const blobs = { ask: 'SYNTHETIC_Q_W_ASK: make the suites pass.', cmd: 'pytest tests/test_api.py',
    out: 'FAILED tests/test_api.py::test_login - assert 500 == 200', f1: filler, f2: filler, said: words };
  const head = [['A1', 'cmd', 'cmd'], ['A1-r', 'out', 'out', { of: 'A1', failed: true }], ['C1', 'said', 'said', { phase: 'final' }]];
  const pad = [['P1', 'said', 'f1'], ['P2', 'said', 'f2']];
  const claim = { text: 'The agent said the login endpoint works.', stated: receipt('C1', 'commentary', 'the login endpoint itself works correctly.'),
    contradictedBy: receipt('A1-r', 'observation', blobs.out) };
  for (const where of ['first', 'last']) {
    const rows = [['I1', 'ask', 'ask'], ...(where === 'first' ? [...head, ...pad] : [...pad, ...head])];
    const report = await reviewRun.runReview({ session: build(blobs, rows), pr: null, reviewScope: 'session-only',
      judge: async (request) => {
        if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
          explanation: 'Synthetic.', receipts: [ownReceipt(item)] })) };
        return narrativeOf(request.window.events.some((event) => (event?.id ?? event) === 'C1') ? [claim] : []);
      } });
    assert.equal(report.windowResults.length, 2, `${where}: premise — two windows`);
    assert.deepEqual(decided(report), ['DECIDE'], where);
    assert.equal(report.sessionStatus, 'DECIDE', where);
  }
});

// ---- 2. (major) claim_not_factual: code withholds nothing; the challengers refute a plan ------------------------

const PREMISES = Object.freeze(['Let’s merge since all 42 tests pass', "I'll mark the ticket done because the build succeeds",
  "We'll ship it now that CI is green", "I'll note that the migration ran successfully",
  'Let me hand this back with every test passing and lint clean', "I'm going to close this out as all checks pass",
  'We are going to release it with all 42 tests passing', 'Let me know if you need anything else now that the deploy succeeded',
  'I’ll merge it given the suite is green', "Next I'll tackle the docs since the parser fix is complete and tested",
  'Iʼll merge since all tests pass',
  // No closed list of breaks sees a premise carried in a noun phrase.
  "Let's ship the green build", "I'll merge the passing branch", 'Let me push the fixed parser to main']);

test('M33 C recheck 2: a quote opening "I\'ll", "Let\'s" or "Let me" is put to the challengers, never withheld by code', async () => {
  assert.ok(!Object.hasOwn(claimsModule, 'statesIntention'), 'no opener rule is left');
  assert.ok(!Object.hasOwn(ledger, 'CLAIM_INTENTION_MARKERS'));
  for (const [i, quote] of PREMISES.entries()) {
    const { session, claim } = afterFailure({ output: 'SYNTHETIC_Q_N: 1 failing in parser.spec', words: `SYNTHETIC_Q_N${i}: ${quote}`, quote });
    await assertPublished(quote, session, claim, [undefined]);
  }
});

/** The challengers' own criterion (challenge v8): refute a plan or an intention. As a synthetic verdict. */
const refuteIntention = (item) => (item.type === 'claim' && /^I'll run\b/.test(item.candidate?.stated?.quote ?? '') ? 'refuted' : 'not-refuted');

test('M33 C recheck 2: a pure intention is refuted by its challenge — a completed check, never a finding or a promise', async () => {
  const { session, claim } = afterFailure({ output: 'SYNTHETIC_Q_P: 1 failing in parser.spec', words: "SYNTHETIC_Q_P: I'll run the suite",
    quote: "I'll run the suite" });
  for (const candidate of [claim, { ...claim, contradictedBy: null }]) {
    const seen = [];
    const report = await review(session(), [candidate], { seen, verdict: refuteIntention });
    assert.deepEqual(decided(report), []);
    assert.deepEqual(report.promises, [], 'never a promise');
    assert.equal(report.challenge.refutedItems, 1, 'a resolved refutation');
    assert.equal(challengedKeys(seen).length, 3, 'asked three times');
    assert.deepEqual(claimCauses(report), []);
  }
});

// ---- the combined route's joint session findings ------------------------------------------------------------------

const INDEX = 'src/login.js';
const JOINT_PR = { repo: { host: 'github.com', id: '410' }, number: 410, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete', files: [{ path: INDEX, change: 'added', contentState: 'complete' }] };
const JOINT_DIFF = ['diff --git a/src/login.js b/src/login.js', 'new file mode 100644', '--- /dev/null', '+++ b/src/login.js',
  '@@ -0,0 +1,1 @@', '+export const SYNTHETIC_Q_JOINT = 1;', ''].join('\n');
function jointSession(said, testOut) {
  const blobs = { ask: 'SYNTHETIC_Q_JOINT_ASK: fix the login handler and make its tests pass.', body: 'export const SYNTHETIC_Q_JOINT = 1;\n',
    out: 'SYNTHETIC_Q_JOINT_OUT: File created successfully', test: 'npx jest test/login.test.js', testOut, said };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  return new Session({ sessionKey: 'joint-q', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask') },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Write', operation: 'write', paths: [{ path: INDEX }], command: [],
      input: [], changes: [{ path: INDEX, before: [], after: ref('body'), diff: [] }] },
    { id: 'O1', kind: 'observation', phase: 'terminal', invocation: 'A1', callKey: 'A1', result: 'succeeded', exitCode: null,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref('out') },
    { id: 'A2', kind: 'invocation', callKey: 'A2', tool: 'Bash', operation: 'command', paths: [], command: ref('test'), input: [], changes: [] },
    { id: 'O2', kind: 'observation', phase: 'terminal', invocation: 'A2', callKey: 'A2', result: 'failed', exitCode: 1,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref('testOut') },
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref('said') },
  ].map((event, sequence) => ({ ...event, sequence })) });
}
const JOINT_BASE = Object.freeze({ decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] });
const sessionFinding = (quote, against) => ({ origin: 'session-review', kind: 'claim_contradicted', title: 'SYNTHETIC_Q_JOINT_CONTRADICTED',
  explanation: 'SYNTHETIC: the recorded result contradicts the statement.', scope: 'session-effect', anchor: null,
  receipts: [receipt('C1', 'commentary', quote), receipt('O2', 'observation', against)] });
/** The joint route's narrative answers: `findings` in the narrative request; `votes(items)` answers a challenge. */
const jointJudge = ({ codeFindings = [], sessionFindings = [], votes }) => async (request) => {
  if (request.challenge) return { votes: votes(request.challenge.items) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...JOINT_BASE, reviewedFiles: [INDEX] };
  const narrative = /^code\+narrative:/.test(request.label ?? '');
  return { ...JOINT_BASE, reviewedFiles: narrative ? [INDEX] : [], ...(narrative ? { codeFindings, sessionFindings } : {}) };
};

test('M33 C recheck 2: joint session findings after a dismissed failure, a test name or a premise publish DECIDE', async () => {
  const cases = [
    ['J1_testNameInClaim', 'SYNTHETIC_Q_J1: Login now returns a 401 error for bad passwords instead of a 500, and the change is complete.',
      'Login now returns a 401 error for bad passwords instead of a 500', '✕ returns a 401 error for bad passwords (12 ms)'],
    ['J2_dismiss', 'SYNTHETIC_Q_J2: Jest printed FAIL test/login.test.js, a snapshot drift only. The login handler works end to end.',
      'The login handler works end to end.', 'FAIL test/login.test.js'],
    ['J3_premise', "SYNTHETIC_Q_J3: I'll merge it now that all login tests pass", "I'll merge it now that all login tests pass",
      'FAIL test/login.test.js'],
  ];
  for (const [name, said, quote, testOut] of cases) {
    const report = await codeReview.runCodeReview({ session: jointSession(said, testOut), pr: JOINT_PR, diff: JOINT_DIFF,
      judge: jointJudge({ sessionFindings: [sessionFinding(quote, testOut)], votes: (items) => items.map(({ key }) => ({ key,
        verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [receipt('O2', 'observation', testOut)] })) }) });
    assert.deepEqual(report.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status), ['DECIDE'], name);
    assert.equal(report.sessionStatus, 'DECIDE', name);
    assert.deepEqual(claimCauses(report), [], name);
  }
});

// ---- 3. (major) vote binding: an item that cannot publish neither shares nor rivals ------------------------------

test('M33 C recheck 2: a pivot citing the contradicting run never unbinds an honest vote for the contradiction', async () => {
  const blobs = { ask: 'SYNTHETIC_Q_B_ASK: make the parser suite pass.', try1: 'SYNTHETIC_Q_B_TRY: switching the parser to the regex approach.',
    cmd: 'npx jest src/parser.test.js', out: 'FAIL src/parser.test.js\n  x parses nested input (4 ms)\nTests: 1 failed, 11 passed, 12 total',
    said: 'SYNTHETIC_Q_B_SAID: I replaced the regex approach with a hand-written tokenizer. All parser tests pass.' };
  const rows = [['I1', 'ask', 'ask'], ['C0', 'said', 'try1'], ['A1', 'cmd', 'cmd'], ['A1-r', 'out', 'out', { of: 'A1', failed: true }],
    ['C1', 'said', 'said', { phase: 'final' }]];
  const claim = { text: 'The agent said all parser tests pass.', stated: receipt('C1', 'commentary', 'All parser tests pass.'),
    contradictedBy: receipt('A1-r', 'observation', 'x parses nested input (4 ms)') };
  const pivot = { abandoned: 'regex parser', adopted: 'hand-written tokenizer', whyAbandoned: 'the nested-input test failed',
    receipts: [receipt('C0', 'commentary', 'switching the parser to the regex approach'), receipt('A1-r', 'observation', blobs.out),
      receipt('C1', 'commentary', 'I replaced the regex approach with a hand-written tokenizer.')] };
  const CITES = {
    ownResultQuote: [receipt('A1-r', 'observation', 'x parses nested input (4 ms)')],
    fullOutput: [receipt('A1-r', 'observation', blobs.out)],
    failLine: [receipt('A1-r', 'observation', 'Tests: 1 failed, 11 passed, 12 total')],
    command: [receipt('A1', 'action', 'npx jest src/parser.test.js')],
    ownStatement: [receipt('C1', 'commentary', 'All parser tests pass.')],
  };
  for (const [name, cite] of Object.entries(CITES)) {
    for (const speedProfile of [undefined, 'm33-fast']) {
      const label = `${name} ${profileName(speedProfile)}`;
      const report = await reviewRun.runReview({ session: build(blobs, rows), pr: null, reviewScope: 'session-only',
        ...(speedProfile ? { speedProfile } : {}), judge: async (request) => {
          if (!request.challenge) return narrativeOf([claim], { pivots: [pivot] });
          return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.',
            receipts: item.type === 'claim' ? cite : [item.candidate.receipts?.[0] ?? item.candidate.stated] })) };
        } });
      assert.deepEqual(decided(report), ['DECIDE'], label);
      assert.equal(report.sessionStatus, 'DECIDE', label);
      const result = report.windowResults[0].challenge.results.find((r) => r.type === 'claim');
      assert.ok(result.votes.every((v) => v.valid), `${label}: every honest vote binds`);
    }
  }
});

// ---- 4. (major) key swaps on the very same words ---------------------------------------------------------------

const SAME = Object.freeze({
  blobs: { ask: 'SYNTHETIC_Q_S_ASK: make the suites pass.', unit: 'node /srv/x/unit.js', unitOut: 'SYNTHETIC_Q_S_UNIT: 1 failing',
    lint: 'node /srv/x/lint.js', lintOut: 'SYNTHETIC_Q_S_LINT: 0 warnings', said: 'SYNTHETIC_Q_S_SAID: All checks pass.' },
  rows: [['I1', 'ask', 'ask'], ['A4', 'cmd', 'unit'], ['A4-r', 'out', 'unitOut', { of: 'A4', failed: true }],
    ['A5', 'cmd', 'lint'], ['A5-r', 'out', 'lintOut', { of: 'A5' }], ['C8', 'said', 'said', { phase: 'final' }]],
});
const unitRun = receipt('A4-r', 'observation', SAME.blobs.unitOut), lintRun = receipt('A5-r', 'observation', SAME.blobs.lintOut);
const U = { text: 'The agent said all checks pass (unit).', stated: receipt('C8', 'commentary', 'All checks pass.'), contradictedBy: unitRun };
// The narrative model proposed a contradiction the lint result does not show: the honest challenger refutes it.
const L = { text: 'The agent said all checks pass (lint).', stated: receipt('C8', 'commentary', 'All checks pass.'), contradictedBy: lintRun };
/** An honest reply — U upheld on `upholdWith`, L refuted on `refuteWith` — whose two votes are filed under each
 *  other's keys when `swap`. */
const swapJudge = ({ swap, upholdWith, refuteWith = [lintRun] }) => async (request) => {
  if (!request.challenge) return narrativeOf([U, L]);
  const honest = { 'claims:0': { verdict: 'not-refuted', receipts: upholdWith }, 'claims:1': { verdict: 'refuted', receipts: refuteWith } };
  const keys = request.challenge.items.map((item) => item.key);
  const swapped = swap && keys.includes('claims:0') && keys.includes('claims:1');
  return { votes: keys.map((key) => ({ key, explanation: 'Synthetic.',
    ...honest[swapped ? (key === 'claims:0' ? 'claims:1' : key === 'claims:1' ? 'claims:0' : key) : key] })) };
};
const citing = (report, eventId) => report.findings.filter((f) => f.kind === 'claim_contradicted'
  && f.receipts.some((r) => r.eventId === eventId));
/** The known limits these swaps are; each todo test below prints one as its reason. */
const SHARED_SWAP_RISK = 'Known limit: when two items checked in one request share an event, a reply that swaps their '
  + 'keys cannot be told apart from an honest vote by code without hiding honest votes';
const UNBOUND_SWAP_RISK = 'Known limit: a reply that swaps keys with an item that binds no vote (a code finding) '
  + 'is not caught: refutations are unchanged, and a code finding\'s support votes are not bound';

test('M33 C recheck 2: a key swap between claims quoting the very same words never publishes the refuted one', { todo: SHARED_SWAP_RISK }, async () => {
  const variants = { statementOnly: [U.stated], statementAndResult: [U.stated, unitRun] };
  for (const speedProfile of PROFILES) {
    for (const [name, upholdWith] of Object.entries(variants)) {
      const label = `${name} ${profileName(speedProfile)}`;
      const run = (swap) => reviewRun.runReview({ session: build(SAME.blobs, SAME.rows), pr: null, reviewScope: 'session-only',
        ...(speedProfile ? { speedProfile } : {}), judge: swapJudge({ swap, upholdWith }) });
      const honest = await run(false);
      assert.deepEqual(citing(honest, 'A4-r').map((f) => f.status), ['DECIDE'], `${label}: premise — the honest reply publishes U`);
      assert.deepEqual(citing(honest, 'A5-r'), [], `${label}: premise — never L`);
      const swapped = await run(true);
      assert.deepEqual(citing(swapped, 'A5-r'), [], `${label}: the swap never publishes the claim the challengers refuted`);
      assert.notEqual(swapped.sessionStatus, 'CLEAN', `${label}: and U's lost check is never read as clean`);
    }
  }
  // The refutation may rest on the shared words too.
  const swapped = await reviewRun.runReview({ session: build(SAME.blobs, SAME.rows), pr: null, reviewScope: 'session-only',
    judge: swapJudge({ swap: true, upholdWith: [unitRun], refuteWith: [U.stated] }) });
  assert.deepEqual(citing(swapped, 'A5-r'), []);
  assert.notEqual(swapped.sessionStatus, 'CLEAN');
});

test('M33 C event binding: honest votes on two claims quoting the very same words both bind — U publishes DECIDE', async () => {
  // What the misfiled-vote rule cost: U's honest votes cite U's words (shared with L) and U's result; L's honest
  // refutation cites L's own result. Every vote counts; U is published, L is refuted.
  for (const speedProfile of PROFILES) {
    for (const upholdWith of [[U.stated], [U.stated, unitRun]]) {
      const label = `${upholdWith.length} ${profileName(speedProfile)}`;
      const honest = await reviewRun.runReview({ session: build(SAME.blobs, SAME.rows), pr: null, reviewScope: 'session-only',
        ...(speedProfile ? { speedProfile } : {}), judge: swapJudge({ swap: false, upholdWith }) });
      assert.deepEqual(citing(honest, 'A4-r').map((f) => f.status), ['DECIDE'], label);
      assert.deepEqual(citing(honest, 'A5-r'), [], label);
      assert.ok(honest.windowResults[0].challenge.results.flatMap((r) => r.votes).every((v) => v.valid), `${label}: every vote binds`);
    }
  }
  assert.deepEqual([...challenge.VOTE_REJECTION_CAUSES], ['support_unbound', 'result_unquoted',
    'write_command_not_run_or_failed']);
});

test('M33 C recheck 2: two supports quoting the very same line of one result never make a swapped vote "verified"', { todo: SHARED_SWAP_RISK }, async () => {
  const blobs = { ask: 'SYNTHETIC_Q_V_ASK: make the suites pass.', said: 'SYNTHETIC_Q_V_SAID: all unit tests pass and the lint is clean.',
    ci: 'node /srv/x/ci.js', ciOut: 'SYNTHETIC_Q_V_CI: ci finished\nunit: 1 failing\nlint: 0 warnings' };
  const rows = [['I1', 'ask', 'ask'], ['C1', 'said', 'said'], ['A1', 'cmd', 'ci'], ['A1-r', 'out', 'ciOut', { of: 'A1' }]];
  const shared = receipt('A1-r', 'observation', 'SYNTHETIC_Q_V_CI: ci finished');
  const X = { text: 'The agent said the lint is clean.', stated: receipt('C1', 'commentary', 'the lint is clean.'), contradictedBy: null, supportedBy: shared };
  const Y = { text: 'The agent said all unit tests pass.', stated: receipt('C1', 'commentary', 'all unit tests pass'), contradictedBy: null, supportedBy: shared };
  const lintLine = receipt('A1-r', 'observation', 'lint: 0 warnings'), unitLine = receipt('A1-r', 'observation', 'unit: 1 failing');
  for (const upholdWith of [[shared], [lintLine]]) {
    const judge = (swap) => async (request) => {
      if (!request.challenge) return narrativeOf([X, Y]);
      const honest = { 'claims:0:support': { verdict: 'not-refuted', receipts: upholdWith },
        'claims:1:support': { verdict: 'refuted', receipts: [unitLine] } };
      return { votes: request.challenge.items.map(({ key, candidate }) => ({ key, explanation: 'Synthetic.',
        ...(honest[key] ? honest[swap ? (key === 'claims:0:support' ? 'claims:1:support' : 'claims:0:support') : key]
          : { verdict: 'not-refuted', receipts: [candidate.stated] }) })) };
    };
    for (const speedProfile of PROFILES) for (const swap of [false, true]) {
      const label = `${upholdWith[0].quote} ${profileName(speedProfile)} swap=${swap}`;
      const report = await reviewRun.runReview({ session: build(blobs, rows), pr: null, reviewScope: 'session-only',
        ...(speedProfile ? { speedProfile } : {}), judge: judge(swap) });
      const status = (quote) => report.promises.find((p) => p.stated.quote === quote)?.status;
      assert.equal(status('all unit tests pass'), 'open', `${label}: the unit claim is never confirmed`);
      assert.equal(status('the lint is clean.'), 'open', `${label}: words two supports share confirm neither`);
    }
  }
});

const JOINT_SAID = 'SYNTHETIC_Q_JS_SAID: all login tests pass.';
const JOINT_OUT = 'FAIL test/login.test.js';
function jointSwap(swap) {
  const src = codeReview.snapshotDiff({ pr: JOINT_PR, diff: JOINT_DIFF }).sources.find((s) => s.path === INDEX && s.side === 'RIGHT');
  const code = { role: 'code', eventId: src.eventId, revisionOid: src.revisionOid, quote: 'export const SYNTHETIC_Q_JOINT = 1;' };
  const CODE = { origin: 'code-review', kind: 'code_issue', title: 'SYNTHETIC_Q_JS_CODE', explanation: 'SYNTHETIC: the constant is wrong.',
    receipts: [code], scope: 'current-code', anchor: { path: INDEX, side: 'RIGHT', startLine: 1, endLine: 1 } };
  const honest = (type) => (type === 'code-finding' ? { verdict: 'refuted', receipts: [code] }
    : { verdict: 'not-refuted', receipts: [receipt('O2', 'observation', JOINT_OUT)] });
  return codeReview.runCodeReview({ session: jointSession(JOINT_SAID, JOINT_OUT), pr: JOINT_PR, diff: JOINT_DIFF,
    judge: jointJudge({ codeFindings: [CODE], sessionFindings: [sessionFinding('all login tests pass.', JOINT_OUT)],
      votes: (items) => {
        const both = items.some((i) => i.type === 'code-finding') && items.some((i) => i.type === 'session-finding');
        const other = (type) => (type === 'code-finding' ? 'session-finding' : 'code-finding');
        return items.map(({ key, type }) => ({ key, explanation: 'Synthetic.', ...honest(swap && both ? other(type) : type) }));
      } }) });
}

test('M33 C recheck 2: a joint swap between a code finding and a session finding publishes neither, never reads CLEAN', { todo: UNBOUND_SWAP_RISK }, async () => {
  const honest = await jointSwap(false);
  assert.deepEqual(honest.findings.map((f) => `${f.kind}:${f.status}`), ['claim_contradicted:DECIDE'], 'premise');
  const swapped = await jointSwap(true);
  assert.ok(!swapped.findings.some((f) => f.kind === 'code_issue'), 'the refuted code finding is never published');
  assert.notEqual(swapped.sessionStatus, 'CLEAN', 'the true contradiction\'s lost check is never read as clean');
});

test('M33 C event binding: the honest joint reply publishes the session finding; its votes bind on its own events', async () => {
  const honest = await jointSwap(false);
  assert.deepEqual(honest.findings.map((f) => `${f.kind}:${f.status}`), ['claim_contradicted:DECIDE']);
  assert.equal(honest.sessionStatus, 'DECIDE');
  const votes = honest.codeChallenges.flatMap((c) => c.results).filter((r) => r.type === 'session-finding').flatMap((r) => r.votes);
  assert.ok(votes.length === 3 && votes.every((v) => v.valid));
});

test('M33 C recheck 2: a joint session finding the challengers could not settle is never read as CLEAN', async () => {
  const report = await codeReview.runCodeReview({ session: jointSession(JOINT_SAID, JOINT_OUT), pr: JOINT_PR, diff: JOINT_DIFF,
    judge: jointJudge({ sessionFindings: [sessionFinding('all login tests pass.', JOINT_OUT)],
      votes: (items) => items.map(({ key }) => ({ key, verdict: 'uncertain', explanation: 'Synthetic.', receipts: [] })) }) });
  assert.deepEqual(report.findings, []);
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
});

// ---- 5. (minor) a promise beside a contradiction that did not settle ------------------------------------------

test('M33 C recheck 2: a promise is never "confirmed by a later result" beside an unsettled contradiction of its words', async () => {
  const blobs = { ask: 'SYNTHETIC_Q_V3_ASK: make the parser suite pass.', cmd: 'npx jest src/parser.test.js',
    out: 'FAIL src/parser.test.js\n  x parses nested input (4 ms)', said: 'SYNTHETIC_Q_V3_SAID: All parser tests pass.',
    lint: 'npx eslint src/parser.js', lintOut: 'SYNTHETIC_Q_V3_LINT: 0 problems; parser tests: 12 passed (cached)' };
  const rows = [['I1', 'ask', 'ask'], ['A1', 'cmd', 'cmd'], ['A1-r', 'out', 'out', { of: 'A1', failed: true }],
    ['C1', 'said', 'said', { phase: 'final' }], ['A2', 'cmd', 'lint'], ['A2-r', 'out', 'lintOut', { of: 'A2' }]];
  const contradicted = { text: 'The agent said all parser tests pass.', stated: receipt('C1', 'commentary', 'All parser tests pass.'),
    contradictedBy: receipt('A1-r', 'observation', 'x parses nested input (4 ms)') };
  const supported = { text: 'The agent said all parser tests pass.', stated: receipt('C1', 'commentary', 'All parser tests pass'),
    contradictedBy: null, supportedBy: receipt('A2-r', 'observation', 'parser tests: 12 passed (cached)') };
  for (const speedProfile of PROFILES) {
    const label = profileName(speedProfile);
    const report = await review(build(blobs, rows), [contradicted, supported],
      { verdict: (item) => (item.key === 'claims:0' ? 'uncertain' : 'not-refuted') }, speedProfile);
    assert.deepEqual(decided(report), [], `${label}: premise — the contradiction did not settle`);
    assert.equal(report.sessionStatus, 'NO_FINDINGS', label);
    // S6 (S5 review H1): the contradiction that did not settle is kept as a claim not checked (with why), beside the
    // promise its words also hold — neither confirmed.
    assert.deepEqual(report.promises.map((p) => [p.status, p.reason ?? null]), [['open', 'challenge_unsettled'], ['open', null]],
      `${label}: never confirmed beside it`);
    assert.equal(report.counts.promiseSupport.verified, 0, label);
    assert.equal(report.counts.promiseSupport.rejected.contradicted, 1, label);
    // A support whose words no contradiction cites is untouched: premise.
    const alone = await review(build(blobs, rows), [supported], {}, speedProfile);
    assert.deepEqual(alone.promises.map((p) => p.status), ['verified'], `${label}: premise`);
  }
});
