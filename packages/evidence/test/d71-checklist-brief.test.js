// D71 (S2): the reviewer brief as the checklist (owner decisions 2026-10-08). Every
// recording here is synthetic (a made-up `--json` export task); no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeRows, load, humanAsk, said, call, result, user } from './m33-u-unasked-fixture.js';
import { planWindowRequests, runReview } from '../src/run-review.js';
import { buildNarrativePrompt, NOW_ANSWER, NOW_ANSWER_AGAIN, HUMAN_ASKED_HEADER, HUMAN_WORDS_ABOVE, HARNESS_CONTEXT_LINE,
  PROMPT_VERSION, SESSION_NARRATIVE_SCHEMA } from '../src/prompt.js';
import { SONAH_SESSION_REVIEW_AGENT, SONAH_REVIEW_AGENT, SESSION_REVIEW_AGENT_VERSION } from '../src/review-agent.js';
import { RESULT_OUTCOME_CLASSES, RESULT_OUTCOME_WORDS, resultOutcome, actionOutcome, REQUIREMENT_STATUSES,
  REQUIREMENT_UNCHECKED_REASONS, RESTS_ON_REJECTIONS, NOT_CLAIM_REJECTIONS, SUPPORT_REJECTIONS, PROMISE_STATUSES,
  REQUIREMENT_UNREVIEWED_TEXT, EVIDENCE_QUOTE_MAX } from '../src/ledger.js';
import { Session, verifyReceipt } from '../src/session.js';
import { supportCheck } from '../src/claims.js';
import { checkedRequirement, notClaimsCheck, closingCoverage, restsOnCheck } from '../src/checklist.js';
import { CHALLENGE_PROFILE, CHECKLIST_PROPOSITIONS, SESSION_CHALLENGE_CORE, REQUIREMENT_NOTE, CLAIM_NOTE, challengeSystem,
  checklistSystem } from '../src/challenge.js';
import { closingMessages, messageLines, WINDOWING_VERSION } from '../src/windows.js';
import { EVIDENCE_REQUEST_REFUSALS } from '../src/evidence-requests.js';

const ASK = 'Add a --json flag to the export command in src/export.js. Keep the CSV output unchanged and do not touch '
  + 'src/config.js. Run the full test suite and tell me the result.';
const SECOND = 'Also print the row count at the end.';
const SIDECAR = (extra = {}) => ({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, ...extra });
// D103: a Claude Code recording's result is cut past twice its 12,000-byte skim: 1,000 rows of about 55 bytes.
const LONG = Array.from({ length: 1_000 }, (_, k) => `PASS test/case-${k}.test.js (row ${k} of the export suite)`).join('\n');
const CLOSING = 'Done. Summary:\n- Added --json.\n\n- All 24 tests pass.';

/** One synthetic recording: the ask, a failing run, an edit, a long run, a background run, a closing message, a second
 *  ask nobody answers. */
function rows() {
  return [
    humanAsk(ASK),
    said('I will look at the export command first.'),
    call('t1', 'Bash', { command: 'npm test' }),
    result('t1', 'FAIL test/export.test.js\n1 failed, 23 passed', SIDECAR({ stdout: 'FAIL' }), true),
    call('t2', 'Edit', { file_path: '/repo/src/export.js', old_string: 'csv', new_string: 'json' }),
    result('t2', 'The file /repo/src/export.js has been updated.', { filePath: '/repo/src/export.js', oldString: 'csv',
      newString: 'json', originalFile: 'export csv\n', structuredPatch: [], userModified: false, replaceAll: false }),
    call('t3', 'Bash', { command: 'npm run long' }),
    result('t3', LONG, SIDECAR({ stdout: LONG })),
    call('t4', 'Bash', { command: 'npm test', run_in_background: true }),
    result('t4', 'Command running in background with ID: b1', SIDECAR({ backgroundTaskId: 'b1' })),
    said(CLOSING),
    humanAsk(SECOND),
  ];
}

const events = (session, kind) => session.events.filter((event) => event.kind === kind);
const ids = (session) => {
  const [ask, second] = events(session, 'instruction');
  const [firstSaid, closing] = events(session, 'commentary');
  const [failing, edit, long, background] = events(session, 'invocation');
  const resultOf = (call) => session.events.find((event) => event.kind === 'observation' && event.invocation === call.id);
  return { ask, second, firstSaid, closing, failing, edit, long, background, failingResult: resultOf(failing),
    editResult: resultOf(edit), longResult: resultOf(long), backgroundResult: resultOf(background) };
};

