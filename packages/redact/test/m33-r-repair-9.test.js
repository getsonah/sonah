// M33 R repair 9 — the proximity rule (P) widened where its third leak hunt found it leaking. The hunt over repair 8
// re-ran both earlier hunts with no leak, then found the families below, which P's scope or token class did not reach,
// each confirmed in 17 channels or end to end:
//   1. a value printed by a command whose own text names the secret (`echo $RECALL_API_KEY`, `printenv`, `vault kv get
//      -field=api_key`, `cat ~/.config/recall/api_key` …), and a write whose path alone names it: the word and the value
//      stand in different FIELDS of one event;
//   2. pretty-printed name/value data whose name line ends in `",`, `,`, `;` or a comment (AWS SSM JSON, an ECS
//      environment, Azure app settings, Postman, CloudFormation, Elastic Beanstalk, YAML `- name: X # …`);
//   3. a label line that ends in a sentence, or has more than eight words before its colon;
//   4. commands that set a password with no vocabulary word on their line (`IDENTIFIED BY`, `sqlcmd -P`, `mongosh -p`,
//      `chpasswd`, `zip -P`, `ssh-keygen -N`, `ldapsearch -w`, `az login -p`, `redis-cli AUTH`, `vault login` …);
//   5. a value written ABOVE its label, and hard-wrapped prose with the word on one line and the value on the next;
//   6. a wallet mnemonic or seed phrase (no such word in any vocabulary);
//   7. a value three or more non-blank lines below its label (a Terraform `default` after `type` and `sensitive`).
// The lead's rule stands: widen the scope or the token class, never a phrasing grammar. Repair 9 adds (S1) scope
// across an event's fields, (S2) a lone value line beside a strong word, above or below, (S3) a label's whole block,
// (S4) the line a strong line wraps onto, (S5) a label line ending in `,`, `;`, a comment or an escaped break, closed
// lists of commands and words, and keeps code out of the label lines (the hunt's new over-mask).
//
// This file pins, in every channel a recording can put a line in (17, as repair 8's tests read them), every family of the
// third hunt as it described them, with synthetic values of the same shapes: nothing of a value survives. It pins the
// cross-field scope on events built as the slicer builds them, the new pieces' exact bytes, the controls that must stay
// byte for byte, the OVER-MASK BUDGET on a benign corpus (redact/test/m33-r-repair-9-benign.js, with repair 8's), the
// closed lists, idempotence, determinism and linear time.
//
// Synthetic text only: every value is a digest of a fixed phrase or assembled here. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  redact, REDACTION_REASONS, PROXIMITY_STRONG, PROXIMITY_PASSWORD, PROXIMITY_SECRET_FILES, PROXIMITY_SECRET_SOURCES,
  PROXIMITY_SECRET_OPTIONS, PROXIMITY_SECRET_POSITIONS, PROXIMITY_VALUE_KEYS, PROXIMITY_RECORDER_LINES,
} from '../index.js';
import { BENIGN_DOCUMENTS } from './m33-r-repair-8-benign.js';
import { BENIGN_DOCUMENTS_9, BENIGN_EVENTS_9 } from './m33-r-repair-9-benign.js';
import { assertLinear } from './linear-clock.js';

const digest = (alg, enc, phrase) => createHash(alg).update(`m33 r repair 9 synthetic: ${phrase}`).digest(enc);
const hexOf = (n, p) => { let s = ''; for (let i = 0; s.length < n; i++) s += digest('sha256', 'hex', `${p}:${i}`); return s.slice(0, n); };
const alnum = (p, n) => { let s = ''; for (let i = 0; s.length < n; i++) s += digest('sha512', 'base64', `${p}:${i}`).replace(/[+/=]/g, ''); return s.slice(0, n); };
const mixed = (s) => (/\d/.test(s) && /[A-Za-z]/.test(s) ? s : `${s.slice(0, -2)}7q`);
const uuidOf = (hex) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;

const V = {
  hex40: mixed(hexOf(40, 'hex40')), hex32: mixed(hexOf(32, 'hex32')), hex64: mixed(hexOf(64, 'hex64')), hex20: mixed(hexOf(20, 'hex20')),
  uuid: uuidOf(mixed(hexOf(32, 'uuid'))), uuid2: uuidOf(mixed(hexOf(32, 'uuid2'))),
  b64: digest('sha256', 'base64', 'b64'), al24: mixed(alnum('al24', 24)), al12: mixed(alnum('al12', 12)),
  pw1: 'Hunter2024!', pw2: 'sunshine1', pw3: 'letmein', pw4: 'Tr0ub4dor&3', pw5: 'bluefish',
  phrase: 'velvet orchid tundra marble',
  mnemonic: 'abandon ability able about above absent absorb abstract absurd abuse access accident',
  mnemonic24: 'legal winner thank year wave sausage worth useful legal winner thank yellow '
    + 'mixture glove raven swing bridge jelly onion kitten ladder mirror noodle opera',
};
const H = V.hex40;

/** Every 8-character run of `value` (all of it when shorter) that `text` still holds. */
const fragments = (text, value) => {
  if (text == null) return [];
  const n = Math.min(8, value.length);
  const found = [];
  for (let i = 0; i + n <= value.length; i++) if (String(text).includes(value.slice(i, i + n))) found.push(value.slice(i, i + n));
  return found;
};

// ---- the channels (repair 8's 17) ---------------------------------------------------------------------------------------

const numbered = (text) => text.split('\n').map((line, i) => `${String(i + 1).padStart(6)}\t${line}`);
const CHANNELS = {
  ask: { input: (t) => t, out: (o) => o.ask.map((a) => a.text) },
  saying: { input: (t) => t, out: (o) => o.sayings.map((s) => s.text) },
  commentary: { input: (t) => t, out: (o) => o.commentary.map((s) => s.text) },
  claim: { input: (t) => t, out: (o, n) => Array.from({ length: n }, (_, i) => o.claim[`m${i}`]) },
  cmd: { input: (t) => t, out: (o) => o.ledger.map((e) => e.cmd ?? null) },
  'cmd (a heredoc)': { input: (t) => `cat > notes.txt <<'EOF'\n${t}\nEOF`, out: (o) => o.ledger.map((e) => e.heredoc ?? null) },
  tailLines: { input: (t) => t, out: (o) => o.ledger.map((e) => (Array.isArray(e.tailLines) ? e.tailLines.join('\n') : null)) },
  'numbered tailLines': { input: (t) => numbered(t).join('\n'),
    out: (o) => o.ledger.map((e) => (Array.isArray(e.numberedTail) ? e.numberedTail.join('\n') : null)) },
  argsExcerpt: { input: (t) => t, out: (o) => o.ledger.map((e) => e.argsExcerpt ?? null) },
  diff: { input: (t) => t.split('\n').map((l) => `+${l}`).join('\n'), out: (o) => o.ledger.map((e) => e.diff ?? null) },
  before: { input: (t) => t, out: (o) => o.ledger.map((e) => e.before?.text ?? null) },
  after: { input: (t) => t, out: (o) => o.ledger.map((e) => e.after?.text ?? null) },
  'child instruction': { input: (t) => t, out: (o) => o.instructions.map((s) => s.text) },
  'delegation brief': { input: (t) => t, out: (o) => o.delegations.map((d) => d.parentInstruction.text) },
  'delegation report': { input: (t) => t, out: (o) => o.delegations.map((d) => d.finalAnswer.text) },
  "a child's received brief": { input: (t) => t, out: (o) => o.children[0].parentInstructions.map((r) => r.parentInstruction.text) },
};

