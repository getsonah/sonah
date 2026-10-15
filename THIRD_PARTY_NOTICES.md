# Third-party notices

Sonah is licensed under the Business Source License 1.1 (see LICENSE). The components listed below contain material
copied or adapted from third-party projects under their own licenses.

## entireio/cli (MIT)

Source: https://github.com/entireio/cli — read from a local checkout of the MIT-licensed source.

Material copied near-verbatim or closely transcribed into sonah (each site carries a citation
comment naming the upstream file and approximate lines):

- `packages/redact/index.js`
  - Region collect/sort/merge/replace mechanism — `redact/redact.go` (`applyRegions`, ~264-302).
  - JSON-escape-boundary repair (a match beginning at the letter of a literal `\n`/`\t`/… escape
    is advanced past it, never allowed to consume it) — `redact/redact.go` ~193-205.
  - Supabase provider token regexes `sb_secret_[A-Za-z0-9_-]{20,}` and `sbp_[a-z0-9_-]{20,}`,
    including the no-word-boundary-anchor rationale and the publishable-key exclusion —
    `redact/providers.go`.
  - Credentialed-URI regex (`credentialedURIPattern`) — `redact/redact.go` ~30.
  - DB-password key shape (`dbPasswordKeyShape`), JDBC / database-URL / keyword-DSN /
    semicolon-connection-string regexes and their host/user/server/password gate regexes —
    `redact/redact.go` ~36-56 (key quantifiers capped at {0,63} here because JS regexes
    backtrack where Go's RE2 is linear).
  - Connection-string end trimming (`trimConnectionStringEnd`) and quote stripping
    (`unquoteRange`) — `redact/redact.go` ~329-339, ~396-405.
  - Placeholder rules: the placeholder value list, bracketed-`<name>` shape, `${…}` expansion
    shape, repeated-character mask rule, and the exact-match-only rule that forbids splitting a
    greedy finding at a placeholder head — `redact/redact.go` ~73-86, ~219-234, ~423-477.
  - Database-URL query-password gate (`hasDatabaseURLSecret`) — `redact/redact.go` ~348-368.
- `packages/redact/test/redact.test.js`
  - Adversarial test vectors adapted from `redact/redact_test.go` (Supabase provider-token
    cases including the fragment-assembled fixture style, credentialed-URI cases,
    connection-string cases, bounded-credential-value and over-redaction-guard cases,
    placeholder fall-through and placeholder-split cases, JSON-escape-sequence cases,
    idempotency cases, and the entropy-floor probe values). Divergences from upstream expected
    behaviour are deliberate and documented inline in the tests.
- `packages/slicer/src/cursor.js`
  - IDE-tag / timestamp-prefix / user-query-tag stripping (`stripCursorTags`) — ported from
    `cmd/entire/cli/textutil/ide_tags.go`.
  - Cursor project-directory sanitisation (`sanitizePathForCursor`) — transcribed from
    `cmd/entire/cli/agent/cursor/cursor.go` `sanitizePathForCursor`.
- `packages/slicer/test/cursor.test.js`
  - Cursor transcript shapes transcribed from Entire's captured session
    `cmd/entire/cli/agent/cursor/testdata/real_session_tool_use.jsonl`.

License text for the copied material:

```
MIT License

Copyright (c) 2026 Entire Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## pullfrog/pullfrog (MIT)

Source: https://github.com/pullfrog/pullfrog, pinned at
`e354ba26ce66bb317aa30ec13e4bdff962373474` (version 0.1.81, 16 September 2026).

The review craft in `packages/evidence/src/review-agent.js` is adapted from Pullfrog's
Review mode. Sonah replaces its output contract and combines that craft with session evidence.

The code step of `sonah review --code-pass` (`sonah.code-pass/2`) adapts, each site carrying the
notice "Portions adapted from Pullfrog (pullfrog/pullfrog), MIT, Copyright (c) 2026 Pullfrog, Inc.":

- `packages/evidence/src/code-context.js` — the table of contents with line ranges and the
  `| OLD | NEW | TYPE | code` row format (`mcp/checkout.ts` `formatFilesWithLineNumbers`).
- `packages/evidence/src/code-pass.js` — the Review mode's reading order and coverage checklist, its
  scope rule (the root cause in lines the change added or modified), its drop list, the "a test that
  would still pass with the bug present is theatre, not coverage" lens, independent lenses and the
  open questions for the human (`modes.ts` Review), in Sonah's own closed contract.
The distribution includes the following complete license verbatim from the pinned upstream
`LICENSE`; the runtime does not depend on an operator's separate Pullfrog checkout.

```
MIT License

Copyright (c) 2026 Pullfrog, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## qodo-ai/pr-agent (MIT)

Source: https://github.com/qodo-ai/pr-agent, pinned at `330f0813b5fe0d1f54b794077c2d02aa85a1fb63`
(11 October 2026). Only material from its MIT-licensed history is used.

Material adapted, each site carrying the notice "Portions adapted from PR-Agent (qodo-ai/pr-agent),
MIT, Copyright (c) 2026 The PR Agent":

- `packages/evidence/src/code-context.js` — the extra hunk context (five lines before, one after) and
  the dynamic context that widens a hunk to git's section header when the old and new lines before it
  match, at most ten lines back (`pr_agent/algo/git_patch_processing.py` `extend_patch`); listing by
  name what does not fit a request (`pr_agent/algo/pr_processing.py`).
- `packages/evidence/src/code-pass.js` — the ask sorted into done, not done or needing a human
  (`pr_agent/settings/pr_reviewer_prompts.toml` ticket compliance) and the merge of file groups as a
  union (`pr_agent/algo/review_merge.py`); the coverage footer naming what was not reviewed
  (`pr_agent/tools/pr_reviewer.py`).

```
MIT License

Copyright (c) 2026 The PR Agent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ReviewBench (MIT)

Source: the ReviewBench repository, read from a local checkout at
`c17b05be9c90b85a1fc012ce39e455e2d09a7255`. No code is copied: its false-positive classes
(`docs/METHODOLOGY.md`: incorrect, unverifiable, out of scope, duplicate, an existing mitigation
overlooked) are adapted as the closed refutation reasons of the code step's checking passes
(`packages/evidence/src/ledger.js` `CODE_REFUTATION_REASONS`).

```
MIT License

Copyright (c) 2026 review-bench

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
