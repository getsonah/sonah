// D201 (0.3.0-beta.11; the owner, 2026-10-31: "for evidence, show more details for verify cases, at least where in the
// code"): a Verify item's more details, in the model and on both readers. (a) A failed run passed over shows the last
// `REPORT_LIMITS.outputLines` non-empty lines of its recorded output, each word for word as code, each a line of one
// recorded span (never two spans' text joined), a long one cut at `outputLineChars` with "…" outside the code; (b) only
// a call that ran (failed) or was stopped shows them; (c) a contradicted claim, and a contradicted written statement,
// name the run whose call their contradicting result answers, as a Where place and a linked line with its command, once
// a run, and only beside a result whose quote grounds; (d) the session review's own words for the finding stand on a
// contradicted claim alone, cut at `REPORT_LIMITS.reasonChars`. Structure and provenance only, every session synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems, REPORT_LIMITS } from '../report-model.js';
import { renderSessionPage, escapeHtml as esc } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_ITEM_WORDS } from '../report-words.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const id = (c) => `sha256:${c.repeat(64)}`;
const reviewOf = (session, rows) => ({ windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
  failure: null }], sessionReview: 'complete', coverage: 'complete', ...rows });
const readers = (session, report) => ({ page: renderSessionPage(session, report, {}),
  md: renderReportMarkdown(session, report, {}) });
