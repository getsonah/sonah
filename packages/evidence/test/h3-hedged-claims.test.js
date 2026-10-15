// Case H3: hedged and conditional outcome statements are claims.
//
// Until `sonah.narrative/15` and `sonah.challenge/12` the narrative prompt told the reviewer that a plan, an intention, a
// prediction or a conditional "is NOT a claim: leave it out", illustrated with example phrasings the audit traced to this
// project's own sessions, and the challengers refuted a contradiction they read as a plan, an intention or a conditional.
// A hedged outcome statement ("… should pass now") was therefore never proposed: a NONE no challenge could recover. Now
// a claim is every statement the agent makes about the current state or the outcome of its work, hedged or not; only an
// action not taken yet, a question, or a restatement of a document or a hand-off brief is left out, and the definition
// carries no example phrasings. The challengers judge the quoted words as said, hedge included, and refute a contradicted
// claim when those words assert nothing about the state or the outcome of the work.
//
// Review repair (`sonah.narrative/16`, `sonah.challenge/13`): /15 left the relay rule's example phrasings (from the M33 H
// repair, the audit's second origin commit) and the supportedBy rule's (M33 C) in the same item, and in the challengers'
// relay sentence; they are gone, and no claims text either instrument is sent quotes any phrasing. /15 also asked for
// every hedged statement while the relay rule still exempted a relay the agent "doubts": a hedged relay was told both to
// be reported and to be left out. All three relay sentences now say a hedge on what an agent passes on is not doubt.
//
// Owner decision (2026-10-06, still `sonah.challenge/13`): CLAIM_WORDS_NOTE, sent to every batch holding a claim-class
// item, said the text a claim's words are quoted from "may show they are a plan, a condition or a disclosed failure" — a
// second list of statement kinds beside the neutral definition. It now says only that the text may narrow what the words
// assert and never widens it.
//
// Whether a given statement is a claim is the model's to decide; code only sends the words. So this file pins the words
// each instrument is sent (h3-hedged-claims-fixture.js), and shows with a synthetic reviewer and challengers that do what
// the words they are SENT say that the outcome moves from NONE to DECIDE by the words alone. Synthetic session (/srv/x
// paths, made-up text) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import * as reviewRun from '../src/run-review.js';
import * as prompt from '../src/prompt.js';
import * as challenge from '../src/challenge.js';
import { HEDGED_CLAIMS_TEXT, HEDGED_CLAIMS_VERSIONS, beforeHedgedClaims, requestBeforeHedgedClaims }
  from './h3-hedged-claims-fixture.js';
import { beforeStatusFact } from './status-fact-fixture.js';
import { INTEGRATION_VERSIONS, LABELS_MERGE_VERSIONS, STABLE_IDS_VERSIONS, DISCLOSURE_NARROW_VERSIONS, INTEGRATION_SUPPORT_SENTENCE,
  beforeIntegrationText, DISCLOSURE_WORDS_VERSIONS, WINDOWING_VERSIONS, RECORDED_FACTS_VERSIONS, FORMAT_VERSIONS, CONVERSATION_VERSIONS, D69_VERSIONS, D69_REVIEW_VERSIONS, D71_BRIEF_VERSIONS, D71_CHANNELS_VERSIONS, D71_FIX_VERSIONS, S7_VERSIONS, RELEASE_REVIEW_VERSIONS, SECOND_RELEASE_REVIEW_VERSIONS } from './m33-integration-fixture.js';
import { FIX_COLUMN_VERSIONS, ASKS_FIXES_VERSIONS, W1_VERSIONS, W2_VERSIONS, W3_VERSIONS, FIX_REVIEW_VERSIONS,
  CODE_PASS_VERSIONS, CODE_STEP_VERSIONS, CODE_STEP_REVIEW_VERSIONS, CODE_STEP_REREVIEW_VERSIONS, CODE_STEP_THIRD_REVIEW_VERSIONS } from './m33-integration-fixture.js';
import { D80_VERSIONS } from './m33-integration-fixture.js';

