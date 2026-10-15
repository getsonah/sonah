// M33 R repair. Two cuts the slicer still made BEFORE redaction had scrubbed the text whole, and the secrets that span
// lines that survived them.
//
// The diff channel (`diff`): a write's change was rendered from the raw texts and cut there — one line of context around
// each change (`minimalDiff`), a Write's first 30 lines (`createDiff`), the 900/400 head and tail budget (`budgetDiff`).
// Redaction then saw only the lines left. When the cut took away the line that tells redaction a block is secret — the
// `signing_key: |` header of a YAML block, the `-----BEGIN … PRIVATE KEY-----` line of a PEM block — the block's other
// lines reached the ledger verbatim, while the same lines were masked in `after.text`, which is scrubbed whole.
//
// The ask's whole-structure strips (an indented block, a code fence, a traceback, an attachment, each of 1,200 characters
// or more) also ran before redaction. A strip that took a YAML secret block's key and left the block's later lines
// (after a blank line) left those lines unmasked in the ask, the session and the review requests; and the names the
// strip harvested were taken from the raw material.
//
// Now the slicer renders a write's diff from the change as redaction scrubbed it WHOLE (redact/index.js
// `scrubDiffWhole`), and cuts only that; and redaction makes the ask's strips after it has scrubbed the whole ask. A text
// with nothing to redact keeps exactly the bytes it always had. M6: the ask's strips are
// retired — the turn is kept whole up to the transport budget — so the ask tests below pin that a pasted secret block is
// scrubbed where it stands and nothing of a turn is stripped by its shape.
//
// Synthetic recordings only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, sliceHash, ATTACHED_CAP, ASK_OMISSION, scrubDiffWhole } from '../../redact/index.js';
import { compressAsk } from '../src/ask.js';
import { editDiff, createDiff, minimalDiff, budgetDiff } from '../src/diff.js';
import { GHP, prose, userTurn, said, toolUse, toolResult, sliced } from './m33-r-redact-cut-fixture.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const updated = (id) => toolResult(id, 'The file has been updated successfully.');
const writes = (ledger) => ledger.ledger.filter((e) => ['edit', 'create'].includes(e.kind) && !e.via);

/** Every 8-character run of any of `secrets` that `text` still holds. */
const leaks = (text, secrets) => {
  const found = new Set();
  for (const secret of secrets) for (let i = 0; i + 8 <= secret.length; i++) {
    const fragment = secret.slice(i, i + 8);
    if (text.includes(fragment)) found.add(fragment);
  }
  return [...found];
};

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
const PEM_SECRETS = PEM_BODY.map((line) => line.replace(/=+$/, ''));

// ---- the diff: rendered from the change as redaction scrubbed it whole -----------------------------------------------

test('M33 R repair: a YAML secret block whose key falls in the elided middle of an Edit\'s diff leaks no line of it', async () => {
  const yaml = [...filler(40, 'setting'), 'signing_key: |', ...SECRET_LINES.map((l) => `  ${l}`), ...filler(3, 'tail')].join('\n');
  const { raw, clean } = await sliced([userTurn('add it'),
    toolUse('e1', 'Edit', { file_path: '/repo/conf.yaml', old_string: 'placeholder: 1', new_string: yaml }), updated('e1')]);
  // Premise: rendered from the raw text, the budget cut the key away and kept the block's last lines.
  const rendered = rawEditDiff('placeholder: 1', yaml);
  assert.ok(!rendered.includes('signing_key') && rendered.includes(SECRET_LINES.at(-1)), rendered);
  const [edit] = writes(clean);
  assert.ok(edit.diff.includes('+signing_key: |\n+  ‹redacted:secret-value›'), 'every line of the block masked where it stands');
  assert.equal(edit.diff.split('\n').filter((line) => line === '+  ‹redacted:secret-value›').length, SECRET_LINES.length);
  assert.deepEqual(leaks(JSON.stringify(clean), SECRET_LINES), [], 'no fragment of the block anywhere in the ledger');
  assert.deepEqual(leaks(writes(raw)[0].diff, SECRET_LINES), [], 'the slicer cut only text redaction had scrubbed whole');
  assert.ok(clean.dropped.some((d) => d.where === 'diff' && d.reason === 'redacted:secret-key-value' && d.turn === 1),
    'the diff declares what redaction withheld from it');
  assert.equal(Object.hasOwn(edit, 'diffRedaction'), false, 'the declaration is redaction\'s, made and removed by it');
  // Long enough once masked, the diff is still cut by the budget: after redaction, so its tail is masked lines.
  const longer = [...filler(80, 'setting'), 'signing_key: |', ...SECRET_LINES.map((l) => `  ${l}`), ...filler(3, 'tail')].join('\n');
  const { clean: cut } = await sliced([userTurn('add it'),
    toolUse('e2', 'Edit', { file_path: '/repo/conf.yaml', old_string: 'placeholder: 1', new_string: longer }), updated('e2')]);
  const [budgeted] = writes(cut);
  assert.match(budgeted.diff, /\n\[… \d+ diff lines elided …\]\n/);
  assert.ok(budgeted.diff.split('\n').slice(-6, -3).every((line) => line === '+  ‹redacted:secret-value›'), budgeted.diff);
  assert.deepEqual(leaks(JSON.stringify(cut), SECRET_LINES), []);
});

