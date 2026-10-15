// M33 R repair 8 — the PROXIMITY rule (P) replaces repair 7's label grammar (shape N). The lead's decision after two
// leak hunts over repair 7: each found more families of leaking phrasings, the repair of the first included (a Unicode
// space at the separator; password values after verbs; one-word labels mid-line; `for` clauses with emails, URLs and
// scopes; relative clauses; next-line values without a separator; commands that set a secret; key/value data formats),
// while over-masking of benign lines in those shapes grew. A phrasing grammar does not converge. P reads no phrasing: on a line holding a word of the secret vocabulary (and the 2
// non-blank lines after a line that ends at one), every credential-shaped token is masked; after a password-family word,
// its value whatever its shape; commands that set a secret by name give up their value.
//
// This file pins, in every channel a recording can put a line in (17, as repair 7's tests read them):
//   - every probe family of BOTH hunts of repair 7, as the hunts wrote them (their probe descriptions, ported here with
//     synthetic values of the same shapes): nothing of a value survives;
//   - the rule's pieces (vocabulary, scope, shapes, exemptions, the password family, commands), each with exact bytes;
//   - that every older layer's bytes and labels stand, and the shell exceptions (`$NAME=`, `NAME= cmd`);
//   - the OVER-MASK BUDGET on a benign corpus (redact/test/m33-r-repair-8-benign.js): at least 90% of its lines kept
//     byte for byte, every line that is not listed;
//   - idempotence, determinism, the closed reason vocabulary, and linear time on megabyte lines.
//
// Synthetic text only: every value is a digest of a fixed phrase or assembled here. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  redact, REDACTION_REASONS, PROXIMITY_STRONG, PROXIMITY_PASSWORD, PROXIMITY_WEAK, PROXIMITY_CASED, PROXIMITY_LINE_HEAD,
  PROXIMITY_PLAIN_KEYS, PROXIMITY_TAIL_WORDS, PROXIMITY_JOINERS, PROXIMITY_STOP, PROXIMITY_PROSE, PROXIMITY_TECH_WORDS,
} from '../index.js';
import { BENIGN_DOCUMENTS } from './m33-r-repair-8-benign.js';
import { assertLinear } from './linear-clock.js';

const digest = (alg, enc, phrase) => createHash(alg).update(`m33 r repair 8 synthetic: ${phrase}`).digest(enc);
const hexOf = (n, p) => { let s = ''; for (let i = 0; s.length < n; i++) s += digest('sha256', 'hex', `${p}:${i}`); return s.slice(0, n); };
const alnum = (p, n) => { let s = ''; for (let i = 0; s.length < n; i++) s += digest('sha512', 'base64', `${p}:${i}`).replace(/[+/=]/g, ''); return s.slice(0, n); };
/** A shape with a letter and a digit, as the hunts' credential-shaped values have. */
const mixed = (s) => (/\d/.test(s) && /[A-Za-z]/.test(s) ? s : `${s.slice(0, -2)}7q`);
const uuidOf = (hex) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;

/** The hunts' value shapes, each invented here. */
const VALUES = {};
for (let n = 7; n <= 64; n++) VALUES[`hex${n}`] = mixed(hexOf(n, `hex${n}`));
Object.assign(VALUES, {
  'HEX40 upper': mixed(hexOf(40, 'HEX40')).toUpperCase(),
  b64std: digest('sha256', 'base64', 'b64std'),                 // 44, with + / =
  b64short: mixed(alnum('b64short', 24)),
  b64url: digest('sha256', 'base64url', 'b64url'),              // 43, - and _
  uuid: uuidOf(mixed(hexOf(32, 'uuid'))),
  'sk-': `sk-${mixed(alnum('sk', 32))}`,
  ghp_: `ghp_${mixed(alnum('ghp', 36))}`,
  short12: mixed(alnum('short12', 12)),
  short8: `${alnum('short8', 6)}7q`,
  digits12: String(BigInt(`0x${hexOf(12, 'digits')}`) % 1000000000000n).padStart(12, '7'),
  symbols: `Zq${alnum('sym', 6)}!#9&x`,
  passphrase: 'velvet orchid tundra marble',
  // Hunt 2's: what the backstop lets through, and human passwords.
  lower12: 'mxkqpzrt7vbn',
  azure20: 'a8Q~kZ.x1Yp_Rt3mN9qW',
  pw_sunshine1: 'sunshine1', pw_hunter22: 'hunter22', pw_letmein: 'letmein', pw_bluefish: 'bluefish', pw_dragon12: 'dragon12',
  pw_Winter24: 'Winter24!', phrase: 'velvet orchid tundra marble', phrase_prose: 'the purple elephant dances',
});
const pick = (names) => Object.fromEntries(names.map((n) => [n, VALUES[n]]));

/** Every 8-character run of `value` (all of it when shorter) that `text` still holds. */
const fragments = (text, value) => {
  if (text == null) return [];
  const n = Math.min(8, value.length);
  const found = [];
  for (let i = 0; i + n <= value.length; i++) if (String(text).includes(value.slice(i, i + n))) found.push(value.slice(i, i + n));
  return found;
};

// ---- the channels -----------------------------------------------------------------------------------------------------

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

/** Redact `texts` through every channel at once: `{ [channel]: [output per text] }` (and the result's `dropped`). */
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
  Object.defineProperty(per, 'dropped', { value: result.dropped, enumerable: false });
  Object.defineProperty(per, 'whole', { value: JSON.stringify(result), enumerable: false });
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
        if (fragments(out, batch[k].value).length) failures.push(`${channel} | ${batch[k].form} | ${batch[k].vname} | ${batch[k].context ?? 'line'}: ${JSON.stringify(out).slice(0, 160)}`);
      });
    }
  }
  return failures;
}
const byFamily = (probes) => {
  const map = new Map();
  for (const p of probes) map.set(p.family, [...(map.get(p.family) ?? []), p]);
  return map;
};

// ---- hunt 1: the probe families of repair 7's first hunt -----------------------------------------------------------

