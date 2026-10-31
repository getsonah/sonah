// D144 (0.3.0-beta.7; the owner, 2026-10-23): a prompt for the agent under each item that leads in
// Must act — your words and the quotes Sonah checked, labelled in your voice, and one closing line — made by the report
// model from the item's own checked parts alone, folded on the page (a block one click selects; D199: in a box with a
// copy button) and in the .md (a fence). Its invariants on every report shape, a fixture per covered kind, the closed reasons a Must act
// item has none, the folds, and the snapshots rendered back. Every session and report here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { reportModel, agentPromptOf, agentPromptText, agentPromptLabelOf, AGENT_PROMPT_KINDS, AGENT_PROMPT_LABELS,
  placeTextOf, REPORT_LIMITS, reportItems } from '../report-model.js';
import { renderReportMarkdown } from '../session-story.js';
import { renderSessionPage, sessionPage, escapeHtml, PAGE_CSS, PAGE_LIMITS, PAGE_SCRIPT, PAGE_SCRIPT_HASH }
  from '../session-page.js';
import { REPORT_AGENT_PROMPT_WORDS as W, REPORT_ITEM_WORDS, REPORT_TRIM_WORDS } from '../report-words.js';
import { AGENT_PROMPT_NONE_REASONS, REPORT_ITEM_KINDS, REPORT_TIERS } from '../../evidence/src/ledger.js';
import { ITEM_KIND_TABLE } from '../../evidence/src/triage.js';
import { REPORT_SHAPES, reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const [MUST_ACT] = REPORT_TIERS;
const sha = (text) => createHash('sha256').update(text).digest('hex');
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const windowOf = (session) => [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }];
const items = (model) => reportItems(model);
/** The triaged report with the code review proposing high for the contradicted statement in a file (a Must know kind by
 *  default), so it leads in Must act too: every covered kind has an item. */
function everyKind(session) {
  const report = triagedReport(session);
  report.codePass.triage = [...report.codePass.triage, { ref: { source: 'writtenClaims', index: 1,
    id: report.writtenClaims[1].id }, level: 'high', impact: 'The docs promise the wrong status.',
  action: 'Write the 429 status into the docs.', label: 'fix the 503 line', where: null }];
  return report;
}
/** The triaged report whose ask done only in part cites what does it in words the recording does not hold: its item
 *  says in Sonah's words that Sonah found nothing that does the rest, under the same label a quote would have. */
function deliverableUnfound(session) {
  const report = triagedReport(session);
  report.requirements[3] = { ...report.requirements[3], deliverable: { ...report.requirements[3].deliverable,
    quote: 'I reverted every CI change twice.' } };
  return report;
}
/** Every recorded text of a session (its events, and the project instruction files the harness gave the agent), as the
 *  report shows a quote of it (on one line). */
const recordedTexts = (session) => [...session.events, ...session.projectInstructions]
  .flatMap((event) => session.sourcesFor(event))
  .filter((s) => typeof s?.text === 'string').map((s) => s.text.replace(/\n/g, ' '));
/** The prompt's label for each label that the page shows on a quote, written out here, apart from the builder's map: your
 *  words become "I …", the agent's "You …", and the others keep their sense. */
const PAGE_TO_PROMPT = Object.freeze({ 'You said:': 'I said:', 'The agent said:': 'You said:',
  'The agent told you:': 'You told me:', 'The agent did:': 'You did:', 'The agent wrote:': 'You wrote:',
  'The agent ran:': 'You ran:', 'The agent removed:': 'You removed:', 'A helper said:': 'A helper said:',
  'A recorded result shows:': 'A recorded result shows:', 'The change shows:': 'The change shows:',
  'Code written:': 'Code written:', 'What does it:': 'This does part of it:' });
/** An item's own quote that the page shows with no label: whose words its what line says they are. */
const UNLABELLED = Object.freeze({ ask_not_done: 'I asked:', ask_partly_done: 'I asked:', claim_contradicted: 'You said:',
  written_contradicted: 'You wrote this into a file:' });
/** The prompt label that a quote Part of an item should have, read from what the item shows for it: its own quote's
 *  label, or its evidence line's (D185: every line's label says whose words or what record its quote is). */
function expectedLabel(item, part) {
  const line = part === item.quote ? null : item.evidence.find((e) => e.parts.length === 1 && e.parts[0] === part);
  const shown = part === item.quote ? item.quoteLabel : line ? line.label : undefined;
  if (shown === undefined) return undefined;
  if (shown === null) return UNLABELLED[item.kind] ?? null;
  const file = /^The project instruction file (.+) says:$/.exec(shown);
  return file ? `The project instruction file ${file[1]} says:` : PAGE_TO_PROMPT[shown] ?? null;
}
/** A verbatim quote Part, as the report model makes one. */
const said = (text, cut = false) => ({ text, by: 'sonah', code: false, quote: true, cut, href: null });
/** Every string of the prompt table (its functions left out). */
const tableStrings = (table) => Object.values(table).flatMap((v) => (typeof v === 'string' ? [v] : plain(v)
  ? tableStrings(v) : []));

