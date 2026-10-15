// W3e-8 / F231–F235 — the findings the matrix (matrix.test.js) generalises, each named, as pairs.
//
// F231. An escaped `\n` (two characters) starts a logical line for every anchored shape, not only for
//       `NAME=`: `step one\n--token …`, `…\n-u admin:…`, `…\npassword: …` leaked in every field.
// F232. A key's name may start with a digit or a dot: `2FA_SECRET=…`, `export 1PASSWORD_TOKEN=…`,
//       `.token: …` leaked in commands, asks and tails.
// F233. A reference with a default carries a literal: `DB_PASSWORD=${DB_PASSWORD:-…}` (docker-compose)
//       leaked in every field, since any `${…}` counted as a placeholder.
// F234. One placeholder rule in every layer: `password: <hunter2>` and `password: $hunter2` were kept
//       while `password=$hunter2` was masked. A `$word` or a `<…>` that is neither an upper-case name
//       nor, written in one case, a secret's name (`$token`, `<YOUR_API_KEY>`) is a value everywhere
//       now; `$DB_PASSWORD`, `$token` and `<password>` are placeholders everywhere.
// F235. The body's content rule judges `"true"` inside its quotes, as every other field does.
//
// Each narrowing is a pair: the harmless form kept byte for byte in every field class, the nearest
// secret masked there. Every fixture is synthetic; values are assembled at run time. No real recording
// is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const event = (over) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', ...over }] })).ledger.ledger[0];

const V = ['hunt', 'er2', 'xW3e8'].join('');
const WEAK = ['hunt', 'er2'].join('');
const MASK = '‹redacted:secret-value›';

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
    after: { text, truncated: false, lines: text.split('\n').length } }] })).ledger.ledger[0].after.text,
  saying: (text) => redact(led({ sayings: [{ turn: 1, text }] })).ledger.sayings[0].text,
  diff: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'run.sh', diff: text.split('\n').map((l) => `+${l}`).join('\n') }] }))
    .ledger.ledger[0].diff.split('\n').map((l) => l.replace(/^\+/, '')).join('\n'),
};

/** Each `kept` text comes back byte for byte in every field; in each `masked` text, `gone` survives in
 *  no field and the text does not come back as it was. `only`: the fields a pair is about, when not all. */
function pair(finding, label, kept, masked, only = Object.keys(FIELDS)) {
  for (const field of only) {
    const through = FIELDS[field];
    test(`${finding} ${label}: the harmless form is kept in ${field}`, () => {
      for (const text of kept) assert.equal(through(text), text, `${field}: ${text}`);
    });
    test(`${finding} ${label}: the secret is masked in ${field}`, () => {
      for (const [text, gone] of masked) {
        const out = through(text);
        assert.ok(typeof out !== 'string' || !out.includes(gone), `${field}: ${JSON.stringify(gone)} survives in ${text}`);
        assert.notEqual(out, text, `${field}: ${text} came back unmasked`);
      }
    });
  }
}

// ---- F231 ----------------------------------------------------------------------------------------

pair('F231', 'an escaped line break starts a line', [
  'step one\\n--token $DEPLOY_TOKEN',
  'step one\\npassword: changeme',
  'step one\\n-u admin:$ADMIN_PASSWORD https://api.example.test/v1',
  'step one\\npassword: |\\n  ${DB_PASSWORD}',
], [
  [`step one\\n--token ${V}`, V],
  [`step one\\n-u admin:${V} https://api.example.test/v1`, V],
  [`step one\\npassword: ${V}`, V],
  [`step one\\n+password: ${V}`, V],
  [`step one\\nAPI_KEY = "${V}"`, V],
  [`step one\\npassword: |\\n  ${V}`, V],
  [`echo -e "retry\\n--api-key ${V}"`, V],
]);

test('F231 a logical line an escaped break started ends at the next one: the next line is kept', () => {
  for (const field of ['argsExcerpt', 'tailLines', 'body', 'saying', 'ask']) {
    assert.equal(FIELDS[field](`"step one\\npassword: ${V}\\nuser: deploy"`), `"step one\\npassword: ${MASK}\\nuser: deploy"`, field);
  }
});

