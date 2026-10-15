import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestCommand, recordedOutcome } from '../src/outcome.js';
import { buildEvents, exitStatusGap, exitStatusCovers, EXIT_STATUS_GAPS } from '../src/events.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';

// H1: a command's status comes from the recording's structure only. Every fixture is
// synthetic: a Bash call and its result, with or without the harness's typed sidecar or error flag.
const SIDECAR = (stdout) => ({ stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
function one(command, text, { isError, sidecar, exitCode } = {}) {
  const block = { type: 'tool_result', tool_use_id: 'b1', content: text, ...(isError === undefined ? {} : { is_error: isError }) };
  const recs = [
    { kind: 'user', raw: { type: 'user', message: { role: 'user', content: 'run it' } } },
    { kind: 'assistant', raw: { type: 'assistant', version: '2.1.205', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'b1', name: 'Bash', input: { command } }] } } },
    { kind: 'user', raw: { type: 'user', version: '2.1.205', message: { role: 'user', content: [block] },
      ...(sidecar ? { toolUseResult: sidecar } : {}) } },
  ];
  const outcomes = Number.isFinite(exitCode) ? new Map([['b1', { exitCode }]]) : null;
  return buildEvents(recs, { cwd: '/repo', outcomes }).events.find((e) => e.cmd === command);
}

test('H1: output text never decides a status, in either direction', () => {
  for (const text of ['19 passed in 2.10s', '1 failed, 12 passed', 'AssertionError: assert 3 == 4',
    'Traceback (most recent call last):', 'error: build failed', 'ℹ pass 101\nℹ fail 0', 'Done', 'No problems',
    'Compiled successfully', 'ModuleNotFoundError: x\n1 error in 0.65s']) {
    const ev = one('npm test', text, { isError: false });
    assert.equal(ev.outcome, 'unknown', text);
    assert.equal(ev.outcomeSource, 'unknown', text);
  }
});

test('H1: the error flag is a failure whatever the output reads', () => {
  const ev = one('pytest -q; ls journal/', '19 passed in 2.10s\nls: journal/: No such file', { isError: true });
  assert.equal(ev.outcome, 'failed');
  assert.equal(ev.outcomeSource, 'native');
});

test('H1: a recorded exit code decides for every command, a test runner included', () => {
  assert.equal(one('npm test', '1 failed', { exitCode: 0 }).outcome, 'passed', 'exit 0 is exit 0, whatever the text');
  assert.equal(one('npm test', '19 passed', { exitCode: 1 }).outcome, 'failed', 'a nonzero exit fails, whatever the text');
  assert.equal(one('node build.js', '', { exitCode: 0 }).outcomeSource, 'hook');
});

test('H1: a zero status that does not speak for every command of the line is unproven, never passed or failed', () => {
  for (const command of ['npm test 2>&1 | tail -5', 'npm test; echo done', 'npm test || true', 'echo $(npm test)']) {
    const ev = one(command, 'ok', { isError: false, sidecar: SIDECAR('ok') });
    assert.equal(ev.outcome, 'unproven', command);
    assert.equal(ev.outcomeSource, 'native', command);
    assert.equal(recordedOutcome(ev), 'unknown', `${command}: no consumer concludes from it`);
  }
  const plain = one('cd pkg && npm test', 'ok', { isError: false, sidecar: SIDECAR('ok') });
  assert.equal(plain.outcome, 'passed', 'an && chain shares its zero status');
  assert.equal(recordedOutcome(plain), 'passed');
});

test('H1: a background launch stub proves nothing', () => {
  assert.equal(one('npm run dev', 'Command running in background with ID: btawd1lpf', { isError: false }).outcome, 'unknown');
});

test('H1: a parsed-output label (an older ledger) concludes nothing', () => {
  assert.equal(recordedOutcome({ outcome: 'failed', outcomeSource: 'parsed-output' }), 'unknown');
  assert.equal(recordedOutcome({ outcome: 'passed', outcomeSource: 'parsed-output' }), 'unknown');
  assert.equal(recordedOutcome({ outcome: 'failed' }), 'unknown', 'no recorded source');
  assert.equal(recordedOutcome({ outcome: 'errored', outcomeSource: 'native' }), 'unknown');
  assert.equal(recordedOutcome({ outcome: 'failed', outcomeSource: 'hook' }), 'failed');
});

