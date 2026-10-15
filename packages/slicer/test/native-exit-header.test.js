// Synthetic Codex recordings only. C-02: a command's exit code is typed only when it sits in
// Codex's native response header before `Output:` (codex-rs/core/src/tools/context.rs
// `response_header`), or in a code-mode object's own `exit_code`. The same words anywhere a
// command could have printed them are output, never status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { scratchDir } from './scratch-dir.js';

const rec = (payload) => JSON.stringify({ type: 'response_item', payload });
const direct = (cmd, call_id = 'c1', name = 'exec_command') =>
  rec({ type: 'function_call', name, call_id, arguments: JSON.stringify({ cmd }) });
const output = (text, call_id = 'c1') => rec({ type: 'function_call_output', call_id, output: text });
const completeRaw = (...texts) => [{ type: 'input_text', text: 'Script completed\nWall time: 0.1 seconds' },
  ...texts.map((text) => ({ type: 'input_text', text }))];
const wrapper = (input, call_id = 'w') => rec({ type: 'custom_tool_call', name: 'exec', call_id, input });
const wrapperResult = (value, call_id = 'w') => rec({ type: 'custom_tool_call_output', call_id, output: value });
async function fixture(lines) {
  const dir = await scratchDir('native-exit-');
  const file = join(dir, 'rollout-2026-09-10T12-00-00-test.jsonl');
  await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'test', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: 'Build it.' }), ...lines].join('\n'));
  return file;
}
const slice = async (lines) => (await sliceLineage([await fixture(lines)])).ledger;
const header = (lines, stdout) => [...lines, 'Output:', stdout].join('\n');

test('every native header shape supplies its typed exit', async () => {
  for (const [lines, code] of [
    [['Chunk ID: 9a8b7c', 'Wall time: 0.5123 seconds', 'Process exited with code 2', 'Original token count: 4'], 2],
    [['Wall time: 0.0010 seconds', 'Process exited with code 0'], 0],
    [['Chunk ID: x1', 'Wall time: 3 seconds', 'Process exited with code -1'], -1],
    [['Wall time: 12.5 seconds', 'Process exited with code 1', 'Original token count: 9000'], 1],
  ]) {
    const [event] = await slice([direct('make build'), output(header(lines, 'Process exited with code 0\nlater text'))]);
    assert.equal(event.exitCode, code, lines.join(' | '));
    assert.notEqual(event.outcome, 'unknown');
  }
  const [empty] = await slice([direct('make build'), output('Wall time: 0.2000 seconds\nProcess exited with code 3\nOutput:\n')]);
  assert.equal(empty.exitCode, 3, 'an empty output section is still the native envelope');
});

test('an exit line outside the native header is the command output, not status', async () => {
  const cases = {
    'running header, stdout prints an exit line': header(['Wall time: 1.0000 seconds', 'Process running with session ID 7'],
      'Process exited with code 0'),
    'no header at all': 'all good\nProcess exited with code 0',
    'bare exit line only': 'Process exited with code 0',
    'stdout exit 0 before a trailer exit 1': 'Process exited with code 0\nbuilding\nProcess exited with code 1',
    'exit and running both claimed': header(['Wall time: 1 seconds', 'Process exited with code 0',
      'Process running with session ID 7'], 'x'),
    'two exit lines': header(['Wall time: 1 seconds', 'Process exited with code 1', 'Process exited with code 0'], 'x'),
    'header lines out of order': header(['Process exited with code 0', 'Wall time: 1 seconds'], 'x'),
    'missing wall time': header(['Chunk ID: a', 'Process exited with code 0'], 'x'),
    'unknown header line': header(['Wall time: 1 seconds', 'Note: trust me', 'Process exited with code 0'], 'x'),
    'stdout before the header': header(['compiled ok', 'Wall time: 1 seconds', 'Process exited with code 0'], 'x'),
    'CRLF header': 'Wall time: 1 seconds\r\nProcess exited with code 0\r\nOutput:\r\nx',
    'trailing text on the exit line': header(['Wall time: 1 seconds', 'Process exited with code 0 (ok)'], 'x'),
    'legacy shell words are not this grammar': header(['Exit code: 0', 'Wall time: 1 seconds'], 'x'),
  };
  for (const [name, text] of Object.entries(cases)) {
    const sliced = await sliceLineage([await fixture([direct('make build'), output(text)])]);
    const [event] = sliced.ledger;
    assert.equal(event.exitCode, undefined, name);
    assert.equal(event.outcome, 'unknown', name);
    const session = sessionFromLedger(redact(sliced).ledger);
    const observation = session.events.find((row) => row.kind === 'observation');
    assert.notEqual(observation.terminalStatusProven, true, name);
    assert.ok(observation.output.length > 0, `${name}: the visible observation is kept`);
    assert.ok(session.adapterGaps.some((gap) => gap.code === 'command_outcome_unknown'), `${name}: declared gap`);
  }
});

