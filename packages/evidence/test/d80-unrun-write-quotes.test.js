// D80 (owner decision 2026-10-12): a quote from a write that may not have happened is refused. A code receipt or a
// failure response that quotes the body of a write the slicer parsed from a command (`shellWriteOf`: a heredoc's body)
// whose command did not run or failed is refused, by the command's typed end (ledger.js UNRUN_WRITE_ENDS: did-not-run,
// ran-failed, failed-or-refused), with one closed reason (UNRUN_WRITE_REASON) — wherever a quote is checked against
// the session: a decision's value, a requirement's deliverable, a failure row's response, a written statement and a
// challenge vote's receipt. A quote also found verbatim in a write or a result that did happen still grounds, and a
// write of a command that ran and did not fail grounds as before. Structure and verbatim search only.
// Every session here is synthetic and hand-built; no model is called (the judges are code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { UNRUN_WRITE_REASON, UNRUN_WRITE_ENDS, unrunWrite, quotesOnlyUnrunWrite, groundDecision, actionOutcome,
  REQUIREMENT_UNCHECKED_REASONS, FAILURE_UNCHECKED_REASONS, VALUE_UNCHECKED_CAUSES, WRITTEN_WITHHELD_CAUSES,
  RESULT_OUTCOME_CLASSES, JUDGMENT_REASONS } from '../src/ledger.js';
import { VOTE_REJECTION_CAUSES } from '../src/challenge.js';
import { checkedRequirement, failuresCheck } from '../src/checklist.js';
import { readWrittenStatement } from '../src/written.js';
import { runReview } from '../src/run-review.js';
import { CHECKLIST_REQUIREMENT_REASON_WORDS, CHECKLIST_FAILURE_REASON_WORDS } from '../src/review.js';

const KEY = 'sess-d80';
const ASK = 'SYNTHETIC_D80_ASK: write the parser notes.';
// The refused here-document's body: one line only it holds, one a real Write also wrote, one a result also printed,
// and one only a Write the recorder typed as failed also holds.
const ONLY = 'SYNTHETIC_D80_ONLY: retries default to three';
const SHARED = 'SYNTHETIC_D80_SHARED: the parser skips blank lines';
const SEEN = 'SYNTHETIC_D80_SEEN: the plan has two steps';
const LOST = 'SYNTHETIC_D80_LOST: the draft section';
const FAILED = 'SYNTHETIC_D80_FAILED: notes a failing command wrote';
const RAN = 'SYNTHETIC_D80_RAN: notes a passing command wrote';
const NOEND = 'SYNTHETIC_D80_NOEND: notes a command with no result wrote';
const UNTYPED = 'SYNTHETIC_D80_UNTYPED: notes a command failed or refused untyped wrote';

