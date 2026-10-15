// D40: a session run inside a harness-created git worktree (<repo>/.claude/worktrees/<name>/) is
// working in the project, not in the harness's own files. Its writes are internal; ~/.claude/
// memory and settings stay external.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { session, toJsonl } from '../../golden/index.js';
import { sliceLineage } from '../index.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scratchDir } from './scratch-dir.js';

test('writes under <repo>/.claude/worktrees/<name>/ are internal; writes under ~/.claude/ stay external', async () => {
  const cwd = '/Users/x/proj/.claude/worktrees/nice-solomon-07bff1';
  const s = session({ cwd })
    .ask('Fix the parser and add a test.')
    .edit(`${cwd}/src/parser.js`, 'a', 'b')
    .create(`${cwd}/tests/test_parser.py`, 'def test_x(): pass')
    .create('/Users/x/.claude/projects/-Users-x-proj/memory/note.md', 'remember')
    .say('Done.')
    .done();
  const dir = await scratchDir('sonah-wt-');
  const file = join(dir, 's.jsonl');
  await writeFile(file, `${toJsonl(s)}\n`);
  const led = await sliceLineage([file]);
  const writes = led.ledger.filter((e) => e.kind === 'edit' || e.kind === 'create');
  const byPath = Object.fromEntries(writes.map((e) => [e.path, !!e.external]));
  assert.equal(byPath['src/parser.js'], false, 'a source write in the worktree is internal');
  assert.equal(byPath['tests/test_parser.py'], false, 'a test write in the worktree is internal');
  const memory = writes.find((e) => /memory\/note\.md$/.test(e.path));
  assert.ok(memory && memory.external, 'the harness memory file stays external');
});