function firstHunt() {
  const CORE = pick(['hex7', 'hex12', 'hex16', 'hex24', 'hex32', 'hex40', 'hex64', 'HEX40 upper', 'b64std', 'b64short', 'b64url', 'uuid',
    'sk-', 'ghp_', 'short12', 'short8', 'digits12', 'symbols']);
  const SMALL = pick(['hex40', 'b64std', 'uuid', 'short12', 'digits12', 'hex7']);
  const CONTEXTS = {
    line: (s) => s,
    mid: (s) => `Note for the sync job, ${s} and then rotate it.`,
    crlf: (s) => `first\r\n${s}\r\nlast`,
    escaped: (s) => `first line\\n${s}\\nlast line`,
    echo: (s) => `echo "${s}" >> notes.txt`,
  };
  const LABELS = ['recall api key', 'OpenAI API key', 'stripe secret key', 'my github token', 'admin password', 'aws credentials',
    'webhook secret', 'client secret', 'access token', 'auth token', 'bearer token', 'private key', 'signing key', 'wifi passphrase',
    'db password', 'api key', 'secret key', 'access key', 'refresh token', 'recall-api-key', 'recall_api_key', 'recall.api.key',
    'RECALL API KEY', "Recall's API key", 'the recall api key', 'my recall api key', 'our prod stripe secret key'];
  const SEPS = {
    ': ': (l, v) => `${l}: ${v}`, ':': (l, v) => `${l}:${v}`, ' = ': (l, v) => `${l} = ${v}`, '=': (l, v) => `${l}=${v}`,
    ' is ': (l, v) => `${l} is ${v}`, ' -> ': (l, v) => `${l} -> ${v}`, ' => ': (l, v) => `${l} => ${v}`,
    '**l**: ': (l, v) => `**${l}**: ${v}`, '**l:** ': (l, v) => `**${l}:** ${v}`, '`l`: ': (l, v) => `\`${l}\`: ${v}`,
    '"l": "v"': (l, v) => `"${l}": "${v}"`, 'l = "v"': (l, v) => `${l} = "${v}"`, 'l: `v`': (l, v) => `${l}: \`${v}\``,
    'l -> v.': (l, v) => `${l} -> ${v}.`, 'l: v,': (l, v) => `${l}: ${v}, region eu`,
  };
  const F = [];
  const add = (family, form, vname, context, text) => F.push({ family, form, vname, value: VALUES[vname] ?? vname, context, text });
  const addV = (family, form, vname, value, context, text) => F.push({ family, form, vname, value, context, text });
  for (const l of LABELS) for (const [sep, give] of Object.entries(SEPS)) for (const [vn, v] of Object.entries(SMALL)) add('1 label x separator', `${l}|${sep}`, vn, 'line', give(l, v));
  for (const l of ['recall api key', 'OpenAI API key', 'my github token', 'wifi passphrase']) for (const [vn, v] of Object.entries(CORE))
    for (const [cn, cx] of Object.entries(CONTEXTS)) add('1 value x context', l, vn, cn, cx(`${l}: ${v}`));
  for (let n = 7; n <= 64; n++) for (const [cn, cx] of Object.entries(CONTEXTS)) add('1 the leaked shape, hex 7..64', 'recall api key: ', `hex${n}`, cn, cx(`recall api key: ${VALUES[`hex${n}`]}`));
  for (const l of ['wifi passphrase', 'my password', 'admin password', 'gpg passphrase', 'vault passphrase'])
    for (const sep of [': ', ' is ', ' = ']) for (const [cn, cx] of Object.entries(CONTEXTS)) add('1 passphrase', `${l}${sep}`, 'passphrase', cn, cx(`${l}${sep}${VALUES.passphrase}`));
  for (const l of ['recall api key', 'OpenAI API key', 'my github token']) for (const filler of ['new one', 'prod', '(prod)', 'copy', 'value', 'live', 'rotated, new value', 'here it is', 'try'])
    for (const [vn, v] of Object.entries(SMALL)) add('1 filler word before the value', `${l}: ${filler}`, vn, 'line', `${l}: ${filler} ${v}`);
  for (const l of ['recall api key', 'api keys', 'access tokens']) for (const join of [' and ', ', ', ' / ', ' or ', ' (prod), '])
    addV('1 second value on the line', `${l}${join}`, 'hex40', VALUES.hex40, 'line', `${l}: ${VALUES.hex32}${join}${VALUES.hex40}`);
  for (const l of ['recall key', 'OpenAI key', 'Anthropic key', 'deploy key', 'license key', 'ssh key', 'app key', 'the key', 'this key', 'my key', 'webhook key', 'recall_key', 'Recall-Key'])
    for (const sep of [': ', ' is ', ' = ', '**l**: ']) for (const [vn, v] of Object.entries(SMALL)) add('1 `key` behind a word', `${l}|${sep}`, vn, 'line', SEPS[sep](l, v));
  for (const [vn, v] of Object.entries(SMALL)) {
    add('1 `key` behind a word', 'use this key', vn, 'line', `use this key: ${v}`);
    add('1 `key` behind a word', 'key for recall', vn, 'line', `key for recall: ${v}`);
    add('1 `key` behind a word', 'the recall key is', vn, 'line', `the recall key is ${v}`);
  }
  const ONE = { '**w**: ': (w, v) => `**${w}**: ${v}`, '**w:** ': (w, v) => `**${w}:** ${v}`, '`w`: ': (w, v) => `\`${w}\`: ${v}`,
    '- **w**: ': (w, v) => `- **${w}**: ${v}`, '__w__: ': (w, v) => `__${w}__: ${v}`, '*w*: ': (w, v) => `*${w}*: ${v}`,
    'w for github: ': (w, v) => `${w} for github: ${v}`, 'w (prod): ': (w, v) => `${w} (prod): ${v}`, '(w: v)': (w, v) => `(${w}: ${v})`,
    'see w: ': (w, v) => `see ${w}: ${v}` };
  for (const w of ['Token', 'Password', 'Secret', 'Passphrase', 'Credentials', 'token', 'password', 'APIKEY', 'Apikey'])
    for (const [form, give] of Object.entries(ONE)) for (const [vn, v] of Object.entries(SMALL)) add('1 one-word label in markdown or code', `${w}|${form}`, vn, 'line', give(w, v));
  for (const l of ['recall api key value', 'API key 2', 'api key v2', 'API key used', 'access token string', 'Token value', 'secret value',
    'api key prod', 'api key (new) value', 'API key ID/secret', 'api key in prod', 'API key #2', 'api key copy'])
    for (const [vn, v] of Object.entries(SMALL)) add('1 qualifier after the label', l, vn, 'line', `${l}: ${v}`);
  const VERBS = { 'set L to v': (l, v) => `set ${l} to ${v}`, 'L was v': (l, v) => `${l} was ${v}`, 'L should be v': (l, v) => `${l} should be ${v}`,
    'L equals v': (l, v) => `${l} equals ${v}`, 'change L to v': (l, v) => `change ${l} to ${v}`, 'L changed to v': (l, v) => `${l} changed to ${v}`,
    'update L with v': (l, v) => `update ${l} with ${v}`, 'L: set to v': (l, v) => `${l}: set to ${v}`, 'L is now v': (l, v) => `${l} is now ${v}`,
    'here is L v': (l, v) => `here is ${l} ${v}`, 'use this L: v': (l, v) => `use this ${l.replace(/^the |^my /, '')}: ${v}`,
    'L, v': (l, v) => `${l}, ${v}`, 'L (v)': (l, v) => `${l} (${v})` };
  for (const l of ['the recall api key', 'my api key', 'the OpenAI API key', 'RECALL_API_KEY', 'the github token', 'the admin password'])
    for (const [form, give] of Object.entries(VERBS)) for (const [vn, v] of Object.entries(SMALL)) add('1 a verb or chat punctuation', `${l}|${form}`, vn, 'line', give(l, v));
  for (const l of ['recall api key', 'my github token', 'OpenAI API key'])
    for (const sep of [' → ', ' ⇒ ', ' — ', ' – ', ' - ', '：', ' :: ', ' ~ ', ':- ', ' := ', ' : ', '\t', ' > '])
      for (const [vn, v] of Object.entries(SMALL)) add('1 other separators', `${l}|${JSON.stringify(sep)}`, vn, 'line', `${l}${sep}${v}`);
  const CELLS = { '| L | v |': (l, v) => `| ${l} | ${v} |`, '|L|v|': (l, v) => `|${l}|${v}|`, '| **L** | `v` |': (l, v) => `| **${l}** | \`${v}\` |`,
    '<td>L</td><td>v</td>': (l, v) => `<td>${l}</td><td>${v}</td>`, '<b>L</b>: v': (l, v) => `<b>${l}</b>: ${v}`,
    '<dt>L</dt><dd>v</dd>': (l, v) => `<dt>${l}</dt><dd>${v}</dd>` };
  for (const l of ['recall api key', 'API key', 'Token', 'Password', 'my github token'])
    for (const [form, give] of Object.entries(CELLS)) for (const [vn, v] of Object.entries(SMALL)) add('1 tables and HTML', `${l}|${form}`, vn, 'line', give(l, v));
  const NEXT = { 'L:\\nv': (l, v) => `${l}:\n${v}`, 'L:\\n  v': (l, v) => `${l}:\n  ${v}`, 'L:\\r\\nv': (l, v) => `${l}:\r\n${v}`,
    'here is L:\\n\\nv': (l, v) => `here is the ${l}:\n\n${v}`, 'L:\\n```\\nv\\n```': (l, v) => `${l}:\n\`\`\`\n${v}\n\`\`\`` };
  for (const l of ['recall api key', 'My GitHub token', 'API key', 'Password'])
    for (const [form, give] of Object.entries(NEXT)) for (const [vn, v] of Object.entries(SMALL)) add('1 the value on the next line', `${l}|${form}`, vn, 'line', give(l, v));
  const BEFORE = { 'v is my L': (l, v) => `${v} is my ${l}`, 'use v as the L': (l, v) => `use ${v} as the ${l}`, 'v (L)': (l, v) => `${v} (${l})`,
    'v <- L': (l, v) => `${v} <- ${l}` };
  for (const l of ['recall api key', 'API key', 'github token'])
    for (const [form, give] of Object.entries(BEFORE)) for (const [vn, v] of Object.entries(SMALL)) add('1 the value before its label', `${l}|${form}`, vn, 'line', give(l, v));
  const DATA = { yaml: (v) => `recall api key: ${v}`, 'yaml quoted': (v) => `"recall api key": "${v}"`, json: (v) => `{"recall api key": "${v}", "region": "eu"}`,
    'json escaped': (v) => `{\\"recall api key\\": \\"${v}\\"}`, toml: (v) => `recall_api_key = "${v}"`, 'ini section': (v) => `[recall]\napi key = ${v}`,
    'ini spaced': (v) => `Recall API Key = ${v}`, '.env': (v) => `RECALL_API_KEY=${v}`, 'env export': (v) => `export RECALL_API_KEY="${v}"`,
    'yaml nested': (v) => `recall:\n  api key: ${v}`, 'yaml list': (v) => `- name: recall\n  api key: ${v}`,
    'json key/value pair': (v) => `{"name": "recall api key", "value": "${v}"}`, 'yaml key/value pair': (v) => `- name: recall api key\n  value: ${v}`,
    'kv glued =': (v) => `recall api key= ${v}`, 'python kwarg': (v) => `client = Recall(api_key="${v}")`, 'js object': (v) => `const cfg = { recallApiKey: '${v}' };`,
    'go struct': (v) => `cfg := Config{APIKey: "${v}"}`, header: (v) => `X-Recall-Api-Key: ${v}`, 'curl header': (v) => `curl -H "x-api-key: ${v}" https://api.example.test`,
    'cli flag spaced': (v) => `recall --api-key ${v} sync`, 'url query': (v) => `https://api.example.test/sync?api_key=${v}&x=1` };
  for (const [form, give] of Object.entries(DATA)) for (const [vn, v] of Object.entries(SMALL))
    for (const [cn, cx] of Object.entries({ line: CONTEXTS.line, crlf: CONTEXTS.crlf })) add('1 structured formats', form, vn, cn, cx(give(v)));
  for (const l of ['my api key', 'the recall api key', 'my github token'])
    for (const [vn, v] of Object.entries(pick(['digits12', 'short8', 'symbols', 'hex7', 'b64std', 'uuid']))) add('1 no separator', l, vn, 'line', `here is ${l} ${v}`);
  for (const l of ['pwd', 'db pwd', 'user pass', 'pass', 'db_pwd', 'DB PWD', 'login pwd']) for (const sep of [': ', ' = ', ' '])
    for (const [vn, v] of Object.entries(pick(['short12', 'symbols', 'hex40']))) add('1 pwd and pass', `${l}|${JSON.stringify(sep)}`, vn, 'line', `${l}${sep}${v}`);
  for (const [jn, j] of Object.entries({ nbsp: '\u00a0', five: '     ', tab: '\t', 'narrow nbsp': '\u202f', 'zero width': '\u200b', slash: '/' }))
    for (const [vn, v] of Object.entries(SMALL)) add('1 joiners outside the vocabulary', `recall api${jn}key`, vn, 'line', `recall api${j}key: ${v}`);
  return F;
}

