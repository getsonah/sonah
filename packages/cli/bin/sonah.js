#!/usr/bin/env node
// Top-level failure contract (D71 (a), owner decision 2026-10-08: an exit code never judges the agent's work):
//   exit 0  the command ran to completion
//   exit 1  the command ran, and something needs you: `review` did not complete; `doctor` found something to fix;
//           `sessions` found none; `hook add` printed a line for you to add; `skill add|remove` found a file it did
//           not write; `decision` refused an answer; `connect` heard no, or `connect`, `disconnect` or `status` left a
//           token for you to revoke or a connection that no longer works; `hook add --push` printed a line for you to
//           add, or found the private client's push hook; `connect` or `status` found a push hook that needs you
//           (D230: or `status`, a reminder whose entry needs you);
//           `share` has no drawn page of this commit to put online; `fix` asked and you said no; `remind on` printed
//           an entry for you to add, found no Claude Code folder or the private client's reminder, or `remind off`
//           found a settings file it cannot read (docs/TROUBLESHOOTING.md, Exit codes, lists each).
//           D225, D227 and D230: the hidden `pre-push`, `push-run`, `remind-hook` and `remind-refresh` always exit 0
//   exit 2  usage error, or a problem Sonah names with its fix
//   exit 3  the tool itself failed, or `skill add|remove` could not write or delete its file
//
// A crash must NEVER exit 0. Garbage input once produced a raw stack trace followed by exit 0 — a
// failure reporting success, in a tool whose entire thesis is that silent false-negatives are the
// most dangerous failure shape.
process.exitCode = 3;
process.on('uncaughtException', (e) => { fail(e); });
process.on('unhandledRejection', (e) => { fail(e); });

function fail(e) {
  const msg = e?.code === 'ENOENT' ? `no such file: ${e.path ?? ''}` : (e?.message ?? String(e));
  console.error(`sonah: ${msg}`);
  // SONAH_DEBUG prints the stack trace; DEVIATION_DEBUG, the same switch's earlier name, still works.
  if (process.env.SONAH_DEBUG || process.env.DEVIATION_DEBUG) console.error(e?.stack ?? '');
  process.exit(3);
}

const argv = process.argv.slice(2);
// D218 (the owner, 2026-11-09; it replaces the rule of 2026-10-06 that bare `sonah` runs nothing): bare `sonah` in a
// terminal, its standard input and output both a TTY, draws the graphs page. It runs `sonah visual` with no arguments
// and opens the page in the browser (bare-command.js). Anywhere else it prints the usage table and exits 2, like any
// other usage error, as it has since the legacy gate's retirement.
const cmd = argv[0];

/** This Sonah's version: the build's own when it carries one, else the package's. */
async function plainVersion() {
  return typeof SONAH_VERSION === 'string' ? SONAH_VERSION
    : JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version;
}

async function versionText() {
  const version = await plainVersion();
  const build = typeof SONAH_BUILD === 'string' ? SONAH_BUILD : '';
  return build ? `${version} (${build})` : version;
}

