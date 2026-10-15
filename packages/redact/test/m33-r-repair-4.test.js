// M33 R repair 4. What the fourth leak hunt found still reaching the ledger, the session and the review
// requests, at the redaction stage.
//
// 1. UUID_SPLIT (repair 3) split a token on its whole UUIDs and judged each piece alone. A piece is not the token: the
//    split also cut the secret away from the neighbours that made the token fail. `…/services/<uuid>/<random>` left
//    `/<random>`, which passes as base64 (BENIGN; the 40-character narrowing is longer than it), while the same URL
//    without the UUID was dropped. Now a token holding whole UUIDs is judged as it would read had each UUID not been
//    written into it — the UUID taken out with the separator before it, or the one after it, or neither — its
//    neighbours kept together; a token fails if any of those readings fails, and then the whole token goes, UUIDs
//    included. A token with more whole UUIDs than MAX_TOKEN_UUIDS has too many readings to try: it fails (fail closed).
// 2. A YAML block scalar's key line in CRLF text (`signing_key: |\r`) never matched BLOCK_KEY (`.` stops before `\r`),
//    so its body lines reached every channel. The key line now ends at an optional `\r`.
// 3. `tailLines` was scrubbed de-numbered only for the `N\t` prefix. A line number in another shape — `N→`, `grep -n`
//    (`N:`, `N-`), `rg -n` / `grep -Hn` (`path:N:`, `path-N-`) — still stood between the line-anchored rules and the
//    line. Each shape present is now one more de-numbered view; a line is shown only where every view shows it alike.
// 4. A JSON-escaped continuation (`KEY=\\\n  value`) was joined only in the fields scanned whole (repair 3 item 5).
//    Every line-structured field — bodies, sayings, the claim, `tailLines`, the diff — now scans a line that holds one
//    joined across it too; a line whose joined view finds what its own form does not hide is dropped and counted. The
//    twice-escaped form (`\\\\\\r\\n`, a JSON file's text inside JSON arguments) is a continuation too.
//
// Synthetic text only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redact, sliceHash, entropy, ENTROPY_MIN } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const DROPPED = '‹dropped:high-entropy›';
const NOTE = /^\[… \d+ (?:diff )?line\(s\) dropped: /;
/** Every 8-character run of `secret` that `text` holds. */
const fragments = (text, secret) => {
  const found = [];
  for (let i = 0; i + 8 <= secret.length; i++) if (String(text).includes(secret.slice(i, i + 8))) found.push(secret.slice(i, i + 8));
  return found;
};

// ---- 1. a token holding whole UUIDs is judged as it reads without them, neighbours kept together ---------------------

// Deterministic, invented runs (a seeded generator, never a clock or Math.random).
let seed = 0x5eed4;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const B64URL = `${ALNUM}-_`;
const HEX = '0123456789abcdef';
const pick = (alphabet, n) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
const uuid = () => `${pick(HEX, 8)}-${pick(HEX, 4)}-4${pick(HEX, 3)}-a${pick(HEX, 3)}-${pick(HEX, 12)}`;

const UUID = '3f2b8c1e-9a4d-4e7b-a1c2-7d9e0f1a2b3c';
const SECRET = createHash('sha256').update('m33 r repair 4: hook secret').digest('base64').replace(/[+/=]/g, '').slice(0, 32);

/**
 * Each channel, as `(text) => what is shown of the line that holds it` — a command, an output line, a write's
 * arguments, a diff line, a write's body, the ask and a saying (prose: a token is replaced, the line kept).
 */
const CHANNELS = {
  cmd: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `curl -s -X POST ${t} -d @status.json` }] })).ledger.ledger[0].cmd ?? '',
  tailLines: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat hooks.txt',
    tailLines: ['hooks:', `  status ${t}`, 'done'] }] })).ledger.ledger[0].tailLines.join('\n'),
  argsExcerpt: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'hooks.js',
    argsExcerpt: `const hook = 'old';\n⟪→⟫\nconst hook = '${t}';` }] })).ledger.ledger[0].argsExcerpt ?? '',
  diff: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'hooks.js',
    diff: ` const a = 1;\n+const hook = '${t}';\n const b = 2;` }] })).ledger.ledger[0].diff,
  body: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'hooks.js',
    after: { text: `const a = 1;\nconst hook = '${t}';\nconst b = 2;`, truncated: false, lines: 3 } }] })).ledger.ledger[0].after.text,
  ask: (t) => redact(led({ ask: [{ turn: 1, text: `post the build status to ${t} when done` }] })).ledger.ask[0].text,
  saying: (t) => redact(led({ sayings: [{ turn: 1, text: `I will post to ${t} next.` }] })).ledger.sayings[0].text,
};
/** Does `channel` show any 8 characters of `secret` from `text`? */
const shows = (channel, text, secret) => fragments(CHANNELS[channel](text), secret).length > 0;

