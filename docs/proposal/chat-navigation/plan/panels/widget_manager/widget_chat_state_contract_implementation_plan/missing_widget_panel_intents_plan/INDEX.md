# Missing Widget Panel Intents - Implementation Index

**Feature:** Missing Widget Panel Intents
**Status:** COMPLETED
**Date Range:** 2025-01-09
**Last Updated:** 2025-01-09

---

## Overview

This feature ensures "open <widget name>" commands route to the correct panel drawer for all built-in widgets shown on the dashboard (Navigator, Quick Capture, Links Overview, Continue, Widget Manager). Implements both a Temporary Bridge (fast path via visibleWidgets) and full panel manifests with a shared open-drawer handler.

---

## Document Hierarchy

```
docs/proposal/chat-navigation/plan/panels/widget_manager/widget_chat_state_contract_implementation_plan/
│
├── missing_widget_panel_intents_plan/
│   └── INDEX.md                                    ← YOU ARE HERE
│
├── missing-widget-panel-intents-plan.md            [MASTER PLAN]
│   ├── Problem: Widgets missing panel intents
│   ├── Temporary Bridge (Step 0: visibleWidgets)
│   └── Full Manifest Implementation
│
├── panel-intent-ambiguity-guard-plan.md            [RELATED PLAN]
│   ├── Multi-step disambiguation (Steps 0-3)
│   ├── Quick Links badge differentiation
│   ├── LLM prompt hardening
│   └── Fuzzy match confirm pill
│
└── missing_widget_panel_intents_plan_report/       [REPORTS]
    ├── README.md                                   [Report Index]
    ├── 2025-01-09-implementation-report.md         [Main Report]
    ├── code-changes-summary.md                     [Code Changes]
    └── test-cases.md                               [Test Cases]

NOTE: The reports are titled "Panel Intent Ambiguity Guard" because that feature
was implemented as part of the Missing Widget Panel Intents work. Both features
share the same implementation report.
```

### Plan → Report Mapping

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MASTER PLAN                                        │
│                missing-widget-panel-intents-plan.md                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┴───────────────────────────┐
        │                                                       │
        ▼                                                       ▼
┌───────────────────┐                               ┌───────────────────┐
│ Temporary Bridge  │                               │  Full Manifest    │
│   (Phase 1)       │                               │   (Phase 2)       │
│ Step 0: visible   │                               │ Panel manifests   │
│   Widgets match   │                               │ + shared handler  │
└─────────┬─────────┘                               └─────────┬─────────┘
          │                                                   │
          └─────────────────────┬─────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────┐
                    │   IMPLEMENTATION REPORT   │
                    │      2025-01-09           │
                    │ missing_widget_panel_     │
                    │ intents_plan_report/      │
                    └───────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
            ▼                   ▼                   ▼
    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
    │ Code Changes  │   │  Test Cases   │   │    README     │
    │   Summary     │   │               │   │               │
    └───────────────┘   └───────────────┘   └───────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         RELATED PLAN                                         │
│              panel-intent-ambiguity-guard-plan.md                            │
│   (Quick Links disambiguation, fuzzy match confirm pill)                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Master Plan

| Document | Path (relative to parent) |
|----------|---------------------------|
| **Main Plan** | `../missing-widget-panel-intents-plan.md` |
| **Related Plan** | `../panel-intent-ambiguity-guard-plan.md` |

---

## Implementation Reports

| Topic | Date | Report (relative to parent) |
|-------|------|------------------------------|
| Full Implementation | 2025-01-09 | `../missing_widget_panel_intents_plan_report/2025-01-09-implementation-report.md` |
| Code Changes Summary | 2025-01-09 | `../missing_widget_panel_intents_plan_report/code-changes-summary.md` |
| Test Cases | 2025-01-09 | `../missing_widget_panel_intents_plan_report/test-cases.md` |
| Report Index | 2025-01-09 | `../missing_widget_panel_intents_plan_report/README.md` |

---

## Phase Summary

### Phase 1: Temporary Bridge (Step 0)
- **Status:** Completed
- **Description:** Check if panelId matches visible widget title → open immediately
- **Key Features:**
  - visibleWidgets passed from uiContext to resolver
  - Exact title match (normalized) opens drawer directly
  - No database query needed for visible widgets

### Phase 2: Full Manifest Implementation
- **Status:** Completed
- **Description:** Panel manifests with shared open-drawer handler
- **Key Features:**
  - 5 manifest files (Navigator, Quick Capture, Links Overview, Continue, Widget Manager)
  - Shared `/api/panels/open-drawer` handler (Option B)
  - Manifests registered in panel-registry.ts
  - LLM prompt includes intent examples from manifests

