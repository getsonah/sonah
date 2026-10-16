// The code step's context, assembled by code with zero calls (agentic since code-pass/7):
// git's hunks read by their formal grammar and checked row by row, widened as PR-Agent widens them, the change as
// Pullfrog's table of contents and `| OLD | NEW | TYPE | code` rows, the recorded edits when there is no git base, and
// the session dossier built from the saved report.
//
// Synthetic texts and sessions only: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { displayPath, parseHunks, linesOf, hunksMatch, extendHunks, addedHunk, recordedHunks, changedSpans, hunkRanges,
  renderChange, sectionBytes, codeDossier, renderDossier, dossierWords, commandsAfterLastEdit, HUNK_CONTEXT,
  rebuilds, diffLines, recordedNewRows, mapRecordedRows, underRoot } from '../src/code-context.js';
import * as codeContext from '../src/code-context.js';
import { codeSnapshotPlan, freezeCodeSnapshot } from '../src/code-pass.js';
import { CODE_DOSSIER_KINDS, CODE_DOSSIER_MOVES } from '../src/ledger.js';
import { readFile } from 'node:fs/promises';
import { buildCodeSession, CODE_TEXT } from '../../cli/test/code-pass-fixture.js';

const numbered = (n, at = 1) => Array.from({ length: n }, (_, i) => `line ${i + at}`);

test('code step: a hunk is read by git\'s own grammar; a body that does not add up is refused', () => {
  const patch = ['diff --git a/a.js b/a.js', 'index 1..2 100644', '--- a/a.js', '+++ b/a.js',
    '@@ -2,3 +2,3 @@ function outer() {', ' two', '-three', '+THREE', ' four', '\\ No newline at end of file', ''].join('\n');
  const { ok, hunks } = parseHunks(patch);
  assert.equal(ok, true);
  assert.deepEqual(hunks, [{ oldStart: 2, oldCount: 3, newStart: 2, newCount: 3, header: 'function outer() {', rows: [
    { type: ' ', text: 'two', old: 2, new: 2 }, { type: '-', text: 'three', old: 3, new: null },
    { type: '+', text: 'THREE', old: null, new: 3 }, { type: ' ', text: 'four', old: 4, new: 4 }] }]);
  // An added file: `-0,0`, every row new.
  assert.deepEqual(parseHunks('@@ -0,0 +1,2 @@\n+a\n+b\n').hunks[0].rows.map((r) => [r.old, r.new]), [[null, 1], [null, 2]]);
  // A count of one may be left out, as git writes it.
  assert.equal(parseHunks('@@ -1 +1 @@\n-a\n+b\n').ok, true);
  assert.equal(parseHunks('@@ -1,2 +1,2 @@\n a\n').ok, false, 'fewer rows than the header counts');
  assert.equal(parseHunks('@@ -1,1 +1,1 @@\n?a\n').ok, false, 'a row of no known type');
  assert.equal(parseHunks(null).ok, false);
});

test('code step: every row of a hunk must be its file\'s line at its number, before and after', () => {
  const base = ['a', 'b', 'c'], head = ['a', 'B', 'c'];
  const { hunks } = parseHunks('@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n');
  assert.equal(hunksMatch(hunks, base, head), true);
  assert.equal(hunksMatch(hunks, base, ['a', 'X', 'c']), false, 'the file now is not the one git diffed');
  assert.equal(hunksMatch(hunks, ['a', 'Y', 'c'], head), false, 'the base is not the one git diffed');
  assert.equal(hunksMatch(hunks, null, head), false, 'old rows need a base');
  assert.deepEqual(linesOf('a\nb\n'), ['a', 'b'], 'a final line end opens no line');
});