// ---- hunt 2: the probe families of the second hunt (over the repair of the first) ----------------------------------------

function secondHunt() {
  const TOKENS = pick(['hex32', 'hex40', 'hex64', 'uuid', 'short12', 'lower12', 'b64short']);
  const PWS = pick(['pw_sunshine1', 'pw_hunter22', 'pw_letmein', 'pw_bluefish', 'pw_dragon12', 'pw_Winter24', 'hex40', 'short12']);
  const PHRASES = pick(['phrase', 'phrase_prose']);
  const CONTEXTS = {
    line: (s) => s,
    mid: (s) => `Note for the sync job: ${s} and then rotate it.`,
    escaped: (s) => `{"note":"first line\\n${s}\\nlast line"}`,
    echo: (s) => `echo "${s}" >> notes.txt`,
  };
  const F = [];
  const grid = (family, forms, values, contexts = { line: CONTEXTS.line }) => {
    for (const [form, give] of Object.entries(forms)) for (const [vname, value] of Object.entries(values))
      for (const [context, cx] of Object.entries(contexts)) F.push({ family, form, vname, value, context, text: cx(give(value)) });
  };
  const blanks = { NBSP: '\u00a0', NNBSP: '\u202f', thin: '\u2009', en: '\u2002', ideographic: '\u3000', figure: '\u2007' };
  const A = {};
  for (const [bn, b] of Object.entries(blanks)) {
    A[`L:${bn}v`] = (v) => `recall api key:${b}${v}`;
    A[`L${bn}:${bn}v`] = (v) => `recall api key${b}:${b}${v}`;
    A[`L is${bn}v`] = (v) => `the recall api key is${b}${v}`;
    A[`L =${bn}v`] = (v) => `OpenAI API key =${b}${v}`;
    A[`my github token:${bn}v`] = (v) => `my github token:${b}${v}`;
    A[`words joined by ${bn}`] = (v) => `recall${b}api${b}key: ${v}`;
    A[`Password:${bn}v`] = (v) => `admin password:${b}${v}`;
  }
  grid('2A a Unicode space at the separator', A, pick(['hex32', 'hex40', 'uuid', 'short12', 'pw_hunter22']),
    { line: CONTEXTS.line, mid: CONTEXTS.mid, escaped: CONTEXTS.escaped });
  const B = {
    'L is now v': (v) => `my wifi password is now ${v}`, 'L is still v': (v) => `the admin password is still ${v}`,
    'L is just v': (v) => `the db password is just ${v}`, 'L: now v': (v) => `db password: now ${v}`,
    'L is also v': (v) => `the root password is also ${v}`, "L: it's v": (v) => `admin password: it's ${v}`,
    'L is: still v': (v) => `the wifi password is: still ${v}`, 'new L is now v': (v) => `the new admin password is now ${v}`,
    'set L to v': (v) => `set the db password to ${v}`, 'change L to v': (v) => `change the admin password to ${v}`,
    'L was v': (v) => `my old password was ${v}`, 'L should be v': (v) => `the wifi password should be ${v}`,
    'login with password v': (v) => `login with password ${v}`, 'admin pass v': (v) => `admin pass ${v}`,
    'u: admin, password: v': (v) => `user: admin, password: ${v}`, '(password: v)': (v) => `(password: ${v})`,
    'login admin / password: v': (v) => `login admin / password: ${v}`, 'u=admin, password v': (v) => `user admin, password ${v}`,
    '| password | v |': (v) => `| password | ${v} |`, '| Password | v |': (v) => `| Password | ${v} |`,
    '<td>Password</td><td>v</td>': (v) => `<td>Password</td><td>${v}</td>`,
    'Password:\\nv': (v) => `Password:\n${v}`, 'admin password:\\n\\nv': (v) => `The admin password:\n\n${v}`,
    '**Password**\\nv': (v) => `**Password**\n${v}`, '## Password\\nv': (v) => `## Password\n${v}`,
    'v is my wifi password': (v) => `${v} is my wifi password`, 'use v as the admin password': (v) => `use ${v} as the admin password`,
    'v (db password)': (v) => `${v} (db password)`,
    'Password → v': (v) => `Password → ${v}`, 'Password — v': (v) => `Password — ${v}`, 'Password is v': (v) => `Password is ${v}`,
    netrc: (v) => `machine api.example.test login bot password ${v}`,
    'L for email is v': (v) => `the password for admin@example.invalid is ${v}`, 'L for email: v': (v) => `password for bot@example.invalid: ${v}`,
    'L for host:port is v': (v) => `the password for db.example.test:5432 is ${v}`,
  };
  grid('2B a password, any value shape', B, PWS);
  const C = {
    'L: v': (v) => `wifi password: ${v}`, 'L is v': (v) => `my wifi password is ${v}`, 'L is now v': (v) => `the wifi password is now ${v}`,
    'set L to v': (v) => `set the wifi password to ${v}`, 'Password:\\nv': (v) => `Password:\n${v}`, '| passphrase | v |': (v) => `| passphrase | ${v} |`,
    'u: admin, password: v': (v) => `user: admin, password: ${v}`, 'L — v': (v) => `wifi passphrase — ${v}`, 'L → v': (v) => `wifi passphrase → ${v}`,
    'L: "v"': (v) => `wifi passphrase: "${v}"`, 'L = v': (v) => `vault passphrase = ${v}`,
  };
  grid('2C a passphrase', C, PHRASES, { line: CONTEXTS.line, mid: CONTEXTS.mid });
  const D = {
    'L for email is v': (v) => `the api key for admin@example.invalid is ${v}`, 'L for email: v': (v) => `api key for bot@example.invalid: ${v}`,
    'L for URL: v': (v) => `API key for https://api.example.test: ${v}`, 'L for host:port: v': (v) => `access token for registry.example.test:5000: ${v}`,
    'L for @scope/pkg: v': (v) => `npm token for @recall/cli: ${v}`, 'L for "name": v': (v) => `api key for "recall prod": ${v}`,
    'L for 7 words is v': (v) => `the api key for the new staging cluster in eu west is ${v}`,
    'L (prod) for recall: v': (v) => `API key (prod) for recall: ${v}`, 'L [prod]: v': (v) => `recall api key [prod]: ${v}`,
    'L {prod}: v': (v) => `recall api key {prod}: ${v}`, 'L, prod: v': (v) => `recall api key, prod: ${v}`,
    'L 1 of 2: v': (v) => `recall api key 1 of 2: ${v}`, 'L for recall (prod) [eu]: v': (v) => `API key for recall (prod) [eu]: ${v}`,
    'L (new, rotated today): v': (v) => `recall api key (new, rotated today): ${v}`,
    'L 🔑: v': (v) => `recall api key 🔑: ${v}`, '🔑 L: v': (v) => `🔑 recall api key: ${v}`,
    'L you asked for: v': (v) => `Here's the recall API key you asked for: ${v}`, 'L I generated: v': (v) => `Here's the recall API key I generated: ${v}`,
    'L that works is v': (v) => `the recall api key that works is ${v}`, 'L you need is v': (v) => `the recall api key you need is ${v}`,
    'L, which I rotated, is v': (v) => `the recall api key, which I just rotated, is ${v}`,
    'L. v': (v) => `Here is the recall api key. ${v}`, 'L... v': (v) => `recall api key... ${v}`, 'L… v': (v) => `recall api key… ${v}`,
    'L ➜ v': (v) => `recall api key ➜ ${v}`, 'L » v': (v) => `recall api key » ${v}`, 'L ⟶ v': (v) => `recall api key ⟶ ${v}`,
    'L ~> v': (v) => `recall api key ~> ${v}`, 'L == v': (v) => `recall api key == ${v}`,
    'L — keep it safe — v': (v) => `recall api key — keep it safe — ${v}`,
  };
  grid('2D what stands between a label and its value', D, TOKENS);
  const E = {
    'L (no colon)\\nv': (v) => `Here's your new recall API key\n${v}`, 'L 👇\\nv': (v) => `Recall API key 👇\n${v}`,
    'L (below)\\nv': (v) => `recall api key (below)\n${v}`, 'L:\\n> v': (v) => `recall api key:\n> ${v}`,
    'L:\\n- v': (v) => `recall api key:\n- ${v}`, 'L:\\nv (comment)': (v) => `recall api key:\n${v} (rotate monthly)`,
    'L:\\n(note)\\nv': (v) => `recall api key:\n(keep this secret)\n${v}`, '**L** (prod)\\nv': (v) => `**Recall API key** (prod)\n${v}`,
    'L: |\\n  v': (v) => `recall_api_key: |\n  ${v}`, 'L: >-\\n  v': (v) => `recall_api_key: >-\n  ${v}`,
    'L:\\n\\n\\n\\nv': (v) => `recall api key:\n\n\n\n${v}`, 'L:\\n```text\\nv': (v) => `recall api key:\n\`\`\`text\n${v}\n\`\`\``,
    'L:\\n    v': (v) => `recall api key:\n    ${v}`, 'L:\\n1. v': (v) => `recall api key:\n1. ${v}`,
  };
  grid('2E the value on the next line', E, TOKENS);
  const Fi = {
    'const recallKey = "v"': (v) => `const recallKey = "${v}";`, "recallKey: 'v'": (v) => `  recallKey: '${v}',`,
    '{"openaiKey": "v"}': (v) => `{"openaiKey": "${v}"}`, 'this.stripeKey = "v"': (v) => `this.stripeKey = "${v}";`,
    'OPENAI_KEY=v': (v) => `OPENAI_KEY=${v}`, 'export RECALL_KEY="v"': (v) => `export RECALL_KEY="${v}"`,
    'recall key: v': (v) => `recall key: ${v}`, 'X-Recall-Key: v': (v) => `X-Recall-Key: ${v}`,
    'if (apiKey === "v")': (v) => `if (apiKey === "${v}") return true;`, 'assert api_key == "v"': (v) => `assert api_key == "${v}"`,
    'expect(apiKey).toBe("v")': (v) => `expect(apiKey).toBe("${v}");`,
  };
  grid('2F identifiers and `key` behind a name', Fi, pick(['hex40', 'uuid', 'short12', 'lower12', 'azure20']));
  const G = {
    'echo v | docker login --password-stdin': (v) => `echo ${v} | docker login -u bot --password-stdin registry.example.test`,
    'echo v | gh auth login --with-token': (v) => `echo "${v}" | gh auth login --with-token`,
    'gh auth login --with-token <<< v': (v) => `gh auth login --with-token <<< ${v}`,
    'echo -n v | gcloud secrets versions add': (v) => `echo -n ${v} | gcloud secrets versions add recall-api-key --data-file=-`,
    'printf v | gcloud secrets create': (v) => `printf '%s' '${v}' | gcloud secrets create recall-api-key --data-file=-`,
    'aws ssm put-parameter --value v': (v) => `aws ssm put-parameter --name /recall/api-key --value ${v} --type SecureString`,
    'aws secretsmanager --secret-string v': (v) => `aws secretsmanager create-secret --name recall --secret-string ${v}`,
    'az keyvault secret set --value v': (v) => `az keyvault secret set --vault-name kv --name recall-api-key --value ${v}`,
    'doppler secrets set NAME v': (v) => `doppler secrets set RECALL_API_KEY ${v}`,
    'heroku config:set NAME=v': (v) => `heroku config:set RECALL_API_KEY=${v} -a recall`,
    'git config github.token v': (v) => `git config --global github.token ${v}`,
    'sshpass -p v': (v) => `sshpass -p ${v} ssh bot@db.example.invalid`,
    'openssl -passout pass:v': (v) => `openssl pkcs12 -export -in c.pem -out c.p12 -passout pass:${v}`,
    'curl -u user:v': (v) => `curl -u bot:${v} https://api.example.test/v1/sync`,
    'redis-cli -a v': (v) => `redis-cli -h cache.example.test -a ${v} ping`,
    'htpasswd -b f user v': (v) => `htpasswd -b .htpasswd bot ${v}`,
    'echo v > ~/.recall/api_key': (v) => `echo ${v} > ~/.recall/api_key`,
    'kubectl --from-literal=api-key=v': (v) => `kubectl create secret generic recall --from-literal=api-key=${v}`,
    'vercel env add NAME production <<< v': (v) => `vercel env add RECALL_API_KEY production <<< ${v}`,
    'gh secret set NAME --body v': (v) => `gh secret set RECALL_API_KEY --body ${v}`,
  };
  grid('2G commands that set a secret', G, pick(['hex40', 'uuid', 'short12', 'pw_hunter22']));
  const H = {
    'render.yaml key/value': (v) => `envVars:\n  - key: RECALL_API_KEY\n    value: ${v}`,
    'JSON key/value': (v) => `{"key": "RECALL_API_KEY", "value": "${v}", "target": ["production"]}`,
    'JSON value before name': (v) => `{"value": "${v}", "name": "RECALL_API_KEY"}`,
    'Postman env': (v) => `{"key": "apiKey", "value": "${v}", "type": "secret", "enabled": true}`,
    'HTML input name/value': (v) => `<input type="hidden" name="api_key" value="${v}">`,
    'HTML meta name/content': (v) => `<meta name="recall-api-key" content="${v}">`,
    '.NET add key/value': (v) => `<add key="RecallApiKey" value="${v}" />`,
    'Spring property name/value': (v) => `<property name="apiKey" value="${v}"/>`,
    'Android string resource': (v) => `<string name="recall_api_key">${v}</string>`,
    'AndroidManifest meta-data': (v) => `<meta-data android:name="com.recall.API_KEY" android:value="${v}"/>`,
    'XML element <apiKey>': (v) => `<apiKey>${v}</apiKey>`,
    'Maven settings <password>': (v) => `<server><id>repo</id><username>bot</username><password>${v}</password></server>`,
    'CSV NAME,v': (v) => `RECALL_API_KEY,${v}`, 'CSV "label","v"': (v) => `"recall api key","${v}"`,
    'TSV NAME\\tv': (v) => `RECALL_API_KEY\t${v}`,
    'k8s name/value': (v) => `env:\n  - name: RECALL_API_KEY\n    value: ${v}`,
  };
  grid('2H key/value data', H, pick(['hex40', 'uuid', 'short12', 'pw_hunter22']));
  const I = {
    'v # recall api key': (v) => `${v} # recall api key`, '"v" // recall api key': (v) => `const RECALL = "${v}"; // recall api key`,
    'v ← recall api key': (v) => `${v} ← recall api key`, "v — that's the recall api key": (v) => `${v} — that's the recall api key`,
    'v is the new recall api key': (v) => `${v} is the new recall api key`, 'v was my old api key': (v) => `${v} was my old api key`,
    'v is your api key': (v) => `${v} is your api key`, 'v is the api key for recall': (v) => `${v} is the api key for recall`,
    'paste v into the api key field': (v) => `paste ${v} into the API key field`, 'v goes in the API key field': (v) => `${v} goes in the API key field`,
    'v: recall api key': (v) => `${v}: recall api key`, 'v = api key': (v) => `${v} = recall api key`,
  };
  grid('2I the value before its label', I, pick(['hex32', 'hex40', 'uuid', 'short12']));
  const J = {
    ', token: a or v': (v) => `Use the sync job, token: ${VALUES.hex32} or ${v} if that fails.`,
    'api_key=a backup v': (v) => `api_key=${VALUES.hex32} backup ${v}`, 'token: a (old: v)': (v) => `token: ${VALUES.hex32} (old: ${v})`,
    'API_KEY: a, v': (v) => `API_KEY: ${VALUES.hex32}, ${v}`, 'password: a and v': (v) => `password: ${VALUES.pw_hunter22} and ${v}`,
    '{"api_key": "a"} then v': (v) => `{"api_key": "${VALUES.hex32}", "fallback": "${v}"}`,
  };
  grid('2J a second value after an older shape', J, pick(['hex40', 'uuid', 'short12']));
  const K = {
    'clé API : v': (v) => `clé API : ${v}`, 'clé API: v': (v) => `clé API: ${v}`, 'mot de passe : v': (v) => `mot de passe : ${v}`,
    'Passwort: v': (v) => `Passwort: ${v}`, 'API-Schlüssel: v': (v) => `API-Schlüssel: ${v}`, 'contraseña: v': (v) => `contraseña: ${v}`,
    'clave de API: v': (v) => `clave de API: ${v}`, 'senha: v': (v) => `senha: ${v}`, 'chiave API: v': (v) => `chiave API: ${v}`,
    'パスワード: v': (v) => `パスワード: ${v}`, 'APIキー: v': (v) => `APIキー: ${v}`, '密码: v': (v) => `密码: ${v}`,
    'пароль: v': (v) => `пароль: ${v}`, 'wachtwoord: v': (v) => `wachtwoord: ${v}`, 'Token API: v': (v) => `Token API: ${v}`,
  };
  grid('2K other languages', K, pick(['hex40', 'uuid', 'short12', 'pw_hunter22']));
  const L = {
    '[L]: v': (v) => `[recall-api-key]: ${v}`, '***L***: v': (v) => `***recall api key***: ${v}`,
    '~~L~~: v': (v) => `~~recall api key~~: ${v}`, '==L==: v': (v) => `==recall api key==: ${v}`,
    '<kbd>L</kbd>: v': (v) => `<kbd>recall api key</kbd>: ${v}`, '> **L:** v': (v) => `> **Recall API key:** ${v}`,
    '- [ ] L: v': (v) => `- [ ] recall api key: ${v}`, ':key: L: v': (v) => `:key: recall api key: ${v}`,
    '`L`=`v`': (v) => `\`RECALL_API_KEY\`=\`${v}\``, '"L"=>"v"': (v) => `"recall api key"=>"${v}"`,
    'L: <code>v</code>': (v) => `recall api key: <code>${v}</code>`, 'L: [v](#)': (v) => `recall api key: [${v}](#)`,
    'L: ||v||': (v) => `recall api key: ||${v}||`, 'L:\\tv': (v) => `recall api key:\t${v}`,
  };
  grid('2L markdown and wrappers', L, pick(['hex40', 'uuid', 'short12', 'lower12']));
  const M = {
    'Username: admin. Password: v': (v) => `Username: admin. Password: ${v}`, 'user admin - password: v': (v) => `user admin - password: ${v}`,
    'Login: admin\\tPassword: v': (v) => `Login: admin\tPassword: ${v}`, 'Email: e Password: v': (v) => `Email: bot@example.invalid Password: ${v}`,
    'admin and password: v': (v) => `Log in as admin and password: ${v}`, 'Username: admin Password: v': (v) => `Username: admin Password: ${v}`,
    'user=admin password: v': (v) => `user=admin password: ${v}`, 'u: admin; pw: v': (v) => `user: admin; pw: ${v}`,
    'pass: v': (v) => `pass: ${v}`, 'pwd: v': (v) => `pwd: ${v}`, 'PW: v': (v) => `PW: ${v}`, 'passcode: v': (v) => `passcode: ${v}`,
    'PIN: v': (v) => `PIN: ${v}`,
  };
  grid('2M a one-word password label mid-line, short names', M, pick(['pw_sunshine1', 'pw_hunter22', 'pw_letmein', 'pw_Winter24', 'short12', 'hex40']));
  const N = {
    'L: a, b': (v) => `wifi password: ${v.replace(' ', ', ')}`, 'L: a-b c': (v) => `wifi password: ${v.replace(' ', '-')}`,
    'L: a. b': (v) => `wifi password: ${v.replace(' ', '. ')}`, 'L: a b!': (v) => `wifi password: ${v}!`,
    'L is a b so use that': (v) => `the wifi password is ${v} so use that`,
    'L: a | b': (v) => `wifi password: ${v.replace(' ', ' | ')}`, 'L: a - b': (v) => `wifi password: ${v.replace(' ', ' - ')}`,
    'L: a: b': (v) => `wifi password: ${v.replace(' ', ': ')}`,
  };
  grid('2N a passphrase with punctuation', N, pick(['phrase']), CONTEXTS);
  const P = {
    'L: a; v': (v) => `recall api keys: ${VALUES.hex32}; ${v}`, 'L: a // v': (v) => `recall api keys: ${VALUES.hex32} // ${v}`,
    'L: a # v': (v) => `recall api keys: ${VALUES.hex32} # ${v}`, 'L: rotated. New: v': (v) => `recall api key: rotated. New: ${v}`,
    'L: see the docs. Mine is v': (v) => `recall api key: see the docs. Mine is ${v}`, 'L: a\\tv': (v) => `recall api keys: ${VALUES.hex32}\t${v}`,
    'L: a (old) v (new)': (v) => `recall api keys: ${VALUES.hex32} (old) ${v} (new)`,
  };
  grid('2P a second key after `;` or a comment', P, pick(['hex40', 'uuid', 'short12', 'hex64']));
  // Q: the password and label-edge families again, inside a sentence, JSON-escaped text and `echo "…"`.
  for (const p of F.filter((p) => (p.family.startsWith('2B') || p.family.startsWith('2D')) && p.context === 'line'
    && ['pw_sunshine1', 'pw_hunter22', 'hex40', 'uuid'].includes(p.vname))) {
    const give = (p.family.startsWith('2B') ? B : D)[p.form];
    for (const [cn, cx] of Object.entries({ mid: CONTEXTS.mid, escaped: CONTEXTS.escaped, echo: CONTEXTS.echo }))
      F.push({ ...p, family: `2Q ${p.family.slice(0, 2)} in context`, context: cn, text: cx(give(p.value)) });
  }
  return F;
}

