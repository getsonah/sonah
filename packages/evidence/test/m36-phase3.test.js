// M36 phase 3 (owner decisions 2026-10-07, D68 K, Q, F; design critique c6; C-07 "M36 packed windows", "M36
// evidence re-ask", "M36 carried failures"):
//   (K) small sessions share a window — each session's own windows are the units, packed in review order while the
//       window's work stays within the budget; a session splits across windows only when it alone exceeds it; each
//       session is shown under its own heading with its lineage, its goal and its own carried context; (c6) a quote grounds
//       in the event its receipt cites, which names its session (the receipt carries it), so packing changes nothing;
//   (Q) a session-only narrative answer may request evidence, served by ONE deterministic re-ask: the window's request
//       bytes followed by a fixed section serving the sorted, de-duplicated requested lines; same set, same bytes; served
//       spans ground; the challenge calls are shown them; a saved review replays with no call;
//   (F) proven failures (a typed failed status only) are carried into a session's later windows, and a helper's ride
//       back beside the report its parent received, labelled — and never contradict the parent's own statements
//       (c6: `other_session`).
//
// Synthetic sessions and judges only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, verifyReceipt, shownSession } from '../src/session.js';
import { planWindows, carriedContext, carriedRecord, provenFailure, bytesOfTokens, WINDOWING_VERSION, windowParts,
  WINDOW_REQUEST_MAX_BYTES } from '../src/windows.js';
import { planWindowRequests, runReview, runProfile } from '../src/run-review.js';
import { buildNarrativePrompt, PROMPT_VERSION, packedPreface, sessionHeading, helperFailuresLine, CARRIED_FAILURES_HEADING,
  SESSION_NARRATIVE_SCHEMA, failuresLeftOutLine } from '../src/prompt.js';
import { EVIDENCE_REQUEST_LIMITS, EVIDENCE_REQUEST_REFUSALS } from '../src/evidence-requests.js';
import { NOW_ANSWER_AGAIN } from '../src/prompt.js';
import { buildLedger, WITHHELD_REJECTION_CAUSES } from '../src/ledger.js';
import { CHALLENGE_PROFILE, CHALLENGE_DOSSIER_VERSION, reviewInputBytes } from '../src/challenge.js';
import { CODE_REVIEW_VERSION } from '../src/code-review-prompt.js';

const KEY = 'sess-m36-phase3';
const blobs = {};
let counter = 0;
const ref = (text) => {
  const key = `b${++counter}`;
  blobs[key] = text;
  return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
};
const ask = (id, text, over = {}) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text), turn: 'T1', ...over });
const brief = (id, text, over = {}) => ({ id, kind: 'instruction', authority: 'agent', supersedes: [], text: ref(text), ...over });
const said = (id, text, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref(text),
  turn: 'T1', ...over });
const run = (id, command, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
  command: ref(command), input: [], changes: [], turn: 'T1', ...over });
const out = (id, invocation, text, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation, phase: 'terminal',
  result: 'succeeded', exitCode: 0, terminalStatusProven: true, sourceOfResult: 'native', output: ref(text), turn: 'T1', ...over });
const delegate = (id, text, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Agent', operation: 'delegate',
  paths: [], command: [], input: ref(text), changes: [], turn: 'T1', ...over });
const link = (assignmentEvent, childId) => ({ assignmentEvent, childId, childSession: `${KEY}/${childId}`,
  sessionKey: `${KEY}/${childId}`, relation: 'spawn', state: 'verified', historyStart: null });
const session = (events, children = []) => new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...blobs },
  events: events.map((event, sequence) => ({ ...event, sequence })), children });
const tokens = (n, fill = 'x') => fill.repeat(bytesOfTokens(n));
const ids = (events) => events.map((event) => event.id);
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const narrativeOf = (over = {}) => ({ decisions: [], pivots: [], claims: [], requirements: [], ...structuredClone(over) });
const ownReceipt = ({ candidate }) => candidate.contradictedBy ?? candidate.supportedBy ?? candidate.stated
  ?? candidate.instruction ?? candidate.receipts?.[0];
const honest = (request) => ({ votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
  explanation: 'Synthetic.', receipts: [ownReceipt(item)] })) });

// ---- versions -----------------------------------------------------------------------------------------------------------

