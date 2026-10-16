// C-06 "M33 self-corrected claims (owner decision, 2026-09-29)". A `claim_contradicted` finding is
// self-corrected when the narrative supplies, and grounding verifies, a `resolvedBy` pair: a later
// observation showing the claimed state and a later commentary in which the agent states the
// corrected result accurately — both of the claim's own actor, both after the contradicting
// observation, both in the claim's recorded turn, both quoted exactly. Then, and only then, code
// publishes it FYI with the closed disclosure reason `self_corrected` and both resolution receipts.
// Every other resolution leaves the finding DECIDE, unchanged, with a closed counted reason.
// Refreeze after review: the resolution is also challenged as its own item, apart from the
// contradiction (test/m33-h1-resolution-challenge.test.js); these judges uphold every item.
//
// The motivating record, in count-only synthetic form: the agent said a change cleared a gap before
// re-measuring, the next replay showed three gaps, it fixed the code, a later replay showed none,
// and it then stated that result accurately.
//
// Synthetic sessions (/srv/x paths), synthetic judges: no recording, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as prompt from '../src/prompt.js';
import * as challenge from '../src/challenge.js';
import * as codeReviewPrompt from '../src/code-review-prompt.js';
import * as adapter from '../adapters/sonah-ledger.js';
import { runCodeReview } from '../src/code-review.js';

const REPO = { host: 'github.com', id: '0' };
const SESSION_KEY = 'sess-h1';

const TEXT = {
  ask: 'SYNTHETIC_H1_ASK: make the synthetic replay report no gaps.',
  replay: 'node /srv/x/replay.js',
  earlier: 'SYNTHETIC_H1_EARLIER: gaps=0 on the old fixture',
  claim: 'SYNTHETIC_H1_CLAIM: this change clears the gap.',
  three: 'SYNTHETIC_H1_REPLAY: gaps=3',
  premature: 'SYNTHETIC_H1_PREMATURE: fixed now, the gaps are gone.',
  brief: 'SYNTHETIC_H1_BRIEF: replay the synthetic fixture.',
  childOut: 'SYNTHETIC_H1_CHILD_REPLAY: gaps=0',
  childSaid: 'SYNTHETIC_H1_CHILD_SAID: the child replay reports gaps=0.',
  zero: 'SYNTHETIC_H1_REPLAY: gaps=0',
  corrected: 'SYNTHETIC_H1_CORRECTED: the replay now reports gaps=0 after the fix.',
  next: 'SYNTHETIC_H1_NEXT: thanks, now tidy the synthetic notes.',
  later: 'SYNTHETIC_H1_LATER: gaps=0 again',
  laterSaid: 'SYNTHETIC_H1_LATER_SAID: the replay still reports gaps=0.',
  // M35 (windowing): a compaction splits no window; a statement over the window budget cuts the segment before it.
  long: `SYNTHETIC_H1_LONG: still working.\n${'w'.repeat(730_000)}`,
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const command = (id, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: whole('replay'), input: [], changes: [], ...over });
const result = (id, invocation, out, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(out),
  sourceOfResult: 'native', ...over });
const said = (id, key, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null,
  text: whole(key), ...over });

/**
 * Turn T1: the claim, the contradicting replay, a premature statement, a verified child's replay and
 * statement, the fixed replay and the accurate statement. Turn T2: a later replay and statement.
 * `turns: false` records no turn on any event; `compaction` splits the review between the premature
 * statement and the hand-off, so the correction is in a window the claim's window was not shown.
 */
function session({ turns = true, compaction = false } = {}) {
  const T1 = turns ? { turn: 'T1' } : {}, T2 = turns ? { turn: 'T2' } : {};
  const child = { childId: 'w', ...T1 };
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    command('A0', T1), result('A0-r', 'A0', 'earlier', T1),
    said('C1', 'claim', T1),
    command('A1', T1), result('A1-r', 'A1', 'three', { ...T1, result: 'failed', exitCode: 1 }),
    said('C2', 'premature', T1),
    ...(compaction ? [{ id: 'B1', kind: 'boundary', boundary: 'compaction', relatedSession: null, ...T1 },
      said('CL', 'long', T1)] : []),
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Task', operation: 'delegate', paths: [], command: [],
      input: whole('brief'), changes: [], ...T1 },
    command('child:w:A9', child), result('child:w:A9-r', 'child:w:A9', 'childOut', child),
    said('child:w:C9', 'childSaid', child),
    command('A2', T1), result('A2-r', 'A2', 'zero', T1),
    said('C3', 'corrected', { ...T1, phase: 'final' }),
    { id: 'I2', kind: 'instruction', authority: 'human', supersedes: [], text: whole('next'), ...T2 },
    command('A4', T2), result('A4-r', 'A4', 'later', T2),
    said('C4', 'laterSaid', { ...T2, phase: 'final' }),
  ].map((event, sequence) => ({ ...event, sequence }));
  const children = [{ assignmentEvent: 'D1', childId: 'w', childSession: `${SESSION_KEY}/child:w`,
    sessionKey: `${SESSION_KEY}/child:w`, relation: 'spawn', state: 'verified', historyStart: null }];
  return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT }, events, children });
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const STATED = receipt('C1', 'commentary', 'this change clears the gap.');
const AGAINST = receipt('A1-r', 'observation', 'SYNTHETIC_H1_REPLAY: gaps=3');
const FIXED = receipt('A2-r', 'observation', 'SYNTHETIC_H1_REPLAY: gaps=0');
const ACCURATE = receipt('C3', 'commentary', 'the replay now reports gaps=0 after the fix.');
const RESOLVED = Object.freeze({ observation: FIXED, statement: ACCURATE });
const CLAIM_TEXT = 'The agent said the change clears the gap.';
const claim = (resolvedBy, over = {}) => ({ text: CLAIM_TEXT, stated: STATED, contradictedBy: AGAINST,
  ...(resolvedBy === undefined ? {} : { resolvedBy }), ...over });