/** Redact `texts` through every channel at once: `{ [channel]: [output per text] }`. The events' naming texts hold no
 *  vocabulary (path `notes.txt`; the text as a command stands in an event of its own, with no output), so every mask here
 *  is the text's own scope; S1 (scope across an event's fields) is pinned on its own below. */
function through(texts) {
  const ledger = {
    ask: texts.map((text) => ({ turn: 1, text })),
    sayings: texts.map((text) => ({ turn: 1, text })),
    commentary: texts.map((text) => ({ turn: 1, beforeEvent: 0, text })),
    claim: Object.fromEntries(texts.map((text, i) => [`m${i}`, text])),
    ledger: texts.map((text, i) => ({ turn: 1, seq: i, kind: 'create', path: 'notes.txt', argsExcerpt: text,
      tailLines: text.split('\n'), diff: CHANNELS.diff.input(text),
      before: { text, source: 'read', turn: 1, partial: false, truncated: false, lines: 1 },
      after: { text, truncated: false, lines: 1 } })),
    instructions: texts.map((text) => ({ turn: 1, text })),
    delegations: texts.map((text, i) => ({ adapter: 'claude', callId: `call-${i}`, turn: 1, childId: null, status: 'unresolved',
      reason: 'child_unchecked', parentInstruction: { text, tool: 'Task', field: 'prompt' }, finalAnswer: { text, record: 2, turn: 1 } })),
    children: [{ ledger: { ask: [], ledger: [] }, parentInstructions: texts.map((text) => ({ turn: 1, parentInstruction: { text } })) }],
    dropped: [],
  };
  const extra = texts.map((text, i) => ({ turn: 1, seq: texts.length + i, kind: 'bash', cmd: CHANNELS['cmd (a heredoc)'].input(text) }));
  const tails = texts.map((text, i) => ({ turn: 1, seq: 2 * texts.length + i, kind: 'read', path: 'notes.txt', tailLines: numbered(text) }));
  const cmds = texts.map((text, i) => ({ turn: 1, seq: 3 * texts.length + i, kind: 'bash', cmd: text }));
  ledger.ledger.push(...extra, ...tails, ...cmds);
  const result = redact(ledger);
  const out = result.ledger;
  const n = texts.length;
  const own = out.ledger.slice(0, n);
  own.forEach((e, i) => { e.heredoc = out.ledger[n + i].cmd ?? null; e.numberedTail = out.ledger[2 * n + i].tailLines; e.cmd = out.ledger[3 * n + i].cmd; });
  const view = { ...out, ledger: own };
  const per = Object.fromEntries(Object.entries(CHANNELS).map(([name, c]) => [name, c.out(view, texts.length)]));
  Object.defineProperty(per, 'dropped', { value: result.dropped, enumerable: false });
  return per;
}

/** Each probe through every channel, in batches: the cells (channel x probe) whose output still holds its value. */
function leaksOf(probes) {
  const failures = [];
  for (let i = 0; i < probes.length; i += 40) {
    const batch = probes.slice(i, i + 40);
    const outs = through(batch.map((p) => p.text));
    for (const [channel, list] of Object.entries(outs)) {
      list.forEach((out, k) => {
        if (fragments(out, batch[k].value).length) failures.push(`${channel} | ${batch[k].form}: ${JSON.stringify(out).slice(0, 200)}`);
      });
    }
  }
  return failures;
}

// ---- the third hunt's families, as it described them -------------------------------------------------------------------

