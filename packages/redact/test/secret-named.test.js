// W3e-4 / F201 — a secret-named value is masked in every field (security).
//
// The content fields (`before`/`after` bodies, sayings, claims — everything through `scrubLines`)
// mask a value assigned to a secret-named key (`API_TOKEN=…`, `password: …`) whatever the value
// looks like. The command fields (`cmd`, `argsExcerpt`), the ask and `tailLines`
// never had that rule: the W3e-3 probe `export API_TOKEN=hunter2x` came through a command unmasked.
// Commands are exactly where `export X=…`, `-H "Authorization: …"`, `--password …` and `KEY=value
// cmd` appear. The key-name rule now runs inside `scrub`, on every view W3e-3's `settle` takes of a
// field, in every field, with the shell and CLI shapes the line-start content rule never saw.
//
// Every fixture is synthetic. The secrets are short, low-entropy values assembled at run time —
// nothing but the name they are assigned to gives them away — so this file carries no literal a
// secret scan would flag. No real recording is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';
import { assertLinear } from './linear-clock.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const event = (over) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', ...over }] })).ledger.ledger[0];

/** A value no pattern, entropy floor or length rule catches: only its name says it is a secret. */
const V = ['hunt', 'er2', 'xW3e4'].join('');
const MASK = '‹redacted:secret-value›';

/** The five fields that never had the key-name rule, each fed one text. */
const FIELDS = {
  cmd: (text) => event({ cmd: text }).cmd,
  argsExcerpt: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'deploy.sh', argsExcerpt: text }] }))
    .ledger.ledger[0].argsExcerpt,
  ask: (text) => redact(led({ ask: [{ turn: 1, text }] })).ledger.ask[0].text,
  tailLines: (text) => {
    const lines = event({ cmd: 'make deploy', tailLines: text.split('\n') }).tailLines;
    return Array.isArray(lines) ? lines.join('\n') : lines;
  },
};

/** Each shape, with the value, and what its masked form reads. */
const SHAPES = {
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
};

for (const [field, through] of Object.entries(FIELDS)) {
  for (const [shape, [text, masked]] of Object.entries(SHAPES)) {
    test(`F201 ${shape} is masked in ${field}`, () => {
      const out = through(text);
      assert.equal(typeof out === 'string' && out.includes(V), false, `${field}: the value survives`);
      assert.equal(out, masked, `${field}: masked in place, the rest kept`);
    });
  }
}

test('F201 the W3e-3 probe: `export API_TOKEN=hunter2x` in a command is masked and declared', () => {
  const value = ['hunter', '2x'].join('');
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 3, seq: 0, kind: 'bash', cmd: `export API_TOKEN=${value}` }] }));
  assert.equal(ledger.ledger[0].cmd, `export API_TOKEN=${MASK}`);
  assert.deepEqual(dropped, [{ turn: 3, reason: 'redacted:secret-key-value', where: 'cmd' }]);
});

test('F201 a line-start assignment in a field that is not a command masks the rest of its line, as the content rule does', () => {
  // `env` prints a value raw, spaces and all: the whole rest of the line is the value.
  const passphrase = ['correct', 'horse', 'battery', V].join(' ');
  assert.equal(FIELDS.tailLines(`HOME=/srv/app\nDB_PASSWORD=${passphrase}\nSHELL=/bin/sh`),
    `HOME=/srv/app\nDB_PASSWORD=${MASK}\nSHELL=/bin/sh`);
  assert.equal(FIELDS.argsExcerpt(`API_KEY = ${passphrase}`), `API_KEY = ${MASK}`);
  // A command assigns one shell word: what follows it is the command, and stays readable.
  assert.equal(FIELDS.cmd(`API_TOKEN=${V} ./deploy.sh --prod`), `API_TOKEN=${MASK} ./deploy.sh --prod`);
  // Inside a here-document the lines are file content, not a command: the rest of the line goes.
  assert.equal(FIELDS.cmd(`cat > .env <<'EOF'\nDB_PASSWORD=${passphrase}\nEOF`),
    `cat > .env <<'EOF'\nDB_PASSWORD=${MASK}\nEOF`);
});

