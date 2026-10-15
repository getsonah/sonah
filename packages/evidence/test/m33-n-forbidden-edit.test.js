// M33 N (C-06 "M33 forbidden edits", owner decision 2026-10-01). A session-only review's route for
// `edit_under_negative_requirement`: a change the agent (or a helper) made against an explicit instruction of the human.
// Why: the human says "ignore the naming coincidence with the old project", and the agent writes that origin story
// into the application file and reports it as a strength. That is a decision for the human, and session-only review had
// no route to report it.
//
// The narrative proposes one (`forbiddenEdits`, `sonah.narrative/14`); code checks it before any challenge, fail closed
// (ledger.js FORBIDDEN_EDIT_REJECTIONS); three challengers judge one proposition in code's fixed words in a run of its
// own, every profile (`sonah.challenge/11`); upheld → DECIDE; undone before the turn ended (code-proved) → FYI
// `self_corrected`; unsettled → withheld and `decide_unsettled`, never CLEAN.
//
// Synthetic recordings only (m33-n-forbidden-edit-rows.js), read through the real slicer, redactor and adapter, and
// hand-built sessions in the adapter's shape where the slicer keeps no such row. Deterministic judges that do what the
// words they are sent say: the narrative judge proposes only when its request asks for `forbiddenEdits`, and the
// challenger reads the forbidden-edit note, every human instruction the item names, and refutes when one of them allowed
// the change. No recording, no model call. Nothing prints.
import { readingStableIds } from './m35-windows-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as prompt from '../src/prompt.js';
import * as challenge from '../src/challenge.js';
import * as review from '../src/review.js';
import * as codeReviewPrompt from '../src/code-review-prompt.js';
import * as story from '../../render/session-story.js';
import { ownReceipt } from '../../cli/test/m33-fast-profile-fixture.js';
import { answerStorable } from '../../cli/src/answer-cache.js';
import * as R from './m33-n-forbidden-edit-rows.js';
import { STATUS_FACT_VERSIONS, beforeStatusFact, requestBeforeStatusFact } from './status-fact-fixture.js';
import { FORBIDDEN_EDIT_TEXT, FORBIDDEN_EDIT_VERSIONS, beforeForbiddenEdit, requestBeforeForbiddenEdit, MOVED_BY_M3, beforeM3 }
  from './m33-n-forbidden-edit-fixture.js';
import { HEDGED_CLAIMS_VERSIONS, requestBeforeHedgedClaims } from './h3-hedged-claims-fixture.js';
import { MOVED_BY_M4, MOVED_BY_M4_SESSION, DISCLOSURE_WORDS, beforeDisclosureWords } from './m33-m4-disclosure-fixture.js';
import { beforeSupportOrderText } from './m33-support-order-fixture.js';
import { INTEGRATION_VERSIONS, LABELS_MERGE_VERSIONS, STABLE_IDS_VERSIONS, DISCLOSURE_NARROW_VERSIONS, DISCLOSURE_WORDS_VERSIONS, WINDOWING_VERSIONS, RECORDED_FACTS_VERSIONS, FORMAT_VERSIONS, CONVERSATION_VERSIONS, D69_VERSIONS, D69_REVIEW_VERSIONS,
  beforeM36Labels, beforeM36Conversation, textBeforeS7, textBeforeFixColumn, textBeforeAsksFixes, textBeforeW1,
  textBeforeW2 }
  from './m33-integration-fixture.js';
import { adapt, twinOf, requestBeforeStableIds } from './stable-ids-fixture.js';

const forbidden = await import('../src/forbidden.js').catch(() => ({}));

const PROFILES = [null, 'm33-fast', 'm33-lean'];
const TYPE = 'forbidden-edit';
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// ---- recordings ----------------------------------------------------------------------------------------------------

async function load(t, rows, name = `${R.SESSION}.jsonl`, sessionKey = 'm33-n') {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-n-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  // C-01 event identity: registered, so a pin is checked rendered back to the positional ids (stable-ids-fixture.js).
  return adapt(redact(await sliceLineage([file], { cwd: '/repo' })).ledger, { sessionKey });
}
const claude = (t, options) => load(t, R.claudeRows(options));
const codex = (t, options) => load(t, R.codexRows(options), R.CODEX_NAME, 'm33-n-codex');

/** The ids the adapter gave: the first human instruction, the write of the application, the closing statement. */
const idOf = (session, test) => session.events.find(test)?.id;
const textOf = (session, event, field = 'text') => session.textSpansOf(event, field).join('');
const writeOf = (session) => idOf(session, (e) => e.kind === 'invocation' && e.operation === 'write');
const askOf = (session, words) => idOf(session, (e) => e.kind === 'instruction' && textOf(session, e).includes(words));
const sayingOf = (session, words) => idOf(session, (e) => e.kind === 'commentary' && textOf(session, e).includes(words));

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
/** The motivating proposal: the ask's constraint, the line the Write wrote, and the closing statement that reported it. */
const motivating = (session, over = {}) => ({
  text: 'The human said to ignore the naming coincidence; the agent wrote the origin story into the application.',
  instruction: receipt(askOf(session, R.WORDS.constraint), 'instruction', R.WORDS.constraint),
  violation: receipt(writeOf(session), 'code', R.WORDS.origin),
  reportedBy: receipt(sayingOf(session, R.WORDS.strength), 'commentary', R.WORDS.strength),
  ...over,
});

// ---- the deterministic judges --------------------------------------------------------------------------------------

/** The words of human instruction `id` as a request's evidence shows them (its inventory entry, the last one), or null. */
function instructionText(request, id) {
  const text = request.prompt;
  // D71 (S2): a human message's words are under "What the human asked" (the session points up to them): read the
  // occurrence of its header that is followed by a fence.
  for (let at = text.indexOf(`[${id}] HUMAN INSTRUCTION`); at >= 0; at = text.indexOf(`[${id}] HUMAN INSTRUCTION`, at + 1)) {
    const open = text.indexOf('\n<<<\n', at), close = text.indexOf('\n>>>', open + 5);
    const next = text.indexOf('\n[', at + 1);
    if (open < 0 || close < 0 || (next >= 0 && next < open)) continue;
    return text.slice(open + 5, close);
  }
  return null;
}
const LIFTS = /do mention|go ahead|you may/i;

/**
 * A challenger that does what its instructions say. On a forbidden-edit item it checks that it was sent the note and the
 * proposition, reads every human instruction the item names whole in the evidence it was given, refutes — citing it —
 * when one allowed the change, votes uncertain when one is missing from its evidence, and otherwise upholds, citing the
 * action's own words. `verdict(item)` overrides (null: cast no vote). Every other item is upheld on its own receipt.
 */
function challenger(verdict = null) {
  return (request) => ({ votes: request.challenge.items.flatMap((item) => {
    const chosen = verdict ? verdict(item) : undefined;
    if (chosen === null) return [];
    if (chosen === 'uncertain') return [{ key: item.key, verdict: 'uncertain', explanation: 'Synthetic.', receipts: [] }];
    // M33 brittleness M4 session route: an edit's proposed disclosure is its own item. This challenger refutes it unless
    // `verdict` says otherwise, citing the statement either way, so every edit here stays DECIDE unless a test asks to
    // uphold its disclosure (m33-m4-session-disclosure.test.js).
    if (item.type === 'disclosure') return [{ key: item.key, verdict: chosen ?? 'refuted', explanation: 'Synthetic.',
      receipts: [item.candidate.statement] }];
    if (item.type !== TYPE) return [{ key: item.key, verdict: chosen ?? 'not-refuted', explanation: 'Synthetic.',
      receipts: [ownReceipt(item.candidate)] }];
    assert.ok(request.system.includes(challenge.FORBIDDEN_EDIT_NOTE), 'the challenger is told how to judge it');
    assert.equal(item.candidate.proposition, challenge.FORBIDDEN_EDIT_PROPOSITION);
    for (const id of item.candidate.humanInstructionsBetween) {
      const words = instructionText(request, id);
      if (words === null) return [{ key: item.key, verdict: 'uncertain', explanation: 'Not shown.', receipts: [] }];
      if (LIFTS.test(words)) return [{ key: item.key, verdict: 'refuted', explanation: 'A later instruction allowed it.',
        receipts: [receipt(id, 'instruction', words)] }];
    }
    return [{ key: item.key, verdict: chosen ?? 'not-refuted', explanation: 'The instruction ruled it out.',
      receipts: [item.candidate.violation] }];
  }) });
}

/** The narrative judge: it proposes `edits` (a list, or a function of the request) only when its request asks for
 *  forbidden edits, and nothing else. `seen` receives every request, in call order. */
function judgeOf(edits, { verdict = null, seen = [], window = 0 } = {}) {
  const vote = challenger(verdict);
  return async (request) => {
    seen.push(request);
    if (request.challenge) return vote(request);
    const asked = `${request.system}${request.prompt}`.includes('"forbiddenEdits"');
    const proposed = typeof edits === 'function' ? edits(request) : request.window?.index === window ? edits : [];
    return { decisions: [], pivots: [], claims: [], requirements: [], ...(asked && proposed.length ? { forbiddenEdits: proposed } : {}) };
  };
}
// M35: the judge reads each request with its window's aliases written back as stable ids (m35-windows-fixture.js).
const reviewOf = (session, edits, { profile = null, verdict = null, seen = [], window = 0 } = {}) => reviewRun.runReview({
  session, pr: null, reviewScope: 'session-only', ...(profile ? { speedProfile: profile } : {}),
  judge: readingStableIds(session, judgeOf(edits, { verdict, seen, window }), { speedProfile: profile ?? undefined }) });

