# Troubleshooting

Start with the free check: it makes no model call and tells you what is missing.

```sh
sonah doctor --no-probe
```

Then `sonah doctor` (one tiny model request) checks that the reviewer model answers. Every problem below is listed with
the message Sonah prints, what it means and what to do. Sonah never prints your provider's own error text; it prints a
fixed code and a fix.

## Before the first review

**`Claude: missing. Fix: Install Claude Code ...`** (from `sonah doctor`)
: The `claude` command is not installed or not on your PATH. Install Claude Code, then run `sonah doctor` again.

**`Claude sign-in: signed_out. Fix: Run claude auth login ...`**
: Sign in with `claude auth login` (your Claude subscription account), then run `sonah doctor` again. `Claude sign-in:
  unknown` means Sonah could not read the sign-in state: run `claude auth status`; if that command is not supported,
  run `claude update`.

**`Model: not_answered ...`**
: The one test request did not get an answer. Run `sonah doctor` again; if it still fails, check your network and your
  plan's remaining usage. A word in brackets names the cause when it is known (`rate_limit`, `billing`, `overloaded`,
  ...); with `auth`, doctor prints the sign-in fix instead. The reviewer does not inherit proxy settings,
  `CLAUDE_CONFIG_DIR` or API keys from your shell, so `claude` can work in your terminal and still fail here.

**`Model: Sonah could not confirm the answer came from claude-sonnet-5-5 under its 1M-token window. Fix: Update Claude Code ...`**
: The answer did not come from `claude-sonnet-5-5` under its 1M-token window, or Sonah could not tell that it did. Run
  `claude update` and check that your account can use the long-context model.

**`Node: ... Fix: Install Node.js 20 or newer`** or **`Install requires Node.js 20 or newer`**
: Install a current Node.js (with npm) and run the command again.

**`Install did not complete. Check that Node.js 20+ and npm are installed ...`**
: The installer could not finish. When npm failed, the next lines give npm's exit code, the first lines of its error
  (its error code and the cause, such as `code EPERM` and the path) and the last (where npm wrote its full log). Check
  Node and npm, then try a folder you own:
  `node scripts/install.mjs --prefix /absolute/path/to/a/folder/you/own`.

**`sonah: command not found`** after installing
: Installed with `npm install -g getsonah`: npm's global `bin` folder is not on your PATH; `npm prefix -g` prints the
  folder that holds it. Installed from a checkout: the installer prints the line to add `~/.local/bin` (or your
  `--prefix`) to this terminal's PATH. Run that line, or call the absolute path it printed.

**`npm error EEXIST`** naming a `sonah` file when you install `getsonah`
: An install made before this beta went to npm, named `sonah`, owns that command. Remove it with
  `npm uninstall --global --prefix "$HOME/.local" --ignore-scripts sonah` (or with the folder it is in), then install
  again.

## Finding the session

**`No Claude Code or Codex session was found for this repository.`**
: Sonah looks for sessions whose recorded working folder is this repository (its Git root). Run a coding session here
  first, or name the recording: `sonah review /absolute/path/to/session.jsonl`. If your recordings are somewhere else,
  set `SONAH_CLAUDE_PROJECTS` (a copy of `~/.claude/projects`) or `CODEX_HOME`. `sonah sessions` shows what it finds.

**A session exists but `sonah sessions` does not list it**
: Matching uses the folder the agent recorded, not names. A session run in a Git worktree or another checkout belongs to
  that folder: run from there or pass `--repo` with that path. Helper (sub-agent) recordings are not listed on their
  own; they are reviewed with their parent. Cursor sessions are never found automatically: pass the path
  (`ls -t ~/.cursor/projects/*/agent-transcripts/*.jsonl | head -1`).

**`Review could not complete: session_not_found.`**
: The recording path does not exist or cannot be read, or `--choose N` is larger than the list. Numbers follow the
  newest-first order of `sonah sessions`, so they shift when a new session appears.

## While a review runs

The review first prints its estimate, for example *"This review should take roughly 4-12 minutes"*. A *window* is one
part of the session, reviewed in its own requests (the page calls each one a step).
It then prints `Review window N/M finished` as each part completes. There are no default limits: it runs to the end.

