// W3d-6 / F169 — redaction never swallows the recorder's truncation stub.
//
// `scrubLines` joins backslash-continued lines before it scans, so a token split across them is
// scanned whole. A capped body whose kept text ends in `\` had the stub's leading newline eaten by
// that join: `…\` + `\n[… truncated at N chars …]` became one line, the adapter (which knows the
// stub only by its leading newline) no longer recognised it, and the recorder's words became
// quotable as the session's code.
//
// Every fixture is synthetic. No real recording is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';
import { buildEvents, ARG_SEP } from '../../slicer/src/events.js';

/** The body cap an earlier Sonah cut at (M33 R to D68 E). Nothing writes its stub any more; a persisted ledger still
 *  carries it, and redaction must keep it standing on a line of its own. */
const BEFORE_CAP = 20_000;
const STUB = `\n[… truncated at ${BEFORE_CAP} chars …]`;
/** The stub exactly as the reader knows it (evidence/adapters/sonah-ledger.js BODY_TRUNCATION). */
const WITH_NEWLINE = /\n\[… truncated at (\d+) chars …\]/g;
const stubs = (text) => [...text.matchAll(WITH_NEWLINE)].length;

const led = (event) => ({ ask: [], ledger: [{ turn: 1, seq: 0, ...event }], claim: { finalMessage: '' }, dropped: [] });
const redactedAfter = (text, extra = {}) =>
  redact(led({ kind: 'edit', path: 'src/run.sh', after: { text, truncated: true, lines: text.split('\n').length, ...extra } }))
    .ledger.ledger[0].after.text;
const redactedBefore = (text) =>
  redact(led({ kind: 'edit', path: 'src/run.sh', before: { text, source: 'read', turn: 1, partial: false, truncated: true } }))
    .ledger.ledger[0].before.text;

/** A kept head of exactly `BEFORE_CAP` chars that ends in `ending`: plain filler lines, then it. */
const headEndingIn = (ending) => {
  const filler = Array.from({ length: 2_000 }, (_, i) => `echo step ${i}`).join('\n');
  return `${filler.slice(0, BEFORE_CAP - ending.length)}${ending}`;
};

// Kept texts that end in a backslash-continuation, in every shape the join rule matches.
const ENDINGS = {
  'a bare backslash': ' \\',
  'a backslash and a newline': ' \\\n',
  'a backslash, a newline and indentation': ' \\\n    ',
  'an escaped backslash': ' \\\\',
  'two continuations': ' \\\n  --flag \\',
};

for (const [name, ending] of Object.entries(ENDINGS)) {
  test(`F169 a kept text ending in ${name} keeps the stub on its own line, byte-identical`, () => {
    const head = headEndingIn(ending);
    // An Edit's written side, cut, then its replaced side (F155's shape), and a whole-capped body.
    for (const text of [`${head}${STUB}${ARG_SEP}const old = 1;`, `${head}${STUB}`]) {
      for (const out of [redactedAfter(text, { parts: 1, priorParts: 1 }), redactedBefore(text)]) {
        assert.equal(stubs(out), 1, 'the stub still carries its leading newline');
        assert.ok(out.split('\n').includes(STUB.slice(1)), 'the stub is a line of its own, byte-identical');
        assert.ok(!/[^\n]\[… truncated at/.test(out), 'no line ever ends glued to the stub');
      }
    }
  });
}

test('F169 a stub-alone segment after a continued segment keeps its newline too', () => {
  // A MultiEdit whose second written segment is past the budget is the stub alone (F155).
  const text = `${headEndingIn(' \\')}${STUB}${ARG_SEP}${STUB}${ARG_SEP}old one${ARG_SEP}old two`;
  const out = redactedAfter(text, { parts: 2, priorParts: 2 });
  assert.equal(stubs(out), 2);
});

test('F169 a secret split across a backslash-continued line is still caught, beside a kept stub', () => {
  // The join exists for this: neither half is a secret on its own line (the head is too short
  // for the entropy floor, the tail is low-entropy), but the logical line carries a token.
  const tail = '0'.repeat(22);
  const split = `const x = "${'ghp'}_ABCDEFGHIJKLMNOPQR\\\n${tail}";`;
  const head = `${split}\n${headEndingIn(' \\').slice(split.length + 1)}`;
  assert.equal(head.length, BEFORE_CAP, 'premise: the kept head is the recorder cap');
  for (const out of [redactedAfter(`${head}${STUB}${ARG_SEP}const old = 1;`, { parts: 1, priorParts: 1 }),
    redactedBefore(`${head}${STUB}`)]) {
    assert.ok(!out.includes(tail), 'the continuation-split token leaks no tail');
    assert.ok(!out.includes('ABCDEFGHIJKLMNOPQR'), 'and no head');
    assert.match(out, /‹redacted:github-token›/, 'it is caught as the token it is');
    assert.equal(stubs(out), 1, 'and the stub still stands on its own line');
  }
});

// ---- W3d-6: every stub the slicer writes survives redaction with its newline ------------------

let seq = 0;
const uid = () => `w3d6r-${String(++seq).padStart(6, '0')}`;
const base = { sessionId: 'sess-w3d6r', cwd: '/repo', version: '2.1.205', isSidechain: false };
const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content: text } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, extra = {}) => ({ ...base, type: 'user', uuid: uid(), ...extra,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const records = (raw) => raw.map((r, i) => ({ kind: r.type, raw: r, line: i + 1, source: 0 }));

test('D68 (E) no stub is written any more: a long body ending in any continuation is kept whole by slicer and redaction', () => {
  const long = (ending) => `${headEndingIn(ending)}\nTAIL_RECORDED\n`;
  const raw = [userTurn('rewrite the scripts')];
  let n = 0;
  for (const ending of ['', ...Object.values(ENDINGS)]) {
    const id = () => `t${++n}`;
    const read = id(), edit = id(), write = id();
    raw.push(
      toolUse(read, 'Read', { file_path: `/repo/s${n}.sh` }), toolResult(read, long(ending)),
      toolUse(edit, 'Edit', { file_path: `/repo/s${n}.sh`, old_string: long(ending), new_string: long(ending) }),
      toolResult(edit, 'The file has been updated.'),
      toolUse(write, 'Write', { file_path: `/repo/w${n}.sh`, content: long(ending) }),
      toolResult(write, 'File created successfully'),
    );
  }
  const { events } = buildEvents(records(raw), { cwd: '/repo' });
  const ledger = { ask: [], ledger: events, claim: { finalMessage: '' }, dropped: [] };
  const out = redact(ledger).ledger.ledger.flatMap((e) => [e.before?.text, e.after?.text]).filter((t) => typeof t === 'string');
  assert.equal(out.reduce((sum, t) => sum + stubs(t), 0), 0, 'no stub is written');
  assert.ok(out.filter((text) => text.includes('TAIL_RECORDED')).length >= 6 * 3, 'every body keeps its tail');
});
