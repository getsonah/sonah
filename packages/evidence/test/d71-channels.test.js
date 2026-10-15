// D71 (S3): the new channels (owner decisions 2026-10-08 D71 c, d, e, f, g; step S3). Every
// recording here is synthetic (d71-channels-fixture.js); no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './m33-u-unasked-fixture.js';
import { channelRows, channelIds, ASK, RULES, LATER } from './d71-channels-fixture.js';
import { planWindowRequests, runReview, CONTRADICTION_TITLES } from '../src/run-review.js';
import { PROMPT_VERSION, SESSION_NARRATIVE_SCHEMA, NARRATIVE_SCHEMA, PROJECT_INSTRUCTIONS_HEADER, PROJECT_HARNESS_LINE,
  HARNESS_CONTEXT_LINE, failuresLine } from '../src/prompt.js';
import { SONAH_SESSION_REVIEW_AGENT, SESSION_REVIEW_AGENT_VERSION, SONAH_REVIEW_AGENT } from '../src/review-agent.js';
import { FAILURE_OUTCOMES, FAILURE_HANDLINGS, FAILURE_UNCHECKED_REASONS, FAILURE_REJECTIONS, FAILURE_ITEM_TYPE,
  CONTRADICTION_SOURCES, CONTRADICTION_ROLES, FILE_CONTENT_OUTCOMES, WITHHELD_REJECTION_CAUSES, groundDecision,
  contradictionSourceOf, findingReceiptCheck } from '../src/ledger.js';
import { windowFailures, failuresCheck } from '../src/checklist.js';
import { CHALLENGE_PROFILE, CHALLENGE_DOSSIER_VERSION, CHECKLIST_PROPOSITIONS, SESSION_CHALLENGE_CORE, FAILURE_NOTE,
  DECISION_NOTE, CLAIM_NOTE, checklistSystem, checklistProposition } from '../src/challenge.js';
import { RECEIPT_ROLES, GROUNDING_ROLES, verifyReceipt } from '../src/session.js';
import { WITHHELD_SENTENCE } from '../src/review.js';

/** A judge that answers the narrative with `answer(request)` and votes on every challenge item with its own receipt,
 *  `verdict(item)` (not-refuted unless it says otherwise); every request is kept in `seen`. */
function judgeOf(answer, { verdict = () => 'not-refuted', seen = [] } = {}) {
  const own = (candidate) => candidate?.response ?? candidate?.deliverable ?? candidate?.shortfall ?? candidate?.stated
    ?? candidate?.instruction ?? candidate?.violation ?? candidate?.receipts?.[0] ?? null;
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
const empty = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });

test('D71 S3: the closed vocabularies, each in one constants place, and the versions moved once', () => {
  // S7: `stopped` left the table (a form of no terminal status now).
  assert.deepEqual(FAILURE_OUTCOMES, ['ran-failed', 'failed-or-refused', 'did-not-run', 'no-terminal-status']);
  assert.deepEqual(FAILURE_HANDLINGS, ['acted-on', 'told-human', 'passed-over', 'not-checked']);
  // D80 adds one: an acted-on response quoting only the body of a write whose command did not run or failed.
  assert.deepEqual(FAILURE_UNCHECKED_REASONS, ['response_ungrounded', 'response_not_after', 'response_other_agent',
    'response_not_shown_to_human', 'turn_end_not_cited', 'failure_unreviewed', 'challenge_refuted', 'challenge_unsettled',
    'challenge_unexecuted', 'write_command_not_run_or_failed']);
  assert.deepEqual(FAILURE_REJECTIONS, ['malformed', 'not_listed', 'merged']);
  assert.equal(FAILURE_ITEM_TYPE, 'failure');
  // W2 (owner decision 2026-10-13) adds one: the text the agent's own edit or write added (role code, like file_content).
  assert.deepEqual(CONTRADICTION_SOURCES, ['result', 'human_message', 'file_content', 'project_instructions',
    'own_written']);
  assert.deepEqual(CONTRADICTION_ROLES, { result: 'observation', human_message: 'instruction', file_content: 'code',
    project_instructions: 'project-instructions', own_written: 'code' });
  assert.deepEqual(FILE_CONTENT_OUTCOMES, ['ran-completed', 'ran-exit-0']);
  for (const cause of ['source_not_before', 'source_not_human', 'source_not_file_content', 'source_rewritten']) {
    assert.ok(WITHHELD_REJECTION_CAUSES.includes(cause));
    assert.equal(typeof WITHHELD_SENTENCE[cause], 'function', `${cause} has a sentence`);
  }
  for (const list of [FAILURE_OUTCOMES, FAILURE_HANDLINGS, FAILURE_UNCHECKED_REASONS, FAILURE_REJECTIONS,
    CONTRADICTION_SOURCES, CONTRADICTION_ROLES, FILE_CONTENT_OUTCOMES]) assert.ok(Object.isFrozen(list));
  // The combined route's closed role list (its joint schema) is unchanged; only grounding reads the new role.
  assert.deepEqual(RECEIPT_ROLES, ['instruction', 'commentary', 'action', 'observation', 'code']);
  assert.deepEqual(GROUNDING_ROLES, [...RECEIPT_ROLES, 'project-instructions']);
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory.
  assert.equal(PROMPT_VERSION, 'sonah.narrative/36');
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
  assert.equal(CHALLENGE_PROFILE.version, 'sonah.challenge/42');
  // The D80 integration moved it once more (sonah.challenge-dossier/13): the same outcome line (D80_VERSIONS).
  assert.equal(CHALLENGE_DOSSIER_VERSION, 'sonah.challenge-dossier/13');
});

test('D71 S3: the brief adds step 4 (failures) and renumbers the rest; the combined route\'s texts are unchanged', () => {
  const brief = SONAH_SESSION_REVIEW_AGENT;
  const order = ['STEP 1. WHAT THE HUMAN ASKED', 'STEP 2. WHAT THE AGENT TOLD THE HUMAN', 'STEP 3. WHAT THE AGENT DECIDED',
    'STEP 4. FAILURES THE AGENT PASSED OVER (failures)', 'STEP 5. EDITS AGAINST WHAT THE HUMAN SAID', 'STEP 6. BEFORE YOU ANSWER'];
  const at = order.map((heading) => brief.indexOf(heading));
  assert.ok(at.every((n) => n > 0) && at.every((n, k) => !k || n > at[k - 1]), 'the six steps, in order');
  for (const once of ['set "notActing": true, quote', '"assumption": true on a claim', 'takes role project-instructions',
    '"failures": [{',
    'When the agent both acted on a failure and told the human about it, give told-human.']) {
    assert.ok(brief.includes(once), once);
    assert.equal(brief.indexOf(once), brief.lastIndexOf(once), `${once} is stated once`);
  }
  assert.ok(!brief.includes('step 5)') && !brief.includes('(step 5'), 'no stale step number');
  // Nothing of S3 reached the combined route's brief or schema (D71 i).
  for (const text of ['notActing', 'assumption', 'failures', 'project-instructions']) assert.ok(!SONAH_REVIEW_AGENT.includes(text));
  assert.equal(NARRATIVE_SCHEMA.properties.claims.items.properties.contradictedBy.properties.role.const, 'observation');
  assert.ok(!Object.hasOwn(NARRATIVE_SCHEMA.properties, 'failures'));
  assert.deepEqual(SESSION_NARRATIVE_SCHEMA.properties.claims.items.properties.contradictedBy.properties.role.enum,
    ['observation', 'instruction', 'code', 'project-instructions']);
  assert.deepEqual(SESSION_NARRATIVE_SCHEMA.properties.failures.items.properties.handling.enum, [...FAILURE_HANDLINGS]);
});

