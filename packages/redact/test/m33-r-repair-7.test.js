// M33 R repair 7. A leak: a line of the shape `recall api key: <40 lowercase hex>` survived redaction into the
// ledger, the session and every review request that showed it. Two causes, both at this stage:
//
// 1. Every key-name shape needs the secret's name to be ONE identifier before its separator (`KEY_NAME`, `ASSIGNED`'s
//    `[A-Za-z_][A-Za-z0-9_]{2,}`). A label of two or three words — `recall api key`, `OpenAI API key`, `stripe secret
//    key`, `my github token` — matched none of them, and neither did a short value after `recall_api_key:` mid-line.
// 2. The value then reached the entropy backstop, which never fails a hex run (at most 4 bits/char, under the 4.6
//    floor) and exempts it by name besides (BENIGN's git sha, `/^[0-9a-f]{7,40}$/`).
//
// Repair 7 adds shape N to the key-name rule: a secret LABEL — one or two words, then a word or a two-word phrase of the
// secret vocabulary (`SECRET_LABEL_WORDS`, `SECRET_LABEL_PHRASES`, beside `SECRET_KEY_NAMES` and drawn from it), the
// words joined by blanks, `-`, `_` or `.`, in any case, in quotes or markdown, optionally saying what it is for or
// carrying a parenthetical — followed by `:`, `=`, ` is `, `->` or `=>` and a value. The value is masked whatever its
// shape: BENIGN, the backstop's exemption for hex, base64 and digits, is never consulted for it. Prose stays readable:
// a value that is a placeholder or reference (the one rule every layer shares), or that opens with an ordinary word of
// a closed list (`SECRET_LABEL_PROSE`: `see the docs`, `not set`, `invalid`), is kept — and after such words, a
// credential-shaped token is still masked. With no separator at all, only a credential-shaped word is a value.
//
// M33 R repair 8 replaced shape N with the proximity rule (P; redact/test/m33-r-repair-8.test.js). Every leak this file
// pins still masks, and every prose control is still kept, under P. Retired here, because they pinned N's grammar, which P
// supersedes: the closed list of prose words that kept a value after a label (`SECRET_LABEL_PROSE`: P never masks a
// prose word, only a credential-shaped token, so the list has no work left; the weak passwords it pinned as masked are
// rule 4's now, pinned there), the label vocabulary's expansion against SECRET_KEY_NAMES (`SECRET_LABEL_WORDS`,
// `SECRET_LABEL_PHRASES`: P's vocabulary is its own closed lists, pinned there; `encryption key` and `master key` stay
// names of the key-name rule and stay pinned here), and the megabyte line's `abc` values (N masked any word after a
// label; P masks a credential-shaped one — a three-letter word is none — and the line still runs in linear time).
//
// Synthetic text only: every value is a digest of a fixed phrase or assembled here. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redact } from '../index.js';
import { assertLinear } from './linear-clock.js';

const digest = (alg, enc, phrase) => createHash(alg).update(`m33 r repair 7 synthetic: ${phrase}`).digest(enc);
const HEX40 = digest('sha1', 'hex', 'the leaked shape');
const uuidOf = (hex) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
const alnum = (phrase, n) => digest('sha512', 'base64', phrase).replace(/[+/=]/g, '').slice(0, n);

/** Every value shape the hunt asks for, each invented here. */
const VALUES = {
  'hex 32': digest('md5', 'hex', 'hex32'),
  'hex 40 (the leaked shape)': HEX40,
  'hex 64': digest('sha256', 'hex', 'hex64'),
  'short git sha': digest('sha1', 'hex', 'short sha').slice(0, 7),
  'base64 44': digest('sha256', 'base64', 'b64'),
  'base64 24': alnum('b64 short', 24),
  uuid: uuidOf(digest('sha256', 'hex', 'uuid')),
  'sk- prefixed (named pattern)': `sk-${alnum('sk long', 48)}`,
  'sk- prefixed (short)': `sk-${alnum('sk short', 20)}`,
  'ghp_ prefixed (named pattern)': `ghp_${alnum('ghp long', 36)}`,
  'ghp_ prefixed (short)': `ghp_${alnum('ghp short', 12)}`,
  'short 12-char': alnum('twelve', 12),
  digits: '482915736048',
};

