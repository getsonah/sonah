// D115 and D116 (the owner: "for the hn5, start work now"): every sentence the report prints is true in every case it can
// print.
// The truth check of real reports (private, bcheck/truth-check.json and ce-truth-check.json, "otherFalse") found two
// classes of sentence that claimed more than the code behind them proved:
//   1. (D115) A sentence about a row of the session review stated a fact of the whole session: "Sonah found no recorded result
//      or change for it" (no search ran; the recording held the results), "The session review found nothing that does
//      this ask before the recording ended" (the row cites nothing; the agent did the ask) and "Sonah could not read 13
//      asks of the session review" (Sonah read them: an agent's briefs to a helper). Each now claims no more than the
//      field it rests on, and each stands on a registered proof of that reach (absence-audit.js REVIEW_ROW_KEYS).
//   2. (D116) A question of the code review pointed at an item or an ask by its `concerns` key alone, which nothing checked
//      ("Where: item 44" from a question on one file's write permissions to a decision on another file's work queue).
//      Every pointer the report prints from that key now stands only where code checked the tie: the question's own
//      place overlaps the row's (D112 amended's rule). D116's review: so does the tier tie that the key draws (D96 R6),
//      whose sentence names the question ("Item N of the code review concerns it, so Sonah puts it in Must know.").
// Synthetic sessions only: no recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportPlacement } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_PROMPT_WORDS, REPORT_NOT_CHECKED_PARTS, REPORT_NOT_CHECKED_WORDS, REPORT_ITEM_WORDS, REPORT_TIER_WHY,
  REPORT_TIER_WORDS, REPORT_KIND_WORDS } from '../report-words.js';
import { CHECKLIST_REQUIREMENT_FACT_WORDS } from '../../evidence/src/review.js';
import { reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';
import { ABSENCE_PROOFS, ABSENCE_REGISTRY, ABSENCE_SCOPES, REVIEW_ROW_KEYS, READ_CENSUS, auditProblems, fingerprintOf }
  from './absence-audit.js';

const TIERS = ['must_act', 'must_know', 'good_to_know'];
const itemsOf = (model) => TIERS.flatMap((tier) => model.tiers[tier]);
const every = (model) => itemsOf(model).flatMap((item) => [item, ...item.members]);
const textOf = (parts) => parts.map((p) => p.text).join('');
const R = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });

// ---- 1. the session review's rows --------------------------------------------------------------------------------

const ASK = 'Read the research notes. Write the plan page. Do not use the keys in the other repositories. Show me the '
  + 'notes.';
const BRIEF = 'SYNTHETIC_BRIEF: never read credentials. Never modify the fixtures.';
/** Your message; a read of the research and the plan written (a recorded result and a change that do the asks); the
 *  agent's own words; a brief the agent wrote for a helper (an instruction of the helper's session, with its parent
 *  agent's authority); and, after it, the agent's rule against live keys, written into a file. */
function truthSession() {
  const b = sessionBuilder();
  b.ask('I1', ASK);
  b.read('R1', 'research/notes.md');
  b.run('R2', 'cat research/notes.md', 'succeeded', 'notes: three parts');
  b.change('W1', 'docs/plan.html', { after: '<h1>Plan</h1>\n' });
  b.say('C1', 'I read the notes and wrote the plan page.');
  b.delegate('D1', BRIEF, 'c1');
  b.ask('child:c1:H1', BRIEF, 'agent', 'c1');
  b.say('child:c1:C1', 'Done with the brief.', 'final', 'c1');
  b.change('W2', 'memory/no-live-keys.md', { after: 'Never use the live keys.\n' });
  b.say('F1', 'The plan page is written.', 'final');
  return b.session();
}
/** Asks: one the session review tied only to the agent's words (though a result and a change do it); one done by a
 *  change; one not checked with the end-of-recording fact (though a later write does it); two of the helper's brief; a
 *  row with no text (a shape Sonah cannot read); and one on an event the session does not hold. */
