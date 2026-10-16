// G2 (owner decision 2026-10-15): a choice not to act whose existence check refuted the words it was anchored on is put
// to the reviewer once more. A stop to ask the person is often the agent's biggest judgment; a review can anchor it on
// a plan sentence ("First I will look at how the export command reads its flags."), which the existence check rightly
// refutes, and the choice was then lost. Now such a choice (a decision proposal whose `notActing` is true) is re-asked
// once, with what each refuting vote of the existence check said, for the agent's own words that state it; the new
// anchor is published only when its own existence check upholds it, with a column only when its check with that column
// upholds it, and otherwise "could not tell" with the reason of what was checked. Every recording here is synthetic; no
// model is called: the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { runReview, windowIncompleteReasons } from '../src/run-review.js';
import { NOW_ANSWER, PROMPT_VERSION, REANCHOR_HEADING, REANCHOR_WORDS, REANCHOR_NOW_ANSWER, RESTATUS_ROW,
  RESTATUS_CHECK, reanchorRequest } from '../src/prompt.js';
import { NOT_ACTING_REANCHOR_WITHHELD, NOT_ACTING_REANCHOR_COLUMN_WITHHELD, NOT_ACTING_REANCHOR_RECORD,
  DECISION_COLUMN_REFUTED, RESOLUTION_CHALLENGE_OUTCOMES, UNSETTLED_CHALLENGE } from '../src/ledger.js';
import { CHECKLIST_PROPOSITIONS, checklistProposition, REFUTING_VOTES, DECISION_EXISTENCE_NOTE } from '../src/challenge.js';
import { windowOfLabel } from '../../cli/src/session-review.js';

const ASK = 'Rename the --out flag of the export command to --output, update its tests, and run the suite.';
const PLAN = 'First I will look at how the export command reads its flags.';
const STOP = 'I have left the code as it was and am stopping here to ask you.';
const COMMAND = 'cat src/export.js';
const CLOSING = `${STOP} Should --out keep working beside --output, or go away?`;
/** The recording: the ask, the plan sentence, one read, and the agent's closing message (`closing`). */
const rows = (closing = CLOSING) => [
  humanAsk(ASK),
  said(PLAN),
  call('r1', 'Bash', { command: COMMAND, description: 'Read the export command' }),
  result('r1', "program.option('--out <dir>');", { stdout: "program.option('--out <dir>');",
    stderr: '', interrupted: false, isImage: false, noOutputExpected: false }, false),
  said(closing),
].map((r, i) => ({ ...r, uuid: `u-reanchor-${i + 1}` }));

const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const counts = (vocabulary, set = {}) => Object.fromEntries(vocabulary.map((token) => [token, set[token] ?? 0]));
const outcomes = (set) => counts(RESOLUTION_CHALLENGE_OUTCOMES, set);
const narrative = (decisions) => ({ requirements: [], claims: [], pivots: [], decisions });

async function fixture(t, closing = CLOSING) {
  const { session } = await load(t, rows(closing));
  const [plan, stop] = session.events.filter((event) => event.kind === 'commentary');
  return { session, ask: session.events.find((event) => event.kind === 'instruction'),
    read: session.events.find((event) => event.kind === 'invocation'), plan, stop };
}
/** "You settled it" on the ask's words: the column the first answer files. */
const settled = (n) => ({ instruction: quote(n.ask.id, 'instruction',
  'Rename the --out flag of the export command to --output'), settles: true, settledValueQuote: 'to --output' });
/** "You asked, the agent chose how" on the ask's words: another column. */
const choseHow = (n) => ({ instruction: quote(n.ask.id, 'instruction', 'update its tests'), settles: false,
  settledValueQuote: null });
/** The first answer's choice not to act: anchored on a plan sentence. */
const choice = (n, extra = {}) => ({ dimension: 'whether to stop and ask before renaming the flag',
  chosen: 'did not rename the flag; stopped to ask the human first', value: null, valueReceipt: null, actions: [],
  notActing: true, stated: quote(n.plan.id, 'commentary', PLAN), constrainedBy: settled(n), instructionReview: null,
  ...extra });
