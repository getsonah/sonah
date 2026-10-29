import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { detectAdapters } from '../src/doctor.js';
import { scratchDir } from '../../slicer/test/scratch-dir.js';

const exec = promisify(execFile);
// fileURLToPath, never URL.pathname: a checkout may live under "Acme Labs", and .pathname
// percent-encodes the space, spawning a nonexistent file.
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));

// Every temp dir carries a space on purpose — this repo's oldest enemy.
async function home() {
  return scratchDir('dev doctor ');
}

// -------------------------------------------------------------------------- adapter facts

test('adapters: presence is counted from real artifacts, per each tool\'s convention', async () => {
  const h = await home(); // path contains spaces; every convention below must survive them
  await mkdir(join(h, '.claude', 'projects', '-Users-x-proj'), { recursive: true });
  await writeFile(join(h, '.claude', 'projects', '-Users-x-proj', 'abc.jsonl'), '{}\n', 'utf8');
  await mkdir(join(h, '.codex', 'sessions', '2026', '08', '31'), { recursive: true });
  await writeFile(join(h, '.codex', 'sessions', '2026', '08', '31', 'rollout-2026-08-31T12-00-00-abc.jsonl'), '{}\n', 'utf8');
  await writeFile(join(h, '.codex', 'sessions', '2026', '08', '31', 'not-a-rollout.jsonl'), '{}\n', 'utf8');

  const a = await detectAdapters({ home: h, codexHome: join(h, '.codex') });
  assert.equal(a.claude.count, 1);
  assert.equal(a.codex.count, 1, 'only rollout-*.jsonl counts as a codex session');
});

test('adapters: an empty machine reports zeros, never throws', async () => {
  const h = await home();
  const a = await detectAdapters({ home: h, codexHome: join(h, '.codex') });
  assert.deepEqual([a.claude.count, a.codex.count], [0, 0]);
});

// -------------------------------------------------------------------------------- doctor

test('doctor CLI: an absent Claude CLI needs attention, and doctor is in the usage text', async () => {
  const h = await home();
  const ledgerHome = await scratchDir('dev led ');
  const env = { HOME: h, SONAH_HOME: ledgerHome, PATH: '/usr/bin:/bin', SONAH_CODEX_BIN: join(h, 'absent-codex'),
    SONAH_NO_UPDATE_CHECK: '1' };
  delete env.ANTHROPIC_API_KEY;
  // W3d-8: doctor reads Claude's settings from its own env; the runner's must not redirect it.
  delete env.CLAUDE_CONFIG_DIR; delete env.SONAH_CLAUDE_PROJECTS;
  const out = await exec(process.execPath, [BIN, 'doctor', '--no-probe'], { env, cwd: h })
    .then((r) => ({ code: 0, ...r }))
    .catch((e) => ({ code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
  assert.equal(out.code, 1, 'missing Claude is attention, not a crash');
  assert.match(out.stdout, /needs attention: claude/);

  const usage = await exec(process.execPath, [BIN, 'not-a-command'], { env }).catch((e) => e);
  assert.match(usage.stderr ?? '', /doctor/);
});
