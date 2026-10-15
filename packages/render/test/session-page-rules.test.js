// M33 Y2, D69 page audit and D69 f (g): the rules the page no longer reads. The row's "Touches" line, and every rule it
// was read by (`PAGE_SYMBOL_RULES` and its lexer, `PAGE_METHOD_KEYWORDS`, `CONTINUES`, the Read output's line-number
// shape, the read-only command flags), is deleted, as D69 (c)(3) deleted the slicer's hunk-header keyword list. D69 f (g):
// the Impact row (evidence/src/materiality.js path keyword rules) and the step titles' program tables (session-story.js
// `commandFacts`) are not on the page's path either. Every session, path and report here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as page from '../session-page.js';
import { renderSessionPage } from '../session-page.js';
import { sessionBuilder, storySession, storyReport, STORY_KEY } from './session-story-fixture.js';
import { MATERIALITY_RULE_IDS, materialityOf } from '../../evidence/src/materiality.js';

const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');
const textOf = (html) => unescape(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null, valueReceipt: null,
  valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null, column: 'asked-chose',
  columnState: 'grounded', amends: [], materiality: 'structural', materialityRule: 'unknown-structural',
  relevance: 'unchecked', reasons: [], ...fields });
/** The markup of the row with this id. */
const rowOf = (html, id) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</li>', html.indexOf(`id="${id}"`)));
/** One session built by `build` (after an ask), reviewed as one step holding every event, with these decisions. */
function pageOf(build, decisions = []) {
  const b = sessionBuilder();
  b.ask('I1', 'Make the change.');
  build(b);
  const session = b.session();
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((event) => event.id), failure: null }],
    sessionStatus: 'CLEAN', decisions };
  return { session, report, html: renderSessionPage(session, report) };
}
const write = (b, id, path, after) => b.change(id, path, { operation: 'write', after });
const impactOf = (html) => {
  const m = /<p class="note meta"><span class="label">Impact<\/span> (.*?)<\/p>/.exec(rowOf(html, 'decision-1'));
  return m ? textOf(m[1]) : null;
};

test('D69 page audit: "Touches" and every rule it was read by are gone from the page and its exports', () => {
  for (const name of ['PAGE_SYMBOL_RULES', 'PAGE_TOUCH_WORDS', 'PAGE_METHOD_KEYWORDS', 'PAGE_READ_ONLY_PROGRAMS', 'PAGE_READ_ONLY_GIT'])
    assert.equal(Object.hasOwn(page, name), false, name);
  assert.equal(Object.hasOwn(page.PAGE_LIMITS, 'namedSymbols') || Object.hasOwn(page.PAGE_LIMITS, 'symbolChars'), false);
  // An edit to a source file the agent read whole before: no symbol, signature or throw line is read from it.
  const { html } = pageOf((b) => {
    b.run('R1', 'read', 'succeeded', '     1\texport function listOrders() {\n     2\t  return [];\n     3\t}');
    Object.assign(b.events.find((event) => event.id === 'R1'), { tool: 'read', operation: 'other', paths: [{ path: 'src/orders.js' }], command: [] });
    b.change('W1', 'src/orders.js', { operation: 'edit', before: '  return [];', after: '  throw new Error("x");', priorState: 'edit-text' });
  }, [decided({ actions: ['W1'] })]);
  for (const gone of ['Touches', 'fixed rules', 'same signature', 'listOrders', 'changes the signature', 'top-level code'])
    assert.equal(textOf(html).includes(gone), false, gone);
  assert.equal(textOf(renderSessionPage(storySession(), storyReport())).includes('Touches'), false);
});

test('D69 f (g) no Impact row: the path keyword rules never reach the page, whatever materiality and rule', () => {
  assert.equal(Object.hasOwn(page, 'PAGE_IMPACT_RULE_WORDS'), false);
  const edits = (path, operation = 'edit') => [{ operation, paths: [{ path }] }];
  // Each rule id, by its real trigger (materialityOf, the ledger's own rule).
  const triggers = [['deletion', edits('src/old.js', 'delete')], ['dependencies', edits('package.json')],
    ['schema', edits('db/migrations/001.sql')], ['api', edits('src/routes/orders.js')], ['config', edits('config/app.js')],
    ['auth', edits('src/auth/session.js')], ['new-module', edits('src/orders.js', 'write')], ['style-or-copy', edits('README.md')]];
  assert.deepEqual(triggers.map(([id]) => id), MATERIALITY_RULE_IDS.filter((id) => id !== 'unknown-structural'));
  for (const [id, actions] of [...triggers, ['unknown-structural', edits('src/x.js')]]) {
    const { materiality, rule } = materialityOf({ dimension: 'store' }, actions);
    assert.equal(rule, id);
    const { html } = pageOf((b) => write(b, 'W1', 'src/x.js', 'export const x = 1;\n'),
      [decided({ actions: ['W1'], materiality, materialityRule: rule })]);
    assert.equal(impactOf(html), null, id);
    assert.doesNotMatch(textOf(html), /Impact|changes behaviour|changes structure|cosmetic|not classified/, id);
  }
});

test('D69 f (g) a step title is read from the recorder\'s structure, never from a program\'s name', () => {
  // A commit, an install, a script, a read-only program and a test runner: commands, counted, whatever program they run.
  const { html } = pageOf((b) => {
    for (const [id, command] of [['R1', 'git commit -m "x"'], ['R2', 'npm install left-pad'], ['R3', 'node scripts/gen.mjs'],
      ['R4', 'grep -n x src/a.js'], ['R5', 'npm test']]) b.run(id, command, 'succeeded', 'ok');
  });
  const title = (markup) => [...markup.matchAll(/<div class="what"><p class="said-line">([^<]*)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(title(html), ['Ran 5 commands']);
  // A read the recorder typed (its Read tool) is counted as a file read; a failed command and a helper by their records.
  const typed = pageOf((b) => {
    b.read('A1', 'src/a.js');
    b.read('A2', 'src/b.js');
    b.run('R1', 'cat src/c.js', 'failed', 'no such file');
    b.delegate('D1', 'Check it', 'h1');
    b.change('W1', 'src/lib/a.js', { operation: 'edit', before: 'a\n', after: 'b\n', priorState: 'edit-text' });
  });
  assert.deepEqual(title(typed.html), ['Edited 1 file in src/lib · 1 command failed · read 2 files']);
  for (const words of ['committed', 'installed packages', 'read-only command', 'ran scripts', 'ran node'])
    assert.equal(textOf(html).includes(words) || textOf(typed.html).includes(words), false, words);
});
