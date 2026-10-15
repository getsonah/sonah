// W3b — the report reads right: bounded excerpts, paired outcomes, lines that say what they are.
//
// Five defects Sonah found reviewing the merges of its own wave:
//   F54 the timeline's "never cut the quote" rule was implemented as "extend from the start of
//       the source to the end of the quote", which is unbounded — a 27-character quote 5,000
//       characters into a tool result rendered the whole 5,000-character run-up with it.
//   F55 a delegation was selected for the timeline without its recorded outcome, so a hand-off
//       showed what was asked and never what came back.
//   F50 a gap on the `children` channel was phrased with the generic inventory sentence, so
//       "a sub-agent's session was only partly captured" read as "this session's inventory".
//   F51 a delegate invocation rendered as `Agent` Agent — the tool name twice, and nothing
//       about what was delegated.
//   F37 a `role: 'code'` receipt cites an invocation's changed source, but the invocation's
//       line only ever showed its command or its paths, so the cited code was nowhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { renderTimeline, renderReview, GAP_SENTENCE } from '../src/review.js';

const TIMELINE_CAP = 40;   // matches TIMELINE_MAX_EVENTS in src/review.js; the spec forbids raising it
const EXCERPT_CHARS = 160; // matches src/review.js; likewise frozen

function put(blobs, key, text) {
  blobs[key] = text;
  return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
}

const baseReport = (session, over = {}) => ({
  session, pr: { files: [] }, findings: [], decisions: [], pivots: [], requirements: [], ...over,
});

const citing = (receipts) => ({
  origin: 'session-review', kind: 'code_issue', title: 't', explanation: 'e',
  scope: 'current-code', anchor: null, receipts,
});

/** The one rendered timeline line for an event id. */
function lineFor(lines, id) {
  const found = lines.filter((l) => l.includes(`\`${id}\``));
  assert.equal(found.length, 1, `expected exactly one rendered line for ${id}, got ${found.length}`);
  return found[0];
}

const ellipses = (line) => (line.match(/…/g) ?? []).length;

// ---- F54: a bounded window around every cited quote --------------------------------------

test('a quote 5,000 characters into an output renders as a bounded window, not the whole run-up (F54)', () => {
  const blobs = {};
  const quote = 'redis.example.internal:6379';
  const output = `${'x'.repeat(5000)} ${quote} ${'y'.repeat(5000)}`;
  const events = [
    { id: 'X1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [],
      text: put(blobs, 'ask', 'Start the cache and report the host it bound to.') },
    { id: 'X2', kind: 'invocation', sequence: 1, tool: 'Bash', operation: 'command', paths: [],
      command: put(blobs, 'cmd', 'npm run cache'), input: [], changes: [] },
    { id: 'X3', kind: 'observation', sequence: 2, invocation: 'X2', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: put(blobs, 'out', output) },
  ];
  const session = new Session({ sessionKey: 'w3b-deep-quote', events, blobs });
  const report = baseReport(session, {
    findings: [citing([{ role: 'observation', eventId: 'X3', quote }])],
  });

  const line = lineFor(renderTimeline(session, report), 'X3');
  assert.ok(line.includes(quote), `the cited quote must survive:\n${line.slice(0, 200)}`);
  assert.ok(line.length < 400,
    `a window around the quote, not the 5,000 characters before it — rendered ${line.length} characters`);
});

test('two quotes cited on one event each get their own window (F54)', () => {
  const blobs = {};
  const first = 'the first cited fragment';
  const second = 'the second cited fragment';
  const output = `${'a'.repeat(1000)} ${first} ${'b'.repeat(1000)} ${second} ${'c'.repeat(1000)}`;
  const events = [
    { id: 'Y1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [],
      text: put(blobs, 'ask', 'Run it.') },
    { id: 'Y2', kind: 'invocation', sequence: 1, tool: 'Bash', operation: 'command', paths: [],
      command: put(blobs, 'cmd', 'npm test'), input: [], changes: [] },
    { id: 'Y3', kind: 'observation', sequence: 2, invocation: 'Y2', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: put(blobs, 'out', output) },
  ];
  const session = new Session({ sessionKey: 'w3b-two-quotes', events, blobs });
  const report = baseReport(session, {
    findings: [citing([{ role: 'observation', eventId: 'Y3', quote: first }]),
      citing([{ role: 'observation', eventId: 'Y3', quote: second }])],
  });

  const line = lineFor(renderTimeline(session, report), 'Y3');
  assert.ok(line.includes(first), 'the first cited quote must appear');
  assert.ok(line.includes(second), 'the second cited quote must appear');
  // The leading excerpt plus one bounded window per quote — roughly 160 + 145 + 145. The old
  // code extended from the start of the source to the end of the LAST quote, which here is
  // past 2,000 characters. The structural cap is EXCERPT_CHARS + 2 x 160 per window.
  assert.ok(line.length < 500,
    `two bounded windows, not the run-up to the last quote — rendered ${line.length} characters`);
  assert.ok(line.length <= EXCERPT_CHARS + 2 * (2 * EXCERPT_CHARS) + 40, 'within the stated cap');
});

