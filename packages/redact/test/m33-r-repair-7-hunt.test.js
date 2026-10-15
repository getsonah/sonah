// M33 R repair 7, its leak hunt repaired. Repair 7 (m33-r-repair-7.test.js) masked the value after a secret label of
// several words (`recall api key: <40 hex>`). Its hunt found labelled secrets still surviving in other
// common shapes, several inside repair 7's own spec. Each finding is pinned here, in every channel, with synthetic
// values only (digests of fixed phrases, assembled here):
//
//   1. A value of several words after a password-family label keeps nothing (`wifi passphrase: velvet orchid …`).
//   2. A word between the separator and the secret, and a second value on the line, leave nothing of the secret
//      (`recall api key: prod <hex>`, `recall api keys: <hex32> and <hex40>`).
//   3. A one-word label in markdown or code, or with what it is for, or mid-line after `,` `|` `/` `;` `(`
//      (`**Token**: <v>`, `` `token`: <v> ``, `Password for admin: <v>`, `Username: admin, Password: <v>`).
//   4. `key` behind a product name or a determiner (`recall key: <hex>`, `use this key: <v>`, `key for recall: <v>`):
//      a weaker label, whose value is masked only when it is credential-shaped (`primary key: id` stays).
//   5. A label joined to its value by a verb or chat punctuation (`set the recall api key to <hex>`, `my api key was
//      <v>`, `RECALL_API_KEY, <v>`, `the API key (<v>)`).
//   6. The value on the line after its label (`Here is my recall api key:\n<hex>`, a heading, a code fence, a JSON
//      escaped line break).
//   7. Separators outside repair 7's list (`→`, `⇒`, `—`, `–`, ` - `, `：`, `:=`, ` :: `), and a bullet, emoji, HTML
//      entity or code span before the value.
//   8. Markdown tables and HTML cells.
//   9. A qualifier after the label (`recall api key value:`, `API key v2:`, `api key in prod:`, a long `for` target,
//      a long or nested parenthetical).
//  10. Secrets keyed by a name in a command or a name/value pair (`gh secret set NAME --body <v>`, `echo <v> | vercel
//      env add NAME`, `security … -w <v>`, `npm config set …:_authToken <v>`, Kubernetes `name:`/`value:`, Terraform
//      `default =`).
//  11. `recall api key= <v>` (an `=` glued to a label of words is no shell assignment), an escaped tab after the
//      separator, joiners outside repair 7's list (NBSP, U+202F, zero-width, `/`, a run of blanks), `db pwd` and
//      `user pass`, a value before its label, a value split by a blank, and a short quoted value after a camelCase
//      secret name mid-line.
//
// And what the repair's first draft got wrong, each pinned: a one-word label at a line's head before an arrow, a dash
// or `is` (`Token → <hex>`); a value before a bracketed label (`<hex> (recall api key)`); a joining verb after what a
// label is for (`set the api key for prod to <hex>`); `NAME=*** cmd` and `X-Api-Key= ./run.sh` in a command; and the
// prose and code it over-masked (`credentials — 0.4% of …`, a list of names in backticks, `isHex64(ref.key)`, a test's
// `{ pass: '4 passed' }`, `lives in 1Password`).
//
// Prose stays usable: every control below is kept byte for byte in every channel.
//
// M33 R repair 8 replaced shape N with the proximity rule (P; redact/test/m33-r-repair-8.test.js, which runs both hunts'
// probe families). Every leak this file pins still masks, and every control is still kept, under P. Retired here, because
// they pinned N's grammar, which P supersedes: (1) the exact bytes of a passphrase masked to a `,` or a `.` (N's clause
// end: the second hunt's family N leaked the words after the comma; P masks a password's value to the end of its clause —
// the line, a string's closing quote, `;`, a comment, a closing tag, a table cell); (2) a prose word after a label masked
// as the value (`recall api key: prod <hex>`, `API key: one sec, <hex>`: N took the first word whatever it was; P masks the
// credential-shaped token and keeps the word, pinned in P's tests); (3) the closed lists of N's grammar, `SECRET_LABEL_WEAK`,
// `SECRET_LABEL_QUALIFIERS` and the account-password phrases of `SECRET_LABEL_PHRASES` (P's own closed lists, pinned there).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redact } from '../index.js';
import { assertLinear } from './linear-clock.js';

const digest = (alg, enc, phrase) => createHash(alg).update(`m33 r repair 7 hunt synthetic: ${phrase}`).digest(enc);
const alnum = (phrase, n) => {
  let s = '';
  for (let i = 0; s.length < n; i++) s += digest('sha512', 'base64', `${phrase}:${i}`).replace(/[+/=]/g, '');
  return s.slice(0, n);
};
const uuidOf = (hex) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
/** A token shape with a letter and a digit in it, as every credential-shaped value here has (asserted below). */
const mixed = (s) => (/\d/.test(s) && /[A-Za-z]/.test(s) ? s : `${s.slice(0, -2)}7q`);

const HEX40 = mixed(digest('sha1', 'hex', 'the leaked shape'));
const HEX32 = mixed(digest('md5', 'hex', 'hex32'));
/** Every value shape the spec names. */
const VALUES = {
  'hex 32': HEX32,
  'hex 40 (the leaked shape)': HEX40,
  'hex 64': mixed(digest('sha256', 'hex', 'hex64')),
  base64: digest('sha256', 'base64', 'b64'),
  uuid: uuidOf(mixed(digest('sha256', 'hex', 'uuid'))),
  'sk- prefixed': `sk-${mixed(alnum('sk', 48))}`,
  'ghp_ prefixed': `ghp_${mixed(alnum('ghp', 36))}`,
  'short 12-char': mixed(alnum('twelve', 12)),
};
const SHORT = VALUES['short 12-char'];
const PASSPHRASE = 'velvet orchid tundra marble';

