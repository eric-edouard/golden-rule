#!/bin/sh
# The landing lock (work-on-code, verdict step 6): one PR lands at a time per repository, all worktrees included.
#   land-lock.sh take   wait for the lock, then hold it for this branch
#   land-lock.sh drop   release it (only the branch holding it can)
# A lock older than LAND_LOCK_STALE minutes (default 90) was abandoned and is taken over. The lock only saves wasted
# catch-ups: the gate's behind-base check, not this lock, keeps a landing correct.
set -eu
common=$(git rev-parse --path-format=absolute --git-common-dir)
lock="${TMPDIR:-/tmp}/work-on-code-land-$(printf %s "$common" | cksum | cut -d' ' -f1)"
me=$(git rev-parse --abbrev-ref HEAD)
holder() { cat "$lock/branch" 2>/dev/null || true; }
case "${1:-}" in
take)
  until mkdir "$lock" 2>/dev/null; do
    [ "$(holder)" = "$me" ] && exit 0
    if [ -n "$(find "$lock" -maxdepth 0 -mmin "+${LAND_LOCK_STALE:-90}" 2>/dev/null)" ]; then
      echo "land-lock: taking over a stale lock from $(holder)" >&2
      rm -rf "$lock" # ponytail: two takers of one stale lock can race; the gate's behind check still holds
      continue
    fi
    echo "land-lock: $(holder) is landing; waiting" >&2
    sleep "${LAND_LOCK_POLL:-30}"
  done
  echo "$me" >"$lock/branch"
  ;;
drop)
  [ -d "$lock" ] || exit 0
  [ "$(holder)" = "$me" ] || { echo "land-lock: held by $(holder), not $me" >&2; exit 1; }
  rm -rf "$lock"
  ;;
*) echo "usage: land-lock.sh take|drop" >&2; exit 2 ;;
esac
