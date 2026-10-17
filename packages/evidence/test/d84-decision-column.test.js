// The column fix (owner decisions D83 (2) and D84, 2026-10-12): the decision column on its normal path, after
// decisions step 3 and D81's brief were reverted.
//   Fix 1: what the person wrote for the agent in the project's instruction file counts as their words. A decision's
//     covering receipt may cite the session's project instruction file when the main agent was shown it before the
//     decision's first action; its role comes from the cited event, never from the model's word; asked-settled only
//     when the value quote is in that same file; the row names the file (`referredFrom`), and the page, the story and
//     the report say "Referred from <path>". A challenge vote citing the file is counted (the session core names the
//     role; before, every such vote was dropped).
//   Fix 2: the brief and the challenge say "you asked, the agent chose how" only when doing what was asked requires
//     deciding the question at all, even when the agent's answer is one of several.
// Every recording here is synthetic (invented asks, rules, paths and code); no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { row, humanAsk, call, result, said, load } from './m33-u-unasked-fixture.js';
import { runReview } from '../src/run-review.js';
import { groundDecision, deriveColumn, projectFilesBefore, constraintWithSourceRole, shownProjectInstructions,
  reviewWithSourceRoles } from '../src/ledger.js';
import { CHALLENGE_PROFILE, CHECKLIST_PROPOSITIONS, CHECKLIST_CHALLENGE_SCHEMA, CHALLENGE_SCHEMA, DECISION_NOTE,
  checklistProposition, challengeItems, challengeSystem } from '../src/challenge.js';
import { SONAH_SESSION_REVIEW_AGENT, SESSION_REVIEW_AGENT_VERSION } from '../src/review-agent.js';
import { PROMPT_VERSION, SESSION_NARRATIVE_SCHEMA, NARRATIVE_SCHEMA } from '../src/prompt.js';
import { renderSessionPage, PAGE_VERSION } from '../../render/session-page.js';
import { REPORT_ITEM_WORDS } from '../../render/report-words.js';
import { renderReportMarkdown, STORY_VERSION } from '../../render/session-story.js';

const ASK = 'Write the parser in src/parser.js.';
const RULE = 'Trim every input with s.trim() before parsing it.';
const RULES = `# Project rules\n${RULE}\nNever add a runtime dependency.`;
const CODE = 'export const parse = (s) => s.trim();\n';
const projectFile = () => row({ type: 'attachment', attachment: { type: 'instructions',
  files: [{ path: '/repo/CLAUDE.md', type: 'Project', content: RULES }] } });
/** One request: the ask, the project's instruction file (before the write, or after it: `late`), the write that adopted
 *  the choice, and the agent's closing words. */
const rows = ({ late = false } = {}) => [
  humanAsk(ASK),
  ...(late ? [] : [projectFile()]),
  call('w1', 'Write', { file_path: '/repo/src/parser.js', content: CODE }, 'Writing the parser now.'),
  result('w1', 'File created successfully at: /repo/src/parser.js', { type: 'create', filePath: '/repo/src/parser.js',
    content: CODE, structuredPatch: [] }),
  ...(late ? [projectFile()] : []),
  said('The parser is written.'),
].map((r, i) => ({ ...r, uuid: `u-d84-${i + 1}` }));

async function fixture(t, options) {
  const { session } = await load(t, rows(options));
  const ask = session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  const write = session.events.find((e) => e.kind === 'invocation' && e.operation === 'write');
  return { session, ask, write, file: session.projectInstructions[0] ?? null };
}

const fileQuote = (file, quote = RULE, role = 'project-instructions') => ({ eventId: file.id, role, quote });
/** The window's answer: one decision adopted by the write, answering to `constrainedBy`. */
const answerOf = (write, constrainedBy) => ({ decisions: [{ dimension: 'input trimming', chosen: 'trim the input',
  value: 's.trim()', valueReceipt: { eventId: write.id, field: 'added-code', role: 'code', quote: 's.trim()' },
  actions: [write.id], constrainedBy }], pivots: [], claims: [], requirements: [] });
/** Every challenge item upheld by votes citing `receiptOf(item)`. */
const judgeOf = (answer, receiptOf) => async (request) => (!request.challenge ? answer
  : { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.',
    receipts: [receiptOf(item)] })) });
const review = (session, judge) => runReview({ session, judge, reviewScope: 'session-only' });
const only = (report) => { assert.equal(report.decisions.length, 1); return report.decisions[0]; };
const label = (text) => `<span class="label">${text}</span>`;
const ground = (session, write, constrainedBy) => groundDecision({ repo: { host: 'github.com', id: '0' }, session,
  pr: null, candidate: { actorSession: session.sessionKey, dimension: 'input trimming', chosen: 'trim the input',
    actions: [write.id], constrainedBy }, instructionHistoryComplete: true, notActing: true }).decision;