const gram = (value) => (value.length >= 16 ? 8 : 6);
/** Every run of `gram(value)` characters of `value` that `text` still holds (a passphrase: each of its words). */
const fragments = (text, value) => {
  if (text == null) return [];
  if (value.includes(' ')) return value.split(' ').filter((word) => String(text).includes(word));
  const n = gram(value);
  const found = [];
  for (let i = 0; i + n <= value.length; i++) if (String(text).includes(value.slice(i, i + n))) found.push(value.slice(i, i + n));
  return found;
};

// ---- the channels (repair 7's: every field a recording can put a line in) ---------------------------------------------

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
  before: { input: (t) => t, out: (o) => o.ledger.map((e) => e.before.text) },
  after: { input: (t) => t, out: (o) => o.ledger.map((e) => e.after.text) },
  'child instruction': { input: (t) => t, out: (o) => o.instructions.map((s) => s.text) },
  'delegation brief': { input: (t) => t, out: (o) => o.delegations.map((d) => d.parentInstruction.text) },
  'delegation report': { input: (t) => t, out: (o) => o.delegations.map((d) => d.finalAnswer.text) },
  "a child's received brief": { input: (t) => t, out: (o) => o.children[0].parentInstructions.map((r) => r.parentInstruction.text) },
};

/** Redact `texts` through every channel at once: `{ [channel]: [output per text] }`, and the whole result's JSON. */
function through(texts) {
  const ledger = {
    ask: texts.map((text) => ({ turn: 1, text })),
    sayings: texts.map((text) => ({ turn: 1, text })),
    commentary: texts.map((text) => ({ turn: 1, beforeEvent: 0, text })),
    claim: Object.fromEntries(texts.map((text, i) => [`m${i}`, text])),
    ledger: texts.map((text, i) => ({ turn: 1, seq: i, kind: 'create', path: 'notes.txt', cmd: text, argsExcerpt: text,
      tailLines: text.split('\n'), diff: CHANNELS.diff.input(text),
      before: { text, source: 'read', turn: 1, partial: false, truncated: false, lines: 1 },
      after: { text, truncated: false, lines: 1 } })),
    instructions: texts.map((text) => ({ turn: 1, text })),
    delegations: texts.map((text, i) => ({ adapter: 'claude', callId: `call-${i}`, turn: 1, childId: null, status: 'unresolved',
      reason: 'child_unchecked', parentInstruction: { text, tool: 'Task', field: 'prompt' }, finalAnswer: { text, record: 2, turn: 1 } })),
    children: [{ ledger: { ask: [], ledger: [] }, parentInstructions: texts.map((text) => ({ turn: 1, parentInstruction: { text } })) }],
    dropped: [],
  };
  const extra = texts.map((text, i) => ({ turn: 1, seq: texts.length + i, kind: 'bash', cmd: CHANNELS['cmd (a heredoc)'].input(text),
    tailLines: numbered(text) }));
  ledger.ledger.push(...extra);
  const result = redact(ledger);
  const out = result.ledger;
  const own = out.ledger.slice(0, texts.length);
  const more = out.ledger.slice(texts.length);
  own.forEach((e, i) => { e.heredoc = more[i].cmd ?? null; e.numberedTail = more[i].tailLines; });
  const view = { ...out, ledger: own };
  const per = Object.fromEntries(Object.entries(CHANNELS).map(([name, c]) => [name, c.out(view, texts.length)]));
  Object.defineProperty(per, 'whole', { value: JSON.stringify(result), enumerable: false });
  return per;
}

/** Every channel, cell by cell: the cells whose output still holds a fragment of their value. */
function leaksOf(cells, contexts = { 'a line of its own': (s) => s }) {
  const texts = [];
  const meta = [];
  for (const cell of cells) for (const [context, write] of Object.entries(contexts)) {
    texts.push(write(cell.text));
    meta.push({ ...cell, context });
  }
  const outs = through(texts);
  const failures = [];
  for (const [channel, list] of Object.entries(outs)) {
    list.forEach((out, i) => {
      if (meta[i].skip?.includes(channel)) return;
      if (fragments(out, meta[i].value).length) failures.push(`${channel} | ${meta[i].what} | ${meta[i].context}: ${JSON.stringify(out)}`);
    });
  }
  return failures;
}

/** One cell's output in the channels where a text is scanned as written: the prose, command and content fields. */
const SAMPLE = ['ask', 'saying', 'cmd', 'tailLines', 'argsExcerpt', 'after', 'delegation report'];

test('M33 R repair 7 hunt premise: every value shape is credential-shaped and assembled here', () => {
  for (const [shape, value] of Object.entries(VALUES)) {
    assert.match(value, /\d/, `${shape}: a digit`);
    assert.match(value, /[A-Za-z]/, `${shape}: a letter`);
    assert.ok(value.length >= 12, shape);
  }
  // Unlabelled, a hex run is kept everywhere: only its label can mask it.
  const [out] = through([`commit ${HEX40}`]).ask;
  assert.equal(out, `commit ${HEX40}`);
});

