// W1 A (owner decision 2026-10-13): a decision the challenge refuted only on who decided it is no longer dropped. Its
// choice is checked on its own first (the existence proposition: the cited actions adopted the stated choice); a choice
// that check upholds is put to the reviewer once more with what the refuting check said, and the new column is
// published only when its own check upholds it; otherwise the decision is published "could not tell" with the closed
// reason `decision_column_refuted`. A decision refuted on existence stays out, as before. Every recording here is
// synthetic; no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { runReview, windowIncompleteReasons } from '../src/run-review.js';
import { NOW_ANSWER, PROMPT_VERSION, RECOLUMN_HEADING, RECOLUMN_WORDS, RECOLUMN_NOW_ANSWER, RESTATUS_ROW,
  RESTATUS_CHECK, recolumnRequest } from '../src/prompt.js';
import { DECISION_RECOLUMN_WITHHELD, DECISION_COLUMN_REFUTED, RESOLUTION_CHALLENGE_OUTCOMES, JUDGMENT_REASONS }
  from '../src/ledger.js';
import { CHECKLIST_PROPOSITIONS, checklistProposition, SESSION_DOSSIER_NOTE } from '../src/challenge.js';
import { renderSessionPage, PAGE_COLUMN_REASON_WORDS } from '../../render/session-page.js';
import { windowOfLabel } from '../../cli/src/session-review.js';

const ASK = 'Fix greet.js so empty names give a friendly greeting.';
const CODE = 'return name || "guest"';

function rows() {
  return [
    humanAsk(ASK),
    call('t1', 'Edit', { file_path: '/repo/greet.js', old_string: 'return name', new_string: CODE }),
    result('t1', 'The file /repo/greet.js has been updated.', { filePath: '/repo/greet.js', oldString: 'return name',
      newString: CODE, originalFile: 'return name\n', structuredPatch: [], userModified: false, replaceAll: false }),
    said('Fixed greet.js: an empty name now gets "guest".'),
  ];
}
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const counts = (vocabulary, set = {}) => Object.fromEntries(vocabulary.map((token) => [token, set[token] ?? 0]));

function fixture(session) {
  const ask = session.events.find((event) => event.kind === 'instruction');
  const edit = session.events.find((event) => event.kind === 'invocation');
  return { ask, edit, words: quote(ask.id, 'instruction', 'empty names give a friendly greeting') };
}
/** The first answer's decision: filed "you settled it" on the human's words, which leave the greeting open. */
const settledDecision = (n) => ({ dimension: 'empty-name greeting', chosen: 'greet an empty name as "guest"',
  value: '"guest"', valueReceipt: { eventId: n.edit.id, field: 'added-code', role: 'code', quote: CODE },
  actions: [n.edit.id], constrainedBy: { instruction: n.words, settles: true,
    settledValueQuote: 'a friendly greeting' } });
/** The same choice, filed "you asked, the agent chose how" on the same words. */
const choseHow = (n, extra = {}) => ({ ...settledDecision(n), dimension: 'any words', chosen: 'any words',
  constrainedBy: { instruction: n.words, settles: false, settledValueQuote: null }, ...extra });
const narrative = (decisions) => ({ requirements: [], claims: [], pivots: [], decisions });

/**
 * A judge in code. The narrative request is answered with `first`; a re-ask (`narrative:w1:recolumn:K`) with
 * `recolumn(request)` (a throw is a failed call). A challenge vote is `verdict(item, request)`, citing the decision's
 * action. Every request is kept in `seen`.
 */
function judgeOf({ first, recolumn = () => null, verdict, seen = [] }) {
  return async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: verdict(item, request), explanation: `Synthetic check of ${item.key}.`,
      receipts: [quote(item.candidate.actions[0], 'code', CODE)] })) };
    if (/:recolumn:/.test(request.label)) return recolumn(request);
    return first();
  };
}
/** The window's own check refutes the decision; the existence check gives `exists`; the new column's check `column`. */
const verdicts = ({ exists = 'not-refuted', column = 'not-refuted' } = {}) => (item, request) =>
  (/:exists/.test(request.label) ? exists : /:recolumn/.test(request.label) ? column
    : item.type === 'decision' ? 'refuted' : 'not-refuted');
const review = (session, judge, extra = {}) => runReview({ session, pr: null, reviewScope: 'session-only', judge,
  ...extra });
const record = (report) => report.windowResults[0].recolumn;

