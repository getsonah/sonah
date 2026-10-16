// M33 brittleness M4, session route (owner decision 2026-10-06: "disclosed means FYI" on BOTH routes; it reverses M33
// N's choice for the session-only route, where the agent's statement about a forbidden edit was shown to the challengers
// but never made the finding FYI). The session-only forbidden-edit route's agent statement (`reportedBy`, recorded after
// the breaching action, quoted verbatim) is now the edit's proposed disclosure, put through the one disclosure step the
// combined route uses: code's check (ledger.js `editDisclosure`, DISCLOSURE_REJECTIONS), then its own challenge item
// (challenge.js `disclosureItem`, DISCLOSURE_PROPOSITION: did the agent tell the human about this change?). Only an upheld
// one sets `disclosureReason: disclosed` and makes the finding FYI; anything else leaves it DECIDE. A change code proved
// undone in its turn is still FYI `self_corrected`, as before. Disclosure narrowed (owner decision 2026-10-06,
// `sonah.challenge/16`): the proposition now asks whether the statement told the human that the agent went against the
// human's instruction, so the statement here (the line reported as a strength) is one a challenger refutes; the votes
// below are stubs that exercise the step, not that judgment (m33-disclosure-narrow.test.js holds both statements).
//
// Synthetic recordings only (m33-n-forbidden-edit-rows.js through the real slicer, redactor and adapter, and one
// hand-built session in the adapter's shape for a helper's edit). The judge is a table: it proposes the edit, upholds the
// edit's own item, and votes on a disclosure item as each test says. No model, no recording; nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { Session } from '../src/session.js';
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as challenge from '../src/challenge.js';
import * as review from '../src/review.js';
import * as forbidden from '../src/forbidden.js';
import * as story from '../../render/session-story.js';
import { REPORT_WHAT_WORDS, REPORT_DISCLOSURE_WORDS, REPORT_ITEM_WORDS } from '../../render/report-words.js';
import * as R from './m33-n-forbidden-edit-rows.js';
import { MOVED_BY_M4_SESSION } from './m33-m4-disclosure-fixture.js';
import { INTEGRATION_VERSIONS, DISCLOSURE_NARROW_VERSIONS, STABLE_IDS_VERSIONS, WINDOWING_VERSIONS, RECORDED_FACTS_VERSIONS, FORMAT_VERSIONS, CONVERSATION_VERSIONS, D69_VERSIONS, D69_REVIEW_VERSIONS, D71_BRIEF_VERSIONS, D71_CHANNELS_VERSIONS, S7_VERSIONS } from './m33-integration-fixture.js';
import { FIX_COLUMN_VERSIONS, W1_VERSIONS, W2_VERSIONS, W3_VERSIONS, FIX_REVIEW_VERSIONS, CODE_PASS_VERSIONS,
  CODE_STEP_VERSIONS, CODE_STEP_REVIEW_VERSIONS, CODE_STEP_REREVIEW_VERSIONS, CODE_STEP_THIRD_REVIEW_VERSIONS, VOID_VOTE_REASK_VERSIONS, CLEANUP_VERSIONS }
  from './m33-integration-fixture.js';

const PROFILES = [null, 'm33-fast', 'm33-lean'];
const KEY = 'm33-m4-session';
const zeros = Object.fromEntries(ledger.DISCLOSURE_REJECTIONS.map((reason) => [reason, 0]));

