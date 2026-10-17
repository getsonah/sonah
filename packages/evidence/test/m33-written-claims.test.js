// C-06 "M33 written statements (owner decision, 2026-09-29)". Statements the agent writes into a file —
// a written body of one of its own write, create or edit actions — are a separate proposal class,
// `writtenClaims`, never a chat claim. Each cites its exact written text with role `code` on that write
// action, grounded like any written-code receipt, and may cite a recorded observation that contradicts
// it. It is published in its own section with a closed side label: `unverified` by default, or
// `contradicted` when a grounded, supplied observation that postdates the write contradicts it and the
// challenge upholds that with two grounded support votes. A written statement is never a finding and
// never changes a status. One that cannot be read or grounded is withheld and counted; it never makes a
// window or the review incomplete. A chat claim whose stated receipt quotes written file content instead
// of commentary is reclassified as this class, not unread.
//
// Synthetic sessions (/srv/x paths), synthetic judges: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, receiptProjection } from '../src/session.js';
import { identityDigest } from '../contracts/canonical.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as prompt from '../src/prompt.js';
import * as challenge from '../src/challenge.js';
import * as codeReviewPrompt from '../src/code-review-prompt.js';
import * as reviewRender from '../src/review.js';
import { runCodeReview } from '../src/code-review.js';

const REPO = { host: 'github.com', id: '0' };
const SESSION_KEY = 'sess-written';

const TEXT = {
  ask: 'SYNTHETIC_W_ASK: add the synthetic parser notes.',
  test: 'node /srv/x/test.js',
  early: 'SYNTHETIC_W_EARLY: 2 failing',
  notes: '# Synthetic notes\nSYNTHETIC_W_STATUS: all parser tests pass.\n',
  wrote: 'SYNTHETIC_W_WROTE: file created',
  tests: 'SYNTHETIC_W_TESTS: 2 failing',
  old: 'SYNTHETIC_W_OLD: parser untested',
  edited: 'SYNTHETIC_W_EDITED: parser handles empty input',
  updated: 'SYNTHETIC_W_UPDATED: file updated',
  legacy: 'SYNTHETIC_W_LEGACY: legacy parser is stable',
  removed: 'SYNTHETIC_W_REMOVED: file deleted',
  draft: 'SYNTHETIC_W_DRAFT: the release notes are final',
  denied: 'SYNTHETIC_W_DENIED: the write was rejected',
  said: 'SYNTHETIC_W_SAID: the notes are written.',
  heredoc: 'cat > /srv/x/PLAN.md <<EOF\nSYNTHETIC_W_PLAN: the plan is approved\nEOF',
  plan: 'SYNTHETIC_W_PLAN: the plan is approved\n',
  refused: 'SYNTHETIC_W_REFUSED: the user refused the command',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const command = (id) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: whole('test'), input: [], changes: [], ...T1 });
const writeAction = (id, operation, path, change) => ({ id, kind: 'invocation', callKey: id,
  tool: operation === 'write' ? 'Write' : operation === 'edit' ? 'Edit' : 'Delete', operation,
  paths: [{ path }], command: [], input: [], changes: [{ path, diff: [], before: [], after: [], ...change }], ...T1 });
const result = (id, invocation, out, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole(out),
  sourceOfResult: 'native', ...T1, ...over });

/**
 * One turn: an early failing test run, the agent's write of the notes (a create), a later failing test
 * run, an edit of the notes, a delete of an old file, a write the record says failed, and a final
 * statement. `refusedHeredoc` (D80) adds, before the statement, a here-document command the recorder typed as refused
 * and the write the slicer parsed from it (`shellWriteOf`). `compaction` splits the
 * review right after the write, so the later test run is in a window the write's window was not shown. M35 windowing:
 * a compaction no longer splits, so the option also adds a long thought (730k bytes, over a session-only window's 200k
 * tokens) after it: the turn is cut at that thought.
 */
