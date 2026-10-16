// The pre-edit channel's carrier: first version per edited path, from the session only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachBefore, stripLineNumbers, unwrapReadResult } from '../src/before.js';
import { redact } from '../../redact/index.js';

test('numbered Read output is un-numbered; plain output is left alone; reminders are stripped', () => {
  assert.equal(stripLineNumbers('     1\tfoo\n     2\tbar\n<system-reminder>x</system-reminder>'), 'foo\nbar');
  assert.equal(stripLineNumbers('foo\nbar'), 'foo\nbar');
  assert.equal(stripLineNumbers('1\tone numbered\nplain\nplain\nplain'), '1\tone numbered\nplain\nplain\nplain', 'below the 80% bar nothing is stripped');
});

test('the LATEST read BEFORE the first edit becomes before.source=read; transient text is deleted everywhere', () => {
  const events = [
    { turn: 1, seq: 0, kind: 'read', path: 'src/a.py', _readText: '     1\tdef a():\n     2\t    return 1\n' },
    { turn: 1, seq: 1, kind: 'read', path: 'src/never_edited.py', _readText: 'secret-ish content' },
    { turn: 2, seq: 0, kind: 'read', path: 'src/a.py', _readText: '     1\tdef a():\n     2\t    return 2\n' },
    { turn: 2, seq: 1, kind: 'edit', path: 'src/a.py', diff: '-return 1\n+return 2' },
    { turn: 3, seq: 0, kind: 'edit', path: 'src/a.py', diff: '-return 2\n+return 3' },
  ];
  attachBefore(events);
  // M36 phase 2 review (critique c1): `turn` and `seq` name the Read that recorded the state.
  assert.deepEqual(events[3].before, { text: 'def a():\n    return 2', source: 'read', turn: 2, seq: 0, partial: false,
    truncated: false, lines: 2 });
  assert.equal(events[4].before, undefined, 'only the FIRST edit of a path carries the snapshot');
  assert.ok(events.every((e) => !('_readText' in e) && !('_body' in e)), 'no transient content survives');
  assert.equal(events[1].before, undefined, 'a never-edited read keeps nothing');
});

test('a file created in-session carries its first Write as before.source=write; partial reads are labeled; a long body is kept whole', () => {
  const big = Array.from({ length: 2400 }, (_, i) => `line ${i}`).join('\n');
  const events = [
    { turn: 1, seq: 0, kind: 'create', path: 'new.py', diff: '+x', _body: 'print(1)\n', _writeType: 'create' },
    { turn: 2, seq: 0, kind: 'edit', path: 'new.py', diff: '-1\n+2' },
    { turn: 2, seq: 1, kind: 'read', path: 'big.py', offset: 100, limit: 50, _readText: big },
    { turn: 2, seq: 2, kind: 'edit', path: 'big.py', diff: '+y' },
  ];
  attachBefore(events);
  assert.equal(events[0].before.source, 'write');
  assert.equal(events[0].before.text, 'print(1)\n');
  assert.equal(events[1].before, undefined);
  assert.equal(events[3].before.partial, true);
  // D68 (E): the slicer keeps the body whole and redaction scrubs it whole; nothing cuts it (the window budget is the
  // only bound).
  assert.equal(events[3].before.text, big);
  assert.equal(events[3].before.truncated, false);
  const kept = redact({ ask: [], ledger: [events[3]], claim: {} }).ledger.ledger[0].before;
  assert.equal(kept.truncated, false);
  assert.equal(kept.text, big);
  assert.doesNotMatch(kept.text, /truncated at \d+ chars/);
});

test('a Read result recorded as a flattened toolUseResult object is unwrapped to its content', () => {
  const json = JSON.stringify({ type: 'text', file: { filePath: '/x/a.py', content: 'def a():\n    return 1\n', numLines: 2, startLine: 1 } });
  assert.equal(unwrapReadResult(json), 'def a():\n    return 1\n');
  assert.equal(unwrapReadResult('plain text {not json'), 'plain text {not json');
  const events = [
    { turn: 1, seq: 0, kind: 'read', path: '/x/a.py', offset: 1, limit: 2, _readText: json },
    { turn: 2, seq: 0, kind: 'edit', path: '/x/a.py', diff: '-1\n+2' },
  ];
  attachBefore(events);
  assert.equal(events[1].before.text, 'def a():\n    return 1');
  assert.equal(events[1].before.lines, 2);
  assert.equal(events[1].before.partial, true);
});

test('SECURITY REVIEW: image blocks are never retained; a JSON-recorded Read unwraps before the retention cap', async () => {
  const { toolResultsOf } = await import('../src/records.js');
  const rec = { message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'img', content: [{ type: 'image', source: { type: 'base64', data: 'QUJD'.repeat(40) } }] },
    { type: 'tool_result', tool_use_id: 'txt', content: [{ type: 'text', text: 'hello' }] },
  ] } };
  const m = toolResultsOf(rec);
  assert.equal(m.get('img').nonText, true); assert.equal(m.get('img').text, '', 'no base64 reaches text');
  assert.equal(m.get('txt').nonText, false); assert.equal(m.get('txt').text, 'hello');
});

