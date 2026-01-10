# Question-First Routing + Notes Context - Implementation Index

**Feature:** Question-First Routing + Notes Context
**Status:** COMPLETED
**Date Range:** 2026-01-07 to 2026-01-08
**Last Updated:** 2026-01-08

---

## Overview

This feature enables conversational question-style inputs in chat navigation, provides scope-aware answers for notes questions, and establishes widgetStates as the single source of truth for dashboard/workspace state reporting.

---

## Document Hierarchy

```
docs/proposal/chat-navigation/
│
├── INDEX-question-first-routing-notes-context.md  ← YOU ARE HERE
│
└── plan/panels/widget_manager/widget_chat_state_contract_implementation_plan/
    │
    ├── question-first-routing-notes-context-plan.md     [MASTER PLAN]
    │   ├── Phase 1: Question-First Bypass
    │   ├── Phase 1a: Error Message Preservation
    │   ├── Phase 1b: Last Action Formatting
    │   ├── Phase 2: Notes Scope Clarification
    │   ├── Phase 2a: Clarification "Yes" Handling
    │   │   ├── Phase 2a.1: Label Matching
    │   │   ├── Phase 2a.2: Pending-Options Guard
    │   │   ├── Phase 2a.3: LLM Interpretation
    │   │   └── Phase 2a.4: Explanation Requests
    │   ├── Phase 2b: Verb + Ordinal Selection
    │   ├── Phase 3: Open Notes Source of Truth
    │   └── Phase 4: Dashboard/Workspace State Reporting
    │
    ├── phase4-small-risk-fixes-plan.md                  [SUB-PLAN]
    │   ├── Fix 1: widgetId-based filtering
    │   └── Fix 2: Clarification routing order
    │
    ├── report/                                          [REPORTS]
    │   ├── 2026-01-07-phase2a-clarification-yes-handling-report.md
    │   ├── 2026-01-07-phase2b-verb-ordinal-selection-report.md
    │   ├── 2026-01-08-phase4-widgetstates-reporting-report.md
    │   └── 2026-01-08-phase4-small-risk-fixes-report.md
    │
    └── note/                                            [ANALYSIS]
        └── 2026-01-08-phase3-open-notes-source-of-truth-analysis.md

codex/patches/                                           [PATCHES]
├── 2026-01-07-phase3-open-notes-source-of-truth.patch
├── 2026-01-07-phase3-open-notes-source-of-truth-option-a.patch
├── 2026-01-07-phase4-widgetstates-solid.patch
└── 2026-01-07-phase4-dashboard-filter-workspace-widgetstates.patch
```

### Phase → Report Mapping

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MASTER PLAN                                        │
│              question-first-routing-notes-context-plan.md                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│   Phase 2a    │           │   Phase 2b    │           │   Phase 3     │
│ Clarification │           │ Verb+Ordinal  │           │  Open Notes   │
│  Yes Handling │           │  Selection    │           │ Source/Truth  │
└───────┬───────┘           └───────┬───────┘           └───────┬───────┘
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│    REPORT     │           │    REPORT     │           │   ANALYSIS    │
│  2026-01-07   │           │  2026-01-07   │           │   2026-01-08  │
│   phase2a-    │           │   phase2b-    │           │    phase3-    │
│ clarification │           │ verb-ordinal  │           │  open-notes   │
└───────────────┘           └───────────────┘           └───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │          Phase 4              │
                    │  WidgetStates Reporting       │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │                               │
                    ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐
        │      REPORT       │           │     SUB-PLAN      │
        │    2026-01-08     │           │   phase4-small-   │
        │ phase4-widgetstates│          │  risk-fixes-plan  │
        └───────────────────┘           └─────────┬─────────┘
                                                  │
                                                  ▼
                                      ┌───────────────────┐
                                      │      REPORT       │
                                      │    2026-01-08     │
                                      │ phase4-small-risk │
                                      │      -fixes       │
                                      └───────────────────┘
