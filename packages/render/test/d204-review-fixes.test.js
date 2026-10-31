// D204 (0.3.0-beta.11; the coordinator's review of D202 and D203, and the owner's answers of 2026-10-31: "Cut longest
// first", "Yes, add Back", "Everywhere now", "Your asks" everywhere). (a) Past its bound, the page cuts your long
// messages one at a time, the longest first, and says how many. (b) The runs other parts name fold under one counted
// line. (c) The page script adds one history entry per jump, opens a page at its #place, and lands below the tab bar
// however tall. (d) A failed run whose head line cuts its command shows the whole command; a decision whose recorded
// statement goes on past its quote shows it from the quote on; a decision's actions name the recorder's own tool. (e)
// The legend says what the two new tags mean, where the review has them; "Your asks" names the part everywhere. Its
// review: a message that holds no ask is cut in the same order; a command past its bound too says it is its start; a
// quote's cut counts recorded characters; Back keeps the browser's own scroll restoring; a phone's tiles never split a
// word. Structure and provenance only, every session synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, reportItems, REPORT_LIMITS } from '../report-model.js';
import { renderSessionPage, sessionPage, PAGE_SCRIPT, PAGE_CSS, PAGE_LIMITS } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_ITEM_WORDS, REPORT_FOOTER_WORDS, REPORT_TRIM_WORDS, REPORT_DID_WORDS, REPORT_COUNT_WORDS,
  REPORT_SECTION_WORDS } from '../report-words.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';
import { reportSession, triagedReport, repoFacts } from './report-fixture.js';

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const reviewOf = (session, rows) => ({ windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id),
  failure: null }], sessionReview: 'complete', coverage: 'complete', ...rows });
const text = (parts) => parts.map((p) => p.text).join('');
const count = (haystack, needle) => haystack.split(needle).length - 1;

test('D204 (a): past its bound the page cuts the longest message first, only until it fits, and counts the cut', () => {
  // Characters shown in several bytes each, so a few long messages pass the bound; the longest alone is past it.
  const unit = ['<', '&', '"', '‮', '\u{1D4B3}', ' '];
  const heavy = (n, tag) => `${tag} ${Array.from({ length: n }, (_, i) => unit[i % unit.length]).join('')}`;
  const b = sessionBuilder();
  b.ask('I0', `Start ask 0: read the log below.\n${heavy(110_000, 'log0')}`);
  b.ask('I1', `Start ask 1: read this too.\n${heavy(12_000, 'log1')}`);
  b.ask('I2', `Start ask 2: and this.\n${heavy(9_000, 'log2')}`);
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const report = reviewOf(session, { requirements: [0, 1, 2].map((i) => ({ text: `ask ${i}`, status: 'done',
    instruction: r('instruction', `I${i}`, ['Start ask 0: read the log below.', 'Start ask 1: read this too.',
      'Start ask 2: and this.'][i]) })) });
  const { html, whole } = sessionPage(session, report, {});
  assert.equal(whole, false, 'premise: the page passes its bound');
  assert.ok(Buffer.byteLength(html, 'utf8') <= PAGE_LIMITS.maxBytes);
  // The longest lost its whole text; the two others kept theirs.
  assert.equal(count(html, '<details class="whole">'), 2);
  assert.equal(count(html, REPORT_TRIM_WORDS.messagesTrimmed(1)), 1);
  const blocks = html.split('<div class="message-block">').slice(1);
  assert.deepEqual(blocks.map((blk) => blk.includes('<details class="whole">')), [false, true, true]);
});

