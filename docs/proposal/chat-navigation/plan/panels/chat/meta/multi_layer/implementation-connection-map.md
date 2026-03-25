# Implementation Connection Map — Plans, Reports, and Dependencies

This document tracks the explicit connections between implemented plans, their reports, and the dependency chain across the chat navigation system.

## How to Read This

Each section shows:
- **Plan** — the design document
- **Report** — the implementation report
- **Status** — current state
- **Depends on** — what this plan required to be in place first
- **Enables** — what later plans depend on this one

---

## 1. Panel Registry Replay Coverage

**Plan:** `stage6x8-phase5-panel-registry-replay-coverage-addendum.md`
**Report:** `2026-03-21-stage6x8-phase5-panel-registry-replay-coverage-implementation.md`
**Status:** Implemented

**What it does:**
- Resolver-seam fix: `resolvePanelIntent()` preserves `open_panel_drawer` from `executePanelIntent`
- Grounding panel writeback: Tier 4.5 grounding panel-execute emits Phase 5 pending writes
- All built-in panel manifests verified for replay-safe open/show intents

**Depends on:**
- Phase 5 retrieval-backed semantic memory (`stage6x8-phase5-retrieval-backed-semantic-memory-plan.md`)
- Family-level replay coverage (`stage6x8-phase5-family-level-replay-coverage-addendum.md`)

**Enables:**
- Duplicate panel instance identity (needs replay to work first)
- Selector-aware replay fix (builds on the writeback infrastructure)

**Key files:**
- `lib/chat/intent-resolver.ts` — resolver-seam fix
- `lib/chat/routing-dispatcher.ts` — `_groundingPanelOpen`
- `components/chat/chat-navigation-panel.tsx` — client-side grounding writeback

---

## 2. Duplicate Panel Instance Identity (Phases 1-3: Foundation)

**Plan:** `stage6x8-phase5-duplicate-panel-instance-identity-addendum.md`
**Report:** `2026-03-21-stage6x8-phase5-duplicate-instance-identity-phases1-3-implementation.md`
**Status:** Implemented

**What it does:**
- Authoritative `panel_type` → family mapping (`duplicate-family-map.ts`)
- Shared instance-label allocator (`instance-label-allocator.ts`)
- DB migration 074: `instance_label` + `duplicate_family` columns with family-scoped unique index
- Navigator backfill + Links Panel backfill from existing `badge`

**Depends on:**
- Panel registry replay coverage (replay infrastructure must work)

**Enables:**
- Phases 4-7 (prompt, extraction, resolver, snapshots)
- Singleton enforcement

**Key files:**
- `lib/dashboard/duplicate-family-map.ts` — family map + singleton policy
- `lib/dashboard/instance-label-allocator.ts` — shared allocator
- `migrations/074_instance_label.up.sql` — DB schema

---

## 3. Duplicate Panel Instance Identity (Phases 4-7: Routing Adoption)

**Plan:** `stage6x8-phase5-duplicate-panel-instance-identity-addendum.md` (same plan, later phases)
**Report:** `2026-03-21-stage6x8-phase5-duplicate-instance-identity-phases4-7-implementation.md`
**Status:** Implemented

**What it does:**
- Typed contracts: `instanceLabel` in intent-schema, panel-manifest, panel-registry
- Prompt rules: generic duplicate-instance rule + visible-widget rendering
- Deterministic extraction: `extractInstanceLabel()` + `applyInstanceLabelOverride()`
- Resolver: duplicate-family branch in `resolveDrawerPanelTarget`
- Known-noun routing: visible sibling deferral for duplicable families
- Navigator snapshot registration + badge in header
- B1 validator: `duplicate_family_ambiguous` rejection for panels with multiple siblings

**Depends on:**
- Phases 1-3 foundation (family map, allocator, DB schema)

**Enables:**
- Selector-aware replay fix (needs instance identity in place)
- Widget Manager hide/show (needs visibility filtering)

**Key files:**
- `lib/chat/ui-helpers.ts` — `extractInstanceLabel`, `extractQuickLinksInstanceLabel`
- `lib/chat/known-noun-routing.ts` — `getKnownNounFamily()` + sibling deferral
- `lib/chat/routing-log/memory-validator.ts` — `duplicate_family_ambiguous` + `target_panel_hidden`

