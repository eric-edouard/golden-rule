# The gate

`gate.ts` (tests in `gate.test.ts`, `bun test`) is a `PreToolUse` hook for Claude Code (`~/.claude/settings.json`,
matcher `Bash|ExitPlanMode`) and Codex (`hooks.json` in `$CODEX_HOME`, else `~/.codex`, the same entry without
`matcher`), and, as `gate.ts pre-push`, git's pre-push hook for every repo on the machine, whatever harness pushes
(a global config hook: `git config --global hook.work-on-code.event pre-push` and `hook.work-on-code.command`; it
runs beside a repo's own pre-push hook). It needs [bun](https://bun.sh), by its full path (`which bun`): agents
often run without `~/.bun/bin` on their PATH, and a hook that cannot start lets everything through.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|ExitPlanMode",
        "hooks": [{ "type": "command", "command": "bun ~/.agents/skills/work-on-code/gate.ts", "timeout": 30 }]
      }
    ]
  }
}
```

It refuses:

- `codex exec` (or `codex e`, global options first, or `timeout <duration> codex exec`, `resume` included) whose
  stdin is open (no `</dev/null`, pipe, heredoc or here-string): it waits on it forever. A safety net for the forms
  agents write, not a shell: escapes, comments, a `timeout` option, or stdin given to an enclosing `sh -c` are not read.
- the same `codex exec` unless its last `-c`/`--config` values set `allow_login_shell=false` and
  `shell_environment_policy.inherit="core"` (`core` quoted or not): without them its commands see the login shell's secrets,
  and what they print goes to OpenAI. Values after `--` or on an enclosing `sh -c` do not count.
- a plan (Claude's ExitPlanMode; Codex has no plan tool) with no `## Debt plan` section.
- every `gh pr merge` missing `--match-head-commit <full current head sha>`, and merges through `gh api`.
- a code merge behind its base or without a passing `debt-verdict` status for that base ref.
- a hand-posted `debt-verdict` through `gh api …/statuses/…`. Run `review.ts` on the clean, pushed head, started outside the checkout.
- `git push` of code to the repository's default branch: an explicit refspec, `HEAD`, `--all`, `--mirror`, or a bare
  push from that branch.

Docs, memory and data are never gated: any `.md`, `.txt`, `.csv`, `.jsonl` or `.log` file, and any non-script file
under `docs/`, `memory/`, `data/` or `reports/`, except agent instructions (`AGENTS.md`, `CLAUDE.md`, `SKILL.md`,
`prompts/`, `skills/`, `.claude/`, `.agents/`, `.cursor/`, `docs/agents/`; both names of a renamed file count). A repository that holds only data marks itself with
a `.data-repo` file at its root. There any non-script file counts as data except instructions and the root
`.work-on-code.json` reviewer policy. A data-only push or PR skips review. Dry runs and tags pass too.

The gate looks for the nearest `debt-verdict` status at most 20 first-parent commits back from the head, so its
hook stays inside its timeout. The status description is capped at GitHub's 140 characters, which limits the base
branch name to about 60.

It sees commands inside `sh -c`/`bash -lc` (how Codex runs them) and skips heredoc bodies. It fails closed: if it
cannot check, it refuses. It stops the ordinary ways of merging, not a determined bypass (subshells, aliases, curl):
the user can always merge themselves. The pre-push hook gates the user's own pushes of code to the default branch
too, and any harness's; `git push --no-verify` or `-c core.hooksPath=` skips it, and a merge is checked only by the
tool hook (it happens on GitHub, where no git hook runs).

## Verdict proof

`review.ts` pins the base and head, runs a fresh read-only review and posts the status on the reviewed commit.
The description records `<verdict> | <model> <effort> | <base ref>@<base sha>`. Retargeting needs a new run.
Starting at the head, the gate takes the nearest PR commit with a trusted status (a confirm's, paired with the
nearest full one behind it, below). Its newest trusted status
wins (highest id on a tie). A failed rerun blocks the merge. The PR description is the report for people.

Set a policy in `.work-on-code.json` at the repo root, for example:

```json
{"reviewer":{"models":["claude-opus-5-5"],"effort":"medium","publishers":["<login>"]}}
```

The gate reads the base branch's policy on GitHub. An unreadable policy blocks the merge.
It requires an exact listed model and at least the stated effort. Publishers default to the login running the gate.
The reviewed sha must be the head or carry across a clean base merge with the same tree and all
base hunks more than 3 lines from the PR's hunks.

`review.ts <checkout> <pr> confirm …` reviews only the fixes since the nearest full review (`git diff` from that
review merged with the head's base, any size), with `verdict-confirm.md` and the full
review's report, which a full run keeps in `<git common dir>/work-on-code/<sha>.md`. Its status reads
`confirm <verdict> | …`, and the gate pairs it with the nearest full status behind it: the policy's model and effort
bind that full review and the confirm alike (a confirm judges fixes of any size), both must name the PR's base, and
`land.ts`'s base round starts from the full review's base. At most two confirms follow a full review (three
rounds per PR; a new full review restarts them); `review.ts` refuses a third. A confirm below the policy
is skipped: it proves nothing and uses no round, and `review.ts` refuses to run one.
`review.ts … land` reviews a base merge resolved by hand (head against git's own merge of its two parents, plus
the base changes under the PR's files); its `land <verdict>` status pairs with the full review like a confirm, uses
no confirm round, and records the merged base, so `land.ts` asks no base round after it. That limit and the saved report are checked by `review.ts` alone, like everything else the publisher posts.
The proof trusts the publisher. Anyone with its token, including a PR author who holds it, can script a status.

## The check on the PR (`pr-status.ts`)

`pr-status.ts <prefix>` is a Claude Code `PostToolUse` hook (matcher `Bash`), registered by a repo that wants it
(`bun pr-status.ts mad`). After a command that pushed (`git push`) or edited a PR (`gh pr create|edit|ready`, the
`gh api -X PATCH …/pulls/<n>` fallback) of the folder's own repo, it posts on the PR's head. A PR named by number
or URL is shown when it belongs to the folder's repo (another repo's is skipped); the branch's PR only when the
checkout's HEAD is its head. Tag-only, deleting and dry-run pushes are ignored.

In repos with a `check` script, it posts `<prefix>/check` from the clean, pushed head: success when
`<git dir>/check-passed` (the tree the repo's pre-push hook last saw `bun run check` pass on, clean before and
after) is the head's tree, pending otherwise.

It never refuses anything and is silent on errors and branches with no open PR.

`land.ts <pr> [area...]` (verdict step 6) applies the gate's verdict rule (`verdictOf`) to its own merge before making
it, since the tool hook sees only `land.ts`.
