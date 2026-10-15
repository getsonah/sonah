// Temporary folders for a test file, removed when its tests end. A helper, not a test: `npm test` runs `*.test.js`
// only. Each test file runs in its own process, so the hook below runs once, after that file's last test.
import { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made = [];
after(() => Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true }))));

/** A new folder under the system's temporary folder, named `prefix` and six random characters. */
export async function scratchDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