function build() {
  const blobs = {};
  const events = [];
  const put = (key, text) => {
    blobs[key] = text;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
  };
  const push = (event) => { events.push({ sequence: events.length, turn: 'T1', ...event }); return event.id; };
  const result = (of, over) => push({ id: `${of}-r`, kind: 'observation', invocation: of, callKey: of,
    phase: 'terminal', terminalStatusProven: true, sourceOfResult: 'native',
    output: put(`${of}-out`, `SYNTHETIC_D80 output of ${of}`), ...over });
  const command = (id, cmd, recorded, outcome, over = {}) => {
    push({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [], command: put(id, cmd),
      input: [], changes: [], recorded: { tool: 'Bash', ...recorded }, ...over });
    if (outcome) result(id, outcome);
  };
  /** The write the slicer emits beside a `cat > path <<'EOF'` command: its path and body, no result of its own. */
  const heredoc = (id, of, path, body) => push({ id, kind: 'invocation', callKey: id, tool: 'heredoc',
    operation: 'edit', paths: [{ path }], command: [], input: [], shellWriteOf: of, shellWriteStatusEligible: true,
    changes: [{ path, before: [], after: put(`${id}-after`, body), diff: [] }] });
  const write = (id, path, body, outcome, recorded = {}) => {
    push({ id, kind: 'invocation', callKey: id, tool: 'Write', operation: 'write', paths: [{ path }], command: [],
      input: [], changes: [{ path, before: [], after: put(`${id}-after`, body), diff: [] }],
      recorded: { tool: 'Write', ...recorded } });
    result(id, outcome);
  };
  push({ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: put('ask', ASK) });
  command('T1', 'node --test', { isError: true }, { result: 'failed', exitCode: 1 });
  command('C1', "cat > notes/plan.md <<'EOF'", { isError: true, denial: 'user-rejected' },
    { result: 'failed', exitCode: null });
  heredoc('S1', 'C1', 'notes/plan.md', `${ONLY}\n${SHARED}\n${SEEN}\n${LOST}\n`);
  command('C2', "cat > notes/failed.md <<'EOF'", { isError: true }, { result: 'failed', exitCode: 1 });
  heredoc('S2', 'C2', 'notes/failed.md', `${FAILED}\n`);
  command('C3', "cat > notes/ran.md <<'EOF'", {}, { result: 'succeeded', exitCode: 0 });
  heredoc('S3', 'C3', 'notes/ran.md', `${RAN}\n`);
  command('C4', "cat > notes/noend.md <<'EOF'", {}, null);
  heredoc('S4', 'C4', 'notes/noend.md', `${NOEND}\n`);
  // A recorder that types no refusal (Codex): failed, or refused before it ran (the slicer's `refusalUntyped`).
  command('C5', "cat > notes/untyped.md <<'EOF'", {}, { result: 'failed', exitCode: null }, { refusalUntyped: true });
  heredoc('S5', 'C5', 'notes/untyped.md', `${UNTYPED}\n`);
  write('W1', 'notes/parser.md', `# Parser\n${SHARED}\n`, { result: 'succeeded', exitCode: null });
  write('W2', 'notes/draft.md', `${LOST}\n`, { result: 'failed', exitCode: null }, { isError: true });
  push({ id: 'R1', kind: 'invocation', callKey: 'R1', tool: 'Read', operation: 'other', paths: [{ path: 'PLAN.txt' }],
    command: [], input: [], changes: [] });
  result('R1', { result: 'succeeded', exitCode: null, output: put('R1-read', `1\t${SEEN}\n`) });
  push({ id: 'F1', kind: 'commentary', phase: 'final', beforeInvocation: null,
    text: put('F1', 'SYNTHETIC_D80 Done.') });
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs, events });
}

const code = (eventId, quote) => ({ eventId, role: 'code', quote });
/** A source map that shows every event of the session whole, as a window holding all of them would (or, with `drop`,
 *  all but those). */
const shownAll = (session, drop = []) => Object.fromEntries(session.events.filter((event) => !drop.includes(event.id))
  .map((event) => [event.id, session.sourcesFor(event).map(({ role, text }) => ({ role, text }))]));

test('D80 the closed reason: one token, in every list a refused quote is counted in, each with reader words', () => {
  assert.equal(UNRUN_WRITE_REASON, 'write_command_not_run_or_failed');
  assert.deepEqual([...UNRUN_WRITE_ENDS], ['did-not-run', 'ran-failed', 'failed-or-refused']);
  for (const end of UNRUN_WRITE_ENDS) assert.ok(RESULT_OUTCOME_CLASSES.includes(end), end);
  for (const list of [REQUIREMENT_UNCHECKED_REASONS, FAILURE_UNCHECKED_REASONS, VALUE_UNCHECKED_CAUSES,
    WRITTEN_WITHHELD_CAUSES, VOTE_REJECTION_CAUSES]) {
    assert.ok(Object.isFrozen(list));
    // D99 (F1 guard) appended two more requirement reasons after it (`check_end_unread`, `check_end_unchecked`): this
    // one keeps its place.
    assert.equal(list.at(list === REQUIREMENT_UNCHECKED_REASONS ? -3 : -1), UNRUN_WRITE_REASON,
      'appended: every earlier member keeps its place');
  }
  assert.ok(!JUDGMENT_REASONS.includes(UNRUN_WRITE_REASON), 'a cause and a row reason, never a new judgment reason');
  assert.equal(typeof CHECKLIST_REQUIREMENT_REASON_WORDS[UNRUN_WRITE_REASON], 'string');
  assert.equal(typeof CHECKLIST_FAILURE_REASON_WORDS[UNRUN_WRITE_REASON], 'string');
});

