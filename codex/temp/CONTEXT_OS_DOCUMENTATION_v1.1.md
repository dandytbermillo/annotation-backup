# Context-OS Documentation (Claude-Hybrid Orchestrator System)

**Version**: 1.1  
**Updated**: 2025-09-04  
**Scope**: Slash command orchestration system using Context-OS agents (JS/TS) with optional Claude integration

---

## Overview

Context-OS is a modular, CLI-based system that allows users to run high-level feature development workflows using intuitive slash commands such as `/context-execute`, `/context-fix`, `/context-validate`, and `/context-features`.

It is designed to be agent-friendly and Claude-integratable, meaning you can trigger both deterministic CLI tools and semantic Claude-based agents from the same command interface. This enables both compliance enforcement (Context-OS) and AI-powered insight (Claude).

---

## Folder Structure

```plaintext
context-os/
├── cli/                       # CLI entry points for each command (Node.js wrappers)
│   ├── execute-cli.js
│   ├── fix-cli.js
│   ├── validate-cli.js
│   ├── context-help.js
│
├── core/                      # Core feature agents
│   ├── create-feature.js
│   ├── fix-workflow.js
│
├── scripts/                   # Bash support scripts
│   ├── features.sh
│   ├── test-sync.sh
│   ├── validate-doc-structure.sh
│
├── slash_commands/           # Markdown-based usage docs for each slash command
│   ├── execute.md
│   ├── fix.md
│   ├── validate.md
│   ├── features.md
│   ├── context-help.md
│
├── utils/                     # Supporting JS utilities
│   ├── show-features.js
│   ├── scan-features.js
│
├── bridge/                    # Planned Claude bridge layer (WIP)
│   ├── bridge.js              # Orchestrator: decides which agent to route to
│   ├── claude-adapter.js      # Interface to Claude’s Task/Web tools
│   ├── types.ts               # Shared interface types and schemas
│
└── README.md                  # Overview and command usage
```

---

## Command Workflows

### `/context-execute <feature>`

**Purpose**: Scaffold a new compliant feature folder.

**Runs:**
- `cli/execute-cli.js`
  → calls
- `core/create-feature.js`

**What it does:**
- Creates `docs/proposal/<feature>/`
- Adds:
  - `Implementation-Plan.md`
  - `reports/`
  - `post-implementation-fixes/`
  - `patches/README.md`
- Follows `DOCUMENTATION_PROCESS_GUIDE.md v1.4.5`
- Optionally runs validator

---

### `/context-fix --feature <slug> --issue "desc"`

**Purpose**: Add a fix document classified by severity.

**Runs:**
- `cli/fix-cli.js`
  → calls
- `core/fix-workflow.js`

**What it does:**
- Calls classifier
- Generates Markdown fix doc
- Adds to severity folder
- Optionally generates patch

**Planned Hybrid Flow**:
- Claude Task tool is triggered to analyze issue
- Context-OS classifies + applies structured fix

---

### `/context-validate`

**Purpose**: Check if a feature complies with the documentation process guide.

**Runs:**
- `cli/validate-cli.js`
  → runs
- `scripts/validate-doc-structure.sh`

**What it checks:**
- Required directories
- TOC phase boundary
- README existence
- Fix folder structure
- Deprecated paths
- Patch file names

Outputs `❌` and `⚠️` counts per feature.

---

### `/context-features`

**Purpose**: Show list of features and their validation status.

**Runs:**
- `scripts/features.sh`
  → uses
- `utils/show-features.js`
  → calls
- `utils/scan-features.js`

**What it outputs:**
- Feature name
- Status (✅, ❌, 🚧)
- Error/warning counts
- Next actions

---

## Hybrid Architecture (Claude + Context-OS)

Planned Claude integration enables:
- `/analyze` → Claude scans code for patterns/issues
- `/review` → Parallel Claude + Context validator
- `/migrate` → Claude proposes structure; Context executes

This is done through:
- `bridge/bridge.js`: decides routing (Claude, Context, or Hybrid)
- `bridge/claude-adapter.js`: wraps Claude agent calls
- `bridge/types.ts`: standard request/response schema

---

## Command → Agent Map

| Slash Command        | Claude Involved? | Context Agent                  | Claude Agent (Planned)       |
|----------------------|------------------|--------------------------------|-------------------------------|
| `/context-execute`   | ❌               | `create-feature.js`            | —                             |
| `/context-fix`       | ✅ (Planned)     | `fix-workflow.js`              | Task tool (analysis)          |
| `/context-validate`  | ❌               | `validate-doc-structure.sh`    | —                             |
| `/context-features`  | ❌               | `scan-features.js`             | —                             |
| `/review`            | ✅               | `validate-doc-structure.sh`    | Task tool                     |
| `/analyze`           | ✅               | —                              | Task tool, WebSearch          |
| `/migrate`           | ✅               | `create-feature.js`, `fix-workflow.js` | Task tool             |

---

## Execution Principles

- 📦 All write actions are **patch-first** unless `--apply` is passed.
- 🛡 Claude integration uses **mock-mode by default** for safety.
- 🔄 Commands route through `command-router.js` → bridge → agent.
- 🧪 Validator re-run happens after every fix.
- 🧾 Telemetry and logs are emitted via `JSONL`.

---

## Example Slash Flow: `/context-fix`

1. User runs:  
   `/context-fix --feature onboarding-flow --issue "does not persist toggle state"`

2. System:
   - Calls Claude (mock) to analyze pattern
   - Calls classifier to assign severity
   - Writes fix doc into:
     `docs/proposal/onboarding-flow/post-implementation-fixes/high/2024-09-01-toggle-state.md`
   - Emits patch
   - Re-runs validator
   - Returns patch + diff preview

---

## Summary

Context-OS provides a scalable, slash-command driven automation system for documentation-compliant development. Its hybrid Claude+CLI architecture allows for intelligent suggestions backed by deterministic structure enforcement.

**Designed for:**
- Patch-first workflows
- Documentation governance
- Agent chaining
- Intelligent automation (via Claude)

Ready for CI/CD, developer CLI use, and LLM-driven orchestration.

