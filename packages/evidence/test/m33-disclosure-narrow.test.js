// Disclosure narrowed (owner decision 2026-10-06; `sonah.challenge/16`). On both routes an edit against a human
// instruction is FYI `disclosed` only when the agent's later statement passed code's checks and its own challenge item
// was upheld (M33 brittleness M4). That item asked whether the statement "told the human about this change", so a
// statement that reported the breach as a feature or an improvement could make it FYI. It now asks whether the statement
// told the human that the agent went against the human's instruction by this change (challenge.js
// DISCLOSURE_PROPOSITION, DISCLOSURE_NOTE). Which statements say so is the model's judgment of the quoted words: code
// adds no rule, and both statements below pass code's checks exactly alike.
//
// Synthetic recordings only (m33-m4-disclosure-rows.js for the combined route; m33-n-forbidden-edit-rows.js through the
// real slicer, redactor and adapter for the session-only route). No model is called: the challengers are a table keyed
// by the statement's words, standing in for the judgment the narrowed proposition asks for. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { runCodeReview } from '../src/code-review.js';
import { Session } from '../src/session.js';
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as challenge from '../src/challenge.js';
import { disclosureSession, PR, DIFF, GREET, RULE, EDIT, BREACH, WORDS, IMPROVED } from './m33-m4-disclosure-rows.js';
import * as R from './m33-n-forbidden-edit-rows.js';
import { DISCLOSURE_NARROW, DISCLOSURE_WORDS, beforeDisclosureNarrow } from './m33-m4-disclosure-fixture.js';
import { DISCLOSURE_NARROW_VERSIONS, STABLE_IDS_VERSIONS, DISCLOSURE_WORDS_VERSIONS, WINDOWING_VERSIONS,
  RECORDED_FACTS_VERSIONS, FORMAT_VERSIONS, CONVERSATION_VERSIONS, D69_VERSIONS, D69_REVIEW_VERSIONS,
  D71_BRIEF_VERSIONS, D71_CHANNELS_VERSIONS, D71_READER_VERSIONS, D71_PAGE_VERSIONS, D71_FIX_VERSIONS,
  D71_FIX_READER_VERSIONS, S7_VERSIONS, FIX_COLUMN_VERSIONS, REQUEST_STEPS_READER_VERSIONS,
  ATTACHED_FILE_READER_VERSIONS, REFUSALS_READER_VERSIONS, D80_VERSIONS, D80_READER_VERSIONS,
  D84_OUTPUT_READER_VERSIONS, FIX_COLUMN_READER_VERSIONS, ASKS_FIXES_VERSIONS, W1_VERSIONS, W2_VERSIONS, W3_VERSIONS, FIX_REVIEW_VERSIONS, W1_READER_VERSIONS,
  W2_READER_VERSIONS, W4_READER_VERSIONS, CODE_PASS_VERSIONS, CODE_PASS_READER_VERSIONS, W4_REVERT_READER_VERSIONS,
  JUDGMENT_FIRST_READER_VERSIONS, CODE_STEP_VERSIONS, CODE_STEP_REVIEW_VERSIONS, CODE_STEP_REREVIEW_VERSIONS,
  CODE_STEP_THIRD_REVIEW_VERSIONS, VOID_VOTE_REASK_VERSIONS, CLEANUP_VERSIONS, CODE_STEP_READER_VERSIONS, CODE_STEP_REVIEW_READER_VERSIONS,
  JUDGMENT_FIRST_REVIEW_READER_VERSIONS, RELEASE_REVIEW_READER_VERSIONS, RELEASE_REVIEW_VERSIONS, AGENTIC_READER_VERSIONS,
  CLEANUP_READER_VERSIONS, REPORT_MD_READER_VERSIONS,
  SECOND_RELEASE_REVIEW_VERSIONS, CHOICE_REANCHOR_VERSIONS }
  from './m33-integration-fixture.js';

const zeros = Object.fromEntries(ledger.DISCLOSURE_REJECTIONS.map((reason) => [reason, 0]));
const disclosureRequests = (seen) => seen.filter((r) => r.challenge && r.label.includes(':disclosure'));