test('D204 (a), its review: a message that holds no ask is cut in the same order, longest first, and only then', () => {
  const unit = ['<', '&', '"', '‮', '\u{1D4B3}', ' '];
  const heavy = (n, tag) => `${tag} ${Array.from({ length: n }, (_, i) => unit[i % unit.length]).join('')} END-${tag}`;
  // Your ask's message and two that hold none, of the lengths given; the end of each says whether it is shown whole.
  const pageOf = (n0, n1, n2) => {
    const b = sessionBuilder();
    b.ask('I0', `Start ask 0: read the log below.\n${heavy(n0, 'log0')}`);
    b.ask('I1', `Here is a log.\n${heavy(n1, 'log1')}`);
    b.ask('I2', `And another log.\n${heavy(n2, 'log2')}`);
    b.say('F1', 'Done.', 'final');
    const session = b.session();
    const report = reviewOf(session, { requirements: [{ text: 'ask 0', status: 'done',
      instruction: r('instruction', 'I0', 'Start ask 0: read the log below.') }] });
    return sessionPage(session, report, {});
  };
  const ends = (html) => ['log0', 'log1', 'log2'].map((tag) => html.includes(`END-${tag}`));
  // The longest holds no ask: it alone is cut; your ask's message keeps its whole text in its fold.
  const first = pageOf(9_000, 110_000, 12_000);
  assert.equal(first.whole, false, 'premise: past the bound');
  assert.deepEqual(ends(first.html), [true, false, true]);
  assert.equal(count(first.html, REPORT_TRIM_WORDS.messagesTrimmed(1)), 1);
  // The longest is your ask's: the two that hold none keep their whole text.
  const second = pageOf(110_000, 12_000, 9_000);
  assert.equal(second.whole, false, 'premise: past the bound');
  assert.deepEqual(ends(second.html), [false, true, true]);
  assert.equal(count(second.html, REPORT_TRIM_WORDS.messagesTrimmed(1)), 1);
});

test('D204 (b): the runs other parts name fold under one counted line, each with its line and anchor', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Report the node version.');
  b.run('R1', 'node --version', 'succeeded', 'v20.11.0');
  b.say('F1', 'It is v20.', 'final');
  const session = b.session();
  const report = reviewOf(session, { requirements: [{ text: 'report node version', status: 'done',
    instruction: r('instruction', 'I1', 'Report the node version.'), deliverable: r('observation', 'R1-r', 'v20.11.0') }] });
  const page = renderSessionPage(session, report, {});
  assert.ok(page.includes(`<details class="fold named-runs"><summary>${REPORT_DID_WORDS.runsNamedFold(1, false)}</summary>`
    + '<ul class="rows"><li id="run-1">'));
});

