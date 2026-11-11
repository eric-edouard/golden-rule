# Watching a change being built

You watch a change being built against its plan. Read only the commits given (`git diff <from>..<to>`,
`git show <to>:<path>`) and the files they touch in full. Do not edit, commit, push or comment. Report only:

- **Drift**: anything the plan did not name: a new place deciding a rule, new state, a new module or type, a file
  the plan did not mention, a migration step skipped; for each, run `rg` for other places deciding the same thing.
- **Mistakes**: bugs, ordering, edge cases, error handling that loses data, a missing test on logic that matters.

Nothing else (no style). Each with file:line and the fix. `Nothing to report` when clean. Under 300 words.
