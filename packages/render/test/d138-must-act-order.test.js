// D138 (the owner, 2026-10-22: "1 B"): inside Must act, the items backed by two recorded quotes that disagree (a claim
// or a statement contradicted by a recorded quote or result; your instruction and the agent's action against it) come
// before the items that rest on something Sonah did not find (an ask done only in part, or not done), and before every
// other; within each group, today's order. The code review's proposed level (D96, D112) stays first. Nothing is dropped
// and no tier moves; the first screen's labels follow the order. Must know keeps its order. Read from the item's kind
// and its two receipts, both found again word for word at two different recorded events; never from wording. (That the
// level stays first: d112-one-point-one-item.test.js (3), on the triaged fixture.) Every session and report here is
// synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, CONTRADICTION_FIRST_TIERS } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';
import { reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { Session } from '../../evidence/src/session.js';

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const id = (c) => `sha256:${c.repeat(64)}`;

/** Two asks done only in part, then a claim contradicted by a recorded result, an edit against your words, and a
 *  statement written into a file that a result contradicts (Must know). `ground`: whether the claim's contradicting
 *  quote is in the recording. */
function review({ ground = true } = {}) {
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache to the parser. Do not touch the config file.');
  b.ask('I2', 'Write the release notes.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  b.change('W2', 'config.json', { after: '{"cache": true}\n' });
  b.change('W3', 'NOTES.md', { after: 'All tests pass on every platform.\n' });
  b.run('R1', 'npm test', 'failed', 'Tests: 2 failed, 9 passed');
  b.say('F1', 'The cache is done and all tests pass.', 'final');
  const session = b.session();
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    sessionReview: 'complete', coverage: 'complete',
    requirements: [
      { text: 'cache', status: 'partly-done', instruction: r('instruction', 'I1', 'Add a cache to the parser'),
        deliverable: r('code', 'W1', 'export const cache = new Map();'), shortfall: r('commentary', 'F1', 'The cache is done') },
      { text: 'notes', status: 'partly-done', instruction: r('instruction', 'I2', 'Write the release notes'),
        deliverable: r('code', 'W3', 'All tests pass on every platform.'), shortfall: r('commentary', 'F1', 'all tests pass') }],
    findings: [
      { id: id('a'), origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE', contradictionSource: 'result',
        title: 'Claim contradicted by a recorded result', receipts: [r('commentary', 'F1', 'all tests pass'),
          r('observation', 'R1-r', ground ? 'Tests: 2 failed, 9 passed' : 'Tests: 0 failed')] },
      { id: id('b'), origin: 'session-review', kind: 'edit_under_negative_requirement', status: 'DECIDE', breach: 'wrote',
        title: 'Edit against your words', receipts: [r('instruction', 'I1', 'Do not touch the config file'),
          r('code', 'W2', '{"cache": true}')] }],
    writtenClaims: [{ id: id('c'), text: 'All tests pass on every platform.', label: 'contradicted', contradictionSource: 'result',
      stated: r('code', 'W3', 'All tests pass on every platform.'), receipts: [r('code', 'W3', 'All tests pass on every platform.'),
        r('observation', 'R1-r', 'Tests: 2 failed, 9 passed')] }] };
  return { session, report };
}
const kinds = (model, tier) => model.tiers[tier].map((item) => item.kind);

test('D138: in Must act, the items backed by two recorded quotes that disagree come first, then the asks done in part', () => {
  assert.deepEqual(CONTRADICTION_FIRST_TIERS, ['must_act']);
  const { session, report } = review();
  const model = reportModel(session, report, {});
  assert.deepEqual(kinds(model, 'must_act'), ['claim_contradicted', 'edit_against_instruction', 'ask_partly_done',
    'ask_partly_done']);
  // Nothing dropped, no tier moved: the asks keep their own order (ask 1, then ask 2) after the two.
  assert.deepEqual(model.tiers.must_act.slice(2).map((item) => item.scope.asks), [[1], [2]]);
  assert.deepEqual(model.tiers.must_act.map((item) => item.n), [1, 2, 3, 4]);
  // The first screen's labels follow the order (four fit: the list's bound cuts none for one more).
  assert.deepEqual(model.countLine.labels.map((l) => l.n), [1, 2, 3, 4]);
  const md = renderReportMarkdown(session, report, {});
  assert.match(md, /^Must act: \[a false claim \(item 1\)\]\(#item-1\) · \[[^\]]+\]\(#item-2\) · \[ask 1\]\(#item-3\) · \[ask 2\]\(#item-4\)$/m);
  const page = renderSessionPage(session, report, {});
  assert.ok(page.indexOf('id="item-1"') < page.indexOf('id="item-3"'));
  // Must know keeps its order: the contradicted statement in a file is where its kind puts it.
  assert.ok(kinds(model, 'must_know').includes('written_contradicted'));
});

test('D138: an item whose second quote is not in the recording rests on no recorded disagreement, and keeps its place', () => {
  const { session, report } = review({ ground: false });
  const model = reportModel(session, report, {});
  assert.deepEqual(kinds(model, 'must_act'), ['edit_against_instruction', 'ask_partly_done', 'ask_partly_done',
    'claim_contradicted']);
});

// ---- D138's review (wf_bdbbf035-5c1): every pair kind and source, the fold, the two-events guard, Must know ----------

/** One session for every case: your two asks and a later message, a project instruction file, the agent's writes, a
 *  failed test run and its closing words. */
function richSession() {
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache to the parser. Do not touch the config file.');
  b.ask('I2', 'Write the release notes.');
  b.change('W1', 'src/cache.js', { after: 'export const cache = new Map();\n' });
  b.change('W3', 'NOTES.md', { after: 'All tests pass on every platform.\n' });
  b.change('W4', 'package-lock.json', { after: '{"lockfileVersion": 3}\n' });
  b.change('W5', 'README.md', { after: 'The cache holds 100 entries.\n' });
  b.run('R1', 'npm test', 'failed', 'Tests: 2 failed, 9 passed');
  b.say('F1', 'The cache is done and all tests pass. The cache holds 500 entries. The lockfile was left alone.', 'final');
  b.ask('I3', 'The cache must hold 100 entries.');
  b.blobs.project = 'Never edit the lockfile.';
  const projectInstructions = [{ id: 'P1', kind: 'project-instructions', path: 'CLAUDE.md', afterSequence: -1,
    text: [{ sourceKey: 'project', fromByte: 0, untilByte: Buffer.byteLength(b.blobs.project) }] }];
  return new Session({ sessionKey: STORY_KEY, adapter: 'claude', events: b.events, blobs: b.blobs, children: b.children,
    projectInstructions });
}
const ASKS = [
  { text: 'cache', status: 'partly-done', instruction: r('instruction', 'I1', 'Add a cache to the parser'),
    deliverable: r('code', 'W1', 'export const cache = new Map();'), shortfall: r('commentary', 'F1', 'The cache is done') },
  { text: 'notes', status: 'partly-done', instruction: r('instruction', 'I2', 'Write the release notes'),
    deliverable: r('code', 'W3', 'All tests pass on every platform.'), shortfall: r('commentary', 'F1', 'all tests pass') }];
const reportWith = (session, fields) => ({ windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
  failure: null }], sessionReview: 'complete', coverage: 'complete', requirements: ASKS, ...fields });
const claim = (source, receipts) => ({ id: id('a'), origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
  contradictionSource: source, title: 'Claim contradicted', receipts });
const mustAct = (session, report) => kinds(reportModel(session, report, {}), 'must_act');
const FIRST = ['claim_contradicted', 'ask_partly_done', 'ask_partly_done'];
const LAST = ['ask_partly_done', 'ask_partly_done', 'claim_contradicted'];

test('D138 (review): a claim contradicted by each source of the recording comes first; its pair is read by its source\'s role', () => {
  const session = richSession();
  const said = (quote) => r('commentary', 'F1', quote);
  const cases = {
    result: [said('all tests pass'), r('observation', 'R1-r', 'Tests: 2 failed, 9 passed')],
    human_message: [said('The cache holds 500 entries'), r('instruction', 'I3', 'The cache must hold 100 entries')],
    file_content: [said('The cache holds 500 entries'), r('code', 'W5', 'The cache holds 100 entries.')],
    project_instructions: [said('The lockfile was left alone'), r('project-instructions', 'P1', 'Never edit the lockfile.')],
    own_written: [said('all tests pass'), r('code', 'W3', 'All tests pass on every platform.')],
  };
  for (const [source, receipts] of Object.entries(cases)) {
    assert.deepEqual(mustAct(session, reportWith(session, { findings: [claim(source, receipts)] })), FIRST, source);
    // The pair is found by role, wherever the receipts stand in the row.
    assert.deepEqual(mustAct(session, reportWith(session, { findings: [claim(source, [...receipts].reverse())] })), FIRST,
      `${source}, receipts reversed`);
  }
  // A receipt of another role than the claim's source quotes is no pair: the claim keeps its place.
  assert.deepEqual(mustAct(session, reportWith(session, { findings: [claim('project_instructions',
    [said('The lockfile was left alone'), r('code', 'W5', 'The cache holds 100 entries.')])] })), LAST);
  assert.deepEqual(mustAct(session, reportWith(session, { findings: [claim('result',
    [said('all tests pass'), r('instruction', 'I3', 'The cache must hold 100 entries')])] })), LAST);
});

test('D138 (review): an edit against a project instruction file is a pair; two quotes at one event are not', () => {
  const session = richSession();
  const edit = { id: id('b'), origin: 'session-review', kind: 'edit_under_negative_requirement', status: 'DECIDE',
    breach: 'wrote', title: 'Edit against your words', receipts: [r('project-instructions', 'P1', 'Never edit the lockfile.'),
      r('code', 'W4', '{"lockfileVersion": 3}')] };
  assert.deepEqual(mustAct(session, reportWith(session, { findings: [edit] })), ['edit_against_instruction',
    'ask_partly_done', 'ask_partly_done']);
  // A statement written into a file, rated high with the asks: contradicted by a recorded result, it comes first; by a
  // second quote of the same write (one event), it keeps its place.
  const high = (refs) => ({ codePass: { triage: refs.map((ref) => ({ ref, level: 'high' })) } });
  const written = (other) => ({ id: id('c'), text: 'All tests pass on every platform.', label: 'contradicted',
    contradictionSource: 'result', stated: r('code', 'W3', 'All tests pass on every platform.'),
    receipts: [r('code', 'W3', 'All tests pass on every platform.'), other] });
  const refs = [{ source: 'writtenClaims', index: 0 }, { source: 'requirements', index: 0 }, { source: 'requirements', index: 1 }];
  assert.deepEqual(mustAct(session, reportWith(session, { writtenClaims: [written(r('observation', 'R1-r',
    'Tests: 2 failed, 9 passed'))], ...high(refs) })), ['written_contradicted', 'ask_partly_done', 'ask_partly_done']);
  assert.deepEqual(mustAct(session, reportWith(session, { writtenClaims: [written(r('code', 'W3', 'every platform'))],
    ...high(refs) })), ['ask_partly_done', 'ask_partly_done', 'written_contradicted']);
});

test('D138 (review): Must know keeps its order — a grounded pair kind stays behind an earlier kind at the same level', () => {
  const session = richSession();
  const medium = { codePass: { triage: [{ ref: { source: 'requirements', index: 0 }, level: 'medium' },
    { ref: { source: 'writtenClaims', index: 0 }, level: 'medium' }] } };
  const written = { id: id('c'), text: 'All tests pass on every platform.', label: 'contradicted', contradictionSource: 'result',
    stated: r('code', 'W3', 'All tests pass on every platform.'), receipts: [r('code', 'W3', 'All tests pass on every platform.'),
      r('observation', 'R1-r', 'Tests: 2 failed, 9 passed')] };
  const model = reportModel(session, reportWith(session, { writtenClaims: [written], ...medium }), {});
  assert.deepEqual(kinds(model, 'must_know'), ['ask_partly_done', 'written_contradicted']);
});

test('D138 (review): a contradicted claim that a code finding holds (D97\'s fold) makes that item come first', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const at = report.findings.findIndex((f) => f.kind === 'claim_contradicted' && f.status === 'DECIDE');
  const claimFalse = report.codePass.findings.find((f) => f.kind === 'claim_false');
  claimFalse.leadsFrom = [{ key: 'S9', kind: 'claim', source: 'findings', index: at, id: report.findings[at].id }];
  report.findings[at] = { ...report.findings[at], codeCheck: { outcome: 'contradicted-by-code', receipts: [],
    by: 'finding', finding: claimFalse.id } };
  const model = reportModel(session, report, repoFacts());
  // The two the code review rated high, then the code finding that holds the contradicted claim, and the edit against
  // your words; then the rest in the kinds' order.
  assert.deepEqual(kinds(model, 'must_act'), ['code_bug', 'decision_unasked', 'code_claim_false', 'edit_against_instruction',
    'ask_not_done', 'ask_partly_done', 'code_ask_not_met', 'code_contract']);
  assert.equal(kinds(model, 'must_act').includes('claim_contradicted'), false, 'folded, not an item of its own');
});
