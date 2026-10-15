// Synthetic Codex recordings only (invented content). C-02 "M33 wrapper and row amendments":
// (1) the integer index loop's untouched spread envelope, (2) shorthand properties, (3) String.raw
// literals, (4) the strict turn_aborted interrupt boundary and (5) a joined poll whose own result
// is unattributable. The static reader never executes any wrapper source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readExecCalls, execResults } from '../src/codex-exec.js';
import { readCodexSession } from '../src/codex.js';
import { sliceLineage } from '../index.js';
import * as slicerEvents from '../src/events.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { scratchDir } from './scratch-dir.js';

const rec = (payload) => JSON.stringify({ type: 'response_item', payload });
const complete = (...values) => [{ type: 'input_text', text: 'Script completed\nWall time: 0.1 seconds' },
  ...values.map((value) => ({ type: 'input_text', text: typeof value === 'string' ? value : JSON.stringify(value) }))];
const call = (input, call_id = 'wrapper') => rec({ type: 'custom_tool_call', name: 'exec', call_id, input });
const result = (output, call_id = 'wrapper') => rec({ type: 'custom_tool_call_output', call_id, output });
async function fixture(lines) {
  const dir = await scratchDir('m33-parser-');
  const file = join(dir, 'rollout-2026-09-10T12-00-00-synthetic.jsonl');
  await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'synthetic', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: 'Run the checks.' }), ...lines].join('\n'), { mode: 0o600 });
  return file;
}
const observations = (ledger) => sessionFromLedger(redact(ledger).ledger, { sessionKey: 'synthetic' })
  .events.filter((event) => event.kind === 'observation')
  .map((event) => [event.result, event.exitCode, event.terminalStatusProven === true]);
const mapped = (source, outputs) => execResults(complete(...outputs), readExecCalls(source)).results;

// ---------------------------------------------------------------------------------------------
// (1) Integer index loop with the untouched spread envelope.
// ---------------------------------------------------------------------------------------------
const loopPrefix = 'const results = await Promise.allSettled([tools.exec_command({cmd: "npm test"}), '
  + 'tools.exec_command({cmd: "npm run lint"})]);\n';
const loopOutputs = [
  { i: 0, status: 'fulfilled', value: { wall_time_seconds: 1, exit_code: 0, output: 'ok\n' } },
  { i: 1, status: 'fulfilled', value: { wall_time_seconds: 1, exit_code: 2, output: 'lint error\n' } },
];

test('P1: the canonical integer index loop maps the untouched spread envelope by its recorded index', async () => {
  const source = loopPrefix + 'for (let i = 0; i < results.length; i++) text(JSON.stringify({i, ...results[i]}));';
  const parsed = readExecCalls(source);
  assert.equal(parsed.unsupported, 0);
  assert.equal(parsed.emissionsExact, true);
  assert.equal(parsed.emissions.length, 2);
  const results = execResults(complete(...loopOutputs), parsed).results;
  assert.deepEqual([...results.keys()], [0, 1]);
  assert.deepEqual([results.get(0).value.exit_code, results.get(1).value.exit_code], [0, 2]);

  const ledger = await sliceLineage([await fixture([call(source), result(complete(...loopOutputs))])]);
  assert.deepEqual(ledger.ledger.map((event) => [event.cmd, event.exitCode, event.outcome]),
    [['npm test', 0, 'passed'], ['npm run lint', 2, 'failed']]);
  assert.equal(ledger.capture.unmapped, 0);
  assert.equal(ledger.capture.unsupported, 0);
  assert.deepEqual(observations(ledger), [['succeeded', 0, true], ['failed', 2, true]]);
});

test('P1: any single index name, a braced body, the plain i form and a rejected entry keep the same rules', async () => {
  for (const emitter of [
    'for (let k = 0; k < results.length; k++) text(JSON.stringify({k, ...results[k]}));',
    'for (let index = 0; index < results.length; index++) { text(JSON.stringify({index, ...results[index]})); }',
    'for (let i = 0; i < results.length; i++) text({i, ...results[i]});',
  ]) {
    const key = /let (\w+)/.exec(emitter)[1];
    const outputs = [
      { [key]: 0, status: 'fulfilled', value: { output: 'ok', exit_code: 0 } },
      { [key]: 1, status: 'rejected', reason: 'invocation failed' },
    ];
    const parsed = readExecCalls(loopPrefix + emitter);
    assert.equal(parsed.unsupported, 0, emitter);
    const results = execResults(complete(...outputs), parsed).results;
    assert.equal(results.get(0)?.value.exit_code, 0, emitter);
    assert.deepEqual(results.get(1)?.value, { output: '', is_error: true }, emitter);
  }
});

