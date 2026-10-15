// Synthetic Codex recordings only. The static reader must never execute their JavaScript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { readExecCalls, execResults } from '../src/codex-exec.js';
import { readCodexSession } from '../src/codex.js';
import { sliceLineage } from '../index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { scratchDir } from './scratch-dir.js';

const rec = (payload) => JSON.stringify({ type: 'response_item', payload });
const complete = (...values) => [{ type: 'input_text', text: 'Script completed\nWall time: 0.1 seconds' },
  ...values.map((value) => ({ type: 'input_text', text: typeof value === 'string' ? value : JSON.stringify(value) }))];
const running = (cell, ...values) => [{ type: 'input_text', text: `Script running with cell ID ${cell}` }, ...complete(...values).slice(1)];
const wait = (cell, id) => rec({ type: 'function_call', name: 'functions.wait', call_id: id, arguments: JSON.stringify({ cell_id: cell }) });
const call = (input, name = 'exec', call_id = 'wrapper') => rec({ type: 'custom_tool_call', name, call_id, input });
const result = (output, call_id = 'wrapper') => rec({ type: 'custom_tool_call_output', call_id, output });
const fileChange = (changes, { status = 'completed', id = 'ui-change' } = {}) => JSON.stringify({
  type: 'event_msg', payload: { type: 'item_completed', item: {
    id, type: 'FileChange', status, changes,
  } },
});
const commandExecution = (command, { cwd = 'file:///repo', status = 'completed', exitCode = 0 } = {}) =>
  JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: {
    type: 'CommandExecution', command: ['/bin/zsh', '-lc', command], cwd, status,
    exit_code: exitCode, stdout: 'SIDECAR_PRIVATE_SENTINEL', stderr: '',
    aggregated_output: 'SIDECAR_PRIVATE_SENTINEL',
  } } });
async function fixture(lines) {
  const dir = await scratchDir('codex-wrapper-');
  const file = join(dir, 'rollout-2026-09-10T12-00-00-test.jsonl');
  await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'test', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: 'Fix the parser.' }), ...lines].join('\n'));
  return file;
}

test('literal JavaScript strings preserve escapes, unicode, newlines and comment-looking content', () => {
  const input = String.raw`// tools.exec_command({cmd:'not a call'})
    const cmd = 'printf "it\'s \\n"\n# /* still the command */ \u2603 \u{1F680}';
    text(await tools.exec_command({cmd:cmd,workdir:'/repo'}));`;
  const parsed = readExecCalls(input);
  assert.equal(parsed.unsupported, 0);
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].input.cmd, 'printf "it\'s \\n"\n# /* still the command */ ☃ 🚀');
  assert.equal(parsed.calls[0].awaited, true);
  const template = readExecCalls('text(await tools.exec_command({cmd:`line one\nline two`}));');
  assert.equal(template.calls[0].input.cmd, 'line one\nline two');
});

test('branches, loops, callbacks, unknown arguments, computed dispatch and shadowing never fabricate invocations', async () => {
  for (const source of [
    'if (false) await tools.exec_command({cmd:"never"});',
    'false && await tools.exec_command({cmd:"never"});',
    'for (const x of []) await tools.exec_command({cmd:"never"});',
    'const fn = () => tools.exec_command({cmd:"never"});',
    'await tools.exec_command({cmd:unknownCommand});',
    'tools.exec_command({cmd:"unawaited"});',
    'await tools["exec_command"]({cmd:"computed"});',
    'const tools = {exec_command: harmless}; text(await tools.exec_command({cmd:"fake"}));',
    'const tools = other; await tools.exec_command({cmd:"fake"});',
    'exec_command({cmd:"unknown namespace"});',
    'text(await tools.exec_command({cmd:`prefix ${unknownValue}`}));',
  ]) {
    const file = await fixture([call(source), result(complete())]);
    const normalized = await readCodexSession(file);
    assert.ok(normalized.meta.capture.incomplete);
    assert.equal((await sliceLineage([file])).ledger.length, 0);
  }
});

test('exact synchronous literal map expands attempted actions in source order', async () => {
  const bound = 'const commands = ["make first", "make second"]; '
    + 'const results = await Promise.allSettled(commands.map(cmd => tools.exec_command({cmd, workdir:"/repo"}))); text(results);';
  const inline = 'text(await Promise.allSettled(["make first", "make second"].map(cmd => tools.exec_command({cmd, workdir:"/repo"}))));';
  for (const source of [bound, inline]) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.unsupported, 0);
    assert.deepEqual(parsed.calls.map((entry) => [entry.name, entry.input.cmd, entry.awaited]), [
      ['exec_command', 'make first', true], ['exec_command', 'make second', true],
    ]);
    const settled = [
      { status: 'fulfilled', value: { output: 'first done', exit_code: 0 } },
      { status: 'rejected', reason: { message: 'second failed' } },
    ];
    // C-02 (M30): one aggregate block never proves an expanded call's result.
    assert.equal(execResults(complete(settled), parsed).results.size, 0,
      'one aggregate block maps no expanded call');
    const file = await fixture([call(source), result(complete(settled))]);
    const normalized = await readCodexSession(file);
    assert.equal(normalized.meta.capture.captured, 2);
    assert.equal(normalized.meta.capture.unsupported, 0);
    assert.equal(normalized.meta.capture.unmapped, 2);
    const ledger = await sliceLineage([file]);
    assert.deepEqual(ledger.ledger.map((event) => event.cmd), ['make first', 'make second']);
    assert.ok(ledger.ledger.every((event) => event.exitCode === undefined && event.isError !== true));
  }
  // The same actions map through an index-carrying emitter, one strict block per entry.
  const indexed = 'const commands = ["make first", "make second"]; '
    + 'const results = await Promise.allSettled(commands.map(cmd => tools.exec_command({cmd, workdir:"/repo"}))); '
    + 'results.forEach((result, i) => text(JSON.stringify({i, ...result})));';
  const blocks = [{ i: 0, status: 'fulfilled', value: { output: 'first done', exit_code: 0 } },
    { i: 1, status: 'rejected', reason: { message: 'second failed' } }];
  assert.equal(execResults(complete(...blocks), readExecCalls(indexed)).results.size, 2);
  const indexedFile = await fixture([call(indexed), result(complete(...blocks))]);
  assert.equal((await readCodexSession(indexedFile)).meta.capture.unmapped, 0);
  const indexedLedger = await sliceLineage([indexedFile]);
  assert.deepEqual(indexedLedger.ledger.map((event) => event.cmd), ['make first', 'make second']);
  assert.equal(indexedLedger.ledger[0].exitCode, 0);
  assert.equal(indexedLedger.ledger[1].isError, true);
});

test('literal map action inventory does not assign unproved results', async () => {
  const source = 'const commands=["make first","make second"]; '
    + 'const results=await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}))); text("summary");';
  const parsed = readExecCalls(source);
  assert.deepEqual(parsed.calls.map((entry) => entry.input.cmd), ['make first', 'make second']);
  assert.equal(parsed.unsupported, 0);
  assert.equal(execResults(complete('summary'), parsed).results.size, 0);
  const file = await fixture([call(source), result(complete('summary'))]);
  const normalized = await readCodexSession(file);
  assert.equal(normalized.meta.capture.captured, 2);
  assert.equal(normalized.meta.capture.unmapped, 2);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger.length, 2);
  assert.ok(ledger.ledger.every((event) => event.exitCode === undefined));
});

test('literal map rejects dynamic or altered array and callback forms', () => {
  const invalid = [
    'const commands=["one",,"two"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})));',
    'const commands=["one",...other]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})));',
    'const commands=[{cmd:"one",cmd:"two"}]; await Promise.allSettled(commands.map(input=>tools.exec_command({input})));',
    'const commands=["one"]; const alias=commands; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})));',
    'const commands=["one"]; commands.push("two"); await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})));',
    'let commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})));',
    'const commands=["one"]; await Promise.all(commands.map(cmd=>tools.exec_command({cmd})));',
    'const commands=["one"]; Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(async cmd=>tools.exec_command({cmd})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>flag?tools.exec_command({cmd}):null));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools["exec_command"]({cmd})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd,...extra})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd:cmd})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd,cmd:"override"})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd,flag:`${cmd}`})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>{return tools.exec_command({cmd});}));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>(tools.exec_command({cmd}),tools.exec_command({cmd}))));',
    'const tools={exec_command:fake}; await Promise.allSettled(["one"].map(cmd=>tools.exec_command({cmd})));',
    'const Promise={allSettled:fake}; await Promise.allSettled(["one"].map(cmd=>tools.exec_command({cmd})));',
  ];
  for (const source of invalid) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0, 'near miss cannot create a statically proved call');
    assert.ok(parsed.unsupported > 0, 'near miss remains a declared parser gap');
  }
});

test('literal map refuses reordered, missing and duplicate aggregate results', () => {
  const prefix = 'const commands=["one","two"]; '
    + 'const results=await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}))); ';
  const parsed = readExecCalls(prefix + 'results.forEach((result, i) => text(JSON.stringify({i, ...result})));');
  assert.equal(parsed.calls.length, 2);
  const first = { i: 0, status: 'fulfilled', value: { output: 'one', exit_code: 0 } };
  const second = { i: 1, status: 'fulfilled', value: { output: 'two', exit_code: 2 } };
  assert.equal(execResults(complete(first, second), parsed).results.size, 2, 'positive control');
  assert.equal(execResults(complete(first), parsed).results.size, 0, 'a missing block maps nothing');
  assert.equal(execResults(complete(second, first), parsed).results.size, 0, 'swapped indices map nothing');
  assert.equal(execResults(complete(first, second, second), parsed).results.size, 0, 'an extra block maps nothing');
  assert.equal(execResults(complete('{"i":0,"status":"rejected","status":"fulfilled","value":{"output":"one","exit_code":0}}',
    second), parsed).results.size, 0, 'a repeated status maps nothing');
  assert.equal(execResults(complete('{"i":1,"i":0,"status":"fulfilled","value":{"output":"one","exit_code":0}}',
    second), parsed).results.size, 0, 'a repeated index maps nothing');
  const aggregate = readExecCalls(prefix + 'text(results);');
  assert.equal(execResults(complete([first, second]), aggregate).results.size, 0, 'one aggregate block maps nothing');
  assert.equal(execResults(complete([second, first]), aggregate).results.size, 0, 'nor does a reordered one');
  const fused = readExecCalls('const commands=["one","two"]; '
    + 'text((await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})))).reverse());');
  assert.equal(fused.calls.length, 0, 'a transformed result in the same statement rolls back the expansion');
  assert.ok(fused.unsupported > 0);
  assert.equal(readExecCalls('const commands=["one","two"]; '
    + 'const results=await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}))); text(results.reverse());').calls.length, 2,
  'proved action prefix survives an unsupported output suffix');
});

test('Object.prototype names are never tools or argument keys in any wrapper grammar', async () => {
  for (const source of ['text(await tools.constructor({cmd:"make build"}));', 'text(await tools.toString({cmd:"x"}));',
    'text(await tools.valueOf({cmd:"x"}));', 'text(await tools.exec_command({cmd:"x", __proto__: {}}));',
    'text(await tools.exec_command({cmd:"x", "constructor": 1}));',
    'await Promise.allSettled(["x"].map(cmd=>tools.constructor({cmd})));',
    'await Promise.allSettled(["x"].map(cmd=>tools.exec_command({cmd, __proto__: "y"})));']) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0, source);
    assert.ok(parsed.unsupported > 0 || parsed.syntaxInvalid === true, source);
  }
  const file = await fixture([call('text(await tools.constructor({cmd:"make build"}));'), result(complete({ cmd: 'make build' }))]);
  const sliced = await sliceLineage([file]);
  assert.equal(sliced.ledger.length, 0, 'no fabricated action');
  assert.equal(sliced.capture.incomplete, true, 'the unparsed call stays a declared gap');
  assert.equal(readExecCalls('text(await tools.exec_command({cmd:"x", workdir:"/repo"}));').calls.length, 1, 'positive control');
});

test('M30 literal map: further near misses keep calls unproved and declared', () => {
  const invalid = [
    'const commands=["one"]; await Promise.allSettled(commands.map((cmd, i)=>tools.exec_command({cmd})));',
    'const commands=["one"]; await Promise.allSettled(commands?.map(cmd=>tools.exec_command({cmd})));',
    'const commands=["one"]; await (Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}))));',
    'const commands=["x"]; const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})));',
    'await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}))); const commands=["one"];',
    'const commands=[["one"]]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})));',
    'const commands=[{cmd:"one"}]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})));',
    'await Promise.allSettled([["one"]].map(cmd=>tools.exec_command({cmd})));',
    'await Promise.allSettled([`${x}`].map(cmd=>tools.exec_command({cmd})));',
    'await Promise.allSettled([1e400].map(cmd=>tools.exec_command({cmd})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd,timeout:-1e400})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd,label:cmd})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd,env:{A:"1"}})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd,workdir})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}).then(x=>x)));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}), this));',
    'const commands=["one"]; await Promise.allSettled(commands.map(commands=>tools.exec_command({commands})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(tools=>tools.exec_command({tools})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({[cmd]:1})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}), commands.push("two")));',
    'const commands=["one"]; await Promise.allSettled(commands.filter(Boolean).map(cmd=>tools.exec_command({cmd})));',
    'const commands=["one"]; await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})).filter(Boolean));',
    'const commands=["one"]; text(Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}))));',
  ];
  for (const source of invalid) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0, source);
    assert.ok(parsed.unsupported > 0 || parsed.syntaxInvalid === true, source);
  }
});