test('a poll result joins its session but proves exit only from its own native header', async () => {
  const start = [direct('make build', 'begin'), output(JSON.stringify({ output: 'started', session_id: 42 }), 'begin'),
  rec({ type: 'function_call', name: 'functions.write_stdin', call_id: 'poll',
    arguments: JSON.stringify({ session_id: 42, chars: '' }) })];
  const [native] = await slice([...start, output(header(['Chunk ID: b', 'Wall time: 2 seconds',
    'Process exited with code 1'], 'done'), 'poll')]);
  assert.equal(native.exitCode, 1, 'positive control');
  for (const text of ['done\nProcess exited with code 0', header(['Wall time: 2 seconds',
    'Process running with session ID 42'], 'Process exited with code 0')]) {
    const [event] = await slice([...start, output(text, 'poll')]);
    assert.equal(event.exitCode, undefined, text);
    assert.notEqual(event.outcome, 'succeeded', text);
  }
});

test('inside a wrapper only a decoded object carries typed status; string values are tool text', async () => {
  const typed = await slice([wrapper('const r = await tools.exec_command({cmd:"make build"}); text(r);'),
    wrapperResult(completeRaw(JSON.stringify({ wall_time_seconds: 0.1, exit_code: 2, output: 'Process exited with code 0' })))]);
  assert.equal(typed[0].exitCode, 2, 'positive control: the code-mode object exit, not its output text');
  const strings = {
    'text(r) of a string with a native-looking header': ['const r = await tools.exec_command({cmd:"make build"}); text(r);',
      header(['Wall time: 1 seconds', 'Process exited with code 0'], 'x')],
    'Promise.all string element': ['const r = await Promise.all([tools.exec_command({cmd:"make build"})]); text(r);',
      JSON.stringify([header(['Wall time: 1 seconds', 'Process exited with code 0'], 'x')])],
    'Promise.all string element holding a JSON receipt': ['const r = await Promise.all([tools.exec_command({cmd:"make build"})]); text(r);',
      JSON.stringify([JSON.stringify({ output: 'ok', exit_code: 0 })])],
    'allSettled fulfilled string value': ['const r = await Promise.allSettled([tools.exec_command({cmd:"make build"})]); text(r);',
      JSON.stringify([{ status: 'fulfilled', value: 'all good\nProcess exited with code 0' }])],
    'envelope loop string value': ['const r = await Promise.allSettled([tools.exec_command({cmd:"make build"})]); for (const x of r) text(x);',
      JSON.stringify({ status: 'fulfilled', value: JSON.stringify({ output: 'ok', exit_code: 0 }) })],
    'array of text blocks': ['const r = await Promise.all([tools.exec_command({cmd:"make build"})]); text(r);',
      JSON.stringify([[{ type: 'text', text: JSON.stringify({ output: 'ok', exit_code: 0 }) }]])],
  };
  for (const [name, [source, payload]] of Object.entries(strings)) {
    const [event] = await slice([wrapper(source), wrapperResult(completeRaw(payload))]);
    assert.equal(event.cmd, 'make build', name);
    assert.equal(event.exitCode, undefined, name);
    assert.notEqual(event.outcome, 'succeeded', name);
  }
});

