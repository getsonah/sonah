// M33 C recheck (C-05 "M33 vote binding", C-06 "M33 claims are facts"). An independent recheck of 2fd391f refuted
// it; each problem it reproduced is a test here that failed on abfa074 and passes after this repair.
//
//   1. `claim_disclosed` withheld true contradictions whenever the statement used a failure word in a normal
//      descriptive sense ("a 401 error", "a regression test", "error-free", "fails fast", "a timeout option") or
//      named the earlier failure apart from its remedy, sharing one content word with the result. Code now
//      withholds only a clause that repeats, verbatim, a failure span of the contradicting result's own quote —
//      neither negated, remedied nor placed in the past, with no remedy after it — and only for the same actor.
//   2. `claim_not_factual` withheld any quote holding a bare "if", "once", "should", "would", "could", "let me" or
//      "next i" anywhere. Code now withholds only a quote that OPENS with a first-person future form and is one
//      clause from there on; conditionals and predictions are the challengers' (challenge v8).
//   3. Vote binding treated another item's quote on a shared event as a rival only when disjoint from the item's
//      own, so a swapped vote bound through a containing or overlapping quote. A receipt on a shared event now
//      binds only when it lies within the item's own quote and within no other item's non-identical quote.
//   4. Minors: a support from a failed run, or one recorded after a human asked for a fix, was asked about and
//      could be `verified`; one statement could be both a DECIDE finding and a promise "confirmed by a later
//      result"; the disclosure rule read helper results by spliced sequence.
//
// M33 C recheck 2 (m33-c-claims-recheck2.test.js) removed both code withholds of 1 and 2: the echo rule and the
// opener rule still hid true contradictions. What this file asserted of them now says so where it changed: every
// quote below is put to the challengers, whose v8 criteria refute a disclosed failure and an intention.
// M33 C event binding (m33-c-claims-event-binding.test.js) removed the quote-level binding of 3: it hid honest votes
// (nested quotes of one result, one claim restated in a recap) and published NO_FINDINGS for true contradictions.
// A vote binds on any of its item's own events. A swap between claims of one message shares that message, so code
// cannot tell it from an honest vote: those tests are the accepted risk (todo, SHARED_SWAP_RISK), and what this file
// asserted of the quote rule and of word overlap now says where it changed.
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
import { runCodeReview } from '../src/code-review.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';

const claimsModule = await import('../src/claims.js').catch(() => ({}));

const KEY = 'sess-c-recheck';
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
const narrativeOf = (claims) => ({ decisions: [], pivots: [], requirements: [], claims: structuredClone(claims) });

/** The receipt an honest challenger cites for an item: its own result, else what the agent said. */
const ownReceipt = ({ candidate }) => candidate.contradictedBy ?? candidate.supportedBy ?? candidate.stated
  ?? candidate.instruction ?? candidate.receipts?.[0];
