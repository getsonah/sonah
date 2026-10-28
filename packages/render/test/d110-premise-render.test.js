// D110 (bucket C, F4, the premise contract): what the readers show of the label code computes. A finding that code's
// label confirms is shown with each premise beside where its evidence is; a finding that holds and that the label does
// not confirm is an item to verify — never in a confirmed (Fix) item, never withheld — and it names each premise that
// Sonah could not check, in the check's own words, on a visible line; the page, the .md and the prompt table never say
// that a second or independent reviewer checked a finding. The label is computed again from each stored check, so a
// record whose premises no longer confirm a finding shows it as one to verify, wherever the writer put it.
//
// Synthetic reports (evidence/test/report-triage-fixture.js, (a) before the premise contract and (g) under it): no
// recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, itemVisibleText, reportItems } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import * as reportWords from '../report-words.js';
import { CODE_REPORT_WORDS, codeNoFindingLine } from '../../evidence/src/code-report.js';
import { ASK_CODE_WORDS, askRowKind, checklistRowCounts } from '../../evidence/src/review.js';
import { codeContradictedRows, codeRowCheck } from '../../evidence/src/code-pass.js';
import { premiseReport, triageReport, triageSession, OUTSIDE_PREMISE, UNCONFIRMED_ID, ROWS }
  from '../../evidence/test/report-triage-fixture.js';

const itemsOf = (model) => reportItems(model);
const textOf = (parts) => parts.map((p) => (p.quote ? `“${p.text}”${p.cut ? '…' : ''}` : p.text)).join('');
const modelOf = (make, options = {}) => { const session = triageSession(); return reportModel(session, make(session), options); };
const W = reportWords.REPORT_ITEM_WORDS;
/** Every string a word table holds, its functions rendered with a few arguments. */
function stringsOf(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') for (const args of [[1], [2], [null], ['x', 'y', 'z']]) {
    try { stringsOf(value(...args), out); } catch { /* a function that needs other arguments */ }
  } else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) stringsOf(v, out);
  return out;
}

test('D110: a finding to verify is a Verify item, Good to know by default, never Must act, naming the premise Sonah could not check byte for byte', () => {
  const model = modelOf(premiseReport);
  const items = itemsOf(model);
  const toVerify = items.filter((item) => item.kind === 'code_finding_unconfirmed');
  assert.equal(toVerify.length, 1);
  const [item] = toVerify;
  assert.deepEqual([item.type, item.tier.final, item.tier.default, item.rows[0].source],
    ['verify', 'good_to_know', 'good_to_know', 'codePass.unconfirmed']);
  assert.equal(textOf(item.what.parts), 'A call that hangs is never retried');
  assert.equal(item.rowId, UNCONFIRMED_ID);
  // Its visible line: each premise that Sonah could not check, in its check's words, byte for byte.
  assert.deepEqual(item.restsOutside.map((parts) => [textOf(parts), parts[0].by]), [[OUTSIDE_PREMISE, 'code-review']]);
  // Its evidence: its check found the same problem, Sonah could not check every premise; each premise beside where its
  // evidence is, and the receipt of the one in the repository as code.
  const evidence = item.evidence.map((e) => [e.label, textOf(e.parts)]);
  assert.ok(evidence.some(([label, text]) => label === W.check && text.startsWith(CODE_REPORT_WORDS.checkUnconfirmed)));
  assert.ok(evidence.some(([label, text]) => label === W.restsOn
    && text === `${OUTSIDE_PREMISE} ${CODE_REPORT_WORDS.premiseSources.outside}`));
  assert.ok(evidence.some(([label, text]) => label === W.restsOn
    && text.endsWith(CODE_REPORT_WORDS.premiseSources.repository)));
  assert.ok(evidence.some(([label, text]) => label === W.codeNow && text.includes('return await call({ timeoutMs });')));
  // It is never in a confirmed group: no Fix item holds its row, and no confirmed finding is it.
  assert.ok(items.filter((x) => x.type === 'fix').every((x) => !x.rows.some((r) => r.source === 'codePass.unconfirmed')));
  assert.deepEqual(model.placement.rows['codePass.unconfirmed:0'], { item: item.n });
});