test('D80 a parsed write is unrun by its command\'s typed end: did not run or failed, and no other end', () => {
  const session = build();
  const unrun = (id, options) => unrunWrite(session, session.event(id), options);
  assert.deepEqual(['S1', 'S2', 'S3', 'S4', 'S5'].map((id) => unrun(id)), [true, true, false, false, true]);
  assert.deepEqual(['C1', 'C2', 'C3', 'C4', 'C5'].map((id) => actionOutcome(session, session.event(id)).class),
    ['did-not-run', 'ran-failed', 'ran-exit-0', 'no-terminal-status', 'failed-or-refused'], 'premise');
  // Only a parsed write: the command itself, a structured write (even one typed as failed) and a read are not.
  assert.deepEqual(['C1', 'C2', 'W1', 'W2', 'R1', 'S9'].map((id) => unrun(id)),
    [false, false, false, false, false, false]);
  // D59: by the results recorded at or before the window's end.
  const refusedAt = session.event('C1-r').sequence;
  assert.deepEqual([unrun('S1', { until: refusedAt - 1 }), unrun('S1', { until: refusedAt })], [false, true]);
});

// D80 integration (items 4 and Q): a call denied with a stopped kind (STOPPED_DENIALS) reads no-terminal-status since
// item 4, where it read did-not-run when Q was written; its write is still one that may not have happened.
test('D80 a write of a command stopped before it finished is unrun too; a stopped Write attests nothing', () => {
  for (const denial of ['interrupted', 'cancelled']) {
    const blobs = {};
    const events = [];
    const put = (key, text) => {
      blobs[key] = text;
      return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
    };
    const push = (event) => { events.push({ sequence: events.length, turn: 'T1', ...event }); return event.id; };
    const ended = (of) => push({ id: `${of}-r`, kind: 'observation', invocation: of, callKey: of, phase: 'terminal',
      terminalStatusProven: true, sourceOfResult: 'native', output: put(`${of}-out`, `SYNTHETIC_D80 output of ${of}`),
      result: 'failed', exitCode: null });
    push({ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: put('ask', ASK) });
    push({ id: 'C1', kind: 'invocation', callKey: 'C1', tool: 'Bash', operation: 'command', paths: [],
      command: put('C1', "cat > notes/plan.md <<'EOF'"), input: [], changes: [],
      recorded: { tool: 'Bash', isError: true, denial } });
    ended('C1');
    push({ id: 'S1', kind: 'invocation', callKey: 'S1', tool: 'heredoc', operation: 'edit',
      paths: [{ path: 'notes/plan.md' }], command: [], input: [], shellWriteOf: 'C1', shellWriteStatusEligible: true,
      changes: [{ path: 'notes/plan.md', before: [], after: put('S1-after', `${ONLY}\n${LOST}\n`), diff: [] }] });
    push({ id: 'W2', kind: 'invocation', callKey: 'W2', tool: 'Write', operation: 'write',
      paths: [{ path: 'notes/draft.md' }], command: [], input: [],
      changes: [{ path: 'notes/draft.md', before: [], after: put('W2-after', `${LOST}\n`), diff: [] }],
      recorded: { tool: 'Write', isError: true, denial } });
    ended('W2');
    const session = new Session({ sessionKey: KEY, adapter: 'claude', blobs, events });
    assert.equal(actionOutcome(session, session.event('C1')).class, 'no-terminal-status', `premise (${denial})`);
    assert.equal(unrunWrite(session, session.event('S1')), true, denial);
    assert.equal(unrunWrite(session, session.event('S1'), { until: session.event('C1-r').sequence - 1 }), false);
    assert.equal(quotesOnlyUnrunWrite(session, code('S1', ONLY)), true, denial);
    assert.equal(quotesOnlyUnrunWrite(session, code('S1', LOST)), true, `a stopped Write attests nothing (${denial})`);
  }
});