test('code step: hunks widen by PR-Agent\'s rule — five lines before, one after, or back to git\'s section header', () => {
  assert.deepEqual(HUNK_CONTEXT, { before: 5, after: 1, dynamicMax: 10 });
  const base = numbered(40);
  const head = [...base];
  head[19] = 'LINE 20';
  // git's own three lines of context, as `-U3` gives them.
  const plain = { oldStart: 17, oldCount: 7, newStart: 17, newCount: 7, header: '', rows: [
    ...[17, 18, 19].map((n) => ({ type: ' ', text: `line ${n}`, old: n, new: n })),
    { type: '-', text: 'line 20', old: 20, new: null }, { type: '+', text: 'LINE 20', old: null, new: 20 },
    ...[21, 22, 23].map((n) => ({ type: ' ', text: `line ${n}`, old: n, new: n }))] };
  const [wide] = extendHunks([plain], base, head);
  assert.deepEqual([wide.oldStart, wide.oldCount, wide.newStart, wide.newCount], [12, 13, 12, 13]);
  assert.deepEqual(wide.rows.slice(0, 5).map((r) => r.text), numbered(5, 12));
  assert.equal(wide.rows.at(-1).text, 'line 24');
  // A section header in the ten lines before: the hunk starts at it, when old and new agree from there on.
  const headed = { ...plain, header: 'line 9' };
  assert.equal(extendHunks([headed], base, head)[0].oldStart, 9);
  // A header further back than ten lines is not reached: five lines, as without one.
  assert.equal(extendHunks([{ ...plain, header: 'line 3' }], base, head)[0].oldStart, 12);
  // Lines before that differ old and new are never shown as unchanged.
  const moved = [...head];
  moved[13] = 'CHANGED 14';
  assert.equal(extendHunks([plain], base, moved)[0].oldStart, 15, 'only the lines that agree, from the hunk out');
  // A widening never reaches into the hunk before it.
  const first = { oldStart: 8, oldCount: 3, newStart: 8, newCount: 3, header: '', rows: [8, 9, 10].map((n) =>
    ({ type: ' ', text: `line ${n}`, old: n, new: n })) };
  const [, second] = extendHunks([first, plain], base, head);
  assert.equal(second.oldStart, 12);
  const [a, b] = extendHunks([{ ...first, oldStart: 13, newStart: 13, rows: [13, 14, 15].map((n) =>
    ({ type: ' ', text: `line ${n}`, old: n, new: n })) }, plain], base, head);
  assert.ok(a.oldStart + a.oldCount - 1 < b.oldStart, 'no line is shown twice');
});

test('code step: the change is Pullfrog\'s table of contents and | OLD | NEW | TYPE | code rows; notes never reorder it', () => {
  const { hunks } = parseHunks('@@ -1,2 +1,2 @@ top\n-a\n+A\n b\n');
  const entries = [
    { path: 'a.js', type: 'modified', hunks, shown: true, notes: ['S1 S3'] },
    { path: 'gen.js', type: 'modified', hunks, shown: true, notes: ['not written by a recorded edit'] },
    { path: 'logo.png', type: 'modified', hunks: [], shown: false, why: 'binary' },
    { path: 'new.js', type: 'added', hunks: [addedHunk(['x'])], shown: true },
  ];
  const text = renderChange(entries);
  const lines = text.split('\n');
  assert.equal(lines[0], '## Files (4)');
  assert.equal(lines[1], '- a.js → lines 8-15 · modified · S1 S3');
  assert.equal(lines[2], '- gen.js → lines 16-23 · modified · not written by a recorded edit');
  assert.equal(lines[3], '- logo.png · modified · binary: no hunk shown');
  assert.equal(lines[4], '- new.js → lines 24-29 · added');
  assert.deepEqual(lines.slice(5, 7), ['', '---']);
  // The ranges count the block's own lines from its `## Files` line.
  assert.deepEqual(lines.slice(7, 14), ['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1,2 +1,2 @@ top',
    '|    1 |      | - | a', '|      |    1 | + | A', '|    2 |    2 |   | b']);
  assert.deepEqual(lines.slice(23, 29), ['diff --git a/new.js b/new.js', '--- /dev/null', '+++ b/new.js', '@@ -0,0 +1,1 @@',
    '|      |    1 | + | x', '']);
  assert.equal(sectionBytes(entries[0]), Buffer.byteLength(lines.slice(7, 15).join('\n')) + 1);
});

