---
name: golden-rule-verdict
description: >
  The golden rule's final review, required before any merge into a default branch: a fresh reviewer checks the diff
  against its golden-rule plan (drift, correctness, tests), or judges the architecture from zero when there was no
  plan, and its verdict goes into the PR, where the merge hook checks it. Replaces code-review and ponytail-review
  before a merge. Use it whenever work is ready to merge, for a "golden rule review", "debt review", "did we add
  debt", "does this need a rework", and before saying a task is done.
---

# golden-rule-verdict

1. **Bring the branch up to date and green.** `git fetch`, merge the default branch into the branch
   (`git merge origin/<default>`), run the project's check (`bun run check` or its equivalent), push. The merge result
   is what lands; a later update would change the head and stale the verdict.
2. **Fresh reviewer** (golden-rule, "Reviewers"), with the repo path, the PR or branch, and the worktree to read:
   - **Confirm**, by a cheap reviewer, when the PR description has a `## Golden rule plan` whose plan review
     passed: the prompt below, with that section pasted in. Architecture is reopened only where the diff left the plan.
   - **Full**, by a top reviewer, otherwise (no plan, a plan never reviewed, or a diff that is mostly not the plan): the prompt below,
     with "(no plan)" where the plan goes; the reviewer then answers every architecture question from zero.
3. **Act on the report.** **Do it**: fix on the branch. **Rework**: do it in this PR when it is the change's own
   foundation, or open it now as its own task or PR with a complete brief; say which, per item, never as a line of
   prose. **Kept on purpose**: only with a reason the user would accept.
4. **One confirming round, then stop.** A new fresh cheap reviewer gets the confirming prompt: the
   must-fix and kept-on-purpose items verbatim, and the fixes only (`git diff <sha the last round saw>..HEAD`). A
   full round again (step 2's mode and reviewer) only when a fix reshaped the change or the base was merged in. Whatever the confirming round
   still finds goes into the verdict as debt added, a rework or kept on purpose; no third round.
5. **Write the verdict into the PR description** (`gh pr edit --body-file`, or `gh api -X PATCH
   repos/{owner}/{repo}/pulls/{n} -F body=@file` when `gh pr edit` fails), replacing any earlier one, in its own
   command, not chained with the merge (the gate checks the PR before the command runs):

   ```
   ## Golden rule verdict
   Reviewed: <full sha of the PR's current head>
   Verdict: debt reduced | no debt added | debt added | rework needed
   Plan: matched | drifted: <what, and whether the plan was updated> | none (full review)
   Net lines: +<added> / −<deleted>
   Debt reduced: <what was unified or deleted, or "none">
   Debt added: <each item, or "none">
   Reworks: <each item with its task or PR link, or "none">
   Kept on purpose: <each item with its reason, or "none">
   ```

   "rework needed" cannot merge. "debt added" can, only when each item is a tracked rework or kept on purpose.
6. **Report to the user in this order:** the verdict, the reworks (as tasks or PRs ready to start), the net lines,
   and only then the merge: merge it yourself when the verdict passes, unless the user's or the repo's rules ask for
   their OK first; then ask.

## The reviewer's prompt

> You review a change for the user's golden rule: every change leaves less technical debt than before, ideally fewer
> lines. You have no context about the work: find it from the code (`gh pr diff` or `git diff <base>...HEAD`, the
> commits). Read no PR description or earlier review beyond the plan below. Do not edit, commit, push or comment.
> Read the repo's AGENTS.md / CLAUDE.md, the diff, every changed file in full, their callers and callees.
>
> The plan this change was built from: <its `## Golden rule plan` section, or "(no plan)">.
>
> **0. Inventory.** For each new or changed function, type, predicate, query, config key and domain word the diff
> touches **that the plan does not name** (every one when there is no plan), list every place in the repo that
> defines or decides it (file:line) and the `rg` you ran. For what the plan names, check its inventory still holds.
>
> **1. Drift and architecture.** Does the diff do what the plan says (shape, state, deletes)? For everything outside
> the plan (everything, with no plan), answer each question with evidence: <golden-rule's "The questions", pasted>.
> Did it reduce debt? Name it.
>
> **2. Correctness:** bugs, races, ordering, edge cases, error handling that loses data, security at trust boundaries.
>
> **3. Tests:** does the logic that matters have a fast test? Name the smallest missing one.
>
> **4. Deletion:** dead code, unused exports or options, speculative flexibility, comments that restate code.
>
> Report, ranked: what, where (file:line), the change, net lines. Separate **Do it** (clear wins, and any rule the
> repo's AGENTS.md sets that the change breaks), **Rework** (architecture changes, each with a short plan and size)
> and **Judgment calls**. End with `Verdict:`, `Plan: matched | drifted: <what> | none (full review)`, `Debt reduced:`, `Debt added:`,
> `Net lines: +a / −d`. Skeptical and specific, no style nits. Under 800 words plus the inventory.

### The confirming prompt

> You check that review findings were fixed. You have no context about the work. The findings, verbatim: <the
> must-fix and kept-on-purpose items>. The fixes: `git diff <sha the last round saw>..HEAD`; read the files they
> touch in full. Do not edit, commit, push or comment. For each symbol the fixes add, run one `rg` for other places
> that define or decide it. For each finding: fixed, not fixed, or fixed in a way that adds debt (a second copy, a
> special case, a workaround), with file:line. Then any new bug or debt the fixes bring; nothing else. End with
> `Must-fix left: <each, or "none">`. Under 400 words.
