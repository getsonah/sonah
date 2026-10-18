# Privacy: what Sonah reads, sends, keeps and shows

Sonah runs on your computer. It reads the recording your coding agent (Claude Code, Codex or Cursor) already keeps,
and, with the code step (on by default, with the `claude` reviewer), your repository as it is now, through agents that
open, search and list its files with read-only tools. The only thing that leaves your computer is the review itself:
requests to the model you choose, through your own `claude` or `codex` login, or your API key with `--backend
anthropic-api`.

Sonah masks nothing and withholds nothing for privacy's sake. The model reads your session as it was recorded and, in
the code step, any file of your repository its agents open. The page, the Markdown report, the terminal and the files
Sonah keeps under `~/.sonah` show and hold the session as recorded, secrets included: treat them as you treat the
recording itself. `sonah config code-pass off` (every review) or `--no-code-pass` (one review) keeps your repository
out; then only the session is sent. This page says exactly what each of these means.

## What leaves your computer

Two commands send anything to a model, and nothing else does:

- **`sonah review`** (not with `--dry-run`). Before the first request it prints roughly how many minutes the review
  should take, then it runs. Each part of the session is sent in a request of its own, more than once: one request asks
  for the checklist, then independent checking passes see the same part again, or the parts of it the checklist's
  items cite. Answers already stored on your computer are not asked again. With the code step (on unless you turned it
  off; the line printed before the first request says which; only with the `claude` reviewer) it also runs agents with
  read-only access to your repository (the last row of the table below): one review agent, given the change the session
  made, each changed file whole, the lines the session read of files it left unchanged, your words, the project
  instruction and skill files the session loaded and Sonah's review of the session, that reads what it needs of the
  repository as it works; at most one repair request after it; then one checking agent per
  finding it gives and one for its questions, each asked again at most once. Beside them runs the code review's
  item-by-item check: one agent for each 30 items, at most 4, each asked again at most once. The items are the session
  review's asks (yours, and the asks that an agent wrote into a helper's brief), the statements that the agent wrote
  into a file and its decisions not to act. Each of these requests holds your words, the change, the code review's
  findings and questions, and Sonah's review of those items. Each agent's
  tool results (the files and search results it reads) go to the model as it works.
- **`sonah doctor`** without `--no-probe`: one tiny synthetic request that quotes no session, to check that the model
  answers.

What a review request contains. The model reads your session as it was recorded, secrets and the images you pasted
included: a reviewer that cannot see a value cannot judge what was done with it. When the reviewer is the same provider
and the same login that ran the session, that provider already received almost all of it while you worked with the
agent; the exception is a file's lines from before an edit (in the table below), which the agent may never have read.
When it is not, the session goes to the reviewer's provider or account for the first time: a Claude Code session
reviewed with `--backend codex-cli` goes to OpenAI, a Codex or Cursor session reviewed with the default `claude`
reviewer goes to Anthropic, and a session run under a work account but reviewed under a personal login falls under
that login's terms. Review with the same provider and login to avoid this.