test('D144: a prompt per covered kind, in your voice, from the item\'s own checked parts', () => {
  const session = reportSession();
  const model = reportModel(session, everyKind(session), repoFacts());
  const byKind = Object.fromEntries(model.tiers.must_act.map((item) => [item.kind, item]));
  const text = (kind) => agentPromptText(byKind[kind].agentPrompt);
  const fix = `${W.fix} ${W.reason}`;
  assert.equal(text('ask_not_done'), ['I asked: “Also add a test for the limiter”', 'You did not do it.',
    'You said: “I added no test yet.”', fix].join('\n'));
  assert.equal(text('ask_partly_done'), ['I asked: “Do not change the CI config”', 'You did only part of it.',
    'This does part of it: “I reverted the CI change.”', 'The change shows: “run: npm test --silent”',
    'Where: `.github/workflows/ci.yml`', fix].join('\n'));
  assert.equal(text('claim_contradicted'), ['You said: “The limiter uses Redis.”',
    'A recorded result shows: “connect ECONNREFUSED”', `${W.check} ${W.holds}`].join('\n'));
  assert.equal(text('edit_against_instruction'), ['I said: “Do not change the CI config”',
    'You wrote: “run: npm test --silent”', 'Where: `.github/workflows/ci.yml`', fix].join('\n'));
  assert.equal(text('written_contradicted'), ['You wrote this into a file: “The limiter answers with 503 when it is full.”',
    'A recorded result shows: “Tests: 1 failed, 4 passed”', 'Where: `docs/limits.md`', fix].join('\n'));
  // The code review's kinds: its title and its action, each under the label that names them as its words.
  assert.equal(text('code_bug'), ['The code review says: The bucket refills before the first request',
    'The code review\'s action: Refill the bucket after the first request.', 'Where: `src/limiter.js:2-3`', fix].join('\n'));
  assert.equal(text('code_ask_not_met'), ['The code review says: Retry-After is sent in milliseconds',
    'Where: `src/limiter.js:5`', fix].join('\n'));
  assert.equal(text('code_claim_false'), ['The code review says: The CI change is still there',
    'You said: “I reverted the CI change.”', 'Where: `.github/workflows/ci.yml:1`', fix].join('\n'));
  assert.equal(text('code_contract'), ['The code review says: The server mounts the limiter after a route',
    'Where: `src/server.js:2`', fix].join('\n'));
  // Every covered kind has a fixture here; a kind with no prompt in this cut says so by its closed reason.
  assert.deepEqual(Object.keys(AGENT_PROMPT_KINDS).filter((kind) => !byKind[kind]?.agentPrompt), []);
  // D161: the decision the code review rated high keeps its tag Must act in the report's second part. D163: it gets its
  // prompt as any item in Must act of its kind does: a decision's kind has none in this cut, so its closed reason.
  const decision = items(model).find((item) => item.kind === 'decision_unasked' && item.tier.final === 'must_act');
  assert.equal(model.tiers.must_act.includes(decision), false);
  assert.deepEqual([decision.agentPrompt, decision.agentPromptNone], [null, 'kind_not_covered']);
  // The kinds that have a prompt are kinds that can lead in Must act, each with the closing line of its type.
  for (const [kind, how] of Object.entries(AGENT_PROMPT_KINDS)) {
    assert.ok(REPORT_ITEM_KINDS.includes(kind) && ITEM_KIND_TABLE[kind].ceiling !== 'must_know', kind);
    assert.equal(how.close, ITEM_KIND_TABLE[kind].type === 'verify' ? 'verify' : 'fix', kind);
  }
});

