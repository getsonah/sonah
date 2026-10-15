// M35 windowing (owner-confirmed spec 2026-10-06; C-07 "M35 windowing"): sessions,
// segments, windows. Every segment is one human message and the work after it, labelled by the slicer's labels; a
// helper is a session of its own; windows pack whole segments of one session within 200k tokens of current work; a
// segment over that is cut at the boundaries between the agent's thoughts; every window of a session-only review carries
// its active task, earlier human messages and earlier thoughts (never an earlier action or result) on top, capped at 200k
// tokens; actions and observations but file edits are trimmed to their first and last 1k tokens; and inside a request
// every event is named by a per-window alias, mapped back to its stable id on return.
//
// Synthetic sessions and judges only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { WINDOW_SETTINGS, COMBINED_WINDOW_SETTINGS, WINDOW_REQUEST_MAX_BYTES, TOKEN_BYTES, bytesOfTokens, planWindows,
  segmentsOf, reviewSessions, carriedContext, lineCut, shownFields, shownBytes, aliasTable, mapEventIds, EVENT_ID_LISTS,
  WINDOWING_PROFILE } from '../src/windows.js';
import { planWindowRequests, runReview, runProfile } from '../src/run-review.js';
import { carriedLeftOutLine, helperSessionLine, pieceLine, CARRIED_HUMANS_IN_INVENTORY }
  from '../src/prompt.js';

const KEY = 'm35-windowing';
const blobs = {};
let counter = 0;
/** A text ref to a fresh blob holding `text`. */
const ref = (text) => {
  const key = `b${++counter}`;
  blobs[key] = text;
  return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
};
const ask = (id, text, over = {}) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text), ...over });
const said = (id, text, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref(text), ...over });
const run = (id, command, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
  command: ref(command), input: [], changes: [], ...over });
const out = (id, invocation, text, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation, phase: 'terminal',
  result: 'succeeded', exitCode: 0, terminalStatusProven: true, sourceOfResult: 'native', output: ref(text), ...over });
const session = (events, children = []) => new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...blobs },
  events: events.map((event, sequence) => ({ ...event, sequence })), children });
/** A text of exactly `tokens` tokens' worth of bytes (ASCII). */
const tokens = (n, fill = 'x') => fill.repeat(bytesOfTokens(n));
const ids = (events) => events.map((event) => event.id);

// ---- the settings ------------------------------------------------------------------------------------------------------

test('M35 the settings are the spec\'s frozen literals; a token is 3.6 UTF-8 bytes', () => {
  assert.deepEqual({ ...WINDOW_SETTINGS }, { workTokens: 200_000, carriedTokens: 200_000, trimTokens: 2_000 });
  assert.deepEqual({ ...COMBINED_WINDOW_SETTINGS }, { workTokens: 54_613, carriedTokens: 0, trimTokens: 2_000 });
  assert.equal(TOKEN_BYTES, 3.6);
  assert.equal(bytesOfTokens(200_000), 720_000);
  assert.equal(bytesOfTokens(1_000), 3_600);
  assert.equal(WINDOW_REQUEST_MAX_BYTES, 1_620_000, 'the spec\'s worst-case call, about 450k tokens');
  assert.ok(Object.isFrozen(WINDOW_SETTINGS) && Object.isFrozen(WINDOWING_PROFILE));
  assert.deepEqual(runProfile('session-only').windowing, WINDOWING_PROFILE);
  assert.equal(Object.hasOwn(runProfile('session-only'), 'carry'), false, 'the carry is gone');
  assert.equal(Object.hasOwn(runProfile('session-only'), 'segmentation'), false, 'and the byte-budget segmentation');
});

// ---- segments ----------------------------------------------------------------------------------------------------------

