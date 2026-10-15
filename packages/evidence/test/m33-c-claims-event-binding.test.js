// M33 C event binding (C-05 "M33 vote binding", C-06 "M33 claims are facts" and "M33 self-corrected claims").
// The coordinator's decision after its second recheck: the quote-level vote-binding rules of 5fea7f5 and 2fe78b1 hid
// HONEST votes and published false NONEs, while swaps they were built to stop still got through. Simplify to what
// is safe:
//
//   1. Vote binding is EVENT LEVEL ONLY. A not-refuted vote on a publication-bound item counts as support only
//      when one of its grounded receipts is on one of that item's own events: the events it is judged on, plus one
//      hop (a result's invocation, an invocation's results). No quote is read; nothing another item cites changes
//      it. Refutations are unchanged. The rival and nested-quote rules, the twin rule and misfiled votes are gone.
//   2. A key swap between batch-mates that SHARE events cannot be told apart by code without hiding honest votes:
//      it is a documented accepted risk (test.todo in m33-i3-same-class-batching.test.js). A swap between items
//      with DISJOINT events stays closed by event binding: it can never publish the item the challengers refuted.
//   3. A resolution whose observation is a failed run (or one with a nonzero exit) is rejected by code
//      (`failed_result`), exactly like a support from one: a failed rerun never downgrades a true contradiction.
//   4. A promise whose stated EVENT is the stated event of a contradicted claim that was published, or whose check
//      ended unsettled or unexecuted, is never `verified`: event identity, not word overlap.
//
// The must-publish probes the recheck listed (B01 nested quotes of one result, B06 one claim restated in a recap,
// and the others) are each a test here: honest votes publish DECIDE in the standard, m33-fast and m33-lean
// profiles. Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
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

const KEY = 'sess-c-events';
const T1 = { turn: 'T1' };
const CHILD = { childId: 'w', turn: 'child:w:T1' };
const PROFILES = Object.freeze([undefined, 'm33-fast', 'm33-lean']);
const profileName = (p) => p ?? 'standard';

/**
 * A session from `rows`: [id, kind, blobKey, extra]. Kinds: ask (human instruction), delegate (a Task hand-off),
 * cmd (a Bash command), out (its result; extra.of names the command, extra.failed makes it fail, extra.exitCode and
 * extra.result override what is recorded), said (the agent's words). `extra.child` places the event in helper `w`'s
 * history.
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
      result: extra.result ?? (extra.failed ? 'failed' : 'succeeded'), exitCode: extra.exitCode ?? (extra.failed ? 1 : 0),
      terminalStatusProven: true, output: ref(key), sourceOfResult: 'native', ...where, sequence };
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
const ownReceipt = ({ candidate }) => candidate.contradictedBy ?? candidate.supportedBy ?? candidate.resolvedBy?.observation
  ?? candidate.stated ?? candidate.instruction ?? candidate.receipts?.[0];
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
const run = (session, judge, speedProfile) => reviewRun.runReview({ session, pr: null, reviewScope: 'session-only',
  ...(speedProfile ? { speedProfile } : {}), judge });
const contradictions = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted');
/** The published contradiction whose statement is `stated`, as `status`, or undefined. */
const publishedFor = (report, stated) => contradictions(report).find((f) => f.receipts.some((r) => r.role === 'commentary'
  && r.eventId === stated.eventId && r.quote === stated.quote))?.status;
const votesOf = (report, key) => report.windowResults.flatMap((w) => [w.challenge, w.supportChallenge].filter(Boolean))
  .flatMap((c) => c.results).filter((r) => r.key === key).flatMap((r) => r.votes);

/** Every honest probe must publish DECIDE for each true claim in `truth`, and the session DECIDE, in every profile;
 *  every vote cast on a true claim binds (valid). */
async function assertDecides(label, make, truth, profiles = PROFILES) {
  for (const speedProfile of profiles) {
    const at = `${label} ${profileName(speedProfile)}`;
    const { session, narrative, options } = await make();
    const report = await run(session, judgeWith(narrative, options), speedProfile);
    assert.equal(report.sessionStatus, 'DECIDE', at);
    for (const { key, stated } of truth) {
      assert.equal(publishedFor(report, stated), 'DECIDE', `${at}: ${key} is a true contradiction`);
      assert.ok(votesOf(report, key).every((v) => v.valid === true), `${at}: every honest vote on ${key} binds`);
    }
  }
}

// ---- the must-publish probes: single claims after a recorded failure ---------------------------------------------

/** A failing run of `command`, then the agent saying `words`; the claim quotes `quote` and cites `against` (the whole
 *  output unless named). With `helper`, all of it is helper `w`'s; with `parentClaim`, the run is the helper's and
 *  the statement the parent's. */
function afterFailure({ command = 'node /srv/x/unit.js', output, words, quote, against = output, helper = false, parentClaim = false }) {
  const blobs = { ask: 'SYNTHETIC_E_ASK: make the suites pass.', brief: 'SYNTHETIC_E_BRIEF: make the parser suite pass.',
    cmd: command, out: output, said: words };
  const child = helper ? { child: true } : {};
  const prefix = helper ? 'child:w:' : '';
  const saidId = parentClaim ? 'C1' : `${prefix}C1`;
  const rows = [['I1', 'ask', 'ask'], ...(helper ? [['D1', 'delegate', 'brief']] : []),
    [`${prefix}A1`, 'cmd', 'cmd', child], [`${prefix}A1-r`, 'out', 'out', { of: `${prefix}A1`, failed: true, ...child }],
    [saidId, 'said', 'said', { phase: 'final', ...(parentClaim ? {} : child) }]];
  const claim = { text: `The agent said: ${quote}`, stated: receipt(saidId, 'commentary', quote),
    contradictedBy: receipt(`${prefix}A1-r`, 'observation', against) };
  return { session: build(blobs, rows), narrative: narrativeOf([claim]), claim };
}

