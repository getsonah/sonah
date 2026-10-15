// W3e-1 — redaction keeps what it does not redact.
//
// F186. `scrubLines` joins backslash-continued lines so a token split across a continuation is
// scanned whole — and then used to EMIT the joined text even when nothing was found, so every
// multi-line shell command, Makefile rule or continued string in a body, a saying or an
// instruction lost its `\`, newline and indentation. The scan needs the joined line; the output
// does not. Each logical line is now scanned joined AND physical line by physical line; when every
// scan is clean the physical lines are kept byte for byte, and when any scan finds anything no
// original physical line of it is emitted.
//
// F184. A dropped-lines note is written at the source cut, before the next surviving line.
// For an Edit it stays inside the side it counts, so no count lands in the next side.
//
// F185. A key block the recorder cut ends where the recorded text ends: at the stub of a declared
// cut, or at an Edit's separator. The stub, the separator and the next side survive.
//
// Every fixture is synthetic. Secret-shaped values are assembled at run time, so this file carries
// no literal a secret scan would flag. No real recording is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';
import { ARG_SEP } from '../../slicer/src/events.js';
/** The body cap an earlier Sonah cut at (M33 R to D68 E): its stub stands in a persisted ledger only. */
const BEFORE_CAP = 20_000;

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const lineCount = (text) => text.split('\n').length;

/** The same text through every channel `scrubLines` serves. */
const CHANNELS = {
  before: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'scripts/run.sh',
    before: { text, source: 'read', turn: 1, partial: false, truncated: false, lines: lineCount(text) } }] })).ledger.ledger[0].before.text,
  'write body': (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'scripts/run.sh',
    after: { text, truncated: false, lines: lineCount(text) } }] })).ledger.ledger[0].after.text,
  // The written side of an edit, followed by a clean replaced side that is taken back off.
  'edit written side': (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'scripts/run.sh',
    after: { text: `${text}${ARG_SEP}old`, truncated: false, lines: lineCount(text) + 2, parts: 1, priorParts: 1 } }] }))
    .ledger.ledger[0].after.text.replace(`${ARG_SEP}old`, ''),
  saying: (text) => redact(led({ sayings: [{ turn: 1, text }] })).ledger.sayings[0].text,
  commentary: (text) => redact(led({ commentary: [{ turn: 1, beforeEvent: 0, text }] })).ledger.commentary[0].text,
  claim: (text) => redact(led({ claim: { finalMessage: text } })).ledger.claim.finalMessage,
};
/** The two line-level channels: an unclassifiable token drops its line there. */
const BODY_CHANNELS = ['before', 'write body', 'edit written side'];

const after = (text, extra = {}) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'keys/load.js',
  after: { text, truncated: false, lines: lineCount(text), parts: 1, priorParts: 1, ...extra } }] }));
const beforeOf = (text, extra = {}) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'keys/load.js',
  before: { text, source: 'read', turn: 1, partial: false, truncated: false, lines: lineCount(text), ...extra } }] }));

const AWS = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const BEARER = [['Bear', 'er'].join(''), 'abcdefghijklmnopqrstuvwxyz012345'].join(' ');
const API_VALUE = 'hunter2-W3E1';                                   // short: no length rule sees it
const API_LINE = `  API_KEY=${API_VALUE} \\`;                        // SECRET_KEY sees it, on its own line
const BLOB = 'Zk3!q9Xv%2Lp#7Rw@Nb^4Ty&8Ue*Hs$Jd';                    // unclassifiable, high entropy
// W3e-3 / F199: the note names the reason the lines went (redact/index.js DROPPED_NOTE_PHRASES).
const NOTE = (n, phrase = 'unclassified high-entropy content') => `[… ${n} line(s) dropped: ${phrase} …]`;
const KEY_BLOCK = 'private key block';
const SECRET_NAMED = 'secret-named value';
const AWS_KEY = 'AWS access key';
const STUB = `\n[… truncated at ${BEFORE_CAP} chars …]`;

// ---- F186: a clean continued line is kept as written ------------------------------------------

