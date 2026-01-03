# Plan: Widget Manager (Custom Widgets + Auto Chat Integration)

**Date:** 2025-01-02
**Status:** Draft
**Scope:** Provide a Widget Manager that lets users install widgets without code and auto-enable chat capabilities safely.

---

## Lesson Applied (from Demo Widget Fix)
The Demo Widget failed initially because client-side manifest registration did not reach the server-side registry.

**Constraint:** All chat-intent manifests used by the LLM **must be available on the server** at request time. Any client-only registration is insufficient.

This plan enforces a server-visible manifest store and a server-side loader on each chat request (or cached with invalidation).

---

## Goals
- Users can install widgets via URL/file/store with no code changes.
- Installed widgets automatically become chat-aware.
- Chat uses only server-visible manifests to avoid client/server mismatch.
- Widgets are safe, scoped, and permissioned.
- Widget state and enable/disable status persist per user.

## Non-Goals (v1)
- Running arbitrary untrusted code without sandboxing.
- Global widget marketplace (curation can come later).
- Complex permission systems beyond read/write for chat actions.

---

## Architecture Overview

```
User installs widget -> Widget Manager validates -> Stored in DB
                                |                   |
                                v                   v
                      Server loads manifests   Widget UI renders
                                |
                                v
                      Chat intent prompt uses server manifest list
```

Key design: **Server-side manifest source of truth**.

---

## Data Model

### Table: installed_widgets
Stores widget metadata and manifest for server-side chat usage.

Fields:
- id (uuid, pk)
- user_id (uuid, nullable for single-user mode)
- name (text)
- slug (text, unique per user)
- source_type (enum: url, file, store)
- source_ref (text) // URL or file identifier
- version (text)
- manifest (jsonb) // PanelChatManifest
- enabled (boolean)
- created_at, updated_at

### Table: widget_instances
Stores placement of a widget on a dashboard.

Fields:
- id (uuid, pk)
- user_id (uuid, nullable)
- widget_id (fk -> installed_widgets.id)
- entry_id (uuid)
- workspace_id (uuid) // dashboard workspace
- panel_id (text) // unique instance panelId for chat
- config (jsonb)
- created_at, updated_at

Notes:
- panel_id must be unique per instance, e.g. "taskboard-<instanceId>".
- manifest stored in installed_widgets is the server source of truth.

---

## Chat-Sync Strategy (Server-Visible Manifests)

### Rule
Chat prompt must only use manifests known to the server.

### Mechanism
- On each chat request, server loads all **enabled** widget manifests for the user.
- Server also loads **visible panel IDs** (from request context) and filters manifests accordingly.
- Optional cache: cache manifests per user with TTL and invalidate on widget enable/disable.

### Built-in Widgets Strategy (Phase 1)
**Option B:** Built-in widgets (Recent, Quick Links, Demo) remain in code.
Custom widgets are stored in DB. A full migration of built-ins to DB is a future option.

### Why this avoids the Demo Widget failure
- Server reads manifests from DB, not client runtime state.
- Client registration is only for visibility/focus hints, not for manifest discovery.

---

## Widget Manager UI

### Core UI
- Install input: URL/file/store
- Widget list: Enabled toggle, Settings, Uninstall
- Chat commands preview (from manifest examples)

### Example
```
[ Install widget URL ] [ Add ]

My Widgets
- Task Board   Enabled [on]  Chat: "show tasks", "add task"
- Weather      Enabled [on]  Chat: "show weather"
- Analytics    Disabled      Chat: --
```

---

## Install Pipeline

### Validation Steps
1. Fetch widget package (URL/file/store)
2. Extract manifest (JSON)
3. Validate manifest using validateManifest()
4. Reject if invalid or missing required fields
5. Save to installed_widgets

### Manifest Requirements
- Valid PanelChatManifest
- Intent handlers must be API-only (api:/api/panels/...)
- Permission must be read/write only

---

## Runtime Flow

### 1. User installs widget
- Stored in installed_widgets
- Enabled = true

### 2. User adds widget to dashboard
- Creates widget_instances row
- Generates unique panel_id

### 3. Chat request
- Server loads enabled widget manifests
- Filters to visible panel IDs
- Injects into prompt section

