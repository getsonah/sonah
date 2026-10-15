// M33 R repair 3. What the third leak hunt found still reaching the ledger, the session and the review requests.
//
// 1. The slicer's 40,000-character memory bound (`retainHead`) and its continuation guard ran on a Claude Code Read's
//    NUMBERED text (`     N\t…`), but redaction sees that text after the numbers are stripped (before.js
//    `stripLineNumbers`). Where the bound fell on the line after a `\` continuation, the digits hid the `\` from the
//    guard, and the first half of the token the continuation splits survived in the pre-edit body. Now the bound is
//    applied to the text redaction will see: unwrapped, de-numbered, then bounded. (D68 E, owner decision 2026-10-07:
//    the bound is deleted; the text redaction sees is kept whole.)
// 2. A numbered Read's output lines (`tailLines`) were scrubbed with the `     N\t` prefix on, which defeats every
//    line-anchored rule: a YAML secret block's key, a PEM BEGIN line at the start of its line, a continued line (the
//    next line's digits stand between the `\` and the token's second half). Now output whose lines carry the slicer's
//    line number (its own rule for a Read) is scrubbed de-numbered too, and the result is mapped back line by line: a
//    line both views leave alone, or mask alike, is shown as the numbered view shows it; any other line is dropped and
//    counted.
// 3. A Codex patch line with no marker (a malformed patch Codex rejects) was silently dropped from both texts the patch
//    changes, so a YAML key or PEM BEGIN written without its marker left the block's body without its key. Now such a
//    line is kept as context in both texts (an Add File's, as a line of the file): a body never travels without it.
// 4. A line continuation is a `\` and the line break after it, LF or CRLF, in redaction and in the slicer's
//    `continuationBefore`/`logicalLineEnd` alike.
// 5. A write's JSON-serialized arguments (a MultiEdit's `edits`) hold a continued value as `KEY=\\\n  value`: the
//    escaped continuation is joined before the value rules, as a real one is, so the value goes with its key.
//
// Synthetic recordings and ledgers only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, sliceHash, READ_LINE_NUMBER, isNumberedRead } from '../../redact/index.js';
import * as before from '../src/before.js';
const { logicalLineStart, logicalLineEnd, continuationBefore, stripLineNumbers } = before;
import { patchInput } from '../src/codex.js';
import { GHP, TOKENS, leaks as leaksOf, offsets, userTurn, toolUse, toolResult, sliced, numbered, numberedAtBound,
  numberedInto, CUTS } from './m33-r-redact-cut-fixture.js';
