# Install and use Sonah (beta)

This guide covers installing Sonah, checking your setup, reviewing a session, choosing the reviewer, and where Sonah
keeps things. [README.md](../README.md) has the short version; [PRIVACY.md](PRIVACY.md) says exactly what is sent and
kept; [TROUBLESHOOTING.md](TROUBLESHOOTING.md) lists the common messages and their fixes.

Sonah reviews the recording of a coding session and writes a checklist: what you asked and whether it was done, and
what the agent decided on its own. It never gives a verdict on the agent's work: nothing it prints says the work is
fine, needs a decision or failed. It never approves or merges anything.

## Requirements

- Node.js 20 or newer, with npm. macOS and Linux are the supported targets; Windows has not been verified.
- Git, for finding the sessions of a repository (a plain folder works too).
- A recording of a coding session: Claude Code and Codex recordings are found automatically; a Cursor recording works
  when you pass its path.
- For a review (not for a dry run): Claude Code signed in (`claude auth login`) with an account that can use
  `claude-sonnet-5-5[1m]` (Sonnet 5.5 with its 1M-token window), or the Codex CLI signed in with your ChatGPT account,
  or an Anthropic API key. The agent that recorded the session can differ from the reviewer, but then the session goes
  to the reviewer's provider for the first time ([PRIVACY.md](PRIVACY.md#what-leaves-your-computer)).

## Install

Sonah is on npm as the package `getsonah`; the command it installs is `sonah`:

```sh
npm install -g getsonah
sonah --version
```

npm puts the command in its own global folder (`npm prefix -g` prints it), whose `bin` is usually on your PATH
already. The package has no install scripts, no dependencies and no hooks. It holds the code it needs, this guide, the
README, the changelog, the privacy and troubleshooting pages and the licences; no recordings, tests or history. To run
Sonah once without installing it, put `npx getsonah` where a command below says `sonah`, as in
`npx getsonah doctor --no-probe`.

Or clone this repository and install from it, in one command:

```sh
git clone https://github.com/getsonah/sonah sonah && cd sonah && node scripts/install.mjs
```

It installs the same package into `~/.local` and prints the absolute path of the `sonah` command. Use that path, or add
its folder to this terminal's PATH:

```sh
export PATH="$HOME/.local/bin:$PATH"
sonah --version
```

`node scripts/install.mjs --prefix /absolute/path/to/a/folder/you/own` installs somewhere else. The installer makes no
model call, runs npm with install scripts disabled, and adds no hooks, scheduled jobs or shell-profile edits. An install
made before this beta went to npm is named `sonah`; the installer replaces it in the folder it installs into.

To build the package file yourself: `node scripts/package-source.mjs --output-dir /tmp/sonah-package`, then install
the printed file with `npm install --global --prefix "$HOME/.local" --ignore-scripts --no-audit --no-fund PATH.tgz`.

## Check your setup

```sh
sonah doctor --no-probe
```

This checks Node, the `claude` command and its sign-in, the optional `codex` command, where your recordings are and
whether the code step is on, with a fix for anything missing. It makes no model call. Without `--no-probe`, `sonah doctor` also makes one tiny
synthetic request (it quotes no session) and checks that `claude-sonnet-5-5[1m]` answers under its 1M-token window.
For Codex: `sonah doctor --backend codex-cli --model gpt-6.1-sol`. Doctor does not check your plan or billing; when
`claude` reports how much of your plan's usage limits is used, it prints it in a `Claude usage:` line, read like the
review's usage line below.

## Review a session

Go into the project you worked in, then run `sonah review`:

```sh
cd ~/code/your-project
sonah sessions                                   # recorded sessions of this repository, newest first
sonah review --dry-run                           # what would be reviewed and roughly how long; no model call
sonah review --format html --output ~/review.html  # review the newest one and open the page
```

### What is read and sent

