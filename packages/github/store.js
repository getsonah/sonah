import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, GitHubError } from './errors.js';

const keyName = (key) => { if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) fail('invalid_input'); return key; };

// A per-PR exclusive lock prevents duplicate local workers. Locks are not automatically
// stolen after a timeout: a process may still have an uncertain remote request in flight.
export function createFileOperationStore({ directory }) {
  if (typeof directory !== 'string' || !directory.length) fail('invalid_input');
  const root = resolve(directory);
  return {
    async withLock(key, work) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const path = join(root, `${keyName(key)}.lock`);
      let handle;
      try { handle = await open(path, 'wx', 0o600); }
      catch (error) { fail(error.code === 'EEXIST' ? 'operation_busy' : 'operation_store_failed'); }
      try { await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.sync(); return await work(); }
      finally { await handle.close(); await unlink(path); }
    },
    async get(key) {
      try { return JSON.parse(await readFile(join(root, `${keyName(key)}.json`), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; fail('operation_store_failed'); }
    },
    async put(key, value) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const path = join(root, `${keyName(key)}.json`);
      const temporary = `${path}.${randomUUID()}.tmp`;
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); await handle.close(); handle = null;
        await rename(temporary, path);
        const dir = await open(root, 'r'); try { await dir.sync(); } finally { await dir.close(); }
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        await unlink(temporary).catch(() => {});
        if (error instanceof GitHubError) throw error;
        fail('operation_store_failed');
      }
    },
  };
}