test('M36 phase 3: one next version of each instrument whose bytes moved; the run profile states the evidence bounds', () => {
  // D69 moved each once more: the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // D71 (S2) moved it once more (sonah.windows/8): the reviewer brief as the checklist (D71_BRIEF_VERSIONS).
  // D103 moved it once more (sonah.windows/9): the skim keyed by the recording's harness, in bytes a side.
  assert.equal(WINDOWING_VERSION, 'sonah.windows/9');
  // D71 (S2) moved it once more (sonah.narrative/27), and D71 (S3) once more (sonah.narrative/28): the new channels (D71_CHANNELS_VERSIONS).
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words. D103 moved it once
  // more (sonah.narrative/38): a Claude Code recording's results shown up to 12,000 bytes at each end.
  assert.equal(PROMPT_VERSION, 'sonah.narrative/38');
  // D71 (S2) moved it once more (sonah.challenge/24), and D71 (S3) once more (sonah.challenge/25): the new channels (D71_CHANNELS_VERSIONS).
  // The column fix moved it once more (sonah.challenge/30): who decided a decision (FIX_COLUMN_VERSIONS).
  // W1 B moved it once more (sonah.challenge/31): the file form of the forbidden-edit proposition and its note.
  // W2 moved it once more (sonah.challenge/32): CLAIM_NOTE judges the agent's own written text like a result.
  // W3 F1(b) moved it once more (sonah.challenge/33): a support with changes since its run is asked, listed.
  // W3 F2 moved it once more (sonah.challenge/34): a support whose result failed is asked, judged on its outcome.
  // The fix review moved it (sonah.challenge/35 to /37): stopped results, a file rule's lifts, the existence check.
  // D87 moved it once more (sonah.challenge/38, its /35 renumbered at the merge): the code pass's own run; no other
  // request byte moved.
  // The code step moved it once more (sonah.challenge/39): the code pass's run left challengeItems for a runner of its
  // own, verdict first; no other request byte moved.
  // The review of the code step moved it once more (sonah.challenge/40): no `duplicate` refutation, and a
  // finding's checker sees no agent words; no other request byte moved.
  // The second review of the code step moved it once more (sonah.challenge/41): a code check's checker sees no word
  // of the agent's in any row; no other request byte moved.
  // The third review of the code step moved it once more (sonah.challenge/42): a code check's checker sees
  // what its row states again; no other request byte moved.
  // The re-ask of a void vote moved it once more (sonah.challenge/43): a vote a reply cast that could not be
  // counted is asked again once, naming its cause; no first-round request byte moved.
  // Its withdrawal moved it once more (sonah.challenge/44): a vote a reply cast that could not be counted stands
  // again, as before /43; no first-round request byte moved.
  // D103 moved it once more (sonah.challenge/45): a session-only batch shows the results its items cite whole.
  assert.equal(CHALLENGE_PROFILE.version, 'sonah.challenge/45');
  // D71 (S2) moved it once more (sonah.challenge-dossier/9), and D71 (S3) once more (sonah.challenge-dossier/10): the new channels (D71_CHANNELS_VERSIONS).
  // The D80 integration moved it once more (sonah.challenge-dossier/13): the same outcome line (D80_VERSIONS).
  // D103 moved it once more (sonah.challenge-dossier/14): a Claude Code recording's results are cut at 12,000 bytes a side.
  // D103 moved it once more (sonah.challenge-dossier/15): a session-only batch shows the results its items cite whole.
  assert.equal(CHALLENGE_DOSSIER_VERSION, 'sonah.challenge-dossier/15');
  // D71 (S2) moved it once more (sonah.code-review/24): the reviewer brief as the checklist (D71_BRIEF_VERSIONS).
  assert.equal(CODE_REVIEW_VERSION, 'sonah.code-review/24');
  assert.deepEqual({ ...EVIDENCE_REQUEST_LIMITS }, { reasks: 1, items: 8, bytes: 72_000, parsed: 256 });
  assert.ok(Object.isFrozen(EVIDENCE_REQUEST_LIMITS) && Object.isFrozen(EVIDENCE_REQUEST_REFUSALS));
  assert.deepEqual(runProfile('session-only').evidenceRequests, EVIDENCE_REQUEST_LIMITS);
  assert.equal(Object.hasOwn(runProfile('combined'), 'evidenceRequests'), false, 'a combined review requests none');
  assert.ok(WITHHELD_REJECTION_CAUSES.includes('other_session'));
  assert.ok(SESSION_NARRATIVE_SCHEMA.properties.evidenceRequests, 'the session-only contract offers the request');
});

// ---- (K) packing ----------------------------------------------------------------------------------------------------------

/** A root of two segments; helper `a` launched in the first, helper `b` in the second; `size` tokens of thought each. */
function twoHelpers({ rootTokens = 1_000, aTokens = 1_000, bTokens = 1_000 } = {}) {
  const A = { childId: 'a', turn: 'a:T1' }, B = { childId: 'b', turn: 'b:T1' };
  return session([
    ask('I1', 'Fix the parser with helpers.'), said('C1', tokens(rootTokens)), delegate('D1', 'Fix part A.'),
    brief('a:I1', 'Fix part A.', A), said('a:C1', tokens(aTokens, 'a'), A), run('a:R1', 'npm test', A),
    out('a:R1-r', 'a:R1', 'A: 1 failing', { ...A, result: 'failed', exitCode: 1 }),
    out('D1-r', 'D1', 'Part A is done.', { helperReported: true }),
    ask('I2', 'Now part B.', { turn: 'T2' }), delegate('D2', 'Fix part B.', { turn: 'T2' }),
    brief('b:I1', 'Fix part B.', B), said('b:C1', tokens(bTokens, 'b'), B),
    out('D2-r', 'D2', 'Part B is done.', { helperReported: true, turn: 'T2' }), said('C2', 'All done.', { turn: 'T2' }),
  ], [link('D1', 'a'), link('D2', 'b')]);
}

test('M36 K: small sessions share one window, in the order of the parent segment that launched each', () => {
  const windows = planWindows(twoHelpers());
  assert.equal(windows.length, 1, 'the root and both helpers fit one window');
  assert.deepEqual(windowParts(windows[0]).map((part) => [part.session.childId, part.session.launchedBy, part.events[0].id]),
    [[null, null, 'I1'], ['a', 'D1', 'a:I1'], ['b', 'D2', 'b:I1']]);
  assert.deepEqual(windows[0].parts[1].session.parentSegment, { childId: null, index: 0, start: 'I1' });
  assert.deepEqual(windows[0].parts[2].session.parentSegment, { childId: null, index: 1, start: 'I2' });
  assert.equal(windows[0].session.childId, null, 'its `session` is its first part\'s');
  assert.deepEqual(ids(windows[0].events), [...ids(windows[0].parts[0].events), ...ids(windows[0].parts[1].events),
    ...ids(windows[0].parts[2].events)]);
  assert.equal(windows[0].workBytes, windows[0].parts.reduce((n, part) => n + part.workBytes, 0));
});

test('M36 K: a unit that does not fit opens the next window; a session over the budget alone splits by its own rules', () => {
  // Root 150k, helper a 100k: a does not fit beside the root; b (30k) fits beside a.
  const packed = planWindows(twoHelpers({ rootTokens: 150_000, aTokens: 100_000, bTokens: 30_000 }));
  assert.deepEqual(packed.map((w) => windowParts(w).map((part) => part.session.childId)), [[null], ['a', 'b']]);
  assert.ok(packed.every((w) => w.workBytes <= bytesOfTokens(200_000)));
  // Root two segments of 150k each: two root windows; a launched in the first, b in the second.
  const split = planWindows(session([
    ask('I1', 'one'), said('C1', tokens(150_000)), delegate('D1', 'go a'), brief('a:I1', 'go a', { childId: 'a' }),
    said('a:C1', 'done a', { childId: 'a' }), ask('I2', 'two', { turn: 'T2' }), said('C2', tokens(150_000), { turn: 'T2' }),
    delegate('D2', 'go b', { turn: 'T2' }), brief('b:I1', 'go b', { childId: 'b' }), said('b:C1', 'done b', { childId: 'b' }),
  ], [link('D1', 'a'), link('D2', 'b')]));
  assert.deepEqual(split.map((w) => windowParts(w).map((part) => [part.session.childId, part.events[0].id])),
    [[[null, 'I1'], ['a', 'a:I1']], [[null, 'I2'], ['b', 'b:I1']]]);
  // Two units of one session never share a window: the pieces of an oversized segment stay windows of their own.
  const pieces = planWindows(session([ask('I1', 'go'), said('C1', tokens(150_000)), said('C2', tokens(150_000)),
    ask('I2', 'small', { turn: 'T2' })]));
  assert.deepEqual(pieces.map((w) => [w.piece, ids(w.events)]), [[{ at: 1, of: 2 }, ['I1', 'C1']], [{ at: 2, of: 2 }, ['C2']],
    [null, ['I2']]]);
});

