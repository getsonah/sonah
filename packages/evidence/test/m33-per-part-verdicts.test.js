// C-06 "M33 per-part verdicts (owner decision, 2026-09-29)". A session review is reported by part as
// well as overall. A part is one human turn of the root session (events carry `turn` 'T<n>'); a
// transferred child's history belongs to the part whose assignment spawned it. Root events with no
// turn, and gaps that name no event, form one `session-wide` limits entry, listed once and blamed on
// no part. Each part is reduced by the M33 session table restricted to it; the overall session
// status is DECIDE if any part is, else FYI if any part is, else CLEAN if every part is CLEAN and
// there is no session-wide limit, else NO_FINDINGS (with the counts of parts fully checked, partial
// and unchecked) when at least one part's review completed, else UNCHECKED. A window whose narrative
// holds an unreadable proposal is re-asked once; if it is still unreadable, only its parts read
// UNCHECKED with the closed reason `proposal_unreadable`.
//
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import { runCodeReview } from '../src/code-review.js';

const repo = { host: 'github.com', id: '1' };
const completePr = { repo, number: 1, enumeration: 'complete',
  files: [{ path: 'src/app.js', change: 'modified', contentState: 'complete' }] };

const TEXT = {
  pre: 'SYNTHETIC_PARTS_PRE: a note recorded before any human turn.',
  ask1: 'SYNTHETIC_PARTS_ASK1: run the synthetic checks and hand the notes to a helper.',
  cmd: 'node /srv/x/check.js',
  out1: 'SYNTHETIC_PARTS_OUT1: 3 passed',
  brief: 'SYNTHETIC_PARTS_BRIEF: write the synthetic notes.',
  childOut: 'SYNTHETIC_PARTS_CHILD_OUT: notes written',
  ask2: 'SYNTHETIC_PARTS_ASK2: now tidy the synthetic notes.',
  out2: 'SYNTHETIC_PARTS_OUT2: 1 passed',
  ask3: 'SYNTHETIC_PARTS_ASK3: and check them once more.',
  out3: 'SYNTHETIC_PARTS_OUT3: 2 passed',
  post: 'SYNTHETIC_PARTS_POST: a note recorded after the last turn.',
  // M35 (windowing): a compaction splits no window; a long statement (400,000 bytes) in each root turn puts the turn in a
  // window of its own, in either scope. The helper is a session of its own, reviewed right after the window that
  // launched it. M36 phase 3 (D68 K): in a session-only review the small helper shares T1's window, so the windows are
  // T1 with the helper (0), T2 (1) and T3 (2); a combined review's smaller budget leaves T1 (0), the helper (1), T2 (2)
  // and T3 (3).
  long: `SYNTHETIC_PARTS_LONG: working through it.\n${'w'.repeat(400_000)}`,
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const ask = (id, key, over = {}) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: whole(key), ...over });
const command = (id, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: whole('cmd'), input: [], changes: [], ...over });
const result = (id, invocation, out, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(out),
  sourceOfResult: 'native', ...over });
const said = (id, key, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null,
  text: whole(key), ...over });
const compaction = (id, over = {}) => ({ id, kind: 'boundary', boundary: 'compaction', relatedSession: null, ...over });

/**
 * Turn T1 (window 1): an ask, a command and its result, a hand-off to a verified child `w` and the
 * child's command and result. A compaction closes window 1. Turn T2 (window 2): an ask, a command and
 * its result. With `three`, a second compaction and turn T3 (window 3). `pre` records one turnless
 * root event before T1 (window 1); `post` a compaction and one turnless root event (its own window).
 */
