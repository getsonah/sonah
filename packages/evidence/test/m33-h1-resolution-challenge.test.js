// C-06 "M33 self-corrected claims", *Refreeze after review*. The contradiction and its resolution are
// challenged as SEPARATE items. The contradiction item decides whether a finding exists, exactly as
// without a resolution. Only a resolution that already passed every code check (shape, roles,
// supplied, grounded, order, actor, turn) is shown to challengers, as its own item; the finding is
// FYI `self_corrected` only when the contradiction survives AND the resolution item survives with two
// grounded support votes. A refuted, unsettled or unexecuted resolution leaves the surviving
// contradiction DECIDE and never removes it. A human instruction recorded between the claim and the
// resolution leaves it DECIDE; a human-originated tool rejection the recording does not mark is a
// documented limit, never inferred from text.
//
// Also: a deeply nested resolvedBy never crashes a review (the rating scan is bounded and fails
// closed as a malformed resolution, never dropping the claim).
//
// Synthetic sessions (/srv/x paths), synthetic judges: no recording, no model call. Nothing prints.
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
import { runCodeReview } from '../src/code-review.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';

const REPO = { host: 'github.com', id: '0' };
const SESSION_KEY = 'sess-h1f';

const TEXT = {
  ask: 'SYNTHETIC_H1F_ASK: make the synthetic replay report no gaps.',
  replay: 'node /srv/x/replay.js',
  lint: 'node /srv/x/lint.js',
  earlier: 'SYNTHETIC_H1F_EARLIER: gaps=0 on the old fixture',
  claim: 'SYNTHETIC_H1F_CLAIM: this change clears the gap.',
  three: 'SYNTHETIC_H1F_REPLAY: gaps=3',
  brief: 'SYNTHETIC_H1F_BRIEF: replay the synthetic fixture.',
  childOut: 'SYNTHETIC_H1F_CHILD_REPLAY: gaps=0',
  childSaid: 'SYNTHETIC_H1F_CHILD_SAID: the child replay reports gaps=0.',
  other: 'SYNTHETIC_H1F_OTHER: lint ok, 0 warnings',
  otherSaid: 'SYNTHETIC_H1F_OTHER_SAID: lint reports 0 warnings now.',
  nudge: 'SYNTHETIC_H1F_NUDGE: the replay still fails, fix the parser.',
  zero: 'SYNTHETIC_H1F_REPLAY: gaps=0',
  corrected: 'SYNTHETIC_H1F_CORRECTED: the replay now reports gaps=0 after the fix.',
  thanks: 'SYNTHETIC_H1F_THANKS: good, that is what I wanted.',
  next: 'SYNTHETIC_H1F_NEXT: thanks, now tidy the synthetic notes.',
  later: 'SYNTHETIC_H1F_LATER: gaps=0 again',
  laterSaid: 'SYNTHETIC_H1F_LATER_SAID: the replay still reports gaps=0.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const command = (id, over = {}, key = 'replay') => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: whole(key), input: [], changes: [], ...over });
const result = (id, invocation, out, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(out),
  sourceOfResult: 'native', ...over });
const said = (id, key, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null,
  text: whole(key), ...over });
const human = (id, key, over) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: whole(key), ...over });

/**
 * Turn T1: the claim, the contradicting replay, a verified child's replay and statement, a later lint
 * run of a DIFFERENT measurement and its statement, the fixed replay and the accurate statement. Turn
 * T2: a later replay and statement. `nudge: 'between'` records a human instruction in T1 after the
 * contradiction and before the correction; `nudge: 'after'` records one in T1 after the correction.
 * `turns: false` records no turn on any event.
 */