const SINGLE = Object.freeze({
  A01_echoCountsThenClaim: { output: 'Tests: 1 failed, 41 passed, 42 total', words: 'SYNTHETIC_E_A01: Tests: 1 failed, 41 passed, 42 total. All 42 tests pass now.', quote: 'All 42 tests pass now.' },
  A02_testNameInsideClaim: { command: 'pytest', output: 'FAILED tests/test_api.py::test_login - assert 500 == 200', words: 'SYNTHETIC_E_A02: tests/test_api.py::test_login passes now.', quote: 'tests/test_api.py::test_login passes now.' },
  A03_paraphraseDismiss: { output: 'FAIL src/parser.test.js\n  x parses nested input (4 ms)', words: 'SYNTHETIC_E_A03: The one parser failure is just flakiness; the suite is green.', quote: 'the suite is green.' },
  A04_bulletListsFailure: { output: 'FAIL src/parser.test.js', words: 'SYNTHETIC_E_A04:\n- Build: ok\n- Tests: FAIL src/parser.test.js (flaky)\n- All tests passing', quote: 'All tests passing' },
  A05_remedyNeverRerun: { output: 'FAILED tests/test_api.py::test_login - assert 500 == 200', words: 'SYNTHETIC_E_A05: Fixed the assertion in test_login, so all tests pass now.', quote: 'Fixed the assertion in test_login, so all tests pass now.' },
  A06_multiSentenceQuote: { output: 'FAIL src/parser.test.js', words: 'SYNTHETIC_E_A06: I fixed the tokenizer. All parser tests pass.', quote: 'I fixed the tokenizer. All parser tests pass.' },
  A07_curlyApostropheExact: { output: '1 failing', words: 'SYNTHETIC_E_A07: It’s green: all 12 tests pass.', quote: 'It’s green: all 12 tests pass.' },
  A08_curlyInSourceAsciiQuote: { output: '1 failing', words: 'SYNTHETIC_E_A08: It’s green: all 12 tests pass.', quote: "It's green: all 12 tests pass." },
  A09_nbspInOutput: { output: 'Tests: 1 failed, 11 passed', words: 'SYNTHETIC_E_A09: All 12 tests pass.', quote: 'All 12 tests pass.', against: 'Tests: 1 failed, 11 passed' },
  A10_crossMarkGlyph: { output: '✕ retries once on timeout (5003 ms)', words: 'SYNTHETIC_E_A10: Retry works; done.', quote: 'Retry works; done.', against: '× retries once on timeout (5003 ms)' },
  A11_remedyWordsFixed: { output: 'error: failed to push some refs to origin', words: 'SYNTHETIC_E_A11: Resolved the push rejection; the branch is pushed.', quote: 'the branch is pushed.' },
  A12_helperOwnFailure: { helper: true, output: 'FAIL src/parser.test.js', words: 'SYNTHETIC_E_A12: parser suite green.', quote: 'parser suite green.' },
  A13_parentAfterHelperFailure: { helper: true, parentClaim: true, output: 'FAIL src/parser.test.js', words: 'SYNTHETIC_E_A13: The helper finished; all parser tests pass.', quote: 'all parser tests pass.' },
  A14_emojiChecklist: { output: 'FAIL src/api.test.ts', words: 'SYNTHETIC_E_A14: ✅ API migrated\n✅ Tests: FAIL src/api.test.ts was a stale snapshot\n✅ All green', quote: '✅ All green' },
  A15_quotedFailureInClaimQuote: { output: 'npm ERR! Test failed.', words: 'SYNTHETIC_E_A15: “npm ERR! Test failed.” is from the old run — everything passes.', quote: '“npm ERR! Test failed.” is from the old run — everything passes.' },
  A16_fullwidthPunct: { output: 'Error: Timeout of 2000ms exceeded', words: 'SYNTHETIC_E_A16：アップロードは動作します。All uploads work.', quote: 'All uploads work.' },
  A28_ellipsisVariant: { output: '1 failing', words: 'SYNTHETIC_E_A28: All tests pass… ready to merge.', quote: 'All tests pass... ready to merge.' },
  A29_crlfStatement: { output: '1 failing', words: 'SYNTHETIC_E_A29: Done.\r\nAll tests pass.', quote: 'Done.\nAll tests pass.' },
  A30_dashVariant: { output: '1 failing', words: 'SYNTHETIC_E_A30: Parser – all tests pass.', quote: 'Parser - all tests pass.' },
});

test('M33 C event binding: every single-claim must-publish probe publishes DECIDE in every profile (a helper\'s own statement FYI, M33 H)', async () => {
  for (const [name, spec] of Object.entries(SINGLE)) {
    const { claim } = afterFailure(spec);
    // M33 H (C-06 "M33 helper-internal claims", owner decision 2026-10-01): a helper's own statement (A12) is still
    // published — never withheld — but FYI `helper_internal`, and so is the session; the parent's (A13), DECIDE.
    const status = spec.helper && !spec.parentClaim ? 'FYI' : 'DECIDE';
    // The truth is matched on the grounded quote, which a repaired near miss changes: match the event only.
    for (const speedProfile of PROFILES) {
      const { session, narrative } = afterFailure(spec);
      const report = await run(session, judgeWith(narrative), speedProfile);
      const at = `${name} ${profileName(speedProfile)}`;
      // M35 (windowing): a helper is a session of its own, so the parent's claim contradicted only by its helper's run
      // (A13) cites a result the parent's window is never shown: withheld before any challenge, never DECIDE.
      if (spec.parentClaim) {
        assert.deepEqual(contradictions(report), [], at);
        assert.equal(report.withheld.proposals, 1, at);
        continue;
      }
      assert.equal(report.sessionStatus, status, at);
      assert.deepEqual(contradictions(report).map((f) => [f.status, f.receipts.find((r) => r.role === 'commentary')?.eventId]),
        [[status, claim.stated.eventId]], at);
    }
  }
  // A17: the honest challenger quotes the claim's words with a straight apostrophe where the source has a curly one.
  await assertDecides('A17_voteQuotesAsciiForCurly', () => {
    const made = afterFailure({ output: '1 failing', words: 'SYNTHETIC_E_A17: It’s green: all 12 tests pass.', quote: 'It’s green: all 12 tests pass.' });
    return { ...made, options: { cite: (item) => [receipt(item.candidate.stated.eventId, 'commentary', "It's green: all 12 tests pass.")] } };
  }, [{ key: 'claims:0', stated: receipt('C1', 'commentary', 'It’s green: all 12 tests pass.') }]);
  // A18: an exit-0 run whose output shows the failure (`npm test || true`).
  await assertDecides('A18_exitZeroFailureOutput', () => {
    const blobs = { ask: 'SYNTHETIC_E_ASK', cmd: 'npm test || true', out: '1 failing\n  1) parser handles nested input', said: 'SYNTHETIC_E_A18: all tests pass' };
    const rows = [['I1', 'ask', 'ask'], ['A1', 'cmd', 'cmd'], ['A1-r', 'out', 'out', { of: 'A1' }], ['C1', 'said', 'said', { phase: 'final' }]];
    const claim = { text: 'x', stated: receipt('C1', 'commentary', 'all tests pass'), contradictedBy: receipt('A1-r', 'observation', '1 failing') };
    return { session: build(blobs, rows), narrative: narrativeOf([claim]) };
  }, [{ key: 'claims:0', stated: receipt('C1', 'commentary', 'all tests pass') }]);
});

// ---- the must-publish probes: two contradicted claims, honest votes ------------------------------------------------

const OUT = 'FAIL src/parser.test.js\n  x parses nested input (4 ms)\nTests: 1 failed, 11 passed, 12 total';
const LINE = 'x parses nested input (4 ms)';
/** B01-B04: two claims citing one failing run with nested quotes — the outer, spurious one cites the whole output
 *  ("a failing test is no evidence the tokenizer was not rewritten"), the inner, true one cites the failing line. */