function truthReport(session) {
  return { coverage: 'complete', sessionReview: 'complete', reviewScope: 'session-only',
    windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null,
      challenge: { complete: true }, groundingComplete: true }],
    requirements: [
      { text: 'Read the research notes', instruction: R('instruction', 'I1', 'Read the research notes.'), status: 'done',
        deliverable: R('commentary', 'C1', 'I read the notes and wrote the plan page.') },
      { text: 'Write the plan page', instruction: R('instruction', 'I1', 'Write the plan page.'), status: 'done',
        deliverable: R('code', 'W1', '<h1>Plan</h1>') },
      { text: 'Do not use the keys', instruction: R('instruction', 'I1', 'Do not use the keys in the other repositories.'),
        status: 'not-checked', facts: ['no_deliverable_by_end'] },
      { text: 'Never read credentials', instruction: R('instruction', 'child:c1:H1', 'never read credentials'),
        status: 'not-checked' },
      { text: 'Never modify the fixtures', instruction: R('instruction', 'child:c1:H1', 'Never modify the fixtures.'),
        status: 'done', deliverable: R('commentary', 'child:c1:C1', 'Done with the brief.') },
      { instruction: R('instruction', 'I1', 'Write the plan page.'), status: 'done' },
      { text: 'An ask on an event that the session does not hold', instruction: R('instruction', 'NOPE', 'anything'),
        status: 'done' },
      { text: 'Show me the notes', instruction: R('instruction', 'I1', 'Show me the notes.'), status: 'done',
        deliverable: R('observation', 'R2-r', 'notes: three parts') }],
    promises: [], decisions: [], findings: [], failures: [], pivots: [], writtenClaims: [] };
}
// D133 (R2): an ask's lines, its open ones and then its own fold's, as a reader who opens the fold reads them.
const askLines = (model) => model.prompt.asks.map((ask) => [...ask.lines, ...ask.folded].map(textOf));