// ---- the grid: each label family x separator x value shape x channel -----------------------------------------------

/** The label families: repair 7's own, and each the hunt found leaking. */
const FAMILIES = {
  // In repair 7's spec.
  'recall api key': 'recall api key', 'OpenAI API key': 'OpenAI API key', 'stripe secret key': 'stripe secret key',
  'my github token': 'my github token', 'admin password': 'admin password', 'client secret': 'client secret',
  'recall_api_key': 'recall_api_key', 'Recall-API-Key': 'Recall-API-Key',
  // 3: a one-word label in markdown or code.
  '**Token**': '**Token**', '**Password**': '**Password**', '`token`': '`token`', '*Secret*': '*Secret*', '__Credentials__': '__Credentials__',
  // 4: `key` behind a product name or a determiner (a weaker label: its values here are all credential-shaped).
  'recall key': 'recall key', 'OpenAI key': 'OpenAI key', 'deploy key': 'deploy key', 'this key': 'this key', 'recall_key': 'recall_key',
  // 9: a qualifier after the phrase.
  'recall api key value': 'recall api key value', 'API key v2': 'API key v2', 'API key #2': 'API key #2',
  'api key in prod': 'api key in prod', 'access token string': 'access token string', 'Token value': 'Token value',
  'api key (new) value': 'api key (new) value',
  // 11: account passwords, joiners outside repair 7's list.
  'db pwd': 'db pwd', 'user pass': 'user pass', 'recall api\u00a0key (NBSP)': 'recall api\u00a0key', 'client ID/secret': 'client ID/secret',
};

/** How a value `v` follows a label `l`: one shape per form the hunt found leaking, and repair 7's own. */
const FORMS = {
  // Repair 7's separators.
  'l: v': (l, v) => `${l}: ${v}`, 'l = v': (l, v) => `${l} = ${v}`, 'l is v': (l, v) => `${l} is ${v}`, 'l -> v': (l, v) => `${l} -> ${v}`,
  'l: "v"': (l, v) => `${l}: "${v}"`, 'l: `v`': (l, v) => `${l}: \`${v}\``,
  // 7: separators outside repair 7's list, and what may stand before the value.
  'l → v': (l, v) => `${l} → ${v}`, 'l ⇒ v': (l, v) => `${l} ⇒ ${v}`, 'l — v': (l, v) => `${l} — ${v}`, 'l – v': (l, v) => `${l} – ${v}`,
  'l - v': (l, v) => `${l} - ${v}`, 'l：v': (l, v) => `${l}：${v}`, 'l := v': (l, v) => `${l} := ${v}`, 'l :: v': (l, v) => `${l} :: ${v}`,
  'l ~ v': (l, v) => `${l} ~ ${v}`, 'l > v': (l, v) => `${l} > ${v}`, 'l:- v': (l, v) => `${l}:- ${v}`,
  'l: - v': (l, v) => `${l}: - ${v}`, 'l: * v': (l, v) => `${l}: * ${v}`, 'l: 🔑 v': (l, v) => `${l}: 🔑 ${v}`, 'l: : v': (l, v) => `${l}: : ${v}`,
  'l → `v`': (l, v) => `${l} → \`${v}\``, 'l:  ```v```': (l, v) => `${l}:  \`\`\`${v}\`\`\``, 'l: &quot;v&quot;': (l, v) => `${l}: &quot;${v}&quot;`,
  'l: &lt;v&gt;': (l, v) => `${l}: &lt;${v}&gt;`, 'l: {v}': (l, v) => `${l}: {${v}}`,
  // 11: `=` glued to the label with a blank after; an escaped tab after the separator.
  'l= v': (l, v) => `${l}= ${v}`, 'l:\\t v (escaped tab)': (l, v) => `${l}:\\t${v}`,
  // 2: a word between the separator and the value; a second value.
  'l: prod v': (l, v) => `${l}: prod ${v}`, 'l: (prod) v': (l, v) => `${l}: (prod) ${v}`, 'l: new one v': (l, v) => `${l}: new one ${v}`,
  'l: rotated, new value v': (l, v) => `${l}: rotated, new value ${v}`, 'l: one sec, v': (l, v) => `${l}: one sec, ${v}`,
  'l: it is in the vault v': (l, v) => `${l}: it is in the vault ${v}`, 'l: the new key is v': (l, v) => `${l}: the new key is ${v}`,
  'l: try v': (l, v) => `${l}: try ${v}`, 'l: <hex32> and v': (l, v) => `${l}: ${HEX32} and ${v}`,
  // A value split by a blank: each half of a long value is itself credential-shaped (a short value is not split).
  'l: v1 v2 (split)': (l, v) => (v.length >= 32 ? `${l}: ${v.slice(0, v.length >> 1)} ${v.slice(v.length >> 1)}` : `${l}: ${v}`),
  // 5: verbs and chat punctuation.
  'set the l to v': (l, v) => `set the ${l} to ${v}`, 'change l to v': (l, v) => `change ${l} to ${v}`, 'l was v': (l, v) => `${l} was ${v}`,
  'l should be v': (l, v) => `${l} should be ${v}`, 'l equals v': (l, v) => `${l} equals ${v}`, 'l becomes v': (l, v) => `${l} becomes ${v}`,
  'l changed to v': (l, v) => `${l} changed to ${v}`, 'update l with v': (l, v) => `update ${l} with ${v}`, 'l, v': (l, v) => `${l}, ${v}`,
  'l (v)': (l, v) => `${l} (${v})`, 'l is now v': (l, v) => `${l} is now ${v}`, 'here is l v': (l, v) => `here is ${l} ${v}`,
  // 8: tables and HTML.
  '| l | v |': (l, v) => `| Name | Value |\n| --- | --- |\n| ${l} | ${v} |`, '|l|v|': (l, v) => `|${l}|${v}|`,
  '| l | `v` |': (l, v) => `| ${l} | \`${v}\` |`, '<td>l</td><td>v</td>': (l, v) => `<tr><td>${l}</td><td>${v}</td></tr>`,
  '<b>l</b>: v': (l, v) => `<b>${l}</b>: ${v}`, '<dt>l</dt><dd>v</dd>': (l, v) => `<dt>${l}</dt><dd>${v}</dd>`,
  // 6: the value on the next line.
  'l:\\nv': (l, v) => `${l}:\n${v}`, 'l:\\n  v': (l, v) => `${l}:\n  ${v}`, 'l:\\r\\nv': (l, v) => `${l}:\r\n${v}`,
  'Here is the l:\\n\\nv': (l, v) => `Here is the ${l}:\n\n${v}`, 'l:\\n```\\nv\\n```': (l, v) => `${l}:\n\`\`\`\n${v}\n\`\`\``,
  '## l\\n\\nv': (l, v) => `## ${l}\n\n${v}`, 'l:(escaped \\n)v': (l, v) => `{"text":"${l}:\\n${v}"}`,
  // 11: the value before its label.
  'v is my l': (l, v) => `${v} is my ${l}`, 'use v as the l': (l, v) => `use ${v} as the ${l}`,
};