const CLEAN = {
  'a three-line shell command': ['docker run --rm \\', '  --volume "./src:/work/src" \\', '  node:20 npm test'].join('\n'),
  'a Makefile rule': ['build: deps', '\t$(CC) $(CFLAGS) \\', '\t\t-o build/app \\', '\t\tsrc/main.c', ''].join('\n'),
  'a continued string': 'const message = "first half \\\n    second half";',
  'a continuation over a blank line': ['make all \\', '', '    install'].join('\n'),
};

for (const [name, text] of Object.entries(CLEAN)) {
  for (const [channel, through] of Object.entries(CHANNELS)) {
    test(`F186 ${name} is byte-identical after redaction (${channel})`, () => {
      assert.equal(through(text), text);
    });
  }
}

test('F186 an edit side ending in a backslash keeps it, and so does the side after it', () => {
  for (const [written, replaced] of [['run --flag \\', 'run'], ['run --flag \\\n', 'run \\'], ['', 'old \\'],
    ['make \\\n  all \\', 'make \\\n  all']]) {
    const text = `${written}${ARG_SEP}${replaced}`;
    assert.equal(after(text).ledger.ledger[0].after.text, text, JSON.stringify(text));
  }
});

// ---- F186: every view is scanned, and a dirty logical line never leaks a physical one -----------

test('F186 a secret only the joined line reveals is still masked, in every channel', () => {
  const lines = [`aws configure set aws_access_key_id ${AWS.slice(0, 8)}\\`, `  ${AWS.slice(8)} --profile ci`];
  for (const line of lines) assert.equal(CHANNELS.before(line), line, 'premise: neither half is a secret on its own line');
  for (const [channel, through] of Object.entries(CHANNELS)) {
    const out = through(lines.join('\n'));
    assert.ok(!out.includes(AWS.slice(0, 8)) && !out.includes(AWS.slice(8)), `${channel}: no half of the key survives`);
    assert.match(out, /‹redacted:aws-key›/, `${channel}: it is caught as the key it is`);
  }
});

test('F186 a line that is clean joined but whose second physical line alone is flagged is dropped, counted', () => {
  // W3e-4 / F201: this test's joined line was `env API_KEY=… node app.js` — no longer clean: the
  // key-name rule now sees an assignment inside a line, and masks it (a secret caught). A `$` glued
  // to the name keeps the joined line clean (it reads as a variable reference, not an assignment),
  // so the subject — a view that is clean where another is not — is tested as before.
  assert.equal(CHANNELS.before(`env API_KEY=${API_VALUE} node app.js`), 'env API_KEY=‹redacted:secret-value› node app.js');
  const text = ['echo $\\', API_LINE, '  node app.js'].join('\n');
  const joined = `echo $API_KEY=${API_VALUE} node app.js`;
  assert.equal(CHANNELS.before(joined), joined, 'premise: the joined line is clean');
  assert.notEqual(CHANNELS.before(API_LINE), API_LINE, 'premise: its second physical line alone is not');
  for (const [channel, through] of Object.entries(CHANNELS)) {
    const out = through(text);
    assert.ok(!out.includes(API_VALUE), `${channel}: the value the physical line revealed does not survive`);
    for (const line of text.split('\n'))
      assert.ok(!out.split('\n').includes(line), `${channel}: no original physical line of it is emitted: ${JSON.stringify(line)}`);
    assert.ok(out.includes(NOTE(3, SECRET_NAMED)), `${channel}: the drop is declared, counted in physical lines, with its reason`);
  }
  const body = beforeOf(text).ledger.ledger[0];
  assert.equal(body.before.redactedLines, 3);
  assert.equal(body.redacted, true);
});

test('F186 a key glued to a continuation is caught by its physical line when the joined line hides it', () => {
  // `AKIA…\b` needs a word boundary after the key: the joined line glues the next line onto it.
  const text = [`echo ${AWS}\\`, 'QRS done'].join('\n');
  assert.equal(CHANNELS.before(`echo ${AWS}QRS done`), `echo ${AWS}QRS done`, 'premise: the joined line is clean');
  for (const [channel, through] of Object.entries(CHANNELS)) {
    const out = through(text);
    assert.ok(!out.includes(AWS.slice(4)), `${channel}: the key does not survive`);
    assert.ok(out.includes(NOTE(2, AWS_KEY)), `${channel}: the logical line is dropped and declared, with its reason`);
  }
});

