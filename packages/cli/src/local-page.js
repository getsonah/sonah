// CLI presentation only: deterministic renderers never start a process.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
export const LOCAL_PAGE_OPEN_TIMEOUT_MS = 10_000;
export const LOCAL_PAGE_OPEN_FIX = 'Sonah saved the page, but could not open it. Open the HTML path that Sonah printed '
  + 'in your browser. Use --no-open for automation or a terminal with no display.';
/** The line that names the saved page. */
export const LOCAL_PAGE_WORDS = Object.freeze({ line: (path) => `Local page: ${path}` });

/** Pass one file URL through argv, never through a shell. execFile captures opener output.
 * Windows' native URL handler is documented by Microsoft Support:
 * https://support.microsoft.com/da-dk/topic/you-are-prompted-to-specify-internet-explorer-when-you-click-a-link-in-outlook-2010-or-outlook-2007-4821ce97-2778-6c86-6963-994f2db2f690
 */
export async function openLocalPage(file, { platform = process.platform, exec = execute } = {}) {
  const url = pathToFileURL(resolve(file)).href;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await exec(command, args, { shell: false, windowsHide: true, timeout: LOCAL_PAGE_OPEN_TIMEOUT_MS });
}

/** Call only after the HTML has been saved successfully. Failure to launch the browser is
 * an operational warning, never a failed review or a reason to delete the saved page. */
export async function presentLocalPage(file, { stdout = process.stdout, stderr = process.stderr,
  noOpen = false, openPage = openLocalPage } = {}) {
  const absolute = resolve(file);
  stdout.write(`${LOCAL_PAGE_WORDS.line(absolute)}\n`);
  if (noOpen) return;
  try { await openPage(absolute); }
  catch { stderr.write(`${LOCAL_PAGE_OPEN_FIX}\n`); }
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ LOCAL_PAGE_OPEN_FIX: 'notice', LOCAL_PAGE_WORDS: 'label' });
export const STYLE_FIXTURES = Object.freeze({ 'LOCAL_PAGE_WORDS.line': [['/tmp/review.html']] });