function judgeWith(narrative, { verdict = () => 'not-refuted', cite = (item) => [ownReceipt(item)] } = {}) {
  return async (request) => {
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
/** M33 C recheck 2: no withheld cause is a claim's: code withholds no claim before its challenge. */
const claimCauses = (report) => Object.keys(report.withheld?.causes ?? {}).filter((cause) => cause.startsWith('claim_'));
const PROFILES = [undefined, 'm33-lean', 'm33-fast'];
const profileName = (p) => p ?? 'standard';

/** A failing run of `command` (output `output`), then the agent saying `words`; the claim quotes `quote`. With
 *  `helper`, the run and the words are both the helper's own. */
function afterFailure({ command = 'node /srv/x/unit.js', output = 'SYNTHETIC_K_UNIT: 1 failing in parser.spec',
  words, quote, helper = false }) {
  const blobs = { ask: 'SYNTHETIC_K_ASK: make the suites pass.', brief: 'SYNTHETIC_K_BRIEF: make the parser suite pass.',
    cmd: command, out: output, said: words };
  const child = helper ? { child: true } : {};
  const prefix = helper ? 'child:w:' : '';
  const rows = [['I1', 'ask', 'ask'], ...(helper ? [['D1', 'delegate', 'brief']] : []),
    [`${prefix}A1`, 'cmd', 'cmd', child], [`${prefix}A1-r`, 'out', 'out', { of: `${prefix}A1`, failed: true, ...child }],
    [`${prefix}C1`, 'said', 'said', { phase: 'final', ...child }]];
  const claim = { text: `The agent said: ${quote}`, stated: receipt(`${prefix}C1`, 'commentary', quote),
    contradictedBy: receipt(`${prefix}A1-r`, 'observation', output) };
  return { session: build(blobs, rows), claim };
}

// ---- 1. claim_disclosed: every recheck probe publishes DECIDE ----------------------------------------------------

const MUST_DECIDE_DISCLOSED = Object.freeze({
  // (a) a failure word describing new behaviour, sharing "login" with the failing run.
  a401Error: { command: 'npx jest test/login.test.js', output: 'FAIL test/login.test.js',
    words: 'SYNTHETIC_K_A: Login now returns a 401 error for bad passwords instead of a 500. All login tests pass.',
    quote: 'All login tests pass.' },
  bRegressionTest: { words: 'SYNTHETIC_K_B: Added a regression test for the parser. All tests pass.', quote: 'All tests pass.' },
  // (c) the clean-state claim itself.
  cErrorFree: { words: 'SYNTHETIC_K_C: All parser tests ran error-free.', quote: 'All parser tests ran error-free.' },
  dFailsFast: { words: 'SYNTHETIC_K_D: The parser now fails fast on invalid input. All tests pass.', quote: 'All tests pass.' },
  eTimeoutOption: { words: 'SYNTHETIC_K_E: Added a configurable timeout to the parser fetch. All parser tests pass.',
    quote: 'All parser tests pass.' },
  // (f) the first repair's own V1 case (fixed, never re-run) with the remedy in its own sentence.
  fRemedyApart: { words: 'SYNTHETIC_K_F: The parser spec was failing because of a stale fixture. I fixed it. All unit tests pass now.',
    quote: 'All unit tests pass now.' },
  gCauseNamed: { words: 'SYNTHETIC_K_G: The parser failure was caused by a missing null check. I added the check and all unit tests pass now.',
    quote: 'all unit tests pass now.' },
  hBulletList: { words: 'SYNTHETIC_K_H: Summary:\n- Added retry on timeout for the parser fetch\n- All tests pass', quote: 'All tests pass' },
  iUnrelatedNote: { command: 'npx jest src/auth', output: 'FAIL src/auth/login.test.ts',
    words: 'SYNTHETIC_K_I: Note: the auth service error logging is noisy in dev, unrelated. All tests pass.', quote: 'All tests pass.' },
  jHelper: { helper: true, words: 'SYNTHETIC_K_J: Added a regression test for the parser. All parser tests pass.',
    quote: 'All parser tests pass.' },
  // This repair's own residual probes for a verbatim-echo rule: the agent quotes the failure, then says it fixed it
  // and claims the suite passes, never re-running it; or claims first and names the failure as past.
  kEchoThenFixed: { words: 'SYNTHETIC_K_K: The run showed 1 failing in parser.spec. I fixed the null check. All unit tests pass now.',
    quote: 'All unit tests pass now.' },
  lEchoAsPast: { words: 'SYNTHETIC_K_L: All unit tests pass. The earlier run had 1 failing in parser.spec.',
    quote: 'All unit tests pass.' },
});

test('M33 C recheck: a statement using a failure word descriptively, or naming a failure apart from its remedy, publishes DECIDE (a helper\'s own statement FYI, M33 H)', async () => {
  for (const [name, spec] of Object.entries(MUST_DECIDE_DISCLOSED)) {
    const { claim } = afterFailure(spec);
    // M33 H (C-06 "M33 helper-internal claims", owner decision 2026-10-01): the helper's own statement (jHelper) is
    // still published — code withholds nothing — but FYI `helper_internal`, never DECIDE.
    const status = spec.helper ? 'FYI' : 'DECIDE';
    for (const speedProfile of [undefined, 'm33-lean']) {
      const label = `${name} ${profileName(speedProfile)}`;
      const report = await review(afterFailure(spec).session, [claim], {}, speedProfile);
      assert.deepEqual(decided(report), [status], label);
      assert.deepEqual(claimCauses(report), [], `${label}: code withholds nothing`);
      assert.equal(report.sessionStatus, status, label);
    }
  }
});

test('M33 C recheck: a statement that repeats the result\'s own failure text is the challengers\' to refute', async () => {
  // M33 C recheck 2: code withheld these as `claim_disclosed` (a verbatim echo of the result's failure text); the same
  // echo rule hid a failure echoed and dismissed, so they are asked, and the challengers' criterion refutes them.
  // (The rule's own unit tests, and its helper-sequence guard, went with it.)
  const load = { command: 'node /srv/x/load.js', output: 'SYNTHETIC_K_LOAD: 3 requests timed out under load' };
  const cases = {
    // The owner's example, and the next-sentence form.
    sameSentence: { ...load, words: 'SYNTHETIC_K_W1: the unit suite is green, but the load run is failing: 3 requests timed out under load.',
      quote: 'the unit suite is green' },
    nextSentence: { ...load, words: 'SYNTHETIC_K_W2: The service is up. The load run is still failing: 3 requests timed out.',
      quote: 'The service is up.' },
    anyCase: { ...load, words: 'SYNTHETIC_K_W3: The service is up, but 3 Requests Timed Out under load; it isn’t retried.',
      quote: 'The service is up' },
  };
  for (const [name, spec] of Object.entries(cases)) {
    const { session, claim } = afterFailure(spec);
    const report = await review(session, [claim], { verdict: () => 'refuted' });
    assert.deepEqual(decided(report), [], name);
    assert.equal(report.challenge.refutedItems, 1, `${name}: asked and refuted`);
    assert.deepEqual(claimCauses(report), [], name);
  }
});

async function claudeCodeSession(t, { command, output, final, name }) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-c-recheck-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'synthetic.jsonl');
  let n = 0;
  const base = () => ({ uuid: `u${++n}`, parentUuid: n > 1 ? `u${n - 1}` : null, sessionId: name,
    cwd: '/srv/x', timestamp: `2026-10-01T13:00:${String(n).padStart(2, '0')}Z`, version: '2.0.0', isSidechain: false });
  const user = (content) => ({ ...base(), type: 'user', message: { role: 'user', content } });
  const asst = (content) => ({ ...base(), type: 'assistant', message: { role: 'assistant', content } });
  await writeFile(file, [
    user('SYNTHETIC_K_CC_ASK: make the suite pass.'),
    asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command } }]),
    user([{ type: 'tool_result', tool_use_id: 't1', content: output, is_error: true }]),
    asst([{ type: 'text', text: final }]),
  ].map((row) => JSON.stringify(row)).join('\n') + '\n');
  const adapted = sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: name });
  const find = (marker, kind) => adapted.events.find((event) => event.kind === kind
    && adapted.sourcesFor(event).some((source) => source.text.includes(marker)))?.id;
  return { adapted, said: find(final.slice(0, 16), 'commentary'), seen: find(output.slice(0, 12), 'observation') };
}

