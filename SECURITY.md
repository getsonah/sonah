# Security

## Reporting a vulnerability

Report a vulnerability privately, through GitHub's private vulnerability reporting: open this repository's
**Security** tab and choose **Report a vulnerability** (the
[report form](https://github.com/getsonah/sonah/security/advisories/new)). Only the maintainers can read the report. If you cannot use it,
email abhinav04soni@gmail.com instead.

Never report a vulnerability in a public issue, a pull request or a discussion.

Please include what you found, how to reproduce it, the output of `sonah --version`, your operating system and Node.js
version, the harness that recorded the session (Claude Code, Codex or Cursor) and the reviewer you used. A maintainer
replies in the report (or by email) and keeps you informed until it is fixed.

## Supported versions

Sonah is a beta: fixes go into the latest release only.

## Never attach session recordings

Session recordings (transcripts), and Sonah's review pages, Markdown stories and reports, can hold credentials: an
agent can print a key, a token or a password into the session, and Sonah sends, shows and stores the session as it was
recorded, masking nothing (its answers under `~/.sonah` can quote one). Never attach a real recording, a review page or
a Sonah report to a vulnerability report. If the problem needs one, describe it, or build a small synthetic session that
shows it, and check it for secrets first.

## What counts

Anything that can make Sonah send, store or show what it should not: a file sent outside what
[docs/PRIVACY.md](docs/PRIVACY.md) describes (such as a code-step agent reading outside your repository), review files
readable by other users, a PR comment that carries a quote, a path or a file's text, or a network request beyond those
PRIVACY.md lists. Also a recording or a repository that makes Sonah, or the reviewer or agents it starts, run code,
write files, read outside what PRIVACY.md describes, or reach the network (see below).

Masking is not a security boundary: Sonah masks nothing, by design. A secret from your session shown on the page, in
the Markdown or on the terminal is the session as recorded, not a vulnerability; protect those files as you protect
the recording.

## Threat model

A recording is untrusted input, and so is your repository. They hold tool output, web pages the agent fetched and
files of the repository, and any of them can carry text written to steer the reviewer model or the code step's agents.

- Such text can bias what the review lists or leaves out. That is a limit of any review a model writes; every row
  shows its evidence so you can check it.
- It must not be able to make Sonah, the reviewer or its agents run code, write files, read outside what PRIVACY.md
  describes or reach the network. For the session review, the `claude` reviewer runs in an empty private folder with its
  tools, MCP servers, settings and slash commands switched off, and receives the session on standard input. The code
  step's agents run in your working directory with three read-only tools (Read, Grep and Glob) and nothing else: no MCP
  servers, settings or slash commands, your project's `CLAUDE.md` files not loaded as their instructions, and Claude
  Code's restricted mode confining them to the working directory, the repository it lies in, each other git repository
  that holds a file of the change (its top folder) and, when the change is reviewed in parts, Sonah's copy of the
  changed files as they were at the start commit; a call that uses any other tool fails and is not used. The Codex
  reviewer runs read-only with its tools and web search off. Every quote the reviewer or an agent gives is checked by
  code against the recording or the file it names. The page runs no script, loads nothing from the network and escapes
  every text it shows.

A recording or a repository that gets past any of this is a vulnerability: please report it as above.