function session({ compaction = false, refusedHeredoc = false } = {}) {
  const blobs = { ...TEXT, ...(compaction ? { long: `SYNTHETIC_W_LONG: still working.\n${'w'.repeat(730_000)}` } : {}) };
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    command('A0'), result('A0-r', 'A0', 'early', { result: 'failed', exitCode: 1 }),
    writeAction('A1', 'write', '/srv/x/NOTES.md', { after: whole('notes') }), result('A1-r', 'A1', 'wrote'),
    ...(compaction ? [{ id: 'B1', kind: 'boundary', boundary: 'compaction', relatedSession: null, ...T1 },
      { id: 'L1', kind: 'commentary', phase: 'working', beforeInvocation: null, ...T1,
        text: [{ sourceKey: 'long', fromByte: 0, untilByte: Buffer.byteLength(blobs.long, 'utf8') }] }] : []),
    command('A2'), result('A2-r', 'A2', 'tests', { result: 'failed', exitCode: 1 }),
    writeAction('A3', 'edit', '/srv/x/NOTES.md', { before: whole('old'), after: whole('edited') }),
    result('A3-r', 'A3', 'updated'),
    writeAction('A4', 'delete', '/srv/x/LEGACY.md', { before: whole('legacy') }), result('A4-r', 'A4', 'removed'),
    writeAction('A5', 'write', '/srv/x/DRAFT.md', { after: whole('draft') }),
    result('A5-r', 'A5', 'denied', { result: 'failed', exitCode: null }),
    ...(refusedHeredoc ? [{ ...command('A6'), command: whole('heredoc'),
      recorded: { tool: 'Bash', isError: true, denial: 'user-rejected' } },
    result('A6-r', 'A6', 'refused', { result: 'failed', exitCode: null }),
    { ...writeAction('A7', 'edit', '/srv/x/PLAN.md', { after: whole('plan') }), tool: 'heredoc', shellWriteOf: 'A6',
      shellWriteStatusEligible: true }] : []),
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'), ...T1 },
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs, events });
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const STATUS = receipt('A1', 'code', 'SYNTHETIC_W_STATUS: all parser tests pass.');
const TESTS = receipt('A2-r', 'observation', TEXT.tests);
const EARLY = receipt('A0-r', 'observation', TEXT.early);
const EDITED = receipt('A3', 'code', TEXT.edited);
const OLD = receipt('A3', 'code', TEXT.old);
const LEGACY = receipt('A4', 'code', TEXT.legacy);
const COMMAND = receipt('A2', 'code', TEXT.test);
const DRAFT = receipt('A5', 'code', TEXT.draft);
const PLAN = receipt('A7', 'code', 'SYNTHETIC_W_PLAN: the plan is approved');
const SAID = receipt('C1', 'commentary', 'the notes are written.');
const TEXT_OF = 'The notes say all parser tests pass.';
const written = (stated, contradictedBy = null, text = TEXT_OF) => ({ text, stated, contradictedBy });
const narrativeOf = ({ claims = [], writtenClaims = [] } = {}) => ({ decisions: [], pivots: [], claims, requirements: [],
  writtenClaims });
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const vote = (key, verdict, cited, explanation = 'Recorded.') => ({ key, verdict, explanation, receipts: cited ? [cited] : [] });
/** Upholds every item, citing the recorded result every contradiction in these fixtures names. */
const upholdAll = ({ key }) => vote(key, 'not-refuted', TESTS);
const verdictOnWritten = (verdict, cited = TESTS) => (item) => (item.type === 'written'
  ? vote(item.key, verdict, verdict === 'uncertain' ? null : cited) : vote(item.key, 'not-refuted', TESTS));

/** Every request sent, and window `at`'s narrative. `voteFor(item, request)` votes, or null to leave it. */
function judgeWith(proposal, voteFor = upholdAll, seen = [], at = 0) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return request.window.index === at ? proposal : EMPTY;
    return { votes: request.challenge.items.map((item) => voteFor(item, request)).filter(Boolean) };
  };
}
const review = (proposal, voteFor = upholdAll, { base = session(), seen = [], at = 0 } = {}) =>
  reviewRun.runReview({ session: base, pr: null, reviewScope: 'session-only', judge: judgeWith(proposal, voteFor, seen, at) });
const challengeRequests = (seen) => seen.filter((request) => request.challenge);
const labelled = (report) => (report.writtenClaims ?? []).map((w) => [w.stated.eventId, w.label]);
const verdictOf = (report) => ({ sessionStatus: report.sessionStatus, reviewStatus: report.reviewStatus,
  sessionReview: report.sessionReview, coverage: report.coverage, codeStatus: report.codeStatus });
