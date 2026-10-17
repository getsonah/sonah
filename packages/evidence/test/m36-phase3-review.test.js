// M36 phase 3 review (2026-10-08; D68 "M36 phase 3 review"; C-07 "M36 packed windows, carried failures and the
// evidence re-ask" 3, 5, 9–11; C-05 "M36 phase 3"; C-02 "M36 recorded facts"). Each finding of the review, reproduced on
// the phase's commit by a synthetic session and fixed globally:
//   1. a kept evidence re-ask answer is MERGED into the first answer by the one re-ask rule (`reaskedAnswer`): a proposal
//      the first answer grounded is never lost because the re-ask did not repeat it;
//   2. (c6) a quote grounds in the event its receipt cites, which names its session: the same words in a packed helper's
//      shown text no longer withhold the main agent's own contradicted claim (a false NONE);
//   3. (F) a call the recorder typed as denied (Claude Code's `toolDenialKind`, now a recorded fact) never ran, so it is
//      never a proven failure;
//   4. (Q) a request for a field that holds no text is `not_requestable`, and for the file before a change whose prior
//      state Sonah withheld, `withheld`;
//   5. (Q) no hidden length bound decides how a request entry is read;
//   6. (c6) a verified receipt carries the session its quote grounds in (the cited event's recorded child id).
//
// Synthetic sessions and judges only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, verifyReceipt, shownSession } from '../src/session.js';
import * as reviewRun from '../src/run-review.js';
import { provenFailure, carriedContext, bytesOfTokens, WINDOW_SETTINGS } from '../src/windows.js';
import { serveEvidence, EVIDENCE_REQUEST_LIMITS } from '../src/evidence-requests.js';
import { RECORDED_FACT_KEYS, PRIOR_WITHHELD_REASONS, sessionFromLedger } from '../adapters/sonah-ledger.js';
import { RECORDED_FACTS } from '../../redact/index.js';
import { load, humanAsk, call, result, said } from './m33-u-unasked-fixture.js';

const KEY = 'sess-m36-phase3-review';
const refs = (blobs) => {
  let n = 0;
  return (text) => {
    const key = `b${++n}`;
    blobs[key] = text;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
  };
};
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const empty = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
const ownReceipt = ({ candidate }) => candidate.contradictedBy ?? candidate.supportedBy ?? candidate.stated
  ?? candidate.instruction ?? candidate.receipts?.[0];
const honest = (request) => ({ votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
  explanation: 'Synthetic.', receipts: [ownReceipt(item)] })) });

// ---- 1. the evidence re-ask never replaces the first answer --------------------------------------------------------------

// D103: a Claude Code recording's result is cut past twice its 12,000-byte skim: 1,000 lines of about 53 bytes, its
// failure in the cut middle.
const LONG = Array.from({ length: 1_000 }, (_, k) => `line ${k + 1}: ${k === 499 ? 'not ok 7 - FAILS in the middle'
  : `ok ${'.'.repeat(40)}`}`).join('\n');
/** A lint error shown whole, a long test run whose failing line lies in its cut middle, an edit, the closing claim. */
function lintAndTests() {
  const blobs = {};
  const ref = refs(blobs);
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('Run lint and the tests.'), turn: 'T1' },
    { id: 'L1', kind: 'invocation', callKey: 'L1', tool: 'Bash', operation: 'command', paths: [], command: ref('npm run lint'),
      input: [], changes: [], turn: 'T1' },
    { id: 'L1-r', kind: 'observation', invocation: 'L1', callKey: 'L1', phase: 'terminal', result: 'failed', exitCode: 1,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref('error: unused variable x in src/a.js'), turn: 'T1' },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', paths: [], command: ref('npm test'),
      input: [], changes: [], turn: 'T1' },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'succeeded', exitCode: 0,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref(LONG), turn: 'T1' },
    { id: 'W1', kind: 'invocation', callKey: 'W1', tool: 'edit', operation: 'edit', paths: [{ path: 'src/a.js' }], command: [],
      input: [], turn: 'T1', changes: [{ path: 'src/a.js', after: ref('const y = 2;'), replaced: ref('const y = 1;'),
        extent: { recorded: true } }] },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', callKey: 'W1', phase: 'terminal', result: 'succeeded', exitCode: 0,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref('ok'), turn: 'T1' },
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref('Lint is clean and all tests pass.'),
      turn: 'T1' },
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs, events, children: [] });
}

