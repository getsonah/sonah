// Fold, never drop (D97): every row of every source set the readers read is placed exactly
// once — as an item, folded into an item, as an ask of your prompt, or in a list — on every fixture shape, a row a
// display bound cuts included; every fold's count equals its contents. A later "simplification" that drops a row fails
// here. Every session and report here is synthetic (report-fixture.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportPlacement, REPORT_LIMITS } from '../report-model.js';
import { codePassFindings, codePassQuestions, codePassWithheld, codePassUnconfirmed } from '../../evidence/src/code-pass.js';
import { renderSessionPage } from '../session-page.js';
import { REPORT_SHAPES, reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { STORY_KEY } from './session-story-fixture.js';

/** Every row of every source set, by `source:index`, enumerated here from the report itself (not from the model). */
function sourceKeys(report) {
  const keys = [];
  for (const source of ['requirements', 'decisions', 'pivots', 'writtenClaims', 'findings', 'failures', 'promises'])
    (Array.isArray(report[source]) ? report[source] : []).forEach((row, index) => {
      if (row !== null && typeof row === 'object' && !Array.isArray(row)) keys.push(`${source}:${index}`);
    });
  codePassFindings(report).forEach((_, index) => keys.push(`codePass.findings:${index}`));
  codePassQuestions(report).forEach((_, index) => keys.push(`codePass.questions:${index}`));
  // D110: the findings code's label does not confirm, each an item to verify.
  codePassUnconfirmed(report).forEach((_, index) => keys.push(`codePass.unconfirmed:${index}`));
  codePassWithheld(report).forEach((_, index) => keys.push(`codePass.withheld:${index}`));
  return keys.sort();
}
const PLACES = Object.freeze(['item', 'foldedInto', 'memberOf', 'ask', 'list', 'notChecked']);
const itemsOf = (model) => [...model.tiers.must_act, ...model.tiers.must_know, ...model.tiers.good_to_know];
const textOf = (parts) => parts.map((p) => (p.quote ? `“${p.text}”${p.cut ? '…' : ''}` : p.text)).join('');

function assertPlaced(model, report, label) {
  const placement = reportPlacement(model);
  assert.deepEqual(Object.keys(placement).sort(), sourceKeys(report), `${label}: every row placed, none invented`);
  const items = itemsOf(model);
  for (const [key, place] of Object.entries(placement)) {
    const forms = Object.keys(place).filter((k) => PLACES.includes(k));
    assert.equal(forms.length, 1, `${label} ${key}: exactly one place`);
    if (place.item || place.foldedInto) {
      const item = items.find((x) => x.n === (place.item ?? place.foldedInto));
      assert.ok(item, `${label} ${key}: its item exists`);
      const [source, index] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))];
      assert.ok(item.rows.some((r) => r.source === source && r.index === index), `${label} ${key}: the item holds it`);
      assert.equal(place.item !== undefined, item.rows[0].source === source && item.rows[0].index === index,
        `${label} ${key}: an item's primary row is placed as the item, every other as folded into it`);
      assert.equal(item.members.some((m) => m.rows.some((r) => r.source === source && r.index === index)), false,
        `${label} ${key}: a row folded into an item is no member's`);
    }
    if (place.memberOf) {
      // D112: a member of an item is the first row of exactly one member of that item, and the item holds it.
      const item = items.find((x) => x.n === place.memberOf);
      assert.ok(item, `${label} ${key}: its item exists`);
      const [source, index] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))];
      assert.ok(item.rows.some((r) => r.source === source && r.index === index), `${label} ${key}: the item holds it`);
      assert.equal(item.members.filter((m) => m.rows[0].source === source && m.rows[0].index === index).length, 1,
        `${label} ${key}: one member leads with it`);
    }
    if (place.ask) assert.ok(model.prompt.asks.some((a) => a.n === place.ask), `${label} ${key}: its ask exists`);
  }
  // Each item's rows are placed as that item, once; no row is in two items.
  const held = items.flatMap((item) => item.rows.map((r) => `${r.source}:${r.index}`));
  assert.equal(new Set(held).size, held.length, `${label}: no row in two items`);
  // The counts: the count line's equal the sections'; every fold's equals its contents.
  for (const t of model.countLine.tiers) assert.equal(t.n, model.tiers[t.tier].length, `${label} ${t.tier}`);
  const prompt = model.prompt.counts;
  assert.equal(Object.values(prompt).reduce((a, b) => a + b, 0), model.prompt.asks.length, `${label}: prompt counts`);
  const did = model.did;
  assert.equal(did.files.groups.reduce((n, g) => n + g.files.length, 0), did.files.total, `${label}: files`);
  assert.equal(did.runs.shown.length + did.runs.quietExit0 + did.runs.cut, did.runs.total, `${label}: runs`);
  assert.equal(did.claims.shown.length + did.claims.more, did.claims.total, `${label}: claims`);
  const nc = model.notChecked;
  // D133's review: the first screen's lines said in it (`quiet`) are not counted.
  assert.equal(nc.total, nc.facts.length + nc.withheldTotal + nc.unreadAsks.length + nc.unreadRows.length,
    `${label}: what Sonah could not check`);
  // Every row in a list is in that list's count, shown or cut.
  const inList = (list) => Object.values(placement).filter((p) => p.list === list).length;
  assert.equal(inList('runs'), report.failures.filter((f) => f && typeof f.eventId === 'string')
    .filter((_, i) => placement[`failures:${i}`]?.list === 'runs').length);
  assert.ok(inList('claims') <= did.claims.total, `${label}: every listed claim is in the claims count`);
}

