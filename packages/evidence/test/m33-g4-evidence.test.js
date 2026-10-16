// M33 G4 (C-06 "M33 session verdict", after adversarial review). Four evidence defects, each tested
// on its own shape:
//   1. A decision whose cited actions resolve to more than one actor (a parent's action and its
//      child's), or to none, is rejected `ambiguous_authority`. That check RAN and was inconclusive
//      about the actor: it is withheld and counted, never published, and it does not make the
//      window's session grounding — or the session review — incomplete. Every other capping reason,
//      including a candidate naming another actor than its actions resolve to, still caps.
//   2. The review prompts say a decision cites ONE actor's actions, and their versions move.
//   3. The combined (PR) route takes a claim whose stated receipt a surviving claim_contradicted
//      finding cites out of its open promises (`counts.promisesAsFindings`), and its joint challenge
//      moves a vote receipt that cited an action's id for its result to that one supplied result.
//   4. The renderer states `counts.promisesAsFindings`, and an unchecked value says only the cause
//      the ledger recorded — never "did not check out" when no value was proposed.
// Synthetic sessions and judges only: no recording, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as prompt from '../src/prompt.js';
import * as agent from '../src/review-agent.js';
import { runCodeReview } from '../src/code-review.js';

const { runReview } = reviewRun;
const REPO = { host: 'github.com', id: '0' };
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };

// ---- 1. an ambiguous actor is withheld ------------------------------------------------------------

/** A parent that delegates, its own write, and the verified child's write and its result. */
function familySession({ childLink = 'verified' } = {}) {
  const blobs = {
    ask: 'SYNTHETIC_G4_ASK: split the worker out and keep the changelog tidy.',
    brief: 'SYNTHETIC_G4_BRIEF: implement the worker module.',
    assignment: 'SYNTHETIC_G4_ASSIGNMENT: implement the worker module.',
    root: 'export const SYNTHETIC_G4_ROOT = 1;\n',
    child: 'export const SYNTHETIC_G4_CHILD = 2;\n',
    rootOut: 'SYNTHETIC_G4_ROOT_OUT: File created successfully',
    childOut: 'SYNTHETIC_G4_CHILD_OUT: File created successfully',
    said: 'SYNTHETIC_G4_SAID: the worker module is split out.',
  };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const write = (id, path, body, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Write', operation: 'write',
    paths: [{ path }], command: [], input: [], changes: [{ path, before: [], after: ref(body), diff: [] }], ...over });
  const result = (id, invocation, out, over = {}) => ({ id, kind: 'observation', phase: 'terminal', invocation,
    callKey: invocation, result: 'succeeded', exitCode: null, terminalStatusProven: true, sourceOfResult: 'native',
    output: ref(out), ...over });
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask') },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Task', operation: 'delegate', paths: [], command: [],
      input: ref('brief'), changes: [] },
    { id: 'child:worker:I1', kind: 'instruction', childId: 'worker', authority: 'parent-assignment', supersedes: [],
      text: ref('assignment') },
    write('child:worker:A1', 'src/worker.js', 'child', { childId: 'worker' }),
    result('child:worker:O1', 'child:worker:A1', 'childOut', { childId: 'worker' }),
    { id: 'D1-r', kind: 'observation', phase: 'terminal', invocation: 'D1', callKey: 'D1', result: 'succeeded',
      exitCode: null, terminalStatusProven: true, sourceOfResult: 'native', output: ref('childOut') },
    write('A1', 'src/index.js', 'root'),
    result('O1', 'A1', 'rootOut'),
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref('said') },
  ].map((event, sequence) => ({ ...event, sequence }));
  const children = childLink === null ? [] : [{ assignmentEvent: 'D1', childId: 'worker', childSession: 'family/child:worker',
    sessionKey: 'family/child:worker', relation: 'spawn', state: childLink, historyStart: null }];
  return new Session({ sessionKey: 'family', adapter: 'claude', blobs, events, children });
}

const decision = (actions, over = {}) => ({ dimension: `SYNTHETIC_G4_DIM ${actions.join(' ')}`,
  chosen: 'SYNTHETIC_G4 the worker lives in its own module', value: null, valueReceipt: null, actions,
  stated: null, constrainedBy: null, ...over });
const upheld = (narrative, receipt = { eventId: 'O1', role: 'observation', quote: 'File created successfully' }) =>
  async (request) => (request.challenge
    ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'Recorded.', receipts: [receipt] })) }
    : narrative);
const sessionReview = (session, narrative) => runReview({ session, pr: null, reviewScope: 'session-only',
  judge: upheld(narrative) });