test('D144: the invariants hold on every report shape', () => {
  const shapes = { ...REPORT_SHAPES, everyKind, deliverableUnfound };
  let prompts = 0;
  for (const [name, shape] of Object.entries(shapes)) {
    const session = reportSession();
    const report = shape(session);
    const model = reportModel(session, report, repoFacts());
    const texts = recordedTexts(session);
    const words = new Set([...tableStrings(W), ' ', ', ']);
    for (const item of items(model)) {
      const at = `${name} item ${item.n} ${item.kind}`;
      // A member never has a prompt (items that lead only).
      for (const member of item.members) assert.equal(Object.hasOwn(member, 'agentPrompt'), false, at);
      // D163: an item of the agent's decisions tagged Must act is read as any item in Must act (D161 gave it none).
      if (item.tier.final !== MUST_ACT) {
        assert.deepEqual([item.agentPrompt, item.agentPromptNone], [null, null], at);
        continue;
      }
      // A prompt exists if and only if its kind is covered and the quotes it needs ground; else a closed reason.
      assert.equal((item.agentPrompt === null) === (item.agentPromptNone !== null), true, at);
      assert.deepEqual(agentPromptOf(item), { prompt: item.agentPrompt, none: item.agentPromptNone }, at);
      if (!Object.hasOwn(AGENT_PROMPT_KINDS, item.kind)) assert.equal(item.agentPromptNone, 'kind_not_covered', at);
      if (item.agentPrompt === null) { assert.ok(AGENT_PROMPT_NONE_REASONS.includes(item.agentPromptNone), at); continue; }
      prompts += 1;
      const quotes = new Set([item.quote, item.agentSaid, ...item.evidence.flatMap((e) => e.parts)]
        .filter((p) => plain(p) && p.quote === true));
      const places = new Set(item.where.filter((w) => typeof w.path === 'string').map(placeTextOf));
      for (const line of item.agentPrompt.lines) for (const part of line) {
        if (part.quote) {
          // Every quote is a Part of the item that Sonah found again in this session, at most 120 characters, there.
          assert.ok(quotes.has(part), `${at}: a quote of the item`);
          assert.ok([...part.text].length <= REPORT_LIMITS.quoteChars, at);
          assert.ok(texts.some((t) => t.includes(part.text)), `${at}: found literally`);
          // Its label is the prompt's words for the label the item shows on that quote (read apart from the builder).
          assert.equal(line[0].text, expectedLabel(item, part), `${at}: ${part.text}`);
          assert.equal(agentPromptLabelOf(item, part), line[0].text, at);
          // A cut quote keeps its mark, outside the quotation marks.
          assert.ok(agentPromptText({ lines: [line] }).includes(`“${part.text}”${part.cut ? '…' : ''}`), at);
        } else if (part.code) assert.ok(places.has(part.text), `${at}: a place the item shows`);
        else if (part.by === 'code-review') {
          // The code review's words, unchanged (the item's own Part), under the label that names them as its words.
          assert.ok(part === item.what.parts[0] || part === item.action?.[0], at);
          assert.equal(line[0].text, part === item.what.parts[0] ? W.codeReviewSays : W.codeReviewAction, at);
        } else {
          assert.equal(part.by, 'sonah', at);
          assert.ok(words.has(part.text) || [...quotes].some((q) => agentPromptLabelOf(item, q) === part.text), at);
        }
      }
    }
    // The same inputs give the same bytes.
    const again = reportModel(session, shape(session), repoFacts());
    assert.equal(JSON.stringify(items(again).map((x) => x.agentPrompt)), JSON.stringify(items(model).map((x) => x.agentPrompt)));
    assert.equal(renderReportMarkdown(session, report, repoFacts()), renderReportMarkdown(session, shape(session), repoFacts()));
    assert.equal(renderSessionPage(session, report, repoFacts()), renderSessionPage(session, shape(session), repoFacts()));
  }
  assert.ok(prompts >= 30, `${prompts} prompts checked`);
  // A line of Sonah's own words under a quote's label (what does the ask: Sonah found nothing) is no quote: the prompt
  // leaves it out, and says only what the item's quotes say.
  const session = reportSession();
  const partly = reportModel(session, deliverableUnfound(session), repoFacts()).tiers.must_act
    .find((item) => item.kind === 'ask_partly_done');
  assert.ok(partly.evidence.some((e) => e.label === REPORT_ITEM_WORDS.whatDoes && !e.parts.some((p) => p.quote)));
  assert.equal(agentPromptText(partly.agentPrompt), ['I asked: “Do not change the CI config”', 'You did only part of it.',
    'The change shows: “run: npm test --silent”', 'Where: `.github/workflows/ci.yml`', `${W.fix} ${W.reason}`].join('\n'));
});

