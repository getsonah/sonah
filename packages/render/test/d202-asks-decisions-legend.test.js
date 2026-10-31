// D202 (0.3.0-beta.11; the owner, 2026-10-31: "Done asks: what does it", "Short replies: context", "Decisions: their
// actions", "Legend and small fixes", "Form, not meaning"). (a) A done ask's evidence: the quote the session review cited
// as doing it, when it grounds, then the run its result came from or the file of its change; how the session review read
// your quoted words; the agent's message recorded last before yours, chosen by recorder kind and place (never a
// helper's, never across an earlier message of yours). (b) A long prompt folds its done asks with no tag or line, each a
// row. (c) A decision's recorded actions, in the recorded order, past the bound counted. (d) The untied question's tag,
// the code review's lines' tag, a tag's sentence in the opened row, a lead quote said once, the legend, the bar in its
// words' order, a 0 tile, a radio's name with its count, "after ask N" as a link, message numbers as spans. Structure and
// provenance only, every session synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems, REPORT_LIMITS } from '../report-model.js';
import { renderSessionPage, escapeHtml as esc } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_ITEM_WORDS, REPORT_PROMPT_WORDS, REPORT_FOOTER_WORDS, REPORT_DECISION_TAGS, REPORT_NOT_CHECKED_WORDS,
  REPORT_TAB_WORDS, REPORT_PROMPT_PARTS, REPORT_TRIM_WORDS } from '../report-words.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';
import { reportSession, triagedReport, repoFacts } from './report-fixture.js';

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const reviewOf = (session, rows) => ({ windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
  failure: null }], sessionReview: 'complete', coverage: 'complete', ...rows });
const text = (parts) => parts.map((p) => p.text).join('');
const count = (haystack, needle) => haystack.split(needle).length - 1;
const rowOf = (page, n) => new RegExp(`<li id="ask-${n}" class="ask-row">[\\s\\S]*?</li>`).exec(page)?.[0] ?? '';

// ---- (a) a done ask's evidence, and the agent's message before yours ----------------------------------------------

const GREET = 'export const greet = (n) => n || "guest";';
function asksSession() {
  const b = sessionBuilder();
  b.ask('I1', 'Fix greet for empty names.');
  b.change('W1', 'src/greet.js', { after: `${GREET}\n` });
  b.run('R1', 'npm test', 'succeeded', 'ok 1 - empty name gives the guest greeting');
  b.say('F1', 'Done: greet is fixed and the test passes.', 'final');
  // A helper's statement after the agent's: never the agent's message before yours.
  b.say('H1', 'Helper: I read greet.js.', 'working', 'h1');
  b.ask('I2', 'yes go');
  // Between your second and third messages only a helper speaks: no message of the agent's is before the third.
  b.say('H2', 'Helper: nothing more to read.', 'working', 'h1');
  b.ask('I3', 'done');
  b.say('F2', 'Noted.', 'final');
  b.ask('I4', 'Thanks, close it.');
  return b.session();
}
const asksReport = (session) => reviewOf(session, { requirements: [
  { text: 'fix greet for empty names', instruction: r('instruction', 'I1', 'Fix greet for empty names.'), status: 'done',
    deliverable: r('observation', 'R1-r', 'ok 1 - empty name gives the guest greeting') },
  { text: 'Go ahead with the greet fix', instruction: r('instruction', 'I2', 'yes go'), status: 'done',
    deliverable: r('code', 'W1', GREET) },
  { text: 'Mark it done', instruction: r('instruction', 'I3', 'done'), status: 'done',
    deliverable: r('commentary', 'F1', 'Done: greet is fixed and the test passes.') },
  // A quote the recording does not hold: no line says what does it.
  { text: 'close it', instruction: r('instruction', 'I4', 'Thanks, close it.'), status: 'done',
    deliverable: r('code', 'W1', 'export const greet = () => "nobody";') },
  // A second ask of the same message: its row never says the agent's message again.
  { text: 'say thanks', instruction: r('instruction', 'I4', 'Thanks'), status: 'done' }] });