test('M36 K: a packed window shows each session under its own heading, lineage and goal; a window of one session is unchanged', () => {
  const s = twoHelpers();
  const { requests } = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const evidence = requests[0].request.evidencePrompt;
  // D71 (S2): the human block first, then the session section, which the packed preface opens.
  assert.ok(evidence.startsWith('## What the human asked') && evidence.includes('\n## The session\n'), 'the session follows the human block');
  assert.ok(evidence.includes(packedPreface(3).join('\n')));
  for (const [k, childId] of [[1, null], [2, 'a'], [3, 'b']]) assert.ok(evidence.includes(sessionHeading(k, 3, childId)));
  const alias = (id) => requests[0].aliases.of(id);
  assert.ok(evidence.includes(`Launched by the main agent at [${alias('D1')}], in this window.`));
  assert.ok(evidence.includes(`Its goal: its parent agent's brief, [${alias('a:I1')}], the AGENT ASSIGNMENT that opens its session.`));
  assert.ok(evidence.indexOf(sessionHeading(2, 3, 'a')) < evidence.indexOf(`[${alias('a:I1')}] AGENT ASSIGNMENT`));
  // Every session's events are quotable sources of the window.
  for (const id of ['I1', 'a:C1', 'b:C1', 'D2-r']) assert.ok(Object.hasOwn(requests[0].sourceMap, id), id);
  // A window of one session renders exactly as a window without parts did (the M36 phase 2 layout).
  const single = planWindowRequests({ session: session([ask('I1', 'one'), said('C1', 'two')]), reviewScope: 'session-only' });
  const { parts, ...bare } = single.windows[0];
  assert.equal(parts.length, 1);
  const again = buildNarrativePrompt({ session: single.requests[0].request.window && session([ask('I1', 'one'), said('C1', 'two')]),
    window: bare, context: single.requests[0].context, settings: single.requests[0].settings,
    aliases: null, reviewScope: 'session-only' });
  assert.ok(!again.evidencePrompt.includes('This window holds'));
  assert.ok(!single.requests[0].request.evidencePrompt.includes('### Session'));
});

test('M36 K, c6 (phase 3 review): a quote grounds in the event it cites, which names its session — packing changes nothing', () => {
  const s = twoHelpers();
  const { requests } = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const view = shownSession(s, requests[0].sourceMap);
  // "Fix part A." is the parent's delegate input (action) and helper a's brief (instruction): each grounds in its event.
  assert.deepEqual(verifyReceipt(view, receipt('a:I1', 'instruction', 'Fix part A.')).receipt,
    { ...receipt('a:I1', 'instruction', 'Fix part A.'), sessionKey: KEY, childId: 'a' }, 'a helper\'s receipt says so');
  assert.deepEqual(verifyReceipt(view, receipt('D1-r', 'observation', 'Part A is done.')).receipt,
    { ...receipt('D1-r', 'observation', 'Part A is done.'), sessionKey: KEY }, 'the root\'s carries no child id');
  // A command both sessions ran: each session's receipt grounds in its own event, packed or not.
  const both = session([ask('I1', 'go'), run('R1', 'npm test'), out('R1-r', 'R1', 'ok'), delegate('D1', 'test it'),
    brief('a:I1', 'test it', { childId: 'a' }), run('a:R1', 'npm test', { childId: 'a' }), out('a:R1-r', 'a:R1', 'ok', { childId: 'a' })],
  [link('D1', 'a')]);
  const plan = planWindowRequests({ session: both, reviewScope: 'session-only' });
  assert.equal(plan.windows.length, 1, 'premise: one packed window');
  const packedView = shownSession(both, plan.requests[0].sourceMap);
  assert.deepEqual(verifyReceipt(packedView, receipt('R1', 'action', 'npm test')).receipt,
    { ...receipt('R1', 'action', 'npm test'), sessionKey: KEY });
  assert.deepEqual(verifyReceipt(packedView, receipt('a:R1', 'action', 'npm test')).receipt,
    { ...receipt('a:R1', 'action', 'npm test'), sessionKey: KEY, childId: 'a' });
  // The child id is code's, from the event — never what a model sent.
  assert.deepEqual(verifyReceipt(packedView, { ...receipt('R1', 'action', 'npm test'), childId: 'a' }).receipt,
    { ...receipt('R1', 'action', 'npm test'), sessionKey: KEY });
  assert.equal(verifyReceipt(packedView, { ...receipt('a:R1', 'action', 'npm test'), childId: 'zz' }).receipt.childId, 'a');
  assert.equal(Object.hasOwn(packedView, 'actorAmbiguous'), false, 'no text-match rule: words never name an actor');
});

test('M36 K, c6: a claim contradicted by another session\'s result is withheld (other_session), before it is asked and by the ledger', async () => {
  const s = twoHelpers();
  const claim = { text: 'The agent said all is done.', stated: receipt('C2', 'commentary', 'All done.'),
    contradictedBy: receipt('a:R1-r', 'observation', 'A: 1 failing') };
  const seen = [];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', judge: async (request) => {
    seen.push(request);
    return request.challenge ? honest(request) : narrativeOf({ claims: [claim] });
  } });
  assert.deepEqual(report.findings.filter((f) => f.kind === 'claim_contradicted'), []);
  assert.equal(seen.filter((request) => request.challenge).length, 0, 'never asked');
  assert.equal(report.windowResults[0].claimsOtherSession, 1);
  assert.equal(report.withheld.causes.other_session, 1);
  const ledger = buildLedger({ repo: { host: 'github.com', id: '0' }, session: s, sessionCoverage: 'complete',
    findingCandidates: [{ origin: 'session-review', kind: 'claim_contradicted', title: 't', explanation: 'e',
      scope: 'session-effect', anchor: null, receipts: [claim.stated, claim.contradictedBy] }] });
  assert.deepEqual(ledger.findings, []);
  assert.deepEqual(ledger.rejectedFindings.map((r) => r.cause), ['other_session']);
});