function session({ pre = false, post = false, three = false, link = 'verified', turns = true } = {}) {
  const T = (n) => (turns ? { turn: `T${n}` } : {});
  const child = { childId: 'w', ...(turns ? { turn: 'child:w:T1' } : {}) };
  const events = [
    ...(pre ? [said('S0', 'pre')] : []),
    ask('I1', 'ask1', T(1)), said('L1', 'long', T(1)), command('A1', T(1)), result('A1-r', 'A1', 'out1', T(1)),
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Task', operation: 'delegate', paths: [], command: [],
      input: whole('brief'), changes: [], ...T(1) },
    command('child:w:A9', child), result('child:w:A9-r', 'child:w:A9', 'childOut', child),
    compaction('B1', T(1)),
    ask('I2', 'ask2', T(2)), said('L2', 'long', T(2)), command('A2', T(2)), result('A2-r', 'A2', 'out2', T(2)),
    ...(three ? [compaction('B2', T(2)), ask('I3', 'ask3', T(3)), said('L3', 'long', T(3)), command('A3', T(3)),
      result('A3-r', 'A3', 'out3', T(3))] : []),
    ...(post ? [compaction('B9'), said('S9', 'post')] : []),
  ].map((event, sequence) => ({ ...event, sequence }));
  const children = link === null ? [] : [{ assignmentEvent: 'D1', childId: 'w', childSession: 's/child:w',
    sessionKey: 's/child:w', relation: 'spawn', state: link, historyStart: null }];
  return new Session({ sessionKey: 's', adapter: 'claude', blobs: { ...TEXT }, events, children });
}

const EMPTY = Object.freeze({ decisions: [], pivots: [], claims: [], requirements: [] });
/** A decision proposal outside the response contract: code cannot read it, so it is unreadable. */
const UNREADABLE = Object.freeze({ ...EMPTY, decisions: [{ dimension: 'SYNTHETIC_PARTS_UNREADABLE' }] });
const SUPPORT = { eventId: 'A1-r', role: 'observation', quote: TEXT.out1 };
/**
 * A synthetic judge. Upholds every challenged item. `fail` lists the window indexes whose narrative
 * call fails; `answer(index, nth)` is a window's narrative on its nth request (0-based). Every request
 * it receives is recorded in `seen`.
 */
function judge({ fail = [], answer = () => ({ ...EMPTY }), seen = [] } = {}) {
  const asked = new Map();
  return async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'Recorded.', receipts: [SUPPORT] })) };
    const index = request.window.index;
    const nth = asked.get(index) ?? 0;
    asked.set(index, nth + 1);
    if (fail.includes(index)) throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' });
    return structuredClone(answer(index, nth));
  };
}
const sessionOnly = (base, options) => reviewRun.runReview({ session: base, pr: null, reviewScope: 'session-only',
  judge: judge(options) });
const partOf = (report, name) => report.parts.find((part) => part.part === name);
const statusesOf = (report) => report.parts.map((part) => [part.part, part.status]);

// ---- vocabularies and attribution ---------------------------------------------------------------

test('M33 P the part reasons and the NO_FINDINGS part causes are frozen closed vocabularies', () => {
  assert.equal(ledger.SESSION_WIDE, 'session-wide');
  for (const name of ['PART_REASONS', 'PART_REVIEW_REASONS', 'PART_COVERAGE_REASONS', 'PART_CAUSES']) {
    assert.ok(Array.isArray(ledger[name]) && Object.isFrozen(ledger[name]), name);
    assert.equal(new Set(ledger[name]).size, ledger[name].length, `${name} has no repeat`);
  }
  for (const reason of ['finding_decide', 'finding_fyi', 'window_incomplete', 'proposal_unreadable', 'reading_capped',
    'gap_declared', 'gap_unplaced']) assert.ok(ledger.PART_REASONS.includes(reason), reason);
  for (const reason of [...ledger.PART_REVIEW_REASONS, ...ledger.PART_COVERAGE_REASONS])
    assert.ok(ledger.PART_REASONS.includes(reason), `${reason} is a part reason`);
  assert.ok(!ledger.PART_REVIEW_REASONS.some((r) => ledger.PART_COVERAGE_REASONS.includes(r)), 'review and coverage are apart');
  assert.deepEqual([...ledger.PART_CAUSES], ['parts_fully_checked', 'parts_partial', 'parts_decide_unsettled',
    'parts_unchecked', 'session_wide_unchecked']);
});

