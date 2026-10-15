// CLI presentation only: deterministic renderers never start a process.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
export const LOCAL_PAGE_OPEN_TIMEOUT_MS = 10_000;
export const LOCAL_PAGE_OPEN_FIX = 'The page is saved, but could not be opened automatically. '
  + 'Open the printed HTML path in your browser; use --no-open for automation or a headless terminal.';

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
  stdout.write(`Local page: ${absolute}\n`);
  if (noOpen) return;
  try { await openPage(absolute); }
  catch { stderr.write(`${LOCAL_PAGE_OPEN_FIX}\n`); }
}
