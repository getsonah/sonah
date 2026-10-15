<div align="center">

# Sonah

**Code review for your agent's PRs: did you get what you asked for?**

[![ci](https://github.com/getsonah/sonah/actions/workflows/ci.yml/badge.svg)](https://github.com/getsonah/sonah/actions/workflows/ci.yml)

[Website](https://sonah.dev) &nbsp;&bull;&nbsp; [Install](#install) &nbsp;&bull;&nbsp; [Usage](#usage) &nbsp;&bull;&nbsp; [Guide](docs/INSTALL.md) &nbsp;&bull;&nbsp; [Privacy](docs/PRIVACY.md) &nbsp;&bull;&nbsp; [Changelog](CHANGELOG.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/getsonah/sonah/assets/review-dark.png">
  <img width="800" alt="A Sonah review: where your attention is needed, then each thing you asked with what settles it" src="https://raw.githubusercontent.com/getsonah/sonah/assets/review-light.png">
</picture>

</div>

You hand the work to Claude Code or Codex. It says "done, all tests pass", and a PR lands. You can't read every
line any more, and the diff can't tell you what you asked for, whether "done" is true, or what the agent decided on
its own.

Sonah reviews the session behind the change, on your machine, before you merge:

- **Did it do what you asked?** Your requests, each shown done, not done or not checked, with the evidence from the
  session.
- **Is "done" true?** What the agent told you, checked against what actually ran: confirmed, contradicted by a
  recorded result, or not checked.
- **What did it decide on its own?** The calls it made, sorted by whether you asked for them, so you can confirm or
  overrule each one.

Every row quotes the session word for word, and code checks each quote. There's no score and no verdict: you make the
call. Sonah reviews the intent, the part a diff can't show. It doesn't hunt bugs, so keep your bug finder.

It runs locally through your own `claude` (or `codex`) login, works on sessions you ran on this machine, and has no
dependencies beyond Node.js. It's a beta: see [Status and known limits](#status-and-known-limits).

## Install

```sh
npm install -g getsonah
sonah doctor                  # checks Node, your claude login and one tiny model request
```

You need Node.js 20 or newer, Git, macOS or Linux, and Claude Code signed in (`claude auth login`) with access to
`claude-sonnet-5-5[1m]`. To try it without installing, run `npx getsonah doctor`. To install from a checkout instead:

```sh
git clone https://github.com/getsonah/sonah sonah && cd sonah && node scripts/install.mjs
```

## Usage

Go into the project where you ran the agent, then review its newest session:

```sh
cd ~/code/your-project
sonah review --dry-run                                # what would be reviewed, and roughly how long; no model call
sonah review --format html --output ~/review.html     # review it and open the page
```

Other ways to run it:

```sh
sonah sessions                                        # this project's recorded sessions, newest first
sonah review --choose 2 --format html --output ~/second.html
sonah review /path/to/session.jsonl --format html --output ~/review.html
sonah review --format md --output ~/review.md         # a short Markdown story instead of a page
sonah review --no-code-pass --format html --output ~/session.html   # the session only, no files read
sonah review --backend codex-cli --model gpt-6.1-sol --format html --output ~/review.html   # your codex login
```

A short session takes a few minutes; a long one is reviewed in parts and can take longer. The calls go through your own
login and count toward your plan's usage. A review that stops partway resumes when you run the same command again.

**What is read and sent:** the session's recording and, with the code step (on by default), the files the session
changed or read, sent to the reviewer model through your own login. Nothing else leaves your machine. See
[Privacy](docs/PRIVACY.md), and [Troubleshooting](docs/TROUBLESHOOTING.md) for messages and exit codes.

## Status and known limits

- A beta (`0.3.0-beta.1`): commands, the page and the files under `~/.sonah` can change between betas.
- Claude Code and Codex are supported, Cursor is experimental. macOS and Linux are supported; Windows is not verified.
- The default reviewer needs `claude-sonnet-5-5[1m]`; the Codex CLI and the Anthropic API are the alternatives.
- The review can miss a decision or put one in the wrong place: check the rows that matter against their evidence.

The full list is in the [guide](docs/INSTALL.md#known-limits).

## Docs

- [Install and usage guide](docs/INSTALL.md)
- [Privacy](docs/PRIVACY.md)
- [Troubleshooting and exit codes](docs/TROUBLESHOOTING.md)
- [Contributing](CONTRIBUTING.md) &nbsp;&bull;&nbsp; [Security](SECURITY.md)

## License

[Business Source License 1.1](LICENSE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