const count = (text, words) => text.split(words).length - 1;
/** Texts as recorded spans of one field, each its own blob, as a recorder that keeps one output in parts writes it. */
const spansOf = (b, key, texts) => texts.map((text, at) => {
  b.blobs[`${key}${at}`] = text;
  return { sourceKey: `${key}${at}`, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') };
});
/** A command of the agent's whose call carries the recorder's typed facts (`fields`), and its result, with output. */
function call(b, callId, command, fields, output) {
  b.events.push({ sequence: b.events.length, id: callId, kind: 'invocation', callKey: callId, tool: 'Bash',
    operation: 'command', paths: [], command: spansOf(b, `${callId}c`, [command]), input: [], changes: [], ...fields });
  b.events.push({ sequence: b.events.length, id: `${callId}-r`, kind: 'observation', invocation: callId, callKey: callId,
    phase: 'terminal', result: 'failed', exitCode: null, terminalStatusProven: false,
    output: spansOf(b, `${callId}o`, [output]), sourceOfResult: 'native' });
}
/** An item's block of a reader, from its anchor to the next item's. */
const pageItem = (page, n) => {
  const at = page.indexOf(`id="item-${n}"`);
  const next = page.indexOf('id="item-', at + 1);
  return page.slice(at, next < 0 ? page.length : next);
};
const mdItem = (md, n) => {
  const at = md.indexOf(`<a name="item-${n}"></a>`);
  const next = md.indexOf('<a name="item-', at + 1);
  return md.slice(at, next < 0 ? md.length : next);
};
/** Whether the page's links to `#run-<k>` resolve: one element holds that id, in the panel of What the agent did, and
 *  each link opens that panel (its tab's label) or stands in it. */
function resolves(page, k) {
  const did = page.indexOf('<section class="part panel" id="did">');
  const end = page.indexOf('</section>', did);
  const at = page.indexOf(`id="run-${k}"`);
  const links = [...page.matchAll(new RegExp(`<(?:label|a) [^>]*href="#run-${k}"[^>]*>`, 'g'))];
  return count(page, `id="run-${k}"`) === 1 && at > did && at < end && links.length > 0
    && links.every((m) => m[0].includes('for="t-did"') || (m.index > did && m.index < end));
}

// ---- (a) the end of a failed run's output -------------------------------------------------------------------------

/** 207 code points, more UTF-16 units: a cut by code points is seen apart from one by units. */
const LONG = `error: ${'é𝑥'.repeat(100)}`;
/** One result's output in two recorded spans, the second going on with the first's last line; blank lines, a line of
 *  spaces, one of a tab, a CRLF end and trailing spaces. */
const SPANS = Object.freeze([
  ['TAP version 13', 'ok 1 - admits a request', '', 'ok 2 - refills', '   ', 'not ok 3 - rejects a bur'].join('\n'),
  ['st over capacity', '', LONG, '\t', '# tests 3\r', '# fail 1   ', ''].join('\n'),
]);
/** What the two spans would read as, joined: one line made of both. */
const JOINED = 'not ok 3 - rejects a burst over capacity';

function failedRun() {
  const b = sessionBuilder();
  b.ask('I1', 'Make the limiter tests pass.');
  b.change('W1', 'src/limiter.js', { after: 'export const limit = 10;\n' });
  b.run('R1', 'npm test', 'failed');
  b.events.find((e) => e.id === 'R1-r').output = spansOf(b, 'out', SPANS);
  b.say('F1', 'All tests pass.', 'final');
  const session = b.session();
  return { session, report: reviewOf(session, {
    requirements: [{ text: 'pass', instruction: r('instruction', 'I1', 'Make the limiter tests pass.'), status: 'done',
      deliverable: r('code', 'W1', 'export const limit = 10;') }],
    failures: [{ eventId: 'R1-r', action: 'R1', outcome: 'ran-failed', form: 'exit', tool: 'bash',
      handling: 'passed-over', response: r('commentary', 'F1', 'All tests pass.') }] }) };
}

test('D201: a failed run passed over shows its output\'s last lines, word for word, each of one span, cut at its end', () => {
  const { session, report } = failedRun();
  assert.deepEqual([REPORT_LIMITS.outputLines, REPORT_LIMITS.outputLineChars], [6, 160]);
  // Premises: two recorded spans; more non-empty lines than the bound; one line past its bound, in code points.
  assert.deepEqual(session.textSpansOf(session.event('R1-r'), 'output'), SPANS);
  assert.ok(SPANS.join('\n').split('\n').filter((line) => line.trim()).length > REPORT_LIMITS.outputLines);
  assert.ok([...LONG].length > REPORT_LIMITS.outputLineChars && LONG.length > [...LONG].length);
  assert.ok(SPANS.join('').includes(JOINED), 'premise: the spans joined make one line');
  const item = reportItems(reportModel(session, report, {})).find((x) => x.kind === 'failure_passed_over');
  // Exactly the bound's lines, as code, right after the outcome line and before the turn's end, the first labelled.
  const shown = item.evidence.filter((e) => e.parts.some((p) => p.code));
  assert.equal(shown.length, REPORT_LIMITS.outputLines);
  assert.deepEqual(item.evidence.map((e) => e.label), [null, REPORT_ITEM_WORDS.outputEnd, null, null, null, null, null,
    REPORT_ITEM_WORDS.turnEnded]);
  assert.deepEqual(item.evidence.slice(1, 1 + REPORT_LIMITS.outputLines), shown);
  const cut = [...LONG].slice(0, REPORT_LIMITS.outputLineChars - 1).join('');
  const code = shown.map((e) => e.parts[0].text);
  assert.deepEqual(code, ['ok 2 - refills', 'not ok 3 - rejects a bur', 'st over capacity', cut, '# tests 3', '# fail 1']);
  assert.ok(shown.every((e) => e.parts[0].code && e.parts[0].by === 'sonah' && !e.parts[0].quote));
  // The long line: its first outputLineChars - 1 code points as code, "…" a part of its own, outside the code.
  assert.equal([...shown[3].parts[0].text].length, REPORT_LIMITS.outputLineChars - 1);
  assert.deepEqual(shown[3].parts.slice(1).map((p) => [p.text, p.code]), [['…', false]]);
  assert.ok(shown.filter((e, at) => at !== 3).every((e) => e.parts.length === 1));
  // Each shown line is word for word in the recorded output, a line of exactly one span (its start, when cut).
  for (const text of code) {
    assert.ok(SPANS.join('').includes(text), text);
    const of = SPANS.filter((span) => span.split('\n').map((line) => line.replace(/\s+$/, ''))
      .some((line) => line === text || (text === cut && line.startsWith(text))));
    assert.equal(of.length, 1, text);
  }
  const { page, md } = readers(session, report);
  // The .md: a bullet a line, the first under the label, the cut outside the code span.
  assert.ok(md.includes(`\n- ${REPORT_ITEM_WORDS.outputEnd} \`ok 2 - refills\`\n- \`not ok 3 - rejects a bur\`\n`
    + `- \`st over capacity\`\n- \`${cut}\`…\n- \`# tests 3\`\n- \`# fail 1\`\n- ${REPORT_ITEM_WORDS.turnEnded} `));
  // The page: a line each, its code element, the cut after it.
  assert.ok(page.includes(code.map((text, at) => `<p class="line">${at === 0 ? `<span class="label">`
    + `${esc(REPORT_ITEM_WORDS.outputEnd)}</span> ` : ''}<code>${esc(text)}</code>${at === 3 ? '…' : ''}</p>`).join('')));
  // No reader joins the spans, shows a line before the last ones, or the long line past its cut.
  for (const text of [page, md]) {
    for (const words of [JOINED, 'rejects a burst', 'TAP version 13', 'ok 1 - admits a request', LONG])
      assert.equal(text.includes(words), false, words);
  }
});

// ---- (b) only a call that ran, or was stopped ---------------------------------------------------------------------

test('D201: a failure whose call did not run shows no output; one stopped before it finished shows its end', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Clean the build.');
  call(b, 'X1', 'rm -rf dist', { recorded: { denial: 'permission-rule' } }, 'Permission to use Bash was denied.\nrm: not run');
  call(b, 'X2', 'npm run clean', { refusalUntyped: true }, 'clean refused\nno file removed');
  call(b, 'X3', 'npm run watch', { recorded: { interrupted: true } }, 'watching src\nrebuilt in 2s');
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const failure = (k, outcome, form) => ({ eventId: `X${k}-r`, action: `X${k}`, outcome, form, tool: 'Bash',
    handling: 'passed-over' });
  const report = reviewOf(session, { failures: [failure(1, 'did-not-run', 'denial'),
    failure(2, 'failed-or-refused', 'untyped'), failure(3, 'no-terminal-status', 'interrupted')] });
  const items = reportItems(reportModel(session, report, {})).filter((x) => x.kind === 'failure_passed_over');
  const of = (k) => items.find((x) => x.where.some((w) => w.anchor === `run-${k}`));
  const outputOf = (item) => item.evidence.filter((e) => e.parts.some((p) => p.code)).map((e) => e.parts[0].text);
  assert.equal(items.length, 3);
  // Refused before it ran (did-not-run), and failed or refused with the recorder marking neither: no output line.
  for (const k of [1, 2]) {
    assert.deepEqual(outputOf(of(k)), [], `run ${k}`);
    assert.ok(of(k).evidence.every((e) => e.label !== REPORT_ITEM_WORDS.outputEnd), `run ${k}`);
  }
  // Stopped before it finished: its end, as a failed run's.
  assert.deepEqual(outputOf(of(3)), ['watching src', 'rebuilt in 2s']);
  assert.equal(of(3).evidence.find((e) => e.parts.some((p) => p.code)).label, REPORT_ITEM_WORDS.outputEnd);
  for (const text of Object.values(readers(session, report))) {
    assert.equal(count(text, REPORT_ITEM_WORDS.outputEnd), 1);
    for (const words of ['Permission to use Bash was denied.', 'rm: not run', 'clean refused', 'no file removed'])
      assert.equal(text.includes(words), false, words);
    for (const words of ['watching src', 'rebuilt in 2s']) assert.ok(text.includes(words), words);
  }
});

