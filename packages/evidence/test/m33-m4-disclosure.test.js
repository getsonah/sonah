// M33 brittleness M4: an `edit_under_negative_requirement` finding of the combined route became FYI ("disclosed")
// whenever any of its receipts had role commentary — a model citing the agent's own words to show what happened turned
// a breach into FYI. Whether the agent told the human is meaning, so it is now a proposition of its own: the joint
// answer's optional `disclosedBy` (the agent's statement recorded after the action, quoted verbatim), checked by code
// (ledger.js DISCLOSURE_REJECTIONS) and judged by the challengers in code's fixed words (challenge.js
// DISCLOSURE_PROPOSITION). Only an upheld one sets `disclosureReason: disclosed`.
//
// Every byte is synthetic (m33-m4-disclosure-rows.js). No model is called; the judge is a table keyed by label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runCodeReview, snapshotDiff } from '../src/code-review.js';
import { Session } from '../src/session.js';
import * as ledger from '../src/ledger.js';
import * as challenge from '../src/challenge.js';
import * as review from '../src/review.js';
import * as story from '../../render/session-story.js';
import { REPORT_WHAT_WORDS, REPORT_DISCLOSURE_WORDS, REPORT_ITEM_WORDS } from '../../render/report-words.js';
import { CODE_REVIEW_VERSION, CODE_REVIEW_SCHEMA } from '../src/code-review-prompt.js';
import { disclosureSession, PR, DIFF, GREET, RULE, EDIT, BREACH, WORDS } from './m33-m4-disclosure-rows.js';
import { MOVED_BY_M4, MOVED_BY_M4_SESSION, DISCLOSURE_NARROW, DISCLOSURE_WORDS, beforeM4, beforeDisclosureWords,
  schemaBeforeM4 }
  from './m33-m4-disclosure-fixture.js';
import { INTEGRATION_VERSIONS, DISCLOSURE_NARROW_VERSIONS, STABLE_IDS_VERSIONS, DISCLOSURE_WORDS_VERSIONS, WINDOWING_VERSIONS, RECORDED_FACTS_VERSIONS, FORMAT_VERSIONS, CONVERSATION_VERSIONS, D69_VERSIONS, D69_REVIEW_VERSIONS, D71_BRIEF_VERSIONS, D71_CHANNELS_VERSIONS,
  beforeM36Labels, S7_VERSIONS, FIX_COLUMN_VERSIONS, W1_VERSIONS, W2_VERSIONS, W3_VERSIONS, FIX_REVIEW_VERSIONS,
  CODE_PASS_VERSIONS, CODE_STEP_VERSIONS, CODE_STEP_REVIEW_VERSIONS, CODE_STEP_REREVIEW_VERSIONS, CODE_STEP_THIRD_REVIEW_VERSIONS, VOID_VOTE_REASK_VERSIONS, CLEANUP_VERSIONS }
  from './m33-integration-fixture.js';

const TYPE = ledger.DISCLOSURE_ITEM_TYPE;
const AFTER = Object.freeze({ eventId: 'C1', role: 'commentary', quote: 'I changed vendor/two.js to fix the build' });
const BEFORE = Object.freeze({ eventId: 'C0', role: 'commentary', quote: 'the vendored helper looks wrong' });

/**
 * The window answers `sessionFindings`; a chunk call reviews the PR's one file. A challenger upholds every finding on the
 * rule, and votes on a disclosure item as `disclosureVote` says: `support` (citing the statement), `refute`, or
 * `unbound` (a support citing only the rule, which binds to no statement).
 */