// ---- (F) proven failures carried ----------------------------------------------------------------------------------------

/** Window 1: a failing run, a run with an unknown status, a passing run, an interrupted one; filler; window 2: a claim. */
function laterClaim() {
  const filler = (id) => [run(id, 'cat big.log'), ...Array.from({ length: 60 }, (_, k) => ({ ...out(`${id}-r${k}`, id,
    tokens(3_000, 'y')), phase: 'progress', exitCode: null }))];
  return session([
    ask('I1', 'Make the suite pass.'), run('A1', 'npm test'), out('A1-r', 'A1', 'not ok 3 - nested input', { result: 'failed',
      exitCode: 1 }),
    run('A2', 'npm run lint'), out('A2-r', 'A2', 'lint output', { result: 'unknown', exitCode: null, sourceOfResult: 'parsed-output' }),
    run('A3', 'npm run build'), out('A3-r', 'A3', 'built'),
    run('A4', 'npm run e2e', { recorded: { isError: true, interrupted: true } }), out('A4-r', 'A4', 'stopped', { result: 'failed',
      exitCode: 130 }),
    run('A5', 'npm run typecheck', { recorded: { isError: true } }), out('A5-r', 'A5', 'type error at x.js', { exitCode: null,
      result: 'unknown', sourceOfResult: 'unknown' }),
    said('C1', tokens(1_000)), ...filler('F1'),
    ask('I2', 'Continue.', { turn: 'T2' }), ...filler('F2').map((e) => ({ ...e, turn: 'T2' })),
    said('C2', 'All tests pass and the types check.', { phase: 'final', turn: 'T2' }),
  ]);
}

test('M36 F: a proven failure is a typed failed status — never an unknown status, a success or an interrupted call', () => {
  const s = laterClaim();
  assert.deepEqual(['A1-r', 'A2-r', 'A3-r', 'A4-r', 'A5-r'].map((id) => provenFailure(s, s.event(id))),
    [true, false, false, false, true]);
  const windows = planWindows(s);
  assert.equal(windows.length, 2);
  const context = carriedContext(s, windows[1]);
  assert.deepEqual(context.failures.map(({ call, result }) => [call.id, result.id]), [['A1', 'A1-r'], ['A5', 'A5-r']]);
  assert.deepEqual(carriedRecord(context), { humans: 1, thoughts: 1, thoughtsLeftOut: 0, humanBytes: context.humanBytes,
    thoughtBytes: context.thoughtBytes, failures: 2, helperFailures: 0, failuresLeftOut: 0, failureBytes: context.failureBytes,
    capped: false });
  const { requests } = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const evidence = requests[1].request.evidencePrompt;
  assert.ok(evidence.includes(CARRIED_FAILURES_HEADING));
  assert.ok(evidence.indexOf(CARRIED_FAILURES_HEADING) < evidence.indexOf("### The agent's earlier messages (AGENT SAID)"),
    'failures before the thoughts');
  for (const id of ['A1', 'A1-r', 'A5', 'A5-r']) assert.ok(Object.hasOwn(requests[1].sourceMap, id), id);
  for (const id of ['A2-r', 'A3-r', 'A4-r', 'F1-r0']) assert.ok(!Object.hasOwn(requests[1].sourceMap, id), id);
  // The carried result shows its label line and is cut by the same rule.
  assert.ok(evidence.includes('  recorded: tool Bash · error flag set · output 1 line(s), 18 bytes'));
});

test('M36 F: a claim in window 2 contradicted by a proven failure of window 1 is DECIDE (it was carried, so it grounds)', async () => {
  const s = laterClaim();
  const claim = { text: 'All pass.', stated: receipt('C2', 'commentary', 'All tests pass'),
    contradictedBy: receipt('A1-r', 'observation', 'not ok 3 - nested input') };
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', judge: async (request) =>
    (request.challenge ? honest(request) : narrativeOf(request.window.index === 1 ? { claims: [claim] } : {})) });
  assert.deepEqual(report.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status), ['DECIDE']);
  assert.deepEqual(report.counts.carried.failures, 2);
});

test('M36 F: over the cap, the human messages are kept, then the most recent failures, then the most recent thoughts', () => {
  const big = (id, n) => [run(id, `run ${id}`), out(`${id}-r`, id, tokens(n, 'f'), { result: 'failed', exitCode: 1 })];
  const s = session([ask('I1', 'go'), ...big('A1', 80_000), said('C1', tokens(80_000)), ...big('A2', 80_000),
    said('C2', tokens(80_000)), ask('I2', 'next', { turn: 'T2' }), said('C3', tokens(50_000), { turn: 'T2' })]);
  const settings = { workTokens: 200_000, carriedTokens: 150_000, skimSideBytes: 3_600 };
  const windows = planWindows(s, settings);
  assert.equal(windows.length, 2);
  const context = carriedContext(s, windows.at(-1), settings);
  // Each failure shows its 2k-token cut (7,200 bytes of output) and its command: both fit; then one 80k thought fits
  // under a 150k cap, not two.
  assert.deepEqual(context.failures.map(({ result }) => result.id), ['A1-r', 'A2-r']);
  assert.deepEqual(context.thoughts.map((e) => e.id), ['C2']);
  assert.equal(context.thoughtsLeftOut, 1);
  const tight = carriedContext(s, windows.at(-1), { workTokens: 200_000, carriedTokens: 2_100, skimSideBytes: 3_600 });
  assert.deepEqual(tight.failures.map(({ result }) => result.id), ['A2-r'], 'the most recent failure');
  assert.equal(tight.failuresLeftOut, 1);
  assert.deepEqual(tight.thoughts, []);
});

