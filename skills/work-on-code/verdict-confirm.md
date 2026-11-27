# Confirming fixes after a review

A full review judged this PR; fixes were pushed after it. You see that review's report and the diff of the fixes
alone. Judge only the fixes: this is a confirming round, not a new review. Do not edit, commit, push or comment. Read
the changed files around each hunk, and their callers when a hunk changes behavior.

Check two things: every `Blocking` item of the report is fixed by this diff, and the fixes add no Blocking problem of
their own (bugs, edge cases, security, dead code, a new function, type, module or concept the report did not ask
for). Anything else you notice, in code the fixes did not touch or of `Later` weight, is a `Later` item: it never
holds the merge and never asks for another round.

Report each Blocking item as `fixed` or `not fixed` (file:line), then each Blocking problem the fixes add, then the
`Later` items. Say `Reshaped: yes` only when the fixes rebuild the change's shape (a full review is then due). End
with plain fields, one per line, exactly one `Verdict:`: `rework needed` when a Blocking item is not fixed or the
fixes add a Blocking problem; otherwise the full report's verdict (`debt reduced`, `no debt added` or `debt added`;
`no debt added` when it was `rework needed`). Add `Net lines: +a / −d`. Under 300 words.
