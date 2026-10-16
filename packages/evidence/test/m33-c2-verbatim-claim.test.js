// M33 C2 (C-06 "M33 the verbatim quote decides", `sonah.challenge/9`). Every challenge of a claim — a chat claim
// (the DECIDE-bound three-pass run of every profile, and a dossier batch if one ever holds it), its support, its
// resolution, and a written statement — judges the agent's VERBATIM quoted words against the cited result. The
// challenger is shown the quote as THE claim (`claim`, first) and the narrative model's paraphrase only as
// `reviewersReading` (last), never as `text`; a batch holding such an item is sent one fixed sentence of code's
// words after the system prompt (CLAIM_WORDS_NOTE): a contradiction must hold against the verbatim words, and a
// challenger refutes one that holds only against wording the quote does not contain, citing the agent's words.
//
// The defect: the narrative model's claim text can widen the agent's words (a statement that one kind of explanation
// is absent becomes one that no explanation at all is given; a list of pushed commits becomes "complete and
// working"), and challengers then uphold a contradiction that holds only against the paraphrase. Both are reproduced here as synthetic statements, with a deterministic fake challenger that follows
// the instructions it is sent: it reads only the request bytes (system and prompt), judges the words the
// instructions name as the claim, and refutes, citing the agent's own words, what the result does not show false.
// A contradiction that holds against the verbatim words still publishes DECIDE, whatever the paraphrase says.
// M33 C2 repair (m33-c2-quote-repair.test.js): the words shown are code's — what the item's publication grounds — beside
// the whole text they are quoted from (`context`); every quote here is exact, so its bytes are kept.
//
// Synthetic sessions (/srv/q paths), synthetic judges: no recording, no model call. Nothing prints.
import { readingStableIds } from './m35-windows-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as challenge from '../src/challenge.js';
import * as reviewRun from '../src/run-review.js';
import * as written from '../src/written.js';

const SESSION_KEY = 'sess-c2-verbatim';
const TEXT = {
  ask: 'SYNTHETIC_Q_ASK: audit the synthetic notes, fix the parser and push the result.',
  grep: 'grep -n exit /srv/q/NOTES.md',
  grepOut: 'SYNTHETIC_Q_GREP: 12: (the run stops early; the exit is handled elsewhere)',
  exitSaid: 'SYNTHETIC_Q_EXIT: No exit explanation anywhere in the notes.',
  notes: 'SYNTHETIC_Q_NOTE: the parser handles empty input.\nSYNTHETIC_Q_NOTE2: all parser tests pass.\n',
  wrote: 'SYNTHETIC_Q_WROTE: file created',
  test: 'node /srv/q/test.js',
  testOut: 'SYNTHETIC_Q_TESTS: 2 failing',
  pushSaid: 'SYNTHETIC_Q_PUSHED: Pushed 3f2a1c0 (fix parser) and 9b8e7d6 (add tests) to origin/main.',
  passSaid: 'SYNTHETIC_Q_PASS: all parser tests pass.',
  cleanSaid: 'SYNTHETIC_Q_CLEAN: the lint is clean and the build is green.',
  lintedSaid: 'SYNTHETIC_Q_LINTED: the lint is clean.',
  lint: 'node /srv/q/lint.js',
  lintOut: 'SYNTHETIC_Q_LINT: 0 warnings',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const command = (id, key) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: whole(key), input: [], changes: [], ...T1 });
const result = (id, invocation, key, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(key),
  sourceOfResult: 'native', ...T1, ...over });
const said = (id, key) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: whole(key), ...T1 });