test('M33 G4 premise: the parent and its verified child are two actors', () => {
  const session = familySession();
  assert.equal(session.actorForActions(['A1']).state, 'root');
  assert.equal(session.actorForActions(['child:worker:A1']).state, 'verified-child');
  assert.equal(session.actorForActions(['A1', 'child:worker:A1']).state, 'ambiguous');
});

test('M33 G4 a decision citing one parent action and one child action is withheld, not capping', () => {
  const session = familySession();
  const candidate = { ...decision(['A1', 'child:worker:A1']), actorSession: null };
  const out = ledger.groundDecision({ repo: REPO, session, pr: null, candidate, instructionHistoryComplete: true });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'ambiguous_authority', 'the reason is unchanged, so its rate stays computable');
  assert.equal(out.cause, 'actor_ambiguous');
  assert.ok(ledger.WITHHELD_REJECTION_CAUSES.includes('actor_ambiguous'));
  assert.ok(!ledger.JUDGMENT_REASONS.includes('actor_ambiguous'), 'a cause, never a new reason');
  assert.equal(ledger.withheldRejection(out), true, 'withheld: the check ran and was inconclusive');
  const report = ledger.buildLedger({ repo: REPO, session, pr: null, reviewScope: 'session-only',
    candidates: [candidate], sessionCoverage: 'complete' });
  assert.deepEqual(report.decisions, [], 'never published');
  assert.equal(ledger.readingCaps(report), false, 'it does not cap the reading');
  assert.equal(report.withheld.proposals, 1, 'counted like an unmatched quote');
  assert.equal(report.withheld.causes?.actor_ambiguous, 1, 'and said for what it is');
});

test('M33 G4 a decision whose child action resolves to no verified actor is withheld too', () => {
  for (const childLink of [null, 'missing', 'conflicting']) {
    const session = familySession({ childLink });
    const candidate = { ...decision(['child:worker:A1']), actorSession: null };
    const out = ledger.groundDecision({ repo: REPO, session, pr: null, candidate, instructionHistoryComplete: true });
    assert.deepEqual([out.reason, out.cause], ['ambiguous_authority', 'actor_ambiguous'], String(childLink));
    assert.equal(ledger.withheldRejection(out), true);
  }
});

test('M33 G4 near misses: every other ambiguous_authority rejection still caps', () => {
  const session = familySession();
  // A candidate naming another actor than the one its actions resolve to is not an ambiguous actor:
  // no check could evaluate it as proposed.
  const named = ledger.groundDecision({ repo: REPO, session, pr: null, instructionHistoryComplete: true,
    candidate: { ...decision(['child:worker:A1']), actorSession: 'family' } });
  assert.equal(named.reason, 'ambiguous_authority');
  assert.equal(named.cause, undefined);
  assert.equal(ledger.withheldRejection(named), false);
  // A prohibition finding whose rule is not a human instruction.
  const finding = ledger.groundFinding({ repo: REPO, session, pr: null, candidate: { origin: 'session-review',
    kind: 'edit_under_negative_requirement', title: 't', explanation: 'e', scope: 'session-effect', anchor: null,
    receipts: [{ eventId: 'child:worker:I1', role: 'instruction', quote: 'implement the worker module.' },
      { eventId: 'A1', role: 'action', quote: 'src/index.js' }] } });
  assert.equal(finding.reason, 'ambiguous_authority');
  assert.equal(ledger.withheldRejection(finding), false, 'a finding keeps capping');
  // A forged cause on another reason is not a withhold.
  assert.equal(ledger.withheldRejection({ reason: 'kind_rejected', cause: 'actor_ambiguous' }), false);
  assert.equal(ledger.withheldRejection({ reason: 'no_actions', cause: 'actor_ambiguous' }), false);
});