function session({ nudge = null, turns = true } = {}) {
  const T1 = turns ? { turn: 'T1' } : {}, T2 = turns ? { turn: 'T2' } : {};
  const child = { childId: 'w', ...(turns ? { turn: 'child:w:T1' } : {}) };
  const events = [
    human('I1', 'ask', T1),
    command('A0', T1), result('A0-r', 'A0', 'earlier', T1),
    said('C1', 'claim', T1),
    command('A1', T1), result('A1-r', 'A1', 'three', { ...T1, result: 'failed', exitCode: 1 }),
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Task', operation: 'delegate', paths: [], command: [],
      input: whole('brief'), changes: [], ...T1 },
    command('child:w:A9', child), result('child:w:A9-r', 'child:w:A9', 'childOut', child),
    said('child:w:C9', 'childSaid', child),
    command('A3', T1, 'lint'), result('A3-r', 'A3', 'other', T1), said('C5', 'otherSaid', T1),
    ...(nudge === 'between' ? [human('I1b', 'nudge', T1)] : []),
    command('A2', T1), result('A2-r', 'A2', 'zero', T1),
    said('C3', 'corrected', { ...T1, phase: 'final' }),
    ...(nudge === 'after' ? [human('I1c', 'thanks', T1)] : []),
    human('I2', 'next', T2),
    command('A4', T2), result('A4-r', 'A4', 'later', T2),
    said('C4', 'laterSaid', { ...T2, phase: 'final' }),
  ].map((event, sequence) => ({ ...event, sequence }));
  const children = [{ assignmentEvent: 'D1', childId: 'w', childSession: `${SESSION_KEY}/child:w`,
    sessionKey: `${SESSION_KEY}/child:w`, relation: 'spawn', state: 'verified', historyStart: null }];
  return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT }, events, children });
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const STATED = receipt('C1', 'commentary', 'this change clears the gap.');
const AGAINST = receipt('A1-r', 'observation', 'SYNTHETIC_H1F_REPLAY: gaps=3');
const FIXED = receipt('A2-r', 'observation', 'SYNTHETIC_H1F_REPLAY: gaps=0');
const ACCURATE = receipt('C3', 'commentary', 'the replay now reports gaps=0 after the fix.');
const RESOLVED = Object.freeze({ observation: FIXED, statement: ACCURATE });
const NEXT_ASK = receipt('I2', 'instruction', TEXT.next);
const CLAIM_TEXT = 'The agent said the change clears the gap.';
const claim = (resolvedBy, over = {}) => ({ text: CLAIM_TEXT, stated: STATED, contradictedBy: AGAINST,
  ...(resolvedBy === undefined ? {} : { resolvedBy }), ...over });
const narrativeOf = (claims) => ({ decisions: [], pivots: [], requirements: [], claims });
const EMPTY = narrativeOf([]);
const contradictions = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted');
const statuses = (report) => contradictions(report).map((f) => `${f.status}${f.disclosureReason ? `/${f.disclosureReason}` : ''}`);
const vote = (key, verdict, cited, explanation = 'Recorded.') => ({ key, verdict, explanation, receipts: cited ? [cited] : [] });

/** The resolution pairs code rejects, each with its closed reason, on the default session. */
const CODE_REJECTED = Object.freeze({
  cross_turn: { observation: receipt('A4-r', 'observation', TEXT.later), statement: receipt('C4', 'commentary', 'the replay still reports gaps=0.') },
  out_of_order: { observation: receipt('A0-r', 'observation', TEXT.earlier), statement: ACCURATE },
  // M35 (windowing): a helper is a session of its own. M36 phase 3 (D68 K): this small one shares its parent's window,
  // so a resolution citing its events is supplied — and another actor's (`cross_actor`). (A helper reviewed in a window
  // of its own is not supplied to its parent's: `unsupplied`.)
  cross_actor: { observation: receipt('child:w:A9-r', 'observation', TEXT.childOut),
    statement: receipt('child:w:C9', 'commentary', 'the child replay reports gaps=0.') },
  ungrounded: { observation: FIXED, statement: { ...ACCURATE, quote: 'SYNTHETIC QUOTE NOBODY EVER RECORDED' } },
});
/** Code-valid in every check (same turn, same actor, grounded, in order) and yet the result of a
 *  different measurement: only a challenger can tell. */
const WRONG_MEASUREMENT = Object.freeze({ observation: receipt('A3-r', 'observation', TEXT.other),
  statement: receipt('C5', 'commentary', 'lint reports 0 warnings now.') });

/** Every request the judge was sent, and a narrative for window 0. `voteFor(item, request)` casts one
 *  vote per challenged item, or returns null to leave the item unvoted. */
function judgeWith(claims, voteFor, seen = []) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return request.window.index === 0 ? narrativeOf(claims) : EMPTY;
    return { votes: request.challenge.items.map((item) => voteFor(item, request)).filter(Boolean) };
  };
}
const review = (claims, voteFor, { base = session(), seen = [] } = {}) => reviewRun.runReview({ session: base,
  pr: null, reviewScope: 'session-only', judge: judgeWith(claims, voteFor, seen) });
/** M33 C (C-05 "M33 vote binding"): what an honest challenger cites to uphold an item — a resolution's later
 *  result, never the claim it resolves; a contradiction's own statement. */
const ownOf = (item) => item.candidate?.resolvedBy?.observation ?? STATED;
const upholdAll = (item) => vote(item.key, 'not-refuted', ownOf(item));
/** Upholds every contradiction; judges a resolution item with `resolutionVerdict`. */
const byType = (resolutionVerdict, cited = resolutionVerdict === 'refuted' ? NEXT_ASK : null) => (item) =>
  (item.type === 'resolution' ? vote(item.key, resolutionVerdict, resolutionVerdict === 'uncertain' ? null : cited ?? ownOf(item))
    : vote(item.key, 'not-refuted', STATED));