test('D110: the page and the .md show the item to verify with its premise, and every confirmed finding with its premises', () => {
  const session = triageSession();
  const report = premiseReport(session);
  const html = renderSessionPage(session, report, {});
  const md = renderReportMarkdown(session, report, {});
  const model = reportModel(session, report, {});
  const item = itemsOf(model).find((x) => x.kind === 'code_finding_unconfirmed');
  const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  assert.ok(html.includes(`<strong class="type">${reportWords.REPORT_TYPE_WORDS.verify}:</strong> <em class="by-code-review">`
    + 'A call that hangs is never retried</em>'), 'a Verify item on the page');
  assert.ok(html.includes(`<span class="label">${esc(W.restsOutside)}</span> <em class="by-code-review">${esc(OUTSIDE_PREMISE)}`
    + '</em>'), 'its premise on a visible line');
  // Good to know, so folded: its head is its fold's summary.
  assert.ok(md.includes(`<a name="item-${item.n}"></a>${item.n} ${reportWords.REPORT_TYPE_WORDS.verify}: <em>A call that `
    + 'hangs is never retried</em>'));
  assert.ok(md.includes(`${W.restsOutside} *${OUTSIDE_PREMISE}*`), 'its premise on a visible line of the .md');
  // Each confirmed finding: the label code computed, and its premise in the repository; the bug's language premise.
  const bug = itemsOf(model).find((x) => textOf(x.what.parts) === 'Retry-After is sent in milliseconds, not seconds');
  const lines = bug.evidence.map((e) => [e.label, textOf(e.parts)]);
  assert.ok(lines.some(([label, text]) => label === W.check && text.startsWith(CODE_REPORT_WORDS.checkConfirmed)));
  assert.ok(lines.some(([label, text]) => label === W.restsOn
    && text.endsWith(CODE_REPORT_WORDS.premiseSources.language)));
  assert.equal(bug.restsOutside, null);
  // How code computes the label, said once under the premise contract; never before it.
  const how = (m) => m.notChecked.code.map(textOf);
  assert.ok(how(model).includes(CODE_REPORT_WORDS.howConfirm));
  assert.ok(!how(modelOf(triageReport)).includes(CODE_REPORT_WORDS.howConfirm));
});

test('D110: the ask a finding to verify follows from keeps its status, and its line names the item to verify', () => {
  const model = modelOf(premiseReport);
  const item = itemsOf(model).find((x) => x.kind === 'code_finding_unconfirmed');
  const ask = model.prompt.asks.find((a) => a.n === ROWS.askAdd + 1);
  assert.equal(ask.state, 'done');
  assert.ok(ask.lines.map(textOf).includes(reportWords.REPORT_PROMPT_WORDS.unconfirmedFinding(item.n)), JSON.stringify(
    ask.lines.map(textOf)));
  assert.deepEqual(item.scope.asks, [ROWS.askAdd + 1]);
});