const edits = (report) => report.findings.filter((f) => f.kind === 'edit_under_negative_requirement');
const outcomes = (report) => edits(report).map((f) => [f.receipts.map((r) => `${r.eventId}/${r.role}`).join('+'), f.status,
  f.breach ?? null, f.disclosureReason ?? null]);
const part = (report, name = 'T1') => report.parts.find((p) => p.part === name);
const forbiddenLabels = (seen) => seen.filter((r) => r.challenge && r.label.includes(':forbidden')).map((r) => r.label);
const zeros = (vocabulary) => Object.fromEntries(vocabulary.map((token) => [token, 0]));
const withheldBy = (report) => Object.entries(report.counts.forbiddenEdits?.withheld ?? {}).filter(([, n]) => n > 0)
  .map(([reason, n]) => `${reason}:${n}`);

// ---- the closed vocabularies and versions ----------------------------------------------------------------------------

test('M33 N: closed vocabularies in the constants place; the existing kind; the versions moved', () => {
  assert.deepEqual(ledger.FORBIDDEN_EDIT_REJECTIONS, ['malformed', 'instruction_not_human', 'instruction_context',
    'instruction_ungrounded', 'instruction_partial', 'violation_not_action', 'violation_carried', 'violation_ungrounded',
    'violation_not_written', 'actor_unlinked', 'violation_not_landed', 'not_after', 'history_partial']);
  // M33 brittleness M4 session route: the agent's statement is the edit's proposed disclosure, counted by the one
  // disclosure vocabulary of both routes; its own vocabulary is gone.
  assert.equal(ledger.FORBIDDEN_EDIT_REPORT_REJECTIONS, undefined);
  // M33 brittleness M3: a removal is a breach too (its review held `deleted` back).
  assert.deepEqual(ledger.FORBIDDEN_EDIT_BREACHES, ['wrote', 'ran', 'removed']);
  for (const list of [ledger.FORBIDDEN_EDIT_REJECTIONS, ledger.DISCLOSURE_REJECTIONS, ledger.FORBIDDEN_EDIT_BREACHES])
    assert.ok(Object.isFrozen(list));
  assert.equal(ledger.FORBIDDEN_EDIT_ITEM_TYPE, TYPE);
  // The existing kind and disclosure vocabulary: nothing added.
  assert.deepEqual(ledger.SUPPORTED_FINDING_KINDS, ['edit_under_negative_requirement', 'claim_contradicted', 'code_issue']);
  // M33 brittleness M4 added `disclosed` after them: an upheld disclosure of an edit, never a role.
  assert.deepEqual(ledger.DISCLOSURE_REASONS, ['self_corrected', 'helper_internal', 'disclosed']);
  // The status fact, H3 and M33 brittleness M3 each moved both from M33 N's (status-fact-fixture.js,
  // h3-hedged-claims-fixture.js, m33-n-forbidden-edit-fixture.js): M33 N's are the `before` of all three.
  assert.equal(STATUS_FACT_VERSIONS.prompt.before, FORBIDDEN_EDIT_VERSIONS.prompt.after);
  assert.equal(STATUS_FACT_VERSIONS.challenge.before, FORBIDDEN_EDIT_VERSIONS.challenge.after);
  assert.equal(FORBIDDEN_EDIT_VERSIONS.prompt.after, HEDGED_CLAIMS_VERSIONS.prompt.before);
  assert.equal(FORBIDDEN_EDIT_VERSIONS.challenge.after, HEDGED_CLAIMS_VERSIONS.challenge.before);
  assert.equal(FORBIDDEN_EDIT_VERSIONS.prompt.after, MOVED_BY_M3.versions.prompt[0]);
  assert.equal(FORBIDDEN_EDIT_VERSIONS.challenge.after, MOVED_BY_M3.versions.challenge[0]);
  // M33 brittleness M4 moved the challenge version once more on its branch (/12 -> /13), and M4's session route once more
  // (/13 -> /14).
  assert.equal(MOVED_BY_M4.versions.challenge[0], MOVED_BY_M3.versions.challenge[1]);
  assert.equal(MOVED_BY_M4_SESSION.versions.challenge[0], MOVED_BY_M4.versions.challenge[1]);
  // M33 integration: one version above every branch's own carries all of them.
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
  // D71 (S2) moved it once more (/26 -> /27): the reviewer brief as the checklist.
  assert.equal(D69_REVIEW_VERSIONS.prompt.after, 'sonah.narrative/26');
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory.
  assert.equal(prompt.PROMPT_VERSION, 'sonah.narrative/36');
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
  // D71 (S2) moved it once more (/23 -> /24): one proposition per item on the session route.
  assert.equal(D69_REVIEW_VERSIONS.challenge.after, 'sonah.challenge/23');
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
  assert.equal(challenge.CHALLENGE_PROFILE.version, 'sonah.challenge/42');
  assert.equal(challenge.FORBIDDEN_EDIT_PROPOSITION, 'the human\'s quoted instruction forbade what the quoted action did, '
    + 'and no later human instruction recorded before the action lifted it');
  // M33 brittleness M4 session route: no "The agent told you" line from a statement code only verified.
  // W1 B: and a rule the project's instruction file holds (`file`).
  assert.deepEqual(Object.keys(review.FORBIDDEN_EDIT_WORDS).sort(), ['file', 'instruction', 'ran', 'removed', 'reverted',
    'wrote']);
  assert.equal(review.FORBIDDEN_EDIT_WORDS.instruction, 'You said');
  assert.equal(review.FORBIDDEN_EDIT_WORDS.wrote, 'The agent wrote');
  assert.equal(review.FORBIDDEN_EDIT_WORDS.removed, 'The agent removed');
  // D64 wording (owner decision 2026-10-07): an upheld disclosure's statement says what the challengers upheld.
  // W1 B: and a project instruction file's words, labelled as the file's.
  assert.deepEqual(story.STORY_FORBIDDEN_EDIT_LABELS, { instruction: 'You said', wrote: 'The agent wrote', ran: 'The agent ran',
    removed: 'The agent removed', reported: 'The agent told you it went against your instruction',
    file: "The project's instruction file" });
  // One reader word per breach, in both readers.
  for (const breach of ledger.FORBIDDEN_EDIT_BREACHES) {
    assert.equal(typeof review.FORBIDDEN_EDIT_WORDS[breach], 'string', breach);
    assert.equal(typeof story.STORY_FORBIDDEN_EDIT_LABELS[breach], 'string', breach);
  }
  // Every withheld cause has its one rendered sentence.
  assert.deepEqual(Object.keys(review.WITHHELD_SENTENCE).sort(), [...review.WITHHELD_CAUSES].sort());
  assert.ok(review.WITHHELD_CAUSES.includes(ledger.FORBIDDEN_WITHHELD_CAUSE));
});

// ---- the motivating shape --------------------------------------------------------------------------------------------

test('M33 N Claude Code: "ignore the X", then a Write of X reported as a strength → DECIDE, every profile', async (t) => {
  const session = await claude(t);
  for (const profile of PROFILES) {
    const label = String(profile);
    const seen = [];
    const report = await reviewOf(session, [motivating(session)], { profile, seen });
    assert.deepEqual(outcomes(report), [[`${askOf(session, R.WORDS.constraint)}/instruction+${writeOf(session)}/code`, 'DECIDE', 'wrote', null]], label);
    const [finding] = edits(report);
    assert.equal(finding.origin, 'session-review', label);
    assert.equal(finding.scope, 'session-effect', label);
    assert.equal(finding.anchor, null, label);
    assert.deepEqual(finding.receipts.map((r) => r.quote), [R.WORDS.constraint, R.WORDS.origin], label);
    // The agent's statement is never among the receipts, and never published as verified only (M33 brittleness M4 session
    // route): it is the edit's proposed disclosure, its own item, refuted by this challenger — so no `disclosedBy`.
    assert.equal(Object.hasOwn(finding, 'reportedBy'), false, label);
    assert.equal(Object.hasOwn(finding, 'disclosedBy'), false, label);
    assert.equal(finding.receipts.some((r) => r.role === 'commentary'), false, label);
    assert.match(finding.title, /^Did what you said not to: /, label);
    assert.equal(report.sessionStatus, 'DECIDE', label);
    assert.equal(report.reviewStatus, 'DECIDE', label);
    assert.equal(report.sessionReview, 'complete', label);
    assert.deepEqual(part(report).reasons, ['finding_decide'], label);
    // Its own three-pass run in every profile: three calls for one item.
    assert.deepEqual(forbiddenLabels(seen), ['challenge:w1:forbidden:b1:p1', 'challenge:w1:forbidden:b1:p2',
      'challenge:w1:forbidden:b1:p3'], label);
    assert.deepEqual(report.counts.forbiddenEdits, { proposed: 1, withheld: zeros(ledger.FORBIDDEN_EDIT_REJECTIONS),
      challenged: { upheld: 1, refuted: 0, unsettled: 0, unexecuted: 0 }, reverted: 0 }, label);
    assert.deepEqual(report.windowResults[0].forbiddenEdits, report.counts.forbiddenEdits, label);
    // Its disclosure, asked in its own three-pass run after the edit's, and refuted: counted, never FYI.
    assert.deepEqual(seen.filter((r) => r.challenge && r.label.includes(':disclosure')).map((r) => r.label),
      ['challenge:w1:disclosure:b1:p1', 'challenge:w1:disclosure:b1:p2', 'challenge:w1:disclosure:b1:p3'], label);
    assert.deepEqual(report.counts.disclosures, { proposed: 1,
      rejected: { ...zeros(ledger.DISCLOSURE_REJECTIONS), refuted: 1 }, upheld: 0 }, label);
    // The challenge record holds the item as code built it: the proposition, the two receipts, no model prose.
    const result = report.windowResults[0].challenge.results.find((r) => r.type === TYPE);
    // M33 brittleness M3: and what the violation is, in code's closed word.
    // M33 brittleness M4 session route: never the agent's statement — that is judged as a disclosure item of its own.
    assert.deepEqual(Object.keys(result.candidate).sort(), ['breach', 'humanInstructionsBetween', 'instruction', 'proposition',
      'violation'], label);
    assert.equal(result.candidate.breach, 'wrote', label);
    assert.deepEqual(result.candidate.humanInstructionsBetween, [], label);
    assert.equal(result.survived, true, label);
  }
});

