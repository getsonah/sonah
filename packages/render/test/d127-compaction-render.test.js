// D127 (B10d, N1; the owner's go of 2026-10-22): each compaction of the agent's context that the recorder typed is shown at
// its place among your messages, counted by what the agent's context dropped (the boundary row's typed counts); an ask
// given before a compaction is marked in the asks table; and a session that opens on a compaction says so beside the
// title (D126). Structure only: boundary events, their order and their typed counts. Every string is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../session-page.js';
import { reportModel } from '../report-model.js';
import { REPORT_PROMPT_WORDS, REPORT_HEADER_WORDS, REPORT_SECTION_WORDS } from '../report-words.js';
import { renderReportMarkdown } from '../session-story.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const ASK1 = 'Add a limit parameter to GET /notes.';
const ASK2 = 'Now document the limit parameter in docs/api.md.';
const ASK3 = 'And add a test for an invalid limit.';

/** Three messages; a compaction after the first and one after the second (each a boundary event, as the adapter emits
 *  it), and a helper's own compaction that is never yours. `compacted` is what the recorder typed on each. */
function compactedSession({ first = { trigger: 'auto', before: 967_925, after: 11_687 }, second = {}, continued = null,
  helper = true, last = null } = {}) {
  const b = sessionBuilder();
  b.ask('I1', ASK1);
  b.change('W1', 'src/routes/notes.js', { after: 'const LIMIT = 20;\n' });
  b.events.push({ id: 'B1', kind: 'boundary', sequence: b.events.length, boundary: 'compaction', relatedSession: null,
    ...(first ? { compacted: first } : {}) });
  // The summary row's mark: a boundary that carries no typed facts, never counted on its own.
  b.events.push({ id: 'B1s', kind: 'boundary', sequence: b.events.length, boundary: 'compaction', relatedSession: null });
  b.ask('I2', ASK2);
  if (helper) b.events.push({ id: 'BH', kind: 'boundary', sequence: b.events.length, boundary: 'compaction',
    relatedSession: null, childId: 'h1', compacted: { before: 10, after: 1 } });
  b.events.push({ id: 'B2', kind: 'boundary', sequence: b.events.length, boundary: 'compaction', relatedSession: null,
    compacted: second });
  b.ask('I3', ASK3);
  b.say('F1', 'Done.', 'final');
  if (last) b.events.push({ id: 'B3', kind: 'boundary', sequence: b.events.length, boundary: 'compaction',
    relatedSession: null, compacted: last });
  let turn = 0;
  for (const event of b.events) {
    if (event.kind === 'instruction' && event.authority === 'human') turn++;
    event.turn = `T${Math.max(turn, 1)}`;
  }
  const session = b.session();
  if (continued) session.continued = continued;
  return { session, ids: b.events.map((event) => event.id) };
}
const receipt = (eventId, quote) => ({ role: 'instruction', eventId, quote, sessionKey: STORY_KEY });
function report(ids) {
  return {
    repo: { host: 'github.com', id: '0' }, pr: null, reviewScope: 'session-only', codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', sessionStatus: 'DECIDE', promptVersion: 'sonah.narrative/28',
    windowResults: [{ windowIndex: 0, eventIds: [...ids], failure: null, narrative: { requirements: [] } }],
    requirements: [
      { instruction: receipt('I1', ASK1), text: 'Add a limit', status: 'not-checked', reason: 'deliverable_ungrounded' },
      { instruction: receipt('I2', ASK2), text: 'Document it', status: 'not-checked', reason: 'deliverable_ungrounded' },
      { instruction: receipt('I3', ASK3), text: 'Test it', status: 'not-checked', reason: 'deliverable_ungrounded' },
    ],
    decisions: [], findings: [], pivots: [], promises: [], writtenClaims: [], failures: [],
    counts: { decisions: 0, byColumn: { 'asked-settled': 0, 'asked-chose': 0, unasked: 0 }, uncheckedColumn: 0 },
  };
}
const FIRST = 'Compaction 1: Claude Code compacted the agent\'s context here and dropped 956,238 of its 967,925 tokens.';
const SECOND = 'Compaction 2: Claude Code compacted the agent\'s context here.';

test('B10d: each typed compaction, numbered, at its place, counted by what the context dropped; a helper\'s is not yours',
  () => {
    const { session, ids } = compactedSession();
    const model = reportModel(session, report(ids));
    assert.deepEqual(model.prompt.compactions, [
      { n: 1, afterMessage: 1, dropped: 956_238, before: 967_925, words: FIRST },
      { n: 2, afterMessage: 2, dropped: null, before: null, words: SECOND }]);
    assert.equal(REPORT_PROMPT_WORDS.compaction(1, 956_238, 967_925), FIRST);
    // The page: each between the messages it falls between.
    const page = renderSessionPage(session, report(ids));
    const at = (text) => page.indexOf(text);
    const first = at(FIRST.replace("'", '&#39;')), second = at(SECOND.replace("'", '&#39;'));
    assert.ok(first > 0 && second > first, 'both on the page, in order');
    assert.ok(at('Add a limit parameter') < first && first < at('Now document the limit') && at('Now document the limit')
      < second && second < at('And add a test'), 'each between its messages');
    assert.equal(page.split('class="note compaction"').length - 1, 2);
    // The .md: the same lines between the folded messages.
    const md = renderReportMarkdown(session, report(ids));
    // A message is quoted in its fold (`> `); the asks table holds the asks' words without the mark.
    const mat = (text) => md.indexOf(text);
    const m1 = md.indexOf(FIRST), m2 = md.indexOf(SECOND);
    assert.ok(m1 > 0 && m2 > m1);
    assert.ok(mat('> Add a limit parameter') < m1 && m1 < mat('> Now document the limit')
      && mat('> Now document the limit') < m2 && m2 < mat('> And add a test'), 'each between its messages');
  });

