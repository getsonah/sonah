// M33 R, D68 (E), D90. Sonah cuts no recorded text a session review reads, and masks none: an ask is kept in full (M35),
// a file body — a written body, each side of an Edit, the file before an edit — is not bounded (D68 E), a write's
// arguments are kept whole (D69 review), and nothing is masked (D90, owner decision 2026-10-15, privacy is not a design
// constraint). M33 R had every cut made after redaction scrubbed the text whole, so a token straddling an old cut
// left no fragment; these tests now place a token where each old cut fell and find it whole, as recorded. Only an
// attached file keeps a declared bound, and a MultiEdit's joined diffs drop whole diffs past their budget.
//
// Synthetic recordings only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as redaction from '../../redact/index.js';
import { redact, ASK_OMISSION } from '../../redact/index.js';
import { compressAsk } from '../src/ask.js';
import * as before from '../src/before.js';
import { ARG_SEP } from '../src/events.js';
import { GHP, SK, TOKENS, offsets, prose, place, across, noise, userTurn, said, toolUse, toolResult, sliced, CUTS }
  from './m33-r-redact-cut-fixture.js';

const points = (text) => [...text].length;
/** The 20,000-unit body cap M33 R to D68 (E) applied, kept only to place tokens where it fell. */
const RETIRED_BODY_CAP = 20_000;
const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Every string value `value` holds, at any depth. */
const strings = (value) => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(strings)
  : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
const writes = (ledger) => ledger.ledger.filter((e) => ['edit', 'create'].includes(e.kind) && !e.via);

// ---- the budgets are Sonah's, and frozen ----------------------------------------------------------------------------

test('M33 R the bounds are redaction\'s own frozen literals: the budgets the slicer used to cut at', () => {
  // Windowing (M35): the human message is kept in full; the 20,000-code-point ask budget is gone.
  assert.equal(Object.hasOwn(redaction, 'ASK_CAP'), false);
  assert.equal(ASK_OMISSION, '[… instruction middle omitted before review …]');
  assert.doesNotMatch(ASK_OMISSION, /recorder/);
  // D68 (E): no body is bounded (redaction's BODY_CAP and the slicer's memory bound are deleted).
  for (const name of ['BODY_CAP', 'capBody', 'capEdit']) assert.equal(Object.hasOwn(redaction, name), false, name);
  for (const name of ['BEFORE_CAP', 'retainHead', 'retainEdit']) assert.equal(Object.hasOwn(before, name), false, name);
  // D69 (c): the first error line and the computed hunk header are deleted, and their bounds with them. D69 review: a
  // write's own arguments are kept whole — the excerpt bound (`EXCERPT_CAPS`, 2,000) is deleted too.
  assert.equal(Object.hasOwn(redaction, 'EXCERPT_CAPS'), false);
  assert.equal(Object.hasOwn(redaction, 'HUNK_HEADER_CHARS'), false);
});

// ---- a token where an old cut fell is whole ---------------------------------------------------------------------

for (const [cut, build] of Object.entries(CUTS)) {
  test(`M33 R, D90 ${cut}: a token where the old cut fell is kept whole, as recorded, at every offset`, async () => {
    for (const [name, token] of Object.entries(TOKENS)) {
      for (const offset of offsets(token, name === 'ghp' ? 1 : 3)) {
        const { clean } = await sliced(build(token, offset));
        // A token a line continuation splits stands in two physical lines: each part, whole.
        const k = Math.min(Math.max(offset, 0), token.length);
        const parts = cut.endsWith('Continued') ? [token.slice(0, k), token.slice(k)].filter(Boolean) : [token];
        for (const part of parts)
          assert.ok(JSON.stringify(clean).includes(part), `${cut}: ${name} ${offset} characters across the old cut`);
      }
    }
  });
}

// ---- the slicer keeps the text; nothing cuts or masks it --------------------------------------------------------------

test('M35, D90 an over-long ask: kept in full by the slicer and by redaction, as recorded, no cut declared', async () => {
  const text = across(GHP, 14_000, 20, 30_000);
  const { raw, clean } = await sliced([userTurn(text), said('Done.')]);
  assert.equal(raw.ask[0].text, text.trim(), 'every character the recording holds, uncut');
  assert.equal(Object.hasOwn(raw.ask[0], 'elided'), false, 'no cut is due');
  const [ask] = clean.ask;
  assert.equal(ask.text.includes(ASK_OMISSION), false, 'no marker: nothing was cut');
  assert.equal(ask.text, text.trim(), 'the whole text, as recorded');
  assert.equal(Object.hasOwn(ask, 'elided'), false);
  assert.equal(ask.redacted, undefined);
});