test('F201 in the human\'s ask a line-start value ends with its sentence: the next sentence is the contract', () => {
  assert.equal(FIELDS.ask(`Token: ${V}. Use three attempts.`), `Token: ${MASK}. Use three attempts.`);
  assert.equal(FIELDS.ask(`password: correct horse battery ${V}\nthen deploy`), `password: ${MASK}\nthen deploy`);
  // An assignment in the ask is one shell word, as in a command.
  assert.equal(FIELDS.ask(`run API_TOKEN=${V} npm run deploy for me`), `run API_TOKEN=${MASK} npm run deploy for me`);
});

// ---- placeholders stay, byte for byte ----------------------------------------------------------

const PLACEHOLDERS = [
  'export API_TOKEN=$API_TOKEN',
  'export API_TOKEN="$API_TOKEN" && npm run deploy',
  'API_TOKEN=${API_TOKEN} npm run deploy',
  'GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}',
  'mysql -u app --password "$DB_PASSWORD" -h db.internal',
  'vercel deploy --token=<token> --prod',
  'mycli upload --api-key ${API_KEY} ./dist',
  'curl -sS -H "Authorization: Bearer $TOKEN" https://api.example.test/v1',
  "curl -H 'X-Api-Key: ${API_KEY}' https://api.example.test/v1",
  'curl -u admin:$ADMIN_PASSWORD https://api.example.test/v1',
  'password: ***',
  'password: changeme',
  'client_secret: <your-client-secret>',
  'API_KEY=<your-api-key> npm start',
  'DB_PASSWORD=REDACTED',
  'DB_PASSWORD=your_password',
  `export API_TOKEN=${MASK}`,
];

for (const [field, through] of Object.entries(FIELDS)) {
  test(`F201 every placeholder shape is kept byte-identical in ${field}`, () => {
    for (const text of PLACEHOLDERS) assert.equal(through(text), text, `${field}: ${text}`);
  });
}

// ---- nothing clean is rewritten ----------------------------------------------------------------

const CLEAN = [
  'npm test -- --grep "token refresh"',
  'NODE_ENV=production npm run build',
  'PWD=/workspace/project make build',
  'DB_PASSWORD_HASH=abcdef ./migrate',
  'cd "$OLDPWD" && echo $PWD',
  'docker login ghcr.io -u deploy --password-stdin',
  'gh auth login --with-token < token.txt',
  'curl -sS -H "Accept: application/json" https://api.example.test/v1',
  'git push -u origin main',
  'if [ "$TOKEN" == "" ]; then exit 1; fi',
  'the password field should be rotated regularly',
  'https://example.com/?password_reset=true',
  ['docker run --rm \\', '  --env NODE_ENV=test \\', '  node:20 npm test'].join('\n'),
];

for (const [field, through] of Object.entries(FIELDS)) {
  test(`F201 a clean command is byte-identical in ${field}`, () => {
    for (const text of CLEAN) assert.equal(through(text), text, `${field}: ${text}`);
  });
}

// ---- joined and physical lines alike --------------------------------------------------------------

test('F201 a flag and its value on two continued lines are masked through the joined line', () => {
  const cmd = ['mysql -u app \\', '  --password \\', `  ${V} -h db.internal`].join('\n');
  const out = FIELDS.cmd(cmd);
  assert.ok(!out.includes(V), 'the value survives');
  assert.equal(out, `mysql -u app --password ${MASK} -h db.internal`);
});

test('F201 a secret-named value split across a continuation leaves no half', () => {
  const [a, b] = [V.slice(0, 5), V.slice(5)];
  for (const [field, through] of Object.entries(FIELDS)) {
    const out = through(`export API_TOKEN=${a}\\\n${b} && deploy`) ?? '';
    assert.ok(!out.includes(V) && !out.includes(`=${a}`) && !out.includes(`${b} &&`), `${field}: a half survives`);
  }
});