test('M33 G4 the real shape under M36 packed windows: one window shows both actors, and a parent-and-child decision is withheld (actor_ambiguous)', async () => {
  // M35: a helper is its own session. M36 phase 3 (D68 K): a small one shares its parent's window, each under its own
  // heading, so the window shows the parent's action and the helper's together. A decision citing both is asked and
  // upheld, and the ledger's actor check withholds it (`actor_ambiguous`: counted, never published). Each single-actor
  // decision is published under its own actor. The votes quote each actor's own path: the two results say the same words
  // (c6: a quote in two sessions' shown text would be rejected).
  const session = familySession();
  const judge = async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key, verdict: 'not-refuted',
      explanation: 'Recorded.', receipts: [candidate.actions.includes('A1')
        ? { eventId: 'A1', role: 'action', quote: 'src/index.js' }
        : { eventId: 'child:worker:A1', role: 'action', quote: 'src/worker.js' }] })) };
    return { ...EMPTY, decisions: [decision(['A1', 'child:worker:A1']),
      decision(['child:worker:A1'], { dimension: 'SYNTHETIC_G4_CHILD' }), decision(['A1'], { dimension: 'SYNTHETIC_G4_PARENT' })] };
  };
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge });
  assert.deepEqual(report.windowResults.map((w) => (w.sessions ?? []).map((part) => part.session.childId)), [[null, 'worker']],
    'premise: one window, each actor its own session');
  for (const window of report.windowResults) {
    assert.equal(window.failure, null);
    assert.equal(window.challenge.complete, true);
    assert.equal(window.sessionGroundingComplete, true);
  }
  assert.deepEqual(report.decisions.map((d) => [d.dimension, d.actorSession]).sort(),
    [['SYNTHETIC_G4_CHILD', 'family/child:worker'], ['SYNTHETIC_G4_PARENT', 'family']],
    'each single-actor decision is published under its own actor');
  assert.equal(report.withheld.causes.actor_ambiguous, 1, 'the crossing decision is withheld by the ledger');
  assert.equal(report.sessionReview, 'complete', 'the session review completed');
  assert.equal(report.coverage, 'complete');
  assert.notEqual(report.sessionStatus, 'UNCHECKED');
  assert.ok(!report.rejectedDecisions.some((r) => r.reason === 'ambiguous_authority' && !ledger.withheldRejection(r)),
    'not rejected as a check that did not run: its rejection is a withheld one');
});

test('M33 G4 the combined route under M35 windowing never publishes a parent-and-child decision', async () => {
  const session = familySession();
  const INDEX = 'src/index.js';
  const diff = ['diff --git a/src/index.js b/src/index.js', 'new file mode 100644', '--- /dev/null',
    '+++ b/src/index.js', '@@ -0,0 +1,1 @@', '+export const SYNTHETIC_G4_ROOT = 1;', ''].join('\n');
  const pr = { repo: { host: 'github.com', id: '404' }, number: 404, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
    headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: INDEX, change: 'added', contentState: 'complete' }] };
  const base = { ...EMPTY, codeFindings: [], sessionFindings: [] };
  const judge = async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'Recorded.', receipts: [{ eventId: 'O1', role: 'observation', quote: 'File created successfully' }] })) };
    if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [INDEX] };
    return { ...base, reviewedFiles: /^code\+narrative:/.test(request.label ?? '') ? [INDEX] : [],
      decisions: [decision(['A1', 'child:worker:A1'])] };
  };
  const report = await runCodeReview({ session, pr, diff, judge });
  assert.deepEqual(report.decisions, []);
  assert.equal(report.sessionReview, 'complete');
});

// ---- 2. the prompts ask for one actor per decision ------------------------------------------------

test('M33 G4 every review prompt says a decision cites one actor, and the versions moved', () => {
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
  // D71 (S2) moved it once more (sonah.session-review-agent/3), and D71 (S3) once more (sonah.session-review-agent/4): the new channels (D71_CHANNELS_VERSIONS).
  // The column fix moved it once more (sonah.session-review-agent/8): who decided a decision (FIX_COLUMN_VERSIONS).
  // P1 (the asks fixes) moved it once more (sonah.session-review-agent/9): a run refused at every attempt.
  // W1 B moved it once more (sonah.session-review-agent/10): an edit may go against a project instruction file.
  // W2 moved it once more (sonah.session-review-agent/11): a claim is compared with the evidence; the agent's own text.
  assert.equal(agent.SESSION_REVIEW_AGENT_VERSION, 'sonah.session-review-agent/11');
  assert.equal(agent.REVIEW_AGENT_VERSION, 'sonah.review-agent/2');
  const built = prompt.buildNarrativePrompt({ session: familySession(), window: { index: 0,
    events: familySession().events } });
  const flat = (text) => text.replace(/\s+/g, ' ');
  // D71 (S2): the session reviewer's brief says it once, in its own words (no `child:` prefix: a window holds one agent's
  // events).
  const brief = flat(agent.SONAH_SESSION_REVIEW_AGENT);
  assert.ok(brief.includes("Each decision cites the actions that adopted it, all of one agent's session; when the main agent "
    + 'adopts or builds on a helper\'s work, that is its own decision citing its own actions.'));
  assert.ok(!brief.includes('child:'));
  for (const [name, text] of [['narrative task', built.prompt], ['combined agent', agent.SONAH_REVIEW_AGENT]]) {
    assert.match(flat(text), /actions of ONE actor/, `${name}: one actor per decision`);
    assert.match(flat(text), /separate decision/, `${name}: adoption is its own decision`);
    assert.match(flat(text), /child:/, `${name}: how an actor is told apart`);
  }
  assert.ok(!built.evidencePrompt.includes('actions of ONE actor'), 'guidance is task text, never evidence');
  const profile = reviewRun.runProfile('session-only');
  // D71 (S2) moved it once more (sonah.session-review-agent/3), and D71 (S3) once more (sonah.session-review-agent/4): the new channels (D71_CHANNELS_VERSIONS).
  // The column fix moved it once more (sonah.session-review-agent/8): who decided a decision (FIX_COLUMN_VERSIONS).
  // P1 (the asks fixes) moved it once more (sonah.session-review-agent/9): a run refused at every attempt.
  // W1 B moved it once more (sonah.session-review-agent/10): an edit may go against a project instruction file.
  // W2 moved it once more (sonah.session-review-agent/11): a claim is compared with the evidence; the agent's own text.
  assert.equal(profile.reviewAgent, 'sonah.session-review-agent/11');
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
  assert.equal(profile.promptVersion, 'sonah.narrative/37');
  assert.equal(reviewRun.runProfile('combined').reviewAgent, 'sonah.review-agent/2');
});