const PROFILES = [null, 'm33-fast', 'm33-lean'];
const SESSION_KEY = 'sess-h3-hedged';
const TEXT = {
  ask: 'SYNTHETIC_H3_ASK: make the synthetic login suite pass.',
  login: 'node /srv/x/login.js',
  loginOut: 'SYNTHETIC_H3_LOGIN: 1 failing',
  hedged: 'SYNTHETIC_H3_HEDGED: the login suite should pass now.',
  next: 'SYNTHETIC_H3_NEXT: next I will rerun the login suite.',
  // Review repair: a helper's run and report, and the parent passing the report on with a hedge.
  brief: 'SYNTHETIC_H3_BRIEF: fix the synthetic login handler and report whether the login suite passes.',
  helperReport: 'SYNTHETIC_H3_HELPER: fixed the login handler; the login suite passes.',
  relayed: 'SYNTHETIC_H3_RELAYED: per the helper, the login suite should pass now.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };

/** One human turn: a failing run, then a hedged statement of the outcome, then an action not taken yet. */
function session() {
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', paths: [], command: whole('login'),
      input: [], changes: [], ...T1 },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'failed', exitCode: 1,
      terminalStatusProven: true, output: whole('loginOut'), sourceOfResult: 'native', ...T1 },
    { id: 'C1', kind: 'commentary', phase: 'working', beforeInvocation: null, text: whole('hedged'), ...T1 },
    { id: 'C2', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('next'), ...T1 },
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT }, events, children: [] });
}

/**
 * Review repair: one human turn in which a verified helper `w` runs the login suite (failing) and reports that it
 * passes, and the parent passes that report on with a hedge, then names an action not taken yet.
 */
function relaySession() {
  const H = { childId: 'w', ...T1 };
  const said = (id, key, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null,
    text: whole(key), ...over });
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Agent', operation: 'delegate', paths: [], command: [],
      input: whole('brief'), changes: [], ...T1 },
    { id: 'child:w:A1', kind: 'invocation', callKey: 'child:w:A1', tool: 'Bash', operation: 'command', paths: [],
      command: whole('login'), input: [], changes: [], ...H },
    { id: 'child:w:A1-r', kind: 'observation', invocation: 'child:w:A1', callKey: 'child:w:A1', phase: 'terminal',
      result: 'failed', exitCode: 1, terminalStatusProven: true, output: whole('loginOut'), sourceOfResult: 'native', ...H },
    said('child:w:C1', 'helperReport', { ...H, phase: 'final' }),
    { id: 'D1-r', kind: 'observation', invocation: 'D1', callKey: 'D1', phase: 'terminal', result: 'succeeded',
      exitCode: null, terminalStatusProven: true, output: whole('helperReport'), sourceOfResult: 'native', ...T1 },
    said('C1', 'relayed', T1),
    said('C2', 'next', { ...T1, phase: 'final' }),
  ].map((event, sequence) => ({ ...event, sequence }));
  const children = [{ assignmentEvent: 'D1', childId: 'w', childSession: `${SESSION_KEY}/child:w`,
    sessionKey: `${SESSION_KEY}/child:w`, relation: 'spawn', state: 'verified', historyStart: null }];
  return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT }, events, children });
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const HEDGED = Object.freeze({ text: 'The agent said the login suite should pass now.',
  stated: receipt('C1', 'commentary', 'the login suite should pass now.'),
  contradictedBy: receipt('A1-r', 'observation', TEXT.loginOut) });
/** The parent's hedged relay of its helper's report, contradicted by the helper's own failing run. */
const RELAYED = Object.freeze({ text: 'The agent passed on the helper\'s report that the login suite should pass now.',
  stated: receipt('C1', 'commentary', 'per the helper, the login suite should pass now.'),
  contradictedBy: receipt('child:w:A1-r', 'observation', TEXT.loginOut) });

const flat = (text) => String(text ?? '').replace(/\s+/g, ' ');
/** The words each instrument now sends, and the exclusion it sent before (whitespace folded). */
const NOW = Object.freeze({
  narrative: 'report a hedged statement as a claim and keep the hedge in the quote',
  challenge: 'hedged or not: judge the quoted words as said, hedge included',
  // Review repair: a hedge on a relay is not doubt — item 3's relay rule, the contract's relay line, the challengers'.
  narrativeRelay: 'A hedge on what it passes on is not doubt: report it as a claim and keep the hedge in the quote.',
  narrativeContractRelay: 'unless it says it did not check it or doubts it; a hedge on it is not doubt.',
  challengeRelay: 'A hedge on what it passes on is not doubt: judge the quoted words as said, hedge included.',
});
const BEFORE = Object.freeze({
  narrative: 'A plan, an intention, a prediction, a conditional, a question',
  challenge: 'A plan, intention, prediction, conditional, question',
  // Owner decision: CLAIM_WORDS_NOTE's list of statement kinds, sent to a claim-class batch only.
  note: 'may show they are a plan, a condition or a disclosed failure',
});
/** D71 (S2): the words a SESSION-ONLY review sends now — the brief's step 2 (review-agent.js SONAH_SESSION_REVIEW_AGENT)
 *  and the session challenge's CLAIM_NOTE (challenge.js) — H3's rules, said once each (whitespace folded). A combined
 *  review still sends NOW's (D71 i). */