/** The same choice on the agent's own words that state it, as a re-ask may give it. */
const restated = (n, extra = {}) => choice(n, { stated: quote(n.stop.id, 'commentary', STOP), constrainedBy: choseHow(n),
  ...extra });
/** A choice that acts: the agent read the code first. */
const acting = (n) => ({ dimension: 'inspect the code before asking', chosen: 'read export.js before asking',
  value: null, valueReceipt: null, actions: [n.read.id], notActing: false, stated: null, constrainedBy: choseHow(n),
  instructionReview: null });

const WINDOW_REFUTATION = 'Who it says decided this does not hold: SYNTHETIC_REANCHOR_WINDOW.';
const EXISTENCE_REFUTATION = 'The quoted words are a plan, not a choice not to act: SYNTHETIC_REANCHOR_EXISTENCE';
const isColumnRun = (request) => /^challenge:w\d+:reanchor-column:/.test(request.label);
const isReanchorRun = (request) => /^challenge:w\d+:reanchor:/.test(request.label);
const isReask = (request) => /^narrative:w\d+:reanchor:/.test(request.label);
const isExistsRun = (request) => /^challenge:w\d+:exists:/.test(request.label);
/**
 * A judge in code. The narrative request is answered with `first`; a re-ask (`narrative:w1:reanchor:K`) with
 * `reanchor(request)` (a throw is a failed call). The window's own check refutes every decision, and the existence check of
 * W1 A votes `refutedBy(pass)`; the re-anchored choice's existence check votes `exists(pass)` and its check with its
 * column `column(pass)` (a throw is a failed pass). Each vote cites the decision's anchor (or its action). Every request
 * is kept in `seen`.
 */
function judgeOf(n, { first = () => narrative([choice(n)]), reanchor = () => narrative([restated(n)]),
  refutedBy = () => 'refuted', exists = () => 'not-refuted', column = () => 'not-refuted', seen = [] } = {}) {
  return async (request) => {
    seen.push(request);
    if (request.challenge) {
      const pass = Number(/:p(\d+)$/.exec(request.label)?.[1]);
      return { votes: request.challenge.items.map((item) => {
        const verdict = isColumnRun(request) ? column(pass) : isReanchorRun(request) ? exists(pass)
          : isExistsRun(request) ? refutedBy(pass) : item.type === 'decision' ? 'refuted' : 'not-refuted';
        const explanation = isExistsRun(request) ? `${EXISTENCE_REFUTATION} (pass ${pass}).`
          : verdict === 'refuted' ? WINDOW_REFUTATION : 'Synthetic.';
        const receipt = item.candidate.stated ? item.candidate.stated
          : quote(item.candidate.actions[0], 'action', COMMAND);
        return { key: item.key, verdict, explanation, receipts: [receipt] };
      }) };
    }
    if (isReask(request)) return reanchor(request);
    return first();
  };
}
const review = (n, judge, extra = {}) => runReview({ session: n.session, pr: null, reviewScope: 'session-only', judge,
  ...extra });
const record = (report) => report.windowResults[0].reanchor;
const recordOf = ({ refuted = 1, asked = 1, withheld = {}, existence = {}, columnWithheld = {}, challenged = {} } = {}) =>
  Object.fromEntries(NOT_ACTING_REANCHOR_RECORD.map((member) => [member, {
    refuted, asked, withheld: counts(NOT_ACTING_REANCHOR_WITHHELD, withheld), existence: outcomes(existence),
    columnWithheld: counts(NOT_ACTING_REANCHOR_COLUMN_WITHHELD, columnWithheld), challenged: outcomes(challenged),
  }[member]]));

test('G2: the vocabularies, the version and the labels', () => {
  assert.deepEqual(NOT_ACTING_REANCHOR_WITHHELD, ['request_bound', 'no_answer', 'none_stated', 'no_row', 'same_anchor',
    'ungrounded']);
  assert.deepEqual(NOT_ACTING_REANCHOR_COLUMN_WITHHELD, ['could_not_tell', 'ungrounded']);
  assert.deepEqual(NOT_ACTING_REANCHOR_RECORD, ['refuted', 'asked', 'withheld', 'existence', 'columnWithheld',
    'challenged']);
  for (const list of [NOT_ACTING_REANCHOR_WITHHELD, NOT_ACTING_REANCHOR_COLUMN_WITHHELD, NOT_ACTING_REANCHOR_RECORD])
    assert.ok(Object.isFrozen(list));
  // One bump for the new request (the re-ask's fixed words); no request sent before moved.
  assert.equal(PROMPT_VERSION, 'sonah.narrative/37');
  assert.equal(windowOfLabel('narrative:w2:reanchor:3'), 2, 'a re-ask belongs to its window (F226)');
  assert.equal(windowOfLabel('challenge:w2:reanchor:b1:p1'), 2);
  assert.equal(windowOfLabel('challenge:w2:reanchor-column:b1:p1'), 2);
});

