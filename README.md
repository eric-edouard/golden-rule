# work-on-code

One agent skill for working on code under one rule: **every change leaves less technical debt than before.** Debt is
decided while planning, so the rule runs before code (a debt plan, checked by a fresh reviewer on hard work), beside it (a
background watcher) and before merge (`review.ts` posts a fresh reviewer's verdict on the reviewed commit). A tier (small,
standard, hard) picks the model for each step, so the most capable model is spent only where the shape is decided.

```bash
npx skills add eric-edouard/work-on-code -g
```

Works with Claude Code, Codex and the other agents the [skills CLI](https://skills.sh) supports.

`skills/work-on-code/SKILL.md` is the playbook; the files beside it are read only by the agent that needs them
(reviewer prompts, the architecture questions, the gate). To run some ranks on another CLI (say reviews on Codex
from Claude Code), or the builds on a cheaper model through `pi` when you ask for it, list your picks in
`~/.agents/work-on-code.json`, as `SKILL.md` describes. The optional gate
hook and the base branch’s reviewer policy (`.work-on-code.json`) are described in
[`gate.md`](skills/work-on-code/gate.md). Tests: `bun test`.