test('fix-column: the versions, once each, and the closed words', () => {
  // P1 (the asks fixes) moved it once more (sonah.session-review-agent/9): a run refused at every attempt.
  // W1 B moved it once more (sonah.session-review-agent/10): an edit may go against a project instruction file.
  // W2 moved it once more (sonah.session-review-agent/11): a claim is compared with the evidence; the agent's own text.
  assert.equal(SESSION_REVIEW_AGENT_VERSION, 'sonah.session-review-agent/11');
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
  // W1 A moved it once more (sonah.session-page/25): a decision kept "could not tell" for a refuted column says why.
  // W2 moved it once more (sonah.session-page/26): the agent's own earlier text that contradicts a claim says so.
  // W4 moved it once more (sonah.session-page/27): an ask no action followed reads not done in this session.
  // D87 moved it once more (sonah.session-page/28, its /27 renumbered at the merge): a review with a code pass lists
  // what the code review found.
  // The W4 revert moved it once more (sonah.session-page/29): W4's words beside an ask are gone with W4.
  // D88 moved it once more (sonah.session-page/30): the judgment first, the rows Sonah could not check folded.
  // The code step moved it once more (sonah.session-page/31, renumbered at its merge with D88): what the code
  // review found, in the method's order. The review of the code step moved it once more (sonah.session-page/32): the
  // footer counts paths outside the working directory.
  // The judgment-first review moved it once more (sonah.session-page/33): one counting, folded groups by their count.
  // The release review moved it once more (sonah.session-page/34): the home folder as the repository, in the footer.
  // The agentic code step's release item moved it once more (sonah.session-page/35): an ask's status beside what the
  // code step tied to it, the session shown as loaded, and the code step's new report.
  // The cleanup moved it once more (sonah.session-page/36): no statement found to hold, no row shown in the code, no
  // claim found false and no all-clear footer.
  // The report model moved it once more (sonah.session-page/37, D97): the page renders the report's tiers.
  // D98 moved it once more (sonah.session-page/38): what the agent did and what Sonah could not check read one effect rule.
  // D99 moved it once more (sonah.session-page/39): a background run's end is said absent only where it is proved.
  // D100 moved it once more (sonah.session-page/40): an absence only where code proves it.
  // D101 moved it once more (sonah.session-page/41): an ask says which test refused its quote.
  // D104 moved it once more (sonah.session-page/42): the shown-in-part mark.
  assert.equal(PAGE_VERSION, 'sonah.session-page/42', 'renumbered later: /23 is D84\'s masking; /25 is W1 A\'s');
  // W1 B moved it once more (sonah.session-story/20): a project file's rule of an edit is labelled as the file's.
  // W2 moved it once more (sonah.session-story/21): the agent's own earlier text that contradicts a claim says so.
  // The review of W4 moved it once more (sonah.session-story/22): an ask no action followed says why it reads not done.
  // D87 moved it once more (sonah.session-story/23, its /22 renumbered at the merge): a review with a code pass lists
  // what the code review found.
  // The W4 revert moved it once more (sonah.session-story/24): W4's words beside an ask are gone with W4.
  // D88 moved it once more (sonah.session-story/25): the judgment first, the rows Sonah could not check folded.
  // The code step moved it once more (sonah.session-story/26, renumbered at its merge with D88): what the code
  // review found, in the method's order. The review of the code step moved it once more (sonah.session-story/27): the
  // footer counts paths outside the working directory.
  // The judgment-first review moved it once more (sonah.session-story/28): one counting, the claims every reader lists.
  // The release review moved it once more (sonah.session-story/29): the home folder as the repository, in the footer.
  // The agentic code step's release item moved it once more (sonah.session-story/30): an ask's status beside what the
  // code step tied to it, the session shown as loaded, and the code step's new report.
  // The cleanup moved it once more (sonah.session-story/31): no statement found to hold, no row shown in the code, no
  // claim found false and no all-clear footer.
  // D97 moved it once more (sonah.session-story/32): the story is the report .md, the report model rendered for a pull
  // request comment. D98 moved it once more (sonah.session-story/33): its rows, runs and gaps read one effect rule.
  // D99 moved it once more (sonah.session-story/34): a background run's end, and a stopped run, in the page's words.
  // D100 moved it once more (sonah.session-story/35): an absence only where code proves it.
  // D101 moved it once more (sonah.session-story/36): an ask says which test refused its quote.
  // D104 moved it once more (sonah.session-story/37): the shown-in-part mark.
  assert.equal(STORY_VERSION, 'sonah.session-story/37', 'renumbered later: /18 is D84\'s masking');
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  // D103 moved it once more (sonah.narrative/38): a Claude Code recording's results shown up to 12,000 bytes a side.
  assert.equal(PROMPT_VERSION, 'sonah.narrative/38', 'no narrative request byte moved here (/31)');
  assert.equal(REPORT_ITEM_WORDS.referredFrom('CLAUDE.md'), 'The project instruction file CLAUDE.md says:');
});