---

## 4. Singleton Panel Enforcement

**Plan:** (inline plan, not a separate plan file)
**Report:** `2026-03-21-singleton-panel-enforcement-implementation.md`
**Status:** Implemented

**What it does:**
- Explicit singleton allowlist: `widget_manager`, `continue`, `recent`
- API guard: 409 on duplicate singleton creation
- Add Panel UI: disabled + "Already on dashboard" for singletons

**Depends on:**
- Duplicate-family map (uses `isSingletonPanelType` from `duplicate-family-map.ts`)

**Enables:**
- Widget Manager hide/show (singletons need a restore path since Add Panel blocks re-add)

**Key files:**
- `lib/dashboard/duplicate-family-map.ts` — `SINGLETON_PANEL_TYPES` + `isSingletonPanelType`
- `app/api/dashboard/panels/route.ts` — API guard
- `components/dashboard/PanelCatalog.tsx` — UI guard

---

## 5. Dashboard Panel Hide/Show via Widget Manager

**Plan:** `stage6x8-phase5-dashboard-panel-hide-show-plan.md`
**Report:** `2026-03-22-dashboard-panel-hide-show-implementation.md`
**Status:** Implemented

**What it does:**
- Widget Manager "Dashboard Panels" section with Hide/Show for all panels
- Hidden panels excluded from chat routing (resolver `is_visible = true`)
- Memory validator: `target_panel_hidden` rejection for hidden panels
- Hidden singleton types remain disabled in Add Panel catalog

**Depends on:**
- Singleton enforcement (hidden singletons need Add Panel blocking)
- Duplicate instance identity (visibility filtering uses the same infrastructure)

**Enables:**
- Clean panel lifecycle without losing panel state/position

**Key files:**
- `components/dashboard/panels/WidgetManagerPanel.tsx` — Dashboard Panels section
- `lib/chat/intent-resolver.ts` — `AND is_visible = true` on all panel queries
- `lib/chat/routing-log/memory-validator.ts` — `target_panel_hidden`

---

## 6. Duplicate-Family Memory-Exact Replay Fix (Selector-Aware)

**Plan:** `stage6x8-phase5-duplicate-family-memory-exact-replay-fix-plan.md`
**Report:** `2026-03-22-duplicate-family-memory-exact-replay-fix-implementation.md`
**Status:** Implemented

**What it does:**
- Writeback stores `duplicateFamily`, `instanceLabel`, `selectorSpecific` in `slots_json`
- `selectorSpecific` derived from user query intent (not panel row)
- Validator: 4-rule selector-aware validation (hidden, legacy, generic, explicit)
- Shared `extractQuickLinksInstanceLabel` for all Quick Links alias forms
- UPSERT self-upgrade: refreshes `slots_json` on conflict

**Depends on:**
- Duplicate instance identity (needs `duplicateFamily`/`instanceLabel` in visible widgets)
- Panel registry replay coverage (needs the writeback infrastructure)
- Hide/show (needs `target_panel_hidden` guard)

**Enables:**
- "open links panel b" → Memory-Exact on repeat
- "open navigator d" → Memory-Exact on repeat
- "open links panel" (generic) → still clarifies

**Key files:**
- `lib/chat/routing-log/memory-write-payload.ts` — selector fields in `open_panel` slots_json
- `lib/chat/routing-log/memory-validator.ts` — `target_panel_selector_mismatch`
- `app/api/chat/routing-memory/route.ts` — UPSERT self-upgrade

---

## 7. Note Command Manifest Architecture (Phases 1-4 + Phase A Bridge)

**Plan:** `stage6x8-note-command-manifest-architecture-plan.md`
**Report:** (no consolidated report yet — implemented across multiple commits)
**Status:** Phase 1-4 implemented; Phase A workspace-preserving note-open bridge implemented

