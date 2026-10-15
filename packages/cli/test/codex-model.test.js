// The Codex executable resolver and argv (codex-model.js) that packages/cli/src/review-judge.js and `sonah doctor` use.
// No process is spawned and no model is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexExecutable, codexJudgeArgs } from '../src/codex-model.js';

test('Codex argv forces ChatGPT auth, isolated instructions and read-only execution', () => {
  const args = codexJudgeArgs('gpt-5.6-sol', '/tmp/fixture instructions.txt');
  assert.ok(args.includes('forced_login_method="chatgpt"'));
  assert.ok(args.includes('model_provider="openai"'));
  assert.ok(args.includes('--ignore-user-config') && args.includes('--ephemeral'));
  assert.ok(args.includes('read-only') && args.includes('project_doc_max_bytes=0'));
  assert.ok(args.includes('shell_tool') && args.includes('hooks') && args.includes('plugins'));
  assert.equal(args.at(-1), '-');
  assert.ok(!args.some(a => /bypass|danger-full-access/.test(a)));
});

test('M25 Codex resolver honors override and discovers executable desktop bundles', () => {
  const nested = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  const legacy = '/Applications/ChatGPT.app/Contents/Resources/codex';
  const seen = [];
  const executable = (path) => { seen.push(path); return path === nested; };
  assert.equal(codexExecutable({ SONAH_CODEX_BIN: '/synthetic/selected-codex' },
    { platform: 'darwin', executable }), '/synthetic/selected-codex');
  assert.deepEqual(seen, [], 'an explicit override does not probe or fall back');
  assert.equal(codexExecutable({}, { platform: 'darwin', executable }), nested);
  assert.deepEqual(seen, [nested]);
  assert.equal(codexExecutable({}, { platform: 'darwin', executable: (path) => path === legacy }), legacy);
  assert.equal(codexExecutable({}, { platform: 'darwin', executable: () => false }), 'codex');
  assert.equal(codexExecutable({}, { platform: 'linux', executable: () => true }), 'codex');
});