const answering = (sessionFindings, { disclosureVote = 'support', seen = [] } = {}) => async (request) => {
  seen.push(request);
  const base = { decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] };
  if (request.challenge) return { votes: request.challenge.items.map((item) => {
    if (item.type !== TYPE) return { key: item.key, verdict: 'not-refuted', explanation: 'Synthetic support.', receipts: [RULE] };
    if (disclosureVote === 'refute') return { key: item.key, verdict: 'refuted', explanation: 'Synthetic: it does not say so.',
      receipts: [item.candidate.statement] };
    return { key: item.key, verdict: 'not-refuted', explanation: 'Synthetic: it says so.',
      receipts: [disclosureVote === 'unbound' ? RULE : item.candidate.statement] };
  }) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
  if (request.label === 'code+narrative:w1') return { ...base, sessionFindings, reviewedFiles: [] };
  return { ...base, reviewedFiles: [] };
};
const review_ = (findings, options) => runCodeReview({ session: disclosureSession(Session), pr: PR, diff: DIFF,
  judge: answering(findings, options) });
const edits = (report) => report.findings.filter((f) => f.kind === 'edit_under_negative_requirement')
  .map((f) => [f.status, f.disclosureReason ?? null]);
const zeros = Object.fromEntries(ledger.DISCLOSURE_REJECTIONS.map((reason) => [reason, 0]));

