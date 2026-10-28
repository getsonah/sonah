// The report model (D97): its items, tiers, order, header, count line, prompt and the
// facts every reader shows. Every session, report, path and hash here is synthetic (report-fixture.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, permalinkOf, tierMoves, firstScreenWords, firstScreenExcerptLines, openText, headText, itemVisibleText,
  pointerLinesText, refusedCall, ITEM_TYPES, REPORT_MODEL_VERSION, REPORT_LIMITS, reportItems } from '../report-model.js';
import { REPORT_ITEM_KINDS, REPORT_ITEM_TYPES, RESULT_OUTCOME_WORDS, RESULT_OUTCOME_CLASSES, TIER_BOUND_REASONS } from '../../evidence/src/ledger.js';
/** The story's words for a message with no recorded words, before the story was the report .md (story /32): no reader
 *  shows them, and storyFacts no longer makes them. */
const STORY_SENTENCES = Object.freeze({ withheldAsk: '(no request text in the recording)' });
import { PERMISSION_DENIALS } from '../../evidence/src/triage.js';
import { effectOf } from '../../evidence/src/session.js';
import * as words from '../report-words.js';
import { renderReportMarkdown } from '../session-story.js';
import { renderSessionPage } from '../session-page.js';
import { REPORT_SHAPES, reportSession, triagedReport, untriagedReport, sessionOnlyReport, codePass3Report, codePass1Report,
  codePass8Report, sessionReviewOnlyReport, repoFacts, HEAD, START, REPORT_TEXT } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const modelOf = (shape, options = repoFacts()) => {
  const session = reportSession();
  return reportModel(session, shape(session), options);
};
const itemsOf = (model) => reportItems(model);
const textOf = (parts) => parts.map((p) => (p.quote ? `“${p.text}”${p.cut ? '…' : ''}` : p.text)).join('');
const byKind = (model, kind) => itemsOf(model).filter((item) => item.kind === kind);
const one = (model, kind) => { const found = byKind(model, kind); assert.ok(found.length, kind); return found[0]; };

test('D97 (1): every item kind of fixture (a) is an item of its type, tier and fields', () => {
  const model = modelOf(triagedReport);
  const items = itemsOf(model);
  // Fixture (a) is a code step of code-pass/10, before the premise contract (D110) and the tie rule (D152), so it holds
  // no finding to verify (d110-premise-render.test.js shows one) and no open finding (d152-open-render.test.js shows
  // one). D153: nor is it a review run with the after-point re-check (d153-recheck-render.test.js and
  // d153-recheck-unsettled-render.test.js show its four kinds).
  assert.deepEqual(REPORT_ITEM_KINDS.filter((kind) => !items.some((item) => item.kind === kind)),
    ['ask_not_checked_after_later_work', 'claim_not_checked_after_later_work', 'written_not_checked_after_later_work',
      'code_finding_open', 'code_finding_unconfirmed', 'written_corrected'],
    'every kind at least once');
  assert.deepEqual(items.map((item) => item.n), items.map((_, i) => i + 1), 'numbered once across the three tiers');
  for (const item of items) {
    assert.equal(item.type, ITEM_TYPES[item.kind], item.kind);
    assert.ok(REPORT_ITEM_TYPES.includes(item.type));
    assert.ok(item.what.parts.length, item.kind);
    assert.ok(item.where.length <= REPORT_LIMITS.where);
    assert.equal(item.scope.preExisting, false);
  }
  // The type is set by the kind, never by the code review.
  assert.deepEqual(Object.keys(ITEM_TYPES).sort(), [...REPORT_ITEM_KINDS].sort());
  assert.equal(one(model, 'ask_not_done').type, 'fix');
  assert.equal(one(model, 'claim_contradicted').type, 'verify');
  assert.equal(one(model, 'decision_whether_asked').type, 'read');
  assert.equal(one(model, 'pivot').type, 'decide');
  // A listed claim the code review proposed high is a Must know Verify item (its kind's ceiling); one it proposed low
  // stays in the claims list.
  const raised = one(model, 'claim_not_checked');
  assert.deepEqual([raised.tier.final, raised.tier.bound, raised.type], ['must_know', 'kind_ceiling', 'verify']);
  assert.equal(textOf([raised.quote]), '“all tests pass”');
  assert.deepEqual(model.placement.rows['promises:1'], { list: 'claims', shown: true });
  const listed = model.did.claims.shown.find((c) => c.source === 'promises' && c.index === 1);
  assert.deepEqual([listed.status, listed.item], ['not checked', null]);
  // The scope markers: a decision made without asking says so; one Sonah could not tie to an ask says that.
  assert.equal(one(model, 'decision_unasked').scope.notAsked, true);
  assert.equal(one(model, 'decision_whether_asked').scope.askedUnknown, true);
  assert.deepEqual(one(model, 'decision_chose').scope.asks, [2], 'its instruction overlaps ask 2');
  // The code review's own words are said to be the code review's; the session review's to be the session review's.
  assert.equal(one(model, 'code_bug').what.parts[0].by, 'code-review');
  assert.ok(one(model, 'decision_unasked').what.parts.some((p) => p.by === 'session-review'));
});

test('D97 (2): an ask_not_met finding that names a not-done ask is one item, and the ask links to it', () => {
  const model = modelOf(triagedReport);
  const notMet = one(model, 'code_ask_not_met');
  assert.deepEqual(notMet.rows, [{ source: 'codePass.findings', index: 1 }, { source: 'requirements', index: 1 }]);
  assert.deepEqual(model.placement.rows['requirements:1'], { foldedInto: notMet.n });
  const ask = model.prompt.asks.find((a) => a.n === 2);
  assert.equal(ask.status, 'Not done');
  assert.equal(ask.item, notMet.n);
  assert.deepEqual(ask.lines.map(textOf), [`See item ${notMet.n}.`]);
  // No item of kind ask_not_done stands for ask 2: one item per root cause.
  assert.ok(!byKind(model, 'ask_not_done').some((item) => item.rows.some((r) => r.source === 'requirements' && r.index === 1)));
  // On the merged item only the primary row's triage entry is used: the merged ask's entry ("NOT USED") is not shown.
  assert.equal(JSON.stringify(notMet).includes('NOT USED'), false);
});

test('D97 (4): inside a tier, items go by kind, then by the first ask they are tied to, then by index — never by path', () => {
  const session = reportSession();
  const report = untriagedReport(session);
  const findings = report.codePass.findings;
  // A bug tied to no ask, listed first and on a path that sorts first, and a bug tied to ask 1 on a later path.
  findings[5] = { ...findings[5], anchor: { ...findings[5].anchor }, title: 'Aaa first by alphabet' };
  report.codePass.findings = [findings[5], ...findings.filter((_, i) => i !== 5)];
  const model = reportModel(session, report, repoFacts());
  const act = model.tiers.must_act.map((item) => item.kind);
  // Kinds in their order (D97); D138: the items backed by two recorded quotes that disagree first (here a contradicted
  // claim and an edit against your words), each part in the kinds' order.
  assert.deepEqual(act.slice(0, 2), ['claim_contradicted', 'edit_against_instruction']);
  const rest = act.slice(2);
  assert.deepEqual(rest, [...rest].sort((a, b) => REPORT_ITEM_KINDS.indexOf(a) - REPORT_ITEM_KINDS.indexOf(b)));
  const bugs = model.tiers.must_act.filter((item) => item.kind === 'code_bug');
  assert.deepEqual(bugs.map((item) => textOf(item.what.parts)), ['The bucket refills before the first request',
    'Aaa first by alphabet'], 'the bug tied to ask 1 first; the untied one last, whatever its title or index');
  assert.deepEqual(bugs.map((item) => item.scope.asks), [[1], []]);
});

test('D97 (5): header line D counts from structure; line E stands exactly when the code step did not run', () => {
  const a = modelOf(triagedReport);
  // The claims the claims list shows as not checked, with the one resting on a check that did not finish (its row says
  // so in its own words; Sonah did not check it either), and the written statements it shows as not checked.
  // D115: the asks for which the session review cited only the agent's words, never that they rest on nothing else.
  // D133 (R2): the line is said word for word in What Sonah could not check, first; the first screen has none.
  assert.equal(a.header.didNotCheck, null);
  assert.equal(a.notChecked.quiet[0], 'Sonah did not check: 1 ask · 1 ask for which the session review cited only the '
    + 'agent\'s words · 3 claims · 1 statement that the agent wrote into a file');
  assert.equal(a.header.noCode, null);
  // What Sonah could not check names the same counts in the same terms: one term for one thing (S4).
  const facts = a.notChecked.facts.map((f) => textOf(f.parts));
  assert.ok(facts.includes('Sonah did not check 3 claims. The claims under What the agent did list them.'), facts.join('\n'));
  assert.ok(facts.includes('Sonah did not check 1 statement that the agent wrote into a file. The claims under What the '
    + 'agent did list it.'));
  // D118 (a): line E is the first screen's "No code was reviewed." with its one closed reason; with no code step that
  // ran, the items' line beside it; a folder only where the code step looked in one.
  const c = modelOf(sessionReviewOnlyReport);
  assert.deepEqual(c.header.noCode, { reason: 'step_off', words: 'No code was reviewed. Reason: this review ran without '
    + 'the code review.', folder: null, impact: words.REPORT_HEADER_WORDS.noCodeImpact });
  // D122 (a review low of D118): a report that holds a finding of the retired combined route's code review and no code
  // pass record is a combined review, whose run words name its code review: no line E, as the terminal and the PR
  // comment say none (one definition, evidence code-report.js `reportNotReviewedOf`).
  assert.equal(modelOf(sessionOnlyReport).header.noCode, null);
  // A code step that did not run: line E, with the code step's own reason.
  const session = reportSession();
  const notRun = { ...untriagedReport(session), codePass: { ran: false, gaps: [{ code: 'code_step_backend' }] } };
  const model = reportModel(session, notRun, { folder: '/work/project' });
  assert.deepEqual(model.header.noCode, { reason: 'backend', words: 'No code was reviewed. Reason: the code review '
    + 'needs Claude Code, and this review used another backend.', folder: null,
  impact: words.REPORT_HEADER_WORDS.noCodeImpact });
  const noRoot = reportModel(session, { ...notRun, codePass: { ran: false } }, { folder: '/work/project' });
  assert.deepEqual([noRoot.header.noCode.reason, noRoot.header.noCode.folder], ['no_folder', '/work/project']);
});

test('D96: the count of the code review\'s notes Sonah did not use counts only entries, never a list record or a kept entry', () => {
  const session = reportSession();
  const base = triagedReport(session);
  const notesOf = (triageDropped, filesDropped) => {
    const model = reportModel(session, { ...base, codePass: { ...base.codePass, triageDropped, filesDropped } }, repoFacts());
    return model.notChecked.facts.map((f) => textOf(f.parts)).filter((t) => t.startsWith('The code review wrote '));
  };
  const W = words.REPORT_NOT_CHECKED_WORDS;
  // An answer with no triage list and no files list (code-pass/10 records one `key_missing` record each, index null),
  // a list that is not a list, and an entry kept without its place: no note Sonah did not use.
  const listRecords = [{ key: null, index: null, cause: 'key_missing' }];
  const kept = [{ key: 'S1', index: 0, cause: 'where_ungrounded' }];
  assert.deepEqual(notesOf(listRecords, [{ key: null, index: null, cause: 'value_outside_list' }]), []);
  assert.deepEqual(notesOf([...listRecords, ...kept], listRecords), []);
  // The entries Sonah did not use, counted once each beside those records: those that failed Sonah's checks, and apart
  // those about a finding or question that Sonah withheld, which passed their own (the beta.2 release check).
  const dropped = [{ key: 'S99', index: 3, cause: 'triage_key_unknown' }, { key: 'F1', index: 4, cause: 'item_withheld' }];
  assert.deepEqual(notesOf([...listRecords, ...kept, ...dropped], [{ key: 'vendor/lib.js', index: 0,
    cause: 'file_not_in_change' }]), [W.triageDropped(2), W.triageOfWithheld(1)]);
  assert.deepEqual(notesOf([{ key: 'F1', index: 0, cause: 'item_withheld' }, { key: 'Q2', index: 1,
    cause: 'item_withheld' }], []), [W.triageOfWithheld(2)]);
  assert.equal(W.triageOfWithheld(1), 'The code review wrote 1 note about a proposal that Sonah withheld. Sonah did not '
    + 'use it.');
  assert.ok(!W.triageOfWithheld(2).includes('failed'));
});