### 4. Chat intent execution
- LLM returns panel_intent
- Server executes API handler

---

## Security / Isolation Model

### Phase 1 (Safe, Server-Only)
- Widgets are data-driven (no arbitrary code execution)
- Only API handlers run on server
- UI rendered by known widget templates

### Phase 2 (Sandboxed Custom Code)
- Allow custom widget bundles
- Render inside iframe/worker sandbox
- Strict allowlist for APIs

---

## Phased Implementation

### Phase 1: DB + Manager UI (Read-Only)
- Add installed_widgets + widget_instances tables
- Basic Widget Manager panel (list + enable/disable)
- Server loads manifests from DB and injects into prompt
- No custom code execution

Phase 1 checklist:
- [x] DB schema created (installed_widgets, widget_instances)
- [x] Migration SQL written (059_create_widget_manager_tables)
- [x] Minimal API endpoints (GET /api/widgets/list, POST /api/widgets/enable)
- [x] Manager UI lists widgets and enabled state (WidgetManager.tsx)
- [x] Server loads enabled manifests from DB per request (buildPromptSectionWithDB)
- [x] Built-ins remain code-registered (Option B)

### Phase 2: Install Pipeline
- URL import (v1; file import deferred to Phase 2.5)
- Manifest validation
- Store manifest + metadata
- Create widget instance on add-to-dashboard

Phase 2 checklist:
- [x] Install endpoint accepts URL (file import deferred)
- [x] Manifest validation enforced (including api: handler prefix)
- [x] Widgets persisted in DB
- [x] Widget instances created on add-to-dashboard (UI wiring)

Phase 2 prerequisites (define before implementation):
- Widget package format (v1: raw JSON manifest via URL; no zip/file upload)
- Manifest validation rules + error responses (use validateManifest + structured errors)
- TypeScript interfaces (InstalledWidget, WidgetInstance, InstallRequest)
- UI integration point (Widget Manager panel: “Install from URL” input)
- Test cases (happy path + invalid manifest + unreachable URL + duplicate slug)

### Phase 3: Safe Custom Widgets
- Sandbox execution
- Permission gating
- Package signing (optional)

Phase 3 checklist:
- [ ] Sandbox for third-party code
- [ ] Restricted API surface
- [ ] Permission gating for write intents

### Phase 4: Widget Store
- Curated list
- Versioning + updates

Phase 4 checklist:
- [ ] Store browsing UI
- [ ] Install from curated list
- [ ] Update flows for installed widgets

---

## Debug Logging (Recommended)
Log these events when debug enabled:
- widget_install_success / widget_install_fail
- widget_manifest_loaded
- widget_chat_prompt_injected
- widget_intent_routed

---

## Files to Touch (Expected)

- migrations/059_create_widget_manager_tables.up.sql ✅ (created)
- migrations/059_create_widget_manager_tables.down.sql ✅ (created)
- app/api/widgets/install/route.ts
- app/api/widgets/list/route.ts
- app/api/widgets/enable/route.ts
- lib/widgets/widget-store.ts (DB access)
- lib/panels/panel-registry.ts (load manifests from DB)
- components/dashboard/widgets/WidgetManager.tsx

---

## Cache Invalidation Rules
- Invalidate manifest cache on: install, uninstall, enable, disable
- TTL: 5 minutes (configurable)
- Cache key: `user_id + widget_manifests`

---

## API Contract Stubs

POST `/api/widgets/install`
- Body: `{ url?: string, file?: string }`
- Response: `{ widget: InstalledWidget }`

GET `/api/widgets/list`
- Response: `{ widgets: InstalledWidget[] }`

POST `/api/widgets/enable`
- Body: `{ id: string, enabled: boolean }`
- Response: `{ success: true }`

DELETE `/api/widgets/:id`
- Response: `{ success: true }`

---

## Success Criteria
- A widget installed via URL shows up in Manager.
- When enabled and visible, its intents appear in the LLM prompt.
- Chat commands map to its manifest without code changes.
- No client-only registration required for server prompt.

---

## Risks
- Serverless cold start: manifest load must be per-request or cached safely.
- Untrusted code: avoid in Phase 1; use sandbox in Phase 3.
- Prompt bloat: filter by visible panels and enabled widgets only.