test('M33 P a part is a root human turn; a child belongs to the part whose assignment spawned it', () => {
  const parts = ledger.partAttribution(session({ pre: true, post: true }));
  assert.equal(parts.get('I1'), 'T1');
  assert.equal(parts.get('A2-r'), 'T2');
  assert.equal(parts.get('child:w:A9'), 'T1', 'the verified spawn link names the assignment, whose turn is T1');
  assert.equal(parts.get('child:w:A9-r'), 'T1');
  assert.equal(parts.get('S0'), ledger.SESSION_WIDE, 'a root event with no turn is in no part');
  assert.equal(parts.get('S9'), ledger.SESSION_WIDE);
  // A child whose history no verified spawn link places is in no part.
  for (const state of ['missing', 'ambiguous', 'conflicting'])
    assert.equal(ledger.partAttribution(session({ link: state })).get('child:w:A9'), ledger.SESSION_WIDE, state);
  assert.equal(ledger.partAttribution(session({ link: null })).get('child:w:A9'), ledger.SESSION_WIDE, 'no link');
  const followup = session();
  followup.children[0].relation = 'followup';
  assert.equal(ledger.partAttribution(followup).get('child:w:A9'), ledger.SESSION_WIDE, 'a follow-up spawned nothing');
  // A grandchild belongs to the part its ancestor's spawn is in.
  const nested = session();
  nested.events.push({ ...command('child:w:child:v:A1', { childId: 'v', turn: 'child:w:child:v:T1' }), sequence: 99 },
    { ...command('child:w:D5', { childId: 'w', turn: 'child:w:T1', operation: 'delegate' }), sequence: 98 });
  nested.byId = new Map(nested.events.map((e) => [e.id, e]));
  nested.children.push({ assignmentEvent: 'child:w:D5', childId: 'v', childSession: 's/child:w/child:v',
    sessionKey: 's/child:w/child:v', relation: 'spawn', state: 'verified', historyStart: null });
  assert.equal(ledger.partAttribution(nested).get('child:w:child:v:A1'), 'T1');
  // A session with no recorded turn has no part at all.
  assert.ok([...ledger.partAttribution(session({ turns: false })).values()].every((p) => p === ledger.SESSION_WIDE));
});

// ---- per-part statuses and the overall session status ------------------------------------------

test('M33 P every part reviewed completely with no limit: every part CLEAN and the session CLEAN', async () => {
  const report = await sessionOnly(session());
  assert.deepEqual(statusesOf(report), [['T1', 'CLEAN'], ['T2', 'CLEAN']]);
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.reviewStatus, 'CLEAN');
  assert.deepEqual(partOf(report, 'T1').reasons, []);
  assert.deepEqual(partOf(report, 'T1').counts, { findings: 0, decisions: 0, windows: 1, windowsIncomplete: 0, gaps: 0 },
    'its own window, which its helper shares (M36 phase 3)');
  assert.equal(report.sessionWideLimits.limited, false);
  assert.deepEqual(report.partCounts, { parts_fully_checked: 2, parts_partial: 0, parts_decide_unsettled: 0, parts_unchecked: 0, session_wide_unchecked: 0 });
  // Every window records the events it showed, so a part's windows can be recomputed.
  assert.deepEqual(report.windowResults.map((w) => w.eventIds.length), [8, 4]);
});

test('M33 P a failed window leaves only its part UNCHECKED; the others completing make the session NO_FINDINGS', async () => {
  const report = await sessionOnly(session(), { fail: [1] });
  assert.equal(report.sessionReview, 'incomplete', 'premise: the whole-session review did not complete');
  assert.deepEqual(statusesOf(report), [['T1', 'CLEAN'], ['T2', 'UNCHECKED']]);
  assert.deepEqual(partOf(report, 'T2').reasons, ['window_incomplete']);
  assert.deepEqual(partOf(report, 'T2').counts, { findings: 0, decisions: 0, windows: 1, windowsIncomplete: 1, gaps: 0 });
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.equal(report.reviewStatus, 'NO_FINDINGS', 'a session-only aggregate is its session status');
  assert.equal(report.codeStatus, 'UNCHECKED', 'codeStatus keeps its own table');
  assert.deepEqual(report.partCounts, { parts_fully_checked: 1, parts_partial: 0, parts_decide_unsettled: 0, parts_unchecked: 1, session_wide_unchecked: 0 });
  // Recomputing from the report never changes it.
  assert.equal(ledger.honestStatuses(report).sessionStatus, 'NO_FINDINGS');
});