test('two quotes close together render as one merged window, not two (F54)', () => {
  const blobs = {};
  const first = 'alpha cited fragment';
  const second = 'beta cited fragment';
  const between = 'zz';
  const output = `${'a'.repeat(400)} ${first} ${between} ${second} ${'c'.repeat(400)}`;
  const events = [
    { id: 'Z1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [],
      text: put(blobs, 'ask', 'Run it.') },
    { id: 'Z2', kind: 'invocation', sequence: 1, tool: 'Bash', operation: 'command', paths: [],
      command: put(blobs, 'cmd', 'npm test'), input: [], changes: [] },
    { id: 'Z3', kind: 'observation', sequence: 2, invocation: 'Z2', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: put(blobs, 'out', output) },
  ];
  const session = new Session({ sessionKey: 'w3b-merge', events, blobs });
  const report = baseReport(session, {
    findings: [citing([{ role: 'observation', eventId: 'Z3', quote: first },
      { role: 'observation', eventId: 'Z3', quote: second }])],
  });

  const line = lineFor(renderTimeline(session, report), 'Z3');
  assert.ok(line.includes(`${first} ${between} ${second}`),
    `overlapping windows must render as one contiguous run:\n${line}`);
  // One ellipsis between the leading excerpt and the merged window, one at the end. A third
  // would mean the two windows were emitted separately with the same text printed twice.
  assert.equal(ellipses(line), 2, `expected one merged window:\n${line}`);
});

test('a quote already inside the leading excerpt adds no window (F54)', () => {
  const blobs = {};
  const quote = 'the quote right at the top';
  const output = `${quote} ${'z'.repeat(2000)}`;
  const events = [
    { id: 'Q1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [],
      text: put(blobs, 'ask', 'Run it.') },
    { id: 'Q2', kind: 'invocation', sequence: 1, tool: 'Bash', operation: 'command', paths: [],
      command: put(blobs, 'cmd', 'npm test'), input: [], changes: [] },
    { id: 'Q3', kind: 'observation', sequence: 2, invocation: 'Q2', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: put(blobs, 'out', output) },
  ];
  const session = new Session({ sessionKey: 'w3b-head-quote', events, blobs });
  const report = baseReport(session, {
    findings: [citing([{ role: 'observation', eventId: 'Q3', quote }])],
  });

  const line = lineFor(renderTimeline(session, report), 'Q3');
  assert.ok(line.includes(quote), 'the quote is in the leading excerpt already');
  assert.equal(ellipses(line), 1, `only the closing ellipsis is warranted:\n${line}`);
});

// ---- F55 / F51: a delegation shows what was asked AND what came back ----------------------

/**
 * A synthetic session of `n` events — instruction-opened turns of invocation/observation pairs —
 * with one delegation and its terminal observation appended at the very end, well past the point
 * a 40-event timeline stops filling.
 */
function buildEvents(n) {
  const events = [];
  const blobs = {};
  let turn = 0;
  while (events.length < n) {
    events.push({ id: `I${turn}`, kind: 'instruction', sequence: events.length, authority: 'human',
      supersedes: [], text: put(blobs, `instr${turn}`, `Turn ${turn}: please keep going on the migration.`) });
    for (let p = 0; p < 9 && events.length < n; p++) {
      const id = `A${turn}-${p}`;
      const path = `src/turn-${turn}-file-${p}.js`;
      events.push({ id, kind: 'invocation', sequence: events.length, tool: 'Write', operation: 'write',
        paths: [{ path }], command: [], input: [], changes: [] });
      if (events.length < n) {
        events.push({ id: `${id}-r`, kind: 'observation', sequence: events.length, invocation: id,
          phase: 'terminal', result: 'succeeded', exitCode: 0,
          output: put(blobs, `${id}-out`, `wrote ${path} successfully, no further output`) });
      }
    }
    turn++;
  }
  return { events, blobs };
}

const ASSIGNMENT_HEAD = 'Review the redaction module for fail-open paths.';
const ASSIGNMENT_TAIL = 'Use the golden fixtures only.';