test('M36 phase 3 review (1): a re-ask that leaves out a contradiction the first answer grounded never loses it', async () => {
  const s = lintAndTests();
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  const a = (id) => plan.requests[0].aliases.of(id);
  const lint = { text: 'Lint is clean.', stated: receipt(a('C1'), 'commentary', 'Lint is clean and all tests pass.'),
    contradictedBy: receipt(a('L1-r'), 'observation', 'error: unused variable x in src/a.js') };
  const tests = { text: 'All tests pass.', stated: receipt(a('C1'), 'commentary', 'Lint is clean and all tests pass.'),
    contradictedBy: receipt(a('A1-r'), 'observation', 'not ok 7 - FAILS in the middle') };
  const reviewWith = (reask) => reviewRun.runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge: async (request) => {
    if (request.challenge) return honest(request);
    if (request.label.endsWith(':evidence')) { if (reask === null) throw new Error('down'); return reask; }
    return { ...empty(), claims: [lint], evidenceRequests: [{ eventId: a('A1-r'), fromLine: 499, throughLine: 501 }] };
  } });
  const findings = (report) => report.findings.map((f) => [f.kind, f.status,
    f.receipts.find((r) => r.role === 'observation')?.eventId]);
  // The re-ask fails: the first answer stands (as before).
  const failed = await reviewWith(null);
  assert.deepEqual(findings(failed), [['claim_contradicted', 'DECIDE', 'L1-r']]);
  // The re-ask answers without the lint claim: merged, never replaced — the first answer's DECIDE stands.
  const silent = await reviewWith(empty());
  assert.deepEqual(findings(silent), [['claim_contradicted', 'DECIDE', 'L1-r']]);
  assert.deepEqual([silent.windowResults[0].evidence.kept, silent.windowResults[0].evidence.fromFirst], ['merged', 1]);
  assert.deepEqual(silent.withheld, { proposals: 0, unsettled: 0 });
  // The re-ask repeats it and adds what the served lines show: the repeat is one proposal, the addition is kept.
  const adds = await reviewWith({ ...empty(), claims: [lint, tests] });
  assert.deepEqual(adds.windowResults[0].evidence.fromFirst, 0);
  assert.deepEqual(findings(adds).sort(), [['claim_contradicted', 'DECIDE', 'A1-r'], ['claim_contradicted', 'DECIDE', 'L1-r']]);
  assert.equal(adds.counts.evidenceRequests.fromFirst, 0);
  assert.equal(adds.counts.evidenceRequests.kept, 1);
});

test('M36 phase 3 review (1): the served text only adds or corrects — the re-ask\'s copy of one proposal is kept, nothing of the first is lost', () => {
  const s = lintAndTests();
  const instruction = receipt('I1', 'instruction', 'Run lint and the tests.');
  const claim = { text: 'a', stated: receipt('C1', 'commentary', 'Lint is clean and all tests pass.') };
  const decision = { dimension: 'how the tests run', chosen: 'npm test', actions: ['A1'] };
  const first = { ...empty(), decisions: [decision], claims: [claim],
    requirements: [{ text: 'Run the tests.', instruction, status: 'addressed' }] };
  // The re-ask corrects the requirement's status and the decision's choice (one proposal each, by exact identity), and
  // leaves the claim out.
  const reask = { ...empty(), decisions: [{ ...decision, chosen: 'npm test, once' }],
    requirements: [{ text: 'Run the tests.', instruction, status: 'partly-addressed' }] };
  const kept = reviewRun.servedAnswer({ first, reask, session: s });
  assert.deepEqual(kept.narrative.requirements.map((r) => r.status), ['partly-addressed'], 'the correction is kept');
  assert.deepEqual(kept.narrative.decisions.map((d) => d.chosen), ['npm test, once']);
  assert.deepEqual(kept.narrative.claims, [claim], 'the claim the re-ask left out is not lost');
  assert.equal(kept.fromFirst, 1);
  // The re-ask's unreadable proposal stays, to be read as it always is; the first answer's unreadable one is not carried.
  const unreadable = { dimension: 'no actions' };
  const both = reviewRun.servedAnswer({ first: { ...first, decisions: [unreadable] }, reask: { ...reask, decisions: [unreadable] }, session: s });
  assert.deepEqual(both.narrative.decisions, [unreadable]);
  // The proposal re-ask (a resample of the same request) keeps the first answer's copy, as it always did.
  assert.deepEqual(reviewRun.reaskedAnswer({ first, second: reask, session: s }).narrative.requirements.map((r) => r.status), ['addressed']);
});

