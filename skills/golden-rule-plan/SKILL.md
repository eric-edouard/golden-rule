---
name: golden-rule-plan
description: >
  The golden rule while scoping or planning, before any code: the plan names every place that already decides the same
  thing, the shape that keeps one source of truth, what it deletes and the expected net lines, and one fresh top
  reviewer checks it before building. Use it whenever you write a plan for code (plan mode, a spec, a task brief),
  and when asked to "plan with the golden rule".
---

# golden-rule-plan

Debt is cheapest to remove before it is written. Every plan ends with this section (Claude's plan mode refuses a plan
without it; a change that adds no function, type, module or concept writes `## Golden rule plan` and `n/a: <why>`):

```
## Golden rule plan
Inventory: every place that already defines or decides what this touches (file:line), and the rg you ran
Shape: where the one source of truth lives, and what is reshaped first so the feature fits it
State: each new piece of state, its owner, and whether it is per item or global
Deletes: what goes (dead paths, the old name, the copy this unifies)
Net lines: expected +a / −d
Plan review: <passed | the findings and what changed>
```

Then, before building, **one fresh top reviewer** (golden-rule, "Reviewers") gets the plan's text and the repo
path, nothing else, and this prompt:

> You check a plan against the user's golden rule (every change leaves less debt than before) before any code is
> written. Architecture only. Read the repo's AGENTS.md, then run your own `rg` for each name and domain word the plan
> touches; do not trust its inventory. Do not edit anything. Answer each question, with file:line:
> <golden-rule's "The questions", pasted>
> End with `Plan: passes` or `Plan: reshape` and each change, under 300 words.

Fix the plan on a reshape and say what changed under `Plan review:`; a second review only when the shape changed.
When the PR opens, copy this section into its description: the watch and the verdict compare the code to it.