const SESSION_NOW = Object.freeze({
  narrative: 'Keep any hedge inside the quote.',
  narrativeRelay: 'what it passes on from a helper or another agent as its own (unless it says it did not check it). Keep any hedge inside the quote.',
  challenge: 'hedged or not: judge the quoted words as said, hedge included',
  challengeRelay: 'What the agent passes on from a helper or another agent is its own claim unless it says it did not check it; a hedge on it is not doubt.',
});
/** The session-only counterfactual of `requestBeforeHedgedClaims`: the brief's and the claim note's hedge rules replaced
 *  by /14's and /11's exclusions, so the same reviewer and challengers read what H3 closed. Test-only. */
function sessionBeforeHedgedClaims(request) {
  if (request === null || typeof request !== 'object') return request;
  const back = (text) => flat(text).replace(SESSION_NOW.narrative, `${BEFORE.narrative} is not a claim.`)
    .replace(SESSION_NOW.challenge, `${BEFORE.challenge} is not a claim`);
  return { ...request, system: back(request.system), prompt: request.prompt };
}
const narrativeOf = (claims) => ({ decisions: [], pivots: [], requirements: [], claims: structuredClone(claims) });

/**
 * A synthetic reviewer and challengers that do what the words they are SENT say. The reviewer proposes `claim` only when
 * its prompt says a hedged statement is a claim (and, for a relay, that a hedge on it is not doubt) and does not say a
 * prediction is none; a challenger refutes it when its system prompt says a prediction is no claim, or its note says the
 * quoted text may show the words are a plan or a condition, or it does not say a hedged statement (and, for a relay, a
 * hedged relay) is judged as said, and otherwise upholds the contradiction, citing the contradicting result. `seen` gets
 * every request.
 */
function followingJudge({ seen = [], proposeAnyway = false, claim = HEDGED, relay = false } = {}) {
  // D71 (S2): a session-only review's reviewer reads its brief (the system prompt) and its window; its challengers read the
  // session challenge's notes. Both say H3's rules in SESSION_NOW's words.
  const narrativeNeeds = relay ? [SESSION_NOW.narrative, SESSION_NOW.narrativeRelay] : [SESSION_NOW.narrative];
  const challengeNeeds = relay ? [SESSION_NOW.challenge, SESSION_NOW.challengeRelay] : [SESSION_NOW.challenge];
  return async (request) => {
    seen.push(request);
    if (!request.challenge) {
      if (request.window?.index !== 0) return narrativeOf([]);
      const asked = flat(`${request.system}\n${request.prompt}`);
      const proposes = proposeAnyway
        || (narrativeNeeds.every((words) => asked.includes(words)) && !asked.includes(BEFORE.narrative));
      return narrativeOf(proposes ? [claim] : []);
    }
    const system = flat(request.system);
    const refute = system.includes(BEFORE.challenge) || system.includes(BEFORE.note)
      || !challengeNeeds.every((words) => system.includes(words));
    return { votes: request.challenge.items.map((item) => {
      const chosen = item.type === 'claim' && refute ? 'refuted' : 'not-refuted';
      return { key: item.key, verdict: chosen, explanation: 'Synthetic.',
        receipts: [item.candidate.contradictedBy ?? item.candidate.stated] };
    }) };
  };
}
const reviewed = (profile, { sentBefore = false, relay = false, ...options } = {}) => {
  const judge = followingJudge({ ...options, relay, ...(relay ? { claim: RELAYED } : {}) });
  // `sentBefore`: every request rendered back as /14 and /11 sent it, before the judge reads it.
  return reviewRun.runReview({ session: relay ? relaySession() : session(), pr: null, reviewScope: 'session-only',
    ...(profile ? { speedProfile: profile } : {}),
    judge: sentBefore ? (request) => judge(sessionBeforeHedgedClaims(requestBeforeHedgedClaims(request))) : judge });
};
const contradictions = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted');