test('D144: no prompt without the quotes it needs, each by its closed reason', () => {
  assert.deepEqual(AGENT_PROMPT_NONE_REASONS, ['kind_not_covered', 'quote_not_found', 'evidence_not_found',
    'title_missing', 'label_not_covered']);
  const b = sessionBuilder();
  b.ask('I1', 'Add a cache. Keep the API as it is.');
  b.say('C1', 'The cache works.');
  b.run('R1', 'npm test', 'failed', '2 failed');
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const model = reportModel(session, { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [
      // Its ask's words are not in your message: the item shows that Sonah did not find them.
      { text: 'add a cache', instruction: r('instruction', 'I1', 'Add a big cache.'), status: 'not-done',
        shortfall: r('commentary', 'F1', 'Done.') }],
    findings: [
      // The result that contradicts the claim is not in the recording.
      { id: `sha256:${'1'.repeat(64)}`, origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
        contradictionSource: 'result', title: 'Claim contradicted', receipts: [r('commentary', 'C1', 'The cache works.'),
          r('observation', 'R1-r', '3 failed')] },
      // Both quotes ground: it has its prompt.
      { id: `sha256:${'2'.repeat(64)}`, origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
        contradictionSource: 'result', title: 'Claim contradicted', receipts: [r('commentary', 'C1', 'The cache works.'),
          r('observation', 'R1-r', '2 failed')] }] }, {});
  const reasons = model.tiers.must_act.map((item) => [item.kind, item.agentPromptNone]);
  assert.deepEqual(reasons.sort(), [['ask_not_done', 'quote_not_found'], ['claim_contradicted', 'evidence_not_found'],
    ['claim_contradicted', null]].sort());
  // A kind of the code review with no title of its own, and a quote whose label the prompt has no words for: by the
  // pure builder, on the item's own fields.
  const quote = { text: 'x', by: 'sonah', code: false, quote: true, cut: false, href: null };
  const title = { text: 'The code review gave no title for this.', by: 'sonah', code: false, quote: false, cut: false, href: null };
  assert.equal(agentPromptOf({ kind: 'code_bug', what: { parts: [title] }, where: [], evidence: [] }).none, 'title_missing');
  assert.equal(agentPromptOf({ kind: 'claim_contradicted', quote, quoteLabel: null, where: [],
    evidence: [{ label: 'Someone else says:', parts: [{ ...quote, text: 'y' }] }] }).none, 'label_not_covered');
  assert.equal(agentPromptOf({ kind: 'pivot' }).none, 'kind_not_covered');
  // A project instruction file's label keeps its path, in the prompt's own words.
  const file = agentPromptOf({ kind: 'edit_against_instruction', quote, quoteLabel: REPORT_ITEM_WORDS.referredFrom('AGENTS.md'),
    where: [], evidence: [{ label: REPORT_ITEM_WORDS.breach.ran, parts: [{ ...quote, text: 'npm i left-pad' }] }] });
  assert.equal(agentPromptText(file.prompt).split('\n')[0], `${W.projectFile('AGENTS.md')} “x”`);
  // An edit against your words with no grounded act of the agent's (only what it told you) has none.
  assert.equal(agentPromptOf({ kind: 'edit_against_instruction', quote, quoteLabel: REPORT_ITEM_WORDS.youSaid, where: [],
    evidence: [{ label: REPORT_ITEM_WORDS.agentTold, parts: [{ ...quote, text: 'z' }] }] }).none, 'evidence_not_found');
});

test('D144: the prompt\'s labels are in your voice, one closed map from the item\'s labels, pinned whole', () => {
  // The map as built equals the table written out here, entry for entry (by the words each side shows).
  assert.deepEqual(Object.fromEntries(Object.entries(AGENT_PROMPT_LABELS).map(([label, key]) => [label, W[key]])),
    PAGE_TO_PROMPT);
  for (const label of Object.keys(AGENT_PROMPT_LABELS))
    assert.ok(Object.values(REPORT_ITEM_WORDS).flatMap((v) => (plain(v) ? Object.values(v) : [v])).includes(label), label);
  // D185: what is missing from an ask is no label at all: that quote is labelled by its role, on the item too.
  assert.equal(Object.hasOwn(REPORT_ITEM_WORDS, 'whatMissing'), false);
  // Each label on a prompt built from the item alone, exact: the agent's acts and words, your words, a helper's (whose
  // label wins over the kind's own), a recorded result, the change, code written, a project instruction file.
  const head = (item) => agentPromptText(agentPromptOf({ where: [], ...item }).prompt).split('\n');
  const edit = (label, text) => head({ kind: 'edit_against_instruction', quote: said('Do not touch the CI file.'),
    quoteLabel: REPORT_ITEM_WORDS.youSaid, evidence: [{ label, parts: [said(text)] }] })[1];
  assert.equal(edit(REPORT_ITEM_WORDS.agentDid, 'git rm ci.yml'), 'You did: “git rm ci.yml”');
  assert.equal(edit(REPORT_ITEM_WORDS.breach.ran, 'git rm ci.yml'), 'You ran: “git rm ci.yml”');
  assert.equal(edit(REPORT_ITEM_WORDS.breach.removed, 'ci.yml'), 'You removed: “ci.yml”');
  const told = head({ kind: 'edit_against_instruction', quote: said('Do not touch the CI file.'),
    quoteLabel: REPORT_ITEM_WORDS.youSaid, evidence: [{ label: REPORT_ITEM_WORDS.breach.wrote, parts: [said('x: 1')] },
      { label: REPORT_ITEM_WORDS.agentTold, parts: [said('I changed the CI file.')] }] });
  assert.deepEqual(told.slice(0, 3), ['I said: “Do not touch the CI file.”', 'You wrote: “x: 1”',
    'You told me: “I changed the CI file.”']);
  const claim = (quoteLabel, label, text) => head({ kind: 'claim_contradicted', quote: said('It works.'), quoteLabel,
    evidence: [{ label, parts: [said(text)] }] }).slice(0, 2);
  assert.deepEqual(claim(REPORT_ITEM_WORDS.helperSaid, REPORT_ITEM_WORDS.recordedResult, '2 failed'),
    ['A helper said: “It works.”', 'A recorded result shows: “2 failed”']);
  assert.deepEqual(claim(null, REPORT_ITEM_WORDS.changeShows, 'return 0;'),
    ['You said: “It works.”', 'The change shows: “return 0;”']);
  assert.deepEqual(claim(null, REPORT_ITEM_WORDS.codeWritten, 'return 0;'),
    ['You said: “It works.”', 'Code written: “return 0;”']);
  assert.deepEqual(claim(null, REPORT_ITEM_WORDS.youSaid, 'It does not work.'),
    ['You said: “It works.”', 'I said: “It does not work.”']);
  assert.deepEqual(claim(null, REPORT_ITEM_WORDS.referredFrom('AGENTS.md'), 'Never mock.'),
    ['You said: “It works.”', 'The project instruction file AGENTS.md says: “Never mock.”']);
});

