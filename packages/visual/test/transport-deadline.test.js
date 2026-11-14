// D226: the claude transport's two stops from outside, a deadline and a signal, against the stand-in CLI (no real
// call).
// The stand-in's `slow` mode answers late and leaves its process id, so each test can tell whether that process ended.
// Process groups are read with `ps -o pgid=`; those tests do not run on Windows, which has no process groups.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEADLINE_MIN_MS, TransportError, claudeArgs, claudeTransport } from '../src/transport-claude.mjs';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs');
const TRANSPORT = new URL('../src/transport-claude.mjs', import.meta.url).href;
const POSIX = process.platform !== 'win32';
let scratch;
before(() => { chmodSync(FAKE, 0o755); scratch = mkdtempSync(join(tmpdir(), 'sonah-visual-d226-')); });
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A fresh HOME for the stand-in with its rules: the env to pass, its call log, and the ids of its slow processes. */
function fakeHome(rules) {
  const dir = mkdtempSync(join(scratch, 'home-'));
  writeFileSync(join(dir, 'fake-claude.json'), JSON.stringify({ rules }));
  const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '');
  return { dir, env: { PATH: process.env.PATH, HOME: dir },
    calls: () => read('fake-claude.log.jsonl').split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    pids: () => read('fake-claude.pids').split('\n').filter(Boolean).map(Number) };
}
const request = (prompt = 'Say hello as JSON.') => ({ id: 'a'.repeat(64), kind: 'functions',
  system: 'You answer in JSON.', prompt, ids: {} });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** Waits until `ready()` gives a value (at most 10 s). */
async function until(ready) {
  for (let i = 0; i < 200; i++) {
    const value = ready();
    if (value) return value;
    await sleep(50);
  }
  throw new Error('not ready after 10 s');
}
/** Whether a process id names a running process. */
const runs = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const groupOf = (pid) => Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim());

test('D226: with no deadline and no signal, a call runs as before, in this process\'s group',
  { skip: !POSIX }, async () => {
  const fake = fakeHome([{ mode: 'slow', ms: 1500, text: 'Sure: {"ok": true}', cost: 0.042 }]);
  const started = Date.now();
  const call = claudeTransport({ bin: FAKE, env: fake.env })(request());
  const [pid] = await until(() => fake.pids().length && fake.pids());
  assert.equal(groupOf(pid), groupOf(process.pid), 'the call runs in the caller\'s process group, as before');
  const out = await call;
  assert.ok(Date.now() - started >= 1500, 'the slow answer is waited for');
  assert.equal(out.text, 'Sure: {"ok": true}');
  assert.equal(out.costUsd, 0.042);
  assert.deepEqual(fake.calls()[0].argv, claudeArgs({ system: 'You answer in JSON.', model: 'sonnet' }));
  // A signal that is never aborted, and a deadline far off, change nothing in the answer.
  const later = fakeHome([{ mode: 'slow', ms: 1200, text: 'Sure: {"ok": true}' }]);
  const again = await claudeTransport({ bin: FAKE, env: later.env, signal: new AbortController().signal,
    deadline: Date.now() + 60_000 })(request());
  assert.equal(again.text, 'Sure: {"ok": true}');
  assert.deepEqual(later.calls()[0].argv, fake.calls()[0].argv);
});

test('D226: a deadline stops a call still running as `timeout`, and its claude, which leads its own group, ends',
  { skip: !POSIX }, async () => {
  const fake = fakeHome([{ mode: 'slow', ms: 60_000, text: '{}' }]);
  const started = Date.now();
  const call = claudeTransport({ bin: FAKE, env: fake.env, deadline: started + 1500 })(request());
  const [pid] = await until(() => fake.pids().length && fake.pids());
  assert.equal(groupOf(pid), pid, 'with a deadline, the call\'s claude leads a process group of its own');
  await assert.rejects(call, (e) => e instanceof TransportError && e.kind === 'timeout');
  const took = Date.now() - started;
  assert.ok(took >= 1400 && took < 5000, `stopped at the deadline (${took} ms)`);
  assert.equal(runs(pid), false, 'the stand-in\'s process ended');
});