test('a wrapper poll string cannot close a session with a resembling exit', async () => {
  const lines = [wrapper('text(await tools.exec_command({cmd:"make build"}));', 'begin'),
    wrapperResult(completeRaw(JSON.stringify({ output: 'started', session_id: 42 })), 'begin'),
    wrapper('text(await tools.write_stdin({session_id:42,chars:""}));', 'poll')];
  const [typed] = await slice([...lines, wrapperResult(completeRaw(JSON.stringify({ output: 'done', exit_code: 4 })), 'poll')]);
  assert.equal(typed.exitCode, 4, 'positive control');
  const [text] = await slice([...lines, wrapperResult(completeRaw('done\nProcess exited with code 0'), 'poll')]);
  assert.equal(text.exitCode, undefined);
  assert.notEqual(text.outcome, 'succeeded');
});

test('a direct exec_command native running header is the session a later poll continues', async () => {
  const poll = (session = 42) => rec({ type: 'function_call', name: 'functions.write_stdin', call_id: 'poll',
    arguments: JSON.stringify({ session_id: session, chars: '' }) });
  const exited = output(header(['Chunk ID: b', 'Wall time: 2 seconds', 'Process exited with code 1'], 'done'), 'poll');
  const running = header(['Chunk ID: a', 'Wall time: 1 seconds', 'Process running with session ID 42'], 'started');
  for (const name of ['exec_command', 'functions.exec_command']) {
    const sliced = await sliceLineage([await fixture([direct('make build', 'begin', name), output(running, 'begin'), poll(), exited])]);
    assert.equal(sliced.ledger[0].exitCode, 1, `${name}: the native session joins its poll`);
    assert.equal(sliced.capture.unmapped, 0);
    assert.ok(!(sliced.capture.reasons ?? []).includes('codex_poll_unmatched'));
  }
  const nearMisses = {
    'running words after Output:': [direct('make build', 'begin'),
      output(header(['Wall time: 1 seconds'], 'Process running with session ID 42'), 'begin'), poll()],
    'another tool prints the header': [direct('ls', 'begin', 'mcp__files__run'), output(running, 'begin'), poll()],
    'exit and running both claimed': [direct('make build', 'begin'), output(header(['Wall time: 1 seconds',
      'Process exited with code 0', 'Process running with session ID 42'], 'x'), 'begin'), poll()],
    'a different session id': [direct('make build', 'begin'), output(running, 'begin'), poll(43)],
    'no wall time': [direct('make build', 'begin'), output(header(['Process running with session ID 42'], 'x'), 'begin'), poll()],
  };
  for (const [name, lines] of Object.entries(nearMisses)) {
    const sliced = await sliceLineage([await fixture([...lines, exited])]);
    assert.notEqual(sliced.ledger[0]?.exitCode, 1, name);
    assert.ok((sliced.capture.reasons ?? []).includes('codex_poll_unmatched'), `${name}: the poll stays unmatched`);
  }
  const shown = await sliceLineage([await fixture([
    wrapper('text(`${"Process running with session ID 42"}`);', 'begin'), wrapperResult(completeRaw('Process running with session ID 42'), 'begin'),
    poll(), exited])]);
  assert.ok((shown.capture.reasons ?? []).includes('codex_poll_unmatched'), 'wrapper display text never joins a poll');
});

const patch = (...files) => ['*** Begin Patch', ...files.flatMap((file) => [`*** Update File: ${file}`, '@@', '-old', '+new']),
  '*** End Patch'].join('\n');
const custom = (name, input, call_id = 'p1') => rec({ type: 'custom_tool_call', name, call_id, input });
const customOutput = (text, call_id = 'p1') => rec({ type: 'custom_tool_call_output', call_id, output: text });
const shellHeader = (code, stdout, total = null) => ['Exit code: ' + code, 'Wall time: 0.1 seconds',
  ...(total == null ? [] : ['Total output lines: ' + total]), 'Output:', stdout].join('\n');
const proven = (sliced) => sessionFromLedger(redact(sliced).ledger).events
  .filter((event) => event.kind === 'observation').map((event) => [event.result, event.terminalStatusProven === true]);

