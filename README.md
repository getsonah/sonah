<div align="center">

# Sonah

**Reviews what your coding agent did, not just the diff: did it do what you asked, what it decided on its own, and what
is wrong in the code.**

[![ci](https://github.com/getsonah/sonah/actions/workflows/ci.yml/badge.svg)](https://github.com/getsonah/sonah/actions/workflows/ci.yml)

[Website](https://sonah.dev) &nbsp;&bull;&nbsp; [Install](#install) &nbsp;&bull;&nbsp; [Cost and time](#cost-and-time) &nbsp;&bull;&nbsp; [Privacy](docs/PRIVACY.md) &nbsp;&bull;&nbsp; [Guide](docs/INSTALL.md) &nbsp;&bull;&nbsp; [Changelog](CHANGELOG.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/getsonah/sonah/assets/review-dark.png">
  <img width="800" alt="The first screen of a Sonah review: the counts and your asks, then the tabs and the Must act and Must know sections" src="https://raw.githubusercontent.com/getsonah/sonah/assets/review-light.png">
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
sonah review --format html --output ~/review.html     # reviews the newest session here, opens the page, writes ~/review.md
sonah                                                 # draws your branch's change as a page of graphs and opens it
```

In a terminal, plain `sonah`, with no command, runs `sonah visual` through your own `claude` login and opens its page
in your browser. `sonah --help` lists every command.

To try it without installing, run `npx getsonah doctor`. To install from a checkout instead:

```sh
git clone https://github.com/getsonah/sonah sonah && cd sonah && node scripts/install.mjs
```

To update, run `npm install -g getsonah@latest`. [Update](docs/INSTALL.md#update) gives the other ways. To remove
Sonah, first run `sonah hook remove` in each repository where you ran `sonah hook add`, `sonah hook remove --push` in
each repository where you ran `sonah hook add --push` (`sonah connect` can turn on either hook, after your yes),
`sonah skill remove` if you added /sonah, `sonah remind off` if you turned the Claude Code start reminder on, and
`sonah disconnect` if you connected this computer to Sonah Team; then run `npm uninstall -g getsonah`.

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
posts nothing itself. `~/` is your home folder, outside the project, so the next review does not read the report as
part of the change. A path inside the project works when `.gitignore` holds it.

When the session's work is committed, the review also draws the graphs page of the session's commits first, as
`sonah visual` does, with `claude -p` on your Claude plan (with `--code-base`, of the whole branch since that base). It
prints `Graphs page: <path>` and the calls and cost it took, and the review page links to it. The .md never does.
`--no-visual` skips it. It is not drawn on another backend than `claude-cli`, under `--max-calls`, `--max-input-bytes`
or `--stop-at-utilization`, with the code review off, or while the change is not all committed. One line then says why,
and the review page says it where the link would be, as it says the problem and fix of a graphs page that fails; where
`sonah visual` can draw it, the line names that command. Ctrl-C while it is drawn stops the graphs page only, with the
call it was making: the review still writes its page.

After you commit and push your work, the report links each place in the code to GitHub. Did you run Sonah before you
committed? Then commit, push, and run the same command with a new `--output` file. Sonah reuses its stored answers, so
the second run makes no model call for the review; an HTML review whose work is now committed draws its graphs page,
with calls of its own.

Other ways to run it:

```sh
sonah sessions                                        # this project's recorded sessions, newest first
sonah review --choose 2 --format html --output ~/second.html
sonah review /path/to/session.jsonl --format html --output ~/review.html
sonah review --format md --output ~/review.md         # the Markdown report only, no page
sonah review --no-visual --format html --output ~/review.html   # the page, without the graphs page of the commits
sonah review --no-code-pass --format html --output ~/session.html   # the session only, no files read
sonah review --code-base main --format html --output ~/branch.html  # the code review reads all the branch changed since main, in this folder
sonah review --backend codex-cli --model gpt-6.1-sol --format html --output ~/review.html   # your codex login, the session only
sonah skill add                                       # once; then type /sonah in Claude Code to review that session
sonah hook add                                        # once per repository: Claude Code's commits name their session
sonah sessions --commits main..HEAD                   # the sessions behind your branch, after sonah hook add
sonah visual                                          # a page of your branch's change, with How and Where graphs
sonah visual main..HEAD                               # the same, for a range you name
sonah                                                 # in a terminal: sonah visual, and it opens the page
sonah connect ABCD-EFGH                               # connect this computer to Sonah Team, with a code from its page
sonah connect --token                                 # the same, with a token from its /settings/tokens page
sonah hook add --push                                 # once per repository: each push is reviewed for your team
sonah status                                          # the connection, the push hooks and your reviews
sonah share                                           # put a page Sonah drew here on Sonah Team, with no push
sonah fixes                                           # the comments of your team that wait for you
sonah fix c_0123456789abcdef                          # take one of them to Claude Code, after your yes
sonah remind on                                       # Claude Code shows you those comments when it starts
```

The code for `sonah connect` comes from the Sonah Team server's page for connecting a laptop. Until that page offers
one, which comes with the server's next release, make an upload token on the server's `/settings/tokens` page and run
`sonah connect --token`, which reads it from standard input.

A review that stops partway resumes when you run the same command again. [Troubleshooting](docs/TROUBLESHOOTING.md)
lists the messages and exit codes.

## What is sent where

- **To the reviewer model, through your own login:** the session as the recording holds it. [Privacy](docs/PRIVACY.md)
  lists the few parts that are cut or left out, such as the agent's private reasoning. By default this is your
  `claude` login, so it goes to Anthropic. With `--backend codex-cli` it goes to OpenAI through your `codex` login.
  With `--backend anthropic-api` it goes to Anthropic's API with your key.
- **With the code review (on by default):** files of your working directory and of the git repositories that the code
  review reads ([Privacy](docs/PRIVACY.md) says which): the session's change, the other files that differ from where
  the session started, the lines the session read of other files and the skill files it used, as they are now, and
  what the code review's read-only agents open. Turn the code review off with `--no-code-pass`, or for every review
  with `sonah config code-pass off`.
- **With `sonah visual`, plain `sonah` in a terminal, or `sonah review --format html` on committed work:** the change of
  the range (for the review, from where the session started to `HEAD`; with `--code-base`, the whole branch since it
  met that base), through your own `claude` login: the repository's name, the commits' messages, the changed files'
  paths and each changed function's code with its added and removed lines. It reads no recording. The review skips it
  with `--no-visual`.
- **When you press "Save online" or "Invite your team" on that page:** your browser sends that review to Sonah's
  hosted team version, https://pr.sonah.dev: the change's code and diff as the review holds them, the commits' ids and
  messages, the findings, the paths and names of functions elsewhere in the repository that call the changed ones, the
  repository's owner and name and the branch ([Privacy](docs/PRIVACY.md#save-online-and-invite-your-team) lists it
  all). You sign in there and it is saved to your account. Nothing is sent until you press one, and the buttons are
  there only when the push remote of the repository names its owner and name. On a page of `sonah visual` or plain
  `sonah`, the buttons name the server this computer was connected to with `sonah connect` when Sonah drew the page,
  if it was connected to one, and `sonah visual --server` names another; the page carries that address only, never
  your upload token, and keeps it after you connect, disconnect or connect to another server, until that range's page
  is drawn again.
- **When you run `sonah share`:** one call to the server, `POST /api/uploads`, which puts a page Sonah already drew on
  this computer on the Sonah Team server you connected to: the same review that "Save online" sends, with the branch
  and the `sessions` field that a push's review carries. It draws nothing and asks the model nothing. Its git calls read
  this computer, but one: when a review of the same branch still waits to be sent here, Sonah may ask your remote for
  the branch's commit (`git ls-remote`, for at most 5 seconds, and a second more for each remote name after the
  first), to know which reviews the page takes the place of; in a partial clone, git may also fetch from your remote a
  commit those reads need that your clone does not hold. Nothing is sent until you run it
  ([Privacy](docs/PRIVACY.md#sonah-team-sonah-share)).
- **When you run `sonah connect`, `sonah status` or `sonah disconnect`:** calls to Sonah Team's server (or the one
  `--server` names) that connect this computer, show the connection, or end it. `sonah connect <code>` sends the code
  and a name for the upload token it gets, `sonah on <your computer's host name>`, with `POST /api/device/exchange`,
  then asks the server with `GET /api/token` whose the token is and shows you the login, the team and the seat before it
  keeps the token in `~/.sonah/team/connection.json` (yours only). Your answer no revokes it with `DELETE /api/token`.
  `sonah connect --token` and `sonah status` ask only `GET /api/token`, and a new connection revokes the one it
  replaces. The token goes only in the calls' `Authorization` header, never in an address, and Sonah never prints it.
  `sonah disconnect` revokes it with `DELETE /api/token`, a token you gave with `--token` too. They send no work of
  yours. The server keeps the token's hash and name, and the token works until it is revoked; for its limits,
  https://pr.sonah.dev also keeps for a day a row with the time of each code tried from your address and of each call
  made with the token. On https://pr.sonah.dev, the hosting's request log also notes each call to it, its path and
  query with your IP address
  ([Privacy](docs/PRIVACY.md#sonah-team-each-call-and-what-the-server-keeps) lists each call and what the server keeps).
- **At each push, in a repository where you ran `sonah hook add --push`:** a review of each pushed branch (at most 3),
  sent to the Sonah Team server you connected to with no button press. It runs in the background through your own
  `claude` login, as `sonah visual` does. First `GET /api/fixes` asks the server whether it still takes your token and
  lists the comments that wait for you; then `POST /api/uploads` sends the review, which holds what "Save online"
  sends, with the pushed branch and `sessions`: the agent sessions that the branch's commits name in `Agent-Session`
  lines, with those commits and the paths they changed (no session's content). Where your clone's remote-tracking
  branches cannot say, git asks your remote with `git ls-remote`, as `git fetch` would: whether it shows the pushed
  commit, which branch is its default branch, and, before a review that waits is sent, which commit the branch holds.
  Nothing runs when `CI` is set, before you connect, or after the server refuses your token. `git push --no-verify`
  skips it once; `sonah hook remove --push` turns it off ([Privacy](docs/PRIVACY.md#sonah-team-the-push-hook)).
  `sonah hook add --push` itself asks the server only for your seat, with `GET /api/token`. Whatever your seat, the
  server tells your team's webhooks of each upload, and of each fix it marks pushed. Sonah has no command that deletes
  an upload from the server.
- **When you run `sonah fixes`:** one `GET /api/fixes` a repository, which sends its owner and name and lists the
  review comments of your team that wait for you there. It keeps that list in `~/.sonah/team/waiting.json`, so the
  push hook's line and `sonah status`'s count make no call of their own
  ([Privacy](docs/PRIVACY.md#sonah-team-sonah-fixes-and-sonah-fix)).
- **When you run `sonah fix <comment id>`:** one `GET /api/fixes/<comment id>`, which sends the id and answers with the
  comment, the item and the review's branch and commits. Sonah shows you the whole prompt and asks before anything
  reaches Claude Code. On your yes it starts Claude Code in the worktree with that branch, with your shell's
  environment: on your own `claude` login, or on an `ANTHROPIC_API_KEY` your shell sets, which `sonah fix`, unlike the
  review of a push, does not take out. It sends one more call, `POST /api/fixes/<comment id>/launched`, with the
  session's id, so your team can see that you took the comment up. Its git calls read this computer (in a partial
  clone, git may fetch from your remote the review's commits that your clone does not hold), and it reads one
  recording: the session that wrote the change, to see whether it made that commit here. It keeps the prompt as it was
  sent in `~/.sonah/team/fixes/<comment id>.json` (yours only), which the next push or `sonah share` of the repository
  names in its upload ([Privacy](docs/PRIVACY.md#sonah-team-sonah-fixes-and-sonah-fix)).
- **When Claude Code starts, once you ran `sonah remind on`:** `sonah remind on` adds one SessionStart entry to Claude
  Code's `settings.json`. At each start, it shows you the comments of your team that wait for you in that folder's
  repositories, from `~/.sonah/team/waiting.json`, as a message for you, not as context for the agent. Claude Code
  keeps that message in its own recording of the session, as it keeps what any hook prints. When that list is a minute
  old or more, it asks again in the background: one `GET /api/fixes` a repository that the list already holds, at most
  once a minute each. `sonah remind off` removes the entry
  ([Privacy](docs/PRIVACY.md#sonah-team-the-claude-code-start-reminder)).
- **Nothing else leaves your computer.** Sonah has no telemetry and no analytics. What reaches Sonah Team goes only in
  the ways above: when you press one of the page's two buttons, when you run a team command, and, once you turn them on,
  at a push in a repository with the push hook and at a start of Claude Code with the reminder. Once a day at most, with
  a review's first call to the reviewer and in `sonah doctor`, Sonah asks npm's public registry for getsonah's latest
  version (one GET of `https://registry.npmjs.org/-/package/getsonah/dist-tags`) and tells you when a newer Sonah is
  out. That request holds no session text, path, setting or id: npm sees the request itself, from your IP address, as
  for any package download. Sonah never installs anything. Turn the check off with `sonah config update-check off` or
  `SONAH_NO_UPDATE_CHECK=1`; it is off when `CI` is set. Sonah calls GitHub's API only about a pull request you name
  with `--github`, and itself posts nothing to GitHub unless you ask and confirm; a Sonah Team server you run with a
  GitHub App (not https://pr.sonah.dev) comments on your open pull request on its own when your review reaches it
  ([Privacy](docs/PRIVACY.md#sharing)). The `git ls-remote` calls above go to the remote you push to, on GitHub or
  elsewhere. In a partial clone (`git clone --filter`), the git reads of the review of a push, `sonah share` and
  `sonah fix` may also make git fetch from your remote a commit your clone does not hold
  ([Privacy](docs/PRIVACY.md#what-leaves-your-computer)).
- **Sonah masks nothing.** The page and the .md show the session as the recording holds it, secrets included. Read the
  report before you share it.

If the reviewer's provider did not run the agent, the session goes to that provider for the first time.
[Privacy](docs/PRIVACY.md) says exactly what each request holds and what Sonah keeps under `~/.sonah`.

## Docs

- [Install and usage guide](docs/INSTALL.md), with the [known limits](docs/INSTALL.md#known-limits) of this beta
- [Privacy](docs/PRIVACY.md)
- [Troubleshooting and exit codes](docs/TROUBLESHOOTING.md)
- [Contributing](CONTRIBUTING.md) &nbsp;&bull;&nbsp; [Security](SECURITY.md)

## License

Sonah is open source under the [MIT License](LICENSE). Anyone can use it free of charge for any purpose, at work, in a
team of any size or in CI, and copy, change and share it, as long as copies keep its copyright and licence notice.

[LICENSE](LICENSE) has the exact terms. Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