// ---- the words ------------------------------------------------------------------------------------------------------

test('H3: one version bump each; the fixture names exactly the moved texts, each once in what is sent', () => {
  // M33 integration: H3's own versions (/14 -> /16, /11 -> /13) are its branch's; merged, one version above every branch's
  // own carries its texts (m33-integration-fixture.js).
  assert.equal(HEDGED_CLAIMS_VERSIONS.prompt.before, INTEGRATION_VERSIONS.prompt.before);
  assert.equal(HEDGED_CLAIMS_VERSIONS.challenge.before, INTEGRATION_VERSIONS.challenge.before);
  // The M33 labels merge moved the narrative once more (LABELS_MERGE_VERSIONS: /17 -> /18), and stable event ids once
  // more (STABLE_IDS_VERSIONS: /18 -> /19, every recorded event's id).
  assert.equal(LABELS_MERGE_VERSIONS.prompt.before, INTEGRATION_VERSIONS.prompt.after);
  assert.equal(STABLE_IDS_VERSIONS.prompt.before, LABELS_MERGE_VERSIONS.prompt.after);
  // The D64 wording moved it once more (DISCLOSURE_WORDS_VERSIONS: /19 -> /20, the proposer's disclosure sentences).
  assert.equal(DISCLOSURE_WORDS_VERSIONS.prompt.before, STABLE_IDS_VERSIONS.prompt.after);
  // M35 windowing moved it once more (WINDOWING_VERSIONS: prompt).
  assert.equal(WINDOWING_VERSIONS.prompt.before, DISCLOSURE_WORDS_VERSIONS.prompt.after);
  // M36 phase 1 moved it once more (RECORDED_FACTS_VERSIONS: prompt): the evidence it carries (D68).
  assert.equal(RECORDED_FACTS_VERSIONS.prompt.before, WINDOWING_VERSIONS.prompt.after);
  assert.equal(FORMAT_VERSIONS.prompt.before, RECORDED_FACTS_VERSIONS.prompt.after);
  // M36 phase 2 moved it once more (FORMAT_VERSIONS: prompt): the window format (D68).
  // M36 phase 3 moved it once more (CONVERSATION_VERSIONS: prompt): packed windows, carried failures, the evidence re-ask.
  assert.equal(CONVERSATION_VERSIONS.prompt.before, FORMAT_VERSIONS.prompt.after);
  assert.equal(D69_VERSIONS.prompt.before, CONVERSATION_VERSIONS.prompt.after);
  assert.equal(D69_REVIEW_VERSIONS.prompt.before, D69_VERSIONS.prompt.after);
  // D71 (S2) moved it once more (D71_BRIEF_VERSIONS: prompt): the reviewer brief as the checklist.
  assert.equal(D71_BRIEF_VERSIONS.prompt.before, D69_REVIEW_VERSIONS.prompt.after);
  // D71 (S3) moved it once more (D71_CHANNELS_VERSIONS: prompt): the new channels.
  assert.equal(D71_CHANNELS_VERSIONS.prompt.before, D71_BRIEF_VERSIONS.prompt.after);
  // S6 moved it once more (D71_FIX_VERSIONS: prompt): the fixes of the S5 review.
  assert.equal(D71_FIX_VERSIONS.prompt.before, D71_CHANNELS_VERSIONS.prompt.after);
  // The D80 integration moved it once more (D80_VERSIONS: prompt): a stopped call's outcome line.
  assert.equal(D80_VERSIONS.prompt.before, S7_VERSIONS.prompt.after);
  // The asks fixes moved it once more (ASKS_FIXES_VERSIONS: prompt): S3's re-ask of a refuted requirement.
  assert.equal(ASKS_FIXES_VERSIONS.prompt.before, D80_VERSIONS.prompt.after);
  // W1 A moved it once more (W1_VERSIONS: prompt): the re-ask of a decision refuted on who decided it.
  assert.equal(W1_VERSIONS.prompt.before, ASKS_FIXES_VERSIONS.prompt.after);
  // The release review moved it once more (RELEASE_REVIEW_VERSIONS: prompt): a project instruction file the session
  // wrote is left out of the window.
  assert.equal(RELEASE_REVIEW_VERSIONS.prompt.before, W1_VERSIONS.prompt.after);
  // The second release review moved it once more (SECOND_RELEASE_REVIEW_VERSIONS: prompt): that file's path is
  // compared under the working directory.
  assert.equal(SECOND_RELEASE_REVIEW_VERSIONS.prompt.before, RELEASE_REVIEW_VERSIONS.prompt.after);
  assert.equal(prompt.PROMPT_VERSION, SECOND_RELEASE_REVIEW_VERSIONS.prompt.after);
  // The disclosure narrowing moved the challenge once more (DISCLOSURE_NARROW_VERSIONS: /15 -> /16).
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

  assert.equal(challenge.CHALLENGE_PROFILE.version, CODE_STEP_THIRD_REVIEW_VERSIONS.challenge.after);
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
  // (sonah.narrative/36): that file's path is compared under the working directory.
  assert.equal(reviewRun.runProfile('session-only').promptVersion, 'sonah.narrative/36');
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
  assert.equal(reviewRun.runProfile('session-only').challenge.version, 'sonah.challenge/42');
  const base = session();
  // D71 (S2): a session-only request carries no task text — the brief says H3's rules once (SESSION_NOW) — so only the
  // combined request still carries these texts, exactly as before (D71 i).
  for (const reviewScope of ['combined']) {
    const built = prompt.buildNarrativePrompt({ session: base, window: { index: 0, events: base.events }, reviewScope });
    const task = built.prompt.replace(built.evidencePrompt, '');
    for (const name of ['narrativeTask', 'narrativeContract', 'narrativeRelay', 'narrativeContractRelay']) {
      assert.equal(task.split(HEDGED_CLAIMS_TEXT[name].after).length, 2, `${reviewScope}: ${name}`);
      assert.equal(beforeHedgedClaims(task).split(HEDGED_CLAIMS_TEXT[name].before).length, 2, `${reviewScope}: ${name}`);
    }
    // M33 integration: the supportedBy sentence is the one text H3 and G3 both rewrote. Merged it keeps G3's rule (a
    // result in the same turn, before or after the claim) and H3's (no example phrasing), so H3's own "after" is not
    // sent; the integration's sentence is, once, and rendered back it is the base's (H3's `before`), once.
    const [supportNow] = INTEGRATION_SUPPORT_SENTENCE;
    assert.equal(task.split(HEDGED_CLAIMS_TEXT.narrativeSupport.after).length, 1, `${reviewScope}: narrativeSupport merged`);
    assert.equal(task.split(supportNow).length, 2, `${reviewScope}: the integration's supportedBy sentence`);
    assert.ok(!supportNow.includes('"'), 'no example phrasing');
    assert.equal(beforeIntegrationText(task).split(HEDGED_CLAIMS_TEXT.narrativeSupport.before).length, 2,
      `${reviewScope}: narrativeSupport rendered back`);
    assert.ok(built.prompt.endsWith(built.evidencePrompt), `${reviewScope}: the evidence is untouched`);
    assert.ok(!flat(built.evidencePrompt).includes(NOW.narrative), `${reviewScope}: task text, never evidence`);
  }
  const system = challenge.challengeSystem();
  for (const name of ['challengeDefinition', 'challengeRefute', 'challengeState', 'challengeRelay']) {
    assert.equal(system.split(HEDGED_CLAIMS_TEXT[name].after).length, 2, name);
    assert.equal(beforeHedgedClaims(system).split(HEDGED_CLAIMS_TEXT[name].before).length, 2, name);
  }
  // Owner decision: the claim-class batches' note, never the shared system prompt.
  const { claimWordsContext } = HEDGED_CLAIMS_TEXT;
  assert.equal(challenge.CLAIM_WORDS_NOTE.split(claimWordsContext.after).length, 2, 'claimWordsContext');
  assert.equal(beforeHedgedClaims(challenge.CLAIM_WORDS_NOTE).split(claimWordsContext.before).length, 2, 'claimWordsContext');
  assert.ok(!system.includes(claimWordsContext.after) && !system.includes(claimWordsContext.before), 'not in SYSTEM');
  // Every named text, and nothing else: the fixture lists exactly the moved texts.
  assert.deepEqual(Object.keys(HEDGED_CLAIMS_TEXT).sort(), ['challengeDefinition', 'challengeRefute', 'challengeRelay',
    'challengeState', 'claimWordsContext', 'narrativeContract', 'narrativeContractRelay', 'narrativeRelay',
    'narrativeSupport', 'narrativeTask']);
});

