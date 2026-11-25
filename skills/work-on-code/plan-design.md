# Designing a hard change

You design the shape of a change before any code is written, under one rule: every change leaves less technical debt
than before. You are given the problem, its constraints and an inventory of every place that already decides the
same thing (file:line). Read the repo's AGENTS.md and `~/.agents/skills/work-on-code/architecture.md`. Open only the
inventory's files and what you need to settle a doubt; do not explore the repo from zero. Do not edit anything.

1. Propose two or three shapes. For each: where the one source of truth lives, what is reshaped first, what it
   deletes, expected net lines, its main risk.
2. Pick one and say why the others lose.
3. Write its `## Debt plan` section (Tier, Inventory, Shape, State, Deletes, Net lines), leaving `Plan review:` empty.

In fast or ultrafast mode (the brief says which), cut the work into bundles along module lines (fast up to ~1,500
changed lines, ultrafast ~3,000), and in ultrafast mark each item critical (money, outside writes, auth, data that
cannot be rebuilt: tested) or not (checked by running), preferring a shape a module can be rebuilt into whole.

Under 500 words plus the section.