/** One human turn, one review window: every statement this file judges, in session order. */
function session() {
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    command('A1', 'grep'), result('A1-r', 'A1', 'grepOut'),
    said('C1', 'exitSaid'),
    { id: 'A4', kind: 'invocation', callKey: 'A4', tool: 'Write', operation: 'write', paths: [{ path: '/srv/q/NOTES.md' }],
      command: [], input: [], changes: [{ path: '/srv/q/NOTES.md', diff: [], before: [], after: whole('notes') }], ...T1 },
    result('A4-r', 'A4', 'wrote'),
    command('A2', 'test'), result('A2-r', 'A2', 'testOut', { result: 'failed', exitCode: 1 }),
    said('C2', 'pushSaid'),
    said('C3', 'passSaid'),
    said('C4', 'cleanSaid'),
    said('C5', 'lintedSaid'),
    command('A5', 'lint'), result('A5-r', 'A5', 'lintOut'),
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT }, events });
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const GREP = receipt('A1-r', 'observation', TEXT.grepOut);
const TESTS = receipt('A2-r', 'observation', TEXT.testOut);
const LINT = receipt('A5-r', 'observation', TEXT.lintOut);
/** Each claim: what the agent said (verbatim), what the narrative model wrote of it (`text`), and the result. */
const CLAIMS = Object.freeze({
  // The paraphrase widened the agent's words: the result shows an allusion to the exit, not an explanation of it.
  exit: { text: 'The agent said the notes hold no explanation of, or allusion to, the exit.',
    stated: receipt('C1', 'commentary', 'No exit explanation anywhere in the notes.'), contradictedBy: GREP },
  // The paraphrase turned a list of pushed commits into "complete and working"; the failing run contradicts only that.
  pushed: { text: 'The agent said the work is complete and working.',
    stated: receipt('C2', 'commentary', 'Pushed 3f2a1c0 (fix parser) and 9b8e7d6 (add tests) to origin/main.'),
    contradictedBy: TESTS },
  // A true contradiction, whose paraphrase NARROWED the agent's words: the verbatim words decide it, so it stays DECIDE.
  pass: { text: 'The agent reported on the parser suite.',
    stated: receipt('C3', 'commentary', 'all parser tests pass.'), contradictedBy: TESTS },
  // Supports: the paraphrase narrowed the claim (the lint run cannot confirm the build), and widened it.
  narrowedSupport: { text: 'The agent said the lint is clean.',
    stated: receipt('C4', 'commentary', 'the lint is clean and the build is green.'), contradictedBy: null, supportedBy: LINT },
  widenedSupport: { text: 'The agent said the lint and the build are clean.',
    stated: receipt('C5', 'commentary', 'the lint is clean.'), contradictedBy: null, supportedBy: LINT },
});
const WRITTEN = Object.freeze({
  // The notes say the parser handles empty input; the paraphrase says they claim the tests pass.
  paraphrased: { text: 'The notes say the parser tests pass.',
    stated: receipt('A4', 'code', 'SYNTHETIC_Q_NOTE: the parser handles empty input.'), contradictedBy: TESTS },
  // The notes do say every parser test passes; the paraphrase is vaguer, and the failing run contradicts the words.
  verbatim: { text: 'The notes describe the parser.',
    stated: receipt('A4', 'code', 'SYNTHETIC_Q_NOTE2: all parser tests pass.'), contradictedBy: TESTS },
});
const narrativeOf = ({ claims = [], writtenClaims = [], decisions = [] } = {}) => ({ decisions, pivots: [], requirements: [],
  claims: structuredClone(claims), writtenClaims: structuredClone(writtenClaims) });

// ---- the fake challenger: it follows the instructions it is sent, and reads nothing but the request bytes --------

/** What each recorded result shows false — the words a claim must contain for that result to contradict it. */
const SHOWS_FALSE = Object.freeze({ 'A1-r': /allusion|alluded/i, 'A2-r': /tests pass|working/i });
/** What each recorded result confirms, and what it cannot: a claim it confirms says the first and nothing of the second. */
const CONFIRMS = Object.freeze({ 'A5-r': { says: /lint is clean/i, beyond: /build/i } });

const CANDIDATES = '\n# Candidates to challenge\n';
/** The candidates a request shows, exactly as sent. */
// D71 (S2): a session-only batch gives its candidates one per line; a combined one, one JSON array.
const shownItems = (request) => {
  const tail = request.prompt.slice(request.prompt.lastIndexOf(CANDIDATES) + CANDIDATES.length);
  return tail.startsWith('[') ? JSON.parse(tail) : tail.split('\n').filter(Boolean).map((line) => JSON.parse(line));
};
/** The words a challenger following the request's instructions judges as the claim: the verbatim words when the
 *  request names them as THE claim (a `claim` field and code's fixed sentence in the system prompt); otherwise the
 *  claim as the candidate words it — the narrative model's `text`, the reading the real challengers judged. */
