# Privacy: what Sonah reads, what it sends, what it keeps

Sonah runs on your computer. It reads the recording your coding agent (Claude Code, Codex or Cursor) already keeps,
and, with the code step (on by default), the files the session changed or read, as they are now. The only thing that
leaves your computer is the review itself: requests to the model you choose, through your own `claude` or `codex`
login, or your API key with `--backend anthropic-api`. `sonah config code-pass off` (every review) or `--no-code-pass`
(one review) keeps the files out: then only the session is sent. This page says exactly what that means.

## What leaves your computer

Two commands send anything to a model, and nothing else does:

- **`sonah review`** (not with `--dry-run`). Before the first request it prints roughly how many minutes the review
  should take, then it runs. Each part of the session is sent in a request of its own, more than once: one request asks
  for the checklist, then independent checking passes see the same part again, or the parts of it the checklist's
  items cite. Answers already stored on your computer are not asked again. With the code step (on unless you turned it
  off; the line printed before the first request says which) it also sends the change the session made and the files it
  changed or read (the last row of the table below): one request that checks the
  session review against the code, then one per lens (four, or four per part when the change is too large for one
  request), their checking passes, at most one re-ask after the first and one receipt-repair request after each.
- **`sonah doctor`** without `--no-probe`: one tiny synthetic request that quotes no session, to check that the model
  answers.

What a review request contains. The model reads your session as it was recorded, secrets and the images you pasted
included: a reviewer that cannot see a value cannot judge what was done with it. When the reviewer is the same provider
and the same login that ran the session, that provider already received almost all of it while you worked with the
agent; the exception is a file's lines from before an edit (in the table below), which the agent may never have read.
When it is not, the session goes to the reviewer's provider or account for the first time: a Claude Code session
reviewed with `--backend codex-cli` goes to OpenAI, a Codex or Cursor session reviewed with the default `claude`
reviewer goes to Anthropic, and a session run under a work account but reviewed under a personal login falls under
that login's terms. Review with the same provider and login to avoid this. Secrets are masked in what Sonah writes for
you to read instead (see "Masking secrets", below).