// ---- 2 and 6. a quote grounds in the event it cites (c6) ----------------------------------------------------------------

const FAIL = 'FAIL src/login.test.js > rejects an expired token';
/** The main agent says the tests pass; its own run shows a failing line; a helper it launched ran the same suite and printed
 *  the same line. `helperPad` / `parentPad` bytes of padding decide whether the helper shares its parent's window. */
function sameFailure({ helperPad = 0, parentPad = 0 } = {}) {
  const blobs = {};
  const ref = refs(blobs);
  const A = { childId: 'a', turn: 'T1' };
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('Fix the login bug and run the tests.'), turn: 'T1' },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Agent', operation: 'delegate', paths: [], command: [],
      input: ref('Run the test suite and report.'), changes: [], turn: 'T1' },
    { id: 'a:I1', kind: 'instruction', authority: 'agent', supersedes: [], text: ref('Run the test suite and report.'), ...A },
    { id: 'a:R1', kind: 'invocation', callKey: 'a:R1', tool: 'Bash', operation: 'command', paths: [], command: ref('npm test'),
      input: [], changes: [], ...A },
    { id: 'a:R1-r', kind: 'observation', invocation: 'a:R1', callKey: 'a:R1', phase: 'terminal', result: 'failed', exitCode: 1,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref(`3 passed\n${FAIL}\n1 failed`), ...A },
    { id: 'a:C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref(`Ran the suite.${' '.repeat(helperPad)}`), ...A },
    { id: 'D1-r', kind: 'observation', invocation: 'D1', callKey: 'D1', phase: 'terminal', result: 'succeeded', exitCode: 0,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref('Ran the suite.'), helperReported: true, turn: 'T1' },
    { id: 'R1', kind: 'invocation', callKey: 'R1', tool: 'Bash', operation: 'command', paths: [], command: ref('npm test'),
      input: [], changes: [], turn: 'T1' },
    { id: 'R1-r', kind: 'observation', invocation: 'R1', callKey: 'R1', phase: 'terminal', result: 'failed', exitCode: 1,
      terminalStatusProven: true, sourceOfResult: 'native', output: ref(`3 passed\n${FAIL}\n1 failed`), turn: 'T1' },
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref('Fixed it. All tests pass.'), turn: 'T1' },
    { id: 'C0', kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref(`Working.${' x'.repeat(parentPad)}`),
      turn: 'T1' },
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs, events, children: [{ assignmentEvent: 'D1', childId: 'a',
    childSession: `${KEY}/a`, sessionKey: `${KEY}/a`, relation: 'spawn', state: 'verified', historyStart: null }] });
}

async function reviewSameFailure(options) {
  const s = sameFailure(options);
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  const report = await reviewRun.runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge: async (request) => {
    if (request.challenge) return honest(request);
    const built = plan.requests.find((r) => request.prompt.startsWith(r.request.prompt));
    if (!built.window.events.some((event) => event.id === 'C1')) return empty();
    const a = (id) => built.aliases.of(id);
    return { ...empty(), claims: [{ text: 'All tests pass.', stated: receipt(a('C1'), 'commentary', 'All tests pass.'),
      contradictedBy: receipt(a('R1-r'), 'observation', FAIL) }] };
  } });
  return { plan, report };
}

test('M36 phase 3 review (2): packing a helper beside its parent never withholds the parent\'s own contradicted claim', async () => {
  const packed = await reviewSameFailure();
  assert.equal(packed.plan.windows.length, 1, 'premise: the helper shares its parent\'s window');
  const apart = await reviewSameFailure({ helperPad: bytesOfTokens(120_000), parentPad: bytesOfTokens(100_000) / 2 });
  assert.equal(apart.plan.windows.length, 2, 'premise: reviewed apart');
  for (const { report } of [packed, apart]) {
    assert.deepEqual(report.findings.map((f) => [f.kind, f.status]), [['claim_contradicted', 'DECIDE']]);
    assert.deepEqual(report.withheld, { proposals: 0, unsettled: 0 });
    assert.equal(Object.hasOwn(report.counts, 'ambiguousQuotes'), false, 'no text-match rule, no count of it');
  }
  // (6) Its receipts carry the session they ground in: the root's carry the recording's key and no child id.
  const [finding] = packed.report.findings;
  assert.deepEqual(finding.receipts.find((r) => r.role === 'observation'),
    { ...receipt('R1-r', 'observation', FAIL), sessionKey: KEY });
});

