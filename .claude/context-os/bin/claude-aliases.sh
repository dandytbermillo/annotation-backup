#!/bin/bash

# Context OS - Claude Command Aliases
# This file provides shell aliases that mimic Claude commands
# Source this file in your shell: source claude-aliases.sh

# Get the context OS root directory
CONTEXT_OS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."; pwd)"

# Core context commands
alias '/context'='node "$CONTEXT_OS_ROOT/bin/context"'
alias '/context-load'='node "$CONTEXT_OS_ROOT/bin/context" load'
alias '/context-learn'='node "$CONTEXT_OS_ROOT/bin/context" learn'
alias '/context-search'='node "$CONTEXT_OS_ROOT/bin/context" search'
alias '/context-status'='node "$CONTEXT_OS_ROOT/bin/context" status'

# Task management commands
alias '/task'='node "$CONTEXT_OS_ROOT/core/task-manager.js"'
alias '/task-new'='node "$CONTEXT_OS_ROOT/core/task-manager.js" new'
alias '/task-switch'='node "$CONTEXT_OS_ROOT/core/task-manager.js" switch'
alias '/task-complete'='node "$CONTEXT_OS_ROOT/core/task-manager.js" complete'
alias '/task-list'='node "$CONTEXT_OS_ROOT/core/task-manager.js" list'

# Knowledge management
alias '/learn'='context_learn'
alias '/search'='context_search'
alias '/knowledge'='node "$CONTEXT_OS_ROOT/bin/knowledge-cli.js"'

# Team collaboration
alias '/team-enable'='node "$CONTEXT_OS_ROOT/team/team-sync.js" enable'
alias '/team-sync'='node "$CONTEXT_OS_ROOT/team/team-sync.js" sync'
alias '/share'='node "$CONTEXT_OS_ROOT/team/team-sync.js" share'
alias '/pull'='node "$CONTEXT_OS_ROOT/team/team-sync.js" pull'

# Analysis and optimization
alias '/analyze'='node "$CONTEXT_OS_ROOT/core/enhancement-advisor.js" analyze'
alias '/suggest'='node "$CONTEXT_OS_ROOT/core/enhancement-advisor.js" status'
alias '/optimize'='node "$CONTEXT_OS_ROOT/core/token-optimizer.js" load'

# Quick functions
context_learn() {
    if [ -z "$1" ]; then
        echo "Usage: /learn <knowledge>"
        return 1
    fi
    node "$CONTEXT_OS_ROOT/bin/context" learn "$@"
}

context_search() {
    if [ -z "$1" ]; then
        echo "Usage: /search <query>"
        return 1
    fi
    node "$CONTEXT_OS_ROOT/bin/context" search "$@"
}

# Claude-compatible commands for VSCode/editor integration
context_command() {
    local action="$1"
    shift
    
    case "$action" in
        "load")
            node "$CONTEXT_OS_ROOT/core/token-optimizer.js" load "$@"
            ;;
        "learn")
            context_learn "$@"
            ;;
        "search")
            context_search "$@"
            ;;
        "status")
            node "$CONTEXT_OS_ROOT/bin/context" status
            ;;
        *)
            echo "Unknown context action: $action"
            echo "Available: load, learn, search, status"
            return 1
            ;;
    esac
}

task_command() {
    local action="$1"
    shift
    
    case "$action" in
        "new")
            node "$CONTEXT_OS_ROOT/core/task-manager.js" new "$@"
            ;;
        "switch")
            node "$CONTEXT_OS_ROOT/core/task-manager.js" switch "$@"
            ;;
        "complete")
            node "$CONTEXT_OS_ROOT/core/task-manager.js" complete
            ;;
        "merge")
            # Merge task learnings
            local task_id="$1"
            if [ -z "$task_id" ]; then
                echo "Usage: task merge <task-id>"
                return 1
            fi
            node "$CONTEXT_OS_ROOT/workflows/merge-task-knowledge.js" "$task_id"
            ;;
        *)
            echo "Unknown task action: $action"
            echo "Available: new, switch, complete, merge"
            return 1
            ;;
    esac
}

# Export functions for use in scripts
export -f context_command
export -f task_command
export -f context_learn
export -f context_search

# Add context bin to PATH
export PATH="$CONTEXT_OS_ROOT/bin:$PATH"

echo "Context OS aliases loaded. Available commands:"
echo "  /context [load|learn|search|status]"
echo "  /task [new|switch|complete|list]"
echo "  /team-enable, /team-sync, /share, /pull"
echo "  /analyze, /suggest, /optimize"
echo "  /learn <knowledge>"
echo "  /search <query>"