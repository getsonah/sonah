// M36 phase 2, the window format (owner decisions 2026-10-07, D68 P, L, T, H, critique c1, c3, c4, c8; C-07
// "M36 window format", C-05 "M36 hunk runs" and "M36 grounding per shown span"). What the agent PRODUCED is shown whole
// (a command line, a tool input; over a window's whole work budget alone, its head and tail); what it CONSUMED (a result)
// opens with a label line built only from the recorder's typed fields and is cut by one positional rule on whole lines,
// its omitted lines named; an edit is its recorded hunks, each same-side run a quotable source of its own, else its own
// written and replaced text; the file as the record found it is never inlined; a quote grounds only inside one span the
// window showed.
//
// Synthetic sessions and judges only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, hunkRunsOf, shownSession, verifyReceipt, repairReceipt } from '../src/session.js';
import { COMBINED_WINDOW_SETTINGS, bytesOfTokens, eventView, shownFields, shownSources, shownBytes,
  planWindows, lineCut, lineCount, observationFacts, SHOWN_GAPS, WINDOWING_VERSION, skimSideBytesOf }
  from '../src/windows.js';
import * as windowsModule from '../src/windows.js';
import { planWindowRequests, runReview } from '../src/run-review.js';
import { resultLabelLine } from '../src/prompt.js';
import { codeSourceTexts } from '../src/ledger.js';

const blobs = {};
let counter = 0;
/** A text ref to a fresh blob holding `text`. */
const ref = (text) => {
  const key = `m36f${++counter}`;
  blobs[key] = text;
  return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
};
/** `text` in a fresh blob, as two refs around `mark`: how the adapter places an earlier redactor's declared mark (D90). */
const refAround = (text, mark) => {
  const key = `m36f${++counter}`;
  blobs[key] = text;
  const at = text.indexOf(mark);
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  return [{ sourceKey: key, fromByte: 0, untilByte: bytes(text.slice(0, at)) },
    { sourceKey: key, fromByte: bytes(text.slice(0, at + mark.length)), untilByte: bytes(text) }];
};
const ask = (id, text) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text) });
const said = (id, text) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref(text) });
const run = (id, command, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'bash', operation: 'command',
  paths: [], command: ref(command), input: [], changes: [], ...over });
const out = (id, invocation, text, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, sourceOfResult: 'native',
  output: ref(text), ...over });
const session = (events) => new Session({ sessionKey: 'm36-format', adapter: 'claude', blobs: { ...blobs },
  events: events.map((event, sequence) => ({ ...event, sequence })) });
const lines = (n, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1} of the synthetic output`).join('\n');
// D103: these sessions are Claude Code recordings (`adapter: 'claude'`), whose results a window shows up to 12,000 bytes
// at each end; a result is cut only past twice that.
const SIDE = skimSideBytesOf('claude');
const EMPTY = Object.freeze({ decisions: [], pivots: [], claims: [], requirements: [] });

// ---- the profile ---------------------------------------------------------------------------------------------------------

test('M36 format: one next windowing version, and the closed reasons a window declares', () => {
  // M36 phase 3 moved it once more (`sonah.windows/5`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.windows/6`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // D71 (S2) moved it once more (sonah.windows/8): the reviewer brief as the checklist (D71_BRIEF_VERSIONS).
  // D103 moved it once more (sonah.windows/9): the skim keyed by the recording's harness, in bytes a side.
  assert.equal(WINDOWING_VERSION, 'sonah.windows/9');
  // D103 (F5 part 2): and a cited result a challenge request could not show whole within its bound.
  assert.deepEqual({ ...SHOWN_GAPS }, { actionOverBudget: 'action_over_budget', editOverBudget: 'edit_over_budget',
    reportOverBudget: 'report_over_budget', resultOverBound: 'result_over_bound' });
  assert.ok(Object.isFrozen(SHOWN_GAPS));
  // D69 (e): the net view's declines are reverted with it.
  assert.equal(windowsModule.NET_VIEW_DECLINED, undefined);
  assert.equal(windowsModule.changedTwice, undefined);
});

// ---- (T) the positional cut, on whole lines ------------------------------------------------------------------------------