const ZERO_REJECTIONS = () => Object.fromEntries(ledger.WRITTEN_CONTRADICTION_REJECTIONS.map((r) => [r, 0]));

// ---- the closed vocabularies ---------------------------------------------------------------------------

test('M33 written: the labels, the withheld causes and the contradiction rejections are closed, frozen lists', () => {
  assert.deepEqual(ledger.WRITTEN_LABELS, ['unverified', 'contradicted']);
  // D80 adds one: a statement quoting only the body of a write whose command did not run or failed.
  assert.deepEqual(ledger.WRITTEN_WITHHELD_CAUSES, ['written_unreadable', 'written_not_own_write', 'written_ungrounded',
    'written_not_landed', 'write_command_not_run_or_failed']);
  // W2 (owner decision 2026-10-13) adds two: a contradiction from code that is not the agent's own earlier added text,
  // and one whose path was changed again before the statement was written.
  assert.deepEqual(ledger.WRITTEN_CONTRADICTION_REJECTIONS,
    ['unsupplied', 'ungrounded', 'not_later', 'not_own_written', 'source_rewritten', 'refuted', 'unsettled', 'unexecuted']);
  for (const list of [ledger.WRITTEN_LABELS, ledger.WRITTEN_WITHHELD_CAUSES, ledger.WRITTEN_CONTRADICTION_REJECTIONS])
    assert.ok(Object.isFrozen(list));
  for (const cause of ledger.WRITTEN_WITHHELD_CAUSES) {
    assert.ok(!ledger.WITHHELD_REJECTION_CAUSES.includes(cause), `${cause} is its own class's cause`);
    assert.ok(!ledger.JUDGMENT_REASONS.includes(cause), `${cause} is a cause, never a new reason`);
  }
});

// ---- positive -----------------------------------------------------------------------------------------

test('M33 written: a statement quoted from the agent\'s own write is published unverified, apart from claims and findings', async () => {
  const baseline = await review(narrativeOf());
  assert.equal(baseline.sessionStatus, 'CLEAN', 'premise: the session alone is CLEAN');
  const seen = [];
  const report = await review(narrativeOf({ writtenClaims: [written(STATUS)] }), upholdAll, { seen });
  assert.equal(report.writtenClaims.length, 1);
  const [statement] = report.writtenClaims;
  assert.deepEqual(Object.keys(statement).sort(), ['id', 'label', 'receipts', 'stated', 'text']);
  assert.equal(statement.label, 'unverified');
  assert.equal(statement.text, TEXT_OF);
  assert.deepEqual(statement.stated, { ...STATUS, sessionKey: SESSION_KEY });
  assert.deepEqual(statement.receipts, [statement.stated]);
  assert.equal(statement.id, identityDigest('sonah.written-claim-identity/1',
    { repo: REPO, stated: receiptProjection(statement.stated), text: TEXT_OF }));
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.promises, []);
  assert.equal(report.claimsRejected, 0);
  assert.deepEqual(verdictOf(report), verdictOf(baseline), 'never a status change');
  assert.equal(challengeRequests(seen).length, 0, 'nothing to challenge without a contradiction');
  assert.deepEqual(report.counts.writtenClaims, { unverified: 1, contradicted: 0, reclassified: 0,
    contradictionsRejected: ZERO_REJECTIONS() });
  // An edit's written body is a written statement too.
  const edited = await review(narrativeOf({ writtenClaims: [written(EDITED, null, 'The notes say the parser handles empty input.')] }));
  assert.deepEqual(labelled(edited), [['A3', 'unverified']]);
});

// ---- contradicted --------------------------------------------------------------------------------------

test('M33 written: a later recorded result the challenge upholds labels the statement contradicted — never a finding', async () => {
  const baseline = await review(narrativeOf());
  const seen = [];
  const report = await review(narrativeOf({ writtenClaims: [written(STATUS, TESTS)] }), upholdAll, { seen });
  assert.deepEqual(labelled(report), [['A1', 'contradicted']]);
  const [statement] = report.writtenClaims;
  assert.deepEqual(statement.receipts, [{ ...STATUS, sessionKey: SESSION_KEY }, { ...TESTS, sessionKey: SESSION_KEY }]);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(verdictOf(report), verdictOf(baseline), 'never a status change');
  assert.equal(report.counts.writtenClaims.contradicted, 1);
  // Its own challenge item, in calls of its own, showing the statement and the result said to contradict it.
  const requests = challengeRequests(seen);
  assert.equal(requests.length, 3, 'three passes');
  for (const request of requests)
    assert.deepEqual(request.challenge.items.map((item) => [item.key, item.type]), [['writtenClaims:0', 'written']]);
  assert.deepEqual(requests[0].challenge.items[0].candidate, { text: TEXT_OF, stated: STATUS, contradictedBy: TESTS });
});