test('M36 phase 3 review (6): a helper\'s verified receipt carries its recorded child id; a model\'s own is never kept', () => {
  const s = sameFailure();
  assert.deepEqual(verifyReceipt(s, receipt('a:R1-r', 'observation', FAIL)).receipt,
    { ...receipt('a:R1-r', 'observation', FAIL), sessionKey: KEY, childId: 'a' });
  assert.deepEqual(verifyReceipt(s, { ...receipt('R1-r', 'observation', FAIL), childId: 'a' }).receipt,
    { ...receipt('R1-r', 'observation', FAIL), sessionKey: KEY });
  // A receipt naming another recording's session is refused as before (C-05 session identity).
  assert.equal(verifyReceipt(s, { ...receipt('R1-r', 'observation', FAIL), sessionKey: `${KEY}/a` }).ok, false);
});

test('D69 (a): in a packed window a quote both sessions show is attributed to the session of the event it cites', () => {
  // Owner decision 2026-10-08: quotes in packed windows are attributed to the session of the event they cite (its recorded
  // `childId`, none the root's), replacing the text-match `actor_ambiguous` rejection; grounding stays per shown span.
  const s = sameFailure();
  const [built] = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  assert.equal(built.window.events.some((e) => e.childId === 'a') && built.window.events.some((e) => e.childId == null), true,
    'premise: one window holds the root and its helper');
  const view = shownSession(s, built.sourceMap);
  const root = verifyReceipt(view, receipt('R1-r', 'observation', FAIL));
  const helper = verifyReceipt(view, receipt('a:R1-r', 'observation', FAIL));
  assert.deepEqual([root.ok, helper.ok], [true, true], 'the same line grounds from either event');
  assert.equal(Object.hasOwn(root.receipt, 'childId'), false, 'the root\'s event: the root\'s session');
  assert.equal(helper.receipt.childId, 'a', 'the helper\'s event: the helper\'s session');
  // Grounding stays per shown span: words no span of the cited event shows do not ground, whatever another event shows.
  assert.equal(verifyReceipt(view, receipt('C1', 'commentary', FAIL)).ok, false);
});

// ---- 3. a denied call never ran (F) ---------------------------------------------------------------------------------------

test('M36 phase 3 review (3): the recorder\'s typed denial is a recorded fact, and a denied call is no proven failure', async (t) => {
  assert.deepEqual([...RECORDED_FACTS.denial], ['user-rejected', 'permission-rule', 'automode-blocked',
    'automode-unavailable', 'automode-parsing-error', 'interrupted', 'cancelled']);
  assert.ok(RECORDED_FACTS.keys.includes('denial') && RECORDED_FACT_KEYS.includes('denial'));
  const denied = (id, kind) => ({ ...result(id, 'The call was not run.', undefined, true), toolDenialKind: kind });
  const rows = [
    humanAsk('Fix the CLI flag in src/cli.js and run the tests.'),
    call('e1', 'Edit', { file_path: '/repo/src/cli.js', old_string: 'a', new_string: 'b' }, 'Editing the flag.'),
    denied('e1', 'user-rejected'),
    call('b1', 'Bash', { command: 'rm -rf build', description: 'Clean' }),
    denied('b1', 'permission-rule'),
    call('b2', 'Bash', { command: 'npm publish', description: 'Publish' }),
    denied('b2', 'cancelled'),
    call('b3', 'Bash', { command: 'make', description: 'Build' }),
    denied('b3', 'a-kind-no-recorder-wrote'),
    call('b4', 'Bash', { command: 'npm test', description: 'Run the tests' }),
    result('b4', '1 failing', { stdout: '1 failing', stderr: '', interrupted: false, isImage: false, noOutputExpected: false }, true),
    said('Done: the flag is fixed.'),
  ].map((r, i) => ({ ...r, uuid: `u-denial-${i + 1}` }));
  const { raw, ledger, session } = await load(t, rows);
  const factsOf = (led) => (led.ledger ?? []).map((act) => act.recorded?.denial ?? (act.recorded?.withheld ? 'withheld' : null));
  assert.deepEqual(factsOf(raw), ['user-rejected', 'permission-rule', 'cancelled', 'withheld', null]);
  assert.deepEqual(factsOf(ledger), factsOf(raw), 'redaction keeps the closed members and withholds the rest');
  const calls = session.events.filter((event) => event.kind === 'invocation');
  assert.deepEqual(calls.map((event) => event.recorded?.denial ?? null), ['user-rejected', 'permission-rule', 'cancelled', null, null]);
  const results = session.events.filter((event) => event.kind === 'observation' && event.phase === 'terminal');
  // Only the run that ran and failed — and the unknown kind, which Sonah could not read as a denial — are proven failures.
  assert.deepEqual(results.map((event) => provenFailure(session, event)), [false, false, false, true, true]);
  // So a later window is carried only those.
  const later = { index: 1, events: [session.events.at(-1)], session: { helper: false, childId: null } };
  const context = carriedContext(session, later, WINDOW_SETTINGS);
  assert.deepEqual((context?.failures ?? []).map((failure) => failure.call.id), calls.slice(3).map((event) => event.id));
});