test('M33 R an ask the slicer did not declare over budget is never bounded', () => {
  const text = prose(45_000);
  const out = redact(led({ ask: [{ turn: 0, text }] })).ledger.ask[0];
  assert.equal(out.text, text, 'uncut');
  assert.equal(Object.hasOwn(out, 'elided'), false);
  // A declared ask (an earlier slicer's pending cut) is not cut, whatever its length, and its declaration is withdrawn.
  for (const length of [19_000, 45_000]) {
    const within = redact(led({ ask: [{ turn: 1, text: prose(length), elided: [{ what: 'middle of turn', chars: 9 }] }] })).ledger.ask[0];
    assert.equal(within.text, prose(length));
    assert.equal(Object.hasOwn(within, 'elided'), false);
  }
  // One an earlier Sonah already cut (its marker on a line of its own) keeps its text and its declaration.
  const cutText = `${prose(14_000)}\n${ASK_OMISSION}\n${prose(6_000)}`;
  const earlier = redact(led({ ask: [{ turn: 1, text: cutText, elided: [{ what: 'middle of turn', chars: 9 }] }] })).ledger.ask[0];
  assert.equal(earlier.text, cutText);
  assert.deepEqual(earlier.elided, [{ what: 'middle of turn', chars: 9 }]);
  // Other elisions (the slicer's whole-structure stubs) stay as they were.
  const kept = redact(led({ ask: [{ turn: 1, text: 'see [code block, 40 lines, 1300 chars] now',
    elided: [{ what: 'code block', chars: 1300 }, { what: 'middle of turn', chars: 9 }] }] })).ledger.ask[0];
  assert.deepEqual(kept.elided, [{ what: 'code block', chars: 1300 }]);
});

test('M35 names in a long ask stay in its own text: nothing is cut, so nothing is harvested', async () => {
  const text = `${prose(18_000)}\nplease also update lifecycle.go and keep ${GHP}.txt out\n${prose(11_000)}`;
  const { raw, clean } = await sliced([userTurn(text), said('Done.')]);
  assert.equal(raw.ask[0].mentions, undefined, 'the slicer harvests nothing it does not elide itself');
  const [ask] = clean.ask;
  assert.ok(ask.text.includes('lifecycle.go'), 'the name stands in the ask, which is kept in full');
  assert.equal(ask.mentions, undefined);
  assert.ok(ask.text.includes(`keep ${GHP}.txt out`), 'D90: the token too, as recorded');
  // M6: no strip removes a whole structure any more, so a pasted plan's names stand in
  // the ask's own text and none is harvested.
  const fence = `${'```'}\n${Array.from({ length: 40 }, (_, i) => `step ${i} touches src/parser_${i}.rs`).join('\n')}\n${'```'}`;
  const declared = compressAsk(`do it\n${fence}\nthanks`);
  assert.deepEqual(declared, { text: `do it\n${fence}\nthanks`, elided: [] });
  const kept = redact(led({ ask: [{ turn: 1, text: declared.text }] })).ledger.ask[0];
  assert.ok(kept.text.includes('src/parser_3.rs'));
  assert.equal(kept.mentions, undefined);
});

test('D68 (E), D90 a file body: the slicer keeps it whole; redaction cuts and masks nothing', async () => {
  const body = across(GHP, RETIRED_BODY_CAP, 20, 25_000);
  const { raw, clean } = await sliced(CUTS.writeAfter(GHP, 20));
  const [rawWrite] = writes(raw);
  assert.equal(rawWrite.after.text, body, 'the slicer cuts nothing');
  assert.equal(rawWrite.after.truncated, false);
  const [write] = writes(clean);
  assert.equal(write.after.truncated, false);
  assert.equal(write.after.text, body, 'the whole body, as recorded');
  assert.equal(write.after.lines, write.after.text.split('\n').length);
  // A long body keeps every byte.
  const plain = prose(45_000);
  const { clean: same } = await sliced([userTurn('write it'), toolUse('w1', 'Write', { file_path: '/repo/p.txt', content: plain }),
    toolResult('w1', 'File created successfully')]);
  const [kept] = writes(same);
  assert.equal(kept.after.text, plain);
  assert.equal(kept.after.truncated, false);
});