test('D144: an ask done only in part labels its shortfall\'s quote by its role, never as the missing part', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Add retries and a timeout to the client.');
  b.change('W1', 'src/client.js', { after: 'retry(3);\n' });
  b.run('R1', 'npm test', 'failed', 'timeout test failed');
  b.say('F1', 'I added the retries. I did not add the timeout.', 'final');
  const session = b.session();
  const ask = (shortfall) => ({ text: 'retries and a timeout', status: 'partly-done',
    instruction: r('instruction', 'I1', 'Add retries and a timeout to the client.'),
    deliverable: r('code', 'W1', 'retry(3);'), shortfall });
  const prompt = (shortfall) => {
    const [item] = reportModel(session, { windowResults: windowOf(session), sessionReview: 'complete',
      coverage: 'complete', requirements: [ask(shortfall)] }, {}).tiers.must_act;
    // D185: the page's line says whose words or what record its quote is, as the prompt does; no line has `roleLabel`.
    assert.ok(item.evidence.every((e) => !Object.hasOwn(e, 'roleLabel')));
    assert.ok(item.evidence.some((e) => e.label === (shortfall.role === 'commentary' ? REPORT_ITEM_WORDS.agentSaid
      : shortfall.role === 'observation' ? REPORT_ITEM_WORDS.recordedResult : REPORT_ITEM_WORDS.changeShows)
      && e.parts[0]?.text === shortfall.quote));
    return agentPromptText(item.agentPrompt).split('\n');
  };
  assert.deepEqual(prompt(r('commentary', 'F1', 'I did not add the timeout.')), ['I asked: “Add retries and a timeout to the client.”',
    'You did only part of it.', 'This does part of it: “retry(3);”', 'You said: “I did not add the timeout.”',
    'Where: `src/client.js`', `${W.fix} ${W.reason}`]);
  assert.equal(prompt(r('observation', 'R1-r', 'timeout test failed'))[3], 'A recorded result shows: “timeout test failed”');
  assert.equal(prompt(r('code', 'W1', 'retry(3);'))[3], 'The change shows: “retry(3);”');
});

test('D144: a quote cut at 120 characters keeps its mark in the prompt, outside the quotation marks', () => {
  const b = sessionBuilder();
  const long = `Please add ${'a very careful retry to every call of the client '.repeat(4)}now.`;
  b.ask('I1', long);
  b.say('F1', 'I did not add it.', 'final');
  const session = b.session();
  const [item] = reportModel(session, { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'retries', status: 'not-done', instruction: r('instruction', 'I1', long),
      shortfall: r('commentary', 'F1', 'I did not add it.') }] }, {}).tiers.must_act;
  assert.equal(item.quote.cut, true);
  const [first] = agentPromptText(item.agentPrompt).split('\n');
  assert.equal(first, `I asked: “${[...long].slice(0, REPORT_LIMITS.quoteChars - 1).join('')}”…`);
});

