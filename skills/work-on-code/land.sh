#!/bin/sh
# Lands one PR without a model (work-on-code, verdict step 6). Run it from the PR's checkout, in the background:
#   land.sh <pr number> [area...]
# Takes the landing lock, merges origin/<base> once, pushes (the repo's pre-push check runs), asks the gate whether
# the verdict still holds, merges, drops the lock. Exit 0 merged; 1 failed (the reason on stderr); 3 the base changed
# the PR's own files since its review: run the base round of verdict-confirm.md on the diff it prints, then run it again
# with LAND_BASE_CHECKED=1. LAND_METHOD: merge (default), squash or rebase.
# A train is a loop: `for pr in 12 14 15; do land.sh "$pr" || break; done`. Needs git, gh and bun (the gate).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
pr=${1:?usage: land.sh <pr number> [area...]}
shift
fail() { echo "land: $*" >&2; exit 1; }
"$here/land-lock.sh" take "$@"
trap '"$here/land-lock.sh" drop "$@"' EXIT
fields=$(gh pr view "$pr" --json baseRefName,body,files -q '.baseRefName, (.body | capture("Reviewed:\\s*`?(?<s>[0-9a-f]{7,40})").s // ""), (.files[].path)') ||
  fail "cannot read PR $pr"
base=$(echo "$fields" | sed -n 1p)
reviewed=$(echo "$fields" | sed -n 2p)
[ -n "$reviewed" ] || fail "PR $pr has no debt verdict"
git fetch -q origin "$base"
git merge -q --no-edit "origin/$base" || { git merge --abort; fail "conflict with $base: resolve it, then a full verdict round"; }
files=$(echo "$fields" | sed -n '3,$p')
if [ -n "$files" ] && [ -z "${LAND_BASE_CHECKED:-}" ] && ! echo "$files" | xargs git diff --quiet "$reviewed" HEAD --; then
  git push -q origin HEAD || fail "push failed (the check)"
  echo "land: $base changed PR $pr's files; base round on: git diff $reviewed..HEAD -- <the PR's files>" >&2
  exit 3
fi
git push -q origin HEAD || fail "push failed (the check)"
head=$(git rev-parse HEAD)
# The gate's own rule, as if the merge were typed: verdict for this head, carried across a clean merge, not behind.
printf '{"cwd":"%s","tool_input":{"command":"gh pr merge %s --%s --match-head-commit %s"}}' "$(pwd)" "$pr" "${LAND_METHOD:-merge}" "$head" |
  bun "$here/gate.ts" || fail "the gate refused the merge"
gh pr merge "$pr" "--${LAND_METHOD:-merge}" --match-head-commit "$head"