test('M35 every human message starts a segment — queued, answer, after_interrupt and command included; an attached file never', () => {
  const events = [
    said('C0', 'work recorded before any human message'),
    ask('I1', 'Write the parser.'),
    said('C1', 'Writing it.'),
    ask('I1a', 'contents of a file the human attached', { markers: ['attached'] }),
    run('A1', 'node --test'),
    ask('I2', 'Also keep it small.', { markers: ['queued'] }),
    run('Q1', 'ask', { tool: 'AskUserQuestion', operation: 'other' }),
    ask('I3', '--strict', { markers: ['answer'], answerTo: 'Q1' }),
    { id: 'B1', kind: 'boundary', boundary: 'interrupt' },
    ask('I4', 'Stop, do the CLI instead.', { markers: ['after_interrupt'], interruptedBy: 'B1' }),
    ask('I5', '/review', { markers: ['command'] }),
    { id: 'P1', kind: 'instruction', authority: 'peer', supersedes: [], text: ref('a teammate says hi') },
  ];
  const segments = segmentsOf(session(events).events);
  assert.deepEqual(segments.map((s) => [s.start?.id ?? null, s.markers, s.task, s.during, s.interrupted]), [
    [null, [], null, null, null],
    ['I1', [], 'I1', null, null],
    ['I2', ['queued'], 'I1', 'I1', null],
    ['I3', ['answer'], 'I1', 'I1', null],
    ['I4', ['after_interrupt'], 'I4', null, 'I1'],
    ['I5', ['command'], 'I5', null, null],
  ]);
  assert.deepEqual(ids(segments[1].events), ['I1', 'C1', 'I1a', 'A1'], 'the attached file is part of its message');
  assert.deepEqual(ids(segments[5].events), ['I5', 'P1'], 'a peer\'s message starts nothing');
});

test('M35 a compaction is no window boundary: the whole short session is one window', () => {
  const s = session([ask('I1', 'one'), said('C1', 'a'), { id: 'B1', kind: 'boundary', boundary: 'compaction' },
    ask('I2', 'two'), said('C2', 'b')]);
  const windows = planWindows(s);
  assert.equal(windows.length, 1);
  assert.deepEqual(windows[0].segments.map((seg) => seg.start), ['I1', 'I2']);
});

// ---- packing -----------------------------------------------------------------------------------------------------------

test('M35 packing: 60k + 60k + 60k fits one window; a fourth 60k starts the next (the spec\'s example)', () => {
  const events = [];
  for (let k = 1; k <= 4; k++) events.push(ask(`I${k}`, `task ${k}`), said(`C${k}`, tokens(60_000 - 1)));
  const windows = planWindows(session(events));
  assert.deepEqual(windows.map((w) => w.segments.map((seg) => seg.start)), [['I1', 'I2', 'I3'], ['I4']]);
  assert.ok(windows.every((w) => w.workBytes <= bytesOfTokens(200_000) && !w.oversize));
  assert.deepEqual(windows.map((w) => w.activeTask), ['I1', 'I4']);
});

test('M35 an oversized segment is cut at the boundaries between thoughts; its human message repeats at the top of each later piece', () => {
  const events = [ask('I1', 'Do the whole migration.'),
    said('C1', tokens(90_000)), run('A1', 'step one'), out('A1-r', 'A1', 'ok'),
    said('C2', tokens(90_000)), run('A2', 'step two'), out('A2-r', 'A2', 'ok'),
    said('C3', tokens(90_000)), ask('I2', 'next')];
  const windows = planWindows(session(events));
  assert.deepEqual(windows.map((w) => [w.piece, ids(w.events), w.repeats?.id ?? null]), [
    [{ at: 1, of: 2 }, ['I1', 'C1', 'A1', 'A1-r', 'C2', 'A2', 'A2-r'], null],
    [{ at: 2, of: 2 }, ['C3'], 'I1'],
    [null, ['I2'], null],
  ]);
  assert.ok(windows[1].events[0].kind === 'commentary', 'a later piece opens with a thought, never mid-thought');
  assert.deepEqual(windows.map((w) => w.activeTask), ['I1', 'I1', 'I2']);
  // A run between two thoughts that is itself over the budget is one piece, marked oversize.
  const big = planWindows(session([ask('I1', 'go'), said('C1', tokens(250_000))]));
  assert.equal(big.length, 1);
  assert.equal(big[0].oversize, true);
});