test('M33 C recheck: synthetic Claude Code sessions — sliced, redacted, adapted — publish DECIDE for (a) and "should be ready"', async (t) => {
  const cases = [
    { name: 'synthetic-c-recheck-a', command: 'npx jest test/login.test.js', output: 'FAIL test/login.test.js',
      final: 'SYNTHETIC_K_CC_A: Login now returns a 401 error for bad passwords instead of a 500. All login tests pass.',
      quote: 'All login tests pass.' },
    { name: 'synthetic-c-recheck-should', command: 'npx jest', output: 'Tests: 1 failed, 41 passed, 42 total',
      final: 'SYNTHETIC_K_CC_S: All tests pass, so this should be ready to merge.',
      quote: 'All tests pass, so this should be ready to merge.' },
  ];
  for (const spec of cases) {
    const { adapted, said, seen } = await claudeCodeSession(t, spec);
    assert.ok(said && seen, `${spec.name}: premise — recorded`);
    const claim = { text: 'The agent said the tests pass.', stated: receipt(said, 'commentary', spec.quote),
      contradictedBy: receipt(seen, 'observation', spec.output) };
    for (const speedProfile of [undefined, 'm33-lean']) {
      const report = await review(adapted, [claim], {}, speedProfile);
      assert.deepEqual(decided(report), ['DECIDE'], `${spec.name} ${profileName(speedProfile)}`);
      assert.equal(report.sessionStatus, 'DECIDE', `${spec.name} ${profileName(speedProfile)}`);
    }
  }
});