test('M33 R repair: an Edit inside a secret block whose key is outside the one line of context leaks nothing, and the change stays visible', async () => {
  const old = ['signing_key: |', ...WORDS.slice(0, 5).map((l) => `  ${l}`), 'region: eu-west-1'].join('\n');
  const neu = old.replace(`  ${WORDS[2]}`, `  ${WORDS[2]}-v2`);
  const { clean } = await sliced([userTurn('rotate it'),
    toolUse('e1', 'Edit', { file_path: '/repo/conf.yaml', old_string: old, new_string: neu }), updated('e1')]);
  const [edit] = writes(clean);
  assert.equal(edit.diff, ['   ‹redacted:secret-value›', '-  ‹redacted:secret-value›', '+  ‹redacted:secret-value›',
    '   ‹redacted:secret-value›'].join('\n'), 'one line of context either side, each masked where it stands');
  assert.deepEqual(leaks(JSON.stringify(clean), [...WORDS, `${WORDS[2]}-v2`]), []);
});

test('M33 R repair: a PEM block whose BEGIN line falls in the elided middle of a Write\'s diff leaks no line of its body', async () => {
  const lines = [...Array.from({ length: 20 }, (_, i) => `const value_${String(i).padStart(2, '0')} = "plain text number ${i} and some more";`),
    ...PEM, 'after the key one', 'after the key two'];
  const content = lines.join('\n');
  // Premise: rendered from the raw text, the budget cut the BEGIN line away and kept the key's short last line.
  const rendered = rawCreateDiff(content);
  assert.ok(!rendered.includes('BEGIN') && rendered.includes(PEM_BODY.at(-1)), rendered);
  const { raw, clean } = await sliced([userTurn('write it'),
    toolUse('w1', 'Write', { file_path: '/repo/key.js', content }), toolResult('w1', 'File created successfully')]);
  const [write] = writes(clean);
  assert.deepEqual(leaks(JSON.stringify(clean), PEM_SECRETS), [], 'no fragment of the key anywhere in the ledger');
  assert.deepEqual(leaks(writes(raw)[0].diff, PEM_SECRETS), []);
  assert.match(write.diff, /\[… 10 diff line\(s\) dropped: private key block …\]/, 'the head\'s ten key lines are declared dropped');
  assert.ok(clean.dropped.some((d) => d.where === 'diff' && d.reason === 'dropped:pem-block'));
  assert.equal(write.redacted, true);
});

