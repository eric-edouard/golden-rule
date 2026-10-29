---
name: golden-rule
description: >
  The user's golden rule (every change leaves less technical debt than before) and which of its three steps to
  use: golden-rule-plan before code, golden-rule-watch while coding, golden-rule-verdict before merge. Holds the
  architecture questions both reviewers ask, the naming rules, and the hook that gates plans, merges and pushes to
  main. Use it when asked about "the golden rule" or which step applies.
---

# golden-rule

**Reduce technical debt as we work on the project, or keep it to a minimum. Every change leaves less debt than
before.** Debt is decided while planning: a merge review that finds a rule decided in two places finds it after the
code is built on it. So the debt angle runs in three steps, and the last one mostly confirms.

| Step | When | Skill |
| --- | --- | --- |
| Plan | before code, when the change adds a function, type, module or concept | `golden-rule-plan` |
| Watch | while coding, in the background, when the work spans several commits or sittings | `golden-rule-watch` |
| Verdict | before every merge into a default branch; required | `golden-rule-verdict` |

- A change that adds none of those (a fix inside one function, a copy edit) skips plan and watch, never the verdict.
- **Not for docs, memory or data.** Notes, recaps, logs, memory and Markdown docs need no review: push them straight
  to `main`. Agent instructions (`AGENTS.md`, `CLAUDE.md`, skills, prompts) are functional and reviewed.
- Code goes through a branch and a PR (`gh pr create`); agents never push code to `main`/`master`.
- Something merged without a verdict gets one right after; its findings are fixed through a new PR.
- When the user asks "did we add debt?" the answer is the verdict, never a self-assessment.
- Reviewers are always fresh agents with no memory of the work, and never edit, commit, push or comment. Never review
  your own work in your own context.

## Reviewers

- **Top** (the plan check, and a full verdict: no plan, or a diff that left it): Claude, the Agent tool with the most
  capable model. The shape is decided here, so it gets the best reader.
- **Cheap** (watch, confirm-mode verdict, confirming round): Claude, the Agent tool with `model: "sonnet"`. They
  check code against a plan that was already judged.
- Codex: `codex exec` with its default model for every reviewer.

## The questions

Both reviewers (the plan's and the verdict's) answer these with file:line evidence from their own `rg`; paste them
into their prompts. A new question goes here, once.

1. Will any rule or computation be decided in two places (a second place that *composes* shared pieces differently
   counts), or is there a second way of doing what the codebase already does?
2. Is a rename or migration left half-done (an old name, path, caller or doc still alive)?
3. Is any state copied instead of derived, or a magic value (a sentinel date, an empty string, a -1) instead of its own
   field or type?
4. Does any new type, object or module do more than one job (name each job)?
5. For queues, retries and schedules: can old or failing work starve new work? What runs first?
6. Is any state global that belongs to each item (a reason, a status, a timestamp)?
7. A workaround: a special case for one input, a flag switching behavior, a retry or try-catch hiding an ordering bug?
8. Does each new name say what it is, one word per concept (below)?
9. Is a decision this relies on written in the repo's AGENTS.md?
10. Is there a shape that lands it at fewer net lines? What does it delete?

## Names are architecture

A name is the cheapest place to see a concept that is wrong or doubled: two names for one thing, one name for two
things, a name that no longer says what the thing does. Treat a naming problem as a design problem, never as style:

- **Every concept has one word**, written in the repo's glossary when it has one, the same in docs, UI, API and code.
  A new concept gets its word, and its glossary line, in the same change.
- **Clarity beats brevity.** A longer name that says what the thing is and does (`read_open_invoices` over
  `invoices`, `waiting_on_supplier` over `waiting`) beats a short one the reader has to look up.
- **A clearer name is worth its rename, data included.** In data only the repo's own code reads, rename everywhere and
  backfill: one migration rewrites the stored values (a field, an enum value, an id prefix, a file name), then the old
  name leaves the code, with no alias that reads both spellings forever. Existing data alone is never a reason to keep
  a worse name. Data someone else reads or owns (a production database, a public API, a client already shipped, a
  repo shared with someone) is ask-first: propose the rename and its migration, and the repo's AGENTS.md can rule it
  out. Batch renames that cost the user something (a reconnect, a re-login) into one change.
- **No person's name** in code, stored values or ids: name the role.

## The gate

`gate.ts` (tests in `gate.test.ts`) is a `PreToolUse` hook for Claude Code (`~/.claude/settings.json`, matcher
`Bash|ExitPlanMode`) and Codex (`hooks.json` in `$CODEX_HOME`, else `~/.codex`), registered as the README shows, and,
as `gate.ts pre-push`, git's pre-push hook for every repo on the machine, whatever harness pushes (a global config hook:
`git config --global hook.golden-rule.event pre-push` and `hook.golden-rule.command` running it with bun's full path;
it runs beside a repo's own pre-push hook). It refuses:

- a plan (Claude's ExitPlanMode; Codex has no plan tool) with no `## Golden rule plan` section.
- `gh pr merge` unless the PR description has `## Golden rule verdict` with a `Verdict:` other than "rework needed" and a
  `Reviewed:` sha equal to the PR's current head, and a branch not behind its base (if the base moved, merge it in,
  check, a full verdict again); `--auto` also needs `--match-head-commit <that sha>`. Merges through `gh api` are
  refused.
- `git push` of code to the repository's default branch: an explicit refspec, `HEAD`, `--all`, `--mirror`, or a bare
  push from that branch.

Docs, memory and data are never gated: any `.md`, `.txt`, `.csv`, `.jsonl` or `.log` file, and any non-script file under
`docs/`, `memory/`, `data/` or `reports/`, except agent instructions (`AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `prompts/`,
`.claude/`, `.agents/`, `.cursor/`, `docs/agents/`). A push or a PR that only changes those goes through. Dry runs and
tags pass too.

It sees commands inside `sh -c`/`bash -lc` (how Codex runs them) and skips heredoc bodies. It fails closed: if it
cannot check, it refuses. It stops the ordinary ways of merging, not a determined bypass (subshells, aliases, curl):
the user can always merge themselves. The pre-push hook gates his own pushes of code to the default branch too, and
any harness's; `git push --no-verify` or `-c core.hooksPath=` skips it, and a merge is checked only by the tool hook
(it happens on GitHub, where no git hook runs).