test('D71 S2: the closed vocabularies, each in one constants place, and the versions moved once', () => {
  // S7: `stopped` and `not-typed` left the table. D99 (F1 guard) adds `end-unread`, last, so no class moves.
  assert.deepEqual(RESULT_OUTCOME_CLASSES, ['ran-exit-0', 'ran-completed', 'ran-failed', 'did-not-run',
    'no-terminal-status', 'failed-or-refused', 'output-no-status', 'end-unread']);
  assert.deepEqual(Object.keys(RESULT_OUTCOME_WORDS), [...RESULT_OUTCOME_CLASSES]);
  assert.deepEqual(REQUIREMENT_STATUSES, ['done', 'partly-done', 'not-done', 'not-checked']);
  // D80 adds one: a deliverable quoting only the body of a write whose command did not run or failed. D99 (F1 guard)
  // adds one more: a deliverable whose check's end Sonah could not read; and its review one more, where no later record
  // is shown to mention that check.
  assert.deepEqual(REQUIREMENT_UNCHECKED_REASONS, ['deliverable_ungrounded', 'deliverable_not_after', 'check_not_completed',
    'shortfall_ungrounded', 'ask_unreviewed', 'challenge_refuted', 'challenge_unsettled', 'challenge_unexecuted',
    'write_command_not_run_or_failed', 'check_end_unread', 'check_end_unchecked']);
  assert.deepEqual(RESTS_ON_REJECTIONS, ['malformed', 'not_action', 'out_of_order', 'cross_actor', 'completed']);
  assert.deepEqual(NOT_CLAIM_REJECTIONS, ['malformed', 'not_closing', 'line_out_of_range']);
  // `no_terminal_status` is removed: the typed outcome only marks a support.
  assert.ok(!SUPPORT_REJECTIONS.includes('no_terminal_status'));
  assert.deepEqual(PROMISE_STATUSES, ['open', 'verified', 'incomplete']);
  for (const list of [RESULT_OUTCOME_CLASSES, REQUIREMENT_STATUSES, REQUIREMENT_UNCHECKED_REASONS, RESTS_ON_REJECTIONS,
    NOT_CLAIM_REJECTIONS]) assert.ok(Object.isFrozen(list));
  // D71 (S3) moved the three once more (/28, /4, /25): the new channels (d71-channels.test.js, D71_CHANNELS_VERSIONS).
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  // D103 moved it once more (sonah.narrative/38): a Claude Code recording's results shown up to 12,000 bytes a side.
  assert.equal(PROMPT_VERSION, 'sonah.narrative/38');
  // The column fix moved it once more (sonah.session-review-agent/8): who decided a decision (FIX_COLUMN_VERSIONS).
  // P1 (the asks fixes) moved it once more (sonah.session-review-agent/9): a run refused at every attempt.
  // W1 B moved it once more (sonah.session-review-agent/10): an edit may go against a project instruction file.
  // W2 moved it once more (sonah.session-review-agent/11): a claim is compared with the evidence; the agent's own text.
  assert.equal(SESSION_REVIEW_AGENT_VERSION, 'sonah.session-review-agent/11');
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
  assert.equal(CHALLENGE_PROFILE.version, 'sonah.challenge/45');
  // D103 moved it once more (sonah.windows/9): the skim keyed by the recording's harness, in bytes a side.
  assert.equal(WINDOWING_VERSION, 'sonah.windows/9');
});