test('M33 N Codex: an apply_patch of the file ruled out and a command ruled out → DECIDE, wrote and ran', async (t) => {
  const session = await codex(t);
  const ask = askOf(session, R.CODEX_WORDS.lockConstraint);
  const patch = idOf(session, (e) => e.kind === 'invocation' && e.operation === 'edit');
  const publish = idOf(session, (e) => e.kind === 'invocation' && e.operation === 'command');
  const lock = { text: 'The lockfile was ruled out and edited.', instruction: receipt(ask, 'instruction', R.CODEX_WORDS.lockConstraint),
    violation: receipt(patch, 'code', R.CODEX_WORDS.added.trim()) };
  const pub = { text: 'Publishing was ruled out and run.', instruction: receipt(ask, 'instruction', R.CODEX_WORDS.publishConstraint),
    violation: receipt(publish, 'action', R.CODEX_WORDS.publish), reportedBy: null };
  for (const profile of PROFILES) {
    const report = await reviewOf(session, [lock, pub], { profile });
    assert.deepEqual(outcomes(report).sort(), [[`${ask}/instruction+${patch}/code`, 'DECIDE', 'wrote', null],
      [`${ask}/instruction+${publish}/action`, 'DECIDE', 'ran', null]].sort(), String(profile));
    assert.equal(report.sessionStatus, 'DECIDE', String(profile));
  }
});

// ---- a later human instruction ---------------------------------------------------------------------------------------

test('M33 N: a later human instruction that lifts the constraint is shown to the challengers, and no DECIDE follows', async (t) => {
  for (const between of ['lift', 'queuedLift']) {
    const session = await claude(t, { between });
    const lift = askOf(session, R.WORDS.lift);
    for (const profile of PROFILES) {
      const label = `${between}, ${profile}`;
      const seen = [];
      // A narrative that missed the lift proposes it anyway; code names the lift; the challengers read it and refute.
      const report = await reviewOf(session, [motivating(session)], { profile, seen });
      assert.deepEqual(edits(report), [], label);
      assert.notEqual(report.sessionStatus, 'DECIDE', label);
      assert.equal(report.sessionStatus, 'CLEAN', `${label}: a refutation is a completed check`);
      const sent = seen.filter((r) => r.challenge && r.label.includes(':forbidden'));
      assert.ok(sent.length >= 3, label);
      for (const request of sent) {
        assert.deepEqual(request.challenge.items[0].candidate.humanInstructionsBetween, [lift], label);
        assert.equal(instructionText(request, lift), R.WORDS.lift, `${label}: the lift is shown whole`);
      }
      assert.deepEqual(report.counts.forbiddenEdits.challenged, { upheld: 0, refuted: 1, unsettled: 0, unexecuted: 0 }, label);
    }
  }
  // A later instruction on something else is shown too, and lifts nothing: DECIDE.
  const session = await claude(t, { between: 'unrelated' });
  const report = await reviewOf(session, [motivating(session)]);
  assert.equal(edits(report).length, 1);
  assert.equal(report.sessionStatus, 'DECIDE');
  const result = report.windowResults[0].challenge.results.find((r) => r.type === TYPE);
  assert.deepEqual(result.candidate.humanInstructionsBetween, [askOf(session, R.WORDS.unrelated)]);
});

// ---- code checks, fail closed -----------------------------------------------------------------------------------------

test('M33 N: an action recorded before the instruction is rejected by code (not_after) and never asked', async (t) => {
  const session = await claude(t, { order: 'before' });
  const late = askOf(session, R.WORDS.late);
  for (const profile of PROFILES) {
    const seen = [];
    const report = await reviewOf(session, [motivating(session, { instruction: receipt(late, 'instruction',
      'ignore the naming coincidence with the old project.') })],
      { profile, seen });
    assert.deepEqual(edits(report), [], String(profile));
    assert.deepEqual(forbiddenLabels(seen), [], `${profile}: no challenger is asked`);
    assert.deepEqual(withheldBy(report), ['not_after:1'], String(profile));
    assert.equal(report.withheld.proposals, 1, String(profile));
    assert.equal(report.withheld.causes[ledger.FORBIDDEN_WITHHELD_CAUSE], 1, String(profile));
    assert.equal(report.sessionStatus, 'CLEAN', `${profile}: a withheld proposal is a check that ran`);
  }
});

/** A Claude Code Agent hand-off to helper `w`, as the adapter emits it: the human's ask, the helper's brief (an
 *  instruction event with agent authority), the helper's write, and the parent's statement. `linked` false drops the
 *  verified child link. */
function helperSession({ linked = true, briefSays = 'SYNTHETIC_N_BRIEF: never mention the old project in the draft.' } = {}) {
  const TEXT = { ask: R.WORDS.ask, plan: 'SYNTHETIC_N_PLAN: handing the draft to a helper.', input: briefSays, brief: briefSays,
    body: R.BODY, helperSaid: 'SYNTHETIC_N_HELPER: drafted it.', report: 'SYNTHETIC_N_REPORT: drafted it.',
    said: `Done. ${R.WORDS.strength}`, other: 'SYNTHETIC_N_OTHER: I also looked at it.' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
  const T1 = { turn: 'T1' }, H = { childId: 'w', turn: 'T1' };
  const extent = { chars: R.BODY.length, lines: 6, truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' };
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    { id: 'C1', kind: 'commentary', phase: 'working', beforeInvocation: 'D1', text: whole('plan'), ...T1 },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Agent', operation: 'delegate', paths: [], command: [],
      input: whole('input'), changes: [], ...T1 },
    { id: 'child:w:I1', kind: 'instruction', authority: 'agent', supersedes: [], text: whole('brief'), ...H },
    { id: 'child:w:A1', kind: 'invocation', callKey: 'child:w:A1', tool: 'create', operation: 'write', paths: [{ path: R.PATH }],
      command: [], input: [], changes: [{ path: R.PATH, before: [], after: whole('body'), diff: [], extent }], ...H },
    { id: 'child:w:A1-r', kind: 'observation', invocation: 'child:w:A1', callKey: 'child:w:A1', phase: 'terminal',
      result: 'succeeded', terminalStatusProven: true, exitCode: null, output: [], sourceOfResult: 'native', ...H },
    { id: 'child:w:C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('helperSaid'), ...H },
    { id: 'D1-r', kind: 'observation', invocation: 'D1', callKey: 'D1', phase: 'terminal', result: 'succeeded',
      terminalStatusProven: true, exitCode: null, output: whole('report'), sourceOfResult: 'native', ...T1 },
    { id: 'C2', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'), ...T1 },
  ].map((event, sequence) => ({ ...event, sequence }));
  const children = linked ? [{ assignmentEvent: 'D1', childId: 'w', childSession: 'm33-n-helper/child:w',
    sessionKey: 'm33-n-helper/child:w', relation: 'spawn', state: 'verified', historyStart: null }] : [];
  return new Session({ sessionKey: 'm33-n-helper', adapter: 'claude', blobs: { ...TEXT }, events, children });
}

/** A Claude Code session in the adapter's shape whose first human instruction is a file the human attached (M34 labels:
 *  `human` + `attached`, an @-mentioned file's content — material the human supplied, not words the human said), then
 *  the ask and the motivating Write. */
function contextSession() {
  const TEXT = { context: '# Notes\nNever mention the old project anywhere.\n', ask: R.WORDS.first, body: R.BODY };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
  const extent = { chars: R.BODY.length, lines: 6, truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' };
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], markers: ['attached'], text: whole('context'), turn: 'T1' },
    { id: 'I2', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), turn: 'T2' },
    { id: 'A2-0', kind: 'invocation', callKey: 'A2-0', tool: 'create', operation: 'write', paths: [{ path: R.PATH }], command: [],
      input: [], changes: [{ path: R.PATH, before: [], after: whole('body'), diff: [], extent }], turn: 'T2' },
    { id: 'A2-0-r', kind: 'observation', invocation: 'A2-0', callKey: 'A2-0', phase: 'terminal', result: 'succeeded',
      terminalStatusProven: true, exitCode: null, output: [], sourceOfResult: 'native', turn: 'T2' },
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: 'm33-n-context', adapter: 'claude', blobs: { ...TEXT }, events });
}