test('M33 R repair: an Edit of a PEM block\'s last line, its BEGIN outside the context, leaks nothing', async () => {
  const old = PEM.join('\n');
  const neu = PEM.map((line, i) => (i === 9 ? `${b64Line(3, 22)}==` : line)).join('\n');
  const { clean } = await sliced([userTurn('swap it'),
    toolUse('e1', 'Edit', { file_path: '/repo/key.pem.txt', old_string: old, new_string: neu }), updated('e1')]);
  const [edit] = writes(clean);
  assert.deepEqual(leaks(JSON.stringify(clean), [...PEM_SECRETS, b64Line(3, 22)]), []);
  assert.match(edit.diff, /dropped: private key block/);
});

test('M33 R repair: a secret-named value continued onto a line the context shows without its key leaks nothing', async () => {
  const value = 'zebraquartzlanternmosshollowriver';
  const old = ['export DEPLOY_TOKEN=\\', `  ${value}`, 'echo one', 'echo two', 'echo three'].join('\n');
  const neu = old.replace('echo one', 'echo 1');
  const { clean } = await sliced([userTurn('tidy it'),
    toolUse('e1', 'Edit', { file_path: '/repo/run.sh', old_string: old, new_string: neu }), updated('e1')]);
  assert.deepEqual(leaks(JSON.stringify(clean), [value]), []);
});

test('M33 R repair: a LCS fallback diff (two long sides) is rendered from the scrubbed sides too', async () => {
  const old = Array.from({ length: 600 }, (_, i) => `old line ${i}`).join('\n');
  const neu = ['api_secret: |', ...SECRET_LINES.map((l) => `  ${l}`),
    ...Array.from({ length: 600 }, (_, i) => `new line ${i}`)].join('\n');
  const { clean } = await sliced([userTurn('replace it'),
    toolUse('e1', 'Edit', { file_path: '/repo/big.yaml', old_string: old, new_string: neu }), updated('e1')]);
  const [edit] = writes(clean);
  assert.match(edit.diff, /old lines elided/, 'premise: the sides are past the LCS ceiling');
  assert.deepEqual(leaks(JSON.stringify(clean), SECRET_LINES), []);
});

test('M33 R repair: a MultiEdit declares what redaction withheld from the diffs it shows', async () => {
  const block = ['password: |', ...WORDS.slice(0, 3).map((l) => `  ${l}`)].join('\n');
  const { clean } = await sliced([userTurn('edit it'), toolUse('m1', 'MultiEdit', { file_path: '/repo/c.yaml', edits: [
    { old_string: 'a: 1', new_string: 'a: 2' }, { old_string: 'b: 1', new_string: block }] }), updated('m1')]);
  const [edit] = writes(clean);
  assert.deepEqual(leaks(JSON.stringify(clean), WORDS), []);
  assert.ok(edit.diff.includes('+  ‹redacted:secret-value›'));
  assert.ok(clean.dropped.some((d) => d.where === 'diff' && d.reason === 'redacted:secret-key-value'));
});

test('M33 R repair: the whole-diff scrub keeps every line in its place, says why a line went, and groups what it declared', () => {
  const lines = [' keep me', ...PEM.map((l) => `+${l}`), '+password: hunter2-correct-horse', ' tail line'];
  const whole = scrubDiffWhole(lines);
  assert.equal(whole.lines.length, lines.length, 'one entry per line');
  assert.equal(whole.lines[0], ' keep me');
  assert.deepEqual(whole.lines.slice(1, 12), Array(11).fill(null), 'the key block, every line of it');
  assert.deepEqual(whole.drops.slice(1, 12), Array(11).fill('dropped:pem-block'));
  assert.equal(whole.lines[12], '+password: ‹redacted:secret-value›');
  assert.equal(whole.drops[12], null);
  assert.equal(whole.lines[13], ' tail line');
  const pem = whole.groups.find((g) => g.reasons.includes('dropped:pem-block'));
  assert.deepEqual(pem.at, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.ok(whole.groups.some((g) => g.at.includes(12) && g.reasons.length > 0));
  // The text it returns is the diff channel's own: the same as redacting a ledger diff of those lines.
  const viaLedger = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'k', diff: lines.join('\n') }] })).ledger.ledger[0].diff;
  assert.equal(viaLedger.split('\n').filter((l) => !l.startsWith('[… ')).join('\n'),
    whole.lines.filter((l) => l !== null).join('\n'));
});

