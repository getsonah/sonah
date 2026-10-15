// M33 R repair 5. The fifth leak hunt's findings, end to end: a synthetic Claude Code recording or Codex
// rollout, sliced, redacted, then turned into the session the reviewer reads and the review requests built from it.
// Nothing of the secret may reach any of them.
//
// 1. A CRLF file captured through a pseudo-terminal ends each line in `\r\r\n` (`script -q /dev/null cat f`, a Codex
//    `exec_command` with `tty: true`; a CRLF text converted twice reads the same). A YAML secret block's key line there
//    (`signing_key: |\r\r`) opened no block, and its body reached every channel; a `\` before such a line break
//    continued nothing, in redaction or in the slicer's logical lines.
// 2. Claude Code's Grep tool (content mode, `-n`) prints absolute paths, and a project under a folder with a blank in
//    its name got no de-numbered view of that output: a YAML block's body reached `tailLines` and the review requests.
//
// Synthetic recordings only: every byte is invented. No recording is read, no model is called, no network is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceHash } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { planWindowRequests } from '../../evidence/src/run-review.js';
import { logicalLineStart, logicalLineEnd, continuationBefore } from '../src/before.js';
import { GHP, userTurn, said, toolUse, toolResult, sliced } from './m33-r-redact-cut-fixture.js';
import { codexSliced, direct, native, leaks } from './m33-r-codex-patch-fixture.js';

const updated = (id) => toolResult(id, 'The file has been updated successfully.');
const row = (payload) => JSON.stringify({ type: 'response_item', payload });
/** A Codex `exec_command` (with `tty: true` when `tty`) and its output, exiting `exit`. */
const shell = (cmd, output, exit = 0, tty = false) => [
  row({ type: 'function_call', name: 'exec_command', call_id: 's1', arguments: JSON.stringify({ cmd, ...(tty ? { tty: true } : {}) }) }),
  row({ type: 'function_call_output', call_id: 's1',
    output: `Chunk ID: 5f1e2a\nWall time: 0.1000 seconds\nProcess exited with code ${exit}\nOriginal token count: 40\nOutput:\n${output}` })];

let k = 0;
/** Every fragment of 8 characters or more of `secrets` in the clean ledger, the session and the review requests. */
function everywhere(clean, secrets) {
  const session = sessionFromLedger(clean, { sessionKey: `m33-r-repair-5-${++k}` });
  const requests = planWindowRequests({ session, reviewScope: 'session-only' }).requests
    .map(({ request }) => `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}`).join('\n');
  const surfaces = [JSON.stringify(clean), JSON.stringify(session.blobs), JSON.stringify(session.events), requests];
  return [...new Set(surfaces.flatMap((text) => leaks(text, secrets)))];
}

// ---- 1. the slicer's logical lines across `\` and a run of carriage returns ------------------------------------------

test('M33 R repair 5: the slicer\'s logical line joins across `\\` and any run of CR before its LF, as redaction does', () => {
  assert.equal(continuationBefore('a\\\r\r\nb', 5), 1, 'inside the join: its `\\`');
  assert.equal(continuationBefore('a\\\r\r\r\nb', 4), 1);
  assert.equal(continuationBefore('a\\\r\rb', 4), -1, 'a run of CR with no LF is not a line break');
  const text = 'one\r\r\nexport A=first\\\r\r\n   second\\\r\r\n\r\r\n  third\r\r\nfour';
  const at = (s) => text.indexOf(s);
  assert.equal(logicalLineStart(text, at('third')), at('export'));
  assert.equal(logicalLineEnd(text, text.indexOf('\n', at('export'))), text.indexOf('\n', at('third')));
  assert.equal(logicalLineEnd(text, text.indexOf('\n')), text.indexOf('\n'));
});

test('M33 R repair 5: a Write whose content holds a token continued across `\\` CR CR LF leaves no fragment, cut at every split', async () => {
  for (const split of [4, 12, 20, 36]) {
    const content = `#!/bin/sh\r\r\nexport API_TOKEN=${GHP.slice(0, split)}\\\r\r\n  ${GHP.slice(split)}\r\r\necho ok\r\r\n`;
    const { clean } = await sliced([userTurn('write it'), toolUse('w1', 'Write', { file_path: '/repo/run.sh', content }),
      toolResult('w1', 'File created successfully')]);
    assert.deepEqual(everywhere(clean, [GHP]), [], `split ${split}`);
  }
});

// ---- 1. a YAML secret block, and a continued value, behind CR CR LF --------------------------------------------------