test('M33 R repair 8 premise: every probe holds its value as written, and an unlabelled hex run is kept in every channel', () => {
  for (const p of [...firstHunt(), ...secondHunt()]) assert.ok(p.text.includes(p.value) || p.text.includes(p.value.replace(' ', ', ')) || p.value.includes(' '), p.form);
  for (const [channel, [out]] of Object.entries(through([`commit ${VALUES.hex40}`]))) {
    assert.equal(out, CHANNELS[channel].input(`commit ${VALUES.hex40}`), `${channel}: BENIGN keeps an unlabelled hex run, as before`);
  }
});

for (const [family, probes] of [...byFamily(firstHunt()), ...byFamily(secondHunt())]) {
  test(`M33 R repair 8: hunt family "${family}" — nothing of the value survives in any of 17 channels (${probes.length} probes)`, () => {
    const failures = leaksOf(probes);
    assert.equal(failures.length, 0, `${failures.length} cells leak, first:\n${failures.slice(0, 10).join('\n')}`);
  });
}

// ---- the rule's pieces, with exact bytes -------------------------------------------------------------------------------

const M = '‹redacted:secret-value›';
const HEX40 = VALUES.hex40, SHORT = VALUES.short12, UUID = VALUES.uuid;
/** One text through the channels where a text is scanned as written (prose, command and content fields): `{ channel: out }`. */
const SAMPLE = ['ask', 'saying', 'cmd', 'tailLines', 'argsExcerpt', 'after', 'delegation report'];
function exact(cases, channels = SAMPLE) {
  const outs = through(cases.map(([text]) => text));
  for (const channel of channels) {
    cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${JSON.stringify(text)}`));
  }
}

test('M33 R repair 8, rule 3: in scope every credential-shaped token is masked where it stands; the name, separators, quotes and markup stay', () => {
  exact([
    [`recall api key: ${HEX40}`, `recall api key: ${M}`],
    [`recall api key:\u00a0${HEX40}`, `recall api key:\u00a0${M}`],
    [`recall api key\u202f: ${HEX40}`, `recall api key\u202f: ${M}`],
    [`recall api key: prod ${HEX40}`, `recall api key: prod ${M}`],
    [`the api key for admin@example.invalid is ${HEX40}`, `the api key for ‹redacted:email› is ${M}`],
    [`Here's the recall API key you asked for: ${HEX40}`, `Here's the recall API key you asked for: ${M}`],
    [`recall api key [prod]: ${HEX40}`, `recall api key [prod]: ${M}`],
    [`Here is the recall api key. ${HEX40}`, `Here is the recall api key. ${M}`],
    [`${HEX40} is my recall api key`, `${M} is my recall api key`],
    [`${HEX40} # recall api key`, `${M} # recall api key`],
    [`const recallKey = "${SHORT}";`, `const recallKey = "${M}";`],
    [`<string name="recall_api_key">${HEX40}</string>`, `<string name="recall_api_key">${M}</string>`],
    [`<add key="RecallApiKey" value="${HEX40}" />`, `<add key="RecallApiKey" value="${M}" />`],
    [`{"value": "${HEX40}", "name": "RECALL_API_KEY"}`, `{"value": "${M}", "name": "RECALL_API_KEY"}`],
    [`| recall api key | \`${HEX40}\` |`, `| recall api key | \`${M}\` |`],
    [`clé API : ${HEX40}`, `clé API : ${M}`],
    [`APIキー: ${HEX40}`, `APIキー: ${M}`],
    [`recall api keys: ${VALUES.hex32} and ${HEX40}`, `recall api keys: ${M} and ${M}`],
    [`recall api key: ${HEX40.slice(0, 20)} ${HEX40.slice(20)}`, `recall api key: ${M} ${M}`],
    [`Please set the recall api key to ${HEX40}.`, `Please set the recall api key to ${M}.`],
  ]);
});

