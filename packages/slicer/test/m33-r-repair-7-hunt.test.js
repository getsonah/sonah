// M33 R repair 7's leak hunt, end to end. Each family the hunt found still leaking after repair 7 — and repair 7's own
// two controls — is carried by a synthetic Claude Code recording and a synthetic Codex rollout through every channel a
// recording can put a line in; each is sliced, redacted, and turned into the session the reviewer reads and the review
// requests built from it. Nothing of the value may reach any of them.
//
// Synthetic recordings only: every value is a digest of a fixed phrase. No recording is read, no model is called, no
// network is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sliceHash } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { planWindowRequests } from '../../evidence/src/run-review.js';
import { userTurn, said, toolUse, toolResult, sliced } from './m33-r-redact-cut-fixture.js';
import { codexSliced, direct, native } from './m33-r-codex-patch-fixture.js';

const digest = (alg, enc, phrase) => createHash(alg).update(`m33 r repair 7 hunt e2e synthetic: ${phrase}`).digest(enc);
const mixed = (s) => (/\d/.test(s) && /[A-Za-z]/.test(s) ? s : `${s.slice(0, -2)}7q`);
const HEX40 = mixed(digest('sha1', 'hex', 'hex40'));
const HEX32 = mixed(digest('md5', 'hex', 'hex32'));
const B64 = digest('sha256', 'base64', 'base64');
const SHORT = mixed(digest('sha512', 'base64', 'short').replace(/[+/=]/g, '').slice(0, 12));
const PASSPHRASE = 'velvet orchid tundra marble';

/** Repair 7's controls and one line per family the hunt found leaking: `[line, value]`. */
const LINES = {
  'control: the leaked shape': [`recall api key: ${HEX40}`, HEX40],
  'control: OpenAI API key =': [`OpenAI API key = ${B64}`, B64],
  'a passphrase after a password-family label': [`wifi passphrase: ${PASSPHRASE}`, PASSPHRASE],
  'a word before the value': [`recall api key: new one ${HEX40}`, HEX40],
  'a second value on the line': [`recall api keys: ${HEX32} and ${HEX40}`, HEX40],
  '`key` behind a product name': [`recall key: ${HEX40}`, HEX40],
  'a one-word markdown label': [`**Token**: \`${HEX40}\``, HEX40],
  'a username and password pair': [`Username: admin, Password: ${SHORT}`, SHORT],
  'a verb separator (set … to)': [`Please set the recall api key to ${HEX40}`, HEX40],
  'a past tense (was)': [`my recall api key was ${HEX40}`, HEX40],
  'a qualifier after the phrase': [`recall api key value: ${HEX40}`, HEX40],
  'a unicode arrow': [`recall api key → ${HEX40}`, HEX40],
  'an em dash': [`recall api key — ${HEX40}`, HEX40],
  'a markdown table': [`| Name | Value |\n| --- | --- |\n| recall api key | ${HEX40} |`, HEX40],
  'the value on the next line': [`Here is my recall api key:\n${HEX40}`, HEX40],
  'the value before its label': [`${HEX40} is my recall api key`, HEX40],
  'a Kubernetes name/value pair': [`env:\n  - name: RECALL_API_KEY\n    value: ${HEX40}`, HEX40],
  'gh secret set --body': [`gh secret set RECALL_API_KEY --body ${HEX40}`, HEX40],
  'an escaped tab after the colon': [`{"notes":"recall api key:\\t${HEX40}"}`, HEX40],
};

let k = 0;
/** Every fragment of `value` (8 characters, 6 for a short one; each word of a passphrase) on every surface built from
 *  the clean ledger: the ledger itself (`slice_hash`'s input), the session and the review requests. */
function everywhere(clean, value) {
  const session = sessionFromLedger(clean, { sessionKey: `m33-r-repair-7-hunt-${++k}` });
  const requests = planWindowRequests({ session, reviewScope: 'session-only' }).requests
    .map(({ request }) => `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}`).join('\n');
  sliceHash(clean);
  const surfaces = { ledger: JSON.stringify(clean), session: JSON.stringify(session.blobs) + JSON.stringify(session.events),
    requests };
  const grams = value.includes(' ') ? value.split(' ')
    : Array.from({ length: value.length - (value.length >= 16 ? 7 : 5) }, (_, i) => value.slice(i, i + (value.length >= 16 ? 8 : 6)));
  return Object.entries(surfaces).filter(([, text]) => grams.some((g) => text.includes(g))).map(([name]) => name);
}

