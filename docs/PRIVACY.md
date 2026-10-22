# Privacy: what Sonah reads, sends, keeps and shows

Sonah runs on your computer. It reads the recording your coding agent (Claude Code, Codex or Cursor) already keeps,
and, with the code step (on by default, with the `claude` reviewer), your repository as it is now, through agents that
open, search and list its files with read-only tools. Since 0.3.0-beta.5 the code step also reads the files that the
session wrote in other git repositories, such as a sibling worktree, and its agents can read each repository that holds a
file of the change. A folder that no git repository holds, such as a notes folder, is never read: Sonah names it and
counts the files the session wrote there. The only thing that leaves your computer is the review itself:
requests to the model you choose, through your own `claude` or `codex` login, or your API key with `--backend
anthropic-api`.

Sonah masks nothing and withholds nothing for privacy's sake. The model reads your session as it was recorded and, in
the code step, any file of your repository, or of another git repository that holds a file of the change, that its
agents open. The page, the Markdown report, the terminal and the files
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
  read-only access to your repository and to each other repository or folder the session wrote to (the last row of the
  table below): one review agent, given the change the session
  made, each changed file whole, the lines the session read of files it left unchanged, your messages, the session
  review's list of asks, the project instruction and skill files the session loaded, Sonah's review of the session and,
  apart from the change, the files that differ but are outside the evaluated session, that reads what it needs of the
  repository as it works; at most one repair request after it; then one checking agent per finding it gives and one for
  its questions, each asked again at most once. Each checking agent's request holds your messages, the session review's
  list of asks (an ask in an agent's words by its key and whose words it is, never those words), the change, and the
  finding or questions it checks with the text of yours or of a recorded result that a finding quotes; the check of a
  finding marked outside the evaluated session also holds those files' changes. Beside them runs the code review's item-by-item check: one agent for each 30 items, at most 4, each
  asked again at most once. The items are the session review's asks (yours, and the asks that an agent wrote into a
  helper's brief), the statements that the agent wrote into a file and its decisions not to act. Each of these requests
  holds your messages, the session review's list of asks, the change, the code review's findings and questions, and
  Sonah's review of those items. Each agent's tool results (the files and search results it reads) go to the model as
  it works.
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
| The earlier recordings of a session continued after a compaction (Claude Code) | When the recording opens on a compaction, the recordings of the same folder that it continues, through the row the compaction links to, the same way as the recording itself. Sonah reads the other recordings of that folder only to find which one holds that row; it sends none of them. |
| Your project's instruction files | Each project instruction file Claude Code loaded into the session (a `CLAUDE.md`, or an `AGENTS.md` it names), whole, wherever it lies. In a Codex recording that does not mark which messages are yours (older Codex versions), Codex's `# AGENTS.md instructions` block is read as one of your messages and sent whole: it can hold your own `~/.codex/AGENTS.md` as well as the project's. |
| The reviewer's instructions | A fixed text that ships with Sonah. It holds no session text. |
| With the code step only (on by default with the `claude` reviewer; off with `sonah config code-pass off` or `--no-code-pass`; not run with `--backend codex-cli` or `anthropic-api`): the change the session made, and any file of your repository | The change: each file that differs from the commit the session started from (git's own list, read with git, which writes nothing: the commit the recording names, else the one your branch was on when the recording began) that a recorded write of the session could have changed, or whose last change came while the session ran (a file git shows changed that no recorded edit wrote is then included and marked; a file that differs but changed outside both, such as a later commit's, is outside the evaluated session: when the change holds a file to review, it is sent too, its lines at that commit and now, apart from the change and after it, and every finding about it is marked so, but one that a line the session changed causes; else it is named by its path only), its lines at that commit and now as git's own diff shows them (up to about 400 KB of them; a file whose lines do not fit is named, and the agent reads it itself); with no git history to start from, the session's own recorded edits. Also each changed file whole, as it is now, smallest first, up to about 400 KB in all (a file that does not fit is named with its line count, and the agent reads it itself); and the lines the session read with a file-reading tool (never a shell command) in files that did not change since the start commit, as they are now, up to about 400 KB. A binary file (and a file git diffs as binary, through a `binary` or `-diff` attribute, as lockfiles and minified files often have), a file too large for a request and a file the session deleted that is there again are named without their lines; a file that changed after the session's last recorded edit is sent like any changed file, its lines from the start commit to now. Git is asked about the working directory, and about the files the session wrote elsewhere in its repository: when it is a folder of a larger repository, the other paths that differ elsewhere in it are counted. Since 0.3.0-beta.5, the files the session wrote in another git repository (a sibling worktree, a repository nested in yours) are part of the change too: each such file that differs from the commit that repository was on when the recording began (by the same rule as yours), and each other file there whose last change came while the session ran (included and marked, as in your repository), their lines at that commit and now as git's own diff shows them; the other paths that differ there are outside the evaluated session, sent and marked as in your repository. With `--code-repo DIR` (since 0.3.0-beta.5), each git repository you give is read the same way, whatever the session wrote there (the repository that holds your working directory stays read by its own rule, as above): each file there that differs from the commit where it stood when the recording began and that a recorded write could have changed or whose last change came while the session ran (included and marked), with its lines at that commit and now; the other files that differ there, outside the evaluated session, sent and marked as in your repository; and, when it holds a file of the change, any file of it that the agents open. Such a repository is read only when a file the session wrote there is there now and differs from that commit (a repository you give with `--code-repo` is always read as above): a repository where every file the session wrote is not there, or has no difference, is counted, and nothing in it is read or sent. A repository inside your working directory follows your repository's rule: a file the session wrote there that differs from that commit, a deleted one included, is part of the change. A file the session wrote in a folder that no git repository holds (a notes folder, a temporary folder) is never read or sent: the report names its folder and counts its files. A write whose path holds a shell variable or command substitution the recording does not expand (such as `$DIR/notes.md`, written by a shell command) names no file Sonah can find: it is counted, and nothing is read for it; Sonah checks only whether that spelling, as recorded, names a file or folder that is there now (a relative spelling in the session's working folder, an absolute one where it points; whether it is there, never what it holds), or a path that git lists as differing from the start commit in your repository (a file the session deleted): the recording keeps no quotes, so a file named with a `$`, such as `users.$id.tsx`, is then a file of the change like any other. A link that git lists, or that changed while the session ran, is never followed out of the working directory, or out of the other repository it lies in: it is named, and the file it points to is neither read nor sent. A file the session wrote in Claude Code's, Codex's or Sonah's own folders, or named from your home folder (`~/…`), is counted, never read or sent; in another repository, the files in those folders are neither part of the change nor named. The project instruction files of the repository the session loaded (as it loaded them) and the skill files of the repository it used (as they are now), each whole. All of this goes in one request within its size limit; when it is over, Sonah leaves out whole parts (first the files outside the evaluated session, then the lines the session read, then the whole files, then early commands, then file changes, then rule files) and names each one. Then whatever the agents read: Claude Code's Read, Grep and Glob tools over the repository as it is in your working directory at review time (not as it was during the session), over the whole repository when the working directory is a folder of it, and over each other repository's top folder that holds a file of the change (its `--add-dir` folders; never a folder of no repository). Nothing in it is withheld: a credential-shaped file, a `.env` or a folder named `.claude` inside it is treated like any other file: sent whole when the session changed it, its lines sent when the session read it unchanged, and read when an agent opens it. The agents cannot run a command or write anything. These files can hold text the provider never saw during the session, such as lines the agent never read. |