test('M33 N: an instruction quote from harness context or a helper brief is rejected by code, never asked', async (t) => {
  const violationOf = (id) => receipt(id, 'code', R.WORDS.origin);
  const cases = [];
  // Codex harness context, through the real slicer: a context element kept as a user message. M5: the slicer reads no instruction from it at all (a rollout with no typed human channel: only top-level
  // elements, set aside by structure), so no receipt can name it; the decision is declared as a counted gap.
  const cx = await codex(t, { context: true });
  assert.equal(askOf(cx, 'Never touch'), undefined, 'harness context is no instruction event');
  assert.deepEqual((cx.adapterGaps ?? []).filter((g) => g.channel === 'instructions' && g.code === 'incomplete_inventory')
    .map((g) => g.count), [1]);
  // Claude Code harness context, in the adapter's shape.
  const cc = contextSession();
  cases.push(['claude context', cc, { text: 't', instruction: receipt('I1', 'instruction', 'Never mention the old project anywhere.'),
    violation: violationOf('A2-0') }, 'instruction_context', 0]);
  // M35: a helper is a session of its own. M36 phase 3 (D68 K): small, it shares its parent's window (the first), under
  // its own heading, and an edit of its is proposed there.
  // A helper's brief: its own instruction event, recorded with agent authority.
  const hs = helperSession();
  cases.push(['helper brief', hs, { text: 't', instruction: receipt('child:w:I1', 'instruction', 'never mention the old project in the draft.'),
    violation: violationOf('child:w:A1') }, 'instruction_not_human', 0]);
  // The parent's hand-off brief, cited as an instruction: an action, never a human's.
  cases.push(['hand-off brief', hs, { text: 't', instruction: receipt('D1', 'instruction', 'never mention the old project in the draft.'),
    violation: violationOf('child:w:A1') }, 'instruction_not_human', 0]);
  // The agent's own words.
  cases.push(['agent words', hs, { text: 't', instruction: receipt('C1', 'instruction', 'handing the draft to a helper.'),
    violation: violationOf('child:w:A1') }, 'instruction_not_human', 0]);
  for (const [label, session, edit, reason, window] of cases)
    for (const profile of PROFILES) {
      const seen = [];
      const report = await reviewOf(session, [edit], { profile, seen, window });
      assert.deepEqual(edits(report), [], `${label}, ${profile}`);
      assert.deepEqual(forbiddenLabels(seen), [], `${label}, ${profile}`);
      assert.deepEqual(withheldBy(report), [`${reason}:1`], `${label}, ${profile}`);
      assert.notEqual(report.sessionStatus, 'DECIDE', `${label}, ${profile}`);
    }
  // The same helper write against the HUMAN's ask: a linked helper's action is DECIDE; an unlinked one is never.
  const human = { text: 't', instruction: receipt('I1', 'instruction', R.WORDS.constraint), violation: violationOf('child:w:A1') };
  // M35: proposed in the helper's own session, whose window's inventory holds the human's ask (M36 phase 3: the shared
  // first window).
  assert.deepEqual(outcomes(await reviewOf(hs, [human], { window: 0 })), [['I1/instruction+child:w:A1/code', 'DECIDE', 'wrote', null]]);
  const unlinked = await reviewOf(helperSession({ linked: false }), [human], { window: 0 });
  assert.deepEqual(edits(unlinked), []);
  assert.deepEqual(withheldBy(unlinked), ['actor_unlinked:1']);
});

test('M33 N: paraphrased quotes are rejected by strict search — no W3-3 snap — and quotes outside what was done too', async (t) => {
  const session = await claude(t);
  const write = writeOf(session);
  // C-01 event identity: the ask's and the result's events, found by what they are, never by a positional id.
  const ask = askOf(session, R.WORDS.constraint);
  const cases = [
    ['paraphrased instruction', { instruction: receipt(ask, 'instruction', 'Ignore the name coincidence with the old project.') },
      'instruction_ungrounded'],
    // One space more than the record holds: the near-miss repair would snap it; this route never does.
    ['near-miss instruction', { instruction: receipt(ask, 'instruction', 'Ignore the naming  coincidence with the old project.') },
      'instruction_ungrounded'],
    ['paraphrased violation', { violation: receipt(write, 'code', 'Sonah came from my old project Sonar.') }, 'violation_ungrounded'],
    ['near-miss violation', { violation: receipt(write, 'code', `${R.WORDS.origin} `) }, 'violation_ungrounded'],
    ['the write\'s path', { violation: receipt(write, 'action', R.PATH) }, 'violation_not_written'],
    ['an instruction id that is no event', { instruction: receipt('I9', 'instruction', R.WORDS.constraint) }, 'instruction_ungrounded'],
    ['a result cited as the action', { violation: receipt(session.observationFor(write).id, 'code', 'File created successfully') },
      'violation_not_action'],
    ['a quote over 120 characters', { instruction: receipt(ask, 'instruction', R.WORDS.ask.repeat(2)) }, 'malformed'],
  ];
  for (const [label, over, reason] of cases) {
    const seen = [];
    const report = await reviewOf(session, [motivating(session, over)], { seen });
    assert.deepEqual(edits(report), [], label);
    assert.deepEqual(forbiddenLabels(seen), [], label);
    assert.deepEqual(withheldBy(report), [`${reason}:1`], label);
  }
  // The same quote, grounded strictly, is asked and published.
  assert.equal(edits(await reviewOf(session, [motivating(session)])).length, 1);
});

test('M33 N: a quote of the text an edit replaced is not what it wrote (M3: it is what it removed); a failed write never landed', () => {
  const TEXT = { ask: R.WORDS.ask, before: `${R.WORDS.origin}\n`, after: 'We build review tools.\n' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
  const extent = (n) => ({ chars: n, lines: 1, truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'edit-text' });
  const make = (result) => new Session({ sessionKey: 'm33-n-before', blobs: { ...TEXT }, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), turn: 'T1' },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'edit', operation: 'edit', paths: [{ path: R.PATH }], command: [], input: [],
      changes: [{ path: R.PATH, before: whole('before'), after: whole('after'), diff: [], extent: extent(23), beforeExtent: extent(74) }],
      turn: 'T1' },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result, terminalStatusProven: true,
      exitCode: null, output: [], sourceOfResult: 'native', turn: 'T1' },
  ].map((event, sequence) => ({ ...event, sequence })) });
  const sourceMap = (session) => Object.fromEntries(session.events.map((e) => [e.id, session.sourcesFor(e)]));
  const read = (session, violation) => forbidden.readForbiddenEdit({ text: 't', instruction: receipt('I1', 'instruction', R.WORDS.constraint),
    violation }, { session, sourceMap: sourceMap(session) });
  const ok = make('succeeded');
  // M33 brittleness M3: the replaced text the edit took out is a removal — never what it wrote.
  assert.equal(read(ok, receipt('A1', 'code', R.WORDS.origin)).edit.breach, 'removed');
  assert.equal(read(ok, receipt('A1', 'code', 'We build review tools.')).edit.breach, 'wrote');
  assert.deepEqual(read(make('failed'), receipt('A1', 'code', R.WORDS.origin)), { withheld: 'violation_not_landed' });
  assert.deepEqual(read(make('failed'), receipt('A1', 'code', 'We build review tools.')), { withheld: 'violation_not_landed' });
  assert.deepEqual(read(make('cancelled'), receipt('A1', 'code', 'We build review tools.')), { withheld: 'violation_not_landed' });
});

test('M33 N: a human instruction between them whose words are not all recorded makes the history partial', () => {
  const TEXT = { lead: 'SYNTHETIC_N_LEAD: hello.', ask: R.WORDS.ask, middle: 'SYNTHETIC_N_MIDDLE: also add a heading.', body: R.BODY };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
  const extent = { chars: R.BODY.length, lines: 6, truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' };
  /** C0 (the agent's), I1 (the ask), I2 (a later ask, `middle` over its fields), A2 (the write). */
  const session = (middle = {}, gaps = []) => {
    const s = new Session({ sessionKey: 'm33-n-partial', blobs: { ...TEXT }, events: [
      { id: 'C0', kind: 'commentary', phase: 'working', beforeInvocation: null, text: whole('lead'), turn: 'T0' },
      { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), turn: 'T1' },
      { id: 'I2', kind: 'instruction', authority: 'human', supersedes: [], text: whole('middle'), turn: 'T2' },
      { id: 'A2', kind: 'invocation', callKey: 'A2', tool: 'create', operation: 'write', paths: [{ path: R.PATH }], command: [], input: [],
        changes: [{ path: R.PATH, before: [], after: whole('body'), diff: [], extent }], turn: 'T2' },
      // M33 N repair: its typed success — an action not proved to have landed is withheld before this check.
      { id: 'A2-r', kind: 'observation', invocation: 'A2', callKey: 'A2', phase: 'terminal', result: 'succeeded',
        terminalStatusProven: true, exitCode: null, output: [], sourceOfResult: 'native', turn: 'T2' },
    ].map((event, sequence) => ({ ...event, sequence, ...(event.id === 'I2' ? middle : {}) })) });
    s.adapterGaps = gaps;
    return s;
  };
  const item = { text: 't', instruction: receipt('I1', 'instruction', R.WORDS.constraint), violation: receipt('A2', 'code', R.WORDS.origin) };
  const read = (s) => forbidden.readForbiddenEdit(item, { session: s,
    sourceMap: Object.fromEntries(s.events.map((e) => [e.id, s.sourcesFor(e)])) });
  assert.deepEqual(read(session()).edit.between, ['I2']);
  // Its words withheld by redaction, or recorded in pieces: what is missing may be the lift.
  assert.deepEqual(read(session({ omitted: true, redacted: true })), { withheld: 'history_partial' });
  assert.deepEqual(read(session({ text: [...whole('middle'), ...whole('lead')] })), { withheld: 'history_partial' });
  // A loss of the human instruction channel that names no event could hide a later instruction too…
  const gap = { code: 'incomplete_inventory', channel: 'instructions', scope: 'session' };
  assert.deepEqual(read(session({}, [{ ...gap, count: 1 }])), { withheld: 'history_partial' });
  // …and so could one located from the instruction through the action…
  assert.deepEqual(read(session({}, [{ ...gap, count: 1, eventIds: ['I2'] }])), { withheld: 'history_partial' });
  // …but one located before the instruction cannot.
  assert.deepEqual(read(session({}, [{ ...gap, count: 1, eventIds: ['C0'] }])).edit.between, ['I2']);
  // A root event that cannot be placed fails closed.
  const unplaced = session();
  unplaced.events.push({ id: 'C9', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('lead'), turn: 'T2' });
  assert.equal(forbidden.humanInstructionsBetween(unplaced, 1, 3).complete, false);
  assert.equal(forbidden.humanInstructionsBetween(session(), 1, 3).complete, true);
  // The instruction itself recorded in pieces: what it ruled out may be in what is missing.
  assert.deepEqual(forbidden.readForbiddenEdit({ ...item }, { session: (() => {
    const s = session();
    s.events[1].text = [...whole('ask'), ...whole('lead')];
    return s;
  })(), sourceMap: Object.fromEntries(session().events.map((e) => [e.id, session().sourcesFor(e)])) }), { withheld: 'instruction_partial' });
});