test('M33 R repair 4 premise: the hunt\'s URL fails as a token without its UUID, and its piece behind the UUID passes alone', () => {
  const without = `https://hooks.example.test/services/${SECRET}`;
  assert.ok(entropy(without) >= ENTROPY_MIN, 'the URL without the UUID is over the floor');
  assert.match(`/${SECRET}`, /^[A-Za-z0-9+/]{20,}={0,2}$/, 'the piece repair 3 judged alone has the base64 shape');
  assert.ok(`/${SECRET}`.length < 40, 'and is shorter than the 40-character narrowing');
});

test('M33 R repair 4: a random path secret after a whole UUID drops exactly as it does without the UUID, in every channel', () => {
  for (const url of [`https://hooks.example.test/services/${SECRET}`, `https://hooks.example.test/services/${UUID}/${SECRET}`]) {
    for (const channel of Object.keys(CHANNELS)) {
      const out = CHANNELS[channel](url);
      assert.deepEqual(fragments(out, SECRET), [], `${channel}: ${url.includes(UUID) ? 'with' : 'without'} the UUID`);
    }
  }
  // The prose channels keep the line and lose the whole token, its UUID too: no part of the URL is left beside the
  // marker to reassemble it from.
  const ask = CHANNELS.ask(`https://hooks.example.test/services/${UUID}/${SECRET}`);
  assert.equal(ask, `post the build status to ${DROPPED} when done`);
  const { dropped } = redact(led({ ask: [{ turn: 3, text: `post to https://hooks.example.test/services/${UUID}/${SECRET}` }] }));
  assert.deepEqual(dropped, [{ turn: 3, reason: 'dropped:unclassified-high-entropy-token', where: 'ask' }]);
});

/** The URL tails, around a random run R. */
const TAILS = {
  slash: (r) => `/${r}`,
  slashEnd: (r) => `/${r}/`,
  plus: (r) => `/x+${r}`,
  dotJson: (r) => `/${r}.json`,
  dash: (r) => `-${r}`,
  query: (r) => `?ref=${r}`,
};
/**
 * Where a UUID is written into a token, as `[without, with]` builders over R: the token as it would read with no UUID,
 * and with one (or several) written in, each behind or before a separator.
 */
const PLACES = {
  'a UUID segment before the tail': (tail, r) => [`https://hooks.example.test/services${tail(r)}`,
    `https://hooks.example.test/services/${uuid()}${tail(r)}`],
  'two UUID segments before the tail': (tail, r) => [`https://hooks.example.test/v1${tail(r)}`,
    `https://hooks.example.test/v1/${uuid()}/${uuid()}${tail(r)}`],
  'three UUID segments around the tail': (tail, r) => [`https://hooks.example.test/v1${tail(r)}`,
    `https://hooks.example.test/v1/${uuid()}/${uuid()}${tail(r)}/${uuid()}`],
  'a UUID that starts the token': (tail, r) => [`hooks${tail(r)}`, `${uuid()}/hooks${tail(r)}`],
  'a UUID that ends the token': (tail, r) => [`hooks${tail(r)}`, `hooks${tail(r)}/${uuid()}`],
  'a UUID behind one separator and before another': (tail, r) => [`/srv/hooks${tail(r)}`, `/srv/hooks/${uuid()}${tail(r)}`],
};