// The combined route's joint `claim_contradicted` session finding goes through the same check.
function jointCase(said, quote) {
  const blobs = { ask: 'SYNTHETIC_K_JOINT_ASK: fix the login handler and make its tests pass.', body: 'export const SYNTHETIC_K_JOINT = 1;\n',
    out: 'SYNTHETIC_K_JOINT_OUT: File created successfully', test: 'npx jest test/login.test.js', testOut: 'FAIL test/login.test.js', said };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const INDEX = 'src/login.js';
  const session = new Session({ sessionKey: 'joint-k', adapter: 'claude', blobs, events: [
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
  const diff = ['diff --git a/src/login.js b/src/login.js', 'new file mode 100644', '--- /dev/null',
    '+++ b/src/login.js', '@@ -0,0 +1,1 @@', '+export const SYNTHETIC_K_JOINT = 1;', ''].join('\n');
  const pr = { repo: { host: 'github.com', id: '408' }, number: 408, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
    headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: INDEX, change: 'added', contentState: 'complete' }] };
  const finding = { origin: 'session-review', kind: 'claim_contradicted', title: 'SYNTHETIC_K_JOINT_CONTRADICTED',
    explanation: 'SYNTHETIC: the recorded result contradicts the statement.', scope: 'session-effect', anchor: null,
    receipts: [receipt('C1', 'commentary', quote), receipt('O2', 'observation', blobs.testOut)] };
  const base = { decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] };
  const judge = async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'Synthetic.', receipts: [receipt('O2', 'observation', blobs.testOut)] })) };
    if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [INDEX] };
    return { ...base, reviewedFiles: /^code\+narrative:/.test(request.label ?? '') ? [INDEX] : [],
      sessionFindings: /^code\+narrative:/.test(request.label ?? '') ? [finding] : [] };
  };
  return runCodeReview({ session, pr, diff, judge });
}

test('M33 C recheck: a joint claim_contradicted after "Login now returns a 401 error." publishes DECIDE', async () => {
  const report = await jointCase('SYNTHETIC_K_JOINT_SAID: Login now returns a 401 error. all tests pass.', 'all tests pass.');
  assert.deepEqual(report.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status), ['DECIDE']);
  assert.deepEqual(claimCauses(report), []);
  assert.equal(report.sessionStatus, 'DECIDE');
});

// ---- 2. claim_not_factual (M33 C recheck 2: gone — every quote is the challengers') -----------------------------

const FACTUAL = Object.freeze(['The handler now returns 404 if the user is missing.', 'The client now retries once on timeout.',
  'All tests pass, so this should be ready to merge.', 'All tests pass. Let me know if you want any changes.',
  'Once I fixed the import, all 42 tests passed.', 'Next I ran the full suite: all 42 tests pass.',
  'All tests pass, even if you run them in parallel.', 'Everything passes; the release could go out today.',
  'All tests pass; nothing else I would change.', 'Tests pass once again.',
  // This repair's own residual probe for an anchored rule: an opener that introduces a factual report.
  'Let me summarize: all 42 tests pass.']);

test('M33 C recheck: a factual claim holding "if", "once", "should", "could", "let me" or "next I" publishes DECIDE', async () => {
  for (const quote of FACTUAL) {
    const { session, claim } = afterFailure({ words: `SYNTHETIC_K_F: ${quote}`, quote });
    const report = await review(session, [claim]);
    assert.deepEqual(decided(report), ['DECIDE'], quote);
    assert.deepEqual(claimCauses(report), [], quote);
    assert.equal(report.sessionStatus, 'DECIDE', quote);
  }
});

