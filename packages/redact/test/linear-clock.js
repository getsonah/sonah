// The clock for the linearity tests (the slicer's; redaction's went with its detectors, D90). A test file, not a test:
// `npm test` runs `*.test.js` only.
//
// Each linearity test bounds the process CPU time that redacting one adversarial megabyte takes. CPU time
// is not wall time, but a busy machine still adds to it: other processes on shared cores, frequency
// scaling and the garbage collector's own threads all make the same work cost more. `npm test` runs every
// file at once, so a bound that holds on a quiet machine failed under load, on the old tree and the new
// alike. The bound itself is right and stays as written. What changes is how a miss is read:
//
//   1. The work is measured; under the bound, it passes. On a quiet machine this is usually the whole test.
//   2. Over the bound, a fixed linear reference (REFERENCE_PASSES passes of one regular expression over a
//      synthetic megabyte, no redaction code) is measured in the same process, at that moment. The bound is
//      scaled by how much slower the reference runs now than on the machine the bounds were set on
//      (REFERENCE_MS), and never scaled down.
//   3. Still over: the work and the reference are measured once more; it passes if either measurement is under the
//      bound scaled by the slowdown measured beside it.
//
// A miss is always scaled, by about 1.1 even on a quiet machine (the first measurement in a fresh process runs a little
// slow), and under heavy load the reference can slow more than the redaction work does: a regression within about 1.4
// times the bound can then pass (measured in a review on 2026-10-11). A large regression cannot: with the scan bound
// (MAX_KEYED_VALUE) removed, the cases it fixed cost 144 to 338 s of CPU per field, over a hundred times the 1,000 ms
// bound, so they would pass only on a machine measured over a hundred times slower than the reference machine; with
// that bound removed, these tests fail.
//
// Every input is synthetic. Nothing is printed unless a test fails.

import assert from 'node:assert/strict';

const MB = 1 << 20;
const REFERENCE_TEXT = 'key=value --flag a '.repeat(Math.ceil(MB / 19)).slice(0, MB);
const REFERENCE_PASSES = 8;
/** CPU milliseconds of the reference on the machine the bounds were set on (2026-10-10: 42.4, the lowest of 75 runs
 *  in 3 processes on a 10-core laptop at a load average of about 3). */
export const REFERENCE_MS = 42;

/** CPU and wall milliseconds `run` takes. */
export function cost(run) {
  const cpu = process.cpuUsage();
  const t0 = performance.now();
  run();
  const { user, system } = process.cpuUsage(cpu);
  return { cpu: (user + system) / 1000, wall: performance.now() - t0 };
}

/** CPU milliseconds of the linear reference, measured now. */
export function referenceMs() {
  return cost(() => {
    let n = 0;
    for (let pass = 0; pass < REFERENCE_PASSES; pass++) for (const m of REFERENCE_TEXT.matchAll(/[a-z]+/g)) n += m[0].length;
    return n;
  }).cpu;
}

/** How much slower this process runs linear work now than the reference machine did; at least 1. */
export function slowdown() {
  return Math.max(1, referenceMs() / REFERENCE_MS);
}

/** Assert that `run` costs under `boundMs` of CPU, the bound scaled by the slowdown measured now (above). */
export function assertLinear(run, boundMs, label) {
  const first = cost(run);
  if (first.cpu < boundMs) return;
  const scale = slowdown();
  if (first.cpu < boundMs * scale) return;
  const again = cost(run);
  judge(first, scale, again, slowdown(), boundMs, label);
}

/** CPU and wall milliseconds `run` takes when it awaits (a file read): the process's CPU time across it. A test file
 *  runs in its own process and its tests one at a time, so that time is the work's own. */
export async function costAsync(run) {
  const cpu = process.cpuUsage();
  const t0 = performance.now();
  await run();
  const { user, system } = process.cpuUsage(cpu);
  return { cpu: (user + system) / 1000, wall: performance.now() - t0 };
}

/** assertLinear, for work that awaits. */
export async function assertLinearAsync(run, boundMs, label) {
  const first = await costAsync(run);
  if (first.cpu < boundMs) return;
  const scale = slowdown();
  if (first.cpu < boundMs * scale) return;
  const again = await costAsync(run);
  judge(first, scale, again, slowdown(), boundMs, label);
}

/** The last step: each cost is compared with the slowdown measured beside it, never a quiet cost with a busy
 *  reference, and the better of the two must be under the bound. */
function judge(first, scale, again, scaleAgain, boundMs, label) {
  const best = first.cpu / scale <= again.cpu / scaleAgain ? { ...first, scale } : { ...again, scale: scaleAgain };
  assert.ok(best.cpu < boundMs * best.scale, `${label}: ${Math.round(best.cpu)} ms of CPU (${Math.round(best.wall)} ms wall), `
    + `over ${boundMs} ms scaled by a measured slowdown of ${best.scale.toFixed(2)}`);
}
