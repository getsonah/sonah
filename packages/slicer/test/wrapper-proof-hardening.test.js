// Synthetic Codex recordings only. C-02: the wrapper reader fails closed wherever its tokens could
// differ from what JavaScript runs (hidden code, early errors, hoisted rebinding), and the native
// shell argv, header integers and poll unknowns are read exactly. Nothing here is executed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readExecCalls, execResults } from '../src/codex-exec.js';
import { sliceLineage } from '../index.js';
import { scratchDir } from './scratch-dir.js';

const rec = (payload) => JSON.stringify({ type: 'response_item', payload });
const complete = (...values) => [{ type: 'input_text', text: 'Script completed\nWall time: 0.1 seconds' },
  ...values.map((value) => ({ type: 'input_text', text: typeof value === 'string' ? value : JSON.stringify(value) }))];
async function fixture(lines) {
  const dir = await scratchDir('wrapper-proof-');
  const file = join(dir, 'rollout-2026-09-10T12-00-00-test.jsonl');
  await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'test', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: 'Run it.' }), ...lines].join('\n'));
  return file;
}
const map = 'const results = await Promise.allSettled(commands.map(cmd => tools.exec_command({cmd}))); '
  + 'results.forEach((r, i) => text(JSON.stringify({i, ...r})));';

test('a line comment ends at every JavaScript line terminator, so no code hides behind one', () => {
  assert.equal(readExecCalls(`const commands = ["npm test"]; // run it\n${map}`).calls.length, 1, 'positive control');
  for (const terminator of ['\r', ' ', ' ']) {
    const parsed = readExecCalls(`const commands = ["npm test"]; // run it${terminator}commands[0] = "true";\n${map}`);
    assert.equal(parsed.calls.length, 0, JSON.stringify(terminator));
    assert.ok(parsed.unsupported > 0);
  }
  const inTemplate = readExecCalls('text(`${1 // x + tools.exec_command({cmd:"hidden"})}`);');
  assert.equal(inTemplate.calls.length, 0);
  assert.ok(inTemplate.unsupported > 0, 'the hidden call is still declared');
});

test('a slash outside a comment (regular expression or division) makes the whole wrapper unproved', () => {
  for (const source of [
    'const url = /https?:\\/\\//; text(await tools.exec_command({cmd:"make test"}));',
    'text(await tools.exec_command({cmd:"make test"})); const half = 1 / 2;',
    'text(await tools.exec_command({cmd:"a"})); /x/.test("y") // tools.exec_command({cmd:"b"})',
  ]) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0, source);
    assert.ok(parsed.unsupported > 0, source);
  }
  assert.equal(readExecCalls('// a comment with / slashes /* */\ntext(await tools.exec_command({cmd:"make test"}));').calls.length, 1,
    'slashes inside comments are fine');
});

test('module-code early errors prove no call at all, even in a parsed prefix', () => {
  const first = 'text(await tools.exec_command({cmd:"make test"})); ';
  assert.equal(readExecCalls(first).calls.length, 1, 'positive control');
  for (const suffix of ['const if = 1;', 'let enum = 2;', 'const yield = 3;', 'const r = 1; const r = 2;',
    'let x = 1; var x = 2;', 'const n = 010;', 'const n = 007;',
    'await Promise.allSettled(["a"].map(cmd\n=> tools.exec_command({cmd})));']) {
    const parsed = readExecCalls(first + suffix);
    assert.equal(parsed.calls.length, 0, suffix);
    assert.ok(parsed.unsupported > 0 || parsed.syntaxInvalid === true, suffix);
  }
  assert.equal(readExecCalls(first + 'for (const r of []) {} for (const r of []) {}').calls.length, 1,
    'the same name in separate block scopes is not a redeclaration');
});