test('D226: with less than DEADLINE_MIN_MS left, or none, a call fails at once as `timeout` and starts no claude',
  async () => {
  const fake = fakeHome([{ mode: 'ok', text: '{}' }]);
  for (const deadline of [Date.now() + DEADLINE_MIN_MS - 300, Date.now() - 1, 0]) {
    const started = Date.now();
    await assert.rejects(claudeTransport({ bin: FAKE, env: fake.env, deadline })(request()),
      (e) => e instanceof TransportError && e.kind === 'timeout' && e.ms === null);
    assert.ok(Date.now() - started < 500);
  }
  assert.deepEqual(fake.calls(), [], 'no claude was started');
  // A deadline is a time: anything else is refused when the transport is made.
  for (const deadline of [Number.NaN, Infinity, '2030-01-01', {}]) {
    assert.throws(() => claudeTransport({ bin: FAKE, env: fake.env, deadline }), TypeError, String(deadline));
  }
});

test('D226: a deadline ends what the call\'s claude started too: its whole process group', { skip: !POSIX },
  async () => {
  // A `claude` that is a shell script running the stand-in as its child (no exec): the stand-in is not the child
  // the transport started, and holds its output open.
  const fake = fakeHome([{ mode: 'slow', ms: 60_000, text: '{}' }]);
  const wrapper = join(fake.dir, 'claude');
  writeFileSync(wrapper, `#!/bin/sh\n'${process.execPath}' '${FAKE}' "$@"\n`);
  chmodSync(wrapper, 0o755);
  const started = Date.now();
  const call = claudeTransport({ bin: wrapper, env: fake.env, deadline: started + 1500 })(request());
  const [pid] = await until(() => fake.pids().length && fake.pids());
  await assert.rejects(call, (e) => e instanceof TransportError && e.kind === 'timeout');
  const took = Date.now() - started;
  assert.ok(took < 5000, `stopped at the deadline, not after the grace periods (${took} ms)`);
  // The stand-in that the script started ended with it (its parent gone, the system reaps it: wait for that).
  await until(() => !runs(pid));
});

test('D226: an aborted signal stops a call still running as `call_failed`; a call asked after it starts no claude',
  async () => {
  const fake = fakeHome([{ mode: 'slow', ms: 60_000, text: '{}' }]);
  const stop = new AbortController();
  const transport = claudeTransport({ bin: FAKE, env: fake.env, signal: stop.signal });
  const started = Date.now();
  const call = transport(request());
  const [pid] = await until(() => fake.pids().length && fake.pids());
  stop.abort();
  await assert.rejects(call, (e) => e instanceof TransportError && e.kind === 'call_failed');
  assert.ok(Date.now() - started < 5000);
  assert.equal(runs(pid), false, 'the stand-in\'s process ended');
  await assert.rejects(transport(request('another')), (e) => e instanceof TransportError && e.kind === 'call_failed');
  assert.equal(fake.calls().length, 1, 'no claude was started after the stop');
});

test('D226: when the process exits while a call with a deadline runs, its claude\'s group is killed',
  { skip: !POSIX }, async () => {
  // A job's backstop exit: a process that exits with process.exit while its call runs.
  const fake = fakeHome([{ mode: 'slow', ms: 60_000, text: '{}' }]);
  const script = `import { claudeTransport } from ${JSON.stringify(TRANSPORT)};
    const call = claudeTransport({ bin: ${JSON.stringify(FAKE)}, env: { PATH: process.env.PATH, HOME: ${
  JSON.stringify(fake.dir)} }, deadline: Date.now() + 60_000 })({ id: 'b'.repeat(64), kind: 'functions', system: 's',
      prompt: 'p', ids: {} });
    call.catch(() => {});
    process.stdin.once('data', () => process.exit(0));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script],
    { stdio: ['pipe', 'ignore', 'inherit'] });
  const ended = new Promise((done) => child.once('exit', done));
  const [pid] = await until(() => fake.pids().length && fake.pids());
  assert.equal(runs(pid), true);
  child.stdin.end('exit\n');
  await ended;
  // Its parent gone, the stand-in is reaped by the system: wait for that.
  await until(() => !runs(pid));
});