test('M33 P no part whose review completed: the session is UNCHECKED', async () => {
  const report = await sessionOnly(session(), { fail: [0, 1] });
  assert.deepEqual(statusesOf(report), [['T1', 'UNCHECKED'], ['T2', 'UNCHECKED']]);
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.deepEqual(report.partCounts, { parts_fully_checked: 0, parts_partial: 0, parts_decide_unsettled: 0, parts_unchecked: 2, session_wide_unchecked: 0 });
});

test('M33 P a declared gap naming a part\'s events makes only that part partial: NO_FINDINGS, never CLEAN', async () => {
  const base = session({ three: true });
  base.adapterGaps = [{ code: 'command_outcome_unknown', channel: 'observations', scope: 'session', count: 1,
    eventIds: ['A2'], sessionKey: 's' }];
  const report = await sessionOnly(base);
  assert.deepEqual(statusesOf(report), [['T1', 'CLEAN'], ['T2', 'NO_FINDINGS'], ['T3', 'CLEAN']]);
  assert.deepEqual(partOf(report, 'T2').reasons, ['gap_declared']);
  assert.equal(partOf(report, 'T2').counts.gaps, 1);
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.deepEqual(report.partCounts, { parts_fully_checked: 2, parts_partial: 1, parts_decide_unsettled: 0, parts_unchecked: 0, session_wide_unchecked: 0 });
  // A gap declared on a transferred child's event is its spawning part's.
  const onChild = session();
  onChild.adapterGaps = [{ code: 'source_clipped', channel: 'observations', scope: 'session', count: 1,
    eventIds: ['child:w:A9-r'], sessionKey: 's/child:w' }];
  const childReport = await sessionOnly(onChild);
  assert.deepEqual(statusesOf(childReport), [['T1', 'NO_FINDINGS'], ['T2', 'CLEAN']]);
  // A gap that names a sequence range limits every part it intersects.
  const ranged = session({ three: true });
  ranged.adapterGaps = [{ code: 'incomplete_inventory', channel: 'actions', scope: 'session', count: 1,
    fromSequence: ranged.event('A2').sequence, untilSequence: ranged.event('I3').sequence, sessionKey: 's' }];
  assert.deepEqual(statusesOf(await sessionOnly(ranged)), [['T1', 'CLEAN'], ['T2', 'NO_FINDINGS'], ['T3', 'NO_FINDINGS']]);
});

test('M33 P a gap that names no event is one session-wide limit, blamed on no part', async () => {
  const base = session();
  base.adapterGaps = [{ code: 'unsupported_message', channel: 'commentary', scope: 'session', count: 2, sessionKey: 's' }];
  const report = await sessionOnly(base);
  assert.deepEqual(statusesOf(report), [['T1', 'CLEAN'], ['T2', 'CLEAN']], 'no part is blamed');
  assert.equal(report.sessionWideLimits.limited, true);
  assert.deepEqual(report.sessionWideLimits.reasons, ['gap_unplaced']);
  assert.equal(report.sessionWideLimits.counts.gaps, 1, 'listed once');
  assert.equal(report.sessionStatus, 'NO_FINDINGS', 'never CLEAN beside a session-wide limit');
});

test('M33 P root events with no turn are session-wide: reviewed, they are no limit; unreviewed, they are one', async () => {
  const clean = await sessionOnly(session({ pre: true, post: true }));
  assert.equal(clean.sessionWideLimits.counts.events, 3, 'the two notes and the turnless compaction');
  assert.equal(clean.sessionWideLimits.limited, false);
  assert.equal(clean.sessionStatus, 'CLEAN');
  // M35: the turnless tail rides in the last turn's window (a compaction splits none). That window failing leaves its
  // part UNCHECKED and the tail a session-wide limit; the other part is not blamed.
  const failed = await sessionOnly(session({ post: true }), { fail: [1] });
  assert.deepEqual(statusesOf(failed), [['T1', 'CLEAN'], ['T2', 'UNCHECKED']]);
  assert.deepEqual(failed.sessionWideLimits.reasons, ['window_incomplete']);
  assert.equal(failed.sessionStatus, 'NO_FINDINGS');
});

test('M33 P a session with no recorded turn keeps the whole-session reduction', async () => {
  const plain = await sessionOnly(session({ turns: false }), { fail: [1] });
  assert.deepEqual(plain.parts, []);
  assert.equal(plain.sessionStatus, 'UNCHECKED', 'exactly as before: the review did not complete');
});