import { codexSliced, direct, edits, b64Line, BEGIN, END, WORDS, ROTATED, leaks } from './m33-r-codex-patch-fixture.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const updated = (id) => toolResult(id, 'The file has been updated successfully.');
/** Every fragment of 8 characters or more of `secrets` in the clean ledger. */
const everywhere = (clean, secrets) => [...new Set(leaks(JSON.stringify(clean), secrets))];
const PEM_SHORT = ['MIIBOgIBAAJBAKj34GkxFhD9', 'Pq3Rs5Tu7Vw9Xy1Za3Bc5De', 'Fg7Hi9Jk1Lm3No5Pq7Rs9Tu', 'Vw1Xy3Za5Bc7De9Fg=='];
const PEM_LONG = [b64Line(1), b64Line(2), b64Line(4), `${b64Line(3, 30)}==`];
const unpadded = (lines) => lines.map((line) => line.replace(/=+$/, ''));
// An OpenSSH key's header lines, assembled at run time (a secret scan reads test sources for key headers).
const OPENSSH_BEGIN = ['-----BEGIN', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ');
const OPENSSH_END = ['-----END', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ');

// ---- 1. the text redaction sees, kept whole (the memory bound is deleted, D68 E) ---------------------------------------------------

test('M33 R repair 3 premise: the retired numbered bound fell on the line after the continuation, on its padding, digits, tab or text', () => {
  const seen = new Set();
  for (const split of [16, 17, 18, 19, 20]) {
    const text = numberedAtBound(GHP, split);
    const second = text.lastIndexOf('\n', text.indexOf(`\t${GHP.slice(split)} --retry 3`)) + 1;
    assert.equal(40_000 - second, numberedInto(split), `split ${split}: the 40,000th character is that far into the line`);
    assert.equal(text[second + 6], '\t', 'a number right-aligned in six, then its tab');
    assert.ok(text.slice(second - 2, second) === '\\\n', 'the line before it is continued');
    seen.add(numberedInto(split));
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 3, 6, 7, 9]);
});

test('M33 R repair 3, D68 (E): a numbered Read is kept as redaction sees it — unwrapped, de-numbered, whole', async () => {
  assert.equal('retainHead' in before, false, 'the memory bound is deleted');
  for (const count of [1_000, 1_200, 3_000]) {
    const lines = Array.from({ length: count }, (_, i) => `row ${String(i).padStart(4, '0')} ${'w'.repeat(30)}`);
    const { raw } = await sliced([userTurn('fix it'), toolUse('r1', 'Read', { file_path: '/repo/rows.txt' }),
      toolResult('r1', numbered(lines)),
      toolUse('e1', 'Edit', { file_path: '/repo/rows.txt', old_string: 'row 0001', new_string: 'row 0002' }), updated('e1')]);
    const { before: prior } = raw.ledger.find((e) => e.before);
    assert.equal(prior.source, 'read');
    assert.equal(prior.truncated, false, `${count} lines: nothing of the file redaction will see was cut`);
    assert.equal(prior.text, lines.join('\n'));
  }
});

test('M33 R repair 3: a token continued across the retired numbered bound leaves no fragment, at every offset', async () => {
  for (const [name, token] of Object.entries(TOKENS)) {
    for (const offset of offsets(token, name === 'ghp' ? 1 : 3)) {
      const { clean } = await sliced(CUTS.retainedReadNumberedContinued(token, offset));
      const read = clean.ledger.find((e) => e.kind === 'read');
      assert.ok(Array.isArray(read.tailLines), 'the read\'s own output lines are kept');
      assert.deepEqual(leaksOf(JSON.stringify(clean), token), [], `${name} split ${offset}, bound ${numberedInto(offset)} in`);
    }
  }
});

// ---- 2. numbered output lines are scrubbed de-numbered too ---------------------------------------------------------

/** A Claude Code Read of `lines` (numbered), and an Edit of the file so its pre-edit body is kept too. */
const readOf = (lines, { edit = true } = {}) => [userTurn('look'), toolUse('r1', 'Read', { file_path: '/repo/a.yaml' }),
  toolResult('r1', numbered(lines)),
  ...(edit ? [toolUse('e1', 'Edit', { file_path: '/repo/a.yaml', old_string: 'last: 2', new_string: 'last: 3' }), updated('e1')] : [])];
const readLines = (ledger) => ledger.ledger.find((e) => e.kind === 'read').tailLines;

const NUMBERED_CASES = {
  'a YAML secret block': [['signing_key: |', ...WORDS.map((w) => `  ${w}`)], WORDS],
  'a nested YAML secret block': [['deploy:', '  credentials:', '    password: >-', ...WORDS.map((w) => `      ${w}`), '  region: eu'], WORDS],
  'a PEM block of short lines': [[BEGIN, ...PEM_SHORT, END], unpadded(PEM_SHORT)],
  'a PEM block of long lines': [[BEGIN, ...PEM_LONG, END], unpadded(PEM_LONG)],
  'an OpenSSH key of short lines': [[OPENSSH_BEGIN, ...PEM_SHORT, OPENSSH_END], unpadded(PEM_SHORT)],
  'a continued secret-named value': [['export DB_PASSWORD=\\', `  ${WORDS[0]}`], [WORDS[0]]],
};

for (const [name, [block, secrets]] of Object.entries(NUMBERED_CASES)) {
  test(`M33 R repair 3: ${name} in a numbered Read leaves no line of it, in the output or anywhere`, async () => {
    for (const edit of [false, true]) {
      const { clean } = await sliced(readOf(['first: 1', ...block, 'last: 2'], { edit }));
      assert.deepEqual(everywhere(clean, secrets), [], `edit ${edit}`);
      const lines = readLines(clean);
      assert.equal(lines[0], '     1\tfirst: 1', 'a clean line keeps its number and its bytes');
      assert.equal(lines.at(-1), `${String(block.length + 2).padStart(6)}\tlast: 2`);
      assert.ok(lines.some((line) => /^\[… \d+ line\(s\) dropped: /.test(line)), 'the lines it dropped are counted');
    }
  });
}

test('M33 R repair 3: a token split by a continuation in a numbered Read leaves no fragment, at every split', async () => {
  for (const [name, token] of Object.entries(TOKENS)) {
    for (const split of offsets(token, name === 'ghp' ? 1 : 3)) {
      const k = Math.min(Math.max(split, 0), token.length);
      const block = ['FROM node:20', `RUN curl -H "x: ${token.slice(0, k)}\\`, `${token.slice(k)}" https://x.test`, 'RUN done'];
      const { clean } = await sliced(readOf(block, { edit: false }));
      assert.deepEqual(everywhere(clean, [token]), [], `${name} split ${split}`);
      assert.equal(readLines(clean)[0], '     1\tFROM node:20');
      assert.equal(readLines(clean).at(-1), '     4\tRUN done');
    }
  }
});

test('M33 R repair 3: a numbered output that holds nothing, or a secret both views mask alike, keeps its bytes', async () => {
  const lines = ['first: 1', `token = ${GHP}`, 'url: https://example.test/a', 'last: 2'];
  const { clean } = await sliced(readOf(lines, { edit: false }));
  assert.deepEqual(readLines(clean), ['     1\tfirst: 1', '     2\ttoken = ‹redacted:github-token›',
    '     3\turl: https://example.test/a', '     4\tlast: 2']);
  assert.equal(clean.dropped.filter((d) => d.where === 'tailLines').length, 1, 'declared once, not once per view');
  const plain = ['alpha', 'beta: 2', 'gamma'];
  const { clean: same } = await sliced(readOf(plain, { edit: false }));
  assert.deepEqual(readLines(same), numbered(plain).split('\n'));
});

test('M33 R repair 3: an un-numbered output is scrubbed exactly as before', () => {
  const tailLines = ['signing_key: |', `  ${WORDS[0]}`, 'region: eu', `token = ${GHP}`];
  const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat c.yaml', tailLines }] })).ledger.ledger[0].tailLines;
  assert.deepEqual(out, ['signing_key: |', '  ‹redacted:secret-value›', 'region: eu', 'token = ‹redacted:github-token›']);
});

test('M33 R repair 3: `cat -n` and `nl -ba` output in a command is de-numbered as a Read is', () => {
  const lines = ['region: eu', 'signing_key: |', ...WORDS.map((w) => `  ${w}`), 'done: true'];
  for (const width of [6, 3]) {
    const tailLines = lines.map((line, i) => `${String(i + 1).padStart(width)}\t${line}`);
    const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat -n c.yaml', tailLines }] })).ledger.ledger[0].tailLines;
    assert.deepEqual(leaks(out.join('\n'), WORDS), [], `width ${width}`);
    assert.equal(out[0], tailLines[0]);
    assert.equal(out.at(-1), tailLines.at(-1));
  }
});

test('M33 R repair 3: a numbered Codex shell output is de-numbered too', async () => {
  const lines = ['region: eu', 'signing_key: |', ...WORDS.map((w) => `  ${w}`), 'done: true'];
  const output = lines.map((line, i) => `${String(i + 1).padStart(6)}\t${line}`).join('\n');
  const { clean } = await codexSliced([
    row({ type: 'function_call', name: 'exec_command', call_id: 's1', arguments: JSON.stringify({ cmd: 'nl -ba deploy.yaml' }) }),
    row({ type: 'function_call_output', call_id: 's1',
      output: `Chunk ID: 5f1e2a\nWall time: 0.5000 seconds\nProcess exited with code 0\nOriginal token count: 2\nOutput:\n${output}` })]);
  assert.deepEqual(everywhere(clean, WORDS), []);
});

test('M33 R repair 3: the numbered rule is the slicer\'s own, in one place; the `N→` form is not one', () => {
  assert.equal(READ_LINE_NUMBER.source, '^\\s*\\d+\\t');
  const reminder = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
  /** Redaction's de-numbered view of `text`, by its exported rule. */
  const denumbered = (text) => {
    const t = text.replace(reminder, '').trimEnd();
    return isNumberedRead(t) ? t.split('\n').map((line) => line.replace(READ_LINE_NUMBER, '')).join('\n') : t;
  };
  const cases = ['     1\tfoo\n     2\tbar', '1\tone\nplain\nplain\nplain', '     1\ta\n<system-reminder>\nnote\nmore\n</system-reminder>',
    '     1\ta\n     2\tb\n     3\tc\n     4\td\nplain', '     1→foo\n     2→bar', '', 'plain', '   10\tx\n\n   11\ty\n   12\tz\n   13\tw\nq'];
  for (const text of cases) assert.equal(stripLineNumbers(text), denumbered(text), JSON.stringify(text));
  assert.equal(isNumberedRead('     1\tfoo\n<system-reminder>\na\nb\nc\n</system-reminder>'), true, 'a reminder is not a line of the file');
  // The slicer's Read parsing knows one form, `N` and a tab; no recorder it reads writes `N→`, so neither does this.
  assert.equal(isNumberedRead('     1→foo\n     2→bar'), false);
  assert.equal(stripLineNumbers('     1→foo\n     2→bar'), '     1→foo\n     2→bar');
});

// ---- 3. a patch line with no marker travels with its block -----------------------------------------------------------

const update = (path, hunk) => ['*** Begin Patch', `*** Update File: ${path}`, ...hunk, '*** End Patch'].join('\n');
const add = (path, lines) => ['*** Begin Patch', `*** Add File: ${path}`, ...lines, '*** End Patch'].join('\n');
const REJECTED = 'apply_patch verification failed: Invalid patch hunk on line 4: Unexpected line found in update hunk: '
  + "'signing_key: |'";
const row = (payload) => JSON.stringify({ type: 'response_item', payload });
/** An `apply_patch` call Codex rejected. */
const rejected = (patch) => [row({ type: 'custom_tool_call', name: 'functions.apply_patch', call_id: 'p1', input: patch }),
  row({ type: 'custom_tool_call_output', call_id: 'p1', output: REJECTED })];
const changed = (old, neu) => [...old.map((w) => `-  ${w}`), ...neu.map((w) => `+  ${w}`)];

const UNMARKED = {
  'an unmarked YAML key over a changed block':
    [update('deploy.yaml', ['@@', 'signing_key: |', ...changed(WORDS, ROTATED)]), [...WORDS, ...ROTATED]],
  'an unmarked YAML key after a context line':
    [update('deploy.yaml', ['@@', ' region: eu', 'signing_key: |', ...changed(WORDS, ROTATED)]), [...WORDS, ...ROTATED]],
  'an unmarked continued key':
    [update('run.sh', ['@@', 'export DB_PASSWORD=\\', ...changed([WORDS[0]], [ROTATED[0]]), ' echo done']), [WORDS[0], ROTATED[0]]],
  'an Add File whose YAML key has no marker': [add('deploy.yaml', ['signing_key: |', ...WORDS.map((w) => `+  ${w}`)]), WORDS],
  'an Add File whose PEM BEGIN line has no marker':
    [add('k.pem.txt', [BEGIN, ...PEM_SHORT.map((l) => `+${l}`), `+${END}`]), unpadded(PEM_SHORT)],
  'an Add File whose body lines have no marker':
    [add('deploy.yaml', ['+signing_key: |', ...WORDS.map((w) => `\t${w}`), '+region: eu']), WORDS],
};

for (const [name, [patch, secrets]] of Object.entries(UNMARKED)) {
  test(`M33 R repair 3: ${name} leaves no line of the block, applied or rejected`, async () => {
    for (const rows of [direct(patch), rejected(patch)]) {
      const { clean } = await codexSliced(rows);
      assert.ok(edits(clean).length >= 1);
      assert.deepEqual(everywhere(clean, secrets), []);
    }
  });
}

test('M33 R repair 3: an unmarked hunk line is context in both texts; apply_patch\'s own lines never are', () => {
  const patch = update('deploy.yaml', ['@@', ' region: eu', 'signing_key: |', '-  old', '+  new', '\\ No newline at end of file', '*** End of File']);
  assert.deepEqual(patchInput(patch), { file_path: 'deploy.yaml', _files: ['deploy.yaml'],
    old_string: 'region: eu\nsigning_key: |\n  old', new_string: 'region: eu\nsigning_key: |\n  new' });
  // A well-formed patch splits exactly as it did.
  assert.deepEqual(patchInput(update('src/w.py', ['@@', ' a = 1', '-b = 2', '+b = 3', '', ' c = 4'])), { file_path: 'src/w.py',
    _files: ['src/w.py'], old_string: 'a = 1\nb = 2\n\nc = 4', new_string: 'a = 1\nb = 3\n\nc = 4' });
});

// ---- 4. a CRLF continuation is a continuation ------------------------------------------------------------------------

test('M33 R repair 3: the slicer\'s logical line joins across `\\` CRLF as redaction does', () => {
  const text = 'one\r\nexport A=first\\\r\n   second\\\r\n\r\n  third\r\nfour';
  const at = (s) => text.indexOf(s);
  assert.equal(continuationBefore('a\\\r\nb', 4), 1, 'inside the join: its `\\`');
  assert.equal(continuationBefore('a\\\r\nb', 3), 1);
  assert.equal(continuationBefore('a\\\rb', 3), -1, 'a carriage return alone is not a line break');
  assert.equal(logicalLineStart(text, at('third')), at('export'));
  assert.equal(logicalLineEnd(text, text.indexOf('\n', at('export'))), text.indexOf('\n', at('third')));
  assert.equal(logicalLineEnd(text, text.indexOf('\n')), text.indexOf('\n'));
});

test('M33 R repair 3: a token split by a `\\` CRLF continuation leaves no fragment in any field, at every split', () => {
  for (const [name, token] of Object.entries(TOKENS)) {
    for (const split of offsets(token, name === 'ghp' ? 2 : 6)) {
      const k = Math.min(Math.max(split, 0), token.length);
      const two = [`curl -H "x: ${token.slice(0, k)}\\`, `  ${token.slice(k)}" https://x.test`];
      const crlf = two.join('\r\n');
      const out = redact(led({
        ask: [{ turn: 1, text: `please run\r\n${crlf}\r\nthanks` }],
        ledger: [
          { turn: 1, seq: 0, kind: 'bash', cmd: crlf, tailLines: ['$ run', ...crlf.split('\n'), 'exit 1'] },
          { turn: 1, seq: 1, kind: 'error', firstErrorLine: `Error: ${crlf}` },
          { turn: 1, seq: 2, kind: 'edit', path: 'run.sh', argsExcerpt: `old\n⟪→⟫\n${crlf}`, diff: crlf.split('\n').map((l) => `+${l}`).join('\n'),
            after: { text: crlf, truncated: false, lines: 2 } },
        ],
      })).ledger;
      assert.deepEqual(leaksOf(JSON.stringify(out), token), [], `${name} split ${split}`);
    }
  }
});

test('M33 R repair 3: a Write whose content holds a CRLF-continued token leaves no fragment, cut at every split', async () => {
  for (const split of [4, 12, 20, 36]) {
    const content = `#!/bin/sh\r\nexport API_TOKEN=${GHP.slice(0, split)}\\\r\n  ${GHP.slice(split)}\r\necho ok\r\n`;
    const { clean } = await sliced([userTurn('write it'), toolUse('w1', 'Write', { file_path: '/repo/run.sh', content }),
      toolResult('w1', 'File created successfully')]);
    assert.deepEqual(everywhere(clean, [GHP]), [], `split ${split}`);
  }
});

// ---- 5. a JSON-escaped continuation in a write's arguments -----------------------------------------------------------

/** A MultiEdit whose one edit writes `text`. */
const multiEdit = (text) => [userTurn('edit it'), toolUse('m1', 'MultiEdit', { file_path: '/repo/run.sh',
  edits: [{ old_string: 'echo old', new_string: text }] }), updated('m1')];
/** Every string a JSON text holds, decoded (null when it does not parse). */
const decodedLeaves = (text) => {
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  const out = [];
  const visit = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); visit(x); }
  };
  visit(value);
  return out;
};