test('D110: the label is computed again from each stored check — a finding to verify a writer put in the confirmed list, or a confirmed one whose premise lost its receipts, is an item to verify', () => {
  const session = triageSession();
  const moved = premiseReport(session);
  moved.codePass = { ...moved.codePass, findings: [...moved.codePass.findings, ...moved.codePass.unconfirmed],
    unconfirmed: [] };
  const a = reportModel(session, moved, {});
  assert.deepEqual(itemsOf(a).filter((x) => x.kind === 'code_finding_unconfirmed').map((x) => textOf(x.what.parts)),
    ['A call that hangs is never retried']);
  const stripped = premiseReport(session);
  stripped.codePass = { ...stripped.codePass, findings: stripped.codePass.findings.map((f, at) => (at === 0
    ? { ...f, check: { ...f.check, premises: f.check.premises.map((p) => ({ ...p, receipts: p.source === 'repository'
      ? [] : p.receipts })) } } : f)) };
  const b = reportModel(session, stripped, {});
  const verify = itemsOf(b).filter((x) => x.kind === 'code_finding_unconfirmed').map((x) => textOf(x.what.parts));
  assert.deepEqual(verify.sort(), ['A call that hangs is never retried', 'Retry-After is sent in milliseconds, not seconds']);
  // The premise that lost its receipts is said as one Sonah could not check, whatever source it names: on its visible
  // line, and in its evidence with the words of a premise that cannot confirm, never its named source's.
  const bug = itemsOf(b).find((x) => textOf(x.what.parts) === 'Retry-After is sent in milliseconds, not seconds');
  assert.equal(bug.restsOutside.length, 1);
  assert.match(textOf(bug.restsOutside[0]), /^SYNTHETIC the traced lines show it/);
  const rests = bug.evidence.filter((e) => e.label === W.restsOn).map((e) => textOf(e.parts));
  assert.deepEqual(rests.map((text) => text.startsWith('SYNTHETIC the traced lines show it')
    ? text.endsWith(CODE_REPORT_WORDS.premiseSources.outside) : text.endsWith(CODE_REPORT_WORDS.premiseSources.language)),
  [true, true], JSON.stringify(rests));
  assert.ok(!rests.some((text) => text.endsWith(CODE_REPORT_WORDS.premiseSources.repository)));
  // A language premise that cannot confirm (a receipt no longer in its span) reads as one Sonah could not check too.
  const lang = premiseReport(session);
  lang.codePass = { ...lang.codePass, findings: lang.codePass.findings.map((f, at) => (at === 0 ? { ...f, check: {
    ...f.check, premises: f.check.premises.map((p) => (p.source === 'language' ? { ...p, receipts: [{ ...f.receipts[0],
      span: 'something else' }] } : p)) } } : f)) };
  const langBug = itemsOf(reportModel(session, lang, {})).find((x) => textOf(x.what.parts) === textOf(bug.what.parts));
  assert.equal(langBug.kind, 'code_finding_unconfirmed');
  assert.ok(langBug.evidence.some((e) => e.label === W.restsOn && textOf(e.parts).startsWith('SYNTHETIC in JavaScript')
    && textOf(e.parts).endsWith(CODE_REPORT_WORDS.premiseSources.outside)));
});

test('D110 (review): an item to verify shows each premise receipt as code under its premise, its visible premise line in its first-screen text, and its ties to the did list and to related items', () => {
  const session = triageSession();
  const report = premiseReport(session);
  const [bugFinding] = report.codePass.findings;
  // A premise receipt on lines that no step of its trace quotes (the trace quotes line 5; this is line 8), and rows it
  // follows from beyond its ask: a claim with an item of its own, and a claim with none.
  const [own] = bugFinding.receipts;
  const ref = (index) => ({ source: 'promises', index, id: report.promises[index].id ?? null });
  report.codePass = { ...report.codePass, unconfirmed: report.codePass.unconfirmed.map((f) => ({ ...f,
    leadsFrom: [...f.leadsFrom, ref(ROWS.claimRetries), ref(ROWS.claimReadme)],
    check: { ...f.check, premises: f.check.premises.map((p) => (p.source === 'repository' ? { ...p, receipts: [own] }
      : p)) } })) };
  const model = reportModel(session, report, {});
  const items = itemsOf(model);
  const item = items.find((x) => x.kind === 'code_finding_unconfirmed');
  const evidence = item.evidence.map((e) => [e.label, textOf(e.parts)]);
  // The receipt of its repository premise, as code, right after that premise.
  const at = evidence.findIndex(([label, text]) => label === W.restsOn
    && text.endsWith(CODE_REPORT_WORDS.premiseSources.repository));
  assert.ok(at >= 0, JSON.stringify(evidence));
  assert.deepEqual(evidence[at + 1], [W.codeNow, `src/retry.js:8 ${own.quote}`]);
  assert.equal(evidence.filter(([label, text]) => label === W.codeNow && text.includes(own.quote)).length, 1,
    'no other line of the item shows it');
  // Its visible premise line is in its first-screen text.
  assert.ok(itemVisibleText(item).includes(`${W.restsOutside} ${OUTSIDE_PREMISE}`), itemVisibleText(item));
  // The claim with no item of its own links to the item to verify from the did list, and keeps its own status.
  const readme = model.did.claims.shown.find((c) => c.source === 'promises' && c.index === ROWS.claimReadme);
  assert.equal(readme.item, item.n);
  assert.notEqual(readme.status, reportWords.REPORT_DID_WORDS.claimStatus.contradictedByCode);
  // The claim with an item of its own and the item to verify are related, each way.
  const retries = items.find((x) => x.rows[0].source === 'promises' && x.rows[0].index === ROWS.claimRetries);
  assert.ok(item.related.items.includes(retries.n), JSON.stringify(item.related));
  assert.ok(retries.related.items.includes(item.n), JSON.stringify(retries.related));
});