const instructed = (request, shown) => typeof challenge.CLAIM_WORDS_NOTE === 'string'
  && request.system.includes(challenge.CLAIM_WORDS_NOTE) && typeof shown.claim === 'string';
const wordsJudged = (request, shown) => (instructed(request, shown) ? shown.claim : shown.text);
const vote = (key, verdict, cited) => ({ key, verdict, explanation: 'Synthetic.', receipts: [cited] });

/** One vote, by the instructions: uphold only what the judged words make true of the cited result; otherwise refute,
 *  citing the agent's own words (the stated receipt) — the counterevidence a paraphrase-only contradiction leaves. */
function follow(request, { key, type, candidate: shown }) {
  const words = String(wordsJudged(request, shown) ?? '');
  if (type === 'support') {
    const rule = CONFIRMS[shown.supportedBy.eventId];
    return rule.says.test(words) && !rule.beyond.test(words) ? vote(key, 'not-refuted', shown.supportedBy)
      : vote(key, 'refuted', shown.stated);
  }
  if (!shown.contradictedBy) return vote(key, 'not-refuted', shown.stated);
  return SHOWS_FALSE[shown.contradictedBy.eventId]?.test(words) ? vote(key, 'not-refuted', shown.contradictedBy)
    : vote(key, 'refuted', shown.stated);
}

function judgeWith(narrative, seen = []) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return structuredClone(narrative);
    return { votes: shownItems(request).map((item) => (item.type === 'decision'
      ? vote(item.key, 'not-refuted', receipt('A2', 'action', TEXT.test)) : follow(request, item))) };
  };
}
const PROFILES = Object.freeze([undefined, 'm33-lean']);
// M35: the judge reads each request with its window's aliases written back as stable ids (m35-windows-fixture.js).
const run = (narrative, speedProfile, seen = []) => {
  const base = session();
  return reviewRun.runReview({ session: base, pr: null, reviewScope: 'session-only', ...(speedProfile ? { speedProfile } : {}),
    judge: readingStableIds(base, judgeWith(narrative, seen), { speedProfile }) });
};
const decides = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted')
  .map((f) => [f.receipts.find((r) => r.role === 'commentary')?.eventId, f.status]);
const claimResults = (report) => report.windowResults[0].challenge.results.filter((r) => r.type === 'claim');
const nameOf = (profile) => profile ?? 'standard';

// ---- what the challenger is shown -----------------------------------------------------------------------------

test('M33 C2: a claim item shows the verbatim quote as THE claim and the paraphrase only as the reviewer\'s reading', async () => {
  for (const profile of PROFILES) {
    const seen = [];
    await run(narrativeOf({ claims: [CLAIMS.exit] }), profile, seen);
    const asked = seen.filter((request) => request.challenge);
    assert.equal(asked.length, 3, `${nameOf(profile)}: the claim is asked three times`);
    for (const request of asked) {
      const [shown] = shownItems(request);
      assert.equal(shown.type, 'claim');
      assert.deepEqual(Object.keys(shown.candidate), ['proposition', 'claim', 'context', 'stated', 'contradictedBy', 'reviewersReading'],
        `${nameOf(profile)}: the verbatim words first, the reading last`);
      assert.equal(shown.candidate.claim, CLAIMS.exit.stated.quote, 'THE claim is the quote, verbatim');
      // M33 C2 repair: the words as code grounded them — an exact quote keeps its bytes — and the message they are from.
      assert.deepEqual(shown.candidate.stated, CLAIMS.exit.stated, 'the receipt it is quoted from, unchanged');
      assert.equal(shown.candidate.context, TEXT.exitSaid, 'the whole message the words are quoted from');
      assert.equal(shown.candidate.reviewersReading, CLAIMS.exit.text, 'the paraphrase is the reviewer\'s reading');
      assert.ok(!Object.hasOwn(shown.candidate, 'text'), 'and never shown as the claim\'s own words');
      assert.equal(request.system, challenge.checklistSystem(request.challenge.items.map((item) => item.type)),
        'the system prompt, then code\'s one fixed sentence');
      // The internal item is untouched: identity, binding, grounding and publication read the claim as proposed.
      assert.deepEqual(request.challenge.items[0].candidate, { text: CLAIMS.exit.text, stated: CLAIMS.exit.stated,
        contradictedBy: CLAIMS.exit.contradictedBy });
    }
  }
});