test('D204 (c): the script adds one history entry a jump, returns on Back, opens a page at its #place, lands below the bar', () => {
  // One entry a jump, both written in the click, before the label opens its tab and before the page moves (its review:
  // the browser keeps the scroll of the entry it leaves as it is then): the place it left (its tab, its scroll and the
  // link taken), then the place it goes to, its address the #place, its tab the panel that holds it.
  assert.ok(PAGE_SCRIPT.includes("var id=h.slice(1),t=document.getElementById(id),p=t&&t.closest('.panel');"
    + "try{history.replaceState({tab:tab(),y:window.scrollY,link:[].indexOf.call(document.querySelectorAll(L),a)},'');"
    + "history.pushState({tab:p?'t-'+p.id:tab(),id:id},'',h)}catch(x){}setTimeout(function(){show(id);go(id)},0)"));
  // An <a> link is followed by the script alone, so the browser adds no second entry.
  assert.ok(PAGE_SCRIPT.includes("if(a.tagName==='A')e.preventDefault()"));
  // Back: the tab of the entry, then its place, or its scroll and the link taken, focused again.
  // An entry the script made says its tab and place (or scroll); only an entry it did not make reads the address.
  assert.ok(PAGE_SCRIPT.includes("window.addEventListener('popstate',function(e){var s=e.state,id=s?s.id:null;if(!s){s={};"));
  assert.ok(PAGE_SCRIPT.includes('if(s.tab){var r=document.getElementById(s.tab);if(r)r.checked=true}'));
  assert.ok(PAGE_SCRIPT.includes("else if(typeof s.y==='number'){window.scrollTo(0,s.y);"
    + 'var l=document.querySelectorAll(L)[s.link];if(l)l.focus({preventScroll:true})}'));
  // A page reloaded on an entry the script made opens its tab, and the browser restores the scroll as ever (its review:
  // no `scrollRestoration`); a page opened at #place opens that place's tab (its panel's radio) and goes there, again
  // once loaded (the browser's own move to the place comes after), and keeps that in its entry.
  assert.ok(PAGE_SCRIPT.includes("var p=t.closest('.panel');var r=p&&document.getElementById('t-'+p.id);if(r)r.checked=true"));
  assert.ok(PAGE_SCRIPT.includes('try{var s0=history.state;if(s0&&s0.tab){var r0=document.getElementById(s0.tab);'
    + 'if(r0)r0.checked=true}else{var first=decodeURIComponent(location.hash.slice(1));if(first&&show(first)){go(first);'
    + "window.addEventListener('load',function(){go(first)},{once:true});history.replaceState({tab:tab(),id:first},'')}}}"
    + 'catch(x){}'));
  assert.equal(PAGE_SCRIPT.includes('scrollRestoration'), false);
  // A tab opened by hand is kept in the current entry, so a reload opens it (checked in Chromium: the browser alone
  // reopened the first tab).
  assert.ok(PAGE_SCRIPT.includes("document.addEventListener('change',function(e){var r=e.target;if(!r.matches||"
    + "!r.matches('input.tab-r'))return;try{history.replaceState(Object.assign({},history.state,{tab:r.id}),'')}catch(x){}})"));
  // Below the tab bar, however tall it is.
  assert.ok(PAGE_SCRIPT.includes("var b=document.querySelector('.tabs');if(b){var y=b.getBoundingClientRect().bottom+8,"
    + 'top=t.getBoundingClientRect().top;if(top<y)window.scrollBy(0,top-y)}'));
  // Its own history entries alone are written and read, and the fragment.
  assert.deepEqual([...new Set(PAGE_SCRIPT.match(/location\.\w+|history\.\w+/g))].sort(),
    ['history.pushState', 'history.replaceState', 'history.state', 'location.hash']);
});

test('D204 (d): a failed run shows its whole command when the head cuts it; a decision its statement from the quote on', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Run the checks.');
  const long = `npm test -- --grep "a very long selector that goes on and on" && node scripts/check.mjs --strict && false`;
  b.run('R1', long, 'failed', 'FAIL');
  b.run('R2', 'npm run lint', 'failed', 'lint FAIL');
  b.say('S1', 'I will not touch the CI config. Changing it would break the release job, which reads it on every tag.');
  b.say('S2', 'I will keep the old flag.');
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const failure = (id) => ({ eventId: `${id}-r`, action: id, outcome: 'ran-failed', form: 'exit', tool: 'bash',
    handling: 'passed-over', response: r('commentary', 'F1', 'Done.') });
  const decision = (c, said) => ({ id: `sha256:${c.repeat(64)}`, dimension: `topic ${c}`, chosen: 'leave it',
    column: 'unasked', columnState: 'grounded', notActing: true, actions: [], stated: r('commentary', said[0], said[1]) });
  const report = reviewOf(session, { failures: [failure('R1'), failure('R2')],
    decisions: [decision('a', ['S1', 'I will not touch the CI config.']), decision('b', ['S2', 'I will keep the old flag.'])] });
  const items = reportItems(reportModel(session, report, {}));
  const lines = (pred) => items.filter(pred).map((i) => i.evidence.filter((e) => [REPORT_ITEM_WORDS.wholeCommand,
    REPORT_ITEM_WORDS.fromQuoteOn].includes(e.label)).map((e) => [e.label, text(e.parts)]));
  assert.deepEqual(lines((i) => i.kind === 'failure_passed_over'), [[[REPORT_ITEM_WORDS.wholeCommand, long]], []]);
  assert.deepEqual(lines((i) => i.kind.startsWith('decision_')), [[[REPORT_ITEM_WORDS.fromQuoteOn,
    'I will not touch the CI config. Changing it would break the release job, which reads it on every tag.']], []]);
});

