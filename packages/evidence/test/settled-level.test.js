// The settled-words gain (2026-10-13), in the unreleased sonah.session-review-agent/8 and sonah.challenge/30: a choice
// the person's words (or a shown project instruction file's) settle is reported "You settled it" at the level the words
// address it, even when the agent still decided narrower questions inside it, never one of those narrower questions in
// its place, and never with a narrower answer folded into what it chose; a narrower question the words leave open gets
// an entry of its own ("You asked, the agent chose how") only when it is itself a choice that shaped the work (step 3's
// own test); and "You settled it" cites the source whose words state the answer, the project file when the file, not a
// message that only asks for the work, states it. The checking pass is told the settled attribution holds at that
// level. Wording the models read: no code reads a word of it, the settled definition and Rule C are unchanged
// (settled-words.test.js keeps both), and no proposition moved. Code already carries what the wording asks for,
// within one answer and across windows: a settled decision and a narrower chose-how decision on the same action are
// both published, each in its own column. Not across a re-ask: when the two cite the same constrainedBy words, they are
// one proposal to the re-ask merges (D79: a decision's structure is its actions, instruction receipt, stated receipt
// and notActing, never settles, dimension or value), so either entry can be the one dropped (pinned below).
// Every recording here is synthetic (invented asks, rules, paths and code); no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { row, humanAsk, call, result, said, load } from './m33-u-unasked-fixture.js';
import { runReview, reaskedAnswer, servedAnswer } from '../src/run-review.js';
import { CHALLENGE_PROFILE, CHECKLIST_PROPOSITIONS, DECISION_NOTE, challengeSystem } from '../src/challenge.js';
import { SONAH_SESSION_REVIEW_AGENT, SONAH_REVIEW_AGENT, SESSION_REVIEW_AGENT_VERSION } from '../src/review-agent.js';

const flat = (text) => text.replace(/\s+/g, ' ');
const once = (text, phrase, name) => assert.equal(flat(text).split(phrase).length, 2, `${name}: ${phrase}`);
const bytes = (text) => Buffer.byteLength(text, 'utf8');

// ---- the words the models read ---------------------------------------------------------------------------------

test('settled level: the versions are the branch\'s unreleased ones, not new numbers', () => {
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
});

const LEVEL = 'Report a choice such words settle as "You settled it" at the level the words address it, even when the'
  + ' agent still had to decide narrower questions inside it: "show it in Celsius" settles the unit the page shows,'
  + ' whichever formula the agent converts with. Never file one of those narrower questions in its place, and never'
  + ' fold its answer into the settled entry: that entry\'s "chosen" is the answer those words state ("Celsius", not'
  + ' "Celsius with one decimal").';
const NARROWER = 'A narrower question the words leave open gets an entry of its own ("You asked, the agent chose how")'
  + ' beside the settled one only when it is itself a choice that shaped the work: the number of decimal places the'
  + ' page shows can be such a choice.';
const SOURCE = 'Cite the source whose words state the answer: before you file a choice "You asked, the agent chose how"'
  + ' on a message that only asks for the work, check whether a project instruction file given before the choice'
  + ' states its answer, and when one does, it is "You settled it", citing that file. With "Add a weather page" and a'
  + ' project instruction file that says "Show every temperature in Celsius", the unit the page shows is "You settled'
  + ' it", citing that file, and settledValueQuote is "Show every temperature in Celsius".';

test('settled level: the brief records a settled choice at the level the words address, in step 3', () => {
  for (const phrase of [LEVEL, NARROWER, SOURCE]) once(SONAH_SESSION_REVIEW_AGENT, phrase, 'brief');
  // One paragraph, in step 3: after the settled paragraph's last sentence, before the pivots line.
  const text = flat(SONAH_SESSION_REVIEW_AGENT);
  const settledEnd = 'Words that state the result of the whole work settle only the questions they answer.';
  const at = text.indexOf(`${settledEnd} ${LEVEL} ${NARROWER} ${SOURCE} Pivots: an approach the agent tried`);
  assert.ok(at > text.indexOf('STEP 3. WHAT THE AGENT DECIDED') && at < text.indexOf('STEP 4.'), 'in step 3, in order');
});