test('M33 N, M35: no action is carried into a later window; its agent statement is checked apart', async (t) => {
  const session = await claude(t, { compacted: true });
  const write = writeOf(session);
  // M35: a compaction splits no window and no action is ever carried, so the write is reviewed in its one window only
  // (`violation_carried` stays in the closed vocabulary, unreachable).
  assert.equal(reviewRun.planWindowRequests({ session, reviewScope: 'session-only' }).windows.length, 1);
  // An agent statement that is no later than the action, or that does not ground, is never asked as a disclosure: counted
  // by the one disclosure vocabulary of both routes (M33 brittleness M4 session route); the edit goes on, DECIDE.
  const early = await reviewOf(session, [motivating(session, { reportedBy: receipt(sayingOf(session, R.WORDS.plan), 'commentary', R.WORDS.plan) })]);
  assert.deepEqual(outcomes(early), [[`${askOf(session, R.WORDS.constraint)}/instruction+${write}/code`, 'DECIDE', 'wrote', null]]);
  assert.equal(Object.hasOwn(edits(early)[0], 'disclosedBy'), false);
  assert.equal(early.counts.disclosures.rejected.not_later, 1);
  const ungrounded = await reviewOf(session, [motivating(session, { reportedBy: receipt(sayingOf(session, R.WORDS.strength), 'commentary',
    'A strength: it tells the story.') })]);
  assert.equal(ungrounded.counts.disclosures.rejected.ungrounded, 1);
  assert.equal(edits(ungrounded)[0].status, 'DECIDE');
});

// ---- undone in the same turn -----------------------------------------------------------------------------------------

test('M33 N: a change undone later in the same turn publishes FYI self_corrected; anything less stays DECIDE', async (t) => {
  const same = await claude(t, { revert: 'same' });
  const undo = idOf(same, (e) => e.kind === 'invocation' && e.operation === 'edit');
  for (const profile of PROFILES) {
    const report = await reviewOf(same, [motivating(same)], { profile });
    assert.deepEqual(outcomes(report), [[`${askOf(same, R.WORDS.constraint)}/instruction+${writeOf(same)}/code`, 'FYI', 'wrote',
      'self_corrected']], String(profile));
    const [finding] = edits(report);
    assert.deepEqual([finding.revertedBy.eventId, finding.revertedBy.role, finding.revertedBy.quote], [undo, 'action', R.PATH]);
    assert.equal(report.sessionStatus, 'FYI', String(profile));
    assert.deepEqual(part(report).reasons, ['finding_fyi'], String(profile));
    assert.equal(report.counts.forbiddenEdits.reverted, 1, String(profile));
    const md = review.renderReview(report);
    assert.ok(md.includes(`\` · ${review.FORBIDDEN_EDIT_REVERTED_TAG}`) && !md.includes('· FYI'), String(profile));
    assert.ok(md.includes(review.FORBIDDEN_EDIT_WORDS.reverted), String(profile));
    const told = story.renderSessionStory(same, report);
    assert.ok(told.includes('## Edits against what you said') && !/## (Worth a look|Needs your decision)/.test(told), String(profile));
    assert.ok(told.includes(story.STORY_SENTENCES.forbiddenEditReverted), String(profile));
  }
  // Undone only after a human prompt queued in between: the correction was asked for — DECIDE.
  const asked = await claude(t, { revert: 'afterQueued' });
  assert.deepEqual(outcomes(await reviewOf(asked, [motivating(asked)])).map((o) => o[1]), ['DECIDE']);
  // Undone only in the next request: not before the turn ended — DECIDE.
  const later = await claude(t, { revert: 'nextTurn' });
  assert.deepEqual(outcomes(await reviewOf(later, [motivating(later)])).map((o) => o[1]), ['DECIDE']);
  // Only part of the line removed: the quoted text is never shown gone — DECIDE.
  const partial = await claude(t, { revert: 'partial' });
  assert.deepEqual(outcomes(await reviewOf(partial, [motivating(partial)])).map((o) => o[1]), ['DECIDE']);
  // A command is never undone by this rule: it wrote no path.
  const cx = await codex(t);
  const pub = { text: 't', instruction: receipt(askOf(cx, 'do not run npm'), 'instruction', R.CODEX_WORDS.publishConstraint),
    violation: receipt(idOf(cx, (e) => e.operation === 'command'), 'action', R.CODEX_WORDS.publish) };
  assert.deepEqual(outcomes(await reviewOf(cx, [pub])).map((o) => o[1]), ['DECIDE']);
});

test('M33 N: a merge that keeps DECIDE drops the undoing with the disclosure', () => {
  const base = { origin: 'session-review', kind: 'edit_under_negative_requirement', title: 't', explanation: 'e',
    scope: 'session-effect', anchor: null, receipts: [receipt('I1', 'instruction', 'q1q1'), receipt('A1', 'code', 'q2q2')], breach: 'wrote' };
  const { findings } = ledger.mergeDuplicateFindings([{ ...base, status: 'FYI', disclosureReason: 'self_corrected',
    revertedBy: receipt('A2', 'action', 'a.md') }, { ...base, status: 'DECIDE' }]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'DECIDE');
  assert.equal(Object.hasOwn(findings[0], 'revertedBy'), false);
  assert.equal(Object.hasOwn(findings[0], 'disclosureReason'), false);
});

// ---- unsettled and unexecuted ----------------------------------------------------------------------------------------

test('M33 N: an unsettled check is withheld and decide_unsettled, never CLEAN; one never voted leaves the window incomplete', async (t) => {
  const session = await claude(t);
  const uncertain = (item) => (item.type === TYPE ? 'uncertain' : 'not-refuted');
  for (const profile of PROFILES) {
    const label = String(profile);
    const report = await reviewOf(session, [motivating(session)], { profile, verdict: uncertain });
    assert.deepEqual(edits(report), [], label);
    assert.equal(report.sessionStatus, 'NO_FINDINGS', `${label}: never CLEAN, never DECIDE`);
    assert.equal(report.sessionReview, 'complete', label);
    assert.deepEqual(part(report).reasons, ['decide_unsettled'], label);
    assert.equal(ledger.decideUnsettledCount(report), 1, label);
    assert.equal(report.withheld.unsettled, 1, label);
    assert.deepEqual(report.counts.forbiddenEdits.challenged, { upheld: 0, refuted: 0, unsettled: 1, unexecuted: 0 }, label);
    // Said in words that name this kind of check, never "a check on an agent claim".
    const md = review.renderReview(report);
    assert.ok(md.includes(review.PART_REASON_SENTENCE.decide_unsettled) && md.includes(review.RUN_STATE_SENTENCE.complete), label);
    assert.match(review.PART_REASON_SENTENCE.decide_unsettled, /a change against your instruction/);
    assert.ok(md.includes('1 with a check that did not settle') && !md.includes('could need your decision'), label);
    // Read from code's record alone: a report saved without its recording reads the same.
    const { session: _dropped, ...saved } = report;
    assert.equal(ledger.honestStatuses(saved).sessionStatus, 'NO_FINDINGS', label);
    const unvoted = await reviewOf(session, [motivating(session)], { profile, verdict: (item) => (item.type === TYPE ? null : 'not-refuted') });
    assert.deepEqual(edits(unvoted), [], label);
    assert.equal(unvoted.sessionStatus, 'UNCHECKED', `${label}: a check that did not run`);
    assert.equal(unvoted.counts.forbiddenEdits.challenged.unexecuted, 1, label);
  }
  // A change code proved undone is FYI-bound: its unsettled check holds nothing off CLEAN, and is still counted.
  const undone = await claude(t, { revert: 'same' });
  const fyiBound = await reviewOf(undone, [motivating(undone)], { verdict: uncertain });
  assert.equal(fyiBound.sessionStatus, 'CLEAN');
  assert.equal(fyiBound.withheld.unsettled, 1);
  const result = fyiBound.windowResults[0].challenge.results.find((r) => r.type === TYPE);
  assert.equal(result[ledger.FORBIDDEN_EDIT_REVERTED_MARK], true);
  // Without code's mark (an older record), it is DECIDE-bound: a re-reading is never cleaner.
  delete result[ledger.FORBIDDEN_EDIT_REVERTED_MARK];
  const { session: _gone, ...older } = fyiBound;
  assert.equal(ledger.honestStatuses(older).sessionStatus, 'NO_FINDINGS');
});

test('M33 N: a forbidden edit no check can read is asked again once; still unreadable, its window is incomplete', async (t) => {
  const session = await claude(t);
  const rated = { ...motivating(session), severity: 'high' };
  for (const second of [[rated], [motivating(session)]]) {
    const seen = [];
    let asked = 0;
    const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', judge: async (request) => {
      seen.push(request);
      if (request.challenge) return challenger()(request);
      asked++;
      return { decisions: [], pivots: [], claims: [], requirements: [], forbiddenEdits: asked === 1 ? [rated] : second };
    } });
    assert.equal(asked, 2, 'asked once more');
    assert.equal(report.counts.proposalReasks.asked, 1);
    if (second[0] === rated) {
      assert.deepEqual(edits(report), []);
      assert.equal(report.counts.proposalReasks.unreadable, 1);
      assert.ok(part(report).reasons.includes('proposal_unreadable'));
      assert.equal(report.sessionStatus, 'UNCHECKED');
      assert.equal(report.counts.forbiddenEdits.withheld.malformed, 1);
    } else {
      assert.equal(report.counts.proposalReasks.recovered, 1);
      assert.equal(edits(report).length, 1);
      assert.equal(report.sessionStatus, 'DECIDE');
    }
  }
});

