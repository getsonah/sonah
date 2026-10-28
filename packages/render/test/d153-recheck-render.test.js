// D153: the readers of a review run with the after-point re-check. An ask no later window settled shows "not
// checked after later work", with no accusing word, in Must know, its earlier quote folded in its evidence; an ask found
// done later is done; a claim or a statement corrected later says so beside its contradiction; the count line says how
// many left Must act, by mechanism. With the option off, every reader is as before. Synthetic session and judge only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reportModel, reportItems } from '../report-model.js';
import { renderReportMarkdown } from '../session-story.js';
import { renderSessionPage } from '../session-page.js';
import { countLines } from '../../cli/src/report-output.js';
import { REPORT_WHAT_WORDS, REPORT_PROMPT_WORDS, REPORT_COUNT_WORDS, REPORT_RECHECK_PARTS, REPORT_ITEM_WORDS,
  REPORT_DISCLOSURE_WORDS } from '../report-words.js';
import { askRowKind, askCodeNotes, ASK_CODE_WORDS } from '../../evidence/src/review.js';
import { withAskCodeLinks } from '../../evidence/src/ask-code-links.js';
import { codeDossier } from '../../evidence/src/code-context.js';
import { recheckRenderSession, recheckRenderReport } from './d153-recheck-render-fixture.js';

const snapshot = (name) => readFileSync(new URL(`./snapshots/${name}`, import.meta.url), 'utf8');
const itemsOf = (model) => reportItems(model);
const textOf = (parts) => (parts ?? []).map((p) => p.text).join('');
/** The words that accuse the agent of an ask it did not do, or did only in part, on any reader. */
const accusing = (n) => [REPORT_WHAT_WORDS.ask_not_done(n), REPORT_WHAT_WORDS.ask_partly_done(n),
  REPORT_PROMPT_WORDS.status.notDone, REPORT_PROMPT_WORDS.status.partly];

test('D153: the report and the page of a review run with the re-check, byte for byte (snapshots)', async () => {
  const report = await recheckRenderReport();
  assert.equal(renderReportMarkdown(recheckRenderSession(), report, {}), snapshot('d153-recheck-report.md'));
  assert.equal(renderSessionPage(recheckRenderSession(), report, {}), snapshot('d153-recheck-page.html'));
});

test('D153: an ask no later window settled — no accusing word, Must know, its earlier quote folded', async () => {
  const report = await recheckRenderReport();
  const row = report.requirements.find((r) => r.instruction?.eventId === 'I2');
  assert.equal(row.status, 'not-done', 'the record keeps the earlier status');
  assert.deepEqual(row.recheck, { outcome: 'not_checked_after_later_work' });
  const model = reportModel(recheckRenderSession(), report, {});
  const ask = model.prompt.asks.find((a) => a.n === 2);
  assert.equal(ask.state, 'notCheckedLater');
  assert.equal(ask.status, REPORT_PROMPT_WORDS.status.notCheckedLater);
  const item = itemsOf(model).find((x) => x.kind === 'ask_not_checked_after_later_work');
  assert.equal(item.tier.final, 'must_know');
  assert.equal(item.type, 'verify');
  assert.equal(textOf(item.what.parts), REPORT_WHAT_WORDS.ask_not_checked_after_later_work(2));
  assert.deepEqual(item.evidence.filter((e) => e.label === REPORT_ITEM_WORDS.beforeLaterWork)
    .map((e) => textOf(e.parts)), ['The changelog is not updated.'], 'the earlier shortfall, folded');
  assert.equal(item.agentPrompt, null);
  assert.equal(model.tiers.must_act.length, 0);
  // Nothing accusing reaches any reader for it: the page, the report and the terminal's lines.
  const page = renderSessionPage(recheckRenderSession(), report, {});
  const md = renderReportMarkdown(recheckRenderSession(), report, {});
  for (const words of accusing(2)) {
    assert.ok(!page.includes(words), `page: ${words}`);
    assert.ok(!md.includes(words), `report: ${words}`);
  }
  for (const line of countLines(model)) for (const words of accusing(2)) assert.ok(!line.includes(words), line);
  // The attention counts read it as one of the items that later work followed, never among the asks marked not done.
  assert.equal(askRowKind(row, report), 'laterWork');
});

