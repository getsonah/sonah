#!/usr/bin/env node
// Top-level failure contract (D71 (a), owner decision 2026-10-08: an exit code never judges the agent's work):
//   exit 0  the command ran to completion
//   exit 1  `review`: Sonah's own review ran but did not complete; `doctor`: the install needs a human
//   exit 2  usage error
//   exit 3  the tool itself failed
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
// Owner decision 2026-10-06 (legacy gate retired): bare `sonah` runs nothing. It used to open the
// docket on a terminal and run `scan` in a pipe; both were the legacy verdict surface, so it now prints the usage
// table and exits 2, like any other usage error.
const cmd = argv[0];

async function versionText() {
  const version = typeof SONAH_VERSION === 'string' ? SONAH_VERSION
    : JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version;
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
if (cmd === '--version' || cmd === '-v') {
  console.log(await versionText());
  process.exit(0);
}
// --help is answered before any command runs. Until this line existed, `init --help` installed
// hooks and `doctor --help` called a model. `sonah help` asks the same question.
if (cmd === 'help' || (cmd !== 'review' && (argv.includes('--help') || argv.includes('-h')))) {
  console.log(`${ABOUT}\n\n${usage()}`);
  process.exit(0);
}

if (cmd === 'review') {
  // D82 step 10: one review route, the session's. The combined code review (`--base`, `--head`, and `--github`/`--pr`
  // as a code target) is removed; `--github OWNER/REPO --pr N --post-comment` names only the PR a count-only comment
  // goes to.
  const { runSessionReviewCommand } = await import('../src/session-review-command.js');
  process.exitCode = await runSessionReviewCommand(argv.slice(1));
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
} else if (cmd === 'doctor') {
  const { runDoctorCommand } = await import('../src/doctor.js');
  process.exitCode = await runDoctorCommand(argv.slice(1));
} else if (cmd === 'feedback') {
  const { feedbackBundle } = await import('../src/feedback.js');
  const r = await feedbackBundle({ version: await versionText() });
  console.log(`  wrote ${r.file}
  setup facts and counts only · no session text or freeform reasons · inspect before sharing`);
  process.exit(0);
} else {
  console.error(usage());
  process.exit(cmd === '--help' || cmd === '-h' ? 0 : 2);
}
}

/** What Sonah is, printed above the command table for --help. */
const ABOUT = 'Sonah reviews a recorded AI coding session and writes a checklist of what to\n'
  + 'check. It never says the work is right.';

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
    row('sonah review [--repo DIR] [--choose N]', 'review the latest session in this repository'),
    row('sonah review <session.jsonl>', 'review one recorded session'),
    row('sonah review ... --dry-run', 'show what would be reviewed; no model call'),
    row('sonah sessions [--repo DIR]', 'list recorded parent sessions, newest first'),
    row('sonah decision accept|change|clarify HASH ID --report FILE --reason TEXT',
      'record your answer to one row of a session page'),
    row(['sonah doctor [--no-probe] [--timeout MS]', '[--backend claude-cli|codex-cli] [--model ID]'],
      'Node, sign-in, one model check, session locations'),
    row('sonah config', 'show your settings'),
    row('sonah config code-pass off', 'turn the code step off (on turns it on)'),
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
    '  sonah review --help lists the review options.'].join('\n');
}

main().catch(fail);