test('M33 R repair 8, rule 2: a label line puts its next 2 non-blank lines in scope (M33 R repair 9 widens it: S2, S3)', () => {
  exact([
    [`Here's your new recall API key\n${HEX40}`, `Here's your new recall API key\n${M}`],
    [`recall api key:\n\n\n\n${HEX40}`, `recall api key:\n\n\n\n${M}`],
    [`recall api key:\n(keep this secret)\n${HEX40}`, `recall api key:\n(keep this secret)\n${M}`],
    [`**Recall API key** (prod)\n${HEX40}`, `**Recall API key** (prod)\n${M}`],
    [`Recall API key 👇\n${HEX40}`, `Recall API key 👇\n${M}`],
    [`envVars:\n  - key: RECALL_API_KEY\n    value: ${HEX40}`, `envVars:\n  - key: RECALL_API_KEY\n    value: ${M}`],
    [`variable "recall_api_key" {\n  default = "${HEX40}"\n}`, `variable "recall_api_key" {\n  default = "${M}"\n}`],
    // M33 R repair 9 retires two pins of this rule's reach, each a leak its third hunt found (families 7 and 3): a value
    // three non-blank lines below its label, in the label's paragraph, is in scope (S3); a lone value right below a line
    // that names a key and does not end at its word is in scope (S2). The recorder's own header line still scopes nothing.
    [`recall api key:\none\ntwo\n${HEX40}`, `recall api key:\none\ntwo\n${M}`],
    [`the recall api key rotation is done\n${HEX40}`, `the recall api key rotation is done\n${M}`],
    [`recall api key:\none\ntwo\n\nlater ${HEX40}`, `recall api key:\none\ntwo\n\nlater ${HEX40}`],
    [`Original token count: 40\n${HEX40}`, `Original token count: 40\n${HEX40}`],
    // A weak word (`key` alone) scopes its own line only, and there only a long token.
    [`key:\n${HEX40}`, `key:\n${HEX40}`],
    [`primary key: ${SHORT}`, `primary key: ${SHORT}`],
    [`cache key: ${HEX40}`, `cache key: ${M}`],
  ], ['ask', 'saying', 'tailLines', 'after', 'cmd']);
});