test('H1: exitStatusGap reads the shell grammar only', () => {
  const cases = [
    ['npm test', null], ['cd a && npm test', null], ['(cd a && npm test)', null], ['npm test 2>&1', null],
    ['x=1 npm test', null], ['cd a &&\n npm test', null], ['# note\nnpm test', null], ["bash -c 'cd a && make'", null],
    ['npm test | tail -5', 'pipeline'], ['npm test |& tee log', 'pipeline'], ['npm test; echo done', 'sequence'],
    ['npm test\necho done', 'sequence'], ['(cd a; npm test)', 'sequence'], ['a || b', 'or_list'],
    ['npm run dev &', 'background'], ['echo $(make)', 'substitution'], ['diff <(a) <(b)', 'substitution'],
    ['echo `make`', 'substitution'], ['! grep x f', 'negation'], ['eval "make"', 'eval'],
    ["bash -lc 'npm test | tail'", 'pipeline'], ["echo 'open", 'unreadable'],
  ];
  for (const [command, gap] of cases) {
    assert.equal(exitStatusGap(command), gap, command);
    assert.equal(exitStatusCovers(command), gap === null, command);
  }
  assert.ok(Object.isFrozen(EXIT_STATUS_GAPS));
  for (const [, gap] of cases) if (gap) assert.ok(EXIT_STATUS_GAPS.includes(gap), gap);
});

test('F2: a shell whose script the line holds is read the same way; options before -c fail closed', () => {
  const cases = [
    // Options before `-c`: the shell's options are not parsed, so its script word is not known.
    ["bash -x -c 'false; true'", 'nested_shell'], ["bash -l -c 'npm test | tail -3'", 'nested_shell'],
    ["bash --norc -c 'make; echo ok'", 'nested_shell'], ["bash -o pipefail -c 'npm test'", 'nested_shell'],
    // A script on the shell's stdin from this line: a here-document body, a here-string word.
    ["bash <<'EOF'\nnpm test\necho done\nEOF", 'sequence'], ['sh -s <<EOF\nnpm test | tail -3\nEOF', 'pipeline'],
    ["sudo bash <<'EOF'\nmake\nmake install\nEOF", 'sequence'], ["bash <<< 'a; b'", 'sequence'],
    ["bash <<'EOF'\nnpm test\nEOF", null], ['bash <<-EOF\n\tcd a && make\nEOF', null], ["bash <<< 'npm test'", null],
    // Nesting stays bounded at two shells deep.
    ["bash -c 'bash -c \"bash <<< x\"'", 'nested_shell'],
    // A script FILE is a program like any other; a shell's name as an argument is no shell.
    ['bash run.sh', null], ['bash -x run.sh', null], ['which bash', null], ['brew install bash', null],
    ["cat <<'EOF' > notes.txt\na\nb\nEOF", null],
  ];
  for (const [command, gap] of cases) {
    assert.equal(exitStatusGap(command), gap, command);
    assert.equal(exitStatusCovers(command), gap === null, command);
  }
  // Through the slicer: Claude Code's typed success verdict on such a line is a zero status that does not speak for
  // every command, so it is unproven, never passed.
  for (const command of ["bash -x -c 'false; true'", "bash <<'EOF'\nnpm test\necho done\nEOF"]) {
    const ev = one(command, 'done', { isError: false, sidecar: SIDECAR('done') });
    assert.equal(ev.outcome, 'unproven', command);
    assert.equal(recordedOutcome(ev), 'unknown', command);
  }
  assert.equal(one("bash <<'EOF'\nnpm test\nEOF", 'ok', { isError: false, sidecar: SIDECAR('ok') }).outcome, 'passed');
});