test('P1 near misses: alias, mutation, changed envelope, extra key and non-canonical loops map nothing', () => {
  const changed = [
    // alias of the settled results
    'const alias = results; for (let i = 0; i < alias.length; i++) text(JSON.stringify({i, ...alias[i]}));',
    // mutation before or inside the loop
    'results.reverse(); for (let i = 0; i < results.length; i++) text(JSON.stringify({i, ...results[i]}));',
    'for (let i = 0; i < results.length; i++) { text(JSON.stringify({i, ...results[i]})); results.reverse(); }',
    // changed envelope
    'for (let i = 0; i < results.length; i++) text(JSON.stringify({i, ...results[i], status: "fulfilled"}));',
    'for (let i = 0; i < results.length; i++) text(JSON.stringify({...results[i], i}));',
    'for (let i = 0; i < results.length; i++) text(JSON.stringify({i, ...results[i].value}));',
    'for (let i = 0; i < results.length; i++) text(JSON.stringify({i, ...results[i + 1]}));',
    'for (let i = 0; i < results.length; i++) text(JSON.stringify({index: i, ...results[i]}));',
    'for (let i = 0; i < results.length; i++) text(JSON.stringify({i, ...results["i"]}));',
    // extra key
    'for (let i = 0; i < results.length; i++) text(JSON.stringify({i, extra: 1, ...results[i]}));',
    // non-canonical loop
    'for (let i = 0; i <= results.length; i++) text(JSON.stringify({i, ...results[i]}));',
    'for (let i = 1; i < results.length; i++) text(JSON.stringify({i, ...results[i]}));',
    'for (let i = 0; i < results.length; i += 1) text(JSON.stringify({i, ...results[i]}));',
    'for (let i = 0; i < results.length; ++i) text(JSON.stringify({i, ...results[i]}));',
    'for (var i = 0; i < results.length; i++) text(JSON.stringify({i, ...results[i]}));',
    // the plain (non-JSON) envelope keeps the forEach rule: only the index name i
    'for (let k = 0; k < results.length; k++) text({k, ...results[k]});',
    // an index name that collides with an envelope key
    'for (let status = 0; status < results.length; status++) text(JSON.stringify({status, ...results[status]}));',
  ];
  for (const emitter of changed) {
    const key = /let (\w+)|var (\w+)/.exec(emitter)?.slice(1).find(Boolean) ?? 'i';
    const outputs = loopOutputs.map(({ i, ...rest }) => ({ [key]: i, ...rest }));
    assert.equal(mapped(loopPrefix + emitter, outputs).size, 0, emitter);
  }
});

test('P1 near misses: a missing, repeated, reordered or extra-key index block maps nothing', () => {
  const source = loopPrefix + 'for (let i = 0; i < results.length; i++) text(JSON.stringify({i, ...results[i]}));';
  const [first, second] = loopOutputs;
  for (const outputs of [
    [first],
    [second, first],
    [first, first],
    [{ ...first, extra: true }, second],
    [{ ...first, status: 'rejected' }, second],
    ['{"i":0,"i":0,"status":"fulfilled","value":{"exit_code":0,"output":"ok"}}', JSON.stringify(second)],
    ['{"i":0,"status":"fulfilled","status":"rejected","value":{"exit_code":0,"output":"ok"}}', JSON.stringify(second)],
  ]) assert.equal(mapped(source, outputs).size, 0, JSON.stringify(outputs));
});

// ---------------------------------------------------------------------------------------------
// (2) Shorthand property {name} === {name: name}.
// ---------------------------------------------------------------------------------------------
test('P2: a shorthand property of a const literal is exactly the explicit identifier value', async () => {
  const source = 'const cmd = "npm test";\nconst r = await tools.exec_command({cmd, yield_time_ms: 1000});\ntext(r);';
  const parsed = readExecCalls(source);
  assert.equal(parsed.unsupported, 0);
  assert.deepEqual(parsed.calls.map((c) => [c.name, { ...c.input }, c.awaited]),
    [['exec_command', { cmd: 'npm test', yield_time_ms: 1000 }, true]]);
  const explicit = readExecCalls(source.replace('{cmd,', '{cmd: cmd,'));
  assert.deepEqual(parsed.calls.map((c) => ({ ...c.input })), explicit.calls.map((c) => ({ ...c.input })));
  for (const [shorthand, spelled] of [
    ['const cmd = "a"; const workdir = "/repo"; text(await tools.exec_command({cmd, workdir}));',
      'const cmd = "a"; const workdir = "/repo"; text(await tools.exec_command({cmd: cmd, workdir: workdir}));'],
    ['let cmd = "a"; text(await tools.exec_command({cmd}));', 'let cmd = "a"; text(await tools.exec_command({cmd: cmd}));'],
    ['const cmd = "a"; text(await tools.exec_command({cmd,}));', 'const cmd = "a"; text(await tools.exec_command({cmd: cmd,}));'],
    ['const cmd = "a"; const s = await Promise.allSettled([tools.exec_command({cmd})]); text(s);',
      'const cmd = "a"; const s = await Promise.allSettled([tools.exec_command({cmd: cmd})]); text(s);'],
  ]) {
    const a = readExecCalls(shorthand); const b = readExecCalls(spelled);
    assert.equal(a.calls.length, 1, shorthand);
    assert.deepEqual(a.calls.map((c) => ({ ...c.input })), b.calls.map((c) => ({ ...c.input })), shorthand);
    assert.equal(a.unsupported, b.unsupported, shorthand);
  }
  const ledger = await sliceLineage([await fixture([call(source),
    result(complete({ wall_time_seconds: 1, exit_code: 0, output: 'ok\n' }))])]);
  assert.deepEqual(ledger.ledger.map((event) => [event.cmd, event.exitCode, event.outcome]), [['npm test', 0, 'passed']]);
  assert.equal(ledger.capture.unsupported, 0);
  assert.deepEqual(observations(ledger), [['succeeded', 0, true]]);
});

