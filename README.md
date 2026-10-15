# Sonah

[![ci](https://github.com/getsonah/sonah/actions/workflows/ci.yml/badge.svg)](https://github.com/getsonah/sonah/actions/workflows/ci.yml)

Your coding agent worked for an hour and you will not read every line it wrote. Sonah reads the session's recording
and shows you, with the agent's own words as evidence, whether it did what you asked and what it decided on its own.

Sonah is a local command-line tool for sessions recorded by Claude Code or Codex (Cursor is experimental). It answers
two questions:

1. **Did the agent do what you asked?** Every request you made, carried through or not.
2. **What did the agent decide on its own?** Its decisions, assumptions and choices not to act, what it read and
   concluded, and where you asked for something and it chose how. Each is shown plainly so you can confirm it or
   overrule it without reading the code.

The result is a checklist page, not a verdict: Sonah never says the work is right, ready or approved. Every quote on the
page is checked by code to appear word for word in the recording, and anything Sonah could not check is shown as not
checked. It has no dependencies beyond Node.js and calls the reviewer model through your own `claude` (or `codex`)
login. It is a beta: see [Status and known limits](#status-and-known-limits).

It is source-available, and free for teams of up to three people using it and for non-profits: see
[Pricing and licence](#pricing-and-licence).

## Quickstart

You need:

- Node.js 20 or newer (with npm) and Git, on macOS or Linux;
- Claude Code signed in (`claude auth login`), with an account that can use `claude-sonnet-5-5[1m]` (Sonnet 5.5 with
  its 1M-token window).

Install the npm package `getsonah`, which gives you the `sonah` command, then check your setup:

```sh
npm install -g getsonah
sonah doctor                                  # checks Node, the claude login and one tiny model request
```

`npx getsonah doctor` runs the same command once, without installing it. To install from a checkout instead, with one
command into `~/.local`:

```sh
git clone https://github.com/getsonah/sonah sonah && cd sonah && node scripts/install.mjs
export PATH="$HOME/.local/bin:$PATH"          # the installer prints the folder to add to PATH
```

Your first review: go into the project where you ran a coding session, and run `sonah review`.

```sh
cd ~/code/your-project
sonah review --dry-run                        # what would be reviewed and roughly how long; no model call
sonah review --format html --output ~/review.html
```

**What is read and sent.** Sonah reviews the newest session recorded in that project (helper agents included) and
sends it to the reviewer model through your own `claude` login. The code step, on by default, also reads the files the
session changed or read, as they are now, and sends them too; credential-shaped files, `~/.claude`, `~/.codex`, files
outside the project and binary files are never sent. Nothing else leaves your computer. To review the session only:

```sh
sonah config code-pass off                    # for every review; sonah config code-pass on turns it back on
sonah review --no-code-pass                   # for one review
```

Sonah says up front roughly how long the review will take, runs to the end, and opens the page. A short session takes
a few minutes; a long one is reviewed in several parts and can take tens of minutes. `--profile standard` checks every
item in three passes and is slower. The calls go through your own login and count toward your plan's usage. A review
stopped partway (Ctrl-C, a usage limit or one of the optional stops below) resumes when you run the same command
again, and keeps the answers it already has. Keep review files out of Git: they quote your session.

To try it with no login and no model call, run a dry run on the synthetic session in the checkout:
`sonah review --dry-run corpus/golden/d04-clean.jsonl`.

To leave a count-only comment on a pull request of a private repository, add `--github OWNER/REPO --pr N
--post-comment`. It is off unless you ask, needs a GitHub App token, and posts only after you confirm the exact comment
in the terminal (see the [installation guide](docs/INSTALL.md#posting-a-count-only-pr-comment)).

## Privacy, in short

- **The reviewer model reads your session as it was recorded**, secrets and images you pasted included, through your
  own login. With the code step (on unless you run `sonah config code-pass off`), it also reads the files the session
  changed or read, as they are now. If the reviewer is a different provider or login from the one that ran the session (a Claude Code session
  reviewed with `codex`, or a work account's session reviewed under a personal login), the session goes there for the
  first time; review with the same provider and login to avoid that.
- **Everything Sonah writes for you to read is masked**: the page, the Markdown story, the terminal and a PR comment.
  If masking cannot run, nothing is written or posted.
- **Nothing else leaves your computer**: no telemetry, no update check. Reviews and the model's answers are kept under
  `~/.sonah`, readable by you only; they can quote the session as recorded, so treat them, and every recording, as
  sensitive.

The full statement: [docs/PRIVACY.md](docs/PRIVACY.md).

## What a review looks like

An excerpt of a review of a synthetic session (an agent adding pagination to a small notes API; every name in it is
invented):

```text
Where your attention is needed
  3 asks of yours are not shown done: 3 not checked
  10 claims not checked against a recorded result
  2 choices not to act
  4 decisions made without asking you
  4 decisions where you asked and the agent chose how

What the agent decided · made without asking you
  01  A choice not to act · DELETE ownership check
      Chosen      Do not change DELETE /notes/:id, which the agent says has no ownership check
      Agent said  "That is outside this task, so I have not changed it."
  …
  04  Final test run scope
      Chosen      After the invalid-limit change, ran only test/pagination.test.js, not the full suite
      Agent ran   "node --test test/pagination.test.js"
```

A review page reads top to bottom:

- **Where your attention is needed**: counts of what to look at first: requests not shown done, claims contradicted
  or not checked, decisions made without asking you, choices not to act, failures it passed over, edits against what
  you said.
- **What you asked**: each request in your words, with its status (done, partly done, not done, not checked) and the
  evidence that settles it or what is missing.
- **What the agent told you**: its claims, by status: contradicted by the recording, resting on a check that never
  completed, not checked, confirmed.
- **What the agent decided**: decisions made without asking you, then decisions on how to do what you asked. A choice
  not to act is highlighted.
- **Failures it passed over**, **edits against what you said**, statements it wrote into files, and **what could not be
  checked**.

The page is one self-contained file: no script, nothing loaded from the network, light or dark as your system is set.

## What Sonah does and does not do

It does:

- read the recording your agent already keeps; you change nothing in how you work;
- review long sessions in parts; test every claim the agent made, and every edit against what you said, in three
  independent checking passes, and every other item the model proposes in one check against the evidence it cites
  (`--profile standard`: three passes for every item): what the checks reject is left off the page, and what they
  cannot settle is kept and marked not checked;
- check every quote against the recording by code, never by trusting the model;
- show what it could not check, and why, instead of guessing;
- mask secrets on your computer in everything it writes for you to read;
- keep everything on your computer except the model requests themselves.

It does not:

- give a verdict, approve, merge or block anything;
- run your code or your tests: the review reads the recording and, with the code step (on unless you turn it off),
  the files the session changed or read, as they are now, and their changes from Git, which it never writes to;
- let the model rate its own confidence or the severity of anything;
- post anything anywhere unless you ask for it and confirm;
- change your recordings.

It can be wrong. That is why every row carries the evidence you need to check it yourself.

## Reading and answering the result

The command also prints a short summary: whether Sonah's own review completed, the parts it could not cover, and
where your attention is needed. To record your answer to a row on this computer, use the `sonah decision
accept|change|clarify ...` command the page prints once, near the top, with the id the page prints under that row;
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md#answering-a-row-with-sonah-decision) shows where the report file it
needs is kept.

The exit code reports only whether Sonah's own review ran, never a judgment of the agent's work: a review with findings
that ran to the end exits `0`, and one that ran but did not complete exits `1`. With the code step on by default (or by
your setting), the session review decides; what the code step could not read is said on the page and in the terminal.
With `--code-pass` on the command line, the code step must also read every file it shows. Every exit code is listed in
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md#exit-codes).

## More ways to run it

```sh
sonah sessions                                  # this repository's recorded sessions, newest first
sonah review --choose 2 --format html --output ~/second.html
sonah review /absolute/path/to/session.jsonl --format html --output ~/review.html
sonah review --backend codex-cli --model gpt-6.1-sol --format html --output ~/codex-review.html   # your codex login
sonah review --format md --output ~/review.md   # the same review as a short Markdown story
sonah review --no-code-pass --format html --output ~/session.html   # the session only: no file is read or sent
```

The code step (on unless you run `sonah config code-pass off` or add `--no-code-pass`; `--code-pass` turns it on for
one review) also reviews the code, the way a reviewer reviews a pull request, with the session review beside it. After the session review, Sonah reads the change the session made: every file that differs
from the commit the session started from (read with git, which it never writes to; with no git history to start from,
the session's own recorded edits), each file's lines before and after, and a file git shows changed that no recorded
edit wrote is marked so. It reads those files as they are now, then the files the session read, in the working
directory the recording names, and sends them to the reviewer in the request (the reviewer still has no tools). A
credential-shaped file, a file in `~/.claude` or `~/.codex` (or the home you set for Claude Code or Codex, or a folder
one of them links to, deleted or not), Claude Code's own `~/.claude.json` and its backups, a link into any of these, a
binary file (or one git diffs as binary, through a
`binary` or `-diff` attribute), a file outside that directory (wherever a link leads), one too large for a request, and
a file that no longer holds what the session last wrote to it are never sent, before or after; the page counts them by
kind, and the code review does not read as complete while any part of the change went unshown (a file the agent
changed outside that directory, such as a scratch file, included). When the working
directory is a folder of a larger repository, git is asked about that folder only: paths that differ elsewhere are
counted, never named. The reviewer first checks the agent's claims, decisions, asks not
shown done and failures it passed over against the code, then reads the whole change four ways (behaviour, tests,
contracts, your ask), with what the session review found beside it, each finding naming the input that shows it and
quoting every step from that input to the line (of the session, a step may quote only your words or a recorded
result, never the agent's: a helper's report, and a `CLAUDE.md` the agent wrote, edited or deleted in the session, count
as the agent's; a copy, move or `git checkout` onto it is not seen as a write).
Every answer and finding quotes the code and is checked word for word by code, then by three checking passes that must
all uphold it; a finding's checking passes are never shown the agent's words from the session (a finding's own wording
is the reviewer's, and is shown), and the passes that check a row against the code see what the row states and no other
words of the agent's. The
page lists them under "What the code review found": each finding beside the row of the session review it follows
from, then the others, then questions only you
can answer, then what the code review did not cover. Each checked row says what the code shows of it, beside its own
status, which the code pass never changes. Run it again on the same `--state-dir`, and the session part reuses its
stored answers: only the code pass asks anything new. `--dry-run --state-dir DIR` says, with no call and nothing
written, how many stored session answers such a run would reuse and what the code pass would send first.
`--code-model ID` (or `SONAH_CODE_MODEL`) runs the code pass on a model of its own, such as `claude-opus-5-5[1m]`, while
the session review stays on `--model` (or the default); the code pass's stored answers are kept per model.

Cursor sessions are read only when you pass their path
(`ls -t ~/.cursor/projects/*/agent-transcripts/*.jsonl | head -1`), and a Cursor recording can omit tool outputs, so a
review of it can check less. Optional stops, off by default: `--max-calls N`, `--max-input-bytes N`,
`--stop-at-utilization U`. Running the same review again reuses stored answers and costs nothing; a review that did not
complete asks again only what failed (it still wrote its page, so give the rerun a new `--output` name). The
[installation guide](docs/INSTALL.md) covers the main options (`sonah review --help` lists the review options), the
Codex and API backends, where things are stored, and uninstalling.

## Troubleshooting and questions

Run `sonah doctor --no-probe` first: it makes no model call and names what is missing. The messages Sonah prints most
often, what they mean and what to do: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

Questions, bugs and ideas go to [GitHub issues](https://github.com/getsonah/sonah/issues). Never paste a session recording, a Sonah page or
a report into an issue: they can hold secrets. Security problems go privately, as [SECURITY.md](SECURITY.md) describes.

## Status and known limits

Sonah is a beta (`0.3.0-beta.1`), on npm as the package `getsonah`. Commands, the page and the files under `~/.sonah`
can change between betas.

- Claude Code and Codex are supported. Cursor is experimental. macOS and Linux are supported; Windows has not been
  verified.
- The default reviewer needs a Claude account that can use `claude-sonnet-5-5[1m]`; the Codex CLI and the Anthropic API
  are the alternatives.
- A long review takes a while: parts are reviewed four at a time, and a large session can take tens of minutes. The
  estimate printed before the first call is the best guide.
- Work done by a helper agent is reviewed only when its recording is found beside the parent's. A missing one is named,
  never silently treated as the parent's work.
- A file changed through the shell (`sed -i`, a heredoc) is recorded only as its command: there is no recorded edit of
  the file to show or check.
- The code step reads the files as they are on this computer now. A recording from another computer, or a project
  whose files were deleted since, leaves it with nothing to read. The page and the terminal say so, and the exit code
  still follows the session review, unless you add `--code-pass`, which makes the code step's coverage count.
- Images you paste into your messages are sent to the reviewer. This is new, and checked on the default `claude`
  reviewer only, not yet on the `codex` or Anthropic API reviewers.
- The review can miss a decision or put one in the wrong place: check the rows that matter to you against their
  evidence.

## Pricing and licence

Sonah is free to use on real work if any of these is true:

- **You use it for your own work**, personal or paid, including at a company where no more than three people have
  used Sonah so far this calendar month.
- **Your organisation has had no more than three people using Sonah** so far this calendar month.
- **You are a non-profit**, using it for your non-profit work.
- **You are trying it out**: any organisation, for 30 days, once, from the day its use first goes beyond the free
  cases above.

Anyone may read, build, change and test the code for free, whoever they are.

**Who counts as a user.** Everyone in your organisation, including contractors, who runs Sonah, has it run for them
(for example in CI), or has agent sessions or pull requests they started, directed or authored reviewed by it,
counted once per calendar month (UTC) however many machines or repositories they use. People who only read its
results do not count. Work done by agents or bots counts as the work of the people who started or directed it.
Outside contributors whose pull requests to your public repositories are reviewed do not count. Companies in the same
group count together.

**Team licence.** After its 30-day trial, an organisation with four or more people using Sonah in a month needs a
team licence, unless it is a non-profit. Email [abhinav04soni@gmail.com](mailto:abhinav04soni@gmail.com) to get one,
or to ask whether you need one.

**Not allowed without a separate agreement:** offering Sonah, or a product or service built on it with the same or
substantially similar functionality, to others commercially, including as a hosted or managed service; offering one
that replaces Sonah or the paid Sonah products and services; and selling team features built on top of it. Using such
a product or service from someone else is not free either. Using Sonah inside your own organisation is always fine
within the limits above. Setting Sonah up for a client in the client's own environment, for the client's own use, is
fine too, and the client's users count under these limits; running Sonah as a service for clients is not.

**Honour-based.** Sonah has no licence key and no licence check, and it does not contact any server about your
licence. You count your own users.

**Every version becomes Apache-2.0** two years after it is first published.

This summary is not the licence: [LICENSE](LICENSE) governs.

## Contributing

```sh
npm test
```

Node's standard library only, no runtime dependencies, and nothing to install before the tests. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the rules a change must keep, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for how the code is laid out. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

Sonah is source-available, not open source. It is licensed under the Business Source License 1.1 with an Additional
Use Grant that makes it free for teams of up to three people using it, for non-profits and for a 30-day trial; see
[Pricing and licence](#pricing-and-licence). [LICENSE](LICENSE) is the binding text. Each version becomes available
under the Apache License 2.0 two years after it is first published.

Copyright 2026 Abhinav Soni. Notices for adapted open-source code and ideas (Entire, Pullfrog, PR-Agent and
ReviewBench) are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); that material stays under its own MIT licence.