test('D71 S2: the brief opens with the purpose, gives the steps in order, and states each rule once', () => {
  const brief = SONAH_SESSION_REVIEW_AGENT;
  assert.ok(brief.startsWith("You are Sonah's session reviewer.\n\nWHAT YOUR ANSWER IS FOR"));
  const order = ['WHAT YOUR ANSWER IS FOR', 'HOW CAREFUL TO BE', 'WHAT YOU ARE READING', 'STEP 1. WHAT THE HUMAN ASKED',
    // D71 (S3): the failures the agent passed over are step 4; the edits and the last check moved to steps 5 and 6.
    'STEP 2. WHAT THE AGENT TOLD THE HUMAN', 'STEP 3. WHAT THE AGENT DECIDED', 'STEP 4. FAILURES THE AGENT PASSED OVER',
    'STEP 5. EDITS AGAINST WHAT THE HUMAN SAID', 'STEP 6. BEFORE YOU ANSWER', 'HOW TO QUOTE', 'WHAT YOU NEVER OUTPUT',
    'HOW TO ANSWER'];
  const at = order.map((heading) => brief.indexOf(`\n${heading}`));
  assert.ok(at.every((n, k) => n >= 0 && (k === 0 || n > at[k - 1])), 'the steps in order');
  for (const heading of order) assert.equal(brief.split(`\n${heading}`).length, 2, `${heading} once`);
  // Owner decision D71 (b): the weakest status, never a missing row.
  assert.ok(brief.includes('Never leave a row out because nothing confirms it.'));
  assert.ok(brief.includes('Leave a row out only when you cannot anchor it on an exact quote.'));
  // The brief's deletions: no stale or conflicting sentence survives.
  for (const gone of ['child:', 'CODE WRITTEN', 'Do not judge code correctness', 'omit the claim', 'OMIT THE CLAIM',
    'highest-value', 'a separate code review', 'When unsure, leave it out', 'Every array is required',
    'An empty array is an honest answer', 'Prefer 15-120', 'untrusted historical evidence', 'Use it only when'])
    assert.ok(!brief.includes(gone), gone);
  // The instructionReview statement is said once, under HOW TO ANSWER.
  assert.equal(brief.split('instructionReview gives the column').length, 2);
  assert.ok(brief.indexOf('instructionReview gives the column') > brief.indexOf('HOW TO ANSWER'));
  // The combined route's agent is byte for byte as before (D71 i).
  assert.ok(SONAH_REVIEW_AGENT.startsWith("You are Sonah's review agent. You review a pull request"));
});