test('M30 literal map: any other use or later declaration of a name voids the expansion', () => {
  const map = 'await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd})));';
  assert.equal(readExecCalls(`const commands=["one","two"]; ${map}`).calls.length, 2, 'positive control');
  for (const suffix of [map, 'const x = commands;', 'const commands = ["b"];', 'let commands = 1;',
    'const tools = 1;', 'var tools = 1;', 'function Promise() {}', 'const {tools: t} = other;', 'text(tools);',
    'text(Promise);']) {
    const parsed = readExecCalls(`const commands=["one","two"]; ${map} ${suffix}`);
    assert.equal(parsed.calls.length, 0, suffix);
    assert.ok(parsed.unsupported > 0 || parsed.syntaxInvalid === true, suffix);
  }
});

test('M30 literal map: accepted variants keep source order, literal fields and duplicates', () => {
  for (const source of [
    'const commands=["b","a","b",]; await Promise.allSettled(commands.map((cmd)=>tools.exec_command({"workdir":"/repo", cmd, yield_time_ms:-1,})));',
    'await Promise.allSettled([/* c */ "b", "a", "b"].map(cmd => tools.exec_command({workdir: "/repo", cmd, yield_time_ms: -1})));',
  ]) {
    const parsed = readExecCalls(source);
    assert.equal(parsed.unsupported, 0, source);
    assert.deepEqual(parsed.calls.map((entry) => [entry.input.cmd, entry.input.workdir, entry.input.yield_time_ms, entry.awaited]),
      [['b', '/repo', -1, true], ['a', '/repo', -1, true], ['b', '/repo', -1, true]]);
  }
  const empty = readExecCalls('const commands=[]; const results=await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}))); text(results);');
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.unsupported, 0);
});

test('M30 literal map: results map only through an existing exact emitter', async () => {
  const bound = 'const commands=["make one","make two"]; const results=await Promise.allSettled(commands.map(cmd=>tools.exec_command({cmd}))); ';
  const inline = 'const results=await Promise.allSettled(["make one","make two"].map(cmd=>tools.exec_command({cmd}))); ';
  const one = { status: 'fulfilled', value: { output: 'one', exit_code: 0 } };
  const two = { status: 'fulfilled', value: { output: 'two', exit_code: 3 } };
  const indexed = 'results.forEach((r, i) => text(JSON.stringify({i, ...r})));';
  for (const prefix of [bound, inline]) {
    const parsed = readExecCalls(prefix + indexed);
    const blocks = [{ i: 0, ...one }, { i: 1, ...two }];
    assert.deepEqual([...execResults(complete(...blocks), parsed).results.keys()], [0, 1], 'an indexed emitter maps each entry');
    const ledger = (await sliceLineage([await fixture([call(prefix + indexed), result(complete(...blocks))])])).ledger;
    assert.deepEqual(ledger.map((event) => [event.cmd, event.exitCode]), [['make one', 0], ['make two', 3]]);
    // Unindexed emitters carry no array index: they map no expanded call.
    for (const emitter of ['for (const r of results) text(r);', 'text(results);', 'text(JSON.stringify(results));',
      'for (const r of results) text(r.status === "fulfilled" ? r.value.output : String(r.reason));']) {
      const unindexed = readExecCalls(prefix + emitter);
      assert.equal(unindexed.calls.length, 2, emitter);
      const payloads = emitter.startsWith('for') ? (emitter.includes('String') ? ['one', 'two'] : [one, two]) : [[one, two]];
      assert.equal(execResults(complete(...payloads), unindexed).results.size, 0, emitter);
    }
    const visible = readExecCalls(prefix + 'results.forEach((r, i) => text(`${i}: ${r.status === "fulfilled" ? r.value.output : r.reason}`));');
    const shown = execResults(complete('0: one', '1: two'), visible).results;
    assert.equal(shown.size, 2, 'the index-prefixed visible template maps visible text');
    assert.ok([...shown.values()].every((entry) => entry.outcomeUnknown === true), 'but never a status');
  }
  // Tier 1 indexed status/value emitters prove only a two-statement wrapper. The bound form has
  // a third statement, so its actions stay attempted and its results stay unmapped.
  const tierOne = 'results.forEach((r, i) => text(JSON.stringify({i, status: r.status, value: r.status === "fulfilled" ? r.value : r.reason})));';
  const blocks = [{ i: 0, status: 'fulfilled', value: one.value }, { i: 1, status: 'fulfilled', value: two.value }];
  assert.equal(execResults(complete(...blocks), readExecCalls(inline + tierOne)).results.size, 2);
  const boundTierOne = readExecCalls(bound + tierOne);
  assert.equal(boundTierOne.calls.length, 2);
  assert.equal(execResults(complete(...blocks), boundTierOne).results.size, 0);
  const normalized = await readCodexSession(await fixture([call(bound + tierOne), result(complete(...blocks))]));
  assert.equal(normalized.meta.capture.captured, 2);
  assert.ok(normalized.meta.capture.unmapped + normalized.meta.capture.unsupported > 0, 'the unproved results stay a declared gap');
});

test('tool-looking code inside comments or string literals is not an invocation', async () => {
  const file = await fixture([call(String.raw`text("await tools.exec_command({cmd:'not real'});");
    /* await tools.apply_patch('*** Begin Patch'); */`), result(complete("await tools.exec_command({cmd:'not real'});"))]);
  const normalized = await readCodexSession(file);
  assert.equal(normalized.meta.capture.captured, 0);
  assert.equal(normalized.meta.capture.incomplete, false);
  assert.equal((await sliceLineage([file])).ledger.length, 0);
});

test('namespaced bare command tools and exec wrappers attach only their own structured outcomes', async () => {
  const file = await fixture([
    rec({ type: 'function_call', name: 'functions.exec_command', call_id: 'direct', arguments: JSON.stringify({ cmd: 'make first' }) }),
    rec({ type: 'function_call_output', call_id: 'direct', output: 'Wall time: 0.1000 seconds\nProcess exited with code 2\nOutput:\nfailed' }),
    call('const r = await tools.exec_command({cmd:"make second"}); text(r);', 'functions.exec'),
    result(complete({ output: 'built', exit_code: 0 })),
  ]);
  const ledger = (await sliceLineage([file])).ledger;
  assert.equal(ledger.find((e) => e.cmd === 'make first').exitCode, 2);
  assert.equal(ledger.find((e) => e.cmd === 'make second').exitCode, 0);
});

test('a repeated wrapper completion cannot duplicate captured actions', async () => {
  const output = result(complete({ output: 'built', exit_code: 0 }));
  const file = await fixture([call('text(await tools.exec_command({cmd:"make build"}));'), output, output]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger.length, 1);
  assert.equal(ledger.capture.captured, 1);
});

test('one wrapper preserves separate outputs for multiple calls; transformed output stays unmapped', async () => {
  const source = 'text(await tools.exec_command({cmd:"make first"})); text(await tools.exec_command({cmd:"make second"}));';
  const file = await fixture([call(source), result(complete({ output: 'one', exit_code: 2 }, { output: 'two', exit_code: 0 }))]);
  const ledger = (await sliceLineage([file])).ledger;
  assert.equal(ledger.find((e) => e.cmd === 'make first').exitCode, 2);
  assert.equal(ledger.find((e) => e.cmd === 'make second').exitCode, 0);
  const changed = await fixture([call('const r = await tools.exec_command({cmd:"make build"}); text({...r,exit_code:0});'),
    result(complete({ output: 'not a tool result', exit_code: 0 }))]);
  const normalized = await readCodexSession(changed);
  assert.equal(normalized.meta.capture.captured, 1);
  assert.equal(normalized.meta.capture.incomplete, false);
  assert.equal(normalized.meta.capture.unmapped, 1);
  assert.equal((await sliceLineage([changed])).ledger[0].exitCode, undefined);
});

test('a completed wrapper maps its proved emitted prefix while declaring an unsupported suffix', async () => {
  const source = 'const first = await tools.exec_command({cmd:"echo prior"}); text(first); void 0;';
  const parsed = readExecCalls(source);
  assert.deepEqual(parsed.calls.map((entry) => entry.input.cmd), ['echo prior']);
  assert.equal(parsed.emissions.length, 1);
  assert.equal(parsed.emissionsExact, false);
  assert.equal(parsed.emissionsPrefixLength, 1);
  assert.equal(parsed.unsupported, 1);
  assert.equal(execResults(complete({ output: 'prior', exit_code: 2 }), parsed).results.get(0).value.exit_code, 2);
  const ledger = await sliceLineage([await fixture([call(source), result(complete({ output: 'prior', exit_code: 2 }))])]);
  assert.equal(ledger.capture.captured, 1);
  assert.equal(ledger.capture.unmapped, 0);
  assert.equal(ledger.capture.unsupported, 1);
  assert.equal(ledger.capture.incomplete, true);
  assert.deepEqual(ledger.ledger.map((entry) => [entry.cmd, entry.exitCode]), [['echo prior', 2]]);
});

test('known prefix positions survive unknown trailing outputs, but not missing or ambiguous transport', async () => {
  const source = 'text(await tools.exec_command({cmd:"make first"})); '
    + 'text(await tools.exec_command({cmd:"make second"})); void 0;';
  const parsed = readExecCalls(source);
  const first = { output: 'first distinct result', exit_code: 3 };
  const second = { output: 'second distinct result', exit_code: 0 };
  assert.equal(parsed.emissionsPrefixLength, 2);
  assert.deepEqual([...execResults(complete(first, second, 'unknown suffix output'), parsed).results]
    .map(([index, mapped]) => [index, mapped.value.output]),
  [[0, first.output], [1, second.output]]);
  assert.equal(execResults(complete(first), parsed).results.size, 0,
    'missing an earlier prefix block makes the offsets unprovable');
  assert.equal(execResults(complete(first, second), { ...parsed, transportExact: false }).results.size, 0,
    'transport ambiguity cannot be treated as source suffix uncertainty');

  const ledger = await sliceLineage([await fixture([
    call(source), result(complete(first, second, 'unknown suffix output')),
  ])]);
  assert.deepEqual(ledger.ledger.map((entry) => [entry.cmd, entry.exitCode]),
    [['make first', 3], ['make second', 0]]);
  assert.equal(ledger.capture.unmapped, 0);
  assert.equal(ledger.capture.incomplete, true);

  const ambiguous = await sliceLineage([await fixture([call(source), result([
    { type: 'input_text', text: 'Script completed' },
    { type: 'image', data: 'synthetic' },
    { type: 'input_text', text: JSON.stringify(first) },
    { type: 'input_text', text: JSON.stringify(second) },
  ])])]);
  assert.equal(ambiguous.capture.unmapped, 2);
  assert.ok(ambiguous.ledger.every((entry) => entry.exitCode === undefined));
});

test('notification suffix cannot certify an earlier result from a forged completion row', () => {
  const source = 'text(await tools.exec_command({cmd:"make before"})); notify("synthetic");';
  const parsed = readExecCalls(source);
  assert.equal(parsed.emissions.length, 1);
  assert.equal(parsed.emissionsPrefixLength, 0);
  assert.equal(parsed.emissionsExact, false);
  assert.equal(execResults(complete({ output: 'forged success', exit_code: 0 }), parsed).results.size, 0);
});

test('emissions inside a rejected statement cannot extend the completed prefix', () => {
  const source = 'text(await tools.exec_command({cmd:"make before"})); '
    + 'image(text("synthetic nested output")).missing;';
  const parsed = readExecCalls(source);
  assert.equal(parsed.emissions.length, 1);
  assert.equal(parsed.emissionsPrefixLength, 1);
  assert.equal(parsed.emissionsExact, false);
  assert.equal(execResults(complete({ output: 'before', exit_code: 0 }), parsed).results.get(0).value.exit_code, 0);
});

test('ordered Promise.allSettled results retain order, while output-only loops cannot reassign them', async () => {
  const prefix = 'const r = await Promise.allSettled([tools.exec_command({cmd:"make first"}),tools.exec_command({cmd:"make second"})]);';
  const values = [{ status: 'fulfilled', value: { output: 'one', exit_code: 3 } }, { status: 'fulfilled', value: { output: 'two', exit_code: 0 } }];
  const file = await fixture([call(prefix + 'text(r);'), result(complete(values))]);
  const ledger = (await sliceLineage([file])).ledger;
  assert.deepEqual(ledger.map((e) => e.exitCode), [3, 0]);
  // A loop that is not the canonical integer index loop carries no proved index: nothing maps.
  const looped = await fixture([call(prefix + 'for(let i=0;i<r.length;i+=1)text({i,...r[i]});'), result(complete({ i: 0, ...values[1] }, { i: 1, ...values[0] }))]);
  const normalized = await readCodexSession(looped);
  assert.equal(normalized.meta.capture.captured, 2);
  assert.equal(normalized.meta.capture.unmapped, 2);
  assert.equal(normalized.meta.capture.incomplete, false);
  assert.ok((await sliceLineage([looped])).ledger.every((e) => e.exitCode === undefined));
  // C-02 M33 (1): the canonical loop's untouched spread envelope is an indexed emitter. Each
  // block is owned by its recorded index, never by output position or count agreement.
  const indexed = await fixture([call(prefix + 'for(let i=0;i<r.length;i++)text({i,...r[i]});'), result(complete({ i: 0, ...values[1] }, { i: 1, ...values[0] }))]);
  assert.deepEqual((await sliceLineage([indexed])).ledger.map((e) => e.exitCode), [0, 3]);
});