Sonah reads the session's recording and sends it to the reviewer model through your own login (`claude` by default),
as it was recorded, secrets and pasted images included. The code step, on by default, then reads the files the session
changed or read, as they are now (and their changes since the session's start commit, read with git, which Sonah never
writes to), and sends them to the reviewer too. Credential-shaped files, `~/.claude` and `~/.codex`, files outside the
project, binary files and files too large for a request are never sent. Nothing else leaves your computer: no
telemetry, no update check. [PRIVACY.md](PRIVACY.md) has the details.

### Turning the code step off

```sh
sonah config                                     # shows the setting
sonah config code-pass off                       # every review: the session only, no file read or sent
sonah config code-pass on                        # back on
sonah review --no-code-pass                      # one review without it (--code-pass: one review with it)
```

The setting is kept in `~/.sonah/config.json`. The flag wins over the setting for one review. The dry run, the line
printed before the first call, and `sonah doctor` all say whether the code step will run.

### Which session

`sonah review` takes the newest Claude Code or Codex session whose recorded working folder is this repository (its Git
root), including a session started in a subfolder. Helper agents (the sub-agents Claude Code or Codex started for the
session) are reviewed with their parent, never as separate sessions. Other choices:

- `--choose N`: the Nth entry of `sonah sessions` (numbers shift when a newer session appears).
- `--repo DIR`: another repository, for `sonah sessions` and `sonah review` alike.
- A recording path: `sonah review /absolute/path/to/session.jsonl`. Required for Cursor:
  `ls -t ~/.cursor/projects/*/agent-transcripts/*.jsonl | head -1`.

Where Sonah looks:

- **Claude Code:** `~/.claude/projects/<repo-slug>/<session-id>.jsonl` (the slug is the working folder's path with
  each character that is not a letter or digit replaced by `-`; Sonah matches sessions by the folder recorded inside
  them, not by this name), or under `$CLAUDE_CONFIG_DIR/projects`. Helper recordings sit in `<session-id>/subagents/`
  beside the session file. To review a copy, keep that layout under a folder of your choice and set
  `SONAH_CLAUDE_PROJECTS` to it.
- **Codex:** `~/.codex/sessions/<year>/<month>/<day>/rollout-*.jsonl`, or the same under `$CODEX_HOME`. For a copy,
  keep the layout and set `CODEX_HOME` to the folder above `sessions` (this also changes where the Codex reviewer
  looks for its sign-in).

Listing and dry runs make no model call and write nothing.

### What the review prints

Before the first model call, an estimate:

> This review should take roughly 4-12 minutes (less if answers are already stored). It runs to the end; press Ctrl-C to
> stop at any point (answers so far are kept and the same command resumes).

A *window* is one part of the session (a run of your messages and what the agent did after them), reviewed in requests
of its own; four windows are reviewed at a time (`--concurrency N` sets up to twelve, or up to three with `--profile
standard`). The page does not show windows: it shows each of your requests and what the agent did under it as a *step*,
whichever windows reviewed that work (a session with three requests is three steps, however many windows it took; work
before your first request is one step of its own; a file you attached to a message belongs to that message's request
and is shown under it). As each window finishes, `Review window N/M finished` appears. At the end: whether Sonah's
own review completed, any parts it could not cover and why, where your attention is needed, how many answers were
reused, and a usage line:

> Review usage: 41 calls; 3112640 input bytes; input tokens ... ; output tokens ... ; wall 412000 ms; utilization 0.57
> (five-hour 0.57, seven-day 0.18).

Calls count every attempt, retries included; answers reused from an earlier run cost nothing. The figures are what
your provider reported, not a price: what a call costs depends on your own plan. `utilization` is how much of your
Claude plan's usage limits the latest call that reported it had used, as a fraction (0.57 is 57%): first the highest,
then each limit the `claude` CLI reported (five-hour, seven-day, and on some accounts seven-day with extra usage; a
limit Sonah does not know by name is shown as `other limit`). An older `claude` reports one figure, shown alone. The
Codex CLI and the API report none: `utilization not reported`.

### Reading the result