test('P2 near misses: unbound, prototype-named, reassigned or non-literal shorthand fails where the value would', () => {
  for (const source of [
    'text(await tools.exec_command({cmd}));',
    'const r = await tools.exec_command({cmd}); const cmd = "late";',
    'const __proto__ = "x"; text(await tools.exec_command({cmd: "a", __proto__}));',
    'const toString = "x"; text(await tools.exec_command({cmd: "a", toString}));',
    'const constructor = "x"; text(await tools.exec_command({constructor}));',
    'let cmd = "npm test"; cmd = "rm -rf build"; text(await tools.exec_command({cmd}));',
    'text(await tools.exec_command({text}));',
    'text(await tools.exec_command({tools}));',
    'text(await tools.exec_command({JSON}));',
  ]) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0, source);
    assert.ok(parsed.unsupported > 0, source);
  }
  const nonLiteral = readExecCalls('const cmd = await tools.exec_command({cmd: "a"}); text(await tools.exec_command({cmd}));');
  assert.equal(nonLiteral.calls.length, 1, 'a call result is not a literal argument');
  assert.ok(nonLiteral.unsupported > 0);
  // Inside the M30 literal map, a field other than the parameter must still be a literal.
  const map = readExecCalls('const workdir = "/repo";\nconst commands = ["a"];\n'
    + 'const results = await Promise.allSettled(commands.map(cmd => tools.exec_command({cmd, workdir})));');
  assert.equal(map.calls.length, 0);
  assert.ok(map.unsupported > 0);
});

// ---------------------------------------------------------------------------------------------
// (3) String.raw`...` without substitution is its raw source text.
// ---------------------------------------------------------------------------------------------
test('P3: String.raw without substitution keeps raw backslashes and reads CR/CRLF as LF', async () => {
  const source = 'const cmd = String.raw`grep -n "a\\.b" src/x.js`;\nconst r = await tools.exec_command({cmd: cmd});\ntext(r);';
  const parsed = readExecCalls(source);
  assert.equal(parsed.unsupported, 0);
  assert.deepEqual(parsed.calls.map((c) => c.input.cmd), ['grep -n "a\\.b" src/x.js']);
  const direct = readExecCalls('text(await tools.exec_command({cmd: String.raw`printf "%s\\n" \\d+`}));');
  assert.deepEqual(direct.calls.map((c) => c.input.cmd), ['printf "%s\\n" \\d+']);
  const lines = readExecCalls('text(await tools.exec_command({cmd: String.raw`one\r\ntwo\rthree\nfour`}));');
  assert.deepEqual(lines.calls.map((c) => c.input.cmd), ['one\ntwo\nthree\nfour']);
  const spaced = readExecCalls('text(await tools.exec_command({cmd: String.raw\n`x\\y`}));');
  assert.deepEqual(spaced.calls.map((c) => c.input.cmd), ['x\\y']);
  // It is a string literal wherever one is read, including an M30 literal-map array item.
  const map = readExecCalls('const commands = [String.raw`rg "a\\.b"`, "npm test"];\n'
    + 'const results = await Promise.allSettled(commands.map(cmd => tools.exec_command({cmd})));\n'
    + 'results.forEach((r, i) => text(JSON.stringify({i, ...r})));');
  assert.equal(map.unsupported, 0);
  assert.deepEqual(map.calls.map((c) => c.input.cmd), ['rg "a\\.b"', 'npm test']);

  const ledger = await sliceLineage([await fixture([call(source),
    result(complete({ wall_time_seconds: 1, exit_code: 1, output: '' }))])]);
  assert.deepEqual(ledger.ledger.map((event) => [event.cmd, event.exitCode, event.outcome]),
    [['grep -n "a\\.b" src/x.js', 1, 'failed']]);
  assert.equal(ledger.capture.unsupported, 0);
  assert.deepEqual(observations(ledger), [['failed', 1, true]]);
});

test('P3 near misses: substitution, a String binding anywhere, another tag or a nested template stay unproved', () => {
  for (const source of [
    'text(await tools.exec_command({cmd: String.raw`a${"b"}c`}));',
    'text(await tools.exec_command({cmd: String.raw`a${`b`}c`}));',
    'text(await tools.exec_command({cmd: String.raw`a`})); const String = globalThis.Object;',
    'text(await tools.exec_command({cmd: String.raw`a`})); function String() {}',
    'text(await tools.exec_command({cmd: String.raw`a`})); class String {}',
    'text(await tools.exec_command({cmd: String.raw`a`})); const f = () => { var String = 1; return String; };',
    'text(await tools.exec_command({cmd: String.row`a`}));',
    'text(await tools.exec_command({cmd: (String.raw)`a`}));',
    'text(await tools.exec_command({cmd: JSON.raw`a`}));',
    'text(await tools.exec_command({cmd: String.raw.call`a`}));',
    'const tag = String.raw; text(await tools.exec_command({cmd: tag`a`}));',
    'const o = {String: {raw: 1}}; text(await tools.exec_command({cmd: o.String.raw`a`}));',
    'text(await tools.exec_command({cmd: String.raw`a``b`}));',
    'text(await tools.exec_command({cmd: String.raw`a`.trim}));',
  ]) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0, source);
    assert.ok(parsed.unsupported > 0, source);
  }
  // A quoted string after String.raw on the next line is not a tag (ASI ends the statement).
  const asi = readExecCalls('const s = String.raw\n"x"\ntext(await tools.exec_command({cmd: "a"}));');
  assert.equal(asi.calls.length, 0);
  assert.ok(asi.unsupported > 0, 'the unread call stays a declared gap');
});