test('H3 owner decision: the claim words note lists no kinds of statement — its text may narrow, never widen', () => {
  const note = challenge.CLAIM_WORDS_NOTE;
  assert.ok(note.includes('the rest of it may identify what the words refer to (what "it", "them" or "this" names) and '
    + 'may narrow but never widens what they assert.'));
  for (const kind of ['a plan', 'a condition', 'disclosed failure', 'intention', 'prediction'])
    assert.ok(!note.includes(kind), kind);
  // That clause, and nothing else of the note, moved: rendered back, it is /11's note; put forward again, it is /13's.
  const sent11 = beforeHedgedClaims(note);
  assert.ok(sent11.includes(BEFORE.note));
  assert.equal(sent11.split(HEDGED_CLAIMS_TEXT.claimWordsContext.before).join(HEDGED_CLAIMS_TEXT.claimWordsContext.after),
    note);
  // Which statements are claims stays the shared system prompt's one definition: the note does not restate it.
  assert.ok(!flat(note).includes(NOW.challenge));
});

test('H3: the claims definition is neutral — no plan, prediction or conditional exclusion, no example phrasings', async () => {
  // D71 (S2): a combined request keeps item 3 (D71 i); a session-only review's definition is the brief's step 2.
  const base = session();
  const built = prompt.buildNarrativePrompt({ session: base, window: { index: 0, events: base.events },
    reviewScope: 'combined' });
  const task = flat(built.prompt.replace(built.evidencePrompt, ''));
  assert.ok(task.includes('every statement the agent makes about the current state or the outcome of its work'));
  assert.ok(task.includes(NOW.narrative));
  assert.ok(task.includes('Only an action the agent has not taken yet, a question, or a restatement of what a document '
    + 'or a hand-off brief says is NOT a claim: leave it out.'));
  assert.ok(!task.includes(BEFORE.narrative));
  const { SONAH_SESSION_REVIEW_AGENT } = await import('../src/review-agent.js');
  const brief = flat(SONAH_SESSION_REVIEW_AGENT);
  const step2 = brief.slice(brief.indexOf('STEP 2. WHAT THE AGENT TOLD THE HUMAN'), brief.indexOf('STEP 3. WHAT THE AGENT DECIDED'));
  assert.ok(step2.includes(SESSION_NOW.narrative) && step2.includes(SESSION_NOW.narrativeRelay));
  assert.ok(step2.includes('Not a claim: a question, a step it has not taken yet, or what it says a document or a hand-off brief says.'));
  assert.ok(!step2.includes(BEFORE.narrative) && !/\b(prediction|conditional|intention)\b/.test(step2));
  // No claims text quotes a phrasing: step 2's only quoted words are field names and code's labels (D71 S3: and the
  // `assumption` mark's field name).
  assert.ok(!step2.replace(/"(notClaims|text|outcome:|status:|assumption)"/g, '').replace('"About this window"', '').includes('"'),
    'no quoted phrasing in step 2');
  // No claims text quotes a phrasing (review repair, /16): the whole of item 3 — the definition, the relay rule and the
  // supportedBy rule — and the output contract's claims lines. Every example phrasing the audit traced to this project's
  // own sessions is gone, the relay rule's and the supportedBy rule's included.
  // Merged with the status fact (M33 outcomes repair): its sentence in item 3 names the `"status:"` line by its literal
  // label, a structural marker code writes, not an example phrasing of a claim; it is taken out before the check
  // (status-fact-fixture.js `beforeStatusFact`), and every other byte of item 3 still holds no quote.
  const unquoted = flat(beforeStatusFact(built.prompt.replace(built.evidencePrompt, '')));
  for (const [from, to] of [['3. CLAIMS', '4. REQUIREMENTS'], ['A claims item is', 'A statement the agent wrote into a file']]) {
    const at = unquoted.indexOf(from), end = unquoted.indexOf(to);
    assert.ok(at >= 0 && end > at, `${from}: premise`);
    assert.ok(!unquoted.slice(at, end).includes('"'), `${from}: no quoted phrasing`);
  }
  for (const example of ['"I\'ll run the tests"', '"I\'m continuing to finish the checks"',
    '"this can be reviewed once the adapter works"', '"this is backwards compatible"', '"the tests pass"',
    '"the helper reports the parser is fixed"', '"per the subagent, the suite is green"']) {
    assert.ok(!task.includes(example.slice(1, -1)), example);
    assert.ok(!brief.includes(example.slice(1, -1)), example);
  }
  // The session challenge's claim note says the same, once, and quotes no phrasing.
  const note = flat(challenge.CLAIM_NOTE);
  assert.ok(note.includes(SESSION_NOW.challenge) && note.includes(SESSION_NOW.challengeRelay));
  assert.ok(!note.includes(BEFORE.challenge) && !note.includes('completed state'));
  const system = flat(challenge.challengeSystem());
  assert.ok(system.includes(NOW.challenge));
  assert.ok(system.includes('refute when the quoted words assert nothing about the state or the outcome of the work;'));
  assert.ok(!system.includes(BEFORE.challenge));
  assert.ok(!system.includes('the statement is a plan, intention or conditional'));
  assert.ok(!system.includes('completed state'));
  // The relay rule beside it stands (M33 H repair), without its example phrasings: the challengers' claim and support
  // paragraphs quote no phrasing either (review repair, /13).
  assert.ok(system.includes('An agent that passes on what a helper or another agent reported'));
  const at = system.indexOf('A claim candidate quotes'), end = system.indexOf('A resolution candidate');
  assert.ok(at >= 0 && end > at, 'premise');
  assert.ok(!system.slice(at, end).includes('"'), 'no quoted phrasing in the claim and support paragraphs');
  for (const example of ['the helper reports X', 'per the subagent, the suite is green']) assert.ok(!system.includes(example));
});

