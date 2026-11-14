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
  ...); with `auth`, doctor prints the sign-in fix instead. The reviewer does not inherit proxy settings or API keys
  from your shell, so `claude` can work in your terminal and still fail here. It does sign in from your
  `CLAUDE_CONFIG_DIR` and with your `CLAUDE_CODE_OAUTH_TOKEN`: the `Claude Code login:` line says which.

**`Model: Sonah could not confirm the answer came from claude-sonnet-5-5 under its 1M-token window. Fix: Update Claude Code ...`**
: The answer did not come from `claude-sonnet-5-5` under its 1M-token window, or Sonah could not tell that it did. Run
  `claude update` and check that your account can use the long-context model.

**`Claude code-step options: this Claude Code refused at least one of --restricted, --max-turns, --json-schema ...`**
: The code step's agents run Claude Code with three options an older Claude Code does not have: `--restricted` (confines
  them to the folders the code step reads: your repository, the other git repositories that hold a file of the change
  and, for a change reviewed in parts, Sonah's copy of its files at the start commit), `--max-turns` (their turn budget)
  and `--json-schema` (their structured answer). Doctor checks them once, with no model call. Run `claude update`, then
  `sonah doctor` again; or turn the code step off with `sonah config code-pass off` (or `--no-code-pass` for one
  review). `Claude code-step options: not checked` means `claude auth status` could not be read: fix the sign-in first.

**`Claude Code login: Sonah's Claude Code calls sign in from ...`** (from `sonah doctor`)
: The config folder whose login Sonah's calls and doctor's checks use: the one `CLAUDE_CONFIG_DIR` names, else
  `~/.claude`. If it is not the account you expect, run Sonah in a terminal with the same `CLAUDE_CONFIG_DIR` as your
  `claude` (an alias such as `CLAUDE_CONFIG_DIR=~/.claude-work claude` sets it for `claude` alone). With
  `CLAUDE_CODE_OAUTH_TOKEN` set (a login from `claude setup-token`, as on a remote machine), the line says the calls
  sign in with that token: Claude Code uses it in place of the folder's login. Doctor never prints the token. Answers
  that Sonah stored before, on another login or before its calls ran in safe mode, replay as they were. To ask again,
  review with a fresh `--state-dir`.

**`Sonah found a relative CLAUDE_CONFIG_DIR and gives its Claude Code calls the absolute folder that it names here ...`**
: Claude Code names its macOS keychain login after the exact text of `CLAUDE_CONFIG_DIR`. Sonah gives its calls a
  relative value as the absolute folder it names from where you run Sonah, so that login does not reach them, and
  doctor's sign-in check can say `signed_out`. Set `CLAUDE_CONFIG_DIR` as an absolute path, sign in once with that
  value (`claude auth login`), then run `sonah doctor` again. An absolute value reaches the calls as you wrote it.

**`Claude Code safe mode: this Claude Code refused --safe-mode when Sonah checked it ...`**
: Sonah's calls ask for Claude Code's safe mode, which keeps the plugins, skills and connectors that you installed out
  of them. This Claude Code refused the `--safe-mode` flag when doctor checked it, so Sonah cannot tell that the calls
  run in safe mode. The review still runs. Run `claude update`, then `sonah doctor` again. `Claude Code safe mode: not
  checked` means `claude auth status` could not be read: fix the sign-in first.