test('G2: a choice not to act its existence check refuted is re-asked once, with what that check said', async (t) => {
  const n = await fixture(t);
  const seen = [];
  const report = await review(n, judgeOf(n, { seen }));
  const reasks = seen.filter(isReask);
  assert.deepEqual(reasks.map((request) => request.label), ['narrative:w1:reanchor:0'], 'one re-ask, named after it');
  const [reask] = reasks;
  const first = seen.find((request) => request.label === 'narrative:w1');
  assert.equal(reask.system, first.system);
  assert.deepEqual(reask.schema, first.schema);
  const head = first.prompt.slice(0, first.prompt.length - `\n${NOW_ANSWER.join('\n')}`.length);
  assert.ok(reask.prompt.startsWith(`${head}\n\n${REANCHOR_HEADING}\n\n${REANCHOR_WORDS.join('\n')}\n\n${RESTATUS_ROW}\n`));
  assert.ok(reask.prompt.endsWith(`\n\n${REANCHOR_NOW_ANSWER.join('\n')}`));
  // What each refuting vote of the existence check said (three passes in the standard profile) — the reasons the choice
  // was refuted on — and never the window's own refutation, which W1 A's existence check was already shown.
  const check = reask.prompt.slice(reask.prompt.indexOf(`\n${RESTATUS_CHECK}\n`));
  for (const pass of [1, 2, 3]) assert.ok(check.includes(`"explanation":"${EXISTENCE_REFUTATION} (pass ${pass})."`), pass);
  assert.ok(!reask.prompt.includes(WINDOW_REFUTATION));
  assert.ok(reask.prompt.includes(`"notActing":true,"stated":{"eventId":"`), 'the row as the answer proposed it');
  assert.ok(!reask.prompt.includes(n.plan.id), 'events are named by the window\'s aliases');
  assert.deepEqual(record(report), recordOf({ existence: { upheld: 1 }, challenged: { upheld: 1 } }));
  assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [], 'the window is complete');
});