test('M36 phase 3 review (3): a row holding several results attributes its typed denial to none of them', async (t) => {
  const two = { ...result('b1', 'x', undefined, true), toolDenialKind: 'user-rejected' };
  two.message.content.push({ type: 'tool_result', tool_use_id: 'b2', content: 'y', is_error: true });
  const rows = [humanAsk('Run both.'), { ...call('b1', 'Bash', { command: 'a' }),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'a' } },
      { type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'b' } }] } }, two, said('Both ran.')]
    .map((r, i) => ({ ...r, uuid: `u-two-${i + 1}` }));
  const { raw } = await load(t, rows);
  assert.deepEqual((raw.ledger ?? []).map((act) => act.recorded?.denial ?? null), [null, null]);
});

// ---- 4 and 5. every refusal by its own closed reason; no hidden bound ---------------------------------------------------

function serve(s, requests) {
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  const built = plan.requests[0];
  const mapped = requests.map((entry) => (entry && typeof entry.eventId === 'string'
    ? { ...entry, eventId: built.aliases.stable(entry.eventId) } : entry));
  return serveEvidence({ session: s, aliases: built.aliases, sourceMap: built.sourceMap, requests: mapped,
    maxBytes: EVIDENCE_REQUEST_LIMITS.bytes });
}
const nonzero = (refused) => Object.fromEntries(Object.entries(refused).filter(([, n]) => n));

test('M36 phase 3 review (4): an edit\'s own lines and an empty output are not requestable; never out of range', () => {
  const s = lintAndTests();
  const a = (id) => reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' }).requests[0].aliases.of(id);
  const { record } = serve(s, [{ eventId: a('W1'), fromLine: 1, throughLine: 1 }]);
  assert.deepEqual(nonzero(record.refused), { not_requestable: 1 });
  const blobs = {};
  const ref = refs(blobs);
  const quiet = new Session({ sessionKey: KEY, adapter: 'claude', blobs, children: [], events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('Build it.'), turn: 'T1' },
    { id: 'B1', kind: 'invocation', callKey: 'B1', tool: 'Bash', operation: 'command', paths: [], command: ref('make'), input: [],
      changes: [], turn: 'T1' },
    { id: 'B1-r', kind: 'observation', invocation: 'B1', callKey: 'B1', phase: 'terminal', result: 'succeeded', exitCode: 0,
      terminalStatusProven: true, sourceOfResult: 'native', output: [], turn: 'T1' },
  ].map((event, sequence) => ({ ...event, sequence })) });
  const b = (id) => reviewRun.planWindowRequests({ session: quiet, reviewScope: 'session-only' }).requests[0].aliases.of(id);
  assert.deepEqual(nonzero(serve(quiet, [{ eventId: b('B1-r'), fromLine: 1, throughLine: 1 }]).record.refused),
    { not_requestable: 1 });
  // Lines past a text that is there are still out of range.
  assert.deepEqual(nonzero(serve(s, [{ eventId: a('A1-r'), fromLine: 1_900, throughLine: 1_901 }]).record.refused),
    { out_of_range: 1 });
});