test('code step: with no git base, the hunks are the recorded edits, placed in the file as it is now', () => {
  const head = 'one\ntwo\nTHREE\nfour\n';
  const hunks = recordedHunks([
    { before: ['three'], after: ['THREE'], whole: false },
    { before: ['gone'], after: ['not there now'], whole: false },
    { before: [], after: [head], whole: true }], head);
  assert.deepEqual(hunks[0].rows, [{ type: '-', text: 'three', old: null, new: null },
    { type: '+', text: 'THREE', old: null, new: 3 }]);
  assert.equal(hunks[0].newStart, 3);
  assert.equal(hunks[1].newStart, null, 'a later edit replaced it: no line of the file now');
  assert.ok(hunks[1].rows.every((r) => r.new === null));
  assert.deepEqual([hunks[2].whole, hunks[2].newStart, hunks[2].newCount, hunks[2].rows], [true, 1, 4, []]);
  assert.deepEqual(changedSpans(hunks), { new: [[1, 4]], old: [] });
  assert.match(renderChange([{ path: 'x.js', type: 'modified', hunks, shown: true }]),
    /@@ recorded edit 3: wrote the whole file, lines 1-4 \(read the file for its text\) @@/);
});

test('code step: the lines a change touched, by side, are what scope is checked against', () => {
  const { ok, hunks } = parseHunks('@@ -1,4 +1,2 @@\n a\n-b\n-c\n d\n@@ -9,2 +7,3 @@\n i\n+I2\n j\n');
  assert.equal(ok, true);
  // A removal only marks the new lines it sits between; an addition its own.
  assert.deepEqual(changedSpans(hunks), { new: [[1, 2], [8, 8]], old: [[2, 3]] });
  // What a request shows as one text, by side: a run of one side's rows; a row of the other side between splits it (the
  // review of the code step: new lines 1 and 2 sit either side of two removed rows, so no quote joins them).
  assert.deepEqual(hunkRanges(hunks), { new: [[1, 1], [2, 2], [7, 9]], old: [[1, 4], [9, 9], [10, 10]] });
});

test('code step: a path the session named absolutely, relatively, or git named is one file under the root', () => {
  assert.equal(displayPath('/work/repo/src/a.js', '/work/repo'), 'src/a.js');
  assert.equal(displayPath('src/a.js', '/work/repo'), 'src/a.js');
  assert.equal(displayPath('/work/other/a.js', '/work/repo'), '/work/other/a.js', 'outside the root: as recorded');
  assert.equal(displayPath('/work/repo', '/work/repo'), '/work/repo');
  assert.equal(displayPath('/work/repo/a.js', null), '/work/repo/a.js');
});

test('agentic code step: no placement of whole files and no checking-pass order are left: the agent reads the files itself', () => {
  for (const gone of ['placeGroups', 'passOrder', 'namedUnderRoot', 'UNNAMED_ROW_WORDS'])
    assert.equal(codeContext[gone], undefined, gone);
});

const R = (eventId, role, quote) => ({ eventId, role, quote });

