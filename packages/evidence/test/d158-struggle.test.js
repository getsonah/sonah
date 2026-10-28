// D158: the struggle map (struggle.js `struggleMap`) — failed runs, edits after a failed run that named their file, and
// files no run that may have passed followed — built from typed facts and recorded order alone. Synthetic sessions only:
// no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRUGGLE_SIGNALS, STRUGGLE_PASSING_OUTCOMES, STRUGGLE_MAY_PASS_OUTCOMES, SESSION_EDGE_VERSION }
  from '../src/ledger.js';
import { struggleMap, sessionFacts, holdsFileName, fileNameOf } from '../src/struggle.js';
import { edgeSession, ROWS, build } from './d158-session-edge-fixture.js';

/** The fixture's rows with `id`'s row replaced by `row` (or removed when null), and `added` after `after`. */
const rowsWith = (changes = {}, { after = null, added = [] } = {}) => ROWS.flatMap((row) => {
  const changed = Object.hasOwn(changes, row[0]) ? changes[row[0]] : row;
  const kept = changed === null ? [] : [changed];
  return row[0] === after ? [...kept, ...added] : kept;
});
const signalsOf = (session, kind) => struggleMap(session).signals.filter((s) => s.signal === kind);

test('D158: the vocabularies', () => {
  assert.deepEqual(STRUGGLE_SIGNALS, ['failed_run', 'edit_after_failed_run', 'edited_after_last_passing_run']);
  assert.deepEqual(STRUGGLE_PASSING_OUTCOMES, ['ran-exit-0', 'ran-completed']);
  assert.deepEqual(STRUGGLE_MAY_PASS_OUTCOMES, ['ran-exit-0', 'ran-completed', 'output-no-status', 'end-unread']);
  assert.equal(SESSION_EDGE_VERSION, 'sonah.session-edge/1');
  for (const list of [STRUGGLE_SIGNALS, STRUGGLE_PASSING_OUTCOMES, STRUGGLE_MAY_PASS_OUTCOMES])
    assert.ok(Object.isFrozen(list));
});

test('D158: the struggle map of the edge session, golden', () => {
  const ED = (eventId, path, failedResult) => ({ eventId, path, effect: 'landed',
    namedIn: { eventId: failedResult, field: 'output' } });
  assert.deepEqual(struggleMap(edgeSession()), {
    runs: { total: 6, failed: 4, passing: 1 }, edits: { landed: 4, unknown: 1 }, unordered: 0,
    signals: [
      { signal: 'failed_run', actor: null, run: 'A1', result: 'A1-r' },
      { signal: 'edit_after_failed_run', actor: null, failed: 'A1', edits: [ED('ED1', 'src/greet.js', 'A1-r')],
        passed: 'A3' },
      { signal: 'failed_run', actor: null, run: 'A2', result: 'A2-r' },
      { signal: 'edit_after_failed_run', actor: null, failed: 'A2', edits: [ED('ED2', 'test/greet.test.js', 'A2-r')],
        passed: 'A3' },
      { signal: 'failed_run', actor: null, run: 'A4', result: 'A4-r' },
      { signal: 'failed_run', actor: 'w', run: 'WA1', result: 'WA1-r' },
      // A run of the tests the person refused (A5) ran nothing: CHANGELOG.md has no run after its last edit.
      { signal: 'edited_after_last_passing_run', actor: null, path: 'CHANGELOG.md', lastEdit: 'ED4', effect: 'landed' },
    ] });
  // The same session gives the same bytes.
  assert.equal(JSON.stringify(struggleMap(edgeSession())), JSON.stringify(struggleMap(edgeSession())));
});