test('D97 (6): without triage (fixtures b and c) no item shows an impact or an action line, and tiers are the defaults', () => {
  for (const shape of [untriagedReport, sessionOnlyReport]) {
    const model = modelOf(shape);
    for (const item of itemsOf(model)) {
      assert.equal(item.impact, null, item.kind);
      assert.equal(item.action, null, item.kind);
      assert.equal(item.tier.proposed, null);
      // D161: a question of the code review that Sonah could not tie is at most Good to know, below its default.
      if (item.tier.bound === 'untied_ceiling') assert.deepEqual([item.kind, item.tier.final], ['code_question',
        'good_to_know']);
      else assert.equal(item.tier.final, item.tier.default, item.kind);
      assert.ok(item.label.every((p) => p.by !== 'code-review'), 'the fixed kind label');
    }
    assert.equal(model.footer.triageLegend, null);
  }
});

test('D97 (7): impact, action and label lines appear only for triaged items; a bounded proposal says why', () => {
  const model = modelOf(triagedReport);
  for (const item of itemsOf(model)) {
    const triaged = item.tier.proposed !== null;
    assert.equal(item.impact !== null, triaged, `${item.kind} impact`);
    assert.equal(item.action !== null, triaged, `${item.kind} action`);
    assert.equal(item.label[0].by === 'code-review', triaged, `${item.kind} label`);
    if (triaged) assert.ok(item.impact[0].by === 'code-review' && item.action[0].by === 'code-review');
  }
  const bug = itemsOf(model).find((item) => textOf(item.what.parts) === 'The bucket refills before the first request');
  assert.equal(textOf(bug.impact), 'A burst of requests passes the limit at start.');
  assert.equal(textOf(bug.action), 'Refill the bucket after the first request.');
  assert.equal(bug.why, 'The code review proposed high, and Sonah kept it.');
  const floored = itemsOf(model).find((item) => textOf(item.what.parts) === 'A rate of zero lets every request through');
  assert.equal(floored.why, 'The code review proposed low. Sonah never puts a bug that Sonah checked in Good to know.');
  const refused = itemsOf(model).find((item) => item.tier.bound === 'refused_call_ceiling');
  assert.equal(refused.why, words.REPORT_TIER_WHY.refused);
  assert.equal(one(model, 'pivot').why, 'Sonah puts a change of approach in Good to know by default.');
  assert.equal(model.footer.triageLegend, words.REPORT_FOOTER_WORDS.triageLegend);
  // The moves are measurable with zero calls.
  const moves = tierMoves(model);
  assert.equal(moves.length, itemsOf(model).length);
  assert.ok(moves.some((m) => m.bound === 'kind_floor') && moves.some((m) => m.bound === 'kind_ceiling'));
});

test('D97 (8): the empty Must act and Must know pair stands exactly when both are empty', () => {
  const model = modelOf(triagedReport);
  assert.equal(model.countLine.empty, null);
  const b = sessionBuilder();
  b.ask('I1', 'Rename the helper.');
  b.change('W1', 'src/a.js', { after: 'export const b = 1;\n' });
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const empty = reportModel(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }], requirements: [{ text: 'Rename the helper', status: 'done',
    instruction: { role: 'instruction', eventId: 'I1', quote: 'Rename the helper', sessionKey: STORY_KEY },
    deliverable: { role: 'code', eventId: 'W1', quote: 'export const b = 1;', sessionKey: STORY_KEY } }] }, {});
  // D133 (R2): the sentence after it is said in What Sonah could not check.
  assert.equal(empty.countLine.empty, 'Sonah found nothing for Must act or Must know.');
  assert.ok(empty.notChecked.quiet.includes('This does not mean that the work is correct.'));
  assert.deepEqual(empty.countLine.labels, []);
  // A Good to know item alone keeps the pair.
  assert.equal(itemsOf(empty).length, 0);
  // Must act empty and Must know not: no pair; the first screen's item is the first of Must know.
  const failure = { eventId: 'W1', handling: 'passed-over' };
  const known = reportModel(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }], failures: [failure] }, {});
  assert.deepEqual([known.tiers.must_act.length, known.tiers.must_know.length], [0, 1]);
  assert.equal(known.countLine.empty, null);
  const count = (text) => text.split(/\s+/).filter(Boolean).length;
  // D131 (R1): Must act and Must know come before your prompt, so the first screen is the header, the count line and
  // the first item.
  assert.equal(firstScreenWords(known), count(headText(known)) + count(itemVisibleText(known.tiers.must_know[0])));
  assert.ok(count(openText(known)) > count(headText(known)), 'your prompt is not on the first screen');
  assert.ok(count(itemVisibleText(known.tiers.must_know[0])) > 0);
  // D161: a decision alone is in the second part, tagged Must know: the tiers are empty, and still no pair, since the
  // report holds an item tagged Must know (the pair would be false). The first screen holds no item; D163's review: it
  // shows Must know's pointer to it, its heading and its line.
  const decided = reportModel(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }], decisions: [{ dimension: 'retry count', chosen: 'three retries', column: 'unasked',
    columnState: 'grounded', actions: ['W1'], stated: null }] }, {});
  assert.deepEqual([decided.tiers.must_act.length, decided.tiers.must_know.length], [0, 0]);
  assert.deepEqual([decided.decisions.total, decided.decisions.tagged.must_know], [1, 1]);
  assert.equal(decided.countLine.empty, null);
  assert.equal(decided.notChecked.quiet.includes('This does not mean that the work is correct.'), false);
  assert.equal(decided.countLine.decisions.words, '1 decision (1 Must know)');
  assert.equal(decided.pointers.must_know.length, 1);
  assert.equal(firstScreenWords(decided), count(headText(decided)) + count(pointerLinesText(decided, 'must_know')
    .join('\n')));
  assert.equal(firstScreenExcerptLines(decided), 0);
});

test('D97 (23): a decision\'s fixed label sets the session review\'s words apart: "decision on {dimension}"', () => {
  for (const shape of [untriagedReport, sessionOnlyReport]) {
    const model = modelOf(shape);
    const decisions = itemsOf(model).filter((item) => item.kind.startsWith('decision_'));
    assert.ok(decisions.length > 0);
    for (const item of decisions) {
      const [lead, dimension] = item.label;
      assert.deepEqual([lead.text, lead.by], ['decision on ', 'sonah'], item.kind);
      assert.equal(dimension.by, 'session-review', item.kind);
      assert.ok(dimension.text.split(' ').length <= REPORT_LIMITS.labelWords - 2);
    }
  }
});

test('D97 (9): a quote that does not ground in this session is never shown; an excerpt whose hash differs never shown', () => {
  const session = reportSession();
  const report = triagedReport(session);
  report.findings[0] = { ...report.findings[0], receipts: [{ ...report.findings[0].receipts[0],
    quote: 'The limiter uses Redis everywhere.' }, report.findings[0].receipts[1]] };
  report.codePass.findings[0] = { ...report.codePass.findings[0], anchorSha256: 'f'.repeat(64),
    trace: report.codePass.findings[0].trace.map((t) => ({ ...t, sha256: 'e'.repeat(64) })) };
  const model = reportModel(session, report, repoFacts());
  const claim = one(model, 'claim_contradicted');
  assert.equal(claim.quote, null);
  assert.equal(claim.quoteMissing, true);
  assert.equal(JSON.stringify(model).includes('Redis everywhere'), false);
  const bug = itemsOf(model).find((item) => textOf(item.what.parts) === 'The bucket refills before the first request');
  assert.equal(bug.where[0].excerpt, null, 'the stored hash differs from the file\'s');
  // With the hashes as stored, the excerpt shows the anchor's lines, the changed ones marked.
  const good = modelOf(triagedReport);
  const shown = itemsOf(good).find((item) => textOf(item.what.parts) === 'The bucket refills before the first request');
  assert.deepEqual(shown.where[0].excerpt.lines, [{ n: 2, text: '  let tokens = rate;', changed: true },
    { n: 3, text: '  refill();', changed: true }]);
  assert.ok(firstScreenExcerptLines(good) <= REPORT_LIMITS.excerptLines);
});