// The whole dispatch runs inside main(): no top-level await, so the entry can be bundled to CJS
// and compiled to bytecode for distribution (bun build --compile --bytecode).
async function main() {
// D76: early previews' `sonah init` installed hooks that call these by name: Claude Code hooks call `capture` and
// `capture-outcome` with no `|| true`. An unknown command exits 2, which blocks a Stop hook and hands stderr to the
// agent, so both stay: they exit 0 and write and print nothing. D77: the git hook it wrote into prepare-commit-msg,
// `node "<bin>" trailer "$1" || true`, printed the usage on every commit, so `trailer` stays the same way; the message
// file it names is not read. Everything they did (capture ledgers, exit-code sidecars, the commit trailer) is retired;
// sidecars already on disk are still read.
// What a hook sends on stdin is read to its end and dropped chunk by chunk, never parsed or kept: exiting unread left a
// large PostToolUse payload's writer with EPIPE. A terminal's stdin is not read (nothing to drain, and it would wait).
if (cmd === 'capture' || cmd === 'capture-outcome' || cmd === 'trailer') {
  try {
    if (!process.stdin.isTTY) await new Promise((done) => {
      process.stdin.on('data', () => {}).once('end', done).once('close', done).once('error', done);
    });
  } catch { /* nothing to drain */ }
  process.exit(0);
}
// D225: the hidden `pre-push <remote> <url>`, which the push script that `sonah hook add --push` writes runs at each push
// (push-hook-run.js). Files on disk call it by name, so it stays for good. It must never fail, slow or stop a push: it
// has its own crash handler (any crash ends it with exit 0 and no word, never the exit 3 above), it ends after 5 seconds
// whatever is slow, and it runs before --help and the update check. It writes nothing on standard output.
if (cmd === 'pre-push') {
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  process.exitCode = 0;
  setTimeout(() => process.exit(0), 5000).unref();
  try {
    const { runPrePush } = await import('../src/push-hook-run.js');
    await runPrePush(argv.slice(1));
    // A pipe's writes are not synchronous everywhere: its lines reach git before the process ends.
    await new Promise((done) => process.stderr.write('', done));
  } catch { /* a push is never failed */ }
  process.exit(0);
}
// D227: the hidden `push-run --repo DIR`, which `pre-push` starts detached, in a process group of its own, at low
// priority: the background review of the pushed branches (push-run.js). Files on disk start it by name through the
// push hook, so it stays for good. It has its own crash handler (any crash ends it with exit 0 and no word, never the
// exit 3 above: nobody reads it), runs before --help and the update check, prints nothing, and reads no standard input
// (what comes there is drained). Its runs say in team/runs.json and their logs how they ended; its backstop and its
// calls' deadlines end it.
if (cmd === 'push-run') {
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  process.exitCode = 0;
  // What comes on stdin is read and dropped as it comes, and its end awaited (2 s at most) before the exit, so a writer
  // gets no EPIPE; the push hook gives it none.
  let drained = Promise.resolve();
  try {
    if (!process.stdin.isTTY) drained = new Promise((done) => {
      process.stdin.on('data', () => {}).once('end', done).once('close', done).once('error', done).resume();
    });
  } catch { /* nothing to drain */ }
  try {
    const { pushRunMain } = await import('../src/push-run.js');
    await pushRunMain(argv.slice(1));
  } catch { /* nobody reads it */ }
  await Promise.race([drained, new Promise((done) => setTimeout(done, 2000).unref())]);
  process.exit(0);
}
// D230: the hidden `remind-hook`, which the SessionStart entry of `sonah remind on` runs each time Claude Code starts or
// resumes (remind-hook.js). Claude Code's settings call it by name, so it stays for good. It must never fail or slow
// that start, and Claude Code shows what a hook writes: it has its own crash handler (any crash ends it with exit 0
// and no word, never the exit 3 above), it ends after 5 seconds whatever is slow, it runs before --help and the update
// check, and it writes nothing but its one JSON line on standard output.
if (cmd === 'remind-hook') {
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  process.exitCode = 0;
  setTimeout(() => process.exit(0), 5000).unref();
  try {
    const { runRemindHook } = await import('../src/remind-hook.js');
    await runRemindHook(argv.slice(1));
  } catch { /* a start of Claude Code is never failed */ }
  process.exit(0);
}
// D230: the hidden `remind-refresh <folder>`, which `remind-hook` starts detached, in a process group of its own, when
// the cache of a repository of the folder is a minute old: one GET /api/fixes a repository (remind-hook.js). Files on
// disk start it by name through the reminder, so it stays for good. It has its own crash handler (exit 0, no word:
// nobody reads it), runs before --help and the update check, prints nothing, reads no standard input (what comes
// there is drained), and ends after 30 seconds whatever is slow.
if (cmd === 'remind-refresh') {
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  process.exitCode = 0;
  setTimeout(() => process.exit(0), 30_000).unref();
  // As push-run's: what comes on stdin is read and dropped, and its end awaited (2 s at most) before the exit.
  let drained = Promise.resolve();
  try {
    if (!process.stdin.isTTY) drained = new Promise((done) => {
      process.stdin.on('data', () => {}).once('end', done).once('close', done).once('error', done).resume();
    });
  } catch { /* nothing to drain */ }
  try {
    const { runRemindRefresh } = await import('../src/remind-hook.js');
    await runRemindRefresh(argv.slice(1));
  } catch { /* nobody reads it */ }
  await Promise.race([drained, new Promise((done) => setTimeout(done, 2000).unref())]);
  process.exit(0);
}
if (cmd === '--version' || cmd === '-v') {
  console.log(await versionText());
  process.exit(0);
}
// --help is answered before any command runs. Until this line existed, `init --help` installed
// hooks and `doctor --help` called a model. `sonah help` asks the same question. `review` and (D216) `visual` answer
// it themselves, with their own options, before they read anything.
if (cmd === 'help' || (cmd !== 'review' && cmd !== 'visual' && (argv.includes('--help') || argv.includes('-h')))) {
  console.log(`${ABOUT}\n\n${usage()}`);
  process.exit(0);
}

// D171 (the owner, 2026-10-28): the update notice (update-check.js). Made here, the one place with the real clock and
// the real request, and handed to `review` and `doctor` as an input (`updateNotice`), which start it (option A, the
// owner, 2026-10-29): the review with its first call to the reviewer, doctor once its options are read, so neither
// waits for it. Only when the command started it is the line written on stderr after the command's own output
// (doctor's is a line of its own output), and only then does the entry wait for it. No other command checks
// (update-check.js UPDATE_NOTICE_COMMANDS).
const updates = await import('../src/update-check.js');
const updateNotice = updates.updateNoticeApplies(argv)
  ? updates.updateCheckWhenAsked({ installed: await plainVersion().catch(() => null), env: process.env }) : null;
const withNotice = updateNotice ? { updateNotice } : {};

if (cmd === 'review') {
  // D82 step 10: one review route, the session's. The combined code review (`--base`, `--head`, and `--github`/`--pr`
  // as a code target) is removed; `--github OWNER/REPO --pr N --post-comment` names only the PR a count-only comment
  // goes to.
  const { runSessionReviewCommand } = await import('../src/session-review-command.js');
  // D219: a review that writes its HTML page also draws the graphs page of the session's commits (review-graphs.js),
  // with `sonah visual`'s job; only the entry hands the review that drawer, as it hands it the update notice.
  const { drawVisualPage } = await import('../src/visual-command.js');
  process.exitCode = await runSessionReviewCommand(argv.slice(1), { ...withNotice, drawGraphs: drawVisualPage });
} else if (cmd === 'sessions') {
  const { runSessionsCommand } = await import('../src/session-discovery.js');
  process.exitCode = await runSessionsCommand(argv.slice(1));
} else if (cmd === 'decision') {
  // D69 f (g): your answer to one decision of a session review, recorded on this computer (decision-command.js).
  const { runDecisionCommand } = await import('../src/decision-command.js');
  process.exitCode = await runDecisionCommand(argv.slice(1));
} else if (cmd === 'slice') {
  const file = argv[1];
  if (!file) { console.error('usage: sonah slice <session.jsonl>'); process.exit(2); }
  const { analyze } = await import('../index.js');
  const { ledger, tokens, hash } = await analyze([file]);
  process.stdout.write(JSON.stringify({ ...ledger, _tokens: tokens, _hash: hash }, null, 2) + '\n');
  process.exitCode = 0;   // the module-level fail-safe is 3; a completed slice is not a failure
} else if (cmd === 'config') {
  // Owner decision 2026-10-14: Sonah's own settings (settings.js), for now the code step's switch.
  const { runConfigCommand } = await import('../src/settings.js');
  process.exitCode = await runConfigCommand(argv.slice(1));
} else if (cmd === 'hook') {
  // D143: the commit-to-session link, opt-in per repository. A new name: `trailer` stays silent for old hooks.
  const { runHookCommand } = await import('../src/agent-session-hook.js');
  process.exitCode = await runHookCommand(argv.slice(1));
} else if (cmd === 'skill') {
  // D142: the /sonah skill, added to or removed from the coding agents (skill.js).
  const { runSkillCommand } = await import('../src/skill.js');
  process.exitCode = await runSkillCommand(argv.slice(1));
} else if (cmd === 'doctor') {
  const { runDoctorCommand } = await import('../src/doctor.js');
  // D171: doctor says the notice as one of its own lines (doctor.js), so it gets no stderr line.
  process.exitCode = await runDoctorCommand(argv.slice(1), withNotice);
} else if (cmd === 'visual') {
  // D216: one page of a branch's change, with graphs (visual-command.js); never checks for updates.
  const { runVisualCommand } = await import('../src/visual-command.js');
  process.exitCode = await runVisualCommand(argv.slice(1));
} else if (cmd === 'connect' || cmd === 'disconnect' || cmd === 'status') {
  // D224: this computer's connection to a Sonah Team server (connect-command.js); never checks for updates.
  const team = await import('../src/connect-command.js');
  const run = { connect: team.runConnectCommand, disconnect: team.runDisconnectCommand,
    status: team.runStatusCommand }[cmd];
  process.exitCode = await run(argv.slice(1));
} else if (cmd === 'share') {
  // D228: a page Sonah already drew here put on the connected Sonah Team server (share-command.js); it reaches that
  // server and no other, and never checks for updates.
  const { runShareCommand } = await import('../src/share-command.js');
  process.exitCode = await runShareCommand(argv.slice(1));
} else if (cmd === 'fixes') {
  // D229: the comments of your teammates that wait for you, from the connected server (fix-command.js); never checks
  // for updates.
  const { runFixesCommand } = await import('../src/fix-command.js');
  process.exitCode = await runFixesCommand(argv.slice(1));
} else if (cmd === 'fix') {
  // D229: Claude Code started on one comment, in this terminal (fix-command.js). It shows the prompt and asks first,
  // and it never checks for updates: its output is the prompt that you read before you answer.
  const { runFixCommand } = await import('../src/fix-command.js');
  process.exitCode = await runFixCommand(argv.slice(1));
} else if (cmd === 'remind') {
  // D230: the Claude Code start reminder, one SessionStart entry in Claude Code's settings (remind.js); never checks
  // for updates.
  const { runRemindCommand } = await import('../src/remind.js');
  process.exitCode = await runRemindCommand(argv.slice(1));
} else if (cmd === 'feedback') {
  const { feedbackBundle } = await import('../src/feedback.js');
  const r = await feedbackBundle({ version: await versionText() });
  console.log(`  wrote ${r.file}
  setup facts and counts only · no session text or freeform reasons · inspect before sharing`);
  process.exitCode = 0;
} else if (cmd === undefined) {
  // D218: bare `sonah` (bare-command.js): the graphs page in a terminal, else the usage table and exit 2. It never
  // checks for updates.
  const { runBareCommand } = await import('../src/bare-command.js');
  process.exitCode = await runBareCommand({ usage: usage() });
} else {
  console.error(usage());
  process.exit(cmd === '--help' || cmd === '-h' ? 0 : 2);
}
if (updateNotice?.asked()) {
  // Doctor said it in its own lines; the check has ended either way below.
  if (cmd !== 'doctor') await updates.writeUpdateNotice(updateNotice, process.stderr);
  else await updateNotice();
  // D171 fix round: a host lookup of the check that has still not answered (a resolver that hangs; an abort cannot
  // stop it) would keep the process alive past the 2-second limit, so the entry ends the process itself.
  if (updates.lookupPending()) await updates.endOnceWritten();
}
}

