// M33 R repair 5. What the fifth leak hunt found still reaching the ledger, the session and the review
// requests, at the redaction stage.
//
// 1. (major) A YAML secret block in text whose lines end in a run of carriage returns before the line feed (`\r\r\n`):
//    a CRLF file captured through a pseudo-terminal (`script`, a Codex `exec_command` with `tty: true`), or a CRLF text
//    converted twice. Repair 4's key line ended at ONE optional `\r`, so `signing_key: |\r\r` opened no block and its
//    body lines reached every channel. The key line now ends at any run of `\r`, and a masked line keeps its run. The
//    same capture continues a line with `\` + `\r\r\n`: a continuation is a `\`, any run of `\r`, then the line feed
//    (and its JSON-escaped form any run of escaped `\r`), in redaction and in the slicer alike.
// 2. `rg -n` / `grep -Hn` output was de-numbered only behind a path with no blank and no `:` in it. A path holding a
//    blank (every project under a folder like `Acme Labs`, Claude Code's own Grep tool printing absolute paths) or a
//    Windows drive's colon got no de-numbered view: the path shapes now take any run of the line before `:N:` / `-N-`.
// 3. More line-number and decoration shapes in `tailLines`, each one more de-numbered view (never shown, so a view can
//    only drop a line): `N text` (awk's NR, `nl -s' '`, `less -N`), bat's `N │`, code frames' `N |` and `> N |`, `N)`,
//    `(N)` and `[N]`, `rg --column` / `--vimgrep` (`path:N:C:`), timestamps before the text (ISO, a clock, a CI log's
//    columns), and `cat -A` / `-e` / `-v` decorations at the line's end (`$`, `^M$`, `^M`), alone or behind a number.
// 4. The UUID rule's entropy pre-filter counted UTF-16 units; `entropy` counts code points over the unit length. With a
//    lone surrogate in the token they differ, and a reading the floor fails could be passed by the pre-filter. A token
//    holding a surrogate now skips the pre-filter: every reading over the length floor is tested exactly.
// 5. JSON-escaped text on one physical line: a YAML block header followed by an escaped tab (`|\t\r\n`, escaped) is a
//    header, so its value runs to the end of the field; a private key's body behind escaped line breaks is masked with
//    its header, whatever blanks end its lines (a blank split the glued token the entropy floor relied on); an escaped
//    continuation may be escaped any number of times (three times, a `\` and its line feed read as twelve backslashes
//    and an `n`: a JSON file inside JSON inside JSON arguments).
//
// Synthetic text only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, sliceHash, entropy, ENTROPY_MIN } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const NOTE = /^\[… \d+ (?:diff )?line\(s\) dropped: /;
/** Every 8-character run of `secret` that `text` holds. */
const fragments = (text, secret) => {
  const found = [];
  for (let i = 0; i + 8 <= secret.length; i++) if (String(text).includes(secret.slice(i, i + 8))) found.push(secret.slice(i, i + 8));
  return found;
};
const leaksOf = (text, secrets) => secrets.flatMap((s) => fragments(text, s));

// ---- 1. a YAML block, and a continued line, behind a run of carriage returns -----------------------------------------

const WORDS = ['correct-horse-battery-staple-lantern', 'quiet-meadow-orchard-violet-ember'];
const blockText = (eol, header = 'signing_key: |', indent = header.startsWith('- ') ? '    ' : '  ') =>
  ['region: eu', header, ...WORDS.map((w) => `${indent}${w}`), 'replicas: 2'].join(eol);