const gram = (value) => (value.length >= 16 ? 8 : 6);
/** Every run of `gram(value)` characters of `value` that `text` still holds. */
const fragments = (text, value) => {
  const n = gram(value);
  const found = [];
  for (let i = 0; i + n <= value.length; i++) if (String(text).includes(value.slice(i, i + n))) found.push(value.slice(i, i + n));
  return found;
};

// ---- the channels -----------------------------------------------------------------------------------------------------

const numbered = (text) => text.split('\n').map((line, i) => `${String(i + 1).padStart(6)}\t${line}`);
/**
 * Every channel the leak can reach, over a batch of texts in one ledger, each text in its own string: what each channel
 * emitted for each text (null where the field was withheld), and what it was given (`input`), so a kept text can be
 * compared byte for byte.
 */
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
  'a child\'s received brief': { input: (t) => t, out: (o) => o.children[0].parentInstructions.map((r) => r.parentInstruction.text) },
};

/** Redact `texts` through every channel at once: `{ [channel]: [output per text] }`. */
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
  // The heredoc and numbered-output channels ride in their own events, beside the others.
  const extra = texts.map((text, i) => ({ turn: 1, seq: texts.length + i, kind: 'bash', cmd: CHANNELS['cmd (a heredoc)'].input(text),
    tailLines: numbered(text) }));
  ledger.ledger.push(...extra);
  const { ledger: out } = redact(ledger);
  const own = out.ledger.slice(0, texts.length);
  const more = out.ledger.slice(texts.length);
  own.forEach((e, i) => { e.heredoc = more[i].cmd ?? null; e.numberedTail = more[i].tailLines; });
  const view = { ...out, ledger: own };
  return Object.fromEntries(Object.entries(CHANNELS).map(([name, c]) => [name, c.out(view, texts.length)]));
}

// ---- the labels, the separators, the contexts -------------------------------------------------------------------------

const FAMILIES = [
  // The leaked shape and the hunt's examples: a product name before a phrase, a possessive before a word.
  'recall api key', 'OpenAI API key', 'stripe secret key', 'my github token',
  // Each phrase and word of the vocabulary, bare (a phrase) or behind one word.
  'api key', 'API Key', 'access key', 'secret key', 'private key', 'signing key', 'encryption key', 'master key',
  'access token', 'auth token', 'bearer token', 'refresh token', 'client secret', 'webhook secret',
  'admin password', 'db passwd', 'wifi passphrase', 'aws credentials', 'service credential', 'basic auth', 'password salt',
  'sentry dsn', 'client key data',
  // Joined by hyphens, underscores and dots, in every case.
  'recall-api-key', 'recall_api_key', 'recall.api.key', 'RECALL API KEY', 'Recall Api Key', 'my-github-token',
  'my_github_token', 'my.github.token', 'stripe-secret-key',
];

/** How a value `v` follows a label `l`. */
const SEPARATORS = {
  'l: v': (l, v) => `${l}: ${v}`,
  'l:v': (l, v) => `${l}:${v}`,
  'l = v': (l, v) => `${l} = ${v}`,
  'l=v': (l, v) => `${l}=${v}`,
  'l is v': (l, v) => `${l} is ${v}`,
  'l is: v': (l, v) => `${l} is: ${v}`,
  'l -> v': (l, v) => `${l} -> ${v}`,
  'l => v': (l, v) => `${l} => ${v}`,
  '**l**: v': (l, v) => `**${l}**: ${v}`,
  '**l:** v': (l, v) => `**${l}:** ${v}`,
  '`l`: v': (l, v) => `\`${l}\`: ${v}`,
  '"l": "v"': (l, v) => `"${l}": "${v}"`,
  "'l': 'v'": (l, v) => `'${l}': '${v}'`,
  'l: "v"': (l, v) => `${l}: "${v}"`,
  "l: 'v'": (l, v) => `${l}: '${v}'`,
  'l: `v`': (l, v) => `${l}: \`${v}\``,
  'l: **v**': (l, v) => `${l}: **${v}**`,
};