**`Sonah ... is out, and you have ...`** after a review, or **`Sonah: ..., and ... is out`** in `sonah doctor`
: npm's registry has a newer Sonah than yours. Update with `npm install -g getsonah@latest`, or as you installed it
  ([Update](INSTALL.md#update)). Sonah never installs it for you. Your version still works: doctor does not count it as
  something to fix. `sonah config update-check off` stops the check and the line.

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

**`/sonah` is not a command in Claude Code**
: Run `sonah skill add`, then start a new Claude Code session: a session reads its skills when it starts. With
  `CLAUDE_CONFIG_DIR` set, run `sonah skill add` with the same `CLAUDE_CONFIG_DIR`, so the skill goes where that Claude
  Code reads it. Settings that an administrator manages can turn off personal skills; `/status` in Claude Code shows the
  setting sources.

**`/sonah` prints `Shell command failed for pattern ...`**
: Claude Code could not run `sonah`: the agent never saw the skill. Most often `sonah` is not on the PATH that Claude
  Code uses. Type `!command -v sonah` in Claude Code: it prints the path of `sonah`, or nothing when Claude Code cannot
  find it. (`sonah doctor` checks the PATH of the terminal you run it in, which can differ, for example when Claude Code
  was started from an editor.) Install Sonah with `npm install -g getsonah`, or add the folder of the `sonah` command to
  the PATH that Claude Code starts with, then start a new session.

**`~/.claude/skills/sonah/SKILL.md is not as Sonah wrote it, so Sonah changed nothing there for Claude Code.`**
: A skill of your own is named `sonah`, the folder holds a file Sonah did not write, or someone edited Sonah's file.
  `sonah skill add` and `sonah skill remove` never change such a file. Move it away, then run `sonah skill add` again.

**`Review could not complete: session_id_not_found.`**
: With `--session ID`, no recording's file name carries the id, in the projects folder of Claude Code (with
  `CLAUDE_CONFIG_DIR` or `SONAH_CLAUDE_PROJECTS`, the folder they name) or in the Codex home (`CODEX_HOME`). Check the id,
  and the folders that `sonah doctor --no-probe` prints; `sonah sessions` lists what Sonah finds for this repository.

**`Review could not complete: session_id_ambiguous.`**
: More than one recording carries the id in its file name: Codex writes a second file for a thread after a revert, or
  the same file name is in two project folders. The line lists them. Give the path of the one to review.

**`Review could not complete: session_id_compressed.`**
: The one recording with the id is a compressed Codex rollout (`.jsonl.zst`), which Sonah does not read. The line names
  it. Decompress it (`zstd -d <file>`) and give the path of the `.jsonl` file.

**`Sonah got an empty session id, so it reviewed nothing.`**
: `--session ""` was given, which is what a skill passes when the agent's harness gives it no session id. Sonah never
  falls back to the newest recording here: that could be another session. Run `sonah sessions` and review by path or
  with `--choose N`.

**`sonah review --session ID --background` printed its line, and no page opened**
: The review runs in the background and can take minutes to about an hour on a long session. Its line names the page,
  the Markdown report beside it (the .md for your pull request) and the log. The log holds what the review printed,
  including its last line: a review that could not complete says why there, with its fix. With `--no-open`, Sonah
  writes the page and does not open it. A review of the same recording that `--background` started and that still
  runs, or any review of it while it asks the model, is said in the first line instead (`review_in_progress`), and no
  second review starts.

## While a review runs

The review first prints its estimate, for example *"This review should take roughly 4-12 minutes"*. A *window* is one
part of the session, reviewed in its own requests. The report does not show windows.
It then prints `Review window N/M finished` as each part completes. There are no default limits: it runs to the end.

**You want to stop**
: Press Ctrl-C. Sonah prints `Review could not complete: review_interrupted.` and how much it used. Answers already
  received are kept and never asked again; run the same command to continue. A request still running when you
  stopped is sent again. One exception: after the review's own calls, while `sonah review --format html` draws the
  graphs page ([The graphs page of a review](#the-graphs-page-of-a-review)), Ctrl-C stops the graphs page only. Sonah
  then prints `Graphs page: not drawn, because you stopped it.`, not `review_interrupted`, writes the review's page and
  exits with the review's own code.

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
  be taken for Sonah's. Sonah read the recording and sent nothing. Choose a `--state-dir` outside that folder (or leave
  it out: the default is under `~/.sonah`), or add `--no-code-pass`.

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

**`Code review: did not run yet. A part of the session review did not finish, and a new run can finish it ...`**
: A part of the session review did not finish, for a cause that the same command can fix when you run it again: a call
  that did not answer (a usage limit, a timeout, the network, a sign-in), an answer that was not valid JSON or did not
  match its shape, an answer with a proposal that Sonah could not check against the recording, or a check that gave no
  usable result. The code review's input holds what the session review found, so a code review run now could be asked
  again in whole on the run that finishes that part. So it does not run yet,
  and Sonah makes no code-review call. The page, the Markdown and the `Sonah's review:` line say so, and the exit code
  is the session review's own (1). Fix the cause first, as for `narrative:model_unavailable` below, then run the same
  command again: the code review runs after the session review. With `--code-pass`, it is the same: the run that
  finishes the session review runs the code review and counts it. A session review that two runs in a row left
  unfinished does not hold the code review back, and a part that no rerun can finish (too large to send, or a request
  that Sonah refuses) never does: the code review then runs, as before. A budget stop or Ctrl-C ends the run before the
  code review in any case.

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
  | `narrative:model_unavailable` | A call failed: no login, a usage limit, a timeout or the network. Run `sonah doctor` to see which (for Codex, add `--backend codex-cli` and `--model` with the model you review with), then the same command again. `sonah doctor` does not check `--backend anthropic-api`: there, check your network, your API key and your API account's limits. With that backend, it can also mean that Sonah found no API key in `ANTHROPIC_API_KEY`; the `Sonah's review:` line then says so. Set the key, then run the same command again. |
  | `narrative:no_json`, `narrative:schema`, `narrative:response_incomplete`, `challenge:votes_invalid`, `challenge:items_unresolved` | The model's answer could not be used. `challenge:votes_invalid` also follows a check call that failed: no login, a usage limit, a timeout, the network, or with `--backend anthropic-api` no API key in `ANTHROPIC_API_KEY`. The `Sonah's review:` line names a missing key only when the first call for a part failed for it. Fix such a cause first, as for `narrative:model_unavailable` above. Then run the same command again: only those parts of the session review are asked again. The code review's input holds what the session review found, so when their answers change it, the code review is asked again in whole. For `narrative:no_json`, `narrative:schema`, `challenge:votes_invalid` and `challenge:items_unresolved`, the code review waits for that run instead (see `Code review: did not run yet` above). |
  | `narrative:budget` ("the request did not fit the review input budget") | That part is too large for one request. Rerunning will not help; `sonah review --dry-run` counts such parts before anything is spent. |
  | "no review windows were produced" or "no actions were recorded" | The file is not a recording Sonah can read, or the session did nothing. Check the path; `--dry-run` shows what was read. |

  Note: a review that did not complete still writes its page, so use a new `--output` name when you run it again.
  Stored answers make the rerun quick and cheap.

**`Sonah's review: ... code review did not cover all of the change and its checks ...`** (or `... code review covered the whole change, but some of its checks gave no result that Sonah could use ...`)
: The code step ran but did not finish all of its work (or, with `code review did not finish`, its review agent gave no
  answer it could use). With `covered the whole change, but some of its checks gave no result that Sonah could use`
  (the page says the same), the code review saw every file of the change and every rule file and command it was given,
  and the check of a finding or of its questions gave no verdict (its item-by-item check may have fallen short too); a
  report from before these words says "did not cover all of the change and its checks" of it too. Under "What Sonah could not check", the page and the .md say what and why. On by
  default or by your setting, this does not change the exit code (the line says so); with `--code-pass` on the command
  line the review reads as not complete (exit 1). By what the page says:

  | What the page says | What to do |
  | --- | --- |
  | calls that did not answer (the code review, the repair of the code review, a finding's check, the check of its questions, or its item-by-item check) | An agent ran out of its turns (the review agent has 150, a finding's check 60, the other checks 80) or its time (45 minutes for the review agent, 30 for a check), its answer never matched its contract, or the call failed (sign-in, usage limit, network). Run the same command again: while the repository and what the session review found are unchanged, the answers that came back are reused and only these are asked again. |
  | calls that Sonah did not make, because their inputs were too large to send (its item-by-item check) | A batch of the item-by-item check did not fit the code review's size bound. Its items are counted in the lines below. Running again will not change it. |
  | a finding withheld because "its check did not finish (the check named a path that more than one repository of the change holds, so Sonah could not tell which file it means)", or open questions published unchecked, in a session that worked in several worktrees of one project | Each worktree holds the same files, so a path relative to one of them names a file in each, and Sonah does not guess which one the check meant. It asks the check once more to name the file by its absolute path. Since 0.3.0-beta.9, when more than one repository or folder holds the change, the code review is shown every file by its absolute path, and every agent of it is asked for absolute paths from the start. |
  | of your asks, asks that an agent wrote into a helper's brief, asks that Sonah could not trace to your own words, statements that the agent wrote into a file, or decisions not to act, which the code review's item-by-item check did not examine in a way that Sonah could use | After the code review, Sonah asks it to check each of these items against the code, in calls of 30 items, at most 4. Each line counts the items that the check left out, answered as not examined, or answered in a way that Sonah could not use (a quote it did not find word for word, an answer out of its shape, or an item past the 4 calls). Sonah calls an ask yours only when the recording shows it in your own words. The count says nothing about the code review's findings: a published finding can still concern a counted item. A call that did not answer leaves its items counted: run the same command again. A session with more than 120 items always shows a count, because of the limit of 4 calls. |
  | The code review did not answer, so Sonah counts none of them as seen | The review agent's call failed before Sonah recorded a turn or a tool call of it (sign-in, usage limit, network), so Sonah holds no sign that it read the change. Run the same command again. |
  | paths that the session wrote to, which Sonah counts but did not review | Not a gap in the change: these writes lie in a coding agent's home folder (its memory or settings), in Sonah's own folders, under a name from your home folder, or outside the folders that the code review could read: a folder that no git repository holds (the page lists those folders, see "folders that no git repository holds" below), or a git repository outside your working directory where none of the files the session wrote is there now with a change. Sonah counts them and does not review them. (A file that the session wrote with no change in a repository inside your working directory is not counted here: it is no file of the change, as in your own repository.) Since 0.3.0-beta.5, a file the session wrote in another git repository that is there now with a change is part of the change instead (see the next entry but one). |
  | The repository changed while the code review ran | A file of the repository changed between the start of the review and the end of the code step, so a file it quotes may differ now. Leave the repository alone while a review runs, then run the same command again. |
  | files whose change the code review did not see (binary, too large for one call, changed after the session's last recorded edit, not readable) | A limit of the change itself, not a failure: running again will not change it. |
  | files whose change the code review did not see (in another repository, written by an agent from another working directory, outside the working directory) | A report from before 0.3.0-beta.5: the session wrote these files, but they were not part of the change that Sonah gave the code review. Since 0.3.0-beta.5 a file in a git repository is: run the review again to have it reviewed. A file in a folder that no git repository holds is listed by its folder, not reviewed. |
  | In a folder, the change runs from the session's start commit there … / the change is the edits that the session recorded; N of them lie in a folder | Not a gap: another git repository holds files of the change (one the session wrote to, such as a sibling worktree or a repository nested in yours, or one you gave with `--code-repo`), and Sonah reviews them there (since 0.3.0-beta.5). The change there runs from the commit where that repository stood when the session began, by the same rule as in your working directory, or, when that repository's history began during the session, it is the edits that the session recorded. A repository counts only when a file the session wrote there is there now and differs from that commit, or when you give it with `--code-repo`. The code review's agents also read each one that holds a file of the change, and in one that you give Sonah reads with git the files that differ there, whatever the session wrote ([PRIVACY.md](PRIVACY.md) says what is sent). Each file says where it lies in the list of files. When another repository holds files of the change, the line about where the change runs from in your working directory begins "In the working directory's repository". (A report made before this rule was narrowed can also say this of a folder that no git repository holds.) |
  | N are in commits the session made / Sonah places N by time alone: changed during the recording and not committed when the agent stopped. They may not be the session's | Not a gap: these say how a file that no recorded write changed came to be part of the change. A commit the session made is one whose message's first line is in a command of the session or its helper agents, typed by the time of that commit, such as `git commit -m` or a heredoc. A merge counts only for the files its merge itself changed. A file placed by time alone last changed in the recording's window, and it differs from what was committed when the agent's recorded work ended (its last message, command or result in the session or its helper agents, never a row the recorder wrote after it, nor a message of yours that no row of the agent's follows). Nothing else shows that it is the session's, so its row in the list of files says "placed by time alone: it may not be the session's". When git or a recording cannot be read, Sonah can only say "changed during the recording". Before these lines, a report said "last changed while the session ran". |
  | In a folder, Sonah did not review files outside the evaluated session / In a folder, files are outside the evaluated session (a report from before these words: "files that changed outside this session's recorded writes") | In another git repository the session wrote to, these files differ from that repository's commit, but no write that the recording shows touched them, no commit the session made changed them itself (a merge counts only for the files the merge itself changed, not for those it brought in), and none was left uncommitted by a change while the agent worked: another agent's or your own work there, before, during or after the session. After their names the line says what holds of them all, in the words of the row below for your working directory. Sonah names them (the first 10, then how many more). As in your working directory, they are outside the evaluated session: with a change of the session's own to review, Sonah gives them to the code review apart from it if there is room in its input (the second line), else it does not review them (the first). A file there is part of the change instead by the same rule as in your working directory: in a commit the session made, or last changed while the session ran and not committed when the agent stopped, marked as one that no recorded edit wrote. A report from before these words placed such a file by its time alone: one that no recorded write changed and that last changed outside the session's recorded time was outside, even when a commit the session made holds it, and one that last changed inside it was part of the change, whoever committed it. Run the review again to place them by the rule above. |
  | The session wrote N files in folders that no git repository holds. Sonah lists them and did not review them | Not a gap in the change: these files lie outside every git repository (a notes folder, an agent's scratch folder, your home folder). Sonah does not review them, its agents do not read those folders, and they do not change the coverage. It names each folder (the first 10, then how many more) with how many files the session wrote there; the footer counts them with the other paths it did not review. |
  | writes of the session name paths with an unexpanded shell variable or command substitution | A shell command of the session wrote to a path such as `$DIR/notes.md` or `$(pwd)/x.md`. The recording holds the command as typed, not what the shell expanded it to, so Sonah cannot tell which file it wrote. It counts these writes apart and does not review them. A path that a file tool (Write, Edit) wrote is taken as it is spelled, even with a `$` in its name, and so is a path that, spelled as recorded, names a file or folder that is there (a relative path in the session's working folder, an absolute path where it points), or a file that git lists as changed since the start commit, such as one the session deleted (the recording keeps no quotes: a route file `app/routes/users.$id.tsx` that a shell command wrote is a file of the change). |
  | Sonah does not yet see every edit made by helper agents or by scripts after a cd | The session ran a shell command. A script can write files after a change of folder that Sonah does not follow (such as a `cd` to a folder that the command does not name, `pushd`, a subshell, another shell, or a script's own change of folder), where Sonah cannot place its writes, and Sonah does not yet read every helper agent's own edits. So the change the code review had can miss some of them: review such edits yourself. Shown in the code review's part of What Sonah could not check, on the page and in the .md (since 0.3.0-beta.6 no longer on the terminal's code review line). |
  | Sonah showed the code review every changed line of N files in K calls | Not a gap: since 0.3.0-beta.9, a change larger than one request holds (about 400 KB of lines) is split by file into parts, each sent in its own call with the whole change's list of files. "It could not show M files" names the files that no call showed, and why. |
  | files whose change Sonah left out of the code review's input for room | A call's input had no room left for these files beside the rest of it (the change's list of files, your words, the rule files, the commands). The agent was told to read those files itself. Before 0.3.0-beta.9, a change larger than one request holds (about 400 KB of lines) also left its largest files out; now each part of it has its own call. |
  | files changed after the session's last recorded edit | Not a gap: a file the session wrote changed again afterwards (a formatter, a script, your own edit). Its change from where the session started was shown and reviewed, but some of its lines now may not be the agent's. |
  | Sonah did not review files outside the evaluated session (a report from before these words: "files that changed outside this session's recorded writes") | These files differ from the commit where the session started, but nothing shows that they are this session's: no write that the recording shows touched them, no commit the session made changed them itself (a merge counts only for the files the merge itself changed, not for those it brought in), and none was left uncommitted by a change while the agent was working. After their names the line says so: "No recorded write changed them, and Sonah found no commit of the session that changed them itself. Sonah also found no change to them while the agent worked that was still uncommitted when the agent stopped." When git or a recording cannot say, or with a base you named (only an untracked file is outside then), it says only "No recorded write changed them, and Sonah found no change to them while the agent worked." When you named no base and gave no `--code-repo`, it ends with the way to review all that a branch changed in the folder, `--code-base <branch>`, if the session has a change of its own to review; if not, the first lines of the report give that way. They can be a later commit, a commit by other hands while the session ran (a pull, another session), your own edit, or a file already changed before the session began. They are outside the evaluated session, and the line says so. Sonah names them (the first 10, then how many more). This line shows when no code review ran or answered: with a change of the session's own to review, Sonah gives them to the code review apart from it if there is room in its input, and the next row's line shows instead. On a Codex recording, so is a file that last changed between the end of the agent's turn and your next message, such as a pull or a background command's output. A file that a command of the session deleted, or moved in a way that Sonah does not read as a write (such as `git mv`, or a `mv` that names only the folder it moves into; a deleted file has no time, and a moved file shows under its old name as a deleted one and under its new name, which keeps its old time, only when git tracks it, as after `git mv`), or changed and that changed again later, is among them too, unless a commit the session made changed it: review those yourself, or give the base with `--code-base`, which brings them in when git tracks them. A report from before these words placed such a file by its time alone: one that no recorded write changed and that last changed outside the session's recorded time was outside, even when a commit the session made holds it, and one that last changed inside it was part of the change, whoever committed it. Run the review again to place them by the rule above. |
  | files are outside the evaluated session (a report from before these words: "files that changed outside this session's recorded writes are outside the evaluated session") | The same files (in a report from before these words, by its rule in the row above), given to the code review after the session's own change and apart from it, with the same words after their names; the next line says what the code review saw of them (left out first when the request is too large). A finding about one, and a question from such a finding, reads "It is about code outside the evaluated session." and names none of your asks or the agent's claims; the count line counts them. A broken contract, a broken rule or a contradicted claim that a line the session changed causes is the session's finding even when it shows in such a file, so it has no such marker. They are not the session's change: the coverage line, the footer and the header count only the session's own files, and a check of a finding about them that fails or is too large to send does not make the coverage short. |

**`No code was reviewed. Reason: ...`** (the first lines of the page, the .md, the terminal and the pull request comment)
: The code review read no code in this review. The reason says why, and the folder after it is where Sonah looked:
  its full path on the page and the terminal, only its name in the .md (your home folder itself as `~`), and none in the
  pull request comment. The items of the report then show no impact or action from the code review, and the
  line `Sonah's review: complete, but no code was reviewed (...)` and the pull request check's title (`Sonah finished
  its advisory review, but no code was reviewed`) say the same. By the reason:

  | Reason | What to do |
  | --- | --- |
  | this review ran without the code review | The code review is off (`--no-code-pass`, or `sonah config code-pass off`). Turn it on with `--code-pass`. |
  | the code review needs Claude Code, and this review used another backend | Run the review on the `claude-cli` backend. |
  | Sonah could not read a working directory of the session on this computer | Run the review on the computer where the session ran, with its folder still there. |
  | the recording shows no write of the session that could have changed a file | No write that the recording shows could have changed a file, and the session ran no shell command, and no commit the session made holds a file of the change. Sonah then reviews no code on its own, and the files that differ are outside the evaluated session. When a git repository holds the folder (whether or not Sonah found the commit where the session started in it) and you gave no `--code-repo`, which does not go with `--code-base`, the reason then says: "To review all that a branch changed in this folder, run sonah review again with --code-base <branch>" (see "`--code-base`" below). Sonah does not yet read every helper agent's own edits: if a helper agent changed files, check them yourself with `git status` and `git diff` in that repository. |
  | Sonah found no write of the session that it can read. The session ran shell commands, and Sonah does not yet see what a script writes. Check each repository that they could change, with git status and git diff. To review that code, run sonah review again with --code-repo <the repository's folder> | No write that the recording shows could have changed a file, but the session ran shell commands. A script can change files that no recorded write names: a Python or shell script that writes a path it builds, or a script file that the command runs. Sonah does not yet see those writes, so the code review had none of them to review, and the session can still have changed files. Check each repository that those commands could change with `git status` and `git diff`. To have that code reviewed, run `sonah review` again with `--code-repo` and the folder of that repository (once for each repository): see "`--code-repo`" below. When a git repository holds the folder and you gave no `--code-repo`, the reason then gives the way to all that a branch changed in it: see "`--code-base`" below. |
  | Sonah found no write of the session that it can read, and no file of the change in the repositories that you gave with --code-repo. The session ran shell commands, and Sonah does not yet see what a script writes. Check each repository that they could change, with git status and git diff | As the row above, but you gave `--code-repo`, and Sonah found no file of the change in those repositories: no file there that a recorded write could have changed, none in a commit the session made, and none whose last change came while the session ran and that was not committed when the agent stopped. A file that the session changed and that changed again after it, or whose last change kept an older time (a copy, a move), is outside the evaluated session unless a commit the session made changed it: the line after the repository's line names those files. When the repository that you gave holds the working directory, Sonah reads it by the working directory's own rule, so outside the working directory a file that a script changed stays unread, and the report says so. Giving the repository again does not change this. Check each repository that those commands could change with `git status` and `git diff`. |
  | among the changed files in the folder, Sonah found none that the session wrote | The session's writes lie where the code review does not read (a coding agent's home folder, Sonah's own folders, a name from your home folder, a folder that no git repository holds), or no longer differ from where the session started. Check those files yourself. When you gave no `--code-repo`, the reason then gives the way to all that a branch changed in this folder: see "`--code-base`" below. |
  | Sonah found no tracked file in the folder that differs from the base that you named | You gave `--code-base`, and no tracked file under the working directory differs from it. An untracked file with no recorded write and no change during the recording is named apart. |
  | Sonah found no changed file in the folder | No file that the session wrote differs from where the session started, in the folder that Sonah names or in another git repository that the session wrote to. If the session changed files in a way that Sonah does not yet see (a script, a helper agent), check them yourself with `git status` and `git diff`. |
  | Sonah could show the code review no changed lines of the change | Each file of the change is binary, deleted with no lines, or outside the change that Sonah can show. Review those files yourself. |
  | the code review's input was too large to send | The change is larger than one request holds. Running again will not change it. |
  | the code review did not answer | Run `sonah doctor`, then the same command again. |
  | the code review saw none of the files of the change | The code review answered without seeing any file. Run the same command again. |
  | this review was saved by an earlier version of Sonah, which did not record why | The review was saved before Sonah kept a record of the code review's input, so its record does not say why no request was made. Run the review again to see why. |
  | a part of the session review did not finish, and a new run can finish it. Run the same command again, and the code review runs after the session review | A call of the session review did not answer, an answer was not valid JSON or did not match its shape, an answer held a proposal that Sonah could not check against the recording, or a check gave no usable result, and the code review waits, because the run that finishes that part could ask it again in whole (see `Code review: did not run yet` above). Fix the cause, then run the same command again. |

  Running the review from another folder does not change the reason: the code review reads the working directory that
  the recording names and the repositories of its change, not the folder that you run `sonah review` in. To point the
  code review at another repository, add `--code-repo` with its folder (below). To review everything on a branch, add
  `--code-base` and the branch to compare with (below).

**`--code-repo DIR`** (the code review of a repository that the recording does not show the session changing)
: A session can change a repository in a way that no recorded write shows: a script that writes the paths it builds, a
  script file that the command runs, or a write after a change of folder that Sonah does not follow (such as a `cd` to
  a folder that the command does not name, `pushd`, a subshell, another shell, or a script's own change of folder). Run
  `sonah review` again with `--code-repo` and the folder of that repository (any folder in it; give the option once for
  each repository). Sonah reads it as if the session had written there: its
  change runs from the commit where it stood when the session started (the same rule as the working directory's), and
  holds the files that a recorded write could have changed there, the files in a commit the session made, and the files
  whose last change came while the session ran and that were not committed when the agent stopped (each of those two marked as
  written by no recorded edit). The other files that differ there are outside the evaluated session,
  as in your own repository. When the repository holds a file of the change, the code review and its checks read that
  folder too. The page and the .md name the repository with its count of files. "The change holds 0 files there" means
  that Sonah found no such file there. A file that the session changed and that changed again after it, or whose last
  change kept an older time (a copy, a move), is outside the evaluated session unless a commit the session made changed it:
  the line after it names those files. Giving the repository that holds the session's working directory changes nothing
  that Sonah reads, since Sonah reads it by its own rule already (in a working directory that is a folder of a larger
  repository, a change elsewhere in it that Sonah does not see or place stays unread); the page and the .md say that you
  gave it, and how Sonah reads it. When no code was reviewed after all, the reason says what Sonah found in the
  repositories that you gave (the row above), and does not tell you to give them again. Without `--code-repo`, nothing
  changes.

**`Review could not complete: code_repo_not_found.`** (exit 2)
: A folder that you gave with `--code-repo` does not exist, or is a file. Nothing was read or sent. Give the folder of the
  repository that the session changed.

**`Review could not complete: code_repo_not_git.`** (exit 2)
: A folder that you gave with `--code-repo` is in no git working tree (or is inside a `.git` folder, or a bare
  repository). Nothing was read or sent. Give the folder of a git repository that the session changed, or any folder in
  it.

**`--code-base REF`** (the code review of all that a branch changed in the working folder)
: Without it, the change is what the recording shows to be the session's. To review all that a branch changed, whoever
  wrote it, run `sonah review` again with `--code-base` and the branch to compare with, such as `main`. The change then runs
  from where that branch and yours meet (git's merge base) to the files as they are now, and holds every tracked file
  that differs under the working directory. When the working directory is a folder of a larger repository, what differs
  elsewhere in it stays out, and the report and the terminal count it. The report says that you named this base, so the
  change can hold work that is not this session's, and how many of its files a recorded write could have changed. Untracked files keep the usual
  rule, and another repository keeps its own start commit. Give the option once. It is not used with `--no-code-pass` or
  `--code-repo`. Without `--code-base`, nothing changes.

**`Review could not complete: code_base_not_found.`** (exit 2)
: Git cannot find what you gave with `--code-base` in the session's repository. Sonah read the recording and sent nothing.
  Run `git fetch`, or check the name.

**`Review could not complete: code_base_no_merge_base.`** (exit 2)
: What you gave with `--code-base` shares no commit with HEAD. Sonah read the recording and sent nothing. Give a branch
  that yours started from.

**`Review could not complete: code_base_not_git.`** (exit 2)
: No git repository holds the session's working folder, so there is no base to compare with. Sonah read the recording and
  sent nothing. Run the review without `--code-base`.

**`Review could not complete: code_base_no_code_step.`** (exit 2)
: You gave `--code-base`, but this review does not run the code review: the setting turned it off, or the backend is not
  `claude-cli`. Sonah read the recording and sent nothing. Add `--code-pass`, and use the `claude-cli` backend.

**`Sonah could not place N paths that the agent wrote, so it does not count them as files.`** (What the agent did)
: The agent wrote these paths with a shell command, and as recorded each holds a shell variable or the output of a
  command (such as `$P/run.sh`). The recording does not hold its value, so Sonah cannot tell which file it was. Sonah
  does not count it as a file of the change, and the code review does not get it. Check these writes yourself. A path
  that, spelled as recorded, names a file or folder that is there (a relative path in the session's working folder, an
  absolute path where it points), or a file that git lists as changed since the start commit, is a file of the change
  instead (the recording keeps no quotes); with the code review off, Sonah does not look, and counts it here.

**`Sonah did not read N workflow runs or the recordings of their agents.`** (What Sonah could not check)
: A workflow run's journal had lines in a form that Sonah does not read, was missing, or its folder did not resolve, so
  Sonah reviewed none of that run's agents. The other lines there name other kinds of evidence, each with its own count:
  other entries of workflow run folders, workflow calls with no launch recorded, helper recordings that Sonah read only
  in part, calls whose input Sonah holds only in part, and calls of the agent's code cells that no recorded item
  accounts for. "Sonah holds N kinds of evidence only in part" counts the other kinds.

**`Sonah left out N decisions that the session review's check rejected, because the second check of them did not run.`** (What Sonah could not check; the terminal's `Windows complete` line says the same count)
: A decision that the session review's check rejected gets a second check, which can keep it. Here that check did not
  run: one of its calls failed (also after its retry, or with an error that is not retried, such as a rate limit), the
  run reached its budget, or the reply left the decision out or could not be read. Sonah leaves such a decision out, as
  it leaves out every decision that its checks reject. Run the same review again: at the end of a review, Sonah forgets
  the stored answers of each such check, so the next run asks it again and reuses every other stored answer whose input
  is the same. If that check now keeps a decision, what the session review found changes, and so does the code review's
  input, so the code review is asked again in whole. The exit code does not change, because every review window
  finished.

**`Sonah's review: ... code review had no change to review, because ...`**
: The code step found no file of the session's change to review, so it made no code-review call. The words after
  "because" say why, as the page does: the recording shows no write of the session that could have changed a file
  (and the session ran no shell command); Sonah found no write of the session that it can read, and the session ran
  shell commands, whose writes Sonah does not yet see (a script can still have changed files: check each repository
  that those commands could change with `git status` and `git diff`, and add `--code-repo` with its folder to review
  it, or `--code-base` and a branch to review all that changed in the session's working folder since your branch met
  that one); Sonah found no changed file here that the session wrote (Sonah does not review where its writes lie, or
  they no longer differ from where the session started); or Sonah found no changed file here. "Here" is the folder that
  the recording names, not the folder that you run the review in, so running the review from another folder does not
  change it. Files that differ but changed outside this session's recorded writes are outside the evaluated session:
  they are named on the page (the table above says what that line means), and with no change of the session's own to
  review Sonah does not review them.

**`Sonah's review: ... code review covered the whole change, but its item-by-item check did not examine every item ...`**
: The code review saw the whole change, and the checks of its findings and questions ran, but its item-by-item check
  left items that it did not examine in a way that Sonah could use. Under "What Sonah could not check", the page and the
  .md count them by kind, and name a call of that check that did not answer (the table above says what each line
  means). On by default or by your setting, this does not change the exit
  code; with `--code-pass` on the command line the review reads as not complete (exit 1).

**`The code review found that it holds in the code`** (a note on a "Not checked" ask under "Your asks", on the page and in
the .md)
: The session review could not check this ask in the recording, and the code review's item-by-item check found in the
  code that it holds. The note names the lines where Sonah found each quote of that check word for word in the files as
  they are now. Open the file at those lines to check it yourself. Sonah did not check
  the code review's verdict, so the ask carries the tag "Verdict not checked" and still reads "Not checked", and every count (the count line, the "Sonah did not
  check" line in What Sonah could not check, and the pull request comment) counts it as not checked. The code can also do an ask that the agent did not do in this session. An ask that
  the code review ties to a finding, a question or a withheld finding has no such note and keeps its line. Neither does
  an ask that one of Sonah's own checks speaks against or did not settle (its cited run or write did not run to its end
  or Sonah could not read its end, Sonah's check refuted or did not settle its status, or Sonah did not find the part
  that the session review said is missing), nor one for which the code review quoted the files as they were at the
  session's start commit (with `--code-base`, at the base you named).

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
: Sonah never shortens the header, the count line, the counts of Your asks or the asks that are not done. It keeps
  the open lines of the Must act and Must know items whole too. Here these parts alone are longer than the limit, so Sonah prints no `gh` command. Open
  the page, or post a part of the .md yourself.

**A Must act item has no fold "Prompt for the agent".**
: Sonah writes a prompt only for these Must act items: an ask that the agent did not do or did only in part; a claim,
  or a statement in a file, that the recording contradicts; an edit against your words; and a bug, a broken contract
  or rule, an ask that the code does not meet or a false claim that the code review found. Other items, such as a weak
  test or a question of the code review, have none. Sonah writes one only when it found the quotes that the prompt
  needs again in the recording. When Sonah shortens the .md to fit a GitHub comment, it can
  leave the prompts out; the HTML page keeps them unless it is shortened too. The .md that Sonah prints in the terminal
  holds no prompt: give `--output` to write the report with them.

**`To get code links, commit your work.`**
: Some reviewed files differ from your last commit, or a commit is not on GitHub. So the report has no code links for
  them. Commit your work. Push the commit. Then run the same command with a new `--output` file. Sonah reuses its
  stored answers, so this run makes no model call for the review (an HTML review whose work is now committed draws its
  graphs page, with calls of its own).

**`Sonah wrote the report inside the repository.`**
: On the next run, a report file in the repository reads as a change of the repository, so the code review asks again.
  Move the report files out of the repository, or add them to `.gitignore`, before you run Sonah again.

**`Review could not complete: output_folder_missing.`** or **`output_folder_unwritable.`**
: The folder of the `--output` file does not exist, or you cannot write to it. Sonah creates no folders: create it
  first, or choose a file in a folder you own, such as `~/review.html`.

**`Sonah saved the page, but could not open it.`**
: Open the printed path in your browser. Use `--no-open` on a machine with no browser.

**What Sonah could not check lists "no checked recording" for a helper, or another limit; `--dry-run` names "Known gaps"; the pull request comment has a "Not covered: ..." line**
: These are limits of the recording, not failures of the review: a helper agent's recording was not found beside its
  parent, a command recorded no exit status, and so on. They do not make the review incomplete. Since 0.3.0-beta.6 the
  terminal no longer prints them (before, on its "Coverage: ..." and "Not covered: ..." lines): each one, with its
  count, is in the fold What Sonah could not check of the page and the .md, also when Sonah shortens the .md, and the
  exit code is the same. Keep helper
  recordings where your agent wrote them (Claude Code: `<session>/subagents/` beside the session file).

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

## The commit link (`sonah hook add`)

`sonah doctor`, run in the repository, prints one `Commit link:` line. What each one means:

- **`Commit link: off in this repository.`** `sonah hook add` was not run here, or `sonah hook remove` was. Run
  `sonah hook add` to turn it on.
- **`Commit link: on.`** Sonah can see that git runs its hook at each commit: Sonah's own hook file is the hook, or
  pre-commit's hook runs it as `prepare-commit-msg.legacy` (the line says which).
- **`Commit link: not checked. Sonah's line is in ...`** You added Sonah's line or command to a file that another
  tool or you own, and Sonah does not follow that file to see whether git reaches the line. Let your agent make one
  commit, and look for the line in `git log`. A hook that ends in `exec` or `exit` before the line never reaches it.
- **`Commit link: not checked. ... is another tool's hook`** The hook git runs is another tool's, and Sonah's line is
  not in it. Run `sonah hook add` and add what it prints.
- **`Commit link: off. lefthook moved Sonah's hook to ... .old, and nothing runs it there.`** A `lefthook install` ran
  after `sonah hook add`. Run `sonah hook add` again: it prints Sonah's command for your lefthook file. `sonah doctor`
  exits 1 until then.
- **`Commit link: off. ... is Sonah's hook, but it is not executable, so git skips it.`** Run `sonah hook add`: it
  makes Sonah's own file in the git folder executable again, or prints the `chmod +x` command for a file elsewhere (a
  `core.hooksPath` folder). `sonah doctor` exits 1 until then.
- **`Commit link: off. ... runs no line of Sonah's, and Sonah's script is still there.`** Another tool replaced the
  hook (lefthook does so without a `.old` copy when its file names no hook), or the hook file was deleted, or
  `core.hooksPath` points to a folder with none. Run `sonah hook add` and add what it prints. `sonah doctor` exits 1
  until then.

`sonah review --commits A..B` stops with one of these before it reads the session and before any model call. To print
the list above the code, it has read the range's messages and the tool calls of each recording the range names.

- `commits_range_unreadable`: git cannot list that range in this repository. Give one that `git log` reads, or the
  repository with `--repo DIR`.
- `commits_no_session`: no commit of the range names a session in an `Agent-Session` line. `sonah sessions --commits
  A..B` says how many lines carry a value that is not a session id.
- `commits_choose_one`: the range names several sessions whose recordings are here, or `--choose N` names no row of the
  list. Sonah lists them above. Add `--choose N` with a row of the list.
- `session_not_on_this_computer`: no file on this computer carries the session's id. Review it where the agent ran.
- `session_id_ambiguous` or `session_id_compressed`: two recordings here carry the session's id, or its only recording
  is a compressed Codex rollout (`.zst`). Sonah names the files: give the path of the one to review, or run `zstd -d`
  on the compressed one and give the `.jsonl` file that it writes.

`sonah sessions --commits A..B` exits 1 when no commit of the range names a session. `sonah sessions --github
OWNER/REPO --pr N` does the same for a pull request whose commits GitHub listed in full, and exits 2 with `Sonah could
not read the commits of ... from GitHub` when GitHub does not answer (a wrong name or number, or a token that cannot
read the repository). When the pull request holds more than 250 commits, GitHub lists 250: Sonah says so, prints the
two commands that read them all, and exits 2 when none of the commits it got names a session. Run from a folder in no
git repository, it says so first, and no commit can be shown in a recording: run it in your clone, or give the clone
with `--repo DIR`.

A commit with no `Agent-Session` line: it was made in your own terminal, by Codex (not stamped yet), with a message
written in an editor, with an empty message (blank, comments or `Signed-off-by:` lines only, which git refuses), or by
a rebase or a cherry-pick, which add no line (see
[INSTALL.md](INSTALL.md#link-commits-to-sessions)). `sonah hook add` stops with `... is in no git working tree`,
`... is a bare repository`, `... is there, and Sonah did not write it` (a file where Sonah keeps its script) or
`... passes through a link`, and changes nothing; each exits 2. When `.git/hooks` is a link, it writes no hook there,
prints what to add, and exits 1.

## The page of a change (`sonah visual`)

`sonah visual` prints its problems in fixed words, never git's or the model's text. A usage error prints `sonah visual:
<the problem>.` and the usage line, and exits `2`: a range of another shape than `BASE..HEAD`, `BASE..` or `BASE` (`...`
is refused), an unknown option, an option with no value, or a `--server` address that is not https (http only for
this computer) or that holds a user, password, query or fragment.

**No "Save online" or "Invite your team" on the page.** The page has them only when the push remote of the repository
names its owner and name (`git remote -v` lists the remotes): with no remote, a remote that is a folder on your computer
or a `file:` address, or a head that is not a SHA-1 commit, it has neither. A review over 25 MB keeps the buttons as
links to the server's page of the review, which cannot save it.

**`Visual review is not complete: at least N answers are still needed. ...`**
: Exit `1`. With `--replay-only`, the folder does not hold every answer yet: run the same command without
  `--replay-only` to ask for them. Without it, run the same command again.

**`Visual review could not complete: <code>.`** and a `Fix:` line. These exit `2`; fix what the line says, then run the
same command again:

- `not_git`: the folder you ran it in is in no git repository. Run it in the repository whose change you want.
- `folder_unreadable`: the system refused Sonah access to the folder it runs in. Run it from a folder that this terminal
  can read.
- `base_not_found` or `head_not_found`: git cannot find that side of the range here. Check the name; a commit that is
  only on the remote needs `git fetch` first, since Sonah never fetches. With no range, `head_not_found` means the
  repository has no commit yet.
- `default_branch_unknown`: you gave no range, and your local git does not know the default branch of the remote (no
  remote, or no `origin/HEAD`). Give a range such as `sonah visual main..HEAD`, or run `git remote set-head origin
  --auto` once (with the name of your remote).
- `no_merge_base`: `HEAD` shares no commit with that default branch. Give a range.
- `no_change`: the head adds no commit to the base (they are the same commit, or the head is behind the base), so there
  is no change to draw. With no range, your branch has no commit of its own yet, which is also what plain `sonah`
  finds on the default branch itself: `sonah visual HEAD~1..HEAD` draws the last commit there.
- `invalid_model`: `--model` needs a full model ID, such as `claude-sonnet-5-5`, not an alias such as `sonnet`.
- `output_folder_unwritable`: Sonah could not make or write the folder for the page. Choose a `--out` folder that you
  own, or check that you own your `SONAH_HOME` folder.
- `cli_missing`: Sonah could not start `claude`. Install Claude Code, and sign in with `claude auth login`.
- `auth`: Claude Code is not signed in, or the account was refused. Run `claude auth login` with your Claude
  subscription account.
- `billing`: the account cannot pay for the call. Check the plan and billing of your Claude account.
- `model_not_found`: your account cannot use that model. Choose another one with `--model`.
- `usage_limit`: your Claude plan's usage limit was reached. Wait until it resets.
- `folder_in_use`: another Sonah is drawing the same page into the same folder now (a second terminal, the graphs page
  of a review, or a review of a push), and Sonah draws a folder one at a time. It stops at once and writes nothing.
  Wait until the other one ends, then run the same command again: it reuses the answers the other one stored. While a
  page is drawn, its folder holds `draw.lock`, which names the process id of the Sonah that draws it and when that
  process started. A lock whose process has ended, or whose id now names a process that started at another time, is
  taken back by the next run, so a Sonah that was killed does not keep the folder locked. On a drive with no hard links
  (FAT or exFAT, some network shares), Sonah cannot tell an empty `draw.lock` from one that another Sonah is writing at
  that moment, so it leaves it. If `folder_in_use` stays while no other Sonah runs, delete `draw.lock` and each
  `draw.lock.claim-` file in that folder.

The answers that came back before a stop stay stored, so the next run asks only for the rest.

These exit `3`, and the same command asks again: `timeout`, `output_limit`, `provider_busy` and `call_failed` (the call
for the story of the change, or for what a reviewer must act on or know, failed, so no page is written), and
`visual_failed` (anything else). If it fails again, run `sonah doctor --no-probe`.

### The graphs page of a review

`sonah review --format html` draws the graphs page of the session's commits before its own page (D219), from where the
session started to `HEAD` (with `--code-base`, from where your branch and that base meet: the whole branch). When it
starts, it prints `Sonah draws the graphs page of the session's commits, with claude -p on your Claude plan.` on
stderr; each other line it prints about it starts with `Graphs page`:

**`Graphs page: <path>`** and
**`Graphs page usage: N model calls, list cost $X, as the footer of the page counts them.`**
: The page is written, and the review's page links to it in its header. The counts are those of the graphs page's
  own `run.json`, stored answers included; the review's `Review usage:` line does not count them.

**`Graphs page: not drawn. ...`**
: One line on stdout says why, and the review's page says the same line in its header, where the link would be. Where
  `sonah visual` can draw it, the line names that command:
  - `It draws commits only, and files of the change differ from HEAD.`: commit the work, then run the `sonah visual
    <start>..HEAD` that the line names (or the same review again with a new `--output`). A binary file, a lockfile or
    another file whose text Sonah does not keep counts as committed when `HEAD` holds it and your working tree does not
    change it (`git diff` of it against `HEAD` is empty).
  - `Sonah finds where the session's commits start with the code review, which was off.`: you ran the review with
    `--no-code-pass` (or `sonah config code-pass off`), so Sonah has no start commit. Give `sonah visual` a range.
  - `It draws the commits of a git repository, and Sonah found none that holds the session's folder.`: the session ran
    outside a git repository, or Sonah could not read its folder here. No command is named.
  - `It draws commits only, and Sonah could not tell where the session's commits start.`: a git repository holds the
    folder, but Sonah read no start commit of the session in it. Give `sonah visual` a range.
  - `It draws commits only, and HEAD is still the commit where its range starts.`: no commit since the session started
    (with `--code-base`, since your branch and that base meet), and nothing of the change to commit (a session that only
    read, for one). There is nothing to draw, and no command is named.
  - `It draws commits only, and Sonah read no file of the change.`: the session changed no file of this repository that
    Sonah found, or the code review did not run yet (it waits for the run that can finish the session review). The line
    names `sonah visual <start>..HEAD`, the commits since the start of the range.
  - `because its calls would not count in the limits that you set.`: `--max-calls`, `--max-input-bytes` and
    `--stop-at-utilization` limit the review's own calls only. Run the `sonah visual` command the line names.
  - `Sonah draws it only on the claude-cli backend.`: on `--backend codex-cli` or `anthropic-api` you chose another
    provider, so nothing is sent to `claude`, and no command is named.
  - `because you stopped it.`: you pressed Ctrl-C (or the process got SIGTERM) while it was drawn. Only the graphs page
    stops: Sonah stops the call that was running and starts no new call for it, and the review writes its page, its
    report and its usage record, with its own exit code. Run the `sonah visual` command the line names; it reuses the answers that came back.

**`Graphs page: Visual review could not complete: <code>.`** and **`Graphs page: Fix: ...`** (on stderr)
: The graphs page was not drawn, for one of the codes above. The review's page is written without the link, and says
  in its header the same problem and its fix, in one line that starts `Graphs page: not drawn.` and names the `sonah
  visual <range>` command (for `no_change`, a range such as `main..HEAD`): the page of a /sonah background review says
  why too. A failed call, answers still needed or any other failure says `Sonah could not finish it.` there. The
  review's exit code is its own: a graphs page that fails never changes it. Fix what the line says, then run the `sonah
  visual <range>` that the next line names: it reuses the answers that came back. For `folder_in_use` (another Sonah
  drew the same page at the time), the page says `Sonah could not finish it.`: run that command once the other one
  ends. After `no_change` no such line
  follows: give a range whose head is ahead of its base, such as `main..HEAD`. `--no-visual` skips the graphs page.

**`Graphs page: on. ...`** or **`Graphs page: off ...`** (the last line of a `--dry-run` with `--format html`)
: Whether the review would draw the graphs page, and if not, why: `(--no-visual)`, another backend, a limit, the code
  review off, no git repository, or no start commit. The dry run reads no commit for it, so a review whose work is not
  committed can still say `on`.

## Sonah Team (`sonah connect`)

`sonah connect`, `sonah connect --token`, `sonah disconnect` and `sonah status` print their problems in fixed words,
then a `Fix:` line, and never the token. A usage error prints `sonah connect: <the problem>.` and the usage, and exits
`2`: no code, a code of another shape than 4 to 40 letters, digits, spaces or hyphens, a token on the command line
(`--token` takes it on standard input only, so that it stays out of your shell's history), an unknown option, or a
`--server` address that is not https (http only for this computer) or that holds a user, password, query or fragment,
or `--hook` and `--no-hook` together or twice. `sonah disconnect` and `sonah status` take no argument.

**No code to give `sonah connect`.** A code comes from the Sonah Team server's page for connecting a laptop, and that
page offers one only from the server's next release. Until then, make an upload token on the server's
`/settings/tokens` page and run `sonah connect --token`, then paste it (it does not show) or pipe it in.

These exit `2`, and Sonah keeps no connection:

- **`Sonah asks before it keeps a connection, and this is not a terminal.`** `sonah connect <code>` ran in a pipe, a
  script or with its output sent to a file. It sent nothing, so the code still works: run it in a terminal, or pass a
  token on standard input with `sonah connect --token`.
- **`<server> does not know this code.`** The code was mistyped, already used, or older than 10 minutes. Get a new code.
- **`<server> asks Sonah to wait a minute.`** Too many codes from your address did not match. Wait one minute.
- **`You have as many upload tokens on <server> as it allows.`** A person has at most 10 live tokens. Revoke one on
  `<server>/settings/tokens`, where each is listed by its name (`sonah on <host name>` for a computer that connected
  with a code).
- **`<server> does not take this token.`** For `--token`: the token was revoked, mistyped, or belongs to another
  server. Make a new one on `<server>/settings/tokens`.
- **`That is not an upload token.`** For `--token`: what came on standard input is not 16 to 512 characters with no
  space. Copy the whole token.
- **`Sonah could not reach <server>.`**, **`<server> answered with a redirect, and Sonah does not follow one.`**,
  **`<server> answered with the status <n>.`** or **`<server> gave an answer that Sonah cannot read.`** Check the
  address that `--server` names, and your network. Sonah follows no redirect, so that the token never goes anywhere
  else: name the server's own address.
- **`This computer has a connection to <server> as @<login>, and Sonah asks before it replaces one.`** For `--token`
  outside a terminal: the token is another login's or another server's. Run `sonah disconnect` first, or run the
  command in a terminal and answer its question.
- **`Sonah could not write <file>, so it kept no connection.`** Check that you own your `SONAH_HOME` folder. Sonah
  revoked the token that the code made, or says where to revoke it.
- **`This computer has no connection to a Sonah Team server.`** From `sonah disconnect`: there is nothing to end.

These exit `1`:

- **`Sonah did not connect this computer.`** You answered no. Sonah revoked the token that the code made; when it
  could not, it says so, and you revoke it on `<server>/settings/tokens`. A token you passed with `--token` stays live.
- **`... is still live. Revoke it at <server>/settings/tokens.`** Sonah could not revoke a token that it no longer
  keeps: the one a new connection replaced, or this computer's after `sonah disconnect` when the server did not answer.
  Revoke it on that page. Until then it works for anyone who has it.
- **`Sonah cannot read <file> as a connection.`** From `sonah status`: the file is not yours, others can write it, or it
  is not of its shape, so Sonah does not use it. `sonah disconnect` deletes it (and exits `1`, since it could revoke no
  token from it); then connect again.
- **`<server> no longer takes the token of this computer.`** From `sonah status`: someone revoked it on the server's
  page. Run `sonah disconnect`, then connect again with a new code.

**`You have a free seat in the team <team> there.`** Your reviews on Sonah Team are readable by you only while your
seat is free. An admin of the team can give you a paid seat.

**`You are in no team there yet.`** The server takes your reviews only once you are a member of a team: accept an
invite, or ask an admin to add you.

**`Sonah could not read your team and seat from the server.`** `sonah status` could not reach the server (or it asked
Sonah to wait): the connection is unchanged. From `sonah connect`, the server did not answer whose the token is, and
the login comes from the code's exchange.

## The push hook (`sonah hook add --push`)

`sonah hook add --push` prints what it wrote, or the line to add and where, and exits `1` when you have a line to add.
Its last lines say what a push does: `Each push from this repository now leaves ...` when git runs the hook now, and
`Once git runs Sonah's push script, ...` when you have a line to add first. These stop it before it writes anything:

- **`... is in no git working tree`** or **`... is a bare repository`** (exit `2`): run it in your clone, or give it
  with `--repo DIR`.
- **`This Sonah runs from ..., in a folder that npx, pnpm dlx, bunx or yarn dlx made for one run.`** (exit `2`): the
  hook would name a folder that goes away. Install Sonah with `npm install -g getsonah`, and run `sonah hook add --push`
  with it.
- **`Sonah turns the push hook on only on macOS and Linux.`** (exit `2`).
- **`Sonah cannot read ... as its list of repositories with a push hook.`** (exit `2`, also from `sonah hook remove
  --push`, `sonah status` and `sonah doctor`): `~/.sonah/team/hooks.json` is not yours, others can write it, or it is
  not of its shape. Delete it, then run `sonah hook add --push` again in each repository.
- **`... is there, and Sonah did not write it.`** (exit `2`): a file that Sonah did not write is at
  `.git/sonah/pre-push.sh`. Move it away, then run the command again.
- **`... belongs to sonah-pr, an earlier client of Sonah Team, which already reviews each push here.`** (exit `1`): run
  `sonah-pr hook uninstall` in that repository first, so that a push is not reviewed twice.

What a push prints, on lines that start with `sonah:`:

- **`Sonah reviews <branches> in the background (sonah status).`** The hook kept the pushed branches and started their
  review. **`..., after the push that it reviews now (sonah status).`** A review of an earlier push runs, and takes these
  next. **`Sonah keeps <branches> for review (sonah status).`** Sonah could not start the review in the background: the
  next push starts it, and it takes these too.
- **`Sonah reviews at most 3 branches of one push, the newest first. It leaves out ...`** A push of more branches, such
  as `git push --all`. Push a branch on its own to have it reviewed.
- **`This computer has no connection to Sonah Team, so Sonah does not review this push.`** Run `sonah connect <code>`.
- **`... no longer takes the token of this computer, so Sonah does not review this push.`** The server answered `401`
  to a call made with the token: the review of a push, `sonah status`, `sonah hook add --push`, `sonah share`,
  `sonah fixes`, `sonah fix` or the start reminder's refresh. Run `sonah disconnect`, then `sonah connect` with a new
  code.
- **`The push hook of this repository is for ..., and this computer has its connection to ...`** You connected to
  another server since you turned the hook on. Run `sonah hook add --push` in the repository to move the hook.
- **`Sonah cannot read its connection to Sonah Team, so Sonah does not review this push.`** Run `sonah status`.
- **`Sonah moved or was uninstalled, so Sonah does not review this push.`** The node or the Sonah that the hook names is
  gone (Node or Sonah moved, reinstalled or removed). Run `sonah hook add --push` again, or `sonah hook remove --push`.
- Nothing at all: the repository is not on Sonah's list (`sonah status` shows it), `CI` is set, the push held no branch
  (a tag or a deleted branch), or `git push --no-verify` skipped the hook. A push never fails because of Sonah.

`sonah status` and `sonah doctor` print each repository with the push hook under `Push hook in <folder>, for <server>:`.
What each line means:

- **`On. Git runs Sonah's hook at each push.`**, or pre-commit's hook runs it as `pre-push.legacy`: it works.
- **`Off. lefthook moved Sonah's hook to ... .old, and nothing runs it there.`** A `lefthook install` ran after
  `sonah hook add --push`. Run `sonah hook add --push` again: it prints Sonah's command for your lefthook file.
- **`Off. ... runs no line of Sonah's, and Sonah's push script is still there.`** Another tool replaced the hook, or
  `core.hooksPath` now points to a folder with none. husky 9's install sets it to `.husky/_`, whose own `pre-push` runs
  only `.husky/pre-push`: the line names that file while it holds no line of Sonah's, or is not there. Run `sonah hook
  add --push` and add what it prints.
- **`Off. ... is Sonah's hook, but it is not executable, so git skips it.`** Run `sonah hook add --push`.
- **`Off. Sonah's push script is not in the git folder of this repository.`** Its `.git/sonah/pre-push.sh` was deleted.
  Run `sonah hook add --push` again, or `sonah hook remove --push`.
- **`Not checked. ...`** Sonah's line is in a file of another tool or of yours, and Sonah does not follow that file.
  Push a branch, and look for the line of Sonah in what `git push` prints.
- **`The node that the hook runs is no longer at ...`**, **`The Sonah that the hook runs is no longer at ...`** or
  **`The hook runs getsonah <version> at ..., and not this install of Sonah.`** Node or Sonah moved, or an nvm, volta or
  pnpm switch left the hook on another install. Run `sonah hook add --push` again in that repository.
- **`This computer has its connection to ..., so a push from here starts no review.`** The hook is for another server.
  Run `sonah hook add --push` again in that repository.
- **`... is no longer a git repository, so no push runs this hook.`** The repository was deleted or moved. Nothing runs,
  and the line needs nothing from you. A moved repository needs `sonah hook add --push` in its new place.

`sonah status` exits `1`, and `sonah doctor` lists `push_hook` among what needs attention, when a line of these needs
you: the lines that start with `Off.`, a node or a Sonah that is gone or is another install, or another server.

### The reviews of pushes and shares (`sonah status`)

`sonah status` lists the last 10 reviews of your pushes and shares under `Reviews of your pushes and shares, newest
first:` (`--all` lists every one Sonah keeps, `--json` prints them as JSON): `<owner>/<name> <branch> <commit>:
<state>`, then why, the review's page on the server, and its log, `~/.sonah/team/logs/<name>-<commit>.log`, which says
each step. A page `sonah share` put online is in that list too, in a repository with no push hook. What each state and
why means, and what to do:

- **`waiting`**: the push kept it. `Sonah does not see this commit on its branch of the remote yet.` git updates the
  remote-tracking branch once the push went through; Sonah looks for 10 minutes.
- **`queued`**: the remote shows it, and Sonah reviews another branch first; `Sonah reviews another push on this
  computer now.` (one review draws at a time, whatever its repository); `Another Sonah draws the page of the same
  change now.` (a `sonah visual` or plain `sonah` of the same range: Sonah waits for it, then uses its answers).
- **`running`**, **`uploading`**: the page is drawn, then sent.
- **`done`**: `Sonah put this review on <server>.` The `page:` line is its link.
- **`shared`**: `Sonah put this review on <server>.` You put this page online yourself with `sonah share`
  ([below](#share-a-page-yourself-sonah-share)). The `page:` line is its link.
- **`skipped`**: `Sonah found this commit on the default branch of <remote> already, so it did not review it.`; or
  `You turned off the push hook of this repository, so Sonah sent no review of this push.`: `sonah hook remove --push`
  ran while the push waited (also for another review to finish), while it was drawn, or while its review waited to be
  sent. Sonah starts no call for it from then on and sends nothing; a drawing that already ran keeps its answers in its
  folder. Turn the hook on again with `sonah hook add --push`, then push again.
- **`replaced`**: `A newer review of <branch> took the place of this one.` Sonah reviews only the newest push of a
  branch that waits, and sends only the newest review of one repository's branch that waits to be sent. Reviews that
  went to two remotes are two reviews on the server — your fork's branch and the team repository's branch of the same
  name — and neither takes the other's place. Which review is the newest is
  read from your branch and its commits: the review of the commit your branch holds on the remote, else the one whose
  commit holds the other's. So after you drop a commit and force-push, the review Sonah sends is the one of the commit
  your branch holds, not the dropped commit's. Sonah reads that branch as the remote has it, which only a push moves:
  a commit you amended or dropped here and have not pushed yet leaves the review of the pushed commit the newest. It
  reads the remote-tracking branch that your push moved, and asks the remote (`git ls-remote`, as `git fetch` would)
  when your clone keeps no such branch — a clone made with `--single-branch` or `--depth` keeps one for its one
  branch only — and when another clone of the repository on your computer has a review of that branch too, since the
  branch your own clone remembers moves with your pushes there and with no push of that clone's. A branch you pushed
  through two remotes of one repository, an `https` one beside an `ssh` one, is read through both of them, and a push
  you made with the repository's address rather than a remote's name has the remote asked too, since it moved no
  branch your clone remembers. Where that call gives no answer at all — you are offline, or the host is unreachable —
  the branch your own clone remembers answers for it. A
  review you put online with `sonah share`, of a commit that another review of a commit your branch holds is ahead of,
  or of a commit on another line than your branch's tip, replaces nothing. Where the commits of several reviews of one
  branch lie on lines that no commit of them holds and Sonah cannot read your branch on the remote (it was deleted
  there, or every push of it was made with a plain address), Sonah keeps one of them and sends it, and the rest get
  these words — the ones of another clone of the repository are left to that clone instead, and keep waiting there.
- **`pending_upload`**: `Sonah could not reach <server>.`, `<server> answered with the status <code>.` or `Another
  Sonah held the folder of this page, so sonah share sent nothing.` (a `sonah share` that waited for the page's folder
  to its own 10-minute deadline; nothing waits for that folder now). Sonah drew the review and keeps it; the next push
  of the repository, or `sonah share`, sends it, unless the server refused the token meanwhile (then after you connect
  again as the same login). A branch that another Sonah is sending now — a `sonah share` you ran in another terminal,
  or a push in another clone of the repository — is left to it: that Sonah sends its own review, and the next push or
  `sonah share` takes up what still waits.
- **`gave_up`**: `Sonah stopped this review 30 minutes after the push.` The calls stop then. A long change, a slow
  plan, or many pushes at once that wait for one another: push the branch again later, or run `sonah visual`.
- **`stopped`**: `Sonah's process ended while it ran this review.` The computer slept or shut down, or the process was
  killed. Push the branch again. A review that was being sent when its process ended (its page was drawn whole) is sent
  by the next push of the repository, with no new call: `sonah status` shows it `stopped` until then.
- **`failed`**, and why:
  - `Sonah did not see this commit on its branch of the remote within 10 minutes of the push.` Check that `git push`
    ended with no error, and push again.
  - `This computer has no connection to Sonah Team now.`, `Sonah cannot read its connection to Sonah Team.`, or `This
    computer has another connection to Sonah Team now.`: you disconnected, or connected to another server or as another
    login, after the push: Sonah starts no call for it from then on, and sends nothing. Push again. Connecting again as
    the same login (with no `sonah disconnect` first) keeps the push's review: it is sent with the new token.
  - `<server> no longer takes the token of this computer.` The server answered `401`: the token was revoked. The
    other branches of the push fail the same way, and the next push starts nothing. Run `sonah disconnect`, then
    `sonah connect` with a new code.
  - `You are in no team on <server>, so the server takes no review from you.` Join a team there, then push or share
    again.
  - `The URL of the push remote names no owner and repository, ...` A local path or a `file:` remote. Sonah Team keeps
    reviews of an owner's repository, as `git remote get-url --push origin` names it.
  - `No worktree of this repository is on this computer now, ...` The folder you pushed from, and every other worktree
    of the repository, are gone.
  - `Sonah cannot find where the change starts: the default branch of <remote> is not in this repository.` Run `git
    fetch <remote>`; `git remote set-head <remote> --auto` saves which branch is the default.
  - `Your Claude Code plan reached its usage limit, ...`, `Claude Code needs you to sign in. ...`, `Your Claude Code
    account cannot pay for the calls. ...`: the other branches of the push fail the same way, and start no call. Do
    what the line says, then push again. `Sonah could not start Claude Code. ...` and `Your Claude Code account cannot
    use claude-sonnet-5-5, ...` fail that branch only.
  - `Sonah could not draw the page of this change: <code>.` A call failed (`timeout`, `provider_busy`, `call_failed`,
    `output_limit`) or the drawing failed (`visual_failed`). Push again: the answers that came back are reused.
  - `This review is over the 25 MB that an upload can hold, ...` Review a smaller range with `sonah visual`.
  - `<server> refused the upload with the status <code> (<error>).` The log names the status. Check `sonah status`'s
    connection lines.

Then, from the server's last answer, `<n> comments wait for you on <owner>/<name>.`: the review comments that wait for
you there. `sonah status` makes no call for the reviews or the comments; only its connection lines ask the server.

## Share a page yourself (`sonah share`)

`sonah share` puts a page that Sonah already drew here on the Sonah Team server you connected to. It prints its
problems in fixed words, then a `Fix:` line, and never the token. When it works it prints `Sonah sends the page in
<folder>.`, then `Sonah put this review of <branch> on <server>.` and `page: <the link>`, and exits `0`.

A usage error prints `sonah share: <the problem>.` and the usage, and exits `2`: an unknown option, an option given
twice, an option with no value (`--dir`, `--branch` and `--repo` each take one), or an argument that is not an option
(`sonah share` takes none).

These exit `2`, and nothing is sent:

- **`This computer has no connection to Sonah Team now.`**, **`Sonah cannot read its connection to Sonah Team.`** or
  **`<server> no longer takes the token of this computer.`** Sonah reads the connection first, so with none it reads
  nothing of your repository. Run `sonah connect <code>`, or `sonah status`, or `sonah disconnect` and then
  `sonah connect` with a new code.
- **`This folder is in no git repository.`** Run it in your clone, or name one with `--repo DIR`.
- **`<folder> holds no finished page of a commit in this repository.`** The `--dir` folder holds no page that a run
  finished, or its commit is not in this repository (a page of another clone, or of a commit that is gone). Give
  `--dir` a folder that `sonah visual` wrote for this repository.
- **`No branch points at <commit>, and Sonah Team keeps each review under its branch.`** The page's commit is on no
  branch here (a detached `HEAD`, or the branch moved on). Name the branch with `--branch NAME`.
- **`Sonah Team takes no branch of that name.`** The `--branch` name is one git or the server refuses. Give a branch
  name that git takes.
- **`The URL of the push remote names no owner and repository, ...`** A local path or a `file:` remote. Sonah Team
  keeps reviews of an owner's repository, as `git remote get-url --push origin` names it.
- **`Another Sonah draws or reads the folder of this page now.`** A `sonah visual`, a plain `sonah` or the review of a
  push holds the page's folder. Run `sonah share` again once it ends. If the message stays while no other Sonah runs,
  delete `draw.lock` and each `draw.lock.claim-` file in that folder. Sonah says the same when the folder is still
  held 10 minutes later: it sent nothing, `sonah status` shows the review `pending_upload` with `Another Sonah held the
  folder of this page, so sonah share sent nothing.`, and the next push of the repository, or `sonah share`, sends it.
  It says the same again when another Sonah is already sending this review, where no lock is held at all: `sonah
  status` shows that review `uploading` under the other Sonah's process, which sends it, so run nothing again.

These exit `2` as well, after Sonah sent the page. They are the words of a push's review, which `sonah share` says
too, and each names what to run.

- **`You are in no team on <server>, so the server takes no review from you.`** Accept an invite there, or ask an
  admin to add you, then run `sonah share` again.
- **`<server> no longer takes the token of this computer.`** The server answered `401` to the upload: the token was
  revoked. Sonah marks the connection refused, so nothing more is sent, by `sonah share` or by a push. Run
  `sonah disconnect`, then `sonah connect` with a new code, and run `sonah share` again.
- **`This computer has another connection to Sonah Team now.`** You connected to another server, or as another login,
  while the page was being sent. Run `sonah share` again.
- **`This review is over the 25 MB that an upload can hold, so Sonah did not send it.`** Draw a smaller range with
  `sonah visual`, then share that page with `--dir`.
- **`<server> refused the upload with the status <code> (<error>).`** The log in `~/.sonah/team/logs/` names the
  status. Check what `sonah status` says about the connection.
- **`Sonah could not reach <server>.`** or **`<server> answered with the status <code>.`** Sonah tried again after 5
  and 20 seconds and gave up 10 minutes after you ran it. The review is kept, and `sonah status` shows it
  `pending_upload`: run `sonah share` again, or push the branch, and it is sent with no new call.

This exits `3`:

- **`Sonah could not draw the page of this change: visual_failed.`** Sonah could not read the folder's files as a
  finished page while it held the folder's lock. Draw the page again with `sonah visual`, or name another folder with
  `--dir`.

This exits `1`:

- **`Sonah has no finished page of <commit>, the commit at HEAD.`** Nothing drew the page of this commit yet, or every
  folder of it is unfinished. Run `sonah` or `sonah visual` here, then `sonah share`; or name a folder with
  `--dir DIR`. Sonah looks in the folders it keeps for this working tree under `~/.sonah/visual/` and in the pages that
  the reviews of your pushes of this repository drew. A page you drew with `--out DIR` is found through `--dir` only.

## Take up a comment (`sonah fixes` and `sonah fix`)

`sonah fixes` lists the review comments of your team that wait for you, and `sonah fix <comment id>` takes one of them
to Claude Code. Both print their problems in fixed words, then a `Fix:` line, and never the token.

`sonah fixes` prints a heading a repository, then each comment with who wrote it, how, where, the item, the first line
of their words and `sonah fix <id>`; `(Claude Code is on it)` marks one you already started. With none it prints
`No comment waits for you on <owner>/<name>.` It exits `0`, and `2` for these:

- **`No remote of this clone names an owner and a repository. No clone whose push hook is for <server> names one
  either.`** Sonah Team keeps reviews of an owner's repository, as `git remote get-url --push origin` names it. Run
  `sonah fixes` in your clone, or name one with `--repo DIR`. Outside a clone, Sonah asks for the clones whose push
  hook is for the server this computer is connected to (`sonah hook add --push`); a clone you hooked while connected
  to another server is left out, as a push of it is, and `sonah status` shows each hook's server.
- **`<server> gave a list of comments that Sonah cannot read.`** The answer is not of its shape, or it is of another
  repository. Update Sonah, then run `sonah fixes` again.
- **`This computer has no connection to Sonah Team now.`** or **`<server> no longer takes the token of this
  computer.`** Run `sonah connect <code>`, or `sonah disconnect` and then `sonah connect` with a new code.
- **`<n> of the entries of the server are not of their shape, so Sonah leaves them out.`** This one line goes to
  standard error and the rest of the list is printed: the other comments are shown and `sonah fixes` exits `0`.
- **`<server> answered with the status <n> (<code>).`** Any other refusal of the server, of either command. With
  `403 (not_member)` you are in no team on it: `Open <server> and join a team there.` Otherwise the `Fix:` line names
  `sonah status`, which shows the server of this connection. Neither command takes a `--server`, so another server is
  a `sonah disconnect` and a `sonah connect`.

`sonah fix` shows the whole prompt and where it goes, then asks `Send it? (y)es, (e)dit, (n)o: `. It exits `0` once
Claude Code ran and ended (Claude Code's own exit code is not passed through), and `1` when you said no
(`Sonah sent nothing.`). It also exits `0`, with `This fix ended as <state>: nothing to do.`, when the comment's fix is
resolved, superseded or closed on the server.

These exit `2`, and nothing reaches Claude Code:

- **`That is not a comment id: an id starts with c_ and has 16 more characters.`** Copy the id from the comment's page
  on Sonah Team.
- **`This terminal runs inside Claude Code: it has CLAUDECODE in its environment.`** Claude Code does not start inside
  another session. Run `sonah fix` in a terminal of its own.
- **`sonah fix shows you the prompt and asks before it sends it, and this is not a terminal.`** Run it in a terminal,
  not in a pipe or a script.
- **`Sonah found no claude on PATH.`** Install Claude Code, then run `sonah fix` again.
- **`No comment <id> waits for you on <server>.`** The server answered `404`: the id is not yours, or its comment is
  gone. Open the review page and copy the id of a comment that waits for you.
- **`Comment <id> is not one that a fix can answer.`** The server answered `409`: only a question, an override's note
  or a reply by someone else opens a fix. A Confirm and a Not right decide nothing for your agent.
- **`<server> gave an answer that Sonah cannot read (<field>).`** The field named is not of its shape. Nothing runs,
  and nothing of that answer reaches the prompt. Update Sonah, then run `sonah fix` again.
- **`<folder> is in no git repository.`** Run it in your clone of the review's repository, or name one with
  `--repo DIR`.
- **`This clone is not of <owner>/<name>.`** No remote of this clone names the review's repository. Run it in your
  clone of it, or name one with `--repo DIR`. With no `--repo`, Sonah also looks in the clones with the push hook.
- **`No worktree of this clone has <branch> checked out, and Sonah never switches a branch of yours.`** Run
  `git switch <branch>` in that clone, or add a worktree for the branch, then run `sonah fix` again.
- **`More than one worktree has <branch> checked out: <folders>.`** git allows it with `git worktree add --force`, and
  Sonah picks none of them. Remove one of those worktrees.
- **`More than one recording carries session <id>: <files>.`** More than one recording of the session that wrote the
  change is here, so Sonah reads none of them. Where they are in two Claude Code folders, name one with
  `--config-dir DIR`, and Sonah says so; where one folder holds them all (the session was resumed from another folder,
  or a project folder was renamed), no folder picks between them and `sonah fix --new` is the way on, in a new
  session.
- **`<file> is there, and Sonah cannot read it as a launch record.`** `~/.sonah/team/fixes/<comment id>.json` holds
  something else. Move that file away to start this fix again.
- **`Claude Code did not start (<code>).`** Sonah said yes to your yes and could not run `claude`. Check that `claude`
  runs in this terminal.

These two lines are not refusals:

- **`The commits of <folder> carry no Agent-Session line, so Sonah Team cannot mark this fix pushed.`** The commit
  link of `sonah hook add` is off in that worktree, and the line is what the server reads to see that your fix was
  pushed. The line names the worktree of the fix, which is not always the folder you ran `sonah fix` in, and gives it
  to the command: run `sonah hook add --repo <folder>`; the fix itself goes on. Sonah reads the link as your own git
  reads it, so a `core.hooksPath` from any of your git config files counts.
- **`Sonah cannot tell whether the commits of <folder> carry an Agent-Session line.`** … **`Look for it in git log
  after this fix.`** Sonah's line is in a hook file that another tool or you own (husky, lefthook, your own
  `prepare-commit-msg`), which is what `sonah hook add` prints for you to add, and Sonah cannot tell whether that file
  reaches it. `sonah doctor` says the same of this folder, and asks nothing of you: look for the line in `git log`
  after this fix.
- **`Sonah cannot tell whether the commits of <folder> carry an Agent-Session line.`** … **`Run sonah hook add --repo
  <folder>, and add the line it prints.`** The hook git runs in that worktree is another tool's and holds no line of
  Sonah's, so nothing of Sonah's runs at your commits. This is where `sonah hook add` ends when you did not add the
  line it printed. `sonah doctor` asks for the same line.
- **`Sonah could not tell the server that this fix started (<kind>). The fix goes on.`** The call that tells your team
  you took the comment up did not get through: no answer in five seconds, or an answer that was not a yes (`<kind>`
  says which). Claude Code starts all the same, and your next push still marks the fix pushed. A `401` here does not
  mark the connection refused; `sonah status` says whether the server still takes the token.

## The Claude Code start reminder (`sonah remind`)

`sonah remind on` adds one SessionStart entry to Claude Code's `settings.json` (in `CLAUDE_CONFIG_DIR`, else
`~/.claude`), and `sonah remind off` removes it. Its lines:

- **`<file> is not plain JSON, so Sonah leaves it as it is.`** Your settings hold a comment, a trailing comma, a key
  given twice, or a `hooks` that is not an object, and Sonah writes only a file it can read back exactly. `on` prints
  the entry: add it to the file's `hooks`, in its `SessionStart` list. `off` says which hook to remove. Both exit `1`.
- **`Claude Code's folder <folder> is not there.`** Claude Code makes it the first time it runs. Start Claude Code once,
  then run `sonah remind on` again (exit `1`). Sonah makes no folder of Claude Code's.
- **`<file> has the reminder of sonah-pr, an earlier client of Sonah Team.`** Two reminders would show the same comments
  twice. Run `sonah-pr remind off`, then `sonah remind on` (exit `1`). `sonah remind off` never removes sonah-pr's.
- **`Sonah turns the reminder on only on macOS and Linux.`** and **`This Sonah runs from <path>, in a folder that npx
  ... made for one run.`** The entry names the Sonah that runs it, and that folder goes after the run. Install Sonah
  with `npm install -g getsonah`, then run its `sonah remind on` (exit `2`).

**Claude Code shows no message.** The reminder shows comments only in a folder whose git remotes name a repository that
Sonah has a list of (from `sonah fixes`, a push's review, or the reminder's own refresh), and only those nobody started
Claude Code on yet. It shows nothing before `sonah connect`, after the server refuses your token (`sonah status` says
so), or when the list is another connection's. A list is asked for again at most once a minute for each repository, in
the background, so a comment written a moment ago shows at the next start after that. Run `sonah fixes` to see the
list now.

**`sonah status` says the reminder runs a node or a Sonah that is no longer there, or another install.** The entry names
the node and the Sonah that ran `sonah remind on`, and a node upgrade, a version manager's switch or a new install moves
them. Claude Code then runs a file that is gone at each start. Run `sonah remind on` again to point it at this install,
or `sonah remind off`. Sonah never names a node of fnm's folder for one shell (`fnm_multishells`), which goes with that
shell.

**`sonah status` says the reminder reads another Sonah folder.** The entry names the `SONAH_HOME` of the shell that ran
`sonah remind on`, and Claude Code's start reads that folder's connection and comments, not the one this command reads.
Run `sonah remind on` from the shell whose connection you want it to use. An entry made with no `SONAH_HOME` names no
folder: it reads the `SONAH_HOME` that Claude Code runs with, else `~/.sonah`, so `sonah status` says nothing of it.

## Exit codes

This is the one list of Sonah's exit codes. The exit code reports only whether Sonah's own review ran, never a
judgment of the agent's work: a review with findings that ran to the end exits `0`.

| Code | Meaning |
| --- | --- |
| `0` | The command did its job: Sonah's review ran to completion, whatever it lists; or `sonah review --background` printed its one line, whatever it says (when the line says the review started, it runs on, and its log says how it ended). The hidden commands that a hook or a push starts, `sonah pre-push`, `sonah push-run`, `sonah remind-hook` and `sonah remind-refresh`, always exit `0` |
| `1` | Sonah's review ran but did not complete (a part of the session was not reviewed, or, with `--code-pass` on the command line, the code step did not cover the whole change and finish its checks; the output says which and why); or no session was found for this repository, or `--session` got an empty id; or `sonah doctor` found something to fix; or `sonah hook add` could not turn the commit link on by itself and printed the line for you to add; or `sonah skill add` or `sonah skill remove` found a file that Sonah did not write and changed nothing; or `sonah sessions --commits A..B` found no commit that names a session, or `sonah sessions --github OWNER/REPO --pr N` found none in a list that GitHub gave whole; or `sonah decision` refused an answer (the reason is printed); or `sonah connect` heard no from you, or `sonah connect`, `sonah disconnect` or `sonah status` left a token for you to revoke, found a connection file it cannot read, or found that the server no longer takes the token (below); or `sonah hook add --push` printed a line for you to add, or found an earlier client's push hook; or `sonah connect` or `sonah status` found a push hook that needs you; or `sonah status` found a start reminder whose entry needs you; or `sonah share` found no finished page of the commit at `HEAD`; or you answered no to `sonah fix`; or `sonah remind on` printed the entry for you to add, found no Claude Code folder, or found the earlier client's reminder; or `sonah remind off` found a settings file that is not plain JSON. A code step that ran by default or by your setting never sets it by itself. |
| `2` | Invalid arguments, or a problem Sonah names with its fix (a missing recording, an existing output file, a wrong model, a range git cannot list, a pull request GitHub does not answer for, or one whose list GitHub did not give whole and whose listed commits name no session; for `sonah connect`, no terminal to ask in, or a code, token or server that does not answer as it should; `sonah disconnect` with no connection; for `sonah hook add --push`, a Sonah run by npx, pnpm dlx, bunx or yarn dlx, Windows, or a list of repositories it cannot read; for `sonah visual` and plain `sonah`, another Sonah drawing the same page into the same folder, `folder_in_use`; for `sonah status`, an option other than `--json` and `--all`; for `sonah share`, no connection, a folder in no git repository, a `--dir` that holds no finished page of this repository, no branch at the page's commit, a `--branch` name that git refuses, a push remote that names no repository, a page folder another Sonah holds, or a server that did not take the page; for `sonah fixes`, a clone that names no repository, a list the server gave that Sonah cannot read, or any refusal of the server; for `sonah fix`, a word that is no comment id, a terminal inside Claude Code or none, no `claude` on PATH, an answer of the server that is not of its shape, a comment the server does not know or cannot answer, any other refusal of the server, no worktree or more than one with the review's branch, more than one recording of the session, a launch record Sonah cannot read, and a `claude` that did not start; for `sonah remind on`, Windows or a Sonah run by npx, pnpm dlx, bunx or yarn dlx, which `sonah remind off` does not check) |
| `3` | Sonah's review failed: it could not run, it crashed, or it was stopped (Ctrl-C while it was asking the model, or one of your optional stops); or `sonah decision` could not record an answer; or `sonah skill add` or `sonah skill remove` could not write or delete its file; or `sonah share` could not read the page's folder as a finished page (`visual_failed`) |
| `130` | Ctrl-C at another moment (while it reads the recording, plans or writes the page): it ends the usual way, and the same command starts again. Ctrl-C while `sonah review` draws the graphs page (D219) stops that page only: the review writes its page and exits with its own code. Ctrl-C at the prompt of `sonah connect --token` |

`sonah connect`, `sonah disconnect` and `sonah status` (D224) use the same codes: `0` when they did their job (the
connection is kept, revoked and deleted, or shown, also when there is none); `1` when you answered no, when a token is
left live for you to revoke, when the connection file cannot be read, or when the server no longer takes the token; `2`
for invalid arguments or a problem they name with its fix (no terminal for the question, a code or token the server
refuses, a server Sonah could not reach, no connection for `sonah disconnect`); `3` when they failed; and `130` after
Ctrl-C at `sonah connect --token`'s prompt. With D225, `sonah connect` also exits `1` when the push hook it turned on
needs you to add a line, and `sonah status` when a repository's push hook needs you.

`sonah hook add --push` and `sonah hook remove --push` (D225) use the same codes as `sonah hook add`: `0` when the push
hook is on or its files are gone, `1` when it printed a line for you to add or found an earlier client's push hook, `2`
for invalid arguments or a problem it names. The hidden `sonah pre-push`, which the hook runs at each push, always exits
`0`, also when Sonah fails inside it, so that a push never fails because of Sonah. So does the hidden `sonah push-run`
(D227), the review in the background that `sonah pre-push` starts: it prints nothing, and each review's state in `sonah
status` and its log say how it ended. `sonah status --json` and `--all` (D227) exit as `sonah status` does.

`sonah visual` uses the same codes: `0` when the page is written, `1` when it ran and answers are still needed, `2` for
invalid arguments or a problem it names with its fix (a call that stopped on your sign-in, plan or usage included, and
`folder_in_use`: another Sonah drawing the same folder), and `3` when it failed. Ctrl-C stops it; the same command goes on from the answers it stored.

`sonah share` (D228) uses the same codes: `0` when the server took the page (its link is printed); `1` when Sonah has
no finished page of the commit at `HEAD` (run `sonah` or `sonah visual`, or name a folder with `--dir`); `2` for
invalid arguments, for no connection or one Sonah cannot read, for each problem it names with its fix (no git
repository, a `--dir` that holds no finished page of this repository, no branch at the page's commit, a `--branch`
name git refuses, a push remote that names no repository, a page folder another Sonah holds) and for a server that did
not take the page (no answer, a refusal, no team, or over 25 MB); and `3` when it could not read the page's folder as
a finished page. It makes no model call, so no sign-in, plan or usage limit stops it.

`sonah fixes` and `sonah fix` (D229) use the same codes. `sonah fixes`: `0` when it printed the list, whatever it
holds, and `2` when no repository is named, when the list is not of its shape, or when the server refuses. `sonah fix`:
`0` once Claude Code ran and ended, and `0` for a fix the server shows as resolved, superseded or closed; `1` when you
said no; `2` for invalid arguments and for each refusal above; `3` when Sonah itself failed. Claude Code's own exit
code is never passed through, since it could collide with Sonah's own `2` and `3`. Only `sonah fix` reaches a model,
and only through the Claude Code that it starts after your yes.

`sonah remind on` and `sonah remind off` (D230) use the same codes: `0` when the entry is on, updated, already there,
removed or not there; `1` when the settings file is not plain JSON (`on` prints the entry for you to add), when Claude
Code's folder is not there, or when the earlier client's reminder is there; `2` for invalid arguments, on Windows, or
from a folder made for one run; `3` when Sonah failed. `sonah status` exits `1` when the entry runs a node or a Sonah
that is gone, or another install, or reads another Sonah folder. The hidden `sonah remind-hook`, which Claude Code runs at each start, and `sonah
remind-refresh`, which it starts in the background, always exit `0` and print nothing but the reminder's one line, so a
start of Claude Code never fails because of Sonah.

Plain `sonah`, with no command, in a terminal runs `sonah visual` and exits with its code. After a problem with its fix
(`2`), it adds a line that points to `sonah --help`. In a pipe or a script, it prints the usage and exits `2`.

The graphs page that `sonah review --format html` draws (D219) never changes the review's exit code: when it fails or
you stop it, its lines say so, and the review exits as it would without it.

## Still stuck

Open a [GitHub issue](https://github.com/getsonah/sonah/issues) with the message you saw, the exit code and the output of
`sonah doctor --no-probe` (read it first: it prints the folders it searched, which include your home folder's path).
Never paste a session recording, a Sonah page or a report: they can hold secrets. A security problem goes privately,
as [SECURITY.md](../SECURITY.md) describes.
