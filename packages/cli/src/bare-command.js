// D218 (the owner, 2026-11-09): bare `sonah`, with no command. In a terminal (its standard input and output both a
// TTY) it draws the graphs page: one notice, then `sonah visual` with no arguments, and the page it writes is opened in
// the browser as a review's html page is (local-page.js). Anywhere else (a pipe, a script, a hook) it prints the usage
// table and exits 2, like any other usage error, and reads, writes and starts nothing.
//
// Exit codes are the visual's own (visual-command.js): 0 the page is written; 1 answers are still needed; 2 a problem it
// names with its fix, to which this adds the line that points to `sonah --help`; 3 Sonah failed. It adds no option, no
// environment variable and no update check (update-check.js UPDATE_NOTICE_COMMANDS).
//
// No work at import: the visual command is imported only when it runs.
import { openLocalPage, presentLocalPage } from './local-page.js';

const HELP_LINE = 'Run sonah --help to see every command.';

/** The lines bare `sonah` adds to what `sonah visual` prints, in fixed words. */
export const BARE_WORDS = Object.freeze({
  // Printed on stderr before the visual runs.
  notice: `Sonah draws this branch's change as a page of graphs, with claude -p on your Claude plan. ${HELP_LINE}`,
  // Printed on stderr after a problem the visual names with its fix (exit 2).
  help: HELP_LINE,
  // Printed on stderr when the browser does not open the page: bare `sonah` has no --no-open to offer.
  openFix: 'Sonah saved the page, but could not open it. Open the HTML path that Sonah printed in your browser.',
});

/** Whether Sonah runs in a terminal: its standard input and its standard output are both a TTY. */
export function isInteractive({ stdin = process.stdin, stdout = process.stdout } = {}) {
  return stdin?.isTTY === true && stdout?.isTTY === true;
}

/**
 * Bare `sonah`: the exit code. `usage` is the command table the entry prints for a usage error. `interactive` is
 * whether it runs in a terminal (isInteractive by default); `runVisual` is `sonah visual`'s runner and `openPage` the
 * browser opener, each injectable so a test needs no terminal, model or browser.
 */
export async function runBareCommand({ usage, interactive = isInteractive(), stdout = process.stdout,
  stderr = process.stderr, runVisual = null, openPage = openLocalPage } = {}) {
  if (!interactive) {
    stderr.write(`${usage}\n`);
    return 2;
  }
  stderr.write(`${BARE_WORDS.notice}\n`);
  const visual = runVisual ?? (await import('./visual-command.js')).runVisualCommand;
  // The visual prints the `Local page:` line through presentPage, so it is printed once, and then the page is opened.
  const code = await visual([], { stdout, stderr,
    presentPage: (file) => presentLocalPage(file, { stdout, stderr, openPage, openFix: BARE_WORDS.openFix }) });
  if (code === 2) stderr.write(`${BARE_WORDS.help}\n`);
  return code;
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ 'BARE_WORDS.notice': 'notice', 'BARE_WORDS.help': 'action',
  'BARE_WORDS.openFix': 'notice' });
/** `claude -p` and the Claude plan are the names that the claude CLI and its plans use. */
export const STYLE_ALLOW = Object.freeze({ 'BARE_WORDS.notice': ['quoted-term'] });