test('D97 (10): permalinkOf builds a GitHub link only from validated facts, and says why when it gives none', () => {
  const facts = repoFacts();
  const at = { path: 'src/limiter.js', side: 'new', startLine: 2, endLine: 3 };
  assert.deepEqual(permalinkOf(facts, at), { url: `https://github.com/example-org/example-api/blob/${HEAD}/src/limiter.js#L2-L3`,
    reason: null });
  // A range past 8 lines is cut to 8; one line is #Ln; no line gives no anchor.
  assert.match(permalinkOf(facts, { ...at, endLine: 40 }).url, /#L2-L9$/);
  assert.match(permalinkOf(facts, { ...at, endLine: 2 }).url, /#L2$/);
  assert.match(permalinkOf(facts, { path: 'src/limiter.js' }).url, /\/src\/limiter\.js$/);
  // The old side links the start commit, only when it is pushed.
  assert.match(permalinkOf(facts, { ...at, side: 'old' }).url, new RegExp(`/blob/${START}/`));
  assert.deepEqual(permalinkOf(repoFacts({ github: { startPushed: false } }), { ...at, side: 'old' }),
    { url: null, reason: 'unpushed' });
  // A prefix and a path with spaces are encoded segment by segment.
  assert.match(permalinkOf(repoFacts({ repo: { prefix: 'packages/app', atHead: ['src/my file.js'] } }),
    { path: 'src/my file.js', side: 'new', startLine: 1 }).url, /\/blob\/1{40}\/packages\/app\/src\/my%20file\.js#L1$/);
  // No link: not at HEAD, not pushed, no GitHub remote, no facts at all.
  assert.deepEqual(permalinkOf(repoFacts({ repo: { atHead: [] } }), at), { url: null, reason: 'uncommitted' });
  assert.deepEqual(permalinkOf(repoFacts({ github: { pushed: false } }), at), { url: null, reason: 'unpushed' });
  assert.deepEqual(permalinkOf({ ...facts, github: null }, at), { url: null, reason: 'remote' });
  assert.deepEqual(permalinkOf({}, at), { url: null, reason: null });
  assert.deepEqual(permalinkOf(undefined, at), { url: null, reason: null });
  // Invalid facts fail closed.
  for (const bad of [repoFacts({ github: { owner: 'evil/../x' } }), repoFacts({ github: { repo: 'a b' } }),
    repoFacts({ github: { owner: '..' } }), repoFacts({ repo: { head: 'HEAD' } }), repoFacts({ repo: { head: 'abc123' } }),
    repoFacts({ repo: { prefix: '../outside' } }), repoFacts({ repo: { prefix: '/abs' } })])
    assert.equal(permalinkOf(bad, at).url, null, JSON.stringify(bad));
  for (const path of ['../etc/passwd', 'src/../../x.js', '/etc/passwd', ''])
    assert.equal(permalinkOf(repoFacts({ repo: { atHead: [path] } }), { ...at, path }).url, null, path);
  // The old side reads no HEAD list: its path is checked on its own.
  for (const path of ['../etc/passwd', 'src/../../x.js', '/etc/passwd', 'src//x.js'])
    assert.equal(permalinkOf(facts, { ...at, side: 'old', path }).url, null, `old ${path}`);
  // An apostrophe is encoded like every other character a link never holds as is.
  assert.match(permalinkOf(repoFacts({ repo: { atHead: ["src/it's.js"] } }), { ...at, path: "src/it's.js" }).url,
    /\/src\/it%27s\.js#L2-L3$/);
});

test('D97 (11): no fixed word of the report holds a verdict word', () => {
  const VERDICT = /\b(?:approve|approval|LGTM|safe|clean|ready to merge|looks good|score|confidence)\b/i;
  const strings = [];
  const walk = (value) => {
    if (typeof value === 'string') strings.push(value);
    else if (typeof value === 'function') {
      for (const args of [[1, 'x', 'y'], [2, 'x', 'y']]) { try { walk(value(...args)); } catch { /* not this shape */ } }
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const [name, table] of Object.entries(words)) if (!name.startsWith('STYLE_')) walk(table);
  assert.ok(strings.length > 200);
  assert.deepEqual(strings.filter((s) => VERDICT.test(s)), []);
});

test('D97 (12): the same inputs give the same model; the report and the session are only read', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const before = JSON.stringify(report);
  const first = JSON.stringify(reportModel(session, report, repoFacts()));
  const second = JSON.stringify(reportModel(session, report, repoFacts()));
  assert.equal(first, second);
  assert.equal(JSON.stringify(report), before);
  assert.equal(Object.isFrozen(report), false);
  assert.equal(Object.isFrozen(report.requirements[0]), false, 'the model freezes its own objects only');
  assert.ok(Object.isFrozen(reportModel(session, report, repoFacts()).tiers.must_act[0]));
  assert.equal(reportModel(session, report, repoFacts()).version, REPORT_MODEL_VERSION);
});

test('D97 (15): the first screen of a review shaped like the research sketch, counted by wc -w rules', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Add rate limiting to the public API. 100 requests per minute per API key. Return 429 with a Retry-After '
    + 'header. Add tests and make sure nothing else breaks. Don\'t touch the billing service.');
  b.change('W1', 'src/middleware/rateLimit.ts', { after: 'export const limit = 100;\nres.setHeader("Retry-After", ms);\n' });
  b.run('R1', 'npm test -- rateLimit', 'succeeded', '4 passed');
  b.say('F1', 'All tests pass.', 'final');
  const session = b.session();
  const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
  const ask = (quote, status, extra = {}) => ({ text: quote, instruction: r('instruction', 'I1', quote), status, ...extra });
  const text = 'export const limit = 100;\nres.setHeader("Retry-After", ms);\n';
  const report = { coverage: 'complete', sessionReview: 'complete', windowResults: [{ windowIndex: 0,
    eventIds: session.events.map((e) => e.id), failure: null, challenge: { complete: true }, groundingComplete: true }],
    requirements: [ask('Add rate limiting to the public API', 'done', { deliverable: r('code', 'W1', 'export const limit = 100;') }),
      ask('100 requests per minute per API key', 'partly-done', { deliverable: r('code', 'W1', 'export const limit = 100;') }),
      ask('Return 429 with a Retry-After header', 'done', { deliverable: r('code', 'W1', 'res.setHeader("Retry-After", ms);') }),
      ask('Add tests', 'done', { deliverable: r('observation', 'R1-r', '4 passed') }),
      ask('make sure nothing else breaks', 'not-checked', { reason: 'deliverable_ungrounded' }),
      ask('Don\'t touch the billing service', 'done', { deliverable: r('commentary', 'F1', 'All tests pass.') })],
    codePass: { ran: true, base: { kind: 'git', commit: START }, coverage: 'complete',
      files: [{ path: 'src/middleware/rateLimit.ts', type: 'added', state: 'shown', sha256: '3'.repeat(64), added: 2,
        removed: 0 }],
      findings: [{ id: `sha256:${'9'.repeat(64)}`, kind: 'bug', title: 'Retry-After gives the wait in milliseconds',
        anchor: { path: 'src/middleware/rateLimit.ts', side: 'new', startLine: 2, endLine: 2 },
        anchorSpan: { startLine: 2, lines: ['res.setHeader("Retry-After", ms);'], linesCut: 0, charsCut: 0 },
        anchorSha256: '3'.repeat(64), anchorChanged: [2],
        leadsFrom: [{ source: 'requirements', index: 2 }], trace: [], claims: [], check: { verdict: 'holds' } }],
      questions: [], withheld: [], footer: [],
      triage: [{ ref: { finding: `sha256:${'9'.repeat(64)}` }, level: 'high',
        impact: 'A client that obeys the header can stop calling your API for up to 17 hours.',
        action: 'Send the wait time in whole seconds.', label: 'fix the Retry-After unit', where: null }] } };
  const model = reportModel(session, report, {});
  const screen = `${openText(model)}\n${itemVisibleText(model.tiers.must_act[0])}`;
  // The text, as a reader sees it (the words the count is pinned to, read and counted by hand).
  assert.equal(screen, [
    '“Add rate limiting to the public API.”',
    // D109 (its review): the code step's counts are the change's, never what the recording changed.
    'Claude Code recording · a change of 1 file, +2 −0 · 1 command',
    'After its last edit, the agent ran 1 command. Results: 1 exited with code 0.',
    'Must act 2 · Must know 0 · Good to know 0 (folded) · Your prompt: 4 done, 1 partly done, 1 not checked',
    'Must act: fix the Retry-After unit · ask 2',
    'Your prompt (6 asks: 4 done, 1 partly done, 1 not checked)',
    'Done Add rate limiting to the public API. Partly done 100 requests per minute per API key. Done Return 429 with a '
      + 'Retry-After header. Done Add tests and Not checked make sure nothing else breaks. Done Don\'t touch the billing '
      + 'service.',
    'ask 2 · Partly done · See item 2.',
    // D133 (R2): why ask 5 is not checked, and what the session review cited for ask 6, are in each row's own fold.
    'ask 5 · Not checked · Evidence',
    'ask 6 · Done · Evidence',
    // Item 1 is the bug that the code review rated high: inside a section, by final level first (D112), then by kind.
    '1 Fix: Retry-After gives the wait in milliseconds',
    'Impact on you: A client that obeys the header can stop calling your API for up to 17 hours.',
    'Action: Send the wait time in whole seconds.',
    'Where: src/middleware/rateLimit.ts:2 · ask 3',
  ].join('\n'));
  // 7 + 14 + 15 + 19 + 24 + 9 + 12 + 41 + 9 + 9 + 22 + 22 + 8 + 19 + 8 + 5 words, line by line, by `wc -w` (D100: the
  // line of an ask that rests only on the agent's words says what the session review cited, five words more; D109's
  // review: "a change of 1 file", two words more; D112: the first item is the bug with its impact and action, 18 words
  // more than the partly done ask; D115: the header names what the session review cited, three words more, and the
  // ask's line says only that, two words fewer). D131 (R1, B12): Must act comes before your prompt, so the first screen is
  // the header and the count line (7 + 14 + 15 + 19 + 24 + 9) and the first item (8 + 19 + 8 + 5): 128 words, 115 fewer.
  // D133 (R2): the header's "Sonah did not check" line (19 words) is folded: 109.
  assert.equal(firstScreenWords(model), 109);
  assert.equal(firstScreenExcerptLines(model), 1);
  // The bug carries the code review's impact and action, and one excerpt of at most 8 lines.
  assert.equal(model.tiers.must_act[0].where[0].excerpt.lines.length, 1);
  // The partly done ask, item 2, has no level: it follows.
  assert.equal(itemVisibleText(model.tiers.must_act[1]), ['2 Fix: The agent did only part of ask 2.',
    '“100 requests per minute per API key”', 'Where: ask 2 · src/middleware/rateLimit.ts'].join('\n'));
});

test('D97 (16): the marked prompt wraps exactly the located spans; an overlap and an unlocated ask are said', () => {
  const model = modelOf(triagedReport);
  const [first] = model.prompt.messages;
  const marked = first.segments.filter((s) => s.ask).map((s) => [s.ask, s.text]);
  assert.deepEqual(marked, [[1, 'Add rate limiting to the API'], [2, 'Return 429 with a Retry-After header in seconds'],
    [3, 'Keep the auth checks before the limiter'], [4, 'Do not change the CI config'], [5, 'Update the README']]);
  assert.equal(first.segments.map((s) => s.text).join(''), REPORT_TEXT.ask1, 'the whole message, in order');
  // D133 (R2): the coverage sentence is said once, in the page's legend, never under each message.
  assert.equal(openText(model).split('\n').filter((l) => l === words.REPORT_PROMPT_WORDS.coverage).length, 0);
  // An ask that overlaps an earlier one keeps only what the earlier one leaves, and says so.
  const b = sessionBuilder();
  b.ask('I1', 'Make the button blue and large.');
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const r = (quote) => ({ role: 'instruction', eventId: 'I1', quote, sessionKey: STORY_KEY });
  const overlap = reportModel(session, { windowResults: [{ windowIndex: 0, eventIds: ['I1', 'F1'], failure: null }],
    requirements: [{ text: 'Make the button blue', instruction: r('Make the button blue'), status: 'done' },
      { text: 'the button blue and large', instruction: r('the button blue and large'), status: 'not-checked' },
      { text: 'Use the brand colour', instruction: { role: 'instruction', eventId: 'I1', quote: 'Use the brand colour' },
        status: 'not-checked' }] }, {});
  const segs = overlap.prompt.messages[0].segments;
  assert.deepEqual(segs.filter((s) => s.ask).map((s) => [s.ask, s.text]), [[1, 'Make the button blue'], [2, ' and large']]);
  assert.deepEqual(overlap.prompt.asks[1].lines.map(textOf)[0], 'Overlaps ask 1.');
  // The unlocated ask is listed after the message, in the session review's words.
  assert.deepEqual(overlap.prompt.messages[0].unlocated, [3]);
  assert.deepEqual(overlap.prompt.asks[2].words.map((p) => [p.text, p.by]), [['Use the brand colour', 'session-review']]);
});

test('D97 (17): the refused-call ceiling reads the recorder\'s denial kind; your own refusal sets none', () => {
  const model = modelOf(triagedReport);
  const decision = (dimension) => itemsOf(model).find((item) => item.kind === 'decision_unasked'
    && textOf(item.what.parts).includes(dimension));
  // A permission rule and auto mode: a high proposal is capped at Must know.
  for (const chosen of ['clean dist', 'call the deploy hook']) {
    const item = decision(chosen);
    assert.deepEqual([item.tier.proposed, item.tier.final, item.tier.bound], ['must_act', 'must_know', 'refused_call_ceiling']);
  }
  // You refused it yourself (user-rejected): the high proposal stands, Must act.
  const yours = decision('push the branch');
  assert.deepEqual([yours.tier.final, yours.tier.bound], ['must_act', null]);
  assert.equal(PERMISSION_DENIALS.includes('user-rejected'), false);
  const session = reportSession();
  assert.equal(refusedCall(session, { actions: ['X3'] }), false);
  assert.equal(refusedCall(session, { actions: ['X2'] }), true);
  assert.equal(refusedCall(session, { actions: ['X4'] }), true);
  assert.equal(refusedCall(session, { eventId: 'X1-r', action: 'X1', handling: 'passed-over' }), true);
  assert.equal(refusedCall(session, { eventId: 'R1-r', action: 'R1', handling: 'passed-over' }), false);
});

test('D97 (18): an undone or disclosed edit says which; a refused read names its tool and class, never "a command"', () => {
  const model = modelOf(triagedReport);
  const undone = byKind(model, 'edit_undone').map((item) => textOf(item.what.parts));
  assert.deepEqual(undone, ['The agent acted against something that you said. The agent told you about it.',
    'The agent acted against something that you said. The agent undid it in the same turn.']);
  const disclosed = byKind(model, 'edit_undone')[0];
  assert.ok(disclosed.evidence.some((e) => e.label === 'The agent told you:'
    && textOf(e.parts) === '“I told you that I changed the CI file.”'));
  const failures = byKind(model, 'failure_passed_over');
  const read = failures.find((item) => item.what.parts.some((p) => p.code && p.text === 'read'));
  // R15: who refused it in words, only as far as the recording types it; never the raw denial token.
  assert.equal(textOf(read.what.parts),
    'A read call did not run: a permission rule refused it. The agent did not act on it or tell you.');
  assert.equal(read.what.parts.some((p) => p.text === 'permission-rule'), false);
  for (const item of failures) assert.equal(/command failed/i.test(textOf(item.what.parts)), false);
  const bash = failures.find((item) => item !== read);
  assert.equal(textOf(bash.what.parts), 'A bash call failed. The agent did not act on it or tell you.');
  assert.deepEqual(bash.quote, { text: 'npm test', by: 'sonah', code: true, quote: false, cut: false, href: null });
});

test('D97 (19): the D93 split — a done ask with a code finding is counted apart; line-only links give a line each', () => {
  const model = modelOf(triagedReport);
  assert.deepEqual(model.prompt.parts, ['1 done', '1 done with a code finding', '1 partly done', '2 not done',
    '1 not checked']);
  assert.equal(model.countLine.prompt, 'Your prompt: 1 done, 1 done with a code finding, 1 partly done, 2 not done, '
    + '1 not checked');
  const bug = itemsOf(model).find((item) => textOf(item.what.parts) === 'The bucket refills before the first request');
  const done = model.prompt.asks[0];
  assert.deepEqual([done.status, done.state], ['Done', 'doneCode']);
  assert.deepEqual(done.lines.map(textOf), [`The code review found a problem here. See item ${bug.n}.`]);
  const notChecked = model.prompt.asks[4];
  const question = itemsOf(model).find((item) => item.kind === 'code_question' && textOf(item.what.parts)
    === 'Is a 429 body needed?');
  // D101: the ask the quote gate lowered says which test refused its quote, with code's numbers. D116: the question
  // whose key names this ask names no place (its quote is null), so no code checked the tie: no line names it.
  // D133 (R2): the reason is in the row's own fold (`folded`).
  assert.deepEqual(notChecked.lines.map(textOf), [
    'Sonah withheld a finding of the code review about this ask: its check refuted it: it misreads the code. See the '
      + 'section What Sonah could not check.']);
  assert.deepEqual(notChecked.folded.map(textOf), [
    'The session review quoted 134 characters, more than the 120 that Sonah checks, so Sonah did not check it.']);
  assert.ok(question, 'the question is still an item of its own');
  // The agent's own word for a done ask is a fact line, counted in "Sonah did not check". D133 (R2): in its row's fold.
  assert.deepEqual(model.prompt.asks[2].lines.map(textOf), []);
  assert.deepEqual(model.prompt.asks[2].folded.map(textOf), [words.REPORT_PROMPT_WORDS.agentOnly]);
});

test('D97 (20): code-pass/3 questions are Good to know items with no row id; no shown-in-code check is shown; code_issue', () => {
  const d = modelOf(codePass3Report);
  const question = one(d, 'code_question');
  assert.deepEqual([question.tier.final, question.rowId], ['good_to_know', null]);
  assert.equal(JSON.stringify(d).includes('shown-in-code'), false);
  assert.equal(/shown in (?:the )?code/i.test(JSON.stringify(d)), false);
  const f = modelOf(codePass1Report);
  const legacy = byKind(f, 'code_finding_legacy');
  assert.ok(legacy.some((item) => textOf(item.what.parts) === 'A code issue' && item.rows[0].source === 'codePass.findings'));
  assert.equal(legacy.find((item) => item.rows[0].source === 'codePass.findings').type, 'read');
});

test('D97 (21): line C names every result class; the runs map every class and form; two counts never merge', () => {
  assert.deepEqual(Object.keys(words.REPORT_OUTCOME_WORDS).sort(), Object.keys(RESULT_OUTCOME_WORDS).sort());
  for (const cls of Object.keys(RESULT_OUTCOME_WORDS))
    assert.deepEqual(Object.keys(words.REPORT_OUTCOME_WORDS[cls]).sort(), Object.keys(RESULT_OUTCOME_WORDS[cls]).sort(), cls);
  // D99 (F1 guard): and one part for a run stopped before it finished, said apart from one with no recorded end. D100:
  // and one for a run Sonah read no result of, said as what Sonah found.
  assert.deepEqual(Object.keys(words.REPORT_RESULT_PARTS).sort(), [...RESULT_OUTCOME_CLASSES, 'stopped', 'no-result']
    .sort());
  assert.equal(words.REPORT_OUTCOME_WORDS['output-no-status'].unread().includes('no result recorded'), false);
  assert.equal(words.REPORT_OUTCOME_WORDS['output-no-status'].output().includes('no result recorded'), false);
  // One command of each of the seven classes after the last edit.
  const b = sessionBuilder();
  b.ask('I1', 'Change it.');
  b.change('W1', 'src/a.js', { after: 'a\n' });
  const push = (id, recorded, observation) => {
    b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'bash', operation: 'command',
      paths: [], command: [], input: [], changes: [], ...(recorded ? { recorded } : {}),
      ...(observation === 'refusalUntyped' ? { refusalUntyped: true } : {}) });
    if (observation && observation !== 'refusalUntyped' || observation === 'refusalUntyped')
      b.events.push({ sequence: b.events.length, id: `${id}-r`, kind: 'observation', invocation: id, callKey: id,
        phase: 'terminal', sourceOfResult: 'native', output: [], ...(observation === 'refusalUntyped'
          ? { result: 'failed', exitCode: null, terminalStatusProven: false } : observation) });
  };
  push('E0', null, { result: 'succeeded', exitCode: 0, terminalStatusProven: true });
  push('E1', null, { result: 'succeeded', exitCode: null, terminalStatusProven: true });
  push('E2', null, { result: 'failed', exitCode: 2, terminalStatusProven: true });
  push('E3', null, 'refusalUntyped');
  push('E4', { denial: 'permission-rule' }, { result: 'failed', exitCode: null, terminalStatusProven: false });
  push('E5', { backgroundTaskId: 'job' }, { result: 'unknown', exitCode: null, terminalStatusProven: false });
  push('E6', null, { result: 'unknown', exitCode: null, terminalStatusProven: false });
  const session = b.session();
  const model = reportModel(session, { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }] }, {});
  // A command refused before it ran is never counted as one the agent ran: it is said apart (R5). Nor is one the
  // recording cannot tell failed from refused: "the agent ran 6 commands. Results: … 1 failed or the harness refused it"
  // counted as run a command that may never have run.
  // D133 (R2): the parts that say what Sonah could not read of a run are said in What Sonah could not check, each with
  // its count; the header keeps how the runs ended.
  assert.ok(model.notChecked.quiet.includes('Results: 1 completed with no exit code that Sonah read, for 1 Sonah read no '
    + 'exit code.'));
  assert.deepEqual(model.header.runs, ['After its last edit, the agent ran 5 commands.',
    'Results: 1 exited with code 0, 1 failed, 1 has no recorded end.',
    'After the agent\'s last edit, 1 command failed or the harness refused it. The recorder does not mark which.',
    'The recording shows 1 command after the agent\'s last edit as refused before it ran.']);
  // Before the last edit, an exit-0 run is counted apart from what a cap cuts.
  const many = sessionBuilder();
  many.ask('I1', 'Change it.');
  for (let k = 0; k < 45; k++) many.run(`F${k}`, `false ${k}`, 'failed', 'no');
  for (let k = 0; k < 3; k++) many.run(`P${k}`, `true ${k}`, 'succeeded', 'ok');
  many.change('W1', 'src/a.js', { after: 'a\n' });
  const s2 = many.session();
  const m2 = reportModel(s2, { windowResults: [{ windowIndex: 0, eventIds: s2.events.map((e) => e.id), failure: null }] }, {});
  assert.equal(m2.did.runs.shown.length, 40);
  assert.deepEqual([m2.did.runs.quietExit0, m2.did.runs.cut], [3, 5]);
  assert.deepEqual(m2.did.runs.cutParts, ['5 failed']);
});

