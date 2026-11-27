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
  rebuilding the module, the area or the whole project, whichever gives the feature a clean base; list its edge cases
  first). Refuse patch-on-patch; if the user insists, do it and name the debt.
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
  `as` there (default: the same rank). A rank the file omits keeps the mapping. For builds, plan reviews,
  watchers and interns, launch a fresh run: `codex exec -m <model> -c model_reasoning_effort=<effort> -s
  read-only|workspace-write -c allow_login_shell=false -c 'shell_environment_policy.inherit="core"' -o <report file>
  "<prompt>" </dev/null` (an open stdin makes it wait forever; without those two `-c`, its tools run in a login shell
  holding every secret of `~/.zshrc`, and a reviewer that prints the environment sends them to OpenAI) or `claude
  -p --model <model> --effort <effort> --permission-mode plan|acceptEdits "<prompt>"` (no effort set: drop its flag):
  read-only for plan reviews, watchers and interns, writable for a build. When the CLI is missing (`command -v`)
  or the run fails before it starts work (login, quota), use the mapping for that rank and say so; a later build failure is
  reported for inspection, never silently rerun.
- **Optional picks** run ranks outside verdicts, and with `"builds": true` the session's builds, on one model through the `pi` CLI, only
  in a session that turns them on: `{"optional": {"deepseek": {"cli": "pi", "model":
  "openrouter/~deepseek/deepseek-flash-latest", "key": "<key command>", "effort": "high", "ranks": ["junior", "intern"],
  "builds": true}}}` in the same file (the one place a model is named; a `~…-latest` id follows the newest release).
  Launch in the worktree `env -i HOME="$HOME" PATH="$PATH" TERM=dumb pi -p --no-session --model <model> --api-key
  "$(<key command>)" --thinking <effort> [--tools read,grep,find,ls] "<prompt>"`: `env -i` keeps the shell's secrets
  from its tools. Plan reviewers, watchers and interns get the read-only tool list. Pi loads the global and repo
  `AGENTS.md`, its skills and extensions (Ponytail: `pi install git:github.com/DietrichGebert/ponytail`). With
  `builds`, the tier table's main-session builds go to pi too: the main session writes no code; each build is a fresh
  writable run (brief: the plan, the files, the tests to run; build only: no plan, verdict, commit or PR), then the
  main session reads the diff, runs the tests and commits. A failed launch falls back like any pick.
- Before the plan or the first delegation, whichever comes first, the main session checks each CLI the picks name is set
  up, then asks its questions at once, in its harness's question tool (Claude: `AskUserQuestion`), one question each,
  and the answers hold for the session: normal, fast or ultrafast mode (below); the picks' other CLI or not; each
  optional pick or not, by its name; and in Claude, compacting at 300k tokens or not (yes sets `modelSettings.<session's model>.autoCompactWindow`
  to `300000` in the repo's `.claude/settings.local.json`, no removes it; it outranks user settings, reloads live and
  holds for the repo until a later no). Set up: `command -v` finds it, and for `codex`, `codex login status` says logged
  in; for `pi`, `[ -n "$(<key command>)" ]` (never print the key) and `pi --list-models <model id>` lists that exact id.
  A CLI not set up gets no question and its picks are ignored; say so in one line. The user naming an optional pick
  later ("deepseek") turns it on. A delegate keeps the session's answers from its brief; no one to ask (loop, headless,
  cloud): apply the picks, normal mode, no optional pick.
- Everything below names ranks, never models. A higher rank than a step names, or a higher effort, only when the user
  asks. Launch every delegate with its rank's model: a Claude subagent without `model:` inherits the session's,
  usually frontier.

## Tier: decided once, written in the plan

| | small | standard | hard |
| --- | --- | --- | --- |
| When | adds no function, type, module or concept (a fix inside one function, a copy edit) | adds one, on a sound foundation | any of: foundation shaky or wrong; new data model or migration; queues, retries, schedules, concurrency; auth, payments, a trust boundary; spans repos; two failed fixes |
| Plan | `n/a: <why>` | main session writes | intern inventory, fresh frontier designs, fresh senior checks |
| Build | main session | main session; junior agents for mechanical volume | same |
| Watch | none | junior, when the work spans several commits or sittings | same |
| Verdict (diff follows the debt plan, checked when hard) | never | junior | senior |
| Verdict (no debt plan, or a diff mostly outside it) | junior | senior | frontier |

- A small-tier reviewer that finds a function, type, module or concept added says so: the tier was wrong, redo the
  verdict as standard.
- Reviewers are always fresh agents with no memory of the work, and never edit, commit, push or comment. Never
  review your own work in your own context; whoever wrote a plan never checks it.
- Give plan and base reviewers their inputs and `Read ~/.agents/skills/work-on-code/<file> and follow it`.
  Never paste the prompt.