/** `[family, form, text, value]` for each probe; values of every shape the hunt used. */
function thirdHunt() {
  const P = [];
  const add = (family, form, text, value) => P.push({ family, form, text, value });
  const CRED = { hex40: V.hex40, uuid: V.uuid, b64: V.b64, al24: V.al24 };

  // 2. Pretty-printed name/value data: the name line ends in `",`, `,`, `;` or a comment, the value is below it.
  const DATA = {
    'aws ssm get-parameter JSON': (v) => `{\n    "Parameter": {\n        "Name": "/recall/api-key",\n        "Type": "SecureString",\n        "Value": "${v}",\n        "Version": 3\n    }\n}`,
    'an ECS task definition env': (v) => `{\n  "environment": [\n    {\n      "name": "RECALL_API_KEY",\n      "value": "${v}"\n    }\n  ]\n}`,
    'az webapp appsettings list': (v) => `[\n  {\n    "name": "RECALL_API_KEY",\n    "slotSetting": false,\n    "value": "${v}"\n  }\n]`,
    'a Postman environment, pretty': (v) => `{\n  "values": [\n    {\n      "key": "recall_api_key",\n      "value": "${v}",\n      "enabled": true\n    }\n  ]\n}`,
    'CloudFormation parameters': (v) => `[\n  {\n    "ParameterKey": "RecallApiKey",\n    "ParameterValue": "${v}"\n  }\n]`,
    'Elastic Beanstalk option settings': (v) => `[\n  {\n    "Namespace": "aws:elasticbeanstalk:application:environment",\n    "OptionName": "RECALL_API_KEY",\n    "Value": "${v}"\n  }\n]`,
    'YAML, a comment after the name': (v) => `env:\n  - name: RECALL_API_KEY # used by the sync job\n    value: ${v}`,
    'YAML, a comment and quotes': (v) => `- name: "RECALL_API_KEY"  # rotated monthly\n  value: "${v}"`,
    'a JS object, trailing commas': (v) => `const env = [\n  {\n    name: 'RECALL_API_KEY',\n    value: '${v}',\n  },\n];`,
    'the value before the name': (v) => `{\n  "value": "${v}",\n  "name": "RECALL_API_KEY"\n}`,
    'a name line ending in `;`': (v) => `name = "recall_api_key";\nvalue = "${v}";`,
    'a C# comment after the name': (v) => `new EnvVar { Name = "RECALL_API_KEY", // sync job\n  Value = "${v}" },`,
    'fields between the name and the value': (v) => `{\n  "Name": "/recall/api-key",\n  "Type": "SecureString",\n  "Tier": "Standard",\n  "DataType": "text",\n  "Value": "${v}"\n}`,
    'the value first, fields between': (v) => `{\n  "Value": "${v}",\n  "Version": 3,\n  "Tier": "Standard",\n  "Name": "/recall/api-key"\n}`,
  };
  for (const [form, give] of Object.entries(DATA)) for (const [vn, v] of Object.entries(CRED)) add('2 pretty-printed name/value data', `${form} | ${vn}`, give(v), v);
  // A human password under a name/value pair: the value key's value below the name.
  for (const pw of [V.pw3, V.pw5, V.pw1]) {
    add('2 pretty-printed name/value data', `a password value below its name | ${pw}`, `- name: DB_PASSWORD # rotated monthly\n  value: ${pw}`, pw);
    add('2 pretty-printed name/value data', `SSM JSON, a password | ${pw}`, `{\n  "Name": "/recall/db-password",\n  "Type": "SecureString",\n  "Value": "${pw}"\n}`, pw);
  }

  // 3. A label line that ends in a sentence, or holds more than eight words before its colon.
  const SENT = {
    'created successfully.': (v) => `Your API key has been created successfully.\n${v}`,
    'copy it now: (long)': (v) => `Here is your new API key. Copy it now, you will not be able to see it again:\n${v}`,
    'a relative clause, long': (v) => `Here is the API key for the staging recall workspace that Dana created last week:\n${v}`,
    'a blank line between': (v) => `API key created!\n\n  ${v}\n\nStore it somewhere safe.`,
    'a CLI tick': (v) => `✔ Token generated successfully\n${v}`,
    'a parenthesis, then a blank': (v) => `Your new personal access token (expires in 30 days):\n\n${v}`,
    'in backticks': (v) => `New recall API key created for the sync job; it is shown only once\n\`${v}\``,
    'a blockquote': (v) => `Generated a new webhook secret for the endpoint, keep it safe:\n> ${v}`,
    'a numbered output': (v) => `1\tThe signing key was rotated at 08:00 and the new one is live.\n2\t${v}`,
  };
  for (const [form, give] of Object.entries(SENT)) for (const [vn, v] of Object.entries(CRED)) add('3 a label line ending in a sentence', `${form} | ${vn}`, give(v), v);

  // 4. Commands that set a password, with no vocabulary word on the line.
  const CMD = {
    'IDENTIFIED BY in mysql -e': (v) => `mysql -u root -e "CREATE USER 'bot'@'%' IDENTIFIED BY '${v}';"`,
    'ALTER USER IDENTIFIED BY': (v) => `ALTER USER 'bot'@'localhost' IDENTIFIED BY '${v}';`,
    'GRANT IDENTIFIED BY': (v) => `GRANT ALL ON recall.* TO 'bot'@'%' IDENTIFIED BY "${v}";`,
    'IDENTIFIED WITH plugin BY': (v) => `CREATE USER bot IDENTIFIED WITH caching_sha2 BY '${v}';`,
    'sqlcmd -P': (v) => `sqlcmd -S localhost -U sa -P '${v}' -Q "SELECT 1"`,
    'docker exec sqlcmd -P': (v) => `docker exec -it mssql /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P '${v}'`,
    'mongosh -p': (v) => `mongosh "mongodb://db.example.test:27017" -u admin -p '${v}'`,
    'mongo -p': (v) => `mongo admin -u root -p '${v}' --eval "db.stats()"`,
    'cqlsh -p': (v) => `cqlsh cassandra.example.test -u cassandra -p '${v}'`,
    'echo user:pw | chpasswd': (v) => `echo "bot:${v}" | chpasswd`,
    'chpasswd here-string': (v) => `chpasswd <<< 'bot:${v}'`,
    'useradd -p': (v) => `useradd -m -p '${v}' bot`,
    'net user /add': (v) => `net user bot '${v}' /add`,
    'rabbitmqctl add_user': (v) => `rabbitmqctl add_user bot '${v}'`,
    'rabbitmqctl change_password': (v) => `rabbitmqctl change_password bot '${v}'`,
    'zip -P': (v) => `zip -r -P '${v}' backup.zip data/`,
    'unzip -P': (v) => `unzip -P '${v}' backup.zip`,
    '7z -p (glued)': (v) => `7z a '-p${v}' backup.7z data/`,
    'openssl enc -k': (v) => `openssl enc -aes-256-cbc -k '${v}' -in a.txt -out a.enc`,
    'openssl -pass pass:': (v) => `openssl enc -d -aes-256-cbc -pass 'pass:${v}' -in a.enc`,
    'ssh-keygen -N': (v) => `ssh-keygen -t ed25519 -N '${v}' -f ~/.ssh/ci_ed25519`,
    'ssh-keygen -P (old)': (v) => `ssh-keygen -p -P '${v}' -N '' -f ~/.ssh/ci_ed25519`,
    'ldapsearch -w': (v) => `ldapsearch -x -D "cn=admin,dc=example,dc=test" -w '${v}' -b dc=example,dc=test`,
    'lftp -u user,pw': (v) => `lftp -u 'bot,${v}' sftp://files.example.test`,
    'smbclient -U user%pw': (v) => `smbclient //fs.example.test/share -U 'bot%${v}'`,
    'az login -p': (v) => `az login --service-principal -u ${V.uuid2} -p '${v}' --tenant contoso.example.test`,
    'redis-cli AUTH': (v) => `redis-cli -h cache.example.test AUTH '${v}'`,
    'redis-cli AUTH user pw': (v) => `redis-cli -h cache.example.test AUTH bot '${v}'`,
    'vault login': (v) => `vault login '${v}'`,
  };
  for (const [form, give] of Object.entries(CMD)) for (const v of [V.pw3, V.pw1, V.pw4, H]) add('4 commands that set a password', `${form} | ${v}`, give(v), v);
  // Unquoted, where the shell takes the word whole.
  for (const [form, text] of Object.entries({
    'sqlcmd -P, bare': `sqlcmd -S db -U sa -P ${V.pw2} -d recall`, 'mongosh -p, bare': `mongosh -u admin -p ${V.pw2} db.example.test/recall`,
    'chpasswd, bare': `echo bot:${V.pw2} | chpasswd`, 'zip -P, bare': `zip -P ${V.pw2} out.zip a.txt`, '7z -p, glued': `7z x -p${V.pw2} out.7z`,
    'ssh-keygen -N, bare': `ssh-keygen -N ${V.pw2} -f key`, 'ldapwhoami -w, bare': `ldapwhoami -x -w ${V.pw2}`,
    'net user, bare': `net user bot ${V.pw2} /add`, 'vault login, bare': `vault login ${V.pw2}`, 'lftp, bare': `lftp -u bot,${V.pw2} files.example.test`,
    'smbclient, bare': `smbclient -U bot%${V.pw2} //fs/share`, 'redis-cli auth, lower': `redis-cli auth ${V.pw2}`,
    'sudo before': `sudo useradd -p ${V.pw2} bot`, 'a Dockerfile RUN': `RUN echo "app:${V.pw2}" | chpasswd && useradd app`,
    'printf into chpasswd': `printf '%s\\n' 'bot:${V.pw2}' | sudo chpasswd`,
  })) add('4 commands that set a password', form, text, V.pw2);

  // 5. A value above its label, or hard-wrapped prose.
  const ABOVE = {
    'that is my key': (v) => `${v}\nthat is my recall api key, use it for the sync job`,
    'backticks, a blank, That is': (v) => `\`${v}\`\n\nThat is the recall API key, please add it to .env.`,
    'a caret': (v) => `${v}\n^ recall api key`,
    'a parenthesis below': (v) => `${v}\n(the recall api key)`,
    'a dash below': (v) => `"${v}"\n— the staging API token`,
    'wrapped: is / <v> for': (v) => `We rotated the recall API key this morning and the new value that you should use is\n${v} for the sync job.`,
    'wrapped: expires / in 30 days:': (v) => `Your new recall API key is ready; it expires\nin 30 days: ${v}`,
    'wrapped commit body': (v) => `Rotate the webhook secret for the billing endpoint, the new\nvalue ${v} is in the vault.`,
  };
  for (const [form, give] of Object.entries(ABOVE)) for (const [vn, v] of Object.entries(CRED)) add('5 a value above its label, or wrapped', `${form} | ${vn}`, give(v), v);

  // 6. A wallet mnemonic or seed phrase.
  const SEED = {
    'MNEMONIC=""': (v) => `MNEMONIC="${v}"`, "export MNEMONIC=''": (v) => `export MNEMONIC='${v}'`, 'seed phrase:': (v) => `seed phrase: ${v}`,
    'Recovery phrase:': (v) => `Recovery phrase: ${v}`, 'mnemonic:': (v) => `mnemonic: ${v}`, 'wallet seed words:': (v) => `wallet seed words: ${v}`,
    'const mnemonic =': (v) => `const mnemonic = "${v}";`, '.env unquoted': (v) => `DEPLOYER_MNEMONIC=${v}`, 'the seed phrase is': (v) => `the seed phrase is ${v}`,
    'secret recovery phrase below': (v) => `Secret Recovery Phrase:\n${v}`,
  };
  for (const [form, give] of Object.entries(SEED)) for (const v of [V.mnemonic, V.mnemonic24]) add('6 a mnemonic or seed phrase', `${form} | ${v.split(' ').length} words`, give(v), v);

  // 7. A value three or more non-blank lines below its label.
  const FAR = {
    'Terraform, type/sensitive/nullable': (v) => `variable "recall_api_key" {\n  type      = string\n  sensitive = true\n  nullable  = false\n  default   = "${v}"\n}`,
    'Terraform, a description without the word': (v) => `variable "recall_api_key" {\n  type        = string\n  description = "Used by the sync job"\n  sensitive   = true\n  default     = "${v}"\n}`,
    'a label, then fields': (v) => `API key:\nscope: read-only\nexpires: 2027-01-01\n${v}`,
    'a heading, two prose lines': (v) => `## Recall API key\nUsed by the sync job.\nRotate it every 90 days.\n${v}`,
    'a heading, blank lines': (v) => `## Recall API key\n\nUsed by the sync job.\nRotate it every 90 days.\n\n${v}`,
    'a YAML mapping': (v) => `recall_api_key:\n  owner: platform\n  scope: read-only\n  rotated: 2026-09-01\n  value: ${v}`,
    'a JSON object': (v) => `"recallApiKey": {\n  "owner": "platform",\n  "scope": "read-only",\n  "rotated": "2026-09-01",\n  "value": "${v}"\n}`,
    'a TOML table': (v) => `[recall.api_key]\nowner = "platform"\nscope = "read-only"\nrotated = 2026-09-01\nvalue = "${v}"`,
  };
  for (const [form, give] of Object.entries(FAR)) for (const [vn, v] of Object.entries(CRED)) add('7 a value three or more lines below its label', `${form} | ${vn}`, give(v), v);

  // Minors repaired: an escaped `\r` at a label line's end; vocabulary and markup.
  for (const [vn, v] of Object.entries(CRED)) {
    add('minor: an escaped break at a label line\'s end', `\\r | ${vn}`, `recall api key:\\r\n${v}`, v);
    add('minor: an escaped break at a label line\'s end', `\\r\\n | ${vn}`, `recall api key:\\r\\n\n${v}`, v);
  }
  // Strong words mask a credential-shaped value; the password family any value.
  const STRONG_WORDS = { 'azure devops pat:': (v) => `azure devops pat: ${v}`, 'PAT =': (v) => `PAT = ${v}`, '**API** key:': (v) => `**API** key: ${v}` };
  for (const [form, give] of Object.entries(STRONG_WORDS)) for (const v of [V.pw1, H]) add('minor: vocabulary and markup', `${form} | ${v}`, give(v), v);
  const WORDS = {
    'psk=': (v) => `psk=${v}`, 'WPA PSK:': (v) => `WPA PSK: ${v}`, 'wifi psk is': (v) => `the wifi psk is ${v}`,
    'parola:': (v) => `parola: ${v}`, 'lozinka:': (v) => `lozinka: ${v}`, 'kata sandi:': (v) => `kata sandi: ${v}`, 'mật khẩu:': (v) => `mật khẩu: ${v}`,
    'كلمة المرور:': (v) => `كلمة المرور: ${v}`, 'पासवर्ड:': (v) => `पासवर्ड: ${v}`, 'κωδικός:': (v) => `κωδικός: ${v}`, 'סיסמה:': (v) => `סיסמה: ${v}`,
    'รหัสผ่าน:': (v) => `รหัสผ่าน: ${v}`, 'geslo:': (v) => `geslo: ${v}`, 'passord:': (v) => `passord: ${v}`, 'adgangskode:': (v) => `adgangskode: ${v}`,
    'fullwidth password:': (v) => `ｐａｓｓｗｏｒｄ: ${v}`,
  };
  for (const [form, give] of Object.entries(WORDS)) for (const v of [V.pw1, V.pw3]) add('minor: vocabulary and markup', `${form} | ${v}`, give(v), v);
  return P;
}