/** What Sonah is, printed above the command table for --help. D218: and what plain `sonah` does in a terminal (never
 *  as a table row: the help test reads each `  sonah <word>` row as a command). */
const ABOUT = 'Sonah reviews what your coding agent did, not just the diff: did it do what you\n'
  + 'asked, what it decided on its own, and what is wrong in the code. It never says\n'
  + 'the work is right.\n'
  + '\n'
  + 'In a terminal, plain sonah, with no command, draws this branch\'s change as a\n'
  + 'page of graphs, as sonah visual does, and opens the page in your browser.';

/** The one command table, within 80 columns. Printed for --help, for an unknown command, and read by the help test.
 *  Each command's words start in one column; a command too long for it (or given as several lines, the later ones
 *  indented) has them on the next line. */
function usage() {
  const row = (command, words) => {
    const [first, ...more] = [].concat(command);
    if (!more.length && first.length <= 28) return `  ${first.padEnd(28)} ${words}`;
    return [`  ${first}`, ...more.map((line) => `      ${line}`), `${' '.repeat(31)}${words}`].join('\n');
  };
  return ['usage:',
    // D172: inside Claude Code, a review given no path takes the session it runs in (sessionReviewUsage says it).
    row('sonah review [--repo DIR] [--choose N]', 'review this Claude Code session, else the latest'),
    row('sonah review <session.jsonl>', 'review one recorded session'),
    row('sonah review --session ID [--background]', 'review the session with this id'),
    row('sonah review ... --dry-run', 'show what would be reviewed; no model call'),
    row('sonah sessions [--repo DIR]', 'list recorded parent sessions, newest first'),
    row('sonah sessions --commits A..B', 'list the sessions that the commits name'),
    row('sonah sessions --github OWNER/REPO --pr N', 'the same for a pull request\'s commits'),
    row('sonah review --commits A..B [--choose N]', 'review the session that the commits name'),
    row('sonah decision accept|change|clarify HASH ID --report FILE --reason TEXT',
      'record your answer to one row of a session page'),
    row(['sonah doctor [--no-probe] [--timeout MS]', '[--backend claude-cli|codex-cli] [--model ID] [--effort LEVEL]'],
      'Node, sign-in, one model check, session locations'),
    row('sonah hook add [--repo DIR]', 'Claude Code\'s commits get an Agent-Session line'),
    row('sonah hook remove [--repo DIR]', 'remove that hook (lines in history stay)'),
    // D225: the push hook of one repository.
    row('sonah hook add --push [--repo DIR]', 'review each push in the background, on Sonah Team'),
    row('sonah hook remove --push [--repo DIR]', 'remove the push hook'),
    row('sonah skill add', 'add /sonah to Claude Code, to review a session'),
    row('sonah skill remove', 'remove the skill that sonah skill add wrote'),
    row('sonah config', 'show your settings'),
    row('sonah config code-pass off', 'turn the code step off (on turns it on)'),
    row('sonah config update-check off', 'turn the update check off (on turns it on)'),
    row('sonah visual [BASE..HEAD]', 'draw a page of a branch\'s change, with graphs'),
    // D224: the connection to a Sonah Team server.
    row('sonah connect <code> [--server URL] [--hook|--no-hook]', 'connect this computer to Sonah Team with a code'),
    row('sonah connect --token [--server URL] [--hook|--no-hook]', 'the same, with a token on standard input'),
    row('sonah disconnect', 'revoke the token and delete the connection'),
    // D227: and the reviews of pushes, with --json and --all.
    row('sonah status [--json] [--all]', 'the connection, push hooks and reviews of pushes'),
    // D228: a page drawn here put on Sonah Team, with no push.
    row('sonah share [--dir DIR] [--branch NAME] [--repo DIR]', 'put a page Sonah drew here on Sonah Team'),
    // D229: the comments that wait for you, and Claude Code started on one.
    row('sonah fixes [--repo DIR] [--json]', 'the comments of your team that wait for you'),
    row(['sonah fix <comment id> [--repo DIR]', '[--config-dir DIR] [--new]'],
      'start Claude Code on one comment here'),
    // D230: the Claude Code start reminder.
    row('sonah remind on|off', 'Claude Code shows those comments when it starts'),
    row('sonah feedback', 'setup facts and recording counts; no session text'),
    row('sonah slice <session.jsonl>', 'print the parsed recording as JSON, for debugging'),
    '',
    '  sonah review ... --format html --output ~/review.html writes and opens the',
    '  local checklist page; add --no-open for automation. A count-only PR comment',
    '  is off by default: add --github OWNER/REPO --pr N --post-comment, and it is',
    '  shown after the page is written and posted only once you confirm it here.',
    '  A review runs to the end and says up front how long it should take; Ctrl-C',
    '  stops it (answers are kept). Optional stops, off by default: --max-calls N',
    '  --max-input-bytes N --stop-at-utilization U.',
    '  The code step: a review agent also reads your repository with read-only',
    '  tools and reviews the session\'s change (claude-cli only). It is on unless',
    '  you run sonah config code-pass off, or add --no-code-pass to one review.',
    '  Once a day at most, with a review\'s first call to the reviewer and in',
    '  sonah doctor, Sonah asks npm\'s registry for its latest version and says',
    '  when a newer one is out. It never installs anything. sonah config',
    '  update-check off, or SONAH_NO_UPDATE_CHECK=1, turns it off.',
    '  sonah review --help and sonah visual --help list their options.'].join('\n');
}

main().catch(fail);