test('D153: a moved row shows its new status; the count line says what left Must act, by mechanism', async () => {
  const report = await recheckRenderReport();
  const model = reportModel(recheckRenderSession(), report, {});
  assert.equal(model.prompt.asks.find((a) => a.n === 1).state, 'done', 'found done later');
  const claim = itemsOf(model).find((x) => x.kind === 'claim_corrected');
  assert.ok(textOf(claim.what.parts).endsWith(REPORT_DISCLOSURE_WORDS.claim.corrected_later));
  assert.deepEqual(claim.evidence.filter((e) => e.label === REPORT_ITEM_WORDS.laterResult).map((e) => textOf(e.parts)),
    ['ok 1 - empty name gives the guest greeting']);
  const written = itemsOf(model).find((x) => x.kind === 'written_corrected');
  assert.equal(written.tier.final, 'good_to_know');
  assert.ok(textOf(written.what.parts).endsWith(REPORT_DISCLOSURE_WORDS.written.corrected_later));
  assert.deepEqual(written.evidence.filter((e) => e.label === REPORT_ITEM_WORDS.laterWrite).map((e) => textOf(e.parts)),
    ['Empty names are refused with an error.']);
  // Ask 1 (partly done), the claim and ask 2 (not done) were Must act; the statement was Must know by default.
  const line = REPORT_COUNT_WORDS.recheck(3, [REPORT_RECHECK_PARTS.done(1), REPORT_RECHECK_PARTS.corrected(1),
    REPORT_RECHECK_PARTS.mustKnow(1)].join(', '));
  assert.equal(model.countLine.recheck, line);
  assert.ok(countLines(model).includes(line), 'the terminal says it too');
  assert.ok(renderSessionPage(recheckRenderSession(), report, {}).includes(`<p class="count-recheck">${line}</p>`));
  // A row that leads no item of its own (here one the readers do not read as an ask of your prompt) was in no tier
  // before either: it is not counted.
  const unsettled = report.requirements.find((r) => r.instruction?.eventId === 'I2');
  const unread = { ...report, requirements: [...report.requirements, { ...unsettled,
    instruction: { ...unsettled.instruction, eventId: 'C2' } }] };
  assert.equal(reportModel(recheckRenderSession(), unread, {}).countLine.recheck, line);
});

test('D153: with the option off, every reader is the review\'s as before — no line, no new kind', async () => {
  const report = await recheckRenderReport(false);
  assert.equal(Object.hasOwn(report, 'recheck'), false);
  const model = reportModel(recheckRenderSession(), report, {});
  assert.equal(Object.hasOwn(model.countLine, 'recheck'), false);
  const kinds = itemsOf(model).map((x) => x.kind);
  assert.ok(kinds.includes('ask_not_done') && kinds.includes('ask_partly_done') && kinds.includes('claim_contradicted'));
  assert.ok(!kinds.includes('ask_not_checked_after_later_work') && !kinds.includes('written_corrected'));
  assert.ok(!model.prompt.asks.some((a) => a.state === 'notCheckedLater'));
});

/** The report with a code review's finding of `kind` whose `leadsFrom` names the ask of instruction `ask`, its check
 *  holding, the ask's links joined as the CLI joins them; and (`level`) the code review's level for a row. */
const withCode = (report, { ask = 'I2', kind = 'bug', triage = [] } = {}) => {
  const at = report.requirements.findIndex((r) => r.instruction?.eventId === ask);
  const finding = { id: 'f'.repeat(16), origin: 'code-review', status: 'DECIDE', scope: 'current-code',
    lens: 'behaviour', foundByLenses: ['behaviour'], kind, title: 'Empty names still throw', claims: [], input: '',
    trace: [{ step: 'x', source: 'file' }], anchor: { path: 'greet.js', side: 'new', startLine: 1, endLine: 1 },
    leadsFrom: [{ key: 'S1', kind: 'ask', source: 'requirements', index: at, id: null }], receipts: [],
    check: { verdict: 'holds', explanation: 'x', receipts: [] } };
  return withAskCodeLinks({ ...report, codePass: { ran: true, findings: [finding], ...(triage.length ? { triage } : {}) } },
    recheckRenderSession());
};
const mustAct = (report) => reportModel(recheckRenderSession(), report, {}).tiers.must_act.length;