test('D97 (3): every row of every source set is placed exactly once, on every fixture shape', () => {
  for (const [letter, shape] of Object.entries(REPORT_SHAPES)) {
    const session = reportSession();
    const report = shape(session);
    assertPlaced(reportModel(session, report, repoFacts()), report, letter);
    assertPlaced(reportModel(session, report, {}), report, `${letter} without facts`);
  }
});

test('D97 (3): the readers read no field outside the source sets (code-pass/3 and /8), and say nothing of it', () => {
  const session = reportSession();
  const e = REPORT_SHAPES.e(session);
  const model = reportModel(session, e, {});
  assert.equal(Object.keys(reportPlacement(model)).some((key) => /^codePass\.(?:held|rejected|groups|votes|codeStatus)\b/.test(key)), false);
  assert.equal(JSON.stringify(model).includes('The auth check runs first'), false, 'held');
  assert.equal(JSON.stringify(model).includes('The README is right'), false, 'a withheld entry of what held');
  const d = reportModel(session, REPORT_SHAPES.d(session), {});
  assert.equal(JSON.stringify(d).includes('"votes"'), false);
});

test('D97 (3): merges keep every row — a promise a finding cites, a confirmed promise the code contradicts', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const model = reportModel(session, report, repoFacts());
  const placement = reportPlacement(model);
  const items = itemsOf(model);
  // The promise listedPromises leaves out (a contradicted-claim finding cites its words) is folded into that item.
  const contradicted = items.find((item) => item.kind === 'claim_contradicted');
  assert.deepEqual(placement['promises:2'], { foldedInto: contradicted.n });
  const shown = model.did.claims.shown.find((c) => c.source === 'promises' && c.index === 2);
  assert.deepEqual([shown.status, shown.item, textOf([shown.quote])], ['contradicted', contradicted.n,
    '“The limiter uses Redis.”']);
  // The confirmed promise a claim_false finding contradicts: "contradicted by the code review → item n", never "checked".
  const claimFalse = items.find((item) => item.kind === 'code_claim_false');
  assert.deepEqual(placement['promises:3'], { foldedInto: claimFalse.n });
  const verified = model.did.claims.shown.find((c) => c.source === 'promises' && c.index === 3);
  assert.deepEqual([verified.status, verified.item], ['contradicted by the code review', claimFalse.n]);
  assert.equal(model.did.claims.shown.some((c) => c.item === claimFalse.n && c.status === 'checked'), false);
  // On a merged item only the primary row's triage entry sets its tier, impact, action and label.
  const notMet = items.find((item) => item.kind === 'code_ask_not_met');
  assert.deepEqual([notMet.tier.proposed, notMet.impact, notMet.action], [null, null, null]);
  assert.equal(notMet.label[0].by, 'sonah');
  // The page shows a folded row with its status, its link and its words (R11: a row never reads as its link alone).
  const html = renderSessionPage(session, report, repoFacts());
  assert.match(html, new RegExp(`<li id="claim-4"><span class="tag">contradicted by the code review</span> `
    + `<a href="#item-${claimFalse.n}">→ item ${claimFalse.n}</a> <q class="said">I reverted the CI change\\.</q></li>`));
});