// ---- 3. the combined route ------------------------------------------------------------------------

const CLAIMS = {
  said: 'SYNTHETIC_G4_SAID: the locale tests all pass now.',
  cmd: 'npm test -- locale',
  failed: 'SYNTHETIC_G4_FAILED: 2 locale tests failed',
};
const claimsSession = () => {
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(CLAIMS[key], 'utf8') }];
  return new Session({ sessionKey: 'sess-g4-claims', adapter: 'claude', blobs: { ...CLAIMS }, events: [
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', sequence: 0,
      paths: [], command: whole('cmd'), input: [], changes: [] },
    { id: 'A1-r', kind: 'observation', phase: 'terminal', invocation: 'A1', callKey: 'A1', sequence: 1,
      result: 'failed', exitCode: 1, terminalStatusProven: true, output: whole('failed'), sourceOfResult: 'native' },
    { id: 'C1', kind: 'commentary', phase: 'final', sequence: 2, text: whole('said'), beforeInvocation: null },
  ] });
};
const GREET = 'src/greet.js';
const GREET_DIFF = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/greet.js', '@@ -0,0 +1,1 @@', '+export default "SYNTHETIC_G4_GREETING";', ''].join('\n');
const GREET_PR = { repo: { host: 'github.com', id: '187' }, number: 187, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
  files: [{ path: GREET, change: 'added', contentState: 'complete' }] };
const STATED = { eventId: 'C1', role: 'commentary', quote: 'the locale tests all pass now' };
const AGAINST = { eventId: 'A1-r', role: 'observation', quote: 'SYNTHETIC_G4_FAILED: 2 locale tests failed' };
const CONTRADICTION = { origin: 'session-review', kind: 'claim_contradicted', title: 'SYNTHETIC_G4_CONTRADICTED',
  explanation: 'SYNTHETIC_G4: the recorded result contradicts the claim.', scope: 'session-effect', anchor: null,
  receipts: [STATED, AGAINST] };
/** The window's answer lists the claim with no contradiction, and its sessionFindings carry the
 *  contradiction. Every challenge vote cites `vote`. */
const combinedJudge = (vote) => async (request) => {
  const base = { ...EMPTY, codeFindings: [], sessionFindings: [] };
  if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'Recorded.', receipts: [vote] })) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
  if (request.label === 'code+narrative:w1') return { ...base, reviewedFiles: [],
    claims: [{ text: 'SYNTHETIC_G4 the agent said the locale tests pass', stated: STATED, contradictedBy: null }],
    sessionFindings: [CONTRADICTION] };
  return { ...base, reviewedFiles: [] };
};

test('M33 G4 the combined route takes a claim its joint finding contradicts out of the open promises', async () => {
  const report = await runCodeReview({ session: claimsSession(), pr: GREET_PR, diff: GREET_DIFF,
    judge: combinedJudge(AGAINST) });
  assert.ok(report.findings.some((f) => f.kind === 'claim_contradicted'
    && f.receipts.some((r) => r.eventId === 'C1')), 'premise: the joint finding survived');
  assert.deepEqual(report.promises, [], 'the claim is that finding, not also an open promise');
  assert.equal(report.counts.promisesAsFindings, 1, 'counted, never silently discarded');
});