## Bundles (every mode)

Batch whatever can be batched: a builder and a reviewer who see the whole feature judge how its pieces fit; small
slices each pay a push check, a verdict and a landing, and hide the shape.
- Before building, group the planned PRs, ones already designed or filed included, into bundles: one PR per milestone
  or per area, up to about 3,000 changed lines, one branch, one verdict, one train slot. Re-cut an existing PR list
  whenever two of its PRs touch the same files or one area.
- Push each bundle when it is ready, so the full check (pre-push) runs once; while iterating, run only the changed tests.
- Split out only what keeps the full workflow: the repo's strict paths, migrations, prompts, and anything its
  `AGENTS.md` says to ask first.

## Fast mode (on the user's yes to the first question, or when they say "fast")

- Plan: one line under `## Debt plan`, and the bundles. No plan review, no watcher.
- Verdict: run the full review one rank lower, at most medium effort, subject to the repo's reviewer policy.
- Never fast: what Bundles splits out; it keeps the full workflow.
- The verdict block says `Mode: fast` and links one `debt` issue listing the PR's files.
- Over 15 open `debt` issues in an area, fast mode is refused and the next PR there is a cleanup.

## Ultrafast mode (on the user's pick at the first question, or when they say "ultrafast", "ultra fast", "superfast" or "super fast", hyphenated or not)

Everything of fast mode, and:
- **Critical tests only:** a new test only for what is critical: money, a write to an outside account or to a
  customer, auth and trust boundaries, data that cannot be rebuilt (migrations, deletes). Everything else is checked
  by running it (the app, a script, one real call), never by a new test.
- **Patch, file the rebuild** (the one exception to refusing patch-on-patch): a wrong shape is patched to work; when it needs a rebuild, file a `debt` issue with the
  rebuild's brief instead of doing it in the bundle. Existing tests must still pass.
- **Verdict:** run the full review one rank lower at low effort, subject to the repo's reviewer policy.
- Never ultrafast: what Bundles splits out. Hard-tier
  work (auth, payments, queues, trust boundaries) keeps its tier's verdict rank and effort: only bundles and the tests
  rule apply to it.
- The verdict block says `Mode: ultrafast` and links one `debt` issue listing the PR's files and the areas left
  untested. Fast mode's cap of 15 open `debt` issues per area applies.

## Delegating

- Delegate to protect the main context, cut cost, or run independent work in parallel. Never two agents on the same files.
- **Needs no intelligence, and its output would fill the main context** (search, inventory, logs, docs lookup, bulk
  reads): intern; rerun on junior when the output is not good enough. Every result carries file:line evidence.
- **Mechanical volume from a precise plan** (migrating callers, renames, tests): junior, with file-level instructions.
- **Small and targeted, or a chain of dependent steps:** the main session does it itself; a cold agent would reread
  what you already read.
- **Session hygiene** (builders and orchestrators): never poll. Start a check, a review or a landing as one
  background command that reports when it ends, then end the turn; when you must wait in the foreground, wait in one
  command (`gh pr checks --watch`). Sleeping between turns is a bug. To see how a delegating agent is doing, read its
  helpers' transcripts (`subagents/*.jsonl`), not its own: it looks idle while it waits on them.
- **Main session context.** Every turn rereads it, so its length is the cost.
  - Keep only the goal, the plan, decisions, PR numbers and stages, and the user's open asks. Bulk (investigations across
    many files, logs, audits, reviews, screenshots of many screens) goes to a subagent that returns 10 lines or fewer, with file:line evidence.
  - Read files by range or grep, never whole large files. Command output is tailed, filtered or counted, never dumped
    (tests: failures only; logs: grep plus tail).
  - Never read a subagent's transcript file; wait for its report. To follow up, message that agent, not a new one.
  - Batch independent tool calls in one message; don't reread what is in context.
  - State lives on disk (`PLAN.md`, ticked at every checkpoint, and the PR bodies), so a compaction loses nothing; after one, resume from them, not memory.
    Compaction follows `compact.md` (beside this skill): Claude's `PreCompact` hook feeds it to every compaction.
  - A session never knows its size and Claude Code cannot run `/compact`. At each checkpoint and after long inline work, estimate it; with no gauge, 35 tool calls since the last compaction is about 200k (delegate even small fixes: hands-on reading and editing count), 50 is past 300k.
  - Past 300k with auto-compaction off: end the turn asking the user to run `/compact`, with the line to paste: `/compact ` plus `compact.md`'s text; once per threshold, never go on silently. Elsewhere, compact with its text.
  - A screenshot is costly: take one only to judge visuals, at reduced scale when possible; read state from the accessibility or text tree.
