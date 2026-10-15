// W3e-5 / F211 — the words that are not secrets (security: every narrowing is a pair).
//
// The key-name vocabulary matched substrings, so `--author`, `--max-tokens 4096`,
// `TOKENIZERS_PARALLELISM=false`, `--cert file.pem`, the second number of `docker run -u 1000:1000` and
// the word after "use --token" in prose were all masked. Fail-closed is right, but noise here costs
// quoting precision on every session. A narrowing is made only where the secret word is part of a
// longer ordinary word, or the value is provably not a credential:
//
//   - a secret word inside an ordinary word from a closed list — author…, authority…, tokeniz…,
//     certificat… — does not make the name secret (a word is found by the name's segments: `_`, `-`,
//     `.`, case and digit boundaries). Every other match still does, concatenations included
//     (`APITOKEN`, `newpassword`): that is not an ordinary word, and substring matching stays the rule.
//   - a value that is exactly true, false or null is kept: a boolean is not a credential;
//   - `tokens` (the plural) holding a whole number is a count;
//   - `cert` holding a certificate file's name is a filename, and a filename is not a credential;
//   - a flag followed by one ordinary word from a closed list ("use --token instead") has no value;
//   - `-u uid:gid`, two numbers, in a container command is a user and group id.
//
// Each narrowing is tested as a pair: the harmless form kept byte for byte in every field class, and
// the nearest real-secret form masked there. Every fixture is synthetic; values are assembled at run
// time. No real recording is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const event = (over) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', ...over }] })).ledger.ledger[0];

const V = ['hunt', 'er2', 'xW3e5'].join('');

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

/**
 * A narrowing: each `kept` text comes back byte for byte in every field; in each `masked` text,
 * `gone` (the value) survives in no field.
 */
function pair(label, kept, masked) {
  for (const [field, through] of Object.entries(FIELDS)) {
    test(`F211 ${label}: the harmless form is kept in ${field}`, () => {
      for (const text of kept) assert.equal(through(text), text, `${field}: ${text}`);
    });
    test(`F211 ${label}: the nearest secret is still masked in ${field}`, () => {
      for (const [text, gone] of masked) {
        const out = through(text);
        assert.ok(typeof out !== 'string' || !out.includes(gone), `${field}: ${JSON.stringify(gone)} survives in ${text}`);
        assert.notEqual(out, text, `${field}: ${text} came back unmasked`);
      }
    });
  }
}

// ---- a secret word inside an ordinary word ------------------------------------------------------

pair('author is not auth', [
  `git log --author ${V} --oneline`,
  `AUTHOR=${V} make release`,
  `{"author": "${V}"}`,
  `author: ${V}`,
  `  authors: ${V}`,
], [
  [`git log --auth ${V} --oneline`, V],
  [`AUTH=${V} make release`, V],
  [`{"auth": "${V}"}`, V],
  [`auth: ${V}`, V],
  [`AUTHOR_TOKEN=${V} make release`, V],
]);

pair('authority is not auth', [
  `az login --authority ${V}`,
  `AUTHORITY_HOST=${V} ./login.sh`,
  `{"authoritative": "${V}"}`,
], [
  [`az login --authorization ${V}`, V],
  [`AUTHORIZATION=${V} ./login.sh`, V],
  [`{"authorization": "${V}"}`, V],
]);

pair('a tokenizer is not a token', [
  `python train.py --tokenizer ${V}`,
  'TOKENIZERS_PARALLELISM=off python train.py',
  'TOKENIZER_NAME=bert-base-uncased-vocab python train.py',
  `{"tokenizer_class": "${V}"}`,
], [
  [`python train.py --token ${V}`, V],
  ['TOKEN_PARALLELISM=off python train.py', '=off'],
  ['TOKEN_NAME=bert-base-uncased-vocab python train.py', 'bert-base-uncased-vocab'],
  [`{"token_class": "${V}"}`, V],
]);

pair('a certificate is not a cert', [
  `openssl x509 -in site.crt --certificate ${V}`,
  `SSL_CERTIFICATE_PATH=${V} nginx -t`,
  `{"certificate": "${V}"}`,
], [
  [`openssl x509 -in site.crt --cert-password ${V}`, V],
  [`SSL_CERT_PASSWORD=${V} nginx -t`, V],
  [`{"cert": "${V}"}`, V],
]);

// ---- values that are provably not credentials ---------------------------------------------------

pair('a boolean is not a credential', [
  'TOKENIZERS_PARALLELISM=false python train.py',
  'API_TOKEN=false',
  'ENABLE_AUTH=true',
  '{"token": true, "secret": false, "password": null}',
  "{'api_key': True}",
  '--auth=false',
  'curl "https://app.example.test/cb?token=false&page=2"',
  'password: FALSE',
], [
  [`API_TOKEN=false${V} ./deploy.sh`, V],
  [`{"token": "true ${V}"}`, V],
  [`password: true love ${V}`, V],
  [`--auth=truex${V}`, V],
]);

pair('tokens holding a whole number is a count', [
  'python eval.py --max-tokens 4096',
  'MAX_TOKENS=4096',
  '{"max_tokens": 4096, "temperature": 0}',
  'max_tokens: 4096',
  'maxTokens: 4096',
  'tokens: 12',
], [
  ['python eval.py --max-token 4096', '4096'],
  ['python eval.py --api-token 4096', '4096'],
  [`MAX_TOKENS=${V} python eval.py`, V],
  [`{"max_tokens": "${V}"}`, V],
  [`api_tokens: ${V}`, V],
]);