test('D144, D199: the page folds each prompt after the item\'s visible lines, in a box one click selects, its copy button at '
  + 'its top; one script, by its hash', () => {
  const session = reportSession();
  const report = everyKind(session);
  const model = reportModel(session, report, repoFacts());
  const html = renderSessionPage(session, report, repoFacts());
  // D199 (the owner, 2026-10-30: "keep the prompt in a proper box with copy button at top right"): the box holds the copy
  // button (its icons alone, no text) and then the prompt; no note on the prompt's voice (the words are gone). Its
  // review: the button is hidden until the page's script shows it (no button sits there doing nothing where no script
  // runs), and names what its label becomes once it has copied (`data-done`).
  assert.equal(Object.hasOwn(W, 'voice'), false);
  assert.equal(html.includes('In this prompt,'), false);
  const head = `<details class="agent-prompt"><summary>${W.fold}</summary><div class="prompt-box"><button type="button" `
    + `class="copy" hidden aria-label="${escapeHtml(W.copy)}" title="${escapeHtml(W.copy)}" `
    + `data-done="${escapeHtml(W.copied)}">`;
  for (const item of items(model)) {
    const at = html.indexOf(`id="item-${item.n}"`);
    const own = html.slice(at, html.indexOf('</article>', at) > 0 ? html.indexOf('</article>', at) : undefined);
    if (!item.agentPrompt) { assert.equal(own.includes('agent-prompt'), false, `item ${item.n}`); continue; }
    const tail = `</button><pre class="agent-prompt-text">${escapeHtml(agentPromptText(item.agentPrompt))}</pre></div></details>`;
    const from = own.indexOf(head);
    const to = own.indexOf(tail, from);
    assert.ok(from >= 0 && to > from, `item ${item.n}`);
    assert.match(own.slice(from + head.length, to), /^(?:<svg [^>]*aria-hidden="true">(?:(?!<\/svg>)[^<]|<(?!\/svg>)[^>]*>)*<\/svg>)+$/,
      `item ${item.n}: the button holds its icons alone`);
    // After the visible lines, before the evidence fold.
    assert.ok(from < own.indexOf('<details class="evidence">'), `item ${item.n}`);
    assert.ok(own.indexOf('<p class="line where">') < 0 || own.indexOf('<p class="line where">') < from);
  }
  const prompts = model.tiers.must_act.filter((x) => x.agentPrompt).length;
  assert.equal(html.split('<details class="agent-prompt">').length - 1, prompts);
  assert.equal(html.split('<button type="button" class="copy"').length - 1, prompts);
  // One click still selects the whole prompt (CSS), with no script too; D199: the page's one script copies it, allowed
  // by its hash alone (session-page-report D97 (13) pins the script and the policy).
  assert.match(PAGE_CSS, /pre\.agent-prompt-text \{[^}]*user-select: all;/);
  assert.equal((html.match(/<script/gi) ?? []).length, 1);
  assert.ok(html.includes(`content="default-src 'none'; style-src 'unsafe-inline'; script-src '${PAGE_SCRIPT_HASH}'; `
    + "base-uri 'none'; form-action 'none'\""));
  // Its review: the script first shows every copy button, and after a copy names it by `data-done` for a moment.
  assert.ok(PAGE_SCRIPT.startsWith("document.querySelectorAll('button.copy').forEach(function(b){b.removeAttribute('hidden')});"));
  assert.ok(PAGE_SCRIPT.includes("b.setAttribute('aria-label',b.dataset.done)") && PAGE_SCRIPT.includes(',1500)'));
});

test('D144: a page past its bound leaves the prompts out with the evidence, never an empty fold', () => {
  const session = reportSession();
  const report = triagedReport(session);
  const long = (k) => `${'word '.repeat(31)}${k}`;
  report.decisions = [...report.decisions,
    ...Array.from({ length: 3000 }, (_, k) => ({ id: `sha256:${String(k).padStart(64, '0')}`, dimension: long(k),
      chosen: long(k), column: 'asked-settled', columnState: 'grounded', actions: [], stated: null })),
    ...Array.from({ length: 200 }, (_, k) => ({ id: `sha256:${String(k + 5000).padStart(64, '0')}`, dimension: long(k),
      chosen: `pick ${k}`, column: 'unasked', columnState: 'grounded', actions: ['W1'], stated: null }))];
  const { html, whole } = sessionPage(session, report, repoFacts());
  assert.equal(whole, false);
  assert.ok(Buffer.byteLength(html, 'utf8') <= PAGE_LIMITS.maxBytes);
  assert.ok(html.includes(REPORT_TRIM_WORDS.trimmed), 'the evidence folds keep their summary only');
  assert.equal(html.includes('agent-prompt"'), false, 'no prompt, and no empty fold');
  // D199: no prompt box, so no copy button. D203: the page's one script stays for its in-page links, by its hash.
  assert.equal(/class="copy"/.test(html), false);
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.ok(html.includes(`<script>${PAGE_SCRIPT}</script>`) && html.includes(`script-src '${PAGE_SCRIPT_HASH}'`));
  assert.ok(reportModel(session, report, repoFacts()).tiers.must_act.some((item) => item.agentPrompt));
});