test('D71 S3 (g): only the project\'s own instruction file is read, scrubbed and shown with its own role, before the '
  + 'window\'s end only', async (t) => {
  const { raw, ledger, session } = await load(t, channelRows({ nestedLate: true }));
  // The slicer reads the recorder's typed `Project` files only, never the agent's memory under the harness home folder.
  assert.deepEqual(raw.projectInstructions.map((entry) => entry.path), ['CLAUDE.md', 'src/CLAUDE.md']);
  assert.ok(!JSON.stringify(raw).includes('A private memory line.'), 'the memory file is never read');
  assert.equal(ledger.projectInstructions[0].text, RULES);
  const n = channelIds(session);
  assert.equal(n.rules.kind, 'project-instructions');
  assert.equal(n.rules.afterSequence, n.ask.sequence, 'placed after the ask it was recorded after');
  assert.ok(!session.events.some((event) => event.kind === 'project-instructions'), 'beside the events, never among them');
  const [request] = planWindowRequests({ session, reviewScope: 'session-only' }).requests;
  const { prompt, evidencePrompt } = request.request;
  const block = prompt.indexOf(PROJECT_INSTRUCTIONS_HEADER[0]);
  assert.ok(block > prompt.indexOf('## What the human asked') && block < prompt.indexOf('## About this window'));
  assert.ok(prompt.includes('PROJECT INSTRUCTIONS · path=CLAUDE.md · given to the main agent · role=project-instructions'));
  assert.ok(prompt.includes('Never add a runtime dependency.'));
  assert.ok(!prompt.includes('Exports keep their column order.'), 'a file recorded after the window\'s last event (D59)');
  assert.ok(prompt.includes(PROJECT_HARNESS_LINE) && !prompt.includes(HARNESS_CONTEXT_LINE));
  assert.ok(evidencePrompt.includes('Never add a runtime dependency.'), 'challengers are shown it too');
  assert.deepEqual(request.sourceMap[n.rules.id].map((source) => source.role), ['project-instructions']);
  assert.ok(verifyReceipt(session, quote(n.rules.id, 'project-instructions', 'Never add a runtime dependency.')).ok);
  assert.ok(!verifyReceipt(session, quote(n.rules.id, 'instruction', 'Never add a runtime dependency.')).ok,
    'never quotable as the human\'s words');
});

test('D71 S3 (g): a recording with no project instruction file keeps its harness line and shows no block', async (t) => {
  const rows = channelRows().filter((row) => row.attachment?.type !== 'instructions');
  const { raw, session } = await load(t, rows);
  assert.ok(!Object.hasOwn(raw, 'projectInstructions'), 'the slice carries none, so its bytes are as before');
  assert.deepEqual(session.projectInstructions, []);
  const { prompt } = planWindowRequests({ session, reviewScope: 'session-only' }).requests[0].request;
  assert.ok(!prompt.includes(PROJECT_INSTRUCTIONS_HEADER[0]) && prompt.includes(HARNESS_CONTEXT_LINE));
});

