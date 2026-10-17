// D102 (F5 part 3, owner pick 2026-10-17): one merge rule for an answer asked again with served evidence
// (run-review.js `servedAnswer`, EVIDENCE_MERGE_RULE, bound in the session run profile). Each invariant of the rule,
// on a synthetic session:
//   1. merge safety: per row, the re-ask's copy wins, unless code's own check lowers it while the first answer's copy
//      passes the same check; then the first answer's copy stands. A lower status the re-ask proposed always wins;
//   2. a requirement is one row by its instruction receipt, so a re-ask that words an ask again is that row;
//   3. every contradiction of either answer is present after the merge;
//   4. a first-answer statement with nothing settled of its own, beside a re-ask statement of its place that code's
//      check settles (the same event, one quote holding the other: ledger.js `nestedReceipts`, the one shared key), is
//      kept and paired with it; every check reads what the window showed, by the window's end;
//   5. the window publishes it: a row the first answer grounded is never published lowered by a check only the
//      re-ask's copy failed, and the window's record counts what the rule did;
//   6. the window drops a paired first-answer statement only once the re-ask statement beside it is published settled
//      after its own challenge, so a challenge that refutes the re-ask's copy never erases the first;
//   7. the merge reads each copy by the very checks its publication applies (the review of D102, M1): for every row kind
//      it compares, a copy publication withholds, cannot read or lowers is lowered for the merge, one it publishes
//      settled holds, and one that proposes nothing code checks is neither; an ask's instruction that does not ground
//      literally is one. The review of D102's fix: pivots and decisions too, whose key leaves out a receipt's role, a
//      decision's value receipt and its instruction review: each place in the role it names, and their grounding at
//      publication, so a re-ask copy refused there never replaces a first copy that holds (a forbidden edit is not
//      compared: its key holds every field it has). Its third fix: one test per row kind, and a decision part by part
//      (its choice, its value, who decided it), read off the row publication shows; a first copy stands in only when it
//      passes a part code lowered in the re-ask copy and every part the re-ask copy passed.
//
// Synthetic sessions and judges only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, verifyReceipt, shownSession } from '../src/session.js';
import * as reviewRun from '../src/run-review.js';
import { nestedReceipts, EVIDENCE_QUOTE_MAX, instructionReviewScope } from '../src/ledger.js';
import { bytesOfTokens, WINDOW_SETTINGS } from '../src/windows.js';

const KEY = 'sess-d102';
const refs = (blobs) => {
  let n = 0;
  return (text) => {
    const key = `b${++n}`;
    blobs[key] = text;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
  };
};
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const empty = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });

const TEXT = {
  ask: 'SYNTHETIC_D102_ASK: fix the parser and run the tests.',
  fail: 'SYNTHETIC_D102_FAIL parser.test.js > reads a long header\n1 failed',
  notes: '# Notes\nSYNTHETIC_D102_NOTE: the parser reads every header. All tests pass.\n',
  later: 'SYNTHETIC_D102_LATER: 2 failing',
  // One message of the agent longer than a quote may be (EVIDENCE_QUOTE_MAX).
  said: 'SYNTHETIC_D102_SAID: I changed the parser so that it reads a header line of any length, and I ran the whole '
    + 'test suite again after the change to check the fix.',
  closing: 'SYNTHETIC_D102_CLOSING: Fixed the parser. All tests pass and the build is done.',
  // An edit's replaced text and an earlier write's body (the bound session).
  old: 'SYNTHETIC_D102_OLD: return null;',
  status: 'SYNTHETIC_D102_STATUS: 2 tests skipped.\n',
};
// D103: a Claude Code recording's result is cut past twice its 12,000-byte skim: 1,000 lines of about 53 bytes, the
// warning in the cut middle.
const LONG = Array.from({ length: 1_000 }, (_, k) => `line ${k + 1}: ${k === 499 ? 'SYNTHETIC_D102_MIDDLE: one warning'
  : `ok ${'.'.repeat(40)}`}`).join('\n');

/** The event builders of one recording (`ref` its blob writer), in `turn`. */
const builders = (ref, turn = 'T1') => ({
  command: (id, text) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
    command: ref(text), input: [], changes: [], turn }),
  result: (id, invocation, output, failed = false) => ({ id, kind: 'observation', invocation,
    callKey: invocation, phase: 'terminal', result: failed ? 'failed' : 'succeeded', exitCode: failed ? 1 : 0,
    terminalStatusProven: true, sourceOfResult: 'native', output: ref(output), turn }),
  write: (id, path, body, extra = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Write', operation: 'write',
    paths: [{ path }], command: [], input: [], turn,
    changes: [{ path, diff: [], before: [], after: ref(body), ...extra }] }),
  said: (id, text, phase = 'working') => ({ id, kind: 'commentary', phase, beforeInvocation: null, text: ref(text),
    turn }),
  asked: (id, text) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text), turn }),
});

/** One turn: the ask, a long lint run (its middle cut), a failing test run, a written note, a later failing run, a
 *  build with no recorded end, a long working message and the closing message. */
function session() {
  const blobs = {};
  const ref = refs(blobs);
  const { command, result, write, said, asked } = builders(ref);
  const events = [
    asked('I1', TEXT.ask),
    command('L1', 'npm run lint'), result('L1-r', 'L1', LONG),
    command('A1', 'npm test'), result('A1-r', 'A1', TEXT.fail, true),
    write('W1', '/srv/x/NOTES.md', TEXT.notes), result('W1-r', 'W1', 'file created'),
    command('A2', 'npm test'), result('A2-r', 'A2', TEXT.later, true),
    command('B1', 'npm run build'),
    said('C0', TEXT.said), said('C1', TEXT.closing, 'final'),
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs, events, children: [] });
}

const RULE = 'SYNTHETIC_D102_RULE: run the tests with npm test.';
/** The same turn, beside the project's instruction file (loaded before it: D83, D84). */
function rulesSession() {
  const s = session();
  const blobs = { ...s.blobs, rules: `# Rules\n${RULE}\n` };
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs, events: s.events, children: [],
    projectInstructions: [{ id: 'P1', kind: 'project-instructions', path: '/srv/x/CLAUDE.md', afterSequence: -1,
      text: [{ sourceKey: 'rules', fromByte: 0, untilByte: Buffer.byteLength(blobs.rules, 'utf8') }] }] });
}

/** The session, its first window and what that window shows, as a session-only review plans them; `merge` is the
 *  evidence re-ask's merge of two answers on them, bounded at `end` (the window's end unless given). */
function planned(s = session()) {
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  const [built] = plan.requests;
  const last = Math.max(...built.window.events.map((event) => event.sequence));
  return { s, plan, built, merge: (first, reask, end = last) => reviewRun.servedAnswer({ first, reask, session: s,
    sourceMap: built.sourceMap, window: built.window, windowEnd: end }) };
}

const INSTRUCTION = receipt('I1', 'instruction', TEXT.ask);
const SHORT_SAID = 'I changed the parser so that it reads a header line of any length';
const LONG_SAID = TEXT.said.slice('SYNTHETIC_D102_SAID: '.length);
const ask = (status, extra = {}) => ({ text: 'Fix the parser.', instruction: INSTRUCTION, status, ...extra });
const doneWith = (quote) => ask('done', { deliverable: receipt('C0', 'commentary', quote) });
const toldHuman = (quote) => ({ eventId: 'A1-r', handling: 'told-human',
  response: receipt('C0', 'commentary', quote) });
const NOT_DONE = { shortfall: receipt('A2-r', 'observation', 'SYNTHETIC_D102_LATER: 2 failing') };
/** The pairs a merge made: for each first-answer statement paired, how many re-ask statements it was paired with. */
const pairsOf = (kept) => kept.nested.map(({ later }) => later.length);

test('D102 premise: the long quotes are literal and over the quote limit; the short ones are within it', () => {
  assert.ok(TEXT.said.length > EVIDENCE_QUOTE_MAX && SHORT_SAID.length <= EVIDENCE_QUOTE_MAX);
  assert.ok(TEXT.said.includes(SHORT_SAID));
  assert.ok(LONG_SAID.length > EVIDENCE_QUOTE_MAX);
  const { built } = planned();
  assert.ok(built.window.events.some((event) => event.id === 'C1'), 'one window holds the whole turn');
});

// ---- 1. merge safety ------------------------------------------------------------------------------------------------

test('D102 (1): a re-ask requirement code lowers for a quote over the limit never replaces the first answer\'s grounded one', () => {
  const { merge } = planned();
  const first = { ...empty(), requirements: [doneWith(SHORT_SAID)] };
  const reask = { ...empty(), requirements: [doneWith(LONG_SAID)] };
  const kept = merge(first, reask);
  assert.deepEqual(kept.narrative.requirements, first.requirements, 'the first answer\'s copy stands in its place');
  assert.deepEqual([kept.firstStood, kept.fromFirst, kept.nested], [1, 0, []]);
});