**What it does:**
- Phase 1: Manifest types, policy enums, seed entries (`note-command-manifest.ts`)
- Phase 2: Generic note resolver with deterministic detection (`note-command-resolver.ts`)
- Phase 3: Executor integration — state_info validation + navigate pre-LLM intercept + durable telemetry
- Phase 4: `note_manifest_cache` exact-query memory/cache integration for `state_info.active_note` and `navigate.open_note`
- Phase A bridge: plain `open note X` now routes through `open_note_in_current_workspace` instead of silently switching to the note's source workspace
- Contract split in manifest:
  - `open_note_in_current_workspace`
  - `navigate_to_note_workspace`

**Depends on:**
- UPSERT self-upgrade from selector-aware replay fix (shared infrastructure)
- Existing cross-surface arbiter (state_info path)
- Existing note resolver (navigate DB lookup)

**Enables:**
- Future: `read`, `capability`, `mutate` families
- Future explicit cross-workspace note-navigation commands using `navigate_to_note_workspace`

**Key files:**
- `lib/chat/note-command-manifest.ts` — manifest types + seed entries
- `lib/chat/note-command-resolver.ts` — generic resolver + strict navigate gate
- `lib/chat/routing-dispatcher.ts` — state_info validation + note-manifest cache dispatch + navigate intercept
- `lib/chat/routing-log/memory-write-payload.ts` — `note_manifest_cache` write builder
- `lib/chat/use-chat-navigation.ts` — `openNoteInCurrentWorkspace()` Phase A bridge

**Supersedes:**
- `stage6x8-phase5-note-query-memory-exact-plan.md` (the per-family replay approach was reverted in favor of this manifest-driven architecture)

---

## 8. UI Icon Fixes (Recent Widget + Links Panel)

**Plan:** (no separate plan — product UX decision)
**Report:** (no separate report — part of session work)
**Status:** Implemented

**What it does:**
- Recent widget: replaced letter avatars with folder/workspace Lucide icons
- Links Panel widget: replaced link chain icon with folder icon + link-styled text

**Depends on:**
- Entry-as-folder icon model (project memory)

**Key files:**
- `components/dashboard/widgets/RecentWidget.tsx` — `FolderOpen` / `Layout` icons
- `components/dashboard/panels/RecentPanel.tsx` — same icons in drawer
- `components/dashboard/widgets/QuickLinksWidget.tsx` — `FolderOpen` icon + `linkStyle`
- `components/dashboard/widgets/BaseWidget.tsx` — `icon` + `linkStyle` props

---

## Dependency Chain (Visual)

```
Phase 5 Semantic Memory
    │
    ▼
Family-Level Replay Coverage
    │
    ▼
Panel Registry Replay Coverage ──────────────────┐
    │                                             │
    ▼                                             ▼
Duplicate Instance Identity (1-3) ──► Duplicate Instance Identity (4-7)
    │                                             │
    ▼                                             ▼
Singleton Enforcement              Selector-Aware Replay Fix
    │                                             │
    ▼                                             │
Dashboard Panel Hide/Show ◄───────────────────────┘
                                                  │
                                                  ▼
                                    UPSERT Self-Upgrade (shared)
                                                  │
                                                  ▼
                                    Note Command Manifest (1-4)
                                                  │
                                                  ▼
                        Phase A: Workspace-Preserving Note Open Bridge
```

## Follow-ups (Documented but Not Implemented)

1. **Known-noun writeback parity** — Tier 4 known-noun deterministic panel opens don't emit Phase 5 writebacks
2. **Gap 2: Instance-aware visible disambiguation** — Clarifier pills should show instance labels ("Widget Manager A" vs "Widget Manager B")
3. **Note-open commit-point acknowledgment** — Phase A bridge still treats event dispatch as success before the canvas confirms the note visibly opened
4. **Workspace/chat-context sync for note-state reporting** — runtime/canvas note state can diverge from shell `widgetState` / chat context, making `which notes are open?` unreliable
5. **Note Phase B families** — `note_read_content` (needs follow-up anchor), `note_capability_info` (needs responder), `note_mutation_request` (needs idempotency)
6. **Async promotion race** — Phase 5 pending write promotion is fire-and-forget; Memory-Exact may appear on Turn 2 or Turn 3
7. **Navigate telemetry outcome attribution** — Navigate telemetry logs intercept attempt, not confirmed execution outcome