const byFamily = (probes) => {
  const map = new Map();
  for (const p of probes) map.set(p.family, [...(map.get(p.family) ?? []), p]);
  return map;
};

test('M33 R repair 9 premise: every probe holds its value as written', () => {
  for (const p of thirdHunt()) assert.ok(p.text.includes(p.value), p.form);
});

for (const [family, probes] of byFamily(thirdHunt())) {
  test(`M33 R repair 9: third-hunt family "${family}" — nothing of the value survives in any of 17 channels (${probes.length} probes)`, () => {
    const failures = leaksOf(probes);
    assert.equal(failures.length, 0, `${failures.length} cells leak, first:\n${failures.slice(0, 12).join('\n')}`);
  });
}

// ---- S1: scope across an event's fields ---------------------------------------------------------------------------------

const M = '‹redacted:secret-value›';
const CODEX_HEADER = ['Chunk ID: 5f1e2a', 'Wall time: 0.1000 seconds', 'Process exited with code 0', 'Original token count: 40', 'Output:'];
const bash = (cmd, out, extra = {}) => ({ turn: 1, seq: 0, kind: 'bash', cmd, tailLines: out.split('\n'), ...extra });
const one = (e) => redact({ ask: [], ledger: [e] }).ledger.ledger[0];

/** The 18 cross-field cases of the hunt's first major family, with a Claude Code output and a Codex one. */
const PRINTERS = {
  'echo $RECALL_API_KEY': ['echo $RECALL_API_KEY', H],
  'echo "${RECALL_API_KEY}"': ['echo "${RECALL_API_KEY}"', H],
  'printenv RECALL_API_KEY': ['printenv RECALL_API_KEY', H],
  'gcloud secrets versions access': ['gcloud secrets versions access latest --secret=recall-api-key', H],
  'aws secretsmanager --output text': ['aws secretsmanager get-secret-value --secret-id recall/api-key --query SecretString --output text', H],
  'aws ssm get-parameter --output text': ['aws ssm get-parameter --name /recall/api-key --with-decryption --query Parameter.Value --output text', V.uuid],
  'vault kv get -field=api_key': ['vault kv get -field=api_key secret/recall', H],
  'heroku config:get': ['heroku config:get RECALL_API_KEY -a recall-sync', V.b64],
  'op read "…/api key"': ['op read "op://Private/Recall/api key"', H],
  'kubectl jsonpath | base64 -d': ["kubectl get secret recall -o jsonpath='{.data.api-key}' | base64 -d", V.al24],
  'cat ~/.config/recall/api_key': ['cat ~/.config/recall/api_key', H],
  'security find-generic-password -w': ['security find-generic-password -s recall-db -a bot -w', V.pw1],
  'security … -w, a human password': ['security find-generic-password -s wifi -w', V.pw5],
  'printenv DB_PASSWORD, a passphrase': ['printenv DB_PASSWORD', V.phrase],
  'openssl rand -hex 20': ['openssl rand -hex 20', H],
  'openssl rand -base64 32': ['openssl rand -base64 32', V.b64],
  'head -c /dev/urandom | base64': ['head -c 32 /dev/urandom | base64', V.b64],
  'pwgen': ['pwgen -s 24 1', V.al24],
  'pass show': ['pass show recall/sync', V.pw4],
  'gh auth token': ['gh auth token', V.al24],
  'cat .env (a credential file, every line)': ['cat .env', `REGION=eu\nLOG_LEVEL=info\nSYNC=${H}`],
  'cat ~/.npmrc': ['cat ~/.npmrc', `registry=https://registry.example.test/\nalways-auth=true\n${V.uuid}`],
};

