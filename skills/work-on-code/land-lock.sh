#!/bin/sh
# The landing lock (work-on-code, verdict step 6): one PR lands at a time per repository and area, all worktrees included.
#   land-lock.sh take [area...]   wait for each area's lock (none: the whole repo's), in sorted order, then hold them for this branch
#   land-lock.sh drop [area...]   release them (only the branch holding a lock can)
# A lock older than LAND_LOCK_STALE minutes (default 90) was abandoned and is taken over. The lock only saves wasted
# catch-ups: the gate's behind-base check, not this lock, keeps a landing correct.
# ponytail: the whole repo's lock and an area's don't exclude each other; a repo that names areas always passes one.
set -eu
common=$(git rev-parse --path-format=absolute --git-common-dir)
repo="${TMPDIR:-/tmp}/work-on-code-land-$(printf %s "$common" | cksum | cut -d' ' -f1)"
me=$(git rev-parse --abbrev-ref HEAD)
op=${1:-}
[ $# -gt 0 ] && shift
for area in "$@"; do
  case "$area" in "" | *[!A-Za-z0-9._-]*) echo "land-lock: bad area '$area' (letters, digits, . _ -)" >&2; exit 2 ;; esac
done
holder() { cat "$lock/branch" 2>/dev/null || true; }
take() {
  until mkdir "$lock" 2>/dev/null; do
    [ "$(holder)" = "$me" ] && return 0
    if [ -n "$(find "$lock" -maxdepth 0 -mmin "+${LAND_LOCK_STALE:-90}" 2>/dev/null)" ]; then
      echo "land-lock: taking over a stale lock from $(holder)" >&2
      rm -rf "$lock" # ponytail: two takers of one stale lock can race; the gate's behind check still holds
      continue
    fi
    echo "land-lock: $(holder) is landing${area:+ in $area}; waiting" >&2
    sleep "${LAND_LOCK_POLL:-30}"
  done
  echo "$me" >"$lock/branch"
}
drop() {
  [ -d "$lock" ] || return 0
  [ "$(holder)" = "$me" ] || { echo "land-lock: held by $(holder), not $me" >&2; exit 1; }
  rm -rf "$lock"
}
case "$op" in take | drop) ;; *) echo "usage: land-lock.sh take|drop [area...]" >&2; exit 2 ;; esac
# Sorted, so two branches spanning the same areas never wait on each other in a cycle; no area is the whole repo.
for area in $(printf '%s\n' "$@" | sort -u); do
  lock="$repo-$area"
  "$op"
done
[ $# -gt 0 ] || { area="" lock="$repo"; "$op"; }