test('D97 (3): a row a display bound cuts is still placed, and its list counts it', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const extra = Array.from({ length: 60 }, (_, k) => ({ id: `sha256:${String(k).padStart(64, '0')}`,
    stated: { role: 'commentary', eventId: 'F1', quote: 'rate limiting works', sessionKey: STORY_KEY },
    text: `claim ${k}`, status: 'open', receipts: [] }));
  report.promises = [...report.promises, ...extra];
  const model = reportModel(session, report, repoFacts());
  const placement = reportPlacement(model);
  const cut = Object.entries(placement).filter(([, p]) => p.list === 'claims' && p.shown === false);
  assert.ok(cut.length > 0, 'some claims past the bound');
  assert.equal(model.did.claims.shown.length, REPORT_LIMITS.claims);
  assert.equal(model.did.claims.more, model.did.claims.total - REPORT_LIMITS.claims);
  assertPlaced(model, report, 'many claims');
});

test('D97 (3): every row is placed exactly once on the triage contract\'s fixtures (a) to (g) too', async () => {
  const { TRIAGE_REPORTS, triageSession } = await import('../../evidence/test/report-triage-fixture.js');
  for (const [letter, shape] of Object.entries(TRIAGE_REPORTS)) {
    const session = triageSession();
    const report = shape(session);
    assertPlaced(reportModel(session, report, {}), report, `contract ${letter}`);
  }
});

test('D97 (3): a row no reader reads is placed under What Sonah could not check, by its id, and counted there', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // A failure with no event, a finding of a kind no reader knows and a written statement with no text.
  report.failures = [...report.failures, { handling: 'passed-over' }];
  report.findings = [...report.findings, { id: `sha256:${'7'.repeat(64)}`, kind: 'a kind no reader knows', receipts: [] }];
  report.writtenClaims = [...report.writtenClaims, { id: `sha256:${'8'.repeat(64)}`, label: 'unverified', stated: null }];
  const model = reportModel(session, report, repoFacts());
  const placement = reportPlacement(model);
  const unread = Object.entries(placement).filter(([, p]) => p.notChecked === 'unreadRows').map(([key]) => key).sort();
  assert.deepEqual(unread, [`failures:${report.failures.length - 1}`, `findings:${report.findings.length - 1}`,
    `writtenClaims:${report.writtenClaims.length - 1}`]);
  assert.equal(model.notChecked.unreadRows.length, 1);
  assert.match(model.notChecked.unreadRows[0], /^Sonah could not read 3 other parts of the session review: /);
  for (const id of ['777777777777', '888888888888']) assert.ok(model.notChecked.unreadRows[0].includes(id), id);
  assertPlaced(model, report, 'unread rows');
  // The page says it under What Sonah could not check, and its count holds it.
  const html = renderSessionPage(session, report, repoFacts());
  const section = html.slice(html.indexOf('id="not-checked"'));
  assert.ok(section.includes(model.notChecked.unreadRows[0]));
  assert.match(html, new RegExp(`What Sonah could not check \\(${model.notChecked.total} facts\\)`));
});
