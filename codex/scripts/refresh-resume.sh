#!/usr/bin/env bash
set -euo pipefail

SESS_DIR="codex/previous-sessions"
PATCH_DIR="codex/patches"
RESUME="${SESS_DIR}/RESUME.md"

# Find latest file matching a glob pattern; returns empty on no match
latest_file() {
  # shellcheck disable=SC2086
  ls -1 $1 2>/dev/null | sort | tail -n1 || true
}

LATEST_EXEC=$(latest_file "${SESS_DIR}"/*-exec-summary.md)
LATEST_SESS=$(latest_file "${SESS_DIR}"/*-session-summary.md)

if [[ -z "${LATEST_EXEC}" && -z "${LATEST_SESS}" ]]; then
  echo "[refresh-resume] No session files found under ${SESS_DIR}" >&2
  exit 0
fi

# Extract “Next Suggested Steps” from latest session summary, if present
NEXT_STEPS=""
if [[ -n "${LATEST_SESS}" ]]; then
  NEXT_STEPS=$(awk '/^## Next Suggested Steps/{flag=1; next} /^## /{flag=0} flag{print}' "${LATEST_SESS}" | sed '/^[[:space:]]*$/d' || true)
fi

# Collect recent patches (last 10)
RECENT_PATCHES=$(ls -1 "${PATCH_DIR}"/*.patch 2>/dev/null | sort | tail -n 10 || true)

{
  echo "# Resume Here"
  echo
  echo "- Latest summaries:"
  [[ -n "${LATEST_EXEC}" ]] && echo "  - Executive: ${LATEST_EXEC}"
  [[ -n "${LATEST_SESS}" ]] && echo "  - Session: ${LATEST_SESS}"
  echo
  echo "- Next steps:"
  if [[ -n "${NEXT_STEPS}" ]]; then
    echo "${NEXT_STEPS}" | sed 's/^/- /'
  else
    echo "  - <add items under \"## Next Suggested Steps\" in the latest session summary>"
  fi
  echo
  echo "- Recent patches added:"
  if [[ -n "${RECENT_PATCHES}" ]]; then
    echo "${RECENT_PATCHES}" | sed 's/^/- /'
  else
    echo "  - <none yet>"
  fi
  echo
  echo "- Tips:"
  echo "  - Run \`codex/scripts/bench-api.sh\` to baseline key endpoints."
  echo
  echo "Updated by \`codex/scripts/refresh-resume.sh\`."
} > "${RESUME}"

echo "[refresh-resume] Updated ${RESUME}"