test('D102 (1): a lower status the re-ask proposed wins: only a failed code check lets the first copy stand', () => {
  const { merge } = planned();
  const first = { ...empty(), requirements: [doneWith(SHORT_SAID)] };
  for (const later of [ask('not-checked'), ask('not-done', NOT_DONE)]) {
    const kept = merge(first, { ...empty(), requirements: [later] });
    assert.deepEqual(kept.narrative.requirements, [later], later.status);
    assert.equal(kept.firstStood, 0);
  }
  // And a first copy code lowers too never stands: both copies lowered, the re-ask's is kept.
  const long = doneWith(TEXT.said);
  const wrong = { ...long, deliverable: receipt('C0', 'commentary', `${TEXT.said}!`) };
  const kept = merge({ ...empty(), requirements: [wrong] }, { ...empty(), requirements: [long] });
  assert.deepEqual(kept.narrative.requirements, [long]);
  // A first copy that proposed the weakest status has passed no check: it never stands in for a lowered re-ask copy.
  const lowered = doneWith(LONG_SAID);
  assert.deepEqual(merge({ ...empty(), requirements: [ask('not-checked')] }, { ...empty(), requirements: [lowered] })
    .narrative.requirements, [lowered]);
});

test('D102 (1): a re-ask copy of a row that code holds keeps the row, even beside a lowered re-ask copy of it', () => {
  const { merge } = planned();
  const first = { ...empty(), requirements: [doneWith(SHORT_SAID)] };
  // Two re-ask copies of the one row (one instruction receipt): one lowered (its quote is over the limit), one held.
  const reask = { ...empty(), requirements: [doneWith(LONG_SAID),
    { ...ask('not-done', NOT_DONE), text: 'Run the tests.' }] };
  const kept = merge(first, reask);
  assert.deepEqual(kept.narrative.requirements, reask.requirements);
  assert.equal(kept.firstStood, 0);
});

test('D102 (1): a first copy that stands in for every lowered re-ask copy of its row is kept once, in their place', () => {
  const { merge } = planned();
  const first = { ...empty(), requirements: [doneWith(SHORT_SAID), { ...doneWith(SHORT_SAID), text: 'Run the tests.' }] };
  const reask = { ...empty(), requirements: [doneWith(LONG_SAID), { ...doneWith(LONG_SAID), text: 'Run the tests now.' }] };
  const kept = merge(first, reask);
  // The first answer's first copy stands for both re-ask copies; its second copy of the row is that row too.
  assert.deepEqual(kept.narrative.requirements, [first.requirements[0]]);
  assert.deepEqual([kept.firstStood, kept.fromFirst], [1, 0]);
});

test('D102 (1): a failure row the re-ask quotes past the limit gives way to the first answer\'s row for that RESULT', () => {
  const { merge, built, s } = planned();
  const first = { ...empty(), failures: [toldHuman('I ran the whole test suite again after the change')] };
  const reask = { ...empty(), failures: [toldHuman(TEXT.said)] };
  const kept = merge(first, reask);
  assert.deepEqual(kept.narrative.failures, first.failures);
  assert.equal(kept.firstStood, 1);
  // A row the re-ask's check refuses outright (not in the contract's shape) gives way too; a handling the re-ask
  // proposed as not checked wins, as any lower proposal does.
  const refused = merge(first, { ...empty(), failures: [{ ...toldHuman('x'), handling: 'SYNTHETIC_D102_HANDLING' }] });
  assert.deepEqual(refused.narrative.failures, first.failures);
  const unchecked = { eventId: 'A1-r', handling: 'not-checked' };
  assert.deepEqual(merge(first, { ...empty(), failures: [unchecked] }).narrative.failures, [unchecked]);
  // A first row that proposed not checked has passed no check: it never stands in for a lowered re-ask row.
  assert.deepEqual(merge({ ...empty(), failures: [unchecked] }, reask).narrative.failures, reask.failures);
  // Without the window no failure row can be checked: the re-ask's stands, as before.
  const plain = reviewRun.servedAnswer({ first, reask, session: s, sourceMap: built.sourceMap });
  assert.deepEqual(plain.narrative.failures, reask.failures);
});

test('D102 (1): a claim\'s copy whose actions code refuses gives way to the first answer\'s copy whose actions held', () => {
  const { merge } = planned();
  const stated = receipt('C1', 'commentary', 'the build is done.');
  const held = { text: 'The build is done.', stated, restsOn: ['B1'] };
  for (const restsOn of [['A1'], ['B1', 'A1']]) {
    // Refused whole, or in part (one id code refuses beside one it accepts): code lowers the re-ask's copy either way.
    const refused = { text: 'The build is done.', stated, restsOn };
    assert.deepEqual(merge({ ...empty(), claims: [held] }, { ...empty(), claims: [refused] }).narrative.claims, [held],
      restsOn.join());
  }
  // The re-ask citing no action is a lower proposal: it wins.
  const bare = { text: 'The build is done.', stated };
  assert.deepEqual(merge({ ...empty(), claims: [held] }, { ...empty(), claims: [bare] }).narrative.claims, [bare]);
});

// ---- 2. one row per instruction receipt -----------------------------------------------------------------------------

test('D102 (2): a re-ask that words an ask again is that row, never a second one beside it', () => {
  const { merge } = planned();
  const first = { ...empty(), requirements: [doneWith(SHORT_SAID)] };
  const worded = { ...ask('not-done', NOT_DONE), text: 'Fix the parser now.' };
  const kept = merge(first, { ...empty(), requirements: [worded] });
  assert.deepEqual(kept.narrative.requirements, [worded], 'the re-ask\'s copy only');
  assert.equal(kept.fromFirst, 0);
  // Two asks the first answer quoted from the same words stay as it gave them when the re-ask names neither.
  const two = [doneWith(SHORT_SAID), { ...doneWith(SHORT_SAID), text: 'Run the tests.' }];
  assert.deepEqual(merge({ ...empty(), requirements: two }, empty()).narrative.requirements, two);
  // Another instruction receipt is another row.
  const other = { ...doneWith(SHORT_SAID), instruction: receipt('I1', 'instruction', 'run the tests.') };
  const apart = merge({ ...empty(), requirements: [other] }, { ...empty(), requirements: [worded] });
  assert.deepEqual(apart.narrative.requirements, [worded, other]);
});

// ---- 3 and 4. contradictions kept; a first copy paired with a settled re-ask copy of its place --------------------

const CONTRADICTED = { text: 'All tests pass.', stated: receipt('C1', 'commentary', 'Fixed the parser. All tests pass'),
  contradictedBy: receipt('A1-r', 'observation', 'SYNTHETIC_D102_FAIL parser.test.js > reads a long header') };
const OPEN = { text: 'Tests pass.', stated: receipt('C1', 'commentary', 'All tests pass') };
// A support that passes code's checks: a result recorded before the claim, in its turn.
const SUPPORTED = { text: 'All tests pass.', stated: CONTRADICTED.stated,
  supportedBy: receipt('W1-r', 'observation', 'file created') };
const RESTING = { text: 'All tests pass.', stated: CONTRADICTED.stated, restsOn: ['B1'] };

test('D102 (4): a first-answer claim inside a settled re-ask claim\'s words is kept and paired with it, for the window', () => {
  const { merge } = planned();
  const kept = merge({ ...empty(), claims: [OPEN] }, { ...empty(), claims: [CONTRADICTED] });
  assert.deepEqual(kept.narrative.claims, [CONTRADICTED, OPEN], 'nothing is dropped before the challenge');
  assert.deepEqual([pairsOf(kept), kept.fromFirst], [[1], 1]);
  // Either way round: the re-ask's quote inside the first answer's.
  const wider = { ...OPEN, stated: receipt('C1', 'commentary', TEXT.closing.slice('SYNTHETIC_D102_CLOSING: '.length)) };
  assert.deepEqual(pairsOf(merge({ ...empty(), claims: [wider] }, { ...empty(), claims: [CONTRADICTED] })), [1]);
  // A support that passes code's checks settles the re-ask's claim too, and so do actions code accepts.
  for (const later of [SUPPORTED, RESTING])
    assert.deepEqual(pairsOf(merge({ ...empty(), claims: [OPEN] }, { ...empty(), claims: [later] })), [1]);
  // Two settled re-ask claims of its place: one pair, with both.
  assert.deepEqual(pairsOf(merge({ ...empty(), claims: [OPEN] }, { ...empty(), claims: [CONTRADICTED, SUPPORTED] })),
    [2]);
});