test('status fact: set -e covers a sequence and pipefail a pipeline, read from the line itself; fail closed', () => {
  // [command, gap in a shell's own top level (`ownShell`), gap where the harness may run the line in a place errexit is
  // ignored (the default: Claude Code's Bash tool runs the line as the left of an `&&`)]. Review F1: errexit is read only
  // in a shell's own top level; pipefail everywhere.
  const SEQ = 'sequence';
  const cases = [
    // errexit in effect before the separators: in its own shell the line stops at the first failure.
    ['set -e; npm test; echo done', null, SEQ], ['set -e\nnpm test\necho done', null, SEQ],
    ['set -o errexit; make; make test', null, SEQ], ['set -ex; a; b', null, SEQ], ['set -eu\ncd pkg\nnpm test', null, SEQ],
    ['set -e; a; b && c', null, SEQ], ['set -e -- x y; a; b', null, SEQ],
    // pipefail in effect: a pipeline exits 0 only when every stage did, wherever the line runs.
    ['set -o pipefail; npm test | tail -5', null, null], ['set -euo pipefail\nnpm test 2>&1 | tail -5\necho ok', null, SEQ],
    ['set -euo pipefail\nnpm test 2>&1 | tail -5 > out.txt', null, null],
    ['set -e -o pipefail; a | b; c', null, SEQ], ['set -o pipefail -e; a | b; c', null, SEQ],
    // A nested shell's script runs in its own process, read with its own options, from nothing.
    ["bash -c 'set -e; a; b'", null, null], ["bash <<'EOF'\nset -euo pipefail\na | b\nc\nEOF", null, null],
    ["zsh <<< 'set -e; a; b'", null, null], ["set -e; bash -c 'a; b'", SEQ, SEQ],
    // Each option covers only its own shape.
    ['set -e; npm test | tail', 'pipeline', 'pipeline'], ['set -o pipefail; a; b', SEQ, SEQ],
    // Errexit never covers a command before ||, an && list's member before ; , !, a substitution or a background job.
    ['set -e; a || true; b', 'or_list', 'or_list'], ['set -e; a && b; c', SEQ, SEQ], ['set -e; ! a; b', 'negation', SEQ],
    ['set -e; x=$(a); b', 'substitution', 'substitution'], ['set -e; a & b', 'background', 'background'],
    // Only before the commands it covers, unconditionally, in this shell.
    ['a; set -e; b', SEQ, SEQ], ['set -e; set +e; a; b', SEQ, SEQ], ['cd x && set -e; a; b', SEQ, SEQ],
    ['(set -e; a); b; c', SEQ, SEQ], ['set -e; echo | set +e; a; b', 'pipeline', SEQ],
    // Anything uncertain: a compound command or group, a trap, a sourced file, a set not read whole.
    ['set -e; (cd x && make); b', SEQ, SEQ], ['set -e; if a; then b; fi; c', SEQ, SEQ], ['set -e; { a; b; }; c', SEQ, SEQ],
    ["set -e; trap 'exit 0' EXIT; a; b", SEQ, SEQ], ['set -e; source env.sh; a; b', SEQ, SEQ],
    ['set -e; . ./env.sh; a; b', SEQ, SEQ], ['set -e; builtin set +e; a; b', SEQ, SEQ], ['set -n; a; b', SEQ, SEQ],
    ['set $OPTS; a; b', SEQ, SEQ], ['FOO=1 set -e; a; b', SEQ, SEQ], ['set -e 2>/dev/null; a; b', SEQ, SEQ],
    ['set -o posix -e; a; b', SEQ, SEQ], ['set -o; a; b', SEQ, SEQ],
    // Review F2: every way a line turns an option off that the parsed line does not spell as a plain `set` at a
    // command's head — behind an assignment or a redirection, quoted or escaped, through an expansion, by another
    // builtin's name (bash shopt; zsh setopt, unsetopt, emulate, noglob), or through `eval` — leaves it off.
    ['set -e; X=1 set +e; false; true', SEQ, SEQ], ['set -e; \\set +e; false; true', SEQ, SEQ],
    ["set -e; 'set' +e; false; true", SEQ, SEQ], ['set -e; s=set; $s +e; false; true', SEQ, SEQ],
    ['set -e; >log set +e; false; true', SEQ, SEQ], ['set -e; shopt -uo errexit; false; true', SEQ, SEQ],
    ['set -e; unsetopt errexit; false; true', SEQ, SEQ], ['set -e; setopt no_err_exit; false; true', SEQ, SEQ],
    ['set -e; emulate sh; false; true', SEQ, SEQ], ['set -e; noglob set +e; false; true', SEQ, SEQ],
    ['set -eo pipefail; echo | eval "set +e"; false; true', SEQ, SEQ],
    ['set -eo pipefail; unsetopt pipefail; false | true', SEQ, SEQ],
    ['set -eo pipefail; X=1 set +o pipefail; false | true', 'pipeline', SEQ],
    ['set -o pipefail; X=1 set +o pipefail\nfalse | true', SEQ, SEQ],
  ];
  for (const [command, own, harness] of cases) {
    assert.equal(exitStatusGap(command, { ownShell: true }), own, `own shell: ${command}`);
    assert.equal(exitStatusCovers(command, { ownShell: true }), own === null, `own shell: ${command}`);
    assert.equal(exitStatusGap(command), harness, command);
    assert.equal(exitStatusCovers(command), harness === null, command);
  }
  // The same F2 lines in a nested shell's script (its own top level): the option is off there too.
  for (const line of ['set -e; X=1 set +e; false; true', "set -e; 'set' +e; false; true",
    'set -e; unsetopt errexit; false; true', 'set -e; shopt -uo errexit; false; true'])
    assert.equal(exitStatusGap(`bash <<'EOF'\n${line}\nEOF`), SEQ, line);
  // Through the slicer, Claude Code (review F1): its typed success verdict on a `set -e` sequence is a zero status the
  // shell's errexit may not have stood behind — unproven, `sequence`; pipefail still covers a pipeline, and a script the
  // line hands to a fresh shell is read in that shell's own top level.
  for (const [command, outcome, gap] of [['set -e; npm test; echo done', 'unproven', SEQ],
    ['set -o pipefail; npm test | tail -5', 'passed', undefined], ['set -e; npm test | tail -5', 'unproven', 'pipeline'],
    ["bash -c 'set -e; npm test; echo done'", 'passed', undefined]]) {
    const ev = one(command, 'ok', { isError: false, sidecar: SIDECAR('ok') });
    assert.equal(ev.outcome, outcome, command);
    assert.equal(ev.statusGap, gap, command);
    assert.equal(recordedOutcome(ev), outcome === 'passed' ? 'passed' : 'unknown', command);
  }
});