**You want to stop**
: Press Ctrl-C. Sonah prints `Review could not complete: review_interrupted.` and how much it used. Answers already
  received are kept and never asked again; run the same command to continue. A request still running when you
  stopped is sent again.

**`Review stopped where you asked (max_calls | max_input_bytes | utilization).`**
: One of your optional stops (`--max-calls`, `--max-input-bytes`, `--stop-at-utilization`) was reached. Run the same
  command again to continue, with a higher limit or after your usage resets. `utilization` means a call reported one
  of your plan's limits at or over your bound, whichever limit it was. The usage line shows the latest reading, which
  can be lower if a call still running finished after the stop; it names each limit (for example `five-hour 0.93,
  seven-day 0.2`), and the five-hour limit resets soonest.

**`utilization not reported`** (the usage line)
: The reviewer reported none of your plan's usage, so `--stop-at-utilization` cannot stop the review. The Codex CLI
  and the API never report it; the `claude` CLI reports it only when signed in with a Claude subscription. It also
  shows when the run made no call because every answer was reused from an earlier run.

**`Review could not complete: config_invalid.`** (exit 2)
: Your settings file (`~/.sonah/config.json`) could not be read, so Sonah does not know whether you want the code step,
  and it stopped before reading or sending anything. Run `sonah config code-pass on` or `sonah config code-pass off` to
  write it again, or add `--code-pass` or `--no-code-pass` to the review.

**`Code pass: not run. The recording names no working directory that exists here ...`**
: The code step (on by default) reads the session's files where the recording says the session ran, and that folder is
  not on this computer (a recording copied from elsewhere, or a project moved or deleted since). The page and the
  terminal say the code review did not run; the exit code still follows the session review. With `--code-pass` on the
  command line the review then reads as not complete (exit 1): run it from the project's own computer, or add
  `--no-code-pass` to review the session alone.

**`Review could not complete: review_in_progress.`**
: Another review of the same recording is running. Wait for it. A review that crashed leaves no lasting lock.

**`Review could not complete: model_unavailable.`** (exit 3)
: An answer came from a different model or context window than the one asked for, so Sonah stopped rather than keep
  it. Run `sonah doctor`, then `claude update`, then the same command again.

**`Review could not complete: invalid_model.`**
: For Claude, leave `--model` out (the default `claude-sonnet-5-5[1m]` is the one to use); short names such as `sonnet`
  cannot be checked. Remove `SONAH_MODEL` or `SONAH_REVIEW_BACKEND` if an older setup left them in your shell. For
  Codex, name the model: `--backend codex-cli --model gpt-6.1-sol`.

## After a review

**`Sonah's review: incomplete (session review did not complete).`** (exit 1)
: Sonah's own review did not finish every part; the page and the output say which parts (steps, on the page) and why.
  This says nothing about the agent's work. Common causes and what to do:

  | What the output says | What to do |
  | --- | --- |
  | `narrative:model_unavailable` (the page: "the model could not be reached") | A call failed: no login, a usage limit, a timeout or the network. Run `sonah doctor` to see which, then the same command again. |
  | `narrative:no_json`, `narrative:schema`, `narrative:response_incomplete`, `challenge:votes_invalid`, `challenge:items_unresolved` | The model's answer could not be used. Run the same command again: only those parts are asked again. |
  | `narrative:budget` ("the request did not fit the review input budget") | That part is too large for one request. Rerunning will not help; `sonah review --dry-run` counts such parts before anything is spent. |
  | "no review windows were produced" or "no actions were recorded" | The file is not a recording Sonah can read, or the session did nothing. Check the path; `--dry-run` shows what was read. |

  Note: a review that did not complete still writes its page, so use a new `--output` name when you run it again.
  Stored answers make the rerun quick and cheap.

**`Review could not complete: output_exists.`**
: Sonah never overwrites a file. Choose a new `--output` name.

**`Review could not complete: output_folder_missing.`** or **`output_folder_unwritable.`**
: The folder of the `--output` file does not exist, or you cannot write to it. Sonah creates no folders: create it
  first, or choose a file in a folder you own, such as `~/review.html`.

**`The page is saved, but could not be opened automatically.`**
: Open the printed path in your browser. Use `--no-open` on a machine with no browser.

