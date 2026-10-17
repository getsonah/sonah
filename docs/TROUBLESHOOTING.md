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

**`Claude code-step options: this Claude Code refused at least one of --restricted, --max-turns, --json-schema ...`**
: The code step's agents run Claude Code with three options an older Claude Code does not have: `--restricted` (confines
  them to your repository), `--max-turns` (their turn budget) and `--json-schema` (their structured answer). Doctor
  checks them once, with no model call. Run `claude update`, then `sonah doctor` again; or turn the code step off with
  `sonah config code-pass off` (or `--no-code-pass` for one review). `Claude code-step options: not checked` means
  `claude auth status` could not be read: fix the sign-in first.

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

**`The system refused Sonah access to <folder>, the folder that Sonah runs in.`** (exit 2)
: The system did not let Sonah read the folder that you ran it in. On macOS, a terminal without access cannot read
  `~/Documents`, `~/Desktop`, `~/Downloads` and some other folders. Sonah stopped before it read or sent anything. If
  your project is in such a folder, give your terminal access to it in System Settings, Privacy & Security, Files and
  Folders (or Full Disk Access), then quit and open the terminal again. Otherwise run `sonah` from a folder that this
  terminal can read. The line names the folder only when Sonah can tell that your shell's `PWD` is that folder.

## Finding the session

**`Sonah found no Claude Code or Codex session for this repository.`**
: Sonah looks for sessions whose recorded working folder is this repository (its Git root). Run Claude Code or Codex
  here first, or name the recording: `sonah review /absolute/path/to/session.jsonl`. If your recordings are somewhere
  else, set `SONAH_CLAUDE_PROJECTS` (a copy of `~/.claude/projects`) or `CODEX_HOME`. `sonah sessions` shows what it
  finds.

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
part of the session, reviewed in its own requests. The report does not show windows.
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

**`Review could not complete: state_dir_holds_root.`** (exit 2)
: With the code step on, the `--state-dir` you gave is the folder the session worked in, or a folder that holds it.
  The code step reviews every file there that changed since the session began, so what Sonah writes in its state folder
  would read as part of the next review's change, and a folder of your project named like one Sonah writes there could
  be taken for Sonah's. Nothing was read or sent. Choose a `--state-dir` outside that folder (or leave it out: the
  default is under `~/.sonah`), or add `--no-code-pass`.

**`Code review: did not run. It runs only on the claude-cli backend ...`**
: Before the first call, the line about the code step already says it: `Code review: on (...), but it did not run`. The code
  step's agents read your repository with Claude Code's read-only tools, which only the `claude-cli` backend gives them,
  so with `--backend codex-cli` or `anthropic-api` the code step does not run, nothing of the repository is read, and
  the page, the Markdown and the terminal say so (the report records it as `code_step_backend`). With `--code-pass` on
  the command line the review then reads as not complete (exit 1): review with the default backend, or add
  `--no-code-pass` to review the session alone.

**`Code review: did not run. The recording names no working directory that exists here ...`**
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

**`Sonah's review: incomplete (session review did not finish).`** (exit 1)
: Sonah's own review did not finish every part. The report and the output say which parts and why.
  This says nothing about the agent's work. Common causes and what to do:

  | What the output says | What to do |
  | --- | --- |
  | `narrative:model_unavailable` (the page: "the model could not be reached") | A call failed: no login, a usage limit, a timeout or the network. Run `sonah doctor` to see which, then the same command again. |
  | `narrative:no_json`, `narrative:schema`, `narrative:response_incomplete`, `challenge:votes_invalid`, `challenge:items_unresolved` | The model's answer could not be used. Run the same command again: only those parts are asked again. |
  | `narrative:budget` ("the request did not fit the review input budget") | That part is too large for one request. Rerunning will not help; `sonah review --dry-run` counts such parts before anything is spent. |
  | "no review windows were produced" or "no actions were recorded" | The file is not a recording Sonah can read, or the session did nothing. Check the path; `--dry-run` shows what was read. |

  Note: a review that did not complete still writes its page, so use a new `--output` name when you run it again.
  Stored answers make the rerun quick and cheap.