test('M33 R repair: a declaration of the diff\'s redaction that is not one redaction can make fails closed', () => {
  for (const bad of [{ reasons: ['made-up'] }, { reasons: 'dropped:pem-block' }, [], { reasons: [], lost: 'yes' }]) {
    const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'a', diff: '+ok', diffRedaction: bad }] })).ledger.ledger[0];
    assert.equal(Object.hasOwn(out, 'diff'), false, JSON.stringify(bad));
    assert.equal(out.redacted, true);
    assert.equal(Object.hasOwn(out, 'diffRedaction'), false);
  }
  const ok = redact(led({ ledger: [{ turn: 3, seq: 0, kind: 'edit', path: 'a', diff: '+ok',
    diffRedaction: { reasons: ['dropped:pem-block'], lost: true } }] }));
  assert.equal(ok.ledger.ledger[0].diff, '+ok');
  assert.equal(ok.ledger.ledger[0].redacted, true);
  assert.deepEqual(ok.dropped.filter((d) => d.where === 'diff'), [{ turn: 3, reason: 'dropped:pem-block', where: 'diff' }]);
});

// ---- nothing to redact: exactly the bytes the raw rendering always gave -------------------------------------------

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

test('M33 R repair: a change with nothing to redact renders exactly the bytes it always did', () => {
  const code = Array.from({ length: 120 }, (_, i) => (i % 17 === 0 ? `export function handler_${i}(req) {` : `  const item_${i} = compute(${i}, "label ${i}");`));
  const cases = [
    ['function f() {\n1\n2\n3\n4\nold', 'function f() {\n1\n2\n3\n4\nnew'],
    [code.join('\n'), code.map((l, i) => (i % 9 === 0 ? `${l} // touched` : l)).join('\n')],
    [code.slice(0, 40).join('\n'), [...code.slice(0, 20), 'inserted line', ...code.slice(20, 40)].join('\n')],
    ['', 'new file body\nsecond line'],
    ['same\ntext', 'same\ntext'],
    [Array.from({ length: 600 }, (_, i) => `old ${i}`).join('\n'), Array.from({ length: 600 }, (_, i) => `new ${i}`).join('\n')],
    [`  export class Store {\n${'  x\n'.repeat(5)}}`, `  export class Store {\n${'  y\n'.repeat(5)}}`],
  ];
  for (const [a, b] of cases) assert.equal(editDiff(a, b), rawEditDiff(a, b), JSON.stringify([a.slice(0, 40), b.slice(0, 40)]));
  for (const content of [code.join('\n'), code.slice(0, 10).join('\n'), 'one line', prose(5_000), `${'x'.repeat(3_000)}\nshort`])
    assert.equal(createDiff(content), rawCreateDiff(content));
});

test('M33 R repair: a clean session\'s ledger is byte-identical through slicing and redaction', async () => {
  const code = Array.from({ length: 80 }, (_, i) => `  const row_${i} = load(${i}); // keeps the parser stable`).join('\n');
  const records = [userTurn('refactor the loader'),
    toolUse('w1', 'Write', { file_path: '/repo/a.js', content: code }), toolResult('w1', 'File created successfully'),
    toolUse('e1', 'Edit', { file_path: '/repo/a.js', old_string: code, new_string: code.replace('load(40)', 'load(41)') }), updated('e1'),
    toolUse('m1', 'MultiEdit', { file_path: '/repo/a.js', edits: [{ old_string: 'row_1 ', new_string: 'row_one ' },
      { old_string: 'row_2 ', new_string: 'row_two ' }] }), updated('m1'), said('Done.')];
  const { raw, clean } = await sliced(records);
  for (const [r, c] of writes(raw).map((e, i) => [e, writes(clean)[i]])) {
    assert.equal(c.diff, r.diff, 'redaction left the clean diff as the slicer rendered it');
    assert.equal(Object.hasOwn(r, 'diffRedaction'), false, 'nothing declared where nothing was withheld');
  }
  const [write, edit, multi] = writes(clean);
  assert.equal(write.diff, rawCreateDiff(code));
  assert.equal(edit.diff, rawEditDiff(code, code.replace('load(40)', 'load(41)')));
  assert.equal(multi.diff, [rawEditDiff('row_1 ', 'row_one '), rawEditDiff('row_2 ', 'row_two ')].join('\n…\n'));
});

