// M33 R repair, M6, M35, D90. A write's diff is rendered from the change as recorded and only then cut (one line of
// context around each change, a Write's first 30 lines, the 900/400 head and tail budget), and a human's ask is kept
// whole: nothing of a turn is stripped by its shape, and only an attached file keeps a declared bound. D90 (owner decision
// 2026-10-15, privacy is not a design constraint): nothing in either is masked — a pasted secret block, a token in a
// long ask, are kept where they stand. (M33 R repair had the diff rendered from the change as redaction scrubbed it
// whole; the tests of that scrub are deleted with the detectors.)
//
// Synthetic recordings only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, sliceHash, ATTACHED_CAP, ASK_OMISSION } from '../../redact/index.js';
import { compressAsk } from '../src/ask.js';
import { editDiff, createDiff, minimalDiff, budgetDiff } from '../src/diff.js';
import { GHP, prose, userTurn, said, toolUse, toolResult, sliced } from './m33-r-redact-cut-fixture.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const updated = (id) => toolResult(id, 'The file has been updated successfully.');
const writes = (ledger) => ledger.ledger.filter((e) => ['edit', 'create'].includes(e.kind) && !e.via);

// Low-entropy, prose-like secret lines: only the key above them says they are secret.
const WORDS = ['correct-horse-battery-staple-lantern', 'quiet-meadow-orchard-violet-ember', 'paper-tiger-river-stone-hollow',
  'amber-falcon-granite-willow-copper', 'silent-harbor-maple-thistle-quartz', 'ochre-pigeon-velvet-anchor-ripple',
  'tangerine-otter-basalt-lumen-fjord', 'cobalt-heron-saffron-gravel-mist'];
const SECRET_LINES = [...WORDS, ...WORDS.map((w) => `${w}-two`)];
const filler = (n, name) => Array.from({ length: n }, (_, i) => `${name}_${String(i).padStart(2, '0')}: value-${i}`);

