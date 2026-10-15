import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { feedbackBundle } from '../src/feedback.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';

const now = new Date('2026-09-10T00:00:00Z');
// D76: the capture hooks, the commit trailer and the saved ledgers retired, so feedback counts recordings only.
const adapters = async () => ({ claude: { count: 2, where: '/Users/private' }, codex: { count: 3, where: '/Users/private/.codex' } });

test('feedback shares safe counts and the selected reviewer without calling a model or copying freeform text', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'sonah-fb-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const r = await feedbackBundle({ version: '0.2.1 (abc1234 2026-09-10)', outDir: home, now, adapters,
    env: { SONAH_REVIEW_BACKEND: 'codex-cli', SONAH_MODEL: 'gpt-6.1-sol', OPENAI_API_KEY: 'PRIVATE key' } });
  const text = await readFile(r.file, 'utf8');
  assert.equal(text, r.text);
  assert.match(text, /version: 0\.2\.1 \(abc1234 2026-09-10\)/);
  assert.match(text, /provider: Codex\n  model: gpt-6\.1-sol\n  transport: ChatGPT subscription/);
  assert.match(text, /model access: UNCHECKED/);
  assert.match(text, /## recordings\n  claude recordings found: 2\n  codex recordings found: 3\n/);
  assert.doesNotMatch(text, /capture hooks|commit trailer|saved sessions|cursor|entire/);
  assert.doesNotMatch(text, /PRIVATE|\/Users\//);
  assert.match(r.file, /sonah-feedback-2026-09-10\.md$/);
  assert.equal((await stat(r.file)).mode & 0o777, 0o600);
});

// O12 (D75): the selection is the session route's, through `reviewJudgeConfig`. The legacy selector threw on the default
// model's context selector, so a setting naming the default printed UNCHECKED.
test('feedback names the reviewer `sonah review` would run, its default model included', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'sonah-fb-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const claude = `provider: Claude Code\n  model: ${SESSION_REVIEW_CLAUDE_CLI_MODEL}\n  transport: Claude Code CLI (billing UNCHECKED)`;
  for (const env of [{}, { SONAH_MODEL: SESSION_REVIEW_CLAUDE_CLI_MODEL }, { ANTHROPIC_API_KEY: 'PRIVATE API secret' }]) {
    const r = await feedbackBundle({ outDir: home, now, env, adapters });
    assert.ok(r.text.includes(claude), JSON.stringify(Object.keys(env)));
    assert.doesNotMatch(r.text, /PRIVATE/);
  }
  const api = await feedbackBundle({ outDir: home, now, adapters,
    env: { SONAH_REVIEW_BACKEND: 'anthropic-api', SONAH_MODEL: 'claude-private-api-9', ANTHROPIC_API_KEY: 'PRIVATE API secret' } });
  assert.match(api.text, /provider: Anthropic API\n  model: custom model \(name omitted\)\n  transport: API billing; ANTHROPIC_API_KEY set/);
  assert.doesNotMatch(api.text, /PRIVATE|private-api/);
  for (const env of [{ SONAH_MODEL: 'sonnet' }, { SONAH_REVIEW_BACKEND: 'codex-cli' }])
    assert.match((await feedbackBundle({ outDir: home, now, env, adapters })).text,
      /provider and model: UNCHECKED \(invalid configuration\)/, JSON.stringify(env));
});

test('feedback omits counting failures and untrusted configuration names, and marks missing facts UNCHECKED', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'sonah-fb-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const r = await feedbackBundle({ version: 'PRIVATE /Users/private', outDir: home, now,
    env: { SONAH_MODEL: 'claude-private-example-9', ANTHROPIC_API_KEY: 'PRIVATE API secret' },
    adapters: async () => { throw new Error('PRIVATE counting failure /Users/private'); } });
  assert.match(r.text, /model: custom model \(name omitted\)/);
  assert.match(r.text, /recordings found: UNCHECKED \(could not be counted\)/);
  assert.match(r.text, /version: UNCHECKED/);
  assert.doesNotMatch(r.text, /PRIVATE|private-example|\/Users\//);
});

test('feedback does not turn malformed counts or an invalid selection into a clean status', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'sonah-fb-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const r = await feedbackBundle({ outDir: home, now, env: { SONAH_REVIEW_BACKEND: 'PRIVATE invalid' },
    adapters: async () => ({ claude: { count: 'PRIVATE count' }, codex: { count: -1 } }) });
  assert.match(r.text, /claude recordings found: UNCHECKED\n  codex recordings found: UNCHECKED/);
  assert.match(r.text, /UNCHECKED \(invalid configuration\)/);
  assert.doesNotMatch(r.text, /PRIVATE/);
});

test('feedback keeps an existing output private and refuses a symlink output', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'sonah-fb-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = join(home, 'sonah-feedback-2026-09-10.md');
  await writeFile(file, 'old');
  await chmod(file, 0o644);
  await feedbackBundle({ outDir: home, now, env: {}, adapters });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await rm(file);
  const target = join(home, 'keep.txt');
  await writeFile(target, 'keep');
  await symlink(target, file);
  await assert.rejects(feedbackBundle({ outDir: home, now, env: {}, adapters }), { code: 'ELOOP' });
  assert.equal(await readFile(target, 'utf8'), 'keep');
});
