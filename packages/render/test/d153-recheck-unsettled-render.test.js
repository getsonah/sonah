// D153 (the owner's call of 2026-10-26, and its fix round): a reaffirmed row is shown no stronger than one not checked
// after later work, and a claim or a statement no later window settled is shown so too, in Must know, its earlier quote
// folded, with no accusing word; and the page's words are never false. A row a later window checked (a reaffirmed ask, a
// claim a later window's RESULT showed failing again) is one that later work followed, its later quote folded beside the
// earlier one; a row no later window settled is one Sonah did not check after later work. The record keeps each
// outcome; a row with no later work keeps its accusation; the count line says what left Must act, by mechanism; the
// pull request comment counts these items apart and points to where they are; the code review is sent them as not
// checked. Synthetic sessions and judges only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems } from '../report-model.js';
import { renderReportMarkdown } from '../session-story.js';
import { renderSessionPage } from '../session-page.js';
import { countLines } from '../../cli/src/report-output.js';
import { REPORT_WHAT_WORDS, REPORT_PROMPT_WORDS, REPORT_PROMPT_PARTS, REPORT_COUNT_WORDS, REPORT_RECHECK_PARTS,
  REPORT_ITEM_WORDS, REPORT_KIND_LABELS, REPORT_KIND_WORDS, REPORT_DID_WORDS, REPORT_CONTRADICTION_SOURCES,
  REPORT_TIER_WHY, REPORT_TIER_WORDS } from '../report-words.js';
import { askRowKind, askCodeNotes, writtenRowKind, attentionSummary, ASK_CODE_WORDS, ATTENTION_WORDS }
  from '../../evidence/src/review.js';
import { publicCommentText, escapePublicText, PUBLICATION_WORDS } from '../../github/publication.js';
import { withAskCodeLinks } from '../../evidence/src/ask-code-links.js';
import { codeDossier, renderDossier } from '../../evidence/src/code-context.js';
import { itemKindOf } from '../../evidence/src/triage.js';
import { lintText } from './style-lint.js';
import { recheckRenderSession, recheckUnsettledReport, recontradictedReport, recontradictedSession }
  from './d153-recheck-render-fixture.js';

const itemsOf = (model) => reportItems(model);
const textOf = (parts) => (parts ?? []).map((p) => p.text).join('');
const evidenceOf = (item, label) => item.evidence.filter((e) => e.label === label).map((e) => textOf(e.parts));
const ownText = (item) => [textOf(item.what.parts), textOf(item.label), item.why ?? '', ...item.evidence.map((e) =>
  `${e.label ?? ''} ${textOf(e.parts)}`)].join(' ');
const ask = (report, id) => report.requirements.find((r) => r.instruction?.eventId === id);
const SHOWN_KINDS = ['ask_not_checked_after_later_work', 'claim_not_checked_after_later_work',
  'written_not_checked_after_later_work'];
/** Every fixed word that accuses the agent of an ask it did not do or did only in part, or of a claim or a statement
 *  that something contradicts, on any reader; and the bare words, read case-blind. */
const ACCUSING = [REPORT_WHAT_WORDS.ask_not_done(1), REPORT_WHAT_WORDS.ask_not_done(2), REPORT_WHAT_WORDS.ask_partly_done(1),
  REPORT_WHAT_WORDS.ask_partly_done(2), ...Object.values(REPORT_CONTRADICTION_SOURCES).map(REPORT_WHAT_WORDS.contradicts),
  REPORT_KIND_LABELS.claim, REPORT_KIND_LABELS.written('README.md'), REPORT_PROMPT_WORDS.status.notDone,
  REPORT_PROMPT_WORDS.status.partly, REPORT_PROMPT_PARTS.notDone(1), REPORT_PROMPT_PARTS.partly(1),
  REPORT_KIND_WORDS.ask_not_done, REPORT_KIND_WORDS.ask_partly_done, REPORT_KIND_WORDS.claim_contradicted,
  REPORT_KIND_WORDS.written_contradicted, ASK_CODE_WORDS.status['not-done'], ASK_CODE_WORDS.status['partly-done'],
  ATTENTION_WORDS.asksNotDone(1), ATTENTION_WORDS.asksNotDone(2), ATTENTION_WORDS.contradicted(1),
  ATTENTION_WORDS.writtenContradicted(1)];
const BARE = [/contradict/i, /\bfalse\b/i, /not done/i, /partly done/i, /only part/i];
const accusations = (text) => [...ACCUSING.filter((words) => text.includes(words)),
  ...BARE.filter((re) => re.test(text)).map(String)];