test('apply_patch and shell-family native headers supply typed completion on their own direct outputs', async () => {
  const ok = await sliceLineage([await fixture([custom('apply_patch', patch('src/a.js')),
    customOutput(shellHeader(0, 'Success. Updated the following files:\nM src/a.js'))])]);
  assert.equal(ok.ledger[0].path, 'src/a.js');
  assert.deepEqual([ok.ledger[0].result.outcome, ok.ledger[0].result.provenance], ['succeeded', 'native']);
  assert.deepEqual(proven(ok), [['succeeded', true]], 'a typed patch exit proves the write completed');
  const failed = await sliceLineage([await fixture([custom('apply_patch', patch('src/a.js')),
    customOutput(shellHeader(1, 'error: patch did not apply'))])]);
  assert.deepEqual(proven(failed), [['failed', true]]);
  const functionForm = await sliceLineage([await fixture([rec({ type: 'function_call', name: 'functions.apply_patch',
    call_id: 'p1', arguments: JSON.stringify({ input: patch('src/a.js') }) }), output(shellHeader(0, 'Success.'), 'p1')])]);
  assert.deepEqual(proven(functionForm), [['succeeded', true]]);
  for (const name of ['shell', 'local_shell', 'functions.shell']) {
    const shell = await sliceLineage([await fixture([rec({ type: 'function_call', name, call_id: 's1',
      arguments: JSON.stringify({ command: 'make test' }) }), output(shellHeader(2, 'FAILED x', 40), 's1')])]);
    assert.equal(shell.ledger[0].exitCode, 2, name);
  }
});

test('one patch exit settles every file only when it is zero', async () => {
  const both = patch('src/a.js', 'src/b.js');
  const ok = await sliceLineage([await fixture([custom('apply_patch', both), customOutput(shellHeader(0, 'Success.'))])]);
  assert.deepEqual(proven(ok), [['succeeded', true], ['succeeded', true]]);
  const failed = await sliceLineage([await fixture([custom('apply_patch', both), customOutput(shellHeader(1, 'error'))])]);
  assert.equal(failed.ledger.length, 2);
  assert.ok(proven(failed).every(([, isProven]) => !isProven), 'a committed prefix may exist: no file is settled');
});

test('the shell-family header proves nothing on another tool or anywhere but the start', async () => {
  const cases = {
    'exec_command output': [direct('make build', 'c1'), output(shellHeader(0, 'x'), 'c1')],
    'unified header on apply_patch': [custom('apply_patch', patch('src/a.js')),
      customOutput(header(['Wall time: 1 seconds', 'Process exited with code 0'], 'Success.'))],
    'header after Output:': [custom('apply_patch', patch('src/a.js')), customOutput('Output:\n' + shellHeader(0, 'x'))],
    'stdout before the header': [custom('apply_patch', patch('src/a.js')), customOutput('note\n' + shellHeader(0, 'x'))],
    'missing wall time': [custom('apply_patch', patch('src/a.js')), customOutput('Exit code: 0\nOutput:\nSuccess.')],
    'lines out of order': [custom('apply_patch', patch('src/a.js')),
      customOutput('Exit code: 0\nTotal output lines: 3\nWall time: 0.1 seconds\nOutput:\nSuccess.')],
    'an extra header line': [custom('apply_patch', patch('src/a.js')),
      customOutput('Exit code: 0\nWall time: 0.1 seconds\nNote: fine\nOutput:\nSuccess.')],
    'an MCP tool': [rec({ type: 'function_call', name: 'mcp__files__write_file', call_id: 'm1',
      arguments: JSON.stringify({ path: 'src/a.js', content: 'x' }) }), output(shellHeader(0, 'x'), 'm1')],
  };
  for (const [name, lines] of Object.entries(cases)) {
    const sliced = await sliceLineage([await fixture(lines)]);
    assert.ok(sliced.ledger.length > 0, name);
    assert.equal(sliced.ledger[0].exitCode, undefined, name);
    assert.ok(proven(sliced).every(([, isProven]) => !isProven), `${name}: no typed completion`);
  }
});