test('status fact (review F1): only a Codex command its native item types as its own shell\'s script reads errexit',
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'sonah-own-shell-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    let n = 0;
    const slice = async (rows) => {
      const file = join(dir, `rollout-2026-10-06T10-00-0${n++}-own-shell.jsonl`);
      const head = [{ type: 'session_meta', payload: { id: 'own-thread', cwd: '/repo' } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: 'Check.' } }];
      await writeFile(file, [...head, ...rows].map((row) => JSON.stringify(row)).join('\n') + '\n');
      return (await sliceLineage([file])).ledger.find((e) => typeof e.cmd === 'string');
    };
    const call = (cmd) => ({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command',
      call_id: 'c1', arguments: JSON.stringify({ cmd }) } });
    const output = (exit) => ({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1',
      output: `Wall time: 0.1000 seconds\nProcess exited with code ${exit}\nOutput:\nok` } });
    const item = (script) => ({ type: 'event_msg', payload: { type: 'item_completed', thread_id: 'own-thread', item: {
      id: 'c1', type: 'CommandExecution', status: 'completed', source: 'unified_exec_startup',
      command: ['/bin/zsh', '-lc', script], cwd: 'file:///repo', exit_code: 0, stdout: '', stderr: '' } } });
    const SEQUENCE = 'set -euo pipefail\nnpm test 2>&1 | tail -5\necho done';
    // The native item records `[/bin/zsh, -lc, line]`: the line is its own shell's script, its errexit is read.
    const own = await slice([call(SEQUENCE), item(SEQUENCE), output(0)]);
    assert.equal(own.sourceLocator?.commandExecutionRecord, 4);
    assert.equal(own.outcome, 'passed');
    assert.equal(own.statusGap, undefined);
    // The same line with only the call's typed exit header: the runner is not typed, so errexit is not read.
    const untyped = await slice([call(SEQUENCE), output(0)]);
    assert.equal(untyped.exitCode, 0);
    assert.equal(untyped.outcome, 'unproven');
    assert.equal(untyped.statusGap, 'sequence');
    // The fact never reaches the ledger, and a failure is still a failure.
    assert.equal(JSON.stringify(own).includes('ownShell'), false);
    assert.equal((await slice([call(SEQUENCE), output(1)])).outcome, 'failed');
    // pipefail alone needs no runner fact.
    assert.equal((await slice([call('set -o pipefail; npm test | tail -5'), output(0)])).outcome, 'passed');
  });

test('isTestCommand matches argv, never prose', () => {
  assert.equal(isTestCommand('echo "the verifier pytest output goes here"'), false);
  assert.equal(isTestCommand('# Actually look for `def test_` lines from pytest'), false);
  assert.equal(isTestCommand('uv run pytest -q'), true);
  assert.equal(isTestCommand('node --test tests/'), true);
  assert.equal(isTestCommand('npm test'), true);
});