const narrativeOf = (claims) => ({ decisions: [], pivots: [], requirements: [], claims });
const EMPTY = narrativeOf([]);
const supporting = (cited) => ({ verdict: 'not-refuted', explanation: 'Recorded.', receipts: [cited] });
/** M33 C (vote binding): what an honest challenger cites to uphold an item — a resolution's later result, else
 *  the item's own statement. */
const ownOf = (candidate) => candidate?.resolvedBy?.observation ?? candidate?.stated ?? STATED;
const supportOf = (candidate) => supporting(ownOf(candidate));
/** Upholds every challenged item, citing `cited` — M33 C (vote binding): by default each item's own evidence
 *  (`ownOf`), as an honest challenger cites its support; records every request it was sent. `narrativeByWindow`
 *  picks each window's narrative by its index. */
function judgeFor(narrativeByWindow, seen = [], cited = null) {
  return async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) =>
      ({ key, ...supporting(cited ?? ownOf(candidate)) })) };
    return narrativeByWindow(request.window.index);
  };
}
const review1 = (claims, { base = session(), seen = [] } = {}) => reviewRun.runReview({ session: base, pr: null,
  reviewScope: 'session-only', judge: judgeFor((index) => (index === 0 ? narrativeOf(claims) : EMPTY), seen) });

const contradictions = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted');

// ---- the closed vocabularies ----------------------------------------------------------------------

test('M33 H1 the disclosure reason and the resolution rejections are frozen closed vocabularies', () => {
  // M33 H (owner decision 2026-10-01) added `helper_internal` after it (test/m33-h-helper-internal.test.js).
  // M33 brittleness M4 added `disclosed` after them: an upheld disclosure of an edit, never a role.
  assert.deepEqual(ledger.DISCLOSURE_REASONS, ['self_corrected', 'helper_internal', 'disclosed']);
  assert.ok(Object.isFrozen(ledger.DISCLOSURE_REASONS));
  assert.ok(Array.isArray(ledger.RESOLUTION_REJECTIONS) && Object.isFrozen(ledger.RESOLUTION_REJECTIONS));
  for (const reason of ['malformed', 'role_mismatch', 'unsupplied', 'ungrounded', 'out_of_order', 'cross_actor',
    'turn_unrecorded', 'cross_turn']) assert.ok(ledger.RESOLUTION_REJECTIONS.includes(reason), reason);
  assert.equal(new Set(ledger.RESOLUTION_REJECTIONS).size, ledger.RESOLUTION_REJECTIONS.length);
});

// ---- the positive case ----------------------------------------------------------------------------

test('M33 H1 a verified resolution publishes the contradiction FYI, self_corrected, with both receipts', async () => {
  const plainReport = await review1([claim()]);
  const report = await review1([claim(RESOLVED)]);
  const [plain] = contradictions(plainReport);
  const [finding] = contradictions(report);
  assert.equal(plain.status, 'DECIDE', 'premise: the unresolved contradiction is DECIDE');
  assert.equal(finding.status, 'FYI');
  assert.equal(finding.disclosureReason, 'self_corrected');
  assert.deepEqual(finding.resolvedBy.observation, { ...FIXED, sessionKey: SESSION_KEY });
  assert.deepEqual(finding.resolvedBy.statement, { ...ACCURATE, sessionKey: SESSION_KEY });
  assert.equal(finding.id, plain.id, 'the finding identity is its accusation, not its disclosure');
  assert.deepEqual(finding.receipts, plain.receipts, 'the contradiction is published exactly as before');
  assert.equal(report.counts.resolutions.verified, 1);
  assert.ok(Object.values(report.counts.resolutions.rejected).every((n) => n === 0));
  assert.equal(report.sessionStatus, 'FYI');
  assert.equal(report.reviewStatus, 'FYI');
  assert.deepEqual(report.promises, [], 'the claim is its finding, not also an open promise');
  assert.equal(plainReport.counts.resolutions, undefined, 'no resolution supplied: no resolution record');
});