/** The words that say Sonah did not or could not check a row: false for a row a later window checked. */
const NOT_CHECKED = /did not check|could not check|not checked/i;

/** Every reader's text of `report`: the page, the report .md, the terminal's lines, the pull request comment and the
 *  attention summary. */
function readers(report, session = recheckRenderSession()) {
  return { page: renderSessionPage(session, report, {}), md: renderReportMarkdown(session, report, {}),
    terminal: countLines(reportModel(session, report, {})).join('\n'), comment: publicCommentText(report).summary,
    attention: [...attentionSummary(report).lines, attentionSummary(report).folded ?? ''].join('\n') };
}

/** The report with a code review's finding of `kind` whose `leadsFrom` names the ask of instruction `id`, its check
 *  holding, the ask's links joined as the CLI joins them; the code review's levels (`triage`) and questions. */
const withCode = (report, { id = 'I1', kind = 'bug', triage = [], questions = [] } = {}) => {
  const at = report.requirements.findIndex((r) => r.instruction?.eventId === id);
  const finding = { id: 'f'.repeat(16), origin: 'code-review', status: 'DECIDE', scope: 'current-code',
    lens: 'behaviour', foundByLenses: ['behaviour'], kind, title: 'Empty names still throw', claims: [], input: '',
    trace: [{ step: 'x', source: 'file' }], anchor: { path: 'greet.js', side: 'new', startLine: 1, endLine: 1 },
    leadsFrom: [{ key: 'S1', kind: 'ask', source: 'requirements', index: at, id: null }], receipts: [],
    check: { verdict: 'holds', explanation: 'x', receipts: [] } };
  return withAskCodeLinks({ ...report, codePass: { ran: true, findings: [finding], ...(questions.length ? { questions }
    : {}), ...(triage.length ? { triage } : {}) } }, recheckRenderSession());
};
/** The code review proposing `level` for every row of the session review that can be an item. */
const everyRow = (report, level) => ['requirements', 'findings', 'writtenClaims'].flatMap((source) => report[source]
  .map((row, index) => ({ ref: { source, index }, level })).filter((_, index) => itemKindOf(source,
    report[source][index]) !== null));

test('D153: a reaffirmed ask — later work followed it, never "did not check"; its later quote folded; the record keeps its outcome', async () => {
  const report = await recheckUnsettledReport();
  const row = ask(report, 'I1');
  assert.equal(row.status, 'partly-done', 'the record keeps its status');
  assert.equal(row.recheck.outcome, 'reaffirmed');
  const model = reportModel(recheckRenderSession(), report, {});
  const shown = model.prompt.asks.find((a) => a.n === 1);
  assert.equal(shown.state, 'laterWork');
  assert.equal(shown.status, REPORT_PROMPT_WORDS.status.laterWork);
  assert.ok(model.prompt.parts.includes(REPORT_PROMPT_PARTS.laterWork(1)));
  const item = itemsOf(model).find((x) => x.kind === 'ask_not_checked_after_later_work' && textOf(x.label) === 'ask 1');
  assert.deepEqual([item.tier.final, item.type, item.agentPrompt], ['must_know', 'verify', null]);
  assert.equal(textOf(item.what.parts), REPORT_WHAT_WORDS.askLaterWork(1));
  assert.deepEqual(evidenceOf(item, REPORT_ITEM_WORDS.beforeLaterWork), [row.recheck.earlier.shortfall.quote]);
  assert.deepEqual(evidenceOf(item, REPORT_ITEM_WORDS.fromLaterWork), [row.shortfall.quote]);
  assert.ok(!NOT_CHECKED.test(ownText(item)), ownText(item));
  assert.equal(item.why, REPORT_TIER_WHY.byDefault(REPORT_KIND_WORDS[item.kind], REPORT_TIER_WORDS.must_know));
  assert.ok(!NOT_CHECKED.test(item.why), item.why);
  // Its code-review note says the same; the attention counts read it as an item that later work followed.
  const noted = withCode(report);
  const notes = askCodeNotes(noted, ask(noted, 'I1'));
  assert.ok(notes.length && notes.every((n) => n.words.startsWith(ASK_CODE_WORDS.laterWork)));
  assert.equal(askRowKind(row, report), 'laterWork');
});