test('D68 (E) an Edit\'s sides are kept whole, every segment in its place', async () => {
  const { raw, clean } = await sliced(CUTS.editSegment(GHP, 30));
  const [rawEdit] = writes(raw);
  assert.equal(rawEdit.after.truncated, false);
  const [edit] = writes(clean);
  const segments = edit.after.text.split(ARG_SEP);
  assert.equal(segments.length, 4, 'two written segments, then two replaced ones');
  assert.equal(segments[0], prose(15_000), 'the first written segment is whole');
  assert.deepEqual(rawEdit.after.text.split(ARG_SEP)[1], segments[1], 'the second is whole too, as recorded');
  assert.deepEqual(segments.slice(2), ['a', 'b'], 'the replaced side is whole');
  assert.equal(edit.after.truncated, false);
});

test('D69 review, D90: a write\'s arguments are kept whole, as recorded; an earlier Sonah\'s bounded excerpt is read as it is', async () => {
  const { raw, clean } = await sliced(CUTS.writeArgs(GHP, 10));
  const [rawWrite] = writes(raw);
  assert.doesNotMatch(rawWrite.argsExcerpt, /…\[\+\d+\]$/, 'no window, no marker');
  assert.ok(rawWrite.argsExcerpt.includes(GHP), 'the token past the old 2,000-unit bound is in the text');
  const [write] = writes(clean);
  assert.equal(write.argsExcerpt, rawWrite.argsExcerpt, 'as recorded');
  assert.doesNotMatch(write.argsExcerpt, /…\[\+\d+\]$/);
  // Exactly the agent's own text, whole.
  const plain = prose(3_000);
  const { clean: same } = await sliced([userTurn('write it'), toolUse('w1', 'Write', { file_path: '/repo/p.txt', content: plain }),
    toolResult('w1', 'File created successfully')]);
  assert.equal(writes(same)[0].argsExcerpt, plain);
  // A persisted ledger an earlier Sonah windowed and bounded keeps its marker; a second pass changes nothing.
  const bounded = `${plain.slice(0, 2_000)}…[+${plain.length - 2_000}]`;
  const old = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'p.txt', argsExcerpt: bounded }] }));
  assert.equal(old.ledger.ledger[0].argsExcerpt, bounded);
  assert.equal(redact(old.ledger).ledger.ledger[0].argsExcerpt, bounded);
  // D69 (c): no first error line is picked from a failed output; the output is what it shows, as recorded.
  const { raw: rawFailed, clean: failed } = await sliced(CUTS.errorLine(SK, 30));
  assert.ok(rawFailed.ledger.every((e) => !Object.hasOwn(e, 'firstErrorLine')));
  assert.ok(JSON.stringify(failed).includes(SK));
  // Content text is never bounded as an excerpt: a generic tool's input stays whole.
  const workflow = `script: ${prose(5_000)}`;
  const generic = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'other', tool: 'Workflow', genericTool: true,
    inputRecorded: true, argsExcerpt: JSON.stringify({ script: workflow }) }] })).ledger.ledger[0];
  assert.equal(generic.argsExcerpt, JSON.stringify({ script: workflow }));
});

test('D69 (c): a definition line is never a computed hunk header; a token on it reaches no diff', async () => {
  const { raw, clean } = await sliced(CUTS.hunkHeader(GHP, 20));
  for (const ledger of [raw, clean]) assert.doesNotMatch(writes(ledger)[0].diff, /^@@/m, 'no computed hunk header');
  assert.ok(!writes(clean)[0].diff.includes(GHP), 'the definition line is in no diff');
  assert.ok(JSON.stringify(clean).includes(GHP), 'D90: it is in the edit\'s own text, as recorded');
  const { clean: short } = await sliced([userTurn('edit it'), toolUse('e1', 'Edit', { file_path: '/repo/c.js',
    old_string: 'function f() {\n1\n2\n3\n4\nold', new_string: 'function f() {\n1\n2\n3\n4\nnew' }),
    toolResult('e1', 'The file has been updated successfully.')]);
  assert.equal(writes(short)[0].diff, ' 4\n-old\n+new');
});

test('M33 R a MultiEdit\'s joined diffs drop whole diffs past the budget, never a line or a token', async () => {
  const { clean } = await sliced(CUTS.multiDiff(GHP, 20));
  const [edit] = writes(clean);
  assert.match(edit.diff, /\n\[… 1 more edit diff\(s\) elided …\]$/);
  assert.equal(edit.diff.includes('…[+'), false, 'no mid-line clip');
});

// ---- a bound is final ------------------------------------------------------------------------------------------------