test('D97 (22): header line B — a deleted file HEAD lacks is committed, outside_root is left out, no facts no commit', () => {
  const session = reportSession();
  const report = codePass8Report(session);
  // Every counted file has a hash at HEAD but the deleted one, which HEAD does not hold: committed.
  const atHead = report.codePass.files.filter((f) => f.sha256).map((f) => f.path);
  const facts = repoFacts({ repo: { atHead, goneAtHead: ['src/old.js'] } });
  const model = reportModel(session, report, facts);
  assert.equal(model.header.size.at(-1), `commit ${HEAD.slice(0, 7)}`);
  const differ = reportModel(session, report, repoFacts({ repo: { atHead: atHead.slice(1), goneAtHead: ['src/old.js'] } }));
  assert.equal(differ.header.size.at(-1), '1 changed file differs from the last commit.');
  const noFacts = reportModel(session, report, {});
  assert.equal(noFacts.header.size.some((part) => /commit/.test(part)), false);
  const repoNull = reportModel(session, report, { ...facts, repo: null });
  assert.equal(repoNull.header.size.some((part) => /commit/.test(part)), false);
  // A counted file with no hash that is not deleted: Sonah cannot tell, so no commit fact.
  const unknown = codePass8Report(session);
  unknown.codePass.files[0] = { ...unknown.codePass.files[0] };
  delete unknown.codePass.files[0].sha256;
  assert.equal(reportModel(session, unknown, facts).header.size.some((part) => /commit/.test(part)), false);
  // Line B's counts: the code step's +/- counts when every counted file has both, said as the change's (D109's review:
  // with git it runs from the start commit to the files as they are now, so never what the recording changed), else the
  // recorded edits'.
  const counted = triagedReport(session);
  counted.codePass.files[0] = { ...counted.codePass.files[0], added: 20 };
  assert.equal(reportModel(session, counted, facts).header.size[1], 'a change of 5 files, +24 −2', 'the code step\'s counts');
  const partial = triagedReport(session);
  partial.codePass.files[0] = { ...partial.codePass.files[0], added: 20 };
  delete partial.codePass.files[1].removed;
  // D118 (c): the one list the Files section counts (with a git base, git's): its count, and no lines when the code
  // step does not hold every file's (the recorded edits' lines are not the change's).
  const partialModel = reportModel(session, partial, facts);
  assert.equal(partialModel.header.size[1], 'a change of 5 files', 'the one list, with no lines');
  assert.equal(partialModel.header.changeFiles, partialModel.did.files.total);
});

test('D97 (23): who said what — the code review\'s and the session review\'s words are set apart; the title is yours', () => {
  const model = modelOf(triagedReport);
  const bug = itemsOf(model).find((item) => textOf(item.what.parts) === 'The bucket refills before the first request');
  assert.deepEqual(bug.what.parts.map((p) => p.by), ['code-review']);
  assert.deepEqual(bug.label.map((p) => [p.text, p.by]), [['fix the refill order', 'code-review']]);
  // D112: the Must act items the code review rated come first, so the count line shows their labels first; D138: then
  // the contradicted claim, backed by two recorded quotes that disagree, before the asks. D161: the decision the code
  // review rated high is in the report's second part, so the count line's labels are the first part's alone.
  assert.deepEqual(model.countLine.labels.map((l) => l.parts.map((p) => [p.text, p.by])), [
    [['fix the refill order', 'code-review']], [['a false claim', 'sonah'], [' ', 'sonah'], ['(item 2)', 'sonah']],
    [['an edit against your words', 'sonah'], [' ', 'sonah'], ['(item 3)', 'sonah']]]);
  const question = one(model, 'code_question');
  assert.equal(question.what.parts[0].by, 'code-review');
  const file = model.did.files.groups.flatMap((g) => g.files).find((f) => f.path === 'src/limiter.js');
  assert.deepEqual(file.what.map((p) => [p.text, p.by]), [['adds a token bucket limiter', 'code-review']]);
  const chose = one(model, 'decision_chose');
  assert.deepEqual(chose.what.parts.filter((p) => p.by === 'session-review').map((p) => p.text),
    ['Retry-After unit', 'seconds']);
  assert.deepEqual(model.footer.legend, ['Text in quotation marks is word for word from the recording.',
    "Titles, questions, labels and file notes in italics are the code review's words.",
    "Words in italics inside Sonah's sentences are the session review's words."]);
  assert.deepEqual({ ...model.header.title, parts: textOf(model.header.title.parts) }, { text: 'Add rate limiting to the API.',
    parts: '“Add rate limiting to the API.”', quoted: true, cut: false });
  // A long first sentence is cut at a word, the cut outside the quotation marks; a caller's title is plain.
  const b = sessionBuilder();
  b.ask('I1', `Please ${'carefully '.repeat(12)}rename the helper.`);
  const session = b.session();
  const long = reportModel(session, { requirements: [{ text: 'rename the helper', status: 'not-checked',
    instruction: { role: 'instruction', eventId: 'I1', quote: 'rename the helper', sessionKey: STORY_KEY } }] }, {});
  assert.equal(long.header.title.cut, true);
  assert.ok([...long.header.title.text].length <= REPORT_LIMITS.titleChars && !long.header.title.text.endsWith(' '));
  assert.equal(textOf(long.header.title.parts), `“${long.header.title.text}”…`);
  const given = reportModel(session, {}, { title: 'Rate limits' }).header.title;
  assert.deepEqual([given.text, given.quoted, given.cut, given.parts.map((p) => [p.text, p.by, p.quote])],
    ['Rate limits', false, false, [['Rate limits', 'sonah', false]]]);
  assert.match(model.footer.provenance, /^Sonah 0\.9\.0 · sonah\.report-model\/8 · commit 1111111$/);
});