test('M33 written: a contradiction the challenge does not uphold leaves the statement unverified, counted by outcome', async () => {
  const cases = [
    ['unsettled', verdictOnWritten('uncertain')],
    ['refuted', verdictOnWritten('refuted', STATUS)],
    // Three support votes that do not ground are not two grounded support votes.
    ['unsettled', verdictOnWritten('not-refuted', receipt('A2-r', 'observation', 'SYNTHETIC QUOTE NOBODY RECORDED'))],
    // One grounded support vote is not enough.
    ['refuted', (item, request) => (request.challenge.pass === 1 ? vote(item.key, 'not-refuted', TESTS)
      : vote(item.key, 'refuted', STATUS))],
  ];
  const baseline = await review(narrativeOf());
  for (const [reason, voteFor] of cases) {
    const report = await review(narrativeOf({ writtenClaims: [written(STATUS, TESTS)] }), voteFor);
    assert.deepEqual(labelled(report), [['A1', 'unverified']], reason);
    assert.deepEqual(report.writtenClaims[0].receipts, [{ ...STATUS, sessionKey: SESSION_KEY }], `${reason}: the result is not shown`);
    assert.equal(report.counts.writtenClaims.contradictionsRejected[reason], 1, reason);
    assert.deepEqual(verdictOf(report), verdictOf(baseline), reason);
  }
});

test('M33 written: a written challenge that never runs leaves the statement unverified and never makes the review incomplete', async () => {
  const baseline = await review(narrativeOf());
  // The challengers never vote on the written item, even when re-asked.
  const report = await review(narrativeOf({ writtenClaims: [written(STATUS, TESTS)] }),
    (item) => (item.type === 'written' ? null : upholdAll(item)));
  assert.deepEqual(labelled(report), [['A1', 'unverified']]);
  assert.equal(report.counts.writtenClaims.contradictionsRejected.unexecuted, 1);
  assert.deepEqual(reviewRun.windowIncompleteReasons(report.windowResults[0]), [], 'the window is complete');
  assert.deepEqual(verdictOf(report), verdictOf(baseline));
  // And a challenger that mis-keys the written vote costs nothing else in the window.
  const claim = { text: 'The agent said the notes are written.', stated: SAID, contradictedBy: null };
  const mixed = await review(narrativeOf({ claims: [claim], writtenClaims: [written(STATUS, TESTS)] }),
    (item) => vote(item.type === 'written' ? `${item.key}-x` : item.key, 'not-refuted', item.type === 'written' ? TESTS : SAID));
  assert.deepEqual(mixed.promises.map((p) => p.stated.eventId), ['C1'], 'the chat claim still survived its own challenge');
  assert.deepEqual(labelled(mixed), [['A1', 'unverified']]);
  assert.equal(mixed.sessionReview, 'complete');
});

test('M33 written: a contradiction recorded before the write, unsupplied or ungrounded is ignored: unverified, counted, never asked', async () => {
  const cases = [
    ['not_later', written(STATUS, EARLY), session()],
    ['ungrounded', written(STATUS, { ...TESTS, quote: 'SYNTHETIC QUOTE NOBODY RECORDED' }), session()],
    ['unsupplied', written(STATUS, TESTS), session({ compaction: true })],
  ];
  for (const [reason, statement, base] of cases) {
    const seen = [];
    const report = await review(narrativeOf({ writtenClaims: [statement] }), upholdAll, { base, seen });
    assert.deepEqual(labelled(report), [['A1', 'unverified']], reason);
    assert.equal(report.counts.writtenClaims.contradictionsRejected[reason], 1, reason);
    assert.equal(challengeRequests(seen).length, 0, `${reason}: never put to the challengers`);
    assert.equal(report.sessionReview, 'complete', reason);
  }
});

// ---- withheld ------------------------------------------------------------------------------------------

