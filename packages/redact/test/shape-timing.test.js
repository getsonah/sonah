// W3e-5 — every pattern W3e-5 adds is linear: a megabyte of one line, built to make it backtrack or
// re-scan, finishes in under a second in every field class.
//
// W3e-4 found a 573 s case: a megabyte of `,token=a` re-scanned the one long word for every match. Each
// input below is the worst shape found for one new pattern (an unclosed quote, a run of keys with no
// separator, a bracket that never closes, a command word repeated with nothing after it, …).
// Measured when written: 15–170 ms each on a laptop; the bound is the spec's, one second.
//
// The clock is the process's CPU time, not the wall: `npm test` runs every test file at once, and
// other work on the machine can stretch a wall clock tenfold without the code doing any more. A
// quadratic pattern costs minutes of CPU on these inputs (W3e-4's case: ten minutes), whatever else
// is running; a linear one costs a small fraction of a second. A busy machine still adds CPU time, so the
// bound is applied through linear-clock.js, which scales it by the slowdown it measures (B7).
//
// Every input is synthetic and low-entropy. Nothing is printed.

import { test } from 'node:test';
import { redact } from '../index.js';
import { assertLinear } from './linear-clock.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const MB = 1 << 20;
/** `unit`, repeated to one megabyte. */
const fill = (unit) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);

/** One field of each class. */
const FIELDS = {
  cmd: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text }] })),
  ask: (text) => redact(led({ ask: [{ turn: 1, text }] })),
  body: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'a.cfg', after: { text, truncated: false, lines: 1 } }] })),
  tailLines: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'make', tailLines: text.split('\n') }] })),
};

const ADVERSARIAL = {
  // Q, quoted keys (F209)
  'a run of JSON keys': fill('{"password":"a",'),
  'a quoted value that never closes': `"password":"${'a'.repeat(MB)}`,
  'quoted keys with no separator': fill('"password"'),
  'escaped JSON keys': fill('{\\"password\\":\\"a\\",'),
  'an escaped value of escaped quotes': `{\\"password\\":\\"${fill('\\\\\\"')}`,
  'unquoted values that never end': fill('{"token": a'),
  'a bracket that never closes': `"token": ${'['.repeat(MB)}`,
  'a run of open arrays': fill('"token": ['),
  'a run of case labels': fill('case "token": '),
  'a megabyte of blanks before a key': `${' '.repeat(MB)}"token": a`,
  // S, URL query parameters (F210)
  'a run of query parameters': fill('?token=a&'),
  'a query value that never ends': `?token=${'a'.repeat(MB)}`,
  'a run of empty parameters': fill('&token='),
  'a run of signatures': fill('&sig=a'),
  // G, glued password flags (F210)
  'a run of command words': fill('mysql '),
  'a run of glued flags': fill('mysql -pa '),
  'one command, a megabyte of flags': `mysql ${fill('-x ')}`,
  'a run of sshpass -p': fill('sshpass -p '),
  'a run of sshpass options': fill('sshpass -f '),
  'a megabyte of path before a command': `${fill('/a')}mysql -pa`,
  // C, cookies (F210)
  'a run of quoted cookie headers': fill('"Cookie: a'),
  'one cookie line of a megabyte': `Cookie: ${fill('a;')}`,
  'a run of cookie keys': fill('{"Cookie": "a'),
  // B, YAML block headers on one line (F210)
  'a run of block headers': fill('password: |'),
  'a run of quoted block headers': fill('"password": |'),
  // F211: a name's segments, the prose words, a container's user ids
  'one name of a megabyte of secret words': `${fill('token')}=a`,
  'one camel-case name of a megabyte of secret words': `${fill('tokenToken')}=a`,
  'one name of a megabyte of ordinary words': `${fill('Tokenizer')}=a`,
  'one name of a megabyte with no secret word': `${fill('aB')}=a`,
  'a run of ordinary-word assignments': fill(' AUTHOR_TOKENS=4096'),
  'a run of flags named in prose': fill(' --token instead'),
  'a run of prose flags glued to a word': fill(' --token insteadx'),
  'a run of user flags': fill(' -u 1:1'),
  'a run of container user flags': fill('docker -u 1:1 '),
  'one container command, a megabyte of user flags': `docker run${fill(' -u 1:1')}`,
};

for (const [name, text] of Object.entries(ADVERSARIAL)) {
  test(`W3e-5 linear: ${name} (1 MB, one line) finishes in under a second in every field`, () => {
    for (const [field, through] of Object.entries(FIELDS)) {
      assertLinear(() => through(text), 1000, field);
    }
  });
}

test('W3e-5 linear: a YAML block of many lines costs what the same lines cost without it', () => {
  // B over lines: one key, a quarter megabyte of lines it holds. The per-line machinery that every
  // multi-line field already runs is the cost; the block adds one pass.
  const size = MB / 4;
  const text = `password: |\n${'  a\n'.repeat(size / 4)}`;
  for (const [field, through] of Object.entries(FIELDS)) {
    if (field === 'tailLines') continue;          // a tail is one entry per line; its own test below
    assertLinear(() => through(text), 1000, field);
  }
  assertLinear(() => FIELDS.tailLines(`password: |\n${'  a\n'.repeat(4096)}`), 1000, 'tailLines');
});