test('settled level: only a narrower question that matters gets its own entry, never in the settled one\'s place',
  () => {
    const text = flat(SONAH_SESSION_REVIEW_AGENT);
    // The noise guard is step 3's own test, in its words (a choice that shaped the work), with no contrast that could
    // read as an exception to "how the agent carried out something it was asked to do": "Do not filter by importance"
    // stands. The example's detail (the conversion formula) and its separate entry (the decimal places) are two
    // things, and the narrower answer is never folded into the settled entry.
    once(text, 'only when it is itself a choice that shaped the work:', 'brief');
    once(text, 'Report every choice that shaped the work, in design, procedure or operation, including how the agent'
      + ' carried out something it was asked to do. Do not filter by importance.', 'brief');
    for (const gone of ['carrying out the settled answer', 'converts and rounds'])
      assert.ok(!text.includes(gone), gone);
    once(text, 'Never file one of those narrower questions in its place, and never fold its answer into the settled'
      + ' entry', 'brief');
  });

test('settled level: the checking pass is told the settled attribution holds at that level, never to refute', () => {
  const sentence = 'That attribution holds at the level those words address, even when the agent decided narrower'
    + ' questions inside the choice that they leave open: each of those is a decision of its own.';
  once(DECISION_NOTE, sentence, 'DECISION_NOTE');
  const text = flat(DECISION_NOTE);
  // It sits with "you settled it": after the settled sentence, before the chose-how one (Rule C).
  const at = text.indexOf(sentence);
  assert.ok(at > text.indexOf('With settles true (you settled it)'), 'after the settled sentence');
  assert.ok(at < text.indexOf('With settles false (you asked, the agent chose how)'), 'before the chose-how sentence');
  assert.ok(!/refute/i.test(sentence) && !/settle/i.test(sentence), 'it neither refutes nor names settled');
});

test('settled level: no proposition moved; the combined route did not move (D71 i)', () => {
  assert.equal(CHECKLIST_PROPOSITIONS.decisionSettled, 'the human\'s quoted words in settledValueQuote themselves state'
    + ' the answer the agent\'s quoted action adopted for the question this choice answers');
  assert.equal(CHECKLIST_PROPOSITIONS.decisionSettledFile, 'the project instruction file\'s quoted words in'
    + ' settledValueQuote, given to the agent before the choice, themselves state the answer the agent\'s quoted action'
    + ' adopted for the question this choice answers');
  assert.equal(bytes(SONAH_REVIEW_AGENT), 5710);
  assert.equal(bytes(challengeSystem()), 7493);
  for (const text of [SONAH_REVIEW_AGENT, challengeSystem()])
    for (const phrase of ['at the level', 'narrower question', 'Show every temperature'])
      assert.ok(!text.includes(phrase), phrase);
});

test('settled level: no product code reads the words; they are prompt text only', async () => {
  const roots = ['../src/', '../adapters/', '../../render/', '../../cli/src/'];
  for (const root of roots) {
    const dir = new URL(root, import.meta.url);
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.js'))) {
      if (['review-agent.js', 'challenge.js'].includes(name) && root === '../src/') continue;
      const text = await readFile(new URL(name, dir), 'utf8');
      for (const phrase of ['at the level the words address', 'narrower question', 'Show every temperature'])
        assert.ok(!text.includes(phrase), `${root}${name}: ${phrase}`);
    }
  }
});

// ---- what code already does: both entries are carried, each grounded in its own source ------------------------

const ASK = 'Add a weather page in src/weather.js.';
const RULE = 'Show every temperature in Celsius.';
const RULES = `# Project rules\n${RULE}\nNever add a runtime dependency.`;
const CODE = 'export const show = (k) => `${(k - 273.15).toFixed(1)} °C`;\n';
const projectFile = () => row({ type: 'attachment', attachment: { type: 'instructions',
  files: [{ path: '/repo/CLAUDE.md', type: 'Project', content: RULES }] } });
const rows = () => [
  humanAsk(ASK),
  projectFile(),
  call('w1', 'Write', { file_path: '/repo/src/weather.js', content: CODE }, 'Writing the page now.'),
  result('w1', 'File created successfully at: /repo/src/weather.js', { type: 'create', filePath: '/repo/src/weather.js',
    content: CODE, structuredPatch: [] }),
  said('The weather page is added.'),
].map((r, i) => ({ ...r, uuid: `u-settled-level-${i + 1}` }));

async function fixture(t) {
  const { session } = await load(t, rows());
  const ask = session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  const write = session.events.find((e) => e.kind === 'invocation' && e.operation === 'write');
  return { session, ask, write, file: session.projectInstructions[0] ?? null };
}
/** The settled choice (the unit, from the project file) and a narrower one beside it (the decimal places, which the
 *  file leaves open), both adopted by the same write. */