test('D153: a claim a later window\'s RESULT shows failing again — that RESULT kept on the row and shown, no accusing word', async () => {
  for (const corrected of [true, false]) {
    const report = await recontradictedReport({ corrected });
    const [claim] = report.findings;
    assert.equal(claim.status, 'DECIDE');
    assert.equal(claim.recheck.outcome, 'not_checked_after_later_work', 'never challenged: no stronger outcome');
    assert.deepEqual([claim.recheck.window, claim.recheck.later.observation.eventId], [3, 'A3-r']);
    assert.equal(report.recheck.voided, corrected ? 1 : 0);
    const model = reportModel(recontradictedSession(), report, {});
    const item = itemsOf(model).find((x) => x.kind === 'claim_not_checked_after_later_work');
    assert.deepEqual([item.tier.final, item.agentPrompt], ['must_know', null]);
    assert.equal(textOf(item.what.parts), REPORT_WHAT_WORDS.claimLaterWork);
    assert.deepEqual(evidenceOf(item, REPORT_ITEM_WORDS.beforeLaterWork), [claim.receipts.find((r) => r.role
      === 'observation').quote]);
    assert.deepEqual(evidenceOf(item, REPORT_ITEM_WORDS.fromLaterWork), [claim.recheck.later.observation.quote]);
    assert.ok(!NOT_CHECKED.test(ownText(item)), ownText(item));
    for (const [reader, text] of Object.entries(readers(report, recontradictedSession())))
      assert.deepEqual(accusations(text), [], `${corrected} ${reader}`);
    // A claim row of the agent's that the claim's finding cites is listed with what the item says.
    const said = claim.receipts.find((r) => r.role === 'commentary');
    const listed = reportModel(recontradictedSession(), { ...report, promises: [{ id: 'p'.repeat(16),
      text: 'all tests pass', stated: said, status: 'open', receipts: [] }] }, {}).did.claims.shown;
    assert.deepEqual(listed.map((c) => [c.source, c.status]), [['promises', REPORT_DID_WORDS.claimStatus.laterWork]]);
    // With the option off, the same claim accuses as before.
    const off = await recontradictedReport({ corrected, on: false });
    assert.equal(itemsOf(reportModel(recontradictedSession(), off, {}))[0].kind, 'claim_contradicted');
  }
});

test('D153: an ask, a claim and a statement no later window settled — not checked after later work, Must know, folded, no label', async () => {
  const report = await recheckUnsettledReport();
  const [claim] = report.findings;
  const [written] = report.writtenClaims;
  assert.deepEqual([claim.status, claim.recheck], ['DECIDE', { outcome: 'not_checked_after_later_work' }]);
  assert.deepEqual([written.label, written.recheck], ['contradicted', { outcome: 'not_checked_after_later_work' }]);
  const model = reportModel(recheckRenderSession(), report, {});
  const askItem = itemsOf(model).find((x) => x.kind === 'ask_not_checked_after_later_work' && textOf(x.label) === 'ask 2');
  const claimItem = itemsOf(model).find((x) => x.kind === 'claim_not_checked_after_later_work');
  const writtenItem = itemsOf(model).find((x) => x.kind === 'written_not_checked_after_later_work');
  for (const item of [askItem, claimItem, writtenItem])
    assert.deepEqual([item.tier.final, item.type, item.agentPrompt], ['must_know', 'verify', null]);
  assert.equal(textOf(askItem.what.parts), REPORT_WHAT_WORDS.ask_not_checked_after_later_work(2));
  assert.equal(model.prompt.asks.find((a) => a.n === 2).status, REPORT_PROMPT_WORDS.status.notCheckedLater);
  assert.equal(textOf(claimItem.what.parts), REPORT_WHAT_WORDS.claim_not_checked_after_later_work);
  assert.equal(textOf(writtenItem.what.parts), REPORT_WHAT_WORDS.written_not_checked_after_later_work('/srv/r/README.md'));
  assert.equal(claimItem.quote.text, claim.receipts.find((r) => r.role === 'commentary').quote, 'the claim, open');
  assert.equal(writtenItem.quote.text, written.stated.quote, 'the statement, open');
  const against = claim.receipts.find((r) => r.role === 'observation').quote;
  assert.deepEqual(evidenceOf(claimItem, REPORT_ITEM_WORDS.beforeLaterWork), [against], 'what contradicted it, folded');
  assert.deepEqual(evidenceOf(writtenItem, REPORT_ITEM_WORDS.beforeLaterWork), [against]);
  for (const item of [askItem, claimItem, writtenItem]) {
    assert.deepEqual(evidenceOf(item, REPORT_ITEM_WORDS.fromLaterWork), [], 'no later quote: no later window settled it');
    assert.deepEqual(accusations(textOf(item.label)), []);
  }
  const listed = model.did.claims.shown.find((c) => c.source === 'writtenClaims');
  assert.equal(listed.status, REPORT_DID_WORDS.claimStatus.notCheckedLater);
  assert.equal(writtenRowKind(written), 'laterWork');
});

