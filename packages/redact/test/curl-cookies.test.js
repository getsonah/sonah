// W3e-7 / F221 — the value of curl's cookie flag is masked; a cookie file's name is kept (security).
//
// W3e-5 masked a `Cookie:` header's whole value (shape C), but curl takes the same session as a flag:
// `curl -b 'session=…'`, `curl --cookie "sid=…; theme=dark"`. That came through every field raw.
// The same flag also names a cookie FILE to read (`-b cookies.txt`), and a jar is a filename, not a
// secret. The two are told apart by the value's shape: a value with `=` in it is a cookie string and
// is masked, whole; any other value is a file's name and is kept. `-c`/`--cookie-jar` (where curl
// writes cookies) always names a file. Only after `curl`: another command's `-b` is its own.
//
// Every fixture is synthetic; values are assembled at run time. No real recording is read and no
// session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const event = (over) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', ...over }] })).ledger.ledger[0];

const V = ['hunt', 'er2', 'xW3e7'].join('');
const V2 = ['s3cond', '-line', '-W3e7'].join('');
const MASK = '‹redacted:secret-value›';

const FIELDS = {
  cmd: (text) => event({ cmd: text }).cmd,
  argsExcerpt: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'fetch.sh', argsExcerpt: text }] }))
    .ledger.ledger[0].argsExcerpt,
  ask: (text) => redact(led({ ask: [{ turn: 1, text }] })).ledger.ask[0].text,
  tailLines: (text) => {
    const lines = event({ cmd: 'make fetch', tailLines: text.split('\n') }).tailLines;
    return Array.isArray(lines) ? lines.join('\n') : lines;
  },
  body: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'fetch.sh',
    after: { text, truncated: false, lines: 1 } }] })).ledger.ledger[0].after.text,
  saying: (text) => redact(led({ sayings: [{ turn: 1, text }] })).ledger.sayings[0].text,
  diff: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'fetch.sh', diff: `+${text}` }] }))
    .ledger.ledger[0].diff.replace(/^\+/, ''),
  'removed diff line': (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'fetch.sh',
    diff: `-${text}` }] })).ledger.ledger[0].diff.replace(/^-/, ''),
};

const URL = 'https://app.example.test/account';

const MASKED = {
  '-b and a quoted cookie': [`curl -b 'session=${V}' ${URL}`, `curl -b '${MASK}' ${URL}`],
  '-b and a cookie of several pairs': [`curl -sS -b "sid=${V}; theme=dark; csrf=${V2}" ${URL}`, `curl -sS -b "${MASK}" ${URL}`],
  '-b and one shell word': [`curl -b sid=${V} ${URL}`, `curl -b ${MASK} ${URL}`],
  '--cookie and a quoted cookie': [`curl --cookie "session=${V}" ${URL}`, `curl --cookie "${MASK}" ${URL}`],
  '--cookie=value': [`curl --cookie=sid=${V} ${URL}`, `curl --cookie=${MASK} ${URL}`],
  '--cookie="value"': [`curl --cookie="sid=${V}" ${URL}`, `curl --cookie="${MASK}" ${URL}`],
  '-b glued to its value': [`curl -bsid=${V} ${URL}`, `curl -b${MASK} ${URL}`],
  '-b glued to a quoted value': [`curl -b'sid=${V}' ${URL}`, `curl -b'${MASK}' ${URL}`],
  '-b ending a run of short flags': [`curl -sSLb 'sid=${V}' ${URL}`, `curl -sSLb '${MASK}' ${URL}`],
  '-b after other options': [`curl -X POST -H "Accept: application/json" -b "sid=${V}" -d '{}' ${URL}`,
    `curl -X POST -H "Accept: application/json" -b "${MASK}" -d '{}' ${URL}`],
  'a jar and a cookie string on one command': [`curl -c jar.txt -b "sid=${V}" ${URL}`, `curl -c jar.txt -b "${MASK}" ${URL}`],
  'curl by its path, after another command': [`cd /srv && /usr/bin/curl -b sid=${V} ${URL}`, `cd /srv && /usr/bin/curl -b ${MASK} ${URL}`],
  'curl in a pipeline': [`curl -s -b "sid=${V}" ${URL} | jq .`, `curl -s -b "${MASK}" ${URL} | jq .`],
  'curl in prose': [`I ran curl -b sid=${V} ${URL} and it returned 200`, `I ran curl -b ${MASK} ${URL} and it returned 200`],
  'curl in a quoted string': [`echo "curl -b sid=${V} ${URL}"`, `echo "curl -b ${MASK} ${URL}"`],
};

