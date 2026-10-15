// W3e-7 / F219 — a secret on a diff line is masked as it is on the same line without the marker
// (security).
//
// The key-name shapes are anchored where a line or a shell word starts. A unified diff puts one
// character before every line — `+`, `-` or a blank — and several anchors did not allow it:
// `+--token …` and `-u admin:…` on an added or removed line came through every field raw, a YAML block
// under `+password: |` was not seen outside the diff field, and `+password=…` escaped the generic
// password layer that masks the same line without its `+`. A diff reaches every field — the diff
// itself, `git diff` in a command's output, a patch a body writes, an ask or a saying that pastes one —
// so each shape is tested in each of them.
//
// Every fixture is synthetic. The secrets are short, low-entropy values assembled at run time —
// nothing but the name or the shape they sit in gives them away — so this file carries no literal a
// secret scan would flag. No real recording is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const event = (over) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', ...over }] })).ledger.ledger[0];

const V = ['hunt', 'er2', 'xW3e7'].join('');
const V2 = ['s3cond', '-line', '-W3e7'].join('');
const MASK = '‹redacted:secret-value›';

/** Every field class, each fed a text that is (part of) a diff, as written. */
const FIELDS = {
  diff: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'deploy.sh', diff: text }] }))
    .ledger.ledger[0].diff,
  cmd: (text) => event({ cmd: text }).cmd,
  argsExcerpt: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'fix.patch', argsExcerpt: text }] }))
    .ledger.ledger[0].argsExcerpt,
  ask: (text) => redact(led({ ask: [{ turn: 1, text }] })).ledger.ask[0].text,
  tailLines: (text) => {
    const lines = event({ cmd: 'git diff', tailLines: text.split('\n') }).tailLines;
    return Array.isArray(lines) ? lines.join('\n') : lines;
  },
  body: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'fix.patch',
    after: { text, truncated: false, lines: text.split('\n').length } }] })).ledger.ledger[0].after.text,
  saying: (text) => redact(led({ sayings: [{ turn: 1, text }] })).ledger.sayings[0].text,
};

