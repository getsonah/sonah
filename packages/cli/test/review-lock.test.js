// F32, F84: the review lock, under real concurrency and real load. Synthetic directories and
// injected transports only.
//
// The lock exists so two reviews cannot interleave writes to one state directory. Proving it works
// needs genuine processes: a same-process `assert.rejects(store.lock())` only shows that the second
// call sees the first call's finished work, which was never the failure.
//
// F32 was a lock directory published before its owner file. F84 was what the directory shape left
// behind after that fix: every release and every reclaim removed `active.lock` with a recursive
// delete, and a recursive delete passes through an EMPTY directory — which `rename()` will replace.
// A contender renamed its lock into the directory a releaser had just emptied; the releaser's
// delete, or a reclaimer's, then unlinked the new holder's owner file by path, and a third process
// renamed into the directory that was empty again. Worse, "owner file absent" read as a stale
// legacy lock whose generation was always the same empty string, so a reclaimer that saw it once
// (mid-release) saw it again later, "confirmed" it, and deleted whichever live lock was there by
// then. It passed the one-shot race 5 of 5 on an idle machine and failed under suite load.
//
// So these tests load every core, keep the contenders acquiring AND releasing inside the barrier
// window, and count simultaneous holders with an independent witness — not `held` lines, which a
// contender stalled past an honest release would also print.
//
// D82 step 10: F35 (Ctrl-C releases the lock and exits 130) was the removed PR route's own signal
// handling and went with it; the session review stops at Ctrl-C through its abort signal and
// releases the lock in `reviewSession`'s `finally` (session-review.test.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';

const MODULE = new URL('../src/session-review.js', import.meta.url).href;
const DEAD_PID = 2147483646; // above any pid_max Linux or macOS allows, so never a running process

