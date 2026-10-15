// M33 R repair 9, end to end: the proximity rule's wider scope (redact/index.js, P: S1-S5, the closed command and word
// lists) over synthetic Claude Code recordings and Codex rollouts, to the ledger, the session the reviewer reads and the
// review requests built from it.
//
// The third leak hunt's first major family is a value printed by a command whose own text names the secret, or written
// to a file whose path alone names it: every such case leaked in both adapters. Each is built here as an agent session
// would hold it. Then one text per other family is carried through every channel a recording can put a line in, as
// repair 8's end-to-end test carries its families.
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

const digest = (alg, enc, phrase) => createHash(alg).update(`m33 r repair 9 e2e synthetic: ${phrase}`).digest(enc);
const mixed = (s) => (/\d/.test(s) && /[A-Za-z]/.test(s) ? s : `${s.slice(0, -2)}7q`);
const HEX40 = mixed(digest('sha1', 'hex', 'hex40'));
const HEX32 = mixed(digest('md5', 'hex', 'hex32'));
const B64 = digest('sha256', 'base64', 'base64');
const UUID = (() => { const h = mixed(digest('sha256', 'hex', 'uuid')); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; })();
const PW = 'Hunter2024!';
const HUMAN = 'bluefish';
const MNEMONIC = 'walnut violin tuxedo oyster nephew lizard kangaroo jaguar giraffe falcon dolphin cactus';

let k = 0;
/** The surfaces built from the clean ledger that still hold a fragment of `value` (8 characters, the whole of a shorter
 *  one; each word of a value of words). */
function everywhere(clean, value) {
  const session = sessionFromLedger(clean, { sessionKey: `m33-r-repair-9-${++k}` });
  const requests = planWindowRequests({ session, reviewScope: 'session-only' }).requests
    .map(({ request }) => `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}`).join('\n');
  sliceHash(clean);
  const surfaces = { ledger: JSON.stringify(clean), session: JSON.stringify(session.blobs) + JSON.stringify(session.events),
    requests };
  const grams = value.includes(' ') ? value.split(/[ ,]+/).filter((w) => w.length >= 5)
    : value.length < 8 ? [value] : Array.from({ length: value.length - 7 }, (_, i) => value.slice(i, i + 8));
  return Object.entries(surfaces).filter(([, text]) => grams.some((g) => text.includes(g))).map(([name]) => name);
}

const item = (payload) => JSON.stringify({ type: 'response_item', payload });
const codexShell = (cmd, out, exit = 0) => [
  item({ type: 'message', role: 'user', content: 'Wire the recall sync job.' }),
  item({ type: 'function_call', name: 'exec_command', call_id: 's1', arguments: JSON.stringify({ cmd }) }),
  item({ type: 'function_call_output', call_id: 's1',
    output: `Chunk ID: 5f1e2a\nWall time: 0.1000 seconds\nProcess exited with code ${exit}\nOriginal token count: 40\nOutput:\n${out}` })];
const ccBash = (cmd, out) => [userTurn('Wire the recall sync job.'), toolUse('b1', 'Bash', { command: cmd }), toolResult('b1', out), said('Done.')];
const numbered = (text) => text.split('\n').map((line, i) => `${String(i + 1).padStart(6)}\t${line}`).join('\n');

// ---- S1: the hunt's 18 cross-field cases ------------------------------------------------------------------------------