test('fix-column: a project instruction file that fixed the value -> asked and settled, named by its file everywhere',
  async (t) => {
    const { session, write, file } = await fixture(t);
    assert.equal(file.path, 'CLAUDE.md', 'premise: the slicer carries the project file at its row');
    assert.deepEqual(projectFilesBefore(session, [write]), [{ eventId: file.id, path: 'CLAUDE.md' }]);
    // The challengers uphold it citing the file's own words (role project-instructions).
    const report = await review(session, judgeOf(answerOf(write, { instruction: fileQuote(file), settles: true,
      settledValueQuote: 's.trim()' }), () => fileQuote(file)));
    const d = only(report);
    assert.equal(d.column, 'asked-settled');
    assert.equal(d.columnState, 'grounded');
    assert.deepEqual({ ...d.constrainedBy, instruction: { ...d.constrainedBy.instruction } },
      { instruction: { eventId: file.id, role: 'project-instructions', quote: RULE }, settles: true,
        settledValueQuote: 's.trim()', referredFrom: 'CLAUDE.md' });
    // The page, the story and the report name the file; none says the words were said in the session.
    // D97: a decision you settled is listed under What the agent did, the file's words under the file's name.
    const html = renderSessionPage(session, report);
    assert.ok(html.includes(`${label(REPORT_ITEM_WORDS.referredFrom('CLAUDE.md'))} <q class="said">`), 'the page names the file');
    assert.ok(!html.includes(label(REPORT_ITEM_WORDS.youSaid)) && !html.includes(label(REPORT_ITEM_WORDS.youAsked)));
    const story = renderReportMarkdown(session, report);
    assert.ok(story.includes(`${REPORT_ITEM_WORDS.referredFrom('CLAUDE.md')} “`), 'the report .md names the file');
    assert.ok(!story.includes(`${REPORT_ITEM_WORDS.youSaid} “`) && !story.includes(`${REPORT_ITEM_WORDS.youAsked} “`));
  });

test('fix-column: a vote citing the project file is counted; the combined route still admits its five roles only',
  async () => {
    const item = { key: 'decisions:0', type: 'decision', candidate: { dimension: 'input trimming', chosen: 'trim',
      actions: ['W1'], constrainedBy: { instruction: { eventId: 'P1', role: 'project-instructions', quote: RULE },
        settles: false, settledValueQuote: null } } };
    const judge = async (request) => ({ votes: request.challenge.items.map((i) => ({ key: i.key,
      verdict: 'not-refuted', explanation: 'x',
      receipts: [{ eventId: 'P1', role: 'project-instructions', quote: RULE }] })) });
    const verifyReceipt = (r) => ({ ok: true, receipt: { eventId: r.eventId, role: r.role, quote: r.quote } });
    const run = (checklist) => challengeItems({ items: [item], judge, evidence: 'SYNTHETIC evidence', verifyReceipt,
      checklist });
    const session = await run(true);
    assert.equal(session.survivors.length, 1, 'a session vote of role project-instructions counts');
    assert.ok(session.results[0].votes.every((v) => v.valid));
    const combined = await run(false);
    assert.equal(combined.survivors.length, 0);
    assert.ok(combined.results[0].votes.every((v) => !v.valid && v.reason === 'receipt_rejected'));
    const roles = (schema) => schema.properties.votes.items.properties.receipts.items.properties.role.enum;
    assert.deepEqual(roles(CHECKLIST_CHALLENGE_SCHEMA), [...roles(CHALLENGE_SCHEMA), 'project-instructions']);
    assert.deepEqual(roles(CHALLENGE_SCHEMA), ['instruction', 'commentary', 'action', 'observation', 'code']);
  });

test('fix-column: the role comes from the cited source, never from the model\'s word', async (t) => {
  const { session, write, file, ask } = await fixture(t);
  // The answer names the file with role instruction: code gives it the file's role before the challenge and the ledger.
  const seen = [];
  const judge = judgeOf(answerOf(write, { instruction: fileQuote(file, RULE, 'instruction'), settles: false,
    settledValueQuote: null }), () => ({ eventId: write.id, role: 'code', quote: 's.trim()' }));
  const report = await review(session, async (request) => { seen.push(request); return judge(request); });
  const d = only(report);
  assert.equal(d.column, 'asked-chose');
  assert.equal(d.constrainedBy.instruction.role, 'project-instructions');
  assert.equal(d.constrainedBy.referredFrom, 'CLAUDE.md');
  const asked = seen.filter((r) => r.challenge).flatMap((r) => r.challenge.items).find((i) => i.type === 'decision');
  assert.equal(asked.candidate.constrainedBy.instruction.role, 'project-instructions');
  assert.equal(checklistProposition(asked), CHECKLIST_PROPOSITIONS.decisionChoseHowFile,
    'its proposition names the file');
  // The page shows the file's words under its path, never "You asked".
  const html = renderSessionPage(session, report);
  assert.ok(html.includes(`${label(REPORT_ITEM_WORDS.referredFrom('CLAUDE.md'))} <q class="said">`));
  assert.ok(!html.includes(label(REPORT_ITEM_WORDS.youAsked)), 'never "You asked" for words the file holds');
  // A human instruction cited with the file's role stays refused, as before.
  const human = ground(session, write, { instruction: { eventId: ask.id, role: 'project-instructions', quote: ASK },
    settles: false, settledValueQuote: null });
  assert.equal(human.column, null);
  assert.ok(human.reasons.includes('ambiguous_authority'));
  // Pure: only a receipt citing a project file moves; anything else is the same object.
  const kept = { instruction: { eventId: ask.id, role: 'instruction', quote: ASK }, settles: false };
  assert.equal(constraintWithSourceRole(session, kept), kept);
  assert.equal(constraintWithSourceRole(session, null), null);
});