test('D202 (a): a done ask says what does it, where it came from, and how the session review read your words', () => {
  const session = asksSession();
  const model = reportModel(session, asksReport(session), {});
  const lines = (n) => model.prompt.asks[n - 1].details.map((e) => [e.label, text(e.parts)]);
  assert.deepEqual(lines(1), [[REPORT_ITEM_WORDS.whatDoes, 'ok 1 - empty name gives the guest greeting'],
    [REPORT_ITEM_WORDS.fromRun, 'run 1 npm test'], [REPORT_PROMPT_WORDS.readAs, 'fix greet for empty names']]);
  assert.deepEqual(lines(2), [[REPORT_ITEM_WORDS.whatDoes, GREET], [REPORT_ITEM_WORDS.where, 'src/greet.js'],
    [REPORT_PROMPT_WORDS.readAs, 'Go ahead with the greet fix']]);
  // The agent's words: the quote and no place (its tag says whose words they are).
  assert.deepEqual(lines(3), [[REPORT_ITEM_WORDS.whatDoes, 'Done: greet is fixed and the test passes.'],
    [REPORT_PROMPT_WORDS.readAs, 'Mark it done']]);
  assert.deepEqual(model.prompt.asks[2].tags.map((t) => t.key), ['agentOnly']);
  // A quote that does not ground: nothing says what does it.
  assert.deepEqual(lines(4), [[REPORT_PROMPT_WORDS.readAs, 'close it']]);
  // The run's part is a link to its line; the quote is verbatim, the reading the session review's.
  const [does, from, read] = model.prompt.asks[0].details;
  assert.deepEqual([does.parts[0].quote, from.parts[0].href, read.parts[0].by], [true, 'run-1', 'session-review']);
});

test('D202 (a): the agent\'s message before yours is the last statement of its own, never a helper\'s, never across a message of yours', () => {
  const session = asksSession();
  const model = reportModel(session, asksReport(session), {});
  const before = model.prompt.messages.map((m) => (m.before ? text(m.before) : null));
  // Message 1 has none before it; message 2 the agent's closing words (the helper's after it skipped); message 3 none
  // (only a helper spoke since message 2); message 4 the agent's "Noted.".
  assert.deepEqual(before, [null, 'Done: greet is fixed and the test passes.', null, 'Noted.']);
  assert.ok(model.prompt.messages[1].before.every((p) => p.quote === true));
});

test('D202 (a): the page shows each row\'s evidence in its fold, the agent\'s message once a message; the .md under the table and in the message\'s fold', () => {
  const session = asksSession();
  const report = asksReport(session);
  const page = renderSessionPage(session, report, {});
  const md = renderReportMarkdown(session, report, {});
  const one = rowOf(page, 1);
  assert.ok(one.includes(`<div class="ad acts"><details class="evidence ae"><summary>${REPORT_ITEM_WORDS.evidence}</summary>`));
  assert.ok(one.includes(`<span class="label">${REPORT_ITEM_WORDS.whatDoes}</span> <q class="said">ok 1 - empty name gives`));
  assert.ok(one.includes('data-href="#run-1">run 1</label>'), 'the run, a link into What the agent did');
  assert.ok(rowOf(page, 2).includes(`<span class="label">${esc(REPORT_PROMPT_WORDS.agentBefore)}</span> <q class="said">Done: greet`));
  assert.equal(count(page, esc(REPORT_PROMPT_WORDS.agentBefore)), 2, 'messages 2 and 4, once each');
  assert.equal(rowOf(page, 4).includes(esc(REPORT_PROMPT_WORDS.agentBefore))
    + rowOf(page, 5).includes(esc(REPORT_PROMPT_WORDS.agentBefore)), 1, 'one row of message 4');
  // No item: every tier's tile is 0, so each takes no tier colour.
  assert.equal(count(page, 'tile must-act zero"') + count(page, 'tile must-know zero"')
    + count(page, 'tile good-to-know zero"'), 3);
  assert.equal(rowOf(page, 3).includes(esc(REPORT_PROMPT_WORDS.agentBefore)), false);
  // The .md: one fold under the table, an ask a line; the agent's message in its message's fold, before your words.
  assert.ok(md.includes(`<details><summary>${REPORT_ITEM_WORDS.evidence}</summary>\n\n- ask 1 · ${REPORT_ITEM_WORDS.whatDoes} `
    + '“ok 1 - empty name gives the guest greeting” · The result came from: run 1 `npm test` · '));
  assert.ok(md.includes(`${REPORT_PROMPT_WORDS.agentBefore} “Done: greet is fixed and the test passes.”\n\n> yes go`));
  assert.equal(md.includes('nobody'), false);
  assert.equal(page.includes('nobody'), false);
});

