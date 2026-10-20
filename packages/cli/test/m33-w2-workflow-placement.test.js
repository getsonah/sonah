// M33 W2 (C-03 "M33 W Workflow agents linked", placement at receipt), end to end through the loader a session-only
// review uses. A Claude Code Workflow runs asynchronously: the parent keeps working and receives the run's completion
// later, as a typed task notification joined to the launch by its exact recorded call id and taskId (C-02 M33 D). A
// linked run's agents (their events and reports) are placed where the parent RECEIVED that completion — the earliest
// such recorded receipt of the chain's LAST call — never at the launch, and never by timestamp. With no receipt
// recorded, the agents stand after the launch request's own work (M33 P repair; before it, the launch placement) and
// that is declared under one closed note naming the call's event. Synthetic projects trees (m33-w-workflow-fixture.js, m33-w2-placement-fixture.js); no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger, WORKFLOW_GAP_NOTES } from '../../evidence/adapters/sonah-ledger.js';
// C-01 event identity: sessions are registered, and their events named by positional labels (stable-ids-fixture.js).
import { adapt, named, labelOf, withoutIdentity } from '../../evidence/test/stable-ids-fixture.js';
import { runReview, planWindowRequests } from '../../evidence/src/run-review.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { captureCase, windowNarrative, fixtureJudge } from './m33-fast-profile-fixture.js';
import { modulesBeforeRelayRule } from '../../evidence/test/m33-h-relay-rule-fixture.js';
import { modulesBeforeForbiddenEdit, modulesBeforeDisclosureWords } from '../../evidence/test/m33-n-forbidden-edit-fixture.js';
import { modulesBeforeStatusFact } from '../../evidence/test/status-fact-fixture.js';
import { modulesBeforeHedgedClaims } from '../../evidence/test/h3-hedged-claims-fixture.js';
import { modulesBeforeW1, modulesBeforeW2, modulesBeforeW3, modulesBeforeFixReview }
  from '../../evidence/test/m33-integration-fixture.js';
import { AGENTS, RUN, SID, SLUG, TEXT, linkedRun, mkdir, rm, scratch, writeTree } from './m33-w-workflow-fixture.js';
import { W2_TEXT, captureReceivedCases, receivedLaterRows, resumedRows, verifierBeforeFixRows }
  from './m33-w2-placement-fixture.js';

async function load(t, rowsOf, { run = linkedRun() } = {}) {
  const dir = await scratch('sonah-m33-w2-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'sonah-home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const transcriptDir = join(dir, 'projects', SLUG, SID, 'subagents', 'workflows', RUN);
  const tree = await writeTree(dir, { parent: rowsOf({ transcriptDir }), run });
  const codex = join(dir, 'codex-sessions');
  await mkdir(codex, { recursive: true });
  const ledger = redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex } })).ledger;
  return { ledger, session: adapt(ledger, { sessionKey: 'm33-w2' }) };
}
const text = (session, event, field) => session.textSpansOf(event, field).join('');
// C-01 event identity: an event is shown by its positional label (`labelOf`); `at` finds one by its label or its id.
const ids = (session) => session.events.map((event) => labelOf(session, event.id));
const at = (session, id) => session.events.findIndex((event) => event.id === id || labelOf(session, event.id) === id);
const STALE = `child:${AGENTS.fixer}:A1-1-r`;             // the fixer agent's FAILING run, before the parent's fix
const commentary = (session, words) => session.events.find((event) => event.kind === 'commentary'
  && text(session, event, 'text') === words).id;
const unreceived = (session) => session.adapterGaps.filter((gap) => gap.note === WORKFLOW_GAP_NOTES.unreceived)
  .map((gap) => ({ ...gap, eventIds: gap.eventIds.map((id) => labelOf(session, id)) }));
/** The event a test names by its positional label. */
const ev = (session, label) => session.event(named(session, label));
/** The run's agents' blocks, contiguous: each delegate event, its agent's own events, its report. */
function agentBlocks(session) {
  const order = ids(session);
  const from = order.indexOf('D1-0');
  const until = order.indexOf('D1-1-r');
  assert.ok(from >= 0 && until > from);
  // Told by what each event is — a hand-off, its report, an agent's own event — never by an id's shape.
  const delegates = new Set(session.delegations().map((event) => event.id));
  assert.ok(session.events.slice(from, until + 1).every((event) => delegates.has(event.id)
    || (event.kind === 'observation' && delegates.has(event.invocation)) || event.childId != null), 'contiguous');
  return { from, until };
}

test('M33 W2 the verifier-before-fix shape: the agents stand where the parent received them, before its own fix', async (t) => {
  const { ledger, session } = await load(t, verifierBeforeFixRows);
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2,
    receipt: { turn: 1, beforeEvent: 1, source: 0, record: 4 } }]);
  assert.equal(ev(session, STALE).result, 'failed');
  const { from, until } = agentBlocks(session);
  // After the launch and its result; before the parent's fix (its commentary, Edit) and its passing rerun.
  assert.ok(at(session, 'A1-0-r') < from);
  const fixed = commentary(session, W2_TEXT.fixed);
  for (const later of [fixed, 'A1-1', 'A1-1-r', 'A1-2', 'A1-2-r', commentary(session, W2_TEXT.claim)])
    assert.ok(until < at(session, later), later);
  assert.equal(ev(session, 'A1-2-r').result, 'succeeded', 'the parent\'s passing rerun');
  assert.ok(at(session, STALE) < at(session, 'A1-2-r'), 'the stale failure is never read as after the passing rerun');
  // Identities do not move: only order does.
  assert.deepEqual(session.delegations().map((e) => [labelOf(session, e.id), labelOf(session, e.workflowCall)]),
    [['D1-0', 'A1-0'], ['D1-1', 'A1-0']]);
  assert.deepEqual(session.events.map((event) => event.sequence), session.events.map((_, i) => i));
  assert.deepEqual(unreceived(session), [], 'received: nothing to declare');
});

