// The deterministic core, enforced rather than declared.
//
// A project rule: `slicer`, `redact` and `render` make no network calls, no model calls, and
// no clock or random reads — same input, same bytes out, forever. That was a paragraph, and a
// paragraph does not notice when `packages/slicer/src/entire.js` starts shelling out to `git`
// and materialising blobs under a random `mkdtemp` path that then lands in `lineage.files`, so
// the same checkpoint hashes differently on every read (M89).
//
// This is the CI grep written as a test, so it runs wherever the suite runs — including on the
// machine of whoever is about to add the next import.
//
// `createHash` from `node:crypto` is allowed: it is the one pure primitive here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative as rel } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DETERMINISTIC = ['slicer', 'redact', 'render'];

/** Token -> why it may not appear. Substrings, deliberately: this is a grep, not a parser. */
const FORBIDDEN = [
  ['node:child_process', 'a subprocess is not a pure function of the input'],
  ['child_process', 'a subprocess is not a pure function of the input'],
  ["node:os'", 'os.tmpdir/homedir make the output depend on the machine'],
  ['randomUUID', 'randomness is the opposite of a deterministic stage'],
  ['randomBytes', 'randomness is the opposite of a deterministic stage'],
  ['mkdtemp', 'a random temp path ends up inside a hashed structure'],
  ['Date.now', 'the clock makes the same input produce different bytes'],
  ['Math.random', 'randomness is the opposite of a deterministic stage'],
  ['fetch(', 'a deterministic stage makes no network call'],
  ['node:http', 'a deterministic stage makes no network call'],
  ['node:https', 'a deterministic stage makes no network call'],
  ['node:net', 'a deterministic stage makes no network call'],
];

/** Every .js file of a package except its tests. */
async function sources(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'test' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await sources(p, out);
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('the deterministic packages import no subprocess, clock, randomness or network', async () => {
  const offences = [];
  let scanned = 0;
  for (const pkg of DETERMINISTIC) {
    for (const file of await sources(join(ROOT, 'packages', pkg))) {
      scanned++;
      const text = await readFile(file, 'utf8');
      for (const [token, why] of FORBIDDEN) {
        if (text.includes(token)) offences.push(`${rel(ROOT, file)}: ${token} — ${why}`);
      }
    }
  }
  assert.ok(scanned > 20, `expected to scan the three packages, saw ${scanned} files`);
  assert.deepEqual(offences, []);
});

test('the scan can actually fail — the grep is over real file contents', async () => {
  // A guard that passes on anything proves nothing. The same predicate, pointed at a package
  // that is ALLOWED to shell out, must find the imports it was written to find.
  // review-judge.js starts the reviewer CLI in a private temporary folder, outside the core.
  const text = await readFile(join(ROOT, 'packages', 'cli', 'src', 'review-judge.js'), 'utf8');
  assert.ok(text.includes('node:child_process'), 'review-judge.js still starts a process — outside the core');
  assert.ok(text.includes('mkdtemp'));
});