// ---------------------------------------------------------------------------------------------
// (4) Strict event_msg turn_aborted is an interrupt boundary for that turn.
// ---------------------------------------------------------------------------------------------
const aborted = (payload) => JSON.stringify({ type: 'event_msg', payload: { type: 'turn_aborted', ...payload } });
const ERROR_SENTINEL = 'SYNTHETIC_ABORT_ERROR_TEXT_7f3a';
const { MARK_SOURCES } = slicerEvents;
// C-01 event identity: the mark is named by its own row (a turn_aborted row records no id: its line).
const typedMark = ({ turn = 1, stream = 0, record, beforeEvent }) => ({ turn, kind: 'interrupt',
  source: MARK_SOURCES.codexTurnAborted, stream, record, beforeEvent, identity: { stream, record, sub: 'interrupt' } });

test('P4: each typed turn_aborted reason is an interrupt mark with no capture gap and no promoted text', async () => {
  for (const reason of ['interrupted', 'replaced', 'review_ended', 'budget_limited']) {
    const file = await fixture([
      call('text(await tools.exec_command({cmd: "npm test"}));'),
      result(complete({ wall_time_seconds: 1, exit_code: 0, output: 'ok\n' })),
      aborted({ turn_id: 'turn-1', reason, error: { message: ERROR_SENTINEL }, started_at: 1, completed_at: 2, duration_ms: 1000 }),
    ]);
    const { meta } = await readCodexSession(file);
    assert.equal(meta.capture.unsupported, 0, reason);
    assert.equal(meta.capture.incomplete, false, reason);
    const ledger = await sliceLineage([file]);
    // C-02 M33 (4) refreeze: the typed row's mark carries its closed source and row position.
    assert.deepEqual(ledger.marks, [typedMark({ record: 5, beforeEvent: 1 })], reason);
    assert.ok(!(ledger.capture?.reasons ?? []).includes('capture_incomplete'), reason);
    assert.equal(ledger.commentary.length, 0, reason);
    assert.ok(!JSON.stringify(ledger).includes(ERROR_SENTINEL), `${reason}: error text is never promoted`);
    // No outcome inference: the call keeps exactly its own typed result.
    assert.deepEqual(ledger.ledger.map((event) => [event.cmd, event.exitCode, event.outcome]), [['npm test', 0, 'passed']]);
  }
  // Minimal row (only the required fields) and null optional fields are typed too.
  for (const payload of [{ turn_id: 't', reason: 'interrupted' },
    { turn_id: 't', reason: 'interrupted', error: null, started_at: null, completed_at: null, duration_ms: null }]) {
    const ledger = await sliceLineage([await fixture([aborted(payload)])]);
    assert.deepEqual(ledger.marks, [typedMark({ record: 3, beforeEvent: 0 })], JSON.stringify(payload));
    assert.ok(!(ledger.capture?.reasons ?? []).includes('capture_incomplete'), JSON.stringify(payload));
  }
});

test('P4: an interrupt leaves an in-flight call without a result as a missing result, never an outcome', async () => {
  const ledger = await sliceLineage([await fixture([
    call('text(await tools.exec_command({cmd: "npm test"}));'),
    aborted({ turn_id: 'turn-1', reason: 'interrupted' }),
  ])]);
  assert.deepEqual(ledger.marks, [typedMark({ record: 4, beforeEvent: 0 })]);
  assert.equal(ledger.capture.missing, 1);
  assert.ok(ledger.capture.reasons.includes('codex_wrapper_incomplete'));
  assert.ok(ledger.ledger.every((event) => event.exitCode === undefined && event.outcome !== 'passed'));
});

test('P4 near misses: unknown reason, extra field, repeated key, empty or malformed fields stay unsupported shapes', async () => {
  const good = { turn_id: 'turn-1', reason: 'interrupted' };
  const rows = [
    aborted({ ...good, reason: 'cancelled' }),
    aborted({ ...good, reason: 'Interrupted' }),
    aborted({ turn_id: 'turn-1' }),
    aborted({ reason: 'interrupted' }),
    aborted({ ...good, turn_id: '' }),
    aborted({ ...good, turn_id: 7 }),
    aborted({ ...good, turn_id: null }),
    aborted({ ...good, extra: true }),
    aborted({ ...good, started_at: '1' }),
    aborted({ ...good, duration_ms: 1.5 }),
    aborted({ ...good, error: ERROR_SENTINEL }),
    aborted({ ...good, error: { message: ERROR_SENTINEL, extra: 1 } }),
    '{"type":"event_msg","payload":{"type":"turn_aborted","turn_id":"turn-1","reason":"interrupted","reason":"replaced"}}',
    '{"type":"event_msg","payload":{"type":"turn_aborted","turn_id":"turn-1","turn_id":"turn-2","reason":"interrupted"}}',
    '{"type":"event_msg","payload":{"type":"turn_aborted","turn_id":"turn-1","reason":"interrupted","error":{"message":"a","message":"b"}}}',
  ];
  for (const row of rows) {
    const file = await fixture([row]);
    const { meta } = await readCodexSession(file);
    assert.equal(meta.capture.unsupported, 1, row);
    const ledger = await sliceLineage([file]);
    assert.deepEqual(ledger.marks, [], row);
    assert.ok(ledger.capture.reasons.includes('capture_incomplete'), row);
    assert.ok(!JSON.stringify(ledger).includes(ERROR_SENTINEL), row);
  }
});

// ---------------------------------------------------------------------------------------------
// (5) A joined poll whose own result no proved emitter attributes is an outcome-unknown chunk.
// ---------------------------------------------------------------------------------------------
const started = [
  call('const r = await tools.exec_command({cmd: "sleep 5 && echo done"});\ntext(r);', 'a'),
  result(complete({ wall_time_seconds: 1, session_id: 7, output: '' }), 'a'),
];

