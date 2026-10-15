// M33 R repair 8, end to end: the proximity rule (redact/index.js, P) over synthetic Claude Code recordings and Codex
// rollouts. One line per probe family of both of repair 7's leak hunts — the forms each hunt found leaking, with values
// the older rules and BENIGN let through (hex, a UUID, 12 characters, a human password, a passphrase) — is carried through
// every channel a recording can put a line in; each is sliced, redacted, and turned into the session the reviewer reads
// and the review requests built from it. Nothing of the value may reach any of them.
//
// Synthetic recordings only: every value is a digest of a fixed phrase or written here. No recording is read, no model is
// called, no network is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sliceHash } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { planWindowRequests } from '../../evidence/src/run-review.js';
import { userTurn, said, toolUse, toolResult, sliced } from './m33-r-redact-cut-fixture.js';
import { codexSliced, direct, native } from './m33-r-codex-patch-fixture.js';

const digest = (alg, enc, phrase) => createHash(alg).update(`m33 r repair 8 e2e synthetic: ${phrase}`).digest(enc);
const mixed = (s) => (/\d/.test(s) && /[A-Za-z]/.test(s) ? s : `${s.slice(0, -2)}7q`);
const HEX40 = mixed(digest('sha1', 'hex', 'hex40'));
const HEX32 = mixed(digest('md5', 'hex', 'hex32'));
const B64 = digest('sha256', 'base64', 'base64');
const SHORT = mixed(digest('sha512', 'base64', 'short').replace(/[+/=]/g, '').slice(0, 12));
const UUID = (() => { const h = mixed(digest('sha256', 'hex', 'uuid')); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; })();
const PASSPHRASE = 'velvet orchid tundra marble';