test('fix-column: the ledger grounds a file\'s covering receipt verbatim, its value in that same file', async (t) => {
  const { session, write, file } = await fixture(t);
  const settled = ground(session, write,
    { instruction: fileQuote(file), settles: true, settledValueQuote: 's.trim()' });
  assert.equal(settled.column, 'asked-settled', 'control');
  for (const [name, constrainedBy, reason] of [
    ['a quote not in the file', { instruction: fileQuote(file, 'Always trim with a regular expression.'),
      settles: false, settledValueQuote: null }, 'receipt_rejected'],
    ['a value not in the file', { instruction: fileQuote(file), settles: true,
      settledValueQuote: 'a regular expression' }, 'receipt_rejected'],
    ['a value only in the human ask', { instruction: fileQuote(file), settles: true,
      settledValueQuote: 'src/parser.js' }, 'receipt_rejected'],
    ['settled with no value', { instruction: fileQuote(file), settles: true, settledValueQuote: null },
      'column_unchecked'],
    // As a human instruction's: a value quote with "the agent chose how" contradicts it, and a value shorter than
    // MIN_QUOTE_CHARS grounds against almost any file, so neither carries a column (here both are in the file).
    ['chose how, with a value', { instruction: fileQuote(file), settles: false, settledValueQuote: 's.trim()' },
      'column_unchecked'],
    ['a value too short to fix anything', { instruction: fileQuote(file), settles: true, settledValueQuote: 'Tri' },
      'column_unchecked'],
  ]) {
    const d = ground(session, write, constrainedBy);
    assert.equal(d.column, null, name);
    assert.equal(d.constrainedBy, null, name);
    assert.ok(d.reasons.includes(reason), `${name}: ${reason}`);
  }
  // A `referredFrom` is code's alone: a proposed one is dropped, on a file's row and on a human instruction's.
  const proposed = ground(session, write, { instruction: fileQuote(file), settles: false, settledValueQuote: null,
    referredFrom: 'SYNTHETIC/OTHER.md' });
  assert.equal(proposed.constrainedBy.referredFrom, 'CLAUDE.md');
  const ask = session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  const human = ground(session, write, { instruction: { eventId: ask.id, role: 'instruction', quote: ASK },
    settles: false, settledValueQuote: null, referredFrom: 'SYNTHETIC/OTHER.md' });
  assert.equal(human.column, 'asked-chose');
  assert.ok(!Object.hasOwn(human.constrainedBy, 'referredFrom'), 'a human instruction is never referred from a file');
});

test('fix-column: a helper\'s decision takes no column from the main agent\'s project file', async (t) => {
  const { session, write, file } = await fixture(t);
  const relation = { instruction: fileQuote(file), settles: false, settledValueQuote: null };
  const column = (actor) => deriveColumn(session, relation, true, [write], null, 'input trimming',
    actor ? { actor } : {});
  assert.equal(column(null).column, 'asked-chose', 'control: the main agent\'s decision');
  assert.deepEqual(column({ state: 'verified-child' }),
    { column: null, columnState: 'unchecked', reason: 'instructions_partial' });
});

test('fix-column: the report .md names the file only when the covering words ground in it', async (t) => {
  const { session, write, file } = await fixture(t);
  const report = await review(session, judgeOf(answerOf(write, { instruction: fileQuote(file), settles: true,
    settledValueQuote: 's.trim()' }), () => fileQuote(file)));
  assert.ok(renderReportMarkdown(session, report).includes(REPORT_ITEM_WORDS.referredFrom('CLAUDE.md')), 'control');
  // A report whose receipt no longer grounds in the file (edited, or from another recording) names no file.
  const d = only(report);
  const edited = { ...report, decisions: [{ ...d, constrainedBy: { ...d.constrainedBy,
    instruction: { ...d.constrainedBy.instruction, quote: 'SYNTHETIC words the file does not hold.' } } }] };
  // D97: the report .md shows no words that do not ground, and names the file only beside words found in it.
  const story = renderReportMarkdown(session, edited);
  assert.ok(!story.includes('SYNTHETIC words the file does not hold.'));
  for (const [, words] of story.matchAll(/The project instruction file CLAUDE\.md says: “([^”]*)”/g))
    assert.ok(session.textSpansOf(file, 'text').some((span) => span.includes(words)), words);
});

test('fix-column: the ledger itself gives a covering receipt the role of the source it cites', async (t) => {
  // Not only run-review.js: groundDecision reads the cited event too, so a row grounded on any route publishes the
  // file's role and names the file, whatever role the answer wrote.
  const { session, write, file } = await fixture(t);
  const d = ground(session, write, { instruction: fileQuote(file, RULE, 'instruction'), settles: true,
    settledValueQuote: 's.trim()' });
  assert.equal(d.column, 'asked-settled');
  assert.equal(d.constrainedBy.instruction.role, 'project-instructions');
  assert.equal(d.constrainedBy.referredFrom, 'CLAUDE.md');
});

test('fix-column: the files a decision may answer to: the main agent\'s, shown, not a repeat, before its first action',
  () => {
    // Pure (`projectFilesBefore`): a session reduced to what the rule reads — each file's place, path, helper and
    // visible text.
    const entry = (id, afterSequence, { path = 'CLAUDE.md', text = RULES, childId = null } = {}) =>
      ({ id, kind: 'project-instructions', afterSequence, path, text, childId });
    const session = { textSpansOf: (e) => [e.text], projectInstructions: [
      entry('P1', 0), entry('P2', 1, { childId: 'agent-1' }), entry('P3', 2), entry('P4', 3, { path: 'AGENTS.md' }),
      entry('P5', 4, { path: 'docs/CLAUDE.md', text: '  \n' }), entry('P6', 9, { path: 'late/CLAUDE.md' })] };
    const at = (sequence) => [{ sequence }];
    const listed = (anchors, upTo) => projectFilesBefore(session, anchors, upTo).map((f) => f.eventId);
    // P2 was a helper's, P3 repeats P1, P5 shows nothing, P6 came after the action.
    assert.deepEqual(projectFilesBefore(session, at(8)),
      [{ eventId: 'P1', path: 'CLAUDE.md' }, { eventId: 'P4', path: 'AGENTS.md' }]);
    assert.deepEqual(listed(at(10)), ['P1', 'P4', 'P6']);
    assert.deepEqual(listed(at(10), 9), ['P1', 'P4'], 'never a file recorded after the window');
    assert.deepEqual(listed(at(3)), ['P1'], 'a file recorded right after the earliest action is not before it');
    assert.deepEqual(listed([...at(12), ...at(1)]), ['P1'], 'the earliest anchor bounds it');
    assert.deepEqual(listed(at(0)), []);
  });