// ---- F232 ----------------------------------------------------------------------------------------

pair('F232', 'a name that starts with a digit or a dot', [
  '12:30: build started',
  '2024-01-01T00:00:00Z deploy finished',
  'export 2FA_SECRET=$TWO_FA_SECRET',
  '.token: <token>',
  '3des=off',
], [
  [`2FA_SECRET=${V}`, V],
  [`export 1PASSWORD_TOKEN=${V}`, V],
  [`.token: ${V}`, V],
  [`cd app && 2FA_SECRET=${V} ./run.sh`, V],
  [`--2fa-secret ${V}`, V],
  [`{"2fa_secret": "${V}"}`, V],
  [`/v1/items?2fa_secret=${V}&x=1`, V],
  [`curl -H "my.token: ${V}" https://api.example.test/v1`, V],
  [`ClientKeyData: ${V}`, V],
]);

// ---- F233 ----------------------------------------------------------------------------------------

pair('F233', 'a default inside a reference', [
  'DB_PASSWORD=${DB_PASSWORD}',
  'DB_PASSWORD=${DB_PASSWORD:-}',
  'DB_PASSWORD=${DB_PASSWORD:-$FALLBACK_PASSWORD}',
  'password: ${DB_PASSWORD:-${VAULT_PASSWORD}}',
  'GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}',
  'NODE_ENV=${NODE_ENV:-production}',
  'echo ${API_TOKEN}',
], [
  [`DB_PASSWORD=\${DB_PASSWORD:-${V}}`, V],
  [`environment:\n  - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD:-${V}}`, V],
  [`echo \${API_TOKEN:-${V}}`, V],
  [`\${API_TOKEN-${V}}`, V],
  [`\${API_TOKEN:=${V}}`, V],
  [`\${API_TOKEN=${V}}`, V],
  [`\${API_TOKEN:?${V}}`, V],
  [`\${API_TOKEN:+${V}}`, V],
  [`password: \${DB_PASSWORD:-${V}}`, V],
  [`--token \${DEPLOY_TOKEN:-${V}}`, V],
  [`psql "host=db user=app password=\${PGPASSWORD:-${V}}"`, V],
]);

test('F233 the default is masked inside its reference; the reference stays readable', () => {
  assert.equal(FIELDS.cmd(`echo \${API_TOKEN:-${V}}`), `echo \${API_TOKEN:-${MASK}}`);
  assert.equal(FIELDS.body(`image: app\ncommand: run \${API_TOKEN:-${V}} now`), `image: app\ncommand: run \${API_TOKEN:-${MASK}} now`);
});

// ---- F234 ----------------------------------------------------------------------------------------

pair('F234', 'one placeholder rule for `$…` and `<…>` in every layer', [
  'password: $DB_PASSWORD',
  'password=$DB_PASSWORD',
  'DB_PASSWORD=$DB_PASSWORD',
  'password = "$DB_PASSWORD"',
  'password: <password>',
  'password=<password>',
  'api_key: <2fa_api_key>',
  'DB_PASSWORD=<my.db_password>',
  'export OPENAI_API_KEY=<YOUR_API_KEY>',
  'curl -u admin:$ADMIN_PASSWORD https://api.example.test/v1',
  'curl -u "$user:$pass" https://api.example.test/v1',
  'curl -H "Authorization: Bearer $token" https://api.example.test/v1',
  'password=$db_password',
], [
  [`password: $Pass${WEAK}`, WEAK],
  [`password: <${WEAK}>`, WEAK],
  [`password: $${WEAK}`, WEAK],
  [`password=$${WEAK}`, WEAK],
  [`password = "$${WEAK}"`, WEAK],
  [`--token $${WEAK}`, WEAK],
  [`-u admin:$${WEAK}`, WEAK],
  [`DB_PASSWORD=<${WEAK}>`, WEAK],
  [`token: <Real${WEAK}>`, WEAK],
]);