/** Each shape W3e-4 and W3e-5 mask in a command, and its masked form. */
const SHAPES = {
  // W3e-4 / F201
  'export NAME=value': [`export API_TOKEN=${V}`, `export API_TOKEN=${MASK}`],
  'export NAME=value inside a command': [`cd app && export API_TOKEN=${V} && npm run deploy`,
    `cd app && export API_TOKEN=${MASK} && npm run deploy`],
  'NAME=value command, inside a command': [`cd app && GITHUB_TOKEN=${V} gh release create v1`,
    `cd app && GITHUB_TOKEN=${MASK} gh release create v1`],
  'env NAME=value command': [`env NPM_AUTH_TOKEN=${V} npm publish`, `env NPM_AUTH_TOKEN=${MASK} npm publish`],
  'quoted NAME="value"': [`echo "SERVICE_SECRET=${V}" >> .env.local`, `echo "SERVICE_SECRET=${MASK}" >> .env.local`],
  '--password value': [`mysql -u app --password ${V} -h db.internal`, `mysql -u app --password ${MASK} -h db.internal`],
  '--token value': [`vercel deploy --token ${V} --prod`, `vercel deploy --token ${MASK} --prod`],
  '--token=value': [`vercel deploy --token=${V} --prod`, `vercel deploy --token=${MASK} --prod`],
  '--api-key value': [`mycli upload --api-key ${V} ./dist`, `mycli upload --api-key ${MASK} ./dist`],
  '--api-key="value"': [`mycli upload --api-key="${V}" ./dist`, `mycli upload --api-key="${MASK}" ./dist`],
  '-H "Authorization: Bearer …"': [`curl -sS -H "Authorization: Bearer ${V}" https://api.example.test/v1`,
    `curl -sS -H "Authorization: Bearer ${MASK}" https://api.example.test/v1`],
  "-H 'X-Api-Key: …'": [`curl -H 'X-Api-Key: ${V}' https://api.example.test/v1`,
    `curl -H 'X-Api-Key: ${MASK}' https://api.example.test/v1`],
  '-u user:password': [`curl -u admin:${V} https://api.example.test/v1`, `curl -u admin:${MASK} https://api.example.test/v1`],
  '--user user:password': [`curl --user "admin:${V}" https://api.example.test/v1`,
    `curl --user "admin:${MASK}" https://api.example.test/v1`],
  'NAME: value': [`password: ${V}`, `password: ${MASK}`],
  'indented NAME: value': [`  client_secret: ${V}`, `  client_secret: ${MASK}`],
  '> Authorization: … (a verbose trace)': [`> Authorization: Bearer ${V}`, `> Authorization: Bearer ${MASK}`],
  // W3e-5 / F209: quoted keys
  'a JSON key': [`{"password":"${V}"}`, `{"password":"${MASK}"}`],
  'a curl -d payload': [`curl -sS -d '{"client_secret": "${V}", "grant": "client"}' https://api.example.test/v1/token`,
    `curl -sS -d '{"client_secret": "${MASK}", "grant": "client"}' https://api.example.test/v1/token`],
  'a Python dict': [`creds = {'token': '${V}', 'user': 'deploy'}`, `creds = {'token': '${MASK}', 'user': 'deploy'}`],
  'a TOML key': [`"api_token" = "${V}"`, `"api_token" = "${MASK}"`],
  'an array of secrets': [`{"api_keys": ["${V}", "${V2}"], "n": 2}`, `{"api_keys": [${MASK}], "n": 2}`],
  'JSON inside a JSON string': [`curl -d "{\\"password\\":\\"${V}\\"}" https://api.example.test/v1`,
    `curl -d "{\\"password\\":\\"${MASK}\\"}" https://api.example.test/v1`],
  'a subscript assignment': [`os.environ["API_TOKEN"] = "${V}"`, `os.environ["API_TOKEN"] = "${MASK}"`],
  // W3e-5 / F210: query parameters, glued password flags, cookies
  'a query parameter': [`curl -sS "https://api.example.test/v1/items?access_token=${V}&page=2"`,
    `curl -sS "https://api.example.test/v1/items?access_token=${MASK}&page=2"`],
  'a signature parameter': [`wget "https://store.example.test/c/b.txt?sv=2024-01-01&sig=${V}"`,
    `wget "https://store.example.test/c/b.txt?sv=2024-01-01&sig=${MASK}"`],
  'mysql -p<value>': [`mysql -uroot -p${V} shop`, `mysql -uroot -p${MASK} shop`],
  'sshpass -p <value>': [`sshpass -p ${V} ssh -p 2222 build-host uptime`, `sshpass -p ${MASK} ssh -p 2222 build-host uptime`],
  'a Cookie header': [`curl -H "Cookie: session=${V}; theme=dark" https://app.example.test/`,
    `curl -H "Cookie: ${MASK}" https://app.example.test/`],
  'a Set-Cookie line': [`< Set-Cookie: sid=${V}; Path=/; HttpOnly`, `< Set-Cookie: ${MASK}`],
  // The shapes whose anchor did not allow the marker: a flag, or a user flag, that starts the line
  // (a continued command's next line, an options file, a script that wraps its arguments).
  'a flag that starts the line': [`--token ${V}`, `--token ${MASK}`],
  'a flag and more words that start the line': [`--password ${V} -h db.internal`, `--password ${MASK} -h db.internal`],
  'an api-key flag that starts the line': [`--api-key ${V} ./dist`, `--api-key ${MASK} ./dist`],
  'a user flag that starts the line': [`-u admin:${V} https://api.example.test/v1`, `-u admin:${MASK} https://api.example.test/v1`],
  'a long user flag that starts the line': [`--user admin:${V} https://api.example.test/v1`,
    `--user admin:${MASK} https://api.example.test/v1`],
  'a proxy-user flag that starts the line': [`--proxy-user admin:${V} http://proxy.internal:3128`,
    `--proxy-user admin:${MASK} http://proxy.internal:3128`],
  'a capital user flag that starts the line': [`-U admin:${V}`, `-U admin:${MASK}`],
};