const challengeItemsOf = (seen) => seen.filter((request) => request.challenge).flatMap((request) => request.challenge.items);

// ---- the exact blocking repro ------------------------------------------------------------------------

test('M33 H1 refreeze: the blocking repro — a refuted resolution never erases a true contradiction', async () => {
  // The review's faithful challenger, verbatim: it upholds the contradiction (C1 against A1-r) and
  // refutes any resolution it is shown that does not hold. Before the refreeze a code-rejected
  // resolution was shown inside the claim item, the item was refuted, and the real contradiction
  // disappeared — no DECIDE and no FYI. M33 C (C-05 "M33 vote binding"): an upheld resolution is upheld on its
  // own later result, never on the claim's words alone.
  const BAD = new Set(['A4-r', 'A0-r', 'child:w:A9-r']);
  const defeats = (rb) => rb && (BAD.has(rb.observation.eventId) || rb.statement.quote.startsWith('SYNTHETIC QUOTE'));
  const cases = { none: undefined, valid: RESOLVED, ...CODE_REJECTED };
  const expected = { none: ['DECIDE'], valid: ['FYI/self_corrected'], cross_turn: ['DECIDE'], out_of_order: ['DECIDE'],
    cross_actor: ['DECIDE'], ungrounded: ['DECIDE'] };
  for (const [name, resolvedBy] of Object.entries(cases)) {
    const seen = [];
    const report = await review([claim(resolvedBy)], ({ key, candidate }) => (defeats(candidate.resolvedBy)
      ? vote(key, 'refuted', NEXT_ASK, 'The supplied resolution does not hold.')
      : vote(key, 'not-refuted', candidate.resolvedBy?.observation ?? STATED)), { seen });
    assert.deepEqual(statuses(report), expected[name], name);
    assert.equal(report.sessionStatus, name === 'valid' ? 'FYI' : 'DECIDE', name);
    const shown = challengeItemsOf(seen).some((item) => Object.hasOwn(item.candidate, 'resolvedBy'));
    assert.equal(shown, name === 'valid', `${name}: only a resolution that passed every code check is shown`);
    if (Object.hasOwn(CODE_REJECTED, name)) assert.equal(report.counts.resolutions.rejected[name], 1, name);
    assert.equal(report.challenge.refutedItems, 0, `${name}: nothing true was refuted`);
  }
});

test('M33 H1 refreeze: the contradiction is its own item exactly as without a resolution; the resolution is a separate item', async () => {
  const bare = [], resolved = [];
  await review([claim()], upholdAll, { seen: bare });
  await review([claim(RESOLVED)], upholdAll, { seen: resolved });
  const [plainRequest] = bare.filter((request) => request.challenge);
  // H1b: the resolution item is asked in calls of its own, after the contradiction's.
  const [request, resolutionRequest] = resolved.filter((request) => request.challenge)
    .filter((request, at, all) => all.findIndex((other) => other.prompt === request.prompt) === at);
  assert.deepEqual(plainRequest.challenge.items.map((item) => [item.key, item.type]), [['claims:0', 'claim']]);
  assert.deepEqual(request.challenge.items.map((item) => [item.key, item.type]), [['claims:0', 'claim']]);
  assert.deepEqual(resolutionRequest.challenge.items.map((item) => [item.key, item.type]),
    [['claims:0:resolution', 'resolution']]);
  // The contradiction's request is byte-identical to the one without a resolution.
  assert.equal(request.prompt, plainRequest.prompt);
  assert.deepEqual(request.challenge.items[0].candidate, plainRequest.challenge.items[0].candidate);
  assert.ok(!Object.hasOwn(request.challenge.items[0].candidate, 'resolvedBy'));
  // The resolution item names the contradicted claim and the proposed pair, and nothing else.
  assert.deepEqual(resolutionRequest.challenge.items[0].candidate, { text: CLAIM_TEXT, stated: STATED, contradictedBy: AGAINST,
    resolvedBy: { observation: FIXED, statement: ACCURATE } });
});

test('M33 H1 refreeze: a code-valid resolution the challengers refute leaves the contradiction DECIDE, counted', async () => {
  const plainReport = await review([claim()], upholdAll);
  const [plain] = contradictions(plainReport);
  for (const resolvedBy of [RESOLVED, WRONG_MEASUREMENT]) {
    const report = await review([claim(resolvedBy)], byType('refuted'));
    assert.deepEqual(contradictions(report), [plain], 'exactly the unresolved finding, never removed');
    assert.equal(report.sessionStatus, 'DECIDE');
    assert.equal(report.counts.resolutions.verified, 0);
    assert.equal(report.counts.resolutions.rejected.refuted, 1);
    assert.equal(report.challenge.refutedItems, 1, 'the resolution item, and only it, was refuted');
    assert.equal(report.claimsRejected, 0, 'a refuted resolution is not a rejected claim');
    assert.equal(report.sessionReview, 'complete');
  }
});