test('M33 H1 the same resolution through the production adapter: turns are recorded, not inferred', async () => {
  const ledgerRecord = {
    ask: [{ turn: 1, text: TEXT.ask }, { turn: 2, text: TEXT.next }],
    ledger: [
      { turn: 1, seq: 0, kind: 'bash', cmd: TEXT.replay, outcome: 'failed', exitCode: 1, exitCodeSource: 'native',
        tailLines: [TEXT.three] },
      { turn: 1, seq: 1, kind: 'bash', cmd: TEXT.replay, outcome: 'passed', exitCode: 0, exitCodeSource: 'native',
        tailLines: [TEXT.zero] },
      { turn: 2, seq: 0, kind: 'bash', cmd: TEXT.replay, outcome: 'passed', exitCode: 0, exitCodeSource: 'native',
        tailLines: [TEXT.later] },
    ],
    commentary: [
      { turn: 1, record: 2, block: 0, beforeEvent: 0, text: TEXT.claim },
      { turn: 1, record: 6, block: 0, beforeEvent: 2, text: TEXT.corrected },
      { turn: 2, record: 9, block: 0, beforeEvent: 3, text: TEXT.laterSaid },
    ],
  };
  const adapted = adapter.sessionFromLedger(ledgerRecord, { sessionKey: SESSION_KEY });
  const byText = (key) => adapted.events.find((event) => event.kind !== 'invocation'
    && adapted.textOf(event, event.kind === 'observation' ? 'output' : 'text') === TEXT[key]);
  for (const key of ['ask', 'claim', 'three', 'zero', 'corrected'])
    assert.equal(byText(key)?.turn, 'T1', `${key} records the slicer's turn`);
  for (const key of ['next', 'later', 'laterSaid']) assert.equal(byText(key)?.turn, 'T2', key);
  const at = (key, role, quote) => receipt(byText(key).id, role, quote);
  const adaptedClaim = { text: CLAIM_TEXT, stated: at('claim', 'commentary', STATED.quote),
    contradictedBy: at('three', 'observation', AGAINST.quote) };
  const reviewOf = (claims) => reviewRun.runReview({ session: adapted, pr: null, reviewScope: 'session-only',
    judge: judgeFor(() => narrativeOf(claims)) });
  const resolved = await reviewOf([{ ...adaptedClaim, resolvedBy: { observation: at('zero', 'observation', FIXED.quote),
    statement: at('corrected', 'commentary', ACCURATE.quote) } }]);
  assert.deepEqual(contradictions(resolved).map((f) => [f.status, f.disclosureReason]), [['FYI', 'self_corrected']]);
  assert.equal(resolved.sessionStatus, 'FYI');
  const crossTurn = await reviewOf([{ ...adaptedClaim, resolvedBy: { observation: at('later', 'observation', TEXT.later),
    statement: at('laterSaid', 'commentary', TEXT.laterSaid) } }]);
  assert.deepEqual(contradictions(crossTurn).map((f) => f.status), ['DECIDE']);
  assert.equal(crossTurn.counts.resolutions.rejected.cross_turn, 1);
});

test('M33 H1 a transferred child event records its own turn under its child prefix', () => {
  const child = { ask: [], instructions: [{ turn: 1, text: 'Synthetic child assignment.' }], instructionAuthority: 'unchecked',
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: TEXT.replay, outcome: 'passed', exitCode: 0,
      exitCodeSource: 'native', tailLines: [TEXT.childOut] }] };
  const adapted = adapter.sessionFromLedger({ ask: [{ turn: 1, text: TEXT.ask }], ledger: [],
    children: [{ source: 0, ledger: child }],
    delegations: [{ adapter: 'codex', callId: 'd', turn: 1, childId: 'w', status: 'linked', source: 0, link: { source: 0 } }],
  }, { sessionKey: SESSION_KEY });
  const transferred = adapted.events.filter((event) => event.childId === 'w');
  assert.ok(transferred.length > 0, 'premise: the child history was transferred');
  for (const event of transferred) assert.equal(event.turn, 'child:w:T1', event.id);
  for (const event of adapted.events.filter((e) => e.childId == null)) assert.equal(event.turn, 'T1', event.id);
});

// ---- near misses stay DECIDE, unchanged, and are counted ------------------------------------------

async function nearMiss(resolvedBy, reason, options) {
  const plainReport = await review1([claim()], options);
  const report = await review1([claim(resolvedBy)], options);
  const [plain] = contradictions(plainReport);
  assert.equal(contradictions(report).length, 1, `${reason}: the contradiction is still published`);
  const [finding] = contradictions(report);
  assert.deepEqual(finding, plain, `${reason}: the finding is exactly the unresolved one`);
  assert.equal(finding.status, 'DECIDE');
  assert.equal(report.sessionStatus, 'DECIDE');
  assert.equal(report.counts.resolutions.verified, 0);
  assert.equal(report.counts.resolutions.rejected[reason], 1, reason);
  assert.equal(Object.values(report.counts.resolutions.rejected).reduce((a, b) => a + b, 0), 1, `${reason}: counted once`);
  assert.equal(report.rejectedFindings.length, 0, `${reason}: a rejected resolution is not a rejected finding`);
  assert.equal(report.sessionReview, plainReport.sessionReview, `${reason}: the review completes exactly as before`);
  return report;
}