test('D158: a file name stands in a text only as a whole name', () => {
  for (const [text, name, holds] of [
    ['at greet (src/greet.js:3:9)', 'greet.js', true], ['see greet.js.', 'greet.js', true],
    ['(greet.js)', 'greet.js', true], ['greet.js', 'greet.js', true], ['C:\\src\\greet.js', 'greet.js', true],
    ['greet.json', 'greet.js', false], ['xgreet.js', 'greet.js', false], ['a.greet.js', 'greet.js', false],
    ['greet.js.map', 'greet.js', false], ['greet-js', 'greet.js', false], ['greet.jsx then greet.js', 'greet.js', true],
    ['', 'greet.js', false], ['greet.js', '', false], [null, 'greet.js', false]])
    assert.equal(holdsFileName(text, name), holds, JSON.stringify([text, name]));
  assert.equal(fileNameOf('src/greet.js'), 'greet.js');
  assert.equal(fileNameOf('C:\\src\\greet.js'), 'greet.js');
  assert.equal(fileNameOf('src/'), null);
  assert.equal(fileNameOf(7), null);
});

test('D158: a failed run is one the record types as ran and failed', () => {
  // A typed exit 1 is one (A4); a result the recorder typed as cancelled, or a failure read from output, is not.
  assert.ok(signalsOf(edgeSession(), 'failed_run').some((s) => s.run === 'A4'));
  const session = edgeSession();
  session.event('A4-r').result = 'cancelled';
  session.event('A4-r').exitCode = null;
  assert.ok(!signalsOf(session, 'failed_run').some((s) => s.run === 'A4'), 'cancelled');
  const parsed = edgeSession();
  Object.assign(parsed.event('A4-r'), { sourceOfResult: 'parsed-output', exitCode: null, terminalStatusProven: false });
  assert.ok(!signalsOf(parsed, 'failed_run').some((s) => s.run === 'A4'), 'a failure read from output');
  // A run the person refused (A5: its result failed) is no failed run, and no run.
  assert.ok(!signalsOf(edgeSession(), 'failed_run').some((s) => s.run === 'A5'));
  assert.equal(struggleMap(edgeSession()).runs.total, 6, 'the refused run is not counted');
});

test('D158: an edit after a failed run that named its file, then a passing run of the same agent', () => {
  // No passing run after the edits: no signal.
  const unpassed = build(rowsWith({ 'A3-r': ['A3-r', 'fail', 'fail2', { of: 'A3' }] }));
  assert.deepEqual(signalsOf(unpassed, 'edit_after_failed_run'), []);
  // A file name shorter than MIN_QUOTE_CHARS selects nothing (`at` stands whole in A1's output).
  const short = build(rowsWith({ ED1: ['ED1', 'edit', 'greet', { path: 'src/at' }] }));
  assert.deepEqual(signalsOf(short, 'edit_after_failed_run').map((s) => s.failed), ['A2']);
  // A file outside the repository is not read.
  const outside = build(rowsWith({ ED1: ['ED1', 'edit', 'greet', { path: 'src/greet.js', outside: true }] }));
  assert.deepEqual(signalsOf(outside, 'edit_after_failed_run').map((s) => s.failed), ['A2']);
  // The edit names the latest failed run of its agent that names its file: an unrelated failure between them (A2's
  // output does not name greet.js) leaves the edit with A1.
  const later = build(rowsWith({ ED1: null }, { after: 'A2-r', added: [['ED1', 'edit', 'greet', { path: 'src/greet.js' }],
    ['ED1-r', 'ok', 'updated', { of: 'ED1' }]] }));
  assert.deepEqual(signalsOf(later, 'edit_after_failed_run').map((s) => [s.failed, s.edits.map((e) => e.eventId)]),
    [['A1', ['ED1']], ['A2', ['ED2']]]);
  // The passing run must start after the edit ended: A3 started before ED2's result leaves ED2 out.
  const parallel = build(rowsWith({ 'ED2-r': null }, { after: 'A3', added: [['ED2-r', 'ok', 'updated', { of: 'ED2' }]] }));
  assert.deepEqual(signalsOf(parallel, 'edit_after_failed_run').map((s) => s.failed), ['A1']);
  // A passing run before the edit passes nothing: a failed run after A3 that names greet.js, then an edit of it.
  const before = build(rowsWith({}, { after: 'C1', added: [['A7', 'cmd', 'grep'], ['A7-r', 'fail', 'fail1', { of: 'A7' }],
    ['ED7', 'edit', 'greet', { path: 'src/greet.js' }], ['ED7-r', 'ok', 'updated', { of: 'ED7' }]] }));
  assert.deepEqual(signalsOf(before, 'edit_after_failed_run').map((s) => s.failed), ['A1', 'A2']);
  // Each edit needs its own passing run: a later edit of test/greet.test.js that none follows leaves A2's signal as it was.
  const tail = build(rowsWith({}, { after: 'C1', added: [['ED8', 'edit', 'greetTest', { path: 'test/greet.test.js' }],
    ['ED8-r', 'ok', 'updated', { of: 'ED8' }]] }));
  assert.deepEqual(signalsOf(tail, 'edit_after_failed_run').map((s) => [s.failed, s.edits.map((e) => e.eventId), s.passed]),
    [['A1', ['ED1'], 'A3'], ['A2', ['ED2'], 'A3']]);
  // Another agent's edit is never the struggle of a failed run that is not its own: the helper's edit of src/greet.js
  // after A1 named it.
  const crossed = build(rowsWith({ 'WA2-r': ['WA2-r', 'ok', 'helperOut', { of: 'WA2', child: true }] },
    { after: 'WE1-r', added: [['WE2', 'edit', 'greet', { path: 'src/greet.js', child: true }],
      ['WE2-r', 'ok', 'updated', { of: 'WE2', child: true }]] }));
  assert.deepEqual(signalsOf(crossed, 'edit_after_failed_run').map((s) => [s.failed, s.edits.map((e) => e.eventId)]),
    [['A1', ['ED1']], ['A2', ['ED2']], ['WA1', ['WE1']]]);
  // An edit of another agent: the helper's edit of lib/x.js follows its own failed run, but no passing run of the helper
  // follows it; with one, it is the helper's signal, its effect kept.
  const helper = build(rowsWith({ 'WA2-r': ['WA2-r', 'ok', 'helperOut', { of: 'WA2', child: true }] }));
  assert.deepEqual(signalsOf(helper, 'edit_after_failed_run').filter((s) => s.actor === 'w'),
    [{ signal: 'edit_after_failed_run', actor: 'w', failed: 'WA1', edits: [{ eventId: 'WE1', path: 'lib/x.js',
      effect: 'unknown', namedIn: { eventId: 'WA1', field: 'command' } }], passed: 'WA2' }]);
});