function nested({ separate = false, outerVerdict = 'refuted' } = {}) {
  const blobs = { ask: 'SYNTHETIC_E_B_ASK: fix nested input in the parser.', cmd: 'npx jest src/parser.test.js', out: OUT,
    said: 'SYNTHETIC_E_B_SAID: Rewrote the tokenizer. The nested input case now passes.',
    said0: 'SYNTHETIC_E_B_SAID0: Rewrote the tokenizer.', said1: 'SYNTHETIC_E_B_SAID1: The nested input case now passes.' };
  const rows = separate
    ? [['I1', 'ask', 'ask'], ['A1', 'cmd', 'cmd'], ['A1-r', 'out', 'out', { of: 'A1', failed: true }], ['C0', 'said', 'said0'],
      ['C1', 'said', 'said1', { phase: 'final' }]]
    : [['I1', 'ask', 'ask'], ['A1', 'cmd', 'cmd'], ['A1-r', 'out', 'out', { of: 'A1', failed: true }], ['C1', 'said', 'said', { phase: 'final' }]];
  const outer = { text: 'The agent said it rewrote the tokenizer.', stated: receipt(separate ? 'C0' : 'C1', 'commentary', 'Rewrote the tokenizer.'),
    contradictedBy: receipt('A1-r', 'observation', OUT) };
  const inner = { text: 'The agent said the nested input case passes.', stated: receipt('C1', 'commentary', 'The nested input case now passes.'),
    contradictedBy: receipt('A1-r', 'observation', LINE) };
  return { session: build(blobs, rows), narrative: narrativeOf([outer, inner]), outer, inner,
    options: { verdict: (item) => (item.key === 'claims:0' ? outerVerdict : 'not-refuted'),
      cite: (item) => (item.key === 'claims:0' ? [outer.stated] : [ownReceipt(item)]) } };
}

test('M33 C event binding: B01 nested quotes of one result — the outer refuted, the inner true — publishes DECIDE', async () => {
  await assertDecides('B01_nestedOuterRefuted', () => nested(), [{ key: 'claims:1', stated: nested().inner.stated }]);
  // B02: the outer left uncertain (unsettled) never costs the inner its honest votes.
  await assertDecides('B02_nestedOuterUncertain', () => nested({ outerVerdict: 'uncertain' }),
    [{ key: 'claims:1', stated: nested().inner.stated }]);
  // B03: the same two claims in two messages.
  await assertDecides('B03_nestedSeparateMessages', () => nested({ separate: true }),
    [{ key: 'claims:1', stated: nested({ separate: true }).inner.stated }]);
  // B04 (premise): both upheld — one finding, since two contradictions resting on exactly the same events are one
  // defect (ledger.js `sameDefect`).
  await assertDecides('B04_nestedBothTrue', () => ({ ...nested(), options: {} }), []);
});

test('M33 C event binding: B06 one claim restated in a recap, both contradicted by one failing run, publishes both DECIDE', async () => {
  const make = () => {
    const blobs = { ask: 'SYNTHETIC_E_RS_ASK', cmd: 'npm test', out: '1 failing', s1: 'SYNTHETIC_E_RS1: All tests pass.',
      s2: 'SYNTHETIC_E_RS2: Recap: All tests pass.' };
    const rows = [['I1', 'ask', 'ask'], ['A1', 'cmd', 'cmd'], ['A1-r', 'out', 'out', { of: 'A1', failed: true }], ['C1', 'said', 's1'],
      ['C2', 'said', 's2', { phase: 'final' }]];
    const failing = receipt('A1-r', 'observation', '1 failing');
    const a = { text: 'a', stated: receipt('C1', 'commentary', 'All tests pass.'), contradictedBy: failing };
    const b = { text: 'b', stated: receipt('C2', 'commentary', 'All tests pass.'), contradictedBy: failing };
    // C1's honest vote also cites the restatement; C2's cites the result only.
    return { session: build(blobs, rows), narrative: narrativeOf([a, b]), a, b,
      options: { cite: (item) => (item.key === 'claims:0' ? [failing, b.stated] : [failing]) } };
  };
  const { a, b } = make();
  await assertDecides('B06_restatementCollateral', make, [{ key: 'claims:0', stated: a.stated }, { key: 'claims:1', stated: b.stated }]);
});

/** B05, D01, D02: one statement or two, a true unit claim (U) and a spurious lint claim (L). */
const SAME = Object.freeze({
  blobs: { ask: 'SYNTHETIC_E_S_ASK: make the suites pass.', unit: 'node /srv/x/unit.js', unitOut: 'SYNTHETIC_E_S_UNIT: 1 failing',
    lint: 'node /srv/x/lint.js', lintOut: 'SYNTHETIC_E_S_LINT: 0 warnings', said: 'SYNTHETIC_E_S_SAID: All checks pass.' },
  rows: [['I1', 'ask', 'ask'], ['A4', 'cmd', 'unit'], ['A4-r', 'out', 'unitOut', { of: 'A4', failed: true }],
    ['A5', 'cmd', 'lint'], ['A5-r', 'out', 'lintOut', { of: 'A5' }], ['C8', 'said', 'said', { phase: 'final' }]],
});
const unitRun = receipt('A4-r', 'observation', SAME.blobs.unitOut), lintRun = receipt('A5-r', 'observation', SAME.blobs.lintOut);
const U = { text: 'The agent said all checks pass (unit).', stated: receipt('C8', 'commentary', 'All checks pass.'), contradictedBy: unitRun };
const L = { text: 'The agent said all checks pass (lint).', stated: receipt('C8', 'commentary', 'All checks pass.'), contradictedBy: lintRun };

test('M33 C event binding: B05 an honest refutation citing a batch-mate\'s result never costs the true claim its votes', async () => {
  // U's honest votes cite U's own words; L's honest refutation cites U's result ("the failure is the unit run's").
  await assertDecides('B05_collateralFromHonestRefutation', () => ({ session: build(SAME.blobs, SAME.rows), narrative: narrativeOf([U, L]),
    options: { verdict: (item) => (item.key === 'claims:1' ? 'refuted' : 'not-refuted'),
      cite: (item) => (item.key === 'claims:1' ? [unitRun] : [U.stated]) } }), [{ key: 'claims:0', stated: U.stated }]);
});