const PRINTERS = {
  'echo $RECALL_API_KEY': ['echo $RECALL_API_KEY', HEX40],
  'printenv RECALL_API_KEY': ['printenv RECALL_API_KEY', HEX40],
  'gcloud secrets versions access': ['gcloud secrets versions access latest --secret=recall-api-key', HEX40],
  'aws secretsmanager --output text': ['aws secretsmanager get-secret-value --secret-id recall/api-key --query SecretString --output text', HEX40],
  'cat ~/.config/recall/api_key': ['cat ~/.config/recall/api_key', HEX40],
  'vault kv get -field=api_key': ['vault kv get -field=api_key secret/recall', HEX40],
  'heroku config:get': ['heroku config:get RECALL_API_KEY -a recall-sync', B64],
  'op read api key': ['op read "op://Private/Recall/api key"', HEX40],
  'kubectl jsonpath | base64 -d': ["kubectl get secret recall -o jsonpath='{.data.api-key}' | base64 -d", UUID],
  'security find-generic-password -w': ['security find-generic-password -s recall-db -a bot -w', PW],
  'security … -w, a human password': ['security find-generic-password -s wifi -w', HUMAN],
  'openssl rand -hex 20 (a new secret)': ['openssl rand -hex 20', HEX40],
  'aws ssm get-parameter JSON': ['aws ssm get-parameter --name /recall/api-key --with-decryption',
    `{\n    "Parameter": {\n        "Name": "/recall/api-key",\n        "Type": "SecureString",\n        "Value": "${HEX40}",\n        "Version": 3\n    }\n}`],
  'az appsettings list JSON': ['az webapp config appsettings list -g rg -n recall-sync',
    `[\n  {\n    "name": "RECALL_API_KEY",\n    "slotSetting": false,\n    "value": "${HEX40}"\n  }\n]`],
  'ECS task definition JSON (cat)': ['cat taskdef.json', `{\n  "environment": [\n    {\n      "name": "RECALL_API_KEY",\n      "value": "${HEX40}"\n    }\n  ]\n}`],
};

for (const [what, [cmd, out]] of Object.entries(PRINTERS)) {
  const value = [HEX40, B64, UUID, PW, HUMAN].find((v) => out.includes(v));
  test(`M33 R repair 9, S1 end to end: ${what} — the printed value reaches no surface (Claude Code and Codex)`, async () => {
    const leaked = [];
    const cc = await sliced(ccBash(cmd, out));
    assert.ok(JSON.stringify(cc.raw).includes(value), 'premise: the raw Claude Code ledger holds it');
    for (const surface of everywhere(cc.clean, value)) leaked.push(`Claude Code: ${surface}`);
    const cx = await codexSliced(codexShell(cmd, out));
    assert.ok(JSON.stringify(cx.raw).includes(value), 'premise: the raw Codex ledger holds it');
    for (const surface of everywhere(cx.clean, value)) leaked.push(`Codex: ${surface}`);
    assert.deepEqual(leaked, []);
  });
}

test('M33 R repair 9, S1 end to end: a Write, a Read, an Edit and a Codex Add File whose path or file names the secret', async () => {
  const cases = {
    'Write .secrets/recall_api_key (only the value)': [false, [userTurn('save the key'),
      toolUse('w1', 'Write', { file_path: '/repo/.secrets/recall_api_key', content: `${HEX40}\n` }), toolResult('w1', 'File created successfully')]],
    'Read .secrets/recall_api_key': [false, [userTurn('show it'), toolUse('r1', 'Read', { file_path: '/repo/.secrets/recall_api_key' }),
      toolResult('r1', numbered(HEX40)), said('ok')]],
    'Edit .env, only the value': [false, [userTurn('rotate it'), toolUse('r1', 'Read', { file_path: '/repo/.env' }),
      toolResult('r1', numbered(`RECALL_API_KEY=${HEX32}0000aaaa\nREGION=eu`)),
      toolUse('e1', 'Edit', { file_path: '/repo/.env', old_string: `${HEX32}0000aaaa`, new_string: HEX40 }), toolResult('e1', 'The file has been updated successfully.')]],
    'Edit config.ts, only the value, the old line names it': [false, [userTurn('rotate it'), toolUse('r1', 'Read', { file_path: '/repo/src/config.ts' }),
      toolResult('r1', numbered(`export const config = {\n  region: 'eu',\n  apiKey: '${HEX32}',\n};`)),
      toolUse('e1', 'Edit', { file_path: '/repo/src/config.ts', old_string: HEX32, new_string: HEX40 }), toolResult('e1', 'The file has been updated successfully.')]],
    'Write secrets/db_password (a human password)': [false, [userTurn('save it'),
      toolUse('w1', 'Write', { file_path: '/repo/secrets/db_password', content: HUMAN }), toolResult('w1', 'File created successfully')]],
    'Codex Add File .secrets/recall_api_key': [true, direct(['*** Begin Patch', '*** Add File: .secrets/recall_api_key', `+${HEX40}`, '*** End Patch'].join('\n'))],
    'Codex Add File .env.local': [true, direct(['*** Begin Patch', '*** Add File: .env.local', '+REGION=eu', `+SYNC=${HEX40}`, '*** End Patch'].join('\n'))],
  };
  const leaked = [];
  for (const [what, [codex, events]] of Object.entries(cases)) {
    const value = what.includes('human') ? HUMAN : HEX40;
    const { raw, clean } = codex ? await codexSliced(events) : await sliced(events);
    assert.ok(JSON.stringify(raw).includes(value), `premise: ${what}`);
    for (const surface of everywhere(clean, value)) leaked.push(`${what}: ${surface}`);
  }
  assert.deepEqual(leaked, []);
});