test('D110 (review): a stored check that neither confirms nor is to verify is shown nowhere — no item says that its check found the problem, or names no premise', () => {
  const session = triageSession();
  for (const [name, change] of [
    ['a verdict that does not hold', (check) => { check.verdict = 'cannot_tell'; }],
    ['no premise', (check) => { check.premises = []; }],
    ['premises gone', (check) => { delete check.premises; }],
    ['seven premises', (check) => { check.premises = Array.from({ length: 7 }, () => structuredClone(check.premises[1])); }],
  ]) {
    const report = premiseReport(session);
    const [f] = report.codePass.unconfirmed;
    const check = structuredClone(f.check);
    change(check);
    report.codePass = { ...report.codePass, unconfirmed: [{ ...f, check }] };
    const model = reportModel(session, report, {});
    assert.deepEqual(itemsOf(model).filter((x) => x.kind === 'code_finding_unconfirmed'), [], name);
    assert.ok(!itemsOf(model).some((x) => textOf(x.what.parts) === f.title), name);
    // The ask it follows from shows no line of an item to verify, and keeps its status.
    const ask = model.prompt.asks.find((a) => a.n === ROWS.askAdd + 1);
    assert.equal(ask.state, 'done', name);
    assert.ok(!ask.lines.map(textOf).some((line) => line.startsWith(reportWords.REPORT_PROMPT_WORDS.unconfirmedFinding(null)
      .split('.')[0])), name);
    for (const text of [renderSessionPage(session, report, {}), renderReportMarkdown(session, report, {})])
      assert.ok(!text.includes(f.title), name);
  }
  // Every item to verify of the report as the step writes it names at least one premise that Sonah could not check.
  const items = itemsOf(modelOf(premiseReport)).filter((x) => x.kind === 'code_finding_unconfirmed');
  assert.ok(items.length > 0 && items.every((x) => x.restsOutside?.length > 0));
});

