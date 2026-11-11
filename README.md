# work-on-code

One agent skill for working on code under one rule: **every change leaves less technical debt than before.** Debt is
decided while planning, so the rule runs before code (a debt plan, checked by a fresh reviewer), beside it (a
background watcher) and before merge (a fresh reviewer's debt verdict, written into the PR). A tier (small,
standard, hard) picks the model for each step, so the strongest model is spent only where the shape is decided.

```bash
npx skills add eric-edouard/golden-rule -g
```

Works with Claude Code, Codex and the other agents the [skills CLI](https://skills.sh) supports.

`skills/work-on-code/SKILL.md` is the playbook; the files beside it are read only by the agent that needs them
(reviewer prompts, the architecture questions, the gate). The optional gate hook, `gate.ts`, is described in
`skills/work-on-code/gate.md`. Tests: `bun test`.
