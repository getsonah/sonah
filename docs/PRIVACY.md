# Privacy: what Sonah reads, sends, keeps and shows

Sonah runs on your computer. It reads the recording your coding agent (Claude Code, Codex or Cursor) already keeps, and,
with the code step (on by default, with the `claude` reviewer), your working directory, its repository and the other git
repositories that the session wrote to or that you give with `--code-repo`, as they are now, with git and through agents
that open, search and list files with read-only tools. What leaves your computer is the review itself: requests to the
model you choose, through your own `claude` or `codex` login, or your API key with `--backend anthropic-api`. The only
other requests are a check for a newer Sonah that holds nothing about you or your work, once a day at most and only with
a review's first call to the reviewer or in `sonah doctor`, to npm's public registry, and requests to GitHub, only when
you name a pull request with `--github` ([below](#what-leaves-your-computer)). `sonah visual` reads a range of commits
from your local git, not a recording, and sends the change to the model through your own `claude` login; so does
`sonah review --format html`, for the session's commits, when the session's work is committed (D219; `--no-visual`
skips it).

Sonah masks nothing and withholds nothing for privacy's sake. The model reads your session as it was recorded and, in
the code step, the files it is sent and any file that its agents open. The page, the Markdown report, the terminal and
the files Sonah keeps under `~/.sonah` show and hold the session as recorded, secrets included: treat them as you treat
the recording itself. `sonah config code-pass off` (every review) or `--no-code-pass` (one review) keeps your repository
out; then only the session is sent. This page says exactly what each of these means.

## What leaves your computer

Three commands send anything to a model, and nothing else does:

- **`sonah review`** (not with `--dry-run`). Before the first request it prints roughly how many minutes the review
  should take, then it runs. Each part of the session is sent in a request of its own, more than once: one request asks
  for the checklist, then independent checking passes see the same part again, or the parts of it the checklist's
  items cite. Answers already stored on your computer are not asked again. With the code step (on unless you turned it
  off; the line printed before the first request says which; only with the `claude` reviewer) it also runs agents with
  read-only access to the folders that the last row of the table below names: one review agent, given the change the
  session made, each changed file whole, the lines the session read of files it left unchanged, your messages, the
  session review's list of asks, the project instruction and skill files the session loaded, Sonah's review of the
  session and, apart from the change, the files that differ but are outside the evaluated session, that reads what it
  needs of the repository as it works; at most one repair request after it; then one checking agent per finding it gives
  and one for its questions, each asked again at most once. Each checking agent's request holds your messages, the
  session review's list of asks (an ask in an agent's words by its key and whose words it is, never those words), the
  change, and the finding or questions it checks with the text of yours or of a recorded result that a finding quotes;
  the check of a finding marked outside the evaluated session also holds those files' changes. Beside them runs the code
  review's item-by-item check: one agent for each 30 items, at most 4, each asked again at most once. The items are the
  session review's asks (yours, and the asks that an agent wrote into a helper's brief), the statements that the agent
  wrote into a file and its decisions not to act. Each of these requests holds your messages, the session review's list
  of asks, the change, the code review's findings and questions, and Sonah's review of those items. Each agent's tool
  results (the files and search results it reads) go to the model as it works.
- **`sonah doctor`** without `--no-probe`: one tiny synthetic request that quotes no session, to check that the model
  answers.