/** Contexts around a few forms: in a sentence, a CRLF text, JSON-escaped text, a quoted shell string. */
const CONTEXTS = {
  'a line of its own': (s) => s,
  'mid-sentence': (s) => `Note for the sync job, ${s} and then rotate it.`,
  'CRLF text': (s) => `first\r\n${s}\r\nlast`,
  'after an escaped line break': (s) => `first line\\n${s}\\nlast line`,
  'in an echo': (s) => `echo "${s}" >> notes.txt`,
};
const CONTEXT_FORMS = ['l: v', 'l → v', 'l: prod v', 'set the l to v', 'l was v', 'l: <hex32> and v', 'l - v'];

for (const [family, label] of Object.entries(FAMILIES)) {
  test(`M33 R repair 7 hunt: "${family}" — no value shape survives any separator, form or channel`, () => {
    const cells = [];
    // A command's `NAME= <word>` with NAME one shell identifier is the shell's empty assignment before the command
    // `<word>` (every key-name shape reads it so: `API_TOKEN= ./run.sh` keeps its command), not a label and its value.
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/.test(label);
    for (const [form, give] of Object.entries(FORMS)) {
      const skip = identifier && form === 'l= v' ? ['cmd'] : [];
      for (const [shape, value] of Object.entries(VALUES)) cells.push({ what: `${form} | ${shape}`, value, text: give(label, value), skip });
    }
    const failures = leaksOf(cells);
    const inContext = [];
    for (const form of CONTEXT_FORMS) {
      for (const [shape, value] of Object.entries(VALUES)) inContext.push({ what: `${form} | ${shape}`, value, text: FORMS[form](label, value) });
    }
    failures.push(...leaksOf(inContext, CONTEXTS));
    assert.equal(failures.length, 0, `${failures.length} cells leak, first:\n${failures.slice(0, 10).join('\n')}`);
  });
}

// ---- 1. a value of several words -------------------------------------------------------------------------------------

test('M33 R repair 7 hunt 1: a passphrase after a password-family label leaves nothing of itself', () => {
  const labels = ['wifi passphrase', 'my password', 'admin password', 'gpg passphrase', 'vault passphrase', 'db pwd'];
  const cells = [];
  for (const label of labels) for (const sep of [': ', ' is ', ' = ', ' -> ', ' → ', ' — ']) {
    cells.push({ what: `${label}${sep}`, value: PASSPHRASE, text: `${label}${sep}${PASSPHRASE}` });
  }
  const failures = leaksOf(cells, CONTEXTS);
  assert.equal(failures.length, 0, `${failures.length} cells leak, first:\n${failures.slice(0, 10).join('\n')}`);
  const outs = through([`wifi passphrase: ${PASSPHRASE}`]);
  for (const channel of SAMPLE) assert.equal(outs[channel][0], 'wifi passphrase: ‹redacted:secret-value›', channel);
});

// ---- 2. the wrong word, a second value ----------------------------------------------------------------------------