test('G2: an upheld re-ask is published as a choice not to act, on the agent\'s own words', async (t) => {
  const n = await fixture(t);
  const seen = [];
  const report = await review(n, judgeOf(n, { seen }));
  assert.equal(report.decisions.length, 1, 'the stop is no longer lost');
  const [d] = report.decisions;
  assert.deepEqual([d.notActing, d.stated.eventId, d.stated.quote, d.dimension, d.chosen, d.actions],
    [true, n.stop.id, STOP, choice(n).dimension, choice(n).chosen, []], 'the choice stays its own, on its new words');
  assert.deepEqual([d.column, d.columnState], ['asked-chose', 'grounded'], 'with the column its own check upheld');
  assert.deepEqual(report.counts.checklist.notActing, { proposed: 1, published: 1 });
  // Its existence check: the choice alone, on the existence proposition, with no refuting votes and no existence note,
  // unanimous across the passes the existence check that refuted it used, on the whole window.
  const exists = seen.filter(isReanchorRun);
  assert.deepEqual(exists.map((request) => request.label), ['challenge:w1:reanchor:b1:p1', 'challenge:w1:reanchor:b1:p2',
    'challenge:w1:reanchor:b1:p3']);
  for (const request of exists) {
    const [item] = request.challenge.items;
    assert.equal(item.key, 'decisions:0:reanchor');
    assert.ok(!Object.hasOwn(item.candidate, 'constrainedBy') && !Object.hasOwn(item.candidate, 'instructionReview'));
    assert.ok(!Object.hasOwn(item.candidate, REFUTING_VOTES));
    assert.equal(item.candidate.stated.quote, STOP);
    assert.equal(checklistProposition(item), CHECKLIST_PROPOSITIONS.decisionNotActing);
    assert.ok(!request.system.includes(DECISION_EXISTENCE_NOTE));
  }
  const profile = report.windowResults[0].reanchorExistsChallenge.profile;
  assert.deepEqual([profile.passes, profile.requiredSurvivals, profile.unanimous], [3, 3, true]);
  // Its new column, checked on its own proposition after the existence check.
  const column = seen.filter(isColumnRun);
  assert.deepEqual(column.map((request) => request.label), ['challenge:w1:reanchor-column:b1:p1',
    'challenge:w1:reanchor-column:b1:p2', 'challenge:w1:reanchor-column:b1:p3']);
  assert.equal(column[0].challenge.items[0].key, 'decisions:0:reanchor-column');
  assert.equal(checklistProposition(column[0].challenge.items[0]), CHECKLIST_PROPOSITIONS.decisionNotActingChoseHow);
  // In the default profile too, where the existence check keeps its three unanimous passes and the check with the
  // column runs as the decision's own check did: its single pass, not the existence check's bounds.
  const leanSeen = [];
  const lean = await review(n, judgeOf(n, { seen: leanSeen }), { speedProfile: 'm33-lean' });
  assert.deepEqual(lean.decisions.map((x) => [x.notActing, x.stated.quote]), [[true, STOP]]);
  assert.equal(record(lean).existence.upheld, 1);
  assert.deepEqual(leanSeen.filter(isReanchorRun).map((request) => request.label), ['challenge:w1:reanchor:b1:p1',
    'challenge:w1:reanchor:b1:p2', 'challenge:w1:reanchor:b1:p3']);
  assert.deepEqual(leanSeen.filter(isColumnRun).map((request) => request.label), ['challenge:w1:reanchor-column:b1:p1']);
  const leanExists = lean.windowResults[0].reanchorExistsChallenge.profile;
  assert.deepEqual([leanExists.passes, leanExists.requiredSurvivals, leanExists.unanimous], [3, 3, true]);
  const leanColumn = lean.windowResults[0].reanchorChallenge.profile;
  assert.deepEqual([leanColumn.passes, leanColumn.requiredSurvivals, Object.hasOwn(leanColumn, 'unanimous')],
    [1, 1, false]);
});

test('G2: who decided a re-anchored choice is shown only when its own check upholds it, and "could not tell" says why',
  async (t) => {
    const n = await fixture(t);
    const [UNSETTLED, UNREVIEWED] = UNSETTLED_CHALLENGE;
    const failed = () => { throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' }); };
    const again = () => narrative([restated(n, { constrainedBy: settled(n) })]);
    // [the case, what the record counts, the column, its state and the reason it is published with, how it is judged]
    const cases = [
      ['a new column, upheld', { challenged: { upheld: 1 } }, ['asked-chose', 'grounded', undefined], {}],
      // The window's challenge refuted the choice on words that do not state it, so code cannot tell it refuted who
      // decided it: the column it refuted, given again, is checked with the choice on its new words.
      ['the refuted column again, upheld', { challenged: { upheld: 1 } }, ['asked-settled', 'grounded', undefined],
        { reanchor: again }],
      // Its check refuted it while its existence check upheld the choice on these words: that check refuted who decided
      // it, and no other column was given (W1 A's reason, for W1 A's cause).
      ['a new column, refuted', { challenged: { refuted: 1 } }, [null, 'unchecked', DECISION_COLUMN_REFUTED],
        { column: () => 'refuted' }],
      ['the refuted column again, refuted', { challenged: { refuted: 1 } }, [null, 'unchecked', DECISION_COLUMN_REFUTED],
        { reanchor: again, column: () => 'refuted' }],
      // Its check did not settle, or did not run: said as of any decision whose own check ended so (S6).
      ['unsettled', { challenged: { unsettled: 1 } }, [null, 'unchecked', UNSETTLED], { column: () => 'uncertain' }],
      ['not run', { challenged: { unexecuted: 1 } }, [null, 'unchecked', UNREVIEWED], { column: failed }],
      // No column was checked: the ledger's own reason for the column the row gives, never a check's.
      ['no column', { columnWithheld: { could_not_tell: 1 } }, [null, 'unchecked', 'column_unchecked'],
        { reanchor: () => narrative([restated(n, { constrainedBy: null })]) }],
      ['a column that does not ground', { columnWithheld: { ungrounded: 1 } }, [null, 'unchecked', 'receipt_rejected'],
        { reanchor: () => narrative([restated(n, { constrainedBy: { ...choseHow(n),
          instruction: quote(n.ask.id, 'instruction', 'words the human never wrote') } })]) }],
    ];
    for (const [name, counted, [column, state, reason], judging] of cases) {
      const seen = [];
      const report = await review(n, judgeOf(n, { seen, ...judging }));
      // (Its value is null, so `value_unchecked` follows the column's reason.)
      assert.deepEqual(report.decisions.map((d) => [d.notActing, d.stated.quote, d.column, d.columnState, d.reasons]),
        [[true, STOP, column, state, [reason, 'value_unchecked'].filter(Boolean)]], name);
      assert.deepEqual(record(report), recordOf({ existence: { upheld: 1 }, ...counted }), name);
      assert.equal(seen.some(isColumnRun), Object.hasOwn(counted, 'challenged'),
        `${name}: a column is checked when it grounds`);
      assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [], name);
    }
  });

