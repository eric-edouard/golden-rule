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
- `gh pr merge` unless the PR description has `## Debt verdict` with a `Verdict:` other than "rework needed" and a
  `Reviewed:` sha equal to the PR's current head, or carried to it across a clean merge of the base (run from the
  PR's checkout: the head's tree equals `git merge-tree --write-tree <reviewed> <the base's sha on GitHub>`, and no hunk the
  base brought in lies within 3 lines of the reviewed PR's own changed lines, a binary or mode change counting as the whole file), and a branch not behind its base (if the base moved,
  merge it in, check, and confirm or redo the verdict); `--auto` also needs `--match-head-commit <the head's sha>`.
  Merges through `gh api` are refused.
- `git push` of code to the repository's default branch: an explicit refspec, `HEAD`, `--all`, `--mirror`, or a bare
  push from that branch.

Docs, memory and data are never gated: any `.md`, `.txt`, `.csv`, `.jsonl` or `.log` file, and any non-script file
under `docs/`, `memory/`, `data/` or `reports/`, except agent instructions (`AGENTS.md`, `CLAUDE.md`, `SKILL.md`,
`prompts/`, `.claude/`, `.agents/`, `.cursor/`, `docs/agents/`). A repository that holds only data marks itself with
a `.data-repo` file at its root: there every non-script file is data, wherever it lives. A push or a PR that only
changes those goes through. Dry runs and tags pass too.

It sees commands inside `sh -c`/`bash -lc` (how Codex runs them) and skips heredoc bodies. It fails closed: if it
cannot check, it refuses. It stops the ordinary ways of merging, not a determined bypass (subshells, aliases, curl):
the user can always merge themselves. The pre-push hook gates the user's own pushes of code to the default branch
too, and any harness's; `git push --no-verify` or `-c core.hooksPath=` skips it, and a merge is checked only by the
tool hook (it happens on GitHub, where no git hook runs).

## The gate on the PR (`pr-status.ts`)

Where the merge cannot be blocked on GitHub (no branch protection, no CI), `pr-status.ts <prefix>` shows the gate on
the PR as commit statuses. It is a Claude Code `PostToolUse` hook (matcher `Bash`), registered by a repo that wants it
(`bun pr-status.ts mad`). After a command that pushed (`git push`) or edited a PR (`gh pr create|edit|ready`, the
`gh api -X PATCH …/pulls/<n>` fallback) of the folder's own repo, it posts on the PR's head:

- `<prefix>/debt-verdict`: the gate's rule on the verdict at that moment (`verdictOf`, the same code `gh pr merge` is
  checked with): success with the verdict and net lines; pending without a verdict for the head, or behind the base;
  failure on "rework needed". The base can move later: the status is as of the last push or edit.
- `<prefix>/check`, in repos with a `check` script, only from the PR's clean, pushed head: success when
  `<git dir>/check-passed` (the tree the repo's pre-push hook last saw `bun run check` pass on, clean before and
  after) is the head's tree, pending otherwise.

It never refuses anything and is silent on errors and branches with no open PR.