test('D115: an ask tied only to the agent\'s words is said as what the session review cited, by one predicate', () => {
  const session = truthSession();
  const model = reportModel(session, truthReport(session), {});
  const lines = askLines(model);
  // Ask 1 rests on the agent's words in its row, though the recording holds the read and the write that do it: the
  // words say only what the row cites.
  assert.deepEqual(lines[0], [REPORT_PROMPT_WORDS.agentOnly]);
  assert.equal(REPORT_PROMPT_WORDS.agentOnly,
    'The session review cited the agent\'s words as what does it, not a recorded result or change.');
  // Ask 2 cites a change, and ask 4 a recorded result: no such line.
  assert.deepEqual([lines[1], lines[3]], [[], []]);
  // The header counts the same asks, by the same predicate, in the same terms.
  const shown = lines.filter((l) => l.includes(REPORT_PROMPT_WORDS.agentOnly)).length;
  assert.equal(shown, 1);
  assert.ok(model.notChecked.didNotCheck.phrases.includes(REPORT_NOT_CHECKED_PARTS.agentOnly(shown)),
    JSON.stringify(model.notChecked.didNotCheck.phrases));
  // No sentence of the report says that Sonah found no result or change: no code searched for one.
  const md = renderReportMarkdown(session, truthReport(session), {});
  assert.doesNotMatch(md, /found no recorded result or change|rests? only on the agent's words/);
});

test('D115: the end-of-recording fact says what the row cites and what the session review did not check', () => {
  const session = truthSession();
  const model = reportModel(session, truthReport(session), {});
  // Ask 3 is not checked, its row cites nothing, and its part of the recording runs to the end; a later write does it.
  assert.deepEqual(askLines(model)[2], [CHECKLIST_REQUIREMENT_FACT_WORDS.no_deliverable_by_end]);
  assert.doesNotMatch(CHECKLIST_REQUIREMENT_FACT_WORDS.no_deliverable_by_end, /found nothing|recording|ended/);
  const md = renderReportMarkdown(session, truthReport(session), {});
  assert.ok(md.includes(CHECKLIST_REQUIREMENT_FACT_WORDS.no_deliverable_by_end));
  assert.doesNotMatch(md, /found nothing that does this ask/);
});

test('D115: an ask Sonah lists under no message of yours is said by what code proves of it, never "could not read"'
  + ' of a row Sonah read', () => {
  const session = truthSession();
  const model = reportModel(session, truthReport(session), {});
  // Asks 1-4 are your prompt's; the four others are listed under What Sonah could not check, one sentence a kind.
  assert.equal(model.prompt.asks.length, 4);
  assert.deepEqual(model.notChecked.unreadAsks, [
    REPORT_NOT_CHECKED_WORDS.unreadAsks(1, ''), REPORT_NOT_CHECKED_WORDS.unplacedAsks(1, ''),
    REPORT_NOT_CHECKED_WORDS.briefAsks(2, '')]);
  assert.deepEqual(model.notChecked.unreadAsks, ['Sonah could not read 1 ask of the session review.',
    'Sonah could not place 1 ask of the session review among the asks of your prompt.',
    'The session review named 2 asks that an agent wrote into a helper\'s brief. Sonah does not list them under your '
      + 'prompt.']);
  // Every unread ask is placed once, under What Sonah could not check, and the section counts one sentence a kind.
  const placement = reportPlacement(model);
  for (const index of [3, 4, 5, 6]) assert.deepEqual(placement[`requirements:${index}`], { notChecked: 'unreadAsks' });
  assert.equal(model.notChecked.total, model.notChecked.facts.length + model.notChecked.withheldTotal + 3
    + model.notChecked.unreadRows.length);
  // Both readers say them.
  const page = renderSessionPage(session, truthReport(session), {});
  const md = renderReportMarkdown(session, truthReport(session), {});
  for (const line of model.notChecked.unreadAsks) {
    assert.ok(md.includes(line), line);
    assert.ok(page.includes(line.replaceAll('\'', '&#39;')), line);
  }
  // With no session to read the lineage from, the brief's asks fail closed: never named a brief, never said unread.
  const none = reportModel(sessionBuilder().session(), truthReport(session), {});
  assert.equal(none.notChecked.unreadAsks.some((line) => /brief/.test(line)), false);
  assert.deepEqual(none.notChecked.unreadAsks, ['Sonah could not read 1 ask of the session review.',
    'Sonah could not place 7 asks of the session review among the asks of your prompt.']);
});

test('D115, the invariant: a sentence about a row of the session review stands on a proof of the reach it claims', () => {
  // Every listed key is read in class sonah and registered, each proof reaching as far as its words claim; the first
  // audit test runs the same check on every word table.
  for (const [module, keys] of Object.entries(REVIEW_ROW_KEYS)) for (const key of keys) {
    assert.equal(READ_CENSUS[module][key][0], 'sonah', key);
    const claims = ABSENCE_REGISTRY[module]?.[key];
    assert.ok(claims && Object.keys(claims).length, `${key} is registered`);
    for (const [proof, scope] of Object.entries(claims)) assert.ok(ABSENCE_PROOFS[proof].scopes.includes(scope), key);
  }
  // Only a search reaches the whole recording; a row's own fields reach that row.
  assert.deepEqual(ABSENCE_SCOPES.review, ['report']);
  assert.equal(ABSENCE_SCOPES.recording.includes('report'), false);
  // The old words, read at the reach they claim (the recording: "found no recorded result or change", "found nothing
  // that does this ask before the recording ended"), fail on the row's proof; the new words, at the row's reach, stand.
  const OLD = { agentOnly: "The session review cited only the agent's words for it. Sonah found no recorded result or "
    + 'change for it.', fact: 'The session review found nothing that does this ask before the recording ended.' };
  const tables = new Map([['m', new Map([['T.agentOnly', [OLD.agentOnly]], ['T.fact', [OLD.fact]]])]]);
  const census = { m: { 'T.agentOnly': ['sonah', fingerprintOf([OLD.agentOnly])],
    'T.fact': ['sonah', fingerprintOf([OLD.fact])] } };
  const rows = { m: ['T.agentOnly', 'T.fact'] };
  const problems = (registry) => auditProblems(tables, { census, registry, held: {}, rows })
    .map((p) => `${p.problem} ${p.key}${p.scope ? ` ${p.scope}` : ''}`);
  assert.deepEqual(problems({}), ['unregistered T.agentOnly', 'unregistered T.fact']);
  assert.deepEqual(problems({ m: { 'T.agentOnly': { review_row_cites: 'recording' },
    'T.fact': { review_row_cites: 'recording' } } }), ['scope_unproved T.agentOnly recording',
    'scope_unproved T.fact recording']);
  assert.deepEqual(problems({ m: { 'T.agentOnly': { review_row_cites: 'review' },
    'T.fact': { review_row_cites: 'review' } } }), []);
  // A listed key read in another class fails: a sentence about a row is never taken as "other".
  assert.deepEqual(auditProblems(tables, { census: { m: { ...census.m, 'T.fact': ['other', fingerprintOf([OLD.fact])] } },
    registry: { m: { 'T.agentOnly': { review_row_cites: 'review' }, 'T.fact': { review_row_cites: 'review' } } },
    held: {}, rows }).map((p) => `${p.problem} ${p.key}`).sort(), ['not_absence T.fact', 'row_class T.fact']);
});

// ---- 2. a question's pointer (D116) ------------------------------------------------------------------------------

const questionItems = (model) => every(model).filter((x) => x.rows[0].source === 'codePass.questions');
const ofQuestion = (model, index) => every(model).find((x) => x.rows[0].source === 'codePass.questions'
  && x.rows[0].index === index);
const pointers = (item) => item.where.filter((w) => /^(?:item|ask)-\d+$/.test(w.anchor ?? '')).map((w) => w.anchor);
const QUESTION_LINE = /^The code review asks you about this ask\./;

test('D116: a question that names no place points to no item, no ask and no line beside an ask', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const model = reportModel(session, report, repoFacts());
  // The fixture's Q1 names decisions[3] and Q3 names requirements[0]; both quotes are null: no recorded place.
  for (const index of [0, 2]) {
    const q = ofQuestion(model, index);
    assert.ok(q && !q.memberOf, `question ${index + 1} is its own item`);
    assert.deepEqual(pointers(q), [], `question ${index + 1}`);
    assert.deepEqual(q.related.items, [], `question ${index + 1}`);
  }
  for (const ask of model.prompt.asks) assert.equal(ask.lines.some((l) => QUESTION_LINE.test(textOf(l))), false);
  // The readers print no pointer for them either: no "Where: item N" or "· ask N" beside their heads.
  const md = renderReportMarkdown(session, report, repoFacts());
  for (const index of [0, 2]) {
    const n = ofQuestion(model, index).n;
    const block = md.slice(md.indexOf(`<a name="item-${n}"></a>`), md.indexOf('Evidence', md.indexOf(`<a name="item-${n}"></a>`)));
    assert.doesNotMatch(block, /Where: (?:item|ask) \d|· (?:item|ask) \d/, block);
  }
});