test('D153: no accusing word of Sonah\'s reaches any reader, whatever level the code review proposes; it is sent the rows as not checked', async () => {
  const report = await recheckUnsettledReport();
  const cases = { plain: report, codeFinding: withCode(report), askNotMet: withCode(report, { kind: 'ask_not_met' }),
    high: withCode(report, { triage: everyRow(report, 'high') }), low: withCode(report, { triage: everyRow(report, 'low') }) };
  for (const [name, r] of Object.entries(cases)) {
    for (const [reader, text] of Object.entries(readers(r))) assert.deepEqual(accusations(text), [], `${name} ${reader}`);
    const model = reportModel(recheckRenderSession(), r, {});
    // Each of the four rows is its own item in Must know, whatever level the code review proposed for it (no code
    // question joins them here), with no prompt.
    const shown = itemsOf(model).filter((x) => SHOWN_KINDS.includes(x.kind));
    if (name !== 'askNotMet') assert.equal(shown.length, 4, name);
    for (const item of shown) assert.deepEqual([item.tier.final, item.agentPrompt], ['must_know', null], name);
    assert.equal(model.tiers.must_act.filter((x) => !x.kind.startsWith('code_')).length, 0, name);
  }
  // The code review is sent every such row as not checked: no move, no shortfall, no contradiction, the readers' kind.
  const sent = codeDossier({ report, session: recheckRenderSession() });
  const of = (source, index) => sent.find((x) => x.source === source && x.index === index);
  for (const id of ['I1', 'I2']) {
    const s = of('requirements', report.requirements.indexOf(ask(report, id)));
    assert.deepEqual([s.move, s.shown.status, Object.hasOwn(s.shown, 'missing'), s.itemKind],
      [null, 'not-checked', false, 'ask_not_checked_after_later_work'], id);
  }
  const claim = of('findings', 0), written = of('writtenClaims', 0);
  assert.deepEqual([claim.shown.status, Object.hasOwn(claim.shown, 'contradictedBy'), claim.itemKind],
    ['open', false, 'claim_not_checked_after_later_work']);
  assert.deepEqual([written.shown.status, written.itemKind], ['written, unverified', 'written_not_checked_after_later_work']);
  assert.ok(!/contradicted|ask_short/.test(renderDossier(sent)), 'no accusation sent');
  // With the option off, the dossier sends them as found short or contradicted, as before.
  const off = renderDossier(codeDossier({ report: await recheckUnsettledReport(false), session: recheckRenderSession() }));
  assert.ok(/"status":"contradicted"/.test(off) && /ask_short/.test(off));
});

test('D153: a code question proposed high and joined to such a claim or statement places its item in Must act (D112); still no accusing word', async () => {
  const report = await recheckUnsettledReport();
  for (const [source, quote] of [['findings', { eventId: 'C1', role: 'commentary', quote: 'All tests pass.' }],
    ['writtenClaims', { eventId: 'WR1', role: 'code', quote: 'Empty names get the guest greeting.' }]]) {
    const joined = withCode(report, { questions: [{ id: 'Q1', from: 'review', question: 'Does it hold?', quote,
      concerns: { source, index: 0 }, check: { verdict: 'sound' } }], triage: [{ ref: { question: 'Q1' }, level: 'high' }] });
    const model = reportModel(recheckRenderSession(), joined, {});
    const kind = source === 'findings' ? 'claim_not_checked_after_later_work' : 'written_not_checked_after_later_work';
    const item = model.tiers.must_act.find((x) => x.kind === kind);
    assert.ok(item, `${source}: the item that holds the question is in Must act`);
    assert.deepEqual([item.tier.default, item.tier.from, item.agentPrompt], ['must_know', 'member', null], source);
    assert.deepEqual(accusations(ownText(item)), [], source);
  }
});

test('D153: the pull request comment counts the items that later work followed apart, and points to where they are', async () => {
  const report = await recheckUnsettledReport();
  const { summary } = publicCommentText(report);
  // Pinned: the four rows on one line of what needs your attention; the failure Sonah could not check, folded.
  assert.equal(summary, [PUBLICATION_WORDS.title, '',
    'Sonah finished its review. It lists what you should check. It never says that the work is correct.', '',
    'No code was reviewed\\. Reason: this review ran without the code review\\.', '',
    `${PUBLICATION_WORDS.attention}\n- ${escapePublicText(ATTENTION_WORDS.laterWork(4))}`, '',
    escapePublicText(ATTENTION_WORDS.folded(1)), '', PUBLICATION_WORDS.advisory].join('\n'));
  assert.equal(ATTENTION_WORDS.laterWork(4), '4 items that later work followed: see Must know and Must act.');
  // With the option off, the same rows accuse there as before.
  assert.ok(publicCommentText(await recheckUnsettledReport(false)).summary.includes(
    escapePublicText(ATTENTION_WORDS.asksNotDone(2))));
});

