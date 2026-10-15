// W3e-8 — every pattern W3e-8 changes or adds is linear: a megabyte of one line, built to make it
// backtrack or re-scan, finishes in under a second of process CPU time in every field class.
//
// Each input is the worst shape found for one change: runs of the new line heads (an escaped break,
// `;`, `&&`, `||`) before a key; a megabyte of blanks after one; names that start with a digit or a
// dot; runs of references with defaults, nested and unclosed; a quoted header with `=` and escaped
// quotes; values that run into a closing quote; a block key after separators; and the ported layers'
// separators, bounded to the line. The clock is the process's CPU time, as in shape-timing.test.js.
//
// Every input is synthetic and low-entropy. Nothing is printed.

import { test } from 'node:test';
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

const FIELDS = {
  cmd: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text }] })),
  ask: (text) => redact(led({ ask: [{ turn: 1, text }] })),
  body: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'a.cfg', after: { text, truncated: false, lines: 1 } }] })),
  saying: (text) => redact(led({ sayings: [{ turn: 1, text }] })),
  tailLines: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'make', tailLines: text.split('\n') }] })),
  diff: (text) => redact({ ask: [], ledger: [{ turn: 0, diff: text }] }),
};

const ADVERSARIAL = {
  // LINE_HEAD and LINE_START (F231)
  'a run of escaped line starts before a key': fill('\\npassword: a'),
  'a run of escaped line starts before a flag': fill('\\n--token a'),
  'a run of escaped line starts before a user flag': fill('\\n-u a:b'),
  'one escaped line start, a megabyte of value': `\\npassword: ${'a'.repeat(MB)}`,
  'a run of escaped line starts with no key': fill('\\n'),
  'a run of separators before a key': fill('; password: a'),
  'a run of separators before a key, each a sentence': fill('; password: a. '),
  'a run of separators before a key in quotes': fill('; password: "a'),
  'a run of && before a key': fill('&& token: a'),
  'a run of || before an empty assignment': fill('|| TOKEN= a'),
  'one separator, a megabyte of blanks': `;${' '.repeat(MB)}password: a`,
  'a run of separators and blanks': fill(';  '),
  'a megabyte of markers after a separator': `;${fill('>-')}`,
  // KEY_NAME (F232)
  'one digit-led name of a megabyte': `${fill('2a')}=a`,
  // (A dot-led name of dotted words, `.a.a.a…`, is left out: the email pattern is quadratic on a run of
  // `.a` whatever the key-name rule does — measured the same before W3e-8; reported, not in scope.)
  'one dot-led name of a megabyte': `.${'a'.repeat(MB)}: a`,
  'a run of dotted words': fill(' .a.b'),
  'a run of digit-led flags': fill(' -1token a'),
  'a run of timestamps': fill('12:30: '),
  // R, a default inside a reference (F233)
  'a run of defaults': fill('${TOKEN:-a}'),
  'a run of unclosed defaults': fill('${TOKEN:-'),
  'defaults nested in defaults': nest('${TOKEN:-', '}'),
  'defaults nested in references': nest('${TOKEN:-${A}', '}'),
  'one default of a megabyte': `\${TOKEN:-${'a'.repeat(MB)}}`,
  'assignments of nested defaults': nest(' TOKEN=${TOKEN:-', '}'),
  // one placeholder rule (F234)
  'a run of lower-case references': fill('password=$a '),
  'a run of bracketed names': fill('password=<a_token> '),
  'one bracketed name of a megabyte': `password=<${fill('token')}>`,
  'one reference of a megabyte': `password=$${'A'.repeat(MB)}`,
  // QUOTED_HEADER `=`, escaped quotes, closing quotes (W3e-8)
  'a run of quoted spaced assignments': fill('"token = a'),
  'a run of escaped quoted values': fill('"token = \\"a'),
  'an escaped quoted value that never closes': `"token = \\"${'a'.repeat(MB)}`,
  'a run of values into a closing quote': fill('--token a"}'),
  'a run of escaped headers': fill('\\"token: a\\"'),
  'a run of escaped quotes after a generic password': fill('password=\\"a\\"} '),
  // BLOCK_KEY after separators (W3e-8)
  'a run of separators before a block header': `${fill('; a')}; password: |`,
  'a run of block headers after separators': fill('; password: |'),
  'a run of escaped block headers': fill('password: |\\n  a\\n'),
  // the ported layers' separators, bounded to their line
  'a run of db passwords with blanks': fill(' DB_PASSWORD = '),
  'a run of generic passwords with blanks': fill(' password = '),
};

for (const [name, text] of Object.entries(ADVERSARIAL)) {
  test(`W3e-8 linear: ${name} (1 MB, one line) finishes in under a second in every field`, () => {
    for (const [field, through] of Object.entries(FIELDS)) {
      assertLinear(() => through(text), 1000, field);
    }
  });
}

test('W3e-8 linear: a block key after separators, and escaped blocks, over many lines', () => {
  const size = MB / 4;
  for (const text of [`${'a; b && c || '.repeat(size / 14)}password: |\n${'  a\n'.repeat(size / 4)}`,
    `${'; password: |\n  a\n'.repeat(size / 19)}`, `${'x: |\\n  a\\n'.repeat(size / 12)}`]) {
    for (const [field, through] of Object.entries(FIELDS)) {
      if (field === 'tailLines') continue;          // a tail is one entry per line; below
      assertLinear(() => through(text), 1000, field);
    }
    assertLinear(() => FIELDS.tailLines(text.split('\n').slice(0, 4096).join('\n')), 1000, 'tailLines');
  }
});