test('D153: an ask no later window settled that a code finding concerns — no reader says the session review marked it', async () => {
  for (const kind of ['bug', 'ask_not_met']) {
    const report = withCode(await recheckRenderReport(), { kind });
    const row = report.requirements.find((r) => r.instruction?.eventId === 'I2');
    assert.ok(Array.isArray(row.codeLinks) && row.codeLinks.length, kind);
    const notes = askCodeNotes(report, row);
    assert.ok(notes.length && notes.every((n) => n.words.startsWith(ASK_CODE_WORDS.notCheckedLater)), kind);
    const page = renderSessionPage(recheckRenderSession(), report, {});
    const md = renderReportMarkdown(recheckRenderSession(), report, {});
    const model = reportModel(recheckRenderSession(), report, {});
    for (const words of [...accusing(2), ASK_CODE_WORDS.status['not-done'], ASK_CODE_WORDS.status['partly-done']]) {
      assert.ok(!page.includes(words), `${kind} page: ${words}`);
      assert.ok(!md.includes(words), `${kind} report: ${words}`);
      for (const line of countLines(model)) assert.ok(!line.includes(words), line);
    }
    assert.ok(page.includes(ASK_CODE_WORDS.notCheckedLater) && md.includes(ASK_CODE_WORDS.notCheckedLater), kind);
    // The code review is sent it as the session review left it: not checked, no move, no earlier shortfall.
    const sent = codeDossier({ report, session: recheckRenderSession() }).find((x) => x.source === 'requirements'
      && x.index === report.requirements.indexOf(row));
    assert.deepEqual([sent.move, sent.shown.status, Object.hasOwn(sent.shown, 'missing'), sent.itemKind],
      [null, 'not-checked', false, 'ask_not_checked_after_later_work'], kind);
  }
});

test('D153: the count line equals what left Must act on the page, a code finding folding a moved ask included', async () => {
  for (const options of [{}, { ask: 'I1', kind: 'ask_not_met' }, { ask: 'I2', kind: 'ask_not_met' },
    { triage: [{ ref: { source: 'writtenClaims', index: 0 }, level: 'high' }] }]) {
    const on = await recheckRenderReport(), off = await recheckRenderReport(false);
    const [withOn, withOff] = Object.keys(options).length ? [withCode(on, options), withCode(off, options)] : [on, off];
    const left = mustAct(withOff) - mustAct(withOn);
    const line = reportModel(recheckRenderSession(), withOn, {}).countLine.recheck ?? '';
    const said = Number(/^After later work, (\d+) items? left Must act/.exec(line)?.[1] ?? 0);
    assert.equal(said, left, `${JSON.stringify(options)}: ${line}`);
  }
  // A statement the code review raised to Must act and a later write replaced is counted with the corrected claim.
  const raised = withCode(await recheckRenderReport(), { triage: [{ ref: { source: 'writtenClaims', index: 0 },
    level: 'high' }] });
  assert.equal(reportModel(recheckRenderSession(), raised, {}).countLine.recheck, REPORT_COUNT_WORDS.recheck(4,
    [REPORT_RECHECK_PARTS.done(1), REPORT_RECHECK_PARTS.corrected(2), REPORT_RECHECK_PARTS.mustKnow(1)].join(', ')));
  // Ask 1, folded into the code finding that says it is not met, never led an item: it is not counted as done.
  const folded = withCode(await recheckRenderReport(), { ask: 'I1', kind: 'ask_not_met' });
  assert.ok(!reportModel(recheckRenderSession(), folded, {}).countLine.recheck.includes(REPORT_RECHECK_PARTS.done(1)));
});