test('the source ladder: originalFile beats a read beats a write body; update-typed writes without a source get nothing; errored reads never count', () => {
  const events = [
    { turn: 1, seq: 0, kind: 'read', path: 'a.py', _readText: 'READ VERSION' },
    { turn: 2, seq: 0, kind: 'edit', path: 'a.py', diff: '+x', _orig: 'ORIGINAL VERSION' },
    { turn: 2, seq: 1, kind: 'read', path: 'b.py', isError: true, _readText: 'should not be used' },
    { turn: 3, seq: 0, kind: 'create', path: 'b.py', diff: '+y', _body: 'BODY', _writeType: 'update' },
    { turn: 3, seq: 1, kind: 'create', path: 'c.py', diff: '+z', _body: 'C BODY' },
    { turn: 3, seq: 2, kind: 'edit', path: 'scratch/x.py', diff: '+w', external: true, _orig: 'never' },
  ];
  attachBefore(events);
  assert.equal(events[1].before.source, 'original'); assert.equal(events[1].before.text, 'ORIGINAL VERSION');
  assert.equal(events[3].before, undefined, 'an update with no original and no good read has no before');
  assert.equal(events[4].before.source, 'write'); assert.equal(events[4].before.unknownPrior, true);
  assert.equal(events[5].before, undefined, 'external paths never carry content');
  assert.ok(events.every((e) => !('_orig' in e) && !('_writeType' in e) && !('_readMeta' in e)));
});

test('D90: a credential-shaped path gets its prior state as any path does; a long or JSON-looking read is a prior state; the tool window sets partial', () => {
  const events = [
    { turn: 1, seq: 0, kind: 'read', path: '.env', _readText: 'KEY=1' },
    { turn: 1, seq: 1, kind: 'edit', path: '.env', diff: '+KEY=2' },
    { turn: 1, seq: 2, kind: 'read', path: 'w.py', _readText: 'line\n'.repeat(3), _readMeta: { startLine: 10, numLines: 3, totalLines: 100 } },
    { turn: 1, seq: 3, kind: 'edit', path: 'w.py', diff: '+q' },
    { turn: 1, seq: 4, kind: 'read', path: 'j.py', _readText: '{"type":"text","file":{"filePath":"x"}}' + 'x'.repeat(2100) },
    { turn: 1, seq: 5, kind: 'edit', path: 'j.py', diff: '+q' },
  ];
  attachBefore(events);
  // D90 (owner decision 2026-10-15): nothing is withheld for its path (D68 R withheld a credential-shaped one's).
  assert.equal(events[1].before.withheld, undefined);
  assert.deepEqual([events[1].before.source, events[1].before.text], ['read', 'KEY=1']);
  assert.equal(events[3].before.partial, true); assert.deepEqual(events[3].before.window, { from: 10, to: 12, total: 100 });
  // D69 review (F6): no prior state is withheld for what its text looks like (`looksUnreadable`, deleted: a `{"type"`
  // opening or one line over 2,000 characters, a rule no recorder documents). The read text is the prior state, as recorded.
  assert.equal(events[5].before.withheld, undefined);
  assert.equal(events[5].before.source, 'read');
  assert.equal(events[5].before.text, '{"type":"text","file":{"filePath":"x"}}' + 'x'.repeat(2100));
  const minified = [{ turn: 1, seq: 0, kind: 'edit', path: 'app.min.js', diff: '+q', _orig: `var a=1;${'b=2;'.repeat(900)}` }];
  attachBefore(minified);
  assert.equal(minified[0].before.source, 'original', 'a minified one-line file is a prior state too');
});

test('M36 phase 2 review (c1): a prior state names the event that recorded it; a typed window decides whether a read was part', () => {
  const events = [
    { turn: 1, seq: 0, kind: 'read', path: 'a.js', offset: 1, limit: 2000, _readText: 'one\ntwo', _readPlain: true,
      _readMeta: { startLine: 1, numLines: 2, totalLines: 2 } },
    { turn: 1, seq: 1, kind: 'edit', path: 'a.js', diff: '+x' },
    { turn: 1, seq: 2, kind: 'read', path: 'b.js', _readText: 'l100\nl101', _readPlain: true,
      _readMeta: { startLine: 100, numLines: 2, totalLines: 600 } },
    { turn: 1, seq: 3, kind: 'edit', path: 'b.js', diff: '+y' },
    { turn: 2, seq: 0, kind: 'edit', path: 'c.js', diff: '+z', _orig: 'whole\nfile' },
  ];
  attachBefore(events);
  assert.deepEqual([events[1].before.turn, events[1].before.seq, events[1].before.partial, events[1].before.window],
    [1, 0, false, undefined], 'a typed whole read with a limit past the end is the whole file');
  assert.deepEqual([events[3].before.seq, events[3].before.partial, events[3].before.window],
    [2, true, { from: 100, to: 101, total: 600 }]);
  assert.deepEqual([events[4].before.source, events[4].before.turn, events[4].before.seq], ['original', 2, 0],
    'the recorder kept the file with the call itself');
});