test('M33 C2: code\'s fixed sentence says the verbatim words decide, and how to refute a paraphrase-only contradiction', () => {
  const note = challenge.CLAIM_WORDS_NOTE;
  assert.equal(typeof note, 'string');
  const flat = note.replace(/\s+/g, ' ');
  for (const phrase of [/"claim"/, /verbatim words/, /"reviewersReading"/, /paraphrase/,
    /must hold against the verbatim words/, /never widens/, /vote refuted/, /cite the agent's verbatim words/,
    /support or a correction holds only when/])
    assert.match(flat, phrase);
  assert.ok(!challenge.challengeSystem().includes(note), 'a separate sentence, never inside the shared system prompt');
  assert.deepEqual([...challenge.CLAIM_ITEM_TYPES], ['claim', 'support', 'resolution', 'written']);
  assert.ok(Object.isFrozen(challenge.CLAIM_ITEM_TYPES));
  assert.equal(written.WRITTEN_ITEM_TYPE, 'written', 'the written statements\' item type is one of them');
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
  assert.equal(reviewRun.runProfile('session-only').challenge.version, 'sonah.challenge/44');
});

// ---- paraphrase-only contradictions: never DECIDE, in every profile ----------------------------------------------

test('M33 C2: a contradiction that holds only against the paraphrase is refuted and publishes no DECIDE (both profiles)', async () => {
  for (const profile of PROFILES) {
    const report = await run(narrativeOf({ claims: [CLAIMS.exit, CLAIMS.pushed] }), profile);
    const name = nameOf(profile);
    assert.deepEqual(decides(report), [], `${name}: no DECIDE`);
    assert.notEqual(report.sessionStatus, 'DECIDE', name);
    // A vote that refutes because the contradiction depends on wording not in the quote is a refutation, counted
    // as one: valid (its receipt — the agent's own words — grounded), resolved, never uncertain or unsettled.
    for (const result of claimResults(report)) {
      assert.equal(result.votes.length, 3, name);
      assert.ok(result.votes.every((v) => v.valid === true && v.answered === true && v.verdict === 'refuted'), name);
      assert.ok(result.votes.every((v) => v.receipts.every((r) => r.role === 'commentary'
        && r.eventId === result.candidate.stated.eventId)), `${name}: each cites the agent's verbatim words`);
      assert.equal(result.resolved, true, name);
      assert.equal(result.survived, false, name);
    }
    assert.equal(report.challenge.refutedItems, 2, `${name}: two resolved refutations`);
    assert.equal(report.withheld.unsettled, 0, `${name}: nothing left unsettled`);
    assert.equal(report.sessionReview, 'complete', `${name}: a check that ran`);
    assert.equal(report.promises.length, 0, `${name}: a refuted claim is no promise either`);
  }
});

// ---- verbatim contradictions: DECIDE, in every profile, whatever the paraphrase says ------------------------------

test('M33 C2: a contradiction that holds against the verbatim words publishes DECIDE (both profiles)', async () => {
  for (const profile of PROFILES) {
    const name = nameOf(profile);
    const report = await run(narrativeOf({ claims: [CLAIMS.pass] }), profile);
    assert.deepEqual(decides(report), [['C3', 'DECIDE']], `${name}: the narrowed paraphrase does not hide it`);
    assert.equal(report.sessionStatus, 'DECIDE', name);
    const [result] = claimResults(report);
    assert.ok(result.votes.every((v) => v.valid && v.verdict === 'not-refuted'), name);
    // Beside the paraphrase-only ones, only the verbatim contradiction is published.
    const mixed = await run(narrativeOf({ claims: [CLAIMS.exit, CLAIMS.pushed, CLAIMS.pass] }), profile);
    assert.deepEqual(decides(mixed), [['C3', 'DECIDE']], `${name}: only the true contradiction`);
    assert.equal(mixed.challenge.refutedItems, 2, name);
    assert.equal(mixed.sessionStatus, 'DECIDE', name);
  }
});

// ---- support and written statements: the verbatim words decide them too ------------------------------------------