test('D204 (d), its review: a command past its bound too is its start, said so; a statement is cut at its bound, never in a mark', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Run the checks.');
  const fits = `node scripts/check.mjs ${'--flag '.repeat(150)}`.trim();
  const past = `node scripts/check.mjs ${'--flag '.repeat(200)}`.trim();
  assert.ok([...fits].length <= REPORT_LIMITS.wholeCommandChars && [...past].length > REPORT_LIMITS.wholeCommandChars);
  b.run('R1', fits, 'failed', 'FAIL');
  b.run('R2', past, 'failed', 'FAIL');
  // A statement past its bound, and one with an invisible character where its bound falls.
  const quote = 'I will not touch the CI config.';
  b.say('S1', `${quote} ${'because the release job reads it '.repeat(30)}`);
  // The invisible character is the last recorded character the bound keeps (the 599th).
  const lead = `${quote} ${'a'.repeat(REPORT_LIMITS.statementChars - quote.length - 3)}`;
  b.say('S2', `${lead}\u202E${'b'.repeat(50)}`);
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const failure = (id) => ({ eventId: `${id}-r`, action: id, outcome: 'ran-failed', form: 'exit', tool: 'bash',
    handling: 'passed-over', response: r('commentary', 'F1', 'Done.') });
  const decision = (c, said) => ({ id: `sha256:${c.repeat(64)}`, dimension: `topic ${c}`, chosen: 'leave it',
    column: 'unasked', columnState: 'grounded', notActing: true, actions: [], stated: r('commentary', said, quote) });
  const report = reviewOf(session, { failures: [failure('R1'), failure('R2')], decisions: [decision('a', 'S1'), decision('b', 'S2')] });
  const items = reportItems(reportModel(session, report, {}));
  const commands = items.filter((i) => i.kind === 'failure_passed_over').map((i) => i.evidence
    .filter((e) => [REPORT_ITEM_WORDS.wholeCommand, REPORT_ITEM_WORDS.commandStart].includes(e.label))
    .map((e) => [e.label, [...text(e.parts)].length]));
  assert.deepEqual(commands, [[[REPORT_ITEM_WORDS.wholeCommand, [...fits].length]],
    [[REPORT_ITEM_WORDS.commandStart, REPORT_LIMITS.wholeCommandChars]]]);
  const statements = items.filter((i) => i.kind.startsWith('decision_'))
    .map((i) => i.evidence.find((e) => e.label === REPORT_ITEM_WORDS.fromQuoteOn).parts.at(-1));
  // Cut at the bound, counted in recorded characters, the cut said outside the marks.
  assert.equal(statements[0].cut, true);
  assert.equal([...statements[0].text].length, REPORT_LIMITS.statementChars - 1);
  // The invisible character kept whole as its mark: never a part of its mark.
  assert.equal(statements[1].cut, true);
  assert.ok(statements[1].text.endsWith('a‹U+202E›'), statements[1].text.slice(-12));
});

test('D204\'s review: a quote within its bound is shown whole, however long its invisible characters\' marks make it', () => {
  // 116 recorded characters (within `quoteChars`), one of them invisible: its mark makes the shown text 123 long.
  const said = `I keep the old flag ${'x'.repeat(90)}\u202E end.`;
  assert.ok([...said].length <= REPORT_LIMITS.quoteChars);
  const b = sessionBuilder();
  b.ask('I1', 'Ship.');
  b.say('S1', said);
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const report = reviewOf(session, { decisions: [{ id: `sha256:${'d'.repeat(64)}`, dimension: 'flag', chosen: 'keep it',
    column: 'unasked', columnState: 'grounded', notActing: true, actions: [], stated: r('commentary', 'S1', said) }] });
  const quotes = [];
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') {
    if (x.quote === true && typeof x.text === 'string' && x.text.startsWith('I keep the old flag')) quotes.push(x);
    Object.values(x).forEach(walk); } };
  walk(reportItems(reportModel(session, report, {})));
  assert.ok(quotes.length > 0, 'premise: the statement is quoted');
  for (const q of quotes) {
    assert.equal(q.cut ?? false, false);
    assert.equal(q.text, said.replace('\u202E', '‹U+202E›'));
  }
});