test('M36 T: a result over twice its skim keeps its first and last whole lines within the skim each; its omitted lines are named', () => {
  const text = `${lines(1_000)}\n`;
  const s = session([run('A1', 'cat big.txt'), out('A1-r', 'A1', text)]);
  const view = eventView(s, s.event('A1-r'));
  const [output] = view.fields;
  const head = output.spans.slice(0, output.headCount), tail = output.spans.slice(output.headCount);
  assert.equal(head.length, 1);
  assert.equal(tail.length, 1);
  assert.ok(head[0].endsWith('\n') && text.startsWith(head[0]), 'the head ends after a whole line');
  assert.ok(text.endsWith(tail[0]) && text[text.length - tail[0].length - 1] === '\n', 'the tail starts on a whole line');
  assert.ok(Buffer.byteLength(head[0]) <= SIDE && Buffer.byteLength(tail[0]) <= SIDE);
  const shownLines = lineCount(head[0]);
  assert.deepEqual(output.omitted, { fromLine: shownLines + 1, throughLine: 1_000 - lineCount(tail[0]), partFrom: false,
    partThrough: false });
  assert.equal(output.omittedBytes, Buffer.byteLength(text) - Buffer.byteLength(head[0]) - Buffer.byteLength(tail[0]));
  assert.equal(view.lines, 1_000);
  assert.equal(shownBytes(s, s.event('A1-r')), Buffer.byteLength(head[0]) + Buffer.byteLength(tail[0]));
  // The request says so between the head and the tail, outside every fence, and its source map holds only those spans.
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  const prompt = built.request.prompt;
  const note = `  omitted: lines ${output.omitted.fromLine}–${output.omitted.throughLine} of this output`;
  assert.ok(prompt.includes(note));
  assert.ok(prompt.indexOf(head[0]) < prompt.indexOf(note) && prompt.indexOf(note) < prompt.indexOf(tail[0]));
  // D71 (S2): a session-only request offers the lines under its brief's last step (S3: step 6).
  assert.match(prompt, /; ask for them under step 6 if a row's status depends on them \(\[E\d+\] lines \d+–\d+\)\. Quote the shown spans only, never across the cut\./);
  assert.deepEqual(built.sourceMap['A1-r'].map((source) => source.text), [head[0], tail[0]]);
  // A result within twice the skim is shown whole.
  const small = session([run('A2', 'ls'), out('A2-r', 'A2', lines(3))]);
  assert.equal(eventView(small, small.event('A2-r')).fields[0].omitted, null);
});

test('M36 T: a line longer than its side is cut at a character boundary, never inside a character, and said in part', () => {
  const side = 3_600;
  const text = `${'é'.repeat(5_000)}\nshort\n${'😀'.repeat(3_000)}`;
  const cut = lineCut({ text, ranges: [{ from: 0, until: text.length }] }, side);
  assert.equal(Buffer.byteLength(cut.head[0]), side, '1,800 two-byte characters');
  assert.ok(Buffer.byteLength(cut.tail[0]) <= side && text.endsWith(cut.tail[0]));
  assert.deepEqual(cut.omitted, { fromLine: 1, throughLine: 3, partFrom: true, partThrough: true });
  // Spans stay separate sources: an artifact between two ranges is never joined across.
  const masked = `${lines(200, 'a')}\n‹dropped›\n${lines(200, 'b')}`;
  const at = masked.indexOf('‹dropped›');
  const regions = { text: masked, ranges: [{ from: 0, until: at }, { from: at + '‹dropped›'.length, until: masked.length }] };
  const both = lineCut(regions, side);
  assert.ok(![...both.head, ...both.tail].some((span) => span.includes('‹dropped›')));
});

test('M36 T: a numbered read names the file lines it omitted only when its output is the recorder\'s numLines lines, nothing dropped', () => {
  const numbered = Array.from({ length: 900 }, (_, i) => `${String(i + 101).padStart(6)}\tsynthetic source line ${i + 101};`)
    .join('\n');
  const read = (id, text, numLines) => [{ id, kind: 'invocation', callKey: id, tool: 'read', operation: 'other',
    paths: [{ path: 'src/big.js' }], command: [], input: ref('{"file_path":"src/big.js"}'), changes: [],
    recorded: { tool: 'Read', read: { startLine: 101, numLines, totalLines: 1_200 } } }, out(`${id}-r`, id, text)];
  const masked = numbered.replace('synthetic source line 150;', '‹redacted:aws-key›');
  const [r3, r3out] = read('R3', masked, 900);
  const s = session([...read('R1', numbered, 900), ...read('R2', numbered, 899),
    r3, { ...r3out, output: refAround(masked, '‹redacted:aws-key›') }]);
  const v1 = eventView(s, s.event('R1-r'));
  const { fromLine, throughLine } = v1.fields[0].omitted;
  assert.deepEqual(v1.fileLines, { from: 100 + fromLine, through: 100 + throughLine });
  assert.equal(eventView(s, s.event('R2-r')).fileLines, null, 'a count the recorder did not type: output lines only');
  assert.equal(eventView(s, s.event('R3-r')).fileLines, null, 'a redaction artifact: output lines only (c2)');
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  assert.ok(built.request.prompt.includes(`of this output (file lines ${100 + fromLine}–${100 + throughLine}),`));
});

// ---- (L) the label line ----------------------------------------------------------------------------------------------------

test('M36 L: a result\'s label line is built only from the recorder\'s typed fields and the output\'s size, never its words', () => {
  const grep = { id: 'G1', kind: 'invocation', callKey: 'G1', tool: 'read', operation: 'other', paths: [{ path: 'src' }],
    command: [], input: ref('{"pattern":"retry"}'), changes: [],
    recorded: { tool: 'Grep', search: { mode: 'content', numFiles: 3, numLines: 12, numMatches: 14, truncated: true } } };
  const bash = run('B1', 'npm test', { recorded: { tool: 'Bash', isError: true, interrupted: true,
    backgroundTaskId: 'bg-synthetic-1', noOutputExpected: false } });
  const fetch = { id: 'F1', kind: 'invocation', callKey: 'F1', tool: 'WebFetch', operation: 'other', paths: [], command: [],
    input: ref('{"url":"https://example.invalid"}'), changes: [],
    recorded: { tool: 'WebFetch', fetch: { url: 'https://example.invalid', code: 404, bytes: 1234 } } };
  const codex = run('X1', 'cat a.txt', { recorded: { tool: 'CommandExecution', commandClass: 'read' } });
  const s = session([grep, out('G1-r', 'G1', 'src/a.js:1: retry\nerror: interrupted\n'), bash,
    out('B1-r', 'B1', 'all tests passed', { result: 'failed', exitCode: 1 }), fetch, out('F1-r', 'F1', 'Not found'),
    codex, out('X1-r', 'X1', 'hello')]);
  const label = (id) => resultLabelLine(eventView(s, s.event(id)));
  assert.equal(label('G1-r'), '  recorded: tool Grep · on src · search (content): 3 file(s), 12 line(s), 14 match(es), '
    + 'truncated by the tool · output 2 line(s), 37 bytes');
  assert.equal(label('B1-r'), '  recorded: tool Bash · error flag set · interrupted · run in the background · '
    + 'output 1 line(s), 16 bytes', 'the words "all tests passed" decide nothing');
  assert.equal(label('F1-r'), '  recorded: tool WebFetch · HTTP 404 · 1,234 bytes fetched · output 1 line(s), 9 bytes');
  assert.equal(label('X1-r'), '  recorded: tool CommandExecution · recorded as a read · output 1 line(s), 5 bytes');
  // The facts are the recorder's fields: no field, no fact.
  assert.deepEqual(observationFacts(s, out('O9', 'nowhere', 'x')), { tool: null, paths: [], read: null, errorFlag: false,
    interrupted: false, background: false, noOutputExpected: false, commandClass: null, search: null, fetch: null,
    webResults: null, outputWithheld: false });
  // Never quotable: the label is no source of the result.
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  assert.ok(built.request.prompt.includes(label('G1-r')));
  assert.ok(!built.sourceMap['G1-r'].some((source) => source.text.includes('tool Grep')));
});

// ---- (P) what the agent produced, whole ------------------------------------------------------------------------------------

test('M36 P: a command and a tool input are whole; one larger than a window\'s work budget alone is cut to it, declared', () => {
  const budget = bytesOfTokens(COMBINED_WINDOW_SETTINGS.workTokens);
  const long = lines(2_000);
  const huge = `${lines(9_000)}\n`;
  assert.ok(Buffer.byteLength(long) > 2 * SIDE && Buffer.byteLength(long) < budget);
  assert.ok(Buffer.byteLength(huge) > budget);
  const s = session([run('A1', long), run('A2', huge),
    { id: 'T1', kind: 'invocation', callKey: 'T1', tool: 'mcp', operation: 'other', paths: [], command: [], input: ref(long),
      changes: [] }]);
  assert.deepEqual(shownFields(s, s.event('A1'), COMBINED_WINDOW_SETTINGS).map((f) => [f.field, f.omittedBytes]),
    [['command', 0]]);
  assert.deepEqual(shownFields(s, s.event('T1'), COMBINED_WINDOW_SETTINGS).map((f) => [f.field, f.omittedBytes]),
    [['command', 0], ['input', 0]]);
  const cut = eventView(s, s.event('A2'), COMBINED_WINDOW_SETTINGS).command;
  assert.equal(cut.gap, 'action_over_budget');
  assert.ok(cut.omittedBytes > 0 && cut.spans.reduce((n, span) => n + Buffer.byteLength(span), 0) <= budget);
  assert.ok(cut.spans[0].endsWith('\n'), 'on whole lines');
  // A code-only chunk (no settings) shows everything whole.
  assert.equal(eventView(s, s.event('A2'), null).command.omittedBytes, 0);
});

// ---- (H) edits ---------------------------------------------------------------------------------------------------------------

const HUNKS = Object.freeze([
  { oldStart: 10, oldLines: 4, newStart: 10, newLines: 5, lines: [' context a', ' context b', '-old line', '+new line',
    '+‹dropped›', ' context c'] },
  { oldStart: 40, oldLines: 1, newStart: 41, newLines: 1, lines: ['-last old', '+last new', '\\ No newline at end of file'] },
]);
const edit = (id, over = {}, recorded = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'edit', operation: 'edit',
  paths: [{ path: 'src/a.js' }], command: [], input: [], changes: [{ path: 'src/a.js', after: ref('new line'),
    before: ref(lines(60, 'orig')), extent: { recorded: true, priorState: 'first-write', chars: 8, lines: 1, redactedLines: 0 },
    beforeExtent: { recorded: true }, replaced: ref('old line'), replacedExtent: { recorded: true } }], ...over,
  recorded: { tool: 'Edit', prior: 'file', patch: 'hunks', hunkScrub: 'change', hunks: HUNKS, ...recorded } });