test('D144: the .md folds each prompt as a fence after the item\'s visible lines; the terminal\'s report holds none', () => {
  const session = reportSession();
  const report = everyKind(session);
  const model = reportModel(session, report, {});
  const md = renderReportMarkdown(session, report, {});
  for (const item of model.tiers.must_act.filter((x) => x.agentPrompt)) {
    const at = md.indexOf(`<a name="item-${item.n}"></a>`);
    const end = md.indexOf('<a name="item-', at + 1);
    const own = md.slice(at, end > 0 ? end : undefined);
    // D199: no note on the prompt's voice; the fence is the fold's one block (GitHub shows its copy button).
    const fold = `<details><summary>${W.fold}</summary>\n\n\`\`\`\n${agentPromptText(item.agentPrompt)}\n\`\`\`\n\n`
      + '</details>';
    assert.ok(own.includes(fold), `item ${item.n}`);
    assert.ok(own.indexOf(fold) < own.indexOf('<details><summary>Evidence'), `item ${item.n}`);
  }
  // The terminal (`agentPrompts` false): no prompt, no notice that the report was shortened, and nothing else moves.
  assert.equal(md.includes('In this prompt,'), false);
  const terminal = renderReportMarkdown(session, report, { agentPrompts: false });
  assert.equal(terminal.includes(W.fold), false);
  assert.equal(terminal.includes(REPORT_TRIM_WORDS.mdShortened), false);
  assert.equal(terminal, md.replace(/\n\n<details><summary>Prompt for the agent<\/summary>\n\n[\s\S]*?\n\n<\/details>/g, ''));
});