const updated = (id) => toolResult(id, 'The file has been updated successfully.');
const numbered = (text) => text.split('\n').map((line, i) => `${String(i + 1).padStart(6)}\t${line}`).join('\n');
/** Every Claude Code channel, as `(line) => records`. */
const CC = {
  'the ask': (l) => [userTurn(`Use this for the sync job, then rotate it.\n${l}\nThanks.`), said('Done.')],
  'a saying and the claim': (l) => [userTurn('go'), said(`Noted.\n${l}`), toolUse('b1', 'Bash', { command: 'true' }), toolResult('b1', ''),
    said(`Synced.\n${l}`)],
  'a command (a heredoc)': (l) => [userTurn('save it'), toolUse('b1', 'Bash', { command: `cat >> notes.txt <<'EOF'\n${l}\nEOF` }), toolResult('b1', '')],
  "a command's output": (l) => [userTurn('look'), toolUse('b1', 'Bash', { command: 'cat notes.txt' }), toolResult('b1', `# sync notes\n${l}\nregion: eu`)],
  'a first error line': (l) => [userTurn('sync'), toolUse('b1', 'Bash', { command: 'node sync.js' }),
    toolResult('b1', `Error: rejected ${l.split('\n')[0]}\n${l}\n    at sync.js:4`, { isError: true })],
  'a numbered Read, then an Edit': (l) => [userTurn('fix it'), toolUse('r1', 'Read', { file_path: '/repo/notes.md' }),
    toolResult('r1', numbered(`# notes\n${l}\nregion: eu`)),
    toolUse('e1', 'Edit', { file_path: '/repo/notes.md', old_string: 'region: eu', new_string: 'region: us' }), updated('e1')],
  'a Write': (l) => [userTurn('write it'), toolUse('w1', 'Write', { file_path: '/repo/notes.md', content: `# notes\n${l}\n` }),
    toolResult('w1', 'File created successfully')],
  "an Edit's new text": (l) => [userTurn('edit it'), toolUse('e1', 'Edit', { file_path: '/repo/notes.md', old_string: 'x: 1', new_string: l }), updated('e1')],
  'a MultiEdit': (l) => [userTurn('edit it'), toolUse('m1', 'MultiEdit', { file_path: '/repo/notes.md',
    edits: [{ old_string: 'x: 1', new_string: l }, { old_string: 'y: 1', new_string: 'y: 2' }] }), updated('m1')],
  'a delegation brief and its report': (l) => [userTurn('delegate it'),
    toolUse('t1', 'Agent', { description: 'sync', subagent_type: 'general-purpose', prompt: `Sync the notes.\n${l}` }), toolResult('t1', `Synced.\n${l}`)],
  "a generic tool's arguments": (l) => [userTurn('store it'), toolUse('g1', 'mcp__vault__put', { name: 'recall', note: l }), toolResult('g1', 'ok')],
};
const item = (payload) => JSON.stringify({ type: 'response_item', payload });
const shell = (cmd, out, exit = 0) => [
  item({ type: 'function_call', name: 'exec_command', call_id: 's1', arguments: JSON.stringify({ cmd }) }),
  item({ type: 'function_call_output', call_id: 's1',
    output: `Chunk ID: 5f1e2a\nWall time: 0.1000 seconds\nProcess exited with code ${exit}\nOriginal token count: 40\nOutput:\n${out}` })];
/** Every Codex channel, as `(line) => rows` after the rollout's own meta and ask (`codexSliced`). */
const CODEX = {
  'a Codex ask': (l) => [item({ type: 'message', role: 'user', content: `Use this for the sync job.\n${l}` })],
  'a Codex agent message': (l) => [item({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Noted.\n${l}` }] })],
  'a Codex command (a heredoc)': (l) => shell(`cat >> notes.txt <<'EOF'\n${l}\nEOF`, ''),
  "a Codex command's output": (l) => shell('cat notes.txt', `# sync notes\n${l}\nregion: eu`),
  'a Codex failing command': (l) => shell('node sync.js', `Error: rejected\n${l}`, 1),
  'a Codex Add File': (l) => direct(['*** Begin Patch', '*** Add File: notes.md', '+# notes', ...l.split('\n').map((x) => `+${x}`),
    '*** End Patch'].join('\n')),
  'a Codex Update File': (l) => direct(['*** Begin Patch', '*** Update File: notes.md', '@@', ' # notes', ...l.split('\n').map((x) => `-${x}`),
    '+rotated: yes', '*** End Patch'].join('\n')),
  'a Codex native unified diff': (l) => native('notes.md', `@@ -1,2 +1,2 @@\n # notes\n${l.split('\n').map((x) => `+${x}`).join('\n')}\n-old\n`),
};

for (const [what, [line, value]] of Object.entries(LINES)) {
  test(`M33 R repair 7 hunt: ${what} leaves nothing of its value in any Claude Code or Codex channel`, async () => {
    const leaked = [];
    for (const [channel, build] of Object.entries(CC)) {
      const { raw, clean } = await sliced(build(line));
      assert.ok(JSON.stringify(raw).includes(value.split(' ')[0]), `premise: the raw ledger holds it (${channel})`);
      for (const surface of everywhere(clean, value)) leaked.push(`Claude Code ${channel}: ${surface}`);
    }
    for (const [channel, build] of Object.entries(CODEX)) {
      const { raw, clean } = await codexSliced(build(line));
      assert.ok(JSON.stringify(raw).includes(value.split(' ')[0]), `premise: the raw ledger holds it (${channel})`);
      for (const surface of everywhere(clean, value)) leaked.push(`${channel}: ${surface}`);
    }
    assert.deepEqual(leaked, []);
  });
}

test('M33 R repair 7 hunt: the label stays readable where its value is masked, and the ledger is deterministic', async () => {
  const build = () => [userTurn(`Please set the recall api key to ${HEX40}\nrecall key: ${HEX40}`), toolUse('b1', 'Bash', { command: 'cat notes.txt' }),
    toolResult('b1', `Here is my recall api key:\n${HEX40}`), said('The api key → see the docs. Done.')];
  // C-01 event identity: one recording (its rows' uuids are recorded now), sliced twice.
  const rows = build();
  const one = await sliced(rows);
  const two = await sliced(rows);
  assert.equal(JSON.stringify(one.clean), JSON.stringify(two.clean));
  assert.equal(sliceHash(one.clean), sliceHash(two.clean));
  assert.equal(one.clean.ask[0].text, 'Please set the recall api key to ‹redacted:secret-value›\nrecall key: ‹redacted:secret-value›');
  assert.deepEqual(one.clean.ledger.find((e) => Array.isArray(e.tailLines)).tailLines,
    ['Here is my recall api key:', '‹redacted:secret-value›']);
  assert.equal(one.clean.claim.finalMessage, 'The api key → see the docs. Done.', 'prose after a label is kept');
});