test('M36 H, c3: recorded hunks are shown as same-side runs, each its own quotable source, labelled outside its fence', () => {
  const s = session([ask('I1', 'Change the line.'), edit('E1')]);
  const runs = hunkRunsOf(s.event('E1'));
  assert.deepEqual(runs.map((r) => [r.hunk, r.side, r.old, r.new, r.noNewlineAtEnd]), [
    [0, 'context', [10, 11], [10, 11], false], [0, 'removed', [12, 12], null, false], [0, 'added', null, [12, 13], false],
    [0, 'context', [13, 13], [14, 14], false], [1, 'removed', [40, 40], null, false], [1, 'added', null, [41, 41], true]]);
  assert.deepEqual(runs[2].spans, ['new line\n'], 'a masked line keeps its place and is never quotable');
  // The window shows the runs and no body of the call: the runs hold the change.
  const view = eventView(s, s.event('E1'));
  assert.equal(view.edit.mode, 'hunks');
  assert.deepEqual(shownSources(s, s.event('E1')).filter((x) => x.role === 'code').map((x) => x.text),
    ['context a\ncontext b', 'old line', 'new line\n', 'context c', 'last old', 'last new']);
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  const prompt = built.request.prompt;
  for (const label of ['  hunks recorded for src/a.js (role=code; "lines" are lines of the file as recorded before [E2], '
    + '"new" lines of the file [E2] left, as the recorder numbered them; scrubbed as one change, without the whole file):',
  '  hunk 1 of 2 (-10,4 +10,5):', '    context, lines 10–11 (new lines 10–11):', '    removed, line 12:',
  '    added, new lines 12–13:', '    removed, line 40:', '    added, new line 41, no line break at the end of the file:'])
    assert.ok(prompt.includes(label), label);
  // c1: the file as the record found it is not inlined — said to exist, framed by the event it was recorded before.
  assert.ok(prompt.includes('  src/a.js as recorded before [E2] (60 line(s), '));
  assert.ok(!prompt.includes('orig 30 of the synthetic output'));
  // Every run is a code source of the call, quotable on its own and never across its seam.
  assert.ok(verifyReceipt(s, { eventId: 'E1', role: 'code', quote: 'context a\ncontext b' }).ok);
  assert.ok(!verifyReceipt(s, { eventId: 'E1', role: 'code', quote: 'context b\nold line' }).ok, 'never across two runs');
  // A count of the call's recorded code reads its bodies, not the runs that show the same change twice.
  assert.deepEqual(codeSourceTexts(s, 'E1'), ['new line', lines(60, 'orig'), 'old line']);
});