test('W1 A: the vocabularies, the version and the label', () => {
  assert.deepEqual(DECISION_RECOLUMN_WITHHELD, ['request_bound', 'no_answer', 'no_row', 'could_not_tell', 'ungrounded',
    'same_column']);
  assert.ok(Object.isFrozen(DECISION_RECOLUMN_WITHHELD));
  assert.equal(DECISION_COLUMN_REFUTED, 'decision_column_refuted');
  assert.ok(JUDGMENT_REASONS.includes(DECISION_COLUMN_REFUTED), 'a member of the closed row reasons');
  assert.ok(Object.hasOwn(PAGE_COLUMN_REASON_WORDS, DECISION_COLUMN_REFUTED), 'the page has words for it');
  // One bump for the new request (the re-ask's fixed words).
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  // D103 moved it once more (sonah.narrative/38): a Claude Code recording's results shown up to 12,000 bytes a side.
  assert.equal(PROMPT_VERSION, 'sonah.narrative/38');
  assert.equal(windowOfLabel('narrative:w2:recolumn:3'), 2, 'a re-ask belongs to its window (F226)');
});

test('W1 A: a choice refuted on its column, which exists, is re-asked; a new column its check upholds is published',
  async (t) => {
    const { session } = await load(t, rows());
    const n = fixture(session);
    const seen = [];
    const report = await review(session, judgeOf({ seen, first: () => narrative([settledDecision(n)]),
      verdict: verdicts(), recolumn: () => narrative([choseHow(n)]) }));
    assert.equal(report.decisions.length, 1, 'the decision is no longer dropped');
    const [d] = report.decisions;
    assert.deepEqual([d.column, d.columnState, d.dimension, d.chosen],
      ['asked-chose', 'grounded', 'empty-name greeting', 'greet an empty name as "guest"'],
      'published under the upheld column; the choice stays the row\'s own');
    assert.deepEqual(record(report), { refuted: 1, existence: counts(RESOLUTION_CHALLENGE_OUTCOMES, { upheld: 1 }),
      asked: 1, withheld: counts(DECISION_RECOLUMN_WITHHELD),
      challenged: counts(RESOLUTION_CHALLENGE_OUTCOMES, { upheld: 1 }) });
    assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [], 'the window is complete');
    // The existence check: the choice alone, on its own proposition, three passes in the standard profile.
    const exists = seen.filter((request) => request.challenge && request.label.startsWith('challenge:w1:exists'));
    assert.deepEqual(exists.map((request) => request.label), ['challenge:w1:exists:b1:p1', 'challenge:w1:exists:b1:p2',
      'challenge:w1:exists:b1:p3']);
    const [existsItem] = exists[0].challenge.items;
    assert.equal(existsItem.key, 'decisions:0:exists');
    assert.ok(!Object.hasOwn(existsItem.candidate, 'constrainedBy') && !Object.hasOwn(existsItem.candidate,
      'instructionReview'), 'asked without who decided it');
    assert.equal(checklistProposition(existsItem), CHECKLIST_PROPOSITIONS.decision);
    // The re-ask: the window's own request, its "Now answer" replaced, one call, named after the refuted decision.
    const narrativeRequest = seen.find((request) => request.label === 'narrative:w1');
    const reasks = seen.filter((request) => /:recolumn:/.test(request.label) && !request.challenge);
    assert.deepEqual(reasks.map((request) => request.label), ['narrative:w1:recolumn:0']);
    const [reask] = reasks;
    assert.equal(reask.system, narrativeRequest.system);
    assert.deepEqual(reask.schema, narrativeRequest.schema);
    const head = narrativeRequest.prompt.slice(0, narrativeRequest.prompt.length - `\n${NOW_ANSWER.join('\n')}`.length);
    assert.ok(reask.prompt.startsWith(`${head}\n\n${RECOLUMN_HEADING}\n\n${RECOLUMN_WORDS.join('\n')}\n\n${RESTATUS_ROW}\n`));
    assert.ok(reask.prompt.endsWith(`\n\n${RECOLUMN_NOW_ANSWER.join('\n')}`));
    assert.ok(reask.prompt.includes(`${RESTATUS_CHECK}\n{"explanation":"Synthetic check of decisions:0.","receipts":[`));
    assert.ok(!reask.prompt.includes(n.edit.id), 'events are named by the window\'s aliases');
    // The new column is checked on its own proposition, after the re-ask.
    const recheck = seen.filter((request) => request.challenge && request.label.startsWith('challenge:w1:recolumn'));
    assert.deepEqual(recheck.map((request) => request.label), ['challenge:w1:recolumn:b1:p1',
      'challenge:w1:recolumn:b1:p2', 'challenge:w1:recolumn:b1:p3']);
    const [recheckItem] = recheck[0].challenge.items;
    assert.equal(recheckItem.key, 'decisions:0:recolumn');
    assert.equal(checklistProposition(recheckItem), CHECKLIST_PROPOSITIONS.decisionChoseHow);
  });

