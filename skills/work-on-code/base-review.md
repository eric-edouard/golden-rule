# Reviewing base changes before merge

Read the base diff from `land.ts` and the PR lines it touches. Check whether the base changed anything
those lines define, decide or call. Do not edit, commit, push or comment. End with `Base: clean` or
`Base: touches <name>, file:line`.

When `review.ts … land` runs you, you also see a conflict resolved by hand: git's own merge with its conflict
markers, against the pushed head. Check that the resolution keeps both sides' intent, and that it holds nothing but
the resolution (no new code, no fixes slipped in). Then end with plain fields, one per line: the `Base:` line, and
`Verdict: rework needed` when the base touches the PR's lines, the resolution loses either side, or it holds other
changes (a full review is then due); otherwise `Verdict: no debt added`. Under 200 words.
