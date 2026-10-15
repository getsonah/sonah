// W3-8: the session timeline shows the events a reader actually needs — the ones a finding,
// decision, pivot or requirement cites, the ones that touched a changed file, and delegations —
// before it spends the rest of its 40-event cap on "everything else, in order". The old
// behaviour was `events.slice(0, 40)`: in a 1,415-event dogfood session that was the
// orchestrator reading documents, never the evidence a finding actually pointed at.
//
// Covers the five required behaviours of the W3-8 timeline spec.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { renderTimeline } from '../src/review.js';

const TIMELINE_CAP = 40; // matches TIMELINE_MAX_EVENTS in src/review.js; the spec forbids raising it

function put(blobs, key, text) {
  blobs[key] = text;
  return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
}

/**
 * A synthetic session of exactly `n` events: instruction-opened "turns", each followed by up to
 * nine invocation/observation pairs. Every invocation writes a distinct synthetic path, so tests
 * can retarget one onto a PR file by id without disturbing the rest of the shape.
 *
 * Turn t's instruction lands at sequence t*19; turn t pair p's invocation lands at
 * t*19 + 1 + 2p and its observation at t*19 + 2 + 2p — deterministic, so a test can pick an id
 * and know its sequence without re-deriving it at run time.
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

const baseReport = (session, over = {}) => ({
  session, pr: { files: [] }, findings: [], decisions: [], pivots: [], requirements: [], ...over,
});

function idsShown(md) {
  return [...md.matchAll(/^[▸-] `([^`]+)`/gm)].map((m) => m[1]);
}

// ---- 1. cited events beat "first N", and the instruction-of-turn / paired observation ride along

test('a finding citing a late event pulls that event, its observation, and its turn instruction to the front', () => {
  const { events, blobs } = buildEvents(100);
  const session = new Session({ sessionKey: 'timeline-cited', events, blobs });
  // Turn 4's instruction (I4) is at sequence 76; A4-5 (the cited invocation) is at 87; its
  // observation A4-5-r is at 88. None of that is reachable by a naive first-40 slice.
  assert.equal(session.event('I4').sequence, 76);
  assert.equal(session.event('A4-5').sequence, 87);
  assert.equal(session.event('A4-5-r').sequence, 88);

  const report = baseReport(session, {
    findings: [{ origin: 'session-review', kind: 'edit_under_negative_requirement',
      title: 'late finding', explanation: 'e', scope: 'current-code', anchor: null,
      receipts: [{ role: 'action', eventId: 'A4-5', quote: 'src/turn-4-file-5.js' }] }],
  });
  const md = renderTimeline(session, report).join('\n');

  assert.match(md, /`A4-5`/, 'the cited event itself must appear');
  assert.match(md, /`A4-5-r`/, 'its paired observation must appear');
  assert.match(md, /`I4`/, 'the instruction event of its turn must appear');
  // Tier-1 lines are marked so a reader can find them at a glance.
  assert.match(md, /▸ `A4-5`/);

  // The rest of the 40-event budget is spent from the START of the session, not by continuing
  // where a naive slice(0, 40) would have stopped (sequence 40) — otherwise the first "other"
  // event shown would be the 41st in sequence, exactly the bug this spec closes.
  const shown = idsShown(md);
  assert.equal(shown.length, TIMELINE_CAP);
  const citedTier = new Set(['I4', 'A4-5', 'A4-5-r']);
  const otherSequences = shown.filter((id) => !citedTier.has(id)).map((id) => session.event(id).sequence);
  assert.ok(otherSequences.length > 0);
  assert.ok(Math.max(...otherSequences) < 40,
    `filler events must start from the beginning of the session, got max sequence ${Math.max(...otherSequences)}`);
  assert.match(md, /`I0`/, 'filler starts at the very first event, not sequence 41');
});

// ---- 2. touched files beat plain sequence order once the cap is tight

test('an invocation touching a changed PR file is shown even at a high sequence; one outside pr.files is dropped once the cap is hit', () => {
  const { events, blobs } = buildEvents(100);
  const touched = events.find((e) => e.id === 'A4-6');    // sequence 89 — well past the fill cutoff
  touched.paths = [{ path: 'src/x.js' }];
  const untouched = events.find((e) => e.id === 'A4-7');  // sequence 91 — same neighbourhood, not in pr.files
  untouched.paths = [{ path: 'docs/y.md' }];

  const session = new Session({ sessionKey: 'timeline-touched', events, blobs });
  const report = baseReport(session, { pr: { files: [{ path: 'src/x.js', change: 'modified' }] } });
  const md = renderTimeline(session, report).join('\n');

  assert.match(md, /`A4-6`/, 'the invocation touching a changed file must appear');
  assert.match(md, /`A4-6-r`/, 'its observation rides along');
  assert.doesNotMatch(md, /`A4-7`/, 'an invocation outside pr.files must not survive the cap');
  assert.equal(idsShown(md).length, TIMELINE_CAP);
});

// ---- 3. the footer names every tier and its counts sum to what was shown

test('the footer counts sum to the number shown and name all four tiers', () => {
  const { events, blobs } = buildEvents(100);
  const touchedEvent = events.find((e) => e.id === 'A2-3');
  touchedEvent.paths = [{ path: 'src/touched.js' }];
  events.push({ id: 'D5-0', kind: 'invocation', sequence: events.length, tool: 'Task',
    operation: 'delegate', paths: [], command: [], input: [], changes: [] });

  const session = new Session({ sessionKey: 'timeline-footer', events, blobs });
  const report = baseReport(session, {
    pr: { files: [{ path: 'src/touched.js', change: 'modified' }] },
    findings: [{ origin: 'session-review', kind: 'k', title: 't', explanation: 'e',
      scope: 'current-code', anchor: null,
      receipts: [{ role: 'action', eventId: 'A4-5', quote: 'src/turn-4-file-5.js' }] }],
  });
  const md = renderTimeline(session, report).join('\n');

  const m = md.match(/_Showing (\d+) of (\d+) events: (\d+) cited by findings, (\d+) touching changed files, (\d+) delegations, (\d+) others\._/);
  assert.ok(m, `footer did not match the expected phrasebook shape:\n${md}`);
  const [shown, total, cited, touchedCount, delegations, others] = m.slice(1).map(Number);
  assert.equal(total, session.events.length);
  assert.equal(shown, TIMELINE_CAP);
  assert.equal(cited + touchedCount + delegations + others, shown);
  assert.ok(cited > 0 && touchedCount > 0 && delegations > 0, 'this fixture stocks all four tiers');
});

// ---- 4. a cited event's excerpt is never trimmed shorter than the receipt's own quote

test("a cited event's excerpt contains the receipt's quote verbatim, even past the normal excerpt length", () => {
  const blobs = {};
  const quote = 'the important verbatim result text that must survive';
  const longOutput = `${'A'.repeat(140)} ${quote} ${'B'.repeat(150)}`;
  assert.ok(longOutput.indexOf(quote) + quote.length > 160, 'fixture must exceed the default excerpt length');

  const events = [
    { id: 'X1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [],
      text: put(blobs, 'ask', 'Run the suite and report back.') },
    { id: 'X2', kind: 'invocation', sequence: 1, tool: 'Bash', operation: 'command', paths: [],
      command: put(blobs, 'cmd', 'npm test'), input: [], changes: [] },
    { id: 'X3', kind: 'observation', sequence: 2, invocation: 'X2', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: put(blobs, 'out', longOutput) },
  ];
  const session = new Session({ sessionKey: 'timeline-quote', events, blobs });
  const report = baseReport(session, {
    findings: [{ origin: 'session-review', kind: 'k', title: 't', explanation: 'e',
      scope: 'current-code', anchor: null,
      receipts: [{ role: 'observation', eventId: 'X3', quote }] }],
  });
  const md = renderTimeline(session, report).join('\n');

  assert.ok(md.includes(quote), `excerpt must not truncate the receipt's own quote:\n${md}`);
});

// ---- 5. under the cap, nothing is hidden and order stays chronological

test('with everything under the cap, the footer says every event was shown and order stays chronological', () => {
  const { events, blobs } = buildEvents(30);
  const session = new Session({ sessionKey: 'timeline-30', events, blobs });
  const report = baseReport(session);
  const md = renderTimeline(session, report).join('\n');

  assert.match(md, /_All 30 events shown\._/);
  assert.doesNotMatch(md, /_Showing \d+ of \d+ events:/);
  const sequences = idsShown(md).map((id) => session.event(id).sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.equal(sequences.length, 30);
});
