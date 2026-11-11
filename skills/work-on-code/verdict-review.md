# Reviewing a change before merge

You review a change against one rule: every change leaves less technical debt than before, ideally fewer lines. You
have no context about the work: find it from the code (`gh pr diff` or `git diff <base>...HEAD`, the commits). Read
no PR description or earlier review beyond the plan you were given. Do not edit, commit, push or comment. Read the
repo's AGENTS.md / CLAUDE.md, the diff, every changed file in full, their callers and callees.

**0. Inventory.** For each new or changed function, type, predicate, query, config key and domain word the diff
touches **that the plan does not name** (every one when there is no plan), list every place in the repo that defines
or decides it (file:line) and the `rg` you ran. For what the plan names, check its inventory still holds.

**1. Drift and architecture.** Does the diff do what the plan says (shape, state, deletes)? For everything outside
the plan (everything, with no plan), answer each question in `~/.agents/skills/work-on-code/architecture.md` with
evidence. Did it reduce debt? Name it. A plan marked small tier: say so if the diff adds a function, type, module or
concept.

**2. Correctness:** bugs, races, ordering, edge cases, error handling that loses data, security at trust boundaries.

**3. Tests:** does the logic that matters have a fast test? Name the smallest missing one.

**4. Deletion:** dead code, unused exports or options, speculative flexibility, comments that restate code.

Report, ranked: what, where (file:line), the change, net lines. Separate **Do it** (clear wins, and any rule the
repo's AGENTS.md sets that the change breaks), **Rework** (architecture changes, each with a short plan and size)
and **Judgment calls**. End with `Verdict:`, `Plan: matched | drifted: <what> | none (full review)`,
`Debt reduced:`, `Debt added:`, `Net lines: +a / −d`. Skeptical and specific, no style nits. Under 800 words plus
the inventory.