test('M33 R repair 7 hunt 2: a word before the secret, or a second value, leaves nothing of the secret', () => {
  const cases = [
    [`recall api keys: ${HEX32} and ${HEX40}`, 'recall api keys: ‹redacted:secret-value› and ‹redacted:secret-value›'],
    [`recall api key: the new key is ${HEX40}`, 'recall api key: the new key is ‹redacted:secret-value›'],
    [`my api key is now 482915736048`, 'my api key is now ‹redacted:secret-value›'],
  ];
  for (const [text] of [[`recall api key: prod ${HEX40}`], [`API key: one sec, ${HEX40}`]]) {
    for (const channel of SAMPLE) assert.deepEqual(fragments(through([text])[channel][0], HEX40), [], `${channel}: ${text}`);
  }
  const outs = through(cases.map(([text]) => text));
  for (const channel of SAMPLE) cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${text}`));
});

// ---- 3. one-word labels -----------------------------------------------------------------------------------------------

test('M33 R repair 7 hunt 3: a one-word label in markdown, with what it is for, or mid-line, masks its value', () => {
  const cases = [
    [`**Token**: ${SHORT}`, '**Token**: ‹redacted:secret-value›'],
    [`- **Password**: ${SHORT}`, '- **Password**: ‹redacted:secret-value›'],
    [`\`token\`: ${SHORT}`, '`token`: ‹redacted:secret-value›'],
    [`**Token**: \`${HEX40}\``, '**Token**: `‹redacted:secret-value›`'],
    [`Password for admin: ${SHORT}`, 'Password for admin: ‹redacted:secret-value›'],
    [`token for github: ${SHORT}`, 'token for github: ‹redacted:secret-value›'],
    [`Password (prod): ${SHORT}`, 'Password (prod): ‹redacted:secret-value›'],
    [`(token: ${SHORT})`, '(token: ‹redacted:secret-value›)'],
    [`Username: admin, Password: ${SHORT}`, 'Username: admin, Password: ‹redacted:secret-value›'],
    ['Username: admin, Password: Hunter2xyz!q', 'Username: admin, Password: ‹redacted:secret-value›'],
    [`login: admin / password: ${SHORT}`, 'login: admin / password: ‹redacted:secret-value›'],
    [`user: bot | secret: ${SHORT}`, 'user: bot | secret: ‹redacted:secret-value›'],
  ];
  const outs = through(cases.map(([text]) => text));
  for (const channel of SAMPLE) cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${text}`));
});

// ---- 4. `key` alone ---------------------------------------------------------------------------------------------------

test('M33 R repair 7 hunt 4: `key` behind a product name or determiner masks a credential-shaped value only', () => {
  const masked = [
    [`recall key: ${HEX40}`, 'recall key: ‹redacted:secret-value›'],
    [`the recall key is ${HEX40}`, 'the recall key is ‹redacted:secret-value›'],
    [`use this key: ${SHORT}`, 'use this key: ‹redacted:secret-value›'],
    [`key for recall: ${SHORT}`, 'key for recall: ‹redacted:secret-value›'],
    [`Recall-Key: ${HEX40}`, 'Recall-Key: ‹redacted:secret-value›'],
    [`webhook key = ${VALUES.uuid}`, 'webhook key = ‹redacted:secret-value›'],
  ];
  const kept = ['primary key: id', 'sort key: name', 'foreign key: user_id', 'the key is to keep it simple', 'partition key: tenant_id',
    'use this key: see below', 'key for recall: none', 'the recall key is missing', 'press the esc key -> nothing happens'];
  const outs = through([...masked.map(([text]) => text), ...kept]);
  for (const channel of SAMPLE) {
    masked.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${text}`));
    kept.forEach((text, j) => assert.equal(outs[channel][masked.length + j], CHANNELS[channel].input(text), `${channel}: ${text}`));
  }
});

// ---- 5. verbs -------------------------------------------------------------------------------------------------------

test('M33 R repair 7 hunt 5: a label joined to its value by a verb or chat punctuation masks a credential-shaped value', () => {
  const cases = [
    [`Please set the recall api key to ${HEX40}`, 'Please set the recall api key to ‹redacted:secret-value›'],
    [`my api key was ${SHORT}`, 'my api key was ‹redacted:secret-value›'],
    [`the API key should be ${SHORT}.`, 'the API key should be ‹redacted:secret-value›.'],
    [`RECALL_API_KEY, ${HEX40}`, 'RECALL_API_KEY, ‹redacted:secret-value›'],
    [`RECALL_API_KEY, \`${HEX40}\``, 'RECALL_API_KEY, `‹redacted:secret-value›`'],
    [`**Token**, \`${HEX40}\``, '**Token**, `‹redacted:secret-value›`'],
    [`the API key (${SHORT})`, 'the API key (‹redacted:secret-value›)'],
    [`update the github token with ${SHORT} today`, 'update the github token with ‹redacted:secret-value› today'],
    // After what the label is for: a joining verb is the separator, not a word of what it is for.
    [`set the api key for prod to ${HEX40}`, 'set the api key for prod to ‹redacted:secret-value›'],
    ['the password for the db is KmnZLFx8HyS2', 'the password for the db is ‹redacted:secret-value›'],
  ];
  const outs = through(cases.map(([text]) => text));
  for (const channel of SAMPLE) cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${text}`));
});

// ---- 6. the next line -------------------------------------------------------------------------------------------------

test('M33 R repair 7 hunt 6: the value on the line after its label is masked where it stands', () => {
  const cases = [
    [`Here is my recall api key:\n${HEX40}`, 'Here is my recall api key:\n‹redacted:secret-value›'],
    [`API key:\n  ${SHORT}\nregion: eu`, 'API key:\n  ‹redacted:secret-value›\nregion: eu'],
    [`## Recall API key\n\n${HEX40}`, '## Recall API key\n\n‹redacted:secret-value›'],
    [`recall api key:\n\`\`\`\n${HEX40}\n\`\`\``, 'recall api key:\n```\n‹redacted:secret-value›\n```'],
    [`**Token:**\n\`${HEX40}\``, '**Token:**\n`‹redacted:secret-value›`'],
  ];
  const outs = through(cases.map(([text]) => text));
  for (const channel of ['ask', 'saying', 'tailLines', 'after', 'delegation report']) {
    cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${text}`));
  }
  // A line that is not a lone credential stays: a heading's prose, a YAML mapping under a label, a list.
  const kept = ['## API key\n\nCreate one in the dashboard.', 'API key:\n\nSet it in the dashboard first.', 'API key:\n- create one\n- paste it',
    'credentials:\n  username: admin\n  region: eu', 'Token:\n  see the vault'];
  const keptOut = through(kept);
  for (const [channel, list] of Object.entries(keptOut)) kept.forEach((text, i) => assert.equal(list[i], CHANNELS[channel].input(text), `${channel}: ${text}`));
});

// ---- 9. qualifiers ----------------------------------------------------------------------------------------------------

test('M33 R repair 7 hunt 9: a qualifier, a long `for` target or a nested parenthetical after the label keeps it a label', () => {
  const cases = [
    [`recall api key value: ${HEX40}`, 'recall api key value: ‹redacted:secret-value›'],
    [`API key 2: ${SHORT}`, 'API key 2: ‹redacted:secret-value›'],
    [`api key used: ${SHORT}`, 'api key used: ‹redacted:secret-value›'],
    [`api key for the staging environment of recall: ${HEX40}`, 'api key for the staging environment of recall: ‹redacted:secret-value›'],
    [`api key (rotated on the first monday of the month, ok): ${HEX40}`, 'api key (rotated on the first monday of the month, ok): ‹redacted:secret-value›'],
    [`api key (prod (eu)): ${HEX40}`, 'api key (prod (eu)): ‹redacted:secret-value›'],
  ];
  const outs = through(cases.map(([text]) => text));
  for (const channel of SAMPLE) cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${text}`));
  // A count, a limit or a length after `token` is no value.
  const kept = ['Token count: 4096', 'token limit: 8192', 'API key length: 40', 'token usage: 12k', 'token budget: 200000'];
  const keptOut = through(kept);
  for (const channel of SAMPLE) kept.forEach((text, i) => assert.equal(keptOut[channel][i], CHANNELS[channel].input(text), `${channel}: ${text}`));
});