test('M35 W2 the agents are reviewed as sessions of their own; the parent\'s window shows its fix before its claim', async (t) => {
  // M35 windowing: a helper (here a Workflow agent) is a session of its own, reviewed right after the parent window that
  // launched it; the parent's session never shows the agents' work, and nothing is carried but earlier human messages and
  // thoughts (the carry, `sonah.carry`, is gone). M36 phase 3 (D68 K): small, the agents share the parent's window, each
  // under its own heading — the parent's section still never shows their run.
  const { session } = await load(t, verifierBeforeFixRows);
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  assert.equal(plan.windows.length, 1);
  const parts = plan.windows[0].parts;
  const agents = parts.filter((part) => part.session.helper);
  assert.ok(!parts[0].session.helper && agents.length >= 1, 'premise: the agents are sessions of their own');
  const prompt = plan.requests[0].request.evidencePrompt;
  const parentSection = prompt.slice(prompt.indexOf('### Session 1 of'), prompt.indexOf('### Session 2 of'));
  assert.ok(parentSection.length > 0 && !parentSection.includes('FAIL test/parser.test.js'),
    'the parent\'s section never shows the agents\' run');
  assert.ok(parentSection.indexOf(W2_TEXT.fixed) >= 0 && parentSection.indexOf(W2_TEXT.fixed) < parentSection.indexOf(W2_TEXT.claim));
  assert.ok(prompt.slice(prompt.indexOf('### Session 2 of')).includes('FAIL test/parser.test.js'),
    'the agents\' failing run is in an agent\'s own section');
  assert.ok(agents.every((part) => part.session.parentSegment?.childId === null), 'linked back to the parent');
});

test('M33 W2 a completion received in a later human turn places the agents there', async (t) => {
  const { ledger, session } = await load(t, receivedLaterRows);
  // Rows: 1 ask, 2-3 the launch, 4 the compaction, 5 the second ask, 6-7 the README write, 8 the notification.
  assert.deepEqual(ledger.workflowRuns[0].receipt, { turn: 2, beforeEvent: 2, source: 0, record: 8 });
  const { from, until } = agentBlocks(session);
  assert.ok(at(session, 'I2') < from && at(session, 'A2-0-r') < from, 'after the second request and the README write');
  assert.ok(until < at(session, commentary(session, W2_TEXT.claim)));
  assert.equal(ev(session, 'D1-0').workflowCall, named(session, 'A1-0'), 'still the call\'s helpers');
  // M35 windowing: both turns are one window of the parent's (a compaction no longer splits); the agents are sessions
  // of their own, reviewed right after it — M36 phase 3 (D68 K): small, sharing its window, each as its own part.
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  assert.equal(plan.windows.length, 1);
  assert.equal(plan.windows[0].parts.length, 3);
  const partOf = (label) => plan.windows[0].parts.findIndex((part) => part.events.some((event) => event.id === named(session, label)));
  assert.equal(partOf('A1-0'), 0);
  assert.equal(partOf('D1-0'), 0);
  assert.ok(partOf(STALE) > 0 && plan.windows[0].parts[partOf(STALE)].session.helper, 'the agent\'s run is its own session\'s');
  // (D97: the story's step blocks, which listed the agents under the step that received them, are gone with the story.)
});

test('M33 W2 no receipt recorded: the agents stand after the launch request\'s own work, declared once with the call and its agents', async (t) => {
  for (const rowsOf of [(o) => verifierBeforeFixRows({ ...o, notification: false }),
    (o) => verifierBeforeFixRows({ ...o, status: 'stopped' })]) {
    const { ledger, session } = await load(t, rowsOf);
    assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2 }], 'no receipt recorded');
    const { from } = agentBlocks(session);
    // d7226ec: the C-03 child rule from the call's row, which no Claude action row could carry back (after the parent's
    // rerun, before its closing claim). M33 P put them at their delivery once Claude actions recorded rows — ahead of
    // the parent's later claim, a new false-DECIDE path (recheck minor). M33 P repair: a run is asynchronous; with no
    // receipt it may have finished after any of the parent's later work, so it is never moved back past it.
    assert.ok(at(session, 'A1-2-r') < from && at(session, commentary(session, W2_TEXT.claim)) < from);
    const declared = unreceived(session);
    assert.equal(declared.length, 1);
    assert.deepEqual(declared[0], { code: 'incomplete_inventory', channel: 'children', scope: 'session', count: 2,
      eventIds: ['A1-0', 'D1-0', 'D1-1'], note: WORKFLOW_GAP_NOTES.unreceived, sessionKey: 'm33-w2' });
  }
});

test('M33 W2 a resumed run is placed at the receipt of the LAST call of its chain', async (t) => {
  const { ledger, session } = await load(t, resumedRows);
  // M33 P (W2 recheck minor): the origin's own call recorded a receipt of its own too — counted, and declared.
  assert.deepEqual(ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, resumes: [{ turn: 1, seq: 2 }],
    receipt: { turn: 1, beforeEvent: 4, source: 0, record: 11 }, earlierReceipts: 1 }]);
  const { from, until } = agentBlocks(session);
  assert.ok(at(session, 'A1-3-r') < from, 'after the parent\'s rerun, where the resume\'s completion was received');
  assert.ok(until < at(session, commentary(session, W2_TEXT.claim)));
  assert.equal(ev(session, 'D1-0').workflowCall, named(session, 'A1-0'), 'the origin\'s helpers');
  assert.deepEqual(unreceived(session), []);
  // Which agent's work the parent received at the origin's earlier receipt is not recorded: declared, once.
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.note === WORKFLOW_GAP_NOTES.resumedEarlier)
    .map((gap) => [gap.count, gap.eventIds.map((id) => labelOf(session, id))]), [[2, ['A1-0', 'A1-2', 'D1-0', 'D1-1']]]);
  // The origin's own receipt is not the run's: with no receipt for the resume, the run has none, and is declared.
  const none = await load(t, (o) => resumedRows({ ...o, resumeNotification: false }));
  assert.deepEqual(none.ledger.workflowRuns, [{ turn: 1, seq: 0, linked: 2, resumes: [{ turn: 1, seq: 2 }] }]);
  assert.deepEqual(unreceived(none.session).map((gap) => gap.eventIds), [['A1-0', 'D1-0', 'D1-1']]);
});