test('D158: each rule told apart from its near neighbour', () => {
  const chains = (session) => signalsOf(session, 'edit_after_failed_run').map((s) => [s.failed, s.edits.map((e) => e.eventId),
    s.passed]);
  const head = [['I1', 'ask', 'ask'], ['A1', 'cmd', 'test'], ['A1-r', 'fail', 'fail1', { of: 'A1' }],
    ['ED1', 'edit', 'greet', { path: 'src/greet.js' }], ['ED1-r', 'ok', 'updated', { of: 'ED1' }]];
  const helperPass = [['D1', 'delegate', 'brief'], ['B1', 'brief', 'brief', { child: true }],
    ['WA9', 'cmd', 'status', { child: true }], ['WA9-r', 'ok', 'pass', { of: 'WA9', child: true }]];
  // Another agent's passing run does not pass an edit: ED2 has only the helper's after it, so it is left out.
  assert.deepEqual(chains(build([...head, ['A3', 'cmd', 'test'], ['A3-r', 'ok', 'pass', { of: 'A3' }],
    ['ED2', 'edit', 'greetTest', { path: 'test/greet.test.js' }], ['ED2-r', 'ok', 'updated', { of: 'ED2' }],
    ...helperPass])), [['A1', ['ED1'], 'A3']]);
  // `passed` is the agent's own first passing run after the edits, not another agent's, not its last.
  assert.deepEqual(chains(build([...head, ...helperPass, ['A3', 'cmd', 'test'], ['A3-r', 'ok', 'pass', { of: 'A3' }],
    ['A6', 'cmd', 'status'], ['A6-r', 'ok', 'pass', { of: 'A6' }]])), [['A1', ['ED1'], 'A3']]);
  // The passing run may be another command: `passed` is a passing run of the agent, not the failed command passing.
  assert.deepEqual(chains(build([...head, ['A9', 'cmd', 'status'], ['A9-r', 'ok', 'pass', { of: 'A9' }]])),
    [['A1', ['ED1'], 'A9']]);
  // A failed run whose result is recorded after the edit is not before it.
  assert.deepEqual(chains(build([['I1', 'ask', 'ask'], ['A1', 'cmd', 'test'], ['ED1', 'edit', 'greet', { path: 'src/greet.js' }],
    ['A1-r', 'fail', 'fail1', { of: 'A1' }], ['ED1-r', 'ok', 'updated', { of: 'ED1' }], ['A3', 'cmd', 'test'],
    ['A3-r', 'ok', 'pass', { of: 'A3' }]])), []);
});

