## What this changes, and why

<!-- One change per pull request. Link the issue it answers, if there is one. -->

## Checklist

- [ ] `npm test` passes (`fail 0`).
- [ ] Every commit is signed off (`git commit -s`), and I agree to the contribution terms in `CONTRIBUTING.md`.
- [ ] No dependency was added; Node's standard library only.
- [ ] `packages/slicer`, `packages/redact` and `packages/render` still make no network or model call and read no clock
      or random source.
- [ ] No real session recording, Sonah page, report or stored answer is attached or committed; tests use synthetic
      sessions only.
- [ ] No judgment was added to code: no keyword list or phrase pattern decides what a statement means.
- [ ] If this changes what the review sends to the model or what the page shows, the pinned values and the version
      string are updated, and the description says why.
- [ ] `CHANGELOG.md` has a line, if users would notice the change.