test('M33 G4 near miss: on the combined route a claim no surviving finding cites stays an open promise', async () => {
  const judge = combinedJudge(AGAINST);
  const report = await runCodeReview({ session: claimsSession(), pr: GREET_PR, diff: GREET_DIFF,
    judge: async (request) => {
      const answer = await judge(request);
      return request.label === 'code+narrative:w1' ? { ...answer, sessionFindings: [] } : answer;
    } });
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.promises.map((p) => p.stated.eventId), ['C1']);
  assert.equal(report.counts.promisesAsFindings, 0);
});

test('M33 G4 a joint vote citing an action\'s id for its supplied result is moved to that result', async () => {
  const report = await runCodeReview({ session: claimsSession(), pr: GREET_PR, diff: GREET_DIFF,
    judge: combinedJudge({ eventId: 'A1', role: 'observation', quote: AGAINST.quote }) });
  const [joint] = report.codeChallenges;
  const votes = joint.results.flatMap((r) => r.votes);
  assert.ok(votes.length > 0, 'premise: the joint challenge voted');
  for (const vote of votes) {
    assert.equal(vote.valid, true);
    assert.equal(vote.receipts[0].eventId, 'A1-r');
    assert.equal(vote.receipts[0].eventRepairedFrom, 'A1');
  }
  assert.equal(joint.eventRepairedVotes, votes.length);
  assert.ok(report.findings.some((f) => f.kind === 'claim_contradicted'), 'the finding survives on repaired votes');
  assert.equal(report.counts.promisesAsFindings, 1);
});

test('M33 G4 near misses: a joint vote the repair cannot resolve is still rejected', async () => {
  for (const vote of [
    // A quote the result does not contain (the action's own command).
    { eventId: 'A1', role: 'observation', quote: 'npm test -- locale' },
    // A commentary event is not an action: nothing to move.
    { eventId: 'C1', role: 'observation', quote: 'the locale tests all pass now' },
  ]) {
    const report = await runCodeReview({ session: claimsSession(), pr: GREET_PR, diff: GREET_DIFF,
      judge: combinedJudge(vote) });
    const votes = report.codeChallenges[0].results.flatMap((r) => r.votes);
    assert.ok(votes.length > 0);
    assert.ok(votes.every((v) => v.valid === false), JSON.stringify(vote));
    assert.equal(report.codeChallenges[0].eventRepairedVotes ?? 0, 0);
    assert.ok(!report.findings.some((f) => f.kind === 'claim_contradicted' && f.origin === 'session-review'
      && f.title === CONTRADICTION.title), 'no finding stands on rejected votes');
  }
});

test('M33 G4 near miss: an action whose one result this request was not shown is not repaired', async () => {
  // The result sits in a later window, so the window that proposed the finding was never shown it. M35: a
  // compaction no longer splits; a long thought between the action and its result does (the combined route's
  // window holds about 196k bytes).
  const blobs = { ...CLAIMS, think: `SYNTHETIC_G4_THINK: ${'t'.repeat(250_000)}` };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const session = new Session({ sessionKey: 'sess-g4-claims', adapter: 'claude', blobs, events: [
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', sequence: 0,
      paths: [], command: whole('cmd'), input: [], changes: [] },
    { id: 'C1', kind: 'commentary', phase: 'final', sequence: 1, text: whole('said'), beforeInvocation: null },
    { id: 'B1', kind: 'boundary', boundary: 'compaction', sequence: 2 },
    { id: 'T1', kind: 'commentary', phase: 'working', sequence: 3, text: whole('think'), beforeInvocation: null },
    { id: 'A1-r', kind: 'observation', phase: 'terminal', invocation: 'A1', callKey: 'A1', sequence: 4,
      result: 'failed', exitCode: 1, terminalStatusProven: true, output: whole('failed'), sourceOfResult: 'native' },
  ] });
  const report = await runCodeReview({ session, pr: GREET_PR, diff: GREET_DIFF,
    judge: combinedJudge({ eventId: 'A1', role: 'observation', quote: AGAINST.quote }) });
  const [joint] = report.codeChallenges;
  assert.ok(joint, 'premise: the first window ran a joint challenge');
  assert.equal(joint.eventRepairedVotes ?? 0, 0);
  assert.ok(joint.results.flatMap((r) => r.votes).every((v) => v.valid === false));
});

// ---- 4. the value's cause ---------------------------------------------------------------------------