test('M33 H1 a resolution recorded before the contradicting result stays DECIDE (out_of_order)', async () => {
  await nearMiss({ observation: receipt('A0-r', 'observation', 'SYNTHETIC_H1_EARLIER: gaps=0'), statement: ACCURATE },
    'out_of_order');
});

test('M33 H1 a statement made before the result it states stays DECIDE (out_of_order)', async () => {
  await nearMiss({ observation: FIXED, statement: receipt('C2', 'commentary', 'fixed now, the gaps are gone.') },
    'out_of_order');
});

test('M33 H1 a resolution in a later turn stays DECIDE (cross_turn)', async () => {
  await nearMiss({ observation: receipt('A4-r', 'observation', TEXT.later),
    statement: receipt('C4', 'commentary', 'the replay still reports gaps=0.') }, 'cross_turn');
});

test('M33 H1, M35 a resolution by a delegated child for its parent\'s claim stays DECIDE (cross_actor)', async () => {
  // M35 (windowing): a helper is a session of its own. M36 phase 3 (D68 K): this small one shares its parent's window,
  // so a resolution citing its events is supplied — and another actor's: `cross_actor`, DECIDE. (A helper reviewed in a
  // window of its own is not supplied to its parent's: `unsupplied`.)
  await nearMiss({ observation: receipt('child:w:A9-r', 'observation', TEXT.childOut),
    statement: receipt('child:w:C9', 'commentary', 'the child replay reports gaps=0.') }, 'cross_actor');
  await nearMiss({ observation: receipt('child:w:A9-r', 'observation', TEXT.childOut), statement: ACCURATE }, 'cross_actor');
});

test('M33 H1 a resolution whose quote was never recorded stays DECIDE (ungrounded)', async () => {
  await nearMiss({ observation: FIXED, statement: { ...ACCURATE, quote: 'SYNTHETIC QUOTE NOBODY EVER RECORDED' } },
    'ungrounded');
});

test('M33 H1 a resolution statement that is not commentary stays DECIDE (role_mismatch)', async () => {
  await nearMiss({ observation: FIXED, statement: { ...FIXED } }, 'role_mismatch');
  await nearMiss({ observation: { ...ACCURATE }, statement: ACCURATE }, 'role_mismatch');
});

test('M33 H1 a resolution the claim\'s window was not shown stays DECIDE (unsupplied)', async () => {
  const base = session({ compaction: true });
  const report = await nearMiss(RESOLVED, 'unsupplied', { base });
  assert.ok(!report.windowResults[0].eventIds.includes('A2-r'), 'premise: the correction is in a later window');
});

test('M33 H1 a resolution with no recorded turn stays DECIDE (turn_unrecorded)', async () => {
  await nearMiss(RESOLVED, 'turn_unrecorded', { base: session({ turns: false }) });
});

test('M33 H1 a malformed resolvedBy never crashes, never unpublishes, and is counted (malformed)', async () => {
  for (const malformed of ['yes', 7, [], {}, { observation: FIXED }, { ...RESOLVED, extra: FIXED },
    { observation: null, statement: 5 }, { observation: { ...FIXED, note: 'x' }, statement: ACCURATE },
    { observation: { eventId: '', role: 'observation', quote: FIXED.quote }, statement: ACCURATE }])
    await nearMiss(malformed, 'malformed');
});

test('M33 H1 a resolvedBy on a claim with no contradiction is ignored: an open promise, nothing counted', async () => {
  const report = await review1([{ text: 'The agent said the replay reports gaps=0.', stated: ACCURATE,
    contradictedBy: null, resolvedBy: RESOLVED }]);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.promises.map((p) => [p.stated.eventId, p.status]), [['C3', 'open']]);
  assert.equal(report.counts.resolutions, undefined);
  assert.equal(report.claimsRejected, 0);
  const malformed = await review1([{ text: 'The agent said the replay reports gaps=0.', stated: ACCURATE,
    contradictedBy: null, resolvedBy: 'nonsense' }]);
  assert.deepEqual(malformed.promises.map((p) => p.stated.eventId), ['C3']);
  assert.equal(malformed.claimsRejected, 0);
});

test('M33 H1 a resolvedBy carrying a model rating is discarded whole as a malformed resolution; the contradiction stands', async () => {
  // C-06 refreeze (H1b): the contradiction and its resolution are separate items, and the contradiction
  // decides "exactly as without a resolution". A rated resolution is the candidate discarded whole —
  // never read, never shown, never FYI — and the contradiction is published DECIDE as without it.
  const report = await review1([claim({ observation: { ...FIXED, confidence: 'high' }, statement: ACCURATE })]);
  assert.deepEqual(report.findings.map((f) => [f.kind, f.status, f.disclosureReason ?? null]),
    [['claim_contradicted', 'DECIDE', null]], 'never FYI; never removed');
  assert.equal(report.counts.resolutions.rejected.malformed, 1);
  assert.deepEqual(report.windowResults[0].challenge.rejected, []);
});