test('M33 R repair 8, rule 1: `key` behind a word, or before `for`, is strong; behind a plain kind of key it is weak', () => {
  exact([
    [`recall key: ${SHORT}`, `recall key: ${M}`],
    [`this key: ${SHORT}`, `this key: ${M}`],
    [`key for recall: ${SHORT}`, `key for recall: ${M}`],
    [`RECALL_KEY=${SHORT}`, `RECALL_KEY=${M}`],
    [`X-Recall-Key: ${SHORT}`, `X-Recall-Key: ${M}`],
    ['primary key: user_123_profile', 'primary key: user_123_profile'],
    ['sort key: created_at_2024', 'sort key: created_at_2024'],
    ['const cacheKey = `user:${id}:v2`;', 'const cacheKey = `user:${id}:v2`;'],
    ['press the esc key -> nothing happens', 'press the esc key -> nothing happens'],
  ]);
  assert.ok(PROXIMITY_PLAIN_KEYS.includes('primary') && PROXIMITY_PLAIN_KEYS.includes('public') && !PROXIMITY_PLAIN_KEYS.includes('recall'));
});

test('M33 R repair 8, rule 3: what is never masked in scope — names, paths, numbers, versions, dates, files, word identifiers, technical words, placeholders, references', () => {
  const kept = [
    'RECALL_API_KEY=$RECALL_API_KEY', 'export OPENAI_API_KEY="${OPENAI_API_KEY}"', 'api key: <YOUR_API_KEY>', 'API key: YOUR_API_KEY_HERE',
    'token: ***', 'the token is xxxxxxxxxxxx', 'password: changeme', 'docker login --password-stdin registry.example.test',
    'the private key ~/.ssh/id_ed25519', 'see /var/run/secrets/kubernetes.io/serviceaccount/token', 'api key docs: https://example.test/docs/api-keys/rotate',
    'token ttl: 3600', 'the access token expires in 900 seconds', 'api key v1.14.2 released', 'token rotated 2026-09-30T08:20:00Z',
    'signing key file: keys/signing-2026.pem', 'token cache: user_123_profile', 'the OAuth2Client token flow', 'token signing: ed25519',
    'api key hashing: sha256sum', 'max tokens: 4096', 'tokenizer: cl100k_base_v2', 'keyboard layout: dvorak2024', 'the secretary filed form 1815abcdef',
    'The api key for staging lives in 1Password.', 'echo $API_TOKEN', 'curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.example.test/repos/1234567890',
    // A public key gives no scope; a placeholder's bracketed name is no word of the vocabulary; a key block's armour line
    // is no label line.
    'the public key a1b2c3d4e5f6a7b8c9d0 is published', 'NEXT_PUBLIC_RECALL_KEY: pk7f91c2d8e4',
    'user admin, password: <db_password>', '-----END RSA PRIVATE KEY-----\nbuild 2026-10-01T12:00:08.1234567Z ok',
  ];
  exact(kept.map((t) => [t, t]));
});

test('M33 R repair 8, rule 1: vocabulary edges — a word inside another word, a random token, a digit, a `$` reference give no scope', () => {
  // `pW` between digits in a random token is no word (repair 8 takes no vocabulary edge at a digit); nor is `password1`.
  const random = `256 SHA256:Qm3yZt8h1U4vN0aRk2pW7dXcLs5eFj9gTb6oIq (ED25519) build ${VALUES.hex12}`;
  exact([[random, random], [`tokenizers ${VALUES.hex12}`, `tokenizers ${VALUES.hex12}`], [`monkey ${VALUES.hex12}`, `monkey ${VALUES.hex12}`],
    [`echo $API_KEY=${SHORT} node app.js`, `echo $API_KEY=${SHORT} node app.js`]]);
  // `Password: password1`: the value is a word glued to a digit, not the vocabulary's name.
  exact([['Password: password1', `Password: ${M}`]]);
});