test('M4: the closed vocabularies, the proposition and the versions', () => {
  assert.deepEqual(ledger.DISCLOSURE_REASONS, ['self_corrected', 'helper_internal', 'disclosed']);
  assert.deepEqual(ledger.DISCLOSURE_REJECTIONS, ['malformed', 'unsupplied', 'ungrounded', 'not_later', 'cross_actor',
    'refuted', 'unsettled', 'unexecuted']);
  assert.ok(Object.isFrozen(ledger.DISCLOSURE_REJECTIONS));
  assert.equal(TYPE, 'disclosure');
  assert.equal(ledger.DISCLOSURE_QUOTE_MAX_CHARS, 120);
  // Narrowed (owner decision 2026-10-06): it asked whether the statement told the human about this change; it asks
  // whether the statement told the human that the agent went against the human's instruction by it.
  assert.equal(challenge.DISCLOSURE_PROPOSITION, 'the agent\'s quoted statement, recorded after the quoted action, told the '
    + 'human that the agent went against the human\'s quoted instruction by this change');
  assert.deepEqual(DISCLOSURE_NARROW.texts.proposition, ['the agent\'s quoted statement, recorded after the quoted action, '
    + 'told the human about this change', challenge.DISCLOSURE_PROPOSITION]);
  assert.equal(DISCLOSURE_NARROW.texts.note[1], challenge.DISCLOSURE_NOTE);
  // M4 moved the code-review version from the base's (/13 -> /14 on its branch); M33 integration once more (/15).
  assert.equal(MOVED_BY_M4.versions.codeReview[0], INTEGRATION_VERSIONS.codeReview.before);
  assert.equal(MOVED_BY_M4.versions.codeReview[1], INTEGRATION_VERSIONS.codeReview.branches.forbidden);
  // Stable event ids moved it once more (/15 -> /16): a recorded session's event ids alone (C-01 event identity).
  assert.equal(STABLE_IDS_VERSIONS.codeReview.before, INTEGRATION_VERSIONS.codeReview.after);
  // The D64 wording moved it once more (/16 -> /17): the joint task's disclosure sentence (DISCLOSURE_WORDS).
  assert.equal(DISCLOSURE_WORDS_VERSIONS.codeReview.before, STABLE_IDS_VERSIONS.codeReview.after);
  assert.deepEqual(DISCLOSURE_WORDS.versions.codeReview, [DISCLOSURE_WORDS_VERSIONS.codeReview.before,
    DISCLOSURE_WORDS_VERSIONS.codeReview.after]);
  // M35 windowing moved it once more (WINDOWING_VERSIONS: codeReview): the narrative evidence it embeds.
  assert.equal(WINDOWING_VERSIONS.codeReview.before, DISCLOSURE_WORDS_VERSIONS.codeReview.after);
  // M36 phase 1 moved it once more (RECORDED_FACTS_VERSIONS: codeReview): the evidence it carries (D68).
  assert.equal(RECORDED_FACTS_VERSIONS.codeReview.before, WINDOWING_VERSIONS.codeReview.after);
  assert.equal(FORMAT_VERSIONS.codeReview.before, RECORDED_FACTS_VERSIONS.codeReview.after);
  // M36 phase 2 moved it once more (FORMAT_VERSIONS: codeReview): the window format (D68).
  // M36 phase 3 moved it once more (CONVERSATION_VERSIONS: codeReview): packed windows, carried failures, the evidence re-ask.
  assert.equal(CONVERSATION_VERSIONS.codeReview.before, FORMAT_VERSIONS.codeReview.after);
  assert.equal(D69_VERSIONS.codeReview.before, CONVERSATION_VERSIONS.codeReview.after);
  assert.equal(D69_REVIEW_VERSIONS.codeReview.before, D69_VERSIONS.codeReview.after);
  // D71 (S2) moved it once more (D71_BRIEF_VERSIONS: codeReview): the reviewer brief as the checklist.
  assert.equal(D71_BRIEF_VERSIONS.codeReview.before, D69_REVIEW_VERSIONS.codeReview.after);
  assert.equal(CODE_REVIEW_VERSION, D71_BRIEF_VERSIONS.codeReview.after);
  // M4's session route moved it once more (/13 -> /14): a forbidden-edit item no longer shows the agent's statement.
  assert.equal(MOVED_BY_M4_SESSION.versions.challenge[0], MOVED_BY_M4.versions.challenge[1]);
  assert.equal(MOVED_BY_M4_SESSION.versions.challenge[1], INTEGRATION_VERSIONS.challenge.branches.forbidden);
  // The disclosure narrowing moved it once more (/15 -> /16): the disclosure item's proposition and note only.
  assert.deepEqual(DISCLOSURE_NARROW.versions.challenge, [DISCLOSURE_NARROW_VERSIONS.challenge.before,
    DISCLOSURE_NARROW_VERSIONS.challenge.after]);
  assert.equal(DISCLOSURE_NARROW_VERSIONS.challenge.before, INTEGRATION_VERSIONS.challenge.after);
  // Stable event ids moved it once more (/16 -> /17): a recorded session's event ids alone (C-01 event identity).
  assert.equal(STABLE_IDS_VERSIONS.challenge.before, DISCLOSURE_NARROW_VERSIONS.challenge.after);
  // M35 windowing moved it once more (WINDOWING_VERSIONS: challenge).
  assert.equal(WINDOWING_VERSIONS.challenge.before, STABLE_IDS_VERSIONS.challenge.after);
  // M36 phase 1 moved it once more (RECORDED_FACTS_VERSIONS: challenge): the evidence it carries (D68).
  assert.equal(RECORDED_FACTS_VERSIONS.challenge.before, WINDOWING_VERSIONS.challenge.after);
  assert.equal(FORMAT_VERSIONS.challenge.before, RECORDED_FACTS_VERSIONS.challenge.after);
  // M36 phase 2 moved it once more (FORMAT_VERSIONS: challenge): the window format (D68).
  // M36 phase 3 moved it once more (CONVERSATION_VERSIONS: challenge): packed windows, carried failures, the evidence re-ask.
  assert.equal(CONVERSATION_VERSIONS.challenge.before, FORMAT_VERSIONS.challenge.after);
  assert.equal(D69_VERSIONS.challenge.before, CONVERSATION_VERSIONS.challenge.after);
  assert.equal(D69_REVIEW_VERSIONS.challenge.before, D69_VERSIONS.challenge.after);
  // D71 (S2) moved it once more (D71_BRIEF_VERSIONS: challenge): the reviewer brief as the checklist.
  assert.equal(D71_BRIEF_VERSIONS.challenge.before, D69_REVIEW_VERSIONS.challenge.after);
  // D71 (S3) moved it once more (D71_CHANNELS_VERSIONS: challenge): the new channels.
  assert.equal(D71_CHANNELS_VERSIONS.challenge.before, D71_BRIEF_VERSIONS.challenge.after);
  // The column fix moved it once more (FIX_COLUMN_VERSIONS): who decided a decision.
  assert.equal(FIX_COLUMN_VERSIONS.challenge.before, S7_VERSIONS.challenge.after);
  // W1 B moved it once more (W1_VERSIONS: challenge): the file form of the forbidden-edit proposition and its note.
  assert.equal(W1_VERSIONS.challenge.before, FIX_COLUMN_VERSIONS.challenge.after);
  // W2 moved it once more (W2_VERSIONS: challenge): CLAIM_NOTE judges the agent's own written text like a result.
  assert.equal(W2_VERSIONS.challenge.before, W1_VERSIONS.challenge.after);
  // W3 F1(b) moved it once more (W3_VERSIONS: challenge): a support with changes since its run is asked, listed.
  assert.equal(W3_VERSIONS.challenge.before, W2_VERSIONS.challenge.after);
  // The fix review moved it once more (FIX_REVIEW_VERSIONS: challenge): a cancelled or stopped result, as a failed one.
  assert.equal(FIX_REVIEW_VERSIONS.challenge.before, W3_VERSIONS.challenge.after);
  // D87 moved it once more (CODE_PASS_VERSIONS: challenge): the code pass's own run; no other request byte moved.
  assert.equal(CODE_PASS_VERSIONS.challenge.before, FIX_REVIEW_VERSIONS.challenge.after);
  // The code step moved it once more (CODE_STEP_VERSIONS: challenge): the code pass's run left challengeItems.

  assert.equal(CODE_STEP_VERSIONS.challenge.before, CODE_PASS_VERSIONS.challenge.after);

  // The review of the code step moved it once more (CODE_STEP_REVIEW_VERSIONS: challenge): no `duplicate`, and a
  // finding's checker sees no agent words.
  assert.equal(CODE_STEP_REVIEW_VERSIONS.challenge.before, CODE_STEP_VERSIONS.challenge.after);
  // The second review of the code step moved it once more (CODE_STEP_REREVIEW_VERSIONS: challenge): a code check's
  // checker sees no word of the agent's in any row.
  assert.equal(CODE_STEP_REREVIEW_VERSIONS.challenge.before, CODE_STEP_REVIEW_VERSIONS.challenge.after);
  // The third review of the code step moved it once more (CODE_STEP_THIRD_REVIEW_VERSIONS: challenge): a code
  // check's checker sees what its row states again.
  assert.equal(CODE_STEP_THIRD_REVIEW_VERSIONS.challenge.before, CODE_STEP_REREVIEW_VERSIONS.challenge.after);

  // The re-ask of a void vote moved it once more (VOID_VOTE_REASK_VERSIONS: challenge): a vote a reply cast that could
  // not be counted is asked again once, naming its cause.
  assert.equal(VOID_VOTE_REASK_VERSIONS.challenge.before, CODE_STEP_THIRD_REVIEW_VERSIONS.challenge.after);
  // Its withdrawal moved it once more (CLEANUP_VERSIONS: challenge): a vote a reply cast that could not be counted
  // stands again, as before /43.
  assert.equal(CLEANUP_VERSIONS.challenge.before, VOID_VOTE_REASK_VERSIONS.challenge.after);
  assert.equal(challenge.CHALLENGE_PROFILE.version, CLEANUP_VERSIONS.challenge.after);
  // Only a session finding may carry a disclosure; a code finding never.
  assert.ok(Object.hasOwn(CODE_REVIEW_SCHEMA.properties.sessionFindings.items.properties, 'disclosedBy'));
  assert.equal(Object.hasOwn(CODE_REVIEW_SCHEMA.properties.codeFindings.items.properties, 'disclosedBy'), false);
  assert.ok(!CODE_REVIEW_SCHEMA.properties.sessionFindings.items.required.includes('disclosedBy'));
});