test('M33 R repair 9, S1: a value printed by a command whose text names the secret is masked in its output (Claude Code and Codex)', () => {
  const leaked = [];
  for (const [what, [cmd, printed]] of Object.entries(PRINTERS)) {
    const value = printed.includes(H) ? H : printed.includes(V.uuid) ? V.uuid : printed;
    for (const [shape, out] of [['Claude Code', printed], ['Codex', [...CODEX_HEADER, printed].join('\n')],
      ['a warning first', `WARNING: the cli is out of date\n${printed}`], ['a trailing newline', `${printed}\n`]]) {
      const e = one(bash(cmd, out, { firstErrorLine: value }));
      assert.equal(Object.hasOwn(e, 'firstErrorLine'), false, 'D69 (c): a legacy first error line is dropped');
      const text = (e.tailLines ?? []).join('\n');
      if (fragments(text, value).length) leaked.push(`${what} (${shape}): ${JSON.stringify(e.tailLines)}`);
    }
  }
  assert.deepEqual(leaked, []);
  // Exact bytes: the Codex header stays; only the value goes.
  assert.deepEqual(one(bash('printenv RECALL_API_KEY', [...CODEX_HEADER, H].join('\n'))).tailLines, [...CODEX_HEADER, M]);
  assert.deepEqual(one(bash('echo $RECALL_API_KEY', H)).tailLines, [M]);
  assert.deepEqual(one(bash('security find-generic-password -s wifi -w', V.pw5)).tailLines, [M]);
});

test('M33 R repair 9, S1: a write or a read whose path names the secret masks its content; a credential file masks all of it', () => {
  const write = (path, content, kind = 'create') => ({ turn: 1, seq: 0, kind, path, argsExcerpt: content,
    diff: content.split('\n').map((l) => `+${l}`).join('\n'), before: { text: content, source: 'write', turn: 1, partial: false, truncated: false, lines: 1 },
    after: { text: content, truncated: false, lines: 1 } });
  const fields = (e) => [e.argsExcerpt, e.diff, e.before?.text, e.after?.text, ...(e.tailLines ?? [])].join('\n');
  const cases = [
    write('.secrets/recall_api_key', `${H}\n`), write('config/recall-token.txt', V.uuid), write('.secrets/db_password', V.pw3),
    write('.env', `REGION=eu\nSYNC=${H}\n`), write('deploy/.env.production', `A=1\nB=${V.b64}`), write('certs/client.key', V.al24),
    { turn: 1, seq: 0, kind: 'read', path: '.secrets/recall_api_key', tailLines: [`     1\t${H}`] },
    { turn: 1, seq: 0, kind: 'read', path: 'secrets/wifi-password.txt', tailLines: [`     1\t${V.pw5}`] },
  ];
  const leaked = [];
  for (const e of cases) {
    const value = e.path.includes('password') ? (e.argsExcerpt ?? V.pw5) : [H, V.uuid, V.b64, V.al24].find((v) => JSON.stringify(e).includes(v));
    const out = fields(one(structuredClone(e)));
    if (fragments(out, value).length) leaked.push(`${e.kind} ${e.path}: ${JSON.stringify(out).slice(0, 200)}`);
  }
  assert.deepEqual(leaked, []);
  // An Edit whose new text is only the value, in a file whose line holding the old text names the secret.
  const edit = { turn: 1, seq: 0, kind: 'edit', path: 'src/config.ts', argsExcerpt: `${V.hex32}\n⟪→⟫\n${H}`,
    diff: `-  apiKey: '${V.hex32}',\n+  apiKey: '${H}',`,
    before: { text: `export const config = {\n  region: 'eu',\n  apiKey: '${V.hex32}',\n};\n`, source: 'read', turn: 1, partial: false, truncated: false, lines: 4 },
    after: { text: `${H}\n⟪→⟫\n${V.hex32}`, truncated: false, lines: 3, parts: 1, priorParts: 1 } };
  const e = one(edit);
  assert.deepEqual([fragments(e.argsExcerpt, H), fragments(e.after.text, H), fragments(e.diff, H)], [[], [], []]);
  assert.equal(e.argsExcerpt, `${M}\n⟪→⟫\n${M}`);
  // The `.env` Edit the hunt found: the path is a credential file, the read withheld; the edit's own text is masked.
  const env = one({ turn: 1, seq: 1, kind: 'edit', path: '.env', argsExcerpt: `${V.hex32}0000aaaa\n⟪→⟫\n${H}`, diff: `-${V.hex32}0000aaaa\n+${H}`,
    before: { withheld: 'credential-shaped path' }, after: { text: `${H}\n⟪→⟫\n${V.hex32}0000aaaa`, truncated: false, lines: 3, parts: 1, priorParts: 1 } });
  assert.equal(env.argsExcerpt, `${M}\n⟪→⟫\n${M}`);
  assert.equal(env.diff, `-${M}\n+${M}`);
});