`--format html --output FILE` writes the checklist page and opens it (`--no-open` for automation or a machine with no
browser; if opening fails the page is still saved). The page is one self-contained file: no script, nothing loaded
from the network, light or dark as your system is set. `--format md --output FILE` writes the same review as a short
Markdown story you can paste into a pull request description; without `--output`, Markdown goes to the terminal.

Output files are readable by you only, and Sonah never overwrites a file: use a new name each run. The page quotes your
session with secrets masked (the model itself read the session as recorded): read it before you share it, as its
footer says. Keep reviews out of Git.

A row that could not be checked says so and why; nothing on the page proves the absence of bugs or that every
decision was found.

Exit codes report only whether Sonah's own review ran: `0` when it ran to completion, `1` when it ran but did not
complete (a part of the session was not reviewed; the output names which part and why) or when no session was found for
this repository, `2` for invalid arguments or a problem Sonah names with its fix, and `3` when it failed, could not run,
or you stopped it. A review with findings that ran to the end exits `0`; limits of the recording itself (a helper
recording not found, a command with no recorded exit status) are named with their counts and never change the exit code.

### Answering rows

The page prints, once, under "Where your attention is needed", the command that records your answer on this computer,
with the session's hash filled in:

```sh
sonah decision accept|change|clarify <session hash> ROW_ID --report REPORT --reason "YOUR REASON"
```