**The output names "adapter gaps", "Not covered: ...", "Known gaps" (`--dry-run`) or helpers with "no verified child evidence"**
: These are limits of the recording, not failures of the review: a helper agent's recording was not found beside its
  parent, a command recorded no exit status, and so on. They do not make the review incomplete. Keep helper recordings
  where your agent wrote them (Claude Code: `<session>/subagents/` beside the session file).

**`Review could not complete: review_failed.`** (exit 3)
: Something Sonah did not expect, for example a `--repo` folder that does not exist or a `~/.sonah` folder you do not
  own. Check those, run `sonah review --dry-run`, then try again.

**`Review could not complete: output_not_masked.`** (exit 3)
: Sonah could not mask the secrets in the page or the Markdown it was about to write, so it wrote and printed nothing
  (the model read your session as recorded; what Sonah writes for you is always masked). The model's answers are
  kept: run the same command again, with a new `--output` name if you gave one. If it happens again, run
  `sonah feedback` and attach the bundle it writes to a [GitHub issue](https://github.com/getsonah/sonah/issues) (it holds setup facts and
  counts only, no session text; read it first).

**`sonah: <message>`** (exit 3)
: Sonah crashed. Run the command again with `SONAH_DEBUG=1` set to print a stack trace, and report it in a
  [GitHub issue](https://github.com/getsonah/sonah/issues). Read the trace first: it can contain local paths, which you can replace.

**`Review could not complete: checkpoint_failed.`**
: Sonah could not save progress. Check that `~/.sonah` (or `SONAH_HOME`) is writable and has space, then run the same
  command again to continue.

## Answering a row with `sonah decision`

The page prints the command once, under "Where your attention is needed", with the session's hash filled in:
`sonah decision accept|change|clarify <session hash> ROW_ID --report REPORT --reason "YOUR REASON"`. Under each row it
prints only the row's id (`Row id` or `Decision id`). Pick `accept`, `change` or `clarify`, put the row's id for
`ROW_ID` and your reason for `YOUR REASON`, and replace `REPORT` with the review's report file. Its folder is named by
the SHA-256 of the recording's path exactly as the `Recording:` line printed it (`sha256sum` instead of
`shasum -a 256` on Linux):

```sh
printf '%s' /absolute/path/to/session.jsonl | shasum -a 256
```

The report is `~/.sonah/session-reviews/<that hash>/review/report.private.json` (or `<--state-dir>/review/` if you set
one). Messages you can see:

- `report_unreadable`: the `--report` path is wrong.
- `decision_not_in_report`: the row id is not in that report (a newer review may have changed it).
- `reason_rejected`: the reason is longer than 2,000 characters, or holds something redaction would mask (a secret, an
  email address). An empty reason is a usage error.
- `decision_ambiguous`: the short id matches more than one row; give more of its digits.
- `not_recorded`: the answer could not be written; check that `~/.sonah` is yours and writable.

Your answer is stored only on this computer and shows on the page the next time you write it.

## Exit codes

This is the one list of Sonah's exit codes. The exit code reports only whether Sonah's own review ran, never a
judgment of the agent's work: a review with findings that ran to the end exits `0`.

| Code | Meaning |
| --- | --- |
| `0` | The command did its job: Sonah's review ran to completion, whatever it lists |
| `1` | Sonah's review ran but did not complete (a part of the session was not reviewed, or, with `--code-pass` on the command line, the code step did not read every file it showed; the output says which and why); or no session was found for this repository; or `sonah doctor` found something to fix; or `sonah decision` refused an answer (the reason is printed). A code step that ran by default or by your setting never sets it by itself. |
| `2` | Invalid arguments, or a problem Sonah names with its fix (a missing recording, an existing output file, a wrong model) |
| `3` | Sonah's review failed: it could not run, it crashed, or it was stopped (Ctrl-C while it was asking the model, or one of your optional stops); or `sonah decision` could not record an answer |
| `130` | Ctrl-C at another moment (while it reads the recording, plans or writes the page): it ends the usual way, and the same command starts again |

## Still stuck

Open a [GitHub issue](https://github.com/getsonah/sonah/issues) with the message you saw, the exit code and the output of
`sonah doctor --no-probe` (read it first: it prints the folders it searched, which include your home folder's path).
Never paste a session recording, a Sonah page or a report: they can hold secrets. A security problem goes privately,
as [SECURITY.md](../SECURITY.md) describes.
