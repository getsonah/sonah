// 2026-10-13, in the unreleased sonah.session-review-agent/8 and sonah.challenge/30: "you settled it" is
// when the cited words (a human message, or a project instruction file given before the choice) themselves state the
// answer to the question this choice answers, what its result must be — the value returned, the file, the name, the
// helper to use, the behaviour — even in prose where the code spells the value its own way, and settledValueQuote
// quotes exactly those words. Words that state the result of the whole work settle only the questions they answer.
// "You asked, the agent chose how" stays for a question that doing what was asked requires answering and those words
// do not answer; its wording (fix 2) is unchanged. Wording the models read: no code reads a word of it. Code already
// checks settledValueQuote literally in the cited source, and the checking pass is shown it with the candidate; the
// tests below keep both. The checking pass is never told to refute a chose-how candidate those words settle: a refuted
// decision is left out of the report, and decisions are never hidden (owner decision D84 (3)).
// Every recording here is synthetic (invented asks, rules, paths and code); no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { row, humanAsk, call, result, said, load } from './m33-u-unasked-fixture.js';
import { runReview } from '../src/run-review.js';
import { groundDecision } from '../src/ledger.js';
import { CHALLENGE_PROFILE, CHECKLIST_PROPOSITIONS, DECISION_NOTE, challengeSystem } from '../src/challenge.js';
import { SONAH_SESSION_REVIEW_AGENT, SONAH_REVIEW_AGENT, SESSION_REVIEW_AGENT_VERSION } from '../src/review-agent.js';

const flat = (text) => text.replace(/\s+/g, ' ');
const once = (text, phrase, name) => assert.equal(flat(text).split(phrase).length, 2, `${name}: ${phrase}`);

// ---- the words the models read ---------------------------------------------------------------------------------

test('settled words: the versions are the branch\'s unreleased ones, not new numbers', () => {
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
  assert.equal(CHALLENGE_PROFILE.version, 'sonah.challenge/42');
});

test('settled words: the brief says settled is words that state this choice\'s answer, invented examples', () => {
  for (const phrase of [
    'You settled it constrainedBy with settles true: those words themselves state the answer to the question this'
      + ' choice answers, what its result must be (the value returned, the file, the name, the helper to use, the'
      + ' behaviour). settledValueQuote quotes exactly those words',
    'often not the words that ask for the work, and often prose where the code spells the value its own way',
    'To tell "You settled it" from "You asked, the agent chose how", ask whether the words of a human message or of a'
      + ' project instruction file given before the choice themselves state the answer to the question this choice'
      + ' answers. If they do, it is "You settled it", citing that message or file, even when they say it in prose and'
      + ' the code spells it its own way',
    // settledValueQuote is a span of the ask, not the whole of it.
    '"Add a weather page; show it in Celsius" settles the unit the page shows, and settledValueQuote is "show it in'
      + ' Celsius".',
    '"You asked, the agent chose how" is for a question that doing what was asked requires answering and those words'
      + ' do not answer: "Add a weather page" leaves the unit to the agent,',
    // Words that state the result of the work still leave this choice's own question open.
    'and "show it in Celsius" still leaves open how many decimal places the page shows. Words that state the result'
      + ' of the whole work settle only the questions they answer.',
    'settles is true exactly when those words themselves state the answer to the question this choice answers (step'
      + ' 3); settledValueQuote is then an exact span of that same message or file holding those words as written'
      + ' there, which need not spell the value as the code does',
  ]) once(SONAH_SESSION_REVIEW_AGENT, phrase, 'brief');
  // Settled is tied to this choice's own question wherever the brief defines it: never "what the result must be" alone.
  assert.equal(flat(SONAH_SESSION_REVIEW_AGENT).split('state the answer to the question this choice answers').length,
    4, 'brief: the step 3 line, the paragraph and the decisions rules');
  // "fixed the value" was read as "the code's value appears in the words"; it is gone from the session brief.
  for (const gone of ['those words fixed the value', 'fixed the actual value', 'the words that fix the value'])
    assert.ok(!flat(SONAH_SESSION_REVIEW_AGENT).includes(gone), `brief: ${gone}`);
});

