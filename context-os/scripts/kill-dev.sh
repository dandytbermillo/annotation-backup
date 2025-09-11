#!/usr/bin/env bash
# kill-dev.sh — Kill Next.js dev and free ports in a range.
# Usage:
#   bash context-os/scripts/kill-dev.sh             # defaults to 3000–3010
#   bash context-os/scripts/kill-dev.sh 3000 3010   # custom range
#   bash context-os/scripts/kill-dev.sh -y          # skip confirmation
#
# Environment:
#   YES=1  # same as -y/--yes

set -euo pipefail

PORT_START=3000
PORT_END=3010
YES="${YES:-0}"

# Help/usage output
usage() {
  cat <<'EOF'
- Default range: bash context-os/scripts/kill-dev.sh
- Custom range: bash context-os/scripts/kill-dev.sh 3000 3010
- Auto-confirm: bash context-os/scripts/kill-dev.sh -y
- Optional: make executable with chmod +x context-os/scripts/kill-dev.sh
EOF
}

# Parse args: collect numeric ports; honor -y/--yes anywhere
ports=()
for arg in "$@"; do
  case "$arg" in
    -h|--help|help) usage; exit 0 ;;
    -y|--yes) YES=1 ;;
    ''|*[!0-9]*) ;;  # ignore non-numeric args
    *) ports+=("$arg") ;;
  esac
done

if [ ${#ports[@]} -ge 1 ]; then PORT_START="${ports[0]}"; fi
if [ ${#ports[@]} -ge 2 ]; then PORT_END="${ports[1]}"; fi

echo "Target range: ports ${PORT_START}-${PORT_END}"

find_next_pids() {
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -f "next dev" || true
  else
    ps ax | grep -E "[n]ext .*dev" | awk '{print $1}' || true
  fi
}

find_port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:${PORT_START}-${PORT_END} -sTCP:LISTEN -t 2>/dev/null | sort -u || true
  elif command -v fuser >/dev/null 2>&1; then
    for p in $(seq "${PORT_START}" "${PORT_END}"); do
      fuser -n tcp "$p" 2>/dev/null || true
    done | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -u || true
  else
    echo ""
  fi
}

list_cmds() {
  while read -r pid; do
    [ -n "$pid" ] || continue
    ps -o pid= -o command= -p "$pid" 2>/dev/null || true
  done
}

next_pids="$(find_next_pids || true)"
port_pids="$(find_port_pids || true)"
pids="$(printf "%s\n%s\n" "${next_pids:-}" "${port_pids:-}" | grep -E '^[0-9]+$' | sort -u)"

if [ -z "$pids" ]; then
  echo "Nothing to kill. No 'next dev' or listeners on ${PORT_START}-${PORT_END}."
  exit 0
fi

echo "Processes to terminate:"
echo "$pids" | list_cmds

if [ "$YES" != "1" ]; then
  printf "Proceed to terminate these PIDs? [y/N] "
  read -r ans || true
  ans="$(printf "%s" "${ans:-}" | tr '[:upper:]' '[:lower:]')"
  if [ "$ans" != "y" ] && [ "$ans" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "$pids" | xargs -I{} sh -c 'kill -15 "{}" 2>/dev/null || true'
sleep 1

# Force kill any still-alive PIDs
remaining=""
for pid in $pids; do
  if kill -0 "$pid" 2>/dev/null; then
    remaining="${remaining} $pid"
  fi
done

if [ -n "${remaining// /}" ]; then
  echo "Force killing remaining PIDs: ${remaining}"
  for pid in $remaining; do
    kill -9 "$pid" 2>/dev/null || true
  done
else
  echo "All targeted processes terminated with SIGTERM."
fi

# Final check of port listeners
still_listening="$(find_port_pids || true)"
if [ -n "$still_listening" ]; then
  echo "Warning: still listening on ${PORT_START}-${PORT_END}:"
  echo "$still_listening" | list_cmds
  exit 2
fi

echo "Done."