test('fix-column: a file recorded after the decision\'s first action is not one it answers to', async (t) => {
  const { session, write, file } = await fixture(t, { late: true });
  assert.ok(file, 'premise: the file is recorded');
  assert.deepEqual(projectFilesBefore(session, [write]), [], 'recorded after the write');
  assert.equal(shownProjectInstructions(session).length, 1, 'the whole session shows it');
  const d = ground(session, write, { instruction: fileQuote(file), settles: false, settledValueQuote: null });
  assert.equal(d.column, null);
  assert.ok(d.reasons.includes('ambiguous_authority'));
});

test('fix-column: a human instruction\'s relation is derived exactly as before', async (t) => {
  const { session, write, ask } = await fixture(t);
  const d = ground(session, write, { instruction: { eventId: ask.id, role: 'instruction', quote: ASK }, settles: true,
    settledValueQuote: 'src/parser.js' });
  assert.equal(d.column, 'asked-settled');
  assert.ok(!Object.hasOwn(d.constrainedBy, 'referredFrom'), 'no file, no referral');
  assert.equal(d.constrainedBy.settledValueQuote, 'src/parser.js');
});

test('fix-column: the session contract admits the file\'s role on a decision\'s covering receipt; the combined one not',
  () => {
    const session = SESSION_NARRATIVE_SCHEMA.properties.decisions.items.properties.constrainedBy;
    const combined = NARRATIVE_SCHEMA.properties.decisions.items.properties.constrainedBy;
    assert.deepEqual(session.properties.instruction.properties.role, { enum: ['instruction', 'project-instructions'] });
    assert.deepEqual(combined.properties.instruction.properties.role, { const: 'instruction' });
    assert.deepEqual(session.required, combined.required);
  });

const flat = (text) => text.replace(/\s+/g, ' ');
const once = (text, phrase, name) => assert.equal(flat(text).split(phrase).length, 2, `${name}: ${phrase}`);

test('fix-column: the brief and the note say whose words a decision answers to, and what settled requires', () => {
  for (const phrase of [
    'constrainedBy quotes the words the choice answers to: a human message, or a project instruction file given to the'
      + ' main agent before the decision\'s earliest action (role project-instructions), which the person wrote for the'
      + ' agent and whose words count as theirs',
    // 2026-10-13: settledValueQuote quotes exactly the words that state the choice's answer.
    'settledValueQuote quotes exactly those words (the person\'s, or the file\'s), from the same message or file: often'
      + ' not the words that ask for the work',
    '"constrainedBy": {"instruction": {"eventId":"E<k>","role":"instruction|project-instructions"',
    'settledValueQuote is then an exact span of that same message or file holding those words as written there',
    'If an earlier message or such a file covers it, use constrainedBy instead',
    'the rules the project set for the agent, never the human\'s messages',
  ]) once(SONAH_SESSION_REVIEW_AGENT, phrase, 'brief');
  once(DECISION_NOTE, '"constrainedBy" quotes the words the choice answers to: a human message, or a project'
    + ' instruction file the agent was given before the choice (role project-instructions), which the person wrote for'
    + ' the agent and which count as their words', 'DECISION_NOTE');
});

test('fix-column: a decision\'s proposition names the file when the covering receipt is the file\'s', () => {
  const decision = (role, settles, notActing = false) => ({ type: 'decision', candidate: { notActing,
    constrainedBy: { instruction: { eventId: 'X1', role, quote: 'SYNTHETIC rule' }, settles } } });
  assert.equal(checklistProposition(decision('project-instructions', true)),
    CHECKLIST_PROPOSITIONS.decisionSettledFile);
  assert.equal(checklistProposition(decision('project-instructions', false)),
    CHECKLIST_PROPOSITIONS.decisionChoseHowFile);
  assert.equal(checklistProposition(decision('project-instructions', true, true)),
    CHECKLIST_PROPOSITIONS.decisionNotActingSettledFile);
  assert.equal(checklistProposition(decision('project-instructions', false, true)),
    CHECKLIST_PROPOSITIONS.decisionNotActingChoseHowFile);
  assert.equal(checklistProposition(decision('instruction', true)), CHECKLIST_PROPOSITIONS.decisionSettled);
  assert.equal(checklistProposition(decision('instruction', false)), CHECKLIST_PROPOSITIONS.decisionChoseHow);
  for (const name of ['decisionSettledFile', 'decisionChoseHowFile', 'decisionNotActingSettledFile',
    'decisionNotActingChoseHowFile'])
    assert.ok(CHECKLIST_PROPOSITIONS[name].includes('project instruction file'), name);
});