test('M33 written: a statement not quoted from the agent\'s own write, create or edit is withheld and counted', async () => {
  // A delete writes no body: its before-text is the file as found. A command has no written body.
  for (const stated of [LEGACY, COMMAND, receipt('C1', 'code', 'the notes are written.'), receipt('NOPE', 'code', 'SYNTHETIC_W_STATUS')]) {
    const report = await review(narrativeOf({ writtenClaims: [written(stated)] }));
    assert.deepEqual(report.writtenClaims, [], stated.eventId);
    assert.equal(report.withheld.proposals, 1, stated.eventId);
    assert.equal(report.withheld.causes?.written_not_own_write, 1, stated.eventId);
    assert.equal(report.sessionReview, 'complete', stated.eventId);
  }
});

test('M33 written: a quote that is not in the written body, or that its window was not shown, is withheld as ungrounded', async () => {
  const cases = [
    // An edit's before-text is code the record found, not text the agent wrote.
    ['before-text', written(OLD), { base: session() }],
    ['no such text', written(receipt('A1', 'code', 'SYNTHETIC QUOTE NOBODY RECORDED')), { base: session() }],
    // Proposed by the second window, citing a write only the first window was shown.
    ['unsupplied', written(STATUS), { base: session({ compaction: true }), at: 1 }],
  ];
  for (const [name, statement, options] of cases) {
    const report = await review(narrativeOf({ writtenClaims: [statement] }), upholdAll, options);
    assert.deepEqual(report.writtenClaims, [], name);
    assert.equal(report.withheld.causes?.written_ungrounded, 1, name);
    assert.equal(report.withheld.proposals, 1, name);
    assert.equal(report.sessionReview, 'complete', name);
    assert.ok(report.windowResults.every((w) => reviewRun.windowIncompleteReasons(w).length === 0), name);
  }
});

test('M33 written: a statement from a write the record says failed never reached a file: withheld and counted', async () => {
  const report = await review(narrativeOf({ writtenClaims: [written(DRAFT, null, 'The draft says the notes are final.')] }));
  assert.deepEqual(report.writtenClaims, []);
  assert.equal(report.withheld.causes?.written_not_landed, 1);
  assert.equal(report.withheld.proposals, 1);
  assert.deepEqual(reviewRun.windowIncompleteReasons(report.windowResults[0]), []);
});

test('M33 written: a malformed written statement is withheld and counted; its window stays complete', async () => {
  const nested = (depth) => JSON.parse(`${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`);
  const malformed = [
    'SYNTHETIC not an object',
    null,
    { text: '', stated: STATUS, contradictedBy: null },
    { text: TEXT_OF, stated: STATUS, contradictedBy: null, confidence: 'high' },
    { text: TEXT_OF, stated: { ...STATUS, role: 'commentary' }, contradictedBy: null },
    { text: TEXT_OF, stated: { ...STATUS, severity: 'low' }, contradictedBy: null },
    { text: TEXT_OF, stated: STATUS, contradictedBy: { ...TESTS, role: 'action' } },
    { text: TEXT_OF, stated: nested(20000), contradictedBy: null },
    { text: TEXT_OF, stated: STATUS, contradictedBy: nested(20000) },
  ];
  const baseline = await review(narrativeOf());
  const report = await review(narrativeOf({ writtenClaims: [...malformed, written(STATUS)] }));
  assert.deepEqual(labelled(report), [['A1', 'unverified']], 'the readable one is still published');
  assert.equal(report.withheld.proposals, malformed.length);
  assert.equal(report.withheld.causes?.written_unreadable, malformed.length);
  assert.deepEqual(reviewRun.windowIncompleteReasons(report.windowResults[0]), []);
  assert.deepEqual(verdictOf(report), verdictOf(baseline));
  assert.doesNotThrow(() => JSON.stringify(report), 'nothing unbounded is kept');
  // A writtenClaims value that is not a list is one unreadable proposal; an absent one is none.
  const notAList = await review({ ...narrativeOf(), writtenClaims: 'SYNTHETIC not a list' });
  assert.equal(notAList.withheld.causes?.written_unreadable, 1);
  assert.deepEqual(verdictOf(notAList), verdictOf(baseline));
  const absent = await review(EMPTY);
  assert.deepEqual(absent.writtenClaims, []);
  assert.deepEqual(verdictOf(absent), verdictOf(baseline));
});