test('D102 (4): no pair when the re-ask\'s claim is not settled by code, is elsewhere, or the first copy is settled itself', () => {
  const { merge } = planned();
  const none = (first, later) => {
    const kept = merge({ ...empty(), claims: [first] }, { ...empty(), claims: [later] });
    assert.deepEqual(kept.narrative.claims, [later, first]);
    assert.deepEqual(kept.nested, []);
  };
  // The re-ask's contradiction does not ground: nothing settles it.
  none(OPEN, { ...CONTRADICTED, contradictedBy: receipt('A1-r', 'observation', 'SYNTHETIC_D102_NOT_RECORDED') });
  // Its support is not in the record: code refuses it, so it settles nothing.
  none(OPEN, { ...SUPPORTED, supportedBy: receipt('W1-r', 'observation', 'SYNTHETIC_D102_NOT_RECORDED') });
  // Its actions are refused in part.
  none(OPEN, { ...RESTING, restsOn: ['B1', 'A1'] });
  // Another event.
  none({ ...OPEN, stated: receipt('C0', 'commentary', 'I changed the parser') }, CONTRADICTED);
  // A first copy its own check settles is no unsettled copy.
  none({ ...OPEN, restsOn: ['B1'] }, CONTRADICTED);
});

test('D102 (4): the checks read what the window showed, as the window\'s own checks do', () => {
  const { merge, s } = planned();
  // A line in the middle of the long lint run, which the window cut: in the recording, never shown to the window.
  const middle = receipt('L1-r', 'observation', 'SYNTHETIC_D102_MIDDLE: one warning');
  assert.equal(verifyReceipt(s, middle).ok, true, 'premise: the line is literal in the recording');
  const unseen = { ...CONTRADICTED, contradictedBy: middle };
  assert.deepEqual(merge({ ...empty(), claims: [OPEN] }, { ...empty(), claims: [unseen] }).nested, []);
  // A contradiction cited under its command's id is moved to its one result first, as the window moves it.
  const underAction = { ...CONTRADICTED, contradictedBy: { ...CONTRADICTED.contradictedBy, eventId: 'A1' } };
  assert.deepEqual(pairsOf(merge({ ...empty(), claims: [OPEN] }, { ...empty(), claims: [underAction] })), [1]);
});

test('D102 (3): every contradiction of either answer is kept, a first-answer one beside a settled re-ask row too', () => {
  const { merge } = planned();
  const other = { ...OPEN, contradictedBy: receipt('A2-r', 'observation', TEXT.later) };
  const kept = merge({ ...empty(), claims: [other] }, { ...empty(), claims: [CONTRADICTED] });
  assert.deepEqual(kept.narrative.claims, [CONTRADICTED, other]);
  assert.deepEqual(kept.nested, [], 'a contradiction is never paired to be dropped');
  // Even one code's own check refuses: it goes on to that check, and is counted there, never dropped here.
  const refused = { ...OPEN, contradictedBy: receipt('A2-r', 'observation', 'SYNTHETIC_D102_NOT_RECORDED') };
  const both = merge({ ...empty(), claims: [refused] }, { ...empty(), claims: [CONTRADICTED] });
  assert.deepEqual([both.narrative.claims, both.nested], [[CONTRADICTED, refused], []]);
  // Any mix: each contradiction cited by either answer is cited after the merge.
  const answers = [[OPEN], [CONTRADICTED], [other], [OPEN, other], [CONTRADICTED, OPEN]];
  for (const a of answers) for (const b of answers) {
    const merged = merge({ ...empty(), claims: a }, { ...empty(), claims: b }).narrative.claims;
    for (const claim of [...a, ...b].filter((c) => c.contradictedBy))
      assert.ok(merged.some((c) => JSON.stringify(c.contradictedBy) === JSON.stringify(claim.contradictedBy)
        && nestedReceipts(c.stated, claim.stated)), 'its contradiction is kept');
  }
});

const WRITTEN_CONTRADICTED = { text: 'The notes say all tests pass.',
  stated: receipt('W1', 'code', 'SYNTHETIC_D102_NOTE: the parser reads every header. All tests pass.'),
  contradictedBy: receipt('A2-r', 'observation', TEXT.later) };
const WRITTEN_OPEN = { text: 'All tests pass.', stated: receipt('W1', 'code', 'All tests pass.') };

test('D102 (4): a written statement inside a settled re-ask statement of its write is paired with it', () => {
  const { merge } = planned();
  const kept = merge({ ...empty(), writtenClaims: [WRITTEN_OPEN] },
    { ...empty(), writtenClaims: [WRITTEN_CONTRADICTED] });
  assert.deepEqual(kept.narrative.writtenClaims, [WRITTEN_CONTRADICTED, WRITTEN_OPEN]);
  assert.deepEqual(pairsOf(kept), [1]);
  // Proposed as chat claims, they are read as the written statements they are, and paired the same.
  const asChat = merge({ ...empty(), claims: [WRITTEN_OPEN] }, { ...empty(), claims: [WRITTEN_CONTRADICTED] });
  assert.deepEqual([asChat.narrative.claims, pairsOf(asChat)], [[WRITTEN_CONTRADICTED, WRITTEN_OPEN], [1]]);
  // Its contradiction recorded before the write: code's check refuses it, so nothing settles the re-ask's statement.
  const early = { ...WRITTEN_CONTRADICTED,
    contradictedBy: receipt('A1-r', 'observation', 'SYNTHETIC_D102_FAIL parser.test.js') };
  assert.deepEqual(merge({ ...empty(), writtenClaims: [WRITTEN_OPEN] }, { ...empty(), writtenClaims: [early] }).nested,
    []);
});

/** One turn whose window ends at its closing message (`END`), with three results recorded after it: the build's, an
 *  edit's and an earlier write's. By that end, none of the three had ended. */
function lateSession() {
  const blobs = {};
  const ref = refs(blobs);
  const { command, result, write, said, asked } = builders(ref);
  const edit = { ...write('E1', '/srv/x/parser.js', 'SYNTHETIC_D102_NEW: return header;', { replaced: ref(TEXT.old) }),
    tool: 'Edit', operation: 'edit' };
  const events = [
    asked('I1', TEXT.ask),
    command('A1', 'npm test'), result('A1-r', 'A1', TEXT.fail, true),
    command('B1', 'npm run build'), edit, write('W0', '/srv/x/STATUS.md', TEXT.status),
    write('W1', '/srv/x/NOTES.md', TEXT.notes), result('W1-r', 'W1', 'file created'),
    said('C0', TEXT.said), said('C1', TEXT.closing, 'final'),
    result('B1-r', 'B1', 'built'), result('E1-r', 'E1', 'edited'), result('W0-r', 'W0', 'file created'),
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs, events, children: [] });
}
const END = 9;

test('D102 (4): code\'s check of each copy reads only the results recorded by the window\'s end', () => {
  const late = lateSession();
  assert.equal(late.event('C1').sequence, END, 'premise: the window ends at the closing message');
  const { merge } = planned(late);
  // An ask whose deliverable is the build: by the window's end the build had not ended, so code lowers the re-ask's copy.
  const built = ask('done', { deliverable: receipt('B1', 'action', 'npm run build') });
  const asks = [{ ...empty(), requirements: [doneWith(SHORT_SAID)] }, { ...empty(), requirements: [built] }];
  assert.deepEqual(merge(...asks, END).narrative.requirements, [doneWith(SHORT_SAID)]);
  assert.deepEqual(merge(...asks, null).narrative.requirements, [built], 'premise: unbounded, the build ended');
  // A claim resting on the build holds by the window's end; one resting on the finished test run does not.
  const stated = receipt('C1', 'commentary', 'the build is done.');
  const held = { text: 'The build is done.', stated, restsOn: ['B1'] };
  const refused = { text: 'The build is done.', stated, restsOn: ['A1'] };
  const claims = [{ ...empty(), claims: [held] }, { ...empty(), claims: [refused] }];
  assert.deepEqual(merge(...claims, END).narrative.claims, [held]);
  assert.deepEqual(merge(...claims, null).narrative.claims, [refused], 'premise: unbounded, the build ended');
  // A contradiction from the edit's replaced text needs the edit to have run by the window's end: no pair.
  const edited = { ...CONTRADICTED, contradictedBy: receipt('E1', 'code', TEXT.old) };
  const statements = [{ ...empty(), claims: [OPEN] }, { ...empty(), claims: [edited] }];
  assert.deepEqual(merge(...statements, END).nested, []);
  assert.deepEqual(pairsOf(merge(...statements, null)), [1], 'premise: unbounded, the edit ran');
  // A written statement contradicted by what the agent's earlier write added needs that write to have landed by then.
  const own = { ...WRITTEN_CONTRADICTED, contradictedBy: receipt('W0', 'code', TEXT.status.trim()) };
  const written = [{ ...empty(), writtenClaims: [WRITTEN_OPEN] }, { ...empty(), writtenClaims: [own] }];
  assert.deepEqual(merge(...written, END).nested, []);
  assert.deepEqual(pairsOf(merge(...written, null)), [1], 'premise: unbounded, the write landed');
});