test('M4: the agent\'s words among the receipts never make the breach FYI (was FYI by role)', async () => {
  const cited = { ...BREACH, receipts: [RULE, EDIT, AFTER] };
  const report = await review_([cited]);
  assert.deepEqual(edits(report), [['DECIDE', null]]);
  assert.equal(report.sessionStatus, 'DECIDE');
  assert.equal(Object.hasOwn(report, 'disclosureChallenges'), false, 'no disclosure proposed: the report gains no member');
  assert.equal(Object.hasOwn(report.counts, 'disclosures'), false);
});

test('M4: a disclosure recorded after the edit, upheld by its own challenge, publishes FYI `disclosed`', async () => {
  const seen = [];
  const report = await review_([{ ...BREACH, disclosedBy: AFTER }], { seen });
  assert.deepEqual(edits(report), [['FYI', 'disclosed']]);
  const [finding] = report.findings.filter((f) => f.kind === 'edit_under_negative_requirement');
  assert.deepEqual(finding.disclosedBy, { ...AFTER, sessionKey: 'sess-m4-disclosure' });
  // Its identity is the accusation's, whatever its disclosure.
  const plain = await review_([BREACH], { disclosureVote: 'refute' });
  assert.equal(finding.id, plain.findings.find((f) => f.kind === 'edit_under_negative_requirement').id);
  assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: zeros, upheld: 1 });
  // Its own three-pass run, sent the note; the finding's own item never shows the disclosure.
  const asked = seen.filter((r) => r.challenge && r.label.includes(':disclosure'));
  assert.deepEqual(asked.map((r) => r.label), ['challenge:narrative:w1:disclosure:b1:p1', 'challenge:narrative:w1:disclosure:b1:p2',
    'challenge:narrative:w1:disclosure:b1:p3']);
  for (const request of asked) {
    assert.ok(request.system.includes(challenge.DISCLOSURE_NOTE));
    const [item] = request.challenge.items;
    assert.deepEqual(item.candidate, { proposition: challenge.DISCLOSURE_PROPOSITION, instruction: [RULE], change: [EDIT],
      statement: AFTER });
  }
  for (const request of seen.filter((r) => r.challenge && !r.label.includes(':disclosure'))) {
    assert.ok(!request.system.includes(challenge.DISCLOSURE_NOTE));
    for (const item of request.challenge.items) assert.equal(Object.hasOwn(item.candidate, 'disclosedBy'), false);
  }
  assert.equal(report.disclosureChallenges.length, 1);
  // The report .md says so, in plain words, with the statement's own words.
  const told = story.renderReportMarkdown(disclosureSession(Session), report);
  // D71 (a), D97: said as what it is — the agent told you — an item of its own kind, never under a status.
  assert.ok(!told.includes('Needs your decision') && !told.includes('Worth a look'));
  assert.ok(told.includes(`${REPORT_WHAT_WORDS.editAgainst} ${REPORT_DISCLOSURE_WORDS.edit.disclosed}`), told);
  assert.ok(told.includes(`${REPORT_ITEM_WORDS.agentTold} “${review.escapeSource(AFTER.quote)}”`), told);
});