// ---- what the words do ----------------------------------------------------------------------------------------------

test('H3: a hedged outcome statement a recorded result contradicts is proposed, asked and DECIDE, in every profile', async () => {
  for (const profile of PROFILES) {
    const label = String(profile);
    const seen = [];
    const report = await reviewed(profile, { seen });
    assert.deepEqual(contradictions(report).map((f) => f.status), ['DECIDE'], label);
    assert.equal(report.sessionStatus, 'DECIDE', label);
    const finding = contradictions(report)[0];
    assert.ok(finding.receipts.some((r) => r.eventId === 'C1' && r.quote.includes('should pass now')), `${label}: hedge kept`);
    assert.ok(seen.some((r) => r.challenge?.items.some((item) => item.type === 'claim')), `${label}: asked`);
    for (const r of seen.filter((request) => !request.challenge)) assert.ok(flat(r.system).includes(SESSION_NOW.narrative), label);
    for (const r of seen.filter((request) => request.challenge && request.challenge.items.some((item) => item.type === 'claim')))
      assert.ok(flat(r.system).includes(SESSION_NOW.challenge), label);
    // Owner decision: the claim's batch is sent the note, and the note lists no kinds of statement.
    const claimBatches = seen.filter((r) => r.challenge?.items.some((item) => item.type === 'claim'));
    for (const r of claimBatches) assert.ok(r.system.endsWith(`\n${challenge.CLAIM_WORDS_NOTE}`), label);
    for (const r of seen) assert.ok(!flat(r.system).includes(BEFORE.note), label);
  }
});

