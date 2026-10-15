// W3e-5 / F209, F210 — the secret shapes the key-name rule still missed (security).
//
// W3e-4 made the secret-named-key rule a layer inside `scrub`, in every field. Its probes found
// shapes it still did not see, in every field including file content:
//
// F209. A QUOTED key: `{"password":"…"}`, `"api_key": "…"`, `'token': '…'` — JSON configs, `curl -d`
//       payloads, Python dicts, TOML inline tables. The `ASSIGNED` pattern's comment claimed to catch
//       `"token": "…"`, but it cannot match a quoted key.
// F210. A URL query parameter (`?access_token=…&…`), a password flag glued to its value
//       (`mysql -p…`, `sshpass -p …`), a `Cookie:` / `Set-Cookie:` header, and a YAML block scalar
//       (`password: |` with the secret on the lines below it — the content rule missed it too).
//
// Every fixture is synthetic. The secrets are short, low-entropy values assembled at run time —
// nothing but the name or the shape they sit in gives them away — so this file carries no literal a
// secret scan would flag. No real recording is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const event = (over) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', ...over }] })).ledger.ledger[0];

/** Values no pattern, entropy floor or length rule catches: only their shape says they are secret. */
const V = ['hunt', 'er2', 'xW3e5'].join('');
const V2 = ['s3cond', '-line', '-W3e5'].join('');
const MASK = '‹redacted:secret-value›';

/** Every field class — command, ask, body, tail — each fed one text. */
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
    after: { text, truncated: false, lines: text.split('\n').length } }] })).ledger.ledger[0].after.text,
  saying: (text) => redact(led({ sayings: [{ turn: 1, text }] })).ledger.sayings[0].text,
  diff: (text) => {
    const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'conf/app.cfg',
      diff: text.split('\n').map((l) => `+${l}`).join('\n') }] })).ledger.ledger[0].diff;
    const lines = out.split('\n');
    return lines.every((l) => l.startsWith('+')) ? lines.map((l) => l.slice(1)).join('\n') : out;
  },
};

/** Run `shapes` ([text, masked]) through every field: the value never survives, the rest is kept. */
function everyField(finding, shapes, fields = FIELDS) {
  for (const [field, through] of Object.entries(fields)) {
    for (const [shape, [text, masked]] of Object.entries(shapes)) {
      test(`${finding} ${shape} is masked in ${field}`, () => {
        const out = through(text);
        assert.ok(typeof out === 'string', `${field}: the field is kept`);
        for (const secret of [V, V2]) assert.ok(!out.includes(secret), `${field}: the value survives`);
        assert.equal(out, masked, `${field}: masked in place, the rest kept`);
      });
    }
  }
}

/** Run `texts` through every field: each comes back byte for byte. */
function keptEverywhere(finding, label, texts, fields = FIELDS) {
  for (const [field, through] of Object.entries(fields)) {
    test(`${finding} ${label} is byte-identical in ${field}`, () => {
      for (const text of texts) assert.equal(through(text), text, `${field}: ${text}`);
    });
  }
}

// ---- F209: quoted keys --------------------------------------------------------------------------