test('settled words: fix 2\'s chose-how wording (Rule C) is kept word for word', () => {
  for (const phrase of [
    'You asked, the agent chose how constrainedBy with settles false: doing what those words ask requires deciding this'
      + ' question, and they leave the answer open. valueReceipt quotes the how: the code, command or path that adopted'
      + ' it.',
    'To tell "You asked, the agent chose how" from "Made without asking you", ask whether doing what was asked requires'
      + ' deciding this question at all. When every way of doing it has to answer the question, it is "You asked, the'
      + ' agent chose how", even though the agent\'s answer is one of several it could have given: a fix for empty'
      + ' names has to decide what an empty name returns. When what was asked could be done without deciding the'
      + ' question, it is "Made without asking you": a new retry policy that the request did not need.',
  ]) once(SONAH_SESSION_REVIEW_AGENT, phrase, 'brief');
  once(DECISION_NOTE, 'With settles false (you asked, the agent chose how) it holds only when doing what those words'
    + ' asked requires deciding this question at all: every way of doing it has to answer the question, even when the'
    + ' agent\'s answer is one of several it could have given. If what they asked could be done without deciding the'
    + ' question, the choice was made without asking: refute.', 'DECISION_NOTE');
  assert.equal(CHECKLIST_PROPOSITIONS.decisionChoseHow, 'doing what the human\'s quoted words asked requires deciding'
    + ' the question this choice answers, and those words left the answer open');
  assert.equal(CHECKLIST_PROPOSITIONS.decisionChoseHowFile, 'doing what the project instruction file\'s quoted words,'
    + ' given to the agent before the choice, ask requires deciding the question this choice answers, and those words'
    + ' left the answer open');
});

test('settled words: the checking pass judges settled by the same rule and names settledValueQuote', () => {
  once(DECISION_NOTE, 'With settles true (you settled it) it holds only when those words themselves state the answer'
    + ' to the question this choice answers, what its result must be (the value returned, the file, the name, the'
    + ' helper to use, the behaviour), not merely a related topic or the result of the whole work;'
    + ' "settledValueQuote" quotes them, often in prose where the code spells the value its own way.', 'DECISION_NOTE');
  assert.ok(!DECISION_NOTE.includes('fixed the actual value'));
  // The settled propositions tie the words to the answer the action adopted for this choice's own question.
  for (const name of ['decisionSettled', 'decisionSettledFile'])
    assert.ok(CHECKLIST_PROPOSITIONS[name].endsWith('themselves state the answer the agent\'s quoted action adopted'
      + ' for the question this choice answers'), name);
  for (const name of ['decisionSettled', 'decisionSettledFile', 'decisionNotActingSettled',
    'decisionNotActingSettledFile']) {
    assert.ok(CHECKLIST_PROPOSITIONS[name].includes('quoted words in settledValueQuote'), name);
    assert.ok(CHECKLIST_PROPOSITIONS[name].includes('themselves state'), name);
    assert.ok(!CHECKLIST_PROPOSITIONS[name].includes('fixed'), name);
  }
  // D71 (i): the combined route's texts are not the session route's and did not move.
  assert.ok(flat(challengeSystem()).includes('Asked-settled means the human fixed the actual value'));
  assert.ok(!SONAH_REVIEW_AGENT.includes('themselves state'));
});

// Owner decision D84 (3): the decision list never hides decisions. A refuted decision is left out of the report
// (run-review.js), so the checking pass is never told to refute a chose-how candidate whose words settle its question:
// that would drop the decision instead of correcting its column.
test('settled words: the checking pass is never told to refute a decision the words settle (D84 (3))', () => {
  assert.ok(!flat(DECISION_NOTE).includes('the choice was settled, not chosen how'), 'the refute sentence is gone');
  // No sentence of the note pairs settled with refute, however it is worded.
  const sentences = flat(DECISION_NOTE).split(/(?<=\.) /);
  assert.ok(sentences.length > 10, 'premise: the note splits into its sentences');
  for (const sentence of sentences)
    assert.ok(!(/settle/i.test(sentence) && /refute/i.test(sentence)), sentence);
  // The refute that stays (Rule C): a choice the ask could be done without deciding was made without asking.
  once(DECISION_NOTE, 'If what they asked could be done without deciding the question, the choice was made without'
    + ' asking: refute.', 'DECISION_NOTE');
});

test('settled words: no product code reads them; they are prompt text only', async () => {
  const roots = ['../src/', '../adapters/', '../../render/', '../../cli/src/'];
  for (const root of roots) {
    const dir = new URL(root, import.meta.url);
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.js'))) {
      if (['review-agent.js', 'challenge.js'].includes(name) && root === '../src/') continue;
      const text = await readFile(new URL(name, dir), 'utf8');
      for (const phrase of ['themselves state', 'what the result must be', 'show it in Celsius'])
        assert.ok(!text.includes(phrase), `${root}${name}: ${phrase}`);
    }
  }
});

// ---- what code already does with the words: checks them literally, and shows them to the checking pass ----------

const ASK = 'Sort the activity list newest first in src/feed.js.';
const STATED = 'Sort the activity list newest first';
const CODE = 'export const sortFeed = (items) => [...items].sort((a, b) => b.at - a.at);\n';
const VALUE = 'b.at - a.at';
const RULE = 'Every new module logs through the shared logger in src/log.js.';
const RULES = `# Project rules\n${RULE}\nNever add a runtime dependency.`;
const projectFile = () => row({ type: 'attachment', attachment: { type: 'instructions',
  files: [{ path: '/repo/CLAUDE.md', type: 'Project', content: RULES }] } });