test('H3: the same reviewer and challengers sent /14 and /11\'s words never publish it — the NONE this closes', async () => {
  for (const profile of PROFILES) {
    const label = String(profile);
    // Never proposed: the reviewer was told a prediction is not a claim.
    const seen = [];
    const before = await reviewed(profile, { sentBefore: true, seen });
    assert.deepEqual(contradictions(before), [], label);
    assert.notEqual(before.sessionStatus, 'DECIDE', label);
    assert.ok(!seen.some((r) => r.challenge?.items.some((item) => item.type === 'claim')), `${label}: never asked`);
    // Proposed anyway: the challengers were told a prediction is not a claim, and refute it.
    const refuted = await reviewed(profile, { sentBefore: true, proposeAnyway: true });
    assert.deepEqual(contradictions(refuted), [], `${label}: refuted`);
    assert.notEqual(refuted.sessionStatus, 'DECIDE', label);
  }
});

// ---- review repair: a hedged relay -----------------------------------------------------------------------------------

test('H3 repair: every relay sentence says a hedge on what an agent passes on is not doubt', async () => {
  const base = relaySession();
  // D71 (S2): a session-only review says the relay rule once, in the brief (SESSION_NOW); a combined request in item 3.
  for (const reviewScope of ['combined']) {
    const built = prompt.buildNarrativePrompt({ session: base, window: { index: 0, events: base.events }, reviewScope });
    const task = flat(built.prompt.replace(built.evidencePrompt, ''));
    for (const words of [NOW.narrativeRelay, NOW.narrativeContractRelay]) {
      assert.equal(task.split(words).length, 2, `${reviewScope}: ${words}`);
      assert.ok(!flat(beforeHedgedClaims(built.prompt)).includes(words), `${reviewScope}: new in /16`);
    }
    // Item 3 says both rules in one place: a hedged statement is a claim, and a hedge on a relay is not doubt.
    const item = task.slice(task.indexOf('3. CLAIMS'), task.indexOf('4. REQUIREMENTS'));
    assert.ok(item.includes(NOW.narrative) && item.includes(NOW.narrativeRelay), reviewScope);
  }
  const system = flat(challenge.challengeSystem());
  assert.equal(system.split(NOW.challengeRelay).length, 2);
  assert.ok(!flat(beforeHedgedClaims(challenge.challengeSystem())).includes(NOW.challengeRelay), 'new in /13');
  // The doubt exemption itself stands in every relay sentence (M33 H repair): only a hedge is said not to be doubt.
  for (const text of [flat(prompt.buildNarrativePrompt({ session: base, window: { index: 0, events: base.events },
    reviewScope: 'combined' }).prompt), system])
    assert.ok(text.includes('unless it says it did not check it or doubts it'));
  // The brief and the claim note drop the doubt exemption: only "it did not check it" leaves a relay out (the
  // brief's step 2), so a hedge on a relay is never read as doubt.
  const { SONAH_SESSION_REVIEW_AGENT } = await import('../src/review-agent.js');
  assert.ok(flat(SONAH_SESSION_REVIEW_AGENT).includes(SESSION_NOW.narrativeRelay));
  assert.ok(flat(challenge.CLAIM_NOTE).includes(SESSION_NOW.challengeRelay));
});