test('D97 (1): the triage contract\'s fixture (a) gives every item kind but two left listed, and every bound', async () => {
  const { triageReport, triageSession } = await import('../../evidence/test/report-triage-fixture.js');
  const session = triageSession();
  const model = reportModel(session, triageReport(session), {});
  const items = itemsOf(model);
  // Every kind is an item but the listed ones the code review did not raise, which stay in the claims list.
  // And (D110) a finding to verify, and (D152) an open finding: fixture (a) is a code step before the premise contract
  // and the tie rule; and (D153) the four kinds of a review run with the after-point re-check.
  assert.deepEqual(REPORT_ITEM_KINDS.filter((kind) => !items.some((item) => item.kind === kind)),
    ['ask_not_checked_after_later_work', 'claim_not_checked_after_later_work', 'written_not_checked_after_later_work',
      'code_finding_open', 'code_finding_unconfirmed', 'written_corrected', 'claim_incomplete', 'written_not_checked']);
  assert.ok(items.some((item) => item.kind === 'claim_not_checked'), 'the listed claim proposed high is an item');
  assert.ok(Object.values(model.placement.rows).filter((p) => p.list === 'claims').length >= 2);
  const bounds = new Set(items.map((item) => item.tier.bound).filter(Boolean));
  // Every bound is a member of the closed list (ledger.js TIER_BOUND_REASONS); fixture (a) gives all but D161's
  // untied-question ceiling (its questions name no tie and no level that the ceiling would lower).
  assert.ok([...bounds].every((b) => TIER_BOUND_REASONS.includes(b)));
  assert.deepEqual([...bounds].sort(), TIER_BOUND_REASONS.filter((b) => b !== 'untied_ceiling').sort());
  // Only the primary row's entry of a merged item is used: the folded ask's "SYNTHETIC" entry is not shown.
  assert.equal(JSON.stringify(model.tiers).includes('SYNTHETIC an entry for a folded row'), false);
});

/** A session whose messages are held in several recorded spans, or in none (a pasted image only). */
function spannedSession() {
  const b = sessionBuilder();
  // Message 1 holds the ask; its first sentence runs over a gap in the recording.
  b.ask('I1', 'Please rename');
  b.blobs.extra1 = 'the helper. Then run the tests.';
  b.events.at(-1).text.push({ sourceKey: 'extra1', fromByte: 0, untilByte: Buffer.byteLength(b.blobs.extra1) });
  // Message 2 holds no ask, in two spans; message 3 holds no ask and no words at all.
  b.ask('I2', 'First half of the note.');
  b.blobs.extra2 = 'Second half of it.';
  b.events.at(-1).text.push({ sourceKey: 'extra2', fromByte: 0, untilByte: Buffer.byteLength(b.blobs.extra2) });
  b.ask('I3', '');
  b.events.at(-1).nonText = [{ type: 'image' }];
  return b.session();
}
const spannedReport = (session) => ({ windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
  failure: null }], requirements: [{ text: 'rename the helper', status: 'not-checked',
  instruction: { role: 'instruction', eventId: 'I1', quote: 'the helper', sessionKey: STORY_KEY } }] });

test('D69 f (g) finding 14, ported (D97): the title and the messages with no ask are read from their recorded spans', () => {
  const session = spannedSession();
  const model = reportModel(session, spannedReport(session), {});
  // The title runs over the gap: each span a quote of its own, Sonah's join outside the marks.
  assert.deepEqual(model.header.title.parts.map((p) => [p.text, p.quote]), [['Please rename', true], [' … ', false],
    ['the helper.', true]]);
  assert.equal(model.header.title.text, 'Please rename … the helper.');
  // A message with no ask: its spans as recorded, the join Sonah's; one with no words: the fixed sentence, Sonah's.
  const [two, three] = model.prompt.emptyMessages;
  assert.deepEqual(two.segments, [{ text: 'First half of the note.' }, { text: ' … ', join: true },
    { text: 'Second half of it.' }]);
  assert.deepEqual(three.segments, [{ text: words.REPORT_PROMPT_WORDS.withheldMessage, sonah: true }]);
  assert.equal(JSON.stringify(model).includes(STORY_SENTENCES.withheldAsk), false, 'storyFacts\' joined text is never read');
  // No quote part anywhere holds Sonah's join or its sentence for a message with no words.
  const parts = [];
  const walk = (value) => { if (value && typeof value === 'object') { if (value.quote === true) parts.push(value);
    Object.values(value).forEach(walk); } };
  walk(model);
  assert.ok(parts.length > 0);
  for (const p of parts) assert.ok(!p.text.includes(' … ') && !p.text.includes(STORY_SENTENCES.withheldAsk), p.text);
  // A message with no recorded words gives no title, never Sonah's sentence in quotation marks.
  const b = sessionBuilder();
  b.ask('I1', '');
  b.events.at(-1).nonText = [{ type: 'image' }];
  const image = b.session();
  const none = reportModel(image, { windowResults: [{ windowIndex: 0, eventIds: ['I1'], failure: null }],
    requirements: [{ text: 'fix the layout in the screenshot', status: 'not-checked',
      instruction: { role: 'instruction', eventId: 'I1', quote: 'fix the layout', sessionKey: STORY_KEY } }] }, {});
  assert.equal(none.prompt.messages.length, 1, 'premise: the message holds an ask');
  assert.equal(none.header.title, null);
});

test('D97: a code review\'s trace quote is code under its side\'s label, never a quote of the recording', () => {
  const model = modelOf(triagedReport);
  const findings = itemsOf(model).filter((item) => item.rows[0].source === 'codePass.findings');
  const lines = findings.flatMap((item) => item.evidence);
  const code = lines.filter((e) => [words.REPORT_ITEM_WORDS.codeNow, words.REPORT_ITEM_WORDS.codeBefore].includes(e.label));
  assert.ok(code.length >= 5, 'every trace step on the code');
  for (const e of code) assert.ok(e.parts.every((p) => !p.quote) && e.parts.some((p) => p.code), textOf(e.parts));
  assert.ok(code.some((e) => textOf(e.parts) === 'src/limiter.js:3 refill();'));
  // A trace step's own words stay the code review's; a session step's quote stays a quote of the recording.
  for (const e of lines.filter((x) => x.label === words.REPORT_ITEM_WORDS.trace))
    assert.ok(e.parts.every((p) => !p.quote || p.by === 'sonah'));
});

test('D97: a place inside another place of the same item and file is not named again; the outer place stays', () => {
  // Fixture (a)'s refill finding: its anchor is lines 2-3, and its triage place line 3 of the same file.
  const model = modelOf(triagedReport);
  const bug = itemsOf(model).find((item) => textOf(item.what.parts) === 'The bucket refills before the first request');
  assert.deepEqual(bug.where.map((w) => (w.anchor ? w.text : `${w.path}:${w.startLine}-${w.endLine}`)),
    ['src/limiter.js:2-3']);
  // A place on other lines of the file, or on the other side, stays.
  const session = reportSession();
  const report = triagedReport(session);
  report.codePass.triage[0] = { ...report.codePass.triage[0], where: { ...report.codePass.triage[0].where, startLine: 5,
    endLine: 5, quote: 'res.status(429)', span: REPORT_TEXT.limiter.split('\n')[4] } };
  const apart = itemsOf(reportModel(session, report, repoFacts()))
    .find((item) => textOf(item.what.parts) === 'The bucket refills before the first request');
  assert.deepEqual(apart.where.filter((w) => w.path).map((w) => [w.startLine, w.endLine]), [[2, 3], [5, 5]]);
  assert.deepEqual(apart.where.map((w) => w.excerpt !== null), [true, false], 'one excerpt an item, its first place\'s');
  // R7: a triage place that encloses the anchor is the place kept, and it keeps an excerpt of its own lines: the
  // anchor that held the excerpt is dropped, the code is not.
  const lines = REPORT_TEXT.limiter.split('\n');
  report.codePass.triage[0] = { ...report.codePass.triage[0], where: { ...report.codePass.triage[0].where, startLine: 1,
    endLine: 4, quote: 'refill();', span: lines.slice(0, 4).join('\n') } };
  for (const facts of [repoFacts(), repoFacts({ github: { pushed: false } })]) {
    const outer = itemsOf(reportModel(session, report, facts))
      .find((item) => textOf(item.what.parts) === 'The bucket refills before the first request');
    assert.deepEqual(outer.where.filter((w) => w.path).map((w) => [w.startLine, w.endLine]), [[1, 4]]);
    assert.deepEqual(outer.where[0].excerpt.lines.map((l) => [l.n, l.text]), lines.slice(0, 4).map((t, i) => [i + 1, t]));
  }
  // The .md, with no link (the commit is not on GitHub), shows the code as a fence.
  const md = renderReportMarkdown(session, report, repoFacts({ github: { pushed: false } }));
  assert.ok(md.includes(`Where: \`src/limiter.js:1-4\``), md);
  assert.ok(md.includes(`\`\`\`\n${lines.slice(0, 4).join('\n')}\n\`\`\``), 'the fence');
});

test('D97: a question of the code review shows whose words its quote is, by the quote\'s role', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const said = { role: 'commentary', eventId: 'F1', quote: 'all tests pass', sessionKey: STORY_KEY };
  // Q3 (on an ask) is an item of its own; Q1 (on a decision) is a member of the decision's item (D112), here where the
  // decision states the words it quotes (D112 amended: a place both name): both label it.
  for (const at of [2, 0]) {
    const asked = triagedReport(session);
    asked.codePass.questions[at] = { ...asked.codePass.questions[at], quote: said };
    if (at === 0) asked.decisions[3] = { ...asked.decisions[3], stated: said };
    const model = reportModel(session, asked, repoFacts());
    const holder = itemsOf(model).find((item) => [item, ...item.members].some((x) => x.kind === 'code_question' && x.quote));
    const question = [holder, ...holder.members].find((x) => x.kind === 'code_question' && x.quote);
    assert.equal(question === holder, at === 2, 'a question on an ask is its own item; one on a decision is a member');
    assert.equal(question.quoteLabel, words.REPORT_ITEM_WORDS.agentSaid);
    assert.ok(itemVisibleText(holder).includes('The agent said: “all tests pass”'));
    asked.codePass.questions[at] = { ...asked.codePass.questions[at], quote: { ...said, role: 'instruction', eventId: 'I1',
      quote: 'Update the README' } };
    const again = itemsOf(reportModel(session, asked, repoFacts())).flatMap((item) => [item, ...item.members])
      .find((x) => x.kind === 'code_question' && x.quote);
    assert.equal(again.quoteLabel, words.REPORT_ITEM_WORDS.youSaid);
  }
});