| Part of the session | What is sent |
| --- | --- |
| Your messages to the agent | Whole, every one, never trimmed. A file you attached is cut to its first and last 3,600 characters. |
| Images you pasted into your messages | Whole, as recorded and unmasked (PNG, JPEG, GIF or WebP, up to 2,000 by 2,000 pixels and about 5 MB of base64 each, at most 20 per request), in the requests of every part of the session from that message on, the checking passes included, so the same image is sent several times. With `--backend codex-cli` each image is written for the call to a temporary file readable by you only, removed afterwards. |
| The agent's messages to you | Whole. Its private reasoning (Claude's thinking, Codex's reasoning) is never read, so never sent. |
| Commands and tool inputs | Whole, unless one alone is very large (over 720,000 bytes; 360,000 with the Codex reviewer); then its beginning and end, with the gap named. |
| File edits | The text the agent wrote or replaced, whole, unless one alone is that large; then its beginning and end, with the gap named. |
| Tool results (command output, files read) | The first and last 3,600 bytes of each, with the lines left out named. The model may ask for a few of those lines back (at most about 72 KB per part). |
| A file the agent edited, as it was before the edit (the copy Claude Code or Codex recorded) | Not in the first request. The model may ask for lines of it, within the same limit of about 72 KB per part; never of a credential-shaped file or one under `~/.claude` or `~/.codex` (below). |
| Helper agents (the sub-agents Claude Code or Codex started) | Their recordings, linked to the message that started them, the same way. A helper's final report, as the parent received it, is sent whole (within the 720,000-byte limit above). |
| Your project's instruction files | A repository `CLAUDE.md` (or an `AGENTS.md` it names) that Claude Code loaded into the session, whole. In a Codex recording that does not mark which messages are yours (older Codex versions), Codex's `# AGENTS.md instructions` block is read as one of your messages and sent whole: it can hold your own `~/.codex/AGENTS.md` as well as the project's. |
| The reviewer's instructions | A fixed text that ships with Sonah. It holds no session text. |
| With the code step only (on by default; off with `sonah config code-pass off` or `--no-code-pass`): the change the session made, and the files it changed or read | Every file that differs from the commit the session started from (git's own list, read with git, which writes nothing: the commit the recording names, else the one your branch was on when the recording began; a file git shows changed that no recorded edit wrote is included and marked), its lines at that commit and now as git's own diff shows them, and each such file as it is in your working directory at review time (not as it was during the session), whole when it fits, then the files the session read, as many as fit one request; with no git history to start from, the session's own recorded edits. The same files and lines go to the checking passes of each finding (only the files that finding touches). Never sent, before or after the session (and, but for a binary file and one that changed since the session, which are read to tell, never read): a credential-shaped path, a file under `~/.claude` or `~/.codex`, or Claude Code's `~/.claude.json` and its backups (the rules below), a binary file (and a file git diffs as binary, through a `binary` or `-diff` attribute, as lockfiles and minified files often have), a file outside the working directory the recording names, a file too large for one request, and a file that no longer holds what the session last wrote to it. Git is asked only about the working directory: when it is a folder of a larger repository, the paths that differ elsewhere in it are counted and never named; when the repository is your home folder or holds it (as a dotfiles repository does), only the files the session itself changed or read are read, every other path git shows differing is counted and never named, read or sent, and git is asked about untracked files only by those paths, never over the home folder; and no request names a path outside the working directory or in a Claude Code or Codex home — `~/.claude` and `~/.codex`, the ones you set with `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, the one the recording itself lies in, when it lies in Claude Code's or Codex's own folder layout (Claude Code's `<home>/projects/<folder>/`, where the folder is Claude Code's name for the working directory the recording states, or Codex's `<home>/sessions/<year>/<month>/<day>/`, or `<home>/archived_sessions/` once Codex has archived the recording), so a home that was set when the session ran and is not set now counts too (a recording you keep anywhere else, such as in your project or in a folder of your own named `projects`, names no home), any folder one of them links to, and Claude Code's own `~/.claude.json` and its backups beside them — by any name, and no line of it is sent from the commit the session started from or from now (a credential-shaped file there included, one a link in the working directory leads to or led to at that commit, and one deleted since the session started); such a file is counted instead. Symbolic links are followed before anything is read: a file is withheld the same way when its real place, wherever a linked folder on its path or the file itself leads, is credential-shaped, under `~/.claude` or `~/.codex` (or the Claude Code or Codex home you set) except inside a worktree there, or outside that directory, and only a regular file is read. A hard link, like a copy, is a file of its own name: a `config.js` hard-linked to `.env` is sent as `config.js`. These files can hold text the provider never saw during the session, such as lines the agent never read. |

The default reviewer is the `claude` CLI with the model `claude-sonnet-5-5[1m]`, signed in with your own login. It runs
in an empty private folder with its tools, settings, plugins and slash commands switched off, and it is given only the
basic environment it needs (home folder, temporary folder, path, user and shell name, language and the certificate
settings), not your API keys or proxy settings. `--backend codex-cli --model gpt-6.1-sol` uses your `codex` login
instead, read-only, with its tools and web search off. `--backend anthropic-api` posts the same requests to Anthropic's
API with your `ANTHROPIC_API_KEY`.

Sonah itself makes no other network request: no telemetry, no analytics, no update check. (The one exception is a PR
comment you ask for with `--github OWNER/REPO --pr N --post-comment`: Sonah reads that pull request's metadata from
GitHub and posts the comment only once you confirm it; see Sharing below.) Your provider's own terms apply to what it
receives.

## What is never sent

- Private reasoning of the agent (Claude's thinking blocks, Codex's encrypted reasoning).
- Text Claude Code or Codex gave the agent other than your project's own instruction files: memory, reminders, user
  and managed instruction files (except Codex's `AGENTS.md` block in older Codex recordings, above).
- What the agent's file tools read in Claude Code's or Codex's own home folders (`~/.claude`, `~/.codex`), except
  inside a worktree there, and in the files Claude Code keeps beside them (`~/.claude.json`, which holds your account,
  your prompt history and your MCP server settings, and its backups `~/.claude.json.backup…`; Codex keeps everything in
  its home folder): a Read, Grep or Glob of such a file, a command Codex itself recorded as reading one, or any other
  tool whose recorded input names one, and the earlier contents of a file it changed there, as the tool recorded them.
  The request to the model marks such output as withheld. Where Sonah cannot tell where the home folder is, it
  withholds every `.claude` and `.codex` folder and every `.claude.json`.

  This rule knows those folders and files only by these names, spelled exactly as here. Two things follow, and the
  session review does not cover them. A second Claude Code folder under another name, such as a `~/.claude-2` you use
  through `CLAUDE_CONFIG_DIR`, is not recognised: what the agent's file tools read there is sent like any other file
  read, even when the recording itself lies in that folder. And on a disk that ignores the case of names (the default
  on macOS and Windows), a read the session recorded as `~/.CLAUDE/settings.json` or `~/.Claude.JSON` is sent too. The
  code step goes further but not all the way: it also withholds the ones you set, and the home folder the recording
  lies in only when the recording lies in its recorder's own folder layout (for Claude Code, `<home>/projects/<folder>/`
  where the folder is Claude Code's name for the working directory the recording states; for Codex,
  `<home>/sessions/<year>/<month>/<day>/`, or `<home>/archived_sessions/` once Codex has archived the recording); and it
  compares where a file really is, so it withholds those spellings.
  A second Claude Code folder that you did not set, and that the recording does not lie in that way (a recording filed
  under a folder named for another working directory, as a resumed session's can be, for example), is not recognised,
  so when it is inside the working directory (your home folder as the working directory, for example), the files the
  session changed or read in it are sent.
- The same for a credential-shaped path: `.env` files, `secret`/`secrets` `.yaml`, `.yml`, `.json` or `.toml`,
  `credentials`, `kubeconfig`, `.npmrc`, `.pypirc`, `.netrc`, `.htpasswd`, SSH keys named `id_rsa`, `id_ed25519` or
  `id_ecdsa` (and their `.pub` files), and any `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.kdbx`. An SSH key under
  another name is sent like any file read, as it was recorded.

  Both rules go by the path a tool names, never by the words of a shell command, and they cover what was read, not
  what the agent wrote: the output of `cat .env` or `cat ~/.claude/settings.json` run through Claude Code's shell is
  sent like any other tool result (its beginning and end, as recorded), and the text the agent wrote or replaced in
  such a file is sent like any other edit.
- Images in tool results (a screenshot the agent took or a picture it read), an image over the limits in the table
  above, the images of a message that also holds something the reviewer cannot be sent, audio, and documents (a PDF
  you attached is not read).
- A part of the session too large for one request: it is not sent at all, never cut down, and the review says it
  could not be checked.

## Masking secrets

Sonah masks secrets in everything it writes for a person to read: the page, the Markdown story (in a file or on the
terminal), a PR comment and anything else it would post. It masks on your computer, as it writes, every text it shows
from the session (your messages, the agent's messages, commands, tool inputs and outputs, file contents, edits, helper
reports and instruction files) and every text the reviewer wrote about it. A quote of the reviewer's that holds a
masked secret is not shown.

Before it writes anything for you, Sonah runs its full secret scan over the whole session, with the same rules it used
to run on the session as it loaded it. That scan reads each event as a whole, so it also finds a secret that only its
surroundings give away: the output of a command that names a secret (`echo $DB_PASSWORD`, `vault kv get
-field=password`), the contents of a file whose path names one, a value under a secret-named key, the lines of a key
block. What it finds is masked wherever the session shows it, and wherever the reviewer repeats it in its own words. With
the code step, each file the code pass read, as it is now and as it was at the start commit, is scanned the same way,
whole, and what the scan finds in it is masked in everything written too, wherever the reviewer quotes or repeats it. It masks:

- known key and token formats (cloud, GitHub, Anthropic, OpenAI, Slack, Google, JSON web tokens, bearer tokens and
  others), private-key blocks, URLs and database connection strings with a password;
- the value given to any name that says it is a secret (a name containing `password`, `secret`, `token`, `api_key`,
  `private_key`, `credential`, `auth` and similar), wherever it is written: `NAME=value`, flags, headers, URL
  parameters, cookies, YAML and JSON;
- values written next to words such as "password", "secret" or "key" in prose;
- email addresses;
- a long random-looking string it cannot otherwise classify, when it mixes enough kinds of characters: in practice
  about 40 characters or more. It is removed and marked, never kept as a guess; the rest of its line is shown.
  Shorter random strings, and hex strings of up to 40 characters (a Git commit id), are kept.

Placeholders such as `$NAME`, `${NAME}`, `<name>`, `***` and `changeme`, and the words `true` and `false`, are left as
written. File paths are not scanned: a filename is not a credential.

**Masking fails closed.** If it cannot mask what a review would write or print, nothing is written, printed or
posted: the review stops with `output_not_masked`, and the answers it got are kept for the next run.

**What the model sees, and what is kept.** The model requests carry the session as recorded, within the limits in the
table above. The answers the model gave and the review's report are kept under `~/.sonah` so a review can resume and a
rerun costs nothing; they can quote the session as the model read it, secrets included, so they stay on your computer,
readable by you only. Sonah never shows them to anyone: the page and the Markdown are written from them, masked.

**What it cannot know.** A secret with no telling name and no known shape can get through: for example a short password
pasted on its own line, or a random API key of fewer than about 40 characters with no known prefix. Some secrets the
scan does find are masked only where the session holds them, not where the reviewer repeats them in its own words away
from their name:

- a value the scan never takes for a secret by itself: a number of up to six digits, a version, a date, a path or file
  name, a placeholder or a common word (a PIN in `DB_PASSWORD=1234` is masked in that command; "it printed 1234" in the
  reviewer's words is not);
- a value the session also shows unmasked somewhere else, where the scan did not take it for a secret;
- part of a secret, when the reviewer writes only that part (a shortened title keeps the first characters of a secret
  the reviewer wrote whole; they are masked from four characters on).

Masking can also hide harmless text that looks like a secret. Coding-session recordings can carry live secrets, so treat
every recording, every review and everything under `~/.sonah` as sensitive.

## What stays on your computer, and where

| What | Where | Notes |
| --- | --- | --- |
| Your recordings | where your agent keeps them (`~/.claude/projects/`, `~/.codex/sessions/`) | Only read, never changed. |
| Stored model answers and the review's report | `~/.sonah/session-reviews/<a hash of the recording's path>/` (or `--state-dir DIR`) | Lets a review resume and a rerun cost nothing. The requests themselves are not stored. The answers can quote the session as recorded, secrets included: they are never shown or sent. Keep a `--state-dir` outside every Git repository, so they are never committed. With the code step, the code pass's answers are kept apart in `code-pass/answers/` there, and the report also holds each file's path, state and SHA-256 and the lines its answers and findings quote (never a whole file). |
| Your answers to checklist rows (`sonah decision`) | `~/.sonah/decision-reviews.ndjsonl` | Never sent anywhere. A reason that looks like a secret is refused. |
| Your settings (`sonah config`) | `~/.sonah/config.json` | Whether the code step is on. Readable by you only; one that is not yours, that others can write or that cannot be read stops a review given no `--code-pass` or `--no-code-pass`, before anything is read. |
| The page or Markdown you asked for | the `--output` file | Never overwrites an existing file. |
| A PR comment's posting journal | `publication/` in the review's folder above | Only if you posted one. |
| A `sonah feedback` bundle | `~/sonah-feedback-YYYY-MM-DD.md` in your home folder | Setup facts and counts only. A second bundle on the same day replaces the first. |

Every file a review or `sonah decision` writes is readable by you only (folders `0700`, files `0600`). `SONAH_HOME`
moves `~/.sonah`. To delete everything Sonah stored, remove `~/.sonah`, the output files you wrote and any
`sonah-feedback-*.md` bundle; your recordings are not affected. If you used an early preview of Sonah, `~/.sonah` can
also hold `pr-reviews/`, `answers/`, `ledgers/` and `outcomes/` from it; you can delete them (a review still reads
the exit statuses an early preview's hook saved in `outcomes/`, and nothing writes there any more).

## Sharing

The page and the Markdown quote your session, with secrets masked. Read them before you share them; the page says so
in its footer.
The page runs no script and loads nothing from the network.

Nothing is ever posted unless you ask. A review with `--github OWNER/REPO --pr N --post-comment` can leave one comment
and one neutral GitHub check on that pull request: it needs a private repository, a GitHub App token and your typed
confirmation after Sonah prints the exact comment. The token is read from `GH_TOKEN`, else `GITHUB_TOKEN`, else the
output of `gh auth token`, and is never printed or stored. Sonah reads only the pull request's metadata (never its
files or changes), and it posts counts and fixed sentences from the review's checklist only, never quotes, file text,
paths or the page; every text it carries is masked first (see
[INSTALL.md](INSTALL.md#posting-a-count-only-pr-comment)).
