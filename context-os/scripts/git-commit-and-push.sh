#!/usr/bin/env bash
# git-commit-and-push.sh — Assist committing and pushing to origin/main
# Steps:
#   1) Show branches (git branch)
#   2) Ask to continue (y/n); abort on 'n' or empty
#   3) git add .
#   4) Prompt: "please enter your commit message."; abort if empty
#   5) git commit -m "<commit message>"
#   6) git push origin main ("update origin main")

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel)"

cd "${ROOT_DIR}"

# Ensure we're inside a git repository
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: Not inside a git repository."
  exit 1
fi

echo "Listing branches (current marked with *):"
git branch || { echo "Error: failed to list branches."; exit 1; }

printf "Continue? [y/N] "
read -r continue_ans || true
continue_ans="$(printf "%s" "${continue_ans:-}" | tr '[:upper:]' '[:lower:]')"
if [ "${continue_ans}" != "y" ] && [ "${continue_ans}" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo "Staging changes: git add ."
git add .

# Prompt for commit message
printf "Please enter your commit message: "
IFS= read -r commit_msg || true

# Abort if empty (ignore whitespace-only)
trimmed="${commit_msg//[[:space:]]/}"
if [ -z "${trimmed}" ]; then
  echo "Aborted: commit message cannot be empty."
  exit 1
fi

echo "Committing: git commit -m \"$commit_msg\""
git commit -m "$commit_msg" || {
  echo "Commit failed. Ensure there are staged changes."
  exit 1
}

echo "Pushing to origin main (updating remote main)"
git push origin main

echo "Done."