test('M36 H: a created file once, whole; an edit with no recorded hunks as its own written and replaced text, whole', () => {
  const created = { id: 'W1', kind: 'invocation', callKey: 'W1', tool: 'create', operation: 'write',
    paths: [{ path: 'src/new.js' }], command: [], input: [], changes: [{ path: 'src/new.js', after: ref(lines(500, 'body')),
      before: [], extent: { recorded: true, priorState: 'none' } }],
    recorded: { tool: 'Write', writeType: 'create', prior: 'absent', patch: 'body',
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+should never show as hunks'] }] } };
  const helperEdit = { id: 'E2', kind: 'invocation', callKey: 'E2', tool: 'edit', operation: 'edit',
    paths: [{ path: 'src/b.js' }], command: [], input: [], changes: [{ path: 'src/b.js', after: ref('const b = 2;'),
      before: ref('const b = 1;'), extent: { recorded: true, priorState: 'edit-text' } }] };
  const s = session([ask('I1', 'Add two files.'), created, helperEdit]);
  const write = eventView(s, s.event('W1'));
  assert.equal(write.edit.mode, 'bodies');
  assert.deepEqual(write.edit.blocks.map((b) => [b.kind, b.spans.join('')]), [['written', lines(500, 'body')]],
    'whole, over the trim, and once');
  const body = eventView(s, s.event('E2'));
  assert.deepEqual(body.edit.blocks.map((b) => [b.kind, b.spans.join('')]),
    [['written', 'const b = 2;'], ['replaced', 'const b = 1;']]);
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  assert.ok(built.request.prompt.includes('  text it replaced in src/b.js (role=code):'));
  assert.ok(!built.request.prompt.includes('should never show as hunks'));
});

test('M36 H: the recorder\'s unrecorded-change fact is said at the edit; an edit over the work budget alone is cut, declared', () => {
  const big = HUNKS.map((h) => ({ ...h }));
  big[0] = { ...big[0], lines: [...big[0].lines.slice(0, 3), ...Array.from({ length: 40_000 }, (_, i) => `+added ${i}`),
    ...big[0].lines.slice(3)] };
  const s = session([ask('I1', 'Change it.'), edit('E0'), run('B1', 'sed -i s/a/b/ src/a.js'),
    edit('E1', {}, { unrecordedChange: { since: 'E0', commands: ['B1'] } }), edit('E3', {}, { hunks: big })]);
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  assert.ok(built.request.prompt.includes('  src/a.js changed after [E2] and before this call by something not recorded as '
    + 'an edit in this recording (commands between them that list it: [E3]).'));
  const combined = eventView(s, s.event('E3'), COMBINED_WINDOW_SETTINGS).edit;
  assert.equal(combined.gap.reason, 'edit_over_budget');
  const shown = combined.blocks.reduce((n, b) => n + b.spans.reduce((m, x) => m + Buffer.byteLength(x), 0), 0);
  assert.ok(shown <= bytesOfTokens(COMBINED_WINDOW_SETTINGS.workTokens) && combined.gap.omittedBytes > 0);
  assert.equal(shownBytes(s, s.event('E3'), COMBINED_WINDOW_SETTINGS), shown + Buffer.byteLength('src/a.js'),
    'the planned size is what is rendered: the runs shown and the path');
  assert.deepEqual([combined.blocks[0].part, combined.blocks.at(-1).part], [null, null], 'whole runs at both ends');
  assert.equal(eventView(s, s.event('E3')).edit.gap, null, 'within a session window\'s budget: whole');
});

test('D69 (e): a file changed twice or more is not declared; each change is shown at its own call, no end state', () => {
  const write = (id, path, prior) => ({ id, kind: 'invocation', callKey: id, tool: 'create', operation: 'write',
    paths: [{ path }], command: [], input: [], changes: [{ path, after: ref('body'), before: [],
      extent: { recorded: true, priorState: 'none' } }], recorded: { tool: 'Write', prior } });
  const s = session([ask('I1', 'Edit.'), edit('E1'), edit('E2', {}, { prior: 'hunks' }), write('W1', 'src/b.js', 'absent'),
    write('W2', 'src/b.js', 'file')]);
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  assert.ok(!built.request.prompt.includes('## Files changed more than once in this window'));
  assert.ok(!built.request.prompt.includes('no net view'));
  for (const id of ['E1', 'E2', 'W1', 'W2']) assert.ok(Array.isArray(built.sourceMap[id]), `${id} is shown at its own call`);
});

// ---- planning sizes are what is rendered ----------------------------------------------------------------------------------

test('M36 a window\'s planned work is exactly the bytes of the sources it renders', () => {
  const s = session([ask('I1', 'Do it.'), said('C1', 'On it.'), run('A1', lines(3_000)), out('A1-r', 'A1', lines(900)),
    edit('E1'), out('E1-r', 'E1', 'updated')]);
  const [window] = planWindows(s);
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  const rendered = window.events.reduce((n, e) => n + built.sourceMap[e.id]
    .reduce((m, source) => m + Buffer.byteLength(source.text), 0), 0);
  assert.equal(window.workBytes, rendered);
  for (const e of window.events)
    for (const source of built.sourceMap[e.id]) assert.ok(built.request.prompt.includes(source.text), e.id);
});

// ---- (c4) grounding per shown span --------------------------------------------------------------------------------------

test('M36 c4: a quote grounds only inside one span the window showed — never in a result\'s omitted middle', async () => {
  const text = lines(1_000);
  const s = session([ask('I1', 'Find the line.'), run('A1', 'cat big.txt'), out('A1-r', 'A1', text), said('C1', 'Done.')]);
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const { sourceMap } = plan.requests[0];
  const view = shownSession(s, sourceMap);
  const middle = 'line 500 of the synthetic output', head = 'line 2 of the synthetic output';
  assert.ok(verifyReceipt(s, { eventId: 'A1-r', role: 'observation', quote: middle }).ok, 'premise: recorded');
  assert.equal(verifyReceipt(view, { eventId: 'A1-r', role: 'observation', quote: middle }).ok, false);
  assert.equal(repairReceipt(view, { eventId: 'A1-r', role: 'observation', quote: middle }).ok, false);
  assert.ok(verifyReceipt(view, { eventId: 'A1-r', role: 'observation', quote: head }).ok);
  // The source map is the one thing a served span (phase 3) extends: an entry appended to the event grounds as shown.
  const served = { ...sourceMap, 'A1-r': [...sourceMap['A1-r'], { role: 'observation', text: middle, served: true }] };
  assert.ok(verifyReceipt(shownSession(s, served), { eventId: 'A1-r', role: 'observation', quote: middle }).ok);
  // End to end: a pivot quoting the omitted middle is withheld; one quoting the shown head is published.
  const pivot = (quote) => ({ abandoned: 'reading the file', adopted: 'grep', whyAbandoned: 'too long',
    receipts: [{ eventId: 'E3', role: 'observation', quote }] });
  const review = (quote) => runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: async (request) => (request.challenge ? { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [{ eventId: 'E1', role: 'instruction',
        quote: 'Find the line.' }] })) } : { ...EMPTY, writtenClaims: [], pivots: [pivot(quote)] }) });
  const hidden = await review(middle);
  assert.equal(hidden.pivots.length, 0);
  assert.equal(hidden.windowResults[0].grounding.withheld, 1);
  const seen = await review(head);
  assert.equal(seen.pivots.length, 1);
  assert.deepEqual(seen.pivots[0].receipts.map((r) => r.eventId), ['A1-r']);
});