// ---- reclassified chat claims ----------------------------------------------------------------------------

test('M33 written: a chat claim quoting the text a create action wrote is reclassified as a written statement, not unread', async () => {
  const baseline = await review(narrativeOf());
  // The exact shape a model returned: a claims item whose stated receipt is role code on a create action.
  const chat = { text: TEXT_OF, stated: { eventId: 'A1', role: 'code', quote: 'SYNTHETIC_W_STATUS: all parser tests pass.' },
    contradictedBy: null };
  const report = await review(narrativeOf({ claims: [chat] }));
  assert.deepEqual(labelled(report), [['A1', 'unverified']]);
  assert.equal(report.claimsRejected, 0);
  assert.deepEqual(report.promises, []);
  assert.deepEqual(report.findings, []);
  assert.equal(report.counts.writtenClaims.reclassified, 1);
  assert.deepEqual(report.windowResults[0].challenge.rejected, [], 'never kind_rejected');
  assert.deepEqual(verdictOf(report), verdictOf(baseline));
  // Contradicted, it is a written statement's challenge item — never a claim_contradicted finding.
  const seen = [];
  const contradicted = await review(narrativeOf({ claims: [{ ...chat, contradictedBy: TESTS }] }), upholdAll, { seen });
  assert.deepEqual(labelled(contradicted), [['A1', 'contradicted']]);
  assert.deepEqual(contradicted.findings, []);
  assert.deepEqual(verdictOf(contradicted), verdictOf(baseline));
  assert.ok(challengeRequests(seen).every((request) => request.challenge.items.every((item) => item.type === 'written')));
  // A resolvedBy riding on the reclassified claim is ignored: a written statement has none.
  const resolved = await review(narrativeOf({ claims: [{ ...chat, resolvedBy: { observation: TESTS, statement: SAID } }] }));
  assert.deepEqual(labelled(resolved), [['A1', 'unverified']]);
  assert.equal(resolved.claimsRejected, 0);
});

// ---- the combined route ----------------------------------------------------------------------------------

const GREET = 'src/greet.js';
const GREET_DIFF = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/greet.js', '@@ -0,0 +1,1 @@', '+export default "SYNTHETIC_W_GREETING";', ''].join('\n');
const GREET_PR = { repo: { host: 'github.com', id: '334' }, number: 334, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
  files: [{ path: GREET, change: 'added', contentState: 'complete' }] };
const jointJudge = (proposal, voteFor = upholdAll) => async (request) => {
  const base = { ...narrativeOf(), codeFindings: [], sessionFindings: [] };
  if (request.challenge) return { votes: request.challenge.items.map((item) => voteFor(item, request)).filter(Boolean) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
  if (request.label === 'code+narrative:w1') return { ...base, reviewedFiles: [], ...proposal };
  return { ...base, reviewedFiles: [] };
};

test('M33 written: the combined route publishes written statements and never counts one against the narrative', async () => {
  const baseline = await runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF, judge: jointJudge({}) });
  const chat = { text: TEXT_OF, stated: STATUS, contradictedBy: null };
  const report = await runCodeReview({ session: session(), pr: GREET_PR, diff: GREET_DIFF,
    judge: jointJudge({ writtenClaims: [written(STATUS, TESTS), 'SYNTHETIC not an object'], claims: [chat] }) });
  assert.deepEqual(report.writtenClaims.map((w) => [w.stated.eventId, w.label]), [['A1', 'contradicted']],
    'the reclassified chat claim is the same statement, published once');
  assert.equal(report.rejectedNarrative, 0);
  assert.equal(report.withheld.causes?.written_unreadable, 1);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(verdictOf(report), verdictOf(baseline));
});

// ---- what the readers read ----------------------------------------------------------------------------

test('M33 written: written statements stay apart from claims and findings, each with its side label', async () => {
  const report = await review(narrativeOf({ writtenClaims: [written(STATUS, TESTS),
    written(EDITED, null, 'The notes say the parser handles empty input.')] }));
  assert.deepEqual(labelled(report), [['A1', 'contradicted'], ['A3', 'unverified']]);
  // D88: the contradicted statement counts; the one not checked is folded (`writtenRowKind`).
  assert.deepEqual(report.writtenClaims.map((w) => reviewRender.writtenRowKind(w)), ['writtenContradicted', 'writtenOpen']);
  assert.ok(!JSON.stringify([report.findings, report.promises ?? []]).includes(TEXT_OF), 'never a finding or a claim');
});