/** A disclosure item's vote, by its statement's words: `support` (not-refuted, citing the statement) or `refute`. */
const disclosureVote = (item, votes) => {
  const verdict = votes[item.candidate.statement.quote];
  assert.ok(verdict === 'support' || verdict === 'refute', 'every statement asked about has a stubbed vote');
  return { key: item.key, verdict: verdict === 'refute' ? 'refuted' : 'not-refuted', explanation: 'Synthetic.',
    receipts: [item.candidate.statement] };
};

/** Every disclosure request asks the narrowed question, in code's fixed words, and nothing else moved in it. */
function assertNarrowed(requests, label) {
  assert.equal(requests.length, 3, `${label}: its own three-pass run`);
  for (const request of requests) {
    assert.ok(request.system.includes(challenge.DISCLOSURE_NOTE), label);
    const [item] = request.challenge.items;
    assert.equal(item.type, ledger.DISCLOSURE_ITEM_TYPE, label);
    assert.equal(item.candidate.proposition, challenge.DISCLOSURE_PROPOSITION, label);
    // Rendered back, the request is the one /15 sent: the proposition and the note are the only bytes that moved.
    const before = beforeDisclosureNarrow(`${request.system}\n${request.prompt}`);
    assert.ok(!before.includes(DISCLOSURE_NARROW.texts.note[1]) && before.includes(DISCLOSURE_NARROW.texts.note[0]), label);
    assert.ok(before.includes(JSON.stringify(DISCLOSURE_NARROW.texts.proposition[0])), label);
  }
}

test('Disclosure narrowed: the proposition and the note ask whether the agent said it went against the instruction', () => {
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
  assert.equal(challenge.DISCLOSURE_PROPOSITION, DISCLOSURE_NARROW.texts.proposition[1]);
  assert.equal(challenge.DISCLOSURE_NOTE, DISCLOSURE_NARROW.texts.note[1]);
  assert.ok(challenge.DISCLOSURE_NOTE.includes('did that statement tell the human that the agent went against the '
    + 'human\'s instruction by this change?'));
  assert.ok(!challenge.DISCLOSURE_NOTE.includes('did that statement tell the human about this change?'));
  // The closed vocabularies did not move: an improvement-framed statement is refuted by the challengers, counted as such.
  assert.deepEqual(ledger.DISCLOSURE_REASONS, ['self_corrected', 'helper_internal', 'disclosed']);
  assert.deepEqual(ledger.DISCLOSURE_REJECTIONS, ['malformed', 'unsupplied', 'ungrounded', 'not_later', 'cross_actor',
    'refuted', 'unsettled', 'unexecuted']);
});

// ---- combined route: the joint answer's `disclosedBy` -------------------------------------------------------------------

const ADMITTED = Object.freeze({ eventId: 'C1', role: 'commentary', quote: WORDS.told });
const IMPROVEMENT = Object.freeze({ eventId: 'C1', role: 'commentary', quote: IMPROVED });
const COMBINED_VOTES = Object.freeze({ [WORDS.told]: 'support', [IMPROVED]: 'refute' });

const combinedJudge = (disclosedBy, seen) => async (request) => {
  seen.push(request);
  const base = { decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] };
  if (request.challenge) return { votes: request.challenge.items.map((item) => (item.type === ledger.DISCLOSURE_ITEM_TYPE
    ? disclosureVote(item, COMBINED_VOTES)
    : { key: item.key, verdict: 'not-refuted', explanation: 'Synthetic support.', receipts: [RULE] })) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
  if (request.label === 'code+narrative:w1') return { ...base, sessionFindings: [{ ...BREACH, disclosedBy }], reviewedFiles: [] };
  return { ...base, reviewedFiles: [] };
};
const combined = async (told, disclosedBy) => {
  const seen = [];
  const session = disclosureSession(Session, { told });
  const report = await runCodeReview({ session, pr: PR, diff: DIFF, judge: combinedJudge(disclosedBy, seen) });
  return { session, report, seen };
};
const edits = (report) => report.findings.filter((f) => f.kind === 'edit_under_negative_requirement')
  .map((f) => [f.status, f.disclosureReason ?? null]);