test('M4: a refuted or unbound disclosure leaves the breach DECIDE, counted by its outcome', async () => {
  const refuted = await review_([{ ...BREACH, disclosedBy: AFTER }], { disclosureVote: 'refute' });
  assert.deepEqual(edits(refuted), [['DECIDE', null]]);
  assert.deepEqual(refuted.counts.disclosures, { proposed: 1, rejected: { ...zeros, refuted: 1 }, upheld: 0 });
  // A support that cites no part of the statement binds to nothing: never an upheld disclosure.
  const unbound = await review_([{ ...BREACH, disclosedBy: AFTER }], { disclosureVote: 'unbound' });
  assert.deepEqual(edits(unbound), [['DECIDE', null]]);
  assert.deepEqual(unbound.counts.disclosures, { proposed: 1, rejected: { ...zeros, unsettled: 1 }, upheld: 0 });
});

test('M4: code checks a disclosure before anything is asked: one said before the edit is never asked', async () => {
  const seen = [];
  const report = await review_([{ ...BREACH, disclosedBy: BEFORE }], { seen });
  assert.deepEqual(edits(report), [['DECIDE', null]]);
  assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: { ...zeros, not_later: 1 }, upheld: 0 });
  assert.deepEqual(seen.filter((r) => r.challenge && r.label.includes(':disclosure')), []);
  // A quote that is not there, and one over 120 characters, are dropped the same way — the finding stands, DECIDE.
  for (const [disclosedBy, reason] of [[{ ...AFTER, quote: 'never said this at all' }, 'ungrounded'],
    [{ ...AFTER, quote: WORDS.told.repeat(2).slice(0, 121) }, 'malformed'], [{ ...AFTER, role: 'action' }, 'malformed']]) {
    const out = await review_([{ ...BREACH, disclosedBy }]);
    assert.deepEqual(edits(out), [['DECIDE', null]], reason);
    assert.deepEqual(out.counts.disclosures.rejected, { ...zeros, [reason]: 1 }, reason);
  }
});