test('D102: the shared key is one exported predicate — the same event, one quote holding the other; no role, no word', () => {
  const a = receipt('E1', 'commentary', 'All tests pass and the build is done.');
  assert.equal(nestedReceipts(a, receipt('E1', 'observation', 'All tests pass')), true);
  assert.equal(nestedReceipts(receipt('E1', 'commentary', 'All tests pass'), a), true);
  assert.equal(nestedReceipts(a, { ...a }), true);
  assert.equal(nestedReceipts(a, receipt('E2', 'commentary', 'All tests pass')), false);
  assert.equal(nestedReceipts(a, receipt('E1', 'commentary', 'all tests pass')), false, 'exact characters only');
  for (const bad of [null, 'E1', { eventId: 'E1' }, { eventId: 1, quote: 'x' }, [a]])
    assert.equal(nestedReceipts(a, bad), false);
});

// ---- 5. the window publishes it -------------------------------------------------------------------------------------

/** The review of D102's fix: a pivot (the old parser given up after its test failed) and a decision (how the tests run),
 *  each citing what the window shows in the role it shows it, and a quote of each that a vote can cite. */
const FAILED_RUN = receipt('A1-r', 'observation', 'SYNTHETIC_D102_FAIL parser.test.js');
const RAN_TESTS = receipt('A1', 'action', 'npm test');
const PIVOT = { abandoned: 'the old parser', adopted: 'a new parser', whyAbandoned: 'its test failed',
  receipts: [FAILED_RUN] };
const DECISION = { dimension: 'how the tests run', chosen: 'npm test', actions: ['A1'] };
const VALUED = { ...DECISION, value: 'npm test', valueReceipt: { eventId: 'A1', field: 'command', role: 'action',
  quote: 'npm test' } };
const voteReceipt = ({ candidate }) => candidate.response ?? candidate.deliverable ?? candidate.contradictedBy
  ?? candidate.supportedBy ?? candidate.stated ?? candidate.instruction
  ?? (Array.isArray(candidate.receipts) ? FAILED_RUN : Array.isArray(candidate.actions) ? RAN_TESTS : undefined);
const ALIASED = ['instruction', 'deliverable', 'shortfall', 'response', 'stated', 'contradictedBy', 'supportedBy'];
/** A proposal with every receipt's event (and a failure row's RESULT) named by the window's alias `a`. */
const aliased = (a, row) => Object.fromEntries(Object.entries(row).map(([field, value]) => [field,
  ALIASED.includes(field) && value ? { ...value, eventId: a(value.eventId) } : field === 'eventId' ? a(value) : value]));
const answerOf = (a, members) => ({ ...empty(), ...Object.fromEntries(Object.entries(members)
  .map(([member, rows]) => [member, rows.map((row) => aliased(a, row))])) });

/** A review of `s`: its first window's first answer holds `firstMembers` and one evidence request, its re-ask's
 *  `reaskMembers`, every other window's nothing; every challenge item is voted `verdict(item)`. */
async function reviewed(firstMembers, reaskMembers, verdict = () => 'not-refuted', s = session()) {
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  const a = (id) => plan.requests[0].aliases.of(id);
  const judge = async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: verdict(item), explanation: 'Synthetic.', receipts: [voteReceipt(item)] })) };
    if (!/^narrative:w1(:|$)/.test(request.label)) return empty();
    return request.label.endsWith(':evidence') ? answerOf(a, reaskMembers)
      : { ...answerOf(a, firstMembers), evidenceRequests: [{ eventId: a('L1-r'), fromLine: 499, throughLine: 501 }] };
  };
  return reviewRun.runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge });
}

test('D102 (5): a re-ask that quotes past the limit publishes the first answer\'s grounded ask and failure row', async () => {
  const report = await reviewed(
    { requirements: [doneWith(SHORT_SAID)], claims: [OPEN],
      failures: [toldHuman('I ran the whole test suite again after the change')] },
    { requirements: [doneWith(TEXT.said)], claims: [CONTRADICTED], failures: [toldHuman(TEXT.said)] });
  const [window] = report.windowResults;
  assert.equal(window.evidence.kept, 'merged', 'premise: the re-ask answered and was merged');
  assert.deepEqual(report.requirements.map((row) => [row.status, row.reason ?? null]), [['done', null]]);
  const failure = report.failures.find((row) => row.eventId === 'A1-r');
  assert.deepEqual([failure.handling, failure.reason ?? null], ['told-human', null]);
  assert.deepEqual(report.findings.map((f) => f.kind), ['claim_contradicted']);
  assert.equal(report.promises.some((p) => p.stated?.quote === OPEN.stated.quote), false,
    'no unsettled copy beside it');
  assert.deepEqual([window.evidence.firstStood, window.evidence.nestedDropped], [2, 1]);
  assert.deepEqual([report.counts.evidenceRequests.firstStood, report.counts.evidenceRequests.nestedDropped], [2, 1]);
});

/** Two turns, two windows: the first turn's build ends only in the second turn. */
function twoWindows() {
  const blobs = {};
  const ref = refs(blobs);
  const { command, result, said, asked } = builders(ref);
  const next = builders(ref, 'T2');
  const pad = bytesOfTokens(WINDOW_SETTINGS.workTokens) / 2 - 1_000;
  const events = [
    asked('I1', TEXT.ask), command('L1', 'npm run lint'), result('L1-r', 'L1', LONG), command('B1', 'npm run build'),
    said('C0', TEXT.said), said('C1', TEXT.closing, 'final'),
    next.asked('I2', 'SYNTHETIC_D102_NEXT: go on.'), next.result('B1-r', 'B1', 'built'),
    next.said('P2', `SYNTHETIC_D102_PAD:${' x'.repeat(pad)}`), next.said('C2', 'SYNTHETIC_D102_DONE.', 'final'),
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs, events, children: [] });
}

test('D102 (5): a window\'s re-ask is merged by the results recorded by its end, never by a later window\'s', async () => {
  const s = twoWindows();
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  assert.equal(plan.windows.length, 2, 'premise: two windows');
  assert.equal(plan.windows[0].events.some((event) => event.id === 'B1-r'), false, 'premise: the build ends later');
  const built = ask('done', { deliverable: receipt('B1', 'action', 'npm run build') });
  const report = await reviewed({ requirements: [doneWith(SHORT_SAID)] }, { requirements: [built] }, undefined, s);
  assert.equal(report.windowResults[0].evidence.kept, 'merged', 'premise: the re-ask answered and was merged');
  const row = report.requirements.find((r) => r.instruction.eventId === 'I1');
  assert.deepEqual([row.status, row.reason ?? null, row.deliverable?.eventId], ['done', null, 'C0']);
  assert.equal(report.windowResults[0].evidence.firstStood, 1);
});

// ---- 6. the drop waits for the challenge ----------------------------------------------------------------------------

const promisesAt = (report, eventId) => report.promises.filter((p) => p.stated?.eventId === eventId)
  .map((p) => [p.status, p.stated.quote]);
const refuteContradictions = (item) => (item.candidate?.contradictedBy ? 'refuted' : 'not-refuted');

test('D102 (6): a first-answer claim is dropped only when the re-ask\'s claim beside it survives its own challenge', async () => {
  // The challengers refute the re-ask's contradiction: nothing settles C1, so the first answer's claim is published.
  const refuted = await reviewed({ claims: [OPEN] }, { claims: [CONTRADICTED] }, refuteContradictions);
  assert.equal(refuted.windowResults[0].evidence.kept, 'merged', 'premise: the re-ask answered and was merged');
  assert.deepEqual(refuted.findings.map((f) => f.kind), []);
  assert.deepEqual(promisesAt(refuted, 'C1'), [['open', OPEN.stated.quote]], 'a second look never erases a first');
  assert.equal(refuted.windowResults[0].evidence.nestedDropped, 0);
  assert.equal(refuted.counts.evidenceRequests.nestedDropped, 0);
  // Upheld, the contradiction is the settled row of C1 and the first answer's open claim is not kept beside it.
  const upheld = await reviewed({ claims: [OPEN] }, { claims: [CONTRADICTED] });
  assert.deepEqual(upheld.findings.map((f) => f.kind), ['claim_contradicted']);
  assert.deepEqual(promisesAt(upheld, 'C1'), []);
  assert.equal(upheld.windowResults[0].evidence.nestedDropped, 1);
  // A re-ask claim with a support beside its contradiction is settled by the contradiction, which wins over a support.
  const both = await reviewed({ claims: [OPEN] }, { claims: [{ ...CONTRADICTED, supportedBy: SUPPORTED.supportedBy }] });
  assert.deepEqual([both.findings.map((f) => f.kind), promisesAt(both, 'C1')], [['claim_contradicted'], []]);
});