/**
 * Base d7226ec, captured ONCE by running `captureReceivedCases` (m33-w2-placement-fixture.js, node built-ins only)
 * against the d7226ec tree with only that fixture added, twice at different temp paths (identical). A linked run whose
 * completion was received right after its launch keeps its agents where they stood: its event order, gaps, every
 * planned and sent review request, and story keep d7226ec's bytes (its ledger moves: the run record names the receipt).
 */
const BASE_D7226EC = Object.freeze([
  { name: 'received', events: '9d68a17b72966a50226ca6da5394054fd9322f48cac067a51ea14804b5273d8c',
    gaps: '0de86fd55c4c6a55837687ea1e972dd63bb5c44864071cf431cc896f10559d4a', windows: 1,
    planned: '0c4ee59611c6e28f2af643649cac5abf24c8ad1e4c8a94e432edaeff4a144b42', sentCount: 5,
    sentInOrder: '1e70b63473863ee4c8775d63b0e3bb3828b1f60ef474287465495168aee09fff',
    sentSorted: '06459a8aa2782b2d7225369e119b4762a10edfa7bff0a4df89266c994b1f1ca4',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73', windowFailures: '',
    story: '2ba8fdc6e22cc44b304c6e5dd46518986566f34e0d670af21796e67414eb090b' },
]);

// M33 C2 (sonah.challenge/9, merged beside M33 W2) moved the challenge request bytes on purpose: a claim item is shown
// as its grounded verbatim words, with the model's text as the reviewer's reading. Only `sentInOrder` and `sentSorted`
// moved; order, gaps, windows, the planned (narrative) requests, labels and story keep d7226ec's bytes, which is what
// this test guards. The pins above stay as history; these are the same capture on the merged tree.
const MOVED_BY_M33_C2 = Object.freeze({
  sentInOrder: 'fc06d08776e324b5c39df15b3f99b84fa73bad67c0d2dbe02301dc2a1937a5ad',
  sentSorted: 'a4f92f8791f237694872cbce1701f0bd344b0498c5f7a0750d3a6ba49aa6ceb7',
});

// M33 H's repair (sonah.narrative/13, sonah.challenge/10: a relay of another agent's report is the passing agent's own
// claim) moved the narrative and challenge request bytes on purpose, by the relay rule's words alone (`planned`,
// `sentInOrder`, `sentSorted`). Rendered back as /12 and /9 sent them (m33-h-relay-rule-fixture.js), the capture is
// M33 C2's byte for byte; order, gaps, windows, labels and story did not move.
const MOVED_BY_M33_H = Object.freeze({
  planned: '18ef32bf1033dfb4b60a82e64282c70a657767b0f6cc69191260ee62b4703a4b',
  sentInOrder: '26f02ed9f9cadd60072a50967faf9741acef8dcb69ccd3afbacfdf68f798768b',
  sentSorted: '677218ef92dc7d63acd4497e4a69eb77f56666c9c7c47b62c790cd6014c8322e',
});

// M33 brittleness H4 (C-06 decision order: every decision made without asking leads, whatever its materiality) moved
// the story on purpose, by one line alone: the counts row's header reads "Decided without asking", no longer "Decided
// without asking (behaviour or structure)". Order, gaps, windows, every planned and sent request and labels did not move.
const MOVED_BY_H4 = Object.freeze({
  story: '5865cce85fe22f8320a87c59e4f11ea9bb26767d64bfc9dad7ae2cbf0e330fb4',
});

// H1 (a command's status from structure only) moved the bytes that show one helper's
// `npm test` result: a sub-agent recording writes no typed status, and its pass was read from output text, so it is now
// `unknown`: the narrative and challenge requests (`planned`, `sentInOrder`, `sentSorted`) and the story's test line, at
// both render-back levels. Order, gaps, windows, labels and events did not move.
const MOVED_BY_H1 = Object.freeze({
  n13: { planned: 'ea1a9bda218929b5a5bf052bda6481c992569681f97364d68d677c83736fc8dd',
    sentInOrder: '948c02f8a398ec5fcf833fecaa3616515ca06eb028aed82ceddbf54cc4c1da39',
    sentSorted: '0665a81aeb6ddcf9df7c8c0faba94722ae5b5e732092086b4de2cad0ce52db5f',
    story: '82843907cccb43578a46e9c251592479c3349a7da2ecd4fa9954676ce55bad09' },
  n12: { planned: '5255c2d6013f6b9c5bba0973bd18caa59c838f5e4f4326de96efb9ae140d8fe9',
    sentInOrder: '15f36fd61e37c547303f2d2dd90ea0cff0f381fae90019efbb58e49d2fa83cb3',
    sentSorted: '81b0579ad63ffd26efc697055212d2b35ce4a5cb753868e95fada9294acca411',
    story: '82843907cccb43578a46e9c251592479c3349a7da2ecd4fa9954676ce55bad09' },
});

// M1: the parent's `npm test` is a `bash` command, no longer `test` — the requests that show
// its action (`tool=bash`) and the story, whose step no longer says "ran tests", moved again, at both render-back levels.
const MOVED_BY_M1 = Object.freeze({
  n13: {'planned': '573b38f2ee5861da8b831fc8695f33de0c443b4e417b2025e23979725cbefd6f',
    'sentInOrder': '85408fab72daca4787013686dfc5d3284e8552e4bf456b794394c71cd174bec3',
    'sentSorted': 'e1f284f7e80424886aeebf68a2d7a11d4f7fcd4f704f867a092d2333281c3ff9',
    'story': 'ba3d98be332b8af264ec0fbb3b483ffeb6a8b4fb6b3170e0c3fecd5005c1c368'},
  n12: {'planned': 'e56b92982c65163eb522a0b6a5d33249f8606db8a4801ee20fdb37b5b9f759ed',
    'sentInOrder': '78c0cca40d97d75643de096237eedefe7387117c0bc67048909aca8c72a383cf',
    'sentSorted': 'e1846a2b629e839aa15b61b8b631b7808fc7a22f4b6f578b7d8683c1617048e8',
    'story': 'ba3d98be332b8af264ec0fbb3b483ffeb6a8b4fb6b3170e0c3fecd5005c1c368'},
});

