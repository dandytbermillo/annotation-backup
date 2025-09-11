#!/usr/bin/env bash
# main.sh — Simple interactive menu for common tasks
#
# Menu:
#  [1] - kill open server or ports               ## will execute the bash context-os/scripts/kill-dev.sh --help
#  [2] - git-commit-and-push        ## bash context-os/scripts/git-commit-and-push.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_menu() {
  cat <<'EOF'
Available actions:
 [1] - kill open server or ports               ## will execute the bash context-os/scripts/kill-dev.sh --help
 [2] - git-commit-and-push        ## bash context-os/scripts/git-commit-and-push.sh

Select an option (1-2), or 'q' to quit:
EOF
}

usage() {
  cat <<'EOF'
Usage:
  bash context-os/scripts/main.sh

Menu entries:
 [1] - kill open server or ports               ## will execute the bash context-os/scripts/kill-dev.sh --help
 [2] - git-commit-and-push        ## bash context-os/scripts/git-commit-and-push.sh
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || "${1:-}" == "help" ]]; then
  usage
  exit 0
fi

print_menu
read -r choice || true

case "${choice:-}" in
  1)
    echo "Running: bash context-os/scripts/kill-dev.sh --help"
    bash "$SCRIPT_DIR/kill-dev.sh" --help
    ;;
  2)
    echo "Running: bash context-os/scripts/git-commit-and-push.sh"
    bash "$SCRIPT_DIR/git-commit-and-push.sh"
    ;;
  q|Q|quit|exit|'')
    echo "Aborted."
    exit 0
    ;;
  *)
    echo "Invalid option: ${choice}"
    exit 1
    ;;
esac