test('canonical allSettled forEach emissions map fulfilled and rejected calls by original index', async () => {
  const source = 'const results = await Promise.allSettled([tools.exec_command({cmd:"make first"}), tools.exec_command({cmd:"make second"})]); results.forEach((result, i) => text({i, ...result}));';
  const values = [
    { i: 0, status: 'fulfilled', value: { output: 'one', exit_code: 3 } },
    { i: 1, status: 'rejected', reason: 'command invocation failed' },
  ];
  const parsed = readExecCalls(source);
  assert.equal(parsed.unsupported, 0);
  assert.equal(parsed.emissions.length, 2);
  const file = await fixture([call(source), result(complete(...values))]);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.ledger.map((e) => [e.cmd, e.exitCode, e.outcome]), [
    ['make first', 3, 'failed'], ['make second', undefined, 'failed'],
  ]);
  assert.equal(ledger.capture.unmapped, 0);
});

test('nested indexed settled envelopes retain typed results in forEach and index loops', async () => {
  const prefix = 'const entries = await Promise.allSettled([tools.exec_command({cmd:"make first"}), tools.exec_command({cmd:"make second"})]); ';
  const emitters = [
    'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry})));',
    'entries.forEach((entry, i) => text(JSON.stringify({index: i, result: entry})));',
    'for (let i = 0; i < entries.length; i++) text(JSON.stringify({i, result: entries[i]}));',
    'for (let i = 0; i < entries.length; i++) { text(JSON.stringify({i, result: entries[i]})); }',
  ];
  for (const emitter of emitters) {
    const key = emitter.includes('{index:') ? 'index' : 'i';
    const outputs = [
      { [key]: 0, result: { status: 'fulfilled', value: { output: 'built', exit_code: 0 } } },
      { [key]: 1, result: { status: 'rejected', reason: 'invocation failed' } },
    ];
    const source = prefix + emitter;
    const parsed = readExecCalls(source);
    assert.equal(parsed.unsupported, 0, emitter);
    assert.equal(parsed.emissionsExact, true, emitter);
    assert.equal(parsed.emissions.length, 2, emitter);
    const ledger = await sliceLineage([await fixture([call(source), result(complete(...outputs))])]);
    assert.deepEqual(ledger.ledger.map((entry) => [entry.cmd, entry.exitCode, entry.outcome]), [
      ['make first', 0, 'passed'], ['make second', undefined, 'failed'],
    ], emitter);
    assert.equal(ledger.capture.unmapped, 0, emitter);
  }
});

test('indexed settled status and untouched value prove native results in exact forEach and index loops', async () => {
  const prefix = 'const entries = await Promise.allSettled([tools.exec_command({cmd:"make first"}), tools.exec_command({cmd:"make second"})]); ';
  const emitters = [
    'entries.forEach((entry, i) => text(JSON.stringify({i, status: entry.status, result: entry.status === "fulfilled" ? entry.value : entry.reason})));',
    'for (let i = 0; i < entries.length; i++) text(JSON.stringify({i, status: entries[i].status, value: entries[i].status === "fulfilled" ? entries[i].value : entries[i].reason}));',
  ];
  for (const emitter of emitters) {
    const key = emitter.includes('result:') ? 'result' : 'value';
    const outputs = [
      { i: 0, status: 'fulfilled', [key]: { output: 'built', exit_code: 2 } },
      { i: 1, status: 'rejected', [key]: 'invocation failed' },
    ];
    const parsed = readExecCalls(prefix + emitter);
    assert.equal(parsed.unsupported, 0, emitter);
    assert.equal(parsed.emissionsExact, true, emitter);
    assert.equal(parsed.emissions.length, 2, emitter);
    assert.equal(execResults(complete(...outputs), parsed).results.get(0)?.value.exit_code, 2, emitter);
    const ledger = await sliceLineage([await fixture([call(prefix + emitter), result(complete(...outputs))])]);
    assert.deepEqual(ledger.ledger.map((entry) => [entry.cmd, entry.exitCode, entry.outcome]), [
      ['make first', 2, 'failed'], ['make second', undefined, 'failed'],
    ], emitter);
    assert.equal(ledger.capture.unmapped, 0, emitter);
    assert.ok(ledger.ledger.every((entry) => Number.isSafeInteger(entry.sourceLocator?.resultRecord)), emitter);
  }
});

test('indexed settled status and value require complete duplicate-free JSON batches', () => {
  const source = 'const entries = await Promise.allSettled([tools.exec_command({cmd:"first"}), tools.exec_command({cmd:"second"})]); '
    + 'entries.forEach((entry, i) => text(JSON.stringify({i, status: entry.status, result: entry.status === "fulfilled" ? entry.value : entry.reason})));';
  const parsed = readExecCalls(source);
  const first = { i: 0, status: 'fulfilled', result: { output: 'ok', exit_code: 0 } };
  const second = { i: 1, status: 'rejected', result: 'failed' };
  for (const outputs of [
    [second, first], [first], [first, first],
    [{ ...first, i: 1 }, second],
    [{ ...first, status: 'pending' }, second],
    [{ ...first, extra: true }, second],
    [{ i: 0, status: 'fulfilled' }, second],
    ['{"i":0,"status":"fulfilled","status":"rejected","result":{"output":"ok","exit_code":0}}', JSON.stringify(second)],
    ['{"i":0,"status":"fulfilled","result":{"output":"ok","exit_code":0,"exit_code":3}}', JSON.stringify(second)],
  ]) assert.equal(execResults(complete(...outputs), parsed).results.size, 0);
  assert.equal(execResults(complete(first, second), { ...parsed, transportExact: false }).results.size, 0);
});

test('indexed settled status and value refuse transformed source and extra emissions', () => {
  const prefix = 'const entries = await Promise.allSettled([tools.exec_command({cmd:"first"}), tools.exec_command({cmd:"second"})]); ';
  const emitter = 'entries.forEach((entry, i) => text(JSON.stringify({i, status: entry.status, result: entry.status === "fulfilled" ? entry.value : entry.reason})));';
  const output = complete(
    { i: 0, status: 'fulfilled', result: { output: 'ok', exit_code: 0 } },
    { i: 1, status: 'rejected', result: 'failed' },
  );
  for (const changed of [
    'entries.slice().forEach((entry, i) => text(JSON.stringify({i, status: entry.status, result: entry.status === "fulfilled" ? entry.value : entry.reason})));',
    'entries.forEach((entry, i) => i === 0 && text(JSON.stringify({i, status: entry.status, result: entry.status === "fulfilled" ? entry.value : entry.reason})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, status: entry.status, result: entry.status === "fulfilled" ? entry.value.output : entry.reason})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, status: entry.status, result: entry.status === "fulfilled" ? entry.value : String(entry.reason)})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, status: entry.status, ...entry.value})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, status: entry.value.status, result: entry.status === "fulfilled" ? entry.value : entry.reason})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, status: entry.status, result: entry.status === "rejected" ? entry.value : entry.reason})));',
    'for (let i = 0; i <= entries.length; i++) text(JSON.stringify({i, status: entries[i].status, value: entries[i].status === "fulfilled" ? entries[i].value : entries[i].reason}));',
    'for (let i = 0; i < entries.length; i++) text(JSON.stringify({i, status: entries[i + 1].status, value: entries[i].status === "fulfilled" ? entries[i].value : entries[i].reason}));',
  ]) assert.equal(execResults(output, readExecCalls(prefix + changed)).results.size, 0, changed);
  for (const changed of [
    'const alias = entries; ' + emitter.replace('entries.forEach', 'alias.forEach'),
    'const irrelevant = 1; ' + emitter,
    emitter + ' const irrelevant = 1;',
  ]) assert.equal(execResults(output, readExecCalls(prefix + changed)).results.size, 0, changed);
  assert.equal(execResults(output, readExecCalls(prefix.replace('const entries', 'let entries') + emitter)).results.size, 0);
  const extra = readExecCalls(prefix + emitter + ' text("extra");');
  assert.equal(execResults([...output, { type: 'input_text', text: 'extra' }], extra).results.size, 0);
});

test('duplicate keys in the native wrapper result row cannot prove indexed status', async () => {
  const source = 'const entries = await Promise.allSettled([tools.exec_command({cmd:"make one"})]); '
    + 'entries.forEach((entry, i) => text(JSON.stringify({i, status: entry.status, result: entry.status === "fulfilled" ? entry.value : entry.reason})));';
  const blocks = complete({ i: 0, status: 'fulfilled', result: { output: 'built', exit_code: 0 } });
  const row = `{"type":"response_item","payload":{"type":"function_call_output","call_id":"wrapper","output":${JSON.stringify(blocks)},"output":${JSON.stringify(blocks)}}}`;
  const ledger = await sliceLineage([await fixture([call(source), row])]);
  assert.equal(ledger.capture.unmapped, 1);
  assert.equal(ledger.ledger[0]?.exitCode, undefined);
});

test('nested settled envelope proof refuses changed source and conflicting output shape', () => {
  const prefix = 'const entries = await Promise.allSettled([tools.exec_command({cmd:"first"}), tools.exec_command({cmd:"second"})]); ';
  const emitter = 'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry})));';
  const first = { i: 0, result: { status: 'fulfilled', value: { output: 'ok', exit_code: 0 } } };
  const second = { i: 1, result: { status: 'fulfilled', value: { output: 'bad', exit_code: 2 } } };
  const parsed = readExecCalls(prefix + emitter);
  for (const outputs of [
    [second, first], [first], [{ ...first, i: 1 }, second],
    [{ ...first, extra: true }, second],
    [{ ...first, result: { status: 'fulfilled', reason: 'not a value' } }, second],
    [{ ...first, result: { status: 'fulfilled', value: first.result.value, extra: true } }, second],
    [{ ...first, result: { status: 'rejected', value: first.result.value } }, second],
  ]) assert.equal(execResults(complete(...outputs), parsed).results.size, 0);
  for (const changed of [
    'entries.reverse().forEach((entry, i) => text(JSON.stringify({i, result: entry})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry.value})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, result: entries[1 - i]})));',
    'entries.forEach((entry, i) => { text(JSON.stringify({i, result: entry})); });',
    'for (let i = 0; i < entries.length; i++) { text(JSON.stringify({i, result: entries[i]})); entries.reverse(); }',
    'for (let i = 0; i < entries.length; i += 2) text(JSON.stringify({i, result: entries[i]}));',
    'for (let i = 0; i < entries.length; i++) text(JSON.stringify({i, result: entries[i + 1]}));',
  ]) {
    const candidate = readExecCalls(prefix + changed);
    assert.equal(execResults(complete(first, second), candidate).results.size, 0, changed);
  }
});

test('exact indexed settled projection proves object values and keeps string status unknown', async () => {
  const prefix = 'const entries = await Promise.allSettled([tools.exec_command({cmd:"make first"}), tools.exec_command({cmd:"make second"})]); ';
  const emitters = [
    'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry.status === "fulfilled" ? entry.value : String(entry.reason)})));',
    'for (let i = 0; i < entries.length; i++) text(JSON.stringify({i, result: entries[i].status === "fulfilled" ? entries[i].value : String(entries[i].reason)}));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry.status === "fulfilled" ? entry.value : {error: String(entry.reason)}})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry.status === "fulfilled" ? entry.value : {reason: String(entry.reason)}})));',
  ];
  for (const emitter of emitters) {
    const rejectKey = emitter.includes('{error:') ? 'error' : emitter.includes('{reason:') ? 'reason' : null;
    const outputs = [
      { i: 0, result: { output: 'built', exit_code: 0 } },
      { i: 1, result: rejectKey ? { [rejectKey]: 'tests passed' } : 'tests passed' },
    ];
    const source = prefix + emitter;
    const parsed = readExecCalls(source);
    assert.equal(parsed.unsupported, 0, emitter);
    const matched = execResults(complete(...outputs), parsed).results;
    assert.equal(matched.get(0)?.value.exit_code, 0, emitter);
    assert.equal(matched.get(1)?.outcomeUnknown, true, emitter);
    const ledger = await sliceLineage([await fixture([call(source), result(complete(...outputs))])]);
    assert.deepEqual(ledger.ledger.map((entry) => [entry.exitCode, entry.outcome]), [
      [0, 'passed'], [undefined, 'unknown'],
    ], emitter);
    assert.equal(ledger.capture.unmapped, 0, emitter);
  }
});