test('M35 a window\'s request never depends on what was recorded after it: a growing segment keeps its earlier pieces\' bytes', () => {
  // D60 reuses an answer by request bytes (F174/F175): the piece line names a piece's place, never how many pieces
  // there are, so a live session whose last segment grows never re-asks an earlier piece of it.
  const base = [ask('I1', 'Do the whole migration.'), said('C1', tokens(150_000)), run('A1', 'step one'),
    out('A1-r', 'A1', 'ok'), said('C2', tokens(150_000)), run('A2', 'step two'), out('A2-r', 'A2', 'ok')];
  const grown = [...base, said('C3', tokens(150_000)), run('A3', 'step three'), out('A3-r', 'A3', 'ok')];
  const plan = (events) => planWindowRequests({ session: session(events), reviewScope: 'session-only' });
  const before = plan(base), after = plan(grown);
  assert.deepEqual(before.windows.map((w) => w.piece), [{ at: 1, of: 2 }, { at: 2, of: 2 }]);
  assert.deepEqual(after.windows.map((w) => w.piece), [{ at: 1, of: 3 }, { at: 2, of: 3 }, { at: 3, of: 3 }]);
  for (const at of [0, 1]) {
    assert.equal(after.requests[at].request.prompt, before.requests[at].request.prompt, `piece ${at + 1}`);
    assert.equal(after.requests[at].request.evidencePrompt, before.requests[at].request.evidencePrompt, `piece ${at + 1}`);
  }
  assert.ok(before.requests[1].request.evidencePrompt.includes(pieceLine(2)));
  assert.doesNotMatch(pieceLine(2), /\bof \d/, 'no piece count');
});

test('M35 a window holds whole segments: an action is never shown apart from its result by a cut', () => {
  const events = [ask('I1', 'one'), run('A1', 'x'), said('C1', tokens(150_000)), out('A1-r', 'A1', 'late result'),
    ask('I2', 'two'), said('C2', tokens(150_000))];
  const windows = planWindows(session(events));
  assert.deepEqual(windows.map((w) => ids(w.events)), [['I1', 'A1', 'C1', 'A1-r'], ['I2', 'C2']]);
});

// ---- what a window shows -----------------------------------------------------------------------------------------------

test('M35 trim (M36 amendment T): an observation over 2k tokens keeps its first and last 1k tokens, a line longer than its side cut at a character, never inside one', () => {
  const text = `${'😀'.repeat(1000)}${'m'.repeat(10_000)}${'é'.repeat(2000)}`;
  const whole = (t) => ({ text: t, ranges: [{ from: 0, until: t.length }] });
  const cut = lineCut(whole(text), 3_600);
  const spans = [...cut.head, ...cut.tail];
  assert.equal(spans.length, 2, 'the head and the tail are separate sources');
  assert.ok(text.startsWith(spans[0]) && text.endsWith(spans[1]));
  assert.ok(Buffer.byteLength(spans[0]) <= 3_600 && Buffer.byteLength(spans[1]) <= 3_600);
  assert.equal(Buffer.byteLength(spans[0]), 3_600, '900 four-byte characters');
  assert.equal(cut.omittedBytes, Buffer.byteLength(text) - Buffer.byteLength(spans[0]) - Buffer.byteLength(spans[1]));
  assert.deepEqual(cut.omitted, { fromLine: 1, throughLine: 1, partFrom: true, partThrough: true }, 'one line, shown in part');
  assert.equal(lineCut(whole('short'), 3_600), null);
  // Two ranges (a redaction artifact between them): the head and tail never join them.
  const two = lineCut({ text: `${'a'.repeat(5_000)}‹dropped›${'b'.repeat(5_000)}`,
    ranges: [{ from: 0, until: 5_000 }, { from: 5_009, until: 10_009 }] }, 3_600);
  assert.deepEqual([...two.head, ...two.tail].map((span) => span.length), [3_600, 3_600]);
});

test('M35 trim by structure (M36 amendments P and H): a thought, a human message, a command and a file edit in full; a result trimmed; a prior state never inlined', () => {
  const long = tokens(5_000);
  const edit = { id: 'E1', kind: 'invocation', callKey: 'E1', tool: 'edit', operation: 'edit', paths: [{ path: 'src/a.js' }],
    command: [], input: [], changes: [{ path: 'src/a.js', after: ref(long), before: ref(long), extent: { priorState: 'edit-text' } }] };
  const write = { id: 'W1', kind: 'invocation', callKey: 'W1', tool: 'create', operation: 'write', paths: [{ path: 'src/b.js' }],
    command: [], input: [], changes: [{ path: 'src/b.js', after: ref(long), before: ref(long), extent: { priorState: 'first-write' } }] };
  const s = session([ask('I1', long), said('C1', long), run('A1', long), out('A1-r', 'A1', long), edit, write]);
  const omitted = (event) => shownFields(s, s.event(event)).map((f) => [f.role, f.field, f.omittedBytes > 0]);
  assert.deepEqual(omitted('I1'), [['instruction', 'text', false]]);
  assert.deepEqual(omitted('C1'), [['commentary', 'text', false]]);
  assert.deepEqual(omitted('A1'), [['action', 'command', false]], 'a command line is what the agent produced: whole');
  assert.deepEqual(omitted('A1-r'), [['observation', 'output', true]]);
  assert.deepEqual(omitted('E1'), [['action', 'command', false], ['code', 'after', false], ['code', 'before', false]]);
  assert.deepEqual(omitted('W1'), [['action', 'command', false], ['code', 'after', false]],
    'the file as the record found it is not inlined');
  assert.equal(shownBytes(s, s.event('A1-r')), 7_200);
  // The request says so between the shown head and tail, and its source map holds only the shown spans.
  const { requests } = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const [built] = requests;
  assert.ok(built.request.prompt.includes('omitted: line 1 of this output, 10,800 UTF-8 bytes, is not shown; line 1 in part'));
  assert.deepEqual(built.sourceMap['A1-r'].map((source) => Buffer.byteLength(source.text)), [3_600, 3_600]);
  assert.equal(built.sourceMap.C1[0].text, long);
  assert.equal(built.sourceMap.A1[0].text, long);
});