// H3 (sonah.narrative/16, sonah.challenge/13: a claim is every statement the agent makes
// about the state or the outcome of its work, hedged or not) moved the narrative and challenge request bytes on purpose,
// by the claims definition's words alone (`planned`, `sentInOrder`, `sentSorted`, as /16 and /13 send them). Rendered
// back as /14 and /11 sent them (h3-hedged-claims-fixture.js), then as /13 (M33 N), the capture is M33 H's byte for
// byte; order, gaps, windows, labels and story did not move.
// H3's review repair (2026-10-06; /16 and /13, were /15 and /12) re-pinned these values once, in place: the relay and
// supportedBy rules' example phrasings are gone and a hedge on a relay is not doubt — the same requests moved, by the
// same fixture's texts, and the render-back still reproduces the values before H3.
// The owner's decision of 2026-10-06 (still /13) re-pinned the capture once more, in place: CLAIM_WORDS_NOTE lists no
// kinds of statement (the quoted text may narrow what the words assert and never widens it), so only `sentInOrder` and
// `sentSorted` moved, by the same fixture's text; the render-back still reproduces the values before H3.
const MOVED_BY_H3 = Object.freeze({
  planned: 'f2a65d2fdf9b9cff0b1180e3fcc21c13a29dbd9a01791f3774cc5873dfd8fae8',
  sentInOrder: 'f6309d631874bc81e1a4c126e8336d36009e2a8a4f3b5e74dad84302e564e05e',
  sentSorted: 'c4fd2a5f3f48703c42be132f7e2e9852f3adb16dc1ebb930b219b50da801fd0b',
});

// M33 integration (2026-10-06; `sonah.narrative/17`, `sonah.challenge/15`, `sonah.session-story/7`): the ONLY values no
// branch's constant above holds — the story, which H4's header, H1's unknown helper status and M1's step moved together
// (at every render-back level: a story renders no request), and the narrative and challenge requests as the merged code
// sends them (H3's, the status fact's, G3's and M3's texts with H1's and M1's moves). Rendered back through every
// branch's fixture, the requests are H1's and M1's, byte for byte.
const MOVED_BY_INTEGRATION = Object.freeze({
  story: Object.freeze({ story: '0199969c5535a2ab26f529a1e50b07be05b8b4ca4956e56ddb9d2c2e830887cf' }),
  current: Object.freeze({ planned: '979066c4c175c286ad4475bf2ad3bbb529f04dcfe2981a20c5efc65f09262184',
    sentInOrder: '6a3deead54c59b0c54c7eab7c2f92cf0525005a8ccc02bd4f27bbb6bcfea6ff2',
    sentSorted: 'ebbe6038fbbceb4c15e2984775a3461236619dc6d863064bb56ed91812bebb24',
    story: '0199969c5535a2ab26f529a1e50b07be05b8b4ca4956e56ddb9d2c2e830887cf' }),
});

/**
 * Stable event ids (C-01 event identity, 2026-10-07; `sonah.narrative/19`): every event of the sliced case is named by
 * its row's uuid and block, so its events' ids (`events`, with their order unchanged), its gaps (they name events), its
 * narrative and challenge requests and its story (the fixture judge's synthetic claims quote event ids as their words)
 * moved — by the ids alone: adapted with the identities taken out (`positional`), the capture is the values pinned
 * before, at every render-back level (the test below). No window count, number of requests, label or failure moved.
 */
const MOVED_BY_STABLE_IDS = Object.freeze({ events: 'd608427d3711c6bf7ac830bcc44dcb7b51953a2c39e2684183b39c7c1ecfdb30',
  gaps: '7572f4124aa41daf9e9499ed49085cba39e03a8077c167860c91f64b7cbe5f7c',
  planned: 'e5f29eaacd0f285029c246a0fa59dcc600ea91a52a9772099f0a42ff42dc1e6c',
  sentInOrder: '8e123c0293998475df3640dc4a1e18290994a3ca16d3331b33bd3181936daffe',
  sentSorted: '7026772b6872b7589a58fdf4c3611e34964a415e8ba1bf455dbc296db787a74d',
  story: '1047a9a90b99143a9ba13a5786c42215464477eca4c3467e41b00bc9d0f308d2' });

/**
 * D64 wording (owner decision 2026-10-07; `sonah.narrative/20`): every session-only narrative request's item 6 sentence
 * and output-contract rule ask for the agent's statement that it went against the human's instruction, so the case's
 * narrative requests moved by those two texts alone: `planned`, `sentInOrder`, `sentSorted`. Rendered back
 * (`modulesBeforeDisclosureWords`), the capture is the values pinned before, at every level (the tests below). No event,
 * gap, story, window count, number of requests, label or failure moved.
 */
const MOVED_BY_DISCLOSURE_WORDS = Object.freeze({
  planned: '5366b462010e334cb2b1372d52de318f392cecd5370319026be126cac1a0a3cc',
  sentInOrder: 'eb1055f4f8ebf78aff1e2477ef232a16a3e2ed022c0022a5cc7be9ac88867615',
  sentSorted: 'a95792fa350ef8c0082801d9ba5a3d6ff8c31ef034a08402459050ea881fb1df' });

/**
 * M35 windowing (C-07 "M35 windowing"; `sonah.narrative/21`, `sonah.challenge/18`): the ONLY values that moved from
 * `MOVED_BY_DISCLOSURE_WORDS` — the agents are sessions of their own, so the case is three windows (the parent's and
 * its two agents'), its narrative and challenge requests (`planned`, `sentCount`, `sentInOrder`, `sentSorted`), their
 * labels, and its story (a story's steps follow the windows). No event or gap moved. A text render-back can no longer
 * reproduce an older capture (every window moved), so the captures before this one are kept as the record.
 */
const MOVED_BY_WINDOWING = Object.freeze({ windows: 3,
  planned: 'afc9e83f0a1f3d7226a324448158de3fa475619726fb5311c40b48e116b86163', sentCount: 15,
  sentInOrder: '1a3fd4998fe098a8d2d4fcfd1656179545ac33d1b3467e18963782f493eaa1e1',
  sentSorted: '50880cd3e55ac680d2b2c7516953bfae5132e2d48c6db7b61c9842c3d1a4857a',
  labels: 'b58058c4f3235b0b89b79783c2fdecd9476ac2d5e1e4da2dd3e5103a0b483547',
  story: '2cc210ffe43a831ead9a00fcc6b9bb6269b6793a4eef62a9f028a34296dc1a0e' });