/** 120 proven failures of 2k tokens each, then a second turn of 3,000 short actions: the second window's own work and
 *  a full carried cap of failures together are over the request bound, its work alone is not. */
function overTheBound({ actions = 3_000, actionTokens = 60 } = {}) {
  const events = [ask('I1', 'Fix every failing package.')];
  for (let k = 0; k < 120; k++) events.push(run(`A${k}`, `npm test -w p${k}`), out(`A${k}-r`, `A${k}`, tokens(2_000, 'f'),
    { result: 'failed', exitCode: 1 }));
  events.push(ask('I2', 'Now check every file.', { turn: 'T2' }));
  for (let k = 0; k < actions; k++) events.push(run(`B${k}`, `ls d${k}`, { turn: 'T2' }), out(`B${k}-r`, `B${k}`,
    tokens(actionTokens, 'o'), { turn: 'T2' }));
  return session(events);
}

test('M36 F: a carried cap that would put a window over the request bound is lowered to fit — oldest failures out first', async () => {
  const s = overTheBound();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  assert.equal(plan.requests.length, 2);
  const [first, second] = plan.requests;
  assert.equal(Object.hasOwn(first.context, 'fitted'), false, 'a window under the bound keeps the cap');
  const full = carriedContext(s, second.window);
  assert.ok(reviewInputBytes(second.request) <= WINDOW_REQUEST_MAX_BYTES, 'it fits');
  // Every shown byte of a carried failure is in the request: with the full cap it would not have fit.
  assert.ok(reviewInputBytes(second.request) + full.failureBytes - second.context.failureBytes > WINDOW_REQUEST_MAX_BYTES);
  assert.equal(second.context.fitted, true);
  assert.ok(second.context.capBytes < full.capBytes && second.context.capBytes >= second.context.humanBytes);
  assert.deepEqual(second.context.humans.map((e) => e.id), ['I1'], 'the human messages are always kept');
  const kept = second.context.failures.map(({ result }) => result.id);
  assert.ok(kept.length > 0 && kept.length < full.failures.length);
  assert.deepEqual(kept, full.failures.map(({ result }) => result.id).slice(-kept.length), 'the most recent kept');
  assert.equal(second.context.failuresLeftOut, 120 - kept.length);
  assert.ok(second.request.evidencePrompt.includes(failuresLeftOutLine(120 - kept.length)), 'the window says how many');
  assert.equal(carriedRecord(second.context).fitted, true);
  // Deterministic: the same session gives the same bytes.
  assert.equal(planWindowRequests({ session: overTheBound(), reviewScope: 'session-only' }).requests[1].request.prompt,
    second.request.prompt);
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: async (request) => (request.challenge ? honest(request) : narrativeOf()) });
  assert.equal(report.counts.carried.fittedWindows, 1);
  assert.equal(report.counts.carried.failuresLeftOut, 120 - kept.length);
  assert.deepEqual(report.windowFailures, []);
  // A window over the bound by its own work alone keeps its whole carried context: lowering it would not make it fit.
  const crowded = planWindowRequests({ session: overTheBound({ actions: 6_000, actionTokens: 20 }), reviewScope: 'session-only' });
  const last = crowded.requests.at(-1);
  assert.ok(reviewInputBytes(last.request) > WINDOW_REQUEST_MAX_BYTES);
  assert.equal(Object.hasOwn(last.context, 'fitted'), false);
  assert.equal(last.context.capBytes, bytesOfTokens(200_000));
});

/** D69 review (finding F1): 70 proven failures, one 300,000-byte thought and a 300,000-byte human message, then a second
 *  turn of `actions` short actions. The thought never fits beside the failures, so the carried context uses less than its
 *  cap (slack): lowering the CAP by the excess left nothing out for several rounds. */
function slackOverTheBound(actions) {
  const events = [ask('I1', 'Fix it.')];
  for (let k = 0; k < 70; k++) events.push(run(`A${k}`, `npm test -w p${k}`), out(`A${k}-r`, `A${k}`, tokens(2_000, 'f'),
    { result: 'failed', exitCode: 1 }));
  events.push(said('C1', 't'.repeat(300_000)));
  events.push(ask('I2', `Now check every file. ${'h'.repeat(300_000)}`, { turn: 'T2' }));
  for (let k = 0; k < actions; k++) events.push(run(`B${k}`, `ls d${k}`, { turn: 'T2' }), out(`B${k}-r`, `B${k}`,
    tokens(60, 'o'), { turn: 'T2' }));
  return session(events);
}

test('D69 review F1: a carried context with slack is fitted from the bytes it uses — no round limit leaves it unreviewed', () => {
  // The audit's case: the whole context used 505,047 of its 720,000-byte cap and the request was over the bound by
  // 59,628. Lowered from the cap, rounds 6-8 lowered it 232 bytes each while slack remained, the eighth gave up and the
  // window went back to its whole carried context, over the bound (unreviewed_scope). Lowered from what is used, each
  // round leaves a failure out until the request fits.
  const s = slackOverTheBound(1_850);
  const last = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests.at(-1);
  const full = carriedContext(s, last.window);
  assert.ok(full.capBytes - (full.humanBytes + full.failureBytes + full.thoughtBytes) > 200_000, 'the cap has slack');
  assert.ok(reviewInputBytes(last.request) <= WINDOW_REQUEST_MAX_BYTES, 'it fits');
  assert.equal(last.context.fitted, true);
  const kept = last.context.failures.map(({ result }) => result.id);
  assert.ok(kept.length > 0 && kept.length < full.failures.length, 'some failures are carried, the oldest left out');
  assert.deepEqual(kept, full.failures.map(({ result }) => result.id).slice(-kept.length), 'the most recent kept');
  assert.deepEqual(last.context.humans.map((e) => e.id), ['I1'], 'the human messages are always kept');
  // Every neighbouring size fits too; deterministic.
  for (const actions of [1_800, 1_900]) {
    const other = planWindowRequests({ session: slackOverTheBound(actions), reviewScope: 'session-only' }).requests.at(-1);
    assert.ok(reviewInputBytes(other.request) <= WINDOW_REQUEST_MAX_BYTES && other.context.fitted === true, String(actions));
  }
  assert.equal(planWindowRequests({ session: slackOverTheBound(1_850), reviewScope: 'session-only' }).requests.at(-1)
    .request.prompt, last.request.prompt);
});