const WORDS = ['correct-horse-battery-staple-lantern', 'quiet-meadow-orchard-violet-ember'];
const PASS = 'violetEmberOrchardRiver';
const ITEMS = {
  'a YAML secret block': [['region: eu', 'signing_key: |', ...WORDS.map((w) => `  ${w}`), 'replicas: 2'], WORDS],
  'a continued secret-named value': [['region: eu', 'export DB_PASSWORD=\\', `  ${PASS}`, 'replicas: 2'], [PASS]],
};
const numbered = (text) => text.split('\n').map((line, i) => `${String(i + 1).padStart(6)}\t${line}`).join('\n');

/** Every channel the hunt found the block in, as `(text, eol) => records` (Claude Code) or rollout rows (Codex). */
const CC = {
  'cat output': (t) => [userTurn('look'), toolUse('b1', 'Bash', { command: 'cat deploy.yaml' }), toolResult('b1', t)],
  'cat -n output': (t) => [userTurn('look'), toolUse('b1', 'Bash', { command: 'cat -n deploy.yaml' }), toolResult('b1', numbered(t))],
  'a failing command\'s output': (t) => [userTurn('deploy'), toolUse('b1', 'Bash', { command: 'kubectl apply -f deploy.yaml' }),
    toolResult('b1', `error: invalid manifest\n${t}`, { isError: true })],
  'a numbered Read, then an Edit': (t) => [userTurn('bump replicas'), toolUse('r1', 'Read', { file_path: '/repo/deploy.yaml' }),
    toolResult('r1', numbered(t)), toolUse('e1', 'Edit', { file_path: '/repo/deploy.yaml', old_string: 'replicas: 2', new_string: 'replicas: 3' }), updated('e1')],
  'an Edit\'s original file': (t) => [userTurn('bump replicas'),
    toolUse('e1', 'Edit', { file_path: '/repo/deploy.yaml', old_string: 'replicas: 2', new_string: 'replicas: 3' }),
    toolResult('e1', 'The file has been updated successfully.', { toolUseResult: { filePath: '/repo/deploy.yaml', originalFile: t, type: 'update' } })],
  'a Write': (t) => [userTurn('write it'), toolUse('w1', 'Write', { file_path: '/repo/deploy.yaml', content: t }), toolResult('w1', 'File created successfully')],
  'an Edit\'s new text': (t) => [userTurn('edit it'), toolUse('e1', 'Edit', { file_path: '/repo/deploy.yaml', old_string: 'x: 1', new_string: t }), updated('e1')],
  'an Edit\'s old text': (t) => [userTurn('edit it'), toolUse('e1', 'Edit', { file_path: '/repo/deploy.yaml', old_string: t, new_string: 'x: 1' }), updated('e1')],
  'a MultiEdit': (t) => [userTurn('edit it'), toolUse('m1', 'MultiEdit', { file_path: '/repo/deploy.yaml',
    edits: [{ old_string: 'x: 1', new_string: t }, { old_string: 'y: 1', new_string: 'y: 2' }] }), updated('m1')],
  'a heredoc command': (t, eol) => [userTurn('write it'), toolUse('b1', 'Bash', { command: `cat > deploy.yaml <<'EOF'${eol}${t}${eol}EOF` }), toolResult('b1', '')],
  'the ask': (t, eol) => [userTurn(`apply this config:${eol}${t}`), said('Done.')],
  'a saying and the claim': (t, eol) => [userTurn('go'), said(`I wrote:${eol}${t}`), toolUse('b1', 'Bash', { command: 'true' }), toolResult('b1', ''),
    said(`Final config:${eol}${t}`)],
};
const cr = (eol) => eol.slice(0, -1);
const CODEX = {
  'a Codex tty shell output': (t) => shell('cat deploy.yaml', t, 0, true),
  'a Codex failing shell output': (t) => shell('cat deploy.yaml && false', t, 1),
  'a Codex Add File': (t, eol) => direct(['*** Begin Patch', '*** Add File: deploy.yaml', ...t.split(eol).map((l) => `+${l}${cr(eol)}`),
    '*** End Patch'].join('\n')),
  'a Codex Update File': (t, eol) => direct(['*** Begin Patch', '*** Update File: deploy.yaml', '@@',
    ...t.split(eol).map((l) => `${l.startsWith('replicas') ? `-${l}${cr(eol)}\n+replicas: 3` : ` ${l}`}${cr(eol)}`), '*** End Patch'].join('\n')),
  'a Codex native unified diff': (t, eol) => native('deploy.yaml', `${['@@ -1,5 +1,5 @@',
    ...t.split(eol).map((l) => (l.startsWith('replicas') ? `-${l}${cr(eol)}\n+replicas: 3` : ` ${l}`) + cr(eol))].join('\n')}\n`),
};