everyField('F209', {
  'a JSON key': [`{"password":"${V}"}`, `{"password":"${MASK}"}`],
  'a JSON key among others': [`{"user": "deploy", "api_key": "${V}", "region": "eu-west-1"}`,
    `{"user": "deploy", "api_key": "${MASK}", "region": "eu-west-1"}`],
  'a curl -d payload': [`curl -sS -d '{"client_secret": "${V}", "grant": "client"}' https://api.example.test/v1/token`,
    `curl -sS -d '{"client_secret": "${MASK}", "grant": "client"}' https://api.example.test/v1/token`],
  'a Python dict': [`creds = {'token': '${V}', 'user': 'deploy'}`, `creds = {'token': '${MASK}', 'user': 'deploy'}`],
  'a TOML key': [`"api_token" = "${V}"`, `"api_token" = "${MASK}"`],
  'a PHP or Ruby hash key': [`{ "password" => "${V}" }`, `{ "password" => "${MASK}" }`],
  'an unquoted value, to the next comma': [`{"password": ${V}, "user": "deploy"}`, `{"password": ${MASK}, "user": "deploy"}`],
  'an unquoted value, to the closing brace': [`{'secret': ${V}}`, `{'secret': ${MASK}}`],
  'an array of secrets': [`{"api_keys": ["${V}", "${V2}"], "n": 2}`, `{"api_keys": [${MASK}], "n": 2}`],
  'a value holding an escaped quote': [`{"password": "${V}\\"${V2}"}`, `{"password": "${MASK}"}`],
  'JSON inside a JSON string': [`curl -d "{\\"password\\":\\"${V}\\",\\"user\\":\\"deploy\\"}" https://api.example.test/v1`,
    `curl -d "{\\"password\\":\\"${MASK}\\",\\"user\\":\\"deploy\\"}" https://api.example.test/v1`],
  'an auth header in a headers object': [`headers = {"Authorization": "Bearer ${V}"}`, `headers = {"Authorization": "Bearer ${MASK}"}`],
  'a JSON response line': [`{"access_token":"${V}","expires_in":3600}`, `{"access_token":"${MASK}","expires_in":3600}`],
  'a subscript assignment': [`os.environ["API_TOKEN"] = "${V}"`, `os.environ["API_TOKEN"] = "${MASK}"`],
});

keptEverywhere('F209', 'a quoted placeholder, and a quoted string that is not a key,', [
  '{"password": "${DB_PASSWORD}", "user": "deploy"}',
  '{"token": "<token>"}',
  '{"api_key": ""}',
  '{"password": null}',
  '{"secret": "***"}',
  `{"password": "${MASK}"}`,
  '{"auth": {"type": "basic", "user": "deploy"}}',
  'case "token": return parseToken(input);',
  'if field == "password": print(field)',
  'if data["password"] == "": raise ValueError()',
  'const label = isKey ? "token" : "name";',
  '{"user": "deploy", "region": "eu-west-1"}',
]);

test('F209 a quoted key is declared once per value, as a secret-named value', () => {
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 2, seq: 0, kind: 'bash',
    cmd: `curl -d '{"password": "${V}", "token": "${V2}"}' https://api.example.test/v1` }] }));
  assert.equal(ledger.ledger[0].cmd, `curl -d '{"password": "${MASK}", "token": "${MASK}"}' https://api.example.test/v1`);
  assert.deepEqual(dropped, [{ turn: 2, reason: 'redacted:secret-key-value', where: 'cmd' },
    { turn: 2, reason: 'redacted:secret-key-value', where: 'cmd' }]);
});

test('F209 an unclosed quoted value is masked to the end of its line (fail closed)', () => {
  assert.equal(FIELDS.cmd(`echo '{"password": "${V} ${V2}`), `echo '{"password": "${MASK}`);
  assert.equal(FIELDS.body(`{"password": "${V} ${V2}\n"user": "deploy"}`), `{"password": "${MASK}\n"user": "deploy"}`);
});

// ---- F210: URL query parameters ---------------------------------------------------------------

everyField('F210', {
  'a query parameter': [`curl -sS "https://api.example.test/v1/items?access_token=${V}&page=2"`,
    `curl -sS "https://api.example.test/v1/items?access_token=${MASK}&page=2"`],
  'a later query parameter, to the fragment': [`open https://app.example.test/cb?page=2&api_key=${V}#results`,
    `open https://app.example.test/cb?page=2&api_key=${MASK}#results`],
  'a signature parameter': [`wget "https://store.example.test/c/b.txt?sv=2024-01-01&sig=${V}"`,
    `wget "https://store.example.test/c/b.txt?sv=2024-01-01&sig=${MASK}"`],
  'a query parameter in prose': [`the callback was https://app.example.test/cb?token=${V} and it failed`,
    `the callback was https://app.example.test/cb?token=${MASK} and it failed`],
});