test('P5: an unattributed chunk of a joined poll keeps the whole command unknown even after a typed exit', async () => {
  const ledger = await sliceLineage([await fixture([...started,
    call('const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p.output.trim());', 'b'),
    result(complete('partial'), 'b'),
    call('const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p);', 'c'),
    result(complete({ wall_time_seconds: 1, exit_code: 0, output: 'done\n' }), 'c'),
  ])]);
  assert.equal(ledger.ledger.length, 1);
  assert.equal(ledger.ledger[0].outcome, 'unknown');
  assert.notEqual(ledger.ledger[0].outcome, 'passed');
  assert.ok(ledger.ledger[0].outcomeUnknown === true);
  assert.deepEqual(observations(ledger).map(([resultCode, , proven]) => [resultCode, proven]), [['unknown', false]]);
  assert.ok(!ledger.capture.reasons.includes('codex_poll_unmatched'), 'the poll joined its command');
  assert.ok(ledger.capture.reasons.includes('codex_wrapper_output_unmapped'), 'the poll keeps its unmapped result');
  assert.equal(ledger.capture.unmapped, 1);
  assert.equal(ledger.capture.unsupported, 0);
});

test('P5: a terminal unattributed chunk leaves the command unknown and joined', async () => {
  const ledger = await sliceLineage([await fixture([...started,
    call('const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p.output.trim());', 'b'),
    result(complete('done'), 'b'),
  ])]);
  assert.equal(ledger.ledger[0].outcome, 'unknown');
  assert.deepEqual(observations(ledger).map(([resultCode, , proven]) => [resultCode, proven]), [['unknown', false]]);
  assert.ok(!ledger.capture.reasons.includes('codex_poll_unmatched'));
  assert.equal(ledger.capture.unmapped, 1);
});

test('P5 near misses: a proved poll chain still proves, and an unregistered session stays unmatched', async () => {
  const proved = await sliceLineage([await fixture([...started,
    call('const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p);', 'b'),
    result(complete({ wall_time_seconds: 1, session_id: 7, output: 'partial\n' }), 'b'),
    call('const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p);', 'c'),
    result(complete({ wall_time_seconds: 1, exit_code: 0, output: 'done\n' }), 'c'),
  ])]);
  assert.deepEqual(proved.ledger.map((event) => [event.exitCode, event.outcome]), [[0, 'passed']]);
  assert.deepEqual(observations(proved), [['succeeded', 0, true]]);
  assert.ok(!(proved.capture?.reasons ?? []).includes('codex_poll_unmatched'));
  assert.equal(proved.capture?.unmapped ?? 0, 0);

  for (const session of ['8', '"7"']) {
    const unmatched = await sliceLineage([await fixture([...started,
      call(`const p = await tools.write_stdin({session_id: ${session}, chars: ""});\ntext(p.output.trim());`, 'b'),
      result(complete('partial'), 'b'),
    ])]);
    assert.ok(unmatched.capture.reasons.includes('codex_poll_unmatched'), session);
    assert.equal(unmatched.capture.unsupported, 1, session);
  }
});

// ---------------------------------------------------------------------------------------------
// M33 refreeze (after lane review). Synthetic sources only.
// ---------------------------------------------------------------------------------------------

// (3) The identifier `String` may occur nowhere except as the object of a String.raw tag.
test('P3 refreeze: several exact String.raw tags, and String inside literals or comments, stay proved', () => {
  for (const [source, cmd] of [
    ['const a = String.raw`x\\y`;\ntext(await tools.exec_command({cmd: String.raw`p\\q`}));', 'p\\q'],
    ['// String is only a word here\ntext(await tools.exec_command({cmd: String.raw`a\\.b`}));', 'a\\.b'],
    ['text(await tools.exec_command({cmd: String.raw`String\\d`}));', 'String\\d'],
    ['const note = "String"; text(await tools.exec_command({cmd: String.raw`c\\d`}));', 'c\\d'],
    ['const note = `String`; text(await tools.exec_command({cmd: String.raw`e\\f`}));', 'e\\f'],
  ]) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.unsupported, 0, source);
    assert.deepEqual(parsed.calls.map((c) => c.input.cmd), [cmd], source);
  }
});

test('P3 refreeze near misses: any other occurrence of the identifier String leaves String.raw unproved', () => {
  const call = 'text(await tools.exec_command({cmd: String.raw`a`}));';
  for (const other of [
    'const f = (String) => String;',                    // arrow parameter
    'const f = String => 1;',                           // bare arrow parameter
    'function g(String) { return 1; }',                 // function parameter
    'function g(a, ...String) { return a; }',           // rest parameter
    'try { } catch (String) { }',                       // catch binding
    'const h = ({String}) => 1;',                       // destructured parameter
    'const {String: S} = globalThis;',                  // destructuring key
    'const [String] = [1];',                            // array destructuring
    'const o = {String: 1};',                           // object key
    'const o = x.String;',                              // member String
    'const o = x?.String;',                             // optional member String
    'text(String(1));',                                 // bare String call
    'const s = String;',                                // bare String value
    'String = 1;',                                      // assignment
    'String: for (;;) break String;',                   // label
    'text(`${String(1)}`);',                            // inside a template substitution
    'text(`${`${String}`}`);',                          // inside a nested template substitution
    'text(String.raw`b${1}`);',                         // a String.raw tag with a substitution
    'const tag = String.raw;',                          // String.raw read, not a tag
    'text(`${Str\\u0069ng}`);',                         // an escape inside a substitution
  ]) {
    for (const source of [`${call}\n${other}`, `${other}\n${call}`]) {
      const parsed = readExecCalls(source);
      assert.equal(parsed.calls.length, 0, source);
      assert.ok(parsed.unsupported > 0 || parsed.syntaxInvalid === true, source);
    }
  }
});