// ---- (b) a long prompt's done asks -------------------------------------------------------------------------------

test('D202 (b): a long prompt folds its other done asks, each a row with its evidence; every ask keeps one anchor', () => {
  const b = sessionBuilder();
  const rows = [];
  const n = REPORT_LIMITS.openAsks + 4;
  for (let a = 1; a <= n; a++) {
    b.ask(`I${a}`, `Case ${a} please.`);
    b.change(`W${a}`, `src/c${a}.js`, { after: `export const c${a} = ${a};\n` });
    b.say(`S${a}`, `Case ${a} is in.`);
    rows.push({ text: `case ${a}`, instruction: r('instruction', `I${a}`, `Case ${a} please.`),
      status: a === 1 ? 'not-done' : 'done', ...(a === 1 ? { shortfall: r('commentary', `S${a}`, `Case ${a} is in.`) }
        : { deliverable: a % 2 ? r('commentary', `S${a}`, `Case ${a} is in.`) : r('code', `W${a}`, `export const c${a} = ${a};`) }) });
  }
  const session = b.session();
  const page = renderSessionPage(session, reviewOf(session, { requirements: rows }), {});
  const done = rows.filter((x, at) => at > 0 && at % 2 === 1).length;
  assert.ok(page.includes(`<summary>${esc(REPORT_PROMPT_WORDS.otherDoneFold(done))}</summary>`));
  assert.ok(page.includes(`<summary>${esc(REPORT_PROMPT_WORDS.agentOnlyFold(n - 1 - done))}</summary>`));
  for (let a = 1; a <= n; a++) assert.equal(count(page, ` id="ask-${a}"`), 1, `ask ${a}`);
  assert.ok(rowOf(page, 2).includes(`<span class="label">${REPORT_ITEM_WORDS.where}</span> <code>src/c2.js</code>`));
  assert.ok(page.includes(esc(REPORT_PROMPT_WORDS.listedAsks(1, n))));
});

// ---- (c) a decision's recorded actions --------------------------------------------------------------------------

test('D202 (c): a decision shows its recorded actions in the recorded order, a run with its command, past the bound counted', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Ship the build.');
  b.run('R1', 'npm run build', 'succeeded');
  b.change('W1', 'dist/index.js', { after: 'x\n' });
  // D204: the tool name as the recorder wrote it (Claude Code's `Write`), never the slicer's kind of call.
  b.events.find((e) => e.id === 'W1').recorded = { tool: 'Write' };
  for (let k = 2; k <= 7; k++) b.run(`R${k}`, `npm run step${k}`, 'succeeded');
  b.say('F1', 'Shipped.', 'final');
  const session = b.session();
  const decision = { id: `sha256:${'d'.repeat(64)}`, dimension: 'build output', chosen: 'rebuild dist', column: 'unasked',
    columnState: 'grounded', actions: ['R3', 'W1', 'R1', 'R2', 'R1', 'R4', 'R5', 'R6', 'R7'], stated: null };
  const report = reviewOf(session, { decisions: [decision] });
  const item = reportItems(reportModel(session, report, {})).find((i) => i.kind === 'decision_unasked');
  const acts = item.evidence.filter((e) => e.label === REPORT_ITEM_WORDS.actions || (e.label === null
    && (e.parts[0]?.href?.startsWith('run-') || e.parts[0]?.code)));
  // Each action once, in the recording's order: run 1, the write's tool and file, runs 2 to 4; then the rest counted.
  assert.deepEqual(acts.map((e) => text(e.parts)), ['run 1 npm run build', 'Write dist/index.js', 'run 2 npm run step2',
    'run 3 npm run step3', 'run 4 npm run step4']);
  assert.equal(acts[0].label, REPORT_ITEM_WORDS.actions);
  assert.ok(item.evidence.some((e) => text(e.parts) === REPORT_ITEM_WORDS.moreActions(3)));
  const md = renderReportMarkdown(session, report, {});
  assert.ok(md.includes(`- ${REPORT_ITEM_WORDS.actions} run 1 \`npm run build\``), md);
});