test('D80 a quote is refused only where it is ONLY in an unrun write\'s body; what did happen still grounds it', () => {
  const session = build();
  const only = (receipt, options) => quotesOnlyUnrunWrite(session, receipt, options);
  // The refused here-document's own line, and the failed command's.
  assert.equal(only(code('S1', ONLY)), true);
  assert.equal(only(code('S2', FAILED)), true);
  assert.equal(only(code('S5', UNTYPED)), true);
  // Also verbatim in a Write that ran to a typed success, or in a result's output: it still grounds.
  assert.equal(only(code('S1', SHARED)), false);
  assert.equal(only(code('S1', SEEN)), false);
  // Also verbatim only in a Write the recorder typed as failed: that did not happen either.
  assert.equal(only(code('S1', LOST)), true);
  // A command that ran and did not fail, or one with no result recorded: as before.
  assert.equal(only(code('S3', RAN)), false);
  assert.equal(only(code('S4', NOEND)), false);
  // Only a code receipt on the write's body: its path (role action), a quote not in its body, another event.
  assert.equal(only({ eventId: 'S1', role: 'action', quote: 'notes/plan.md' }), false);
  assert.equal(only(code('S1', 'SYNTHETIC_D80 nowhere')), false);
  assert.equal(only(code('W1', SHARED)), false);
  for (const bad of [null, 'S1', { eventId: 'S1', role: 'code' }, code('S1', ''), code('S9', ONLY)])
    assert.equal(only(bad), false, JSON.stringify(bad));
  // What a window showed decides where else the quote is: a Write the window was not shown attests nothing there.
  assert.equal(only(code('S1', SHARED), { sourceMap: shownAll(session) }), false);
  assert.equal(only(code('S1', SHARED), { sourceMap: shownAll(session, ['W1']) }), true);
  assert.equal(only(code('S1', SEEN), { sourceMap: shownAll(session, ['R1-r']) }), true);
  // D59: a window that ends before the refusal is recorded does not read it.
  assert.equal(only(code('S1', ONLY), { until: session.event('C1-r').sequence - 1 }), false);
});

const requirement = (deliverable, quote = 'write the parser notes') => ({ text: quote, status: 'done',
  instruction: { eventId: 'I1', role: 'instruction', quote }, deliverable });

test('D80 a done ask whose deliverable is only in an unrun write is not checked, with the closed reason', () => {
  const session = build();
  const sourceMap = shownAll(session);
  const check = (deliverable) => {
    const { candidate, reason } = checkedRequirement(session, requirement(deliverable), { sourceMap });
    return [candidate.status, reason, candidate.deliverable?.eventId ?? null];
  };
  assert.deepEqual(check(code('S1', ONLY)), ['not-checked', UNRUN_WRITE_REASON, null]);
  assert.deepEqual(check(code('S2', FAILED)), ['not-checked', UNRUN_WRITE_REASON, null]);
  // The same quote also in a real Write grounds; a passing command's write grounds as before.
  assert.deepEqual(check(code('S1', SHARED)), ['done', null, 'S1']);
  assert.deepEqual(check(code('W1', SHARED)), ['done', null, 'W1']);
  assert.deepEqual(check(code('S3', RAN)), ['done', null, 'S3']);
  // An earlier check still names its own reason first.
  assert.deepEqual(check(code('S1', `${ONLY} and more`)), ['not-checked', 'deliverable_ungrounded', null]);
});

test('D80 an acted-on failure row whose response is only in an unrun write is not checked, with the reason', () => {
  const session = build();
  const sourceMap = shownAll(session);
  const window = { events: session.events };
  const row = (response) => failuresCheck(session, window, [{ eventId: 'T1-r', handling: 'acted-on', response }],
    { sourceMap }).rows[0];
  const of = (response) => { const { candidate, reason } = row(response); return [candidate.handling, reason]; };
  assert.deepEqual(of(code('S1', ONLY)), ['not-checked', UNRUN_WRITE_REASON]);
  assert.deepEqual(of(code('S2', FAILED)), ['not-checked', UNRUN_WRITE_REASON]);
  assert.deepEqual(of(code('S1', SHARED)), ['acted-on', null]);
  assert.deepEqual(of(code('W1', SHARED)), ['acted-on', null]);
  assert.deepEqual(of(code('S3', RAN)), ['acted-on', null]);
  // The refused command itself is an action the agent took (what it attempted): its words are not a write's body.
  assert.deepEqual(of({ eventId: 'C1', role: 'action', quote: "cat > notes/plan.md <<'EOF'" }), ['acted-on', null]);
});