// ---- helpers are sessions of their own -----------------------------------------------------------------------------------

const helperSession = () => {
  const H = { childId: 'w' };
  return session([
    ask('I1', 'Fix the parser with a helper.'),
    said('C1', 'Delegating.'),
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Agent', operation: 'delegate', paths: [], command: [],
      input: ref('Fix the nested parser.'), changes: [] },
    { id: 'child:w:I1', kind: 'instruction', authority: 'agent', supersedes: [], text: ref('Fix the nested parser.'), ...H },
    said('child:w:C1', 'On it.', H), run('child:w:A1', 'npm test', H), out('child:w:A1-r', 'child:w:A1', 'pass', H),
    out('D1-r', 'D1', 'The helper fixed it.'),
    said('C2', 'Done.'),
    ask('I2', 'Thanks; now the docs.'),
    said('C3', 'Docs done.'),
  ], [{ assignmentEvent: 'D1', childId: 'w', childSession: `${KEY}/child:w`, sessionKey: `${KEY}/child:w`,
    relation: 'spawn', state: 'verified', historyStart: null }]);
};

test('M35 a helper is a session of its own, reviewed after the root window that launched it and linked back to its segment', () => {
  const s = helperSession();
  assert.deepEqual(reviewSessions(s).map((stream) => [stream.childId, stream.launchedBy, stream.events.length]),
    [[null, null, 7], ['w', 'D1', 4]]);
  // M36 phase 3 (D68 K): small, the helper shares the window of its parent's segment that launched it, as its own part.
  const windows = planWindows(s);
  assert.deepEqual(windows.map((w) => w.parts.map((part) => [part.session.childId, ids(part.events)])), [[
    [null, ['I1', 'C1', 'D1', 'D1-r', 'C2', 'I2', 'C3']],
    ['w', ['child:w:I1', 'child:w:C1', 'child:w:A1', 'child:w:A1-r']],
  ]]);
  const [, helper] = windows[0].parts;
  assert.deepEqual(helper.session, { helper: true, childId: 'w', launchedBy: 'D1',
    parentSegment: { childId: null, index: 0, start: 'I1' } });
  assert.equal(helper.activeTask, 'child:w:I1', 'the parent\'s brief is the helper\'s first human message');
  // A helper too large to share its parent's window is reviewed in a window of its own, right after it.
  const plain = helperSession().events.map(({ sequence, ...event }) => event);
  const big = session([...plain.slice(0, 2), said('CR', tokens(100_000)), ...plain.slice(2, 4),
    said('child:w:CB', tokens(150_000), { childId: 'w' }), ...plain.slice(4)], helperSession().children);
  const apart = planWindows(big);
  assert.deepEqual(apart.map((w) => w.parts.map((part) => part.session.childId)), [[null], ['w']]);
  const { requests } = planWindowRequests({ session: big, reviewScope: 'session-only' });
  assert.ok(requests[1].request.evidencePrompt.includes(helperSessionLine('w')));
  assert.ok(!requests[0].request.evidencePrompt.includes('This window reviews the own session of helper'));
});

// ---- the carried context -------------------------------------------------------------------------------------------------

