// An ask's status never contradicts Sonah's own findings (D87, amended): what the code step tied to an ask is joined
// beside the ask's status as `codeLinks` (ask-code-links.js), read from structure only — the keys a finding follows
// from, where a trace step's quote of the person's words sits in the ask's own instruction, the rows a question or a
// withheld finding names, the row's code check — and never in the status: every other field of every row is left as
// it was. Synthetic session and report: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { askCodeLinks, withAskCodeLinks, locateQuote, overlapping } from '../src/ask-code-links.js';
import { ASK_CODE_LINKS, ASK_CODE_ATTENTION_LINKS, CODE_CHECK_OUTCOMES } from '../src/ledger.js';
import { buildCodeSession } from '../../cli/test/code-pass-fixture.js';

const ONE = 'make parse return [] for empty input';
const TWO = 'keep the README as it is';
const ASK = `SYNTHETIC_ASK_ONE: ${ONE}. SYNTHETIC_ASK_TWO: ${TWO}.`;
const LATER = 'SYNTHETIC_ASK_THREE: say parse twice, parse and parse.';
const session = () => buildCodeSession('sess-ask-links', { ask: ASK, later: LATER, said: 'SYNTHETIC done.' }, [
  { id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
  { id: 'C1', kind: 'commentary', blob: 'said', turn: 'T1' },
  { id: 'I2', kind: 'instruction', blob: 'later', turn: 'T2' },
]);
const R = (eventId, role, quote) => ({ eventId, role, quote });
const id = (c) => `sha256:${c.repeat(64)}`;
const ref = (index, source = 'requirements') => ({ key: `S${index + 1}`, kind: source === 'requirements' ? 'ask' : 'claim',
  source, index, id: null });
const step = (eventId, quote, role = 'instruction') => ({ step: 'Asked.', source: 'session', eventId, role, quote });
const finding = (c, over = {}) => ({ id: id(c), origin: 'code-review', kind: 'bug', lens: 'behaviour', title: `SYNTHETIC ${c}`,
  trace: [], anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2 }, leadsFrom: [], ...over });
const check = (outcome, over = {}) => ({ outcome, receipts: [], reason: null, ...over });

/** Three asks (two of one message, one of a later one), a claim, and a code step that ties to them in every way. */
function report({ findings = [], withheld = undefined, questions = [], held = undefined, checks = [] } = {}) {
  const rows = [
    { text: 'Return [] for empty input.', instruction: R('I1', 'instruction', ONE), status: 'done',
      deliverable: R('C1', 'commentary', 'SYNTHETIC done.'), shortfall: null, restsOn: [], reason: null, facts: [] },
    { text: 'Keep the README.', instruction: R('I1', 'instruction', TWO), status: 'not-checked', deliverable: null,
      shortfall: null, restsOn: [], reason: 'challenge_unsettled', facts: ['no_deliverable_by_end'] },
    { text: 'Say parse.', instruction: R('I2', 'instruction', 'say parse twice'), status: 'partly-done', deliverable: null,
      shortfall: R('C1', 'commentary', 'SYNTHETIC done.'), restsOn: [], reason: null, facts: [] },
  ].map((row, i) => (checks[i] ? { ...row, codeCheck: checks[i] } : row));
  return { reviewScope: 'session-only', coverage: 'complete', findings: [], promises: [{ text: 'SYNTHETIC claim', status: 'open' }],
    decisions: [], requirements: rows,
    codePass: { ran: true, coverage: 'complete', findings, questions, rejected: [],
      ...(withheld ? { withheld } : {}), ...(held ? { held } : {}) } };
}

test('the closed list of links, and the ones that make an ask an attention row', () => {
  // The cleanup: no `shown_in_code` — the code step marks no row shown in the code.
  // D110: a finding Sonah could not confirm links an ask as a line beside it, never as an attention link.
  assert.deepEqual(ASK_CODE_LINKS, ['leads_from', 'trace_quotes_ask', 'contradicted_by_code', 'withheld_finding',
    'question_concerns', 'unconfirmed_finding']);
  assert.deepEqual(ASK_CODE_ATTENTION_LINKS, ['leads_from', 'trace_quotes_ask', 'contradicted_by_code']);
  assert.ok(Object.isFrozen(ASK_CODE_LINKS) && Object.isFrozen(ASK_CODE_ATTENTION_LINKS));
});

test('leads_from: a published finding whose leadsFrom names the ask row; a finding leading only from a claim links nothing', () => {
  const r = report({ findings: [finding('a', { leadsFrom: [ref(5, 'promises'), ref(1)] }),
    finding('b', { leadsFrom: [ref(0, 'promises')] })] });
  assert.deepEqual(askCodeLinks(r, session()), [[], [{ link: 'leads_from', finding: id('a') }], []]);
  // A finding with no id is not one the readers can point at: it links nothing. A ref outside the rows names nothing.
  const noId = report({ findings: [{ ...finding('a', { leadsFrom: [ref(0)] }), id: undefined },
    finding('c', { leadsFrom: [ref(7)] })] });
  assert.deepEqual(askCodeLinks(noId, session()), [[], [], []]);
});