test('D102 (6): a paired first-answer claim whose own words do not ground is withheld for them, never dropped', async () => {
  // It holds the re-ask's quote and more words, which the message never said.
  const unfounded = { ...OPEN, stated: receipt('C1', 'commentary', `${CONTRADICTED.stated.quote}, SYNTHETIC_D102_UNSAID`) };
  const { merge } = planned();
  assert.deepEqual(pairsOf(merge({ ...empty(), claims: [unfounded] }, { ...empty(), claims: [CONTRADICTED] })), [1],
    'premise: paired');
  const report = await reviewed({ claims: [unfounded] }, { claims: [CONTRADICTED] });
  assert.deepEqual(report.findings.map((f) => f.kind), ['claim_contradicted']);
  assert.deepEqual([report.withheld.proposals, report.counts.evidenceRequests.nestedDropped], [1, 0]);
});

test('D102 (6): a re-ask claim settled by its support or its actions drops the first copy only once that holds', async () => {
  // Its support's own item refuted: the re-ask's claim is published open, and so is the first answer's.
  const refuteSupport = (item) => (item.type === 'support' ? 'refuted' : 'not-refuted');
  const unsupported = await reviewed({ claims: [OPEN] }, { claims: [SUPPORTED] }, refuteSupport);
  assert.deepEqual(promisesAt(unsupported, 'C1'), [['open', SUPPORTED.stated.quote], ['open', OPEN.stated.quote]]);
  assert.equal(unsupported.counts.evidenceRequests.nestedDropped, 0);
  const verified = await reviewed({ claims: [OPEN] }, { claims: [SUPPORTED] });
  assert.deepEqual(promisesAt(verified, 'C1'), [['verified', SUPPORTED.stated.quote]]);
  assert.equal(verified.counts.evidenceRequests.nestedDropped, 1);
  // Resting on the build, which never ended: dropped beside it when its claim survives, kept when the claim is refuted.
  const survived = await reviewed({ claims: [OPEN] }, { claims: [RESTING] });
  assert.deepEqual(promisesAt(survived, 'C1'), [['incomplete', RESTING.stated.quote]]);
  const refuteResting = (item) => (item.candidate?.stated?.quote === RESTING.stated.quote ? 'refuted' : 'not-refuted');
  const gone = await reviewed({ claims: [OPEN] }, { claims: [RESTING] }, refuteResting);
  assert.deepEqual(promisesAt(gone, 'C1'), [['open', OPEN.stated.quote]]);
  assert.equal(gone.counts.evidenceRequests.nestedDropped, 0);
});

test('D102 (6): a first-answer written statement is dropped only beside a re-ask statement published contradicted', async () => {
  const labels = (report) => report.writtenClaims.map((w) => [w.label, w.stated.quote]);
  const refuted = await reviewed({ writtenClaims: [WRITTEN_OPEN] }, { writtenClaims: [WRITTEN_CONTRADICTED] },
    refuteContradictions);
  assert.deepEqual(labels(refuted), [['unverified', WRITTEN_CONTRADICTED.stated.quote],
    ['unverified', WRITTEN_OPEN.stated.quote]]);
  assert.equal(refuted.counts.evidenceRequests.nestedDropped, 0);
  const upheld = await reviewed({ writtenClaims: [WRITTEN_OPEN] }, { writtenClaims: [WRITTEN_CONTRADICTED] });
  assert.deepEqual(labels(upheld), [['contradicted', WRITTEN_CONTRADICTED.stated.quote]]);
  assert.equal(upheld.counts.evidenceRequests.nestedDropped, 1);
});

test('D102: the session run profile binds the rule by name; the merge is the same bytes for the same answers', () => {
  assert.equal(reviewRun.EVIDENCE_MERGE_RULE, 'later-copy-unless-code-lowers');
  for (const profile of [undefined, 'm33-fast', 'm33-lean'])
    assert.equal(reviewRun.runProfile('session-only', profile).evidenceMerge, reviewRun.EVIDENCE_MERGE_RULE);
  assert.equal(Object.hasOwn(reviewRun.runProfile('combined'), 'evidenceMerge'), false);
  const { merge } = planned();
  const first = { ...empty(), requirements: [doneWith(SHORT_SAID)], claims: [OPEN] };
  const reask = { ...empty(), requirements: [doneWith(TEXT.said)], claims: [CONTRADICTED] };
  assert.equal(JSON.stringify(merge(first, reask)),
    JSON.stringify(merge(structuredClone(first), structuredClone(reask))));
});

// ---- 7. the merge reads a copy by the checks its publication applies (the review of D102, M1) -------------------------

const NOT_LITERAL = receipt('I1', 'instruction', 'fix the parser and run all the tests.');
const VERDICT = { holds: 'holds', lowered: 'lowered', null: 'none' };

/** A review of `s` whose first window's one answer holds `members` and asks for no evidence; every item is upheld. */
async function publishedAlone(members, s = session()) {
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  const a = (id) => plan.requests[0].aliases.of(id);
  const judge = async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [voteReceipt(item)] })) };
    return /^narrative:w1(:|$)/.test(request.label) ? answerOf(a, members) : empty();
  };
  return reviewRun.runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge });
}

/** A decision's parts by name, as the test writes them: the parts that hold, then after ` / ` the parts code lowered. */
const partsOf = (passed, lowered) => [passed.join(' '), ...(lowered.length ? [lowered.join(' ')] : [])].join(' / ');

/** What publication made of one copy, the only proposal of its window's answer, every challenge item upheld: `holds`
 *  (published with the status or basis it proposed), `withheld` (not published: a quote or a place code refused),
 *  `unread` (not published: no check could read it), `lowered` (published without it, by a code check), or `none` (it
 *  proposed no status or basis code checks). A decision part by part (the review of D102's third fix): `choice` (the
 *  row is published), then each cell of the published row that is grounded (`value`, and `column`: who decided it),
 *  then after ` / ` each cell the copy proposed something in that the row shows unchecked; or not published at all. */
function publishedAs(report, channel, copy) {
  const withheld = () => (report.withheld.proposals > 0 ? 'withheld' : report.claimsRejected > 0 ? 'unread' : 'lost');
  // A pivot is published as it came, or not at all: unread when no check can read it (no receipt).
  if (channel === 'pivots') return report.pivots.some((p) => p.abandoned === copy.abandoned) ? 'holds'
    : report.withheld.proposals > 0 ? 'withheld' : report.pivotsRejected > 0 ? 'unread' : 'lost';
  if (channel === 'decisions') {
    const row = report.decisions.find((d) => d.dimension === copy.dimension);
    // Not published: unread when no check can read it (refused by the ledger's shape check).
    if (!row) return report.withheld.proposals > 0 ? 'withheld' : report.rejectedDecisions.length > 0 ? 'unread' : 'lost';
    const grounded = { value: row.valueState === 'grounded', column: row.columnState === 'grounded' };
    const proposed = { value: copy.value != null, column: copy.constrainedBy != null || copy.instructionReview != null };
    return partsOf(['choice', ...['value', 'column'].filter((cell) => grounded[cell])],
      ['value', 'column'].filter((cell) => proposed[cell] && !grounded[cell]));
  }
  if (channel === 'requirements') {
    const rows = report.requirements.filter((row) => row.codeMade !== true
      && row.instruction.eventId === copy.instruction.eventId);
    if (!rows.length) return withheld();
    if (rows[0].reason) return 'lowered';
    return rows[0].status === 'not-checked' ? 'none' : 'holds';
  }
  if (channel === 'failures') {
    const row = report.failures.find((r) => r.eventId === copy.eventId);
    if (row.reason && row.codeMade !== true) return 'lowered';
    return copy.handling === 'not-checked' ? 'none' : row.handling === copy.handling ? 'holds' : 'lowered';
  }
  if (channel === 'writtenClaims') {
    const record = report.writtenClaims.find((w) => w.stated.quote === copy.stated.quote);
    if (!record) return withheld();
    return record.label === 'contradicted' ? 'holds' : copy.contradictedBy ? 'lowered' : 'none';
  }
  if (report.findings.some((f) => f.kind === 'claim_contradicted')) return copy.contradictedBy ? 'holds' : 'lost';
  const promise = report.promises.find((p) => p.stated?.quote === copy.stated.quote);
  if (!promise) return withheld();
  if (promise.status !== 'open') return 'holds';
  return copy.contradictedBy || copy.supportedBy || copy.restsOn ? 'lowered' : 'none';
}