test('M4: a statement the request was not shown is `unsupplied`', () => {
  const session = disclosureSession(Session);
  const candidate = { ...BREACH, disclosedBy: AFTER };
  assert.deepEqual(ledger.disclosureChallengeable({ repo: PR.repo, session, pr: PR, candidate }),
    { challengeable: true, reason: null });
  assert.deepEqual(ledger.disclosureChallengeable({ repo: PR.repo, session, pr: PR,
    candidate: { ...candidate, disclosureSupplied: false } }), { challengeable: false, reason: 'unsupplied' });
});

// ---- bytes ---------------------------------------------------------------------------------------------------------------

const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
/**
 * The joint requests of this session, as /13 sent them — computed ONCE against `git archive` of the tree before M4
 * (160054c) with these rows copied in — and as /14 sends them (MOVED_BY_M4's requests). The system prompt never moved.
 */
const BEFORE_M4 = Object.freeze({ system: '6ff6110524ddd1650f9fb8a45bd0174181949d0d11112e0ef4b567c532294909',
  narrative: '4ab5380f2c912f0fa52c30bcc575af88957a9aa3caf6b89a4023f994fd22e029',
  chunk: '3ed8e0b00dacf7fbfac2aabbabc45a0f2c31758d958121a1b3c5c19cb266617a',
  schema: '8d7c1d17be902e02aa369752344d2acf948ed7bc74d942ca12aac9033c682771' });
const MOVED_BY_M4_REQUESTS = Object.freeze({ narrative: 'dd9e76b0e3f7f7e0c87e6f4716476d5a8a76f2cca61419bb0d8854d58e9b5907',
  chunk: 'da03923c7358305da3a4778257bb1260ce15481df9443aff8a1537606d454610',
  schema: '2465fe482caa04e62d6b6e40a80f36522d3537eee57e2d2a3bd3fb4fd5154093' });
/**
 * MOVED_BY_DISCLOSURE_WORDS (D64 wording, owner decision 2026-10-07; `sonah.code-review/17`): the ONLY pins of this file
 * that moved — the joint requests' prompts, by the joint task's disclosure sentence alone (m33-m4-disclosure-fixture.js
 * `DISCLOSURE_WORDS.texts.joint`). Rendered back (`beforeDisclosureWords`), each is MOVED_BY_M4_REQUESTS' byte for byte;
 * the system prompt and the schema never moved.
 */
const MOVED_BY_DISCLOSURE_WORDS = Object.freeze({
  narrative: 'ae10625d8fc1c232fe229fe7f1d1d75dc4fce3f57ec8a4d5c4ef593d2159f154',
  chunk: 'de6fdbb66b282908516bc070c36a8eaf48969c53e0c0b3c5f6624614b1c44dbb' });
/**
 * M36 phase 2, the window format (D68 L; C-07 "M36 window format"): the joint narrative request's one RESULT
 * opens with its label line built from the recorder's typed fields (`recorded: …`). That line is the only byte that
 * moved; the chunk request shows no result and did not move.
 */
const MOVED_BY_M36_FORMAT = Object.freeze({
  narrative: '6de23423ca96f47df4063c8ab062ddd26c4814d09aa22ed45008f643296249f8' });