test('Disclosure narrowed, combined route: a statement admitting it went against the rule, upheld, is FYI `disclosed`', async () => {
  const { session, report, seen } = await combined(WORDS.told, ADMITTED);
  assert.deepEqual(ledger.disclosureChallengeable({ repo: PR.repo, session, pr: PR, candidate: { ...BREACH,
    disclosedBy: ADMITTED } }), { challengeable: true, reason: null });
  assertNarrowed(disclosureRequests(seen), 'admitted');
  assert.deepEqual(disclosureRequests(seen)[0].challenge.items[0].candidate, { proposition: challenge.DISCLOSURE_PROPOSITION,
    instruction: [RULE], change: [EDIT], statement: ADMITTED });
  assert.deepEqual(edits(report), [['FYI', 'disclosed']]);
  assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: zeros, upheld: 1 });
});

test('Disclosure narrowed, combined route: a statement framing the edit as an improvement, refuted, stays DECIDE', async () => {
  const { session, report, seen } = await combined(IMPROVED, IMPROVEMENT);
  // Code's checks pass it exactly as they pass the admission: whether it says so is the challengers' judgment alone.
  assert.deepEqual(ledger.disclosureChallengeable({ repo: PR.repo, session, pr: PR, candidate: { ...BREACH,
    disclosedBy: IMPROVEMENT } }), { challengeable: true, reason: null });
  assertNarrowed(disclosureRequests(seen), 'improvement');
  assert.deepEqual(disclosureRequests(seen)[0].challenge.items[0].candidate.statement, IMPROVEMENT);
  assert.deepEqual(edits(report), [['DECIDE', null]]);
  assert.equal(report.sessionStatus, 'DECIDE');
  assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: { ...zeros, refuted: 1 }, upheld: 0 });
});

// ---- session-only route: a forbidden edit's `reportedBy` ----------------------------------------------------------------

const KEY = 'm33-disclosure-narrow';
const SESSION_VOTES = Object.freeze({ [R.ADMITS]: 'support', [R.WORDS.strength]: 'refute' });