/** One line per family (hunt 1, hunt 2) and the two controls: `[line, value]`. */
const LINES = {
  // Controls: the leaked shape, and the older rules' own.
  'control: the leaked shape': [`recall api key: ${HEX40}`, HEX40],
  'control: Password: sunshine1': ['Password: sunshine1', 'sunshine1'],
  // Hunt 1.
  '1 a passphrase': [`wifi passphrase: ${PASSPHRASE}`, PASSPHRASE],
  '1 a word before the value': [`recall api key: new one ${HEX40}`, HEX40],
  '1 a second value': [`recall api keys: ${HEX32} and ${HEX40}`, HEX40],
  '1 `key` behind a name': [`recall key: ${HEX40}`, HEX40],
  '1 a one-word markdown label': [`**Token**: \`${HEX40}\``, HEX40],
  '1 a username and password pair': [`Username: admin, Password: ${SHORT}`, SHORT],
  '1 a verb (set … to)': [`Please set the recall api key to ${HEX40}`, HEX40],
  '1 a qualifier after the label': [`recall api key value: ${HEX40}`, HEX40],
  '1 an arrow and a dash': [`recall api key → ${HEX40} — ${UUID}`, HEX40],
  '1 a markdown table': [`| Name | Value |\n| --- | --- |\n| recall api key | ${HEX40} |`, HEX40],
  '1 the value on the next line': [`Here is my recall api key:\n${HEX40}`, HEX40],
  '1 the value before its label': [`${HEX40} is my recall api key`, HEX40],
  '1 an escaped tab after the colon': [`{"notes":"recall api key:\\t${HEX40}"}`, HEX40],
  '1 a base64 value after `=`': [`OpenAI API key = ${B64}`, B64],
  // Hunt 2.
  '2A NBSP after the colon (the leaked shape)': [`recall api key:\u00a0${HEX40}`, HEX40],
  '2A a narrow NBSP before the colon': [`recall api key\u202f: ${HEX40}`, HEX40],
  '2A words joined by thin spaces': [`recall\u2009api\u2009key: ${SHORT}`, SHORT],
  '2B a password after `is now`': ['my wifi password is now letmein', 'letmein'],
  '2B set the db password to': ['Please set the db password to bluefish', 'bluefish'],
  '2B a password in a table': ['| Field | Value |\n| --- | --- |\n| Password | letmein |', 'letmein'],
  '2B a password below its label': ['Password:\nletmein', 'letmein'],
  '2B a password before its label': ['letmein is my wifi password', 'letmein'],
  '2B a password for an email': ['the password for admin@example.invalid is bluefish', 'bluefish'],
  '2B netrc': ['machine api.example.test login bot password letmein', 'letmein'],
  '2C a passphrase after a prose opener': ['wifi password: the purple elephant dances', 'the purple elephant dances'],
  '2D an API key for a URL': [`API key for https://api.example.test: ${HEX40}`, HEX40],
  '2D a relative clause': [`Here's the recall API key you asked for: ${HEX40}`, HEX40],
  '2D a bracketed qualifier': [`recall api key [prod]: ${HEX40}`, HEX40],
  '2D a sentence between': [`Here is the recall api key. ${HEX40}`, HEX40],
  '2E the next line, no separator': [`Here's your new recall API key\n${HEX40}`, HEX40],
  '2E a blockquote below': [`recall api key:\n> ${HEX40}`, HEX40],
  '2E a list item below': [`recall api key:\n- ${HEX40}`, HEX40],
  '2E a YAML block scalar': [`recall_api_key: >-\n  ${SHORT}`, SHORT],
  '2F camelCase recallKey': [`const recallKey = "${HEX40}";`, HEX40],
  '2F a comparison': [`if (apiKey === "${SHORT}") return true;`, SHORT],
  '2G docker login --password-stdin': ['echo letmein | docker login -u bot --password-stdin registry.example.test', 'letmein'],
  '2G gh auth login --with-token': [`echo "${HEX40}" | gh auth login --with-token`, HEX40],
  '2G gcloud secrets versions add': [`echo -n ${HEX40} | gcloud secrets versions add recall-api-key --data-file=-`, HEX40],
  '2G aws ssm put-parameter --value': ['aws ssm put-parameter --name /recall/api-key --value bluefish --type SecureString', 'bluefish'],
  '2G redis-cli -a': ['redis-cli -h cache.example.test -a letmein ping', 'letmein'],
  '2G htpasswd -b': ['htpasswd -b .htpasswd bot letmein', 'letmein'],
  '2G echo into an api_key file': [`echo ${HEX40} > ~/.recall/api_key`, HEX40],
  '2H render.yaml key/value': [`envVars:\n  - key: RECALL_API_KEY\n    value: ${HEX40}`, HEX40],
  '2H Postman env': [`{"key": "apiKey", "value": "${SHORT}", "type": "secret", "enabled": true}`, SHORT],
  '2H HTML meta': [`<meta name="recall-api-key" content="${HEX40}">`, HEX40],
  '2H .NET add key/value': [`<add key="RecallApiKey" value="${HEX40}" />`, HEX40],
  '2H Android string resource': [`<string name="recall_api_key">${HEX40}</string>`, HEX40],
  '2H Maven <password>': [`<server><id>repo</id><username>bot</username><password>${UUID}</password></server>`, UUID],
  '2I the value, then a comment naming it': [`${HEX40} # recall api key`, HEX40],
  '2J a second key after an older shape': [`api_key=${HEX32} backup ${HEX40}`, HEX40],
  '2K French': [`clé API : ${HEX40}`, HEX40],
  '2K Japanese': [`パスワード: ${SHORT}`, SHORT],
  '2L a link reference': [`[recall-api-key]: ${HEX40}`, HEX40],
  '2M a password after a sentence': ['Username: admin. Password: letmein', 'letmein'],
  '2M PIN': ['PIN: 482915', '482915'],
  '2N a passphrase with a comma': ['wifi password: velvet, orchid tundra marble', 'velvet, orchid tundra marble'],
  '2P a second key after `;`': [`recall api keys: ${HEX32}; ${HEX40}`, HEX40],
};

let k = 0;
/** Every fragment of `value` (8 characters, the whole of a shorter one; each word of a value of words) on every surface
 *  built from the clean ledger: the ledger itself (`slice_hash`'s input), the session and the review requests. */
function everywhere(clean, value) {
  const session = sessionFromLedger(clean, { sessionKey: `m33-r-repair-8-${++k}` });
  const requests = planWindowRequests({ session, reviewScope: 'session-only' }).requests
    .map(({ request }) => `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}`).join('\n');
  sliceHash(clean);
  const surfaces = { ledger: JSON.stringify(clean), session: JSON.stringify(session.blobs) + JSON.stringify(session.events),
    requests };
  const grams = value.includes(' ') ? value.split(/[ ,]+/).filter((w) => w.length >= 4)
    : value.length < 8 ? [value] : Array.from({ length: value.length - 7 }, (_, i) => value.slice(i, i + 8));
  return Object.entries(surfaces).filter(([, text]) => grams.some((g) => text.includes(g))).map(([name]) => name);
}