test('P3 refreeze near misses: an identifier escape outside a literal fails closed with a declared gap', () => {
  for (const source of [
    'var Str\\u0069ng = {raw: () => "x"};\ntext(await tools.exec_command({cmd: String.raw`a`}));',
    'const cmd = "a"; text(await t\\u006fols.exec_command({cmd}));',
    'const cmd = "a"; text(await tools.exec_comm\\u0061nd({cmd}));',
    'text(await tools.exec_command({cmd: "a"})); const t\\u0065xt = 1;',
  ]) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0, source);
    assert.ok(parsed.unsupported > 0, source);
    assert.equal(parsed.emissionsExact, false, source);
  }
});

// C-02 M33 (5) refreeze: an indexed forEach or entries() emitter proves a mapping only when it is
// called on the exact bound settled-result name; an alias proves none (nor in the index loop).
const aliasPrefix = 'const results = await Promise.allSettled([tools.exec_command({cmd: "npm test"}), '
  + 'tools.exec_command({cmd: "npm run lint"})]);\n';
const spreadOutputs = loopOutputs;
const nestedOutputs = loopOutputs.map(({ i, ...result }) => ({ i, result }));
const projectedOutputs = loopOutputs.map(({ i, value }) => ({ i, result: value }));
const indexedEmitters = [
  ['results.forEach((r, i) => text(JSON.stringify({i, ...r})));', spreadOutputs],
  ['results.forEach((r, i) => text({i, ...r}));', spreadOutputs],
  ['results.forEach((r, i) => text(JSON.stringify({i, result: r})));', nestedOutputs],
  ['results.forEach((r, i) => text(JSON.stringify({i, result: r.status === "fulfilled" ? r.value : String(r.reason)})));', projectedOutputs],
  ['for (const [i, r] of results.entries()) text(JSON.stringify({i, ...r}));', spreadOutputs],
  ['for (let i = 0; i < results.length; i++) text(JSON.stringify({i, ...results[i]}));', spreadOutputs],
  ['for (let i = 0; i < results.length; i++) text(JSON.stringify({i, result: results[i]}));', nestedOutputs],
  ['for (let i = 0; i < results.length; i++) text(JSON.stringify({i, result: results[i].status === "fulfilled" ? results[i].value : String(results[i].reason)}));', projectedOutputs],
];

test('P5 refreeze: indexed emitters on the exact bound settled name map every entry', () => {
  for (const [emitter, outputs] of indexedEmitters) {
    const results = mapped(aliasPrefix + emitter, outputs);
    assert.deepEqual([...results.keys()], [0, 1], emitter);
    assert.deepEqual([results.get(0).value.exit_code, results.get(1).value.exit_code], [0, 2], emitter);
  }
  const visible = 'results.forEach((r, i) => text(`${i}: ${r.status === "fulfilled" ? r.value.output : r.reason}`));';
  assert.equal(mapped(aliasPrefix + visible, ['0: ok\n', '1: lint error\n']).size, 2);
});

test('P5 refreeze near misses: an alias of the settled results proves no indexed mapping', () => {
  const aliased = (emitter, declaration) => `${declaration} alias = results;\n`
    + emitter.replaceAll('results', 'alias');
  for (const [emitter, outputs] of indexedEmitters) {
    for (const declaration of ['const', 'let', 'var']) {
      const source = aliasPrefix + aliased(emitter, declaration);
      const parsed = readExecCalls(source);
      assert.equal(parsed.calls.length, 2, source);
      assert.equal(execResults(complete(...outputs), parsed).results.size, 0, source);
    }
  }
  const visible = 'results.forEach((r, i) => text(`${i}: ${r.status === "fulfilled" ? r.value.output : r.reason}`));';
  assert.equal(mapped(aliasPrefix + aliased(visible, 'const'), ['0: ok\n', '1: lint error\n']).size, 0);
});

test('P5 refreeze: an aliased emitter leaves both commands with an unmapped result, never a proved one', async () => {
  const source = aliasPrefix + 'const alias = results;\nalias.forEach((r, i) => text(JSON.stringify({i, ...r})));';
  const ledger = await sliceLineage([await fixture([call(source), result(complete(...loopOutputs))])]);
  assert.equal(ledger.ledger.length, 2);
  assert.ok(ledger.ledger.every((event) => event.exitCode === undefined || event.exitCode === null));
  assert.ok(ledger.capture.unmapped >= 2);
  assert.ok(ledger.capture.reasons.includes('codex_wrapper_output_unmapped'));
  assert.ok(observations(ledger).every(([, , proven]) => proven === false));
});

