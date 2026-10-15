// W3e-7 — every pattern W3e-7 changes or adds is linear: a megabyte of one line, built to make it
// backtrack or re-scan, finishes in under a second of process CPU time in every field class.
//
// Each input is the worst shape found for one change: a diff marker before a run of flags (F219), a
// block key behind a marker over many lines, a run of placeholder words and of references (F220), a
// run of curl commands and cookie flags, an unclosed quote after `-b` (F221). The clock is the
// process's CPU time, as in shape-timing.test.js: `npm test` runs every file at once, and a wall clock
// measures the machine as much as the code. A quadratic pattern costs minutes on these inputs.
//
// Every input is synthetic and low-entropy. Nothing is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';
import { assertLinear } from './linear-clock.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const MB = 1 << 20;
/** `unit`, repeated to one megabyte. */
const fill = (unit) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
/** `open` repeated, then `close` as often: one megabyte, nested. */
const nest = (open, close) => {
  const n = Math.floor(MB / (open.length + close.length));
  return open.repeat(n) + close.repeat(n);
};

/** One field of each class, and the diff. */
const FIELDS = {
  cmd: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text }] })),
  ask: (text) => redact(led({ ask: [{ turn: 1, text }] })),
  body: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'a.cfg', after: { text, truncated: false, lines: 1 } }] })),
  tailLines: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'make', tailLines: text.split('\n') }] })),
  diff: (text) => redact({ ask: [], ledger: [{ turn: 0, diff: text }] }),
};

const ADVERSARIAL = {
  // F219: the diff marker at a line start, before each anchored shape
  'a marker before a run of flags': `+${fill('--token a ')}`,
  'a run of marked flags': fill('+--token a '),
  'a marker before a run of user flags': `-${fill('-u a:b ')}`,
  'a run of escaped line starts and markers': fill('\\n+API_TOKEN=a'),
  'a marker before a generic password that never ends': `+password=${'a'.repeat(MB)}`,
  'a run of marked generic passwords': fill('+password=a '),
  'a run of marked block headers': fill('+password: |'),
  // F220: whole-value placeholders, sentence ends, references
  'a run of placeholder words after a key': `password: ${fill('none ')}`,
  'a run of sentence marks after a key': `password: ${fill('... ')}`,
  'a run of reference assignments': fill('API_TOKEN=${A} '),
  'one reference word of a megabyte': `API_TOKEN=\${${'A'.repeat(MB)}} x`,
  'a run of quoted headers with placeholder words': fill('"X-Api-Key: none '),
  // F221: curl's cookie flag
  'a run of curl commands': fill('curl '),
  'a run of cookie flags': fill('curl -b a=b '),
  'one curl, a megabyte of cookie flags': `curl ${fill('-b a=b ')}`,
  'one curl, a megabyte of short flag runs': `curl ${fill('-sSb ')}`,
  'one curl, a megabyte of glued cookies': `curl ${fill('-bx=y ')}`,
  'an unclosed quote after -b': `curl -b '${'a'.repeat(MB)}`,
  'a run of unclosed quotes after -b': fill("curl -b 'a"),
  'a cookie of a megabyte': `curl --cookie=${fill('a=')}`,
  'a megabyte of path before curl': `${fill('/a')}curl -b a=b`,
  // F223: the user flag's password half, a substitution
  'a run of user flags with substitutions': fill(' -u $(a):$(b)'),
  'a run of user flags with unclosed substitutions': fill(' -u $('),
  'a run of user flags, each an unclosed reference': fill(' -u a:${'),
  'one substitution of a megabyte': ` -u a:$(${'('.repeat(MB / 2 - 8)}${')'.repeat(MB / 2 - 8)})`,
  'one backquoted substitution of a megabyte': ` -u a:\`${'a'.repeat(MB)}\``,
  'user flags nested in balanced substitutions': ` -u a:${nest(' -u a:$(', ')')}`,
  // A value kept as a placeholder that runs to the line's end, under every later match on the line:
  // before the scan bound applied to it, each of these cost about a minute.
  'user flags nested in references': nest(' -u a:${', '}'),
  'token flags nested in references': nest(' --token ${', '}'),
  'assignments nested in references': nest(' TOKEN=${', '}'),
  // F224: booleans in the ported layers
  'a run of boolean passwords': fill('password=true '),
  'a run of boolean database passwords': fill(' DB_PASSWORD=false'),
  'a run of glued booleans': fill('password=truefalse'),
};

for (const [name, text] of Object.entries(ADVERSARIAL)) {
  test(`W3e-7 linear: ${name} (1 MB, one line) finishes in under a second in every field`, () => {
    for (const [field, through] of Object.entries(FIELDS)) {
      assertLinear(() => through(text), 1000, field);
    }
  });
}

test('W3e-7 a value past the scan bound is masked, not judged a placeholder or a substitution (fail closed)', () => {
  // MAX_KEYED_VALUE: a value that runs on past the bound is masked to the end of its line. A value of
  // that length kept as `${…}` or `$(…)` was the quadratic case above; it is masked now, and no
  // shorter value changes.
  const MASK = '‹redacted:secret-value›';
  const cmd = (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text }] })).ledger.ledger[0].cmd;
  const long = 'a'.repeat(1100);
  assert.equal(cmd(`deploy --token \${${long}}`), `deploy --token ${MASK}`);
  assert.equal(cmd(`curl -u admin:$(printf ${long}) https://api.example.test/v1`), `curl -u admin:${MASK}`);
  assert.equal(cmd(`TOKEN=\${${long}} ./deploy.sh`), `TOKEN=${MASK}`);
  // The same shapes at an ordinary length are what they were: placeholders and substitutions, kept.
  for (const text of ['deploy --token ${DEPLOY_TOKEN}', 'curl -u admin:$(printf abc) https://api.example.test/v1',
    'TOKEN=${TOKEN} ./deploy.sh']) assert.equal(cmd(text), text);
});

test('W3e-7 linear: a YAML block behind diff markers costs what the same lines cost without them', () => {
  // F219: a block key read behind its marker, a quarter megabyte of lines its block holds; and a context
  // key, read both ways.
  const size = MB / 4;
  for (const text of [`+password: |\n${'+  a\n'.repeat(size / 5)}`, ` password: |\n${'+  a\n'.repeat(size / 5)}`,
    `${' password: |\n'.repeat(size / 13)}`, `${'+password: |\n+\n'.repeat(size / 15)}`]) {
    for (const [field, through] of Object.entries(FIELDS)) {
      if (field === 'tailLines') continue;          // a tail is one entry per line; below
      assertLinear(() => through(text), 1000, field);
    }
    const lines = text.split('\n').slice(0, 4096).join('\n');
    assertLinear(() => FIELDS.tailLines(lines), 1000, 'tailLines');
  }
});