/** What stands around the label and its value. */
const CONTEXTS = {
  'a line of its own': (s) => s,
  'mid-sentence': (s) => `Here it is, ${s}. Rotate it after the demo.`,
  'in parentheses': (s) => `(${s})`,
  'a list item': (s) => `- ${s}`,
  'after an escaped line break': (s) => `first line\\n${s}\\nlast line`,
};

// ---- the exact leaked shape -------------------------------------------------------------------------------------------

test('M33 R repair 7 premise: an unlabelled hex run is kept in every channel (BENIGN, and under the floor): only its label can mask it', () => {
  // The base redactor's own verdict on the value, unlabelled: the backstop keeps a hex run (BENIGN's git sha, and under
  // the floor besides). Labelled, it is this repair's rule — and only it — that masks it.
  const outs = through([`commit ${HEX40}`]);
  for (const [channel, [out]] of Object.entries(outs)) {
    assert.equal(out, CHANNELS[channel].input(`commit ${HEX40}`), `${channel}: an unlabelled hex run is kept, as before`);
  }
});

test('M33 R repair 7: the exact leaked shape is masked in every channel, the label kept', () => {
  const line = `recall api key: ${HEX40}`;
  const masked = 'recall api key: ‹redacted:secret-value›';
  const outs = through([line]);
  for (const [channel, [out]] of Object.entries(outs)) {
    assert.deepEqual(fragments(out, HEX40), [], channel);
    assert.equal(out, CHANNELS[channel].input(masked), channel);
  }
  // And as the reviewer's 30 requests carried it: inside a sentence of the ask, and pasted as a list.
  const ask = redact({ ask: [{ turn: 1, text: `Use my ${line} for the sync job, then rotate it.` }], ledger: [] }).ledger.ask[0].text;
  assert.equal(ask, 'Use my recall api key: ‹redacted:secret-value› for the sync job, then rotate it.');
  const r = redact({ ask: [{ turn: 1, text: line }], ledger: [] });
  assert.deepEqual(r.dropped.map((d) => d.reason), ['redacted:secret-key-value'], 'declared under the closed vocabulary');
});

// ---- every family x separator x value shape x context x channel ----------------------------------------------------

for (const family of FAMILIES) {
  test(`M33 R repair 7: "${family}" — no value shape survives any separator, context or channel`, () => {
    const cells = [];
    for (const [sep, give] of Object.entries(SEPARATORS)) {
      for (const [shape, value] of Object.entries(VALUES)) {
        for (const [context, write] of Object.entries(CONTEXTS)) cells.push({ sep, shape, context, value, text: write(give(family, value)) });
      }
    }
    const outs = through(cells.map((c) => c.text));
    const failures = [];
    for (const [channel, list] of Object.entries(outs)) {
      list.forEach((out, i) => {
        if (fragments(out, cells[i].value).length) failures.push(`${channel} | ${cells[i].sep} | ${cells[i].shape} | ${cells[i].context}: ${JSON.stringify(out)}`);
      });
    }
    assert.equal(failures.length, 0, `${failures.length} cells leak, first:\n${failures.slice(0, 8).join('\n')}`);
  });
}