pair('cert holding a certificate file\'s name is a filename', [
  'curl --cert client.pem https://api.example.test/v1',
  'curl --cert ./certs/client.crt --key client.key https://api.example.test/v1',
  'SSL_CERT_FILE=/etc/ssl/certs/site.crt',
  '{"cert": "tls/server.pem"}',
], [
  [`curl --cert ${V} https://api.example.test/v1`, V],
  [`curl --cert ${V}.pem.bak https://api.example.test/v1`, V],
  [`SSL_CERT_FILE=${V} node app.js`, V],
  [`{"cert": "${V}"}`, V],
]);

pair('a flag named in prose, followed by an ordinary word, has no value', [
  'use --token instead',
  'pass the --api-key flag to the CLI',
  'set --password to the value from the vault',
  'git commit -m "use --token instead"',
  'prefer --auth, then --token.',
], [
  [`use --token ${V} instead`, V],
  [`use --token instead${V}`, V],
  [`pass the --api-key ${V} flag`, V],
  [`git commit -m "use --token the${V}"`, V],
]);

pair('uid:gid in a container command is a user and group id', [
  'docker run -u 1000:1000 node:20 npm test',
  'podman run --rm --user 0:0 alpine id',
  'cd app && docker compose run -u 501:20 web rake db:migrate',
], [
  ['curl -u 1000:1000 https://api.example.test/v1', '1000:1000'],
  [`docker run -u 1000:${V} node:20 npm test`, V],
  ['docker pull node:20 && curl -u 1000:1000 https://api.example.test/v1', '1000:1000'],
]);

test('F211 in a command an assignment is one shell word: a boolean, a count or a certificate file before the command is kept', () => {
  // In a field that is not a command, a line-start assignment takes the rest of its line (W3e-4), so
  // `API_TOKEN=false ./deploy.sh` there is a value of several words, and masked.
  for (const text of ['API_TOKEN=false ./deploy.sh', 'ENABLE_AUTH=true ./deploy.sh', 'MAX_TOKENS=4096 python eval.py',
    'SSL_CERT_FILE=/etc/ssl/certs/site.crt node app.js']) assert.equal(FIELDS.cmd(text), text);
  assert.equal(FIELDS.tailLines('API_TOKEN=false ./deploy.sh'), 'API_TOKEN=‹redacted:secret-value›');
});

test('F211 the ordinary-word list is closed: every word in it is kept after a flag, glued to anything it is masked', () => {
  const words = ['an', 'and', 'as', 'at', 'but', 'by', 'flag', 'for', 'from', 'if', 'in', 'instead', 'into', 'is',
    'it', 'not', 'of', 'on', 'option', 'or', 'so', 'than', 'that', 'the', 'then', 'this', 'to', 'was', 'when', 'which',
    'with', 'without'];
  for (const word of words) {
    assert.equal(FIELDS.ask(`try --password ${word} next time`), `try --password ${word} next time`, word);
    assert.ok(!FIELDS.ask(`try --password ${word}${V} next time`).includes(V), `${word}: glued`);
  }
  // `a` is not on the list: secret-named.test.js pins `--token a` as masked.
  for (const word of ['a', 'secret', 'hunter', 'value', 'my', 'please'])
    assert.ok(!FIELDS.cmd(`try --password ${word} next`).includes(` ${word} `), `${word} is not on the list`);
});

// ---- what the spec says must still be secret, and what substring matching still catches ---------

test('F211 auth, auth_token, x-auth, authorization, token, access_token and cert_password are still secret names', () => {
  const texts = [
    `deploy --auth ${V}`, `AUTH_TOKEN=${V} ./deploy.sh`, `curl -H "X-Auth: ${V}" https://api.example.test/v1`,
    `curl -H "Authorization: ${V}" https://api.example.test/v1`, `{"authorization": "${V}"}`, `vercel --token ${V}`,
    `ACCESS_TOKEN=${V} ./sync.sh`, `cert_password: ${V}`, `{"cert_password": "${V}"}`,
  ];
  for (const [field, through] of Object.entries(FIELDS))
    for (const text of texts) assert.ok(!(through(text) ?? '').includes(V), `${field}: ${text}`);
});

test('F211 a secret word glued into a longer name that is not an ordinary word is still a secret name (fail closed)', () => {
  const texts = [
    `NGROK_AUTHTOKEN=${V} ngrok http 80`, `APITOKEN=${V} ./sync.sh`, `newpassword: ${V}`, `SSHPASS=${V} sshpass -e ssh h`,
    `authToken: ${V}`, `{"XAuthToken": "${V}"}`, `{"apiKey": "${V}"}`, `mycli --authtoken ${V}`, `oauth_secret: ${V}`,
    `CLIENT_SECRETS=${V} ./run.sh`, `db_credentials: ${V}`, `mycli --tokens ${V}`, `AUTHORTOKEN=${V} ./x.sh`, `certfile: ${V}`,
  ];
  for (const [field, through] of Object.entries(FIELDS))
    for (const text of texts) assert.ok(!(through(text) ?? '').includes(V), `${field}: ${text}`);
});