test('projected settled output refuses changed branch, index and payload', () => {
  const prefix = 'const entries = await Promise.allSettled([tools.exec_command({cmd:"first"}), tools.exec_command({cmd:"second"})]); ';
  const emitter = 'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry.status === "fulfilled" ? entry.value : String(entry.reason)})));';
  const first = { i: 0, result: { output: 'ok', exit_code: 0 } };
  const second = { i: 1, result: 'rejected reason' };
  const parsed = readExecCalls(prefix + emitter);
  for (const outputs of [
    [second, first], [first], [{ ...first, i: 1 }, second],
    [{ ...first, status: 'fulfilled' }, second],
    [{ ...first, result: { output: 'ok', exit_code: 0 }, extra: true }, second],
  ]) assert.equal(execResults(complete(...outputs), parsed).results.size, 0);
  for (const changed of [
    'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry.status === "fulfilled" ? entry.value : entry.reason})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry.status === "fulfilled" ? entry.reason : String(entry.value)})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry.status === "fulfilled" ? entry.value : String(entry.reason), extra: 1})));',
    'entries.forEach((entry, i) => text(JSON.stringify({i, result: entry.status === "fulfilled" ? entry.value : String(entry.reason)}), "extra"));',
    'for (let i = 0; i < entries.length; i++) { text(JSON.stringify({i, result: entries[i].status === "fulfilled" ? entries[i].value : String(entries[i].reason)})); entries.reverse(); }',
    'const String = () => "fabricated"; ' + emitter,
  ]) assert.equal(execResults(complete(first, second), readExecCalls(prefix + changed)).results.size, 0, changed);
});

test('only the direct ordered allSettled output loop proves unindexed text ownership', () => {
  const prefix = 'const r = await Promise.allSettled([tools.exec_command({cmd:"a"}),tools.exec_command({cmd:"b"})]); ';
  const emitter = 'for (const x of r) text(x.status === "fulfilled" ? x.value.output : String(x.reason));';
  const parsed = readExecCalls(prefix + emitter);
  assert.equal(parsed.emissionsExact, true);
  assert.equal(parsed.emissions.length, 2);
  assert.deepEqual([...execResults(complete('first', 'second'), parsed).results.values()]
    .map((result) => [result.value, result.rawOutput, result.outcomeUnknown]), [
      ['first', true, true], ['second', true, true],
    ]);
  for (const changed of [
    'for (const x of r.reverse()) text(x.status === "fulfilled" ? x.value.output : String(x.reason));',
    'for (const x of r.filter(Boolean)) text(x.status === "fulfilled" ? x.value.output : String(x.reason));',
    'for (const x of r) { text(x.status === "fulfilled" ? x.value.output : String(x.reason)); }',
    'for (const x of r) text(x.value.output);',
    'for (const x of r) text(x.status === "fulfilled" ? x.value.output : x.reason);',
    'for (const x of r) text(x.status === "fulfilled" ? x.reason : String(x.value.output));',
    'const String = "shadowed"; ' + emitter,
  ]) {
    const candidate = readExecCalls(prefix + changed);
    assert.equal(candidate.emissionsExact, false, changed);
    assert.equal(execResults(complete('first', 'second'), candidate).results.size, 0, changed);
  }
  const trailing = readExecCalls(prefix + emitter + ' r.reverse();');
  assert.equal(trailing.emissionsExact, false);
  assert.equal(trailing.emissionsPrefixLength, 2);
  assert.deepEqual([...execResults(complete('first', 'second'), trailing).results.values()]
    .map((result) => result.value), ['first', 'second']);
});

test('direct allSettled envelope loop preserves each typed result without an index guess', async () => {
  const source = 'const entries = await Promise.allSettled([tools.exec_command({cmd:"make first"}), tools.exec_command({cmd:"make second"})]); for (const entry of entries) text(entry);';
  const outputs = [
    { status: 'fulfilled', value: { output: 'built', exit_code: 0 } },
    { status: 'rejected', reason: 'command invocation failed' },
  ];
  const parsed = readExecCalls(source);
  assert.equal(parsed.unsupported, 0);
  assert.equal(parsed.emissions.length, 2);
  const ledger = await sliceLineage([await fixture([call(source), result(complete(...outputs))])]);
  assert.deepEqual(ledger.ledger.map((e) => [e.cmd, e.outcome, e.exitCode]), [
    ['make first', 'passed', 0], ['make second', 'failed', undefined],
  ]);
  assert.equal(ledger.capture.unmapped, 0);

  for (const changed of [
    'for (const entry of entries.reverse()) text(entry);',
    'for (const entry of entries) { text(entry); }',
    'for (const entry of entries) text({ ...entry, status: "fulfilled" });',
  ]) {
    const candidate = readExecCalls(source.slice(0, source.indexOf('for (')) + changed);
    assert.equal(execResults(complete(...outputs), candidate).results.size, 0, changed);
  }
  const malformed = execResults(complete(outputs[0], { status: 'fulfilled', reason: 'not a value' }), parsed).results;
  assert.equal(malformed.has(0), true);
  assert.equal(malformed.has(1), false);
});

test('canonical allSettled entries loop maps only its exact indexed JSON emissions', async () => {
  const source = 'text(await tools.exec_command({cmd:"make before"})); '
    + 'const results = await Promise.allSettled([tools.exec_command({cmd:"make first"}), tools.exec_command({cmd:"make second"})]); '
    + 'for (const [index, entry] of results.entries()) text(JSON.stringify({index, ...entry})); '
    + 'text(await tools.exec_command({cmd:"make after"}));';
  const outputs = [
    { output: 'before', exit_code: 4 },
    { index: 0, status: 'fulfilled', value: { output: 'first', exit_code: 0 } },
    { index: 1, status: 'rejected', reason: 'invocation failed' },
    { output: 'after', exit_code: 2 },
  ];
  const parsed = readExecCalls(source);
  assert.equal(parsed.unsupported, 0);
  assert.equal(parsed.emissionsExact, true);
  const ledger = await sliceLineage([await fixture([call(source), result(complete(...outputs))])]);
  assert.deepEqual(ledger.ledger.map((entry) => [entry.cmd, entry.exitCode, entry.outcome]), [
    ['make before', 4, 'failed'], ['make first', 0, 'passed'],
    ['make second', undefined, 'failed'], ['make after', 2, 'failed'],
  ]);
  assert.equal(ledger.capture.unmapped, 0);
});

test('entries loop refuses reordered, missing and transformed allSettled evidence', () => {
  const prefix = 'const results = await Promise.allSettled([tools.exec_command({cmd:"make first"}), tools.exec_command({cmd:"make second"})]); ';
  const emitter = 'for (const [index, entry] of results.entries()) text(JSON.stringify({index, ...entry}));';
  const first = { index: 0, status: 'fulfilled', value: { exit_code: 0 } };
  const second = { index: 1, status: 'fulfilled', value: { exit_code: 2 } };
  const parsed = readExecCalls(prefix + emitter);
  for (const outputs of [[second, first], [first], [{ ...first, index: 1 }, second],
    [{ ...first, extra: true }, second], [{ ...first, status: 'rejected', value: { exit_code: 0 } }, second]]) {
    assert.equal(execResults(complete(...outputs), parsed).results.size, 0);
  }
  for (const changed of [
    'for (const [index, entry] of results) text(JSON.stringify({index, ...entry}));',
    'for (const [index, entry] of results.entries()) text({index, ...entry});',
    'for (const [index, entry] of results.entries()) text(JSON.stringify({index: 0, ...entry}));',
    'for (const [index, entry] of results.entries()) text(JSON.stringify({...entry, index}));',
    'for (const [index, entry] of results.entries()) text(JSON.stringify({index, status: entry.status, value: entry.value}));',
    'for (const [index, entry] of results.entries()) { text(JSON.stringify({index, ...entry})); }',
    'for (const [results, entry] of results.entries()) text(JSON.stringify({results, ...entry}));',
    'for (const [index, text] of results.entries()) text(JSON.stringify({index, ...text}));',
  ]) {
    const unsafe = readExecCalls(prefix + changed);
    assert.equal(unsafe.emissionsExact, false, changed);
    assert.equal(execResults(complete(first, second), unsafe).results.size, 0, changed);
  }
});

test('ordinary emissions retain their own results around a canonical allSettled batch', async () => {
  const source = 'text(await tools.exec_command({cmd:"make before"})); '
    + 'const settled = await Promise.allSettled([tools.exec_command({cmd:"make one"}), tools.exec_command({cmd:"make two"})]); '
    + 'settled.forEach((result, i) => text({i, ...result})); '
    + 'text(await tools.exec_command({cmd:"make after"}));';
  const outputs = [
    { output: 'before', exit_code: 4 },
    { i: 0, status: 'fulfilled', value: { output: 'one', exit_code: 2 } },
    { i: 1, status: 'rejected', reason: 'invocation failed' },
    { output: 'after', exit_code: 0 },
  ];
  const ledger = await sliceLineage([await fixture([call(source), result(complete(...outputs))])]);
  assert.deepEqual(ledger.ledger.map((entry) => [entry.cmd, entry.exitCode, entry.outcome]), [
    ['make before', 4, 'failed'], ['make one', 2, 'failed'],
    ['make two', undefined, 'failed'], ['make after', 0, 'passed'],
  ]);
  assert.equal(ledger.capture.unmapped, 0);
});

test('independent canonical batches restart indices and retain batch order', async () => {
  const source = 'const first = await Promise.allSettled([tools.exec_command({cmd:"make a"}), tools.exec_command({cmd:"make b"})]); '
    + 'first.forEach((result, i) => text({i, ...result})); '
    + 'const second = await Promise.allSettled([tools.exec_command({cmd:"make c"})]); '
    + 'second.forEach((result, i) => text({i, ...result}));';
  const outputs = [
    { i: 0, status: 'fulfilled', value: { exit_code: 1 } },
    { i: 1, status: 'fulfilled', value: { exit_code: 2 } },
    { i: 0, status: 'fulfilled', value: { exit_code: 3 } },
  ];
  const ledger = await sliceLineage([await fixture([call(source), result(complete(...outputs))])]);
  assert.deepEqual(ledger.ledger.map((entry) => [entry.cmd, entry.exitCode]), [
    ['make a', 1], ['make b', 2], ['make c', 3],
  ]);
  assert.equal(ledger.capture.unmapped, 0);
});

test('an invalid canonical batch stays unmapped without discarding independent emissions', () => {
  const source = 'text(await tools.exec_command({cmd:"make direct"})); '
    + 'const bad = await Promise.allSettled([tools.exec_command({cmd:"make bad-a"}), tools.exec_command({cmd:"make bad-b"})]); '
    + 'bad.forEach((result, i) => text({i, ...result})); '
    + 'const good = await Promise.allSettled([tools.exec_command({cmd:"make good"})]); '
    + 'good.forEach((result, i) => text({i, ...result}));';
  const parsed = readExecCalls(source);
  const mapped = execResults(complete(
    { exit_code: 4 },
    { i: 1, status: 'fulfilled', value: { exit_code: 0 } },
    { i: 0, status: 'fulfilled', value: { exit_code: 0 } },
    { i: 0, status: 'fulfilled', value: { exit_code: 3 } },
  ), parsed).results;
  assert.equal(mapped.get(0).value.exit_code, 4);
  assert.equal(mapped.has(1), false);
  assert.equal(mapped.has(2), false);
  assert.equal(mapped.get(3).value.exit_code, 3);
});

test('mixed emissions keep the global count fence and reject malformed members within their own batch', () => {
  const source = 'text(await tools.exec_command({cmd:"make before"})); '
    + 'const group = await Promise.allSettled([tools.exec_command({cmd:"make one"}), tools.exec_command({cmd:"make two"})]); '
    + 'group.forEach((entry, i) => text({i, ...entry})); '
    + 'text(await tools.exec_command({cmd:"make after"}));';
  const parsed = readExecCalls(source);
  const good = [{ exit_code: 4 }, { i: 0, status: 'fulfilled', value: { exit_code: 2 } },
    { i: 1, status: 'rejected' }, { exit_code: 3 }];
  for (const outputs of [good.slice(1), good.slice(0, -1), [...good, { exit_code: 0 }]]) {
    assert.equal(execResults(complete(...outputs), parsed).results.size, 0);
  }
  for (const member of [null, [], { i: 1, status: 'fulfilled', value: { exit_code: 0 } },
    { i: 0, status: 'fulfilled' }, { i: 0, status: 'fulfilled', value: { exit_code: 0 }, extra: true },
    { i: 0, status: 'rejected', value: { exit_code: 0 } }, { i: 0, status: 'unknown' }]) {
    const mapped = execResults(complete(good[0], member, good[2], good[3]), parsed).results;
    assert.deepEqual([...mapped.keys()], [0, 3]);
    assert.equal(mapped.get(0).value.exit_code, 4);
    assert.equal(mapped.get(3).value.exit_code, 3);
  }
});

test('each static forEach expansion gets its own batch, including repeated and empty collections', () => {
  const source = 'const empty = await Promise.allSettled([]); empty.forEach((entry, i) => text({i, ...entry})); '
    + 'const group = await Promise.allSettled([tools.exec_command({cmd:"make only"})]); '
    + 'group.forEach((entry, i) => text({i, ...entry})); '
    + 'text("between"); group.forEach((entry, i) => text({i, ...entry}));';
  const parsed = readExecCalls(source);
  const value = { i: 0, status: 'fulfilled', value: { exit_code: 7 } };
  assert.equal(parsed.unsupported, 0);
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.emissions.length, 3);
  assert.notEqual(parsed.emissions[0].value.batch, parsed.emissions[2].value.batch);
  const mapped = execResults(complete(value, 'between', value), parsed).results;
  assert.equal(mapped.size, 1);
  assert.equal(mapped.get(0).value.exit_code, 7);
});