test('D97: a part of the session review with no id is named in words, never by an internal key', () => {
  const model = modelOf(triagedReport);
  // R12: an ask with no id that maps to no ask of your prompt is counted with no number: "its ask 7" was the session
  // review's own list index, which the prompt table numbers differently.
  // D115: the row has no text, a shape Sonah cannot read (session-story.js `readableRequirement`), so "could not read"
  // stays true of it.
  assert.deepEqual(model.notChecked.unreadAsks, ['Sonah could not read 1 ask of the session review.']);
  assert.equal(/\bask \d/.test(JSON.stringify(model.notChecked.unreadAsks)), false);
  // One with an id is named by it; the ones with none are counted after it.
  const session = reportSession();
  const report = triagedReport(session);
  report.requirements = [...report.requirements, { ...report.requirements[6], id: `sha256:${'c0ffee'.repeat(11)}` }];
  assert.deepEqual(reportModel(session, report, repoFacts()).notChecked.unreadAsks,
    ['Sonah could not read 2 asks of the session review: c0ffeec0ffee, 1 with no id.']);
  assert.equal(JSON.stringify(model.notChecked).includes('requirements:'), false);
  // Cut as every list is: 21 named ids are all shown (never "1 more"); of 22, 20 are shown and 2 counted.
  const named = (n) => {
    const r = triagedReport(session);
    r.requirements = [...r.requirements, ...Array.from({ length: n }, (_, k) => ({ ...r.requirements[6],
      id: `sha256:${String(k).padStart(2, '0')}${'ab'.repeat(5)}` }))];
    return reportModel(session, r, repoFacts()).notChecked.unreadAsks[0];
  };
  assert.equal(named(REPORT_LIMITS.unreadIds + 1).includes('more'), false, named(REPORT_LIMITS.unreadIds + 1));
  assert.ok(named(REPORT_LIMITS.unreadIds + 1).endsWith(`, ${REPORT_LIMITS.unreadIds}${'ab'.repeat(5)}, 1 with no id.`));
  assert.ok(named(REPORT_LIMITS.unreadIds + 2).endsWith(', and 2 more, 1 with no id.'), named(REPORT_LIMITS.unreadIds + 2));
  assert.equal(words.REPORT_NOT_CHECKED_WORDS.unreadRow(words.REPORT_NOT_CHECKED_WORDS.rowKinds.findings, 1),
    'its finding 1');
  // Every source set has its word.
  assert.deepEqual(Object.keys(words.REPORT_NOT_CHECKED_WORDS.rowKinds).sort(),
    ['codePass.findings', 'codePass.open', 'codePass.questions', 'codePass.unconfirmed', 'codePass.withheld',
      'decisions', 'failures', 'findings', 'pivots', 'promises', 'requirements', 'writtenClaims']);
});

test('D97: count-dependent words agree with their count', () => {
  const W = words;
  assert.equal(W.REPORT_ITEM_WORDS.checkedAgainst(1),
    'The session review checked it against 1 earlier message. It did not cover it.');
  assert.equal(W.REPORT_ITEM_WORDS.checkedAgainst(0, ['AGENTS.md']),
    'The session review checked it against the project instruction file AGENTS.md. It did not cover it.');
  assert.equal(W.REPORT_ITEM_WORDS.checkedAgainst(2),
    'The session review checked it against 2 earlier messages. None of them covered it.');
  assert.equal(W.REPORT_ITEM_WORDS.checkedAgainst(1, ['AGENTS.md']),
    'The session review checked it against 1 earlier message and the project instruction file AGENTS.md. None of them '
      + 'covered it.');
  // D100 (review of A1c): what Sonah could read, never what the recording does not show; D98: a stopped direct write too.
  assert.equal(W.REPORT_DID_WORDS.unconfirmed(1),
    'Sonah could not read whether 1 write happened: it stopped before it finished, or its command failed or stopped.');
  assert.equal(W.REPORT_DID_WORDS.unconfirmed(2),
    'Sonah could not read whether 2 writes happened: each stopped before it finished, or its command failed or stopped.');
  assert.equal(W.REPORT_DID_WORDS.runsCut(1, 2, '2 failed'), 'Sonah shows 1 run. It does not show 2 more: 2 failed.');
  assert.equal(W.REPORT_NOT_CHECKED_WORDS.encryptedMessages(1, false),
    'The recorder encrypted 1 message between agents, so Sonah cannot show it.');
  assert.equal(W.REPORT_NOT_CHECKED_WORDS.encryptedMessages(1, true),
    'The recorder encrypted at least 1 message between agents, so Sonah cannot show them.');
  assert.equal(W.REPORT_CAUSE_WORDS.windows_incomplete({ n: 1, m: 1 }), 'the session review did not finish 1 of its 1 part');
  assert.equal(W.REPORT_CAUSE_WORDS.input_limit({ n: 1 }),
    'the session review read 1 action and result pair in separate parts');
  assert.equal(W.REPORT_CAUSE_WORDS.input_limit({ n: 3 }),
    'the session review read 3 action and result pairs in separate parts');
});

test('D96 (as built): a triage entry kept without a text field shows the rest; its label falls back to the fixed one', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // The refill finding's entry, kept without its label (one word too many) and with its impact, action and level.
  report.codePass.triage[0] = { ...report.codePass.triage[0], label: null };
  report.codePass.triageDropped = [...report.codePass.triageDropped,
    { key: 'F1', index: 0, cause: 'text_over_limit', field: 'label' }];
  const model = reportModel(session, report, repoFacts());
  const bug = itemsOf(model).find((item) => textOf(item.what.parts) === 'The bucket refills before the first request');
  assert.equal(bug.tier.final, 'must_act');
  assert.equal(bug.tier.proposed, 'must_act', 'the level is kept');
  assert.equal(textOf(bug.impact), 'A burst of requests passes the limit at start.');
  assert.equal(textOf(bug.action), 'Refill the bucket after the first request.');
  assert.deepEqual(bug.label.map((p) => [p.text, p.by]), [['src/limiter.js:2', 'sonah'], [' ', 'sonah'],
    [`(item ${bug.n})`, 'sonah']]);
  // A field dropped alone is no note Sonah did not use: the count stays the one note of the fixture, and one sentence
  // says that a note was used only in part.
  const facts = model.notChecked.facts.filter((f) => f.group === 'code').map((f) => textOf(f.parts));
  assert.ok(facts.includes(words.REPORT_NOT_CHECKED_WORDS.triageDropped(1)), facts.join('\n'));
  assert.ok(facts.includes(words.REPORT_NOT_CHECKED_WORDS.triagePartly(1)), facts.join('\n'));
  assert.equal(words.REPORT_NOT_CHECKED_WORDS.triagePartly(1),
    'Sonah used 1 note of the code review only in part. Sonah left out each part that failed its checks.');
  assert.equal(modelOf(triagedReport).notChecked.facts.some((f) => textOf(f.parts).includes('only in part')), false);
});

test('D96 amended (owner decision 2026-10-16): "you asked, the agent decided how" is Good to know unless the code review is tied to it', () => {
  const chose = (model) => one(model, 'decision_chose');
  // Untied: Good to know, folded, still counted; its why says the default.
  const plainModel = modelOf(triagedReport);
  assert.equal(chose(plainModel).tier.final, 'good_to_know');
  // D161: in the report's second part, tagged Good to know.
  assert.ok(plainModel.decisions.groups.some((g) => g.items.includes(chose(plainModel))));
  assert.equal(plainModel.tiers.good_to_know.includes(chose(plainModel)), false);
  assert.equal(chose(plainModel).why, 'Sonah puts a decision on how to do your ask in Good to know by default.');
  // A published finding of the code review follows from it (`leadsFrom`): Must know, and its why says so.
  const session = reportSession();
  const report = triagedReport(session);
  report.codePass.findings[3] = { ...report.codePass.findings[3], leadsFrom: [{ key: 'S11', kind: 'decision',
    source: 'decisions', index: 2, id: report.decisions[2].id }] };
  const tiedModel = reportModel(session, report, repoFacts());
  const tied = chose(tiedModel);
  assert.deepEqual([tied.tier.default, tied.tier.final], ['must_know', 'must_know']);
  const contract = one(tiedModel, 'code_contract');
  assert.equal(tied.why, `Item ${contract.n} of the code review concerns it, so Sonah puts it in Must know.`);
  // A question of the code review concerns it where code checked the tie (D116's review): the same. The fixture's Q2,
  // routed from a finding, is anchored on a line of src/limiter.js, the file that the decision's edit wrote.
  const routed = triagedReport(session);
  routed.codePass.questions[1] = { ...routed.codePass.questions[1], concerns: { key: 'S11', kind: 'decision',
    source: 'decisions', index: 2, id: routed.decisions[2].id } };
  routed.codePass.triage.push({ ref: { question: 'Q2' }, level: 'medium', impact: 'A preflight uses up the limit.',
    action: 'Decide whether preflights count.', label: 'decide on preflights', where: null });
  const routedModel = reportModel(session, routed, repoFacts());
  const fromFinding = one(routedModel, 'code_question_finding');
  assert.equal(chose(routedModel).tier.final, 'must_know');
  assert.equal(chose(routedModel).why, `Item ${fromFinding.n} of the code review concerns it, so Sonah puts it in Must `
    + 'know.');
  // D112 amended, D116's review: a question that names no place (Q1, quote null) is an item of its own, and its key
  // ties nothing that code checked: the decision stays in Good to know, and no sentence names the question.
  const asked = triagedReport(session);
  asked.codePass.questions[0] = { ...asked.codePass.questions[0], concerns: { key: 'S11', kind: 'decision',
    source: 'decisions', index: 2, id: asked.decisions[2].id } };
  const askedModel = reportModel(session, asked, repoFacts());
  assert.deepEqual(chose(askedModel).members, []);
  assert.equal(chose(askedModel).tier.final, 'good_to_know');
  assert.equal(chose(askedModel).why, 'Sonah puts a decision on how to do your ask in Good to know by default.');
  // D112: a question that quotes the decision's own statement shares its place, so it is inside the decision's item,
  // and the why names no item number.
  asked.codePass.questions[0] = { ...asked.codePass.questions[0], quote: asked.decisions[2].stated };
  const insideModel = reportModel(session, asked, repoFacts());
  assert.equal(chose(insideModel).members[0].kind, 'code_question');
  assert.equal(chose(insideModel).why, words.REPORT_TIER_WHY.tiedHere('Must know'));
  // The code review's level still moves it, inside its bounds.
  const leveled = triagedReport(session);
  leveled.codePass.triage.push({ ref: { source: 'decisions', index: 2, id: leveled.decisions[2].id }, level: 'high',
    impact: 'The header unit may be wrong.', action: 'Check the header unit.', label: 'check the unit', where: null });
  assert.deepEqual(Object.values(chose(reportModel(session, leveled, repoFacts())).tier),
    ['good_to_know', 'must_act', 'must_act', null, 'lead']);
  // A decision made without asking and one not to act stay in Must know, tied or not.
  for (const kind of ['decision_unasked', 'decision_not_acting'])
    assert.ok(itemsOf(plainModel).some((item) => item.kind === kind && item.tier.final === 'must_know'), kind);
});

test('D97: a decision\'s what line names what it is about beside what the agent chose, for every decision kind', () => {
  // h4's only Must know item read "The agent decided not to act: Not changed; treated as a separate existing issue",
  // what it left alone folded under its evidence. The session review's dimension now stands in the line.
  const model = modelOf(triagedReport);
  const expect = { decision_not_acting: 'The agent decided not to act. About: store. Its decision: no Redis.',
    // D161: the first of the kind in the report's second part, in the order the session recorded them.
    decision_unasked: 'The agent decided on build output: clean dist.',
    decision_chose: 'You asked, and the agent decided on Retry-After unit: seconds.',
    decision_whether_asked: 'The agent decided on limit per client: ten requests.' };
  for (const [kind, text] of Object.entries(expect)) {
    const item = one(model, kind);
    assert.equal(textOf(item.what.parts), text, kind);
    // Both are the session review's words, set apart; the evidence does not name the dimension again.
    assert.equal(item.what.parts.filter((p) => p.by === 'session-review').length, 2, kind);
  }
  const notActing = one(model, 'decision_not_acting');
  assert.equal(notActing.evidence.some((e) => textOf(e.parts) === 'store'), false, 'the dimension is not repeated');
  // A decision with no dimension keeps the plain lead.
  const session = reportSession();
  const report = triagedReport(session);
  report.decisions[0] = { ...report.decisions[0], dimension: '' };
  assert.equal(textOf(one(reportModel(session, report, repoFacts()), 'decision_not_acting').what.parts),
    'The agent decided not to act: no Redis.');
  // A dimension worded as the act left undone (h4: "Leaving … alone"; s2: "Not adding …") never follows "not to act
  // on": the fixed words stand apart from the review's words, so no wording of them reads as a double negative.
  for (const dimension of ['Leaving the legacy script alone', 'Not adding a Redis store', 'Skipping lint checks']) {
    report.decisions[0] = { ...report.decisions[0], dimension, chosen: 'Not changed' };
    const what = one(reportModel(session, report, repoFacts()), 'decision_not_acting').what.parts;
    assert.equal(textOf(what), `The agent decided not to act. About: ${dimension}. Its decision: Not changed.`);
    assert.deepEqual(what.filter((p) => p.by !== 'session-review').map((p) => p.text),
      ['The agent decided not to act. About: ', '. Its decision: ', '.']);
  }
});