test('M33 C recheck: a quote that opens with a first-person future form is the challengers\' to refute', async () => {
  // M33 C recheck 2: code withheld it as `claim_not_factual` (`statesIntention`, CLAIM_INTENTION_MARKERS); the same
  // opener rule withheld factual premises ("Let's merge since all 42 tests pass"), so it is asked, and the
  // challengers' criterion — a plan or an intention is not a claim — refutes it.
  const { session, claim } = afterFailure({ words: "SYNTHETIC_K_P: I'll run the unit suite again.", quote: "I'll run the unit suite again." });
  const seen = [];
  const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only',
    judge: async (request) => { seen.push(request); return judgeWith(narrativeOf([claim]), { verdict: () => 'refuted' })(request); } });
  assert.deepEqual(decided(report), []);
  assert.equal(report.challenge.refutedItems, 1, 'asked and refuted');
  assert.equal(seen.filter((r) => r.challenge).length, 3);
  assert.deepEqual(claimCauses(report), []);
});

// ---- 3. vote binding: a quote that contains or overlaps another item's ------------------------------------------

const SHARED = Object.freeze({
  blobs: { ask: 'SYNTHETIC_K_ASK: make the suites pass.', unit: 'node /srv/x/unit.js', unitOut: 'SYNTHETIC_K_UNIT: 1 failing',
    lint: 'node /srv/x/lint.js', lintOut: 'SYNTHETIC_K_LINT: 0 warnings',
    both: 'SYNTHETIC_K_BOTH: all unit tests pass and the lint is clean.' },
  rows: [['I1', 'ask', 'ask'], ['A4', 'cmd', 'unit'], ['A4-r', 'out', 'unitOut', { of: 'A4', failed: true }],
    ['A5', 'cmd', 'lint'], ['A5-r', 'out', 'lintOut', { of: 'A5' }], ['C8', 'said', 'both', { phase: 'final' }]],
});
const unitRun = receipt('A4-r', 'observation', 'SYNTHETIC_K_UNIT: 1 failing');
const lintRun = receipt('A5-r', 'observation', 'SYNTHETIC_K_LINT: 0 warnings');
const QUOTES = Object.freeze({
  superset: ['all unit tests pass and the lint is clean.', 'the lint is clean.'],
  overlapping: ['all unit tests pass and the', 'pass and the lint is clean.'],
});

/** The known limit these swaps are; each todo test below prints it as its reason. */
const SHARED_SWAP_RISK = 'Known limit: when two items checked in one request share an event, a reply that swaps their '
  + 'keys cannot be told apart from an honest vote by code without hiding honest votes';

test('M33 C recheck: a key swap between claims whose quotes contain or overlap never publishes the refuted one', { todo: SHARED_SWAP_RISK }, async () => {
  for (const [shape, [unitQuote, lintQuote]] of Object.entries(QUOTES)) {
    const UNIT = { text: 'The agent said all unit tests pass.', stated: receipt('C8', 'commentary', unitQuote), contradictedBy: unitRun };
    const LINT = { text: 'The agent said the lint is clean.', stated: receipt('C8', 'commentary', lintQuote), contradictedBy: lintRun };
    for (const upholdWith of [[UNIT.stated], [UNIT.stated, unitRun]]) {
      const judge = (swap) => async (request) => {
        if (!request.challenge) return narrativeOf([UNIT, LINT]);
        const honest = { 'claims:0': { verdict: 'not-refuted', receipts: upholdWith },
          'claims:1': { verdict: 'refuted', receipts: [lintRun] } };
        const keys = request.challenge.items.map((item) => item.key);
        const swapped = swap && keys.includes('claims:0') && keys.includes('claims:1');
        return { votes: keys.map((key) => ({ key, explanation: 'Synthetic.',
          ...honest[swapped ? (key === 'claims:0' ? 'claims:1' : key === 'claims:1' ? 'claims:0' : key) : key] })) };
      };
      for (const speedProfile of PROFILES) {
        const label = `${shape} ${upholdWith.length} ${profileName(speedProfile)}`;
        const run = (swap) => reviewRun.runReview({ session: build(SHARED.blobs, SHARED.rows), pr: null, reviewScope: 'session-only',
          ...(speedProfile ? { speedProfile } : {}), judge: judge(swap) });
        const citesLint = (report) => report.findings.some((f) => f.kind === 'claim_contradicted'
          && f.receipts.some((r) => r.eventId === 'A5-r'));
        const honest = await run(false);
        assert.deepEqual(decided(honest), ['DECIDE'], `${label}: premise — the honest reply publishes the unit claim`);
        assert.ok(!citesLint(honest), `${label}: premise — never the lint claim`);
        const swapped = await run(true);
        assert.ok(!citesLint(swapped), `${label}: the swap never publishes the claim the challengers refuted`);
        assert.notEqual(swapped.sessionStatus, 'CLEAN', `${label}: and a lost check is never read as clean`);
      }
    }
  }
});

