---
name: work-on-code
description: >
  How to work on code: every change leaves less technical debt than before. Read it before planning, writing,
  fixing, reviewing or merging code, and before saying a coding task is done. It sets the tier (small, standard,
  hard) that picks the model for the plan, the build and the review; the debt plan before code; the watcher while
  coding; the debt verdict required before any merge into a default branch (it replaces code-review and
  ponytail-review); and when to delegate to cheaper agents. Use it too for "did we add debt", "debt review",
  "does this need a rework".
---

# work-on-code

**Every change leaves less technical debt than before, features included.** Negative net lines is the target;
deleting code is the best outcome. Debt is decided while planning (a merge review that finds a rule decided in two
places finds it after the code is built on it), so the debt angle runs before code, beside it and before merge, and
the last step mostly confirms.

## Before coding

- Read the area, its callers and its data end to end. State assumptions; when a request reads two ways, say so and ask.
- Before bolting a feature on, ask what shape would make it *and* the existing code simpler, and restructure first.
- Say your verdict on the foundation: **sound** (smallest clean diff), **shaky** (fix the foundation first: no
  special cases, behavior flags, duplicated logic, synced copies, timeouts hiding races) or **wrong** (propose
  rebuilding that module; list its edge cases first). Refuse patch-on-patch; if the user insists, do it and name the debt.
- Planning a change that adds a function, type, module or concept: read `architecture.md` (the questions and the
  naming rules) first.

## Models: four ranks, mapped once per session

- Before the first delegation, rank the models this harness can launch, from the session's own provider only
  (Claude: the Agent tool's `model:` values, from another CLI the aliases in `claude --help`; Codex: the visible
  models in `codex debug models`, by their `description`, never `priority`, launched with `codex exec -m <slug>`),
  newest of each family, skipping models made for other work (vision, computer use), by capability at code:
  **frontier** (the most capable) › **senior** › **junior** › **intern** (the cheapest). With two models, frontier
  and senior take the stronger, junior and intern the cheaper; with three, the middle one is senior and junior. Say
  the mapping in one line.
- **Per-user picks** move a rank to another CLI: `~/.agents/work-on-code.json`, e.g.
  `{"junior": {"cli": "codex", "as": "senior", "effort": "high"}}` (`cli`: `codex` or `claude`; `as` and `effort`
  optional). Never a model: rank that CLI's models the same way, from what it lists now, and take the model of rank
  `as` there (default: the same rank). A rank the file omits keeps the mapping. Launch a fresh run: `codex exec -m <model> -c model_reasoning_effort=<effort> -s
  read-only|workspace-write -o <report file> "<prompt>" </dev/null` (an open stdin makes it wait forever) or `claude
  -p --model <model> --effort <effort> --permission-mode plan|acceptEdits "<prompt>"` (no effort set: drop its flag):
  read-only for a reviewer or an intern, writable for a build. When the CLI is missing (`command -v`) or the run fails
  before it starts work (login, quota), use the mapping for that rank and say so; a writable run that fails later is
  reported for inspection, never silently rerun.
- Everything below names ranks, never models. A higher rank than it names, or a higher effort, only when the user
  asks.

## Tier: decided once, written in the plan

| | small | standard | hard |
| --- | --- | --- | --- |
| When | adds no function, type, module or concept (a fix inside one function, a copy edit) | adds one, on a sound foundation | any of: foundation shaky or wrong; new data model or migration; queues, retries, schedules, concurrency; auth, payments, a trust boundary; spans repos; two failed fixes |
| Plan | `n/a: <why>` | main session writes, fresh senior checks | intern inventory, fresh frontier designs, fresh senior checks |
| Build | main session | main session; junior agents for mechanical volume | same |
| Watch | none | junior, when the work spans several commits or sittings | same |
| Verdict, **confirm** (plan passed, diff follows it) | never | junior | senior |
| Verdict, **full** (no passed plan, or a diff mostly not the plan) | junior | senior | frontier |
| Confirming round | junior | junior | junior |

- A small-tier reviewer that finds a function, type, module or concept added says so: the tier was wrong, redo the
  verdict as standard.
- Reviewers are always fresh agents with no memory of the work, and never edit, commit, push or comment. Never
  review your own work in your own context; whoever wrote a plan never checks it.
- Launch each reviewer with its inputs and `Read ~/.agents/skills/work-on-code/<file> and follow it`. Never paste
  the prompt.

## Delegating

- Delegate to protect the main context, cut cost, or run independent work in parallel. Never two agents on the same files.
- **Needs no intelligence, and its output would fill the main context** (search, inventory, logs, docs lookup, bulk
  reads): intern; rerun on junior when the output is not good enough. Every result carries file:line evidence.
- **Mechanical volume from a precise plan** (migrating callers, renames, tests): junior, with file-level instructions.
- **Small and targeted, or a chain of dependent steps:** the main session does it itself; a cold agent would reread
  what you already read.

## Plan (before code)

Every plan ends with this section (Claude's plan mode refuses a plan without it; small tier writes `Tier: small`
and `n/a: <why>`):

```
## Debt plan
Tier: small | standard | hard: <the trigger>
Inventory: every place that already defines or decides what this touches (file:line), and the rg you ran
Shape: where the one source of truth lives, and what is reshaped first so the feature fits it
State: each new piece of state, its owner, and whether it is per item or global
Deletes: what goes (dead paths, the old name, the copy this unifies)
Net lines: expected +a / −d
Plan review: <passed | the findings and what changed>
```