test('D71 S2: a session-only request is the window in the checklist\'s reading order', async (t) => {
  const { session } = await load(t, rows());
  const n = ids(session);
  const [built] = planWindowRequests({ session, reviewScope: 'session-only' }).requests;
  const { prompt, evidencePrompt, system } = built.request;
  assert.equal(system, SONAH_SESSION_REVIEW_AGENT);
  assert.ok(prompt.startsWith(`# Checklist for window 1\n\n${HUMAN_ASKED_HEADER.join('\n')}`));
  const order = ['## What the human asked', '## About this window', '## The session', '## Now answer'];
  const at = order.map((heading) => prompt.indexOf(heading));
  assert.ok(at.every((k, i) => k >= 0 && (i === 0 || k > at[i - 1])), 'reading order');
  assert.ok(prompt.endsWith(NOW_ANSWER.join('\n')));
  // The human's words at the top, whole, said where they were recorded; the session points up to them.
  const alias = built.aliases.of;
  assert.ok(prompt.includes(`[${alias(n.ask.id)}] HUMAN INSTRUCTION · authority=human · sequence=${n.ask.sequence} `
    + '· role=instruction · in this window · active task\n<<<\n' + ASK + '\n>>>'));
  assert.equal(prompt.split(ASK).length, 2, 'the human words once');
  assert.ok(prompt.includes(`  ${HUMAN_WORDS_ABOVE}`));
  // Aliases in recorded order.
  const order2 = session.events.filter((event) => built.aliases.has(event.id));
  assert.deepEqual(order2.map((event) => alias(event.id)), order2.map((_, k) => `E${k + 1}`));
  // About this window: its last event, the closing message (numbered), what is not shown in full, the harness line.
  assert.ok(prompt.includes(`- Its last recorded event is [${alias(n.second.id)}]. Nothing recorded after it is part of this request.`));
  assert.ok(prompt.includes(`- The agent's closing message in this window: [${alias(n.closing.id)}], 4 lines, numbered.`));
  assert.ok(prompt.includes(`- Not shown in full: src/export.js before [${alias(n.edit.id)}]; [${alias(n.longResult.id)}] lines `));
  assert.ok(prompt.includes(HARNESS_CONTEXT_LINE));
  // Typed outcomes, never a status word in the header; a failed command names the tool it attempted.
  assert.ok(prompt.includes(`[${alias(n.failing.id)}] ACTION · tool=bash · operation=command`));
  assert.ok(!prompt.includes('tool=error'));
  assert.ok(prompt.includes(`[${alias(n.failingResult.id)}] RESULT of ${alias(n.failing.id)} · role=observation\n  outcome: ran, failed (error flag set)`));
  assert.ok(prompt.includes(`[${alias(n.editResult.id)}] RESULT of ${alias(n.edit.id)} · role=observation\n  outcome: ran, completed`));
  assert.ok(prompt.includes('  outcome: no terminal status recorded (run in the background)'));
  assert.ok(!/· (succeeded|failed|unknown) · role=observation/.test(prompt));
  // The closing message numbered by line, its tag the turn's.
  assert.ok(prompt.includes('AGENT SAID · last message of its turn · role=commentary · 4 lines, numbered outside the fences\n'
    + '  line 1:\n<<<\nDone. Summary:\n>>>\n  line 2:\n<<<\n- Added --json.\n>>>\n  line 3: (empty line)\n  line 4:\n<<<\n- All 24 tests pass.\n>>>'));
  // An omitted part offers its request under the brief's last step (S3: step 6); the challengers' evidence never does.
  assert.ok(prompt.includes("ask for them under step 6 if a row's status depends on them"));
  assert.ok(!evidencePrompt.includes('step 5') && !evidencePrompt.includes('ask for') && !evidencePrompt.includes('available on request'));
  assert.ok(evidencePrompt.startsWith('## What the human asked'));
  assert.ok(!evidencePrompt.includes('## About this window') && !evidencePrompt.includes('## Now answer'));
  // Nothing of the old framing.
  for (const gone of ['HOW TO QUOTE', 'YOUR TASK', 'SCOPE: Review the recorded session only.', '## How to answer',
    'untrusted historical evidence', 'Active task:', 'human instruction inventory below'])
    assert.ok(!prompt.includes(gone), gone);
  // The combined route's request is the old framing, unchanged (D71 i).
  const combined = buildNarrativePrompt({ session, window: built.window, reviewScope: 'combined' });
  assert.ok(combined.prompt.includes('HOW TO QUOTE') && combined.prompt.includes('YOUR TASK'));
  assert.ok(combined.prompt.includes('untrusted historical evidence') && !combined.prompt.includes('outcome:'));
});

test('D71 S2: the typed outcome reads recorder fields only, and an action with no result has no terminal status', async (t) => {
  const { session } = await load(t, rows());
  const n = ids(session);
  assert.equal(resultOutcome(session, n.failingResult).class, 'ran-failed');
  assert.equal(resultOutcome(session, n.editResult).class, 'ran-completed');
  assert.equal(resultOutcome(session, n.backgroundResult).class, 'no-terminal-status');
  assert.equal(actionOutcome(session, n.background).class, 'no-terminal-status');
  // A denial the recorder typed, an interruption and the untyped refusal mark are read off the call, never the output.
  const call = (recorded, extra = {}) => ({ id: 'c', kind: 'invocation', recorded, ...extra });
  const view = (callEvent, extra = {}) => resultOutcome({ event: () => callEvent }, { kind: 'observation', invocation: 'c',
    result: 'failed', sourceOfResult: 'native', output: ['x'], ...extra });
  assert.deepEqual(view(call({ denial: 'user-rejected', isError: true })),
    { class: 'did-not-run', form: 'denial', words: 'did not run (the recorder typed the call as user-rejected)' });
  // S7: an interruption is a form of no terminal status; a RESULT recorded with nothing shown and no status typed is
  // output-no-status `unread` (a result was recorded), never a failure.
  assert.deepEqual(view(call({ interrupted: true })), { class: 'no-terminal-status', form: 'interrupted',
    words: 'no terminal status recorded (stopped before it finished)' });
  assert.deepEqual(view(call({}), { result: 'cancelled', sourceOfResult: 'native', output: [] }), { class: 'no-terminal-status',
    form: 'cancelled', words: 'no terminal status recorded (the recorder typed it as cancelled)' });
  for (const extra of [{ result: 'unknown', sourceOfResult: 'unknown', terminalStatusProven: false, output: [] },
    { result: 'failed', sourceOfResult: 'unknown', terminalStatusProven: true, output: [] }])
    assert.deepEqual(view(call({}), extra), { class: 'output-no-status', form: 'unread',
      words: 'result recorded; none of its output is shown, and no exit code or completion is typed for it' });
  assert.equal(view(call({ isError: true }, { refusalUntyped: true })).class, 'failed-or-refused');
  assert.equal(view(call({}), { result: 'unknown', sourceOfResult: 'unknown', terminalStatusProven: false }).class, 'output-no-status');
  assert.equal(view(call({}), { result: 'succeeded', exitCode: 0, terminalStatusProven: true }).words, 'ran, exit 0');
  assert.equal(view(call({}), { exitCode: 2 }).words, 'ran, failed (exit 2)');
});