test('code step: the dossier is built by code from the saved report — keyed, quoted, by actor, with its move', () => {
  const T1 = { turn: 'T1' };
  const blobs = { ...CODE_TEXT, test: 'npm test', ok: 'ok 1', more: 'export const b = 1;\n' };
  const session = buildCodeSession('s-dossier', blobs, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'X1', kind: 'invocation', operation: 'command', tool: 'Bash', paths: [], changes: [], input: [],
      command: [{ sourceKey: 'test', fromByte: 0, untilByte: 8 }], callKey: 'X1', ...T1 },
    { id: 'X1-r', kind: 'observation', invocation: 'X1', blob: 'ok', ...T1 },
    { id: 'W2', kind: 'invocation', write: 'src/b.js', blob: 'more', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
  ]);
  const report = {
    requirements: [{ text: 'Return [] for empty input.', instruction: R('I1', 'instruction', CODE_TEXT.ask), status: 'partly-done',
      shortfall: R('C1', 'commentary', 'parse now returns an empty list for empty input.') },
    { text: 'Done.', instruction: R('I1', 'instruction', 'SYNTHETIC_CODE_ASK'), status: 'done' }],
    promises: [{ id: 'p1', stated: R('C1', 'commentary', 'parse now returns an empty list'), status: 'open' },
      { id: 'p2', stated: R('C1', 'commentary', 'empty list for empty input'), status: 'verified' }],
    decisions: [{ id: 'd1', dimension: 'How to split', chosen: 'Commas', column: 'unasked', actions: ['W1'] },
      { id: 'd2', dimension: 'Which file', chosen: 'parse.js', column: 'asked-settled', actions: ['W1'] },
      { id: 'd3', dimension: 'Tests', chosen: 'none', column: 'unasked', notActing: true, stated: R('C1', 'commentary',
        'parse now returns') }],
    pivots: [{ abandoned: 'regex', adopted: 'split', receipts: [R('C1', 'commentary', 'parse now returns an empty')] }],
    failures: [{ eventId: 'X1-r', handling: 'passed-over', outcome: 'ran-failed' }],
    findings: [{ id: 'f1', kind: 'edit_under_negative_requirement', status: 'DECIDE', breach: 'wrote',
      receipts: [R('I1', 'instruction',
      'do not touch the README'), R('W1', 'action', 'src/parse.js')] }],
  };
  const items = codeDossier({ report, session });
  assert.deepEqual(items.map((i) => [i.key, i.kind, i.actor, i.move]), [
    ['S1', 'ask', 'person', 'ask_short'], ['S2', 'ask', 'person', 'ask_done'],
    ['S3', 'claim', 'agent', 'claim_unconfirmed'], ['S4', 'claim', 'agent', 'claim_confirmed'],
    ['S5', 'decision', 'agent', 'design_point'], ['S6', 'decision', 'agent', null], ['S7', 'decision', 'agent', 'not_acting'],
    ['S8', 'pivot', 'agent', 'design_point'], ['S9', 'failure', 'recorded', 'failure_passed_over'],
    ['S10', 'edit_against_instruction', 'person', 'edit_against_instruction']]);
  assert.ok(items.every((i) => CODE_DOSSIER_KINDS.includes(i.kind) && (i.move === null || CODE_DOSSIER_MOVES.includes(i.move))));
  assert.ok(items.every((i) => !Object.hasOwn(i, 'codeCheck')), 'step 1 is gone: no code check rides with a row');
  assert.deepEqual(items[4].paths, ['src/parse.js']);
  // A quote of another actor's words than the item's is shown with its actor (the review of the code step): the failure
  // is a recorded result, the command the agent ran is the agent's; the ask's shortfall is in the agent's words.
  assert.deepEqual(items[8].shown.ran, { actor: 'agent', quote: 'npm test' });
  assert.equal(items[8].shown.output, 'ok 1');
  assert.deepEqual(items[0].shown.missing, { actor: 'agent', quote: 'parse now returns an empty list for empty input.' });
  assert.equal(items[0].shown.asked, CODE_TEXT.ask);
  assert.deepEqual(items[9].shown.did, { actor: 'agent', quote: 'src/parse.js' });
  // Every quote it shows is a session text, by event, role and actor, so a quote of it can be grounded — and only the
  // person's and the recorded results' ever are by a trace step or shown to a checker.
  assert.ok(items[0].sources.some((s) => s.eventId === 'I1' && s.role === 'instruction' && s.actor === 'person'));
  assert.deepEqual(items[0].sources.map((s) => s.actor), ['person', 'agent']);
  assert.deepEqual(items[8].sources.map((s) => [s.role, s.actor]), [['action', 'agent'], ['observation', 'recorded']]);
  // Commands after each changed file's last edit: parse.js was followed by `npm test` (exit 0); b.js by none.
  const commands = commandsAfterLastEdit(session, ['src/parse.js', 'src/b.js', 'never.js']);
  assert.deepEqual(commands, [{ path: 'src/parse.js', after: [{ ran: 'npm test', exit: 0 }] },
    { path: 'src/b.js', after: [] }, { path: 'never.js', after: null }]);
  const text = renderDossier(items, commands);
  // D90: every path is named; nothing of an item or of the commands is left out.
  assert.deepEqual(renderDossier(items, commands, { named: () => false }), text);
  assert.match(text,
    /^\{"key":"S1","kind":"ask","actor":"person","move":"ask_short","item":"ask_partly_done","status":"partly-done"/m);
  // code-pass/10 (D96): an item the code review may triage names its report item kind, by its row's closed tokens
  // (triage.js `itemKindOf`), never a tier; a done ask and a confirmed claim name none. (These decisions carry no derived
  // column, so each reads as one where Sonah could not check whether you asked.)
  assert.deepEqual(items.map((i) => i.itemKind), ['ask_partly_done', null, 'claim_not_checked', null,
    'decision_whether_asked', 'decision_whether_asked', 'decision_not_acting', 'pivot', 'failure_passed_over',
    'edit_against_instruction']);
  assert.doesNotMatch(text, /"tier"|must_act|must_know|good_to_know/);
  assert.match(text, /^\{"key":"S2","kind":"ask","actor":"person","move":"ask_done","status":"done"/m);
  assert.match(text, /^\{"path":"src\/b\.js","commandsAfterLastEdit":"none","move":"never_ran"\}$/m);
  assert.match(text, /^\{"path":"src\/parse\.js","commandsAfterLastEdit":\[\{"ran":"npm test","exit":0\}\]\}$/m);
  assert.equal(renderDossier(codeDossier({ report, session }), commands), text, 'the same report, the same bytes');
  // The words each line shows, as values (what a question's quote may be copied from): the item's own word fields, every
  // { actor, quote }'s quote and a list's members too; a flag, a null and Sonah's closed labels (a status, a column, an
  // outcome) are no words. A decision with no
  // stated quote shows only the review's words, which no session text holds.
  assert.deepEqual(items[4].sources, []);
  assert.deepEqual(dossierWords(items[4]), ['How to split', 'Commas']);
  assert.deepEqual(dossierWords(items[6]), ['Tests', 'none', 'parse now returns']);
  assert.deepEqual(dossierWords(items[7]), ['regex', 'split', 'parse now returns an empty']);
  assert.deepEqual(dossierWords(items[8]), ['npm test', 'ok 1']);
  assert.deepEqual(dossierWords(items[0]), [CODE_TEXT.ask, 'parse now returns an empty list for empty input.']);
  const lines = text.split('\n');
  for (const item of items) {
    const line = lines.find((l) => l.startsWith(`{"key":"${item.key}",`));
    for (const words of dossierWords(item)) assert.ok(line.includes(JSON.stringify(words)), `${item.key} shows ${words}`);
  }
  assert.deepEqual(dossierWords(null), []);
});

test('code step: every adaptation carries its upstream notice, and the notices file lists each source and licence', async () => {
  const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const PULLFROG = 'Portions adapted from Pullfrog (pullfrog/pullfrog), MIT, Copyright (c) 2026 Pullfrog, Inc.';
  const PR_AGENT = 'Portions adapted from PR-Agent (qodo-ai/pr-agent), MIT, Copyright (c) 2026 The PR Agent';
  for (const file of ['../src/code-context.js', '../src/code-pass.js']) {
    const text = (await source(file)).replace(/\n\/\/ /g, ' ');
    assert.ok(text.includes(PULLFROG), `${file}: Pullfrog`);
    assert.ok(text.includes(PR_AGENT), `${file}: PR-Agent`);
  }
  const notices = await source('../../../THIRD_PARTY_NOTICES.md');
  for (const heading of ['## pullfrog/pullfrog (MIT)', '## qodo-ai/pr-agent (MIT)', '## ReviewBench (MIT)'])
    assert.ok(notices.includes(heading), heading);
  for (const line of ['Copyright (c) 2026 Pullfrog, Inc.', 'Copyright (c) 2026 The PR Agent', 'Copyright (c) 2026 review-bench',
    '`packages/evidence/src/code-context.js`', '`packages/evidence/src/code-pass.js`', '330f0813b5fe0d1f54b794077c2d02aa85a1fb63'])
    assert.ok(notices.includes(line), line);
  // The review agent's method (code-pass/7) is listed among the parts adapted from Pullfrog's Review mode.
  const flat = notices.replace(/\s+/g, ' ');
  for (const part of ['its review agent since `sonah.code-pass/7`', 'the review agent\'s method, from the Review mode',
    'triage (the domain, the seams, the external contracts and the surfaces a change touches)',
    'reading the callers and tests of what changed', 'the hunt for concerns with no line to anchor',
    'stale references and docs checked against the code', 'who breaks on upgrade',
    'tracing every finding yourself before writing it']) assert.ok(flat.includes(part), part);
});

// ---- the review of the code step (2026-10-14) -----------------------------------------------------------------------

test('review of the code step: git\'s "Binary files … differ" is read by its grammar; hunks must rebuild the file now', () => {
  const binary = parseHunks('diff --git a/x.sql b/x.sql\nnew file mode 100644\nindex 0000000..1\nBinary files /dev/null and b/x.sql differ\n');
  assert.deepEqual([binary.ok, binary.hunks, binary.binary], [true, [], true]);
  assert.equal(parseHunks('GIT binary patch\n').binary, true);
  assert.equal(parseHunks('@@ -1 +1 @@\n-a\n+b\n').binary, false);
  // Rebuilding: every line outside the hunks kept, removed lines dropped, added lines put in.
  const base = ['a', 'b', 'c', 'd'];
  const { hunks } = parseHunks('@@ -2,2 +2,2 @@\n b\n-c\n+C\n');
  assert.equal(rebuilds(hunks, base, ['a', 'b', 'C', 'd']), true);
  assert.equal(rebuilds(hunks, base, ['a', 'b', 'C', 'D']), false, 'a change no hunk shows');
  assert.equal(rebuilds([], base, base), true, 'no hunk, no change: a mode change');
  assert.equal(rebuilds([], null, ['x']), false, 'no hunk, yet a line was added');
  assert.equal(rebuilds(parseHunks('@@ -0,0 +1,2 @@\n+x\n+y\n').hunks, null, ['x', 'y']), true);
  assert.deepEqual([diffLines(''), diffLines('a\n'), diffLines('a')], [[], ['a'], ['a']]);
});

test('review of the code step: a recorded edit is placed where the recording\'s own hunks put it, never at the first match', () => {
  // Line 2 and line 6 both read `const x = 1;`: the edit changed line 6 (its recorder numbered it so, with its context).
  const head = 'a\nconst x = 1;\nb\nc\nd\nconst x = 1;\ne\n';
  const edit = { before: ['const x = 0;'], after: ['const x = 1;'], whole: false };
  const row = (line, text, added = false) => ({ line, text, added });
  const recorded = [row(3, 'b'), row(4, 'c'), row(5, 'd'), row(6, 'const x = 1;', true), row(7, 'e')];
  const [placed] = recordedHunks([{ ...edit, placed: recorded }], head);
  assert.deepEqual([placed.newStart, placed.rows.find((r) => r.type === '+').new], [6, 6]);
  assert.deepEqual(changedSpans([placed]), { new: [[6, 6]], old: [] });
  // With no recorded place and two candidates, it is not located: never line 2.
  const [unplaced] = recordedHunks([{ ...edit, placed: null }], head);
  assert.deepEqual([unplaced.newStart, unplaced.newCount], [null, 0]);
  assert.deepEqual(changedSpans([unplaced]), { new: [], old: [] });
  // One candidate is placed with no recorded place; recorded numbers the file no longer holds place nothing.
  assert.equal(recordedHunks([{ ...edit, after: ['b'], before: ['B'] }], head)[0].newStart, 3);
  assert.equal(recordedHunks([{ ...edit, placed: [row(4, 'const x = 1;', true)] }], head)[0].newStart, null);
  // The second review of the code step: with two candidates, an added row alone does not tell them apart — no context
  // row says which: not located.
  assert.equal(recordedHunks([{ ...edit, placed: [row(6, 'const x = 1;', true)] }], head)[0].newStart, null);
  // The recorder's hunks give the rows a call numbered (context and added), and carry them through a later call by its
  // own hunks.
  const call = (hunks, paths = ['a.js']) => ({ kind: 'invocation', changes: paths.map((path) => ({ path })),
    recorded: { hunks } });
  const first = call([{ oldStart: 5, oldLines: 3, newStart: 5, newLines: 3, lines: [' c', ' d', '-const x = 0;', '+const x = 1;'] }]);
  assert.deepEqual(recordedNewRows(first), [row(5, 'c'), row(6, 'd'), row(7, 'const x = 1;', true)]);
  assert.equal(recordedNewRows(call(first.recorded.hunks, ['a.js', 'b.js'])), null, 'two files: no place by structure');
  assert.equal(recordedNewRows({ kind: 'invocation', changes: [{ path: 'a.js' }] }), null);
  // A later call inserted two lines at the top: every row moves by two; one that removed the added row loses the place;
  // one that changed a context row drops that row alone.
  const rows = recordedNewRows(first);
  const insert = call([{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+x', '+y'] }]);
  assert.deepEqual(mapRecordedRows(rows, insert).map((r) => r.line), [7, 8, 9]);
  const remove = call([{ oldStart: 6, oldLines: 3, newStart: 6, newLines: 2, lines: [' d', '-const x = 1;', ' e'] }]);
  assert.equal(mapRecordedRows(rows, remove), null);
  const recontext = call([{ oldStart: 5, oldLines: 1, newStart: 5, newLines: 1, lines: ['-c', '+C'] }]);
  assert.deepEqual(mapRecordedRows(rows, recontext), [row(6, 'd'), row(7, 'const x = 1;', true)]);
  const below = call([{ oldStart: 20, oldLines: 1, newStart: 20, newLines: 2, lines: [' z', '+zz'] }]);
  assert.deepEqual(mapRecordedRows(rows, below), rows);
  assert.equal(mapRecordedRows(rows, { kind: 'invocation', changes: [{ path: 'a.js' }] }), null, 'no hunk: not known');
});

test('second review of the code step (low, the probe): recorded numbers gone stale after an unrecorded change place nothing', () => {
  // The edit set line 6 to `  return [];` (its recorder numbered it so, with three lines of context each side it had);
  // line 4 already read the same. Later, two lines were put at the top by a change no recording holds (a formatter run
  // through a shell): the edit's line is now line 8, and line 6 is the untouched duplicate.
  const T1 = { turn: 'T1' };
  const lines = ['export function parse(input) {', '  if (input === undefined) {', '    log("none");', '  return [];',
    '  }', '  return [];', '}'];
  const after = `${lines.join('\n')}\n`;
  const blobs = { old: '  return null;', neu: '  return [];', ok: 'ok' };
  const span = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key]) }];
  const session = buildCodeSession('s-stale', blobs, [
    { id: 'E1', kind: 'invocation', tool: 'Edit', operation: 'edit', paths: [{ path: 'a.js' }], command: [], input: [],
      callKey: 'E1', changes: [{ path: 'a.js', before: span('old'), after: span('neu'), diff: [] }],
      recorded: { hunks: [{ oldStart: 3, oldLines: 5, newStart: 3, newLines: 5,
        lines: [` ${lines[2]}`, ` ${lines[3]}`, ` ${lines[4]}`, '-  return null;', `+${lines[5]}`, ` ${lines[6]}`] }] }, ...T1 },
    { id: 'E1-r', kind: 'observation', invocation: 'E1', blob: 'ok', ...T1 }]);
  const plan = codeSnapshotPlan(session);
  const frozen = (text) => freezeCodeSnapshot(plan, [{ path: 'a.js', bytes: new TextEncoder().encode(text) }],
    { base: { kind: 'recorded_edits' } })[0];
  // As the session left it, the recorder's numbers hold: line 6, never the duplicate on line 4.
  const kept = frozen(after);
  assert.deepEqual([kept.hunks[0].newStart, changedSpans(kept.hunks).new], [6, [[6, 6]]]);
  // After the unrecorded change, line 6 still reads `  return [];`, but the recorder's context no longer holds there: the
  // edit is not placed (never the untouched line 6), its rows carry no new-side number, and the file is shown whole.
  const shifted = frozen(`// header 1\n// header 2\n${after}`);
  assert.equal(shifted.diff, 'base_unknown');
  assert.equal(shifted.state, 'readable');
  assert.deepEqual([shifted.hunks[0].newStart, shifted.hunks[0].newCount], [null, 0]);
  assert.ok(shifted.hunks[0].rows.every((r) => r.new === null));
  assert.deepEqual(changedSpans(shifted.hunks), { new: [], old: [] });
});