/**
 * M36 phase 2, the window format (D68 L; C-07 "M36 window format"; `sonah.narrative/23`, `sonah.challenge/20`):
 * the ONLY values that moved from `MOVED_BY_WINDOWING` — the case's narrative and challenge requests (each RESULT opens
 * with its label line built from the recorder's typed fields). No window, request count, label, story, event or gap
 * moved.
 */
const MOVED_BY_M36_FORMAT = Object.freeze({
  planned: '06cd4115954b5bd94d200d9b3b7bd6c7a6102fe8cedade2f6b9158358e73e09a',
  sentInOrder: '18fc44f3cb0ab0cc71d1da13348ec55c1575b38ca622d012a4586b7a72cafe20',
  sentSorted: 'd18239e247f6e383bb01832f8659ab264503651c0695eb62e850801e7b34c7dd' });

/**
 * M36 phase 3 (D68 K, Q, F; C-07 "M36 packed windows"; `sonah.narrative/24`, `sonah.challenge/21`,
 * `sonah.session-story/10`): the ONLY values that moved from `MOVED_BY_M36_FORMAT` — the agents are small sessions, so
 * they share the parent's window, each under its own heading: one window, its narrative and challenge requests
 * (`planned`, `sentCount`, `sentInOrder`, `sentSorted`), their labels, and its story (a story's steps follow the
 * windows). No event or gap moved.
 */
const MOVED_BY_M36_CONVERSATION = Object.freeze({ windows: 1,
  planned: '5a92d4e08940ee8593374776a4a3a60143ff37807d9a6cab9c09f101f32a8cbf', sentCount: 5,
  sentInOrder: 'abb692715e770a0bd17fa846b9f142db5fd52ec6163586a6c4a7cc61d3b1d424',
  sentSorted: '069490ea9724397b45365f29b1966fa0473062d33334007a92d42c1e9af31731',
  labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
  story: '59ffaee36c82a17dcb44d65ba3e698c93908e3a4b72f0e42d697621f96443d54' });
/** D71 (a), owner decision 2026-10-08 (no verdict anywhere the human sees): the ONLY value that moved — the story, which
 *  names every finding "Finding" under one heading and says whether the review completed, never a status. No event,
 *  gap, window, request or label moved. */
const MOVED_BY_D71 = Object.freeze({ story: 'cda1cd1cfd11391f8a41fd679c7d14e7f71a1c7024cbc07f8cf45d2426d5187e' });

/** D71 (S2, the reviewer brief as the checklist): the ONLY values that moved — the window's narrative and challenge requests
 *  (the brief, the checklist window format, one proposition per item: nothing renders them back) and its story (the
 *  human's message no row of the answer cites is code's own not-checked row now). No event, gap, window or label moved. */
const MOVED_BY_D71_BRIEF = Object.freeze({ planned: '605f6becbc0529e8c54069e1dc439bc9a4486c08b569c413a4921be962af392f', sentInOrder: '8a2d63e3e892a5923db9ee77f2c495aa57ff53f0db5dd29f8a2abc66df6e5a14', sentSorted: '1413abd4ca3181488d1c53463789e5761cdae1832c976026be908d8e3e48e52f', story: '6d25fc484866016a52a872f28e60ab62a664fc756a900a2714dff7de80d3d127' });

/** D71 (S3, the new channels): the ONLY values that moved from D71 (S2)'s — every case's narrative requests ("About this
 *  window" lists the RESULTs step 4 answers for; the brief's last step is step 6; the brief itself) and challenge requests
 *  (the session core's sixth role, the claim note). Nothing renders them back; no other value moved. */
const MOVED_BY_D71_CHANNELS = Object.freeze({ planned: '14d0f85116bb8bd97c150f2e14ba7200dc7def6ad68ed59d5f73bc2218f0817d', sentInOrder: 'e536a3b098d2ae36e8b67a9c4d29df271f956efae3d25cf86e36cf3d809f875b', sentSorted: '2fc1b76300979a171e98435ab243d27eddb5219544a186ef7fe178afdc5b7993' });

/** S6 (the fixes of the S5 review): the ONLY values that moved from S3's — the window's narrative requests (the brief: a
 *  choice not to act with no actions, a claim's `restsOn`) and its story (a proposal whose challenge did not settle is
 *  kept with its weakest status: S5 review H1, owner decision D71 b). Nothing renders them back; no other value moved. */
const MOVED_BY_D71_FIX = Object.freeze({ planned: 'fbcf04e8f5042f6b754aabd2738cae62525c05b382d98e8c987bce4cedb5e454', sentInOrder: '92e26a135e08feca4fcc310d435673ee2738dcf468692f58ea7a79419b5f8526', sentSorted: '1e153e9df97f7be234c6865a071cf4b68f6a4ea66fc8658ff40302c2138b4b8c', story: 'e9620d5f4e6669f49a14a1af32c3e8a64f59f0cc07642cd7e4c53dae9e5eef52' });

/** S7: the ONLY values that moved from S6's — the window's requests (the brief's
 *  restsOn and step 4 sentences, the failures line and the failure note). Nothing renders them back; no other value moved. */
const MOVED_BY_S7 = Object.freeze({ planned: 'c00b2d1ccb0284b540ecd3319ae979edfa9572914f8084e422f3f4dbbcaa2bb1', sentInOrder: 'abc634541ca82dd36d53a8f1a2b59efd7afd337085d9aa2d7403a19baef8695d', sentSorted: 'd375f04a7905eb1c4328f431d86865ffb474e1b064f8db7a9eeeac43de3a1820' });

/** The column fix (owner decisions D83 (2) and D84): the ONLY values that moved from S7's — the window's requests
 *  (the brief says who decided a decision; D84: and that "made without asking you" checks the shown
 *  project instruction files too; 2026-10-13: and that "you settled it" is words that state the choice's own answer,
 *  and DECISION_NOTE never says to refute a decision those words settle, D84 (3); the settled-words gain: and that such
 *  a choice is reported settled at the level the words address). Nothing renders them back; no other value moved. */
