// M33 R repair 7, end to end. A line of the shape `recall api key: <40 lowercase hex>` survived redaction into the
// ledger, the session and 30 review requests: the label is three words, which no key-name shape read, and the hex
// value passed the entropy backstop. Here a synthetic Claude Code recording and a synthetic Codex rollout carry that
// line, and its family, through every channel a recording can put it in; each is sliced, redacted, then turned into the
// session the reviewer reads and the review requests built from it. Nothing of the value may reach any of them, and the
// label around it stays readable.
//
// Synthetic recordings only: every value is a digest of a fixed phrase. No recording is read, no model is called, no
// network is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { redact, sliceHash } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { planWindowRequests } from '../../evidence/src/run-review.js';
import { userTurn, said, toolUse, toolResult, sliced } from './m33-r-redact-cut-fixture.js';
import { codexSliced, direct, native, leaks } from './m33-r-codex-patch-fixture.js';
import { rootMeta, ask as codexAsk, said as codexSaid, call, output, spawn, finalAnswer, jsonl }
  from '../../evidence/test/m33-f-final-answer-fixture.js';

const digest = (alg, enc, phrase) => createHash(alg).update(`m33 r repair 7 e2e synthetic: ${phrase}`).digest(enc);
const HEX40 = digest('sha1', 'hex', 'the leaked shape');
const B64 = digest('sha256', 'base64', 'base64 value');
const SHORT = digest('sha512', 'base64', 'short').replace(/[+/=]/g, '').slice(0, 12);

/** The leaked line, and its family: each label and value shape the hunt names. */
const LINES = {
  'the leaked line': [`recall api key: ${HEX40}`, HEX40],
  'a product name and an API key': [`OpenAI API key = ${B64}`, B64],
  'a possessive and a token': [`my github token is ${SHORT}`, SHORT],
  'markdown': [`**stripe secret key**: \`${HEX40}\``, HEX40],
};

let k = 0;
/** Every fragment of 8 characters or more of `secrets` (6 for a short one) in the clean ledger, the session and the
 *  review requests. */
function everywhere(clean, secrets) {
  const session = sessionFromLedger(clean, { sessionKey: `m33-r-repair-7-${++k}` });
  const requests = planWindowRequests({ session, reviewScope: 'session-only' }).requests
    .map(({ request }) => `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}`).join('\n');
  const surfaces = [JSON.stringify(clean), JSON.stringify(session.blobs), JSON.stringify(session.events), requests];
  const grams = (s) => (s.length >= 16 ? [s] : []);
  const short = secrets.filter((s) => s.length < 16);
  const shortLeaks = (text) => short.flatMap((s) => Array.from({ length: s.length - 5 }, (_, i) => s.slice(i, i + 6)).filter((g) => text.includes(g)));
  return [...new Set(surfaces.flatMap((text) => [...leaks(text, secrets.flatMap(grams)), ...shortLeaks(text)]))];
}

const updated = (id) => toolResult(id, 'The file has been updated successfully.');
const numbered = (text) => text.split('\n').map((line, i) => `${String(i + 1).padStart(6)}\t${line}`).join('\n');

/** Every Claude Code channel, as `(line) => records`. */
const CC = {
  'the ask': (l) => [userTurn(`Use my ${l} for the sync job, then rotate it.`), said('Done.')],
  'a saying and the claim': (l) => [userTurn('go'), said(`I used ${l} for the sync.`), toolUse('b1', 'Bash', { command: 'true' }),
    toolResult('b1', ''), said(`Synced with ${l}.`)],
  'a command': (l) => [userTurn('save it'), toolUse('b1', 'Bash', { command: `echo "${l}" >> notes.txt` }), toolResult('b1', '')],
  'a command\'s output': (l) => [userTurn('look'), toolUse('b1', 'Bash', { command: 'cat notes.txt' }),
    toolResult('b1', `# sync notes\n${l}\nregion: eu`)],
  'a failing command\'s first error line': (l) => [userTurn('sync'), toolUse('b1', 'Bash', { command: 'node sync.js' }),
    toolResult('b1', `Error: rejected ${l}\n    at sync.js:4`, { isError: true })],
  'a numbered Read, then an Edit': (l) => [userTurn('fix it'), toolUse('r1', 'Read', { file_path: '/repo/notes.md' }),
    toolResult('r1', numbered(`# notes\n${l}\nregion: eu`)),
    toolUse('e1', 'Edit', { file_path: '/repo/notes.md', old_string: 'region: eu', new_string: 'region: us' }), updated('e1')],
  'an Edit\'s original file': (l) => [userTurn('fix it'),
    toolUse('e1', 'Edit', { file_path: '/repo/notes.md', old_string: 'region: eu', new_string: 'region: us' }),
    toolResult('e1', 'The file has been updated successfully.', { toolUseResult: { filePath: '/repo/notes.md',
      originalFile: `# notes\n${l}\nregion: eu\n`, type: 'update' } })],
  'a Write': (l) => [userTurn('write it'), toolUse('w1', 'Write', { file_path: '/repo/notes.md', content: `# notes\n${l}\n` }),
    toolResult('w1', 'File created successfully')],
  'an Edit\'s new text': (l) => [userTurn('edit it'), toolUse('e1', 'Edit', { file_path: '/repo/notes.md', old_string: 'x: 1', new_string: l }), updated('e1')],
  'an Edit\'s old text': (l) => [userTurn('edit it'), toolUse('e1', 'Edit', { file_path: '/repo/notes.md', old_string: l, new_string: 'x: 1' }), updated('e1')],
  'a MultiEdit': (l) => [userTurn('edit it'), toolUse('m1', 'MultiEdit', { file_path: '/repo/notes.md',
    edits: [{ old_string: 'x: 1', new_string: l }, { old_string: 'y: 1', new_string: 'y: 2' }] }), updated('m1')],
  'a delegation brief and its report': (l) => [userTurn('delegate it'),
    toolUse('t1', 'Agent', { description: 'sync', subagent_type: 'general-purpose', prompt: `Sync the notes. Use the ${l} once.` }),
    toolResult('t1', `Synced. I used the ${l} and nothing else.`)],
};