test('D116: a question points to the ask or the item it names only where its own place overlaps that row\'s', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // Q3 quotes your words of the ask it names (an event of the ask's row): it points to the ask, and the ask's line names it.
  report.codePass.questions[2] = { ...report.codePass.questions[2], quote: R('instruction', 'I1',
    'Return 429 with a Retry-After header in seconds.') };
  // Q5 names an ask that is an item (ask 6, not done), quoting the message of that ask: it points to that item.
  report.codePass.questions.push({ id: 'Q5', question: 'Should the test cover a burst?', from: 'review',
    concerns: { key: 'S6', kind: 'ask', source: 'requirements', index: 5, id: null },
    quote: R('instruction', 'I2', 'Also add a test for the limiter.'), check: { verdict: 'sound', explanation: 'None.' } });
  // Q6 names the same ask but quotes the agent's change of approach, which that ask's item does not name: no pointer.
  report.codePass.questions.push({ id: 'Q6', question: 'Is the bucket the right store?', from: 'review',
    concerns: { key: 'S6', kind: 'ask', source: 'requirements', index: 5, id: null },
    quote: R('commentary', 'C2', 'I am switching to an in-process token bucket'),
    check: { verdict: 'sound', explanation: 'It is.' } });
  const model = reportModel(session, report, repoFacts());
  const placement = reportPlacement(model);
  const askItem = itemsOf(model).find((item) => item.rows.some((r) => r.source === 'requirements' && r.index === 5));
  // Questions 1-3 are the fixture's; Q5 and Q6 follow them (indexes 3 and 4).
  assert.deepEqual(pointers(ofQuestion(model, 2)), ['ask-1']);
  assert.deepEqual(pointers(ofQuestion(model, 3)), [`item-${askItem.n}`]);
  assert.deepEqual(ofQuestion(model, 3).related.items, [askItem.n]);
  assert.deepEqual(pointers(ofQuestion(model, 4)), []);
  assert.deepEqual(ofQuestion(model, 4).related.items, []);
  for (const index of [2, 3, 4]) assert.deepEqual(placement[`codePass.questions:${index}`],
    { item: ofQuestion(model, index).n });
  // The line beside an ask names a question only where that question's tie to the ask's row was checked. The fixture's
  // stored link puts Q3 beside "Update the README" (requirements[6]); Q3's quote and that row both name your message
  // I1 (one place, D112's rule by event), so the line stands.
  const lines = (m) => m.prompt.asks.flatMap((ask) => ask.lines.map(textOf)).filter((l) => QUESTION_LINE.test(l));
  assert.deepEqual(lines(model), [REPORT_PROMPT_WORDS.codeQuestion(ofQuestion(model, 2).n)]);
  // Quoting the agent's change of approach, which neither the ask it names nor that row names: no pointer, no line.
  report.codePass.questions[2] = { ...report.codePass.questions[2], quote: R('commentary', 'C2',
    'I am switching to an in-process token bucket') };
  const apart = reportModel(session, report, repoFacts());
  assert.deepEqual(pointers(ofQuestion(apart, 2)), []);
  assert.deepEqual(lines(apart), []);
});

