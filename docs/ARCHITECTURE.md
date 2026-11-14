# Architecture

This is the map for contributors: what happens between `sonah review` and the page, which file does each step, which
steps are deterministic and which ask a model, and where state is kept. `sonah visual`, the page of a branch's change,
has [its own section](#the-page-of-a-change-sonah-visual). [CONTRIBUTING.md](../CONTRIBUTING.md) has the
rules a change must keep.

One idea runs through all of it: **the model proposes, code decides what is shown.** The reviewer model reads the
session and proposes what was asked, claimed and decided, each with quotes. Code then checks every quote word for word
against the recording, has independent checking passes test each proposal (three for each claim; one for a decision or
an ask by default, three with `--profile standard`), derives every status and column from recorded structure, and
keeps anything it cannot settle as not checked. Nothing the model says about its own
confidence or severity is used, with two exceptions: the code review's high, medium or low proposal, which code keeps
inside each kind's floor and ceiling, and `sonah visual`, whose page shows the tier the model proposes for each point
(must act, must know, good to know) once code checks that it is one of the three.

## The packages

Each package is a folder of ES modules that import each other by relative path; none is published on its own.

| Package | What it holds | Deterministic |
| --- | --- | --- |
| `packages/cli` | The `sonah` command: finds and loads recordings, reads the repository for the code step, calls the reviewer and its agents, stores answers, writes the page, the opt-in PR comment, `sonah doctor`, `sonah decision`, `sonah visual` | No: the only package that finds your recordings, and with `visual` the only ones that run git or start a model |
| `packages/slicer` | Reads Claude Code, Codex and Cursor recording files, as `cli` points it to them, into a ledger of typed events | Yes: the same file gives the same ledger |
| `packages/redact` | Bounds and validates the ledger and computes its hash (the session's identity); it masks nothing | Yes |
| `packages/evidence` | The review engine: the canonical session, the parts it is reviewed in, the prompts, grounding, the checking passes, the code step and the report | Code only: the model call and the repository reader are passed in, and it makes no network call and starts no process of its own |
| `packages/render` | The report model, and the HTML page and the Markdown report that render it, from a session, a finished report and the repository facts the CLI passes in | Yes |
| `packages/github` | The PR comment: one metadata read and a confirmed, count-only post; and, for `sonah sessions --github`, a pull request's metadata and commit list, read only | No: it talks to GitHub |
| `packages/golden` | A builder of synthetic Claude Code recordings, for tests | Yes |
| `packages/visual` | The page of a branch's change for `sonah visual`: reads the range with git (and parses the changed files with its vendored tree-sitter grammars), asks the model through the `claude` CLI, checks each answer, lays out the How and Where graphs (vendored elkjs) and renders the page | No: it runs git and starts `claude` |

Imports point one way: `cli` uses `evidence`, `slicer`, `redact`, `render`, `github` and `visual`; `render` and `github`
use `evidence`; `slicer` uses `redact`; `evidence`, `redact` and `visual` use no other package. "Deterministic" means no
network, no model, no clock, no random source and no child process: the same input gives the same bytes out. Continuous
integration checks this for `slicer`, `redact` and `render`.

## The pipeline, step by step

`packages/cli/src/session-review-command.js` runs these steps for `sonah review`.

1. **Find the recording.** `cli/src/session-discovery.js` lists the parent sessions whose recorded working folder is
   this repository, newest first (`sonah sessions`); `cli/src/claude-home.js` resolves Claude Code's projects folder.
2. **Read it, with its helpers.** `cli/src/recorded-session.js` loads one session in a fixed order.
   `cli/src/session-evidence.js` reads the recording and the helper (sub-agent) recordings linked to it, through
   `cli/src/recording-read.js`, `recording-inventory.js` and `workflow-agents.js`. The slicer turns each file into a
   ledger: `slicer/index.js` (`sliceLineage`), `slicer/src/records.js` (lines to records), `events.js` (Claude Code
   tool calls and results to events), `codex.js` (Codex), `cursor.js` (Cursor), and `child-links.js` (which helper
   recording belongs to which hand-off). Events are labelled by the recording's structure (who wrote them: you, the
   harness, the agent, a tool), never by their wording (`slicer/src/labels.js`). Nothing is withheld for privacy: every
   output, edit and earlier state of a file is kept as recorded, whatever file it is of.
3. **Bound, validate and hash.** `redact/index.js`: `redact` bounds an attached file to its head and tail and rebuilds
   the recorder's typed facts from their closed lists, then `sliceHash` names the session in stored answers and on the
   page. Nothing is masked: the reviewer reads the session as recorded.
4. **Build the canonical session.** `evidence/adapters/sonah-ledger.js` (`sessionFromLedger`) turns the ledger into
   the `Session` of `evidence/src/session.js`: events in recorded order, each with its text kept whole as recorded,
   so a quote can be checked against it.
5. **Plan the parts.** `evidence/src/windows.js` cuts the session into parts (called windows in the code);
   `evidence/src/run-review.js` (`planWindowRequests`) plans each part's request, and `evidence/src/images.js` decides
   which pasted images a request carries. A part too large for one request is never cut down: it is declared not
   reviewed.
6. **Ask the model.** `evidence/src/prompt.js` builds each part's prompt from the session's exact text, and
   `evidence/src/review-agent.js` holds the reviewer's brief. When the answer asks for more lines of a tool result or of
   a file before an edit, `evidence/src/evidence-requests.js` serves them in one more request. Every call itself is made
   in `cli/src/review-judge.js`, the only place a review calls a model: it starts the `claude` or Codex CLI or calls the
   Anthropic API, and for the code step starts Claude Code as an agent with read-only tools (the agent transport).
   `cli/src/codex-model.js` only finds the Codex executable and builds its arguments. `cli/src/answer-cache.js` stores
   each answer and reuses it only for the same request bytes, backend and model (and, for an agent, the same state of
   the repository); `cli/src/session-review.js` records finished parts, so a stopped review resumes.
7. **Ground every quote.** `evidence/src/ledger.js` takes the model's proposals and keeps only what code can ground:
   `evidence/src/session.js` (`verifyReceipt`) checks each quote by string search in the exact event it cites, and
   `evidence/src/receipt-repair.js` may propose one near-miss repair (a straightened quote mark, say) that must then
   be found word for word too. Statuses and columns are derived here from the grounded structure, never taken from the
   model.
8. **Check each proposal.** `evidence/src/challenge.js` runs independent checking passes over each part's proposals;
   each pass sees the evidence but never another pass's votes. `review-profiles.js` says how items are checked: by
   default a claim, its support and resolution, and an edit against your instructions get three passes, and every
   other item one pass on the evidence it cites; `--profile standard` gives every item three passes on the whole part.
   `claims.js`, `forbidden.js` (edits against your instructions) and `written.js` (statements the agent wrote into
   files) shape their kinds of item.
9. **Build the checklist.** `evidence/src/checklist.js` applies the structural checks every checklist row gets, and
   `run-review.js` (`runReview`) assembles the report: what you asked, what the agent claimed and decided, the failures
   it passed over, and what could not be checked, with a closed reason for each.
10. **Render.** `render/report-model.js` builds the report once. The report holds a header, a count line, your prompt
    with each ask marked, and the items in their sections (Must act, Must know, Good to know). Then it holds what the
    agent did and what Sonah could not check. The report places each row once: as an item, inside an item, in your
    prompt or in a list. `evidence/src/triage.js` gives each item kind its section, and keeps the code review's proposed
    level inside the bounds of the kind. `render/session-page.js` renders the report model as the HTML page.
    `render/session-story.js` renders it as the Markdown report. Both read their fixed words from
    `render/report-words.js`, and `evidence/src/code-report.js` holds what every reader reads of the code review. Sonah
    escapes each text for where it goes. Sonah masks nothing: the page and the .md show the session as the recording
    holds it. Before Sonah renders the report, `cli/src/repo-links.js` reads the facts for code links from local git.
    These facts are the remote, HEAD, the files that HEAD holds as reviewed, and whether a remote branch holds a
    commit. It runs only git commands from a fixed, read-only list. `cli/src/report-output.js` prints the count line and the `gh pr comment` command.
11. **Share, only if asked.** `cli/src/pr-sharing.js`, `github/publication.js` and `github/client.js` read the pull
    request's metadata and post the count-only comment and its neutral check after your confirmation.

The code step, on by default with the `claude-cli` backend, runs after step 9 on the session's report.
`cli/src/code-snapshot.js` reads, before any call, the change the session made (git's list and patches from the
session's start commit, or the recorded edits with no git history) and the state of each repository it reads (a hash
of every file git lists), and gives evidence a repository reader (any file of those repositories, now or at their start
commit). A path that differs is part of the change by the first that holds (`placedByOf`, `CODE_PLACED_BY`): a recorded
write could have changed it; it is in a commit whose first line a recorded action holds by that commit's time; or it
last changed in the recording's window, outside a wait, and was not committed when the session's recorded work ended
(`recordedWorkEnd`: its newest row the slicer labels thought, action or observation, never a row the recorder wrote
after it, and the human's newest only where the agent has none). Every other path
is outside the evaluated session. `--code-base` names the base as a merge base, and then git's list is the change.
`evidence/src/code-context.js` lays out the change and the session dossier. `evidence/src/code-pass.js` sends the
review agent's request, checks each item it answers by shape and grounds every quote by string search through the
reader, sends one repair for what fails, then one checking agent per finding and one for its questions, and decides
each outcome; `evidence/src/ask-code-links.js` joins what it tied to each of your asks beside the
ask's status. `cli/src/session-review.js` runs it and takes the repository's state again afterwards. `sonah config`
(`cli/src/settings.js`) keeps whether it runs, and `--code-pass` or `--no-code-pass` decides it for one review.

`sonah decision` (`cli/src/decision-command.js`, `decision-reviews.js`) records your answer to a row; `sonah doctor`
is `cli/src/doctor.js`; `sonah slice` (`cli/index.js`) prints the ledger of steps 2 and 3 for debugging, as a review
reads it.

## The page of a change (`sonah visual`)

`cli/src/visual-command.js` runs `sonah visual`. It reads the range with local git only (`code-snapshot.js` `runGit`,
which reaches no network): each side named by the person, or with no range the merge base of `HEAD` and the remote's
`HEAD` as local git has it (the remote chosen by `repo-links.js` `remoteOf`). It then hands the two commits to
`visual/src/job.mjs` (`runJob`), which writes everything into one folder:

1. **Extract.** `visual/src/extract.mjs` reads the change with git (with every setting that would change git's output
   pinned) and `parse-pr.mjs`, `parse-tree.mjs` and `parse-calls.mjs` find the changed functions, their calls and
   callers. The grammars are vendored WebAssembly, kept as gzip then hex text and decoded when they load.
2. **Ask.** `visual/src/requests.mjs` builds three kinds of request (the functions, the story, the findings) and writes
   each to `requests/` before it is asked; `answers.mjs` stores each answer under its request's id and asks only what is
   missing (`--replay-only` asks nothing). `transport-claude.mjs` is the one place it calls a model: `claude -p` in an
   empty temporary folder, with its tools off. The command gives it the person's environment without an API key, so a
   call runs on the person's Claude Code login, as the review's do.
3. **Check.** `visual/src/checks.mjs` keeps only what code can check: ids that name a shown function, quotes found word
   for word in the diff, the limits of each field, and a tier that is one of the three. What it drops gets a reason from
   `visual/src/reasons.mjs`.
4. **Lay out and render.** `layout.mjs` and `graph-how.mjs`, `graph-where.mjs` and `graph-elk.mjs` place the graphs;
   `render.mjs` writes `page.html` with its CSS and script inline. The command passes no share address, so the page
   holds no "Save online" or "Invite your team" button and no upload, and it makes no request when it is opened.

`visual-command.js` `drawVisualPage` runs these steps for `sonah visual`, plain `sonah` and the graphs page of `sonah
review --format html` (D219), and for the review of a push (D227). It holds the folder's lock while it draws
(`cli/src/visual-lock.js`, D226): `draw.lock` in the folder names the drawing process and its start time, so a second
drawer stops with `folder_in_use`, and a lock whose process is gone is taken back. The transport takes two stops from
outside: a signal (Ctrl-C or SIGTERM) and a deadline, which ends a call still running when it passes; with a deadline,
each `claude` leads a process group of its own (not on Windows), so the stop ends what it started too.

## The connection to Sonah Team (`sonah connect`)

`cli/src/connect-command.js` runs `sonah connect`, `sonah disconnect` and `sonah status` (D224), the first of the
commands for Sonah Team, the hosted team version. `cli/src/team-api.js` makes their calls to that server with Node's
fetch: the device code's exchange and the token's own route (`GET` and `DELETE /api/token`), with the token only in
the `Authorization` header and no redirect followed. `cli/src/team-home.js` keeps the one connection in
`team/connection.json` under Sonah's folder (mode `0600`, written whole), the only file that holds the token. No model
is called, and nothing of a session or a repository is read or sent.

`cli/src/push-hook.js` runs `sonah hook add --push` and `sonah hook remove --push` (D225): it writes a script into the
git common dir, `sonah/pre-push.sh`, that names this install's node and `sonah.js`, and the hook `pre-push` that sources
it by D143's rules (only where git runs no other hook; otherwise it prints the line to add), and lists the repository
in `team/hooks.json`. At each push the script hands the refs to the hidden `sonah pre-push` (`cli/src/push-hook-run.js`,
dispatched before anything else, with a crash handler that always exits 0): it leaves one ticket per pushed branch, at
most 3, in `team/queue/` (`cli/src/push-queue.js`), records each as `waiting` in `team/runs.json`, starts the
repository's runner when none is going, and makes no network or model call. Everything it loads at a push is Node's own
modules and the light team modules — `push-queue.js`, `team-home.js`, `team-git.js`, `settings.js`,
`visual-lock.js`, `visual-server.js`, `fix-prompt.mjs`, `strict-json.js` and `push-run-states.js` — since Node
evaluates a module's whole static import closure before the entry runs; that closure is named module by module in
`cli/test/d225-push-hook.test.js`, which fails on any change to it. `cli/src/team-git.js` holds the git calls
of the team commands. `sonah status` and `sonah doctor` read each listed repository's hook from its files
(`pushHookReport`).

The runner is the hidden `sonah push-run --repo DIR` (`cli/src/push-run.js`, D227), started detached, in a process group
of its own, at low priority, with its own crash handler that always exits 0. It takes the repository's tickets in turn
(one runner a repository: `runner.lock` in its queue folder), and for each: waits until the remote shows the commit,
probes the server with `GET /api/fixes` (a 401 to the token the connection holds marks it refused and ends the pass, and
nothing more is sent; the answer's waiting comments go to `team/waiting.json`, `cli/src/fix-waiting.js`), finds the base
on the remote's default branch, draws with `drawVisualPage` (the full model id, no API key, `visualOutDir`'s folder, the
ticket's deadline and a signal that SIGTERM aborts) while it holds the laptop's one job slot (`team/locks/job.lock`),
then reads the folder under its lock, draws the page anew in mode `hosted`, adds the upload's `sessions`
(`cli/src/upload-sessions.js`, from the range's `Agent-Session` lines) and sends it to `POST /api/uploads` with the
token the connection holds then. Before each step that spends or sends, and at each poll while it draws, it reads
`team/hooks.json` and the connection again: once the repository's push hook is off or the connection ended, the run
ends, its drawing stopped, and nothing more is sent. Each run's state and why (closed lists in
`evidence/src/push-run-states.js`, which `ledger.js` re-exports) go to `team/runs.json`, its steps to a log in
`team/logs/`. A backstop ends the process a
minute after a ticket's deadline. `sonah status` reads the runs and the waiting comments from these files.

`cli/src/fix-command.js` runs `sonah fixes` and `sonah fix` (D229), the laptop half of the fix loop. `sonah fixes`
makes one `GET /api/fixes` a repository — this clone's, as `shareTarget`'s push remote names it, else the one
repository each clone in `team/hooks.json` whose hook is for this connection's server names, a call a clone — checks
each entry by shape and keeps the list in `team/waiting.json`, which `sonah status` and the push hook's own line read
with no call. `sonah fix <comment id>`
reads one comment with `GET /api/fixes/<id>`, checks every field by shape (`checkFix`), finds the worktree of the
clone that has the review's branch checked out (it never switches a branch), and picks the session the prompt goes to:
the one that the range's `Agent-Session` lines name and that touched a file of the item, forked only when one plain
recording of it is here and D143 shows the commit in it
(`pickSession`, through `commit-sessions.js` and `session-id.js`). It builds the prompt with
`visual/src/fix-prompt.mjs`, the module the server's own panel builds it with, shows it whole and asks; only after a
yes does it run `claude` by spawn, with the prompt as one argument, in that folder and on this terminal. Each launch
goes to `team/fixes/<comment id>.json` (`cli/src/fix-launches.js`), with the prompt as it was sent; the push run and
`sonah share` read the newest of those records for the upload's `answers`, which is what lets the server mark a fix
pushed. Nothing of the server's answer becomes a command, a path, a flag or an environment value, and Claude Code's
own exit code is not passed through.

`cli/src/remind.js` runs `sonah remind on|off` (D230): one SessionStart entry in Claude Code's `settings.json`, its
command `'<node>' '<sonah.js>' remind-hook # sonah:remind`, and nothing else of that file changed (a file that is not
plain JSON is left as it is). Claude Code runs the entry at each start; `cli/src/remind-hook.js` reads the connection,
one `git remote -v` of the folder and `team/waiting.json` with no call, and prints the comments that wait as one
`systemMessage`, a message Claude Code shows the person, and never as `additionalContext`, the field that adds context
for the agent. When a repository's list is a minute old,
it starts the hidden `sonah remind-refresh` detached, which asks `GET /api/fixes` again for the folder's repositories
the cache already holds, each at most once a minute (`team/locks/remind.json`). The hook's import closure is held to
the push hook's rule: Node's own modules and the team files' readers, never the review's.

## Where the model can and cannot reach

The reviewer gets text (and pasted images) and returns text; it cannot act. The `claude` reviewer runs in an empty
private folder with its tools, MCP servers, settings and slash commands switched off, a minimal environment, and the
request on standard input; `sonah visual`'s `claude` calls run the same way. The code step's agents are the one
exception, and only on `claude-cli`: they run in the working directory with three read-only tools (Read, Grep and Glob)
in Claude Code's restricted mode, which confines them to the working directory, the repository it lies in, each other
git repository that holds a file of the change (its top folder) and, when the change is reviewed in parts, Sonah's copy
of the changed files as they were at the start commit; a call that uses any other tool fails. The Codex reviewer runs
read-only with its tools and web search off. Nothing in `evidence` calls a model or reads the disk by itself:
`runReview` and the code step are given a function that answers a request (and the code step a repository reader), which
is how the tests run the whole pipeline with stand-in reviewers and agents.

## Where state lives

| What | Where |
| --- | --- |
| Recordings | Where the agent keeps them (`~/.claude/projects/`, `~/.codex/sessions/`); only read |
| Stored model answers | `~/.sonah/session-reviews/<SHA-256 of the recording's path>/answers/`; the code step's in `code-pass/answers/` beside it |
| Finished parts, progress and the report | `~/.sonah/session-reviews/<same>/review/` (`report.private.json`; `publication/` after a PR comment) |
| Your answers to rows | `~/.sonah/decision-reviews.ndjsonl` |
| Your settings (`sonah config`) | `~/.sonah/config.json`; the update check's, once set, `~/.sonah/update-check-setting.json` |
| The update check's last answer | `~/.sonah/update-check.json` |
| The page and the .md | The `--output` file, and the .md beside the page |
| `sonah visual`'s page, requests, answers and run | `~/.sonah/visual/<repository folder>-<hash of its path>/<base>-<head>-<model>/` (or `--out DIR`) |
| The team commands' own files | `~/.sonah/team/`: `connection.json`, `hooks.json`, `refused.json`, `queue/`, `runs.json`, `waiting.json`, `logs/`, `locks/` and `fixes/<comment id>.json` |

`SONAH_HOME` moves `~/.sonah`, and `--state-dir` moves one review's folder. Every file is written readable by its
owner only (folders `0700`, files `0600`); `sonah visual` makes its folders `0700` and writes its files with the
person's usual permissions inside them. The answers, the report and the page quote the session as recorded; the
answers and the report never leave the computer.

## Closed vocabularies and versions

- Reasons (why something was not checked, withheld or failed) are fixed lists in code, never built in a prompt: most
  in `evidence/src/ledger.js`, the slicer's in `slicer/index.js` and `slicer/src/labels.js`, the recorder's typed facts
  in `redact/index.js`. A quote that a checklist row cites goes through one ordered list of grounding tests
  (`GROUNDING_CAUSES` in `ledger.js`); a refused quote keeps its row's reason and names the first test that failed,
  and the reader's words come from that test and say only what it read. The visual review's reasons for what its
  checks drop are in `visual/src/reasons.mjs`.
- Every schema, prompt and rendered format carries a version string, `sonah.<name>/<n>`. A change to the bytes it
  names bumps it. The visual review is the exception: its `facts.json`, `run.json` and answer records carry `v: 1`,
  and its other files and its prompts carry no version; a changed prompt gets a new request id, so its stored answers
  are not reused.
- Every digest goes through one canonical serialization, `evidence/contracts/canonical.js`.

## The large files

| File | Role |
| --- | --- |
| `evidence/src/ledger.js` | Grounding, the closed vocabularies and the derivation of every status |
| `evidence/adapters/sonah-ledger.js` | The slicer's ledger to the canonical session |
| `evidence/src/run-review.js` | Planning the requests, running the parts and the checking passes, assembling the report |
| `evidence/src/code-pass.js` | The code step: the review agent's request, grounding and scope, the checking agents, the outcomes |
| `cli/src/review-judge.js` | Every model call: the `claude` and Codex CLIs, the Anthropic API, and the agent transport |
| `slicer/src/events.js` | Claude Code tool calls and results to events |
| `render/report-model.js` | The report model: the items, their sections and order, the placement of every row |
| `render/session-story.js`, `render/session-page.js` | The Markdown report and the HTML page |
| `evidence/src/review.js` | Row kinds and counting, shared by the report and the PR comment |

`evidence/src/code-review.js` and `code-review-prompt.js` belong to a pull-request review route that was removed from
the command. The command never reaches them; they stay only because tests of shared logic still use them, and they are
due to be removed. The Markdown review that route printed (`renderReview`) is removed.

## Tests

`npm test` runs `node --test packages/*/test/*.test.js`. No test calls a model or the network: the review tests use
stand-in reviewers and synthetic sessions (`corpus/golden/`, `packages/golden/src/build.js`); the visual review's
tests use a stand-in `claude` (`packages/visual/test/fake-claude.mjs`). Some tests pin exact
bytes: the requests sent to the model and their run-profile digests (the `*-baseline` tests in `packages/cli/test`),
and the rendered page and .md (`packages/render/test/snapshots/`). A style linter (`packages/render/test/style-lint.js`)
checks Sonah's fixed sentences: at most 20 words a sentence, the active voice, no semicolon, one term for one thing. Continuous integration
(`.github/workflows/ci.yml`) runs the suite on Linux and macOS under Node 20, 22 and 24, once under a Czech locale and
once with another home folder, and checks that the deterministic packages import no model and use no clock, random
source, network call or child process.

## Scripts

- `scripts/install.mjs`: the one-command install into `~/.local` (or `--prefix`).
- `scripts/package-source.mjs`: builds the npm package file (`getsonah-<version>.tgz`) from the reviewed list in
  `package.json` `files`.
- `scripts/session-review.mjs`: an older way to run a review that prints a JSON summary only; some tests still use it.
  It is not part of the installed command.