test('G2: a refuted re-ask is not published, and is never asked again', async (t) => {
  const n = await fixture(t);
  for (const [ended, exists] of [['refuted', () => 'refuted'], ['refuted', (pass) => (pass === 2 ? 'refuted'
    : 'not-refuted')], ['unsettled', (pass) => (pass === 3 ? 'uncertain' : 'not-refuted')]]) {
    const seen = [];
    const report = await review(n, judgeOf(n, { seen, exists }));
    assert.equal(report.decisions.length, 0, `${ended}: the choice stays out`);
    assert.deepEqual(record(report), recordOf({ existence: { [ended]: 1 } }), ended);
    assert.equal(seen.filter(isReask).length, 1, `${ended}: one re-ask, never a second`);
    assert.ok(!seen.some(isColumnRun), `${ended}: no column is checked`);
    assert.equal(report.windowResults[0].reanchorChallenge, undefined, ended);
    assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [], ended);
  }
});

test('G2: only a choice its existence check refuted is re-asked, never one that check left unsettled', async (t) => {
  const n = await fixture(t);
  for (const [ended, refutedBy] of [['unsettled', (pass) => (pass === 3 ? 'uncertain' : 'not-refuted')],
    ['unexecuted', () => { throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' }); }]]) {
    const seen = [];
    const report = await review(n, judgeOf(n, { seen, refutedBy }));
    assert.deepEqual(report.windowResults[0].recolumn.existence, outcomes({ [ended]: 1 }), ended);
    assert.equal(report.decisions.length, 0, `${ended}: it stays out, as before`);
    assert.ok(!seen.some((request) => /:reanchor/.test(request.label)), `${ended}: nothing is re-asked`);
    for (const member of ['reanchor', 'reanchorExistsChallenge', 'reanchorChallenge'])
      assert.equal(Object.hasOwn(report.windowResults[0], member), false, `${ended}: ${member}`);
  }
});

test('G2: only the new words and who decided it are taken from the re-ask; the choice stays the decision\'s own',
  async (t) => {
    const n = await fixture(t);
    const seen = [];
    const report = await review(n, judgeOf(n, { seen, reanchor: () => narrative([restated(n, {
      valueReceipt: { eventId: n.read.id, field: 'command', role: 'action', quote: COMMAND } })]) }));
    for (const request of [...seen.filter(isReanchorRun), ...seen.filter(isColumnRun)]) {
      const { candidate } = request.challenge.items[0];
      assert.deepEqual([candidate.dimension, candidate.chosen, candidate.value, candidate.valueReceipt, candidate.actions],
        [choice(n).dimension, choice(n).chosen, null, null, []], request.label);
    }
    assert.deepEqual(report.decisions.map((d) => [d.stated.quote, d.valueReceipt]), [[STOP, null]]);
  });

test('G2: words in another message are not the refuted anchor, even when they hold the refuted words', async (t) => {
  // The agent says its plan sentence again in the message where it stops; the re-ask quotes that later message.
  const n = await fixture(t, `${PLAN} ${CLOSING}`);
  const later = `${PLAN} I have left the code as it was`;
  const seen = [];
  const report = await review(n, judgeOf(n, { seen, reanchor: () => narrative([restated(n, {
    stated: quote(n.stop.id, 'commentary', later) })]) }));
  assert.equal(record(report).withheld.same_anchor, 0);
  assert.deepEqual(seen.filter(isReanchorRun)[0].challenge.items[0].candidate.stated, quote(n.stop.id, 'commentary',
    later), 'its own existence check judges it');
  assert.deepEqual(report.decisions.map((d) => [d.notActing, d.stated.eventId, d.stated.quote]),
    [[true, n.stop.id, later]]);
});

test('G2: a refuted decision that is not a choice not to act is not re-asked', async (t) => {
  const n = await fixture(t);
  const seen = [];
  const report = await review(n, judgeOf(n, { seen, first: () => narrative([acting(n)]) }));
  assert.equal(report.decisions.length, 0, 'refuted on its existence: it stays out, as before');
  assert.deepEqual(report.windowResults[0].recolumn.existence, outcomes({ refuted: 1 }));
  assert.ok(!seen.some((request) => /:reanchor/.test(request.label)));
  for (const member of ['reanchor', 'reanchorExistsChallenge', 'reanchorChallenge'])
    assert.equal(Object.hasOwn(report.windowResults[0], member), false, member);
  // Beside a choice not to act, only the choice not to act is re-asked.
  const both = [];
  const mixed = await review(n, judgeOf(n, { seen: both, first: () => narrative([acting(n), choice(n)]) }));
  assert.deepEqual(both.filter(isReask).map((request) => request.label), ['narrative:w1:reanchor:1']);
  assert.deepEqual(mixed.decisions.map((d) => [d.notActing === true, d.stated?.quote]), [[true, STOP]]);
  assert.deepEqual(record(mixed), recordOf({ existence: { upheld: 1 }, challenged: { upheld: 1 } }));
});

test('G2: precision — the refuted words are never published again, and a re-ask that fails changes nothing more',
  async (t) => {
    const n = await fixture(t);
    const cases = [
      ['same_anchor', () => narrative([restated(n, { stated: quote(n.plan.id, 'commentary', PLAN) })])],
      // Part of the refuted words, or more of the message around them, is the refuted anchor too.
      ['same_anchor', () => narrative([restated(n, { stated: quote(n.plan.id, 'commentary', 'how the export command reads')
      })])],
      ['none_stated', () => narrative([])],
      // A choice that acts, another set of actions, another dimension, choice or value (the re-ask asks for them exactly
      // as in its row), or two rows for the one choice are not this choice's row.
      ['no_row', () => narrative([restated(n, { notActing: false })])],
      ['no_row', () => narrative([restated(n, { actions: [n.read.id] })])],
      ['no_row', () => narrative([restated(n, { dimension: 'whether to keep --out working beside --output' })])],
      ['no_row', () => narrative([restated(n, { chosen: 'stopped to ask the human first' })])],
      ['no_row', () => narrative([restated(n, { value: '--output' })])],
      ['no_row', () => narrative([restated(n), restated(n, { stated: quote(n.stop.id, 'commentary',
        'stopping here to ask you') })])],
      ['ungrounded', () => narrative([restated(n, { stated: quote(n.stop.id, 'commentary', 'words the agent never said') })])],
      // Words of the human's are not the agent's own, whatever role the row gives them.
      ['ungrounded', () => narrative([restated(n, { stated: quote(n.ask.id, 'commentary', 'update its tests') })])],
      ['no_row', () => narrative([restated(n, { stated: quote(n.ask.id, 'instruction', 'update its tests') })])],
      ['no_answer', () => ({ decisions: 'not a list' })],
      ['no_answer', () => { throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' }); }],
    ];
    for (const [withheld, reanchor] of cases) {
      const seen = [];
      const report = await review(n, judgeOf(n, { seen, reanchor }));
      assert.equal(report.decisions.length, 0, `${withheld}: the choice stays out`);
      assert.deepEqual(record(report), recordOf({ withheld: { [withheld]: 1 } }), withheld);
      assert.ok(!seen.some((request) => isReanchorRun(request) || isColumnRun(request)), `${withheld}: nothing checked`);
      assert.equal(report.windowResults[0].reanchorExistsChallenge, undefined, withheld);
      assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [], withheld);
    }
  });

test('G2: the re-ask is deterministic, and null without a session-only "Now answer" to replace', () => {
  const request = { system: 'S', prompt: `before\n${NOW_ANSWER.join('\n')}`, schema: {}, label: 'narrative:w1' };
  const row = { dimension: 'd', chosen: 'c', value: null, valueReceipt: null, actions: [], notActing: true,
    stated: { eventId: 'E3', role: 'commentary', quote: PLAN }, constrainedBy: null, instructionReview: null };
  const votes = [{ explanation: EXISTENCE_REFUTATION, receipts: [{ eventId: 'E3', role: 'commentary', quote: PLAN }] }];
  const one = reanchorRequest({ request, row, refutations: votes, label: 'narrative:w1:reanchor:0' });
  assert.deepEqual(one, reanchorRequest({ request, row, refutations: votes, label: 'narrative:w1:reanchor:0' }));
  assert.equal(one.label, 'narrative:w1:reanchor:0');
  assert.equal(one.prompt, ['before', '', REANCHOR_HEADING, '', ...REANCHOR_WORDS, '', RESTATUS_ROW, JSON.stringify(row),
    '', RESTATUS_CHECK, JSON.stringify(votes[0]), '', ...REANCHOR_NOW_ANSWER].join('\n'));
  assert.equal(reanchorRequest({ request: { ...request, prompt: 'no closing' }, row, refutations: votes, label: 'l' }),
    null);
});

/** The bytes a request sends (its system and prompt), as one digest. */
const sent = (request) => createHash('sha256').update(JSON.stringify([request.system, request.prompt])).digest('hex');
/**
 * Computed at f826aee (before G2) on this recording, its first answer and its votes, under the standard profile and the
 * default one (`m33-lean`): the window's narrative request, and every request that review sent, by label. A review now
 * sends each of them byte for byte, and only the re-ask and the checks of the re-anchored choice besides.
 */
const BEFORE = Object.freeze({
  narrative: '0a1cb70c0356b68a6da0d4c0621e517956beec92a5e4512cc32f063a64f82a58',
  standard: Object.freeze({ requests: '3728f4e8728031e0add16d3863c977239b248494e41c769eb7da2a728ab00399',
    labels: Object.freeze(['challenge:w1:b1:p1', 'challenge:w1:b1:p2', 'challenge:w1:b1:p3', 'challenge:w1:exists:b1:p1',
      'challenge:w1:exists:b1:p2', 'challenge:w1:exists:b1:p3', 'narrative:w1']) }),
  'm33-lean': Object.freeze({ requests: '69101425b6a95f370aac9b8ed6ccbaa1d8f371d0c22ba3edea7ae3c8751ebaa2',
    labels: Object.freeze(['challenge:w1:exists:b1:p1', 'challenge:w1:exists:b1:p2', 'challenge:w1:exists:b1:p3',
      'challenge:w1:t1:b1:p1', 'narrative:w1']) }),
});
test('G2: no request sent before moved — only the re-ask and its checks are new', async (t) => {
  const n = await fixture(t);
  for (const profile of ['standard', 'm33-lean'])
    for (const judging of [{}, { exists: () => 'refuted' }, { reanchor: () => narrative([]) }]) {
      const seen = [];
      await review(n, judgeOf(n, { seen, ...judging }), profile === 'standard' ? {} : { speedProfile: profile });
      assert.equal(sent(seen.find((request) => request.label === 'narrative:w1')), BEFORE.narrative, profile);
      const before = seen.filter((request) => !/:reanchor/.test(request.label))
        .map((request) => [request.label, sent(request)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      assert.deepEqual(before.map(([label]) => label), BEFORE[profile].labels, profile);
      assert.equal(createHash('sha256').update(JSON.stringify(before)).digest('hex'), BEFORE[profile].requests, profile);
      assert.deepEqual(seen.filter(isReask).map((request) => request.label), ['narrative:w1:reanchor:0'], profile);
    }
});