for (const marker of ['+', '-']) {
  const side = marker === '+' ? 'an added' : 'a removed';
  for (const [field, through] of Object.entries(FIELDS)) {
    test(`F219 every command shape on ${side} diff line is masked in ${field}`, () => {
      for (const [shape, [text, masked]] of Object.entries(SHAPES)) {
        const out = through(marker + text);
        assert.ok(typeof out === 'string', `${field}: ${shape}: the field is kept`);
        for (const secret of [V, V2]) assert.ok(!out.includes(secret), `${field}: ${shape}: the value survives`);
        assert.equal(out, marker + masked, `${field}: ${shape}: masked in place, the marker and the rest kept`);
      }
    });
  }
}

test('F219 a flag on a context line was, and stays, masked in every field', () => {
  for (const [field, through] of Object.entries(FIELDS)) {
    assert.equal(through(` --token ${V}`), ` --token ${MASK}`, field);
    assert.equal(through(` -u admin:${V} https://api.example.test/v1`), ` -u admin:${MASK} https://api.example.test/v1`, field);
  }
});

test('F219 a flag on a diff line among other lines is masked, and the lines around it kept', () => {
  const diff = ['@@ -1,3 +1,3 @@', ' deploy() {', `-  --token ${V} \\`, `+--token ${V2} \\`, '   --prod', ' }'].join('\n');
  const masked = ['@@ -1,3 +1,3 @@', ' deploy() {', `-  --token ${MASK} \\`, `+--token ${MASK} \\`, '   --prod', ' }'].join('\n');
  for (const [field, through] of Object.entries(FIELDS)) {
    const out = through(diff);
    for (const secret of [V, V2]) assert.ok(typeof out === 'string' && !out.includes(secret), `${field}: the value survives`);
  }
  assert.equal(FIELDS.diff(diff), masked);
  assert.equal(FIELDS.tailLines(diff), masked);
});

// ---- a YAML block under a key on a diff line, outside the diff field ---------------------------------

const lines = (...l) => l.join('\n');

const BLOCKS = {
  'a block on added lines': [lines(' db:', '+  password: |', `+    ${V}`, `+    ${V2}`, '   host: db.internal'),
    lines(' db:', '+  password: |', `+    ${MASK}`, `+    ${MASK}`, '   host: db.internal')],
  'a block on removed lines': [lines('-token: >-', `-  ${V}`, ' region: eu-west-1'), lines('-token: >-', `-  ${MASK}`, ' region: eu-west-1')],
  'a block under a context key, its value added': [lines(' password: |', `+  ${V}`, ' user: deploy'),
    lines(' password: |', `+  ${MASK}`, ' user: deploy')],
  'a block under a quoted key': [lines('+"client_secret": |', `+  ${V}`, '+done: true'), lines('+"client_secret": |', `+  ${MASK}`, '+done: true')],
  'a block that holds a blank line': [lines('+secret: |+', `+  ${V}`, '+', `+  ${V2}`, '+next: 1'),
    lines('+secret: |+', `+  ${MASK}`, '+', `+  ${MASK}`, '+next: 1')],
  'a block the hunk ends': [lines('+password: |', `+  ${V}`, '@@ -9,2 +9,2 @@', ' other: 1'),
    lines('+password: |', `+  ${MASK}`, '@@ -9,2 +9,2 @@', ' other: 1')],
};

for (const [field, through] of Object.entries(FIELDS)) {
  test(`F219 a YAML block under a key on a diff line is masked in ${field}`, () => {
    for (const [shape, [text, masked]] of Object.entries(BLOCKS)) {
      const out = through(text);
      for (const secret of [V, V2]) assert.ok(typeof out === 'string' && !out.includes(secret), `${field}: ${shape}: the value survives`);
      assert.equal(out, masked, `${field}: ${shape}`);
    }
  });
}