test('B10d: a compaction after your last message is shown after it, on the page and in the .md', () => {
  const { session, ids } = compactedSession({ last: { before: 400, after: 12 } });
  const THIRD = 'Compaction 3: Claude Code compacted the agent\'s context here and dropped 388 of its 400 tokens.';
  const model = reportModel(session, report(ids));
  assert.deepEqual(model.prompt.compactions.at(-1), { n: 3, afterMessage: 3, dropped: 388, before: 400, words: THIRD });
  const md = renderReportMarkdown(session, report(ids));
  assert.ok(md.indexOf(THIRD) > md.indexOf('> And add a test'));
  const page = renderSessionPage(session, report(ids));
  assert.ok(page.indexOf(THIRD.replace("'", '&#39;')) > page.indexOf('And add a test'));
});

test('B10d: counts that disagree, or a single count, show the compaction alone', () => {
  for (const first of [{ before: 10, after: 20 }, { before: 10 }, { after: 5 }, {}]) {
    const { session, ids } = compactedSession({ first });
    assert.equal(reportModel(session, report(ids)).prompt.compactions[0].words,
      'Compaction 1: Claude Code compacted the agent\'s context here.');
  }
});

test('N1: an ask given before a compaction is marked by the first compaction after it, in the asks table', () => {
  const { session, ids } = compactedSession();
  const model = reportModel(session, report(ids));
  assert.deepEqual(model.prompt.asks.map((ask) => ask.compaction ?? null), [1, 2, null]);
  const md = renderReportMarkdown(session, report(ids));
  const rows = md.split('\n').filter((line) => line.startsWith('| Not checked |'));
  assert.equal(rows.length, 3);
  // D133 (R2): said once for each compaction, in one line above the asks given before it, never on each row: the table
  // is cut there, each part under its own heading row.
  for (const row of rows) assert.doesNotMatch(row, /Before compaction/);
  const at = (text) => md.indexOf(text);
  assert.ok(at(REPORT_PROMPT_WORDS.beforeCompaction(1)) < at(rows[0]) && at(rows[0]) < at(REPORT_PROMPT_WORDS
    .beforeCompaction(2)) && at(REPORT_PROMPT_WORDS.beforeCompaction(2)) < at(rows[1]) && at(rows[1]) < at(rows[2]), md);
  assert.equal(md.split('\n').filter((line) => line.startsWith('Before compaction')).length, 2);
  assert.equal(md.split('\n').filter((line) => line === '|---|---|---|').length, 3);
  assert.equal(REPORT_PROMPT_WORDS.beforeCompaction(2), 'Before compaction 2.');
});

test('B10d with D126: a session that opens on a compaction says so beside the title', () => {
  const read = compactedSession({ continued: { earlier: 2, unread: null } });
  const model = reportModel(read.session, report(read.ids));
  assert.equal(model.header.continued, 'Sonah read this session from 3 recordings. Claude Code began each later one '
    + 'after a compaction.');
  assert.ok(renderSessionPage(read.session, report(read.ids)).includes(`<p class="meta continued">`));
  const md = renderReportMarkdown(read.session, report(read.ids));
  assert.ok(md.includes(REPORT_HEADER_WORDS.continued(2)));
  const unread = compactedSession({ continued: { earlier: 0, unread: 'earlier_recording_missing' } });
  // D133 (R2): beside the title one short line; the whole sentence first in What Sonah could not check.
  const unreadModel = reportModel(unread.session, report(unread.ids));
  assert.equal(unreadModel.header.continued, REPORT_HEADER_WORDS.continuedPart);
  assert.equal(unreadModel.notChecked.quiet[0], REPORT_HEADER_WORDS.continuedUnread);
  for (const text of [renderSessionPage(unread.session, report(unread.ids)), renderReportMarkdown(unread.session,
    report(unread.ids))]) {
    assert.ok(text.includes(REPORT_HEADER_WORDS.continuedPart));
    assert.ok(text.indexOf(REPORT_HEADER_WORDS.continuedUnread) > text.indexOf(REPORT_SECTION_WORDS.notChecked));
  }
  // A session read whole, that does not open on a compaction, says nothing.
  const plain = compactedSession({ continued: { earlier: 0, unread: null } });
  assert.equal(reportModel(plain.session, report(plain.ids)).header.continued, undefined);
});

test('B10d, N1: a session with no typed compaction renders as before: no field, no line', () => {
  const { session, ids } = compactedSession({ first: null, second: null, helper: false });
  // Boundaries without typed facts: no compaction is counted, no ask is marked.
  for (const event of session.events) if (event.kind === 'boundary') delete event.compacted;
  const model = reportModel(session, report(ids));
  assert.equal(model.prompt.compactions, undefined);
  assert.ok(model.prompt.asks.every((ask) => !Object.hasOwn(ask, 'compaction')));
  assert.equal(model.header.continued, undefined);
  assert.ok(!renderSessionPage(session, report(ids)).includes('compaction'));
  assert.ok(!renderReportMarkdown(session, report(ids)).includes('ompaction'));
});