test('M33 R repair 4: a UUID written into a token never keeps what the token without it would drop, in any channel', () => {
  let probes = 0;
  const kept = [];
  for (const [place, build] of Object.entries(PLACES)) {
    for (const [tailName, tail] of Object.entries(TAILS)) {
      for (let length = 16; length <= 48; length += 4) {
        for (let i = 0; i < 3; i++) {
          const r = pick(i === 2 ? B64URL : ALNUM, length);
          const [without, withUuid] = build(tail, r);
          for (const channel of Object.keys(CHANNELS)) {
            probes++;
            if (shows(channel, withUuid, r) && !shows(channel, without, r)) kept.push(`${place} | ${tailName} | ${length} | ${channel}`);
          }
        }
      }
    }
  }
  assert.ok(probes > 6000, `premise: ${probes} probes`);
  assert.deepEqual(kept, [], 'with the UUID the run is kept, without it dropped');
});

test('M33 R repair 4: the same URL with and without a UUID segment gets the same verdict, in every channel', () => {
  const cases = [
    [`https://hooks.example.test/services/${SECRET}`, `https://hooks.example.test/services/${UUID}/${SECRET}`, false],
    [`https://hooks.example.test/services/${SECRET}.json`, `https://hooks.example.test/services/${UUID}/${SECRET}.json`, false],
    [`https://hooks.example.test/services-${SECRET}`, `https://hooks.example.test/services/${UUID}-${SECRET}`, false],
    // Paths that hold such a run: a session's scratchpad, a transcript, a pull request's file view.
    ['/private/tmp/claude-501/-Users-dev-Code-proj/scratchpad/x.mjs', `/private/tmp/claude-501/-Users-dev-Code-proj/${UUID}/scratchpad/x.mjs`, true],
    ['~/.claude/projects/-Users-dev-Code-proj/.jsonl', `~/.claude/projects/-Users-dev-Code-proj/${UUID}.jsonl`, true],
  ];
  for (const [without, withUuid, keep] of cases) {
    for (const channel of Object.keys(CHANNELS)) {
      for (const text of [without, withUuid]) {
        const out = CHANNELS[channel](text);
        assert.equal(out.includes(text), keep, `${channel}: ${text} is ${keep ? 'kept' : 'dropped'}`);
      }
    }
  }
});

test('M33 R repair 4: a token with more whole UUIDs than the rule tries fails closed; up to three are each taken out', () => {
  const three = `/data/${UUID}/${uuid()}/${uuid()}/report.json`;
  const four = `/data/${UUID}/${uuid()}/${uuid()}/${uuid()}/report.json`;
  assert.equal(CHANNELS.cmd(three), `curl -s -X POST ${three} -d @status.json`, 'three UUIDs: judged without them, kept');
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 2, seq: 0, kind: 'bash', cmd: `ls ${four}` }] }));
  assert.equal(ledger.ledger[0].cmd, undefined, 'four: the command goes');
  assert.deepEqual(dropped, [{ turn: 2, reason: 'dropped:unclassified-high-entropy', where: 'cmd' }]);
  assert.equal(CHANNELS.ask(four), `post the build status to ${DROPPED} when done`, 'the ask loses the token');
});

test('M33 R repair 4: the UUID rule is deterministic and final: same bytes, and a second pass changes nothing', () => {
  const input = led({
    ask: [{ turn: 1, text: `post to https://hooks.example.test/services/${UUID}/${SECRET} and to /tmp/${UUID}/out.txt` }],
    sayings: [{ turn: 1, text: `posting to https://hooks.example.test/services/${UUID}/${SECRET}` }],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `node /tmp/${UUID}/x.mjs`, tailLines: [`POST https://hooks.example.test/services/${UUID}/${SECRET}`, 'ok'] }],
  });
  const once = redact(structuredClone(input));
  assert.equal(JSON.stringify(redact(structuredClone(input))), JSON.stringify(once));
  assert.equal(sliceHash(redact({ ...once.ledger, dropped: [] }).ledger), sliceHash(once.ledger));
  assert.deepEqual(fragments(JSON.stringify(once.ledger), SECRET), []);
  assert.equal(once.ledger.ledger[0].cmd, `node /tmp/${UUID}/x.mjs`);
  assert.ok(once.ledger.ask[0].text.endsWith(`and to /tmp/${UUID}/out.txt`));
});