/** What the evidence re-ask's merge makes of the same copy, as it compares two copies of a row (`mergeChecks`
 *  `checked`; a failure row by `failureHeld`), on what the window showed, by its end, in publication's words: the one
 *  check of a row passed is `holds`, lowered `lowered`, neither `none`; a decision part by part, `refused` when code
 *  refused its choice (nothing of it is published). */
function mergedAs(s, channel, copy) {
  const { built } = planned(s);
  const last = Math.max(...built.window.events.map((event) => event.sequence));
  const { held, checked, failureHeld } = reviewRun.mergeChecks({ session: s, sourceMap: built.sourceMap,
    window: built.window, windowEnd: last });
  if (channel === 'failures') return VERDICT[failureHeld(copy)];
  const { passed, lowered } = checked(channel, copy);
  if (channel === 'decisions') {
    // `held` reads a decision as the summary of its parts: lowered when code lowered any.
    assert.equal(held(channel, copy), lowered.length ? 'lowered' : 'holds');
    return lowered.includes('choice') ? (passed.length ? 'malformed' : 'refused') : partsOf(passed, lowered);
  }
  const read = JSON.stringify([passed, lowered]);
  return read === '[["row"],[]]' ? 'holds' : read === '[[],["row"]]' ? 'lowered' : read === '[[],[]]' ? 'none' : read;
}

/** Each copy of one row kind (`grid`: its session, the copy, and what publication makes of it), alone in a whole
 *  review with every challenge item upheld and through the merge's check: publication makes of it what the grid says
 *  (the premise), and the merge reads it the same, part by part — a copy publication withholds or cannot read is
 *  lowered (a decision: refused). */
async function agreeOn(channel, grid) {
  const read = [];
  for (const [index, [make, copy]] of grid.entries()) {
    const s = make();
    read.push([`${index} ${make.name}`, publishedAs(await publishedAlone({ [channel]: [copy] }, s), channel, copy),
      mergedAs(s, channel, copy)]);
  }
  assert.deepEqual(read.map(([label, published]) => [label, published]),
    grid.map(([make, , expected], index) => [`${index} ${make.name}`, expected]), 'premise: what publication makes of each copy');
  const unpublished = channel === 'decisions' ? 'refused' : 'lowered';
  assert.deepEqual(read.map(([label, , merged]) => [label, merged]), read.map(([label, published]) =>
    [label, ['withheld', 'unread'].includes(published) ? unpublished : published]));
}

test('D102 (7): the merge reads each ask as its publication does: its place, its instruction quote, its status', async () => {
  const notShown = { text: 'Go on.', instruction: receipt('I2', 'instruction', 'SYNTHETIC_D102_NEXT: go on.'),
    status: 'not-checked' };
  await agreeOn('requirements', [
    [session, doneWith(SHORT_SAID), 'holds'],
    [session, doneWith(LONG_SAID), 'lowered'],
    [session, { ...doneWith(SHORT_SAID), instruction: NOT_LITERAL }, 'withheld'],
    [session, ask('not-checked'), 'none'],
    [session, { ...ask('not-checked'), instruction: NOT_LITERAL }, 'withheld'],
    [session, ask('not-done', NOT_DONE), 'holds'],
    [session, ask('not-done', { shortfall: receipt('A2-r', 'observation', 'SYNTHETIC_D102_NOT_RECORDED') }), 'lowered'],
    [session, ask('partly-done', { deliverable: receipt('C0', 'commentary', SHORT_SAID), ...NOT_DONE }), 'holds'],
    [session, ask('partly-done', { deliverable: receipt('C0', 'commentary', LONG_SAID), ...NOT_DONE }), 'lowered'],
    // A deliverable the recording holds in the middle the window cut: every check reads what the window showed.
    [session, ask('done', { deliverable: receipt('L1-r', 'observation', 'SYNTHETIC_D102_MIDDLE: one warning') }),
      'lowered'],
    [twoWindows, doneWith(SHORT_SAID), 'holds'],
    [twoWindows, notShown, 'withheld'],
  ]);
});

test('D102 (7): the merge reads each chat claim as its publication does: its words, its places, its basis', async () => {
  await agreeOn('claims', [
    [session, OPEN, 'none'],
    [session, { ...OPEN, assumption: true }, 'none'],
    [session, CONTRADICTED, 'holds'],
    [session, { ...CONTRADICTED, contradictedBy: receipt('A1-r', 'observation', 'SYNTHETIC_D102_NOT_RECORDED') },
      'lowered'],
    [session, SUPPORTED, 'holds'],
    [session, { ...SUPPORTED, supportedBy: receipt('W1-r', 'observation', 'SYNTHETIC_D102_NOT_RECORDED') }, 'lowered'],
    // A support code refuses beside actions it accepts: the support is the claim's basis, so it is lowered.
    [session, { ...SUPPORTED, supportedBy: receipt('W1-r', 'observation', 'SYNTHETIC_D102_NOT_RECORDED'),
      restsOn: ['B1'] }, 'lowered'],
    [session, RESTING, 'holds'],
    [session, { ...RESTING, restsOn: ['A1'] }, 'lowered'],
    [session, { ...RESTING, restsOn: ['B1', 'A1'] }, 'lowered'],
    [session, { ...OPEN, stated: receipt('C1', 'commentary', 'All tests pass, SYNTHETIC_D102_UNSAID') }, 'withheld'],
    [twoWindows, { ...OPEN, contradictedBy: receipt('B1-r', 'observation', 'built') }, 'withheld'],
    [session, { ...OPEN, text: ' ' }, 'unread'],
  ]);
});

test('D102 (7): the merge reads each written statement as its publication does: its record, its contradiction', async () => {
  await agreeOn('writtenClaims', [
    [session, WRITTEN_OPEN, 'none'],
    [session, { ...WRITTEN_OPEN, text: 'All tests pass. \uD800' }, 'withheld'],
    [session, WRITTEN_CONTRADICTED, 'holds'],
    [session, { ...WRITTEN_CONTRADICTED,
      contradictedBy: receipt('A1-r', 'observation', 'SYNTHETIC_D102_FAIL parser.test.js') }, 'lowered'],
    [session, { ...WRITTEN_CONTRADICTED, contradictedBy: receipt('A2-r', 'observation', 'SYNTHETIC_D102_NOT_RECORDED') },
      'lowered'],
  ]);
});

test('D102 (7): the merge reads each failure row as its publication does: by the RESULTs the window listed', async () => {
  await agreeOn('failures', [
    [session, toldHuman('I ran the whole test suite again after the change'), 'holds'],
    [session, toldHuman(TEXT.said), 'lowered'],
    [session, toldHuman('SYNTHETIC_D102_UNSAID'), 'lowered'],
    [session, { eventId: 'A1-r', handling: 'acted-on', response: receipt('A2', 'action', 'npm test') }, 'holds'],
    [session, { eventId: 'A1-r', handling: 'acted-on', response: receipt('A2', 'action', 'npm run test') }, 'lowered'],
    [session, { eventId: 'A1-r', handling: 'passed-over', response: receipt('C1', 'commentary', 'Fixed the parser.') },
      'holds'],
    [session, { eventId: 'A1-r', handling: 'passed-over', response: receipt('C0', 'commentary', SHORT_SAID) }, 'lowered'],
    [session, { eventId: 'A1-r', handling: 'not-checked' }, 'none'],
  ]);
});

test('D102 (7): the merge reads each pivot as its publication does: each place in the role it names, each quote', async () => {
  await agreeOn('pivots', [
    [session, PIVOT, 'holds'],
    [session, { ...PIVOT, receipts: [{ ...FAILED_RUN, role: 'commentary' }] }, 'withheld'],
    [session, { ...PIVOT, receipts: [receipt('A1-r', 'observation', 'SYNTHETIC_D102_NOT_RECORDED')] }, 'withheld'],
    [session, { ...PIVOT, receipts: [receipt('L1-r', 'observation', 'SYNTHETIC_D102_MIDDLE: one warning')] },
      'withheld'],
    [session, { ...PIVOT, receipts: [] }, 'unread'],
    [twoWindows, { ...PIVOT, receipts: [receipt('B1-r', 'observation', 'built')] }, 'withheld'],
  ]);
});

/** The review of D102's third fix: who decided how the tests run — the person's message covering it (`COVERED`, chose;
 *  `SETTLED`, the words that fix the value) — and the review that no message did (`noneAsked`: the scope the window was
 *  shown, by its end, `instructionReviewScope`). */