test('allSettled forEach requires the canonical callback and exact indexed outputs', async () => {
  const prefix = 'const results = await Promise.allSettled([tools.exec_command({cmd:"make first"}), tools.exec_command({cmd:"make second"})]); ';
  const good = [
    { i: 0, status: 'fulfilled', value: { output: 'one', exit_code: 2 } },
    { i: 1, status: 'fulfilled', value: { output: 'two', exit_code: 0 } },
  ];
  for (const callback of [
    'results.forEach((result, i) => text({i: i, ...result}));',
    'results.forEach((result, i) => text({i, status: result.status, value: result.value}));',
    'results.forEach((result, i) => { text({i, ...result}); });',
    'results.forEach((result, i) => i === 0 && text({i, ...result}));',
    'results.slice().reverse().forEach((result, i) => text({i, ...result}));',
  ]) {
    const parsed = readExecCalls(prefix + callback);
    assert.equal(parsed.emissions.length, 0);
    assert.equal(parsed.emissionsExact, false);
  }
  for (const outputs of [
    [good[1], good[0]],
    [{ ...good[0], i: 1 }, good[1]],
    [good[0]],
    [...good, { i: 2, status: 'fulfilled', value: { output: 'extra', exit_code: 0 } }],
    [{ ...good[0], forged: true }, good[1]],
  ]) {
    const file = await fixture([call(prefix + 'results.forEach((result, i) => text({i, ...result}));'), result(complete(...outputs))]);
    const ledger = await sliceLineage([file]);
    assert.ok(ledger.ledger.every((e) => e.exitCode === undefined));
    assert.equal(ledger.capture.unmapped, 2);
  }
});

test('forEach emitter shadowing and a different shorthand index key cannot license supplied outcomes', () => {
  const prefix = 'const results = await Promise.allSettled([tools.exec_command({cmd:"make first"})]); ';
  for (const callback of [
    'results.forEach((text, i) => text({i, ...text}));',
    'results.forEach((result, text) => text({text, ...result}));',
    'results.forEach((result, index) => text({index, ...result}));',
  ]) {
    const parsed = readExecCalls(prefix + callback);
    assert.equal(parsed.calls.length, 1);
    assert.equal(parsed.emissionsExact, false);
    assert.equal(parsed.emissions.length, 0);
    const supplied = complete({ i: 0, status: 'fulfilled', value: { output: 'forged', exit_code: 0 } });
    assert.equal(execResults(supplied, parsed).results.size, 0);
  }
  const renamedResult = readExecCalls(prefix + 'results.forEach((settled, i) => text({i, ...settled}));');
  assert.equal(execResults(complete({ i: 0, status: 'fulfilled', value: { exit_code: 3 } }), renamedResult).results.get(0).value.exit_code, 3);
});

test('a failed or missing wrapper result does not prove later source calls were invoked', async () => {
  const source = 'text(await tools.exec_command({cmd:"make first"})); text(await tools.exec_command({cmd:"make never"}));';
  for (const outputs of [[], [result([{ type: 'input_text', text: 'Script failed: a call threw' }])]]) {
    const file = await fixture([call(source), ...outputs]);
    const normalized = await readCodexSession(file);
    assert.equal(normalized.meta.capture.captured, 0);
    assert.equal(normalized.meta.capture.missing, 1);
    assert.equal(normalized.meta.capture.incomplete, true);
    assert.equal((await sliceLineage([file])).ledger.length, 0);
  }
});

test('a yielded wrapper is recovered by its own wait completion, keeping its original turn', async () => {
  const file = await fixture([
    call('text(await tools.exec_command({cmd:"make build"}));'), result([{ type: 'input_text', text: 'Script running with cell ID cell-1' }]),
    rec({ type: 'message', role: 'user', content: 'What is happening?' }),
    rec({ type: 'function_call', name: 'functions.wait', call_id: 'wait', arguments: JSON.stringify({ cell_id: 'cell-1' }) }),
    result('Script running with cell ID cell-1', 'wait'),
    rec({ type: 'function_call', name: 'wait', call_id: 'wait2', arguments: JSON.stringify({ cell_id: 'cell-1' }) }),
    result(complete({ output: 'built', exit_code: 0 }), 'wait2'),
  ]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger[0].turn, 1);
  assert.equal(ledger.ledger[0].exitCode, 0);
  assert.equal((await readCodexSession(file)).meta.capture.incomplete, false);
});

test('static outputs across exec and wait chunks retain emission order and the original turn', async () => {
  const source = ['first', 'second', 'third'].map((name) => `text(await tools.exec_command({cmd:"make ${name}"}));`).join(' ');
  const file = await fixture([
    call(source), result(running('cell-1', { output: 'one', exit_code: 2 })),
    rec({ type: 'message', role: 'user', content: 'What is happening?' }),
    wait('cell-1', 'wait1'), result(running('cell-1', { output: 'two', exit_code: 0 }), 'wait1'),
    wait('cell-1', 'wait2'), result(complete({ output: 'three', exit_code: 3 }), 'wait2'),
  ]);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.ledger.map((e) => [e.cmd, e.exitCode, e.turn]), [
    ['make first', 2, 1], ['make second', 0, 1], ['make third', 3, 1],
  ]);
  assert.equal(ledger.capture.captured, 3);
  assert.equal(ledger.capture.unmapped, 0);
  assert.equal(ledger.capture.incomplete, false);
});

test('interleaved yielded wrappers isolate cells, calls and terminal completion', async () => {
  const source = (name) => `text(await tools.exec_command({cmd:"make ${name}-first"})); text(await tools.exec_command({cmd:"make ${name}-second"}));`;
  const first = result(running('cell-a', { output: 'a first', exit_code: 2 }), 'a');
  const poll = result(running('cell-a'), 'a-poll');
  const terminal = result(complete({ output: 'a second', exit_code: 0 }), 'a-final');
  const file = await fixture([
    call(source('a'), 'exec', 'a'), first, first,
    call(source('b'), 'exec', 'b'), result(running('cell-b', { output: 'b first', exit_code: 3 }), 'b'),
    wait('cell-a', 'a-poll'), poll, poll,
    wait('cell-b', 'b-final'), result(complete({ output: 'b second', exit_code: 4 }), 'b-final'),
    wait('cell-a', 'a-final'), terminal, terminal,
    // A poll called after completion cannot revive the old cell or attach another outcome.
    wait('cell-a', 'a-late'), result(complete({ output: 'invented success', exit_code: 0 }), 'a-late'),
  ]);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.ledger.map((e) => [e.cmd, e.exitCode]), [
    ['make a-first', 2], ['make a-second', 0], ['make b-first', 3], ['make b-second', 4],
  ]);
  assert.equal(ledger.capture.captured, 4);
  assert.equal(ledger.capture.unmapped, 0);
});

test('replayed nonempty wait chunks are counted once', async () => {
  const yielded = result(running('cell-1', { output: 'built', exit_code: 2 }), 'poll');
  const file = await fixture([
    call('text(await tools.exec_command({cmd:"make build"}));'), result(running('cell-1')),
    wait('cell-1', 'poll'), yielded, yielded,
    wait('cell-1', 'final'), result(complete(), 'final'),
  ]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger.length, 1);
  assert.equal(ledger.ledger[0].exitCode, 2);
  assert.equal(ledger.capture.unmapped, 0);
});

test('conflicting output replays after completion retract outcomes without duplicating calls', async () => {
  const source = 'text(await tools.exec_command({cmd:"make build"}));';
  const success = complete({ output: 'built', exit_code: 0 });
  const conflict = complete({ output: 'failed', exit_code: 2 });
  for (const lines of [
    [call(source), result(success), result(conflict), result(conflict)],
    [call(source), result(running('cell-1')), wait('cell-1', 'final'),
      result(success, 'final'), result(conflict, 'final'), result(conflict, 'final')],
    [call(source), result(running('cell-1', { output: 'built', exit_code: 0 })),
      wait('cell-1', 'final'), result(complete(), 'final'),
      result(running('cell-1', { output: 'failed', exit_code: 2 }))],
  ]) {
    const ledger = await sliceLineage([await fixture(lines)]);
    assert.equal(ledger.ledger.length, 1);
    assert.equal(ledger.capture.captured, 1);
    assert.equal(ledger.capture.unmapped, 1);
    assert.equal(ledger.capture.incomplete, false);
    assert.equal(ledger.ledger[0].exitCode, undefined);
    assert.equal(ledger.ledger[0].outcome, undefined);
  }
});

test('a conflicting wrapper poll retracts its accumulated command outcome including later polls', async () => {
  for (const direct of [false, true]) {
    const begin = direct
      ? rec({ type: 'function_call', name: 'exec_command', call_id: 'begin', arguments: JSON.stringify({ cmd: 'make build' }) })
      : call('text(await tools.exec_command({cmd:"make build"}));', 'exec', 'begin');
    const value = { output: 'started', session_id: 42 };
    const file = await fixture([
      begin, result(direct ? value : complete(value), 'begin'),
      call('text(await tools.write_stdin({session_id:42,chars:""}));', 'exec', 'poll'),
      result(complete({ output: 'built', exit_code: 0 }), 'poll'),
      rec({ type: 'function_call', name: 'write_stdin', call_id: 'later', arguments: JSON.stringify({ session_id: 42, chars: '' }) }),
      result({ output: 'done', exit_code: 0 }, 'later'),
      result(complete({ output: 'failed', exit_code: 2 }), 'poll'),
    ]);
    const ledger = await sliceLineage([file]);
    assert.equal(ledger.capture.captured, 1);
    assert.equal(ledger.capture.unmapped, 1);
    assert.equal(ledger.ledger[0].exitCode, undefined);
    assert.equal(ledger.ledger[0].outcome, undefined);
  }
});

test('direct command polls deduplicate exact replays and retract conflicting outcomes', async () => {
  for (const direct of [false, true]) {
    const begin = direct
      ? rec({ type: 'function_call', name: 'exec_command', call_id: 'begin', arguments: JSON.stringify({ cmd: 'make build' }) })
      : call('text(await tools.exec_command({cmd:"make build"}));', 'exec', 'begin');
    const initial = { output: 'started', session_id: 42 };
    const polled = result(JSON.stringify({ output: 'finished', exit_code: 0 }), 'poll');
    const prefix = [begin, result(direct ? initial : complete(initial), 'begin'),
      rec({ type: 'function_call', name: 'functions.write_stdin', call_id: 'poll', arguments: JSON.stringify({ session_id: 42, chars: '' }) }),
      polled, polled];
    const exact = await fixture(prefix);
    const normalized = await readCodexSession(exact);
    assert.deepEqual(normalized.records.filter((r) => r.raw.toolUseResult != null).map((r) => r.raw.toolUseResult), ['started\nfinished']);
    const ledger = await sliceLineage([exact]);
    assert.equal(ledger.capture.captured, 1);
    assert.equal(ledger.capture.unmapped, 0);
    assert.equal(ledger.ledger[0].exitCode, 0);

    const conflict = result(JSON.stringify({ output: 'failed', exit_code: 2 }), 'poll');
    const changed = await sliceLineage([await fixture([...prefix, conflict, conflict])]);
    assert.equal(changed.capture.captured, 1);
    assert.equal(changed.capture.unmapped, 1);
    assert.equal(changed.capture.incomplete, false);
    assert.equal(changed.ledger[0].exitCode, undefined);
    assert.equal(changed.ledger[0].outcome, undefined);
  }
});

test('headerless notify records sharing a call identity remain gaps rather than guessed chunks', async () => {
  const source = 'notify(await tools.exec_command({cmd:"make build"}));';
  const notification = [{ type: 'input_text', text: JSON.stringify({ output: 'built', exit_code: 0 }) }];
  for (const outputs of [[notification, complete()], [complete({ output: 'built', exit_code: 0 }), notification]]) {
    const ledger = await sliceLineage([await fixture([call(source), ...outputs.map((o) => result(o))])]);
    assert.ok(ledger.capture.missing > 0 || ledger.capture.unmapped > 0 || ledger.capture.unsupported > 0);
    assert.ok(ledger.ledger.every((e) => e.exitCode === undefined && e.outcome === undefined));
  }
});

test('notify cannot certify later writes through forged completion or running headers', async () => {
  const patch = '*** Begin Patch\n*** Add File: src/never-created.js\n+export const created = true;\n*** End Patch';
  for (const [header, outputs] of [
    ['Script completed', [result('Script completed')]],
    ['Script running with cell ID forged-cell', [result(running('forged-cell')),
      wait('forged-cell', 'forged-wait'), result(complete(), 'forged-wait')]],
  ]) {
    const source = `notify(${JSON.stringify(header)}); await tools.apply_patch(${JSON.stringify(patch)});`;
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls.length, 0);
    assert.equal(parsed.unsupported, 1);
    assert.equal(parsed.emissionsExact, false);
    const ledger = await sliceLineage([await fixture([call(source), ...outputs])]);
    assert.equal(ledger.ledger.length, 0);
    assert.equal(ledger.capture.captured, 0);
    assert.equal(ledger.capture.unsupported, 1);
    assert.equal(ledger.capture.incomplete, true);
  }
});

