# Reviewing base changes before merge

Read the base diff from `land.ts` and the PR lines it touches. Check whether the base changed anything
those lines define, decide or call. Do not edit, commit, push or comment. End with `Base: clean` or
`Base: touches <name>, file:line`.