test('M33 R repair: redacting a redacted ledger changes nothing, and the same input gives the same bytes', async () => {
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

// ---- the ask: kept whole (M6), scrubbed whole -----------------------------------------------------------------------

const BLOCK = Array.from({ length: 30 }, (_, i) => `    correct-horse-battery-staple-lantern-${String(i).padStart(4, '0')}`);
const TAIL_SECRETS = ['quiet-meadow-orchard-violet-ember', 'paper-tiger-river-stone-hollow'];
/** An ask whose YAML secret block is split by a blank line across what the retired indented-block strip took. */
function stripCase() {
  return ['Please configure the deployment with this:', 'signing_key: |', ...BLOCK, '',
    ...TAIL_SECRETS.map((l) => `    ${l}`), 'Thanks.'].join('\n');
}

test('M6: a pasted secret block is scrubbed where it stands and kept, never stripped by its shape', async () => {
  for (const text of [stripCase(), ['Please configure:', 'signing_key: |', ...BLOCK, ...BLOCK.map((l) => `${l}-b`), '',
    ...TAIL_SECRETS.map((l) => `    ${l}`), 'Thanks.'].join('\n')]) {
    const { raw, clean } = await sliced([userTurn(text), said('Done.')]);
    const [ask] = clean.ask;
    assert.deepEqual(leaks(JSON.stringify(clean.ask), [...TAIL_SECRETS, ...BLOCK.map((l) => l.trim())]), []);
    assert.ok(ask.text.startsWith('Please configure'), ask.text.slice(0, 40));
    assert.ok(ask.text.endsWith('    ‹redacted:secret-value›\n    ‹redacted:secret-value›\nThanks.'), 'masked where it stands');
    assert.doesNotMatch(ask.text, /\[(indented block|code block|traceback|attachment), \d+ lines/);
    assert.equal(Object.hasOwn(ask, 'elided'), false, 'nothing stripped, nothing declared');
    // The slicer kept the whole turn and declared nothing.
    assert.equal(raw.ask[0].text, text, 'nothing is cut before redaction');
    assert.equal(Object.hasOwn(raw.ask[0], 'elided'), false);
    assert.equal(raw.ask[0].mentions, undefined, 'and harvests no names');
  }
});

test('M6: a long fence is kept whole — its names stand in the ask\'s own text, a secret block\'s value is masked', async () => {
  const fence = ['```', 'deploy:', '  signing_key: |', '    quiet-meadow-orchard.violet', '    lantern-moss.river',
    ...Array.from({ length: 40 }, (_, i) => `  step ${i}: touch src/parser_${i}.rs`), '```'].join('\n');
  const { clean } = await sliced([userTurn(`do it\n${fence}\nthanks`), said('Done.')]);
  const [ask] = clean.ask;
  assert.doesNotMatch(ask.text, /\[code block, \d+ lines, \d+ chars\]/);
  assert.ok(ask.text.includes('touch src/parser_3.rs'), 'the plan the human pasted is the human\'s words');
  assert.equal(ask.mentions, undefined, 'nothing was cut, so no name is harvested from material the model cannot see');
  assert.deepEqual(leaks(JSON.stringify(ask), ['quiet-meadow-orchard', 'lantern-moss.river']), []);
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
  // A token anywhere in it is scrubbed.
  for (const at of [13_980, 60_000, text.length - 5_990]) {
    const withToken = `${text.slice(0, at)} ${GHP} ${text.slice(at)}`;
    const { clean: whole } = await sliced([userTurn(withToken), said('Done.')]);
    assert.deepEqual(leaks(JSON.stringify(whole.ask), [GHP]), [], `token at ${at}`);
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
