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

Session recordings (transcripts) and Sonah's review pages and reports can hold credentials: an agent can print a key,
a token or a password into the session, the reviewer reads the session as recorded (its answers under `~/.sonah` can
quote one), and Sonah masks only the secrets its scan recognises in what it writes for you. Never attach a real
recording or a review page to a report. If the problem needs one, describe it, or build a small synthetic session that
shows it, and check it for secrets first.

## What counts

Anything that can make Sonah send, store or show what it should not: a secret shown unmasked on the page, in the
Markdown, on the terminal or in a PR comment, a file outside what [docs/PRIVACY.md](docs/PRIVACY.md) describes being
sent, review files readable by other users, or the masking step being skipped instead of failing closed. Also a
recording that makes Sonah, or the reviewer it starts, run code, read files or reach the network (see below).

## Threat model

A recording is untrusted input. It holds tool output, web pages the agent fetched and files of the repository, and any
of them can carry text written to steer the reviewer model.

- Such text can bias what the review lists or leaves out. That is a limit of any review a model writes; every row
  shows its evidence so you can check it.
- It must not be able to make Sonah or the reviewer run code, read files or reach the network. The `claude` reviewer
  runs in an empty private folder with its tools, MCP servers, settings and slash commands switched off, and receives
  the session on standard input. The Codex reviewer runs read-only with its tools and web search off. Every quote the
  reviewer gives is checked by code against the recording. The page runs no script, loads nothing from the network
  and escapes every text it shows.

A recording that gets past any of this is a vulnerability: please report it as above.