test('M33 H1 refreeze: an upheld resolution on a refuted contradiction publishes nothing — the contradiction decides', async () => {
  const report = await review([claim(RESOLVED)], (item) => (item.type === 'resolution'
    ? vote(item.key, 'not-refuted', ownOf(item)) : vote(item.key, 'refuted', FIXED, 'Not contradicted.')));
  assert.deepEqual(report.findings, []);
  assert.notEqual(report.sessionStatus, 'FYI');
});

test('M33 H1 refreeze: an unsettled resolution leaves the contradiction DECIDE, counted, and the review completes', async () => {
  const report = await review([claim(RESOLVED)], byType('uncertain'));
  assert.deepEqual(statuses(report), ['DECIDE']);
  assert.equal(report.counts.resolutions.rejected.unsettled, 1);
  assert.equal(report.sessionReview, 'complete');
  assert.equal(report.sessionStatus, 'DECIDE');
  // Three support votes that do not ground are not two grounded support votes.
  const ungrounded = await review([claim(RESOLVED)], byType('not-refuted',
    receipt('C3', 'commentary', 'SYNTHETIC QUOTE NOBODY EVER RECORDED')));
  assert.deepEqual(statuses(ungrounded), ['DECIDE']);
  assert.equal(ungrounded.counts.resolutions.rejected.unsettled, 1);
});

test('M33 H1 refreeze: one grounded support vote is not enough for the resolution', async () => {
  const report = await review([claim(RESOLVED)], (item, request) => (item.type !== 'resolution'
    ? vote(item.key, 'not-refuted', STATED)
    : request.challenge.pass === 1 ? vote(item.key, 'not-refuted', ownOf(item)) : vote(item.key, 'refuted', NEXT_ASK)));
  assert.deepEqual(statuses(report), ['DECIDE']);
  assert.equal(report.counts.resolutions.rejected.refuted, 1);
});

test('M33 H1 refreeze: an unexecuted resolution leaves the contradiction DECIDE, counted, and never hides the gap', async () => {
  // The challengers never vote on the resolution item, even when re-asked.
  const report = await review([claim(RESOLVED)], (item) => (item.type === 'resolution' ? null : vote(item.key, 'not-refuted', STATED)));
  assert.deepEqual(statuses(report), ['DECIDE']);
  assert.equal(report.counts.resolutions.rejected.unexecuted, 1);
  assert.equal(report.sessionReview, 'incomplete', 'a check that did not run is a gap');
  assert.equal(report.sessionStatus, 'DECIDE', 'DECIDE outranks an incomplete review');
  assert.ok(reviewRun.windowIncompleteReasons(report.windowResults[0]).length > 0);
});

test('M33 H1 refreeze: the ledger never publishes FYI for a resolution no challenge upheld', () => {
  const base = session();
  const [candidate] = reviewRun.toCandidates(narrativeOf([claim(RESOLVED)]), base).findings;
  assert.ok(!Object.hasOwn(candidate, 'resolutionChallenge'), 'no outcome: nothing was challenged');
  const direct = ledger.buildLedger({ repo: REPO, session: base, findingCandidates: [candidate], sessionCoverage: 'complete' });
  assert.deepEqual(direct.findings.map((f) => f.status), ['DECIDE']);
  assert.equal(direct.counts.resolutions.rejected.unexecuted, 1);
  for (const outcome of ['refuted', 'unsettled', 'unexecuted', 'UPHELD', true, 'yes']) {
    const out = ledger.buildLedger({ repo: REPO, session: base, sessionCoverage: 'complete',
      findingCandidates: [{ ...candidate, resolutionChallenge: outcome }] });
    assert.deepEqual(out.findings.map((f) => f.status), ['DECIDE'], String(outcome));
  }
  const upheld = ledger.buildLedger({ repo: REPO, session: base, sessionCoverage: 'complete',
    findingCandidates: [{ ...candidate, resolutionChallenge: 'upheld' }] });
  assert.deepEqual(upheld.findings.map((f) => [f.status, f.disclosureReason]), [['FYI', 'self_corrected']]);
  // An upheld challenge never overrides a failed code check.
  const [crossTurn] = reviewRun.toCandidates(narrativeOf([claim(CODE_REJECTED.cross_turn)]), base).findings;
  const forced = ledger.buildLedger({ repo: REPO, session: base, sessionCoverage: 'complete',
    findingCandidates: [{ ...crossTurn, resolutionChallenge: 'upheld' }] });
  assert.deepEqual(forced.findings.map((f) => f.status), ['DECIDE']);
  assert.equal(forced.counts.resolutions.rejected.cross_turn, 1);
  // The model cannot supply the outcome: toCandidates never reads it from a claim.
  const [modelSaid] = reviewRun.toCandidates(narrativeOf([claim(RESOLVED, { resolutionChallenge: 'upheld' })]), base).findings;
  assert.ok(!Object.hasOwn(modelSaid, 'resolutionChallenge'));
});