test('D144, D161: the snapshots are pinned by their sha256, so any move of them is deliberate', () => {
  // Up to D161 the snapshots rendered back (`textBeforeAgentPrompt` after D152's `textBeforeTruthOnly`) to 0.3.0-beta.6's
  // bytes (d5d2fd0f: report.md dedbe49f…, the page 5240575b…). D161 (the report's two parts) moved sections and renumbered
  // items, which no text rule renders back: the snapshots before it (0bee522b: report.md 23880f3b…, the page 370bf5be…)
  // are recorded here, and the snapshots since are pinned by their own sha256. D163 (the first part's pointers, Must act
  // counting the decision tagged Must act, an open group's fold, three style rules) moved them once more (be44d35b:
  // report.md 37549a58…, the page 6c1a1647…); its review reworded the pointers' heading alone (D163's first build:
  // report.md dbf9597e…, the page 6bc6f150…). D167 (the .md counts the runs and keeps the lines of the runs another
  // part names) moved report.md alone (D163: report.md 77fc995f…); the page is D163's, byte for byte. Its review (an
  // item's Where keeps its run's line too, and the command as the CLI's usage says it) moved report.md once more
  // (D167's first build: report.md 5016914a…). D169 (0.3.0-beta.10: the report model's version, and on the page the
  // code review's fact under its heading) moved both once more (eb9eab3f: report.md 242275cb…, the page f4d99d56…).
  // 0.3.0-beta.11 (the report model's version; D182: the paragraph on how the code review works, which names no
  // folder; D185: the shortfall of the ask done only in part labelled by its role, "The change shows:", not "What is
  // missing:") moved both once more (be2fb44d: report.md b0d502c3…, the page e28e20a6…). D193 (the page's tabs, its
  // panels and its new stylesheet) moved the page alone (6fe6c9fa: the page cbb2d058…); report.md is 6fe6c9fa's, byte
  // for byte. D194 (one list of decisions, one pointer line, heads led by their quote) moved both once more (7cfe0c84:
  // report.md 33aba599…, the page 194b241d…). D195 (the page's type and status pills and its key column) moved the page
  // alone (6829939b: the page 6be9b473…); report.md is 6829939b's, byte for byte. D196 (the tabs as radios, the header's
  // tiles, the asks bar) moved the page alone once more (2c02f900: the page, D195's). D197 (chips, run and claim marks)
  // moved it once more (c0af4fab: the page, D196's). D198 (rows, the asks checklist) moved it once more (ffe8b612: the
  // page, D197's). D199 (the prompt's box and its copy button, the tabs' stats, and no tier's reason, voice note, coverage
  // line or could-not-verify note) moved both once more (75ed3ebd: report.md 47fdd352…, the page 0e7a7230…); its review
  // round moved both again (the session review's rows that no reader reads under its own part in the .md; on the page,
  // the asks' stats one a state and the decisions tile a label: report.md 5254f753…, the page a7a77947…); its review
  // round's second pass: What Sonah could not check names the done ask whose row cites only the agent's words (a 7th
  // fact, both), and on the page the copy buttons hidden until the script shows them and named once they have copied
  // (the script and its hash with them), each ask row's line wrapped, the decision head's arrow as text, and the run
  // stat as Commands and Other calls (R17) (report.md 77b4daf2…, the page e3c28116…). D200 (the precision markers as short
  // tags; the impact and action lines say they are the code review's) moved both once more (0f84aa9c: report.md
  // f8dd9275…, the page 2d3ac885…): in both, "Impact on you:" and "Action:" read "The code review's impact on you:" and
  // "The code review's action:", item 27's head gains its tag "Asked: not checked", ask 3's row "Agent's word only",
  // ask 5's row "Quote not checked" and "Finding withheld", and the coverage line is back (the .md under the asks' table,
  // the page first in the fold of your messages); on the page alone, Must know's tile says "and 3 decisions", each tag's
  // sentence is its title, and the stylesheet (translucent tabs, press feedback and its reduced motion, number tracking,
  // the tags' look, the dead .item-head rules gone). D200's review round moved both once more (D200's first pass:
  // report.md 743d7af3…, the page 15c7e0df…): in both, ask 5's tag "Quote not checked" reads "Cited quote not checked";
  // in report.md the line under the asks' table is its own, "Sonah checked only the parts of your prompt that the table
  // above lists." (it was the page's "Sonah checked only the marked parts of your message."); on the page alone, no tag
  // has a title: each tag's sentence is a `.tip` span after its label (item 27's flag, ask 3's, and ask 5's two), an
  // ask's tag focusable (tabindex="0"); each run of the list carries its number as its marker (`value`, runs 1 to 7);
  // and the stylesheet (the tags positioned, the `.tip` rules hidden until hover or focus and static in print, and the
  // tags' column spanning the row under 560px). D201 (the owner, 2026-10-31: "move claims to the top on what the agent
  // did", "for evidence, show more details for verify cases, at least where in the code") moved both once more (9c768f57:
  // report.md 0abb1d56…, the page 8cf6d720…): in both, item 2 (a contradicted claim) and item 14 (a contradicted
  // written statement) each name the run their contradicting result came from, its Where gaining "run 1" (item 14:
  // "run 2") and its evidence the line "The result came from: run 1 `redis-server --version`" (item 14: run 2 `npm
  // test`); item 15 (the failed run passed over) gains "Its output ended with:" and that run's last two output lines,
  // each as code; in report.md alone, the runs that other parts name gain run 1's line (now named by item 2); on the
  // page alone, What the agent did puts the Claims tile first, the claims' chip line before the runs', and the Claims
  // list before Files and Runs, word for word. No count, status, quote or anchor of the fixture moved. D201's review
  // moved the page alone once more (was e0c73850…): under prefers-reduced-motion, the copy button's and the acts'
  // summaries' press transform is none (one stylesheet rule, the page's only move); report.md did not move (the
  // fixture's one contradicted claim has no explanation, its failed run's output is two lines, its receipts ground).
  // D202 (the owner, 2026-10-31: "Done asks: what does it", "Short replies: context", "Decisions: their actions",
  // "Legend and small fixes", "Form, not meaning") moved both (was f184bc84… and 58c32f68…): asks 1 and 3 say what does
  // them (ask 1's change with its file), message 2 the agent's last words before it, decisions 28 to 32 their
  // recorded actions (runs 4 to 6, and two calls by their tool and file; report.md lists runs 5 and 6 among the runs it
  // names), questions 18 and 19 their "Not tied" tag (by D161's structural fact, whether or not its bound moved the
  // tier), every impact and action line its "Form, not meaning" tag, and the legend four lines more (the page six, with
  // the row tags' and the bar's); on the page alone, ask rows' evidence folds, the other done asks' fold, the tag
  // sentences in the opened rows, a radio's name with its count, a 0 tile's class, the bar in its words' order, a lead
  // quote said once, and the stylesheet (the ask fold's column, the tabs wrapped on a phone, a 0 tile, the muted flag,
  // folds in print). No count, status, quote or anchor of the fixture moved.
  // D204 (the coordinator's review of D202 and D203; the owner, 2026-10-31: "Your asks" everywhere, "Cut longest first",
  // "Yes, add Back") moved both: the count line and the prompt's heading say "Your asks"; a decision shows its recorded
  // statement from its quote on; a decision's actions name the recorder's tool, so the fixture's writes, which record
  // none, have no line; the legend says what the two tags mean; on the page, the script adds Back and opening at a #place,
  // the named runs fold, and the header's tiles sit four to a row on a phone. No count, status, quote or anchor moved.
  // Its review moved the page alone (was 0d20e100…): the script writes its two entries before the page moves, keeps the
  // browser's own scroll restoring, gives the link taken focus on Back and keeps a tab opened by hand for a reload, and
  // a phone's tiles never split a word.
  const now = (name) => sha(readFileSync(new URL(`./snapshots/${name}`, import.meta.url), 'utf8'));
  assert.equal(now('report.md'), '98020386d99330329b289ea098457ccaafdb5a3a8cd21954adf50df78fef31ab');
  // D203 (the owner, 2026-10-31: "Yes, extend the script") moved the page alone (was 1e4cf68c…): its one script, renamed
  // PAGE_SCRIPT, also follows an in-page link to its place and lets a tab's label take keyboard focus (so the policy's
  // hash moved), and the stylesheet holds a place's room under the tab bar (more on a phone), a landed place's ring and
  // every focus ring in the accent's ink (its review: the accent is under 3:1 on the light ground).
  assert.equal(now('session-page-report.html'), 'fbf22094cc52a475d78d33d9e0c38d869770a29382e082df154721afc4846c51');
});