function delegatingSession(key) {
  const { events, blobs } = buildEvents(100);
  const at = events.length;
  events.push({ id: 'DEL', kind: 'invocation', sequence: at, tool: 'Task', operation: 'delegate',
    paths: [], command: [], changes: [],
    input: put(blobs, 'assign', `${ASSIGNMENT_HEAD}\n${ASSIGNMENT_TAIL}`) });
  events.push({ id: 'DEL-r', kind: 'observation', sequence: at + 1, invocation: 'DEL',
    phase: 'terminal', result: 'succeeded', exitCode: 0,
    output: put(blobs, 'delout', 'sub-agent finished: 2 files reviewed, 1 finding reported') });
  assert.ok(events.length > TIMELINE_CAP, 'the fixture must exceed the cap for tiering to matter');
  return new Session({ sessionKey: key, events, blobs });
}

test("a delegation's recorded outcome rides along with the hand-off (F55)", () => {
  const session = delegatingSession('w3b-delegation-outcome');
  const lines = renderTimeline(session, baseReport(session));
  const md = lines.join('\n');

  assert.match(md, /`DEL`/, 'the hand-off itself is a delegation-tier event');
  assert.match(md, /`DEL-r`/,
    'a hand-off with no outcome is half the record; tiers 1 and 2 already pair theirs');
  assert.ok(lineFor(lines, 'DEL-r').includes('2 files reviewed'), 'the outcome text renders');
});

test('a delegate invocation shows the first line of its assignment, not the tool name twice (F51)', () => {
  const session = delegatingSession('w3b-delegation-assignment');
  const line = lineFor(renderTimeline(session, baseReport(session)), 'DEL');

  assert.ok(line.includes(ASSIGNMENT_HEAD), `the assignment must be on the line:\n${line}`);
  assert.doesNotMatch(line, /`Task` Task/, 'naming the tool twice says nothing about the hand-off');
  assert.ok(!line.includes(ASSIGNMENT_TAIL), 'the first line of the assignment, not the whole brief');
});

// ---- F37: a code receipt puts its cited change on the invocation's line -------------------

test('a code receipt on an invocation renders the cited change, bounded (F37)', () => {
  const blobs = {};
  const quote = 'const timeoutMs = 30000;';
  const filler = 'filler source line that is not the cited one. '.repeat(120);
  const after = `${filler}${quote} ${filler}`;
  assert.ok(after.indexOf(quote) > 5000, 'the cited literal must sit deep in the written body');

  const events = [
    { id: 'C1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [],
      text: put(blobs, 'ask', 'Set the timeout.') },
    { id: 'C2', kind: 'invocation', sequence: 1, tool: 'Write', operation: 'write',
      paths: [{ path: 'src/config.js' }], command: [], input: [],
      changes: [{ path: 'src/config.js', after: put(blobs, 'after', after) }] },
    { id: 'C3', kind: 'observation', sequence: 2, invocation: 'C2', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: put(blobs, 'out', 'wrote src/config.js') },
  ];
  const session = new Session({ sessionKey: 'w3b-code-receipt', events, blobs });
  const report = baseReport(session, {
    findings: [citing([{ role: 'code', eventId: 'C2', quote }])],
  });

  const line = lineFor(renderTimeline(session, report), 'C2');
  assert.ok(line.includes(quote), `the cited code must be visible on its own line:\n${line}`);
  assert.ok(line.includes('src/config.js'), 'the path stays, so the reader knows what was written');
  assert.ok(line.length < 400, `a bounded window, not the whole file — rendered ${line.length} characters`);
});

// ---- F50: a children gap reads as a children gap ------------------------------------------

const shell = (over) => ({
  repo: { host: 'github.com', id: '1' }, pr: { number: 7, files: [] }, session: null,
  hasSessionEvidence: true, decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [],
  gaps: [], counts: { decisions: 0, byColumn: {}, uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 },
  coverage: 'partial', codeCoverage: 'missing', ...over,
});

test('an incomplete_inventory on the children channel is not phrased as this session\'s inventory (F50)', () => {
  const note = 'the linked child session declares an incomplete capture of its own';
  const md = renderReview(shell({ gaps: [{ code: 'incomplete_inventory', channel: 'children',
    scope: 'session', count: null, eventIds: ['DEL'], note }] }));

  assert.ok(md.includes(note), 'the declaration named the hand-off; printing only the code hides it');
  assert.ok(!md.includes(GAP_SENTENCE.incomplete_inventory),
    'delegated work that was not fully captured is not "the session inventory was incomplete"');
  assert.match(md, /sub-agent/, 'the children channel is about a sub-agent session');
});

test('a gap on another channel keeps the general sentence (F50)', () => {
  const md = renderReview(shell({ gaps: [{ code: 'incomplete_inventory', channel: 'instructions',
    scope: 'session', count: 2, note: 'instruction text was elided by the recorder' }] }));
  assert.ok(md.includes(GAP_SENTENCE.incomplete_inventory),
    'only the children channel gets the children variant');
});