test('M33 H1 refreeze: the closed vocabularies name the new outcomes', () => {
  for (const reason of ['human_prompted', 'refuted', 'unsettled', 'unexecuted'])
    assert.ok(ledger.RESOLUTION_REJECTIONS.includes(reason), reason);
  assert.equal(new Set(ledger.RESOLUTION_REJECTIONS).size, ledger.RESOLUTION_REJECTIONS.length);
  assert.deepEqual(ledger.RESOLUTION_CHALLENGE_OUTCOMES, ['upheld', 'refuted', 'unsettled', 'unexecuted']);
  assert.ok(Object.isFrozen(ledger.RESOLUTION_CHALLENGE_OUTCOMES));
});

test('M33 H1 refreeze: the challenger judges the contradiction and the resolution apart, and the version moved', async () => {
  // challenge/7 (H1b and M33 written statements): resolution and written items are asked apart. M33 C2
  // (challenge/9): a claim-class item is shown with its verbatim words, and its batch is sent CLAIM_WORDS_NOTE.
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
  // D103 moved it once more (sonah.challenge/45): a session-only batch shows the results its items cite whole.
  assert.equal(challenge.CHALLENGE_PROFILE.version, 'sonah.challenge/45');
  assert.equal(challenge.CHALLENGE_PROFILE.requiredSurvivals, 2, 'vote semantics unchanged');
  const seen = [];
  await review([claim(RESOLVED)], upholdAll, { seen });
  const [request] = seen.filter((r) => r.challenge);
  const flat = request.system.replace(/\s+/g, ' ');
  assert.match(flat, /later result/i);
  assert.match(flat, /same measurement/i);
  assert.match(flat, /resolution/);
  assert.match(flat, /never the contradiction/i);
  assert.match(flat, /human asked for the correction/i);
  assert.match(flat, /rejected/i);
  assert.doesNotMatch(flat, /as part of the claim/i);
  // M33 H repair moved it once more (`sonah.challenge/10`: a relay of another agent's report is its own claim).
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
  // D103 moved it once more (sonah.challenge/45): a session-only batch shows the results its items cite whole.
  assert.equal(reviewRun.runProfile('session-only').challenge.version, 'sonah.challenge/45');
});

// ---- a human instruction between the claim and the resolution ---------------------------------------

test('M33 H1 refreeze: a human instruction recorded between the claim and the resolution leaves DECIDE (human_prompted)', async () => {
  const seen = [];
  const report = await review([claim(RESOLVED)], upholdAll, { base: session({ nudge: 'between' }), seen });
  assert.deepEqual(statuses(report), ['DECIDE']);
  assert.equal(report.counts.resolutions.rejected.human_prompted, 1);
  assert.ok(!challengeItemsOf(seen).some((item) => item.type === 'resolution'), 'never put to the challengers');
  // One recorded after the correction does not make the correction asked for.
  const after = await review([claim(RESOLVED)], upholdAll, { base: session({ nudge: 'after' }) });
  assert.deepEqual(statuses(after), ['FYI/self_corrected']);
});

