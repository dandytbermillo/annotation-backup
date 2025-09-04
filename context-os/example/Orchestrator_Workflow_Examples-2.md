# Orchestrator Workflow Examples (Combined Agents + /Commands)

**Version**: 2.0  
**Updated**: 2025-09-04  
**Mode**: Claude Code with Built-in + Custom JS/TS Agents  
**Trigger Format**: Slash commands (`/command`)

---

## Overview

This document shows how to invoke powerful workflows in Claude Code using simplified `/command` syntax that routes to:

- ✅ **Built-in Claude Code agents** (e.g. Fixer, Executor, Verifier)
- ✅ **Custom TypeScript/JavaScript agents** (`plan-filler.ts`, `verifier.ts`, `classifier-agent.js`, etc.)
- ✅ **Unified Orchestration Layer** (`orchestrator.ts`)

Behind the scenes, your command triggers a multi-agent plan where each step can use built-in or user-defined agents — seamlessly.

---

## 🧠 Slash Command Format

```bash
/execute <feature> [--strict]
/fix <thing>
/verify <thing>
/classify <doc>
```

---

## 1. Implementation Kickoff

```bash
/execute postgres-persistence
```

### 🔧 Under the Hood:
| Step | Agent Used | Type |
|------|------------|------|
| 1. Load plan for `postgres-persistence` | `plan-filler.ts` | Custom TS |
| 2. Generate files if missing | Claude Code Generator | Built-in |
| 3. Check directory structure | `verifier.ts` | Custom TS |
| 4. Fix violations | Claude Fixer + patches | Built-in + CLI Patch |
| 5. Confirm readiness to commit | Claude Approver | Built-in |

✅ *Result*: Fully scaffolded, validated, and documented feature folder.

---

## 2. Fix Documentation Structure

```bash
/fix doc structure
```

### 🔧 Under the Hood:
| Step | Agent Used | Type |
|------|------------|------|
| 1. Run `validate-doc-structure.sh` | CLI (Bash) | External |
| 2. Parse report and classify issues | `classifier-agent.js` | Custom JS |
| 3. Auto-migrate deprecated paths | Claude Fixer | Built-in |
| 4. Add missing files (README.md, reports/) | `plan-filler.ts` | Custom TS |
| 5. Apply patches | `patches/` loader | Built-in or CLI |

✅ *Result*: Project aligns with DOCUMENTATION_PROCESS_GUIDE.md v1.4.5.

---

## 3. Verify Plan–Report Relationship

```bash
/verify plan interval_free_batch_cleanup
```

### 🔧 Under the Hood:
| Step | Agent Used | Type |
|------|------------|------|
| 1. Extract plan and report from folder | `verifier.ts` | Custom TS |
| 2. Check naming and linking rules | `verifier.ts` | Custom TS |
| 3. Suggest improvements | Claude Agent | Built-in |

✅ *Result*: Implementation Plan and Report pass structural validation.

---

## 4. Classify Bug Fix Severity

```bash
/classify docs/proposal/myfeature/post-implementation-fixes/high/2025-09-03-bug.md
```

### 🔧 Under the Hood:
| Step | Agent Used | Type |
|------|------------|------|
| 1. Parse bug fix file | Claude + `classifier-agent.js` | Built-in + Custom |
| 2. Apply objective thresholds | `verifier.ts` | Custom TS |
| 3. Output: Final Severity, Justification | LLM Summary | Built-in |

✅ *Result*: Fix classification is confirmed or corrected with explanation.

---

## 5. Generate Patch for Risky Changes

```bash
/fix add-patch for interval_free_batch_cleanup
```

### 🔧 Under the Hood:
| Step | Agent Used | Type |
|------|------------|------|
| 1. Detect risky or manual edits | Claude Analyzer | Built-in |
| 2. Convert to `git format-patch` | Custom Shell Wrapper | Custom |
| 3. Save in `patches/YYYY-MM-DD-desc.patch` | Orchestrator | Custom |
| 4. Link in main report | Claude Writer | Built-in |

✅ *Result*: Patch created, linked, and documented with README.

---

## Summary

| Command | Use Case | Agents Used |
|---------|----------|-------------|
| `/execute <feature>` | Create full implementation from plan | Built-in + TS |
| `/fix doc structure` | Align with doc guide v1.4.5 | Built-in + Shell + JS |
| `/verify plan <feature>` | Validate plan-report pairing | TS |
| `/classify <fix.md>` | Apply objective severity | JS + TS |
| `/fix add-patch` | Auto-create + link patch | Built-in + TS |

---

## Notes

- All commands are **agent-driven**, not monolithic scripts.
- Each agent focuses on one task (analysis, validation, patching, etc.)
- Orchestrator (`orchestrator.ts`) maps command → plan → agent pipeline.
- Built-in Claude agents handle language tasks; custom agents handle logic, parsing, and project rules.

---

*For details on each custom agent, see: `classifier-agent.js`, `verifier.ts`, `plan-filler.ts`, `orchestrator.ts`*