const HEADERS = ['signing_key: |', 'password: >-', 'private_key: |2', 'token: | # rotated monthly', '"client_secret": >', '- secret: |'];
/** The line ends the hunt swept, and longer runs of the same kind. */
const CR_RUNS = { 'CR CR LF': '\r\r\n', 'CR CR CR LF': '\r\r\r\n' };

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
    diff: t.split('\n').map((l) => (l.startsWith('replicas') ? `-${l}\n+replicas: 3\r\r` : ` ${l}`)).join('\n') }] })).ledger.ledger[0].diff,
  argsExcerpt: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'deploy.yaml', argsExcerpt: t }] })).ledger.ledger[0].argsExcerpt ?? '',
  cmd: (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `cat > deploy.yaml <<'EOF'\n${t}\nEOF` }] })).ledger.ledger[0].cmd ?? '',
  ask: (t) => redact(led({ ask: [{ turn: 1, text: `apply this:\n${t}` }] })).ledger.ask[0].text,
  saying: (t) => redact(led({ sayings: [{ turn: 1, text: `I wrote:\n${t}` }] })).ledger.sayings[0].text,
  commentary: (t) => redact(led({ commentary: [{ turn: 1, beforeEvent: 0, text: t }] })).ledger.commentary[0].text,
  claim: (t) => redact(led({ claim: { finalMessage: `Done:\n${t}` } })).ledger.claim.finalMessage,
};

test('M33 R repair 5 premise: the CR CR LF key line is the only difference from the CRLF block repair 4 masks', () => {
  const crlf = blockText('\r\n');
  const crcrlf = blockText('\r\r\n');
  assert.equal(crcrlf.replace(/\r\r\n/g, '\r\n'), crlf);
  assert.deepEqual(leaksOf(TEXT_FIELDS.after(crlf), WORDS), [], 'repair 4 masks the CRLF block');
});

test('M33 R repair 5: a YAML secret block whose lines end in a run of carriage returns is masked in every field, whatever its header', () => {
  for (const [name, eol] of Object.entries(CR_RUNS)) {
    for (const [field, through] of Object.entries(TEXT_FIELDS)) {
      for (const header of HEADERS) {
        const out = through(blockText(eol, header));
        assert.deepEqual(leaksOf(out, WORDS), [], `${name} | ${field} | ${JSON.stringify(header)}`);
      }
    }
  }
});

test('M33 R repair 5: a CR CR LF block is masked line by line where it stands, each line keeping its run of carriage returns', () => {
  const text = blockText('\r\r\n');
  assert.equal(TEXT_FIELDS.after(text),
    ['region: eu', 'signing_key: |', '  ‹redacted:secret-value›', '  ‹redacted:secret-value›', 'replicas: 2'].join('\r\r\n'));
  assert.deepEqual(TEXT_FIELDS.tailLines(text).split('\n'),
    ['region: eu\r\r', 'signing_key: |\r\r', '  ‹redacted:secret-value›\r\r', '  ‹redacted:secret-value›\r\r', 'replicas: 2']);
  // The last line of a block keeps its run too.
  const last = ['signing_key: |', `  ${WORDS[0]}`, ''].join('\r\r\n');
  assert.equal(TEXT_FIELDS.after(last), ['signing_key: |', '  ‹redacted:secret-value›', ''].join('\r\r\n'));
  // A key line whose value is not a block header is not a block, behind any run of carriage returns.
  const plain = ['signing_key: |x\r\r', '  not-a-block-line-kept-here\r\r', 'done: 1'].join('\n');
  assert.ok(TEXT_FIELDS.after(plain).includes('not-a-block-line-kept-here'));
  // A block of placeholders is still kept, as it is in LF text.
  const placeholder = ['password: |', '  ${DB_PASSWORD}', 'done: 1'].join('\r\r\n');
  assert.equal(TEXT_FIELDS.after(placeholder), placeholder);
});

const PASS = 'violetEmberOrchardRiver';
const GHP = `ghp_${'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz'.slice(0, 36)}`;

test('M33 R repair 5: a value continued across `\\` and a run of carriage returns goes with its key, in every field', () => {
  for (const [name, eol] of Object.entries(CR_RUNS)) {
    for (const continued of [`export DB_PASSWORD=\\${eol}  ${PASS}`, `DB_PASSWORD=\\${eol}${PASS}`, `api_token: \\${eol}\t${PASS}`]) {
      const text = ['first: 1', continued, 'last: 2'].join(eol);
      for (const [field, through] of Object.entries(TEXT_FIELDS)) {
        assert.deepEqual(fragments(through(text), PASS), [], `${name} | ${field} | ${JSON.stringify(continued)}`);
      }
    }
  }
});

