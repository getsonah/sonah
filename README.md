<div align="center">

# Sonah

**Did your coding agent do what you asked?**

Sonah reads your Claude Code or Codex session and shows what the agent finished, what it decided on its own, and what
it claimed, with the agent's own words as evidence.

[![ci](https://github.com/getsonah/sonah/actions/workflows/ci.yml/badge.svg)](https://github.com/getsonah/sonah/actions/workflows/ci.yml)

[Website](https://sonah.dev) &nbsp;&bull;&nbsp; [Install](#install) &nbsp;&bull;&nbsp; [Guide](docs/INSTALL.md) &nbsp;&bull;&nbsp; [Privacy](docs/PRIVACY.md) &nbsp;&bull;&nbsp; [Changelog](CHANGELOG.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/getsonah/sonah/assets/review-dark.png">
  <img width="800" alt="A Sonah review: where your attention is needed, then each thing you asked with what settles it" src="https://raw.githubusercontent.com/getsonah/sonah/assets/review-light.png">
</picture>

</div>

## Install

```sh
npm install -g getsonah
sonah doctor
```

You need Node.js 20 or newer, Git, and Claude Code signed in (`claude auth login`). Sonah calls the reviewer model
through your own login.

## Review a session

```sh
cd ~/code/your-project
sonah review --format html --output ~/review.html
```

Sonah reviews the newest session recorded in that project and opens the page.

## What you get

- **What you asked**: every request, done or not, with the evidence that settles it.
- **What the agent decided**: choices it made without asking you, and choices not to act.
- **What it claimed**: each claim checked against what actually ran.
- **The change itself**: a review of the code, informed by the session.

No verdict. Every quote is checked word for word against the recording, and anything Sonah could not check is marked
as not checked.

## Docs

- [Install and usage guide](docs/INSTALL.md)
- [Privacy](docs/PRIVACY.md)
- [Troubleshooting and exit codes](docs/TROUBLESHOOTING.md)
- [Contributing](CONTRIBUTING.md) &nbsp;&bull;&nbsp; [Security](SECURITY.md)

## License

[Business Source License 1.1](LICENSE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
