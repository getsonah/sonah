// What the slicer keeps from a command's text: never its status.
//
// H1: a command's status comes from the recording's STRUCTURE only — the harness's
// typed exit code, its error flag, its typed completion verdict (events.js `attachResult`, `exitStatusCovers`). This
// file used to read a status out of output text: runner tallies (`N failed`), failure bodies (`AssertionError`,
// `Traceback`, `error: `), pass words (`N passed`, `Compiled successfully`, `No problems`, a bare `ok`/`Done`). Those
// English runner words also appear in grep and cat output, logs, fixtures and source; failure outranked pass, so one
// quoted line overrode a runner's own zero tally, and the label then drove rejections, triples and contradictions as
// if it were recorded fact: the text decided Bash results without an error flag as failed, `error: ` alone among
// them. All of it is deleted. Whether an output shows a failing
// suite is the reviewer's judgement: it quotes the tally line verbatim, and the challenge checks the quote.

const HEAD = 3000;
const TAIL = 3000;

/** Keep both ends: the first error line lives near the head, the summary near the tail. */
export function segment(text) {
  if (!text) return '';
  if (text.length <= HEAD + TAIL) return text;
  return `${text.slice(0, HEAD)}\n…\n${text.slice(-TAIL)}`;
}

/** H1: the sources a ledger command's status may be concluded from — the harness's own record (`native`) or the
 *  capture-time PostToolUse hook (`hook`). Never `parsed-output` (an older slicer's reading of the output text) and
 *  never a status with no recorded source. */
export const NATIVE_STATUS_SOURCES = Object.freeze(['native', 'hook']);

/**
 * H1: a ledger command's status as a consumer may conclude from it: its `outcome` when that is `passed` or `failed`
 * from a native or hook source, else `unknown` (an `unproven` zero status, an `errored` or `passed`/`failed` label an
 * older ledger parsed from text, or a status recorded with no source). Every consumer that rejects, pairs or counts on
 * a command's pass or failure reads it through this, so a parsed-output outcome can only ever lead to `unknown`.
 */
export function recordedOutcome(ev) {
  return (ev?.outcome === 'passed' || ev?.outcome === 'failed') && NATIVE_STATUS_SOURCES.includes(ev.outcomeSource)
    ? ev.outcome : 'unknown';
}

/**
 * Claude Code's file tools report success as a SENTENCE, not as a field: a Write returns
 * "File created successfully at: <path>", an overwrite or Edit "The file <path> has been
 * updated.", a MultiEdit "Applied N edits to <path>:". `toolUseResult.type` is the structured
 * form of the same fact, but it is absent from plenty of recordings — for those the sentence is
 * the only positive signal a write ever carries, and reading it is the difference between
 * "succeeded" and "nobody recorded anything".
 *
 * It is still text, so a caller must label it `parsed-output`, never `native`, and read it only for a
 * write-shaped call: a command whose stdout happens to quote one of these sentences — `cat` of a
 * transcript, an echoed fixture — has not thereby passed, nor has a read of such a file.
 */
const WRITE_OK = [
  /^File created successfully\b/im,
  /^The file .+ has been (?:updated|created)\b/im,
  /^Applied \d+ edits? to /im,
];

export function isWriteSuccessLine(text) {
  const t = segment(String(text ?? ''));
  return !!t.trim() && WRITE_OK.some((re) => re.test(t));
}

// H5: `isOutcomeRelevant` and its INCIDENTAL program list are deleted. Their one reader
// was the carry, which dropped a command's result when every program in it was on the list (`cp`, `curl`, `diff`,
// `tee`, …): a program's name never decides whether its result is evidence.

/**
 * Does this command invoke a test runner? Matches argv, never prose.
 *
 * M1: this runner table no longer labels any ledger event (the slicer writes every
 * shell command as `bash`), no longer changes how a status is read (one rule for every command: events.js
 * `attachResult`), and no story or page reads it. Its one product reader was the legacy gate's pairing of a fix loop
 * (through `coverageIdentity` below), which went with the gate (B5.2 step 7); it stays because tools outside this
 * repository import it. It
 * is a known name list (a spelling it misses is a test command missed, never a status).
 */
const RUNNERS = [
  'pytest', 'py.test', 'jest', 'vitest', 'mocha', 'ava', 'tap', 'rspec', 'phpunit', 'tox', 'nox',
  'ctest', 'unittest', 'nose2',
];
// Null-prototype on purpose: argv[0] is attacker-shaped input. As a plain object literal,
// `RUNNER_SUBCMD['constructor']` answered with Object itself and `subs.includes(...)` threw,
// so a command called `constructor test` crashed the whole slice (L127). The table must answer
// for its own keys and nothing else.
const RUNNER_SUBCMD = Object.assign(Object.create(null), {
  npm: ['test', 't'], pnpm: ['test'], yarn: ['test'], bun: ['test'],
  cargo: ['test', 'nextest'], go: ['test'], mvn: ['test', 'verify'],
  gradle: ['test'], './gradlew': ['test'], dotnet: ['test'], swift: ['test'],
  deno: ['test'], rake: ['test', 'spec'], make: ['test', 'check'],
});