test('D116, the invariant: no question prints a pointer to a row whose place its own place does not overlap', () => {
  // On every fixture shape and every quote a question can carry here (none, an event of the row, an event outside it),
  // a pointer stands only where the question's quote names an event that the target's rows name.
  const session = reportSession();
  let checked = 0;
  const quotes = [null, R('code', 'W2', 'app.use(limiter(10));'), R('commentary', 'C2', 'I am switching to an in-process '
    + 'token bucket'), R('instruction', 'I1', 'Update the README')];
  for (const quote of quotes) {
    const report = triagedReport(session);
    report.codePass.questions = report.codePass.questions.map((q) => (q.from === 'review' ? { ...q, quote } : q));
    const model = reportModel(session, report, repoFacts());
    for (const q of questionItems(model)) {
      const row = report.codePass.questions[q.rows[0].index];
      for (const anchor of pointers(q)) {
        assert.ok(quote !== null, `${anchor}: a question with no place has no pointer`);
        const n = Number(anchor.split('-')[1]);
        const target = anchor.startsWith('item-') ? itemsOf(model).find((item) => item.n === n) : null;
        const events = target ? [target, ...target.members].flatMap((x) => x.rows)
          .map((r) => (r.source === 'codePass.questions' ? null : report[r.source]?.[r.index])) : [report.requirements[row
          .concerns.index]];
        const named = JSON.stringify(events);
        assert.ok(named.includes(`"${quote.eventId}"`), `${anchor} shares the question's event ${quote.eventId}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 0, 'some pointer stands, and was checked');
  assert.equal(REPORT_ITEM_WORDS.item(4), 'item 4');
});

// ---- 3. D116's review: the tier tie, and the place of the item that holds the row ---------------------------------
// The review of D116 found the question's `concerns` key still lifting the tier of the item it names with no place check
// (D96 R6), and that item saying "Item N of the code review concerns it, so Sonah puts it in Must know." while question
// N, by D116, named no item: the report disagreed with itself about one tie. The tier tie now reads D116's rule
// (`questionTiedTo`), the one every pointer reads, against the place of the item that holds the row.

const tierWhyNames = (item, n) => item.why === REPORT_TIER_WHY.tied(n, REPORT_TIER_WORDS[item.tier.final]);
const decisionRef = (report, index) => ({ key: `S${index + 1}`, kind: 'decision', source: 'decisions', index,
  id: report.decisions[index].id });

test('D116\'s review: a question lifts the tier of the item it names only where code checked the tie', () => {
  const session = reportSession();
  const chose = (model) => every(model).find((x) => x.kind === 'decision_chose');
  // Q1 names no place (quote null) and is in Must know; its key names the decision on how to do your ask (decisions[2],
  // Good to know by default, Must know when the code review is tied to it). Unchecked, it lifts nothing and names nothing.
  const unplaced = triagedReport(session);
  unplaced.codePass.questions[0] = { ...unplaced.codePass.questions[0], concerns: decisionRef(unplaced, 2) };
  const model = reportModel(session, unplaced, repoFacts());
  const q1 = ofQuestion(model, 0);
  assert.equal(q1.tier.final, 'must_know');
  assert.equal(chose(model).tier.final, 'good_to_know');
  assert.equal(chose(model).why, REPORT_TIER_WHY.byDefault(REPORT_KIND_WORDS.decision_chose, 'Good to know'));
  assert.deepEqual([pointers(q1), q1.related.items], [[], []]);
  const md = renderReportMarkdown(session, unplaced, repoFacts());
  assert.equal(md.includes(REPORT_TIER_WHY.tied(q1.n, 'Must know')), false, 'no sentence names the unchecked tie');
  // Q2 is routed from a finding whose anchor is a line of src/limiter.js, the file the decision's edit (W1) wrote: one
  // place. In Must know, it lifts the decision, and the tier sentence and its own related items name the same tie.
  const placed = triagedReport(session);
  placed.codePass.questions[1] = { ...placed.codePass.questions[1], concerns: decisionRef(placed, 2) };
  placed.codePass.triage.push({ ref: { question: 'Q2' }, level: 'medium', impact: 'A preflight uses up the limit.',
    action: 'Decide whether preflights count.', label: 'decide on preflights', where: null });
  const tied = reportModel(session, placed, repoFacts());
  const q2 = ofQuestion(tied, 1);
  assert.equal(q2.tier.final, 'must_know');
  assert.equal(chose(tied).tier.final, 'must_know');
  assert.equal(chose(tied).why, REPORT_TIER_WHY.tied(q2.n, 'Must know'));
  assert.deepEqual(q2.related.items, [chose(tied).n]);
  // The same question anchored on a file the decision does not name: no tie, no lift, no pointer.
  placed.codePass.questions[1] = { ...placed.codePass.questions[1], finding: { ...placed.codePass.questions[1].finding,
    anchor: { path: 'README.md', side: 'new', startLine: 1, endLine: 1 } } };
  const apart = reportModel(session, placed, repoFacts());
  assert.equal(chose(apart).tier.final, 'good_to_know');
  assert.deepEqual(ofQuestion(apart, 1).related.items, []);
});

/** Your ask, the agent's plan (one message), and two edits of two files. */
function holderSession() {
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache and a queue to the client.');
  b.say('C1', 'I will add a cache to the client and a queue behind it.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  b.change('W2', 'src/queue.js', { after: 'export const queue = [];\n' });
  b.say('F1', 'Done.', 'final');
  return b.session();
}
const decidedRow = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null,
  valueReceipt: null, valueState: 'unchecked', actions: [], stated: null, instructionReview: null, column: 'asked-chose',
  columnState: 'grounded', amends: [], materiality: 'structural', materialityRule: 'synthetic', relevance: 'unchecked',
  reasons: [], constrainedBy: { instruction: R('instruction', 'I1', 'Add a cache and a queue to the client.'),
    settles: false, settledValueQuote: null }, ...fields });
const routed = (id, path, concerns) => ({ id, question: `Is ${path} right?`, from: 'finding', quote: null, concerns,
  finding: { title: `Is ${path} right?`, kind: 'bug', anchor: { path, side: 'new', startLine: 1, endLine: 1 } },
  check: { verdict: 'refuted', reason: 'not_against_goal', explanation: 'It is as written.' } });
/** Two decisions on how to do your ask whose stated quotes nest (two items since D112 amended, 2026-10-18, removed the
 *  nested join): the first's edit wrote src/cache.js, the second's src/queue.js. Three questions routed from findings,
 *  each in Must know: Qa names the first and is anchored on the second's file, Qb names the second and is anchored on
 *  the first's file, Qc names the first and is anchored on a file neither names. */
function holderReport(session) {
  const ref = (index) => ({ key: `S${index + 1}`, kind: 'decision', source: 'decisions', index, id: `d${index}` });
  return { reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete', windowResults: [{ windowIndex: 0,
    eventIds: session.events.map((e) => e.id), failure: null, challenge: { complete: true }, groundingComplete: true }],
  requirements: [], promises: [], findings: [], failures: [], pivots: [], writtenClaims: [],
  decisions: [
    decidedRow({ id: 'd0', dimension: 'cache', chosen: 'a map', actions: ['W1'],
      stated: R('commentary', 'C1', 'I will add a cache to the client and a queue behind it.') }),
    decidedRow({ id: 'd1', dimension: 'queue', chosen: 'an array', actions: ['W2'],
      stated: R('commentary', 'C1', 'a queue behind it') })],
  codePass: { version: { pass: 'sonah.code-pass/10' }, ran: true, required: false, base: { kind: 'recorded_edits' },
    agent: { turns: 1, tools: { Read: 0, Grep: 0, Glob: 0 }, reads: 0, terminal: 'answered' }, gaps: [],
    coverage: 'complete', files: [], findings: [], withheld: [], footer: [],
    questions: [routed('Q1', 'src/queue.js', ref(0)), routed('Q2', 'src/cache.js', ref(1)),
      routed('Q3', 'src/other.js', ref(0))],
    triage: ['Q1', 'Q2', 'Q3'].map((q) => ({ ref: { question: q }, level: 'medium', impact: 'It may be wrong.',
      action: 'Check it.', label: `check ${q}`, where: null })) } };
}

test('D116\'s review: a question\'s tie is checked against the place of the item that holds the row it names; two'
  + ' decisions cut from one sentence are two items, each with its own place (D112 amended)', () => {
  const session = holderSession();
  const report = holderReport(session);
  const model = reportModel(session, report, {});
  const itemOf = (m, index) => itemsOf(m).find((item) => item.rows[0].source === 'decisions' && item.rows[0].index === index);
  const [first, second] = [itemOf(model, 0), itemOf(model, 1)];
  assert.ok(first && second && first !== second, 'the two decisions are two items');
  assert.deepEqual([first.members, second.members], [[], []]);
  const asked = [0, 1, 2].map((index) => ofQuestion(model, index));
  // Qa names the first and is anchored on the file of the second's edit, Qb the reverse, Qc on a file neither names: the
  // place of the item that holds the named row names none of them, so no tie stands, no pointer and no tier sentence.
  for (const q of asked) assert.deepEqual(q.related.items, []);
  assert.equal(every(model).some((x) => asked.some((q) => tierWhyNames(x, q.n))), false);
  assert.deepEqual([first.tier.final, second.tier.final], ['good_to_know', 'good_to_know']);
  // A question anchored on the file of the first decision's own edit ties to its item: the pointer and the tier sentence.
  report.codePass.questions[2] = routed('Q3', 'src/cache.js', { key: 'S1', kind: 'decision', source: 'decisions',
    index: 0, id: 'd0' });
  const tied = reportModel(session, report, {});
  const lead = itemOf(tied, 0);
  assert.deepEqual(ofQuestion(tied, 2).related.items, [lead.n]);
  assert.equal(lead.tier.final, 'must_know');
  assert.ok(tierWhyNames(lead, ofQuestion(tied, 2).n), lead.why);
});

test('D116\'s review: a question that names a row folded into an item is checked against that item\'s rows, folded ones'
  + ' included', () => {
  // requirements[1] (an ask the agent did not do) is folded into the code finding that it does not meet (src/limiter.js,
  // line 5). A question on that ask that quotes your message (I1) shares the folded row's place, not the finding's.
  const session = reportSession();
  const report = triagedReport(session);
  report.codePass.questions[2] = { ...report.codePass.questions[2], concerns: { key: 'S2', kind: 'ask',
    source: 'requirements', index: 1, id: null }, quote: R('instruction', 'I1', 'Return 429 with a Retry-After header in seconds') };
  const model = reportModel(session, report, repoFacts());
  const holder = itemsOf(model).find((item) => item.rows.some((r) => r.source === 'requirements' && r.index === 1));
  assert.equal(holder.kind, 'code_ask_not_met');
  assert.deepEqual(pointers(ofQuestion(model, 2)), [`item-${holder.n}`]);
  assert.deepEqual(ofQuestion(model, 2).related.items, [holder.n]);
});

test('D116\'s review, the invariant: no tier sentence names a question whose pointer to that item does not stand', () => {
  // On every quote and anchor a question can carry here, every item whose tier rests on a question's tie is an item that
  // question points to (its related items), or the item it is a member of (`tiedHere`).
  let checked = 0;
  const cases = [];
  const session = reportSession();
  const quotes = [null, R('code', 'W1', 'tokens -= 1'), R('commentary', 'C2', 'I am switching to an in-process token '
    + 'bucket'), R('commentary', 'C1', 'I will use a token bucket.')];
  for (const quote of quotes) for (const anchor of [null, 'src/limiter.js', 'README.md']) {
    const report = triagedReport(session);
    report.codePass.questions = report.codePass.questions.map((q) => ({ ...q, concerns: decisionRef(report, 2),
      ...(q.from === 'review' ? { quote } : { finding: { ...q.finding, anchor: anchor === null ? null
        : { path: anchor, side: 'new', startLine: 6, endLine: 6 } } }) }));
    report.codePass.triage.push(...report.codePass.questions.map((q) => ({ ref: { question: q.id }, level: 'high',
      impact: 'It may be wrong.', action: 'Check it.', label: `check ${q.id}`, where: null })));
    cases.push([session, report, repoFacts()]);
  }
  const hs = holderSession();
  cases.push([hs, holderReport(hs), {}]);
  for (const [s, report, opts] of cases) {
    const model = reportModel(s, report, opts);
    for (const item of every(model)) for (const q of questionItems(model)) {
      if (!tierWhyNames(item, q.n)) continue;
      const holding = item.memberOf ?? item.n ?? itemsOf(model).find((x) => x.members.includes(item)).n;
      assert.ok(q.related.items.includes(holding), `item ${holding} names question ${q.n}, which does not point to it`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'some tier tie stands, and was checked');
});