- **`sonah visual`** (not with `--replay-only`), plain `sonah` in a terminal, which runs it, and `sonah review` when it
  writes its HTML page (`--format html --output`, and the background review of /sonah), on the `claude` reviewer, with
  no `--no-visual` and no limit of calls or size, and only when each file of the change that the code review read is
  committed: the change of the range it draws, read with git from your commits (your uncommitted work is not read). For
  the review, the range is from the commit where the session started to `HEAD`, which can hold commits made after the
  session; with `--code-base`, it starts where your branch and that base meet, so it holds the whole branch. The
  requests hold the repository's name (the last part of its `origin` address, else its folder's name), the range's two
  commits (12 characters of each), the commits' messages, the changed files' paths and line counts, and each changed
  function's name, place and code after the change, its added and removed lines marked, with which changed functions
  name each other and how many other places name it. Requests of at most 25 changed functions each describe them; one
  asks for the story of the change, with the checked descriptions; one asks what a reviewer must act on or know. A
  request whose answer does not fit is asked again, with what was wrong. No recording and no other file is sent. The
  calls run as a session review's do: the `claude` CLI in an empty private folder, with its tools off, the same basic
  environment and your login (never an API key), and the model `claude-sonnet-5-5` unless you give `--model` to
  `sonah visual` (the review always uses `claude-sonnet-5-5` for it, never its own `--model`). Answers stored in its
  folder are not asked again.

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
| With the code step only (on by default with the `claude` reviewer; off with `sonah config code-pass off` or `--no-code-pass`; not run with `--backend codex-cli` or `anthropic-api`): the change the session made, and files of the repositories the code step reads | The code step reads the git repository that holds your working directory (or that folder alone, when no repository holds it), each other git repository that holds a file of the change, and each one you give with `--code-repo`. Its agents can open any file of the first two of these. A repository you give that holds no file of the change is not one of their folders, so they open its files only when it lies inside one of those. When the change is reviewed in parts, they can also open Sonah's copy of the changed files as they were at the start commit. For each other git repository the session wrote to, git is also asked whether the files it wrote there differ from the commit where that repository stood when the recording began. The change: each file that differs from the commit the session started from (git's own list, read with git, which writes nothing: the commit the recording names, else the one your branch was on when the recording began; with `--code-base REF`, where that ref and your branch meet, and then every tracked file that differs under the working directory is part of the change) that a recorded write of the session could have changed, that a commit the session made changed (a merge only for the files it changed itself), or whose last change came while the session ran and that was not committed when the agent stopped (a file git shows changed that no recorded edit wrote is then included and marked; a file that differs and meets none of these, such as a later commit's, is outside the evaluated session: when the change holds a file to review, it is sent too, its lines at that commit and now, apart from the change and after it, and every finding about it is marked so, but one that a line the session changed causes; else it is named by its path only), its lines at that commit and now as git's own diff shows them (up to about 400 KB of them; a file whose lines do not fit is named, and the agent reads it itself); with no git history to start from, the session's own recorded edits. Also each changed file whole, as it is now, smallest first, up to about 400 KB in all (a file that does not fit is named with its line count, and the agent reads it itself); and the lines the session read with a file-reading tool (never a shell command) in files that did not change since the start commit, as they are now, up to about 400 KB. A binary file (and a file git diffs as binary, through a `binary` or `-diff` attribute, as lockfiles and minified files often have), a file too large for a request and a file the session deleted that is there again are named without their lines; a file that changed after the session's last recorded edit is sent like any changed file, its lines from the start commit to now. Git is asked about the working directory, and about the files the session wrote elsewhere in its repository: when it is a folder of a larger repository, the other paths that differ elsewhere in it are counted. Since 0.3.0-beta.5, the files the session wrote in another git repository (a sibling worktree, a repository nested in yours) are part of the change too: each such file that differs from the commit that repository was on when the recording began (by the same rule as yours), and each other file there by the same rule as yours (in a commit the session made, or last changed while the session ran and not committed when the agent stopped; included and marked), their lines at that commit and now as git's own diff shows them; the other paths that differ there are outside the evaluated session, sent and marked as in your repository. With `--code-repo DIR` (since 0.3.0-beta.5), each git repository you give is read the same way, whatever the session wrote there (the repository that holds your working directory stays read by its own rule, as above): each file there that differs from the commit where it stood when the recording began and that a recorded write could have changed, or that the same rule places (included and marked), with its lines at that commit and now; the other files that differ there, outside the evaluated session, sent and marked as in your repository; and any file of it that the agents open (above). A repository inside your working directory follows your repository's rule: a file the session wrote there that differs from that commit, a deleted one included, is part of the change. A write whose path holds a shell variable or command substitution the recording does not expand (such as `$DIR/notes.md`, written by a shell command) names no file Sonah can find: it is counted, and nothing is read for it; Sonah checks only whether that spelling, as recorded, names a file or folder that is there now (a relative spelling in the session's working folder, an absolute one where it points; whether it is there, never what it holds), or a path that git lists as differing from the start commit in your repository (a file the session deleted): the recording keeps no quotes, so a file named with a `$`, such as `users.$id.tsx`, is then a file of the change like any other. A link that git lists, or that changed while the session ran, is never followed out of the working directory, or out of the other repository it lies in: it is named, and the file it points to is neither read nor sent. In another repository, the files in Claude Code's, Codex's or Sonah's own folders are neither part of the change nor named. The project instruction files of the repository the session loaded (as it loaded them) and the skill files of the repository it used (as they are now), each whole. All of this goes in one request within its size limit; when it is over, Sonah leaves out whole parts (first the files outside the evaluated session, then the lines the session read, then the whole files, then early commands, then file changes, then rule files) and names each one. Then whatever the agents open with Claude Code's Read, Grep and Glob tools in the folders above, as they are at review time (not as they were during the session). Nothing in them is withheld: a credential-shaped file, a `.env` or a folder named `.claude` inside them is treated like any other file: sent whole when the session changed it, its lines sent when the session read it unchanged, and read when an agent opens it. The agents cannot run a command or write anything. These files can hold text the provider never saw during the session, such as lines the agent never read. |

Nothing in this table is held back because of what it holds. The output of `cat .env`, a file the agent read in Claude
Code's or Codex's own folders (`~/.claude`, `~/.codex`, `~/.claude.json`), a key file's earlier lines and a password
typed into a command are sent as the recording holds them, within the limits above.

The default reviewer is the `claude` CLI with the model `claude-sonnet-5-5[1m]`, signed in with your own login. For the
session review it runs in an empty private folder with its tools, settings, plugins and slash commands switched off, and
it is given only the basic environment it needs (home folder, temporary folder, path, user and shell name, language and
the certificate settings) and your login: your Claude Code config folder (the one `CLAUDE_CONFIG_DIR` names, when you
set it), and `CLAUDE_CODE_OAUTH_TOKEN` when you set it. Not your API keys or proxy settings. It runs in Claude Code's
safe mode and loads no `CLAUDE.md` file. On each call Claude Code itself updates its state file (`~/.claude.json` in
your home folder, or `.claude.json` inside the folder `CLAUDE_CONFIG_DIR` names) and its plugin cache in your config
folder, as in any session of yours. With `CLAUDE_CONFIG_DIR` set, these writes now go to your folder. The code step's
agents run in your working directory instead, with the same basic environment and three read-only tools (Read, Grep and
Glob), and nothing else: no settings, MCP servers or slash commands, and your project's `CLAUDE.md` files are not loaded
as their instructions (they may open them as files). Claude Code's restricted mode confines them to the folders that
the last row of the table above says they can open.
`--backend codex-cli --model gpt-6.1-sol` uses your `codex` login instead, read-only, with its tools and web search off.
`--backend anthropic-api` posts the same requests to Anthropic's API with your `ANTHROPIC_API_KEY`.

Sonah sends nothing to us: no telemetry, no analytics. It makes one request that you do not ask for, the update check:
once a day at most, with a review's first call to the reviewer and in `sonah doctor`, a GET of
`https://registry.npmjs.org/-/package/getsonah/dist-tags`, npm's public list of getsonah's version tags, so that it can
tell you when a newer Sonah is out (one line on stderr after the review, a line in `sonah doctor`, and a line in the
review page's footer). A dry run, a review that stops before its first call to the reviewer, a review on stored answers
alone and every other command never check. The request holds no session text, path, setting, token or id: npm's registry
sees the request itself, from your IP address, as for any package download. Sonah gives up after 2 seconds and says
nothing when the registry does not answer, keeps the answer and its time in `~/.sonah/update-check.json`, and never
installs anything. `sonah config update-check off` or `SONAH_NO_UPDATE_CHECK=1` turns it off, and it is off whenever
`CI` is set.

The other requests go to GitHub, both only when you name a pull request: a PR comment you ask for with `--github
OWNER/REPO --pr N --post-comment`, for which Sonah reads that pull request's metadata and posts the comment only once
you confirm it (see Sharing below); and `sonah sessions --github OWNER/REPO --pr N`, which reads that pull request's
metadata and the list of its commits (their ids, messages and times) and posts nothing ([The Agent-Session
line](#the-agent-session-line)). Each sends your GitHub token when you have one. Your provider's own terms apply to what
it receives.

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
- With the code step, any file outside the working directory and the repositories that the code step reads (above),
  other than Sonah's copy of their files. (What the session itself read elsewhere is part of the session, above.)

## Nothing is masked or withheld

Sonah does not look for secrets, and it hides nothing for privacy's sake, in what it sends or in what it shows:

- the model reads the session as it was recorded: a key the agent printed, a token in a command, the output of a read
  of a credential file or of a file in Claude Code's or Codex's own folders;
- the code step's agents may open any file of the folders they can read (above), a `.env`, a key file or a folder
  named `.claude` in them included, and quote what they read;
- the page, the Markdown report, the lines a review prints on the terminal and `sonah slice` show the session and the
  code as recorded: every quote, command, path and output they show is as it is in the recording or the file;
- a reason you give `sonah decision` is refused only for its length, never for what it holds.

The PR comment you can ask for quotes nothing by design: it carries counts and fixed sentences only, never a quote, a
file's text or a path (see Sharing).

The Markdown report is different. Sonah prints a `gh pr comment` command that posts it, but Sonah never runs that
command. If you post the report, the comment holds your words and the agent's words, secrets included. Anyone who
can read the pull request can read the comment. Read the report before you post it.

The prompt for the agent under a Must act item, on the page and in the .md, quotes only what its item shows, so it
adds nothing that the report does not already hold. When you paste it into your agent, it goes to that agent's provider
like any message that you type.

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
| Stored model answers and the review's report | `~/.sonah/session-reviews/<a hash of the recording's path>/` (or `--state-dir DIR`) | Lets a review resume and a rerun cost nothing. The requests themselves are not stored. The answers and the report can quote the session as recorded, secrets included; they are never sent anywhere. Keep a `--state-dir` outside every Git repository, so they are never committed. With the code step, its agents' answers are kept apart in `code-pass/answers/` there (and, while a change reviewed in parts is checked, Sonah's copy of its changed files, in `code-pass/start-commit/`), and the report also holds each changed file's path, state and SHA-256, the lines of any file its findings, the statements it found to hold and their checks quote, the words of what its checks withheld, and for each item of its item-by-item check the answer and the lines of code it quotes (never a whole file). The page and the Markdown report show only how many items that check did not examine in a way that Sonah could use. |
| Your answers to checklist rows (`sonah decision`) | `~/.sonah/decision-reviews.ndjsonl` | Never sent anywhere. |
| Your settings (`sonah config`) | `~/.sonah/config.json` | Whether the code step is on. Readable by you only; one that is not yours, that others can write or that cannot be read stops a review given no `--code-pass` or `--no-code-pass`, before anything is read. |
| The update check's setting (`sonah config update-check`) | `~/.sonah/update-check-setting.json` | Whether the update check is on, once you set it. Readable by you only; one that is not yours, that others can write or that cannot be read turns the check off. |
| The update check's last answer | `~/.sonah/update-check.json` | When Sonah last asked npm's registry for getsonah's latest version, and the version it answered (none when it did not answer). Readable by you only. Written only with a review's first call to the reviewer and by `sonah doctor`, and not while the check is off. |
| The page or Markdown you asked for | the `--output` file | Never overwrites an existing file. It holds your session as recorded. |
| The page of a change (`sonah visual`, and the graphs page of a review's HTML page) | `~/.sonah/visual/<the repository folder's name and a hash of its path>/<the range's two commits and the model>/` (or `--out DIR`) | Only if you ran it, or a review drew it (the review's page links to its `page.html` by its full path; the Markdown report never names it). The page (`page.html`), each request as it was sent (`requests/`) and its answer (`answers/`), what Sonah read of the change (`facts.json`), and what it kept and why (`meaning.json`, `findings.json`, `dropped.json`, `run.json`). A rerun of the same range with the same model replays the stored answers. They quote your code as it is in the commits; they are never sent anywhere. Sonah never deletes this folder: remove it when you no longer need it. |
| A PR comment's posting journal | `publication/` in the review's folder above | Only if you posted one. |
| The /sonah skill (`sonah skill add`) | `~/.claude/skills/sonah/SKILL.md` (or under `CLAUDE_CONFIG_DIR`) | Only if you added it. It holds no session text: when you type `/sonah`, it runs `sonah review --session <the session's id> --background`, which reads and sends what `sonah review` does. `sonah skill remove` deletes it. |
| The page, Markdown report and log of `sonah review --session ID --background` | `background/` in the review's folder above | Only if you ran one. The page and the report hold your session as recorded; the log holds what the review printed. `active.json` there holds the process id of the review it started, nothing else. |
| Where a review by `sonah review --session ID` cut your recordings | `review/frozen-read.json` in the review's folder above | Only for a review by session id. The time the review took its cut; the reviewed recording's full path and its size then; and the path and size then of each recording file in the folder the review reads (Claude Code: the session's project folder; Codex: every rollout under `~/.codex/sessions`). Paths and sizes only, no session text. |
| A `sonah feedback` bundle | `~/sonah-feedback-YYYY-MM-DD.md` in your home folder | Setup facts and counts only. A second bundle on the same day replaces the first. |
| The commit link's hook (`sonah hook add`) | `.git/hooks/prepare-commit-msg` (`prepare-commit-msg.old` or `.legacy` when lefthook or pre-commit moved it) and `.git/sonah/` in that repository: the script `agent-session.sh`, and `hooks-folder-made` when Sonah made the hooks folder | Only where you ran it. It holds no session text; `sonah hook remove` deletes these files. The `Agent-Session` lines it added stay in your commits. |

Every file a review or `sonah decision` writes is readable by you only (folders `0700`, files `0600`). `sonah visual`
makes each of its folders readable by you only (`0700`), and writes the files in them with your usual permissions.
`SONAH_HOME` moves `~/.sonah`. To delete everything Sonah stored, run `sonah skill remove` if you added the /sonah
skill, run
`sonah hook remove` in each repository where you ran `sonah hook add`, and remove `~/.sonah`, the output files you wrote
and any `sonah-feedback-*.md` bundle; your recordings are not affected. If you used an early preview of Sonah, `~/.sonah` can
also hold `pr-reviews/`, `answers/`, `ledgers/` and `outcomes/` from it; you can delete them (a review still reads
the exit statuses an early preview's hook saved in `outcomes/`, and nothing writes there any more).

## The Agent-Session line

Off until you run `sonah hook add` in a repository ([INSTALL.md](INSTALL.md#link-commits-to-sessions)). Then each
commit that your Claude Code agent makes there ends with one line, `Agent-Session: <id>`, the id of the agent's session
as Claude Code gives it. The hook adds nothing else: no part of the recording, no path and no name, and it changes
nothing else in the message. It runs on your computer, calls only `git` and `tail`, and sends nothing. The line leaves
your computer when you push the commit, as the rest of the commit does. Codex sessions get no line yet.

What the line tells anyone who can read the commit:

- that a Claude Code session made the commit (its id is a random UUID, version 4, which shows no time);
- that commits that carry the same id, in any repository, branch or fork, came from one session.

It does not reveal the recording: the id is the recording's file name on the computer where the agent ran, which only
someone with that computer can open. Sonah masks nothing, so the id is written as Claude Code gives it, not hashed. In
a public repository the line is public and stays in the history: removing it means rewriting history.
`sonah hook remove` stops new lines; uninstalling Sonah does not, so run it first.

`sonah sessions --commits A..B` reads the range's messages with git and the recordings on this computer, prints each
session's id and its recording's path, and sends nothing. `sonah review --commits A..B` reads the same to choose the
session, then reviews it like any `sonah review`, which sends what
[What leaves your computer](#what-leaves-your-computer) lists.
`sonah sessions --github OWNER/REPO --pr N` asks GitHub for that pull request and the list of its commits (their ids,
messages and times), GET requests only, with your token when you have one; it sends nothing else. When GitHub's list is
not whole, it prints the `git fetch` command that reads the rest; you run it, Sonah does not.

## Sharing

The page and the Markdown quote your session and your code as recorded, nothing masked. Read them before you share them,
and share them only where you would share the recording. The page loads nothing from the network. Its one script copies
a prompt for the agent and follows the page's links to their place. For Back, each link it follows adds an entry to the
browser's history, and the script keeps in the current entry the tab you are on, the scroll and the link you took, and
the new entry names the place. It reads only the address's `#` part and those entries, and sends nothing. The page of
`sonah visual` quotes your code and loads nothing from the network either. Its script moves between its parts and
graphs, keeps your light or dark choice in the browser, and sends nothing. When `sonah review --format html` drew the
graphs page of the session's commits (D219), its page links to that page by its full path on your computer (a `file:`
link, which names your home folder): a copy of the page that you share names that path, and the link opens nothing on
another computer. The Markdown report never holds it.

Nothing is ever posted unless you ask. A review with `--github OWNER/REPO --pr N --post-comment` can leave one comment
and one neutral GitHub check on that pull request: it needs a private repository, a GitHub App token and your typed
confirmation after Sonah prints the exact comment. The token is read from `GH_TOKEN`, else `GITHUB_TOKEN`, else the
output of `gh auth token`, and is never printed or stored. Sonah reads only the pull request's metadata (never its
files or changes), and it posts counts and fixed sentences from the review's checklist only, never quotes, file text,
paths or the page; every text it carries is escaped, so GitHub reads none of it as markup or a mention (see
[INSTALL.md](INSTALL.md#posting-a-count-only-pr-comment)).