test('M36 F, c6: a helper\'s proven failures ride back beside its report, labelled, and never contradict the parent', async () => {
  // Helper a is over the budget beside the root, so it is reviewed in a window of its own; its failure rides back.
  const s = twoHelpers({ rootTokens: 150_000, aTokens: 100_000 });
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  assert.deepEqual(plan.windows.map((w) => windowParts(w).map((part) => part.session.childId)), [[null], ['a', 'b']]);
  const [root] = plan.requests;
  assert.deepEqual(root.context.rideBack.map((ride) => [ride.report, ride.childId, ride.failures.map((f) => f.result.id)]),
    [['D1-r', 'a', ['a:R1-r']]]);
  const evidence = root.request.evidencePrompt;
  const at = evidence.indexOf(helperFailuresLine('a'));
  assert.ok(at > evidence.indexOf(`[${root.aliases.of('D1-r')}] RESULT`), 'beside the report');
  assert.ok(Object.hasOwn(root.sourceMap, 'a:R1-r'), 'quotable recorded text');
  assert.equal(carriedRecord(root.context).helperFailures, 1);
  // The parent's statement contradicted by it is withheld: the parent never received that result.
  const claim = { text: 'The agent said part A is fixed.', stated: receipt('C2', 'commentary', 'All done.'),
    contradictedBy: receipt('a:R1-r', 'observation', 'A: 1 failing') };
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge: async (request) =>
    (request.challenge ? honest(request) : narrativeOf(request.window.index === 0 ? { claims: [claim] } : {})) });
  assert.deepEqual(report.findings, []);
  assert.equal(report.withheld.causes.other_session, 1);
});

// ---- (Q) the deterministic evidence re-ask ------------------------------------------------------------------------------

// D103: a Claude Code recording's result is cut past twice its 12,000-byte skim: 1,000 lines of about 53 bytes, its
// failure in the cut middle (lines 227–774 are not shown).
const LONG = Array.from({ length: 1_000 }, (_, k) => `line ${k + 1}: ${k === 499 ? 'not ok 7 - FAILS in the middle'
  : `ok ${'.'.repeat(40)}`}`).join('\n');
/** One window: the human's ask, a long test output whose failure is in its cut middle, a claim. */
function middle() {
  return session([ask('I1', 'Run the suite and tell me.'), run('A1', 'npm test'), out('A1-r', 'A1', LONG),
    said('C1', 'The whole suite passes.', { phase: 'final' })]);
}
const CLAIM = { text: 'The agent said the suite passes.', stated: receipt('C1', 'commentary', 'The whole suite passes.'),
  contradictedBy: receipt('A1-r', 'observation', 'not ok 7 - FAILS in the middle') };

/** A judge whose first narrative asks for `requests` and whose re-ask answers `claims`; it records every request. */
function asking(requests, { claims = [CLAIM], seen = [], reask = null } = {}) {
  return async (request) => {
    seen.push(request);
    if (request.challenge) return honest(request);
    if (request.label.endsWith(':evidence')) return reask ? reask(request) : narrativeOf({ claims });
    return narrativeOf({ evidenceRequests: requests });
  };
}

test('M36 Q: an omitted middle is served by one re-ask — the window\'s request, the sorted served lines, a fixed closing', async () => {
  const s = middle();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const [built] = plan.requests;
  const alias = built.aliases.of('A1-r');
  // D71 (S2): offered under the brief's last step (S3: step 6).
  assert.ok(built.request.prompt.includes(`ask for them under step 6 if a row's status depends on them ([${alias}] lines`));
  assert.ok(!built.sourceMap['A1-r'].some((source) => source.text.includes('FAILS in the middle')), 'the middle is cut');
  const seen = [];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: asking([{ eventId: alias, fromLine: 499, throughLine: 501 }], { seen }) });
  const reask = seen.find((request) => request.label === 'narrative:w1:evidence');
  assert.ok(reask, 'one re-ask, labelled for its window');
  // D71 (S2): the re-ask is the window re-rendered with the served lines AT THEIR EVENT, between its
  // head and its tail, under their label — no appended section — and the re-ask's own "Now answer".
  assert.equal(reask.system, built.request.system);
  assert.ok(!reask.prompt.includes('## Evidence served on your request'));
  assert.ok(reask.prompt.endsWith(NOW_ANSWER_AGAIN.join('\n')));
  const OK = `ok ${'.'.repeat(40)}`;
  const label = '  lines 499–501 of this output, served after the first answer asked for them:';
  assert.ok(reask.prompt.includes(`${label}\n<<<\nline 499: ${OK}\nline 500: not ok 7 - FAILS in the middle\nline 501: ${OK}\n>>>`));
  const at = reask.prompt.indexOf(label);
  assert.ok(at > reask.prompt.indexOf(`[${alias}] RESULT of ${built.aliases.of('A1')}`), 'at its event');
  assert.ok(reask.prompt.slice(0, at).includes('  omitted: lines ') && reask.prompt.slice(at).includes('  omitted: lines '),
    'the lines still not shown keep their omission lines, before and after');
  // The re-ask's answer grounds in the served span; the challengers are shown it, never the closing.
  assert.deepEqual(report.findings.map((f) => [f.kind, f.status]), [['claim_contradicted', 'DECIDE']]);
  const challenges = seen.filter((request) => request.challenge);
  assert.ok(challenges.length > 0 && challenges.every((request) => request.prompt.includes('FAILS in the middle')
    && !request.prompt.includes(NOW_ANSWER_AGAIN[1])));
  // The run record, counts only.
  assert.deepEqual(report.windowResults[0].evidence, { requested: 1, items: 1, served: 1,
    servedBytes: Buffer.byteLength(`line 499: ${OK}\nline 500: not ok 7 - FAILS in the middle\nline 501: ${OK}`),
    refused: Object.fromEntries(EVIDENCE_REQUEST_REFUSALS.map((r) => [r, 0])), reasks: 1, reaskFailed: false, kept: 'merged',
    fromFirst: 0, firstStood: 0, nestedDropped: 0 });
  assert.equal(report.counts.evidenceRequests.served, 1);
  assert.equal(report.counts.evidenceRequests.kept, 1);
  assert.equal(Object.hasOwn(report.windowResults[0].narrative, 'evidenceRequests'), false, 'never kept in the record');
});