test('M33 C event binding: B07 a bullet claim nested in a whole-list claim publishes DECIDE on its own words', async () => {
  const make = () => {
    const blobs = { ask: 'SYNTHETIC_E_BL_ASK', unit: 'npm test', unitOut: '1 failing', lint: 'npm run lint', lintOut: '0 problems',
      said: 'SYNTHETIC_E_BL:\n- Refactored the parser\n- All tests pass' };
    const rows = [['I1', 'ask', 'ask'], ['A1', 'cmd', 'unit'], ['A1-r', 'out', 'unitOut', { of: 'A1', failed: true }], ['A2', 'cmd', 'lint'],
      ['A2-r', 'out', 'lintOut', { of: 'A2' }], ['C1', 'said', 'said', { phase: 'final' }]];
    const whole = { text: 'w', stated: receipt('C1', 'commentary', '- Refactored the parser\n- All tests pass'),
      contradictedBy: receipt('A2-r', 'observation', '0 problems') };
    const bullet = { text: 'b', stated: receipt('C1', 'commentary', 'All tests pass'), contradictedBy: receipt('A1-r', 'observation', '1 failing') };
    return { session: build(blobs, rows), narrative: narrativeOf([whole, bullet]), bullet,
      options: { verdict: (item) => (item.key === 'claims:0' ? 'refuted' : 'not-refuted'),
        cite: (item) => (item.key === 'claims:0' ? [receipt('A2-r', 'observation', '0 problems')] : [bullet.stated]) } };
  };
  await assertDecides('B07_bulletNestedStatement', make, [{ key: 'claims:1', stated: make().bullet.stated }]);
  // B08 (premise): two true claims on different results.
  await assertDecides('B08_twoTrueDifferentResults', () => {
    const blobs = { ...SAME.blobs, lintOut: 'SYNTHETIC_E_S_LINT: 3 errors' };
    const lint = { ...L, contradictedBy: receipt('A5-r', 'observation', blobs.lintOut) };
    return { session: build(blobs, SAME.rows), narrative: narrativeOf([U, lint]) };
  }, [{ key: 'claims:0', stated: U.stated }, { key: 'claims:1', stated: L.stated }]);
});

async function claudeCodeSession(t, { command, output, final, name }) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-c-events-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'synthetic.jsonl');
  let n = 0;
  const base = () => ({ uuid: `u${++n}`, parentUuid: n > 1 ? `u${n - 1}` : null, sessionId: name,
    cwd: '/srv/x', timestamp: `2026-10-01T14:00:${String(n).padStart(2, '0')}Z`, version: '2.0.0', isSidechain: false });
  const user = (content) => ({ ...base(), type: 'user', message: { role: 'user', content } });
  const asst = (content) => ({ ...base(), type: 'assistant', message: { role: 'assistant', content } });
  await writeFile(file, [user('SYNTHETIC_E_CC_ASK: make the suite pass.'),
    asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command } }]),
    user([{ type: 'tool_result', tool_use_id: 't1', content: output, is_error: true }]),
    asst([{ type: 'text', text: final }]),
  ].map((row) => JSON.stringify(row)).join('\n') + '\n');
  return sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: name });
}
async function codexSession(t, { command, output, final, name }) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-c-events-cx-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `rollout-2026-10-01T14-00-00-${name}.jsonl`);
  const response = (payload) => ({ type: 'response_item', payload });
  await writeFile(file, [{ type: 'session_meta', payload: { id: name, cwd: '/srv/x' } },
    response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'SYNTHETIC_E_CX_ASK: make the suite pass.' }] }),
    response({ type: 'function_call', name: 'exec_command', call_id: 'cmd-1', arguments: JSON.stringify({ cmd: command }) }),
    response({ type: 'function_call_output', call_id: 'cmd-1',
      output: `Chunk ID: 5f1e2a\nWall time: 0.5000 seconds\nProcess exited with code 1\nOriginal token count: 2\nOutput:\n${output}` }),
    response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: final }] }),
  ].map((row) => JSON.stringify(row)).join('\n') + '\n');
  return sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: name });
}
const idOf = (session, marker, kind) => session.events.find((event) => event.kind === kind
  && session.sourcesFor(event).some((source) => source.text.includes(marker)))?.id;

test('M33 C event binding: sliced Claude Code and Codex recordings publish DECIDE — single claims and B09 nested quotes', async (t) => {
  const SLICED = {
    A22_ccEchoBullet: { adapter: 'claude', command: 'npx jest', output: 'Tests: 1 failed, 41 passed, 42 total',
      final: 'SYNTHETIC_E_CC1: Summary:\n- Tests: 1 failed, 41 passed, 42 total (flake)\n- All 42 tests pass on rerun\n- Ready to merge', quote: 'All 42 tests pass on rerun' },
    A23_ccRemedyNoRerun: { adapter: 'claude', command: 'pytest', output: 'FAILED tests/test_api.py::test_login - assert 500 == 200',
      final: 'SYNTHETIC_E_CC2: I fixed test_login by updating the fixture token. The test suite passes.', quote: 'The test suite passes.' },
    A24_ccCurly: { adapter: 'claude', command: 'npm test', output: '1 failing\n  1) parser handles nested input',
      final: 'SYNTHETIC_E_CC3: That’s it — everything’s passing.', quote: 'everything’s passing.' },
    A25_cxEchoDismiss: { adapter: 'codex', command: 'cargo test', output: 'test result: FAILED. 11 passed; 1 failed',
      final: 'SYNTHETIC_E_CX1: cargo printed test result: FAILED. 11 passed; 1 failed — a known flake. All tests pass.', quote: 'All tests pass.' },
    A26_cxBullet: { adapter: 'codex', command: 'go test ./...', output: '--- FAIL: TestLogin (0.00s)\nFAIL',
      final: 'SYNTHETIC_E_CX2:\n* Updated handler\n* `--- FAIL: TestLogin` fixed\n* go test ./... is green', quote: 'go test ./... is green' },
    A27_cxQuoteVariant: { adapter: 'codex', command: 'npm test', output: 'npm ERR! Test failed.  See above for more details.',
      final: 'SYNTHETIC_E_CX3: “Test failed” was the stale cache; tests now pass.', quote: 'tests now pass.' },
  };
  for (const [name, spec] of Object.entries(SLICED)) {
    await assertDecides(name, async () => {
      const session = spec.adapter === 'claude' ? await claudeCodeSession(t, { ...spec, name }) : await codexSession(t, { ...spec, name });
      const said = idOf(session, spec.final.slice(0, 14), 'commentary'), seen = idOf(session, spec.output.slice(0, 10), 'observation');
      assert.ok(said && seen, `${name}: premise — recorded`);
      const claim = { text: 'x', stated: receipt(said, 'commentary', spec.quote), contradictedBy: receipt(seen, 'observation', spec.output) };
      return { session, narrative: narrativeOf([claim]) };
    }, []);
  }
  // B09: nested quotes on a sliced Claude Code recording (two claims of one final message, one run).
  const final = 'SYNTHETIC_E_CCN: Rewrote the tokenizer. The nested input case now passes.';
  let inner = null;
  await assertDecides('B09_ccNestedOuterRefuted', async () => {
    const session = await claudeCodeSession(t, { command: 'npx jest src/parser.test.js', output: OUT, final, name: 'e-ccn' });
    const said = idOf(session, 'SYNTHETIC_E_CCN', 'commentary'), seen = idOf(session, 'nested input', 'observation');
    const outer = { text: 'o', stated: receipt(said, 'commentary', 'Rewrote the tokenizer.'), contradictedBy: receipt(seen, 'observation', OUT) };
    inner = { text: 'i', stated: receipt(said, 'commentary', 'The nested input case now passes.'), contradictedBy: receipt(seen, 'observation', LINE) };
    return { session, narrative: narrativeOf([outer, inner]), options: { verdict: (item) => (item.key === 'claims:0' ? 'refuted' : 'not-refuted'),
      cite: (item) => (item.key === 'claims:0' ? [outer.stated] : [ownReceipt(item)]) } };
  }, [{ key: 'claims:1', get stated() { return inner.stated; } }]);
});

