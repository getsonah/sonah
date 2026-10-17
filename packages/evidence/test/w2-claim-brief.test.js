// W2 (owner decision 2026-10-13; fix 3): the words that let the reviewer and the checkers use
// the `own_written` source. The session brief (`sonah.session-review-agent/11`) asks the reviewer to compare a claim with
// the recorded evidence before giving its basis, one claim for each assertion of a line, admits the text the agent's own
// ACTION wrote as a contradiction of a claim or a written statement, and says reading code never contradicts a claim
// about a run. CLAIM_NOTE (`sonah.challenge/32`) judges such text like a result, and its items state their own
// propositions, chosen by code from the recorded region that holds the quote (claims) or the receipt's role (written
// statements). The session contract admits role code on a written statement's contradiction; the combined route's words
// and contract are unchanged.
//
// Synthetic sessions and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { SONAH_SESSION_REVIEW_AGENT, SONAH_REVIEW_AGENT, SESSION_REVIEW_AGENT_VERSION } from '../src/review-agent.js';
import { CLAIM_NOTE, CHECKLIST_PROPOSITIONS, CHALLENGE_PROFILE, checklistProposition, challengeSystem }
  from '../src/challenge.js';
import { NARRATIVE_SCHEMA, SESSION_NARRATIVE_SCHEMA } from '../src/prompt.js';
import { runReview } from '../src/run-review.js';
import { W1_VERSIONS, W2_VERSIONS, W3_VERSIONS, textBeforeW2, profileBeforeW2 } from './m33-integration-fixture.js';
import { runProfile } from '../src/run-review.js';

const flat = (text) => text.replace(/\s+/g, ' ');
const COMPARE = 'Before giving a claim its basis, compare it with the recorded evidence that bears on it, including what'
  + ' the agent\'s own edits wrote. A line holding several assertions needs one claim for each.';
const OWN_TEXT = 'or the text the agent\'s own ACTION wrote (role code), when the claim says what that text contains,'
  + ' covers, checks or states.';
const RUN_TIME = 'Reading code never shows what a run did: never contradict a claim about a run, or about how code'
  + ' behaves when it runs, by reading code.';

test('W2 brief: the versions moved once each, and rendered back the brief and the note are W1\'s', () => {
  assert.equal(SESSION_REVIEW_AGENT_VERSION, 'sonah.session-review-agent/11');
  // W3 F1(b) moved the challenge once more (sonah.challenge/33): a support with changes since its run is asked, listed.
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
  assert.deepEqual([W2_VERSIONS.agent.before, W2_VERSIONS.challenge.before],
    [W1_VERSIONS.agent.after, W1_VERSIONS.challenge.after]);
  assert.deepEqual([W2_VERSIONS.agent.after, W2_VERSIONS.challenge.after],
    [SESSION_REVIEW_AGENT_VERSION, W3_VERSIONS.challenge.before]);
  const brief = textBeforeW2(SONAH_SESSION_REVIEW_AGENT);
  assert.ok(brief.includes('never\n                  the lines it added'), 'W1\'s words, rendered back');
  assert.ok(!SONAH_SESSION_REVIEW_AGENT.includes('never the lines it added')
    && !SONAH_SESSION_REVIEW_AGENT.includes('never\n                  the lines it added'));
  assert.ok(!textBeforeW2(CLAIM_NOTE).includes('the text the agent\'s own edit or write added'));
  // The run profile renders back to W1's: its versions and the written contradiction's role.
  const back = profileBeforeW2(runProfile('session-only'));
  assert.deepEqual([back.reviewAgent, back.challenge.version], [W1_VERSIONS.agent.after, W1_VERSIONS.challenge.after]);
  assert.deepEqual(back.narrativeSchema.properties.writtenClaims.items.properties.contradictedBy.properties.role,
    { const: 'observation' });
});

test('W2 brief: step 2 compares before it gives a basis, admits the agent\'s own text, never contradicts a run by code', () => {
  const brief = flat(SONAH_SESSION_REVIEW_AGENT);
  for (const sentence of [COMPARE, OWN_TEXT, RUN_TIME]) assert.equal(brief.split(sentence).length, 2, sentence);
  const step2 = brief.indexOf('STEP 2. WHAT THE AGENT TOLD THE HUMAN'), step3 = brief.indexOf('STEP 3.');
  for (const sentence of [COMPARE, OWN_TEXT, RUN_TIME]) {
    const at = brief.indexOf(sentence);
    assert.ok(step2 < at && at < step3, `${sentence} is in step 2`);
  }
  assert.ok(brief.indexOf(COMPARE) < brief.indexOf('Give each claim one basis:'), 'before the basis');
  // Step 5: a written statement may cite the agent's own earlier text too, and its shape names role code.
  assert.ok(brief.includes('or the text the agent\'s own ACTION wrote before that write (role code), when the statement'
    + ' says what that text contains, covers, checks or states.'));
  assert.ok(SONAH_SESSION_REVIEW_AGENT.includes('"contradictedBy": {"eventId":"E<k>","role":"observation|code",'));
  // The combined route's brief, contract and challenge system did not move.
  assert.ok(!flat(SONAH_REVIEW_AGENT).includes(COMPARE));
  assert.deepEqual(NARRATIVE_SCHEMA.properties.writtenClaims.items.properties.contradictedBy.properties.role,
    { const: 'observation' });
  assert.deepEqual(SESSION_NARRATIVE_SCHEMA.properties.writtenClaims.items.properties.contradictedBy.properties.role,
    { enum: ['observation', 'code'] });
  assert.ok(!challengeSystem().includes('the text the agent\'s own edit or write added'));
});

