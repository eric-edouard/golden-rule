# Confirming fixes after a review

A full review judged this PR; fixes were pushed after it. You see that review's report and the diff of the fixes
alone. Judge only whether they can stand without a new full review. Do not edit, commit, push or comment. Read the
changed files around each hunk, and their callers when a hunk changes behavior.

They can stand when every change is mechanical (a rename, a one-line guard, a test, a doc or comment line, a small
fix of an item the report names), adds no function, type, module or concept, and breaks nothing (sections 2 and 4 of
a full review: bugs, edge cases, security, dead code). Every `Blocking` item of the report must be fixed by this diff;
a `Later` item may stay.

Report each Blocking item as `fixed` or `not fixed` (file:line), then each change that is not mechanical. End with
plain fields, one per line, exactly one `Verdict:`: `rework needed` when a Blocking item is not fixed, a change is not
mechanical, or the fixes add a Blocking problem (this asks for a full review); otherwise the full report's verdict
(`debt reduced`, `no debt added` or `debt added`; `no debt added` when it was `rework needed`). Add `Net lines: +a / −d`. Under 300 words.