// ---- the must-publish probes on the combined route's joint answer ---------------------------------------------------

const INDEX = 'src/login.js';
const JOINT_PR = { repo: { host: 'github.com', id: '410' }, number: 410, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete', files: [{ path: INDEX, change: 'added', contentState: 'complete' }] };
const JOINT_DIFF = ['diff --git a/src/login.js b/src/login.js', 'new file mode 100644', '--- /dev/null', '+++ b/src/login.js',
  '@@ -0,0 +1,1 @@', '+export const SYNTHETIC_E_JOINT = 1;', ''].join('\n');
function jointSession(said, testOut) {
  const blobs = { ask: 'SYNTHETIC_E_JOINT_ASK: fix the login handler, export SYNTHETIC_E_JOINT as 1, and make its tests pass.',
    body: 'export const SYNTHETIC_E_JOINT = 1;\n', out: 'SYNTHETIC_E_JOINT_OUT: File created successfully', test: 'npx jest test/login.test.js',
    testOut, said };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  return new Session({ sessionKey: 'joint-e', adapter: 'claude', blobs, events: [
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
const sessionFinding = (quote, against) => ({ origin: 'session-review', kind: 'claim_contradicted', title: 'SYNTHETIC_E_JOINT_CONTRADICTED',
  explanation: 'SYNTHETIC: the recorded result contradicts the statement.', scope: 'session-effect', anchor: null,
  receipts: [receipt('C1', 'commentary', quote), receipt('O2', 'observation', against)] });
const jointJudge = ({ codeFindings = [], sessionFindings = [], votes }) => async (request) => {
  if (request.challenge) return { votes: votes(request.challenge.items) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...JOINT_BASE, reviewedFiles: [INDEX] };
  const narrative = /^code\+narrative:/.test(request.label ?? '');
  return { ...JOINT_BASE, reviewedFiles: narrative ? [INDEX] : [], ...(narrative ? { codeFindings, sessionFindings } : {}) };
};
const codeReceipt = () => {
  const src = codeReview.snapshotDiff({ pr: JOINT_PR, diff: JOINT_DIFF }).sources.find((s) => s.path === INDEX && s.side === 'RIGHT');
  return { role: 'code', eventId: src.eventId, revisionOid: src.revisionOid, quote: 'export const SYNTHETIC_E_JOINT = 1;' };
};
const JOINT_OUT = 'FAIL test/login.test.js\n  x rejects bad passwords';
const jointVotes = (report, key) => report.codeChallenges.flatMap((c) => c.results).filter((r) => r.key === key).flatMap((r) => r.votes);

test('M33 C event binding: joint session findings on honest votes publish DECIDE (J01, J02 shared output, J04 nested)', async () => {
  const said = 'SYNTHETIC_E_JS_SAID: FAIL test/login.test.js was a stale snapshot; all login tests pass.';
  // J01: a dismissed failure.
  const j01 = await codeReview.runCodeReview({ session: jointSession(said, JOINT_OUT), pr: JOINT_PR, diff: JOINT_DIFF,
    judge: jointJudge({ sessionFindings: [sessionFinding('all login tests pass.', JOINT_OUT)], votes: (items) => items.map(({ key }) => ({ key,
      verdict: 'not-refuted', explanation: 'S.', receipts: [receipt('O2', 'observation', JOINT_OUT)] })) }) });
  assert.equal(j01.sessionStatus, 'DECIDE', 'J01');
  // J02: an honest code finding that also cites the failing output; the honest session vote cites the output AND the
  // code line that causes it.
  const CODE = { origin: 'code-review', kind: 'code_issue', title: 'SYNTHETIC_E_CODE', explanation: 'SYNTHETIC: the handler constant breaks login.',
    receipts: [codeReceipt(), receipt('O2', 'observation', 'x rejects bad passwords')], scope: 'current-code',
    anchor: { path: INDEX, side: 'RIGHT', startLine: 1, endLine: 1 } };
  const j02 = await codeReview.runCodeReview({ session: jointSession(said, JOINT_OUT), pr: JOINT_PR, diff: JOINT_DIFF,
    judge: jointJudge({ codeFindings: [CODE], sessionFindings: [sessionFinding('all login tests pass.', JOINT_OUT)],
      votes: (items) => items.map(({ key, type }) => ({ key, verdict: 'not-refuted', explanation: 'S.',
        receipts: type === 'code-finding' ? [codeReceipt()] : [receipt('O2', 'observation', JOINT_OUT), codeReceipt()] })) }) });
  assert.equal(j02.sessionStatus, 'DECIDE', 'J02');
  assert.deepEqual(j02.findings.map((f) => `${f.kind}:${f.status}`).sort(), ['claim_contradicted:DECIDE', 'code_issue:DECIDE'], 'J02');
  assert.ok(jointVotes(j02, 'session-0').every((v) => v.valid), 'J02: every honest session vote binds');
  // J04: two joint session findings with nested observation quotes; the outer (spurious) is refuted.
  const nestedSaid = 'SYNTHETIC_E_JN: Rewrote the login handler. Bad passwords are rejected now.';
  const j04 = await codeReview.runCodeReview({ session: jointSession(nestedSaid, JOINT_OUT), pr: JOINT_PR, diff: JOINT_DIFF,
    judge: jointJudge({ sessionFindings: [sessionFinding('Rewrote the login handler.', JOINT_OUT),
      sessionFinding('Bad passwords are rejected now.', 'x rejects bad passwords')],
    votes: (items) => items.map(({ key }) => (key === 'session-0'
      ? { key, verdict: 'refuted', explanation: 'S.', receipts: [receipt('C1', 'commentary', 'Rewrote the login handler.')] }
      : { key, verdict: 'not-refuted', explanation: 'S.', receipts: [receipt('O2', 'observation', 'x rejects bad passwords')] })) }) });
  assert.equal(j04.sessionStatus, 'DECIDE', 'J04');
  assert.deepEqual(j04.findings.map((f) => `${f.kind}:${f.status}`), ['claim_contradicted:DECIDE'], 'J04');
  assert.ok(jointVotes(j04, 'session-1').every((v) => v.valid), 'J04: every honest vote on the inner finding binds');
});

// ---- 1. event level only --------------------------------------------------------------------------------------------

test('M33 C event binding: a vote binds on any of its item\'s own events, whatever it quotes there; never on another\'s', async () => {
  const { session, claim } = afterFailure({ output: 'SYNTHETIC_E_H: 1 failing\nSYNTHETIC_E_H: 11 passing',
    words: 'SYNTHETIC_E_H: All tests pass.', quote: 'All tests pass.', against: 'SYNTHETIC_E_H: 1 failing' });
  const elsewhere = receipt('I1', 'instruction', 'make the suites pass.');
  const CITES = {
    // Words the item does not itself quote, on its own events — a line of the result, the whole message, the command.
    otherLineOfItsResult: [receipt('A1-r', 'observation', 'SYNTHETIC_E_H: 11 passing')],
    wholeMessage: [receipt('C1', 'commentary', 'SYNTHETIC_E_H: All tests pass.')],
    itsCommand: [receipt('A1', 'action', 'node /srv/x/unit.js')],
    elsewhereAndItsResult: [elsewhere, receipt('A1-r', 'observation', 'SYNTHETIC_E_H: 1 failing')],
  };
  const narrative = narrativeOf([claim]);
  for (const [name, cite] of Object.entries(CITES)) {
    const report = await run(session, judgeWith(narrative, { cite: () => cite }));
    assert.equal(publishedFor(report, claim.stated), 'DECIDE', name);
    assert.ok(votesOf(report, 'claims:0').every((v) => v.valid), name);
  }
  // A vote citing none of the item's own events is answered and invalid: support_unbound, never support.
  const unbound = await run(session, judgeWith(narrative, { cite: () => [elsewhere] }));
  assert.equal(publishedFor(unbound, claim.stated), undefined);
  assert.ok(votesOf(unbound, 'claims:0').every((v) => v.answered && !v.valid && v.cause === 'support_unbound'));
  assert.notEqual(unbound.sessionStatus, 'CLEAN', 'an unsettled contradiction check is never read as clean');
});

test('M33 C event binding: the closed vote causes are support_unbound alone; misfiled votes and the quote rules are gone', () => {
  // Status fact (owner decision 2026-10-06) adds one: a vote on an item citing an uncovered result that quotes no output.
  // D80 adds one: a vote receipt quoting only the body of a write whose command did not run or failed.
  assert.deepEqual([...challenge.VOTE_REJECTION_CAUSES], ['support_unbound', 'result_unquoted',
    'write_command_not_run_or_failed']);
  assert.ok(Object.isFrozen(challenge.VOTE_REJECTION_CAUSES));
  for (const gone of ['TWIN_GUARDED', 'quoteWithin', 'quotesOverlap', 'misfiledVotes'])
    assert.ok(!Object.hasOwn(reviewRun, gone) && !Object.hasOwn(challenge, gone), gone);
});

test('M33 C event binding: challengeItems takes no evidenceOf option — the only binding is supportEvents', async () => {
  // M33 C2 repair: a claim-class item is asked only with code's grounded words (`verbatim`), as the run gives it.
  const items = [{ key: 'a', type: 'claim', candidate: { text: 'SYNTHETIC a', stated: { eventId: 'C0', role: 'commentary', quote: 'SYNTHETIC said' } }, verbatim: { quote: 'SYNTHETIC said' } },
    { key: 'b', type: 'claim', candidate: { text: 'SYNTHETIC b', stated: { eventId: 'C0', role: 'commentary', quote: 'SYNTHETIC said' } }, verbatim: { quote: 'SYNTHETIC said' } }];
  const verifyReceipt = (r) => ({ ok: true, receipt: r });
  const cited = (...ids) => ids.map((eventId) => ({ eventId, role: 'observation', quote: `SYNTHETIC ${eventId}` }));
  // b is bound to E1; its vote cites E1 — its own event — and E2, which a cites too. An `evidenceOf` naming E1 and
  // E2 as a's (the misfiled-vote rule of 2fe78b1 then voided b's honest vote) must change nothing.
  const judge = async (request) => ({ votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'S.', receipts: key === 'a' ? cited('E2') : cited('E1', 'E2') })) });
  const supportEvents = (item) => (item.key === 'b' ? new Set(['E1']) : null);
  const plain = await challenge.challengeItems({ items, judge, evidence: 'SYNTHETIC', verifyReceipt, supportEvents });
  const named = await challenge.challengeItems({ items, judge, evidence: 'SYNTHETIC', verifyReceipt, supportEvents,
    evidenceOf: (item) => new Set(item.key === 'a' ? ['E1', 'E2'] : ['E1']) });
  assert.deepEqual(named.results, plain.results);
  assert.deepEqual(plain.survivors.map((i) => i.key), ['a', 'b']);
  assert.ok(plain.results.flatMap((r) => r.votes).every((v) => v.valid));
});

// ---- 2. a key swap between batch-mates with DISJOINT events never publishes the refuted item ----------------------

/** D01/D02: U (unit, true) and L (lint, spurious: a later lint rerun no item cites shows it clean) on disjoint
 *  statements and results. The honest reply upholds U citing its result and refutes L citing the rerun. */
function swapSession() {
  const blobs = { ask: 'SYNTHETIC_E_D_ASK: make the suites pass.', unit: 'node /srv/x/unit.js', unitOut: 'SYNTHETIC_E_D_UNIT: 1 failing',
    lint: 'node /srv/x/lint.js', lintOut: 'SYNTHETIC_E_D_LINT: 3 warnings', lint2: 'node /srv/x/lint.js --fix', lint2Out: 'SYNTHETIC_E_D_LINT2: 0 warnings',
    s1: 'SYNTHETIC_E_D_S1: All unit tests pass.', s2: 'SYNTHETIC_E_D_S2: Lint is clean.' };
  const rows = [['I1', 'ask', 'ask'], ['A4', 'cmd', 'unit'], ['A4-r', 'out', 'unitOut', { of: 'A4', failed: true }],
    ['A5', 'cmd', 'lint'], ['A5-r', 'out', 'lintOut', { of: 'A5', failed: true }], ['A6', 'cmd', 'lint2'], ['A6-r', 'out', 'lint2Out', { of: 'A6' }],
    ['C1', 'said', 's1'], ['C2', 'said', 's2', { phase: 'final' }]];
  const u = { text: 'u', stated: receipt('C1', 'commentary', 'All unit tests pass.'), contradictedBy: receipt('A4-r', 'observation', blobs.unitOut) };
  const l = { text: 'l', stated: receipt('C2', 'commentary', 'Lint is clean.'), contradictedBy: receipt('A5-r', 'observation', blobs.lintOut) };
  const honest = { 'claims:0': { verdict: 'not-refuted', receipts: [u.contradictedBy] },
    'claims:1': { verdict: 'refuted', receipts: [receipt('A6-r', 'observation', blobs.lint2Out)] } };
  const judge = (swap) => async (request) => {
    if (!request.challenge) return narrativeOf([u, l]);
    const keys = request.challenge.items.map((i) => i.key);
    const both = swap && keys.includes('claims:0') && keys.includes('claims:1');
    return { votes: keys.map((key) => ({ key, explanation: 'S.', ...honest[both ? (key === 'claims:0' ? 'claims:1' : 'claims:0') : key] })) };
  };
  return { session: () => build(blobs, rows), u, l, judge };
}

test('M33 C event binding: a key swap between claims with disjoint events never publishes the refuted claim', async () => {
  const { session, u, l, judge } = swapSession();
  for (const speedProfile of PROFILES) {
    const label = profileName(speedProfile);
    const honest = await run(session(), judge(false), speedProfile);
    assert.equal(publishedFor(honest, u.stated), 'DECIDE', `${label}: premise — the honest reply publishes U`);
    assert.equal(publishedFor(honest, l.stated), undefined, `${label}: premise — never L`);
    const swapped = await run(session(), judge(true), speedProfile);
    assert.equal(publishedFor(swapped, l.stated), undefined, `${label}: the swap never publishes L`);
    // L's swapped support vote cites U's result, none of L's events: answered, never support.
    assert.ok(votesOf(swapped, 'claims:1').every((v) => v.answered && !v.valid && v.cause === 'support_unbound'), label);
    assert.notEqual(swapped.sessionStatus, 'CLEAN', `${label}: L's lost check is unsettled, never read as clean`);
  }
});

test('M33 C event binding: a key swap between supports on different results never makes the refuted one "verified"', async () => {
  const blobs = { ask: 'SYNTHETIC_E_V_ASK: make the suites pass.', said: 'SYNTHETIC_E_V_SAID: all unit tests pass and the lint is clean.',
    unit: 'node /srv/x/unit.js', unitOut: 'SYNTHETIC_E_V_UNIT: 12 passing, 1 skipped', lint: 'node /srv/x/lint.js', lintOut: 'SYNTHETIC_E_V_LINT: 0 warnings' };
  const rows = [['I1', 'ask', 'ask'], ['C1', 'said', 'said'], ['A1', 'cmd', 'unit'], ['A1-r', 'out', 'unitOut', { of: 'A1' }],
    ['A2', 'cmd', 'lint'], ['A2-r', 'out', 'lintOut', { of: 'A2' }]];
  const lint = receipt('A2-r', 'observation', 'SYNTHETIC_E_V_LINT: 0 warnings'), unit = receipt('A1-r', 'observation', '12 passing, 1 skipped');
  const X = { text: 'The agent said the lint is clean.', stated: receipt('C1', 'commentary', 'the lint is clean.'), contradictedBy: null, supportedBy: lint };
  // The skipped test: the unit result does not show "all unit tests pass" — the honest challenger refutes Y's support.
  const Y = { text: 'The agent said all unit tests pass.', stated: receipt('C1', 'commentary', 'all unit tests pass'), contradictedBy: null, supportedBy: unit };
  const honest = { 'claims:0:support': { verdict: 'not-refuted', receipts: [lint] },
    'claims:1:support': { verdict: 'refuted', receipts: [receipt('A1-r', 'observation', '1 skipped')] } };
  const judge = (swap) => async (request) => {
    if (!request.challenge) return narrativeOf([X, Y]);
    return { votes: request.challenge.items.map(({ key, candidate }) => ({ key, explanation: 'S.',
      ...(honest[key] ? honest[swap ? (key === 'claims:0:support' ? 'claims:1:support' : 'claims:0:support') : key]
        : { verdict: 'not-refuted', receipts: [candidate.stated] }) })) };
  };
  for (const speedProfile of PROFILES) {
    const label = profileName(speedProfile);
    const status = (report, quote) => report.promises.find((p) => p.stated.quote === quote)?.status;
    const truth = await run(build(blobs, rows), judge(false), speedProfile);
    assert.equal(status(truth, 'the lint is clean.'), 'verified', `${label}: premise`);
    assert.equal(status(truth, 'all unit tests pass'), 'open', `${label}: premise`);
    const swapped = await run(build(blobs, rows), judge(true), speedProfile);
    assert.equal(status(swapped, 'all unit tests pass'), 'open', `${label}: the refuted support is never confirmed by a swap`);
    assert.equal(status(swapped, 'the lint is clean.'), 'open', `${label}: the swap costs the honest one — conservatively`);
  }
});

// ---- 3. a failed rerun never resolves a true contradiction ---------------------------------------------------------

/** V06: a true contradiction, then a "correction" on a rerun recorded as failed — or succeeded with a nonzero exit,
 *  or cancelled — whose output still shows a failure. */
function failedRerun(over) {
  const blobs = { ask: 'SYNTHETIC_E_V6_ASK', cmd: 'npm test', out: 'Tests: 2 failed, 40 passed', said: 'SYNTHETIC_E_V6_SAID: All 42 tests pass.',
    re: 'npm test', reOut: 'Tests: 1 failed, 41 passed', said2: 'SYNTHETIC_E_V6_FIX: Correction: fixed it, 41 passed now.' };
  const rows = [['I1', 'ask', 'ask'], ['A1', 'cmd', 'cmd'], ['A1-r', 'out', 'out', { of: 'A1', failed: true }], ['C1', 'said', 'said'],
    ['A2', 'cmd', 're'], ['A2-r', 'out', 'reOut', { of: 'A2', ...over }], ['C2', 'said', 'said2', { phase: 'final' }]];
  const claim = { text: 'c', stated: receipt('C1', 'commentary', 'All 42 tests pass.'), contradictedBy: receipt('A1-r', 'observation', 'Tests: 2 failed, 40 passed'),
    resolvedBy: { observation: receipt('A2-r', 'observation', '41 passed'), statement: receipt('C2', 'commentary', 'fixed it, 41 passed now.') } };
  return { session: build(blobs, rows), narrative: narrativeOf([claim]), claim };
}

test('M33 C event binding: V06 a resolution on a failed rerun is rejected by code (failed_result) — the contradiction stays DECIDE', async () => {
  const at = ledger.RESOLUTION_REJECTIONS.indexOf('failed_result');
  assert.ok(at > ledger.RESOLUTION_REJECTIONS.indexOf('cross_actor') && at < ledger.RESOLUTION_REJECTIONS.indexOf('turn_unrecorded'),
    'checked where a support checks it: after the actor, before the turn');
  assert.equal(new Set(ledger.RESOLUTION_REJECTIONS).size, ledger.RESOLUTION_REJECTIONS.length);
  const resolutionAsked = (seen) => seen.some((request) => request.challenge?.items.some((item) => item.type === 'resolution'));
  for (const [name, over] of Object.entries({ failed: { failed: true }, nonzeroExit: { exitCode: 2 }, cancelled: { result: 'cancelled', exitCode: null } })) {
    await assertDecides(`V06_${name}`, () => failedRerun(over), [{ key: 'claims:0', stated: failedRerun(over).claim.stated }]);
    for (const speedProfile of PROFILES) {
      const label = `${name} ${profileName(speedProfile)}`;
      const seen = [];
      const { session, narrative } = failedRerun(over);
      const judge = judgeWith(narrative);
      const report = await run(session, async (request) => { seen.push(request); return judge(request); }, speedProfile);
      assert.deepEqual(contradictions(report).map((f) => [f.status, f.disclosureReason ?? null]), [['DECIDE', null]], label);
      assert.equal(report.counts.resolutions.rejected.failed_result, 1, `${label}: counted by its closed reason`);
      assert.equal(report.counts.resolutions.verified, 0, label);
      assert.ok(!resolutionAsked(seen), `${label}: rejected by code, never put to a challenger`);
    }
  }
  // Premise: the same correction on a passing rerun publishes FYI self_corrected.
  const passing = failedRerun({});
  const report = await run(passing.session, judgeWith(passing.narrative, { cite: (item) => (item.type === 'resolution'
    ? [item.candidate.resolvedBy.observation] : [ownReceipt(item)]) }));
  assert.deepEqual(contradictions(report).map((f) => [f.status, f.disclosureReason]), [['FYI', 'self_corrected']]);
});

// ---- 4. a promise in a contradicted statement stays open: event identity --------------------------------------------

function verifiedSession() {
  const blobs = { ask: 'SYNTHETIC_E_P_ASK: make the parser suite pass.', cmd: 'npx jest src/parser.test.js',
    out: 'FAIL src/parser.test.js\n  x parses nested input (4 ms)', said: 'SYNTHETIC_E_P_SAID: All parser tests pass. The parser suite is green.',
    other: 'SYNTHETIC_E_P_OTHER: The parser suite is green.', re: 'npx jest src/parser.test.js', reOut: 'SYNTHETIC_E_P_RE: Tests: 12 passed, 12 total' };
  const rows = [['I1', 'ask', 'ask'], ['A1', 'cmd', 'cmd'], ['A1-r', 'out', 'out', { of: 'A1', failed: true }],
    ['C1', 'said', 'said'], ['C9', 'said', 'other', { phase: 'final' }], ['A2', 'cmd', 're'], ['A2-r', 'out', 'reOut', { of: 'A2' }]];
  const contradicted = { text: 'c', stated: receipt('C1', 'commentary', 'All parser tests pass.'),
    contradictedBy: receipt('A1-r', 'observation', 'x parses nested input (4 ms)') };
  // Different words of the SAME statement, supported by a later passing rerun.
  const sameEvent = { text: 's', stated: receipt('C1', 'commentary', 'The parser suite is green.'), contradictedBy: null,
    supportedBy: receipt('A2-r', 'observation', 'Tests: 12 passed, 12 total') };
  // The same words in ANOTHER statement.
  const otherEvent = { ...sameEvent, stated: receipt('C9', 'commentary', 'The parser suite is green.') };
  return { blobs, rows, contradicted, sameEvent, otherEvent };
}

test('M33 C event binding: V01 a promise in the statement of a published contradiction is never "verified"', async () => {
  const { blobs, rows, contradicted, sameEvent, otherEvent } = verifiedSession();
  for (const speedProfile of PROFILES) {
    const label = profileName(speedProfile);
    const report = await run(build(blobs, rows), judgeWith(narrativeOf([contradicted, sameEvent])), speedProfile);
    assert.equal(publishedFor(report, contradicted.stated), 'DECIDE', `${label}: premise`);
    assert.deepEqual(report.promises.map((p) => [p.stated.eventId, p.status]), [['C1', 'open']], `${label}: words that never overlap`);
    assert.equal(report.counts.promiseSupport.rejected.contradicted, 1, label);
    // The same words in another statement are not that statement: the support stands.
    const other = await run(build(blobs, rows), judgeWith(narrativeOf([contradicted, otherEvent])), speedProfile);
    assert.deepEqual(other.promises.map((p) => [p.stated.eventId, p.status]), [['C9', 'verified']], `${label}: another event`);
  }
});

test('M33 C event binding: a promise in the statement of an unsettled or unexecuted contradiction stays open; a refuted one leaves it', async () => {
  const { blobs, rows, contradicted, sameEvent } = verifiedSession();
  const narrative = narrativeOf([contradicted, sameEvent]);
  const OUTCOMES = {
    unsettled: { verdict: (item) => (item.key === 'claims:0' ? 'uncertain' : 'not-refuted') },
    // Every reply leaves the contradiction out: its slots are never answered, even on the re-ask.
    unexecuted: null,
    refuted: { verdict: (item) => (item.key === 'claims:0' ? 'refuted' : 'not-refuted'),
      cite: (item) => (item.key === 'claims:0' ? [receipt('A2-r', 'observation', 'Tests: 12 passed, 12 total')] : [ownReceipt(item)]) },
  };
  for (const speedProfile of PROFILES) {
    for (const [outcome, options] of Object.entries(OUTCOMES)) {
      const label = `${outcome} ${profileName(speedProfile)}`;
      const honest = judgeWith(narrative, options ?? {});
      const judge = options ? honest : async (request) => {
        const reply = await honest(request);
        return request.challenge ? { votes: reply.votes.filter((vote) => vote.key !== 'claims:0') } : reply;
      };
      const report = await run(build(blobs, rows), judge, speedProfile);
      assert.equal(publishedFor(report, contradicted.stated), undefined, `${label}: premise — not published`);
      // S6 (S5 review H1; owner decision D71 b): a contradiction that did not settle is kept as the claim, not checked,
      // with how its check ended; a refuted one is left out.
      assert.deepEqual(report.promises.map((p) => [p.stated.eventId, p.status, p.reason ?? null]),
        outcome === 'refuted' ? [['C1', 'verified', null]]
          : [['C1', 'open', `challenge_${outcome}`], ['C1', 'open', null]], label);
      if (outcome !== 'refuted') assert.notEqual(report.sessionStatus, 'CLEAN', label);
    }
  }
});

test('M33 C event binding: unverifiedBesideFindings lowers by the statement\'s event, never by word overlap', () => {
  const session = build({ a: 'SYNTHETIC_E_U: alpha. beta.', b: 'SYNTHETIC_E_U2: alpha.' },
    [['C1', 'said', 'a'], ['C2', 'said', 'b']]);
  const verified = (eventId, quote) => ({ status: 'verified', stated: receipt(eventId, 'commentary', quote),
    receipts: [receipt(eventId, 'commentary', quote), receipt('X-r', 'observation', 'SYNTHETIC')] });
  const finding = { kind: 'claim_contradicted', receipts: [receipt('C1', 'commentary', 'alpha.'), receipt('X-r', 'observation', 'SYNTHETIC')] };
  const promises = [verified('C1', 'beta.'), verified('C2', 'alpha.'), { ...verified('C1', 'alpha.'), status: 'open' }];
  const { promises: out, lowered } = reviewRun.unverifiedBesideFindings(session, promises, [finding]);
  assert.equal(lowered, 1);
  assert.deepEqual(out.map((p) => [p.stated.eventId, p.stated.quote, p.status]),
    [['C1', 'beta.', 'open'], ['C2', 'alpha.', 'verified'], ['C1', 'alpha.', 'open']]);
  assert.deepEqual(out[0].receipts, [promises[0].stated], 'lowered to its statement alone');
  // Only a claim_contradicted finding's statement counts.
  assert.equal(reviewRun.unverifiedBesideFindings(session, promises, [{ ...finding, kind: 'edit_not_asked_for' }]).lowered, 0);
  assert.deepEqual(reviewRun.unverifiedBesideFindings(session, undefined, undefined), { promises: [], lowered: 0 });
});