const MOVED_BY_FIX_COLUMN = Object.freeze({ planned: '92395349a8ff7c4c626647ff116bb83d993b0766ae3957e101763121fa847cea',
  sentInOrder: 'dcd2a8b4bea15a6b63a21454a8718f0dff9f677454d25089ab32b94c4bf71da8',
  sentSorted: '6eec3578f462fdd13fafdd65173126d33233edde20c29c7a42c495ef1da8491f' });
/** The asks fixes (P1): the ONLY values that moved from the column fix's — the window's requests, by the brief's one
 *  sentence on a run the human asked for, refused at every attempt (`sonah.session-review-agent/9`). S3 moved none.
 *  Nothing renders them back here; no other value moved. */
const MOVED_BY_ASKS_FIXES = Object.freeze({ planned: '74b9b6b264688ef16b110f46d984a216b4814fbf1fc6365f36d4009207ece484',
  sentInOrder: 'b5f720c9c5ecc656da58417090a265dc89c97fb568e866ad876f6161cbe47691',
  sentSorted: '0f70535cdb469c7b759f33ce59258cef38465eed1e415120665bce1172878b00' });

/** W1 B: the ONLY values that moved from the asks fixes' — the window's requests, by the brief's texts (W1_TEXTS;
 *  `sonah.session-review-agent/10`). W1 A moved none. Rendered back (`modulesBeforeW1`), the asks fixes'. */
const MOVED_BY_W1 = Object.freeze({ planned: '4b3af61c33190a31f131f42144dba0fb8704daf211bff71c2806b5472e588c97',
  sentInOrder: '3c497adcbc668955727b14e32d3e6e69f67d8d9e051a8f0176ec78d614ed8da1',
  sentSorted: '3638e9e94b67f6ad306e37acecf325b665a6874b9c5fc244f4f556d82e133b48' });

/** W2 (3): the window's requests moved once more, by the brief's texts (W2_TEXTS; `sonah.session-review-agent/11`) and,
 *  in a batch holding a claim-class item, CLAIM_NOTE (`sonah.challenge/32`). Rendered back (`modulesBeforeW2`), W1's. */
const MOVED_BY_W2 = Object.freeze({ planned: '89c47c64ae704bb72e6507ee5ad9d6bbf153336ad18fe86d2ce9567ed8b58926',
  sentInOrder: '8f71b0cd0ff03bca54ff819cc9660f10c2c4bc5ae6d6736ab89bf609e9d7d10d',
  sentSorted: '3828a25c1d6c65807c9f11b7177d16faf1f55a5d106dd418098cc2ff4095d8c8' });

/** W3 F1(b) and F2: the challenge requests moved once more, by CLAIM_NOTE's changed-since criterion and its
 *  failed-result sentence (W3_TEXTS; `sonah.challenge/34`), in a batch holding a claim-class item; no narrative request
 *  moved. Rendered back (`modulesBeforeW3`), each is W2's. */
const MOVED_BY_W3 = Object.freeze({ planned: '89c47c64ae704bb72e6507ee5ad9d6bbf153336ad18fe86d2ce9567ed8b58926',
  sentInOrder: '399e4b93fac8e7014a98d87e08eda79355a114591e89b92490c1934cf312a30e',
  sentSorted: 'fd00192739e1d55439cc4952bd092902e14ca78e27d7e66c3f356ff5a1a97757' });

/** The fix review: the challenge requests moved once more, by CLAIM_NOTE's failed-result sentence (FIX_REVIEW_TEXTS;
 *  `sonah.challenge/35`), in a batch holding a claim-class item; no narrative request moved. Rendered back
 *  (`modulesBeforeFixReview`), each is W3's. */
const MOVED_BY_FIX_REVIEW = Object.freeze({ planned: '89c47c64ae704bb72e6507ee5ad9d6bbf153336ad18fe86d2ce9567ed8b58926',
    sentInOrder: '2b28ea4edf1614a863e1953339aa528bb38e8eaf0a278f930b13103130cad8e3',
    sentSorted: '9c2b223bd8d576c7295e7bf5170d4ab109abcd470f5b166879bd61bd90b1aa65' });

/** D88 (owner decision 2026-10-14; story /25): the story, by its order alone — the agent's judgment first, the rows
 *  Sonah could not check folded under their own heading last. Nothing renders a story back, so every capture below
 *  carries it. No event, gap, request, label, window or window failure moved. */
const MOVED_BY_JUDGMENT_FIRST = Object.freeze({ story: '2d84734edd969da9190af23c669189474c6d1d8ddb476374d65aaa55d92ab249' });
/** D90 (owner decision 2026-10-15; story /30, the agentic code step's release item): the story, by its footer alone — it
 *  is generated from the recorded session, no longer "from a redacted recording" (nothing is masked for a person).
 *  Nothing renders a story back, so every capture below carries it. No event, gap, request, label, window or window
 *  failure moved. */
const MOVED_BY_AGENTIC = Object.freeze({ story: '227151e0e18c31522b5a23f7c3ff20f33249f2653a26434df214fef4f56dad0d' });
/** D97 (STE at about 80%): the story, by the fixed words it reads from review.js and code-report.js alone (the attention
 *  lines, the folded section, the coverage causes and the code review's words, rewritten in STE). Nothing renders a
 *  story back, so every capture below carries it. No event, gap, request, label, window or window failure moved. */
const MOVED_BY_STE = Object.freeze({ story: 'f6452c9f190a3d1c00cf9933e1336b164d1c74a4fd327e3f4fff5b8918ae5cc8' });
/** D97 (owner decisions 2026-10-16; story /32): the story, by what it is — the report .md, the report model rendered for a
 *  pull request comment. Nothing renders a story back, so every capture below carries it. No event, gap, request, label,
 *  window or window failure moved. */
