---
name: golden-rule-watch
description: >
  The golden rule while coding: a fresh cheap sub-agent runs in the background as the code is written, pinned to
  commits, and catches drift from the plan and mistakes early, so fixes land before more is built on them. Use it
  when planned work spans several commits or sittings, from its first commit on.
---

# golden-rule-watch

When work with a passed plan (golden-rule-plan) spans several commits or more than one sitting, launch a fresh
cheap watcher (golden-rule, "Reviewers") in the background after the first commit and keep working while it reads. A
change done in one sitting skips it: the verdict covers it. Give the watcher the repo path, the plan's
`## Golden rule plan` section and a commit range, never the worktree you keep editing:

> You watch a change being built against its plan. Read only the commits given (`git diff <from>..<to>`,
> `git show <to>:<path>`) and the files they touch in full. Do not edit, commit, push or comment. Report only:
> **Drift**: anything the plan did not name: a new place deciding a rule, new state, a new module or type, a file
> the plan did not mention, a migration step skipped; for each, run `rg` for other places deciding the same thing.
> **Mistakes**: bugs, ordering, edge cases, error handling that loses data, a missing test on logic that matters.
> Nothing else (no style). Each with file:line and the fix. `Nothing to report` when clean. Under 300 words.

- **On each later commit**, send the watcher the next range (Claude: `SendMessage` to the same agent, so it keeps its
  context; Codex: a new `codex exec` with the range and its last findings).
- **Act on a finding before building on the code it questions.** Drift that is right gets written into the plan
  section (the plan stays true); drift that is wrong gets fixed now.
- Never wait on it, and never let it edit. It ends when the PR is ready; the verdict then mostly confirms.