/** A judge that answers the narrative with `answer(request)` and upholds every challenge item on its own receipt unless
 *  `verdict(item)` says otherwise; every request is kept in `seen`. */
function judgeOf(answer, { verdict = () => 'not-refuted', seen = [] } = {}) {
  const own = (candidate) => candidate?.deliverable ?? candidate?.shortfall ?? candidate?.instruction ?? candidate?.stated
    ?? candidate?.violation ?? candidate?.receipts?.[0] ?? null;
  return async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map((item) => {
      const receipt = own(item.candidate);
      return { key: item.key, verdict: verdict(item), explanation: 'Synthetic.',
        receipts: receipt ? [{ eventId: receipt.eventId, role: receipt.role, quote: receipt.quote }] : [] };
    }) };
    return answer(request);
  };
}
const quote = (eventId, role, text) => ({ eventId, role, quote: text });

test('D71 S2: each requirement status needs its evidence, code keeps an unsure row at its weakest status, and every '
  + 'message gets a row', async (t) => {
  const { session } = await load(t, rows());
  const n = ids(session);
  const ask = (text) => quote(n.ask.id, 'instruction', text);
  const answer = () => ({ decisions: [], pivots: [], claims: [], requirements: [
    { text: 'json flag', instruction: ask('Add a --json flag'), status: 'done', deliverable: quote(n.edit.id, 'code', 'json') },
    { text: 'csv', instruction: ask('Keep the CSV output unchanged'), status: 'done',
      deliverable: quote(n.edit.id, 'code', 'words that are nowhere') },
    { text: 'suite', instruction: ask('Run the full test suite'), status: 'done',
      deliverable: quote(n.backgroundResult.id, 'observation', 'Command running in background') },
    { text: 'config', instruction: ask('do not touch src/config.js'), status: 'not-done',
      shortfall: quote(n.failingResult.id, 'observation', '1 failed, 23 passed') },
    { text: 'tell me', instruction: ask('tell me the result'), status: 'not-checked', restsOn: [n.background.id, n.edit.id] },
  ] });
  const seen = [];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf(answer, {
    seen, verdict: (item) => (item.type === 'requirement' && item.candidate.status === 'not-done' ? 'refuted' : 'not-refuted') }) });
  const rowOf = (text) => report.requirements.find((row) => row.text === text);
  assert.equal(rowOf('json flag').status, 'done');
  assert.equal(rowOf('json flag').deliverable.quote, 'json');
  assert.deepEqual([rowOf('csv').status, rowOf('csv').reason], ['not-checked', 'deliverable_ungrounded']);
  assert.deepEqual([rowOf('suite').status, rowOf('suite').reason], ['not-checked', 'check_not_completed']);
  assert.deepEqual([rowOf('config').status, rowOf('config').reason], ['not-checked', 'challenge_refuted']);
  assert.equal(rowOf('config').shortfall, undefined, 'a lowered row carries no receipt');
  assert.deepEqual([rowOf('tell me').status, rowOf('tell me').restsOn], ['not-checked', [n.background.id]]);
  // The second message no row cites: code's own row, in fixed words; the recording ends in this window.
  const floor = report.requirements.find((row) => row.codeMade === true);
  assert.deepEqual(floor, { text: REQUIREMENT_UNREVIEWED_TEXT, instruction: { eventId: n.second.id, role: 'instruction' },
    status: 'not-checked', reason: 'ask_unreviewed', codeMade: true, facts: ['no_deliverable_by_end'] });
  assert.deepEqual(report.counts.checklist.requirements.byStatus, { done: 1, 'partly-done': 0, 'not-done': 0, 'not-checked': 5 });
  assert.equal(report.counts.checklist.restsOnRejected.requirements.completed, 1, 'the edit ran to an end');
  // Only done, partly-done and not-done rows are asked, each with its proposition first; never a not-checked one.
  const asked = seen.filter((r) => r.challenge).flatMap((r) => r.challenge.items).filter((item) => item.type === 'requirement');
  assert.deepEqual([...new Map(asked.map((item) => [item.key, item.candidate.status])).values()].sort(), ['done', 'not-done']);
  const batch = seen.find((r) => r.challenge && r.challenge.items.some((item) => item.type === 'requirement'));
  assert.ok(batch.prompt.startsWith('# Candidates to challenge, by key, with the proposition each states\n'));
  assert.ok(batch.prompt.includes(CHECKLIST_PROPOSITIONS.requirementDone));
  assert.ok(batch.system.startsWith(SESSION_CHALLENGE_CORE) && batch.system.includes(REQUIREMENT_NOTE));
  assert.ok(!batch.system.includes(challengeSystem()), 'never the combined route\'s system');
  assert.ok(!batch.prompt.includes('step 5') && !batch.prompt.includes('available on request'));
  // The page's words, in the readers.
  assert.equal(report.requirementsRejected, 0, 'no row the review named was left out');
});

