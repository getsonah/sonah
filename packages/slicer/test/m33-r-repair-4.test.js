// M33 R repair 4. The fourth leak hunt's findings, end to end: a synthetic Claude Code recording or Codex
// rollout, sliced, redacted, then turned into the session the reviewer reads and the review requests built from it.
// Nothing of the secret may reach any of them.
//
// 1. A random URL path secret after a whole UUID (`…/services/<uuid>/<random>`) reached the ask, the command, the
//    output and the review prompt: the UUID rule judged the piece behind the UUID alone. It is judged with its
//    neighbours now (redact/index.js `uuidReadingsFail`).
// 2. A YAML secret block in CRLF text was never recognised, in any channel: its key line ends in `\r`.
// 3. `grep -n`, `rg -n` and `N→` numbered output kept a block's body in `tailLines`.
// 4. A JSON-escaped continuation in a JSON file's body, its printed text or a saying kept the value it continues.
//
// Synthetic recordings only: every byte is invented. No recording is read, no model is called, no network is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceHash } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { planWindowRequests } from '../../evidence/src/run-review.js';
import { userTurn, said, toolUse, toolResult, sliced } from './m33-r-redact-cut-fixture.js';
import { codexSliced, direct, native, leaks } from './m33-r-codex-patch-fixture.js';

const updated = (id) => toolResult(id, 'The file has been updated successfully.');
const row = (payload) => JSON.stringify({ type: 'response_item', payload });
/** A Codex `exec_command` and its output, exiting `exit`. */
const shell = (cmd, output, exit = 0) => [
  row({ type: 'function_call', name: 'exec_command', call_id: 's1', arguments: JSON.stringify({ cmd }) }),
  row({ type: 'function_call_output', call_id: 's1',
    output: `Chunk ID: 5f1e2a\nWall time: 0.5000 seconds\nProcess exited with code ${exit}\nOriginal token count: 2\nOutput:\n${output}` })];

let k = 0;
/** Every fragment of 8 characters or more of `secrets` in the clean ledger, the session and the review requests. */
function everywhere(clean, secrets) {
  const session = sessionFromLedger(clean, { sessionKey: `m33-r-repair-4-${++k}` });
  const requests = planWindowRequests({ session, reviewScope: 'session-only' }).requests
    .map(({ request }) => `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}`).join('\n');
  const surfaces = [JSON.stringify(clean), JSON.stringify(session.blobs), JSON.stringify(session.events), requests];
  return [...new Set(surfaces.flatMap((text) => leaks(text, secrets)))];
}

// ---- 1. a random path secret after a whole UUID ----------------------------------------------------------------------

const UUID = '3f2b8c1e-9a4d-4e7b-a1c2-7d9e0f1a2b3c';
const HOOK_SECRET = 'Qm7Xv2Lp9Rt4Wz8Kd3Fh6Nb1Jc5Gs0Ty';   // 32 invented characters

test('M33 R repair 4: a URL secret after a UUID reaches no ask, command, output, body, session or review request', async () => {
  for (const url of [`https://hooks.example.test/services/${HOOK_SECRET}`, `https://hooks.example.test/services/${UUID}/${HOOK_SECRET}`]) {
    const { raw, clean } = await sliced([userTurn(`post the build status to ${url} when done`),
      toolUse('b1', 'Bash', { command: `curl -s -X POST ${url} -d @status.json` }), toolResult('b1', `POST ${url}\n200 OK`),
      toolUse('w1', 'Write', { file_path: '/repo/hooks.txt', content: `status: ${url}\n` }), toolResult('w1', 'File created successfully'),
      said(`Posted to ${url}.`)]);
    assert.ok(leaks(JSON.stringify(raw), [HOOK_SECRET]).length > 0, 'premise: the raw ledger holds it');
    assert.deepEqual(everywhere(clean, [HOOK_SECRET]), [], url);
  }
});

test('M33 R repair 4: a command whose only high-entropy part is a UUID path is still kept whole', async () => {
  const cmd = `node /private/tmp/claude-501/-Users-dev-Code-proj/${UUID}/scratchpad/check.mjs`;
  const { clean } = await sliced([userTurn('check it'), toolUse('b1', 'Bash', { command: cmd }), toolResult('b1', 'ok')]);
  assert.equal(clean.ledger.find((e) => e.kind === 'bash').cmd, cmd);
});

// ---- 2. a YAML secret block in CRLF text -----------------------------------------------------------------------------

const WORDS = ['correct-horse-battery-staple-lantern', 'quiet-meadow-orchard-violet-ember'];
const yamlLines = ['region: eu', 'signing_key: |', ...WORDS.map((w) => `  ${w}`), 'replicas: 2'];
const numbered = (text) => text.split('\n').map((line, i) => `${String(i + 1).padStart(6)}\t${line}`).join('\n');