// ---- the challenge ----------------------------------------------------------------------------------

test('M33 H1 the challenger is told to weigh later results and to judge a supplied resolution on its own', async () => {
  // C-06 refreeze (challenge/6): the resolution is no longer part of the claim item. H1b and M33 written
  // statements (challenge/7): resolution and written items are each asked in a challenge run of their own. M33 C2
  // (challenge/9): the verbatim quote decides.
  // M33 H repair moved it once more (`sonah.challenge/10`: a relay of another agent's report is its own claim).
  // M33 N moved it once more (`sonah.challenge/11`): a forbidden-edit item and its note; no earlier request byte moved.
  // Status fact moved it once more (`sonah.challenge/12`): one system sentence; a vote must quote an uncovered result.
  // H3 moved it once more (`sonah.challenge/13`): a hedged outcome statement is a claim.
  // M33 brittleness M3 moved it once more (`sonah.challenge/12`): a forbidden-edit item names its breach; no other batch moved.
  // M33 brittleness M4 moved it once more (`sonah.challenge/13`): a disclosure item and its note; no other batch moved.
  // M33 brittleness M4's session route moved it once more (`sonah.challenge/14`): a forbidden-edit item no longer
  // shows the agent's statement, which is asked as a disclosure item; no other batch moved.
  // M33 integration moved it once more (`sonah.challenge/15`): one version above every branch's own (C-05 integration).
  // The disclosure narrowing moved it once more (`sonah.challenge/16`): a disclosure item's proposition and note only.
  // Stable event ids moved it once more (`sonah.challenge/17`): every recorded event's id (C-01 event identity).
  // M35 windowing moved it once more (`sonah.challenge/18`): every evidence byte and a session-only candidate's aliases.
  // M36 phase 1 moved it once more (`sonah.challenge/19`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.challenge/20`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.challenge/21`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.challenge/22`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.challenge/23`): the evidence a challenge shows moved as the narrative's (D69_REVIEW_VERSIONS).
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
  assert.equal(challenge.CHALLENGE_PROFILE.version, 'sonah.challenge/44');
  assert.equal(challenge.CHALLENGE_PROFILE.requiredSurvivals, 2, 'vote semantics unchanged');
  const seen = [];
  await review1([claim(RESOLVED)], { seen });
  const asked = seen.filter((request) => request.challenge);
  // H1b: three passes for the claim, then three of its own for the resolution.
  assert.equal(asked.length, 6, 'premise: three passes each');
  const flat = asked[0].system.replace(/\s+/g, ' ');
  assert.match(flat, /later result/i);
  assert.match(flat, /resolvedBy/);
  assert.match(flat, /same measurement/i);
  assert.match(flat, /same turn/i);
  // The claim is its own item without its resolution; the resolution is a separate item, in its own calls.
  assert.deepEqual(asked.map((request) => request.challenge.items.map((item) => [item.type, item.candidate.resolvedBy])),
    [...Array(3).fill([['claim', undefined]]), ...Array(3).fill([['resolution', RESOLVED]])]);
});

test('M33 H1 the challenge is shown only a resolution code could accept', async () => {
  const shown = async (claims, base) => {
    const seen = [];
    await review1(claims, { seen, base });
    return seen.filter((request) => request.challenge)[0].challenge.items.map((item) => item.candidate);
  };
  const [unsupplied] = await shown([claim(RESOLVED)], session({ compaction: true }));
  assert.ok(!Object.hasOwn(unsupplied, 'resolvedBy'), 'a resolution the window was not shown is not challenged');
  const [malformed] = await shown([claim({ observation: FIXED })]);
  assert.ok(!Object.hasOwn(malformed, 'resolvedBy'));
  const [uncontradicted] = await shown([{ text: 't', stated: ACCURATE, contradictedBy: null, resolvedBy: RESOLVED }]);
  assert.ok(!Object.hasOwn(uncontradicted, 'resolvedBy'));
});

test('M33 H1 a resolved claim still needs two grounded support votes: one is not enough', async () => {
  const judge = async (request) => (request.challenge
    ? { votes: request.challenge.items.map(({ key, candidate }) => (request.challenge.pass === 1
      ? { key, ...supportOf(candidate) } : { key, verdict: 'refuted', explanation: 'Superseded.', receipts: [FIXED] })) }
    : narrativeOf([claim(RESOLVED)]));
  const report = await reviewRun.runReview({ session: session(), pr: null, reviewScope: 'session-only', judge });
  assert.deepEqual(report.findings, [], 'neither FYI nor DECIDE: the contradiction did not survive');
  // C-06 refreeze: the contradiction and its resolution are two items; both were refuted here, and
  // the contradiction's refutation alone is what removes the finding.
  assert.equal(report.challenge.refutedItems, 2);
});

// ---- the narrative prompt and schema --------------------------------------------------------------