test('D153: a row with no later work keeps its accusation; one the re-check moved is as before', async () => {
  const report = await recheckUnsettledReport();
  const none = { ...report, findings: report.findings.map((f) => ({ ...f, recheck: { outcome: 'no_later_work' } })),
    writtenClaims: report.writtenClaims.map((w) => ({ ...w, recheck: { outcome: 'no_later_work' } })),
    requirements: report.requirements.map((r) => (r.recheck ? { ...r, recheck: { outcome: 'no_later_work' } } : r)) };
  const model = reportModel(recheckRenderSession(), none, {});
  const kinds = itemsOf(model).map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['ask_not_done', 'ask_partly_done', 'claim_contradicted', 'written_contradicted']);
  const claim = itemsOf(model).find((x) => x.kind === 'claim_contradicted');
  assert.equal(claim.tier.final, 'must_act');
  assert.equal(textOf(claim.what.parts), REPORT_WHAT_WORDS.contradicts(REPORT_CONTRADICTION_SOURCES.result));
  assert.equal(attentionSummary(none).counts.contradicted, 1);
  // A row the re-check moved keeps its new kind: the moved ask, claim and statement of the other fixture render as
  // d153-recheck-render.test.js's snapshots hold.
  for (const [source, row] of [['findings', { kind: 'claim_contradicted', status: 'FYI', recheck: { outcome: 'moved' } }],
    ['writtenClaims', { label: 'contradicted', disclosureReason: 'corrected_later', recheck: { outcome: 'moved' } }],
    ['requirements', { status: 'done', recheck: { outcome: 'moved' } }]])
    assert.ok(!SHOWN_KINDS.includes(itemKindOf(source, row)), source);
});

test('D153: the count line — one part for every row now in Must know — equals what the page shows, within 20 words', async () => {
  const on = await recheckUnsettledReport(), off = await recheckUnsettledReport(false);
  const mustAct = (r) => reportModel(recheckRenderSession(), r, {}).tiers.must_act.length;
  const line = (r) => reportModel(recheckRenderSession(), r, {}).countLine.recheck ?? '';
  // Ask 1 (partly done), ask 2 (not done) and the claim were Must act; the statement was Must know by default.
  assert.equal(line(on), REPORT_COUNT_WORDS.recheck(3, REPORT_RECHECK_PARTS.mustKnow(3)));
  assert.ok(countLines(reportModel(recheckRenderSession(), on, {})).includes(line(on)), 'the terminal says it too');
  // The statement, raised to Must act by the code review, leaves it too.
  const raise = (r) => withCode(r, { triage: [{ ref: { source: 'writtenClaims', index: 0 }, level: 'high' }] });
  assert.equal(line(raise(on)), REPORT_COUNT_WORDS.recheck(4, REPORT_RECHECK_PARTS.mustKnow(4)));
  for (const [withOn, withOff] of [[on, off], [raise(on), raise(off)], [withCode(on), withCode(off)],
    [withCode(on, { kind: 'ask_not_met' }), withCode(off, { kind: 'ask_not_met' })]]) {
    const said = Number(/^After later work, (\d+) items? left Must act/.exec(line(withOn))?.[1] ?? 0);
    assert.equal(said, mustAct(withOff) - mustAct(withOn), line(withOn));
  }
  // Every part at once stays within the style's 20 words, and so does each kind's why sentence.
  const longest = REPORT_COUNT_WORDS.recheck(99, [REPORT_RECHECK_PARTS.done(33), REPORT_RECHECK_PARTS.corrected(33),
    REPORT_RECHECK_PARTS.mustKnow(33)].join(', '));
  assert.deepEqual(lintText(longest, 'notice').filter((v) => v.rule === 'L1-length'), []);
  for (const kind of [...SHOWN_KINDS, 'written_corrected']) for (const tier of Object.values(REPORT_TIER_WORDS))
    assert.deepEqual(lintText(REPORT_TIER_WHY.byDefault(REPORT_KIND_WORDS[kind], tier), 'description')
      .filter((v) => v.rule === 'L1-length'), [], kind);
});

test('D153: with the option off, the same review accuses as before', async () => {
  const off = await recheckUnsettledReport(false);
  const kinds = itemsOf(reportModel(recheckRenderSession(), off, {})).map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['ask_not_done', 'ask_partly_done', 'claim_contradicted', 'written_contradicted']);
  assert.equal(Object.hasOwn(off, 'recheck'), false);
});