test('H5: no program-name list decides whether a command\'s outcome matters', async () => {
  const outcome = await import('../src/outcome.js');
  assert.equal(Object.hasOwn(outcome, 'isOutcomeRelevant'), false);
});

test('D69 (c): a write outside the recorder\'s cwd is external; no majority or ask-named work root re-spells it', async () => {
  const { buildEvents } = await import('../src/events.js');
  const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const asst = (...uses) => ({ kind: 'assistant', raw: { type: 'assistant', message: { role: 'assistant', content: uses } } });
  const human = { kind: 'user', raw: { type: 'user', message: { role: 'user',
    content: 'Fix the bug. Work entirely inside /tmp/clone and do not touch other files.' } } };
  // The agent worked in a /tmp clone the whole time and touched a scratch repo once; the recorder's cwd is elsewhere.
  const rows = [human,
    asst(tool('t1', 'Write', { file_path: '/tmp/clone/pkg/a.go', content: 'x' })),
    asst(tool('t2', 'Write', { file_path: '/tmp/clone/pkg/a_test.go', content: 'x' })),
    asst(tool('t3', 'Bash', { command: 'D=/tmp/other\ncd "$D/scratch"\ncat > a.js << EOF\nx\nEOF' }))];
  const writes = (cwd) => buildEvents(rows, { cwd }).events.filter((e) => e.kind === 'edit' || e.kind === 'create')
    .map((e) => [e.path, e.external === true]);
  // D69 review (F7): outside the cwd a path keeps its spelling as recorded (its `/`), and a shell write is spelled where
  // its `cd` put it — never the bare `a.js` a project file would be.
  assert.deepEqual(writes('/Users/someone/main-project'), [['/tmp/clone/pkg/a.go', true], ['/tmp/clone/pkg/a_test.go', true],
    ['/tmp/other/scratch/a.js', true]], 'outside the cwd: external, spelled as recorded');
  assert.deepEqual(writes('/tmp/clone'), [['pkg/a.go', false], ['pkg/a_test.go', false], ['/tmp/other/scratch/a.js', true]],
    'the recorder\'s cwd is the work under review');
  // A harness worktree under the cwd (D40) is inside it.
  const worktree = buildEvents([human, asst(tool('t4', 'Write', { file_path: '/repo/.claude/worktrees/fix/b.js', content: 'x' }))],
    { cwd: '/repo' }).events.find((e) => e.kind === 'edit' || e.kind === 'create');
  assert.ok(worktree && !worktree.external && worktree.path === '.claude/worktrees/fix/b.js');
});

test('external: harness files under ~/.claude/ are infrastructure, never project edits', async () => {
  const { buildEvents } = await import('../src/events.js');
  const human = { kind: 'user', raw: { type: 'user', message: { role: 'user', content: 'grade it' } } };
  const asst = { kind: 'assistant', raw: { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/Users/x/.claude/projects/-p/memory/notes.md', content: 'x' } },
    { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: '/repo/src/a.py', content: 'x' } }] } } };
  const r = buildEvents([human, asst], { cwd: '/repo' });
  const writes = r.events.filter((e) => e.kind === 'edit' || e.kind === 'create');
  assert.equal(writes.find((e) => /notes\.md$/.test(e.path)).external, true);
  assert.ok(!writes.find((e) => e.path === 'src/a.py').external);
});

test('capture-time exit codes join at slice time and lose to transcript-native codes', async () => {
  const { buildEvents } = await import('../src/events.js');
  const recs = [
    { kind: 'user', raw: { type: 'user', message: { role: 'user', content: 'run it' } } },
    { kind: 'assistant', raw: { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_A', name: 'Bash', input: { command: 'node scripts/migrate.js' } }] } } },
    { kind: 'user', raw: { type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_A', content: 'no summary line here' }] } } },
  ];
  const joined = buildEvents(recs, { cwd: '/repo', outcomes: new Map([['toolu_A', { exitCode: 3 }]]) });
  const ev = joined.events.find((e) => e.kind === 'bash');
  assert.equal(ev.outcome, 'failed', 'the recorded exit code decides where patterns saw nothing');
  const bare = buildEvents(recs, { cwd: '/repo' });
  assert.equal(bare.events.find((e) => e.kind === 'bash').outcome ?? 'unknown', 'unknown',
    'without the recording, the same output stays honestly unknown');
});