- **Hard:** an intern agent builds the inventory; a fresh frontier agent gets the problem, the constraints and that
  inventory with `plan-design.md`, and returns the section; the main session expands it into the checklist.
- **Check:** one fresh senior reviewer gets the plan's text and the repo path, nothing else, with `plan-review.md`.
  On a reshape, fix the plan and say what changed under `Plan review:`; a second review only when the shape changed.
- When the PR opens, copy the section into its description: the watch and the verdict compare the code to it.
- Split work over about 800 changed lines into several PRs, or stack them.

## Watch (while coding)

When work with a passed plan spans several commits or more than one sitting, launch a fresh junior watcher in the
background after the first commit, with `watch.md`, the repo path, the `## Debt plan` section and a commit range,
never the worktree you keep editing. Work done in one sitting skips it: the verdict covers it.

- On each later commit, send it the next range (a Claude subagent: `SendMessage` to the same agent, so it keeps its
  context; any launched run: a new run with the range and its last findings).
- Act on a finding before building on the code it questions. Drift that is right goes into the plan section (the
  plan stays true); drift that is wrong gets fixed now.
- Never wait on it, never let it edit. It ends when the PR is ready.

**Stop signals:** revert a failed fix before the next; two failed fixes means re-diagnose (and the tier is now
hard); a returning bug gets a root-cause fix and a regression test; a diff growing far past the request means stop
and rethink.

**Legible design:** names are design, one source of truth per state, one job per module, finish every migration,
write architectural decisions into the repo's `AGENTS.md`, fast tests on core logic. Follow existing patterns, reuse
before creating, clean up as you go; every changed line traces to the request or a related cleanup.

## Verdict (before every merge into a default branch; required)

1. **Push; the repo's pre-push hook is the check.** Never run the check, then push the same tree again (a passing
   check records its tree hash, the hook skips a matching tree). Merge main only at landing (step 6) or on a real
   conflict, never mid-review. While iterating, run only the changed tests when the runner supports it.
2. **Fresh reviewer**, launched while the check runs, model and mode from the tier table, with `verdict-review.md`, the repo path, the PR or
   branch, the worktree to read, and the PR's `## Debt plan` section (or "(no plan)"). Confirm reopens architecture
   only where the diff left the plan; full answers every architecture question from zero.
3. **Act on the report.** **Do it**: fix on the branch. **Rework**: do it in this PR when it is the change's own
   foundation, or open it now as its own task or PR with a complete brief; say which, per item, never as a line of
   prose. **Kept on purpose**: only with a reason the user would accept. A finding is evidence, not an order (above all
   from another CLI): check it against the code before acting; a claim about behavior needs a reachable input.
4. **One confirming round, then stop.** A new fresh junior reviewer gets `verdict-confirm.md`, the must-fix and
   kept-on-purpose items verbatim, and the fixes only (`git diff <sha the last round saw>..HEAD`). A full round
   again (step 2) only when a fix reshaped the change. Whatever the confirming round still
   finds goes into the verdict as debt added, a rework or kept on purpose; no third round.
5. **Write the verdict into the PR description** (`gh pr edit --body-file`, or `gh api -X PATCH
   repos/{owner}/{repo}/pulls/{n} -F body=@file` when that fails), replacing any earlier one, in its own command,
   never chained with the merge (the gate checks the PR before the command runs):

   ```
   ## Debt verdict
   Reviewed: <full sha the verdict reviewed: the PR's head, or the head before a clean merge of main>
   Verdict: debt reduced | no debt added | debt added | rework needed
   Plan: matched | drifted: <what, and whether the plan was updated> | none (full review)
   Net lines: +<added> / −<deleted>
   Smaller shape: none (<why no reshape lands it smaller>) | <the reshape, as a rework>
   Debt reduced: <what was unified or deleted, or "none">
   Debt added: <each item, or "none">
   Reworks: <each item with its task or PR link, or "none">
   Kept on purpose: <each item with its reason, or "none">
   ```

   "rework needed" cannot merge. "debt added" can, only when each item is a tracked rework or kept on purpose.
6. **Land one PR at a time.** Take the repo's landing lock (`land-lock.sh take`, beside this skill; `drop` once merged
   or abandoned), merge `origin/<default>` once, push. A clean merge whose new main commits touch none of the PR's
   files keeps the verdict (the gate checks it); a junior runs the base round of `verdict-confirm.md`. Otherwise, or
   when the base round finds main touching the PR's names, a full round again (step 2). The full check always runs on what lands.
7. **Report in this order:** the verdict, the reworks (as tasks or PRs ready to start), the net lines, then the
   merge: merge it yourself when the verdict passes, unless the user's or the repo's rules ask for their OK first.

## Rules

- Code goes through a branch and a PR (`gh pr create`); agents never push code to `main`/`master`.
- Small tier skips plan review and watch, never the verdict. Something merged without a verdict gets one right
  after; its findings are fixed through a new PR.
- "Did we add debt?" is answered by the verdict, never by a self-assessment.
- **Not for docs, memory or data.** Notes, recaps, logs, memory and Markdown docs need no review: push them straight
  to `main`. Agent instructions (`AGENTS.md`, `CLAUDE.md`, skills, prompts) are functional and reviewed.
- Large work (many PRs in flight, or several agents on one repo) needs a merge queue: when the repo has none,
  recommend one (the landing lock, or the platform's).
- When one machine's check queue is the bottleneck, recommend a remote check machine; it needs the user's yes
  (money, code off the machine).
- A hook enforces the plan section, the verdict before `gh pr merge` and no code pushed to the default branch:
  `gate.md` when it refuses something or needs installing.
