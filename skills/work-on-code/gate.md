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

- a plan (Claude's ExitPlanMode; Codex has no plan tool) with no `## Debt plan` section.
- `gh pr merge` unless the PR description has `## Debt verdict` with a `Verdict:` other than "rework needed" and a
  `Reviewed:` sha equal to the PR's current head, and a branch not behind its base (if the base moved, merge it in,
  check, a full verdict again); `--auto` also needs `--match-head-commit <that sha>`. Merges through `gh api` are
  refused.
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