test('trace_quotes_ask: a trace step quoting the ask\'s own words, at a place overlapping its quote by half the shorter', () => {
  const links = (quote, over = {}) => askCodeLinks(report({ findings: [finding('a', { trace: [step('I1', quote), {
    step: 'A line.', source: 'file', path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: 'x' }], ...over })] }),
  session());
  // Inside the first ask's words: that ask only.
  assert.deepEqual(links('return [] for empty input'), [[{ link: 'trace_quotes_ask', finding: id('a') }], [], []]);
  // A quote of a different sentence of the same message links the other ask, never this one.
  assert.deepEqual(links('the README as it is'), [[], [{ link: 'trace_quotes_ask', finding: id('a') }], []]);
  // Across both sentences: it overlaps the second by more than half the shorter and the first by less.
  assert.deepEqual(links('empty input. SYNTHETIC_ASK_TWO: keep the README'), [[], [{ link: 'trace_quotes_ask',
    finding: id('a') }], []]);
  // A quote the message does not hold, one at more than one place of its message, one of another event, one labelled
  // as something other than the person's instruction: none is placed, so none links.
  assert.deepEqual(links('SYNTHETIC never said'), [[], [], []]);
  assert.deepEqual(askCodeLinks(report({ findings: [finding('a', { trace: [step('I2', 'parse')] })] }), session()),
    [[], [], []], 'a quote found at two places of its message is not placed');
  assert.deepEqual(links('SYNTHETIC done.', { trace: [step('C1', 'SYNTHETIC done.')] }), [[], [], []]);
  assert.deepEqual(links(ONE, { trace: [step('I1', ONE, 'commentary')] }), [[], [], []]);
  assert.deepEqual(links(ONE, { trace: [{ ...step('I1', ONE), source: 'file' }] }), [[], [], []]);
  // With no session to ground the quotes in, no trace is placed; a leadsFrom link needs none.
  assert.deepEqual(askCodeLinks(report({ findings: [finding('a', { trace: [step('I1', ONE)], leadsFrom: [ref(2)] })] })),
    [[], [], [{ link: 'leads_from', finding: id('a') }]]);
  // The overlap rule is the one "Cited in" reads (`locateQuote`, `overlapping`), now in the evidence package.
  const spans = [ASK];
  const at = (quote) => locateQuote({ quote }, spans);
  assert.equal(overlapping(at(ONE), at('return [] for empty input')), true);
  assert.equal(overlapping(at(ONE), at(TWO)), false);
  assert.equal(at('SYNTHETIC_ASK_'), null, 'two places: not located');
});

test('a contradicting code check, a withheld finding and a question each link the row they name; an earlier report\'s held statements and "shown in code" checks link nothing', () => {
  const [CONTRADICTED, NOT_CHECKED] = CODE_CHECK_OUTCOMES;
  const SHOWN = 'shown-in-code';
  const r = report({
    findings: [finding('a', { kind: 'claim_false', leadsFrom: [ref(0, 'promises')] })],
    // The code step's report: a withheld finding keeps the refs it led from; one that is not a finding names nothing.
    withheld: [{ what: 'finding', reason: 'verify_refuted', text: 'SYNTHETIC withheld', leadsFrom: [ref(0)] },
      { what: 'question', reason: 'false_premise', text: 'SYNTHETIC q', leadsFrom: [ref(0)] }],
    questions: [{ question: 'SYNTHETIC question?', concerns: ref(1), quote: R('I1', 'instruction', TWO) },
      { question: 'SYNTHETIC other?', concerns: ref(0, 'promises') }],
    // An earlier report's statements found to hold, and its rows checked "shown in code": no link of any kind.
    held: [{ statement: 'SYNTHETIC holds', concerns: ref(2) }, { statement: 'SYNTHETIC holds too', concerns: null }],
    checks: [check(CONTRADICTED, { by: 'finding', finding: id('a') }), check(SHOWN), check(SHOWN, { by: 'held' })],
  });
  assert.deepEqual(askCodeLinks(r, session()), [
    [{ link: 'contradicted_by_code', finding: id('a') }, { link: 'withheld_finding', withheld: 0 }],
    [{ link: 'question_concerns', question: 0 }],
    [],
  ]);
  assert.deepEqual(withAskCodeLinks(report({ held: [{ statement: 'SYNTHETIC holds', concerns: ref(0) }],
    checks: [check(SHOWN, { by: 'held' })] }), session()).requirements.map((row) => row.codeLinks), [undefined, undefined,
    undefined]);
  // A check that did not settle links nothing; a check naming no published finding links with none.
  const unsettled = report({ checks: [check(NOT_CHECKED), check(CONTRADICTED, { finding: id('z') })] });
  assert.deepEqual(askCodeLinks(unsettled, session()), [[], [{ link: 'contradicted_by_code' }], []]);
});