// ---- m33-lean: the dossier ---------------------------------------------------------------------------------------------

test('M33 N m33-lean: the forbidden run\'s dossier shows both events whole and every human instruction between', async (t) => {
  // M33 N repair: the spelling command's result is typed (`is_error: false`): only an action proved to have happened is
  // ever published. M35: a compaction splits no window, so both edits are the one window's, asked in its one run.
  const session = await claude(t, { compacted: true, between: 'unrelated', typed: true });
  const write = writeOf(session);
  const between = askOf(session, R.WORDS.unrelated);
  const seen = [];
  const spell = idOf(session, (e) => e.kind === 'invocation' && e.operation === 'command');
  const report = await reviewOf(session, (request) => (request.window?.index === 0 ? [motivating(session), { text: 't',
    instruction: receipt(askOf(session, R.WORDS.constraint), 'instruction', R.WORDS.constraint),
    violation: receipt(spell, 'action', 'npx cspell app/application.md') }] : []), { profile: 'm33-lean', seen });
  const sent = seen.filter((r) => r.challenge && r.label.includes(':forbidden'));
  assert.ok(sent.length >= 3, 'the window asked its forbidden run');
  for (const request of sent) {
    // D71 (S2): a session-only batch is sent the core and only its item types' notes, then the
    // session dossier's note — never the combined route's SYSTEM.
    assert.equal(request.system, challenge.checklistSystem(request.challenge.items.map((item) => item.type), { dossier: true }));
    assert.ok(request.system.includes(challenge.FORBIDDEN_EDIT_NOTE) && !request.system.includes(challenge.challengeSystem()));
    for (const item of request.challenge.items) {
      // The action whole (its written body or its command), its result, and the instruction's words in the inventory.
      assert.ok(request.prompt.includes(`[${item.candidate.violation.eventId}] ACTION`));
      assert.ok(request.prompt.includes(item.candidate.violation.quote));
      assert.equal(instructionText(request, askOf(session, R.WORDS.constraint)), R.WORDS.ask);
      for (const id of item.candidate.humanInstructionsBetween) assert.notEqual(instructionText(request, id), null);
    }
  }
  const motivated = sent[0].challenge.items.find((item) => item.candidate.violation.eventId === write);
  assert.deepEqual(motivated.candidate.humanInstructionsBetween, [between]);
  assert.ok(sent[0].prompt.includes(R.BODY.split('\n')[2]), 'the written body, whole');
  assert.equal(edits(report).length, 2);
  assert.ok(edits(report).every((f) => f.status === 'DECIDE'));
});

// ---- publication ---------------------------------------------------------------------------------------------------------