/** Writes and a command, each with or without a recorded outcome. */
function valueSession() {
  const blobs = {};
  const put = (key, text) => { blobs[key] = text; return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }]; };
  const write = (id, path) => ({ id, kind: 'invocation', callKey: id, tool: 'Write', operation: 'write', paths: [{ path }],
    command: [], input: [], changes: [{ path, before: [], after: put(`${id}-body`, `export const SYNTHETIC_G4_${id} = 3;\n`), diff: [] }] });
  const outcome = (id, result) => ({ id: `${id}-r`, kind: 'observation', invocation: id, callKey: id, phase: 'terminal',
    result, exitCode: null, terminalStatusProven: true, output: put(`${id}-out`, `SYNTHETIC_G4_${id}_RESULT`), sourceOfResult: 'native' });
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: put('ask', 'SYNTHETIC_G4_ASK: add the retry helper.') },
    write('W1', 'src/proven.js'), outcome('W1', 'succeeded'),
    write('W2', 'src/unknown.js'),
    write('W3', 'src/failed.js'), outcome('W3', 'failed'),
    write('W4', 'src/other-unknown.js'),
    { id: 'X1', kind: 'invocation', callKey: 'x1', tool: 'Bash', operation: 'command', paths: [],
      command: put('cmd', 'npm test -- --retries=3'), input: [], changes: [] },
    { id: 'X1-r', kind: 'observation', invocation: 'X1', callKey: 'x1', phase: 'terminal', result: 'succeeded', exitCode: 0,
      terminalStatusProven: true, output: put('xout', 'SYNTHETIC_G4 5 passed'), sourceOfResult: 'native' },
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: 'sess-g4-values', adapter: 'claude', blobs, events });
}
const ground = (session, over) => ledger.groundDecision({ repo: REPO, session, pr: null, instructionHistoryComplete: true,
  candidate: { actorSession: 'sess-g4-values', dimension: 'SYNTHETIC_G4_VALUE', chosen: 'SYNTHETIC_G4 retry count',
    value: null, valueReceipt: null, stated: null, constrainedBy: null, ...over } });

test('M33 G4 the ledger records why a value is unchecked, in a closed vocabulary', () => {
  assert.deepEqual([...ledger.VALUE_UNCHECKED_CAUSES].sort(),
    ['not_proposed', 'unmatched', 'unquoted', 'value_paraphrased', 'write_command_not_run_or_failed',
      'write_outcome_unknown', 'write_unsuccessful']);
  assert.ok(Object.isFrozen(ledger.VALUE_UNCHECKED_CAUSES));
  const session = valueSession();
  const cases = [
    [{ actions: ['W1'] }, { cause: 'not_proposed', action: null }],
    [{ actions: ['W1'], value: '3' }, { cause: 'unquoted', action: null }],
    [{ actions: ['X1', 'W2'], value: '5', valueReceipt: { eventId: 'X1', role: 'action', field: 'command',
      quote: 'npm test -- --retries=3' } }, { cause: 'unmatched', action: null }],
    [{ actions: ['X1'], value: '3', valueReceipt: { eventId: 'X1', role: 'action', field: 'command',
      quote: 'SYNTHETIC QUOTE NOBODY RECORDED 3' } }, { cause: 'unmatched', action: null }],
    [{ actions: ['W2', 'W4'], value: 'src/unknown.js', valueReceipt: { eventId: 'W2', role: 'action', field: 'path',
      quote: 'src/unknown.js' } }, { cause: 'write_outcome_unknown', action: 'W2' }],
    [{ actions: ['W3'], value: 'src/failed.js', valueReceipt: { eventId: 'W3', role: 'action', field: 'path',
      quote: 'src/failed.js' } }, { cause: 'write_unsuccessful', action: 'W3' }],
  ];
  for (const [over, expected] of cases) {
    const out = ground(session, over);
    assert.equal(out.ok, true, JSON.stringify(over));
    assert.equal(out.decision.valueState, 'unchecked');
    assert.deepEqual(out.decision.valueUnchecked, expected, JSON.stringify(over));
  }
  const grounded = ground(session, { actions: ['W1'], value: 'src/proven.js',
    valueReceipt: { eventId: 'W1', role: 'action', field: 'path', quote: 'src/proven.js' } });
  assert.equal(grounded.decision.valueState, 'grounded');
  assert.equal(Object.hasOwn(grounded.decision, 'valueUnchecked'), false, 'a grounded row is unchanged');
});