test('M36 phase 3 review (4), D90: the file before a change of a credential-shaped path is served as any other', async (t) => {
  const rows = [
    humanAsk('Rotate the token in .env and fix src/cli.js.'),
    call('r1', 'Read', { file_path: '/repo/.env' }),
    result('r1', '1\tTOKEN=old', undefined, false),
    call('e1', 'Edit', { file_path: '/repo/.env', old_string: 'TOKEN=old', new_string: 'TOKEN=new' }),
    result('e1', 'The file /repo/.env has been updated successfully.', undefined, false),
    call('r2', 'Read', { file_path: '/repo/src/cli.js' }),
    result('r2', '1\tconst flag = 1;', undefined, false),
    call('e2', 'Edit', { file_path: '/repo/src/cli.js', old_string: 'const flag = 1;', new_string: 'const flag = 2;' }),
    result('e2', 'The file /repo/src/cli.js has been updated successfully.', undefined, false),
    said('Rotated and fixed.'),
  ].map((r, i) => ({ ...r, uuid: `u-before-${i + 1}` }));
  const { session } = await load(t, rows);
  const edits = session.events.filter((event) => event.kind === 'invocation' && event.operation === 'edit');
  assert.equal(edits.length, 2);
  // D90 (owner decision 2026-10-15): the slicer withholds no prior state for its path (D68 R withheld `.env`'s).
  assert.deepEqual(edits.map((event) => event.changes.map((change) => change.priorWithheld === true)), [[false], [false]]);
  const a = (id) => reviewRun.planWindowRequests({ session, reviewScope: 'session-only' }).requests[0].aliases.of(id);
  for (const edit of edits) {
    const shown = serve(session, [{ eventId: a(edit.id), fileBefore: true, fromLine: 1, throughLine: 1 }]);
    assert.deepEqual([shown.record.served, nonzero(shown.record.refused)], [1, {}]);
  }
});

test('D69 review F6: `withheld` refuses a prior state only for a credential or a harness folder; an earlier "unreadable" one is not_requestable', async (t) => {
  // The adapter's closed list is what an earlier slicer wrote: D68 R's and D69 b's reasons and M36's `harness files`
  // (D90: the slicer produces none of them now; a ledger an earlier one wrote is still read).
  assert.deepEqual([...PRIOR_WITHHELD_REASONS].sort(), ['credential-shaped path', 'harness files', 'harness home']);
  const rows = [
    humanAsk('Fix src/cli.js.'),
    call('r2', 'Read', { file_path: '/repo/src/cli.js' }),
    result('r2', '1\tconst flag = 1;', undefined, false),
    call('e2', 'Edit', { file_path: '/repo/src/cli.js', old_string: 'const flag = 1;', new_string: 'const flag = 2;' }),
    result('e2', 'The file /repo/src/cli.js has been updated successfully.', undefined, false),
    said('Fixed.'),
  ].map((r, i) => ({ ...r, uuid: `u-unreadable-${i + 1}` }));
  const { ledger } = await load(t, rows);
  // A ledger an earlier slicer wrote, its prior state withheld for its look (`looksUnreadable`, deleted by the review).
  for (const [reason, priorWithheld, refused] of [['unreadable read result', false, { not_requestable: 1 }],
    ['harness files', true, { withheld: 1 }]]) {
    const old = structuredClone(ledger);
    const edit = old.ledger.find((act) => act.kind === 'edit');
    edit.before = { withheld: reason };
    const session = sessionFromLedger(old, { sessionKey: 'm33-u' });
    const [change] = session.events.find((event) => event.kind === 'invocation' && event.operation === 'edit').changes;
    assert.equal(change.priorWithheld === true, priorWithheld, reason);
    const a = (id) => reviewRun.planWindowRequests({ session, reviewScope: 'session-only' }).requests[0].aliases.of(id);
    const id = session.events.find((event) => event.kind === 'invocation' && event.operation === 'edit').id;
    assert.deepEqual(nonzero(serve(session, [{ eventId: a(id), fileBefore: true, fromLine: 1, throughLine: 1 }]).record.refused),
      refused, reason);
  }
});

test('M36 phase 3 review (5): no hidden bound — a long id names no event; equal malformed entries are one, whatever their length', () => {
  assert.deepEqual(Object.keys(EVIDENCE_REQUEST_LIMITS), ['reasks', 'items', 'bytes', 'parsed']);
  const s = lintAndTests();
  const long = `E${'9'.repeat(300)}`;
  assert.deepEqual(nonzero(serve(s, [{ eventId: long, fromLine: 1, throughLine: 1 }]).record.refused), { unknown_event: 1 });
  const big = { eventId: 'E1', fromLine: 1, throughLine: 1, note: 'x'.repeat(2_000) };
  assert.deepEqual(nonzero(serve(s, [big, structuredClone(big)]).record.refused), { malformed: 1 });
});