test('D80 a decision\'s value quoted only from an unrun write is unchecked by the cause, before its outcome', () => {
  const session = build();
  const ground = (eventId, quote, value) => groundDecision({ repo: { host: 'github.com', id: '0' }, session, pr: null,
    instructionHistoryComplete: true, candidate: { actorSession: KEY, dimension: 'SYNTHETIC_D80_VALUE',
      chosen: 'SYNTHETIC_D80 retries', actions: [eventId], value, stated: null, constrainedBy: null,
      valueReceipt: { eventId, role: 'code', field: 'added-code', quote } } }).decision;
  const refused = ground('S1', ONLY, 'three');
  assert.deepEqual([refused.value, refused.valueReceipt, refused.valueState], [null, null, 'unchecked']);
  assert.deepEqual(refused.valueUnchecked, { cause: UNRUN_WRITE_REASON, action: 'S1' });
  assert.deepEqual(ground('S2', FAILED, 'failing').valueUnchecked, { cause: UNRUN_WRITE_REASON, action: 'S2' });
  // Also in a real Write: D80's refusal of the quote does not apply. D98 (F9): the write's own effect is named by the
  // one effect rule — its command was refused before it ran, so it did not happen (unsuccessful), never an unknown
  // outcome.
  assert.deepEqual(ground('S1', SHARED, 'blank lines').valueUnchecked,
    { cause: 'write_unsuccessful', action: 'S1' });
  // A passing command's licensed write (eligible, one terminal receipt, a typed exit 0) grounds as before.
  const ran = ground('S3', RAN, 'passing');
  assert.deepEqual([ran.valueState, ran.value, ran.valueReceipt.quote], ['grounded', 'passing', RAN]);
});

test('D80 a written statement quoted only from an unrun write is withheld, with the closed cause', () => {
  const session = build();
  const sourceMap = shownAll(session);
  const read = (stated) => readWrittenStatement(
    { text: 'SYNTHETIC_D80 the notes say so', stated, contradictedBy: null }, { session, sourceMap });
  assert.deepEqual(read(code('S1', ONLY)), { withheld: UNRUN_WRITE_REASON });
  assert.deepEqual(read(code('S2', FAILED)), { withheld: UNRUN_WRITE_REASON });
  // D98 (F9): also in a real Write, the quote still names a write refused before it ran: it never put the text into its
  // file, so it is no statement the agent wrote into one.
  assert.deepEqual(read(code('S1', SHARED)), { withheld: 'written_not_landed' });
  assert.equal(read(code('S3', RAN)).statement.stated.eventId, 'S3');
});

/** A judge that answers the narrative with `answer` and votes not-refuted on every challenge item, citing `cite(item)`;
 *  every request is kept in `seen`. */
const judgeOf = (answer, cite, seen = []) => async (request) => {
  seen.push(request);
  if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
    explanation: 'Synthetic.', receipts: [cite(item)] })) };
  return answer;
};