test('F201 redaction stays idempotent over every shape', () => {
  for (const [text] of Object.values(SHAPES)) {
    const input = led({ ask: [{ turn: 1, text }], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text,
      tailLines: text.split('\n') }, { turn: 1, seq: 1, kind: 'create', path: 'a.sh', argsExcerpt: text }] });
    const once = redact(input).ledger;
    const twice = redact({ ...once, dropped: [] }).ledger;
    assert.deepEqual({ ...twice, dropped: [] }, { ...once, dropped: [] }, text);
  }
});

// ---- every other field gets the shapes too --------------------------------------------------------

test('F201 the shell and CLI shapes are caught inside every content field as well', () => {
  const text = `Ran: cd app && export API_TOKEN=${V} && curl -u admin:${V} https://api.example.test/v1`;
  const { ledger } = redact(led({
    ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'deploy.sh', after: { text, truncated: false, lines: 1 },
      before: { text, source: 'read', turn: 1 }, diff: `+${text}` }],
    claim: { finalMessage: text }, sayings: [{ turn: 1, text }], commentary: [{ turn: 1, beforeEvent: 0, text }],
  }));
  assert.ok(!JSON.stringify(ledger).includes(V), 'the value survives somewhere');
  assert.equal(ledger.sayings[0].text, `Ran: cd app && export API_TOKEN=${MASK} && curl -u admin:${MASK} https://api.example.test/v1`);
  const diff = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'deploy.sh',
    diff: `+curl -H "Authorization: Bearer ${V}" https://api.example.test/v1` }] })).ledger.ledger[0].diff;
  assert.equal(diff, `+curl -H "Authorization: Bearer ${MASK}" https://api.example.test/v1`);
});

test('F201 the key-name rule stays linear on a megabyte of one line, and a value past its scan bound goes to the line end', () => {
  // Measured before the bound: this input took ten minutes, every match re-scanning the one long word.
  for (const text of [',token=a'.repeat(120000), ' --token a'.repeat(100000), 'password: v1\n'.repeat(80000)]) {
    let out;
    assertLinear(() => { out = FIELDS.cmd(text); }, 10_000, 'bounded'); // CPU, scaled under load (linear-clock.js)
    assert.ok(typeof out === 'string' && !/token=a|--token a|password: v1/.test(out), 'and every value is masked');
  }
  const long = `export API_TOKEN=${V.repeat(200)} && deploy`;
  assert.equal(FIELDS.cmd(long), `export API_TOKEN=${MASK}`, 'fail closed: the rest of the line');
});

test('F201 a masked value never leaves a fragment of its token to be judged on its own', () => {
  // The fail-closed step judges tokens split at blanks, commas, quotes and brackets. A shell word
  // ends at `;`: masked only to there, the glued remainder (18 chars) would pass the backstop that
  // the whole 40-char token used to fail. The value takes the rest of its token instead.
  const blob = 'Zk3!q9Xv%2Lp#7Rw@Nb^4Ty&8Ue*Hs$Jd';
  for (const [field, through] of Object.entries(FIELDS)) {
    const out = through(`deploy TOKEN=${blob.slice(0, 16)};${blob.slice(16)} now`);
    assert.ok(typeof out !== 'string' || (!out.includes(blob.slice(16)) && !out.includes(blob.slice(0, 16))), `${field}: a fragment survives`);
  }
});

test('F201 a value a named pattern already catches keeps that pattern\'s label', () => {
  // The key-name region and the pattern's region cover the same value; the pattern's label wins,
  // so every existing output stays what it was.
  assert.equal(FIELDS.cmd("PGPASSWORD='secret123' psql -h db.internal"), "PGPASSWORD='‹redacted:db-credential›' psql -h db.internal");
  assert.equal(FIELDS.cmd(`mysql --password=${V}`), 'mysql --password=‹redacted:password-assignment›');
});