test('M33 H1 the narrative prompt asks for resolvedBy only for a later same-turn correction, and the version moved', () => {
  // M33 X moved it once more (carried evidence; only a window with something to carry moved a byte).
  // M33 H repair moved it once more (`sonah.narrative/13`: a relay of another agent's report is its own claim).
  // OWNER DECISION B (2026-10-01) moved it once more: per-decision instruction completeness. Only an incomplete
  // window's scope lines (`completeFor`) and an in-turn human instruction's header moved a byte.
  // M33 N moved it once more (`sonah.narrative/14`): a session-only request asks for edits against a human instruction.
  // Status fact moved it once more (`sonah.narrative/15`): a "status:" line under an uncovered result, three task lines.
  // H3 moved it once more (`sonah.narrative/16`): a hedged outcome statement is a claim.
  // M33 brittleness M3 moved it once more (`sonah.narrative/15`): a removal or a deletion is a forbidden edit too.
  // M33 integration moved it once more (`sonah.narrative/17`): one version above every branch's own (C-05 integration).
  // The M33 labels merge moved it once more (`sonah.narrative/18`): the slice-time marker headers.
  // Stable event ids moved it once more (`sonah.narrative/19`): every recorded event's id (C-01 event identity).
  // The D64 wording moved it once more (`sonah.narrative/20`): the proposer's two disclosure sentences.
  // M35 windowing moved it once more (`sonah.narrative/21`): windows, carried context, trims, aliases (C-07).
  // M36 phase 1 moved it once more (`sonah.narrative/22`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.narrative/23`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.narrative/24`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.narrative/25`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.narrative/26`): a combined request's omission lines offer no request (F2), the ledger moved (typed withholding, paths as recorded) (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.narrative/27), and D71 (S3) once more (sonah.narrative/28): the new channels (D71_CHANNELS_VERSIONS).
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  assert.equal(prompt.PROMPT_VERSION, 'sonah.narrative/37');
  const claims = prompt.NARRATIVE_SCHEMA.properties.claims.items;
  const resolvedBy = claims.properties.resolvedBy;
  assert.deepEqual(resolvedBy.type, ['object', 'null']);
  assert.deepEqual(resolvedBy.required, ['observation', 'statement']);
  assert.equal(resolvedBy.properties.observation.properties.role.const, 'observation');
  assert.equal(resolvedBy.properties.statement.properties.role.const, 'commentary');
  assert.deepEqual(claims.required, ['text', 'stated'], 'resolvedBy is optional');
  const built = prompt.buildNarrativePrompt({ session: session(), window: { index: 0, events: session().events } });
  const flat = built.prompt.replace(/\s+/g, ' ');
  assert.match(flat, /"resolvedBy"/);
  assert.match(flat, /LATER result in the SAME turn/);
  assert.match(flat, /LATER stated/);
  assert.ok(!built.evidencePrompt.includes('resolvedBy'), 'guidance is task text, never evidence');
  // M33 H repair moved it once more (`sonah.narrative/13`: a relay of another agent's report is its own claim).
  // M33 brittleness M3 moved it once more (`sonah.narrative/15`): a removal or a deletion is a forbidden edit too.
  // M33 integration moved it once more (`sonah.narrative/17`): one version above every branch's own (C-05 integration).
  // The M33 labels merge moved it once more (`sonah.narrative/18`): the slice-time marker headers.
  // Stable event ids moved it once more (`sonah.narrative/19`): every recorded event's id (C-01 event identity).
  // The D64 wording moved it once more (`sonah.narrative/20`): the proposer's two disclosure sentences.
  // M35 windowing moved it once more (`sonah.narrative/21`): windows, carried context, trims, aliases (C-07).
  // M36 phase 1 moved it once more (`sonah.narrative/22`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.narrative/23`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.narrative/24`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.narrative/25`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.narrative/26`): a combined request's omission lines offer no request (F2), the ledger moved (typed withholding, paths as recorded) (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.narrative/27), and D71 (S3) once more (sonah.narrative/28): the new channels (D71_CHANNELS_VERSIONS).
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  assert.equal(reviewRun.runProfile('session-only').promptVersion, 'sonah.narrative/37');
});