const MOVED_BY_REPORT_MD = Object.freeze({ story: 'd39b11f72ecddeeb2cdbc0b51471a995bd3aaa4b274c08cb6238babcf1241652' });
/** D97 (the review of the .md and its samples, story /32 unreleased): the story, by the report's fixes alone — the word
 *  count, the prompt table's one coverage line, code spans, labels that name their item, a repository's missing links
 *  said once, the tiers of "you asked, the agent decided how" (D96 amended). Nothing renders a story back, so every
 *  capture below carries it. No event, gap, request, label, window or window failure moved. */
const MOVED_BY_MD_FIXES = Object.freeze({ story: 'bedeb96d8cbfcfb5277b6e40eaddd4da4db971d4e330805aef0b732f56867056' });
/** The beta.2 release check's render fixes (story /32 unreleased): the story, by the report's words alone. Nothing
 *  renders a story back, so every capture below carries it. No event, gap, request, label, window or window failure
 *  moved. */
const MOVED_BY_RELEASE_CHECK = Object.freeze({ story: 'ba8cadaed32ef4010cab0a325436ff53764ff189e1defc587c06c44b21cc795f' });
/** D100 (the audit of absence sentences, story /35): the story, by the report's words alone — the header's results and
 *  the runs say "Sonah read no exit code", your settled decisions what Sonah found, and what Sonah could not check what
 *  Sonah holds or could not read. Nothing renders a story back, so every capture below carries it. No event, gap,
 *  request, label, window or window failure moved. */
const MOVED_BY_ABSENCE_AUDIT = Object.freeze({ story: '587382958014dde455f4216f024a99265d3254c344d37e615b916bd756e56b28' });
/** D101 (owner decision 2026-10-17; story /36, report model /2): the story, by the report model's version in its footer
 *  alone (no ask of this case is lowered at the quote gate, so no cause's words show; rendered with the model's /1, it is
 *  MOVED_BY_ABSENCE_AUDIT's, byte for byte). Nothing renders a story back, so every capture below carries it. No event,
 *  gap, request, label, window or window failure moved. */
const MOVED_BY_GROUNDING_CAUSES = Object.freeze({ story: 'facea3446d08092752a1e2546b9340f88f2298e3967d21f5142e4993b0ba4549' });
/** D104 (F5 part 4, the mark; story /37, report model /3): the story, by the report model's version in its footer alone —
 *  the case holds no result a window showed in part (rendered with the model's /2, it is MOVED_BY_GROUNDING_CAUSES's, byte
 *  for byte). Nothing renders a story back, so every capture below carries it. No event, gap, request, label, window or
 *  window failure moved. */
const MOVED_BY_SEEN_IN_PART = Object.freeze({ story: '6b9c1c22f0c7f7be14efe09fdd8291cd5269f3edf029973a703d41a51d746a22' });
/** Bucket B's one move of the story (story /38, report model /4): D105 (one request, one bound, a manifest) and D107
 *  (F3a, the repair kept by identity) move it together, once: the story, by the report model's version in its footer
 *  alone — the case runs no code step, so no seen line and no withheld item of a code review shows (rendered with the
 *  model's /3, it is MOVED_BY_SEEN_IN_PART's, byte for byte). Nothing renders a story back, so every capture below
 *  carries it. No event, gap, request, label, window or window failure moved. */
const MOVED_BY_ONE_BOUND = Object.freeze({ story: 'c43076953b96f780661dd23efc880d74ad8fbb26994f5cff6b7f72c4bae68dbc' });
/** 0.3.0-beta.5's one move of the story (story /39, report model /5): the story, by three lines alone — the
 *  end-of-recording fact's words beside the ask not checked (D115: what the row cites); the two asks of the helper's
 *  brief, which the story called asks that Sonah could not read, now named as asks that an agent wrote into a helper's
 *  brief (code-context.js `askSourceOf` on the recording as a review loads it); and the report model's version in its
 *  footer. The case runs no code step, so no line of the code review shows (D113, D114) and no question points
 *  anywhere (D116). On its lane, D113 and D114 moved it by the footer alone; joined, each reader moves once, so this is
 *  the one value. Nothing renders a story back, so every capture below carries it. No event, gap, request, label,
 *  window or window failure moved. */
const MOVED_BY_REPORT_TRUTH = Object.freeze({ story: 'e62f59c639b3dc948d75e10632d623c6e94abe797a106128ecac484a4d1d0396' });
/** D118 (the owner's go of 2026-10-18; the dogfood's DF2): the story, by one line alone — the first screen's "No code
 *  was reviewed." with its reason, right after the size line (the case runs no code step: its reason `step_off`, beside
 *  the items' line), in place of the old no-code line after what Sonah did not check. The case declares no kind of
 *  evidence that D119 splits, and its one list holds files, so nothing else moves. The story's version and the report
 *  model's do not move (each moved once since beta.4). No event, gap, request, label, window or window failure moved. */
const MOVED_BY_FIRST_SCREEN = Object.freeze({ story: '14c55c450096b8d44b008865abcd4a60d5e6755f161c5128105afb13b1fa21a3' });