test('M36 Q: without the re-ask, a quote of the cut middle still never grounds (c4)', async () => {
  const s = middle();
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only',
    judge: async (request) => (request.challenge ? honest(request) : narrativeOf({ claims: [CLAIM] })) });
  assert.deepEqual(report.findings, []);
});

test('M36 Q: the same requested set gives the same re-ask bytes, whatever its order and repeats', async () => {
  const s = middle();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const alias = plan.requests[0].aliases.of('A1-r');
  const reaskOf = async (requests) => {
    const seen = [];
    await runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge: asking(requests, { seen }) });
    return seen.find((request) => request.label === 'narrative:w1:evidence').prompt;
  };
  const a = await reaskOf([{ eventId: alias, fromLine: 450, throughLine: 460 }, { eventId: alias, fromLine: 499, throughLine: 501 }]);
  const b = await reaskOf([{ eventId: alias, fromLine: 499, throughLine: 501 }, { eventId: alias, fromLine: 450, throughLine: 460 },
    { eventId: alias, fromLine: 499, throughLine: 501 }]);
  assert.equal(a, b);
  // Overlapping ranges are one range.
  const c = await reaskOf([{ eventId: alias, fromLine: 450, throughLine: 455 }, { eventId: alias, fromLine: 454, throughLine: 460 },
    { eventId: alias, fromLine: 499, throughLine: 501 }]);
  assert.equal(c, a);
});

test('M36 Q: every item not served is said by a closed reason; nothing served asks nothing', async () => {
  const s = session([ask('I1', 'Run it.'), run('A1', 'npm test'), out('A1-r', 'A1', LONG), run('A2', 'cat secrets'),
    out('A2-r', 'A2', '', { outputWithheld: true }), run('A3', 'echo hi'), out('A3-r', 'A3', 'hi'),
    said('C1', 'Done.', { phase: 'final' }), ask('I2', 'later', { turn: 'T2' })]);
  // I2 is in the window too; make an event the window never named by a second session's event id that does not exist.
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const a = (id) => plan.requests[0].aliases.of(id);
  const seen = [];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge: asking([
    { eventId: 'E999', fromLine: 1, throughLine: 2 },                 // unknown
    { eventId: a('A2-r'), fromLine: 1, throughLine: 1 },              // withheld
    { eventId: a('A3-r'), fromLine: 1, throughLine: 1 },              // shown whole
    { eventId: a('C1'), fromLine: 1, throughLine: 1 },                // a statement: not requestable
    { eventId: a('A1-r'), fromLine: 1_900, throughLine: 1_901 },      // out of range
    { eventId: a('A1-r'), fromLine: 1, throughLine: 2 },              // shown (the head)
    { eventId: a('A1-r'), fromLine: 0, throughLine: 2 },              // malformed
    'not an item',                                                    // malformed
  ], { seen }) });
  assert.equal(seen.filter((request) => request.label.endsWith(':evidence')).length, 0, 'nothing served: no re-ask');
  const { refused } = report.windowResults[0].evidence;
  assert.deepEqual(Object.fromEntries(Object.entries(refused).filter(([, n]) => n)), { malformed: 2, unknown_event: 1,
    not_requestable: 1, withheld: 1, out_of_range: 1, shown: 2 });
  assert.equal(report.windowResults[0].evidence.reasks, 0);
  // Items past the bound are refused by count; refusals are listed when something is served.
  const many = Array.from({ length: 12 }, (_, k) => ({ eventId: a('A1-r'), fromLine: 400 + 10 * k, throughLine: 400 + 10 * k }));
  const seen2 = [];
  const report2 = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: asking([...many, { eventId: a('A2-r'), fromLine: 1, throughLine: 1 }], { seen: seen2, claims: [] }) });
  const evidence = report2.windowResults[0].evidence;
  assert.equal(evidence.served, EVIDENCE_REQUEST_LIMITS.items);
  assert.equal(evidence.refused.over_items, 12 - EVIDENCE_REQUEST_LIMITS.items);
  const reask = seen2.find((request) => request.label.endsWith(':evidence'));
  // D71 (S2): what was asked for and not served is said under "About this window", each by its closed reason.
  assert.ok(reask.prompt.includes('- Asked for and not served: '));
  assert.ok(reask.prompt.includes(`[${a('A2-r')}] line 1 of its output (withheld)`));
  assert.ok(reask.prompt.includes('(over_items)'));
});

test('M36 Q: the file before an edit is served on request, as code of that call', async () => {
  const before = Array.from({ length: 50 }, (_, k) => `const v${k + 1} = ${k + 1};`).join('\n');
  const edit = { id: 'W1', kind: 'invocation', callKey: 'W1', tool: 'edit', operation: 'edit', paths: [{ path: 'src/a.js' }],
    command: [], input: [], turn: 'T1', changes: [{ path: 'src/a.js', after: ref('const v1 = 2;'), before: ref(before),
      replaced: ref('const v1 = 1;'), extent: { priorState: 'first-write', recorded: true } }] };
  const s = session([ask('I1', 'Change v1.'), edit, out('W1-r', 'W1', 'ok'), said('C1', 'Changed v1; v40 is still 40.')]);
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const alias = plan.requests[0].aliases.of('W1');
  assert.ok(plan.requests[0].request.prompt.includes(`ask for [${alias}] and a line range of it under step 6`));
  const seen = [];
  const decision = { dimension: 'v40', chosen: 'kept', value: null, actions: [alias],
    valueReceipt: null, stated: null, constrainedBy: null };
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: asking([{ eventId: alias, fileBefore: true, fromLine: 40, throughLine: 40 }], { seen,
      reask: () => narrativeOf({ writtenClaims: [], decisions: [decision], pivots: [{ abandoned: 'x', adopted: 'y',
        receipts: [receipt(alias, 'code', 'const v40 = 40;')] }] }) }) });
  const reask = seen.find((request) => request.label.endsWith(':evidence'));
  // D71 (S2): under the line that says the file before the call is not shown, at the call itself.
  const label = '  line 40 of src/a.js before this call, counted from the first line recorded of it, served after the first answer asked for them:';
  assert.ok(reask.prompt.includes(`${label}\n<<<\nconst v40 = 40;\n>>>`));
  assert.ok(reask.prompt.indexOf(label) > reask.prompt.indexOf(`[${alias}] ACTION`));
  assert.equal(report.pivots.length, 1, 'a quote of the served file grounds as code of the call');
});