test('D158: a write parsed from a command stands at that command', () => {
  // F0 fails naming src/greet.js; A1 writes it with sed and runs the tests, which fail; A2 passes; A3 tees the tests'
  // output into out.txt (a pipeline: no pass); A4 writes src/util.js and runs the tests, which pass.
  const session = build([['I1', 'ask', 'ask'], ['F0', 'cmd', 'test'], ['F0-r', 'fail', 'fail1', { of: 'F0' }],
    ['A1', 'cmd', 'sedTest'], ['A1-r', 'fail', 'fail1', { of: 'A1' }], ['A1-w', 'parsed', 'greet', { of: 'A1', path: 'src/greet.js' }],
    ['A2', 'cmd', 'status'], ['A2-r', 'ok', 'pass', { of: 'A2' }],
    ['A3', 'cmd', 'teeRun'], ['A3-r', 'uncovered', 'pass', { of: 'A3' }], ['A3-w', 'parsed', 'pass', { of: 'A3', path: 'out.txt' }],
    ['A4', 'cmd', 'sedUtil'], ['A4-r', 'ok', 'pass', { of: 'A4' }], ['A4-w', 'parsed', 'greet', { of: 'A4', path: 'src/util.js' }],
    ['C1', 'said', 'said', { phase: 'final' }]]);
  const facts = sessionFacts(session);
  assert.deepEqual(facts.edits.map((e) => [e.event.id, e.parent, e.place, e.effect]), [
    ['A1-w', 'A1', session.event('A1').sequence, 'unknown'], ['A3-w', 'A3', session.event('A3').sequence, 'unknown'],
    ['A4-w', 'A4', session.event('A4').sequence, 'landed']]);
  // A1's own write is not an edit after A1: it is the edit after F0, which named the file.
  assert.deepEqual(signalsOf(session, 'edit_after_failed_run'), [{ signal: 'edit_after_failed_run', actor: null, failed: 'F0',
    edits: [{ eventId: 'A1-w', path: 'src/greet.js', effect: 'unknown', namedIn: { eventId: 'F0-r', field: 'output' } }],
    passed: 'A2' }]);
  // A4's own passing result follows the write it made: src/util.js is not a file no run followed.
  assert.deepEqual(signalsOf(session, 'edited_after_last_passing_run'), []);
  assert.deepEqual(struggleMap(session).runs, { total: 5, failed: 2, passing: 2 });
  // A file's last edit is the last by place: P writes src/x.js as it starts; R passes; E edits src/x.js; P's result and
  // its parsed write are recorded after. E is the last edit, and no passing result follows it.
  const parallel = build([['I1', 'ask', 'ask'], ['P', 'cmd', 'sedTest'], ['R', 'cmd', 'status'], ['R-r', 'ok', 'pass', { of: 'R' }],
    ['E', 'edit', 'greet', { path: 'src/greet.js' }], ['E-r', 'ok', 'updated', { of: 'E' }], ['P-r', 'fail', 'fail2', { of: 'P' }],
    ['P-w', 'parsed', 'greet', { of: 'P', path: 'src/greet.js' }]]);
  assert.deepEqual(signalsOf(parallel, 'edited_after_last_passing_run'), [{ signal: 'edited_after_last_passing_run',
    actor: null, path: 'src/greet.js', lastEdit: 'E', effect: 'landed' }]);
});