### Related: Panel Intent Ambiguity Guard
- **Status:** Completed
- **Description:** Handle ambiguous panel references (e.g., multiple Quick Links)
- **Key Features:**
  - Multi-step disambiguation (Steps 0-3)
  - Badge-differentiated pills for Quick Links
  - Fuzzy match confirm pill ("Did you mean X?")
  - LLM prompt hardening for "open links"

---

## Files Created

### API Handler
| File | Description |
|------|-------------|
| `app/api/panels/open-drawer/route.ts` | Shared open-drawer handler for all 5 widgets |

### Panel Manifests
| File | Widget |
|------|--------|
| `lib/panels/manifests/navigator-panel.ts` | Navigator |
| `lib/panels/manifests/quick-capture-panel.ts` | Quick Capture |
| `lib/panels/manifests/links-overview-panel.ts` | Links Overview |
| `lib/panels/manifests/continue-panel.ts` | Continue |
| `lib/panels/manifests/widget-manager-panel.ts` | Widget Manager |

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/panels/panel-registry.ts` | Import and register all 5 widget manifests |
| `lib/chat/intent-resolver.ts` | Step 0-3 disambiguation logic, DrawerResolutionResult type |
| `lib/chat/intent-prompt.ts` | CRITICAL Quick Links disambiguation section |
| `lib/chat/chat-navigation-context.tsx` | panel_drawer type, PanelDrawerData interface |
| `lib/chat/use-chat-navigation.ts` | panel_drawer case handler |
| `lib/chat/resolution-types.ts` | visibleWidgets field in ResolutionContext |
| `app/api/chat/navigate/route.ts` | Pass visibleWidgets from uiContext to resolver |

---

## Acceptance Criteria (All Verified)

### Widget Opening
- [x] "open navigator" opens Navigator drawer
- [x] "open quick capture" opens Quick Capture drawer
- [x] "open links overview" opens Links Overview drawer
- [x] "open continue" opens Continue drawer
- [x] "open widget manager" opens Widget Manager drawer
- [x] No "No entry or workspace found" errors

### Disambiguation (Related)
- [x] "open links" shows disambiguation pills when multiple Quick Links exist
- [x] Pills show badge-differentiated labels (Quick Links D, Quick Links E)
- [x] Number selection ("1", "2") works
- [x] Explicit badge ("open links D") bypasses disambiguation

### Natural Language Variations
- [x] "open widget manager pls" works
- [x] "can you pls open recents" works
- [x] "open navigator pls" works

---

## Test Results (2025-01-09)

| Command | Intent Routing | Drawer Opened | Status |
|---------|---------------|---------------|--------|
| "open quick capture" | ✅ | ✅ | PASS |
| "open widget manager pls" | ✅ | ✅ | PASS |
| "can you pls open recents" | ✅ | ✅ | PASS |
| "open continue" | ✅ | ✅ | PASS |
| "open navigator pls" | ✅ | ✅ | PASS |

**All 5/5 acceptance criteria verified.**

---

## Git Commits

| Hash | Message |
|------|---------|
| `b4221a8f` | implement nos 2 in the missing-widget-panel-intents-plan.md |
| `8c928592` | phase 1-3 done |
| `346a4657` | implement phase 4 |

---

## Architecture

### Resolution Flow

```
User: "open navigator"
       ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 0: Check visibleWidgets (exact title match)            │
│         → If found: Open immediately (fast path)            │
│         → If not: Continue to Step 1                        │
└─────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Check exact panel_type match in DB                  │
│         → If single match: Open immediately                 │
│         → If multiple: Return disambiguation                │
│         → If none: Continue to Step 2                       │
└─────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: Check exact title match (ILIKE)                     │
│         → Same logic as Step 1                              │
└─────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Fuzzy match (ILIKE '%name%')                        │
│         → If 1 match: Show confirm pill ("Did you mean X?") │
│         → If >1: Return disambiguation pills                │
│         → If 0: Return "not_found" → executePanelIntent()   │
└─────────────────────────────────────────────────────────────┘
```

### Type System

```typescript
type DrawerResolutionResult =
  | { status: 'found'; panelId: string; panelTitle: string; semanticPanelId: string }
  | { status: 'confirm'; panelId: string; panelTitle: string; panelType: string; semanticPanelId: string }
  | { status: 'multiple'; panels: Array<{ id: string; title: string; panel_type: string }> }
  | { status: 'not_found' }
```

---

## Future Work (Optional)

| Enhancement | Description |
|-------------|-------------|
| Widget-specific intents | Add intents beyond "open" (list items, show details, etc.) |
| Dedicated API handlers | For complex operations per widget |

---

## Related Documentation

- Widget Chat State Contract: `../../widget-chat-state-contract-implementation-plan.md`
- Question-First Routing: `../question-first-routing-notes-context-plan.md`
- Panel Ambiguity Guard: `../panel-intent-ambiguity-guard-plan.md`