// ---- Fix 2: the column's wording, said once, the way the owner meant it ------------------------------------------

test('fix-column: the brief says when "you asked, the agent chose how" holds, one invented example each way', () => {
  const brief = SONAH_SESSION_REVIEW_AGENT;
  for (const phrase of [
    'ask whether doing what was asked requires deciding this question at all',
    'When every way of doing it has to answer the question, it is "You asked, the agent chose how", even though the'
      + ' agent\'s answer is one of several it could have given',
    'a fix for empty names has to decide what an empty name returns',
    'When what was asked could be done without deciding the question, it is "Made without asking you"',
    'a new retry policy that the request did not need',
    // D84: "or a file" (a project instruction file is checked beside the messages).
    'A message or a file covers the topic when it fixed the choice, or when doing what it asked requires deciding this'
      + ' question',
  ]) once(brief, phrase, 'brief');
  // The earlier lean wording, and D81's wording that was read as "other ways existed, so it was not asked", are gone.
  for (const gone of ['can cover a topic without naming its mechanism', 'must make', 'any way of doing'])
    assert.ok(!flat(brief).includes(gone), `brief: ${gone}`);
});

test('fix-column: the challenge judges the column by the same rule; the combined route keeps its text', () => {
  for (const phrase of [
    'it holds only when doing what those words asked requires deciding this question at all: every way of doing it has'
      + ' to answer the question, even when the agent\'s answer is one of several it could have given',
    'If what they asked could be done without deciding the question, the choice was made without asking: refute.',
    'a project instruction file the agent was given before the choice (role project-instructions), which the person'
      + ' wrote for the agent and which count as their words',
  ]) once(DECISION_NOTE, phrase, 'DECISION_NOTE');
  for (const text of [DECISION_NOTE, ...Object.values(CHECKLIST_PROPOSITIONS)])
    for (const gone of ['must make', 'any way of doing', 'even when the agent selected its mechanism'])
      assert.ok(!text.includes(gone), gone);
  for (const name of ['decisionChoseHow', 'decisionNotActingChoseHow', 'decisionChoseHowFile',
    'decisionNotActingChoseHowFile'])
    assert.ok(CHECKLIST_PROPOSITIONS[name].includes('requires deciding the question'), name);
  // D71 (i): the combined challenge's SYSTEM is not the session route's and did not move.
  assert.ok(flat(challengeSystem()).includes('can cover the topic even if the agent selected its mechanism'));
});

test('fix-column: no product code reads the column\'s words; they are prompt text only', async () => {
  const roots = ['../src/', '../adapters/', '../../render/', '../../cli/src/'];
  for (const root of roots) {
    const dir = new URL(root, import.meta.url);
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.js'))) {
      if (['review-agent.js', 'challenge.js'].includes(name) && root === '../src/') continue;
      const text = await readFile(new URL(name, dir), 'utf8');
      for (const phrase of ['requires deciding', 'one of several', 'retry policy'])
        assert.ok(!text.includes(phrase), `${root}${name}: ${phrase}`);
    }
  }
});

// ---- D84: "made without asking you" checks the shown project files too -------------------------------
//
// Owner decision D84: the project instruction files a decision's window showed the main agent before its
// earliest action (`projectFilesBefore`, the set fix 1's covering receipt may cite) are part of the scope an
// instructionReview checks, beside the human messages. Structure only: which files, where they were recorded, and
// whether each check's quote is literally in the file it cites.

const digestOf = (prompt) => /^scopeDigest: (\S+)$/m.exec(prompt)?.[1] ?? null;
const askCheck = (ask) => ({ instruction: { eventId: ask.id, role: 'instruction', quote: ASK }, relevant: false,
  explanation: 'SYNTHETIC: the ask names the file, not how its input is trimmed.' });
const fileCheck = (file, { quote = RULE, role = 'project-instructions', relevant = false } = {}) => ({
  instruction: { eventId: file.id, role, quote }, relevant,
  explanation: 'SYNTHETIC: the project file says nothing that covers this choice.' });
/** The window's answer: one decision adopted by the write, "made without asking you" with these checks. */
const unaskedAnswer = (write, scopeDigest, checks) => ({ decisions: [{ dimension: 'input trimming',
  chosen: 'trim the input', value: 's.trim()',
  valueReceipt: { eventId: write.id, field: 'added-code', role: 'code', quote: 's.trim()' }, actions: [write.id],
  instructionReview: { dimension: 'input trimming', scopeDigest, noRelevantInstruction: true, checks } }],
pivots: [], claims: [], requirements: [] });
/** A session-only review whose one window answers with `checksOf(scopeDigest)`, every challenge item upheld citing the
 *  write; `seen` gets every challenge request. */
const unaskedReview = (session, write, checksOf, seen = []) => runReview({ session, reviewScope: 'session-only',
  judge: async (request) => {
    if (!request.challenge) return unaskedAnswer(write, digestOf(request.prompt), checksOf(digestOf(request.prompt)));
    seen.push(request);
    return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
      explanation: 'Synthetic.', receipts: [{ eventId: write.id, role: 'code', quote: 's.trim()' }] })) };
  } });

