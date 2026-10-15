// M33 R repair 2. The rest of what the slicer still picked or cut before redaction had judged it with what stands
// around it, and the diff channel's PEM rule, which judged the old and new texts of a change as one.
//
// - A first error line was picked from the raw output (D69 (c), owner decision 2026-10-08: deleted with its patterns;
//   what its repair guarded — no fragment of a continued token, no line of a secret block — is tested on the output).
// - The window of a write's own arguments (`excerptWindow`) ended at the physical line break after the character its
//   budget falls on, and the slicer's memory bound (`retainHead`) could end at a line break after a `\`, or in the
//   whitespace after it: both handed redaction half of a continued token. Now each ends outside the logical line.
//   (D68 E, owner decision 2026-10-07: the memory bound is deleted; the window still ends outside the logical line.)
// - The diff channel's PEM machine ran over the old and new lines of a change interleaved: when BEGIN was common and
//   the END line differed, the removed END closed the block before the added body lines, and the new text's last body
//   line survived in the diff (the same block was dropped whole from `after.text`). Now each side runs its own machine
//   and a line is dropped when either side holds it inside a block.
//
// Synthetic recordings and ledgers only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, scrubDiffWhole } from '../../redact/index.js';
import * as before from '../src/before.js';
const { logicalLineStart, logicalLineEnd, continuationBefore } = before;
import { GHP, SK, userTurn, toolUse, toolResult, sliced, continued, prose } from './m33-r-redact-cut-fixture.js';
import { codexSliced, direct, edits, b64Line, BEGIN, leaks } from './m33-r-codex-patch-fixture.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const updated = (id) => toolResult(id, 'The file has been updated successfully.');
const WORDS = ['correct-horse-battery-staple-lantern', 'quiet-meadow-orchard-violet-ember'];

// ---- the logical line ------------------------------------------------------------------------------------------------

test('M33 R repair 2: a logical line is its physical lines joined by continuations, as redaction joins them', () => {
  const text = 'one\nexport A=first\\\n   second\\\n\n  third\nfour';
  const at = (s) => text.indexOf(s);
  assert.equal(logicalLineStart(text, at('third')), at('export'), 'back through every continuation, blank lines too');
  assert.equal(logicalLineStart(text, at('one')), 0);
  assert.equal(logicalLineStart(text, at('four')), at('four'));
  assert.equal(logicalLineEnd(text, text.indexOf('\n', at('export'))), text.indexOf('\n', at('third')));
  assert.equal(logicalLineEnd(text, text.indexOf('\n')), text.indexOf('\n'), 'a line with no continuation ends where it ends');
  assert.equal(logicalLineEnd('a\\\n  ', 1 + 1), -1, 'a continuation into nothing runs to the end');
  assert.equal(continuationBefore(text, at('second')), at('second') - 5, 'inside the join: its `\\`');
  assert.equal(continuationBefore(text, at('first')), -1);
  assert.equal(continuationBefore('a\\ b', 3), -1, 'a `\\` before a space is not a continuation');
  // M33 R repair 3: a `\\` and a CRLF line break is a continuation too, to redaction and to the slicer alike.
  assert.equal(continuationBefore('a\\\r\nb', 4), 1, 'and one before a CRLF line break');
  assert.equal(continuationBefore('a\\\rb', 3), -1, 'never one before a carriage return alone');
});

test('D68 (E): the slicer has no memory bound any more; a continued token is kept whole for redaction', () => {
  assert.equal('retainHead' in before, false, 'the 40,000-character memory bound is deleted');
  const text = `${'a '.repeat(10)}\nexport TOKEN=${GHP.slice(0, 20)}\\\n  ${GHP.slice(20)} rest of it\nmore`;
  const [event] = redact(led({ ledger: [{ turn: 1, kind: 'bash', cmd: 'cat x', tailLines: text.split('\n') }] })).ledger.ledger;
  assert.equal(leaks(JSON.stringify(event), GHP).length, 0, 'the joined token is judged whole');
});

test('M33 R repair 2, D69 review: a Codex Add File\'s arguments with a continued token past 2,000 units keep no half of it', async () => {
  for (const token of [GHP, SK]) {
    for (const split of [4, 12, 20, token.length - 4]) {
      const content = continued(token, split, 2_000, 3_000);
      const patch = `*** Begin Patch\n*** Add File: deploy.sh\n${content.split('\n').map((l) => `+${l}`).join('\n')}\n*** End Patch`;
      const { raw, clean } = await codexSliced(direct(patch));
      const [write] = edits(clean);
      assert.equal(write.kind, 'create');
      // D69 review: the arguments are kept whole (no window at 2,000 units any more) and scrubbed whole.
      assert.doesNotMatch(edits(raw)[0].argsExcerpt, /…\[\+\d+\]$/, 'the arguments are whole');
      assert.deepEqual(leaks(JSON.stringify(clean), [token]), [], `${token.slice(0, 4)} split ${split}`);
    }
  }
});

// ---- the first error line --------------------------------------------------------------------------------------------

const failed = (output) => [userTurn('deploy it'), toolUse('b1', 'Bash', { command: 'node deploy.js' }),
  toolResult('b1', output, { isError: true })];
