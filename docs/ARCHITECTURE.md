# Architecture

This is the map for contributors: what happens between `sonah review` and the page, which file does each step, which
steps are deterministic and which ask a model, and where state is kept. [CONTRIBUTING.md](../CONTRIBUTING.md) has the
rules a change must keep.

One idea runs through all of it: **the model proposes, code decides what is shown.** The reviewer model reads the
session and proposes what was asked, claimed and decided, each with quotes. Code then checks every quote word for word
against the recording, has independent checking passes test each proposal (three for each claim; one for a decision or
an ask by default, three with `--profile standard`), derives every status and column from recorded structure, and
keeps anything it cannot settle as not checked. Nothing the model says about its own
confidence or severity is used.

## The packages

Each package is a folder of ES modules that import each other by relative path; none is published on its own.

| Package | What it holds | Deterministic |
| --- | --- | --- |
| `packages/cli` | The `sonah` command: finds and loads recordings, reads the repository for the code step, calls the reviewer and its agents, stores answers, writes the page, the opt-in PR comment, `sonah doctor`, `sonah decision` | No: the only package that finds your recordings, runs git or starts the reviewer |
| `packages/slicer` | Reads Claude Code, Codex and Cursor recording files, as `cli` points it to them, into a ledger of typed events | Yes: the same file gives the same ledger |
| `packages/redact` | Bounds and validates the ledger and computes its hash (the session's identity); it masks nothing | Yes |
| `packages/evidence` | The review engine: the canonical session, the parts it is reviewed in, the prompts, grounding, the checking passes, the code step and the report | Code only: the model call and the repository reader are passed in, and it makes no network call and starts no process of its own |
| `packages/render` | The report model, and the HTML page and the Markdown report that render it, from a session, a finished report and the repository facts the CLI passes in | Yes |
| `packages/github` | The PR comment: one metadata read and a confirmed, count-only post | No: it talks to GitHub |
| `packages/golden` | A builder of synthetic Claude Code recordings, for tests | Yes |

Imports point one way: `cli` uses `evidence`, `slicer`, `redact`, `render` and `github`; `render` and `github` use
`evidence`; `slicer` uses `redact`; `evidence` and `redact` use no other package. "Deterministic" means no
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
   `evidence/src/review-agent.js` holds the reviewer's brief. When the answer asks for more lines of a tool result or
   of a file before an edit, `evidence/src/evidence-requests.js` serves them in one more request. Every call itself is
   made in `cli/src/review-judge.js`, the only place a model is called: it starts the `claude` or Codex CLI or calls
   the Anthropic API, and for the code step starts Claude Code as an agent with read-only tools (the agent transport).
   `cli/src/codex-model.js` only finds the Codex executable and builds its arguments. `cli/src/answer-cache.js` stores
   each answer and reuses it only for the same request bytes, backend and model (and, for an agent, the same state of
   the repository);
   `cli/src/session-review.js` records finished parts, so a stopped review resumes.
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
session's start commit, or the recorded edits with no git history) and the repository's state (a hash of every file
git lists), and gives evidence a repository reader (any file of the repository, now or at the start commit).
`evidence/src/code-context.js` lays out the change and the session dossier. `evidence/src/code-pass.js` sends the
review agent's request, checks each item it answers by shape and grounds every quote by string search through the
reader, sends one repair for what fails, then one checking agent per finding and one for its questions, and decides
each outcome; `evidence/src/ask-code-links.js` joins what it tied to each of your asks beside the
ask's status. `cli/src/session-review.js` runs it and takes the repository's state again afterwards. `sonah config`
(`cli/src/settings.js`) keeps whether it runs, and `--code-pass` or `--no-code-pass` decides it for one review.

`sonah decision` (`cli/src/decision-command.js`, `decision-reviews.js`) records your answer to a row; `sonah doctor`
is `cli/src/doctor.js`; `sonah slice` (`cli/index.js`) prints the ledger of steps 2 and 3 for debugging, as a review
reads it.

## Where the model can and cannot reach

The reviewer gets text (and pasted images) and returns text; it cannot act. The `claude` reviewer runs in an empty
private folder with its tools, MCP servers, settings and slash commands switched off, a minimal environment, and the
request on standard input. The code step's agents are the one exception, and only on `claude-cli`: they run in the
working directory with three read-only tools (Read, Grep and Glob) in Claude Code's restricted mode, which confines
them to the working directory and the repository it lies in; a call that uses any other tool fails. The Codex
reviewer runs read-only with its tools and web search off. Nothing in `evidence` calls a model or reads the disk by
itself: `runReview` and the code step are given a function that answers a request (and the code step a repository
reader), which is how the tests run the whole pipeline with stand-in reviewers and agents.

## Where state lives

| What | Where |
| --- | --- |
| Recordings | Where the agent keeps them (`~/.claude/projects/`, `~/.codex/sessions/`); only read |
| Stored model answers | `~/.sonah/session-reviews/<SHA-256 of the recording's path>/answers/`; the code step's in `code-pass/answers/` beside it |
| Finished parts, progress and the report | `~/.sonah/session-reviews/<same>/review/` (`report.private.json`; `publication/` after a PR comment) |
| Your answers to rows | `~/.sonah/decision-reviews.ndjsonl` |
| Your settings (`sonah config`) | `~/.sonah/config.json` |
| The page and the .md | The `--output` file, and the .md beside the page |

`SONAH_HOME` moves `~/.sonah`, and `--state-dir` moves one review's folder. Every file is written readable by its
owner only (folders `0700`, files `0600`). The answers, the report and the page quote the session as recorded; the
answers and the report never leave the computer.

## Closed vocabularies and versions

- Reasons (why something was not checked, withheld or failed) are fixed lists in code, never built in a prompt: most
  in `evidence/src/ledger.js`, the slicer's in `slicer/index.js` and `slicer/src/labels.js`, the recorder's typed facts
  in `redact/index.js`. A quote that a checklist row cites goes through one ordered list of grounding tests
  (`GROUNDING_CAUSES` in `ledger.js`); a refused quote keeps its row's reason and names the first test that failed,
  and the reader's words come from that test and say only what it read.
- Every schema, prompt and rendered format carries a version string, `sonah.<name>/<n>`. A change to the bytes it
  names bumps it.
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
stand-in reviewers and synthetic sessions (`corpus/golden/`, `packages/golden/src/build.js`). Some tests pin exact
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