async function claude(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-m4-session-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${R.SESSION}.jsonl`);
  await writeFile(file, R.claudeRows(options).map((r) => JSON.stringify(r)).join('\n') + '\n');
  return sessionFromLedger(redact(await sliceLineage([file], { cwd: '/repo' })).ledger, { sessionKey: KEY });
}
const textOf = (session, event) => session.textSpansOf(event, 'text').join('');
const idOf = (session, test) => session.events.find(test)?.id;
const writeOf = (session) => idOf(session, (e) => e.kind === 'invocation' && e.operation === 'write');
const askOf = (session, words) => idOf(session, (e) => e.kind === 'instruction' && textOf(session, e).includes(words));
const sayingOf = (session, words) => idOf(session, (e) => e.kind === 'commentary' && textOf(session, e).includes(words));
const receipt = (eventId, role, quote) => ({ eventId, role, quote });

/** The motivating shape: the human ruled the naming coincidence out, the agent wrote it in, then reported it. */
const edit = (session, over = {}) => ({ text: 'The human ruled the coincidence out; the agent wrote it in.',
  instruction: receipt(askOf(session, R.WORDS.constraint), 'instruction', R.WORDS.constraint),
  violation: receipt(writeOf(session), 'code', R.WORDS.origin),
  reportedBy: receipt(sayingOf(session, R.WORDS.strength), 'commentary', R.WORDS.strength), ...over });

/**
 * The judge. A narrative request that asks for forbidden edits is answered with `edits`; a forbidden-edit item is upheld
 * citing its action; a disclosure item is voted on as `disclosure` says — `support` (not-refuted, citing the statement),
 * `refute` (citing the statement), `unbound` (not-refuted citing only the instruction, which binds to no statement) or
 * `none` (no vote). Every other item is upheld on its first receipt.
 */
function judgeOf(edits, { disclosure = 'support', seen = [], window = 0 } = {}) {
  return async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.flatMap((item) => {
      if (item.type === ledger.FORBIDDEN_EDIT_ITEM_TYPE) return [{ key: item.key, verdict: 'not-refuted',
        explanation: 'Synthetic: the instruction ruled it out.', receipts: [item.candidate.violation] }];
      if (item.type !== ledger.DISCLOSURE_ITEM_TYPE) return [];
      if (disclosure === 'none') return [];
      return [{ key: item.key, verdict: disclosure === 'refute' ? 'refuted' : 'not-refuted', explanation: 'Synthetic.',
        receipts: [disclosure === 'unbound' ? item.candidate.instruction[0] : item.candidate.statement] }];
    }) };
    const asked = `${request.system}${request.prompt}`.includes('"forbiddenEdits"');
    return { decisions: [], pivots: [], claims: [], requirements: [],
      ...(asked && request.window?.index === window ? { forbiddenEdits: edits } : {}) };
  };
}
const reviewOf = (session, edits, { profile = null, ...options } = {}) => reviewRun.runReview({ session, pr: null,
  reviewScope: 'session-only', ...(profile ? { speedProfile: profile } : {}), judge: judgeOf(edits, options) });
const rows = (report) => report.findings.filter((f) => f.kind === 'edit_under_negative_requirement')
  .map((f) => [f.status, f.breach ?? null, f.disclosureReason ?? null]);
const disclosureLabels = (seen) => seen.filter((r) => r.challenge && r.label.includes(':disclosure')).map((r) => r.label);

test('M4 session: the version moved once, and the forbidden-edit note no longer names the statement', () => {
  // On its branch /13 -> /14; merged, M33 integration's one version above every branch's own carries it.
  assert.equal(MOVED_BY_M4_SESSION.versions.challenge[1], INTEGRATION_VERSIONS.challenge.branches.forbidden);
  // The disclosure narrowing moved it once more (DISCLOSURE_NARROW_VERSIONS: /15 -> /16).
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
  const [before, after] = MOVED_BY_M4_SESSION.texts.forbiddenNote;
  assert.ok(challenge.FORBIDDEN_EDIT_NOTE.includes(after) && !challenge.FORBIDDEN_EDIT_NOTE.includes(before));
  assert.ok(!challenge.FORBIDDEN_EDIT_NOTE.includes('reportedBy'));
  assert.equal(ledger.FORBIDDEN_EDIT_REPORT_REJECTIONS, undefined, 'one disclosure vocabulary for both routes');
});

test('M4 session: an upheld disclosure of a forbidden edit publishes FYI `disclosed`, every profile', async (t) => {
  const session = await claude(t);
  const said = sayingOf(session, R.WORDS.strength);
  const refuted = await reviewOf(session, [edit(session)], { disclosure: 'refute' });
  for (const profile of PROFILES) {
    const label = String(profile);
    const seen = [];
    const report = await reviewOf(session, [edit(session)], { profile, seen });
    assert.deepEqual(rows(report), [['FYI', 'wrote', 'disclosed']], label);
    const [finding] = report.findings;
    assert.deepEqual(finding.disclosedBy, { eventId: said, role: 'commentary', quote: R.WORDS.strength, sessionKey: KEY }, label);
    assert.equal(Object.hasOwn(finding, 'reportedBy'), false, label);
    assert.equal(finding.receipts.some((r) => r.role === 'commentary'), false, label);
    // Its identity is the accusation's, whatever its disclosure.
    assert.equal(finding.id, refuted.findings[0].id, label);
    assert.equal(report.sessionStatus, 'FYI', label);
    assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: zeros, upheld: 1 }, label);
    assert.deepEqual(report.windowResults[0].disclosures, report.counts.disclosures, label);
    // Its own three-pass run in every profile, after the edit's, sent the disclosure note and never the forbidden one.
    assert.deepEqual(disclosureLabels(seen), ['challenge:w1:disclosure:b1:p1', 'challenge:w1:disclosure:b1:p2',
      'challenge:w1:disclosure:b1:p3'], label);
    assert.deepEqual(report.disclosureChallenge, { attemptedCalls: 3, reaskCalls: 0, plannedItems: 1 }, label);
    for (const request of seen.filter((r) => r.challenge && r.label.includes(':disclosure'))) {
      assert.ok(request.system.includes(challenge.DISCLOSURE_NOTE), label);
      assert.ok(!request.system.includes(challenge.FORBIDDEN_EDIT_NOTE), label);
      const [item] = request.challenge.items;
      assert.equal(item.type, ledger.DISCLOSURE_ITEM_TYPE, label);
      // The combined route's item, exactly: the proposition, the instruction, the change and the statement.
      assert.deepEqual(item.candidate, { proposition: challenge.DISCLOSURE_PROPOSITION,
        instruction: [edit(session).instruction], change: [edit(session).violation], statement: edit(session).reportedBy }, label);
    }
    // The edit's own item never shows the statement, nor is it sent the disclosure note.
    for (const request of seen.filter((r) => r.challenge && r.label.includes(':forbidden'))) {
      assert.ok(!request.system.includes(challenge.DISCLOSURE_NOTE), label);
      for (const item of request.challenge.items) assert.equal(Object.hasOwn(item.candidate, 'reportedBy'), false, label);
    }
  }
});

test('M4 session: the story says the agent told you, with its words (D71: no status)', async (t) => {
  const session = await claude(t);
  const said = sayingOf(session, R.WORDS.strength);
  const report = await reviewOf(session, [edit(session)]);
  // D97: the report .md says it as what it is, an item of its own kind: what you said, what the agent wrote, and what
  // the agent told you, each in its own words.
  const told = story.renderReportMarkdown(session, report);
  assert.ok(!told.includes('Needs your decision') && !told.includes('Worth a look'));
  const esc = review.escapeSource;
  assert.ok(told.includes(`${REPORT_WHAT_WORDS.editAgainst} ${REPORT_DISCLOSURE_WORDS.edit.disclosed}`), told);
  const yours = told.indexOf(`${REPORT_ITEM_WORDS.youSaid} “${esc(R.WORDS.constraint)}”`);
  assert.ok(yours >= 0 && yours < told.indexOf(`${REPORT_ITEM_WORDS.breach.wrote} “${esc(R.WORDS.origin)}”`), told);
  assert.ok(told.includes(`${REPORT_ITEM_WORDS.agentTold} “${esc(R.WORDS.strength)}”`), told);
  assert.equal(story.disclosedEdit(report.findings[0]), report.findings[0].disclosedBy);
});

test('M4 session: a refuted, unbound or unvoted disclosure leaves the edit DECIDE, counted by its outcome', async (t) => {
  const session = await claude(t);
  for (const [disclosure, outcome] of [['refute', 'refuted'], ['unbound', 'unsettled'], ['none', 'unexecuted']]) {
    const report = await reviewOf(session, [edit(session)], { disclosure });
    assert.deepEqual(rows(report), [['DECIDE', 'wrote', null]], disclosure);
    assert.equal(Object.hasOwn(report.findings[0], 'disclosedBy'), false, disclosure);
    assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: { ...zeros, [outcome]: 1 }, upheld: 0 }, disclosure);
    assert.equal(report.sessionStatus, 'DECIDE', disclosure);
    // The disclosure's run is kept apart from the window's: it never makes the review incomplete.
    assert.equal(report.sessionReview, 'complete', disclosure);
  }
});

test('M4 session: code checks the statement before anything is asked — the one check of both routes', async (t) => {
  const session = await claude(t);
  const said = sayingOf(session, R.WORDS.strength);
  const plan = sayingOf(session, R.WORDS.plan);
  for (const [reportedBy, reason] of [
    [receipt(plan, 'commentary', R.WORDS.plan), 'not_later'],
    // A quote cut inside a word: never grounded (the session route's rule, now both routes').
    [receipt(said, 'commentary', R.WORDS.strength.slice(3)), 'ungrounded'],
    [receipt(said, 'commentary', 'never said this at all'), 'ungrounded'],
    [receipt(said, 'action', R.WORDS.strength), 'malformed'],
    [receipt(said, 'commentary', `${R.WORDS.strength} ${R.WORDS.strength}`.slice(0, 121)), 'malformed'],
  ]) {
    const seen = [];
    const report = await reviewOf(session, [edit(session, { reportedBy })], { seen });
    assert.deepEqual(rows(report), [['DECIDE', 'wrote', null]], reason);
    assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: { ...zeros, [reason]: 1 }, upheld: 0 }, reason);
    assert.deepEqual(disclosureLabels(seen), [], reason);
    assert.equal(Object.hasOwn(report, 'disclosureChallenge'), false, reason);
  }
  // A statement the window was never shown is `unsupplied` (the window's source map is the route's fact).
  const sourceMap = Object.fromEntries(session.events.filter((e) => e.id !== said).map((e) => [e.id, session.sourcesFor(e)]));
  const read = forbidden.readForbiddenEdit(edit(session), { session, sourceMap });
  assert.equal(read.edit.disclosureSupplied, false);
  const counts = challenge.disclosureCounts();
  assert.deepEqual(challenge.disclosureAsks([{ key: 'k', candidate: forbidden.forbiddenFindingCandidate(read.edit),
    supplied: read.edit.disclosureSupplied }], { repo: { host: 'local', id: KEY }, session }, counts), []);
  assert.deepEqual(counts, { proposed: 1, rejected: { ...zeros, unsupplied: 1 }, upheld: 0 });
  // An edit that proposes no statement gains no member anywhere.
  const plain = await reviewOf(session, [edit(session, { reportedBy: null })]);
  assert.deepEqual(rows(plain), [['DECIDE', 'wrote', null]]);
  for (const holder of [plain.counts, plain, plain.windowResults[0]])
    for (const member of ['disclosures', 'disclosureChallenge']) assert.equal(Object.hasOwn(holder, member), false, member);
});

test('M4 session: a change code proved undone in its turn stays FYI `self_corrected`; its statement is not asked', async (t) => {
  const session = await claude(t, { revert: 'same' });
  const seen = [];
  const report = await reviewOf(session, [edit(session)], { seen });
  assert.deepEqual(rows(report), [['FYI', 'wrote', 'self_corrected']]);
  assert.equal(Object.hasOwn(report.findings[0], 'disclosedBy'), false);
  assert.deepEqual(disclosureLabels(seen), []);
  assert.equal(Object.hasOwn(report.counts, 'disclosures'), false);
});

test('M4 session: a merge that keeps DECIDE keeps no disclosure', () => {
  const base = { origin: 'session-review', kind: 'edit_under_negative_requirement', title: 'T', explanation: 'E',
    scope: 'session-effect', anchor: null, receipts: [receipt('I1', 'instruction', 'rule'), receipt('A1', 'code', 'body')] };
  const fyi = { ...base, status: 'FYI', disclosureReason: 'disclosed', disclosedBy: receipt('C1', 'commentary', 'told') };
  const { findings } = ledger.mergeDuplicateFindings([fyi, { ...base, status: 'DECIDE' }]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'DECIDE');
  for (const member of ['disclosureReason', 'disclosedBy']) assert.equal(Object.hasOwn(findings[0], member), false, member);
});

// ---- one actor rule, both routes ----------------------------------------------------------------------------------------

/** A hand-built session in the adapter's shape: the human's rule, a delegation to helper `w` (verified link) and to helper
 *  `v` (verified link), `w`'s write of the line ruled out, then statements of `w`, of `v` and of the main agent. */
function helperSession() {
  const TEXT = { ask: 'SYNTHETIC_M4S_ASK: draft it. Never mention SYNTHETIC_M4S_ORIGIN.', brief: 'SYNTHETIC_M4S_BRIEF: draft it.',
    body: 'Intro.\nSYNTHETIC_M4S_ORIGIN is where the name comes from.\n',
    w: 'SYNTHETIC_M4S_W: I wrote the origin line into the draft.', v: 'SYNTHETIC_M4S_V: I wrote the origin line too.',
    main: 'SYNTHETIC_M4S_MAIN: the helper wrote the origin line into the draft.', report: 'SYNTHETIC_M4S_REPORT: done.' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key]) }];
  const T1 = { turn: 'T1' };
  const of = (child) => ({ childId: child, turn: 'T1' });
  const link = (event, child) => ({ assignmentEvent: event, childId: child, childSession: `${KEY}-h/child:${child}`,
    sessionKey: `${KEY}-h/child:${child}`, relation: 'spawn', state: 'verified', historyStart: null });
  return new Session({ sessionKey: `${KEY}-h`, adapter: 'claude', blobs: TEXT, children: [link('D1', 'w'), link('D2', 'v')], events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Agent', operation: 'delegate', paths: [], command: [], input: whole('brief'),
      changes: [], ...T1 },
    { id: 'D2', kind: 'invocation', callKey: 'D2', tool: 'Agent', operation: 'delegate', paths: [], command: [], input: whole('brief'),
      changes: [], ...T1 },
    { id: 'child:w:A1', kind: 'invocation', callKey: 'child:w:A1', tool: 'create', operation: 'write', paths: [{ path: 'draft.md' }],
      command: [], input: [], changes: [{ path: 'draft.md', before: [], after: whole('body'), diff: [],
        extent: { chars: TEXT.body.length, lines: 2, truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' } }],
      ...of('w') },
    { id: 'child:w:A1-r', kind: 'observation', invocation: 'child:w:A1', callKey: 'child:w:A1', phase: 'terminal', result: 'succeeded',
      terminalStatusProven: true, exitCode: null, output: [], sourceOfResult: 'native', ...of('w') },
    { id: 'child:w:C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('w'), ...of('w') },
    { id: 'child:v:C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('v'), ...of('v') },
    { id: 'D1-r', kind: 'observation', invocation: 'D1', callKey: 'D1', phase: 'terminal', result: 'succeeded',
      terminalStatusProven: true, exitCode: null, output: whole('report'), sourceOfResult: 'native', ...T1 },
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('main'), ...T1 },
  ].map((event, sequence) => ({ ...event, sequence })) });
}

test('M4 session: one actor rule on both routes — only the main agent\'s statement, never a helper\'s, can disclose', () => {
  const session = helperSession();
  const repo = { host: 'local', id: `${KEY}-h` };
  const rule = receipt('I1', 'instruction', 'Never mention SYNTHETIC_M4S_ORIGIN');
  const statements = { main: receipt('C1', 'commentary', 'the helper wrote the origin line into the draft'),
    own: receipt('child:w:C1', 'commentary', 'I wrote the origin line into the draft'),
    other: receipt('child:v:C1', 'commentary', 'I wrote the origin line too') };
  // The session-only route's candidate (the change quoted by what it wrote) and the combined route's (by its path).
  const routes = {
    session: { origin: 'session-review', kind: 'edit_under_negative_requirement', title: 'T', explanation: 'E',
      scope: 'session-effect', anchor: null, receipts: [rule, receipt('child:w:A1', 'code', 'SYNTHETIC_M4S_ORIGIN is where')],
      forbiddenEdit: {} },
    combined: { origin: 'session-review', kind: 'edit_under_negative_requirement', title: 'T', explanation: 'E',
      scope: 'session-effect', anchor: null, receipts: [rule, receipt('child:w:A1', 'action', 'draft.md')] },
  };
  for (const [route, candidate] of Object.entries(routes)) {
    const check = (disclosedBy) => ledger.disclosureChallengeable({ repo, session, candidate: { ...candidate, disclosedBy } });
    // The main agent telling the human about its helper's change (read as `cross_actor` before, against its own contract).
    assert.deepEqual(check(statements.main), { challengeable: true, reason: null }, route);
    // A helper's own statement is never shown to the human (C-06 M33 H): not even the helper that made the change can
    // have told the human about it (M4 session route review), nor any other helper.
    assert.deepEqual(check(statements.own), { challengeable: false, reason: 'cross_actor' }, route);
    assert.deepEqual(check(statements.other), { challengeable: false, reason: 'cross_actor' }, route);
    // Code's check holds whatever the challengers said: an upheld helper statement still leaves the edit DECIDE.
    for (const said of [statements.own, statements.other]) {
      const held = ledger.groundFinding({ repo, session, pr: null,
        candidate: { ...candidate, disclosedBy: said, disclosureChallenge: 'upheld' } });
      assert.equal(held.ok, true, route);
      assert.equal(held.finding.status, 'DECIDE', route);
      assert.equal(held.disclosure, 'cross_actor', route);
      for (const member of ['disclosureReason', 'disclosedBy']) assert.equal(Object.hasOwn(held.finding, member), false, member);
    }
    // Upheld, either route publishes the same FYI `disclosed` with the statement.
    const grounded = ledger.groundFinding({ repo, session, pr: null,
      candidate: { ...candidate, disclosedBy: statements.main, disclosureChallenge: 'upheld' } });
    assert.equal(grounded.ok, true, route);
    assert.equal(grounded.finding.status, 'FYI', route);
    assert.equal(grounded.finding.disclosureReason, 'disclosed', route);
    assert.equal(grounded.finding.disclosedBy.eventId, 'C1', route);
    // And not upheld, DECIDE.
    const decide = ledger.groundFinding({ repo, session, pr: null,
      candidate: { ...candidate, disclosedBy: statements.main, disclosureChallenge: 'refuted' } });
    assert.equal(decide.finding.status, 'DECIDE', route);
    assert.equal(decide.disclosure, 'refuted', route);
  }
});

test('M4 session review: a helper\'s own statement about its own forbidden edit never makes it FYI, whatever the challengers say', async () => {
  // The failure the M4 session route review found: the human ruled a line out, helper `w` wrote it, and `w`'s own
  // closing words (which the human never sees) say so. Proposed as the edit's disclosure and supported by every
  // challenger, it is code's `cross_actor` before anything is asked: the edit stays DECIDE (D71 (a): listed under
  // Findings with no disclosure fact).
  // The main agent's own statement about the same change is still asked, and upheld, FYI `disclosed`.
  const session = helperSession();
  const rule = receipt('I1', 'instruction', 'Never mention SYNTHETIC_M4S_ORIGIN');
  const helperEdit = (reportedBy) => ({ text: 'The human ruled the line out; the helper wrote it in.', instruction: rule,
    violation: receipt('child:w:A1', 'code', 'SYNTHETIC_M4S_ORIGIN is where'), reportedBy });
  for (const profile of PROFILES) {
    const label = String(profile);
    const seen = [];
    // M35: a helper is a session of its own. M36 phase 3 (D68 K): small, it shares its parent's window (the first).
    const report = await reviewOf(session, [helperEdit(receipt('child:w:C1', 'commentary',
      'I wrote the origin line into the draft'))], { profile, seen, window: 0 });
    assert.deepEqual(rows(report), [['DECIDE', 'wrote', null]], label);
    assert.equal(Object.hasOwn(report.findings[0], 'disclosedBy'), false, label);
    assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: { ...zeros, cross_actor: 1 }, upheld: 0 }, label);
    assert.deepEqual(disclosureLabels(seen), [], label);
    assert.equal(report.sessionStatus, 'DECIDE', label);
    const told = story.renderReportMarkdown(session, report);
    assert.ok(told.includes(REPORT_WHAT_WORDS.editAgainst) && !told.includes(REPORT_DISCLOSURE_WORDS.edit.disclosed), label);
    // M35: the main agent's statement is the parent's session's, which a helper's own window is never shown: its
    // disclosure is `unsupplied`, and the helper's edit stays DECIDE. M36 phase 3 (D68 K): this small helper shares its
    // parent's window, which shows the main agent's statement: it is the main agent's own words to the human, asked and
    // upheld, FYI `disclosed` — as a window holding both showed it before M35. (A helper reviewed in a window of its own,
    // apart from the statement, still reads `unsupplied`: what a window shows decides what it can match.)
    const main = await reviewOf(session, [helperEdit(receipt('C1', 'commentary',
      'the helper wrote the origin line into the draft'))], { profile, window: 0 });
    assert.deepEqual(rows(main), [['FYI', 'wrote', 'disclosed']], label);
    assert.equal(main.counts.disclosures.upheld, 1, label);
  }
});