const answerOf = ({ ask, write, file }) => ({ decisions: [
  { dimension: 'temperature unit', chosen: 'Celsius', value: '°C',
    valueReceipt: { eventId: write.id, field: 'added-code', role: 'code', quote: '°C' }, actions: [write.id],
    constrainedBy: { instruction: { eventId: file.id, role: 'project-instructions', quote: RULE }, settles: true,
      settledValueQuote: 'every temperature in Celsius' } },
  { dimension: 'decimal places shown', chosen: 'one', value: '1',
    valueReceipt: { eventId: write.id, field: 'added-code', role: 'code', quote: 'toFixed(1)' }, actions: [write.id],
    constrainedBy: { instruction: { eventId: ask.id, role: 'instruction', quote: ASK }, settles: false,
      settledValueQuote: null } },
], pivots: [], claims: [], requirements: [] });
/** The narrative answer, and every challenge item upheld citing the write. */
const judgeOf = (answer) => async (request) => {
  if (!request.challenge) return answer;
  return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
    explanation: 'Synthetic.',
    receipts: [{ eventId: answer.decisions[0].actions[0], role: 'code', quote: 'toFixed(1)' }] })) };
};

test('settled level: a settled choice and a narrower chose-how one on the same action are both published',
  async (t) => {
    const parts = await fixture(t);
    assert.ok(parts.file, 'premise: the project file is shown');
    assert.ok(!ASK.includes('Celsius') && RULE.includes('Celsius'), 'premise: the file, not the message, states it');
    const report = await runReview({ session: parts.session, reviewScope: 'session-only',
      judge: judgeOf(answerOf(parts)) });
    const byDimension = Object.fromEntries(report.decisions.map((d) => [d.dimension, d]));
    assert.equal(report.decisions.length, 2, 'neither entry is merged into the other or dropped');
    assert.equal(byDimension['temperature unit'].column, 'asked-settled');
    assert.equal(byDimension['temperature unit'].constrainedBy.referredFrom, 'CLAUDE.md');
    assert.equal(byDimension['decimal places shown'].column, 'asked-chose');
  });

// ---- the accepted limit: across a re-ask, a pair citing the same words is one proposal (D79) -----------------------

test('settled level: across a re-ask, a settled and a narrower pair citing the same words is one proposal (D79)',
  async (t) => {
    const parts = await fixture(t);
    const [short, narrower] = answerOf(parts).decisions;
    // The settled entry with a value quote that grounds: the fixture's "°C" is under the quote minimum, so its value
    // cell is published unchecked (below).
    const settled = { ...short, valueReceipt: { ...short.valueReceipt, quote: ')} °C' } };
    // The narrower entry cites the very words the settled one does (the brief's own "show it in Celsius" case): the
    // two then share a structure, and settles, dimension and value are not part of it.
    const same = { ...narrower, constrainedBy: { ...settled.constrainedBy, settles: false, settledValueQuote: null } };
    const answer = (...decisions) => ({ decisions, pivots: [], claims: [], requirements: [] });
    const dims = (narrative) => narrative.decisions.map((d) => d.dimension);
    const served = (first, reask) => dims(servedAnswer({ first, reask, session: parts.session }).narrative);
    const reasked = (first, second) => dims(reaskedAnswer({ first, second, session: parts.session }).narrative);
    // Within one answer both stay (the published case above); across a re-ask either one can be the one dropped.
    assert.deepEqual(reasked(answer(settled), answer(settled, same)), ['temperature unit']);
    assert.deepEqual(served(answer(settled, same), answer(settled)), ['temperature unit']);
    assert.deepEqual(served(answer(settled), answer(same)), ['decimal places shown'], 'the settled entry is lost');
    // D102 (the review of its third fix): a re-ask copy whose value code lowers gives way to the first answer's copy of
    // that one proposal that grounds its value and every part the re-ask copy grounded.
    assert.deepEqual(served(answer(short, same), answer(short)), ['decimal places shown'], 'the settled entry is lost');
    // Citing other words (the file for the unit, the message for the decimals), both are kept either way.
    assert.deepEqual(served(answer(settled), answer(narrower)), ['decimal places shown', 'temperature unit']);
    assert.deepEqual(reasked(answer(settled), answer(settled, narrower)), ['temperature unit', 'decimal places shown']);
  });