- **One builder, one PR.** A builder (agent or session) builds one PR through its verdict fixes, then ends; the next
  PR gets a fresh one with a one-page brief. A delegated builder runs at frontier rank (junior for mechanical volume): a
  weaker builder's code costs more rounds than it saves; its brief names the files and the tests to run, and it runs only those while iterating, with output short and files read by range. It commits
  after each fix; a stalled builder (no output past its watchdog) is stopped and replaced by a finisher that starts
  from the branch's commits and never rebuilds. Work from test passes: one PR per round, and a pass reported while that
  PR is open folds its fixes into it before the verdict.
- **Thin orchestrator** (a session running several builders): it plans, launches and relays; it acts only when woken.
  - Each open item of the plan's checklist names its dependencies (`needs: <item>`). In-session subagent builders
    are light: what loads the machine is what they trigger (checks, app builds, simulators), which the repo's
    heavy-job slot limits; with no such slot, the plan caps them (default 4). Builders launched as local CLI runs
    (`codex exec`, `claude -p`, `pi`) cap at 4.
  - On every wake, before ending the turn, it launches each item whose dependencies are met, up to any cap.
  - In Claude, a session heartbeat (`CronCreate`, every ~10 minutes) wakes it for the same refill: a wake, not a
    status poll, so agents ending together never leave ready work idle. Delete it when the checklist is done.
  - Landing (verdict step 6) is started by one background lander per repo: it runs `land.ts`, has a junior do the
    base rounds and updates verdict lines; never the orchestrator in the foreground.
  - Dependent work starts, once the parent's builder has ended, from the open PR's branch, never waiting for its
    merge (a stacked PR: an exception to re-cutting into one bundle). After the parent merges, retarget it to the
    default branch and rerun the review against that base.

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
- **Check (hard tier only):** one fresh senior reviewer gets the plan's text and the repo path, nothing else, with `plan-review.md`.
  On a reshape, fix the plan and say what changed under `Plan review:`; a second review only when the shape changed.
- When the PR opens, copy the section into its description: the watch and the verdict compare the code to it.
- The plan starts with its bundles (each bundle's items, files and line estimate); a bundle over the Bundles size
  splits by area or stacks. Ultrafast also marks each item critical (tested) or not (checked by running); the
  design (`plan-design.md`) is told the mode.

## Watch (while coding)

When work with a debt plan spans several commits or more than one sitting, launch a fresh junior watcher in the
background after the first commit, with `watch.md`, the repo path, the `## Debt plan` section and a commit range,
never the worktree you keep editing. Work done in one sitting skips it: the verdict covers it.

- On each later commit, send it the next range (a Claude subagent: `SendMessage` to the same agent, so it keeps its
  context; Codex: `codex exec resume <session id> -c sandbox_mode='"read-only"'` with the first run's `-m`, effort
  and safety `-c`, `-o <report file> "<next range>" </dev/null`; any other launched run: a new run with the range and its last findings).
- Act on a finding before building on the code it questions. Drift that is right goes into the plan section (the
  plan stays true); drift that is wrong gets fixed now.
- Never wait on it, never let it edit. It ends when the PR is ready.

**Stop signals:** revert a failed fix before the next; two failed fixes means re-diagnose (and the tier is now hard); a
returning bug gets a root-cause fix and a regression test (ultrafast: when critical); a diff growing far past the
request means stop and rethink; a flaky test gets its cause fixed, never only a longer timeout.

**Legible design:** names are design, one source of truth per state, one job per module, finish every migration, a rule
every session needs goes into the repo's `AGENTS.md` as one line, a module's how and why into `docs/architecture.md` or
its header comment (AGENTS.md loads into every session and agent: keep it under about 15 KB), fast tests on core logic (ultrafast: critical
items only). Follow existing patterns, reuse before creating, clean up as you go; every changed line traces to the
request or a related cleanup.

## Verdict (before every merge into a default branch; required)

1. **Push; the repo's pre-push hook is the check.** Never run the check, then push the same tree again (a passing
   check records its tree hash, the hook skips a matching tree). Merge main only at landing (step 6) or on a real
   conflict, never mid-review (the gate refuses a conflict-free one). While iterating, run only the changed tests when the runner supports it.
