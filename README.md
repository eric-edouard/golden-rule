# golden-rule

Agent skills for one rule: **every change leaves less technical debt than before.** Debt is decided while planning, so
the rule runs in three steps, and the last one mostly confirms.

| Skill | When |
| --- | --- |
| `golden-rule` | The rule, the architecture questions both reviewers ask, the naming rules, and the gate hook |
| `golden-rule-plan` | Before code: the plan names every place that already decides the same thing; a fresh reviewer checks it |
| `golden-rule-watch` | While coding, when work spans several commits: a background reviewer catches drift early |
| `golden-rule-verdict` | Before every merge: a fresh reviewer's verdict goes into the PR |

## Install

```bash
npx skills add eric-edouard/golden-rule -g
```

Works with Claude Code, Codex and the other agents the [skills CLI](https://skills.sh) supports.

## The gate (optional)

`skills/golden-rule/gate.ts` is a `PreToolUse` hook that refuses a plan with no `## Golden rule plan` section, a
`gh pr merge` without a passing verdict of the PR's head, and a push of code to the default branch. It needs
[bun](https://bun.sh). For Claude Code, add to `~/.claude/settings.json`, with `bun` replaced by the output of
`which bun` (agents often run without `~/.bun/bin` on their PATH, and a hook that cannot start lets everything through):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|ExitPlanMode",
        "hooks": [{ "type": "command", "command": "bun ~/.agents/skills/golden-rule/gate.ts", "timeout": 30 }]
      }
    ]
  }
}
```

For Codex, the same entry without `matcher`, in `~/.codex/hooks.json`. Tests: `bun test`.