// A PEM block: its BEGIN line, eight 64-character base64 lines, a short last line and its END line (all invented; the
// header lines are assembled at run time).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64Line = (i, n = 64) => Array.from({ length: n }, (_, k) => B64[(i * 31 + k * 7 + ((k * k) % 13)) % 64]).join('');
const PEM_BODY = [...Array.from({ length: 8 }, (_, i) => b64Line(i)), `${b64Line(9, 22)}==`];
const PEM = [['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '), ...PEM_BODY, ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')];

// ---- the diff: exactly the bytes the rendering of the recorded texts always gave -------------------------------------------

/** The diffs as the slicer renders them from the raw text (its exported raw helpers). D69 (c): with no computed hunk
 *  header and no names a file "defines" (the keyword list is deleted). */
const rawEditDiff = (oldText, newText) => budgetDiff(minimalDiff(oldText, newText));
const rawCreateDiff = (content) => {
  const lines = String(content).split('\n');
  const head = lines.slice(0, 30).map((l) => `+${l}`);
  const parts = [...head];
  if (lines.length > head.length) parts.push(`[… ${lines.length - head.length} more lines …]`);
  return budgetDiff(parts.join('\n'));
};

test('M33 R repair, D90: a change renders exactly the bytes its recorded texts always did, a secret-shaped one too', () => {
  const code = Array.from({ length: 120 }, (_, i) => (i % 17 === 0 ? `export function handler_${i}(req) {` : `  const item_${i} = compute(${i}, "label ${i}");`));
  const cases = [
    ['function f() {\n1\n2\n3\n4\nold', 'function f() {\n1\n2\n3\n4\nnew'],
    [code.join('\n'), code.map((l, i) => (i % 9 === 0 ? `${l} // touched` : l)).join('\n')],
    [code.slice(0, 40).join('\n'), [...code.slice(0, 20), 'inserted line', ...code.slice(20, 40)].join('\n')],
    ['', 'new file body\nsecond line'],
    ['same\ntext', 'same\ntext'],
    [Array.from({ length: 600 }, (_, i) => `old ${i}`).join('\n'), Array.from({ length: 600 }, (_, i) => `new ${i}`).join('\n')],
    [`  export class Store {\n${'  x\n'.repeat(5)}}`, `  export class Store {\n${'  y\n'.repeat(5)}}`],
    // D90: a secret block's lines are code like any other.
    ['placeholder: 1', [...filler(40, 'setting'), 'signing_key: |', ...SECRET_LINES.map((l) => `  ${l}`)].join('\n')],
    [PEM.join('\n'), PEM.map((line, i) => (i === 9 ? `${b64Line(3, 22)}==` : line)).join('\n')],
  ];
  for (const [a, b] of cases) assert.equal(editDiff(a, b), rawEditDiff(a, b), JSON.stringify([a.slice(0, 40), b.slice(0, 40)]));
  for (const content of [code.join('\n'), code.slice(0, 10).join('\n'), 'one line', prose(5_000), `${'x'.repeat(3_000)}\nshort`,
    [...filler(20, 'const'), ...PEM].join('\n')])
    assert.equal(createDiff(content), rawCreateDiff(content));
});

test('M33 R repair, D90: a session\'s diffs are byte-identical through slicing and redaction', async () => {
  const code = Array.from({ length: 80 }, (_, i) => `  const row_${i} = load(${i}); // keeps the parser stable`).join('\n');
  const records = [userTurn('refactor the loader'),
    toolUse('w1', 'Write', { file_path: '/repo/a.js', content: code }), toolResult('w1', 'File created successfully'),
    toolUse('e1', 'Edit', { file_path: '/repo/a.js', old_string: code, new_string: code.replace('load(40)', 'load(41)') }), updated('e1'),
    toolUse('m1', 'MultiEdit', { file_path: '/repo/a.js', edits: [{ old_string: 'row_1 ', new_string: 'row_one ' },
      { old_string: 'row_2 ', new_string: 'row_two ' }] }), updated('m1'), said('Done.')];
  const { raw, clean } = await sliced(records);
  for (const [r, c] of writes(raw).map((e, i) => [e, writes(clean)[i]])) {
    assert.equal(c.diff, r.diff, 'redaction left the diff as the slicer rendered it');
    assert.equal(Object.hasOwn(r, 'diffRedaction'), false, 'nothing is declared');
  }
  const [write, edit, multi] = writes(clean);
  assert.equal(write.diff, rawCreateDiff(code));
  assert.equal(edit.diff, rawEditDiff(code, code.replace('load(40)', 'load(41)')));
  assert.equal(multi.diff, [rawEditDiff('row_1 ', 'row_one '), rawEditDiff('row_2 ', 'row_two ')].join('\n…\n'));
  // D90: a secret block in an Edit, past the budget, is rendered as recorded and cut by the budget alone.
  const yaml = [...filler(80, 'setting'), 'signing_key: |', ...SECRET_LINES.map((l) => `  ${l}`), ...filler(3, 'tail')].join('\n');
  const { clean: block } = await sliced([userTurn('add it'),
    toolUse('e2', 'Edit', { file_path: '/repo/conf.yaml', old_string: 'placeholder: 1', new_string: yaml }), updated('e2')]);
  assert.equal(writes(block)[0].diff, rawEditDiff('placeholder: 1', yaml));
  assert.ok(writes(block)[0].diff.includes(`+  ${SECRET_LINES.at(-1)}`), 'the block\'s last line, as written');
  assert.doesNotMatch(JSON.stringify(block), /‹(?:redacted|dropped)/);
});

test('M33 R repair: redacting a ledger twice changes nothing, and the same input gives the same bytes', async () => {
  const yaml = [...filler(40, 'setting'), 'signing_key: |', ...SECRET_LINES.map((l) => `  ${l}`), ...filler(3, 'tail')].join('\n');
  const records = () => [userTurn(stripCase()), toolUse('e1', 'Edit', { file_path: '/repo/conf.yaml', old_string: 'x: 1', new_string: yaml }),
    updated('e1'), toolUse('w1', 'Write', { file_path: '/repo/k.js', content: [...filler(20, 'const'), ...PEM].join('\n') }),
    toolResult('w1', 'File created successfully'), said('Done.')];
  // C-01 event identity: one recording (its rows' uuids are recorded now), sliced twice.
  const rows = records();
  const { clean } = await sliced(rows);
  const { clean: again } = await sliced(rows);
  assert.equal(sliceHash(again), sliceHash(clean));
  const twice = redact({ ...structuredClone(clean), dropped: [] }).ledger;
  assert.equal(sliceHash(twice), sliceHash(clean));
  assert.deepEqual({ ...twice, dropped: [] }, { ...clean, dropped: [] });
});

// ---- the ask: kept whole (M6), as recorded (D90) ----------------------------------------------------------------------

const BLOCK = Array.from({ length: 30 }, (_, i) => `    correct-horse-battery-staple-lantern-${String(i).padStart(4, '0')}`);
const TAIL_SECRETS = ['quiet-meadow-orchard-violet-ember', 'paper-tiger-river-stone-hollow'];
/** An ask whose YAML secret block is split by a blank line across what the retired indented-block strip took. */
function stripCase() {
  return ['Please configure the deployment with this:', 'signing_key: |', ...BLOCK, '',
    ...TAIL_SECRETS.map((l) => `    ${l}`), 'Thanks.'].join('\n');
}

test('M6, D90: a pasted secret block is kept where it stands, as recorded, never stripped by its shape', async () => {
  for (const text of [stripCase(), ['Please configure:', 'signing_key: |', ...BLOCK, ...BLOCK.map((l) => `${l}-b`), '',
    ...TAIL_SECRETS.map((l) => `    ${l}`), 'Thanks.'].join('\n')]) {
    const { raw, clean } = await sliced([userTurn(text), said('Done.')]);
    const [ask] = clean.ask;
    assert.equal(ask.text, text, 'the turn as recorded');
    assert.equal(ask.redacted, undefined);
    assert.doesNotMatch(ask.text, /\[(indented block|code block|traceback|attachment), \d+ lines/);
    assert.equal(Object.hasOwn(ask, 'elided'), false, 'nothing stripped, nothing declared');
    // The slicer kept the whole turn and declared nothing.
    assert.equal(raw.ask[0].text, text, 'nothing is cut before redaction');
    assert.equal(Object.hasOwn(raw.ask[0], 'elided'), false);
    assert.equal(raw.ask[0].mentions, undefined, 'and harvests no names');
  }
});

test('M6, D90: a long fence is kept whole — its names stand in the ask\'s own text, a secret block\'s value too', async () => {
  const fence = ['```', 'deploy:', '  signing_key: |', '    quiet-meadow-orchard.violet', '    lantern-moss.river',
    ...Array.from({ length: 40 }, (_, i) => `  step ${i}: touch src/parser_${i}.rs`), '```'].join('\n');
  const { clean } = await sliced([userTurn(`do it\n${fence}\nthanks`), said('Done.')]);
  const [ask] = clean.ask;
  assert.doesNotMatch(ask.text, /\[code block, \d+ lines, \d+ chars\]/);
  assert.ok(ask.text.includes('touch src/parser_3.rs'), 'the plan the human pasted is the human\'s words');
  assert.equal(ask.mentions, undefined, 'nothing was cut, so no name is harvested from material the model cannot see');
  assert.ok(ask.text.includes('    quiet-meadow-orchard.violet\n    lantern-moss.river'), 'as recorded');
});

test('M6, M35: an ask with nothing to redact is kept whole — its blank runs folded and trimmed — in full', async () => {
  const trace = ['Traceback (most recent call last):', ...Array.from({ length: 40 }, (_, i) => `  File "src/mod_${i}.py", line ${i}, in run_${i}`), 'ValueError: bad'].join('\n');
  const indented = Array.from({ length: 40 }, (_, i) => `    step ${i} of the pasted plan touches lib/part_${i}.go`).join('\n');
  const fence = `${'```'}\n${Array.from({ length: 50 }, (_, i) => `line ${i} of pasted output`).join('\n')}\n${'```'}`;
  const note = `<command-output>${'remember the plan. '.repeat(80)}</command-output>`;
  const fold = (text) => text.replace(/\n{3,}/g, '\n\n').trim();
  const asks = [`  fix the parser\n\n\n\n${fence}\n\nkeep the API\n${trace}\n\nthen\n${indented}\n${note}\n\n`,
    `short ask, nothing to strip\n\n\n\nsecond paragraph  `, `${indented}\nleading block`, `${fence}${fence}`,
    `${prose(20_000)}\n${fence}\n${prose(3_000)}`];
  for (const text of asks) {
    const c = compressAsk(text);
    assert.deepEqual(c.elided, [], 'M35: no cut is ever due on a human message');
    const [ask] = redact(led({ ask: [{ turn: 1, text: c.text }] })).ledger.ask;
    assert.equal(ask.text, fold(text));
    assert.equal(Object.hasOwn(ask, 'elided'), false);
  }
  // Through the slicer too.
  const text = `fix the parser\n${fence}\nkeep the API\n${indented}\nthanks`;
  const { clean } = await sliced([userTurn(text), said('Done.')]);
  assert.equal(clean.ask[0].text, fold(text));
  assert.equal(Object.hasOwn(clean.ask[0], 'elided'), false);
});

test('M6, M35: compressAsk keeps the turn whole and declares no cut; only an attached file\'s budget declares one', () => {
  const text = stripCase();
  assert.deepEqual(compressAsk(text), { text, elided: [] });
  assert.deepEqual(compressAsk('  a\n\n\n\nb  '), { text: 'a\n\nb', elided: [] });
  const long = `${prose(20_500)}\n${BLOCK.join('\n')}`;
  assert.deepEqual(compressAsk(long).elided, []);
  assert.deepEqual(compressAsk(long, ATTACHED_CAP).elided.map((e) => e.what), ['middle of turn']);
});

test('M33 R repair, M6: a strip an earlier pass made stays (the strip is final); one only left due is withdrawn; none is made', () => {
  const stripped = 'Fix the parser.\n[code block, 40 lines, 1300 chars]\nKeep the tests green.';
  const out = redact(led({ ask: [{ turn: 1, text: stripped, elided: [{ what: 'code block', chars: 1300 }] }] })).ledger.ask[0];
  assert.equal(out.text, stripped);
  assert.deepEqual(out.elided, [{ what: 'code block', chars: 1300 }]);
  const pasted = `see\n${'```'}\n${prose(3_000)}\n${'```'}\nok`;
  const plain = redact(led({ ask: [{ turn: 1, text: pasted }] })).ledger.ask[0];
  assert.equal(plain.text, pasted, '`ask` stays the scrubber other packages use, uncut');
  assert.equal(Object.hasOwn(plain, 'elided'), false);
  // A persisted ledger whose slicer only left a strip due (the turn whole, unfolded): nothing is stripped, the
  // declaration is withdrawn, the turn folded as that slicer's strip pass would have; a second pass changes nothing.
  const due = redact(led({ ask: [{ turn: 1, text: `${pasted}\n\n\n\nthanks  `, elided: [{ what: 'code block', chars: 3008 }] }] }))
    .ledger.ask[0];
  assert.equal(due.text, `${pasted}\n\nthanks`);
  assert.equal(Object.hasOwn(due, 'elided'), false);
  assert.deepEqual(redact(led({ ask: [structuredClone(due)] })).ledger.ask[0], due);
});

// ---- M35: an over-long ask of one line is kept in full; an attached file of one line keeps its head and tail -------

test('M35: a one-line ask over the retired budget is kept in full; an attached file over its own keeps whole words', async () => {
  const words = (n, from = 0) => Array.from({ length: n }, (_, i) => `word${String(from + i).padStart(5, '0')}`).join(' ');
  const text = `${words(4_000)} ${words(4_000, 4_000)} ${words(4_000, 8_000)}`;    // 120,000 characters, one line
  const { clean } = await sliced([userTurn(text), said('Done.')]);
  const [ask] = clean.ask;
  assert.equal(ask.text, text, 'in full');
  assert.equal(Object.hasOwn(ask, 'elided'), false);
  const again = redact({ ...structuredClone(clean), dropped: [] }).ledger.ask[0];
  assert.deepEqual(again, ask, 'a second pass changes nothing');
  // D90: a token anywhere in it is kept where it stands.
  for (const at of [13_980, 60_000, text.length - 5_990]) {
    const withToken = `${text.slice(0, at)} ${GHP} ${text.slice(at)}`;
    const { clean: whole } = await sliced([userTurn(withToken), said('Done.')]);
    assert.equal(whole.ask[0].text, withToken, `token at ${at}`);
  }
  // An attached file (an @-mention) keeps its declared bound: its head and tail, cut at word boundaries.
  const due = compressAsk(text, ATTACHED_CAP);
  const [attached] = redact(led({ ask: [], interjections: [{ kind: 'attached', turn: 0, text: due.text, elided: due.elided,
    beforeEvent: 0, source: 0, record: 1 }] })).ledger.interjections;
  const [head, tail] = attached.text.split(`\n${ASK_OMISSION}\n`);
  assert.ok(head && tail, 'both sides keep text');
  assert.ok([...head].length <= ATTACHED_CAP.head && [...tail].length <= ATTACHED_CAP.tail);
  assert.ok(text.startsWith(`${head} `) && text.endsWith(` ${tail}`), 'whole words of the text, at word boundaries');
  // D68 (E): a statement is what the agent produced, kept whole, however long its one line.
  assert.equal(redact(led({ sayings: [{ turn: 1, text: words(3_000) }] })).ledger.sayings[0].text, words(3_000));
});