test('review of the code step: the snapshot plan carries each edit\'s recorded place; the frozen hunk sits there', () => {
  const T1 = { turn: 'T1' };
  const before = 'a\nconst x = 1;\nb\nc\nd\nconst x = 0;\ne\n';
  const after = before.replace('const x = 0;', 'const x = 1;');
  const blobs = { whole: before, old: 'const x = 0;', neu: 'const x = 1;', ok: 'ok' };
  const span = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key]) }];
  const session = buildCodeSession('s-placed', blobs, [
    { id: 'E1', kind: 'invocation', tool: 'Edit', operation: 'edit', paths: [{ path: 'a.js' }], command: [], input: [],
      callKey: 'E1', changes: [{ path: 'a.js', before: span('old'), after: span('neu'), diff: [] }],
      recorded: { hunks: [{ oldStart: 3, oldLines: 5, newStart: 3, newLines: 5,
        lines: [' b', ' c', ' d', '-const x = 0;', '+const x = 1;', ' e'] }] }, ...T1 },
    { id: 'E1-r', kind: 'observation', invocation: 'E1', blob: 'ok', ...T1 }]);
  const plan = codeSnapshotPlan(session);
  const addedOf = (edits) => edits.map((e) => (e.placed === null ? null : e.placed.filter((r) => r.added).map((r) => r.line)));
  assert.deepEqual(addedOf(plan[0].edits), [[6]]);
  assert.deepEqual(plan[0].edits[0].placed.map((r) => r.line), [3, 4, 5, 6, 7]);
  const [file] = freezeCodeSnapshot(plan, [{ path: 'a.js', bytes: new TextEncoder().encode(after) }],
    { base: { kind: 'recorded_edits' } });
  assert.deepEqual([file.diff, file.hunks[0].newStart, changedSpans(file.hunks).new], ['base_unknown', 6, [[6, 6]]]);
  // A later edit put two lines at the top, by its own recorded hunk: the first edit's line is now line 8; one with no
  // recorded hunk loses it, and the first edit is then placed only if its text is unique (here it is not).
  const more = { ...blobs, top: 'x\ny\na', a: 'a' };
  const spanOf = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(more[key]) }];
  const later = (hunks) => buildCodeSession('s-placed-2', more, [
    { id: 'E1', kind: 'invocation', tool: 'Edit', operation: 'edit', paths: [{ path: 'a.js' }], command: [], input: [],
      callKey: 'E1', changes: [{ path: 'a.js', before: spanOf('old'), after: spanOf('neu'), diff: [] }],
      recorded: { hunks: [{ oldStart: 3, oldLines: 5, newStart: 3, newLines: 5,
        lines: [' b', ' c', ' d', '-const x = 0;', '+const x = 1;', ' e'] }] }, ...T1 },
    { id: 'E1-r', kind: 'observation', invocation: 'E1', blob: 'ok', ...T1 },
    { id: 'E2', kind: 'invocation', tool: 'Edit', operation: 'edit', paths: [{ path: 'a.js' }], command: [], input: [],
      callKey: 'E2', changes: [{ path: 'a.js', before: spanOf('a'), after: spanOf('top'), diff: [] }],
      ...(hunks ? { recorded: { hunks } } : {}), ...T1 },
    { id: 'E2-r', kind: 'observation', invocation: 'E2', blob: 'ok', ...T1 }]);
  const shifted = codeSnapshotPlan(later([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: ['+x', '+y', ' a'] }]));
  assert.deepEqual(addedOf(shifted[0].edits), [[8], [1, 2]]);
  const [moved] = freezeCodeSnapshot(shifted, [{ path: 'a.js', bytes: new TextEncoder().encode(`x\ny\n${after}`) }],
    { base: { kind: 'recorded_edits' } });
  assert.equal(moved.hunks[0].newStart, 8);
  assert.deepEqual(codeSnapshotPlan(later(null))[0].edits.map((e) => e.placed), [null, null]);
});

test('review of the code step: the diff is the change under the working directory; the paths differing elsewhere are counted', () => {
  for (const path of ['src/a.js', '.env', 'a/b/c.js', '.claude/settings.json']) assert.equal(underRoot(path), true, path);
  for (const path of ['/abs/a.js', '../up.js', 'a/../../b.js', '~/x', '$HOME/x', 'C:\\x.js', '', null])
    assert.equal(underRoot(path), false, String(path));
  const { hunks } = parseHunks('@@ -1 +1 @@\n-a\n+A\n');
  const text = renderChange([{ path: 'a.js', type: 'modified', hunks, shown: true }], { outside: 1 });
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 3), ['## Files (1)', '- a.js → lines 6-12 · modified',
    '- and 1 more path differs from the start commit outside the working directory: not part of the change reviewed']);
  assert.equal(lines[5], 'diff --git a/a.js b/a.js', 'the ranges count the count line too');
});