test('F186 when the joined line masks one secret and a physical line reveals another, neither survives', () => {
  const text = [`curl -H "Authorization: ${BEARER}" \\`, API_LINE, '  https://api.example.test/v1'].join('\n');
  for (const [channel, through] of Object.entries(CHANNELS)) {
    const out = through(text);
    assert.ok(!out.includes(API_VALUE), `${channel}: the value only a physical line saw does not survive`);
    assert.ok(!out.includes(BEARER.slice(7)), `${channel}: nor the token both views saw`);
  }
});

test('F186 a dirty continued line is emitted as today: the masked joined line, never a physical line of it', () => {
  const text = [`curl -H "Authorization: ${BEARER}" \\`, '  --retry 3 \\', '  https://api.example.test/v1/items'].join('\n');
  const masked = 'curl -H "Authorization: ‹redacted:bearer›" --retry 3 https://api.example.test/v1/items';
  for (const [channel, through] of Object.entries(CHANNELS)) assert.equal(through(text), masked, channel);
});

test('F186 an unclassifiable continued body line is marked at the cut before the next line', () => {
  const text = ['deploy \\', `  --seed ${BLOB} \\`, '  --region eu', 'echo done'].join('\n');
  for (const channel of BODY_CHANNELS) assert.equal(CHANNELS[channel](text), `${NOTE(3)}\necho done`, channel);
  // The prose channels drop the token and keep the line (D32); a dirty line is the joined line.
  assert.equal(CHANNELS.saying(text), 'deploy --seed ‹dropped:high-entropy› --region eu\necho done');
});

// ---- F184: a note separates the surviving source spans at the cut ------------------------------

test('F184 a line dropped from an edit\'s written side is declared there, and the replaced side is exactly what it replaced', () => {
  const written = ['const seed = loadSeed();', `  seed: ${BLOB}`, 'export default seed;'].join('\n');
  const replaced = 'const seed = null;';
  const { ledger } = after(`${written}${ARG_SEP}${replaced}`);
  const out = ledger.ledger[0].after;
  assert.equal(out.text, `const seed = loadSeed();\n${NOTE(1)}\nexport default seed;${ARG_SEP}${replaced}`);
  assert.equal(out.text.split(ARG_SEP)[1], replaced, 'nothing of the redactor\'s is in the replaced side');
  assert.equal(out.redactedLines, 1);
});

test('F184 a MultiEdit declares each segment\'s drops at the end of that segment', () => {
  const segments = ['one();', `two(${BLOB});`, 'old one', `old ${BLOB} two`];
  const out = after(segments.join(ARG_SEP), { parts: 2, priorParts: 2 }).ledger.ledger[0].after;
  assert.deepEqual(out.text.split(ARG_SEP), ['one();', NOTE(1), 'old one', NOTE(1)]);
  assert.equal(out.redactedLines, 2, 'the field still declares its whole count');
});

test('F184 a whole body puts its note at the missing line', () => {
  const text = ['alpha', `seed: ${BLOB}`, 'omega'].join('\n');
  assert.equal(CHANNELS['write body'](text), `alpha\n${NOTE(1)}\nomega`);
  assert.equal(CHANNELS.before(text), `alpha\n${NOTE(1)}\nomega`);
});

// ---- F185: a cut key block ends where the recorded text ends -----------------------------------

const BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const END = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const keyLine = (i) => Array.from({ length: 64 }, (_, k) => B64[(i * 29 + k * 37 + ((k * k) % 11)) % 64]).join('');
const keyBody = (n) => Array.from({ length: n }, (_, i) => keyLine(i));
const noKeyMaterial = (text) => !text.includes(BEGIN) && keyBody(40).every((l) => !text.includes(l.slice(0, 32)));