test('M35 carried context: the active task, every earlier human message and thought on top — never an earlier action or result', () => {
  // Each of the first two segments is 50k tokens of thought and 60 results trimmed to 2k tokens each: 170k tokens.
  const results = (prefix) => Array.from({ length: 60 }, (_, k) => out(`${prefix}-r${k}`, 'A1', tokens(3_000)));
  const events = [ask('I1', 'first'), said('C1', tokens(50_000)), run('A1', 'a'), ...results('A1'),
    ask('I2', 'second'), said('C2', tokens(50_000)), ...results('A2'),
    ask('I3', 'queued', { markers: ['queued'] }), said('C3', tokens(50_000))];
  const s = session(events);
  const windows = planWindows(s);
  assert.deepEqual(windows.map((w) => w.segments.map((seg) => seg.start)), [['I1'], ['I2'], ['I3']]);
  const context = carriedContext(s, windows[2]);
  assert.deepEqual(ids(context.humans), ['I1', 'I2']);
  assert.deepEqual(ids(context.thoughts), ['C1', 'C2'], 'every earlier thought fits under the cap');
  assert.equal(context.thoughtsLeftOut, 0);
  assert.equal(context.activeTask, 'I2', 'a queued message continues the task it arrived during');
  assert.equal(context.activeTaskShown, 'carried');
  const { requests } = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const evidence = requests[2].request.evidencePrompt;
  assert.ok(evidence.includes(CARRIED_HUMANS_IN_INVENTORY));
  assert.ok(!Object.hasOwn(requests[2].sourceMap, 'A1') && !Object.hasOwn(requests[2].sourceMap, 'A1-r0'),
    'an earlier action and its result are never carried');
  assert.ok(Object.hasOwn(requests[2].sourceMap, 'C1'), 'a carried thought is a quotable source of the window');
});

test('M35 over the cap, the human messages are kept and the most recent thoughts fill the rest; the window says how many were left out', () => {
  const events = [ask('I1', 'first'), said('C1', tokens(150_000)), ask('I2', 'second'), said('C2', tokens(150_000)),
    ask('I3', 'third'), said('C3', tokens(60_000))];
  const s = session(events);
  const windows = planWindows(s);
  const context = carriedContext(s, windows.at(-1));
  assert.deepEqual(ids(context.humans), ['I1', 'I2']);
  assert.deepEqual(ids(context.thoughts), ['C2'], 'the most recent earlier thought');
  assert.equal(context.thoughtsLeftOut, 1);
  const { requests } = planWindowRequests({ session: s, reviewScope: 'session-only' });
  assert.ok(requests.at(-1).request.evidencePrompt.includes(carriedLeftOutLine(1)));
  // A combined review carries nothing.
  assert.equal(carriedContext(s, windows.at(-1), COMBINED_WINDOW_SETTINGS), null);
});

test('M35 a later piece of an oversized segment carries its earlier pieces\' thoughts and shows the repeated message, not carried', () => {
  const s = session([ask('I1', 'go'), said('C1', tokens(150_000)), said('C2', tokens(150_000))]);
  const windows = planWindows(s);
  assert.equal(windows.length, 2);
  const context = carriedContext(s, windows[1]);
  assert.deepEqual(ids(context.humans), [], 'the repeated message is shown in the window, never carried');
  assert.deepEqual(ids(context.thoughts), ['C1']);
  assert.equal(context.activeTaskShown, 'repeated');
  const { requests } = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const evidence = requests[1].request.evidencePrompt;
  assert.ok(evidence.includes(pieceLine(2, 2)));
  // D71 (S2, D18): no active-task line — the repeated message is marked where it is shown (` · repeated from part 1`), and
  // in "What the human asked" as the active task.
  assert.ok(evidence.includes(' · repeated from part 1'));
  assert.ok(/\[E\d+\] HUMAN INSTRUCTION [^\n]* · before this window · active task\n/.test(evidence));
  assert.ok(Object.hasOwn(requests[1].sourceMap, 'I1'), 'the repeated message is a source of the window');
});

// ---- aliases -------------------------------------------------------------------------------------------------------------