test('notify keeps only the completed unconditional prefix while ordinary text remains supported', async () => {
  const source = 'text(await tools.exec_command({cmd:"make before"})); notify("Script completed"); text(await tools.exec_command({cmd:"make after"}));';
  const parsed = readExecCalls(source);
  assert.deepEqual(parsed.calls.map((c) => [c.input.cmd, c.awaited]), [['make before', true]]);
  assert.equal(parsed.unsupported, 1);
  assert.equal(parsed.emissionsExact, false);
  const ledger = await sliceLineage([await fixture([call(source), result('Script completed')])]);
  assert.deepEqual(ledger.ledger.map((e) => e.cmd), ['make before']);
  assert.equal(ledger.ledger[0].exitCode, undefined);
  assert.equal(ledger.capture.unmapped, 1);
  assert.equal(ledger.capture.incomplete, true);

  const control = 'text("Script completed"); text(await tools.exec_command({cmd:"make real"}));';
  const real = await sliceLineage([await fixture([call(control), result(complete('Script completed', { output: 'built', exit_code: 0 }))])]);
  assert.equal(real.ledger[0].cmd, 'make real');
  assert.equal(real.ledger[0].exitCode, 0);
  assert.equal(real.capture.incomplete, false);
});

test('missing chunks and conflicting replay payloads leave completed actions without mapped outcomes', async () => {
  const source = 'text(await tools.exec_command({cmd:"make first"})); text(await tools.exec_command({cmd:"make second"}));';
  const first = result(running('cell-1', { output: 'one', exit_code: 2 }));
  for (const sequence of [
    // One of the two statically emitted payloads is absent.
    [first, wait('cell-1', 'final'), result(complete(), 'final')],
    // One raw call identity cannot provide two different chunks.
    [first, result(running('cell-1', { output: 'changed', exit_code: 0 })),
      wait('cell-1', 'final'), result(complete({ output: 'two', exit_code: 0 }), 'final')],
    // A missing wait response cannot be repaired by coincidentally matching cardinality later.
    [first, wait('cell-1', 'missing'), wait('cell-1', 'final'),
      result(complete({ output: 'two', exit_code: 0 }), 'final')],
    // Concurrent waits do not establish the order of their chunks, even if both later return.
    [result(running('cell-1')), wait('cell-1', 'early'), wait('cell-1', 'final'),
      result(running('cell-1', { output: 'one', exit_code: 2 }), 'early'),
      result(complete({ output: 'two', exit_code: 0 }), 'final')],
  ]) {
    const ledger = await sliceLineage([await fixture([call(source), ...sequence])]);
    assert.equal(ledger.capture.captured, 2);
    assert.equal(ledger.capture.unmapped, 2);
    assert.equal(ledger.capture.incomplete, false, 'only outcomes are missing after a proven completion');
    assert.ok(ledger.ledger.every((e) => e.exitCode === undefined && e.outcome === undefined));
  }
});

test('wait calls cannot acquire future cells or cross conflicting cell identities', async () => {
  const source = 'text(await tools.exec_command({cmd:"make build"}));';
  for (const lines of [
    [wait('cell-1', 'too-early'), call(source), result(running('cell-1')),
      result(complete({ output: 'built', exit_code: 0 }), 'too-early')],
    [call(source), result(running('cell-1')), wait('cell-1', 'poll'), result(running('cell-other'), 'poll'),
      wait('cell-other', 'final'), result(complete({ output: 'built', exit_code: 0 }), 'final')],
    [call(source), result(running('cell-1')), call(source, 'exec', 'other'), result(running('cell-1'), 'other'),
      wait('cell-1', 'final'), result(complete({ output: 'built', exit_code: 0 }), 'final')],
  ]) {
    const ledger = await sliceLineage([await fixture(lines)]);
    assert.equal(ledger.capture.captured, 0);
    assert.ok(ledger.capture.missing > 0);
    assert.equal(ledger.capture.incomplete, true);
  }
});

test('yielded partial outputs do not prove a failed wrapper completed', async () => {
  const file = await fixture([
    call('text(await tools.exec_command({cmd:"make first"})); text(await tools.exec_command({cmd:"make later"}));'),
    result(running('cell-1', { output: 'one', exit_code: 0 })),
    wait('cell-1', 'failure'), result([{ type: 'input_text', text: 'Script failed: second call threw' }], 'failure'),
    wait('cell-1', 'late'), result(complete({ output: 'invented completion', exit_code: 0 }), 'late'),
  ]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger.length, 0);
  assert.equal(ledger.capture.missing, 1);
  assert.equal(ledger.capture.incomplete, true);
});

test('nontext chunk payloads leave outcomes unmapped while a canonical completion still proves actions', async () => {
  const file = await fixture([
    call('text(await tools.exec_command({cmd:"make build"}));'),
    result([...running('cell-1'), { type: 'image', data: 'not interpreted' }]),
    wait('cell-1', 'final'), result(complete({ output: 'built', exit_code: 0 }), 'final'),
  ]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.capture.captured, 1);
  assert.equal(ledger.capture.unmapped, 1);
  assert.equal(ledger.capture.incomplete, false);
  assert.equal(ledger.ledger[0].exitCode, undefined);
});

test('later command output joins only the matching exec session, including JSON-string results', async () => {
  const file = await fixture([
    call('text(await tools.exec_command({cmd:"pytest tests/"}));'), result(complete({ output: '1 failed, 2 passed', session_id: 42 })),
    rec({ type: 'function_call', name: 'functions.write_stdin', call_id: 'poll', arguments: JSON.stringify({ session_id: 42, chars: '' }) }),
    result(JSON.stringify({ output: 'finished', exit_code: 0 }), 'poll'),
    call('text(await tools.exec_command({cmd:"make other"}));', 'exec', 'other'), result(complete({ output: 'started', session_id: 43 }), 'other'),
    call('text(await tools.write_stdin({session_id:43,chars:""}));', 'exec', 'poll2'), result(complete({ output: 'done', exit_code: 2 }), 'poll2'),
  ]);
  const events = (await sliceLineage([file])).ledger;
  assert.equal(events.length, 2);
  assert.equal(events[0].exitCode, 0);
  assert.equal(events[0].outcome, 'passed', 'H1: the joined typed exit zero decides; early output text is never read');
  assert.equal(events[0].sourceLocator.resultRecord, 6, 'typed poll locates the terminal result row');
  assert.equal(events[1].exitCode, 2);
  assert.equal(events[1].outcome, 'failed');
  assert.equal(events[1].sourceLocator.resultRecord, 10);
});

test('patch sections preserve create, edit and delete paths without mixing their content', async () => {
  const patch = '*** Begin Patch\n*** Update File: src/first.js\n-old one\n+new one\n*** Add File: src/second.js\n+second contents\n*** Delete File: src/third.js\n*** End Patch';
  const file = await fixture([call('text(await tools.apply_patch(' + JSON.stringify(patch) + '));'), result(complete({}))]);
  const ledger = (await sliceLineage([file])).ledger;
  assert.deepEqual(ledger.map((e) => [e.kind, e.path]), [['edit', 'src/first.js'], ['create', 'src/second.js'], ['delete', 'src/third.js']]);
  assert.match(ledger[0].argsExcerpt, /old one/);
  assert.doesNotMatch(ledger[0].argsExcerpt, /second contents/);
  assert.match(ledger[1].argsExcerpt, /second contents/);
  const direct = await fixture([rec({ type: 'custom_tool_call', name: 'functions.apply_patch', call_id: 'patch', input: patch }), result('ok', 'patch')]);
  assert.equal((await sliceLineage([direct])).ledger.length, 3);
});

test('a wrapper patch cannot borrow a FileChange through matching paths', async () => {
  const patch = '*** Begin Patch\n*** Add File: src/one.js\n+export const one = 1;\n*** Update File: src/two.js\n-old\n+new\n*** End Patch';
  const source = 'const patch = ' + JSON.stringify(patch) + '; const result = await tools.apply_patch(patch); text(result);';
  const file = await fixture([
    call(source),
    fileChange([{ path: '/repo/src/one.js', kind: 'add', diff: '+export const one = 1;' },
      { path: '/repo/src/two.js', kind: 'update', diff: '-old\n+new' }]),
    result(complete({})),
  ]);
  const ledger = await sliceLineage([file]);
  assert.deepEqual(ledger.ledger.map((event) => [event.path, event.result?.outcome]), [
    ['src/one.js', 'unknown'], ['src/two.js', 'unknown'],
  ]);
  assert.deepEqual(ledger.ledger.map((event) => event.sourceLocator), [
    { stream: 0, record: 3, part: 0, resultRecord: 5 },
    { stream: 0, record: 3, part: 1, resultRecord: 5 },
  ]);
  assert.ok(ledger.ledger.every((event) => !JSON.stringify(event.tailLines ?? []).includes('ui-change')));
  const clean = redact(ledger).ledger;
  assert.deepEqual(clean.ledger.map((event) => event.sourceLocator),
    ledger.ledger.map((event) => event.sourceLocator), 'numeric locators survive export redaction');
  assert.ok(clean.ledger.every((event) => !JSON.stringify(event).includes('ui-change')));
  const session = sessionFromLedger(clean, { sessionKey: 'synthetic-codex' });
  assert.ok(session.events.filter((event) => event.kind === 'invocation')
    .every((event) => !session.succeeded(event.id)));
});

test('native map shaped FileChange cannot certify wrapper edits without exact IDs', async () => {
  const patch = '*** Begin Patch\n*** Update File: src/old.js\n-old\n+new\n*** Add File: src/new.js\n+created\n*** End Patch';
  const source = 'text(await tools.apply_patch(' + JSON.stringify(patch) + '));';
  const changes = {
    '/repo/src/old.js': { type: 'update', unified_diff: '-old\n+new', move_path: null },
    '/repo/src/new.js': { type: 'add', content: 'created' },
  };
  const native = JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: {
    id: 'native-change', type: 'FileChange', status: 'completed', changes,
  } } });
  const ledger = await sliceLineage([await fixture([call(source), native, result(complete({}))])]);
  assert.deepEqual(ledger.ledger.map((event) => [event.path, event.result?.outcome]), [
    ['src/old.js', 'unknown'], ['src/new.js', 'unknown'],
  ]);
  assert.ok(ledger.ledger.every((event) => event.sourceLocator?.fileChangeRecord === undefined));
  assert.ok(ledger.ledger.every((event) => !JSON.stringify(event).includes('native-change')));
});

test('native FileChange map rejects duplicate keys, move paths and changed operations', async () => {
  const patch = '*** Begin Patch\n*** Update File: src/old.js\n-old\n+new\n*** End Patch';
  const source = 'text(await tools.apply_patch(' + JSON.stringify(patch) + '));';
  const edit = '{"type":"update","unified_diff":"-old\\n+new","move_path":null}';
  const duplicate = '{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"FileChange","status":"completed","changes":{"/repo/src/old.js":'
    + edit + ',"/repo/src/old.js":' + edit + '}}}}';
  const escapedDuplicate = '{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"FileChange","status":"completed","changes":{"/repo/src/old.js":'
    + edit + ',"/repo/src/old\\u002ejs":' + edit + '}}}}';
  const cases = [
    duplicate,
    escapedDuplicate,
    fileChange({ '/repo/src/old.js': { type: 'update', unified_diff: '-old\n+new', move_path: '/repo/src/other.js' } }),
    fileChange({ '/repo/src/old.js': { type: 'add', content: 'new' } }),
  ];
  for (const sidecar of cases) {
    const file = await fixture([call(source), sidecar, result(complete({}))]);
    const ledger = await sliceLineage([file]);
    assert.equal(ledger.ledger[0].result?.outcome, 'unknown');
    assert.equal(ledger.ledger[0].sourceLocator?.fileChangeRecord, undefined);
  }
});

test('an unpaired wrapper output cannot be repaired by a matching FileChange', async () => {
  const patch = '*** Begin Patch\n*** Add File: src/one.js\n+export const one = 1;\n*** End Patch';
  const source = 'const r = await tools.apply_patch(' + JSON.stringify(patch) + '); text({summary:"done"});';
  const file = await fixture([call(source), fileChange([{ path: 'src/one.js', kind: 'add' }]),
    result(complete({ summary: 'done' }))]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger[0].result?.outcome, undefined);
  assert.equal(ledger.ledger[0].sourceLocator?.resultRecord, undefined);
  assert.equal(ledger.ledger[0].sourceLocator?.fileChangeRecord, undefined);
  assert.equal(ledger.ledger[0].tailLines, undefined);
  assert.equal(ledger.capture.unmapped, 1, 'the unproved output mapping remains a coverage gap');
});