// ---- (d) tags, legend and small fixes on the fixture's review ---------------------------------------------------

test('D202 (d): the untied question\'s tag, the code review\'s lines\' tag, and each tag\'s sentence in the opened row', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const model = reportModel(session, report, repoFacts());
  const page = renderSessionPage(session, report, repoFacts());
  const md = renderReportMarkdown(session, report, repoFacts());
  const untied = reportItems(model).filter((i) => i.tags.some((t) => t.key === 'untied'));
  assert.ok(untied.length >= 1 && untied.every((i) => i.kind === 'code_question'));
  assert.equal(count(md, ` · ${REPORT_DECISION_TAGS.untied}`), untied.length);
  assert.equal(count(page, `<p class="line tag-why kv"><span class="label">${REPORT_DECISION_TAGS.untied}</span> `
    + `<span class="v">${esc(REPORT_ITEM_WORDS.untied)}</span></p>`), untied.length);
  // Every impact and action line carries its tag, on the page (body or row) and in the .md.
  const lined = reportItems(model).filter((i) => i.impact || i.action);
  assert.ok(lined.length >= 5);
  const tags = count(page, `${esc(REPORT_ITEM_WORDS.formTag)} <span class="tip">${esc(REPORT_ITEM_WORDS.formWhy)}</span>`);
  assert.equal(tags, lined.reduce((n, i) => n + (i.impact ? 1 : 0) + (i.action ? 1 : 0), 0));
  assert.equal(count(md, ` · ${REPORT_ITEM_WORDS.formTag}`), tags);
  // Every tag of a row has its sentence in the row's body once.
  for (const item of reportItems(model)) for (const t of item.tags.filter((x) => x.words)) {
    const at = page.indexOf(`id="item-${item.n}"`);
    const next = page.indexOf(' id="item-', at + 1);
    const block = page.slice(at, next > 0 ? next : undefined);
    assert.equal(count(block, `<span class="label">${esc(REPORT_DECISION_TAGS[t.key])}</span> <span class="v">${esc(t.words)}`),
      1, `item ${item.n} ${t.key}`);
  }
});

test('D202 (d), its review: an untied question carries its tag at every proposed level, checked or not', () => {
  const session = reportSession();
  const base = triagedReport(session);
  for (const level of ['high', 'low', null]) for (const check of [true, false]) {
    const report = structuredClone(base);
    const q = report.codePass.questions[0];
    q.concerns = null;
    if (!check) delete q.check;
    report.codePass.triage = report.codePass.triage.filter((e) => e.ref.question !== q.id);
    if (level) report.codePass.triage.push({ ref: { question: q.id }, level, impact: 'x', action: 'y', label: 'z', where: null });
    report.codePass.questions = [q];
    const items = reportItems(reportModel(session, report, repoFacts())).filter((i) => i.kind === 'code_question');
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].tier.final, items[0].tags.map((t) => t.key)], ['good_to_know', ['untied']], `${level} ${check}`);
  }
});