const commandOf = (ledger) => ledger.ledger.find((e) => e.cmd === 'node deploy.js');

// D69 (c) (owner decision 2026-10-08): the first error line, and the patterns that picked it from an output's words, are
// deleted. What these tests guarded stays guarded where the output is shown: no fragment of a continued token, no line
// of a secret block, reaches the ledger.
test('D69 (c): no first error line is picked from an output; a continued token or a secret block stays masked in the output', async () => {
  for (const split of [4, 18, 30]) {
    const output = `Error: request failed for ${GHP.slice(0, split)}\\\n  ${GHP.slice(split)} and gave up\nat deploy.js:1`;
    const { raw, clean } = await sliced(failed(output));
    assert.equal(Object.hasOwn(commandOf(raw), 'firstErrorLine'), false);
    assert.deepEqual(leaks(JSON.stringify(clean), [GHP]), [], `split ${split}`);
  }
  const into = `export DEPLOY_TOKEN=\\\nValueError: ${WORDS[0]}\nat deploy.js:2`;
  const { raw: rawInto, clean: cleanInto } = await sliced(failed(into));
  assert.equal(Object.hasOwn(commandOf(rawInto), 'firstErrorLine'), false);
  assert.deepEqual(leaks(JSON.stringify(cleanInto), [WORDS[0]]), []);
  const block = ['rendered config:', 'signing_key: |', `  SigningError: ${WORDS[0]}`, `  ${WORDS[1]}`, 'TimeoutError waited too long'];
  const { raw, clean } = await sliced(failed(block.join('\n')));
  assert.equal(Object.hasOwn(commandOf(raw), 'firstErrorLine'), false);
  assert.deepEqual(leaks(JSON.stringify(clean), WORDS), []);
  assert.ok(commandOf(clean).tailLines.includes('  ‹redacted:secret-value›'), 'the output still shows the block, masked');
});

// ---- the diff's PEM rule, one machine per side -----------------------------------------------------------------------

const END_RSA = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const END_PLAIN = ['-----END', 'PRIVATE', 'KEY-----'].join(' ');
const BODY = [b64Line(1), b64Line(2)];
const SHORT = `${b64Line(7, 24)}==`;

test('M33 R repair 2: a PEM block whose END line changed drops the new side\'s body lines too', () => {
  const lines = [` ${BEGIN}`, ...BODY.map((l) => ` ${l}`), `-${END_RSA}`, `+${SHORT}`, `+${END_PLAIN}`, ' after: 1'];
  const whole = scrubDiffWhole(lines);
  assert.deepEqual(whole.lines.slice(0, 6), Array(6).fill(null), 'every line either side holds inside the block');
  assert.equal(whole.lines[6], ' after: 1');
  assert.deepEqual(whole.groups.filter((g) => g.reasons.includes('dropped:pem-block')).map((g) => g.at), [[0, 1, 2, 3, 4, 5]],
    'one block, declared once');
  const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'k.txt', diff: lines.join('\n') }] }));
  assert.deepEqual(leaks(JSON.stringify(out.ledger), [SHORT.replace(/=+$/, '')]), []);
  assert.equal(out.dropped.filter((d) => d.reason === 'dropped:pem-block').length, 1);
});

test('M33 R repair 2: the same change made by an Edit leaks none of its key, in the diff or anywhere', async () => {
  const old = [BEGIN, ...BODY, END_RSA, 'after: 1'].join('\n');
  const neu = [BEGIN, ...BODY, SHORT, END_PLAIN, 'after: 1'].join('\n');
  const { clean } = await sliced([userTurn('swap it'),
    toolUse('e1', 'Edit', { file_path: '/repo/k.txt', old_string: old, new_string: neu }), updated('e1')]);
  assert.deepEqual(leaks(JSON.stringify(clean), [SHORT.replace(/=+$/, ''), ...BODY]), []);
});

test('M33 R repair 2: PEM blocks either side alone, or both alike, are dropped and declared as they were', () => {
  const cases = [
    [[` ${BEGIN}`, ...BODY.map((l) => ` ${l}`), ` ${END_RSA}`, ' x'], 1, 4],
    [[`-${BEGIN}`, ...BODY.map((l) => `-${l}`), `-${END_RSA}`, ' x'], 1, 4],
    [[`-${BEGIN}`, ...BODY.map((l) => `-${l}`), `-${END_RSA}`, `+${BEGIN}`, ...BODY.map((l) => `+${l}`), `+${END_RSA}`, ' x'], 2, 8],
    [[` ${BEGIN}`, `-${BODY[0]}`, `+${BODY[1]}`, ` ${END_RSA}`, ' x'], 1, 4],
    [[' x', ` ${prose(20).trim()}`], 0, 0],
  ];
  for (const [lines, blocks, gone] of cases) {
    const whole = scrubDiffWhole(lines);
    assert.equal(whole.lines.filter((l) => l === null).length, gone, lines.join('|').slice(0, 40));
    assert.equal(whole.groups.filter((g) => g.reasons.includes('dropped:pem-block')).length, blocks);
    assert.equal(whole.lines.at(-1), lines.at(-1), 'the line after the block stands');
  }
});