test('D80 end to end: the rows are lowered and counted; a vote receipt only in an unrun write is refused', async () => {
  const session = build();
  const answer = { decisions: [], pivots: [], claims: [], requirements: [
    requirement(code('S1', ONLY)), requirement(code('W1', SHARED), 'SYNTHETIC_D80_ASK')],
  failures: [{ eventId: 'T1-r', handling: 'acted-on', response: code('S2', FAILED) },
    // A real session's shape: the refused here-document's own result, answered with its own body, which a real Write
    // wrote too, later in its session. This pins the "also found" grounding the brief added to D80's words; the
    // review of D80 Q left keeping it to the owner (it is what keeps such a row acted-on).
    { eventId: 'C1-r', handling: 'acted-on', response: code('S1', SHARED) }] };
  // Every vote cites the refused here-document's own line: never the evidence for any item.
  const report = await runReview({ session, pr: null, reviewScope: 'session-only',
    judge: judgeOf(answer, () => code('S1', ONLY)) });
  const reqOf = (r, text) => r.requirements.find((row) => row.text === text);
  const failureOf = (r, id) => r.failures.find((row) => row.eventId === id);
  const refused = reqOf(report, 'write the parser notes');
  assert.deepEqual([refused.status, refused.reason, refused.deliverable],
    ['not-checked', UNRUN_WRITE_REASON, undefined]);
  assert.deepEqual([failureOf(report, 'T1-r').handling, failureOf(report, 'T1-r').reason],
    ['not-checked', UNRUN_WRITE_REASON]);
  assert.equal(report.counts.checklist.requirements.reasons[UNRUN_WRITE_REASON], 1);
  assert.equal(report.counts.checklist.failures.reasons[UNRUN_WRITE_REASON], 1);
  // The two rows that held were asked; every vote on them cited only the unrun write, so each is refused with the cause
  // and neither row is upheld.
  const votes = report.windowResults.flatMap((w) => w.challenge.results).flatMap((r) => r.votes);
  assert.ok(votes.length > 0);
  assert.ok(votes.every((v) => v.answered && !v.valid && v.reason === 'receipt_rejected'
    && v.cause === UNRUN_WRITE_REASON), JSON.stringify(votes.map((v) => [v.valid, v.reason, v.cause ?? null])));
  // The same votes citing a line a real Write also wrote bind and uphold both rows, as before.
  const upheld = await runReview({ session, pr: null, reviewScope: 'session-only',
    judge: judgeOf(answer, (item) => item.candidate.deliverable ?? item.candidate.response) });
  assert.deepEqual([reqOf(upheld, 'SYNTHETIC_D80_ASK').status, reqOf(upheld, 'SYNTHETIC_D80_ASK').deliverable.eventId],
    ['done', 'W1']);
  assert.deepEqual([failureOf(upheld, 'C1-r').handling, failureOf(upheld, 'C1-r').response.eventId],
    ['acted-on', 'S1']);
  assert.deepEqual([reqOf(upheld, 'write the parser notes').reason, failureOf(upheld, 'T1-r').reason],
    [UNRUN_WRITE_REASON, UNRUN_WRITE_REASON], 'lowered before anything is asked, whatever the votes');
  assert.ok(upheld.windowResults.flatMap((w) => w.challenge.results).flatMap((r) => r.votes).every((v) => v.valid));
});

// Review of D80 Q (finding 1): the body of a refused here-document is also in a Write that ran BEFORE the ask (and so
// before the refused write), in a Write of another session after it, and in a Write of its own session after it.
const EARLY = 'SYNTHETIC_D80_EARLY: the notes were drafted before the ask';
const CHILD = 'SYNTHETIC_D80_CHILD: a helper wrote this line too';
const LATE = 'SYNTHETIC_D80_LATE: the agent wrote this line again';

function buildEarly() {
  const blobs = {};
  const events = [];
  const put = (key, text) => {
    blobs[key] = text;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
  };
  const push = (event) => { events.push({ sequence: events.length, turn: 'T1', ...event }); return event.id; };
  const result = (of, over) => push({ id: `${of}-r`, kind: 'observation', invocation: of, callKey: of,
    phase: 'terminal', terminalStatusProven: true, sourceOfResult: 'native',
    output: put(`${of}-out`, `SYNTHETIC_D80 output of ${of}`), ...over });
  const write = (id, path, body, over = {}) => {
    push({ id, kind: 'invocation', callKey: id, tool: 'Write', operation: 'write', paths: [{ path }], command: [],
      input: [], changes: [{ path, before: [], after: put(`${id}-after`, body), diff: [] }],
      recorded: { tool: 'Write' }, ...over });
    result(id, { result: 'succeeded', exitCode: null, ...over });
  };
  write('W0', 'notes/early.md', `${EARLY}\n`);
  push({ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: put('ask', ASK) });
  push({ id: 'C1', kind: 'invocation', callKey: 'C1', tool: 'Bash', operation: 'command', paths: [],
    command: put('C1', "cat > notes/plan.md <<'EOF'"), input: [], changes: [],
    recorded: { tool: 'Bash', isError: true, denial: 'user-rejected' } });
  result('C1', { result: 'failed', exitCode: null });
  push({ id: 'S1', kind: 'invocation', callKey: 'S1', tool: 'heredoc', operation: 'edit',
    paths: [{ path: 'notes/plan.md' }], command: [], input: [], shellWriteOf: 'C1', shellWriteStatusEligible: true,
    changes: [{ path: 'notes/plan.md', before: [], after: put('S1-after', `${EARLY}\n${CHILD}\n${LATE}\n`),
      diff: [] }] });
  write('K1', 'notes/helper.md', `${CHILD}\n`, { childId: 'child-1' });
  write('L1', 'notes/late.md', `${LATE}\n`);
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs, events });
}

