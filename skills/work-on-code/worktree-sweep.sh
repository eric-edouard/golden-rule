#!/bin/bash
# worktree-sweep.sh [repo...]: remove every git worktree whose branch's PR is merged or closed, then its local branch.
# Only when the branch tip is exactly the PR's head (no local commits after it), no tracked file is changed, and no
# process works in the tree. Untracked and ignored files in it (node_modules, builds) go with it. No repo given: every
# repo directly under ~/Work. Run it from outside the trees it should remove. Safe to run any time.
unset GITHUB_TOKEN GH_TOKEN
repos=("$@"); [ ${#repos[@]} -gt 0 ] || repos=(~/Work/*/)
cwds=$(lsof -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
[ -n "$cwds" ] || { echo "lsof gave no working directories; nothing removed"; exit 1; }
in_use() { printf '%s\n' "$cwds" | awk -v w="$1" '$0==w || index($0, w "/")==1 {f=1} END {exit !f}'; }
for r in "${repos[@]}"; do
  [ -d "$r/.git" ] || continue
  cd "$r" || continue
  prs=$(gh pr list --state all --limit 400 --json headRefName,headRefOid,state \
    -q '.[] | select(.state != "OPEN") | "\(.headRefName)\t\(.headRefOid)\t\(.state)"' 2>/dev/null) || continue
  # The first entry is the main checkout; skip it.
  git worktree list --porcelain | awk '
    /^worktree / {sub(/^worktree /, ""); w=$0; n++}
    /^branch refs\/heads\// {sub(/^branch refs\/heads\//, ""); if (n > 1) print w "\t" $0}' |
  while IFS=$'\t' read -r w b; do
    tip=$(git rev-parse -q --verify "refs/heads/$b") || continue
    st=$(printf '%s\n' "$prs" | awk -F'\t' -v b="$b" -v t="$tip" '$1==b && $2==t {print $3; exit}')
    [ -n "$st" ] || continue
    in_use "$(cd "$w" 2>/dev/null && pwd -P)" && continue
    in_use "$w" && continue
    out=$(git -C "$w" status --porcelain --untracked-files=no 2>/dev/null) || continue
    [ -z "$out" ] || continue
    git worktree remove --force "$w" && git branch -D -q "$b" && echo "removed $w ($b, $st)"
  done
  git worktree prune
done