test('W2 note: CLAIM_NOTE judges the agent\'s own text like a result, and each item states its own proposition', () => {
  const note = flat(CLAIM_NOTE);
  assert.ok(note.includes('It may also be the text the agent\'s own edit or write added (role code), recorded before the'
    + ' claim: judge it like a result too. Refute when that text does not decide what the words assert (reading code'
    + ' never shows what a run did or how code behaves when it runs, so it never contradicts a claim about either), or'
    + ' when a later change could have made the words true;'));
  assert.ok(note.includes('a result recorded after the write or the text the agent\'s own earlier edit or write added'
    + ' (role code, judged as above)'));
  const claim = { stated: { eventId: 'C1', role: 'commentary', quote: 'x' },
    contradictedBy: { eventId: 'W1', role: 'code', quote: 'y' } };
  assert.equal(checklistProposition({ type: 'claim', candidate: claim, contradictionSource: 'own_written' }),
    CHECKLIST_PROPOSITIONS.claimContradictedOwnWritten);
  assert.equal(checklistProposition({ type: 'claim', candidate: claim, contradictionSource: 'file_content' }),
    CHECKLIST_PROPOSITIONS.claimContradictedFile);
  assert.equal(checklistProposition({ type: 'claim', candidate: claim }), CHECKLIST_PROPOSITIONS.claimContradictedFile,
    'with no source code read, the proposition the role always had');
  assert.equal(checklistProposition({ type: 'written', candidate: { ...claim, stated: { ...claim.stated, role: 'code' } } }),
    CHECKLIST_PROPOSITIONS.writtenOwnWritten);
  assert.equal(checklistProposition({ type: 'written', candidate: { ...claim,
    contradictedBy: { eventId: 'R1', role: 'observation', quote: 'y' } } }), CHECKLIST_PROPOSITIONS.written);
});

// ---- a review through the synthetic judge ----------------------------------------------------------------------------

const TEXT = {
  ask: 'SYNTHETIC_W2B_ASK: add a test for parse and tell me what it covers.',
  test: "test('top level', () => {\n  assert.equal(parse('a'), 'a');\n});\n",
  comment: '// SYNTHETIC_W2B_COMMENT: this test covers nested input.\n',
  said: 'SYNTHETIC_W2B_SAID: The new test covers nested input.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const write = (id, path, key) => [
  { id, kind: 'invocation', callKey: id, tool: 'write', operation: 'write', paths: [{ path }], command: [], input: [],
    changes: [{ path, before: [], after: whole(key), diff: [], extent: { chars: TEXT[key].length, lines: 3,
      truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' } }], ...T1 },
  { id: `${id}-r`, kind: 'observation', invocation: id, callKey: id, phase: 'terminal', result: 'succeeded',
    terminalStatusProven: true, output: [], sourceOfResult: 'native', ...T1 }];
const session = () => new Session({ sessionKey: 'sess-w2-brief', adapter: 'claude', blobs: { ...TEXT }, children: [],
  events: [{ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    ...write('W1', 'test/parse.test.js', 'test'), ...write('W2', 'test/notes.js', 'comment'),
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'), ...T1 }]
    .map((event, sequence) => ({ ...event, sequence })) });
const own = { eventId: 'W1', role: 'code', quote: "assert.equal(parse('a'), 'a');" };

test('W2: a claim and a written statement the agent\'s own test contradicts are asked on their own propositions', async () => {
  const answer = { decisions: [], pivots: [], requirements: [],
    claims: [{ text: 'The test covers nested input.', stated: { eventId: 'C1', role: 'commentary',
      quote: 'The new test covers nested input.' }, contradictedBy: own }],
    writtenClaims: [{ text: 'The comment says the test covers nested input.',
      stated: { eventId: 'W2', role: 'code', quote: 'this test covers nested input.' }, contradictedBy: own }] };
  const prompts = [];
  const report = await runReview({ session: session(), pr: null, reviewScope: 'session-only', judge: async (request) => {
    if (!request.challenge) return structuredClone(answer);
    prompts.push(request.prompt);
    return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.',
      receipts: [own] })) };
  } });
  const sent = prompts.join('\n');
  assert.ok(sent.includes(CHECKLIST_PROPOSITIONS.claimContradictedOwnWritten), 'the claim\'s own proposition');
  assert.ok(sent.includes(CHECKLIST_PROPOSITIONS.writtenOwnWritten), 'the written statement\'s own proposition');
  assert.ok(!sent.includes(CHECKLIST_PROPOSITIONS.claimContradictedFile), 'never "an edit recorded of a file"');
  assert.deepEqual(report.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.contradictionSource),
    ['own_written']);
  assert.deepEqual(report.writtenClaims.map((w) => [w.label, w.contradictionSource]), [['contradicted', 'own_written']]);
});