// ---- (c) the run a contradicting result came from -----------------------------------------------------------------

/** A quiet run (exit 0 before the last edit), a run after it and a failed run; a claim contradicted by the failed run's
 *  result (two quotes of it), one by the quiet run's, one whose result's quote does not ground, and a written statement
 *  contradicted by the failed run's result (two quotes of it). */
function contradicted() {
  const b = sessionBuilder();
  b.ask('I1', 'Return 429 when the bucket is empty.');
  b.run('R0', 'npm run lint', 'succeeded', 'lint: 2 warnings');
  b.change('W1', 'src/limiter.js', { after: 'return res.status(429).end();\n' });
  b.change('W2', 'docs/limits.md', { after: 'The limiter answers with 429.\n' });
  b.run('R1', 'npm run build', 'succeeded', 'built');
  b.run('R2', 'npm test', 'failed', 'FAIL test/limiter.test.js\nexpected 429, got 200');
  b.say('F1', 'The limiter answers with 429. The lint is clean.', 'final');
  const session = b.session();
  const finding = (c, explanation, receipts) => ({ id: id(c), origin: 'session-review', kind: 'claim_contradicted',
    status: 'DECIDE', contradictionSource: 'result', title: 'Claim contradicted by a recorded result', explanation,
    receipts });
  const report = reviewOf(session, {
    requirements: [{ text: '429', instruction: r('instruction', 'I1', 'Return 429 when the bucket is empty.'),
      status: 'done', deliverable: r('code', 'W1', 'return res.status(429).end();') }],
    findings: [
      finding('a', 'The test run shows 200, not 429.', [r('commentary', 'F1', 'The limiter answers with 429.'),
        r('observation', 'R2-r', 'expected 429, got 200'), r('observation', 'R2-r', 'FAIL test/limiter.test.js')]),
      finding('b', 'The lint run warned.', [r('commentary', 'F1', 'The lint is clean.'),
        r('observation', 'R0-r', '2 warnings')]),
      finding('c', 'The test run shows another status.', [r('commentary', 'F1', 'The limiter answers with 429.'),
        r('observation', 'R2-r', 'expected 429, got 503')]),
    ],
    writtenClaims: [{ id: id('d'), stated: r('code', 'W2', 'The limiter answers with 429.'), text: 'It answers 429',
      label: 'contradicted', receipts: [r('code', 'W2', 'The limiter answers with 429.'),
        r('observation', 'R2-r', 'expected 429, got 200'), r('observation', 'R2-r', 'FAIL test/limiter.test.js')] }],
  });
  return { session, report };
}