test('M33 R repair 9, S1: an event that names nothing keeps its output; one that does scopes only the first lines of it', () => {
  // A command that names no secret: its output is the old rules' (an unlabelled hex run is kept, as before).
  assert.deepEqual(one(bash('git rev-parse HEAD', H)).tailLines, [H]);
  assert.deepEqual(one(bash('cat notes.txt', [...CODEX_HEADER, H].join('\n'))).tailLines, [...CODEX_HEADER, H]);
  // A command that names a token scopes the first 3 non-blank lines of its output, rule 3's shapes only.
  const out = ['> recall-api@1.14.2 test', ` build ${V.hex20}`, '', ' Test Files  1 passed (1)', ` commit ${V.hex32}`];
  const e = one(bash('npm test -- token', out.join('\n')));
  assert.deepEqual(e.tailLines, [out[0], ` build ${M}`, ...out.slice(2)]);
  // Its path names a token: a Read of src/auth/token.ts scopes the first lines of the file, and only rule 3's shapes.
  const code = ["import { sign } from 'jsonwebtoken';", "import { config } from '../config';", '', 'export const TTL_SECONDS = 900;', `// pinned ${V.hex20}`];
  const read = one({ turn: 1, seq: 0, kind: 'read', path: 'src/auth/token.ts', tailLines: code.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`) });
  assert.deepEqual(read.tailLines, code.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`));
  // The password family's whole value only where the output is that one line; a listing is no value.
  assert.deepEqual(one(bash('ls ~/.password-store', 'recall/  wifi/')).tailLines, ['recall/  wifi/']);
  assert.deepEqual(one(bash('wc -l passwords.txt', '1200 passwords.txt')).tailLines, ['1200 passwords.txt']);
  assert.deepEqual(one(bash('git log --oneline -1 -- src/password.py', `${V.hex20.slice(0, 7)} Fix the password reset flow`)).tailLines,
    [`${M} Fix the password reset flow`]);
  assert.deepEqual(one(bash('echo $PWD', '/work/recall')).tailLines, ['/work/recall']);
  assert.deepEqual(one(bash('pwd', '/work/recall-2024')).tailLines, ['/work/recall-2024']);
});

// ---- the new pieces, with exact bytes -----------------------------------------------------------------------------------

const SAMPLE = ['ask', 'saying', 'cmd', 'tailLines', 'argsExcerpt', 'after', 'delegation report'];
function exact(cases, channels = SAMPLE) {
  const outs = through(cases.map(([text]) => text));
  for (const channel of channels) {
    cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${JSON.stringify(text)}`));
  }
}

test('M33 R repair 9, S2: a lone value line within 2 non-blank lines of a strong word, above or below, is masked; its key and quotes stay', () => {
  exact([
    [`Your API key has been created successfully.\n${H}`, `Your API key has been created successfully.\n${M}`],
    [`${H}\nthat is my recall api key`, `${M}\nthat is my recall api key`],
    [`\`${H}\`\n\nThat is the recall API key.`, `\`${M}\`\n\nThat is the recall API key.`],
    [`{\n  "value": "${H}",\n  "name": "RECALL_API_KEY"\n}`, `{\n  "value": "${M}",\n  "name": "RECALL_API_KEY"\n}`],
    [`- name: RECALL_API_KEY # used by the sync job\n  value: ${H}`, `- name: RECALL_API_KEY # used by the sync job\n  value: ${M}`],
    [`the api token is rotated monthly.\none\ntwo\n${H}`, `the api token is rotated monthly.\none\ntwo\n${H}`],   // three lines away
    [`primary key\n${H}`, `primary key\n${H}`],                                              // a weak word: none
    [`api token\n${H} and more words`, `api token\n${M} and more words`],                    // a label line: its scope
  ], ['ask', 'saying', 'tailLines', 'after', 'cmd']);
});

test('M33 R repair 9, S3: a label line scopes its whole block — a brace, an indented block, a heading\'s section, a paragraph — to 16 non-blank lines', () => {
  exact([
    [`variable "recall_api_key" {\n  type      = string\n  sensitive = true\n  nullable  = false\n  default   = "${H}"\n}\n\nbuild ${V.hex20}`,
      `variable "recall_api_key" {\n  type      = string\n  sensitive = true\n  nullable  = false\n  default   = "${M}"\n}\n\nbuild ${V.hex20}`],
    [`recall api key:\none\ntwo\n${H}`, `recall api key:\none\ntwo\n${M}`],
    [`recall api key:\none\ntwo\n\nlater ${V.hex20}`, `recall api key:\none\ntwo\n\nlater ${V.hex20}`],
    [`## Recall API key\n\nUsed by the sync job.\n\n${H}\n\n## Next\n\nbuild ${V.hex20}`,
      `## Recall API key\n\nUsed by the sync job.\n\n${M}\n\n## Next\n\nbuild ${V.hex20}`],
    [`recall_api_key:\n  owner: platform\n  scope: read-only\n  value: ${H}\nregion: eu\nbuild: ${V.hex20}`,
      `recall_api_key:\n  owner: platform\n  scope: read-only\n  value: ${M}\nregion: eu\nbuild: ${V.hex20}`],
  ], ['ask', 'saying', 'tailLines', 'after', 'cmd']);
});

test('M33 R repair 9, S4: a strong line that ends mid-sentence puts the line it wraps onto in scope; a record line does not', () => {
  exact([
    [`We rotated the recall API key and the value to use is\n${H} for the sync job.`, `We rotated the recall API key and the value to use is\n${M} for the sync job.`],
    [`Your new recall API key is ready; it expires\nin 30 days: ${H}`, `Your new recall API key is ready; it expires\nin 30 days: ${M}`],
    // A commit list: the line naming a key masks its own SHA (by design, repair 8), never the next commit's.
    [`a71b3d0 Add password policy\n9e0d6c4 Fix flaky retry test\n4f9c2e1 Bump deps`, `${M} Add password policy\n9e0d6c4 Fix flaky retry test\n4f9c2e1 Bump deps`],
    // A log line: a record, not wrapped prose.
    ['2026-09-30T08:14:05Z WARN token refresh failed for tenant acme\n2026-09-30T08:14:06Z INFO retry request_id=7f3a9c2e1b',
      '2026-09-30T08:14:05Z WARN token refresh failed for tenant acme\n2026-09-30T08:14:06Z INFO retry request_id=7f3a9c2e1b'],
    // A sentence that ends is no wrap.
    [`The api token was rotated.\nbuild ${V.hex20} passed`, `The api token was rotated.\nbuild ${V.hex20} passed`],
  ], ['ask', 'saying', 'tailLines', 'after', 'cmd']);
});