test('M33 H1 the combined route asks for the same resolvedBy, and its version moved', () => {
  // M33 brittleness M4 moved it (`sonah.code-review/14`): a session finding's disclosure is its own proposition.
  // M33 integration moved it once more (`sonah.code-review/15`): one version above M33 forbidden-edit repair's /14.
  // Stable event ids moved it once more (`sonah.code-review/16`): every recorded event's id (C-01 event identity).
  // The D64 wording moved it once more (`sonah.code-review/17`): the joint task's disclosure sentence.
  // M35 windowing moved it once more (`sonah.code-review/18`): the narrative evidence it embeds.
  // M36 phase 1 moved it once more (`sonah.code-review/19`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.code-review/20`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.code-review/21`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.code-review/22`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.code-review/23`): the narrative evidence a joint request embeds moved as the narrative's (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.code-review/24): the reviewer brief as the checklist (D71_BRIEF_VERSIONS).
  assert.equal(codeReviewPrompt.CODE_REVIEW_VERSION, 'sonah.code-review/24');
  const claims = codeReviewPrompt.CODE_REVIEW_SCHEMA.properties.claims.items;
  assert.equal(claims.properties.resolvedBy.additionalProperties, false);
  assert.equal(claims.properties.resolvedBy.properties.statement.additionalProperties, false);
  const base = session();
  const snapshot = { diff: 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n',
    files: [{ path: 'x.js', oldPath: null, change: 'modified', contentState: 'complete' }],
    sources: [], baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), complete: true };
  const built = codeReviewPrompt.buildCodeReviewPrompt({ snapshot, placed: null,
    narrativePrompt: prompt.buildNarrativePrompt({ session: base, window: { index: 0, events: base.events } }) });
  // The joint request's task text, never its evidence.
  const flat = built.prompt.replace(built.evidencePrompt, '').replace(/\s+/g, ' ');
  assert.match(flat, /resolvedBy/);
  assert.match(flat, /LATER result in the SAME turn/);
});

// ---- statuses: FYI never outranks DECIDE, and never reads CLEAN -----------------------------------

test('M33 H1 a self-corrected FYI beside an unresolved DECIDE: the session is DECIDE, the FYI is kept', async () => {
  const other = { text: 'The agent said the gaps are gone.', stated: receipt('C2', 'commentary', 'fixed now, the gaps are gone.'),
    contradictedBy: AGAINST };
  const report = await review1([claim(RESOLVED), other]);
  assert.deepEqual(contradictions(report).map((f) => f.status).sort(), ['DECIDE', 'FYI']);
  assert.equal(report.sessionStatus, 'DECIDE');
  assert.equal(report.reviewStatus, 'DECIDE');
  assert.ok(contradictions(report).some((f) => f.disclosureReason === 'self_corrected'), 'the FYI item is kept');
});