test('M35 aliases: a session-only request names events E1, E2, … in the order it first names them; answers map back', async () => {
  const s = helperSession();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const [root] = plan.requests;
  assert.ok(!root.request.prompt.includes('[I1]') && root.request.prompt.includes('[E1] HUMAN INSTRUCTION'));
  assert.equal(root.aliases.stable('E1'), 'I1');
  assert.equal(root.aliases.of('C1'), 'E2');
  assert.equal(root.aliases.of('not-named'), 'not-named', 'frozen: a later dossier names nothing new');
  // A combined review keeps stable ids.
  const combined = planWindowRequests({ session: s, reviewScope: 'combined' });
  assert.ok(combined.requests[0].request.prompt.includes('[I1] HUMAN INSTRUCTION'));
  assert.equal(combined.requests[0].aliases, null);
  // The same window is aliased the same way every time.
  const again = planWindowRequests({ session: s, reviewScope: 'session-only' });
  assert.equal(again.requests[0].request.prompt, root.request.prompt);
  // An answer citing aliases is read with stable ids: a requirement on the human's ask grounds.
  const asked = [];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: async (request) => {
      asked.push(request);
      if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
        explanation: 'Synthetic.', receipts: [{ eventId: item.candidate.instruction.eventId, role: 'instruction',
          quote: 'Fix the parser' }] })) };
      return request.window.index === 0 ? { decisions: [], pivots: [], claims: [], writtenClaims: [],
        // D71 (S2): a checklist status with the deliverable it needs (the report the parent received).
        requirements: [{ text: 'fix the parser', instruction: { eventId: 'E1', role: 'instruction', quote: 'Fix the parser' },
          status: 'done', deliverable: { eventId: 'D1-r', role: 'observation', quote: 'The helper fixed it.' } }] }
        : { decisions: [], pivots: [], claims: [], requirements: [] };
    } });
  assert.deepEqual(report.requirements.filter((r) => r.codeMade !== true).map((r) => [r.instruction.eventId, r.status]),
    [['I1', 'done']]);
  // D71 (S2): the window's other human message, which no row cites, gets code's own not-checked row.
  assert.deepEqual(report.requirements.filter((r) => r.codeMade === true).map((r) => [r.instruction.eventId, r.reason]),
    [['I2', 'ask_unreviewed']]);
  const challenge = asked.find((request) => request.challenge);
  assert.match(challenge.prompt, /"eventId":"E1"/, 'a challenger is shown the candidate in the window\'s aliases');
  assert.doesNotMatch(challenge.prompt, /"eventId":"I1"/);
  // The window's record links the helper back to its parent segment (M36 phase 3, D68 K: one window, its own part).
  assert.deepEqual(report.windowResults.map((w) => w.sessions.map((part) => part.session.childId)), [[null, 'w']]);
  assert.equal(report.windowResults[0].sessions[1].session.launchedBy, 'D1');
});

test('M35 mapEventIds maps every eventId and every entry of an id list, at any depth, and nothing else', () => {
  const value = { decisions: [{ actions: ['E1', 'E2', 7], stated: { eventId: 'E3', quote: 'E1 stays' } }], text: 'E1' };
  const map = (id) => ({ E1: 'a', E2: 'b', E3: 'c' })[id] ?? id;
  assert.deepEqual(mapEventIds(value, map), { decisions: [{ actions: ['a', 'b', 7], stated: { eventId: 'c', quote: 'E1 stays' } }],
    text: 'E1' });
  // M35 review R1: the closed list of id lists — a forbidden edit's candidate names the human instructions and choices
  // between its two events by id, and a challenger shown aliased evidence must be shown them aliased too.
  // D71 (S2): and the actions a requirement or a claim rests on (`restsOn`).
  assert.deepEqual([...EVENT_ID_LISTS], ['actions', 'humanInstructionsBetween', 'humanChoicesBetween', 'restsOn']);
  assert.deepEqual(mapEventIds({ candidate: { humanInstructionsBetween: ['E1'], humanChoicesBetween: ['E2'], other: ['E3'] } }, map),
    { candidate: { humanInstructionsBetween: ['a'], humanChoicesBetween: ['b'], other: ['E3'] } });
  const table = aliasTable();
  assert.deepEqual([table.of('x'), table.of('y'), table.of('x')], ['E1', 'E2', 'E1']);
  table.freeze();
  assert.equal(table.of('z'), 'z');
  assert.equal(table.stable('E2'), 'y');
  assert.equal(table.stable('E9'), 'E9');
});

// ---- the request bound ---------------------------------------------------------------------------------------------------

test('M35 a window whose request passes the bound is declared unreviewed_scope, never clipped', async () => {
  const s = session([ask('I1', tokens(460_000)), said('C1', 'ok')]);
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  assert.ok(Buffer.byteLength(plan.requests[0].request.prompt) > WINDOW_REQUEST_MAX_BYTES);
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: async () => { throw new Error('no call is made'); } });
  assert.deepEqual(report.windowFailures, [{ window: 1, reason: 'unreviewed_scope' }]);
});