test('D84: a decision a shown project file could cover is never "made without asking you" on the messages alone',
  async (t) => {
    const { session, write, ask, file } = await fixture(t);
    assert.deepEqual(projectFilesBefore(session, [write]), [{ eventId: file.id, path: 'CLAUDE.md' }], 'premise');
    // The review checked the ask alone: before D84 this grounded "made without asking you".
    const messagesOnly = await unaskedReview(session, write, () => [askCheck(ask)]);
    const d = only(messagesOnly);
    assert.equal(d.column, null);
    assert.equal(d.columnState, 'unchecked');
    assert.deepEqual(d.reasons, ['column_unchecked']);
    // The window's own record counts the same unchecked column the published row shows (its grounding takes the flag).
    assert.equal(messagesOnly.windowResults.length, 1);
    assert.equal(messagesOnly.windowResults[0].grounding.uncheckedColumns, 1);
    // Checked beside the ask, the file (its quote literally in it, not relevant) grounds it, published as the file's.
    const withFile = await unaskedReview(session, write, () => [askCheck(ask), fileCheck(file)]);
    const both = only(withFile);
    assert.equal(both.column, 'unasked');
    assert.equal(both.columnState, 'grounded');
    assert.equal(withFile.windowResults[0].grounding.uncheckedColumns, 0);
    assert.deepEqual(both.instructionReview.checks.map((c) => [c.instruction.eventId, c.instruction.role]),
      [[ask.id, 'instruction'], [file.id, 'project-instructions']]);
  });

test('D84: a check marking the file relevant blocks "without asking" as a relevant message does', async (t) => {
  const { session, write, ask, file } = await fixture(t);
  const scopeDigest = digestOf((await import('../src/prompt.js')).buildNarrativePrompt({ session,
    window: { index: 0, events: session.events }, reviewScope: 'session-only' }).prompt);
  const groundWith = (checks) => groundDecision({ repo: { host: 'github.com', id: '0' }, session, pr: null,
    candidate: { actorSession: session.sessionKey, ...unaskedAnswer(write, scopeDigest, checks).decisions[0] },
    instructionHistoryComplete: true, projectFilesShown: true }).decision;
  assert.equal(groundWith([askCheck(ask), fileCheck(file)]).column, 'unasked', 'premise: the scope digest');
  // The ledger's rule: a relevant check of the file (its quote literally in it) and one of the ask end alike.
  const relevantFile = groundWith([askCheck(ask), fileCheck(file, { relevant: true })]);
  const relevantAsk = groundWith([{ ...askCheck(ask), relevant: true }, fileCheck(file)]);
  for (const d of [relevantFile, relevantAsk]) {
    assert.equal(d.column, null);
    assert.deepEqual(d.reasons, ['column_unchecked']);
  }
  // Through the review, the answer contract reads either as no review it can publish (relevant is false or absent).
  for (const checks of [[askCheck(ask), fileCheck(file, { relevant: true })],
    [{ ...askCheck(ask), relevant: true }, fileCheck(file)]])
    assert.deepEqual((await unaskedReview(session, write, () => checks)).decisions, []);
  // The file's quote must be literally in the file it cites.
  const elsewhere = groundWith([askCheck(ask), fileCheck(file, { quote: 'SYNTHETIC words the file never holds' })]);
  assert.equal(elsewhere.column, null);
  assert.deepEqual(elsewhere.reasons, ['receipt_rejected']);
});

test('D84: a file shown after the decision\'s first action is not in its scope', async (t) => {
  const { session, write, ask, file } = await fixture(t, { late: true });
  assert.deepEqual(projectFilesBefore(session, [write]), [], 'premise: recorded after the write');
  assert.equal(shownProjectInstructions(session).length, 1, 'premise: the window shows it');
  const d = only(await unaskedReview(session, write, () => [askCheck(ask)]));
  assert.equal(d.column, 'unasked', 'the ask alone is the whole scope');
  // A check of the later file is an extra check, as a check of a later message is.
  const extra = only(await unaskedReview(session, write, () => [askCheck(ask), fileCheck(file)]));
  assert.equal(extra.column, null);
  assert.deepEqual(extra.reasons, ['column_unchecked']);
});

test('D84: the file check\'s role comes from the cited source; the challenge is asked the files\' proposition',
  async (t) => {
    const { session, write, ask, file } = await fixture(t);
    const seen = [];
    const d = only(await unaskedReview(session, write, () => [askCheck(ask), fileCheck(file, { role: 'instruction' })],
      seen));
    assert.equal(d.column, 'unasked');
    assert.equal(d.instructionReview.checks[1].instruction.role, 'project-instructions');
    const prompts = seen.map((request) => request.prompt).join('\n');
    assert.ok(prompts.includes(CHECKLIST_PROPOSITIONS.decisionUnaskedFile), 'the files\' proposition');
    assert.ok(!prompts.includes(CHECKLIST_PROPOSITIONS.decisionUnasked), 'not the messages-only one');
    // Not only run-review.js: the ledger reads the cited event too, whatever role the check wrote.
    const scopeDigest = digestOf((await import('../src/prompt.js')).buildNarrativePrompt({ session,
      window: { index: 0, events: session.events }, reviewScope: 'session-only' }).prompt);
    const grounded = groundDecision({ repo: { host: 'github.com', id: '0' }, session, pr: null,
      candidate: { actorSession: session.sessionKey, ...unaskedAnswer(write, scopeDigest,
        [askCheck(ask), fileCheck(file, { role: 'instruction' })]).decisions[0] },
      instructionHistoryComplete: true, projectFilesShown: true }).decision;
    assert.equal(grounded.column, 'unasked');
    assert.equal(grounded.instructionReview.checks[1].instruction.role, 'project-instructions');
    // Pure: a review with no file check is returned as it came; one citing the file takes its role.
    const plainReview = { checks: [askCheck(ask)] };
    assert.equal(reviewWithSourceRoles(session, plainReview), plainReview);
    assert.equal(reviewWithSourceRoles(session, null), null);
    assert.equal(reviewWithSourceRoles(session, { checks: [askCheck(ask), fileCheck(file, { role: 'instruction' })] })
      .checks[1].instruction.role, 'project-instructions');
  });