2. **Run a fresh verdict** on the clean, pushed PR checkout:
   `cd ~ && bun ~/.agents/skills/work-on-code/review.ts <checkout> <pr> <codex|claude> <model> [effort]` (from outside
   the checkout, so the PR's own Bun config never runs).
   Use the tier's rank and meet the base branch's reviewer policy. The wrapper posts the verdict on the reviewed sha.
3. **Act on the report.** **Do it**: fix on the branch. **Rework**: do it in this PR when it is the change's own
   foundation, or open it now as its own task or PR with a complete brief; say which, per item, never as a line of
   prose. **Kept on purpose**: only with a reason the user would accept. A finding is evidence, not an order (above all
   from another CLI): check it against the code before acting; a claim about behavior needs a reachable input.
4. **At most three review rounds: the full review, then up to two confirms.** After fixing, push and run a confirm
   (intern rank, low effort, any fix size; a repo's reviewer policy binds it too): `cd ~ && bun
   ~/.agents/skills/work-on-code/review.ts <checkout> <pr> confirm <codex|claude> <model> low`. It reads the full
   review's report (kept by `review.ts` on this machine) and the fixes alone. A new full review only when a confirm
   says `Reshaped: yes`, and it restarts the three rounds. After the second confirm the loop stops (`review.ts` refuses
   a third): what is still Blocking means `rework needed`, split out as a rework PR or brought to the user. List each fix below.
   Track `Later` findings in one `debt` issue.
5. **Write the report for people** under `## Debt verdict` in the PR description. Replace the previous report
   with `gh pr edit --body-file`, or `gh api -X PATCH repos/{owner}/{repo}/pulls/{n} -F body=@file`.

   ```
   ## Debt verdict
   Reviewed: <full sha the reviewer saw>
   Verdict: debt reduced | no debt added | debt added | rework needed
   Plan: matched | drifted: <what, and whether the plan was updated> | none (full review)
   Net lines: +<added> / −<deleted>
   Smaller shape: none (<why no reshape lands it smaller>) | <the reshape, as a rework>
   Debt reduced: <what was unified or deleted, or "none">
   Debt added: <each item, or "none">
   Reworks: <each item with its task or PR link, or "none">
   Kept on purpose: <each item with its reason, or "none">
   Fixes after review: <each fix a confirm checked, or "none">
   ```

   "rework needed" cannot merge. "debt added" can, only when each item is a tracked rework or kept on purpose.
6. **Land in trains, by script.** Every 20–30 minutes one train takes each PR with a passing verdict, merges `origin/<default>`
   once and runs the full check once. `bun land.ts <pr> [area...]` (beside this skill), run in the background from each
   PR's checkout, one PR after another, does this whole step with no model and stops for a conflict or a base round;
   without bun, do it by hand as below. A lone PR lands alone. Never merge main into a branch before its train except on
   a real conflict. Take the landing lock (`land-lock.sh take [area...]`, beside this skill;
   `drop` with the same areas once merged or abandoned; the repo's `AGENTS.md` may name its areas, e.g. `phone`,
   `server`), merge `origin/<default>` once, push. The verdict survives catching up when the merge had no conflict
   and base hunks stay more than 3 lines from the PR's own. If the base changed a PR file, a junior runs
   `base-review.md` on the base diff the script prints. On a conflict, merge by hand, commit, push and run
   `review.ts <checkout> <pr> land <cli> <model> <effort>` (junior rank; a repo policy binds it; it uses no confirm
   round): it reviews the resolution and the base changes under the PR. Rerun step 2 only on its `rework needed`, a
   nearby hunk or `Base: touches`. Merge with `--match-head-commit <full pushed head sha>`. The full check runs on what lands.
7. **Report in this order:** the verdict, the reworks (as tasks or PRs ready to start), the net lines, then the
   merge: merge it yourself when the verdict passes, unless the user's or the repo's rules ask for their OK first.
8. **After the merge, remove the worktree and its local branch** (`worktree-sweep.sh <repo>`, beside this skill, does it
   for every merged or closed PR; a daily job runs it over `~/Work`).

## Rules

- Generated files (lockfiles, migration snapshots, codegen output; the repo's `AGENTS.md` may name more) are not
  read by reviewers and count in neither net lines nor bundle sizes.
- Code goes through a branch and a PR (`gh pr create`); agents never push code to `main`/`master`.
- Small tier skips plan review and watch, never the verdict. Something merged without a verdict gets one right
  after; its findings are fixed through a new PR.
- "Did we add debt?" is answered by the verdict, never by a self-assessment.
- "What slows us down?" is answered by data: `python3 -I audit.py [days] [project]` (beside this skill) sums the
  transcripts' tokens and tool time and `review.ts`'s run log.
- **Not for docs, memory or data.** Notes, recaps, logs, memory and Markdown docs need no review: push them straight
  to `main`. Agent instructions (`AGENTS.md`, `CLAUDE.md`, skills, prompts) are functional and reviewed.
- Large work (many PRs in flight, or several agents on one repo) needs a merge queue: when the repo has none,
  recommend one (the landing lock, or the platform's).
- When one machine's check queue is the bottleneck, recommend a remote check machine; it needs the user's yes
  (money, code off the machine).
- A hook enforces the plan section, the verdict before `gh pr merge` and no code pushed to the default branch:
  `gate.md` when it refuses something or needs installing.