test('C-01 stable event ids: a run received right after its launch, as this tree sends it — moved by the ids alone', async () => {
  const modules = { loadSessionEvidence, redact, sessionFromLedger, runReview, planWindowRequests, captureCase,
    windowNarrative, fixtureJudge, renderStory: renderReportMarkdown };
  const stable = BASE_D7226EC.map((base) => ({ ...base, ...MOVED_BY_M33_C2, ...MOVED_BY_M33_H, ...MOVED_BY_H4,
    ...MOVED_BY_H1.n13, ...MOVED_BY_M1.n13, ...MOVED_BY_H3, ...MOVED_BY_INTEGRATION.current, ...MOVED_BY_STABLE_IDS }));
  // As the code sends it: moved by the D64 wording's two texts (MOVED_BY_DISCLOSURE_WORDS), then by M35 windowing
  // (MOVED_BY_WINDOWING). The texts rendered back reproduce no capture before M35 (every window moved): `stable` and
  // the values before it are the record.
  const current = await captureReceivedCases(modules);
  const asksFixes = stable.map((c) => ({ ...c, ...MOVED_BY_DISCLOSURE_WORDS, ...MOVED_BY_WINDOWING,
    ...MOVED_BY_M36_FORMAT, ...MOVED_BY_M36_CONVERSATION, ...MOVED_BY_D71, ...MOVED_BY_D71_BRIEF, ...MOVED_BY_D71_CHANNELS,
    ...MOVED_BY_D71_FIX, ...MOVED_BY_S7, ...MOVED_BY_FIX_COLUMN, ...MOVED_BY_ASKS_FIXES, ...MOVED_BY_JUDGMENT_FIRST,
    ...MOVED_BY_AGENTIC, ...MOVED_BY_STE, ...MOVED_BY_REPORT_MD, ...MOVED_BY_MD_FIXES, ...MOVED_BY_RELEASE_CHECK,
    ...MOVED_BY_ABSENCE_AUDIT, ...MOVED_BY_GROUNDING_CAUSES, ...MOVED_BY_SEEN_IN_PART, ...MOVED_BY_ONE_BOUND,
    ...MOVED_BY_REPORT_TRUTH, ...MOVED_BY_FIRST_SCREEN }));
  // W1 B: moved once more (MOVED_BY_W1); rendered back (`modulesBeforeW1`), the asks fixes', byte for byte.
  // D88: the story moved once more (MOVED_BY_JUDGMENT_FIRST), in every capture: nothing renders a story back; and D90
  // once more (MOVED_BY_AGENTIC), the same way; and D97 once more (MOVED_BY_STE), the same way; D97 once more
  // (MOVED_BY_REPORT_MD), the story now the report .md; and once more (MOVED_BY_MD_FIXES), by the report's fixes; and
  // once more (MOVED_BY_RELEASE_CHECK), by the release check's render fixes; and once more (MOVED_BY_ABSENCE_AUDIT), by
  // the audit of absence sentences; and D101 once more (MOVED_BY_GROUNDING_CAUSES), by the report model's version; and
  // D104 once more (MOVED_BY_SEEN_IN_PART), by the report model's version in the footer; and bucket B (D105 and D107)
  // once more (MOVED_BY_ONE_BOUND), the same way; and 0.3.0-beta.5 (D113 to D116) once more (MOVED_BY_REPORT_TRUTH),
  // by the fact's words, the asks of a helper's brief named so, and the model's version; and D118 once more
  // (MOVED_BY_FIRST_SCREEN), by the first screen's no-code line.
  // W2: moved once more (MOVED_BY_W2); rendered back (`modulesBeforeW2`), W1's, byte for byte.
  // W3 F1(b): moved once more (MOVED_BY_W3); rendered back (`modulesBeforeW3`), W2's, byte for byte.
  // The fix review: moved once more (MOVED_BY_FIX_REVIEW); rendered back (`modulesBeforeFixReview`), W3's, byte for byte.
  assert.deepEqual(current, asksFixes.map((c) => ({ ...c, ...MOVED_BY_W1, ...MOVED_BY_W2, ...MOVED_BY_W3,
    ...MOVED_BY_FIX_REVIEW })), 'as the code sends them');
  assert.deepEqual(await captureReceivedCases(modulesBeforeFixReview(modules)),
    asksFixes.map((c) => ({ ...c, ...MOVED_BY_W1, ...MOVED_BY_W2, ...MOVED_BY_W3 })), 'as W3 sent them');
  assert.deepEqual(await captureReceivedCases(modulesBeforeW3(modules)),
    asksFixes.map((c) => ({ ...c, ...MOVED_BY_W1, ...MOVED_BY_W2 })), 'as W2 sent them');
  assert.deepEqual(await captureReceivedCases(modulesBeforeW2(modules)), asksFixes.map((c) => ({ ...c, ...MOVED_BY_W1 })),
    'as W1 sent them');
  assert.deepEqual(await captureReceivedCases(modulesBeforeW1(modules)), asksFixes, 'as the asks fixes sent them');
  assert.deepEqual(current.map(({ events, gaps }) => ({ events, gaps })), stable.map(({ events, gaps }) => ({ events, gaps })),
    'M35 moved no event and no gap');
});

test('M33 W2 a run received right after its launch keeps d7226ec\'s order and gaps', async () => {
  // C-01 event identity: adapted as before stable ids (the ledger's identities taken out), at every level below; and the
  // D64 wording's proposer sentences rendered back as /19 sent them (`modulesBeforeDisclosureWords`).
  const modules = modulesBeforeDisclosureWords({ loadSessionEvidence, redact,
    sessionFromLedger: (ledger, options) => sessionFromLedger(withoutIdentity(ledger), options), runReview,
    planWindowRequests, captureCase, windowNarrative, fixtureJudge, renderStory: renderReportMarkdown });
  // M33 N (`sonah.narrative/14`) moved every session-only narrative request by its three forbidden-edit texts alone:
  // rendered back as /13 sent them (`modulesBeforeForbiddenEdit`), the capture is M33 H's, byte for byte. H3 moved them
  // once more (MOVED_BY_H3), and the status fact: their texts are rendered back first (`modulesBeforeStatusFact`,
  // `modulesBeforeHedgedClaims`).
  // M35 windowing moved every window (MOVED_BY_WINDOWING): the request and story captures rendered back reproduce no
  // value before it, and are kept above as the record. What no windowing touches is still d7226ec's, at every level:
  // the order of the events and the gaps.
  const back = (mods) => modulesBeforeForbiddenEdit(modulesBeforeStatusFact(modulesBeforeHedgedClaims(mods)));
  const placement = (cases) => cases.map(({ name, events, gaps }) => ({ name, events, gaps }));
  const base = placement(BASE_D7226EC);
  assert.deepEqual(placement(await captureReceivedCases(modules)), base, 'as the code places them');
  assert.deepEqual(placement(await captureReceivedCases(back(modules))), base);
  assert.deepEqual(placement(await captureReceivedCases(modulesBeforeRelayRule(back(modules)))), base);
});

test('M33 W2 placement is deterministic: identical bytes twice', async (t) => {
  const first = await load(t, verifierBeforeFixRows);
  const second = await load(t, verifierBeforeFixRows);
  assert.equal(JSON.stringify(second.ledger), JSON.stringify(first.ledger));
  assert.deepEqual(ids(second.session), ids(first.session));
  assert.equal(TEXT.passing.startsWith('PASS'), true);
});