// ---- 10. commands and name/value pairs -------------------------------------------------------------------------------

test('M33 R repair 7 hunt 10: a secret keyed by a name in a command, or by a name/value pair, is masked', () => {
  const cases = [
    [`gh secret set RECALL_API_KEY --body ${HEX40}`, 'gh secret set RECALL_API_KEY --body ‹redacted:secret-value›'],
    [`gh secret set RECALL_API_KEY -b"${HEX40}"`, 'gh secret set RECALL_API_KEY -b"‹redacted:secret-value›"'],
    [`gh secret set RECALL_API_KEY --body=${SHORT} --repo o/r`, 'gh secret set RECALL_API_KEY --body=‹redacted:secret-value› --repo o/r'],
    [`echo ${HEX40} | vercel env add RECALL_API_KEY production`, 'echo ‹redacted:secret-value› | vercel env add RECALL_API_KEY production'],
    [`printf '%s' '${HEX40}' | wrangler secret put RECALL_API_KEY`, "printf '%s' '‹redacted:secret-value›' | wrangler secret put RECALL_API_KEY"],
    [`echo -n "${SHORT}" | gh secret set RECALL_API_KEY`, 'echo -n "‹redacted:secret-value›" | gh secret set RECALL_API_KEY'],
    [`security add-generic-password -a me -s recall -w ${HEX40}`, 'security add-generic-password -a me -s recall -w ‹redacted:secret-value›'],
    [`npm config set //registry.npmjs.org/:_authToken ${HEX40}`, 'npm config set //registry.npmjs.org/:_authToken ‹redacted:secret-value›'],
    [`env:\n  - name: RECALL_API_KEY\n    value: ${HEX40}`, 'env:\n  - name: RECALL_API_KEY\n    value: ‹redacted:secret-value›'],
    [`env:\n  - name: RECALL_API_KEY\n    value: "${SHORT}"`, 'env:\n  - name: RECALL_API_KEY\n    value: "‹redacted:secret-value›"'],
    [`- {name: RECALL_API_KEY, value: ${HEX40}}`, '- {name: RECALL_API_KEY, value: ‹redacted:secret-value›}'],
    [`{"name": "recall api key", "value": "${HEX40}"}`, '{"name": "recall api key", "value": "‹redacted:secret-value›"}'],
    [`variable "recall_api_key" {\n  default = "${HEX40}"\n}`, 'variable "recall_api_key" {\n  default = "‹redacted:secret-value›"\n}'],
  ];
  const outs = through(cases.map(([text]) => text));
  for (const channel of ['cmd', 'ask', 'tailLines', 'after', 'argsExcerpt']) {
    cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${text}`));
  }
  const kept = ['gh secret set RECALL_API_KEY --body "$RECALL_API_KEY"', 'echo $RECALL_API_KEY | vercel env add RECALL_API_KEY production',
    "printf '%s' \"$TOKEN\" | wrangler secret put RECALL_API_KEY", 'security add-generic-password -a me -s recall -w',
    "npm config set //registry.npmjs.org/:_authToken '${NPM_TOKEN}'", 'gh pr create --body "fix the parser" --title fix',
    'echo hello | tee notes.txt', 'npm config set registry https://registry.npmjs.org/',
    'env:\n  - name: RECALL_API_KEY\n    valueFrom:\n      secretKeyRef:\n        name: recall\n        key: api-key',
    'env:\n  - name: LOG_LEVEL\n    value: debug', 'env:\n  - name: RECALL_API_KEY\n    value: ${RECALL_API_KEY}',
    'variable "recall_api_key" {\n  type      = string\n  sensitive = true\n}', 'variable "region" {\n  default = "eu-west-1"\n}',
    '{"name": "region", "value": "eu-west-1"}'];
  const keptOut = through(kept);
  for (const [channel, list] of Object.entries(keptOut)) kept.forEach((text, i) => assert.equal(list[i], CHANNELS[channel].input(text), `${channel}: ${text}`));
});

// ---- 11. the minor shapes ---------------------------------------------------------------------------------------------

test('M33 R repair 7 hunt 11: a glued `=` after a label of words, an escaped tab, joiners, account passwords, a value before its label', () => {
  const cases = [
    [`Use my recall api key= ${HEX40} for the sync.`, 'Use my recall api key= ‹redacted:secret-value› for the sync.'],
    [`{"notes":"recall api key:\\t${HEX40}"}`, '{"notes":"recall api key:\\t‹redacted:secret-value›"}'],
    [`recall api\u00a0key: ${HEX40}`, 'recall api\u00a0key: ‹redacted:secret-value›'],
    [`recall api\u202fkey: ${HEX40}`, 'recall api\u202fkey: ‹redacted:secret-value›'],
    [`recall api\u200bkey: ${HEX40}`, 'recall api\u200bkey: ‹redacted:secret-value›'],
    [`recall api       key: ${HEX40}`, 'recall api       key: ‹redacted:secret-value›'],
    [`client ID/secret: ${SHORT}`, 'client ID/secret: ‹redacted:secret-value›'],
    [`db pwd: hunter2x`, 'db pwd: ‹redacted:secret-value›'],
    [`user pass ${SHORT}`, 'user pass ‹redacted:secret-value›'],
    [`${HEX40} is my recall api key`, '‹redacted:secret-value› is my recall api key'],
    [`use ${SHORT} as the api key`, 'use ‹redacted:secret-value› as the api key'],
    [`recall api key: ${HEX40.slice(0, 20)} ${HEX40.slice(20)}`, 'recall api key: ‹redacted:secret-value› ‹redacted:secret-value›'],
    [`const cfg = { apiKey: '${SHORT}' };`, "const cfg = { apiKey: '‹redacted:secret-value›' };"],
    [`cfg := Config{APIKey: "${SHORT}"}`, 'cfg := Config{APIKey: "‹redacted:secret-value›"}'],
  ];
  const outs = through(cases.map(([text]) => text));
  for (const channel of SAMPLE) cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${text}`));
  // The shell's empty assignment stays one in a command, as every key-name shape reads it.
  const cmd = redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'API_TOKEN= ./run.sh' }] }).ledger.ledger[0].cmd;
  assert.equal(cmd, 'API_TOKEN= ./run.sh');
});

