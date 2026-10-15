// W3e-7 / F220 — a value is a placeholder only when the WHOLE value is one (security).
//
// The key-name rule keeps a documentation placeholder visible (`password: none`, `token: <token>`,
// `API_KEY=${API_KEY}`). It also kept a value of several words whenever its FIRST word was one, so
// `password: none shall pass` came through a command, an ask and a tail raw — the same line a body's
// content rule masks. A placeholder word now spares only a value that is that word and nothing else.
//
// One shape still ends at its first word, and it is not a placeholder rule: in a field that is not
// a command, `NAME=` followed by a variable reference or a `<…>` placeholder and then more words is a
// shell assignment written out (`API_TOKEN=${API_TOKEN} npm run deploy`) — no program prints a
// reference where a value belongs, so the words after it are the command the assignment prefixes, as
// they are in a command. Its value is that one word, and a placeholder only when all of it is.
//
// Every fixture is synthetic; values are assembled at run time. No real recording is read and no
// session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const event = (over) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', ...over }] })).ledger.ledger[0];

const V = ['hunt', 'er2', 'xW3e7'].join('');
const MASK = '‹redacted:secret-value›';

/** Every field class. */
const FIELDS = {
  cmd: (text) => event({ cmd: text }).cmd,
  argsExcerpt: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'deploy.sh', argsExcerpt: text }] }))
    .ledger.ledger[0].argsExcerpt,
  ask: (text) => redact(led({ ask: [{ turn: 1, text }] })).ledger.ask[0].text,
  tailLines: (text) => {
    const lines = event({ cmd: 'make deploy', tailLines: text.split('\n') }).tailLines;
    return Array.isArray(lines) ? lines.join('\n') : lines;
  },
  body: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'conf/app.cfg',
    after: { text, truncated: false, lines: 1 } }] })).ledger.ledger[0].after.text,
  saying: (text) => redact(led({ sayings: [{ turn: 1, text }] })).ledger.sayings[0].text,
  diff: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'conf/app.cfg', diff: `+${text}` }] }))
    .ledger.ledger[0].diff.replace(/^\+/, ''),
};

/** The placeholder words and marks both the key-name rule and the content rule know, each a whole
 *  value. (`REDACTED`, `your_password`, `placeholder` are the key-name rule's alone: a body's content
 *  rule masks them, as it always has, so they are not kept in every field.) */
const PLACEHOLDERS = ['none', 'null', 'NONE', 'example', 'changeme', 'xxx', '***', '...', '<password>'];

test('F220 the spec\'s pair: `password: none` is kept, `password: none shall pass` is masked, in every field', () => {
  for (const [field, through] of Object.entries(FIELDS)) {
    assert.equal(through('password: none'), 'password: none', field);
    assert.equal(through('password: none shall pass'), `password: ${MASK}`, field);
  }
});

test('F220 every placeholder word is kept when it is the whole value', () => {
  for (const [field, through] of Object.entries(FIELDS)) {
    for (const word of PLACEHOLDERS) {
      for (const text of [`password: ${word}`, `  api_key: ${word}`, `{"token": "${word}"}`, `curl -H "X-Api-Key: ${word}" x`]) {
        assert.equal(through(text), text, `${field}: ${text}`);
      }
    }
  }
});

test('F220 a placeholder word that opens a value of several words spares none of it', () => {
  for (const [field, through] of Object.entries(FIELDS)) {
    for (const word of PLACEHOLDERS) {
      for (const text of [`password: ${word} ${V}`, `password: ${word} shall pass`]) {
        const out = through(text);
        assert.notEqual(out, text, `${field}: ${text} came back unmasked`);
        assert.ok(typeof out !== 'string' || !out.includes(V), `${field}: the value survives in ${text}`);
      }
    }
  }
});

test('F220 the header, cookie and quoted-assignment shapes judge the whole value too', () => {
  const shapes = [
    [`curl -H "X-Api-Key: none ${V}" https://api.example.test/v1`, `curl -H "X-Api-Key: ${MASK}" https://api.example.test/v1`],
    [`curl -H 'Authorization: Bearer none ${V}' https://api.example.test/v1`,
      `curl -H 'Authorization: Bearer ${MASK}' https://api.example.test/v1`],
    [`curl -H "Cookie: none sid=${V}" https://app.example.test/`, `curl -H "Cookie: ${MASK}" https://app.example.test/`],
    [`Cookie: null sid=${V}`, `Cookie: ${MASK}`],
    [`echo "SERVICE_SECRET=example ${V}" >> .env.local`, `echo "SERVICE_SECRET=${MASK}" >> .env.local`],
  ];
  for (const [field, through] of Object.entries(FIELDS)) {
    for (const [text, masked] of shapes) assert.equal(through(text), masked, `${field}: ${text}`);
  }
});