test('M33 C2: a support is judged against the verbatim claim — a narrowed reading never makes it verified', async () => {
  for (const profile of PROFILES) {
    const name = nameOf(profile);
    const seen = [];
    const report = await run(narrativeOf({ claims: [CLAIMS.narrowedSupport, CLAIMS.widenedSupport] }), profile, seen);
    assert.deepEqual(report.promises.map((p) => [p.stated.eventId, p.status]), [['C4', 'open'], ['C5', 'verified']], name);
    assert.equal(report.counts.promiseSupport.rejected.refuted, 1, `${name}: the narrowed one's support was refuted`);
    const supports = seen.filter((request) => request.challenge && shownItems(request).every((item) => item.type === 'support'));
    assert.equal(supports.length, 3, `${name}: the support run, three passes`);
    for (const request of supports) {
      for (const shown of shownItems(request)) {
        assert.deepEqual(Object.keys(shown.candidate), ['proposition', 'claim', 'context', 'stated', 'supportedBy', 'reviewersReading'], name);
        assert.equal(shown.candidate.claim, shown.candidate.stated.quote, name);
        assert.equal(shown.candidate.context, TEXT[shown.candidate.stated.eventId === 'C4' ? 'cleanSaid' : 'lintedSaid'], name);
      }
      assert.equal(request.system, challenge.checklistSystem(request.challenge.items.map((item) => item.type)), name);
    }
  }
});

test('M33 C2: a written statement is judged against its verbatim written words (both profiles)', async () => {
  for (const profile of PROFILES) {
    const name = nameOf(profile);
    const seen = [];
    const report = await run(narrativeOf({ writtenClaims: [WRITTEN.paraphrased, WRITTEN.verbatim] }), profile, seen);
    assert.deepEqual(report.writtenClaims.map((w) => [w.stated.quote, w.label]), [
      [WRITTEN.paraphrased.stated.quote, 'unverified'], [WRITTEN.verbatim.stated.quote, 'contradicted']], name);
    const asked = seen.filter((request) => request.challenge && shownItems(request).some((item) => item.type === 'written'));
    assert.ok(asked.length > 0, name);
    for (const request of asked) {
      for (const shown of shownItems(request)) {
        assert.deepEqual(Object.keys(shown.candidate), ['proposition', 'claim', 'context', 'stated', 'contradictedBy', 'reviewersReading'], name);
        assert.equal(shown.candidate.claim, shown.candidate.stated.quote, name);
        assert.equal(shown.candidate.context, TEXT.notes, `${name}: the body the write wrote`);
      }
      assert.equal(request.system, challenge.checklistSystem(request.challenge.items.map((item) => item.type)), name);
    }
  }
});

// ---- which request bytes move, and which do not ---------------------------------------------------------------------

test('M33 C2: a batch holding no claim item is sent exactly the bytes /8 sent — the lean single-pass dossier included', async () => {
  const decision = { dimension: 'SYNTHETIC_Q_RUNNER', chosen: 'Run the suite with node', value: null, valueReceipt: null,
    actions: ['A2'], stated: null, constrainedBy: null };
  const seen = [];
  await run(narrativeOf({ claims: [CLAIMS.pass], decisions: [decision] }), 'm33-lean', seen);
  const once = seen.find((request) => request.label === 'challenge:w1:t1:b1:p1');
  assert.ok(once, 'the single-pass dossier run was asked');
  // D71 (S2): a session-only batch is sent the core and its own types' notes — no claim note when it
  // holds no claim — and its candidate as proposed, after the proposition it is judged on.
  assert.equal(once.system, challenge.checklistSystem(['decision'], { dossier: true }), 'no claim note');
  assert.ok(!once.system.includes(challenge.CLAIM_WORDS_NOTE));
  const [shown] = shownItems(once);
  const proposition = challenge.CHECKLIST_PROPOSITIONS.decision;
  assert.deepEqual(shown, { key: 'decisions:0', type: 'decision', candidate: { proposition, ...decision } },
    'its candidate as proposed, after its proposition');
  assert.ok(once.prompt.endsWith(`${CANDIDATES}${JSON.stringify({ key: 'decisions:0', type: 'decision', candidate: { proposition, ...decision } })}`));
});