test('M33 R repair 8, rule 4: a password-family value whatever its shape, to the end of its clause', () => {
  exact([
    ['my wifi password is now letmein', `my wifi password is now ${M}`],
    ['the admin password is still bluefish', `the admin password is still ${M}`],
    ['set the db password to letmein', `set the db password to ${M}`],
    ['login with password letmein', `login with password ${M}`],
    ['machine api.example.test login bot password letmein', `machine api.example.test login bot password ${M}`],
    ['admin pass letmein', `admin pass ${M}`],
    ['the password for admin@example.invalid is letmein', `the password for ‹redacted:email› is ${M}`],
    ['Password (prod): letmein', `Password (prod): ${M}`],
    ['wifi password: velvet orchid tundra marble', `wifi password: ${M}`],
    ['wifi password: velvet, orchid tundra marble', `wifi password: ${M}`],
    ['the wifi password is the purple elephant dances so use that', `the wifi password is ${M}`],
    ['| password | velvet orchid |', `| password | ${M} |`],
    ['<td>Password</td><td>letmein</td>', `<td>Password</td><td>${M}</td>`],
    ['echo "wifi password: velvet orchid" >> notes.txt', `echo "wifi password: ${M}" >> notes.txt`],
    ['{"note":"wifi password: velvet orchid\\nnext"}', `{"note":"wifi password: ${M}\\nnext"}`],
    ['user admin, password: letmein  # rotate monthly', `user admin, password: ${M}  # rotate monthly`],
    ['PIN: 4821', `PIN: ${M}`],
    ['letmein is my wifi password', `${M} is my wifi password`],
    ['use letmein as the admin password', `use ${M} as the admin password`],
    ['letmein (db password)', `${M} (db password)`],
    ['Password:\nletmein', `Password:\n${M}`],
    ['## Password\n\nletmein', `## Password\n\n${M}`],
    ['Password:\nvelvet orchid tundra marble and then rotate it.', `Password:\n${M}.`],
  ], ['ask', 'saying', 'tailLines', 'after', 'cmd', 'delegation report']);
});

test('M33 R repair 8, rule 4: what is no password value — stop words, prose, code, paths, options, names, a word the sentence goes on from', () => {
  const kept = ['Username: admin, Password: required', 'user admin, password: none', 'Password is required', 'the password reset flow', 'password manager: 1Password',
    'Password policy updated.', 'my password is too short', 'Password for admin: see the vault', 'the password for the db is stored in vault',
    'I sent the password to the admin', 'The password tests take about 180 ms.', 'function login(user: string, password: string) {',
    "if (!password) return res.status(400).send('password required');", 'hash(password, rounds)', 'echo $PWD',
    'current pwd: /work/x1', '$ pwd', 'cd /tmp && pwd && ls', 'Password — required', 'passwords must match', 'the passwords match',
    '## Password\nChoose a strong password and store it in your password manager, never in the repository.', 'pin the version to 3.11',
    'second pass: compile everything', 'tests pass: 12', 'first pass: abc123def456', 'Password — 0.4% of logs'];
  exact(kept.map((t) => [t, t]));
  for (const list of [PROXIMITY_STOP, PROXIMITY_PROSE, PROXIMITY_JOINERS]) {
    assert.ok(Object.isFrozen(list) && new Set(list).size === list.length);
  }
  for (const word of ['none', 'not', 'empty', 'unset', 'required', 'optional', 'field', 'prompt', 'reset', 'manager', 'policy', 'hash', 'length',
    'protected', '1password']) assert.ok(PROXIMITY_STOP.includes(word), `the lead's stop word ${word}`);
  for (const word of ['is', 'to', 'was', 'with', 'should', 'now', 'still']) assert.ok(PROXIMITY_JOINERS.includes(word), `joiner ${word}`);
});

test('M33 R repair 8, rule 5: commands that set a secret give up their value, whatever its shape', () => {
  exact([
    ['echo letmein | docker login -u bot --password-stdin registry.example.test', `echo ${M} | docker login -u bot --password-stdin registry.example.test`],
    ['printf %s letmein | gh auth login --with-token', `printf %s ${M} | gh auth login --with-token`],
    ['gh auth login --with-token <<< letmein', `gh auth login --with-token <<< ${M}`],
    ['aws ssm put-parameter --name /recall/api-key --value letmein --type SecureString', `aws ssm put-parameter --name /recall/api-key --value ${M} --type SecureString`],
    ['az keyvault secret set --vault-name kv --name recall-api-key --value=letmein', `az keyvault secret set --vault-name kv --name recall-api-key --value=${M}`],
    ['redis-cli -h cache.example.test -a letmein ping', `redis-cli -h cache.example.test -a ${M} ping`],
    ['htpasswd -b .htpasswd bot letmein', `htpasswd -b .htpasswd bot ${M}`],
    ['htpasswd -nb bot letmein', `htpasswd -nb bot ${M}`],
    ['podman login -u bot -p letmein registry.example.test', `podman login -u bot -p ${M} registry.example.test`],
    ['security add-generic-password -a me -s recall -w letmein', `security add-generic-password -a me -s recall -w ${M}`],
    ['gh secret set RECALL_API_KEY --body letmein', `gh secret set RECALL_API_KEY --body ${M}`],
    ['npm config set //registry.npmjs.org/:_authToken letmein', `npm config set //registry.npmjs.org/:_authToken ${M}`],
    ['git config --global github.token letmein', `git config --global github.token ${M}`],
    ['doppler secrets set RECALL_API_KEY letmein', `doppler secrets set RECALL_API_KEY ${M}`],
    ['vercel env add RECALL_API_KEY production <<< letmein', `vercel env add RECALL_API_KEY production <<< ${M}`],
  ], ['cmd', 'ask', 'tailLines', 'after']);
  const kept = ['echo $TOKEN | docker login -u bot --password-stdin', 'gh secret set RECALL_API_KEY --body "$RECALL_API_KEY"',
    'aws ssm put-parameter --name /app/log-level --value debug', 'docker run -p 8080:80 nginx', 'redis-cli -h cache.example.test ping',
    'git config --global user.name ada', 'npm config set registry https://registry.npmjs.org/', 'htpasswd -c .htpasswd bot',
    'security add-generic-password -a me -s recall -w'];
  exact(kept.map((t) => [t, t]), ['cmd', 'ask', 'tailLines', 'after']);
});

test('M33 R repair 8, rule 6: every older layer keeps its bytes and its label; the shell exceptions stand', () => {
  const cmdOf = (text) => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text }] }).ledger.ledger[0].cmd;
  const askOf = (text) => redact({ ask: [{ turn: 1, text }], ledger: [] }).ledger.ask[0].text;
  assert.equal(askOf(`OpenAI API key: ${VALUES['sk-']}`), 'OpenAI API key: ‹redacted:openai-key›');
  assert.equal(askOf(`my github token: ${VALUES.ghp_}`), 'my github token: ‹redacted:github-token›');
  assert.equal(askOf('AWS access key: AKIAIOSFODNN7EXAMPLE'), 'AWS access key: ‹redacted:aws-key›');
  assert.equal(askOf(`recall api key: ${HEX40} (mail bot@example.invalid)`), `recall api key: ${M} (mail ‹redacted:email›)`);
  assert.equal(askOf(`API_TOKEN=${VALUES.b64short}`), 'API_TOKEN=‹redacted›');
  assert.equal(askOf(`run with \${RECALL_API_KEY:-${SHORT}} now`), 'run with ${RECALL_API_KEY:-‹redacted:secret-value›} now');
  assert.equal(askOf(`+{"api_keys": ["${SHORT}", "${VALUES.digits12}"], "n": 2}`), '+{"api_keys": [‹redacted:secret-value›], "n": 2}');
  // `$NAME=`: a reference names a variable (F186 pins this line clean); `NAME= cmd`: the shell's empty assignment.
  assert.equal(cmdOf(`echo $API_KEY=${SHORT} node app.js`), `echo $API_KEY=${SHORT} node app.js`);
  assert.equal(cmdOf('API_TOKEN= ./run.sh'), 'API_TOKEN= ./run.sh');
  assert.equal(cmdOf('GPG_PASSPHRASE= make deploy'), 'GPG_PASSPHRASE= make deploy');
  assert.equal(cmdOf('db_pwd=*** ./run.sh'), 'db_pwd=*** ./run.sh');
  // BENIGN is never consulted in scope: a git sha, base64 and digits beside a secret word are masked.
  for (const v of [VALUES.hex7, HEX40, VALUES.b64short, VALUES.digits12]) assert.equal(askOf(`the recall api key is ${v}`), `the recall api key is ${M}`);
});

