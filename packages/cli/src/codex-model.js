// Which Codex CLI to run, and its subscription-only argv (prompts go over stdin, never process argv). The transport that
// spawns it is packages/cli/src/review-judge.js; `sonah doctor` resolves the same executable.
import { accessSync, constants as fsConstants, statSync } from 'node:fs';

function isExecutableFile(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  }
  catch { return false; }
}

export function codexExecutable(env = process.env, { platform = process.platform, executable = isExecutableFile } = {}) {
  // An explicit override is authoritative. A bad path must fail at spawn, not silently use
  // another account's CLI. The transport never includes the path or spawn error in its result.
  if (typeof env.SONAH_CODEX_BIN === 'string' && env.SONAH_CODEX_BIN) return env.SONAH_CODEX_BIN;
  // Desktop builds place the native CLI inside a nested app bundle. Prefer an executable
  // native binary to the legacy resource path and an occasionally stale npm launcher.
  if (platform === 'darwin') {
    for (const suffix of ['Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', 'Contents/Resources/codex']) {
      for (const app of ['ChatGPT', 'Codex']) {
        const candidate = `/Applications/${app}.app/${suffix}`;
        if (executable(candidate)) return candidate;
      }
    }
  }
  return 'codex';
}

export function codexJudgeArgs(model, instructionsFile) {
  return ['exec', '--model', model, '--json', '--ephemeral', '--skip-git-repo-check',
    '--ignore-user-config', '--sandbox', 'read-only', '--color', 'never',
    '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"',
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"',
    '-c', 'project_doc_max_bytes=0', '-c', 'tools.view_image=false',
    '-c', `model_instructions_file=${JSON.stringify(instructionsFile)}`,
    ...['shell_tool', 'hooks', 'multi_agent', 'apps', 'plugins', 'browser_use', 'computer_use', 'image_generation']
      .flatMap((name) => ['--disable', name]), '-'];
}