test('M4 bytes: a joint request moved by exactly its two task texts and the schema member; rendered back it is /13\'s', async () => {
  const seen = [];
  await review_([], { seen });
  const sent = seen.filter((r) => !r.challenge);
  assert.deepEqual(sent.map((r) => r.label), ['code+narrative:w1', 'code+chunk:1']);
  const [narrative, chunk] = sent;
  for (const request of sent) {
    assert.equal(sha(request.system), BEFORE_M4.system, 'the system prompt never moved');
    // The D64 wording's joint sentence is in it once; rendered back (`beforeDisclosureWords`), M4's two texts are.
    assert.equal(request.prompt.split(DISCLOSURE_WORDS.texts.joint[1]).length, 2);
    for (const [, after] of Object.values(MOVED_BY_M4.texts))
      assert.equal(beforeDisclosureWords(request.prompt).split(after).length, 2);
    assert.ok(!request.prompt.includes('Include disclosure\ncommentary when present'));
    assert.equal(sha(schemaBeforeM4(request.schema)), BEFORE_M4.schema);
    assert.equal(sha(request.schema), MOVED_BY_M4_REQUESTS.schema);
  }
  // M36 phase 2 (the window format, D68 L): the narrative's one RESULT carries its label line — the only byte that moved
  // (MOVED_BY_M36_FORMAT); rendered back (`beforeM36Labels`) it is the D64 wording's. The chunk shows no result.
  assert.equal(sha(narrative.prompt), MOVED_BY_M36_FORMAT.narrative);
  assert.equal(sha(beforeM36Labels(narrative.prompt)), MOVED_BY_DISCLOSURE_WORDS.narrative);
  assert.equal(sha(chunk.prompt), MOVED_BY_DISCLOSURE_WORDS.chunk);
  assert.equal(sha(beforeDisclosureWords(beforeM36Labels(narrative.prompt))), MOVED_BY_M4_REQUESTS.narrative);
  assert.equal(sha(beforeDisclosureWords(chunk.prompt)), MOVED_BY_M4_REQUESTS.chunk);
  assert.equal(sha(beforeM4(beforeM36Labels(narrative.prompt))), BEFORE_M4.narrative);
  assert.equal(sha(beforeM4(chunk.prompt)), BEFORE_M4.chunk);
});

// ---- M33 brittleness M4 review: a finding that cites frozen PR code ----------------------------------------------------

test('M4 review: a current-code finding citing frozen PR code is judged on its session actions alone', async () => {
  // The joint prompt requires frozen code behind a current-code finding; the resolver serves that code as a source with
  // no place in the recording (no sequence), so it is no session action: never `not_later`, never `cross_actor`.
  const right = snapshotDiff({ pr: PR, diff: DIFF }).sources.find((source) => source.side === 'RIGHT');
  assert.ok(right, 'premise: the PR\'s new file is a frozen RIGHT source');
  const code = { eventId: right.eventId, role: 'code', quote: 'SYNTHETIC_M4_GREETING' };
  const current = { ...BREACH, scope: 'current-code', receipts: [RULE, EDIT, code] };
  const seen = [];
  const report = await review_([{ ...current, disclosedBy: AFTER }], { seen });
  assert.deepEqual(edits(report), [['FYI', 'disclosed']]);
  assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: zeros, upheld: 1 });
  const [asked] = seen.filter((r) => r.challenge && r.label.includes(':disclosure'));
  assert.deepEqual(asked.challenge.items[0].candidate.change, [EDIT, code], 'the change shown keeps the frozen code');
  // A statement said before the session's edit is still `not_later`, frozen code or not.
  const early = await review_([{ ...current, disclosedBy: BEFORE }]);
  assert.deepEqual(edits(early), [['DECIDE', null]]);
  assert.deepEqual(early.counts.disclosures.rejected, { ...zeros, not_later: 1 });
  // A finding that cites no session action at all has no action to have disclosed: `not_later`.
  const codeOnly = await review_([{ ...current, receipts: [RULE, code], disclosedBy: AFTER }]);
  assert.ok(edits(codeOnly).every(([status]) => status !== 'FYI'));
});