test('D204 (d): a decision\'s action names the tool the recorder wrote, never the slicer\'s kind of call', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Ship.');
  b.change('W1', 'dist/a.js', { after: 'x\n' });
  b.change('W2', 'dist/b.js', { after: 'y\n' });
  b.events.find((e) => e.id === 'W1').recorded = { tool: 'Write' };
  const session = b.session();
  const report = reviewOf(session, { decisions: [{ id: `sha256:${'c'.repeat(64)}`, dimension: 'build', chosen: 'ship',
    column: 'unasked', columnState: 'grounded', actions: ['W1', 'W2'], stated: null }] });
  const item = reportItems(reportModel(session, report, {})).find((i) => i.kind === 'decision_unasked');
  const acts = item.evidence.filter((e) => e.label === REPORT_ITEM_WORDS.actions || /^and \d+ more action/.test(text(e.parts)));
  // W1's line by its recorded tool; W2 records none (its slicer kind `create` is never shown as one): counted.
  assert.deepEqual(acts.map((e) => text(e.parts)), ['Write dist/a.js', REPORT_ITEM_WORDS.moreActions(1)]);
  assert.equal(acts[0].parts[0].code, true);
});

test('D204 (e): the legend says what the two tags mean only where the review has them; "Your asks" names the part', () => {
  const fixture = reportSession();
  const md = renderReportMarkdown(fixture, triagedReport(fixture), repoFacts());
  assert.ok(md.includes(REPORT_FOOTER_WORDS.legendFormTag) && md.includes(REPORT_FOOTER_WORDS.legendUntiedTag));
  const b = sessionBuilder();
  b.ask('I1', 'Say hello.');
  b.say('F1', 'Hello.', 'final');
  const plain = b.session();
  const bare = renderReportMarkdown(plain, reviewOf(plain, { requirements: [{ text: 'hello', status: 'done',
    instruction: r('instruction', 'I1', 'Say hello.') }] }), {});
  assert.equal(bare.includes(REPORT_FOOTER_WORDS.legendFormTag) || bare.includes(REPORT_FOOTER_WORDS.legendUntiedTag), false);
  assert.ok(bare.includes(`· ${REPORT_COUNT_WORDS.prompt('1 done')}`));
  assert.ok(bare.includes(`### ${REPORT_SECTION_WORDS.promptCounted(1, '1 done')}`));
  assert.equal(REPORT_SECTION_WORDS.promptCounted(7, '3 done'), 'Your asks (7: 3 done)');
  assert.ok(!/Your prompt/.test(bare) && !/Your prompt/.test(renderSessionPage(plain, reviewOf(plain, {}), {})));
});

test('D204 (e): copy buttons do not print; on a phone the header\'s tiles sit four to a row, two below 360 px', () => {
  assert.match(PAGE_CSS, /@media print \{[^@]*button\.copy \{ display: none; \}/);
  // Four to a row, as wider (the phone's rule keeps the columns), a tile's word never split (its review: "Decisions" broke
  // at 360 px); two to a row below 360 px.
  assert.match(PAGE_CSS, /\n\.count \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(PAGE_CSS, /@media \(max-width: 560px\) \{[^@]*\.count \{ gap: 6px; \}[^@]*\.count \.k, \.count \.sub \{ font-size: 11\.5px; overflow-wrap: normal; \}/);
  assert.match(PAGE_CSS, /@media \(max-width: 359px\) \{ \.count \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/);
  assert.equal(REPORT_LIMITS.wholeCommandChars, 1200);
  assert.equal(REPORT_LIMITS.statementChars, 600);
});