/** Every channel the hunt found the CRLF block in, as `(text, eol) => records` (Claude Code) or rollout rows (Codex). */
const CC = {
  'cat output': (t) => [userTurn('look'), toolUse('b1', 'Bash', { command: 'cat deploy.yaml' }), toolResult('b1', t)],
  'cat -n output': (t) => [userTurn('look'), toolUse('b1', 'Bash', { command: 'cat -n deploy.yaml' }), toolResult('b1', numbered(t))],
  'git diff output': (t, eol) => [userTurn('look'), toolUse('b1', 'Bash', { command: 'git diff deploy.yaml' }),
    toolResult('b1', ['diff --git a/deploy.yaml b/deploy.yaml', '@@ -1,5 +1,5 @@', ...t.split(eol).map((l) => (l.startsWith('replicas')
      ? `-${l}${eol}+replicas: 3` : ` ${l}${eol === '\r\n' ? '\r' : ''}`))].join('\n'))],
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
  'a NotebookEdit': (t) => [userTurn('edit it'), toolUse('n1', 'NotebookEdit', { notebook_path: '/repo/n.ipynb', new_source: t }), updated('n1')],
  'a heredoc command': (t, eol) => [userTurn('write it'), toolUse('b1', 'Bash', { command: `cat > deploy.yaml <<'EOF'${eol}${t}${eol}EOF` }), toolResult('b1', '')],
  'the ask': (t, eol) => [userTurn(`apply this config:${eol}${t}`), said('Done.')],
  'a saying and the claim': (t, eol) => [userTurn('go'), said(`I wrote:${eol}${t}`), toolUse('b1', 'Bash', { command: 'true' }), toolResult('b1', ''),
    said(`Final config:${eol}${t}`)],
};
const CODEX = {
  'a Codex shell output': (t) => shell('cat deploy.yaml', t),
  'a Codex failing shell output': (t) => shell('cat deploy.yaml && false', t, 1),
  'a Codex Add File': (t, eol) => direct(['*** Begin Patch', '*** Add File: deploy.yaml', ...t.split(eol).map((l) => `+${l}${eol === '\r\n' ? '\r' : ''}`),
    '*** End Patch'].join('\n')),
  'a Codex Update File': (t, eol) => direct(['*** Begin Patch', '*** Update File: deploy.yaml', '@@',
    ...t.split(eol).map((l) => `${l.startsWith('replicas') ? `-${l}${eol === '\r\n' ? '\r' : ''}\n+replicas: 3` : ` ${l}`}${eol === '\r\n' ? '\r' : ''}`),
    '*** End Patch'].join('\n')),
  'a Codex native unified diff': (t, eol) => native('deploy.yaml', `${['@@ -1,5 +1,5 @@',
    ...t.split(eol).map((l) => (l.startsWith('replicas') ? `-${l}${eol === '\r\n' ? '\r' : ''}\n+replicas: 3` : ` ${l}`) + (eol === '\r\n' ? '\r' : ''))].join('\n')}\n`),
};

for (const eol of ['\n', '\r\n']) {
  const name = eol === '\n' ? 'LF' : 'CRLF';
  const text = yamlLines.join(eol);
  for (const [channel, build] of Object.entries(CC)) {
    test(`M33 R repair 4: a ${name} YAML secret block leaves no line of its body: ${channel}`, async () => {
      const { raw, clean } = await sliced(build(text, eol));
      assert.ok(leaks(JSON.stringify(raw), WORDS).length > 0, 'premise: the raw ledger holds the body');
      assert.deepEqual(everywhere(clean, WORDS), []);
    });
  }
  for (const [channel, build] of Object.entries(CODEX)) {
    test(`M33 R repair 4: a ${name} YAML secret block leaves no line of its body: ${channel}`, async () => {
      const { raw, clean } = await codexSliced(build(text, eol));
      assert.ok(leaks(JSON.stringify(raw), WORDS).length > 0, 'premise: the raw ledger holds the body');
      assert.deepEqual(everywhere(clean, WORDS), []);
    });
  }
}

// ---- 3. other line-number shapes in a command's output ---------------------------------------------------------------