test('M33 C2: challengeItems shows every claim-class item the same way on every route — whole evidence or dossier', async () => {
  // M33 C2 repair: each with code's grounded words (`verbatim`) — here the exact quotes themselves, and a context.
  const words = (stated) => ({ quote: stated.quote, context: `SYNTHETIC CONTEXT: ${stated.quote}` });
  const items = [
    { key: 'claims:0', type: 'claim', candidate: { text: 'SYNTHETIC reading', stated: CLAIMS.pass.stated, contradictedBy: TESTS },
      verbatim: words(CLAIMS.pass.stated) },
    { key: 'claims:1:support', type: 'support', candidate: { text: 'SYNTHETIC reading', stated: CLAIMS.widenedSupport.stated,
      supportedBy: LINT }, verbatim: words(CLAIMS.widenedSupport.stated) },
    { key: 'claims:0:resolution', type: 'resolution', candidate: { text: 'SYNTHETIC reading', stated: CLAIMS.pass.stated,
      contradictedBy: TESTS, resolvedBy: { observation: LINT, statement: CLAIMS.widenedSupport.stated } },
    verbatim: words(CLAIMS.pass.stated) },
    { key: 'writtenClaims:0', type: 'written', candidate: { text: 'SYNTHETIC reading', stated: WRITTEN.verbatim.stated,
      contradictedBy: TESTS }, verbatim: words(WRITTEN.verbatim.stated) },
  ];
  const expected = {
    claim: ['claim', 'context', 'stated', 'contradictedBy', 'reviewersReading'],
    support: ['claim', 'context', 'stated', 'supportedBy', 'reviewersReading'],
    resolution: ['claim', 'context', 'stated', 'contradictedBy', 'resolvedBy', 'reviewersReading'],
    written: ['claim', 'context', 'stated', 'contradictedBy', 'reviewersReading'],
  };
  const dossier = () => ({ evidence: 'SYNTHETIC DOSSIER', verifyReceipt: (r) => ({ ok: true, receipt: r }) });
  for (const route of [{}, { dossier }]) {
    for (const item of items) {
      const seen = [];
      const out = await challenge.challengeItems({ items: [item], evidence: 'SYNTHETIC WINDOW EVIDENCE',
        verifyReceipt: (r) => ({ ok: true, receipt: r }), passes: 1, requiredSurvivals: 1, ...route,
        judge: async (request) => { seen.push(request); return { votes: [vote(item.key, 'refuted', item.candidate.stated)] }; } });
      const [shown] = shownItems(seen[0]);
      assert.deepEqual(Object.keys(shown.candidate), expected[item.type], item.type);
      assert.equal(shown.candidate.claim, item.candidate.stated.quote, item.type);
      assert.equal(shown.candidate.context, item.verbatim.context, item.type);
      assert.equal(shown.candidate.reviewersReading, 'SYNTHETIC reading', item.type);
      assert.equal(seen[0].system, [challenge.challengeSystem(), ...(route.dossier ? [challenge.DOSSIER_NOTE] : []),
        challenge.CLAIM_WORDS_NOTE].join('\n'), item.type);
      // A refutation citing the agent's own words is a refutation: valid, resolved, refuted.
      assert.deepEqual(out.rejected, [{ key: item.key, type: item.type, resolved: true, executionComplete: true,
        reason: 'kind_rejected' }], item.type);
    }
  }
  // An item that is not of a claim class is shown exactly as proposed.
  const other = { key: 'decisions:0', type: 'decision', candidate: { dimension: 'SYNTHETIC', text: 'kept' } };
  const seen = [];
  await challenge.challengeItems({ items: [other], evidence: 'E', verifyReceipt: () => ({ ok: false }), passes: 1,
    requiredSurvivals: 1, judge: async (request) => { seen.push(request); return { votes: [] }; } });
  assert.deepEqual(shownItems(seen[0])[0].candidate, other.candidate, other.key);
  // M33 C2 repair: a claim item that quotes nothing has no words code grounded, and is never asked (fail closed).
  let calls = 0;
  const bare = await challenge.challengeItems({ items: [{ key: 'claims:0', type: 'claim', candidate: { text: 'SYNTHETIC reading',
    stated: null } }], evidence: 'E', verifyReceipt: () => ({ ok: false }), passes: 1, requiredSurvivals: 1,
  judge: async () => { calls++; return { votes: [] }; } });
  assert.equal(calls, 0);
  assert.equal(bare.rejected[0].reason, 'unreviewed_scope');
});