const COVERING = receipt('I1', 'instruction', TEXT.ask);
const COVERED = { ...DECISION, constrainedBy: { instruction: COVERING, settles: false } };
const SETTLED = { ...DECISION, constrainedBy: { instruction: COVERING, settles: true, settledValueQuote: 'run the tests' } };
const UNSETTLED = { ...SETTLED, constrainedBy: { ...SETTLED.constrainedBy, settledValueQuote: 'run all the tests' } };
const NOT_LITERAL_VALUE = { ...VALUED, valueReceipt: { ...VALUED.valueReceipt, quote: 'npm test --all' } };
function noneAsked(s = session()) {
  const { built } = planned(s);
  const last = Math.max(...built.window.events.map((event) => event.sequence));
  const { scopeDigest } = instructionReviewScope(shownSession(s, built.sourceMap), { upTo: last });
  return { dimension: DECISION.dimension, scopeDigest, noRelevantInstruction: true,
    checks: [{ instruction: COVERING, relevant: false, explanation: 'Synthetic.' }] };
}

test('D102 (7): the merge reads each decision as its publication does, part by part: its choice, its value, who decided it', async () => {
  const review = noneAsked();
  const ruled = noneAsked(rulesSession());
  const filesReview = { ...ruled, checks: [...ruled.checks, { instruction: receipt('P1', 'project-instructions', RULE),
    relevant: false, explanation: 'Synthetic.' }] };
  await agreeOn('decisions', [
    [session, DECISION, 'choice'],
    [session, VALUED, 'choice value'],
    // Refused, nothing of it is published: a place in a role the window did not show (its value receipt, its covering
    // receipt, a check of its review), an action that is a result, a stated receipt not recorded, a blank dimension.
    [session, { ...VALUED, valueReceipt: { ...VALUED.valueReceipt, role: 'code' } }, 'withheld'],
    [session, { ...DECISION, constrainedBy: { instruction: receipt('I1', 'project-instructions', TEXT.ask),
      settles: false } }, 'withheld'],
    [session, { ...DECISION, instructionReview: { ...review, checks: [{ ...review.checks[0],
      instruction: receipt('I1', 'project-instructions', TEXT.ask) }] } }, 'withheld'],
    [session, { ...DECISION, actions: ['A1-r'] }, 'withheld'],
    [session, { ...DECISION, stated: receipt('C0', 'commentary', 'SYNTHETIC_D102_UNSAID') }, 'withheld'],
    [session, { ...DECISION, dimension: ' ' }, 'unread'],
    // Its value: published unchecked when its quote does not ground literally, is missing, or does not hold the value.
    [session, NOT_LITERAL_VALUE, 'choice / value'],
    [session, { ...VALUED, valueReceipt: null }, 'choice / value'],
    [session, { ...VALUED, value: 'yarn test' }, 'choice / value'],
    // Who decided it: the person's message covering it, the words that settle it, and the review that none did.
    [session, COVERED, 'choice column'],
    [session, SETTLED, 'choice column'],
    [session, { ...SETTLED, ...NOT_LITERAL_VALUE, constrainedBy: SETTLED.constrainedBy }, 'choice column / value'],
    [session, { ...VALUED, constrainedBy: SETTLED.constrainedBy }, 'choice value column'],
    [session, UNSETTLED, 'choice / column'],
    [session, { ...COVERED, constrainedBy: { instruction: NOT_LITERAL, settles: false } }, 'choice / column'],
    [session, { ...COVERED, constrainedBy: { ...COVERED.constrainedBy, settledValueQuote: 'run the tests' } },
      'choice / column'],
    [session, { ...DECISION, instructionReview: review }, 'choice column'],
    [session, { ...DECISION, instructionReview: { ...review, scopeDigest: `sha256:${'0'.repeat(64)}` } },
      'choice / column'],
    // A covering receipt naming the project's instruction file as a human message: code gives it the file's role first.
    [rulesSession, { ...DECISION, constrainedBy: { instruction: receipt('P1', 'instruction', RULE), settles: false } },
      'choice column'],
    // Grounded as a session-only window grounds a decision: the review that no message did checks the project's
    // instruction file the window showed too, and a choice not to act is anchored on the agent's own words.
    [rulesSession, { ...DECISION, instructionReview: filesReview }, 'choice column'],
    [rulesSession, { ...DECISION, instructionReview: noneAsked(rulesSession()) }, 'choice / column'],
    [session, { dimension: 'the lint warning', chosen: 'left as it is', actions: [], notActing: true,
      stated: receipt('C0', 'commentary', SHORT_SAID) }, 'choice'],
  ]);
});

test('D102 (7): a re-ask pivot citing its place in a role the window did not show never replaces the first answer\'s', async () => {
  // One key (each receipt's event and quote): the re-ask's copy names the failed run's result as the agent's words.
  const { merge } = planned();
  const reask = { ...PIVOT, receipts: [{ ...FAILED_RUN, role: 'commentary' }] };
  const kept = merge({ ...empty(), pivots: [PIVOT] }, { ...empty(), pivots: [reask] });
  assert.deepEqual(kept.narrative.pivots, [PIVOT], 'the first answer\'s copy stands in its place');
  assert.deepEqual([kept.firstStood, kept.fromFirst], [1, 0]);
  const report = await reviewed({ pivots: [PIVOT] }, { pivots: [reask] });
  assert.deepEqual(report.pivots.map((pivot) => pivot.receipts.map((r) => r.role)), [['observation']]);
  assert.deepEqual([report.withheld.proposals, report.counts.evidenceRequests.firstStood], [0, 1]);
  // Both copies held, the re-ask's wins, as before; both refused, the re-ask's is kept.
  const other = { ...PIVOT, abandoned: 'the first parser' };
  assert.deepEqual(merge({ ...empty(), pivots: [PIVOT] }, { ...empty(), pivots: [other] }).narrative.pivots, [other]);
  const refused = { ...reask, abandoned: 'the first parser' };
  assert.deepEqual(merge({ ...empty(), pivots: [reask] }, { ...empty(), pivots: [refused] }).narrative.pivots, [refused]);
});

test('D102 (7): a re-ask decision whose value receipt names a role the window did not show never replaces the first\'s', async () => {
  // One key (its actions, its receipts' events and quotes, whether it acts): the value receipt is not in it.
  const { merge } = planned();
  const reask = { ...VALUED, valueReceipt: { ...VALUED.valueReceipt, role: 'code' } };
  const kept = merge({ ...empty(), decisions: [VALUED] }, { ...empty(), decisions: [reask] });
  assert.deepEqual(kept.narrative.decisions, [VALUED]);
  assert.equal(kept.firstStood, 1);
  const report = await reviewed({ decisions: [VALUED] }, { decisions: [reask] });
  assert.deepEqual(report.decisions.map((d) => [d.dimension, d.valueReceipt?.role ?? null]),
    [[DECISION.dimension, 'action']]);
  assert.deepEqual([report.withheld.proposals, report.counts.evidenceRequests.firstStood], [0, 1]);
  // A re-ask copy the ledger refuses (no dimension to name) gives way too; a held re-ask copy wins, as before.
  assert.deepEqual(merge({ ...empty(), decisions: [VALUED] }, { ...empty(), decisions: [{ ...VALUED, dimension: ' ' }] })
    .narrative.decisions, [VALUED]);
  const restated = { ...VALUED, dimension: 'which runner the tests use' };
  assert.deepEqual(merge({ ...empty(), decisions: [VALUED] }, { ...empty(), decisions: [restated] }).narrative.decisions,
    [restated]);
});

test('D102 (7): a re-ask decision whose value or settled-value quote does not ground literally never replaces the first\'s', async () => {
  // One key (its actions, its receipts' events and quotes, whether it acts): the value receipt and the settled value
  // are not in it. Alone, each re-ask copy is published with that cell unchecked (`receipt_rejected`).
  const { merge } = planned();
  for (const [first, reask, cell] of [[VALUED, NOT_LITERAL_VALUE, 'value'], [SETTLED, UNSETTLED, 'column']]) {
    const kept = merge({ ...empty(), decisions: [first] }, { ...empty(), decisions: [reask] });
    assert.deepEqual(kept.narrative.decisions, [first], cell);
    assert.deepEqual([kept.firstStood, kept.fromFirst], [1, 0], cell);
    const report = await reviewed({ decisions: [first] }, { decisions: [reask] });
    assert.equal(report.windowResults[0].evidence.kept, 'merged', 'premise: the re-ask answered and was merged');
    assert.deepEqual(report.decisions.map((d) => [d.valueState, d.value, d.columnState, d.column,
      d.reasons.includes('receipt_rejected')]), [cell === 'value' ? ['grounded', 'npm test', 'unchecked', null, false]
      : ['unchecked', null, 'grounded', 'asked-settled', false]], cell);
    assert.deepEqual([report.withheld.proposals, report.counts.evidenceRequests.firstStood], [0, 1], cell);
    const alone = await publishedAlone({ decisions: [reask] });
    assert.ok(alone.decisions[0].reasons.includes('receipt_rejected'), `premise: alone, the re-ask copy's ${cell} is refused`);
  }
});