test('D71 S3 (c): code lists the failed, unrun and unfinished RESULTs; each row\'s handling needs its receipt', async (t) => {
  const { session } = await load(t, channelRows());
  const n = channelIds(session);
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  const [window] = plan.windows;
  const { sourceMap } = plan.requests[0];
  assert.deepEqual(windowFailures(session, window).map(({ event, outcome }) => [event.id, outcome]),
    [[n.testResult.id, 'ran-failed'], [n.backgroundResult.id, 'no-terminal-status'], [n.lintResult.id, 'ran-failed']]);
  assert.ok(plan.requests[0].request.prompt.includes(failuresLine(['E5', 'E9', 'E11'])));
  const check = (rows) => failuresCheck(session, window, rows, { sourceMap });
  const closing = (text) => quote(n.closing.id, 'commentary', text);
  const accepted = check([
    { eventId: n.testResult.id, handling: 'acted-on', response: quote(n.edit.id, 'action', 'src/export.js') },
    { eventId: n.backgroundResult.id, handling: 'passed-over', response: closing('Done.') },
    { eventId: n.lintResult.id, handling: 'told-human', response: closing('The lint run failed once; I fixed it.') },
  ]);
  assert.deepEqual(accepted.rows.map((row) => [row.candidate.handling, row.reason]),
    [['acted-on', null], ['passed-over', null], ['told-human', null]]);
  const lowered = check([
    { eventId: n.testResult.id, handling: 'told-human', response: quote(n.notActing.id, 'commentary', 'I will not touch the CSV writer.') },
    { eventId: n.lintResult.id, handling: 'passed-over', response: quote(n.fixing.id, 'commentary', 'Fixing the lint error now.') },
    { eventId: n.backgroundResult.id, handling: 'acted-on', response: closing('Done.') },
    { eventId: n.backgroundResult.id, handling: 'not-checked' },
    { eventId: n.editResult.id, handling: 'not-checked' },
    { eventId: n.testResult.id, handling: 'maybe' },
  ]);
  assert.deepEqual(lowered.rows.map((row) => [row.candidate.handling, row.reason]), [
    ['not-checked', 'response_not_after'], ['not-checked', 'turn_end_not_cited'], ['not-checked', 'response_ungrounded']]);
  assert.deepEqual(lowered.rejected, { malformed: 1, not_listed: 1, merged: 1 });
});

test('D71 S3 (c): the failures section — every listed RESULT gets a row, each asked handling is challenged, one not '
  + 'upheld is kept at not-checked', async (t) => {
  const { session } = await load(t, channelRows());
  const n = channelIds(session);
  const answer = () => ({ ...empty(), failures: [
    { eventId: n.testResult.id, handling: 'acted-on', response: quote(n.edit.id, 'action', 'src/export.js') },
    { eventId: n.backgroundResult.id, handling: 'passed-over', response: quote(n.closing.id, 'commentary', 'Done.') },
  ] });
  const seen = [];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf(answer, { seen,
    verdict: (item) => (item.type === FAILURE_ITEM_TYPE && item.candidate.handling === 'passed-over' ? 'refuted' : 'not-refuted') }) });
  const rowOf = (id) => report.failures.find((row) => row.eventId === id);
  assert.deepEqual(rowOf(n.testResult.id).handling, 'acted-on');
  assert.equal(rowOf(n.testResult.id).outcome, 'ran-failed');
  assert.equal(rowOf(n.testResult.id).action, n.test.id);
  assert.equal(rowOf(n.testResult.id).response.quote, 'src/export.js');
  assert.deepEqual([rowOf(n.backgroundResult.id).handling, rowOf(n.backgroundResult.id).reason], ['not-checked', 'challenge_refuted']);
  assert.equal(rowOf(n.backgroundResult.id).response, undefined, 'a lowered row carries no receipt');
  // D71 (S4): with the outcome's form and the tool its action named, as recorded, for a reader with the report only.
  assert.deepEqual(rowOf(n.lintResult.id), { eventId: n.lintResult.id, outcome: 'ran-failed', form: 'flag', action: n.lint.id,
    tool: n.lint.tool, handling: 'not-checked', reason: 'failure_unreviewed', codeMade: true });
  const { failures } = report.counts.checklist;
  assert.equal(failures.listed, 3);
  assert.deepEqual(failures.byOutcome, { 'ran-failed': 2, 'failed-or-refused': 0, 'did-not-run': 0, 'no-terminal-status': 1 });
  assert.deepEqual(failures.byHandling, { 'acted-on': 1, 'told-human': 0, 'passed-over': 0, 'not-checked': 2 });
  assert.equal(failures.reasons.challenge_refuted, 1);
  assert.equal(failures.reasons.failure_unreviewed, 1);
  // Each asked row is one item of its own type, its proposition in code's fixed words, its note only in its batch.
  const asked = seen.filter((r) => r.challenge).flatMap((r) => r.challenge.items).filter((item) => item.type === FAILURE_ITEM_TYPE);
  assert.deepEqual([...new Set(asked.map((item) => item.candidate.handling))].sort(), ['acted-on', 'passed-over']);
  const batch = seen.find((r) => r.challenge?.items.some((item) => item.type === FAILURE_ITEM_TYPE));
  assert.ok(batch.prompt.includes(CHECKLIST_PROPOSITIONS.failureActedOn) && batch.prompt.includes(CHECKLIST_PROPOSITIONS.failurePassedOver));
  assert.ok(batch.system.startsWith(SESSION_CHALLENGE_CORE) && batch.system.includes(FAILURE_NOTE));
  assert.equal(checklistSystem(['requirement']).includes(FAILURE_NOTE), false);
});