Nothing in this table is held back because of what it holds or where it lies. The output of `cat .env`, a file the
agent read in Claude Code's or Codex's own folders (`~/.claude`, `~/.codex`, `~/.claude.json`), a key file's earlier
lines and a password typed into a command are sent as the recording holds them, within the limits above.

The default reviewer is the `claude` CLI with the model `claude-sonnet-5-5[1m]`, signed in with your own login. For the
session review it runs in an empty private folder with its tools, settings, plugins and slash commands switched off, and
it is given only the basic environment it needs (home folder, temporary folder, path, user and shell name, language and
the certificate settings), not your API keys or proxy settings. The code step's agents run in your working directory
instead, with the same basic environment and three read-only tools (Read, Grep and Glob), and nothing else: no settings,
MCP servers or slash commands, and your project's `CLAUDE.md` files are not loaded as their instructions (they may open
them as files). Claude Code's restricted mode confines them to the working directory, the repository it lies in, and
each other git repository that holds a file of the change (its top folder). A folder that no git repository holds is
never one of them, whatever the session wrote there.
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
- With the code step, any file outside your repository and outside the other git repositories that hold a file of the
  change: its agents are confined to the working directory, the repository it lies in and those repositories. A file the
  session wrote in Claude Code's, Codex's or Sonah's own folders, or in a folder that no git repository holds (your home
  folder, a notes or temporary folder), never makes its folder one of them: such a file is counted and its folder named,
  and nothing of it is read or sent. (What the session itself read elsewhere is part of the session, above.)

## Nothing is masked or withheld

Sonah does not look for secrets, and it hides nothing for privacy's sake, in what it sends or in what it shows:

- the model reads the session as it was recorded: a key the agent printed, a token in a command, the output of a read
  of a credential file or of a file in Claude Code's or Codex's own folders;
- the code step's agents may open any file of your repository, or of another repository or folder the session wrote
  to, a `.env`, a key file or a folder named `.claude` in it included, and quote what they read;
- the page, the Markdown report, the lines a review prints on the terminal and `sonah slice` show the session and the
  code as recorded: every quote, command, path and output they show is as it is in the recording or the file;
- a reason you give `sonah decision` is refused only for its length, never for what it holds.

The PR comment you can ask for quotes nothing by design: it carries counts and fixed sentences only, never a quote, a
file's text or a path (see Sharing).

The Markdown report is different. Sonah prints a `gh pr comment` command that posts it, but Sonah never runs that
command. If you post the report, the comment holds your words and the agent's words, secrets included. Anyone who
can read the pull request can read the comment. Read the report before you post it, as
its footer says.

When no code was reviewed, the first lines of the report name the folder that the code review looked in. The page and
the terminal name its full path. The Markdown report, which is meant for a pull request, names only the folder's name
(`Folder: my-app`), and your home folder itself as `~`, so this line never holds the path of your home folder or your
user name. The rest of the Markdown report still shows the session as recorded, and that can include paths.

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