for (const [eolName, eol] of [['CR CR LF', '\r\r\n'], ['CR CR CR LF', '\r\r\r\n']]) {
  for (const [item, [lines, secrets]] of Object.entries(ITEMS)) {
    const text = lines.join(eol);
    for (const [channel, build] of Object.entries(CC)) {
      test(`M33 R repair 5: ${item} in ${eolName} text leaves nothing of its value: ${channel}`, async () => {
        const { raw, clean } = await sliced(build(text, eol));
        assert.ok(leaks(JSON.stringify(raw), secrets).length > 0, 'premise: the raw ledger holds it');
        assert.deepEqual(everywhere(clean, secrets), []);
      });
    }
    for (const [channel, build] of Object.entries(CODEX)) {
      test(`M33 R repair 5: ${item} in ${eolName} text leaves nothing of its value: ${channel}`, async () => {
        const { raw, clean } = await codexSliced(build(text, eol));
        assert.ok(leaks(JSON.stringify(raw), secrets).length > 0, 'premise: the raw ledger holds it');
        assert.deepEqual(everywhere(clean, secrets), []);
      });
    }
  }
}

test('M33 R repair 5: the hunt\'s pseudo-terminal capture keeps every clean line and masks the block where it stands', async () => {
  const text = ['region: eu', 'signing_key: |', ...WORDS.map((w) => `  ${w}`), 'replicas: 2', ''].join('\r\r\n');
  const { clean } = await codexSliced(shell('cat deploy/values.yaml', text, 0, true));
  const tail = clean.ledger.find((e) => Array.isArray(e.tailLines)).tailLines;
  assert.deepEqual(tail.slice(-6), ['region: eu\r\r', 'signing_key: |\r\r', '  ‹redacted:secret-value›\r\r', '  ‹redacted:secret-value›\r\r',
    'replicas: 2\r\r', '']);
});

// ---- 2. Claude Code's Grep tool behind a path with a blank -----------------------------------------------------------

test('M33 R repair 5: Grep tool and rg output behind a path with a blank leave no line of a block, in Claude Code and Codex', async () => {
  const lines = ['region: eu', 'signing_key: |', ...WORDS.map((w) => `  ${w}`), 'replicas: 2'];
  const outputOf = (root) => lines.map((l, i) => `${root}/values.yaml${i === 1 ? ':' : '-'}${i + 11}${i === 1 ? ':' : '-'}${l}`).join('\n');
  // Under the session's working directory (`/repo`): a Grep of a path outside it is withheld, not recorded.
  for (const root of ['/repo/Acme Labs/deploy', '/repo/my deploy']) {
    const { raw, clean } = await sliced([userTurn('find the signing key config'),
      toolUse('g1', 'Grep', { pattern: 'signing_key', path: root, output_mode: 'content', '-n': true, '-A': 4 }), toolResult('g1', outputOf(root))]);
    assert.ok(leaks(JSON.stringify(raw.ledger.map((e) => e.tailLines)), WORDS).length > 0, `premise: ${root}: its output lines are recorded`);
    assert.deepEqual(everywhere(clean, WORDS), [], `Claude Code: ${root}`);
  }
  for (const root of ['/srv/Acme Labs/proj/deploy', 'C:\\repo\\proj']) {
    const { clean: cx } = await codexSliced(shell(`rg -n -A4 signing_key "${root}"`, outputOf(root)));
    assert.deepEqual(everywhere(cx, WORDS), [], `Codex: ${root}`);
  }
});

test('M33 R repair 5: the ledger these repairs change is still deterministic: the same bytes and slice hash twice', async () => {
  const yaml = ['region: eu', 'signing_key: |', ...WORDS.map((w) => `  ${w}`), 'replicas: 2'];
  const build = () => [userTurn(`apply:\r\r\n${yaml.join('\r\r\n')}`),
    toolUse('b1', 'Bash', { command: 'cat deploy.yaml' }), toolResult('b1', yaml.join('\r\r\n')),
    toolUse('g1', 'Grep', { pattern: 'signing_key', path: '/repo/Acme Labs', output_mode: 'content', '-n': true, '-A': 4 }),
    toolResult('g1', yaml.map((l, i) => `/repo/Acme Labs/values.yaml${i === 1 ? ':' : '-'}${i + 1}${i === 1 ? ':' : '-'}${l}`).join('\n')),
    toolUse('w1', 'Write', { file_path: '/repo/run.sh', content: `export DB_PASSWORD=\\\r\r\n  ${PASS}\r\r\n` }), toolResult('w1', 'File created successfully')];
  // C-01 event identity: one recording (its rows' uuids are recorded now), sliced twice.
  const rows = build();
  const one = await sliced(rows);
  const two = await sliced(rows);
  assert.equal(JSON.stringify(one.clean), JSON.stringify(two.clean));
  assert.equal(sliceHash(one.clean), sliceHash(two.clean));
  assert.deepEqual(everywhere(one.clean, [...WORDS, PASS]), []);
});