test('M33 R every bound is final: redacting a ledger twice changes nothing', async () => {
  const records = [
    userTurn(across(GHP, 14_000, 10, 30_000)),
    toolUse('r1', 'Read', { file_path: '/repo/a.txt' }), toolResult('r1', across(SK, RETIRED_BODY_CAP, 40, 25_000)),
    ...CUTS.editSegment(GHP, 12).slice(1),
    toolUse('e2', 'Edit', { file_path: '/repo/a.txt', old_string: 'checked', new_string: 'looked' }),
    toolResult('e2', 'The file has been updated successfully.'),
    ...CUTS.writeArgs(SK, 50).slice(1),
    ...CUTS.errorLine(GHP, 20).slice(1),
    ...CUTS.hunkHeader(SK, 60).slice(1),
    ...JSON.parse(JSON.stringify(CUTS.multiDiff(GHP, 5).slice(1)).replaceAll('"m1"', '"m2"')),
    toolUse('w9', 'Write', { file_path: '/repo/emoji.txt', content: `${'😀'.repeat(9_999)}a😀 and ${'b'.repeat(5_000)}` }),
    toolResult('w9', 'File created successfully'),
    said('Done.'),
  ];
  const { clean } = await sliced(records);
  const again = redact({ ...structuredClone(clean), dropped: [] }).ledger;
  assert.deepEqual({ ...again, dropped: [] }, { ...clean, dropped: [] });
  for (const token of [GHP, SK]) assert.ok(JSON.stringify(clean).includes(token), 'D90: as recorded');
  // No surrogate is ever left alone by a cut.
  assert.deepEqual(strings(clean).filter((s) => LONE_SURROGATE.test(s)), []);
});

test('D68 (E), D90 a body past the retired cap is kept whole: every token and every line as written', () => {
  for (const shift of [0, 5, 12, 22, 30]) {
    const body = `${prose(RETIRED_BODY_CAP - 12 + shift)} ${GHP} end\n${prose(3_000)}`;
    const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'a.txt',
      after: { text: body, truncated: false, lines: body.split('\n').length } }] })).ledger.ledger[0].after;
    assert.equal(out.text, body, `shift ${shift}: the whole body, as recorded`);
    assert.equal(out.truncated, false);
  }
  // A line of high-entropy noise (an earlier redactor dropped it whole) is kept too.
  const noisy = `${prose(RETIRED_BODY_CAP - 40)}\n${noise(640)}\n${prose(3_000)}`;
  const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'b.txt',
    after: { text: noisy, truncated: false, lines: noisy.split('\n').length } }] })).ledger.ledger[0].after.text;
  assert.equal(out, noisy);
});

// ---- the recorder's own cuts are unchanged ------------------------------------------------------------------------

test('M33 R the recorder\'s own cuts are unchanged (a windowed Read); M6: the ask is kept whole, with no stub', async () => {
  const { clean } = await sliced([userTurn('fix it'), toolUse('r1', 'Read', { file_path: '/repo/a.txt', offset: 10, limit: 5 }),
    toolResult('r1', 'line ten\nline eleven', { toolUseResult: { type: 'text', file: { filePath: '/repo/a.txt',
      content: 'line ten\nline eleven', numLines: 2, startLine: 10, totalLines: 40 } } }),
    toolUse('e1', 'Edit', { file_path: '/repo/a.txt', old_string: 'ten', new_string: '10' }),
    toolResult('e1', 'The file has been updated successfully.')]);
  const [edit] = writes(clean);
  assert.deepEqual({ partial: edit.before.partial, window: edit.before.window, truncated: edit.before.truncated },
    { partial: true, window: { from: 10, to: 11, total: 40 }, truncated: false });
  // M6: the ask is kept whole — no whole-structure stub replaces what the human pasted.
  const body = Array.from({ length: 60 }, (_, i) => `  line ${i} of pasted output`).join('\n');
  const turn = `keep the API\n\n${'```'}\n${body}\n${'```'}\n\nadd rate limiting`;
  assert.deepEqual(compressAsk(turn), { text: turn, elided: [] });
  const ask = redact(led({ ask: [{ turn: 1, text: turn }] })).ledger.ask[0];
  assert.equal(ask.text, turn);
  assert.equal(Object.hasOwn(ask, 'elided'), false);
});

test('M33 R a Codex patch with no file keeps its whole body as the command: nothing is cut', async () => {
  const { patchInput } = await import('../src/codex.js');
  const body = `*** Begin Patch\n${'x'.repeat(300)} ${GHP}\n*** End Patch`;
  assert.deepEqual(patchInput(body), { command: body });
});