// ---- findings -----------------------------------------------------------------------------------

const finding = (status, eventId, id = `f-${status}-${eventId}`) => ({ id, origin: 'session-review', kind: 'shortcut',
  status, title: 'Synthetic', explanation: 'Synthetic.', scope: 'session-effect', anchor: null,
  receipts: [{ eventId, role: 'observation', quote: 'SYNTHETIC' }] });

test('M33 P a part\'s findings are the ones whose receipts cite its events', async () => {
  const report = await sessionOnly(session({ three: true }), { fail: [1] });
  // An FYI in a completed part: the session is FYI, whatever another part could not check.
  const fyi = ledger.honestStatuses({ ...report, findings: [finding('FYI', 'A1-r')] });
  assert.deepEqual(fyi.parts.map((p) => [p.part, p.status]), [['T1', 'FYI'], ['T2', 'UNCHECKED'], ['T3', 'CLEAN']]);
  assert.deepEqual(fyi.parts[0].reasons, ['finding_fyi']);
  assert.equal(fyi.parts[0].counts.findings, 1);
  assert.equal(fyi.sessionStatus, 'FYI');
  // An FYI only in the part that was not checked: that part stays UNCHECKED, the item is retained.
  const unchecked = ledger.honestStatuses({ ...report, findings: [finding('FYI', 'A2-r')] });
  assert.deepEqual(unchecked.parts.map((p) => [p.part, p.status]), [['T1', 'CLEAN'], ['T2', 'UNCHECKED'], ['T3', 'CLEAN']]);
  assert.equal(unchecked.sessionStatus, 'NO_FINDINGS');
  // A DECIDE anywhere is DECIDE, including in a part that was not checked.
  const decide = ledger.honestStatuses({ ...report, findings: [finding('DECIDE', 'A2-r')] });
  assert.equal(decide.parts[1].status, 'DECIDE');
  assert.equal(decide.sessionStatus, 'DECIDE');
  // Read again, the published finding list decides a part's findings, as it does the whole session's;
  // the limits an earlier reading declared stand.
  const reread = ledger.honestStatuses({ ...report, ...decide, findings: [finding('FYI', 'A1-r')] });
  assert.deepEqual(reread.parts.map((p) => [p.part, p.status]), [['T1', 'FYI'], ['T2', 'UNCHECKED'], ['T3', 'CLEAN']]);
  assert.deepEqual(reread.parts[1].reasons, ['window_incomplete']);
});

test('M33 P a DECIDE finding citing only turnless events is never suppressed', async () => {
  const report = await sessionOnly(session({ pre: true }));
  const decide = ledger.honestStatuses({ ...report, findings: [finding('DECIDE', 'S0')] });
  assert.deepEqual(decide.parts.map((p) => p.status), ['CLEAN', 'CLEAN']);
  assert.equal(decide.sessionWideLimits.counts.findings, 1);
  assert.equal(decide.sessionStatus, 'DECIDE');
  const cited = ledger.honestStatuses({ ...report, findings: [finding('DECIDE', 'NOT-AN-EVENT')] });
  assert.equal(cited.sessionStatus, 'DECIDE', 'a finding citing no recorded event is session-wide, still DECIDE');
});

test('M33 P a capping rejection limits the parts it names, and one naming no event limits every part', async () => {
  const report = await sessionOnly(session({ three: true }));
  const naming = ledger.honestStatuses({ ...report,
    rejectedFindings: [{ reason: 'kind_rejected', candidate: { receipts: [{ eventId: 'A2', role: 'action', quote: 'x' }] } }] });
  assert.deepEqual(naming.parts.map((p) => [p.part, p.status]), [['T1', 'CLEAN'], ['T2', 'UNCHECKED'], ['T3', 'CLEAN']]);
  assert.deepEqual(naming.parts[1].reasons, ['reading_capped']);
  assert.equal(naming.sessionStatus, 'NO_FINDINGS');
  const nameless = ledger.honestStatuses({ ...report, rejectedFindings: [{ reason: 'unreviewed_scope' }] });
  assert.ok(nameless.parts.every((p) => p.status === 'UNCHECKED' && p.reasons.includes('review_unattributed')));
  assert.equal(nameless.sessionStatus, 'UNCHECKED');
  // A withheld rejection ran and was inconclusive: it limits nothing.
  const withheld = ledger.honestStatuses({ ...report, rejectedFindings: [{ reason: 'receipt_rejected' }] });
  assert.equal(withheld.sessionStatus, 'CLEAN');
});