test('W1 A: a new column its own check does not uphold is published "could not tell", with its closed reason',
  async (t) => {
    const { session } = await load(t, rows());
    const n = fixture(session);
    for (const [ended, column] of [['refuted', 'refuted'], ['unsettled', 'uncertain']]) {
      const report = await review(session, judgeOf({ first: () => narrative([settledDecision(n)]),
        verdict: verdicts({ column }), recolumn: () => narrative([choseHow(n)]) }));
      assert.deepEqual(report.decisions.map((d) => [d.column, d.columnState, d.reasons[0], d.constrainedBy]),
        [[null, 'unchecked', DECISION_COLUMN_REFUTED, null]], ended);
      assert.deepEqual(record(report).challenged, counts(RESOLUTION_CHALLENGE_OUTCOMES, { [ended]: 1 }), ended);
      assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [], `${ended}: never makes a window incomplete`);
    }
    // Every reader says why, in its own words.
    const report = await review(session, judgeOf({ first: () => narrative([settledDecision(n)]),
      verdict: verdicts({ column: 'refuted' }), recolumn: () => narrative([choseHow(n)]) }));
    const html = renderSessionPage(session, report, { sessionHash: 'a'.repeat(64) });
    const words = PAGE_COLUMN_REASON_WORDS[DECISION_COLUMN_REFUTED];
    assert.ok(html.includes(words.replace(/'/g, '&#39;')));
  });

test('W1 A: precision — the refuted column is never published again, and a re-ask that fails changes no more',
  async (t) => {
    const { session } = await load(t, rows());
    const n = fixture(session);
    const cases = [
      // The very column the check refuted, on the same words: not asked again, not published.
      ['same_column', () => narrative([{ ...settledDecision(n), dimension: 'again' }])],
      ['could_not_tell', () => narrative([{ ...settledDecision(n), constrainedBy: null }])],
      ['ungrounded', () => narrative([choseHow(n, { constrainedBy: { instruction: quote(n.ask.id, 'instruction',
        'words the human never wrote'), settles: false, settledValueQuote: null } })])],
      ['no_row', () => narrative([])],
      // Another choice (another action set) is not this one.
      ['no_row', () => narrative([choseHow(n, { actions: [] , notActing: true,
        stated: quote(n.ask.id, 'instruction', 'Fix greet.js') })])],
      // Two rows for the one choice are none.
      ['no_row', () => narrative([choseHow(n), choseHow(n, { dimension: 'a second row' })])],
      ['no_answer', () => ({ decisions: 'not a list' })],
      ['no_answer', () => { throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' }); }],
    ];
    for (const [withheld, recolumn] of cases) {
      const seen = [];
      const report = await review(session, judgeOf({ seen, first: () => narrative([settledDecision(n)]),
        verdict: verdicts(), recolumn }));
      assert.deepEqual(report.decisions.map((d) => [d.column, d.reasons[0]]), [[null, DECISION_COLUMN_REFUTED]],
        withheld);
      assert.deepEqual(record(report), { refuted: 1, existence: counts(RESOLUTION_CHALLENGE_OUTCOMES, { upheld: 1 }),
        asked: 1, withheld: counts(DECISION_RECOLUMN_WITHHELD, { [withheld]: 1 }),
        challenged: counts(RESOLUTION_CHALLENGE_OUTCOMES) }, withheld);
      assert.equal(report.windowResults[0].recolumnChallenge, undefined, `${withheld}: nothing was checked again`);
      assert.ok(!seen.some((request) => request.challenge && request.label.startsWith('challenge:w1:recolumn')),
        withheld);
      assert.deepEqual(windowIncompleteReasons(report.windowResults[0]), [], withheld);
    }
  });

test('W1 A: a choice its existence check does not uphold stays out, and is never re-asked', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  for (const [ended, exists] of [['refuted', 'refuted'], ['unsettled', 'uncertain']]) {
    const seen = [];
    const report = await review(session, judgeOf({ seen, first: () => narrative([settledDecision(n)]),
      verdict: verdicts({ exists }), recolumn: () => narrative([choseHow(n)]) }));
    assert.equal(report.decisions.length, 0, ended);
    assert.deepEqual(record(report), { refuted: 1, existence: counts(RESOLUTION_CHALLENGE_OUTCOMES, { [ended]: 1 }),
      asked: 0, withheld: counts(DECISION_RECOLUMN_WITHHELD), challenged: counts(RESOLUTION_CHALLENGE_OUTCOMES) },
    ended);
    assert.ok(!seen.some((request) => /:recolumn/.test(request.label)), ended);
    assert.ok(report.windowResults[0].recolumnExistsChallenge.results.length === 1, ended);
  }
});

test('W1 A: a refuted decision that names no column is not asked again; a window with none keeps its record',
  async (t) => {
    const { session } = await load(t, rows());
    const n = fixture(session);
    // No column filed (could not tell): its refutation can only be about the choice itself.
    const seen = [];
    const plainChoice = { ...settledDecision(n), constrainedBy: null };
    const refuted = await review(session, judgeOf({ seen, first: () => narrative([plainChoice]), verdict: verdicts() }));
    assert.equal(refuted.decisions.length, 0);
    assert.ok(!seen.some((request) => /:(exists|recolumn)/.test(request.label)));
    assert.equal(Object.hasOwn(refuted.windowResults[0], 'recolumn'), false);
    // Nothing refuted: no new request and no new record member.
    const upheld = await review(session, judgeOf({ seen, first: () => narrative([settledDecision(n)]),
      verdict: () => 'not-refuted' }));
    assert.equal(upheld.decisions[0].column, 'asked-settled');
    for (const key of ['recolumn', 'recolumnExistsChallenge', 'recolumnChallenge'])
      assert.equal(Object.hasOwn(upheld.windowResults[0], key), false, key);
  });

test('W1 A: in m33-lean the new column is checked as the decision was — once, on a dossier; the existence check is not',
  async (t) => {
    const { session } = await load(t, rows());
    const n = fixture(session);
    const seen = [];
    const report = await review(session, judgeOf({ seen, first: () => narrative([settledDecision(n)]),
      verdict: verdicts(), recolumn: () => narrative([choseHow(n)]) }), { speedProfile: 'm33-lean' });
    assert.equal(report.decisions[0].column, 'asked-chose');
    const runs = seen.filter((request) => request.challenge && /^challenge:w1:(exists|recolumn)/.test(request.label));
    // The fix review: the existence check runs on the decide tier's passes, on the whole window (fix-review-existence).
    assert.deepEqual(runs.map((request) => request.label), ['challenge:w1:exists:b1:p1', 'challenge:w1:exists:b1:p2',
      'challenge:w1:exists:b1:p3', 'challenge:w1:recolumn:b1:p1']);
    assert.deepEqual(runs.map((request) => request.system.includes(SESSION_DOSSIER_NOTE)), [false, false, false, true],
      'only the new column\'s check is shown a dossier');
  });

test('W1 A: the re-ask request is deterministic and only replaces a session-only "Now answer"', () => {
  const request = { system: 'S', prompt: `window\n${NOW_ANSWER.join('\n')}`, schema: { type: 'object' },
    label: 'narrative:w1' };
  const row = { dimension: 'd', chosen: 'c', actions: ['a'], constrainedBy: { instruction: { eventId: 'h',
    role: 'instruction', quote: 'qqqq' }, settles: true, settledValueQuote: 'qqqq' } };
  const votes = [{ valid: true, verdict: 'refuted', explanation: 'no',
    receipts: [{ eventId: 'a', role: 'code', quote: 'x', repaired: true }] }];
  const one = recolumnRequest({ request, row, refutations: votes, label: 'narrative:w1:recolumn:0' });
  assert.deepEqual(one, recolumnRequest({ request, row, refutations: votes, label: 'narrative:w1:recolumn:0' }));
  assert.equal(one.prompt, ['window', '', RECOLUMN_HEADING, '', ...RECOLUMN_WORDS, '', RESTATUS_ROW,
    JSON.stringify(row), '', RESTATUS_CHECK,
    '{"explanation":"no","receipts":[{"eventId":"a","role":"code","quote":"x"}]}', '',
    ...RECOLUMN_NOW_ANSWER].join('\n'));
  assert.equal(recolumnRequest({ request: { ...request, prompt: 'no closing' }, row, refutations: votes, label: 'l' }),
    null);
});