test('D97: a question of the code review shows its whole text as its what line, never its first sentence alone', () => {
  // r1 item 5 read only "The agent says 31,000 deselected tests are stress tests the project skips by default.": the
  // question itself sat in the fold (20 of 24 plain questions open with background). No sentence is picked.
  const session = reportSession();
  const report = triagedReport(session);
  const asked = 'The agent says the limiter is global. I did not check this. Do you want one limit per client?';
  // Q3, on an ask, is an item of its own (D112 amended: so is Q1, which names no place).
  report.codePass.questions[2] = { ...report.codePass.questions[2], question: asked };
  const question = byKind(reportModel(session, report, repoFacts()), 'code_question')
    .find((item) => item.rows[0].index === 2);
  assert.equal(textOf(question.what.parts), asked);
  assert.deepEqual(question.what.parts.map((p) => p.by), ['code-review']);
  assert.equal(question.evidence.some((e) => textOf(e.parts) === asked), false, 'the fold does not repeat it');
  assert.ok(itemVisibleText(question).includes('Do you want one limit per client?'));
});

test('R10: a claim_false finding contradicts only the row its code check names; every other row it cites keeps its own status and words', () => {
  // r3: the finding followed from the false README note and from the agent's true admission that 1.5 days still move
  // 2 days; every row it cited read "contradicted by the code review", the admission's words lost. The code step marks
  // the one row a claim_false finding contradicts (its codeCheck names the finding): only that row is.
  const session = reportSession();
  const report = triagedReport(session);
  const r = report.codePass.findings[2];
  report.codePass.findings[2] = { ...r, leadsFrom: [...r.leadsFrom,
    { key: 'S10', kind: 'claim', source: 'promises', index: 1, id: report.promises[1].id }] };
  const model = reportModel(session, report, repoFacts());
  const claimFalse = one(model, 'code_claim_false');
  assert.deepEqual(claimFalse.rows, [{ source: 'codePass.findings', index: 2 }, { source: 'promises', index: 3 }]);
  assert.equal(textOf([claimFalse.quote]), '“I reverted the CI change.”');
  assert.equal(claimFalse.quoteLabel, words.REPORT_ITEM_WORDS.agentSaid);
  const row = (index) => model.did.claims.shown.find((c) => c.source === 'promises' && c.index === index);
  assert.deepEqual([row(3).status, row(3).item, textOf([row(3).quote])],
    ['contradicted by the code review', claimFalse.n, '“I reverted the CI change.”']);
  // The other row: its own status and words, a link to the finding's item, and its own place.
  assert.deepEqual([row(1).status, row(1).item, textOf([row(1).quote])],
    ['not checked', claimFalse.n, '“rate limiting works”']);
  assert.deepEqual(model.placement.rows['promises:1'], { list: 'claims', shown: true });
  // A row the finding names but whose code check names another finding is not this item's either.
  report.promises[3] = { ...report.promises[3], codeCheck: { ...report.promises[3].codeCheck, finding: 'sha256:other' } };
  const other = one(reportModel(session, report, repoFacts()), 'code_claim_false');
  assert.deepEqual(other.rows, [{ source: 'codePass.findings', index: 2 }]);
  assert.equal(other.quote, null);
});

test('R8: a false-claim finding labels the claim it disproves by its receipt\'s role, as a question does', () => {
  // t6: a code comment the agent wrote into a file stood as a bare quote, which reads as the agent's chat.
  const session = reportSession();
  const report = triagedReport(session);
  const r = report.codePass.findings[2];
  report.codePass.findings[2] = { ...r, leadsFrom: [{ key: 'S20', kind: 'claim', source: 'writtenClaims', index: 0,
    id: report.writtenClaims[0].id }] };
  report.writtenClaims[0] = { ...report.writtenClaims[0], codeCheck: { outcome: 'contradicted-by-code', receipts: [],
    by: 'finding', finding: r.id } };
  const item = one(reportModel(session, report, repoFacts()), 'code_claim_false');
  assert.equal(textOf([item.quote]), '“Rate limiting is enabled by default.”');
  assert.equal(item.quoteLabel, words.REPORT_ITEM_WORDS.changeShows);
  assert.ok(itemVisibleText(item).includes('The change shows: “Rate limiting is enabled by default.”'));
  // The agent's own words: "The agent said:".
  assert.equal(one(modelOf(triagedReport), 'code_claim_false').quoteLabel, words.REPORT_ITEM_WORDS.agentSaid);
});

test('R11, R17: the header and What Sonah could not check count the claims the claims list shows as not checked', () => {
  // p2, s3: a claim whose check did not finish was counted nowhere ("8 claims" became 7). It is one Sonah did not check:
  // its row says "check did not finish", and the header counts it with the rows that say "not checked".
  const unchecked = [words.REPORT_DID_WORDS.claimStatus.notChecked, words.REPORT_DID_WORDS.claimStatus.incomplete];
  let incomplete = 0;
  for (const [letter, shape] of Object.entries(REPORT_SHAPES)) {
    const model = modelOf(shape);
    incomplete += model.did.claims.shown.filter((c) => c.status === words.REPORT_DID_WORDS.claimStatus.incomplete).length;
    const listed = (source) => model.did.claims.shown.filter((c) => c.source === source && unchecked.includes(c.status))
      .length;
    assert.equal(model.did.claims.more, 0, letter);
    // D133 (R2): the header's line, word for word, in What Sonah could not check.
    const line = model.notChecked.quiet.find((t) => t.startsWith(words.REPORT_HEADER_WORDS.notCheckedLead)) ?? '';
    const phrases = line.slice(words.REPORT_HEADER_WORDS.notCheckedLead.length).split(' · ').map((p) => p.trim());
    const phrase = (re) => Number(phrases.map((p) => re.exec(p)?.[1]).find(Boolean) ?? 0);
    assert.equal(phrase(/^(\d+) claims?$/), listed('promises'), `${letter}: claims`);
    assert.equal(phrase(/^(\d+) statements? that the agent wrote/), listed('writtenClaims'), `${letter}: written`);
    const fact = model.notChecked.facts.map((f) => textOf(f.parts)).find((t) => /^Sonah did not check \d+ claims?\./.test(t));
    assert.equal(Number(/(\d+)/.exec(fact ?? '0')[1]), listed('promises'), `${letter}: the fact`);
  }
  assert.ok(incomplete > 0, 'a shape holds a claim whose check did not finish');
});

/** A command the recorder typed as refused before it ran (`toolDenialKind`), as the slicer records it. */
function refusedCommand(b, id, command, denial = 'user-rejected') {
  const key = `${id}-cmd`;
  b.blobs[key] = command;
  b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
    paths: [], command: [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(command, 'utf8') }], input: [],
    changes: [], recorded: { denial } });
  b.events.push({ sequence: b.events.length, id: `${id}-r`, kind: 'observation', invocation: id, callKey: id,
    phase: 'terminal', result: 'failed', exitCode: null, terminalStatusProven: false, output: [], sourceOfResult: 'native' });
}

test('R5: the header and the Runs list read one last edit (a write that landed), and count only commands that ran', () => {
  const windowed = (session) => ({ windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }] });
  // t4: the tests ran after the last real edit; a later edit the tool rejected as a no-op changed no file.
  const b = sessionBuilder();
  b.ask('I1', 'Fix the parser and run the tests.');
  b.change('W1', 'src/parse.js', { after: 'export const parse = () => [];\n' });
  b.run('R1', 'npm test', 'succeeded', 'ok');
  b.change('W2', 'src/parse.js', { operation: 'edit', before: 'export', after: 'export', priorState: 'edit-text',
    result: 'failed' });
  const s = b.session();
  const model = reportModel(s, windowed(s), {});
  assert.deepEqual(model.header.runs, ['After its last edit, the agent ran 1 command.', 'Results: 1 exited with code 0.']);
  assert.deepEqual(model.did.runs.neverRan, [], 'the Runs list agrees with the header');
  // r1: every command after the last edit was refused: none ran, and each is said as refused, never as run.
  const c = sessionBuilder();
  c.ask('I1', 'Fix the parser and run the tests.');
  c.run('R1', 'npm test', 'succeeded', 'ok');
  c.change('W1', 'src/parse.js', { after: 'export const parse = () => [];\n' });
  refusedCommand(c, 'X1', 'ruff check src');
  refusedCommand(c, 'X2', 'ruff format src', 'permission-rule');
  const t = c.session();
  const refusedModel = reportModel(t, windowed(t), {});
  assert.deepEqual(refusedModel.header.runs, ['Sonah found no command that the agent ran after its last edit.',
    'The recording shows 2 commands after the agent\'s last edit as refused before they ran.']);
  assert.deepEqual(refusedModel.did.runs.neverRan, ['src/parse.js'], 'a refused command ran after no edit');
  // A command the recording cannot tell failed from refused may have run: never counted as run, and never "ran no
  // command" after an edit it follows, in the header or the Runs list.
  const untyped = (builder, id, command) => {
    refusedCommand(builder, id, command);
    const call = builder.events.find((e) => e.id === id);
    delete call.recorded;
    call.refusalUntyped = true;
  };
  const u = sessionBuilder();
  u.ask('I1', 'Fix the parser and run the tests.');
  u.run('R1', 'npm test', 'succeeded', 'ok');
  u.change('W1', 'src/parse.js', { after: 'export const parse = () => [];\n' });
  untyped(u, 'X1', 'npm test');
  const v = u.session();
  const unclearModel = reportModel(v, windowed(v), {});
  assert.deepEqual(unclearModel.header.runs, ['After the agent\'s last edit, 1 command failed or the harness refused '
    + 'it. The recorder does not mark which.']);
  assert.deepEqual(unclearModel.did.runs.neverRan, [], 'it may have run after the edit');
  // A file edited before such a command keeps no "never ran"; a file edited after it, with nothing after, does.
  u.change('W2', 'src/util.js', { after: 'export const id = (x) => x;\n' });
  const x = u.session();
  const later = reportModel(x, windowed(x), {});
  assert.deepEqual(later.header.runs, ['Sonah found no command that the agent ran after its last edit.']);
  assert.deepEqual(later.did.runs.neverRan, ['src/util.js']);
});

test('D98: the header and the Runs list read a write\'s last edit by the one effect rule', () => {
  // One reading per recorder fact: a write is the last edit exactly when evidence session.js `effectOf` says it could
  // have changed its file (landed or unknown), as the story, the code step and the adapter's gaps read it.
  const windowed = (session) => ({ windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }] });
  /** A write, then the tests, then an edit of the same file whose own typed end is `end` (a result, or a denial). */
  const after = ({ result = 'failed', denial = null, exitCode }) => {
    const b = sessionBuilder();
    b.ask('I1', 'Fix the parser and run the tests.');
    b.change('W1', 'src/parse.js', { after: 'export const parse = () => [];\n' });
    b.run('R1', 'npm test', 'succeeded', 'ok');
    b.change('W2', 'src/parse.js', { operation: 'edit', before: 'export', after: 'export', priorState: 'edit-text',
      result });
    if (exitCode !== undefined) b.events.find((e) => e.id === 'W2-r').exitCode = exitCode;
    if (denial !== null) b.events.find((e) => e.id === 'W2').recorded = { denial };
    const s = b.session();
    return { effect: effectOf(s, s.event('W2')), model: reportModel(s, windowed(s), {}) };
  };
  const ranAfter = ['After its last edit, the agent ran 1 command.', 'Results: 1 exited with code 0.'];
  const ranNone = ['Sonah found no command that the agent ran after its last edit.'];
  // An edit typed cancelled, with no exit code, left nothing: the tests still ran after the last edit.
  const cancelled = after({ result: 'cancelled', exitCode: null });
  assert.equal(cancelled.effect, 'undone');
  assert.deepEqual([cancelled.model.header.runs, cancelled.model.did.runs.neverRan], [ranAfter, []]);
  // An edit the recorder typed as stopped (D80) may have changed the file, whatever its result says: no command ran
  // after it.
  const stopped = after({ denial: 'interrupted', exitCode: null });
  assert.equal(stopped.effect, 'unknown');
  assert.deepEqual([stopped.model.header.runs, stopped.model.did.runs.neverRan], [ranNone, ['src/parse.js']]);
  // A denial kind outside the recorder's closed vocabulary is never read as refused: an edit with a typed success under
  // one landed.
  const unknownKind = after({ result: 'succeeded', denial: 'SYNTHETIC_E9_KIND', exitCode: null });
  assert.equal(unknownKind.effect, 'landed');
  assert.deepEqual([unknownKind.model.header.runs, unknownKind.model.did.runs.neverRan], [ranNone, ['src/parse.js']]);
});