test('D201: a contradicted claim names the run its result answers, linked, once, and only beside a quote that grounds', () => {
  const { session, report } = contradicted();
  const model = reportModel(session, report, {});
  const item = (c) => reportItems(model).find((x) => x.rowId === id(c));
  const fromRun = (x) => x.evidence.filter((e) => e.label === REPORT_ITEM_WORDS.fromRun);
  const runPlaces = (x) => x.where.filter((w) => /^run-\d+$/.test(w.anchor ?? ''));
  // The run is the call the result answers, by the recording's order of commands (the runs' numbers).
  const k = (resultId) => session.events.filter((e) => e.kind === 'invocation' && e.operation === 'command')
    .findIndex((e) => e.id === session.event(resultId).invocation) + 1;
  assert.deepEqual([k('R2-r'), k('R0-r')], [3, 1]);
  const line = (n, command) => [{ text: REPORT_ITEM_WORDS.run(n), href: `run-${n}`, code: false },
    { text: ' ', href: null, code: false }, { text: command, href: null, code: true }];
  const shape = (e) => e.parts.map((p) => ({ text: p.text, href: p.href, code: p.code }));
  // Two quotes of one result: one line and one place. The claim's own words stand whole.
  for (const [c, n, command] of [['a', 3, 'npm test'], ['b', 1, 'npm run lint'], ['d', 3, 'npm test']]) {
    assert.deepEqual(fromRun(item(c)).map(shape), [line(n, command)], c);
    assert.deepEqual(runPlaces(item(c)), [{ anchor: `run-${n}`, text: REPORT_ITEM_WORDS.run(n) }], c);
  }
  assert.equal(item('d').evidence.filter((e) => e.label === REPORT_ITEM_WORDS.recordedResult).length, 2,
    'premise: both quotes of the result are shown');
  assert.deepEqual(item('a').evidence.find((e) => e.label === REPORT_ITEM_WORDS.reviewSaid).parts.map((p) => [p.text, p.by]),
    [['The test run shows 200, not 429.', 'session-review']]);
  // A result whose quote does not ground: no quote, no run named.
  assert.equal(item('c').kind, 'claim_contradicted');
  assert.deepEqual([fromRun(item('c')), runPlaces(item('c'))], [[], []]);
  assert.ok(item('c').evidence.every((e) => e.label !== REPORT_ITEM_WORDS.recordedResult));
  const { page, md } = readers(session, report);
  // The page: the line links its run, the Where too, and each run named resolves, the quiet one listed apart.
  for (const [c, n, command] of [['a', 3, 'npm test'], ['b', 1, 'npm run lint'], ['d', 3, 'npm test']]) {
    const block = pageItem(page, item(c).n);
    assert.equal(count(block, `<span class="label">${esc(REPORT_ITEM_WORDS.fromRun)}</span>`), 1, c);
    assert.match(block, new RegExp(`<span class="label">${esc(REPORT_ITEM_WORDS.fromRun)}</span> <(?:label|a) [^>]*`
      + `href="#run-${n}">${REPORT_ITEM_WORDS.run(n)}</(?:label|a)> <code>${esc(command)}</code></p>`), c);
    assert.match(block, new RegExp(`<p class="line where kv">.*href="#run-${n}">${REPORT_ITEM_WORDS.run(n)}<`), c);
  }
  for (const n of [1, 3]) assert.ok(resolves(page, n), `run ${n}`);
  assert.equal(page.includes('<li id="run-1" value="1">'), false, 'premise: the Runs list leaves the quiet run out');
  assert.equal(pageItem(page, item('c').n).includes(esc(REPORT_ITEM_WORDS.fromRun)), false);
  // The .md: the line, the Where, and the run's line among the runs it names.
  for (const [c, n, command] of [['a', 3, 'npm test'], ['b', 1, 'npm run lint'], ['d', 3, 'npm test']]) {
    const block = mdItem(md, item(c).n);
    assert.equal(count(block, `\n- ${REPORT_ITEM_WORDS.fromRun} ${REPORT_ITEM_WORDS.run(n)} \`${command}\`\n`), 1, c);
    assert.match(block, new RegExp(`\nWhere: (?:.* · )?${REPORT_ITEM_WORDS.run(n)}\n`), c);
    assert.ok(md.includes(`\n- ${REPORT_ITEM_WORDS.run(n)} · \`${command}\` · `), c);
  }
  assert.equal(mdItem(md, item('c').n).includes(REPORT_ITEM_WORDS.fromRun), false);
  assert.equal(count(md, `- ${REPORT_ITEM_WORDS.fromRun} `), 3);
  assert.equal(md.includes('- run 2 · '), false, 'no item names run 2');
});