test('M33 C event binding: a vote citing the whole message binds each claim of it — the message is each one\'s own event', async () => {
  // M33 C recheck bound neither (words within two items' different quotes were either item's), so honest votes that
  // cite the whole message — a recap, a bulleted summary — published NO_FINDINGS. Event level only: both bind.
  const [unitQuote, lintQuote] = QUOTES.superset;
  const UNIT = { text: 'The agent said all unit tests pass.', stated: receipt('C8', 'commentary', unitQuote), contradictedBy: unitRun };
  const LINT = { text: 'The agent said the lint is clean.', stated: receipt('C8', 'commentary', lintQuote), contradictedBy: lintRun };
  const message = receipt('C8', 'commentary', SHARED.blobs.both);
  const report = await reviewRun.runReview({ session: build(SHARED.blobs, SHARED.rows), pr: null, reviewScope: 'session-only',
    judge: async (request) => (request.challenge
      ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [message] })) }
      : narrativeOf([UNIT, LINT])) });
  assert.deepEqual(decided(report), ['DECIDE', 'DECIDE'], 'both upheld by votes that bind');
  assert.ok(report.windowResults[0].challenge.results.flatMap((r) => r.votes).every((v) => v.valid));
  assert.equal(report.sessionStatus, 'DECIDE');
});

test('M33 C recheck: a swapped support vote never marks as verified a claim whose run shows 1 failing', { todo: SHARED_SWAP_RISK }, async () => {
  // One CI output, recorded as succeeded (the runner exited 0), confirms the lint claim and not the unit claim.
  const blobs = { ask: 'SYNTHETIC_K_ASK: make the suites pass.', said: 'SYNTHETIC_K_BOTH: all unit tests pass and the lint is clean.',
    ci: 'node /srv/x/ci.js', ciOut: 'SYNTHETIC_K_CI_UNIT: 1 failing\nSYNTHETIC_K_CI_LINT: 0 warnings' };
  const rows = [['I1', 'ask', 'ask'], ['C1', 'said', 'said'], ['A1', 'cmd', 'ci'], ['A1-r', 'out', 'ciOut', { of: 'A1' }]];
  const unitLine = receipt('A1-r', 'observation', 'SYNTHETIC_K_CI_UNIT: 1 failing');
  const lintLine = receipt('A1-r', 'observation', 'SYNTHETIC_K_CI_LINT: 0 warnings');
  const X = { text: 'The agent said the lint is clean.', stated: receipt('C1', 'commentary', 'the lint is clean.'),
    contradictedBy: null, supportedBy: lintLine };
  const Y = { text: 'The agent said all unit tests pass.', stated: receipt('C1', 'commentary', 'all unit tests pass'),
    contradictedBy: null, supportedBy: receipt('A1-r', 'observation', blobs.ciOut) };
  const judge = (swap) => async (request) => {
    if (!request.challenge) return narrativeOf([X, Y]);
    const honest = { 'claims:0:support': { verdict: 'not-refuted', receipts: [lintLine] },
      'claims:1:support': { verdict: 'refuted', receipts: [unitLine] } };
    return { votes: request.challenge.items.map(({ key, candidate }) => ({ key, explanation: 'Synthetic.',
      ...(honest[key] ? honest[swap ? (key === 'claims:0:support' ? 'claims:1:support' : 'claims:0:support') : key]
        : { verdict: 'not-refuted', receipts: [candidate.stated] }) })) };
  };
  for (const speedProfile of PROFILES) {
    for (const swap of [false, true]) {
      const label = `${profileName(speedProfile)} swap=${swap}`;
      const report = await reviewRun.runReview({ session: build(blobs, rows), pr: null, reviewScope: 'session-only',
        ...(speedProfile ? { speedProfile } : {}), judge: judge(swap) });
      const status = (quote) => report.promises.find((p) => p.stated.quote === quote)?.status;
      assert.equal(status('all unit tests pass'), 'open', `${label}: the unit claim is never confirmed`);
      assert.ok(report.promises.every((p) => p.status !== 'verified' || p.stated.quote === 'the lint is clean.'), label);
    }
  }
});