test('D71 S3 (d): a choice not to act is a decision anchored on the agent\'s words, flagged, and only on the session '
  + 'route', async (t) => {
  const { session } = await load(t, channelRows());
  const n = channelIds(session);
  const choice = { dimension: 'the CSV writer', chosen: 'leave it unchanged', value: null, actions: [], notActing: true,
    stated: quote(n.notActing.id, 'commentary', 'I will not touch the CSV writer.') };
  const answer = () => ({ ...empty(), decisions: [choice] });
  const seen = [];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf(answer, { seen }) });
  const [decision] = report.decisions;
  assert.equal(decision.notActing, true);
  assert.deepEqual(decision.actions, []);
  assert.equal(decision.stated.quote, 'I will not touch the CSV writer.');
  assert.deepEqual(report.counts.checklist.notActing, { proposed: 1, published: 1 });
  const item = seen.filter((r) => r.challenge).flatMap((r) => r.challenge.items).find((x) => x.type === 'decision');
  assert.equal(checklistProposition(item), CHECKLIST_PROPOSITIONS.decisionNotActing);
  assert.ok(DECISION_NOTE.includes('A decision with notActing is a choice NOT to do something'));
  // Refuted by the challenge (the words state no such choice): not published.
  const refuted = await runReview({ session, pr: null, reviewScope: 'session-only',
    judge: judgeOf(answer, { verdict: (x) => (x.type === 'decision' ? 'refuted' : 'not-refuted') }) });
  assert.equal(refuted.decisions.length, 0);
  // The grounder admits one only where asked (a session-only review), and never one without the agent's words.
  const candidate = { ...choice, actorSession: session.sessionKey };
  assert.equal(groundDecision({ repo: { host: 'github.com', id: '0' }, session, pr: null, candidate,
    instructionHistoryComplete: true }).reason, 'no_actions');
  assert.equal(groundDecision({ repo: { host: 'github.com', id: '0' }, session, pr: null,
    candidate: { ...candidate, stated: null }, instructionHistoryComplete: true, notActing: true }).reason, 'no_actions');
  assert.equal(groundDecision({ repo: { host: 'github.com', id: '0' }, session, pr: null, candidate,
    instructionHistoryComplete: true, notActing: true }).ok, true);
});