// D79 (owner decision 2026-10-11): a decision's receipt that is verbatim on the after side of a cited write that
// succeeded is published even when the model's `value` is not word for word in it — the value is null and the closed
// cause `value_paraphrased` says why, so a reader sees the code it wrote. Nothing else about grounding
// loosens: the quote must still be verbatim, on the after side, in a cited invocation, and the write must have
// succeeded.
const WRITTEN = (id) => `export const SYNTHETIC_G4_${id} = 3;`;
const paraphrase = (eventId, over = {}) => ({ actions: [eventId], value: 'SYNTHETIC G4 a constant set to three',
  valueReceipt: { eventId, role: 'code', field: 'added-code', quote: WRITTEN(eventId) }, ...over });

test('D79 a verbatim code receipt is kept when the value is a paraphrase: value null, cause value_paraphrased', () => {
  const session = valueSession();
  const out = ground(session, paraphrase('W1'));
  assert.equal(out.ok, true);
  const { decision } = out;
  assert.equal(decision.value, null, 'the paraphrase is never published as the value');
  assert.equal(decision.valueState, 'unchecked');
  assert.deepEqual(decision.valueUnchecked, { cause: 'value_paraphrased', action: 'W1' });
  assert.deepEqual(decision.valueReceipt, { eventId: 'W1', role: 'code', field: 'added-code', quote: WRITTEN('W1'),
    sessionKey: 'sess-g4-values' }, 'the checked receipt is published, as a grounded one is');
  assert.ok(decision.reasons.includes('value_unchecked') && !decision.reasons.includes('receipt_rejected'),
    `the value is unchecked, the receipt not rejected: ${decision.reasons}`);
  // The row's identity does not hash the receipt: the same decision with its receipt dropped has the same id.
  const dropped = ground(session, paraphrase('W1', { valueReceipt: { eventId: 'W1', role: 'code', field: 'added-code',
    quote: 'SYNTHETIC QUOTE NOBODY RECORDED 3' } }));
  assert.equal(dropped.decision.id, decision.id);
  assert.equal(out.receiptsRepaired, 0);
});

