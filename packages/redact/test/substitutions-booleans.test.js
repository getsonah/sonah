// W3e-7 / F223, F224 — what is provably not a credential (every narrowing is a pair).
//
// F223. The user flag's password half (`-u user:password`) masked `$(id -g)` in
//       `docker run -u $(id -u):$(id -g)`: a value that is entirely a command substitution or a
//       variable reference names where the value comes from; it is not the value. Kept — and only
//       when it is the WHOLE password half: anything glued to it is masked, as before.
// F224. W3e-5 kept a secret name's boolean (`TOKENIZERS_PARALLELISM=false`) in the key-name rule and
//       the content rule, but the two layers ported from upstream — the bounded database credential
//       (`DB_PASSWORD=…`) and the generic password assignment (`password=…`) — still masked
//       `password=true`. They follow the same rule now: exactly `true`, `false` or `null`, any case.
//
// Each narrowing is a pair: the harmless form kept byte for byte in every field class, the nearest
// real-secret form masked there. Every fixture is synthetic; values are assembled at run time. No real
// recording is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const event = (over) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', ...over }] })).ledger.ledger[0];

const V = ['hunt', 'er2', 'xW3e7'].join('');

const FIELDS = {
  cmd: (text) => event({ cmd: text }).cmd,
  argsExcerpt: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'run.sh', argsExcerpt: text }] }))
    .ledger.ledger[0].argsExcerpt,
  ask: (text) => redact(led({ ask: [{ turn: 1, text }] })).ledger.ask[0].text,
  tailLines: (text) => {
    const lines = event({ cmd: 'make run', tailLines: text.split('\n') }).tailLines;
    return Array.isArray(lines) ? lines.join('\n') : lines;
  },
  body: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'run.sh',
    after: { text, truncated: false, lines: 1 } }] })).ledger.ledger[0].after.text,
  saying: (text) => redact(led({ sayings: [{ turn: 1, text }] })).ledger.sayings[0].text,
  diff: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'run.sh', diff: `+${text}` }] }))
    .ledger.ledger[0].diff.replace(/^\+/, ''),
};

/** A narrowing: each `kept` text comes back byte for byte in every field; in each `masked` text,
 *  `gone` survives in no field and the text does not come back as it was. */
function pair(finding, label, kept, masked) {
  for (const [field, through] of Object.entries(FIELDS)) {
    test(`${finding} ${label}: the harmless form is kept in ${field}`, () => {
      for (const text of kept) assert.equal(through(text), text, `${field}: ${text}`);
    });
    test(`${finding} ${label}: the nearest secret is still masked in ${field}`, () => {
      for (const [text, gone] of masked) {
        const out = through(text);
        assert.ok(typeof out !== 'string' || !out.includes(gone), `${field}: ${JSON.stringify(gone)} survives in ${text}`);
        assert.notEqual(out, text, `${field}: ${text} came back unmasked`);
      }
    });
  }
}

// ---- F223 ----------------------------------------------------------------------------------------

pair('F223', 'a user flag\'s password half that is a substitution or a reference', [
  'docker run -u $(id -u):$(id -g) node:20 npm test',
  '-u $(id -u):$(id -g)',
  'podman run --rm --user "$(id -u):$(id -g)" alpine id',
  'curl -u "$(whoami):$(cat ~/.config/api/pass)" https://api.example.test/v1',
  'curl -u admin:`pass show api/admin` https://api.example.test/v1',
  'curl -u "deploy:$DEPLOY_PASSWORD" https://api.example.test/v1',
  'curl --user deploy:${DEPLOY_PASSWORD} https://api.example.test/v1',
  'curl -u admin:"$(op read op://vault/api/password)" https://api.example.test/v1',
], [
  [`curl -u admin:${V} https://api.example.test/v1`, V],
  [`-u admin:${V}`, V],
  [`curl -u admin:$(id -g)${V} https://api.example.test/v1`, V],
  [`curl -u admin:${V}$(id -g) https://api.example.test/v1`, V],
  [`curl -u "admin:$(id -g) ${V}" https://api.example.test/v1`, V],
  [`curl -u admin:\${PASS}${V} https://api.example.test/v1`, V],
  [`docker run -u $(id -u):${V} node:20 npm test`, V],
]);

// ---- F224 ----------------------------------------------------------------------------------------

pair('F224', 'a boolean assigned to a password in the ported layers', [
  'password=true',
  'password=false',
  'password=null',
  'password=TRUE',
  'passwd=False',
  'DB_PASSWORD=true',
  'PGPASSWORD=false',
  'MYSQL_ROOT_PASSWORD=null',
  'mysql --password=false',
  'export REDIS_PASSWORD=True',
  'cd app && PGPASSWORD=false psql -h db.internal -c "select 1"',
], [
  [`password=true${V}`, `true${V}`],
  [`password=${V}true`, V],
  [`DB_PASSWORD=false${V}`, `false${V}`],
  [`DB_PASSWORD=${V}`, V],
  ['password=truex', 'truex'],
  ['DB_PASSWORD=falsey', 'falsey'],
  ['password=nullable', 'nullable'],
  ['password=yes', '=yes'],
  ['DB_PASSWORD=0', '=0'],
  [`mysql --password=true,${V}`, V],
  [`password="true ${V}"`, V],
]);

test('F224 the ported layers now keep exactly what the key-name rule keeps for a boolean', () => {
  // Before: `password=true` was masked by the generic layer while `password: true` (the key-name
  // rule) was kept. One rule for a boolean, whichever layer sees it.
  for (const [field, through] of Object.entries(FIELDS)) {
    for (const value of ['true', 'false', 'null', 'True', 'NULL']) {
      assert.equal(through(`password=${value}`), `password=${value}`, `${field}: =${value}`);
      assert.equal(through(`password: ${value}`), `password: ${value}`, `${field}: : ${value}`);
      assert.equal(through(`APP_DB_PASSWORD=${value}`), `APP_DB_PASSWORD=${value}`, `${field}: db ${value}`);
    }
  }
});

test('F224 a quoted boolean is judged inside its quotes, as each layer judges a placeholder', () => {
  // The fields where only the ported layers and the key-name rule read the line. (A body's line-start
  // content rule reads a quoted value with its quotes, and masks it, as it always has.)
  for (const field of ['cmd', 'argsExcerpt', 'ask', 'tailLines']) {
    for (const text of ['password="true"', "DB_PASSWORD='false'", 'mysql --password="null" -e "select 1"'])
      assert.equal(FIELDS[field](text), text, `${field}: ${text}`);
    assert.ok(!FIELDS[field](`password="true ${V}"`).includes(V), `${field}: a quoted value that is not only a boolean`);
  }
});

test('F223 F224 nothing is declared for a kept boolean or substitution', () => {
  const { dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash',
    cmd: 'docker run -u $(id -u):$(id -g) -e DB_PASSWORD=false -e password=null node:20 npm test' }] }));
  assert.deepEqual(dropped, []);
});