test('D202 (d): a lead quote is said once, the legend explains the tags, the bar follows its words, a 0 tile is plain, a radio names its count', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const model = reportModel(session, report, repoFacts());
  const page = renderSessionPage(session, report, repoFacts());
  for (const item of reportItems(model).filter((i) => i.leadQuote && i.quote)) {
    const at = page.indexOf(`id="item-${item.n}"`);
    const block = page.slice(at, page.indexOf(' id="item-', at + 1) > 0 ? page.indexOf(' id="item-', at + 1) : undefined);
    assert.equal(count(block, `<q class="said">${esc(item.quote.text)}</q>`), 1, `item ${item.n}`);
  }
  const legend = page.slice(page.indexOf('<details class="fold legend">'));
  for (const line of [REPORT_FOOTER_WORDS.legendTypes, REPORT_FOOTER_WORDS.legendTypesMore, REPORT_FOOTER_WORDS.legendRowTags,
    REPORT_FOOTER_WORDS.legendTags, REPORT_FOOTER_WORDS.legendCounts, REPORT_FOOTER_WORDS.legendBar])
    assert.ok(legend.includes(`<p>${esc(line)}</p>`), line);
  // The bar's segments in the order of the count line's words: each segment's state said in words is the line's part.
  const bar = /<span class="bar"[^>]*>([\s\S]*?)<\/span>/.exec(page)[1];
  const drawn = [...bar.matchAll(/class="s-([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(drawn.map((state) => REPORT_PROMPT_PARTS[state](model.prompt.counts[state])), model.prompt.parts);
  assert.ok(drawn.length >= 3);
  // The tiers' tiles: a 0 tile has the class that takes the tier's colour away; the others not.
  for (const t of model.countLine.tiers) {
    const tile = new RegExp(`tile ${t.tier.replace(/_/g, '-')}( zero)?"`).exec(page);
    assert.equal(Boolean(tile?.[1]), t.n === 0, t.tier);
  }
  assert.ok(page.includes(`aria-label="${REPORT_TAB_WORDS.prompt} ${model.prompt.asks.length}"`));
});

test('D202 (d): "after ask N" links to the ask, and a gap\'s messages are every number, a run of three or more as its ends', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const page = renderSessionPage(session, report, repoFacts());
  const model = reportModel(session, report, repoFacts());
  const entries = model.decisions.groups.flatMap((g) => g.entries).filter((e) => e.after && Number.isSafeInteger(e.afterAsk));
  assert.ok(entries.length >= 1);
  for (const e of entries) assert.ok(page.includes(`data-href="#ask-${e.afterAsk}">${esc(e.after)}</label>`), e.after);
  assert.equal(REPORT_NOT_CHECKED_WORDS.gapsOfMessages([1, [3, 9], 12, [14, 70]], 'a check could not run'),
    'In messages 1, 3 to 9, 12 and 14 to 70: a check could not run.');
  assert.equal(REPORT_NOT_CHECKED_WORDS.gapsOfMessages([[1, 3]], 'x'), 'In messages 1 to 3: x.');
});

// ---- its review ----------------------------------------------------------------------------------------------------

test('D202, its review: a run an ask\'s evidence names is listed on the page and in the .md, quiet or not', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Report the node version.');
  b.run('R1', 'node --version', 'succeeded', 'v20.11.0');
  b.say('F1', 'It is v20.', 'final');
  const session = b.session();
  const report = reviewOf(session, { requirements: [{ text: 'report node version', instruction: r('instruction', 'I1',
    'Report the node version.'), status: 'done', deliverable: r('observation', 'R1-r', 'v20.11.0') }] });
  const model = reportModel(session, report, {});
  assert.deepEqual([model.did.runs.shown.length, model.did.runs.named.map((x) => x.k)], [0, [1]]);
  const page = renderSessionPage(session, report, {});
  const md = renderReportMarkdown(session, report, {});
  assert.equal(count(page, 'id="run-1"'), 1);
  assert.ok(rowOf(page, 1).includes('data-href="#run-1">run 1</label>'));
  assert.ok(md.includes('\n- run 1 · `node --version` · exit code 0'), md);
});