test('M33 R repair 4: grep -n, rg -n and arrow-numbered output leave no line of a block, in Claude Code and Codex', async () => {
  const shapes = {
    'grep -n -A3': (n, l) => `${n}${n === 2 ? ':' : '-'}${l}`,
    'rg -n -A3': (n, l) => `config/deploy.yaml${n === 2 ? ':' : '-'}${n}${n === 2 ? ':' : '-'}${l}`,
    arrow: (n, l) => `${String(n).padStart(6)}→${l}`,
  };
  for (const [shape, format] of Object.entries(shapes)) {
    const output = yamlLines.map((l, i) => format(i + 1, l)).join('\n');
    const { clean } = await sliced([userTurn('look'), toolUse('b1', 'Bash', { command: `${shape} signing_key deploy.yaml` }), toolResult('b1', output)]);
    assert.deepEqual(everywhere(clean, WORDS), [], `Claude Code: ${shape}`);
    const tail = clean.ledger.find((e) => e.kind === 'bash').tailLines;
    assert.equal(tail[0], format(1, 'region: eu'), `${shape}: a clean line keeps its bytes`);
    const { clean: cx } = await codexSliced(shell(`${shape} signing_key deploy.yaml`, output));
    assert.deepEqual(everywhere(cx, WORDS), [], `Codex: ${shape}`);
  }
});

// ---- 4. JSON-escaped continuations in bodies, output and sayings -----------------------------------------------------

const PASS = 'violetEmberOrchardRiver';
const packageJson = (eol) => JSON.stringify({ name: 'app', scripts: { deploy: `export DB_PASSWORD=\\${eol}  ${PASS} && ./deploy.sh` } }, null, 2);

test('M33 R repair 4: a JSON file\'s escaped continuation keeps no value, in every channel that carries the file', async () => {
  for (const eol of ['\n', '\r\n']) {
    const file = packageJson(eol);
    const records = {
      'a Write': [userTurn('write it'), toolUse('w1', 'Write', { file_path: '/repo/package.json', content: file }), toolResult('w1', 'File created successfully')],
      'an Edit': [userTurn('edit it'), toolUse('e1', 'Edit', { file_path: '/repo/package.json', old_string: '{}', new_string: file }), updated('e1')],
      'a MultiEdit': [userTurn('edit it'), toolUse('m1', 'MultiEdit', { file_path: '/repo/package.json', edits: [{ old_string: '{}', new_string: file }] }), updated('m1')],
      'cat output': [userTurn('look'), toolUse('b1', 'Bash', { command: 'cat package.json' }), toolResult('b1', file)],
      'a numbered Read, then an Edit': [userTurn('look'), toolUse('r1', 'Read', { file_path: '/repo/package.json' }), toolResult('r1', numbered(file)),
        toolUse('e1', 'Edit', { file_path: '/repo/package.json', old_string: '"app"', new_string: '"web"' }), updated('e1')],
      'a saying': [userTurn('go'), said(`I set ${JSON.stringify({ deploy: `export DB_PASSWORD=\\${eol}  ${PASS}` })}`)],
    };
    for (const [channel, recs] of Object.entries(records)) {
      const { raw, clean } = await sliced(recs);
      assert.ok(leaks(JSON.stringify(raw), [PASS]).length > 0, `premise: ${channel}`);
      assert.deepEqual(everywhere(clean, [PASS]), [], `${JSON.stringify(eol)}: ${channel}`);
    }
    const add = ['*** Begin Patch', '*** Add File: package.json', ...file.split('\n').map((l) => `+${l}`), '*** End Patch'].join('\n');
    for (const [channel, rows] of Object.entries({ 'a Codex Add File': direct(add), 'a Codex shell output': shell('cat package.json', file) })) {
      const { clean } = await codexSliced(rows);
      assert.deepEqual(everywhere(clean, [PASS]), [], `${JSON.stringify(eol)}: ${channel}`);
    }
  }
});

test('M33 R repair 4: the ledger these repairs change is still deterministic: the same bytes and slice hash twice', async () => {
  const build = () => [userTurn(`post to https://hooks.example.test/services/${UUID}/${HOOK_SECRET}`),
    toolUse('b1', 'Bash', { command: 'cat deploy.yaml' }), toolResult('b1', yamlLines.join('\r\n')),
    toolUse('b2', 'Bash', { command: 'grep -n -A3 signing_key deploy.yaml' }), toolResult('b2', yamlLines.map((l, i) => `${i + 1}${i === 1 ? ':' : '-'}${l}`).join('\n')),
    toolUse('w1', 'Write', { file_path: '/repo/package.json', content: packageJson('\r\n') }), toolResult('w1', 'File created successfully')];
  // C-01 event identity: one recording (its rows' uuids are recorded now), sliced twice.
  const rows = build();
  const one = await sliced(rows);
  const two = await sliced(rows);
  assert.equal(JSON.stringify(one.clean), JSON.stringify(two.clean));
  assert.equal(sliceHash(one.clean), sliceHash(two.clean));
  assert.deepEqual(everywhere(one.clean, [HOOK_SECRET, ...WORDS, PASS]), []);
});
