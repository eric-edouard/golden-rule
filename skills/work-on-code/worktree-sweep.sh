#!/bin/bash
# worktree-sweep.sh [repo...]: remove every git worktree whose branch's PR is merged or closed, when it is clean and no
# process works in it, then its local branch. No repo given: every repo directly under ~/Work. Safe to run any time.
unset GITHUB_TOKEN GH_TOKEN
repos=("$@"); [ ${#repos[@]} -gt 0 ] || repos=(~/Work/*/)
cwds=$(lsof -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
for r in "${repos[@]}"; do
  [ -d "$r/.git" ] || continue
  cd "$r" || continue
  states=$(gh pr list --state all --limit 400 --json headRefName,state -q '.[]|"\(.headRefName)\t\(.state)"' 2>/dev/null) || continue
  main=$(git rev-parse --show-toplevel)
  git worktree list --porcelain | awk '/^worktree /{w=$2} /^branch /{sub("refs/heads/","",$2); print w"\t"$2}' |
  while IFS=$'\t' read -r w b; do
    [ "$w" = "$main" ] && continue
    st=$(printf '%s\n' "$states" | awk -F'\t' -v b="$b" '$1==b{print $2; exit}')
    [ "$st" = MERGED ] || [ "$st" = CLOSED ] || continue
    printf '%s\n' "$cwds" | grep -q "^$w" && continue
    [ -z "$(git -C "$w" status --porcelain --untracked-files=no 2>/dev/null)" ] || continue
    git worktree remove --force "$w" && git branch -D -q "$b" && echo "removed $w ($b, $st)"
  done
  git worktree prune
done