**`Sonah's review: ... code review did not cover all of the change and its checks ...`**
: The code step ran but did not finish all of its work (or, with `code review did not finish`, its review agent gave no
  answer it could use). Under "What Sonah could not check", the page and the .md say what and why. On by
  default or by your setting, this does not change the exit code (the line says so); with `--code-pass` on the command
  line the review reads as not complete (exit 1). By what the page says:

  | What the page says | What to do |
  | --- | --- |
  | calls that did not answer (the code review, the repair of the code review, a finding's check, or the check of its questions) | An agent ran out of its turns (the review agent has 150, a finding's check 60, the other check 80) or its time (45 minutes for the review agent, 30 for a check), its answer never matched its contract, or the call failed (sign-in, usage limit, network). Run the same command again: while the repository is unchanged, the answers that came back are reused and only these are asked again. |
  | The repository changed while the code review ran | A file of the repository changed between the start of the review and the end of the code step, so a file it quotes may differ now. Leave the repository alone while a review runs, then run the same command again. |
  | files whose change the code review did not see (binary, too large for one call, changed after the session's last recorded edit, not readable) | A limit of the change itself, not a failure: running again will not change it. |
  | files whose change was too large for the code review to read | The change is larger than one request holds (about 400 KB of lines): the agent was told to read those files itself. |
  | files changed after the session's last recorded edit | Not a gap: a file the session wrote changed again afterwards (a formatter, a script, your own edit). Its change from where the session started was shown and reviewed, but some of its lines now may not be the agent's. |

**`Review could not complete: output_exists.`**
: Sonah never overwrites a file. Choose a new `--output` name. With `--format html`, Sonah also writes the .md beside
  the page (`review.html` gives `review.md`), so neither file can exist. Sonah checks both files before its first
  model call.

**`Sonah wrote the report for your pull request: review.md (5,812 bytes).`**
: The .md is the report in Markdown. The next line is the command that posts it:
  `gh pr comment --body-file review.md`. With no pull request number, `gh` posts on the pull request of your current
  branch. To post on another pull request, put its number after `comment`. Sonah posts nothing itself. Read the report
  before you post it, because it quotes your session as the recording holds it.

**`The report is more than 60,000 bytes, the limit that Sonah sets for a GitHub comment.`**
: Sonah never shortens the header, the count line or the table of your prompt. It keeps the open lines of the Must act
  and Must know items whole too. Here these parts alone are longer than the limit, so Sonah prints no `gh` command. Open
  the page, or post a part of the .md yourself.

**`Commit 1a2b3c4 is not on origin yet.`**
: GitHub does not have this commit, so the report has no links to the code that needs it. The header says so when the
  report names a place in that code. The line names those links. When it is your last commit, they are the links to the code as the agent left it. When it is
  the commit that the session started from, they are the links to the code as it was before the session. When one
  commit is both, the report has no code links. Pushing does not add links to a report that Sonah already wrote. To get
  a report with code links, push the commit, then run the same command with a new `--output` file (the next line says
  so too).

**`To get code links, commit your work.`**
: Some reviewed files differ from your last commit, or a commit is not on GitHub. So the report has no code links for
  them. Commit your work. Push the commit. Then run the same command with a new `--output` file. Sonah reuses its
  stored answers, so this run makes no model call.

**`Sonah wrote the report inside the repository.`**
: On the next run, a report file in the repository is part of the change, so the code review asks again. Move the
  report files out of the repository, or add them to `.gitignore`, before you run Sonah again.

**`Review could not complete: output_folder_missing.`** or **`output_folder_unwritable.`**
: The folder of the `--output` file does not exist, or you cannot write to it. Sonah creates no folders: create it
  first, or choose a file in a folder you own, such as `~/review.html`.

**`Sonah saved the page, but could not open it.`**
: Open the printed path in your browser. Use `--no-open` on a machine with no browser.

**The output names "adapter gaps", "Not covered: ...", "Known gaps" (`--dry-run`) or "no checked recording" for a helper**
: These are limits of the recording, not failures of the review: a helper agent's recording was not found beside its
  parent, a command recorded no exit status, and so on. They do not make the review incomplete. Keep helper recordings
  where your agent wrote them (Claude Code: `<session>/subagents/` beside the session file).

**`Review could not complete: review_failed.`** (exit 3)
: Something Sonah did not expect, for example a `--repo` folder that does not exist or a `~/.sonah` folder you do not
  own. Check those, run `sonah review --dry-run`, then try again.

**`sonah: <message>`** (exit 3)
: Sonah crashed. Run the command again with `SONAH_DEBUG=1` set to print a stack trace, and report it in a
  [GitHub issue](https://github.com/getsonah/sonah/issues). Read the trace first: it can contain local paths, which you can replace.

**`Review could not complete: checkpoint_failed.`**
: Sonah could not save progress. Check that `~/.sonah` (or `SONAH_HOME`) is writable and has space, then run the same
  command again to continue.

## Answering a row with `sonah decision`

The page prints the command once, in the folded "Record your answer" part at its foot, with the session's hash filled
in: `sonah decision accept|change|clarify <session hash> ROW_ID --report REPORT --reason "YOUR REASON"`. In each item's
evidence fold it prints only the item's id (`Item id`). Pick `accept`, `change` or `clarify`, put the item's id for
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
- `reason_rejected`: the reason is longer than 2,000 characters. An empty reason is a usage error.
- `decision_ambiguous`: the short id matches more than one row; give more of its digits.
- `not_recorded`: the answer could not be written; check that `~/.sonah` is yours and writable.

Your answer is stored only on this computer and shows on the page the next time you write it.

## Exit codes

This is the one list of Sonah's exit codes. The exit code reports only whether Sonah's own review ran, never a
judgment of the agent's work: a review with findings that ran to the end exits `0`.

| Code | Meaning |
| --- | --- |
| `0` | The command did its job: Sonah's review ran to completion, whatever it lists |
| `1` | Sonah's review ran but did not complete (a part of the session was not reviewed, or, with `--code-pass` on the command line, the code step did not cover the whole change and finish its checks; the output says which and why); or no session was found for this repository; or `sonah doctor` found something to fix; or `sonah decision` refused an answer (the reason is printed). A code step that ran by default or by your setting never sets it by itself. |
| `2` | Invalid arguments, or a problem Sonah names with its fix (a missing recording, an existing output file, a wrong model) |
| `3` | Sonah's review failed: it could not run, it crashed, or it was stopped (Ctrl-C while it was asking the model, or one of your optional stops); or `sonah decision` could not record an answer |
| `130` | Ctrl-C at another moment (while it reads the recording, plans or writes the page): it ends the usual way, and the same command starts again |

## Still stuck

Open a [GitHub issue](https://github.com/getsonah/sonah/issues) with the message you saw, the exit code and the output of
`sonah doctor --no-probe` (read it first: it prints the folders it searched, which include your home folder's path).
Never paste a session recording, a Sonah page or a report: they can hold secrets. A security problem goes privately,
as [SECURITY.md](../SECURITY.md) describes.