Pick `accept`, `change` or `clarify`. Under each row the page prints only its id (`Row id` or `Decision id`): use it as
`ROW_ID`. `REPORT` is `~/.sonah/session-reviews/<hash>/review/report.private.json`, where `<hash>` is the SHA-256 of the
recording's path exactly as the `Recording:` line printed it: `printf '%s' /absolute/path/to/session.jsonl | shasum -a
256` (`sha256sum` on Linux) (or `<--state-dir>/review/report.private.json` if you set one). Answers are stored in
`~/.sonah/decision-reviews.ndjsonl` and shown on the page the next time it is written. A reason that looks like a secret
is refused.

### Stopping, resuming and rerunning

A review has no limits by default. Press Ctrl-C to stop: answers already received are kept and never asked again, no
page is written, and the same command continues where it stopped; a request still running when you stop is sent again
when you resume. A stop takes at most a few seconds. Optional stops, off unless you set them:

```sh
sonah review --format html --output ~/review.html --max-calls 30 --max-input-bytes 8000000 --stop-at-utilization 0.95
```

Retries and failed attempts count toward them; stored answers do not. Input bytes are the request's text and, when it
carries an image you pasted, that image as sent (its base64 text), every time it is sent. `--stop-at-utilization U`
stops when the highest limit in the usage line reaches U, whichever it is: the five-hour limit can stop a review before
the seven-day one does. It works only when the reviewer reports your plan's usage (the `claude` CLI does; the Codex CLI
and the API do not, so this stop never fires there). When one is reached Sonah prints `Review stopped where you asked
(...)` and exits `3`; run the same command to continue.

Running a review again (for example after the session continued) reuses every stored answer whose request is
unchanged and asks only what is new or failed. A review that did not complete still writes its page, so give the rerun
a new `--output` name. Only one review of a recording runs at a time.

## Choose the reviewer

**Claude Code (default).** Your `claude` login and the model `claude-sonnet-5-5[1m]` (Sonnet 5.5 with its 1M-token
window). Leave `--model` out. Each call runs in an empty private folder with Claude Code's tools, MCP servers, settings
and slash commands switched off, and only a basic environment: not your API keys, proxy settings or `CLAUDE_CONFIG_DIR`.
Every answer is checked to come from the model and window asked for; if not, the answer is never kept: that part is
marked not reviewed, or the review stops with `model_unavailable`. If you want subscription usage rather than API
billing, remove `ANTHROPIC_API_KEY` and endpoint overrides from the terminal you sign in from. Each checking call (the
calls that test what the reviewer proposed) is limited to 32,768 output tokens per attempt, a cost guard against a reply
that runs on; the `claude` CLI may ask the model to continue a cut reply up to three times, so one checking call costs
at most 131,072 output tokens. A continuation that answers whole is read like any other reply; a reply still cut after
the third counts as a check that did not run, and nothing cut is ever read in part. The call that reads a window has no
such limit.

**Codex.** `--backend codex-cli --model gpt-6.1-sol`, with the Codex CLI signed in to your ChatGPT account (on macOS
the CLI inside the ChatGPT or Codex app is preferred; `SONAH_CODEX_BIN` names another). It runs read-only with its
tools, web search, hooks and plugins off. Codex windows are half the size of Claude's. The Codex CLI does not report
which model served an answer, so that check is not made.

**Anthropic API.** `--backend anthropic-api --model <exact model id>` with `ANTHROPIC_API_KEY` set in your shell (never
as an argument). This bills your API account.

`SONAH_REVIEW_BACKEND` and `SONAH_MODEL` set the same choices from the environment; unset them if an older setup left
them behind. Whenever the code step runs, `--code-model ID` (or `SONAH_CODE_MODEL`) runs it on its own model, on the
same reviewer; the session review keeps its own. Without either, the code step uses the session review's model.

## Time and usage

The estimate before the first call is a rough time, computed from the review's own plan: the size of each window's
request and how many windows run at a time, at fixed rates for Sonnet 5.5 running four windows at a time, as a review
does by default. It includes the code step's first requests, and the line after it says roughly how many
calls the code step adds. `--profile standard` checks every item in three passes: it makes more calls and can take
longer. The estimate is never a limit. The calls and input the review used are in the usage line at the end.

A short session takes a few minutes. A long session of several hours is reviewed in many parts: more calls, millions
of input tokens and tens of minutes. Yours will differ with the length of the session and how much the agent did.

## Where things are stored

| What | Where |
| --- | --- |
| Stored model answers, progress and the report of each review | `~/.sonah/session-reviews/<hash of the recording path>/` (`--state-dir DIR` moves it) |
| Your answers to rows | `~/.sonah/decision-reviews.ndjsonl` |
| Your settings (the code step's, from `sonah config`) | `~/.sonah/config.json` |
| The page or Markdown | the `--output` file you named |

`SONAH_HOME` moves `~/.sonah`. Folders are created readable by you only. Stored answers are capped at 64 MB per
recording, least recently used removed first. The requests themselves are never stored, but answers quote the
session as recorded, secrets included: keep a `--state-dir` outside every Git repository. Your recordings are only
read, never changed. Your provider's CLI may keep its own history of the calls.

## Uninstall

Installed with npm:

```sh
npm uninstall -g getsonah
```

Installed from a checkout (with `--prefix`, put that folder in place of `$HOME/.local`):

```sh
npm uninstall --global --prefix "$HOME/.local" --ignore-scripts getsonah
```

An install made before this beta went to npm is named `sonah`: remove it with
`npm uninstall --global --prefix "$HOME/.local" --ignore-scripts sonah`. Remove the PATH line if you added it for Sonah. Uninstalling keeps your reviews; to delete them, remove `~/.sonah`
(or your `SONAH_HOME` / `--state-dir`) and the output files. Ctrl-C stops Sonah but cannot recall a request a provider
already received.

## Posting a count-only PR comment

Posting is off unless you ask, and it is meant for teams that already run a GitHub App. Add
`--github OWNER/REPO --pr N --post-comment` to a review with `--format html --output FILE`, for a pull request of a
**private** repository (public ones are refused):

```sh
sonah review --github OWNER/REPO --pr 123 --post-comment --format html --output ~/review.html
```

Before its first model call, Sonah reads that pull request's metadata from GitHub (its revisions, its repository's id
and whether it is private; never its files or changes): a pull request that does not exist, that your token cannot
read, or whose repository is public stops the review there. It then reviews the session as usual, saves and opens the
page, reads the metadata again (so the comment is attached to the current revision), prints the exact comment and the
revision it will be attached to, and posts only after you type the `share OWNER/REPO#123` phrase it shows, in an
interactive terminal. The comment is built from the review's checklist and carries fixed sentences and counts only:
whether Sonah's review ran, what it could not cover, and where your attention is needed. No quotes, file text, paths
or page. Its GitHub check is always neutral. Without the three settings below the review stops before any model call:

- a token of a GitHub App installed on the repository, with read and write access to pull requests and checks, in
  `GH_TOKEN` (else `GITHUB_TOKEN`, else what `gh auth token` prints). A GitHub check can only be created by an App;
  GitHub's documentation on GitHub Apps explains how to create one, install it and generate an installation token;
- the App's numeric id (on its settings page) in `SONAH_GITHUB_APP_ID`;
- the numeric user id of the App's bot account, which authors the comment, in `SONAH_GITHUB_ACTOR_ID`
  (`gh api /users/APP-SLUG%5Bbot%5D --jq .id`, with your App's slug).

Sonah uses the two ids to recognise a comment and a check it posted earlier, so a rerun never posts twice. If posting
fails or its outcome is unclear, the page and the review's history are kept (exit `3`): rerun the same review with a new
output name and Sonah completes or reuses the earlier post instead of posting twice (stored answers are reused, so the
rerun makes no new model call).

`--dry-run` with the same options reads nothing from GitHub and posts nothing: it shows the comment the recording's
last finished review would post, or says there is none yet.

## Verification

An automated test installs Sonah from a checkout into an empty temporary home folder with the checkout installer
(`node scripts/install.mjs`, as above), runs `sonah doctor`, reviews a synthetic session with a stand-in reviewer and
writes the page, with no manual step and no real model call. It does not install from npm.
If a step of this guide did not work for you, or was unclear, please say so in a
[GitHub issue](https://github.com/getsonah/sonah/issues) (never paste a session, a page or a report into it).

## If you used an early preview

Early previews were installed under the package name `sonah`. `node scripts/install.mjs` replaces that install in its
folder. Before you install with `npm install -g getsonah`, remove it, so that its `sonah` command does not come first on
your PATH:

```sh
npm uninstall --global --prefix "$HOME/.local" --ignore-scripts sonah
```

Early previews of Sonah had other commands (`scan`, `pr`, `docket`, `web`, `demo` and others) and a pull-request
review of the code (`--base`, `--head`, and `--github`/`--pr` as a code target). They are gone: running one prints
the usage, and their history under `~/.sonah/pr-reviews/` and `~/.sonah/answers/` is no longer read; you can delete
those folders.

If you ran `sonah init`, remove what it added, keeping your own entries: Sonah's hooks in Claude Code's
`settings.json`, the two deny rules `Read(./.sonah/**)` and `Read(~/.sonah/**)` it merged into `permissions.deny`, its
backup `settings.json.deviation-backup`, and the marked block in `.git/hooks/prepare-commit-msg`. There is no automatic
uninstall for those. Until you remove them, the three commands those hooks call do nothing: `sonah capture` and
`sonah capture-outcome` (the Claude Code hooks) and `sonah trailer` (the git hook) discard what they are sent and exit
0 without writing or printing anything, and `sonah trailer` leaves the commit message as it is.

Smaller changes you may notice:

- A crash prints its stack trace when `SONAH_DEBUG=1` is set; the old `DEVIATION_DEBUG=1` still works.
- An `--output` folder that does not exist, or that you cannot write to, is reported as `output_folder_missing` or
  `output_folder_unwritable` with a fix, and exits 2. Early previews reported both as `review_failed` (exit 3).
- `sonah help` prints the same help as `sonah --help` and exits 0 (it exited 2).
- The PR comment no longer ends with a sentence about automatic publication being disabled. Sonah recognises a comment
  it posted by a hash of the comment's text, so if an early preview could not confirm whether its comment was posted
  (`operation_uncertain`), this version does not recognise that comment and would post a new one: check the pull
  request yourself before you post again.