test('D202, its review: a helper\'s statement cited as what does an ask is the helper\'s', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Add the guard.');
  b.say('H1', 'Helper: the guard is in.', 'working', 'h1');
  const session = b.session();
  const asks = reportModel(session, reviewOf(session, { requirements: [
    { text: 'add the guard', instruction: r('instruction', 'I1', 'Add the guard.'), status: 'done',
      deliverable: r('commentary', 'H1', 'Helper: the guard is in.') }] }), {}).prompt.asks;
  assert.equal(asks[0].details[0].label, REPORT_ITEM_WORDS.helperSaid);
});

test('D202, its review: no agent\'s message before an answer to its question or a queued message; a long one keeps its end', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Set up the database.');
  b.say('C1', `I set up the schema. ${'More detail on the migration steps follows here. '.repeat(8)}Should I use SQLite?`);
  b.ask('I2', 'yes');
  b.say('C2', 'Which port?');
  b.ask('I3', '8080');
  b.events.at(-1).markers = ['answer'];
  b.events.at(-1).answerTo = 'Q1';
  b.say('C3', 'Working on it.');
  b.ask('I4', 'also add logs');
  b.events.at(-1).markers = ['queued'];
  const session = b.session();
  const model = reportModel(session, reviewOf(session, { requirements: [] }), {});
  const before = Object.fromEntries(model.prompt.messages.concat(model.prompt.emptyMessages)
    .map((m) => [m.k, m.before ? text(m.before) : null]));
  assert.equal(model.prompt.messages.length + model.prompt.emptyMessages.length, 4);
  const asked = reportModel(session, reviewOf(session, { requirements: [
    { text: 'db', instruction: r('instruction', 'I1', 'Set up the database.'), status: 'done' },
    { text: 'use sqlite', instruction: r('instruction', 'I2', 'yes'), status: 'done' },
    { text: 'port', instruction: r('instruction', 'I3', '8080'), status: 'done' },
    { text: 'logs', instruction: r('instruction', 'I4', 'also add logs'), status: 'done' }] }), {});
  const of = (k) => asked.prompt.messages.find((m) => m.k === k)?.before ?? null;
  assert.equal(of(3), null, 'an answer to the agent\'s question');
  assert.equal(of(4), null, 'a message queued while the agent worked');
  // The end of a long statement, its cut said by Sonah's "…" before the quote.
  const two = of(2);
  assert.equal(two[0].text, '…');
  assert.equal(two[0].quote, false);
  assert.ok(two[1].quote && two[1].text.endsWith('Should I use SQLite?') && [...two[1].text].length < REPORT_LIMITS.messageChars);
  assert.ok(before);
});

test('D202, its review: a page within its bound opens each ask\'s evidence fold to its lines and says no trim', () => {
  const session = asksSession();
  const report = asksReport(session);
  const page = renderSessionPage(session, report, {});
  assert.ok(rowOf(page, 1).includes('<details class="evidence ae"><summary>Evidence</summary><p class="line">'));
  assert.equal(page.includes(REPORT_TRIM_WORDS.askEvidenceTrimmed), false);
});

// ---- its second review ---------------------------------------------------------------------------------------------

test('D202, its second review: "and N more actions" counts the actions left out, never the lines', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Ship it.');
  for (let k = 1; k <= 6; k++) b.run(`R${k}`, `npm run s${k}`, 'succeeded');
  b.change('W0', 'src/a.js', { after: 'x\n' });
  for (let k = 1; k <= 10; k++) b.change(`E${k}`, 'src/a.js', { operation: 'edit', after: `x${k}\n`, before: 'x\n' });
  for (const e of b.events) if (/^(W0|E\d+)$/.test(e.id)) e.recorded = { tool: e.id === 'W0' ? 'Write' : 'Edit' };
  const session = b.session();
  const decision = { id: `sha256:${'e'.repeat(64)}`, dimension: 'release', chosen: 'ship now', column: 'unasked',
    columnState: 'grounded', stated: null, actions: [...[1, 2, 3, 4, 5, 6].map((k) => `R${k}`), 'W0',
      ...Array.from({ length: 10 }, (_, k) => `E${k + 1}`)] };
  const item = reportItems(reportModel(session, reviewOf(session, { decisions: [decision] }), {}))
    .find((i) => i.kind === 'decision_unasked');
  const lines = item.evidence.map((e) => text(e.parts));
  // Runs 1 to 5 shown; run 6, the create and the ten edits (two lines, eleven actions and one run) left out: 12.
  assert.deepEqual(lines.filter((l) => l.startsWith('run ')), ['run 1 npm run s1', 'run 2 npm run s2', 'run 3 npm run s3',
    'run 4 npm run s4', 'run 5 npm run s5']);
  assert.ok(lines.includes(REPORT_ITEM_WORDS.moreActions(12)), lines.join(' | '));
});