test('M36 Q: a re-ask that fails leaves the first answer standing; a saved review replays it all with no call', async () => {
  const s = middle();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const alias = plan.requests[0].aliases.of('A1-r');
  const failing = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge: async (request) => {
    if (request.challenge) return honest(request);
    if (request.label.endsWith(':evidence')) throw Object.assign(new Error('x'), { code: 'model_unavailable' });
    return narrativeOf({ evidenceRequests: [{ eventId: alias, fromLine: 499, throughLine: 500 }],
      claims: [{ ...CLAIM, contradictedBy: null }] });
  } });
  assert.equal(failing.windowResults[0].failure, null, 'the re-ask\'s failure is not the window\'s');
  assert.deepEqual([failing.windowResults[0].evidence.reaskFailed, failing.windowResults[0].evidence.kept], [true, 'first']);
  assert.equal(failing.promises.length, 1, 'the first answer\'s claim');
  // D60: answers memoized by exact request bytes; the second review makes no call and reports the same.
  const store = new Map();
  let live = 0;
  const inner = asking([{ eventId: alias, fromLine: 499, throughLine: 501 }]);
  const memo = async (request) => {
    const key = JSON.stringify([request.system, request.prompt]);
    const n = (memo.count.get(key) ?? 0) + 1;
    memo.count.set(key, n);
    const stored = store.get(`${key}#${n}`);
    if (stored) return structuredClone(stored);
    live++;
    const answer = await inner(request);
    store.set(`${key}#${n}`, structuredClone(answer));
    return answer;
  };
  memo.count = new Map();
  const first = await runReview({ session: s, pr: null, reviewScope: 'session-only', judge: memo });
  const calls = live;
  memo.count = new Map();
  const second = await runReview({ session: s, pr: null, reviewScope: 'session-only', judge: memo });
  assert.ok(calls > 2);
  assert.equal(live, calls, 'the replay made no call');
  assert.deepEqual(second.findings, first.findings);
  assert.deepEqual(second.windowResults[0].evidence, first.windowResults[0].evidence);
});

test('M36 Q: what is served is capped by the window\'s remaining work budget', async () => {
  const s = middle();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const alias = plan.requests[0].aliases.of('A1-r');
  // Shrink the window's remaining budget to 60 bytes: one line of the middle fits, the rest is over budget.
  plan.windows[0].workBudget = plan.windows[0].workBytes + 60;
  const seen = [];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: asking([{ eventId: alias, fromLine: 499, throughLine: 501 }], { seen, claims: [] }) });
  const { evidence } = report.windowResults[0];
  assert.equal(evidence.served, 1);
  assert.ok(evidence.servedBytes <= 60);
  assert.equal(evidence.refused.over_budget, 1);
  const reask = seen.find((request) => request.label.endsWith(':evidence'));
  assert.ok(reask.prompt.includes('lines 500–501 of its output (over_budget)'));
});

test('M36 Q: a request member that is not a list is one malformed request — counted, read apart, never a failed answer', async () => {
  const s = middle();
  const seen = [];
  for (const wrong of [{}, 'lines 1-2', null]) {
    const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', judge: async (request) => {
      seen.push(request);
      return request.challenge ? honest(request) : narrativeOf({ evidenceRequests: wrong });
    } });
    assert.equal(report.windowResults[0].failure, null, JSON.stringify(wrong));
    assert.equal(report.windowResults[0].evidence.refused.malformed, 1, JSON.stringify(wrong));
    assert.equal(report.windowResults[0].evidence.reasks, 0);
  }
  assert.equal(seen.filter((request) => request.label.endsWith(':evidence')).length, 0);
});

test('M36 Q: at most one re-ask a window — requests in the re-ask\'s answer are counted reask_limit, never served', async () => {
  const s = middle();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const alias = plan.requests[0].aliases.of('A1-r');
  const seen = [];
  const again = [{ eventId: alias, fromLine: 450, throughLine: 451 }, { eventId: alias, fromLine: 460, throughLine: 461 }];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: asking([{ eventId: alias, fromLine: 499, throughLine: 501 }], { seen,
      reask: () => narrativeOf({ claims: [CLAIM], evidenceRequests: again }) }) });
  assert.equal(seen.filter((request) => request.label.includes(':evidence')).length, 1);
  const { evidence } = report.windowResults[0];
  assert.deepEqual([evidence.reasks, evidence.kept, evidence.requested, evidence.refused.reask_limit], [1, 'merged', 3, 2]);
  assert.deepEqual(report.findings.map((f) => f.status), ['DECIDE']);
});

test('M36 Q: the lean profile\'s dossier is shown what the re-ask served; the re-ask label maps to its window', async () => {
  const { windowOfLabel } = await import('../../cli/src/session-review.js');
  assert.equal(windowOfLabel('narrative:w4:evidence'), 4);
  const s = middle();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only', speedProfile: 'm33-lean' });
  const alias = plan.requests[0].aliases.of('A1-r');
  const seen = [];
  const decision = { dimension: 'suite', chosen: 'ran it', value: null, valueReceipt: null, actions: [plan.requests[0].aliases.of('A1')],
    stated: null, constrainedBy: null };
  await runReview({ session: s, pr: null, reviewScope: 'session-only', plan, speedProfile: 'm33-lean',
    judge: asking([{ eventId: alias, fromLine: 499, throughLine: 501 }], { seen,
      reask: () => narrativeOf({ decisions: [decision] }) }) });
  const single = seen.filter((request) => request.challenge && request.label.includes(':t1'));
  // D71 (S2): the dossier shows the served lines at their event too.
  assert.ok(single.length > 0 && single.every((request) => request.prompt.includes('FAILS in the middle')
    && request.prompt.includes('served after the first answer asked for them:')));
});