test('M33 written: withheld written statements are counted by cause', async () => {
  // D80: and a statement quoted only from the body of a here-document whose command was refused.
  const report = await review(narrativeOf({ writtenClaims: ['SYNTHETIC not an object', written(LEGACY), written(OLD),
    written(DRAFT), written(PLAN)] }), upholdAll, { base: session({ refusedHeredoc: true }) });
  for (const cause of ledger.WRITTEN_WITHHELD_CAUSES) assert.equal(report.withheld.causes[cause], 1, cause);
});

// ---- the prompts, the schema and the challenger --------------------------------------------------------

test('M33 written: the narrative asks for writtenClaims apart from claims, and the versions moved', () => {
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
  // D103 moved it once more (sonah.narrative/38): a Claude Code recording's results shown up to 12,000 bytes a side.
  assert.equal(prompt.PROMPT_VERSION, 'sonah.narrative/38');
  const schema = prompt.NARRATIVE_SCHEMA;
  // Asked for, never required: an answer without it proposes no written statement and stays storable (D60).
  assert.deepEqual(schema.required, ['decisions', 'pivots', 'claims', 'requirements']);
  const item = schema.properties.writtenClaims.items;
  assert.deepEqual(item.required, ['text', 'stated']);
  assert.equal(item.properties.stated.properties.role.const, 'code');
  assert.deepEqual(item.properties.contradictedBy.type, ['object', 'null']);
  assert.equal(item.properties.contradictedBy.properties.role.const, 'observation');
  const built = prompt.buildNarrativePrompt({ session: session(), window: { index: 0, events: session().events } });
  const flat = built.prompt.replace(/\s+/g, ' ');
  assert.match(flat, /"writtenClaims"/);
  assert.match(flat, /WRITTEN STATEMENTS/);
  assert.match(flat, /never in claims/i);
  assert.ok(!built.evidencePrompt.includes('writtenClaims'), 'guidance is task text, never evidence');
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
  // D103 moved it once more (sonah.narrative/38): a Claude Code recording's results shown up to 12,000 bytes a side.
  assert.equal(reviewRun.runProfile('session-only').promptVersion, 'sonah.narrative/38');
  // The combined route closes the same schema.
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
  const closed = codeReviewPrompt.CODE_REVIEW_SCHEMA.properties.writtenClaims.items;
  assert.equal(closed.additionalProperties, false);
  assert.equal(closed.properties.stated.additionalProperties, false);
  assert.ok(!codeReviewPrompt.CODE_REVIEW_SCHEMA.required.includes('writtenClaims'));
  const base = session();
  const snapshot = { diff: 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n',
    files: [{ path: 'x.js', oldPath: null, change: 'modified', contentState: 'complete' }],
    sources: [], baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), complete: true };
  const joint = codeReviewPrompt.buildCodeReviewPrompt({ snapshot, placed: null,
    narrativePrompt: prompt.buildNarrativePrompt({ session: base, window: { index: 0, events: base.events } }) });
  // The joint request's task text, never its evidence.
  const task = joint.prompt.replace(joint.evidencePrompt, '').replace(/\s+/g, ' ');
  assert.match(task, /writtenClaims: \{text, stated:\{eventId, role:"code", quote\}/);
  assert.match(task, /never a claims item/);
  assert.ok(!joint.evidencePrompt.includes('writtenClaims'));
});

test('M33 written: the challenger is told how to judge a written statement', async () => {
  // M33 C2 (challenge/9): and that the written words, verbatim, are the statement it judges.
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
  const seen = [];
  await review(narrativeOf({ writtenClaims: [written(STATUS, TESTS)] }), upholdAll, { seen });
  const flat = challengeRequests(seen)[0].system.replace(/\s+/g, ' ');
  assert.match(flat, /written candidate/i);
  assert.match(flat, /recorded after the write/i);
  // D71 (S2): a session-only batch of written statements is sent the core, the claim note (a written
  // statement is a claim-class item) and CLAIM_WORDS_NOTE.
  assert.equal(challengeRequests(seen)[0].system, challenge.checklistSystem(['written']));
});