test('M33 R repair 9, S5: a label line may end in `,`, `;`, a comment or an escaped line break', () => {
  exact([
    [`"Name": "/recall/api-key",\n"Type": "SecureString",\nnote ${H}`, `"Name": "/recall/api-key",\n"Type": "SecureString",\nnote ${M}`],
    [`name = "recall_api_key";\nnote ${H}`, `name = "recall_api_key";\nnote ${M}`],
    [`- name: RECALL_API_KEY  # sync\n  note ${H}`, `- name: RECALL_API_KEY  # sync\n  note ${M}`],
    [`recall api key:\\r\nnote ${H}`, `recall api key:\\r\nnote ${M}`],
    [`- name: DB_PASSWORD # rotated\n  value: letmein`, `- name: DB_PASSWORD # rotated\n  value: ${M}`],
    [`{\n  "Name": "/recall/db-password",\n  "Type": "SecureString",\n  "Value": "letmein"\n}`, `{\n  "Name": "/recall/db-password",\n  "Type": "SecureString",\n  "Value": "${M}"\n}`],
  ], ['ask', 'saying', 'tailLines', 'after', 'cmd']);
});

test('M33 R repair 9: code is no label line — a password-named identifier before `:` scopes nothing below (the hunt\'s over-mask)', () => {
  const kept = [
    // (`user.password_hash = …` is the content key-name rule's, unchanged since before repair 7: not here.)
    'def set_password(user, raw_password):\n    if len(raw_password) < MIN_PASSWORD_LENGTH:\n        raise ValueError("password must be at least 12 characters")\n    user.save()',
    'def verify(user, raw_password):\n    return check_password(raw_password, user.password_hash)',
    'for password in candidates:\n    attempts += 1',
    'if (!apiKey) {\n  throw new Error("API key is required");\n}',
    'function verifyToken(token) {\n  return jwt.verify(token, secret, { algorithms: ["HS256"] });\n}',
    'token: ${{ secrets.GITHUB_TOKEN }}\n- uses: actions/setup-node@8f152de45cc393bb48ce5d89d36b731f54556e65',
    `Original token count: 40\n${H}`,
    '{\n  "max_tokens": 4096,\n  "model": "recall-large-2026"\n}',
    'The api key rotation runbook is below.\n\nStep 1: open the console',
  ];
  exact(kept.map((t) => [t, t]), ['ask', 'saying', 'tailLines', 'after', 'cmd']);
});

test('M33 R repair 9: commands that set a password give up their value; the same commands without one keep their bytes', () => {
  exact([
    [`mysql -u root -e "CREATE USER 'bot'@'%' IDENTIFIED BY 'letmein';"`, `mysql -u root -e "CREATE USER 'bot'@'%' IDENTIFIED BY '${M}';"`],
    ['sqlcmd -S db -U sa -P letmein -d recall', `sqlcmd -S db -U sa -P ${M} -d recall`],
    // M33 brittleness M7: the whole literal written to a password command's stdin, its user name with it.
    ['echo "bot:letmein" | chpasswd', `echo "${M}" | chpasswd`],
    ['7z x -pletmein out.7z', `7z x -p${M} out.7z`],
    ['lftp -u bot,letmein files.example.test', `lftp -u bot,${M} files.example.test`],
    ['smbclient -U bot%letmein //fs/share', `smbclient -U bot%${M} //fs/share`],
    ['openssl enc -d -aes-256-cbc -pass pass:letmein -in a.enc', `openssl enc -d -aes-256-cbc -pass ${M} -in a.enc`],   // the key-name rule's (`-pass`)
    ['net user bot letmein /add', `net user bot ${M} /add`],
    ['redis-cli -h cache AUTH bot letmein', `redis-cli -h cache AUTH bot ${M}`],
    ['vault login letmein', `vault login ${M}`],
  ], ['cmd', 'ask', 'tailLines', 'after']);
  const kept = ['zip -r out.zip data/', 'unzip out.zip', 'ssh-keygen -t ed25519 -f key', 'ssh-keygen -N "" -f key', 'openssl rand -hex 20',
    'net user bot /delete', 'vault login -method=github', 'redis-cli -h cache PING',
    'mongosh -u admin db.example.test/recall', 'az webapp create -p recall-plan -n recall', 'mysql -e "SELECT user FROM mysql.user;"',
    // (`openssl … -pass env:ENC_PASS` is the key-name rule's: `-pass` names a secret, unchanged since before repair 7.)
    'rabbitmqctl list_users', 'chpasswd < users.txt', 'useradd -m bot', 'smbclient -L //fs -N', 'lftp files.example.test'];
  exact(kept.map((t) => [t, t]), ['cmd', 'ask', 'tailLines', 'after']);
});

test('M33 R repair 9: a mnemonic or seed phrase is a password-family value, and MNEMONIC is a secret name', () => {
  exact([
    [`seed phrase: ${V.mnemonic}`, `seed phrase: ${M}`],
    [`the recovery phrase is ${V.mnemonic}`, `the recovery phrase is ${M}`],
    ['Seed phrase backups are covered in the wallet guide.', 'Seed phrase backups are covered in the wallet guide.'],
  ], ['ask', 'saying', 'cmd', 'tailLines', 'after']);
  const cmdOf = (text) => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text }] }).ledger.ledger[0].cmd;
  assert.deepEqual(fragments(cmdOf(`MNEMONIC="${V.mnemonic}" npx hardhat run deploy.js`), V.mnemonic), []);
});

// ---- the closed lists -----------------------------------------------------------------------------------------------------

test('M33 R repair 9: the new lists are closed, frozen, and hold the hunt\'s words and commands', () => {
  for (const list of [PROXIMITY_SECRET_FILES, PROXIMITY_SECRET_SOURCES, PROXIMITY_SECRET_OPTIONS, PROXIMITY_SECRET_POSITIONS, PROXIMITY_VALUE_KEYS,
    PROXIMITY_RECORDER_LINES]) {
    assert.ok(Array.isArray(list) && Object.isFrozen(list) && new Set(list).size === list.length);
  }
  for (const word of ['mnemonic(s)', 'seed phrase(s)', 'recovery phrase(s)', 'psk']) assert.ok(PROXIMITY_PASSWORD.includes(word), word);
  assert.ok(PROXIMITY_STRONG.includes('pat'));
  for (const entry of ['sqlcmd -P', 'mongosh -p', 'cqlsh -p', 'useradd -p', 'zip -P', 'unzip -P', '7z -p', 'openssl -k', 'ssh-keygen -N',
    'ldapsearch -w', 'az login -p', 'lftp -u ,', 'smbclient -U %', 'openssl -pass pass:']) assert.ok(PROXIMITY_SECRET_OPTIONS.includes(entry), entry);
  for (const entry of ['net user 2', 'rabbitmqctl add_user 2', 'rabbitmqctl change_password 2', 'vault login 1', 'redis-cli auth last'])
    assert.ok(PROXIMITY_SECRET_POSITIONS.includes(entry), entry);
  for (const entry of ['openssl rand', 'pwgen', '/dev/urandom']) assert.ok(PROXIMITY_SECRET_SOURCES.includes(entry), entry);
  for (const entry of ['.env', '.netrc', '.pgpass', '*.pem', '*.key']) assert.ok(PROXIMITY_SECRET_FILES.includes(entry), entry);
});