test('M33 R repair 7: the value is masked where it stands; the label, its separator and the prose around it are kept', () => {
  const v = VALUES['short 12-char'];
  const cases = [
    [`recall api key: ${v}`, 'recall api key: ‹redacted:secret-value›'],
    [`OpenAI API key = ${v}`, 'OpenAI API key = ‹redacted:secret-value›'],
    [`stripe secret key -> ${v}`, 'stripe secret key -> ‹redacted:secret-value›'],
    [`my github token is ${v} and it works`, 'my github token is ‹redacted:secret-value› and it works'],
    [`**recall api key**: ${v}`, '**recall api key**: ‹redacted:secret-value›'],
    [`**recall api key:** \`${v}\``, '**recall api key:** `‹redacted:secret-value›`'],
    [`"recall api key": "${v}"`, '"recall api key": "‹redacted:secret-value›"'],
    [`(recall api key: ${v})`, '(recall api key: ‹redacted:secret-value›)'],
    [`Set recall_api_key: ${v}. Then deploy.`, 'Set recall_api_key: ‹redacted:secret-value›. Then deploy.'],
    [`the auth token: Bearer ${v}`, 'the auth token: Bearer ‹redacted:secret-value›'],
    [`my recall api key is now ${HEX40}`, 'my recall api key is now ‹redacted:secret-value›'],
    [`recall api key: set to ${HEX40}`, 'recall api key: set to ‹redacted:secret-value›'],
  ];
  const outs = through(cases.map(([text]) => text));
  for (const channel of ['ask', 'saying', 'cmd', 'tailLines', 'argsExcerpt', 'after', 'delegation report']) {
    cases.forEach(([text, want], i) => assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${text}`));
  }
});

test('M33 R repair 7: the older shapes keep their decisions; the label rule reads only what none of them masked', () => {
  const v = VALUES['short 12-char'];
  const cmdOf = (text) => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text }] }).ledger.ledger[0].cmd;
  const askOf = (text) => redact({ ask: [{ turn: 1, text }], ledger: [] }).ledger.ask[0].text;
  // A name a `$` is glued to is a variable's reference (continued-lines.test.js F186 pins this line clean).
  assert.equal(cmdOf(`echo $API_KEY=${v} node app.js`), `echo $API_KEY=${v} node app.js`);
  // `NAME= cmd` is the shell's empty assignment (whole-value.test.js W3e-8 pins it kept in a command).
  assert.equal(cmdOf('API_TOKEN= ./run.sh'), 'API_TOKEN= ./run.sh');
  // An array is masked inside its brackets, as the Q shape masks it, and a second pass changes nothing.
  const array = `+{"api_keys": ["${v}", "${VALUES.digits}"], "n": 2}`;
  assert.equal(askOf(array), '+{"api_keys": [‹redacted:secret-value›], "n": 2}');
  assert.equal(askOf(askOf(array)), askOf(array));
  // A shell default is the R shape's: masked to the reference's brace, the operator kept.
  assert.equal(askOf(`run with \${RECALL_API_KEY:-${v}} now`), 'run with ${RECALL_API_KEY:-‹redacted:secret-value›} now');
  // A template or a nested object is no value of its own; their keys are read on their own.
  assert.equal(askOf('the deploy token: {{ secrets.GH_TOKEN }}'), 'the deploy token: {{ secrets.GH_TOKEN }}');
  // A label with a run of blanks, and a value in escaped quotes inside a JSON string.
  assert.equal(askOf(`recall  api  key: ${v}`), 'recall  api  key: ‹redacted:secret-value›');
  assert.equal(askOf(`{"content":"recall api key: \\"${v}\\"\\nnext"}`), '{"content":"recall api key: \\"‹redacted:secret-value›\\"\\nnext"}');
  assert.equal(askOf(`{"note":"recall api key: ${v}\\nnext"}`), '{"note":"recall api key: ‹redacted:secret-value›\\nnext"}');
  // A named pattern keeps its own label when the label rule's value is the same token.
  assert.equal(askOf(`OpenAI API key: ${VALUES['sk- prefixed (named pattern)']}`), 'OpenAI API key: ‹redacted:openai-key›');
});

test('M33 R repair 7: a label qualified after its phrase, or followed by its value with no separator, still masks a credential', () => {
  const masked = {
    'a parenthetical': [`recall api key (prod): ${HEX40}`, 'recall api key (prod): ‹redacted:secret-value›'],
    '"for" and a name': [`api key for prod: ${HEX40}`, 'api key for prod: ‹redacted:secret-value›'],
    'both': [`the admin password for staging (rotated) = ${VALUES['short 12-char']}`,
      'the admin password for staging (rotated) = ‹redacted:secret-value›'],
    'no separator, hex': [`here is my recall api key ${HEX40} thanks`, 'here is my recall api key ‹redacted:secret-value› thanks'],
    'no separator, prefixed': [`OpenAI API key ${VALUES['sk- prefixed (short)']}`, 'OpenAI API key ‹redacted:secret-value›'],
    'no separator, quoted': [`my github token "${VALUES['short 12-char']}"`, 'my github token "‹redacted:secret-value›"'],
    'no separator, uuid': [`the webhook secret ${VALUES.uuid}.`, 'the webhook secret ‹redacted:secret-value›.'],
  };
  const kept = [
    // With no separator only a credential-shaped word is a value: eight or more letters, digits and `+/=_-`, with a
    // letter and a digit among them. Prose, a short word, a path and a number stay.
    'the api key rotation plan is ready', 'my github token v2 works', 'for token in tokens2:', 'the access token 3600 seconds',
    'the private key ~/.ssh/id_ed25519', 'gh auth token', 'def api_key(self): return self.key', 'API key (see the docs): none',
    'the password for admin: see the vault',
  ];
  const texts = [...Object.values(masked).map(([text]) => text), ...kept];
  const outs = through(texts);
  for (const channel of ['ask', 'saying', 'cmd', 'tailLines', 'argsExcerpt', 'after', 'diff', 'delegation report']) {
    Object.entries(masked).forEach(([what, [text, want]], i) => {
      // An output line (or a helper's report, scrubbed as output) whose UUID holds `-4286-` also reads as a `grep`
      // context line (`path-N-`): that de-numbered view disagrees with the line as written, and the line is dropped,
      // counted — fail closed, as it is for `secret: <uuid>`.
      if ((channel === 'tailLines' || channel === 'delegation report') && what === 'no separator, uuid') {
        assert.deepEqual(fragments(outs[channel][i], VALUES.uuid), [], text);
        return;
      }
      assert.equal(outs[channel][i], CHANNELS[channel].input(want), `${channel}: ${what}`);
    });
    kept.forEach((text, j) => assert.equal(outs[channel][Object.keys(masked).length + j], CHANNELS[channel].input(text), `${channel}: ${text}`));
  }
});

// ---- item 2: BENIGN is for unlabelled tokens only ---------------------------------------------------------------------

test('M33 R repair 7: a labelled value is never exempted by BENIGN (git sha hex, base64, digits); an unlabelled one still is', () => {
  const benign = {
    'git sha 7': VALUES['short git sha'], 'git sha 40': HEX40, 'hex 64': VALUES['hex 64'],
    'base64 24': VALUES['base64 24'], digits: VALUES.digits, 'long digits': '48291573604812345678901234',
  };
  const labelled = Object.values(benign).map((v) => `the recall api key is ${v}`);
  const bare = Object.values(benign).map((v) => `the recall build is ${v}`);
  const outs = through([...labelled, ...bare]);
  for (const [channel, list] of Object.entries(outs)) {
    Object.values(benign).forEach((v, i) => {
      assert.deepEqual(fragments(list[i], v), [], `${channel}: labelled ${v}`);
      assert.equal(list[labelled.length + i], CHANNELS[channel].input(bare[i]), `${channel}: unlabelled ${v} is kept`);
    });
  }
});

// ---- item 3: prose stays usable ---------------------------------------------------------------------------------------

const PROSE = [
  'api key: see the docs',
  'api key: <your key here>',
  'API key: none',
  'API key: None',
  'OpenAI API key: $OPENAI_API_KEY',
  'recall api key: ${RECALL_API_KEY}',
  'recall api key: "${RECALL_API_KEY}"',
  'api key: `$RECALL_API_KEY`',
  'stripe secret key: ***',
  'my github token: xxx',
  'api key: ...',
  'API key: <YOUR_API_KEY>',
  'API key: <your-api-key>',
  'admin password: changeme',
  'The OpenAI API key is not set.',
  'The API key is invalid.',
  'my github token is stored in the keychain',
  'the api key is missing, so the request failed',
  '**API key**: see below',
  'OpenAI API key:',
  'API key: true',
  'TLS cert: certs/server.pem',
  'Unexpected token: }',
  'max tokens: 4096',
  'the api key rotation is done: all good',
  'print("API key:", key)',
  'console.log("recall api key: " + key)',
  'if token is None: return',
  'if self.api_key is not None:',
  'grep -n "api key: " notes.txt',
  'the access token is valid for 3600s',
  "API key: I'll check",
  'first pass: compile everything',
];

test('M33 R repair 7: prose, placeholders and references after a label are kept byte for byte in every channel', () => {
  const outs = through(PROSE);
  const failures = [];
  for (const [channel, list] of Object.entries(outs)) {
    list.forEach((out, i) => { if (out !== CHANNELS[channel].input(PROSE[i])) failures.push(`${channel}: ${JSON.stringify(PROSE[i])} -> ${JSON.stringify(out)}`); });
  }
  assert.equal(failures.length, 0, `${failures.length} prose cells changed, first:\n${failures.slice(0, 8).join('\n')}`);
});

// ---- the vocabulary ---------------------------------------------------------------------------------------------------

test('M33 R repair 7: `encryption key` and `master key` are names of the key-name rule; bare `pass`, `pwd` and `tokens` are no label', () => {
  // The two phrases repair 7 adds, added where every rule reads them: the key-name rule masks them as names too.
  for (const name of ['ENCRYPTION_KEY', 'master_key']) {
    const v = VALUES['hex 64'];
    const out = redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `export ${name}=${v}` }] }).ledger.ledger[0].cmd;
    assert.equal(out, `export ${name}=‹redacted:secret-value›`, name);
  }
  // Bare `pass` and `pwd` are not labels (`first pass:`, the shell's `pwd`); `tokens` is a count.
  for (const text of ['second pass: abc123def456', 'current pwd: /work/x1', 'input tokens: 482915736048']) {
    assert.equal(through([text]).ask[0], text, text);
  }
});

// ---- stability --------------------------------------------------------------------------------------------------------

test('M33 R repair 7: redaction is idempotent and deterministic over labelled values', () => {
  const texts = Object.entries(SEPARATORS).flatMap(([, give]) => FAMILIES.slice(0, 6).map((family) => give(family, HEX40)));
  const once = through(texts);
  const twice = through(once.ask);
  assert.deepEqual(twice.ask, once.ask, 'f(f(x)) === f(x)');
  assert.deepEqual(through(texts), once, 'the same bytes twice');
});

test('M33 R repair 7: a megabyte of labels on one line is read in linear time', () => {
  const line = `${'the api key: abc '.repeat(40_000)}${'a'.repeat(200_000)} my token: ${'b'.repeat(300_000)}`;
  let out;
  // 10 s of CPU, scaled by the slowdown measured under load (linear-clock.js), never a wall-clock limit.
  assertLinear(() => { out = redact({ ask: [{ turn: 1, text: line }], ledger: [] }).ledger.ask[0].text; }, 10_000,
    'labels');
  assert.ok(!out.includes('a'.repeat(64)) && !out.includes('b'.repeat(64)), 'every credential-shaped value is masked');
});