test('M33 R repair 5: a token split by `\\` and a run of carriage returns leaves no fragment in any field, at every split', () => {
  for (const [name, eol] of Object.entries(CR_RUNS)) {
    for (let k = 4; k < GHP.length; k += 3) {
      const text = [`curl -H "x: ${GHP.slice(0, k)}\\`, `  ${GHP.slice(k)}" https://x.test`].join(eol);
      for (const [field, through] of Object.entries(TEXT_FIELDS)) {
        assert.deepEqual(fragments(through(text), GHP), [], `${name} | ${field} | split ${k}`);
      }
    }
  }
});

test('M33 R repair 5: a lone carriage return, or a blank after the `\\`, is still not a continuation', () => {
  // `\` CR (no line feed) and `\` blank LF continue nothing: the second line keeps its bytes.
  for (const text of ['make build \\\r  --target web', 'make build \\ \n  --target web']) {
    const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'Makefile', after: { text, truncated: false, lines: 2 } }] }));
    assert.equal(out.ledger.ledger[0].after.text, text);
    assert.deepEqual(out.dropped, []);
  }
});

test('M33 R repair 5: a JSON-escaped continuation with a run of escaped carriage returns is one too, escaped once or twice', () => {
  const json = (decoded) => JSON.stringify({ scripts: { deploy: decoded } }, null, 2);
  for (const eol of Object.values(CR_RUNS)) {
    const decoded = `export DB_PASSWORD=\\${eol}  ${PASS}`;
    for (const field of ['after', 'before', 'tailLines', 'saying', 'claim']) {
      assert.deepEqual(fragments(TEXT_FIELDS[field](json(decoded)), PASS), [], `${JSON.stringify(eol)} | ${field}`);
    }
    const argsExcerpt = JSON.stringify([{ old_string: 'q', new_string: json(decoded) }]);
    const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'package.json', argsExcerpt }] })).ledger.ledger[0].argsExcerpt ?? '';
    assert.deepEqual(fragments(out, PASS), [], `${JSON.stringify(eol)} | twice escaped`);
  }
});

test('M33 R repair 5: carriage-return runs stay deterministic and final', () => {
  const input = led({
    ask: [{ turn: 1, text: `apply:\r\r\n${blockText('\r\r\n')}` }],
    sayings: [{ turn: 1, text: `export DB_PASSWORD=\\\r\r\n  ${PASS}` }],
    ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'deploy.yaml', after: { text: blockText('\r\r\n', 'password: >-'), truncated: false, lines: 5 },
      diff: blockText('\r\r\n').split('\n').map((l) => `+${l}`).join('\n'), tailLines: blockText('\r\r\r\n').split('\n') }],
  });
  const once = redact(structuredClone(input));
  assert.equal(JSON.stringify(redact(structuredClone(input))), JSON.stringify(once));
  assert.equal(sliceHash(redact({ ...once.ledger, dropped: [] }).ledger), sliceHash(once.ledger));
  // A second pass finds nothing left to mask: the same text, and nothing more declared.
  const again = redact({ ...structuredClone(once.ledger), dropped: [] });
  assert.equal(JSON.stringify({ ...again.ledger, dropped: [] }), JSON.stringify({ ...once.ledger, dropped: [] }));
  assert.deepEqual(again.dropped, []);
  assert.deepEqual(leaksOf(JSON.stringify(once.ledger), [...WORDS, PASS]), []);
});

// ---- 2. rg -n / grep -Hn behind a path with a blank or a drive's colon -----------------------------------------------