// ---- the other families, through every channel --------------------------------------------------------------------------

/** One text per family of the third hunt: `[text, value]`. */
const LINES = {
  '2 SSM JSON': [`{\n  "Name": "/recall/api-key",\n  "Type": "SecureString",\n  "Value": "${HEX40}"\n}`, HEX40],
  '2 YAML name with a comment': [`env:\n  - name: RECALL_API_KEY # used by the sync job\n    value: ${HEX40}`, HEX40],
  '2 CloudFormation': [`[\n  {\n    "ParameterKey": "RecallApiKey",\n    "ParameterValue": "${UUID}"\n  }\n]`, UUID],
  '3 created successfully.': [`Your API key has been created successfully.\n${HEX40}`, HEX40],
  '3 a long label line': [`Here is the API key for the staging recall workspace that Dana created last week:\n${HEX40}`, HEX40],
  '4 IDENTIFIED BY': [`mysql -u root -e "CREATE USER 'bot'@'%' IDENTIFIED BY '${PW}';"`, PW],
  '4 sqlcmd -P': [`docker exec -it mssql /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P '${PW}'`, PW],
  '4 chpasswd': [`echo "app:${HUMAN}" | chpasswd`, HUMAN],
  '4 ldapsearch -w': [`ldapsearch -x -D "cn=admin,dc=example,dc=test" -w ${HUMAN} -b dc=example,dc=test`, HUMAN],
  '5 the value above its label': [`${HEX40}\nthat is my recall api key, use it for the sync job`, HEX40],
  '5 wrapped prose': [`We rotated the recall API key and the new value that you should use is\n${HEX40} for the sync job.`, HEX40],
  '6 MNEMONIC': [`MNEMONIC="${MNEMONIC}"`, MNEMONIC],
  '6 seed phrase': [`seed phrase: ${MNEMONIC}`, MNEMONIC],
  '7 Terraform default far below': [`variable "recall_api_key" {\n  type      = string\n  sensitive = true\n  nullable  = false\n  default   = "${HEX40}"\n}`, HEX40],
  '7 a heading, then prose': [`## Recall API key\nUsed by the sync job.\nRotate it every 90 days.\n${HEX40}`, HEX40],
};