test('D71 S2: a claim whose checks never completed is "incomplete", and the closing message is covered line by line',
  async (t) => {
  const { session } = await load(t, rows());
  const n = ids(session);
  // A support on such a result is no longer refused by code (the last test of this file).
  const answer = () => ({ decisions: [], pivots: [], requirements: [], claims: [
    { text: 'tests pass', stated: quote(n.closing.id, 'commentary', 'All 24 tests pass.'), restsOn: [n.background.id] },
    { text: 'added', stated: quote(n.closing.id, 'commentary', '- Added --json.') },
  ], notClaims: [{ eventId: n.closing.id, lines: [1, 3] }, { eventId: n.closing.id, lines: [9] },
    { eventId: n.firstSaid.id, lines: [1] }] });
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf(answer) });
  const promiseOf = (text) => report.promises.find((p) => p.text === text);
  assert.equal(promiseOf('tests pass').status, 'incomplete');
  assert.deepEqual(promiseOf('tests pass').restsOn, [n.background.id]);
  assert.equal(promiseOf('added').status, 'open');
  const { closing, notClaims } = report.counts.checklist;
  assert.deepEqual(closing, { messages: 1, lines: 4, covered: 2, listed: 2, closing_line_unreviewed: 0 });
  assert.deepEqual(notClaims, { proposed: 3, accepted: 2, rejected: { malformed: 0, not_closing: 1, line_out_of_range: 1 } });
  // Code's structure checks, on their own.
  const window = planWindowRequests({ session, reviewScope: 'session-only' }).windows[0];
  assert.deepEqual(closingMessages(session, window).map((c) => [c.eventId, c.lines, c.numbered]), [[n.closing.id, 4, true]]);
  assert.deepEqual(messageLines(session, n.closing).map((line) => line.k), [1, 2, 3, 4]);
  assert.deepEqual(closingCoverage(session, window, [], new Map()).map((c) => c.unreviewed), [[1, 2, 4]], 'an empty line asserts nothing');
  assert.equal(notClaimsCheck(session, window, 'not a list').rejected.malformed, 1);
});

test('D71 S2: restsOn accepts only the row\'s own unfinished checks, in order', async (t) => {
  const { session } = await load(t, rows());
  const n = ids(session);
  const sourceMap = planWindowRequests({ session, reviewScope: 'session-only' }).requests[0].sourceMap;
  const after = restsOnCheck(session, [n.background.id, n.edit.id, n.closing.id, 7, n.background.id],
    { sourceMap, anchor: n.ask });
  assert.deepEqual(after.accepted, [n.background.id]);
  assert.deepEqual(after.rejected, { malformed: 1, not_action: 1, out_of_order: 0, cross_actor: 0, completed: 1 });
  const before = restsOnCheck(session, [n.background.id], { sourceMap, anchor: n.firstSaid, before: true });
  assert.equal(before.rejected.out_of_order, 1, 'a claim rests on actions recorded before it');
  const lowered = checkedRequirement(session, { text: 't', instruction: quote(n.ask.id, 'instruction', 'Add a --json flag'),
    status: 'done', deliverable: quote(n.ask.id, 'instruction', 'Add a --json flag') }, { sourceMap });
  assert.deepEqual([lowered.candidate.status, lowered.reason], ['not-checked', 'deliverable_ungrounded'],
    'a deliverable is never the ask itself');
});