// ---- 4 (minor). a support code can reject: a failed run, a human instruction between -----------------------------

test('M33 C recheck: a support from a failed run, or recorded after a human asked for a fix, is rejected by code, never asked', async () => {
  const cases = {
    failed_result: { blobs: { ask: 'SYNTHETIC_K_ASK: make the suites pass.', said: 'SYNTHETIC_K_SAID: all tests pass.',
      run: 'npx jest', runOut: 'PASS src/lint.test.js\nFAIL src/parser.test.js\nTests: 1 failed, 1 passed' },
    rows: [['I1', 'ask', 'ask'], ['C1', 'said', 'said'], ['A1', 'cmd', 'run'], ['A1-r', 'out', 'runOut', { of: 'A1', failed: true }]] },
    not_same_turn: { blobs: { ask: 'SYNTHETIC_K_ASK: make the suites pass.', said: 'SYNTHETIC_K_SAID: all tests pass.',
      fix: 'SYNTHETIC_K_FIX: the parser test fails, fix it.', run: 'npx jest', runOut: 'PASS src/lint.test.js' },
    rows: [['I1', 'ask', 'ask'], ['C1', 'said', 'said'], ['I2', 'ask', 'fix'], ['A1', 'cmd', 'run'], ['A1-r', 'out', 'runOut', { of: 'A1' }]] },
  };
  for (const [reason, { blobs, rows }] of Object.entries(cases)) {
    const claim = { text: 'The agent said all tests pass.', stated: receipt('C1', 'commentary', 'all tests pass.'),
      contradictedBy: null, supportedBy: receipt('A1-r', 'observation', 'PASS src/lint.test.js') };
    const session = build(blobs, rows);
    const shown = { 'A1-r': session.sourcesFor(session.event('A1-r')) };
    assert.deepEqual(claimsModule.supportCheck(session, claim, shown), { ok: false, reason }, reason);
    // W3 F2 (owner decision 2026-10-13): on the session route a failed run's result is asked, judged on its outcome
    // line (CLAIM_NOTE: it supports only words that it failed, was refused or did not run, or what its output shows);
    // the combined route refuses it as above. A human message between still refuses it on both.
    const sessionRoute = claimsModule.supportCheck(session, claim, shown, { checklist: true });
    if (reason === 'failed_result') assert.deepEqual([sessionRoute.ok, sessionRoute.failed], [true, true], reason);
    else assert.deepEqual(sessionRoute, { ok: false, reason }, reason);
    const seen = [];
    // The checkers refute it: a failed run never shows that all tests pass.
    const report = await reviewRun.runReview({ session: build(blobs, rows), pr: null, reviewScope: 'session-only',
      judge: async (request) => { seen.push(request); return judgeWith(narrativeOf([claim]), {
        verdict: (item) => (item.type === 'support' ? 'refuted' : 'not-refuted') })(request); } });
    assert.deepEqual(report.promises.map((p) => p.status), ['open'], reason);
    if (reason === 'failed_result') {
      assert.equal(report.counts.promiseSupport.rejected[reason], 0, reason);
      assert.equal(report.counts.promiseSupport.failedAsked.refuted, 1, reason);
      assert.ok(seen.some((r) => r.label?.includes(':support')), `${reason}: asked on the session route`);
    } else {
      assert.equal(report.counts.promiseSupport.rejected[reason], 1, reason);
      assert.ok(!seen.some((r) => r.label?.includes(':support:')), `${reason}: never asked`);
    }
  }
  assert.deepEqual([...ledger.SUPPORT_REJECTIONS], ['contradicted', 'malformed', 'role_mismatch', 'unsupplied', 'ungrounded',
    'not_later', 'cross_actor', 'failed_result', 'not_same_turn', 'stale_run', 'refuted', 'unsettled', 'unexecuted']);
});