const updated = (id) => toolResult(id, 'The file has been updated successfully.');
const CC = {
  'the ask': (l) => [userTurn(`Use this for the sync job, then rotate it.\n${l}\nThanks.`), said('Done.')],
  'a saying and the claim': (l) => [userTurn('go'), said(`Noted.\n${l}`), toolUse('b1', 'Bash', { command: 'true' }), toolResult('b1', ''),
    said(`Synced.\n${l}`)],
  'a command (a heredoc)': (l) => [userTurn('save it'), toolUse('b1', 'Bash', { command: `cat >> notes.txt <<'EOF'\n${l}\nEOF` }), toolResult('b1', '')],
  'a command': (l) => [userTurn('run it'), toolUse('b1', 'Bash', { command: l }), toolResult('b1', 'ok')],
  "a command's output": (l) => [userTurn('look'), toolUse('b1', 'Bash', { command: 'cat notes.txt' }), toolResult('b1', `# sync notes\n${l}\nregion: eu`)],
  'a numbered Read, then an Edit': (l) => [userTurn('fix it'), toolUse('r1', 'Read', { file_path: '/repo/notes.md' }),
    toolResult('r1', numbered(`# notes\n${l}\nregion: eu`)),
    toolUse('e1', 'Edit', { file_path: '/repo/notes.md', old_string: 'region: eu', new_string: 'region: us' }), updated('e1')],
  'a Write': (l) => [userTurn('write it'), toolUse('w1', 'Write', { file_path: '/repo/notes.md', content: `# notes\n${l}\n` }),
    toolResult('w1', 'File created successfully')],
  "an Edit's new text": (l) => [userTurn('edit it'), toolUse('e1', 'Edit', { file_path: '/repo/notes.md', old_string: 'x: 1', new_string: l }), updated('e1')],
  'a delegation brief and its report': (l) => [userTurn('delegate it'),
    toolUse('t1', 'Agent', { description: 'sync', subagent_type: 'general-purpose', prompt: `Sync the notes.\n${l}` }), toolResult('t1', `Synced.\n${l}`)],
};
const CODEX = {
  'a Codex ask': (l) => [item({ type: 'message', role: 'user', content: `Use this for the sync job.\n${l}` })],
  'a Codex agent message': (l) => [item({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Noted.\n${l}` }] })],
  'a Codex command (a heredoc)': (l) => codexShell(`cat >> notes.txt <<'EOF'\n${l}\nEOF`, ''),
  'a Codex command': (l) => codexShell(l, 'ok'),
  "a Codex command's output": (l) => codexShell('cat notes.txt', `# sync notes\n${l}\nregion: eu`),
  'a Codex Add File': (l) => direct(['*** Begin Patch', '*** Add File: notes.md', '+# notes', ...l.split('\n').map((x) => `+${x}`),
    '*** End Patch'].join('\n')),
  'a Codex native unified diff': (l) => native('notes.md', `@@ -1,2 +1,2 @@\n # notes\n${l.split('\n').map((x) => `+${x}`).join('\n')}\n-old\n`),
};

for (const [what, [line, value]] of Object.entries(LINES)) {
  test(`M33 R repair 9: ${what} leaves nothing of its value in any Claude Code or Codex channel`, async () => {
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

test('M33 R repair 9: a command naming a token, and its benign output, stay readable end to end; the ledger is deterministic', async () => {
  const build = () => [
    userTurn('Run the token tests.'),
    toolUse('b1', 'Bash', { command: 'npm test -- token' }),
    toolResult('b1', '> recall-api@1.14.2 test\n> vitest run token\n\n ✓ src/auth/token.test.ts (12 tests) 41ms\n\n Test Files  1 passed (1)'),
    toolUse('b2', 'Bash', { command: 'git rev-parse HEAD' }),
    toolResult('b2', HEX40),
    said('All 12 token tests pass.'),
  ];
  // C-01 event identity: one recording (its rows' uuids are recorded now), sliced twice.
  const rows = build();
  const one = await sliced(rows);
  const two = await sliced(rows);
  assert.equal(JSON.stringify(one.clean), JSON.stringify(two.clean));
  assert.equal(sliceHash(one.clean), sliceHash(two.clean));
  const bashes = ['npm test -- token', 'git rev-parse HEAD'].map((cmd) => one.clean.ledger.find((e) => e.cmd === cmd));
  assert.deepEqual(bashes[0].tailLines, ['> recall-api@1.14.2 test', '> vitest run token', '', ' ✓ src/auth/token.test.ts (12 tests) 41ms', '',
    ' Test Files  1 passed (1)']);
  assert.deepEqual(bashes[1].tailLines, [HEX40], 'a command naming nothing keeps an unlabelled hex run');
});
