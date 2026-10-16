# Contributing

Thank you for helping. Sonah exists so a person can judge an agent's work without reading every line of it. A change is
welcome when it helps with that and keeps Sonah portable, reproducible and safe. For anything larger than a small fix,
open an issue first so we can agree on the approach. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the map of the
code.

## Run the tests

You need Node.js 20 or newer. There is nothing to install:

```sh
npm test                                          # the whole suite
node --test packages/redact/test/*.test.js        # one package
node --test packages/cli/test/install.test.js     # one file
```

The full suite must pass before a pull request is opened, and continuous integration runs it on Linux and macOS. It
has about 3,900 tests, run in parallel: several minutes on a recent laptop, more on a busy machine.

- No test calls a model or needs a login: the review tests use stand-in reviewers and synthetic sessions. Keep it that
  way.
- A passing run still lists about ten tests under `✖ failing tests:`, with their stack traces. They are `todo` tests:
  each records a known, accepted limit, given after `#` on its line, and the summary counts them under `todo`. What
  counts is `fail 0` in the summary.
- The timing tests under `packages/slicer` check that reading a recording stays linear on very large input. On a
  heavily loaded machine one can fail; run that file again on its own.

## Rules a change must keep

- **No runtime dependencies.** Node's standard library only, in every package. Never add a package.
- **The deterministic packages stay deterministic.** `packages/slicer`, `packages/redact` and `packages/render` make
  no network calls, no model calls, no clock or random reads and start no process: the same input gives the same bytes
  out. Continuous integration checks this.
- **No judgment in code.** Code checks structure, provenance and verbatim evidence: the order of events, who acted,
  which file, whether a quote is literally there. What a statement means (is it a claim, is it a decision, does it
  matter) is decided by the model and then tested by the checking passes. No keyword lists, phrase patterns or
  per-case exceptions for meaning: a change must hold across sessions, harnesses, languages and phrasings.
- **Every quote is checked by code.** A quote the review shows must be found word for word in the recording, by string
  search. Never trust the model's word for what a session said.
- **The model never rates itself.** No confidence or severity is accepted from a model; anything like it is computed by
  code after the model returns.
- **Reasons are a closed vocabulary.** The codes for why something was not checked, withheld or failed are fixed lists
  in code (most in `packages/evidence/src/ledger.js`). Never build one in a prompt or inline.
- **Doubt shows as not checked.** When the evidence does not settle a row, it is kept and shown as not checked, never
  as a stronger status.
- **Nothing is hidden for privacy's sake.** The reviewer and the person see the session and the code as recorded:
  Sonah masks no secret and withholds no file for privacy, and a change must not add such a rule. Keep the
  repository itself free of real recordings and live secrets (below).
- **Never attach real session recordings.** Not to an issue, a pull request or a test: recordings can hold credentials.
  Tests use synthetic sessions only: the recordings in `corpus/golden/`, or one you build with
  `packages/golden/src/build.js`.

## Changes to what the review says

Tests pin the exact bytes of the requests Sonah sends to the model, and of the page and the Markdown story it renders
(`packages/render/test/snapshots/`). A change to a prompt, a brief or the page moves those pins on purpose: update the
pinned values in the same change, bump the version the changed text carries (its `sonah.<name>/<n>` string), and say
why in the pull request.

The maintainers check a change that alters what the review says before it is merged.

A new source file the installed command needs must be listed in `files` in `package.json`; the install test fails
otherwise.

## Reading the code

Comments and test names often cite a short id (a letter and a number). It points to the maintainers' own design
records. The sentence around each id states the rule; the id only says
where it was decided.

## Pull requests

Use the pull request template. One change per pull request, with its tests, `npm test` green and a line in
`CHANGELOG.md` when users would notice it.

### Licensing of contributions

Sonah is licensed under the Business Source License 1.1 (see [LICENSE](LICENSE)), and its author, Abhinav Soni, also
sells commercial licences for it. So that your contribution can be part of both, by opening a pull request you agree
to the following for everything you submit in it:

1. **Copyright licence.** You grant Abhinav Soni, and his successors and assigns, a perpetual, worldwide,
   non-exclusive, no-charge, royalty-free, irrevocable licence to reproduce, prepare derivative works of, publicly
   display, publicly perform, sublicense and distribute your contribution and those derivative works, under any
   licence terms, including the Business Source License, the Apache License 2.0 that each version later becomes
   available under, and commercial licences.
2. **Patent licence.** You grant the same people, and everyone who receives Sonah from them, a perpetual, worldwide,
   non-exclusive, no-charge, royalty-free, irrevocable patent licence to make, use, sell, offer for sale, import and
   otherwise transfer your contribution, alone or combined with Sonah, for any patent claims you can license that it
   would otherwise infringe.
3. **You keep your copyright.** This is a licence, not an assignment, and you may use your own contribution in any
   way you like.
4. **You have the right to submit it.** You certify that the contribution is your original work, or that you have the
   right to submit it under these terms, and that, if your employer or a client has rights in it, you have their
   permission to make this grant. Record this by signing off each commit with `git commit -s`, which adds a
   `Signed-off-by: Your Name <you@example.com>` line under your real name.
5. **No other promises.** Your contribution is provided as is, without warranties of any kind, and nobody is obliged
   to merge or use it.

A pull request whose commits are not signed off is not merged. If you cannot agree to these terms, say so in an issue
before you open a pull request.

## Reporting

Questions, bugs and ideas go in an issue, using its template. Security problems never go in an issue: see
[SECURITY.md](SECURITY.md). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