async function temporary(t, prefix = 'sonah-review-lock-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (path) => stat(path).then(() => true, () => false);

/**
 * Pin every core for the duration of a test. Each spinner watches its parent and has its own
 * deadline, so a killed test run cannot leave a machine full of busy loops behind.
 */
function loadEveryCore(t, perCore = 1) {
  const spinner = `const parent = process.ppid, stop = Date.now() + 90000;
for (;;) { const slice = Date.now() + 25; while (Date.now() < slice); if (Date.now() > stop) process.exit(0);
  try { process.kill(parent, 0); } catch { process.exit(0); } }`;
  const spinners = Array.from({ length: availableParallelism() * perCore }, () =>
    spawn(process.execPath, ['-e', spinner], { stdio: 'ignore' }));
  t.after(() => { for (const child of spinners) child.kill('SIGKILL'); });
}

// One contender process serves every round of a test, so thirty rounds cost one module load, not
// thirty. It loads the module, then for each round waits on a file barrier and plays its mode:
//
//   once   one lock() call. A winner holds until the parent has every contender's verdict, so the
//          number of winners IS the number of simultaneous holders — no hold time to outlast.
//   spin   lock() until it is had or the round stops; a winner holds until the round stops. An
//          attempt already in flight when the round stops may take the lock after the winner
//          lets go, honestly, so here only the witness counts.
//   churn  acquire, occupy, release, again, for the whole window.
//
// The witness: every holder creates one file with O_EXCL on entry and removes it before release.
// Failing to create it means someone else is inside right now — an overlap, whatever the timing.
//
// Anything lock() throws other than `review_in_progress`, and anything release() throws at all, is
// recorded: a review that loses a race must be told the lock is busy, not `review_failed`.
const CHILD = `
import { existsSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
const block = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
const { createReviewStore } = await import(process.env.LOCK_MODULE);
const { LOCK_BARRIER: barrier, LOCK_ROOT: root, LOCK_INDEX: me, LOCK_MODE: mode } = process.env;
const at = (name) => join(barrier, name);
// The parent reads these the moment they exist, so they appear complete or not at all.
const publish = (name, text) => { writeFileSync(at('.' + name), text); renameSync(at('.' + name), at(name)); };
const deadline = Date.now() + 90000;
publish('ready-' + me, '');
for (let round = 0; round < Number(process.env.LOCK_ROUNDS); round++) {
  while (!existsSync(at('go-' + round))) { if (Date.now() > deadline) process.exit(3); block(1); }
  const store = createReviewStore(join(root, 'round-' + round));
  const tally = { held: 0, refused: 0, overlaps: 0, errors: [] };
  const attempt = async () => {
    try { return await store.lock(); }
    catch (error) {
      if (error?.code === 'review_in_progress') tally.refused++;
      else tally.errors.push('lock:' + (error?.code ?? error));
      return null;
    }
  };
  const release = async (held) => {
    try { await held(); } catch (error) { tally.errors.push('release:' + (error?.code ?? error)); }
  };
  const stopped = () => existsSync(at('stop-' + round));
  const inside = at('inside-' + round);
  const enter = () => {
    tally.held++;
    try { closeSync(openSync(inside, 'wx')); return true; }
    catch (error) { if (error.code === 'EEXIST') tally.overlaps++; else tally.errors.push('witness:' + error.code); return false; }
  };
  if (mode === 'churn') {
    const end = Date.now() + Number(process.env.LOCK_WINDOW_MS);
    while (Date.now() < end) {
      const held = await attempt();
      if (!held) continue;
      const entered = enter();
      await tick();
      if (entered) unlinkSync(inside);
      await release(held);
    }
  } else {
    let held = await attempt();
    while (!held && mode === 'spin' && !stopped() && Date.now() < deadline) held = await attempt();
    const entered = held ? enter() : false;
    publish('verdict-' + round + '-' + me, held ? 'held' : 'busy');
    while (!stopped() && Date.now() < deadline) await tick();
    if (entered) unlinkSync(inside);
    if (held) await release(held);
  }
  publish('done-' + round + '-' + me, JSON.stringify(tally));
}
`;

async function waitForFiles(directory, names, { timeout = 60000, some = false } = {}) {
  for (let waited = 0; waited < timeout; waited += 5) {
    const present = await Promise.all(names.map((name) => exists(join(directory, name))));
    if (some ? present.some(Boolean) : present.every(Boolean)) return true;
    await pause(5);
  }
  return false;
}

/**
 * Run `rounds` rounds of `count` contenders in `mode`, each round against a fresh store directory
 * `<root>/round-<n>`. `before(store, round)` runs before the gate opens; in `spin` mode
 * `during(store, round)` runs once the gate is open. Returns one tally per round.
 */
async function race(t, { count, rounds, mode, windowMs = 0, before = async () => {}, during = async () => {} }) {
  const root = await temporary(t);
  const barrier = await temporary(t, 'sonah-review-barrier-');
  const children = Array.from({ length: count }, (_, index) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, LOCK_MODULE: MODULE, LOCK_ROOT: root, LOCK_BARRIER: barrier, LOCK_MODE: mode,
        LOCK_INDEX: String(index), LOCK_ROUNDS: String(rounds), LOCK_WINDOW_MS: String(windowMs) },
    });
    let err = '';
    child.stderr.on('data', (chunk) => { err += chunk; });
    t.after(() => child.kill('SIGKILL'));
    return new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, err: err.trim() }));
    });
  });
  const everyone = (prefix) => Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
  assert.ok(await waitForFiles(barrier, everyone('ready')), 'every contender must load the module before the first gate');
  const tallies = [];
  for (let round = 0; round < rounds; round++) {
    const store = join(root, `round-${round}`);
    await before(store, round);
    await writeFile(join(barrier, `go-${round}`), '');
    if (mode === 'once') {
      assert.ok(await waitForFiles(barrier, everyone(`verdict-${round}`)), `round ${round}: a contender never settled`);
      await writeFile(join(barrier, `stop-${round}`), '');
    } else if (mode === 'spin') {
      await during(store, round);
      // Someone takes the freed lock; then leave room for a second, wrong, taker before stopping.
      await waitForFiles(barrier, everyone(`verdict-${round}`), { some: true, timeout: 10000 });
      await pause(150);
      await writeFile(join(barrier, `stop-${round}`), '');
    }
    assert.ok(await waitForFiles(barrier, everyone(`done-${round}`)), `round ${round}: a contender never finished`);
    const parts = await Promise.all(everyone(`done-${round}`).map(async (name) => JSON.parse(await readFile(join(barrier, name), 'utf8'))));
    tallies.push({
      round,
      held: parts.reduce((sum, part) => sum + part.held, 0),
      overlaps: parts.reduce((sum, part) => sum + part.overlaps, 0),
      errors: parts.flatMap((part) => part.errors),
      leftover: (await readdir(store).catch(() => [])),
    });
  }
  for (const { code, err } of await Promise.all(children)) {
    assert.equal(err, '', `contender wrote to stderr: ${err}`);
    assert.equal(code, 0, 'contender exited early');
  }
  return tallies;
}

const describe = (tallies) => tallies.map(({ round, held, overlaps, errors, leftover }) =>
  `#${round} held=${held} overlaps=${overlaps}${errors.length ? ` errors=${[...new Set(errors)].join('|')}` : ''}${leftover.length ? ` left=${leftover.join('|')}` : ''}`).join('\n');

test('under load, 20 processes acquiring and releasing: never two inside at once, 30 runs (F84)', async (t) => {
  // Two spinners per core: at one per core the old lock's overlaps were too rare to show in 30
  // short runs (its thrown ENOTEMPTY/EINVAL showed in every run either way).
  loadEveryCore(t, 2);
  const tallies = await race(t, { count: 20, rounds: 30, mode: 'churn', windowMs: 250 });
  const summary = describe(tallies);
  assert.deepEqual(tallies.filter((r) => r.overlaps > 0).map((r) => r.round), [], `two simultaneous holders:\n${summary}`);
  assert.deepEqual(tallies.filter((r) => r.errors.length).map((r) => r.round), [],
    `lock() may only refuse with review_in_progress, and release() may not throw:\n${summary}`);
  assert.ok(tallies.every((r) => r.held > 0), `every run must make progress:\n${summary}`);
  assert.deepEqual(tallies.filter((r) => r.leftover.length).map((r) => r.round), [],
    `a released lock leaves nothing behind — no lock, temp or claim file:\n${summary}`);
});

