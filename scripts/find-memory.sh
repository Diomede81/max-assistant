#!/usr/bin/env bash
# Finds Max's memory stores on this machine and can bring an old one back.
#   ./scripts/find-memory.sh                 list every store and what's in it
#   ./scripts/find-memory.sh restore NAME    copy store NAME into the one Max uses now
# Why: before the store had a fixed name, Docker made a separate, empty one for each folder
# name (e.g. "max-assistant" vs a fresh download "max-assistant-main"), so Max looked like
# he had forgotten everything. Nothing is deleted by this script.
set -euo pipefail
CURRENT=max-assistant_max-data
peek() { docker run --rm -v "$1":/d:ro busybox sh -c 'cd /d && for f in *.vault *.json memory.key; do [ -f "$f" ] && echo "    $(date -r "$f" "+%Y-%m-%d %H:%M")  $(wc -c < "$f" | tr -d " ") bytes  $f"; done; true'; }

if [[ "${1:-}" == "restore" ]]; then
  from="${2:?Give the name of the store to restore, from the list}"
  [[ "$from" == "$CURRENT" ]] && { echo "That is already the store Max uses."; exit 0; }
  docker volume inspect "$from" >/dev/null 2>&1 || { echo "No store called $from."; exit 1; }
  backup="${CURRENT}-backup-$(date +%Y%m%d-%H%M%S)"
  echo "Stopping Max..."
  docker ps -q --filter "volume=$CURRENT" | xargs -r docker stop >/dev/null
  echo "Keeping a copy of the current store as $backup..."
  docker volume create "$backup" >/dev/null
  docker run --rm -v "$CURRENT":/from:ro -v "$backup":/to busybox sh -c 'cp -a /from/. /to/ 2>/dev/null; true'
  echo "Copying $from into $CURRENT..."
  docker volume create "$CURRENT" >/dev/null
  docker run --rm -v "$from":/from:ro -v "$CURRENT":/to busybox sh -c 'cp -a /from/. /to/ && chown -R 1000:1000 /to'
  echo "Done. Start Max again (docker compose up -d) and check the control panel's Memory section."
  echo "If memory.key is not in the store, MEMORY_KEY in .env must be the one used back then."
  exit 0
fi

echo "Max uses: $CURRENT"
found=0
for v in $(docker volume ls -q | grep -E 'max-data' || true); do
  found=1
  [[ "$v" == "$CURRENT" ]] && echo "  $v   <- in use" || echo "  $v"
  peek "$v"
done
[[ $found == 0 ]] && echo "No memory stores found yet."
echo
echo "The .vault files hold the memories (newest date = most recent). To bring one back:"
echo "  ./scripts/find-memory.sh restore NAME"