test('M33 H1 the reducers: DECIDE outranks a self-corrected FYI; an incomplete review is UNCHECKED, never CLEAN', () => {
  const fyi = { origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', disclosureReason: 'self_corrected' };
  const decide = { origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE' };
  assert.equal(ledger.reduceSessionStatus([fyi, decide], 'complete', 'complete'), 'DECIDE');
  assert.equal(ledger.reduceSessionStatus([fyi], 'complete', 'complete'), 'FYI');
  assert.equal(ledger.reduceSessionStatus([fyi], 'partial', 'complete'), 'FYI');
  assert.equal(ledger.reduceSessionStatus([fyi], 'complete', 'incomplete'), 'UNCHECKED');
  assert.equal(ledger.reduceSessionStatus([fyi], 'missing', 'complete'), 'UNCHECKED');
});

test('M33 H1 false-clean invariant: a self-corrected FYI in a review that did not complete reads UNCHECKED', async () => {
  // The challengers never vote on the second claim, even when re-asked: the window's challenge did
  // not complete, so the session review did not either. The self-corrected FYI (its contradiction
  // and, C-06 refreeze, its separate resolution item both upheld) is retained.
  const report = await reviewRun.runReview({ session: session(), pr: null, reviewScope: 'session-only',
    judge: async (request) => (request.challenge
      ? { votes: request.challenge.items.filter(({ key }) => ['claims:0', 'claims:0:resolution'].includes(key))
        .map(({ key, candidate }) => ({ key, ...supportOf(candidate) })) }
      : narrativeOf([claim(RESOLVED), { text: 'The agent said the replay reports gaps=0.', stated: ACCURATE,
        contradictedBy: null }])) });
  assert.deepEqual(contradictions(report).map((f) => [f.status, f.disclosureReason]), [['FYI', 'self_corrected']]);
  assert.equal(report.sessionReview, 'incomplete');
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.equal(report.reviewStatus, 'UNCHECKED');
  assert.equal(ledger.reviewRunState(report), 'incomplete');
});

// ---- merging never softens a DECIDE ------------------------------------------------------------------

test('M33 H1 a merge that keeps DECIDE keeps no self-corrected disclosure', () => {
  const grounded = (r) => ({ ...r, sessionKey: SESSION_KEY });
  const base = { origin: 'session-review', kind: 'claim_contradicted', title: 't', explanation: 'e', scope: 'session-effect',
    anchor: null, receipts: [grounded(STATED), grounded(AGAINST)] };
  const fyi = { ...base, id: 'x', status: 'FYI', disclosureReason: 'self_corrected',
    resolvedBy: { observation: grounded(FIXED), statement: grounded(ACCURATE) } };
  const decide = { ...base, id: 'x', title: 'u', status: 'DECIDE' };
  for (const order of [[fyi, decide], [decide, fyi]]) {
    const { findings, merged } = ledger.mergeDuplicateFindings(order);
    assert.equal(merged, 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].status, 'DECIDE');
    assert.ok(!Object.hasOwn(findings[0], 'disclosureReason'));
    assert.ok(!Object.hasOwn(findings[0], 'resolvedBy'));
  }
  const both = ledger.mergeDuplicateFindings([fyi, { ...fyi, title: 'u' }]);
  assert.equal(both.findings[0].status, 'FYI');
  assert.equal(both.findings[0].disclosureReason, 'self_corrected');
});

// ---- toCandidates carries the resolution; code, not the model, sets everything else --------------

test('M33 H1 toCandidates carries resolvedBy and records whether the window supplied it', () => {
  const base = session();
  const sourceMap = { C1: [{ role: 'commentary', text: TEXT.claim }], 'A1-r': [{ role: 'observation', text: TEXT.three }],
    'A2-r': [{ role: 'observation', text: TEXT.zero }] };
  const { findings: [supplied] } = reviewRun.toCandidates(narrativeOf([claim(RESOLVED)]), base,
    { sourceMap: { ...sourceMap, C3: [{ role: 'commentary', text: TEXT.corrected }] } });
  assert.deepEqual(supplied.resolvedBy, RESOLVED);
  assert.equal(supplied.resolutionSupplied, true);
  const { findings: [missing] } = reviewRun.toCandidates(narrativeOf([claim(RESOLVED)]), base, { sourceMap });
  assert.equal(missing.resolutionSupplied, false);
  const direct = ledger.buildLedger({ repo: REPO, session: base, findingCandidates: [missing], sessionCoverage: 'complete' });
  assert.deepEqual(direct.findings.map((f) => f.status), ['DECIDE']);
  assert.equal(direct.counts.resolutions.rejected.unsupplied, 1);
  // The model cannot set a disclosure: only a verified resolution does.
  const forged = { ...reviewRun.toCandidates(narrativeOf([claim()]), base).findings[0],
    disclosureReason: 'self_corrected', status: 'FYI' };
  const grounded = ledger.buildLedger({ repo: REPO, session: base, findingCandidates: [forged], sessionCoverage: 'complete' });
  assert.equal(grounded.findings.length, 0, 'a candidate carrying a status is rejected whole');
  const { disclosureReason: _d, status: _s, ...unrated } = forged;
  const plainGrounded = ledger.buildLedger({ repo: REPO, session: base,
    findingCandidates: [{ ...unrated, disclosureReason: 'self_corrected' }], sessionCoverage: 'complete' });
  assert.deepEqual(plainGrounded.findings.map((f) => [f.status, f.disclosureReason]), [['DECIDE', undefined]]);
});

// ---- the combined route ---------------------------------------------------------------------------

const GREET = 'src/greet.js';
const GREET_DIFF = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/greet.js', '@@ -0,0 +1,1 @@', '+export default "SYNTHETIC_H1_GREETING";', ''].join('\n');
const GREET_PR = { repo: { host: 'github.com', id: '331' }, number: 331, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
  files: [{ path: GREET, change: 'added', contentState: 'complete' }] };
/** The joint window answers with `claims` and `sessionFindings`; every challenge vote upholds. */
const jointJudge = ({ claims, sessionFindings = [] }) => async (request) => {
  const base = { ...EMPTY, codeFindings: [], sessionFindings: [] };
  if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key, ...supportOf(candidate) })) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
  if (request.label === 'code+narrative:w1') return { ...base, reviewedFiles: [], claims, sessionFindings };
  return { ...base, reviewedFiles: [] };
};
const combined = (answer) => runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF, judge: jointJudge(answer) });

test('M33 H1 the combined route publishes the same self-correction, and reads a bad resolution as no proposal fault', async () => {
  const report = await combined({ claims: [claim(RESOLVED)] });
  assert.deepEqual(contradictions(report).map((f) => [f.status, f.disclosureReason]), [['FYI', 'self_corrected']]);
  assert.equal(report.counts.resolutions.verified, 1);
  assert.equal(report.rejectedNarrative, 0);
  assert.equal(report.sessionStatus, 'FYI');
  const malformed = await combined({ claims: [claim({ observation: FIXED })] });
  assert.deepEqual(contradictions(malformed).map((f) => f.status), ['DECIDE']);
  assert.equal(malformed.counts.resolutions.rejected.malformed, 1);
  assert.equal(malformed.rejectedNarrative, 0, 'the claim itself was read: its resolution alone was rejected');
});

test('M33 H1 the combined route never lets a self-correction soften a direct DECIDE of the same contradiction', async () => {
  const direct = { origin: 'session-review', kind: 'claim_contradicted', title: 'SYNTHETIC_H1_DIRECT',
    explanation: 'SYNTHETIC_H1: the recorded replay contradicts the claim.', scope: 'session-effect', anchor: null,
    receipts: [STATED, AGAINST] };
  const report = await combined({ claims: [claim(RESOLVED)], sessionFindings: [direct] });
  const rows = contradictions(report);
  assert.equal(rows.length, 1, 'one contradiction, one row');
  assert.equal(rows[0].status, 'DECIDE');
  assert.ok(!Object.hasOwn(rows[0], 'disclosureReason'));
  assert.ok(!Object.hasOwn(rows[0], 'resolvedBy'));
  assert.equal(report.sessionStatus, 'DECIDE');
});