test('F234 a value gets one answer whatever its separator', () => {
  const values = [`$${WEAK}`, `<${WEAK}>`, '$DB_PASSWORD', '<password>', 'changeme', 'true', `${V}`];
  for (const [field, through] of Object.entries(FIELDS)) {
    for (const value of values) {
      // After a flag, `<` is a redirection, never a value (`--with-token < token.txt` is pinned clean in
      // secret-named.test.js): the flag shape is asked only of values that do not open with it.
      const texts = [`password=${value}`, `password: ${value}`, `DB_PASSWORD=${value}`, ...(value[0] === '<' ? [] : [`--password ${value}`])];
      const answers = texts.map((text) => through(text) === text);
      assert.ok(answers.every((a) => a === answers[0]), `${field}: ${value}: ${answers}`);
    }
  }
});

// ---- F235 ----------------------------------------------------------------------------------------

pair('F235', 'a quoted boolean or an empty quoted value is judged inside its quotes', [
  'password: "true"',
  'password = "false"',
  "api_key: 'null'",
  'password = ""',
  'DB_PASSWORD=""',
], [
  [`password: "true ${V}"`, V],
  [`password = "${V}"`, V],
  [`api_key: 'null${V}'`, V],
]);

// ---- what the matrix found beside the five --------------------------------------------------------

pair('W3e-8', 'an empty assignment before a command is empty', ['API_TOKEN= ./run.sh', 'cd app && SECRET= make deploy'],
  [[`API_TOKEN=${V} ./run.sh`, V]], ['cmd']);

pair('W3e-8', 'a key at a line end has no value on the next line', ["cat > .env <<'EOF'\nexport DB_PASSWORD=\nEOF",
  "cat > .env <<'EOF'\npassword=\nEOF"], [[`cat > .env <<'EOF'\nDB_PASSWORD=${V}\nEOF`, V]], ['cmd', 'ask']);

pair('W3e-8', 'a value that runs into the closing quote of a JSON string', [
  '{"cmd": "deploy --token $DEPLOY_TOKEN"}',
  '{"cmd": "export PASSWORD="}',
  '{"cmd": "password=***"}',
  '{"cmd": "curl -H \\"X-Api-Key: $API_KEY\\" https://api.example.test/v1"}',
  '{"yaml": "api_key: |\\n  <api_key>"}',
], [
  [`{"cmd": "deploy --token ${V}"}`, V],
  [`{"cmd": "password=${V}"}`, V],
  [`{"cmd": "curl -H \\"X-Api-Key: ${V}\\" https://api.example.test/v1"}`, V],
  [`{"yaml": "api_key: |\\n  ${V}"}`, V],
  [`{"cmd": "password = \\"${V}\\""}`, V],
]);

pair('W3e-8', 'a YAML block that holds one boolean', ['password: |\n  true', 'token: >-\n  false'],
  [[`password: |\n  true ${V}`, V]]);

pair('W3e-8', 'a key after a command separator', ['cd app; password: changeme', 'make && token: <token>'], [
  [`cd app; password: ${V}`, V],
  [`make && API_KEY = "${V}"`, V],
  [`make || password: |\n  ${V}`, V],
]);

test('W3e-8 redaction stays idempotent over every masked shape above', () => {
  const texts = [`step one\\n--token ${V}`, `2FA_SECRET=${V}`, `DB_PASSWORD=\${DB_PASSWORD:-${V}}`, `password: <${WEAK}>`,
    `password: "true ${V}"`, `{"cmd": "deploy --token ${V}"}`, `cd app; password: ${V}`];
  for (const text of texts) {
    const input = led({ ask: [{ turn: 1, text }], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text, tailLines: text.split('\n') }, { turn: 1, seq: 1, kind: 'create', path: 'a.cfg', argsExcerpt: text, diff: `+${text}`,
      after: { text, truncated: false, lines: 1 } }], sayings: [{ turn: 1, text }] });
    const once = redact(input).ledger;
    const twice = redact({ ...once, dropped: [] }).ledger;
    assert.deepEqual({ ...twice, dropped: [] }, { ...once, dropped: [] }, text);
  }
});