const PEM_SHORT = ['MIIBOgIBAAJBAKj34GkxFhD9', 'Pq3Rs5Tu7Vw9Xy1Za3Bc5De', 'Fg7Hi9Jk1Lm3No5Pq7Rs9Tu', 'Vw1Xy3Za5Bc7De9Fg'];
// Assembled at run time: a secret scan reads test sources for key headers.
const BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const END = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const NUMBERED_ITEMS = {
  'a YAML block': [['signing_key: |', ...WORDS.map((w) => `  ${w}`)], WORDS],
  'a PEM block of short lines': [[BEGIN, ...PEM_SHORT, END], PEM_SHORT],
  'a continued secret-named value': [['export DB_PASSWORD=\\', `  ${PASS}`], [PASS]],
};
/** `lines` (the first one matching) numbered by `format`, between two clean lines; redacted as a command's output. */
const throughTail = (format, lines) => {
  const all = ['first: 1', ...lines, 'last: 2'];
  const tailLines = all.map((l, i) => format(i + 1, l, i === 1));
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'grep -rn -A3 key .', tailLines }] }));
  return { tailLines, out: ledger.ledger[0].tailLines, dropped };
};

const PATH_SHAPES = {
  'rg -n, a blank in the path': (n, l, match) => `/srv/my deploy/config/deploy.yaml${match ? ':' : '-'}${n}${match ? ':' : '-'}${l}`,
  'grep -Hn, a blank in the path': (n, l) => `/srv/Acme Labs/proj/config/deploy.yaml:${n}:${l}`,
  'the Grep tool, a blank in the path': (n, l, match) => `/srv/Acme Labs/proj/deploy.yaml${match ? ':' : '-'}${n}${match ? ':' : '-'}${l}`,
  'grep -Hn, a Windows drive': (n, l) => `C:\\repo\\config\\deploy.yaml:${n}:${l}`,
  'rg -n, a Windows drive': (n, l, match) => `C:\\repo\\deploy.yaml${match ? ':' : '-'}${n}${match ? ':' : '-'}${l}`,
};

for (const [shape, format] of Object.entries(PATH_SHAPES)) {
  test(`M33 R repair 5: ${shape} leaves no line of a block it numbers`, () => {
    for (const [name, [lines, secrets]] of Object.entries(NUMBERED_ITEMS)) {
      const { tailLines, out } = throughTail(format, lines);
      assert.deepEqual(leaksOf(out.join('\n'), secrets), [], name);
      assert.equal(out[0], tailLines[0], `${name}: a clean line keeps its bytes`);
      assert.equal(out.at(-1), tailLines.at(-1), `${name}: the last line too`);
      assert.ok(out.some((line) => NOTE.test(line)), `${name}: what was dropped is counted`);
    }
  });
}

// ---- 3. more line-number and decoration shapes -----------------------------------------------------------------------

const SHAPES = {
  "awk's NR": (n, l) => `${n} ${l}`,
  "nl -s' '": (n, l) => `${String(n).padStart(6)} ${l}`,
  'less -N': (n, l) => `${String(n).padStart(7)} ${l}`,
  bat: (n, l) => `${String(n).padStart(4)} │ ${l}`,
  'a code frame': (n, l, match) => `${match ? '>' : ' '} ${String(n).padStart(2)} | ${l}`,
  'N)': (n, l) => `${n}) ${l}`,
  '(N)': (n, l) => `(${n}) ${l}`,
  '[N]': (n, l) => `[${n}] ${l}`,
  'rg --column': (n, l, match) => (match ? `config/deploy.yaml:${n}:1:${l}` : `config/deploy.yaml-${n}-${l}`),
  'rg --vimgrep, a blank in the path': (n, l) => `/srv/my deploy/deploy.yaml:${n}:3:${l}`,
  'ISO timestamps': (n, l) => `2026-10-01T12:00:${String(n).padStart(2, '0')}.123Z ${l}`,
  'spaced timestamps': (n, l) => `2026-10-01 12:00:${String(n).padStart(2, '0')},456 ${l}`,
  'clock timestamps': (n, l) => `[12:00:${String(n).padStart(2, '0')}] ${l}`,
  'a CI log': (n, l) => `deploy\tPrint config\t2026-10-01T12:00:${String(n).padStart(2, '0')}.1234567Z ${l}`,
  'cat -e': (n, l) => `${l}$`,
  'cat -A of a CRLF file': (n, l) => `${l}^M$`,
  'cat -v of a CRLF file': (n, l) => `${l}^M`,
  'cat -n -A': (n, l) => `${String(n).padStart(6)}\t${l}$`,
  'grep -n of cat -e': (n, l, match) => `${n}${match ? ':' : '-'}${l}$`,
};