// ---- (d) the session review's words ------------------------------------------------------------------------------

test('D201: the session review\'s words stand on a contradicted claim alone, cut at reasonChars', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Return 429.');
  b.change('W1', 'docs/limits.md', { after: 'It answers 429.\n' });
  b.run('R1', 'npm test', 'failed', 'expected 429, got 200');
  b.say('F1', 'It answers 429. All tests pass. The docs are right.', 'final');
  const session = b.session();
  const LONG_WHY = 'The run printed 200 where the claim says 429. '.repeat(30).trim();
  assert.ok(LONG_WHY.length > REPORT_LIMITS.reasonChars && REPORT_LIMITS.reasonChars === 1200);
  const finding = (c, fields) => ({ id: id(c), origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
    contradictionSource: 'result', title: 'Claim contradicted by a recorded result', ...fields });
  const OTHER = Object.freeze({ b: 'Words of a corrected claim.', c: 'Words of a claim that later work followed.',
    d: 'Words of a written statement.' });
  const report = reviewOf(session, {
    findings: [
      finding('a', { explanation: LONG_WHY, receipts: [r('commentary', 'F1', 'It answers 429.'),
        r('observation', 'R1-r', 'got 200')] }),
      finding('b', { status: 'FYI', disclosureReason: 'self_corrected', explanation: OTHER.b,
        receipts: [r('commentary', 'F1', 'All tests pass.'), r('observation', 'R1-r', 'expected 429')] }),
      finding('c', { recheck: { outcome: 'not_checked_after_later_work' }, explanation: OTHER.c,
        receipts: [r('commentary', 'F1', 'The docs are right.'), r('observation', 'R1-r', 'expected 429, got 200')] }),
    ],
    writtenClaims: [{ id: id('d'), stated: r('code', 'W1', 'It answers 429.'), text: 'It answers 429',
      label: 'contradicted', explanation: OTHER.d, receipts: [r('code', 'W1', 'It answers 429.'),
        r('observation', 'R1-r', 'got 200')] }],
  });
  const items = reportItems(reportModel(session, report, {}));
  const item = (c) => items.find((x) => x.rowId === id(c));
  assert.deepEqual(['a', 'b', 'c', 'd'].map((c) => item(c).kind), ['claim_contradicted', 'claim_corrected',
    'claim_not_checked_after_later_work', 'written_contradicted']);
  // The contradicted claim: the words cut at the bound with "…", the start of the session review's words.
  const said = item('a').evidence.filter((e) => e.label === REPORT_ITEM_WORDS.reviewSaid);
  assert.equal(said.length, 1);
  assert.equal(said[0].parts.length, 1);
  const { text, by } = said[0].parts[0];
  assert.equal(by, 'session-review');
  assert.equal([...text].length, REPORT_LIMITS.reasonChars);
  assert.ok(text.endsWith('…'));
  assert.ok(LONG_WHY.startsWith(text.slice(0, -1)));
  // A corrected claim, one later work followed, and a written statement: no such line, though each names its run.
  for (const c of ['b', 'c', 'd']) {
    assert.ok(item(c).evidence.every((e) => e.label !== REPORT_ITEM_WORDS.reviewSaid), c);
    assert.equal(item(c).evidence.filter((e) => e.label === REPORT_ITEM_WORDS.fromRun).length, 1, c);
  }
  const { page, md } = readers(session, report);
  assert.ok(md.includes(`\n- ${REPORT_ITEM_WORDS.reviewSaid} *${text}*\n`));
  assert.ok(page.includes(`<span class="label">${esc(REPORT_ITEM_WORDS.reviewSaid)}</span> <em class="by-session-review">`
    + `${esc(text)}</em></p>`));
  assert.equal(count(md, REPORT_ITEM_WORDS.reviewSaid), 1);
  assert.equal(count(page, esc(REPORT_ITEM_WORDS.reviewSaid)), 1);
  for (const words of [LONG_WHY, ...Object.values(OTHER)]) {
    assert.equal(md.includes(words), false, words);
    assert.equal(page.includes(words), false, words);
  }
});
