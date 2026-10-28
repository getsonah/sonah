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
  them to your repository), `--max-turns` (their turn budget) and `--json-schema` (their structured answer). Doctor
  checks them once, with no model call. Run `claude update`, then `sonah doctor` again; or turn the code step off with
  `sonah config code-pass off` (or `--no-code-pass` for one review). `Claude code-step options: not checked` means
  `claude auth status` could not be read: fix the sign-in first.

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
: The review runs in the background and can take minutes to about an hour on a long session. Its line names the page and
  the log. The log holds what the review printed, including its last line: a review that could not complete says why
  there, with its fix. With `--no-open`, Sonah writes the page and does not open it. A review of the same recording that
  `--background` started and that still runs, or any review of it while it asks the model, is said in the first line
  instead (`review_in_progress`), and no second review starts.

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
  | calls that did not answer (the code review, the repair of the code review, a finding's check, the check of its questions, or its item-by-item check) | An agent ran out of its turns (the review agent has 150, a finding's check 60, the other checks 80) or its time (45 minutes for the review agent, 30 for a check), its answer never matched its contract, or the call failed (sign-in, usage limit, network). Run the same command again: while the repository is unchanged, the answers that came back are reused and only these are asked again. |
  | calls that Sonah did not make, because their inputs were too large to send (its item-by-item check) | A batch of the item-by-item check did not fit the code review's size bound. Its items are counted in the lines below. Running again will not change it. |
  | a finding withheld because "its check did not finish (the check named a path that more than one repository of the change holds, so Sonah could not tell which file it means)", or open questions published unchecked, in a session that worked in several worktrees of one project | Each worktree holds the same files, so a path relative to one of them names a file in each, and Sonah does not guess which one the check meant. It asks the check once more to name the file by its absolute path. Since 0.3.0-beta.9, when more than one repository or folder holds the change, the code review is shown every file by its absolute path, and every agent of it is asked for absolute paths from the start. |
  | of your asks, asks that an agent wrote into a helper's brief, asks that Sonah could not trace to your own words, statements that the agent wrote into a file, or decisions not to act, which the code review's item-by-item check did not examine in a way that Sonah could use | After the code review, Sonah asks it to check each of these items against the code, in calls of 30 items, at most 4. Each line counts the items that the check left out, answered as not examined, or answered in a way that Sonah could not use (a quote it did not find word for word, an answer out of its shape, or an item past the 4 calls). Sonah calls an ask yours only when the recording shows it in your own words. The count says nothing about the code review's findings: a published finding can still concern a counted item. A call that did not answer leaves its items counted: run the same command again. A session with more than 120 items always shows a count, because of the limit of 4 calls. |
  | The code review did not answer, so Sonah counts none of them as seen | The review agent's call failed before Sonah recorded a turn or a tool call of it (sign-in, usage limit, network), so Sonah holds no sign that it read the change. Run the same command again. |
  | paths that the session wrote to, which Sonah counts but did not review | Not a gap in the change: these writes lie in a coding agent's home folder (its memory or settings), in Sonah's own folders, under a name from your home folder, or outside the folders that the code review could read: a folder that no git repository holds (the page lists those folders, see "folders that no git repository holds" below), or a git repository outside your working directory where none of the files the session wrote is there now with a change. Sonah counts them and does not review them. (A file that the session wrote with no change in a repository inside your working directory is not counted here: it is no file of the change, as in your own repository.) Since 0.3.0-beta.5, a file the session wrote in another git repository that is there now with a change is part of the change instead (see the next entry but one). |
  | The repository changed while the code review ran | A file of the repository changed between the start of the review and the end of the code step, so a file it quotes may differ now. Leave the repository alone while a review runs, then run the same command again. |
  | files whose change the code review did not see (binary, too large for one call, changed after the session's last recorded edit, not readable) | A limit of the change itself, not a failure: running again will not change it. |
  | files whose change the code review did not see (in another repository, written by an agent from another working directory, outside the working directory) | A report from before 0.3.0-beta.5: the session wrote these files, but they were not part of the change that Sonah gave the code review. Since 0.3.0-beta.5 a file in a git repository is: run the review again to have it reviewed. A file in a folder that no git repository holds is listed by its folder, not reviewed. |
  | In a folder, the change runs from the session's start commit there … / the change is the edits that the session recorded; N of them lie in a folder | Not a gap: the session also wrote files in another git repository (a sibling worktree, a repository nested in yours), and Sonah reviews them there (since 0.3.0-beta.5). The change there runs from the commit where that repository stood when the session began, by the same rule as in your working directory, or, when that repository's history began during the session, it is the edits that the session recorded. A repository counts only when a file the session wrote there is there now and differs from that commit. The code review reads each such repository too. Each file says where it lies in the list of files. When another repository holds files of the change, the line about where the change runs from in your working directory begins "In the working directory's repository". (A report made before this rule was narrowed can also say this of a folder that no git repository holds.) |
  | In a folder, Sonah did not review files that changed outside this session's recorded writes. They are outside the evaluated session / In a folder, files that changed outside this session's recorded writes are outside the evaluated session | In another git repository the session wrote to, these files differ from that repository's commit, but no write that the recording shows touched them, and the file system's modification time does not place their last change while the session ran: another agent's or your own work there, before or after the session. Sonah names them (the first 10, then how many more). As in your working directory, they are outside the evaluated session: with a change of the session's own to review, Sonah gives them to the code review apart from it if there is room in its input (the second line), else it does not review them (the first). A file there that changed while the session ran is part of the change instead, marked as one that no recorded edit wrote. |
  | The session wrote N files in folders that no git repository holds. Sonah lists them and did not review them | Not a gap in the change: these files lie outside every git repository (a notes folder, an agent's scratch folder, your home folder). Sonah does not review them, its agents do not read those folders, and they do not change the coverage. It names each folder (the first 10, then how many more) with how many files the session wrote there; the footer counts them with the other paths it did not review. |
  | writes of the session name paths with an unexpanded shell variable or command substitution | A shell command of the session wrote to a path such as `$DIR/notes.md` or `$(pwd)/x.md`. The recording holds the command as typed, not what the shell expanded it to, so Sonah cannot tell which file it wrote. It counts these writes apart and does not review them. A path that a file tool (Write, Edit) wrote is taken as it is spelled, even with a `$` in its name, and so is a path that, spelled as recorded, names a file or folder that is there (a relative path in the session's working folder, an absolute path where it points), or a file that git lists as changed since the start commit, such as one the session deleted (the recording keeps no quotes: a route file `app/routes/users.$id.tsx` that a shell command wrote is a file of the change). |
  | Sonah does not yet see every edit made by helper agents or by scripts after a cd | The session ran a shell command. A script can write files after a `cd` into another folder, where Sonah cannot place its writes, and Sonah does not yet read every helper agent's own edits. So the change the code review had can miss some of them: review such edits yourself. Shown in the code review's part of What Sonah could not check, on the page and in the .md (since 0.3.0-beta.6 no longer on the terminal's code review line). |
  | Sonah showed the code review every changed line of N files in K calls | Not a gap: since 0.3.0-beta.9, a change larger than one request holds (about 400 KB of lines) is split by file into parts, each sent in its own call with the whole change's list of files. "It could not show M files" names the files that no call showed, and why. |
  | files whose change Sonah left out of the code review's input for room | A call's input had no room left for these files beside the rest of it (the change's list of files, your words, the rule files, the commands). The agent was told to read those files itself. Before 0.3.0-beta.9, a change larger than one request holds (about 400 KB of lines) also left its largest files out; now each part of it has its own call. |
  | files changed after the session's last recorded edit | Not a gap: a file the session wrote changed again afterwards (a formatter, a script, your own edit). Its change from where the session started was shown and reviewed, but some of its lines now may not be the agent's. |
  | Sonah did not review files that changed outside this session's recorded writes | These files differ from the commit where the session started, but no write that the recording shows touched them, and the file system's modification time does not place their last change while the session ran: a later commit, your own edit, or a file already changed before the session began. They are outside the evaluated session, and the line says so. Sonah names them (the first 10, then how many more). This line shows when no code review ran or answered: with a change of the session's own to review, Sonah gives them to the code review apart from it if there is room in its input, and the next row's line shows instead. A file that a command of the session deleted or moved (a moved file keeps its old time, and a deleted file has none), or changed and that changed again later, is among them too: review those yourself. |
  | files that changed outside this session's recorded writes are outside the evaluated session | The same files, given to the code review after the session's own change and apart from it; the next line says what the code review saw of them (left out first when the request is too large). A finding about one, and a question from such a finding, reads "It is about code outside the evaluated session." and names none of your asks or the agent's claims; the count line counts them. A broken contract, a broken rule or a contradicted claim that a line the session changed causes is the session's finding even when it shows in such a file, so it has no such marker. They are not the session's change: the coverage line, the footer and the header count only the session's own files, and a check of a finding about them that fails or is too large to send does not make the coverage short. |

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
  | the recording shows no write of the session that could have changed a file | No write that the recording shows could have changed a file, and the session ran no shell command. Sonah does not yet read every helper agent's own edits: if a helper agent changed files, check them yourself with `git status` and `git diff` in that repository. |
  | Sonah found no write of the session that it can read. The session ran shell commands, and Sonah does not yet see what a script writes. Check each repository that they could change, with git status and git diff. To review that code, run sonah review again with --code-repo <the repository's folder> | No write that the recording shows could have changed a file, but the session ran shell commands. A script can change files that no recorded write names: a Python or shell script that writes a path it builds, or a write after a `cd`. Sonah does not yet see those writes, so the code review had none of them to review, and the session can still have changed files. Check each repository that those commands could change with `git status` and `git diff`. To have that code reviewed, run `sonah review` again with `--code-repo` and the folder of that repository (once for each repository): see "`--code-repo`" below. |
  | Sonah found no write of the session that it can read, and no file of the change in the repositories that you gave with --code-repo. The session ran shell commands, and Sonah does not yet see what a script writes. Check each repository that they could change, with git status and git diff | As the row above, but you gave `--code-repo`, and Sonah found no file of the change in those repositories: no file there that a recorded write could have changed, and none whose last change came while the session ran. A file that the session changed and that changed again after it, or whose last change kept an older time (a copy, a move), is outside the evaluated session: the line after the repository's line names those files. When the repository that you gave holds the working directory, Sonah reads it by the working directory's own rule, so outside the working directory a file that a script changed stays unread, and the report says so. Giving the repository again does not change this. Check each repository that those commands could change with `git status` and `git diff`. |
  | among the changed files in the folder, Sonah found none that the session wrote | The session's writes lie where the code review does not read (a coding agent's home folder, Sonah's own folders, a name from your home folder, a folder that no git repository holds), or no longer differ from where the session started. Check those files yourself. |
  | Sonah found no changed file in the folder | No file that the session wrote differs from where the session started, in the folder that Sonah names or in another git repository that the session wrote to. If the session changed files in a way that Sonah does not yet see (a script, a helper agent), check them yourself with `git status` and `git diff`. |
  | Sonah could show the code review no changed lines of the change | Each file of the change is binary, deleted with no lines, or outside the change that Sonah can show. Review those files yourself. |
  | the code review's input was too large to send | The change is larger than one request holds. Running again will not change it. |
  | the code review did not answer | Run `sonah doctor`, then the same command again. |
  | the code review saw none of the files of the change | The code review answered without seeing any file. Run the same command again. |
  | this review was saved by an earlier version of Sonah, which did not record why | The review was saved before Sonah kept a record of the code review's input, so its record does not say why no request was made. Run the review again to see why. |

  Running the review from another folder does not change the reason: the code review reads the folder that the
  recording names as the session's working directory (and the other git repositories that the session wrote to), not
  the folder that you run `sonah review` in. To point the code review at another repository, add `--code-repo` with its
  folder (below).

**`--code-repo DIR`** (the code review of a repository that the recording does not show the session changing)
: A session can change a repository in a way that no recorded write shows: a script that writes the paths it builds,
  a write after a `cd`, or a session that started in a folder that no git repository holds. Run `sonah review` again
  with `--code-repo` and the folder of that repository (any folder in it; give the option once for each repository).
  Sonah reads it as if the session had written there: its change runs from the commit where it stood when the session
  started (the same rule as the working directory's), and holds the files that a recorded write could have changed
  there and the files whose last change came while the session ran (each marked as written by no recorded edit). The
  other files that differ there are outside the evaluated session, as in your own repository. When the repository holds
  a file of the change, the code review and its checks read that folder too. The page and the .md name the repository
  with its count of files. "The change holds 0 files there" means that Sonah found no file there whose last change came
  while the session ran. A file that the session changed and that changed again after it, or whose last change kept an
  older time (a copy, a move), is outside the evaluated session: the line after it names those files. Giving the
  repository that holds the session's working directory changes nothing that Sonah reads, since Sonah reads it by its
  own rule already (in a working directory that is a folder of a larger repository, a file that a script changed
  elsewhere in it stays unread); the page and the .md say that you gave it, and how Sonah reads it. When no code was
  reviewed after all, the reason says what Sonah found in the repositories that you gave (the row above), and does not
  tell you to give them again. Without `--code-repo`, nothing changes.

**`Review could not complete: code_repo_not_found.`** (exit 2)
: A folder that you gave with `--code-repo` does not exist, or is a file. Nothing was read or sent. Give the folder of the
  repository that the session changed.

**`Review could not complete: code_repo_not_git.`** (exit 2)
: A folder that you gave with `--code-repo` is in no git working tree (or is inside a `.git` folder, or a bare
  repository). Nothing was read or sent. Give the folder of a git repository that the session changed, or any folder in
  it.

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
  the stored answers of each such check, so the next run asks it again and reuses every other stored answer. The exit
  code does not change, because every review window finished.

**`Sonah's review: ... code review had no change to review, because ...`**
: The code step found no file of the session's change to review, so it made no code-review call. The words after
  "because" say why, as the page does: the recording shows no write of the session that could have changed a file
  (and the session ran no shell command); Sonah found no write of the session that it can read, and the session ran
  shell commands, whose writes Sonah does not yet see (a script can still have changed files: check each repository
  that those commands could change with `git status` and `git diff`, and add `--code-repo` with its folder to review
  it); Sonah found no changed file here that the session
  wrote (its writes lie in a coding agent's home folder, in Sonah's own folders or under a name from your home folder,
  or no longer differ from where the session started); or Sonah found no changed file here. "Here" is the folder that
  the recording names, not the folder that you run the review in, so running the review from another folder does not
  change it. Files that differ but changed outside this session's
  recorded writes are outside the evaluated session: they are named on the page (the table above says what that line
  means), and with no change of the session's own to review Sonah does not review them.

**`Sonah's review: ... code review covered the whole change, but its item-by-item check did not examine every item ...`**
: The code review saw the whole change, and the checks of its findings and questions ran, but its item-by-item check
  left items that it did not examine in a way that Sonah could use. Under "What Sonah could not check", the page and the
  .md count them by kind, and name a call of that check that did not answer (the table above says what each line
  means). On by default or by your setting, this does not change the exit
  code; with `--code-pass` on the command line the review reads as not complete (exit 1).

**`The code review found that it holds in the code`** (a note on a "Not checked" ask under "Your prompt")
: The session review could not check this ask in the recording, and the code review's item-by-item check found in the
  code that it holds. The note names the lines where Sonah found each quote of that check word for word in the files as
  they are now. The row's own fold holds the session review's reason and "Sonah did not check whether it holds." (since
  0.3.0-beta.6; before, both were on the row). Open the file at those lines to check it yourself. Sonah did not check
  the code review's verdict, so the ask still reads "Not checked", and every count (the count line, the "Sonah did not
  check" line in What Sonah could not check, and the pull request comment) counts it as not checked. The code can also do an ask that the agent did not do in this session. An ask that
  the code review ties to a finding, a question or a withheld finding has no such note and keeps its line. Neither does
  an ask that one of Sonah's own checks speaks against or did not settle (its cited run or write did not run to its end
  or Sonah could not read its end, Sonah's check refuted or did not settle its status, or Sonah did not find the part
  that the session review said is missing), nor one for which the code review quoted the files as they were at the
  session's start commit.

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
: Sonah never shortens the header, the count line, the counts of your prompt or its asks that are not done. It keeps
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

## Exit codes

This is the one list of Sonah's exit codes. The exit code reports only whether Sonah's own review ran, never a
judgment of the agent's work: a review with findings that ran to the end exits `0`.

| Code | Meaning |
| --- | --- |
| `0` | The command did its job: Sonah's review ran to completion, whatever it lists; or `sonah review --background` printed its one line, whatever it says (when the line says the review started, it runs on, and its log says how it ended) |
| `1` | Sonah's review ran but did not complete (a part of the session was not reviewed, or, with `--code-pass` on the command line, the code step did not cover the whole change and finish its checks; the output says which and why); or no session was found for this repository, or `--session` got an empty id; or `sonah doctor` found something to fix; or `sonah hook add` could not turn the commit link on by itself and printed the line for you to add; or `sonah skill add` or `sonah skill remove` found a file that Sonah did not write and changed nothing; or `sonah sessions --commits A..B` found no commit that names a session, or `sonah sessions --github OWNER/REPO --pr N` found none in a list that GitHub gave whole; or `sonah decision` refused an answer (the reason is printed). A code step that ran by default or by your setting never sets it by itself. |
| `2` | Invalid arguments, or a problem Sonah names with its fix (a missing recording, an existing output file, a wrong model, a range git cannot list, a pull request GitHub does not answer for, or one whose list GitHub did not give whole and whose listed commits name no session) |
| `3` | Sonah's review failed: it could not run, it crashed, or it was stopped (Ctrl-C while it was asking the model, or one of your optional stops); or `sonah decision` could not record an answer; or `sonah skill add` or `sonah skill remove` could not write or delete its file |
| `130` | Ctrl-C at another moment (while it reads the recording, plans or writes the page): it ends the usual way, and the same command starts again |

## Still stuck

Open a [GitHub issue](https://github.com/getsonah/sonah/issues) with the message you saw, the exit code and the output of
`sonah doctor --no-probe` (read it first: it prints the folders it searched, which include your home folder's path).
Never paste a session recording, a Sonah page or a report: they can hold secrets. A security problem goes privately,
as [SECURITY.md](../SECURITY.md) describes.