test('D158: a zero status that does not cover the whole line passes nothing, and may have passed', () => {
  // A1 fails naming src/greet.js; ED1 edits it; A2 reruns the tests piped through tail: exit 0, the pipeline's last.
  const session = build([['I1', 'ask', 'ask'], ['A1', 'cmd', 'test'], ['A1-r', 'fail', 'fail1', { of: 'A1' }],
    ['ED1', 'edit', 'greet', { path: 'src/greet.js' }], ['ED1-r', 'ok', 'updated', { of: 'ED1' }],
    ['A2', 'cmd', 'test'], ['A2-r', 'uncovered', 'piped', { of: 'A2' }]]);
  const map = struggleMap(session);
  assert.deepEqual(map.runs, { total: 2, failed: 1, passing: 0 });
  // It gates no edit and is named `passed` nowhere; but no file reads as unfollowed after it.
  assert.deepEqual(map.signals, [{ signal: 'failed_run', actor: null, run: 'A1', result: 'A1-r' }]);
});

test('D158: a file no run that may have passed followed', () => {
  // A later run with no typed end may have passed: no signal for CHANGELOG.md.
  const untyped = build(rowsWith({}, { after: 'A5-r', added: [['A6', 'cmd', 'grep'],
    ['A6-r', 'untyped', 'pass', { of: 'A6' }]] }));
  assert.deepEqual(signalsOf(untyped, 'edited_after_last_passing_run'), []);
  // A later run that failed passes nothing.
  const failed = build(rowsWith({}, { after: 'A5-r', added: [['A6', 'cmd', 'grep'],
    ['A6-r', 'fail', 'pass', { of: 'A6' }]] }));
  assert.deepEqual(signalsOf(failed, 'edited_after_last_passing_run').map((s) => s.path), ['CHANGELOG.md']);
  // A later passing run of another agent counts.
  const helper = build(rowsWith({}, { after: 'A5-r', added: [['WA9', 'cmd', 'test', { child: true }],
    ['WA9-r', 'ok', 'pass', { of: 'WA9', child: true }]] }));
  assert.deepEqual(signalsOf(helper, 'edited_after_last_passing_run'), []);
  // An edit whose effect is not proved is a last edit too (D98), its effect kept.
  const unknown = build(rowsWith({ 'ED4-r': ['ED4-r', 'untyped', 'updated', { of: 'ED4' }] }));
  assert.deepEqual(signalsOf(unknown, 'edited_after_last_passing_run'),
    [{ signal: 'edited_after_last_passing_run', actor: null, path: 'CHANGELOG.md', lastEdit: 'ED4', effect: 'unknown' }]);
  // An edit that failed changed nothing.
  const undone = build(rowsWith({ 'ED4-r': ['ED4-r', 'fail', 'updated', { of: 'ED4' }] }));
  assert.deepEqual(signalsOf(undone, 'edited_after_last_passing_run'), []);
});

test('D158: the map reads only events recorded at or before `until`, and only ordered ones', () => {
  const session = edgeSession();
  const at = session.event('A3-r').sequence;
  const bounded = struggleMap(session, { until: at });
  assert.deepEqual(bounded.signals.map((s) => s.signal), ['failed_run', 'edit_after_failed_run',
    'failed_run', 'edit_after_failed_run']);
  assert.equal(sessionFacts(session, { until: at }).events.length, at + 1);
  const unordered = edgeSession();
  unordered.event('A4').sequence = null;
  const map = struggleMap(unordered);
  assert.equal(map.unordered, 1);
  assert.ok(!map.signals.some((s) => s.run === 'A4'));
});

test('D158: a session it cannot read gives no signal, and it never throws', () => {
  const empty = { runs: { total: 0, failed: 0, passing: 0 }, edits: { landed: 0, unknown: 0 }, unordered: 0, signals: [] };
  for (const session of [null, undefined, {}, { events: 'x' }]) assert.deepEqual(struggleMap(session), empty);
  // Rows with no recorded order are counted, never read.
  assert.deepEqual(struggleMap({ events: [null, 7, { kind: 'invocation' }] }), { ...empty, unordered: 3 });
});
