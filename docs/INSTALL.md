# Install and use Sonah (beta)

This guide covers installing Sonah, checking your setup, reviewing a session, choosing the reviewer, and where Sonah
keeps things. [README.md](../README.md) has the short version; [PRIVACY.md](PRIVACY.md) says exactly what is sent and
kept; [TROUBLESHOOTING.md](TROUBLESHOOTING.md) lists the common messages and their fixes.

Sonah reviews what your coding agent did, not just the diff: did it do what you asked, what it decided on its own, and
what is wrong in the code. It never gives a verdict on the agent's work: nothing it prints says the work is fine, needs
a decision or failed. It never approves or merges anything.

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

## Update

Sonah does not check for new versions. To update an install from npm, install the latest version over it:

```sh
npm install -g getsonah@latest
sonah --version
```

With `npx`, name the version, as in `npx getsonah@latest doctor --no-probe`.

To update an install from a checkout, get the new code and run the installer again. Give the same `--prefix` as
before, if you gave one:

```sh
cd sonah && git pull && node scripts/install.mjs
```

Your reviews under `~/.sonah` stay. A new version can need new calls to review a session that an earlier version
reviewed. Read the [changelog](../CHANGELOG.md) before you update. From 0.3.0-beta.2, Sonah masks nothing in what it
writes for you.

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
sonah review --format html --output ~/review.html  # review the newest one, open the page, write ~/review.md
```

### What is read and sent

Sonah reads the session's recording and sends it to the reviewer model through your own login (`claude` by default),
as it was recorded, secrets and pasted images included. The code step, on by default (with the `claude-cli`
backend only), then reads the session's changes since its start commit, read with git, which Sonah never writes to, and
gives them to a review agent: Claude Code with read-only tools (Read, Grep and Glob) over your repository as it is now,
which reads what it needs there and sends it to the model as it works, and checking agents with the same tools. Nothing
else leaves your computer: no telemetry, no update check. Nothing is masked or withheld, in what is sent or in what
Sonah shows and keeps: treat the page, the .md and `~/.sonah` as holding your session as recorded.
[PRIVACY.md](PRIVACY.md) has the details.

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
- `--repo DIR`: the sessions of another repository, for `sonah sessions` and `sonah review` alike. It only chooses the
  session: the code review still reads the folder that the recording names as the session's working directory. To point
  the code review at another repository, use `--code-repo DIR` (below).
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

A Claude Code session that you resumed after a compaction continues in a new recording, which opens on that
compaction. When you give or choose such a recording, Sonah also reads the recordings it continues, in the same folder,
oldest first, as one session: the terminal says how many. If Sonah cannot find or read the earlier part, the report says
so and why.

Listing and dry runs make no model call and write nothing.

### A repository that the recording does not show the session changing

The code review reads the session's change where the recording shows its writes. A script that writes the paths it
builds, a write after a `cd`, or a session that started in a folder that no git repository holds can change a
repository with no write that Sonah sees. The first lines of the report then say that no code was reviewed, and why.
Point the code review at that repository with `--code-repo` (since 0.3.0-beta.5):

```sh
sonah review --code-repo ~/code/app --format html --output ~/review.html
```

`DIR` is the repository's folder, or any folder in it; give `--code-repo` once for each repository. Sonah reads it as if
the session had written there: its change runs from the commit where it stood when the session started, and holds the
files that a recorded write could have changed there and the files whose last change came while the session ran (each
marked as written by no recorded edit). The other files that differ there are outside the evaluated session. When the
repository holds a file of the change, the code review and its checks read that folder too. The report names the
repository with its count of files. A folder that is not there, or that no git repository holds, stops the review
before anything is read or sent (`code_repo_not_found`, `code_repo_not_git`). The repository that holds the session's
working directory is read by its own rule already, so giving it changes nothing that Sonah reads; the report says that
you gave it. When no code was reviewed after all, the reason says what Sonah found in the repositories that you gave.
Without `--code-repo`, nothing changes.

### What the review prints

Before the first model call, an estimate:

> This review should take roughly 4-12 minutes (less if answers are already stored). It runs to the end; press Ctrl-C to
> stop at any point (answers so far are kept and the same command resumes).

A *window* is one part of the session (a run of your messages and what the agent did after them), reviewed in requests
of its own; four windows are reviewed at a time (`--concurrency N` sets up to twelve, or up to three with `--profile
standard`). The report does not show windows. As each window finishes, `Review window N/M finished` appears. At the
end, Sonah prints whether its own review completed, and which part of it did not finish. What Sonah could not check,
cause by cause with its counts, is in the fold What Sonah could not check, on the page and in the .md. Then it prints
the count line and the Must act items, how many answers it reused, and a usage line:

> Review usage: 41 calls; 3112640 input bytes; input tokens ... (41/41 calls reported: ... uncached, ... written to the
> cache, ... read from the cache); output tokens ... ; list cost $... (41/41 calls reported); wall 412000 ms;
> utilization 0.57 (five-hour 0.57, seven-day 0.18); limits from first to last reading: five-hour 0.38 to 0.57,
> seven-day 0.16 to 0.18. Code step: 12 of these calls; ...

Calls count every attempt, retries included; answers reused from an earlier run cost nothing. The token figures are
what your provider reported. The input tokens are split as the `claude` CLI reports them: those read fresh, those
written to the cache, and those read from it (the Codex CLI reports no split). The list cost is the price that the
`claude` CLI states for each call: what you pay depends on your own plan, and a subscription is not charged per call.
`utilization` is how much of your Claude plan's usage limits the latest call that reported it had used, as a fraction
(0.57 is 57%): first the highest, then each limit the `claude` CLI reported (five-hour, seven-day, and on some
accounts seven-day with extra usage; a limit Sonah does not know by name is shown as `other limit`). Then each limit
goes from the first call that reported it to the last, so you see how much of it this run used (from its first
answer, so the first call's own share is not in it). An older `claude` reports one figure, shown alone. The Codex CLI
and the API report none: `utilization not reported`. When the code review runs, the line ends with its part of the
calls, bytes, tokens and list cost, and its own time (`Code step on MODEL` when `--code-model` names its model). When
the code step's agents ran, the line also gives their `agent turns`; their input bytes count only the requests Sonah
sent them, while what they read as they worked is in the input tokens your provider reported.

The report's footer says the same in plain words: the model calls and the code review's part of them, the tokens, the
time and how far each usage limit moved. For a review that ran once, these are that run's. For a review that you
stopped and resumed, the footer gives the whole review over the runs that its state folder keeps and that made model
calls with the same backend, model and code model: the calls, tokens and time summed, and how far each usage limit
rose in all. A run on stored answers alone makes no call and is not counted. The footer gives no list price; the usage
line does. Sonah keeps these figures in its record of the review (`report.private.json` under the review's state
folder, as `instrument.usage`), as counts only. Beside it, `usage.private.json` keeps the figures of every run, one
entry each, also when a run stopped where you asked, was interrupted or failed, so a review that you resume over
several runs keeps what each run cost.

### Reading the result

`--format html --output FILE` writes the page and opens it. Use `--no-open` for automation or a computer with no
browser. If Sonah cannot open the page, it still keeps it. The page is one file: no script, nothing from the network,
light or dark as your system shows. Sonah also writes the same report in Markdown beside the page: `review.html` gives
`review.md`. `--format md --output FILE` writes the .md alone. Without `--output`, the .md goes to the terminal.

The report has this order:

1. A header. It says what the work was and how large the change is. It counts the commands that the agent ran after
   its last edit, and how they ended. For a session continued after a compaction, it says how many recordings Sonah
   read, or that the session continues from an earlier part.
2. A count line. It counts the items in each section, and the asks of each status.
3. Must act and Must know: the items that need you, first.
4. Your prompt. It shows your message, and Sonah marks each ask in it. Sonah counts an ask apart when a finding of the
   code review concerns it. Each compaction of the agent's context shows between your messages, with how many tokens
   it dropped. An ask's row has its own small fold: why Sonah did not check the ask, or that the session review cited
   only the agent's words for it. In the .md, the asks table is cut at each compaction, under one line "Before
   compaction N." above the asks that you gave before it. When your prompt holds more than 30 asks, Sonah folds it,
   and its heading keeps the count of each status.
5. Good to know, folded.
6. What the agent did, folded. It lists the files with their added and removed lines, and the commands with their
   results. It also lists the claims, what the agent said it did not do, and the decisions that you settled.
7. What Sonah could not check, folded. Its first lines say what Sonah did not check, the results that Sonah could not
   read, and, for a session continued after a compaction, that Sonah did not read the earlier part. It lists each
   limit of the recording with its count, also when Sonah shortens the .md. The legend at the end says that Sonah
   checked only the marked parts of your message.

Each item starts with its type: Fix, Decide, Read or Verify. Then it says what the item is and where it is. With the
code review, the item also says the impact on you and one action. These two lines are the code review's words. Sonah
checks their form, not their meaning. Sonah folds the evidence under each item, with the reason for its section. The
fold also says first when Sonah did not find the item's quote, or could not check whether you asked for it.

Sonah puts each item in a section by its kind. The code review can propose high, medium or low for an item. Sonah
keeps that proposal inside fixed bounds for the kind. For example, an unmet ask never goes to Good to know. A decision
on how to do something that you asked goes to Good to know, unless a finding of the code review concerns it. A question
of the code review that concerns it moves it too, but only when the two name one place: the same recorded event, such
as a message or an edit, or the same file. Without the code review, each item stays in the section of its kind, and it shows no impact or action.

Sonah shows its reviewer only the start and the end of a long output (see PRIVACY.md). An item, an ask, a claim, a run
or a decision that cites such an output carries a mark. The mark names the run or the place of the output, and the
lines that Sonah left out. For a file read, it also names the lines of the file. The mark changes no status. It says
what Sonah left out, and nothing more: it does not say what those lines would change. What Sonah could not check
counts these outputs.

When Must act and Must know are both empty, the report says so, and its fold What Sonah could not check adds that this
does not mean that the work is correct. Nothing in the report proves the absence of bugs, or that Sonah found every
decision.

### Posting the report on your pull request

At the end, the terminal prints the path of the .md, its size, and a command for the GitHub CLI:

```sh
gh pr comment --body-file review.md
```

With no pull request number, `gh` posts on the pull request of your current branch. To post on another pull request,
put its number after `comment`. Sonah posts nothing itself. When it can, Sonah keeps the .md within 60,000 bytes, so
it fits in a GitHub comment. To fit, it takes these steps in order, and stops as soon as the .md fits. First, it shows
only the start of your long messages. Then it leaves out the evidence folds of Good to know. Then the table of your
prompt keeps the asks that are not done, and Sonah counts your messages in place of showing them. Then it counts the
rows of the lists in What the agent did, then in What Sonah could not check, and shows the counts in place of the rows;
What Sonah could not check still lists its first lines and each limit of the recording, with its count. Then it leaves
out the code excerpts. Then it shows Good to know as a count of each kind of item. Last of all, it
leaves out the evidence folds of Must know, then of Must act; a fold keeps only what Sonah could not check of its item,
when there is something. It says so at the top of the first part that it shortened. It never
shortens the header, the count line, the counts of your prompt or its asks that are not done. It keeps the open lines
of the Must act and Must know items whole too. When these parts alone are longer than 60,000 bytes, the .md says that it is still too long. Sonah then
prints no `gh` command (see TROUBLESHOOTING.md). The .md pings no one. Sonah puts a mention, an issue number or a commit
hash from the recording in a code span. In the .md, "you" means the person who ran the agent.

After you commit and push the work, the report links each place in the code to its lines on GitHub. Sonah reads
these facts from your local git only, and fetches nothing. You usually run Sonah before you commit. Then the
terminal tells you how to get the links:

1. Commit your work.
2. Push the commit.
3. Run the same command with a new `--output` file.

Sonah reuses its stored answers, so the second run makes no model call. Keep the report files outside the repository,
or add them to `.gitignore`. Otherwise the second run reads them as part of the change, and the code review asks again.
The terminal tells you when Sonah wrote the report inside the repository.

Only you can read the output files, and Sonah never overwrites a file: use a new name each run. The report quotes your
session as the recording holds it, secrets included. Sonah masks nothing. Read the report before you share it, as its
footer says.

Exit codes report only whether Sonah's own review ran: `0` when it ran to completion, `1` when it ran but did not
complete (a part of the session was not reviewed; the output names which part and why) or when no session was found for
this repository, `2` for invalid arguments or a problem Sonah names with its fix, and `3` when it failed, could not run,
or you stopped it. A review with findings that ran to the end exits `0`; limits of the recording itself (a helper
recording not found, a command with no recorded exit status) are named with their counts and never change the exit code.

### Answering rows

The page prints, once, in the folded "Record your answer" part at its foot, the command that records your answer on
this computer, with the session's hash filled in:

```sh
sonah decision accept|change|clarify <session hash> ROW_ID --report REPORT --reason "YOUR REASON"
```

Pick `accept`, `change` or `clarify`. In each item's evidence fold the page prints only its id (`Item id`): use it as
`ROW_ID`. `REPORT` is `~/.sonah/session-reviews/<hash>/review/report.private.json`, where `<hash>` is the SHA-256 of the
recording's path exactly as the `Recording:` line printed it: `printf '%s' /absolute/path/to/session.jsonl | shasum -a
256` (`sha256sum` on Linux) (or `<--state-dir>/review/report.private.json` if you set one). Answers are stored in
`~/.sonah/decision-reviews.ndjsonl` and shown on the page the next time it is written.

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
window). Leave `--model` out. Each call of the session review runs in an empty private folder with Claude Code's tools,
MCP servers, settings and slash commands switched off, and only a basic environment: not your API keys, proxy settings
or `CLAUDE_CONFIG_DIR`. The code step's agents run in your working directory with the same environment and three
read-only tools (Read, Grep and Glob), confined to your repository, each within a budget of turns and time (the review
agent 150 turns and 45 minutes, each check 60 or 80 turns and 30 minutes). Every answer is checked to come from the
model and window asked for; if not, the answer is never kept: that part is marked not reviewed, or the review stops with
`model_unavailable`. If you want subscription usage rather than API billing, remove `ANTHROPIC_API_KEY` and endpoint
overrides from the terminal you sign in from. Each checking call of the session review (the calls that test what the
reviewer proposed) is limited to 32,768 output tokens per attempt, a cost guard against a reply that runs on; the
`claude` CLI may ask the model to continue a cut reply up to three times, so one checking call costs at most 131,072
output tokens. A continuation that answers whole is read like any other reply; a reply still cut after the third counts
as a check that did not run, and nothing cut is ever read in part. The call that reads a window has no such limit.

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
does by default. It adds a fixed range for the code step's agents, and the line after it says what the code step
adds: one review agent, and one checking agent per finding. `--profile standard` checks every item in three passes: it makes more calls and can take
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
or page. Its counts do not come from the report's sections, so they can differ from the count line. To post the whole
report instead, use the `gh pr comment` command that Sonah prints. Its GitHub check is always neutral. Without the three settings below the review stops before any model call:

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

## How the code step reviews the change

The code step (on unless you run `sonah config code-pass off` or add `--no-code-pass`; `--code-pass` turns it on for one
review) also reviews the code, the way a reviewer reviews a pull request, with the session review beside it. It runs
with the `claude-cli` backend only. After the session review, Sonah reads the change the session made: each file that
differs from the commit the session started from (read with git, which it never writes to; with no git history to start
from, the session's own recorded edits) that a recorded write of the session could have changed, or whose last change
came while the session ran (a file git shows changed that no recorded edit wrote is then marked so), with its lines
before and after. A file that differs but changed outside both (a later commit, a file already changed when the session
began) is outside the evaluated session: it is never part of the change, the report names it apart with those words,
and when the change holds a file to review the review agent is given it too, after the change and apart from it (the
first part left out when the request is too large). A finding about such a file is marked "outside the evaluated
session" and never tied to your asks or the agent's claims. A broken contract, a broken rule or a contradicted claim
that a line the session changed causes is the session's finding even when it shows in such a file: it is not marked,
and it keeps its ties. A check of a finding about such a file that fails or is too large to send leaves the coverage of
the session's change as it is. It gives that change, each changed file whole, the lines the session read of files it
left unchanged, your words, the project instruction and skill files the session loaded and its review of the session to
a review agent: Claude Code with three read-only tools (Read, Grep and Glob) over the repository as it is now, for as
many turns as it needs (up to 150). It cannot run or write anything. It opens any changed file it was not given whole
(the whole files fill up to about 400 KB, and a file that does not fit is named), reads the callers, tests and docs and
the project's rules, and checks the change, your asks and the agent's claims and decisions against the code. Each
finding names the input that shows it and quotes every step from that input to the line (of the session, a step may
quote only your words or a recorded result, never the agent's: a helper's report, and a `CLAUDE.md` the agent wrote,
edited or deleted in the session, count as the agent's). Every quote
is checked word for word by code against the file it names; an answer that breaks the contract goes back to the agent
once, naming what is wrong. Then a checking agent with the same tools tries to refute each finding, never shown the
agent's words from the session, and one more checks the questions it asks. A finding is published only when its
checker upholds it with quotes of the code; a supporting sentence the checker finds false is cut and not shown; a
behaviour that is as stated but may be what you wanted becomes a question for you; anything
withheld is listed with its reason. A binary file (or one git diffs as binary, through a `binary` or `-diff` attribute),
one too large, and a file the session deleted that is there again have no lines in the change the agent is given; the
code review does not read as complete while any part of the change went unshown, or while the repository changed
during the review. A file that changed after the session's last recorded edit (a formatter, say) is shown with its
change from where the session started, like any changed file, and the report says that Sonah cannot tell whether
all of its lines are the agent's. When the working directory is a folder of a larger repository, git is asked about that folder
and about the files the session wrote elsewhere in the repository (the other paths that differ elsewhere are counted),
and the agents may still read the whole repository. A file the session wrote in another git repository, such as a
sibling worktree, is part of the change too (since 0.3.0-beta.5), after the repository's files: its change runs from the
commit where that repository stood when the session began, by the same rule as yours, and a file there that no recorded
write of the session touched is part of it only when its last change came while the session ran (the other files that
differ there are named apart, outside the evaluated session). Such a repository counts only when a file the session
wrote there is there now and differs from that commit; the agents may read each such repository too. A repository that
you give with `--code-repo` is read the same way, whatever the session wrote there (see "A repository that the
recording does not show the session changing"). A file the session
wrote in a folder that no git repository holds (a notes or temporary folder) is not reviewed: the report lists its
folder with how many files the session wrote there. A write whose path holds a shell variable or command substitution
that the recording does not expand (`cat > "$DIR/notes.md"`) names no file Sonah can find: it is counted apart, unless
that spelling names a file or folder that is there (relative to the session's working folder, or where an absolute path
points) or a file git lists as changed since the start commit (a file named with a `$`). A file
the session wrote in a coding agent's home folder or Sonah's, or under a name from your home folder, is counted, not
reviewed. When the session ran a shell command, the report says that Sonah does not yet
see every edit made by helper agents or by scripts after a `cd`. Each finding and
each question of the code review is an item of the report. What Sonah could not check lists what the code review did
not cover and what its checks withheld. A claim that a finding shows false says so beside its status. The code review
never changes that status. The code review also proposes a level for each item, and it writes one line for each changed
file (see "Reading the result"). In a git repository, run it again on the same `--state-dir` with nothing
changed since, and nothing is asked again (what Sonah writes in its state folder is never part of the change, and a
`--state-dir` that is the working directory or holds it is refused; a file git tracks or the session wrote always is,
and so is any other file written in the repository after the session began, such as a page saved there with `--output`);
with only the repository changed, the session part reuses its stored answers: only the code pass asks anything new.
`--dry-run --state-dir DIR` says, with no call and nothing written, how many stored session answers such a run would
reuse and what the code pass would send first. `--code-model ID` (or `SONAH_CODE_MODEL`) runs the code pass on a model
of its own, such as `claude-opus-5-5[1m]`, while the session review stays on `--model` (or the default); the code pass's
stored answers are kept per model.

### Cursor and optional stops

Cursor sessions are read only when you pass their path
(`ls -t ~/.cursor/projects/*/agent-transcripts/*.jsonl | head -1`), and a Cursor recording can omit tool outputs, so a
review of it can check less. Optional stops, off by default: `--max-calls N`, `--max-input-bytes N`,
`--stop-at-utilization U`. Running the same review again reuses stored answers and costs nothing; a review that did not
complete asks again only what failed (it still wrote its page, so give the rerun a new `--output` name).
`sonah review --help` lists every review option.

## What Sonah does and does not do

It does:

- read the recording your agent already keeps; you change nothing in how you work;
- review long sessions in parts; test every claim the agent made, and every edit against what you said, in three
  independent checking passes, and every other item the model proposes in one check against the evidence it cites
  (`--profile standard`: three passes for every item): what the checks reject is left off the page, and what they
  cannot settle is kept and marked not checked;
- check every quote against the recording by code, never by trusting the model;
- show what it could not check, and why, instead of guessing;
- keep everything on your computer except the model requests themselves.

It does not:

- give a verdict, approve, merge or block anything;
- run your code or your tests: the review reads the recording and, with the code step (on unless you turn it off),
  your repository as it is now, with read-only tools, and the session's changes from Git, which it never writes to;
- let the model rate its own confidence or the severity of anything;
- post anything anywhere unless you ask for it and confirm;
- change your recordings.

It can be wrong. That is why every row carries the evidence you need to check it yourself.

## Known limits

Sonah is a beta (`0.3.0-beta.6`), on npm as the package `getsonah`. Commands, the page and the files under `~/.sonah`
can change between betas.

- Claude Code and Codex are supported. Cursor is experimental. macOS and Linux are supported; Windows has not been
  verified.
- The default reviewer needs a Claude account that can use `claude-sonnet-5-5[1m]`; the Codex CLI and the Anthropic API
  are the alternatives.
- A long review takes a while: parts are reviewed four at a time, and a large session can take tens of minutes. The
  estimate printed before the first call is the best guide.
- Work done by a helper agent is reviewed only when its recording is found beside the parent's. A missing one is named,
  never silently treated as the parent's work.
- For a session continued after a compaction, Sonah looks for the earlier recordings only in the folder of the one you
  review. An earlier recording that is no longer there is named as missing. Compactions in Codex and Cursor recordings
  are not shown.
- A file changed through the shell (`sed -i`, a heredoc) is recorded only as its command: there is no recorded edit of
  the file to show or check.
- Sonah reads a kind of Claude Code row that it does not know by its structure. A new row that holds a single word of
  yours, such as `commit`, counts as the harness's own context. A few kinds of row with text are not read, such as the
  output of a command that you ran in Claude Code itself; a session that holds one is said to have incomplete
  evidence.
- The code review reads the folder that the recording names as the session's working directory (and the other git
  repositories that the session wrote to), not the folder that you run `sonah review` in, unless you add `--code-repo`.
  It does not see what a script writes, or a write after a `cd`: a session that started in a folder that no git
  repository holds and changed another repository only through a script gets no code reviewed, and the first lines say
  why. Check that repository yourself with `git status` and `git diff`, or run the review again with `--code-repo` and
  its folder. With `--code-repo`, a file there is part of the change only when its last change came while the session
  ran (or a recorded write could have changed it): a file that the session changed and that changed again after it, or
  whose last change kept an older time (a copy, a move), is outside the evaluated session. When the working directory
  is a folder of a larger repository, giving that repository changes nothing that Sonah reads: a file that a script
  changed elsewhere in it stays unread, and the report says so.
- The code step reads the files as they are on this computer now. A recording from another computer, or a project
  whose files were deleted since, leaves it with nothing to read. The page and the terminal say so, and the exit code
  still follows the session review, unless you add `--code-pass`, which makes the code step's coverage count.
- The code step runs only with the default `claude` reviewer; with `--backend codex-cli` or `anthropic-api` the session
  is reviewed alone, and the page says so. It needs a Claude Code recent enough to accept its options (`sonah doctor`
  checks).
- The code step's stored answers hold for the repository as it is and where it is: after a file of it changes (one git
  ignores aside), or after the project moves to another folder, its agents are asked again.
- Images you paste into your messages are sent to the reviewer. This is new, and checked on the default `claude`
  reviewer only, not yet on the `codex` or Anthropic API reviewers.
- The review can miss a decision or put one in the wrong place: check the rows that matter to you against their
  evidence.

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
  request yourself before you post again. The comment's words changed again in `0.3.0-beta.2`, so the same is true of
  a comment that `0.3.0-beta.1` could not confirm.
