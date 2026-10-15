# Changelog

## 0.3.0-beta.1

The first public beta. Sonah reads the recording of an AI coding session (Claude Code or Codex; Cursor is
experimental) and writes a checklist for the person who ran it: whether the agent did what you asked, and what it
decided on its own, each with the recorded words that show it. It never says the work is right, ready or approved.
Commands, the page and the files under `~/.sonah` can change between betas.

### The page leads with the agent's judgment

- First, what the agent decided on its own: choices it made without asking you, then choices where you asked and it
  chose how, and its changes of approach. A choice not to act is highlighted.
- Then what you asked, each ask shown done, partly done or not done with the evidence that settles it; the failures it
  passed over; what it told you that a recorded result contradicts or confirms; edits against what you said; and what
  the code review found.
- What Sonah could not check is kept, each row with why, in one folded section at the end. The summary at the top
  counts only what needs your attention and says how many rows are folded.
- What you wrote in your project's instruction file (a `CLAUDE.md`, or an `AGENTS.md` the agent was given) counts as
  your words. One the agent wrote or edited itself in the session counts as the agent's, and the reviewer is never
  shown what the agent wrote in it as yours. A file you wrote that the agent edits later is still shown as it was when
  the agent was given it.
- Every quote is checked by code to appear word for word in the recording. Every claim the agent made, and every edit
  against what you said, must survive three independent checking passes. What the checks reject is left off the page;
  what they cannot settle is marked not checked.
- `sonah decision accept|change|clarify` records your answer to a row on your computer, and the page shows it the next
  time it is written.
- The exit code says only whether Sonah's own review ran, never anything about the agent's work. With the code step on
  by default (or by your setting), the session review decides it; what the code step could not read is shown on the
  page and in the terminal. With `--code-pass` on the command line, the code step must read every file it shows too.

### The code step

- After the session review, Sonah reads the change the session made (every file that differs from the commit the
  session started from, read with git, which it never writes to; with no git history, the session's recorded edits)
  and the files the session changed or read, as they are now, and sends them to the reviewer.
- The reviewer first checks the agent's claims, decisions, your asks and the failures it passed over against the code,
  then reads the change four ways: behaviour, tests, contracts, and your ask.
- Each finding names the input that shows it and quotes every step from that input to the line it is about. It is
  shown only when all three of its checking passes uphold it, and those passes never see the agent's own account. A
  concern no line can show becomes a question for you.
- The page lists the findings under "What the code review found", each beside the row of the session review it follows
  from, then the questions and what the code review did not cover. Each checked row says what the code shows of it,
  beside its own status, which the code step never changes.
- `--code-model ID` (or `SONAH_CODE_MODEL`) runs the code step on a model of its own, such as `claude-opus-5-5[1m]`,
  checked as `--model` is, whenever the code step runs. The session review stays on its own model, its requests and
  stored answers unchanged. The code step's stored answers are kept per model, and the usage line names the code step's
  model with its share of the calls. Without it, the code step uses the session review's model.

### Turning the code step on or off

- The code step is on by default.
- `sonah config code-pass off` turns it off for every review, and `sonah config code-pass on` turns it back on.
  `sonah config` shows the setting, kept in `~/.sonah/config.json`, readable by you only.
- For one review, `--no-code-pass` or `--code-pass` wins over the setting.
- The dry run and the line printed before the first call say whether the code step will run and roughly how many calls
  it adds. `sonah doctor` reports the setting.
- A settings file that cannot be read stops a review given no flag, before anything is read or sent, and says how to
  fix it.
- The session's own requests are the same whether the code step is on or off.

### Privacy

- The reviewer reads the session as it was recorded, secrets and pasted images included, through your own login. If
  the reviewer is a different provider or login from the one that ran the session, the session goes there for the
  first time; reviewing with the same provider and login avoids that.
- With the code step, the files the session changed or read are sent too. Never sent: credential-shaped files, anything
  in `~/.claude` or `~/.codex` (or the homes you set for them, or the one the recording lies in, when it lies in Claude
  Code's or Codex's own folder layout) and Claude Code's `~/.claude.json`, binary files, files outside the project, files too large for a request, and files that changed
  since the session. Paths outside the project are counted, never named.
- When the repository is your home folder (or holds it), as in a dotfiles repository, the code step reads only the files
  the session itself changed or read. Every other file git shows changed is counted, never named or sent, and Sonah
  never searches your home folder for new files.
- Secrets are masked in everything Sonah writes for you: the page, the Markdown story, the terminal and a PR comment,
  including secrets found in the files the code step read and wherever the reviewer repeats one. If masking cannot
  run, nothing is written or posted.
- Besides the model requests and a PR comment you ask for, Sonah makes no network request: no telemetry, no update
  check. Stored answers and reviews stay under `~/.sonah`, readable by you only.
- [docs/PRIVACY.md](docs/PRIVACY.md) says exactly what is sent and kept.

### Install and run

- Install from npm with `npm install -g getsonah` (the package is `getsonah`; the command it installs is `sonah`), or
  run it once with `npx getsonah`, or install from a checkout with one command (`node scripts/install.mjs`).
  `sonah doctor` checks Node, your sign-in, one tiny model request and the code step's setting, with a fix for each
  problem.
- In your project, `sonah review` reviews the newest Claude Code or Codex session recorded there, helper agents
  included. `sonah sessions`, `--choose N` and `--repo DIR` pick another; a Cursor session is read when you pass its
  path.
- The default reviewer is `claude-sonnet-5-5[1m]` through your own `claude` login; `--backend codex-cli` and
  `--backend anthropic-api` are the alternatives.
- Before the first call a review says roughly how long it will take. Ctrl-C stops it and keeps its answers; the same
  command continues. A rerun reuses stored answers and asks only what is new or failed.
- `--format html --output FILE` writes and opens the page; `--format md` writes the same review as a short Markdown
  story.
- A count-only PR comment is off unless you ask for it, and is posted only after you confirm it.
- `sonah feedback` writes setup facts and counts, with no session text, for a bug report.
- If you used an early preview, [what changed for you](docs/INSTALL.md#if-you-used-an-early-preview) is at the end of
  the installation guide.

### Licence

- Sonah is source-available under the Business Source License 1.1: free for teams of up to three people using it, for
  non-profits and for a 30-day trial, with no licence key and no licence check. Every version becomes Apache-2.0 two
  years after it is first published. See [Pricing and licence](README.md#pricing-and-licence).

### Known limits

- A long session can take tens of minutes to review.
- A helper agent's work is reviewed only when its recording is found beside the parent's; a missing one is named.
- A file changed through the shell (`sed -i`, a heredoc) is recorded only as its command, so there is no edit of it to
  show or check.
- The code step reads files as they are on this computer now: a recording from another computer leaves it nothing to
  read. The page and the terminal say so; the exit code still follows the session review, unless you add
  `--code-pass`, which makes the code step's coverage count.
- A Cursor recording can omit tool outputs, so a review of it checks less. Windows has not been verified.
- A secret with no telling name and no known shape can get through the masking.
- The review can miss a decision or file it under the wrong heading: check the rows that matter to you against their
  evidence.