test('F219 a block under a key on a diff line that holds no secret is kept byte for byte', () => {
  const kept = [
    lines('+description: |', '+  the service that serves', '+  the storefront', '+replicas: 2'),
    lines('+password: |', '+user: deploy'),
    lines('+password: |', '+  ${DB_PASSWORD}', '+user: deploy'),
    lines('-password: |', `-  ${MASK}`, ' user: deploy'),
  ];
  for (const [field, through] of Object.entries(FIELDS)) for (const text of kept) assert.equal(through(text), text, `${field}: ${text}`);
});

test('F219 a YAML block on diff lines is declared once in a field that is not the diff', () => {
  const text = lines('+password: |', `+  ${V}`, `+  ${V2}`, '+user: deploy');
  const { dropped } = redact(led({ ledger: [{ turn: 5, seq: 0, kind: 'create', path: 'fix.patch',
    after: { text, truncated: false, lines: 4 } }] }));
  assert.deepEqual(dropped, [{ turn: 5, reason: 'redacted:secret-key-value', where: 'after' }]);
});

// ---- a marker never changes what a line keeps ---------------------------------------------------------

test('F219 a line behind a diff marker is masked exactly as the line without it', () => {
  // The generic password layer and the content rule are line-start anchored too: `+password=…` passed
  // the generic layer, and `+2FA_SECRET=…` in a body passed every layer, where the same line without
  // its `+` is masked.
  const texts = [
    'password=none', `password=<${V}>`, `password=$${V}`, `passwd=${V}`, `2FA_SECRET=${V}`, `.token: ${V}`,
    `export 1PASSWORD_TOKEN=${V}`, 'password: none', 'API_TOKEN=${API_TOKEN}', 'npm test -- --grep "token refresh"',
  ];
  const fields = { ...FIELDS };
  delete fields.diff;           // the diff field reads a line's marker itself: every line there has one
  for (const [field, through] of Object.entries(fields)) {
    for (const text of texts) {
      const bare = through(text);
      assert.equal(through(`+${text}`), typeof bare === 'string' ? `+${bare}` : bare, `${field}: +${text}`);
    }
  }
  for (const text of texts) {
    const bare = FIELDS.body(text);
    assert.equal(FIELDS.diff(`+${text}`), `+${bare}`, `diff: +${text}`);
  }
});

test('F219 a JSON-escaped line start followed by a diff marker is a line start', () => {
  // `\n` written as two characters (a tool result held as a JSON string): the assignment shape already
  // took it as a line start; the diff marker after it is allowed too.
  for (const [field, through] of Object.entries(FIELDS)) {
    if (field === 'diff') continue;
    const out = through(`"@@ -1 +1 @@\\n-API_TOKEN=${V}\\n+API_TOKEN=${V2}\\n"`);
    for (const secret of [V, V2]) assert.ok(typeof out !== 'string' || !out.includes(secret), `${field}: the value survives`);
  }
});

test('F219 redaction stays idempotent over every shape on a diff line', () => {
  for (const [text] of [...Object.values(SHAPES), ...Object.values(BLOCKS)]) {
    for (const marker of ['+', '-']) {
      const t = text.includes('\n') ? text : marker + text;
      const input = led({ ask: [{ turn: 1, text: t }], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: t, tailLines: t.split('\n') }, { turn: 1, seq: 1, kind: 'create', path: 'a.patch', argsExcerpt: t, diff: t,
        after: { text: t, truncated: false, lines: 1 } }] });
      const once = redact(input).ledger;
      const twice = redact({ ...once, dropped: [] }).ledger;
      assert.deepEqual({ ...twice, dropped: [] }, { ...once, dropped: [] }, t);
    }
  }
});
