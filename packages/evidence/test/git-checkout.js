// Whether a test may ask git about this repository. A helper, not a test: `npm test` runs `*.test.js` only.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

/** False when `root` is the top of a git checkout; otherwise the reason a test that needs one is skipped. A download
 *  without its .git folder (GitHub's "Download ZIP") has none, one unpacked inside another repository is not it, and
 *  a machine without git cannot tell. */
export function needsCheckout(root) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
  try { if (top.status === 0 && realpathSync(top.stdout.trim()) === realpathSync(root)) return false; } catch {}
  return 'needs a git checkout of this repository';
}