test('D71 S3 (e, g): a contradiction may cite the human\'s message, an edit\'s recorded file content or the project\'s '
  + 'instruction file, each under its own closed source, checked by structure', async (t) => {
  const { session } = await load(t, channelRows());
  const n = channelIds(session);
  const said = (text) => quote(n.closing.id, 'commentary', text);
  const claims = [
    { text: 'five columns', stated: said('The export wrote 5 columns before.'),
      contradictedBy: quote(n.ask.id, 'instruction', 'The export writes 3 columns today.') },
    { text: 'only json', stated: said('The export only ever wrote JSON.'),
      contradictedBy: quote(n.edit.id, 'code', 'const fmt = "csv";') },
    { text: 'no rule', stated: said('There is no rule against new dependencies.'),
      contradictedBy: quote(n.rules.id, 'project-instructions', 'Never add a runtime dependency.') },
    { text: 'added line', stated: said('Done.'), contradictedBy: quote(n.edit.id, 'code', 'const fmt = "json";') },
    { text: 'later', stated: said('The export wrote 5 columns before.'),
      contradictedBy: quote(n.later.id, 'instruction', LATER) },
  ];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only',
    judge: judgeOf(() => ({ ...empty(), claims })) });
  const findingOf = (text) => report.findings.find((finding) => finding.explanation === text);
  assert.equal(findingOf('five columns').contradictionSource, 'human_message');
  assert.ok(findingOf('five columns').title.startsWith(CONTRADICTION_TITLES.instruction));
  assert.equal(findingOf('only json').contradictionSource, 'file_content');
  assert.equal(findingOf('no rule').contradictionSource, 'project_instructions');
  // W2: an added line is what the agent wrote (own_written), never recorded file content; here the agent's later edit
  // of the same file (the lint fix) changed it again before it spoke, so it is withheld (`source_rewritten`).
  assert.equal(findingOf('added line'), undefined, 'an added line is what the agent wrote, never recorded file content');
  assert.equal(findingOf('later'), undefined, 'a message recorded after the words never contradicts them');
  assert.deepEqual(report.counts.checklist.contradictions, { result: 0, human_message: 1, file_content: 1,
    project_instructions: 1, own_written: 0 });
  // The structural check itself, by cause.
  const verified = (claim) => findingReceiptCheck(session, 'claim_contradicted', [claim.stated, claim.contradictedBy],
    { contradiction: true });
  assert.deepEqual([verified(claims[3]).ok, verified(claims[3]).cause], [false, 'source_rewritten']);
  assert.deepEqual([verified(claims[4]).ok, verified(claims[4]).cause], [false, 'source_not_before']);
  assert.equal(contradictionSourceOf(session, [{ ...claims[0].stated }, { ...claims[0].contradictedBy }]).source, 'human_message');
  // Without the session route's flag, only a RESULT may contradict (the combined route, unchanged).
  assert.equal(findingReceiptCheck(session, 'claim_contradicted', [claims[0].stated, claims[0].contradictedBy]).cause,
    'role_missing');
  assert.ok(CLAIM_NOTE.includes("the project's\ninstruction file") || CLAIM_NOTE.includes("the project's instruction file"));
});

test('D71 S3 (f): a claim the reviewer marks as an assumption is counted and keeps its status', async (t) => {
  const { session } = await load(t, channelRows());
  const n = channelIds(session);
  const answer = () => ({ ...empty(), claims: [
    { text: 'assumed', stated: quote(n.closing.id, 'commentary', 'There is no rule against new dependencies.'), assumption: true },
    { text: 'plain', stated: quote(n.closing.id, 'commentary', 'Done.'), assumption: null },
  ] });
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf(answer) });
  const promiseOf = (text) => report.promises.find((promise) => promise.text === text);
  assert.equal(promiseOf('assumed').assumption, true);
  assert.equal(promiseOf('assumed').status, 'open');
  assert.equal(Object.hasOwn(promiseOf('plain'), 'assumption'), false);
  assert.deepEqual(report.counts.checklist.assumptions, { proposed: 1, published: 1 });
});

test('D71 S3: the human\'s words above stay the standard; the ask is unchanged by the new block', async (t) => {
  const { session } = await load(t, channelRows());
  const { prompt } = planWindowRequests({ session, reviewScope: 'session-only' }).requests[0].request;
  assert.ok(prompt.indexOf(ASK) < prompt.indexOf(PROJECT_INSTRUCTIONS_HEADER[0]));
  assert.ok(prompt.includes('Ask for any of them under step 6.'));
  assert.ok(prompt.endsWith('Go through the checklist (steps 1 to 6) and return ONE JSON object in the shape HOW TO ANSWER gives.'));
});