test('M36 c4: an edit shown as hunk runs still reads as what it wrote — a forbidden edit and a written statement, quoted from a run', async () => {
  const { readForbiddenEdit } = await import('../src/forbidden.js');
  const { writtenChatClaim, shownWrittenBodies } = await import('../src/written.js');
  const s = session([ask('I1', 'Do not add a new line to src/a.js.'), edit('E1'), out('E1-r', 'E1', 'updated')]);
  const { sourceMap } = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests[0];
  assert.ok(!sourceMap.E1.some((source) => source.text === 'new line'), 'premise: the body itself is not shown');
  const item = { text: 'Added the line.', instruction: { eventId: 'I1', role: 'instruction', quote: 'Do not add a new line' },
    violation: { eventId: 'E1', role: 'code', quote: 'new line' } };
  const read = readForbiddenEdit(item, { session: shownSession(s, sourceMap), sourceMap });
  assert.equal(read.edit?.breach, 'wrote', 'the quote is in what the call wrote, and in the run the window showed');
  // A quote of the run the call did not write (a context line) is not what it wrote.
  assert.deepEqual(readForbiddenEdit({ ...item, violation: { eventId: 'E1', role: 'code', quote: 'context a' } },
    { session: shownSession(s, sourceMap), sourceMap }), { withheld: 'violation_not_written' });
  const claim = { text: 'x', stated: { eventId: 'E1', role: 'code', quote: 'new line' } };
  assert.equal(writtenChatClaim(claim, s, sourceMap), true);
  assert.deepEqual(shownWrittenBodies(s, sourceMap, claim.stated), ['new line\n']);
});
