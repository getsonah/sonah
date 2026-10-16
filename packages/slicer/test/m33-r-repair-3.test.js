// M33 R repair 3, D90. What stays of the third leak hunt's repairs once nothing is masked (D90, owner decision
// 2026-10-15, privacy is not a design constraint; the tests of what the hunt found leaking are deleted with the
// detectors):
//
// 1. A Claude Code Read's text is kept unwrapped, de-numbered and whole as the file's prior state (D68 E: no memory
//    bound), by the slicer's own numbered rule (redact/index.js `READ_LINE_NUMBER`, `isNumberedRead`).
// 2. A Codex patch line with no marker (a malformed patch Codex rejects) is kept as context in both texts the patch
//    changes (an Add File's, as a line of the file), never dropped in silence — and, D90, as recorded.
// 3. A write's arguments (a MultiEdit's `edits`) are kept byte for byte.
//
// Synthetic recordings and ledgers only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, sliceHash, READ_LINE_NUMBER, isNumberedRead } from '../../redact/index.js';
import * as before from '../src/before.js';
const { stripLineNumbers } = before;
import { patchInput } from '../src/codex.js';
import { userTurn, toolUse, toolResult, sliced, numbered } from './m33-r-redact-cut-fixture.js';
import { codexSliced, direct, edits, BEGIN, END, WORDS, ROTATED } from './m33-r-codex-patch-fixture.js';

const updated = (id) => toolResult(id, 'The file has been updated successfully.');
const PEM_SHORT = ['MIIBOgIBAAJBAKj34GkxFhD9', 'Pq3Rs5Tu7Vw9Xy1Za3Bc5De', 'Fg7Hi9Jk1Lm3No5Pq7Rs9Tu', 'Vw1Xy3Za5Bc7De9Fg=='];
const unpadded = (lines) => lines.map((line) => line.replace(/=+$/, ''));
/** Does every one of `secrets` stand whole in the ledger? */
const carried = (clean, secrets) => secrets.every((secret) => JSON.stringify(clean).includes(secret));

// ---- 1. the text a Read recorded, kept whole and de-numbered (the memory bound is deleted, D68 E) ----------------------

test('M33 R repair 3, D68 (E): a numbered Read is kept as its prior state — unwrapped, de-numbered, whole', async () => {
  assert.equal('retainHead' in before, false, 'the memory bound is deleted');
  for (const count of [1_000, 1_200, 3_000]) {
    const lines = Array.from({ length: count }, (_, i) => `row ${String(i).padStart(4, '0')} ${'w'.repeat(30)}`);
    const { raw } = await sliced([userTurn('fix it'), toolUse('r1', 'Read', { file_path: '/repo/rows.txt' }),
      toolResult('r1', numbered(lines)),
      toolUse('e1', 'Edit', { file_path: '/repo/rows.txt', old_string: 'row 0001', new_string: 'row 0002' }), updated('e1')]);
    const { before: prior } = raw.ledger.find((e) => e.before);
    assert.equal(prior.source, 'read');
    assert.equal(prior.truncated, false, `${count} lines: nothing of the file was cut`);
    assert.equal(prior.text, lines.join('\n'));
  }
});

// ---- 2. the numbered rule ---------------------------------------------------------------------------------------

/** A Claude Code Read of `lines` (numbered), and an Edit of the file so its pre-edit body is kept too. */
const readOf = (lines, { edit = true } = {}) => [userTurn('look'), toolUse('r1', 'Read', { file_path: '/repo/a.yaml' }),
  toolResult('r1', numbered(lines)),
  ...(edit ? [toolUse('e1', 'Edit', { file_path: '/repo/a.yaml', old_string: 'last: 2', new_string: 'last: 3' }), updated('e1')] : [])];

test('M33 R repair 3: the numbered rule is the slicer\'s own, in one place; the `N→` form is not one', () => {
  assert.equal(READ_LINE_NUMBER.source, '^\\s*\\d+\\t');
  const reminder = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
  /** The de-numbered view of `text`, by the exported rule. */
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
  test(`M33 R repair 3, D90: ${name} keeps every line of the block, as recorded, applied or rejected`, async () => {
    for (const rows of [direct(patch), rejected(patch)]) {
      const { clean } = await codexSliced(rows);
      assert.ok(edits(clean).length >= 1);
      assert.ok(carried(clean, secrets), name);
      assert.doesNotMatch(JSON.stringify(clean), /‹(?:redacted|dropped)/);
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

// ---- 4. a write's arguments, byte for byte ---------------------------------------------------------------------------

/** A MultiEdit whose one edit writes `text`. */
const multiEdit = (text) => [userTurn('edit it'), toolUse('m1', 'MultiEdit', { file_path: '/repo/run.sh',
  edits: [{ old_string: 'echo old', new_string: text }] }), updated('m1')];
test('M33 R repair 3, D90: a MultiEdit keeps its arguments byte for byte, a continued secret-named value too', async () => {
  for (const text of ['echo one \\\n  two \\\r\n  three\n', `export DB_PASSWORD=\\\r\n  ${WORDS[1]}\n`]) {
    const { raw, clean } = await sliced(multiEdit(text));
    assert.equal(edits(clean)[0].argsExcerpt, edits(raw)[0].argsExcerpt);
    assert.ok(carried(clean, [WORDS[1]]) || !text.includes(WORDS[1]));
  }
});

test('M33 R repair 3: redaction stays deterministic and final over everything this repair keeps', async () => {
  const records = [...readOf(['first: 1', 'signing_key: |', `  ${WORDS[0]}`, 'last: 2']),
    ...multiEdit(`export DB_PASSWORD=\\\r\n  ${WORDS[1]}\n`)];
  const a = await sliced(records);
  const b = await sliced(records);
  assert.equal(JSON.stringify(a.clean), JSON.stringify(b.clean));
  const again = redact(structuredClone(a.clean)).ledger;
  assert.equal(sliceHash(again), sliceHash(a.clean));
  assert.ok(carried(a.clean, WORDS.slice(0, 2)), 'D90: as recorded');
});