// ---- the bounded re-ask -------------------------------------------------------------------------

test('M33 P an unreadable proposal is re-asked once with the identical request; a readable answer is used', async () => {
  const seen = [];
  const report = await sessionOnly(session(), { seen, answer: (index, nth) => (index === 1 && nth === 0 ? UNREADABLE : EMPTY) });
  const asked = seen.filter((r) => !r.challenge && r.window.index === 1);
  assert.equal(asked.length, 2, 'asked exactly twice');
  assert.equal(asked[0], asked[1], 'the same request, so a memoized judge gives it the next D60 occurrence');
  assert.equal(seen.filter((r) => !r.challenge && r.window.index === 0).length, 1, 'a readable window is asked once');
  assert.equal(report.windowResults[1].proposalReasked, true);
  assert.equal(report.windowResults[1].proposalUnreadable, false);
  assert.deepEqual(reviewRun.windowIncompleteReasons(report.windowResults[1]), [], 'the second answer completes it');
  assert.deepEqual(report.counts.proposalReasks, { asked: 1, recovered: 1, unreadable: 0 });
  assert.equal(report.sessionStatus, 'CLEAN');
});

test('M33 P still unreadable after the one re-ask: only that window\'s parts read UNCHECKED, proposal_unreadable', async () => {
  const seen = [];
  const report = await sessionOnly(session({ three: true }), { seen, answer: (index) => (index === 1 ? UNREADABLE : EMPTY) });
  assert.equal(seen.filter((r) => !r.challenge && r.window.index === 1).length, 2, 'bounded: one re-ask, no more');
  assert.equal(report.windowResults[1].proposalUnreadable, true);
  assert.deepEqual(statusesOf(report), [['T1', 'CLEAN'], ['T2', 'UNCHECKED'], ['T3', 'CLEAN']]);
  assert.deepEqual(partOf(report, 'T2').reasons, ['proposal_unreadable']);
  assert.deepEqual(report.counts.proposalReasks, { asked: 1, recovered: 0, unreadable: 1 });
  assert.equal(report.sessionStatus, 'NO_FINDINGS', 'the rest of the session is unaffected');
});

test('M33 P a combined review marks an unreadable proposal without re-asking the joint request', async () => {
  const seen = [];
  const report = await reviewRun.runReview({ session: session(), pr: completePr,
    judge: judge({ seen, answer: (index) => (index === 2 ? UNREADABLE : EMPTY) }) });
  assert.equal(seen.filter((r) => !r.challenge && r.window.index === 2).length, 1);
  assert.equal(report.windowResults[2].proposalReasked, false);
  assert.deepEqual(partOf(report, 'T2').reasons, ['proposal_unreadable']);
  assert.equal(reviewRun.runProfile('session-only').proposalReasks, 1);
  assert.equal(reviewRun.runProfile('combined').proposalReasks, 0);
  // Joined to a complete, clean code review, the aggregate uses the per-part session status.
  const joined = ledger.honestStatuses({ ...report, codeCoverage: 'complete' });
  assert.equal(joined.codeStatus, 'CLEAN');
  assert.equal(joined.sessionStatus, 'NO_FINDINGS');
  assert.equal(joined.reviewStatus, 'NO_FINDINGS');
});

const GREET = 'src/greet.js';
const GREET_DIFF = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/greet.js', '@@ -0,0 +1,1 @@', '+export default "SYNTHETIC_PARTS_GREETING";', ''].join('\n');
const GREET_PR = { repo: { host: 'github.com', id: '333' }, number: 333, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
  files: [{ path: GREET, change: 'added', contentState: 'complete' }] };
/** A joint (code + narrative) judge: every file is reviewed in its code-only chunk; `extra(label)` adds to
 *  the answer for one request label. */
const jointJudge = (extra = () => ({})) => async (request) => {
  const base = { ...EMPTY, codeFindings: [], sessionFindings: [], reviewedFiles: [] };
  if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'Recorded.', receipts: [SUPPORT] })) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET], ...extra(request.label) };
  return { ...base, ...extra(request.label) };
};