/** Every Codex channel, as `(line) => rows` after the rollout's own meta and ask (`codexSliced`). */
const item = (payload) => JSON.stringify({ type: 'response_item', payload });
const shell = (cmd, out, exit = 0) => [
  item({ type: 'function_call', name: 'exec_command', call_id: 's1', arguments: JSON.stringify({ cmd }) }),
  item({ type: 'function_call_output', call_id: 's1',
    output: `Chunk ID: 5f1e2a\nWall time: 0.1000 seconds\nProcess exited with code ${exit}\nOriginal token count: 40\nOutput:\n${out}` })];
const CODEX = {
  'a Codex ask': (l) => [item({ type: 'message', role: 'user', content: `Use my ${l} for the sync job.` })],
  'a Codex agent message': (l) => [item({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `I used ${l}.` }] })],
  'a Codex command': (l) => shell(`echo "${l}" >> notes.txt`, ''),
  'a Codex command\'s output': (l) => shell('cat notes.txt', `# sync notes\n${l}\nregion: eu`),
  'a Codex failing command': (l) => shell('node sync.js', `Error: rejected ${l}`, 1),
  'a Codex Add File': (l) => direct(['*** Begin Patch', '*** Add File: notes.md', '+# notes', `+${l}`, '*** End Patch'].join('\n')),
  'a Codex Update File': (l) => direct(['*** Begin Patch', '*** Update File: notes.md', '@@', ' # notes', `-${l}`, '+rotated: yes',
    '*** End Patch'].join('\n')),
  'a Codex native unified diff': (l) => native('notes.md', `@@ -1,2 +1,2 @@\n # notes\n+${l}\n-old\n`),
};

for (const [what, [line, value]] of Object.entries(LINES)) {
  for (const [channel, build] of Object.entries(CC)) {
    test(`M33 R repair 7: ${what} leaves nothing of its value: Claude Code ${channel}`, async () => {
      const { raw, clean } = await sliced(build(line));
      assert.ok(JSON.stringify(raw).includes(value), 'premise: the raw ledger holds it');
      assert.deepEqual(everywhere(clean, [value]), []);
    });
  }
  for (const [channel, build] of Object.entries(CODEX)) {
    test(`M33 R repair 7: ${what} leaves nothing of its value: ${channel}`, async () => {
      const { raw, clean } = await codexSliced(build(line));
      assert.ok(JSON.stringify(raw).includes(value), 'premise: the raw ledger holds it');
      assert.deepEqual(everywhere(clean, [value]), []);
    });
  }
}

test('M33 R repair 7: a Codex helper\'s brief and its final report leave nothing of the value', async () => {
  for (const [line, value] of Object.values(LINES)) {
    const rows = [rootMeta(), codexAsk('Split the sync between helpers.'), codexSaid('Handing it over.'),
      ...spawn('spawn-sync', 'sync_notes', `Sync the notes. Use the ${line} once.`),
      finalAnswer('/root/sync_notes', `Synced. I used the ${line} and nothing else.`),
      call('exec_command', 'cmd-1', { cmd: 'npm test' }), output('cmd-1', 'Process exited with code 0\nOutput:\nok'),
      codexSaid('Done.')];
    const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-r7-f-'));
    const file = join(dir, 'rollout-2026-10-01T12-00-00-m33r7f.jsonl');
    await writeFile(file, jsonl(rows));
    try {
      const raw = await sliceLineage([file]);
      assert.ok(JSON.stringify(raw).includes(value), 'premise: the raw ledger holds it');
      const report = raw.delegations.find((d) => d.finalAnswer)?.finalAnswer?.text ?? '';
      assert.ok(report.includes(value), 'premise: the report is attached to its hand-off');
      const clean = redact(structuredClone(raw)).ledger;
      assert.deepEqual(everywhere(clean, [value]), [], line);
      assert.ok(clean.delegations.find((d) => d.finalAnswer).finalAnswer.text.includes('‹redacted:secret-value›'), 'masked where it stands');
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test('M33 R repair 7: the label stays readable where the value is masked, and the ledger is deterministic', async () => {
  const build = () => [userTurn(`Use my recall api key: ${HEX40} for the sync job.`), toolUse('b1', 'Bash', { command: 'cat notes.txt' }),
    toolResult('b1', `recall api key: ${HEX40}`), said('The api key: see the docs. Done.')];
  // C-01 event identity: one recording (its rows' uuids are recorded now), sliced twice.
  const rows = build();
  const one = await sliced(rows);
  const two = await sliced(rows);
  assert.equal(JSON.stringify(one.clean), JSON.stringify(two.clean));
  assert.equal(sliceHash(one.clean), sliceHash(two.clean));
  assert.equal(one.clean.ask[0].text, 'Use my recall api key: ‹redacted:secret-value› for the sync job.');
  assert.deepEqual(one.clean.ledger.find((e) => Array.isArray(e.tailLines)).tailLines, ['recall api key: ‹redacted:secret-value›']);
  assert.equal(one.clean.claim.finalMessage, 'The api key: see the docs. Done.', 'prose after a label is kept');
});