test('F220 a value the content rule spares by its first characters is masked by the key-name rule when it is not whole', () => {
  // The line-start content rule never matches a value that opens with `$`, `<`, `***`, `xxx` or `...`;
  // what it leaves is the key-name rule's to judge, and that rule now judges the whole value.
  for (const [field, through] of Object.entries(FIELDS)) {
    for (const text of [`password: xxx ${V}`, `password: *** ${V}`, `password: ... ${V}`, `password: <password> ${V}`,
      `password: $DB_PASSWORD ${V}`, `token: \${TOKEN} ${V}`]) {
      assert.equal(through(text), text.replace(/: .*/, `: ${MASK}`), `${field}: ${text}`);
    }
  }
});

test('F220 a whole-value placeholder is declared nowhere; a masked one is declared once', () => {
  const kept = redact(led({ ledger: [{ turn: 2, seq: 0, kind: 'bash', cmd: 'password: none' }] }));
  assert.deepEqual(kept.dropped, []);
  const masked = redact(led({ ledger: [{ turn: 2, seq: 0, kind: 'bash', cmd: 'password: none shall pass' }] }));
  assert.deepEqual(masked.dropped, [{ turn: 2, reason: 'redacted:secret-key-value', where: 'cmd' }]);
});

// ---- a shell assignment written out: its value is its first word ------------------------------------

test('F220 an assignment whose value opens with a reference, then a command, is kept where it is written out', () => {
  // W3e-4's pinned placeholders (secret-named.test.js), in the fields that test pins them in. (A body's
  // content rule masks a quoted reference with words after it, as it always has; it never matches a
  // value that opens with `$` or `<`.)
  const fields = ['cmd', 'argsExcerpt', 'ask', 'tailLines'];
  for (const text of ['API_TOKEN=${API_TOKEN} npm run deploy', 'export API_TOKEN="$API_TOKEN" && npm run deploy',
    'API_KEY=<your-api-key> npm start', "DEPLOY_TOKEN='$DEPLOY_TOKEN' ./deploy.sh --prod"]) {
    for (const field of fields) assert.equal(FIELDS[field](text), text, `${field}: ${text}`);
  }
  for (const text of ['API_TOKEN=${API_TOKEN} npm run deploy', 'API_KEY=<your-api-key> npm start'])
    for (const [field, through] of Object.entries(FIELDS)) assert.equal(through(text), text, `${field}: ${text}`);
});

test('F220 that shape is an assignment only: the same words after a separator with blanks, or glued, are masked', () => {
  const texts = [
    [`API_TOKEN = \${API_TOKEN} ${V}`, `API_TOKEN = ${MASK}`],
    [`API_TOKEN: \${API_TOKEN} ${V}`, `API_TOKEN: ${MASK}`],
    [`API_TOKEN=\${API_TOKEN}${V} npm run deploy`, null],
    [`API_TOKEN=none ${V}`, null],
    [`API_TOKEN=null npm run deploy`, null],
  ];
  // The fields that take a line-start assignment's value to the end of its line (a command and the ask
  // read it as one shell word, and there `API_TOKEN=none` then a command is the placeholder it looks like).
  for (const field of ['argsExcerpt', 'tailLines', 'body', 'diff']) {
    for (const [text, masked] of texts) {
      const out = FIELDS[field](text);
      assert.ok(!out.includes(V), `${field}: the value survives in ${text}`);
      assert.notEqual(out, text, `${field}: ${text} came back unmasked`);
      if (masked) assert.equal(out, masked, `${field}: ${text}`);
    }
  }
});

test('F220 redaction stays idempotent over the whole-value shapes', () => {
  for (const text of ['password: none shall pass', `curl -H "Cookie: none sid=${V}" x`, 'API_TOKEN=${API_TOKEN} npm run deploy',
    `password: xxx ${V}`]) {
    const input = led({ ask: [{ turn: 1, text }], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text, tailLines: [text] }, { turn: 1, seq: 1, kind: 'create', path: 'a.cfg', argsExcerpt: text,
      after: { text, truncated: false, lines: 1 } }] });
    const once = redact(input).ledger;
    const twice = redact({ ...once, dropped: [] }).ledger;
    assert.deepEqual({ ...twice, dropped: [] }, { ...once, dropped: [] }, text);
  }
});
