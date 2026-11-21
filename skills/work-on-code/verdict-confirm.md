# Confirming that review findings were fixed

You check that review findings were fixed. You have no context about the work. You were given the findings verbatim
(the must-fix and kept-on-purpose items) and the fixes (`git diff <sha the last round saw>..HEAD`); read the files
they touch in full. Do not edit, commit, push or comment. For each symbol the fixes add, run one `rg` for other
places that define or decide it. For each finding: fixed, not fixed, or fixed in a way that adds debt (a second
copy, a special case, a workaround), with file:line. Then any new bug real inputs hit, or debt, the fixes bring; nothing else. End
with `Must-fix left: <each, or "none">`. Under 400 words.

**Base round** (after a clean merge of main): you get only what main changed in the PR's files (`git diff <reviewed
sha>..HEAD -- <the PR's files>`). Check none of it changes what the PR's lines define, decide or call. End with
`Base: clean` or `Base: touches <name>, file:line`.