| Part of the session | What is sent |
| --- | --- |
| Your messages to the agent | Whole, every one, never trimmed. A file you attached is cut to its first and last 3,600 characters. |
| Images you pasted into your messages | Whole, as recorded (PNG, JPEG, GIF or WebP, up to 2,000 by 2,000 pixels and about 5 MB of base64 each, at most 20 per request), in the requests of every part of the session from that message on, the checking passes included, so the same image is sent several times. With `--backend codex-cli` each image is written for the call to a temporary file readable by you only, removed afterwards. |
| The agent's messages to you | Whole. Its private reasoning (Claude's thinking, Codex's reasoning) is never read, so never sent. |
| Commands and tool inputs | Whole, unless one alone is very large (over 720,000 bytes; 360,000 with the Codex reviewer); then its beginning and end, with the gap named. |
| File edits | The text the agent wrote or replaced, whole, unless one alone is that large; then its beginning and end, with the gap named. |
| Tool results (command output, files read) | Whole up to 24,000 bytes in a Claude Code session (7,200 in a Codex or other session); a longer one's first and last 12,000 bytes (3,600 in a Codex or other session), with the lines left out named. The model may ask for a few of those lines back (at most about 72 KB per part). The checking passes are sent whole each result that the item they check quotes or names, within their request's size limit. |
| A file the agent edited, as it was before the edit (the copy Claude Code or Codex recorded) | Not in the first request. The model may ask for lines of it, within the same limit of about 72 KB per part. |
| Helper agents (the sub-agents Claude Code or Codex started) | Their recordings, linked to the message that started them, the same way. A helper's final report, as the parent received it, is sent whole (within the 720,000-byte limit above). |
| Your project's instruction files | Each project instruction file Claude Code loaded into the session (a `CLAUDE.md`, or an `AGENTS.md` it names), whole, wherever it lies. In a Codex recording that does not mark which messages are yours (older Codex versions), Codex's `# AGENTS.md instructions` block is read as one of your messages and sent whole: it can hold your own `~/.codex/AGENTS.md` as well as the project's. |
| The reviewer's instructions | A fixed text that ships with Sonah. It holds no session text. |
| With the code step only (on by default with the `claude` reviewer; off with `sonah config code-pass off` or `--no-code-pass`; not run with `--backend codex-cli` or `anthropic-api`): the change the session made, and any file of your repository | The change: every file that differs from the commit the session started from (git's own list, read with git, which writes nothing: the commit the recording names, else the one your branch was on when the recording began; a file git shows changed that no recorded edit wrote is included and marked), its lines at that commit and now as git's own diff shows them (up to about 400 KB of them; a file whose lines do not fit is named, and the agent reads it itself); with no git history to start from, the session's own recorded edits. Also each changed file whole, as it is now, smallest first, up to about 400 KB in all (a file that does not fit is named with its line count, and the agent reads it itself); and the lines the session read with a file-reading tool (never a shell command) in files that did not change since the start commit, as they are now, up to about 400 KB. A binary file (and a file git diffs as binary, through a `binary` or `-diff` attribute, as lockfiles and minified files often have), a file too large for a request and a file the session deleted that is there again are named without their lines; a file that changed after the session's last recorded edit is sent like any changed file, its lines from the start commit to now. Git is asked only about the working directory: when it is a folder of a larger repository, the paths that differ elsewhere in it are counted. The project instruction files of the repository the session loaded (as it loaded them) and the skill files of the repository it used (as they are now), each whole. All of this goes in one request within its size limit; when it is over, Sonah leaves out whole parts (first the lines the session read, then the whole files, then early commands, then file changes, then rule files) and names each one. Then whatever the agents read: Claude Code's Read, Grep and Glob tools over the repository as it is in your working directory at review time (not as it was during the session), and over the whole repository when the working directory is a folder of it. Nothing in it is withheld: a credential-shaped file, a `.env` or a folder named `.claude` inside it is treated like any other file: sent whole when the session changed it, its lines sent when the session read it unchanged, and read when an agent opens it. The agents cannot run a command or write anything. These files can hold text the provider never saw during the session, such as lines the agent never read. |

Nothing in this table is held back because of what it holds or where it lies. The output of `cat .env`, a file the
agent read in Claude Code's or Codex's own folders (`~/.claude`, `~/.codex`, `~/.claude.json`), a key file's earlier
lines and a password typed into a command are sent as the recording holds them, within the limits above.

The default reviewer is the `claude` CLI with the model `claude-sonnet-5-5[1m]`, signed in with your own login. For the
session review it runs in an empty private folder with its tools, settings, plugins and slash commands switched off, and
it is given only the basic environment it needs (home folder, temporary folder, path, user and shell name, language and
the certificate settings), not your API keys or proxy settings. The code step's agents run in your working directory
instead, with the same basic environment and three read-only tools (Read, Grep and Glob), and nothing else: no settings,
MCP servers or slash commands, and your project's `CLAUDE.md` files are not loaded as their instructions (they may open
them as files). Claude Code's restricted mode confines them to the working directory and the repository it lies in.
`--backend codex-cli --model gpt-6.1-sol` uses your `codex` login instead, read-only, with its tools and web search off.
`--backend anthropic-api` posts the same requests to Anthropic's API with your `ANTHROPIC_API_KEY`.

Sonah itself makes no other network request: no telemetry, no analytics, no update check. (The one exception is a PR
comment you ask for with `--github OWNER/REPO --pr N --post-comment`: Sonah reads that pull request's metadata from
GitHub and posts the comment only once you confirm it; see Sharing below.) Your provider's own terms apply to what it
receives.

## What is never sent