test('M33 R repair 3: a MultiEdit\'s `KEY=\\` continued value never keeps its value in the arguments, LF or CRLF', async () => {
  const value = 'violetEmberOrchardRiver';
  const shapes = [`export DB_PASSWORD=\\\n  ${value}\n`, `DB_PASSWORD=\\\n${value}\n`, `x=1\nDB_PASSWORD=\\\r\n  ${value}\n`,
    `api_token: \\\n  ${value}`, `export API_KEY=\\\r\n\t${value}\necho ok`, `curl --password \\\n  ${value} https://x.test`];
  for (const text of shapes) {
    const { raw, clean } = await sliced(multiEdit(text));
    assert.ok(edits(raw)[0].argsExcerpt.includes(value), 'premise: the arguments hold the value');
    const [edit] = edits(clean);
    assert.deepEqual(everywhere(clean, [value]), [], JSON.stringify(text));
    // Where the masked arguments still parse (a mask may run to the end of the field), no decoded string holds it.
    const leaves = typeof edit.argsExcerpt === 'string' ? decodedLeaves(edit.argsExcerpt.replace(/…\[\+\d+\]$/, '')) : null;
    if (leaves) assert.deepEqual(leaks(leaves.join('\n'), [value]), [], 'nor in any decoded string');
  }
});