// C-02 M33 (4) refreeze: only the typed Codex row is tagged; a Claude text interrupt stays plain.
test('P4 refreeze: typed turn_aborted marks carry the closed source and their row position', async () => {
  assert.ok(Object.isFrozen(MARK_SOURCES));
  assert.deepEqual(Object.values(MARK_SOURCES), ['codex_turn_aborted']);
  const ledger = await sliceLineage([await fixture([
    call('text(await tools.exec_command({cmd: "npm test"}));', 'a'),
    result(complete({ wall_time_seconds: 1, exit_code: 0, output: 'ok\n' }), 'a'),
    aborted({ turn_id: 'turn-1', reason: 'interrupted' }),
    call('text(await tools.exec_command({cmd: "npm run lint"}));', 'b'),
    result(complete({ wall_time_seconds: 1, exit_code: 0, output: 'ok\n' }), 'b'),
    rec({ type: 'message', role: 'user', content: 'Continue.' }),
    aborted({ turn_id: 'turn-2', reason: 'replaced' }),
  ])]);
  assert.deepEqual(ledger.marks, [typedMark({ record: 5, beforeEvent: 1 }),
    typedMark({ turn: 2, record: 9, beforeEvent: 2 })]);
});

test('P4 refreeze near miss; M34 labels: a Claude interruption notice is harness, never a mark, and its words are not read', async () => {
  const dir = await scratchDir('m33-claude-');
  const file = join(dir, 'claude-synthetic.jsonl');
  const row = (value) => JSON.stringify({ sessionId: 'claude-synthetic', cwd: '/repo', ...value });
  await writeFile(file, [
    row({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'Run the checks.' } }),
    row({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } }),
    row({ type: 'user', uuid: 'u2', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    row({ type: 'user', uuid: 'u3', message: { role: 'user', content: [
      { type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
  ].join('\n'), { mode: 0o600 });
  const ledger = await sliceLineage([file]);
  // M34 labels (C-02 "Slice-time labels"): Claude Code types no interruption; its notice is harness (here, a recorder
  // of no plain version: set aside by the declared legacy fallback, counted), and no mark reads its words. M34 labels
  // review (F2): its row keeps only the positional mark of its counted label gap.
  const gapMark = (gap, extra) => ({ kind: 'label_gap', gap, stream: 0, ...extra });
  // M34 labels review (F6): the prompt the fallback read as the human's is counted and marked too.
  assert.deepEqual(ledger.marks, [gapMark('legacy_recorder', { turn: 0, beforeEvent: 0, record: 1 }),
    gapMark('legacy_recorder', { turn: 1, beforeEvent: 1, record: 4 })]);
  assert.deepEqual(ledger.capture.labelGaps, { legacy_recorder: 2 });
  // On a typed recorder the same row is an untyped harness row, counted as an untyped interruption.
  const typed = join(dir, 'claude-typed.jsonl');
  await writeFile(typed, [
    row({ type: 'user', uuid: 'u1', version: '2.1.284', origin: { kind: 'human' }, message: { role: 'user', content: 'Run the checks.' } }),
    row({ type: 'user', uuid: 'u3', version: '2.1.284', message: { role: 'user', content: [
      { type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
  ].join('\n'), { mode: 0o600 });
  const typedLedger = await sliceLineage([typed]);
  assert.deepEqual([typedLedger.marks, typedLedger.capture.labelGaps], [[gapMark('interrupt_untyped',
    { turn: 1, beforeEvent: 0, record: 2 })], { interrupt_untyped: 1 }]);
});

// C-02 M33 (5) refreeze: a joined poll whose wrapper did not complete, or whose own direct result
// row is missing, null or not strict JSON, is an outcome-unknown chunk of that command.
const exitPoll = [
  call('const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p);', 'c'),
  result(complete({ wall_time_seconds: 1, exit_code: 0, output: 'done\n' }), 'c'),
];
const pollWrapper = 'const p = await tools.write_stdin({session_id: 7, chars: ""});\ntext(p);';
const fc = (name, args, callId) => rec({ type: 'function_call', name, arguments: JSON.stringify(args), call_id: callId });
const fco = (output, callId) => rec({ type: 'function_call_output', call_id: callId, output });
const unknownCommand = (ledger, label) => {
  assert.equal(ledger.ledger.length, 1, label);
  assert.equal(ledger.ledger[0].outcome, 'unknown', label);
  assert.equal(ledger.ledger[0].outcomeUnknown, true, label);
  assert.deepEqual(observations(ledger).map(([resultCode, , proven]) => [resultCode, proven]), [['unknown', false]], label);
  assert.ok(!ledger.capture.reasons.includes('codex_poll_unmatched'), `${label}: the poll joined its command`);
};

test('P5 refreeze: a joined poll in a wrapper that did not complete keeps the command unknown', async () => {
  for (const [label, rows] of [
    ['failed', [call(pollWrapper, 'b'), result([{ type: 'input_text', text: 'Script failed\nWall time: 0.1 seconds' },
      { type: 'input_text', text: 'boom' }], 'b')]],
    ['terminated', [call(pollWrapper, 'b'), result([{ type: 'input_text', text: 'Script terminated\nWall time: 0.1 seconds' }], 'b')]],
    ['no result row', [call(pollWrapper, 'b')]],
    ['unrecognized header', [call(pollWrapper, 'b'), result([{ type: 'input_text', text: 'Wall time: 0.1 seconds' }], 'b')]],
    ['not awaited', [call('tools.write_stdin({session_id: 7, chars: ""});\ntext("sent");', 'b'), result(complete('sent'), 'b')]],
  ]) {
    const ledger = await sliceLineage([await fixture([...started, ...rows, ...exitPoll])]);
    unknownCommand(ledger, label);
    // The poll keeps its own gap: the wrapper that did not complete, or its unsupported call.
    assert.ok(ledger.capture.missing + ledger.capture.unsupported >= 1, label);
    assert.ok(ledger.capture.incomplete, label);
  }
});

test('P5 refreeze: a direct poll whose own row is missing, null or not strict JSON keeps the command unknown', async () => {
  const directStarted = [fc('exec_command', { cmd: 'sleep 5 && echo done' }, 'a'),
    fco('Wall time: 1.0 seconds\nProcess running with session ID 7\nOutput:\n', 'a')];
  const directExit = [fc('write_stdin', { session_id: 7, chars: '' }, 'c'),
    fco('Wall time: 1.0 seconds\nProcess exited with code 0\nOutput:\ndone\n', 'c')];
  const cases = [
    ['missing row', [fc('write_stdin', { session_id: 7, chars: '' }, 'b')], (l) => {
      assert.equal(l.capture.missing, 1); assert.ok(l.capture.reasons.includes('codex_tool_result_missing')); }],
    ['null output', [fc('write_stdin', { session_id: 7, chars: '' }, 'b'), fco(null, 'b')], (l) => {
      assert.equal(l.capture.unmapped, 1); assert.equal(l.capture.unsupported, 0);
      assert.ok(l.capture.reasons.includes('codex_wrapper_output_unmapped')); }],
    ['repeated-key row', [fc('write_stdin', { session_id: 7, chars: '' }, 'b'),
      '{"type":"response_item","payload":{"type":"function_call_output","call_id":"b","output":"x","output":"y"}}'], (l) => {
      assert.equal(l.capture.unmapped, 1); assert.equal(l.capture.unsupported, 1);
      assert.ok(l.capture.reasons.includes('codex_wrapper_output_unmapped')); }],
    ['repeated call id', [fc('write_stdin', { session_id: 7, chars: '' }, 'b'),
      fc('write_stdin', { session_id: 7, chars: '' }, 'b'), fco('Wall time: 1.0 seconds\nOutput:\npartial\n', 'b')], () => {}],
  ];
  for (const [label, rows, gap] of cases) {
    for (const exit of [directExit, exitPoll]) {
      const ledger = await sliceLineage([await fixture([...directStarted, ...rows, ...exit])]);
      unknownCommand(ledger, label);
      gap(ledger);
      assert.ok(ledger.capture.incomplete || ledger.capture.unmapped > 0, label);
    }
  }
});

test('P5 refreeze: a poll in a wrapper call whose call ID was repeated keeps the command unknown', async () => {
  const ledger = await sliceLineage([await fixture([...started,
    call('text(await tools.exec_command({cmd: "ls"}));', 'b'),
    result(complete({ wall_time_seconds: 1, exit_code: 0, output: 'x\n' }), 'b'),
    call(pollWrapper, 'b'),
    result(complete({ wall_time_seconds: 1, exit_code: 0, output: 'y\n' }), 'b'),
    ...exitPoll])]);
  const commands = ledger.ledger.filter((event) => event.cmd === 'sleep 5 && echo done');
  assert.deepEqual(commands.map((event) => [event.exitCode, event.outcome, event.outcomeUnknown === true]),
    [[0, 'unknown', true]]);
  assert.ok(!ledger.capture.reasons.includes('codex_poll_unmatched'));
  assert.ok(ledger.capture.reasons.includes('codex_tool_identity_conflict'));
});

test('P5 refreeze near misses: an unregistered session stays unmatched and leaves the proved command alone', async () => {
  const directStarted = [fc('exec_command', { cmd: 'sleep 5 && echo done' }, 'a'),
    fco('Wall time: 1.0 seconds\nProcess running with session ID 7\nOutput:\n', 'a')];
  const directExit = [fc('write_stdin', { session_id: 7, chars: '' }, 'c'),
    fco('Wall time: 1.0 seconds\nProcess exited with code 0\nOutput:\ndone\n', 'c')];
  const proved = (ledger, label) => {
    assert.deepEqual(ledger.ledger.map((event) => [event.exitCode, event.outcome]), [[0, 'passed']], label);
    assert.deepEqual(observations(ledger), [['succeeded', 0, true]], label);
  };
  // Direct polls naming another (or an untyped) session: unmatched, not joined.
  for (const session of [8, '7']) {
    const nullRow = await sliceLineage([await fixture([...directStarted,
      fc('write_stdin', { session_id: session, chars: '' }, 'b'), fco(null, 'b'), ...directExit])]);
    proved(nullRow, `null ${session}`);
    assert.ok(nullRow.capture.reasons.includes('codex_poll_unmatched'), `null ${session}`);
    const missingRow = await sliceLineage([await fixture([...directStarted,
      fc('write_stdin', { session_id: session, chars: '' }, 'b'), ...directExit])]);
    proved(missingRow, `missing ${session}`);
    assert.equal(missingRow.capture.missing, 1, `missing ${session}`);
  }
  // Wrappers that did not complete but polled another session, or polled nothing.
  for (const [label, rows] of [
    ['other session', [call('const p = await tools.write_stdin({session_id: 8, chars: ""});\ntext(p);', 'b'),
      result([{ type: 'input_text', text: 'Script failed\nWall time: 0.1 seconds' }], 'b')]],
    ['no poll', [call('text(await tools.exec_command({cmd: "ls"}));', 'b')]],
    ['poll after an unsupported statement', [call('if (x) text(1);\nconst p = await tools.write_stdin({session_id: 7, chars: ""});', 'b')]],
  ]) {
    const ledger = await sliceLineage([await fixture([...started, ...rows, ...exitPoll])]);
    const commands = ledger.ledger.filter((event) => event.cmd === 'sleep 5 && echo done');
    assert.deepEqual(commands.map((event) => [event.exitCode, event.outcome]), [[0, 'passed']], label);
  }
});