test('D102 (7): a first decision stands in only by a part code lowered that it passed, keeping every part the re-ask\'s passed', () => {
  const { merge } = planned();
  const stands = (first, reask) => merge({ ...empty(), decisions: [first] }, { ...empty(), decisions: [reask] })
    .firstStood === 1;
  const review = noneAsked();
  // The bare choice proposed no value: it passed no check of one, so it never stands for a value code lowered.
  assert.equal(stands(DECISION, NOT_LITERAL_VALUE), false);
  assert.equal(stands(VALUED, NOT_LITERAL_VALUE), true);
  // The re-ask copy grounds who decided it (the review that no message did): a first copy that does not loses it.
  const reviewedBadValue = { ...NOT_LITERAL_VALUE, instructionReview: review };
  assert.equal(stands(VALUED, reviewedBadValue), false);
  assert.equal(stands({ ...VALUED, instructionReview: review }, reviewedBadValue), true);
  // Each copy grounds a cell the other lowered: neither holds all the other's, so the re-ask's stands, both ways.
  const settledBadValue = { ...NOT_LITERAL_VALUE, constrainedBy: SETTLED.constrainedBy };
  const unsettledValued = { ...VALUED, constrainedBy: UNSETTLED.constrainedBy };
  assert.equal(stands(unsettledValued, settledBadValue), false);
  assert.equal(stands(settledBadValue, unsettledValued), false);
  // A re-ask copy code refused whole (a place in a role the window did not show) gives way to a first copy that is
  // published at all, a cell of it lowered too.
  const refused = { ...NOT_LITERAL_VALUE, valueReceipt: { ...VALUED.valueReceipt, role: 'code' } };
  assert.equal(stands(NOT_LITERAL_VALUE, refused), true);
  // A first copy refused whole never stands; nor does one lowered on the very cell the re-ask copy was lowered on.
  assert.equal(stands(refused, NOT_LITERAL_VALUE), false);
  assert.equal(stands(NOT_LITERAL_VALUE, { ...VALUED, valueReceipt: { ...VALUED.valueReceipt, quote: 'npm test -x' } }),
    false);
  // A re-ask copy that proposes less is a lower proposal, not a lowered one: it wins.
  assert.equal(stands(VALUED, DECISION), false);
  assert.equal(stands(SETTLED, { ...DECISION, constrainedBy: { instruction: COVERING, settles: false } }), false);
});

test('D102 (7): a bare first-answer decision never replaces a re-ask copy whose value code lowered beside who decided it', async () => {
  const reask = { ...NOT_LITERAL_VALUE, instructionReview: noneAsked() };
  const report = await reviewed({ decisions: [DECISION] }, { decisions: [reask] });
  assert.equal(report.windowResults[0].evidence.kept, 'merged', 'premise: the re-ask answered and was merged');
  assert.deepEqual(report.decisions.map((d) => [d.columnState, d.column, d.valueState]),
    [['grounded', 'unasked', 'unchecked']], 'the re-ask\'s copy, with who decided it');
  assert.deepEqual([report.withheld.proposals, report.counts.evidenceRequests.firstStood], [0, 0]);
});

test('D102 (7): a row a first-answer decision stood in for keeps that copy: no second first-answer copy replaces it', () => {
  // Two first-answer decisions of one structure (two decisions of one answer), the re-ask's copy of it refused whole:
  // the first one stands in, its value lowered; the second, whose value grounds, does not replace it.
  const { merge } = planned();
  const refused = { ...VALUED, valueReceipt: { ...VALUED.valueReceipt, role: 'code' } };
  const other = { ...VALUED, dimension: 'which command runs the tests' };
  const kept = merge({ ...empty(), decisions: [NOT_LITERAL_VALUE, other] }, { ...empty(), decisions: [refused] });
  assert.deepEqual(kept.narrative.decisions, [NOT_LITERAL_VALUE]);
  assert.deepEqual([kept.firstStood, kept.fromFirst], [1, 0]);
});

/** Two turns, two windows: the first turn's test run fails, so the second window carries it (D68 F); the second turn
 *  holds a long lint run whose lines the second window's answer asks for. */
function carriedFailure() {
  const blobs = {};
  const ref = refs(blobs);
  const { command, result, said, asked } = builders(ref);
  const next = builders(ref, 'T2');
  const pad = bytesOfTokens(WINDOW_SETTINGS.workTokens) / 2 - 1_000;
  const events = [
    asked('I1', TEXT.ask), command('A1', 'npm test'), result('A1-r', 'A1', TEXT.fail, true),
    said('P1', `SYNTHETIC_D102_PAD:${' x'.repeat(pad)}`), said('C1', TEXT.closing, 'final'),
    next.asked('I2', 'SYNTHETIC_D102_NEXT: go on.'), next.command('L2', 'npm run lint'), next.result('L2-r', 'L2', LONG),
    next.said('C2', 'SYNTHETIC_D102_DONE.', 'final'),
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs, events, children: [] });
}

test('D102 (7): a first-answer decision on an action carried from an earlier window never stands in: both are withheld', async () => {
  const s = carriedFailure();
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  assert.equal(plan.windows.length, 2, 'premise: two windows');
  const [, second] = plan.requests;
  assert.ok(second.context.parts.some((part) => part.failures.some((failure) => failure.call.id === 'A1')),
    'premise: the second window carries the failed run');
  const first = { ...empty(), decisions: [VALUED] };
  const reask = { ...empty(), decisions: [{ ...VALUED, valueReceipt: { ...VALUED.valueReceipt, role: 'code' } }] };
  const a = (id) => second.aliases.of(id);
  const judge = async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [voteReceipt(item)] })) };
    if (!/^narrative:w2(:|$)/.test(request.label)) return empty();
    return request.label.endsWith(':evidence') ? answerOf(a, reask)
      : { ...answerOf(a, first), evidenceRequests: [{ eventId: a('L2-r'), fromLine: 499, throughLine: 501 }] };
  };
  const report = await reviewRun.runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge });
  const window = report.windowResults[1];
  assert.equal(window.evidence.kept, 'merged', 'premise: the re-ask answered and was merged');
  assert.deepEqual(report.decisions, []);
  assert.deepEqual([window.evidence.firstStood, report.withheld.proposals], [0, 1], 'no stand-in that is never published');
});

test('D102 (7): a re-ask ask whose instruction does not ground literally never replaces the first answer\'s grounded one', async () => {
  const { merge } = planned();
  const first = { ...empty(), requirements: [doneWith(SHORT_SAID)] };
  const reask = { ...empty(), requirements: [{ ...doneWith(SHORT_SAID), instruction: NOT_LITERAL }] };
  const kept = merge(first, reask);
  assert.deepEqual(kept.narrative.requirements, first.requirements, 'one identity: the first answer\'s copy stands');
  assert.equal(kept.firstStood, 1);
  const report = await reviewed({ requirements: [doneWith(SHORT_SAID)] }, { requirements: reask.requirements });
  assert.deepEqual(report.requirements.map((row) => [row.status, row.reason ?? null, row.codeMade === true]),
    [['done', null, false]]);
  assert.deepEqual([report.withheld.proposals, report.counts.evidenceRequests.firstStood], [0, 1]);
});

test('D102 (7): a first-answer ask whose instruction does not ground literally never stands in for a lowered re-ask copy', async () => {
  const { merge } = planned();
  const first = { ...empty(), requirements: [{ ...doneWith(SHORT_SAID), instruction: NOT_LITERAL }] };
  const reask = { ...empty(), requirements: [doneWith(LONG_SAID)] };
  const kept = merge(first, reask);
  assert.deepEqual(kept.narrative.requirements, reask.requirements, 'the re-ask\'s lowered copy is the row');
  assert.equal(kept.firstStood, 0);
  const report = await reviewed({ requirements: first.requirements }, { requirements: reask.requirements });
  assert.deepEqual(report.requirements.map((row) => [row.status, row.reason ?? null, row.codeMade === true]),
    [['not-checked', 'deliverable_ungrounded', false]]);
  assert.deepEqual([report.withheld.proposals, report.counts.evidenceRequests.firstStood], [0, 0]);
});