test('M33 H1 refreeze: a human tool rejection the recording does not mark is a documented limit, never inferred', async (t) => {
  // A Claude recording: the claim, a failing replay, a tool call the human rejects with words of their
  // own, a passing replay and an accurate statement — one human turn. The slicer records the rejection
  // as an ordinary failed tool result: no authority, no marker. Code does not read its text, so the
  // correction passes every code check; the challengers are told that a correction a human asked for
  // is not self-made, and only they can refute it.
  const dir = await mkdtemp(join(tmpdir(), 'sonah-h1f-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'synthetic.jsonl');
  let n = 0;
  const base = () => ({ uuid: `u${++n}`, parentUuid: n > 1 ? `u${n - 1}` : null, sessionId: 'synthetic-h1f',
    cwd: '/srv/x', timestamp: `2026-09-29T10:00:${String(n).padStart(2, '0')}Z`, version: '2.0.0', isSidechain: false });
  const user = (content) => ({ ...base(), type: 'user', message: { role: 'user', content } });
  const asst = (content) => ({ ...base(), type: 'assistant', message: { role: 'assistant', content } });
  const bash = (id, cmd) => ({ type: 'tool_use', id, name: 'Bash', input: { command: cmd } });
  const out = (id, text, isError = false) => ({ type: 'tool_result', tool_use_id: id, content: text, is_error: isError });
  const rows = [
    user('SYNTHETIC_H1F_ASK: make the synthetic replay report no gaps.'),
    asst([{ type: 'text', text: 'SYNTHETIC_H1F_CLAIM: this change clears the gap.' }, bash('t1', 'node /srv/x/replay.js')]),
    user([out('t1', 'SYNTHETIC_H1F_REPLAY: gaps=3', true)]),
    asst([bash('t2', 'node /srv/x/other.js')]),
    user([out('t2', "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nSYNTHETIC_H1F_HUMAN: the replay still shows gaps=3, fix the parser first", true)]),
    asst([bash('t3', 'node /srv/x/replay.js')]),
    user([out('t3', 'SYNTHETIC_H1F_REPLAY: gaps=0')]),
    asst([{ type: 'text', text: 'SYNTHETIC_H1F_CORRECTED: the replay now reports gaps=0 after the fix.' }]),
  ];
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const adapted = sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: 'synthetic-h1f' });
  const having = (marker, kind) => adapted.events.filter((event) => event.kind === kind
    && adapted.sourcesFor(event).some((source) => source.text.includes(marker)));
  const [rejection] = having('SYNTHETIC_H1F_HUMAN', 'observation');
  const [failedReplay] = having('gaps=3', 'observation').filter((event) => event !== rejection);
  assert.ok(rejection && failedReplay, 'premise: both failed results were recorded');
  // The limit: the rejection is recorded exactly like any failed tool result, in the claim's turn.
  assert.deepEqual(Object.keys(rejection).sort(), Object.keys(failedReplay).sort());
  assert.equal(rejection.result, 'failed');
  assert.ok(!Object.hasOwn(rejection, 'authority'));
  assert.equal(adapted.events.filter((event) => event.kind === 'instruction').length, 1, 'no second human instruction');
  const [stated] = having('SYNTHETIC_H1F_CLAIM', 'commentary');
  const [fixed] = having('gaps=0', 'observation');
  const [accurate] = having('SYNTHETIC_H1F_CORRECTED', 'commentary');
  assert.equal(new Set([stated, rejection, fixed, accurate].map((event) => event.turn)).size, 1);
  const adaptedClaim = { text: CLAIM_TEXT, stated: receipt(stated.id, 'commentary', 'this change clears the gap.'),
    contradictedBy: receipt(failedReplay.id, 'observation', 'SYNTHETIC_H1F_REPLAY: gaps=3'),
    resolvedBy: { observation: receipt(fixed.id, 'observation', 'SYNTHETIC_H1F_REPLAY: gaps=0'),
      statement: receipt(accurate.id, 'commentary', 'the replay now reports gaps=0 after the fix.') } };
  const run = (resolutionVerdict) => reviewRun.runReview({ session: adapted, pr: null, reviewScope: 'session-only',
    judge: async (request) => (request.challenge
      ? { votes: request.challenge.items.map((item) => (item.type === 'resolution' && resolutionVerdict === 'refuted'
        ? vote(item.key, 'refuted', receipt(rejection.id, 'observation', 'SYNTHETIC_H1F_HUMAN: the replay still shows gaps=3'))
        : vote(item.key, 'not-refuted', item.type === 'resolution' ? adaptedClaim.resolvedBy.observation : adaptedClaim.stated))) }
      : narrativeOf([adaptedClaim])) });
  // Every code check passes: the documented limit. Upheld, it reads FYI.
  assert.deepEqual(statuses(await run('not-refuted')), ['FYI/self_corrected']);
  // A challenger that reads the rejection refutes the resolution, and the contradiction stays DECIDE.
  const refuted = await run('refuted');
  assert.deepEqual(statuses(refuted), ['DECIDE']);
  assert.equal(refuted.counts.resolutions.rejected.refuted, 1);
});

// ---- a deeply nested resolvedBy never crashes a review ----------------------------------------------

const nested = (depth, leaf = 1) => JSON.parse(`${'{"a":'.repeat(depth)}${JSON.stringify(leaf)}${'}'.repeat(depth)}`);

test('M33 H1 refreeze: a deeply nested resolvedBy is a malformed resolution: no crash, the claim is kept DECIDE', async () => {
  for (const depth of [17, 64, 20000]) {
    const seen = [];
    const report = await review([claim(nested(depth))], upholdAll, { seen });
    assert.deepEqual(statuses(report), ['DECIDE'], String(depth));
    assert.equal(report.counts.resolutions.rejected.malformed, 1, String(depth));
    assert.ok(!challengeItemsOf(seen).some((item) => Object.hasOwn(item.candidate, 'resolvedBy')), String(depth));
  }
  // A rating hidden below the scan bound is inside a resolution that is discarded as malformed.
  const hidden = await review([claim(nested(40, { confidence: 'high' }))], upholdAll);
  assert.deepEqual(statuses(hidden), ['DECIDE']);
  assert.equal(hidden.counts.resolutions.rejected.malformed, 1);
  // A cyclic value (no transport produces one, but a direct caller can) is bounded too.
  const cyclic = { observation: FIXED };
  cyclic.statement = cyclic;
  const core = reviewRun.claimCore(claim(cyclic));
  assert.ok(!Object.hasOwn(core, 'resolvedBy'));
});