for (const [shape, format] of Object.entries(SHAPES)) {
  test(`M33 R repair 5: ${shape} output in tailLines leaves no line of a block it numbers or decorates`, () => {
    for (const [name, [lines, secrets]] of Object.entries(NUMBERED_ITEMS)) {
      const { tailLines, out } = throughTail(format, lines);
      assert.deepEqual(leaksOf(out.join('\n'), secrets), [], name);
      assert.equal(out[0], tailLines[0], `${name}: a clean line keeps its bytes`);
      assert.equal(out.at(-1), tailLines.at(-1), `${name}: the last line too`);
      assert.ok(out.some((line) => NOTE.test(line)), `${name}: what was dropped is counted`);
    }
  });
}

test('M33 R repair 5: output in those shapes keeps its bytes and declares nothing when nothing is found', () => {
  const outputs = [
    ['3 files changed, 12 insertions(+), 4 deletions(-)', '1 passing (20ms)', '  2 pending'],
    ['   1 │ # Deploy', '   2 │ ', '   3 │ Run `make deploy` from the repo root.'],
    ['  10 | function main() {', '> 11 |   return run(args)', '     |          ^', '  12 | }'],
    ['1) build the image', '(2) push it', '[3] roll out'],
    ['/srv/my deploy/src/app.js:10:3:import x from "./x.js";', '/srv/my deploy/src/app.js-11-const y = 1;'],
    ['C:\\repo\\src\\app.js:10:const a = 1;', '2026-10-01T12:00:01.123Z build started', '[12:00:02] compiled 14 files'],
    ['deploy\tBuild\t2026-10-01T12:00:03.1234567Z npm ci', 'region: eu$', 'replicas: 2^M$', 'done^M', '     4\tlast line$'],
  ];
  for (const tailLines of outputs) {
    const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'make', tailLines }] }));
    assert.deepEqual(ledger.ledger[0].tailLines, tailLines);
    assert.deepEqual(dropped, []);
  }
});

test('M33 R repair 5: a secret every view masks alike keeps its decorated line and is declared once', () => {
  const tailLines = ['first: 1$', `export GH=${GHP} # rotated$`, 'last: 2$'];
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat -e c.sh', tailLines }] }));
  assert.deepEqual(ledger.ledger[0].tailLines, ['first: 1$', 'export GH=‹redacted:github-token› # rotated$', 'last: 2$']);
  assert.deepEqual(dropped.map((d) => d.reason), ['redacted:github-token']);
  // A value a key-name rule masks to the line's end takes the decoration with it in the line as written, and not in
  // the view without it: the views disagree, and the line is dropped (fails closed), never shown with its value.
  const keyed = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat -e c.cfg', tailLines: ['first: 1$', `token = ${GHP}$`, 'last: 2$'] }] }));
  assert.equal(keyed.ledger.ledger[0].tailLines[0], 'first: 1$');
  assert.match(keyed.ledger.ledger[0].tailLines[1], NOTE);
  assert.deepEqual(fragments(keyed.ledger.ledger[0].tailLines.join('\n'), GHP), []);
});

// ---- 4. the UUID rule's pre-filter and lone surrogates ---------------------------------------------------------------

test('M33 R repair 5: a token with a lone surrogate is kept with its UUID only if every reading without it passes', () => {
  // Invented: lone and paired surrogates, a whole UUID, a 22-character run (found by fuzzing the pre-filter).
  const junk = '\ud83e\ud83e\ud83e\ude01\ude01\ude01\ud83d';
  const uuid = 'b2445329-077e-4214-a43a-6ee4dc8429ce';
  const run = 'RraMuxQCdwU8iXL2ync5qK';
  const token = `${junk}/${uuid}/${run}`;
  const reading = `${junk}//${run}`;
  assert.ok(entropy(reading) >= ENTROPY_MIN && reading.length >= 24, 'premise: the reading without the UUID is over the floor');
  const cmd = (t) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `curl -s ${t}` }] })).ledger.ledger[0].cmd;
  assert.equal(cmd(reading), undefined, 'premise: the reading alone is dropped');
  assert.equal(cmd(token), undefined, 'so is the token that holds the UUID');
  const ask = redact(led({ ask: [{ turn: 1, text: `post to ${token} now` }] })).ledger.ask[0].text;
  assert.deepEqual(fragments(ask, run), []);
  // Well-formed text is judged as before: a pair is one character to `entropy`, and a UUID path with an emoji is kept.
  const path = `/tmp/notes-\u{1F600}/${uuid}/report.json`;
  assert.equal(cmd(path), `curl -s ${path}`);
});