test('M33 R repair 3: a token split by an escaped continuation in a MultiEdit leaves no fragment, at every split', async () => {
  for (const [name, token] of Object.entries(TOKENS)) {
    for (const split of offsets(token, name === 'ghp' ? 2 : 6)) {
      const k = Math.min(Math.max(split, 0), token.length);
      for (const eol of ['\n', '\r\n']) {
        const { clean } = await sliced(multiEdit(`curl -H "x: ${token.slice(0, k)}\\${eol}  ${token.slice(k)}" https://x.test${eol}`));
        assert.deepEqual(leaksOf(JSON.stringify(clean), token), [], `${name} split ${split} ${JSON.stringify(eol)}`);
      }
    }
  }
});

test('M33 R repair 3: a MultiEdit with nothing to redact keeps its arguments byte for byte', async () => {
  const text = 'echo one \\\n  two \\\r\n  three\n';
  const { raw, clean } = await sliced(multiEdit(text));
  assert.equal(edits(clean)[0].argsExcerpt, edits(raw)[0].argsExcerpt);
});

test('M33 R repair 3: redaction stays deterministic and final over everything this repair joins or maps', async () => {
  const records = [...readOf(['first: 1', 'signing_key: |', `  ${WORDS[0]}`, 'last: 2']),
    ...multiEdit(`export DB_PASSWORD=\\\r\n  ${WORDS[1]}\n`)];
  const a = await sliced(records);
  const b = await sliced(records);
  assert.equal(JSON.stringify(a.clean), JSON.stringify(b.clean));
  const again = redact(structuredClone(a.clean)).ledger;
  assert.equal(sliceHash(again), sliceHash(a.clean));
  assert.deepEqual(everywhere(a.clean, WORDS.slice(0, 2)), []);
});
