#!/usr/bin/env bash
# Continuously save the whole project to GitHub.
#
#   tools/autosave.sh [interval-seconds] [history-every-n-cycles]
#
# Every interval (default 30 s) it commits any change in the repository and pushes
# the current branch; every n-th cycle (default 4, i.e. every 2 minutes) it first
# refreshes history/ (chat + agent transcripts) with tools/export-history.py.
# A lock file keeps it from colliding with manual commits that use the same lock:
#   ( flock 9; git ... ) 9>.git/autosave.lock
set -u
cd "$(dirname "$0")/.."
INTERVAL=${1:-30}
HIST_EVERY=${2:-4}
BRANCH=$(git rev-parse --abbrev-ref HEAD)
n=0
while true; do
  if (( n % HIST_EVERY == 0 )); then
    python3 -I tools/export-history.py >/dev/null 2>&1 || echo "history export failed $(date -u +%T)"
  fi
  n=$((n + 1))
  (
    flock -w 120 9 || exit 0
    if [ -n "$(git status --porcelain)" ]; then
      changed=$(git status --porcelain | wc -l)
      git add -A >/dev/null 2>&1
      git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "Auto-save $(date -u +%Y-%m-%dT%H:%M:%SZ): ${changed} changed paths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ssnf7nmuGp9qqM2614i8MH" || echo "commit failed $(date -u +%T)"
    fi
    ahead=$(git rev-list --count "@{u}..HEAD" 2>/dev/null || echo 1)
    if [ "$ahead" != "0" ]; then
      for i in 1 2 3 4; do
        if git push -q -u origin "$BRANCH" >/dev/null 2>&1; then
          echo "pushed $(git rev-parse --short HEAD) at $(date -u +%T)"
          break
        fi
        sleep $((2 ** i))
      done
    fi
  ) 9>.git/autosave.lock
  sleep "$INTERVAL"
done