test('a syntax-invalid suffix invalidates every earlier wrapper action and emitted status', async () => {
  const prefix = 'const r = await tools.exec_command({cmd:"make test"}); text(r); ';
  const output = complete({ output: 'ok', exit_code: 0 });
  assert.equal(readExecCalls(prefix).calls.length, 1, 'valid control has one action');
  for (const suffix of ['if (', 'function (', 'const = 1;', 'return 1;', '{ return 1; }']) {
    const source = prefix + suffix;
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0, suffix);
    assert.equal(parsed.syntaxInvalid, true, suffix);
    assert.equal(parsed.unsupported, 0, suffix);
    assert.equal(execResults(output, parsed).results.size, 0, suffix);
    const sliced = await sliceLineage([await fixture([
      rec({ type: 'custom_tool_call', name: 'functions.exec', call_id: 'w', input: source }),
      rec({ type: 'custom_tool_call_output', call_id: 'w', output }),
    ])]);
    assert.equal(sliced.ledger.some((event) => event.kind === 'bash'), false, suffix);
    assert.equal(sliced.ledger.some((event) => event.exitCode === 0), false, suffix);
    assert.equal(sliced.capture.incomplete, true, suffix);
  }
  const validSuffix = prefix + 'for (const x of []) {}';
  const parsed = readExecCalls(validSuffix);
  assert.equal(parsed.calls.length, 1, 'valid but unsupported suffix keeps the proved prefix');
  assert.ok(parsed.unsupported > 0);
  assert.equal(execResults(output, parsed).results.size, 1);
});

test('punctuation inside string literals is not a syntax delimiter', () => {
  for (const command of [')', '(', '{', '}', '[', ']']) {
    const source = 'text(await tools.exec_command({cmd:' + JSON.stringify(command) + '}));';
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 1, command);
    assert.equal(parsed.syntaxInvalid, undefined, command);
    assert.equal(parsed.unsupported, 0, command);
  }
});

test('a hoisted declaration of tools or Promise proves no call; of an emitter, no emission', () => {
  const clean = 'const results = await Promise.allSettled([tools.exec_command({cmd:"npm test"})]); '
    + 'results.forEach((r, i) => text(JSON.stringify({i, ...r})));';
  const block = { i: 0, status: 'fulfilled', value: { output: 'FAIL', exit_code: 1 } };
  assert.equal(execResults(complete(block), readExecCalls(clean)).results.size, 1, 'positive control');
  for (const suffix of [' function tools() {}', ' class Promise {}', ' var tools = 1;', ' const {tools: t, Promise} = x;']) {
    const parsed = readExecCalls(clean + suffix);
    assert.equal(parsed.calls.length, 0, suffix);
  }
  for (const suffix of [' function text(s) { return s; }', ' function String(v) { return "0"; }', ' var JSON = 1;']) {
    const parsed = readExecCalls(clean + suffix);
    assert.equal(parsed.calls.length, 1, `${suffix}: the call was still attempted`);
    assert.equal(execResults(complete(block), parsed).results.size, 0, `${suffix}: no emission is proved`);
  }
});

test('JSON.stringify of a plain value is not that value, in a tool argument or an array item', () => {
  for (const source of ['text(await tools.exec_command({cmd: JSON.stringify("make test")}));',
    `const commands = [JSON.stringify("make test")]; ${map}`, `const commands = ["a", JSON.stringify(1)]; ${map}`]) {
    const parsed = readExecCalls(source);
    assert.ok(parsed.calls.every((call) => call.input.cmd !== 'make test' && call.input.cmd !== 1), source);
    assert.ok(parsed.unsupported > 0, source);
  }
});

test('a failed statement that mentions tools in any position declares an unsupported action', async () => {
  for (const source of ['await (0, tools).exec_command({cmd:"make deploy"}); text("done");',
    'await (tools).exec_command({cmd:"make deploy"});', 'const t = tools; await t.exec_command({cmd:"make deploy"});',
    'await Promise.allSettled(["make deploy"].map(cmd => (0, tools).exec_command({cmd})));']) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0, source);
    assert.ok(parsed.unsupported > 0, source);
    const sliced = await sliceLineage([await fixture([rec({ type: 'custom_tool_call', name: 'exec', call_id: 'w', input: source }),
      rec({ type: 'custom_tool_call_output', call_id: 'w', output: complete('done') })])]);
    assert.equal(sliced.capture.incomplete, true, `${source}: never a complete capture`);
  }
});