async function claude(t, options) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-disclosure-narrow-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${R.SESSION}.jsonl`);
  await writeFile(file, R.claudeRows(options).map((r) => JSON.stringify(r)).join('\n') + '\n');
  return sessionFromLedger(redact(await sliceLineage([file], { cwd: '/repo' })).ledger, { sessionKey: KEY });
}
const textOf = (session, event) => session.textSpansOf(event, 'text').join('');
const idOf = (session, find) => session.events.find(find)?.id;
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
/** The motivating shape: the human ruled the naming coincidence out, the agent wrote it in, then said `said`. */
const forbiddenEdit = (session, said) => ({ text: 'The human ruled the coincidence out; the agent wrote it in.',
  instruction: receipt(idOf(session, (e) => e.kind === 'instruction' && textOf(session, e).includes(R.WORDS.constraint)),
    'instruction', R.WORDS.constraint),
  violation: receipt(idOf(session, (e) => e.kind === 'invocation' && e.operation === 'write'), 'code', R.WORDS.origin),
  reportedBy: receipt(idOf(session, (e) => e.kind === 'commentary' && textOf(session, e).includes(said)), 'commentary', said) });
const sessionJudge = (edits, seen) => async (request) => {
  seen.push(request);
  if (request.challenge) return { votes: request.challenge.items.flatMap((item) => {
    if (item.type === ledger.FORBIDDEN_EDIT_ITEM_TYPE) return [{ key: item.key, verdict: 'not-refuted',
      explanation: 'Synthetic: the instruction ruled it out.', receipts: [item.candidate.violation] }];
    return item.type === ledger.DISCLOSURE_ITEM_TYPE ? [disclosureVote(item, SESSION_VOTES)] : [];
  }) };
  const asked = `${request.system}${request.prompt}`.includes('"forbiddenEdits"');
  return { decisions: [], pivots: [], claims: [], requirements: [],
    ...(asked && request.window?.index === 0 ? { forbiddenEdits: edits } : {}) };
};
const sessionOnly = async (session, said) => {
  const seen = [];
  const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only',
    judge: sessionJudge([forbiddenEdit(session, said)], seen) });
  return { report, seen };
};
const rows = (report) => report.findings.filter((f) => f.kind === 'edit_under_negative_requirement')
  .map((f) => [f.status, f.breach ?? null, f.disclosureReason ?? null]);

test('Disclosure narrowed, session route: a statement admitting it went against the ask, upheld, is FYI `disclosed`', async (t) => {
  const session = await claude(t, { admits: true });
  const { report, seen } = await sessionOnly(session, R.ADMITS);
  assertNarrowed(disclosureRequests(seen), 'admits');
  assert.equal(disclosureRequests(seen)[0].challenge.items[0].candidate.statement.quote, R.ADMITS);
  assert.deepEqual(rows(report), [['FYI', 'wrote', 'disclosed']]);
  assert.equal(report.sessionStatus, 'FYI');
  assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: zeros, upheld: 1 });
});

test('Disclosure narrowed, session route: the breach reported as a strength, refuted, stays DECIDE', async (t) => {
  // The motivating recording: the human ruled the coincidence out, the agent wrote it in and then called it a strength.
  const session = await claude(t);
  const { report, seen } = await sessionOnly(session, R.WORDS.strength);
  assertNarrowed(disclosureRequests(seen), 'strength');
  assert.equal(disclosureRequests(seen)[0].challenge.items[0].candidate.statement.quote, R.WORDS.strength);
  assert.deepEqual(rows(report), [['DECIDE', 'wrote', null]]);
  assert.equal(report.sessionStatus, 'DECIDE');
  assert.deepEqual(report.counts.disclosures, { proposed: 1, rejected: { ...zeros, refuted: 1 }, upheld: 0 });
});

// ---- D64 wording (owner decision 2026-10-07): the proposers ask for, and the readers say, what the challengers judge ----

test('D64 wording: both proposers ask for the statement that the agent went against the instruction; readers say so', async () => {
  const prompt = await import('../src/prompt.js');
  const codeReviewPrompt = await import('../src/code-review-prompt.js');
  const story = await import('../../render/session-story.js');
  // Proposers: the session-only route's item 6 sentence and its contract rule (`reportedBy`), and the joint task's
  // sentence (`disclosedBy`), each the D64 wording's text and never the one it replaced.
  // D71 (S2): the session-only route's item 6 and its contract rule are the brief's step 4 and its contract member now
  // (review-agent.js SONAH_SESSION_REVIEW_AGENT), each asking for the statement that the agent went against the
  // instruction, never for one that told the human about the change.
  const { SONAH_SESSION_REVIEW_AGENT: brief } = await import('../src/review-agent.js');
  assert.equal(prompt.FORBIDDEN_TASK, undefined);
  assert.equal(prompt.FORBIDDEN_CONTRACT_RULES, undefined);
  assert.ok(brief.includes('reportedBy: an AGENT SAID, recorded after the change, that told the human the agent went\nagainst their instruction by it.'));
  assert.ok(!brief.includes('told the human about that change'));
  // The joint task's sentence is not exported: its request carries it once (m33-m4-disclosure.test.js "M4 bytes").
  const source = await readFile(new URL('../src/code-review-prompt.js', import.meta.url), 'utf8');
  assert.equal(source.split(DISCLOSURE_WORDS.texts.joint[1]).length, 2);
  assert.ok(!source.includes(DISCLOSURE_WORDS.texts.joint[0]));
  // The versions moved once each (DISCLOSURE_WORDS_VERSIONS), above stable ids'.
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
  // G2 moved it once more (CHOICE_REANCHOR_VERSIONS: prompt): the re-ask of a choice not to act whose existence check
  // refuted its words.
  assert.equal(CHOICE_REANCHOR_VERSIONS.prompt.before, SECOND_RELEASE_REVIEW_VERSIONS.prompt.after);
  assert.equal(prompt.PROMPT_VERSION, CHOICE_REANCHOR_VERSIONS.prompt.after);
  // M35 windowing moved it once more (WINDOWING_VERSIONS: codeReview).
  assert.equal(WINDOWING_VERSIONS.codeReview.before, DISCLOSURE_WORDS_VERSIONS.codeReview.after);
  // M36 phase 1 moved it once more (RECORDED_FACTS_VERSIONS: codeReview): the evidence it carries (D68).
  assert.equal(RECORDED_FACTS_VERSIONS.codeReview.before, WINDOWING_VERSIONS.codeReview.after);
  assert.equal(FORMAT_VERSIONS.codeReview.before, RECORDED_FACTS_VERSIONS.codeReview.after);
  // M36 phase 2 moved it once more (FORMAT_VERSIONS: codeReview): the window format (D68).
  // M36 phase 3 moved it once more (CONVERSATION_VERSIONS: codeReview): packed windows, carried failures, the evidence re-ask.
  assert.equal(CONVERSATION_VERSIONS.codeReview.before, FORMAT_VERSIONS.codeReview.after);
  assert.equal(D69_VERSIONS.codeReview.before, CONVERSATION_VERSIONS.codeReview.after);
  assert.equal(D69_REVIEW_VERSIONS.codeReview.before, D69_VERSIONS.codeReview.after);
  // D71 (S2) moved it once more (D71_BRIEF_VERSIONS: codeReview): the reviewer brief as the checklist.
  assert.equal(D71_BRIEF_VERSIONS.codeReview.before, D69_REVIEW_VERSIONS.codeReview.after);
  assert.equal(codeReviewPrompt.CODE_REVIEW_VERSION, D71_BRIEF_VERSIONS.codeReview.after);
  // M35 windowing moved the story once more (WINDOWING_VERSIONS: story).
  assert.equal(WINDOWING_VERSIONS.story.before, DISCLOSURE_WORDS_VERSIONS.story.after);
  // M36 phase 3 moved the story once more (CONVERSATION_VERSIONS: story): a step may hold several sessions.
  assert.equal(CONVERSATION_VERSIONS.story.before, WINDOWING_VERSIONS.story.after);
  // D71 (a) moved it once more (D71_READER_VERSIONS: story): no verdict.
  assert.equal(D71_READER_VERSIONS.story.before, CONVERSATION_VERSIONS.story.after);
  // D71 (S4) moved it once more (D71_PAGE_VERSIONS: story): a checklist ask as code published it.
  assert.equal(D71_PAGE_VERSIONS.story.before, D71_READER_VERSIONS.story.after);
  // S6 moved it once more (D71_FIX_READER_VERSIONS: story): a choice not to act marked.
  assert.equal(D71_FIX_READER_VERSIONS.story.before, D71_PAGE_VERSIONS.story.after);
  // D77 C moved it once more (REQUEST_STEPS_READER_VERSIONS: story): a step is one of your requests.
  assert.equal(REQUEST_STEPS_READER_VERSIONS.story.before, D71_FIX_READER_VERSIONS.story.after);
  // D79 moved it once more (ATTACHED_FILE_READER_VERSIONS: story): a file you attached belongs to its message's
  // request.
  assert.equal(ATTACHED_FILE_READER_VERSIONS.story.before, REQUEST_STEPS_READER_VERSIONS.story.after);
  // D79 moved it once more (REFUSALS_READER_VERSIONS: story): a command Claude Code refused did not run.
  assert.equal(REFUSALS_READER_VERSIONS.story.before, ATTACHED_FILE_READER_VERSIONS.story.after);
  // The D80 integration moved it once more (D80_READER_VERSIONS: story): a failed or stopped command's write is kept
  // apart, and a stopped command has one phrase.
  assert.equal(D80_READER_VERSIONS.story.before, REFUSALS_READER_VERSIONS.story.after);
  // D84 moved it once more (D84_OUTPUT_READER_VERSIONS: story): what it shows is masked.
  assert.equal(D84_OUTPUT_READER_VERSIONS.story.before, D80_READER_VERSIONS.story.after);
  // The column fix moved it once more (FIX_COLUMN_READER_VERSIONS: story): a decision a project instruction file
  // covers says the file it was referred from.
  assert.equal(FIX_COLUMN_READER_VERSIONS.story.before, D84_OUTPUT_READER_VERSIONS.story.after);
  // W1 B moved it once more (W1_READER_VERSIONS: story): a project file's rule of an edit is labelled as the file's.
  assert.equal(W1_READER_VERSIONS.story.before, FIX_COLUMN_READER_VERSIONS.story.after);
  // W2 moved it once more (W2_READER_VERSIONS: story): the agent's own earlier text that contradicts a claim says so.
  assert.equal(W2_READER_VERSIONS.story.before, W1_READER_VERSIONS.story.after);
  // The review of W4 moved it once more (W4_READER_VERSIONS: story): an ask no action followed says why it reads not
  // done in this session (W4 was reverted: W4_REVERT_READER_VERSIONS below).
  assert.equal(W4_READER_VERSIONS.story.before, W2_READER_VERSIONS.story.after);
  // D87 moved it once more (CODE_PASS_READER_VERSIONS: story): a review with a code pass lists what the code review found.
  assert.equal(CODE_PASS_READER_VERSIONS.story.before, W4_READER_VERSIONS.story.after);
  // The W4 revert moved it once more (W4_REVERT_READER_VERSIONS: story): W4's words beside an ask are gone with W4.
  assert.equal(W4_REVERT_READER_VERSIONS.story.before, CODE_PASS_READER_VERSIONS.story.after);
  // D88 moved it once more (JUDGMENT_FIRST_READER_VERSIONS: story): the judgment first, the rows not checked folded.
  assert.equal(JUDGMENT_FIRST_READER_VERSIONS.story.before, W4_REVERT_READER_VERSIONS.story.after);
  // The code step moved it once more (CODE_STEP_READER_VERSIONS: story): what the code review found, in order. It links
  // after D88 (renumbered at their merge).
  assert.equal(CODE_STEP_READER_VERSIONS.story.before, JUDGMENT_FIRST_READER_VERSIONS.story.after);
  // The review of the code step moved it once more (CODE_STEP_REVIEW_READER_VERSIONS: story): the footer counts paths
  // outside the working directory.
  assert.equal(CODE_STEP_REVIEW_READER_VERSIONS.story.before, CODE_STEP_READER_VERSIONS.story.after);
  // The judgment-first review moved it once more (JUDGMENT_FIRST_REVIEW_READER_VERSIONS: story): the claims every reader
  // lists, who decided by the one rule.
  assert.equal(JUDGMENT_FIRST_REVIEW_READER_VERSIONS.story.before, CODE_STEP_REVIEW_READER_VERSIONS.story.after);
  // The release review moved it once more (RELEASE_REVIEW_READER_VERSIONS: story): with the home folder as the
  // repository, the footer says only the session's files were read and counts the rest.
  assert.equal(RELEASE_REVIEW_READER_VERSIONS.story.before, JUDGMENT_FIRST_REVIEW_READER_VERSIONS.story.after);
  // The agentic code step's release item moved it once more (AGENTIC_READER_VERSIONS: story): an ask's status shown
  // beside what the code step tied to it, the session shown as loaded, and the code step's new report. It renders back
  // to the release review's.
  assert.equal(RELEASE_REVIEW_READER_VERSIONS.story.after, 'sonah.session-story/29');
  // The cleanup moved it once more (CLEANUP_READER_VERSIONS: story): no statement found to hold, no row shown in the
  // code, no claim found false and no all-clear footer.
  assert.equal(CLEANUP_READER_VERSIONS.story.before, AGENTIC_READER_VERSIONS.story);
  // D97 moved it once more (REPORT_MD_READER_VERSIONS: story): the story is the report .md.
  assert.equal(REPORT_MD_READER_VERSIONS.story.before, CLEANUP_READER_VERSIONS.story.after);
  assert.equal(story.STORY_VERSION, REPORT_MD_READER_VERSIONS.story.after);
  // Readers: the report .md and the page say what the challengers upheld, with the agent's own words.
  // D71 (a): said as what it is, never "shown for information".
  // D97: the page and the report .md: an edit against what you said that the agent told you about, and its words.
  const words = await import('../../render/report-words.js');
  assert.equal(words.REPORT_DISCLOSURE_WORDS.edit.disclosed, 'The agent told you about it.');
  assert.equal(words.REPORT_ITEM_WORDS.agentTold, 'The agent told you:');
});