test('D202, its second review: a statement of white space is no statement; the end cut never splits a mark', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Set it up.');
  b.say('C1', 'I set it up. Should I also add logging?');
  b.say('C2', '\n\n');
  b.ask('I2', 'yes');
  // The 299 characters kept begin with an invisible one, which shows as its whole mark.
  b.say('C3', `${'a'.repeat(50)}\u200b${'b'.repeat(298)}`);
  b.ask('I3', 'ok');
  const session = b.session();
  const model = reportModel(session, reviewOf(session, { requirements: [
    { text: 'set up', instruction: r('instruction', 'I1', 'Set it up.'), status: 'done' },
    { text: 'add logging', instruction: r('instruction', 'I2', 'yes'), status: 'done' },
    { text: 'fine', instruction: r('instruction', 'I3', 'ok'), status: 'done' }] }), {});
  const before = (k) => model.prompt.messages.find((m) => m.k === k).before;
  assert.equal(text(before(2)), 'I set it up. Should I also add logging?');
  const cut = before(3);
  assert.equal(cut[0].text, '…');
  assert.ok(cut[1].text.startsWith('‹U+200B›b') && cut[1].text.endsWith('b'), cut[1].text.slice(0, 30));
});

test('D202, its second review: the page\'s own legend lines only where the page shows what they explain; a Must know tile with decisions keeps its colour', () => {
  const session = asksSession();
  const page = renderSessionPage(session, asksReport(session), {});
  const legend = page.slice(page.indexOf('<details class="fold legend">'));
  assert.equal(legend.includes(esc(REPORT_FOOTER_WORDS.legendRowTags)), false, 'no row tag on this page');
  assert.ok(legend.includes(esc(REPORT_FOOTER_WORDS.legendBar)));
  const empty = renderSessionPage(session, reviewOf(session, {}), {});
  assert.equal(empty.includes(esc(REPORT_FOOTER_WORDS.legendBar)), false, 'no ask, no bar');
  const fixture = reportSession();
  const model = reportModel(fixture, triagedReport(fixture), repoFacts());
  const full = renderSessionPage(fixture, triagedReport(fixture), repoFacts());
  assert.ok(full.includes(esc(REPORT_FOOTER_WORDS.legendRowTags)));
  assert.ok(model.countLine.tiers.length === 3);
  // A Must know tile at 0 with a decision tagged Must know under it (a decision you did not ask for) is no plain 0.
  const b = sessionBuilder();
  b.ask('I1', 'Ship the build.');
  b.run('R1', 'npm run build', 'succeeded');
  const one = b.session();
  const decided = reviewOf(one, { decisions: [{ id: `sha256:${'a'.repeat(64)}`, dimension: 'build', chosen: 'rebuild',
    column: 'unasked', columnState: 'grounded', actions: ['R1'], stated: null }] });
  const m = reportModel(one, decided, {});
  assert.deepEqual([m.countLine.tiers.find((t) => t.tier === 'must_know').n, m.pointers.must_know.length], [0, 1]);
  const tiles = renderSessionPage(one, decided, {});
  assert.ok(tiles.includes('tile must-know"') && tiles.includes('tile good-to-know zero"'));
  assert.equal(REPORT_PROMPT_WORDS.listedAsks(3, 42, true).endsWith('The folds and your messages below hold the rest.'), true);
});