test('D84: the combined route\'s windows show no file, so its scope stays the messages', async (t) => {
  const { session, write, ask } = await fixture(t);
  const scopeDigest = digestOf((await import('../src/prompt.js')).buildNarrativePrompt({ session,
    window: { index: 0, events: session.events } }).prompt);
  const candidate = { actorSession: session.sessionKey, dimension: 'input trimming', chosen: 'trim the input',
    actions: [write.id], instructionReview: { dimension: 'input trimming', scopeDigest, noRelevantInstruction: true,
      checks: [askCheck(ask)] } };
  const groundAs = (projectFilesShown) => groundDecision({ repo: { host: 'github.com', id: '0' }, session, pr: null,
    candidate, instructionHistoryComplete: true, projectFilesShown }).decision;
  assert.equal(groundAs(false).column, 'unasked');
  assert.equal(groundAs(true).column, null);
});

test('D84: the propositions, the brief, the note and the contract name the files', () => {
  const unasked = (role, notActing = false) => ({ type: 'decision', candidate: { notActing, instructionReview: {
    checks: [{ instruction: { eventId: 'H1', role: 'instruction', quote: 'SYNTHETIC ask' } },
      { instruction: { eventId: 'P1', role, quote: 'SYNTHETIC rule' } }] } } });
  assert.equal(checklistProposition(unasked('project-instructions')), CHECKLIST_PROPOSITIONS.decisionUnaskedFile);
  assert.equal(checklistProposition(unasked('project-instructions', true)),
    CHECKLIST_PROPOSITIONS.decisionNotActingUnaskedFile);
  assert.equal(checklistProposition(unasked('instruction')), CHECKLIST_PROPOSITIONS.decisionUnasked);
  assert.equal(checklistProposition(unasked('instruction', true)), CHECKLIST_PROPOSITIONS.decisionNotActingUnasked);
  for (const name of ['decisionUnaskedFile', 'decisionNotActingUnaskedFile'])
    assert.ok(CHECKLIST_PROPOSITIONS[name].includes('no project instruction file given to the agent before'), name);
  for (const phrase of [
    'and one for every project instruction file given to the main agent before it (rules under HOW TO ANSWER)',
    'and one for EVERY project instruction file given to the main agent before that action (role'
      + ' project-instructions, by the file\'s own id)',
    '"role":"instruction|project-instructions","quote":"exact span"}, "relevant": false',
    'its checks cover every human message listed there, and every such file, recorded before them',
  ]) once(SONAH_SESSION_REVIEW_AGENT, phrase, 'brief');
  once(DECISION_NOTE, 'earlier windows included, and every project instruction file the agent was given before the'
    + ' choice: refute when an earlier message or such a file fixed the choice', 'DECISION_NOTE');
  const role = (schema) => schema.properties.decisions.items.properties.instructionReview.properties.checks.items
    .properties.instruction.properties.role;
  assert.deepEqual(role(SESSION_NARRATIVE_SCHEMA), { enum: ['instruction', 'project-instructions'] });
  assert.deepEqual(role(NARRATIVE_SCHEMA), { const: 'instruction' });
});

test('D84: the page counts the checked files apart and names them; a page with none reads as before',
  async (t) => {
    // D97: the item's evidence says it in one sentence.
    assert.equal(REPORT_ITEM_WORDS.checkedAgainst(1, ['CLAUDE.md']), 'The session review checked it against 1 earlier '
      + 'message and the project instruction file CLAUDE.md. None of them covered it.');
    assert.equal(REPORT_ITEM_WORDS.checkedAgainst(2, ['CLAUDE.md', 'AGENTS.md']), 'The session review checked it against '
      + '2 earlier messages and the project instruction files CLAUDE.md, AGENTS.md. None of them covered it.');
    // One message or one file: the second sentence is singular.
    assert.equal(REPORT_ITEM_WORDS.checkedAgainst(0, ['CLAUDE.md']), 'The session review checked it against the project '
      + 'instruction file CLAUDE.md. It did not cover it.');
    const { session, write, ask, file } = await fixture(t);
    const html = renderSessionPage(session, await unaskedReview(session, write, () => [askCheck(ask),
      fileCheck(file)]));
    assert.ok(html.includes(REPORT_ITEM_WORDS.checkedAgainst(1, ['CLAUDE.md'])), 'the sentence');
    assert.ok(!html.includes('not found in this recording'));
    const late = await fixture(t, { late: true });
    const before = renderSessionPage(late.session, await unaskedReview(late.session, late.write,
      () => [askCheck(late.ask)]));
    assert.ok(before.includes(REPORT_ITEM_WORDS.checkedAgainst(1)));
  });