const rows = () => [
  humanAsk(ASK),
  projectFile(),
  call('w1', 'Write', { file_path: '/repo/src/feed.js', content: CODE }, 'Writing the sort now.'),
  result('w1', 'File created successfully at: /repo/src/feed.js', { type: 'create', filePath: '/repo/src/feed.js',
    content: CODE, structuredPatch: [] }),
  said('The feed is sorted.'),
].map((r, i) => ({ ...r, uuid: `u-settled-${i + 1}` }));

async function fixture(t) {
  const { session } = await load(t, rows());
  const ask = session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  const write = session.events.find((e) => e.kind === 'invocation' && e.operation === 'write');
  return { session, ask, write, file: session.projectInstructions[0] ?? null };
}
const askQuote = (ask) => ({ eventId: ask.id, role: 'instruction', quote: ASK });
const answerOf = (write, constrainedBy) => ({ decisions: [{ dimension: 'feed order', chosen: 'newest first',
  value: VALUE, valueReceipt: { eventId: write.id, field: 'added-code', role: 'code', quote: VALUE },
  actions: [write.id], constrainedBy }], pivots: [], claims: [], requirements: [] });
/** The narrative answer, and every challenge item upheld citing the write; `seen` gets every challenge request. */
const judgeOf = (answer, seen) => async (request) => {
  if (!request.challenge) return answer;
  seen.push(request);
  return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
    explanation: 'Synthetic.',
    receipts: [{ eventId: answer.decisions[0].actions[0], role: 'code', quote: VALUE }] })) };
};
const decisionRequests = (seen) => seen.filter((r) => r.challenge.items.some((item) => item.type === 'decision'));

test('settled words: words stating the result in prose ground "you settled it", the checker shown both',
  async (t) => {
    const { session, ask, write } = await fixture(t);
    assert.ok(!ASK.includes(VALUE) && ASK.includes(STATED), 'premise: the code\'s value is not in the person\'s words');
    const seen = [];
    const report = await runReview({ session, reviewScope: 'session-only',
      judge: judgeOf(answerOf(write, { instruction: askQuote(ask), settles: true, settledValueQuote: STATED }),
        seen) });
    assert.equal(report.decisions.length, 1);
    const [d] = report.decisions;
    assert.equal(d.column, 'asked-settled');
    assert.equal(d.constrainedBy.settledValueQuote, STATED);
    // The checking pass is shown the words that state the result, and judges the settled proposition.
    const [request] = decisionRequests(seen);
    assert.ok(request, 'a challenge request holds the decision');
    assert.ok(request.prompt.includes(`"settledValueQuote":${JSON.stringify(STATED)}`), 'the checker sees the words');
    assert.ok(request.prompt.includes(CHECKLIST_PROPOSITIONS.decisionSettled), 'and the settled proposition');
    assert.ok(request.system.includes(DECISION_NOTE), 'and the decision note');
  });

test('settled words: a project file\'s words naming the helper ground "you settled it" from that file',
  async (t) => {
    const { session, write, file } = await fixture(t);
    const seen = [];
    const report = await runReview({ session, reviewScope: 'session-only', judge: judgeOf(answerOf(write, {
      instruction: { eventId: file.id, role: 'project-instructions', quote: RULE }, settles: true,
      settledValueQuote: 'logs through the shared logger in src/log.js' }), seen) });
    const [d] = report.decisions;
    assert.equal(d.column, 'asked-settled');
    assert.equal(d.constrainedBy.referredFrom, 'CLAUDE.md');
    const [request] = decisionRequests(seen);
    assert.ok(request.prompt.includes('"settledValueQuote":"logs through the shared logger in src/log.js"'));
    assert.ok(request.prompt.includes(CHECKLIST_PROPOSITIONS.decisionSettledFile));
  });

test('settled words: code checks settledValueQuote literally in the cited source, never its meaning',
  async (t) => {
    const { session, ask, write } = await fixture(t);
    const ground = (constrainedBy) => groundDecision({ repo: { host: 'github.com', id: '0' }, session, pr: null,
      candidate: { actorSession: session.sessionKey, dimension: 'feed order', chosen: 'newest first',
        actions: [write.id], constrainedBy }, instructionHistoryComplete: true }).decision;
    assert.equal(ground({ instruction: askQuote(ask), settles: true, settledValueQuote: STATED }).column,
      'asked-settled', 'control: the person\'s prose');
    assert.equal(ground({ instruction: askQuote(ask), settles: false, settledValueQuote: null }).column, 'asked-chose',
      'control: the same words filed chose how still ground (the column is the model\'s reading, checked by the'
        + ' challenge)');
    for (const [name, value, reason] of [
      ['a paraphrase of the words', 'Sort the feed newest first', 'receipt_rejected'],
      ['the code\'s value, not in the words', VALUE, 'receipt_rejected'],
      ['words from the project file, not the cited message', 'logs through the shared logger', 'receipt_rejected'],
    ]) {
      const d = ground({ instruction: askQuote(ask), settles: true, settledValueQuote: value });
      assert.equal(d.column, null, name);
      assert.ok(d.reasons.includes(reason), `${name}: ${reason}`);
    }
  });