for (const [field, through] of Object.entries(FIELDS)) {
  test(`F221 a cookie string after curl's cookie flag is masked in ${field}`, () => {
    for (const [shape, [text, masked]] of Object.entries(MASKED)) {
      const out = through(text);
      assert.ok(typeof out === 'string', `${field}: ${shape}: the field is kept`);
      for (const secret of [V, V2]) assert.ok(!out.includes(secret), `${field}: ${shape}: the value survives`);
      assert.equal(out, masked, `${field}: ${shape}`);
    }
  });
}

const KEPT = [
  `curl -b cookies.txt ${URL}`,
  `curl -b ./tmp/session.jar ${URL}`,
  `curl -b ~/.cookies ${URL}`,
  `curl --cookie jar.txt ${URL}`,
  `curl --cookie=jar.txt ${URL}`,
  `curl -c cookies.txt -b cookies.txt ${URL}`,
  `curl --cookie-jar cookies.txt ${URL}`,
  `curl -sSLb cookies.txt ${URL}`,
  `curl -bcookies.txt ${URL}`,
  `curl -b "$COOKIE_FILE" ${URL}`,
  `curl -b - ${URL} < cookies.txt`,
  `curl -b`,
  `mytool -b key=value --verbose`,
  `git checkout -b feature/cookie-banner && curl -s ${URL}`,
  `curl -s ${URL} && mytool -b key=value`,
  `curl -db=1 ${URL}`,
];

for (const [field, through] of Object.entries(FIELDS)) {
  test(`F221 a cookie file's name, and another command's -b, are kept byte for byte in ${field}`, () => {
    for (const text of KEPT) assert.equal(through(text), text, `${field}: ${text}`);
  });
}

test('F221 a masked cookie is declared once, as a secret-named value', () => {
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 4, seq: 0, kind: 'bash', cmd: `curl -b "sid=${V}; csrf=${V2}" ${URL}` }] }));
  assert.equal(ledger.ledger[0].cmd, `curl -b "${MASK}" ${URL}`);
  assert.deepEqual(dropped, [{ turn: 4, reason: 'redacted:secret-key-value', where: 'cmd' }]);
});

test('F221 a cookie flag and its value on two continued lines are masked through the joined line', () => {
  const cmd = [`curl -sS \\`, `  -b 'sid=${V}' \\`, `  ${URL}`].join('\n');
  const out = FIELDS.cmd(cmd);
  assert.ok(typeof out === 'string' && !out.includes(V), 'the value survives');
  const split = [`curl -sS -b \\`, `  'sid=${V}' ${URL}`].join('\n');
  for (const [field, through] of Object.entries(FIELDS)) {
    const o = through(split);
    assert.ok(typeof o !== 'string' || !o.includes(V), `${field}: the value survives a continuation`);
  }
});

test('F221 redaction stays idempotent over every cookie shape', () => {
  for (const [text] of Object.values(MASKED)) {
    const input = led({ ask: [{ turn: 1, text }], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text, tailLines: [text] }, { turn: 1, seq: 1, kind: 'create', path: 'a.sh', argsExcerpt: text,
      after: { text, truncated: false, lines: 1 } }] });
    const once = redact(input).ledger;
    const twice = redact({ ...once, dropped: [] }).ledger;
    assert.deepEqual({ ...twice, dropped: [] }, { ...once, dropped: [] }, text);
  }
});