test('M33 R repair 7 hunt 11: a one-word name glued to `=` with a blank after it — a command, a name the shell cannot read, prose', () => {
  const cmds = (list) => redact({ ask: [], ledger: list.map((cmd, seq) => ({ turn: 1, seq, kind: 'bash', cmd })) }).ledger.ledger.map((e) => e.cmd);
  // In a command, a shell identifier: the empty assignment, its command kept whatever it is.
  // A name the shell cannot assign (`-`, `.`): a credential-shaped word after it is masked, a command is not.
  // A placeholder after the `=` stays whole (`***` is the one rule's), and the command after it with it.
  const kept = ['API_TOKEN= ./run.sh', 'X-Api-Key= ./run.sh', 'my.secret= ./run.sh', 'db_pwd=*** ./run.sh', 'DB_SECRET=*** ./run.sh'];
  assert.deepEqual(cmds(kept), kept);
  assert.deepEqual(cmds([`Recall-API-Key= ${HEX40}`, `my.secret= ${SHORT} --verbose`]),
    ['Recall-API-Key= ‹redacted:secret-value›', 'my.secret= ‹redacted:secret-value› --verbose']);
  // Outside a command no field runs one: a credential-shaped word after the name is masked.
  const [ask] = through([`Use API_TOKEN= ${SHORT} for the sync.`]).ask;
  assert.deepEqual(fragments(ask, SHORT), []);
});