/** Repos routinely wrap the suite in a script: ./run_tests.sh, bin/test, scripts/check.sh. */
const SCRIPT_RUNNER = /^(run[_-]?)?(tests?|specs?|check)(\.(sh|bash|zsh|py|rb|js))?$/i;

export function isTestCommand(cmd) {
  if (!cmd) return false;
  for (const part of splitChain(cmd)) {
    const argv = tokenize(part);
    if (!argv.length) continue;
    const a0 = base(argv[0]);
    if (RUNNERS.includes(a0)) return true;
    if ((argv[0].startsWith('./') || argv[0].includes('/')) && SCRIPT_RUNNER.test(a0)) return true;
    if (a0 === 'node' && argv.includes('--test')) return true;
    if ((a0 === 'python' || a0 === 'python3') && argv[1] === '-m' && RUNNERS.includes(argv[2])) return true;
    const subs = RUNNER_SUBCMD[a0];
    if (subs && argv.slice(1).some((x) => subs.includes(x))) return true;
    // wrappers: uv run pytest, poetry run pytest, npx jest
    if (['uv', 'poetry', 'pipenv', 'npx', 'pnpm', 'bunx', 'hatch', 'rye'].includes(a0)) {
      const rest = argv.slice(1).filter((x) => x !== 'run' && x !== 'exec' && !x.startsWith('-'));
      if (rest.length && RUNNERS.includes(base(rest[0]))) return true;
    }
  }
  return false;
}

/** Verbosity and traceback flags: they change no runner's target set (`coverageIdentity`). */
const VOLATILE_FLAG = /^(-x|-v+|-q+|--tb=\S*|--maxfail=\S*|--color=\S*|-s|--no-header|--durations=\S*)$/;

function splitChain(cmd) {
  return String(cmd).split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean);
}

/** Quote-aware tokenizer. Must survive paths containing spaces. */
function tokenize(s) {
  const out = [];
  let cur = '';
  let q = null;
  for (const ch of String(s)) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function base(p) {
  const s = String(p);
  const i = s.lastIndexOf('/');
  return i === -1 ? s : s.slice(i + 1);
}

/**
 * A command's "coverage identity": the runner and the set of targets it exercises.
 *
 * Exact-string matching is wrong for triples: a failing observation is seldom followed by a
 * byte-identical command. The agent loop is
 * `pytest tests/t.py::test_one` -> FAIL -> edit -> `pytest tests/t.py` -> PASS. Same runner,
 * overlapping target, different string. The question "is the thing that was failing now passing"
 * does not require an identical invocation, only a covering one.
 */
export function coverageIdentity(cmd) {
  if (!cmd) return null;
  for (const part of splitChain(cmd)) {
    const argv = tokenize(part).filter((t) => !VOLATILE_FLAG.test(t));
    if (!argv.length) continue;
    let i = 0;
    // step past wrappers: uv run pytest, poetry run pytest, npx jest, python -m pytest
    while (i < argv.length && WRAPPER.has(base(argv[i]))) {
      i++;
      while (i < argv.length && (argv[i] === 'run' || argv[i] === 'exec' || argv[i] === '-m')) i++;
    }
    if (i >= argv.length) continue;
    const runner = base(argv[i]);
    if (!isTestCommand(part) && !BUILDLIKE.has(runner)) continue;
    // A wrapper script has no meaningful targets; it always runs the whole suite.
    const targets = argv
      .slice(i + 1)
      .filter((t) => !t.startsWith('-'))
      .map((t) => t.split('::')[0].replace(/^\.\//, ''))
      .filter((t) => t && !RUNNER_SUBCMD[runner]?.includes(t));
    return { runner, targets };
  }
  return null;
}

const WRAPPER = new Set(['uv', 'poetry', 'pipenv', 'npx', 'pnpm', 'bunx', 'hatch', 'rye', 'python', 'python3', 'node', 'npm', 'yarn', 'bun']);
const BUILDLIKE = new Set(['tsc', 'mypy', 'pyright', 'eslint', 'ruff', 'clippy', 'cargo', 'go', 'make', 'gradle', 'mvn']);

/**
 * Does observation B cover what observation A was exercising?
 * Same runner, and B's target set is empty (whole suite) or overlaps A's by prefix either way.
 */
export function covers(a, b) {
  if (!a || !b || a.runner !== b.runner) return false;
  if (!a.targets.length || !b.targets.length) return true; // a bare run covers everything
  return a.targets.some((x) => b.targets.some((y) => x === y || x.startsWith(y) || y.startsWith(x)));
}