```

---

## Master Plan

| Document | Path |
|----------|------|
| **Main Plan** | `plan/panels/widget_manager/widget_chat_state_contract_implementation_plan/question-first-routing-notes-context-plan.md` |
| **Phase 4 Small-Risk Fixes Plan** | `plan/panels/widget_manager/widget_chat_state_contract_implementation_plan/phase4-small-risk-fixes-plan.md` |

---

## Implementation Reports

| Phase | Date | Report |
|-------|------|--------|
| Phase 2a | 2026-01-07 | `plan/panels/widget_manager/widget_chat_state_contract_implementation_plan/report/2026-01-07-phase2a-clarification-yes-handling-report.md` |
| Phase 2b | 2026-01-07 | `plan/panels/widget_manager/widget_chat_state_contract_implementation_plan/report/2026-01-07-phase2b-verb-ordinal-selection-report.md` |
| Phase 4 | 2026-01-08 | `plan/panels/widget_manager/widget_chat_state_contract_implementation_plan/report/2026-01-08-phase4-widgetstates-reporting-report.md` |
| Phase 4 Fixes | 2026-01-08 | `plan/panels/widget_manager/widget_chat_state_contract_implementation_plan/report/2026-01-08-phase4-small-risk-fixes-report.md` |

---

## Analysis Notes

| Topic | Date | Note |
|-------|------|------|
| Phase 3 Analysis | 2026-01-08 | `plan/panels/widget_manager/widget_chat_state_contract_implementation_plan/note/2026-01-08-phase3-open-notes-source-of-truth-analysis.md` |

---

## Related Patches

| Patch | Date | Description |
|-------|------|-------------|
| `2026-01-07-phase3-open-notes-source-of-truth.patch` | 2026-01-07 | Phase 3 open notes source of truth |
| `2026-01-07-phase3-open-notes-source-of-truth-option-a.patch` | 2026-01-07 | Phase 3 Option A implementation |
| `2026-01-07-phase4-widgetstates-solid.patch` | 2026-01-07 | Phase 4 widgetStates solid implementation |
| `2026-01-07-phase4-dashboard-filter-workspace-widgetstates.patch` | 2026-01-07 | Phase 4 dashboard filtering for workspace widgetStates |

**Patch Location:** `codex/patches/`

---

## Phase Summary

### Phase 1: Question-First Bypass
- **Status:** Completed
- **Description:** Detect question-style inputs and skip typo fallback + pending-options guard

### Phase 1a: Error Message Preservation
- **Status:** Completed
- **Description:** Do not overwrite explicit resolver errors with typo fallback

### Phase 1b: Last Action Formatting for Panels
- **Status:** Completed
- **Description:** Format open_panel actions in last-action responses

### Phase 2: Notes Scope Clarification
- **Status:** Completed
- **Description:** Scope-aware responses for notes questions (dashboard vs workspace)

### Phase 2a: Clarification "Yes" Handling
- **Status:** Completed
- **Description:** Workspace picker on "yes" to notes-scope clarification
- **Includes:** Phase 2a.1 (Label Matching), 2a.2 (Pending-Options Guard), 2a.3 (LLM Interpretation), 2a.4 (Explanation Requests)

### Phase 2b: Verb + Ordinal Selection
- **Status:** Completed
- **Description:** Support "open the second" style selection phrases

### Phase 3: Open Notes Source of Truth
- **Status:** Completed
- **Description:** uiContext.workspace.openNotes reflects Open Notes dock state
- **Key Features:**
  - Single owner (AnnotationAppShell)
  - Workspace switch guard
  - isStale flag for hydration handling

### Phase 4: Dashboard/Workspace State Reporting
- **Status:** Completed
- **Description:** Dashboard and workspace report summaries to widgetStates
- **Key Features:**
  - Dashboard filters out workspace widgetStates
  - Ref-based cleanup for guaranteed state removal
  - Mode guards in intent-prompt.ts

### Phase 4 Small-Risk Fixes
- **Status:** Completed
- **Description:** Post-implementation hardening
- **Fixes:**
  - widgetId-based filtering (replaced instanceId prefix)
  - Clarification-first routing order
  - Question-style affirmations in LLM prompt

---

## Key Files Modified

### Core Implementation
| File | Changes |
|------|---------|
| `components/dashboard/DashboardView.tsx` | Dashboard widgetStates reporting, filtering, mode uiContext |
| `components/annotation-app-shell.tsx` | Workspace widgetStates reporting, isStale flag, switch guard |
| `components/chat/chat-navigation-panel.tsx` | Clarification handling, question-first routing |
| `app/api/chat/navigate/route.ts` | Clarification interpreter prompt improvements |
| `lib/chat/intent-prompt.ts` | UIContext type extensions, isStale handling |
| `lib/widgets/widget-state-store.ts` | Widget state management |

---

## Acceptance Criteria (All Verified)

### Question Routing
- [x] "What widgets are visible?" -> context answer, not fallback
- [x] "Which notes are open?" -> context answer in workspace
- [x] "Is F in the list?" -> context answer using last options

### Notes Scope
- [x] Dashboard: "Which notes are open?" -> clarification
- [x] Workspace: "Which notes are open?" -> list of open notes

### Clarification Flow
- [x] "yes" -> workspace picker
- [x] "can you do that?" -> interpreted as YES
- [x] "is that possible?" -> interpreted as YES
- [x] "nope" -> cancels clarification
- [x] New question -> exits clarification to normal routing

### Selection
- [x] "open the second" -> selects option 2
- [x] "select the first option" -> selects option 1

### WidgetStates
- [x] "What widgets are visible?" -> uses dashboard widgetState summary
- [x] "What panel is open?" -> matches open drawer + dashboard summary
- [x] "Which notes are open?" -> matches workspace widgetState + openNotes list

---

## Git Commits

| Hash | Message |
|------|---------|
| `8c928592` | phase 1-3 done |
| `346a4657` | implement phase 4 |
| `57938249` | fixed the remaining issues |
| `18417184` | improving the clarification response in chat |

---

## Known Limitations

1. **widgetId collision:** Third-party widgets using `widgetId: 'workspace'` would be filtered (semantically reserved)
2. **Question-style affirmations:** Novel phrasings not in LLM prompt may return UNCLEAR
3. **Debounce window:** 300ms debounce on mode switches may block rapid toggles

---

## Follow-up Hardening (Deferred)

```typescript
// In widget-state-store.ts
// If widgetId === 'workspace', require instanceId to be 'workspace-{workspaceId}'
// Otherwise allow any instanceId (no prefix reservations)
```

---

## Next Candidates

Potential follow-up features to implement after this plan:

| Plan | Description | Path |
|------|-------------|------|
| Chat History Persistence | Persist chat across sessions | `plan/chat-history-persistence-plan.md` |
| LLM Layered Chat Experience | Enhanced chat UX | `plan/panels/chat/enhance/llm-layered-chat-experience-plan.md` |
| UI Context Bundle | Context bundling improvements | `plan/panels/chat/enhance/ui-context-bundle-plan.md` |

---

## Related Documentation

- Widget Chat State Contract: `plan/panels/widget_manager/widget-chat-state-contract-implementation-plan.md`
- Widget Architecture: `plan/panels/widget-architecture-implementation-plan.md`