test('under load, 20 processes racing a fresh lock: exactly one holds it, 30 runs (F32, F84)', async (t) => {
  loadEveryCore(t);
  const tallies = await race(t, { count: 20, rounds: 30, mode: 'once' });
  const summary = describe(tallies);
  assert.ok(tallies.every((r) => r.held === 1 && r.overlaps === 0 && !r.errors.length && !r.leftover.length), summary);
});

test('a holder releasing while 12 contenders spin: at most one new holder, and the release is clean (F84)', async (t) => {
  loadEveryCore(t);
  const { createReviewStore } = await import('../src/session-review.js');
  const releaseErrors = [];
  const releases = [];
  const tallies = await race(t, { count: 12, rounds: 10, mode: 'spin',
    before: async (store) => { releases.push(await createReviewStore(store).lock()); },
    during: async (store, round) => {
      await pause(40);
      try { await releases[round](); } catch (error) { releaseErrors.push(`#${round} ${error?.code ?? error}`); }
    } });
  const summary = describe(tallies);
  assert.deepEqual(releaseErrors, [], 'the holder\'s own release must not fail because a contender moved in');
  assert.ok(tallies.every((r) => r.held >= 1 && r.overlaps === 0 && !r.errors.length && !r.leftover.length), summary);
});

test('under load, a lock whose owner is dead is reclaimed by exactly one of 10 contenders (F32, F84)', async (t) => {
  loadEveryCore(t);
  const stale = JSON.stringify({ pid: DEAD_PID, startedAt: '2026-01-01T00:00:00.000Z', nonce: 'synthetic' });
  const tallies = await race(t, { count: 10, rounds: 10, mode: 'once',
    before: async (store) => {
      await mkdir(store, { recursive: true, mode: 0o700 });
      await writeFile(join(store, 'active.lock'), stale, { mode: 0o600 });
    } });
  assert.ok(tallies.every((r) => r.held === 1 && !r.errors.length && !r.leftover.length), describe(tallies));
});

test('the legacy lock directory is migrated once: dead or ownerless, one of 10 contenders takes it (F84)', async (t) => {
  const tallies = await race(t, { count: 10, rounds: 6, mode: 'once',
    before: async (store, round) => {
      await mkdir(join(store, 'active.lock'), { recursive: true, mode: 0o700 });
      if (round % 2) await writeFile(join(store, 'active.lock', 'owner.json'), JSON.stringify({ pid: DEAD_PID }));
    } });
  assert.ok(tallies.every((r) => r.held === 1 && !r.errors.length && !r.leftover.length), describe(tallies));
});

test('the lock on disk is one complete file, and a legacy directory becomes one', async (t) => {
  const directory = await temporary(t);
  const { createReviewStore } = await import('../src/session-review.js');
  const lockPath = join(directory, 'active.lock');
  await mkdir(lockPath, { recursive: true, mode: 0o700 });
  await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: DEAD_PID }));
  const release = await createReviewStore(directory).lock();
  assert.ok((await stat(lockPath)).isFile(), 'the migrated lock is a file');
  const owner = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(owner.pid, process.pid);
  assert.equal(typeof owner.nonce, 'string');
  assert.deepEqual(await readdir(directory), ['active.lock'], 'no temp, claim or aside directory survives');
  await release();
  assert.deepEqual(await readdir(directory), []);
});

test('a release by a non-owner removes nothing: a stale release cannot free the next holder\'s lock (F84)', async (t) => {
  const directory = await temporary(t);
  const { createReviewStore } = await import('../src/session-review.js');
  const lockPath = join(directory, 'active.lock');
  const first = await createReviewStore(directory).lock();
  await first();
  const second = await createReviewStore(directory).lock();
  const secondBytes = await readFile(lockPath, 'utf8');
  // The first holder's release runs again — a signal handler racing the normal `finally`, say.
  await first();
  assert.equal(await readFile(lockPath, 'utf8'), secondBytes, 'the second holder still holds');
  await assert.rejects(createReviewStore(directory).lock(), { code: 'review_in_progress' });
  // Nor can a lock replaced behind a holder's back be freed by that holder.
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, nonce: 'someone-else' }));
  await second();
  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).nonce, 'someone-else');
});

test('a live owner is refused by name, with the path a reader can act on — file or legacy directory', async (t) => {
  const { createReviewStore } = await import('../src/session-review.js');
  for (const legacy of [false, true]) {
    const directory = await temporary(t);
    const lockPath = join(directory, 'active.lock');
    if (legacy) {
      await mkdir(lockPath, { recursive: true, mode: 0o700 });
      await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid }));
    } else await writeFile(lockPath, JSON.stringify({ pid: process.pid, nonce: 'live' }));
    await assert.rejects(createReviewStore(directory).lock(), (error) => {
      assert.equal(error.code, 'review_in_progress');
      assert.equal(error.lockPath, lockPath);
      return true;
    });
    assert.ok(await exists(legacy ? join(lockPath, 'owner.json') : lockPath), 'a live lock is left alone');
  }
});