test('FileChange near misses leave write outcomes unknown', async () => {
  const patch = '*** Begin Patch\n*** Add File: src/one.js\n+export const one = 1;\n*** End Patch';
  const source = 'text(await tools.apply_patch(' + JSON.stringify(patch) + '));';
  const good = fileChange([{ path: 'src/one.js', kind: 'add' }]);
  const cases = [
    [fileChange([{ path: 'src/other.js', kind: 'add' }])],
    [fileChange([{ path: 'src/one.js', kind: 'update' }])],
    [good, good],
    [fileChange([{ path: '../src/one.js', kind: 'add' }])],
    [fileChange([{ path: 'src/token=syntheticsecret.js', kind: 'add' }])],
    [fileChange([{ path: 'src/one.js', kind: 'add' }], { status: 'unknown' })],
  ];
  for (const sidecars of cases) {
    const file = await fixture([call(source), ...sidecars, result(complete({}))]);
    const ledger = await sliceLineage([file]);
    assert.equal(ledger.ledger[0].result?.outcome, 'unknown');
    assert.equal(ledger.ledger[0].sourceLocator?.fileChangeRecord, undefined);
  }

  const later = await fixture([call(source), result(complete({})), good]);
  assert.equal((await sliceLineage([later])).ledger[0].result?.outcome, 'unknown');
  const otherTurn = await fixture([call(source), rec({ type: 'message', role: 'user', content: 'Continue.' }),
    good, result(complete({}))]);
  assert.equal((await sliceLineage([otherTurn])).ledger[0].result?.outcome, 'unknown');
  const nativeOtherTurn = await fixture([call(source), JSON.stringify({ type: 'turn_context', payload: {} }),
    good, result(complete({}))]);
  assert.equal((await sliceLineage([nativeOtherTurn])).ledger[0].result?.outcome, 'unknown');
});

test('a wrapper native error stands without borrowing a conflicting FileChange', async () => {
  const patch = '*** Begin Patch\n*** Update File: src/one.js\n-old\n+new\n*** End Patch';
  const source = 'text(await tools.apply_patch(' + JSON.stringify(patch) + '));';
  const file = await fixture([call(source), fileChange([{ path: 'src/one.js', kind: 'update' }]),
    result(complete({ is_error: true, output: 'patch rejected' }))]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger[0].result?.outcome, 'failed');
  assert.equal(ledger.ledger[0].sourceLocator?.fileChangeRecord, undefined);
});

test('overlapping wrappers and conflicting completion replays cannot borrow FileChange proof', async () => {
  const patch = '*** Begin Patch\n*** Add File: src/one.js\n+export const one = 1;\n*** End Patch';
  const source = 'text(await tools.apply_patch(' + JSON.stringify(patch) + '));';
  const change = fileChange([{ path: 'src/one.js', kind: 'add' }]);
  const overlapping = await fixture([
    call(source, 'exec', 'first'), call(source, 'exec', 'second'), change,
    result(complete({}), 'second'), result(complete({}), 'first'),
  ]);
  assert.ok((await sliceLineage([overlapping])).ledger.every((event) =>
    event.result?.outcome !== 'succeeded' && event.sourceLocator?.fileChangeRecord === undefined));

  for (const firstOutput of [null, result([{ type: 'input_text', text: 'Script failed' }], 'first')]) {
    const unresolved = await fixture([
      call(source, 'exec', 'first'), call(source, 'exec', 'second'), change,
      ...(firstOutput ? [firstOutput] : []), result(complete({}), 'second'),
    ]);
    const events = (await sliceLineage([unresolved])).ledger;
    assert.ok(events.every((event) => event.result?.outcome !== 'succeeded'
      && event.sourceLocator?.fileChangeRecord === undefined),
    'an unfinished or failed overlapping wrapper remains a competing owner');
  }

  const replayed = await fixture([
    call(source), change, result(complete({})), result(complete({ output: 'conflicting replay' })),
  ]);
  const ledger = await sliceLineage([replayed]);
  assert.equal(ledger.ledger[0].result, undefined);
  assert.equal(ledger.ledger[0].sourceLocator?.resultRecord, undefined);
  assert.equal(ledger.ledger[0].sourceLocator?.fileChangeRecord, undefined);
});

test('an invalid wrapper script remains a gap and neither wrapper borrows FileChange', async () => {
  const patch = '*** Begin Patch\n*** Add File: src/one.js\n+one\n*** End Patch';
  const invalid = 'const r = await tools.apply_patch(' + JSON.stringify(patch) + '); text(r); if (';
  const valid = 'text(await tools.apply_patch(' + JSON.stringify(patch) + '));';
  const changed = fileChange([{ path: 'src/one.js', kind: 'add' }]);
  assert.equal(readExecCalls(invalid).calls.length, 0, 'the whole script is invalid');
  assert.equal(readExecCalls(invalid).unsupported, 0, 'it cannot be an unknown inner file action');
  assert.equal(readExecCalls(invalid).syntaxInvalid, true);
  const file = await fixture([
    call(invalid, 'exec', 'bad'), result([{ type: 'input_text', text: 'Script failed' }], 'bad'),
    call(valid, 'exec', 'good'), changed, result(complete({}), 'good'),
  ]);
  const sliced = await sliceLineage([file]);
  const edit = sliced.ledger.find((event) => event.path === 'src/one.js');
  assert.equal(edit?.result?.outcome, 'unknown');
  assert.equal(edit?.sourceLocator?.fileChangeRecord, undefined);
  assert.equal(sliced.capture.incomplete, true, 'the invalid wrapper attempt remains declared');

  const validCompetitor = 'const r = await tools.apply_patch(' + JSON.stringify(patch)
    + '); text(r); for (const x of []) {}';
  const contested = await sliceLineage([await fixture([
    call(validCompetitor, 'exec', 'peer'), result(complete({}), 'peer'),
    call(valid, 'exec', 'good'), changed, result(complete({}), 'good'),
  ])]);
  assert.equal(contested.ledger.some((event) => event.sourceLocator?.fileChangeRecord != null), false,
    'a syntactically valid patch-capable peer still blocks ownership');
});

test('a same-path patch wrapper starting after a sidecar still competes before the first wrapper settles', async () => {
  const firstPatch = '*** Begin Patch\n*** Add File: src/one.js\n+one\n*** End Patch';
  const secondPatch = '*** Begin Patch\n*** Add File: src/one.js\n+other\n*** End Patch';
  const first = call('text(await tools.apply_patch(' + JSON.stringify(firstPatch) + '));', 'exec', 'first');
  const second = call('text(await tools.apply_patch(' + JSON.stringify(secondPatch) + '));', 'exec', 'second');
  const change = fileChange([{ path: 'src/one.js', kind: 'add' }]);
  for (const lines of [
    [first, change, second, result(complete({}), 'second'), result(complete({}), 'first')],
    [second, result(complete({}), 'second'), first, change, result(complete({}), 'first')],
  ]) {
    const ledger = await sliceLineage([await fixture(lines)]);
    const target = ledger.ledger.find((event) => event.path === 'src/one.js');
    assert.equal(target?.sourceLocator?.fileChangeRecord, undefined);
    assert.equal(target?.result?.outcome, 'unknown');
  }
});

test('even disjoint patch peers cannot create a wrapper-to-FileChange identity', async () => {
  const targetPatch = '*** Begin Patch\n*** Add File: src/one.js\n+one\n*** End Patch';
  const otherPatch = '*** Begin Patch\n*** Add File: src/other.js\n+other\n*** End Patch';
  const target = call('text(await tools.apply_patch(' + JSON.stringify(targetPatch) + '));', 'exec', 'target');
  const disjoint = call('text(await tools.apply_patch(' + JSON.stringify(otherPatch) + '));', 'exec', 'disjoint');
  const change = fileChange([{ path: 'src/one.js', kind: 'add' }]);
  for (const lines of [
    [target, change, disjoint, result(complete({}), 'disjoint'), result(complete({}), 'target')],
    [disjoint, result(complete({}), 'disjoint'), target, change, result(complete({}), 'target')],
  ]) {
    const events = (await sliceLineage([await fixture(lines)])).ledger;
    const edit = events.find((event) => event.path === 'src/one.js');
    assert.equal(edit?.result?.outcome, 'unknown');
    assert.equal(edit?.sourceLocator?.fileChangeRecord, undefined);
  }
  const unknown = call('const patch = inputFromElsewhere; text(await tools.apply_patch(patch));', 'exec', 'unknown');
  const mcp = call('text(await tools.mcp__codex__edit_file({file_path:"src/other.js",content:"other"}));',
    'exec', 'mcp');
  for (const competitor of [unknown, mcp]) {
    const events = (await sliceLineage([await fixture([
      target, change, competitor, result(complete({}), 'mcp'), result(complete({}), 'target'),
    ])])).ledger;
    const edit = events.find((event) => event.path === 'src/one.js');
    assert.equal(edit?.sourceLocator?.fileChangeRecord, undefined);
    assert.equal(edit?.result?.outcome, 'unknown');
  }
});

test('a concurrent direct file mutation blocks FileChange ownership even with another path or missing result', async () => {
  const patch = '*** Begin Patch\n*** Add File: src/one.js\n+export const one = 1;\n*** End Patch';
  const otherPatch = '*** Begin Patch\n*** Add File: src/other.js\n+export const other = 1;\n*** End Patch';
  const wrapper = call('text(await tools.apply_patch(' + JSON.stringify(patch) + '));');
  const sidecar = fileChange([{ path: 'src/one.js', kind: 'add' }]);
  const competingCalls = [
    rec({ type: 'function_call', name: 'functions.apply_patch', call_id: 'direct', arguments: JSON.stringify(otherPatch) }),
    rec({ type: 'function_call', name: 'functions.write_file', call_id: 'direct', arguments: JSON.stringify({ file_path: 'src/other.js', content: 'other' }) }),
    rec({ type: 'function_call', name: 'mcp__codex__edit_file', call_id: 'direct', arguments: JSON.stringify({ file_path: 'src/other.js', content: 'other' }) }),
  ];
  for (const direct of competingCalls) {
    for (const directResult of [result('pending', 'direct'), null]) {
      const lines = [wrapper, direct, sidecar];
      if (directResult) lines.push(directResult);
      lines.push(result(complete({})));
      const ledger = await sliceLineage([await fixture(lines)]);
      const edit = ledger.ledger.find((event) => event.path === 'src/one.js');
      assert.equal(edit?.sourceLocator?.fileChangeRecord, undefined);
      assert.equal(edit?.result?.outcome, 'unknown');
    }
  }
  const samePathDirect = rec({ type: 'function_call', name: 'functions.apply_patch',
    call_id: 'direct', arguments: JSON.stringify(patch) });
  for (const lines of [
    [wrapper, samePathDirect, result('completed', 'direct'), sidecar, result(complete({}))],
    [samePathDirect, result('completed', 'direct'), wrapper, sidecar, result(complete({}))],
    [wrapper, sidecar, samePathDirect, result('completed', 'direct'), result(complete({}))],
  ]) {
    const ledger = await sliceLineage([await fixture(lines)]);
    const edit = ledger.ledger.find((event) => event.path === 'src/one.js' && event.sourceLocator?.record === lines.indexOf(wrapper) + 3);
    assert.equal(edit?.sourceLocator?.fileChangeRecord, undefined);
    assert.equal(edit?.result?.outcome, 'unknown');
  }
});

test('a wrapper cannot borrow CommandExecution status through matching command text', async () => {
  for (const [command, status, exitCode, expected] of [
    ['node build.js', 'completed', 0, 'passed'],
    ['node build.js', 'failed', 2, 'failed'],
    ['node --test', 'completed', 0, 'unknown'],
  ]) {
    const source = 'const r = await tools.exec_command({cmd:' + JSON.stringify(command)
      + ',workdir:"/repo"}); text(r.output);';
    const sidecar = commandExecution(command, { status, exitCode });
    const ledger = await sliceLineage([await fixture([
      call(source), sidecar, result(complete('visible wrapper output')),
    ])]);
    const event = ledger.ledger[0];
    assert.equal(event.exitCode, undefined);
    assert.equal(event.outcome, 'unknown');
    assert.equal(event.sourceLocator?.resultRecord, 5);
    assert.equal(event.sourceLocator?.commandExecutionRecord, undefined);
    assert.equal(JSON.stringify(ledger).includes('SIDECAR_PRIVATE_SENTINEL'), false);
  }
});

test('a statically ordered wrapper batch cannot borrow an unlinked native status', async () => {
  const source = 'const first = await tools.exec_command({cmd:"node first.js",workdir:"/repo"}); '
    + 'text(first.output); '
    + 'const second = await tools.exec_command({cmd:"node second.js",workdir:"/repo"}); '
    + 'text(second.output);';
  const file = await fixture([
    call(source), commandExecution('node first.js'),
    result(complete('first visible output', 'second visible output')),
  ]);
  const events = (await sliceLineage([file])).ledger;
  assert.deepEqual(events.map((event) => [event.exitCode, event.sourceLocator?.commandExecutionRecord]),
    [[undefined, undefined], [undefined, undefined]]);
  assert.deepEqual(events.map((event) => event.tailLines),
    [['first visible output'], ['second visible output']]);
});

test('repeated command keys cannot borrow one typed CommandExecution receipt', async () => {
  const sameBatch = 'const first = await tools.exec_command({cmd:"node build.js",workdir:"/repo"}); '
    + 'text(first.output); '
    + 'const second = await tools.exec_command({cmd:"node build.js",workdir:"/repo"}); '
    + 'text(second.output);';
  const batch = await sliceLineage([await fixture([
    call(sameBatch), commandExecution('node build.js'),
    result(complete('first visible output', 'second visible output')),
  ])]);
  assert.equal(batch.ledger.length, 2);
  assert.ok(batch.ledger.every((event) => event.exitCode === undefined
    && event.sourceLocator?.commandExecutionRecord === undefined));

  const source = 'const r = await tools.exec_command({cmd:"node build.js",workdir:"/repo"}); text(r.output);';
  const delayed = await sliceLineage([await fixture([
    call(source, 'exec', 'earlier'), result(complete('earlier output'), 'earlier'),
    call(source, 'exec', 'later'), commandExecution('node build.js'),
    result(complete('later output'), 'later'),
  ])]);
  assert.equal(delayed.ledger.length, 2);
  assert.ok(delayed.ledger.every((event) => event.exitCode === undefined
    && event.sourceLocator?.commandExecutionRecord === undefined));
});

