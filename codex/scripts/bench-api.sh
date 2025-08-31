#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000/api}"
OUT_DIR="${OUT_DIR:-./codex/benchout}"
mkdir -p "$OUT_DIR"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

curl_timing() {
  local url="$1"
  local method="${2:-GET}"
  local data="${3:-}"
  local name="$4"

  local outfile="$OUT_DIR/${name}.json"
  local timefile="$OUT_DIR/${name}.time"

  if [[ -n "$data" ]]; then
    curl -sS -X "$method" \
      -H 'Content-Type: application/json' \
      -w '{"name":"%s","status":%{http_code},"time_total":%{time_total},"size":%{size_download},"ts":"%s"}\n' \
      -o "$outfile" \
      --data "$data" \
      "$url" \
      | awk -v n="$name" -v t="$(ts)" '{printf $0, n, t}' > "$timefile"
  else
    curl -sS -X "$method" \
      -w '{"name":"%s","status":%{http_code},"time_total":%{time_total},"size":%{size_download},"ts":"%s"}\n' \
      -o "$outfile" \
      "$url" \
      | awk -v n="$name" -v t="$(ts)" '{printf $0, n, t}' > "$timefile"
  fi
}

echo "[bench] API_BASE=$API_BASE"

# Health
curl_timing "$API_BASE/health" GET "" health

# Search (documents, small result set)
curl_timing "$API_BASE/search?q=test&type=documents&limit=5" GET "" search_documents

# Fuzzy search with explicit threshold
curl_timing "$API_BASE/search?q=tets&type=fuzzy&similarity=0.45&limit=5" GET "" search_fuzzy

# Versions (cold call likely 404; measure anyway)
NOTE_ID="00000000-0000-0000-0000-000000000000"
PANEL_ID="00000000-0000-0000-0000-000000000000"
curl_timing "$API_BASE/versions/$NOTE_ID/$PANEL_ID" GET "" versions_list

# Queue flush (no-ops body)
curl_timing "$API_BASE/postgres-offline/queue/flush" POST '{"operations":[]}' queue_flush

echo "[bench] Results written to $OUT_DIR" >&2