test('literal values follow JavaScript: template CRLF reads LF; trailing commas and one body pair parse', () => {
  const crlf = readExecCalls('await Promise.allSettled([`make\r\ntest`].map(cmd => tools.exec_command({cmd})));');
  assert.deepEqual(crlf.calls.map((call) => call.input.cmd), ['make\ntest']);
  for (const source of [
    'const commands = ["a", "b"];\nconst results = await Promise.allSettled(\n  commands.map((cmd) =>\n    tools.exec_command({\n      cmd,\n      workdir: "/repo",\n    }),\n  ),\n);',
    'await Promise.allSettled(["a", "b"].map((cmd) => (tools.exec_command({ cmd }))));',
  ]) {
    const parsed = readExecCalls(source);
    assert.deepEqual(parsed.calls.map((call) => call.input.cmd), ['a', 'b'], source);
    assert.equal(parsed.unsupported, 0, source);
  }
  assert.equal(readExecCalls('await Promise.allSettled(["a"].map(cmd => ((tools.exec_command({cmd})))));').calls.length, 0,
    'only one redundant pair of parentheses');
});

test('header integers are canonical: -0 and leading zeros are not Codex output', async () => {
  const direct = (output) => [rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make build"}' }),
    rec({ type: 'function_call_output', call_id: 'c1', output })];
  assert.equal((await sliceLineage([await fixture(direct('Wall time: 1 seconds\nProcess exited with code -3\nOutput:\nx'))])).ledger[0].exitCode, -3);
  for (const code of ['-0', '007', '00']) {
    const sliced = await sliceLineage([await fixture(direct(`Wall time: 1 seconds\nProcess exited with code ${code}\nOutput:\nx`))]);
    assert.equal(sliced.ledger[0].exitCode, undefined, code);
  }
});

test('an unknown poll chunk keeps the command unknown when a later poll exits cleanly', async () => {
  const sessionKey = JSON.stringify('session_id');
  const lines = [rec({ type: 'function_call', name: 'exec_command', call_id: 'b', arguments: '{"cmd":"make build"}' }),
    rec({ type: 'function_call_output', call_id: 'b', output: JSON.stringify({ output: 'started', session_id: 42 }) })];
  const poll = (id, output) => [rec({ type: 'function_call', name: 'write_stdin', call_id: id, arguments: `{${sessionKey}:42,"chars":""}` }),
    rec({ type: 'function_call_output', call_id: id, output })];
  const clean = await sliceLineage([await fixture([...lines, ...poll('p1', 'Wall time: 1 seconds\nProcess exited with code 0\nOutput:\nok')])]);
  assert.equal(clean.ledger[0].exitCode, 0, 'positive control');
  const sliced = await sliceLineage([await fixture([...lines, ...poll('p1', '{"output":"x","exit_code":1,"exit_code":0}'),
    ...poll('p2', 'Wall time: 1 seconds\nProcess exited with code 0\nOutput:\nok')])]);
  assert.equal(sliced.ledger[0].outcome, 'unknown');
  assert.equal(sliced.ledger[0].outcomeUnknown, true);
});

test('the native shell argv triple is a command, and its shell header types the exit', async () => {
  const shell = (command) => [rec({ type: 'function_call', name: 'shell', call_id: 's1',
    arguments: JSON.stringify({ command, workdir: '/repo', timeout_ms: 1000 }) }),
  rec({ type: 'function_call_output', call_id: 's1', output: 'Exit code: 2\nWall time: 0.4 seconds\nOutput:\nbuild failed' })];
  for (const argv of [['bash', '-lc', 'npm run build'], ['/bin/zsh', '-lc', 'npm run build'], ['sh', '-c', 'npm run build'],
    ['/usr/local/bin/bash', '-lc', 'npm run build']]) {
    const [event] = (await sliceLineage([await fixture(shell(argv))])).ledger;
    assert.deepEqual([event.cmd, event.exitCode], ['npm run build', 2], argv.join(' '));
  }
  for (const argv of [['ls', '-la'], ['bash', '-lc'], ['bash', '-x', 'npm run build'], ['python', '-c', 'print(1)'],
    ['/opt/bash', '-lc', 'x'], ['bash', '-lc', 'a', 'b']]) {
    const [event] = (await sliceLineage([await fixture(shell(argv))])).ledger;
    assert.equal(event.exitCode, undefined, argv.join(' '));
    assert.notEqual(event.cmd, argv.at(-1), `${argv.join(' ')}: stays a generic call`);
  }
});
