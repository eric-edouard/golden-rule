#!/bin/sh
# The landing lock (work-on-code, verdict step 6): one PR lands at a time per repository and area, all worktrees included.
#   land-lock.sh take [area...]   wait for each area's lock (none: the whole repo's), in sorted order, then hold them for this branch
#   land-lock.sh drop [area...]   release them (only the branch holding a lock can)
#   land-lock.sh holds            exit 0 when this branch holds a live lock of this repo (any area): it is landing
# LAND_LOCK_PID (land.ts passes its own) is kept beside the branch: once that process is gone, the lock is taken over at
# once. Any lock older than LAND_LOCK_STALE minutes (default 90) was abandoned and is taken over. The lock only saves wasted
# catch-ups: the gate's behind-base check keeps a landing correct, except that PRs of different areas may merge without
# testing each other (the trade areas make). Areas are case-folded (Phone is phone).
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
    [ "$(holder)" = "$me" ] && break
    pid=$(cat "$lock/pid" 2>/dev/null || true)
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      echo "land-lock: taking over from $(holder): its process $pid is gone" >&2
      rm -rf "$lock" # ponytail: two takers can race here too, as below
      continue
    fi
    if [ -n "$(find "$lock" -maxdepth 0 -mmin "+${LAND_LOCK_STALE:-90}" 2>/dev/null)" ]; then
      echo "land-lock: taking over a stale lock from $(holder)" >&2
      rm -rf "$lock" # ponytail: two takers of one stale lock can race; the gate's behind check still holds
      continue
    fi
    echo "land-lock: $(holder) is landing${area:+ in $area} (process ${pid:-not recorded}${pid:+, alive}); waiting" >&2
    sleep "${LAND_LOCK_POLL:-30}"
  done
  echo "$me" >"$lock/branch"
  rm -f "$lock/pid"
  [ -z "${LAND_LOCK_PID:-}" ] || echo "$LAND_LOCK_PID" >"$lock/pid"
}
drop() {
  [ -d "$lock" ] || return 0
  [ "$(holder)" = "$me" ] || { echo "land-lock: held by $(holder), not $me" >&2; failed=1; return 0; }
  rm -rf "$lock"
}
if [ "$op" = holds ]; then
  for lock in "$repo" "$repo"-*; do
    [ "$(holder)" = "$me" ] || continue
    pid=$(cat "$lock/pid" 2>/dev/null || true)
    { [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; } && continue # its landing process is gone
    [ -n "$(find "$lock" -maxdepth 0 -mmin "+${LAND_LOCK_STALE:-90}" 2>/dev/null)" ] && continue # abandoned
    exit 0
  done
  exit 1
fi
failed=0
case "$op" in take | drop) ;; *) echo "usage: land-lock.sh take|drop [area...] | holds" >&2; exit 2 ;; esac
# Sorted, so two branches spanning the same areas never wait on each other in a cycle; no area is the whole repo.
for area in $(printf '%s\n' "$@" | tr 'A-Z' 'a-z' | LC_ALL=C sort -u); do
  lock="$repo-$area"
  "$op"
done
[ $# -gt 0 ] || { area="" lock="$repo"; "$op"; }
exit "$failed"
