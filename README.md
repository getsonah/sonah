<div align="center">

# Sonah

**Reviews what your coding agent did, not just the diff: did it do what you asked, what it decided on its own, and what
is wrong in the code.**

[![ci](https://github.com/getsonah/sonah/actions/workflows/ci.yml/badge.svg)](https://github.com/getsonah/sonah/actions/workflows/ci.yml)

[Website](https://sonah.dev) &nbsp;&bull;&nbsp; [Install](#install) &nbsp;&bull;&nbsp; [Cost and time](#cost-and-time) &nbsp;&bull;&nbsp; [Privacy](docs/PRIVACY.md) &nbsp;&bull;&nbsp; [Guide](docs/INSTALL.md) &nbsp;&bull;&nbsp; [Changelog](CHANGELOG.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/getsonah/sonah/assets/review-dark.png">
  <img width="800" alt="The first screen of a Sonah review: the asks of your prompt with their status, then the Must know items" src="https://raw.githubusercontent.com/getsonah/sonah/assets/review-light.png">
</picture>

</div>

## What you get

- **Did it do what you asked?** Each ask in your prompt, marked done, partly done, not done or not checked. A row that
  is not checked also says when the code review found that the ask holds in the code, which Sonah did not check.
- **What did it decide, and is "done" true?** The decisions it took alone, for you to confirm or overrule. The claims
  its own recorded results contradict, such as "all tests pass" after a failed test.
- **What is wrong in the code?** With the default reviewer, a code review agent reads your repository with read-only
  tools. It checks the change against your asks and the agent's claims.

You hand the work to Claude Code or Codex. It says "done, all tests pass", and a pull request lands. The diff cannot
tell you what you asked, whether "done" is true, or what the agent decided alone. Sonah runs on your machine, through
your own login, and reads the agent's session before you merge. [What is sent where](#what-is-sent-where) says what
leaves your computer.

Each item goes in Must act, Must know or Good to know. It says what it is and where it is. Every quote is word for word
from the session or the code, and code checks each quote. There is no score and no verdict: you make the call.

## Install

```sh
npm install -g getsonah
sonah doctor                  # checks Node, your claude login and one tiny model request
cd ~/code/your-project
sonah review --format html --output ~/review.html     # reviews the newest session here, opens the page
```

To try it without installing, run `npx getsonah doctor`. To install from a checkout instead:

```sh
git clone https://github.com/getsonah/sonah sonah && cd sonah && node scripts/install.mjs
```

To update, run `npm install -g getsonah@latest`. [Update](docs/INSTALL.md#update) gives the other ways. To remove
Sonah, run `npm uninstall -g getsonah`.

## Requirements

- Node.js 20 or newer, and Git. macOS or Linux. Windows is not verified.
- Claude Code, signed in (`claude auth login`), with an account that can use `claude-sonnet-5-5[1m]`. Sonah reviews
  through this login. Your Codex login or an Anthropic API key also work, for the session review alone.
- The sessions: Sonah finds Claude Code and Codex sessions in the project where you run it. Cursor is experimental:
  give the path of its recording.
- The code review runs only with the default reviewer, your `claude` login. With `--backend codex-cli` or
  `--backend anthropic-api`, Sonah reviews the session alone.

## Cost and time

Sonah makes its calls through your own `claude` login. A review counts toward your Claude plan's usage limits, as your
own Claude Code work does. If your login bills an API account instead, it bills that account. Before the first call,
Sonah prints roughly how long the review should take. At the end, it prints the calls, the tokens, and how much of your
plan's usage limits is now used.

Three reviews, made with 0.3.0 beta builds from before this release, as their usage lines printed them:

| Session | Recording | Calls | Input tokens | Time |
| --- | --- | --- | --- | --- |
| Short | 0.3 MB | 12 | 0.24M | 2 minutes |
| Short | 0.2 MB | 8 | 0.44M | 4 minutes |
| Long, with helper agents | 3.1 MB, with 34 helper recordings (14 MB) | 116, and 12 for the code review | 28.7M, and 6.4M for the code review | 20 minutes, and 6 for the code review |

The two short reviews include the code review. In the long session, the session review stopped at a usage limit set
with `--stop-at-utilization`, and the same command resumed it. The code review ran on its own, with a later build.
Your numbers will differ with the length of the session and how much the agent did.

## Usage

Go into the project where you ran the agent, then review its newest session:

```sh
cd ~/code/your-project
sonah review --dry-run                                # what would be reviewed and roughly how long, with no model call
sonah review --format html --output ~/review.html     # review it, open the page, and write ~/review.md
gh pr comment --body-file ~/review.md                 # post the .md on your branch's pull request yourself
```

The page and the .md hold the same report. The .md is for a pull request comment. Sonah prints the `gh` command and
posts nothing itself.

After you commit and push your work, the report links each place in the code to GitHub. Did you run Sonah before you
committed? Then commit, push, and run the same command with a new `--output` file. Sonah reuses its stored answers, so
the second run makes no model call.

Other ways to run it:

```sh
sonah sessions                                        # this project's recorded sessions, newest first
sonah review --choose 2 --format html --output ~/second.html
sonah review /path/to/session.jsonl --format html --output ~/review.html
sonah review --format md --output ~/review.md         # the Markdown report only, no page
sonah review --no-code-pass --format html --output ~/session.html   # the session only, no files read
sonah review --backend codex-cli --model gpt-6.1-sol --format html --output ~/review.html   # your codex login, the session only
```

A review that stops partway resumes when you run the same command again. [Troubleshooting](docs/TROUBLESHOOTING.md)
lists the messages and exit codes.

## What is sent where

- **To the reviewer model, through your own login:** the session as the recording holds it. [Privacy](docs/PRIVACY.md)
  lists the few parts that are cut or left out, such as the agent's private reasoning. By default this is your
  `claude` login, so it goes to Anthropic. With `--backend codex-cli` it goes to OpenAI through your `codex` login.
  With `--backend anthropic-api` it goes to Anthropic's API with your key.
- **With the code review (on by default):** the session's change, the files it changed, and what the code review's
  read-only agents open. They read your repository, any other git repository where the session changed a file, and
  any that you give with `--code-repo`. Turn the code review off with `--no-code-pass`, or for every review with `sonah config code-pass off`.
- **Nothing else leaves your computer.** Sonah sends nothing to us: no telemetry, no analytics, no update check. It
  posts nothing to GitHub unless you ask and confirm.
- **Sonah masks nothing.** The page and the .md show the session as the recording holds it, secrets included. Read the
  report before you share it.

If the reviewer's provider did not run the agent, the session goes to that provider for the first time.
[Privacy](docs/PRIVACY.md) says exactly what each request holds and what Sonah keeps under `~/.sonah`.

## Status and known limits

- A beta: commands, the page and the files under `~/.sonah` can change between betas.
- The code review does not yet see every edit made by helper agents or by scripts after a `cd`. When the session ran
  a shell command, the report says so. `--code-repo DIR` points the code review at a repository that such a command
  changed.
- The code review reads the files as they are on this computer now.
- Sonah can miss a decision or put one in the wrong section. Check the items that matter against their evidence.

The full list is in the [guide](docs/INSTALL.md#known-limits).

## Docs

- [Install and usage guide](docs/INSTALL.md)
- [Privacy](docs/PRIVACY.md)
- [Troubleshooting and exit codes](docs/TROUBLESHOOTING.md)
- [Contributing](CONTRIBUTING.md) &nbsp;&bull;&nbsp; [Security](SECURITY.md)

## License

Sonah is source-available under the [Business Source License 1.1](LICENSE) (BUSL-1.1). Its additional use grant lets
individuals use it free of charge for their own work. If you use it for an organization, that organization must have
had at most three users in the calendar month. Non-profits can use it free too. Any other organization can try it for
30 days, once. Running it automatically, in CI for example, counts as use. The grant does not cover a competing
offering. Each version changes to the Apache License 2.0 two years after it is first made public.

[LICENSE](LICENSE) has the exact terms. Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