test('M33 R repair 7 hunt 7: a one-word label at a line\'s head before an arrow, a dash or `is`, and a value before a bracketed label', () => {
  const cases = [
    [`Token → ${HEX40}`, 'Token → ‹redacted:secret-value›'],
    [`Token is ${HEX40}`, 'Token is ‹redacted:secret-value›'],
    [`- Secret — ${SHORT}`, '- Secret — ‹redacted:secret-value›'],
    ['Password — hunter2xyz', 'Password — ‹redacted:secret-value›'],
    ['Password is hunter2xyz', 'Password is ‹redacted:secret-value›'],
    [`${HEX40} (recall api key)`, '‹redacted:secret-value› (recall api key)'],
    [`use ${SHORT} (the api key) now`, 'use ‹redacted:secret-value› (the api key) now'],
    [`${HEX40} <- recall api key`, '‹redacted:secret-value› <- recall api key'],
  ];
  const outs = through(cases.map(([text]) => text));
  for (const channel of SAMPLE) cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${text}`));
});

// ---- prose stays usable -----------------------------------------------------------------------------------------------

/** Prose, code and placeholders around the new shapes: each kept byte for byte in every channel. */
const PROSE = [
  // Repair 7's own controls (m33-r-repair-7.test.js pins them too).
  'api key: see the docs', 'api key: <your key here>', 'API key: none', 'OpenAI API key: $OPENAI_API_KEY', 'recall api key: ${RECALL_API_KEY}',
  'The OpenAI API key is not set.', 'my github token is stored in the keychain', 'the access token is valid for 3600s',
  'Unexpected token: }', 'max tokens: 4096', 'print("API key:", key)', 'if self.api_key is not None:', 'first pass: compile everything',
  // A label then prose, after each new separator and form.
  'API key → see the docs', 'Password — required', 'my github token - see the vault', 'the recall api key ⇒ see the docs',
  'recall api key value: <your key here>', 'API key 2: none', 'access token string: see the docs',
  'recall api key: see the docs, then rotate it', 'Username: admin, Password: see the vault', 'Username: admin, Password: required',
  'set the api key to your own value', 'the API key should be rotated monthly', 'update the api key with care', 'my api key was revoked',
  'Password for admin: see the vault', '**Token**: see below', 'wifi passphrase: not set',
  // Code: a type, a call, a parameter list, a template.
  'function login(user: string, password: string) {', '(token: string) => void', 'const props = { token: string, secret: boolean };',
  'the deploy token: {{ secrets.GH_TOKEN }}', 'API key = <YOUR_API_KEY>',
  // Tables and HTML with no credential in them.
  '| Token | Description |', '| Name | Value |\n| --- | --- |\n| Password | required |', '<td>API key</td><td>see the docs</td>',
  '<b>Token</b>: see the dashboard',
  // Counts and lengths after `token`, and `key` with no credential after it.
  'Token count: 4096', 'token usage: 12k', 'primary key: id', 'sort key: name', 'the key is to keep it simple', 'hotkey: ctrl+k',
  // A hash or identifier with no label near it.
  'commit 3f9a2b1c4d5e is my last commit', 'the build 482915736048 passed',
  // Prose and code the repair's first draft masked: a dash in prose after a label word, a list of names in backticks
  // after one, a call whose argument names a key, a test's expectation under `pass`, a one-word label at a line's head
  // before prose.
  'plaintext credentials — 0.4% of the example rows carry one.',
  'inside a longer name (`DB_PASSWORD`, `x-api-key`, `2FA_SECRET`) — whether the value',
  'if (!exactKeys(ref, FIELDS) || !isHex64(ref.key)) return false;', ".run('pytest tests/test_rl.py', { pass: '4 passed in 0.3s' })",
  'Token is valid until Monday', 'Password is required', 'Secret → see the vault', 'Token - see the docs',
  'The api key for staging lives in 1Password.',
  // A statement or a comment ends what a label's scan reads (`;`, `//`, `#`).
  'const key = loadKey();   // W3E1_OLD_LOADER', 'key = load_key()  # W3E1_OLD_LOADER',
];

test('M33 R repair 7 hunt: prose, code and placeholders around every new shape are kept byte for byte in every channel', () => {
  const outs = through(PROSE);
  const failures = [];
  for (const [channel, list] of Object.entries(outs)) {
    list.forEach((out, i) => { if (out !== CHANNELS[channel].input(PROSE[i])) failures.push(`${channel}: ${JSON.stringify(PROSE[i])} -> ${JSON.stringify(out)}`); });
  }
  assert.equal(failures.length, 0, `${failures.length} prose cells changed, first:\n${failures.slice(0, 10).join('\n')}`);
});

// ---- the whole result, idempotence, time ----------------------------------------------------------------------------

test('M33 R repair 7 hunt: nothing of a value reaches any part of the result (the ledger and `dropped`)', () => {
  const texts = [];
  const values = [];
  for (const form of ['l: prod v', 'l → v', 'set the l to v', '| l | v |', 'l:\\nv', 'v is my l']) {
    for (const label of ['recall api key', '**Token**', 'recall key']) { texts.push(FORMS[form](label, HEX40)); values.push(HEX40); }
  }
  const per = through(texts);
  assert.deepEqual(fragments(per.whole, HEX40), []);
});

test('M33 R repair 7 hunt: redaction is idempotent and deterministic over the new shapes', () => {
  const texts = Object.values(FORMS).flatMap((give) => ['recall api key', '**Token**', 'recall key'].map((label) => give(label, HEX40)));
  const once = through(texts);
  const twice = through(once.ask);
  assert.deepEqual(twice.ask, once.ask, 'f(f(x)) === f(x)');
  assert.deepEqual(through(texts), once, 'the same bytes twice');
});

test('M33 R repair 7 hunt: a megabyte of the new shapes on one line is read in linear time', () => {
  const unit = 'the recall key: abc | Token | x → recall api key value: abc set the api key to abc ';
  const line = `${unit.repeat(Math.ceil(1_000_000 / unit.length))}`;
  // 20 s of CPU each, scaled by the slowdown measured under load (linear-clock.js), never a wall-clock limit.
  assertLinear(() => redact({ ask: [{ turn: 1, text: line }],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: line, tailLines: [line] }] }), 20_000, 'one line');
  const many = Array.from({ length: 20_000 }, (_, i) => (i % 2 ? 'API key:' : 'see the docs')).join('\n');
  const ledger = () => [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat x', tailLines: many.split('\n') }];
  assertLinear(() => redact({ ask: [], ledger: ledger() }), 20_000, 'many label lines');
});