test('M33 P the code-review join places a narrative proposal it could not read in its window\'s parts', async () => {
  const clean = await runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF, judge: jointJudge() });
  assert.equal(clean.codeStatus, 'CLEAN', 'premise: the code review completed and found nothing');
  assert.deepEqual(statusesOf(clean), [['T1', 'CLEAN'], ['T2', 'CLEAN']]);
  assert.equal(clean.reviewStatus, 'CLEAN');
  const unreadable = await runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF,
    judge: jointJudge((label) => (label === 'code+narrative:w3' ? { decisions: UNREADABLE.decisions } : {})) });
  assert.equal(unreadable.rejectedNarrative, 1);
  assert.deepEqual(unreadable.rejectedNarrativeWindows, [2]);
  assert.equal(unreadable.rejectedNarrativeUnplaced, 0);
  assert.deepEqual(statusesOf(unreadable), [['T1', 'CLEAN'], ['T2', 'UNCHECKED']]);
  assert.deepEqual(partOf(unreadable, 'T2').reasons, ['proposal_unreadable']);
  assert.equal(unreadable.sessionStatus, 'NO_FINDINGS', 'the rest of the session is unaffected');
  assert.equal(unreadable.reviewStatus, 'NO_FINDINGS', 'the combined aggregate uses the per-part session status');
  // One from a code-only chunk comes from no narrative window: no part is shown to have completed.
  const unplaced = await runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF,
    judge: jointJudge((label) => (/^code\+chunk:/.test(label) ? { decisions: UNREADABLE.decisions } : {})) });
  assert.equal(unplaced.rejectedNarrativeUnplaced, 1);
  assert.ok(unplaced.parts.every((part) => part.status === 'UNCHECKED' && part.reasons.includes('review_unattributed')));
  assert.equal(unplaced.sessionStatus, 'UNCHECKED');
});

// ---- never upgrade --------------------------------------------------------------------------------

test('M33 P honestStatuses never upgrades a declared part, and a saved report reduces from its declared parts', async () => {
  const report = await sessionOnly(session({ three: true }), { fail: [1] });
  // A later reading cannot lift a part an earlier one declared UNCHECKED.
  const lowered = structuredClone(report.parts);
  lowered[0] = { ...lowered[0], status: 'UNCHECKED', reasons: ['window_incomplete'] };
  const kept = ledger.honestStatuses({ ...report, parts: lowered });
  assert.equal(kept.parts[0].status, 'UNCHECKED');
  assert.ok(kept.parts[0].reasons.includes('window_incomplete'));
  // Saved without its recording: the declared parts decide, lowered by what their reasons say.
  const { session: omitted, ...saved } = report;
  const reloaded = JSON.parse(JSON.stringify(saved));
  assert.equal(ledger.honestStatuses(reloaded).sessionStatus, 'NO_FINDINGS');
  assert.deepEqual(ledger.honestStatuses(reloaded).parts.map((p) => p.status), ['CLEAN', 'UNCHECKED', 'CLEAN']);
  // A forged CLEAN part with an incomplete-review reason reads UNCHECKED; forged all-CLEAN parts cannot
  // make CLEAN what the whole-session reduction does not.
  const forged = structuredClone(reloaded);
  forged.parts[1] = { ...forged.parts[1], status: 'CLEAN' };
  assert.equal(ledger.honestStatuses(forged).parts[1].status, 'UNCHECKED');
  forged.parts[1] = { ...forged.parts[1], status: 'CLEAN', reasons: [] };
  assert.notEqual(ledger.honestStatuses(forged).sessionStatus, 'CLEAN');
  // Declared parts that are not the closed shape are no declaration at all: the whole-session reduction.
  assert.equal(ledger.honestStatuses({ ...reloaded, parts: [{ part: 'T1', status: 'SHINY', reasons: [] }] }).sessionStatus,
    'UNCHECKED');
  // A declared incomplete review that no part explains leaves every part unchecked.
  const declared = ledger.honestStatuses({ ...(await sessionOnly(session())), sessionReview: 'incomplete' });
  assert.equal(declared.sessionStatus, 'UNCHECKED');
});