test('CommandExecution status refuses duplicate, ambiguous, redacted, mismatched and unpaired receipts', async () => {
  const command = 'node build.js';
  const source = 'const r = await tools.exec_command({cmd:"node build.js",workdir:"/repo"}); text(r.output);';
  const callOne = call(source, 'exec', 'one');
  const finishOne = result(complete('visible wrapper output'), 'one');
  const receipt = commandExecution(command);
  const duplicateKey = receipt.replace('"exit_code":0', '"exit_code":0,"exit_code":0');
  const cases = [
    [callOne, receipt, commandExecution(command, { status: 'failed', exitCode: 1 }), finishOne],
    [callOne, call('text(await tools.exec_command({cmd:"node other.js"}));', 'exec', 'two'),
      receipt, result(complete('other output'), 'two'), finishOne],
    [callOne, commandExecution(command, { cwd: 'file:///elsewhere' }), finishOne],
    [callOne, commandExecution(command, { status: 'completed', exitCode: 1 }), finishOne],
    [callOne, duplicateKey, finishOne],
    [callOne, receipt, call('const cmd = inputFromElsewhere; text(await tools.exec_command({cmd}));',
      'exec', 'unknown'), finishOne],
    [callOne, receipt, rec({ type: 'function_call', name: 'functions.exec_command',
      call_id: 'direct', arguments: JSON.stringify({ cmd: 'node other.js' }) }), finishOne],
    [callOne, receipt, result(complete(), 'one')],
  ];
  for (const [index, lines] of cases.entries()) {
    const events = (await sliceLineage([await fixture(lines)])).ledger;
    const event = events.find((entry) => entry.cmd === command);
    assert.equal(event?.sourceLocator?.commandExecutionRecord, undefined, `near miss ${index}`);
    assert.equal(event?.exitCode, undefined, `near miss ${index}`);
  }
  const secret = 'AKIAIOSFODNN7EXAMPLE';
  const privateCommand = `echo ${secret}`;
  const privateSource = 'const r = await tools.exec_command({cmd:'
    + JSON.stringify(privateCommand) + ',workdir:"/repo"}); text(r.output);';
  const privateLedger = await sliceLineage([await fixture([
    call(privateSource), commandExecution(privateCommand), result(complete('visible wrapper output')),
  ])]);
  assert.equal(privateLedger.ledger[0].sourceLocator?.commandExecutionRecord, undefined);
  assert.equal(privateLedger.ledger[0].exitCode, undefined);

  const externalSource = 'const r = await tools.exec_command({cmd:"node build.js",'
    + 'workdir:"/elsewhere"}); text(r.output);';
  const external = await sliceLineage([await fixture([
    call(externalSource), commandExecution(command, { cwd: 'file:///elsewhere' }),
    result(complete('visible wrapper output')),
  ])]);
  assert.equal(external.ledger[0].kind, 'bash', 'the own-cwd command is a typed action');
  assert.equal(external.ledger[0].sourceLocator?.commandExecutionRecord, undefined);
  assert.equal(external.ledger[0].exitCode, undefined);
});

test('unlinked CommandExecution cannot override a wrapper result with its own exit', async () => {
  const source = 'text(await tools.exec_command({cmd:"node build.js",workdir:"/repo"}));';
  const ledger = await sliceLineage([await fixture([
    call(source), commandExecution('node build.js', { status: 'failed', exitCode: 2 }),
    result(complete({ output: 'native wrapper output', exit_code: 0 })),
  ])]);
  const event = ledger.ledger[0];
  assert.equal(event.sourceLocator?.commandExecutionRecord, undefined);
  assert.equal(event.outcome, 'passed');
  assert.equal(event.sourceLocator?.commandExecutionRecord, undefined);
  assert.equal(event.exitCode, 0);
  assert.ok(event.tailLines?.join('\n').includes('native wrapper output'));
});

test('an unfamiliar tool is captured without changing a command raw-output exit code', async () => {
  const file = await fixture([call('text(await tools.web__run({search_query:[]})); const r = await tools.exec_command({cmd:"make build"}); text(r.output);'),
    result(complete({ content: [] }, 'Process exited with code 0'))]);
  const normalized = await readCodexSession(file);
  assert.equal(normalized.meta.capture.captured, 2);
  assert.equal(normalized.meta.capture.incomplete, false);
  const ledger = (await sliceLineage([file])).ledger;
  assert.equal(ledger[0].kind, 'other');
  assert.equal(ledger[0].tool, 'web__run');
  assert.equal(ledger[1].exitCode, undefined);
});

test('transcript JavaScript is never evaluated', async () => {
  const dir = await scratchDir('codex-never-exec-'); const target = join(dir, 'never-created');
  const source = 'await (await import("node:fs/promises")).writeFile(' + JSON.stringify(target) + ',"bad");';
  const file = await fixture([call(source), result(complete())]);
  await readCodexSession(file);
  await assert.rejects(access(target));
});

test('output mismatch leaves every result unassigned', () => {
  const parsed = readExecCalls('text(await tools.exec_command({cmd:"make build"}));');
  assert.equal(execResults(complete({ output: '', exit_code: 0 }, { output: '', exit_code: 2 }), parsed).results.size, 0);
});

test('emitted marker-shaped literals cannot fabricate tool results or exit codes', async () => {
  for (const kind of ['call', 'output', 'all', 'allSettled']) {
    const fake = { marker: kind, value: kind.startsWith('all') ? [0] : 0,
      output: 'invented success', exit_code: 0 };
    const source = 'await tools.exec_command({cmd:"make build"}); text(' + JSON.stringify(fake) + ');';
    const parsed = readExecCalls(source);
    assert.equal(parsed.calls[0].awaited, true);
    assert.equal(parsed.unsupported, 0);
    assert.equal(execResults(complete(fake), parsed).results.size, 0, kind);
    const file = await fixture([call(source), result(complete(fake))]);
    const normalized = await readCodexSession(file);
    assert.equal(normalized.meta.capture.captured, 1);
    assert.equal(normalized.meta.capture.unmapped, 1);
    const ledger = await sliceLineage([file]);
    assert.equal(ledger.ledger[0].exitCode, undefined, kind);
    assert.equal(ledger.ledger[0].outcome, undefined, 'no invented result is attached: ' + kind);
  }
  const source = 'await tools.exec_command({cmd:"make build"}); const fake = {marker:"call",value:0,output:"invented output"}; text(fake.output);';
  assert.equal(execResults(complete('invented output'), readExecCalls(source)).results.size, 0,
    'a literal property projection cannot manufacture an output reference');
});

test('awaiting marker-shaped literals cannot certify unawaited tool calls', () => {
  for (const kind of ['call', 'all', 'allSettled']) {
    const fake = { marker: kind, value: kind === 'call' ? 0 : [0] };
    const parsed = readExecCalls('const p = tools.exec_command({cmd:"make build"}); await ' + JSON.stringify(fake) + ';');
    assert.equal(parsed.calls.length, 1);
    assert.equal(parsed.calls[0].awaited, false, kind);
    assert.equal(parsed.unsupported, 1, 'the actual call remains unawaited');
  }
  for (const method of ['all', 'allSettled']) {
    const parsed = readExecCalls('const p = tools.exec_command({cmd:"make build"}); await Promise.' + method + '([{marker:"call",value:0}]);');
    assert.equal(parsed.calls[0].awaited, false, method);
    assert.ok(parsed.unsupported > 0);
  }
});

test('ordinary marker data stays literal while genuine references stay nonliteral recursively', () => {
  const ordinary = readExecCalls('text(await tools.exec_command({cmd:"make build",extra:{marker:"call",value:0}}));');
  assert.equal(ordinary.unsupported, 0);
  assert.equal(ordinary.calls[0].input.extra.marker, 'call');
  assert.equal(execResults(complete({ output: 'built', exit_code: 0 }), ordinary).results.get(0).value.exit_code, 0);
  const nested = readExecCalls('const r = await tools.exec_command({cmd:"make first"}); await tools.exec_command({cmd:"make second",extra:{nested:[r]}});');
  assert.equal(nested.calls.length, 1, 'unknown tool result data cannot become literal input to another call');
  assert.equal(nested.unsupported, 1);
  for (const method of ['all', 'allSettled']) {
    const parsed = readExecCalls('const r = await Promise.' + method + '([tools.exec_command({cmd:"make first"}),tools.exec_command({cmd:"make second"})]); text(r);');
    const values = [{ output: 'one', exit_code: 2 }, { output: 'two', exit_code: 0 }];
    const output = method === 'allSettled' ? values.map((value) => ({ status: 'fulfilled', value })) : values;
    const results = execResults(complete(output), parsed).results;
    assert.deepEqual([...results.values()].map((r) => r.value.exit_code), [2, 0], method);
    assert.ok(parsed.calls.every((c) => c.awaited));
  }
});

test('a reconstructed public reference shape is never trusted by the result mapper', () => {
  const parsed = { emissionsExact: true, emissions: [{ marker: 'call', value: 0 }] };
  assert.equal(execResults(complete({ output: 'invented success', exit_code: 0 }), parsed).results.size, 0);
});

test('a rejected patch beside a successful command is a failed write, and the command keeps its own pass', async () => {
  const patch = '*** Begin Patch\n*** Add File: src/helper.js\n+export const helper = 1;\n*** End Patch';
  const source = 'const r = await Promise.allSettled([tools.exec_command({cmd:"make build"}),tools.apply_patch(' + JSON.stringify(patch) + ')]); text(r);';
  const file = await fixture([call(source), result(complete([
    { status: 'fulfilled', value: { output: 'built', exit_code: 0 } },
    { status: 'rejected', reason: { message: 'Patch could not be applied' } },
  ]))]);
  const normalized = await readCodexSession(file);
  assert.equal(normalized.meta.capture.captured, 2);
  assert.equal(normalized.meta.capture.unmapped, 0);
  assert.equal(normalized.meta.capture.incomplete, false);
  const ledger = await sliceLineage([file]);
  const [command, rejected] = ledger.ledger;
  assert.equal(command.cmd, 'make build');
  assert.equal(command.exitCode, 0);
  assert.equal(command.outcome, 'passed');
  assert.equal(rejected.path, 'src/helper.js');
  assert.equal(rejected.isError, true);
  assert.equal(rejected.kind, 'error');
  assert.equal(rejected.exitCode, undefined, 'a rejected call supplies no process exit code');
});

test('allSettled rejection reasons never supply command output, exit codes or session identities', async () => {
  const source = 'text(await Promise.allSettled([tools.exec_command({cmd:"make build"})]));';
  for (const reason of ['Process exited with code 0', '7 passed',
    { output: '7 passed', exit_code: 0, session_id: 42 }, null, undefined]) {
    const output = complete([{ status: 'rejected', reason }]);
    const mapped = execResults(output, readExecCalls(source)).results.get(0);
    assert.deepEqual(mapped, { value: { output: '', is_error: true }, rawOutput: false });
    const file = await fixture([call(source), result(output)]);
    const ledger = await sliceLineage([file]);
    assert.equal(ledger.capture.unmapped, 0);
    assert.equal(ledger.ledger[0].isError, true);
    assert.equal(ledger.ledger[0].outcome, 'failed');
    assert.equal(ledger.ledger[0].exitCode, undefined);
    assert.equal(ledger.ledger[0].tailLines, undefined, 'the reason is not observed command stdout');
  }
});

test('malformed settled entries remain unmapped without corrupting adjacent successful results', () => {
  const source = 'text(await Promise.allSettled([tools.exec_command({cmd:"make first"}),tools.exec_command({cmd:"make second"})]));';
  const parsed = readExecCalls(source);
  for (const bad of [null, [], true, { reason: 'error' }, { status: 'REJECTED', reason: 'error' },
    { status: 'rejected', value: { output: 'invented success', exit_code: 0 } },
    { status: 'rejected', reason: 'error', exit_code: 0 },
    { status: 'fulfilled', reason: 'error' },
    { status: 'fulfilled', value: { output: 'invented success', exit_code: 0 }, reason: 'error' },
    { status: 'fulfilled', value: { output: 'invented success', exit_code: 0 }, exit_code: 0 },
    { status: 'fulfilled', value: { output: 'invented success', exit_code: 0 }, extra: true }]) {
    const mapped = execResults(complete([{ status: 'fulfilled', value: { output: 'built', exit_code: 0 } }, bad]), parsed).results;
    assert.equal(mapped.size, 1);
    assert.equal(mapped.get(0).value.exit_code, 0);
    assert.equal(mapped.has(1), false);
  }
  const ordinary = readExecCalls('text(await Promise.all([tools.exec_command({cmd:"make build"})]));');
  const response = { status: 'rejected', reason: 'ordinary response data' };
  assert.deepEqual(execResults(complete([response]), ordinary).results.get(0).value, response,
    'only actual allSettled entries carry rejection status');
});