test('M33 R repair 8: this stage\'s own markers name no vocabulary — a second pass reads what the first read', () => {
  const askOf = (text) => redact({ ask: [{ turn: 1, text }], ledger: [] }).ledger.ask[0].text;
  // A named pattern's marker holds `token`; the line it masked held no vocabulary, so the hex beside it is kept, twice.
  const line = `${VALUES.ghp_} deploy ${VALUES.hex12}`;
  assert.equal(askOf(line), `‹redacted:github-token› deploy ${VALUES.hex12}`);
  assert.equal(askOf(askOf(line)), askOf(line));
  assert.equal(askOf(`‹redacted:secret-value› build ${VALUES.hex12}`), `‹redacted:secret-value› build ${VALUES.hex12}`);
});

test('M33 R repair 8, rule 2: a heading, or a label line that ends at a separator after what it is for, scopes the lines below', () => {
  exact([
    [`## api key in prod\n\n${HEX40}`, `## api key in prod\n\n${M}`],
    [`api key in prod:\n${HEX40}`, `api key in prod:\n${M}`],
    ['Password for admin:\nletmein', `Password for admin:\n${M}`],
    [`recall api key for the staging cluster:\n  ${SHORT}`, `recall api key for the staging cluster:\n  ${M}`],
    ['## Passwords\n\nPasswords must be at least 12 characters long and are checked against breach lists.',
      '## Passwords\n\nPasswords must be at least 12 characters long and are checked against breach lists.'],
  ], ['ask', 'saying', 'tailLines', 'after', 'cmd']);
});

test('M33 R repair 8: every entry of the vocabulary is read, in any case and joined any way, a zero-width character inside it too', () => {
  const askOf = (texts) => redact({ ask: texts.map((text) => ({ turn: 1, text })), ledger: [] }).ledger.ask.map((a) => a.text);
  const entries = [...PROXIMITY_STRONG, ...PROXIMITY_PASSWORD].filter((e) => !PROXIMITY_LINE_HEAD.includes(e));
  const spell = (entry, join) => entry.split(' ').map((w) => w.replace('(s)', '')).join(join);
  // Upper case only where it is the language's own (`ı` has no upper case of its own).
  const texts = entries.flatMap((e) => [`${spell(e, ' ')}: ${HEX40}`, `${spell(e, '\u00a0')}: ${HEX40}`,
    ...(/^[\x00-\x7f]+$/.test(e) ? [`${spell(e, '_').toUpperCase()}: ${HEX40}`] : [])]);
  askOf(texts).forEach((out, i) => assert.deepEqual(fragments(out, HEX40), [], texts[i]));
  const [zw] = askOf([`recall t\u200boken: ${HEX40}`]);
  assert.equal(zw, `recall t\u200boken: ${M}`);
});

test('M33 R repair 8: what P masks is declared under the closed reason vocabulary', () => {
  const per = through([`recall api key: ${HEX40}`, 'my wifi password is now letmein', `Password:\n${SHORT}`, 'redis-cli -a letmein ping']);
  assert.ok(per.dropped.length > 0);
  for (const entry of per.dropped) assert.ok(REDACTION_REASONS.includes(entry.reason), entry.reason);
  assert.ok(per.dropped.some((entry) => entry.reason === 'redacted:secret-key-value'));
});

test('M33 R repair 8: the vocabulary is closed, frozen and holds the lead\'s words', () => {
  for (const list of [PROXIMITY_STRONG, PROXIMITY_PASSWORD, PROXIMITY_WEAK, PROXIMITY_CASED, PROXIMITY_LINE_HEAD, PROXIMITY_PLAIN_KEYS,
    PROXIMITY_TAIL_WORDS, PROXIMITY_TECH_WORDS]) {
    assert.ok(Array.isArray(list) && Object.isFrozen(list) && new Set(list).size === list.length);
  }
  for (const word of ['api key(s)', 'access key(s)', 'secret(s)', 'client secret(s)', 'token', 'bearer', 'credential(s)', 'private key(s)',
    'signing key(s)', 'encryption key(s)', 'master key(s)', 'webhook secret(s)', 'dsn', 'license key(s)', 'ssh key(s)', 'deploy key(s)',
    'auth token(s)', 'auth key(s)', 'clé api', 'api schlüssel', 'clave', 'chiave api', 'api キー', '密钥', '令牌', 'api ключ', 'api sleutel']) {
    assert.ok(PROXIMITY_STRONG.includes(word), word);
  }
  for (const word of ['password(s)', 'passwd', 'passphrase(s)', 'pwd', 'mot de passe', 'passwort', 'contraseña', 'senha', 'пароль', 'パスワード',
    '密码', 'wachtwoord']) assert.ok(PROXIMITY_PASSWORD.includes(word), word);
  assert.ok(PROXIMITY_WEAK.includes('key(s)'));
  // `encryption key` and `master key` stay names of the key-name rule too (repair 7's, kept).
  const cmdOf = (text) => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text }] }).ledger.ledger[0].cmd;
  for (const name of ['ENCRYPTION_KEY', 'master_key']) assert.equal(cmdOf(`export ${name}=${VALUES.hex64}`), `export ${name}=${M}`);
});

// ---- the over-mask budget ---------------------------------------------------------------------------------------------

test('M33 R repair 8: OVER-MASK BUDGET — at least 90% of a benign corpus is kept byte for byte, every changed line listed', (t) => {
  const run = {
    'after (a file body)': (text) => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'x', after: { text, truncated: false, lines: 1 } }] }).ledger.ledger[0].after.text,
    'tailLines (an output)': (text) => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat x', tailLines: text.split('\n') }] }).ledger.ledger[0].tailLines.join('\n'),
    'ask (the human)': (text) => redact({ ask: [{ turn: 1, text }], ledger: [] }).ledger.ask[0].text,
    'saying (the agent)': (text) => redact({ ask: [], ledger: [], sayings: [{ turn: 1, text }] }).ledger.sayings[0].text,
  };
  let lines = 0, kept = 0;
  const changed = new Map();
  for (const [channel, scrub] of Object.entries(run)) {
    let n = 0, k = 0;
    for (const [document, text] of Object.entries(BENIGN_DOCUMENTS)) {
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
  const share = kept / lines;
  t.diagnostic(`overall: ${kept} of ${lines} lines kept (${(100 * share).toFixed(2)}%), ${Object.keys(BENIGN_DOCUMENTS).length} documents`);
  for (const [line, channels] of changed) t.diagnostic(`changed in ${channels.length}: ${line.slice(0, 140)}`);
  assert.ok(share >= 0.9, `${(100 * share).toFixed(2)}% kept`);
});

// ---- stability --------------------------------------------------------------------------------------------------------

test('M33 R repair 8: redaction is idempotent and deterministic over every hunt probe', () => {
  const texts = [...firstHunt(), ...secondHunt()].filter((_, i) => i % 7 === 0).map((p) => p.text);
  for (let i = 0; i < texts.length; i += 60) {
    const batch = texts.slice(i, i + 60);
    const once = through(batch);
    const twice = through(once.ask);
    assert.deepEqual(twice.ask, once.ask, 'f(f(x)) === f(x)');
    const tail = through(once.tailLines);
    assert.deepEqual(tail.tailLines, once.tailLines, 'f(f(x)) === f(x) in an output');
    assert.deepEqual(through(batch), once, 'the same bytes twice');
  }
});

test('M33 R repair 8: a megabyte of vocabulary, passwords, tokens or label lines is read in linear time', () => {
  const cases = {
    'label-dense one line': `${'the api key: abc '.repeat(40_000)}${'a'.repeat(200_000)} my token: ${'b'.repeat(300_000)}`,
    'password-dense one line': 'password: none '.repeat(70_000),
    'password values to the line end': 'my password is velvet orchid '.repeat(35_000),
    'tokens in scope': `token ${'a1b2c3d4e5f6 '.repeat(80_000)}`,
    'label lines': Array.from({ length: 40_000 }, (_, i) => (i % 2 ? 'API key:' : 'see the docs')).join('\n'),
    'a command line': `echo ${'x '.repeat(200_000)} | docker login --password-stdin`,
    'zero-width spaces': `api\u200bkey ${'\u200b'.repeat(500_000)} ${HEX40}`,
  };
  // 20 s of CPU, scaled by the slowdown measured under load (linear-clock.js), never a wall-clock limit.
  for (const [what, line] of Object.entries(cases)) {
    assertLinear(() => redact({ ask: [{ turn: 1, text: line }],
      ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: line, tailLines: line.split('\n') }] }), 20_000, what);
  }
});