test('an earlier code step\'s report (findings only, its withheld entries with no refs): only what it holds links', () => {
  const r = report({ findings: [finding('a', { leadsFrom: [ref(0)], trace: [step('I1', ONE)] })],
    questions: [{ question: 'SYNTHETIC?', lens: 'ask', concerns: ref(0), quote: R('I1', 'instruction', ONE) }] });
  r.codePass.rejected = [{ reason: 'challenge_unsettled', lens: 'behaviour' }];
  assert.deepEqual(askCodeLinks(r, session())[0], [{ link: 'leads_from', finding: id('a') },
    { link: 'trace_quotes_ask', finding: id('a') }, { link: 'question_concerns', question: 0 }]);
  for (const bare of [{}, { codePass: null }, { requirements: 'x' }, { requirements: [null, 5], codePass: { findings: 'x' } }])
    assert.deepEqual(askCodeLinks(bare, session()), Array.isArray(bare.requirements) ? [[], []] : []);
});

test('the join writes codeLinks on a copy of a linked row only: status, receipts, reason and facts stay the session review\'s', () => {
  const r = report({ findings: [finding('a', { leadsFrom: [ref(0)], trace: [step('I1', TWO)] })],
    checks: [undefined, undefined, check(CODE_CHECK_OUTCOMES[0])] });
  const before = structuredClone(r);
  const joined = withAskCodeLinks(r, session());
  assert.deepEqual(r, before, 'the report given is not changed');
  assert.notEqual(joined, r);
  // Every member but the rows is the report's own; every row keeps every field it had, status included, and a linked
  // row gains codeLinks alone.
  const { requirements, ...rest } = joined;
  const { requirements: rows, ...restBefore } = before;
  assert.deepEqual(rest, restBefore);
  assert.equal(requirements.length, rows.length);
  requirements.forEach((row, i) => {
    const { codeLinks, ...fields } = row;
    assert.deepEqual(fields, rows[i], `row ${i}: no field but codeLinks moved`);
    assert.equal(row.status, rows[i].status);
  });
  assert.deepEqual(requirements.map((row) => row.codeLinks), [[{ link: 'leads_from', finding: id('a') }],
    [{ link: 'trace_quotes_ask', finding: id('a') }], [{ link: 'contradicted_by_code' }]]);
  // A row nothing links is the same row; a stale codeLinks an earlier join wrote is dropped; a report with no rows is
  // given back as it is.
  const unlinked = report();
  const again = withAskCodeLinks({ ...unlinked, requirements: unlinked.requirements.map((row, i) => (i === 1
    ? { ...row, codeLinks: [{ link: 'leads_from', finding: id('q') }] } : row)) }, session());
  assert.equal(again.requirements[0], unlinked.requirements[0], 'an unlinked row is the same row');
  assert.deepEqual(again.requirements, unlinked.requirements);
  for (const bare of [null, { requirements: null }]) assert.equal(withAskCodeLinks(bare, session()), bare);
});

test('D113 amended: an item of the code step tagged outside the evaluated session links no ask, by any link, whatever else its record names', () => {
  // Records a reader may be handed, each naming the first ask every way it can: a published finding (its leadsFrom, a
  // trace step quoting the ask), a finding to verify (D110), a withheld finding and a question. Untagged, each links it.
  const premiseRule = { premises: { confirm: 'holds-and-every-premise-repository-or-language' } };
  const records = (tag) => {
    const r = report({ findings: [finding('a', { leadsFrom: [ref(0)], trace: [step('I1', 'return [] for empty input')],
      check: { verdict: 'holds', premises: [{ premise: 'SYNTHETIC', source: 'language', receipts: [] }] }, ...tag })],
    withheld: [{ what: 'finding', reason: 'verify_refuted', text: 'SYNTHETIC withheld', leadsFrom: [ref(0)], ...tag }],
    questions: [{ id: 'Q1', question: 'SYNTHETIC question?', concerns: ref(0), ...tag }] });
    return { ...r, codePass: { ...r.codePass, version: premiseRule, unconfirmed: [finding('b', { leadsFrom: [ref(0)],
      check: { verdict: 'holds', premises: [{ premise: 'SYNTHETIC', source: 'outside', receipts: [] }] }, ...tag })] } };
  };
  assert.deepEqual(askCodeLinks(records({}), session())[0].map((l) => l.link), ['leads_from', 'trace_quotes_ask',
    'withheld_finding', 'question_concerns', 'unconfirmed_finding']);
  assert.deepEqual(askCodeLinks(records({ outsideSession: true }), session()), [[], [], []]);
});