const GREET = 'src/greet.js';
const GREET_DIFF = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/greet.js', '@@ -0,0 +1,1 @@', '+export default "SYNTHETIC_H1F_GREETING";', ''].join('\n');
const GREET_PR = { repo: { host: 'github.com', id: '331' }, number: 331, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
  files: [{ path: GREET, change: 'added', contentState: 'complete' }] };
const jointJudge = (claims, voteFor = upholdAll) => async (request) => {
  const base = { ...EMPTY, codeFindings: [], sessionFindings: [] };
  if (request.challenge) return { votes: request.challenge.items.map((item) => voteFor(item, request)).filter(Boolean) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
  if (request.label === 'code+narrative:w1') return { ...base, reviewedFiles: [], claims };
  return { ...base, reviewedFiles: [] };
};

test('M33 H1 refreeze: the combined route reads a deeply nested resolvedBy the same way', async () => {
  const report = await runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF,
    judge: jointJudge([claim(nested(20000))]) });
  assert.deepEqual(statuses(report), ['DECIDE']);
  assert.equal(report.counts.resolutions.rejected.malformed, 1);
  assert.equal(report.rejectedNarrative, 0, 'the claim was read: only its resolution was rejected');
});

test('M33 H1 refreeze: the combined route challenges the resolution apart and keeps a refuted one DECIDE', async () => {
  const upheld = await runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF, judge: jointJudge([claim(RESOLVED)]) });
  assert.deepEqual(statuses(upheld), ['FYI/self_corrected']);
  const refuted = await runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF,
    judge: jointJudge([claim(RESOLVED)], byType('refuted')) });
  assert.deepEqual(statuses(refuted), ['DECIDE']);
  assert.equal(refuted.counts.resolutions.rejected.refuted, 1);
  // The code-review funnel counts the contradicted claim once, not its resolution item.
  assert.equal(refuted.findingFunnel.narrativeContradictedClaims.proposed, 1);
});

// ---- H1b: the stage review's blocking findings --------------------------------------------------------
//
// 1. A deeply nested value the model proposed never reaches the report: the report must serialize, or
//    the CLI's saveReport / store.save throws and the whole run fails.
// 2. Resolution items are challenged in a run of their own, never in a batch with a contradiction, so a
//    challenger that mis-keys only the resolution's vote can never discard the contradiction's own vote
//    (batchVotes invalidates a whole batch pass on an unknown key). Several resolutions of one window
//    share that run's batches (m33-i3-same-class-batching.test.js).
// 3. The combined route reads a claim whose resolvedBy hides a deep value beside a rating key without
//    losing the window.
// 4. A model rating inside a resolvedBy discards the RESOLUTION whole, as malformed, never the
//    contradiction: "The contradiction item decides whether a finding exists, exactly as without a
//    resolution", whatever depth the rating sits at.

const serializes = (report) => { JSON.stringify(report); return true; };
const ratedDeep = (depth) => { const value = { x: nested(depth) }; value.confidence = 'high'; return value; };

test('M33 H1b: a deeply nested resolvedBy never reaches the report, so the report serializes', async () => {
  for (const depth of [64, 7000, 20000]) {
    const report = await review([claim(nested(depth))], upholdAll);
    assert.deepEqual(statuses(report), ['DECIDE'], String(depth));
    assert.ok(serializes(report), `${depth}: the report serializes`);
    const [kept] = report.windowResults[0].narrative.claims;
    assert.equal(kept.resolvedBy, 'malformed', `${depth}: the window keeps what code read of it, a closed reason`);
    assert.equal(report.counts.resolutions.rejected.malformed, 1, String(depth));
  }
  // A shaped pair is kept as the pair, and nothing else.
  const valid = await review([claim({ ...RESOLVED })], upholdAll);
  assert.deepEqual(valid.windowResults[0].narrative.claims[0].resolvedBy, { observation: FIXED, statement: ACCURATE });
});