keptEverywhere('F210', 'an ordinary URL', [
  'curl -sS "https://api.example.test/v1/items?page=2&sort=asc#top"',
  'https://example.com/?password_reset=true',
  'curl "https://api.example.test/v1?token=${API_TOKEN}&page=2"',
  'open https://app.example.test/cb?token=&page=2',
]);

// ---- F210: a password flag glued to its value -------------------------------------------------

everyField('F210', {
  'mysql -p<value>': [`mysql -uroot -p${V} shop`, `mysql -uroot -p${MASK} shop`],
  "mysqldump -p'<value>'": [`mysqldump -h db.internal -u app -p'${V}' shop > shop.sql`,
    `mysqldump -h db.internal -u app -p'${MASK}' shop > shop.sql`],
  'mariadb -p<value> after another command': [`cd /srv && mariadb -p${V} -e "select 1"`,
    `cd /srv && mariadb -p${MASK} -e "select 1"`],
  'a mysql path': [`/usr/local/bin/mysql -u app -p${V} shop`, `/usr/local/bin/mysql -u app -p${MASK} shop`],
  'sshpass -p <value>': [`sshpass -p ${V} ssh -p 2222 build-host uptime`, `sshpass -p ${MASK} ssh -p 2222 build-host uptime`],
  'sshpass -p<value>': [`sshpass -p${V} scp -P 2222 a.txt build-host:/tmp`, `sshpass -p${MASK} scp -P 2222 a.txt build-host:/tmp`],
  'psql -p<value> that is not a port': [`psql -h db.internal -p${V} shop`, `psql -h db.internal -p${MASK} shop`],
});

keptEverywhere('F210', 'a -p that is not a password flag', [
  'mkdir -p build/out && cp -p a.txt build/out/a.txt',
  'ssh -p 22 build-host uptime',
  'mysql -p shop',
  'mysql -u app -p$MYSQL_PASSWORD shop',
  'psql -h db.internal -p5432 shop',
  'pg_dump -p 5432 shop > shop.sql',
  'sshpass -f ~/.deploy-pass ssh build-host uptime',
]);

// ---- F210: cookies ----------------------------------------------------------------------------

everyField('F210', {
  'a Cookie header': [`curl -H "Cookie: session=${V}; theme=dark" https://app.example.test/`,
    `curl -H "Cookie: ${MASK}" https://app.example.test/`],
  'a Cookie line in a verbose trace': [`> Cookie: session=${V}; theme=dark`, `> Cookie: ${MASK}`],
  'a Set-Cookie line': [`< Set-Cookie: sid=${V}; Path=/; HttpOnly`, `< Set-Cookie: ${MASK}`],
  'a Cookie line in a request file': [`Cookie: sid=${V}`, `Cookie: ${MASK}`],
  'a Cookie key in a headers object': [`{"Cookie": "sid=${V}"}`, `{"Cookie": "${MASK}"}`],
});

keptEverywhere('F210', 'a header that is not a cookie', [
  'curl -H "Accept: text/html" https://app.example.test/',
  'cookie_name: sid',
  'Cookie: $SESSION_COOKIE',
]);

// ---- F210: YAML block scalars -----------------------------------------------------------------

const BLOCK_FIELDS = {
  body: FIELDS.body, saying: FIELDS.saying, diff: FIELDS.diff, ask: FIELDS.ask, argsExcerpt: FIELDS.argsExcerpt,
  tailLines: FIELDS.tailLines,
  'cmd (a here-document)': (text) => {
    const out = FIELDS.cmd(`cat > config.yaml <<'EOF'\n${text}\nEOF`);
    return typeof out === 'string' ? out.replace(/^cat > config\.yaml <<'EOF'\n/, '').replace(/\nEOF$/, '') : out;
  },
};

const lines = (...l) => l.join('\n');