test('F185 an edit whose written side is cut inside a key block keeps its stub, its separator and its replaced side', () => {
  const written = ['const key = `', BEGIN, ...keyBody(3)].join('\n');
  const replaced = 'const key = loadKey();';
  const { ledger, dropped } = after(`${written}${STUB}${ARG_SEP}${replaced}`, { truncated: true });
  const out = ledger.ledger[0].after;
  assert.equal(out.text, `const key = \`\n${NOTE(4, KEY_BLOCK)}${STUB}${ARG_SEP}${replaced}`);
  assert.ok(noKeyMaterial(out.text), 'every key line is gone');
  assert.equal(out.redactedLines, 4, 'and counted');
  assert.ok(dropped.some((d) => d.reason === 'dropped:pem-block' && d.where === 'after'));
});

test('F185 a MultiEdit cut inside a key keeps every later segment in its place', () => {
  const text = [`head\n${BEGIN}\n${keyBody(2).join('\n')}${STUB}`, STUB, 'old one', 'old two'].join(ARG_SEP);
  const out = after(text, { truncated: true, parts: 2, priorParts: 2 }).ledger.ledger[0].after.text;
  assert.deepEqual(out.split(ARG_SEP), [`head\n${NOTE(3, KEY_BLOCK)}${STUB}`, STUB, 'old one', 'old two']);
});

test('F185 a whole body cut inside a key block keeps its stub', () => {
  const text = `import fs from "node:fs";\n${BEGIN}\n${keyBody(2).join('\n')}${STUB}`;
  const out = beforeOf(text, { truncated: true }).ledger.ledger[0].before;
  assert.equal(out.text, `import fs from "node:fs";\n${NOTE(3, KEY_BLOCK)}${STUB}`);
  assert.equal(out.redactedLines, 3);
});

test('F185 a key block the recorder did not cut still ends only at its END line (fail closed)', () => {
  // A stub-shaped line in a field that declares no cut is not the recorder's: the block runs on.
  const text = `a\n${BEGIN}\n${keyLine(0)}${STUB}\n${keyLine(1)}\n${END}\nz`;
  for (const [channel, through] of Object.entries(CHANNELS)) {
    const out = through(text);
    assert.ok(noKeyMaterial(out), channel);
    assert.ok(!out.includes(STUB.slice(1)), `${channel}: the stub-shaped line inside the block goes with it`);
    assert.ok(out.startsWith('a\n') && out.includes('\nz'), `${channel}: the lines around the block stay`);
  }
  // An unclosed block with no declared cut drops everything after it, as it always has.
  assert.equal(CHANNELS.before(`a\n${BEGIN}\n${keyLine(0)}\nz`), `a\n${NOTE(3, KEY_BLOCK)}`);
});

test('F185 a separator-shaped line ends a key block only in an edit\'s own text', () => {
  const text = `a\n${BEGIN}\n${keyLine(0)}${ARG_SEP}${keyLine(1)}`;
  const plain = CHANNELS['write body'](text);
  assert.equal(plain, `a\n${NOTE(4, KEY_BLOCK)}`, 'a body with no parts: the line is the block\'s, and goes with it');
  const edit = after(text).ledger.ledger[0].after.text;
  assert.ok(noKeyMaterial(edit), 'in an edit the replaced side is scanned on its own and the key line still goes');
  assert.ok(edit.startsWith(`a\n${NOTE(2, KEY_BLOCK)}${ARG_SEP}`), 'and the separator survives');
});

// ---- the invariants ------------------------------------------------------------------------------

test('W3e-1 redaction stays idempotent over continued lines, stubs, separators and notes', () => {
  const inputs = [CLEAN['a three-line shell command'], ['env \\', API_LINE, '  node app.js'].join('\n'),
    `${['const key = `', BEGIN, ...keyBody(3)].join('\n')}${STUB}${ARG_SEP}old \\`,
    `x \\${ARG_SEP}seed: ${BLOB}`];
  for (const text of inputs) {
    const once = after(text, { truncated: text.includes(STUB) }).ledger.ledger[0].after.text;
    assert.equal(after(once, { truncated: text.includes(STUB) }).ledger.ledger[0].after.text, once, JSON.stringify(text));
  }
});