test('M33 H1b: a proposal outside the response contract is recorded bounded, whatever its depth', async () => {
  const deep = { dimension: 'synthetic', chosen: 'synthetic', actions: ['A2'], valueReceipt: nested(20000) };
  const report = await reviewRun.runReview({ session: session(), pr: null, reviewScope: 'session-only',
    judge: async (request) => (request.challenge ? { votes: request.challenge.items.map(upholdAll) }
      : request.window.index === 0 ? { ...narrativeOf([claim()]), decisions: [deep] } : EMPTY) });
  assert.deepEqual(statuses(report), ['DECIDE']);
  assert.ok(serializes(report), 'the report serializes');
  assert.deepEqual(report.windowResults[0].challenge.rejected.map((r) => [r.key, r.reason]), [['decisions:0', 'kind_rejected']]);
  assert.equal(report.sessionReview, 'incomplete', 'a proposal no check could read still leaves its window incomplete');
});

test('M33 H1b: a resolution is challenged in calls of its own; a mis-keyed resolution vote never costs the contradiction', async () => {
  // The challenger upholds everything and mis-keys only its vote on the resolution item.
  const mangled = (item) => vote(item.type === 'resolution' ? item.key.replace(':resolution', '-resolution') : item.key,
    'not-refuted', STATED);
  const bare = await review([claim()], mangled);
  assert.deepEqual(statuses(bare), ['DECIDE'], 'premise');
  const seen = [];
  const report = await review([claim(RESOLVED)], mangled, { seen });
  assert.deepEqual(statuses(report), ['DECIDE'], 'the contradiction decides exactly as without a resolution');
  assert.equal(report.sessionStatus, 'DECIDE');
  assert.equal(report.counts.resolutions.rejected.unexecuted, 1, 'the resolution that never got a vote is counted');
  const requests = seen.filter((request) => request.challenge);
  assert.ok(requests.some((request) => request.challenge.items.some((item) => item.type === 'resolution')), 'premise');
  for (const request of requests) {
    const types = new Set(request.challenge.items.map((item) => item.type));
    assert.ok(!types.has('resolution') || types.size === 1, 'a resolution item never shares a call with an item of another type');
  }
  // Upheld in its own calls, it still publishes FYI.
  assert.deepEqual(statuses(await review([claim(RESOLVED)], upholdAll)), ['FYI/self_corrected']);
});

test('M33 H1b: a model rating anywhere in a resolvedBy discards the resolution as malformed, never the contradiction', async () => {
  const cases = {
    ratedPair: { ...RESOLVED, confidence: 'high' },
    ratedReceipt: { observation: { ...FIXED, severity: 'low' }, statement: ACCURATE },
    ratedCrossTurn: { ...CODE_REJECTED.cross_turn, confidence: 0.2 },
    ratedDeepSibling: ratedDeep(20000),
    ratedPastAnyBound: nested(40, { confidence: 'high' }),
  };
  for (const [name, resolvedBy] of Object.entries(cases)) {
    const seen = [];
    const report = await review([claim(resolvedBy)], upholdAll, { seen });
    assert.deepEqual(statuses(report), ['DECIDE'], name);
    assert.equal(report.sessionStatus, 'DECIDE', name);
    assert.equal(report.sessionReview, 'complete', `${name}: the claim was read`);
    assert.equal(report.claimsRejected, 0, name);
    assert.equal(report.counts.resolutions.rejected.malformed, 1, name);
    assert.ok(!challengeItemsOf(seen).some((item) => item.type === 'resolution'), `${name}: never put to the challengers`);
    assert.ok(serializes(report), name);
  }
});

test('M33 H1b: the combined route keeps its window when a resolvedBy hides a deep value beside a rating', async () => {
  const truth = claim();
  for (const depth of [3, 20000]) {
    const other = claim(ratedDeep(depth), { text: 'Another synthetic claim.' });
    const report = await runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF, judge: jointJudge([truth, other]) });
    assert.deepEqual(report.windowFailures, [], String(depth));
    assert.deepEqual(statuses(report), ['DECIDE'], String(depth));
    assert.equal(report.sessionStatus, 'DECIDE', String(depth));
    assert.equal(report.rejectedNarrative, 0, `${depth}: both claims were read`);
    assert.equal(report.counts.resolutions.rejected.malformed, 1, String(depth));
    assert.ok(serializes(report), String(depth));
  }
  // A deep proposal in any other channel is read as outside the contract, and the window is kept.
  const deep = { dimension: 'synthetic', chosen: 'synthetic', actions: ['A2'], valueReceipt: nested(20000) };
  const judge = async (request) => {
    const answer = await jointJudge([truth])(request);
    return request.label === 'code+narrative:w1' ? { ...answer, decisions: [deep] } : answer;
  };
  const report = await runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF, judge });
  assert.deepEqual(report.windowFailures, []);
  assert.deepEqual(statuses(report), ['DECIDE']);
  assert.equal(report.rejectedNarrative, 1);
  assert.ok(serializes(report));
});