test('The header says nothing of a last edit when no write landed', () => {
  // A session that only ran the tests, and one whose every edit the tool rejected: no write landed, so there is no last
  // edit to run a command after, and the header says nothing of one (no false "ran no command after its last edit").
  const windowed = (session) => ({ windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
    failure: null }] });
  const testsOnly = sessionBuilder();
  testsOnly.ask('I1', 'Run the tests.');
  testsOnly.run('R1', 'npm test', 'succeeded', 'ok');
  const rejected = sessionBuilder();
  rejected.ask('I1', 'Fix the parser.');
  rejected.change('W1', 'src/parse.js', { operation: 'edit', before: 'export', after: 'export', priorState: 'edit-text',
    result: 'failed' });
  rejected.run('R1', 'npm test', 'succeeded', 'ok');
  for (const b of [testsOnly, rejected]) {
    const s = b.session();
    const model = reportModel(s, windowed(s), {});
    assert.deepEqual(model.header.runs, []);
    const text = renderReportMarkdown(s, windowed(s), {});
    assert.equal(/last edit/.test(text.slice(0, text.indexOf('### '))), false, 'the .md header names no last edit');
    assert.equal(text.includes(words.REPORT_HEADER_WORDS.noRunAfterEdit), false);
    assert.equal(renderSessionPage(s, windowed(s), {}).includes('class="meta runs"'), false, 'the page has no runs line');
  }
});

test('R6: a tie lifts "you asked, the agent decided how" at most to the tier of the item that ties it, and names it', () => {
  // r1: a low weak-test finding folded in Good to know lifted the test-design decision into Must know, whose why line
  // named no item. A tie now lifts only to a tier the tying item itself holds, and the why line names that item.
  const chose = (model) => one(model, 'decision_chose');
  const session = reportSession();
  const ref = (report) => ({ key: 'S11', kind: 'decision', source: 'decisions', index: 2, id: report.decisions[2].id });
  // Tied by a question the code review proposed low (Good to know): the decision stays in Good to know, by default.
  const byLowQuestion = triagedReport(session);
  byLowQuestion.codePass.questions[0] = { ...byLowQuestion.codePass.questions[0], concerns: ref(byLowQuestion) };
  byLowQuestion.codePass.triage.push({ ref: { question: 'Q1' }, level: 'low', impact: 'The limit may be global.',
    action: 'Decide the scope of the limit.', label: 'scope of the limit', where: null });
  const low = reportModel(session, byLowQuestion, repoFacts());
  assert.equal(one(low, 'code_question').tier.final, 'good_to_know');
  assert.deepEqual([chose(low).tier.final, chose(low).why],
    ['good_to_know', 'Sonah puts a decision on how to do your ask in Good to know by default.']);
  // Tied by a weak-test finding proposed low (Good to know): the same.
  const byLowFinding = triagedReport(session);
  byLowFinding.codePass.findings[4] = { ...byLowFinding.codePass.findings[4], leadsFrom: [ref(byLowFinding)] };
  const lowFinding = reportModel(session, byLowFinding, repoFacts());
  assert.equal(one(lowFinding, 'code_weak_test').tier.final, 'good_to_know');
  assert.equal(chose(lowFinding).tier.final, 'good_to_know');
  // Tied by a Must know finding (a missed case proposed low, held at its floor): Must know, and the why names it.
  const byKnown = triagedReport(session);
  byKnown.codePass.findings[5] = { ...byKnown.codePass.findings[5], leadsFrom: [ref(byKnown)] };
  const known = reportModel(session, byKnown, repoFacts());
  const missed = itemsOf(known).find((item) => textOf(item.what.parts) === 'A rate of zero lets every request through');
  assert.equal(missed.tier.final, 'must_know');
  assert.deepEqual([chose(known).tier.final, chose(known).why],
    ['must_know', `Item ${missed.n} of the code review concerns it, so Sonah puts it in Must know.`]);
  // Tied by a Must act finding: Must know, the kind's tied tier, never above it.
  assert.equal(chose(reportModel(session, (() => { const r = triagedReport(session);
    r.codePass.findings[0] = { ...r.codePass.findings[0], leadsFrom: [ref(r)] }; return r; })(), repoFacts())).tier.final,
  'must_know');
});

test('R15: a refusal names who refused only when the recording types it; user-rejected names no one', () => {
  // The recorder types `user-rejected` for a person's "no" at a prompt and for a prompt no person could be shown (a
  // permission config refusing in a headless run): "refused (user-rejected)" read as the person's own no.
  const session = reportSession();
  const report = triagedReport(session);
  report.failures[2] = { ...report.failures[2], handling: 'passed-over' };
  const model = reportModel(session, report, repoFacts());
  const run = (command) => model.did.runs.shown.find((r) => r.text === command);
  assert.equal(run('git push --force').outcome, 'did not run: refused');
  assert.equal(run('curl -X POST https://example.invalid/deploy').outcome, 'did not run: a permission rule refused it');
  assert.equal(run('rm -rf dist').outcome, 'did not run: auto mode refused it');
  const push = byKind(model, 'failure_passed_over').find((item) => item.quote?.text === 'git push --force');
  assert.equal(textOf(push.what.parts), 'A Bash call did not run: refused. The agent did not act on it or tell you.');
  const all = JSON.stringify(model);
  for (const token of ['user-rejected', 'permission-rule', 'automode-blocked']) assert.equal(all.includes(token), false, token);
  // A recorder that types no refusal records a person's "no" and a rule's alike as a failure: its what line names no
  // one who refused.
  const b = sessionBuilder();
  b.ask('I1', 'Fix the parser and run the tests.');
  b.change('W1', 'src/parse.js', { after: 'export const parse = () => [];\n' });
  refusedCommand(b, 'X1', 'npm test');
  const call = b.events.find((e) => e.id === 'X1');
  delete call.recorded;
  call.refusalUntyped = true;
  const s = b.session();
  const untyped = reportModel(s, { windowResults: [{ windowIndex: 0, eventIds: s.events.map((e) => e.id), failure: null }],
    failures: [{ eventId: 'X1-r', action: 'X1', outcome: 'failed-or-refused', form: 'untyped', tool: 'Bash',
      handling: 'passed-over' }] }, {});
  assert.equal(textOf(one(untyped, 'failure_passed_over').what.parts), 'A Bash call failed, or was refused before it ran. '
    + 'The recorder does not mark which. The agent did not act on it or tell you.');
});

test('R17: a list cut to N says how many it left out, and a lone hidden entry is shown, never "and 1 more"', () => {
  // s3: "Must act: ask 2 · ask 5 · a false claim (item 3) and 1 more"; "4 files outside the repository: a, b, c."
  const session = reportSession();
  const four = sessionOnlyReport(session);
  four.findings[2] = { ...four.findings[2], status: 'FYI', disclosureReason: 'disclosed' };
  const m4 = reportModel(session, four, repoFacts());
  assert.equal(m4.tiers.must_act.length, REPORT_LIMITS.mustActLabels + 1);
  assert.deepEqual([m4.countLine.labels.length, m4.countLine.more], [4, 0]);
  const m5 = modelOf(sessionOnlyReport);
  assert.deepEqual([m5.tiers.must_act.length, m5.countLine.labels.length, m5.countLine.more], [5, 3, 2]);
  // Files outside the repository: four are named; of six, three are named and the rest counted.
  const outside = (n) => {
    const b = sessionBuilder();
    b.ask('I1', 'Write the notes.');
    for (let k = 0; k < n; k++) b.change(`O${k}`, `../scratch/note-${k}.md`, { after: 'n\n', outside: true });
    const s = b.session();
    return reportModel(s, { windowResults: [{ windowIndex: 0, eventIds: s.events.map((e) => e.id), failure: null }] }, {})
      .did.files.outside;
  };
  assert.deepEqual([outside(4).paths.length, outside(4).more], [4, 0]);
  assert.deepEqual([outside(6).n, outside(6).paths.length, outside(6).more], [6, 3, 3]);
  assert.equal(words.REPORT_DID_WORDS.outside(6, 'a, b, c', 3),
    'The agent also changed 6 files outside the repository: a, b, c, and 3 more.');
  // An item's places: past three, the rest are counted on its Where line.
  const places = triagedReport(session);
  places.decisions[1] = { ...places.decisions[1], actions: ['W1', 'W2', 'W3', 'W4', 'W5'] };
  const deploy = itemsOf(reportModel(session, places, repoFacts()))
    .find((item) => item.rows[0].source === 'decisions' && item.rows[0].index === 1);
  assert.deepEqual([deploy.where.length, deploy.whereMore], [3, 2]);
  assert.ok(itemVisibleText(deploy).includes(' · 2 more places'), itemVisibleText(deploy));
});

test('R17: the header, the Runs fold and What Sonah could not check count commands in the same terms', () => {
  // s2: "16 commands" in the header, "17 runs" in the fold (a refused WebFetch); u06: "1 command has no recorded exit
  // code" beside 15 runs that then read "completed, no exit code recorded" (a typed end of another class).
  const model = modelOf(triagedReport);
  assert.ok(model.header.size.includes(`${model.did.runs.commands} commands`));
  assert.equal(model.did.runs.commands + model.did.runs.others, model.did.runs.total);
  assert.equal(words.REPORT_SECTION_WORDS.didCounted(5, 6, 1, 7), 'What the agent did (5 files · 6 commands · 1 other call '
    + '· 7 claims)');
  assert.equal(words.REPORT_SECTION_WORDS.didCounted(5, 6, 0, 7), 'What the agent did (5 files · 6 commands · 7 claims)');
  const unknown = words.REPORT_CAUSE_WORDS.command_outcome_unknown({ n: 1 });
  assert.equal(unknown, 'Sonah could not read whether or how 1 command ended, so it cannot tell if it passed');
  assert.doesNotMatch(unknown, /exit code/);
});

test('D96 (as built): a note used only in part is counted once, however many of its text fields were left out', () => {
  const session = reportSession();
  const report = triagedReport(session);
  // The refill finding's entry, kept without its label and its action: two records, one note.
  report.codePass.triage[0] = { ...report.codePass.triage[0], label: null, action: null };
  report.codePass.triageDropped = [...report.codePass.triageDropped,
    { key: 'F1', index: 0, cause: 'value_outside_list', field: 'action' },
    { key: 'F1', index: 0, cause: 'text_over_limit', field: 'label' }];
  const facts = (r) => reportModel(session, r, repoFacts()).notChecked.facts.filter((f) => f.group === 'code')
    .map((f) => textOf(f.parts));
  assert.ok(facts(report).includes(words.REPORT_NOT_CHECKED_WORDS.triagePartly(1)), facts(report).join('\n'));
  assert.ok(!facts(report).some((f) => f === words.REPORT_NOT_CHECKED_WORDS.triagePartly(2)));
  // A second entry kept without a field: two notes.
  report.codePass.triage[1] = { ...report.codePass.triage[1], impact: null };
  report.codePass.triageDropped.push({ key: 'F2', index: 1, cause: 'text_over_limit', field: 'impact' });
  assert.ok(facts(report).includes(words.REPORT_NOT_CHECKED_WORDS.triagePartly(2)), facts(report).join('\n'));
});