test('D71 S2: the evidence re-ask shows the served lines at their event, and the window asks no more', async (t) => {
  const { session } = await load(t, rows());
  const n = ids(session);
  const seen = [];
  let asks = 0;
  const answer = () => (++asks === 1
    ? { decisions: [], pivots: [], claims: [], requirements: [], evidenceRequests: [{ eventId: n.longResult.id, fromLine: 500, throughLine: 502 }] }
    : { decisions: [], pivots: [], claims: [], requirements: [] });
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf(answer, { seen }) });
  const narratives = seen.filter((r) => !r.challenge);
  assert.equal(narratives.length, 2);
  const [, reask] = narratives;
  assert.ok(reask.prompt.endsWith(NOW_ANSWER_AGAIN.join('\n')));
  assert.ok(!reask.prompt.includes('## Evidence served on your request'));
  const served = reask.prompt.indexOf('lines 500–502 of this output, served after the first answer asked for them:');
  assert.ok(served > reask.prompt.indexOf('## The session'), 'at its event, inside the session');
  assert.ok(reask.prompt.includes('PASS test/case-499.test.js'));
  assert.ok(!reask.prompt.includes("ask for them under step 5"), 'the re-ask offers no more requests');
  assert.equal(report.windowResults[0].evidence.served, 1);
  assert.deepEqual(Object.keys(report.windowResults[0].evidence.refused), [...EVIDENCE_REQUEST_REFUSALS]);
});

test('D71 S2: the session challenge sends only the notes its batch needs; the combined route sends SYSTEM as before', () => {
  assert.equal(checklistSystem(['requirement']), `${SESSION_CHALLENGE_CORE}\n${REQUIREMENT_NOTE}`);
  assert.ok(checklistSystem(['claim']).includes(CLAIM_NOTE));
  assert.ok(!checklistSystem(['decision']).includes(CLAIM_NOTE));
  assert.ok(Buffer.byteLength(SESSION_CHALLENGE_CORE) < Buffer.byteLength(challengeSystem()));
  // D71 (S3): ten more (three contradiction sources, four for a choice not to act, three failure handlings).
  // The column fix: four more (a decision a project instruction file covers: settled, chose how, and their
  // notActing forms). D84: two more (an unasked decision whose review checks such a file, and its
  // notActing form). W2: two more (a claim and a written statement the agent's own written text contradicts).
  assert.equal(Object.keys(CHECKLIST_PROPOSITIONS).length, 32);
  // The schema holds the checklist's members and statuses; the combined schema is unchanged.
  assert.deepEqual(SESSION_NARRATIVE_SCHEMA.properties.requirements.items.properties.status.enum, [...REQUIREMENT_STATUSES]);
  assert.equal(SESSION_NARRATIVE_SCHEMA.properties.claims.items.properties.restsOn.type, 'array');
  assert.equal(SESSION_NARRATIVE_SCHEMA.properties.notClaims.items.required.join(), 'eventId,lines');
});