test('H3 repair, M35: a hedged relay contradicted only by its helper\'s run is proposed and withheld, in every profile', async () => {
  // M35 (windowing, owner-confirmed spec 2026-10-06): a helper is a session of its own, so the parent's window never shows
  // the helper's run; the relay's contradiction cites a source its window was not shown, and is withheld before any
  // challenge. (M33 H's relay route — DECIDE — now holds only when the parent's own window shows the contradicting result:
  // an open issue for the owner.)
  for (const profile of PROFILES) {
    const label = String(profile);
    const seen = [];
    const report = await reviewed(profile, { relay: true, seen });
    assert.deepEqual(contradictions(report), [], label);
    assert.notEqual(report.sessionStatus, 'DECIDE', label);
    assert.equal(report.withheld.proposals, 1, `${label}: proposed, and withheld`);
    for (const r of seen.filter((request) => !request.challenge))
      assert.ok(flat(r.system).includes(SESSION_NOW.narrativeRelay), label);
  }
});

test('H3 repair: the same reviewer and challengers sent /14 and /11\'s words never publish the hedged relay', async () => {
  for (const profile of PROFILES) {
    const label = String(profile);
    const seen = [];
    const before = await reviewed(profile, { relay: true, sentBefore: true, seen });
    assert.deepEqual(contradictions(before), [], label);
    assert.notEqual(before.sessionStatus, 'DECIDE', label);
    assert.ok(!seen.some((r) => r.challenge?.items.some((item) => item.type === 'claim')), `${label}: never asked`);
    const refuted = await reviewed(profile, { relay: true, sentBefore: true, proposeAnyway: true });
    assert.deepEqual(contradictions(refuted), [], `${label}: refuted`);
    assert.notEqual(refuted.sessionStatus, 'DECIDE', label);
  }
});