test('D110 (review): what the step joined to a row from a checked finding follows the label every reader computes again — a claim it contradicted, and an ask it moved, keep their own status once the finding is one to verify', () => {
  const session = triageSession();
  const CLAIM = 'The wait is 2000, so it is not whole seconds';
  const BUG = 'Retry-After is sent in milliseconds, not seconds';
  const claimStatus = reportWords.REPORT_DID_WORDS.claimStatus;
  const outsideOf = (report, titles) => {
    report.codePass = { ...report.codePass, findings: report.codePass.findings.map((f) => (titles.includes(f.title)
      ? { ...f, check: { ...f.check, premises: f.check.premises.map((p) => ({ ...p, source: 'outside' })) } } : f)) };
    return report;
  };
  const claimRow = (model) => model.did.claims.shown.find((c) => c.source === 'promises' && c.index === ROWS.claimSeconds);
  const askOf = (model) => model.prompt.asks.find((a) => a.n === ROWS.askSeconds + 1);
  const outcome = CODE_REPORT_WORDS.outcomes['contradicted-by-code'];
  const hasOutcome = (model) => itemsOf(model).some((x) => x.evidence.some((e) => textOf(e.parts).includes(outcome)));
  // As the step wrote it: the claim is contradicted by the code, and the done ask has a code finding.
  const written = premiseReport(session);
  const a = reportModel(session, written, {});
  assert.equal(claimRow(a).status, claimStatus.contradictedByCode);
  assert.equal(askOf(a).state, 'doneCode');
  assert.deepEqual([codeContradictedRows(written).length, checklistRowCounts(written).codeContradicted,
    checklistRowCounts(written).asksCodeFinding], [1, 1, 1]);
  // The claim_false and the bug finding with a premise made outside: both are items to verify, and every join the step
  // made from them is read as it now stands — the claim keeps its own status, the ask is done, no line says the code
  // contradicts a row.
  const moved = outsideOf(premiseReport(session), [CLAIM, BUG]);
  const b = reportModel(session, moved, {});
  assert.deepEqual(itemsOf(b).filter((x) => x.kind === 'code_finding_unconfirmed').map((x) => textOf(x.what.parts)).sort(),
    ['A call that hangs is never retried', BUG, CLAIM].sort());
  assert.notEqual(claimRow(b).status, claimStatus.contradictedByCode);
  assert.equal(askOf(b).state, 'done');
  assert.ok(!hasOutcome(b), 'no line says that the code contradicts a row');
  assert.deepEqual([codeContradictedRows(moved).length, checklistRowCounts(moved).codeContradicted,
    checklistRowCounts(moved).asksCodeFinding], [0, 0, 0]);
  assert.equal(codeRowCheck(moved, moved.promises[ROWS.claimSeconds]), null);
  // The stored rows are as the step wrote them: only the reading moved.
  assert.equal(moved.promises[ROWS.claimSeconds].codeCheck.outcome, 'contradicted-by-code');
  assert.equal(askRowKind(moved.requirements[ROWS.askSeconds]), 'asksCodeFinding');
  assert.equal(askRowKind(moved.requirements[ROWS.askSeconds], moved), null);
  // A report before the premise contract keeps its joins as stored.
  const earlier = triageReport(session);
  assert.equal(codeRowCheck(earlier, earlier.promises[ROWS.claimSeconds])?.outcome, 'contradicted-by-code');
  assert.equal(codeContradictedRows(earlier).length, 1);
  // Under the premise contract, a contradiction that names no finding (the step always names one) is read by no reader:
  // the claim is not folded into the checked claim_false finding's item, and keeps its own status. One rule for the
  // item's merge, its quote and the claims list.
  const unnamed = premiseReport(session);
  const { finding: _named, ...check } = unnamed.promises[ROWS.claimSeconds].codeCheck;
  unnamed.promises = unnamed.promises.map((p, i) => (i === ROWS.claimSeconds ? { ...p, codeCheck: check } : p));
  const c = reportModel(session, unnamed, {});
  const claimItem = itemsOf(c).find((x) => textOf(x.what.parts) === CLAIM);
  assert.equal(claimItem.kind, 'code_claim_false');
  assert.ok(!claimItem.rows.some((r) => r.source === 'promises' && r.index === ROWS.claimSeconds), 'not folded');
  assert.notEqual(claimRow(c).status, claimStatus.contradictedByCode);
  assert.equal(codeContradictedRows(unnamed).length, 0);
});