test('a support on a result with no terminal status is judged as every support is: the code checks '
  + 'of any receipt, then its own challenge item', async (t) => {
  const { session } = await load(t, rows());
  const n = ids(session);
  assert.equal(resultOutcome(session, n.backgroundResult).class, 'no-terminal-status', 'premise');
  assert.equal(resultOutcome(session, n.longResult).class, 'output-no-status', 'premise');
  const sourceMap = planWindowRequests({ session, reviewScope: 'session-only' }).requests[0].sourceMap;
  const stated = quote(n.closing.id, 'commentary', 'All 24 tests pass.');
  const background = quote(n.backgroundResult.id, 'observation', 'Command running in background');
  const check = (supportedBy) => supportCheck(session, { text: 'x', stated, supportedBy }, sourceMap);
  // Code passes it exactly as it passes a result that shows its output with no status typed (admissible before too) ...
  assert.deepEqual(check(background), { ok: true, receipt: { ...background, sessionKey: session.sessionKey } });
  assert.equal(check(quote(n.longResult.id, 'observation', 'PASS test/case-0.test.js')).ok, true);
  // ... and refuses it only on the other rules' terms: a quote the result does not hold.
  assert.deepEqual(check(quote(n.backgroundResult.id, 'observation', 'All 24 tests pass')),
    { ok: false, reason: 'ungrounded' });
  // In the review it is asked as its own item, and that item alone decides: upheld, verified; refuted, open.
  const vote = (verdict, seen = []) => async (request) => {
    seen.push(request);
    if (!request.challenge) return { decisions: [], pivots: [], requirements: [],
      claims: [{ text: 'tests pass', stated, supportedBy: background }] };
    return { votes: request.challenge.items.map((item) => ({ key: item.key, explanation: 'Synthetic.',
      verdict: item.type === 'support' ? verdict : 'not-refuted',
      receipts: [item.type === 'support' ? item.candidate.supportedBy : item.candidate.stated] })) };
  };
  const seen = [];
  const upheld = await runReview({ session, pr: null, reviewScope: 'session-only', judge: vote('not-refuted', seen) });
  assert.ok(seen.some((r) => r.challenge?.items.some((item) => item.type === 'support'
    && item.candidate.supportedBy.eventId === n.backgroundResult.id)), 'asked as its own item');
  // The challenger sees the structural fact the reverted rule acted on: the result's outcome line.
  assert.ok(seen.find((r) => r.label?.includes(':support:'))?.prompt
    .includes('  outcome: no terminal status recorded (run in the background)'), 'the outcome line reaches the challenger');
  assert.deepEqual(upheld.promises.map((p) => [p.text, p.status]), [['tests pass', 'verified']]);
  assert.equal(upheld.counts.promiseSupport.verified, 1);
  assert.ok(!Object.hasOwn(upheld.counts.promiseSupport.rejected, 'no_terminal_status'));
  const refuted = await runReview({ session, pr: null, reviewScope: 'session-only', judge: vote('refuted') });
  assert.deepEqual(refuted.promises.map((p) => [p.text, p.status]), [['tests pass', 'open']]);
  assert.equal(refuted.counts.promiseSupport.rejected.refuted, 1);
});

// Kept from the review of W4's merge (its low finding; W4 itself is reverted): the 120-character cap on a checklist
// deliverable (checklist.js `groundedIn`, CHECKLIST_QUOTE_MAX = EVIDENCE_QUOTE_MAX) had no test that could break it.
test('D71 S2: a checklist deliverable over EVIDENCE_QUOTE_MAX characters does not ground, though it is in the recording',
  () => {
    const ASKED = 'SYNTHETIC_CAP_ASK: rename the module.';
    const line = `SYNTHETIC_CAP_LONG ${'renamed the module and its imports '.repeat(5)}`;
    assert.ok(line.length > EVIDENCE_QUOTE_MAX + 1);
    const span = (key, text) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
    const session = new Session({ sessionKey: 'sess-cap', adapter: 'claude', blobs: { ask: ASKED, long: line },
      events: [{ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: span('ask', ASKED), sequence: 0 },
        { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: span('long', line), sequence: 1 }],
      children: [] });
    const sourceMap = { I1: [{ role: 'instruction' }], C1: [{ role: 'commentary' }] };
    const row = (length) => ({ text: 'rename the module', status: 'done',
      instruction: quote('I1', 'instruction', 'rename the module'), deliverable: quote('C1', 'commentary', line.slice(0, length)) });
    assert.equal(verifyReceipt(session, row(EVIDENCE_QUOTE_MAX + 1).deliverable).ok, true, 'literally there');
    const at = checkedRequirement(session, row(EVIDENCE_QUOTE_MAX), { sourceMap });
    assert.deepEqual([at.candidate.status, at.reason], ['done', null]);
    const over = checkedRequirement(session, row(EVIDENCE_QUOTE_MAX + 1), { sourceMap });
    assert.deepEqual([over.candidate.status, over.reason], ['not-checked', 'deliverable_ungrounded']);
  });