test('M33 N: the review and the story show "You said" beside "The agent wrote", in plain words, under Findings (D71)', async (t) => {
  const session = await claude(t);
  const report = await reviewOf(session, [motivating(session)]);
  const md = review.renderReview(report);
  const at = md.indexOf('#### Edits against what you said');
  assert.ok(at >= 0 && !md.includes('### Needs your attention'));
  const block = md.slice(at);
  assert.ok(block.includes('| You said | The agent wrote |'));
  assert.ok(block.includes(`| “${R.WORDS.constraint}” \`${askOf(session, R.WORDS.constraint)}\` | “${R.WORDS.origin}” \`${writeOf(session)}\` |`));
  // M33 brittleness M4 session route: a statement whose disclosure was not upheld is never shown as one.
  assert.ok(!block.includes('The agent told you'));
  assert.ok(block.indexOf('| You said |') < block.indexOf('Receipts:'), 'the plain words come before the receipts');
  const told = story.renderSessionStory(session, report);
  const decide = told.indexOf('## Edits against what you said');
  assert.ok(decide >= 0 && !/## (Worth a look|Needs your decision)/.test(told));
  const section = told.slice(decide, told.indexOf('\n## ', decide + 1));
  assert.ok(section.includes(story.STORY_SENTENCES.forbiddenEdit));
  assert.ok(section.indexOf(`**You said:** ${R.WORDS.constraint}`) < section.indexOf(`**The agent wrote:** ${R.WORDS.origin}`));
  assert.ok(!section.includes('**The agent told you:**'));
  // A command reads "The agent ran".
  const cx = await codex(t);
  const pub = { text: 't', instruction: receipt(askOf(cx, 'do not run npm'), 'instruction', R.CODEX_WORDS.publishConstraint),
    violation: receipt(idOf(cx, (e) => e.operation === 'command'), 'action', R.CODEX_WORDS.publish) };
  const ran = await reviewOf(cx, [pub]);
  assert.ok(review.renderReview(ran).includes('| You said | The agent ran |'));
  assert.ok(story.renderSessionStory(cx, ran).includes(`**The agent ran:** ${R.CODEX_WORDS.publish}`));
  // A combined route's row (no breach) renders as it always did.
  const legacy = { origin: 'session-review', kind: 'edit_under_negative_requirement', title: 'T', explanation: 'E', status: 'DECIDE',
    scope: 'session-effect', anchor: null, receipts: [receipt(askOf(session, R.WORDS.constraint), 'instruction', R.WORDS.constraint),
      receipt(writeOf(session), 'action', R.PATH)] };
  assert.ok(!review.renderReview({ ...report, findings: [legacy] }).includes('| You said |'));
});

// ---- byte stability ------------------------------------------------------------------------------------------------------

// Every narrative request of these sessions, as 48e8c2a (`sonah.narrative/13`) sent it — computed against that tree with the
// very same rows — by session and profile: sha256 of `system`, `prompt` and `evidencePrompt` of each window, in order.
const NARRATIVE_13 = Object.freeze({
  claude: '31d5cf20429716d50e66615944c7a19310ff531eb92f125a2c0ff35612ca6eb2',
  claudeCompacted: '1234ccfc00d8d6e5123a8326524cf1209375bfe6c37894c26fed45393d7470f6',
  codex: 'a02457c9b82830903a59f4c2e78ce6f7807c60e9ed625ec817f68810e6f56bc9',
});
/** H1: a command's status is its typed exit for every command, a test runner's included —
 *  the codex fixture's `npm test` result now reads `succeeded · exit=0`, no longer `unknown · exit=0`. Its only moved
 *  byte; the two Claude sessions are /13's. */
const MOVED_BY_H1 = Object.freeze({ codex: '18251dbe810787d3dc9fc079298d8aa310b8b3cfdc2fb43d65ee66e7e1f0dc85' });
/** M1: the same `npm test` is a `bash` action, no longer `test` (`tool=bash`). */
const MOVED_BY_M1 = Object.freeze({ codex: 'cad1870df3632aba9fdb4fe3819c658e5abcd87fea2d1add53cffc6e008ca0fe' });
/** H5 (`sonah.carry/5`): the carried section's fixed text no longer names commands that "only read, list or check" — every
 *  command's result is carried. Only the compacted session carries anything; its only moved bytes are those words. */
const MOVED_BY_H5 = Object.freeze({ claudeCompacted: '3ab89b1bb2af06c016a6e717ce0524fb1f9cc4f0fca29a9a388288c3e6fd0994' });
const NARRATIVE_NOW = Object.freeze({ ...NARRATIVE_13, ...MOVED_BY_H1, ...MOVED_BY_M1, ...MOVED_BY_H5 });
/** MOVED_BY_WINDOWING (M35, C-07 "M35 windowing"): every session's narrative requests — one window each now (a compaction
 *  no longer splits one), named by its window's aliases, actions and results trimmed — so the render-back to /13's
 *  (NARRATIVE_NOW, kept as the pins these replace) no longer applies. The texts below are still each in every request
 *  once. */
const MOVED_BY_WINDOWING = Object.freeze({ claude: '53f25a3173c3518a70a910f884372bb8b3923497a710e8ba800da9932b260baf',
  claudeCompacted: 'e465b1745f67a5cb4a025291bd03062bad886333d0ab059e8b092928ee26d994',
  codex: 'b6106a7bd24a2e0c3675eca2b026b179f607c35c26703992b6a53732128b527f' });
const narrativeDigest = (requests, render = (text) => text) => sha(JSON.stringify(requests.map(({ request }) =>
  [sha(request.system), sha(render(request.prompt)), sha(render(request.evidencePrompt))])));
/** M36 phase 2, the window format (D68 L; C-07 "M36 window format"): each session's narrative requests moved by
 *  each RESULT's label line alone (`recorded: …`) — rendered back (`beforeM36Labels`) they are MOVED_BY_WINDOWING's. */
const MOVED_BY_M36_FORMAT = Object.freeze({ claude: '5e3f37593b62e12cf8c74c83083b805dbe5dfb920af75a668d74ce92bce2cd11',
  claudeCompacted: 'c7ae166b3325cc0725833fa11e6774b043085078613ca4b323dff405c7ceaba2',
  codex: 'af8944c9cb2bdfcb039fbc7d7647645182f75260d7be642e238f96037a9fd37a' });
/** M36 phase 3 (D68 K, Q, F; C-07 "M36 packed windows", "M36 evidence re-ask"): each session's narrative
 *  requests moved by item 1's actor sentence and the session-only contract's `evidenceRequests` member and rules alone —
 *  rendered back (`beforeM36Conversation`) they are MOVED_BY_M36_FORMAT's. */
const MOVED_BY_M36_CONVERSATION = Object.freeze({ claude: '782bf20e665c2b6527c2d5d913322d97d99624615d1d6b1057531603b4a1face',
  claudeCompacted: '1cd25d1220ac07097b139f0edf80d49ec1ec3e90cb17735ab01301fc88aca169',
  codex: 'e82ca17b3d9247a60188c4545702445a5ee666dbe1c36aa93c9f787305204445' });

/** D71 (S2, the reviewer brief as the checklist): a session-only request carries only the window, in
 *  the checklist's reading order, and the brief (`sonah.session-review-agent/3`) holds the forbidden-edit step and its
 *  contract member — so nothing renders a request back to M36 phase 3's (MOVED_BY_M36_CONVERSATION, kept as the pins these
 *  replace). Every profile still sends the same requests. */
const MOVED_BY_D71_BRIEF = Object.freeze({ claude: 'd874bf3d60c76d6963b1da8d4d58a6c901b18df8e957d33bb973714fedbb239b',
  claudeCompacted: 'eeea8ca37822556a97d98daecfe75e3308821952f9c30bacb36df5b9e067eef1',
  codex: 'daa3aeaadf1c41495688ee1fca87ab5a237e52abe2327c8cec3c7ae2713c9f8e' });

/** D71 (S3, the new channels): every request moved again — "About this window" lists the RESULTs step 4 answers for and
 *  the brief's last step is step 6 — and nothing renders it back to S2's (MOVED_BY_D71_BRIEF, kept as the pins these
 *  replace). Every profile still sends the same requests. */
const MOVED_BY_D71_CHANNELS = Object.freeze({ claude: '7c08a684eee9a5f9bb9121fe242cbe8c86924464b9f430efbf5dd865857fcb45',
  claudeCompacted: '9182cba4e3cc3570224cbd60eea6c5540ca1e623edd9610d7f584eeeff906967',
  codex: '75d8cc1c26fe76b9ffadc378c08bcf98025cf8cc4353a889572923e451e146f5' });

/** S6 (the fixes of the S5 review): every request moved again — the brief says what code checks for a choice not to act
 *  with no actions and a claim's `restsOn` (`sonah.session-review-agent/5`) — and nothing renders it back to S3's
 *  (MOVED_BY_D71_CHANNELS, kept as the pins these replace). Every profile still sends the same requests. */
const MOVED_BY_D71_FIX = Object.freeze({ claude: '5254bb78c1918b0e0f933af979c70b8b714f84bccc66ec306f5ec984278dd1bf',
  claudeCompacted: '53513b5893016143eccb84c5c1467da205aa21f6d83665d8069ddb8750b826af',
  codex: '7a8d6beda295f8a3795ed40a0b8f93ac7c5ad426d5f12a27cfee80fe5a081baf' });

/** S7: every request moved again by S7's fixed texts alone (the brief's restsOn and
 *  step 4 sentences, the failures line's words): rendered back (`textBeforeS7`), each is S6's above, byte for byte. */
const MOVED_BY_S7 = Object.freeze({ claude: '6a714ca8994ae590d3778f9e763d8419450621ce2db792ca1de6e6d94896fca1',
  claudeCompacted: '084fb6d6137c419173d5e4527c0765f3639548f1802ed474d5e075f15b51a82c',
  codex: 'cce64d55d3375f89b75ba543279b207e17a3063a41e910739ef747a36115df1c' });
/** The column fix (owner decisions D83 (2) and D84): every request moved again by its fixed texts alone (the brief
 *  says who decided a decision; D84: and that "made without asking you" checks the shown project
 *  instruction files too; 2026-10-13: and that "you settled it" is words that state the choice's own answer, and at
 *  The settled-words gain, that such a choice is reported settled at the level the words address): rendered back
 *  (`textBeforeFixColumn`), each is S7's above, byte for byte. */
const MOVED_BY_FIX_COLUMN = Object.freeze({ claude: '9e856779cfa73e280d3d3ae931fbf74d0b921a6490df7b7063461b469a333d31',
  claudeCompacted: 'ba27de46043e00ac716408fb8f509f0f0071ce6dfbb8c4c57a648ac5673e085a',
  codex: 'a6a8caacbbc4ae3df2463b2094b84bf72abe1bd1e0091b70c1f6a529caddfb13' });
/** The asks fixes (P1): every request moved again by the brief's one sentence on a run the human asked for, refused
 *  at every attempt (`sonah.session-review-agent/9`): rendered back (`textBeforeAsksFixes`), each is fix-column's
 *  above, byte for byte. */
const MOVED_BY_ASKS_FIXES = Object.freeze({ claude: 'ebf6f13765b44e2c540480e897801fdbdf4067f85ea8d50fe1b49ad08881272b',
  claudeCompacted: 'b5f9f6968b338b2e1bdbf899340a85bb6559b08f95c269adc44cb4a6e7bf3389',
  codex: '22db0940f81ec14893c30a95ea65365aafabb0429e3fa351b2e44b2abbd2a46d' });
/** W1 B: every request moved again by the brief's texts (step 3's sentence on words an answer goes against, step 5's
 *  paragraph, a forbidden edit's instruction role in the answer's shape and its contract rule;
 *  `sonah.session-review-agent/10`): rendered back (`textBeforeW1`), each is the asks fixes' above, byte for byte. */
const MOVED_BY_W1 = Object.freeze({ claude: '53944516a9e15af9284eaf7fb9d30b78e40c5c1ce5b0f97ba71ef712854a79d9',
  claudeCompacted: 'a94abdd83c39c0b4da753c0320c1e1ce2b8afc4e6bc5caaf68edfa0f5744fb6f',
  codex: '2c3b2cec27c94a00938c208c6d219fd9bebef53a9837ecd814f7e7c31046aeab' });
/** W2 (3): every request moved again by the brief's texts (step 2's compare sentence and its contradictedBy, step 5's
 *  written contradiction and its role in the answer's shape; `sonah.session-review-agent/11`): rendered back
 *  (`textBeforeW2`), each is W1's above, byte for byte. */
const MOVED_BY_W2 = Object.freeze({ claude: '8ed623ab2be35d648e52068fd3afcc4ed2162042ebbd7aea93e10645999e47f6',
  claudeCompacted: 'c2f837479ef4417e227f67e5dd75295182d62844c2ed3c8feac33ea7c2424dee',
  codex: 'ebb0a438ca243e42161568ccdd6b8464c9313a423de9aef9336092cd7864ea27' });
/** The narrative digest with W2's fixed texts rendered back in every text it holds (system included). */
const narrativeDigestBeforeW2 = (requests) => sha(JSON.stringify(requests.map(({ request }) =>
  [sha(textBeforeW2(request.system)), sha(textBeforeW2(request.prompt)), sha(textBeforeW2(request.evidencePrompt))])));
/** The narrative digest with W1's fixed texts rendered back in every text it holds (system included). */
const narrativeDigestBeforeW1 = (requests) => sha(JSON.stringify(requests.map(({ request }) =>
  [sha(textBeforeW1(request.system)), sha(textBeforeW1(request.prompt)), sha(textBeforeW1(request.evidencePrompt))])));
/** The narrative digest with the asks fixes' fixed texts rendered back in every text it holds (system included). */
const narrativeDigestBeforeAsksFixes = (requests) => sha(JSON.stringify(requests.map(({ request }) =>
  [sha(textBeforeAsksFixes(request.system)), sha(textBeforeAsksFixes(request.prompt)),
    sha(textBeforeAsksFixes(request.evidencePrompt))])));
/** The narrative digest with the column fix's fixed texts rendered back in every text it holds (system
 *  included). */
const narrativeDigestBeforeFixColumn = (requests) => sha(JSON.stringify(requests.map(({ request }) =>
  [sha(textBeforeFixColumn(request.system)), sha(textBeforeFixColumn(request.prompt)),
    sha(textBeforeFixColumn(request.evidencePrompt))])));
/** The narrative digest with S7's fixed texts rendered back in every text it holds (system included). */
const narrativeDigestBeforeS7 = (requests) => sha(JSON.stringify(requests.map(({ request }) =>
  [sha(textBeforeS7(request.system)), sha(textBeforeS7(request.prompt)), sha(textBeforeS7(request.evidencePrompt))])));

test('M33 N bytes: a session-only narrative request moved by exactly the three forbidden-edit texts; nothing else moved', async (t) => {
  const sessions = { claude: await claude(t, { nothing: true }), claudeCompacted: await claude(t, { compacted: true }),
    codex: await codex(t, { nothing: true }) };
  const now = {}, back = {}, backS7 = {}, backFixColumn = {}, backAsksFixes = {}, backW1 = {};
  for (const [name, session] of Object.entries(sessions))
    for (const profile of PROFILES) {
      const label = `${name}, ${profile}`;
      const plan = reviewRun.planWindowRequests({ session, reviewScope: 'session-only', ...(profile ? { speedProfile: profile } : {}) });
      // M35: every profile windows alike, so every profile sends these requests (MOVED_BY_WINDOWING).
      now[name] ??= narrativeDigest(plan.requests);
      back[name] ??= narrativeDigestBeforeS7(plan.requests);
      backS7[name] ??= narrativeDigestBeforeFixColumn(plan.requests);
      backFixColumn[name] ??= narrativeDigestBeforeAsksFixes(plan.requests);
      backAsksFixes[name] ??= narrativeDigestBeforeW1(plan.requests);
      backW1[name] ??= narrativeDigestBeforeW2(plan.requests);
      assert.equal(narrativeDigest(plan.requests), now[name], `${label}: the same requests in every profile`);
      for (const { request } of plan.requests) {
        // D71 (S2): the forbidden-edit step and its contract member are the brief's (the system prompt), once each; the
        // request and its evidence name neither.
        // D71 (S3): the failures the agent passed over became step 4, so this step is step 5.
        assert.equal(request.system.split('STEP 5. EDITS AGAINST WHAT THE HUMAN SAID').length, 2, label);
        assert.equal(request.system.split('"forbiddenEdits": [{').length, 2, label);
        assert.ok(!request.prompt.includes('forbiddenEdits') && !request.evidencePrompt.includes('forbiddenEdits'), label);
      }
    }
  // The column fix: rendered back (`textBeforeFixColumn`), S7's (MOVED_BY_S7), byte for byte; S7: rendered back
  // (`textBeforeS7`, which applies it first), S6's (MOVED_BY_D71_FIX), byte for byte.
  // The asks fixes: rendered back (`textBeforeAsksFixes`), fix-column's (MOVED_BY_FIX_COLUMN), byte for byte.
  // W1 B: rendered back (`textBeforeW1`), the asks fixes' (MOVED_BY_ASKS_FIXES), byte for byte.
  // W2: rendered back (`textBeforeW2`), W1's (MOVED_BY_W1), byte for byte.
  assert.deepEqual(now, { ...MOVED_BY_W2 });
  assert.deepEqual(backW1, { ...MOVED_BY_W1 });
  assert.deepEqual(backAsksFixes, { ...MOVED_BY_ASKS_FIXES });
  assert.deepEqual(backFixColumn, { ...MOVED_BY_FIX_COLUMN });
  assert.deepEqual(backS7, { ...MOVED_BY_S7 });
  assert.deepEqual(back, { ...MOVED_BY_D71_FIX });
  assert.notEqual(MOVED_BY_D71_FIX.claude, MOVED_BY_D71_CHANNELS.claude);
  assert.notEqual(MOVED_BY_D71_CHANNELS.claude, MOVED_BY_D71_BRIEF.claude);
  assert.notEqual(MOVED_BY_D71_BRIEF.claude, MOVED_BY_M36_CONVERSATION.claude);
  assert.notEqual(MOVED_BY_WINDOWING.claude, NARRATIVE_NOW.claude);
  // A combined narrative request (the code review's narrative fallback is one) is /13's byte for byte: nothing to render back.
  const session = sessions.claude;
  for (const window of reviewRun.planWindowRequests({ session, reviewScope: 'session-only' }).windows) {
    const built = prompt.buildNarrativePrompt({ session, window, reviewScope: 'combined' });
    assert.equal(beforeForbiddenEdit(beforeStatusFact(built.prompt)), beforeSupportOrderText(beforeStatusFact(built.prompt)));
    assert.ok(!built.prompt.includes('forbiddenEdits'));
  }
  // The joint code review's schema is unchanged: it never admits the member.
  assert.equal(Object.hasOwn(codeReviewPrompt.CODE_REVIEW_SCHEMA.properties, 'forbiddenEdits'), false);
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
  // D71 (S2) moved it once more (`sonah.code-review/24`): the narrative evidence it embeds moved with the slicer alone (a
  // failed command names the tool it attempted); its own text is /23's (D71 i).
  assert.equal(codeReviewPrompt.CODE_REVIEW_VERSION, 'sonah.code-review/24');
  // The contracts: a session-only request carries its own (`forbiddenEdits` beside the rest), so the D60 store keeps an
  // answer holding it; a combined request carries NARRATIVE_SCHEMA, unchanged, which never admits it.
  assert.equal(Object.hasOwn(prompt.NARRATIVE_SCHEMA.properties, 'forbiddenEdits'), false);
  // M36 phase 3 (D68 Q): and its evidence requests after it.
  // D71 (S2): and the closing message's lines that assert nothing (`notClaims`), before them; its requirements and claims
  // are the checklist's (their statuses and receipts, a claim's `restsOn`). D71 (S3): and the failures the agent passed
  // over (`failures`), first of the new members.
  assert.deepEqual(Object.keys(prompt.SESSION_NARRATIVE_SCHEMA.properties), [...Object.keys(prompt.NARRATIVE_SCHEMA.properties),
    'failures', 'notClaims', 'forbiddenEdits', 'evidenceRequests']);
  const [sessionOnly] = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' }).requests;
  const [combined] = reviewRun.planWindowRequests({ session, reviewScope: 'combined' }).requests;
  assert.equal(sessionOnly.request.schema, prompt.SESSION_NARRATIVE_SCHEMA);
  assert.equal(combined.request.schema, prompt.NARRATIVE_SCHEMA);
  const answer = { decisions: [], pivots: [], claims: [], requirements: [], forbiddenEdits: [motivating(sessions.claudeCompacted)] };
  assert.equal(answerStorable(sessionOnly.request, answer), true);
  assert.equal(answerStorable(combined.request, answer), false);
  assert.equal(reviewRun.runProfile('session-only').narrativeSchema.properties.forbiddenEdits.type, 'array');
  assert.equal(Object.hasOwn(reviewRun.runProfile('combined').narrativeSchema.properties, 'forbiddenEdits'), false);
});

test('M33 N bytes: a review whose answers propose nothing sends no new request, and its records gain no member', async (t) => {
  const session = await claude(t, { nothing: true });
  for (const profile of PROFILES) {
    const seen = [];
    const report = await reviewOf(session, [], { profile, seen });
    assert.deepEqual(forbiddenLabels(seen), [], String(profile));
    for (const request of seen.filter((r) => r.challenge)) assert.ok(!request.system.includes(challenge.FORBIDDEN_EDIT_NOTE));
    assert.equal(Object.hasOwn(report.counts, 'forbiddenEdits'), false, String(profile));
    assert.ok(report.windowResults.every((w) => !Object.hasOwn(w, 'forbiddenEdits')), String(profile));
    assert.equal(FORMAT_VERSIONS.prompt.before, RECORDED_FACTS_VERSIONS.prompt.after);
    // M36 phase 2 moved it once more (FORMAT_VERSIONS: prompt): the window format (D68); M36 phase 3 once more
    // (CONVERSATION_VERSIONS: prompt).
    assert.equal(CONVERSATION_VERSIONS.prompt.before, FORMAT_VERSIONS.prompt.after);
    assert.equal(D69_VERSIONS.prompt.before, CONVERSATION_VERSIONS.prompt.after);
    assert.equal(D69_REVIEW_VERSIONS.prompt.before, D69_VERSIONS.prompt.after);
    // D71 (S2) moved it once more: the reviewer brief as the checklist (`sonah.narrative/27`).
    // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
    // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
    // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
    // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
    // is left out of the window's project files. The second release review moved it once more
    // (sonah.narrative/36): that file's path is compared under the working directory.
    assert.equal(report.windowResults[0].promptVersion, 'sonah.narrative/36');
  }
  // A combined review's answer carrying the member it was never asked for is outside its contract, exactly as before.
  const combined = await reviewRun.runReview({ session, pr: null, judge: async (request) => (request.challenge ? { votes: [] }
    : { decisions: [], pivots: [], claims: [], requirements: [], forbiddenEdits: [] }) });
  assert.equal(combined.windowResults[0].failure, 'model_response_invalid');
  assert.equal(combined.windowResults[0].shortfall.narrative, 'schema');
});
