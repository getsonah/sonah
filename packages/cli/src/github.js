// The GitHub token for the session review's PR comment (`--github OWNER/REPO --pr N --post-comment`): its metadata
// read and the confirmed post. Zero dependencies: spawn only.

import { spawn } from 'node:child_process';

function run(cmd, args) {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('error', () => resolve(null));
      p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    } catch { resolve(null); }
  });
}

/** Token: GH_TOKEN / GITHUB_TOKEN, else `gh auth token`. Never printed. */
export async function resolveToken(env = process.env) {
  if (env.GH_TOKEN) return env.GH_TOKEN;
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  return (await run('gh', ['auth', 'token'])) || null;
}