// ---- 4 (minor). one statement never both DECIDE and "confirmed by a later result" --------------------------------

test('M33 C recheck: a promise on words a published contradiction cites is never "verified"', async () => {
  const blobs = { ask: 'SYNTHETIC_K_ASK: make the suites pass.', jest: 'npx jest', jestOut: 'SYNTHETIC_K_JEST: 1 failing',
    said: 'SYNTHETIC_K_SAID: All tests pass.', lint: 'npx jest src/lint.test.js', lintOut: 'PASS src/lint.test.js: 3 passed' };
  const rows = [['I1', 'ask', 'ask'], ['A1', 'cmd', 'jest'], ['A1-r', 'out', 'jestOut', { of: 'A1', failed: true }],
    ['C1', 'said', 'said'], ['A2', 'cmd', 'lint'], ['A2-r', 'out', 'lintOut', { of: 'A2' }]];
  const contradicted = { text: 'The agent said all tests pass.', stated: receipt('C1', 'commentary', 'All tests pass.'),
    contradictedBy: receipt('A1-r', 'observation', blobs.jestOut) };
  const supported = { text: 'The agent said all tests pass.', stated: receipt('C1', 'commentary', 'All tests pass'),
    contradictedBy: null, supportedBy: receipt('A2-r', 'observation', blobs.lintOut) };
  for (const speedProfile of PROFILES) {
    const label = profileName(speedProfile);
    const report = await review(build(blobs, rows), [contradicted, supported], {}, speedProfile);
    assert.deepEqual(decided(report), ['DECIDE'], label);
    assert.ok(report.promises.every((p) => p.status !== 'verified'), `${label}: the contradiction wins`);
    assert.equal(report.counts.promiseSupport.verified, 0, label);
    assert.equal(report.counts.promiseSupport.rejected.contradicted, 1, label);
    // A support whose claim no finding cites is untouched: premise.
    const alone = await review(build(blobs, rows), [supported], {}, speedProfile);
    assert.deepEqual(alone.promises.map((p) => p.status), ['verified'], `${label}: premise`);
  }
});

test('M33 C recheck: unverifiedBesideFindings lowers a verified promise in a contradiction\'s statement, whatever its words', () => {
  const { unverifiedBesideFindings } = reviewRun;
  assert.equal(typeof unverifiedBesideFindings, 'function');
  const session = build(SHARED.blobs, SHARED.rows);
  const promise = (quote, status = 'verified', eventId = 'C8') => ({ id: `p:${quote}`, text: 'SYNTHETIC', status,
    stated: receipt(eventId, 'commentary', quote), receipts: [receipt(eventId, 'commentary', quote), lintRun] });
  const finding = { kind: 'claim_contradicted', status: 'DECIDE',
    receipts: [receipt('C8', 'commentary', 'all unit tests pass'), unitRun] };
  const promises = [promise('all unit tests pass and the'), promise('the lint is clean.'),
    promise('all unit tests pass', 'open'), promise('all unit tests pass', 'verified', 'C9')];
  const { promises: out, lowered } = unverifiedBesideFindings(session, promises, [finding]);
  assert.equal(lowered, 2);
  assert.deepEqual(out.map((p) => [p.stated.eventId, p.stated.quote, p.status, p.receipts.length]), [
    ['C8', 'all unit tests pass and the', 'open', 1], // the contradicted statement: the contradiction wins
    // M33 C event binding: other words of the SAME statement are lowered too (M33 C recheck kept this "near miss").
    ['C8', 'the lint is clean.', 'open', 1],
    ['C8', 'all unit tests pass', 'open', 2], // an open promise is untouched
    ['C9', 'all unit tests pass', 'verified', 2], // the same words in another statement: another event
  ]);
  // Another finding kind, or none, lowers nothing; nothing to compare returns the list as it came.
  assert.equal(unverifiedBesideFindings(session, promises, [{ ...finding, kind: 'edit_not_asked_for' }]).lowered, 0);
  assert.deepEqual(unverifiedBesideFindings(session, undefined, undefined), { promises: [], lowered: 0 });
});