// ---- 5. JSON-escaped text on one physical line -----------------------------------------------------------------------

test('M33 R repair 5: an escaped YAML header with an escaped tab before its line break holds its block, in a write\'s arguments', () => {
  for (const eol of ['\t\r\n', '\t\n', ' \t\r\r\n']) {
    const text = ['first: 1', 'signing_key: |', ...WORDS.map((w) => `  ${w}`), 'last: 2'].join(eol);
    const argsExcerpt = JSON.stringify([{ old_string: 'q', new_string: text }]);
    const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'deploy.yaml', argsExcerpt }] })).ledger.ledger[0].argsExcerpt ?? '';
    assert.deepEqual(leaksOf(out, WORDS), [], JSON.stringify(eol));
  }
});

test('M33 R repair 5: a short PEM block in JSON-escaped arguments leaves no line, whatever blanks end its lines', () => {
  for (const eol of [' \n', ' \r\n', '\t\n', '  \r\r\n', '\n']) {
    const text = ['first: 1', BEGIN, ...PEM_SHORT, END, 'last: 2'].join(eol);
    const argsExcerpt = JSON.stringify([{ old_string: 'q', new_string: text }]);
    const { ledger } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'key.pem', argsExcerpt }] }));
    const out = ledger.ledger[0].argsExcerpt ?? '';
    assert.deepEqual(leaksOf(out, PEM_SHORT), [], JSON.stringify(eol));
    if (out) assert.ok(out.includes('last: 2'), `${JSON.stringify(eol)}: what follows the block is kept`);
  }
  // With no END on its line (an excerpt cut before it), the block runs to the end of the line.
  const cut = JSON.stringify([{ old_string: 'q', new_string: [BEGIN, ...PEM_SHORT.slice(0, 2)].join(' \n') }]);
  const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'key.pem', argsExcerpt: cut }] })).ledger.ledger[0].argsExcerpt ?? '';
  assert.deepEqual(leaksOf(out, PEM_SHORT), []);
  // A header in plain text (its line break a real one) is masked as it always was: the header alone.
  const plain = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `grep -l '${BEGIN}' -r keys/` }] })).ledger.ledger[0].cmd;
  assert.equal(plain, "grep -l '‹redacted:private-key›' -r keys/");
});

test('M33 R repair 5: a token split by a continuation escaped three times leaves no fragment, in every line field', () => {
  const thrice = (decoded) => JSON.stringify(JSON.stringify(JSON.stringify({ deploy: decoded })));
  for (const eol of ['\n', '\r\n']) {
    for (let k = 4; k < GHP.length; k += 4) {
      const text = thrice(`curl -H "x: ${GHP.slice(0, k)}\\${eol}  ${GHP.slice(k)}" https://x.test`);
      assert.ok(text.includes('\\\\\\\\\\\\\\\\'), 'premise: the backslash is escaped three times');
      for (const field of ['after', 'tailLines', 'saying', 'argsExcerpt', 'cmd']) {
        assert.deepEqual(fragments(TEXT_FIELDS[field](text), GHP), [], `${JSON.stringify(eol)} | ${field} | split ${k}`);
      }
    }
  }
});

test('M33 R repair 5: a JSON text escaped three times with nothing secret keeps its bytes', () => {
  const text = JSON.stringify(JSON.stringify(JSON.stringify({ build: 'make build \\\n  --target web' })));
  const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'x.json', after: { text, truncated: false, lines: 1 } }] }));
  assert.equal(out.ledger.ledger[0].after.text, text);
  assert.deepEqual(out.dropped, []);
});