test('D79 near misses: every other failure of the quote still drops the receipt exactly as before', () => {
  const session = valueSession();
  const cases = [
    // The quote is not verbatim in the recording.
    [paraphrase('W1', { valueReceipt: { eventId: 'W1', role: 'code', field: 'added-code',
      quote: 'SYNTHETIC QUOTE NOBODY RECORDED 3' } }), { cause: 'unmatched', action: null }, 'receipt_rejected'],
    // The quote is verbatim, but in a write the decision does not cite.
    [paraphrase('W1', { actions: ['W2'] }), { cause: 'unmatched', action: null }, 'receipt_rejected'],
    // The quote is verbatim on the after side, but the write failed, or its outcome is not recorded.
    [paraphrase('W3'), { cause: 'unmatched', action: null }, 'value_unchecked'],
    [paraphrase('W2'), { cause: 'unmatched', action: null }, 'value_unchecked'],
    // A command's value is its words or nothing: no paraphrase is kept for it.
    [{ actions: ['X1'], value: 'SYNTHETIC G4 the tests with three retries', valueReceipt: { eventId: 'X1',
      role: 'action', field: 'command', quote: 'npm test -- --retries=3' } }, { cause: 'unmatched', action: null },
    'value_unchecked'],
    // A path's value is the complete path or nothing.
    [{ actions: ['W1'], value: 'SYNTHETIC G4 the proven module', valueReceipt: { eventId: 'W1', role: 'action',
      field: 'path', quote: 'src/proven.js' } }, { cause: 'unmatched', action: null }, 'value_unchecked'],
  ];
  for (const [over, expected, reason] of cases) {
    const out = ground(session, over);
    assert.equal(out.ok, true, JSON.stringify(over));
    assert.equal(out.decision.value, null, JSON.stringify(over));
    assert.equal(out.decision.valueReceipt, null, `the receipt is dropped: ${JSON.stringify(over)}`);
    assert.equal(out.decision.valueState, 'unchecked');
    assert.deepEqual(out.decision.valueUnchecked, expected, JSON.stringify(over));
    assert.ok(out.decision.reasons.includes(reason), `${reason} in ${out.decision.reasons}: ${JSON.stringify(over)}`);
  }
  // A literal value on the same write grounds exactly as before.
  const literal = ground(session, paraphrase('W1', { value: 'SYNTHETIC_G4_W1 = 3' }));
  assert.equal(literal.decision.valueState, 'grounded');
  assert.equal(literal.decision.value, 'SYNTHETIC_G4_W1 = 3');
  assert.equal(Object.hasOwn(literal.decision, 'valueUnchecked'), false);
  // A literal value on a write that failed still names the write.
  const failed = ground(session, paraphrase('W3', { value: 'SYNTHETIC_G4_W3 = 3' }));
  assert.deepEqual(failed.decision.valueUnchecked, { cause: 'write_unsuccessful', action: 'W3' });

  // The quote is verbatim in a cited edit that succeeded, but on its before side (a line the edit removed): a removed
  // line is not code the write left, so the receipt is dropped with the value, exactly as before.
  const blobs = {};
  const put = (key, text) => {
    blobs[key] = text;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
  };
  const REMOVED = 'const cache = new SyntheticG4Redis();';
  const ADDED = 'const cache = new SyntheticG4Map();';
  const edited = new Session({ sessionKey: 'sess-g4-values', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: put('ask', 'SYNTHETIC_G4_ASK: swap.') },
    { id: 'E1', kind: 'invocation', callKey: 'E1', tool: 'Edit', operation: 'edit', paths: [{ path: 'src/cache.js' }],
      command: [], input: [], changes: [{ path: 'src/cache.js', before: put('E1-before', `${REMOVED}\n`),
        after: put('E1-after', `${ADDED}\n`), diff: [] }] },
    { id: 'E1-r', kind: 'observation', invocation: 'E1', callKey: 'E1', phase: 'terminal', result: 'succeeded',
      exitCode: null, terminalStatusProven: true, output: put('E1-out', 'SYNTHETIC_G4_E1_RESULT'),
      sourceOfResult: 'native' },
  ].map((event, sequence) => ({ ...event, sequence })) });
  const onEdit = (quote) => ground(edited, { actions: ['E1'], value: 'SYNTHETIC G4 a description',
    valueReceipt: { eventId: 'E1', role: 'code', field: 'added-code', quote } });
  // Premise: the same paraphrase quoting the line the edit added is kept, so the edit is cited and succeeded.
  assert.deepEqual(onEdit(ADDED).decision.valueUnchecked, { cause: 'value_paraphrased', action: 'E1' });
  const removed = onEdit(REMOVED);
  assert.equal(removed.ok, true);
  assert.equal(removed.decision.value, null);
  assert.equal(removed.decision.valueReceipt, null, 'a line the edit removed is never kept as code written');
  assert.equal(removed.decision.valueState, 'unchecked');
  assert.deepEqual(removed.decision.valueUnchecked, { cause: 'unmatched', action: null });
  // The quote itself is in the recording (not `receipt_rejected`): it is the after-side check that drops it.
  const { reasons } = removed.decision;
  assert.ok(reasons.includes('value_unchecked') && !reasons.includes('receipt_rejected'), `${reasons}`);
});

test('M33 G4 an unchecked value records only the cause the ledger found, naming the value\'s own write', () => {
  const session = valueSession();
  const rows = [
    ['NONE', { actions: ['W1'] }],
    ['NONE_ON_COMMAND', { actions: ['X1'] }],
    ['UNQUOTED', { actions: ['W1'], value: '3' }],
    ['WRONG_QUOTE', { actions: ['X1', 'W2'], value: '5', valueReceipt: { eventId: 'X1', role: 'action', field: 'command',
      quote: 'npm test -- --retries=3' } }],
    ['UNKNOWN', { actions: ['W2', 'W4'], value: 'src/unknown.js', valueReceipt: { eventId: 'W2', role: 'action', field: 'path',
      quote: 'src/unknown.js' } }],
    ['FAILED', { actions: ['W3'], value: 'src/failed.js', valueReceipt: { eventId: 'W3', role: 'action', field: 'path',
      quote: 'src/failed.js' } }],
  ].map(([name, over]) => ground(session, { ...over, dimension: `SYNTHETIC_G4_${name}` }).decision);
  assert.deepEqual(rows.map((d) => [d.dimension, d.valueUnchecked?.cause ?? null, d.valueUnchecked?.action ?? null]), [
    ['SYNTHETIC_G4_NONE', 'not_proposed', null], ['SYNTHETIC_G4_NONE_ON_COMMAND', 'not_proposed', null],
    ['SYNTHETIC_G4_UNQUOTED', 'unquoted', null], ['SYNTHETIC_G4_WRONG_QUOTE', 'unmatched', null],
    ['SYNTHETIC_G4_UNKNOWN', 'write_outcome_unknown', 'W2'], ['SYNTHETIC_G4_FAILED', 'write_unsuccessful', 'W3']]);
});
