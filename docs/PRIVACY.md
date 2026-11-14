# Privacy: what Sonah reads, sends, keeps and shows

Sonah runs on your computer. It reads the recording your coding agent (Claude Code, Codex or Cursor) already keeps, and,
with the code step (on by default, with the `claude` reviewer), your working directory, its repository and the other git
repositories that the session wrote to or that you give with `--code-repo`, as they are now, with git and through agents
that open, search and list files with read-only tools. What leaves your computer is the review itself: requests to the
model you choose, through your own `claude` or `codex` login, or your API key with `--backend anthropic-api`. Besides
those, Sonah makes a check for a newer Sonah that holds nothing about you or your work, once a day at most and only with
a review's first call to the reviewer or in `sonah doctor`, to npm's public registry; requests to GitHub's API, only
when you name a pull request with `--github` ([below](#what-leaves-your-computer)); and, once you connect this computer
to Sonah Team, Sonah's hosted team version, the calls of its team commands to that server
([below](#sonah-team-each-call-and-what-the-server-keeps)). In a repository where you turn the push hook on, each push
then sends a review there with no button press. That review, and `sonah share`, may also ask the remote you push to, on
GitHub or elsewhere, about its branches with `git ls-remote`, as `git fetch` would
([below](#sonah-team-the-push-hook)); in a partial clone, their git reads and those of `sonah fix` may also make git
fetch a commit your clone does not hold ([below](#what-leaves-your-computer)). `sonah visual` reads a range of
commits from your local git, not a recording, and sends the change to the model through your own `claude` login; so
does `sonah review --format html`, for the session's commits, when the session's work is committed (D219;
`--no-visual` skips it). That page has "Save online" and "Invite your team": only when you press one does your browser
send that review to Sonah's hosted team version ([below](#save-online-and-invite-your-team)).

Sonah masks nothing and withholds nothing for privacy's sake. The model reads your session as it was recorded and, in
the code step, the files it is sent and any file that its agents open. The page, the Markdown report, the terminal and
the files Sonah keeps under `~/.sonah` show and hold the session as recorded, secrets included: treat them as you treat
the recording itself. `sonah config code-pass off` (every review) or `--no-code-pass` (one review) keeps your repository
out; then only the session is sent. This page says exactly what each of these means.

## What leaves your computer

Three commands send anything to a model, and so does the review of a push once you turn the push hook on; nothing else
does:

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
  folder are not asked again. The review of each push, in a repository where you turned the push hook on, draws its
  page the same way, in the background, with the model `claude-sonnet-5-5`
  ([Sonah Team: the push hook](#sonah-team-the-push-hook)).

`sonah fix` sends no request to a model itself. After your yes, it starts Claude Code on your own login with one prompt
([Sonah Team: `sonah fixes` and `sonah fix`](#sonah-team-sonah-fixes-and-sonah-fix)), and what Claude Code then sends
is Claude Code's own, as in any session of yours.

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

Sonah has no telemetry and no analytics. Your work reaches Sonah's server, Sonah Team, when you press "Save online" or
"Invite your team" on a graphs page ([below](#save-online-and-invite-your-team)), when you run `sonah share`
([below](#sonah-team-sonah-share)), and, in a repository where you turned the push hook on with `sonah hook add --push`
(or with a yes to `sonah connect`'s question there), at each push from it, with no button press
([below](#sonah-team-the-push-hook)). `sonah connect`, `sonah disconnect`, `sonah status`, `sonah hook add --push`,
`sonah fixes` and `sonah fix` call that server too, only when you run them, and send no recording, code or path of
yours ([below](#sonah-team-each-call-and-what-the-server-keeps) lists each call). Once you turn the Claude Code start
reminder on with `sonah remind on`, a start of Claude Code can ask that server again for the comments that wait for
you, at most once a minute a repository ([below](#sonah-team-the-claude-code-start-reminder)). Apart from the push hook
and the reminder, which you turn on yourself, Sonah makes one request that you do not ask for, the update check: once a
day at most, with a review's first call to the reviewer and in `sonah doctor`, a GET of
`https://registry.npmjs.org/-/package/getsonah/dist-tags`, npm's public list of getsonah's version tags, so that it can
tell you when a newer Sonah is out (one line on stderr after the review, a line in `sonah doctor`, and a line in the
review page's footer). A dry run, a review that stops before its first call to the reviewer, a review on stored answers
alone and every other command never check. The request holds no session text, path, setting, token or id: npm's
registry sees the request itself, from your IP address, as for any package download. Sonah
gives up after 2 seconds and says nothing when the registry does not answer, keeps the answer and its time in
`~/.sonah/update-check.json`, and never installs anything. `sonah config update-check off` or `SONAH_NO_UPDATE_CHECK=1`
turns it off, and it is off whenever `CI` is set.

The other requests go to GitHub's API, both only when you name a pull request: a PR comment you ask for with `--github
OWNER/REPO --pr N --post-comment`, for which Sonah reads that pull request's metadata and posts the comment only once
you confirm it (see Sharing below); and `sonah sessions --github OWNER/REPO --pr N`, which reads that pull request's
metadata and the list of its commits (their ids, messages and times) and posts nothing ([The Agent-Session
line](#the-agent-session-line)). Each sends your GitHub token when you have one. Your provider's own terms apply to what
it receives. Apart from these, the review of a push and `sonah share` may ask the remote you push to, wherever it is,
for a branch's commit or its default branch, with `git ls-remote` ([below](#sonah-team-the-push-hook)).

In a partial clone (one made with `git clone --filter`, as Scalar makes), git itself fetches from the remote an object
that a command reads and the clone does not hold, unless it is told not to. Sonah tells it not to when it draws the
graphs page (for `sonah visual`, plain `sonah`, `sonah review --format html` and the review of a push), so that drawing
never fetches. The other git reads of the review of a push, `sonah share` and `sonah fix` do not: in a partial clone,
each may make git fetch a commit your clone does not hold from the remote the clone was made from. The review of a
push may fetch the commit that `git ls-remote --symref` named as the tip of your remote's default branch, and the
commits before it, while it looks for where your branch left that branch; `sonah share`, the branch's commit that its
`git ls-remote` named, and the commit of a page that `--dir` names; and `sonah fix`, the review's head and the commits
of its range. Each is a fetch from that remote, and git keeps what it fetched in your clone's `.git/objects`. In a
clone that is not partial, these reads fetch nothing: a commit the clone does not hold is only missing.

### Save online and Invite your team

The graphs page (of `sonah visual`, of plain `sonah` and of `sonah review --format html`) has "Save online" and
"Invite your team" when the push remote of the repository names its owner and name: the remote your branch pushes to
(`branch.<name>.pushRemote`, `remote.pushDefault`, `branch.<name>.remote`), else `origin`, else your only remote,
and its address read from your local git, never shown. A remote that is a folder on your computer, or a `file:`
address, names none, and the page then has neither button. Drawing the page sends nothing, and the page makes no request
when you open it.

When you press one of the two buttons, your browser opens a new tab and posts a form to the server's `/share` page:
`https://pr.sonah.dev/share`, Sonah's hosted team version (Sonah Team), unless you gave `sonah visual --server URL`
(https, or http for this computer only). On a page of `sonah visual` or of plain `sonah`, with no `--server`, that
server is the one this computer was connected to with `sonah connect`
([below](#sonah-team-connecting-this-computer)) when Sonah drew the page, and `https://pr.sonah.dev` when it was
connected to none then or when Sonah could not read the connection. The graphs page that `sonah review --format html`
draws names that server too. Sonah writes that address into the page when it draws it, and the buttons post to the
address the page holds, whenever you press them: a page drawn before you connected, or under a connection you have
since ended or replaced, still sends its review to the server it names, not to the one this computer is connected to
now. Drawing the same range again writes the page anew with the server of the connection then, and `sonah share` sends
a page to the server of this computer's connection whichever server the page names
([below](#sonah-team-sonah-share)). Only the server's address goes into the page: your upload token never does, and
the page's buttons send no token. The form holds two fields: whether you pressed Save online or Invite your team,
and the review as the page holds it: the page as the team's site shows it, and the folder's `facts.json`,
`meaning.json`, `findings.json` and `run.json`. Those hold the repository's name; the range's two ends and each of its
commits' full id, subject and body; the changed files' paths and line counts; each changed function's code with its
added and removed lines; the story of the change; the findings with the lines they quote; and the run's calls, models,
times and list cost. They also hold code from outside the change: for each changed function, up to 10 other places in
the repository that call it, each with its path, its line and the line that starts the function it is in, in any
language; and, where the change is in JavaScript, TypeScript, Python or Go, the paths of up to 5 unchanged test files
that call each changed function, and up to 300 unchanged functions elsewhere in the repository that call a changed one,
each with its path, name, owner and line. With them go the repository's owner and name from the remote's address and the
branch whose tip is the head of the range (none when no branch points at it). No path, token, setting or recording of
your computer is in it. Over 25 MB the page holds no review, and the buttons only open the server's page of that review,
which then cannot be saved from there.

Until you sign in there, the server keeps the review for up to an hour, and saves it to your account when you do; when
you do not, its hourly clean-up deletes it after that hour (within a day at the latest). Whether or not you sign in, its
log names the repository and the first 7 characters of the head commit each time a review waits to be saved, and a hash
of your address is counted for a day for its rate limit; on https://pr.sonah.dev, the hosting's own request log also
notes the call, with your IP address ([below](#sonah-team-each-call-and-what-the-server-keeps)). Pressing Save online on
a newer review of the same branch updates the same saved review. "Invite your team" saves it too and opens the invite.
What your team can see there follows Sonah Team's own rules and plan, on its site.

### Sonah Team: each call, and what the server keeps

Sonah Team is Sonah's hosted team version: https://pr.sonah.dev, or the server you name with `--server` when you
connect. Until you connect this computer to it with `sonah connect`, no command of Sonah calls it ("Save online" and
"Invite your team" are your browser's, above). These are all the calls Sonah makes to it:

| Call | Made by | What it sends besides the token | Waits for an answer |
| --- | --- | --- | --- |
| `POST /api/device/exchange` | `sonah connect <code>`, in a terminal only | The code, and the name of the token it makes: `sonah on <your computer's host name>` (60 characters at most). It sends no token: this call makes one. | 30 seconds |
| `GET /api/token` | `sonah connect`, `sonah status`, and `sonah hook add --push` while this computer is connected | Nothing. The server answers with the token's login, the team's name and your seat. | 15 seconds |
| `DELETE /api/token` | `sonah disconnect`; `sonah connect <code>` when you answer no or it cannot keep the token; and a new connection that replaces this one | Nothing. The server revokes the token that makes the call, and no other. | 15 seconds |
| `GET /api/fixes?owner=<owner>&repo=<name>` | The review of a push (before its first model call, and once more after its queue), `sonah fixes`, and the start reminder's refresh | The owner and name of a repository, as the address of your push remote names them. | 15 seconds |
| `POST /api/uploads` | The review of a push, and `sonah share` | The review, the branch and `sessions` ([below](#sonah-team-the-push-hook)). | 2 minutes |
| `GET /api/fixes/<comment id>` | `sonah fix` | The comment's id. | 15 seconds |
| `POST /api/fixes/<comment id>/launched` | `sonah fix`, after your yes | The id of the Claude Code session it starts, and the id of the session that one forks (none for a new session). | 5 seconds |

Each call goes only to the server of this computer's connection: `sonah connect`'s own calls go to the server it
connects to, and the revoke of a token that a new connection replaces goes to that token's own server. The token goes
only in the call's `Authorization` header, never in an address, and Sonah never prints it or writes it anywhere but
`~/.sonah/team/connection.json`. Sonah follows no redirect, so the token cannot go anywhere else. Each call names Sonah
as `getsonah` in its `User-Agent` header. A call that has no answer in its time counts as not answered. A `401` to the
token this computer keeps marks the connection refused here (`~/.sonah/team/refused.json`): from then on a push starts
nothing, and `sonah share`, `sonah fixes`, `sonah fix` and the start reminder send nothing, until you connect again.
`sonah status` still asks whose the token is. These calls mark nothing on a `401`: those of `sonah connect` and
`sonah disconnect`, the `GET /api/fixes` that the review of a push makes after its queue, and `sonah fix`'s
`POST /api/fixes/<comment id>/launched`. After a `401` to one of the last two, the next push, `sonah share`,
`sonah fixes`, `sonah fix` or the start reminder still calls the server, and a `401` to that call marks the connection.

**What the server keeps.** The server keeps each token as its SHA-256 hash, never the token itself, with its name (the
one `POST /api/device/exchange` sends), your account and login, whether it came from a code or from the tokens page,
when it was made, when it was last used and when it was revoked. A token does not expire: it works until you revoke
it, with `sonah disconnect` or on the server's `/settings/tokens` page, which lists your tokens by their names, your
host name among them. It keeps each upload (`POST /api/uploads`) with your account and login, the id of the token that
sent it and the time, as a version of your review of that branch, for your team as your seat allows (on a server with
a GitHub App, for whoever can read the repository on GitHub: [Sharing](#sharing)). Each
`POST /api/fixes/<comment id>/launched` that it takes adds a line to that comment's fix: your account and login, the
time, the id of the Claude Code session and the id of the session it forks. When that fix had no line before, the
server may also tell the comment's writer, and your team's webhooks, that the fix started.

Whatever your seat, every upload, from the review of a push or from `sonah share`, also reaches your team's webhooks:
the server tells each webhook of your team that asks for new versions (an address outside Sonah Team that your team's
admins chose) that the review has one, with the review's link, the repository, the pull request and the range's two
commits. When the upload's `sessions` answer a comment whose fix you started with `sonah fix`, with commits that fix did
not hold yet, the server adds a `pushed` line to that comment's fix: your account and login, the time, the id of the
session, the id of the session it forks, the head and those commits' ids. It may then tell the comment's writer, and it
tells your team's webhooks, that the fix was pushed, with those commits' ids, the item's title and the comment's words
in full. What the writer and the webhooks are told, of a fix started or pushed, holds no session id. The server keeps
what it sent each webhook for up to 30 days.

Its log notes your login when a computer connects with a code, when one revokes its own token, and at each
upload, with the repository and the first 7 characters of the commit; on a server with a GitHub App, also when GitHub
does not answer it about a call of yours. On https://pr.sonah.dev, which runs on Google Cloud Run, the platform's own
request log also notes every call to it, Sonah's and your browser's: its path with the query (so a repository's owner
and name, or a comment's id), the IP address it came from, its `User-Agent`, the time and the answer's status. Only the
project's owners can read it, and Google Cloud keeps it for 30 days unless they change that; a server you name with
`--server` logs what its own hosting logs. For its limits, it counts each code tried from your address, whether it
matches or not, over a minute, and each call made with a token but the revoke, over an hour. On https://pr.sonah.dev,
each try is a row that holds a SHA-256 hash of your address (an IPv4 address can be found from it by hashing every
address) and the time, and each call a row that holds a SHA-256 hash of the token's id and the time; its hourly
clean-up deletes these rows once they are a day old, so for a day it holds when each of your tokens made each call. It
also counts, as its usage, each computer that connects with a code, each upload made with a token and each `launched`
call that it takes, with the time, your account and your team, and for a `launched` call the review. The lines of a
fix and the usage are logs that the server only adds to: it changes and deletes none of their lines. Sonah has no
command that deletes an upload, and Sonah Team has no way to delete a review yet: what you send stays there.

### Sonah Team: connecting this computer

`sonah connect`, `sonah disconnect` and `sonah status` connect this computer to Sonah Team (https://pr.sonah.dev, or
the server `--server` names: https, or http for this computer only), end that connection, and show it. They send no
recording, code, path or setting, and each call goes only to that server:

- `sonah connect <code>` sends the code and a name for the token, `sonah on <your computer's host name>` (60 characters
  at most), with `POST /api/device/exchange`. The server makes an upload token for the person who asked for the code
  and answers with it. Sonah then asks with `GET /api/token` whose that token is: the server answers with the login,
  the team's name and your seat (paid or free). Sonah shows them and asks before it keeps the token. When you answer
  no, or Sonah cannot keep it, Sonah revokes it with `DELETE /api/token`. In a pipe or a script it sends nothing: it
  asks only in a terminal. A code comes from the server's page for connecting a laptop; until that page offers one,
  `sonah connect --token` is the way in.
- `sonah connect --token` reads a token that you made on the server's `/settings/tokens` page from standard input
  (with no echo in a terminal), and asks with `GET /api/token` whose it is, before it keeps it. When you answer no, or
  Sonah cannot keep it, Sonah leaves that token live. Once kept, it is this computer's token like one a code made:
  `sonah disconnect` revokes it, and so does a later connection that replaces this one, so it stops working wherever
  else you use it too.
- `sonah status` asks with `GET /api/token` whose the token is, to show the login, the team and the seat.
- `sonah disconnect` revokes the token with `DELETE /api/token`, then deletes it here. When the server does not
  answer, Sonah deletes it here all the same and says where to revoke it.
- When a connection replaces another one, Sonah revokes the old token on its own server with `DELETE /api/token`.

Once it keeps the connection, `sonah connect` run in a git repository offers the push hook there, then the commit link
of `sonah hook add` when it is off ([The Agent-Session line](#the-agent-session-line)). Each needs your yes in a
terminal, but `--hook` turns the push hook on with no question, and `--no-hook` offers neither. [Each
call](#sonah-team-each-call-and-what-the-server-keeps) says how the token travels and what the server keeps of it.

### Sonah Team: the push hook

**With the push hook on in a repository, a push sends a review with no button press.** Sonah reviews each pushed branch
in the background, through your own `claude` login, as `sonah visual` does (it counts toward your Claude Code plan), and
puts the review on the Sonah Team server that this computer is connected to, as "Save online" would. You turn it on
yourself, one repository at a time, with `sonah hook add --push`, or with a yes to `sonah connect`'s question in that
repository. It is off everywhere else.

- `sonah hook add --push` writes the hook's files (below) and lists the repository in `~/.sonah/team/hooks.json`. When
  this computer is connected, it asks with `GET /api/token` whose the token is, to show your seat, as `sonah status`
  does. Before you connect, it sends nothing.
- At each push, git hands the hook the refs it pushes. The hook sends nothing itself and starts no model: it keeps each
  pushed branch, at most 3 of one push (the newest first), in `~/.sonah/team/queue/` with the commit's id, the
  remote's name or address (any user and password in it taken out), the folder you pushed from, and the server and
  login of the connection, records it as `waiting` in `~/.sonah/team/runs.json`, and starts the review that runs after
  the push. A deleted branch and a tag are kept for nothing. Its line after the push counts the comments that wait for
  you on that branch, from `~/.sonah/team/waiting.json`, with no call of its own.
- Nothing is kept or sent when `CI` is set, before this computer is connected, after the server refused the token (a
  `401` that marked the connection refused, [above](#sonah-team-each-call-and-what-the-server-keeps)), or when the hook
  was turned on for another server than the connection's. The hook says so in one line, but for `CI`.
- `git push --no-verify` pushes once with no hook. `sonah hook remove --push` turns it off and deletes what the
  repository kept for review. `sonah disconnect`, and a connection to another server or login, delete what the old
  connection kept. None of them deletes what a review cut off by a kill or a power loss left ([What stays on your
  computer](#what-stays-on-your-computer-and-where)). From then on nothing of those pushes is sent: a review that waits,
  or is being drawn, ends (its calls stop), and a review that waits to be sent is not sent.

**The review of a push, and what it sends.** The push starts one Sonah for the repository in the background (`sonah
push-run`), which takes the kept branches in turn. For each, only to the server of the connection the push was kept
under, while this computer's connection is still that server and login and the repository's push hook is on (Sonah
reads both again before each call and while it draws), with the token it holds then in the `Authorization` header
only:

- Once the remote shows the commit (git's remote-tracking branch, else `git ls-remote` to your remote, as `git fetch`
  would ask it; Sonah looks for 10 minutes), Sonah sends `GET /api/fixes?owner=<owner>&repo=<name>`, the owner and
  name that the push remote's address names, once a repository for each run of the queue, before any model call. It
  asks whether the server still takes the token and you are in a team; the answer lists the comments that wait for you
  in that repository, which Sonah keeps in `~/.sonah/team/waiting.json` (below). A `401` to the token the connection
  holds marks it refused, and nothing more is sent.
- Sonah finds the base of the change, where the branch left the remote's default branch, with git: from the
  remote-tracking `HEAD` that your clone keeps for that remote (`refs/remotes/<remote>/HEAD`), else by asking the remote
  for its default branch (`git ls-remote --symref`). A commit already on that branch is not reviewed. In a partial
  clone, git may then fetch that branch's commit, and the commits before it, from your remote
  ([What leaves your computer](#what-leaves-your-computer)).
- The drawing sends what `sonah visual` sends, through your own `claude` login and never with an `ANTHROPIC_API_KEY`
  of your shell ([What leaves your computer](#what-leaves-your-computer)), with the model `claude-sonnet-5-5`. A page
  of the same range drawn before is replayed, and sends nothing. Its calls stop 30 minutes after the push.
- `POST /api/uploads` sends the review: what "Save online" sends ([above](#save-online-and-invite-your-team)): the page
  drawn for the server and the files of the drawing (`facts.json`, `meaning.json`, `findings.json`, `run.json`), the
  repository's owner and name, the range's two commits and the pushed branch; and `sessions`: for each agent session
  that a commit of the range names in an `Agent-Session` line ([below](#the-agent-session-line)), its id, `claude-code`,
  the ids of the commits that name it, the paths those commits changed that are among the review's files, and the ids
  of the review comments it was started to answer, from the launch records of `sonah fix` on this computer
  ([below](#sonah-team-sonah-fixes-and-sonah-fix)). No recording is read, and nothing of a session's content is sent.
  When the server does not answer, or answers with a 5xx, Sonah tries again after 5 and 20 seconds; a review that
  still did not reach it, or met a 429, stays on this computer and the next push of the repository sends it (so does
  `sonah share` of that branch and commit). Before it sends one that waits, Sonah reads which review of that
  repository's branch is the newest from your local git, which may ask your remote for that branch's commit
  (`git ls-remote`, the same call as the first step above, and, in a partial clone, git's own fetch of that commit
  when it reads it: [What leaves your computer](#what-leaves-your-computer)): once for each remote name those
  reviews were pushed through, and only where your clone's own remote-tracking branch cannot stand for it — where your
  clone keeps no such branch (a `--single-branch` or `--depth` clone, or a remote whose refspecs keep what it holds
  among your own branches), where another clone of the repository on this computer has a review of the same branch
  (your clone's own branch moves with your pushes there and not with that clone's), where those reviews name more than
  one remote of the one repository, or where one of those pushes was made with the repository's address rather than a
  remote's name. Where that call gives no answer at all, the remote-tracking branch your own clone keeps answers for it.
- After the queue, one more `GET /api/fixes` for each repository it reviewed, for the comments that came in meanwhile,
  only while the connection is the one that asked first (the same server and login). A `401` to this call marks
  nothing; the next push's own `GET /api/fixes` asks again.

The server keeps each upload as a version of your review of that branch, for your team as your seat allows; whatever
your seat, it tells your team's webhooks of each upload, and tells them, and may tell the comment's writer, of each
fix that its `sessions` mark pushed ([What the server keeps](#sonah-team-each-call-and-what-the-server-keeps)). On a
server with a GitHub App, it also writes a comment on your pull request ([Sharing](#sharing)). Sonah has no command that
deletes an upload from the server.

### Sonah Team: `sonah share`

**`sonah share` puts a page that Sonah already drew on this computer on Sonah Team, and sends nothing until you run
it.** It makes one kind of call, `POST /api/uploads`, and only to the server of the connection this computer holds
([above](#sonah-team-connecting-this-computer)), with that connection's token in the `Authorization` header only. It
asks the server nothing else: no question of whose the token is, and no list of the comments that wait for you. It
draws nothing and asks no model, so it costs nothing of your Claude Code plan. Its git calls read this computer
(the repository's top folder, the commit at `HEAD`, the branches that point at it, your push remote and its address,
and the range's commits and paths for `sessions`), and one of them may reach your remote: once the server has taken
the page and its link is printed, Sonah works out which reviews of that branch this page takes the place of, and that
read asks your remote for the branch's commit (`git ls-remote`, as the push's own review does) in the same cases
listed [above](#sonah-team-the-push-hook) — among them a branch pushed through two remotes of the one
repository — once for each remote name, one name after another. The first call waits at most 5 seconds, and each
later one what is left of those 5 seconds but never less than a second: for at most 5 seconds, and a second more for
each remote name after the first. It makes that call only where a review of the same branch is still waiting to be
sent here; with none, it makes no `git ls-remote` at all. In a partial clone, git may also fetch from your remote the
commit that call named, or the commit of a page that `--dir` names, when your clone does not hold it
([above](#what-leaves-your-computer)); in any other clone, it reaches no remote but with that call.

What it sends is what "Save online" sends ([above](#save-online-and-invite-your-team)): the page as the team's site
shows it, the four files of the drawing (`facts.json`, `meaning.json`, `findings.json` and `run.json`), the
repository's owner and name from the address of your push remote, the range's two commits, and the branch. With them
goes `sessions`, as a push's review sends it: for each agent session that a commit of the range names in an
`Agent-Session` line ([below](#the-agent-session-line)), its id, `claude-code`, the ids of the commits that name it,
the paths those commits changed that are among the review's files, and the ids of the review comments it was started
to answer, from the launch records of `sonah fix` on this computer ([below](#sonah-team-sonah-fixes-and-sonah-fix)).
No recording is read, and nothing of a session's content is sent. No path, token or setting of your computer is in it.

Which page it sends: the newest finished page of the commit at `HEAD`, from the folders under `~/.sonah/visual/` that
Sonah keeps for the working tree you run it in, and from the folders that the reviews of your pushes of this
repository drew, whichever of plain `sonah`, `sonah visual` or a push's review wrote it. A page written with
`--out DIR` is found only through `--dir`, which names another folder of a page; Sonah sends that folder only when its
commit is in the repository you run the command in. `--branch NAME` names the branch, and `--repo DIR` names the
repository. A review of that branch and commit that is still waiting to be sent, because its upload did not reach
the server, is the one `sonah share` sends: it is not drawn again, and no new call is made for it. When the server does
not answer, or answers with a 5xx, Sonah tries again after 5 and 20 seconds, and gives up 10 minutes after the command
started; the review then stays on this computer, and the next push of the repository, or `sonah share` again, sends it.

The server keeps the upload as a version of your review of that branch, for your team as your seat allows, and tells
your team's webhooks of it and of each fix it marks pushed, exactly as for a push's
([above](#sonah-team-the-push-hook)). Sonah has no command that deletes an upload from the server. A `401` to the token
marks the connection refused here, and nothing more is sent until you connect again.

`sonah share` writes on this computer: the record of the review in `~/.sonah/team/runs.json` (its state ends `shared`,
with the page's link and the log's path), one log in `~/.sonah/team/logs/`, which never holds the token, and
`draw.lock` in the page's own folder while it reads that folder, so a `sonah visual` of the same range and a share of
it never read and write at once. A `401` also writes the mark in `~/.sonah/team/refused.json`. It changes nothing in
your repository, its branches or its files; in a partial clone, git keeps in `.git/objects` the commits it fetched for
those reads.

### Sonah Team: `sonah fixes` and `sonah fix`

**`sonah fixes` reads the review comments that wait for you, and `sonah fix` sends one prompt to Claude Code after you
say yes.** Both call only the server of the connection this computer holds
([above](#sonah-team-connecting-this-computer)), with that connection's token in the `Authorization` header only.

`sonah fixes` makes one `GET /api/fixes?owner=&repo=` a repository, which sends the repository's owner and name and
nothing else. The repository is this clone's, as the address of your push remote names it; in a folder that is no clone
of one, it is every clone whose push hook is for this connection's server (`~/.sonah/team/hooks.json`), one call each.
A clone you hooked while connected to another server is left out, so the name of a repository another server reviews
does not reach this one. The server's answer is the comments that wait for you there: who wrote each, how, when, the
first line of their words (at most 120 characters),
the item it is on, the pull request or branch, the commit and the state of its fix. Sonah checks every entry by shape
and drops one that is not of it. It keeps the answer in `~/.sonah/team/waiting.json`, readable by you only, with the
server and login it was read under, and keeps only that first line of anyone's words. The push hook's line after a
push, and `sonah status`'s count, read that file and make no call of their own.

`sonah fix <comment id>` makes one `GET /api/fixes/<comment id>`, which sends the id and nothing else, and the server
answers with what the fix needs: the comment and the thread it answers (their words in full), the item as the review
shows it (its title, its one line, its functions, its quote and the paths of those functions), the review's link, the
repository's owner and name, the pull request, the branch and the range's two commits. Every field is checked by shape,
and that text goes only into the prompt. Nothing of it becomes a command, a path, a flag or a value of the
environment.

Its git calls read this computer (your remotes and their addresses, the worktrees of your clone, the range's commits
and the paths they changed), and make no call to your remote of their own; in a partial clone, git fetches from your
remote the review's head and the commits of its range when your clone does not hold them
([above](#what-leaves-your-computer)). It reads the recordings of one session: the one that the range's commits name
in an `Agent-Session` line ([below](#the-agent-session-line)) and that touched a file of the item. Of that one
recording Sonah reads the times and folders of its tool calls, to see whether it made that commit here (D143); it
reads no other session's recording, and nothing of what a session said.

Then it shows you the whole prompt and asks. Until you answer `y`, nothing reaches Claude Code and nothing else is
sent. `e` opens the prompt in `$VISUAL` or `$EDITOR`, on a file that only you can read in a folder of its own, removed
after. On a yes, Sonah keeps the launch record (below), makes one more call, `POST /api/fixes/<comment id>/launched`,
which sends the new session's id and the id of the session it forks, so your team can see on the review page that you
took the comment up, and then starts `claude` in the worktree with the review's branch, with the prompt as one
argument. That call is best effort, with 5 seconds to answer: a failure says so and the fix goes on, and a `401` to it
marks nothing ([above](#sonah-team-each-call-and-what-the-server-keeps)). Claude Code then runs with your shell's
environment as it is: unlike the review of a push, `sonah fix` takes no `ANTHROPIC_API_KEY` out of it, so a key your
shell sets reaches Claude Code, which may then run that session on the key, billed to its account and sent to it, as
`claude` run there by you would; without one, it runs on your Claude Code login and counts toward your plan. What it
reads and sends is Claude Code's own, not Sonah's.

`sonah fix` writes on this computer one file a comment, `~/.sonah/team/fixes/<comment id>.json`, readable by you only
(folder `0700`, file `0600`): the review's link, the repository, the branch, the range's two commits, and each launch of
Claude Code for that comment, with its time, the folder, the session ids, the Claude Code folder and **the prompt
exactly as it was sent**, which holds your teammate's words. It marks the comment as launched in
`~/.sonah/team/waiting.json`, so the lines stop counting it. It never changes your repository's branches or files (in
a partial clone, git keeps in `.git/objects` the commits it fetched for its reads), and it never checks out or switches
a branch. A launch record belongs to no one connection: the next push or `sonah share` of the repository reads it for
the `answers` of its upload, which is what lets the server mark the fix pushed (it keeps a `pushed` line
with the session ids, and tells the comment's writer and your team's webhooks:
[What the server keeps](#sonah-team-each-call-and-what-the-server-keeps)), so `sonah disconnect`
leaves these files as they are. Removing `~/.sonah/team/fixes/` takes Sonah's copy of the prompts away, but not the
prompts themselves: each prompt is the first message of the Claude Code session that `sonah fix` started, so Claude
Code keeps it in its own recording of that session, in its folder (`projects/` under `CLAUDE_CONFIG_DIR`, else
`~/.claude/projects/`), and the recording of a fork also holds the session it forked. Sonah never changes or deletes a
recording, so the prompts stay there until you delete those recordings yourself.

### Sonah Team: the Claude Code start reminder

**`sonah remind on` adds one entry to Claude Code's settings, and nothing else.** It writes one SessionStart hook into
`settings.json` in Claude Code's folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`): its command runs this install's node
and Sonah, `sonah remind-hook`, with `SONAH_HOME` when you set it, and ends with `# sonah:remind`. Sonah keeps every
other setting of that file as it is, and writes the file back whole, as JSON with two-space indents, with its own
permissions (through a link, to the file the link names). It leaves a file that is not plain JSON as it is, and then
prints the entry for you to add. `sonah remind off` removes that entry only. An entry of the earlier client `sonah-pr`
is never changed.

**What the hook reads and shows.** Each time Claude Code starts or resumes, the hook reads the folder that Claude
Code's hook input names, runs one `git remote -v` there, and reads `~/.sonah/team/connection.json`,
`~/.sonah/team/refused.json`, `~/.sonah/team/waiting.json` and `~/.sonah/team/locks/remind.json`. When comments of
your team wait for you on that folder's repositories, it shows them to you in Claude Code as a message: who wrote
each, how, on what, the first line of their words and the link to its thread. Sonah gives it to Claude Code as a
message for you (`systemMessage`), never as `additionalContext`, the field that Claude Code's hooks reference names for
adding context for the agent. With no connection, or a token the server refused, it shows nothing and sends nothing.

**Claude Code keeps what the hook prints.** Claude Code writes what a hook prints into its own recording of the
session, on this computer, as it records the rest of the session. So the reminder's lines, a teammate's first line and
the link to its thread among them, are in Claude Code's recordings of the sessions where they showed, and they stay
there as long as those recordings do. `sonah remind off` stops new lines; it does not take them out of the recordings.

**What it sends.** The hook itself sends nothing. When the list of one of that folder's repositories is a minute old or
more, it starts `sonah remind-refresh` in the background, which makes one `GET /api/fixes?owner=<owner>&repo=<name>`
for each such repository to the server of this computer's connection, with its token in the `Authorization` header
only: the call `sonah fixes` makes, and only for repositories whose list `waiting.json` already holds, so no
repository name reaches the server that `sonah fixes` or a push has not named to it already. It asks about each
repository at most once a minute, however many sessions start, and keeps the time it asked in
`~/.sonah/team/locks/remind.json`. It keeps the answer as `sonah fixes` keeps it. When the server answers that it no
longer lists a repository for you, with a `403` whose code says why (`not_member`: you are in no team;
`not_installed`: its GitHub app is not on the repository; `forbidden`: you may not push to it), Sonah removes that
repository's list from `waiting.json`, so the reminder neither shows it nor asks for it again. A `401` marks the
connection refused, as a `401` to `sonah fixes` does. Any other refusal, such as a page from a proxy, changes nothing.

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
| The page of a change (`sonah visual`, and the graphs page of a review's HTML page) | `~/.sonah/visual/<the repository folder's name and a hash of its path>/<the range's two commits and the model>/` (or `--out DIR`) | Only if you ran it, or a review drew it (the review's page links to its `page.html` by its full path; the Markdown report never names it). The page (`page.html`), each request as it was sent (`requests/`) and its answer (`answers/`), what Sonah read of the change (`facts.json`), and what it kept and why (`meaning.json`, `findings.json`, `dropped.json`, `run.json`). While Sonah draws the page, `draw.lock` there holds the process id and start time of that Sonah, so that two never draw the folder at once; it is removed when the drawing ends. A rerun of the same range with the same model replays the stored answers. They quote your code as it is in the commits. The page holds the review that "Save online" and "Invite your team" send, and they are sent only when you press one ([above](#save-online-and-invite-your-team)); nothing else here is ever sent. Sonah never deletes this folder: remove it when you no longer need it. In a repository with the push hook, the review of a push draws into this folder, and Sonah sends what it holds to Sonah Team ([above](#sonah-team-the-push-hook)). `sonah share` sends what a folder of this kind holds too, and holds its `draw.lock` while it reads it ([above](#sonah-team-sonah-share)). |
| A PR comment's posting journal | `publication/` in the review's folder above | Only if you posted one. |
| The /sonah skill (`sonah skill add`) | `~/.claude/skills/sonah/SKILL.md` (or under `CLAUDE_CONFIG_DIR`) | Only if you added it. It holds no session text: when you type `/sonah`, it runs `sonah review --session <the session's id> --background`, which reads and sends what `sonah review` does. `sonah skill remove` deletes it. |
| The page, Markdown report and log of `sonah review --session ID --background` | `background/` in the review's folder above | Only if you ran one. The page and the report hold your session as recorded; the log holds what the review printed. `active.json` there holds the process id of the review it started, nothing else. |
| Where a review by `sonah review --session ID` cut your recordings | `review/frozen-read.json` in the review's folder above | Only for a review by session id. The time the review took its cut; the reviewed recording's full path and its size then; and the path and size then of each recording file in the folder the review reads (Claude Code: the session's project folder; Codex: every rollout under `~/.codex/sessions`). Paths and sizes only, no session text. |
| A `sonah feedback` bundle | `~/sonah-feedback-YYYY-MM-DD.md` in your home folder | Setup facts and counts only. A second bundle on the same day replaces the first. |
| The connection to Sonah Team (`sonah connect`) | `~/.sonah/team/connection.json` | Only if you connected this computer. The server's address, the upload token and the login that the server named for it. Readable by you only (folder `0700`, file `0600`); one that is not yours, that others can write or that is not this shape is not used. `sonah disconnect` revokes the token and deletes the file. |
| The repositories with the push hook (`sonah hook add --push`) | `~/.sonah/team/hooks.json` | Only if you turned it on. The path of each repository's git folder, and the server its hook is for. Readable by you only. `sonah hook remove --push` takes a repository off it. |
| The branches the push hook keeps for review | `~/.sonah/team/queue/<a hash of the repository's git folder>/` | One file for each pushed branch that waits (`q-<a hash of the branch>.json`), and while its review runs, the file that review took (`run-<its id>.json`): the branch, the commit's id, the remote's name or address with no user or password, the folder you pushed from, the time, and the connection's server and login. Readable by you only. `sonah hook remove --push` deletes the `q-` files of a repository, `sonah disconnect` those of all of them, and a connection to another server or login those of the old one; a review deletes its `run-` file when it ends. A `run-` file that a review cut off by a kill or a power loss left, and `runner.lock` beside it, stay until the next review of that repository's pushes takes them back: none of those commands deletes them, so after `sonah hook remove --push`, delete that folder yourself. |
| The mark that the server refused the token | `~/.sonah/team/refused.json` | Only after a `401` to the token the connection holds, from a call whose `401` marks it ([above](#sonah-team-each-call-and-what-the-server-keeps) names the calls whose `401` marks nothing): the server and login of the connection, so that a push starts nothing, and `sonah share`, `sonah fixes`, `sonah fix` and the start reminder send nothing. A new connection and `sonah disconnect` delete it. |
| The reviews of your pushes, and of what you shared | `~/.sonah/team/runs.json` | One record for each pushed branch, and one for each page that `sonah share` put online: its id, the repository's git folder and the folder it was read from, the owner and name, the branch, the commit and the base, the remote's name, the connection's server and login, the state and why (and a refusal's status and code), the times, the process id and start time of the Sonah that reviews it, the page's link on the server, the log's path and the drawing's folder. The newest 200. Readable by you only. A review that waits to be sent (also one whose sending a shutdown cut off), and a push that waits for its review, belong to their connection: `sonah disconnect`, and a connection to another server or login, end them; `sonah hook remove --push` ends the repository's. A record that `sonah share` made ends `shared`, with the page's link, and names the remote it sent under; one that share reused from a push keeps that push's own fields, with the server and login of the connection the share sent the page under. |
| The logs of the reviews of pushes, and of `sonah share` | `~/.sonah/team/logs/<repository name>-<commit>.log` | What each review did, in fixed words and codes: its steps, the server's status codes, the drawing's folder, its calls and cost, the page's link. Never the token, a remote's address or a provider's text. A log of `sonah share` holds the repository, branch and commit it sends, the server's answer and the page's link. Readable by you only. A review of a push, once its queue is done, deletes each log here that nothing wrote to in 30 days, a log of `sonah share` too; `sonah share` deletes none, so where no push is reviewed the logs stay until you remove them. |
| The comments that wait for you | `~/.sonah/team/waiting.json` | The server's last list for each repository Sonah reviewed a push of, or that `sonah fixes` asked about, and the connection's server and login: each comment's id, author, kind (question, reply, override), time and first line, the item's kind, key, tier and title, the pull request's number and branch, and the commit. Readable by you only. `sonah fix` marks its own comment as launched here. `sonah disconnect`, and a connection to another server or login, delete it, and Sonah keeps no list of the old connection that comes after them. |
| The Claude Code start reminder (`sonah remind on`) | `settings.json` in Claude Code's folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`) | Only if you turned it on: one SessionStart entry whose command names this install's node and Sonah (and `SONAH_HOME` when you set it) and ends with `# sonah:remind`. The rest of the file is yours and stays as it is. `sonah remind off` removes the entry. |
| When the reminder last asked for a list | `~/.sonah/team/locks/remind.json` | Only once the reminder asked again: the connection's server and login, and for each repository it asked about, its owner and name and the time. A time older than a minute is dropped at the next ask. Readable by you only. `sonah disconnect`, and a connection to another server or login, delete it. |
| What `sonah fix` sent to Claude Code | `~/.sonah/team/fixes/<comment id>.json` | One file for each comment you ran `sonah fix` on: the review's link, the repository, the branch, the range's two commits, and each launch of Claude Code for it, with its time, the folder, the session it went to, the session it forked, the Claude Code folder and **the prompt exactly as it was sent**, which holds your teammate's words. Readable by you only (folder `0700`, file `0600`). It belongs to no one connection: the next push or `sonah share` of the repository reads it for the `answers` of its upload, which is what lets the server mark the fix pushed (a line the server keeps with the session ids, and tells the comment's writer and your team's webhooks of), so `sonah disconnect` leaves these files as they are ([above](#sonah-team-sonah-fixes-and-sonah-fix)). Removing the folder takes Sonah's copy of the prompts away; Claude Code's recording of each session that `sonah fix` started holds its prompt too, and stays. |
| The one review of a push that draws at a time | `~/.sonah/team/locks/job.lock`, and `runner.lock` in a repository's folder of `~/.sonah/team/queue/` | While a review of a push runs: its process id and start time, as `draw.lock` holds them. A lock that a review cut off by a kill or a power loss left stays until a later review takes it back: `job.lock` the next review of any push, `runner.lock` the next of that repository's pushes. |
| The locks and new files of a write | `hooks.json.lock`, `runs.json.lock`, `waiting.json.lock`, `locks/remind.json.lock` and `fixes/<comment id>.json.lock` in `~/.sonah/team/`, and a `.tmp` file beside a file that Sonah writes | Only while Sonah writes the file beside it. A lock file is empty: it keeps two Sonahs from writing one file at once, and one that a crash left is taken back. A `.tmp` file holds the file's new text, and takes the file's place once it is whole. |
| The push hook (`sonah hook add --push`) | `.git/hooks/pre-push` (`pre-push.old` or `.legacy` when lefthook or pre-commit moved it) and `.git/sonah/pre-push.sh` in that repository (with `hooks-folder-made` when Sonah made the hooks folder) | Only where you turned it on. The script names this computer's node and Sonah by their paths, Sonah's version, your `SONAH_HOME` when you set one, and the folder of your `claude`; no token. `sonah hook remove --push` deletes these files. |
| The commit link's hook (`sonah hook add`) | `.git/hooks/prepare-commit-msg` (`prepare-commit-msg.old` or `.legacy` when lefthook or pre-commit moved it) and `.git/sonah/` in that repository: the script `agent-session.sh`, and `hooks-folder-made` when Sonah made the hooks folder | Only where you ran it. It holds no session text; `sonah hook remove` deletes these files. The `Agent-Session` lines it added stay in your commits. |

Every file a review or `sonah decision` writes, and every file under `~/.sonah/team/`, is readable by you only
(folders `0700`, files `0600`). `sonah visual` makes each of its folders readable by you only (`0700`), and writes the
files in them with your usual permissions. `SONAH_HOME` moves `~/.sonah`.

To delete everything Sonah stored, first undo what lives outside `~/.sonah`:

- run `sonah hook remove --push` in each repository where you ran `sonah hook add --push` or turned the push hook on
  through `sonah connect`: removing `~/.sonah` alone leaves the hook's files in the repository;
- run `sonah hook remove` in each repository where you ran `sonah hook add` or turned the commit link on through
  `sonah connect`: its hook needs no Sonah, and keeps adding its line;
- run `sonah remind off` if you turned the Claude Code start reminder on: removing `~/.sonah` alone leaves its entry in
  Claude Code's settings;
- run `sonah disconnect` if you connected this computer to Sonah Team: removing `~/.sonah` alone leaves its token live
  on the server;
- run `sonah skill remove` if you added the /sonah skill.

Then remove `~/.sonah` (with it goes Sonah's copy of the prompts that `sonah fix` kept in `~/.sonah/team/fixes/`), the
output files you wrote and any `sonah-feedback-*.md` bundle; your recordings are not affected. What you sent to Sonah
Team stays there ([What the server keeps](#sonah-team-each-call-and-what-the-server-keeps)). What the start reminder
showed ([above](#sonah-team-the-claude-code-start-reminder)), and each prompt that `sonah fix` gave Claude Code
([above](#sonah-team-sonah-fixes-and-sonah-fix)), stay in Claude Code's recordings. If you used an early preview of
Sonah, `~/.sonah` can also hold `pr-reviews/`, `answers/`, `ledgers/` and `outcomes/` from it; you can delete them (a
review still reads the exit statuses an early preview's hook saved in `outcomes/`, and nothing writes there any more).

## The Agent-Session line

Off until you run `sonah hook add` in a repository, or say yes to its question in `sonah connect` there
([INSTALL.md](INSTALL.md#link-commits-to-sessions)). Then each
commit that your Claude Code agent makes there ends with one line, `Agent-Session: <id>`, the id of the agent's session
as Claude Code gives it. The hook adds nothing else: no part of the recording, no path and no name, and it changes
nothing else in the message. It runs on your computer, calls only `git` and `tail`, and sends nothing. The line leaves
your computer when you push the commit, as the rest of the commit does. With the push hook on, the review of a push
also sends Sonah Team the session ids that the range's commits name, in `sessions`
([above](#sonah-team-the-push-hook)), and so does `sonah share`. Codex sessions get no line yet.

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
`sonah visual` quotes your code and loads nothing from the network either. Its script moves between its parts and graphs
and keeps your light or dark choice in the browser; it sends the review it holds only when you press "Save online" or
"Invite your team" ([above](#save-online-and-invite-your-team)). A copy of the page that you share holds that review
too, and its buttons work for whoever opens it: they save it to their own account. When `sonah review --format html`
drew the graphs page of the session's commits (D219), its page links to that page by its full path on your computer (a
`file:` link, which names your home folder): a copy of the page that you share names that path, and the link opens
nothing on another computer. The Markdown report never holds it.

A Sonah Team server that runs with a GitHub App (one you run yourself and name with `--server`; https://pr.sonah.dev
runs none) posts on its own. On such a server, who can read a review is whoever can read the repository on GitHub, not
your team as your seat allows. When the review of a push or `sonah share` sends it a review of a commit that is the head
of an open pull request you opened, or of one you open later, that server writes one comment on the pull request and
keeps it up to date: the first 7 characters of the commit, the review's one line (the model's summary of the change),
how many Must act and Must know items are decided, how many comments wait for you and how many fixes were pushed, and
the review's link. It asks you nothing first, and in a public repository that comment is public.

Sonah itself posts nothing unless you ask. A review with `--github OWNER/REPO --pr N --post-comment` can leave one
comment and one neutral GitHub check on that pull request: it needs a private repository, a GitHub App token and your
typed confirmation after Sonah prints the exact comment. The token is read from `GH_TOKEN`, else `GITHUB_TOKEN`, else
the output of `gh auth token`, and is never printed or stored. Sonah reads only the pull request's metadata (never its
files or changes), and it posts counts and fixed sentences from the review's checklist only, never quotes, file text,
paths or the page; every text it carries is escaped, so GitHub reads none of it as markup or a mention (see
[INSTALL.md](INSTALL.md#posting-a-count-only-pr-comment)).