// ---- 2. a YAML block key line in CRLF text ---------------------------------------------------------------------------

const WORDS = ['correct-horse-battery-staple-lantern', 'quiet-meadow-orchard-violet-ember'];
const blockText = (eol, header = 'signing_key: |', indent = header.startsWith('- ') ? '    ' : '  ') =>
  ['region: eu', header, ...WORDS.map((w) => `${indent}${w}`), 'replicas: 2'].join(eol);
const HEADERS = ['signing_key: |', 'password: >-', 'private_key: |2', 'token: | # rotated monthly', '"client_secret": >', '- secret: |'];

/** Each field that can hold a file's text, as `(text) => everything redaction emitted for it`. */
const TEXT_FIELDS = {
  tailLines: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat deploy.yaml', tailLines: t.split('\n') }] })).ledger.ledger[0].tailLines.join('\n'),
  'numbered tailLines': (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat -n deploy.yaml',
    tailLines: t.split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`) }] })).ledger.ledger[0].tailLines.join('\n'),
  before: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'deploy.yaml',
    before: { text: t, source: 'read', turn: 1, partial: false, truncated: false, lines: 6 } }] })).ledger.ledger[0].before.text,
  after: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'deploy.yaml',
    after: { text: t, truncated: false, lines: 6 } }] })).ledger.ledger[0].after.text,
  diff: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'deploy.yaml',
    diff: t.split('\n').map((l) => `+${l}`).join('\n') }] })).ledger.ledger[0].diff,
  'context diff': (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'deploy.yaml',
    diff: t.split('\n').map((l) => (l.startsWith('replicas') ? `-${l}\n+replicas: 3\r` : ` ${l}`)).join('\n') }] })).ledger.ledger[0].diff,
  argsExcerpt: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'deploy.yaml', argsExcerpt: t }] })).ledger.ledger[0].argsExcerpt ?? '',
  cmd: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `cat > deploy.yaml <<'EOF'\n${t}\nEOF` }] })).ledger.ledger[0].cmd ?? '',
  ask: (t) => redact(led({ ask: [{ turn: 1, text: `apply this:\n${t}` }] })).ledger.ask[0].text,
  saying: (t) => redact(led({ sayings: [{ turn: 1, text: `I wrote:\n${t}` }] })).ledger.sayings[0].text,
  commentary: (t) => redact(led({ commentary: [{ turn: 1, beforeEvent: 0, text: t }] })).ledger.commentary[0].text,
  claim: (t) => redact(led({ claim: { finalMessage: `Done:\n${t}` } })).ledger.claim.finalMessage,
};

test('M33 R repair 4 premise: the LF block is masked in every field', () => {
  for (const [field, through] of Object.entries(TEXT_FIELDS)) {
    for (const header of HEADERS) assert.deepEqual(WORDS.flatMap((w) => fragments(through(blockText('\n', header)), w)), [], `${field}: ${header}`);
  }
});

test('M33 R repair 4: a YAML secret block in CRLF text is masked in every field, whatever its header', () => {
  for (const [field, through] of Object.entries(TEXT_FIELDS)) {
    for (const header of HEADERS) {
      const out = through(blockText('\r\n', header));
      assert.deepEqual(WORDS.flatMap((w) => fragments(out, w)), [], `${field}: ${JSON.stringify(header)}`);
    }
  }
});

test('M33 R repair 4: a CRLF block is masked line by line where it stands, its line ends kept', () => {
  const text = blockText('\r\n');
  assert.equal(TEXT_FIELDS.after(text), ['region: eu', 'signing_key: |', '  ‹redacted:secret-value›', '  ‹redacted:secret-value›', 'replicas: 2'].join('\r\n'));
  assert.deepEqual(TEXT_FIELDS.tailLines(text).split('\n'),
    ['region: eu\r', 'signing_key: |\r', '  ‹redacted:secret-value›\r', '  ‹redacted:secret-value›\r', 'replicas: 2']);
  // A CRLF key line whose value is not a block header is not a block.
  const plain = ['signing_key: |x\r', '  not-a-block-line-kept-here\r', 'done: 1'].join('\n');
  assert.ok(TEXT_FIELDS.after(plain).includes('not-a-block-line-kept-here'));
});

// ---- 3. other line-number shapes in tailLines ------------------------------------------------------------------------

const PEM_SHORT = ['MIIBOgIBAAJBAKj34GkxFhD9', 'Pq3Rs5Tu7Vw9Xy1Za3Bc5De', 'Fg7Hi9Jk1Lm3No5Pq7Rs9Tu', 'Vw1Xy3Za5Bc7De9Fg'];
const BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const END = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const ENV_VALUE = 'violetEmberOrchardRiver';
const NUMBERED_ITEMS = {
  'a YAML block': [['signing_key: |', ...WORDS.map((w) => `  ${w}`)], WORDS],
  'a PEM block of short lines': [[BEGIN, ...PEM_SHORT, END], PEM_SHORT],
  'a continued secret-named value': [['export DB_PASSWORD=\\', `  ${ENV_VALUE}`], [ENV_VALUE]],
};
const SHAPES = {
  arrow: (n, l) => `${String(n).padStart(6)}→${l}`,
  'grep -n': (n, l, match) => `${n}${match ? ':' : '-'}${l}`,
  'grep -n, all matches': (n, l) => `${n}:${l}`,
  'rg -n': (n, l, match) => `config/deploy.yaml${match ? ':' : '-'}${n}${match ? ':' : '-'}${l}`,
  'grep -Hn': (n, l) => `config/deploy.yaml:${n}:${l}`,
};

for (const [shape, format] of Object.entries(SHAPES)) {
  test(`M33 R repair 4: ${shape} output in tailLines leaves no line of a block it numbers`, () => {
    for (const [name, [lines, secrets]] of Object.entries(NUMBERED_ITEMS)) {
      const all = ['first: 1', ...lines, 'last: 2'];
      const tailLines = all.map((l, i) => format(i + 1, l, i === 1));
      const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'grep -n -A3 key deploy.yaml', tailLines }] })).ledger.ledger[0].tailLines;
      assert.deepEqual(secrets.flatMap((s) => fragments(out.join('\n'), s)), [], `${name}`);
      assert.equal(out[0], tailLines[0], `${name}: a clean line keeps its bytes`);
      assert.equal(out.at(-1), tailLines.at(-1), `${name}: the last line too`);
      assert.ok(out.some((line) => NOTE.test(line)), `${name}: what was dropped is counted`);
    }
  });
}

test('M33 R repair 4: output whose lines only look numbered keeps its bytes when nothing is found', () => {
  const tailLines = ['2026-10-01 12:00:01 build started', '12:00:02 compiled 14 files', 'src/app.js:10:3 warning unused import',
    'src/app.js-11-  const x = 1;', '     4→ plain line', 'done in 3s'];
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'make', tailLines }] }));
  assert.deepEqual(ledger.ledger[0].tailLines, tailLines);
  assert.deepEqual(dropped, []);
});

test('M33 R repair 4: a secret every view masks alike keeps its line and is declared once', () => {
  const tailLines = ['3:first: 1', '4:token = ghp_' + 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2', '5:last: 2'];
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'grep -n . c.cfg', tailLines }] }));
  assert.deepEqual(ledger.ledger[0].tailLines, ['3:first: 1', '4:token = ‹redacted:github-token›', '5:last: 2']);
  assert.deepEqual(dropped.map((d) => d.reason), ['redacted:github-token']);
});

// ---- 4. JSON-escaped continuations in every line-structured field ----------------------------------------------------

const PASS = 'violetEmberOrchardRiver';
const json = (decoded) => JSON.stringify({ scripts: { deploy: decoded } }, null, 2);
const ESCAPED = {
  LF: `export DB_PASSWORD=\\\n  ${PASS}`,
  CRLF: `export DB_PASSWORD=\\\r\n  ${PASS}`,
  tab: `export DB_PASSWORD=\\\n\t${PASS}`,
  'no indentation': `DB_PASSWORD=\\\n${PASS}`,
};
/** Each line-structured field, holding a JSON document's text. */
const LINE_FIELDS = {
  after: (t) => TEXT_FIELDS.after(t),
  before: (t) => TEXT_FIELDS.before(t),
  diff: (t) => TEXT_FIELDS.diff(t),
  tailLines: (t) => TEXT_FIELDS.tailLines(t),
  'numbered tailLines': (t) => TEXT_FIELDS['numbered tailLines'](t),
  saying: (t) => TEXT_FIELDS.saying(t),
  commentary: (t) => TEXT_FIELDS.commentary(t),
  claim: (t) => TEXT_FIELDS.claim(t),
  'one-line saying': (t) => TEXT_FIELDS.saying(t.replace(/\n\s*/g, ' ')),
};

test('M33 R repair 4 premise: the JSON text holds the continuation escaped, on one physical line with its value', () => {
  const text = json(ESCAPED.LF);
  assert.ok(text.includes(`"export DB_PASSWORD=\\\\\\n  ${PASS}"`));
});

test('M33 R repair 4: a value continued by a JSON-escaped continuation goes with its key, in every line-structured field', () => {
  for (const [shape, decoded] of Object.entries(ESCAPED)) {
    for (const [field, through] of Object.entries(LINE_FIELDS)) {
      assert.deepEqual(fragments(through(json(decoded)), PASS), [], `${shape}: ${field}`);
    }
  }
});

test('M33 R repair 4: the twice-escaped continuation (a JSON file\'s text in JSON arguments) is one too, LF or CRLF', () => {
  for (const [shape, decoded] of Object.entries(ESCAPED)) {
    const argsExcerpt = JSON.stringify([{ old_string: 'q', new_string: json(decoded) }]);
    const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'package.json', argsExcerpt }] })).ledger.ledger[0].argsExcerpt ?? '';
    assert.deepEqual(fragments(out, PASS), [], shape);
    const cmd = `printf '%s' '${argsExcerpt}' > edits.json`;
    assert.deepEqual(fragments(redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd }] })).ledger.ledger[0].cmd ?? '', PASS), [], `${shape}: cmd`);
  }
});

test('M33 R repair 4: a JSON text with an escaped continuation and nothing secret keeps its bytes', () => {
  const text = json('make build \\\n  --target web');
  for (const [field, through] of Object.entries(LINE_FIELDS)) {
    if (field === 'one-line saying') continue;
    const out = through(text);
    assert.ok(out.includes('"deploy": "make build \\\\\\n  --target web"'), field);
  }
  const { dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'package.json', after: { text, truncated: false, lines: 5 } }] }));
  assert.deepEqual(dropped, []);
});

test('M33 R repair 4: escaped and plain continuations stay deterministic and final', () => {
  const input = led({
    sayings: [{ turn: 1, text: json(ESCAPED.CRLF) }],
    ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'package.json', after: { text: json(ESCAPED.LF), truncated: false, lines: 5 },
      diff: json(ESCAPED.tab).split('\n').map((l) => `+${l}`).join('\n'), tailLines: json(ESCAPED['no indentation']).split('\n') }],
  });
  const once = redact(structuredClone(input));
  assert.equal(JSON.stringify(redact(structuredClone(input))), JSON.stringify(once));
  assert.equal(sliceHash(redact({ ...once.ledger, dropped: [] }).ledger), sliceHash(once.ledger));
  assert.deepEqual(fragments(JSON.stringify(once.ledger), PASS), []);
});