const updated = (id) => toolResult(id, 'The file has been updated successfully.');
const numbered = (text) => text.split('\n').map((line, i) => `${String(i + 1).padStart(6)}\t${line}`).join('\n');
const CC = {
  'the ask': (l) => [userTurn(`Use this for the sync job, then rotate it.\n${l}\nThanks.`), said('Done.')],
  'a saying and the claim': (l) => [userTurn('go'), said(`Noted.\n${l}`), toolUse('b1', 'Bash', { command: 'true' }), toolResult('b1', ''),
    said(`Synced.\n${l}`)],
  'a command (a heredoc)': (l) => [userTurn('save it'), toolUse('b1', 'Bash', { command: `cat >> notes.txt <<'EOF'\n${l}\nEOF` }), toolResult('b1', '')],
  'a command': (l) => [userTurn('run it'), toolUse('b1', 'Bash', { command: l }), toolResult('b1', 'ok')],
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
const CODEX = {
  'a Codex ask': (l) => [item({ type: 'message', role: 'user', content: `Use this for the sync job.\n${l}` })],
  'a Codex agent message': (l) => [item({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Noted.\n${l}` }] })],
  'a Codex command (a heredoc)': (l) => shell(`cat >> notes.txt <<'EOF'\n${l}\nEOF`, ''),
  'a Codex command': (l) => shell(l, 'ok'),
  "a Codex command's output": (l) => shell('cat notes.txt', `# sync notes\n${l}\nregion: eu`),
  'a Codex failing command': (l) => shell('node sync.js', `Error: rejected\n${l}`, 1),
  'a Codex Add File': (l) => direct(['*** Begin Patch', '*** Add File: notes.md', '+# notes', ...l.split('\n').map((x) => `+${x}`),
    '*** End Patch'].join('\n')),
  'a Codex Update File': (l) => direct(['*** Begin Patch', '*** Update File: notes.md', '@@', ' # notes', ...l.split('\n').map((x) => `-${x}`),
    '+rotated: yes', '*** End Patch'].join('\n')),
  'a Codex native unified diff': (l) => native('notes.md', `@@ -1,2 +1,2 @@\n # notes\n${l.split('\n').map((x) => `+${x}`).join('\n')}\n-old\n`),
};

for (const [what, [line, value]] of Object.entries(LINES)) {
  test(`M33 R repair 8: ${what} leaves nothing of its value in any Claude Code or Codex channel`, async () => {
    const leaked = [];
    for (const [channel, build] of Object.entries(CC)) {
      const { raw, clean } = await sliced(build(line));
      assert.ok(JSON.stringify(raw).includes(value.split(/[ ,]/)[0]), `premise: the raw ledger holds it (${channel})`);
      for (const surface of everywhere(clean, value)) leaked.push(`Claude Code ${channel}: ${surface}`);
    }
    for (const [channel, build] of Object.entries(CODEX)) {
      const { raw, clean } = await codexSliced(build(line));
      assert.ok(JSON.stringify(raw).includes(value.split(/[ ,]/)[0]), `premise: the raw ledger holds it (${channel})`);
      for (const surface of everywhere(clean, value)) leaked.push(`${channel}: ${surface}`);
    }
    assert.deepEqual(leaked, []);
  });
}

test('M33 R repair 8: names, labels and benign tokens stay readable end to end, and the ledger is deterministic', async () => {
  const build = () => [
    userTurn(`Please set the recall api key to ${HEX40}\nThe RECALL_API_KEY env var is read at startup (see src/config.ts).`),
    toolUse('b1', 'Bash', { command: 'git log --oneline -2 && cat notes.txt' }),
    toolResult('b1', `${HEX32.slice(0, 7)} Add healthz endpoint\nHere is my recall api key:\n${HEX40}`),
    said('The api key → see the docs. Done.'),
  ];
  // C-01 event identity: one recording (its rows' uuids are recorded now), sliced twice.
  const rows = build();
  const one = await sliced(rows);
  const two = await sliced(rows);
  assert.equal(JSON.stringify(one.clean), JSON.stringify(two.clean));
  assert.equal(sliceHash(one.clean), sliceHash(two.clean));
  assert.equal(one.clean.ask[0].text,
    'Please set the recall api key to ‹redacted:secret-value›\nThe RECALL_API_KEY env var is read at startup (see src/config.ts).');
  assert.deepEqual(one.clean.ledger.find((e) => Array.isArray(e.tailLines)).tailLines,
    [`${HEX32.slice(0, 7)} Add healthz endpoint`, 'Here is my recall api key:', '‹redacted:secret-value›']);
  assert.equal(one.clean.claim.finalMessage, 'The api key → see the docs. Done.', 'prose after a label is kept');
});