test('D80 Q review: only what happened after the write, in its session and by the window\'s end, attests it', () => {
  const session = buildEarly();
  const seq = (id) => session.event(id).sequence;
  assert.ok(seq('W0') < seq('I1') && seq('I1') < seq('C1') && seq('C1-r') < seq('S1') && seq('S1') < seq('K1')
    && seq('K1') < seq('L1'), 'premise');
  assert.equal(session.event('K1').childId, 'child-1', 'premise');
  const only = (quote, options) => quotesOnlyUnrunWrite(session, code('S1', quote), options);
  // A Write recorded before the refused write (here before the ask itself) attests nothing: refused.
  assert.equal(only(EARLY), true);
  assert.equal(only(EARLY, { sourceMap: shownAll(session) }), true);
  // A Write of another session, after it: refused.
  assert.equal(only(CHILD), true);
  assert.equal(only(CHILD, { sourceMap: shownAll(session) }), true);
  // A Write of its own session after it grounds it, as before; not one recorded after the window's end (D59), with a
  // source map or without one (the session the window's view reads).
  assert.equal(only(LATE), false);
  assert.equal(only(LATE, { sourceMap: shownAll(session) }), false);
  assert.equal(only(LATE, { until: seq('L1') - 1 }), true);
  assert.equal(only(LATE, { sourceMap: shownAll(session), until: seq('L1') - 1 }), true);
  assert.equal(only(LATE, { until: seq('L1-r') }), false);
});

test('D80 Q review: a deliverable or response only in a refused write and an earlier Write is not checked', () => {
  const session = buildEarly();
  const sourceMap = shownAll(session);
  const ask = (deliverable) => {
    const { candidate, reason } = checkedRequirement(session, requirement(deliverable), { sourceMap });
    return [candidate.status, reason];
  };
  // The earlier Write cited itself is not after the ask; the refused write's body, also only there, is refused.
  assert.deepEqual(ask(code('W0', EARLY)), ['not-checked', 'deliverable_not_after']);
  assert.deepEqual(ask(code('S1', EARLY)), ['not-checked', UNRUN_WRITE_REASON]);
  assert.deepEqual(ask(code('S1', CHILD)), ['not-checked', UNRUN_WRITE_REASON]);
  assert.deepEqual(ask(code('S1', LATE)), ['done', null]);
  const window = { events: session.events };
  const handled = (response) => {
    const { candidate, reason } = failuresCheck(session, window,
      [{ eventId: 'C1-r', handling: 'acted-on', response }], { sourceMap }).rows[0];
    return [candidate.handling, reason];
  };
  assert.deepEqual(handled(code('W0', EARLY)), ['not-checked', 'response_not_after']);
  assert.deepEqual(handled(code('S1', EARLY)), ['not-checked', UNRUN_WRITE_REASON]);
  assert.deepEqual(handled(code('S1', CHILD)), ['not-checked', UNRUN_WRITE_REASON]);
  assert.deepEqual(handled(code('S1', LATE)), ['acted-on', null]);
});

test('D80 Q review: a pivot whose receipt is only in an unrun write is withheld, counted as withheld', async () => {
  const session = build();
  const pivot = (receipt) => ({ abandoned: 'SYNTHETIC_D80 one notes file', adopted: 'SYNTHETIC_D80 two notes files',
    receipts: [receipt] });
  const answer = { decisions: [], claims: [], requirements: [], failures: [],
    pivots: [pivot(code('S1', ONLY)), pivot(code('S1', SHARED)), pivot(code('W1', SHARED))] };
  const report = await runReview({ session, pr: null, reviewScope: 'session-only',
    judge: judgeOf(answer, (item) => item.candidate?.response ?? code('W1', SHARED)) });
  assert.deepEqual(report.pivots.map((p) => p.receipts.map((r) => [r.eventId, r.quote])),
    [[['S1', SHARED]], [['W1', SHARED]]]);
  assert.equal(report.withheld.proposals, 1);
  assert.ok(report.windowResults.every((w) => w.failure === null), 'a withheld pivot leaves its window complete');
});