everyField('F210', {
  'a literal block': [lines('db:', '  password: |', `    ${V}`, `    ${V2}`, '  host: db.internal'),
    lines('db:', '  password: |', `    ${MASK}`, `    ${MASK}`, '  host: db.internal')],
  'a folded block with a chomping indicator': [lines('token: >-', `  ${V}`, `  ${V2}`, 'region: eu-west-1'),
    lines('token: >-', `  ${MASK}`, `  ${MASK}`, 'region: eu-west-1')],
  'a block with an indentation indicator and a comment': [lines('  api_key: |2  # rotated monthly', `    ${V}`, '  timeout: 30'),
    lines('  api_key: |2  # rotated monthly', `    ${MASK}`, '  timeout: 30')],
  'a block with a blank line and deeper lines': [lines('secret: |+', `  ${V}`, '', `    ${V2} more words`, 'next: 1'),
    lines('secret: |+', `  ${MASK}`, '', `    ${MASK}`, 'next: 1')],
  'a block under a list item': [lines('- name: db', '  password: >', `    ${V}`, '- name: cache'),
    lines('- name: db', '  password: >', `    ${MASK}`, '- name: cache')],
  'a block under a quoted key': [lines('"client_secret": |', `  ${V}`, 'done: true'),
    lines('"client_secret": |', `  ${MASK}`, 'done: true')],
  'a block at the end of the text': [lines('password: |', `  ${V}`), lines('password: |', `  ${MASK}`)],
}, BLOCK_FIELDS);

keptEverywhere('F210', 'a block that holds no secret', [
  lines('description: |', '  the service that serves', '  the storefront', 'replicas: 2'),
  lines('password: |', 'user: deploy'),
  lines('password: |', '  ${DB_PASSWORD}', 'user: deploy'),
  lines('password: |', `  ${MASK}`, 'user: deploy'),
], BLOCK_FIELDS);

test('F210 a YAML block is declared once, however many lines it holds', () => {
  const text = lines('password: |', `  ${V}`, `  ${V2}`, `  ${V}`, 'user: deploy', 'token: >', `  ${V2}`);
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 3, seq: 0, kind: 'create', path: 'a.yaml',
    after: { text, truncated: false, lines: 7 } }] }));
  assert.equal(ledger.ledger[0].after.text, lines('password: |', `  ${MASK}`, `  ${MASK}`, `  ${MASK}`, 'user: deploy', 'token: >', `  ${MASK}`));
  assert.equal(ledger.ledger[0].after.redactedLines, undefined, 'masked in place, not dropped');
  assert.deepEqual(dropped, [{ turn: 3, reason: 'redacted:secret-key-value', where: 'after' },
    { turn: 3, reason: 'redacted:secret-key-value', where: 'after' }], 'one declaration per block');
  const ask = redact(led({ ask: [{ turn: 4, text }] }));
  assert.equal(ask.dropped.filter((d) => d.reason === 'redacted:secret-key-value').length, 2, 'the ask too');
});

test('F210 a YAML block in a diff is masked on the side that holds it, marker kept', () => {
  const diff = [' db:', '   password: |', `-    ${V}`, `+    ${V2}`, '   host: db.internal'].join('\n');
  const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'a.yaml', diff }] })).ledger.ledger[0].diff;
  assert.equal(out, [' db:', '   password: |', `-    ${MASK}`, `+    ${MASK}`, '   host: db.internal'].join('\n'));
});

// ---- every shape, twice -------------------------------------------------------------------------

test('F209 F210 redaction stays idempotent over every new shape', () => {
  const texts = [
    `{"password":"${V}"}`, `curl -d "{\\"password\\":\\"${V}\\"}" x`, `https://x.example.test/?access_token=${V}&a=1`,
    `mysql -p${V} shop`, `sshpass -p ${V} ssh h`, `curl -H "Cookie: a=${V}" x`, `< Set-Cookie: a=${V}; Path=/`,
    lines('password: |', `  ${V}`, 'user: deploy'),
  ];
  for (const text of texts) {
    const input = led({ ask: [{ turn: 1, text }], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text, tailLines: text.split('\n') }, { turn: 1, seq: 1, kind: 'create', path: 'a.cfg', argsExcerpt: text,
      after: { text, truncated: false, lines: 1 } }] });
    const once = redact(input).ledger;
    const twice = redact({ ...once, dropped: [] }).ledger;
    assert.deepEqual({ ...twice, dropped: [] }, { ...once, dropped: [] }, text);
  }
});