- Private reasoning of the agent (Claude's thinking blocks, Codex's encrypted reasoning).
- Text Claude Code or Codex gave the agent other than your project's own instruction files: memory, reminders, user
  and managed instruction files (except Codex's `AGENTS.md` block in older Codex recordings, above). What the agent
  read with its own tools is a tool result, and is sent like one.
- Images in tool results (a screenshot the agent took or a picture it read), an image over the limits in the table
  above, the images of a message that also holds something the reviewer cannot be sent, audio, and documents (a PDF
  you attached is not read).
- A part of the session too large for one request: it is not sent at all, never cut down, and the review says it
  could not be checked.
- With the code step, any file outside your repository: its agents are confined to the working directory and the
  repository it lies in. (What the session itself read elsewhere is part of the session, above.)

## Nothing is masked or withheld

Sonah does not look for secrets, and it hides nothing for privacy's sake, in what it sends or in what it shows:

- the model reads the session as it was recorded: a key the agent printed, a token in a command, the output of a read
  of a credential file or of a file in Claude Code's or Codex's own folders;
- the code step's agents may open any file of your repository, a `.env`, a key file or a folder named `.claude` in it
  included, and quote what they read;
- the page, the Markdown report, the lines a review prints on the terminal and `sonah slice` show the session and the
  code as recorded: every quote, command, path and output they show is as it is in the recording or the file;
- a reason you give `sonah decision` is refused only for its length, never for what it holds.

The PR comment you can ask for quotes nothing by design: it carries counts and fixed sentences only, never a quote, a
file's text or a path (see Sharing).

The Markdown report is different. Sonah prints a `gh pr comment` command that posts it, but Sonah never runs that
command. If you post the report, the comment holds your words and the agent's words, secrets included. Anyone who
can read the pull request can read the comment. Read the report before you post it, as
its footer says.

To link the report to your code on GitHub, Sonah reads facts from your local git only. It reads the remote's URL and
the HEAD commit. It reads which files HEAD holds as Sonah reviewed them, and whether a remote branch holds a commit.
For this, Sonah never fetches, never pushes and never connects to GitHub.

Coding-session recordings can carry live secrets: an agent can print a key, a token or a password into its session.
So treat every page and Markdown file Sonah writes, and everything under `~/.sonah`, as holding your session as
recorded, like the recording itself.

## What stays on your computer, and where

| What | Where | Notes |
| --- | --- | --- |
| Your recordings | where your agent keeps them (`~/.claude/projects/`, `~/.codex/sessions/`) | Only read, never changed. |
| Stored model answers and the review's report | `~/.sonah/session-reviews/<a hash of the recording's path>/` (or `--state-dir DIR`) | Lets a review resume and a rerun cost nothing. The requests themselves are not stored. The answers and the report can quote the session as recorded, secrets included; they are never sent anywhere. Keep a `--state-dir` outside every Git repository, so they are never committed. With the code step, its agents' answers are kept apart in `code-pass/answers/` there, and the report also holds each changed file's path, state and SHA-256, the lines of any file of the repository its findings, the statements it found to hold and their checks quote, the words of what its checks withheld, and for each item of its item-by-item check the answer and the lines of code it quotes (never a whole file). The page and the Markdown report show only how many items that check did not examine in a way that Sonah could use. |
| Your answers to checklist rows (`sonah decision`) | `~/.sonah/decision-reviews.ndjsonl` | Never sent anywhere. |
| Your settings (`sonah config`) | `~/.sonah/config.json` | Whether the code step is on. Readable by you only; one that is not yours, that others can write or that cannot be read stops a review given no `--code-pass` or `--no-code-pass`, before anything is read. |
| The page or Markdown you asked for | the `--output` file | Never overwrites an existing file. It holds your session as recorded. |
| A PR comment's posting journal | `publication/` in the review's folder above | Only if you posted one. |
| A `sonah feedback` bundle | `~/sonah-feedback-YYYY-MM-DD.md` in your home folder | Setup facts and counts only. A second bundle on the same day replaces the first. |

Every file a review or `sonah decision` writes is readable by you only (folders `0700`, files `0600`). `SONAH_HOME`
moves `~/.sonah`. To delete everything Sonah stored, remove `~/.sonah`, the output files you wrote and any
`sonah-feedback-*.md` bundle; your recordings are not affected. If you used an early preview of Sonah, `~/.sonah` can
also hold `pr-reviews/`, `answers/`, `ledgers/` and `outcomes/` from it; you can delete them (a review still reads
the exit statuses an early preview's hook saved in `outcomes/`, and nothing writes there any more).

## Sharing

The page and the Markdown quote your session and your code as recorded, nothing masked. Read them before you share
them, as the page's footer says, and share them only where you would share the recording. The page runs no script and
loads nothing from the network.

Nothing is ever posted unless you ask. A review with `--github OWNER/REPO --pr N --post-comment` can leave one comment
and one neutral GitHub check on that pull request: it needs a private repository, a GitHub App token and your typed
confirmation after Sonah prints the exact comment. The token is read from `GH_TOKEN`, else `GITHUB_TOKEN`, else the
output of `gh auth token`, and is never printed or stored. Sonah reads only the pull request's metadata (never its
files or changes), and it posts counts and fixed sentences from the review's checklist only, never quotes, file text,
paths or the page; every text it carries is escaped, so GitHub reads none of it as markup or a mention (see
[INSTALL.md](INSTALL.md#posting-a-count-only-pr-comment)).