test('D110: a triage proposal moves an item to verify inside its kind\'s bounds — never Must act', () => {
  const session = triageSession();
  const report = premiseReport(session);
  report.codePass = { ...report.codePass, triage: [...report.codePass.triage, { ref: { finding: UNCONFIRMED_ID },
    level: 'high', impact: 'SYNTHETIC a hung call blocks the client.', action: 'Add a timeout to the call.',
    label: 'the hung call', where: null }] };
  const item = itemsOf(reportModel(session, report, {})).find((x) => x.kind === 'code_finding_unconfirmed');
  assert.deepEqual([item.tier.proposed, item.tier.final, item.tier.bound], ['must_act', 'must_know', 'kind_ceiling']);
  assert.equal(item.why, reportWords.REPORT_TIER_WHY.bounded('high', reportWords.REPORT_KIND_WORDS.code_finding_unconfirmed,
    'Must act'));
});

test('D110: no word says that a second or independent reviewer checked a finding', () => {
  const tables = [CODE_REPORT_WORDS, ASK_CODE_WORDS, ...Object.values(reportWords).filter((v) => v !== null
    && typeof v === 'object')];
  const strings = tables.flatMap((t) => stringsOf(t));
  assert.ok(strings.length > 500, 'the word tables are read');
  for (const text of strings) assert.doesNotMatch(text, /second reviewer|independent(ly)? review|another reviewer/i, text);
  // Nor any page or .md of either report: before the premise contract or under it.
  for (const make of [triageReport, premiseReport]) {
    const session = triageSession();
    const report = make(session);
    for (const text of [renderSessionPage(session, report, {}), renderReportMarkdown(session, report, {})])
      assert.doesNotMatch(text, /second reviewer/i);
  }
});

test('D110 (review): where a premise\'s evidence is, is said as what its check quotes or names — never as Sonah\'s own word that lines or the language settle or show it', () => {
  // Code checks only that each quote is literally in the repository and that each source is a token of the closed
  // list; whether a line shows its premise, and whether a behaviour is documented, are the check's to say. So every
  // sentence of the premise words that names the repository or the language has the check as the one that quotes or
  // names.
  const C = CODE_REPORT_WORDS;
  const sentences = [C.checkConfirmed, C.howConfirm, C.premiseSources.repository, C.premiseSources.language]
    .flatMap((text) => text.split(/(?<=\.) /));
  const naming = sentences.filter((s) => /repository|language/.test(s));
  assert.equal(naming.length, 4, JSON.stringify(sentences));
  for (const s of naming) assert.match(s, /\b(its check|it) (quotes|names)\b/i, s);
  // No word of any table says that lines or the language settle a premise, or that lines show it.
  const tables = [CODE_REPORT_WORDS, ASK_CODE_WORDS, ...Object.values(reportWords).filter((v) => v !== null
    && typeof v === 'object')];
  for (const text of tables.flatMap((t) => stringsOf(t)))
    assert.doesNotMatch(text, /\bsettles? (each|every|all|the|its) premises?\b|\blines of the repository show\b/i, text);
  // The ask's line says "here", as a checked finding's does: the finding names the ask only as what it follows from.
  const P = reportWords.REPORT_PROMPT_WORDS;
  assert.ok(P.unconfirmedFinding(null).startsWith(P.codeFinding(null)), P.unconfirmedFinding(null));
});

test('D110: with no finding published as checked, the line says how many are items to verify', () => {
  const pass = { ran: true, coverage: 'complete' };
  assert.equal(codeNoFindingLine(pass, [], [], [{}]), 'The code review published no finding that Sonah checked. 1 finding '
    + 'that it proposed is an item of this report to verify. Sonah could not check all of the premises of it.');
  assert.equal(codeNoFindingLine(pass, [], [], []), CODE_REPORT_WORDS.proposedNone);
  assert.equal(codeNoFindingLine(pass, [{ what: 'finding' }], [], []), CODE_REPORT_WORDS.notPublished(1, 0));
  assert.ok(!CODE_REPORT_WORDS.notPublished(1, 0).includes('checked'));
});