test('M33 R repair 9: what the new scope masks is declared under the closed reason vocabulary, and nothing new', () => {
  const per = through([`${H}\nthat is my recall api key`, `variable "recall_api_key" {\n  a = 1\n  b = 2\n  default = "${H}"\n}`,
    'sqlcmd -P letmein', `seed phrase: ${V.mnemonic}`]);
  for (const entry of per.dropped) assert.ok(REDACTION_REASONS.includes(entry.reason), entry.reason);
  const events = redact({ ask: [], ledger: [bash('printenv RECALL_API_KEY', H)] });
  assert.ok(events.dropped.some((entry) => entry.reason === 'redacted:secret-key-value' && entry.where === 'tailLines'));
});

// ---- the over-mask budget -------------------------------------------------------------------------------------------------

test('M33 R repair 9: OVER-MASK BUDGET — at least 90% of a benign corpus is kept byte for byte, every changed line listed', (t) => {
  const run = {
    'after (a file body)': (text) => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'x', after: { text, truncated: false, lines: 1 } }] }).ledger.ledger[0].after.text,
    'tailLines (an output)': (text) => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat x', tailLines: text.split('\n') }] }).ledger.ledger[0].tailLines.join('\n'),
    'ask (the human)': (text) => redact({ ask: [{ turn: 1, text }], ledger: [] }).ledger.ask[0].text,
    'saying (the agent)': (text) => redact({ ask: [], ledger: [], sayings: [{ turn: 1, text }] }).ledger.sayings[0].text,
  };
  let lines = 0, kept = 0;
  const changed = new Map();
  const documents = { ...BENIGN_DOCUMENTS, ...BENIGN_DOCUMENTS_9 };
  for (const [channel, scrub] of Object.entries(run)) {
    let n = 0, k = 0;
    for (const [document, text] of Object.entries(documents)) {
      const input = text.split('\n');
      const output = scrub(text).split('\n');
      input.forEach((line, i) => {
        n++;
        if (output.length === input.length && output[i] === line) { k++; return; }
        const key = `${document}: ${line}`;
        changed.set(key, [...(changed.get(key) ?? []), channel]);
      });
    }
    t.diagnostic(`${channel}: ${k} of ${n} lines kept (${((100 * k) / n).toFixed(2)}%)`);
    lines += n;
    kept += k;
  }
  // The events: a command naming a token, password or key and its benign output; a read or write of such a path.
  let eLines = 0, eKept = 0;
  for (const [name, event] of Object.entries(BENIGN_EVENTS_9)) {
    const out = one(structuredClone(event));
    for (const field of ['tailLines', 'argsExcerpt', 'after', 'diff']) {
      const input = field === 'tailLines' ? event.tailLines : field === 'after' ? event.after?.text?.split('\n') : event[field]?.split('\n');
      if (!input) continue;
      const output = field === 'tailLines' ? out.tailLines : field === 'after' ? out.after?.text?.split('\n') : out[field]?.split('\n');
      input.forEach((line, i) => {
        eLines++;
        if (output && output.length === input.length && output[i] === line) { eKept++; return; }
        changed.set(`event ${name} (${field}): ${line}`, ['event']);
      });
    }
  }
  t.diagnostic(`events: ${eKept} of ${eLines} lines kept (${((100 * eKept) / eLines).toFixed(2)}%)`);
  lines += eLines;
  kept += eKept;
  const share = kept / lines;
  t.diagnostic(`overall: ${kept} of ${lines} lines kept (${(100 * share).toFixed(2)}%), ${Object.keys(documents).length} documents and ${Object.keys(BENIGN_EVENTS_9).length} events`);
  for (const [line, channels] of changed) t.diagnostic(`changed in ${channels.length}: ${line.slice(0, 140)}`);
  assert.ok(share >= 0.9, `${(100 * share).toFixed(2)}% kept`);
});

// ---- idempotence, determinism, time ---------------------------------------------------------------------------------------

test('M33 R repair 9: redaction is idempotent and deterministic over every third-hunt probe', () => {
  const probes = thirdHunt();
  const texts = probes.map((p) => p.text);
  const ask = (list) => redact({ ask: list.map((text) => ({ turn: 1, text })), ledger: [] }).ledger.ask.map((a) => a.text);
  const once = ask(texts);
  assert.deepEqual(ask(once), once);
  assert.deepEqual(ask(texts), once);
  const tail = (list) => redact({ ask: [], ledger: list.map((text, i) => ({ turn: 1, seq: i, kind: 'bash', cmd: 'printenv RECALL_API_KEY', tailLines: text.split('\n') })) })
    .ledger.ledger.map((e) => e.tailLines.join('\n'));
  const t1 = tail(texts.slice(0, 60));
  assert.deepEqual(tail(t1), t1);
});

test('M33 R repair 9: the new scope is linear — a megabyte of label blocks, lone values, wrapped lines, braces or a named command\'s output', () => {
  const MB = 1 << 20;
  const fill = (unit) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
  const inputs = {
    'lone values beside strong words': fill(`api token\n${V.hex20}\n`),
    'label lines opening braces': fill('variable "api_key" {\n'),
    'braces, never closed': `api key: {\n${fill('{ a\n')}`,
    'an indented block of a megabyte': `api_key:\n${fill('  a: 1\n')}`,
    'wrapped strong lines': fill('the api token is\nnext words\n'),
    'headings': fill('## API key\nprose\n'),
    'commands with a password option': fill('sqlcmd -P a '),
    'IDENTIFIED BY, unclosed': fill("IDENTIFIED BY '"),
  };
  for (const [name, text] of Object.entries(inputs)) {
    for (const [field, scrub] of Object.entries({
      ask: () => redact({ ask: [{ turn: 1, text }], ledger: [] }),
      body: () => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'a.cfg', after: { text, truncated: false, lines: 1 } }] }),
      tailLines: () => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'printenv API_KEY', tailLines: text.split('\n').slice(0, 20000) }] }),
    })) {
      assertLinear(scrub, 1500, `${name} / ${field}`);
    }
  }
});
